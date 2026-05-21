import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Eraser, Loader2, RefreshCw, X } from "lucide-react";

import LibrarySubdirPicker from "@/components/LibrarySubdirPicker";
import SectionLabel from "@/components/SectionLabel";
import TagsField from "@/components/TagsField";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
    bulkWrite,
    BulkWriteValidationError,
    loadCachedMetadata,
    loadCurrentMetadata,
} from "@/lib/api";
import { parseTitleLine } from "@/lib/parser";
import type { AppDict, FileEntry, VocabEntry } from "@/lib/types";
import {
    getErrorMessage,
    normaliseAndDedupeTags,
    sanitizeFilename,
    stripOuterBrackets,
} from "@/lib/utils";

export type BulkEditRoot = "library" | "downloads";

/**
 * Per-file local edits. Both fields start empty; the backend treats an
 * empty title as 'leave existing alone' (skip-on-empty), and an empty
 * tags list means 'no tags in the new filename' when rename is on.
 * Load-from-cache fills these from `post-api.json` sidecars; the user
 * refines via the per-row TagsField (drag to reorder, click to edit,
 * right-click novel chips to promote into the dictionary).
 */
interface PerFileEdit {
    title: string;
    tags: string[];
}

const EMPTY_EDIT: PerFileEdit = { title: "", tags: [] };

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

/** Likely-suffix pattern (F4A, M4A, GN4A, MP3, etc.). Used by
 *  `splitPipeTitle` to drop a trailing all-caps short segment so a
 *  re-apply with the same `shared.suffix` doesn't double it. */
const SUFFIX_PATTERN = /^[A-Z0-9]{2,6}$/;

/** Undo the pipe-encoding the app writes to ID3 TIT2.
 *
 * Single-file Generate composes `<title> | <tag1> | <tag2> | <suffix>`
 * and writes the whole thing to TIT2. When the bulk-edit auto-load
 * reads it back, we want the inputs split: the Title field gets the
 * clean title, the Tags field gets the tag list, and the trailing
 * suffix segment drops (the shared Suffix input handles that lane).
 *
 * Non-pipe titles pass through verbatim — third-party tagged files
 * that don't follow the convention still load cleanly into the Title
 * input as plain text. */
function splitPipeTitle(raw: string): { title: string; tags: string[] } {
    if (!raw.includes(" | ")) return { title: raw, tags: [] };
    const parts = raw.split(" | ");
    const title = parts[0] ?? "";
    const rest = parts.slice(1);
    if (rest.length > 0) {
        const last = rest[rest.length - 1];
        if (last && SUFFIX_PATTERN.test(last)) {
            rest.pop();
        }
    }
    return { title, tags: rest };
}

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
    /**
     * Tag dictionary, passed through so the Load-from-cache step can
     * normalise sidecar tags through the same `parseTitleLine` +
     * `normaliseAndDedupeTags` pipeline the Patreon URL workflow uses.
     * Without this the bulk path would write raw sidecar tags that
     * bypass the user's alias / suppression rules.
     */
    dict: AppDict;
    /**
     * Drop a file from the working selection without closing the sheet.
     * Per-row X button on each entry; the parent (App.tsx) edits
     * `bulkEditFiles` so the row + its edits stay paired. Optional —
     * surfaces tabbed-off callers can skip the remove UI by omitting.
     */
    onRemoveFile?: (path: string) => void;
    /**
     * Dictionary promotions for novel tags surfaced via the per-row
     * TagsField's right-click menu. Routes through App.tsx's single
     * vocabulary mutation path so a promotion here updates every
     * surface (TagsEditor, LibrarySettingsSheet) that reads from the
     * dictionary.
     */
    onPromoteToCanonical: (text: string) => Promise<void>;
    onPromoteToAlias: (text: string, canonical: VocabEntry) => Promise<void>;
    /** App-wide library-subdir position (shared with the FileBrowser's
     *  LibraryExplorerSheet rail + the single-file MoveToLibrarySection
     *  picker). Doubles as the Move section's destination — when the
     *  Move toggle is on, this is what flows into the bulk-write's
     *  `to_subdir`. */
    librarySubdir: string;
    onLibrarySubdirChange: (subdir: string) => void;
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

export default function BulkEditSheet({
    open,
    onClose,
    files,
    root,
    dict,
    onRemoveFile,
    onPromoteToCanonical,
    onPromoteToAlias,
    librarySubdir,
    onLibrarySubdirChange,
}: BulkEditSheetProps) {
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

    // Move-to-library checkbox. The destination subdir itself is the
    // app-wide `librarySubdir` (controlled by App.tsx and shared with
    // the LibraryExplorerSheet + single-file MoveToLibrarySection) —
    // navigating one updates the others. An empty subdir with the
    // checkbox on is treated as "no move" so the user can toggle
    // without typing.
    const [moveEnabled, setMoveEnabled] = useState(false);
    const moveAvailable = root === "downloads";

    // Persistent link between Artist and Album artist (the common case —
    // anything that isn't a compilation). When on, the album_artist
    // input mirrors `shared.artist` live and is disabled; the commit
    // step writes shared.artist into both fields. Mirrors the existing
    // RenameSection's `linkArtists` pattern. Defaults ON because the
    // single-artist case is the overwhelming majority for the ASMR
    // workflows that drive this surface — the toggle is right there to
    // unlink for the rare compilation / collab.
    const [linkArtists, setLinkArtists] = useState(true);

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
            // Run each sidecar through the same pipeline the Patreon URL
            // applyPost flow uses in PatreonPanel: parseTitleLine splits
            // any [bracketed] / (parenthesised) tags out of the raw title
            // into `embeddedTags`, and normaliseAndDedupeTags resolves
            // aliases against the dictionary + drops suppressed terms +
            // dedupes. Without this the bulk path would write raw
            // sidecar values that bypass the user's vocabulary, leaving
            // tag chips that don't match canonical forms.
            const nextEdits: Record<string, PerFileEdit> = { ...edits };
            const artistsSeen = new Set<string>();
            let loaded = 0;
            for (const item of response.items) {
                const hasData = item.title || item.artist || (item.tags && item.tags.length > 0);
                if (!hasData) continue;
                loaded += 1;
                const { title: cleanTitle, embeddedTags } = parseTitleLine(item.title ?? "");
                const allTags = [...embeddedTags, ...(item.tags ?? [])];
                const normalised = normaliseAndDedupeTags(allTags, dict);
                nextEdits[item.path] = {
                    title: cleanTitle || item.title || "",
                    tags: normalised,
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

    /** Apply a Set<string> of seen values across the selection to one
     *  shared field: 0 distinct = leave alone, 1 = populate (and drop
     *  any mixed flag), 2+ = blank the input + flag as `<Mixed values>`. */
    const applySharedFromSeen = useCallback((field: SharedIdField, seen: Set<string>) => {
        if (seen.size === 1) {
            const only = [...seen][0] ?? "";
            setShared((prev) => ({ ...prev, [field]: only }));
            setMixedFields((prev) => {
                const next = new Set(prev);
                next.delete(field);
                return next;
            });
        } else if (seen.size > 1) {
            setShared((prev) => ({ ...prev, [field]: "" }));
            setMixedFields((prev) => {
                const next = new Set(prev);
                next.add(field);
                return next;
            });
        }
    }, []);

    /**
     * Read each file's on-disk ID3 / FLAC / MP4 tags and populate the
     * sheet from them. TIT2 gets pipe-split via `splitPipeTitle` so a
     * previously-tagged file's `<title> | tag1 | tag2 | F4A` lands as
     * a clean Title input + Tags chips. Shared fields (artist / album /
     * album_artist) collapse to a single value when all selected files
     * agree, otherwise surface as `<Mixed values>`.
     *
     * Overwrites any per-file edits in flight on purpose — the user
     * explicitly asked for "what's on disk right now", and the alternative
     * (merge) would silently keep stale values. Hit Clear first to wipe,
     * then Load to refresh.
     */
    const handleLoadCurrentMetadata = useCallback(async () => {
        if (files.length === 0 || isLoading) return;
        setIsLoading(true);
        setLoadFeedback({ kind: "none" });
        try {
            const response = await loadCurrentMetadata(
                files.map((f) => f.path),
                root,
            );
            const nextEdits: Record<string, PerFileEdit> = { ...edits };
            const artistsSeen = new Set<string>();
            const albumsSeen = new Set<string>();
            const albumArtistsSeen = new Set<string>();
            let loaded = 0;
            for (const item of response.items) {
                const hasData = item.title || item.artist || item.album || item.album_artist;
                if (!hasData) continue;
                loaded += 1;
                const { title, tags } = splitPipeTitle(item.title);
                nextEdits[item.path] = { title, tags };
                if (item.artist) artistsSeen.add(item.artist);
                if (item.album) albumsSeen.add(item.album);
                if (item.album_artist) albumArtistsSeen.add(item.album_artist);
            }
            setEdits(nextEdits);
            applySharedFromSeen("artist", artistsSeen);
            applySharedFromSeen("album", albumsSeen);
            applySharedFromSeen("album_artist", albumArtistsSeen);
            setLoadFeedback(
                loaded === 0 ? { kind: "empty" } : { kind: "success", loaded, total: files.length },
            );
        } catch (err) {
            setLoadFeedback({ kind: "error", message: getErrorMessage(err) });
        } finally {
            setIsLoading(false);
        }
        // edits is intentionally read-without-deps — including it would
        // refire the callback on every keystroke. We're using its
        // current value at click time, not subscribing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [files, root, isLoading, applySharedFromSeen]);

    // Stable identity for the current selection (path-set). Drives the
    // auto-load ref so we know when the set has changed.
    const filesKey = useMemo(
        () =>
            files
                .map((f) => f.path)
                .sort()
                .join("|"),
        [files],
    );
    const autoLoadedForFilesRef = useRef<string>("");

    /** Wipe every input back to its initial state. Use case: user
     *  auto-loaded current metadata but wants to start from scratch
     *  (third-party tagged file, want to retag with their own scheme).
     *  Doesn't touch librarySubdir — that's app-wide navigation
     *  state, not bulk-edit input. */
    function handleClearAll() {
        setEdits({});
        setShared(EMPTY_SHARED);
        setClearFields(new Set());
        setMixedFields(new Set());
        setLinkArtists(true);
        setRename(false);
        setMoveEnabled(false);
        setLoadFeedback({ kind: "none" });
        setSubmitError(null);
        // Mark this file set as handled so the auto-load effect doesn't
        // immediately undo what the user just cleared.
        autoLoadedForFilesRef.current = filesKey;
    }

    // Auto-load current metadata when the sheet opens (or when the
    // selection changes while it's open), but only if the inputs are
    // empty — in-flight edits stay put. Reads `edits` / `shared` /
    // `clearFields` / `mixedFields` once at trigger time to decide
    // whether to auto-load; we don't want every keystroke to re-fire,
    // so the rule's check fights what we want here.
    //
    // The sync setLoading / setEdits inside the data-fetching call is
    // the standard React-docs pattern flagged by set-state-in-effect.
    useEffect(() => {
        if (!open) {
            autoLoadedForFilesRef.current = "";
            return;
        }
        if (autoLoadedForFilesRef.current === filesKey) return;
        const hasState =
            Object.keys(edits).length > 0 ||
            Boolean(shared.artist || shared.album || shared.album_artist) ||
            clearFields.size > 0 ||
            mixedFields.size > 0;
        autoLoadedForFilesRef.current = filesKey;
        if (hasState || files.length === 0) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetching kickoff
        handleLoadCurrentMetadata();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
    }, [open, filesKey, handleLoadCurrentMetadata]);

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
        const parts = [edit.title, ...edit.tags, sfx].map(sanitizeFilename).filter(Boolean);
        if (parts.length === 0) return "";
        return `${parts.join(" - ")}${ext}`;
    }

    /** Pipe-delimited ID3 title that mirrors the single-file flow's
     *  outputPipe in App.tsx. Brackets get stripped from the title,
     *  then tags + suffix join via " | " — the convention the rest of
     *  the app uses to fold per-file tags into TIT2 (there's no
     *  dedicated tags frame; the pipe-string IS the tag storage).
     *  Returns "" when the user hasn't set a title so `_write_metadata`
     *  takes its skip-on-empty path and leaves the existing title
     *  alone. */
    function composeMetadataTitle(edit: PerFileEdit): string {
        if (!edit.title.trim()) return "";
        const sfx = shared.suffix.trim() || "F4A";
        const pipeTitle = stripOuterBrackets(edit.title);
        return [pipeTitle, ...edit.tags, sfx].join(" | ");
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

    const hasPerFileEdit = Object.values(edits).some((e) => e.title || e.tags.length > 0);
    // When linkArtists is on, the album_artist contribution to the commit
    // is `shared.artist`, not the (potentially stale) `shared.album_artist`
    // sitting in state from before the link was toggled. Match the
    // displayed value so canCommit reflects what the user actually sees.
    const effectiveAlbumArtist = linkArtists ? shared.artist : shared.album_artist;
    const hasSharedEdit = Boolean(shared.artist || effectiveAlbumArtist || shared.album);
    const hasClear = clearFields.size > 0;
    const hasRename = rename && previewRows.some((r) => r.proposed && !r.unchanged && !r.tooLong);
    // Move is only meaningful when source is Downloads (library-to-library
    // stays on /api/move). Empty string with the checkbox on = no-op, so
    // the user can toggle freely without typing.
    const effectiveMoveSubdir = moveEnabled && moveAvailable ? librarySubdir.trim() : "";
    const hasMove = effectiveMoveSubdir !== "";
    const canCommit = hasPerFileEdit || hasSharedEdit || hasClear || hasRename || hasMove;
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
                    title: composeMetadataTitle(edit),
                    new_name: proposed ?? "",
                };
            });
            // linkArtists collapses album_artist onto artist at commit
            // time + drops any pending Clear on album_artist (a link
            // overrides a clear — the user clearly wants album_artist
            // to track artist, not be blanked).
            const effectiveClear = new Set(clearFields);
            if (linkArtists) effectiveClear.delete("album_artist");
            await bulkWrite({
                items,
                shared: {
                    artist: shared.artist,
                    album_artist: linkArtists ? shared.artist : shared.album_artist,
                    album: shared.album,
                    clear: [...effectiveClear],
                },
                rename,
                root,
                to_subdir: effectiveMoveSubdir,
            });
            // Success — close the sheet. The FileBrowser will refresh on
            // its next render (phase 8 will plumb a refresh callback so
            // the new names appear without the user having to navigate
            // away and back).
            // Wipe the edit state before closing so reopening this
            // selection starts fresh — the submitted values are now on
            // disk, so showing them again as pending inputs would just
            // confuse the user into re-applying a no-op.
            setEdits({});
            setShared(EMPTY_SHARED);
            setClearFields(new Set());
            setMixedFields(new Set());
            setLinkArtists(true); // matches the default — see useState init
            setRename(false);
            setMoveEnabled(false);
            // librarySubdir is app-wide navigation state — leave it
            // where the user landed it so a follow-up Browse / Move
            // opens at the same spot they just filed files into.
            setLoadFeedback({ kind: "none" });
            onClose();
        } catch (err) {
            if (err instanceof BulkWriteValidationError) {
                // Surface the first real per-item failure (skipping the
                // 'Aborted — other items failed validation' markers the
                // backend adds for the would-have-been-fine items) so the
                // user sees the actual cause, not a downstream symptom.
                const real = err.results.find((r) => !r.ok && !r.error?.startsWith("Aborted"));
                if (real) {
                    setSubmitError(`${real.path}: ${real.error}`);
                } else {
                    setSubmitError(err.message);
                }
            } else {
                setSubmitError(getErrorMessage(err));
            }
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
                onEscapeKeyDown={(e) => {
                    // Esc inside a text input belongs to the input — blur
                    // it (so the user can hit Esc again to escalate to
                    // the Sheet-level cascade) and otherwise leave the
                    // sheet alone. Without this guard the cascade would
                    // steal Esc from anyone typing in Title / Tags /
                    // shared / suffix and feel jumpy: one Esc could wipe
                    // a "Loaded N of N" banner the user wanted to read.
                    const active = document.activeElement as HTMLElement | null;
                    if (
                        active &&
                        (active.tagName === "INPUT" ||
                            active.tagName === "TEXTAREA" ||
                            active.isContentEditable)
                    ) {
                        e.preventDefault();
                        active.blur();
                        return;
                    }
                    // Cascading Esc, same pattern as LibraryExplorerSheet:
                    // peel off one layer of transient state at a time
                    // before letting Escape close the Sheet. Sequence is
                    // ordered by destruction blast radius — feedback /
                    // error banners go first (no work lost), then a full
                    // Clear of in-flight edits (Clear-all semantics),
                    // then the default close path.
                    if (submitError) {
                        e.preventDefault();
                        setSubmitError(null);
                        return;
                    }
                    if (loadFeedback.kind !== "none") {
                        e.preventDefault();
                        setLoadFeedback({ kind: "none" });
                        return;
                    }
                    const hasState =
                        Object.keys(edits).length > 0 ||
                        Boolean(shared.artist || shared.album || shared.album_artist) ||
                        clearFields.size > 0 ||
                        mixedFields.size > 0 ||
                        rename ||
                        moveEnabled;
                    if (hasState) {
                        e.preventDefault();
                        handleClearAll();
                        return;
                    }
                    // Nothing transient to dismiss — let the Sheet close.
                }}
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
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleLoadCurrentMetadata}
                                        disabled={isLoading}
                                        title="Re-read the ID3 / FLAC / MP4 tags currently on disk"
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
                                        Load from file
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleLoadFromCache}
                                        disabled={isLoading}
                                        title="Pull title + tags from the matching Patreon post-api.json sidecar"
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
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleClearAll}
                                        disabled={isLoading}
                                        title="Wipe every input back to a clean slate"
                                    >
                                        <Eraser size={14} aria-hidden />
                                        Clear
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
                                {/* Stacked per-file blocks. The original 3-column
                                    table cratered the moment real Patreon ASMR
                                    filenames hit it — long `[EXCLUSIVE] [27_23] …`
                                    names ate the row, leaving the Title and Tags
                                    inputs at ~30px wide. Stacking the filename
                                    header above full-width inputs gives every
                                    field room without horizontal scroll. */}
                                <TooltipProvider delayDuration={500}>
                                    <div className="flex flex-col gap-3">
                                        {files.map((file, idx) => {
                                            const edit = editFor(file.path);
                                            const titleId = `bulk-title-${idx}`;
                                            return (
                                                <div
                                                    key={file.path}
                                                    className={
                                                        idx > 0
                                                            ? "flex flex-col gap-2 pt-3 border-t border-border/50"
                                                            : "flex flex-col gap-2"
                                                    }
                                                >
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="flex-1 min-w-0 block font-mono text-xs text-foreground truncate">
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
                                                        {onRemoveFile && (
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    onRemoveFile(file.path)
                                                                }
                                                                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-1 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                                                aria-label={`Remove ${file.name} from this batch`}
                                                                title="Remove from this batch"
                                                            >
                                                                <X size={14} aria-hidden />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <label
                                                            htmlFor={titleId}
                                                            className="w-12 shrink-0 text-xs text-muted-foreground"
                                                        >
                                                            Title
                                                        </label>
                                                        <Input
                                                            id={titleId}
                                                            value={edit.title}
                                                            onChange={(ev) =>
                                                                patchEdit(file.path, {
                                                                    title: ev.target.value,
                                                                })
                                                            }
                                                            placeholder="Keep existing"
                                                            className="flex-1 font-mono text-sm"
                                                        />
                                                    </div>
                                                    <div className="flex items-start gap-2">
                                                        <span className="w-12 shrink-0 text-xs text-muted-foreground pt-2">
                                                            Tags
                                                        </span>
                                                        <div className="flex-1 min-w-0">
                                                            <TagsField
                                                                tags={edit.tags}
                                                                onTagsChange={(next) =>
                                                                    patchEdit(file.path, {
                                                                        tags: next,
                                                                    })
                                                                }
                                                                dict={dict}
                                                                onPromoteToCanonical={
                                                                    onPromoteToCanonical
                                                                }
                                                                onPromoteToAlias={onPromoteToAlias}
                                                                placeholder="Add a tag"
                                                                ariaLabel={`Add a tag for ${file.name}`}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
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
                                // Album artist mirrors Artist when linkArtists
                                // is on — disabled input that displays the
                                // live shared.artist; commit step writes
                                // shared.artist into both fields. Matches
                                // RenameSection's existing link pattern.
                                const isLinked = field === "album_artist" && linkArtists;
                                const isCleared = clearFields.has(field) && !isLinked;
                                const inputId = `bulk-shared-${field}`;
                                const displayValue = isLinked ? shared.artist : shared[field];
                                return (
                                    <div key={field} className="flex flex-col gap-1.5">
                                        <div className="flex items-center gap-2">
                                            <label
                                                htmlFor={inputId}
                                                className="w-28 shrink-0 text-sm text-muted-foreground"
                                            >
                                                {SHARED_FIELD_LABELS[field]}
                                            </label>
                                            <Input
                                                id={inputId}
                                                value={displayValue}
                                                onChange={(e) => patchShared(field, e.target.value)}
                                                disabled={isCleared || isLinked}
                                                placeholder={placeholderForShared(field)}
                                                className="flex-1 font-mono text-sm"
                                            />
                                            <Button
                                                type="button"
                                                variant={isCleared ? "secondary" : "ghost"}
                                                size="sm"
                                                onClick={() => toggleClear(field)}
                                                disabled={isLinked}
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
                                        {field === "album_artist" && (
                                            <label
                                                htmlFor="bulk-link-artists"
                                                className="flex items-center gap-2 cursor-pointer select-none w-fit pl-[7.5rem]"
                                            >
                                                <Checkbox
                                                    id="bulk-link-artists"
                                                    checked={linkArtists}
                                                    onCheckedChange={(v) =>
                                                        setLinkArtists(v === true)
                                                    }
                                                />
                                                <span className="text-sm text-muted-foreground">
                                                    Same as artist
                                                </span>
                                            </label>
                                        )}
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

                    {moveAvailable && (
                        <section aria-label="Move to library" className="flex flex-col gap-3">
                            <SectionLabel>Move to library</SectionLabel>
                            <label
                                htmlFor="bulk-move-toggle"
                                className="flex items-start gap-3 cursor-pointer"
                            >
                                <Checkbox
                                    id="bulk-move-toggle"
                                    checked={moveEnabled}
                                    onCheckedChange={(v) => setMoveEnabled(v === true)}
                                    className="mt-0.5"
                                />
                                <span className="flex flex-col gap-1 min-w-0">
                                    <span className="text-sm text-foreground">
                                        Move into a library subfolder
                                    </span>
                                    <span className="text-xs text-muted-foreground leading-relaxed">
                                        Each file moves into
                                        <code className="font-mono text-foreground/80 mx-1">
                                            LIBRARY_PATH/&lt;subfolder&gt;/
                                        </code>
                                        after metadata + rename apply. Browse to the destination
                                        below — or create a new folder there with the same
                                        affordance the single-file Move flow uses.
                                    </span>
                                </span>
                            </label>
                            {moveEnabled && (
                                <div className="flex flex-col gap-2">
                                    <LibrarySubdirPicker
                                        subdir={librarySubdir}
                                        onSubdirChange={onLibrarySubdirChange}
                                        onError={(msg) =>
                                            // Reuse the existing submit-error
                                            // surface in the footer so picker
                                            // failures don't need a parallel
                                            // banner. Empty string clears.
                                            setSubmitError(msg || null)
                                        }
                                    />
                                    <span className="text-xs text-muted-foreground">
                                        Moving to:{" "}
                                        <span className="font-mono text-foreground break-all">
                                            {librarySubdir
                                                ? `Library / ${librarySubdir}`
                                                : "Library"}
                                        </span>
                                    </span>
                                </div>
                            )}
                        </section>
                    )}

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
                                {/* Stacked rows. Side-by-side current → proposed
                                    truncated both names down to ~30 chars on a
                                    sheet of this width with real-world Patreon
                                    ASMR filenames in the mix. Stacking gives
                                    each name its own line so the user can
                                    read what they're about to commit. */}
                                <ul className="divide-y divide-border">
                                    {previewRows.map((row) => (
                                        <li
                                            key={row.file.path}
                                            className="flex flex-col gap-1 px-3 py-2 font-mono text-xs"
                                        >
                                            <span className="text-muted-foreground break-all">
                                                {row.file.name}
                                            </span>
                                            <span className="flex items-start gap-1.5 break-all">
                                                <span
                                                    aria-hidden
                                                    className="text-muted-foreground/60 shrink-0"
                                                >
                                                    →
                                                </span>
                                                {row.tooLong ? (
                                                    <span className="inline-flex items-start gap-1 text-destructive">
                                                        <AlertCircle
                                                            size={12}
                                                            aria-hidden
                                                            className="shrink-0 mt-0.5"
                                                        />
                                                        <span>Name too long (max 255 bytes)</span>
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
