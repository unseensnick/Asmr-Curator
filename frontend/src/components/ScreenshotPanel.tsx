import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, ImagePlus, Loader2, Replace, ScanSearch, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useClipboard } from "@/hooks/useClipboard";
import { API, apiPost } from "@/lib/api";
import { parseLlmJson, parseTitleLine } from "@/lib/parser";
import type { AppDict } from "@/lib/types";
import { getErrorMessage, normaliseAndDedupeTags } from "@/lib/utils";

interface ScreenshotPanelProps {
    dict: AppDict;
    onExtracted: (title: string, tags: string[], artist: string) => void;
    /** When the app-level power mode is on, the raw-LLM debug surface is
     *  rendered (and defaulted open). When off, the debug surface is not
     *  mounted at all. rawLlmText state still gets set on extract, so
     *  flipping power mode mid-session reveals already-captured output. */
    powerMode?: boolean;
    /** True when the Screenshot tab is the active source. Gates the
     *  window-level paste listener so Ctrl+V captures an image without
     *  the user having to click into the panel first. */
    isActive: boolean;
}

interface ExtractResponse {
    raw_text: string;
}

type Status = { type: "success" | "error" | "info"; msg: string };

/**
 * Screenshot to filename. Drop / paste / pick an image, send it to the
 * vision LLM, get title + tags back. Fallback path when patreon-dl can't
 * fetch the post directly. Sibling of PatreonPanel.
 */
export default function ScreenshotPanel({
    dict,
    onExtracted,
    powerMode = false,
    isActive,
}: ScreenshotPanelProps) {
    const [imageBase64, setImageBase64] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [extracting, setExtracting] = useState(false);
    const [status, setStatus] = useState<Status | null>(null);
    const [rawLlmText, setRawLlmText] = useState("");
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Power mode render-gates the debug disclosure entirely below; when off,
    // the disclosure does not mount. The Collapsible inside it owns its own
    // open state (uncontrolled, defaulted open), so the user can still flip
    // it manually within a session. Flipping power mode unmounts/remounts,
    // resetting to defaultOpen.

    // ── Image handling ────────────────────────────────────────────────────────

    // useCallback with [] so the window-paste effect below doesn't re-attach
    // every render. handleFile only touches stable state setters, so the
    // closure captured at first mount keeps working.
    const handleFile = useCallback((file: File) => {
        if (!file.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const dataUrl = ev.target?.result as string;
            setImageBase64(dataUrl.split(",")[1] ?? null);
            setPreviewUrl(dataUrl);
            setStatus(null);
            setRawLlmText("");
        };
        reader.readAsDataURL(file);
    }, []);

    // Window-level paste so Ctrl+V works without the user having to click
    // into the panel first to focus it (a <div> isn't focusable, so the
    // React onPaste handler we used to have only fired after a click).
    // Bails out when the active element is an editable input so paste into
    // any form field still works normally — only "free" pastes are
    // intercepted, and only when the Screenshot tab is the active source.
    useEffect(() => {
        if (!isActive) return;
        function handleWindowPaste(e: ClipboardEvent) {
            const t = e.target as Element | null;
            if (
                t instanceof HTMLInputElement ||
                t instanceof HTMLTextAreaElement ||
                (t instanceof HTMLElement && t.isContentEditable)
            ) {
                return;
            }
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of Array.from(items)) {
                if (item.type.startsWith("image/")) {
                    const f = item.getAsFile();
                    if (f) {
                        e.preventDefault();
                        handleFile(f);
                        return;
                    }
                }
            }
        }
        window.addEventListener("paste", handleWindowPaste);
        return () => window.removeEventListener("paste", handleWindowPaste);
    }, [isActive, handleFile]);

    function clearImage() {
        setImageBase64(null);
        setPreviewUrl(null);
        setStatus(null);
        setRawLlmText("");
        if (fileInputRef.current) fileInputRef.current.value = "";
    }

    function replaceImage() {
        clearImage();
        fileInputRef.current?.click();
    }

    function onDragOver(e: React.DragEvent) {
        e.preventDefault();
        setDragOver(true);
    }
    function onDragLeave() {
        setDragOver(false);
    }
    function onDrop(e: React.DragEvent) {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) handleFile(f);
    }

    // ── Extract ───────────────────────────────────────────────────────────────

    async function handleExtract() {
        if (!imageBase64) return;
        setExtracting(true);
        setStatus({ type: "info", msg: "Reading the screenshot." });
        try {
            const { raw_text } = await apiPost<ExtractResponse>(API.extract, {
                image_b64: imageBase64,
            });

            const {
                raw_title_line: rawTitleLine,
                raw_pill_tags: rawPillTags,
                creator_name,
                creator_confidence,
            } = parseLlmJson(raw_text);
            const { title, embeddedTags } = parseTitleLine(rawTitleLine);

            // Merge embedded title tags + LLM pill tags, normalised, deduped.
            const allTags = normaliseAndDedupeTags([...embeddedTags, ...rawPillTags], dict);

            setRawLlmText(raw_text);
            const artist = creator_confidence === "high" && creator_name ? creator_name : "";
            onExtracted(title || rawTitleLine || "", allTags, artist);
            setStatus(
                title
                    ? { type: "success", msg: "Got it. Use for filename when ready." }
                    : {
                          type: "info",
                          msg: "No title found. Fill it in manually below.",
                      },
            );
        } catch (err) {
            setStatus({
                type: "error",
                msg: getErrorMessage(err),
            });
        } finally {
            setExtracting(false);
        }
    }

    return (
        <>
            <div className="flex-1 flex flex-col bg-card border border-border rounded-xl p-6 sm:p-7 gap-5 min-h-0">
                {!previewUrl ? (
                    <DropZone
                        dragOver={dragOver}
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDrop={onDrop}
                    />
                ) : (
                    <Preview
                        previewUrl={previewUrl}
                        onOpenLightbox={() => setLightboxOpen(true)}
                        onReplace={replaceImage}
                        onRemove={clearImage}
                    />
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                        if (e.target.files?.[0]) handleFile(e.target.files[0]);
                    }}
                />

                <Button
                    onClick={handleExtract}
                    disabled={!imageBase64 || extracting}
                    className="h-12 w-full gap-2 text-base shrink-0"
                >
                    {extracting ? (
                        <Loader2 size={16} aria-hidden className="animate-spin" />
                    ) : (
                        <ScanSearch size={18} aria-hidden />
                    )}
                    {extracting ? "Extracting" : "Extract"}
                </Button>

                {status && <StatusBanner status={status} />}

                {powerMode && rawLlmText && <DebugDisclosure rawText={rawLlmText} />}
            </div>

            {lightboxOpen && previewUrl && (
                <Lightbox previewUrl={previewUrl} onClose={() => setLightboxOpen(false)} />
            )}
        </>
    );
}

// ─── helpers ─────────────────────────────────────────────────────────────

interface DropZoneProps {
    dragOver: boolean;
    onClick: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
}

function DropZone({ dragOver, onClick, onDragOver, onDragLeave, onDrop }: DropZoneProps) {
    const baseClass =
        "flex-1 min-h-0 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-3 text-center px-4 py-7 cursor-pointer transition-colors";
    const stateClass = dragOver
        ? "border-primary/60 bg-accent/30"
        : "border-border hover:border-muted-foreground/40";
    return (
        <div
            role="button"
            tabIndex={0}
            aria-label="Drop, paste, or click to add a screenshot"
            className={`${baseClass} ${stateClass}`}
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <ImagePlus size={28} aria-hidden className="text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground leading-relaxed">
                Drop, paste, or click to add a screenshot.
                <br />
                <span className="text-xs text-muted-foreground/80">
                    Paste with{" "}
                    <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted text-foreground/80">
                        Ctrl
                    </kbd>{" "}
                    <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted text-foreground/80">
                        V
                    </kbd>
                    .
                </span>
            </p>
        </div>
    );
}

interface PreviewProps {
    previewUrl: string;
    onOpenLightbox: () => void;
    onReplace: () => void;
    onRemove: () => void;
}

function Preview({ previewUrl, onOpenLightbox, onReplace, onRemove }: PreviewProps) {
    return (
        <div className="flex-1 min-h-44 relative rounded-lg overflow-hidden bg-muted/40 border border-border">
            <button
                type="button"
                onClick={onOpenLightbox}
                aria-label="Open screenshot in lightbox"
                className="absolute inset-0 w-full h-full cursor-zoom-in hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
                <img
                    src={previewUrl}
                    alt="Screenshot preview"
                    className="w-full h-full object-contain object-top"
                />
            </button>
            <div className="absolute top-2 right-2 flex gap-1.5 z-10">
                <button
                    type="button"
                    onClick={onReplace}
                    className="size-8 rounded-md border border-border bg-card text-muted-foreground flex items-center justify-center hover:text-foreground hover:border-muted-foreground/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    aria-label="Replace image"
                >
                    <Replace size={14} aria-hidden />
                </button>
                <button
                    type="button"
                    onClick={onRemove}
                    className="size-8 rounded-md border border-border bg-card text-muted-foreground flex items-center justify-center hover:text-destructive hover:border-destructive/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    aria-label="Remove image"
                >
                    <X size={14} aria-hidden />
                </button>
            </div>
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
    // max-w-prose + break-words: keeps long backend errors from stretching the
    // banner across the full panel and pushing other content around.
    return (
        <p className={`text-sm leading-relaxed max-w-prose break-words ${tone}`}>{status.msg}</p>
    );
}

interface DebugDisclosureProps {
    rawText: string;
}

function DebugDisclosure({ rawText }: DebugDisclosureProps) {
    const { copied, copy } = useClipboard();
    return (
        <Collapsible defaultOpen>
            <div className="flex items-center justify-between gap-2">
                <CollapsibleTrigger asChild>
                    <button
                        type="button"
                        className="group/debug flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-1 px-1 -mx-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                        <ChevronDown
                            size={14}
                            aria-hidden
                            className="transition-transform motion-safe:duration-200 motion-safe:ease-out group-data-[state=closed]/debug:-rotate-90"
                        />
                        Raw LLM output
                    </button>
                </CollapsibleTrigger>
                <button
                    type="button"
                    onClick={() => copy(rawText)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    aria-label={copied ? "Copied to clipboard" : "Copy raw LLM output"}
                >
                    {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
                    {copied ? "Copied" : "Copy"}
                </button>
            </div>
            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1">
                <pre className="mt-2 bg-muted/40 border border-border rounded-md p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap wrap-break-word max-h-48 overflow-y-auto leading-relaxed">
                    {rawText}
                </pre>
            </CollapsibleContent>
        </Collapsible>
    );
}

interface LightboxProps {
    previewUrl: string;
    onClose: () => void;
}

function Lightbox({ previewUrl, onClose }: LightboxProps) {
    // Window-level Escape handler so the lightbox dismisses on keyboard
    // even when initial focus hasn't moved into the close button yet.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    return (
        <div
            role="dialog"
            aria-label="Screenshot preview"
            aria-modal="true"
            className="fixed inset-0 z-50 bg-background/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-150"
        >
            {/* Backdrop click-target: a sibling button covers the full
             *  viewport so click-to-dismiss has interactive semantics
             *  (button + Enter/Space), while the dialog itself stays
             *  semantically a dialog without interaction handlers. */}
            <button
                type="button"
                onClick={onClose}
                tabIndex={-1}
                aria-label="Close preview"
                className="absolute inset-0 w-full h-full cursor-zoom-out focus-visible:outline-none"
            />
            <div className="relative max-w-205 w-full cursor-default animate-in zoom-in-95 duration-150">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute -top-3.5 -right-3.5 size-8 rounded-full bg-card border border-border text-muted-foreground flex items-center justify-center hover:text-foreground hover:border-muted-foreground/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 z-10"
                    aria-label="Close preview"
                >
                    <X size={14} aria-hidden />
                </button>
                <img
                    src={previewUrl}
                    alt="Screenshot preview"
                    className="w-full rounded-xl block shadow-2xl ring-1 ring-border relative"
                />
            </div>
        </div>
    );
}
