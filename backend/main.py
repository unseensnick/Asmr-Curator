from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
from datetime import date
import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import time
import tomllib
import httpx
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TPE2, ID3NoHeaderError
from mutagen.flac import FLAC
from mutagen.oggvorbis import OggVorbis
from mutagen.mp4 import MP4
from backend import database
from backend import audio_utils
from backend import drive_fetch
from backend.patreon_fetch import PatreonFetchError, fetch as patreon_fetch

# ── Shared audio format config (single source of truth with frontend) ─────────
_FORMATS_CONFIG_PATH = Path(__file__).parent.parent / "frontend" / "src" / "lib" / "audio-formats.json"
with _FORMATS_CONFIG_PATH.open() as _f:
    _FORMATS_CONFIG = json.load(_f)

log = logging.getLogger("asmr_curator")

# Max accepted size for a base64-encoded screenshot in /api/extract.
# Base64 inflates by ~4/3, so 32 MB of base64 ≈ 24 MB of binary image. That's
# generous for any real ASMR-post screenshot and small enough to make a flood
# of large posts visible in logs before they OOM the server.
MAX_IMAGE_B64_BYTES = 32 * 1024 * 1024

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Startup work goes here; there isn't any yet.
    yield
    # Shutdown: close the shared Chromium kept alive across Drive scrapes
    # so we don't leak a child process on server stop. Safe to call when
    # nothing's been launched yet (drive_fetch tracks the state).
    await drive_fetch.close_shared_browser()


app = FastAPI(title="ASMR Curator API", lifespan=lifespan)


# Resolve frontend dist path — built output from `cd frontend && npm run build`
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"


def _require_env_path(name: str) -> Path:
    """Resolve a required env var to an existing directory, or raise loudly."""
    # No silent fallback — misconfiguration (typo, missing mount) must fail at
    # startup, not let the app come up half-broken.
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


# Two required roots. DOWNLOAD_PATH is where ingest writes (patreon-dl
# staging, flattened audio, Drive/external downloads). LIBRARY_PATH is the
# user's curated archive that FileBrowser browses. They must be different
# directories for the split to mean anything; the runtime check below makes
# the misconfiguration noisy instead of silently broken.
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
OLLAMA_MODEL    = os.environ.get("OLLAMA_MODEL", "qwen2.5vl:7b")

# Read the version from pyproject.toml so the frontend status bar can show it.
def _read_version() -> str:
    try:
        path = Path(__file__).parent / "pyproject.toml"
        with path.open("rb") as f:
            return tomllib.load(f)["project"]["version"]
    except Exception:
        return "unknown"

APP_VERSION = _read_version()

# ── Shared helpers ────────────────────────────────────────────────────────────

def require_non_empty(value: str, field: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise HTTPException(400, f"{field} cannot be empty")
    return stripped


def validate_under_root(rel_path: str, root: Path) -> Path:
    """Resolve `rel_path` under `root` and reject any path that escapes it.

    Uses is_relative_to so a sibling directory like /mnt/audio_evil doesn't
    satisfy a naive prefix check against /mnt/audio (Python 3.9+).
    """
    resolved = (root / rel_path.strip()).resolve()
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


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok"}

# ── System info (model name + app version for the UI status bar) ─────────────
@app.get("/api/system/info")
def system_info():
    return {"model": OLLAMA_MODEL, "version": APP_VERSION}

# ── Vision extraction via Ollama ──────────────────────────────────────────────

def _vocab_section() -> str:
    """Return the vocabulary injection block for Ollama prompts, or empty string."""
    vocab = database.get_vocabulary()
    if not vocab:
        return ""
    tag_list = "\n".join(f"  - {e['canonical']}" for e in vocab)
    return (
        "\nKnown tag vocabulary — use these canonical forms when the extracted tag matches:\n"
        + tag_list
        + "\nIf a tag doesn't match any entry, return it verbatim.\n"
    )


def _build_extract_prompt() -> str:
    """Build the Ollama vision extraction prompt, injecting the current vocabulary."""
    return (
        "Look at this ASMR post screenshot and identify these regions.\n"
        "Return valid JSON only:\n\n"
        "{\n"
        '  "raw_title_line": "the full first heading text exactly as written",\n'
        '  "raw_pill_tags": ["each pill/badge tag at the bottom — one entry per badge, keep multi-word badges as a single string verbatim"],\n'
        '  "creator_name": "the channel or creator name shown near a profile picture or avatar, or null if not visible",\n'
        '  "creator_confidence": "high if a clear creator name with profile picture was found, low otherwise"\n'
        "}"
        + _vocab_section()
    )


def _build_preview_prompt(text: str) -> str:
    """Build a text-only Ollama prompt for the dictionary test pane preview."""
    return (
        "Parse this ASMR post text. Extract the full title line and any separate tags.\n"
        "Tags may be short labels or longer descriptive phrases — keep each tag as a single string, do not split multi-word tags.\n"
        "Return valid JSON only:\n\n"
        "{\n"
        '  "raw_title_line": "the full title text as written",\n'
        '  "raw_pill_tags": ["each tag as one string — multi-word tags stay together"]\n'
        "}\n"
        + _vocab_section()
        + "\nText to parse:\n"
        + text
    )


async def _call_ollama(payload: dict) -> str:
    """POST a chat payload to Ollama and return the response content string."""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
        r.raise_for_status()
        return r.json().get("message", {}).get("content", "")
    except httpx.ConnectError:
        raise HTTPException(502, f"Cannot reach Ollama at {OLLAMA_BASE_URL}")
    except httpx.TimeoutException:
        raise HTTPException(504, "Ollama timed out — try a smaller model")
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"Ollama error {e.response.status_code}: {e.response.text}")


class ExtractIn(BaseModel):
    image_b64: str          # raw base64, no data-URL prefix
    model: Optional[str] = None   # override model at runtime

@app.post("/api/extract")
async def extract(body: ExtractIn):
    if len(body.image_b64) > MAX_IMAGE_B64_BYTES:
        raise HTTPException(
            413,
            f"Image too large ({len(body.image_b64)} bytes of base64). "
            f"Limit is {MAX_IMAGE_B64_BYTES} bytes.",
        )
    model = body.model or OLLAMA_MODEL
    prompt = _build_extract_prompt()
    payload = {
        "model": model,
        "stream": False,
        "messages": [{"role": "user", "content": prompt, "images": [body.image_b64]}],
    }
    raw_text = await _call_ollama(payload)
    return {"raw_text": raw_text}


# ── Text-based tag preview (dictionary test pane) ─────────────────────────────

class PreviewTagsIn(BaseModel):
    text: str

@app.post("/api/preview-tags")
async def preview_tags(body: PreviewTagsIn):
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "text cannot be empty")
    prompt = _build_preview_prompt(text)
    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [{"role": "user", "content": prompt}],
    }
    raw_text = await _call_ollama(payload)
    return {"raw_text": raw_text}


# ── Metadata writing ──────────────────────────────────────────────────────────

# Maps field name → (ID3 tag id, ID3 tag class) for MP3
_MP3_TAGS = {
    "title":        ("TIT2", TIT2),
    "artist":       ("TPE1", TPE1),
    "album":        ("TALB", TALB),
    "album_artist": ("TPE2", TPE2),
}
# Maps field name → Vorbis comment key for FLAC/OGG
_VORBIS_TAGS = {
    "title": "title", "artist": "artist", "album": "album", "album_artist": "albumartist",
}
# Maps field name → MP4 atom key for M4A/AAC
_M4A_TAGS = {
    "title": "\xa9nam", "artist": "\xa9ART", "album": "\xa9alb", "album_artist": "aART",
}


def _write_metadata(path: Path, title: str, artist: str, album: str, album_artist: str) -> None:
    """Write title/artist/album/album_artist tags to a metadata-compatible audio file."""
    ext = path.suffix.lower()
    fields = {"title": title, "artist": artist, "album": album, "album_artist": album_artist}

    if ext == ".mp3":
        try:
            audio = ID3(str(path))
        except ID3NoHeaderError:
            audio = ID3()
        for field, value in fields.items():
            if value:
                tag_id, tag_cls = _MP3_TAGS[field]
                audio.setall(tag_id, [tag_cls(encoding=3, text=value)])
        audio.save(str(path))

    elif ext in (".flac", ".ogg"):
        audio = FLAC(str(path)) if ext == ".flac" else OggVorbis(str(path))
        for field, value in fields.items():
            if value:
                audio[_VORBIS_TAGS[field]] = [value]
        audio.save()

    elif ext in (".m4a", ".aac"):
        audio = MP4(str(path))
        for field, value in fields.items():
            if value:
                audio[_M4A_TAGS[field]] = [value]
        audio.save()


# ── File browser ──────────────────────────────────────────────────────────────

METADATA_COMPATIBLE_EXTS = set(_FORMATS_CONFIG["metadataCompatibleExts"])
NEEDS_CONVERSION_EXTS    = set(_FORMATS_CONFIG["needsConversionExts"])
AUDIO_EXTS               = METADATA_COMPATIBLE_EXTS | NEEDS_CONVERSION_EXTS
OUTPUT_FORMATS           = _FORMATS_CONFIG["outputFormats"]

QUALITY_FLAGS: dict[str, dict[str, list[str]]] = {
    "mp3": {
        # VBR: -q:a 0 = best (~220-260kbps avg), 9 = worst (~45-85kbps avg)
        "low":      ["-codec:a", "libmp3lame", "-q:a", "7"],   # ~96-112kbps avg
        "standard": ["-codec:a", "libmp3lame", "-q:a", "4"],   # ~140-185kbps avg
        "high":     ["-codec:a", "libmp3lame", "-q:a", "2"],   # ~170-210kbps avg
        "best":     ["-codec:a", "libmp3lame", "-q:a", "0"],   # ~220-260kbps avg
    },
    "flac": {
        "lossless": ["-codec:a", "flac", "-compression_level", "8", "-ar", "44100", "-sample_fmt", "s16"],
    },
    "ogg": {
        "low":      ["-codec:a", "libvorbis", "-q:a", "3"],
        "standard": ["-codec:a", "libvorbis", "-q:a", "5"],
        "high":     ["-codec:a", "libvorbis", "-q:a", "7"],
        "best":     ["-codec:a", "libvorbis", "-q:a", "9"],
    },
}

@app.get("/api/files")
def list_files(subdir: str = "", root: str = "library"):
    """List files and subdirectories inside `<root>/subdir` (one level).
    Default root is library; downloads surfaces the ingest staging tree.
    """
    root_path = root_for(root)
    target = validate_under_root(subdir, root_path)
    if not target.exists():
        raise HTTPException(404, "Directory not found")
    if not target.is_dir():
        raise HTTPException(400, "Not a directory")

    entries = []
    for entry in sorted(target.iterdir(), key=lambda e: (e.is_file(), e.name.lower())):
        ext = entry.suffix.lower() if entry.is_file() else None
        entries.append({
            "name": entry.name,
            "type": "file" if entry.is_file() else "dir",
            "ext": ext,
            "path": str(entry.relative_to(root_path)),
            "needs_conversion": entry.is_file() and ext in NEEDS_CONVERSION_EXTS,
        })

    return {
        "current": str(target.relative_to(root_path)) if target != root_path else "",
        "root": root,
        "entries": entries,
    }


# Directories pruned during the audio search walk. These are noisy and never
# contain user audio: patreon-dl's own working dir, dotfiles, common
# build/cache dirs that may end up under LIBRARY_PATH if the user re-purposes
# the mount.
_SEARCH_PRUNE_DIRS = {".patreon-dl", ".git", "node_modules", "__pycache__", ".DS_Store"}

# Hard cap on returned results. With the FileBrowser fetching the index
# upfront, an unbounded match list would balloon the response payload and
# the React tree. Truncate and tell the caller.
_SEARCH_RESULT_LIMIT = 500


@app.get("/api/files/search")
def search_files(
    q: str = "",
    search_in: str = "filename",
    root: str = "library",
    subdir: str = "",
):
    """
    Recursively walk the chosen root and return all audio/video files.
    search_in: "filename" | "folder" | "both"
    root: "library" | "downloads"
    subdir: optional relative path to scope the walk under. When set, the
        walk starts at `<root>/<subdir>` so the explorer's "search in
        the current folder" UX matches real file explorers (typing in
        the filter while inside `Solar Girl ASMR/` searches that subtree
        only, not the whole library).

    Filters apply during the walk (extension + query), hidden / cache /
    patreon-dl-working directories are pruned in place, and the result list
    is capped at _SEARCH_RESULT_LIMIT entries. Sort is applied to the kept
    results only.
    """
    root_path = root_for(root).resolve()
    if not root_path.exists():
        raise HTTPException(
            404,
            f"Audio root not found at {root_path} — check the {root.upper()}_PATH mount",
        )

    q_lower = q.strip().lower()
    if search_in not in ("filename", "folder", "both"):
        raise HTTPException(400, "search_in must be 'filename', 'folder', or 'both'")

    # Scope the walk to `subdir` when provided. Reuses the shared validator
    # so a `..` segment or an absolute path can't escape the root.
    if subdir.strip():
        scope = validate_under_root(subdir, root_path)
        if not scope.exists() or not scope.is_dir():
            raise HTTPException(404, f"Folder not found under {root}: {subdir}")
    else:
        scope = root_path

    results: list[dict] = []
    truncated = False

    try:
        for dirpath, dirnames, filenames in os.walk(scope):
            # Prune in place so os.walk doesn't descend into noisy subtrees.
            dirnames[:] = [
                d for d in dirnames
                if d not in _SEARCH_PRUNE_DIRS and not d.startswith(".")
            ]
            rel_dir = Path(dirpath).relative_to(root_path)
            folder = "" if str(rel_dir) == "." else str(rel_dir)
            folder_lc = folder.lower()
            for name in filenames:
                ext = Path(name).suffix.lower()
                if ext not in AUDIO_EXTS:
                    continue
                if q_lower:
                    name_lc = name.lower()
                    match_name = q_lower in name_lc
                    match_folder = q_lower in folder_lc
                    if search_in == "filename" and not match_name:
                        continue
                    if search_in == "folder" and not match_folder:
                        continue
                    if search_in == "both" and not (match_name or match_folder):
                        continue
                rel_path = str(rel_dir / name) if folder else name
                results.append({
                    "name": name,
                    "ext": ext,
                    "path": rel_path,
                    "folder": folder,
                    "needs_conversion": ext in NEEDS_CONVERSION_EXTS,
                })
                if len(results) >= _SEARCH_RESULT_LIMIT:
                    truncated = True
                    break
            if truncated:
                break
    except PermissionError as e:
        raise HTTPException(500, f"Permission error scanning files: {e}")

    results.sort(key=lambda r: (r["folder"].lower(), r["name"].lower()))

    response: dict = {
        "query": q,
        "search_in": search_in,
        "root": root,
        "subdir": subdir,
        "total": len(results),
        "files": results,
    }
    if truncated:
        response["truncated"] = True
        response["limit"] = _SEARCH_RESULT_LIMIT
    return response


@app.get("/api/files/debug")
def debug_files(root: str = "library"):
    """Show what's visible at the chosen root — diagnoses mount issues."""
    root_path = root_for(root).resolve()
    env_name = f"{root.upper()}_PATH"
    if not root_path.exists():
        return {"error": f"{env_name} does not exist: {root_path}", "root_path": str(root_path), "root": root}

    top_level = []
    try:
        for entry in sorted(root_path.iterdir(), key=lambda e: e.name.lower())[:20]:
            top_level.append({
                "name": entry.name,
                "type": "dir" if entry.is_dir() else "file",
            })
    except Exception as e:
        return {"error": str(e), "root_path": str(root_path), "root": root}

    return {
        "root": root,
        "root_path": str(root_path),
        "exists": True,
        "top_level_entries": top_level,
        "top_level_count": len(top_level),
    }

# ── Folder creation + cross-root move ────────────────────────────────────────
#
# Two endpoints power the "Move to library" flow built into SelectedFilePanel
# (and the standalone "New folder" affordance on the Library tab):
#
#   • /api/mkdir creates a subfolder under LIBRARY_PATH. Both the move-flow
#     picker's inline "New folder…" input AND the Library tab's standalone
#     "New folder" button route here, so there's one server-side validator
#     for folder-name shape regardless of where the user starts.
#
#   • /api/move handles the optional "move from downloads (or library) into
#     a chosen library subfolder" step. Source can be in either root;
#     destination is always LIBRARY_PATH. shutil.move (not Path.rename) so
#     the operation works across mounts — DOWNLOAD_PATH and LIBRARY_PATH
#     will often be on different volumes in real setups.


def _validate_folder_name(name: str) -> str:
    """Reject folder names that would escape the validator or create dotfiles
    the FileBrowser hides. Returns the cleaned name."""
    name = name.strip()
    if not name:
        raise HTTPException(400, "Folder name cannot be empty.")
    if "/" in name or "\\" in name:
        raise HTTPException(400, "Names can't contain `/` or `\\`.")
    if name in (".", ".."):
        raise HTTPException(400, "Invalid folder name.")
    if name.startswith("."):
        raise HTTPException(400, "Folder names can't start with a dot.")
    return name


class MkdirIn(BaseModel):
    subdir: str                   # the new folder name (single segment, no slashes)
    parent: Optional[str] = None  # relative path under LIBRARY_PATH (empty = root)


@app.post("/api/mkdir", status_code=201)
def make_directory(body: MkdirIn):
    """Create a single subfolder under LIBRARY_PATH/<parent>/.

    Scoped to LIBRARY_PATH only — DOWNLOAD_PATH is transient working storage
    that the user doesn't curate. The 409 on name collision matches the
    Patreon-fetch + rename idiom so the frontend has one error-handling path.
    """
    subdir = _validate_folder_name(body.subdir)
    parent_rel = (body.parent or "").strip()
    target_rel = f"{parent_rel}/{subdir}" if parent_rel else subdir
    target = validate_under_library(target_rel)
    if target.exists():
        raise HTTPException(409, "That name already exists.")
    try:
        target.mkdir(parents=True, exist_ok=False)
    except OSError as e:
        raise HTTPException(500, f"Couldn't create folder: {e}")
    return {
        "created": True,
        "path": str(target.relative_to(LIBRARY_PATH.resolve())),
        "name": target.name,
    }


class MetadataIn(BaseModel):
    """Tag fields embedded after a rename or a rename-during-move.

    Shared by /api/rename and /api/move so a move-with-new-name can also
    write the user-supplied title/artist/album tags in one server round-
    trip — matching the rename-and-embed pattern the rename endpoint has
    always supported."""
    title: str = ""
    artist: str = ""
    album: str = ""
    album_artist: str = ""


class MoveIn(BaseModel):
    from_path: str                # relative path of the source (file OR folder)
    from_root: str                # "library" | "downloads"
    to_subdir: str                # destination folder relative to LIBRARY_PATH ("" = root)
    new_name: Optional[str] = None  # optional rename during the move
    metadata: Optional[MetadataIn] = None  # tags to embed after the move (only when dest is a metadata-compatible audio file)


def _plan_move(
    from_path: str,
    from_root: str,
    to_subdir: str,
    new_name: Optional[str],
) -> tuple[Path, Path]:
    """Validate a single move request and return (src, dest) absolute paths.

    Centralises the file-or-folder rules shared by /api/move and
    /api/move/batch: existence, cycle protection (no folder into itself),
    destination-folder existence, filename shape + 255-byte cap, collision
    rejection. Raises HTTPException on any failure so single-item callers
    surface the matching status code; the batch caller converts each
    exception into a per-item error entry.
    """
    src_root = root_for(from_root)
    src = validate_under_root(from_path, src_root)
    require_file(src)  # checks existence; misnamed but applies to dirs too

    to_subdir_clean = (to_subdir or "").strip()
    dest_dir = validate_under_library(to_subdir_clean)
    if not dest_dir.exists():
        raise HTTPException(404, "Destination folder does not exist.")
    if not dest_dir.is_dir():
        raise HTTPException(400, "Destination is not a folder.")

    # Cycle protection: when src is a folder, dest can't be inside it.
    # Compare resolved paths so symlinks can't smuggle a cycle past us.
    if src.is_dir():
        src_resolved = src.resolve()
        dest_resolved = dest_dir.resolve()
        if dest_resolved == src_resolved or src_resolved in dest_resolved.parents:
            raise HTTPException(400, "Can't move a folder into itself.")

    final_name = (new_name or src.name).strip()
    if not final_name or "/" in final_name or "\\" in final_name:
        raise HTTPException(400, "Invalid name.")
    name_bytes = len(final_name.encode("utf-8"))
    if name_bytes > 255:
        raise HTTPException(
            422,
            f"Name too long: {name_bytes} bytes (max 255). Shorten it.",
        )

    dest_rel = (
        f"{dest_dir.relative_to(LIBRARY_PATH.resolve())}/{final_name}"
        if to_subdir_clean
        else final_name
    )
    dest = validate_under_library(dest_rel)
    if dest.exists():
        raise HTTPException(
            409,
            "Something with that name already exists at the destination.",
        )
    return src, dest


@app.post("/api/move")
def move_file(body: MoveIn):
    """Move a file or folder from `from_root` into LIBRARY_PATH/<to_subdir>/,
    optionally renaming during the move so the user can do "rename + move"
    atomically. When the destination is a metadata-compatible audio file
    and `body.metadata` is set, tags are written after the move — same
    behaviour as /api/rename's optional metadata embed.

    Source can be a file (the SelectedFilePanel rename+move case) or a
    folder (the explorer's cut+paste-folder case). shutil.move handles
    both natively, including cross-mount falls-back to copytree + rmtree.
    Filename / foldername collisions return 409 — no silent overwrites.
    """
    src, dest = _plan_move(body.from_path, body.from_root, body.to_subdir, body.new_name)
    try:
        shutil.move(str(src), str(dest))
    except OSError as e:
        raise HTTPException(500, f"Move failed: {e}")

    # Optional metadata embed after the move. Quietly skipped for folder
    # moves and for files whose suffix can't carry tags — those paths just
    # return the plain `moved: True` response and never expose
    # metadata_error. Mirrors the /api/rename pattern: tag-write failures
    # don't fail the move (the file is on disk where the user asked), they
    # surface as a partial-success field the client can show as a warning.
    metadata_error: Optional[str] = None
    if (
        body.metadata
        and dest.is_file()
        and dest.suffix.lower() in METADATA_COMPATIBLE_EXTS
        and any([
            body.metadata.title,
            body.metadata.artist,
            body.metadata.album,
            body.metadata.album_artist,
        ])
    ):
        try:
            _write_metadata(
                dest,
                body.metadata.title,
                body.metadata.artist,
                body.metadata.album,
                body.metadata.album_artist,
            )
        except Exception as e:
            metadata_error = str(e)

    return {
        "moved": True,
        "to_path": str(dest.relative_to(LIBRARY_PATH.resolve())),
        "new_name": dest.name,
        **({"metadata_error": metadata_error} if metadata_error else {}),
    }


class MoveBatchItem(BaseModel):
    from_path: str
    new_name: Optional[str] = None  # rename-during-move (rarely useful in batch)


class MoveBatchIn(BaseModel):
    items: list[MoveBatchItem]
    from_root: str               # one source root for the whole batch
    to_subdir: str               # one destination subdir under LIBRARY_PATH


def _map_move_error_code(exc: HTTPException) -> str:
    """Translate an HTTPException raised by `_plan_move` into a stable
    error.code string the client branches on. Decoupled from the
    user-facing detail message so future copy tweaks don't change the
    code contract."""
    if exc.status_code == 409:
        return "collision"
    if exc.status_code == 404:
        return "not_found"
    if exc.status_code == 400 and "itself" in str(exc.detail):
        return "cycle"
    if exc.status_code in (400, 422):
        return "validation"
    return "other"


@app.post("/api/move/batch")
async def move_batch(body: MoveBatchIn):
    """Move many files / folders into a single LIBRARY_PATH destination.

    Returns `text/event-stream` with one `data:` frame per item plus a
    final `complete` frame whose payload matches the old JSON response
    shape (`{ moved, results }`). Streaming has two payoffs over the
    previous synchronous-JSON design:

      1. Each `shutil.move` runs in `asyncio.to_thread`, so a slow
         cross-mount copy doesn't hold the FastAPI threadpool slot
         for the entire batch.
      2. The client sees per-item progress ("Moving 3 / 5…") instead
         of a multi-minute spinner with no feedback. Matches the
         existing `/api/patreon/ingest-drive-link` SSE pattern.

    Partial-success-friendly: any single item's failure becomes an
    `item` frame with `ok: false` + an error code, and the loop
    continues to the next.
    """
    items = list(body.items)

    async def gen():
        results: list[dict] = []
        moved = 0
        total = len(items)
        yield f"data: {json.dumps({'event': 'started', 'total': total})}\n\n"
        for i, item in enumerate(items):
            entry: dict
            try:
                src, dest = _plan_move(
                    item.from_path,
                    body.from_root,
                    body.to_subdir,
                    item.new_name,
                )
                # Run the actual filesystem move off the event loop so
                # the SSE generator stays responsive while a multi-
                # gigabyte cross-mount copy is in flight.
                await asyncio.to_thread(shutil.move, str(src), str(dest))
                entry = {
                    "from_path": item.from_path,
                    "ok": True,
                    "to_path": str(dest.relative_to(LIBRARY_PATH.resolve())),
                }
                moved += 1
            except HTTPException as e:
                entry = {
                    "from_path": item.from_path,
                    "ok": False,
                    "error": {
                        "code": _map_move_error_code(e),
                        "message": str(e.detail),
                    },
                }
            except OSError as e:
                entry = {
                    "from_path": item.from_path,
                    "ok": False,
                    "error": {"code": "other", "message": f"Move failed: {e}"},
                }
            results.append(entry)
            yield (
                "data: "
                + json.dumps({"event": "item", "index": i, "total": total, **entry})
                + "\n\n"
            )
        yield (
            "data: "
            + json.dumps({"event": "complete", "moved": moved, "results": results})
            + "\n\n"
        )

    return StreamingResponse(gen(), media_type="text/event-stream")


class DeleteIn(BaseModel):
    path: str                          # relative path under the chosen root
    root: str = "library"              # "library" | "downloads"
    # When False (default), folder deletes are non-recursive: empty folders
    # succeed, non-empty folders return 409 with the contents count so the
    # client can show a "delete N items inside?" confirmation. Files ignore
    # this flag (a file delete is always a single-target unlink).
    recursive: bool = False


@app.post("/api/delete")
def delete_path(body: DeleteIn):
    """Delete a file or folder under the chosen root.

    Semantics:
      • file       → unlink. `recursive` ignored.
      • empty dir  → rmdir. Succeeds whether `recursive` is true or false.
      • non-empty dir + recursive=True  → shutil.rmtree.
      • non-empty dir + recursive=False → 409 with the contents count so
        the client can re-prompt the user before re-issuing with
        `recursive=true`. No silent recursive deletes.

    Refuses to delete the root itself defensively (`""` or `.`) — that
    would wipe LIBRARY_PATH or DOWNLOAD_PATH out from under us.
    """
    root_path = root_for(body.root)
    rel = (body.path or "").strip().strip("/")
    if not rel or rel in (".", ".."):
        raise HTTPException(400, "Refusing to delete the root directory.")

    target = validate_under_root(rel, root_path)
    if not target.exists():
        raise HTTPException(404, "Path does not exist.")

    if target.is_file():
        try:
            target.unlink()
        except OSError as e:
            raise HTTPException(500, f"Delete failed: {e}")
        return {"deleted": True, "kind": "file", "path": rel}

    if not target.is_dir():
        raise HTTPException(400, "Path is neither a file nor a folder.")

    # Empty-folder fast path — rmdir succeeds only when the dir has no
    # children, which is exactly what we want.
    try:
        target.rmdir()
        return {"deleted": True, "kind": "folder_empty", "path": rel}
    except OSError:
        # Non-empty. Either the caller is opting into recursive delete
        # (proceed) or they aren't (return the contents count so the UI
        # can prompt before recursing).
        pass

    if not body.recursive:
        try:
            count = sum(1 for _ in target.rglob("*"))
        except OSError:
            count = -1  # best effort — non-zero is enough to drive the prompt
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Folder is not empty.",
                "count": count,
                "path": rel,
            },
        )

    try:
        shutil.rmtree(target)
    except OSError as e:
        raise HTTPException(500, f"Recursive delete failed: {e}")
    return {"deleted": True, "kind": "folder_recursive", "path": rel}


class RenamePathIn(BaseModel):
    path: str                          # current relative path (file OR folder)
    new_name: str                      # new last-segment name; same parent
    root: str = "library"              # "library" | "downloads"


@app.post("/api/rename-path")
def rename_path(body: RenamePathIn):
    """Rename a file or folder in place (same parent directory).

    Different from `/api/rename`:
      • `/api/rename` is file-only and exists to combine the filename
        change with an optional ID3/FLAC/MP4 metadata embed. It enforces
        the metadata-compatible-format gate and rejects folders.
      • This endpoint handles the general case: any file (regardless of
        extension) or any folder. No metadata embed.

    The Library explorer's right-click Rename + F2 shortcut drive this.
    """
    root_path = root_for(body.root)
    rel = (body.path or "").strip().strip("/")
    if not rel or rel in (".", ".."):
        raise HTTPException(400, "Refusing to rename the root directory.")

    src = validate_under_root(rel, root_path)
    if not src.exists():
        raise HTTPException(404, "Path does not exist.")

    new_name = body.new_name.strip()
    if not new_name or "/" in new_name or "\\" in new_name:
        raise HTTPException(400, "Names can't contain `/` or `\\`.")
    if new_name in (".", ".."):
        raise HTTPException(400, "Invalid name.")
    if new_name.startswith("."):
        raise HTTPException(400, "Names can't start with a dot.")

    name_bytes = len(new_name.encode("utf-8"))
    if name_bytes > 255:
        raise HTTPException(
            422,
            f"Name too long: {name_bytes} bytes (max 255).",
        )

    if new_name == src.name:
        # No-op rename — short-circuit so we don't bounce a 409 off
        # ourselves via dest.exists() below.
        return {
            "renamed": False,
            "old_name": src.name,
            "new_name": src.name,
            "path": rel,
            "root": body.root,
            "kind": "folder" if src.is_dir() else "file",
        }

    parent_rel = src.parent.relative_to(root_path.resolve())
    dest_rel = (
        f"{parent_rel}/{new_name}"
        if str(parent_rel) not in ("", ".")
        else new_name
    )
    dest = validate_under_root(dest_rel, root_path)
    if dest.exists():
        kind = "folder" if dest.is_dir() else "file"
        raise HTTPException(
            409,
            f"A {kind} with that name already exists.",
        )

    try:
        src.rename(dest)
    except OSError as e:
        if e.errno == 36:  # ENAMETOOLONG
            raise HTTPException(422, "Name too long for the filesystem.")
        raise HTTPException(500, f"Rename failed: {e}")

    return {
        "renamed": True,
        "old_name": src.name,
        "new_name": dest.name,
        "path": str(dest.relative_to(root_path.resolve())),
        "root": body.root,
        "kind": "folder" if dest.is_dir() else "file",
    }


# ── Rename ────────────────────────────────────────────────────────────────────

class RenameIn(BaseModel):
    path: str                           # relative path to file inside the chosen root
    new_name: str                       # new filename (just the name, no path)
    root: str = "library"               # "library" | "downloads"
    metadata: Optional[MetadataIn] = None   # tags to embed after rename

@app.post("/api/rename")
def rename_file(body: RenameIn):
    root_path = root_for(body.root)
    src = validate_under_root(body.path, root_path)
    require_file(src)
    if not src.is_file():
        raise HTTPException(400, "Path is not a file")

    # Block rename for formats that don't support embedded metadata
    if src.suffix.lower() not in METADATA_COMPATIBLE_EXTS:
        raise HTTPException(
            422,
            f"Cannot rename {src.suffix} files — convert to a metadata-compatible format first (MP3, FLAC, AAC, or OGG)",
        )

    new_name = body.new_name.strip()
    if not new_name or "/" in new_name or "\\" in new_name:
        raise HTTPException(400, "Invalid filename")

    dest = validate_under_root(str(src.parent.relative_to(root_path) / new_name), root_path)
    reject_if_exists(dest)

    # Linux max filename length is 255 bytes (not chars — encode to check)
    name_bytes = len(new_name.encode("utf-8"))
    if name_bytes > 255:
        raise HTTPException(422, f"Filename too long: {name_bytes} bytes (max 255). Remove some tags to shorten it.")

    try:
        src.rename(dest)
    except OSError as e:
        if e.errno == 36:  # ENAMETOOLONG
            raise HTTPException(422, f"Filename too long ({len(new_name)} chars). Remove some tags to shorten it.")
        raise HTTPException(500, f"Rename failed: {e}")

    metadata_error: Optional[str] = None
    if body.metadata and any([
        body.metadata.title, body.metadata.artist,
        body.metadata.album, body.metadata.album_artist,
    ]):
        try:
            _write_metadata(
                dest,
                body.metadata.title,
                body.metadata.artist,
                body.metadata.album,
                body.metadata.album_artist,
            )
        except Exception as e:
            metadata_error = str(e)

    return {
        "renamed": True,
        "old_name": src.name,
        "new_name": dest.name,
        "path": str(dest.relative_to(root_path)),
        "root": body.root,
        **({"metadata_error": metadata_error} if metadata_error else {}),
    }

# ── Convert ───────────────────────────────────────────────────────────────────

@app.get("/api/convert/formats")
def get_convert_formats():
    """Return the list of supported output formats for conversion."""
    return OUTPUT_FORMATS


class ConvertIn(BaseModel):
    path: str               # relative path inside the chosen root
    output_format: str      # "mp3" | "flac" | "aac" | "ogg"
    quality: str            # "low" | "standard" | "high" | "best" | "lossless"
    root: str = "library"   # "library" | "downloads"
    delete_original: bool = False


@app.post("/api/convert")
def convert_file(body: ConvertIn):
    root_path = root_for(body.root)
    src = validate_under_root(body.path, root_path)
    require_file(src)
    if not src.is_file():
        raise HTTPException(400, "Path is not a file")
    if src.suffix.lower() not in AUDIO_EXTS:
        raise HTTPException(400, f"{src.suffix} is not a supported audio format")

    fmt = body.output_format.lower()
    if fmt not in QUALITY_FLAGS:
        raise HTTPException(400, f"Unsupported output format: {fmt}")

    quality = body.quality.lower()
    if quality not in QUALITY_FLAGS[fmt]:
        raise HTTPException(400, f"Unsupported quality '{quality}' for format '{fmt}'")

    fmt_info = next(f for f in OUTPUT_FORMATS if f["value"] == fmt)
    if src.suffix.lower() == fmt_info["ext"]:
        raise HTTPException(400, "File is already in this format")
    dest = src.with_suffix(fmt_info["ext"])
    reject_if_exists(dest)

    codec_flags = QUALITY_FLAGS[fmt][quality]
    cmd = ["ffmpeg", "-i", str(src), "-vn"] + codec_flags + [str(dest)]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except FileNotFoundError:
        raise HTTPException(500, "ffmpeg not found — make sure it is installed")
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Conversion timed out")

    if result.returncode != 0:
        # Log the full stderr server-side; return a generic message to the
        # client so internal filesystem paths and command lines don't leak.
        log.error("ffmpeg conversion failed for %s: %s", src.name, result.stderr)
        raise HTTPException(500, "Conversion failed. Check the server log for ffmpeg output.")

    if body.delete_original:
        try:
            src.unlink()
        except OSError:
            pass  # Don't fail the request if original delete fails

    return {
        "converted": True,
        "old_name": src.name,
        "new_name": dest.name,
        "path": str(dest.relative_to(root_path)),
        "root": body.root,
    }


# ── Settings (key/value) ──────────────────────────────────────────────────────

PATREON_COOKIE_KEY = "patreon_cookie"
GOOGLE_COOKIE_KEY = "google_cookie"

# Drive scrapes serialise per-account because Google's mid-stream
# `RotateCookies` race lets only the last concurrent session win — losers
# get ~1 KB probe-shaped responses. Raise capacity only when scraping
# different accounts where rotations can't collide.
_DRIVE_SCRAPE_CAPACITY = max(1, int(os.environ.get("DRIVE_SCRAPE_CONCURRENCY", "1")))
_drive_scrape_lock = asyncio.Semaphore(_DRIVE_SCRAPE_CAPACITY)
# Plain int — single-event-loop concurrency means `+=`/`-=` need no lock.
_drive_scrape_pending = 0

# Playwright accepts only these three sameSite values. Browser cookie APIs use
# different vocabularies — Chrome ("no_restriction"|"lax"|"strict"|"unspecified")
# and Firefox ("no_restriction"|"lax"|"strict"). Normalise here so the
# extension can dump cookies in whatever shape its host browser produces.
_SAMESITE_NORMALISE = {
    "no_restriction": "None",
    "none":           "None",
    "lax":            "Lax",
    "strict":         "Strict",
    "unspecified":    "Lax",
}


def _normalise_cookie_for_playwright(raw: dict) -> Optional[dict]:
    """Reshape one cookie object from chrome.cookies.getAll() into the shape
    `playwright.async_api.BrowserContext.add_cookies` expects. Returns None
    for entries that lack the minimum required fields.

    Required (per Playwright): name, value, and either (domain+path) or url.
    Optional: expires, httpOnly, secure, sameSite.
    """
    if not isinstance(raw, dict):
        return None
    name = raw.get("name")
    value = raw.get("value")
    domain = raw.get("domain")
    if not (isinstance(name, str) and isinstance(value, str) and isinstance(domain, str)):
        return None
    out: dict = {"name": name, "value": value, "domain": domain, "path": raw.get("path") or "/"}
    if raw.get("httpOnly") is True:
        out["httpOnly"] = True
    if raw.get("secure") is True:
        out["secure"] = True
    same_site = raw.get("sameSite")
    if isinstance(same_site, str):
        normalised = _SAMESITE_NORMALISE.get(same_site.lower())
        if normalised:
            out["sameSite"] = normalised
    # `expirationDate` is Chrome's name; Firefox uses `expires`. Both come
    # through as a float epoch in seconds. Session cookies omit it entirely.
    expires = raw.get("expirationDate", raw.get("expires"))
    if isinstance(expires, (int, float)) and expires > 0:
        out["expires"] = float(expires)
    return out


@app.get("/api/settings/patreon-cookie")
def get_patreon_cookie():
    value = database.get_setting(PATREON_COOKIE_KEY) or ""
    return {"set": bool(value), "length": len(value)}


@app.put("/api/settings/patreon-cookie")
async def set_patreon_cookie(request: Request):
    """Accepts the cookie as either application/json `{"cookie": "..."}` or as
    a raw text/plain body. The text/plain path lets you `curl --data-binary @cookie.txt`
    without JSON-escaping the embedded quotes in `g_state={...}` etc."""
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()

    if content_type == "application/json":
        try:
            data = await request.json()
        except ValueError:
            raise HTTPException(400, "Invalid JSON body")
        if not isinstance(data, dict):
            raise HTTPException(400, "JSON body must be an object")
        cookie = str(data.get("cookie") or "").strip()
    else:
        cookie = (await request.body()).decode("utf-8", errors="replace").strip()

    if not cookie:
        database.delete_setting(PATREON_COOKIE_KEY)
        return {"set": False, "length": 0}
    database.set_setting(PATREON_COOKIE_KEY, cookie)
    return {"set": True, "length": len(cookie)}


@app.get("/api/settings/google-cookie")
def get_google_cookie():
    """Status of the stored Google session cookie.

    Returns count of cookies and total stored byte size — never the values
    themselves (they include long-lived auth tokens equivalent to a password)."""
    value = database.get_setting(GOOGLE_COOKIE_KEY) or ""
    if not value:
        return {"set": False, "count": 0, "length": 0}
    try:
        parsed = json.loads(value)
        count = len(parsed) if isinstance(parsed, list) else 0
    except (ValueError, json.JSONDecodeError):
        count = 0
    return {"set": True, "count": count, "length": len(value)}


@app.put("/api/settings/google-cookie")
async def set_google_cookie(request: Request):
    """Store a Google session cookie. Body: `{"cookies": [...]}` where each
    entry is a chrome.cookies.getAll-style object. The backend reshapes them
    into Playwright's expected format; entries missing required fields are
    silently dropped. An empty array clears the setting."""
    try:
        data = await request.json()
    except ValueError:
        raise HTTPException(400, "Invalid JSON body")
    if not isinstance(data, dict):
        raise HTTPException(400, "JSON body must be an object")
    cookies = data.get("cookies")
    if not isinstance(cookies, list):
        raise HTTPException(400, "`cookies` must be an array")

    cleaned: list[dict] = []
    for entry in cookies:
        normalised = _normalise_cookie_for_playwright(entry)
        if normalised is not None:
            cleaned.append(normalised)

    if not cleaned:
        database.delete_setting(GOOGLE_COOKIE_KEY)
        # Drop the shared Playwright context so the next scrape doesn't
        # keep using cookies the user just cleared.
        drive_fetch.invalidate_shared_context()
        return {"set": False, "count": 0, "length": 0}

    serialised = json.dumps(cleaned, separators=(",", ":"))
    database.set_setting(GOOGLE_COOKIE_KEY, serialised)
    # Drop the shared Playwright context so the next scrape picks up the
    # freshly-synced cookies (rather than the rotated set it accumulated
    # from previous scrapes).
    drive_fetch.invalidate_shared_context()
    return {"set": True, "count": len(cleaned), "length": len(serialised)}


# ── Patreon download (patreon-dl wrapper) ─────────────────────────────────────

PATREON_OUTPUT_SUBDIR = ".patreon-dl"


def _validate_iso_date(value: Optional[str], field: str) -> Optional[str]:
    if value is None or value == "":
        return None
    try:
        # Catches both bad shape (regex would miss `9999-99-99`) and impossible
        # calendar dates. patreon-dl wants the canonical YYYY-MM-DD form back.
        return date.fromisoformat(value).isoformat()
    except ValueError as e:
        raise HTTPException(400, f"{field}: {e}")


class PatreonFetchIn(BaseModel):
    url: str
    metadata_only: bool = False
    # Which patreon-dl media types to include. Allowed: "audio", "video", "image",
    # "attachment". None / empty → wrapper default (["audio"]). Ignored when
    # metadata_only=True (no media is downloaded at all).
    content_types: Optional[list[str]] = None
    # ISO YYYY-MM-DD date bounds. Only meaningful for creator URLs.
    published_after: Optional[str] = None
    published_before: Optional[str] = None
    # Walk the pipeline without writing anything (preview only). Returns no
    # parsed posts — the log tail is the preview surface. Status DB is left
    # untouched so previouslyDownloaded dedup stays correct on the real run.
    dry_run: bool = False


@app.post("/api/patreon/fetch")
def patreon_fetch_endpoint(body: PatreonFetchIn):
    url = require_non_empty(body.url, "url")
    cookie = database.get_setting(PATREON_COOKIE_KEY) or ""
    if not cookie:
        raise HTTPException(412, "Patreon cookie is not set — configure it in settings first")

    published_after = _validate_iso_date(body.published_after, "published_after")
    published_before = _validate_iso_date(body.published_before, "published_before")

    output_dir = DOWNLOAD_PATH / PATREON_OUTPUT_SUBDIR
    try:
        result = patreon_fetch(
            url, cookie, output_dir,
            metadata_only=body.metadata_only,
            content_types=body.content_types,
            published_after=published_after,
            published_before=published_before,
            dry_run=body.dry_run,
        )
    except PatreonFetchError as e:
        raise HTTPException(502, str(e))

    download_path = DOWNLOAD_PATH.resolve()

    def _rel(p: Optional[str]) -> Optional[str]:
        if not p:
            return None
        try:
            return str(Path(p).resolve().relative_to(download_path))
        except ValueError:
            return p  # fell outside DOWNLOAD_PATH — return absolute path verbatim

    posts = [
        {
            "post_id": p.post_id,
            "title": p.title,
            "tags": p.tags,
            "artist": p.artist,
            "post_dir": _rel(p.post_dir),
            "audio_path": _rel(p.audio_path),
            "external_links": [
                {"url": link.url, "text": link.text} for link in p.external_links
            ],
        }
        for p in result.posts
    ]
    response = {
        "output_dir": _rel(result.output_dir),
        "count": len(posts),
        "metadata_only": body.metadata_only,
        "dry_run": body.dry_run,
        "posts": posts,
    }
    if body.dry_run:
        # Dry-run never produces post-api.json files, so the parsed list is
        # empty by design. Surface the log tail so the user can see what
        # patreon-dl walked through.
        response["log_tail"] = result.log_tail
        if not posts:
            response["hint"] = (
                "Dry run complete — patreon-dl walked the pipeline without writing files. "
                "Check the log tail for the posts it would have downloaded. "
                "Untoggle 'Dry run' and re-fetch to commit."
            )
    elif not posts:
        response["hint"] = (
            "No new posts were fetched. Most common cause: every matching post is "
            "already in patreon-dl's status cache from a previous run (re-fetches "
            "intentionally skip those — only new posts come back). Other causes: "
            "the URL points to a post you can't access, the cookie has expired, "
            "or the post is gated behind a tier you're not subscribed to. Check "
            "the log tail to confirm which."
        )
        response["log_tail"] = result.log_tail
    return response


# ── External audio ingest ─────────────────────────────────────────────────────
# Two endpoints write under DOWNLOAD_PATH for third-party audio:
# `/api/patreon/ingest-external-audio` (direct download from a cleaned URL)
# and `/api/patreon/ingest-drive-link` (Playwright scrape of a Drive viewer
# URL, defined further down). Shared URL/filename helpers are in
# `backend/audio_utils.py`; see `.claude/rules/architecture.md` for the split.


class IngestExternalAudioIn(BaseModel):
    post_id: str
    source_url: str
    # Optional override; otherwise derived from Content-Disposition or
    # `<post_id>_<timestamp>.<ext>`.
    filename: Optional[str] = None
    # Optional metadata to embed after the download lands. Only honoured for
    # metadata-compatible formats; silently ignored otherwise.
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    album_artist: Optional[str] = None


@app.post("/api/patreon/ingest-external-audio")
async def ingest_external_audio(body: IngestExternalAudioIn):
    post_id = require_non_empty(body.post_id, "post_id")
    if "/" in post_id or "\\" in post_id or post_id.startswith("."):
        raise HTTPException(400, "Invalid post_id")
    source_url = require_non_empty(body.source_url, "source_url")
    if not (source_url.startswith("http://") or source_url.startswith("https://")):
        raise HTTPException(400, "source_url must be http(s)")

    cleaned_url = audio_utils.strip_query_params(source_url)

    # validate_under_download enforces the DOWNLOAD_PATH boundary even if
    # post_id somehow contains traversal segments that slipped past the
    # prefix check.
    dest_dir = validate_under_download(post_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    timeout = httpx.Timeout(connect=15.0, read=300.0, write=60.0, pool=15.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            async with client.stream("GET", cleaned_url) as response:
                if response.status_code >= 400:
                    raise HTTPException(
                        502,
                        f"External host returned {response.status_code} — URL may have expired",
                    )

                content_disposition = response.headers.get("content-disposition")
                content_type = response.headers.get("content-type")
                content_length = response.headers.get("content-length")

                filename = audio_utils.derive_filename(
                    explicit=body.filename,
                    content_disposition=content_disposition,
                    content_type=content_type,
                    fallback_stem=post_id,
                )
                target = audio_utils.unique_destination(dest_dir / filename)
                part = target.with_suffix(target.suffix + ".part")
                try:
                    bytes_written = 0
                    with part.open("wb") as f:
                        async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                            if chunk:
                                f.write(chunk)
                                bytes_written += len(chunk)
                    part.rename(target)
                except Exception:
                    part.unlink(missing_ok=True)
                    raise
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Failed to fetch source_url: {e}")

    # Best-effort metadata embed when the format supports it. Any failure here
    # is non-fatal — the file is on disk either way.
    metadata_error: Optional[str] = None
    if target.suffix.lower() in METADATA_COMPATIBLE_EXTS and any([
        body.title, body.artist, body.album, body.album_artist,
    ]):
        try:
            _write_metadata(
                target,
                body.title or "",
                body.artist or "",
                body.album or "",
                body.album_artist or "",
            )
        except Exception as e:
            metadata_error = f"Metadata embed failed: {e}"

    # target was built from validate_under_download(dest_dir), so it's always
    # inside DOWNLOAD_PATH — relative_to is guaranteed to succeed. We don't fall
    # back to the absolute path because that would leak the server's internal
    # layout.
    audio_path = str(target.relative_to(DOWNLOAD_PATH.resolve()))
    result = {
        "audio_path": audio_path,
        "size": bytes_written,
        "source_url": cleaned_url,
    }
    if content_length and content_length.isdigit() and int(content_length) != bytes_written:
        result["warning"] = (
            f"Downloaded {bytes_written} bytes but Content-Length was {content_length}"
        )
    if metadata_error:
        result["metadata_error"] = metadata_error
    return result


# ── Drive-link ingest (server-side scrape via Playwright) ────────────────────


class IngestDriveLinkIn(BaseModel):
    post_id: str
    drive_url: str
    filename: Optional[str] = None


@app.post("/api/patreon/ingest-drive-link")
async def ingest_drive_link(body: IngestDriveLinkIn):
    """Resolve a Drive viewer URL to its playback URL via headless Chromium,
    clean it, and download into DOWNLOAD_PATH/<post_id>/.

    Returns a `text/event-stream` of progress events. The frontend consumes
    these with fetch + reader.read() rather than the standard JSON wrapper.
    Event shapes (see `drive_fetch.fetch_drive_audio` docstring):

      data: {"state": "launching_browser", "elapsed_s": …}
      data: {"state": "loading_page", "drive_url": "…", "elapsed_s": …}
      data: {"state": "waiting_for_player", "elapsed_s": …}
      data: {"state": "captured", "elapsed_s": …}
      data: {"state": "downloading", "bytes": …, "total": …, "elapsed_s": …}
      …
      data: {"state": "done", "audio_path": "…", "size": …, "source_url": "…", "file_id": "…"}

    On failure:
      data: {"state": "error", "code": "timeout|invalid_url|missing_player|fetch_failed",
             "message": "…", "debug_dir": "…"}

    Requires the Google session cookie to be set via /api/settings/google-cookie
    (typically by the browser extension)."""
    # ── Up-front validation ───────────────────────────────────────────────
    # These errors happen synchronously before any SSE stream opens, so we
    # raise HTTPException so the client gets a normal JSON error response
    # (consistent with the rest of the API).
    post_id = require_non_empty(body.post_id, "post_id")
    if "/" in post_id or "\\" in post_id or post_id.startswith("."):
        raise HTTPException(400, "Invalid post_id")
    drive_url = require_non_empty(body.drive_url, "drive_url")

    raw_cookie = database.get_setting(GOOGLE_COOKIE_KEY) or ""
    if not raw_cookie:
        raise HTTPException(
            412,
            "Google cookie is not set — sync it via the browser extension first",
        )
    try:
        cookies = json.loads(raw_cookie)
        if not isinstance(cookies, list):
            raise ValueError("expected JSON array")
    except (ValueError, json.JSONDecodeError) as e:
        raise HTTPException(500, f"Google cookie in settings is malformed: {e}")

    dest_dir = validate_under_download(post_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    # ── SSE generator ─────────────────────────────────────────────────────
    # Pattern: spawn fetch_drive_audio as a background task feeding an
    # asyncio.Queue via its on_progress callback. The generator drains the
    # queue and yields formatted SSE events. The terminal event (`done` or
    # `error`) closes the loop.
    queue: asyncio.Queue = asyncio.Queue()
    DONE_SENTINEL = object()

    async def push(event: dict) -> None:
        await queue.put(event)

    async def runner() -> None:
        global _drive_scrape_pending
        # Snapshot the lock state and our position BEFORE incrementing so the
        # "ahead" count we surface to the UI is the number of requests that
        # were already in flight or queued when ours arrived.
        #
        # Caveat: with the default `DRIVE_SCRAPE_CONCURRENCY=1` the
        # `_drive_scrape_lock.locked()` check is exact — the lock is either
        # held (one scrape in flight) or free. Raising the env var above 1
        # makes `Semaphore.locked()` only return True at FULL exhaustion, so
        # the surfaced `ahead` count would under-report queue depth by
        # `capacity - 1`. The env override is a power-user knob for scraping
        # different Google accounts where the rotation race doesn't apply;
        # if the under-report becomes annoying, replace the lock-locked
        # check with an explicit "in_use >= capacity" comparison.
        contested = _drive_scrape_lock.locked()
        ahead_on_arrival = _drive_scrape_pending
        _drive_scrape_pending += 1
        try:
            if contested:
                await queue.put({
                    "state": "queued",
                    "ahead": ahead_on_arrival,
                    "elapsed_s": 0.0,
                })
            async with _drive_scrape_lock:
                result = await drive_fetch.fetch_drive_audio(
                    drive_url=drive_url,
                    cookies=cookies,
                    dest_dir=dest_dir,
                    fallback_stem=post_id,
                    explicit_filename=body.filename,
                    on_progress=push,
                )
                download_path = DOWNLOAD_PATH.resolve()
                audio_path = str(result.audio_path.relative_to(download_path))
                await queue.put({
                    "state": "done",
                    "audio_path": audio_path,
                    "size": result.size,
                    "source_url": result.source_url,
                    "file_id": result.file_id,
                })
        except drive_fetch.DriveFetchError as e:
            await queue.put({
                "state": "error",
                "code": e.code,
                "message": str(e),
                "debug_dir": str(e.debug_dir) if e.debug_dir else None,
            })
        except Exception as e:
            log.exception("ingest-drive-link: unexpected failure")
            await queue.put({
                "state": "error",
                "code": "internal",
                "message": f"Unexpected backend error: {e}",
                "debug_dir": None,
            })
        finally:
            _drive_scrape_pending -= 1
            await queue.put(DONE_SENTINEL)

    async def event_stream():
        task = asyncio.create_task(runner())
        try:
            while True:
                event = await queue.get()
                if event is DONE_SENTINEL:
                    return
                # SSE wire format: `data: <json>\n\n`. Single-line JSON keeps
                # us safely under the spec's "data fields are line-delimited"
                # constraint without per-field splitting.
                yield f"data: {json.dumps(event, separators=(',', ':'))}\n\n"
        finally:
            # Client disconnect or generator close — cancel the underlying
            # work so we don't keep a Playwright session running for a tab
            # the user closed. Best-effort: if the runner is already past
            # cancellation checkpoints (e.g. inside browser.close), we let
            # it finish.
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            # Prevent any proxy in front of FastAPI from buffering the stream
            # (matters in dev when Vite's proxy is in the path).
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Dictionary: full load / import / reset ────────────────────────────────────
@app.get("/api/dictionary")
def get_dictionary():
    return database.get_full_dict()

class DictImport(BaseModel):
    vocabulary: list[dict]
    suppressed: list[dict]

@app.put("/api/dictionary")
def import_dictionary(body: DictImport):
    database.replace_full_dict({"vocabulary": body.vocabulary, "suppressed": body.suppressed})
    return database.get_full_dict()

@app.post("/api/dictionary/reset")
def reset_dictionary():
    database.reset_to_defaults()
    return database.get_full_dict()

# ── Vocabulary CRUD ───────────────────────────────────────────────────────────
class VocabIn(BaseModel):
    canonical: str
    aliases: list[str] = []

@app.get("/api/vocabulary")
def get_vocabulary():
    return database.get_vocabulary()

@app.post("/api/vocabulary", status_code=201)
def add_vocab(body: VocabIn):
    canonical = require_non_empty(body.canonical, "canonical")
    aliases = [a.strip().lower() for a in body.aliases if a.strip()]
    try:
        return database.add_vocab_entry(canonical, aliases)
    except ValueError as e:
        raise HTTPException(409, str(e))

@app.patch("/api/vocabulary/{entry_id}")
def edit_vocab(entry_id: int, body: VocabIn):
    canonical = require_non_empty(body.canonical, "canonical")
    aliases = [a.strip().lower() for a in body.aliases if a.strip()]
    try:
        row = database.edit_vocab_entry(entry_id, canonical, aliases)
    except ValueError as e:
        raise HTTPException(409, str(e))
    if not row:
        raise HTTPException(404, "vocabulary entry not found")
    return row

@app.delete("/api/vocabulary/{entry_id}")
def delete_vocab(entry_id: int):
    deleted = database.delete_vocab_entry(entry_id)
    if not deleted:
        raise HTTPException(404, "vocabulary entry not found")
    return {"deleted": entry_id}

# ── Suppressed terms CRUD ─────────────────────────────────────────────────────
class SuppressIn(BaseModel):
    term: str

@app.get("/api/suppressed")
def get_suppressed():
    return database.get_suppressed()

@app.post("/api/suppressed", status_code=201)
def add_suppressed(body: SuppressIn):
    term = require_non_empty(body.term, "term").lower()
    try:
        return database.add_suppressed(term)
    except ValueError as e:
        raise HTTPException(409, str(e))

@app.delete("/api/suppressed/{term_id}")
def delete_suppressed(term_id: int):
    deleted = database.delete_suppressed(term_id)
    if not deleted:
        raise HTTPException(404, "suppressed term not found")
    return {"deleted": term_id}
