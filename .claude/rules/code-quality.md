---
alwaysApply: true
---

# Code Quality

## Anti-defaults (counter common Claude tendencies)

- No premature abstractions. Three similar lines beats a helper used once.
- Don't add features or improvements beyond what was asked.
- Don't refactor adjacent code while fixing a bug.
- No dead code or commented-out blocks. Git has history.
- WHY comments, never WHAT. If code needs a "what" comment, rename instead.
- API docs at module boundaries only, not every internal function.

## Naming

- **Frontend files:** PascalCase for React components (`PatreonPanel.tsx`), lowercase single-word for utilities (`parser.ts`, `api.ts`, `types.ts`).
- **Backend files:** snake_case Python (`main.py`, `database.py`, `patreon_fetch.py`).
- Booleans: `is` / `has` / `should` / `can` prefix. Functions: verb-first (`getUser`, `extract_tags`). Handlers: `handle*` internal, `on*` as props.
- Factories: `create*`. Converters: `to*`. Predicates: `is*` / `has*`. Constants: `SCREAMING_SNAKE`.
- Abbreviations only when universally known (`id`, `url`, `api`, `db`). Acronyms as words: `userId`, not `userID`.

## Code Markers

`TODO(author): desc (#issue)` for planned work. `FIXME(author): desc (#issue)` for known bugs. `HACK(author): desc (#issue)` for ugly workarounds (explain the proper fix). `NOTE: desc` for non-obvious context. Owner and issue link required. Never `XXX`, `TEMP`, `REMOVEME`.

## File Organization

- Imports: builtins, external, internal, relative, types. Blank line between groups.
- Exports: named over default. One component or class per file (`frontend/src/components/` is one-component-per-file).
- Function order: public API first, then helpers in call order.

## Project-specific principles

- **Search before creating.** Before adding a component, utility, hook, or helper, verify no equivalent exists. Frontend shared logic lives in `frontend/src/lib/`; backend shared helpers belong in `backend/database.py` or a dedicated utility module — not duplicated across route handlers in `main.py`.
- **Continuous refactoring, never standalone refactor sprints.** Improve quality incrementally alongside feature work — fix obvious issues in the immediate area you're already touching. Don't propose a separate "cleanup pass" PR unless the user explicitly asks for one.
- **Minimal blast radius.** A bug fix changes only what is broken. A feature adds only what is specified. Leave surrounding code that works untouched, even if it could be "improved."
- **Single source of truth.** `frontend/src/lib/audio-formats.json` is canonical for supported formats (read by both the UI and the backend at startup). The SQLite schema lives in `backend/database.py`. CSS tokens live in `frontend/src/index.css`. Don't fork these.
