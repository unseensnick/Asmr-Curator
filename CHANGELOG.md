# Changelog

All notable changes to this project will be documented in this file.

The format is a simplified version of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):

- `Additions` — New features
- `Changes` — Behaviour / visual changes
- `Fixes` — Bugfixes
- `Other` — Technical changes / updates

## [Unreleased]

### Additions

- **`External` Include chip — surface body-link-only posts.** Posts whose only audio is a Drive (or other third-party) URL in the body text used to be silently dropped by `patreon-dl`'s `posts.with.media.type` filter when the default `["audio"]` selection was active. The new chip widens patreon-dl's walk to every accessible post (same code path `metadata_only=true` already uses) while still letting any other selected chips drive what gets downloaded. The per-link **Download** button in `ExternalLinksHint` is the trigger for actually pulling Drive audio. Opt-in, sticky via localStorage. `backend/patreon_fetch._write_config` now unifies the two "walk every post" cases under a single `walk_all_posts` rule. `_extract_external_links` was also broadened from `<a href>`-only scanning to five sources: `<a href="…">`, `<iframe src="…">`, plain-text `https://…` URLs inside the post body, `attributes.embed.url` for posts that used Patreon's "Add link / embed" UI, and a recursive walk over `attributes.content_json_string` — the **ProseMirror JSON** document Patreon's newer post editor produces in place of HTML (the HTML `content` field is `null` for those posts; the body lives only in the JSON tree as `link` marks on text nodes and `attrs.{href,url,src}` on image/embed nodes). UI copy for the empty-state row was also fixed — used to say "metadata-only fetch — no audio downloaded" even when not in metadata-only mode; now it stays silent if external links were found, or surfaces *"No Patreon-hosted audio and no recognised external links — open the post manually to check"* when both are absent.
- **Server-side Drive scrape via Playwright (`POST /api/patreon/ingest-drive-link`).** New backend module `backend/drive_fetch.py` resolves a Drive viewer URL → cleaned playback URL → downloaded file in one call. Uses headless Chromium (Playwright) with the synced Google session cookie to load `drive.google.com/file/d/<id>/view`, programmatically starts playback through three sequenced strategies, since Drive's YouTube-embed sits in *cued state* (poster + big play button) until externally provoked: (a) Playwright `.click()` on the iframe element itself, delivering a synthetic user click at the iframe's centre; (b) raw `page.mouse.click()` at the viewport centre as belt-and-braces, separated from (a) by a 0.5 s settle; (c) direct `<video>/<audio>.play()` across all frames as a final fallback for non-YouTube viewers. (An earlier attempt to also `postMessage` the IFrame Player API `{event: "command", func: "playVideo"}` was removed — Drive's `hbenv=apps-elements` embed registers the command handler but its internal player object exposes `playVideo` via a minified property the handler doesn't know about, so the call lands on `this.aa.playVideo` which doesn't exist, throws, and breaks the player's state machine. Drive's jserror endpoint captured the error in our diagnostic dump.) Chromium launches with `--autoplay-policy=no-user-gesture-required` so the programmatic `.play()` isn't rejected by the headless gesture requirement. Playwright's `APIRequestContext.get` default 30 s timeout is overridden to the configured `DOWNLOAD_TIMEOUT_S` (30 min) — its internal timer covers the entire request including body read, and the default was killing multi-megabyte transfers mid-stream with a 200-OK header already received. The cleaned URL also strips a third query parameter besides `ump`/`range`: **`srfvp`** ("single request, first valid position" — Drive's CDN honours it by capping the response to a tiny initial range regardless of `range=`, which was returning ~1 KB stubs on cleaned URLs). The capture listener has no size gate: earlier rounds gated on a response `Content-Length` ≥ 400 KB (with and without a `clen=` URL fallback), but diagnostic dumps showed Drive serving some files in many small chunks — none individually past that threshold — even though each was a valid signed playback URL whose cleaned form returned the full file. Every `videoplayback?…` response on a recognised Drive playback host is now accepted; the post-download < 50 KB sanity check on the `.part` body is the real "did we get a real file" gate, and any probe-shape regression surfaces via the diagnostic dump. Within the captured candidates, the listener **prefers the audio stream (`itag=140`, AAC-LC m4a) over the video stream (`itag=134`, mp4)**: Drive serves both in parallel for cover-art audio releases, so after the first eligible URL is captured the main flow waits up to 5 s (`AUDIO_PREFERENCE_GRACE_S`) for an `itag=140` URL to appear and swaps to it. Without this, the listener took whichever stream fired first — usually the video — and the user got a multi-MB `.mp4` containing only a still image plus the audio track instead of the `.m4a` they actually wanted. Files genuinely lacking an audio itag (true video uploads) fall back to the first capture after the grace window, preserving today's behaviour. **Sign-in redirect detection**: when the synced Google cookies have expired or are missing the critical session set, Drive 302s the headless session through `accounts.google.com/v3/signin/identifier` — previously the scrape would spend the full 90 s player-wait timeout staring at the login page and then surface a misleading "no videoplayback request observed" error. Now `fetch_drive_audio` checks `page.url`'s hostname immediately after `page.goto` resolves, and if it's on `accounts.google.com` raises a new `code="auth_expired"` error within ~1-2 s with a message telling the user to click the extension's **Sync cookie** button. The `IngestDriveLinkEvent` error-code TypeScript union widens accordingly. **Concurrent scrapes are serialised server-side via an `asyncio.Semaphore` (default capacity 1, override via `DRIVE_SCRAPE_CONCURRENCY` env var)**: clicking Download on all 4 Drive links in a post simultaneously used to return 1124-byte stubs for 3 of 4 because every Playwright playback session triggers `accounts.google.com/RotateCookies` mid-stream and 4 sessions for the same Google account race the rotation — only the last wins server-side and the others get probe-shape bodies on follow-up fetch. The lock gates the `fetch_drive_audio` call inside `/api/patreon/ingest-drive-link`; contested requests emit a new `"queued"` SSE event with the `ahead` count so the UI renders *"Queued — N download(s) ahead"* rather than looking frozen. **Filenames now come from the link's anchor text instead of `<post_id>_<unix_ts>.<ext>`**: `_extract_external_links` now returns `list[ExternalLink]` (each with `url` and `text` fields), captured via a fuller `<a href="…">visible text</a>` regex and the ProseMirror walk's link-mark + text-node pairing. The frontend renders the text as the visible link label (with the URL on hover via `title`) and passes it to the ingest endpoint as the explicit filename; `safe_filename_component` gained a UTF-8 byte-aware truncation at 200 bytes so emoji-heavy titles stay below the 255-byte filesystem cap. **Download timeout raised from 30 minutes to 4 hours** (override via `DRIVE_DOWNLOAD_TIMEOUT_S` env var) so multi-hour ASMR files (3-hour sleep audios at ~37 KB/s observed throughput need ~75 min and were getting cut off mid-flight); the captured `videoplayback` URL's own `expire=` parameter is typically ~6 hours from emission, so 4 hours leaves comfortable headroom without risking URL expiry mid-download. After capture, `ump`+`range` are stripped and the file is downloaded via **the same Playwright browser context** using `context.request.get()` — an earlier httpx-based download was silently zero-bodied by Drive's CDN because the cleaned URL is fingerprinted against its originating session (TLS, HTTP/2, cookies, request shape), and any out-of-session follow-up gets headers but no body. A < 50 KB sanity check before the `.part`→target rename catches probe-shape regressions defensively. The endpoint returns a `text/event-stream` with stage-by-stage progress events (`launching_browser` → `loading_page` → `waiting_for_player` → `captured` → `downloading` → `done`); the frontend's per-row Download button in `ExternalLinksHint` consumes the stream and shows a live label ("Loading Drive page (1.2s)", "Downloading… 14.3s", "Saved to …"). Player-wait timeout is 90 s to absorb cold-start launches + slow networks. On timeout, a sanitised diagnostic dump (viewport screenshot, redacted URL trace, no page HTML) lands in `<AUDIO_ROOT>/.drive-debug/<file_id>-<ts>/` with a README warning about the screenshot's potential account-UI exposure. Replaces the manual "click → DevTools → filter audio → wait → copy URL → strip → paste → download" sequence with one button click in the workbench UI. **The Chromium browser + BrowserContext are now persistent across queued scrapes** (lazily launched on first request, idle-closed after `DRIVE_BROWSER_IDLE_TIMEOUT_S` seconds — default 300 s). Sharing the *context* (not just the browser) plugs a second cookie-handoff failure mode: Google's mid-playback `RotateCookies` calls land in the live context's cookie jar, so subsequent queued scrapes inherit the rotated session naturally — same as a real browser. Per-scrape cold-start drops from ~3-5 s to ~0.2-0.5 s after the first download. The cookie-PUT endpoint calls `drive_fetch.invalidate_shared_context()` so a manual re-sync forces a fresh context (without touching any in-flight scrape, which is shielded by the scrape semaphore). The idle-close timer is cancelled at scrape start and re-armed at scrape end so a 700 s download can't be killed mid-stream. A FastAPI `shutdown` event handler closes the shared Chromium cleanly on server stop. **Download is now streamed to disk via an in-page `fetch()` reader + `page.expose_function` chunk callback** instead of Playwright's atomic `APIResponse.body()`. The JS-side runs `fetch(cleaned_url, {credentials: 'include'})` (preserving the player's exact TLS / cookie / origin fingerprint that Drive's CDN minted the URL for), gets a `ReadableStream` reader, and pumps each base64-encoded chunk to a Python callback via `window.__driveDownload`. Python decodes per chunk, writes straight to the `.part` file, and increments a shared byte counter. The 500 ms heartbeat reads that counter (plus a `Content-Length` total captured from a one-shot headers callback) and emits real `{bytes, total}` SSE events — so the row label shows true `Downloading X.X MB / Y.Y MB (NN%)` instead of `Downloading… 32.0s`. Memory stays bounded at chunk size (~16-64 KB typical fetch reads) regardless of total file size, eliminating the latent ~500-700 MB OOM risk on 6-8 hour sleep audios. (Chrome DevTools Protocol was tried first via `Network.takeResponseBodyAsStream`, but that method lives in the `Fetch` domain and requires `Fetch.enable` request interception — too much surface area for a one-shot download. The expose_function pattern is equivalent in capability with much less code.)
- **Google cookie storage (`PUT/GET /api/settings/google-cookie`).** New `google_cookie` settings key, stored as JSON-encoded array of Playwright-shaped cookie objects. Backend reshapes browser cookies (Chrome / Firefox sameSite quirks normalised) before storage. Endpoint shape mirrors `/api/settings/patreon-cookie` — `GET` returns `{set, count, length}` (never the values), `PUT` accepts `{cookies: [...]}` (empty array clears).
- **Extension: dual cookie sync.** The existing **Sync Patreon cookie** button now pulls cookies for `.google.com` too and pushes them to the new backend endpoint. Mixed outcomes are surfaced separately ("Synced 12 Patreon + 47 Google" / "Patreon: …; Google: not logged in") so the user knows if they need to log into one service before retrying. New `https://*.google.com/*` host permission.
- **Shared audio utility module (`backend/audio_utils.py`).** Extracted from `main.py`: `strip_query_params`, `safe_filename_component`, `filename_from_content_disposition`, `ext_from_content_type`, `unique_destination`, `derive_filename`. Used by both `main.ingest_external_audio` and `drive_fetch.fetch_drive_audio` — single source of truth for the URL-cleaning and filename-derivation semantics so the two ingest paths can't drift.
- **Playwright + Chromium baked into both Docker images.** Devcontainer Dockerfile and production Dockerfile both `playwright install --with-deps chromium` after the pip install. Adds ~180 MB to the image; one-time, cached in layers; no impact on container restart.
- **Browser extension: zero-touch capture for the click-link-then-play workflow.** Earlier the extension auto-resolved `post_id` only when the Drive player was embedded as an iframe *inside* the Patreon post (so the parent tab was a Patreon URL). Real Drive links open in a separate tab, breaking that. Three new resolution paths in order: (1) parent tab URL — the original embedded-iframe case; (2) `tab.openerTabId` chain — handles `target="_blank"` / Ctrl-click / middle-click Drive opens; (3) click history — the content script now records every external-host `<a href>` click on patreon.com along with the source post URL (30-entry ring buffer, 1 h TTL in `chrome.storage.session`), and the background matches the captured URL's `driveid=` against recent clicks to recover the post. When any path resolves the post and the new `autoIngest` setting is on (default), the capture is POSTed to `/api/patreon/ingest-external-audio` immediately — no popup interaction required. Idempotency guard via `chrome.storage.session.ingestedUrls` prevents re-ingest if the player re-issues the same URL. New `Auto-download captures when post is detected` toggle in the options page; popup capture rows now show the resolution source (`auto · same tab` / `auto · opener tab` / `auto · click history`).
- **Browser extension (`extension/`)** — Manifest V3 companion for Chromium and Firefox 121+. One-click Patreon cookie sync (reads cookies via `chrome.cookies.getAll` and POSTs to `/api/settings/patreon-cookie`, replacing the DevTools copy/paste step), and audio-URL capture for third-party hosts embedded in Patreon posts: watches Google playback hosts via `chrome.webRequest`, strips `ump` + `range` so the server returns the full file instead of a chunk, and hands the cleaned URL to the new ingest endpoint. Includes a content-script "Sync cookie" pill on patreon.com, popup UI listing pending captures, and an options page for the backend URL.
- **`POST /api/patreon/ingest-external-audio`** — downloads a signed external audio URL into `AUDIO_ROOT/<post_id>/`. Streams via `httpx.AsyncClient` to a `.part` temp file, renames on success. Derives filename from `Content-Disposition` or `<post_id>_<timestamp>.<ext>` fallback. Embeds metadata via mutagen when the destination format supports it.
- **`external_links` in Patreon fetch response** — `_parse_post_api` now scans the post body HTML for `<a href>` URLs whose host is in the allowlist (`drive.google.com`, `mega.nz`, `mediafire.com`, `dropbox.com`) and surfaces them in each `PatreonPost`. The post cards render a collapsible "external links" hint pointing the user to the browser extension.
- **`.claude/` config tree** — bootstrapped from the dotclaude template and tailored to this stack: slim `CLAUDE.md` (under 25 non-blank lines), path-scoped rules for frontend / backend / security / error handling / database / architecture / release-prep, project-workflow rules for commits + changelog discipline, hardened settings.json permissions (narrow Bash allowlist, deny rules for the SQLite cookie store), and PreToolUse hooks for secret scanning, file protection, and dangerous-command blocking. See `.claude/rules/` for rule scopes.

### Fixes

- **Metadata-only re-fetch of a single-post URL serves the cached sidecar without spawning patreon-dl.** When the user re-fetched a post URL with **Metadata only** checked, patreon-dl's `stop.on = previouslyDownloaded` + status cache made it skip the post entirely (no fresh `post-api.json` written this run); the mtime-filtered `_collect_posts` then returned empty and the frontend showed *"No new posts were fetched. Most common cause: every matching post is already in patreon-dl's status cache from a previous run …"* — even though the metadata was sitting on disk from the original fetch. The user's workaround was to delete `.patreon-dl/` and re-fetch from scratch. Now `backend/patreon_fetch.fetch()` runs a fast-path check **before** invoking patreon-dl: a new `_post_id_from_url(url)` parses the post ID out of the URL, `_find_cached_post(output_dir, post_id)` walks the output tree for a matching `post-api.json` (no mtime filter), and on a hit we return immediately without spawning the subprocess at all — removing the ~all of the original latency (Node startup + network round-trip + db.sqlite touch) for what is otherwise a pure filesystem read. The audio_path lookup also probes the flattened `AUDIO_ROOT/<post_id>/` location for audio that an earlier non-metadata-only fetch moved out of patreon-dl's tree, so cached posts with on-disk audio surface correctly. Scoped to single-post URLs only; creator URLs in metadata-only mode would otherwise dump every post ever cached under that creator. First-time fetches and creator URLs fall through to the normal patreon-dl flow.
- **`DB_PATH` default no longer leaks state outside the workdir on Windows** — `backend/database.py` used to default to the POSIX absolute path `/data/dictionary.db`, which Docker and the devcontainer override but a host-side `uvicorn backend.main:app` run on Windows does not. Python resolves a leading-slash path against the current drive root on Windows, so the default silently created `E:\data\dictionary.db` (plus stray `E:\tmp\AUDIO_ROOT\fake_post\` from related test fixtures) outside the repo. A new `_default_db_path()` helper detects `os.name == "nt"` and resolves to `<repo>/data/dictionary.db` instead. No change inside Docker or the devcontainer; both already pass `DB_PATH` explicitly.
- **Path traversal in `validate_audio_path`** — replaced the `str.startswith` containment check with `Path.is_relative_to`, closing the sibling-directory bypass (`/mnt/audio_evil/...` no longer satisfies a check against `/mnt/audio`). Affects every file-rooted route (`/api/files*`, `/api/rename`, `/api/convert`, `/api/patreon/ingest-external-audio`).
- **`/api/extract` now caps the base64 image at 32 MB** (≈ 24 MB binary). A multi-MB paste used to OOM the worker before validation; rejected with 413 now.
- **Patreon session cookie no longer passes through subprocess argv** — written to the temp patreon-dl config file (mode 0600, unlinked after the run) instead of `--cookie <value>`. Stops leaking through `/proc/<pid>/cmdline` on shared hosts. `_scrub_cookie` also redacts any literal occurrence from the log tail before it's returned to the API.
- **`/api/files/search` rewritten** — pushes the audio-extension filter into the `os.walk`, prunes hidden and `.patreon-dl` / cache subtrees in place, caps results at 500 with a `truncated: true` flag, and sorts only the kept entries. Eliminates the O(all-files) materialisation on every keystroke.
- **`/api/convert` error response** — full ffmpeg stderr now logs server-side; the API returns a generic message so internal filesystem paths don't leak.
- **`/api/patreon/ingest-external-audio` response** — `audio_path` is always relative to `AUDIO_ROOT` (`Path.relative_to`); no more fallback to the absolute server path.
- **`_validate_iso_date`** — accepts only valid calendar dates via `date.fromisoformat` (the prior regex passed `9999-99-99` through to `patreon-dl`, which errored unhelpfully).
- **Dictionary panes (`VocabularyPane`, `SuppressedPane`)** — `handleAdd` / `handleDelete` / `handleSave` now catch backend errors (notably 409 duplicate-canonical) and surface them inline. Previously they became silent unhandled promise rejections.
- **`api.ts` now has request timeouts** via `AbortController`. Defaults: 60 s general, 120 s extract/preview, 600 s convert/ingest, 30 min patreon-fetch. Aborted requests throw a clear "Request timed out after Ns" error.
- **`useClipboard`** — `.catch` on the `writeText` promise (clipboard rejects in insecure contexts) and `clearTimeout` on unmount, fixing the "setState on unmounted component" warning.
- **`SelectedFilePanel` timers** — `setRenamed(false)` / `setConverted(false)` cleanups are tracked in refs and cleared on unmount; rename's `metadata_error` partial-success path is now surfaced via the error banner instead of silently swallowed.
- **`FileBrowser` mount-only fetch** — deferred until the collapsible is opened. Previously every page load walked the whole `AUDIO_ROOT` even when the panel stayed closed.
- **`parser.ts` no longer silently truncates titles to 120 chars** when the title has no parenthetical and no pipe split. Surprising behaviour for long Patreon titles.
- **`PatreonPanel` error rendering** — split the `log tail: ...` suffix off the backend error message before display; the noisy tail (which can include absolute container paths from `patreon-dl`) goes into the existing expandable log surface instead of the status banner.

### Other

- **`backend/patreon_fetch.py`** — `AUDIO_EXTS` is now sourced from `frontend/src/lib/audio-formats.json`, the same single source of truth that `backend/main.py` and the frontend already read. Stops the local hardcoded list from drifting from the canonical one.
- **patreon-dl: switched to upstream 3.9.0 from npm.** Upstream closed the `__NEXT_DATA__` parser regressions tracked in issues [#134](https://github.com/patrickkfkan/patreon-dl/issues/134) and [#135](https://github.com/patrickkfkan/patreon-dl/issues/135) in their 3.9.0 release. `vendor/patreon-dl/` and the locally-patched tarball are deleted; `Dockerfile` and `.devcontainer/devcontainer.json` install `patreon-dl@3.9.0` from npm. No more custom build to maintain.
- **`.devcontainer/devcontainer.json` no longer hardcodes a personal audio-library path.** The `mounts` entry now reads `source=${localEnv:AUDIO_PATH}`, the same env var docker-compose already uses. Set `AUDIO_PATH` in your shell environment (or VS Code launch context) before reopening the container. Existing local overrides can be kept invisible to git via `git update-index --skip-worktree .devcontainer/devcontainer.json`.
- **`.claude/hooks/block-dangerous-commands.sh`** — added patterns for `git checkout -- <file>`, `git restore <file>`, `git stash drop|pop|clear`, and `git branch -D` (all destroy uncommitted/stashed work).
- **`.claude/hooks/scan-secrets.sh`** — added a heuristic for Patreon session-cookie shapes assigned to `session_id` / `patreon_cookie` / `patreon_session` literals, with the usual env-var / placeholder exemptions.
- **`.claude/hooks/protect-files.sh`** — blocks edits to `*.db` / `*.sqlite` / `*.sqlite3` / anything under `data/` (where the Patreon cookie is stored).
- **README** — refreshed project-structure block (added `patreon_fetch.py`, replaced renamed component names), added a `.env`/`AUDIO_PATH` setup step before `docker compose up`, a "Pull from GHCR" alternative, a "Reopen in Container" instruction for the devcontainer flow, and a new "Audio Conversion" API-reference section with `/api/convert` + `/api/convert/formats`.

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
