/**
 * Derive a Patreon `post_id` from a post URL.
 *
 * Patreon post URLs look like:
 *   https://www.patreon.com/posts/some-slug-12345
 *   https://www.patreon.com/posts/12345
 *   https://www.patreon.com/posts/some-slug-12345?utm_campaign=…
 *
 * The numeric ID is always the trailing run of digits in the last path
 * segment. Returns null when the URL isn't a Patreon post page.
 */
(function () {
  function postIdFromUrl(url) {
    if (!url) return null;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!/(^|\.)patreon\.com$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/\/posts\/([^/?#]+)/i);
    if (!match) return null;
    const lastSeg = match[1];
    const digits = lastSeg.match(/(\d+)$/);
    return digits ? digits[1] : null;
  }

  /**
   * Extract the Google Drive file ID from any URL Drive uses for that file.
   *
   * The same ID appears in three different shapes, all of which we may see:
   *   - viewer:   https://drive.google.com/file/d/<ID>/view
   *   - legacy:   https://drive.google.com/open?id=<ID>
   *   - playback: https://rr4.googlevideo.com/videoplayback?…&driveid=<ID>&…
   *
   * Returns the ID (as the raw bytes from the URL) or null when nothing
   * matches.
   */
  function driveIdFromUrl(url) {
    if (!url) return null;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    // 1. /file/d/<ID>/...
    const pathMatch = parsed.pathname.match(/\/d\/([^/?#]+)/);
    if (pathMatch) return pathMatch[1];
    // 2. ?id=<ID> (open links)
    const idParam = parsed.searchParams.get("id");
    if (idParam) return idParam;
    // 3. ?driveid=<ID> (playback URLs)
    const driveIdParam = parsed.searchParams.get("driveid");
    if (driveIdParam) return driveIdParam;
    return null;
  }

  self.AsmrExt = self.AsmrExt || {};
  Object.assign(self.AsmrExt, { postIdFromUrl, driveIdFromUrl });
})();
