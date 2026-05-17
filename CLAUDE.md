# CLAUDE.md

Self-hosted tool that turns Patreon screenshots into standardised ASMR filenames via a local vision LLM. React/Vite frontend, FastAPI backend, SQLite dictionary, optional Chrome extension.

## Commands

```bash
# Dev (both servers, parallel)
bash dev.sh                       # Linux/devcontainer
dev.bat                           # Windows host

# Or separately
cd frontend && npm run dev        # Vite on :5173
uvicorn backend.main:app --reload # FastAPI on :8000 (docs at /docs)

# Build & lint
cd frontend && npm run build      # tsc -b + Vite production build
cd frontend && npm run lint       # ESLint

# Tests (CI runs both on every push)
cd frontend && npm test           # Vitest — parser.ts (add more as you go)
pytest -c backend/pyproject.toml  # Pytest — backend pure-Python helpers

# Production (host-side, not in devcontainer)
docker compose up --build         # Serves everything on :8000
```

## Critical project-specific rules

- **LLM-response parsing lives in `frontend/src/lib/parser.ts`** (client-side). Do not move it to the backend or duplicate it in components.
- **Version lockstep:** `frontend/package.json` and `backend/pyproject.toml` `version` must always match. Bumped only during the PR-prep commit (see `.claude/rules/project-workflow.md`).
- **All colors and CSS custom properties belong in `frontend/src/index.css`** — never inline hex/oklch in components.
- **Before any `frontend/src/**` change, invoke the `anthropic-skills:frontend-design` skill.**
- **Line endings: CRLF**, enforced by `.gitattributes`. `dev.sh` and `.claude/hooks/*.sh` are LF-excepted.

Detailed conventions and workflow rules: `.claude/rules/`.
