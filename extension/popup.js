/**
 * Popup script. Wires the single Sync Patreon + Google cookies button +
 * the footer Settings link.
 */
(function () {
  const browserApi = window.browser || window.chrome;
  // lib/storage.js (loaded before this script in popup.html) populates
  // window.AsmrExt with the shared repo-slug constants.
  const { RELEASES_LATEST_URL } = window.AsmrExt;

  const uiElements = {
    syncBtn: document.getElementById("sync-cookie"),
    cookieStatus: document.getElementById("cookie-status"),
    optionsLink: document.getElementById("options-link"),
    updateBanner: document.getElementById("update-banner"),
    updateBannerVersion: document.getElementById("update-banner-version"),
    updateBannerMeta: document.getElementById("update-banner-meta"),
    updateBannerLink: document.getElementById("update-banner-link"),
  };

  async function checkForUpdateBanner() {
    let res;
    try {
      res = await browserApi.runtime.sendMessage({ type: "GET_UPDATE_STATUS" });
    } catch {
      return;
    }
    if (!res || !res.ok || !res.hasUpdate) return;
    uiElements.updateBannerVersion.textContent = `v${res.latest}`;
    uiElements.updateBannerMeta.textContent = `installed v${res.installed}`;
    uiElements.updateBannerLink.href = RELEASES_LATEST_URL;
    uiElements.updateBanner.classList.add("show");
  }

  function setStatus(text, kind) {
    uiElements.cookieStatus.textContent = text;
    uiElements.cookieStatus.classList.remove("ok", "err");
    if (kind) uiElements.cookieStatus.classList.add(kind);
  }

  async function onSyncCookie() {
    uiElements.syncBtn.disabled = true;
    setStatus("Syncing Patreon + Google cookies…");
    let res;
    try {
      res = await browserApi.runtime.sendMessage({ type: "SYNC_COOKIE" });
    } catch (err) {
      setStatus(`Failed: ${err.message || err}`, "err");
      uiElements.syncBtn.disabled = false;
      return;
    }
    if (!res) {
      setStatus("Failed: no response from background", "err");
      uiElements.syncBtn.disabled = false;
      return;
    }
    // Surface each half — a partial success (Patreon ok, Google not logged
    // in) is the common state when the user only uses one service.
    const parts = [];
    if (res.patreon?.ok) parts.push(`${res.patreon.count} Patreon`);
    else if (res.patreon?.error) parts.push(`Patreon: ${res.patreon.error}`);
    if (res.google?.ok) parts.push(`${res.google.count} Google`);
    else if (res.google?.error) parts.push(`Google: ${res.google.error}`);
    setStatus(
      (res.ok ? "Synced " : "Partial sync — ") + parts.join(" · "),
      res.ok ? "ok" : "err",
    );
    uiElements.syncBtn.disabled = false;
  }

  uiElements.syncBtn.addEventListener("click", onSyncCookie);
  uiElements.optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    browserApi.runtime.openOptionsPage();
  });
  checkForUpdateBanner();
})();
