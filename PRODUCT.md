# Product

## Register

product

## Users

**Primary: non-technical ASMR collectors.** Someone who buys and downloads a lot of ASMR audio from Patreon (and sometimes Drive-hosted links) and wants one local library with consistent filenames. They installed this tool once (or had someone help), and now they live in the UI. They are not running terminals, they are not reading the API docs, they are picking up an iPad at 11pm.

The scene to design for: *ASMR collector at night, headphones on, soft bedside lamp, iPad or laptop propped at a low angle, scrolling a creator's back catalogue and queueing fetches one at a time.* Dim room, low stimulation, sleepy but focused, repetitive workflow they want to do twenty times without friction.

**Secondary: ASMR artists organising their own released catalogue.** Use the file browser, ID3/FLAC/MP4 metadata writer, ffmpeg conversion, and the tag dictionary. They skip the Patreon-fetch and Drive-ingest workflows because they make the content, they don't collect it.

**Power-user mode (optional toggle, not a separate audience).** The same primary user, on a different day, wanting to see queue depth, raw logs, advanced filters, or environment-level toggles. Power-user mode adds capability and density; it does not add jargon. Both modes share the same visual language; switching modes never feels like switching apps.

## Product Purpose

Automate the slog of pulling ASMR audio out of Patreon and into a clean, consistently-named local library the user owns.

Three workflows feed the library: Patreon URL fetch (the accurate path), Drive scrape (when creators link out instead of uploading), screenshot LLM extraction (fallback for posts that can't be fetched). Three supporting workflows curate it: a file browser with embedded metadata writing, ffmpeg conversion, and a tag dictionary the user shapes over time.

Success looks like: paste a URL, get a tagged audio file with a clean filename in seconds; do that twenty times in a row without friction; never feel like you are using *software*. The tool gets out of the way. The library feels like the user's, not the tool's.

Self-hosted, no cloud, no telemetry, no account. The user's machine, the user's files.

## Brand Personality

**Three words: cozy, calm, considered.**

Voice is low-key and human. It speaks to someone winding down, not someone at work. It does not show off about the heavy work happening underneath (Playwright launches, signed URLs, vision models, ffmpeg pipelines). Status is reassuring and brief, errors are plain-English and actionable.

Emotional goal: *quiet competence*. The feeling of a well-organised personal library, not a SaaS dashboard. Closer to a reading app or a hi-fi listening app than a productivity tool.

## Anti-references

Things this should not look or feel like:

- **Spotify / commercial music app.** Sterile near-black surface with a saturated green accent, big album-art grids, mass-market commercial energy. Wrong shelf.
- **Audacity / pro-audio DAW.** Cold-grey utilitarian chrome, info-dense toolbars, engineer-first density. Wrong audience.
- **Linear / Notion / generic productivity SaaS.** Cold-blue palette, gradient logo, "team workspace" framing. The default training-data reflex. Avoid hard.
- **Adult-content aggregator codes.** The content is intimate; the librarian UI for it should not borrow the visual codes of NSFW sites. Stays warm, never lurid.
- **Jargon leak.** No `itag`, `CDP`, `signed URL`, `Playwright`, `metadata_only`, `dry_run` surfaced as UI vocabulary. Internal concepts get plain-English labels or disappear into a tooltip.

## Design Principles

1. **The librarian, not the DJ.** The mental model is a personal home library: sort, label, file, keep. Not a music app: recommend, rank, perform. When a design choice could go either way, choose the library.

2. **Quiet competence over performance.** Heavy work runs underneath (subprocess scrapes, LLM calls, conversion). The UI never shows off about it. No console logs in the user's face, no chatty spinners, no progress narration. Progress lands where the user is already looking, then goes away.

3. **Translate, never expose.** Every technical concept the backend cares about gets a plain-English surface or no surface at all. Power-user mode unlocks more controls, more density, more filters; it does not unlock more vocabulary.

4. **Designed for dim rooms.** Default viewing context is low ambient light, late evening, possibly a tablet at arm's length, possibly imperfect eyesight. Warmth over coolness, generous type over compact, never harsh highs, never thin strokes. Light mode exists as a real option, but dark is where the personality lives.

## Accessibility & Inclusion

- **WCAG AA on both themes** (4.5:1 body, 3:1 large text and non-text UI), with extra care on dark mode since it is the default surface.
- **Low-light optimised.** Warm-tinted neutrals, reduced blue, no `#fff` or near-white highlights against the dark surface. Avoid the bright-white-card-on-dark-background pattern that bleeds in dim rooms.
- **Generous defaults for imperfect eyesight.** Base body type larger than the SaaS default (16px floor, never below). Touch targets at least 44×44px, ideally 48px on tablet-sized surfaces. No tiny icon-only controls without labels or aria text.
- **Color is never the only signal.** Success / warning / error / info always carry an icon or text label alongside the color.
- **Respect `prefers-reduced-motion`.** Strip the staggered fade-ins and any non-essential motion when the OS asks. Functional motion (drawer slide, focus ring) stays.
- **Keyboard-navigable end-to-end.** Visible focus states on both themes. Every interactive element reachable without a mouse.
