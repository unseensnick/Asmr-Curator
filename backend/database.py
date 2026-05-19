import sqlite3
import os
import json
from pathlib import Path
from typing import Optional, TypedDict


# ── Row shapes ────────────────────────────────────────────────────────────────
# Mirror what the helpers below return, so callers don't have to remember the
# key set. Plain TypedDicts (not Pydantic) — the data already comes from SQLite
# and the values aren't user input, so runtime validation buys nothing.

class VocabEntry(TypedDict):
    id: int
    canonical: str
    aliases: list[str]


class SuppressedEntry(TypedDict):
    id: int
    term: str


def _default_db_path() -> str:
    """Default DB_PATH; Windows-aware so a host-side run doesn't drop the DB outside the repo."""
    if os.name == "nt":
        # Python resolves the POSIX default `/data/dictionary.db` against the
        # current drive root on Windows (e.g. `E:\data\dictionary.db`), which
        # silently creates a stray seeded DB outside the repo. Anchor to the
        # repo root instead. Docker + devcontainer override DB_PATH explicitly.
        repo_root = Path(__file__).resolve().parent.parent
        return str(repo_root / "data" / "dictionary.db")
    return "/data/dictionary.db"


DB_PATH = os.environ.get("DB_PATH", _default_db_path())

# ── Default vocabulary ────────────────────────────────────────────────────────
# Each entry: (canonical_display_form, [lowercase_aliases...])
# Canonical is the display form used in filenames (Title Case).
# Aliases are alternate spellings / run-together OCR artefacts.

DEFAULT_VOCABULARY: list[tuple[str, list[str]]] = [
    # Multi-word phrase tags
    ("Soft Spot For You",      ["soft spot for you", "soft spot foryou", "softspotforyou", "soft spotforyou"]),
    ("Friends to Lovers",      ["friends to lovers", "friendstolovers", "friendslovers"]),
    ("Friends to ?",           ["friends to?"]),
    ("Enemies to Lovers",      ["enemies to lovers", "enemiestolovers"]),
    ("Strangers to Lovers",    ["strangers to lovers"]),
    ("Sleep Aid",              ["sleep aid", "sleepaid"]),
    ("Hair Play",              ["hair play", "hairplay"]),
    ("Slice of Life",          ["slice of life", "sliceoflife"]),
    ("Touch Starved",          ["touch starved", "touchstarved"]),
    ("Evil Queen",             ["evil queen", "evilqueen"]),
    ("Capturing You",          ["capturing you", "capturingyou"]),
    ("Cozy Cabin",             ["cozy cabin"]),
    ("Making You Kneel",       ["making you kneel"]),
    ("Cold to Everyone",       ["cold to everyone"]),
    ("Soft For You",           ["soft for you"]),
    ("Spoon Sex",              ["spoon sex", "spoonsex"]),
    ("Shy Girl",               ["shy girl", "shygirl"]),
    ("Thick Girl",             ["thick girl"]),
    ("Goth Girl",              ["goth girl", "gothgirl"]),
    ("Curvy Girl",             ["curvygirl"]),
    ("Popular Girl",           ["popular girl", "populargirl"]),
    ("Friends to More",        ["friends to more", "friendstomore"]),
    ("Hair Pulling",           ["hair pulling", "hairpulling", "hairpuling"]),
    ("Sweet Aftercare",        ["sweet aftercare", "sweetaftercare"]),
    ("Best Friend's Sister",   ["best friend's sister", "bestfriendssister", "best friends sister", "sisters best friend"]),
    ("Enemies to Fuckbuddies", ["enemies to fuckbuddies", "enemiestofuckbuddies"]),
    ("Chair Sex",              ["chairsex"]),
    ("Watching Porn",          ["watching porn"]),
    ("Multiple Orgasms",       []),
    ("Nipple Sucking",         []),
    ("Car Cuddles",            []),
    ("Drive-In Movie",         []),
    ("Rough Sex",              []),
    ("Dirty Talk",             []),
    # Single-word / short tags
    ("SFW",          ["sfw"]),
    ("NSFW",         ["nsfw"]),
    ("Dominant",     ["dom", "dommy"]),
    ("Submissive",   ["sub"]),
    ("Doggystyle",   ["doggy"]),
    ("Villain",      []),
    ("Playful",      []),
    ("Comfort",      []),
    ("Wholesome",    []),
    ("Kissing",      ["kisses", "kissing"]),
    ("Cuddles",      []),
    ("Flirty",       ["flirting"]),
    ("Protective",   []),
    ("Possessive",   []),
    ("Jealousy",     []),
    ("Praise",       []),
    ("Affirmations", []),
    ("Massage",      []),
    ("Heartbeat",    []),
    ("Rain",         []),
    ("Fireplace",    []),
    ("Fantasy",      []),
    ("Royalty",      []),
    ("Yandere",      []),
    ("Tsundere",     []),
    ("Kuudere",      []),
    ("Aftercare",    []),
    ("Blowjob",      []),
    ("Cheerleader",  []),
    ("Public",       []),
    ("Gagging",      []),
    ("Risky",        []),
    ("More",         []),
    ("Teasing",      []),
]

DEFAULT_SUPPRESSED: list[str] = [
    "tolovers", "f4a", "m4a", "f4f", "m4m", "f4m", "m4f",
]


# ── Connection ────────────────────────────────────────────────────────────────

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ── Schema ────────────────────────────────────────────────────────────────────

def _vocab_row_to_dict(row: sqlite3.Row) -> VocabEntry:
    return {"id": row["id"], "canonical": row["canonical"], "aliases": json.loads(row["aliases"])}


def _canonical_exists(conn: sqlite3.Connection, canonical: str, exclude_id: Optional[int] = None) -> bool:
    if exclude_id is None:
        return conn.execute(
            "SELECT id FROM tag_vocabulary WHERE LOWER(canonical)=LOWER(?)", (canonical,)
        ).fetchone() is not None
    return conn.execute(
        "SELECT id FROM tag_vocabulary WHERE LOWER(canonical)=LOWER(?) AND id!=?",
        (canonical, exclude_id),
    ).fetchone() is not None


def init_db():
    """Create tables. Legacy tables are kept so existing DBs don't break on first run."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_conn() as conn:
        conn.executescript("""
            -- ── New tables ──────────────────────────────────────────────────
            CREATE TABLE IF NOT EXISTS tag_vocabulary (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                canonical TEXT NOT NULL UNIQUE,
                aliases   TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS suppressed_terms (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                term TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            -- ── Legacy tables (kept for migration; no longer written to) ───
            CREATE TABLE IF NOT EXISTS pills (
                id     INTEGER PRIMARY KEY AUTOINCREMENT,
                phrase TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS synonyms (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                from_word TEXT NOT NULL UNIQUE,
                to_word   TEXT
            );
            CREATE TABLE IF NOT EXISTS variants (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                from_str TEXT NOT NULL UNIQUE,
                to_str   TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS splitfixes (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern     TEXT NOT NULL,
                replacement TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT
            );
        """)


def _seed_vocabulary(conn):
    """Insert DEFAULT_VOCABULARY and DEFAULT_SUPPRESSED into new tables."""
    for canonical, aliases in DEFAULT_VOCABULARY:
        conn.execute(
            "INSERT OR IGNORE INTO tag_vocabulary (canonical, aliases) VALUES (?, ?)",
            (canonical, json.dumps(aliases)),
        )
    for term in DEFAULT_SUPPRESSED:
        conn.execute(
            "INSERT OR IGNORE INTO suppressed_terms (term) VALUES (?)",
            (term,),
        )


def migrate_db():
    """Seed fresh defaults or migrate from legacy tables if tag_vocabulary is empty."""
    with get_conn() as conn:
        vocab_count = conn.execute("SELECT COUNT(*) FROM tag_vocabulary").fetchone()[0]
        pills_count = conn.execute("SELECT COUNT(*) FROM pills").fetchone()[0]

        if vocab_count == 0 and pills_count > 0:
            _migrate_legacy_to_vocabulary(conn)
        elif vocab_count == 0:
            _seed_vocabulary(conn)


def _migrate_legacy_to_vocabulary(conn):
    """Build tag_vocabulary from legacy pills/synonyms/variants tables."""
    # canonical_map: lowercase_canonical → [display, {lowercase_aliases}]
    canonical_map: dict[str, list] = {}

    pills = conn.execute("SELECT phrase FROM pills ORDER BY id").fetchall()
    for row in pills:
        phrase = row[0]
        k = phrase.lower()
        if k not in canonical_map:
            canonical_map[k] = [phrase, set()]

    variants = conn.execute("SELECT from_str, to_str FROM variants ORDER BY id").fetchall()
    for row in variants:
        from_str, to_str = row[0], row[1]
        canon_k = to_str.lower()
        alias_k = from_str.lower()

        if canon_k not in canonical_map:
            canonical_map[canon_k] = [to_str, set()]
        else:
            # Prefer the title-cased form from the variant
            canonical_map[canon_k][0] = to_str

        canonical_map[canon_k][1].add(alias_k)

        if alias_k in canonical_map and alias_k != canon_k:
            del canonical_map[alias_k]

    synonyms = conn.execute(
        "SELECT from_word, to_word FROM synonyms WHERE to_word IS NOT NULL ORDER BY id"
    ).fetchall()
    for row in synonyms:
        from_word, to_word = row[0], row[1]
        canon_k = to_word.lower()
        if canon_k not in canonical_map:
            canonical_map[canon_k] = [to_word, set()]
        canonical_map[canon_k][1].add(from_word.lower())

    for _k, (display, aliases) in canonical_map.items():
        conn.execute(
            "INSERT OR IGNORE INTO tag_vocabulary (canonical, aliases) VALUES (?, ?)",
            (display, json.dumps(sorted(aliases))),
        )

    null_syns = conn.execute(
        "SELECT from_word FROM synonyms WHERE to_word IS NULL ORDER BY id"
    ).fetchall()
    for row in null_syns:
        conn.execute(
            "INSERT OR IGNORE INTO suppressed_terms (term) VALUES (?)",
            (row[0].lower(),),
        )


# ── Vocabulary CRUD ───────────────────────────────────────────────────────────

def get_vocabulary() -> list[VocabEntry]:
    # Ordered by id (insertion order) so the UI's drag-reorder is durable: the
    # bulk-replace PUT /api/dictionary wipes and re-inserts in array order,
    # which renumbers ids in that order — but the order only sticks if reads
    # follow the ids back. On the alias collision in buildDictDerived (last
    # write wins), the user's drag-reorder is the only knob to pick which
    # entry wins on a contested alias.
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, canonical, aliases FROM tag_vocabulary ORDER BY id"
        ).fetchall()
        return [_vocab_row_to_dict(r) for r in rows]


def add_vocab_entry(canonical: str, aliases: list[str]) -> VocabEntry:
    """Add a new canonical tag. Raises ValueError on duplicate canonical."""
    with get_conn() as conn:
        if _canonical_exists(conn, canonical):
            raise ValueError(f"Canonical tag already exists: {canonical}")
        cur = conn.execute(
            "INSERT INTO tag_vocabulary (canonical, aliases) VALUES (?, ?) "
            "RETURNING id, canonical, aliases",
            (canonical, json.dumps(aliases)),
        )
        return _vocab_row_to_dict(cur.fetchone())


def edit_vocab_entry(entry_id: int, canonical: str, aliases: list[str]) -> Optional[VocabEntry]:
    with get_conn() as conn:
        if _canonical_exists(conn, canonical, exclude_id=entry_id):
            raise ValueError(f"Canonical tag already exists: {canonical}")
        cur = conn.execute(
            "UPDATE tag_vocabulary SET canonical=?, aliases=? WHERE id=? "
            "RETURNING id, canonical, aliases",
            (canonical, json.dumps(aliases), entry_id),
        )
        row = cur.fetchone()
        return _vocab_row_to_dict(row) if row else None


def delete_vocab_entry(entry_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM tag_vocabulary WHERE id=?", (entry_id,))
        return cur.rowcount > 0


# ── Suppressed terms CRUD ─────────────────────────────────────────────────────

def get_suppressed() -> list[SuppressedEntry]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, term FROM suppressed_terms ORDER BY term COLLATE NOCASE"
        ).fetchall()
        return [{"id": r["id"], "term": r["term"]} for r in rows]


def add_suppressed(term: str) -> SuppressedEntry:
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM suppressed_terms WHERE LOWER(term)=LOWER(?)", (term,)
        ).fetchone()
        if existing:
            raise ValueError(f"Term already suppressed: {term}")
        cur = conn.execute(
            "INSERT INTO suppressed_terms (term) VALUES (?) RETURNING id, term",
            (term,),
        )
        row = cur.fetchone()
        return {"id": row["id"], "term": row["term"]}


def delete_suppressed(term_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM suppressed_terms WHERE id=?", (term_id,))
        return cur.rowcount > 0


# ── Full dict helpers ─────────────────────────────────────────────────────────

def get_full_dict() -> dict:
    """Return the dictionary in the shape the frontend expects."""
    return {
        "vocabulary": get_vocabulary(),
        "suppressed": get_suppressed(),
    }


def replace_full_dict(data: dict):
    """Wipe vocabulary + suppressed and re-seed from an imported JSON blob."""
    with get_conn() as conn:
        conn.execute("DELETE FROM tag_vocabulary")
        conn.execute("DELETE FROM suppressed_terms")
        for entry in data.get("vocabulary", []):
            canonical = str(entry.get("canonical", "")).strip()
            if not canonical:
                continue
            aliases = [str(a).lower() for a in entry.get("aliases", []) if a]
            conn.execute(
                "INSERT OR IGNORE INTO tag_vocabulary (canonical, aliases) VALUES (?, ?)",
                (canonical, json.dumps(aliases)),
            )
        for item in data.get("suppressed", []):
            term = str(item.get("term", "") if isinstance(item, dict) else item).strip().lower()
            if term:
                conn.execute(
                    "INSERT OR IGNORE INTO suppressed_terms (term) VALUES (?)",
                    (term,),
                )


def reset_to_defaults():
    with get_conn() as conn:
        conn.execute("DELETE FROM tag_vocabulary")
        conn.execute("DELETE FROM suppressed_terms")
        _seed_vocabulary(conn)


# ── Settings (key/value) ──────────────────────────────────────────────────────

def get_setting(key: str) -> Optional[str]:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )


def delete_setting(key: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM settings WHERE key=?", (key,))
        return cur.rowcount > 0


# ── Init on import ────────────────────────────────────────────────────────────

init_db()
migrate_db()
