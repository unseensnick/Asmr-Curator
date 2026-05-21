"""Tests for /api/patreon/fetch — the SSE streaming endpoint.

The real `patreon_fetch.fetch()` shells out to a Node CLI and isn't unit-
testable here. These tests stand in a stub for it that mimics what the
drain thread does — emit a sequence of phase events through `on_progress`,
then return a `FetchResult`. They verify:

  - the endpoint frames each event as a `data: <json>\\n\\n` SSE chunk,
  - the final aggregate arrives as a `done` event with the same shape the
    prior synchronous endpoint returned,
  - a `PatreonFetchError` raised by the wrapper turns into a terminal
    `error` event (not an HTTP 502),
  - up-front validation (missing cookie, malformed date) still returns a
    normal JSON error response — those happen before the stream starts.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.patreon_fetch import FetchedPost, FetchResult, PatreonFetchError

# ── Helpers ────────────────────────────────────────────────────────────────


@pytest.fixture
def patreon_client(monkeypatch, tmp_path):
    """TestClient with isolated DOWNLOAD_PATH, LIBRARY_PATH, and DB_PATH.

    Differs from the shared `client` fixture by also rebinding the SQLite
    DB so `set_setting("patreon_cookie", ...)` doesn't bleed across tests
    or pick up a host-side default DB. Returns (client, download_path,
    database_module) so tests can stage files and plant settings.
    """
    from backend import database, main

    download = tmp_path / "downloads"
    library = tmp_path / "library"
    download.mkdir()
    library.mkdir()
    db_path = tmp_path / "dictionary.db"

    monkeypatch.setattr(main, "DOWNLOAD_PATH", download)
    monkeypatch.setattr(main, "LIBRARY_PATH", library)
    monkeypatch.setattr(database, "DB_PATH", str(db_path))
    database.init_db()
    database.migrate_db()

    return TestClient(main.app), download, database


def _set_cookie(patreon_client_tuple):
    """Plant a non-empty Patreon cookie so the endpoint clears its 412 gate."""
    c, _, db = patreon_client_tuple
    db.set_setting("patreon_cookie", "x" * 64)
    return c


def _parse_sse(body: str) -> list[dict]:
    """Split an SSE body into one decoded JSON event per `data:` frame."""
    events: list[dict] = []
    for frame in body.split("\n\n"):
        frame = frame.replace("\r", "")
        for line in frame.split("\n"):
            if line.startswith("data:"):
                payload = line[len("data:") :].strip()
                if payload:
                    events.append(json.loads(payload))
    return events


def _make_post(post_id: str, **overrides) -> FetchedPost:
    defaults = {
        "post_id": post_id,
        "title": f"Title {post_id}",
        "tags": ["asmr"],
        "artist": "Solar Girl ASMR",
        "post_dir": f"/tmp/post_{post_id}",
        "audio_path": f"/tmp/post_{post_id}/audio.m4a",
        "external_links": [],
    }
    defaults.update(overrides)
    return FetchedPost(**defaults)


# ── Up-front validation (pre-stream JSON errors) ───────────────────────────


class TestUpfrontValidation:
    def test_missing_cookie_returns_412(self, patreon_client):
        c, _, _ = patreon_client
        r = c.post("/api/patreon/fetch", json={"url": "https://patreon.com/x"})
        assert r.status_code == 412
        assert "cookie" in r.json()["detail"].lower()

    def test_empty_url_returns_400(self, patreon_client):
        c = _set_cookie(patreon_client)
        r = c.post("/api/patreon/fetch", json={"url": "   "})
        assert r.status_code == 400

    def test_malformed_date_returns_400(self, patreon_client):
        c = _set_cookie(patreon_client)
        r = c.post(
            "/api/patreon/fetch",
            json={"url": "https://patreon.com/x", "published_after": "9999-99-99"},
        )
        assert r.status_code == 400


# ── Streaming happy path ───────────────────────────────────────────────────


class TestStreamingFlow:
    def test_emits_progress_events_then_done(self, patreon_client, monkeypatch):
        """The route should forward every on_progress event verbatim and
        end with a `done` frame carrying the serialised result."""
        c, _download, _ = patreon_client
        _set_cookie(patreon_client)

        emitted_phases = [
            {"state": "resolving", "target_kind": "creator", "label": "creator"},
            {"state": "fetching_posts", "fetched": 1, "total": 1},
            {"state": "posts_found", "count": 1},
            {"state": "post_progress", "post_id": "100", "title": "Title 100"},
            {"state": "wrote_file", "path": "/tmp/post_100/audio.m4a"},
            {"state": "phase_done"},
        ]

        def fake_fetch(url, cookie, output_dir, **kwargs):
            on_progress = kwargs.get("on_progress")
            assert on_progress is not None, "endpoint must pass an on_progress callback"
            # Wrapper emits `starting` itself before any stdout lands.
            on_progress({"state": "starting"})
            for event in emitted_phases:
                on_progress(event)
            return FetchResult(
                output_dir=str(output_dir),
                posts=[_make_post("100")],
                log_tail="",
            )

        monkeypatch.setattr("backend.routes.patreon.patreon_fetch", fake_fetch)
        with c.stream("POST", "/api/patreon/fetch", json={"url": "https://patreon.com/c/x"}) as r:
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("text/event-stream")
            body = r.read().decode("utf-8")
        events = _parse_sse(body)

        # `starting` first, then every emitted phase, then `done` last.
        assert events[0] == {"state": "starting"}
        for expected in emitted_phases:
            assert expected in events
        assert events[-1]["state"] == "done"
        assert events[-1]["count"] == 1
        assert events[-1]["posts"][0]["post_id"] == "100"

    def test_done_event_carries_legacy_response_shape(self, patreon_client, monkeypatch):
        """`done` must include the same keys the synchronous endpoint used
        to return, so the frontend's existing render path works unchanged."""
        c, _download, _ = patreon_client
        _set_cookie(patreon_client)

        def fake_fetch(url, cookie, output_dir, **kwargs):
            return FetchResult(
                output_dir=str(output_dir),
                posts=[_make_post("200")],
                log_tail="",
            )

        monkeypatch.setattr("backend.routes.patreon.patreon_fetch", fake_fetch)
        with c.stream(
            "POST", "/api/patreon/fetch", json={"url": "https://patreon.com/posts/x-200"}
        ) as r:
            body = r.read().decode("utf-8")
        done = next(e for e in _parse_sse(body) if e["state"] == "done")

        for key in ("output_dir", "count", "metadata_only", "dry_run", "posts"):
            assert key in done

    def test_empty_result_includes_hint(self, patreon_client, monkeypatch):
        """A successful fetch that returns zero posts should still carry a
        `hint` explaining why (mirrors the old endpoint's behaviour)."""
        c, _download, _ = patreon_client
        _set_cookie(patreon_client)

        def fake_fetch(url, cookie, output_dir, **kwargs):
            return FetchResult(output_dir=str(output_dir), posts=[], log_tail="(empty)")

        monkeypatch.setattr("backend.routes.patreon.patreon_fetch", fake_fetch)
        with c.stream("POST", "/api/patreon/fetch", json={"url": "https://patreon.com/x"}) as r:
            body = r.read().decode("utf-8")
        done = next(e for e in _parse_sse(body) if e["state"] == "done")

        assert done["count"] == 0
        assert "hint" in done
        assert done["log_tail"] == "(empty)"


# ── Streaming error path ───────────────────────────────────────────────────


class TestStreamingErrors:
    def test_patreon_fetch_error_emits_terminal_error_event(self, patreon_client, monkeypatch):
        """A PatreonFetchError raised by the wrapper turns into a terminal
        `error` SSE frame — the response is still 200, the failure rides on
        the stream so the frontend's onEvent handler sees it."""
        c, _, _ = patreon_client
        _set_cookie(patreon_client)

        def fake_fetch(url, cookie, output_dir, **kwargs):
            raise PatreonFetchError("patreon-dl exited with code 1")

        monkeypatch.setattr("backend.routes.patreon.patreon_fetch", fake_fetch)
        with c.stream("POST", "/api/patreon/fetch", json={"url": "https://patreon.com/x"}) as r:
            assert r.status_code == 200
            body = r.read().decode("utf-8")
        events = _parse_sse(body)

        assert events[-1]["state"] == "error"
        assert "patreon-dl exited" in events[-1]["message"]

    def test_unexpected_exception_does_not_leak_internals(self, patreon_client, monkeypatch):
        """Bare exceptions shouldn't stringify into the error message — the
        rule in error-handling.md is to log + surface a clean message."""
        c, _, _ = patreon_client
        _set_cookie(patreon_client)

        def fake_fetch(url, cookie, output_dir, **kwargs):
            raise RuntimeError("internal /etc/secret path leaked here")

        monkeypatch.setattr("backend.routes.patreon.patreon_fetch", fake_fetch)
        with c.stream("POST", "/api/patreon/fetch", json={"url": "https://patreon.com/x"}) as r:
            body = r.read().decode("utf-8")
        err = next(e for e in _parse_sse(body) if e["state"] == "error")

        assert "/etc/secret" not in err["message"]


# ── Path serialisation in `done` event ─────────────────────────────────────


class TestPathSerialisation:
    def test_audio_path_is_relative_to_download_path(self, patreon_client, monkeypatch):
        """Absolute paths from patreon-dl get rebased against DOWNLOAD_PATH
        so the frontend never sees host-internal filesystem layout."""
        c, download, _ = patreon_client
        _set_cookie(patreon_client)

        # Pretend patreon-dl wrote a file inside DOWNLOAD_PATH.
        creator_dir = download / "Solar Girl ASMR" / "100 - Title 100"
        creator_dir.mkdir(parents=True)
        audio_file = creator_dir / "audio.m4a"
        audio_file.write_bytes(b"\x00\x00")

        def fake_fetch(url, cookie, output_dir, **kwargs):
            return FetchResult(
                output_dir=str(output_dir),
                posts=[_make_post("100", audio_path=str(audio_file))],
                log_tail="",
            )

        monkeypatch.setattr("backend.routes.patreon.patreon_fetch", fake_fetch)
        with c.stream("POST", "/api/patreon/fetch", json={"url": "https://patreon.com/x"}) as r:
            body = r.read().decode("utf-8")
        done = next(e for e in _parse_sse(body) if e["state"] == "done")

        audio_path = Path(done["posts"][0]["audio_path"])
        assert not audio_path.is_absolute()
        assert audio_path.parts[0] == "Solar Girl ASMR"
