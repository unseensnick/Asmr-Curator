"""File-browser endpoints: list, search, debug, mkdir, move (single + batch),
delete, rename (file-only + path-general)."""

import asyncio
import json
import os
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
    _write_metadata,
    log,
    reject_if_exists,
    require_file,
    root_for,
    validate_under_library,
    validate_under_root,
)

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


# ── Folder creation + cross-root move ────────────────────────────────────────
# /api/mkdir creates a folder under LIBRARY_PATH (one validator for the
# inline picker AND the standalone "New folder" button). /api/move handles
# the cross-root file-or-folder move (shutil.move, not Path.rename, so
# cross-mount cases work — DOWNLOAD_PATH and LIBRARY_PATH often live on
# different volumes).


def _validate_folder_name(name: str) -> str:
    """Reject names that would escape the validator or create dotfiles the
    FileBrowser hides."""
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
    subdir: str
    parent: str | None = None


@router.post("/api/mkdir", status_code=201)
def make_directory(body: MkdirIn):
    """Create a single subfolder under `LIBRARY_PATH/<parent>/`. Scoped to
    LIBRARY_PATH only — DOWNLOAD_PATH is transient staging the user doesn't
    curate. 409 on collision matches the rename + Patreon-fetch idiom."""
    subdir = _validate_folder_name(body.subdir)
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
        if e.errno == 36:  # ENAMETOOLONG
            raise HTTPException(422, "Name too long for the filesystem.")
        log.error("rename-path failed (%s -> %s): %s", src.name, dest.name, e)
        raise HTTPException(500, "Rename failed. Check the server log.")

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

    new_name = body.new_name.strip()
    if not new_name or "/" in new_name or "\\" in new_name:
        raise HTTPException(400, "Invalid filename")

    dest = validate_under_root(str(src.parent.relative_to(root_path) / new_name), root_path)
    reject_if_exists(dest)

    # Linux max filename length is 255 bytes (not chars — encode to check).
    name_bytes = len(new_name.encode("utf-8"))
    if name_bytes > 255:
        raise HTTPException(
            422, f"Filename too long: {name_bytes} bytes (max 255). Remove some tags to shorten it."
        )

    try:
        src.rename(dest)
    except OSError as e:
        if e.errno == 36:  # ENAMETOOLONG
            raise HTTPException(
                422, f"Filename too long ({len(new_name)} chars). Remove some tags to shorten it."
            )
        log.error("rename failed (%s -> %s): %s", src.name, dest.name, e)
        raise HTTPException(500, "Rename failed. Check the server log.")

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
