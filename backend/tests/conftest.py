"""Shared pytest fixtures for the backend test suite.

`backend.main` reads `DOWNLOAD_PATH` and `LIBRARY_PATH` at module import (the
`_require_env_path` helper raises if either is missing). Tests that import
the FastAPI app need both set before the import runs — this fixture provides
session-wide tmp baselines so the import succeeds. Tests that need fresh
isolated paths monkeypatch `backend.main.DOWNLOAD_PATH` and
`backend.main.LIBRARY_PATH` to their own tmp_path subdirs (see
`test_file_ops.py` for the pattern).
"""

import os
import tempfile

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session", autouse=True)
def _baseline_env_paths():
    with tempfile.TemporaryDirectory() as dl, tempfile.TemporaryDirectory() as lib:
        os.environ.setdefault("DOWNLOAD_PATH", dl)
        os.environ.setdefault("LIBRARY_PATH", lib)
        yield


@pytest.fixture
def client(monkeypatch, tmp_path):
    """TestClient wired against fresh DOWNLOAD_PATH + LIBRARY_PATH dirs.
    Returns (client, download_path, library_path) so tests can stage files
    on disk and assert post-write layout.
    """
    download = tmp_path / "downloads"
    library = tmp_path / "library"
    download.mkdir()
    library.mkdir()
    from backend import main

    monkeypatch.setattr(main, "DOWNLOAD_PATH", download)
    monkeypatch.setattr(main, "LIBRARY_PATH", library)
    return TestClient(main.app), download, library
