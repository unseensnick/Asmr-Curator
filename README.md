# ASMR Filename Generator

Self-hosted tool for generating formatted ASMR filenames from screenshots via OCR, with a persistent SQLite tag dictionary.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML/JS, Tesseract.js OCR, Material Icons |
| Backend | Python 3.12+, FastAPI, Uvicorn |
| Database | SQLite — single file, zero config |
| Container | Docker + Compose |

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

## Running in production

```bash
docker compose up --build
```

Open **http://localhost:8000**. The dictionary database is created and seeded automatically on first boot and lives in `./data/` on your host — it survives rebuilds and restarts.

## Running in the devcontainer

1. Open the project in VS Code
2. **Reopen in Container** (devcontainer builds automatically)
3. In the integrated terminal:

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend
```

4. VS Code forwards port 8000 automatically — open **http://localhost:8000**

Edit `backend/*.py` → uvicorn reloads in ~1s. Edit `frontend/index.html` → just refresh the browser.

## API reference

Interactive docs at **http://localhost:8000/docs** (Swagger UI, auto-generated).

| Method | Path | Description |
|---|---|---|
| GET | `/api/dictionary` | Full dictionary (all tables) |
| GET/POST | `/api/pills` | Known phrases |
| DELETE | `/api/pills/{id}` | Remove a phrase |
| GET/POST | `/api/synonyms` | Synonyms |
| DELETE | `/api/synonyms/{id}` | Remove a synonym |
| GET/POST | `/api/variants` | Variants |
| DELETE | `/api/variants/{id}` | Remove a variant |
| GET/POST | `/api/splitfixes` | Split fix patterns |
| DELETE | `/api/splitfixes/{id}` | Remove a split fix |
| PUT | `/api/dictionary` | Bulk import (replaces everything) |
| POST | `/api/dictionary/reset` | Reset to built-in defaults |

## Backup & restore

- **Export**: click **Export JSON** in the Tag Dictionary modal → saves a portable JSON file
- **Import**: click **Import JSON** → replaces the entire dictionary from a JSON file
- **Raw backup**: just copy `./data/dictionary.db` — it's a plain SQLite file
