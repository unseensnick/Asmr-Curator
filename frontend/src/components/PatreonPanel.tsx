import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, ExternalLink, Link2, User } from "lucide-react";

import DatePicker from "@/components/DatePicker";
import ExternalLinksHint from "@/components/ExternalLinksHint";
import PatreonResultsList from "@/components/PatreonResultsList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fetchPatreonPost } from "@/lib/api";
import { parseTitleLine } from "@/lib/parser";
import type { AppDict, PatreonContentType, PatreonFetchEvent, PatreonPost } from "@/lib/types";
import { getErrorMessage, normaliseAndDedupeTags, splitLogTail } from "@/lib/utils";

interface PatreonPanelProps {
    dict: AppDict;
    onExtracted: (title: string, tags: string[], artist: string) => void;
    /** When the app-level power mode is on, the "More options" disclosure
     *  auto-opens on mount and on power-mode flips. User can still close it
     *  manually afterwards; turning power mode off does not collapse it. */
    powerMode?: boolean;
    /** Open the Cookies modal. Surfaced inline in the error state so the
     *  user can fix an expired/missing session without hunting through the
     *  Settings menu. */
    onOpenCookies?: () => void;
    /** Optional bridge into the FileBrowser Downloads tab. Called after the
     *  user clicks the post-Apply "Rename and move <file>" link so the
     *  downloaded file is auto-selected for the rename + move flow. */
    onBridgeToDownloads?: (path: string, filename: string) => void;
}

const CONTENT_TYPE_KEY = "patreon.contentTypes";

const ALL_CONTENT_TYPES: { value: PatreonContentType; label: string }[] = [
    { value: "audio", label: "Audio" },
    { value: "external", label: "Drive links" },
    { value: "video", label: "Video" },
    { value: "image", label: "Images" },
    { value: "attachment", label: "Attachments" },
];

function loadStoredContentTypes(): PatreonContentType[] {
    try {
        const raw = localStorage.getItem(CONTENT_TYPE_KEY);
        if (!raw) return ["audio"];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return ["audio"];
        const allowed = new Set<PatreonContentType>([
            "audio",
            "video",
            "image",
            "attachment",
            "external",
        ]);
        const cleaned = parsed.filter(
            (v): v is PatreonContentType =>
                typeof v === "string" && allowed.has(v as PatreonContentType),
        );
        return cleaned.length > 0 ? cleaned : ["audio"];
    } catch {
        return ["audio"];
    }
}

type Status = { type: "success" | "error" | "info"; msg: string };

export default function PatreonPanel({
    dict,
    onExtracted,
    powerMode = false,
    onOpenCookies,
    onBridgeToDownloads,
}: PatreonPanelProps) {
    const [url, setUrl] = useState("");
    const [metadataOnly, setMetadataOnly] = useState(false);
    const [dryRun, setDryRun] = useState(false);
    const [contentTypes, setContentTypes] = useState<PatreonContentType[]>(() =>
        loadStoredContentTypes(),
    );
    const [publishedAfter, setPublishedAfter] = useState("");
    const [publishedBefore, setPublishedBefore] = useState("");
    const [fetching, setFetching] = useState(false);
    const [fetchStatus, setFetchStatus] = useState<Status | null>(null);
    const [applyStatus, setApplyStatus] = useState<Status | null>(null);
    const [post, setPost] = useState<PatreonPost | null>(null);
    const [posts, setPosts] = useState<PatreonPost[]>([]);
    const [logTail, setLogTail] = useState<string>("");
    // Latest SSE phase event from /api/patreon/fetch — drives the live
    // narration under the URL input. `null` while idle.
    const [phase, setPhase] = useState<PatreonFetchEvent | null>(null);
    // Remember the last post the user applied so the bridge link knows
    // which downloaded file to hand off to the FileBrowser Downloads tab.
    const [lastApplied, setLastApplied] = useState<PatreonPost | null>(null);
    // AbortController so unmount / re-fetch cancels the in-flight SSE
    // stream and the server's runner task tears down cleanly.
    const fetchAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        return () => {
            fetchAbortRef.current?.abort();
        };
    }, []);

    // key={String(powerMode)} on the Collapsible forces a remount so
    // flipping power-mode reseeds the disclosure's defaultOpen.

    useEffect(() => {
        try {
            localStorage.setItem(CONTENT_TYPE_KEY, JSON.stringify(contentTypes));
        } catch {
            // non-fatal
        }
    }, [contentTypes]);

    async function handleFetch() {
        const trimmed = url.trim();
        if (!trimmed) return;
        // Cancel any in-flight stream before kicking off a new one.
        fetchAbortRef.current?.abort();
        const controller = new AbortController();
        fetchAbortRef.current = controller;

        setFetching(true);
        setFetchStatus(null);
        setApplyStatus(null);
        setLastApplied(null);
        setPost(null);
        setPosts([]);
        setLogTail("");
        setPhase({ state: "starting" });
        try {
            const res = await fetchPatreonPost(
                trimmed,
                {
                    metadataOnly,
                    contentTypes,
                    publishedAfter: publishedAfter || undefined,
                    publishedBefore: publishedBefore || undefined,
                    dryRun,
                },
                (event) => {
                    setPhase(event);
                },
                controller.signal,
            );
            if (res.dry_run) {
                setFetchStatus({
                    type: "info",
                    msg:
                        res.hint ??
                        "Preview complete. See the log below for what would have downloaded.",
                });
                if (res.log_tail) setLogTail(res.log_tail);
                return;
            }
            if (res.count === 0 || res.posts.length === 0) {
                setFetchStatus({
                    type: "error",
                    msg:
                        res.hint ??
                        "No posts found. Check the URL, or update your Patreon session in settings.",
                });
                if (res.log_tail) setLogTail(res.log_tail);
                return;
            }
            if (res.posts.length > 1) {
                setPosts(res.posts);
            } else {
                setPost(res.posts[0] ?? null);
            }
        } catch (err) {
            if (controller.signal.aborted) return;
            const { head, logTail: tail } = splitLogTail(getErrorMessage(err));
            setFetchStatus({
                type: "error",
                msg:
                    head ||
                    "Patreon isn't responding. Try again, or update your Patreon session in settings.",
            });
            if (tail) setLogTail(tail);
        } finally {
            if (fetchAbortRef.current === controller) {
                fetchAbortRef.current = null;
            }
            setFetching(false);
            setPhase(null);
        }
    }

    // Mirror the screenshot extraction pipeline: split the raw title into a
    // clean title + embedded tags, merge with API tags, normalise via dictionary.
    function applyPost(p: PatreonPost) {
        const { title, embeddedTags } = parseTitleLine(p.title || "");
        const normalised = normaliseAndDedupeTags([...embeddedTags, ...p.tags], dict);
        onExtracted(title || p.title || "", normalised, p.artist || "");
        setApplyStatus({
            type: "success",
            msg: `Applied #${p.post_id}. Edit tags or generate the filename next.`,
        });
        setLastApplied(p);
    }

    const fetchLabel = dryRun
        ? "Preview only"
        : metadataOnly
          ? "Fetch info only"
          : "Fetch from Patreon";

    const idleWorkingLabel = dryRun
        ? "Previewing the pipeline."
        : metadataOnly
          ? "Fetching post info."
          : "Pulling from Patreon.";

    const workingLabel = phase ? phaseLabel(phase, idleWorkingLabel) : idleWorkingLabel;

    const hasResult = post !== null || posts.length > 0;

    return (
        <div className="flex flex-col gap-5">
            {/* URL input — always visible; paste a new URL and fetch to replace results */}
            <div className="flex flex-col gap-2.5">
                <div className="relative">
                    <Link2
                        size={16}
                        aria-hidden
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none"
                    />
                    <Input
                        aria-label="Patreon post or creator URL"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && url.trim() && !fetching) handleFetch();
                        }}
                        placeholder="paste a Patreon URL"
                        spellCheck={false}
                        className="h-12 pl-10 pr-3 font-mono text-sm bg-background placeholder:text-muted-foreground/55"
                    />
                    {fetching && (
                        <span
                            aria-hidden
                            className="absolute left-3 right-3 -bottom-0.5 h-px rounded-full bg-primary/70 motion-safe:animate-pulse"
                        />
                    )}
                </div>
                {fetching ? (
                    <p
                        className="text-sm text-muted-foreground"
                        aria-live="polite"
                        aria-atomic="true"
                    >
                        {workingLabel}
                    </p>
                ) : fetchStatus ? (
                    <div className="flex flex-col gap-1.5">
                        <StatusBanner status={fetchStatus} />
                        {fetchStatus.type === "error" && onOpenCookies && (
                            <button
                                type="button"
                                onClick={onOpenCookies}
                                className="text-sm font-medium text-primary hover:underline underline-offset-4 self-start rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                                Set Patreon cookie
                            </button>
                        )}
                    </div>
                ) : !hasResult ? (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        A single post URL fetches one file. A creator URL downloads their full
                        archive.
                    </p>
                ) : null}
            </div>

            <Button
                onClick={handleFetch}
                disabled={!url.trim() || fetching}
                className="h-12 w-full gap-2 text-base"
            >
                <Download size={18} aria-hidden />
                {fetchLabel}
            </Button>

            <Collapsible key={String(powerMode)} defaultOpen={powerMode}>
                <CollapsibleTrigger asChild>
                    <button
                        type="button"
                        className="group/more flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2 px-1 -mx-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 w-fit"
                    >
                        <ChevronDown
                            size={16}
                            aria-hidden
                            className="transition-transform motion-safe:duration-200 motion-safe:ease-out group-data-[state=open]/more:rotate-180"
                        />
                        More options
                    </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1">
                    <div className="pt-4 flex flex-col gap-5">
                        <FetchModeSelector
                            metadataOnly={metadataOnly}
                            dryRun={dryRun}
                            onMetadataOnlyChange={setMetadataOnly}
                            onDryRunChange={setDryRun}
                        />

                        <FieldGroup label="Also include" disabled={metadataOnly}>
                            <ToggleGroup
                                type="multiple"
                                value={contentTypes}
                                onValueChange={(values) =>
                                    setContentTypes(
                                        values.length > 0
                                            ? (values as PatreonContentType[])
                                            : ["audio"],
                                    )
                                }
                                disabled={metadataOnly}
                                className="flex flex-wrap gap-1.5"
                            >
                                {ALL_CONTENT_TYPES.map(({ value, label }) => (
                                    <ToggleGroupItem
                                        key={value}
                                        value={value}
                                        aria-label={label}
                                        className="text-sm px-3 py-1.5 h-auto rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:border-muted-foreground/30 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:border-transparent"
                                    >
                                        {label}
                                    </ToggleGroupItem>
                                ))}
                            </ToggleGroup>
                            <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">
                                Audio-only by default. Add{" "}
                                <strong className="font-medium text-foreground">Drive links</strong>{" "}
                                if posts link out instead of attaching audio.
                            </p>
                        </FieldGroup>

                        <FieldGroup label="Published between">
                            <div className="grid grid-cols-2 gap-2">
                                <DatePicker
                                    value={publishedAfter}
                                    onChange={setPublishedAfter}
                                    placeholder="after"
                                />
                                <DatePicker
                                    value={publishedBefore}
                                    onChange={setPublishedBefore}
                                    placeholder="before"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">
                                Optional. Only affects creator URLs. Re-fetches skip posts already
                                saved.
                            </p>
                        </FieldGroup>
                    </div>
                </CollapsibleContent>
            </Collapsible>

            {/* Results — inline below options, no pane switch required */}
            {hasResult && (
                <div className="border-t border-border/50 pt-5 flex flex-col gap-4">
                    {applyStatus && <StatusBanner status={applyStatus} />}
                    {lastApplied?.audio_path && onBridgeToDownloads && (
                        <button
                            type="button"
                            onClick={() => {
                                const filename =
                                    lastApplied.audio_path!.split("/").pop() ??
                                    lastApplied.audio_path!;
                                onBridgeToDownloads(lastApplied.audio_path!, filename);
                            }}
                            className="text-sm font-medium text-primary hover:underline underline-offset-4 self-start inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            <ExternalLink size={12} aria-hidden />
                            Rename and move{" "}
                            <span className="font-mono">
                                {lastApplied.audio_path.split("/").pop()}
                            </span>
                        </button>
                    )}
                    {posts.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                            <strong className="font-semibold text-foreground">
                                {posts.length}
                            </strong>{" "}
                            posts found. Click a row to use it.
                        </p>
                    )}
                    {post && <SinglePostResult post={post} onApply={() => applyPost(post)} />}
                    {posts.length > 0 && <PatreonResultsList posts={posts} onApply={applyPost} />}
                </div>
            )}

            {logTail && <LogTail tail={logTail} />}
        </div>
    );
}

// ── Phase narration ───────────────────────────────────────────────────────────
//
// Map one SSE event from /api/patreon/fetch to the librarian-voice line we
// render under the URL input. patreon-dl's pipeline goes:
//   starting → resolving → fetching_posts → posts_found → post_progress
//             → downloading → wrote_file → … → phase_done → done
// Anything we don't recognise falls back to the caller's idle label so the
// user never sees an empty bar.

function formatMB(bytes: number | null | undefined): string {
    if (bytes == null) return "?";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
}

function truncate(s: string, max = 60): string {
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1).trimEnd()}…`;
}

function phaseLabel(event: PatreonFetchEvent, idleLabel: string): string {
    switch (event.state) {
        case "starting":
            return idleLabel;
        case "cached":
            return event.count === 1
                ? "Found the post in your library cache. No re-download needed."
                : `Found ${event.count} cached posts. No re-download needed.`;
        case "resolving":
            if (event.target_kind === "creator") {
                return `Looking up ${event.label} on Patreon.`;
            }
            if (event.target_kind === "post") {
                return `Looking up post #${event.label}.`;
            }
            return "Resolving the link with Patreon.";
        case "fetching_posts":
            if (event.total > 0) {
                return `Reading the post list (${event.fetched} of ${event.total}).`;
            }
            return `Reading the post list (${event.fetched} found).`;
        case "posts_found":
            return event.count === 1
                ? "Found 1 post. Starting the download."
                : `Found ${event.count} posts. Starting the downloads.`;
        case "post_progress": {
            const title = event.title ? `: ${truncate(event.title)}` : "";
            return `Downloading post #${event.post_id}${title}`;
        }
        case "downloading": {
            const speed = event.speed_kbs != null ? ` at ${event.speed_kbs} kB/s` : "";
            if (event.total > 0) {
                return `Downloading ${formatMB(event.bytes)} of ${formatMB(event.total)} (${event.percent}%)${speed}.`;
            }
            return `Downloading ${formatMB(event.bytes)}${speed}.`;
        }
        case "wrote_file": {
            const name = event.path.split(/[/\\]/).pop() ?? event.path;
            return `Saved ${truncate(name, 50)}.`;
        }
        case "skipped":
            // patreon-dl emits reasons like "already downloaded and nothing
            // has changed since last download" — too long for inline copy.
            return `Skipped #${event.post_id}. Already in your library.`;
        case "phase_done":
            return "Wrapping up. Tidying the files.";
        case "done":
            return "Done.";
        case "error":
            return event.message;
    }
}

// ── Sub-components ────────────────────────────────────────────────────────────

type FetchMode = "full" | "info" | "preview";

interface FetchModeSelectorProps {
    metadataOnly: boolean;
    dryRun: boolean;
    onMetadataOnlyChange: (v: boolean) => void;
    onDryRunChange: (v: boolean) => void;
}

/**
 * Three-option segmented control replacing the prior pair of mutually-
 * exclusive checkboxes (Don't download audio / Preview only). Internal
 * state stays as two booleans because the API contract still carries
 * `metadata_only` and `dry_run` as separate fields; the selector flips
 * them coordinately and renders a single dynamic hint underneath so the
 * user sees what their current selection does.
 */
function FetchModeSelector({
    metadataOnly,
    dryRun,
    onMetadataOnlyChange,
    onDryRunChange,
}: FetchModeSelectorProps) {
    const mode: FetchMode = dryRun ? "preview" : metadataOnly ? "info" : "full";
    const hint: Record<FetchMode, string> = {
        full: "Pulls audio and post info into the library.",
        info: "Saves the post info only. Use this when the file is already on disk.",
        preview: "Walks the pipeline without writing anything to disk.",
    };

    function setMode(next: FetchMode) {
        if (next === "full") {
            onMetadataOnlyChange(false);
            onDryRunChange(false);
        } else if (next === "info") {
            onMetadataOnlyChange(true);
            onDryRunChange(false);
        } else {
            onMetadataOnlyChange(false);
            onDryRunChange(true);
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <ToggleGroup
                type="single"
                value={mode}
                onValueChange={(v) => v && setMode(v as FetchMode)}
                className="border border-border rounded-md overflow-hidden gap-0"
            >
                {(["full", "info", "preview"] as FetchMode[]).map((m) => (
                    <ToggleGroupItem
                        key={m}
                        value={m}
                        className="flex-1 text-sm px-3 py-1.5 h-auto rounded-none! border-r border-border last:border-r-0 bg-background text-muted-foreground hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:border-accent"
                    >
                        {m === "full" ? "Full fetch" : m === "info" ? "Info only" : "Preview"}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground leading-relaxed">{hint[mode]}</p>
        </div>
    );
}

interface FieldGroupProps {
    label: string;
    disabled?: boolean;
    children: React.ReactNode;
}

function FieldGroup({ label, disabled, children }: FieldGroupProps) {
    return (
        <div className={disabled ? "opacity-50 pointer-events-none" : undefined}>
            <div className="text-sm font-medium tracking-wide text-muted-foreground mb-2">
                {label}
            </div>
            {children}
        </div>
    );
}

interface SinglePostResultProps {
    post: PatreonPost;
    onApply: () => void;
}

function SinglePostResult({ post, onApply }: SinglePostResultProps) {
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2.5 text-xs">
                    <Badge variant="outline" className="font-mono text-[10px] tracking-wide">
                        #{post.post_id}
                    </Badge>
                    {post.artist && (
                        <span className="text-muted-foreground flex items-center gap-1.5">
                            <User size={12} aria-hidden />
                            {post.artist}
                        </span>
                    )}
                </div>
                <h3 className="font-display text-xl sm:text-2xl font-semibold leading-tight text-foreground tracking-tight wrap-break-word">
                    {post.title || (
                        <span className="text-muted-foreground italic font-normal">
                            Untitled post
                        </span>
                    )}
                </h3>
            </div>

            {post.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {post.tags.map((t) => (
                        <span
                            key={t}
                            className="font-mono text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground"
                        >
                            {t}
                        </span>
                    ))}
                </div>
            )}

            {post.audio_path ? (
                <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium tracking-wide text-muted-foreground">
                        Saved to
                    </span>
                    <code className="font-mono text-sm break-all text-foreground/90">
                        {post.audio_path}
                    </code>
                </div>
            ) : !post.external_links?.length ? (
                <p className="text-sm text-muted-foreground italic">
                    No Patreon audio and no recognised external links. Open the post manually to
                    check.
                </p>
            ) : null}

            {post.external_links && post.external_links.length > 0 && (
                <ExternalLinksHint
                    postId={post.post_id}
                    artist={post.artist}
                    title={post.title}
                    links={post.external_links}
                />
            )}

            <Button onClick={onApply} className="h-12 w-full text-base">
                Use for filename
            </Button>
        </div>
    );
}

interface StatusBannerProps {
    status: Status;
}

function StatusBanner({ status }: StatusBannerProps) {
    const tone =
        status.type === "success"
            ? "text-success"
            : status.type === "error"
              ? "text-destructive"
              : "text-muted-foreground";
    return (
        <p className={`text-sm leading-relaxed max-w-prose break-words ${tone}`}>{status.msg}</p>
    );
}

interface LogTailProps {
    tail: string;
}

function LogTail({ tail }: LogTailProps) {
    return (
        <details className="border-t border-border pt-3 mt-1">
            <summary className="text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none flex items-center gap-1.5 transition-colors">
                <ExternalLink size={12} aria-hidden />
                Show fetch log
            </summary>
            <pre className="mt-2 bg-muted/40 border border-border rounded-md p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap wrap-break-word max-h-44 overflow-y-auto leading-relaxed">
                {tail}
            </pre>
        </details>
    );
}
