"""Tests for /api/mkdir and /api/move — the file-organization endpoints
that power the move-to-library flow.

Each test gets fresh DOWNLOAD_PATH and LIBRARY_PATH dirs via monkeypatch on
the module-level constants. The `client` fixture also returns the two paths
so tests can stage files on disk directly and assert post-move layout.
"""
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


# ── /api/mkdir ─────────────────────────────────────────────────────────────


class TestMkdir:
    def test_creates_subfolder_at_root(self, client):
        c, _, library = client
        r = c.post("/api/mkdir", json={"subdir": "Test Artist"})
        assert r.status_code == 201
        assert r.json()["path"] == "Test Artist"
        assert (library / "Test Artist").is_dir()

    def test_creates_nested_subfolder(self, client):
        c, _, library = client
        (library / "Test Artist").mkdir()
        r = c.post(
            "/api/mkdir",
            json={"subdir": "Sleepy", "parent": "Test Artist"},
        )
        assert r.status_code == 201
        assert r.json()["path"] == "Test Artist/Sleepy"
        assert (library / "Test Artist" / "Sleepy").is_dir()

    def test_rejects_traversal_in_name(self, client):
        c, _, _ = client
        r = c.post("/api/mkdir", json={"subdir": "../escape"})
        assert r.status_code == 400

    def test_rejects_slash_in_name(self, client):
        c, _, _ = client
        r = c.post("/api/mkdir", json={"subdir": "a/b"})
        assert r.status_code == 400

    def test_rejects_dot_prefix(self, client):
        c, _, _ = client
        r = c.post("/api/mkdir", json={"subdir": ".hidden"})
        assert r.status_code == 400

    def test_returns_409_on_collision(self, client):
        c, _, library = client
        (library / "Test Artist").mkdir()
        r = c.post("/api/mkdir", json={"subdir": "Test Artist"})
        assert r.status_code == 409


# ── /api/move ──────────────────────────────────────────────────────────────


def _stage(download: Path, library: Path) -> Path:
    """Put a fake audio file at downloads/post123/song.mp3 and pre-create
    a 'Test Artist' destination subfolder in the library. Returns the source
    path so tests can assert it disappears after a move."""
    (download / "post123").mkdir()
    src = download / "post123" / "song.mp3"
    src.write_bytes(b"fake mp3 bytes")
    (library / "Test Artist").mkdir()
    return src


class TestMove:
    def test_moves_file_to_library_subfolder(self, client):
        c, download, library = client
        _stage(download, library)
        r = c.post(
            "/api/move",
            json={
                "from_path": "post123/song.mp3",
                "from_root": "downloads",
                "to_subdir": "Test Artist",
            },
        )
        assert r.status_code == 200, r.json()
        assert r.json()["to_path"] == "Test Artist/song.mp3"
        assert not (download / "post123" / "song.mp3").exists()
        assert (library / "Test Artist" / "song.mp3").exists()

    def test_renames_during_move(self, client):
        c, download, library = client
        _stage(download, library)
        r = c.post(
            "/api/move",
            json={
                "from_path": "post123/song.mp3",
                "from_root": "downloads",
                "to_subdir": "Test Artist",
                "new_name": "Soft Whispers.mp3",
            },
        )
        assert r.status_code == 200
        assert (library / "Test Artist" / "Soft Whispers.mp3").exists()
        assert not (library / "Test Artist" / "song.mp3").exists()

    def test_moves_to_library_root_when_subdir_empty(self, client):
        c, download, library = client
        _stage(download, library)
        r = c.post(
            "/api/move",
            json={
                "from_path": "post123/song.mp3",
                "from_root": "downloads",
                "to_subdir": "",
            },
        )
        assert r.status_code == 200
        assert (library / "song.mp3").exists()

    def test_rejects_traversal_in_to_subdir(self, client):
        c, download, library = client
        _stage(download, library)
        r = c.post(
            "/api/move",
            json={
                "from_path": "post123/song.mp3",
                "from_root": "downloads",
                "to_subdir": "../escape",
            },
        )
        # Traversal is caught by validate_under_library (403) or by the
        # missing-folder check (404) depending on whether `..` resolves
        # inside the library. The contract is "don't move", which either
        # status proves.
        assert r.status_code in (400, 403, 404)
        assert (download / "post123" / "song.mp3").exists()

    def test_rejects_unknown_root(self, client):
        c, download, library = client
        _stage(download, library)
        r = c.post(
            "/api/move",
            json={
                "from_path": "post123/song.mp3",
                "from_root": "elsewhere",
                "to_subdir": "Test Artist",
            },
        )
        assert r.status_code == 400

    def test_returns_409_on_filename_collision(self, client):
        c, download, library = client
        _stage(download, library)
        (library / "Test Artist" / "song.mp3").write_bytes(b"existing")
        r = c.post(
            "/api/move",
            json={
                "from_path": "post123/song.mp3",
                "from_root": "downloads",
                "to_subdir": "Test Artist",
            },
        )
        assert r.status_code == 409
        # Source still on disk — no overwrite, no delete.
        assert (download / "post123" / "song.mp3").exists()
        # Existing destination file untouched.
        assert (library / "Test Artist" / "song.mp3").read_bytes() == b"existing"

    def test_returns_404_when_destination_folder_missing(self, client):
        c, download, library = client
        _stage(download, library)
        r = c.post(
            "/api/move",
            json={
                "from_path": "post123/song.mp3",
                "from_root": "downloads",
                "to_subdir": "Nonexistent",
            },
        )
        assert r.status_code == 404

    def test_rejects_slash_in_new_name(self, client):
        c, download, library = client
        _stage(download, library)
        r = c.post(
            "/api/move",
            json={
                "from_path": "post123/song.mp3",
                "from_root": "downloads",
                "to_subdir": "Test Artist",
                "new_name": "evil/name.mp3",
            },
        )
        assert r.status_code == 400

    def test_moves_folder_to_library_subfolder(self, client):
        c, _, library = client
        # A whole subtree under library: Sleepy/song1.mp3 + Sleepy/inner/song2.mp3
        (library / "Test Artist").mkdir()
        (library / "Sleepy").mkdir()
        (library / "Sleepy" / "song1.mp3").write_bytes(b"a")
        (library / "Sleepy" / "inner").mkdir()
        (library / "Sleepy" / "inner" / "song2.mp3").write_bytes(b"b")
        r = c.post(
            "/api/move",
            json={
                "from_path": "Sleepy",
                "from_root": "library",
                "to_subdir": "Test Artist",
            },
        )
        assert r.status_code == 200, r.json()
        assert r.json()["to_path"] == "Test Artist/Sleepy"
        assert not (library / "Sleepy").exists()
        assert (library / "Test Artist" / "Sleepy" / "song1.mp3").read_bytes() == b"a"
        assert (library / "Test Artist" / "Sleepy" / "inner" / "song2.mp3").read_bytes() == b"b"

    def test_rejects_moving_folder_into_itself(self, client):
        c, _, library = client
        (library / "A").mkdir()
        (library / "A" / "B").mkdir()
        r = c.post(
            "/api/move",
            json={
                "from_path": "A",
                "from_root": "library",
                "to_subdir": "A/B",  # destination is inside the source — cycle
            },
        )
        assert r.status_code == 400
        assert (library / "A" / "B").is_dir()  # untouched

    def test_returns_409_on_folder_name_collision(self, client):
        c, _, library = client
        (library / "Test Artist").mkdir()
        (library / "Test Artist" / "Sleepy").mkdir()  # destination already has Sleepy
        (library / "Sleepy").mkdir()
        (library / "Sleepy" / "song.mp3").write_bytes(b"a")
        r = c.post(
            "/api/move",
            json={
                "from_path": "Sleepy",
                "from_root": "library",
                "to_subdir": "Test Artist",
            },
        )
        assert r.status_code == 409
        # Source still on disk — no overwrite, no delete.
        assert (library / "Sleepy" / "song.mp3").exists()


# ── /api/move/batch ────────────────────────────────────────────────────────


class TestMoveBatch:
    def test_moves_multiple_files(self, client):
        c, download, library = client
        (download / "post").mkdir()
        (download / "post" / "a.mp3").write_bytes(b"a")
        (download / "post" / "b.mp3").write_bytes(b"b")
        (library / "Test Artist").mkdir()
        r = c.post(
            "/api/move/batch",
            json={
                "items": [
                    {"from_path": "post/a.mp3"},
                    {"from_path": "post/b.mp3"},
                ],
                "from_root": "downloads",
                "to_subdir": "Test Artist",
            },
        )
        assert r.status_code == 200, r.json()
        body = r.json()
        assert body["moved"] == 2
        assert all(item["ok"] for item in body["results"])
        assert (library / "Test Artist" / "a.mp3").read_bytes() == b"a"
        assert (library / "Test Artist" / "b.mp3").read_bytes() == b"b"

    def test_partial_success_on_collision(self, client):
        c, download, library = client
        (download / "post").mkdir()
        (download / "post" / "a.mp3").write_bytes(b"a")
        (download / "post" / "dup.mp3").write_bytes(b"new")
        (library / "Test Artist").mkdir()
        # Pre-existing file in the destination causes a collision for `dup.mp3` only.
        (library / "Test Artist" / "dup.mp3").write_bytes(b"existing")
        r = c.post(
            "/api/move/batch",
            json={
                "items": [
                    {"from_path": "post/a.mp3"},
                    {"from_path": "post/dup.mp3"},
                ],
                "from_root": "downloads",
                "to_subdir": "Test Artist",
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["moved"] == 1
        ok_results = [r for r in body["results"] if r["ok"]]
        fail_results = [r for r in body["results"] if not r["ok"]]
        assert len(ok_results) == 1 and ok_results[0]["from_path"] == "post/a.mp3"
        assert len(fail_results) == 1 and fail_results[0]["from_path"] == "post/dup.mp3"
        assert fail_results[0]["error"]["code"] == "collision"
        # The one that worked actually moved; the one that collided stayed put.
        assert (library / "Test Artist" / "a.mp3").exists()
        assert (library / "Test Artist" / "dup.mp3").read_bytes() == b"existing"
        assert (download / "post" / "dup.mp3").read_bytes() == b"new"

    def test_partial_success_on_cycle(self, client):
        c, _, library = client
        (library / "A").mkdir()
        (library / "A" / "B").mkdir()
        (library / "song.mp3").write_bytes(b"a")
        r = c.post(
            "/api/move/batch",
            json={
                "items": [
                    {"from_path": "A"},          # cycle: A → A/B is inside A
                    {"from_path": "song.mp3"},   # fine: file → A/B
                ],
                "from_root": "library",
                "to_subdir": "A/B",
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["moved"] == 1
        codes = {(r["from_path"], r.get("error", {}).get("code"), r["ok"]) for r in body["results"]}
        assert ("A", "cycle", False) in codes
        assert ("song.mp3", None, True) in codes
        assert (library / "A" / "B" / "song.mp3").exists()

    def test_empty_items_is_noop(self, client):
        c, _, _ = client
        r = c.post(
            "/api/move/batch",
            json={"items": [], "from_root": "library", "to_subdir": ""},
        )
        assert r.status_code == 200
        assert r.json() == {"moved": 0, "results": []}


# ── /api/delete ────────────────────────────────────────────────────────────


class TestDelete:
    def test_deletes_a_file(self, client):
        c, _, library = client
        f = library / "song.mp3"
        f.write_bytes(b"audio")
        r = c.post("/api/delete", json={"path": "song.mp3", "root": "library"})
        assert r.status_code == 200, r.json()
        assert r.json()["kind"] == "file"
        assert not f.exists()

    def test_deletes_an_empty_folder(self, client):
        c, _, library = client
        (library / "Empty").mkdir()
        r = c.post("/api/delete", json={"path": "Empty", "root": "library"})
        assert r.status_code == 200, r.json()
        assert r.json()["kind"] == "folder_empty"
        assert not (library / "Empty").exists()

    def test_409_when_folder_not_empty_and_not_recursive(self, client):
        c, _, library = client
        d = library / "Test Artist"
        d.mkdir()
        (d / "song.mp3").write_bytes(b"audio")
        (d / "Sleepy").mkdir()
        r = c.post(
            "/api/delete",
            json={"path": "Test Artist", "root": "library"},
        )
        assert r.status_code == 409, r.json()
        detail = r.json()["detail"]
        assert detail["count"] >= 2
        assert detail["path"] == "Test Artist"
        # Folder still on disk — no silent recursive delete.
        assert d.exists()
        assert (d / "song.mp3").exists()

    def test_recursive_deletes_non_empty_folder(self, client):
        c, _, library = client
        d = library / "Test Artist"
        d.mkdir()
        (d / "song.mp3").write_bytes(b"audio")
        (d / "Sleepy").mkdir()
        (d / "Sleepy" / "track.mp3").write_bytes(b"more audio")
        r = c.post(
            "/api/delete",
            json={"path": "Test Artist", "root": "library", "recursive": True},
        )
        assert r.status_code == 200, r.json()
        assert r.json()["kind"] == "folder_recursive"
        assert not d.exists()

    def test_refuses_to_delete_root(self, client):
        c, _, _ = client
        for bad in ("", " ", ".", ".."):
            r = c.post("/api/delete", json={"path": bad, "root": "library"})
            assert r.status_code == 400, (bad, r.json())

    def test_rejects_traversal(self, client):
        c, _, _ = client
        r = c.post(
            "/api/delete",
            json={"path": "../escape", "root": "library"},
        )
        assert r.status_code == 403

    def test_404_on_missing_path(self, client):
        c, _, _ = client
        r = c.post(
            "/api/delete",
            json={"path": "ghost-folder", "root": "library"},
        )
        assert r.status_code == 404

    def test_works_on_downloads_root(self, client):
        c, download, _ = client
        (download / "post999").mkdir()
        r = c.post(
            "/api/delete",
            json={"path": "post999", "root": "downloads"},
        )
        assert r.status_code == 200
        assert not (download / "post999").exists()


# ── /api/rename-path ───────────────────────────────────────────────────────


class TestRenamePath:
    def test_renames_a_folder(self, client):
        c, _, library = client
        (library / "Test Artist").mkdir()
        r = c.post(
            "/api/rename-path",
            json={"path": "Test Artist", "new_name": "Test Artist ASMR"},
        )
        assert r.status_code == 200, r.json()
        assert r.json()["kind"] == "folder"
        assert r.json()["path"] == "Test Artist ASMR"
        assert (library / "Test Artist ASMR").is_dir()
        assert not (library / "Test Artist").exists()

    def test_renames_a_nested_folder(self, client):
        c, _, library = client
        (library / "Test Artist" / "Sleepy").mkdir(parents=True)
        r = c.post(
            "/api/rename-path",
            json={"path": "Test Artist/Sleepy", "new_name": "Bedtime"},
        )
        assert r.status_code == 200, r.json()
        assert r.json()["path"] == "Test Artist/Bedtime"
        assert (library / "Test Artist" / "Bedtime").is_dir()

    def test_renames_a_file(self, client):
        c, _, library = client
        (library / "old.mp3").write_bytes(b"audio")
        r = c.post(
            "/api/rename-path",
            json={"path": "old.mp3", "new_name": "new.mp3"},
        )
        assert r.status_code == 200, r.json()
        assert r.json()["kind"] == "file"
        assert (library / "new.mp3").exists()
        assert not (library / "old.mp3").exists()

    def test_renames_a_non_metadata_compatible_file(self, client):
        # /api/rename rejects .wav (no metadata-embed support); this
        # endpoint should accept it because there's no metadata step.
        c, _, library = client
        (library / "rec.wav").write_bytes(b"wave")
        r = c.post(
            "/api/rename-path",
            json={"path": "rec.wav", "new_name": "session.wav"},
        )
        assert r.status_code == 200, r.json()
        assert (library / "session.wav").exists()

    def test_refuses_root(self, client):
        c, _, _ = client
        for bad in ("", " ", ".", ".."):
            r = c.post(
                "/api/rename-path",
                json={"path": bad, "new_name": "whatever"},
            )
            assert r.status_code == 400, (bad, r.json())

    def test_404_on_missing(self, client):
        c, _, _ = client
        r = c.post(
            "/api/rename-path",
            json={"path": "ghost", "new_name": "found"},
        )
        assert r.status_code == 404

    def test_rejects_slash_in_new_name(self, client):
        c, _, library = client
        (library / "thing").mkdir()
        r = c.post(
            "/api/rename-path",
            json={"path": "thing", "new_name": "a/b"},
        )
        assert r.status_code == 400

    def test_rejects_dot_prefix(self, client):
        c, _, library = client
        (library / "thing").mkdir()
        r = c.post(
            "/api/rename-path",
            json={"path": "thing", "new_name": ".hidden"},
        )
        assert r.status_code == 400

    def test_409_on_collision(self, client):
        c, _, library = client
        (library / "a").mkdir()
        (library / "b").mkdir()
        r = c.post(
            "/api/rename-path",
            json={"path": "a", "new_name": "b"},
        )
        assert r.status_code == 409
        # Both directories still on disk.
        assert (library / "a").is_dir()
        assert (library / "b").is_dir()

    def test_noop_when_name_unchanged(self, client):
        c, _, library = client
        (library / "x").mkdir()
        r = c.post(
            "/api/rename-path",
            json={"path": "x", "new_name": "x"},
        )
        assert r.status_code == 200
        assert r.json()["renamed"] is False
        assert (library / "x").is_dir()

    def test_rejects_traversal(self, client):
        c, _, _ = client
        r = c.post(
            "/api/rename-path",
            json={"path": "../escape", "new_name": "x"},
        )
        assert r.status_code == 403
