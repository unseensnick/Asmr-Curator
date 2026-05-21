"""Tests for /api/convert — the ffmpeg-backed audio re-encode endpoint.

These tests stub `subprocess.run` so they assert the argv we build per
format / quality / bitrate combination without actually invoking ffmpeg.
Real-codec behaviour is ffmpeg's responsibility; this layer only owns the
flag mapping.
"""

import subprocess
from unittest.mock import MagicMock


def _stage_source(downloads, name: str = "in.wav") -> str:
    """Write a placeholder file the validator + suffix check are happy with.
    Returns the request path (relative to root)."""
    path = downloads / name
    path.write_bytes(b"\x00")
    return name


def _fake_subprocess_run(monkeypatch, *, returncode: int = 0):
    """Replace `backend.routes.convert.subprocess.run` with a recorder
    that always 'succeeds' and writes a dest stub so the handler's post-
    convert bookkeeping passes."""
    calls: list[list[str]] = []

    def fake_run(cmd, *args, **kwargs):
        calls.append(cmd)
        # Write the dest file so `reject_if_exists` on a follow-up call
        # would catch a clash, and so any os.path checks succeed.
        if returncode == 0:
            from pathlib import Path

            Path(cmd[-1]).write_bytes(b"\x00")
        result = MagicMock(returncode=returncode, stderr="", stdout="")
        return result

    monkeypatch.setattr(
        "backend.routes.convert.subprocess.run",
        fake_run,
    )
    return calls


class TestPresetArgv:
    """Pin the argv the retuned presets build. If these change, the
    CHANGELOG and HelpSheet copy describing the bitrates need to change
    with them."""

    def test_mp3_low_is_q5(self, client, monkeypatch):
        c, downloads, _ = client
        name = _stage_source(downloads)
        calls = _fake_subprocess_run(monkeypatch)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "mp3",
                "quality": "low",
                "root": "downloads",
            },
        )
        assert r.status_code == 200
        # ffmpeg call args between -vn and the dest file are the codec
        # flags from QUALITY_FLAGS.
        argv = calls[0]
        assert "-codec:a" in argv and "libmp3lame" in argv
        assert "-q:a" in argv
        assert argv[argv.index("-q:a") + 1] == "5"

    def test_mp3_standard_is_q3(self, client, monkeypatch):
        c, downloads, _ = client
        name = _stage_source(downloads, "a.wav")
        calls = _fake_subprocess_run(monkeypatch)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "mp3",
                "quality": "standard",
                "root": "downloads",
            },
        )
        assert r.status_code == 200
        argv = calls[0]
        assert argv[argv.index("-q:a") + 1] == "3"

    def test_ogg_low_is_q4(self, client, monkeypatch):
        c, downloads, _ = client
        name = _stage_source(downloads, "a.wav")
        calls = _fake_subprocess_run(monkeypatch)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "ogg",
                "quality": "low",
                "root": "downloads",
            },
        )
        assert r.status_code == 200
        argv = calls[0]
        assert "libvorbis" in argv
        assert argv[argv.index("-q:a") + 1] == "4"

    def test_flac_preset_does_not_force_sample_rate(self, client, monkeypatch):
        c, downloads, _ = client
        name = _stage_source(downloads, "a.wav")
        calls = _fake_subprocess_run(monkeypatch)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "flac",
                "quality": "lossless",
                "root": "downloads",
            },
        )
        assert r.status_code == 200
        argv = calls[0]
        # The earlier preset hardcoded -ar 44100 and -sample_fmt s16; the
        # retuned preset omits both so ffmpeg preserves the source rate +
        # depth.
        assert "-ar" not in argv
        assert "-sample_fmt" not in argv
        assert "flac" in argv


class TestBitrateOverride:
    """Power-mode bitrate override: when `bitrate_kbps` is set, the codec
    pair from the preset stays but `-q:a` is replaced with `-b:a <N>k`."""

    def test_mp3_with_bitrate_uses_cbr_flag(self, client, monkeypatch):
        c, downloads, _ = client
        name = _stage_source(downloads, "a.wav")
        calls = _fake_subprocess_run(monkeypatch)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "mp3",
                "quality": "standard",
                "root": "downloads",
                "bitrate_kbps": 192,
            },
        )
        assert r.status_code == 200
        argv = calls[0]
        assert "-b:a" in argv
        assert argv[argv.index("-b:a") + 1] == "192k"
        # Override swaps the rate-control pair; -q:a must be gone.
        assert "-q:a" not in argv
        # Codec selection is still from the preset.
        assert "libmp3lame" in argv

    def test_ogg_with_bitrate_uses_cbr_flag(self, client, monkeypatch):
        c, downloads, _ = client
        name = _stage_source(downloads, "a.wav")
        calls = _fake_subprocess_run(monkeypatch)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "ogg",
                "quality": "high",
                "root": "downloads",
                "bitrate_kbps": 256,
            },
        )
        assert r.status_code == 200
        argv = calls[0]
        assert argv[argv.index("-b:a") + 1] == "256k"
        assert "libvorbis" in argv
        assert "-q:a" not in argv

    def test_flac_with_bitrate_rejected(self, client, monkeypatch):
        c, downloads, _ = client
        name = _stage_source(downloads, "a.wav")
        _fake_subprocess_run(monkeypatch)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "flac",
                "quality": "lossless",
                "root": "downloads",
                "bitrate_kbps": 256,
            },
        )
        assert r.status_code == 400
        assert "flac" in r.json()["detail"].lower()

    def test_bitrate_below_min_rejected(self, client, monkeypatch):
        c, downloads, _ = client
        name = _stage_source(downloads, "a.wav")
        _fake_subprocess_run(monkeypatch)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "mp3",
                "quality": "low",
                "root": "downloads",
                "bitrate_kbps": 16,
            },
        )
        assert r.status_code == 400

    def test_bitrate_above_max_rejected(self, client, monkeypatch):
        c, downloads, _ = client
        name = _stage_source(downloads, "a.wav")
        _fake_subprocess_run(monkeypatch)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "mp3",
                "quality": "low",
                "root": "downloads",
                "bitrate_kbps": 512,
            },
        )
        assert r.status_code == 400

    def test_bitrate_omitted_falls_back_to_preset(self, client, monkeypatch):
        """Sanity: no bitrate field means the preset's -q:a runs unchanged."""
        c, downloads, _ = client
        name = _stage_source(downloads, "a.wav")
        calls = _fake_subprocess_run(monkeypatch)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "mp3",
                "quality": "best",
                "root": "downloads",
            },
        )
        assert r.status_code == 200
        argv = calls[0]
        assert "-b:a" not in argv
        assert argv[argv.index("-q:a") + 1] == "0"


class TestSubprocessFailures:
    def test_returncode_nonzero_surfaces_generic_500(self, client, monkeypatch):
        c, downloads, _ = client
        name = _stage_source(downloads, "a.wav")
        _fake_subprocess_run(monkeypatch, returncode=1)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "mp3",
                "quality": "low",
                "root": "downloads",
            },
        )
        assert r.status_code == 500
        # No internal path or argv leakage in the response.
        body = r.json()["detail"]
        assert str(downloads) not in body
        assert "ffmpeg" in body.lower()  # generic mention is OK; argv is not.

    def test_ffmpeg_missing_surfaces_clean_message(self, client, monkeypatch):
        c, downloads, _ = client
        name = _stage_source(downloads, "a.wav")

        def boom(*a, **kw):
            raise FileNotFoundError("ffmpeg")

        monkeypatch.setattr("backend.routes.convert.subprocess.run", boom)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "mp3",
                "quality": "low",
                "root": "downloads",
            },
        )
        assert r.status_code == 500
        assert "ffmpeg" in r.json()["detail"].lower()

    def test_subprocess_timeout_returns_504(self, client, monkeypatch):
        c, downloads, _ = client
        name = _stage_source(downloads, "a.wav")

        def boom(*a, **kw):
            raise subprocess.TimeoutExpired("ffmpeg", 30)

        monkeypatch.setattr("backend.routes.convert.subprocess.run", boom)
        r = c.post(
            "/api/convert",
            json={
                "path": name,
                "output_format": "mp3",
                "quality": "low",
                "root": "downloads",
            },
        )
        assert r.status_code == 504
