(function () {
  const {
    getBackendUrl,
    setBackendUrl,
    DEFAULT_BACKEND_URL,
    getAutoIngest,
    setAutoIngest,
  } = self.AsmrExt;
  const els = {
    input: document.getElementById("backend-url"),
    save: document.getElementById("save"),
    test: document.getElementById("test"),
    status: document.getElementById("status"),
    autoIngest: document.getElementById("auto-ingest"),
  };

  function setStatus(text, kind) {
    els.status.textContent = text;
    els.status.classList.remove("ok", "err");
    if (kind) els.status.classList.add(kind);
  }

  async function load() {
    const url = await getBackendUrl();
    els.input.value = url;
    els.input.placeholder = DEFAULT_BACKEND_URL;
    els.autoIngest.checked = await getAutoIngest();
  }

  function sanitize(value) {
    const trimmed = (value || "").trim().replace(/\/+$/, "");
    if (!trimmed) return DEFAULT_BACKEND_URL;
    if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
    return trimmed;
  }

  els.save.addEventListener("click", async () => {
    const url = sanitize(els.input.value);
    els.input.value = url;
    await setBackendUrl(url);
    setStatus(`Saved: ${url}`, "ok");
  });

  // Persist auto-ingest immediately on toggle — no separate save button needed
  // since the setting is a boolean.
  els.autoIngest.addEventListener("change", async () => {
    await setAutoIngest(els.autoIngest.checked);
    setStatus(
      els.autoIngest.checked
        ? "Auto-download enabled."
        : "Auto-download disabled — captures stay pending in the popup.",
      "ok",
    );
  });

  els.test.addEventListener("click", async () => {
    const url = sanitize(els.input.value);
    setStatus(`Pinging ${url}…`);
    try {
      const res = await fetch(`${url}/api/dictionary`);
      if (res.ok) {
        setStatus(`Backend reachable at ${url} ✓`, "ok");
      } else {
        setStatus(`Backend returned ${res.status} at ${url}`, "err");
      }
    } catch (err) {
      setStatus(`Could not reach ${url}: ${err.message || err}`, "err");
    }
  });

  load();
})();
