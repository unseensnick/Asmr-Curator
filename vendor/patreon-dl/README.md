# Local patched build of patreon-dl

This directory carries a tarball-packed build of [`patreon-dl`](https://github.com/patrickkfkan/patreon-dl) with a single regex patch applied. The Dockerfile and devcontainer install patreon-dl from this tarball instead of from the npm registry — required because the upstream 3.8.1 release ships a parser that doesn't match Patreon's current page format, breaking every creator-URL fetch with `Initial data not found - no regex matches`.

Upstream tracking: [patreon-dl#134](https://github.com/patrickkfkan/patreon-dl/issues/134), [patreon-dl#135](https://github.com/patrickkfkan/patreon-dl/issues/135).

## The patch

Two regex literals in `src/parsers/PageParser.ts` were widened:

```diff
-    const initialDataRegex = /window\.patreon\s*?=\s*?({.+?});/gm;
-    const initialDataRegex2 = /<script id="__NEXT_DATA__" type="application\/json">(.+)<\/script>/gm;
+    const initialDataRegex = /window\.patreon\s*?=\s*?({[\s\S]+?});/gm;
+    const initialDataRegex2 = /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]+?)<\/script>/g;
```

What changed:
- `[\s\S]+?` instead of `.+` / `.+?` — matches across newlines (TypeScript target predates the `s`/dotall flag in some configs; `[\s\S]` is portable).
- The `__NEXT_DATA__` matcher is now attribute-order-agnostic and accepts single or double quotes around the value, plus arbitrary extra attributes (`nonce`, `crossorigin`, etc.) in any position. Patreon's current HTML uses the same `<script id="__NEXT_DATA__" ...>` block, but with subtly different markup that the strict original pattern misses.

The two `Initial data not found - campaign ID not found in Next.js streaming response` fallbacks for the streaming format are unchanged — the patched parser hits the `__NEXT_DATA__` branch successfully, the streaming branch never runs.

## Files

- `patreon-dl-3.8.1-localfix.tgz` — the packed build. Produced by `npm pack` in a clone of patreon-dl at tag `v3.8.1` with the patch above applied. ~450 KB.

## Rebuilding the tarball

When Patreon next changes their HTML (which they will — see the changelog at upstream patreon-dl, it's a recurring fix), or when upstream ships their own fix and we want to take it:

1. Clone or update upstream patreon-dl somewhere on your host:
   ```bash
   git clone https://github.com/patrickkfkan/patreon-dl ~/Desktop/projects/code/patreon-dl
   cd ~/Desktop/projects/code/patreon-dl
   git checkout v3.8.1   # or whichever tag we're pinning to
   ```
2. Apply the patch (see [The patch](#the-patch) section above) to `src/parsers/PageParser.ts`.
3. Build (ignore the pre-existing TS errors in `Router.ts` / `FFmpegDownloadTaskBase.ts` — they're unrelated to the parser and `dist/` is still emitted):
   ```bash
   npm install                                 # one-time, needs Node 20 because better-sqlite3
   npx tsc -p tsconfig.json --noEmitOnError false
   npm pack
   ```
4. Copy the produced `patreon-dl-3.8.1.tgz` over the existing tarball in this directory, renaming to keep the `-localfix` suffix.
5. Update the `PATREON_DL_TARBALL` line in `Dockerfile` and `.devcontainer/devcontainer.json` if the filename changed.
6. Commit.

## Retiring this patch

Once upstream patreon-dl ships a release with the parser fix (track issues #134 / #135 above):

1. Delete this directory's `.tgz`.
2. Revert `Dockerfile` + `.devcontainer/devcontainer.json` to install from npm:
   ```dockerfile
   ARG PATREON_DL_VERSION=3.x.x
   RUN npm install -g --omit=dev patreon-dl@${PATREON_DL_VERSION}
   ```
3. Remove the CHANGELOG note flagging the local patch.

The `vendor/patreon-dl/` folder itself can stay or be deleted — it's only referenced from the Dockerfile.
