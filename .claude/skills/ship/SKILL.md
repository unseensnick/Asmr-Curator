---
name: ship
description: Scan changes, commit, push, and create a PR. With confirmation at each step
argument-hint: "[optional commit message or PR title]"
disable-model-invocation: true
allowed-tools:
  - Bash(git status)
  - Bash(git diff *)
  - Bash(git log *)
  - Bash(git add *)
  - Bash(git commit *)
  - Bash(git push *)
  - Bash(git checkout *)
  - Bash(git branch *)
  - Bash(gh pr create *)
  - Bash(gh pr view *)
---

Ship the current changes through commit, push, and PR creation. Confirm with the user before each step using the AskUserQuestion tool.

## Step 1: Scan

- Run `git status` to see all changed, staged, and untracked files
- Run `git diff` to see what changed (staged + unstaged)
- Run `git log --oneline -5` to see recent commit style
- Present a clear summary to the user:
  - Files modified
  - Files added
  - Files deleted
  - Untracked files
- If there are no changes, tell the user and stop

## Step 2: Stage & Commit

- Propose which files to stage. **Never stage** these:
  - Secrets: `.env*`, `*.pem`, `*.key`, `credentials.json`
  - Lock files: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` (unless intentionally updated)
  - Generated: `*.gen.ts`, `*.generated.*`, `*.min.js`, `*.min.css`
  - Build output: `dist/`, `build/`, `.next/`, `__pycache__/`
  - Dependencies: `node_modules/`, `vendor/`, `.venv/`
  - OS/editor: `.DS_Store`, `Thumbs.db`, `*.swp`, `.idea/`, `.vscode/settings.json`
- Draft a commit message in **conventional-commit format** (`feat:` / `feat(scope):` / `fix:` / `docs:` / `chore:` / `refactor:` / `build:`), matching the repo's existing commit style. Keep the subject under 72 chars.
- **No watermark in commits**: no `Co-Authored-By: Claude …` line, no `🤖 Generated with [Claude Code]` footer, no similar AI attribution. Only the conventional subject + an optional plain body. (`.claude/rules/project-workflow.md` enforces this — restated here so it doesn't drift.)
- **ASK the user to confirm or edit**: show the exact files to stage and the proposed commit message
- Only after confirmation: stage the files and create the commit
- If the commit fails (e.g., pre-commit hook), fix the issue and try again with a NEW commit

## Step 3: Push

- Check if the current branch has an upstream remote
- If not, propose creating one with `git push -u origin <branch>`
- **ASK the user to confirm** before pushing
- Only after confirmation: push to remote

## Step 4: Pull Request

- Check if a PR already exists for this branch (`gh pr view`. If it exists, show the URL and stop)
- Analyze ALL commits on this branch vs the base branch (not just the latest commit)
- Draft a PR title (under 72 chars) and body with **only** a Summary section:
  - **Summary**: 2-4 bullets describing what changed for users — ideally mirror the relevant CHANGELOG bullets that landed in this PR. Lead with user-visible effect.
  - **No `## Test plan` section.** The CHANGELOG already states user-visible effect; the commits already describe implementation. A test plan in the PR body bloats the surface and rarely gets read on a solo-maintained repo.
  - **No `🤖 Generated with [Claude Code]` footer**, no Co-Authored-By, no AI-generated attribution.
- Create the PR with `gh pr create --base main` (the `--base main` is defensive — `gh` can default to a stale base if the previous PR on this branch targeted something else). The repo is a single-remote project so no `--repo` flag is needed.
- **ASK the user to confirm or edit** the title and body
- Only after confirmation: run the `gh pr create` command
- Show the PR URL when done

## Rules

- NEVER skip a confirmation step. Each step requires explicit user approval
- NEVER force-push
- NEVER commit .env, secrets, or credential files
- If the user says "skip" at any step, skip that step and move to the next
- If $ARGUMENTS is provided, use it as the commit message / PR title
