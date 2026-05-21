"""Tests for the bulk-edit endpoints under /api/files/*.

Covers POST /api/files/load-cached-metadata (sidecar lookup) and PATCH
/api/files/bulk-write (two-phase metadata + optional rename). Both feed
the BulkEditSheet.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mutagen.id3 import ID3, ID3NoHeaderError


@pytest.fixture
def client(monkeypatch, tmp_path):
    download = tmp_path / "downloads"
    library = tmp_path / "library"
    download.mkdir()
    library.mkdir()
    from backend import main

    monkeypatch.setattr(main, "DOWNLOAD_PATH", download)
    monkeypatch.setattr(main, "LIBRARY_PATH", library)
    return TestClient(main.app), download, library


def _write_sidecar(
    download: Path,
    creator_slug: str,
    post_id: str,
    *,
    title: str = "Cached Title",
    artist: str = "Solar Girl",
    tags: list[str] | None = None,
):
    """Write a patreon-dl-shaped sidecar under DOWNLOAD_PATH/.patreon-dl/.

    Mirrors `_iter_cached_posts`' expected layout: any `post-api.json`
    underneath `.patreon-dl/` is parsed, regardless of intermediate dirs.
    """
    info_dir = download / ".patreon-dl" / "Patreon" / creator_slug / "posts" / post_id / "post_info"
    info_dir.mkdir(parents=True, exist_ok=True)
    included = [{"type": "user", "id": "u1", "attributes": {"full_name": artist}}]
    for i, tag in enumerate(tags or []):
        included.append(
            {"type": "post_tag", "id": f"t{i}", "attributes": {"value": tag}},
        )
    sidecar = {
        "data": {
            "id": post_id,
            "attributes": {"title": title, "content": ""},
            "relationships": {"user": {"data": {"id": "u1"}}},
        },
        "included": included,
    }
    (info_dir / "post-api.json").write_text(json.dumps(sidecar), encoding="utf-8")


def _stage_audio(download: Path, folder: str, filename: str = "song.mp3") -> str:
    (download / folder).mkdir(parents=True, exist_ok=True)
    (download / folder / filename).write_bytes(b"fake audio")
    return f"{folder}/{filename}"


# ── /api/files/load-cached-metadata ─────────────────────────────────────────


class TestLoadCachedMetadata:
    def test_empty_entry_when_no_patreon_dl_dir(self, client):
        c, download, _ = client
        rel = _stage_audio(download, "Solar Girl/12345 - Cached Title")
        r = c.post(
            "/api/files/load-cached-metadata",
            json={"paths": [rel], "root": "downloads"},
        )
        assert r.status_code == 200
        assert r.json() == {"items": [{"path": rel}]}

    def test_resolves_flattened_layout(self, client):
        c, download, _ = client
        _write_sidecar(
            download,
            "solar",
            "12345",
            title="Cached Title",
            artist="Solar Girl",
            tags=["whisper", "sleep"],
        )
        rel = _stage_audio(download, "Solar Girl/12345 - Cached Title")
        r = c.post(
            "/api/files/load-cached-metadata",
            json={"paths": [rel], "root": "downloads"},
        )
        assert r.status_code == 200
        assert r.json() == {
            "items": [
                {
                    "path": rel,
                    "title": "Cached Title",
                    "artist": "Solar Girl",
                    "tags": ["whisper", "sleep"],
                },
            ],
        }

    def test_resolves_legacy_flat_layout(self, client):
        c, download, _ = client
        _write_sidecar(download, "solar", "12345", title="Legacy Post")
        rel = _stage_audio(download, "12345")
        r = c.post(
            "/api/files/load-cached-metadata",
            json={"paths": [rel], "root": "downloads"},
        )
        assert r.status_code == 200
        assert r.json()["items"][0]["title"] == "Legacy Post"

    def test_empty_entry_when_parent_folder_lacks_post_id(self, client):
        c, download, _ = client
        _write_sidecar(download, "solar", "12345", title="Cached Title")
        # Folder name "Sleepy whispers" doesn't start with a numeric id, so
        # there's nothing to look up — the entry comes back without
        # metadata fields.
        rel = _stage_audio(download, "Solar Girl/Sleepy whispers")
        r = c.post(
            "/api/files/load-cached-metadata",
            json={"paths": [rel], "root": "downloads"},
        )
        assert r.status_code == 200
        assert r.json() == {"items": [{"path": rel}]}

    def test_empty_entry_when_post_id_not_in_cache(self, client):
        c, download, _ = client
        _write_sidecar(download, "solar", "12345")
        rel = _stage_audio(download, "Solar Girl/99999 - Other Post")
        r = c.post(
            "/api/files/load-cached-metadata",
            json={"paths": [rel], "root": "downloads"},
        )
        assert r.status_code == 200
        assert r.json() == {"items": [{"path": rel}]}

    def test_returns_per_path_results_in_request_order(self, client):
        c, download, _ = client
        _write_sidecar(download, "solar", "12345", title="First")
        _write_sidecar(download, "solar", "67890", title="Second")
        rel_a = _stage_audio(download, "Solar Girl/12345 - First", filename="a.mp3")
        rel_b = _stage_audio(download, "Solar Girl/Untagged", filename="b.mp3")
        rel_c = _stage_audio(download, "Solar Girl/67890 - Second", filename="c.mp3")
        r = c.post(
            "/api/files/load-cached-metadata",
            json={"paths": [rel_a, rel_b, rel_c], "root": "downloads"},
        )
        assert r.status_code == 200
        items = r.json()["items"]
        assert [item["path"] for item in items] == [rel_a, rel_b, rel_c]
        assert items[0]["title"] == "First"
        assert "title" not in items[1]
        assert items[2]["title"] == "Second"

    def test_traversal_path_returns_empty_entry_not_400(self, client):
        c, _, _ = client
        # A bad path in a bulk request shouldn't fail the whole call —
        # the UI gets back "no cached info for this file" instead of an
        # error that hides which file was bad.
        r = c.post(
            "/api/files/load-cached-metadata",
            json={"paths": ["../escape"], "root": "downloads"},
        )
        assert r.status_code == 200
        assert r.json() == {"items": [{"path": "../escape"}]}

    def test_library_root_resolves_via_same_post_id_cache(self, client):
        c, download, library = client
        # The sidecar always lives under DOWNLOAD_PATH/.patreon-dl/, even
        # for files that have since been moved to LIBRARY_PATH — as long
        # as the destination folder name still carries the post_id.
        _write_sidecar(
            download,
            "solar",
            "12345",
            title="Cached Title",
            artist="Solar Girl",
        )
        moved_dir = library / "Solar Girl" / "12345 - Cached Title"
        moved_dir.mkdir(parents=True)
        (moved_dir / "song.mp3").write_bytes(b"fake audio")
        rel = "Solar Girl/12345 - Cached Title/song.mp3"
        r = c.post(
            "/api/files/load-cached-metadata",
            json={"paths": [rel], "root": "library"},
        )
        assert r.status_code == 200
        assert r.json()["items"][0]["title"] == "Cached Title"

    def test_empty_paths_list_returns_empty_items(self, client):
        c, _, _ = client
        r = c.post(
            "/api/files/load-cached-metadata",
            json={"paths": [], "root": "downloads"},
        )
        assert r.status_code == 200
        assert r.json() == {"items": []}


# ── /api/files/load-current-metadata ────────────────────────────────────────


class TestLoadCurrentMetadata:
    """Round-trips ID3 tags from disk for the BulkEditSheet's auto-load on
    open. Empty fields for files that don't exist, aren't tag-compatible,
    or have no tag header — never errors, since one bad file shouldn't
    block the rest of a selection."""

    def test_reads_tags_from_existing_file(self, monkeypatch, tmp_path):
        from fastapi.testclient import TestClient

        from backend import main

        library = tmp_path / "library"
        library.mkdir()
        monkeypatch.setattr(main, "DOWNLOAD_PATH", tmp_path / "downloads")
        monkeypatch.setattr(main, "LIBRARY_PATH", library)
        (library / "a.mp3").write_bytes(b"")
        main._write_metadata(library / "a.mp3", "Sleepy", "Solar Girl", "Whispers", "Solar Girl")
        c = TestClient(main.app)
        r = c.post(
            "/api/files/load-current-metadata",
            json={"paths": ["a.mp3"], "root": "library"},
        )
        assert r.status_code == 200
        item = r.json()["items"][0]
        assert item["title"] == "Sleepy"
        assert item["artist"] == "Solar Girl"
        assert item["album"] == "Whispers"
        assert item["album_artist"] == "Solar Girl"

    def test_empty_fields_for_untagged_file(self, client):
        c, _, library = client
        _stage_mp3(library, "fresh.mp3")
        r = c.post(
            "/api/files/load-current-metadata",
            json={"paths": ["fresh.mp3"], "root": "library"},
        )
        assert r.status_code == 200
        assert r.json()["items"][0] == {
            "path": "fresh.mp3",
            "title": "",
            "artist": "",
            "album": "",
            "album_artist": "",
        }

    def test_empty_for_missing_file(self, client):
        c, _, _ = client
        r = c.post(
            "/api/files/load-current-metadata",
            json={"paths": ["ghost.mp3"], "root": "library"},
        )
        assert r.status_code == 200
        assert r.json()["items"][0]["title"] == ""

    def test_empty_for_non_metadata_extension(self, client):
        c, _, library = client
        (library / "track.wav").write_bytes(b"")
        r = c.post(
            "/api/files/load-current-metadata",
            json={"paths": ["track.wav"], "root": "library"},
        )
        assert r.status_code == 200
        item = r.json()["items"][0]
        # Empty across the board — bulk-edit can't tag this format anyway.
        assert item["title"] == ""

    def test_traversal_paths_drop_to_empty_entry(self, client):
        # Same defence-in-depth as load-cached-metadata: a bad path is
        # an empty entry, not a 400 that blocks the whole batch.
        c, _, _ = client
        r = c.post(
            "/api/files/load-current-metadata",
            json={"paths": ["../escape.mp3"], "root": "library"},
        )
        assert r.status_code == 200
        assert r.json()["items"][0]["title"] == ""


# ── /api/files/bulk-write ───────────────────────────────────────────────────


def _stage_mp3(root: Path, rel: str) -> str:
    """Create an empty .mp3 at `root/rel`. Mutagen's ID3 writer handles
    headerless files (ID3NoHeaderError → fresh ID3 object → save prepends
    the tag block), so an empty file is a valid blank-canvas fixture for
    metadata writes."""
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"")
    return rel


def _read_id3(path: Path) -> dict[str, str]:
    """Read TIT2/TPE1/TPE2/TALB back as a flat dict for assertion."""
    try:
        tags = ID3(str(path))
    except ID3NoHeaderError:
        return {}
    out: dict[str, str] = {}
    for tag_id in ("TIT2", "TPE1", "TPE2", "TALB"):
        frame = tags.get(tag_id)
        if frame is not None:
            out[tag_id] = str(frame.text[0]) if frame.text else ""
    return out


class TestBulkWriteValidation:
    """Phase 1 — validation aborts the entire batch on the first failed item.
    Disk state must be unchanged regardless of which item failed.
    """

    def test_aborts_batch_on_missing_file(self, client):
        c, _, library = client
        rel_a = _stage_mp3(library, "a.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel_a, "title": "New A"}, {"path": "ghost.mp3"}],
                "shared": {},
                "rename": False,
                "root": "library",
            },
        )
        assert r.status_code == 422
        results = r.json()["detail"]["results"]
        # Each item shows up exactly once; the failing one carries the
        # actual error; the would-have-been-fine one carries 'Aborted'.
        by_path = {row["path"]: row for row in results}
        assert by_path["ghost.mp3"]["error"] == "File not found."
        assert by_path[rel_a]["error"].startswith("Aborted")
        # No write happened — the existing file's ID3 block is still empty.
        assert _read_id3(library / rel_a) == {}

    def test_aborts_on_non_metadata_extension(self, client):
        c, _, library = client
        rel = "track.wav"
        (library / rel).write_bytes(b"")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel, "title": "X"}],
                "shared": {},
                "rename": False,
                "root": "library",
            },
        )
        assert r.status_code == 422
        results = r.json()["detail"]["results"]
        assert "Cannot tag .wav" in results[0]["error"]

    def test_aborts_on_path_traversal(self, client):
        c, _, library = client
        _stage_mp3(library, "a.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": "../escape.mp3", "title": "X"}],
                "shared": {},
                "rename": False,
                "root": "library",
            },
        )
        assert r.status_code == 422

    def test_rename_to_invalid_name_aborts(self, client):
        c, _, library = client
        rel = _stage_mp3(library, "a.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel, "new_name": "a/b.mp3"}],
                "shared": {},
                "rename": True,
                "root": "library",
            },
        )
        assert r.status_code == 422
        assert (library / "a.mp3").exists()

    def test_rename_to_existing_name_aborts(self, client):
        c, _, library = client
        rel_a = _stage_mp3(library, "a.mp3")
        _stage_mp3(library, "b.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel_a, "new_name": "b.mp3"}],
                "shared": {},
                "rename": True,
                "root": "library",
            },
        )
        assert r.status_code == 422
        assert (library / "a.mp3").exists()
        assert (library / "b.mp3").exists()

    def test_within_batch_dest_collision_aborts(self, client):
        c, _, library = client
        # Two items in the same batch both rename to the same new name.
        # Without the within-batch dedupe in phase 1, this would surface
        # as an order-dependent collision in phase 2.
        rel_a = _stage_mp3(library, "a.mp3")
        rel_b = _stage_mp3(library, "b.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [
                    {"path": rel_a, "new_name": "same.mp3"},
                    {"path": rel_b, "new_name": "same.mp3"},
                ],
                "shared": {},
                "rename": True,
                "root": "library",
            },
        )
        assert r.status_code == 422
        assert (library / "a.mp3").exists()
        assert (library / "b.mp3").exists()

    def test_clear_with_unknown_field_is_400_not_per_item(self, client):
        c, _, library = client
        rel = _stage_mp3(library, "a.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel}],
                "shared": {"clear": ["genre"]},
                "rename": False,
                "root": "library",
            },
        )
        # clear[] validation is a request-shape error, not a per-item one.
        assert r.status_code == 400


class TestBulkWriteCommit:
    """Phase 2 — once validation passes, writes actually hit disk."""

    def test_writes_per_file_title_to_id3(self, client):
        c, _, library = client
        rel = _stage_mp3(library, "a.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel, "title": "Sleepy whisper"}],
                "shared": {},
                "rename": False,
                "root": "library",
            },
        )
        assert r.status_code == 200, r.json()
        assert r.json() == {"ok": True, "results": [{"path": rel, "ok": True}]}
        assert _read_id3(library / rel)["TIT2"] == "Sleepy whisper"

    def test_writes_shared_fields_to_every_item(self, client):
        c, _, library = client
        rel_a = _stage_mp3(library, "a.mp3")
        rel_b = _stage_mp3(library, "b.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [
                    {"path": rel_a, "title": "A"},
                    {"path": rel_b, "title": "B"},
                ],
                "shared": {
                    "artist": "Solar Girl",
                    "album": "Whispers",
                    "album_artist": "Solar Girl",
                },
                "rename": False,
                "root": "library",
            },
        )
        assert r.status_code == 200
        for rel in (rel_a, rel_b):
            tags = _read_id3(library / rel)
            assert tags["TPE1"] == "Solar Girl"
            assert tags["TALB"] == "Whispers"
            assert tags["TPE2"] == "Solar Girl"

    def test_empty_per_file_title_keeps_existing(self, client):
        c, _, library = client
        rel = _stage_mp3(library, "a.mp3")
        # Pre-seed an existing TIT2 so we can prove the empty-title call
        # didn't overwrite it.
        from backend.main import _write_metadata

        _write_metadata(library / rel, "Existing title", "", "", "")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel, "title": ""}],
                "shared": {"artist": "Solar Girl"},
                "rename": False,
                "root": "library",
            },
        )
        assert r.status_code == 200
        tags = _read_id3(library / rel)
        assert tags["TIT2"] == "Existing title"
        assert tags["TPE1"] == "Solar Girl"

    def test_shared_clear_removes_tag_frames(self, client):
        c, _, library = client
        rel = _stage_mp3(library, "a.mp3")
        from backend.main import _write_metadata

        _write_metadata(library / rel, "T", "Old artist", "Old album", "Old albumartist")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel}],
                "shared": {"clear": ["artist", "album_artist"]},
                "rename": False,
                "root": "library",
            },
        )
        assert r.status_code == 200
        tags = _read_id3(library / rel)
        assert "TPE1" not in tags
        assert "TPE2" not in tags
        # Untouched fields survive.
        assert tags["TIT2"] == "T"
        assert tags["TALB"] == "Old album"

    def test_renames_and_writes_metadata_in_one_call(self, client):
        c, _, library = client
        rel = _stage_mp3(library, "Solar Girl/raw-1.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [
                    {
                        "path": rel,
                        "title": "Sleepy whisper",
                        "new_name": "Sleepy whisper - F4A.mp3",
                    },
                ],
                "shared": {"artist": "Solar Girl"},
                "rename": True,
                "root": "library",
            },
        )
        assert r.status_code == 200
        assert r.json()["results"][0]["new_path"] == "Solar Girl/Sleepy whisper - F4A.mp3"
        assert not (library / rel).exists()
        dest = library / "Solar Girl" / "Sleepy whisper - F4A.mp3"
        assert dest.exists()
        tags = _read_id3(dest)
        assert tags["TIT2"] == "Sleepy whisper"
        assert tags["TPE1"] == "Solar Girl"

    def test_rename_false_keeps_file_in_place(self, client):
        c, _, library = client
        rel = _stage_mp3(library, "a.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel, "title": "T", "new_name": "should-be-ignored.mp3"}],
                "shared": {},
                "rename": False,
                "root": "library",
            },
        )
        assert r.status_code == 200
        assert (library / rel).exists()
        assert not (library / "should-be-ignored.mp3").exists()
        assert "new_path" not in r.json()["results"][0]

    def test_new_name_equal_to_current_skips_rename(self, client):
        c, _, library = client
        rel = _stage_mp3(library, "a.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel, "title": "T", "new_name": "a.mp3"}],
                "shared": {},
                "rename": True,
                "root": "library",
            },
        )
        assert r.status_code == 200
        # Same name → no rename happened, no new_path in the response.
        assert "new_path" not in r.json()["results"][0]
        assert (library / rel).exists()

    def test_empty_items_list_returns_empty_results(self, client):
        c, _, _ = client
        r = c.patch(
            "/api/files/bulk-write",
            json={"items": [], "shared": {}, "rename": False, "root": "library"},
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True, "results": []}


class TestBulkWriteMove:
    """The optional `to_subdir` field — moves each (post-rename) file into
    LIBRARY_PATH/<to_subdir>/. Gated to root=='downloads' because
    library-to-library moves stay on /api/move."""

    def test_moves_file_into_library_subfolder(self, client):
        c, download, library = client
        rel = "Solar Girl/raw-1.mp3"
        (download / "Solar Girl").mkdir()
        (download / rel).write_bytes(b"")
        (library / "Solar Girl").mkdir()
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel}],
                "shared": {"artist": "Solar Girl"},
                "rename": False,
                "root": "downloads",
                "to_subdir": "Solar Girl",
            },
        )
        assert r.status_code == 200, r.json()
        result = r.json()["results"][0]
        assert result["ok"] is True
        assert result["new_path"] == "Solar Girl/raw-1.mp3"
        assert result["new_root"] == "library"
        # Source gone, dest landed.
        assert not (download / rel).exists()
        assert (library / "Solar Girl" / "raw-1.mp3").exists()
        # Metadata write still applied to the moved file.
        assert _read_id3(library / "Solar Girl" / "raw-1.mp3")["TPE1"] == "Solar Girl"

    def test_renames_then_moves_in_one_call(self, client):
        c, download, library = client
        rel = "Solar Girl/raw-1.mp3"
        (download / "Solar Girl").mkdir()
        (download / rel).write_bytes(b"")
        (library / "Whispers").mkdir()
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [
                    {
                        "path": rel,
                        "title": "Sleepy",
                        "new_name": "Sleepy - F4A.mp3",
                    },
                ],
                "shared": {"artist": "Solar Girl"},
                "rename": True,
                "root": "downloads",
                "to_subdir": "Whispers",
            },
        )
        assert r.status_code == 200, r.json()
        result = r.json()["results"][0]
        assert result["new_path"] == "Whispers/Sleepy - F4A.mp3"
        assert result["new_root"] == "library"
        assert (library / "Whispers" / "Sleepy - F4A.mp3").exists()
        # Source's parent stays around (we don't prune empty post folders).
        assert not (download / rel).exists()

    def test_rejects_to_subdir_when_root_is_library(self, client):
        c, _, library = client
        rel = _stage_mp3(library, "a.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel}],
                "shared": {"artist": "X"},
                "rename": False,
                "root": "library",
                "to_subdir": "Whispers",
            },
        )
        # 400 — this is a request-shape error, not a per-item one. The
        # /api/move endpoint handles library→library directly; bulk-write
        # only opens the move door for the downloads→library workflow.
        assert r.status_code == 400

    def test_collision_at_destination_aborts_batch(self, client):
        c, download, library = client
        rel = "Solar Girl/raw-1.mp3"
        (download / "Solar Girl").mkdir()
        (download / rel).write_bytes(b"")
        (library / "Solar Girl").mkdir()
        # A file with the same name already sits at the destination.
        (library / "Solar Girl" / "raw-1.mp3").write_bytes(b"existing")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel}],
                "shared": {},
                "rename": False,
                "root": "downloads",
                "to_subdir": "Solar Girl",
            },
        )
        assert r.status_code == 422
        # Source untouched, existing dest untouched.
        assert (download / rel).exists()
        assert (library / "Solar Girl" / "raw-1.mp3").read_bytes() == b"existing"

    def test_within_batch_move_collision_aborts(self, client):
        c, download, library = client
        # Two source files in different parent dirs but with the SAME
        # filename — without the move-dest dedupe they'd both try to
        # land at library/Whispers/raw.mp3.
        (download / "post-a").mkdir()
        (download / "post-a" / "raw.mp3").write_bytes(b"")
        (download / "post-b").mkdir()
        (download / "post-b" / "raw.mp3").write_bytes(b"")
        (library / "Whispers").mkdir()
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [
                    {"path": "post-a/raw.mp3"},
                    {"path": "post-b/raw.mp3"},
                ],
                "shared": {},
                "rename": False,
                "root": "downloads",
                "to_subdir": "Whispers",
            },
        )
        assert r.status_code == 422
        # Neither file moved.
        assert (download / "post-a" / "raw.mp3").exists()
        assert (download / "post-b" / "raw.mp3").exists()
        assert not (library / "Whispers" / "raw.mp3").exists()

    def test_missing_destination_folder_returns_404(self, client):
        c, download, _ = client
        rel = "Solar Girl/raw-1.mp3"
        (download / "Solar Girl").mkdir()
        (download / rel).write_bytes(b"")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel}],
                "shared": {},
                "rename": False,
                "root": "downloads",
                "to_subdir": "Does Not Exist",
            },
        )
        assert r.status_code == 404

    def test_empty_to_subdir_is_no_move(self, client):
        # Equivalent to omitting the field — useful so the frontend can
        # send "" without conditionalising the payload.
        c, _, library = client
        rel = _stage_mp3(library, "a.mp3")
        r = c.patch(
            "/api/files/bulk-write",
            json={
                "items": [{"path": rel, "title": "T"}],
                "shared": {},
                "rename": False,
                "root": "library",
                "to_subdir": "",
            },
        )
        assert r.status_code == 200
        result = r.json()["results"][0]
        assert "new_root" not in result
        assert _read_id3(library / rel)["TIT2"] == "T"
