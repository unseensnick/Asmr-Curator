/**
 * Shared storage helpers.
 *
 *   sync storage (survives browser restart, syncs across devices)
 *     - `backendUrl`  base URL of the local ASMR Curator backend,
 *                     e.g. http://localhost:8000
 *
 *   local storage (per-machine cache, not synced)
 *     - `latestExtensionInfo`  { version, checkedAt } — last GitHub
 *                              release version observed by the daily
 *                              update check + when we observed it
 */
(function () {
  const DEFAULT_BACKEND_URL = "http://localhost:8000";
  // Single source of truth for the GitHub repo slug — used by the daily
  // update check (background.js) + the popup's "view release" link
  // (popup.js). A future rename only needs to touch this one constant.
  const GITHUB_REPO = "unseensnick/Asmr-Curator";
  const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`;
  const RELEASES_LATEST_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;
  const browserApi = self.browser || self.chrome;

  async function getBackendUrl() {
    const { backendUrl } = await browserApi.storage.sync.get({
      backendUrl: DEFAULT_BACKEND_URL,
    });
    // Strip any trailing slash so callers can do `${url}/api/…`.
    return (backendUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
  }

  async function setBackendUrl(url) {
    return browserApi.storage.sync.set({ backendUrl: url });
  }

  async function getLatestExtensionInfo() {
    const { latestExtensionInfo } = await browserApi.storage.local.get({
      latestExtensionInfo: { version: null, checkedAt: 0 },
    });
    return latestExtensionInfo || { version: null, checkedAt: 0 };
  }

  async function setLatestExtensionInfo(info) {
    return browserApi.storage.local.set({ latestExtensionInfo: info });
  }

  self.AsmrExt = self.AsmrExt || {};
  Object.assign(self.AsmrExt, {
    DEFAULT_BACKEND_URL,
    GITHUB_REPO,
    RELEASES_API_URL,
    RELEASES_LATEST_URL,
    getBackendUrl,
    setBackendUrl,
    getLatestExtensionInfo,
    setLatestExtensionInfo,
  });
})();
