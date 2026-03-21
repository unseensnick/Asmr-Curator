from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
import os
from backend import database

app = FastAPI(title="ASMR Filename Generator API")

# Resolve frontend path relative to this file so it works in any working dir
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# Root for audio files — set via AUDIO_ROOT env var
AUDIO_ROOT = Path(os.environ.get("AUDIO_ROOT", "/mnt/audio"))

# ── Serve frontend ────────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

@app.get("/")
def root():
    return FileResponse(str(FRONTEND_DIR / "index.html"))

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok"}

# ── File browser ──────────────────────────────────────────────────────────────
AUDIO_EXTS = {".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma",
              ".mp4", ".mov", ".avi", ".mkv", ".webm"}

@app.get("/api/files")
def list_files(subdir: str = ""):
    """List files and subdirectories inside AUDIO_ROOT/subdir (one level)."""
    target = (AUDIO_ROOT / subdir).resolve()
    audio_root_str = str(AUDIO_ROOT.resolve())

    if not str(target).startswith(audio_root_str):
        raise HTTPException(403, "Access denied")
    if not target.exists():
        raise HTTPException(404, "Directory not found")
    if not target.is_dir():
        raise HTTPException(400, "Not a directory")

    entries = []
    for entry in sorted(target.iterdir(), key=lambda e: (e.is_file(), e.name.lower())):
        entries.append({
            "name": entry.name,
            "type": "file" if entry.is_file() else "dir",
            "ext": entry.suffix.lower() if entry.is_file() else None,
            "path": str(entry.relative_to(AUDIO_ROOT)),
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
            results.append({
                "name": entry.name,
                "ext": entry.suffix.lower(),
                "path": str(rel),
                "folder": folder,
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
class RenameIn(BaseModel):
    path: str       # relative path to file inside AUDIO_ROOT
    new_name: str   # new filename (just the name, no path)

@app.post("/api/rename")
def rename_file(body: RenameIn):
    src = (AUDIO_ROOT / body.path.strip()).resolve()
    audio_root_str = str(AUDIO_ROOT.resolve())

    # Security: must stay inside AUDIO_ROOT
    if not str(src).startswith(audio_root_str):
        raise HTTPException(403, "Access denied")
    if not src.exists():
        raise HTTPException(404, f"File not found: {body.path}")
    if not src.is_file():
        raise HTTPException(400, "Path is not a file")

    new_name = body.new_name.strip()
    if not new_name or "/" in new_name or "\\" in new_name:
        raise HTTPException(400, "Invalid filename")

    dest = src.parent / new_name

    # Check dest is still inside AUDIO_ROOT
    if not str(dest.resolve()).startswith(audio_root_str):
        raise HTTPException(403, "Access denied")

    if dest.exists():
        raise HTTPException(409, f"A file named '{new_name}' already exists")

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

    return {
        "renamed": True,
        "old_name": src.name,
        "new_name": dest.name,
        "path": str(dest.relative_to(AUDIO_ROOT)),
    }

# ── Dictionary: full load ─────────────────────────────────────────────────────
@app.get("/api/dictionary")
def get_dictionary():
    return database.get_full_dict()

# ── Pills ─────────────────────────────────────────────────────────────────────
class PillIn(BaseModel):
    phrase: str

@app.get("/api/pills")
def get_pills():
    return database.get_pills()

@app.post("/api/pills", status_code=201)
def add_pill(body: PillIn):
    phrase = body.phrase.strip()  # preserve casing — stored as-is
    if not phrase:
        raise HTTPException(400, "phrase cannot be empty")
    try:
        return database.add_pill(phrase)
    except ValueError as e:
        raise HTTPException(409, str(e))

@app.delete("/api/pills/{pill_id}")
def delete_pill(pill_id: int):
    deleted = database.delete_pill(pill_id)
    if not deleted:
        raise HTTPException(404, "pill not found")
    return {"deleted": pill_id}

# ── Synonyms ──────────────────────────────────────────────────────────────────
class SynonymIn(BaseModel):
    from_word: str
    to_word: Optional[str] = None

@app.get("/api/synonyms")
def get_synonyms():
    return database.get_synonyms()

@app.post("/api/synonyms", status_code=201)
def add_synonym(body: SynonymIn):
    from_word = body.from_word.strip().lower()
    if not from_word:
        raise HTTPException(400, "from_word cannot be empty")
    try:
        return database.add_synonym(from_word, body.to_word)
    except ValueError as e:
        raise HTTPException(409, str(e))

@app.delete("/api/synonyms/{synonym_id}")
def delete_synonym(synonym_id: int):
    deleted = database.delete_synonym(synonym_id)
    if not deleted:
        raise HTTPException(404, "synonym not found")
    return {"deleted": synonym_id}

# ── Variants ──────────────────────────────────────────────────────────────────
class VariantIn(BaseModel):
    from_str: str
    to_str: str

@app.get("/api/variants")
def get_variants():
    return database.get_variants()

@app.post("/api/variants", status_code=201)
def add_variant(body: VariantIn):
    from_str = body.from_str.strip().lower()
    to_str = body.to_str.strip()
    if not from_str or not to_str:
        raise HTTPException(400, "from_str and to_str are required")
    try:
        return database.add_variant(from_str, to_str)
    except ValueError as e:
        raise HTTPException(409, str(e))

@app.delete("/api/variants/{variant_id}")
def delete_variant(variant_id: int):
    deleted = database.delete_variant(variant_id)
    if not deleted:
        raise HTTPException(404, "variant not found")
    return {"deleted": variant_id}

# ── Split Fixes ───────────────────────────────────────────────────────────────
class SplitFixIn(BaseModel):
    pattern: str
    replacement: str

@app.get("/api/splitfixes")
def get_splitfixes():
    return database.get_splitfixes()

@app.post("/api/splitfixes", status_code=201)
def add_splitfix(body: SplitFixIn):
    pattern = body.pattern.strip()
    replacement = body.replacement.strip()
    if not pattern or not replacement:
        raise HTTPException(400, "pattern and replacement are required")
    return database.add_splitfix(pattern, replacement)

@app.delete("/api/splitfixes/{fix_id}")
def delete_splitfix(fix_id: int):
    deleted = database.delete_splitfix(fix_id)
    if not deleted:
        raise HTTPException(404, "splitfix not found")
    return {"deleted": fix_id}

# ── Edit (PATCH) ─────────────────────────────────────────────────────────────
class PillEdit(BaseModel):
    phrase: str

@app.patch("/api/pills/{pill_id}")
def edit_pill(pill_id: int, body: PillEdit):
    phrase = body.phrase.strip()
    if not phrase:
        raise HTTPException(400, "phrase cannot be empty")
    try:
        row = database.edit_pill(pill_id, phrase)
    except ValueError as e:
        raise HTTPException(409, str(e))
    if not row:
        raise HTTPException(404, "pill not found")
    return row


class SynonymEdit(BaseModel):
    from_word: str
    to_word: Optional[str] = None

@app.patch("/api/synonyms/{synonym_id}")
def edit_synonym(synonym_id: int, body: SynonymEdit):
    from_word = body.from_word.strip().lower()
    if not from_word:
        raise HTTPException(400, "from_word cannot be empty")
    try:
        row = database.edit_synonym(synonym_id, from_word, body.to_word)
    except ValueError as e:
        raise HTTPException(409, str(e))
    if not row:
        raise HTTPException(404, "synonym not found")
    return row


class VariantEdit(BaseModel):
    from_str: str
    to_str: str

@app.patch("/api/variants/{variant_id}")
def edit_variant(variant_id: int, body: VariantEdit):
    from_str = body.from_str.strip().lower()
    to_str = body.to_str.strip()
    if not from_str or not to_str:
        raise HTTPException(400, "from_str and to_str are required")
    try:
        row = database.edit_variant(variant_id, from_str, to_str)
    except ValueError as e:
        raise HTTPException(409, str(e))
    if not row:
        raise HTTPException(404, "variant not found")
    return row


class SplitFixEdit(BaseModel):
    pattern: str
    replacement: str

@app.patch("/api/splitfixes/{fix_id}")
def edit_splitfix(fix_id: int, body: SplitFixEdit):
    pattern = body.pattern.strip()
    replacement = body.replacement.strip()
    if not pattern or not replacement:
        raise HTTPException(400, "pattern and replacement are required")
    row = database.edit_splitfix(fix_id, pattern, replacement)
    if not row:
        raise HTTPException(404, "splitfix not found")
    return row


# ── Bulk import ───────────────────────────────────────────────────────────────
class DictImport(BaseModel):
    pills: list[str]
    synonyms: dict[str, Optional[str]]
    variants: dict[str, str]
    splitFixes: list[list[str]]

@app.put("/api/dictionary")
def import_dictionary(body: DictImport):
    # Pydantic v2 model_dump() converts camelCase -> snake_case, breaking "splitFixes".
    # Build the dict manually to preserve the camelCase key that replace_full_dict expects.
    raw = {
        "pills": body.pills,
        "synonyms": body.synonyms,
        "variants": body.variants,
        "splitFixes": body.splitFixes,
    }
    database.replace_full_dict(raw)
    return database.get_full_dict()

# ── Reset to defaults ─────────────────────────────────────────────────────────
@app.post("/api/dictionary/reset")
def reset_dictionary():
    database.reset_to_defaults()
    return database.get_full_dict()