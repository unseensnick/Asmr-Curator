/**
 * ASMR Workbench Companion — background service worker.
 *
 * One job: push the user's Patreon and Google session cookies to the local
 * backend so patreon-dl (Patreon) and the headless-Chromium Drive scrape
 * (Google) can authenticate. Triggered by SYNC_COOKIE messages from the
 * popup and the on-page pill.
 */

// Chrome MV3 uses `background.service_worker` with `importScripts`; Firefox/
// Zen MV3 use `background.scripts` and the helpers are already on
// `self.AsmrExt` before this file runs. Guard so we don't ReferenceError.
if (typeof importScripts === "function") {
  importScripts("lib/storage.js");
}

const browserApi = self.browser || self.chrome;
const { getBackendUrl } = self.AsmrExt;

// ── Cookie sync ───────────────────────────────────────────────────────────────
//
// Two flavours, called together by syncCookie():
//
//   • Patreon — collapsed into a single Cookie-header string for patreon-dl's
//     `--cookie` flag. Stored verbatim under PATREON_COOKIE_KEY in the DB.
//   • Google — sent as a JSON array of chrome.cookies.* entries. The Drive
//     scrape hands these to Playwright's `context.add_cookies()`, which
//     needs per-cookie shape rather than a header.

async function pushPatreonCookies(backendUrl) {
  const cookies = await browserApi.cookies.getAll({ domain: ".patreon.com" });
  if (!cookies.length) {
    return { ok: false, error: "No Patreon cookies found. Log in to patreon.com first." };
  }
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
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
  // Broad `.google.com` query covers `accounts.google.com`, `drive.google.com`,
  // and the umbrella — Drive auth is split across all three.
  const cookies = await browserApi.cookies.getAll({ domain: ".google.com" });
  if (!cookies.length) {
    return { ok: false, error: "No Google cookies found. Log in to google.com first." };
  }
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
  // Backend may drop entries missing required fields; trust its count over
  // the local one so the popup label matches what actually landed.
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
    // Patreon may have succeeded; report Google failure without rolling back.
    google = { ok: false, error: `Backend unreachable: ${err.message}` };
  }

  const ok = patreon.ok && google.ok;
  return {
    ok,
    patreon,
    google,
    cookieCount: (patreon.count || 0) + (google.count || 0),
    length: (patreon.length || 0) + (google.length || 0),
    error: ok ? null : [patreon.error, google.error].filter(Boolean).join("; "),
  };
}

// ── Message routing ───────────────────────────────────────────────────────────

browserApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Async branches return Promises — return `true` synchronously so the
  // messaging channel stays open until sendResponse fires.
  (async () => {
    try {
      switch (message && message.type) {
        case "SYNC_COOKIE":
          sendResponse(await syncCookie());
          return;
        case "GET_BACKEND_URL":
          sendResponse({ ok: true, backendUrl: await getBackendUrl() });
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
