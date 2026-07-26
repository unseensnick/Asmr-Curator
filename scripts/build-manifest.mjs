#!/usr/bin/env node
/**
 * Generate `extension/manifest.json` from `extension/manifest.base.json` plus,
 * when present, `extension/private/manifest.fragment.json`.
 *
 * `manifest.json` is plain JSON: no comments, no conditionals. A
 * `content_scripts` entry pointing at a file the build does not ship makes
 * Chromium refuse to load the extension outright, so the private entry cannot
 * simply be left in. Generating the file is what lets the private domain be a
 * directory that can simply be absent, with no hand edit either way.
 *
 * The output is gitignored. Run this once after cloning, and again whenever the
 * base or the fragment changes:
 *
 *     node scripts/build-manifest.mjs
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const basePath = join(root, "extension", "manifest.base.json");
const fragmentPath = join(root, "extension", "private", "manifest.fragment.json");
const outPath = join(root, "extension", "manifest.json");

if (!existsSync(basePath)) {
    console.error(`build-manifest: missing ${basePath}`);
    process.exit(1);
}

const manifest = JSON.parse(readFileSync(basePath, "utf8"));

let merged = 0;
if (existsSync(fragmentPath)) {
    const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
    for (const [key, value] of Object.entries(fragment)) {
        if (Array.isArray(value)) {
            // Arrays append: the private content script joins the public ones
            // rather than replacing them.
            manifest[key] = [...(manifest[key] ?? []), ...value];
            merged += value.length;
        } else if (value && typeof value === "object") {
            manifest[key] = { ...(manifest[key] ?? {}), ...value };
            merged += 1;
        } else {
            manifest[key] = value;
            merged += 1;
        }
    }
}

writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(
    merged > 0
        ? `build-manifest: wrote manifest.json (base + ${merged} private entries)`
        : "build-manifest: wrote manifest.json (base only, no private domain present)",
);
