"""Tag vocabulary + suppressed-terms CRUD + bulk import/reset."""

from contextlib import contextmanager

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import database
from backend.main import require_non_empty

router = APIRouter()


@contextmanager
def _conflict_on_value_error():
    """`database.*` raises ValueError on unique-constraint / collision errors.
    Wrap the call site to rethrow as 409 Conflict so route handlers don't all
    repeat the same three-line try/except.
    """
    try:
        yield
    except ValueError as e:
        raise HTTPException(409, str(e))


# ── Full dict (load / import / reset) ───────────────────────────────────────


@router.get("/api/dictionary")
def get_dictionary():
    return database.get_full_dict()


class DictImport(BaseModel):
    vocabulary: list[dict]
    suppressed: list[dict]


@router.put("/api/dictionary")
def import_dictionary(body: DictImport):
    database.replace_full_dict({"vocabulary": body.vocabulary, "suppressed": body.suppressed})
    return database.get_full_dict()


@router.post("/api/dictionary/reset")
def reset_dictionary():
    database.reset_to_defaults()
    return database.get_full_dict()


# ── Vocabulary CRUD ─────────────────────────────────────────────────────────


class VocabIn(BaseModel):
    canonical: str
    aliases: list[str] = []


@router.get("/api/vocabulary")
def get_vocabulary():
    return database.get_vocabulary()


@router.post("/api/vocabulary", status_code=201)
def add_vocab(body: VocabIn):
    canonical = require_non_empty(body.canonical, "canonical")
    aliases = [a.strip().lower() for a in body.aliases if a.strip()]
    with _conflict_on_value_error():
        return database.add_vocab_entry(canonical, aliases)


@router.patch("/api/vocabulary/{entry_id}")
def edit_vocab(entry_id: int, body: VocabIn):
    canonical = require_non_empty(body.canonical, "canonical")
    aliases = [a.strip().lower() for a in body.aliases if a.strip()]
    with _conflict_on_value_error():
        row = database.edit_vocab_entry(entry_id, canonical, aliases)
    if not row:
        raise HTTPException(404, "vocabulary entry not found")
    return row


@router.delete("/api/vocabulary/{entry_id}")
def delete_vocab(entry_id: int):
    deleted = database.delete_vocab_entry(entry_id)
    if not deleted:
        raise HTTPException(404, "vocabulary entry not found")
    return {"deleted": entry_id}


# ── Suppressed terms CRUD ───────────────────────────────────────────────────


class SuppressIn(BaseModel):
    term: str


@router.get("/api/suppressed")
def get_suppressed():
    return database.get_suppressed()


@router.post("/api/suppressed", status_code=201)
def add_suppressed(body: SuppressIn):
    term = require_non_empty(body.term, "term").lower()
    with _conflict_on_value_error():
        return database.add_suppressed(term)


@router.delete("/api/suppressed/{term_id}")
def delete_suppressed(term_id: int):
    deleted = database.delete_suppressed(term_id)
    if not deleted:
        raise HTTPException(404, "suppressed term not found")
    return {"deleted": term_id}
