# ASMR Workbench

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
│   ├── patreon_fetch.py    # subprocess wrapper around patreon-dl
│   ├── pyproject.toml
│   ├── requirements.txt
│   └── uv.lock
├── frontend/
│   ├── src/
│   │   ├── components/     # ScreenshotPanel, TagsEditor, OutputPanel,
│   │   │                   # FileBrowser, SelectedFilePanel, PatreonPanel,
│   │   │                   # DictionaryModal, dictionary/DictionaryTester, …
│   │   ├── hooks/          # useClipboard, etc.
│   │   ├── lib/            # api.ts, parser.ts, types.ts, audio-formats.json
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts      # proxies /api → localhost:8000 in dev
├── extension/              # optional MV3 browser extension (Patreon cookie sync + external audio capture)
├── data/
│   └── dictionary.db       # auto-created on first run (git-ignored)
├── .env.example            # template for AUDIO_PATH + Ollama config
├── dev.sh                  # start both servers — Linux / Mac
├── dev.bat                 # start both servers — Windows
├── Dockerfile              # production app image
└── docker-compose.yml
```

## Features

- **LLM-based extraction**: Drag-drop or paste a screenshot → Ollama vision model extracts the title and tags → matched against your tag vocabulary automatically
- **Patreon URL fetch**: Paste a Patreon post or creator URL → the bundled [`patreon-dl`](https://github.com/patrickkfkan/patreon-dl) downloads the audio file to `AUDIO_ROOT/<post_id>/<original_filename>` and pre-fills title, tags, and artist from the post's API metadata. Creator URLs return every accessible post as a scrollable list (per-row Apply). Configurable filters:
  - **Include** chips — Audio (default) / Video / Images / Attachments
  - **Published between** date range — only meaningful for creator URLs
  - **Metadata only** — skip the audio download (faster when the file is already on disk)
  - **Dry run** — walk the pipeline without writing anything; preview via the log tail
  - Re-fetching a creator URL only pulls new posts since the last run (patreon-dl `stop.on = previouslyDownloaded`)
- **Tag vocabulary**: Persistent SQLite database with canonical tags and optional aliases. The full vocabulary is injected into the Ollama prompt so the LLM uses your preferred tag forms instead of inventing its own
- **Suppressed terms**: Explicit blocklist — matched terms are dropped from the output silently
- **Dictionary tester**: Paste raw post text to preview how the LLM would tag it against the current vocabulary, with quick-add buttons for unrecognised tags
- **File browser & rename**: Recursive server-side file browser with live search (filter by filename, folder, or both), file selection, and one-click rename
- **Dual output formats**: Generate filenames with dash separator (filesystem-safe) or pipe separator (for metadata/descriptions)
- **Light / dark theme toggle**: Sun/Moon button in the header. Follows your OS preference on first visit; remembers your choice afterwards
- **Import/export**: Backup and restore the full dictionary as a portable JSON file
- **Google Drive audio ingest** (server-side): when a Patreon post links to an audio file hosted on Google Drive, the workbench surfaces the link in the post card with a one-click **Download** button. The backend launches headless Chromium (Playwright), uses your synced Google session cookie to load the Drive viewer, intercepts the playback URL, strips the chunked-streaming parameters, and downloads the file directly into `AUDIO_ROOT/<post_id>/`. Replaces the manual DevTools-network-tab dance entirely.
- **Browser extension** (optional, in `extension/`): MV3 companion for Chromium and Firefox. Syncs Patreon **and** Google session cookies from your browser to the backend with one click — no more DevTools copy/paste. Also includes a legacy in-browser audio-capture mode kept as a fallback for cases where the server-side Drive scrape can't run. See [`extension/README.md`](extension/README.md) for install + setup.

## Running in production

### 1. Create a `.env`

`docker-compose.yml` reads `AUDIO_PATH` from a `.env` file in the project root — without it the bind mount can't resolve and `docker compose up` fails with `variable AUDIO_PATH not set`. Copy the template and edit:

```bash
cp .env.example .env
# then edit AUDIO_PATH to point at your audio library
```

`.env`:

```env
AUDIO_PATH=/path/to/your/audio/library
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5vl:7b
```

### 2. Run

**Option A — build locally:**

```bash
docker compose up --build
```

**Option B — pull the published GHCR image:**

Releases are published to `ghcr.io/unseensnick/asmr-filename-gen:latest` (and `:<version>`). To run that image instead of building, set the `image:` key in `docker-compose.yml`:

```yaml
services:
    asmr-tool:
        image: ghcr.io/unseensnick/asmr-filename-gen:latest
        # remove the `build:` block
```

Then:

```bash
docker compose pull
docker compose up
```

Open **http://localhost:8000**. The dictionary database is created and seeded automatically on first boot and lives in `./data/` on your host — it survives rebuilds and restarts.

## Running in the devcontainer

> **Opening the devcontainer**: install the VS Code [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers), then open this folder and run **"Dev Containers: Reopen in Container"** from the command palette (or click the floating notification VS Code shows on first open). VS Code will build the image from `.devcontainer/Dockerfile` and drop you into a shell inside the container. The commands below all assume you're inside it.

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

> The committed `.devcontainer/devcontainer.json` currently has a maintainer-specific Windows path under `mounts.source`. **You must replace it** with a path that exists on your host before the devcontainer can start — otherwise the bind mount fails and VS Code shows a build error. If you want to keep your local edit out of git so it doesn't keep showing up in `git status`, run `git update-index --skip-worktree .devcontainer/devcontainer.json` after editing.

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
| POST   | `/api/patreon/fetch`            | Fetch a Patreon post or creator URL via `patreon-dl`. Request: `{ "url": "...", "metadata_only"?: false, "content_types"?: ["audio"], "published_after"?: "YYYY-MM-DD", "published_before"?: "YYYY-MM-DD", "dry_run"?: false }`. Response: `{ output_dir, count, metadata_only, dry_run, posts: [{post_id, title, tags, artist, post_dir, audio_path, external_links}] }`. `external_links` lists third-party file-host URLs (Drive / Mega / MediaFire / Dropbox) found in the post body — patreon-dl doesn't follow them; use the browser extension to capture audio from those. Audio files land at `AUDIO_ROOT/<post_id>/<original_filename>` (flattened out of patreon-dl's nesting); patreon-dl's own tree + status DB stay isolated under `AUDIO_ROOT/.patreon-dl/`. `content_types` defaults to `["audio"]`; allowed values: `audio` / `video` / `image` / `attachment`. `dry_run=true` returns no parsed posts — the `log_tail` is the preview surface |
| POST   | `/api/patreon/ingest-external-audio` | Download a signed third-party audio URL (typically captured by the browser extension after stripping `ump` / `range`) into `AUDIO_ROOT/<post_id>/`. Request: `{ "post_id": "12345", "source_url": "https://...", "filename"?: "optional.mp3", "title"?, "artist"?, "album"?, "album_artist"? }`. Streams via `httpx` to a `.part` temp file, renames on success. Response: `{ audio_path, size, source_url }`. |
| POST   | `/api/patreon/ingest-drive-link` | **Server-side Drive scrape.** Given a Drive viewer URL + post_id, the backend launches headless Chromium (Playwright) with the stored Google cookie, loads the page, intercepts the first `videoplayback?…` request ≥ 400 KB, strips `ump`/`range`, downloads the file into `AUDIO_ROOT/<post_id>/`. Requires the Google cookie to be set via `PUT /api/settings/google-cookie` (typically via the browser extension's Sync button). Request: `{ "post_id": "12345", "drive_url": "https://drive.google.com/file/d/<ID>/view", "filename"?: "optional.mp3" }`. Response: `{ audio_path, size, source_url, file_id }`. |
| GET    | `/api/settings/google-cookie`   | Status of the stored Google session cookie. Returns `{ set: bool, count: number, length: number }` — never the cookie values themselves. |
| PUT    | `/api/settings/google-cookie`   | Store a Google session cookie array. Body: `{ "cookies": [...] }` where each entry is a `chrome.cookies.getAll`-style object. Backend reshapes into Playwright's expected format. Empty array clears the setting. |

#### Setting the Patreon cookie

The Patreon URL panel and the `/api/patreon/fetch` endpoint both require a session cookie since `patreon-dl` is a cookie-driven scraper (no Patreon API key exists for this use case). Three ways to set it:

- **Browser extension (easiest)** — install the MV3 extension from `extension/`, log into patreon.com in the same browser, and click the floating "Sync Patreon cookie" pill (or use the toolbar popup). See [`extension/README.md`](extension/README.md).
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
| GET    | `/api/files/search` | Recursively search all audio/video files; supports `q` and `search_in` query params. Hidden / cache dirs are pruned; results are capped at 500 (response includes `truncated: true` when the cap is hit) |
| GET    | `/api/files/debug`  | Diagnostic endpoint — shows what's visible at `AUDIO_ROOT` to troubleshoot mounts   |
| POST   | `/api/rename`       | Rename a file (validates filename length, path traversal, and conflicts). Only `.mp3` / `.flac` / `.ogg` (formats with embeddable metadata) can be renamed directly — other formats must be converted first |

`/api/files/search` accepts `search_in=filename` (default), `search_in=folder`, or `search_in=both`.

**Note**: All file endpoints require `AUDIO_ROOT` to be set and mounted.

### Audio Conversion

| Method | Path                    | Description                                                                                          |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/api/convert/formats`  | List supported output formats and quality levels (sourced from `frontend/src/lib/audio-formats.json`) |
| POST   | `/api/convert`          | Re-encode a file with `ffmpeg`. Request: `{ "path": "...", "output_format": "mp3"\|"flac"\|"ogg", "quality": "low"\|"standard"\|"high"\|"best"\|"lossless", "delete_original": false }` |

### Supported Audio/Video Formats

**Rename + metadata embed** (`.mp3` `.flac` `.ogg`) — direct rename, optional ID3/Vorbis tags.

**Needs conversion first** (`.wav` `.wma` `.mp4` `.mov` `.avi` `.mkv` `.webm` `.m4a` `.aac`) — visible in the file browser; convert via `/api/convert` to a renameable format before renaming.

The full list is the single source of truth at [`frontend/src/lib/audio-formats.json`](frontend/src/lib/audio-formats.json) and is read by both the UI and the backend.

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
