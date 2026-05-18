import {
    AlertTriangle,
    Check,
    ChevronDown,
    FolderPlus,
    ListChecks,
    Loader2,
    RefreshCw,
    Repeat,
    X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import ConversionPanel from "@/components/ConversionPanel";
import FileBrowserItem from "@/components/FileBrowserItem";
import SelectedFilePanel from "@/components/SelectedFilePanel";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { API, apiGet, apiPost, type FileRoot } from "@/lib/api";
import { FORMAT_EXT, NEEDS_CONVERSION_EXTS } from "@/lib/audioFormats";
import type {
    ConvertFormat,
    ConvertQuality,
    FileEntry,
    SearchMode,
} from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface FileBrowserProps {
    outputDash: string;
    outputPipe: string;
    extractedArtist: string;
    defaultOpen?: boolean;
    /** Triggered by the Patreon panel's post-Apply bridge link. When set,
     *  the FileBrowser opens, switches to the Downloads tab, selects the
     *  named file (synthesising the entry from the bridge payload), and
     *  scrolls itself into view. The parent should clear it via
     *  `onBridgeConsumed` once the request has been handled. */
    bridgeRequest?: { path: string; filename: string } | null;
    onBridgeConsumed?: () => void;
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
 * File library shell. Two tabs: Library (browses LIBRARY_PATH, the user's
 * curated archive) and Downloads (browses DOWNLOAD_PATH, the ingest staging
 * tree). Each tab runs a server-backed flat search; the work area on the
 * right is shared (a SelectedFilePanel handles rename, convert, and the
 * optional Move-to-library step regardless of which tab the file came
 * from). Deferred-fetch until first expand so the walk doesn't tie up a
 * worker on page load.
 *
 * `defaultOpen` drives the initial collapsed/expanded state.
 *
 * Two-column layout on lg+ viewports: the searchable file list left, the
 * work area right. Stacks on smaller viewports.
 */
export default function FileBrowser({
    outputDash,
    outputPipe,
    extractedArtist,
    defaultOpen = false,
    bridgeRequest = null,
    onBridgeConsumed,
}: FileBrowserProps) {
    const [root, setRoot] = useState<FileRoot>("library");
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [query, setQuery] = useState("");
    const [searchMode, setSearchMode] = useState<SearchMode>("filename");
    const [selected, setSelected] = useState<FileEntry | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [open, setOpen] = useState(defaultOpen);
    // Files pending move from DOWNLOAD_PATH — refreshed on open, on tab
    // switch, and after a successful move. Drives the badge on the
    // Downloads tab so the user notices forgotten downloads at a glance.
    const [downloadsCount, setDownloadsCount] = useState<number | null>(null);
    // New folder affordance (Library tab only). When open, shows an inline
    // input row above the file list; submits to /api/mkdir at the library
    // root (or under the current subdir if the picker later threads one).
    const [newFolderOpen, setNewFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [newFolderBusy, setNewFolderBusy] = useState(false);
    const [newFolderHint, setNewFolderHint] = useState<{
        kind: "success" | "error";
        text: string;
    } | null>(null);

    // Conversion preferences, persist across sessions.
    const [convertFormat, setConvertFormat] = useState<ConvertFormat>(() => {
        const stored = localStorage.getItem("convertFormat") as ConvertFormat;
        return stored && stored in FORMAT_EXT ? stored : "mp3";
    });
    const [convertQuality, setConvertQuality] = useState<ConvertQuality>(
        () =>
            (localStorage.getItem("convertQuality") as ConvertQuality) ||
            "high",
    );
    const [deleteOriginal, setDeleteOriginal] = useState(false);

    // Batch state
    const [batchMode, setBatchMode] = useState(false);
    const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
    const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(
        null,
    );

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        localStorage.setItem("convertFormat", convertFormat);
    }, [convertFormat]);
    useEffect(() => {
        localStorage.setItem("convertQuality", convertQuality);
    }, [convertQuality]);

    // ── Load files ────────────────────────────────────────────────────────

    async function loadFiles(q: string, mode: SearchMode, rt: FileRoot) {
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams();
            if (q.trim()) params.set("q", q.trim());
            params.set("search_in", mode);
            params.set("root", rt);
            const data = await apiGet<SearchResponse>(
                `${API.search}?${params.toString()}`,
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
                `${API.search}?root=downloads`,
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
            300,
        );
    }

    function handleModeChange(mode: SearchMode) {
        setSearchMode(mode);
        loadFiles(query, mode, root);
    }

    // Consume bridge requests from PatreonPanel: open the panel, switch
    // to Downloads, synthesise a FileEntry so SelectedFilePanel can drive
    // rename + move without waiting for the (just-completed) search to
    // include the file, scroll into view, then clear.
    useEffect(() => {
        if (!bridgeRequest) return;
        const { path, filename } = bridgeRequest;
        setOpen(true);
        if (root !== "downloads") {
            setRoot("downloads");
            setBatchSelected(new Set());
            loadFiles(query, searchMode, "downloads");
        }
        const ext = (() => {
            const m = filename.match(/(\.[^.]+)$/);
            return m ? m[1].toLowerCase() : "";
        })();
        const folder = path.includes("/")
            ? path.slice(0, path.lastIndexOf("/"))
            : "";
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
        setBatchSelected(new Set());
        setNewFolderOpen(false);
        setNewFolderHint(null);
        loadFiles(query, searchMode, next);
    }

    // ── New folder (Library tab) ─────────────────────────────────────────

    async function handleMkdir() {
        const name = newFolderName.trim();
        if (!name) return;
        setNewFolderBusy(true);
        setNewFolderHint(null);
        try {
            await apiPost(API.mkdir, { subdir: name });
            setNewFolderHint({
                kind: "success",
                text: `Created “${name}”.`,
            });
            setNewFolderName("");
            setNewFolderOpen(false);
            // The flat search doesn't show empty folders, so the file list
            // won't change visually — but reload anyway in case the user
            // already moved something here.
            loadFiles(query, searchMode, root);
        } catch (e) {
            setNewFolderHint({ kind: "error", text: getErrorMessage(e) });
        } finally {
            setNewFolderBusy(false);
        }
    }

    // ── Batch convert ─────────────────────────────────────────────────────

    function selectAllConvertible() {
        const paths = files
            .filter(
                (f) =>
                    NEEDS_CONVERSION_EXTS.has(f.ext) || !!f.needs_conversion,
            )
            .map((f) => f.path);
        setBatchSelected(new Set(paths));
    }

    function toggleBatch(path: string) {
        setBatchSelected((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }

    async function handleBatchConvert() {
        const filesToConvert = files.filter((f) =>
            batchSelected.has(f.path),
        );
        if (!filesToConvert.length) return;
        const quality =
            convertFormat === "flac" ? "lossless" : convertQuality;
        const results: BatchProgress["results"] = [];
        setBatchProgress({
            current: 0,
            total: filesToConvert.length,
            currentFile: "",
            results: [],
        });
        for (let i = 0; i < filesToConvert.length; i++) {
            const file = filesToConvert[i];
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
        setBatchSelected(new Set());
        await loadFiles(query, searchMode, root);
    }

    function toggleBatchMode() {
        setBatchMode((v) => !v);
        setBatchSelected(new Set());
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

                        <Tabs
                            value={root}
                            onValueChange={(v) =>
                                handleRootChange(v as FileRoot)
                            }
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
                                    {downloadsCount !== null &&
                                        downloadsCount > 0 && (
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
                            onRefresh={() =>
                                loadFiles(query, searchMode, root)
                            }
                            showNewFolder={root === "library"}
                            newFolderOpen={newFolderOpen}
                            onToggleNewFolder={() => {
                                setNewFolderOpen((v) => !v);
                                setNewFolderHint(null);
                                setNewFolderName("");
                            }}
                        />

                        {root === "library" && newFolderOpen && (
                            <NewFolderInput
                                value={newFolderName}
                                busy={newFolderBusy}
                                onChange={setNewFolderName}
                                onSubmit={handleMkdir}
                                onCancel={() => {
                                    setNewFolderOpen(false);
                                    setNewFolderName("");
                                    setNewFolderHint(null);
                                }}
                            />
                        )}
                        {newFolderHint && (
                            <p
                                className={
                                    newFolderHint.kind === "success"
                                        ? "text-xs text-success"
                                        : "text-xs text-destructive"
                                }
                            >
                                {newFolderHint.text}
                            </p>
                        )}

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
                                onSelect={(file) =>
                                    setSelected(
                                        selected?.path === file.path
                                            ? null
                                            : file,
                                    )
                                }
                                onBatchToggle={toggleBatch}
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
                                onSelectAllConvertible={
                                    selectAllConvertible
                                }
                                onClearBatch={() =>
                                    setBatchSelected(new Set())
                                }
                                onBatchConvert={handleBatchConvert}
                                onClearBatchResults={() =>
                                    setBatchProgress(null)
                                }
                                selected={selected}
                                outputDash={outputDash}
                                outputPipe={outputPipe}
                                extractedArtist={extractedArtist}
                                onDeselect={() => setSelected(null)}
                                onSelectedChange={setSelected}
                                onListReload={() => {
                                    loadFiles(query, searchMode, root);
                                    refreshDownloadsCount();
                                }}
                                onMovedToLibrary={(toPath, name) => {
                                    // After a successful move, switch to
                                    // the Library tab and select the moved
                                    // file so the user sees the new
                                    // location without hunting.
                                    handleRootChange("library");
                                    setSelected({
                                        name,
                                        ext:
                                            "." + name.split(".").pop()!,
                                        path: toPath,
                                        folder:
                                            toPath
                                                .split("/")
                                                .slice(0, -1)
                                                .join("/") ?? "",
                                    });
                                    refreshDownloadsCount();
                                }}
                                onError={setError}
                            />
                        </div>
                    </div>
                </CollapsibleContent>
            </div>
        </Collapsible>
    );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-views, kept inline because they have no value outside this file.
// ─────────────────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
    return (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/25 rounded-md px-3 py-2.5 leading-relaxed">
            <AlertTriangle
                size={16}
                aria-hidden
                className="shrink-0 mt-0.5"
            />
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
    /** Library tab only; the Downloads tab doesn't curate folder structure. */
    showNewFolder: boolean;
    newFolderOpen: boolean;
    onToggleNewFolder: () => void;
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
    showNewFolder,
    newFolderOpen,
    onToggleNewFolder,
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
                onValueChange={(v) =>
                    v && onSearchModeChange(v as SearchMode)
                }
                className="shrink-0 border border-border rounded-md overflow-hidden gap-0"
            >
                {(["filename", "folder", "both"] as SearchMode[]).map(
                    (mode) => (
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
                    ),
                )}
            </ToggleGroup>

            {showNewFolder && (
                <Button
                    size="sm"
                    variant={newFolderOpen ? "default" : "outline"}
                    onClick={onToggleNewFolder}
                    className="shrink-0 gap-1.5"
                    title="Create a new folder in the library"
                    aria-label="Create a new folder"
                    aria-pressed={newFolderOpen}
                >
                    <FolderPlus size={14} aria-hidden />
                    <span className="hidden sm:inline">New folder</span>
                </Button>
            )}
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
                <RefreshCw
                    size={14}
                    aria-hidden
                    className={loading ? "animate-spin" : ""}
                />
            </Button>
        </div>
    );
}

interface NewFolderInputProps {
    value: string;
    busy: boolean;
    onChange: (v: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
}

function NewFolderInput({
    value,
    busy,
    onChange,
    onSubmit,
    onCancel,
}: NewFolderInputProps) {
    return (
        <div className="flex gap-2 items-center bg-muted/40 border border-border rounded-md px-3 py-2">
            <FolderPlus
                size={14}
                aria-hidden
                className="text-muted-foreground shrink-0"
            />
            <Input
                autoFocus
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        onSubmit();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        onCancel();
                    }
                }}
                placeholder="New folder name"
                disabled={busy}
                aria-label="New folder name"
                className="flex-1 h-8 font-mono text-sm"
            />
            <Button
                size="sm"
                variant="outline"
                onClick={onSubmit}
                disabled={busy || !value.trim()}
                className="shrink-0"
                aria-label="Create folder"
            >
                <Check size={14} aria-hidden />
            </Button>
            <Button
                size="sm"
                variant="ghost"
                onClick={onCancel}
                disabled={busy}
                className="shrink-0"
                aria-label="Cancel new folder"
            >
                <X size={14} aria-hidden />
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
    onSelect: (file: FileEntry) => void;
    onBatchToggle: (path: string) => void;
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
}: FileListProps) {
    return (
        <div className="bg-muted/40 border border-border rounded-md overflow-y-auto max-h-[28rem] min-h-40">
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
                        onClick={() => {
                            if (batchMode) onBatchToggle(file.path);
                            else onSelect(file);
                        }}
                        onBatchToggle={() => onBatchToggle(file.path)}
                    />
                ))
            )}
        </div>
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
    selected: FileEntry | null;
    outputDash: string;
    outputPipe: string;
    extractedArtist: string;
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
}: BatchConvertPanelProps) {
    const inFlight =
        batchProgress !== null && !!batchProgress.currentFile;
    const failedCount = batchProgress
        ? batchProgress.results.filter((r) => !r.ok).length
        : 0;
    const okCount = batchProgress
        ? batchProgress.results.filter((r) => r.ok).length
        : 0;

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
                                Converting {batchProgress.current} of{" "}
                                {batchProgress.total}:{" "}
                                <span className="font-mono text-xs">
                                    {batchProgress.currentFile}
                                </span>
                            </span>
                        </div>
                    ) : (
                        <p className="text-sm text-success">
                            Converted {okCount}
                            {failedCount > 0
                                ? `. ${failedCount} failed.`
                                : "."}
                        </p>
                    )}
                    {batchProgress.results
                        .filter((r) => !r.ok)
                        .map((r, i) => (
                            <p
                                key={i}
                                className="text-xs text-destructive font-mono break-all"
                            >
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
