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
    AlertTriangle,
    ChevronDown,
    FilePen,
    FolderOpen,
    ListChecks,
    Loader2,
    RefreshCw,
    Repeat,
} from "lucide-react";

import ConversionPanel from "@/components/ConversionPanel";
import FileBrowserItem from "@/components/FileBrowserItem";
import SelectedFilePanel from "@/components/SelectedFilePanel";

// LibraryExplorerSheet is the 2100-line Browse Sheet (drag-select grid +
// keyboard nav + Cut/Paste + rename + delete). Only renders when the user
// clicks Browse. React.lazy keeps it out of the initial chunk; the
// fallback is null because the Sheet's own open animation covers load.
const LibraryExplorerSheet = lazy(() => import("@/components/LibraryExplorerSheet"));
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type DragRect, useDragSelect } from "@/hooks/useDragSelect";
import { API, apiGet, apiPost, buildQueryString, type FileRoot } from "@/lib/api";
import { FORMAT_EXT, NEEDS_CONVERSION_EXTS } from "@/lib/audioFormats";
import { selectAll, selectionFromClick } from "@/lib/explorerSelection";
import type { ConvertFormat, ConvertQuality, FileEntry, SearchMode } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

/** Debounce window for the tab's search input. Longer than the Library
 *  Sheet's inline filter because this hits the network. */
const FILEBROWSER_SEARCH_DEBOUNCE_MS = 300;

interface FileBrowserProps {
    outputDash: string;
    outputPipe: string;
    extractedArtist: string;
    defaultOpen?: boolean;
    /** Patreon panel's post-Apply bridge: open + switch to Downloads + select
     *  the named file + scroll into view. Parent clears via onBridgeConsumed. */
    bridgeRequest?: { path: string; filename: string } | null;
    onBridgeConsumed?: () => void;
    /** Controlled multi-selection shared with the BulkEditSheet. The
     *  FileBrowser derives its `batchSelected` set from this list for
     *  rendering; gestures (shift / Ctrl / Ctrl+A / drag) compute the
     *  new selection and call `onBulkSelectedChange` with the matching
     *  FileEntry[]. Lifted out of internal state so the X button in the
     *  BulkEditSheet can remove a file and have the FileBrowser
     *  immediately reflect it. */
    bulkSelected: FileEntry[];
    onBulkSelectedChange: (next: FileEntry[]) => void;
    /** Open the BulkEditSheet with the current bulkSelected snapshot.
     *  The parent already has the files (from `bulkSelected`), so this
     *  only carries the source root. */
    onOpenBulkEdit?: (root: FileRoot) => void;
    /** App-wide library-subdir position. Shared with the LibraryExplorer
     *  Sheet (rail navigation) + the single-file MoveToLibrarySection
     *  + the BulkEditSheet's Move picker, so navigating one updates all
     *  three. Lifted from internal state so the bulk move surface lands
     *  at the same spot the rest of the app is already pointing at. */
    librarySubdir: string;
    onLibrarySubdirChange: (subdir: string) => void;
}

interface SearchResponse {
    files: FileEntry[];
}

interface ConvertResponse {
    path: string;
    new_name: string;
}

interface BatchProgress {
    current: number;
    total: number;
    currentFile: string;
    results: Array<{ name: string; ok: boolean; error?: string }>;
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

    // Batch state. `batchSelected` is now a DERIVED view of the
    // controlled `bulkSelected` prop — the canonical multi-selection
    // lives in App.tsx so the BulkEditSheet's X button can deselect a
    // file here just by trimming the array (no separate notification).
    const [batchMode, setBatchMode] = useState(false);
    const batchSelected = useMemo(() => new Set(bulkSelected.map((f) => f.path)), [bulkSelected]);
    const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
    // Anchor for Shift-click range selection. Tracks the row a future
    // Shift-click should extend FROM. Plain and toggle clicks move the
    // anchor onto themselves; the empty-area drag-clear path zeroes it
    // (no anchor → Shift falls through to a plain click). Works for
    // both tabs — the Library list gets the same OS-file-manager idioms
    // the Downloads list does.
    const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

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

    // Wrapped setter that enters batch mode + clears the single-select
    // anchor whenever a multi-select drag yields any rows. Plain empty
    // drags fall through to `commitSelection(new Set())` which leaves
    // batchMode alone.
    const setBatchSelectedFromDrag = useCallback(
        (next: Set<string>) => {
            if (next.size > 0) {
                setBatchMode(true);
                setSelected(null);
            }
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

    async function loadFiles(q: string, mode: SearchMode, rt: FileRoot) {
        setLoading(true);
        setError("");
        try {
            const data = await apiGet<SearchResponse>(
                API.search +
                    buildQueryString({
                        q: q.trim(),
                        search_in: mode,
                        root: rt,
                    }),
            );
            setFiles(data.files);
        } catch (e) {
            const envName = rt === "library" ? "LIBRARY_PATH" : "DOWNLOAD_PATH";
            setError(
                `Couldn't reach the ${rt}. Check that ${envName} is set and points to a valid folder. ` +
                    getErrorMessage(e),
            );
            setFiles([]);
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

    // ── Batch convert ─────────────────────────────────────────────────────

    function selectAllConvertible() {
        const paths = files
            .filter((f) => NEEDS_CONVERSION_EXTS.has(f.ext) || !!f.needs_conversion)
            .map((f) => f.path);
        commitSelection(new Set(paths));
    }

    function toggleBatch(path: string) {
        const next = new Set(batchSelected);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        commitSelection(next);
    }

    /**
     * Click handler for a row in the file list. Routes the click through
     * the shared selection model used by `LibraryExplorerSheet` so users
     * get the same OS-file-manager idioms — Shift extends from the
     * anchor, Ctrl/Cmd toggles in place, plain click replaces the
     * selection (or single-selects when no multi-select is active).
     *
     * The first modifier-bearing click also flips batchMode on so the
     * Bulk-edit button + per-row checkboxes appear without an extra
     * step. Works in both tabs — the Library list shares the gestures
     * the Downloads list had before.
     */
    function handleListClick(file: FileEntry, modifiers: { shift: boolean; toggle: boolean }) {
        const isMulti = modifiers.shift || modifiers.toggle;

        if (isMulti) {
            // Multi-select gesture. Seed the previous set: if the user
            // had a single file selected via plain click, carry it into
            // the multi-selection so Ctrl-clicking a second file ends
            // up with two rows highlighted (matches Finder / Explorer's
            // behaviour). batchMode flips on lazily — the gesture is
            // the entry point.
            const seed = !batchMode && selected ? new Set([selected.path]) : batchSelected;
            const anchor =
                !batchMode && selected
                    ? selected.path
                    : (selectionAnchor ?? selected?.path ?? null);
            const update = selectionFromClick(files, seed, anchor, file.path, modifiers);
            if (!batchMode) {
                setBatchMode(true);
                setSelected(null);
            }
            commitSelection(update.selected);
            setSelectionAnchor(update.anchor);
            return;
        }

        if (batchMode) {
            // Plain click while in batchMode toggles the checkbox + moves
            // the anchor onto the clicked row so a follow-up Shift-click
            // ranges from there.
            toggleBatch(file.path);
            setSelectionAnchor(file.path);
            return;
        }

        // Default plain single-click — open the file in the work area.
        // Clicking the already-selected file deselects.
        setSelected(selected?.path === file.path ? null : file);
    }

    // File-list keyboard shortcuts (both tabs):
    //   • Ctrl/Cmd+A — select every visible row, engage batchMode
    //   • Esc       — deselect everything (matches OS file-manager idiom)
    // Bails when the user is typing inside an input so the search box
    // doesn't lose its own Esc-to-clear behaviour.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const tag = target?.tagName ?? "";
            if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
                if (e.key === "a" || e.key === "A") {
                    if (files.length === 0) return;
                    const update = selectAll(files);
                    if (!update) return;
                    e.preventDefault();
                    if (!batchMode) {
                        setBatchMode(true);
                        setSelected(null);
                    }
                    commitSelection(update.selected);
                    setSelectionAnchor(update.anchor);
                    return;
                }
            }

            if (e.key === "Escape") {
                // No-op when nothing is selected — let the keypress fall
                // through to any ancestor (Sheet close, dialog dismiss).
                if (batchSelected.size === 0 && !selected) return;
                e.preventDefault();
                if (batchSelected.size > 0) commitSelection(new Set());
                if (selectionAnchor) setSelectionAnchor(null);
                if (selected) setSelected(null);
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [files, batchMode, batchSelected, selected, selectionAnchor, commitSelection]);

    async function handleBatchConvert() {
        const filesToConvert = files.filter((f) => batchSelected.has(f.path));
        if (!filesToConvert.length) return;
        const quality = convertFormat === "flac" ? "lossless" : convertQuality;
        const results: BatchProgress["results"] = [];
        setBatchProgress({
            current: 0,
            total: filesToConvert.length,
            currentFile: "",
            results: [],
        });
        for (let i = 0; i < filesToConvert.length; i++) {
            const file = filesToConvert[i];
            if (!file) continue;
            setBatchProgress({
                current: i + 1,
                total: filesToConvert.length,
                currentFile: file.name,
                results: [...results],
            });
            try {
                await apiPost<ConvertResponse>(API.convert, {
                    path: file.path,
                    output_format: convertFormat,
                    quality,
                    root,
                    delete_original: deleteOriginal,
                });
                results.push({ name: file.name, ok: true });
            } catch (e) {
                results.push({
                    name: file.name,
                    ok: false,
                    error: getErrorMessage(e),
                });
            }
        }
        setBatchProgress({
            current: filesToConvert.length,
            total: filesToConvert.length,
            currentFile: "",
            results: [...results],
        });
        commitSelection(new Set());
        await loadFiles(query, searchMode, root);
    }

    function toggleBatchMode() {
        setBatchMode((v) => !v);
        commitSelection(new Set());
        setSelectionAnchor(null);
        setBatchProgress(null);
    }

    // ── Render ────────────────────────────────────────────────────────────

    return (
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
                            <span
                                className="ml-auto font-mono text-xs tabular-nums text-muted-foreground/80"
                                title={`${downloadsCount} file${downloadsCount === 1 ? "" : "s"} waiting in Downloads`}
                            >
                                {downloadsCount} pending
                            </span>
                        )}
                    </button>
                </CollapsibleTrigger>

                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0">
                    <div className="flex flex-col gap-4">
                        {error && <ErrorBanner message={error} />}

                        <Tabs value={root} onValueChange={(v) => handleRootChange(v as FileRoot)}>
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
                            batchMode={batchMode}
                            onToggleBatchMode={toggleBatchMode}
                            onRefresh={() => loadFiles(query, searchMode, root)}
                            onOpenExplorer={() => setExplorerOpen(true)}
                        />

                        <div className="grid grid-cols-1 lg:grid-cols-[3fr_4fr] gap-4 items-start">
                            <FileList
                                files={files}
                                loading={loading}
                                selected={selected}
                                batchMode={batchMode}
                                batchSelected={batchSelected}
                                emptyText={
                                    root === "library"
                                        ? query
                                            ? "No matching files."
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
                            <WorkArea
                                root={root}
                                batchMode={batchMode}
                                batchSelected={batchSelected}
                                batchProgress={batchProgress}
                                convertFormat={convertFormat}
                                convertQuality={convertQuality}
                                deleteOriginal={deleteOriginal}
                                onConvertFormatChange={setConvertFormat}
                                onConvertQualityChange={setConvertQuality}
                                onDeleteOriginalChange={setDeleteOriginal}
                                onSelectAllConvertible={selectAllConvertible}
                                onClearBatch={() => {
                                    commitSelection(new Set());
                                    setSelectionAnchor(null);
                                }}
                                onBatchConvert={handleBatchConvert}
                                onClearBatchResults={() => setBatchProgress(null)}
                                onOpenBulkEdit={
                                    onOpenBulkEdit ? () => onOpenBulkEdit(root) : undefined
                                }
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
    );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-views, kept inline because they have no value outside this file.
// ─────────────────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
    return (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/25 rounded-md px-3 py-2.5 leading-relaxed">
            <AlertTriangle size={16} aria-hidden className="shrink-0 mt-0.5" />
            <span>{message}</span>
        </div>
    );
}

interface SearchRowProps {
    query: string;
    onQueryChange: (v: string) => void;
    searchMode: SearchMode;
    onSearchModeChange: (m: SearchMode) => void;
    loading: boolean;
    batchMode: boolean;
    onToggleBatchMode: () => void;
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
    batchMode,
    onToggleBatchMode,
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
                        title={
                            mode === "filename"
                                ? "Search filenames"
                                : mode === "folder"
                                  ? "Search folder names"
                                  : "Search both"
                        }
                        className="text-sm px-3 py-1.5 h-auto rounded-none! border-r border-border last:border-r-0 bg-background text-muted-foreground hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:border-accent capitalize"
                    >
                        {mode === "filename" ? "Filename" : mode}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>

            <Button
                size="sm"
                variant="outline"
                onClick={onOpenExplorer}
                className="shrink-0 gap-1.5"
                title="Browse the library folder tree, create folders, delete entries"
                aria-label="Browse library"
            >
                <FolderOpen size={14} aria-hidden />
                <span className="hidden sm:inline">Browse</span>
            </Button>
            <Button
                size="sm"
                variant={batchMode ? "default" : "outline"}
                onClick={onToggleBatchMode}
                className="shrink-0"
                title="Batch convert mode"
                aria-label="Toggle batch convert mode"
                aria-pressed={batchMode}
            >
                <ListChecks size={14} aria-hidden />
            </Button>
            <Button
                size="sm"
                variant="outline"
                onClick={onRefresh}
                disabled={loading}
                className="shrink-0"
                title="Refresh the list"
                aria-label="Refresh the file list"
            >
                <RefreshCw size={14} aria-hidden className={loading ? "animate-spin" : ""} />
            </Button>
        </div>
    );
}

interface FileListProps {
    files: FileEntry[];
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
}

function FileList({
    files,
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
}: FileListProps) {
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
            ) : files.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground italic px-4 text-center leading-relaxed">
                    {emptyText}
                </div>
            ) : (
                files.map((file) => (
                    <FileBrowserItem
                        key={file.path}
                        file={file}
                        isSelected={selected?.path === file.path}
                        batchMode={batchMode}
                        isBatchSelected={batchSelected.has(file.path)}
                        onClick={(modifiers) => {
                            // batchMode without modifiers keeps the
                            // original toggle-the-checkbox behaviour;
                            // anything modifier-bearing falls through to
                            // the parent's gesture-aware handler.
                            if (batchMode && !modifiers.shift && !modifiers.toggle) {
                                onBatchToggle(file.path);
                                return;
                            }
                            onSelect(file, modifiers);
                        }}
                        onBatchToggle={() => onBatchToggle(file.path)}
                    />
                ))
            )}
            {/* Drag-select overlay. Rendered as a portal-like absolute
                element inside the scroll container so the rectangle sits
                visually on top of the rows. The hook itself owns the
                math; we just paint what it tells us. */}
            {dragRect && <DragSelectOverlay rect={dragRect} containerRef={scrollContainerRef} />}
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
    batchMode: boolean;
    batchSelected: Set<string>;
    batchProgress: BatchProgress | null;
    convertFormat: ConvertFormat;
    convertQuality: ConvertQuality;
    deleteOriginal: boolean;
    onConvertFormatChange: (f: ConvertFormat) => void;
    onConvertQualityChange: (q: ConvertQuality) => void;
    onDeleteOriginalChange: (v: boolean) => void;
    onSelectAllConvertible: () => void;
    onClearBatch: () => void;
    onBatchConvert: () => void;
    onClearBatchResults: () => void;
    /** Open the BulkEditSheet with the current batch selection. Undefined
     *  when the parent didn't wire a handler — render path treats that as
     *  "feature not available here". */
    onOpenBulkEdit?: () => void;
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
    if (props.batchMode) {
        return (
            <BatchConvertPanel
                batchSelected={props.batchSelected}
                batchProgress={props.batchProgress}
                convertFormat={props.convertFormat}
                convertQuality={props.convertQuality}
                deleteOriginal={props.deleteOriginal}
                onConvertFormatChange={props.onConvertFormatChange}
                onConvertQualityChange={props.onConvertQualityChange}
                onDeleteOriginalChange={props.onDeleteOriginalChange}
                onSelectAllConvertible={props.onSelectAllConvertible}
                onClearBatch={props.onClearBatch}
                onBatchConvert={props.onBatchConvert}
                onClearBatchResults={props.onClearBatchResults}
                onOpenBulkEdit={props.onOpenBulkEdit}
            />
        );
    }
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

interface BatchConvertPanelProps {
    batchSelected: Set<string>;
    batchProgress: BatchProgress | null;
    convertFormat: ConvertFormat;
    convertQuality: ConvertQuality;
    deleteOriginal: boolean;
    onConvertFormatChange: (f: ConvertFormat) => void;
    onConvertQualityChange: (q: ConvertQuality) => void;
    onDeleteOriginalChange: (v: boolean) => void;
    onSelectAllConvertible: () => void;
    onClearBatch: () => void;
    onBatchConvert: () => void;
    onClearBatchResults: () => void;
    onOpenBulkEdit?: () => void;
}

function BatchConvertPanel({
    batchSelected,
    batchProgress,
    convertFormat,
    convertQuality,
    deleteOriginal,
    onConvertFormatChange,
    onConvertQualityChange,
    onDeleteOriginalChange,
    onSelectAllConvertible,
    onClearBatch,
    onBatchConvert,
    onClearBatchResults,
    onOpenBulkEdit,
}: BatchConvertPanelProps) {
    const inFlight = batchProgress !== null && !!batchProgress.currentFile;
    const failedCount = batchProgress ? batchProgress.results.filter((r) => !r.ok).length : 0;
    const okCount = batchProgress ? batchProgress.results.filter((r) => r.ok).length : 0;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm font-medium text-foreground">
                    {batchSelected.size} file
                    {batchSelected.size === 1 ? "" : "s"} selected
                </span>
                <div className="flex items-center gap-3 text-xs">
                    <button
                        type="button"
                        onClick={onSelectAllConvertible}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Select convertible
                    </button>
                    {batchSelected.size > 0 && (
                        <button
                            type="button"
                            onClick={onClearBatch}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            {/* Bulk edit affordance — separate operation that happens to
                share the same selection state. Gated at 2+ so a single
                selected file routes through the standard
                SelectedFilePanel instead, where rename + metadata write
                already live for that case. */}
            {onOpenBulkEdit && batchSelected.size >= 2 && (
                <Button
                    type="button"
                    variant="outline"
                    onClick={onOpenBulkEdit}
                    className="h-10 w-full gap-2 text-sm"
                >
                    <FilePen size={16} aria-hidden />
                    Bulk edit {batchSelected.size} files
                </Button>
            )}

            <ConversionPanel
                formats={["mp3", "flac", "ogg"]}
                format={convertFormat}
                quality={convertQuality}
                deleteOriginal={deleteOriginal}
                onFormatChange={onConvertFormatChange}
                onQualityChange={onConvertQualityChange}
                onDeleteChange={onDeleteOriginalChange}
                checkboxId="delete-original-batch"
            />

            {batchProgress && (
                <div className="flex flex-col gap-1.5">
                    {inFlight ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2
                                size={14}
                                aria-hidden
                                className="animate-spin text-muted-foreground shrink-0"
                            />
                            <span>
                                Converting {batchProgress.current} of {batchProgress.total}:{" "}
                                <span className="font-mono text-xs">
                                    {batchProgress.currentFile}
                                </span>
                            </span>
                        </div>
                    ) : (
                        <p className="text-sm text-success">
                            Converted {okCount}
                            {failedCount > 0 ? `. ${failedCount} failed.` : "."}
                        </p>
                    )}
                    {batchProgress.results
                        .filter((r) => !r.ok)
                        .map((r, i) => (
                            <p key={i} className="text-xs text-destructive font-mono break-all">
                                {r.name}: {r.error}
                            </p>
                        ))}
                </div>
            )}

            <Button
                onClick={onBatchConvert}
                disabled={batchSelected.size === 0 || inFlight}
                className="h-12 w-full gap-2 text-base"
            >
                <Repeat size={18} aria-hidden />
                Convert {batchSelected.size} file
                {batchSelected.size === 1 ? "" : "s"}
            </Button>

            {batchProgress && !inFlight && (
                <button
                    type="button"
                    onClick={onClearBatchResults}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
                >
                    Clear results
                </button>
            )}
        </div>
    );
}
