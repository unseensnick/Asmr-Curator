# Changelog

All notable changes to this project will be documented in this file.

The format is a simplified version of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):

- `Additions` — New features
- `Changes` — Behaviour / visual changes
- `Fixes` — Bugfixes
- `Other` — Technical changes / updates

## [Unreleased]

## [2.0.4]

### Changes

- **Patreon downloads now land at `DOWNLOAD_PATH/<creator>/<post_id> - <post_title>/<file>`** instead of a flat `<post_id>/<file>`. The Downloads tab is browsable by creator at a glance instead of squinting at numeric post IDs. Drive ingest + external-audio ingest now follow the same layout when the calling post's metadata is available (legacy `<post_id>/` is still accepted as a fallback). Existing downloads at the old layout stay where they are.

### Additions

- **Downloads now uses the same selection model as Library** — single-click selects, double-click opens, Shift/Ctrl/Cmd-click and drag-select extend, Ctrl/Cmd+A selects all, Del deletes the whole selection. Cut/paste and New folder remain Library-only (Downloads is staging, not a place to file things into).
- **Hover any file row in the FileBrowser to see the full filename + path.** Long names that the row truncates stay legible without selecting the file or right-clicking.
- **Right-click an unrecognised tag chip to add it to your dictionary.** Pick "As new canonical tag", or "As alias of…" with a searchable popover over your existing canonicals. The warning tint clears automatically once the entry lands, no detour into the Dictionary modal needed.

### Other

- **Backend logger renamed `asmr_workbench` → `asmr_curator`.** Visible in log aggregators that filter by logger name; no behaviour change.

## [2.0.3]

### Fixes

- **FileBrowser stays on whichever tab you're on after a move.** Auto-switching to Library every time made batching files out of Downloads a chore. Selection clears, both lists refresh in place, you pick the next file from where you were.
- **Move-with-rename now writes the metadata tags too.** Ticking *Apply rename* during a Move-to-library used to move and rename the file but silently drop the title / artist / album fields you'd filled in. They're embedded now alongside the rename — same end state as hitting Rename and then Move, in one click.
- **Rename form's artist field stays in sync with the "from \<artist\>" caption above.** Running a Patreon or Screenshot extract after picking a file now refills the artist box too; previously only the initial file selection triggered the pre-fill.
- **Move-to-library picker remembers your last destination across files** — it and the library explorer Sheet share one position now, so filing multiple files into the same subfolder doesn't re-walk the tree each time. Switching root inside the Sheet also preserves each root's position separately.
- **Rename-and-embed-metadata during a move is now opt-in via checkbox** (was opt-out). Missing the checkbox no longer silently combines the two operations when the user only intended a plain move.
- **`docker compose up --build` no longer chokes on Windows hosts.** A `.dockerignore` excludes the host venv, `node_modules`, `.git`, `data/`, and other dev-only directories — sidesteps the Linux symlink Docker on Windows can't traverse, and drops build-context transfer from ~72 MB to a few MB everywhere.

## [2.0.2]

### Other

- **Releases can carry a browser-extension zip as a downloadable asset**, attached by a separate `Release Extension` workflow. The extension is versioned independently with its own `extension/CHANGELOG.md`; release notes for the zip come from there.

## [2.0.1]

### Fixes

- **Cold-load dictionary failure is no longer silent.** A backend hiccup at boot used to leave the app sitting with an empty vocabulary and no signal anything was wrong — tags wouldn't match canonical forms, and the user assumed the whole tool was broken. A warning banner now surfaces under the header with a Retry button when the initial `/api/dictionary` fetch fails.
- **Generate filename disables itself when the title is empty.** Previously the button flashed the title input red on click; now it greys out preemptively with a "Add an audio title first" tooltip, so the affordance is visible before the click instead of as a reaction to it.
- **Single-modal invariant at the app root.** LibraryConfigModal (Dictionary) and CookiesModal (Manage cookies) can no longer both be open simultaneously — opening either now closes the other first, avoiding the Radix focus-scope fight from nested right-side sheets.
- **Drive download retries when the CDN returns a stub body.** Previously a Drive download could fail with `fetch_failed` whenever the CDN served only the ~1 KB init segment instead of the full audio; the workaround was clicking Download again. The backend now retries the same URL up to 4 times (configurable via `DRIVE_DOWNLOAD_RETRIES`) and surfaces the attempt count in the progress event (`Retry 2/4: Downloading…`). If all retries exhaust, the error suggests waiting a minute or two and trying again — the failure usually clears on its own.

### Additions

- **Browse files Sheet (dual-root explorer).** A `Browse` button in the FileBrowser toolbar opens a right-side Sheet with a persistent left rail that switches between Library and Downloads in one click — position is preserved across opens so batch-filing into one subfolder is one navigation. Inside a root: recursive subdir-scoped filter, right-click-anywhere context menu (with keyboard-shortcut hints in each item), F2 / Del / `N` hotkeys, three-mode Delete confirmation that surfaces the first 5 item names on bulk deletes so a drag-select-induced mistake catches at the confirmation step. Library rows announce as a `role="listbox"` with `aria-multiselectable` and `role="option"`; the move-progress banner is `aria-live="polite"`. Replaces the previous host-subprocess "Open in OS" approach, which never worked for the project's actual deployment target (Unraid / TrueNAS / Proxmox Docker containers).
- **Multi-file move via cut/paste in Library.** Single-click selects, Shift- and Ctrl/Cmd-click extend, drag-select rubber-bands a rectangle (with auto-scroll near edges), double-click activates, Ctrl/Cmd+A selects all visible rows. Ctrl/Cmd+X stages the selection as a cut (translucent rows + "N items ready to move" banner); navigate elsewhere and Ctrl/Cmd+V (or right-click → Paste here) commits via the new `POST /api/move/batch` SSE endpoint, with the banner updating live (`Moving 3 / 5…`) so cross-mount batches don't look frozen. `/api/move` itself gained folder-move support with cycle protection, so the batch can ship whole subtrees; multi-Delete routes through one rolled-up confirmation. Downloads keeps its single-click-opens model — multi-select is Library-only.
- **`POST /api/delete`** — new endpoint that deletes a file (`unlink`), an empty folder (`rmdir`), or a non-empty folder (`shutil.rmtree`, requires `recursive=true` from the client after a user prompt). Non-empty folder + `recursive=false` returns 409 with `{ count, path }` so the UI can prompt with the right copy. Refuses to delete the root directory itself; scoped via the same `root` field as the rest of the file endpoints.
- **`POST /api/rename-path`** — general renamer that works on files and folders. Distinct from `/api/rename`, which is file-only and combines the rename with optional ID3/FLAC/MP4 metadata embed. Drives the Library explorer's Rename action.
- **`POST /api/move/batch`** — partial-success batch wrapper around `/api/move`. Body: `{ items: [{from_path, new_name?}], from_root, to_subdir }`. Streams `text/event-stream` (`started` / per-item `item` / final `complete`) so the client can show live progress; each `shutil.move` runs in `asyncio.to_thread` so a slow cross-mount copy never blocks the event loop. The `complete` event's payload (`{ moved, results: [{from_path, ok, to_path?, error?}] }`) is the canonical aggregate the client refreshes against.
- **`DOWNLOAD_PATH` / `LIBRARY_PATH` split** — ingest and library are now two separate roots instead of a single shared mount. Patreon-dl, Drive scrape, and external-audio downloads land in `DOWNLOAD_PATH` (ingest staging); your curated archive lives in `LIBRARY_PATH` and stays free of raw `<post_id>/` folders. Both env vars are required; the backend errors on startup if either is unset or they're the same path. Upgrading: point `DOWNLOAD_PATH` at your old `LIBRARY_PATH` location so existing downloads keep working as Downloads-tab content, and set `LIBRARY_PATH` to a fresh curated archive — nothing is moved automatically.
- **FileBrowser now has Library and Downloads tabs.** Library is the default tab (your curated archive); Downloads surfaces what's waiting in `DOWNLOAD_PATH` with a pending-count badge so forgotten downloads don't sit unnoticed. Selecting a file in either tab opens the existing rename/convert work area, scoped to that root.
- **Move-to-library flow inside the work area.** Every selected file carries a `Move to library` collapsible with a folder-tree picker rooted at `LIBRARY_PATH` — breadcrumb navigation, drill-in by click, inline `+ New folder`. The `Move here` button commits, and if the user has a generated filename preview that differs from the current name, an inline checkbox offers to apply that rename during the move as a single server call.
- **Patreon Apply bridge link.** After Apply, a small `↗ Rename and move <filename>` link appears under the apply-status banner. Clicking it jumps to the FileBrowser Downloads tab, selects the downloaded file, and scrolls into view so the rename + move flow is one click away.

### Changes

- **Browser extension scoped to cookies-only.** The `webRequest`-based Drive URL auto-capture is removed; the extension now only syncs your Patreon + Google session cookies. Drive downloads continue to work through the in-app `Download` button on each post's External Links collapsible — that path scrapes server-side via headless Chromium using the cookies the extension just synced, and gives proper SSE progress events the auto-capture never did. The popup drops to a single Sync button, Settings drops the auto-download toggle, and the manifest no longer requests `webRequest` or Drive/googlevideo/googleusercontent host permissions.
- **API surface gained a `root` parameter on every file endpoint.** `/api/files`, `/api/files/search`, `/api/files/debug`, `/api/rename`, and `/api/convert` accept `root: "library" | "downloads"` (defaults to `"library"`). New endpoints: `POST /api/mkdir`, `POST /api/move`, `POST /api/move/batch`, `POST /api/rename-path`, `POST /api/delete`. The existing client contract for the default-`library` use cases is unchanged; new callers (Downloads tab, move picker, Patreon ingest endpoints) supply the root explicitly.

### Other

- **App rebranded to *ASMR Curator* and repaletted around cool slate surfaces, a quiet teal-cyan accent, and a warm cream foreground.** The header carries the brand mark, a `Dictionary · N` button with live tag count, and a Settings dropdown (theme, Power mode, read-only Model + Version). The old StatusBar is folded into the menu. Tagline reads "A quiet place for your audio library."
- **Three-column workspace dashboard on widescreen.** At ≥ 1280px the page distributes as Source ⏐ Title & Tags ⏐ Output across the top row with the file library full-width below; at 1024-1279px Source + Output go side-by-side with Tags + Library full-width; below 1024px the 1-col vertical stack is preserved. Reading order is Source → Edit → Output → Library at every breakpoint. The columns no longer render as bordered cards — the grid gap and individual form fields carry the separation. Page container caps at 2560px on ultrawide so the columns scale into the room instead of leaving 30% gutters.
- **Patreon panel is one persistent surface.** The URL input stays visible at all times — paste a new URL and press Enter to start a fresh fetch without clicking "Fetch another" first. Results appear inline below the options section; the fetch pulse-bar and loading text appear under the URL during work; the results list caps at 28rem and scrolls internally so 15+ post creator URLs don't push the file library off-screen.
- **Patreon fetch options are a segmented control:** *Full fetch · Info only · Preview*. Replaces two mutually-exclusive checkboxes that read like independent toggles but weren't. Includes content-type filter chips (Audio / Video / Images / Attachments / External) built on the shadcn `ToggleGroup` primitive — same vocabulary as the fetch-mode segmented control above it.
- **Creator URLs in *Info only* mode take the cached-sidecar fast path.** Previously only single-post URLs short-circuited when every post was on disk; creator URLs always shelled out to patreon-dl. Both flavours now skip the subprocess when the cache has the answer, with a slugified-artist fallback for sidecars that don't carry `campaign.vanity`.
- **Title & Tags editor redesigned.** Sentence-case inline labels (*Audio title*, *Tags*, *Format*, *Add a tag*, *Generate filename*) replace the old uppercase 10px section labels. Tag chips render in mono, the drag handle reveals on hover/focus, and the whole chip body is the click-to-edit target (keyboard: Enter/Space when focused). Extracted creator name surfaces as `from <artist>` above the title input. Format suffix normalizes on blur (trim + uppercase) so typos like `f4a` don't propagate. The tag chip tray hides itself when there are no tags — the Add-tag input sits alone until the first chip exists. Tags not in the dictionary render with a faint warm-amber tint and a "Not in your dictionary yet" tooltip.
- **Output panel collapsed to a single surface with two labeled rows.** *Filename* and *Tag string* (renamed from "Metadata"). Empty rows show muted-italic placeholders inside the same surface so the structure is visible before anything's generated. Both rows pulse their border for 600 ms when their value changes and carry `aria-live="polite"`. A small mono separator badge (`-` next to Filename, `|` next to Tag string) makes the two rows legible at a glance.
- **Bracket-stripping in the metadata title handles all leading and trailing [brackets], unbounded length.** Was: only the first leading `[...]` block up to 50 chars was removed, so titles like `[EXCLUSIVE] [27:23] Soft Whispers` kept the `[27:23]` and titles ending in `[FREE]` kept the trailing marker. Mid-title brackets are left alone. Output checkbox copy now reads "Drop [bracket] markers from the edges of the metadata title".
- **Generate filename is a content-width outline button**, right-aligned. Fetch from Patreon is the only filled-teal full-width CTA in the top-of-fold so the visual hierarchy reads start-here → refine → output.
- **Primary CTA icons match their actions.** Fetch from Patreon → `Download`, Extract from screenshot → `ScanSearch`, Generate filename → `Sparkles`. Was: the same Sparkles glyph led all three.
- **Screenshot panel adopts the same panel surface as Patreon.** `bg-card` outer, `bg-muted/40` preview surface, dashed drop zone, plain-prose status banner. Ctrl+V on the Screenshot tab pastes an image directly without needing to click into the panel first (window-level paste listener that bails out when an input / textarea / contenteditable is focused). Lightbox backdrop uses `bg-background/90 backdrop-blur-md` (no `#000` literals).
- **Power mode** (Settings → Power mode) persists across sessions and is the global controller of every panel's "More options" disclosure: on means open, off means closed. Users can still flip the disclosure within a session; the next Power mode change resets it.
- **Library settings and Cookies are right-side Sheets**, not centered dialogs. The main workspace stays visible while editing the dictionary or pasting cookies. Cookies are no longer nested inside the Tag dictionary modal — they live in their own surface opened from the Settings dropdown's *Manage cookies* item. New `frontend/src/components/ui/sheet.tsx` primitive (right-side, capped at `max-w-2xl/3xl/4xl`); Dialog backdrop tinted to a `--scrim` token instead of pure black.
- **Tag Dictionary side-nav layout.** Settings-style left nav on desktop (Vocabulary, Suppressed terms, Test extraction, Cookies), horizontal tab strip below md. Clicking anywhere on a vocab row enters edit mode; rows are draggable to reorder; entry order controls which canonical wins on contested aliases (last-write-wins, the entry lower in the list wins on lookup). Reorder disabled while a search filter is active. DictionaryTester's per-tag rows surface as Matched / Novel / Suppressed pills; the button copy reads "Previewing" instead of "Asking LLM".
- **Contested aliases flagged on existing vocabulary rows, not only while typing one.** Every alias chip checks the full vocabulary and renders with an amber tint + `AlertCircle` glyph when another entry also claims it; the tooltip names the other claimant and says which entry currently wins lookup.
- **CookiePane covers Patreon + Google.** Two status rows (`CheckCircle2` / `AlertCircle` / `Loader2`) with "Connected, N stored" / "Not connected" / "Checking" copy; Clear works on either. The manual paste textarea is Patreon-only (Google cookies are a structured array). The help drawer leads with the browser extension as the recommended one-click path, then a DevTools fallback for Patreon.
- **Cookie nagging moved to where the failure happens.** The persistent "Set your Patreon cookie first" warnings in the header and under the URL input are gone; a fetch failure surfaces a "Set Patreon cookie" action directly under its error banner. Manage cookies still lives in the Settings dropdown for explicit access.
- **File library, rename, and convert surfaces redesigned around a two-column layout.** Searchable file list left, rename / convert work area right, stack on narrow viewports. File rows render filenames and folder paths in mono; the selected-row highlight is a full-row warm tint, not a side stripe. Batch convert mode replaces the work area on the right column instead of appearing alongside a single-file selection. Required-conversion shows a clear warning banner with the actual reason. The internal split is `3fr_4fr`, mirroring the page's `3fr_4fr_3fr` dashboard grammar.
- **The file library mounts collapsed regardless of viewport** so the filesystem walk fires on click instead of every page load.
- **Native `confirm()` / `alert()` replaced with themed AlertDialog.** Four sites: Reset-to-defaults in Library settings, Import-failed notice, and the two Clear-cookie confirmations in the Cookies modal. Browser-native dialogs broke the visual system (white system chrome, generic OK/Cancel typography, no theme awareness). New `frontend/src/components/ui/alert-dialog.tsx` primitive (`role="alertdialog"`, shared `bg-scrim/30` backdrop).
- **Destructive-color semantics tightened.** Vocabulary entries confirm before deletion (was: instant delete on Trash click). Suppressed-term chips at rest use neutral muted styling instead of red; only the X button hovers to destructive. The power-mode indicator dot uses `bg-foreground/60` instead of `bg-primary` so the teal accent stays reserved for CTAs and active filter chips.
- **Selected-state and overlay-radius vocabulary consolidated.** All "active state" surfaces (Library settings side-nav, filter chips, ToggleGroup separator/sort/conversion controls) use the same full-accent treatment. Dialog corner radius drops from `rounded-4xl` to `rounded-2xl` to match AlertDialog and the Sheet's left edge.
- **Muted-label vocabulary normalized across the three top panels.** One muted-label voice (`text-sm font-medium tracking-wide text-muted-foreground`) instead of two — `FieldGroup` and the "Saved to" label dropped their `text-xs uppercase font-semibold` styling.
- **Copy and label cleanup.** Source / Edit / Output column labels removed (the inside of each column is already self-evident). Tags button in the header keeps its "Tags · N" label on every viewport. File-rename separator toggle shows the actual character alongside the word ("Dashes (-)" / "Pipes (|)"). Patreon source-column empty state expanded from a four-word hint to a two-clause scene-setter.
- **Spinner idiom unified on lucide `Loader2`.** Seven hand-rolled `<span border-2 ... animate-spin />` rings across AsyncButton, StatusLine, DictionaryTester, SelectedFilePanel, FileBrowser, and ScreenshotPanel are replaced. One spinner everywhere.
- **Long status/error messages no longer stretch source panels.** PatreonPanel and ScreenshotPanel StatusBanners get `max-w-prose break-words` so long backend errors or unbreakable URLs wrap inside the column.
- **Multi-post result rows use the body sans, not the display font.** PatreonResultRow's title at body size (14-15px) was below where the display font reads cleanly; the single-post result headline at heading size still uses display.
- **Token-hygiene pass on five chrome arbitrary values.** OutputPanel uniform `text-sm` mono; TagsEditor Format/Generate row uses `[10rem_1fr]` (rem-aligned); BookOpen icon scaled to match surrounding 14/16/18 scale; AlertTriangle banner icons at `size={16}` for appropriate alert weight.
- **CI passes on a clean checkout.** Frontend lint honors the `_`-prefix unused-vars convention via a `@typescript-eslint/no-unused-vars` override. Backend pytest finds the `backend` package via `pythonpath = [".."]` in `pyproject.toml` (CI doesn't set `PYTHONPATH`). The Windows-only `_default_db_path` test is skipped on non-Windows runners.
- **Frontend lint, tsc, build, and tests are clean against eslint-plugin-react-hooks v7.** The new `react-hooks/set-state-in-effect` rule flagged eight legitimate callsites: three reset-on-navigation effects refactored to handle the reset at the call site that caused the navigation; five data-fetching effects kept the synchronous setState with line-targeted `eslint-disable-next-line` directives and NOTE: comments. `vite.config.ts` and `vitest.config.ts` are now separate files so vitest 2.x's bundled Vite 5 doesn't clash with the project's Vite 8 on shared type augmentations. FastAPI's deprecated `@app.on_event("shutdown")` migrated to the `lifespan` context-manager pattern.
- **Backend `pyproject.toml` declares `httpx` and `mutagen`.** They were already in `requirements.txt` (the Docker prod path) but missing from `pyproject.toml` (the `uv sync` devcontainer path), so `uv run pytest` failed with `ModuleNotFoundError` at test-collection time. Both files now list the same direct deps.
- **Vite dev server uses polling for file changes.** Docker Desktop's bind mount from Windows or macOS doesn't propagate `inotify` events into the Linux devcontainer, so the watcher is configured with `server.watch.usePolling: true` at 300ms in `frontend/vite.config.ts`. Adds ~1-3% idle CPU; HMR triggers on save as expected.
- **`AUDIO_EXTS` consolidated.** The backend's audio-extension list reads from `frontend/src/lib/audio-formats.json` — the same source of truth the UI uses.
- **patreon-dl upgraded to upstream 3.9.0 from npm.** The previous vendored 3.8.1 patch is no longer needed; upstream closed the `__NEXT_DATA__` parser regressions in 3.9.0.
- **Devcontainer audio path is templated.** The `mounts` entry in `.devcontainer/devcontainer.json` reads `${localEnv:LIBRARY_PATH}` instead of a hardcoded personal path.
- **`.claude/` config tree.** Bootstrapped from the dotclaude template and tailored to this stack: path-scoped rules, hardened settings.json permissions, PreToolUse hooks (secret scanning, file protection, dangerous-command blocking).
- **README refresh** — corrected project structure, added `.env` / `LIBRARY_PATH` setup step, a *Pull from GHCR* alternative, a *Reopen in Container* devcontainer instruction, and an *Audio Conversion* API reference.

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
