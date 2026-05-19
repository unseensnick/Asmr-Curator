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
        ],
    },
});
