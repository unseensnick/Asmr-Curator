# ASMR Workbench Companion (browser extension)

A small Manifest V3 extension that syncs your **Patreon** and **Google**
session cookies to the local ASMR Workbench backend. Both cookies are
needed by the backend:

- **Patreon cookie** → `patreon-dl` uses it to authenticate against
  patreon.com when fetching post metadata and Patreon-hosted audio.
- **Google cookie** → the backend's `/api/patreon/ingest-drive-link`
  endpoint hands it to a headless Chromium session that loads Drive
  viewer pages and intercepts the audio playback URL. Without it, view-
  only files behind a Drive share return a login page.

The extension also still includes the older in-browser audio-capture
mode for cases where the server-side Drive scrape can't run (kept as a
fallback; see below). That mode watches Google's playback hosts in
your live browser, cleans the URL, and POSTs it to
`/api/patreon/ingest-external-audio`. With the server-side scrape
working, you shouldn't normally need it.

## Install

The extension is unpacked-load only (not on the Chrome Web Store / AMO).

### Chromium (Chrome, Edge, Brave)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and pick the `extension/` directory.
4. Click the puzzle-piece icon → pin "ASMR Workbench Companion" so it stays
   in the toolbar.

### Firefox (121+)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `extension/manifest.json`.

   > Note: Firefox unloads temporary add-ons when the browser restarts. For
   > persistent installs, sign and self-distribute the XPI via Mozilla's
   > add-on developer hub.

## First-time setup

1. Click the extension icon → **Settings** (top-right of the popup).
2. Set the **Backend URL** to wherever the workbench is reachable. Default
   is `http://localhost:8000`. Click **Test connection** to confirm the
   backend responds.
3. Log into [patreon.com](https://www.patreon.com) **and**
   [google.com](https://accounts.google.com) (or any signed-in Google
   surface) in the same browser profile.
4. Visit any Patreon page — a floating "Sync Patreon cookie" pill appears
   in the bottom-right. Click it once; the status updates to e.g.
   `Synced 12 Patreon + 47 Google ✓`. (Or open the extension popup →
   **Sync Patreon + Google cookies**.)

After this, both cookies are in the backend's settings table.
`patreon-dl` and `/api/patreon/ingest-drive-link` will work without
further interaction until your sessions expire (Patreon ~30 d, Google
~14 d typical).

Partial syncs are surfaced separately — if you're not signed into Google
the popup reports `Synced 12 Patreon · Google: No Google cookies found`.
You can sync just Patreon now and Google later when you next visit.

## Capturing external audio

The common workflow:

1. Open a Patreon post that links to a Google Drive audio file.
2. Click the Drive link in the post body. The Drive viewer opens (in a new
   tab or the same tab — both work).
3. Press play.
4. The extension captures the playback URL the moment its size reaches
   ≥ 400 KB, strips `ump` and `range`, and — by default — immediately POSTs
   it to the backend. The file lands at `AUDIO_ROOT/<post_id>/<filename>`
   with no popup interaction. Toolbar badge briefly shows the pending
   capture count, then clears once the download completes.

If you'd rather confirm each download by hand, open **Settings** and
uncheck **Auto-download captures when post is detected**. Captures will
then stay in the popup awaiting a manual **Download** click.

The popup is also the fallback when auto-resolution can't pin a capture
to a Patreon post (e.g. you pasted a Drive URL directly without clicking
through from Patreon). In that case the capture sits there until you
type the `post_id` and click **Download**.

## How `post_id` is auto-detected

Three strategies, tried in order:

1. **Parent tab URL.** If the audio request fires from a tab whose URL is
   a Patreon post (`https://www.patreon.com/posts/some-title-12345` →
   `post_id = 12345`), use that. Covers the "embedded player inside the
   post page" case.
2. **Opener tab.** If the Drive tab was opened *from* a Patreon tab via
   `target="_blank"`, middle-click, or Ctrl-click, the browser keeps a
   reference to the opener. The extension follows that one hop.
3. **Click history.** The content script records every external-host
   `<a href>` click on patreon.com (post URL + link URL, last 30 entries,
   1 h TTL). When an audio request fires, the captured URL's `driveid=`
   is matched against recent clicks — if the same file ID was clicked
   from a post, that post wins. Covers same-tab navigation cases where
   the opener relationship is lost.

If all three fail, the popup falls back to manual `post_id` entry.

In the popup, each capture row tells you which strategy (if any) resolved
it: `auto · same tab`, `auto · opener tab`, `auto · click history`, or
`no post detected — enter post_id below`.

## Permissions, in plain language

| Permission                       | Why                                                                       |
| -------------------------------- | ------------------------------------------------------------------------- |
| `cookies` + patreon.com host     | Read Patreon session cookies to forward to the local backend.             |
| `webRequest` + Google hosts      | Observe audio responses from Drive's playback CDN.                        |
| `storage`                        | Persist the backend URL (sync) and pending capture list (session).        |
| `tabs`                           | Look up the parent tab URL to auto-resolve `post_id`.                     |
| `http://localhost/*`             | POST to the local backend.                                                |

No data leaves your machine except the requests you explicitly make to your
own backend.

## Files

```
extension/
├── manifest.json
├── background.js          ← service worker: webRequest listener, post_id resolver,
│                            auto-ingest, message router
├── content_script.js      ← Sync-cookie pill + external-link click tracker
├── popup.html / popup.js  ← toolbar popup UI
├── options.html / options.js   ← backend URL + auto-download toggle
└── lib/
    ├── url-clean.js       ← cleanAudioUrl(): strips ump + range
    ├── post-id.js         ← postIdFromUrl(), driveIdFromUrl()
    └── storage.js         ← captures, click history, ingested-URL set, settings
```

## Backend prerequisites

The extension talks to the existing backend; nothing extra to deploy. The
endpoints it uses:

- `PUT  /api/settings/patreon-cookie` — sync cookie (raw `text/plain` body).
- `POST /api/patreon/ingest-external-audio` — `{ post_id, source_url }`,
  downloads the URL into `AUDIO_ROOT/<post_id>/`.
- `GET  /api/files` — used to list existing `post_id` directories under
  `AUDIO_ROOT` when no parent post was detected.

The backend currently has no CORS middleware, so the extension's
`chrome-extension://…` / `moz-extension://…` origin is accepted by default.
If you later add CORS hardening, allow those origins explicitly.
