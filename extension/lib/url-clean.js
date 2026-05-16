/**
 * Shared URL-cleaning utilities. Loaded into background (via importScripts),
 * popup (<script src=…>), and content scripts (via manifest content_scripts.js).
 * All functions are assigned to `self.AsmrExt` so callers can find them
 * regardless of context.
 */
(function () {
  // Query parameters that need to be stripped from Google's signed audio URLs
  // before the cleaned URL is requested: removing `range` causes the server
  // to return the complete file (instead of a chunk), and removing `ump`
  // disables Google's UMP chunked-streaming protocol.
  const STRIP_PARAMS = ["ump", "range"];

  // Minimum content-length, in bytes, before a captured audio URL is treated
  // as a "real" full-file candidate. Matches the reference prompt's 400 KB
  // threshold — anything smaller is almost certainly a tiny preview/probe
  // request from the embedded player rather than the actual audio.
  const MIN_AUDIO_BYTES = 400_000;

  function cleanAudioUrl(url) {
    // We deliberately don't round-trip through `new URL(...).searchParams`:
    // the URL parser re-encodes values like `mime=audio/mp4` into
    // `mime=audio%2Fmp4`, which invalidates the signed-URL signature on
    // Google's playback CDN. Operate on the raw query string instead and
    // drop only the targeted segments.
    const queryStart = url.indexOf("?");
    if (queryStart < 0) return url;
    const hashStart = url.indexOf("#", queryStart);
    const queryEnd = hashStart >= 0 ? hashStart : url.length;
    const query = url.slice(queryStart + 1, queryEnd);
    const hash = hashStart >= 0 ? url.slice(hashStart) : "";
    const kept = query
      .split("&")
      .filter((seg) => {
        if (!seg) return false;
        const eq = seg.indexOf("=");
        const key = eq >= 0 ? seg.slice(0, eq) : seg;
        return !STRIP_PARAMS.includes(key);
      });
    const newQuery = kept.join("&");
    return url.slice(0, queryStart) + (newQuery ? "?" + newQuery : "") + hash;
  }

  /**
   * Best-effort size estimate from the URL itself. Google's signed playback
   * URLs always carry `clen=<bytes>` (the full file size), which is the
   * fallback when a HEAD request is blocked by CORS or returns no
   * content-length. Returns NaN when no `clen` is present.
   */
  function sizeFromClenParam(url) {
    try {
      const v = new URL(url).searchParams.get("clen");
      const n = v ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) ? n : NaN;
    } catch {
      return NaN;
    }
  }

  /**
   * HEAD the cleaned URL to confirm its size before showing it as a
   * capture candidate. Falls back to the `clen` query param when HEAD
   * fails (typically a CORS rejection on a cross-origin signed URL).
   */
  async function probeSize(cleanedUrl) {
    try {
      const res = await fetch(cleanedUrl, { method: "HEAD" });
      const header = res.headers.get("content-length");
      if (header) {
        const n = parseInt(header, 10);
        if (Number.isFinite(n)) return n;
      }
    } catch {
      // CORS / opaque / network error — fall through to clen
    }
    return sizeFromClenParam(cleanedUrl);
  }

  /** True when the URL or response MIME indicates audio content. */
  function looksLikeAudio({ url, mime }) {
    if (mime && mime.toLowerCase().includes("audio")) return true;
    return /[?&]mime=audio/i.test(url || "");
  }

  self.AsmrExt = self.AsmrExt || {};
  Object.assign(self.AsmrExt, {
    cleanAudioUrl,
    sizeFromClenParam,
    probeSize,
    looksLikeAudio,
    STRIP_PARAMS,
    MIN_AUDIO_BYTES,
  });
})();
