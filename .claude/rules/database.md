---
paths:
  - "backend/database.py"
  - "backend/main.py"
---

# Database

This project uses **SQLite via `sqlite3`** — no ORM, no migration tool. The schema and all CRUD helpers live in **`backend/database.py`**, which is the single source of truth.

## Conventions

- **All SQL goes through `backend/database.py`.** Never inline a SQL query in `backend/main.py` route handlers — add or extend a helper instead (DIP / SoC).
- **Parameterise every query.** Never f-string user input into SQL. `sqlite3` supports `?` placeholders — use them.
- **Schema changes are code edits in `database.py`.** Update the `CREATE TABLE` / seed logic in place. Because the DB is local and per-deployment, there is no migration ledger — but new columns must be additive and tolerate older DB files. SQLite has no `IF NOT EXISTS` on `ADD COLUMN`, so guard with `PRAGMA table_info(<table>)` and only `ALTER TABLE ... ADD COLUMN ...` when the column is absent.
- **Never drop a column or table** without explicit user confirmation. User dictionaries are stored here and lost data is unrecoverable.
- **Seed data lives next to the schema** in `database.py` (`DEFAULT_VOCABULARY` + `DEFAULT_SUPPRESSED`). Don't move seeding into route handlers.
- **`DB_PATH` env var** controls the file location (default `/data/dictionary.db` in Docker). Don't hardcode paths.
- The hook `block-dangerous-commands.sh` blocks `DROP TABLE`, `DROP DATABASE`, `TRUNCATE TABLE`, and `DELETE FROM ... ` without `WHERE` — if you need one of these, run it manually after confirming with the user.
