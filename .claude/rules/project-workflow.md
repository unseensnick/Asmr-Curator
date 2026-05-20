---
alwaysApply: true
---

# Project Workflow

## Commits

After every code, docs, or config change, create a git commit — **do not push.** Pushing requires explicit user approval every time; never run `git push` (or its destructive variants) on your own.

Use conventional commit format:

- `feat:` / `feat(scope):` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code restructuring with no behavior change
- `chore:` — build / tooling
- `build:` — packaging / Docker / dependencies

**Never add the Claude Code watermark to commit messages.** No `🤖 Generated with [Claude Code]…`, no `Co-Authored-By: Claude <noreply@anthropic.com>`, no similar attribution. Commit messages contain only the conventional-commit subject and (optionally) a plain body.

## Changelog

After completing any code change, add a bullet under `## [Unreleased]` in `CHANGELOG.md` using categories `Additions`, `Changes`, `Fixes`, `Other`. Create `[Unreleased]` if missing, immediately above the most recent version entry.

- **Do not add a new entry** for iterative changes to something already listed in `[Unreleased]`. Update the existing bullet or leave it.
- **Do NOT rename `[Unreleased]` to a version number while a feature branch is in progress.** That rename is part of PR-prep below.
- **Do not rewrite already-released CHANGELOG entries** — those are a historical record.

### Write for release notes, not for yourself

`[Unreleased]` becomes the GitHub release draft — it's read by users skimming "what changed in this version", not by the person who wrote it. Write accordingly:

- **Lead with the user-visible effect** ("Click Download on a Drive link in a Patreon post…") or the surface area touched (`POST /api/patreon/ingest-drive-link …`). The first half-line should answer *what changed* — not *why* or *how*.
- **Keep each bullet to 1-3 sentences.** A single coherent change, not the implementation journey.
- **Avoid:** CDP / HTTP-protocol detail, internal phase numbering, class names (`_FooBar` / `_ANCHOR_RE`), regex patterns, "we tried X then switched to Y" narratives, debugging history, CDN-fingerprint trivia, env-var defaults the user never sets, Playwright internals, what failed-before vs works-now. Implementation context belongs in commit messages — they have the room.
- **When in-flight iteration grows a bullet past ~3 sentences,** trim it back to its current user-facing essence on the next iteration. Don't keep appending — the changelog isn't a dev journal.

If you're not sure whether a detail belongs: imagine a Patreon-creator user reading the release notes on the GitHub Releases page. Would this sentence help them understand what's different in the app, or is it for the person who debugged it?

## Documentation

After any change that alters user-visible behavior, env vars, file paths, or API surface, scan `README.md` and other docs for stale references and update them in the same change. Describe current behavior, not the journey to it — no "we tried X then switched to Y" notes.

- **After adding or renaming a backend route**, run `backend/.venv/bin/python scripts/check_api_docs.py` (inside the devcontainer) and add a row under the matching `### <Group>` table in README's `## API Reference` if the check reports drift. CI runs the same check on every push — running it locally avoids finding out at release time.
- **Before pushing a dep bump**, run `pip-audit` (backend, inside the devcontainer via `uv tool run pip-audit --requirement requirements.txt`) and `npm audit --audit-level=high` (frontend). Same checks CI runs — local catches a known CVE before it surfaces as a red PR.

## Versioning

Plain SemVer (`MAJOR.MINOR.PATCH`). `frontend/package.json` and `backend/pyproject.toml` `version` fields **must stay in lockstep**. The git tag `v<version>` created by `.github/workflows/release.yml` is authoritative for releases.

## Preparing a PR (trigger detection)

When the user explicitly signals they're ready to open the PR — trigger phrases *"ready to PR"*, *"cut x.y.z"*, *"let's open the PR"*, *"prepare the release"*, or similar — follow the ritual in `.claude/rules/release-prep.md`. Until then, do **not** bump versions; "almost ready" / "we should think about a PR" doesn't count.

## Devcontainer

Day-to-day development happens **inside the devcontainer** (`.devcontainer/devcontainer.json`). All `npm` / `uvicorn` / `python` commands assume that environment. `docker compose up --build` is for the **host**, not the devcontainer (no Docker-in-Docker).

## Line endings

CRLF (`\r\n`) repo-wide, enforced by `.gitattributes` (`* text=auto eol=crlf`) and `.vscode/settings.json`. LF exceptions: `dev.sh` and `.claude/hooks/*.sh` (Linux executes them; the kernel reads `#!/bin/bash\r` literally and exec fails). When creating new files via any tool, save with CRLF unless they're shell scripts run on Linux.
