"""Tests for /api/dictionary, /api/vocabulary, /api/suppressed — the
tag-dictionary CRUD endpoints in routes/dictionary.py.

The pure database helpers in test_database.py cover the SQLite side; this
file covers the route layer: request parsing (Pydantic), success-response
shapes, and error mapping (HTTPException status + bodies). Mirrors
test_file_ops.py's TestClient + temp-resource pattern, but swapping
DOWNLOAD_PATH/LIBRARY_PATH monkeypatches for DB_PATH.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch, tmp_path: Path):
    """Fresh seeded SQLite DB per test, wired into the FastAPI app via
    TestClient. Each test starts from the same default-vocabulary
    baseline that init_db() produces on first connect."""
    from backend import database, main

    db_path = tmp_path / "dictionary.db"
    monkeypatch.setattr(database, "DB_PATH", str(db_path))
    database.init_db()
    database.migrate_db()  # seeds DEFAULT_VOCABULARY + DEFAULT_SUPPRESSED
    return TestClient(main.app)


# ── Full dict ──────────────────────────────────────────────────────────────


class TestFullDict:
    def test_get_returns_seeded_vocabulary_and_suppressed(self, client):
        r = client.get("/api/dictionary")
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body["vocabulary"], list)
        assert isinstance(body["suppressed"], list)
        # init_db() seeds defaults — at least one entry of each kind.
        assert len(body["vocabulary"]) > 0
        assert len(body["suppressed"]) > 0

    def test_put_replaces_entire_dict(self, client):
        r = client.put(
            "/api/dictionary",
            json={
                "vocabulary": [{"canonical": "Only Tag", "aliases": ["alias-one"]}],
                "suppressed": [{"term": "only-suppressed"}],
            },
        )
        assert r.status_code == 200
        body = r.json()
        canonicals = [v["canonical"] for v in body["vocabulary"]]
        terms = [s["term"] for s in body["suppressed"]]
        assert canonicals == ["Only Tag"]
        assert terms == ["only-suppressed"]

    def test_reset_restores_defaults(self, client):
        client.put("/api/dictionary", json={"vocabulary": [], "suppressed": []})
        r = client.post("/api/dictionary/reset")
        assert r.status_code == 200
        body = r.json()
        assert len(body["vocabulary"]) > 0
        assert len(body["suppressed"]) > 0


# ── Vocabulary CRUD ─────────────────────────────────────────────────────────


class TestVocabularyCrud:
    def test_get_lists_all_entries(self, client):
        r = client.get("/api/vocabulary")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_post_creates_entry(self, client):
        r = client.post(
            "/api/vocabulary",
            json={"canonical": "Brand New Tag", "aliases": ["bnt", "brand-new"]},
        )
        assert r.status_code == 201
        body = r.json()
        assert body["canonical"] == "Brand New Tag"
        # add_vocab_entry lowercases + dedupes aliases; both belong.
        assert set(body["aliases"]) == {"bnt", "brand-new"}

    def test_post_rejects_empty_canonical(self, client):
        r = client.post("/api/vocabulary", json={"canonical": "   ", "aliases": []})
        assert r.status_code == 400

    def test_post_rejects_duplicate_canonical(self, client):
        client.post("/api/vocabulary", json={"canonical": "Dup", "aliases": []})
        r = client.post("/api/vocabulary", json={"canonical": "Dup", "aliases": []})
        assert r.status_code == 409

    def test_patch_edits_entry(self, client):
        created = client.post(
            "/api/vocabulary", json={"canonical": "Original", "aliases": []}
        ).json()
        r = client.patch(
            f"/api/vocabulary/{created['id']}",
            json={"canonical": "Renamed", "aliases": ["was-original"]},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["canonical"] == "Renamed"
        assert body["aliases"] == ["was-original"]

    def test_patch_returns_404_for_missing_id(self, client):
        r = client.patch(
            "/api/vocabulary/999999",
            json={"canonical": "Nope", "aliases": []},
        )
        assert r.status_code == 404

    def test_delete_removes_entry(self, client):
        created = client.post(
            "/api/vocabulary", json={"canonical": "DeleteMe", "aliases": []}
        ).json()
        r = client.delete(f"/api/vocabulary/{created['id']}")
        assert r.status_code == 200
        assert r.json() == {"deleted": created["id"]}

    def test_delete_returns_404_for_missing_id(self, client):
        r = client.delete("/api/vocabulary/999999")
        assert r.status_code == 404


# ── Suppressed terms CRUD ───────────────────────────────────────────────────


class TestSuppressedCrud:
    def test_get_lists_all_terms(self, client):
        r = client.get("/api/suppressed")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_post_creates_term_lowercased(self, client):
        r = client.post("/api/suppressed", json={"term": "  NewTerm  "})
        assert r.status_code == 201
        # Route layer lowercases + strips before insert.
        assert r.json()["term"] == "newterm"

    def test_post_rejects_empty_term(self, client):
        r = client.post("/api/suppressed", json={"term": "   "})
        assert r.status_code == 400

    def test_post_rejects_duplicate_term(self, client):
        client.post("/api/suppressed", json={"term": "dupterm"})
        r = client.post("/api/suppressed", json={"term": "dupterm"})
        assert r.status_code == 409

    def test_delete_removes_term(self, client):
        created = client.post("/api/suppressed", json={"term": "tempterm"}).json()
        r = client.delete(f"/api/suppressed/{created['id']}")
        assert r.status_code == 200
        assert r.json() == {"deleted": created["id"]}

    def test_delete_returns_404_for_missing_id(self, client):
        r = client.delete("/api/suppressed/999999")
        assert r.status_code == 404
