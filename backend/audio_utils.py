"""Shared audio-file utilities — URL cleaning, filename derivation,
flat-path construction. Imported by main.py and drive_fetch.py. Lives
outside main.py so drive_fetch.py doesn't import FastAPI transitively.
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, urlunparse, unquote

# Query params stripped from a captured Google playback URL:
#   range  — byte-range cap; remove for a full-file response.
#   ump    — chunked-streaming opt-in.
#   srfvp  — "single request first valid position"; left in, the CDN caps
#            the response to a tiny initial range and returns a stub.
# Applied both client-side (extension) and server-side as defence in depth.
STRIP_QUERY_PARAMS = ("ump", "range", "srfvp")

# MIME → extension lookup for filename fallback when Content-Disposition is
# absent. Conservative — only audio types we expect to see from Drive's CDN.
AUDIO_MIME_EXT = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
}

# Cap below the 255-byte filesystem limit so emoji-heavy anchor text can't
# blow past it. Cut in UTF-8 byte space, not char space.
_FILENAME_MAX_BYTES = 200

_FILENAME_INVALID_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_CD_FILENAME_RE = re.compile(
    r"""filename\*?\s*=\s*(?:UTF-8''|['"])?([^;'"\r\n]+)""",
    re.IGNORECASE,
)


def strip_query_params(url: str, names: tuple[str, ...] = STRIP_QUERY_PARAMS) -> str:
    """Drop named query params while preserving every other param byte-
    for-byte. `parse_qsl` + `urlencode` would re-encode `/` inside values
    (e.g. `mime=audio/mp4`) and invalidate Google's signed-URL signature.
    """
    parts = urlparse(url)
    if not parts.query:
        return url
    kept = []
    for segment in parts.query.split("&"):
        if "=" in segment:
            key = segment.split("=", 1)[0]
        else:
            key = segment
        if key in names:
            continue
        kept.append(segment)
    return urlunparse(parts._replace(query="&".join(kept)))


def safe_filename_component(value: str) -> str:
    """Sanitise a filename: strip directory separators, control chars,
    leading dots, and cap UTF-8 byte length below the 255-byte filesystem
    limit (with headroom for the caller to append an extension)."""
    cleaned = _FILENAME_INVALID_RE.sub("_", value).strip().lstrip(".")
    encoded = cleaned.encode("utf-8")
    if len(encoded) > _FILENAME_MAX_BYTES:
        # `errors="ignore"` drops any partial multi-byte char at the cut.
        cleaned = encoded[:_FILENAME_MAX_BYTES].decode("utf-8", errors="ignore").rstrip()
    return cleaned or ""


def flatten_dest_parts(post_id: str, artist: str, title: str) -> tuple[str, str]:
    """Return `(creator, "<post_id> - <title>")` for the flattened
    `DOWNLOAD_PATH/<creator>/<post_id> - <title>/` layout.

    `safe_filename_component` *substitutes* `/\\:*?"<>|` and control chars
    with `_` rather than stripping (so `///` becomes `___`, not empty).
    Empty `artist` → "Unknown creator"; empty title drops the suffix so
    the folder always carries the post_id. Shared by every writer under
    DOWNLOAD_PATH so all three ingest paths land in the same shape.
    """
    creator = safe_filename_component(artist) or "Unknown creator"
    title_part = safe_filename_component(title)
    folder_name = f"{post_id} - {title_part}" if title_part else post_id
    return creator, folder_name


def filename_from_content_disposition(header: Optional[str]) -> Optional[str]:
    if not header:
        return None
    match = _CD_FILENAME_RE.search(header)
    if not match:
        return None
    raw = match.group(1).strip().strip('"').strip("'")
    # If RFC 5987-encoded (filename*=UTF-8''xxx), URL-decode.
    if "%" in raw:
        raw = unquote(raw)
    return safe_filename_component(raw) or None


def ext_from_content_type(content_type: Optional[str]) -> str:
    if not content_type:
        return ".mp3"
    main = content_type.split(";")[0].strip().lower()
    return AUDIO_MIME_EXT.get(main, ".mp3")


def unique_destination(target: Path) -> Path:
    """Return `target`, or `target` with `_2`/`_3`/… if it already exists.
    Mirrors patreon_fetch._unique_path so external-ingest collisions follow
    the same pattern as patreon-dl-ingested audio."""
    if not target.exists():
        return target
    stem, suffix, parent = target.stem, target.suffix, target.parent
    n = 2
    while True:
        candidate = parent / f"{stem}_{n}{suffix}"
        if not candidate.exists():
            return candidate
        n += 1


def derive_filename(
    *,
    explicit: Optional[str],
    content_disposition: Optional[str],
    content_type: Optional[str],
    fallback_stem: str,
) -> str:
    """Pick a filename for a downloaded audio file in the same order both
    ingest paths use:

      1. Caller-supplied `explicit` override (sanitised).
      2. Server `Content-Disposition` `filename=` / `filename*=` value.
      3. `<fallback_stem>_<unix-ts><ext>` where `<ext>` comes from the
         Content-Type, defaulting to `.mp3`.

    Always returns a non-empty string with an extension.
    """
    name = ""
    if explicit:
        name = safe_filename_component(explicit)
    if not name:
        name = filename_from_content_disposition(content_disposition) or ""
    if not name:
        name = f"{fallback_stem}_{int(time.time())}{ext_from_content_type(content_type)}"
    if "." not in name:
        name += ext_from_content_type(content_type)
    return name
