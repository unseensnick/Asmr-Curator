"""Headless-Chromium scrape of a Google Drive viewer URL → cleaned playback URL → download.

Drive's `videoplayback?...` URL only exists after the player iframe initialises
and probes the file. Once the player has issued the request, the URL is signed
(`sig=…&sparams=…`) and self-contained — stripping `ump` and `range` causes
the server to return the full file in one response. Server-side requests with
just the URL ID won't work for view-only files: we need the player to emit
the URL.

This module loads `drive.google.com/file/d/<id>/view` in headless Chromium,
captures the first `videoplayback` request, cleans the URL, and downloads
the file via **the same Playwright browser context** that captured the URL.
We deliberately do not switch to httpx for the download — Drive's CDN
fingerprints the cleaned URL against its originating session (TLS, HTTP/2,
cookies, request shape) and silently sends zero body bytes to anything that
doesn't match. Reusing `context.request.get(...)` makes the download look
exactly like a follow-up media fetch from the same browser session.

The Playwright dep is heavy (~200 MB Chromium). It is imported lazily inside
`fetch_drive_audio` so anything else in the backend keeps working when the
package is absent (e.g. running unrelated tests on a fresh venv).

Progress reporting
------------------
`fetch_drive_audio(..., on_progress=cb)` calls `cb(event_dict)` at every
state transition: `launching_browser` → `loading_page` → `waiting_for_player`
→ `captured` → `downloading` → `done`. Heartbeat `downloading` events are
emitted every ~2 s while Playwright's atomic body fetch runs so the UI shows
elapsed time even though we can't poll mid-flight bytes (Playwright's Python
client doesn't expose APIResponse streaming). The route handler in
`backend/main.py` reshapes these into a `text/event-stream` for the frontend.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import logging
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional, TYPE_CHECKING
from urllib.parse import urlparse

from backend import audio_utils

if TYPE_CHECKING:
    from playwright.async_api import BrowserContext, Playwright, Browser

log = logging.getLogger(__name__)


# Type alias for the async progress callback. The caller hands us a callable
# that takes an event dict and returns an awaitable (typically `queue.put`).
# A None callback means "no progress reporting" — useful for tests and the
# legacy non-SSE call path.
ProgressCallback = Callable[[dict], Awaitable[None]]


# Minimum size threshold for the **extension's** in-browser capture. The
# backend's Playwright scrape no longer uses this — every `videoplayback`
# response on a Drive host is treated as the file's signed URL, regardless
# of chunk size (see `_on_response`). Kept here so a future cross-module
# import can find it; lib/url-clean.js holds the matching value for the
# browser side.
MIN_AUDIO_BYTES = 400_000

# How long to wait for the player to emit any `videoplayback` request on a
# recognised Drive host. Generous because the budget covers Playwright
# cold-start (~3-5 s on first call) + page nav + iframe mount + play() +
# the player's first probe.
DEFAULT_PLAYER_WAIT_S = 90.0

# Drive serves these files as two parallel streams: itag=140 is the audio
# (m4a, AAC-LC ~128 kbps) and itag=134 is the video (mp4, ~360p — for
# cover-art audio releases this is just the static image, multi-MB).
# We want the audio. After the first eligible `videoplayback` URL is
# captured, we wait up to AUDIO_PREFERENCE_GRACE_S for an itag=140 URL
# to fire and swap to it. If the grace window expires (true video upload,
# or some odd file with only the video itag), we fall back to whatever
# fired first — same outcome as before this preference existed.
AUDIO_PREFERENCE_GRACE_S = 5.0
_PREFERRED_AUDIO_ITAG = "140"

# Heartbeat interval for `downloading` progress events. Bytes-received are
# read live from CDP `Network.dataReceived` events into the heartbeat's
# holder dicts, so a 500 ms tick gives the UI a visibly-progressing
# percentage / MB counter without flooding the SSE stream.
DOWNLOAD_HEARTBEAT_S = 0.5

# Idle timeout for the shared Chromium browser. Closes after this many
# seconds of no activity so Chromium isn't resident forever between batches
# of downloads. Cancelled at scrape start, re-armed at scrape end (so a
# 700 s download can't be idle-killed mid-stream by a 300 s timer).
BROWSER_IDLE_TIMEOUT_S = float(os.environ.get("DRIVE_BROWSER_IDLE_TIMEOUT_S", "300"))

# Maximum time we'll wait for the body fetch to complete before giving up
# and raising a timeout. Default 4 hours covers a ~3-hour m4a (~170-250 MB)
# on a sustained ~37 KB/s connection (the user's observed real-world floor
# for Google Drive throughput from headless Chromium). The captured
# videoplayback URL's own `expire=` parameter is typically ~6 hours from
# emission, so raising this beyond ~5 hours is pointless — Drive will 403
# the URL before the timeout fires. Override via `DRIVE_DOWNLOAD_TIMEOUT_S`
# (seconds, float).
DOWNLOAD_TIMEOUT_S = float(os.environ.get("DRIVE_DOWNLOAD_TIMEOUT_S", "14400"))


# User-agent string handed to the headless Chromium context. Drive sometimes
# serves a degraded experience to unknown UAs; matching a recent stable
# Chrome keeps parity with real sessions and avoids the videoplayback
# fingerprint check that silently zero-bodied the previous httpx-based path.
_BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

# Hosts whose requests we treat as candidate playback URLs.
_PLAYBACK_HOST_RE = re.compile(
    r"(?:^|\.)googlevideo\.com$|(?:^|\.)drive\.google\.com$|(?:^|\.)googleusercontent\.com$",
    re.IGNORECASE,
)

# Broader host filter for the diagnostic-only "what did the page request"
# trace. Anything matching is logged on failure so we can tell whether Drive
# tried to play the file at all, or e.g. redirected us to accounts.google.com.
_GOOGLE_HOST_RE = re.compile(
    r"(?:^|\.)(?:google|googlevideo|googleusercontent|googleapis|gstatic|youtube)\.com$",
    re.IGNORECASE,
)

# Query parameters that carry short-lived auth tokens — never write the value
# of these to disk in a diagnostic dump. Replaced with `<redacted>` before
# the URL is logged. Keep names lowercase.
_SENSITIVE_QUERY_PARAMS = frozenset({
    "sig", "lsig", "signature",          # Google signed-URL signatures
    "access_token", "id_token", "token", # OAuth-style bearer tokens
    "auth", "authuser",                  # generic auth
    "key", "api_key",                    # API keys
    "session_id", "sessionid",           # session identifiers
})


# ─── Shared Chromium machinery ─────────────────────────────────────────────
#
# The browser AND its BrowserContext are kept alive across `fetch_drive_audio`
# calls. The Page is per-request (one page per scrape, closed on exit).
#
# Why share the context, not just the browser: Google's `accounts.google.com/
# RotateCookies` fires mid-playback and replaces the session cookies. Those
# rotations land in the live context's cookie jar. If we threw the context
# away after each scrape, the next queued scrape would `add_cookies()` from
# the DB — those cookies have just been invalidated server-side by the
# rotation that we discarded. With a persistent context the rotations
# propagate naturally to subsequent scrapes, same as a real browser session.
#
# The Part-1 scrape semaphore (in main.py) guarantees one scrape runs at a
# time, so the persistent context never sees concurrent rotations from
# itself.
_pw: Optional["Playwright"] = None
_browser: Optional["Browser"] = None
_context: Optional["BrowserContext"] = None
_context_stale: bool = False
_browser_lock = asyncio.Lock()
_browser_idle_task: Optional[asyncio.Task] = None


async def _get_context(cookies: list[dict]) -> "BrowserContext":
    """Lazily launch + return the shared BrowserContext.

    Re-creates the browser if it died (e.g. crashed or was idle-closed) and
    re-creates the context if it was marked stale by a cookie re-sync.
    Resets the idle-close timer on every call so the browser stays alive
    while we're actively scraping. The caller is expected to immediately
    cancel the idle task for the duration of its scrape (see
    `fetch_drive_audio`) so a long download isn't idle-killed mid-stream.
    """
    global _pw, _browser, _context, _context_stale
    async with _browser_lock:
        # Browser dead? Relaunch — also forces a fresh context.
        if _browser is None or not _browser.is_connected():
            from playwright.async_api import async_playwright
            _pw = await async_playwright().start()
            _browser = await _pw.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    # Headless Chromium blocks programmatic `.play()` on
                    # <video>/<audio> by default. The flag removes the
                    # user-gesture requirement; see _trigger_play for the
                    # play strategies that rely on it.
                    "--autoplay-policy=no-user-gesture-required",
                ],
            )
            log.info("drive-fetch: launched shared Chromium")
            _context = None

        # Cookie re-sync invalidated the context? Close the old one — safe
        # because the scrape semaphore guarantees nobody's using it.
        if _context_stale and _context is not None:
            try:
                await _context.close()
            except Exception:
                log.exception("drive-fetch: error closing stale context")
            _context = None
            _context_stale = False

        # First scrape after launch / cookie re-sync? Build the context.
        if _context is None:
            _context = await _browser.new_context(user_agent=_BROWSER_UA)
            await _context.add_cookies(cookies)
            log.info("drive-fetch: created shared context with %d cookies", len(cookies))

        _schedule_idle_close()
        return _context


def invalidate_shared_context() -> None:
    """Mark the shared context stale so the next scrape recreates it with
    fresh cookies. Called from `/api/settings/google-cookie` after the user
    re-syncs via the extension. Fast-returns; the actual `context.close()`
    happens inside the next `_get_context` call, gated by the scrape
    semaphore — so we never close a context that's currently in use."""
    global _context_stale
    _context_stale = True


def _schedule_idle_close() -> None:
    """(Re-)arm the idle-close timer. Cancels any previous task and starts
    a fresh one with the full timeout."""
    global _browser_idle_task
    if _browser_idle_task and not _browser_idle_task.done():
        _browser_idle_task.cancel()
    _browser_idle_task = asyncio.create_task(_idle_close_after_timeout())


def _cancel_idle_close() -> None:
    """Cancel the idle-close timer outright. Called at scrape start so a
    long download can't be idle-killed by a timer that fires mid-stream."""
    global _browser_idle_task
    if _browser_idle_task and not _browser_idle_task.done():
        _browser_idle_task.cancel()
    _browser_idle_task = None


async def _idle_close_after_timeout() -> None:
    try:
        await asyncio.sleep(BROWSER_IDLE_TIMEOUT_S)
    except asyncio.CancelledError:
        return
    log.info("drive-fetch: idle %s s — closing shared Chromium", BROWSER_IDLE_TIMEOUT_S)
    await close_shared_browser()


async def close_shared_browser() -> None:
    """Close the shared browser (and any context inside it). Safe to call
    repeatedly and from the FastAPI shutdown hook."""
    global _pw, _browser, _context
    async with _browser_lock:
        if _browser is not None:
            try:
                await _browser.close()  # also closes _context
            except Exception:
                log.exception("drive-fetch: error closing shared browser")
            _browser = None
        if _pw is not None:
            try:
                await _pw.stop()
            except Exception:
                log.exception("drive-fetch: error stopping Playwright")
            _pw = None
        _context = None


def _redact_sensitive_url(url: str) -> str:
    """Strip auth-token values from a URL before logging it.

    Preserves the URL structure (host, path, param names) so it stays useful
    for debugging — we want to see *that* `sig=` was present, not what its
    value was. Values are replaced with `<redacted>`; everything else
    passes through byte-identical via the same string-level approach used
    in `audio_utils.strip_query_params`.
    """
    parts = urlparse(url)
    if not parts.query:
        return url
    redacted_segments = []
    for segment in parts.query.split("&"):
        if "=" not in segment:
            redacted_segments.append(segment)
            continue
        key, _, _ = segment.partition("=")
        if key.lower() in _SENSITIVE_QUERY_PARAMS:
            redacted_segments.append(f"{key}=<redacted>")
        else:
            redacted_segments.append(segment)
    from urllib.parse import urlunparse
    return urlunparse(parts._replace(query="&".join(redacted_segments)))


_DEBUG_DIR_README = """\
Drive scrape diagnostics
========================

This folder was created because a `POST /api/patreon/ingest-drive-link` call
hit an unexpected state — usually a timeout waiting for the player to emit
its audio URL. The files here help figure out what Drive was actually
showing the headless browser.

⚠️  Sensitive content notice
---------------------------
The **screenshot** is a viewport capture of the page Playwright loaded with
your synced Google cookies. If your Google account UI was visible (top-right
avatar, account name, email), it WILL be in the image. Review the
screenshot before sharing it externally.

The text files (`meta.txt`, `observed_google_requests.txt`) have known
auth-token query parameters (`sig`, `lsig`, `signature`, OAuth tokens, API
keys) redacted to `<redacted>` before being written. Other URL components
are preserved verbatim. Page HTML is NOT dumped (too easy for inline
scripts to leak tokens).

Cleaning up
-----------
These dumps are not auto-deleted. Remove the parent `.drive-debug/`
directory when you're done debugging.
"""

# Drive viewer URL → file ID. Mirrors extension/lib/post-id.js#driveIdFromUrl.
_DRIVE_PATH_RE = re.compile(r"/d/([^/?#]+)")


class DriveFetchError(RuntimeError):
    """Raised when the Drive scrape fails. `code` maps to recognisable HTTP
    statuses in the route handler. `debug_dir` (when present) is the on-disk
    path of diagnostic artefacts the user can inspect to figure out *why*
    Drive didn't behave."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "fetch_failed",
        debug_dir: Optional[Path] = None,
    ):
        super().__init__(message)
        self.code = code
        self.debug_dir = debug_dir


@dataclass
class DriveFetchResult:
    audio_path: Path        # absolute path to the downloaded file
    size: int               # bytes actually written
    source_url: str         # cleaned playback URL we fetched
    file_id: str            # Drive file ID extracted from the viewer URL


def drive_id_from_url(url: str) -> Optional[str]:
    """Extract a Drive file ID from any viewer / open / playback URL.

    Accepts:
      https://drive.google.com/file/d/<ID>/view
      https://drive.google.com/file/d/<ID>/preview
      https://drive.google.com/open?id=<ID>
      https://rr4.googlevideo.com/videoplayback?…&driveid=<ID>&…

    Returns None when the URL isn't recognisable."""
    if not url:
        return None
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    path_match = _DRIVE_PATH_RE.search(parsed.path or "")
    if path_match:
        return path_match.group(1)
    # parse_qs is overkill for one param; do a tiny string split. We want to
    # preserve the value byte-for-byte (signed param tolerance).
    for segment in (parsed.query or "").split("&"):
        if "=" not in segment:
            continue
        key, _, value = segment.partition("=")
        if key in ("driveid", "id") and value:
            return value
    return None


def _request_looks_like_audio(url: str) -> bool:
    """Pre-screen for the Playwright request listener: cheap host + path test
    before we bother to inspect headers."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if not parsed.hostname or not _PLAYBACK_HOST_RE.search(parsed.hostname):
        return False
    return "/videoplayback" in (parsed.path or "")


def _itag_of(url: str) -> Optional[str]:
    """Extract the `itag` query parameter from a videoplayback URL.

    Drive identifies the stream variant via `itag` (140=m4a audio,
    134=mp4 video, etc.). Returns None if the URL has no `itag` or fails
    to parse — the caller treats that as "not the preferred audio
    stream" rather than guessing.
    """
    try:
        query = urlparse(url).query or ""
    except ValueError:
        return None
    for segment in query.split("&"):
        key, _, value = segment.partition("=")
        if key == "itag" and value:
            return value
    return None


def _is_google_request(url: str) -> bool:
    """Broader filter used only for the diagnostic trace — anything on
    google/googlevideo/googleapis/youtube. We log these on failure to
    distinguish "page didn't probe at all" from "page probed via a host
    we don't recognise"."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return bool(parsed.hostname and _GOOGLE_HOST_RE.search(parsed.hostname))


async def _dump_diagnostics(page, file_id: str, observed: list[str]) -> Optional[Path]:
    """Save a viewport screenshot + final URL + observed Google-host requests
    (URLs with auth tokens redacted) to `<AUDIO_ROOT>/.drive-debug/<file_id>-<ts>/`.
    Returns the directory path, or None if writing failed.

    Called when the playback-URL listener times out. Screenshot is the
    single highest-signal artefact: shows whether Drive is serving a login
    page, a "preview not available" notice, the actual player, or something
    else. URL list distinguishes "no probe at all" from "probe via a host
    we don't filter on".

    Security notes:
      • Page HTML is **not** dumped. Inline scripts on Google pages can
        carry short-lived auth tokens; the screenshot is enough for triage
        and is one artefact the user can visually inspect before sharing.
      • Query-string auth tokens (`sig`, `lsig`, OAuth bearers, API keys)
        are redacted from every URL before write — see
        `_SENSITIVE_QUERY_PARAMS`.
      • Screenshot is viewport-only (`full_page=False`) so we don't render
        off-screen Google account UI that might be scrolled below the fold.
      • A README in the output dir warns the user that the screenshot may
        still show signed-in account info in the page chrome.
    """
    audio_root = Path(os.environ.get("AUDIO_ROOT", ".")).resolve()
    debug_root = audio_root / ".drive-debug"
    out_dir = debug_root / f"{file_id}-{int(time.time())}"
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        log.warning("drive-debug: could not create %s: %s", out_dir, e)
        return None

    try:
        (out_dir / "README.txt").write_text(_DEBUG_DIR_README, encoding="utf-8")
    except OSError as e:
        log.warning("drive-debug: README dump failed: %s", e)

    try:
        # Viewport only — keeps off-screen account UI out of the image.
        await page.screenshot(path=str(out_dir / "screenshot.png"), full_page=False)
    except Exception as e:
        log.warning("drive-debug: screenshot failed: %s", e)

    try:
        title = await page.title()
        meta = (
            f"final_url: {_redact_sensitive_url(page.url)}\n"
            f"title: {title}\n"
        )
        (out_dir / "meta.txt").write_text(meta, encoding="utf-8")
    except Exception as e:
        log.warning("drive-debug: meta dump failed: %s", e)

    try:
        # Cap each URL at 240 chars after redaction — long enough to identify
        # the host + path + non-secret params, short enough to keep the file
        # easy to scan.
        if observed:
            lines = [_redact_sensitive_url(url)[:240] for url in observed]
            body = "\n".join(lines)
        else:
            body = "(none observed)"
        (out_dir / "observed_google_requests.txt").write_text(body, encoding="utf-8")
    except Exception as e:
        log.warning("drive-debug: observed-urls dump failed: %s", e)

    return out_dir


async def _trigger_play(page, wait_s: float = 15.0) -> bool:
    """Start media playback inside the loaded Drive viewer.

    Drive embeds its player in a YouTube iframe sitting in *cued* state
    (poster + big play button) until something tells it to play. Three
    strategies, applied in sequence as defensive layers:

      A. **Click the iframe element.** Playwright `.click()` on the
         iframe locator delivers a synthetic mouse click at the
         iframe's centre — the click event reaches the iframe content
         and the cued overlay starts playback.

      B. **Mouse-click viewport centre.** Belt-and-braces — a raw
         page-level synthetic click in case A was intercepted or raced
         a DOM update. Drive's player area is centred so the click
         lands on the same overlay. A 0.5 s settle separates this
         from A so the first click's events can propagate.

      C. **Direct media-element `.play()`** across frames. Final
         fallback for non-YouTube Drive previewers (Drive uses a
         different viewer for some `.mp3` shapes).

    **What used to be Strategy A** (postMessage of `{event: "command",
    func: "playVideo"}` to the embed iframe — YouTube's documented
    IFrame Player API) is intentionally not here. Drive's
    `hbenv=apps-elements` embed variant registers the command handler
    but its internal player exposes `playVideo` via a minified
    property the handler doesn't know about; the call lands on
    `this.aa.playVideo`, which doesn't exist, throws, and breaks the
    player's state machine. A diagnostic dump captured the resulting
    `this.aa.playVideo is not a function` line going to Drive's
    jserror endpoint. Subsequent clicks then run against a broken
    player and never produce a `videoplayback` chunk. Do not put the
    postMessage strategy back without first wiring up YouTube's
    `onReady` callback so we only send commands once the player
    confirms it's controllable.

    Always returns True at the end. The `_on_response` listener is the
    real "did it work" check; this function's return value is
    informational only.
    """
    yt_selector = 'iframe[src*="youtube.googleapis.com/embed"]'

    # Wait for the YouTube iframe to appear in the DOM. In practice it
    # lands within ~1 s; 15 s is generous.
    try:
        await page.wait_for_selector(yt_selector, timeout=int(wait_s * 1000))
    except Exception:
        # Iframe never appeared — Drive may have a non-YouTube viewer
        # for this file type. B and C still apply.
        pass

    # A. Click the iframe element itself.
    try:
        await page.locator(yt_selector).first.click(timeout=2_000)
    except Exception:
        pass

    # Settle for half a second before layering the page-level click —
    # back-to-back synthetic clicks are noisier than helpful.
    await asyncio.sleep(0.5)

    # B. Raw mouse click at viewport centre.
    try:
        viewport = page.viewport_size or {"width": 1280, "height": 720}
        cx, cy = viewport["width"] // 2, viewport["height"] // 2
        await page.mouse.click(cx, cy)
    except Exception:
        pass

    # C. Final fallback — direct media.play() across frames. Useful
    # for non-YouTube Drive previewers where the <video> element
    # exists in the page DOM directly.
    direct_play_js = """
        () => {
            const m = document.querySelector('video, audio');
            if (!m) return false;
            const p = m.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
            return true;
        }
    """
    for frame in page.frames:
        try:
            await frame.evaluate(direct_play_js)
        except Exception:
            continue

    return True


async def _emit(progress: Optional[ProgressCallback], event: dict) -> None:
    """Best-effort progress emission. Swallows callback errors so a misbehaving
    consumer can't crash the scrape. Callers always pass a fresh dict so
    downstream serialisation can't see partially-built shapes."""
    if progress is None:
        return
    try:
        await progress(event)
    except Exception as e:
        log.warning("drive-fetch: on_progress callback raised: %s", e)


async def fetch_drive_audio(
    *,
    drive_url: str,
    cookies: list[dict],
    dest_dir: Path,
    fallback_stem: str,
    explicit_filename: Optional[str] = None,
    timeout_s: float = DEFAULT_PLAYER_WAIT_S,
    on_progress: Optional[ProgressCallback] = None,
) -> DriveFetchResult:
    """End-to-end: load Drive headlessly, capture playback URL, download to disk.

    `cookies` must already be in Playwright-acceptable shape
    (`{name, value, domain, path, …}`) — see `main._normalise_cookie_for_playwright`.

    `fallback_stem` is used as the leading part of the filename when neither an
    explicit override nor a `Content-Disposition` header is present (typically
    the `post_id` so the file inherits the post-folder name).

    `on_progress`, if supplied, is awaited with each state-transition event
    so a server-sent-events caller can surface progress to the user. See
    module docstring for the event shape.
    """
    started = time.monotonic()
    file_id = drive_id_from_url(drive_url)
    if not file_id:
        raise DriveFetchError(
            f"Could not extract a Drive file ID from URL: {drive_url}",
            code="invalid_url",
        )

    # Reconstruct a canonical viewer URL — `/preview` / `/edit` variants behave
    # the same for our purposes. Use the viewer for the most reliable player init.
    canonical = f"https://drive.google.com/file/d/{file_id}/view"

    await _emit(on_progress, {"state": "launching_browser", "elapsed_s": _elapsed(started)})

    loop = asyncio.get_running_loop()
    # Two futures, soft preference for the audio stream:
    #   `audio_future` resolves only on itag=140 URLs.
    #   `any_future`   resolves on the first eligible URL of any itag.
    # The main flow waits on `any_future` for the player-emit timeout,
    # then briefly waits on `audio_future` to see if the audio stream
    # arrives within AUDIO_PREFERENCE_GRACE_S. See the constant comment
    # for why this matters.
    audio_future: asyncio.Future[str] = loop.create_future()
    any_future: asyncio.Future[str] = loop.create_future()
    observed_google: list[str] = []

    async def _on_response(response):
        url = response.url
        if _is_google_request(url) and len(observed_google) < 200:
            observed_google.append(url)
        if not _request_looks_like_audio(url):
            return

        # No size gate. Earlier rounds tried thresholds (Content-Length
        # ≥ 400 KB, or a `clen=` URL fallback) but Drive serves some
        # files in many small chunks — none of them individually exceed
        # the threshold, even though each is a valid signed playback URL
        # whose cleaned form (with `range`/`ump`/`srfvp` stripped)
        # returns the full file. The < 50 KB sanity check on the
        # downloaded body at the end of `fetch_drive_audio` is the real
        # "did we get a real file" gate; if stripping ever fails to
        # produce real content, that check fires and surfaces the URL
        # via the diagnostic dump.
        itag = _itag_of(url)
        is_audio = itag == _PREFERRED_AUDIO_ITAG
        if is_audio and not audio_future.done():
            log.info("drive-fetch: captured audio itag=140 %s", url[:160])
            audio_future.set_result(url)
        if not any_future.done():
            log.info(
                "drive-fetch: captured %sitag=%s %s",
                "(audio) " if is_audio else "",
                itag or "?",
                url[:160],
            )
            any_future.set_result(url)

    try:
        context = await _get_context(cookies)
    except ImportError as e:
        raise DriveFetchError(
            "Playwright is not installed. Add it to backend/requirements.txt "
            "and run `playwright install chromium` in the dev container.",
            code="missing_player",
        ) from e

    # Cancel the idle-close timer for the duration of this scrape — a
    # multi-minute (or hour-long, for big files) download must not be
    # killed by a 300 s idle timer fired mid-stream.
    _cancel_idle_close()
    page = await context.new_page()
    try:
        page.on("response", lambda r: asyncio.create_task(_on_response(r)))

        await _emit(on_progress, {
            "state": "loading_page",
            "drive_url": canonical,
            "elapsed_s": _elapsed(started),
        })
        try:
            await page.goto(canonical, wait_until="domcontentloaded", timeout=15_000)
        except Exception as e:
            debug_dir = await _dump_diagnostics(page, file_id, observed_google)
            raise DriveFetchError(
                f"Failed to load Drive viewer: {e}",
                code="timeout",
                debug_dir=debug_dir,
            )

        # Drive 302s unauthenticated sessions through accounts.google.com.
        # Detect the redirect here and fail fast — otherwise we'd wait the
        # full player-emit timeout (90 s) for a `videoplayback` request
        # that will never fire from the sign-in page, then report a
        # misleading generic timeout. Hostname comparison (not substring)
        # because the URL also appears as a `?continue=` query value on
        # legitimate pages.
        final_host = (urlparse(page.url).hostname or "").lower()
        if final_host == "accounts.google.com" or final_host.endswith(".accounts.google.com"):
            debug_dir = await _dump_diagnostics(page, file_id, observed_google)
            raise DriveFetchError(
                "Google session expired or not synced. Open the browser "
                "extension and click 'Sync cookie' (sign into Google in "
                "the same browser first if you've been signed out), then "
                f"retry. Drive redirected to: {page.url[:120]}",
                code="auth_expired",
                debug_dir=debug_dir,
            )

        await _emit(on_progress, {
            "state": "waiting_for_player",
            "elapsed_s": _elapsed(started),
        })
        # Trigger play. `_trigger_play` polls every frame for the
        # media element (Drive's YouTube embed mounts it asynchronously)
        # then falls back to clicking the visible play overlay if no
        # element appears in time. The response listener captures
        # the first eligible URL either way — if Drive auto-plays
        # before we get here, the trigger is a harmless no-op.
        played = await _trigger_play(page)
        if not played:
            log.info(
                "drive-fetch: neither programmatic play() nor click overlay "
                "started playback"
            )

        try:
            first_url = await asyncio.wait_for(any_future, timeout=timeout_s)
        except asyncio.TimeoutError:
            debug_dir = await _dump_diagnostics(page, file_id, observed_google)
            raise DriveFetchError(
                f"No videoplayback request observed within {timeout_s:.0f}s. "
                "Likely causes: media element didn't respond to programmatic "
                "play(), the file isn't audio/video, the Google cookie is "
                "expired, or Drive is showing a login/permission page. "
                f"Diagnostics: {debug_dir if debug_dir else '(could not write)'}",
                code="timeout",
                debug_dir=debug_dir,
            )

        # Audio-stream preference. If the first capture was already
        # itag=140, audio_future is done and we use it directly.
        # Otherwise wait up to AUDIO_PREFERENCE_GRACE_S for the audio
        # stream to show up alongside the video; fall back to the
        # first URL if it doesn't.
        if audio_future.done():
            captured_url = audio_future.result()
        else:
            try:
                captured_url = await asyncio.wait_for(
                    audio_future, timeout=AUDIO_PREFERENCE_GRACE_S
                )
                log.info(
                    "drive-fetch: preferred audio stream over first capture %s",
                    first_url[:80],
                )
            except asyncio.TimeoutError:
                captured_url = first_url
                log.info(
                    "drive-fetch: no itag=140 within %.1fs grace; "
                    "falling back to %s",
                    AUDIO_PREFERENCE_GRACE_S,
                    first_url[:80],
                )

        cleaned_url = audio_utils.strip_query_params(captured_url)
        await _emit(on_progress, {
            "state": "captured",
            "elapsed_s": _elapsed(started),
        })

        # ── Download via in-page fetch streamed through expose_function ───
        #
        # We trigger the download by issuing `fetch(url)` inside the page
        # (so it routes through Chromium's network stack with the player's
        # exact TLS, cookies, and origin — same fingerprint Drive's CDN
        # minted the URL for). The Response body is a ReadableStream; the
        # JS reader pumps chunks to Python via `window.__driveDownload`
        # (a `page.expose_function`-bound async callback). Each chunk is
        # base64-encoded over the Playwright bridge, decoded in Python,
        # and written straight to the `.part` file. Memory stays bounded
        # at chunk size (~16-64 KB typical fetch reads) regardless of
        # total file size.
        #
        # We previously tried CDP `Network.takeResponseBodyAsStream` for
        # this, but that method lives in the `Fetch` domain (not Network)
        # and requires `Fetch.enable` request interception — too much
        # additional surface area for a one-shot download. The
        # expose_function pattern accomplishes the same goal in less code.
        bytes_holder: dict[str, int] = {"n": 0}
        total_holder: dict[str, int] = {"n": 0}
        download_state: dict[str, Any] = {
            "error": None,
            "f": None,
            "target": None,
            "part": None,
            "headers_seen": False,
        }
        download_done_evt = asyncio.Event()

        async def _on_drive_msg(payload):
            if not isinstance(payload, dict):
                return
            kind = payload.get("kind")
            if kind == "headers":
                headers = {
                    str(k).lower(): str(v)
                    for k, v in (payload.get("headers") or {}).items()
                }
                cl = payload.get("contentLength")
                if isinstance(cl, (int, float)) and cl > 0:
                    total_holder["n"] = int(cl)
                status = payload.get("status")
                if not payload.get("ok"):
                    download_state["error"] = (
                        f"Playback URL fetch returned {status} — the URL may "
                        "have expired between scrape and download."
                    )
                    download_done_evt.set()
                    return
                # Derive filename now that we know Content-Disposition /
                # Content-Type, then open the .part file for writing.
                try:
                    filename = audio_utils.derive_filename(
                        explicit=explicit_filename,
                        content_disposition=headers.get("content-disposition"),
                        content_type=headers.get("content-type"),
                        fallback_stem=fallback_stem,
                    )
                    target = audio_utils.unique_destination(dest_dir / filename)
                    part = target.with_suffix(target.suffix + ".part")
                    download_state["target"] = target
                    download_state["part"] = part
                    download_state["f"] = part.open("wb")
                    download_state["headers_seen"] = True
                except Exception as e:
                    download_state["error"] = f"failed to open destination: {e}"
                    download_done_evt.set()
                return
            if kind == "chunk":
                f = download_state["f"]
                if f is None:
                    download_state["error"] = "received chunk before headers"
                    download_done_evt.set()
                    return
                try:
                    decoded = base64.b64decode(payload.get("data") or "")
                    f.write(decoded)
                except Exception as e:
                    download_state["error"] = f"chunk write failed: {e}"
                    download_done_evt.set()
                    return
                bytes_holder["n"] += len(decoded)
                return
            if kind == "done":
                download_done_evt.set()
                return
            if kind == "error":
                download_state["error"] = str(payload.get("message") or "unknown")
                download_done_evt.set()
                return

        await page.expose_function("__driveDownload", _on_drive_msg)

        await _emit(on_progress, {
            "state": "downloading",
            "bytes": 0,
            "total": None,
            "elapsed_s": _elapsed(started),
        })

        download_started = time.monotonic()
        heartbeat_task = asyncio.create_task(
            _download_heartbeat(
                on_progress, started, download_started, total_holder, bytes_holder
            )
        )

        # JS-side streaming reader. Note `String.fromCharCode` is called in
        # a loop (not via spread) because fetch chunks can occasionally
        # exceed the function-arg cap on some Chromium versions; the loop
        # is robust across chunk sizes.
        fetch_task = asyncio.create_task(page.evaluate(
            """
            async (url) => {
                try {
                    const res = await fetch(url, { credentials: 'include' });
                    const headersObj = {};
                    res.headers.forEach((v, k) => { headersObj[k] = v; });
                    await window.__driveDownload({
                        kind: 'headers',
                        status: res.status,
                        ok: res.ok,
                        headers: headersObj,
                        contentLength: +(res.headers.get('content-length') || 0),
                    });
                    if (!res.ok) return;
                    const reader = res.body.getReader();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            await window.__driveDownload({ kind: 'done' });
                            return;
                        }
                        let bin = '';
                        for (let i = 0; i < value.length; i++) {
                            bin += String.fromCharCode(value[i]);
                        }
                        await window.__driveDownload({ kind: 'chunk', data: btoa(bin) });
                    }
                } catch (e) {
                    await window.__driveDownload({
                        kind: 'error',
                        message: (e && e.message) ? e.message : String(e),
                    });
                }
            }
            """,
            cleaned_url,
        ))

        try:
            try:
                await asyncio.wait_for(
                    download_done_evt.wait(), timeout=DOWNLOAD_TIMEOUT_S
                )
            except asyncio.TimeoutError as e:
                raise DriveFetchError(
                    f"Drive download timed out after {DOWNLOAD_TIMEOUT_S:.0f}s.",
                    code="timeout",
                ) from e
        finally:
            heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await heartbeat_task
            # Close the .part file handle even on error/timeout.
            f = download_state.get("f")
            if f is not None and not f.closed:
                with contextlib.suppress(Exception):
                    f.close()
            # Drain the JS task. If it's still running (timeout case), the
            # page-close in the outer finally will cancel its in-flight
            # fetch via AbortError; we just need to not leak the awaitable.
            if not fetch_task.done():
                fetch_task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await fetch_task

        target = download_state.get("target")
        part = download_state.get("part")
        bytes_written = bytes_holder["n"]

        if download_state["error"]:
            if part is not None:
                part.unlink(missing_ok=True)
            raise DriveFetchError(
                f"Drive fetch failed: {download_state['error']}",
                code="fetch_failed",
            )
        if part is None or target is None:
            raise DriveFetchError(
                "Drive fetch reported done but no file was created — "
                "headers callback never fired.",
                code="fetch_failed",
            )

        # Sanity check: probe responses or empty bodies should never
        # masquerade as a successful download. 50 KB is well below any
        # real ASMR audio and well above what a probe response would land
        # at. Mirrors the previous body-based check.
        if bytes_written < 50_000:
            part.unlink(missing_ok=True)
            debug_dir = await _dump_diagnostics(page, file_id, observed_google)
            raise DriveFetchError(
                f"Downloaded only {bytes_written} bytes — almost certainly "
                "not the real audio (probe response or Drive returned an "
                f"empty body). Diagnostics: {debug_dir if debug_dir else '(could not write)'}",
                code="fetch_failed",
                debug_dir=debug_dir,
            )

        part.rename(target)

        await _emit(on_progress, {
            "state": "downloading",
            "bytes": bytes_written,
            "total": bytes_written,
            "elapsed_s": _elapsed(started),
        })

        return DriveFetchResult(
            audio_path=target,
            size=bytes_written,
            source_url=cleaned_url,
            file_id=file_id,
        )
    finally:
        # Close the page but keep the shared context alive so cookie
        # rotations from this playback propagate to the next queued scrape.
        with contextlib.suppress(Exception):
            await page.close()
        # Re-arm the idle-close timer now that the scrape is done.
        _schedule_idle_close()


def _elapsed(since: float) -> float:
    """Seconds since `since`, rounded to 0.1s. Hand-truncated rather than
    `round(..., 1)` so we don't bury sub-100 ms timings."""
    return round(time.monotonic() - since, 1)


async def _download_heartbeat(
    on_progress: Optional[ProgressCallback],
    started: float,
    download_started: float,
    total_holder: dict[str, int],
    bytes_holder: dict[str, int],
) -> None:
    """Periodic `downloading` event with live byte counters.

    Reads `bytes_holder["n"]` (running total from `Network.dataReceived`
    events) and `total_holder["n"]` (Content-Length from `Network.
    responseReceived`) on each tick. Holder dicts are shared references —
    they're mutated in the CDP event handlers and we observe the latest
    values here. Cancelled by the caller once the download finishes;
    exits cleanly on cancellation."""
    if on_progress is None:
        return
    try:
        while True:
            await asyncio.sleep(DOWNLOAD_HEARTBEAT_S)
            total = total_holder["n"]
            await _emit(on_progress, {
                "state": "downloading",
                "bytes": bytes_holder["n"],
                "total": total if total > 0 else None,
                "download_elapsed_s": _elapsed(download_started),
                "elapsed_s": _elapsed(started),
            })
    except asyncio.CancelledError:
        return
