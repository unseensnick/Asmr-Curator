/// <reference types="vitest" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        host: true,
        proxy: {
            "/api": "http://localhost:8000",
        },
    },
    // Vitest config — reuses Vite's resolve aliases above so test files can
    // `import { … } from "@/lib/foo"` like the app source does.
    test: {
        // Default test environment is `node`. Override per-test-file via
        // `// @vitest-environment jsdom` for component / DOM-touching tests
        // when we add them (parser.ts and friends are pure JS — node is fine).
        environment: "node",
        include: ["src/**/__tests__/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
    },
});

