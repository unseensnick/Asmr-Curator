/**
 * Popup script. Wires up:
 *   - "Sync cookie" button → SYNC_COOKIE message
 *   - Captures list → renders cards with auto-resolved post_id (or input) +
 *     "Download" button → INGEST_CAPTURE message
 *   - "Clear" button → CLEAR_CAPTURES message
 *   - "Settings" link → opens options page
 */
(function () {
  const browserApi = window.browser || window.chrome;

  const els = {
    syncBtn: document.getElementById("sync-cookie"),
    cookieStatus: document.getElementById("cookie-status"),
    clearBtn: document.getElementById("clear-captures"),
    capturesList: document.getElementById("captures-list"),
    capturesStatus: document.getElementById("captures-status"),
    optionsLink: document.getElementById("options-link"),
  };

  function setStatus(node, text, kind) {
    node.textContent = text;
    node.classList.remove("ok", "err");
    if (kind) node.classList.add(kind);
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return "?";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(0)} KB`;
  }

  function renderEmpty() {
    els.capturesList.innerHTML =
      `<div class="empty">No audio captured yet. Click a Drive link inside a Patreon post and press play — when auto-download is on, captures land in the library directly. Anything that couldn't be matched to a post will show up here.</div>`;
  }

  // Short human label for how the post_id was resolved (or wasn't). Tells the
  // user whether the auto-fill came from the same tab they're on, a tab opened
  // from a Patreon click, or recorded click history.
  const SOURCE_LABEL = {
    "parent": "auto · same tab",
    "opener": "auto · opener tab",
    "click-history": "auto · click history",
  };

  function captureCard(entry) {
    const card = document.createElement("div");
    card.className = "capture";

    const meta = document.createElement("div");
    meta.className = "capture-meta";
    const right = document.createElement("span");
    right.textContent = formatSize(entry.size);
    const left = document.createElement("span");
    if (entry.resolvedPostId) {
      const src = SOURCE_LABEL[entry.resolveSource] || "auto";
      left.textContent = `post #${entry.resolvedPostId} · ${src}`;
    } else {
      left.textContent = "no post detected — enter post_id below";
    }
    meta.append(left, right);
    card.appendChild(meta);

    const url = document.createElement("div");
    url.className = "capture-url";
    url.textContent = entry.cleanedUrl;
    card.appendChild(url);

    const controls = document.createElement("div");
    controls.className = "capture-controls";

    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.placeholder = "post_id";
    idInput.value = entry.resolvedPostId || "";
    controls.appendChild(idInput);

    const btn = document.createElement("button");
    btn.textContent = "Download";
    btn.addEventListener("click", () => downloadCapture(entry, idInput.value, card));
    controls.appendChild(btn);

    card.appendChild(controls);
    return card;
  }

  async function loadCaptures() {
    let res;
    try {
      res = await browserApi.runtime.sendMessage({ type: "GET_CAPTURES" });
    } catch (err) {
      setStatus(els.capturesStatus, `Failed to read captures: ${err.message || err}`, "err");
      return;
    }
    const list = (res && res.captures) || [];
    els.capturesList.innerHTML = "";
    if (!list.length) {
      renderEmpty();
      return;
    }
    for (const entry of list) {
      els.capturesList.appendChild(captureCard(entry));
    }
  }

  async function downloadCapture(entry, postIdValue, card) {
    const postId = (postIdValue || "").trim();
    if (!postId) {
      setStatus(els.capturesStatus, "Enter a post_id first.", "err");
      return;
    }
    setStatus(els.capturesStatus, `Downloading to post #${postId}…`);
    card.style.opacity = "0.6";
    let res;
    try {
      res = await browserApi.runtime.sendMessage({
        type: "INGEST_CAPTURE",
        payload: { cleanedUrl: entry.cleanedUrl, postId },
      });
    } catch (err) {
      setStatus(els.capturesStatus, `Ingest failed: ${err.message || err}`, "err");
      card.style.opacity = "1";
      return;
    }
    if (!res || !res.ok) {
      setStatus(els.capturesStatus, `Ingest failed: ${res && res.error ? res.error : "unknown"}`, "err");
      card.style.opacity = "1";
      return;
    }
    setStatus(els.capturesStatus, `Saved to ${res.audioPath} (${formatSize(res.size)})`, "ok");
    await loadCaptures();
  }

  async function onSyncCookie() {
    els.syncBtn.disabled = true;
    setStatus(els.cookieStatus, "Syncing Patreon + Google cookies…");
    let res;
    try {
      res = await browserApi.runtime.sendMessage({ type: "SYNC_COOKIE" });
    } catch (err) {
      setStatus(els.cookieStatus, `Failed: ${err.message || err}`, "err");
      els.syncBtn.disabled = false;
      return;
    }
    if (!res) {
      setStatus(els.cookieStatus, "Failed: no response from background", "err");
      els.syncBtn.disabled = false;
      return;
    }
    // Report each half separately — a partial success (Patreon ok, Google
    // not logged in) is the common state when the user only uses one service.
    const parts = [];
    if (res.patreon?.ok) parts.push(`${res.patreon.count} Patreon`);
    else if (res.patreon?.error) parts.push(`Patreon: ${res.patreon.error}`);
    if (res.google?.ok) parts.push(`${res.google.count} Google`);
    else if (res.google?.error) parts.push(`Google: ${res.google.error}`);
    setStatus(
      els.cookieStatus,
      (res.ok ? "Synced " : "Partial sync — ") + parts.join(" · "),
      res.ok ? "ok" : "err",
    );
    els.syncBtn.disabled = false;
  }

  async function onClearCaptures() {
    await browserApi.runtime.sendMessage({ type: "CLEAR_CAPTURES" });
    setStatus(els.capturesStatus, "");
    await loadCaptures();
  }

  els.syncBtn.addEventListener("click", onSyncCookie);
  els.clearBtn.addEventListener("click", onClearCaptures);
  els.optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    browserApi.runtime.openOptionsPage();
  });

  loadCaptures();
})();
