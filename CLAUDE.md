# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

> **Devcontainer note.** Day-to-day development happens **inside the devcontainer** (`.devcontainer/devcontainer.json`). The container provides Node via volta, Python via uv, the audio mount at `/mnt/audio`, and runs as `devuser` in `/workspaces/asmr-filename-gen`. All `npm` / `uvicorn` / `python` commands below assume that environment. The `docker compose up --build` production command is meant to run on the **host**, not inside the devcontainer (Docker-in-Docker is not configured).

### Development

```bash
# Start both frontend (port 5173) and backend (port 8000) in parallel
bash dev.sh          # Linux/Mac (and inside the devcontainer)
dev.bat              # Windows host

# Or separately:
cd frontend && npm run dev
uvicorn backend.main:app --reload
```

### Frontend

```bash
cd frontend
npm run dev       # Vite dev server on :5173
npm run build     # TypeScript check + Vite production build → frontend/dist/
npm run lint      # ESLint
npm run preview   # Serve production build locally
```

### Backend

```bash
uvicorn backend.main:app --reload   # Hot-reload on backend/ changes
# API docs: http://localhost:8000/docs
```

### Docker (production, host-side)

```bash
docker compose up --build   # Serves everything on :8000
```

> Requires a `.env` file with at least `AUDIO_PATH` set. See `.env.example`.

## Architecture

This is a self-hosted tool for generating standardized ASMR filenames from Patreon post screenshots using a local vision LLM (Ollama).

### Request Flow

1. User pastes/uploads a screenshot in the React UI
2. Frontend base64-encodes it and POSTs to `/api/extract`
3. Backend sends the image to Ollama (`qwen2.5vl` by default) with a structured prompt
4. The raw LLM JSON response is returned to the frontend
5. `frontend/src/lib/parser.ts` parses the response — title splitting (pipe or parenthetical format) and tag normalization happen client-side
6. Tags are matched against the vocabulary dictionary (fetched from `/api/dictionary`)
7. The final filename is assembled in the UI and optionally applied via `/api/rename`

### Frontend (`frontend/src/`)

- **`App.tsx`** — Root layout: dark mode, global state (dict, extracted tags, selected file), orchestrates all panels
- **`lib/parser.ts`** — All LLM response parsing logic: title/tag extraction, pipe vs. parenthetical splitting, alias normalization
- **`lib/api.ts`** — Thin `fetch` wrapper (GET/POST/PUT/PATCH/DELETE); all API calls go through here
- **`lib/types.ts`** — Shared TypeScript interfaces (`VocabEntry`, `AppDict`, `FileEntry`, etc.)
- **`lib/audio-formats.json`** — Canonical list of supported audio extensions and output formats; shared between UI and backend startup

Components are colocated in `components/` with one component per file. No state management library — state lives in `App.tsx` and is passed as props.

### Backend (`backend/`)

- **`main.py`** — All FastAPI routes. No separate router files; everything is defined inline. Key route groups:
    - `/api/extract` / `/api/preview-tags` — Ollama integration (vision LLM)
    - `/api/dictionary`, `/api/vocabulary/*`, `/api/suppressed/*` — Dictionary CRUD
    - `/api/files*` — File browser rooted at `AUDIO_ROOT`
    - `/api/rename` — File rename + optional ID3/FLAC/MP4 metadata write via `mutagen`
    - `/api/convert` — Audio conversion via `ffmpeg` subprocess
    - `/` — SPA fallback serving `frontend/dist/index.html`
- **`database.py`** — SQLite schema, seeding (84 default tags, 8 suppressed terms), and all CRUD helpers. No ORM.

### Dev vs. Production

In **dev**, Vite proxies `/api/*` to `http://localhost:8000` (configured in `vite.config.ts`). Frontend and backend run as separate processes.

In **production** (Docker), a multi-stage build compiles the React app and copies `frontend/dist/` into the Python image. FastAPI serves both the SPA and the API from port 8000.

`frontend/src/lib/audio-formats.json` is copied into the production image at `frontend/src/lib/audio-formats.json` so the backend can read it at startup.

### Environment Variables

| Variable          | Default                  | Purpose                                                       |
| ----------------- | ------------------------ | ------------------------------------------------------------- |
| `AUDIO_ROOT`      | —                        | Root path for the file browser (required for file operations) |
| `DB_PATH`         | `/data/dictionary.db`    | SQLite database location                                      |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server endpoint                                        |
| `OLLAMA_MODEL`    | `qwen2.5vl:7b`           | Vision model for extraction                                   |

In Docker, `AUDIO_ROOT=/mnt/audio` and the host path is bind-mounted via `AUDIO_PATH` in `.env`.

## Versioning Convention

The project uses plain SemVer (`MAJOR.MINOR.PATCH`). Two files hold the version and **must stay in lockstep**:

- `frontend/package.json` — `version` field
- `backend/pyproject.toml` — `version` field

The git tag created by `.github/workflows/release.yml` (`v<version>`) is authoritative for releases; the package files are the developer-facing source of truth between releases. When syncing changes that warrant a new version, bump both files together to the next SemVer.

## Development Workflow

### Changelog

After completing any code change (feature, fix, or other), update `CHANGELOG.md`:

- Add a bullet under `## [Unreleased]`, using the categories `Additions`, `Changes`, `Fixes`, `Other`.
- If `## [Unreleased]` does not exist, create it immediately above the most recent version entry.
- **Do not add a new entry** for iterative changes or fixes to something already listed in `[Unreleased]` — that item was never released, so mid-development churn is noise. Update the existing bullet or leave it unchanged.
- **Do NOT rename `[Unreleased]` to a version number while a feature branch is in progress.** That rename is part of PR-prep and lives in **Preparing a PR** below. Until then everything stays under `[Unreleased]`, accumulating bullets as work lands.

### Documentation

After any change that alters user-visible behavior, env vars, file paths, or API surface, scan `README.md` and any other docs for stale references and update them in the same change. Describe the current behavior, not the journey to it — no "we tried X then switched to Y" notes, no descriptions of temporary workarounds that have since been removed. Refrain from rewriting already-released CHANGELOG entries; those are a historical record.

### Commits

**After every change, create a git commit — do not push.** This applies to every code, docs, or config change once it is complete. Pushing to the remote requires explicit user approval; never run `git push` (or `git push --force`, etc.) on your own. Use conventional commit format matching the project's existing style:

- `feat:` / `feat(scope):` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code restructuring with no behavior change
- `chore:` — build / tooling
- `build:` — packaging / Docker / dependencies

**Never add the Claude Code watermark to commit messages.** Do not include `🤖 Generated with [Claude Code]…`, `Co-Authored-By: Claude <noreply@anthropic.com>`, or any similar attribution line. Commit messages should contain only the conventional-commit subject and (optionally) a plain body — nothing else.

### Pushing

`git push` (and any of its destructive variants — `--force`, `--force-with-lease`, deleting remote branches) requires **explicit user approval every time**. Never run it on your own. Apart from that, see **Preparing a PR** below for the version-bump rule.

### Preparing a PR

The `[Unreleased] → [x.y.z]` rename in `CHANGELOG.md` and the `frontend/package.json` + `backend/pyproject.toml` version bumps are a **single atomic PR-prep step**, performed in **one commit**, **only when the user explicitly signals they're ready to open the PR**. Trigger phrases: *"ready to PR"*, *"cut x.y.z"*, *"let's open the PR"*, *"prepare the release"*, or similar.

Until that signal is given:

- Every change still updates `[Unreleased]` per the Changelog rule above.
- `frontend/package.json` and `backend/pyproject.toml` stay at whatever version is currently on `main`. They are **not** bumped speculatively.
- "Almost ready" / "we should think about a PR" / similar **does not count** as the signal. Ask if it's ambiguous.

When the signal is given, the PR-prep commit does exactly three things:

1. Rename `## [Unreleased]` in `CHANGELOG.md` to `## [x.y.z]`.
2. Insert a fresh empty `## [Unreleased]` above it for the next cycle.
3. Set `frontend/package.json` `version` and `backend/pyproject.toml` `version` to the same new SemVer.

Commit message: `chore: release x.y.z`. Then **wait for the user** before pushing, and confirm the actual PR open separately. If the user later wants to amend any pre-release bullet, do it in a follow-up commit *before* `git push` — once pushed it's history.

**Docs- or tooling-only PRs** that don't ship in a release image can skip the version bump. In that case the PR-prep commit only does the changelog rename (or omits even that if the change isn't user-visible enough to warrant a section). Flag this explicitly so the user can confirm.

### Releasing via GitHub Actions

Releases are built and published by `.github/workflows/release.yml`.

**To trigger a release:** GitHub → Actions → "Release" → Run workflow

- **Version:** e.g. `1.3.0` (no `v` prefix, must match `frontend/package.json` / `backend/pyproject.toml`)
- **Message:** optional header shown at the top of the release notes

The workflow parses the matching section from `CHANGELOG.md`, builds the production Docker image, pushes it to GHCR (`ghcr.io/unseensnick/asmr-filename-gen:<version>` and `:latest`), and creates a **draft** GitHub release with the changelog body and a `docker pull` snippet. Go to the Releases tab to review and publish.

**One-time repo setup** (host-side, in GitHub UI): Settings → Actions → General → Workflow permissions → enable "Read and write permissions" so `GITHUB_TOKEN` can push to GHCR and create releases.

## Code Style & Conventions

### Line endings

All text files in this repo use **CRLF (`\r\n`) line endings** — Windows-style. Enforced by:

- `.gitattributes` — `* text=auto eol=crlf` normalises every commit.
- `.vscode/settings.json` — `"files.eol": "\r\n"` is the editor default for this workspace.

When creating new files (whether via VSCode, Claude tooling, or other editors), they **must** be saved with CRLF endings. Don't introduce LF-ending files; mixed line endings in the same repo create spurious diffs and confuse tooling on Windows. If a tool emits LF by default, convert before committing.

### Frontend changes

When building or restyling UI components or pages (anything in `frontend/src/`), invoke the `anthropic-skills:frontend-design` skill **before writing code**. The skill enforces design-quality conventions for Tailwind/shadcn projects and avoids generic AI aesthetics.

### Tailwind CSS

- Use `size-*` instead of paired `w-* h-*` when width and height values are identical (e.g., `size-4` not `w-4 h-4`).
- Apply responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`) consistently — design mobile-first and layer breakpoints upward.
- **All colors and custom CSS variables — new and existing — belong in [`frontend/src/index.css`](frontend/src/index.css).** If a color is currently hardcoded in a component (inline style, arbitrary Tailwind value, or raw hex/oklch), migrate it to a CSS custom property there. Define tokens under `:root` and `.dark` following the shadcn/ui convention (e.g., `--my-token: oklch(...)`) and expose them via `@theme inline` so Tailwind can reference them as `bg-my-token`. Every token must be legible in both light and dark mode — verify contrast in both themes before committing.

### Engineering Principles

- **DRY (Don't Repeat Yourself):** If the same logic appears in two or more places, extract it. On the frontend, shared logic lives in `lib/` (e.g., `parser.ts`, `api.ts`); on the backend, shared helpers belong in `database.py` or a dedicated utility module — not duplicated across route handlers in `main.py`.

- **KISS (Keep It Simple, Stupid):** Prefer the simplest solution that satisfies the requirement. Avoid premature abstraction, clever one-liners that obscure intent, or adding indirection (extra hooks, wrapper components, middleware) that isn't immediately necessary.

- **YAGNI (You Aren't Gonna Need It):** Only build what the current task requires. Do not speculatively add config flags, optional parameters, or extension points for features that don't exist yet.

- **SOLID (adapted to this stack):**
    - _SRP:_ Each module has one job. `parser.ts` parses LLM output — it should not fetch data. `api.ts` calls the API — it should not transform response shapes. Route handlers in `main.py` handle HTTP concerns — business logic belongs in helpers.
    - _OCP:_ Extend behavior through new functions, components, or route handlers rather than modifying existing stable ones. Adding a new audio format means updating `audio-formats.json`, not touching conversion logic.
    - _LSP:_ TypeScript interfaces in `types.ts` are contracts — implementations must satisfy them fully. Avoid partial implementations that require callers to check for missing fields.
    - _ISP:_ Keep component props and function signatures narrow. Don't pass entire state objects when only one field is needed; don't merge unrelated concerns into a single hook or helper.
    - _DIP:_ Components depend on the `api.ts` abstraction, not raw `fetch`. Backend routes depend on `database.py` helpers, not inline SQL. If a dependency needs to change, swap the implementation behind the abstraction.

- **Separation of Concerns (SoC):** Respect the existing boundaries: LLM response parsing is client-side in `parser.ts`; HTTP I/O is in `api.ts`; shared types are in `types.ts`; file/metadata operations are backend-only in `main.py`. Do not blur these layers (e.g., no parsing logic in components, no business logic inlined in route handlers).

- **Law of Demeter:** Components should talk to their immediate collaborators only. A tag component should not reach into the global dictionary to resolve an alias — the resolved value should be passed down as a prop. Route handlers should call a `database.py` helper, not chain multiple DB calls inline.

- **Code for Readability:** Write code for humans, not machines. Use descriptive names for variables, functions, and components (`extractTitleFromResponse` not `doExtract`). Keep functions and components small — if a function needs a comment to explain what it does, it should probably be split or renamed.

- **Continuous Refactoring:** Improve code quality incrementally alongside feature work rather than deferring it to a dedicated cleanup sprint. When touching a file, fix obvious issues in the immediate area — a poorly named variable, a duplicated condition, a hardcoded color. Don't refactor unrelated areas in the same commit (Boy Scout Rule: leave it cleaner than you found it).

- **No standalone refactor/cleanup sprints:** Refactoring must be done in small increments alongside the feature or fix that motivated it — only touch what the task requires. Never propose a separate "cleanup pass" as a follow-up PR unless the user explicitly asks for one.

- **Minimal blast radius:** A bug fix should change only what is broken. A feature should add only what is specified. Leave surrounding code that works untouched, even if it could be "improved."

### Avoiding Duplication

- **Search before creating.** Before adding a component, utility, hook, or helper, verify no equivalent exists in the codebase. Prefer extending what's there over introducing a parallel implementation.
- **Single source of truth.** Every piece of logic, configuration, or data should live in exactly one place and be imported wherever needed. Duplicated constants, types, or logic are a bug waiting to happen.
- **Extract shared abstractions.** When two or more callsites share the same logic, consolidate into a single reusable function or component. If the callsites differ in behavior, parameterize the differences (via props, arguments, or options) rather than forking the implementation.

