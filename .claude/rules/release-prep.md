---
paths:
  - "CHANGELOG.md"
  - "frontend/package.json"
  - "backend/pyproject.toml"
  - "extension/CHANGELOG.md"
  - "extension/manifest.json"
---

# Release Prep (PR-prep ritual)

This rule applies **only when the user has explicitly signaled** they're ready to cut a release. Trigger phrases: *"ready to PR"*, *"cut x.y.z"*, *"let's open the PR"*, *"prepare the release"*. Detection lives in `project-workflow.md`. If you're touching these files for any other reason (mid-feature changelog bullet, dependency-driven manifest edit), STOP — this rule does not apply.

## The atomic PR-prep commit

When the trigger is given, do **exactly three things in one commit**:

1. Rename `## [Unreleased]` in `CHANGELOG.md` to `## [x.y.z]`.
2. Insert a fresh empty `## [Unreleased]` above it for the next cycle.
3. Set `version` in **both** `frontend/package.json` **and** `backend/pyproject.toml` to the same new SemVer. They must stay in lockstep.

Commit message: `chore: release x.y.z`. Then **wait for the user** before pushing — never `git push` on your own.

### Always check the extension too

**The app and the extension are cut separately, and forgetting the extension is the known failure mode.** It happened on 2.3.0: the Firefox fixes shipped in the app's PR while `extension/CHANGELOG.md` still said `[Unreleased]`, so no extension zip went out with the release.

Before writing the app's release commit, look at `extension/CHANGELOG.md`. If its `## [Unreleased]` has any content, the extension needs cutting as well:

1. Rename `## [Unreleased]` in `extension/CHANGELOG.md` to `## [a.b.c]`, and insert a fresh empty `## [Unreleased]` above it.
2. Set `version` in `extension/manifest.json` to the same `a.b.c`.

**The extension versions independently of the app**, so `a.b.c` follows SemVer on the extension's own history and will not match the app's number. An entry under `Additions` means a minor bump; `Fixes` alone means a patch. The `Release Extension` workflow overwrites `manifest.json` from its dispatch input at build time, but the committed value is what tells a reader which version the repo is at, so keep it in step.

Whether this rides in the same commit as the app's bump or gets its own is a judgment call: same commit when the two ship together (see `585b091`), separate when the extension is cut on its own. Either way the commit message names both, for example `chore: release app 2.4.0 and extension 1.3.0`.

If `extension/CHANGELOG.md`'s `[Unreleased]` is empty, say so explicitly rather than silently skipping it. That is the whole point of this section.

## Exceptions

- **Docs- or tooling-only PRs** that don't ship in a release image can skip the version bump. In that case the PR-prep commit only does the changelog rename (or omits even that if the change isn't user-visible enough to warrant a section). Flag this explicitly so the user confirms.
- If the user later wants to amend any pre-release bullet, do it in a follow-up commit *before* `git push` — once pushed it's history.

## Releasing (after the PR is merged)

Two workflows, and **the order matters**.

1. **Release** (GitHub Actions → "Release" → Run workflow). The Version input (e.g. `1.3.0`, no `v` prefix) must match the package files. It parses the matching `CHANGELOG.md` section, builds and pushes the GHCR image, and creates a **draft** GitHub release for review.
2. **Release Extension**, only if the extension was cut above. Inputs are the extension version (e.g. `1.3.0`, matching its own `extension/CHANGELOG.md` section) and the project release tag to attach to (`v1.3.0`). It reads `extension/CHANGELOG.md`, builds the zip, and appends both to the release Release created.

Run them in that order. Release Extension only ever appends to an existing release and fails with a clear error if the tag is missing; it never creates one of its own. Re-running it for the same extension version replaces the zip and leaves the notes alone.

Expect **one** draft release carrying the extension zip. Two drafts at the same tag means something regressed in the attach step.

**One-time repo setup** (host-side, GitHub UI): Settings → Actions → General → Workflow permissions → enable "Read and write permissions" so `GITHUB_TOKEN` can push to GHCR and create releases.
