"""Wraps the `patreon-dl` CLI subprocess and parses its output.

The integration is intentionally a one-shot subprocess call:
no IPC, no sidecar service. patreon-dl writes media + raw API JSON to
disk, and this module reads back what it produced.
"""
import json
import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

PATREON_DL_BIN = os.environ.get("PATREON_DL_BIN", "patreon-dl")
# Hard cap so a runaway creator-wide download can't hang the API forever.
DEFAULT_TIMEOUT_SECONDS = 60 * 30

AUDIO_EXTS = {".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma"}

# patreon-dl's media-type vocabulary, as accepted by `content.media` and
# `posts.with.media.type`. We restrict to the subset that's meaningful here.
ALLOWED_CONTENT_TYPES = ("audio", "video", "image", "attachment")


class PatreonFetchError(RuntimeError):
    """Raised when patreon-dl fails or returns no usable content."""


@dataclass
class FetchedPost:
    post_id: str
    title: str
    tags: list[str]
    artist: str             # creator's full_name from the post's user relationship
    post_dir: str           # absolute path to the post directory
    audio_path: Optional[str]   # absolute path to the first audio file, if any


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
    metadata_only: bool = False
    # Which media types to download. Empty = patreon-dl default (everything);
    # we set ["audio"] as the wrapper default since this is an ASMR tool.
    # Ignored when `metadata_only` is True.
    content_types: list[str] = field(default_factory=lambda: ["audio"])
    # ISO yyyy-MM-dd strings. Only meaningful for creator URLs; patreon-dl
    # silently ignores them for single-post URLs.
    published_after: Optional[str] = None
    published_before: Optional[str] = None
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
    content_types: Optional[list[str]] = None,
    published_after: Optional[str] = None,
    published_before: Optional[str] = None,
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

    opts = PatreonFetchOptions(
        metadata_only=metadata_only,
        content_types=_clean_content_types(content_types),
        published_after=published_after,
        published_before=published_before,
        dry_run=dry_run,
    )
    config_path = _write_config(opts)

    # Track when this fetch starts so _collect_posts can filter out stale
    # sidecars from previous fetches. patreon-dl's use.status.cache means a
    # re-fetch of the same URL writes nothing new on disk for posts it's
    # already pulled — but the OLD post-api.json files still sit in the
    # output tree and we'd otherwise surface them as "results" for this run.
    # Tiny pre-roll on the threshold (-2 s) to absorb filesystem mtime
    # resolution differences between Linux and the bind-mounted host.
    fetch_started_at = time.time() - 2

    cmd = [
        PATREON_DL_BIN,
        "--target-url", url,
        "--cookie", cookie,
        "--out-dir", str(output_dir),
        "--no-prompt",
        "--log-level", "info",
        "--config-file", config_path,
    ]

    try:
        # Merge stderr into stdout — patreon-dl writes its info/warn lines to
        # stdout via console.log; we want both streams in one chronological tail.
        result = subprocess.run(
            cmd, text=True, timeout=timeout,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
    except subprocess.TimeoutExpired as e:
        raise PatreonFetchError(f"patreon-dl timed out after {timeout}s") from e
    finally:
        Path(config_path).unlink(missing_ok=True)

    log_tail = (result.stdout or "")[-2000:]
    if result.returncode != 0:
        raise PatreonFetchError(
            f"patreon-dl exited with code {result.returncode}. log tail: {log_tail}"
        )

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
        # <campaign>/posts/<id>/audio/ nesting into <AUDIO_ROOT>/<post_id>/.
        posts = _flatten_audio(posts, output_dir)

    return FetchResult(output_dir=str(output_dir), posts=posts, log_tail=log_tail)


def _clean_content_types(types: Optional[list[str]]) -> list[str]:
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
    # `stop.on` accepts a single value (not a CSV). It controls when the walk
    # terminates early — per-post dedup of already-downloaded items is handled
    # independently by patreon-dl's `use.status.cache` (default 1).
    #
    # Pick based on what's most useful:
    #   - date filter set → publishDateOutOfRange (bail once we leave the window)
    #   - otherwise → previouslyDownloaded (stop at the first cached post so
    #     re-fetches of the same creator URL terminate quickly)
    lines.append("[downloader]")
    if opts.published_after or opts.published_before:
        lines.append("stop.on = publishDateOutOfRange")
    else:
        lines.append("stop.on = previouslyDownloaded")
    if opts.dry_run:
        # Run the pipeline (resolve posts + media) without writing files.
        # Title / tags / artist still come back via the post-api.json sidecar.
        lines.append("dry.run = 1")

    # ── [include] section ───────────────────────────────────────────────────
    lines.append("[include]")
    if opts.metadata_only:
        # metadata_only wins over content_types — skip every media class.
        lines.append("content.media = 0")
        lines.append("preview.media = 0")
    elif opts.content_types:
        # Comma-separated for both keys: posts.with.media.type filters which
        # posts patreon-dl visits at all (skip image-only posts when audio-only);
        # content.media controls what media is actually downloaded from kept posts.
        csv = ", ".join(opts.content_types)
        lines.append(f"posts.with.media.type = {csv}")
        lines.append(f"content.media = {csv}")
        # media.thumbnails = 1 (default) generates a thumbnails/ subfolder used
        # by patreon-dl's own browse function — we don't use that here, so
        # turn it off unless the user explicitly opted into image content.
        # (Note: this is separate from the cover-image / post-thumbnail files
        # that land in post_info/. Those are gated by content.info which we
        # can't disable — they get pruned post-fetch by _cleanup_info_media.)
        if "image" not in opts.content_types:
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


def _collect_posts(
    output_dir: Path, since: Optional[float] = None,
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
        except (OSError, json.JSONDecodeError):
            continue
        parsed = _parse_post_api(data)
        if parsed is None:
            continue
        post_id, title, tags, artist = parsed
        audio_path = _find_first_audio(post_dir)
        posts.append(FetchedPost(
            post_id=post_id,
            title=title,
            tags=tags,
            artist=artist,
            post_dir=str(post_dir),
            audio_path=str(audio_path) if audio_path else None,
        ))
    posts.sort(key=lambda p: p.post_id)
    return posts


def _parse_post_api(payload: dict) -> Optional[tuple[str, str, list[str], str]]:
    """Extract (post_id, title, tags[], artist) from a Patreon JSON:API payload."""
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
    return post_id, title, tags, artist


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
        if (
            isinstance(item, dict)
            and item.get("type") == "user"
            and item.get("id") == user_id
        ):
            full_name = (item.get("attributes") or {}).get("full_name")
            if isinstance(full_name, str):
                return full_name.strip()
    return ""


def _cleanup_info_media(posts: list[FetchedPost]) -> None:
    """Delete cover/thumbnail media files patreon-dl writes into each post's
    `post_info/` subdir.

    patreon-dl gates these downloads on `include.content.info`, which we can't
    disable without losing `post-api.json` (the source we parse for title /
    tags / artist). So we clean them up after the fact. Called only when the
    user hasn't opted into image content via `content_types`.

    Strategy: whitelist what we *keep* — `info.txt` (post summary, harmless)
    and `post-api.json` (our metadata source). Everything else in `post_info/`
    is patreon-dl-generated media (cover-image.*, thumbnail.*,
    thumbnail-preview.*, and whatever future variants Patreon's CDN
    invents) which the user didn't opt into.
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
            try:
                entry.unlink()
            except OSError:
                pass  # non-fatal — leave it on disk


def _find_first_audio(post_dir: Path) -> Optional[Path]:
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
# patreon-dl always writes into `<patreon_root>/<campaign>/posts/<post_id>/
# <media_type>/<filename>` — the campaign/posts/post_id hierarchy is not
# escapable. After parsing the metadata we move each audio file OUT of
# patreon-dl's tree entirely and into `AUDIO_ROOT/<post_id>/<filename>` —
# a single per-post folder directly under the user's main browse root.
#
# patreon-dl's tree (post folder, info/post-api.json sidecar, per-campaign
# status cache, top-level db.sqlite) stays untouched. That preserves
# `stop.on = previouslyDownloaded` on re-fetches.


def _flatten_audio(
    posts: list[FetchedPost], patreon_root: Path,
) -> list[FetchedPost]:
    """Move each post's audio out of patreon-dl's tree into a per-post folder
    directly under AUDIO_ROOT.

    Layout after flatten:
      AUDIO_ROOT/
        .patreon-dl/                                 ← patreon_root; untouched
          .patreon-dl/db.sqlite                      ← status DB; untouched
          Patreon/<creator>/posts/<post_id>/
            info/post-api.json                       ← sidecar; untouched
            audio/                                   ← now empty; rmdir'd
        <post_id>/<original_filename>.ext            ← moved audio (new)

    `patreon_root` is the directory we passed to `patreon-dl --out-dir`
    (`AUDIO_ROOT/.patreon-dl/`). The flat destination lives one level above
    it. `_rmdir_chain` removes the (now-empty) `audio/` subdirectory but
    stops at the first non-empty parent — `info/` keeps the post folder.
    """
    audio_root = patreon_root.parent
    for post in posts:
        if not post.audio_path:
            continue
        src = Path(post.audio_path)
        if not src.is_file():
            continue
        dest_dir = audio_root / post.post_id
        try:
            dest_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            continue
        # Preserve patreon-dl's original filename inside the per-post folder.
        target = _unique_path(dest_dir / src.name)
        try:
            shutil.move(str(src), str(target))
        except OSError:
            # Leave audio_path pointing at the original location if the move
            # fails (cross-device permissions, target busy, ...).
            continue
        post.audio_path = str(target)
        _rmdir_chain(src.parent, stop_at=patreon_root)
    return posts


def _unique_path(target: Path) -> Path:
    """Return `target`, or `target` with `_2`/`_3`/... if it already exists."""
    if not target.exists():
        return target
    stem = target.stem
    suffix = target.suffix
    parent = target.parent
    n = 2
    while True:
        candidate = parent / f"{stem}_{n}{suffix}"
        if not candidate.exists():
            return candidate
        n += 1


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
