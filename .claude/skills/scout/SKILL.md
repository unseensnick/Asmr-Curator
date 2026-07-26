---
name: scout
description: Investigate a non-trivial task, then produce the plan for it. Emits a file:line-cited findings report covering current behavior, the route/component boundary it crosses, helpers to reuse and stale docs, followed by a sequenced plan and any blocking open questions. Use before touching an unfamiliar backend route, adding an ingest path, reworking a panel, or any cross-cutting change. The point is to ground the plan in evidence, not memory. Investigates deeply and verifies adversarially by default; never edits files.
argument-hint: "<task description> (e.g., 'add a convert step to the Drive ingest', 'make bulk rename handle collisions')"
disable-model-invocation: false
allowed-tools:
  - Bash(git *)
  - Glob
  - Grep
  - Read
  - Agent
---

Investigate the task described by `$ARGUMENTS` deeply enough that the resulting plan cannot contain hallucinated functions, stale memories, or assumed framework behavior. Output is a findings report **and the plan that follows from it**. **This skill never edits files and never writes code**: it proposes, the owner approves, implementation is a separate step.

## Standing defaults (no need to ask for these)

These are the behavior on every invocation. The owner should never have to prepend them.

- **Depth.** Real investigation: open the files and verify each claim against current code. Never pattern matching, never inference from a file or symbol name. A plausible mechanism that was not read is not a finding.
- **Completeness.** Keep investigating until every unknown is resolved. Do not stop at the first coherent story, and do not fill a gap with an assumption to finish the report.
- **Open questions get asked, not guessed.** Anything that cannot be settled from the code becomes an explicit numbered question, answered before implementation starts.
- **Adversarial verification is mandatory.** Re-read the claims that would most distort the plan if wrong, including claims from `Handoff.md`, memories, and subagent findings.
- **Verify layout and shape against the real thing, not fixtures.** This repo has already shipped a bug where the unit fixtures encoded the same wrong on-disk layout the code assumed, so the tests passed and a real fetch returned nothing. When a claim is about what exists on disk or what a service returns, check `/mnt/downloads` or the live response, not only the test fixture.
- **Output format** follows [.claude/rules/plan-output.md](../../rules/plan-output.md).

## When to use this

Use `/scout` for non-trivial work where shallow context is expensive:

- Adding or reworking a backend route under `backend/routes/`, especially one that shells out to a media tool or drives Playwright.
- Adding an ingest path, or changing one that already exists (Patreon, Drive, or another source), where `audio_utils.flatten_dest_parts` and the shared validators decide the on-disk shape.
- Touching cross-cutting pieces: the validators and env paths in `backend/main.py`, the SQLite helpers in `backend/database.py`, `frontend/src/lib/` (`parser.ts`, `api.ts`, `types.ts`), or `frontend/src/index.css` tokens.
- Working in modules the recent session hasn't touched.
- Acting on a claim from memory or a `Handoff.md` that names specific files, functions, or flags.

Do NOT use `/scout` for:

- One-line tweaks, label swaps, copy edits.
- Work entirely inside a file you just edited this session.
- The "happy path" continuation of an active task (you already have the context).

If the user invokes it for trivial work, push back once and ask if they really need it. The skill costs tokens.

## Step 1: Parse and scope

Echo the task you parsed from `$ARGUMENTS` in one sentence so the user can correct misreadings before you spend agent tokens.

If the task is vague (`"fix the file browser"`, `"drive stuff"`), use `AskUserQuestion` to narrow:

- Which route, panel, or ingest path?
- Fix a behavior, add a feature, or change the on-disk shape?
- Is there a `Handoff.md` or recent commit range that frames this?

Do not proceed with a vague scope. Vague scout reports are noise.

## Step 2: Cheap reads before delegating

These run on the main thread (cheap) so the subagents you spawn next get briefed properly:

1. Check `Handoff.md` in the project root if present (untracked is fine). Note the branch, what shipped, what was deferred, and the `What Failed` section: it exists to stop a fresh session re-investigating a dead end.
2. `git log --oneline -20` for the recent shape of work.
3. Skim [.claude/rules/architecture.md](../../rules/architecture.md) for the module boundary the task crosses, and the matching topic rule (`security.md` for anything touching routes, cookies, or subprocess argv; `frontend.md` for `frontend/src/**`; `database.md` for schema).
4. Check `CHANGELOG.md` `[Unreleased]` for work already in flight on the same surface.

Write down for Step 3 (briefing the subagents):

- The task as scoped.
- The current branch and recent commit shape (one line).
- Which module owns the change per `architecture.md`.
- The deferred list from `Handoff.md`, verbatim. **The most common audit failure is flagging deferred work as missing.**

## Step 3: Identify investigation areas

Decide which of these areas the task touches. Skip the ones that don't apply, brief one Explore agent per area that does.

| Area | When relevant | What to brief |
| --- | --- | --- |
| Current code | Always | Target files, callers, callees, the route handler and its validators, tests. |
| Boundary crossing | Route/component changes | Which side owns the logic. LLM-response parsing stays in `frontend/src/lib/parser.ts`; validators and env paths stay in `backend/main.py`. |
| External process | ffmpeg, patreon-dl, Playwright | The argv construction, what the tool actually returns, and the failure modes already handled. |
| Existing helpers (DRY) | New utility tempting | Search `frontend/src/lib/` and `backend/{database,audio_utils,audio_metadata}.py` for the equivalent before letting the plan invent one. |
| Test coverage | Behavior changes, refactors | What's tested, what isn't, which test file to extend. |

For each area, spawn one `Agent` call with `subagent_type: Explore` (read-only is enough). Run them in parallel in a single message. Brief each as a smart colleague who hasn't seen this conversation:

- State the goal (what the user is going to do next).
- Hand over the exact files, paths, and git commands.
- Demand `file:line` citations for every concrete claim.
- Cap the response (~500 words is usually enough per area).
- Ask for a "things I'm uncertain about" section.

## Step 4: Adversarially verify

Explore agents locate and summarize; they do not verify. Before anything reaches the report, re-read the current code yourself for the claims that would most distort the plan if wrong. Typical kills:

- A claim that something "doesn't exist" when it moved or was renamed.
- A flagged problem the surrounding code already handles, or that cannot actually be reached.
- A finding that is on the deferred list from Step 2 rather than a real gap.
- A severity rating that does not survive reading the code around the cited line.
- **A syntax or version claim made against the wrong interpreter.** The backend requires Python >= 3.14; an agent testing under an older CPython has already reported valid 3.14 syntax as a `SyntaxError`. Check `backend/pyproject.toml` before accepting a "this doesn't compile" claim.

Verify claims inherited from `Handoff.md` and memories on the same footing as subagent claims. All of them have been wrong in this repo. Label each surviving finding **verified** (re-read) or **reported** (cited but not re-read); anything load-bearing for the plan must be verified.

## Step 5: Synthesize the report and the plan

Into the conversation, not a file unless asked, in the structure defined by [.claude/rules/plan-output.md](../../rules/plan-output.md): headline, findings graded High / Medium / Low, stale docs, the plan, open questions.

The findings still carry the areas from Step 3, now graded by importance rather than grouped by area: what current code does, which boundary constrains the approach, which existing helper the plan should reuse instead of inventing one, and what the tests cover.

Additions specific to this skill:

- **A claim that cannot cite a `file:line` from code actually read** goes in Open questions, never in Findings.
- **A source contradiction is itself a finding.** When memory or `Handoff.md` disagrees with current code, trust the code and record the contradiction under Stale docs so it can be pruned.
- **Deferred work is not a defect.** If the Step 2 descope list already covers something, say so once and move on.
- **The plan names the helper it reuses.** A step that invents a utility the repo already has is a failed scout, so cite the existing one.
- **The plan names the rule it must satisfy.** A route change cites `security.md`'s validator requirement; a `frontend/src/**` change cites `frontend.md`; a new format cites `audio-formats.json` as the single source of truth.

## Step 6: Hand off

End with one of:

1. **"Ready to implement."** Findings verified, plan complete, no blocking questions.
2. **"Open questions block implementation."** The blocking ones from the last section, asked plainly.
3. **"Investigation incomplete."** Name what is still unchecked and ask whether to spawn more agents or proceed with the gap documented.

Then stop. Do not start editing and do not call `EnterPlanMode`. The owner answers the open questions, approves the plan, and implementation follows as a separate step.

## Rules

- This skill proposes a plan but never edits files, never writes code, and never calls `EnterPlanMode`.
- Every claim cites `file:line` from current code. Memory and `Handoff.md` claims are hypotheses until cited from current code.
- If a memory or `Handoff.md` line is stale, surface it; let the user decide whether to prune.
- Never fill an unresolved gap with an assumption. Investigate it or surface it as an open question.
- Cap each subagent at ~500 words. Output follows [.claude/rules/plan-output.md](../../rules/plan-output.md), including its ~1500 word cap; a bigger task needs decomposition, not a longer report.
- No em dashes in the report. Commas, parentheses, periods, colons.
- No assumptions about library defaults. If the report relies on FastAPI, mutagen, Playwright, or ffmpeg behavior, the citation points to that library's source or to a project-side test that verifies it.
- If an Explore agent comes back vague or generic, the brief was too loose. Re-spawn with a sharper scope before synthesizing.
