# Changelog

All notable changes to this project will be documented in this file.

The format is a simplified version of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):

- `Additions` — New features
- `Changes` — Behaviour / visual changes
- `Fixes` — Bugfixes
- `Other` — Technical changes / updates

## [Unreleased]

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
- **Browser extension companion (`extension/`)** — Manifest V3 for Chromium and Firefox 121+. One-click Patreon + Google cookie sync replaces the manual DevTools copy/paste, plus auto-capture of Google Drive audio URLs from Patreon posts. Includes a content-script Sync cookie pill on patreon.com, a popup UI for pending captures, and an options page for the backend URL.
- **Auto-download Drive captures** (extension setting, on by default). When the extension can resolve which Patreon post a captured Drive URL came from — via parent tab URL, `target="_blank"` opener-tab chain, or a 30-entry click-history ring buffer — it POSTs the capture to the backend automatically, no popup interaction needed.
- **`POST /api/patreon/ingest-external-audio`** — downloads a signed external audio URL into `LIBRARY_PATH/<post_id>/`. Streams via httpx to a `.part` temp file, renames on success. Embeds metadata via mutagen when the destination format supports it.
- **Drive / Mega / MediaFire / Dropbox links surfaced on post cards.** When a Patreon post body contains a link on an allowlisted file-host, the post card shows a collapsible *External Links* hint. (Only Drive currently has the one-click Download button — others surface as plain links the user opens manually.)
- **Google cookie storage** (`PUT/GET /api/settings/google-cookie`). Mirrors the existing Patreon-cookie endpoint shape — `GET` returns `{set, count, length}` (never the values), `PUT` accepts `{cookies: [...]}` (empty array clears).
- **Playwright + Chromium baked into the Docker images** for the Drive scrape. Adds ~180 MB to the image; one-time cost, cached in layers.

### Fixes

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
