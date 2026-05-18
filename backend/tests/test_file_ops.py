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
        r = c.post("/api/mkdir", json={"subdir": "Solar Girl"})
        assert r.status_code == 201
        assert r.json()["path"] == "Solar Girl"
        assert (library / "Solar Girl").is_dir()

    def test_creates_nested_subfolder(self, client):
        c, _, library = client
        (library / "Solar Girl").mkdir()
        r = c.post(
            "/api/mkdir",
            json={"subdir": "Sleepy", "parent": "Solar Girl"},
        )
        assert r.status_code == 201
        assert r.json()["path"] == "Solar Girl/Sleepy"
        assert (library / "Solar Girl" / "Sleepy").is_dir()

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
        (library / "Solar Girl").mkdir()
        r = c.post("/api/mkdir", json={"subdir": "Solar Girl"})
        assert r.status_code == 409


# ── /api/move ──────────────────────────────────────────────────────────────


def _stage(download: Path, library: Path) -> Path:
    """Put a fake audio file at downloads/post123/song.mp3 and pre-create
    a 'Solar Girl' destination subfolder in the library. Returns the source
    path so tests can assert it disappears after a move."""
    (download / "post123").mkdir()
    src = download / "post123" / "song.mp3"
    src.write_bytes(b"fake mp3 bytes")
    (library / "Solar Girl").mkdir()
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
                "to_subdir": "Solar Girl",
            },
        )
        assert r.status_code == 200, r.json()
        assert r.json()["to_path"] == "Solar Girl/song.mp3"
        assert not (download / "post123" / "song.mp3").exists()
        assert (library / "Solar Girl" / "song.mp3").exists()

    def test_renames_during_move(self, client):
        c, download, library = client
        _stage(download, library)
        r = c.post(
            "/api/move",
            json={
                "from_path": "post123/song.mp3",
                "from_root": "downloads",
                "to_subdir": "Solar Girl",
                "new_name": "Soft Whispers.mp3",
            },
        )
        assert r.status_code == 200
        assert (library / "Solar Girl" / "Soft Whispers.mp3").exists()
        assert not (library / "Solar Girl" / "song.mp3").exists()

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
                "to_subdir": "Solar Girl",
            },
        )
        assert r.status_code == 400

    def test_returns_409_on_filename_collision(self, client):
        c, download, library = client
        _stage(download, library)
        (library / "Solar Girl" / "song.mp3").write_bytes(b"existing")
        r = c.post(
            "/api/move",
            json={
                "from_path": "post123/song.mp3",
                "from_root": "downloads",
                "to_subdir": "Solar Girl",
            },
        )
        assert r.status_code == 409
        # Source still on disk — no overwrite, no delete.
        assert (download / "post123" / "song.mp3").exists()
        # Existing destination file untouched.
        assert (library / "Solar Girl" / "song.mp3").read_bytes() == b"existing"

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
                "to_subdir": "Solar Girl",
                "new_name": "evil/name.mp3",
            },
        )
        assert r.status_code == 400
