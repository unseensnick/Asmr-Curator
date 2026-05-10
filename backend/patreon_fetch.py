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
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

PATREON_DL_BIN = os.environ.get("PATREON_DL_BIN", "patreon-dl")
# Hard cap so a runaway creator-wide download can't hang the API forever.
DEFAULT_TIMEOUT_SECONDS = 60 * 30

AUDIO_EXTS = {".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma"}


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


def fetch(
    url: str,
    cookie: str,
    output_dir: Path,
    metadata_only: bool = False,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> FetchResult:
    """Download `url` with patreon-dl into `output_dir` and return parsed metadata.

    When `metadata_only` is True, patreon-dl is told (via a temporary config file)
    to skip media downloads — it still writes the post's API JSON sidecar, which
    is all we need to populate the title/tags UI. Useful when the user already
    has the audio file locally and just wants the post's metadata.
    """
    if not shutil.which(PATREON_DL_BIN):
        raise PatreonFetchError(
            f"patreon-dl binary not found on PATH (looked for '{PATREON_DL_BIN}'). "
            "Install it in the container or set PATREON_DL_BIN."
        )

    output_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        PATREON_DL_BIN,
        "--target-url", url,
        "--cookie", cookie,
        "--out-dir", str(output_dir),
        "--no-prompt",
        "--log-level", "info",
    ]

    config_path: Optional[str] = None
    if metadata_only:
        config_path = _write_metadata_only_config()
        cmd.extend(["--config-file", config_path])

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
        if config_path:
            Path(config_path).unlink(missing_ok=True)

    log_tail = (result.stdout or "")[-2000:]
    if result.returncode != 0:
        raise PatreonFetchError(
            f"patreon-dl exited with code {result.returncode}. log tail: {log_tail}"
        )

    posts = _collect_posts(output_dir)
    return FetchResult(output_dir=str(output_dir), posts=posts, log_tail=log_tail)


def _write_metadata_only_config() -> str:
    """Write a tiny config file that disables media downloads. Caller must unlink it."""
    body = (
        "[include]\n"
        "content.media = 0\n"
        "preview.media = 0\n"
    )
    fd, path = tempfile.mkstemp(prefix="patreon-dl-metaonly-", suffix=".conf", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
    except Exception:
        Path(path).unlink(missing_ok=True)
        raise
    return path


def _collect_posts(output_dir: Path) -> list[FetchedPost]:
    """Walk patreon-dl's output and pull title/tags/audio out of each post-api.json."""
    posts: list[FetchedPost] = []
    for api_file in output_dir.rglob("post-api.json"):
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
