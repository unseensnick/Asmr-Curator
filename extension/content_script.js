/**
 * Content script on patreon.com pages.
 *
 * Two jobs:
 *   1. Inject a floating "Sync Patreon cookie" pill so the user can push
 *      session cookies to the backend without opening the extension popup.
 *   2. Track clicks on external-host links inside Patreon posts. When the
 *      audio request later fires from a Drive (or other) tab opened by
 *      that click, the background script uses the recorded click to
 *      recover which Patreon post the file belongs to. Without this, the
 *      parent-tab-URL trick fails for the common "click a link, get
 *      navigated to Drive" workflow.
 *
 * lib/url-clean.js and lib/post-id.js are loaded ahead of this script
 * (see manifest.content_scripts), so AsmrExt.* helpers are available.
 */
(function () {
  if (window.top !== window.self) return; // only in the top frame
  const browserApi = window.browser || window.chrome;

  // Hosts whose <a href> clicks should be recorded as "originated from a
  // Patreon post". Mirrors the backend's EXTERNAL_HOST_ALLOWLIST. Drive is
  // the host the extension knows how to capture audio from; the others are
  // included so a future capture path for them can use the same click history.
  const EXTERNAL_HOST_ALLOWLIST = [
    "drive.google.com",
    "mega.nz",
    "mediafire.com",
    "dropbox.com",
  ];

  function isAllowlistedExternalHost(host) {
    if (!host) return false;
    const lower = host.toLowerCase();
    return EXTERNAL_HOST_ALLOWLIST.some(
      (h) => lower === h || lower.endsWith("." + h),
    );
  }

  const STYLE = `
    .asmr-ext-pill {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #fff;
      background: rgba(124, 58, 237, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 999px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      cursor: pointer;
      user-select: none;
      transition: transform 0.12s ease, opacity 0.18s ease;
    }
    .asmr-ext-pill:hover { transform: translateY(-1px); background: rgba(124, 58, 237, 1); }
    .asmr-ext-pill[data-status="ok"]    { background: rgba(34, 197, 94, 0.95); }
    .asmr-ext-pill[data-status="err"]   { background: rgba(239, 68, 68, 0.95); }
    .asmr-ext-pill[data-status="busy"]  { background: rgba(100, 116, 139, 0.95); cursor: progress; }
    .asmr-ext-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255, 255, 255, 0.9); }
  `;

  function inject() {
    if (document.getElementById("asmr-ext-pill")) return;
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    const pill = document.createElement("button");
    pill.id = "asmr-ext-pill";
    pill.className = "asmr-ext-pill";
    pill.type = "button";
    pill.innerHTML = `<span class="asmr-ext-dot"></span><span data-label>Sync Patreon cookie</span>`;
    pill.addEventListener("click", onClick);
    document.body.appendChild(pill);
  }

  function setLabel(text, status) {
    const pill = document.getElementById("asmr-ext-pill");
    if (!pill) return;
    pill.querySelector("[data-label]").textContent = text;
    if (status) pill.dataset.status = status;
    else delete pill.dataset.status;
  }

  async function onClick() {
    setLabel("Syncing…", "busy");
    let response;
    try {
      response = await browserApi.runtime.sendMessage({ type: "SYNC_COOKIE" });
    } catch (err) {
      setLabel(`Failed: ${err.message || err}`, "err");
      return;
    }
    if (!response) {
      setLabel("Failed: no response", "err");
      return;
    }
    // Mixed outcome possible: e.g. Patreon ok, Google not logged in. Surface
    // the actual breakdown rather than a single "ok/fail" so the user knows
    // whether they need to log into Google before retrying.
    const parts = [];
    if (response.patreon?.ok) parts.push(`${response.patreon.count} Patreon`);
    if (response.google?.ok) parts.push(`${response.google.count} Google`);
    if (!parts.length) {
      setLabel(`Failed: ${response.error || "unknown"}`, "err");
      return;
    }
    setLabel(
      (response.ok ? "Synced " : "Partial — ") + parts.join(" + ") + " ✓",
      response.ok ? "ok" : "err",
    );
    setTimeout(() => {
      const pill = document.getElementById("asmr-ext-pill");
      if (pill) pill.remove();
    }, 2500);
  }

  // ── External-link click tracker ────────────────────────────────────────────
  //
  // Capture phase (third arg `true`) so we see clicks before any framework
  // handler can preventDefault or stopPropagation. We never call those
  // ourselves — Patreon's normal navigation handling is unchanged.

  function handleClick(event) {
    // Ignore non-primary buttons unless modifier keys (those open new tabs).
    if (event.button !== 0 && event.button !== 1) return;
    const anchor = event.target instanceof Element
      ? event.target.closest("a[href]")
      : null;
    if (!anchor) return;
    let parsed;
    try {
      parsed = new URL(anchor.href, location.href);
    } catch {
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    if (!isAllowlistedExternalHost(parsed.hostname)) return;
    // Fire-and-forget — we never await this to avoid delaying the navigation.
    browserApi.runtime
      .sendMessage({
        type: "RECORD_CLICK",
        payload: {
          postUrl: location.href,
          externalUrl: parsed.toString(),
          ts: Date.now(),
        },
      })
      .catch(() => {
        // Background may be asleep / restarting — losing one click record is
        // acceptable; user can still use the manual fallback in the popup.
      });
  }

  document.addEventListener("click", handleClick, true);
  // Auxclick fires for middle-click (button 1), which the default click
  // listener doesn't always see. Use the same handler.
  document.addEventListener("auxclick", handleClick, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject, { once: true });
  } else {
    inject();
  }
})();
