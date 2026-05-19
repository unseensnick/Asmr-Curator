---
name: ASMR Curator
description: A penthouse reading nook for collecting, naming, and shelving ASMR audio.
colors:
  background: "oklch(0.155 0.015 265)"
  foreground: "oklch(0.918 0.012 85)"
  card: "oklch(0.198 0.018 265)"
  popover: "oklch(0.225 0.022 265)"
  primary: "oklch(0.55 0.09 195)"
  primary-foreground: "oklch(0.965 0.012 85)"
  secondary: "oklch(0.235 0.018 265)"
  secondary-foreground: "oklch(0.880 0.012 85)"
  muted: "oklch(0.228 0.016 265)"
  muted-foreground: "oklch(0.690 0.018 85)"
  accent: "oklch(0.300 0.035 195)"
  accent-foreground: "oklch(0.870 0.045 195)"
  destructive: "oklch(0.64 0.16 30)"
  success: "oklch(0.70 0.12 150)"
  warning: "oklch(0.78 0.13 70)"
  info: "oklch(0.68 0.08 275)"
  border: "oklch(0.918 0.012 85 / 13%)"
  input: "oklch(0.918 0.012 85 / 15%)"
typography:
  display:
    fontFamily: "Bricolage Grotesque Variable, system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 3vw, 1.875rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.3
  body:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    letterSpacing: "0.04em"
  mono:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
  2xl: "1.125rem"
  pill: "1.625rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  2xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "3rem"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "2.25rem"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 0.75rem"
    height: "3rem"
  tag-chip-mono:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.md}"
    padding: "0.25rem 0.5rem"
  filter-chip-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.md}"
    padding: "0.375rem 0.75rem"
  filter-chip-inactive:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.md}"
    padding: "0.375rem 0.75rem"
  result-row:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "1rem"
---

# Design System: ASMR Curator

## 1. Overview

**Creative North Star: "The Penthouse Reading Nook"**

The product is what you reach for at night with headphones on, settled into a corner of a modern penthouse, the city glittering through the glass. The room is dim, the materials are cool (slate, polished concrete, glass, brushed metal), and one single accent carries the warmth: the brushed face of a hi-fi amplifier glowing teal-cyan from below, or a desk lamp's reflection picking out cream tones on the page in front of you. Everything in the system is calibrated to that scene.

The visual system explicitly rejects four reflexes. **Not Spotify** or any commercial music app: a saturated single accent on a near-black surface is the most over-trained pattern in the category, and it's not us. **Not Audacity** or any pro-audio DAW: cold-grey utilitarian chrome with info-dense toolbars is the wrong audience, the wrong tonality. **Not Linear or Notion** or any cold-blue productivity SaaS: a gradient-logo "team workspace" tool is the default training-data reflex for "app," and we explicitly refuse it. **Not NSFW aggregator codes**: the content is intimate, but the librarian UI for it stays warm and considered, never lurid. The personality lives in the gap between those four.

**Key Characteristics:**
- Cool slate surfaces (hue 265, low chroma) carry the whole room.
- One teal-cyan accent (hue 195, deeper L for confidence) is the only chromatic interest.
- Foreground is warm cream (hue 85). The single warm element against the cool room is the warm/cool axis that gives the system its architectural feel.
- Flat by default. No shadows at rest. Lift comes from value, not depth.
- Designed for low light and imperfect eyesight: generous type, 48px tap targets, no harsh highs.
- Two voices: display sans for what the human writes, mono for what the machine writes.

## 2. Colors

The palette is a deliberate warm-on-cool duet. The room is cool (every surface tilts toward slate), the foreground is warm (cream-tinted text against the cool dark), and the single chromatic accent is a quiet teal-cyan that sits in the same cool family as the surfaces but lifts brighter and more saturated. No second accent competes.

### Primary

- **Amplifier Cyan** (`oklch(0.55 0.09 195)` dark / `oklch(0.38 0.10 195)` light). The CTA, the focus ring, the active filter chip. The brushed metal face of a hi-fi amplifier, lit from below. Sits in the cool family as the room but at significantly higher lightness, so it reads as "the lit element" without being a Spotify-style spotlight.

### Neutral

- **Skyline Slate** background (`oklch(0.155 0.015 265)` dark / `oklch(0.974 0.006 85)` light). The room itself. Cool dark in dark mode (the night sky outside the windows); cream-tinted paper in light mode.
- **Lifted Slate** card surface (`oklch(0.198 0.018 265)` dark / `oklch(0.992 0.005 85)` light). A faint tonal lift on the same hue family. Used for the panel surface and discrete content containers.
- **Reading Cream** foreground (`oklch(0.918 0.012 85)` dark / `oklch(0.20 0.022 265)` light). The page-text color. Warm cream against the cool room in dark; deep cool slate text against the warm paper in light. The hue flip across modes is intentional and preserves the warm/cool axis.
- **Dim Cream** muted-foreground (`oklch(0.690 0.018 85)`). Hints, secondary copy, low-emphasis labels. Same warm hue family as foreground, lower lightness.
- **Hairline Cream** border (`oklch(0.918 0.012 85 / 13%)`). Borders and input strokes use the cream foreground color at low alpha rather than a separate "border grey," so dividing lines feel like edges of the same warm element.

### Semantic

- **Destructive** (`oklch(0.64 0.16 30)`). Warm red, distinct from the primary's cool teal. Used for dangerous actions, not "alarm."
- **Success** (`oklch(0.70 0.12 150)`). Calm warm-green. Lower saturation than the primary so success doesn't compete with the CTA.
- **Warning** (`oklch(0.78 0.13 70)`). Soft amber. Reserved for things the user needs to notice but not panic about.
- **Info** (`oklch(0.68 0.08 275)`). Dim indigo. Deliberately moved to hue 275 so it doesn't visually collide with the teal primary (which sits at hue 195). Same general "cool architectural" family; different enough hue to read as a distinct role.

### Named Rules

**The Cool-Surfaces Rule.** Every surface (`background`, `card`, `popover`, `secondary`, `muted`, `accent`) sits at hue 265 with chroma between 0.015 and 0.040. Surfaces never read warm. Warmth in the system is reserved entirely for the foreground and primary roles.

**The One-Accent Rule.** Teal-cyan (hue 195) is the only chromatic interest in the chrome. It carries the CTA, the focus ring, and the active filter state. No second accent competes for attention. If a screen feels like it needs another color, it usually needs hierarchy instead.

**The Warm Foreground Rule.** Text and primary foreground elements tilt warm-cream (hue 85). This single warm element against the cool room is the system's warm-cool axis. Pure white text (`#fff`) is forbidden; it would break the axis and make the dark mode read as Spotify-clone.

**The No-Cold-Accent Rule.** Despite cool slate surfaces, no Linear-blue or crypto-neon ever appears. The accent earns its place by being a specific *brushed-metal* color (teal-cyan at moderate chroma), not a generic productivity-tool blue.

## 3. Typography

**Display Font:** Bricolage Grotesque Variable (with system-ui, sans-serif fallback). Used only for the page-level title and the post-title in result surfaces.
**Body Font:** Geist Variable (with system-ui, sans-serif fallback). One sans across labels, headings, body, controls.
**Mono Font:** JetBrains Mono Variable (with ui-monospace, monospace fallback). Filenames, paths, tag chips, URLs, raw machine-generated text.

**Character:** Two voices in deliberate separation. Bricolage adds quiet warmth to the few display moments (the page title, the result post title) without dominating; Geist carries the calm clarity through every label and form control; JetBrains Mono carries everything filename-shaped, so the eye learns at a glance what's labeled-by-a-human versus produced-by-the-machine.

### Hierarchy
- **Display** (semibold, `clamp(1.25rem, 3vw, 1.875rem)`, line-height 1.1): page title and result-state post title. One per surface.
- **Headline** (semibold, 1.25rem, line-height 1.25): section headers inside a workflow.
- **Title** (medium, 1rem, line-height 1.3): card and panel titles.
- **Body** (regular, 1rem floor, line-height 1.55, max 65 to 75ch for prose): primary reading text and form copy. 1rem is the floor; nothing in the body goes below.
- **Label** (medium, 0.8125rem, +0.04em tracking, uppercase): muted labels for field groups ("Also include," "Published between") and section markers. Tracking is the signal that this is a label.
- **Mono** (regular, 0.875rem, line-height 1.45): filenames, tag chips, paths, URLs, code-shaped content.

### Named Rules

**The Two-Voices Rule.** Display and body sans are for what the human writes (titles, labels, descriptions, copy). Mono is for what the machine writes (filenames, paths, tags, output). A label in mono or a filename in display is a bug, not a style choice.

**The 1rem-Floor Rule.** Body text is 1rem (16px) or larger. Always. The user may be on a tablet in low light with imperfect eyesight. Nothing in the body of the UI may violate this floor. Chips, captions, and tiny status text may drop to 0.8125rem, but body copy never does.

**The Display-Sparingly Rule.** Bricolage Grotesque appears only in the page title and the headline of a result-state surface. It does not appear in section headers, panel titles, button labels, or form copy. Display type used everywhere is display type used nowhere.

## 4. Elevation

Flat by default, soft on state. Surfaces are flat at rest, separated by lightness (value contrast), not by drop shadows. Depth comes from a slightly lighter `card` surface sitting on a slightly darker `background`; the panel reads as "the content" against "the room" because of value, not because of cast shadow. Shadows appear only as a quiet response to state, and they are always tinted toward the cool slate family rather than pure black.

### Shadow Vocabulary

The system intentionally does not define a full shadow scale. shadcn primitives that ship with their own shadows (popover, dialog) are accepted as-is for their structural role: signaling "this is on top." No custom shadow tokens are defined for cards, panels, rows, or buttons; lift is communicated through `bg-accent/40` or `bg-muted/30` background shifts on hover instead.

### Named Rules

**The Flat-By-Default Rule.** At rest, no surface in the system casts a shadow. The panel, the result row, the filter chip, the input, the button: all rest flat. Lift only happens in response to state.

**The Value-Lift Rule.** When a surface needs to feel "elevated" (a card on a page, a popover floating, a row being hovered), the lift is communicated by raising the background lightness within the same hue family, not by adding a shadow. A card at L=0.198 on a background at L=0.155 reads as lifted without a single shadow being drawn.

**The Tinted-Shadow Rule.** Where shadows do appear (popover, dialog), they tint toward the cool slate family, never pure black. A pure-black shadow on a cool-warm palette reads as a bug, like a clipping artifact.

## 5. Components

Each component leads with a one-line character note, then specifies shape, color assignment, states, and any distinctive behavior. The full HTML/CSS snippets are in `.impeccable/design.json` for the live panel and for handoff.

### Buttons

The button family inherits its pill shape (rounded-4xl, 1.625rem radius) from the project's shadcn base. The pill softens the overall geometry of the panel against the rectilinear cards and inputs, which is exactly the calm hi-fi-amplifier-knob feel the system aims for.

- **Primary** (`button-primary`): Amplifier Cyan background with warm cream text. Full-width and 3rem tall on key CTAs (Fetch from Patreon, Use for filename). Single-action focal point. Hover holds the color (no brighten); active translates down 1px (the subtle button-press feedback).
- **Outline** (`button-outline`): Background-colored fill with hairline-cream border, foreground text. Used for the "Apply" / secondary actions inside dense lists when present. Hover brightens to `bg-muted`.
- **Ghost / Text** (the "Fetch another" affordance, the "More options" disclosure trigger): No background, no border. Bold cream text, optionally with a leading chevron or icon. Hover shifts to primary color. Used for in-context navigation and disclosures where a button-shaped button would over-state the action.

### Inputs

- **Shape:** rounded-md (0.5rem), 3rem tall, 0.75rem horizontal padding.
- **Style:** background-colored fill, hairline-cream border, mono text inside (URLs are machine strings, per the Two-Voices Rule).
- **Leading icon:** when present, a 16px lucide icon positioned absolutely at the left, with the input's left padding bumped to 2.5rem to clear it.
- **Focus:** the ring token (Amplifier Cyan at 55% alpha) draws a soft cyan halo. No border color change; the ring carries the focus signal.
- **Placeholder:** muted-foreground at 55% opacity. Slightly dimmer than regular muted text so the field reads as "empty" not "labeled."

### Chips

Two chip variants, deliberately styled differently.

- **Tag chip (mono)**: rounded-md, mono text at 0.75rem, `bg-muted` with muted-foreground text. Used for tags, post IDs in result content, anything that came back from the backend as data. The mono font is the signal: this is machine-produced content the user is reviewing.
- **Filter chip (sans, paired states)**: rounded-md, sans text at 0.875rem. Active state uses `bg-accent` with `accent-foreground` (teal-tinted surface, brighter teal text); inactive uses `bg-background` with `muted-foreground` text. Used for the "Also include" content-type filters. The sans font and the larger size signal: this is a control you interact with, not data you read.

### Mode toggles

Used for the binary "Don't download audio" and "Preview only" toggles in More Options. A card-row pattern (full-row border, internal Checkbox + label + hint description) so the entire row is the tap target, not just the checkbox itself. 44px+ tall to clear the touch-target floor.

### Result row

The multi-post list row pattern from PatreonResultRow. Border-bordered surface with internal padding, the entire title-area wrapped in a button so the row IS the activation target (no per-row Apply button). External-links disclosure renders as a sibling of the button rather than a child, so anchor tags stay reachable to keyboards and screen readers. Hover shifts the row's background to `bg-accent/40` (subtle teal tint, not a value lift, since lift is reserved for "elevated" surfaces).

### Result header

A thin strip at the top of the result-state surface carrying the source URL (truncated middle, mono, muted) and a "Fetch another" text affordance. Borders bottom against the result content; sits at `bg-muted/30` to differentiate it slightly from the result body without being a separate card.

### Status text and log tail

Status banners are plain colored prose, not bordered banner boxes. The color comes from `text-success`, `text-destructive`, or `text-muted-foreground` directly on the text element. Log tails are `<details>` collapsibles with a mono `<pre>` interior, used only when there's a backend error or dry-run output worth examining; never shown on the happy path.

## 6. Do's and Don'ts

### Do:
- **Do** treat the room as cool and the foreground as warm. Surfaces sit at hue 265 with low chroma; foreground text and the primary accent provide the warmth (cream and teal respectively). Crossing those boundaries (warm surface, cool foreground) breaks the warm-cool axis.
- **Do** use Amplifier Cyan only where attention is intentional: the CTA, the focus ring, the active filter chip. Not as decorative trim, not as a divider color, not as a hover highlight on every surface.
- **Do** use JetBrains Mono for every filename, tag chip, raw path, URL, and machine-generated string. Use Geist (or Bricolage at the page title) for everything the human writes.
- **Do** floor body text at 1rem and touch targets at 44 by 44px (48 by 48px on tablet surfaces, like the primary CTA which is 3rem tall).
- **Do** respect `prefers-reduced-motion`: any motion not essential to feedback (the URL underline pulse during fetch, the staggered reveal) is stripped behind `motion-safe:`.
- **Do** verify both light and dark mode at WCAG AA before merging. Dark gets extra scrutiny since it is the default surface.

### Don't:
- **Don't** look like Spotify or any commercial music app. No sterile near-black surface, no saturated green accent, no album-art grids. (PRODUCT.md anti-reference.) The Amplifier Cyan must never be cranked up to vivid-saturated levels; if the CTA reads as "neon," it's wrong.
- **Don't** look like Audacity or any pro-audio DAW. No cold-grey utilitarian chrome, no info-dense toolbars, no engineer-first density. (PRODUCT.md anti-reference.)
- **Don't** look like Linear, Notion, or generic productivity SaaS. No cold-blue palette, no gradient logos, no "team workspace" framing. (PRODUCT.md anti-reference.) The accent is teal-cyan at hue 195 specifically; Linear sits at ~250, and any drift toward that hue puts the system in their lane.
- **Don't** borrow visual codes from NSFW aggregators. The content is intimate; the librarian UI for it stays warm and architectural, never lurid. (PRODUCT.md anti-reference.)
- **Don't** leak backend jargon into UI vocabulary. No `itag`, `CDP`, `signed URL`, `Playwright`, `metadata_only`, `dry_run`. Plain-English labels, or no label.
- **Don't** introduce a second saturated accent color. The system is Committed to one warm-cool tension (cool surfaces, warm foreground, teal accent); a second saturated color converts it to Full Palette and breaks the architectural feel.
- **Don't** go warm-rose, mauve, or sepia. Past iterations of this palette have all failed in that direction: warm pink reads as "intense" against the cool slate, mauve reads as "old chair in grandma's house," sepia reads as "brown." The warm-cool tension only works if the warm side is the foreground, not the accent.
- **Don't** use orchestrated mount animations or staggered section reveals. Motion is Responsive (state changes and feedback only), not Choreographed.
- **Don't** use side-stripe borders (`border-left` greater than 1px as a colored accent), gradient text, glassmorphism-as-default, hero-metric SaaS templates, identical card grids, or modals as a first thought. (Shared design laws.)
- **Don't** use `#000` or `#fff` anywhere. Every neutral tilts toward the brand hue family. Pure black or pure white is always the wrong color.
