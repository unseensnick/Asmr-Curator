# Changelog

All notable changes to this project will be documented in this file.

The format is a simplified version of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):

- `Additions` — New features
- `Changes` — Behaviour / visual changes
- `Fixes` — Bugfixes
- `Other` — Technical changes / updates

## [Unreleased]

### Fixes

- **Drive download retries automatically when the CDN serves only the m4a init segment.** Drive's playback CDN is non-deterministic: most requests for a given `videoplayback?itag=140` URL return the full audio, but a fraction return only the ~1 KB DASH init segment (cached by the player's service worker or a CDN edge probe). Previously this raised `fetch_failed` and the user had to click Download again until they got lucky. Now the backend retries the same URL up to 4 times (configurable via `DRIVE_DOWNLOAD_RETRIES`), uses `cache: 'no-store'` on the in-page fetch to defeat the service-worker cache, and surfaces the attempt count in the progress event (`Retry 2/4: Downloading…`) so the user can see retries happening rather than wondering why the bar reset. Only the under-50-KB body case triggers a retry; real fetch errors and timeouts still raise immediately. When all retries exhaust, the error message tells the user to wait a minute or two and click Download again — the failure usually clears on its own.

### Additions

- **Browse files Sheet (dual-root explorer).** A `Browse` button in the FileBrowser toolbar opens a right-side Sheet that walks both filesystem roots from a top-level Locations view (Library + Downloads); position is preserved across opens so batch-filing into one subfolder is one navigation. Inside a root: recursive subdir-scoped filter via `/api/files/search?subdir=…`, right-click-anywhere context menu, F2 / Del / `N` hotkeys, three-mode Delete confirmation (empty `rmdir` / N-items-inside `shutil.rmtree` / file `unlink`). Replaces the previous host-subprocess "Open in OS" approach, which never worked for the project's actual deployment target (Unraid / TrueNAS / Proxmox Docker containers).
- **Multi-file move via cut/paste in Library.** Single-click selects, Shift- and Ctrl/Cmd-click extend, drag-select rubber-bands a rectangle (with auto-scroll near edges), double-click activates, Ctrl/Cmd+A selects all visible rows. Ctrl/Cmd+X stages the selection as a cut (translucent rows + "N items ready to move" banner); navigate elsewhere and Ctrl/Cmd+V (or right-click → Paste here) commits via the new partial-success `POST /api/move/batch` endpoint. `/api/move` itself gained folder-move support with cycle protection, so the batch can ship whole subtrees; multi-Delete routes through one rolled-up confirmation. Downloads keeps its single-click-opens model — multi-select is Library-only.
- **`POST /api/delete`** — new endpoint that deletes a file (`unlink`), an empty folder (`rmdir`), or a non-empty folder (`shutil.rmtree`, requires `recursive=true` from the client after a user prompt). Non-empty folder + `recursive=false` returns 409 with `{ count, path }` so the UI can prompt with the right copy. Refuses to delete the root directory itself; scoped via the same `root` field as the rest of the file endpoints.
- **`POST /api/rename-path`** — general renamer that works on files and folders. Distinct from `/api/rename`, which is file-only and combines the rename with optional ID3/FLAC/MP4 metadata embed. Drives the Library explorer's Rename action.
- **`POST /api/move/batch`** — partial-success batch wrapper around `/api/move`. Body: `{ items: [{from_path, new_name?}], from_root, to_subdir }`. Response: `{ moved: N, results: [{from_path, ok, to_path?, error?}] }` so the client can refresh state and surface per-item failure reasons without aborting the whole batch on the first collision.
- **`DOWNLOAD_PATH` / `LIBRARY_PATH` split** — ingest and library are now two separate roots instead of a single shared mount. Patreon-dl, Drive scrape, and external-audio downloads land in `DOWNLOAD_PATH` (ingest staging); your curated archive lives in `LIBRARY_PATH` and stays free of raw `<post_id>/` folders. Both env vars are required; the backend errors on startup if either is unset or they're the same path. Upgrading: point `DOWNLOAD_PATH` at your old `LIBRARY_PATH` location so existing downloads keep working as Downloads-tab content, and set `LIBRARY_PATH` to a fresh curated archive — nothing is moved automatically.
- **FileBrowser now has Library and Downloads tabs.** Library is the default tab (your curated archive); Downloads surfaces what's waiting in `DOWNLOAD_PATH` with a pending-count badge so forgotten downloads don't sit unnoticed. Selecting a file in either tab opens the existing rename/convert work area, scoped to that root.
- **Move-to-library flow inside the work area.** Every selected file carries a `Move to library` collapsible with a folder-tree picker rooted at `LIBRARY_PATH` — breadcrumb navigation, drill-in by click, inline `+ New folder`. The `Move here` button commits, and if the user has a generated filename preview that differs from the current name, an inline checkbox offers to apply that rename during the move as a single server call.
- **Patreon Apply bridge link.** After Apply, a small `↗ Rename and move <filename>` link appears under the apply-status banner. Clicking it jumps to the FileBrowser Downloads tab, selects the downloaded file, and scrolls into view so the rename + move flow is one click away.

### Changes

- **Browser extension scoped to cookies-only.** The `webRequest`-based Drive URL auto-capture is removed; the extension now only syncs your Patreon + Google session cookies. Drive downloads continue to work through the in-app `Download` button on each post's External Links collapsible — that path scrapes server-side via headless Chromium using the cookies the extension just synced, and gives proper SSE progress events the auto-capture never did. The popup drops to a single Sync button, Settings drops the auto-download toggle, and the manifest no longer requests `webRequest` or Drive/googlevideo/googleusercontent host permissions.
- **API surface gained a `root` parameter on every file endpoint.** `/api/files`, `/api/files/search`, `/api/files/debug`, `/api/rename`, and `/api/convert` accept `root: "library" | "downloads"` (defaults to `"library"`). New endpoints: `POST /api/mkdir`, `POST /api/move`, `POST /api/move/batch`, `POST /api/rename-path`, `POST /api/delete`. The existing client contract for the default-`library` use cases is unchanged; new callers (Downloads tab, move picker, Patreon ingest endpoints) supply the root explicitly.
- **Three follow-ups from the run-7 critique:**
  - "Also include" content-type filter chips in PatreonPanel converted from hand-rolled `<button>`-with-className-ternary to the shadcn `ToggleGroup` primitive. Now the two pickers in the same panel (FetchModeSelector and content-type filter) speak one primitive vocabulary; their visual difference (connected pill vs individual chips) intentionally reflects the underlying semantic (single-select vs multi-select). Drops the now-dead `toggleContentType` helper and the `border-accent on bg-accent` dead-pixel border on active chips.
  - Page grid reading order is now Source → Edit → Output → Library at every breakpoint, using base-level `order-*` utilities instead of the lg/xl variants that left mobile (1-col stack) and the lg 2-col tier in DOM order. Was: a user on a narrow viewport pasted a URL in Source, scrolled past empty Output, and only then found the Edit column. Now Source → Edit → Output → Library on the 1-col stack; Source / Edit side-by-side with Output full-width below on lg 2-col; Source / Edit / Output side-by-side on xl 3-col. Library full-width at the bottom of all three tiers.
  - Output panel rows now carry a small mono separator badge next to each label (`-` next to Filename, `|` next to Tag string) so the visual difference between the two rows is legible at a glance instead of requiring the user to read the value to tell them apart.
- **Four follow-ups from the run-6 critique:**
  - The Patreon panel's two mutually-exclusive checkboxes ("Don't download audio" and "Preview only") become a three-option segmented control: *Full fetch · Info only · Preview*. Internal `metadata_only` and `dry_run` state flips coordinately under the hood (the backend contract is unchanged); a single dynamic hint below the row describes what the current selection does. Mutually-exclusive checkboxes were a long-standing heuristic violation — users expect checkboxes to be independent.
  - Format suffix in the Tags editor normalizes on blur (trim + uppercase) so typos like `f4a`, ` F4A`, or `F4A ` don't propagate into filenames. The field stays free-text because the suffix is an ASMR-community convention (F4A, F4M, F4F, GN4A, etc.) the user defines themselves — there's no canonical list in the codebase to enumerate. `audio-formats.json` is for the technical audio-conversion formats (MP3/FLAC/OGG), a separate concept from the filename suffix.
  - Dictionary terminology unified across the surfaces the user actually sees. The header pill already said "Dictionary · N" (from run-4); the header tooltip + the Library settings modal's visible title + its close-button aria-label all said "Library settings". Now everywhere the user can see, the word is "Dictionary". Component filename `LibraryConfigModal.tsx` stays as is (internal naming, not user-visible).
  - Patreon source-column empty state expanded from a four-word hint ("Single post or creator URL.") to a two-clause scene-setter ("A single post URL fetches one file. A creator URL pulls their back-catalogue.") so the column carries roughly the same empty-state weight as the Edit and Output columns on cold load.
- **Metadata-only Patreon fetch now skips the patreon-dl subprocess for creator URLs too, not just single posts.** Was: a single-post URL in metadata-only mode would return immediately from a previously-cached sidecar (no Node startup, no network), but a creator URL always shelled out to patreon-dl even when every post was already on disk — easily 5-10 seconds of round-trip for what is a pure filesystem read. Now both URL flavors take the fast path: the creator URL's vanity is matched against each cached sidecar (preferring `relationships.campaign.vanity` when present, falling back to a slugified artist name like "Solar Girl ASMR" → "solargirlasmr" when patreon-dl's `included` array omits the campaign object), the `published_after` / `published_before` date filters are applied in-process (matching patreon-dl's server-side semantics, inclusive both ends), and results come back ordered newest-first. First-time fetches (no cached sidecars) still fall through to patreon-dl unchanged. New `_vanity_from_url` handles both URL styles (`patreon.com/c/<vanity>` and the legacy `patreon.com/<vanity>`), filtering out reserved paths like `home` / `search` / `settings`. Coverage in `backend/tests/test_patreon_fetch.py`: vanity extraction, creator filtering (vanity-from-campaign and slug-from-artist), date bounds, ordering, corrupt-sidecar skip.
- **Three follow-ups from the run-5 critique:**
  - Source / Edit / Output column labels removed. They were section markers that didn't carry their weight — the inside of each column (Source tabs, Audio title field, Filename label) is already self-evident. Removing them also resolves the page-flow dilemma where the labels implied a Source → Edit → Output order that doesn't fit both audiences (a collector starts at Source for a Patreon fetch; an artist starts at the Edit column to name a file they recorded). With the labels gone, neither workflow is privileged visually.
  - Extracted creator name resurfaces as "from \<artist\>" above the Audio title input. It was captured into App state during Patreon and Screenshot extraction but only consumed by FileBrowser, so the user saw it briefly in the source result and then lost the context during tag editing. New `artist` prop on `TagsEditor` renders a small `User` icon + muted caption when the value is non-empty.
  - Muted-label vocabulary normalized across the three top panels. `FieldGroup` (PatreonPanel) and the "Saved to" label dropped their `text-xs uppercase font-semibold` styling and now use the same `text-sm font-medium tracking-wide text-muted-foreground` as the inline labels in TagsEditor and OutputPanel. One muted-label voice everywhere.
- **Four follow-ups from the run-4 critique:**
  - Header pill renamed from "Tags · N" to "Dictionary · N". The pill opens the dictionary editor; using "Tags" overloaded the same word with the middle-column "Tags" editor that edits the current filename's chips. Two surfaces, same name, different jobs is fixed.
  - The Source / Edit / Output column labels drop from `text-[10px] uppercase tracking-[0.15em]` to `text-xs font-medium tracking-wide` (still muted-foreground). They were equal-weight peers in an overload microtype; now they read at the same vocabulary as the inline field labels ("Audio title", "Tags", "Format") so the screen uses one muted-label voice instead of two.
  - File library no longer defaults to open on widescreen. It mounts collapsed regardless of viewport, so the filesystem walk that fires on mount-when-open doesn't run on every page load. Removes the `useMediaQuery` dependency in App.tsx.
  - Tag chip tray disappears when there are no tags. Was: a `min-h-14` muted rectangle holding "No tags yet…" — the loudest empty state on a first-paint page. Now the Add-tag input sits alone below the Tags label until the first chip exists; the tray renders only once it has content.
- **Top-of-fold CTA hierarchy, output feedback, copy, and tagline tuned from the run-3 critique.** Five small alignments after the run-3 design review moved the page to 30/40:
  - Generate filename shrinks to a content-width `size="lg"` outline button, right-aligned in its grid cell, so Fetch from Patreon stays the only h-12 full-width CTA in the top-of-fold (was: same h-12 full-width footprint as Fetch, even though variant was outline).
  - The Source / Edit / Output column labels lift from `text-muted-foreground/40` to the full `text-muted-foreground` token — they were under WCAG 3:1 for non-text UI and barely visible at viewing distance on the slate background; the tracking treatment is unchanged so they still feel quiet.
  - The Output panel's "Metadata" row is renamed "Tag string" with empty-state copy that explains where to paste it ("Paste into ID3 fields, post body, or comments"); the strip-brackets checkbox copy follows the rename. "Metadata" was a dev-leak per the PRODUCT.md anti-references.
  - Both output rows pulse their border to `border-primary/60` for 600 ms when their value changes, and carry `aria-live="polite"` so Generate now gives an out-of-the-corner-of-the-eye acknowledgement on the right column (no flash, no scroll-into-view before).
  - Header tagline rewrites from the verb-list "Pull, tag, rename, and shelve your audio." to a scene line "A quiet place for your audio library.", matching PRODUCT.md's "reading app, not productivity tool" voice.
- **Contested aliases now flagged on existing vocabulary rows, not only while typing one.** Before: the contested-alias warning only appeared in the inline editor as you typed a new alias; an alias already saved on two entries (e.g. *softdom* on both **Soft Dom** and **Soft Dom Girl**) sat silently with no indication of the override. Now every alias chip checks the full vocabulary and renders with an amber tint + `AlertCircle` glyph when another entry also claims it. The hover tooltip names the other claimant and says which entry currently wins lookup (last-write-wins on list position, so the entry lower in the list wins).
- **FileBrowser internal split moved from `5fr_6fr` to `3fr_4fr`.** The previous 5/6 ratio was almost-equal and visually arbitrary; the new ratio mirrors the page's `3fr_4fr_3fr` dashboard split so the file list (left) and rename/convert work area (right) feel like they share the page's column grammar.
- **Selected-state and overlay-radius vocabulary consolidated.** The Library settings side-nav active tab was using a quieter `bg-accent/40 text-foreground` idiom that didn't match the filter chips (`bg-accent text-accent-foreground`) or the ToggleGroup separator/sort/conversion controls — now all three "active state" surfaces use the same full-accent treatment so the active signal is identical wherever it appears. The Dialog primitive's `rounded-4xl` corner radius is dropped to `rounded-2xl` so it matches AlertDialog and the Sheet's left edge; centred dialogs and side panels now share the same corner geometry.
- **Destructive-color semantics tightened across the surface.** Three small alignments: vocabulary entries now confirm before deletion (was: instant delete on Trash click, asymmetric with the cookie clear which has always confirmed); suppressed-term chips at rest now use neutral muted styling instead of `bg-destructive/10` red (per DESIGN.md, destructive color is for dangerous actions, not passive state — the X button on each chip still hovers to destructive to mark the affordance); the power-mode indicator dot in the header gear icon now uses `bg-foreground/60` instead of `bg-primary` so Amplifier Cyan stays reserved for CTAs and active filter chips.
- **Cookies modal is now a right-side slide-over instead of a centered dialog.** Matches the Library settings Sheet so the two settings surfaces use the same primitive. The main workspace stays visible while you paste a cookie or watch the connection status update; the help drawer's expanded content keeps the same scroll behavior it had inside the Dialog.
- **Patreon results list caps at 28rem and scrolls internally.** Was: a creator URL that returned 15+ posts grew the page to thousands of pixels tall, pushing the file library and everything else off the visible canvas. Now the list is bounded and scrolls within itself; the row stack is block-flow (`space-y-*`) instead of flex so individual post rows render at their natural height without any squish from flex-shrink.
- **Bracket-stripping in the metadata title now handles all leading and trailing [brackets], unbounded length.** Was: only the first leading `[...]` block up to 50 characters was removed, so titles like `[EXCLUSIVE] [27:23] Soft Whispers` kept the `[27:23]` and titles ending in `[FREE]` kept the trailing marker. Now any number of consecutive `[bracket]` groups at the start or end of the title are stripped regardless of their contents. Mid-title brackets are left alone — those are usually part of the actual title. The Output panel checkbox copy is updated to match: "Drop [bracket] markers from the edges of the metadata title".
- **Copy and label cleanup across the workspace.** The Tags button in the header keeps its "Tags · N" label on every viewport (was icon-only below sm, which left the count unexplained). The file-rename separator toggle shows the actual character alongside the word ("Dashes (-)" / "Pipes (|)") instead of just "Dash" / "Pipe".
- **Cookie nagging is gone from the header; the prompt now lives where the failure actually happens.** Removed the warning row in the Settings dropdown and the gear-icon warning dot that fired when the Patreon or Google cookie was unset, and removed the "Set your Patreon cookie first in settings" line under the URL input. When a Patreon fetch fails, a "Set Patreon cookie" action now appears under the error banner so the user can fix the session inline without hunting through Settings. Manage cookies stays in the Settings dropdown for explicit access, and the cookies help drawer stays unchanged.
- **Generate filename demotes to an outline button.** The top of the workspace had two filled teal CTAs competing (Fetch from Patreon and Generate filename); only Fetch is the entry into the workflow, so it keeps the filled-teal primary treatment and Generate drops to an outline at the same height. Visual hierarchy now reads start-here → refine → output instead of three peers.
- **Ctrl+V pastes a screenshot without needing to click into the panel first.** Was: the paste handler lived on a non-focusable `<div>`, so the only way to engage it was to click the drop zone (which gave focus to a `tabIndex=0` element) and then paste. Now: when the Screenshot tab is the active source, a window-level paste listener catches the image directly. Bails out when the active element is a text input, textarea, or contenteditable so paste into form fields (URL input, vocab add input, cookie textarea) keeps working normally.
- **Tag chips edit on click-anywhere.** Was: had to click the label text precisely to enter edit mode; clicking the chip's padding did nothing. Now the whole chip body is the edit target (keyboard: Enter/Space when focused) and the X button uses `stopPropagation` so removing doesn't also enter edit. Same affordance the vocabulary rows have used since `96d43fd`; consistent across the two editing surfaces now.
- **Tag chips show whether the tag is in your dictionary.** Tags that match a canonical entry render as before (default chrome). Tags that don't match anything in the dictionary render with a faint warm-amber tint (`bg-warning/10 border-warning/30`) and a "Not in your dictionary yet" tooltip, so you can spot them during composition and decide whether to add them as vocabulary or accept them as one-offs. Mirrors the Matched/Novel vocabulary the Test extraction pane already uses, but quieter — composition surface, not grading surface.
- **Library settings is now a right-side slide-over instead of a centered modal.** Lifted to a shadcn-style `Sheet` primitive so the main view (Output, Tags editor, File library) stays visible while editing vocab. Particularly useful for the Test extraction tab — you can preview tag matching against the dictionary you're editing without losing context of the result panel. New `frontend/src/components/ui/sheet.tsx` primitive (hardcoded to right-side, reuses the `bg-scrim/30` backdrop token from the Dialog fix). Sheet width caps at `max-w-2xl/3xl/4xl` (sm/lg/xl) so the underlying view isn't fully obscured.
- **Cookies moved out of the Tag dictionary modal into Settings.** The Dictionary modal is renamed to Library settings (file: `LibraryConfigModal.tsx`) and now holds only vocabulary, suppressed terms, and test extraction. Patreon and Google cookies live in a dedicated Cookies modal opened from the Settings dropdown's *Manage cookies* item. The header's cookie-warning row opens cookies directly instead of routing through the Dictionary modal. Header trigger button text changes from "Dictionary · N" to "Tags · N" to match what's actually inside. Closes the IA leak where auth state lived inside the vocabulary editor.
- **Page container expands to 2560px on ultrawide displays.** Was `max-w-screen-2xl` (1536px), now `max-w-[160rem]`. At 5120px viewports the content area goes from 30% to 50% of width, gutters drop from 1792px to 1280px each side. Side-effect: the 3-column dashboard's columns get wider (Source 768px, Tags 1024px, Output 768px at full cap), which fixes the More-options toggles that were wrapping their labels at the old narrower width.
- **Page layout becomes a 3-column dashboard on widescreen.** At ≥ 1280px the four primary regions distribute as Source ⏐ Title & Tags ⏐ Output across the top row, with File library always-expanded as a full-width workspace below. At 1024–1279px the page falls back to a 2-column tier (Source + Output, Tags full-width, Library full-width). Below 1024px the original 1-column vertical stack is preserved. Power-Mode disclosures now expand within their owning column instead of pushing the whole page taller, so the bottom-half dead space on widescreen monitors goes away.
- **File library defaults to expanded on widescreen.** At ≥ 1280px the library opens on first load (it was always collapsed before, which left the largest piece of canvas sitting empty). Below that breakpoint it stays collapsed by default. Manual toggles win and stick — resizing across the breakpoint doesn't undo a user's choice.
- **Primary CTA icons now reflect what each action does.** Fetch from Patreon uses `Download`, Extract from screenshot uses `ScanSearch`, Generate filename keeps `Sparkles`. The same lucide Sparkles glyph used to lead all three CTAs in one scroll; each verb now carries a distinct icon that matches its action.
- **Tag Dictionary modal redesigned with side-nav layout.** Settings-style left-side nav on desktop (Vocabulary, Suppressed terms, Test extraction, Patreon cookie), horizontal tab strip below md so it still works at narrow widths. Sentence-case tab labels and an honest header (the older bullet decoration and 10px uppercase styling are gone); footer keeps the Export / Import / Reset actions with a clearer destructive treatment on Reset. Every pane's boxed help paragraph collapsed into a calm inline note (icon + sentence). VocabularyPane's inline editor switched from a teal-tinted background (which violated the One-Accent Rule) to the same `bg-accent/40` warm tint other surfaces use; the always-on Pencil hover hint is gone and the Delete button is always visible (tappable on touch). Clicking anywhere on a vocab row enters edit mode now (no need to hit the canonical text precisely), and rows are draggable to reorder; entry order controls which canonical claims a contested alias when two entries overlap (last-write-wins in the canonical map, so the entry lower in the list wins on lookup). Reorder is disabled while a search filter is active. DictionaryTester's per-tag rows are flatter and clearer (Matched / Novel / Suppressed pills, no decorative arrow glyph), the raw-LLM disclosure now uses the shared Collapsible primitive, and the button copy is "Previewing" instead of "Asking LLM" (no backend jargon leak). CookiePane now covers BOTH Patreon and Google session state (the tab is renamed from "Patreon cookie" to "Cookies"). Two status rows with lucide CheckCircle2 / AlertCircle / Loader2 icons paired with clear "Connected, N stored" / "Not connected" / "Checking" copy; Clear works on either. The manual paste textarea stays Patreon-only (Google cookies are a structured array that can't be pasted by hand). The help drawer leads with the browser extension as the recommended one-click path for both cookies, then a manual DevTools fallback for Patreon. Frontend gets a small `clearGoogleCookies` helper in `lib/api.ts` for the new Clear button.
- **File library, rename, and convert surfaces redesigned around a two-column layout.** On wider viewports the searchable file list sits left, the rename / convert work area sits right; on smaller viewports they stack as before. File rows render filenames and folder paths in mono (machine data; matches Two-Voices), and the selected-row highlight is now a full-row warm tint instead of a coloured side stripe. The selected-file work area uses generous metadata-field sizes (h-9 inputs, 13px labels) so the rename form is tappable on a tablet. Required-conversion still shows a clear warning banner with the actual reason ("This file's format doesn't support embedded metadata. Convert it first."). Batch convert mode replaces the work area on the right column instead of appearing in addition to a single-file selection. Copy tightened throughout: no em dashes, sentence case on buttons and labels, "Will become" prefix on the rename preview, "Couldn't reach the library. Check that LIBRARY_PATH is set and points to a valid folder." replaces the old devcontainer-specific error message.
- **Screenshot panel redesigned and tab chrome cleaned up.** Screenshot panel adopts the same Penthouse Reading Nook surface as Patreon panel (`bg-card` outer, `bg-muted/40` preview surface, dashed-border drop zone, 3rem primary CTA, plain-prose status banner). Replace-image button gets a lucide icon and an accessible label (was a Unicode `↩` glyph with title only). Copy tightened: no em dash; no `Ollama` in user-facing text. The source-tabs chrome drops the always-on teal bullet decorations and the display font on the trigger labels (Display-Sparingly Rule). Power mode now wires through to Screenshot panel: the raw-LLM debug disclosure is only rendered when power mode is on (stricter than Patreon panel's More options; debug output is genuinely advanced). Lightbox backdrop swapped from literal `bg-black/85` to `bg-background/90 backdrop-blur-md` (no `#000` literals).
- **Output panel collapsed to a single surface.** Was two stacked cards (Filename + Metadata), each with its own header, Copy button, and Regenerate button. Now one `bg-card` panel with two labeled rows. Output text renders in mono (filenames are mono per the Two-Voices Rule). Empty rows show muted-italic placeholders ("Filename will appear here.", "Metadata will appear here.") inside the same surface, so the structure is visible before anything's generated. The Regenerate buttons are gone; the Generate button in the Title & Tags editor is the single entry point. The `info`-color variant on the Metadata Copy button is also gone (One-Accent Rule). `CopyButton` gains a `disabled` prop so it greys out cleanly when there is nothing to copy.
- **Title & Tags editor redesigned.** The in-component Dictionary button is gone (the new header carries one). Inline labels at the DESIGN.md spec (sentence case, 0.8125rem, +0.04em tracking) replace the old uppercase 10px SectionLabel usage. Copy tightened throughout: *Audio title*, *Tags*, *Format*, *Add a tag*, *Generate filename*, plus a plain "Drag to reorder, click to edit" hint with the em dash gone. Tag chips now render in mono (matching Patreon panel result rows and the Two-Voices Rule), the drag handle reveals only on hover/focus, and the decorative pencil-icon hint is gone. Empty-state copy in the tag container: "No tags yet. Type one below to add it." Touch-drag reordering is still a known limitation, deferred to a future pass.
- **App header redesigned and rebranded.** Branding moves from *ASMR Workbench* to *ASMR Curator*. The header carries the brand mark, a `Dictionary · N` button with live tag count, and a Settings dropdown menu (theme toggle, the new Power mode toggle, a cookie-status warning row when needed, and read-only Model + Version info). The dedicated bottom StatusBar is gone, absorbed into the menu. The browser extension still ships as *ASMR Workbench Companion* and is left for a separate decision.
- **Power mode** (Settings → Power mode) persists across sessions and is the global controller of every panel's "More options" disclosure: on means open, off means closed. Users can still flip the disclosure manually within a session; the next Power mode change resets it. Currently only the Patreon panel has such a disclosure; future panels will inherit.
- **Patreon panel is now a single persistent surface.** The URL input stays visible at all times — paste a new URL and press Enter (or click Fetch) to start a fresh fetch without clicking "Fetch another" first. Results appear inline below the options section; a subtle separator divides them. The fetch pulse-bar and loading text appear under the URL during work; apply confirmation appears in the results section. Previously the input was hidden behind the result view and required an extra step to return to it.
- **Three-column workspace strips card chrome.** The Source, Edit, and Output sections no longer render as bordered cards against the page background. Each column is labelled with a small uppercase zone marker (Source / Edit / Output) and its content flows edge-to-edge within the grid. Individual form fields keep their own border/background; the grid gap provides column separation. The layout reads as a single unified workspace rather than three equal SaaS tiles.
- **App palette repointed to "The Penthouse Reading Nook"** (`frontend/src/index.css`). Cool slate surfaces with a quiet teal-cyan accent and a warm cream foreground; warm-cool axis is the architectural signature. Other panels inherit the new neutrals automatically; each panel will be redesigned in turn.

### Additions

- **Server-side Drive ingest.** Patreon posts whose audio is hosted on Google Drive now have a per-link **Download** button in the External Links collapsible. One click pulls the audio into `LIBRARY_PATH/<post_id>/` via headless Chromium — replaces the manual *click → DevTools → copy URL → strip parameters → paste → download* sequence the workflow needed previously. Requires the Google session cookie synced via the browser extension.
- **Smart Drive filenames.** Saved Drive files take their name from the link's anchor text (e.g. *Love Goddess | With Music | Soft Waves.m4a*) rather than `<post_id>_<timestamp>.m4a`, so multiple downloads from the same post stay distinct and recognisable.
- **Audio-stream preference for Drive.** Drive serves audio + video as parallel streams (typical for ASMR cover-art uploads where the video stream is just a still image); the listener prefers the audio stream so the saved file is `.m4a` instead of a multi-MB `.mp4` carrying only a still image plus the audio track.
- **Live download progress.** Drive downloads now show real percentage (`Downloading 12.4 MB / 25.0 MB (50%)`) updated every 500 ms, instead of an opaque *Downloading… 32.0s* counter.
- **Queued Drive downloads.** Clicking Download on multiple Drive links in a post now serialises them (one at a time by default; raise `DRIVE_SCRAPE_CONCURRENCY` if you're scraping different Google accounts). Pending rows show *Queued — N downloads ahead* until their turn. Prevents the previous race where most concurrent downloads returned ~1 KB stub bodies instead of the real audio.
- **Drive auth fast-fail.** When the Google session has expired, the Download button fails in ~1-2 s with a clear *"Open the browser extension and click 'Sync cookie'"* message — instead of waiting 90 s and reporting a generic timeout.
- **Long-file download timeout raised to 4 hours** (override via `DRIVE_DOWNLOAD_TIMEOUT_S` env var). Lets multi-hour ASMR files (3-hour sleep audios, full-length meditations) finish on slow connections without being cut off mid-flight.
- **Sync Google cookie via the browser extension.** The existing Sync cookie button now pulls Google cookies alongside Patreon and pushes both to the backend in one click. The mixed outcome is surfaced as one combined status message so you can tell at a glance which service (if either) needs you to log in first.
- **External Include chip in the Patreon panel.** Posts whose only audio is a Drive (or other allowlisted host) link in the body used to be silently dropped by the default audio-only filter. The new *External* chip widens the walk so those posts appear in the results with their links surfaced. Opt-in, sticky via localStorage. The Drive-link extractor also reads Patreon's newer ProseMirror-JSON post format (used by posts that show no HTML body), so links in those posts surface too.
- **Browser extension companion (`extension/`)** — Manifest V3 for Chromium and Firefox 121+. One-click Patreon + Google cookie sync replaces the manual DevTools copy/paste. Includes a Sync-cookies pill that injects on patreon.com, a one-button toolbar popup, and an options page for the backend URL.
- **`POST /api/patreon/ingest-external-audio`** — downloads a signed external audio URL into `LIBRARY_PATH/<post_id>/`. Streams via httpx to a `.part` temp file, renames on success. Embeds metadata via mutagen when the destination format supports it.
- **Drive / Mega / MediaFire / Dropbox links surfaced on post cards.** When a Patreon post body contains a link on an allowlisted file-host, the post card shows a collapsible *External Links* hint. (Only Drive currently has the one-click Download button — others surface as plain links the user opens manually.)
- **Google cookie storage** (`PUT/GET /api/settings/google-cookie`). Mirrors the existing Patreon-cookie endpoint shape — `GET` returns `{set, count, length}` (never the values), `PUT` accepts `{cookies: [...]}` (empty array clears).
- **Playwright + Chromium baked into the Docker images** for the Drive scrape. Adds ~180 MB to the image; one-time cost, cached in layers.

### Fixes

- **Dialog modal backdrop tinted, no longer pure black.** The Library settings (a.k.a. Tag dictionary) modal opens over a slightly slate-tinted blurred backdrop instead of a literal black scrim, matching the lightbox treatment and removing the only `bg-black` literal from the app. New `--scrim` token in `index.css` (same deep cool slate in both modes) routed through the shadcn Dialog primitive.
- **Metadata-only re-fetch now shows cached metadata instead of erroring.** When *Metadata only* was checked and the post had already been downloaded previously, the Patreon panel used to return empty with a misleading *"No new posts were fetched"* banner (the user's workaround was to delete `.patreon-dl/` and re-fetch). The fast path now serves the cached sidecar without invoking patreon-dl at all — near-instant. Scoped to single-post URLs; creator URLs fall through to the normal flow.
- **`DB_PATH` default no longer leaks state outside the workdir on Windows.** On Windows, the POSIX-style default `/data/dictionary.db` resolved against the current drive root (creating `E:\data\dictionary.db` outside the repo). Now resolves to `<repo>/data/dictionary.db` on Windows; Docker / devcontainer behaviour unchanged (both pass `DB_PATH` explicitly).
- **Path traversal in `validate_audio_path`** — replaced a string-prefix containment check with `Path.is_relative_to`, closing a sibling-directory bypass (`/mnt/audio_evil/...` no longer satisfied a check against `/mnt/audio`). Affects every file-rooted route.
- **`/api/extract` payload cap.** Caps the base64 image at 32 MB (≈ 24 MB binary); rejects with HTTP 413 before buffering. Previously a multi-MB paste could OOM the worker.
- **Patreon session cookie no longer passes through subprocess argv.** Written to a temp config file (mode 0600, unlinked after the run) instead of `--cookie <value>`, so the cookie can't leak through `/proc/<pid>/cmdline` on shared hosts. The log tail is also scrubbed for any literal occurrence before being returned to the API.
- **`/api/files/search` rewritten** — filters audio extensions inside the directory walk, prunes hidden and `.patreon-dl` subtrees in place, caps at 500 results with a `truncated: true` flag. Eliminates the previous O(all-files) materialisation on every keystroke.
- **`/api/convert` error response no longer leaks server paths.** Full ffmpeg stderr logs server-side; the API returns a generic message.
- **`/api/patreon/ingest-external-audio` response** — `audio_path` is now always relative to `LIBRARY_PATH`, never the absolute server path.
- **Date filter validation** — rejects invalid calendar dates like `9999-99-99` upfront, instead of passing them through to patreon-dl which errored unhelpfully.
- **Dictionary panes (VocabularyPane, SuppressedPane)** — backend errors (notably 409 duplicate-canonical on add) now surface inline as an error message, instead of becoming silent unhandled promise rejections.
- **Request timeouts via AbortController.** Defaults: 60 s general, 120 s extract/preview, 600 s convert/ingest, 30 min patreon-fetch. Aborted requests throw a clear *"Request timed out after Ns"* error.
- **Clipboard fallback in insecure contexts.** Copy actions no longer leave a stuck spinner when the browser rejects `navigator.clipboard.writeText` (e.g. on `http://` origins).
- **SelectedFilePanel** — rename and convert *done* badges clear correctly on unmount; rename's `metadata_error` partial-success path now surfaces via the error banner instead of being silently swallowed.
- **FileBrowser** — deferred initial fetch until the collapsible is opened. Previously every page load walked the whole `LIBRARY_PATH` even when the panel stayed closed.
- **Long titles no longer silently truncated to 120 chars** when they have no parenthetical and no pipe split. Surprising behaviour for long Patreon titles is gone.
- **PatreonPanel error rendering** — the noisy `log tail: ...` suffix from backend errors is split off the status banner and folded into the existing expandable log surface.

### Other

- **Contested-alias warning in the Vocabulary editor.** Typing an alias that's already used as another entry's canonical OR as another entry's alias now shows a small in-line warning under the Add Alias input ("Already on **Other Canonical**. Adding here lets this entry override on lookup if it sits lower in the list."). Surfaces the previously-silent override behavior so users can decide whether they want to add the conflicting alias and reorder, or pick a different one. Detection runs as the user types — no extra click required.
- **Long status/error messages no longer stretch the source panels.** Both PatreonPanel and ScreenshotPanel StatusBanners get `max-w-prose break-words`. A long backend error or an unbreakable URL used to stretch the banner across the full panel and push other content around; now it caps at ~65ch and wraps cleanly inside the column.
- **Native `confirm()` / `alert()` replaced with in-app AlertDialog.** Four sites: the Reset-to-defaults confirmation in Library settings, the Import-failed notice in Library settings, and the two Clear-cookie confirmations in the Cookies modal. Browser-native dialogs broke the visual system (white system chrome, generic OK/Cancel typography, no theme awareness); the new dialogs are themed, use the same `bg-scrim/30` backdrop as the rest of the modals, and the destructive actions read with the destructive-color treatment. New `frontend/src/components/ui/alert-dialog.tsx` primitive (shadcn-style, Radix AlertDialog under the hood — uses `role="alertdialog"` for the correct ARIA semantics).
- **All spinners use lucide `Loader2` now.** Seven hand-rolled `<span border-2 ... animate-spin />` ring spinners across AsyncButton, StatusLine, DictionaryTester, SelectedFilePanel, FileBrowser (×2), and ScreenshotPanel are replaced with `Loader2` (already in use by CookiePane). One spinner idiom across the app instead of two.
- **Multi-post result rows no longer use the display font.** PatreonResultRow's title was set in Bricolage Grotesque at body size (14-15px), which is below the size display fonts are designed for and reads ungainly. Now uses the body sans like every other list-row title. The single-post result headline (PatreonPanel:506) still uses display per DESIGN.md's "post-title in a result surface" allowance — that one's at heading size where the display font actually does its job.
- **Token-hygiene pass.** Five small arbitrary-value cleanups across the chrome: OutputPanel drops `sm:text-[15px]` (uniform `text-sm` mono is more readable, the breakpoint bump wasn't earning its place). TagsEditor's Format/Generate row uses `[10rem_1fr]` instead of `[160px_1fr]` (rem-aligned, visually identical). Header's BookOpen icon goes from `size={15}` to `size={14}` to match the surrounding 14/16/18 icon scale. Both `AlertTriangle` banner icons (FileBrowser error banner + SelectedFilePanel required-conversion warning) go from `size={15}` to `size={16}` so they sit closer to body-line height and carry appropriate alert weight. No visual regressions.
- **CI now passes on a clean checkout.** Three failures fixed: (1) Frontend lint honors the `_`-prefix unused-vars convention via a `@typescript-eslint/no-unused-vars` override in `frontend/eslint.config.js`; the convention was being silently rejected by the recommended preset, so an intentional rest-destructure discard (`const { state: _state, ...rest } = parsed`) was breaking lint. (2) Backend pytest can now find the `backend` package without `PYTHONPATH` set, via `pythonpath = [".."]` in `backend/pyproject.toml`; CI never set `PYTHONPATH` (only the devcontainer did), so test collection failed with `ModuleNotFoundError`. (3) The Windows-only `_default_db_path` test is now skipped on non-Windows runners; its `monkeypatch.setattr(os, "name", "nt")` makes pathlib try to instantiate `WindowsPath` on Linux, which it refuses. The power-mode disclosure pattern in `PatreonPanel.tsx` and `ScreenshotPanel.tsx` was refactored from a `useState` + `useEffect` setState-in-effect (which `react-hooks/set-state-in-effect` flags) to an uncontrolled `Collapsible` with `defaultOpen={powerMode}` and a `key` remount on power-mode change; identical UX.
- **Vite dev server now uses polling for file changes.** Docker Desktop's bind mount from Windows or macOS does not propagate `inotify` events to processes inside the Linux devcontainer, so Vite never saw your edits and HMR never fired; the workaround was to Ctrl+C and restart the dev script after every change. The watcher is now configured with `server.watch.usePolling: true` at a 300ms interval in `frontend/vite.config.ts`. Adds ~1-3% idle CPU in the container; HMR now triggers on save as expected.
- **`AUDIO_EXTS` consolidated.** The backend's audio-extension list now reads from `frontend/src/lib/audio-formats.json` — the same source of truth the UI uses. Stops the two from drifting.
- **patreon-dl upgraded to upstream 3.9.0 from npm.** The previous vendored 3.8.1 patch is no longer needed; upstream closed the `__NEXT_DATA__` parser regressions in 3.9.0. No more custom build to maintain.
- **Devcontainer audio path is now templated.** The `mounts` entry in `.devcontainer/devcontainer.json` reads `${localEnv:LIBRARY_PATH}` instead of a hardcoded personal path. Set `LIBRARY_PATH` in your shell environment before reopening the container.
- **`.claude/` config tree.** Bootstrapped from the dotclaude template and tailored to this stack: path-scoped rules, hardened settings.json permissions, PreToolUse hooks (secret scanning, file protection, dangerous-command blocking). See `.claude/rules/` for the rule scopes.
- **README refresh** — corrected project structure (added `patreon_fetch.py`, renamed components), added `.env` / `LIBRARY_PATH` setup step, a *Pull from GHCR* alternative, a *Reopen in Container* devcontainer instruction, and an *Audio Conversion* API reference.

## [1.1.1]

Hotfix for the 1.1.0 production Docker image.

### Fixes

- **Dockerfile: install `patreon-dl` in the final stage**, not in a separate Node 25 builder stage. The previous split compiled `better-sqlite3`'s native `.node` binary against Node 25 then ran it under Node 20 (whatever `apt-get install nodejs` ships on the python:3.14-slim base), crashing every Patreon fetch with `NODE_MODULE_VERSION 141 vs 115`. Now patreon-dl installs after `apt-get install nodejs npm` in the runtime stage so the compile + runtime Node versions match.

## [1.1.0]

Two parallel threads landing in the same release: a complete visual redesign of the web UI, and a substantial expansion of the Patreon URL workflow (multi-post UI, download filters, output flattening).

### Changes

- **New palette** — muted teal primary (replaces the shadcn violet defaults). Every color now flows through semantic tokens (`--success`, `--warning`, `--info`) defined under `:root` / `.dark` in `frontend/src/index.css`. Zero hardcoded color literals remain in `frontend/src/components/`.
- **New typography pairing** — Bricolage Grotesque Variable for display + headings, Geist Sans Variable for body/UI, JetBrains Mono Variable for filenames and IDs. Replaces the previous Inter default.
- **Spacious layout** — outer container bumped from `max-w-275` (~1100 px) to `max-w-screen-2xl` (1536 px) with fluid `px-6 sm:px-8 lg:px-12 xl:px-16` padding. Source / output row uses a CSS grid (`xl:grid-cols-[5fr_4fr]`) so wide displays breathe.
- **Header strip restructured** — left-aligned brand mark + tagline, right-aligned settings cluster (Dictionary button, Theme toggle). Hairline bottom border replaces the centered block.
- **Staggered page-load reveal** — header → source/output → tag editor → file browser fade-and-slide in over the first ~700 ms.
- **Patreon downloads now land at `AUDIO_ROOT/<post_id>/<original_filename>`** instead of buried five levels deep inside `AUDIO_ROOT/.patreon-dl/Patreon/<creator>/posts/<post_id>/audio/`. Original filename preserved; main file browser sees the audio directly without digging into `.patreon-dl/`. patreon-dl's own tree (post-api.json sidecars, status DB, per-campaign caches) stays untouched under `.patreon-dl/` for dedup.
- **Patreon downloads now default to audio-only** — images, videos, attachments are skipped unless explicitly enabled via the new Include strip. Behaviour change: existing users will see less content downloaded by default. Cover-image / thumbnail / thumbnail-preview files patreon-dl writes alongside `post-api.json` (gated on `include.content.info`, which we can't disable without losing the sidecar) are pruned post-fetch when the user hasn't opted into image content — only `info.txt` + `post-api.json` survive in `post_info/`.
- **Patreon re-fetches skip already-downloaded posts** — patreon-dl's `stop.on = previouslyDownloaded` is enabled unconditionally. Pulling the same creator URL twice only fetches new posts since the last run.

### Additions

- **Light / dark theme button** — Sun/Moon icon in the header settings cluster. On first ever visit follows `prefers-color-scheme`; after the user toggles, their choice persists in `localStorage`. An inline `<script>` in `index.html` applies the class before React mounts so dark-mode reloads don't flash.
- **Persistent status bar** — page footer shows `dict: N tags · model: <ollama> · v<version>` in muted mono numerals.
- **Collapsible file browser** — `Collapsible` wrapper around `FileBrowser` so the section can be hidden when not actively in use; closed by default with a summary trigger row.
- **`GET /api/system/info`** — small backend endpoint surfacing the Ollama model name + app version for the status bar.
- **Patreon multi-post UI** — when a creator URL returns multiple posts, the panel now renders every post as its own card (previously only `posts[0]` was shown). Each row has its own "Use for filename" button. The single-post URL UX is unchanged.
- **Patreon content-type filter** — new "Include" chip strip lets the user toggle Audio / Video / Images / Attachments. Audio-only by default; selection persists to `localStorage`.
- **Patreon date range filter** — two shadcn `DatePicker` fields (After / Before) under a "Published between" section. Popover-driven calendar built on `Popover` + `Calendar` + `react-day-picker`. Only meaningful for creator URLs; ignored by patreon-dl on single-post URLs.
- **Patreon dry-run preview** — checkbox alongside "Metadata only". Walks the patreon-dl pipeline without writing files. Returns no parsed posts (sidecar isn't written either) but the log tail shows what would have been downloaded. Status DB untouched, so the real fetch afterwards stays correct.

### Fixes

- **`stop.on` accepts a single value, not a CSV** — earlier attempt to combine `publishDateOutOfRange, previouslyDownloaded` made patreon-dl exit with `Config file option [downloader]->stop.on must be one of ...`. Picks one value based on context: date filter set → `publishDateOutOfRange`, otherwise → `previouslyDownloaded`. Per-post dedup of already-downloaded items is handled independently by patreon-dl's `use.status.cache` (default on), so we lose nothing.
- **`_collect_posts` filters stale sidecars by mtime** — re-fetches of the same URL used to surface every `post-api.json` ever written, including ones from prior runs where patreon-dl's status cache skipped re-downloading. Tracks fetch start time and only counts sidecars written during the current run.
- **`DialogContent` accessibility** — `DictionaryModal` now passes `DialogTitle` + `DialogDescription` (via `sr-only`) so screen readers get the right announcements. Was emitting a radix warning to the console without them.

### Other

- **Renamed stale components** — `OCRUploader` → `ScreenshotPanel` (OCR was replaced with the Ollama vision LLM); `FilenameOutput` → `OutputPanel` (renders both filename + metadata cards); `ParserTestPane` → `dictionary/DictionaryTester` (tests dictionary normalisation, not a generic parser).
- **Split oversized components per CLAUDE.md's "one component per file" + SRP** — `DictionaryModal` (814 lines) split into a 303-line shell plus `dictionary/{VocabularyPane,SuppressedPane,CookiePane}.tsx`. `FileBrowser` (765 lines) split into a 450-line shell plus `FileBrowserItem.tsx` (per-row JSX) and `SelectedFilePanel.tsx` (rename + convert work area). `TagChip.tsx` extracted from `TagsEditor` for its draggable / click-to-edit chip JSX.
- **DRY extractions** — `AsyncButton.tsx` (loading-state Button wrapper), `SectionLabel.tsx` (card header with leading dot + tone prop), `StatusLine.tsx` (one-line success/error/info feedback). Replaces 5+ duplicated blocks each in screenshot / patreon / dictionary panels.
- **shadcn primitives added** — `Collapsible`, `Tooltip`, `Popover`, `Calendar`. The first three reuse the already-installed `radix-ui` umbrella; `Calendar` pulls in `react-day-picker` + `date-fns` for the new Patreon date pickers. The shadcn CLI also re-emitted `button.tsx` with new `aria-expanded` / `aria-haspopup` affordances the Popover trigger needs — fully backward-compatible with existing call sites.
- **CRLF line endings enforced repo-wide** — `.gitattributes` (`* text=auto eol=crlf`) and `.vscode/settings.json` (workspace EOL default). Documented in `CLAUDE.md`. `dev.sh` is a per-file LF override so the Linux kernel can exec the shebang.
- **`/api/patreon/fetch` accepts new optional fields** — `content_types: list[str]`, `published_after`, `published_before`, `dry_run`. Response shape grows a top-level `dry_run: bool` flag.
- **`patreon_fetch.py` now invokes patreon-dl via a single temp config file** instead of mixing CLI flags with a metadata-only-specific temp config. All filters land as lines in `_write_config` — adding a new knob is one line.
- **New `PatreonResultsList.tsx` and `PatreonResultRow.tsx`** components for the multi-post layout.
- **CLAUDE.md tightened release-timing rule** — the `[Unreleased] → [x.y.z]` rename and the two package version bumps are explicitly a single atomic PR-prep step under a new "Preparing a PR" section. Caught by my previous cycle accidentally cutting `[1.1.0]` before a PR existed.
- **Bundled patched `patreon-dl` build** — the upstream 3.8.1 release ships a `PageParser` regex that no longer matches Patreon's current HTML, breaking every creator-URL fetch with `Initial data not found - no regex matches` (upstream [#134](https://github.com/patrickkfkan/patreon-dl/issues/134), [#135](https://github.com/patrickkfkan/patreon-dl/issues/135)). Two regex literals widened to allow attribute reordering, single/double quotes, and newlines in the embedded JSON. Built locally and packed to `vendor/patreon-dl/patreon-dl-3.8.1-localfix.tgz`; Dockerfile + devcontainer install from the tarball instead of npm. Reverting once upstream ships a fix is a two-line `Dockerfile` change + `rm` (see `vendor/patreon-dl/README.md`).

## [1.0.0]

First release of the LLM-pipeline rewrite. Consolidates everything between commit `290fe6f` (the OCR → Ollama swap) and now into one merge to main. The `feat!:` React/Vite migration justifies the major-version bump.

### Changes

- **Breaking** — frontend rewritten in **React + Vite + Tailwind v4 + shadcn/ui** (was vanilla JS/CSS). Dictionary UI redesigned around the LLM pipeline.
- **Replaced Tesseract OCR with a local Ollama vision model** (`qwen2.5vl:7b` by default) for screenshot title/tag extraction. Configured via `OLLAMA_BASE_URL` / `OLLAMA_MODEL` env vars.
- MP3 encoding switched to VBR; FLAC quality preset improved.

### Additions

- Audio metadata writing on rename (ID3 / FLAC / MP4 via `mutagen`) plus a forced-convert guard that blocks rename of formats that can't carry tags.
- Audio format conversion via `ffmpeg` with quality presets, batch convert mode, and an artist pre-fill in the rename UI.
- New **Patreon URL** input source — shadcn Tabs at the top of the left card switch between **Screenshot** and **Patreon URL**. Pasting a post or creator URL invokes the bundled [`patreon-dl@3.8.1`](https://github.com/patrickkfkan/patreon-dl) to download the audio under `AUDIO_ROOT/.patreon-dl/...` and pre-fills title, tags, and artist from the post's API metadata.
- **Metadata only** checkbox skips the audio download (faster path when the file is already on disk).
- **Patreon Cookie** tab in the Tag Dictionary modal: status badge, textarea, save/clear, and a DevTools walkthrough for grabbing the cookie from the browser.
- Title + tag normalisation pipeline shared between the screenshot and Patreon flows (`parseTitleLine` peels embedded pipe / parenthetical tags, then dictionary-normalised and deduped).
- Comprehensive shadcn/ui coverage and a redesigned tag-editing surface.

### Fixes

- Long parenthetical tags, multi-word pill tags, and test pane layout regressions from the React migration.
- When `patreon-dl` exits cleanly but downloads nothing, `/api/patreon/fetch` now returns `hint` + `log_tail` so the failure cause is visible without re-running the binary.

### Other

- Multi-stage production Dockerfile: builds the Vite SPA, installs `patreon-dl@3.8.1` globally, and bundles into a Python 3.14-slim runtime with Node 20 + ffmpeg. All config externalised via env vars (`AUDIO_ROOT`, `DB_PATH`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`).
- Devcontainer installs `patreon-dl@3.8.1` globally via `postStartCommand`.
- New `settings` key/value table in SQLite for storing the Patreon session cookie.
- New backend endpoints: `POST /api/patreon/fetch` (`{url, metadata_only?}` → `{output_dir, count, metadata_only, posts: [{post_id, title, tags, artist, post_dir, audio_path}], hint?, log_tail?}`), `GET`/`PUT /api/settings/patreon-cookie` (JSON or raw `text/plain` body).
- New `backend/patreon_fetch.py` wraps the patreon-dl subprocess and parses each `post-api.json` for title, user-defined tags, and the creator's `full_name` (artist).
- `.github/workflows/build_check.yml` (push/PR CI: lint + tsc + Vite build, Python syntax check) and `.github/workflows/release.yml` (workflow_dispatch → GHCR + draft release with parsed CHANGELOG body) added.
- `CLAUDE.md` added covering architecture, versioning, changelog discipline, commit conventions, and the GitHub Actions release flow.
- DRY refactor of `database.py` and shared patterns centralised across frontend (`lib/api.ts`, `lib/parser.ts`, `lib/types.ts`) and backend (route-level validators in `main.py`).
- README documents the new flow + Patreon endpoints + cookie setup.
- Added `dev.bat` for Windows hosts.

## [0.5.0]

### Additions

- Support pipe-separated ASMR titles from Patreon

## [0.4.1]

### Changes

- Rename `fbSearchIn` to `fbSearchMode` for clarity

## [0.4.0]

### Additions

- File browser search scoping (filename / folder / both)

### Changes

- Refactor pill tag extraction with prose detection and dual-strategy scanning

### Fixes

- Allow ellipsis in filename sanitization
- Improve OCR tag detection with fallback line scanning and Unicode normalization

### Other

- Expand documentation around the file browser and search scoping

## [0.3.0]

### Additions

- Comprehensive test pane for parser debugging
- Expand the default tag dictionary; add more dictionary tags

### Changes

- Use the parser's normalization logic for manual tag input
- Sanitize filenames for Windows / macOS / Linux compatibility

### Fixes

- Fix OCR misread of capital `I` as the pipe character
- Allow digits in OCR pill token matching
- Normalize smart quotes in OCR parsing
- Fix regex pattern ordering and escaping for split fixes

## [0.2.0]

### Additions

- Add PATCH endpoints and inline editing UI for dictionary management

### Changes

- Refactor dictionary UX to click-to-edit and improve styling

## [0.1.0]

### Additions

- Initial project — ASMR filename generator with OCR-based title and tag extraction
- File browser and rename functionality

### Other

- Separate the frontend into modular CSS and JS files
- Update README with file browser / rename features and remove outdated info
- Normalize line endings
