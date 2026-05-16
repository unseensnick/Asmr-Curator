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

## Documentation

After any change that alters user-visible behavior, env vars, file paths, or API surface, scan `README.md` and other docs for stale references and update them in the same change. Describe current behavior, not the journey to it — no "we tried X then switched to Y" notes.

## Versioning

Plain SemVer (`MAJOR.MINOR.PATCH`). `frontend/package.json` and `backend/pyproject.toml` `version` fields **must stay in lockstep**. The git tag `v<version>` created by `.github/workflows/release.yml` is authoritative for releases.

## Preparing a PR (trigger detection)

When the user explicitly signals they're ready to open the PR — trigger phrases *"ready to PR"*, *"cut x.y.z"*, *"let's open the PR"*, *"prepare the release"*, or similar — follow the ritual in `.claude/rules/release-prep.md`. Until then, do **not** bump versions; "almost ready" / "we should think about a PR" doesn't count.

## Devcontainer

Day-to-day development happens **inside the devcontainer** (`.devcontainer/devcontainer.json`). All `npm` / `uvicorn` / `python` commands assume that environment. `docker compose up --build` is for the **host**, not the devcontainer (no Docker-in-Docker).

## Line endings

CRLF (`\r\n`) repo-wide, enforced by `.gitattributes` (`* text=auto eol=crlf`) and `.vscode/settings.json`. LF exceptions: `dev.sh` and `.claude/hooks/*.sh` (Linux executes them; the kernel reads `#!/bin/bash\r` literally and exec fails). When creating new files via any tool, save with CRLF unless they're shell scripts run on Linux.
