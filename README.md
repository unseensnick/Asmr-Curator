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
│   ├── .gitignore
│   └── README.md
├── frontend/
│   └── index.html          # entire frontend in one file
├── data/
│   └── dictionary.db       # auto-created on first run (git-ignored)
├── Dockerfile              # production app image
└── docker-compose.yml
```

## Features

- **OCR-based filename generation**: Extract text from screenshots and auto-format ASMR filenames
- **Tag dictionary**: Persistent SQLite database with phrases, synonyms, variants, and split-fix patterns
- **File browser & rename**: Server-side file browsing and renaming (supports audio and video files)
- **Dual output formats**: Generate filenames with dash or pipe separators
- **Import/export**: Backup and restore dictionary as JSON

## Running in production

```bash
docker compose up --build
```

Open **http://localhost:8000**. The dictionary database is created and seeded automatically on first boot and lives in `./data/` on your host — it survives rebuilds and restarts.

To enable file browsing and renaming, set `AUDIO_ROOT` environment variable in `docker-compose.yml` pointing to your audio library directory.

## Running in the devcontainer

1. Open the project in VS Code
2. **Reopen in Container** (devcontainer builds automatically)
3. In the integrated terminal:

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend
```

4. VS Code forwards port 8000 automatically — open **http://localhost:8000**

Edit `backend/*.py` → uvicorn reloads in ~1s. Edit `frontend/index.html` → just refresh the browser.

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
| POST   | `/api/pills`            | Add a phrase                                                            |
| DELETE | `/api/pills/{id}`       | Remove a phrase                                                         |
| POST   | `/api/synonyms`         | Add a synonym                                                           |
| DELETE | `/api/synonyms/{id}`    | Remove a synonym                                                        |
| POST   | `/api/variants`         | Add a variant                                                           |
| DELETE | `/api/variants/{id}`    | Remove a variant                                                        |
| POST   | `/api/splitfixes`       | Add a split fix pattern                                                 |
| DELETE | `/api/splitfixes/{id}`  | Remove a split fix                                                      |
| PUT    | `/api/dictionary`       | Bulk import (replaces everything)                                       |
| POST   | `/api/dictionary/reset` | Reset to built-in defaults                                              |
| GET    | `/api/synonyms`         | Read all synonyms                                                       |

### File Browser & Rename Endpoints

| Method | Path                | Description                                                                          |
| ------ | ------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/api/files`        | List files and subdirectories at AUDIO_ROOT/subdir (one level only)                  |
| GET    | `/api/files/search` | Recursively search all audio/video files, optionally filtered by query string        |
| GET    | `/api/files/debug`  | Diagnostic endpoint — shows what's visible at AUDIO_ROOT (troubleshoot mount issues) |
| POST   | `/api/rename`       | Rename a file, with filename length validation                                       |

**Note**: File browser requires `AUDIO_ROOT` environment variable to be set and properly mounted.

### Supported Audio/Video Formats

The file browser recognizes these extensions: `.mp3`, `.wav`, `.flac`, `.aac`, `.ogg`, `.m4a`, `.wma`, `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`

## Backup & Restore

### Dictionary Backup/Restore

- **Export**: Click **Export JSON** in the Tag Dictionary modal → saves a portable JSON file
- **Import**: Click **Import JSON** → replaces the entire dictionary from a JSON file
- **Raw backup**: Copy `./data/dictionary.db` — it's a plain SQLite file that persists across container rebuilds

### File Renaming

The **File to Rename** section allows you to:

1. Search your audio library by filename
2. Select a file from the results
3. Generate a new filename using the OCR dictionary combined with your preferred separator (dash or pipe)
4. Preview the new filename with character count
5. Click **Rename File** to apply the change on the server

Filenames are validated to ensure they don't exceed filesystem limits (255 bytes UTF-8).
