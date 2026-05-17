---
paths:
  - "backend/**"
  - "frontend/src/lib/**"
  - "frontend/src/App.tsx"
---

# Architecture Reference

## Request flow

1. User pastes/uploads a Patreon screenshot in the React UI.
2. Frontend base64-encodes it and POSTs to `/api/extract`.
3. Backend sends the image to Ollama (`qwen2.5vl` by default) with a structured prompt.
4. The raw LLM JSON is returned to the frontend.
5. `frontend/src/lib/parser.ts` parses the response — title splitting (pipe or parenthetical) and tag normalisation happen client-side.
6. Tags are matched against the vocabulary dictionary (fetched from `/api/dictionary`).
7. The final filename is assembled in the UI and optionally applied via `/api/rename`.

## Backend route groups (all in `backend/main.py`)

- `/api/extract`, `/api/preview-tags` — Ollama integration (vision LLM).
- `/api/dictionary`, `/api/vocabulary/*`, `/api/suppressed/*` — dictionary CRUD.
- `/api/files*` — file browser rooted at `LIBRARY_PATH`.
- `/api/rename` — file rename + optional ID3/FLAC/MP4 metadata write via `mutagen`.
- `/api/convert` — audio conversion via `ffmpeg` subprocess.
- `/api/settings/patreon-cookie`, `/api/patreon/*` — Patreon cookie storage + post fetch (delegates to `backend/patreon_fetch.py`).
- `/` — SPA fallback serving `frontend/dist/index.html`.

## Module responsibilities

- **`backend/main.py`** — all FastAPI routes; no separate router files.
- **`backend/database.py`** — SQLite schema, seeding (`DEFAULT_VOCABULARY`, `DEFAULT_SUPPRESSED`), all CRUD helpers. No ORM. Stores the Patreon session cookie under `PATREON_COOKIE_KEY`.
- **`backend/patreon_fetch.py`** — subprocess wrapper around `patreon-dl`; reads cookie from the DB.
- **`frontend/src/App.tsx`** — root layout, dark mode, global state (dict, extracted tags, selected file), orchestrates all panels. No state library.
- **`frontend/src/lib/parser.ts`** — all LLM response parsing: title/tag extraction, pipe vs. parenthetical splitting, alias normalisation. **Client-side only.**
- **`frontend/src/lib/api.ts`** — thin `fetch` wrapper (GET/POST/PUT/PATCH/DELETE); all API calls go through here.
- **`frontend/src/lib/types.ts`** — shared TypeScript interfaces (`VocabEntry`, `AppDict`, `FileEntry`, etc.).
- **`frontend/src/lib/audio-formats.json`** — canonical list of supported audio extensions and output formats; read by both the UI and the backend at startup.

## Environment variables

| Variable          | Default                  | Purpose                                                       |
| ----------------- | ------------------------ | ------------------------------------------------------------- |
| `LIBRARY_PATH`      | —                        | Root path for the file browser (required for file operations) |
| `DB_PATH`         | `/data/dictionary.db`    | SQLite database location                                      |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server endpoint                                        |
| `OLLAMA_MODEL`    | `qwen2.5vl:7b`           | Vision model for extraction                                   |

In Docker, `LIBRARY_PATH=/mnt/audio` and the host path is bind-mounted via `LIBRARY_PATH` in `.env` (host) → `LIBRARY_PATH` (container). The devcontainer mounts the audio dir at `/mnt/audio` and runs as `devuser` in `/workspaces/asmr-filename-gen`.

## Dev vs. production

In **dev**, Vite proxies `/api/*` to `http://localhost:8000` (configured in `vite.config.ts`). Frontend (port 5173) and backend (port 8000) run as separate processes.

In **production** (Docker), a multi-stage build compiles the React app and copies `frontend/dist/` into the Python image. FastAPI serves both the SPA and the API from port 8000. `audio-formats.json` is copied into the production image so the backend can read it at startup.
