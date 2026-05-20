# CLAUDE.md

Self-hosted tool for organising a local ASMR library. Pulls audio from Patreon (including Drive-hosted files) and writes consistent filenames against a tag dictionary you control. React/Vite frontend, FastAPI backend, SQLite dictionary, optional Chrome extension.

## Commands

```bash
# Dev (inside devcontainer)
bash dev.sh                       # Linux/devcontainer (or dev.bat on Windows host)

# Lint / format / build / test
cd frontend && npm run lint && npm run format:check && npm run build && npm test
ruff check backend --config backend/pyproject.toml
ruff format --check backend --config backend/pyproject.toml
pytest -c backend/pyproject.toml

# Production (host-side, not in devcontainer)
docker compose up --build         # Serves everything on :8000
```

## Source map

- Backend routes: `backend/routes/{system,extract,files,convert,settings,patreon,dictionary}.py` (registered by `backend/main.py`).
- Frontend shared logic: `frontend/src/lib/` (`parser.ts`, `api.ts`, `types.ts`, `audio-formats.json`). Components are one-per-file under `frontend/src/components/`.

## Critical project-specific rules

- **LLM-response parsing lives in `frontend/src/lib/parser.ts`** (client-side). Do not move it to the backend or duplicate it in components.
- **Version lockstep:** `frontend/package.json` and `backend/pyproject.toml` `version` must always match. Bumped only during the PR-prep commit (see `.claude/rules/project-workflow.md`).
- **All colors and CSS custom properties belong in `frontend/src/index.css`** — never inline hex/oklch in components.
- **Before any `frontend/src/**` change, invoke the `anthropic-skills:frontend-design` skill.**
- **Line endings: CRLF**, enforced by `.gitattributes`. `dev.sh` and `.claude/hooks/*.sh` are LF-excepted.

Detailed conventions and workflow rules: `.claude/rules/`.
