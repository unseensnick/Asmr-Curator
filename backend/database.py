import sqlite3
import os
from typing import Optional

DB_PATH = os.environ.get("DB_PATH", "/data/dictionary.db")

DEFAULT_PILLS = [
    "soft spot for you", "soft spot foryou", "friends to lovers",
    "enemies to lovers", "strangers to lovers", "sleep aid", "hair play",
    "slice of life", "touch starved", "evil queen", "capturing you",
    "capturingyou", "soft for you", "cozy cabin", "making you kneel",
    "cold to everyone", "sfw", "nsfw", "dominant", "submissive", "villain",
    "playful", "comfort", "wholesome", "kisses", "cuddles", "flirty",
    "protective", "possessive", "jealousy", "praise", "affirmations",
    "massage", "heartbeat", "rain", "fireplace", "fantasy", "royalty",
    "yandere", "tsundere", "kuudere", "spoonsex", "spoon sex", "shy girl",
    "thick girl", "friends to more", "goth girl", "watching porn",
    "sisters best friend", "multiple orgasms", "nipple sucking",
]

DEFAULT_SYNONYMS = [
    ("dommy", "Dominant"), ("dom", "Dominant"), ("sub", "Submissive"),
    ("doggy", "Doggystyle"), ("tolovers", None),
    ("f4a", None), ("m4a", None), ("f4f", None),
    ("m4m", None), ("f4m", None), ("m4f", None),
]

DEFAULT_VARIANTS = [
    ("capturingyou", "Capturing You"),
    ("soft spot foryou", "Soft Spot For You"),
    ("softspotforyou", "Soft Spot For You"),
    ("friendstolovers", "Friends to Lovers"),
    ("sleepaid", "Sleep Aid"),
    ("hairplay", "Hair Play"),
    ("sliceoflife", "Slice of Life"),
    ("touchstarved", "Touch Starved"),
    ("evilqueen", "Evil Queen"),
    ("spoonsex", "Spoon Sex"),
    ("shygirl", "Shy Girl"),
    ("curvygirl", "Curvy Girl"),
    ("gothgirl", "Goth Girl"),
    ("friendstomore", "Friends to More"),
    ("friends to?", "Friends to ?"),
    ("soft spotforyou", "Soft Spot For You"),
    ("doggy", "Doggystyle"),
    ("chairsex", "Chair Sex"),
    ("friends to lovers", "Friends to Lovers"),
    ("friendslovers", "Friends to Lovers"),
]

DEFAULT_SPLITFIXES = [
    (r"friends\s+tolovers", "friends to lovers"),
    (r"friends\s+to\s+lovers", "friends to lovers"),
    (r"enemies\s+tolovers", "enemies to lovers"),
    (r"strangers\s+tolovers", "strangers to lovers"),
    (r"sleep\s+aid", "sleep aid"),
    (r"hair\s+play", "hair play"),
    (r"spoon\s+sex", "spoon sex"),
    (r"soft\s+spot\s+for\s+you", "soft spot for you"),
    (r"soft\s+spot\s+foryou", "soft spot for you"),
    (r"touch\s+starved", "touch starved"),
    (r"evil\s+queen", "evil queen"),
    (r"slice\s+of\s+life", "slice of life"),
    (r"cozy\s+cabin", "cozy cabin"),
    (r"thick\s+girl", "thick girl"),
    (r"friends\s+to\s+more", "friends to more"),
    (r"friends\s+to?", "friends to ?"),
    (r"soft\s+spotforyou", "soft spot for you"),
    (r"watching\s+porn", "watching porn"),
    (r"sisters\s+best\s+friend", "sister's best friend"),
    (r"friends\s+lovers", "friends to lovers"),
]


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables and seed defaults if the db is fresh."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS pills (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phrase TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS synonyms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_word TEXT NOT NULL UNIQUE,
                to_word TEXT  -- NULL means suppress
            );
            CREATE TABLE IF NOT EXISTS variants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_str TEXT NOT NULL UNIQUE,
                to_str TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS splitfixes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern TEXT NOT NULL,
                replacement TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        """)

        # Seed defaults only once
        seeded = conn.execute(
            "SELECT value FROM meta WHERE key='seeded'"
        ).fetchone()
        if not seeded:
            conn.executemany(
                "INSERT OR IGNORE INTO pills (phrase) VALUES (?)",
                [(p,) for p in DEFAULT_PILLS],
            )
            conn.executemany(
                "INSERT OR IGNORE INTO synonyms (from_word, to_word) VALUES (?,?)",
                DEFAULT_SYNONYMS,
            )
            conn.executemany(
                "INSERT OR IGNORE INTO variants (from_str, to_str) VALUES (?,?)",
                DEFAULT_VARIANTS,
            )
            conn.executemany(
                "INSERT OR IGNORE INTO splitfixes (pattern, replacement) VALUES (?,?)",
                DEFAULT_SPLITFIXES,
            )
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('seeded','1')"
            )


# ── Pills ─────────────────────────────────────────────────────────────────────
def get_pills():
    with get_conn() as conn:
        rows = conn.execute("SELECT id, phrase FROM pills ORDER BY id").fetchall()
        return [dict(r) for r in rows]

def add_pill(phrase: str):
    """Store phrase with its original casing. Uniqueness is case-insensitive."""
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM pills WHERE LOWER(phrase)=LOWER(?)", (phrase,)
        ).fetchone()
        if existing:
            raise ValueError(f"Phrase already exists: {phrase}")
        cur = conn.execute(
            "INSERT INTO pills (phrase) VALUES (?) RETURNING id, phrase", (phrase,)
        )
        return dict(cur.fetchone())

def delete_pill(pill_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM pills WHERE id=?", (pill_id,))
        return cur.rowcount > 0


# ── Synonyms ──────────────────────────────────────────────────────────────────
def get_synonyms():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, from_word, to_word FROM synonyms ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]

def add_synonym(from_word: str, to_word: Optional[str]):
    with get_conn() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO synonyms (from_word, to_word) VALUES (?,?) "
                "RETURNING id, from_word, to_word",
                (from_word, to_word),
            )
            return dict(cur.fetchone())
        except sqlite3.IntegrityError:
            raise ValueError(f"Synonym already exists: {from_word}")

def delete_synonym(synonym_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM synonyms WHERE id=?", (synonym_id,))
        return cur.rowcount > 0


# ── Variants ──────────────────────────────────────────────────────────────────
def get_variants():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, from_str, to_str FROM variants ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]

def add_variant(from_str: str, to_str: str):
    with get_conn() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO variants (from_str, to_str) VALUES (?,?) "
                "RETURNING id, from_str, to_str",
                (from_str, to_str),
            )
            return dict(cur.fetchone())
        except sqlite3.IntegrityError:
            raise ValueError(f"Variant already exists: {from_str}")

def delete_variant(variant_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM variants WHERE id=?", (variant_id,))
        return cur.rowcount > 0


# ── Split Fixes ───────────────────────────────────────────────────────────────
def get_splitfixes():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, pattern, replacement FROM splitfixes ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]

def add_splitfix(pattern: str, replacement: str):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO splitfixes (pattern, replacement) VALUES (?,?) "
            "RETURNING id, pattern, replacement",
            (pattern, replacement),
        )
        return dict(cur.fetchone())

def delete_splitfix(fix_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM splitfixes WHERE id=?", (fix_id,))
        return cur.rowcount > 0


# ── Full dict helpers ─────────────────────────────────────────────────────────
def get_full_dict():
    """Return dict in the shape the frontend expects."""
    pills = [r["phrase"] for r in get_pills()]
    syns_raw = get_synonyms()
    variants_raw = get_variants()
    fixes_raw = get_splitfixes()

    return {
        "pills": pills,
        "synonyms": {r["from_word"]: r["to_word"] for r in syns_raw},
        "variants": {r["from_str"]: r["to_str"] for r in variants_raw},
        "splitFixes": [[r["pattern"], r["replacement"]] for r in fixes_raw],
        # also expose with IDs for the UI delete operations
        "_pills": [{"id": r["id"], "phrase": r["phrase"]} for r in get_pills()],
        "_synonyms": syns_raw,
        "_variants": variants_raw,
        "_splitFixes": fixes_raw,
    }

def replace_full_dict(data: dict):
    """Wipe and re-seed from an imported JSON blob."""
    with get_conn() as conn:
        conn.execute("DELETE FROM pills")
        conn.execute("DELETE FROM synonyms")
        conn.execute("DELETE FROM variants")
        conn.execute("DELETE FROM splitfixes")
        conn.executemany(
            "INSERT OR IGNORE INTO pills (phrase) VALUES (?)",
            [(p,) for p in data.get("pills", [])],
        )
        for from_w, to_w in data.get("synonyms", {}).items():
            conn.execute(
                "INSERT OR IGNORE INTO synonyms (from_word, to_word) VALUES (?,?)",
                (from_w.lower(), to_w),
            )
        for from_s, to_s in data.get("variants", {}).items():
            conn.execute(
                "INSERT OR IGNORE INTO variants (from_str, to_str) VALUES (?,?)",
                (from_s.lower(), to_s),
            )
        for fix in data.get("splitFixes", []):
            conn.execute(
                "INSERT INTO splitfixes (pattern, replacement) VALUES (?,?)",
                (fix[0], fix[1]),
            )

def reset_to_defaults():
    with get_conn() as conn:
        conn.execute("DELETE FROM pills")
        conn.execute("DELETE FROM synonyms")
        conn.execute("DELETE FROM variants")
        conn.execute("DELETE FROM splitfixes")
        conn.executemany(
            "INSERT OR IGNORE INTO pills (phrase) VALUES (?)",
            [(p,) for p in DEFAULT_PILLS],
        )
        conn.executemany(
            "INSERT OR IGNORE INTO synonyms (from_word, to_word) VALUES (?,?)",
            DEFAULT_SYNONYMS,
        )
        conn.executemany(
            "INSERT OR IGNORE INTO variants (from_str, to_str) VALUES (?,?)",
            DEFAULT_VARIANTS,
        )
        conn.executemany(
            "INSERT OR IGNORE INTO splitfixes (pattern, replacement) VALUES (?,?)",
            DEFAULT_SPLITFIXES,
        )


# Init on import
init_db()


# ── Edit (PATCH) helpers ──────────────────────────────────────────────────────
def edit_pill(pill_id: int, phrase: str) -> Optional[dict]:
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM pills WHERE LOWER(phrase)=LOWER(?) AND id!=?", (phrase, pill_id)
        ).fetchone()
        if existing:
            raise ValueError(f"Phrase already exists: {phrase}")
        cur = conn.execute(
            "UPDATE pills SET phrase=? WHERE id=? RETURNING id, phrase",
            (phrase, pill_id),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def edit_synonym(synonym_id: int, from_word: str, to_word) -> Optional[dict]:
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM synonyms WHERE LOWER(from_word)=LOWER(?) AND id!=?",
            (from_word, synonym_id),
        ).fetchone()
        if existing:
            raise ValueError(f"Synonym already exists: {from_word}")
        cur = conn.execute(
            "UPDATE synonyms SET from_word=?, to_word=? WHERE id=? "
            "RETURNING id, from_word, to_word",
            (from_word, to_word, synonym_id),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def edit_variant(variant_id: int, from_str: str, to_str: str) -> Optional[dict]:
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM variants WHERE LOWER(from_str)=LOWER(?) AND id!=?",
            (from_str, variant_id),
        ).fetchone()
        if existing:
            raise ValueError(f"Variant already exists: {from_str}")
        cur = conn.execute(
            "UPDATE variants SET from_str=?, to_str=? WHERE id=? "
            "RETURNING id, from_str, to_str",
            (from_str, to_str, variant_id),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def edit_splitfix(fix_id: int, pattern: str, replacement: str) -> Optional[dict]:
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE splitfixes SET pattern=?, replacement=? WHERE id=? "
            "RETURNING id, pattern, replacement",
            (pattern, replacement, fix_id),
        )
        row = cur.fetchone()
        return dict(row) if row else None