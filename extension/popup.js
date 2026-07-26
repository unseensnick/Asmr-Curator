/**
 * Popup script. Wires the single Sync Patreon + Google cookies button +
 * the footer Settings link.
 */
(function () {
  const browserApi = window.browser || window.chrome;
  // lib/storage.js (loaded before this script in popup.html) populates
  // window.AsmrExt with the shared repo-slug constants.
  const { RELEASES_LATEST_URL, getBackendUrl } = window.AsmrExt;

  const uiElements = {
    syncBtn: document.getElementById("sync-cookie"),
    // The private track section, when present, mounts itself just above this.
    cookieSection: document.getElementById("cookie-section"),
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

  const SYNC_LABEL = "Sync Patreon + Google cookies";
  const GRANT_LABEL = "Grant site access, then sync";
  // Origins the background reported as ungranted. Set means the next click
  // should ask for them first. `permissions.request()` has to run from a user
  // gesture in an extension page, which is why this lives here and not in
  // the background script or the on-page pill.
  let pendingOrigins = null;

  async function requestPendingPermissions() {
    setStatus("Waiting for you to approve site access…");
    let granted;
    try {
      granted = await browserApi.permissions.request({ origins: pendingOrigins });
    } catch (err) {
      setStatus(`Couldn't request access: ${err.message || err}`, "err");
      return false;
    }
    if (!granted) {
      setStatus(
        "Access denied. Without it the extension can't read your cookies " +
          "or reach the backend.",
        "err",
      );
      return false;
    }
    pendingOrigins = null;
    uiElements.syncBtn.textContent = SYNC_LABEL;
    return true;
  }

  async function onSyncCookie() {
    uiElements.syncBtn.disabled = true;
    // A grant prompt is queued from a previous attempt — clear it first, then
    // fall through into the normal sync so one click does both.
    if (pendingOrigins) {
      const ok = await requestPendingPermissions();
      if (!ok) {
        uiElements.syncBtn.disabled = false;
        return;
      }
    }
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
    if (res.needsPermission) {
      pendingOrigins = res.origins;
      uiElements.syncBtn.textContent = GRANT_LABEL;
      setStatus(`${res.error} Click again to approve.`, "err");
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

  // Optional private-only surface. Absent unless that domain is checked out, so
  // a failed import is an expected path, not an error worth reporting. The
  // module builds its own DOM, which is why popup.html carries no markup for it.
  import("./private/track.js")
    .then((m) => m.init({ browserApi, anchor: uiElements.cookieSection, getBackendUrl }))
    .catch(() => {});
})();
