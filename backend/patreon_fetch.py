"""Wraps the `patreon-dl` CLI subprocess and parses its output.

The integration is intentionally a one-shot subprocess call:
no IPC, no sidecar service. patreon-dl writes media + raw API JSON to
disk, and this module reads back what it produced.
"""

import collections
import contextlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from backend.audio_utils import AUDIO_FORMATS_CONFIG, flatten_dest_parts, unique_destination

PATREON_DL_BIN = os.environ.get("PATREON_DL_BIN", "patreon-dl")
# Hard cap so a runaway creator-wide download can't hang the API forever.
DEFAULT_TIMEOUT_SECONDS = 60 * 30

# Audio extension set derived from the shared config in audio_utils.
# Keeps `_find_first_audio` from quietly diverging from what the file
# browser considers an audio file.
AUDIO_EXTS = set(AUDIO_FORMATS_CONFIG["metadataCompatibleExts"]) | set(
    AUDIO_FORMATS_CONFIG["needsConversionExts"]
)

# patreon-dl's media-type vocabulary plus our synthetic `external` flag.
# `external` signals `_write_config` to drop the `posts.with.media.type`
# filter so posts whose only audio is a Drive URL still surface — patreon-dl
# never sees the literal string.
ALLOWED_CONTENT_TYPES = ("audio", "video", "image", "attachment", "external")


class PatreonFetchError(RuntimeError):
    """Raised when patreon-dl fails or returns no usable content."""


# File-host links surfaced on FetchedPost.external_links so the frontend
# can flag the post for the per-link Download flow. Drive-only auto-capture
# happens server-side via `backend.drive_fetch`; the others surface as
# plain links the user opens manually.
EXTERNAL_HOST_ALLOWLIST = (
    "drive.google.com",
    "mega.nz",
    "mediafire.com",
    "dropbox.com",
)

# Single-post URL → numeric ID, used by the metadata-only fast-path to
# look up the cached sidecar when status.cache made patreon-dl skip the
# re-write. Creator URLs lack `/posts/` so they don't match.
_POST_URL_ID_RE = re.compile(
    r"patreon\.com/posts/[^/?#]*?(\d+)(?:[/?#]|$)",
    re.IGNORECASE,
)

# Creator URL → vanity slug. Matches both styles Patreon currently serves:
#   patreon.com/c/<vanity>[/posts][?vanity=…]   (newer canonical)
#   patreon.com/<vanity>[/posts]                (older shorthand)
# The fast-path in `fetch()` reads the vanity to filter cached sidecars
# down to a single creator's posts. Falls back to patreon-dl when no
# vanity is parseable.
_VANITY_C_RE = re.compile(r"patreon\.com/c/([^/?#]+)", re.IGNORECASE)
_VANITY_OLD_RE = re.compile(r"patreon\.com/([^/?#]+)", re.IGNORECASE)
# Reserved path segments that can appear at patreon.com/<segment> but
# aren't creator vanities — skipping them prevents false positives like
# treating `patreon.com/home` as a creator URL.
_RESERVED_VANITY_PATHS = frozenset(
    {
        "c",
        "posts",
        "home",
        "search",
        "settings",
        "join",
        "login",
        "messages",
        "api",
        "policy",
        "about",
        "help",
        "creators",
        "auth",
    }
)

# URL patterns for `attributes.content` HTML. Creators store links in
# several shapes; we scan all of them and let EXTERNAL_HOST_ALLOWLIST
# filter the candidates. The anchor regex captures both URL and inner
# HTML so the visible text becomes a per-download filename hint.
_ANCHOR_RE = re.compile(
    r"""<a\s+[^>]*?href\s*=\s*['"]([^'"]+)['"][^>]*>(.*?)</a>""",
    re.IGNORECASE | re.DOTALL,
)
_SRC_RE = re.compile(r"""src\s*=\s*['"]([^'"]+)['"]""", re.IGNORECASE)
# Strip inline HTML tags from anchor inner-html so the remaining text is the
# user-visible label (e.g. `<strong>foo</strong>` → `foo`).
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
# Plain-text URLs that aren't wrapped in <a> or <iframe>. Stops at whitespace,
# HTML metacharacters, or a closing paren — those are almost never part of a
# real URL and would otherwise capture surrounding markup. Trailing sentence
# punctuation is trimmed below in `_extract_external_links`.
_PLAIN_URL_RE = re.compile(r"""https?://[^\s<>'"\)\]]+""", re.IGNORECASE)
# Punctuation that's almost always a sentence-end rather than part of the URL.
_URL_TRAILING_PUNCT = ".,;:!?"


def _anchor_text(inner_html: str) -> str:
    """Strip inline HTML and collapse whitespace inside an `<a>` element."""
    return _WS_RE.sub(" ", _HTML_TAG_RE.sub("", inner_html)).strip()


@dataclass
class ExternalLink:
    """A third-party file-host URL surfaced from a post's body, plus the
    visible anchor text when the source was an `<a>` element. The text is
    used as the per-download filename hint so multiple links on the same
    post end up with distinct, human-readable filenames. Empty string for
    non-anchor sources (iframes, plain-text URLs, embed.url)."""

    url: str
    text: str = ""


@dataclass
class FetchedPost:
    post_id: str
    title: str
    tags: list[str]
    artist: str  # creator's full_name from the post's user relationship
    post_dir: str  # absolute path to the post directory
    audio_path: str | None  # absolute path to the first audio file, if any
    # URLs found inside the post body whose host is in
    # EXTERNAL_HOST_ALLOWLIST, each paired with the visible anchor text
    # (when the source was an `<a>` tag). The user typically needs to open
    # these via the workbench's per-link Download button (Drive scrape) or
    # in the browser (Mega/MediaFire/Dropbox).
    external_links: list[ExternalLink] = field(default_factory=list)


@dataclass
class FetchResult:
    output_dir: str
    posts: list[FetchedPost]
    log_tail: str


@dataclass
class PatreonFetchOptions:
    """All the knobs we pass to patreon-dl via its config file.

    The wrapper always writes a temp config (even if every knob is at its
    default) and passes it via --config-file. This keeps the invocation
    shape stable as new filters get added — each one is one more line
    in `_write_config`, never a new branch around the subprocess call.
    """

    # The Patreon session cookie. Written into the temp config file's
    # [downloader] section rather than the CLI argv so it can't be read
    # via /proc/<pid>/cmdline on shared hosts. The temp file is created
    # with mode 0600 (mkstemp default) and unlinked in the finally block.
    cookie: str = ""
    metadata_only: bool = False
    # Which media types to download. Empty = patreon-dl default (everything);
    # we set ["audio"] as the wrapper default since this is an ASMR tool.
    # Ignored when `metadata_only` is True.
    content_types: list[str] = field(default_factory=lambda: ["audio"])
    # ISO yyyy-MM-dd strings. Only meaningful for creator URLs; patreon-dl
    # silently ignores them for single-post URLs.
    published_after: str | None = None
    published_before: str | None = None
    # Walk the whole pipeline without writing any files to disk. patreon-dl
    # still resolves post metadata (so title/tags/artist come back) but no
    # audio / images / attachments get downloaded. Useful for previewing
    # what a filter combo would produce before committing.
    dry_run: bool = False


def fetch(
    url: str,
    cookie: str,
    output_dir: Path,
    metadata_only: bool = False,
    content_types: list[str] | None = None,
    published_after: str | None = None,
    published_before: str | None = None,
    dry_run: bool = False,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> FetchResult:
    """Download `url` with patreon-dl into `output_dir` and return parsed metadata.

    - `metadata_only`: skip the audio/media but still write the API JSON sidecar.
      Useful when the user already has the file on disk and only wants tags.
    - `content_types`: which media types patreon-dl should download (e.g.
      `["audio"]`, `["audio", "image"]`). When omitted defaults to `["audio"]`
      since this is an ASMR audio tool. Values outside `ALLOWED_CONTENT_TYPES`
      are silently dropped. Ignored when `metadata_only` is True.
    - `published_after` / `published_before`: ISO `yyyy-MM-dd` date bounds for
      creator URLs (no-op on single-post URLs). Caller should validate the
      format; we pass strings through verbatim.
    """
    if not shutil.which(PATREON_DL_BIN):
        raise PatreonFetchError(
            f"patreon-dl binary not found on PATH (looked for '{PATREON_DL_BIN}'). "
            "Install it in the container or set PATREON_DL_BIN."
        )

    output_dir.mkdir(parents=True, exist_ok=True)

    # Metadata-only fast path: skip the patreon-dl subprocess when the
    # info is already on disk (patreon-dl's status cache would emit the
    # same result minus a network round-trip + Node startup). Single-post
    # URL → one sidecar; creator URL → all matching sidecars + date
    # filter. First-time fetches fall through to the normal flow.
    if metadata_only:
        cached_post_id = _post_id_from_url(url)
        if cached_post_id:
            cached = _find_cached_post(output_dir, cached_post_id)
            if cached is not None:
                return FetchResult(
                    output_dir=str(output_dir),
                    posts=[cached],
                    log_tail="",
                )
        else:
            vanity = _vanity_from_url(url)
            if vanity:
                cached_posts = _find_cached_creator_posts(
                    output_dir,
                    vanity,
                    published_after=published_after,
                    published_before=published_before,
                )
                if cached_posts:
                    return FetchResult(
                        output_dir=str(output_dir),
                        posts=cached_posts,
                        log_tail="",
                    )

    opts = PatreonFetchOptions(
        cookie=cookie,
        metadata_only=metadata_only,
        content_types=_clean_content_types(content_types),
        published_after=published_after,
        published_before=published_before,
        dry_run=dry_run,
    )
    config_path = _write_config(opts)

    # `_collect_posts` filters sidecars by mtime > fetch_started_at so a
    # re-fetch doesn't re-surface already-cached posts. -2 s pre-roll
    # absorbs filesystem mtime resolution on bind-mounted hosts.
    fetch_started_at = time.time() - 2

    # Cookie is passed via the config file (see _write_config) rather than
    # `--cookie <value>` on the argv, so it doesn't leak through
    # /proc/<pid>/cmdline on shared hosts. The config file is mode 0600 and
    # unlinked in the finally block below.
    cmd = [
        PATREON_DL_BIN,
        "--target-url",
        url,
        "--out-dir",
        str(output_dir),
        "--no-prompt",
        "--log-level",
        "info",
        "--config-file",
        config_path,
    ]

    # Drain stdout (with stderr merged) line-by-line into a bounded deque on
    # a daemon thread so a multi-hour patreon-dl run can't OOM the wrapper
    # by accumulating tens of MB of stdout — earlier `subprocess.run(PIPE)`
    # buffered the entire output. The deque cap keeps memory bounded
    # regardless of run length; we still grab the last ~2000 chars for the
    # log tail at the end.
    tail_lines: collections.deque[str] = collections.deque(maxlen=400)
    returncode: int

    def _drain(stream) -> None:
        for line in iter(stream.readline, ""):
            tail_lines.append(line)

    try:
        # Merge stderr into stdout — patreon-dl writes its info/warn lines to
        # stdout via console.log; we want both streams in one chronological tail.
        with subprocess.Popen(
            cmd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,  # line-buffered
        ) as proc:
            assert proc.stdout is not None
            drain_thread = threading.Thread(target=_drain, args=(proc.stdout,), daemon=True)
            drain_thread.start()
            try:
                returncode = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired as e:
                proc.kill()
                proc.wait()
                drain_thread.join(timeout=2)
                raise PatreonFetchError(f"patreon-dl timed out after {timeout}s") from e
            drain_thread.join(timeout=5)
    finally:
        Path(config_path).unlink(missing_ok=True)

    # Defence-in-depth: scrub the cookie value out of the log tail before we
    # surface it anywhere. patreon-dl doesn't currently echo the cookie, but
    # if it ever did, this stops it leaking into error messages or the API
    # response body.
    log_tail = _scrub_cookie("".join(tail_lines)[-2000:], cookie)
    if returncode != 0:
        raise PatreonFetchError(f"patreon-dl exited with code {returncode}. log tail: {log_tail}")

    posts = _collect_posts(output_dir, since=fetch_started_at)

    # Skip post-fetch cleanup + flatten in dry-run (nothing was written
    # to clean up or move).
    if not dry_run:
        # Prune cover-image / thumbnail files patreon-dl drops into each
        # post's post_info/ subdir when the user didn't opt into image
        # content. They're gated by content.info on patreon-dl's side
        # (which we can't disable without losing post-api.json), so the
        # only way to suppress them is to delete after the fact.
        if "image" not in opts.content_types:
            _cleanup_info_media(posts)
        # Pull each audio file out of patreon-dl's
        # <campaign>/posts/<id>/audio/ nesting into the flattened
        # <DOWNLOAD_PATH>/<creator>/<post_id> - <title>/ layout. The
        # actual path construction lives in audio_utils.flatten_dest_parts.
        posts = _flatten_audio(posts, output_dir)

    return FetchResult(output_dir=str(output_dir), posts=posts, log_tail=log_tail)


def _scrub_cookie(text: str, cookie: str) -> str:
    """Replace any literal occurrence of the cookie value in `text` with
    `[REDACTED]`. Skips work when the cookie is empty or too short to be a
    realistic accidental echo (avoids stripping common short prefixes)."""
    if not text or not cookie or len(cookie) < 16:
        return text
    return text.replace(cookie, "[REDACTED]")


def _clean_content_types(types: list[str] | None) -> list[str]:
    """Normalise + filter a content-types input. None or empty → wrapper default."""
    if not types:
        return ["audio"]
    cleaned: list[str] = []
    seen: set[str] = set()
    for t in types:
        if not isinstance(t, str):
            continue
        v = t.strip().lower()
        if v in ALLOWED_CONTENT_TYPES and v not in seen:
            seen.add(v)
            cleaned.append(v)
    return cleaned or ["audio"]


def _write_config(opts: PatreonFetchOptions) -> str:
    """Write a temp patreon-dl config file driven by `opts`. Caller must unlink it.

    Always writes at least the auto-generated banner + an `[include]` header,
    even when every knob is at its default. patreon-dl tolerates a near-empty
    config; the shape is what matters — once this file exists, every future
    knob is a one-line addition here.
    """
    lines: list[str] = [
        "# Autogenerated by asmr-workbench patreon_fetch.py — do not edit.",
    ]

    # ── [downloader] section ────────────────────────────────────────────────
    # `stop.on` ends the walk early; per-post dedup is separate
    # (`use.status.cache`). Date filter → publishDateOutOfRange; otherwise →
    # previouslyDownloaded so re-fetches of a creator URL terminate fast.
    lines.append("[downloader]")
    if opts.cookie:
        # patreon-dl reads downloader:cookie as a single value to end-of-line,
        # so the inner `=` and `;` in a Patreon session cookie are fine.
        # Reject embedded newlines defensively — they would terminate the
        # INI value early and inject keys.
        if "\n" in opts.cookie or "\r" in opts.cookie:
            raise PatreonFetchError("cookie contains a newline — refusing to write config")
        lines.append(f"cookie = {opts.cookie}")
    if opts.published_after or opts.published_before:
        lines.append("stop.on = publishDateOutOfRange")
    else:
        lines.append("stop.on = previouslyDownloaded")
    if opts.dry_run:
        # Run the pipeline (resolve posts + media) without writing files.
        # Title / tags / artist still come back via the post-api.json sidecar.
        lines.append("dry.run = 1")

    # ── [include] section ───────────────────────────────────────────────────
    # Two filters map onto patreon-dl: `posts.with.media.type` narrows
    # which posts get visited (omit it to walk every accessible post —
    # metadata_only and "external" both want that), and `content.media`
    # controls what's downloaded from visited posts ("external" is a
    # wrapper-only flag and filtered out here).
    media_types = [t for t in opts.content_types if t != "external"]
    walk_all_posts = opts.metadata_only or ("external" in opts.content_types)

    lines.append("[include]")
    if opts.metadata_only:
        # Skip every media class; sidecars still arrive via content.info.
        lines.append("content.media = 0")
        lines.append("preview.media = 0")
    else:
        if not walk_all_posts and media_types:
            lines.append(f"posts.with.media.type = {', '.join(media_types)}")
        if media_types:
            lines.append(f"content.media = {', '.join(media_types)}")
        else:
            # External-only: walk every post, download nothing; sidecars
            # still surface body-text URLs in external_links.
            lines.append("content.media = 0")
        # Disable the unused thumbnails/ subfolder. Separate from the
        # cover-image / post-thumbnail files in post_info/, which are
        # gated by the un-disable-able content.info and pruned later by
        # _cleanup_info_media.
        if "image" not in media_types:
            lines.append("media.thumbnails = 0")
    if opts.published_after:
        lines.append(f"posts.published.after = {opts.published_after}")
    if opts.published_before:
        lines.append(f"posts.published.before = {opts.published_before}")
    body = "\n".join(lines) + "\n"

    fd, path = tempfile.mkstemp(prefix="patreon-dl-", suffix=".conf", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
    except Exception:
        Path(path).unlink(missing_ok=True)
        raise
    return path


def _post_id_from_url(url: str) -> str | None:
    """Return the numeric post ID if `url` is a single-post Patreon URL.

    Single-post URLs look like `patreon.com/posts/<slug>-<id>` (with
    optional `?` / `#` / trailing slash). Creator URLs and anything
    unparseable return None — the metadata-only re-fetch fallback only
    fires for single-post URLs to keep its blast radius small.
    """
    if not isinstance(url, str) or not url:
        return None
    m = _POST_URL_ID_RE.search(url)
    return m.group(1) if m else None


def _vanity_from_url(url: str) -> str | None:
    """Return the creator vanity slug if `url` is a Patreon creator URL.

    Handles both the new canonical form (`patreon.com/c/<vanity>`) and the
    older shorthand (`patreon.com/<vanity>`). Single-post URLs return None
    so the caller routes them to the post-id fast path instead. Reserved
    paths (`home`, `search`, `settings`, …) are filtered out — they look
    like vanities to the regex but never name a creator.
    """
    if not isinstance(url, str) or not url:
        return None
    # Single-post URLs go through the post-id path, not the vanity path.
    if _POST_URL_ID_RE.search(url):
        return None
    m = _VANITY_C_RE.search(url)
    if m:
        return m.group(1).lower()
    m = _VANITY_OLD_RE.search(url)
    if m:
        candidate = m.group(1).lower()
        if candidate and candidate not in _RESERVED_VANITY_PATHS:
            return candidate
    return None


def _campaign_vanity_from_payload(payload: dict) -> str | None:
    """Pull the campaign vanity out of a Patreon JSON:API post payload.

    Follows post → campaign relationship into the `included` array, same
    shape `_extract_artist` uses for the user relationship. Returns the
    lowercased vanity so it can be compared against `_vanity_from_url`.
    """
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return None
    rel = ((data.get("relationships") or {}).get("campaign") or {}).get("data") or {}
    campaign_id = rel.get("id")
    if not campaign_id:
        return None
    included = payload.get("included")
    if not isinstance(included, list):
        return None
    for item in included:
        if (
            isinstance(item, dict)
            and item.get("type") == "campaign"
            and item.get("id") == campaign_id
        ):
            vanity = (item.get("attributes") or {}).get("vanity")
            if isinstance(vanity, str) and vanity:
                return vanity.lower()
    return None


def _slugify(s: str) -> str:
    """Lowercase + strip non-alphanumeric. Used as a permissive fallback
    when matching a creator's `full_name` against the URL vanity ("Solar
    Girl ASMR" → "solargirlasmr"). Vanity slugs on Patreon are usually a
    flattened version of the display name."""
    if not isinstance(s, str):
        return ""
    return "".join(ch for ch in s.lower() if ch.isalnum())


def _published_at_from_payload(payload: dict) -> str:
    """Extract `published_at` from a Patreon JSON:API post payload.

    Returned as an ISO-8601 string (e.g. "2025-11-15T12:34:56.000+00:00").
    Empty string when the field is missing or malformed — the caller
    treats empty as "no date known, don't filter".
    """
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return ""
    pub = (data.get("attributes") or {}).get("published_at")
    if isinstance(pub, str) and pub:
        return pub
    return ""


def _iter_cached_posts(output_dir: Path):
    """Yield `(FetchedPost, published_at, raw_payload)` for every parseable
    sidecar under `output_dir`.

    Shared walker for the metadata-only re-fetch fast paths (single-post
    by id, creator-URL by vanity). Both need the same parse + audio-path
    resolution + flatten-fallback; only the match predicate differs.

    Skips sidecars that fail to parse (corrupt JSON or unexpected shape).
    Audio path falls back to the flattened destination produced by a prior
    run of `_flatten_audio` — first the current
    `<DOWNLOAD_PATH>/<creator>/<post_id> - <title>/` layout, then the
    legacy `<DOWNLOAD_PATH>/<post_id>/` layout, so posts downloaded before
    the layout change still resolve. `output_dir.parent` IS DOWNLOAD_PATH
    because output_dir is `DOWNLOAD_PATH/.patreon-dl/`.

    Not shared with `_collect_posts` because that walker filters by sidecar
    mtime (newer than the current fetch's start time) and explicitly does
    not want the flatten fallback — its concern is "what did THIS run
    write", which is the opposite of "what's cached from earlier runs".
    """
    for api_file in output_dir.rglob("post-api.json"):
        try:
            data = json.loads(api_file.read_text(encoding="utf-8"))
        except OSError, json.JSONDecodeError:
            continue
        parsed = _parse_post_api(data)
        if parsed is None:
            continue
        post_id, title, tags, artist, external_links = parsed
        post_dir = api_file.parent.parent
        audio_path = _find_first_audio(post_dir)
        if audio_path is None:
            creator, folder_name = flatten_dest_parts(post_id, artist, title)
            new_dir = output_dir.parent / creator / folder_name
            legacy_dir = output_dir.parent / post_id
            for candidate in (new_dir, legacy_dir):
                if not candidate.is_dir():
                    continue
                for entry in sorted(candidate.iterdir()):
                    if entry.is_file() and entry.suffix.lower() in AUDIO_EXTS:
                        audio_path = entry
                        break
                if audio_path is not None:
                    break
        post = FetchedPost(
            post_id=post_id,
            title=title,
            tags=tags,
            artist=artist,
            post_dir=str(post_dir),
            audio_path=str(audio_path) if audio_path else None,
            external_links=external_links,
        )
        yield post, _published_at_from_payload(data), data


def _find_cached_creator_posts(
    output_dir: Path,
    vanity: str,
    published_after: str | None,
    published_before: str | None,
) -> list[FetchedPost]:
    """Walk cached sidecars under `output_dir` for posts belonging to the
    creator identified by `vanity`.

    Mirrors what patreon-dl would return for a creator URL in metadata-only
    mode: every post sidecar belonging to this creator, filtered by the
    same `posts.published.after` / `posts.published.before` date bounds
    patreon-dl applies server-side (inclusive both ends). Empty list means
    "nothing cached for this creator" — caller falls through to the
    patreon-dl subprocess. Returned ordering is newest-first by
    `published_at`, matching patreon-dl's walk order so the UI presents
    the same sequence either way.

    Match strategy: prefer `relationships.campaign.vanity` from the
    sidecar (the precise signal), fall back to a slugified `full_name`
    when the `included` array omits the campaign object. Patreon vanity
    slugs typically equal the creator's display name with whitespace and
    punctuation stripped ("Solar Girl ASMR" → "solargirlasmr"), so the
    fallback resolves the common case without requiring the campaign
    include to be present.
    """
    target = vanity.lower()
    matches: list[tuple[str, FetchedPost]] = []
    for post, published_at, data in _iter_cached_posts(output_dir):
        sidecar_vanity = _campaign_vanity_from_payload(data) or _slugify(post.artist) or None
        if sidecar_vanity != target:
            continue
        # Compare yyyy-MM-dd prefix against patreon-dl-style bounds. Skip
        # filtering when published_at is missing — we still want the post
        # to surface, same as patreon-dl would.
        date_prefix = published_at[:10]
        if published_after and date_prefix and date_prefix < published_after:
            continue
        if published_before and date_prefix and date_prefix > published_before:
            continue
        matches.append((published_at, post))
    # Newest-first; empty published_at sorts last (rare; usually drafts).
    matches.sort(key=lambda x: x[0] or "", reverse=True)
    return [post for _, post in matches]


def _find_cached_post(output_dir: Path, post_id: str) -> FetchedPost | None:
    """Find a previously-downloaded post's metadata by id, ignoring the
    mtime filter `_collect_posts` uses.

    When the user re-fetches a single-post URL in metadata-only mode,
    patreon-dl's `stop.on = previouslyDownloaded` + status cache make it
    exit without re-writing `post-api.json`. The mtime-filtered
    `_collect_posts` then returns empty and the user would see a
    misleading "no new posts" error even though the metadata sits on
    disk from the original fetch. This helper surfaces that cached
    sidecar so the user doesn't have to nuke `.patreon-dl/` to recover
    it.
    """
    for post, _, _ in _iter_cached_posts(output_dir):
        if post.post_id == post_id:
            return post
    return None


def _collect_posts(
    output_dir: Path,
    since: float | None = None,
) -> list[FetchedPost]:
    """Walk patreon-dl's output and pull title/tags/audio out of each post-api.json.

    `since` (epoch seconds) filters out sidecars older than the current fetch —
    posts patreon-dl previously downloaded and skipped on this run via
    `use.status.cache`. Without this filter, every re-fetch returns stale
    results from prior runs.
    """
    posts: list[FetchedPost] = []
    for api_file in output_dir.rglob("post-api.json"):
        if since is not None:
            try:
                if api_file.stat().st_mtime < since:
                    continue  # written before this fetch started — stale
            except OSError:
                continue
        # patreon-dl layout: <post_dir>/info/post-api.json
        post_dir = api_file.parent.parent
        try:
            data = json.loads(api_file.read_text(encoding="utf-8"))
        except OSError, json.JSONDecodeError:
            continue
        parsed = _parse_post_api(data)
        if parsed is None:
            continue
        post_id, title, tags, artist, external_links = parsed
        audio_path = _find_first_audio(post_dir)
        posts.append(
            FetchedPost(
                post_id=post_id,
                title=title,
                tags=tags,
                artist=artist,
                post_dir=str(post_dir),
                audio_path=str(audio_path) if audio_path else None,
                external_links=external_links,
            )
        )
    posts.sort(key=lambda p: p.post_id)
    return posts


def _parse_post_api(
    payload: dict,
) -> tuple[str, str, list[str], str, list[ExternalLink]] | None:
    """Extract (post_id, title, tags[], artist, external_links[]) from a Patreon
    JSON:API payload."""
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return None
    post_id = str(data.get("id") or "")
    if not post_id:
        return None
    attrs = data.get("attributes") or {}
    title = str(attrs.get("title") or "").strip()
    tags = _extract_tags(payload)
    artist = _extract_artist(payload)
    external_links = _extract_external_links(attrs)
    return post_id, title, tags, artist, external_links


def _is_allowlisted_host(url: str) -> bool:
    """True when `url` parses to a host that exactly matches, or is a
    subdomain of, any entry in EXTERNAL_HOST_ALLOWLIST."""
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    if not host:
        return False
    return any(host == h or host.endswith("." + h) for h in EXTERNAL_HOST_ALLOWLIST)


def _walk_prosemirror_nodes(node: object, sink: list[ExternalLink]) -> None:
    """Recursively collect href/url/src strings from a ProseMirror JSON tree.

    Patreon's newer post editor stores bodies in `attributes.content_json_string`
    (the HTML `content` field is `null` for those posts). Links live in two
    places: `marks: [{type: "link", attrs: {href}}]` on text nodes (text is the
    label) and `attrs: {href|url|src}` on image/embed/iframe nodes (no label).
    Children sit under `node.content`. Caller filters via allowlist.
    """
    if not isinstance(node, dict):
        return
    attrs = node.get("attrs")
    if isinstance(attrs, dict):
        for key in ("href", "url", "src"):
            v = attrs.get(key)
            if isinstance(v, str) and v.strip():
                sink.append(ExternalLink(url=v.strip(), text=""))
    marks = node.get("marks")
    if isinstance(marks, list):
        # Link marks decorate a text node; the visible label is the node's
        # `text`. Capture it once and pair it with every URL the mark stack
        # declares (typically just one).
        node_text = node.get("text")
        link_text = node_text.strip() if isinstance(node_text, str) else ""
        for mark in marks:
            if not isinstance(mark, dict):
                continue
            mattrs = mark.get("attrs")
            if isinstance(mattrs, dict):
                for key in ("href", "url"):
                    v = mattrs.get(key)
                    if isinstance(v, str) and v.strip():
                        sink.append(ExternalLink(url=v.strip(), text=link_text))
    children = node.get("content")
    if isinstance(children, list):
        for child in children:
            _walk_prosemirror_nodes(child, sink)


def _extract_external_links(attrs: object) -> list[ExternalLink]:
    """Pull third-party file-host URLs out of a post's JSON:API attributes.

    Three sources, scanned in order with `_is_allowlisted_host` gating:
      1. `attrs["content"]` HTML — `<a>`, `<iframe src>`, and bare URLs.
      2. `attrs["embed"]["url"]` — the "Add link/embed" UI value.
         `embed["provider_url"]` is intentionally skipped (host homepage).
      3. `attrs["content_json_string"]` ProseMirror tree — used by the
         newer editor where `content` is null. See `_walk_prosemirror_nodes`.

    Returned list is deduped by URL (stable order, first occurrence wins).
    """
    if not isinstance(attrs, dict):
        return []

    candidates: list[ExternalLink] = []

    content = attrs.get("content")
    if isinstance(content, str) and content:
        # Anchors first — preferred source because they carry visible text.
        # Track which URLs we already grabbed via anchors so we don't also
        # match the same URL as a plain-text URL below.
        anchored: set[str] = set()
        for match in _ANCHOR_RE.finditer(content):
            url = match.group(1).strip()
            text = _anchor_text(match.group(2) or "")
            if url:
                candidates.append(ExternalLink(url=url, text=text))
                anchored.add(url)
        for match in _SRC_RE.finditer(content):
            url = match.group(1).strip()
            if url and url not in anchored:
                candidates.append(ExternalLink(url=url, text=""))
        for match in _PLAIN_URL_RE.finditer(content):
            url = match.group(0).strip()
            # Trim trailing sentence punctuation: "see https://drive.google.com/…."
            # commonly comes through with a clinging period that breaks the URL.
            while url and url[-1] in _URL_TRAILING_PUNCT:
                url = url[:-1]
            if url and url not in anchored:
                candidates.append(ExternalLink(url=url, text=""))

    embed = attrs.get("embed")
    if isinstance(embed, dict):
        value = embed.get("url")
        if isinstance(value, str) and value.strip():
            candidates.append(ExternalLink(url=value.strip(), text=""))

    content_json = attrs.get("content_json_string")
    if isinstance(content_json, str) and content_json:
        try:
            doc = json.loads(content_json)
        except ValueError:
            doc = None
        if doc is not None:
            _walk_prosemirror_nodes(doc, candidates)

    found: list[ExternalLink] = []
    seen: dict[str, int] = {}  # url → index in `found`
    for link in candidates:
        if not link.url or not _is_allowlisted_host(link.url):
            continue
        if link.url in seen:
            # Preserve the first non-empty text we saw for this URL.
            existing = found[seen[link.url]]
            if not existing.text and link.text:
                found[seen[link.url]] = ExternalLink(url=existing.url, text=link.text)
            continue
        seen[link.url] = len(found)
        found.append(link)
    return found


def _extract_tags(payload: dict) -> list[str]:
    """Pull user-defined tag values out of the JSON:API `included` array."""
    included = payload.get("included")
    if not isinstance(included, list):
        return []
    tags: list[str] = []
    for item in included:
        if not isinstance(item, dict) or item.get("type") != "post_tag":
            continue
        value = (item.get("attributes") or {}).get("value")
        if isinstance(value, str) and value.strip():
            tags.append(value.strip())
    # Stable order, deduped (preserve first occurrence)
    seen: set[str] = set()
    deduped: list[str] = []
    for t in tags:
        if t not in seen:
            seen.add(t)
            deduped.append(t)
    return deduped


def _extract_artist(payload: dict) -> str:
    """Extract the creator's full_name by following the post → user relationship."""
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return ""
    user_rel = ((data.get("relationships") or {}).get("user") or {}).get("data") or {}
    user_id = user_rel.get("id")
    if not user_id:
        return ""
    included = payload.get("included")
    if not isinstance(included, list):
        return ""
    for item in included:
        if isinstance(item, dict) and item.get("type") == "user" and item.get("id") == user_id:
            full_name = (item.get("attributes") or {}).get("full_name")
            if isinstance(full_name, str):
                return full_name.strip()
    return ""


def _cleanup_info_media(posts: list[FetchedPost]) -> None:
    """Delete cover/thumbnail media patreon-dl writes into `post_info/`.

    Gated on `include.content.info` which we can't disable without losing
    `post-api.json` (our metadata source). Keep-list approach: only
    `info.txt` and `post-api.json` survive. Called only when the user
    didn't opt into image content.
    """
    KEEP_FILENAMES = {"info.txt", "post-api.json"}

    for post in posts:
        if not post.post_dir:
            continue
        info_dir = Path(post.post_dir) / "post_info"
        if not info_dir.is_dir():
            continue
        for entry in info_dir.iterdir():
            if not entry.is_file():
                continue
            if entry.name in KEEP_FILENAMES:
                continue
            # Non-fatal — if unlink fails the file just stays on disk.
            with contextlib.suppress(OSError):
                entry.unlink()


def _find_first_audio(post_dir: Path) -> Path | None:
    audio_dir = post_dir / "audio"
    if audio_dir.is_dir():
        for entry in sorted(audio_dir.iterdir()):
            if entry.is_file() and entry.suffix.lower() in AUDIO_EXTS:
                return entry
    # Fallback: scan the whole post directory in case the layout changes
    for entry in sorted(post_dir.rglob("*")):
        if entry.is_file() and entry.suffix.lower() in AUDIO_EXTS:
            return entry
    return None


# ─── Flatten patreon-dl's nested output ──────────────────────────────────────
# patreon-dl writes `<patreon_root>/<campaign>/posts/<post_id>/<media_type>/
# <filename>`. After metadata parse we move audio out to the flattened
# `DOWNLOAD_PATH/<creator>/<post_id> - <title>/<filename>` (see
# `audio_utils.flatten_dest_parts`). patreon-dl's tree stays untouched so
# `stop.on = previouslyDownloaded` keeps working on re-fetches.


def _flatten_audio(
    posts: list[FetchedPost],
    patreon_root: Path,
) -> list[FetchedPost]:
    """Move each post's audio out of patreon-dl's tree into a per-creator,
    per-post folder under DOWNLOAD_PATH.

    Layout after flatten:
      DOWNLOAD_PATH/
        .patreon-dl/                                          ← patreon_root; untouched
          .patreon-dl/db.sqlite                               ← status DB; untouched
          Patreon/<creator>/posts/<post_id>/
            info/post-api.json                                ← sidecar; untouched
            audio/                                            ← now empty; rmdir'd
        <creator>/<post_id> - <title>/<original_filename>.ext ← moved audio (new)

    `patreon_root` is the directory we passed to `patreon-dl --out-dir`
    (`DOWNLOAD_PATH/.patreon-dl/`). The flat destination lives one level
    above it. Folder names go through `safe_filename_component` so any
    slashes / control chars / overlong UTF-8 in creator or title don't
    escape the destination root. `_rmdir_chain` removes the (now-empty)
    `audio/` subdirectory but stops at the first non-empty parent —
    `info/` keeps the post folder so the sidecar stays available for the
    cached-sidecar fast path on re-fetches.
    """
    library_path = patreon_root.parent
    for post in posts:
        if not post.audio_path:
            continue
        src = Path(post.audio_path)
        if not src.is_file():
            continue
        creator, folder_name = flatten_dest_parts(post.post_id, post.artist, post.title)
        dest_dir = library_path / creator / folder_name
        try:
            dest_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            continue
        # Preserve patreon-dl's original filename inside the per-post folder.
        target = unique_destination(dest_dir / src.name)
        try:
            shutil.move(str(src), str(target))
        except OSError:
            # Leave audio_path pointing at the original location if the move
            # fails (cross-device permissions, target busy, ...).
            continue
        post.audio_path = str(target)
        _rmdir_chain(src.parent, stop_at=patreon_root)
    return posts


def _rmdir_chain(start: Path, stop_at: Path) -> None:
    """rmdir `start`, then its parents, until non-empty or we hit `stop_at`.

    `stop_at` itself is never removed — it holds patreon-dl's status DB and
    our re-fetches depend on it surviving.
    """
    try:
        stop_resolved = stop_at.resolve()
    except OSError:
        return
    cur = start
    while True:
        try:
            cur_resolved = cur.resolve(strict=False)
        except OSError:
            return
        if cur_resolved == stop_resolved:
            return
        if stop_resolved not in cur_resolved.parents:
            return  # walked outside the safe boundary
        try:
            cur.rmdir()  # only succeeds when empty
        except OSError:
            return
        cur = cur.parent
