"""Tests for the cookie-settings endpoints' request-body cap.

The cap exists so a runaway client can't OOM the worker. It was enforced
only from the `Content-Length` header, so a chunked request — which carries
no such header — walked straight past it.

Cookie values here are dummy strings; never put a real session cookie in a
test fixture.
"""

from collections.abc import Iterator

from backend.routes.settings import _MAX_COOKIE_BODY_BYTES

# `client` fixture is auto-discovered from backend/tests/conftest.py.


def _chunked(total: int, size: int = 32 * 1024) -> Iterator[bytes]:
    """Yield `total` bytes in pieces. httpx sends an iterator with
    `Transfer-Encoding: chunked` and no Content-Length."""
    sent = 0
    while sent < total:
        n = min(size, total - sent)
        yield b"x" * n
        sent += n


class TestCookieBodyCap:
    def test_accepts_a_normal_cookie(self, client):
        c, _, _ = client
        r = c.put(
            "/api/settings/patreon-cookie",
            content=b"session_id=dummy",
            headers={"Content-Type": "text/plain"},
        )
        assert r.status_code == 200, r.text

    def test_rejects_oversized_declared_body(self, client):
        c, _, _ = client
        r = c.put(
            "/api/settings/patreon-cookie",
            content=b"x" * (_MAX_COOKIE_BODY_BYTES + 1),
            headers={"Content-Type": "text/plain"},
        )
        assert r.status_code == 413, r.text

    def test_rejects_oversized_chunked_body(self, client):
        # No Content-Length to check, so this used to stream unbounded into
        # request.body().
        c, _, _ = client
        r = c.put(
            "/api/settings/patreon-cookie",
            content=_chunked(_MAX_COOKIE_BODY_BYTES * 2),
            headers={"Content-Type": "text/plain"},
        )
        assert r.status_code == 413, r.text

    def test_oversized_chunked_body_is_not_stored(self, client):
        # The settings DB outlives a single test, so clear first — otherwise
        # this asserts against whatever a previous test stored.
        c, _, _ = client
        c.put(
            "/api/settings/patreon-cookie",
            content=b"",
            headers={"Content-Type": "text/plain"},
        )
        c.put(
            "/api/settings/patreon-cookie",
            content=_chunked(_MAX_COOKIE_BODY_BYTES * 2),
            headers={"Content-Type": "text/plain"},
        )
        assert c.get("/api/settings/patreon-cookie").json()["set"] is False

    def test_rejects_oversized_chunked_json_cookies(self, client):
        c, _, _ = client
        r = c.put(
            "/api/settings/google-cookie",
            content=_chunked(_MAX_COOKIE_BODY_BYTES * 2),
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 413, r.text

    def test_never_returns_the_cookie_value(self, client):
        # The status endpoint reports set/length only — the value must never
        # leave the server.
        c, _, _ = client
        c.put(
            "/api/settings/patreon-cookie",
            content=b"session_id=dummy-secret",
            headers={"Content-Type": "text/plain"},
        )
        assert "dummy-secret" not in c.get("/api/settings/patreon-cookie").text
