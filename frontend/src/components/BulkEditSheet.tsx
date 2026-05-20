import { useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";

import SectionLabel from "@/components/SectionLabel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { loadCachedMetadata } from "@/lib/api";
import type { FileEntry } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

export type BulkEditRoot = "library" | "downloads";

/**
 * Per-file local edits. Both fields start empty; the backend treats an
 * empty title as 'leave existing alone' (skip-on-empty), and empty tags
 * mean 'no tags in the new filename' when rename is on. Phase 6 will add
 * a Load-from-cache button that pre-fills these from `post-api.json`
 * sidecars.
 */
interface PerFileEdit {
    title: string;
    /** Comma-separated input the user types. Split into a tag array only
     *  when composing the new filename in phase 7; kept as raw text here
     *  so the user can free-form edit without the comma roundtrip
     *  rewriting whitespace as they type. */
    tags: string;
}

const EMPTY_EDIT: PerFileEdit = { title: "", tags: "" };

/**
 * Shared values written to every selected file in one stroke. The three
 * ID3-backed fields (artist, album_artist, album) flow into the backend's
 * `shared` block on `PATCH /api/files/bulk-write`; the suffix is
 * filename-composition only and stays client-side (phase 7 will splice it
 * into the canonical `new_name`).
 */
type SharedIdField = "artist" | "album_artist" | "album";

const SHARED_ID_FIELDS = [
    "artist",
    "album_artist",
    "album",
] as const satisfies readonly SharedIdField[];

const SHARED_FIELD_LABELS: Record<SharedIdField, string> = {
    artist: "Artist",
    album_artist: "Album artist",
    album: "Album",
};

interface SharedMetadata {
    artist: string;
    album_artist: string;
    album: string;
    suffix: string;
}

const EMPTY_SHARED: SharedMetadata = { artist: "", album_artist: "", album: "", suffix: "" };

interface BulkEditSheetProps {
    open: boolean;
    onClose: () => void;
    /**
     * Files the user picked in the FileBrowser. The button that opens this
     * surface only appears for 2+, but the component handles 0/1 gracefully
     * so a stale-state open at the wrong moment doesn't surface as a crash.
     */
    files: FileEntry[];
    /**
     * Root the selection lives under. Passed through to
     * `/api/files/load-cached-metadata` and `/api/files/bulk-write` so the
     * backend resolves paths against the right side of the bind-mount.
     */
    root: BulkEditRoot;
}

/**
 * Bulk metadata + optional canonical rename across a selection of audio
 * files. Right-side slide-over matching `CookiesSheet`, `HelpSheet`, and
 * `LibrarySettingsSheet` — calm chrome, three vertical sections (per-file
 * details, apply-to-all, rename), sticky footer with a Cancel + the gated
 * Preview-changes commit.
 *
 * This commit fills in the per-file table (phase 4). The apply-to-all
 * form (phase 5), the load-from-cache wiring (phase 6), and the dry-run
 * rename preview (phase 7) fill the remaining sections. Phase 8 lands
 * the toolbar button that actually opens this; until then the sheet is
 * wired but unreachable from the UI.
 *
 * State resets on unmount — App.tsx conditionally renders this only
 * while `bulkEditOpen` is true, so re-opening always starts fresh
 * without a manual cleanup effect.
 */
type LoadFeedback =
    | { kind: "none" }
    | { kind: "success"; loaded: number; total: number }
    | { kind: "empty" }
    | { kind: "error"; message: string };

export default function BulkEditSheet({ open, onClose, files, root }: BulkEditSheetProps) {
    // Keyed by `FileEntry.path` (relative to the chosen root). Paths the
    // user hasn't touched aren't in the map — `editFor` falls back to
    // EMPTY_EDIT so the inputs render as blank with placeholder copy.
    const [edits, setEdits] = useState<Record<string, PerFileEdit>>({});

    function patchEdit(path: string, partial: Partial<PerFileEdit>) {
        setEdits((prev) => ({
            ...prev,
            [path]: { ...(prev[path] ?? EMPTY_EDIT), ...partial },
        }));
    }

    function editFor(path: string): PerFileEdit {
        return edits[path] ?? EMPTY_EDIT;
    }

    // Shared apply-to-all metadata + the explicit-clear set. Empty values
    // mean "leave the field as-is on each file" (the backend's skip-on-
    // empty rule); `clearFields` is the only path that writes a blank ID3
    // frame across the selection.
    const [shared, setShared] = useState<SharedMetadata>(EMPTY_SHARED);
    const [clearFields, setClearFields] = useState<Set<SharedIdField>>(new Set());

    // A field belongs to `mixedFields` when the per-file values loaded by
    // the Load-from-cache step disagree across the selection. The MP3Tag-
    // style `<Mixed values>` placeholder fires off the same set so users
    // get the convention they already know from there.
    const [mixedFields, setMixedFields] = useState<Set<SharedIdField>>(new Set());

    // Load-from-cache state. `isLoading` gates the button + spinner; the
    // feedback variant carries either a hit count, an empty-result state,
    // or an error message. Reset on every fresh click so feedback never
    // lingers stale from a previous attempt.
    const [isLoading, setIsLoading] = useState(false);
    const [loadFeedback, setLoadFeedback] = useState<LoadFeedback>({ kind: "none" });

    async function handleLoadFromCache() {
        if (files.length === 0 || isLoading) return;
        setIsLoading(true);
        setLoadFeedback({ kind: "none" });
        try {
            const response = await loadCachedMetadata(
                files.map((f) => f.path),
                root,
            );
            // Walk the items: populate per-file edits where the sidecar
            // returned data, collect non-empty artists across the
            // selection so we can decide single-value vs mixed.
            const nextEdits: Record<string, PerFileEdit> = { ...edits };
            const artistsSeen = new Set<string>();
            let loaded = 0;
            for (const item of response.items) {
                const hasData = item.title || item.artist || (item.tags && item.tags.length > 0);
                if (!hasData) continue;
                loaded += 1;
                nextEdits[item.path] = {
                    title: item.title ?? "",
                    tags: item.tags?.join(", ") ?? "",
                };
                if (item.artist) artistsSeen.add(item.artist);
            }
            setEdits(nextEdits);

            // Artist: 0 distinct -> leave shared.artist alone; 1 ->
            // populate; >1 -> show `<Mixed values>` placeholder via the
            // mixedFields set, with shared.artist itself blank so any
            // typed value clearly overrides everything.
            if (artistsSeen.size === 1) {
                const onlyArtist = [...artistsSeen][0] ?? "";
                setShared((prev) => ({ ...prev, artist: onlyArtist }));
                setMixedFields((prev) => {
                    const next = new Set(prev);
                    next.delete("artist");
                    return next;
                });
            } else if (artistsSeen.size > 1) {
                setShared((prev) => ({ ...prev, artist: "" }));
                setMixedFields((prev) => {
                    const next = new Set(prev);
                    next.add("artist");
                    return next;
                });
            }

            setLoadFeedback(
                loaded === 0 ? { kind: "empty" } : { kind: "success", loaded, total: files.length },
            );
        } catch (err) {
            setLoadFeedback({ kind: "error", message: getErrorMessage(err) });
        } finally {
            setIsLoading(false);
        }
    }

    function toggleClear(field: SharedIdField) {
        const willClear = !clearFields.has(field);
        setClearFields((prev) => {
            const next = new Set(prev);
            if (willClear) next.add(field);
            else next.delete(field);
            return next;
        });
        // Entering clear mode blanks the input so there's no stale value
        // sitting behind the disabled state. Exiting just restores typing
        // — the input was empty under the disabled overlay anyway.
        if (willClear) {
            setShared((prev) => ({ ...prev, [field]: "" }));
        }
    }

    function patchShared<K extends keyof SharedMetadata>(field: K, value: SharedMetadata[K]) {
        setShared((prev) => ({ ...prev, [field]: value }));
        // Typing anything cancels a pending clear on that field — the
        // user clearly wants to set, not blank. Same logic dismisses the
        // `<Mixed values>` placeholder: any typed value is an explicit
        // override, so we drop the field out of mixedFields too.
        if (field !== "suffix" && value) {
            const idField = field as SharedIdField;
            if (clearFields.has(idField)) {
                setClearFields((prev) => {
                    const next = new Set(prev);
                    next.delete(idField);
                    return next;
                });
            }
            if (mixedFields.has(idField)) {
                setMixedFields((prev) => {
                    const next = new Set(prev);
                    next.delete(idField);
                    return next;
                });
            }
        }
    }

    function placeholderForShared(field: SharedIdField): string {
        if (clearFields.has(field)) return "Will clear on apply";
        if (mixedFields.has(field)) return "<Mixed values>";
        return "";
    }

    const count = files.length;
    const fileWord = count === 1 ? "file" : "files";

    return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
            <SheetContent
                className="w-full sm:max-w-2xl lg:max-w-3xl xl:max-w-4xl overflow-hidden"
                showCloseButton={false}
            >
                <SheetTitle className="sr-only">Bulk edit</SheetTitle>
                <SheetDescription className="sr-only">
                    Edit metadata across {count} selected {fileWord} and optionally rename to a
                    canonical format.
                </SheetDescription>

                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
                    <span className="text-sm font-medium tracking-wide text-foreground">
                        Bulk edit
                    </span>
                    <span className="text-sm text-muted-foreground" aria-live="polite">
                        {count} {fileWord}
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        aria-label="Close bulk edit"
                        title="Close"
                    >
                        <X size={18} aria-hidden />
                    </button>
                </div>

                {/* Body (scrollable) */}
                <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-7">
                    <section aria-label="Per-file details" className="flex flex-col gap-3">
                        <SectionLabel>Per-file details</SectionLabel>
                        {count === 0 ? (
                            <p className="text-sm text-muted-foreground italic">
                                No files selected.
                            </p>
                        ) : (
                            <>
                                {/* Load-from-cache row. Lives above the table
                                    because users scan top-down — seeing the
                                    button first signals "you can pre-fill"
                                    before they reach for the keyboard. The
                                    feedback line sits next to the button so
                                    it never causes a layout shift even when
                                    cycling through empty / success / error
                                    states. */}
                                <div className="flex items-center gap-3 flex-wrap">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleLoadFromCache}
                                        disabled={isLoading}
                                    >
                                        {isLoading ? (
                                            <Loader2
                                                size={14}
                                                aria-hidden
                                                className="animate-spin"
                                            />
                                        ) : (
                                            <RefreshCw size={14} aria-hidden />
                                        )}
                                        Load from cached post info
                                    </Button>
                                    {loadFeedback.kind === "success" && (
                                        <span
                                            className="text-xs text-muted-foreground"
                                            aria-live="polite"
                                        >
                                            Loaded {loadFeedback.loaded} of {loadFeedback.total}{" "}
                                            {loadFeedback.total === 1 ? "file" : "files"}.
                                        </span>
                                    )}
                                    {loadFeedback.kind === "empty" && (
                                        <span
                                            className="text-xs text-muted-foreground"
                                            aria-live="polite"
                                        >
                                            No cached info for these files.
                                        </span>
                                    )}
                                    {loadFeedback.kind === "error" && (
                                        <span
                                            className="text-xs text-destructive"
                                            aria-live="polite"
                                        >
                                            {loadFeedback.message}
                                        </span>
                                    )}
                                </div>
                                <TooltipProvider delayDuration={500}>
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-border">
                                                <th
                                                    scope="col"
                                                    className="text-left text-[10px] font-medium tracking-[0.08em] uppercase text-muted-foreground/80 px-3 py-2 w-[34%]"
                                                >
                                                    File
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="text-left text-[10px] font-medium tracking-[0.08em] uppercase text-muted-foreground/80 px-3 py-2 w-[30%]"
                                                >
                                                    Title
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="text-left text-[10px] font-medium tracking-[0.08em] uppercase text-muted-foreground/80 px-3 py-2"
                                                >
                                                    Tags
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {files.map((file) => {
                                                const edit = editFor(file.path);
                                                return (
                                                    <tr
                                                        key={file.path}
                                                        className="border-b border-border last:border-b-0"
                                                    >
                                                        <th
                                                            scope="row"
                                                            className="text-left font-normal px-3 py-3 align-middle min-w-0"
                                                        >
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <span className="block font-mono text-xs text-foreground truncate">
                                                                        {file.name}
                                                                    </span>
                                                                </TooltipTrigger>
                                                                <TooltipContent
                                                                    side="right"
                                                                    className="max-w-md"
                                                                >
                                                                    <div className="flex flex-col gap-0.5 font-mono text-left">
                                                                        <span className="break-all">
                                                                            {file.name}
                                                                        </span>
                                                                        {file.folder && (
                                                                            <span className="text-background/70 break-all">
                                                                                {file.folder}/
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </th>
                                                        <td className="px-3 py-2 align-middle">
                                                            <Input
                                                                value={edit.title}
                                                                onChange={(ev) =>
                                                                    patchEdit(file.path, {
                                                                        title: ev.target.value,
                                                                    })
                                                                }
                                                                placeholder="Keep existing"
                                                                aria-label={`Title for ${file.name}`}
                                                                className="font-mono text-sm"
                                                            />
                                                        </td>
                                                        <td className="px-3 py-2 align-middle">
                                                            <Input
                                                                value={edit.tags}
                                                                onChange={(ev) =>
                                                                    patchEdit(file.path, {
                                                                        tags: ev.target.value,
                                                                    })
                                                                }
                                                                placeholder="tag1, tag2, …"
                                                                aria-label={`Tags for ${file.name}`}
                                                                className="font-mono text-sm"
                                                            />
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </TooltipProvider>
                            </>
                        )}
                    </section>

                    <section aria-label="Apply to all" className="flex flex-col gap-3">
                        <SectionLabel>Apply to all</SectionLabel>
                        <p className="text-xs text-muted-foreground/80 leading-relaxed -mt-1">
                            Empty leaves the field as-is on each file. Use Clear to blank it across
                            the selection.
                        </p>
                        <div className="flex flex-col gap-2.5">
                            {SHARED_ID_FIELDS.map((field) => {
                                const isCleared = clearFields.has(field);
                                const inputId = `bulk-shared-${field}`;
                                return (
                                    <div key={field} className="flex items-center gap-2">
                                        <label
                                            htmlFor={inputId}
                                            className="w-28 shrink-0 text-sm text-muted-foreground"
                                        >
                                            {SHARED_FIELD_LABELS[field]}
                                        </label>
                                        <Input
                                            id={inputId}
                                            value={shared[field]}
                                            onChange={(e) => patchShared(field, e.target.value)}
                                            disabled={isCleared}
                                            placeholder={placeholderForShared(field)}
                                            className="flex-1 font-mono text-sm"
                                        />
                                        <Button
                                            type="button"
                                            variant={isCleared ? "secondary" : "ghost"}
                                            size="sm"
                                            onClick={() => toggleClear(field)}
                                            aria-pressed={isCleared}
                                            aria-label={
                                                isCleared
                                                    ? `Cancel clearing ${SHARED_FIELD_LABELS[field]}`
                                                    : `Clear ${SHARED_FIELD_LABELS[field]} on all files`
                                            }
                                            className="shrink-0"
                                        >
                                            {isCleared ? "Clearing" : "Clear"}
                                        </Button>
                                    </div>
                                );
                            })}
                            {/* Suffix is filename-composition only — no ID3 write,
                                so no Clear toggle. Sits below the three ID3 rows
                                with extra top padding to mark the grouping
                                without a horizontal rule. */}
                            <div className="flex items-center gap-2 pt-2">
                                <label
                                    htmlFor="bulk-shared-suffix"
                                    className="w-28 shrink-0 text-sm text-muted-foreground"
                                >
                                    Suffix
                                </label>
                                <Input
                                    id="bulk-shared-suffix"
                                    value={shared.suffix}
                                    onChange={(e) => patchShared("suffix", e.target.value)}
                                    placeholder="F4A"
                                    className="flex-1 font-mono text-sm"
                                />
                            </div>
                        </div>
                    </section>

                    <section aria-label="Rename" className="flex flex-col gap-3">
                        <SectionLabel>Rename</SectionLabel>
                        {/* phase 7: rename toggle + dry-run preview pane */}
                    </section>
                </div>

                {/* Footer — Cancel + the gated commit. Preview-changes stays
                    disabled until phases 5-7 surface an edited value to act on. */}
                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="default"
                        size="sm"
                        disabled
                        aria-label="Preview changes (no edits to commit yet)"
                    >
                        Preview changes
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
