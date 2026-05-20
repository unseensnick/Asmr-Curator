import path from "path";
import { defineConfig } from "vitest/config";

// Vitest-only config. Lives separately from vite.config.ts so the two
// tools' bundled Vite versions don't fight over type augmentation —
// vitest 2.x ships its own internal Vite 5, which clashes with the
// project's Vite 8 if you try to share a single defineConfig.
//
// Test files use `@/...` imports like the app source, so duplicate
// the alias here.
export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    test: {
        // Default test environment is `node`. Override per-test-file via
        // `// @vitest-environment jsdom` for component / DOM-touching
        // tests (parser.ts and friends are pure JS — node is fine).
        environment: "node",
        include: [
            "src/**/__tests__/**/*.{test,spec}.{ts,tsx}",
            "src/**/*.{test,spec}.{ts,tsx}",
            // The browser extension lives outside frontend/src/ but is
            // tested by the same vitest because both are JS — keeps a
            // single test runner instead of bolting a separate one for
            // a handful of pure-helper specs in extension/lib/.
            "../extension/**/__tests__/**/*.{test,spec}.{ts,js}",
        ],
        coverage: {
            // v8 (built-in to Node) over istanbul — faster, no Babel pass.
            provider: "v8",
            // `text` for the CI log table; `html` for human browsing;
            // `lcov` so CI artifact consumers (Codecov etc.) can ingest it
            // later without re-running tests.
            reporter: ["text", "html", "lcov"],
            reportsDirectory: "./coverage",
            // Scope to the app source; tests + config files don't count
            // toward the denominator.
            include: ["src/**/*.{ts,tsx}"],
            exclude: [
                "src/**/__tests__/**",
                "src/**/*.{test,spec}.{ts,tsx}",
                "src/main.tsx", // entry — runs once at boot, not test-meaningful
            ],
        },
    },
});
