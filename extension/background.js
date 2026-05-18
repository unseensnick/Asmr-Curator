/**
 * ASMR Workbench Companion — background service worker.
 *
 * Two jobs:
 *   1. Watch webRequest for audio responses from third-party hosts that
 *      Patreon posts commonly link to (Google Drive's playback CDN). When
 *      one is observed and meets the size threshold, clean the URL (drop
 *      `ump` + `range`), resolve it back to its source Patreon post, and —
 *      if auto-ingest is on — immediately POST it to the backend so the
 *      file lands in DOWNLOAD_PATH/<post_id>/ without any popup interaction.
 *   2. Serve runtime messages from the popup / content script:
 *        - SYNC_COOKIE       → push Patreon cookies to the backend
 *        - RECORD_CLICK      → log a Patreon → external-host <a href> click
 *        - GET_CAPTURES      → list capture candidates
 *        - INGEST_CAPTURE    → POST a chosen capture to the backend ingest endpoint
 *        - CLEAR_CAPTURES    → forget all candidates
 *        - GET_BACKEND_URL   → echo the configured backend URL
 *        - LIST_POSTS        → list post_id directories under DOWNLOAD_PATH (for the popup dropdown)
 */

// Shared helpers — loaded into the global scope of this background context.
//
// Chrome MV3 picks `background.service_worker` from manifest.json: we run in a
// service worker where `importScripts` is defined and must be called manually.
//
// Firefox / Zen MV3 picks `background.scripts` instead (their `service_worker`
// support is gated on a pref that's off by default in Zen). The scripts in
// that array are loaded by the runtime *before* this file, so the helpers
// are already on `self.AsmrExt` and there's nothing to import; calling
// `importScripts` would throw a ReferenceError outside a worker scope.
if (typeof importScripts === "function") {
  importScripts("lib/url-clean.js", "lib/post-id.js", "lib/storage.js");
}

const browserApi = self.browser || self.chrome;
const { cleanAudioUrl, probeSize, looksLikeAudio, MIN_AUDIO_BYTES } = self.AsmrExt;
const { postIdFromUrl, driveIdFromUrl } = self.AsmrExt;
const {
  getBackendUrl,
  addCapture,
  getCaptures,
  setCaptures,
  getAutoIngest,
  recordClick,
  findClickForDriveId,
  wasIngested,
  markIngested,
} = self.AsmrExt;

// Hosts whose audio responses we intercept. Keep this tight — the URL-cleaning
// trick (drop `ump` + `range`) is specific to Google's UMP-chunked playback.
// Other third-party hosts (Mega, Dropbox, MediaFire) are surfaced in the
// backend's `external_links` so the user can open them manually, but we don't
// intercept their network traffic.
const AUDIO_URL_FILTER = {
  urls: [
    "*://*.googlevideo.com/videoplayback*",
    "*://*.drive.google.com/videoplayback*",
    "*://*.googleusercontent.com/videoplayback*",
  ],
};

// ── Capture pipeline ──────────────────────────────────────────────────────────

async function getTab(tabId) {
  if (typeof tabId !== "number" || tabId < 0) return null;
  try {
    return await browserApi.tabs.get(tabId);
  } catch {
    return null;
  }
}

/**
 * Find the Patreon post URL associated with a captured Drive audio request.
 * Tries three strategies in order of confidence:
 *
 *   1. The request's tab is itself a Patreon page (embedded-iframe case).
 *   2. The request's tab was *opened by* a Patreon tab (`target="_blank"`,
 *      middle-click, Ctrl-click). `openerTabId` survives the navigation.
 *   3. Click history: the content script recorded an external-host <a href>
 *      click on patreon.com whose URL refers to the same Drive file ID that
 *      now appears as `driveid=` on the captured playback URL.
 *
 * Returns `{ patreonUrl, source }` where `source` is one of
 *   "parent" | "opener" | "click-history" | null.
 */
async function resolvePostFromCapture({ tabId, cleanedUrl }) {
  // (1) Parent tab URL.
  const tab = await getTab(tabId);
  if (tab && postIdFromUrl(tab.url)) {
    return { patreonUrl: tab.url, source: "parent" };
  }

  // (2) Opener tab (one hop — Patreon usually opens Drive in a single new tab).
  if (tab && typeof tab.openerTabId === "number") {
    const opener = await getTab(tab.openerTabId);
    if (opener && postIdFromUrl(opener.url)) {
      return { patreonUrl: opener.url, source: "opener" };
    }
  }

  // (3) Click history matched on Drive file ID.
  const driveId = driveIdFromUrl(cleanedUrl);
  if (driveId) {
    const record = await findClickForDriveId(driveId, driveIdFromUrl);
    if (record && postIdFromUrl(record.postUrl)) {
      return { patreonUrl: record.postUrl, source: "click-history" };
    }
  }

  return { patreonUrl: null, source: null };
}

function readContentType(headers) {
  if (!headers) return null;
  for (const h of headers) {
    if (h.name && h.name.toLowerCase() === "content-type") return h.value;
  }
  return null;
}

function readContentLength(headers) {
  if (!headers) return NaN;
  for (const h of headers) {
    if (h.name && h.name.toLowerCase() === "content-length") {
      const n = parseInt(h.value, 10);
      return Number.isFinite(n) ? n : NaN;
    }
  }
  return NaN;
}

/**
 * Update the toolbar badge whenever the capture count changes. Tiny visual
 * confirmation that the SW is actually doing something.
 */
async function refreshBadge() {
  const list = await getCaptures();
  const text = list.length > 0 ? String(list.length) : "";
  try {
    await browserApi.action.setBadgeText({ text });
    if (text) await browserApi.action.setBadgeBackgroundColor({ color: "#7c3aed" });
  } catch {
    // action.* unavailable in some contexts — non-fatal
  }
}

browserApi.webRequest.onCompleted.addListener(
  async (details) => {
    try {
      const mime = readContentType(details.responseHeaders);
      if (!looksLikeAudio({ url: details.url, mime })) return;

      const cleanedUrl = cleanAudioUrl(details.url);

      // Idempotency: a Drive player issues many range requests for the same
      // file. We may have already ingested this URL earlier in the session.
      if (await wasIngested(cleanedUrl)) return;

      // Size gate: prefer the response header (already known to be present
      // for the in-flight request), fall back to the URL's `clen` param.
      let size = readContentLength(details.responseHeaders);
      if (!Number.isFinite(size) || size === 0) {
        size = await probeSize(cleanedUrl);
      }
      if (!Number.isFinite(size) || size < MIN_AUDIO_BYTES) return;

      const { patreonUrl, source } = await resolvePostFromCapture({
        tabId: details.tabId,
        cleanedUrl,
      });
      const resolvedPostId = postIdFromUrl(patreonUrl);

      const entry = {
        cleanedUrl,
        size,
        mime: mime || null,
        capturedAt: Date.now(),
        parentUrl: patreonUrl || null,
        resolvedPostId: resolvedPostId || null,
        resolveSource: source,
        autoIngested: false,
      };
      await addCapture(entry);
      await refreshBadge();

      // Auto-ingest: when we have a confident post_id and the user hasn't
      // disabled it in options, push to the backend immediately. Failures
      // leave the capture in the pending list so the popup can be used as
      // a manual fallback.
      if (resolvedPostId && (await getAutoIngest())) {
        const result = await ingestCapture({
          cleanedUrl,
          postId: resolvedPostId,
        });
        if (result.ok) {
          await markIngested(cleanedUrl);
        } else {
          console.warn("[asmr-ext] auto-ingest failed", result.error);
        }
      }
    } catch (err) {
      console.warn("[asmr-ext] capture failed", err);
    }
  },
  AUDIO_URL_FILTER,
  ["responseHeaders"],
);

// ── Message routing ───────────────────────────────────────────────────────────

// ── Cookie sync ───────────────────────────────────────────────────────────────
//
// Two flavours, called together by syncCookie():
//
//   • Patreon: collapsed into a single Cookie-header string. That's the shape
//     patreon-dl wants via its `--cookie` flag, and the backend stores it
//     verbatim under PATREON_COOKIE_KEY.
//
//   • Google: sent as a structured JSON array. The backend's Drive scrape
//     (`/api/patreon/ingest-drive-link`) hands these to Playwright's
//     `context.add_cookies()`, which needs per-cookie shape, not a header.

async function pushPatreonCookies(backendUrl) {
  const cookies = await browserApi.cookies.getAll({ domain: ".patreon.com" });
  if (!cookies.length) {
    return { ok: false, error: "No Patreon cookies found. Log in to patreon.com first." };
  }
  const cookieHeader = cookies
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const response = await fetch(`${backendUrl}/api/settings/patreon-cookie`, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: cookieHeader,
  });
  if (!response.ok) {
    return { ok: false, error: `Patreon-cookie endpoint returned ${response.status}` };
  }
  return { ok: true, count: cookies.length, length: cookieHeader.length };
}

async function pushGoogleCookies(backendUrl) {
  // Pull cookies for the broad .google.com umbrella — Drive auth is split
  // across `.google.com`, `accounts.google.com`, `drive.google.com`, etc.,
  // and the broad query returns all of them.
  const cookies = await browserApi.cookies.getAll({ domain: ".google.com" });
  if (!cookies.length) {
    return { ok: false, error: "No Google cookies found. Log in to google.com first." };
  }
  // Backend normalises into Playwright shape; we just need to pass through the
  // raw chrome.cookies entries (name, value, domain, path, secure, httpOnly,
  // sameSite, expirationDate).
  const response = await fetch(`${backendUrl}/api/settings/google-cookie`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookies }),
  });
  if (!response.ok) {
    return { ok: false, error: `Google-cookie endpoint returned ${response.status}` };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  // Backend may drop entries missing required fields; trust its reported count
  // over the local one so the popup label is honest.
  return { ok: true, count: body.count ?? cookies.length, length: body.length ?? 0 };
}

async function syncCookie() {
  const backendUrl = await getBackendUrl();
  let patreon, google;
  try {
    patreon = await pushPatreonCookies(backendUrl);
  } catch (err) {
    return { ok: false, error: `Backend unreachable at ${backendUrl}: ${err.message}` };
  }
  try {
    google = await pushGoogleCookies(backendUrl);
  } catch (err) {
    // Patreon may have succeeded; report Google failure but don't roll back.
    google = { ok: false, error: `Backend unreachable: ${err.message}` };
  }

  const ok = patreon.ok && google.ok;
  return {
    ok,
    patreon,
    google,
    // Legacy fields kept for the existing popup / content-script labels.
    cookieCount: (patreon.count || 0) + (google.count || 0),
    length: (patreon.length || 0) + (google.length || 0),
    error: ok ? null : [patreon.error, google.error].filter(Boolean).join("; "),
  };
}

async function ingestCapture({ cleanedUrl, postId, filename }) {
  if (!postId) return { ok: false, error: "post_id is required" };
  const capture = (await getCaptures()).find((c) => c.cleanedUrl === cleanedUrl);
  if (!capture) return { ok: false, error: "Capture not found" };

  const backendUrl = await getBackendUrl();
  let response;
  try {
    response = await fetch(`${backendUrl}/api/patreon/ingest-external-audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        post_id: String(postId).trim(),
        source_url: cleanedUrl,
        filename: filename || undefined,
      }),
    });
  } catch (err) {
    return { ok: false, error: `Backend unreachable: ${err.message}` };
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      detail = await response.text().catch(() => "");
    }
    return { ok: false, error: `Backend returned ${response.status}: ${detail}` };
  }
  const body = await response.json();
  // Successful ingest — record the URL as ingested (idempotency guard for
  // re-captures during the same session) and drop the pending entry.
  await markIngested(cleanedUrl);
  const list = (await getCaptures()).filter((c) => c.cleanedUrl !== cleanedUrl);
  await setCaptures(list);
  await refreshBadge();
  return { ok: true, audioPath: body.audio_path, size: body.size };
}

async function listRecentPosts() {
  const backendUrl = await getBackendUrl();
  try {
    // post_id directories are under DOWNLOAD_PATH (ingest staging),
    // not LIBRARY_PATH (the user's curated archive).
    const response = await fetch(`${backendUrl}/api/files?root=downloads`);
    if (!response.ok) return { ok: false, error: `Backend returned ${response.status}` };
    const data = await response.json();
    // Directories at the DOWNLOAD_PATH root correspond to patreon post_ids.
    // Filter to numeric-looking names.
    const posts = (data.entries || [])
      .filter((e) => e.type === "dir" && /^\d+$/.test(e.name))
      .map((e) => ({ post_id: e.name }));
    return { ok: true, posts };
  } catch (err) {
    return { ok: false, error: `Backend unreachable: ${err.message}` };
  }
}

browserApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Fire-and-forget messages from the content script: handle without keeping
  // the messaging channel open. When a click on a Patreon post link triggers
  // navigation to Drive, the originating tab is gone before any async work
  // finishes — keeping the channel open just produces "Promised response …
  // went out of scope" warnings in the browser console.
  if (message && message.type === "RECORD_CLICK") {
    recordClick(message.payload || {}).catch((err) => {
      console.warn("[asmr-ext] recordClick failed", err);
    });
    return; // no `return true` — sender doesn't await
  }

  // The async branches all return Promises — return `true` synchronously so
  // the messaging channel stays open until sendResponse fires.
  (async () => {
    try {
      switch (message && message.type) {
        case "SYNC_COOKIE":
          sendResponse(await syncCookie());
          return;
        case "GET_CAPTURES":
          sendResponse({ ok: true, captures: await getCaptures() });
          return;
        case "INGEST_CAPTURE":
          sendResponse(await ingestCapture(message.payload || {}));
          return;
        case "CLEAR_CAPTURES":
          await setCaptures([]);
          await refreshBadge();
          sendResponse({ ok: true });
          return;
        case "GET_BACKEND_URL":
          sendResponse({ ok: true, backendUrl: await getBackendUrl() });
          return;
        case "LIST_POSTS":
          sendResponse(await listRecentPosts());
          return;
        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  })();
  return true;
});

// Ensure the badge is correct after a service-worker restart.
refreshBadge();
