"""Tests for backend.drive_fetch — pure helper functions.

`fetch_drive_audio()` itself requires Playwright + Chromium + a Google
session and isn't unit-tested here. The helpers (URL parsing, host filtering,
sensitive-param redaction, itag extraction) are pure and cover the bug
surfaces that recent Drive-scrape iterations kept tripping on.
"""

import importlib

import backend.drive_fetch as drive_fetch
from backend.drive_fetch import (
    _is_google_request,
    _itag_of,
    _redact_sensitive_url,
    _request_looks_like_audio,
    drive_id_from_url,
)

# ── drive_id_from_url ──────────────────────────────────────────────────────


class TestDriveIdFromUrl:
    def test_parses_file_d_path(self):
        url = "https://drive.google.com/file/d/1abcDEF123/view"
        assert drive_id_from_url(url) == "1abcDEF123"

    def test_parses_file_d_path_with_preview_suffix(self):
        url = "https://drive.google.com/file/d/1abcDEF123/preview"
        assert drive_id_from_url(url) == "1abcDEF123"

    def test_parses_file_d_path_with_query_string(self):
        url = "https://drive.google.com/file/d/1abcDEF123/view?usp=sharing"
        assert drive_id_from_url(url) == "1abcDEF123"

    def test_parses_id_query_param(self):
        url = "https://drive.google.com/open?id=1abcDEF123"
        assert drive_id_from_url(url) == "1abcDEF123"

    def test_parses_driveid_query_param(self):
        # `driveid` is the param the in-page YouTube embed uses.
        url = "https://drive.google.com/u/0/drive-viewer/abc?driveid=1xyz789"
        assert drive_id_from_url(url) == "1xyz789"

    def test_returns_none_for_url_without_id(self):
        assert drive_id_from_url("https://drive.google.com/drive/my-drive") is None

    def test_returns_none_for_non_drive_url(self):
        assert drive_id_from_url("https://example.com/file") is None

    def test_returns_none_for_empty(self):
        assert drive_id_from_url("") is None


# ── _itag_of ───────────────────────────────────────────────────────────────


class TestItagOf:
    def test_extracts_itag_140_audio(self):
        # Drive serves m4a audio as itag=140 — the stream we prefer.
        url = "https://rr.c.drive.google.com/videoplayback?itag=140&id=abc"
        assert _itag_of(url) == "140"

    def test_extracts_itag_134_video(self):
        # itag=134 is the parallel video stream we deprefer.
        url = "https://rr.c.drive.google.com/videoplayback?itag=134&id=abc"
        assert _itag_of(url) == "134"

    def test_extracts_itag_with_many_other_params(self):
        # Real Drive playback URLs have ~30 query params.
        url = (
            "https://rr2---sn-aj5go5-5i.c.drive.google.com/videoplayback"
            "?expire=1778977726&ei=juEIaqL0DevOrr4P08zB2AE&ip=1.2.3.4"
            "&id=5545e23b7c6a951f&itag=140&source=webdrive&requiressl=yes"
        )
        assert _itag_of(url) == "140"

    def test_returns_none_when_no_itag(self):
        url = "https://example.com/v?foo=bar"
        assert _itag_of(url) is None

    def test_returns_none_for_empty_query(self):
        assert _itag_of("https://example.com/") is None

    def test_returns_none_for_empty_url(self):
        assert _itag_of("") is None


# ── _request_looks_like_audio ──────────────────────────────────────────────


class TestRequestLooksLikeAudio:
    def test_matches_drive_videoplayback(self):
        url = "https://rr.c.drive.google.com/videoplayback?itag=140"
        assert _request_looks_like_audio(url) is True

    def test_matches_googlevideo_videoplayback(self):
        url = "https://rr.googlevideo.com/videoplayback?itag=140"
        assert _request_looks_like_audio(url) is True

    def test_matches_googleusercontent_videoplayback(self):
        url = "https://x.googleusercontent.com/videoplayback?itag=140"
        assert _request_looks_like_audio(url) is True

    def test_rejects_non_videoplayback_path(self):
        url = "https://drive.google.com/file/d/abc/view"
        assert _request_looks_like_audio(url) is False

    def test_rejects_non_google_host(self):
        url = "https://example.com/videoplayback"
        assert _request_looks_like_audio(url) is False

    def test_rejects_invalid_url(self):
        assert _request_looks_like_audio("not a url") is False


# ── _is_google_request ─────────────────────────────────────────────────────


class TestIsGoogleRequest:
    def test_matches_google_com(self):
        assert _is_google_request("https://accounts.google.com/RotateCookies") is True

    def test_matches_googlevideo_com(self):
        assert _is_google_request("https://rr.googlevideo.com/videoplayback") is True

    def test_matches_googleapis_com(self):
        assert _is_google_request("https://youtube.googleapis.com/iframe_api") is True

    def test_matches_gstatic_com(self):
        assert _is_google_request("https://www.gstatic.com/_/foo") is True

    def test_matches_youtube_com(self):
        assert _is_google_request("https://youtube.com/embed/") is True

    def test_rejects_non_google_host(self):
        assert _is_google_request("https://example.com/anything") is False

    def test_rejects_partial_match_in_path(self):
        # `google.com` in the path doesn't count as a Google request.
        assert _is_google_request("https://example.com/google.com/foo") is False


# ── _redact_sensitive_url ──────────────────────────────────────────────────


class TestRedactSensitiveUrl:
    def test_redacts_sig_value(self):
        url = "https://example.com/v?sig=secret-signature-here&itag=140"
        result = _redact_sensitive_url(url)
        assert "secret-signature-here" not in result
        assert "sig=<redacted>" in result
        # Non-sensitive param survives byte-identical.
        assert "itag=140" in result

    def test_redacts_lsig_value(self):
        url = "https://example.com/v?lsig=secret-lsig"
        assert _redact_sensitive_url(url) == "https://example.com/v?lsig=<redacted>"

    def test_redacts_signature_value(self):
        url = "https://example.com/v?signature=abc123"
        assert "signature=<redacted>" in _redact_sensitive_url(url)

    def test_redacts_auth_token(self):
        url = "https://example.com/v?auth=bearer-token-value"
        assert "auth=<redacted>" in _redact_sensitive_url(url)

    def test_redacts_api_key(self):
        url = "https://example.com/v?key=API_KEY_HERE"
        assert "key=<redacted>" in _redact_sensitive_url(url)

    def test_preserves_url_structure(self):
        # Path, host, non-sensitive params, ordering all preserved.
        url = "https://example.com/path?a=1&sig=secret&b=2"
        result = _redact_sensitive_url(url)
        assert result == "https://example.com/path?a=1&sig=<redacted>&b=2"

    def test_returns_url_unchanged_when_no_query(self):
        url = "https://example.com/path"
        assert _redact_sensitive_url(url) == url

    def test_case_insensitive_match_on_param_name(self):
        # `SIG=…` (uppercase) is still a signature — redact it.
        url = "https://example.com/v?SIG=secret"
        result = _redact_sensitive_url(url)
        assert "secret" not in result


# ── Module-level env-var-driven constants ──────────────────────────────────


class TestEnvVarConstants:
    def test_download_timeout_default_is_four_hours(self, monkeypatch):
        # Default 14400 s = 4 h — covers a 3-hour file on a slow connection.
        monkeypatch.delenv("DRIVE_DOWNLOAD_TIMEOUT_S", raising=False)
        importlib.reload(drive_fetch)
        assert drive_fetch.DOWNLOAD_TIMEOUT_S == 14400.0

    def test_download_timeout_env_override(self, monkeypatch):
        monkeypatch.setenv("DRIVE_DOWNLOAD_TIMEOUT_S", "600")
        importlib.reload(drive_fetch)
        assert drive_fetch.DOWNLOAD_TIMEOUT_S == 600.0

    def test_browser_idle_timeout_default(self, monkeypatch):
        monkeypatch.delenv("DRIVE_BROWSER_IDLE_TIMEOUT_S", raising=False)
        importlib.reload(drive_fetch)
        assert drive_fetch.BROWSER_IDLE_TIMEOUT_S == 300.0

    def test_browser_idle_timeout_env_override(self, monkeypatch):
        monkeypatch.setenv("DRIVE_BROWSER_IDLE_TIMEOUT_S", "120")
        importlib.reload(drive_fetch)
        assert drive_fetch.BROWSER_IDLE_TIMEOUT_S == 120.0

    def test_preferred_audio_itag_is_140(self):
        # Regression guard — changing this silently changes which stream the
        # audio-preference logic picks for cover-art audio Drive uploads.
        from backend.drive_fetch import _PREFERRED_AUDIO_ITAG

        assert _PREFERRED_AUDIO_ITAG == "140"

    def test_audio_preference_grace_default(self):
        # Window we wait after first eligible URL for an itag=140 to overtake.
        from backend.drive_fetch import AUDIO_PREFERENCE_GRACE_S

        assert AUDIO_PREFERENCE_GRACE_S == 5.0
