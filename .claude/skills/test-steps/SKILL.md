---
name: test-steps
description: Turn a change into a checkable manual test script the owner runs in the app, not prose about testing. Reachability-verified steps grouped by precondition, one observable outcome each, with unreachable actions listed up top and known regressions flagged. Use when the user asks for test steps, a test plan, or how to verify a change by hand. This is the manual counterpart to test-writer (which writes automated pytest / vitest tests).
argument-hint: "<the change or feature to test> (e.g. 'the Drive tab convert controls', 'bulk rename collisions')"
disable-model-invocation: false
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(git *)
---

Produce a manual test script the owner can run in the app and tick through, for the change named in `$ARGUMENTS` (or the change just made, if none is named). The output is a checklist, not an essay about testing. The owner runs it against their own library; this skill never claims a step passed, since it cannot drive the UI. The in-app browser cannot reach the devcontainer's dev server, so visual confirmation is always the owner's.

## Step 0: Verify reachability first, before writing any step

This is the part that fails when skipped. Steps written from intent rather than from the code end up describing controls that aren't rendered. So read the code first and confirm each candidate action can actually be triggered in the build the owner will run.

For each action you are about to write a step for, check:

- **Is the control rendered in this panel at all?** A shared section (for example the convert controls) is passed different props by each caller, so a control can exist under the Drive tab and not under a Patreon post.
- **Is it gated behind power mode?** Power-mode-only controls (the bitrate override, for example) are invisible with it off, and the prop that threads it through defaults to `false`. A missing control is as often an unthreaded prop as a real bug.
- **Does it need a synced cookie?** Patreon fetch needs the Patreon session cookie; a Drive download needs the Google cookie. Without one, the path is not testable, and repeated Drive test downloads burn the session and trigger throttling. Pick a file that hasn't been pulled recently and don't loop downloads.
- **Does it need a fetched post, or a file already on disk?** Per-post Drive links only appear under a post that was actually fetched. Rename and metadata steps need a real audio file in the chosen root.
- **Does it depend on the root?** Library and Downloads are separate roots with different allowed operations. `mkdir` and a move's destination are Library-only.
- **Is the format actually supported?** `frontend/src/lib/audio-formats.json` is the single source of truth, and the ffmpeg presets in `backend/audio_convert.py` are narrower than the list of formats the app reads. A format in one and not the other produces a step that cannot pass.

Anything that fails this check gets no step. It goes in the `Not testable` block instead.

## The Not testable block

Put it at the very top, so the owner sees what was deliberately left out before reading the steps. Bullets, subject bolded, one clause of reason each:

```markdown
**Not testable**

- **Bitrate override under a Patreon post**: power-mode only; turn power mode on first if you want this covered.
- **Opus output**: not in the ffmpeg presets, so the format never reaches the encoder.
- **Drive re-download timing**: repeat pulls get throttled by Google, so a slow run proves nothing.
```

The reason distinguishes the cases: not reachable in code, gated behind a setting, or dependent on state the owner may not have. Omit the block entirely when everything is reachable.

## Step format

**One step, one outcome.** Every step ends in something observable. Setup with no outcome of its own folds into the step it precedes.

Two shapes, chosen by how many actions the step takes.

**Fewer than three actions:** actions on the first line, the expectation indented on the next line behind an arrow.

```
1.3 Paste a Drive link, leave Creator and Title empty, press Download
    -> file lands under the downloads root in an untitled folder
```

**Three or more actions:** a short title line, lettered sub-actions, then the indented arrow.

```
1.4 Convert on download, MP3
    a. Paste a Drive link
    b. Tick Convert after downloading, pick MP3
    c. Press Download
    -> an .mp3 arrives, and the log shows the ingest converted line
```

A blank line between steps in both shapes. The arrow line is always indented under its step and states only what the owner should see, never what they do.

## Group by precondition, not by feature

The header names the state the owner must be in, and every step under it shares that setup. Preconditions in this app are things like "Google cookie synced, power mode off", "a fetched Patreon post open", "Downloads root, one audio file selected". Sub-number as `N.M` so a group boundary is visible in the numbers.

When a change must behave the same on more than one ingest path, say so once as a group rather than duplicating every step. A short "Regression sanity" group at the end is worth including when the change reached shared code: a convert change touches all three ingest paths, and a validator change touches every route that takes a `root`.

## Flags

Put a `[!]` on a step title when it covers a known regression, a fix made this session, or a path that has broken before. Give the reason in one clause on the arrow line, nothing more.

```
2.1 [!] Rename a file, then edit a tag
    -> the hand-edited title stays put (regression: it used to reset to the generated one)
```

## Rules

- **No narration.** No "good instinct", no "let me verify", no commit hashes, no account of what was fixed. A fix earns one line in the `Not testable` reasoning or a flagged step, never a paragraph.
- **No progress log.** Do the reachability reads silently; the output is the script, not the investigation.
- **The owner runs it, not you.** Never report a step as passed or failed. Hand over the script and stop.
- Cite nothing in the output. The `file:line` reads happen in Step 0 to decide what is reachable; they do not belong in a checklist the owner ticks while using the app.
- **Name the log line when one exists.** The backend logs the ingest convert step and the Drive timing split; a step that can be confirmed from the terminal is stronger than one confirmed by eye. Quote the prefix, not the whole line.
- **Write the step and outcome lines like a human**, per [.claude/rules/prose-style.md](../../rules/prose-style.md): plain verbs, no inflated stakes, no trailing "-ing" significance clauses, no em dashes. An outcome reads "the .mp3 arrives", not "the file is created, ensuring correct conversion behaviour".
