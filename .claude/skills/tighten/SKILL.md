---
name: tighten
description: Trim verbose prose, walls of text, journey narration, and WHAT comments from docs and code without losing vital info. Targets markdown files (README, CLAUDE.md, rules, skills, agents) and, when asked, code comments / docstrings. Applies the "WHY not WHAT" rule, the "describe current behavior not the journey" rule, and the "release notes not implementation rationale" rule from `.claude/rules/project-workflow.md` and `.claude/rules/code-quality.md`. Use after a feature lands and the docs around it have accumulated cruft, or when a file feels heavier than it earns. Always plans before editing.
argument-hint: "<file or directory path>"
disable-model-invocation: true
allowed-tools:
  - Bash(git *)
  - Read
  - Edit
  - Grep
  - Glob
---

Tighten the file(s) at `$ARGUMENTS` so a maintainer or contributor skimming them learns the same things in less time, with no vital info lost. **This skill always enters plan mode before editing.** It never deletes content silently.

## When to use this

- A `.md` file (`README.md`, `CLAUDE.md`, `.claude/rules/*.md`, `.claude/skills/*/SKILL.md`) has grown a wall of text or a journey paragraph that no longer serves readers.
- Comments or docstrings in a recently-touched file restate the code instead of explaining the WHY.
- A `[Unreleased]` CHANGELOG section reads like implementation notes instead of release notes. This is the most common case in this repo: [.claude/rules/project-workflow.md](../../rules/project-workflow.md) warns that in-flight iteration grows a bullet past three sentences, and it needs trimming back to its user-facing essence.
- A `Handoff.md` accumulated mid-development churn (drafts, false starts, deferred-then-completed items) and needs a "what actually shipped" pass.

Do NOT use this for:

- Released CHANGELOG entries. Those are a historical record per [.claude/rules/project-workflow.md](../../rules/project-workflow.md).
- Code refactoring (use `/refactor`).
- A whole-repo sweep without a clear motivating change. That is the "no standalone refactor sprints" rule from [.claude/rules/code-quality.md](../../rules/code-quality.md).
- Files you've never read in this session, on a hunch. Tighten responds to a known problem, not a guess.

## Step 1: Scope and read

Parse `$ARGUMENTS` for the target. If it's a directory, list the files you'll consider with `git ls-files` so the user sees the scope. If it's a single file, read it in full.

Reject the run early if any of these apply:

- The path points inside a released CHANGELOG section. Tell the user; suggest pointing at the `[Unreleased]` block instead.
- The path is a code file but the user didn't explicitly ask for comments or docstrings to be tightened. Ask before touching code.
- The path is generated or vendored: `frontend/package-lock.json`, `backend/uv.lock`, `frontend/dist/`, anything under `node_modules/`.

Pull `git log -10 -- <path>` for each target. If a file was just rewritten in the last few commits, ask the user whether it's really stale or just unfamiliar; tightening a freshly-written doc is often premature.

## Step 2: Classify every paragraph

Read the file end to end. For each paragraph, bullet, comment, or docstring block, classify it as one of:

| Class | Action |
| --- | --- |
| **Vital, well-written** | Keep verbatim. |
| **Vital, verbose** | Tighten. Keep every fact; cut filler, repetition, hedging. |
| **Vital, mis-located** | Suggest moving to the right home (implementation rationale belongs in a commit message, not an `[Unreleased]` bullet). |
| **Journey** ("we tried X then Y", "originally", "previously this was", "before the refactor") | Cut. Documentation describes current behavior, not the path taken. |
| **WHAT comment** above self-describing code | Cut. If the code is unclear, rename instead of commenting. |
| **WHY comment** with non-obvious reasoning | Keep, even if short-looking. These are the comments that matter. |
| **Redundant** (same info present in another file in scope) | Pick one canonical home; replace the duplicate with a one-line link. |
| **Dead** (TODO/FIXME with no owner, reference to resolved work, "[Coming soon]" placeholder) | Cut. Per `code-quality.md` a marker without an owner and issue link is already non-compliant. |
| **Stale** (names a function, file, route, or env var that no longer exists) | Verify with Grep/Glob; surface to user for confirmation before cutting. |

Keep a running tally per class. The plan in Step 3 cites these counts so the user can see proportions.

## Step 3: Plan before editing

Use `EnterPlanMode`. The plan structure:

1. **Scope**: file(s) targeted, total lines or paragraphs in scope, the motivating reason (one sentence). If a directory, list every file you'll touch and the per-file delta.
2. **Tally**: counts per classification from Step 2. Example: `Vital, verbose: 6 paragraphs -> tighten. Journey: 2 -> cut. WHAT comment: 3 -> cut. Redundant: 1 -> link to <canonical>. Stale: 1 -> confirm before cut.`
3. **Before / after per change**: for non-trivial edits, show the original prose and the proposed rewrite side by side. Trivial cuts (a single sentence, a dead TODO) can be listed without a diff.
4. **Open questions**: anything ambiguous. Use `AskUserQuestion` for these before exiting plan mode.
5. **Out of scope**: explicitly name what you noticed but won't touch (released CHANGELOG entries, code-level refactors, files outside the user's path).

Call `ExitPlanMode` after the user approves.

## Step 4: Apply

After approval:

- Edit with `Edit` (not `Write` for partial changes). One logical change per edit; do not batch unrelated tightenings into a single `replace_all`.
- Re-read the file when done. If the tightened version reads worse than the original (lost continuity, broken markdown, orphaned anchor), revert that specific edit and re-plan.
- Run a quick sanity grep for references other files relied on. If you cut a heading that another doc linked to, that link is now broken. `CLAUDE.md`'s rules index and skills list are the two most likely casualties.

## Step 5: Run the rules over your own output

Before finishing, grep the changed files for project anti-defaults:

- **Em dashes**: replace with commas, parentheses, periods, or colons. While you're already in the file, fix them.
- **AI watermarks**: remove any "Co-Authored-By: Claude", "Generated with Claude Code", or robot-emoji footers.
- **Register**: run the changed prose against [.claude/rules/prose-style.md](../../rules/prose-style.md). Trailing significance clauses and inflated vocabulary are exactly what a tightening pass should be removing.

## Step 6: Verify and hand off

- For markdown: read the file back. Confirm headings, list nesting, code fences, and links are intact.
- For code comments and docstrings: re-skim the surrounding function. The comment that survived should now explain something the code itself cannot.
- If a `.md` file under `.claude/` changed, confirm `CLAUDE.md` still describes it correctly.
- Summarize in conversation: files touched, paragraphs cut, tightened, and moved (and to where). One bullet per file.

Do NOT commit unless the user asks. Suggest `/ship` when they're happy.

## Rules

- Never silently delete. Every cut shows up in the plan, classified.
- Never touch a released CHANGELOG entry. `[Unreleased]` is fair game; everything below is history.
- Never edit generated or vendored files.
- Never widen scope mid-run. If the file in scope references a sibling that also needs tightening, surface it as a follow-up; do not pull it in.
- Vital info is sacred. If you can't tell whether a sentence is vital, ask; do not cut on a hunch.
- WHY not WHAT, every time. A comment that restates the code is dead weight; a comment that explains why the obvious approach was rejected is gold. This repo has both, and the `backend/drive_fetch.py` comments are the reference example of the second kind.
- Module-boundary docstrings get more room than internal helpers. `code-quality.md` puts API docs at module boundaries only, so don't over-trim the ones that serve as the contract.
- No em dashes in the rewritten prose.
- One file per Edit call when feasible.
- If the file is shorter than ~50 lines and the user invokes the skill anyway, push back once: small files rarely need a tightening pass.
