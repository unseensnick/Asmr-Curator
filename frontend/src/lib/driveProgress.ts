/** Shared narration for the Drive-scrape SSE stream.
 *
 *  Two surfaces render it: the per-link Download buttons under a Patreon
 *  post (`ExternalLinksHint`) and the standalone Google Drive tab
 *  (`DrivePanel`). Kept here so the wording stays identical in both.
 */

import type { IngestDriveLinkEvent } from "@/lib/types";

export function formatMB(bytes: number | null | undefined): string {
    if (bytes == null) return "?";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(0)} KB`;
}

/** Human-readable label for the current stage. Cheap — recompute on every
 *  progress event. */
export function driveStageLabel(event: IngestDriveLinkEvent): string {
    switch (event.state) {
        case "queued":
            if (event.ahead <= 0) return "Queued";
            return event.ahead === 1
                ? "Queued, 1 download ahead"
                : `Queued, ${event.ahead} downloads ahead`;
        case "launching_browser":
            return `Opening browser (${event.elapsed_s.toFixed(1)}s)`;
        case "loading_page":
            return `Loading the Drive page (${event.elapsed_s.toFixed(1)}s)`;
        case "waiting_for_player":
            return `Waiting for the audio player (${event.elapsed_s.toFixed(1)}s)`;
        case "captured":
            return `Found the audio (${event.elapsed_s.toFixed(1)}s)`;
        case "downloading": {
            // Drive occasionally answers with a stub instead of the full
            // body; the backend retries the same URL. Surfacing the attempt
            // tells the user it isn't stuck.
            const retryPrefix =
                event.retry_attempt && event.retry_attempt > 1
                    ? `Retry ${event.retry_attempt}/${event.max_attempts ?? "?"}: `
                    : "";
            if (event.bytes != null && event.total != null && event.total > 0) {
                const pct = ((event.bytes / event.total) * 100).toFixed(0);
                return `${retryPrefix}Downloading ${formatMB(event.bytes)} / ${formatMB(event.total)} (${pct}%)`;
            }
            const elapsed = event.download_elapsed_s ?? event.elapsed_s;
            return `${retryPrefix}Downloading… ${elapsed.toFixed(1)}s`;
        }
        case "extracting":
            return `Converting to ${event.audio_format.toUpperCase()}`;
        case "done":
            return `Saved to ${event.audio_path}`;
        case "error":
            return event.message;
    }
}
