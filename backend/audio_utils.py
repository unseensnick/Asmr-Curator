"""Shared audio-file utilities used by both `main.py` (the `/api/patreon/
ingest-external-audio` endpoint) and `drive_fetch.py` (the Playwright-based
Drive scrape).

Lives here — not in main.py — so `drive_fetch` doesn't need to reach back
into the FastAPI module and create a circular import. Mirrors the existing
`backend/database.py` separation pattern: shared helpers in their own module,
no FastAPI dependency.
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, urlunparse, unquote

# Query parameters always stripped from a captured Google playback URL before
# the file is fetched. The exact set the user's manual reference workflow
# strips is `range`, `ump`, *and* `srfvp`:
#
#   • `range`  — chunk-byte-range request. Removing it makes the server
#                return the complete file.
#   • `ump`    — UMP chunked-streaming opt-in. Removing it disables the
#                multi-chunk streaming protocol.
#   • `srfvp`  — "single request, first valid position" marker. Drive's
#                CDN honours it by capping the response to a tiny initial
#                range regardless of how `range` was set; without stripping
#                it, the cleaned URL returns a kilobyte-scale stub instead
#                of the full file.
#
# Both the extension and the backend re-apply these as defence in depth.
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

# Cap byte length below the common 255-byte filesystem limit so that a
# long anchor-text-derived filename (emoji-heavy + extension suffix) can't
# blow past it. We cut in UTF-8 byte space, not char space, because emojis
# encode to 4 bytes each.
_FILENAME_MAX_BYTES = 200

_FILENAME_INVALID_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_CD_FILENAME_RE = re.compile(
    r"""filename\*?\s*=\s*(?:UTF-8''|['"])?([^;'"\r\n]+)""",
    re.IGNORECASE,
)


def strip_query_params(url: str, names: tuple[str, ...] = STRIP_QUERY_PARAMS) -> str:
    """Remove specific query-string params while preserving the exact byte
    sequence of every other param.

    We can't round-trip through `parse_qsl` + `urlencode` here: those would
    re-encode characters like `/` inside values (e.g. `mime=audio/mp4`),
    which invalidates the signed-URL signature on Google's playback CDN.
    Operate on the raw query string directly, dropping whole `key=value`
    segments whose key matches `names`.
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
    """Return (creator_segment, post_folder_segment) for the flattened
    `DOWNLOAD_PATH/<creator>/<post_id> - <title>/` layout.

    Both segments are sanitised via `safe_filename_component`, which
    substitutes `/\:*?"<>|` and control chars with `_` (so an artist of
    `///` becomes `___`, still a valid scoped folder name). An empty
    `artist` falls back to "Unknown creator"; an empty title drops the
    ` - <title>` suffix and leaves just `<post_id>`, so the folder always
    has at least one identifier. Shared between the patreon-dl flatten
    step (which writes), the cached-sidecar reader, and the Drive +
    external-audio ingest endpoints, so all writers land in the same
    shape.
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
