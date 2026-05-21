import {
    lazy,
    Suspense,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ChevronDown,
    ChevronRight,
    FilePen,
    Folder,
    FolderOpen,
    Loader2,
    PenLine,
    RefreshCw,
    Trash2,
} from "lucide-react";

import FileBrowserItem from "@/components/FileBrowserItem";
import RecoverableErrorBanner from "@/components/RecoverableErrorBanner";
import SelectedFilePanel from "@/components/SelectedFilePanel";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type DragRect, useDragSelect } from "@/hooks/useDragSelect";
import { API, apiGet, apiPost, buildQueryString, type FileRoot } from "@/lib/api";
import { FORMAT_EXT, NEEDS_CONVERSION_EXTS } from "@/lib/audioFormats";
import { selectAll, selectionFromClick } from "@/lib/explorerSelection";
import type {
    ConvertFormat,
    ConvertQuality,
    FileEntry,
    ListedDirResponse,
    ListedEntry,
    SearchMode,
} from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

// Lazy-loaded heavy Browse sheet. Mounts only on first Browse click.
const LibraryExplorerSheet = lazy(() => import("@/components/LibraryExplorerSheet"));

/** Longer than the Browse sheet's inline filter — this hits the network. */
const FILEBROWSER_SEARCH_DEBOUNCE_MS = 300;

interface FileBrowserProps {
    outputDash: string;
    outputPipe: string;
    extractedArtist: string;
    defaultOpen?: boolean;
    /** Post-Apply bridge: open + switch to Downloads + select + scroll. */
    bridgeRequest?: { path: string; filename: string } | null;
    onBridgeConsumed?: () => void;
    /** Controlled multi-selection. Lifted to App so the BulkEditSheet's
     *  X button can deselect a row here by trimming the array. */
    bulkSelected: FileEntry[];
    onBulkSelectedChange: (next: FileEntry[]) => void;
    onOpenBulkEdit?: (root: FileRoot) => void;
    /** Shared library subdir; navigating here updates the LibraryExplorer
     *  rail + the single-file Move picker + the BulkEditSheet move picker. */
    librarySubdir: string;
    onLibrarySubdirChange: (subdir: string) => void;
}

interface SearchResponse {
    files: FileEntry[];
}

/**
 * File library shell. Two tabs (Library = LIBRARY_PATH archive, Downloads =
 * DOWNLOAD_PATH staging) share one right-hand SelectedFilePanel for rename
 * / convert / move-to-library. Deferred-fetch until first expand.
 */
export default function FileBrowser({
    outputDash,
    outputPipe,
    extractedArtist,
    defaultOpen = false,
    bridgeRequest = null,
    onBridgeConsumed,
    bulkSelected,
    onBulkSelectedChange,
    onOpenBulkEdit,
    librarySubdir,
    onLibrarySubdirChange: setLibrarySubdir,
}: FileBrowserProps) {
    // Persist the last-opened root across reloads so a user who lives in
    // Downloads after a bridge doesn't get forced back to Library on every
    // refresh. Only "library" / "downloads" are valid; anything else falls
    // back to library.
    const [root, setRoot] = useState<FileRoot>(() => {
        try {
            const stored = localStorage.getItem("fileBrowser.root");
            return stored === "downloads" ? "downloads" : "library";
        } catch {
            return "library";
        }
    });
    const [files, setFiles] = useState<FileEntry[]>([]);
    // Library-tab subdir listing: holds the raw `/api/files` response so we
    // can render folder rows + a breadcrumb when the user is browsing a
    // folder tree. `null` whenever we're in flat search mode (Downloads, or
    // Library with an active query). Files derived from this list also flow
    // into the `files` state above so the existing selection / bulk-edit /
    // batch logic keeps working without branching every call site.
    const [subdirEntries, setSubdirEntries] = useState<ListedEntry[] | null>(null);
    const [query, setQuery] = useState("");
    const [searchMode, setSearchMode] = useState<SearchMode>("filename");
    const [selected, setSelected] = useState<FileEntry | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [open, setOpen] = useState(defaultOpen);
    // Drives the Downloads-tab badge; refreshed on open / tab switch / move.
    const [downloadsCount, setDownloadsCount] = useState<number | null>(null);
    const [explorerOpen, setExplorerOpen] = useState(false);

    // Conversion preferences, persist across sessions.
    const [convertFormat, setConvertFormat] = useState<ConvertFormat>(() => {
        const stored = localStorage.getItem("convertFormat") as ConvertFormat;
        return stored && stored in FORMAT_EXT ? stored : "mp3";
    });
    const [convertQuality, setConvertQuality] = useState<ConvertQuality>(
        () => (localStorage.getItem("convertQuality") as ConvertQuality) || "high",
    );
    const [deleteOriginal, setDeleteOriginal] = useState(false);

    // Multi-select state. `batchSelected` is a derived view of the
    // controlled `bulkSelected` prop (lifted to App.tsx). `batchMode` is
    // derived: any non-empty selection shows row checkboxes and the
    // SelectionActionBar. Explicit "Batch convert mode" toggle is gone;
    // conversion lives inside BulkEditSheet's Convert section now.
    const batchSelected = useMemo(() => new Set(bulkSelected.map((f) => f.path)), [bulkSelected]);
    const batchMode = bulkSelected.length > 0;
    // Anchor for Shift-click range selection. Tracks the row a future
    // Shift-click should extend FROM. Plain and toggle clicks move the
    // anchor onto themselves; the empty-area drag-clear path zeroes it
    // (no anchor → Shift falls through to a plain click). Works for
    // both tabs — the Library list gets the same OS-file-manager idioms
    // the Downloads list does.
    const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

    // Context-menu state. `menuTarget` is the file the user right-clicked
    // (resolved from the row's `data-entry-path`); the menu reads it to
    // know whether to render bulk-context items or single-context ones.
    // Mirrors the LibraryExplorerSheet pattern so right-click feels the
    // same in both surfaces.
    const [menuTarget, setMenuTarget] = useState<FileEntry | null>(null);
    // Inline-rename state. The targeted row swaps its filename label for
    // an Input; Enter commits via /api/rename-path, Escape aborts.
    const [renamePath, setRenamePath] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    // Delete-confirm state. A single file gets a one-row prompt; a bulk
    // delete shows the first few names + the count so the user can
    // sanity-check before committing.
    const [deleteCandidate, setDeleteCandidate] = useState<{
        files: FileEntry[];
        kind: "single" | "bulk";
    } | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);

    // Commit a new selection (Set<string>) by mapping the paths back to
    // FileEntry shapes the parent can hand to the BulkEditSheet. Looks
    // first in the current `files` list (fresh data after a search /
    // tab switch), falling back to the existing `bulkSelected` entries
    // so cross-tab selections survive the round trip. Anything that
    // can't be resolved either way drops out — matches the OS-file-
    // manager rule that a missing path isn't selectable.
    const commitSelection = useCallback(
        (nextPaths: Set<string>) => {
            const byPath = new Map<string, FileEntry>();
            for (const f of bulkSelected) byPath.set(f.path, f);
            for (const f of files) byPath.set(f.path, f);
            const nextFiles: FileEntry[] = [];
            for (const p of nextPaths) {
                const entry = byPath.get(p);
                if (entry) nextFiles.push(entry);
            }
            onBulkSelectedChange(nextFiles);
        },
        [bulkSelected, files, onBulkSelectedChange],
    );

    // Live mirror of `batchSelected` for useDragSelect's mousedown to
    // capture without leaning on a closure over render-time state. The
    // hook reads this ref at the start of each drag so concurrent
    // toggles between drags don't desync the base selection.
    const batchSelectedRef = useRef<Set<string>>(batchSelected);
    useEffect(() => {
        batchSelectedRef.current = batchSelected;
    }, [batchSelected]);
    // FileBrowser has no inline-rename surface, but the hook expects this
    // ref. A constant null means "never block dragging on a rename".
    const renamePathRef = useRef<string | null>(null);

    // Drag-select wrapper. Clears the single-select anchor whenever a
    // multi-select drag yields any rows; batch mode is derived from the
    // committed selection, so we only have to flip `selected` to null
    // explicitly.
    const setBatchSelectedFromDrag = useCallback(
        (next: Set<string>) => {
            if (next.size > 0) setSelected(null);
            commitSelection(next);
        },
        [commitSelection],
    );

    const {
        scrollContainerRef: listScrollRef,
        onMouseDown: handleListMouseDown,
        dragRect,
        cleanup: cleanupDragSelect,
    } = useDragSelect({
        selectedPathsRef: batchSelectedRef,
        renamePathRef,
        setSelectedPaths: setBatchSelectedFromDrag,
        setAnchorPath: setSelectionAnchor,
    });
    // Tear down any in-flight drag when the root flips — the underlying
    // rows swap out and the window listeners would race the re-render
    // otherwise.
    useEffect(() => {
        return () => cleanupDragSelect();
    }, [root, cleanupDragSelect]);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        localStorage.setItem("convertFormat", convertFormat);
    }, [convertFormat]);
    useEffect(() => {
        localStorage.setItem("convertQuality", convertQuality);
    }, [convertQuality]);
    useEffect(() => {
        try {
            localStorage.setItem("fileBrowser.root", root);
        } catch {
            // non-fatal
        }
    }, [root]);

    // ── Load files ────────────────────────────────────────────────────────

    /** True when the active list is a single-level folder listing instead of
     *  a recursive search. Library tab + empty query gives the user a real
     *  file browser; Downloads stays flat (it's transient ingest staging,
     *  and the post-Apply bridge expects every file at one zoom level). */
    function isSubdirListingMode(rt: FileRoot, q: string): boolean {
        return rt === "library" && !q.trim();
    }

    async function loadFiles(q: string, mode: SearchMode, rt: FileRoot) {
        setLoading(true);
        setError("");
        try {
            if (isSubdirListingMode(rt, q)) {
                // Single-level listing inside librarySubdir; renders folders
                // (drill-down) + files together. librarySubdir doubles as the
                // move-target cursor so navigating here aims the per-file +
                // bulk move pickers at the same place.
                const data = await apiGet<ListedDirResponse>(
                    API.files + buildQueryString({ root: rt, subdir: librarySubdir }),
                );
                setSubdirEntries(data.entries);
                setFiles(
                    data.entries
                        .filter((e) => e.type === "file")
                        .map((e) => ({
                            name: e.name,
                            ext: e.ext ?? "",
                            path: e.path,
                            folder: "",
                            needs_conversion: e.needs_conversion,
                        })),
                );
            } else {
                const data = await apiGet<SearchResponse>(
                    API.search +
                        buildQueryString({
                            q: q.trim(),
                            search_in: mode,
                            root: rt,
                        }),
                );
                setSubdirEntries(null);
                setFiles(data.files);
            }
        } catch (e) {
            const envName = rt === "library" ? "LIBRARY_PATH" : "DOWNLOAD_PATH";
            setError(
                `Couldn't reach the ${rt}. Check that ${envName} is set and points to a valid folder. ` +
                    getErrorMessage(e),
            );
            setFiles([]);
            setSubdirEntries(null);
        } finally {
            setLoading(false);
        }
    }

    // Background refresh of the Downloads count so the badge stays accurate
    // without forcing the user onto that tab. Fires on open, on root
    // change, and after any move (parent calls refreshDownloadsCount via
    // the SelectedFilePanel's onListReload callback).
    async function refreshDownloadsCount() {
        try {
            const data = await apiGet<SearchResponse>(
                API.search + buildQueryString({ root: "downloads" }),
            );
            setDownloadsCount(data.files.length);
        } catch {
            // Non-fatal — badge just won't appear. The main loadFiles call
            // surfaces any real error.
            setDownloadsCount(null);
        }
    }

    // Deferred initial fetch: walking either tree ties up a sync FastAPI
    // worker thread; don't do it until the user opens the panel.
    const loadedOnceRef = useRef(false);
    useEffect(() => {
        if (!open || loadedOnceRef.current) return;
        loadedOnceRef.current = true;
        loadFiles("", "filename", root);
        refreshDownloadsCount();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-on-open by design
    }, [open]);

    function handleQueryChange(val: string) {
        setQuery(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(
            () => loadFiles(val, searchMode, root),
            FILEBROWSER_SEARCH_DEBOUNCE_MS,
        );
    }

    function handleModeChange(mode: SearchMode) {
        setSearchMode(mode);
        loadFiles(query, mode, root);
    }

    // Reload when the shared library-subdir position changes (Browse sheet
    // navigates here, single-file Move flow lands on a folder, BulkEdit's
    // move section picks a target). Only matters in subdir-listing mode —
    // search mode is recursive across the whole root.
    useEffect(() => {
        if (!open || !loadedOnceRef.current) return;
        if (!isSubdirListingMode(root, query)) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetching kickoff
        loadFiles(query, searchMode, root);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- responds to subdir nav only
    }, [librarySubdir]);

    function navigateToSubdir(next: string) {
        // Selection is path-keyed and a folder change invalidates every
        // previously-selected path — mirror handleRootChange's cleanup.
        setSelected(null);
        commitSelection(new Set());
        setSelectionAnchor(null);
        setLibrarySubdir(next);
    }

    // Consume bridge requests from PatreonPanel: open the panel, switch
    // to Downloads, synthesise a FileEntry so SelectedFilePanel can
    // drive rename + move without waiting for the (just-completed)
    // search to include the file, scroll into view, then clear.
    //
    // NOTE(unseensnick): this is the canonical "event-from-parent"
    // pattern that React's `useEvent` was designed for, but useEvent
    // hasn't shipped stable. The rule (correctly) flags the multiple
    // synchronous setState calls as set-state-in-effect; the proper
    // fixes are useImperativeHandle (bigger refactor) or just calling
    // a method through a ref instead of round-tripping through a
    // prop. For now the prop-driven effect stays disabled. Re-evaluate
    // when useEvent stabilises.
    useEffect(() => {
        if (!bridgeRequest) return;
        const { path, filename } = bridgeRequest;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- see NOTE above
        setOpen(true);
        if (root !== "downloads") {
            setRoot("downloads");
            commitSelection(new Set());
            loadFiles(query, searchMode, "downloads");
        }
        const ext = filename.match(/(\.[^.]+)$/)?.[1]?.toLowerCase() ?? "";
        const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        setSelected({
            name: filename,
            ext,
            path,
            folder,
            needs_conversion: NEEDS_CONVERSION_EXTS.has(ext),
        });
        // Wait a tick so the panel has had a chance to expand before we
        // measure. requestAnimationFrame is enough; no need for setTimeout.
        requestAnimationFrame(() => {
            rootRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
        });
        onBridgeConsumed?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- responds only to bridge changes
    }, [bridgeRequest]);

    function handleRootChange(next: FileRoot) {
        if (next === root) return;
        setRoot(next);
        setSelected(null);
        // Selection follows the tab — paths from the other root aren't
        // selectable here anyway, and the BulkEditSheet only handles one
        // root at a time. Clearing on switch avoids a stale snapshot
        // bleeding into the next bulk-edit session.
        commitSelection(new Set());
        setSelectionAnchor(null);
        loadFiles(query, searchMode, next);
    }

    // "Select all convertible" — used to live in the standalone batch-
    // convert mode; now surfaces as a button in the SelectionActionBar
    // (and as a no-op when there's nothing convertible). Same as the
    // previous behaviour without the explicit batch-mode entry gate.
    function selectAllConvertible() {
        const paths = files
            .filter((f) => NEEDS_CONVERSION_EXTS.has(f.ext) || !!f.needs_conversion)
            .map((f) => f.path);
        commitSelection(new Set(paths));
    }

    // Live mirrors so the click handlers below stay reference-stable
    // (useCallback with empty deps). Without this, every parent re-render
    // would mint fresh handler identities, blowing the FileBrowserItem
    // memoization on every drag-mousemove. `batchMode` is derived from
    // `bulkSelected.length` and gets read off `batchSelectedRef` instead.
    const selectedRef = useRef<FileEntry | null>(selected);
    const selectionAnchorRef = useRef<string | null>(selectionAnchor);
    const filesRef = useRef<FileEntry[]>(files);
    useEffect(() => {
        selectedRef.current = selected;
    }, [selected]);
    useEffect(() => {
        selectionAnchorRef.current = selectionAnchor;
    }, [selectionAnchor]);
    useEffect(() => {
        filesRef.current = files;
    }, [files]);

    const toggleBatch = useCallback(
        (path: string) => {
            const next = new Set(batchSelectedRef.current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            commitSelection(next);
        },
        [commitSelection],
    );

    const handleListClick = useCallback(
        (file: FileEntry, modifiers: { shift: boolean; toggle: boolean }) => {
            const isMulti = modifiers.shift || modifiers.toggle;
            // batch mode is derived from `bulkSelected.length > 0`; the live
            // selection size is the source of truth here.
            const inBatchMode = batchSelectedRef.current.size > 0;
            const currentSelected = selectedRef.current;

            if (isMulti) {
                const seed =
                    !inBatchMode && currentSelected
                        ? new Set([currentSelected.path])
                        : batchSelectedRef.current;
                const anchor =
                    !inBatchMode && currentSelected
                        ? currentSelected.path
                        : (selectionAnchorRef.current ?? currentSelected?.path ?? null);
                const update = selectionFromClick(
                    filesRef.current,
                    seed,
                    anchor,
                    file.path,
                    modifiers,
                );
                if (!inBatchMode) setSelected(null);
                commitSelection(update.selected);
                setSelectionAnchor(update.anchor);
                return;
            }

            if (inBatchMode) {
                toggleBatch(file.path);
                setSelectionAnchor(file.path);
                return;
            }

            setSelected(currentSelected?.path === file.path ? null : file);
        },
        [commitSelection, toggleBatch],
    );

    // File-list keyboard shortcuts (both tabs): Ctrl/Cmd+A selects all
    // visible rows; Esc clears the selection. Bound once via ref-mirrored
    // state — listing batchSelected / selected / etc. in deps would re-bind
    // the document listener on every keystroke and drag-mousemove.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const tag = target?.tagName ?? "";
            if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
                if (e.key === "a" || e.key === "A") {
                    const currentFiles = filesRef.current;
                    if (currentFiles.length === 0) return;
                    const update = selectAll(currentFiles);
                    if (!update) return;
                    e.preventDefault();
                    if (batchSelectedRef.current.size === 0) setSelected(null);
                    commitSelection(update.selected);
                    setSelectionAnchor(update.anchor);
                    return;
                }
            }

            if (e.key === "Escape") {
                // Bail when any Radix dialog / sheet / alertdialog is open;
                // the overlay layer owns Esc and clearing FileBrowser's
                // selection would yank the open BulkEditSheet's files prop.
                if (
                    document.querySelector(
                        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
                    )
                )
                    return;
                if (batchSelectedRef.current.size === 0 && !selectedRef.current) return;
                e.preventDefault();
                if (batchSelectedRef.current.size > 0) commitSelection(new Set());
                if (selectionAnchorRef.current) setSelectionAnchor(null);
                if (selectedRef.current) setSelected(null);
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [commitSelection]);

    function clearBatchSelection() {
        commitSelection(new Set());
        setSelectionAnchor(null);
    }

    // ── Context menu + inline rename + delete ─────────────────────────────────

    /** Resolves the row the user right-clicked on by walking up from the
     *  event target to the closest `data-entry-path` element — same
     *  contract `useDragSelect` uses for hit-testing. Sets `menuTarget`
     *  so the ContextMenuContent can pick the right items to render. */
    const resolveMenuTarget = useCallback(
        (e: React.MouseEvent) => {
            const row = (e.target as HTMLElement | null)?.closest?.("[data-entry-path]");
            if (!row) {
                setMenuTarget(null);
                return;
            }
            const path = row.getAttribute("data-entry-path");
            setMenuTarget(files.find((f) => f.path === path) ?? null);
        },
        [files],
    );

    function startRename(file: FileEntry) {
        setRenamePath(file.path);
        setRenameValue(file.name);
    }

    function cancelRename() {
        setRenamePath(null);
        setRenameValue("");
    }

    async function commitRename() {
        if (!renamePath) return;
        const target = files.find((f) => f.path === renamePath);
        if (!target) {
            cancelRename();
            return;
        }
        const next = renameValue.trim();
        if (!next || next === target.name) {
            cancelRename();
            return;
        }
        try {
            await apiPost(API.renamePath, {
                path: target.path,
                new_name: next,
                root,
            });
            cancelRename();
            await loadFiles(query, searchMode, root);
            if (root === "downloads") refreshDownloadsCount();
        } catch (e) {
            setError("Rename failed. " + getErrorMessage(e));
            cancelRename();
        }
    }

    function requestDelete(file: FileEntry) {
        setDeleteCandidate({ files: [file], kind: "single" });
    }

    function requestDeleteBulk() {
        if (bulkSelected.length === 0) return;
        setDeleteCandidate({ files: bulkSelected, kind: "bulk" });
    }

    async function confirmDelete() {
        const candidate = deleteCandidate;
        if (!candidate) return;
        setDeleteBusy(true);
        const failures: string[] = [];
        for (const file of candidate.files) {
            try {
                await apiPost(API.delete, { path: file.path, root, recursive: false });
            } catch (e) {
                failures.push(`${file.name}: ${getErrorMessage(e)}`);
            }
        }
        setDeleteBusy(false);
        setDeleteCandidate(null);
        if (candidate.kind === "bulk") {
            // Drop the deleted paths from the controlled selection so the
            // BulkEditSheet + the FileBrowser stop highlighting them.
            const deletedPaths = new Set(candidate.files.map((f) => f.path));
            const remaining = bulkSelected.filter((f) => !deletedPaths.has(f.path));
            onBulkSelectedChange(remaining);
        }
        if (selected && candidate.files.some((f) => f.path === selected.path)) {
            setSelected(null);
        }
        await loadFiles(query, searchMode, root);
        if (root === "downloads") refreshDownloadsCount();
        if (failures.length > 0) {
            setError(`Couldn't delete ${failures.length} of ${candidate.files.length} files.`);
        }
    }

    // ── Render ────────────────────────────────────────────────────────────

    return (
        <>
            <Collapsible open={open} onOpenChange={setOpen}>
                <div
                    ref={rootRef}
                    className="bg-card border border-border rounded-xl p-6 sm:p-7 flex flex-col gap-5"
                >
                    <CollapsibleTrigger asChild>
                        <button
                            type="button"
                            className="group/trigger flex items-center gap-2.5 w-full text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        >
                            <ChevronDown
                                size={16}
                                aria-hidden
                                className="text-muted-foreground transition-transform motion-safe:duration-200 motion-safe:ease-out group-data-[state=closed]/trigger:-rotate-90"
                            />
                            <span className="text-sm font-medium tracking-wide text-muted-foreground">
                                File library
                            </span>
                            {!loading && files.length > 0 && (
                                <span className="font-mono text-xs tabular-nums text-muted-foreground/80">
                                    {files.length.toLocaleString()}
                                </span>
                            )}
                            {downloadsCount !== null && downloadsCount > 0 && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground/80">
                                            {downloadsCount} pending
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                        {downloadsCount} file
                                        {downloadsCount === 1 ? "" : "s"} waiting in Downloads
                                    </TooltipContent>
                                </Tooltip>
                            )}
                        </button>
                    </CollapsibleTrigger>

                    <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0">
                        <div className="flex flex-col gap-4">
                            {error && <ErrorBanner message={error} />}

                            <Tabs
                                value={root}
                                onValueChange={(v) => handleRootChange(v as FileRoot)}
                            >
                                <TabsList
                                    variant="line"
                                    className="h-auto p-0 gap-0 bg-transparent justify-start rounded-none border-b border-border w-full"
                                >
                                    <TabsTrigger
                                        value="library"
                                        className="px-4 py-2.5 text-xs font-medium tracking-[0.04em] whitespace-nowrap rounded-none"
                                    >
                                        Library
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="downloads"
                                        className="px-4 py-2.5 text-xs font-medium tracking-[0.04em] whitespace-nowrap rounded-none"
                                    >
                                        Downloads
                                        {downloadsCount !== null && downloadsCount > 0 && (
                                            <span className="ml-1.5 font-mono tabular-nums text-muted-foreground/80">
                                                · {downloadsCount}
                                            </span>
                                        )}
                                    </TabsTrigger>
                                </TabsList>
                            </Tabs>

                            <SearchRow
                                query={query}
                                onQueryChange={handleQueryChange}
                                searchMode={searchMode}
                                onSearchModeChange={handleModeChange}
                                loading={loading}
                                onRefresh={() => loadFiles(query, searchMode, root)}
                                onOpenExplorer={() => setExplorerOpen(true)}
                            />

                            {batchMode && (
                                <SelectionActionBar
                                    count={bulkSelected.length}
                                    onBulkEdit={
                                        onOpenBulkEdit ? () => onOpenBulkEdit(root) : undefined
                                    }
                                    onDelete={requestDeleteBulk}
                                    onSelectAllConvertible={selectAllConvertible}
                                    onClear={clearBatchSelection}
                                />
                            )}

                            <div className="grid grid-cols-1 lg:grid-cols-[3fr_4fr] gap-4 items-start">
                                {/* modal={false}: skips Radix's
                                    aria-hide-siblings + focus-trap step
                                    that's reserved for true modals.
                                    Without this, the menu's open state
                                    races against the rename input's
                                    focus and trips Chrome's "Blocked
                                    aria-hidden on a focused ancestor"
                                    warning. The menu still closes on
                                    outside click via Radix's
                                    DismissableLayer. */}
                                <ContextMenu modal={false}>
                                    <ContextMenuTrigger asChild>
                                        <div
                                            onContextMenu={resolveMenuTarget}
                                            className="flex flex-col gap-2"
                                        >
                                            {isSubdirListingMode(root, query) && (
                                                <FileBrowserBreadcrumb
                                                    subdir={librarySubdir}
                                                    onNavigate={navigateToSubdir}
                                                    onOpenExplorer={() => setExplorerOpen(true)}
                                                />
                                            )}
                                            <FileList
                                                files={files}
                                                folders={
                                                    subdirEntries
                                                        ? subdirEntries.filter(
                                                              (e) => e.type === "dir",
                                                          )
                                                        : undefined
                                                }
                                                onOpenFolder={navigateToSubdir}
                                                loading={loading}
                                                selected={selected}
                                                batchMode={batchMode}
                                                batchSelected={batchSelected}
                                                renamePath={renamePath}
                                                renameValue={renameValue}
                                                onRenameChange={setRenameValue}
                                                onRenameSubmit={commitRename}
                                                onRenameCancel={cancelRename}
                                                emptyText={
                                                    root === "library"
                                                        ? query
                                                            ? "No matching files."
                                                            : librarySubdir
                                                              ? "This folder is empty."
                                                              : "Library is empty. Fetch some posts and use Move to library to file them here."
                                                        : query
                                                          ? "No matching downloads."
                                                          : "No pending downloads."
                                                }
                                                onSelect={handleListClick}
                                                onBatchToggle={toggleBatch}
                                                scrollContainerRef={listScrollRef}
                                                onContainerMouseDown={handleListMouseDown}
                                                dragRect={dragRect}
                                            />
                                        </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent>
                                        {menuTarget &&
                                            (() => {
                                                // Right-click on a row inside an active
                                                // multi-selection acts on the whole
                                                // selection (matches Finder / Explorer);
                                                // otherwise it's a single-target menu.
                                                const isBulk =
                                                    bulkSelected.length > 1 &&
                                                    bulkSelected.some(
                                                        (f) => f.path === menuTarget.path,
                                                    );
                                                return (
                                                    <>
                                                        {isBulk && onOpenBulkEdit && (
                                                            <ContextMenuItem
                                                                onSelect={() => {
                                                                    onOpenBulkEdit(root);
                                                                }}
                                                            >
                                                                <FilePen aria-hidden />
                                                                Bulk edit {bulkSelected.length}{" "}
                                                                files
                                                            </ContextMenuItem>
                                                        )}
                                                        {!isBulk && (
                                                            <ContextMenuItem
                                                                onSelect={() => {
                                                                    const target = menuTarget;
                                                                    requestAnimationFrame(() =>
                                                                        startRename(target),
                                                                    );
                                                                }}
                                                            >
                                                                <PenLine aria-hidden />
                                                                Rename
                                                            </ContextMenuItem>
                                                        )}
                                                        {(isBulk || !isBulk) && (
                                                            <ContextMenuSeparator />
                                                        )}
                                                        <ContextMenuItem
                                                            variant="destructive"
                                                            onSelect={() => {
                                                                // rAF lets the menu close
                                                                // before the AlertDialog
                                                                // mounts — without it
                                                                // Radix's focus scopes
                                                                // fight and the dialog
                                                                // can't take focus.
                                                                const target = menuTarget;
                                                                if (isBulk) {
                                                                    requestAnimationFrame(() =>
                                                                        requestDeleteBulk(),
                                                                    );
                                                                } else {
                                                                    requestAnimationFrame(() =>
                                                                        requestDelete(target),
                                                                    );
                                                                }
                                                            }}
                                                        >
                                                            <Trash2 aria-hidden />
                                                            {isBulk
                                                                ? `Delete ${bulkSelected.length} files`
                                                                : "Delete file"}
                                                        </ContextMenuItem>
                                                    </>
                                                );
                                            })()}
                                    </ContextMenuContent>
                                </ContextMenu>
                                <WorkArea
                                    root={root}
                                    batchSelected={batchSelected}
                                    convertFormat={convertFormat}
                                    convertQuality={convertQuality}
                                    deleteOriginal={deleteOriginal}
                                    onConvertFormatChange={setConvertFormat}
                                    onConvertQualityChange={setConvertQuality}
                                    onDeleteOriginalChange={setDeleteOriginal}
                                    selected={selected}
                                    outputDash={outputDash}
                                    outputPipe={outputPipe}
                                    extractedArtist={extractedArtist}
                                    librarySubdir={librarySubdir}
                                    onLibrarySubdirChange={setLibrarySubdir}
                                    onDeselect={() => setSelected(null)}
                                    onSelectedChange={setSelected}
                                    onListReload={() => {
                                        loadFiles(query, searchMode, root);
                                        refreshDownloadsCount();
                                    }}
                                    onMovedToLibrary={() => {
                                        // User stays on whichever tab they
                                        // were on — when batching multiple
                                        // files out of Downloads, auto-
                                        // switching to Library every time
                                        // forced the user to re-switch back
                                        // for each file. onListReload (one
                                        // prop above) already refreshes the
                                        // current list + the Downloads
                                        // badge, so the moved file just
                                        // vanishes from where it was.
                                        setSelected(null);
                                    }}
                                    onError={setError}
                                />
                            </div>
                        </div>
                    </CollapsibleContent>
                </div>

                <Suspense fallback={null}>
                    {explorerOpen && (
                        <LibraryExplorerSheet
                            open={explorerOpen}
                            onOpenChange={setExplorerOpen}
                            librarySubdir={librarySubdir}
                            onLibrarySubdirChange={setLibrarySubdir}
                            onSelectFile={(file, pickedRoot) => {
                                // Drop the user onto the tab matching the root they
                                // picked from so the existing work-area flows take
                                // over. Mirrors the Patreon-bridge handoff.
                                if (root !== pickedRoot) {
                                    setRoot(pickedRoot);
                                    commitSelection(new Set());
                                    setSelectionAnchor(null);
                                    loadFiles(query, searchMode, pickedRoot);
                                }
                                setSelected(file);
                                rootRef.current?.scrollIntoView({
                                    behavior: "smooth",
                                    block: "start",
                                });
                            }}
                        />
                    )}
                </Suspense>
            </Collapsible>

            {/* Sibling to the Collapsible so the AlertDialog's portal isn't
            nested under the file-list's ContextMenu — keeps Radix's focus
            scopes from fighting when the menu closes and the dialog
            mounts in the same tick. */}
            <AlertDialog
                open={!!deleteCandidate}
                onOpenChange={(v) => {
                    if (!v && !deleteBusy) setDeleteCandidate(null);
                }}
            >
                {deleteCandidate && (
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                {deleteCandidate.kind === "single"
                                    ? "Delete file?"
                                    : `Delete ${deleteCandidate.files.length} files?`}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                {deleteCandidate.kind === "single" ? (
                                    <>
                                        Removes{" "}
                                        <span className="font-mono break-all">
                                            {deleteCandidate.files[0]?.name}
                                        </span>{" "}
                                        from {root === "library" ? "the library" : "downloads"}.
                                        This can't be undone.
                                    </>
                                ) : (
                                    <>
                                        {deleteCandidate.files.length} files will be removed from{" "}
                                        {root === "library" ? "the library" : "downloads"}. This
                                        can't be undone.
                                    </>
                                )}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {deleteCandidate.kind === "bulk" && deleteCandidate.files.length <= 6 && (
                            <ul className="text-xs font-mono text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
                                {deleteCandidate.files.map((f) => (
                                    <li key={f.path} className="break-all">
                                        {f.name}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {deleteCandidate.kind === "bulk" && deleteCandidate.files.length > 6 && (
                            <ul className="text-xs font-mono text-muted-foreground space-y-0.5">
                                {deleteCandidate.files.slice(0, 5).map((f) => (
                                    <li key={f.path} className="break-all">
                                        {f.name}
                                    </li>
                                ))}
                                <li className="italic">
                                    …and {deleteCandidate.files.length - 5} more.
                                </li>
                            </ul>
                        )}
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={(e) => {
                                    e.preventDefault();
                                    confirmDelete();
                                }}
                                disabled={deleteBusy}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                                {deleteBusy ? (
                                    <Loader2 size={14} aria-hidden className="animate-spin" />
                                ) : null}
                                {deleteBusy ? "Deleting…" : "Delete"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                )}
            </AlertDialog>
        </>
    );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-views, kept inline because they have no value outside this file.
// ─────────────────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
    return <RecoverableErrorBanner message={message} />;
}

interface SearchRowProps {
    query: string;
    onQueryChange: (v: string) => void;
    searchMode: SearchMode;
    onSearchModeChange: (m: SearchMode) => void;
    loading: boolean;
    onRefresh: () => void;
    /** Opens the LibraryExplorerSheet for folder-tree navigation. The
     *  sheet has its own root selector (Library / Downloads), so it
     *  doesn't take its cue from the active tab; the user picks where
     *  to browse from inside it. */
    onOpenExplorer: () => void;
}

function SearchRow({
    query,
    onQueryChange,
    searchMode,
    onSearchModeChange,
    loading,
    onRefresh,
    onOpenExplorer,
}: SearchRowProps) {
    return (
        <div className="flex flex-wrap gap-2 items-center">
            <Input
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="Search your library."
                aria-label="Search the file library"
                className="flex-1 min-w-0 font-mono text-sm"
            />

            <ToggleGroup
                type="single"
                value={searchMode}
                onValueChange={(v) => v && onSearchModeChange(v as SearchMode)}
                className="shrink-0 border border-border rounded-md overflow-hidden gap-0"
            >
                {(["filename", "folder", "both"] as SearchMode[]).map((mode) => (
                    <ToggleGroupItem
                        key={mode}
                        value={mode}
                        className="text-sm px-3 py-1.5 h-auto rounded-none! border-r border-border last:border-r-0 bg-background text-muted-foreground hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:border-accent capitalize"
                    >
                        {mode === "filename" ? "Filename" : mode}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onOpenExplorer}
                        className="shrink-0 gap-1.5"
                        aria-label="Browse library"
                    >
                        <FolderOpen size={14} aria-hidden />
                        <span className="hidden sm:inline">Browse</span>
                    </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                    Browse the library folder tree, create folders, delete entries
                </TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onRefresh}
                        disabled={loading}
                        className="shrink-0"
                        aria-label="Refresh the file list"
                    >
                        <RefreshCw
                            size={14}
                            aria-hidden
                            className={loading ? "animate-spin" : ""}
                        />
                    </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Refresh</TooltipContent>
            </Tooltip>
        </div>
    );
}

interface FileListProps {
    files: FileEntry[];
    /** Subdir-listing mode only: folder rows rendered above the file rows.
     *  Click a folder to drill into it. Undefined / empty when not in
     *  subdir-listing mode (Downloads tab, or any active search). */
    folders?: ListedEntry[];
    onOpenFolder?: (path: string) => void;
    loading: boolean;
    selected: FileEntry | null;
    batchMode: boolean;
    batchSelected: Set<string>;
    emptyText: string;
    onSelect: (file: FileEntry, modifiers: { shift: boolean; toggle: boolean }) => void;
    onBatchToggle: (path: string) => void;
    /** Shared with the useDragSelect hook upstream so the rubber-band's
     *  coordinate frame matches the same DOM that holds the rows. */
    scrollContainerRef: React.MutableRefObject<HTMLDivElement | null>;
    onContainerMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
    dragRect: DragRect | null;
    /** Inline-rename state, passed straight to the matching FileBrowserItem.
     *  Single shared input (only one row can be in rename mode at a time)
     *  so we can leave the dedupe / focus logic to the row component. */
    renamePath: string | null;
    renameValue: string;
    onRenameChange: (next: string) => void;
    onRenameSubmit: () => void;
    onRenameCancel: () => void;
}

function FileList({
    files,
    folders,
    onOpenFolder,
    loading,
    selected,
    batchMode,
    batchSelected,
    emptyText,
    onSelect,
    onBatchToggle,
    scrollContainerRef,
    onContainerMouseDown,
    dragRect,
    renamePath,
    renameValue,
    onRenameChange,
    onRenameSubmit,
    onRenameCancel,
}: FileListProps) {
    const hasFolders = (folders?.length ?? 0) > 0;
    return (
        // The list shell receives drag-select's mousedown directly so
        // the rubber-band's coordinate frame matches the scroll
        // container. The per-row interactive contract is fulfilled by
        // the children (`role="button"`); the shell itself is the
        // background canvas for the gesture, not a clickable target.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
            aria-label="File list"
            aria-busy={loading}
            ref={scrollContainerRef}
            onMouseDown={onContainerMouseDown}
            className="bg-muted/40 border border-border rounded-md overflow-y-auto max-h-[28rem] min-h-40 relative select-none"
        >
            {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                    <Loader2
                        size={14}
                        aria-hidden
                        className="animate-spin text-muted-foreground shrink-0"
                    />
                    Loading.
                </div>
            ) : files.length === 0 && !hasFolders ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground italic px-4 text-center leading-relaxed">
                    {emptyText}
                </div>
            ) : (
                <>
                    {hasFolders &&
                        folders!.map((dir) => (
                            <FolderRow
                                key={dir.path}
                                name={dir.name}
                                onOpen={() => onOpenFolder?.(dir.path)}
                            />
                        ))}
                    {files.map((file) => (
                        <FileBrowserItem
                            key={file.path}
                            file={file}
                            isSelected={selected?.path === file.path}
                            batchMode={batchMode}
                            isBatchSelected={batchSelected.has(file.path)}
                            renaming={renamePath === file.path}
                            renameValue={renamePath === file.path ? renameValue : ""}
                            onRenameChange={onRenameChange}
                            onRenameSubmit={onRenameSubmit}
                            onRenameCancel={onRenameCancel}
                            onClick={onSelect}
                            onBatchToggle={onBatchToggle}
                        />
                    ))}
                </>
            )}
            {/* Drag-select overlay. Rendered as a portal-like absolute
                element inside the scroll container so the rectangle sits
                visually on top of the rows. The hook itself owns the
                math; we just paint what it tells us. */}
            {dragRect && <DragSelectOverlay rect={dragRect} containerRef={scrollContainerRef} />}
        </div>
    );
}

/** Folder row inside the Library tab's subdir listing. Click to drill in;
 *  no selection behaviour (folders aren't bulk-edit targets). */
function FolderRow({ name, onOpen }: { name: string; onOpen: () => void }) {
    return (
        <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer border-b border-border last:border-b-0 transition-colors hover:bg-muted/60 w-full text-left"
        >
            <Folder size={18} aria-hidden className="text-muted-foreground shrink-0" />
            <span className="flex-1 font-medium text-foreground truncate">{name}</span>
            <ChevronRight size={14} aria-hidden className="text-muted-foreground/50 shrink-0" />
        </button>
    );
}

/** Breadcrumb shown above the file list when in Library + subdir-listing
 *  mode. Crumbs map to librarySubdir segments; clicking jumps to that
 *  ancestor. The trailing "Open in Browse" affordance opens
 *  LibraryExplorerSheet at the same path so the user can switch from
 *  inline navigation to the grid + cut/paste surface without losing
 *  position. */
function FileBrowserBreadcrumb({
    subdir,
    onNavigate,
    onOpenExplorer,
}: {
    subdir: string;
    onNavigate: (next: string) => void;
    onOpenExplorer: () => void;
}) {
    const parts = subdir ? subdir.split("/").filter(Boolean) : [];
    return (
        <div className="flex items-center gap-1 flex-wrap font-mono text-xs text-muted-foreground">
            <button
                type="button"
                onClick={() => onNavigate("")}
                className={
                    parts.length === 0
                        ? "px-1.5 py-0.5 rounded text-foreground"
                        : "px-1.5 py-0.5 rounded hover:bg-muted/60 hover:text-foreground transition-colors focus-ring"
                }
            >
                Library
            </button>
            {parts.map((part, idx) => {
                const isLast = idx === parts.length - 1;
                const path = parts.slice(0, idx + 1).join("/");
                return (
                    <span key={path} className="flex items-center gap-1">
                        <span className="text-muted-foreground/50">/</span>
                        {isLast ? (
                            <span className="px-1.5 py-0.5 text-foreground">{part}</span>
                        ) : (
                            <button
                                type="button"
                                onClick={() => onNavigate(path)}
                                className="px-1.5 py-0.5 rounded hover:bg-muted/60 hover:text-foreground transition-colors focus-ring"
                            >
                                {part}
                            </button>
                        )}
                    </span>
                );
            })}
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={onOpenExplorer}
                        aria-label="Open in Browse sheet at this path"
                        className="ml-auto p-1 rounded hover:bg-muted/60 hover:text-foreground transition-colors focus-ring"
                    >
                        <FolderOpen size={12} aria-hidden />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Open in Browse</TooltipContent>
            </Tooltip>
        </div>
    );
}

/** Translucent rectangle painted while a drag-rubber-band is in flight.
 *  Positioned in container-local content coordinates (so the overlay
 *  scrolls with the rows). Reads the container ref inside a layout
 *  effect — React 19's `react-hooks/refs` rule forbids reading
 *  `.current` during render, so we mirror the rect into state. */
function DragSelectOverlay({
    rect,
    containerRef,
}: {
    rect: DragRect;
    containerRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
    const [pos, setPos] = useState<{
        left: number;
        top: number;
        width: number;
        height: number;
    } | null>(null);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) {
            setPos(null);
            return;
        }
        const c = container.getBoundingClientRect();
        setPos({
            left: rect.left - c.left + container.scrollLeft,
            top: rect.top - c.top + container.scrollTop,
            width: rect.width,
            height: rect.height,
        });
    }, [rect, containerRef]);

    if (!pos) return null;
    return (
        <div
            aria-hidden
            className="absolute pointer-events-none bg-accent/15 border border-accent/40 rounded-sm"
            style={pos}
        />
    );
}

interface WorkAreaProps {
    root: FileRoot;
    batchSelected: Set<string>;
    convertFormat: ConvertFormat;
    convertQuality: ConvertQuality;
    deleteOriginal: boolean;
    onConvertFormatChange: (f: ConvertFormat) => void;
    onConvertQualityChange: (q: ConvertQuality) => void;
    onDeleteOriginalChange: (v: boolean) => void;
    selected: FileEntry | null;
    outputDash: string;
    outputPipe: string;
    extractedArtist: string;
    librarySubdir: string;
    onLibrarySubdirChange: (subdir: string) => void;
    onDeselect: () => void;
    onSelectedChange: (next: FileEntry) => void;
    onListReload: () => void;
    onMovedToLibrary: (toPath: string, name: string) => void;
    onError: (msg: string) => void;
}

function WorkArea(props: WorkAreaProps) {
    if (props.selected) {
        return (
            <SelectedFilePanel
                selected={props.selected}
                root={props.root}
                outputDash={props.outputDash}
                outputPipe={props.outputPipe}
                extractedArtist={props.extractedArtist}
                convertFormat={props.convertFormat}
                convertQuality={props.convertQuality}
                deleteOriginal={props.deleteOriginal}
                librarySubdir={props.librarySubdir}
                onLibrarySubdirChange={props.onLibrarySubdirChange}
                onConvertFormatChange={props.onConvertFormatChange}
                onConvertQualityChange={props.onConvertQualityChange}
                onDeleteOriginalChange={props.onDeleteOriginalChange}
                onDeselect={props.onDeselect}
                onSelectedChange={props.onSelectedChange}
                onListReload={props.onListReload}
                onMovedToLibrary={props.onMovedToLibrary}
                onError={props.onError}
            />
        );
    }
    if (props.batchSelected.size > 0) {
        // Multi-select state — actions live in the SelectionActionBar
        // above the file list. The right pane stays empty so the file
        // list keeps its full width while the user picks more rows.
        return null;
    }
    // Empty placeholder, lg+ only (on mobile, the empty right column would
    // be a useless wedge of space below the file list).
    return (
        <div className="hidden lg:flex items-center justify-center min-h-40 border-2 border-dashed border-border rounded-md text-sm text-muted-foreground italic px-4 py-6 text-center">
            {props.root === "downloads"
                ? "Pick a download to rename, convert, or move into the library."
                : "Select a file to rename or convert."}
        </div>
    );
}

/** SelectionActionBar — surfaces when 2+ files are selected. Carries the
 *  multi-file actions Bulk edit + Delete, plus Select-convertible (still
 *  useful even with batch-convert folded into Bulk edit, e.g. when the
 *  user wants the convertible subset of a search result) and Clear. */
function SelectionActionBar({
    count,
    onBulkEdit,
    onDelete,
    onSelectAllConvertible,
    onClear,
}: {
    count: number;
    onBulkEdit?: () => void;
    onDelete: () => void;
    onSelectAllConvertible: () => void;
    onClear: () => void;
}) {
    return (
        <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-md bg-accent/30 border border-accent/40 text-sm">
            <span className="font-medium text-foreground">
                {count} file{count === 1 ? "" : "s"} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onSelectAllConvertible}
                    className="text-xs"
                >
                    Select convertible
                </Button>
                {onBulkEdit && count >= 2 && (
                    <Button type="button" size="sm" variant="outline" onClick={onBulkEdit}>
                        <FilePen size={14} aria-hidden />
                        Bulk edit
                    </Button>
                )}
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onDelete}
                    className="gap-1.5"
                >
                    <Trash2 size={14} aria-hidden />
                    Delete
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onClear}
                    aria-label="Clear selection"
                    className="text-muted-foreground hover:text-foreground"
                >
                    Clear
                </Button>
            </div>
        </div>
    );
}
