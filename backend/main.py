from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
from backend import database

app = FastAPI(title="ASMR Filename Generator API")

# Resolve frontend path relative to this file so it works in any working dir
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# ── Serve frontend ────────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

@app.get("/")
def root():
    return FileResponse(str(FRONTEND_DIR / "index.html"))

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok"}

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
    phrase = body.phrase.strip().lower()
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
    to_word: Optional[str] = None  # None means suppress

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

# ── Bulk import ───────────────────────────────────────────────────────────────
class DictImport(BaseModel):
    pills: list[str]
    synonyms: dict[str, Optional[str]]
    variants: dict[str, str]
    splitFixes: list[list[str]]

@app.put("/api/dictionary")
def import_dictionary(body: DictImport):
    database.replace_full_dict(body.model_dump())
    return database.get_full_dict()

# ── Reset to defaults ─────────────────────────────────────────────────────────
@app.post("/api/dictionary/reset")
def reset_dictionary():
    database.reset_to_defaults()
    return database.get_full_dict()
