import { useMemo, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, X } from "lucide-react";

import SectionLabel from "@/components/SectionLabel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { bulkWrite, loadCachedMetadata } from "@/lib/api";
import type { FileEntry } from "@/lib/types";
import { getErrorMessage, sanitizeFilename, stripOuterBrackets } from "@/lib/utils";

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

    // Optional rename gate. Off by default — bulk-edit defaults to a
    // metadata-only update so users don't accidentally rewrite every
    // filename in the selection. Flipping this on surfaces the dry-run
    // preview pane below; only files with a non-null proposed name get
    // a rename in the eventual commit.
    const [rename, setRename] = useState(false);

    // Commit state. `isSubmitting` gates the footer + reopens prevention;
    // `submitError` carries the message when the PATCH fails. Success
    // closes the sheet via `onClose`, so there's no success-feedback
    // state to manage.
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

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

    // ── Rename preview composition ───────────────────────────────────────────
    //
    // Mirrors the single-file `generate()` formula in App.tsx: each file's
    // canonical name is `<title> - <tag1> - ... - <suffix>.<ext>`, with
    // every part sanitized and brackets KEPT in the filename (they're only
    // stripped for the ID3 payload). Empty title means we don't propose a
    // rename for this file — leaving the row at "no change" in the
    // preview pane.

    /** Returns `null` when the file shouldn't be renamed (no per-file
     *  title entered). Returns `""` only if every part sanitized away to
     *  nothing; the preview renders that as a row-level error. */
    function composeProposedName(edit: PerFileEdit, ext: string): string | null {
        if (!edit.title.trim()) return null;
        const sfx = shared.suffix.trim() || "F4A";
        const tagList = edit.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
        const parts = [edit.title, ...tagList, sfx].map(sanitizeFilename).filter(Boolean);
        if (parts.length === 0) return "";
        return `${parts.join(" - ")}${ext}`;
    }

    interface PreviewRow {
        file: FileEntry;
        proposed: string | null;
        /** Set when the proposed name would exceed the 255-byte FS limit. */
        tooLong: boolean;
        /** Set when proposed equals current — UI flags as "no change". */
        unchanged: boolean;
    }

    /** Recompute when any input that feeds the canonical name changes.
     *  255 bytes is the Linux filesystem name cap (mirrored on the
     *  backend's two-phase validator via errno.ENAMETOOLONG). */
    const previewRows: PreviewRow[] = useMemo(() => {
        const encoder = new TextEncoder();
        return files.map((file) => {
            const edit = edits[file.path] ?? EMPTY_EDIT;
            const proposed = composeProposedName(edit, file.ext);
            const tooLong = proposed !== null && encoder.encode(proposed).length > 255;
            const unchanged = proposed !== null && proposed === file.name;
            return { file, proposed, tooLong, unchanged };
        });
        // composeProposedName closes over `edits` + `shared.suffix`; both
        // dependencies are baked in via the entries we map over so the
        // useMemo deps cover the visible inputs without a stale-closure
        // risk.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [files, edits, shared.suffix]);

    // ── Commit-readiness ────────────────────────────────────────────────────
    //
    // The footer button enables only when there's something to write.
    // Mirrors the backend's no-op detection so we don't fire a request
    // that would be a 200 with all `unchanged` rows.

    const hasPerFileEdit = Object.values(edits).some((e) => e.title || e.tags);
    const hasSharedEdit = Boolean(shared.artist || shared.album_artist || shared.album);
    const hasClear = clearFields.size > 0;
    const hasRename = rename && previewRows.some((r) => r.proposed && !r.unchanged && !r.tooLong);
    const canCommit = hasPerFileEdit || hasSharedEdit || hasClear || hasRename;
    const anyTooLong = rename && previewRows.some((r) => r.tooLong);

    async function handleSubmit() {
        if (!canCommit || isSubmitting || anyTooLong) return;
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            // Build the per-item payload. ID3 title gets brackets stripped
            // (the ID3-vs-filename rule); new_name keeps brackets via
            // composeProposedName already running on the raw edit.title.
            const items = files.map((file) => {
                const edit = edits[file.path] ?? EMPTY_EDIT;
                const proposed = rename ? composeProposedName(edit, file.ext) : null;
                return {
                    path: file.path,
                    title: edit.title ? stripOuterBrackets(edit.title) : "",
                    new_name: proposed ?? "",
                };
            });
            await bulkWrite({
                items,
                shared: {
                    artist: shared.artist,
                    album_artist: shared.album_artist,
                    album: shared.album,
                    clear: [...clearFields],
                },
                rename,
                root,
            });
            // Success — close the sheet. The FileBrowser will refresh on
            // its next render (phase 8 will plumb a refresh callback so
            // the new names appear without the user having to navigate
            // away and back).
            onClose();
        } catch (err) {
            setSubmitError(getErrorMessage(err));
        } finally {
            setIsSubmitting(false);
        }
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
                        <label
                            htmlFor="bulk-rename-toggle"
                            className="flex items-start gap-3 cursor-pointer"
                        >
                            <Checkbox
                                id="bulk-rename-toggle"
                                checked={rename}
                                onCheckedChange={(v) => setRename(v === true)}
                                className="mt-0.5"
                            />
                            <span className="flex flex-col gap-1 min-w-0">
                                <span className="text-sm text-foreground">
                                    Rename files to the canonical format
                                </span>
                                <span className="text-xs text-muted-foreground leading-relaxed">
                                    {`Each file gets renamed to `}
                                    <code className="font-mono text-foreground/80">
                                        {`<title> - <tag> - … - <suffix>.<ext>`}
                                    </code>
                                    . Brackets in the title are kept in the filename and stripped
                                    from the ID3 title — same rule as the single-file Generate flow.
                                    Rows with no per-file title stay as-is.
                                </span>
                            </span>
                        </label>

                        {rename && count > 0 && (
                            <div className="rounded-md border border-border overflow-hidden mt-1">
                                <div className="px-3 py-2 text-[10px] font-medium tracking-[0.08em] uppercase text-muted-foreground/80 bg-muted/30 border-b border-border">
                                    Preview (
                                    {previewRows.filter((r) => r.proposed && !r.unchanged).length}{" "}
                                    of {count} will rename)
                                </div>
                                <ul className="divide-y divide-border">
                                    {previewRows.map((row) => (
                                        <li
                                            key={row.file.path}
                                            className="flex items-center gap-3 px-3 py-2 font-mono text-xs"
                                        >
                                            <span className="flex-1 min-w-0 truncate text-muted-foreground">
                                                {row.file.name}
                                            </span>
                                            <span aria-hidden className="text-muted-foreground/60">
                                                →
                                            </span>
                                            <span className="flex-1 min-w-0 truncate">
                                                {row.tooLong ? (
                                                    <span className="inline-flex items-center gap-1 text-destructive">
                                                        <AlertCircle
                                                            size={12}
                                                            aria-hidden
                                                            className="shrink-0"
                                                        />
                                                        Name too long (max 255 bytes)
                                                    </span>
                                                ) : row.proposed === null || row.unchanged ? (
                                                    <span className="text-muted-foreground/70 italic">
                                                        no change
                                                    </span>
                                                ) : (
                                                    <span className="text-foreground">
                                                        {row.proposed}
                                                    </span>
                                                )}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </section>
                </div>

                {/* Footer — Cancel + the gated commit. Button is enabled only
                    when there's actual work to do (per-file edit, shared
                    value, clear toggle, or proposed rename). The commit
                    fires PATCH /api/files/bulk-write directly; the preview
                    pane above is the dry-run safety net. Validation errors
                    surface inline next to Cancel. */}
                <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-border shrink-0">
                    {submitError && (
                        <span
                            className="text-xs text-destructive flex-1 min-w-0 truncate"
                            aria-live="polite"
                            title={submitError}
                        >
                            {submitError}
                        </span>
                    )}
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button
                        variant="default"
                        size="sm"
                        onClick={handleSubmit}
                        disabled={!canCommit || isSubmitting || anyTooLong}
                        aria-label={
                            !canCommit
                                ? "No edits to apply yet"
                                : anyTooLong
                                  ? "One or more proposed names exceed the filesystem limit"
                                  : rename
                                    ? "Apply metadata and rename"
                                    : "Apply metadata"
                        }
                    >
                        {isSubmitting ? (
                            <Loader2 size={14} aria-hidden className="animate-spin" />
                        ) : null}
                        {isSubmitting ? "Applying…" : "Apply changes"}
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
