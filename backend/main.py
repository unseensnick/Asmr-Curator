"""FastAPI app construction + shared helpers.

Owns app assembly (lifespan, SPA fallback, router registration), path
validators, env-resolved roots, audio-format tables, and a few small
validation helpers. Route handlers live under `backend/routes/`; audio
metadata reads / writes live in `backend.audio_metadata`.
"""

import logging
import os
import tomllib
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend import drive_fetch
from backend.audio_utils import AUDIO_FORMATS_CONFIG

_FORMATS_CONFIG = AUDIO_FORMATS_CONFIG

log = logging.getLogger("asmr_curator")

# Max accepted size for a base64-encoded screenshot in /api/extract. Base64
# inflates by ~4/3, so 32 MB of base64 ≈ 24 MB of binary. Generous for any
# real ASMR-post screenshot and small enough to surface flood patterns in
# logs before they OOM the server.
MAX_IMAGE_B64_BYTES = 32 * 1024 * 1024


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    # Close the shared Chromium kept alive across Drive scrapes so we don't
    # leak a child process on server stop. Safe when nothing's been launched.
    await drive_fetch.close_shared_browser()


app = FastAPI(title="ASMR Curator API", lifespan=lifespan)

# CORS — restrictive by default; expand only the dev Vite origin so the
# `npm run dev` proxy keeps working. In production the SPA is served from
# the same origin as the API (port 8000), so no cross-origin requests are
# expected — meaning *any* cross-origin Origin header is suspicious and
# should be rejected. Without this middleware a malicious page the user
# visits could PUT /api/settings/patreon-cookie with `text/plain` and
# overwrite their stored cookie (PUT triggers preflight, which CORS then
# blocks). Defence in depth, per .claude/rules/security.md.
_DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_DEV_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)


# Resolve frontend dist path — built output from `cd frontend && npm run build`.
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"


def _require_env_path(name: str) -> Path:
    """Resolve a required env var to an existing directory, or raise loudly.
    No silent fallback — misconfiguration must fail at startup, not let the
    app come up half-broken.
    """
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"{name} environment variable is not set. Set it to an existing "
            f"directory and restart. See README.md for the DOWNLOAD_PATH / "
            f"LIBRARY_PATH split."
        )
    path = Path(value).resolve()
    if not path.exists():
        raise RuntimeError(
            f"{name}={value} does not exist on disk. Create the directory "
            f"or point the variable at an existing path."
        )
    if not path.is_dir():
        raise RuntimeError(f"{name}={value} is not a directory.")
    return path


# DOWNLOAD_PATH = ingest staging (patreon-dl, Drive/external downloads).
# LIBRARY_PATH = the curated archive FileBrowser browses. Must be distinct
# directories — the runtime check below makes the misconfiguration noisy.
DOWNLOAD_PATH = _require_env_path("DOWNLOAD_PATH")
LIBRARY_PATH = _require_env_path("LIBRARY_PATH")
if DOWNLOAD_PATH == LIBRARY_PATH:
    raise RuntimeError(
        "DOWNLOAD_PATH and LIBRARY_PATH must point at different directories. "
        "Set them to two distinct paths (e.g. DOWNLOAD_PATH=~/asmr-downloads, "
        "LIBRARY_PATH=~/Music/ASMR)."
    )

# ── Serve frontend (built assets) ─────────────────────────────────────────────
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")


@app.get("/")
def root():
    return FileResponse(str(FRONTEND_DIST / "index.html"))


# ── Config ────────────────────────────────────────────────────────────────────
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5vl:7b")

# Subprocess + HTTP timeouts. Named so callers don't sprinkle magic numbers,
# and so the values are findable when tuning a slow encode / large download.
FFMPEG_SUBPROCESS_TIMEOUT_S = 300  # /api/convert ffmpeg cap
EXTERNAL_AUDIO_HTTPX_TIMEOUTS = httpx.Timeout(  # /api/patreon/ingest-external-audio
    connect=15.0,
    read=300.0,
    write=60.0,
    pool=15.0,
)


def _read_version() -> str:
    try:
        path = Path(__file__).parent / "pyproject.toml"
        with path.open("rb") as f:
            return tomllib.load(f)["project"]["version"]
    except Exception:
        return "unknown"


APP_VERSION = _read_version()

# Settings DB keys shared between routes/settings.py (writer) and
# routes/patreon.py (reader). Defined here so neither route module has to
# import from the other.
PATREON_COOKIE_KEY = "patreon_cookie"
GOOGLE_COOKIE_KEY = "google_cookie"


# ── Shared helpers ────────────────────────────────────────────────────────────


def require_non_empty(value: str, field: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise HTTPException(400, f"{field} cannot be empty")
    return stripped


def validate_under_root(rel_path: str, root: Path) -> Path:
    """Resolve `rel_path` under `root` and reject any path that escapes it.

    is_relative_to (Python 3.9+) so a sibling like /mnt/audio_evil doesn't
    satisfy a naive prefix check against /mnt/audio.

    Null bytes + malformed inputs make `.resolve()` raise `ValueError` /
    `OSError` from the OS layer — without this catch they'd surface as a
    500 with a Python stack trace. Treat them as denials: a security
    boundary doesn't owe the caller a stack trace.
    """
    try:
        resolved = (root / rel_path.strip()).resolve()
    except ValueError, OSError:
        raise HTTPException(403, "Access denied")
    root_resolved = root.resolve()
    if not resolved.is_relative_to(root_resolved):
        raise HTTPException(403, "Access denied")
    return resolved


def validate_under_library(rel_path: str) -> Path:
    return validate_under_root(rel_path, LIBRARY_PATH)


def validate_under_download(rel_path: str) -> Path:
    return validate_under_root(rel_path, DOWNLOAD_PATH)


def root_for(name: str) -> Path:
    if name == "library":
        return LIBRARY_PATH
    if name == "downloads":
        return DOWNLOAD_PATH
    raise HTTPException(400, f"Invalid root: {name!r}. Use 'library' or 'downloads'.")


def require_file(path: Path) -> None:
    if not path.exists():
        raise HTTPException(404, f"File not found: {path.name}")


def reject_if_exists(path: Path) -> None:
    if path.exists():
        raise HTTPException(409, f"File already exists: {path.name}")


# Audio-metadata helpers live in `backend.audio_metadata`. Re-exported
# under their previous underscored names for the route modules that import
# them from here. F401: re-exports for external callers are not unused.
from backend.audio_metadata import clear_metadata as _clear_metadata  # noqa: E402,F401
from backend.audio_metadata import read_metadata as _read_metadata  # noqa: E402,F401
from backend.audio_metadata import write_metadata as _write_metadata  # noqa: E402,F401

# ── Audio-format catalogue (file browser + convert + rename ext gating) ──────

METADATA_COMPATIBLE_EXTS = set(_FORMATS_CONFIG["metadataCompatibleExts"])
NEEDS_CONVERSION_EXTS = set(_FORMATS_CONFIG["needsConversionExts"])
AUDIO_EXTS = METADATA_COMPATIBLE_EXTS | NEEDS_CONVERSION_EXTS
OUTPUT_FORMATS = _FORMATS_CONFIG["outputFormats"]

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
# Wired in `routes/convert.py` — when a request carries `bitrate_kbps`, the
# preset's `-q:a` flag is swapped for `-b:a <N>k` and the codec is taken
# from the table above. FLAC is intentionally omitted; lossless has no
# bitrate target.
BITRATE_OVERRIDE_FORMATS: frozenset[str] = frozenset({"mp3", "ogg"})
BITRATE_OVERRIDE_MIN_KBPS = 32
BITRATE_OVERRIDE_MAX_KBPS = 320


# ── Router registration ──────────────────────────────────────────────────────
# Routers live under `backend/routes/` and import the shared helpers above
# from this module. Imported here at the bottom so by the time each route
# module evaluates `from backend.main import …`, the names exist.

from backend.routes import (  # noqa: E402  (deferred to break the import cycle)
    convert,
    dictionary,
    extract,
    files,
    patreon,
    settings,
    system,
)

app.include_router(system.router)
app.include_router(extract.router)
app.include_router(files.router)
app.include_router(convert.router)
app.include_router(settings.router)
app.include_router(patreon.router)
app.include_router(dictionary.router)
