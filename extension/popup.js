/**
 * Popup script. Wires the single Sync Patreon + Google cookies button +
 * the footer Settings link.
 */
(function () {
  const browserApi = window.browser || window.chrome;

  const els = {
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
    els.updateBannerVersion.textContent = `v${res.latest}`;
    els.updateBannerMeta.textContent = `installed v${res.installed}`;
    els.updateBannerLink.href =
      "https://github.com/unseensnick/Asmr-Curator/releases/latest";
    els.updateBanner.classList.add("show");
  }

  function setStatus(text, kind) {
    els.cookieStatus.textContent = text;
    els.cookieStatus.classList.remove("ok", "err");
    if (kind) els.cookieStatus.classList.add(kind);
  }

  async function onSyncCookie() {
    els.syncBtn.disabled = true;
    setStatus("Syncing Patreon + Google cookies…");
    let res;
    try {
      res = await browserApi.runtime.sendMessage({ type: "SYNC_COOKIE" });
    } catch (err) {
      setStatus(`Failed: ${err.message || err}`, "err");
      els.syncBtn.disabled = false;
      return;
    }
    if (!res) {
      setStatus("Failed: no response from background", "err");
      els.syncBtn.disabled = false;
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
    els.syncBtn.disabled = false;
  }

  els.syncBtn.addEventListener("click", onSyncCookie);
  els.optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    browserApi.runtime.openOptionsPage();
  });
  checkForUpdateBanner();
})();
