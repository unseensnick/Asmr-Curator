---
paths:
  - "CHANGELOG.md"
  - "frontend/package.json"
  - "backend/pyproject.toml"
---

# Release Prep (PR-prep ritual)

This rule applies **only when the user has explicitly signaled** they're ready to cut a release. Trigger phrases: *"ready to PR"*, *"cut x.y.z"*, *"let's open the PR"*, *"prepare the release"*. Detection lives in `project-workflow.md`. If you're touching these files for any other reason (mid-feature changelog bullet, dependency-driven manifest edit), STOP — this rule does not apply.

## The atomic PR-prep commit

When the trigger is given, do **exactly three things in one commit**:

1. Rename `## [Unreleased]` in `CHANGELOG.md` to `## [x.y.z]`.
2. Insert a fresh empty `## [Unreleased]` above it for the next cycle.
3. Set `version` in **both** `frontend/package.json` **and** `backend/pyproject.toml` to the same new SemVer. They must stay in lockstep.

Commit message: `chore: release x.y.z`. Then **wait for the user** before pushing — never `git push` on your own.

## Exceptions

- **Docs- or tooling-only PRs** that don't ship in a release image can skip the version bump. In that case the PR-prep commit only does the changelog rename (or omits even that if the change isn't user-visible enough to warrant a section). Flag this explicitly so the user confirms.
- If the user later wants to amend any pre-release bullet, do it in a follow-up commit *before* `git push` — once pushed it's history.

## Releasing (after the PR is merged)

Triggered via GitHub Actions → "Release" → Run workflow. The Version input (e.g. `1.3.0`, no `v` prefix) must match the package files. The workflow parses the matching `CHANGELOG.md` section, builds + pushes the GHCR image, and creates a **draft** GitHub release for review.

**One-time repo setup** (host-side, GitHub UI): Settings → Actions → General → Workflow permissions → enable "Read and write permissions" so `GITHUB_TOKEN` can push to GHCR and create releases.
