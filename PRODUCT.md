# Product

## Register

product

## Users

**Primary: non-technical ASMR collectors.** Someone who buys and downloads a lot of ASMR audio from Patreon (and sometimes Drive-hosted links) and wants one local library with consistent filenames. They installed this tool once (or had someone help), and now they live in the UI. They are not running terminals, they are not reading the API docs, they are reaching for a laptop at 11pm.

The scene to design for: *ASMR collector at night, headphones on, soft desk lamp, laptop or desktop in a dim room, scrolling a creator's back catalogue and queueing fetches one at a time.* Late evening, low ambient light, sleepy but focused, repetitive workflow they want to do twenty times without friction. Not a phone, not a tablet — the cookie-driven workflow (extension paste or DevTools copy) is fundamentally desktop, and the UI doesn't pretend otherwise.

**Secondary: ASMR artists organising their own released catalogue.** Use the file browser, ID3/FLAC/MP4 metadata writer, ffmpeg conversion, and the tag dictionary. They skip the Patreon-fetch and Drive-ingest workflows because they make the content, they don't collect it.

**Power-user mode (optional toggle, not a separate audience).** The same primary user, on a different day, wanting to see queue depth, raw logs, advanced filters, or environment-level toggles. Power-user mode adds capability and density; it does not add jargon. Both modes share the same visual language; switching modes never feels like switching apps.

## Product Purpose

Automate the slog of pulling ASMR audio out of Patreon and into a clean, consistently-named local library the user owns.

Three workflows feed the library: Patreon URL fetch (the accurate path), Drive scrape (when creators link out instead of uploading), screenshot LLM extraction (fallback for posts that can't be fetched). Three supporting workflows curate it: a file browser with embedded metadata writing, ffmpeg conversion, and a tag dictionary the user shapes over time.

Success looks like: paste a URL, get a tagged audio file with a clean filename in seconds; do that twenty times in a row without friction; never feel like you are using *software*. The tool gets out of the way. The library feels like the user's, not the tool's.

Self-hosted, no cloud, no telemetry, no account. The user's machine, the user's files.

## Brand Personality

**Three words: calm, considered, quiet personality.**

The chrome is utility-shaped: clean, minimal, focused. Personality lives in the seams — how the app talks to you during long tasks, what empty states feel like, the moments between actions. Not chatty. Not corporate. Human, in the way Tailscale's admin dashboard is human or Raycast's empty states are.

Voice is low-key and informative. Status messages narrate what's happening clearly enough that the user knows the app is working, not stuck. Errors are plain-English and actionable. The app never shows off about the heavy work happening underneath (Playwright launches, signed URLs, vision models, ffmpeg pipelines), but it doesn't go silent either — long-running tasks (creator-wide patreon-dl fetches) get progressive narration, not just a single label.

Emotional goal: *quiet competence with character*. The feeling of a personal tool that knows what it is. Closer to Tailscale + Raycast than to Linear or Notion. The "library of your own" framing is the aspirational direction; it earns its place through how the app behaves, not through visual flourish.

## Anti-references

Things this should not look or feel like:

- **Spotify / commercial music app.** Sterile near-black surface with a saturated green accent, big album-art grids, mass-market commercial energy. Wrong shelf.
- **Audacity / pro-audio DAW.** Cold-grey utilitarian chrome, info-dense toolbars, engineer-first density. Wrong audience.
- **Linear / Notion / generic productivity SaaS.** Cold-blue palette, gradient logo, "team workspace" framing, **and the soulless-modern-app trap of minimal-without-personality.** The default training-data reflex for "app." Avoid hard. This is the lane the current UI is closest to and the one we're trying to escape — minimal chrome is fine, but personality should live somewhere.
- **Adult-content aggregator codes.** The content this app organises is sometimes intimate, but the librarian UI for it should not borrow the visual codes of NSFW-aggregator sites (free-tube layouts: aggressive red/orange/black palettes, dense thumbnail grids, hard contrast, heavy-tab navigation, saturated "click here NOW" hover states). A user with someone walking past their screen should be able to read the app as "file organiser" or "audio tool," not "adult site." Stays warm and architectural, never lurid.
- **Jargon leak.** No `itag`, `CDP`, `signed URL`, `Playwright`, `metadata_only`, `dry_run` surfaced as UI vocabulary. Internal concepts get plain-English labels or disappear into a tooltip.

## Design Principles

1. **The librarian, not the DJ.** The mental model is a personal home library: sort, label, file, keep. Not a music app: recommend, rank, perform. When a design choice could go either way, choose the library.

2. **Quiet competence over performance.** Heavy work runs underneath (subprocess scrapes, LLM calls, conversion). The UI never shows off about it. No console logs in the user's face, no chatty spinners, no progress narration for trivial actions. Progress lands where the user is already looking, then goes away.

3. **Translate, never expose.** Every technical concept the backend cares about gets a plain-English surface or no surface at all. Power-user mode unlocks more controls, more density, more filters; it does not unlock more vocabulary.

4. **Designed for dim desks.** Default viewing context is low ambient light, late evening, laptop or desktop (not phone, not tablet). Warmth over coolness, generous type over compact, never harsh highs, never thin strokes. Light and dark are both first-class — the same character lives in both. (Defaults to dark because the late-evening scene assumes low ambient light, but a daytime user gets the full system in light mode.)

5. **Personality in the seams, not the chrome.** The chrome stays utility-shaped: minimal, clean, predictable. Personality earns its place in long-task narration, empty-state copy, status feedback, and the occasional signature treatment. Add character where it tells the user something they didn't already know — never decoratively. Long-running fetches (e.g., creator-wide patreon-dl runs) get progressive feedback, not a single static label, so the user always knows the app is working rather than stuck.

6. **Built for the desktop, including the wide end.** Standard 1080p monitors, but also ultrawide aspect ratios as first-class viewports: 21:9 (3440×1440), 32:9 (5120×1440), 5K ultrawide (5120×2160), 8K ultrawide (7680×2160). The grid scales into available room rather than hard-capping at SaaS-default 1280–1536px widths. A user on a 5K ultrawide should see a system that grows into their screen, not centred whitespace flanked by ten inches of background.

## Accessibility & Inclusion

- **WCAG AA on both themes** (4.5:1 body, 3:1 large text and non-text UI), with extra care on dark mode since it ships as the default surface but never at the cost of light-mode parity.
- **Low-light optimised.** Warm-tinted neutrals, reduced blue, no `#fff` or near-white highlights against the dark surface. Avoid the bright-white-card-on-dark-background pattern that bleeds in dim rooms.
- **Generous defaults for imperfect eyesight.** Base body type larger than the SaaS default (16px floor, never below). Touch targets at least 44×44px because interaction precision varies (cursor + mouse, trackpad, accessibility tools) — not because we expect tablet/touch as a primary input. No tiny icon-only controls without labels or aria text.
- **Color is never the only signal.** Success / warning / error / info always carry an icon or text label alongside the color.
- **Respect `prefers-reduced-motion`.** Strip the staggered fade-ins and any non-essential motion when the OS asks. Functional motion (drawer slide, focus ring) stays.
- **Keyboard-navigable end-to-end.** Visible focus states on both themes. Every interactive element reachable without a mouse.
