import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Link2, PenLine } from "lucide-react";

import IngestConvertSection from "@/components/IngestConvertSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ingestDriveLinkStream } from "@/lib/api";
import { driveStageLabel } from "@/lib/driveProgress";
import {
    type IngestConvertSettings,
    loadIngestConvert,
    toIngestConvertRequest,
} from "@/lib/ingestConvert";
import { parseTitleLine } from "@/lib/parser";
import type { AppDict, IngestDriveLinkEvent, IngestDriveLinkResponse } from "@/lib/types";
import { getErrorMessage, normaliseAndDedupeTags } from "@/lib/utils";

interface DrivePanelProps {
    /** Tag dictionary, used to normalise any tags parsed out of the title
     *  before they reach the tag editor. */
    dict: AppDict;
    /** Push the title + tags + creator into the shared tag editor, the same
     *  hand-off the other source panels make. */
    onExtracted: (title: string, tags: string[], artist: string) => void;
    /** Bridge into the FileBrowser Downloads tab so the freshly-downloaded
     *  file is auto-selected for the rename + move flow. */
    onBridgeToDownloads?: (path: string, filename: string) => void;
    /** Open the Cookies modal. Surfaced inline on failure so an expired
     *  Google session can be fixed without hunting through Settings. */
    onOpenCookies?: () => void;
    /** Reveals the explicit bitrate override in the convert controls. */
    powerMode?: boolean;
}

type Status = { type: "success" | "error"; msg: string };

/**
 * Standalone Google Drive ingest.
 *
 * The same scrape the per-link Download buttons under a Patreon post use,
 * reachable directly when you already have the Drive address and there's no
 * post to fetch first. Title and artist are optional and only shape the
 * staging folder — the tag editor is driven by the rename step afterwards,
 * same as any other file in Downloads.
 */
export default function DrivePanel({
    dict,
    onExtracted,
    onBridgeToDownloads,
    onOpenCookies,
    powerMode = false,
}: DrivePanelProps) {
    const [url, setUrl] = useState("");
    const [title, setTitle] = useState("");
    const [artist, setArtist] = useState("");
    const [downloading, setDownloading] = useState(false);
    const [status, setStatus] = useState<Status | null>(null);
    const [phase, setPhase] = useState<IngestDriveLinkEvent | null>(null);
    const [result, setResult] = useState<IngestDriveLinkResponse | null>(null);
    const [convert, setConvert] = useState<IngestConvertSettings>(() => loadIngestConvert());
    // Cancels the in-flight stream on unmount / re-download so the server
    // tears the scrape down cleanly.
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    async function handleDownload() {
        const trimmed = url.trim();
        if (!trimmed) return;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setDownloading(true);
        setStatus(null);
        setResult(null);
        setPhase(null);
        try {
            const res = await ingestDriveLinkStream(
                // No Patreon post behind this one — the backend keys the
                // folder off the Drive file id.
                null,
                trimmed,
                (event) => setPhase(event),
                {
                    title: title.trim() || undefined,
                    artist: artist.trim() || undefined,
                    ...toIngestConvertRequest(convert),
                    signal: controller.signal,
                },
            );
            setResult(res);
            setStatus({
                type: "success",
                msg: "Saved to your Downloads. Rename and file it next.",
            });
        } catch (err) {
            if (controller.signal.aborted) return;
            setStatus({
                type: "error",
                msg:
                    getErrorMessage(err) ||
                    "That download didn't go through. Check the link and try again.",
            });
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = null;
            }
            setDownloading(false);
            setPhase(null);
        }
    }

    const canUseForFilename = title.trim() !== "" || artist.trim() !== "";

    function handleUseForFilename() {
        // Same treatment a Patreon post title gets: split the embedded
        // `|` tags off, then resolve them against the dictionary so they
        // land as canonical chips rather than raw text.
        const { title: cleanTitle, embeddedTags } = parseTitleLine(title.trim());
        onExtracted(cleanTitle, normaliseAndDedupeTags(embeddedTags, dict), artist.trim());
    }

    const workingLabel = phase ? driveStageLabel(phase) : "Starting the download.";
    const sessionLooksExpired =
        status?.type === "error" && /sign|session|cookie|expired/i.test(status.msg);

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2.5">
                <div className="relative">
                    <Link2
                        size={16}
                        aria-hidden
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none"
                    />
                    <Input
                        aria-label="Google Drive link"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && url.trim() && !downloading) handleDownload();
                        }}
                        placeholder="paste a Google Drive file link"
                        spellCheck={false}
                        className="h-12 pl-10 pr-3 font-mono text-sm bg-background placeholder:text-muted-foreground/55"
                    />
                    {downloading && (
                        <span
                            aria-hidden
                            className="absolute left-3 right-3 -bottom-0.5 h-px rounded-full bg-primary/70 motion-safe:animate-pulse"
                        />
                    )}
                </div>
                {downloading ? (
                    <p
                        className="text-sm text-muted-foreground"
                        aria-live="polite"
                        aria-atomic="true"
                    >
                        {workingLabel}
                    </p>
                ) : status ? (
                    <div className="flex flex-col gap-1.5">
                        <p
                            className={
                                status.type === "success"
                                    ? "text-sm text-success"
                                    : "text-sm text-destructive"
                            }
                        >
                            {status.msg}
                        </p>
                        {sessionLooksExpired && onOpenCookies && (
                            <button
                                type="button"
                                onClick={onOpenCookies}
                                className="text-sm font-medium text-primary hover:underline underline-offset-4 self-start rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                                Update your Google session
                            </button>
                        )}
                    </div>
                ) : !result ? (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        Open the file in Drive, copy the address, and paste it here. The audio lands
                        in your Downloads, ready to name. Needs your Google session synced.
                    </p>
                ) : null}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[5rem_1fr] gap-x-3 gap-y-2.5 sm:items-center">
                <label
                    htmlFor="drive-artist"
                    className="text-sm font-medium tracking-wide text-muted-foreground sm:text-right"
                >
                    Creator
                </label>
                <Input
                    id="drive-artist"
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    placeholder="Optional — groups the download under a creator folder"
                    className="h-9"
                />
                <label
                    htmlFor="drive-title"
                    className="text-sm font-medium tracking-wide text-muted-foreground sm:text-right"
                >
                    Title
                </label>
                <Input
                    id="drive-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Optional — names the download folder"
                    className="h-9"
                />
            </div>

            <IngestConvertSection
                value={convert}
                onChange={setConvert}
                idPrefix="drive"
                powerMode={powerMode}
            />

            <Button
                onClick={handleDownload}
                disabled={!url.trim() || downloading}
                className="h-12 w-full gap-2 text-base"
            >
                <Download size={18} aria-hidden />
                Download from Drive
            </Button>

            {/* Push what's typed above into the shared tag editor, so the
             *  filename generator and the rename form work from it exactly
             *  as they do after a Patreon fetch. Any `|`-separated tags in
             *  the title are split out and matched against the dictionary. */}
            {canUseForFilename && (
                <Button
                    variant="outline"
                    onClick={handleUseForFilename}
                    className="h-11 w-full gap-2"
                >
                    <PenLine size={16} aria-hidden />
                    Use for filename
                </Button>
            )}

            {result && onBridgeToDownloads && (
                <button
                    type="button"
                    onClick={() => {
                        const filename = result.audio_path.split("/").pop() ?? result.audio_path;
                        onBridgeToDownloads(result.audio_path, filename);
                    }}
                    className="text-sm font-medium text-primary hover:underline underline-offset-4 self-start inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                    <ExternalLink size={12} aria-hidden />
                    Rename and move{" "}
                    <span className="font-mono">{result.audio_path.split("/").pop()}</span>
                </button>
            )}
        </div>
    );
}
