import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// Vite config only. The vitest block lives in `vitest.config.ts` so
// the two tools' bundled Vite versions don't clash on shared shapes
// (ProxyOptions etc.) when one is augmented over the other.
//
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
        watch: {
            // Polling required when the workspace is on a bind mount
            // from a Windows or macOS host into a Linux container:
            // Docker Desktop does not propagate inotify events across
            // the mount, so the default watcher never sees edits and
            // HMR never fires. Cost is ~1-3% idle CPU in the
            // container, negligible for this codebase. Also avoids
            // editor-atomic-write quirks of Windows fs.watch on
            // bare-metal Windows (dev.bat) without needing a separate
            // path.
            usePolling: true,
            interval: 300,
        },
    },
});
