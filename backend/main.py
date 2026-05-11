from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
import json
import os
import re
import subprocess
import tomllib
import httpx
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TPE2, ID3NoHeaderError
from mutagen.flac import FLAC
from mutagen.oggvorbis import OggVorbis
from mutagen.mp4 import MP4
from backend import database
from backend.patreon_fetch import PatreonFetchError, fetch as patreon_fetch

# ── Shared audio format config (single source of truth with frontend) ─────────
_FORMATS_CONFIG_PATH = Path(__file__).parent.parent / "frontend" / "src" / "lib" / "audio-formats.json"
with _FORMATS_CONFIG_PATH.open() as _f:
    _FORMATS_CONFIG = json.load(_f)

app = FastAPI(title="ASMR Workbench API")

# Resolve frontend dist path — built output from `cd frontend && npm run build`
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

# Root for audio files — set via AUDIO_ROOT env var
AUDIO_ROOT = Path(os.environ.get("AUDIO_ROOT", "/mnt/audio"))

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


def validate_audio_path(rel_path: str) -> Path:
    resolved = (AUDIO_ROOT / rel_path.strip()).resolve()
    if not str(resolved).startswith(str(AUDIO_ROOT.resolve())):
        raise HTTPException(403, "Access denied")
    return resolved


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
def list_files(subdir: str = ""):
    """List files and subdirectories inside AUDIO_ROOT/subdir (one level)."""
    target = validate_audio_path(subdir)
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
            "path": str(entry.relative_to(AUDIO_ROOT)),
            "needs_conversion": entry.is_file() and ext in NEEDS_CONVERSION_EXTS,
        })

    return {
        "current": str(target.relative_to(AUDIO_ROOT)) if target != AUDIO_ROOT else "",
        "entries": entries,
    }


@app.get("/api/files/search")
def search_files(q: str = "", search_in: str = "filename"):
    """
    Recursively walk AUDIO_ROOT and return all audio/video files.
    search_in: "filename" | "folder" | "both"
    """
    audio_root = AUDIO_ROOT.resolve()
    if not audio_root.exists():
        raise HTTPException(404, f"Audio root not found at {audio_root} — check AUDIO_ROOT mount")

    results = []
    q_lower = q.strip().lower()

    try:
        all_files = sorted(audio_root.rglob("*"), key=lambda e: str(e).lower())
    except PermissionError as e:
        raise HTTPException(500, f"Permission error scanning files: {e}")

    for entry in all_files:
        try:
            if not entry.is_file():
                continue
            if entry.suffix.lower() not in AUDIO_EXTS:
                continue
            rel = entry.relative_to(audio_root)
            folder = str(rel.parent) if str(rel.parent) != "." else ""
            if q_lower:
                match_name   = q_lower in entry.name.lower()
                match_folder = q_lower in folder.lower()
                if search_in == "filename" and not match_name:
                    continue
                elif search_in == "folder" and not match_folder:
                    continue
                elif search_in == "both" and not (match_name or match_folder):
                    continue
            ext = entry.suffix.lower()
            results.append({
                "name": entry.name,
                "ext": ext,
                "path": str(rel),
                "folder": folder,
                "needs_conversion": ext in NEEDS_CONVERSION_EXTS,
            })
        except (PermissionError, OSError):
            continue

    return {"query": q, "search_in": search_in, "total": len(results), "files": results}


@app.get("/api/files/debug")
def debug_files():
    """Show what's visible at AUDIO_ROOT — use to diagnose mount issues."""
    audio_root = AUDIO_ROOT.resolve()
    if not audio_root.exists():
        return {"error": f"AUDIO_ROOT does not exist: {audio_root}", "audio_root": str(audio_root)}

    top_level = []
    try:
        for entry in sorted(audio_root.iterdir(), key=lambda e: e.name.lower())[:20]:
            top_level.append({
                "name": entry.name,
                "type": "dir" if entry.is_dir() else "file",
            })
    except Exception as e:
        return {"error": str(e), "audio_root": str(audio_root)}

    return {
        "audio_root": str(audio_root),
        "exists": True,
        "top_level_entries": top_level,
        "top_level_count": len(top_level),
    }

# ── Rename ────────────────────────────────────────────────────────────────────

class MetadataIn(BaseModel):
    title: str = ""
    artist: str = ""
    album: str = ""
    album_artist: str = ""

class RenameIn(BaseModel):
    path: str                           # relative path to file inside AUDIO_ROOT
    new_name: str                       # new filename (just the name, no path)
    metadata: Optional[MetadataIn] = None   # tags to embed after rename

@app.post("/api/rename")
def rename_file(body: RenameIn):
    src = validate_audio_path(body.path)
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

    dest = validate_audio_path(str(src.parent.relative_to(AUDIO_ROOT) / new_name))
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
        "path": str(dest.relative_to(AUDIO_ROOT)),
        **({"metadata_error": metadata_error} if metadata_error else {}),
    }

# ── Convert ───────────────────────────────────────────────────────────────────

@app.get("/api/convert/formats")
def get_convert_formats():
    """Return the list of supported output formats for conversion."""
    return OUTPUT_FORMATS


class ConvertIn(BaseModel):
    path: str               # relative path inside AUDIO_ROOT
    output_format: str      # "mp3" | "flac" | "aac" | "ogg"
    quality: str            # "low" | "standard" | "high" | "best" | "lossless"
    delete_original: bool = False


@app.post("/api/convert")
def convert_file(body: ConvertIn):
    src = validate_audio_path(body.path)
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
        raise HTTPException(500, f"Conversion failed: {result.stderr[-500:]}")

    if body.delete_original:
        try:
            src.unlink()
        except OSError:
            pass  # Don't fail the request if original delete fails

    return {
        "converted": True,
        "old_name": src.name,
        "new_name": dest.name,
        "path": str(dest.relative_to(AUDIO_ROOT)),
    }


# ── Settings (key/value) ──────────────────────────────────────────────────────

PATREON_COOKIE_KEY = "patreon_cookie"


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


# ── Patreon download (patreon-dl wrapper) ─────────────────────────────────────

PATREON_OUTPUT_SUBDIR = ".patreon-dl"


_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _validate_iso_date(value: Optional[str], field: str) -> Optional[str]:
    if value is None or value == "":
        return None
    if not _ISO_DATE_RE.match(value):
        raise HTTPException(400, f"{field} must be in YYYY-MM-DD format")
    return value


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

    output_dir = AUDIO_ROOT / PATREON_OUTPUT_SUBDIR
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

    audio_root = AUDIO_ROOT.resolve()

    def _rel(p: Optional[str]) -> Optional[str]:
        if not p:
            return None
        try:
            return str(Path(p).resolve().relative_to(audio_root))
        except ValueError:
            return p  # fell outside AUDIO_ROOT — return absolute path verbatim

    posts = [
        {
            "post_id": p.post_id,
            "title": p.title,
            "tags": p.tags,
            "artist": p.artist,
            "post_dir": _rel(p.post_dir),
            "audio_path": _rel(p.audio_path),
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
