# ASMR Filename Generator

Self-hosted tool for generating formatted ASMR filenames from screenshots via OCR, with a persistent SQLite tag dictionary and server-side file renaming.

## Stack

| Layer     | Tech                                              |
| --------- | ------------------------------------------------- |
| Frontend  | Vanilla HTML/JS, Tesseract.js OCR, Material Icons |
| Backend   | Python 3.12+, FastAPI, Uvicorn                    |
| Database  | SQLite — single file, zero config                 |
| Container | Docker + Compose                                  |

## Project structure

```
├── .devcontainer/
│   ├── devcontainer.json   # VS Code dev container config
│   └── Dockerfile          # dev environment image (Ubuntu + uv + volta)
├── backend/
│   ├── main.py             # FastAPI routes
│   ├── database.py         # SQLite queries + default seeding
│   ├── pyproject.toml      # project metadata + dependencies
│   ├── requirements.txt
│   ├── uv.lock             # dependency lock file
│   ├── .python-version     # Python version pinning
│   └── .gitignore
├── frontend/
│   ├── index.html          # markup
│   ├── app.js              # all frontend logic (OCR, parser, dictionary UI, file browser)
│   └── styles.css          # styles
├── data/
│   └── dictionary.db       # auto-created on first run (git-ignored)
├── Dockerfile              # production app image
└── docker-compose.yml
```

## Features

- **OCR-based filename generation**: Paste or drag-and-drop a screenshot → Tesseract OCR extracts text → parser produces a title and ordered tag list automatically
- **Tag dictionary**: Persistent SQLite database with four table types — phrases, synonyms, variants, and split-fix patterns — all editable inline
- **Parser test pane**: Paste raw OCR text directly into the dictionary modal to preview exactly how each tag is matched, with quick-add buttons for unrecognised tokens
- **File browser & rename**: Recursive server-side file browser with live search (filter by filename, folder, or both), file selection, and one-click rename
- **Dual output formats**: Generate filenames with dash separator (filesystem-safe) or pipe separator (for metadata/descriptions)
- **Import/export**: Backup and restore the full dictionary as a portable JSON file

## Running in production

```bash
docker compose up --build
```

Open **http://localhost:8000**. The dictionary database is created and seeded automatically on first boot and lives in `./data/` on your host — it survives rebuilds and restarts.

To enable file browsing and renaming, set `AUDIO_ROOT` in `docker-compose.yml` to point at your audio library directory.

## Running in the devcontainer

1. Open the project in VS Code
2. **Reopen in Container** (devcontainer builds automatically)
3. In the integrated terminal:

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend
```

4. VS Code forwards port 8000 automatically — open **http://localhost:8000**

Edit `backend/*.py` → uvicorn reloads in ~1s. Edit `frontend/` files → just refresh the browser.

### Configuring the file browser

Edit `.devcontainer/devcontainer.json` and update the `mounts` section to point to your audio library:

```json
"mounts": [
  "source=/path/to/your/audio/library,target=/mnt/audio,type=bind,consistency=cached"
],
"remoteEnv": {
  "AUDIO_ROOT": "/mnt/audio"
}
```

Note: Windows users should use `source=C:\\Users\\...\\path\\to\\audio`.

## API Reference

Interactive docs at **http://localhost:8000/docs** (Swagger UI, auto-generated).

### Dictionary Endpoints

| Method | Path                    | Description                                                             |
| ------ | ----------------------- | ----------------------------------------------------------------------- |
| GET    | `/api/dictionary`       | Full dictionary with all tables (pills, synonyms, variants, splitFixes) |
| PUT    | `/api/dictionary`       | Bulk import — replaces the entire dictionary                            |
| POST   | `/api/dictionary/reset` | Reset to built-in defaults                                              |
| GET    | `/api/pills`            | List all phrases                                                        |
| POST   | `/api/pills`            | Add a phrase                                                            |
| PATCH  | `/api/pills/{id}`       | Edit a phrase                                                           |
| DELETE | `/api/pills/{id}`       | Remove a phrase                                                         |
| GET    | `/api/synonyms`         | List all synonyms                                                       |
| POST   | `/api/synonyms`         | Add a synonym (set `to_word` to `null` to suppress)                     |
| PATCH  | `/api/synonyms/{id}`    | Edit a synonym                                                          |
| DELETE | `/api/synonyms/{id}`    | Remove a synonym                                                        |
| GET    | `/api/variants`         | List all variants                                                       |
| POST   | `/api/variants`         | Add a variant                                                           |
| PATCH  | `/api/variants/{id}`    | Edit a variant                                                          |
| DELETE | `/api/variants/{id}`    | Remove a variant                                                        |
| GET    | `/api/splitfixes`       | List all split-fix patterns                                             |
| POST   | `/api/splitfixes`       | Add a split-fix pattern                                                 |
| PATCH  | `/api/splitfixes/{id}`  | Edit a split-fix pattern                                                |
| DELETE | `/api/splitfixes/{id}`  | Remove a split-fix pattern                                              |

### File Browser & Rename Endpoints

| Method | Path                | Description                                                                         |
| ------ | ------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/api/files`        | List files and subdirectories at `AUDIO_ROOT/subdir` (one level)                    |
| GET    | `/api/files/search` | Recursively search all audio/video files; supports `q` and `search_in` query params |
| GET    | `/api/files/debug`  | Diagnostic endpoint — shows what's visible at `AUDIO_ROOT` to troubleshoot mounts   |
| POST   | `/api/rename`       | Rename a file (validates filename length, path traversal, and conflicts)            |

`/api/files/search` accepts `search_in=filename` (default), `search_in=folder`, or `search_in=both`.

**Note**: All file endpoints require `AUDIO_ROOT` to be set and mounted.

### Supported Audio/Video Formats

The file browser recognizes these extensions: `.mp3`, `.wav`, `.flac`, `.aac`, `.ogg`, `.m4a`, `.wma`, `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`

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
