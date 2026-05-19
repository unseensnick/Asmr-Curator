/**
 * Content script on patreon.com pages. Injects a floating "Sync cookies" pill
 * so the user can push their Patreon + Google session cookies to the backend
 * without opening the toolbar popup.
 */
(function () {
  if (window.top !== window.self) return; // only in the top frame
  const browserApi = window.browser || window.chrome;

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
    pill.innerHTML = `<span class="asmr-ext-dot"></span><span data-label>Sync cookies</span>`;
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
    // Mixed outcome possible — e.g. Patreon ok, Google not logged in. Surface
    // both halves so the user knows which side needs attention before retry.
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject, { once: true });
  } else {
    inject();
  }
})();
