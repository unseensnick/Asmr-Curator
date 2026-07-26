---
alwaysApply: true
---

# Project Workflow

## Commits

After every code, docs, or config change, create a git commit. **Do not push.** Pushing requires explicit user approval every time; never run `git push` (or its destructive variants) on your own.

Write commits a user could skim and a contributor could read on. Scale the structure to the change: a typo is one line; a feature gets a body.

**Subject (always):** `type(scope): summary`

- Types: `feat` (new feature), `fix` (bug fix), `docs` (documentation only), `refactor` (restructuring, no behavior change), `chore` (build / tooling), `build` (packaging / Docker / dependencies), plus `test`, `perf`, `ci`, `style`, `revert`.
- Scope optional and lower-case (`drive`, `patreon`, `backend`, `deps`, `extension`).
- Imperative mood, lower-case, no trailing period, `<=72` chars.

**Body (omit only for trivial commits; wrap ~72 cols):**

1. **Lead** with 1-2 plain-language sentences: what changed and why it matters, readable by a non-developer. Never open with implementation detail.
2. **Bullets** for the notable changes, benefit-first and scannable. For a large commit, group them under short headers (the user-facing area first, then `Under the hood:` for internals) so a reader can stop early.
3. **Footer (optional):** tests run, deferred items, tradeoffs.

**Pre-commit checklist, run on EVERY commit.** No exceptions: this includes `docs`, `chore`, and one-line fixes. A commit that fails any line gets reworded before it lands.

1. Subject is `type(scope): summary`: a real conventional type, imperative, lower-case, no trailing period, `<=72` chars.
2. No em dashes anywhere in the message. Commas, parentheses, periods, colons.
3. No AI watermark: no `Co-Authored-By: Claude`, no `Generated with [Claude Code]`, no robot-emoji footer.
4. Non-trivial commit: body leads with 1-2 plain-language sentences, then benefit-first bullets. A trivial commit is just the compliant subject.

Example:

```
feat(drive): add a Google Drive tab, and convert-on-download everywhere

Paste a Drive link and download it without fetching the Patreon post
first. The same convert controls now sit under every download button.

Google Drive tab:
- Creator and Title are optional and only decide the destination folder.
- "Use for filename" hands both to the tag editor, like applying a post.

Under the hood:
- One convert_audio implementation in backend/audio_convert.py, shared by
  /api/convert and every ingest path.
- post_id is now optional on the Drive ingest route.
```

### Enforcement

`.githooks/commit-msg` rejects a message that breaks rules 1-3 above, and `.githooks/pre-commit` lints the staged `CHANGELOG.md` `[Unreleased]` section and the version lockstep. Both are tracked but not active until installed; on a fresh clone run:

```bash
cp .githooks/commit-msg .githooks/pre-commit .git/hooks/ && chmod +x .git/hooks/commit-msg .git/hooks/pre-commit
```

`.github/workflows/docs-lint.yml` runs the same CHANGELOG and lockstep checks in CI, so a PR is covered even when the hooks aren't installed. If a hook blocks a commit, fix the message rather than reaching for `--no-verify`.

## Changelog

After completing any code change, add a bullet under `## [Unreleased]` in `CHANGELOG.md` using categories `Additions`, `Changes`, `Fixes`, `Other`. Create `[Unreleased]` if missing, immediately above the most recent version entry.

- **Do not add a new entry** for iterative changes to something already listed in `[Unreleased]`. Update the existing bullet or leave it.
- **Do NOT rename `[Unreleased]` to a version number while a feature branch is in progress.** That rename is part of PR-prep below.
- **Do not rewrite already-released CHANGELOG entries** — those are a historical record.

### Write for release notes, not for yourself

`[Unreleased]` becomes the GitHub release draft — it's read by users skimming "what changed in this version", not by the person who wrote it. Write accordingly:

- **Lead with the user-visible effect** ("Click Download on a Drive link in a Patreon post…") or the surface area touched (`POST /api/patreon/ingest-drive-link …`). The first half-line should answer *what changed* — not *why* or *how*.
- **Keep each bullet to 1-3 sentences.** A single coherent change, not the implementation journey. Short and concise beats thorough here: a reader skimming the release page wants the effect, not the full account. `.githooks/pre-commit` and the `docs-lint` CI enforce a 420-character cap per bullet and reject em dashes in `[Unreleased]`; a bullet that trips the cap needs trimming, not splitting into two.
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
