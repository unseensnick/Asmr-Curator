# ASMR Curator Companion (browser extension)

A small Manifest V3 extension that syncs your **Patreon** and **Google**
session cookies to the local ASMR Curator backend. Both cookies are
needed by the backend:

- **Patreon cookie** → `patreon-dl` uses it to authenticate against
  patreon.com when fetching post metadata and Patreon-hosted audio.
- **Google cookie** → the backend's `/api/patreon/ingest-drive-link`
  endpoint hands it to a headless Chromium session that loads Drive
  viewer pages and intercepts the audio playback URL. Without it,
  view-only files behind a Drive share return a login page.

Scope: cookies only. Drive downloads themselves are triggered by the
**Download** button on each post's External Links collapsible inside the
app — the backend does the scraping server-side using the cookies the
extension synced. The extension does not watch network traffic, does
not auto-capture URLs, and does not need `webRequest`.

## Install

The extension is unpacked-load only (not on the Chrome Web Store / AMO).

### Chromium (Chrome, Edge, Brave)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and pick the `extension/` directory.
4. Click the puzzle-piece icon → pin "ASMR Curator Companion" so it stays
   in the toolbar.

### Firefox (121+)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `extension/manifest.json`.

   > Note: Firefox unloads temporary add-ons when the browser restarts.
   > For persistent installs, sign and self-distribute the XPI via
   > Mozilla's add-on developer hub.

## First-time setup

1. Click the extension icon → **Settings** (top-right of the popup).
2. Set the **Backend URL** to wherever the backend is reachable.
   Default is `http://localhost:8000`. Click **Test connection** to
   confirm the backend responds.
3. Log into [patreon.com](https://www.patreon.com) **and**
   [google.com](https://accounts.google.com) (or any signed-in Google
   surface) in the same browser profile.
4. Visit any Patreon page — a floating **Sync cookies** pill appears in
   the bottom-right. Click it once; the status updates to e.g.
   `Synced 12 Patreon + 47 Google ✓`. (Or open the toolbar popup and
   click **Sync Patreon + Google cookies**.)

After this, both cookies are stored in the backend. `patreon-dl` and
the Drive scrape will work without further interaction until your
sessions expire (Patreon ~30 d, Google ~14 d typical).

Partial syncs are surfaced separately — if you're not signed into
Google the popup reports `Synced 12 Patreon · Google: No Google
cookies found`. You can sync just Patreon now and Google later when
you next visit.

## Permissions, in plain language

| Permission                       | Why                                                                       |
| -------------------------------- | ------------------------------------------------------------------------- |
| `cookies` + patreon.com host     | Read Patreon session cookies to forward to the local backend.             |
| `cookies` + google.com host      | Read Google session cookies to forward to the local backend.              |
| `storage`                        | Persist the backend URL (sync storage).                                   |
| `http://localhost/*`             | POST cookies to the local backend.                                        |

No data leaves your machine except the requests you explicitly make to
your own backend.

## Files

```
extension/
├── manifest.json
├── background.js          ← service worker: cookie sync handlers
├── content_script.js      ← Sync-cookies pill injected on patreon.com
├── popup.html / popup.js  ← toolbar popup UI (single Sync button)
├── options.html / options.js   ← backend URL setting
└── lib/
    └── storage.js         ← backendUrl persistence
```

## Backend endpoints used

- `PUT /api/settings/patreon-cookie` — raw `text/plain` body, the
  collapsed Cookie-header string.
- `PUT /api/settings/google-cookie` — `application/json` body
  (`{ cookies: [...] }`), array of `chrome.cookies.getAll` entries
  that the backend normalises into Playwright shape.
- `GET /api/dictionary` — used by **Test connection** in Settings as
  a cheap ping.

The backend currently has no CORS middleware, so the extension's
`chrome-extension://…` / `moz-extension://…` origin is accepted by
default. If you later add CORS hardening, allow those origins
explicitly.

## What's no longer here

Earlier versions of this extension watched Google's playback CDN via
`webRequest` and auto-POSTed captured URLs to the backend. That path
has been removed: the in-app **Download** button on each Drive link
inside a Patreon post is the explicit replacement, runs entirely
server-side via headless Chromium using the cookies the extension
just synced, and gives proper progress events (SSE). The popup no
longer carries a captures list; **Settings** no longer carries the
auto-download toggle.
