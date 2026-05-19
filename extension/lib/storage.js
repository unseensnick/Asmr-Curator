/**
 * Shared storage helpers. The extension persists a single value:
 *
 *   sync storage (survives browser restart, syncs across devices)
 *     - `backendUrl`  base URL of the local ASMR Workbench backend,
 *                     e.g. http://localhost:8000
 */
(function () {
  const DEFAULT_BACKEND_URL = "http://localhost:8000";
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

  self.AsmrExt = self.AsmrExt || {};
  Object.assign(self.AsmrExt, {
    DEFAULT_BACKEND_URL,
    getBackendUrl,
    setBackendUrl,
  });
})();
