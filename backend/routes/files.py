"""File-browser endpoints: list, search, debug, mkdir, move (single + batch),
delete, rename (file-only + path-general)."""

import asyncio
import errno
import json
import os
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend import main as _main
from backend.main import (
    AUDIO_EXTS,
    METADATA_COMPATIBLE_EXTS,
    NEEDS_CONVERSION_EXTS,
    _clear_metadata,
    _read_metadata,
    _write_metadata,
    log,
    reject_if_exists,
    require_file,
    root_for,
    validate_under_library,
    validate_under_root,
)
from backend.patreon_fetch import _iter_cached_posts

# LIBRARY_PATH accessed via `_main.LIBRARY_PATH` (attribute lookup) rather
# than a top-level import binding so the test suite's monkeypatch on
# `backend.main.LIBRARY_PATH` reaches us.

router = APIRouter()


@router.get("/api/files")
def list_files(subdir: str = "", root: str = "library"):
    """List files and subdirectories inside `<root>/<subdir>` (one level).

    Uses `os.scandir` and caches `entry.is_file()` once per entry — under
    `Path.iterdir() + entry.is_file()` we'd issue ~4 stat syscalls per
    entry (sort key + ext check + type field + needs_conversion field),
    which is noticeable on bind-mounted / NAS filesystems with a few
    thousand entries per folder.
    """
    root_path = root_for(root)
    target = validate_under_root(subdir, root_path)
    if not target.exists():
        raise HTTPException(404, "Directory not found")
    if not target.is_dir():
        raise HTTPException(400, "Not a directory")

    # Snapshot (is_file, name, suffix) once per entry. DirEntry.is_file()
    # is cached internally by Python, but going through Path objects in
    # the sort key would re-stat each one.
    snapshot: list[tuple[bool, str, str]] = []
    with os.scandir(target) as it:
        for entry in it:
            is_file = entry.is_file()
            ext = Path(entry.name).suffix.lower() if is_file else ""
            snapshot.append((is_file, entry.name, ext))

    snapshot.sort(key=lambda row: (row[0], row[1].lower()))

    entries = [
        {
            "name": name,
            "type": "file" if is_file else "dir",
            "ext": ext if is_file else None,
            "path": str(target.relative_to(root_path) / name) if target != root_path else name,
            "needs_conversion": is_file and ext in NEEDS_CONVERSION_EXTS,
        }
        for is_file, name, ext in snapshot
    ]

    return {
        "current": str(target.relative_to(root_path)) if target != root_path else "",
        "root": root,
        "entries": entries,
    }


# Pruned during the audio-search walk: never contains user audio.
_SEARCH_PRUNE_DIRS = {".patreon-dl", ".git", "node_modules", "__pycache__", ".DS_Store"}

# Cap on returned matches. Without this the FileBrowser would balloon for
# huge libraries; truncate + flag so the UI can show "showing first N".
_SEARCH_RESULT_LIMIT = 500


@router.get("/api/files/search")
def search_files(
    q: str = "",
    search_in: str = "filename",
    root: str = "library",
    subdir: str = "",
):
    """Recursive walk returning audio/video files under the chosen root.

    `subdir` scopes the walk to a subtree so the explorer's "search the
    current folder" UX matches real file explorers — typing in the filter
    while inside `Solar Girl ASMR/` only searches that subtree.

    Filters apply during walk, prune set above strips dotfiles + cache
    dirs in place, result list is capped at _SEARCH_RESULT_LIMIT.
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

    # Same validator as everywhere else; `..` and absolute paths can't escape.
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
                d for d in dirnames if d not in _SEARCH_PRUNE_DIRS and not d.startswith(".")
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
                results.append(
                    {
                        "name": name,
                        "ext": ext,
                        "path": rel_path,
                        "folder": folder,
                        "needs_conversion": ext in NEEDS_CONVERSION_EXTS,
                    }
                )
                if len(results) >= _SEARCH_RESULT_LIMIT:
                    truncated = True
                    break
            if truncated:
                break
    except PermissionError as e:
        log.error("search PermissionError under %s: %s", root, e)
        raise HTTPException(500, "Permission error scanning files. Check the server log.")

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


@router.get("/api/files/debug")
def debug_files(root: str = "library"):
    """Show what's visible at the chosen root — diagnoses mount issues."""
    root_path = root_for(root).resolve()
    env_name = f"{root.upper()}_PATH"
    if not root_path.exists():
        return {
            "error": f"{env_name} does not exist: {root_path}",
            "root_path": str(root_path),
            "root": root,
        }

    top_level = []
    try:
        for entry in sorted(root_path.iterdir(), key=lambda e: e.name.lower())[:20]:
            top_level.append(
                {
                    "name": entry.name,
                    "type": "dir" if entry.is_dir() else "file",
                }
            )
    except Exception as e:
        return {"error": str(e), "root_path": str(root_path), "root": root}

    return {
        "root": root,
        "root_path": str(root_path),
        "exists": True,
        "top_level_entries": top_level,
        "top_level_count": len(top_level),
    }


# ── Cached Patreon metadata lookup (bulk-edit "Load from cache") ─────────────


# Patreon post IDs are numeric. The flattened ingest layout names each post
# folder `<post_id> - <title>`; the legacy layout was just `<post_id>`. The
# folder name is the only stable signal we have for tying a file back to its
# sidecar without re-parsing every cached `post-api.json` per path.
_POST_ID_FOLDER_RE = re.compile(r"^(\d+)(?: - .+)?$")


def _post_id_from_folder(name: str) -> str | None:
    match = _POST_ID_FOLDER_RE.match(name)
    return match.group(1) if match else None


class LoadCachedMetadataIn(BaseModel):
    paths: list[str]
    root: str = "downloads"


@router.post("/api/files/load-cached-metadata")
def load_cached_metadata(body: LoadCachedMetadataIn):
    """For each selected file, return cached Patreon title / artist / tags
    when the file lives under a post folder whose name carries a post_id.

    Sidecars live at `DOWNLOAD_PATH/.patreon-dl/.../post_info/post-api.json`
    regardless of where the audio ended up after `_flatten_audio` or a
    Move-to-library. The lookup is parent-folder-name driven, so files
    under `<creator>/<post_id> - <title>/` resolve in both DOWNLOAD_PATH
    and LIBRARY_PATH; files outside that naming pattern come back with no
    metadata fields (the bulk-edit UI surfaces this as "no cached info").

    The cache is walked once per request rather than per path — a 100-file
    selection is one `rglob`, not 100.
    """
    root_path = root_for(body.root)

    patreon_dir = _main.DOWNLOAD_PATH.resolve() / ".patreon-dl"
    cache: dict[str, object] = {}
    if patreon_dir.is_dir():
        for post, _, _ in _iter_cached_posts(patreon_dir):
            cache[post.post_id] = post

    items: list[dict] = []
    for rel in body.paths:
        try:
            target = validate_under_root(rel, root_path)
        except HTTPException:
            # Bad path in a bulk request doesn't fail the whole request —
            # surface as an empty entry so the UI can show the user that
            # this file has no cached info, same as a path that simply
            # doesn't match a post-folder name.
            items.append({"path": rel})
            continue
        post_id = _post_id_from_folder(target.parent.name)
        cached = cache.get(post_id) if post_id else None
        entry: dict = {"path": rel}
        if cached is not None:
            entry["title"] = cached.title
            entry["artist"] = cached.artist
            entry["tags"] = list(cached.tags)
        items.append(entry)

    return {"items": items}


# ── Current-metadata lookup (BulkEditSheet "Load current metadata") ──────────


class LoadCurrentMetadataIn(BaseModel):
    paths: list[str]
    root: str = "library"


@router.post("/api/files/load-current-metadata")
def load_current_metadata(body: LoadCurrentMetadataIn):
    """For each selected file, return the ID3 / FLAC / MP4 tags currently
    written to disk. Feeds the BulkEditSheet's auto-load on open: per-file
    Title fills from TIT2 (the frontend pipe-splits it back into title +
    tags for the in-app encoding), and shared Artist / Album /
    Album-artist fill from their respective frames when every selected
    file agrees on the value.

    Files outside `METADATA_COMPATIBLE_EXTS`, missing tag headers, or
    that fail to validate against `root` come back with empty fields —
    the bulk surface treats that as 'no metadata to load' rather than an
    error, so one stray file in a selection doesn't block the others.
    Files that don't exist on disk also fall through empty for the same
    reason.
    """
    root_path = root_for(body.root)
    items: list[dict] = []
    for rel in body.paths:
        entry: dict = {
            "path": rel,
            "title": "",
            "artist": "",
            "album": "",
            "album_artist": "",
        }
        try:
            target = validate_under_root(rel, root_path)
        except HTTPException:
            items.append(entry)
            continue
        if not target.exists() or not target.is_file():
            items.append(entry)
            continue
        if target.suffix.lower() not in METADATA_COMPATIBLE_EXTS:
            items.append(entry)
            continue
        try:
            tags = _read_metadata(target)
        except Exception as e:
            log.error("load-current-metadata failed on %s: %s", target.name, e)
            items.append(entry)
            continue
        entry.update(tags)
        items.append(entry)
    return {"items": items}


# ── Bulk write (BulkEditSheet "Preview changes → Commit") ────────────────────


_BULK_SHARED_FIELDS = ("artist", "album_artist", "album")


class BulkWriteItem(BaseModel):
    path: str
    # Per-file ID3 TIT2 / equivalent. Empty string = leave existing title
    # alone (matches _write_metadata's skip-on-empty behaviour).
    title: str = ""
    # Pre-composed canonical filename WITH extension. The frontend owns
    # the composition rules (brackets-in-filename, dash join, sanitize)
    # so they live in one place; the backend treats this as opaque and
    # only validates shape / length / collision.
    new_name: str = ""


class BulkWriteShared(BaseModel):
    artist: str = ""
    album_artist: str = ""
    album: str = ""
    # Subset of `_BULK_SHARED_FIELDS` — fields to BLANK on every item.
    # Distinct from the empty-string default, which means 'leave existing'.
    clear: list[str] = []


class BulkWriteIn(BaseModel):
    items: list[BulkWriteItem]
    shared: BulkWriteShared = BulkWriteShared()
    rename: bool = False
    root: str = "library"
    # Optional library-subdir destination. When set (only valid with
    # root=='downloads'), each item's post-rename file moves into
    # LIBRARY_PATH/<to_subdir>/ at the end of phase 2. Subsumes a
    # separate /api/move/batch round-trip the frontend would otherwise
    # have to chain. Empty string and null both mean "don't move".
    to_subdir: str | None = None


def _validate_bulk_rename_name(name: str) -> str | None:
    """Same rule set as `_validate_name`, but collects the error message
    instead of raising so phase 1 of bulk-write can surface every offending
    file in one response. Thin wrapper — the rules live in `_validate_name`.
    """
    try:
        _validate_name(name, max_bytes=255, term="Filename")
    except HTTPException as e:
        # `detail` is a str on every call site here (no dict variants).
        return str(e.detail)
    return None


@router.patch("/api/files/bulk-write")
def bulk_write(body: BulkWriteIn):
    """Apply bulk metadata + optional canonical rename + optional move
    across the selection in one transactional request.

    **Two-phase commit.** Phase 1 walks every item and validates path
    resolution, file existence, metadata-compatible extension, rename
    target shape + length + collision (both on-disk and against other
    items in the same batch), and — when `to_subdir` is set — the
    move-destination folder existence + per-item move collision. If ANY
    item fails, the whole batch aborts with 422 and disk state is
    untouched — the response includes per-item `ok: false` for both the
    actual offenders and the would-have-been-fine items so the UI can
    show the failed ones in context.

    Phase 2 applies each item independently — rename first (within the
    source parent), then write per-file title + shared fields
    (`_write_metadata` skips blank values) + any explicit clears
    (`_clear_metadata` drops the frame), then optionally move into
    `LIBRARY_PATH/to_subdir/`. A mutagen or OS error here is per-item
    `{ok: false, error}`; we don't try to unwind successfully-committed
    earlier items because filesystem rollback is unreliable.

    `to_subdir` is gated to `root=="downloads"` because the only
    intended use is the BulkEditSheet's Downloads → Library move
    workflow; library-to-library moves stay on /api/move so this
    endpoint doesn't grow a parallel set of source-validation paths.

    The frontend pre-composes `new_name` so the canonical-format rules
    (brackets-kept-in-filename, dash join, sanitize) stay in one place;
    the backend treats `new_name` as opaque and only enforces shape.
    """
    root_path = root_for(body.root)

    # Cap items so a runaway client can't make the two-phase commit walk an
    # unbounded list. 500 is well above realistic UI selections (the Bulk edit
    # toolbar button hides until ≥2 are selected; the FileBrowser itself caps
    # responses at the same order of magnitude).
    if len(body.items) > 500:
        raise HTTPException(413, "Too many items in one batch (max 500).")

    invalid_clear = [f for f in body.shared.clear if f not in _BULK_SHARED_FIELDS]
    if invalid_clear:
        raise HTTPException(
            400,
            f"clear[] contains unknown field(s): {sorted(invalid_clear)}. "
            f"Allowed: {list(_BULK_SHARED_FIELDS)}.",
        )

    # ── Optional move destination (downloads → library only) ─────────────────
    # Resolved up-front so phase 1 can per-item-check collisions at the
    # eventual landing spot. None means "don't move".
    move_dest_dir: Path | None = None
    if body.to_subdir is not None and body.to_subdir.strip() != "":
        if body.root != "downloads":
            raise HTTPException(
                400,
                "to_subdir is only valid when root is 'downloads' — moving WITHIN library "
                "uses /api/move directly.",
            )
        move_dest_dir = validate_under_library(body.to_subdir.strip())
        if not move_dest_dir.exists():
            raise HTTPException(404, "Destination folder does not exist.")
        if not move_dest_dir.is_dir():
            raise HTTPException(400, "Destination is not a folder.")

    # ── Phase 1: validate every item, no writes ──────────────────────────────
    planned: list[dict] = []
    errors: list[dict] = []
    proposed_dests: set[Path] = set()
    # Tracks the post-rename + post-move landing paths so two items in the
    # same batch can't both try to land at the same library/to_subdir/name.
    proposed_move_dests: set[Path] = set()

    for item in body.items:
        try:
            src = validate_under_root(item.path, root_path)
        except HTTPException as e:
            errors.append({"path": item.path, "ok": False, "error": str(e.detail)})
            continue
        if not src.exists():
            errors.append({"path": item.path, "ok": False, "error": "File not found."})
            continue
        if not src.is_file():
            errors.append({"path": item.path, "ok": False, "error": "Path is not a file."})
            continue
        if src.suffix.lower() not in METADATA_COMPATIBLE_EXTS:
            errors.append(
                {
                    "path": item.path,
                    "ok": False,
                    "error": (
                        f"Cannot tag {src.suffix} files — convert to a metadata-compatible "
                        "format first (MP3, FLAC, AAC, or OGG)."
                    ),
                },
            )
            continue

        dest: Path | None = None
        if body.rename and item.new_name and item.new_name.strip() != src.name:
            err = _validate_bulk_rename_name(item.new_name)
            if err is not None:
                errors.append({"path": item.path, "ok": False, "error": err})
                continue
            new_name_clean = item.new_name.strip()
            dest_rel = str(src.parent.relative_to(root_path.resolve()) / new_name_clean)
            try:
                dest_candidate = validate_under_root(dest_rel, root_path)
            except HTTPException as e:
                errors.append({"path": item.path, "ok": False, "error": str(e.detail)})
                continue
            if dest_candidate.exists():
                errors.append(
                    {"path": item.path, "ok": False, "error": "Target name already exists."},
                )
                continue
            if dest_candidate in proposed_dests:
                # Two items in the same batch picked the same new name.
                # Without this check phase 2 would race — the first wins,
                # the second fails with a collision — but the user sees
                # an order-dependent error. Catching here means both
                # affected items show in the validation response.
                errors.append(
                    {
                        "path": item.path,
                        "ok": False,
                        "error": "Another item in this batch targets the same new name.",
                    },
                )
                continue
            proposed_dests.add(dest_candidate)
            dest = dest_candidate

        # If a move is requested, work out the landing name (post-rename
        # when rename applies, otherwise the original) and check both
        # disk + within-batch collisions at the destination.
        if move_dest_dir is not None:
            final_name = dest.name if dest is not None else src.name
            move_target = move_dest_dir / final_name
            if move_target.exists():
                errors.append(
                    {
                        "path": item.path,
                        "ok": False,
                        "error": "A file with this name already exists at the destination folder.",
                    },
                )
                continue
            if move_target in proposed_move_dests:
                errors.append(
                    {
                        "path": item.path,
                        "ok": False,
                        "error": "Another item in this batch would land at the same destination.",
                    },
                )
                continue
            proposed_move_dests.add(move_target)

        planned.append({"item": item, "src": src, "dest": dest})

    if errors:
        # All-or-nothing on validation. Tag the not-actually-broken items
        # so the UI can dim them without highlighting them as offenders.
        aborted = [
            {
                "path": plan["item"].path,
                "ok": False,
                "error": "Aborted — other items failed validation.",
            }
            for plan in planned
        ]
        raise HTTPException(
            status_code=422,
            detail={"ok": False, "results": errors + aborted},
        )

    # ── Phase 2: apply each item, best-effort ────────────────────────────────
    results: list[dict] = []
    for plan in planned:
        item: BulkWriteItem = plan["item"]
        src: Path = plan["src"]
        dest: Path | None = plan["dest"]
        new_path_rel: str | None = None

        moved_to_library = False
        try:
            if dest is not None:
                src.rename(dest)
                target = dest
                new_path_rel = str(dest.relative_to(root_path.resolve()))
            else:
                target = src

            _write_metadata(
                target,
                item.title,
                body.shared.artist,
                body.shared.album,
                body.shared.album_artist,
            )

            # Clears come after sets so a same-batch "set artist AND clear
            # album_artist" runs as written. clear[] never overlaps with
            # the set fields because the UI uses one-or-the-other per
            # field, but order keeps the semantic crisp.
            if body.shared.clear:
                _clear_metadata(target, body.shared.clear)

            # Move step. Runs after metadata writes so the destination
            # file lands with the requested tags + filename in one
            # transactional unit. shutil.move (not Path.rename) so
            # cross-mount DOWNLOAD_PATH → LIBRARY_PATH works when the
            # two volumes differ.
            if move_dest_dir is not None:
                move_target = move_dest_dir / target.name
                shutil.move(str(target), str(move_target))
                new_path_rel = str(move_target.relative_to(_main.LIBRARY_PATH.resolve()))
                moved_to_library = True
        except OSError as e:
            log.error("bulk-write OSError on %s: %s", src.name, e)
            results.append(
                {
                    "path": item.path,
                    "ok": False,
                    "error": "Filesystem error. Check the server log.",
                },
            )
            continue
        except Exception as e:
            log.error("bulk-write tag-write error on %s: %s", src.name, e)
            results.append(
                {
                    "path": item.path,
                    "ok": False,
                    "error": "Tag write failed. Check the server log.",
                },
            )
            continue

        entry: dict = {"path": item.path, "ok": True}
        if new_path_rel is not None:
            entry["new_path"] = new_path_rel
        if moved_to_library:
            # Signal that `new_path` is relative to LIBRARY_PATH now,
            # not the request's `root`. Frontend uses this to refresh
            # the right tab + re-derive the Move-to picker's anchor.
            entry["new_root"] = "library"
        results.append(entry)

    return {"ok": True, "results": results}


# ── Folder creation + cross-root move ────────────────────────────────────────
# /api/mkdir creates a folder under LIBRARY_PATH (one validator for the
# inline picker AND the standalone "New folder" button). /api/move handles
# the cross-root file-or-folder move (shutil.move, not Path.rename, so
# cross-mount cases work — DOWNLOAD_PATH and LIBRARY_PATH often live on
# different volumes).


def _validate_name(name: str, *, max_bytes: int | None = None, term: str = "Name") -> str:
    """Reject names that would escape path validation or create dotfiles the
    FileBrowser hides. Shared between mkdir + the rename endpoints + the
    bulk-edit rename validator.

    Strips whitespace and rejects: empty, contains `/` or `\\`, equals
    `.` or `..`, starts with `.`. When `max_bytes` is set, also rejects
    names whose UTF-8 byte length exceeds the cap (Linux filesystem limit
    is 255; callers pass that when relevant).

    `term` controls user-facing wording — "Name" for folder/general,
    "Filename" for the rename endpoints. Source of truth for the same
    rules, instead of four near-identical inline ladders.
    """
    name = name.strip()
    if not name:
        raise HTTPException(400, f"{term} cannot be empty.")
    if "/" in name or "\\" in name:
        raise HTTPException(400, f"{term}s can't contain `/` or `\\`.")
    if name in (".", ".."):
        raise HTTPException(400, f"Invalid {term.lower()}.")
    if name.startswith("."):
        raise HTTPException(400, f"{term}s can't start with a dot.")
    if max_bytes is not None:
        name_bytes = len(name.encode("utf-8"))
        if name_bytes > max_bytes:
            raise HTTPException(422, f"{term} too long: {name_bytes} bytes (max {max_bytes}).")
    return name


class MkdirIn(BaseModel):
    subdir: str
    parent: str | None = None


@router.post("/api/mkdir", status_code=201)
def make_directory(body: MkdirIn):
    """Create a single subfolder under `LIBRARY_PATH/<parent>/`. Scoped to
    LIBRARY_PATH only — DOWNLOAD_PATH is transient staging the user doesn't
    curate. 409 on collision matches the rename + Patreon-fetch idiom."""
    subdir = _validate_name(body.subdir)
    parent_rel = (body.parent or "").strip()
    target_rel = f"{parent_rel}/{subdir}" if parent_rel else subdir
    target = validate_under_library(target_rel)
    if target.exists():
        raise HTTPException(409, "That name already exists.")
    try:
        target.mkdir(parents=True, exist_ok=False)
    except OSError as e:
        log.error("mkdir failed for %s: %s", target.name, e)
        raise HTTPException(500, "Couldn't create folder. Check the server log.")
    return {
        "created": True,
        "path": str(target.relative_to(_main.LIBRARY_PATH.resolve())),
        "name": target.name,
    }


class MetadataIn(BaseModel):
    """Tag fields embedded after a rename or rename-during-move. Shared by
    /api/rename and /api/move so a move-with-new-name can also write
    user-supplied tags in one round-trip."""

    title: str = ""
    artist: str = ""
    album: str = ""
    album_artist: str = ""


class MoveIn(BaseModel):
    from_path: str
    from_root: str
    to_subdir: str
    new_name: str | None = None
    metadata: MetadataIn | None = None


def _plan_move(
    from_path: str,
    from_root: str,
    to_subdir: str,
    new_name: str | None,
) -> tuple[Path, Path]:
    """Validate a single move and return `(src, dest)` absolute paths.

    Centralises the rules shared by /api/move and /api/move/batch:
    existence, cycle protection (no folder into itself), destination-folder
    existence, filename shape + 255-byte cap, collision rejection. Raises
    HTTPException; the batch caller converts each into a per-item error.
    """
    src_root = root_for(from_root)
    src = validate_under_root(from_path, src_root)
    require_file(src)  # misnamed but applies to dirs too

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

    final_name = _validate_name(new_name or src.name, max_bytes=255)

    dest_rel = (
        f"{dest_dir.relative_to(_main.LIBRARY_PATH.resolve())}/{final_name}"
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


@router.post("/api/move")
def move_file(body: MoveIn):
    """Move a file or folder into `LIBRARY_PATH/<to_subdir>/`, optionally
    renaming during the move. When the destination is a metadata-compatible
    audio file and `body.metadata` is set, tags are written after the move
    — same behaviour as /api/rename's optional embed.
    """
    src, dest = _plan_move(body.from_path, body.from_root, body.to_subdir, body.new_name)
    try:
        shutil.move(str(src), str(dest))
    except OSError as e:
        log.error("move failed (%s -> %s): %s", src.name, dest.name, e)
        raise HTTPException(500, "Move failed. Check the server log.")

    # Optional metadata embed. Folder moves and non-tag-compatible files
    # skip silently. Failures here surface as a partial-success warning,
    # never a failed move (the file is on disk where the user asked).
    metadata_error: str | None = None
    if (
        body.metadata
        and dest.is_file()
        and dest.suffix.lower() in METADATA_COMPATIBLE_EXTS
        and any(
            [
                body.metadata.title,
                body.metadata.artist,
                body.metadata.album,
                body.metadata.album_artist,
            ]
        )
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
        "to_path": str(dest.relative_to(_main.LIBRARY_PATH.resolve())),
        "new_name": dest.name,
        **({"metadata_error": metadata_error} if metadata_error else {}),
    }


class MoveBatchItem(BaseModel):
    from_path: str
    new_name: str | None = None


class MoveBatchIn(BaseModel):
    items: list[MoveBatchItem]
    from_root: str
    to_subdir: str


def _map_move_error_code(exc: HTTPException) -> str:
    """Map a `_plan_move` HTTPException to a stable error.code string the
    client branches on. Decoupled from user-facing detail so copy tweaks
    don't change the code contract."""
    if exc.status_code == 409:
        return "collision"
    if exc.status_code == 404:
        return "not_found"
    if exc.status_code == 400 and "itself" in str(exc.detail):
        return "cycle"
    if exc.status_code in (400, 422):
        return "validation"
    return "other"


@router.post("/api/move/batch")
async def move_batch(body: MoveBatchIn):
    """Move many items into a single LIBRARY_PATH destination, streamed as
    SSE so the client can show per-item progress on long cross-mount
    batches. Each `shutil.move` runs in `asyncio.to_thread`. Any single
    item's failure surfaces as `{ok: false, error}` and the loop
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
                # Off-loop so a multi-gigabyte cross-mount copy doesn't
                # stall the SSE generator.
                await asyncio.to_thread(shutil.move, str(src), str(dest))
                entry = {
                    "from_path": item.from_path,
                    "ok": True,
                    "to_path": str(dest.relative_to(_main.LIBRARY_PATH.resolve())),
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
                log.error("batch-move failed for %s: %s", item.from_path, e)
                entry = {
                    "from_path": item.from_path,
                    "ok": False,
                    "error": {
                        "code": "other",
                        "message": "Move failed. Check the server log.",
                    },
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
    path: str
    root: str = "library"
    # Non-recursive by default: empty folders succeed, non-empty return 409
    # with the contents count so the UI can prompt before recursing. Files
    # ignore this flag (delete is always a single-target unlink).
    recursive: bool = False


@router.post("/api/delete")
def delete_path(body: DeleteIn):
    """Delete a file or folder under the chosen root.

    file → unlink; empty dir → rmdir; non-empty dir + recursive=True →
    shutil.rmtree; non-empty dir + recursive=False → 409 with contents
    count for a UI re-prompt. Refuses to delete the root itself.
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
            log.error("unlink failed for %s: %s", target.name, e)
            raise HTTPException(500, "Delete failed. Check the server log.")
        return {"deleted": True, "kind": "file", "path": rel}

    if not target.is_dir():
        raise HTTPException(400, "Path is neither a file nor a folder.")

    # Empty-folder fast path — rmdir succeeds only when the dir has no
    # children, which is exactly what we want.
    try:
        target.rmdir()
        return {"deleted": True, "kind": "folder_empty", "path": rel}
    except OSError:
        pass  # non-empty; fall through

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
        log.error("rmtree failed for %s: %s", target.name, e)
        raise HTTPException(500, "Recursive delete failed. Check the server log.")
    return {"deleted": True, "kind": "folder_recursive", "path": rel}


def _handle_rename_error(
    e: OSError, src_name: str, dest_name: str, *, too_long_message: str
) -> HTTPException:
    """Translate an OSError from `Path.rename()` into the right HTTPException.

    Two rename endpoints (`/api/rename` for file-only + metadata embed,
    `/api/rename-path` for file-or-folder) share the same error shape:
    ENAMETOOLONG is a user-actionable 422; anything else logs the OS
    detail server-side and returns a sanitised 500. Caller raises the
    returned exception so stack traces stay shallow.
    """
    if e.errno == errno.ENAMETOOLONG:
        return HTTPException(422, too_long_message)
    log.error("rename failed (%s -> %s): %s", src_name, dest_name, e)
    return HTTPException(500, "Rename failed. Check the server log.")


class RenamePathIn(BaseModel):
    path: str
    new_name: str
    root: str = "library"


@router.post("/api/rename-path")
def rename_path(body: RenamePathIn):
    """Rename a file or folder in place (same parent directory).

    Different from `/api/rename`: that endpoint is file-only and combines
    the rename with an optional ID3/FLAC/MP4 metadata embed. This one
    handles the general case — any file or any folder, no metadata embed.
    Library explorer's right-click Rename + F2 drive this.
    """
    root_path = root_for(body.root)
    rel = (body.path or "").strip().strip("/")
    if not rel or rel in (".", ".."):
        raise HTTPException(400, "Refusing to rename the root directory.")

    src = validate_under_root(rel, root_path)
    if not src.exists():
        raise HTTPException(404, "Path does not exist.")

    new_name = _validate_name(body.new_name, max_bytes=255)

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
    dest_rel = f"{parent_rel}/{new_name}" if str(parent_rel) not in ("", ".") else new_name
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
        raise _handle_rename_error(
            e, src.name, dest.name, too_long_message="Name too long for the filesystem."
        )

    return {
        "renamed": True,
        "old_name": src.name,
        "new_name": dest.name,
        "path": str(dest.relative_to(root_path.resolve())),
        "root": body.root,
        "kind": "folder" if dest.is_dir() else "file",
    }


class RenameIn(BaseModel):
    path: str
    new_name: str
    root: str = "library"
    metadata: MetadataIn | None = None


@router.post("/api/rename")
def rename_file(body: RenameIn):
    root_path = root_for(body.root)
    src = validate_under_root(body.path, root_path)
    require_file(src)
    if not src.is_file():
        raise HTTPException(400, "Path is not a file")

    if src.suffix.lower() not in METADATA_COMPATIBLE_EXTS:
        raise HTTPException(
            422,
            f"Cannot rename {src.suffix} files — convert to a metadata-compatible format first (MP3, FLAC, AAC, or OGG)",
        )

    # Shared name-rule validator: same empty / slash / dotfile / 255-byte
    # checks the bulk-write phase-1 collector and mkdir use.
    new_name = _validate_name(body.new_name, max_bytes=255, term="Filename")

    dest = validate_under_root(str(src.parent.relative_to(root_path) / new_name), root_path)
    reject_if_exists(dest)

    try:
        src.rename(dest)
    except OSError as e:
        raise _handle_rename_error(
            e,
            src.name,
            dest.name,
            too_long_message=f"Filename too long ({len(new_name)} chars). Remove some tags to shorten it.",
        )

    metadata_error: str | None = None
    if body.metadata and any(
        [
            body.metadata.title,
            body.metadata.artist,
            body.metadata.album,
            body.metadata.album_artist,
        ]
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
        "renamed": True,
        "old_name": src.name,
        "new_name": dest.name,
        "path": str(dest.relative_to(root_path)),
        "root": body.root,
        **({"metadata_error": metadata_error} if metadata_error else {}),
    }
