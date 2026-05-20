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


@pytest.fixture(scope="session", autouse=True)
def _baseline_env_paths():
    with tempfile.TemporaryDirectory() as dl, tempfile.TemporaryDirectory() as lib:
        os.environ.setdefault("DOWNLOAD_PATH", dl)
        os.environ.setdefault("LIBRARY_PATH", lib)
        yield
