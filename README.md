# ASMR Filename Generator

Self-hosted tool for generating formatted ASMR filenames from Patreon post screenshots. A local vision LLM (Ollama) extracts the title and tags, which are matched against a persistent tag vocabulary and used to build standardised filenames.

## Stack

| Layer     | Tech                                           |
| --------- | ---------------------------------------------- |
| Frontend  | React 19, Vite, Tailwind CSS v4, shadcn/ui     |
| Backend   | Python 3.12+, FastAPI, Uvicorn                 |
| Database  | SQLite — single file, zero config              |
| LLM       | Ollama (`qwen2.5vl:7b`) — runs outside the container |
| Container | Docker + Compose                               |

## Project structure

```
├── .devcontainer/
│   ├── devcontainer.json   # VS Code dev container config
│   └── Dockerfile          # dev environment image (Ubuntu + uv + Node)
├── backend/
│   ├── main.py             # FastAPI routes + Ollama integration
│   ├── database.py         # SQLite queries + default seeding
│   ├── pyproject.toml
│   ├── requirements.txt
│   └── uv.lock
├── frontend/
│   ├── src/
│   │   ├── components/     # OCRUploader, TagsEditor, FilenameOutput,
│   │   │                   # FileBrowser, DictionaryModal, ParserTestPane
│   │   ├── lib/            # api.ts, parser.ts, types.ts
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts      # proxies /api → localhost:8000 in dev
├── data/
│   └── dictionary.db       # auto-created on first run (git-ignored)
├── dev.sh                  # start both servers — Linux / Mac
├── dev.bat                 # start both servers — Windows
├── Dockerfile              # production app image
└── docker-compose.yml
```

## Features

- **LLM-based extraction**: Drag-drop or paste a screenshot → Ollama vision model extracts the title and tags → matched against your tag vocabulary automatically
- **Patreon URL fetch**: Paste a Patreon post or creator URL → the bundled [`patreon-dl`](https://github.com/patrickkfkan/patreon-dl) downloads the audio file under `AUDIO_ROOT` and pre-fills the title, tags, and artist from the post's API metadata. Tick **Metadata only** to skip the audio download when the file is already on disk. Skips the screenshot/OCR round-trip for posts you can access with your session cookie
- **Tag vocabulary**: Persistent SQLite database with canonical tags and optional aliases. The full vocabulary is injected into the Ollama prompt so the LLM uses your preferred tag forms instead of inventing its own
- **Suppressed terms**: Explicit blocklist — matched terms are dropped from the output silently
- **Parser test pane**: Paste raw post text to preview how the LLM would tag it against the current vocabulary, with quick-add buttons for unrecognised tags
- **File browser & rename**: Recursive server-side file browser with live search (filter by filename, folder, or both), file selection, and one-click rename
- **Dual output formats**: Generate filenames with dash separator (filesystem-safe) or pipe separator (for metadata/descriptions)
- **Import/export**: Backup and restore the full dictionary as a portable JSON file

## Running in production

```bash
docker compose up --build
```

Open **http://localhost:8000**. The dictionary database is created and seeded automatically on first boot and lives in `./data/` on your host — it survives rebuilds and restarts.

Set `OLLAMA_BASE_URL` and `OLLAMA_MODEL` in `docker-compose.yml` to point at your Ollama server:

```yaml
environment:
  - OLLAMA_BASE_URL=http://your-ollama-host:11434
  - OLLAMA_MODEL=qwen2.5vl:7b
```

To enable file browsing and renaming, set `AUDIO_ROOT` in `docker-compose.yml` to point at your audio library directory.

## Running in the devcontainer

In dev mode the frontend (Vite, port **5173**) and backend (Uvicorn, port **8000**) run as separate processes. Vite proxies all `/api` requests to the backend automatically.

### Option 1 — dev script (recommended)

**Linux / Mac:**

```bash
bash dev.sh
```

**Windows:**

```bat
dev.bat
```

Both scripts start the Vite dev server and the FastAPI backend in parallel. `Ctrl+C` stops both.

### Option 2 — two terminals

**Terminal 1 — frontend:**

```bash
cd frontend
npm run dev
```

**Terminal 2 — backend:**

```bash
uvicorn backend.main:app --reload
```

Open **http://localhost:5173**. Changes to `frontend/src/` hot-reload instantly; changes to `backend/*.py` reload Uvicorn in ~1s.

### Configuring the file browser

Edit `.devcontainer/devcontainer.json` and update the `mounts` section to point at your audio library:

```json
"mounts": [
  "source=/path/to/your/audio/library,target=/mnt/audio,type=bind,consistency=cached"
],
"remoteEnv": {
  "AUDIO_ROOT": "/mnt/audio"
}
```

Windows users should use `source=C:\\Users\\...\\path\\to\\audio`.

## Building the frontend

The production Docker image runs only Uvicorn — it serves the pre-built Vite output from `frontend/dist/`. To build:

```bash
cd frontend && npm run build
```

The `docker-compose.yml` build step handles this automatically.

## API Reference

Interactive docs at **http://localhost:8000/docs** (Swagger UI, auto-generated).

### Extraction

| Method | Path                | Description                                       |
| ------ | ------------------- | ------------------------------------------------- |
| POST   | `/api/extract`      | Send a base64 image → get title + tags from Ollama |
| POST   | `/api/preview-tags` | Send raw text → preview how the LLM would tag it  |

### Patreon download

| Method | Path                            | Description                                                                                          |
| ------ | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/api/settings/patreon-cookie`  | Cookie status — `{ set: bool, length: number }`                                                       |
| PUT    | `/api/settings/patreon-cookie`  | Save the Patreon cookie. Accepts `application/json` (`{"cookie":"..."}`) or raw `text/plain` body     |
| POST   | `/api/patreon/fetch`            | `{"url":"<patreon post or creator URL>", "metadata_only": false}` → downloads via `patreon-dl` into `AUDIO_ROOT/.patreon-dl/`, returns `{ output_dir, count, metadata_only, posts: [{post_id, title, tags, artist, post_dir, audio_path}] }`. Set `metadata_only: true` to skip the audio download (faster — useful when the file is already on disk and you only need title/tags). On `count: 0` the response includes a `hint` and `log_tail` to help diagnose |

#### Setting the Patreon cookie

The Patreon URL panel and the `/api/patreon/fetch` endpoint both require a session cookie since `patreon-dl` is a cookie-driven scraper (no Patreon API key exists for this use case). Two ways to set it:

- **In the UI** — open the Tag Dictionary modal → **Patreon Cookie** tab → paste the cookie value → **Save cookie**. The tab includes a step-by-step DevTools walkthrough.
- **Via curl** —

  ```bash
  # Either form works; text/plain avoids JSON-escaping the embedded `"` chars in g_state etc.
  curl -X PUT http://localhost:8000/api/settings/patreon-cookie \
    -H 'Content-Type: text/plain' \
    --data-binary @cookie.txt
  ```

The cookie is stored locally in `data/dictionary.db` and never sent anywhere except to Patreon itself by `patreon-dl`. It expires periodically — refresh when fetches start failing.

### Dictionary

| Method | Path                      | Description                               |
| ------ | ------------------------- | ----------------------------------------- |
| GET    | `/api/dictionary`         | Full dictionary (vocabulary + suppressed) |
| PUT    | `/api/dictionary`         | Bulk import — replaces the entire dictionary |
| POST   | `/api/dictionary/reset`   | Reset to built-in defaults                |
| GET    | `/api/vocabulary`         | List all vocabulary entries               |
| POST   | `/api/vocabulary`         | Add a canonical tag (with optional aliases) |
| PATCH  | `/api/vocabulary/{id}`    | Edit a vocabulary entry                   |
| DELETE | `/api/vocabulary/{id}`    | Remove a vocabulary entry                 |
| GET    | `/api/suppressed`         | List all suppressed terms                 |
| POST   | `/api/suppressed`         | Add a suppressed term                     |
| DELETE | `/api/suppressed/{id}`    | Remove a suppressed term                  |

### File Browser & Rename

| Method | Path                | Description                                                                         |
| ------ | ------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/api/files`        | List files and subdirectories at `AUDIO_ROOT/subdir` (one level)                    |
| GET    | `/api/files/search` | Recursively search all audio/video files; supports `q` and `search_in` query params |
| GET    | `/api/files/debug`  | Diagnostic endpoint — shows what's visible at `AUDIO_ROOT` to troubleshoot mounts   |
| POST   | `/api/rename`       | Rename a file (validates filename length, path traversal, and conflicts)            |

`/api/files/search` accepts `search_in=filename` (default), `search_in=folder`, or `search_in=both`.

**Note**: All file endpoints require `AUDIO_ROOT` to be set and mounted.

### Supported Audio/Video Formats

`.mp3` `.wav` `.flac` `.aac` `.ogg` `.m4a` `.wma` `.mp4` `.mov` `.avi` `.mkv` `.webm`

## Backup & Restore

### Dictionary

- **Export**: Click **Export JSON** in the Tag Dictionary modal → saves a portable JSON file
- **Import**: Click **Import JSON** → replaces the entire dictionary from a JSON file
- **Raw backup**: Copy `./data/dictionary.db` — it's a plain SQLite file that persists across container rebuilds

### File Renaming

The **File to Rename** section lets you:

1. Search your audio library by filename, folder, or both using the live search with debouncing
2. Select a file from the results list
3. Choose a separator — dash (filesystem-safe) or pipe (for metadata)
4. Preview the new filename with byte-length indicator (255-byte limit enforced)
5. Click **Rename File** to apply the change on the server
