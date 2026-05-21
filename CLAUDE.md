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
- Backend helpers: `backend/{database,audio_metadata,patreon_fetch,drive_fetch,audio_utils}.py`. Shared validators + env paths live in `backend/main.py`.
- Frontend shared logic: `frontend/src/lib/` (`parser.ts`, `api.ts`, `types.ts`, `audio-formats.json`). Components are one-per-file under `frontend/src/components/`.
- Full architecture overview + request flow diagram: [`.claude/rules/architecture.md`](.claude/rules/architecture.md).

## Critical project-specific rules

- **LLM-response parsing lives in `frontend/src/lib/parser.ts`** (client-side). Do not move it to the backend or duplicate it in components.
- **Version lockstep:** `frontend/package.json` and `backend/pyproject.toml` `version` must always match. Bumped only during the PR-prep commit (see `.claude/rules/release-prep.md`).
- **All colors and CSS custom properties belong in `frontend/src/index.css`** — never inline hex/oklch in components.
- **Line endings: CRLF**, enforced by `.gitattributes`. `dev.sh` and `.claude/hooks/*.sh` are LF-excepted.

## Rules index

Topic-scoped detail lives in `.claude/rules/`. Read the matching file before touching its domain:

| Topic | File |
| --- | --- |
| Architecture, request flow, module responsibilities | [architecture.md](.claude/rules/architecture.md) |
| Security (path validation, cookie handling, subprocess argv, payload caps) | [security.md](.claude/rules/security.md) |
| Frontend (Tailwind / shadcn / lib separation, a11y) | [frontend.md](.claude/rules/frontend.md) |
| Database (sqlite helpers, schema location, seeding) | [database.md](.claude/rules/database.md) |
| Error handling (boundaries, banners, recoverability) | [error-handling.md](.claude/rules/error-handling.md) |
| Code quality (naming, file org, anti-defaults) | [code-quality.md](.claude/rules/code-quality.md) |
| Testing (real implementations, one-assertion, no flake retries) | [testing.md](.claude/rules/testing.md) |
| Commits / CHANGELOG / docs / dep audits | [project-workflow.md](.claude/rules/project-workflow.md) |
| Release prep (the atomic PR-prep commit) | [release-prep.md](.claude/rules/release-prep.md) |

## Agents and skills

Specialised reviewers in [`.claude/agents/`](.claude/agents/) — invoke when the task matches:

- `frontend-designer` — before any `frontend/src/**` change. Enforces design conventions for Tailwind/shadcn so output doesn't drift to generic AI aesthetics.
- `security-reviewer` — for changes under `backend/routes/`, anything touching the cookie store, ffmpeg / patreon-dl argv, or Playwright. Also for `extension/` changes.
- `code-reviewer` — diff review, PR review, post-change verification.
- `doc-reviewer` — README / CHANGELOG / docstring edits; cross-references docs against actual source.
- `performance-reviewer` — hot paths, data processing, API endpoints.

Workflow skills in [`.claude/skills/`](.claude/skills/) (`context-budget`, `debug-fix`, `explain`, `impeccable`, `pr-review`, `refactor`, `setupdotclaude`, `ship`, `tdd`, `test-writer`) — invoke by name when the task matches.

## Hooks active in this repo

Configured in [`.claude/settings.json`](.claude/settings.json):

- **PreToolUse:** `scan-secrets.sh`, `protect-files.sh`, `block-dangerous-commands.sh`, `warn-large-files.sh` — block writes containing secrets, edits to protected paths, destructive shell commands, and >500-line file writes.
- **SessionStart:** `session-start.sh` — prints branch + dirty state at session start.
- **Notification / Stop:** `notify.sh` — desktop ping when a long action lands.
- **PostToolUse:** `format-on-save.sh` — auto-formats edited files via Prettier / Ruff.

If a hook blocks an action, fix the underlying issue rather than bypassing it. `--no-verify` and `-c commit.gpgsign=false` are off-limits without explicit user approval.
