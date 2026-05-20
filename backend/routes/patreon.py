"""Patreon fetch + the two external-audio ingest endpoints.

- `/api/patreon/fetch` wraps the patreon-dl subprocess.
- `/api/patreon/ingest-external-audio` streams a signed third-party URL
  directly via httpx.
- `/api/patreon/ingest-drive-link` runs the Playwright-based Drive scrape
  in `backend/drive_fetch.py`, serialised per-account via the semaphore
  defined here.
"""

import asyncio
import contextlib
import ipaddress
import json
import os
import socket
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend import audio_utils, database, drive_fetch
from backend import main as _main
from backend.main import (
    EXTERNAL_AUDIO_HTTPX_TIMEOUTS,
    GOOGLE_COOKIE_KEY,
    METADATA_COMPATIBLE_EXTS,
    PATREON_COOKIE_KEY,
    _write_metadata,
    log,
    require_non_empty,
    validate_under_download,
)
from backend.patreon_fetch import PatreonFetchError
from backend.patreon_fetch import fetch as patreon_fetch

# DOWNLOAD_PATH accessed via `_main.DOWNLOAD_PATH` (attribute lookup) rather
# than a top-level import binding so the test suite's monkeypatch on
# `backend.main.DOWNLOAD_PATH` reaches us.

router = APIRouter()


# ── Patreon download (patreon-dl wrapper) ─────────────────────────────────────

PATREON_OUTPUT_SUBDIR = ".patreon-dl"

# Drive scrapes serialise per-account because Google's mid-stream
# `RotateCookies` race lets only the last concurrent session win — losers
# get ~1 KB probe-shaped responses. Raise capacity only when scraping
# different accounts where rotations can't collide.
_DRIVE_SCRAPE_CAPACITY = max(1, int(os.environ.get("DRIVE_SCRAPE_CONCURRENCY", "1")))
_drive_scrape_lock = asyncio.Semaphore(_DRIVE_SCRAPE_CAPACITY)
# Plain int — single-event-loop concurrency means `+=`/`-=` need no lock.
_drive_scrape_pending = 0


def _validate_iso_date(value: str | None, field: str) -> str | None:
    if value is None or value == "":
        return None
    try:
        # Catches bad-shape input the regex would miss (`9999-99-99`) plus
        # impossible calendar dates. patreon-dl wants canonical YYYY-MM-DD.
        return date.fromisoformat(value).isoformat()
    except ValueError as e:
        raise HTTPException(400, f"{field}: {e}")


def _ingest_dest_dir(post_id: str, artist: str | None, title: str | None) -> Path:
    """Resolve the per-post destination under DOWNLOAD_PATH.

    With artist or title supplied, builds the flattened
    `<creator>/<post_id> - <title>/` layout via `flatten_dest_parts`. Without
    either, falls back to the legacy `<post_id>/` shape for callers that
    don't carry metadata.
    """
    if artist or title:
        creator, folder = audio_utils.flatten_dest_parts(
            post_id,
            artist or "",
            title or "",
        )
        return validate_under_download(f"{creator}/{folder}")
    return validate_under_download(post_id)


class PatreonFetchIn(BaseModel):
    url: str
    metadata_only: bool = False
    # Which patreon-dl media types to include. Allowed: "audio", "video",
    # "image", "attachment". None/empty → wrapper default (["audio"]).
    # Ignored when metadata_only=True.
    content_types: list[str] | None = None
    # ISO YYYY-MM-DD bounds. Only meaningful for creator URLs.
    published_after: str | None = None
    published_before: str | None = None
    # Walk the pipeline without writing anything (preview only). Status DB
    # left untouched so `previouslyDownloaded` dedup stays correct on the
    # real run.
    dry_run: bool = False


@router.post("/api/patreon/fetch")
def patreon_fetch_endpoint(body: PatreonFetchIn):
    url = require_non_empty(body.url, "url")
    cookie = database.get_setting(PATREON_COOKIE_KEY) or ""
    if not cookie:
        raise HTTPException(412, "Patreon cookie is not set — configure it in settings first")

    published_after = _validate_iso_date(body.published_after, "published_after")
    published_before = _validate_iso_date(body.published_before, "published_before")

    output_dir = _main.DOWNLOAD_PATH / PATREON_OUTPUT_SUBDIR
    try:
        result = patreon_fetch(
            url,
            cookie,
            output_dir,
            metadata_only=body.metadata_only,
            content_types=body.content_types,
            published_after=published_after,
            published_before=published_before,
            dry_run=body.dry_run,
        )
    except PatreonFetchError as e:
        raise HTTPException(502, str(e))

    download_path = _main.DOWNLOAD_PATH.resolve()

    def _rel(p: str | None) -> str | None:
        if not p:
            return None
        try:
            return str(Path(p).resolve().relative_to(download_path))
        except ValueError, OSError:
            # ValueError: path falls outside DOWNLOAD_PATH (the intended
            # branch), or null-byte input from patreon-dl. OSError: any
            # other OS-layer resolve failure. Mirrors the resolve()
            # guard added to validate_under_root.
            return p

    posts = [
        {
            "post_id": p.post_id,
            "title": p.title,
            "tags": p.tags,
            "artist": p.artist,
            "post_dir": _rel(p.post_dir),
            "audio_path": _rel(p.audio_path),
            "external_links": [{"url": link.url, "text": link.text} for link in p.external_links],
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


class IngestExternalAudioIn(BaseModel):
    post_id: str
    source_url: str
    # Optional override; otherwise derived from Content-Disposition or
    # `<post_id>_<timestamp>.<ext>`.
    filename: str | None = None
    # Optional metadata to embed after the download. Only honoured for
    # metadata-compatible formats; silently ignored otherwise.
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    album_artist: str | None = None


def _validate_post_id(post_id: str) -> str:
    """Shared post_id validator for both ingest endpoints.

    Rejects path-traversal shapes (`/`, `\\`, leading `.`) so the value
    is safe to feed into `_ingest_dest_dir` / `validate_under_download`.
    `require_non_empty` already trimmed + checked for empty before this.
    """
    post_id = require_non_empty(post_id, "post_id")
    if "/" in post_id or "\\" in post_id or post_id.startswith("."):
        raise HTTPException(400, "Invalid post_id")
    return post_id


_MAX_EXTERNAL_REDIRECTS = 5


async def _validate_url_routable(url: str) -> None:
    """Reject URLs that resolve to non-routable addresses (loopback, RFC1918,
    link-local, multicast, reserved). Defence against SSRF probes via the
    external-audio ingest endpoint — without this an attacker who reaches
    `/api/patreon/ingest-external-audio` could pivot to internal services
    (Ollama at localhost:11434, cloud metadata at 169.254.169.254, RFC1918
    hosts on the same LAN).

    Called at the initial URL *and* after each redirect because httpx's
    follow_redirects mode would otherwise transparently land us on a
    private IP. DNS-rebinding race conditions remain a theoretical residual
    risk; the threat model here is single-user-on-LAN, not multi-tenant.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "Only http(s) URLs are allowed")
    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(400, "URL is missing a hostname")
    try:
        addr_infos = await asyncio.to_thread(socket.getaddrinfo, hostname, None)
    except socket.gaierror:
        raise HTTPException(400, "Hostname could not be resolved")
    for info in addr_infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise HTTPException(403, "URL resolves to a non-routable address")


@router.post("/api/patreon/ingest-external-audio")
async def ingest_external_audio(body: IngestExternalAudioIn):
    post_id = _validate_post_id(body.post_id)
    source_url = require_non_empty(body.source_url, "source_url")
    if not (source_url.startswith(("http://", "https://"))):
        raise HTTPException(400, "source_url must be http(s)")

    cleaned_url = audio_utils.strip_query_params(source_url)

    # _ingest_dest_dir chooses the flattened `<creator>/<post_id> - <title>/`
    # layout when artist or title is supplied (matches patreon-dl), and
    # falls back to legacy `<post_id>/` otherwise. validate_under_download
    # enforces the DOWNLOAD_PATH boundary against any traversal.
    dest_dir = _ingest_dest_dir(post_id, body.artist, body.title)
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Follow redirects manually so _validate_url_routable runs at every
    # hop — httpx's follow_redirects=True would auto-follow a 302 into
    # a private-IP target before we got a chance to block it.
    target: Path | None = None
    bytes_written = 0
    content_length: str | None = None
    try:
        async with httpx.AsyncClient(
            timeout=EXTERNAL_AUDIO_HTTPX_TIMEOUTS, follow_redirects=False
        ) as client:
            current_url = cleaned_url
            for _ in range(_MAX_EXTERNAL_REDIRECTS + 1):
                await _validate_url_routable(current_url)
                async with client.stream("GET", current_url) as response:
                    if 300 <= response.status_code < 400:
                        location = response.headers.get("location")
                        if not location:
                            raise HTTPException(502, "Redirect missing Location header")
                        current_url = str(httpx.URL(current_url).join(location))
                        continue
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
                        with part.open("wb") as f:
                            async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                                if chunk:
                                    f.write(chunk)
                                    bytes_written += len(chunk)
                        part.rename(target)
                    except Exception:
                        part.unlink(missing_ok=True)
                        raise
                    break
            else:
                raise HTTPException(502, "Too many redirects following source_url")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Failed to fetch source_url: {e}")

    if target is None:  # exhausted the redirect loop without a body — shouldn't happen
        raise HTTPException(502, "External fetch produced no response")

    # Best-effort metadata embed. Any failure here is non-fatal — the file
    # is on disk either way.
    metadata_error: str | None = None
    if target.suffix.lower() in METADATA_COMPATIBLE_EXTS and any(
        [
            body.title,
            body.artist,
            body.album,
            body.album_artist,
        ]
    ):
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
    # inside DOWNLOAD_PATH — relative_to is guaranteed to succeed. Absolute
    # path never returned because it would leak server-internal layout.
    audio_path = str(target.relative_to(_main.DOWNLOAD_PATH.resolve()))
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
    filename: str | None = None
    # Post metadata used for the flattened layout. Without either field, the
    # legacy `<post_id>/` shape is used so external callers keep working.
    title: str | None = None
    artist: str | None = None


@router.post("/api/patreon/ingest-drive-link")
async def ingest_drive_link(body: IngestDriveLinkIn):
    """Resolve a Drive viewer URL → playback URL → file via headless Chromium.

    Returns `text/event-stream` of progress events; see
    `drive_fetch.fetch_drive_audio` for the per-event shape. Requires the
    Google session cookie to be set via `/api/settings/google-cookie`
    (typically by the browser extension).
    """
    post_id = _validate_post_id(body.post_id)
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
        log.error("Google cookie in settings is malformed: %s", e)
        raise HTTPException(
            500,
            "Google cookie in settings is malformed — re-sync via the extension.",
        )

    dest_dir = _ingest_dest_dir(post_id, body.artist, body.title)
    dest_dir.mkdir(parents=True, exist_ok=True)

    # SSE generator: spawn fetch_drive_audio as a background task feeding an
    # asyncio.Queue via its on_progress callback. Generator drains the
    # queue, terminal `done` or `error` closes the loop.
    queue: asyncio.Queue = asyncio.Queue()
    DONE_SENTINEL = object()

    async def push(event: dict) -> None:
        await queue.put(event)

    async def runner() -> None:
        global _drive_scrape_pending
        # Snapshot the lock state BEFORE incrementing so the "ahead" count
        # is the number of requests already in flight or queued when ours
        # arrived. Caveat with DRIVE_SCRAPE_CONCURRENCY>1: Semaphore.locked()
        # only returns True at full exhaustion, so `ahead` under-reports
        # queue depth by `capacity - 1` in that mode.
        contested = _drive_scrape_lock.locked()
        ahead_on_arrival = _drive_scrape_pending
        _drive_scrape_pending += 1
        try:
            if contested:
                await queue.put(
                    {
                        "state": "queued",
                        "ahead": ahead_on_arrival,
                        "elapsed_s": 0.0,
                    }
                )
            async with _drive_scrape_lock:
                result = await drive_fetch.fetch_drive_audio(
                    drive_url=drive_url,
                    cookies=cookies,
                    dest_dir=dest_dir,
                    fallback_stem=post_id,
                    explicit_filename=body.filename,
                    on_progress=push,
                )
                download_path = _main.DOWNLOAD_PATH.resolve()
                audio_path = str(result.audio_path.relative_to(download_path))
                await queue.put(
                    {
                        "state": "done",
                        "audio_path": audio_path,
                        "size": result.size,
                        "source_url": result.source_url,
                        "file_id": result.file_id,
                    }
                )
        except drive_fetch.DriveFetchError as e:
            await queue.put(
                {
                    "state": "error",
                    "code": e.code,
                    "message": str(e),
                    "debug_dir": str(e.debug_dir) if e.debug_dir else None,
                }
            )
        except Exception as e:
            log.exception("ingest-drive-link: unexpected failure")
            await queue.put(
                {
                    "state": "error",
                    "code": "internal",
                    "message": f"Unexpected backend error: {e}",
                    "debug_dir": None,
                }
            )
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
                yield f"data: {json.dumps(event, separators=(',', ':'))}\n\n"
        finally:
            # Client disconnect — cancel the underlying work so we don't
            # keep a Playwright session running for a closed tab.
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            # Prevent any proxy from buffering the stream (matters in dev
            # behind Vite's proxy).
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
