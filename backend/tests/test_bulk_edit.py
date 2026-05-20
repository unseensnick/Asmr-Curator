"""Tests for the bulk-edit endpoints under /api/files/*.

Phase 1 covers POST /api/files/load-cached-metadata — the per-file metadata
lookup the BulkEditSheet calls to pre-fill title / artist / tags from cached
patreon-dl sidecars.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


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
