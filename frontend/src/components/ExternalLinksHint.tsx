import { useRef, useState } from "react";
import { AlertCircle, Check, Download, Globe, Loader2 } from "lucide-react";

import IngestConvertSection from "@/components/IngestConvertSection";
import { Button } from "@/components/ui/button";
import { ingestDriveLinkStream } from "@/lib/api";
import { driveStageLabel, formatMB } from "@/lib/driveProgress";
import {
    type IngestConvertSettings,
    loadIngestConvert,
    toIngestConvertRequest,
} from "@/lib/ingestConvert";
import type { ExternalLink, IngestDriveLinkEvent } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface ExternalLinksHintProps {
    postId: string;
    /** Creator handle / full name. Passed to the backend so the ingested
     * file lands at `<creator>/<post_id> - <title>/` to match patreon-dl. */
    artist?: string;
    title?: string;
    links: ExternalLink[];
    /** Reveals the bitrate override in the convert controls, same gate the
     *  Convert panel and the other ingest paths use. */
    powerMode?: boolean;
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
export default function ExternalLinksHint({
    postId,
    artist,
    title,
    links,
    powerMode = false,
}: ExternalLinksHintProps) {
    // One convert choice for the whole section rather than per row — the
    // rows are links off a single post and are almost always wanted the
    // same way. Shared with the Google Drive tab via lib/ingestConvert.
    const [convert, setConvert] = useState<IngestConvertSettings>(() => loadIngestConvert());

    if (!links.length) return null;
    const n = links.length;
    const hasDrive = links.some((link) => isDriveUrl(link.url));
    return (
        <details className="shrink-0 text-xs">
            <summary className="flex items-center gap-1.5 cursor-pointer select-none text-muted-foreground hover:text-foreground transition-colors">
                <Globe size={12} aria-hidden />
                {n} external link{n === 1 ? "" : "s"}. Drive links can be downloaded directly.
            </summary>
            {hasDrive && (
                <div className="mt-2.5 pl-4">
                    <IngestConvertSection
                        value={convert}
                        onChange={setConvert}
                        idPrefix={`links-${postId}`}
                        powerMode={powerMode}
                    />
                </div>
            )}
            <ul className="mt-2 pl-4 flex flex-col gap-2.5">
                {links.map((link) => (
                    <ExternalLinkRow
                        key={link.url}
                        postId={postId}
                        artist={artist}
                        title={title}
                        link={link}
                        convert={convert}
                    />
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

// `formatMB` + `driveStageLabel` live in lib/driveProgress so the Google
// Drive tab narrates the same stream in the same words.

interface ExternalLinkRowProps {
    postId: string;
    artist?: string;
    title?: string;
    link: ExternalLink;
    /** Convert-on-download, chosen once for the whole section. */
    convert: IngestConvertSettings;
}

function ExternalLinkRow({ postId, artist, title, link, convert }: ExternalLinkRowProps) {
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
                {
                    signal: controller.signal,
                    filename: text || undefined,
                    artist,
                    title,
                    ...toIngestConvertRequest(convert),
                },
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
                    {driveStageLabel(state.progress)}
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
