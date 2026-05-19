import { useRef, useState } from "react";
import { AlertCircle, Check, Download, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ingestDriveLinkStream } from "@/lib/api";
import type { ExternalLink, IngestDriveLinkEvent } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface ExternalLinksHintProps {
    postId: string;
    links: ExternalLink[];
}

/** Per-row UI state machine. `progress` mirrors the latest SSE event from
 * the backend so the row label reflects the current stage and (during the
 * download phase) bytes-downloaded. */
type RowState =
    | { kind: "idle" }
    | { kind: "running"; progress: IngestDriveLinkEvent }
    | { kind: "done"; audioPath: string; size: number }
    | { kind: "error"; message: string };

/**
 * Small badge surfacing third-party file-host links (Google Drive, Mega, …)
 * found inside a Patreon post body. Drive links get a per-row Download button
 * that triggers a server-side Playwright scrape (`POST /api/patreon/ingest-drive-link`)
 * → cleaned playback URL → file lands at LIBRARY_PATH/<post_id>/. Other hosts
 * surface as plain links the user can open manually; we have no auto-capture
 * for those yet.
 *
 * Per-row state is local (one URL succeeds or fails independently of others).
 */
export default function ExternalLinksHint({ postId, links }: ExternalLinksHintProps) {
    if (!links.length) return null;
    const n = links.length;
    return (
        <details className="shrink-0 text-xs">
            <summary className="flex items-center gap-1.5 cursor-pointer select-none text-muted-foreground hover:text-foreground transition-colors">
                <Globe size={12} aria-hidden />
                {n} external link{n === 1 ? "" : "s"}. Drive links can be downloaded directly.
            </summary>
            <ul className="mt-2 pl-4 flex flex-col gap-2.5">
                {links.map((link) => (
                    <ExternalLinkRow key={link.url} postId={postId} link={link} />
                ))}
            </ul>
        </details>
    );
}

function isDriveUrl(href: string): boolean {
    try {
        const host = new URL(href).hostname.toLowerCase();
        return host === "drive.google.com" || host.endsWith(".drive.google.com");
    } catch {
        return false;
    }
}

function formatMB(bytes: number | null | undefined): string {
    if (bytes == null) return "?";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(0)} KB`;
}

/** Human-readable label for the current stage. Re-render every time the
 * progress event changes; cheap. */
function stageLabel(event: IngestDriveLinkEvent): string {
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
            // Drive sometimes serves the m4a init segment instead of the
            // full body; the backend retries the same URL automatically.
            // When retry_attempt > 1, prefix the stage so the user knows
            // it isn't stuck.
            const retryPrefix = event.retry_attempt && event.retry_attempt > 1
                ? `Retry ${event.retry_attempt}/${event.max_attempts ?? "?"}: `
                : "";
            if (event.bytes != null && event.total != null && event.total > 0) {
                const pct = ((event.bytes / event.total) * 100).toFixed(0);
                return `${retryPrefix}Downloading ${formatMB(event.bytes)} / ${formatMB(event.total)} (${pct}%)`;
            }
            const elapsed = event.download_elapsed_s ?? event.elapsed_s;
            return `${retryPrefix}Downloading… ${elapsed.toFixed(1)}s`;
        }
        case "done":
            return `Saved to ${event.audio_path}`;
        case "error":
            return event.message;
    }
}

interface ExternalLinkRowProps {
    postId: string;
    link: ExternalLink;
}

function ExternalLinkRow({ postId, link }: ExternalLinkRowProps) {
    const { url: href, text } = link;
    const [state, setState] = useState<RowState>({ kind: "idle" });
    // AbortController lets us cancel an in-flight stream if the component
    // unmounts (e.g. user re-fetches and the post card is replaced).
    const abortRef = useRef<AbortController | null>(null);

    async function handleDownload() {
        const controller = new AbortController();
        abortRef.current = controller;
        setState({
            kind: "running",
            progress: { state: "launching_browser", elapsed_s: 0 },
        });
        try {
            const res = await ingestDriveLinkStream(
                postId,
                href,
                (event) => {
                    // Live-update the row label on every event.
                    setState({ kind: "running", progress: event });
                },
                { signal: controller.signal, filename: text || undefined },
            );
            setState({ kind: "done", audioPath: res.audio_path, size: res.size });
        } catch (err) {
            if (controller.signal.aborted) return;
            setState({ kind: "error", message: getErrorMessage(err) });
        } finally {
            abortRef.current = null;
        }
    }

    const drive = isDriveUrl(href);
    const isRunning = state.kind === "running";
    return (
        <li className="flex flex-col gap-1.5">
            <div className="flex items-start gap-2 flex-wrap">
                <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={text ? href : undefined}
                    className="font-mono text-xs text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-2 break-all flex-1 min-w-0"
                >
                    {text || href}
                </a>
                {drive && state.kind !== "done" && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleDownload}
                        disabled={isRunning}
                        className="h-7 px-2.5 text-xs gap-1.5 shrink-0"
                    >
                        {isRunning ? (
                            <Loader2 size={12} aria-hidden className="animate-spin" />
                        ) : (
                            <Download size={12} aria-hidden />
                        )}
                        {isRunning ? "Downloading" : "Download"}
                    </Button>
                )}
            </div>
            {isRunning && (
                <span className="text-muted-foreground text-xs pl-0.5">
                    {stageLabel(state.progress)}
                </span>
            )}
            {state.kind === "done" && (
                <span className="text-success text-xs pl-0.5 flex items-baseline gap-1.5 wrap-break-word">
                    <Check size={12} aria-hidden className="self-center shrink-0" />
                    Saved to <code className="font-mono">{state.audioPath}</code>{" "}
                    <span className="text-muted-foreground">({formatMB(state.size)})</span>
                </span>
            )}
            {state.kind === "error" && (
                <span className="text-destructive text-xs pl-0.5 flex items-baseline gap-1.5 wrap-break-word">
                    <AlertCircle size={12} aria-hidden className="self-center shrink-0" />
                    {state.message}
                </span>
            )}
        </li>
    );
}
