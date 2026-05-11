# Changelog

All notable changes to this project will be documented in this file.

The format is a simplified version of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):

- `Additions` — New features
- `Changes` — Behaviour / visual changes
- `Fixes` — Bugfixes
- `Other` — Technical changes / updates

## [Unreleased]

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
