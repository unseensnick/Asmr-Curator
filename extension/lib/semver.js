/**
 * Plain semver compare — extracted from background.js so vitest can
 * import it directly without spinning up the service-worker context.
 *
 * Returns < 0 if a < b, 0 if equal, > 0 if a > b. Only covers
 * MAJOR.MINOR.PATCH[-pre] — the fancier semver grammar isn't needed
 * for our release-asset filenames.
 *
 * Dual-mode: attaches to `self.AsmrExt` for the extension's service
 * worker (`importScripts("lib/semver.js")` in background.js), and
 * exposes a `module.exports` shape so vitest's CJS interop can
 * `import { compareSemver } from ".../semver.js"` for property tests.
 */
(function () {
  function compareSemver(a, b) {
    const [aMain, aPre] = a.split("-");
    const [bMain, bPre] = b.split("-");
    const aParts = aMain.split(".").map(Number);
    const bParts = bMain.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
    }
    // Release (no pre-release tag) beats any pre-release on the same triple.
    if (aPre === bPre) return 0;
    if (!aPre) return 1;
    if (!bPre) return -1;
    return aPre.localeCompare(bPre);
  }

  // Service-worker / content-script context: attach to the shared namespace.
  if (typeof self !== "undefined") {
    self.AsmrExt = self.AsmrExt || {};
    self.AsmrExt.compareSemver = compareSemver;
  }

  // Test context (Node + vitest CJS interop).
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { compareSemver };
  }
})();
