"""ffmpeg conversion, shared by `/api/convert` and the Drive ingest.

One place builds the ffmpeg argv. `.claude/rules/security.md` requires
list-form argv with no user input f-strung into a command; keeping a single
implementation means that holds for every caller rather than per call site.
"""

import logging
import subprocess
from pathlib import Path

from backend.audio_utils import AUDIO_FORMATS_CONFIG

log = logging.getLogger("asmr_curator")

# Deliberately imports only `audio_utils` (a leaf). Reaching back into
# `backend.main` for these tables made this module unimportable on its own —
# main imports the routes at its foot, and the routes import this.

OUTPUT_FORMATS = AUDIO_FORMATS_CONFIG["outputFormats"]

# ffmpeg argv per (format, quality). The single source of truth for what the
# converter can produce: `/api/convert` and the ingest paths both validate
# against it, so a format missing here is a format the app cannot output.
QUALITY_FLAGS: dict[str, dict[str, list[str]]] = {
    "mp3": {
        # LAME VBR: -q:a 0 = best (~245kbps avg), 9 = worst (~65kbps avg).
        # "low" anchors at ~130kbps to match VLC's MP3 default; the earlier
        # -q:a 7 sat below that floor and made the preset feel cheaper than
        # a comparable VLC export at the same size.
        "low": ["-codec:a", "libmp3lame", "-q:a", "5"],  # ~130kbps
        "standard": ["-codec:a", "libmp3lame", "-q:a", "3"],  # ~160kbps
        "high": ["-codec:a", "libmp3lame", "-q:a", "2"],  # ~190kbps
        "best": ["-codec:a", "libmp3lame", "-q:a", "0"],  # ~245kbps
    },
    "flac": {
        # No -ar / -sample_fmt: ffmpeg preserves source rate + bit depth,
        # so a 48kHz / 24-bit source stays 48kHz / 24-bit instead of being
        # silently downsampled to 44.1kHz / 16-bit.
        # Lossless is the only quality — callers that pass a preset name
        # meant for a lossy codec are rejected rather than silently coerced.
        "lossless": ["-codec:a", "flac", "-compression_level", "8"],
    },
    "ogg": {
        # libvorbis -q:a scale: 0 = worst, 10 = best.
        "low": ["-codec:a", "libvorbis", "-q:a", "4"],  # ~128kbps
        "standard": ["-codec:a", "libvorbis", "-q:a", "6"],  # ~192kbps
        "high": ["-codec:a", "libvorbis", "-q:a", "7"],  # ~224kbps
        "best": ["-codec:a", "libvorbis", "-q:a", "9"],  # ~320kbps
    },
}

# Codecs that support an explicit CBR bitrate override (power-mode field).
# When a request carries `bitrate_kbps`, the preset's `-q:a` flag is swapped
# for `-b:a <N>k` and the codec is taken from the table above. FLAC is
# intentionally omitted; lossless has no bitrate target.
BITRATE_OVERRIDE_FORMATS: frozenset[str] = frozenset({"mp3", "ogg"})
BITRATE_OVERRIDE_MIN_KBPS = 32
BITRATE_OVERRIDE_MAX_KBPS = 320

# ffmpeg cap for one conversion. Mirrors main's subprocess budget; kept here
# so this module has no import back into main.
FFMPEG_SUBPROCESS_TIMEOUT_S = 300


def default_quality_for(fmt: str) -> str:
    """The sensible preset for a format. FLAC only has `lossless`; the lossy
    codecs default to `high`. Lets ingest callers ask for a format without
    knowing which quality names that codec supports."""
    qualities = QUALITY_FLAGS.get(fmt, {})
    if "high" in qualities:
        return "high"
    return next(iter(qualities), "high")


class ConversionError(RuntimeError):
    """ffmpeg failed, timed out, or wasn't found. Carries a message that is
    safe to show a user — the ffmpeg stderr goes to the log, not here, so
    command lines and host paths don't leak."""


def ext_for_format(fmt: str) -> str:
    """Filename extension for an output format (e.g. "mp3" → ".mp3")."""
    info = next((f for f in OUTPUT_FORMATS if f["value"] == fmt), None)
    if info is None:
        raise ConversionError(f"Unsupported output format: {fmt}")
    return str(info["ext"])


def validate_conversion_request(fmt: str, quality: str, bitrate_kbps: int | None) -> None:
    """Check format / quality / bitrate against the supported tables.

    Split out from `convert_audio` so route handlers can turn a bad request
    into a 400 before any work starts, while still sharing the rules.
    """
    if fmt not in QUALITY_FLAGS:
        raise ConversionError(f"Unsupported output format: {fmt}")
    if quality not in QUALITY_FLAGS[fmt]:
        raise ConversionError(f"Unsupported quality '{quality}' for format '{fmt}'")
    if bitrate_kbps is not None:
        if fmt not in BITRATE_OVERRIDE_FORMATS:
            raise ConversionError(f"Bitrate override is not supported for {fmt}")
        if not (BITRATE_OVERRIDE_MIN_KBPS <= bitrate_kbps <= BITRATE_OVERRIDE_MAX_KBPS):
            raise ConversionError(
                f"Bitrate must be between {BITRATE_OVERRIDE_MIN_KBPS} and "
                f"{BITRATE_OVERRIDE_MAX_KBPS} kbps"
            )


def convert_audio(
    src: Path,
    dest: Path,
    fmt: str,
    quality: str,
    bitrate_kbps: int | None = None,
) -> None:
    """Transcode `src` to `dest` in `fmt`. Raises ConversionError on failure.

    Callers validate first with `validate_conversion_request`; this assumes
    the format / quality pair is known.
    """
    # Preset argv is `[-codec:a, <codec>, -q:a, <n>]`. With a bitrate
    # override, keep the codec pair and replace the rate-control pair.
    preset_flags = QUALITY_FLAGS[fmt][quality]
    if bitrate_kbps is not None:
        codec_flags = [*preset_flags[:2], "-b:a", f"{bitrate_kbps}k"]
    else:
        codec_flags = preset_flags
    cmd = ["ffmpeg", "-i", str(src), "-vn", *codec_flags, str(dest)]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=FFMPEG_SUBPROCESS_TIMEOUT_S,
        )
    except FileNotFoundError:
        raise ConversionError("ffmpeg not found — make sure it is installed")
    except subprocess.TimeoutExpired:
        raise ConversionError("Conversion timed out")

    if result.returncode != 0:
        log.error("ffmpeg conversion failed for %s: %s", src.name, result.stderr)
        raise ConversionError("Conversion failed. Check the server log for ffmpeg output.")
