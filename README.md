# ASMR Curator

Self-hosted tool for organising a local ASMR library. Pulls audio from Patreon (including Drive-hosted files), writes consistent filenames against a tag dictionary you control, and keeps the whole catalogue under one filesystem you bind-mount into the container.

## Stack

| Layer     | Tech                                           |
| --------- | ---------------------------------------------- |
| Frontend  | React 19, Vite, Tailwind CSS v4, shadcn/ui     |
| Backend   | Python 3.12+, FastAPI, Uvicorn                 |
| Database  | SQLite — single file, zero config              |
| Drive scrape | Playwright + headless Chromium             |
| LLM (optional) | Ollama (`qwen2.5vl:7b`) — runs outside the container |
| Container | Docker + Compose                               |

## Who this is for

**ASMR consumers (primary).** You buy or download a lot of ASMR audio from Patreon and want one local library with consistent filenames across creators. The Patreon-fetch and Drive-download workflows are built for this.

**ASMR artists (secondary).** A few features carry over even if you make the content rather than collect it: the file browser + ID3/FLAC/MP4 metadata writer for organising your own released catalogue, the ffmpeg-driven audio conversion (mp3 / flac / ogg with quality presets), and the tag-dictionary workflow if you want consistent tagging across uploads. The Patreon-fetch and Drive-ingest features won't help with your own content.

**Contributors.** See [`CLAUDE.md`](CLAUDE.md) and [`.claude/rules/`](.claude/rules/) for commit conventions, changelog discipline, release workflow, and what CI gates on. Quick orientation to run things locally is in **Running in the devcontainer** below.

## Workflows

Three independent ways to get audio + metadata into your library. The first is the most accurate; reach for the others only when it doesn't apply.

### 1. Patreon URL → audio + metadata (primary)

Paste a Patreon post or creator URL into the **Patreon URL** tab. The bundled [`patreon-dl`](https://github.com/patrickkfkan/patreon-dl) authenticates with your synced session cookie, downloads the audio into `DOWNLOAD_PATH/<creator>/<post_id> - <post_title>/<original_filename>`, and pre-fills title, tags, and artist from the post's API metadata. After Apply, an inline `Rename and move <file>` link jumps to the FileBrowser's Downloads tab with the file selected so you can rename and (optionally) move it into your curated library in one flow.

- Creator URLs return every accessible post as a scrollable list with per-row Apply.
- Filters: **Include** chips (Audio default / Video / Images / Attachments / Drive links), **Published between** date range, **Metadata only** (skip the audio download), **Dry run** (preview via the log tail without writing anything).
- Re-fetching a creator URL only pulls new posts since the last run (patreon-dl's `stop.on = previouslyDownloaded`).
- Re-fetching a single-post URL with **Metadata only** checked serves the cached metadata instantly without spawning patreon-dl — useful for recovering UI state without re-running the full fetch.

### 2. Drive download (for Drive-hosted audio)

Some Patreon creators link to Google Drive instead of uploading audio directly. The Patreon fetch surfaces those links in an **External Links** collapsible on each post card, with a per-link **Download** button.

The backend launches headless Chromium (Playwright) with your synced Google session cookie, opens the Drive viewer, intercepts the playback URL, strips the chunked-streaming parameters (`ump`, `range`, `srfvp`), and streams the audio into `DOWNLOAD_PATH/<creator>/<post_id> - <title>/` (matches patreon-dl; falls back to legacy `<post_id>/` when no metadata is supplied). The row label shows real-time percentage. Multiple Download clicks on the same post are serialised one-at-a-time (Drive's mid-playback cookie rotation breaks concurrent scrapes); long files have a 4 h default timeout (override via `DRIVE_DOWNLOAD_TIMEOUT_S`). On expired-session redirects the request fails in ~1 s with a "re-sync your cookie" message rather than waiting for the player.

Saved filenames come from each link's visible anchor text (e.g. `[EXCLUSIVE] [27:23] Love Goddess | With Music | Soft Waves.m4a`) so multiple downloads from the same post stay distinct.

Requires the browser extension for the cookie sync — see [`extension/README.md`](extension/README.md).

### 3. Screenshot → LLM extraction (optional / fallback)

For posts that can't be fetched via patreon-dl — a creator you don't subscribe to, a public preview, an embed elsewhere, an old screenshot you took before installing this — drop or paste an image into the **Screenshot** tab. A local vision LLM (Ollama, `qwen2.5vl:7b` by default) reads the title and tag chips off the page.

**This is the fallback path; patreon-dl is more accurate when it's an option** (the URL fetch reads structured metadata, the screenshot path infers from pixels). Requires Ollama running separately on the host with the chosen model pulled — see **Running in production** below.

## Other features

- **File browser + rename** with embedded ID3 / FLAC / MP4 metadata. Two tabs: **Library** (your curated archive under `LIBRARY_PATH`) and **Downloads** (ingest staging under `DOWNLOAD_PATH`, with a pending-count badge so forgotten downloads don't sit unnoticed). Live search by filename, folder, or both inside the active tab. Direct rename only on `.mp3` / `.flac` / `.ogg` (formats with embeddable tags); other formats convert first.
- **Move to library** (optional) — every selected file in the work area carries a `Move to library` collapsible with a folder-tree picker rooted at `LIBRARY_PATH`. Drill into subfolders, create new ones inline, optionally apply the generated filename during the move, then commit.
- **Browse files** — the `Browse` button in the FileBrowser toolbar opens a right-side Sheet with a persistent left rail that switches between `LIBRARY_PATH` and `DOWNLOAD_PATH` in one click. Both roots share the same selection model: single-click selects, double-click activates (drill folder / open file), Shift- and Ctrl/Cmd-click extend, drag-select rubber-bands a rectangle (auto-scrolls near edges), Ctrl/Cmd+A selects every visible row; **F2** renames the hovered row, **Del** deletes (or the whole selection). In **Library**: **N** opens New folder, **Ctrl/Cmd+X** cuts the selection, **Ctrl/Cmd+V** pastes — folders included, with cycle protection and partial-success reporting via `POST /api/move/batch`. **Downloads** omits Cut/Paste and New folder by design — it's transient staging, not a target for new structure. Typing in the filter searches the current subtree recursively via `GET /api/files/search?subdir=…`; right-click anywhere brings up the Sheet's own context menu. The Sheet preserves its position (active root + current subfolder) across opens, and works in every deployment (host, devcontainer, Unraid / TrueNAS / Proxmox Docker) because it's an in-app component, not a subprocess into the host's file manager.
- **Audio conversion** via `ffmpeg` to mp3 / flac / ogg with quality presets. Batch mode for multiple files at once.
- **Tag vocabulary + suppressed terms** — persistent SQLite dictionary, with canonical forms and optional aliases. The full vocabulary is injected into the LLM prompt so the screenshot workflow uses your tag forms instead of inventing its own. Suppressed terms are dropped from output silently. Tag chips in the editor that aren't in the dictionary render with a warm-amber tint; right-click one to add it as a new canonical or as an alias of an existing entry without leaving the rename flow.
- **Dictionary tester** — paste raw post text to preview how it'd be normalised against the current vocabulary; quick-add buttons for unrecognised tags. Uses the same Ollama backend as Workflow 3 — skip if you only use Workflows 1 + 2.
- **Dual output formats** — dash separator (filesystem-safe) or pipe separator (for metadata / descriptions).
- **Light / dark theme** — follows OS preference on first visit, persists user choice afterwards.
- **Browser extension** (optional, in [`extension/`](extension/)) — MV3 for Chromium and Firefox 121+. One click syncs your Patreon and Google session cookies to the backend so `patreon-dl` and the headless-Chromium Drive scrape can authenticate. Replaces the manual DevTools copy/paste — that's the extension's entire job.
- **Dictionary import / export** as portable JSON.

## Project structure

```
├── .devcontainer/          # VS Code dev container (Ubuntu + uv + Node + Chromium)
├── .github/workflows/      # CI: build_check.yml (lint + build + tests), release.yml
├── .claude/                # Project rules, skills, agents, hooks (see CLAUDE.md)
├── backend/
│   ├── main.py             # FastAPI routes + Ollama integration
│   ├── database.py         # SQLite schema, defaults, helpers (no ORM)
│   ├── patreon_fetch.py    # subprocess wrapper around patreon-dl
│   ├── drive_fetch.py      # Playwright-driven Drive ingest
│   ├── audio_utils.py      # shared URL-clean + filename-derive helpers
│   ├── tests/              # pytest suite (pure helpers)
│   ├── pyproject.toml
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/     # PatreonPanel, ScreenshotPanel, FileBrowser, …
│   │   ├── hooks/
│   │   ├── lib/            # api.ts, parser.ts, types.ts, audio-formats.json
│   │   └── lib/__tests__/  # vitest suite
│   └── vite.config.ts
├── extension/              # optional MV3 browser extension
├── data/                   # SQLite db lives here on the host (git-ignored)
├── .env.example
├── dev.sh / dev.bat        # start both servers in parallel
├── Dockerfile
└── docker-compose.yml
```

## Running in production

### Prerequisite: Ollama (only if using Workflow 3)

The screenshot → LLM workflow needs Ollama running on the host with the vision model pulled. Workflows 1 and 2 don't touch Ollama; skip this if you only use Patreon URLs and Drive downloads.

```bash
# Install Ollama from https://ollama.com, then:
ollama pull qwen2.5vl:7b
```

### 1. Create a `.env`

`docker-compose.yml` reads **two required host paths** from a `.env` file in the project root: `LIBRARY_PATH` (your curated audio archive) and `DOWNLOAD_PATH` (ingest staging where patreon-dl, Drive, and external-audio downloads land). Without them the bind mounts can't resolve and `docker compose up` fails. Copy the template and edit:

```bash
cp .env.example .env
# then edit LIBRARY_PATH (curated archive) and DOWNLOAD_PATH (ingest staging)
```

Recommended split:

```
LIBRARY_PATH=/home/you/Music/ASMR
DOWNLOAD_PATH=/home/you/asmr-downloads
```

Both paths are **required** and must point at **different** directories (the backend errors on startup if either is unset or they're the same path). The template lists every supported variable with defaults; only `LIBRARY_PATH` and `DOWNLOAD_PATH` are required.

**Upgrading from a single-`LIBRARY_PATH` setup**: point `DOWNLOAD_PATH` at your old `LIBRARY_PATH` location (so existing downloads keep working as Downloads-tab content) and set `LIBRARY_PATH` to a fresh curated archive. Nothing is moved automatically; the Move-to-library flow inside the app is how you file existing downloads into the new structure.

### 2. Run

**Option A — build locally:**

```bash
docker compose up --build
```

**Option B — pull the published GHCR image:**

Releases are published to `ghcr.io/unseensnick/asmr-curator:latest` (and `:<version>`). To run that image instead of building, set the `image:` key in `docker-compose.yml`:

```yaml
services:
    asmr-tool:
        image: ghcr.io/unseensnick/asmr-curator:latest
        # remove the `build:` block
```

> Releases prior to v2.0.4 were published under the old repo slug at `ghcr.io/unseensnick/asmr-filename-gen` — those tags stay reachable but receive no new builds.

Then:

```bash
docker compose pull
docker compose up
```

Open **http://localhost:8000**. The dictionary database is created and seeded automatically on first boot and lives in `./data/` on your host — it survives rebuilds and restarts.

## Running in the devcontainer

The devcontainer reads the same `.env` at the repo root that production reads, via `docker-compose.dev.yml`. Setup is the same as production: `cp .env.example .env`, edit `LIBRARY_PATH` and `DOWNLOAD_PATH` (both required, distinct paths), optionally override `OLLAMA_BASE_URL` / `OLLAMA_MODEL` / `DRIVE_*`. No personal data ever ends up in tracked files.

> **Opening the devcontainer**: install the VS Code [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers), then open this folder and run **"Dev Containers: Reopen in Container"** from the command palette (or click the floating notification VS Code shows on first open). VS Code brings up the `dev` service from `docker-compose.dev.yml` (which builds from `.devcontainer/Dockerfile`) and drops you into a shell inside the container. The commands below all assume you're inside it.

The dev compose defaults `OLLAMA_BASE_URL` to `http://host.docker.internal:11434` — that reaches Ollama running on the developer's workstation via Docker Desktop's host loopback (Win/Mac built-in, Linux via `extra_hosts`). If your Ollama runs on a different LAN host, override `OLLAMA_BASE_URL` in `.env`.

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

### Tests

Both test suites run on every push via `.github/workflows/build_check.yml`. To run locally:

```bash
cd frontend && npm test              # Vitest — parser.ts (the LLM-response parser)
pytest -c backend/pyproject.toml     # Pytest — backend pure-Python helpers
```

Test scope is intentionally limited to pure functions — anything that needs a live Patreon API, Playwright browser, Ollama, or the LIBRARY_PATH bind-mount is out of scope. Adding a new pure helper? Drop a test under `backend/tests/test_*.py` or `frontend/src/lib/__tests__/`; the existing files are short and pattern-match.

## Building the frontend

The production Docker image runs only Uvicorn — it serves the pre-built Vite output from `frontend/dist/`. To build:

```bash
cd frontend && npm run build
```

The `docker-compose.yml` build step handles this automatically.

## Contributing

Contributions welcome. The full conventions live in [`CLAUDE.md`](CLAUDE.md) and the path-scoped rules under [`.claude/rules/`](.claude/rules/); the short version:

- **Commits** follow conventional-commit format (`feat:` / `fix:` / `docs:` / `chore:` / `refactor:` / `build:`). No `Co-Authored-By` watermarks.
- **CHANGELOG** — every code change adds a bullet under `## [Unreleased]` in `CHANGELOG.md` (categories: Additions, Changes, Fixes, Other). Lead with the user-visible effect; keep each bullet to 1–3 sentences.
- **Tests** — see the Tests section above. Pure-helper coverage is expected for new helpers; integration-test infrastructure isn't part of the project.
- **Line endings** — CRLF repo-wide (`.gitattributes`). LF exceptions for `dev.sh` and `.claude/hooks/*.sh` (Linux exec).
- **CI gate** — `build_check.yml` runs lint + build + tests on every push. Green PRs only.

## API Reference

Interactive docs at **http://localhost:8000/docs** (Swagger UI, auto-generated).

### Extraction

| Method | Path                | Description                                       |
| ------ | ------------------- | ------------------------------------------------- |
| POST   | `/api/extract`      | Send a base64 image → get title + tags from Ollama (capped at 32 MB base64 / ≈ 24 MB binary; rejected with 413 if exceeded) |
| POST   | `/api/preview-tags` | Send raw text → preview how the LLM would tag it  |

### Patreon download

| Method | Path                            | Description                                                                                          |
| ------ | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/api/settings/patreon-cookie`  | Cookie status — `{ set: bool, length: number }`                                                       |
| PUT    | `/api/settings/patreon-cookie`  | Save the Patreon cookie. Accepts `application/json` (`{"cookie":"..."}`) or raw `text/plain` body     |
| POST   | `/api/patreon/fetch`            | Fetch a Patreon post or creator URL via `patreon-dl`. Request: `{ "url": "...", "metadata_only"?: false, "content_types"?: ["audio"], "published_after"?: "YYYY-MM-DD", "published_before"?: "YYYY-MM-DD", "dry_run"?: false }`. Response: `{ output_dir, count, metadata_only, dry_run, posts: [{post_id, title, tags, artist, post_dir, audio_path, external_links}] }`. `external_links` lists third-party file-host URLs (Drive / Mega / MediaFire / Dropbox) found in the post body. Audio files land at `DOWNLOAD_PATH/<creator>/<post_id> - <post_title>/<original_filename>` (flattened out of patreon-dl's nesting); patreon-dl's own tree + status DB stay isolated under `DOWNLOAD_PATH/.patreon-dl/`. Legacy `<post_id>/<file>` paths from before the layout change are still resolved by the cached-sidecar fast path. `content_types` defaults to `["audio"]`; allowed: `audio` / `video` / `image` / `attachment` / `external`. Both single-post and creator URLs in `metadata_only` mode short-circuit through a cached-sidecar fast path (creator matching uses the campaign vanity from the sidecar with a slugified-artist fallback) |
| POST   | `/api/patreon/ingest-external-audio` | Download a signed third-party audio URL into `DOWNLOAD_PATH/<creator>/<post_id> - <title>/` when `artist` or `title` is supplied (legacy `<post_id>/` otherwise). Request: `{ "post_id": "12345", "source_url": "https://...", "filename"?: "optional.mp3", "title"?, "artist"?, "album"?, "album_artist"? }`. Streams via `httpx` to a `.part` temp file, renames on success |
| POST   | `/api/patreon/ingest-drive-link` | **Server-side Drive scrape.** Returns a `text/event-stream` with progress events (`launching_browser` → `loading_page` → `waiting_for_player` → `captured` → `downloading` → `done`/`error`; contested requests get a `queued` stage with `ahead` count). Headless Chromium loads the Drive viewer with your synced Google cookie, captures the first `videoplayback?…` URL on a recognised Drive host, prefers `itag=140` (m4a audio) over `itag=134` (mp4 video) with a 5 s grace window, strips `ump`/`range`/`srfvp`, streams the body to disk in bounded-memory chunks. Sign-in redirects fail fast with `code="auth_expired"`. Request: `{ "post_id": "12345", "drive_url": "https://drive.google.com/file/d/<ID>/view", "filename"?: "optional.m4a" }`. Response: `{ audio_path, size, source_url, file_id }` |
| GET    | `/api/settings/google-cookie`   | Status — `{ set: bool, count: number, length: number }` (never the values) |
| PUT    | `/api/settings/google-cookie`   | Store a Google session cookie array. Body: `{ "cookies": [...] }` where each entry is a `chrome.cookies.getAll`-style object. Empty array clears |

#### Setting the Patreon cookie

The Patreon URL panel and the `/api/patreon/fetch` endpoint both require a session cookie since `patreon-dl` is a cookie-driven scraper (no Patreon API key exists for this use case). Three ways to set it:

- **Browser extension (easiest)** — install the MV3 extension from `extension/`, log into patreon.com (and google.com for Drive) in the same browser, and click the floating "Sync cookies" pill (or use the toolbar popup). See [`extension/README.md`](extension/README.md).
- **In the UI** — open the Settings dropdown → **Manage cookies** → paste the cookie value into the Patreon textarea → **Save cookie**. The Cookies modal includes a step-by-step DevTools walkthrough.
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

### File Browser, Rename, Move, Mkdir

Every file endpoint accepts a `root` parameter (`"library"` for `LIBRARY_PATH`, `"downloads"` for `DOWNLOAD_PATH`; defaults to `"library"`). The FileBrowser tabs send the appropriate value automatically; the move flow always targets `"library"` for its destination.

| Method | Path                | Description                                                                         |
| ------ | ------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/api/files`        | List files and subdirectories at `<root>/subdir` (one level). Query: `subdir`, `root` |
| GET    | `/api/files/search` | Recursively search all audio/video files under `<root>`; supports `q`, `search_in`, `root`. Hidden / cache dirs pruned; capped at 500 (response includes `truncated: true` when the cap is hit) |
| GET    | `/api/files/debug`  | Diagnostic endpoint — shows what's visible at the chosen root to troubleshoot mounts. Query: `root` |
| POST   | `/api/rename`       | Rename a file in place (same parent directory). Body: `{ path, new_name, root, metadata? }`. Only `.mp3` / `.flac` / `.ogg` (formats with embeddable metadata) can be renamed directly; other formats must be converted first |
| POST   | `/api/mkdir`        | Create a subfolder under `LIBRARY_PATH/<parent>/`. Body: `{ subdir, parent? }`. Scoped to `LIBRARY_PATH` only — `DOWNLOAD_PATH` is transient and not curated. Returns 409 on name collision |
| POST   | `/api/move`         | Move a file **or folder** from `from_root` (library or downloads) into a `LIBRARY_PATH/<to_subdir>/` folder, optionally renaming during the move. Body: `{ from_path, from_root, to_subdir, new_name? }`. Uses `shutil.move` (cross-mount safe). Folder moves include a cycle check — pasting a folder into itself returns 400. Returns 409 on name collision at the destination — no silent overwrites |
| POST   | `/api/move/batch`   | Move many files/folders into one `LIBRARY_PATH/<to_subdir>/` in a single request. Body: `{ items: [{ from_path, new_name? }], from_root, to_subdir }`. Returns `text/event-stream` with per-item progress (`started` / `item` / final `complete`). Each move runs in a worker thread so cross-mount batches don't block the event loop; the `complete` payload (`{ moved, results: [{ from_path, ok, to_path?, error? }] }`) is partial-success-friendly so one collision doesn't abort the rest. Drives the Library explorer's Ctrl/Cmd+X → Ctrl/Cmd+V cut/paste flow |
| POST   | `/api/delete`       | Delete a file or folder under the chosen root. Body: `{ path, root, recursive? }`. Files unlink (single target). Empty folders `rmdir`. Non-empty folders return 409 with `{ count, path }` when `recursive=false`; pass `recursive=true` (after a user prompt) for `shutil.rmtree`. Refuses to delete the root itself |
| POST   | `/api/rename-path`  | Rename a file or folder in place (same parent directory). Body: `{ path, new_name, root }`. Distinct from `/api/rename` — that one is file-only and combines the rename with optional ID3/FLAC/MP4 metadata embed; this one handles any path (folders, any extension) without the metadata step. Drives the Library explorer's right-click Rename + F2 shortcut |

`/api/files/search` accepts `search_in=filename` (default), `search_in=folder`, or `search_in=both`.

### System

| Method | Path                   | Description                                                |
| ------ | ---------------------- | ---------------------------------------------------------- |
| GET    | `/api/system/info`     | `{ model, version }` — Ollama model and app version       |

**Note**: All file endpoints require both `LIBRARY_PATH` and `DOWNLOAD_PATH` to be set and mounted.

### Audio Conversion

| Method | Path                    | Description                                                                                          |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/api/convert/formats`  | List supported output formats and quality levels (sourced from `frontend/src/lib/audio-formats.json`) |
| POST   | `/api/convert`          | Re-encode a file with `ffmpeg`. Request: `{ "path": "...", "output_format": "mp3"\|"flac"\|"ogg", "quality": "low"\|"standard"\|"high"\|"best"\|"lossless", "root"?: "library"\|"downloads", "delete_original": false }` |

### Supported Audio/Video Formats

**Rename + metadata embed** (`.mp3` `.flac` `.ogg`) — direct rename, optional ID3/Vorbis tags.

**Needs conversion first** (`.wav` `.wma` `.mp4` `.mov` `.avi` `.mkv` `.webm` `.m4a` `.aac`) — visible in the file browser; convert via `/api/convert` to a renameable format before renaming.

The full list is the single source of truth at [`frontend/src/lib/audio-formats.json`](frontend/src/lib/audio-formats.json) and is read by both the UI and the backend.

## Configuration

All runtime configuration is via environment variables. Production reads them from `.env` (gitignored) at the project root; docker-compose passes them through to the container. The devcontainer reads its own values from `.devcontainer/devcontainer.json` (also gitignored — see "Running in the devcontainer").

| Variable | Default | Required? | Purpose |
| --- | --- | --- | --- |
| `LIBRARY_PATH` | — | **Yes** (host side); `/mnt/audio` (container side, set automatically) | Host path to your **curated audio library**. docker-compose bind-mounts it into the container at `/mnt/audio`; the FileBrowser's Library tab reads from there, and the optional Move-to-library step writes there. Must point at a different directory from `DOWNLOAD_PATH`. |
| `DOWNLOAD_PATH` | — | **Yes** (host side); `/mnt/downloads` (container side, set automatically) | Host path to **ingest staging**. docker-compose bind-mounts it into the container at `/mnt/downloads`; patreon-dl, Drive scrape, and external-audio downloads land here. The FileBrowser's Downloads tab surfaces what's waiting to be moved into the library. Must point at a different directory from `LIBRARY_PATH`. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | No | Ollama server endpoint. Only relevant for the Screenshot → LLM workflow. |
| `OLLAMA_MODEL` | `qwen2.5vl:7b` | No | Vision model name. Must be pulled in Ollama (`ollama pull <model>`). |
| `DRIVE_SCRAPE_CONCURRENCY` | `1` | No | How many concurrent Drive scrapes are allowed per Google account. Default `1` serialises them to dodge Google's mid-playback cookie rotation; raise only if you're scraping different accounts and accept that concurrent rotations may corrupt downloads. |
| `DRIVE_BROWSER_IDLE_TIMEOUT_S` | `300` (5 min) | No | How long the shared Chromium stays alive between Drive scrapes before being idle-closed. Longer = faster repeat scrapes, more RAM held. |
| `DRIVE_DOWNLOAD_TIMEOUT_S` | `14400` (4 h) | No | Max time per Drive download. Default covers a 3-hour file at ~37 KB/s. Raising above ~5 h is pointless: Drive's signed-URL expiry kicks in around 6 h regardless. |
| `DB_PATH` | `/data/dictionary.db` (container) / `<repo>/data/dictionary.db` (Windows host) | No | SQLite location. Don't change unless you also adjust the corresponding bind-mount in `docker-compose.yml` — overriding alone puts the DB at a non-persisted path. |
| `PATREON_DL_BIN` | `patreon-dl` | No | patreon-dl binary name / path. Almost never needs changing (installed globally in the Docker image). |

To change any non-required setting in production, uncomment and edit the matching line in `.env`. The `${VAR:-default}` pattern in `docker-compose.yml` keeps the defaults applied when `.env` has no entry.

## Backup & Restore

### Dictionary

- **Export**: Click **Export JSON** in the Dictionary modal → saves a portable JSON file
- **Import**: Click **Import JSON** → replaces the entire dictionary from a JSON file
- **Raw backup**: Copy `./data/dictionary.db` — it's a plain SQLite file that persists across container rebuilds

### File Renaming

The **File to Rename** section lets you:

1. Search your audio library by filename, folder, or both using the live search with debouncing
2. Select a file from the results list
3. Choose a separator — dash (filesystem-safe) or pipe (for metadata)
4. Preview the new filename with byte-length indicator (255-byte limit enforced)
5. Click **Rename File** to apply the change on the server
