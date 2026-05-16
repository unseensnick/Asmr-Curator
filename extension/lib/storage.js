/**
 * Shared storage helpers. The extension persists:
 *
 *   sync storage (survives browser restart, syncs across devices)
 *     - `backendUrl`        user-configured base URL of the local ASMR
 *                           Workbench backend, e.g. http://localhost:8000
 *     - `autoIngest`        boolean — auto-POST captures to the backend when
 *                           the post_id auto-resolves (default true)
 *
 *   session storage (cleared on browser restart)
 *     - `captures`          live audio-URL capture candidates awaiting action
 *     - `clickHistory`      recent external-link clicks made inside Patreon
 *                           posts; used to map a Drive playback URL back to
 *                           its source post when the parent tab is no longer
 *                           a Patreon page
 *     - `ingestedUrls`      cleaned URLs that have already been ingested by
 *                           the backend in this session — prevents re-ingest
 *                           when the player re-issues an identical request
 */
(function () {
  const DEFAULT_BACKEND_URL = "http://localhost:8000";
  const DEFAULT_AUTO_INGEST = true;
  // Click history retention: at most this many entries, at most this many ms old.
  const CLICK_HISTORY_MAX = 30;
  const CLICK_HISTORY_TTL_MS = 60 * 60 * 1000; // 1h
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

  async function getCaptures() {
    const { captures } = await browserApi.storage.session.get({ captures: [] });
    return Array.isArray(captures) ? captures : [];
  }

  async function setCaptures(list) {
    return browserApi.storage.session.set({ captures: list });
  }

  async function addCapture(entry) {
    const list = await getCaptures();
    // Dedupe by cleaned URL — same audio URL fires onCompleted many times
    // as the player issues range requests.
    if (list.some((c) => c.cleanedUrl === entry.cleanedUrl)) return list;
    list.unshift(entry);
    // Cap to avoid unbounded growth across a long browsing session.
    const capped = list.slice(0, 25);
    await setCaptures(capped);
    return capped;
  }

  async function removeCapture(cleanedUrl) {
    const list = await getCaptures();
    const next = list.filter((c) => c.cleanedUrl !== cleanedUrl);
    await setCaptures(next);
    return next;
  }

  // ── Auto-ingest setting ─────────────────────────────────────────────────────

  async function getAutoIngest() {
    const { autoIngest } = await browserApi.storage.sync.get({
      autoIngest: DEFAULT_AUTO_INGEST,
    });
    return Boolean(autoIngest);
  }

  async function setAutoIngest(value) {
    return browserApi.storage.sync.set({ autoIngest: Boolean(value) });
  }

  // ── Click history ───────────────────────────────────────────────────────────

  async function getClickHistory() {
    const { clickHistory } = await browserApi.storage.session.get({
      clickHistory: [],
    });
    if (!Array.isArray(clickHistory)) return [];
    // Drop expired entries on every read so callers always see a clean list.
    const cutoff = Date.now() - CLICK_HISTORY_TTL_MS;
    return clickHistory.filter((c) => c && typeof c.ts === "number" && c.ts >= cutoff);
  }

  /**
   * Record one Patreon-post → external-host link click. Newest first; bounded
   * length; deduped by the (postUrl, externalUrl) pair so spam-clicking the
   * same link doesn't push useful history out of the buffer.
   */
  async function recordClick({ postUrl, externalUrl, ts = Date.now() }) {
    if (!postUrl || !externalUrl) return;
    const existing = await getClickHistory();
    const filtered = existing.filter(
      (c) => !(c.postUrl === postUrl && c.externalUrl === externalUrl),
    );
    filtered.unshift({ postUrl, externalUrl, ts });
    const capped = filtered.slice(0, CLICK_HISTORY_MAX);
    await browserApi.storage.session.set({ clickHistory: capped });
  }

  /**
   * Find the most recent click whose externalUrl resolves to the given Drive
   * file ID. Caller is responsible for extracting `driveId` from the captured
   * playback URL — see `lib/post-id.js#driveIdFromUrl`.
   */
  async function findClickForDriveId(driveId, driveIdExtractor) {
    if (!driveId || typeof driveIdExtractor !== "function") return null;
    const history = await getClickHistory();
    for (const entry of history) {
      if (driveIdExtractor(entry.externalUrl) === driveId) return entry;
    }
    return null;
  }

  // ── Ingested-URL set (idempotency guard) ────────────────────────────────────

  async function getIngestedUrls() {
    const { ingestedUrls } = await browserApi.storage.session.get({
      ingestedUrls: [],
    });
    return Array.isArray(ingestedUrls) ? ingestedUrls : [];
  }

  async function wasIngested(cleanedUrl) {
    if (!cleanedUrl) return false;
    return (await getIngestedUrls()).includes(cleanedUrl);
  }

  async function markIngested(cleanedUrl) {
    if (!cleanedUrl) return;
    const list = await getIngestedUrls();
    if (list.includes(cleanedUrl)) return;
    list.unshift(cleanedUrl);
    // Cap so a multi-hour session doesn't grow this without bound. 200 covers
    // many sessions; older entries fall off naturally.
    const capped = list.slice(0, 200);
    await browserApi.storage.session.set({ ingestedUrls: capped });
  }

  self.AsmrExt = self.AsmrExt || {};
  Object.assign(self.AsmrExt, {
    DEFAULT_BACKEND_URL,
    DEFAULT_AUTO_INGEST,
    getBackendUrl,
    setBackendUrl,
    getAutoIngest,
    setAutoIngest,
    getCaptures,
    setCaptures,
    addCapture,
    removeCapture,
    getClickHistory,
    recordClick,
    findClickForDriveId,
    getIngestedUrls,
    wasIngested,
    markIngested,
  });
})();
