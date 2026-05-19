"""Tests for backend.database — pure helper + DB CRUD roundtrips.

`init_db()` runs at import time, so each test uses `monkeypatch.setenv` +
`importlib.reload` to drive the module against a temp `DB_PATH`. The
`_default_db_path()` helper is tested separately by patching `os.name`.
"""
import importlib
import os
from pathlib import Path

import pytest


# ── _default_db_path ───────────────────────────────────────────────────────


class TestDefaultDbPath:
    # Note on test isolation: `importlib.reload(database)` re-runs the module
    # body, which calls `init_db()` at the bottom of database.py — that
    # `os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)` would otherwise
    # try to create `/data` on Linux (PermissionError on CI runners without
    # sudo) or `<repo>/data/` on Windows (pollutes the working tree). Setting
    # `DB_PATH` to a tmp path before the reload neutralises init_db so it
    # creates a tmp dir instead. We assert against `_default_db_path()`'s
    # return value directly — it's independent of the `DB_PATH` env var.

    def test_linux_returns_posix_path(self, monkeypatch, tmp_path):
        # On Linux / macOS / inside Docker, the default stays
        # `/data/dictionary.db` (Docker compose bind-mounts /data;
        # devcontainer overrides DB_PATH explicitly).
        monkeypatch.setattr(os, "name", "posix")
        monkeypatch.setenv("DB_PATH", str(tmp_path / "neutral.db"))
        import backend.database as database
        importlib.reload(database)
        assert database._default_db_path() == "/data/dictionary.db"

    @pytest.mark.skipif(
        os.name != "nt",
        reason=(
            "Test exercises the Windows branch of _default_db_path, which "
            "calls Path(__file__).resolve(). Monkeypatching os.name='nt' on a "
            "POSIX interpreter makes pathlib try to instantiate WindowsPath, "
            "which it refuses to do on Linux/macOS (NotImplementedError). "
            "Run on a Windows runner to exercise this branch."
        ),
    )
    def test_windows_returns_repo_relative_path(self, monkeypatch, tmp_path):
        # On Windows, a host-side `uvicorn backend.main:app` previously
        # silently created `E:\data\dictionary.db` (POSIX `/data/...`
        # resolved against the current drive root). The Windows fallback
        # must point inside the repo instead.
        monkeypatch.setenv("DB_PATH", str(tmp_path / "neutral.db"))
        import backend.database as database
        importlib.reload(database)
        result = database._default_db_path()
        assert result.endswith(r"data\dictionary.db") or result.endswith("data/dictionary.db")
        assert "data" in result
        assert "dictionary.db" in result


# ── DB_PATH env-var override ───────────────────────────────────────────────


class TestDbPathEnvOverride:
    def test_env_var_overrides_default(self, monkeypatch, tmp_path: Path):
        custom_db = tmp_path / "custom.db"
        monkeypatch.setenv("DB_PATH", str(custom_db))
        import backend.database as database
        importlib.reload(database)
        assert database.DB_PATH == str(custom_db)


# ── settings CRUD ──────────────────────────────────────────────────────────


@pytest.fixture
def db(monkeypatch, tmp_path: Path):
    """Reload the database module against a fresh tmp DB and yield it."""
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DB_PATH", str(db_path))
    import backend.database as database
    importlib.reload(database)
    yield database


class TestSettingsCrud:
    def test_get_setting_returns_none_when_missing(self, db):
        assert db.get_setting("nonexistent_key") is None

    def test_set_and_get_setting_roundtrip(self, db):
        db.set_setting("my_key", "my_value")
        assert db.get_setting("my_key") == "my_value"

    def test_set_setting_upserts_on_conflict(self, db):
        # The ON CONFLICT DO UPDATE clause means a second set overwrites.
        db.set_setting("k", "first")
        db.set_setting("k", "second")
        assert db.get_setting("k") == "second"

    def test_delete_setting_returns_true_when_deleted(self, db):
        db.set_setting("k", "v")
        assert db.delete_setting("k") is True
        assert db.get_setting("k") is None

    def test_delete_setting_returns_false_when_missing(self, db):
        assert db.delete_setting("never_existed") is False

    def test_setting_value_preserves_unicode(self, db):
        # Patreon cookies, Google cookies, and other settings may contain
        # arbitrary UTF-8. Make sure round-trip is byte-identical.
        value = "naïve 日本語 🎵 emoji+CJK"
        db.set_setting("unicode_test", value)
        assert db.get_setting("unicode_test") == value

    def test_setting_value_preserves_large_json_payload(self, db):
        # Google cookie storage is a JSON-encoded list of cookie objects
        # — can be 5+ KB. Verify SQLite handles the size without issue.
        import json
        cookies = [{"name": f"c{i}", "value": "x" * 200, "domain": ".google.com"} for i in range(50)]
        payload = json.dumps(cookies)
        db.set_setting("big_payload", payload)
        assert db.get_setting("big_payload") == payload


# ── Schema initialisation ──────────────────────────────────────────────────


class TestInitDb:
    def test_init_db_creates_settings_table(self, db):
        # Module import already ran init_db; just verify the table exists.
        with db.get_conn() as conn:
            tables = [
                row["name"]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            ]
        assert "settings" in tables

    def test_init_db_seeds_default_vocabulary(self, db):
        with db.get_conn() as conn:
            count = conn.execute("SELECT COUNT(*) AS n FROM tag_vocabulary").fetchone()["n"]
        # The hardcoded seed in database.py is non-empty; just verify
        # init_db ran and inserted at least one row.
        assert count > 0

    def test_init_db_seeds_default_suppressed(self, db):
        with db.get_conn() as conn:
            count = conn.execute(
                "SELECT COUNT(*) AS n FROM suppressed_terms"
            ).fetchone()["n"]
        assert count > 0
