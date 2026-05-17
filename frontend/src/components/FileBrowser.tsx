import { ChevronDown, ChevronRight, ListChecks, RefreshCw, Repeat } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ConversionPanel from "@/components/ConversionPanel";
import FileBrowserItem from "@/components/FileBrowserItem";
import SelectedFilePanel from "@/components/SelectedFilePanel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiGet, apiPost, API } from "@/lib/api";
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
 * File browser shell: server-backed search across `LIBRARY_PATH`, a
 * filterable list (filename / folder / both), batch convert mode, and
 * a single-file work area below the list.
 *
 * Per-row rendering lives in `FileBrowserItem`; the selected-file
 * rename/convert UI lives in `SelectedFilePanel`. Conversion preferences
 * (format/quality/delete-original) live here so the batch panel and the
 * single-file panel share them.
 */
export default function FileBrowser({
    outputDash,
    outputPipe,
    extractedArtist,
}: FileBrowserProps) {
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [query, setQuery] = useState("");
    const [searchMode, setSearchMode] = useState<SearchMode>("filename");
    const [selected, setSelected] = useState<FileEntry | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [open, setOpen] = useState(false);

    // Conversion preferences — persist across sessions via localStorage.
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

    // Persist preferences
    useEffect(() => {
        localStorage.setItem("convertFormat", convertFormat);
    }, [convertFormat]);
    useEffect(() => {
        localStorage.setItem("convertQuality", convertQuality);
    }, [convertQuality]);

    // ── Load files ────────────────────────────────────────────────────────────

    async function loadFiles(q: string, mode: SearchMode) {
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams();
            if (q.trim()) params.set("q", q.trim());
            params.set("search_in", mode);
            const data = await apiGet<SearchResponse>(
                `${API.search}?${params.toString()}`,
            );
            setFiles(data.files);
        } catch (e) {
            setError(
                "Could not load files: " +
                    getErrorMessage(e) +
                    " — check LIBRARY_PATH in devcontainer.json",
            );
            setFiles([]);
        } finally {
            setLoading(false);
        }
    }

    // Defer the initial load until the panel is opened the first time —
    // otherwise we walk the entire LIBRARY_PATH (a sync FastAPI route that
    // ties up a worker thread) on every page load even when the user never
    // expands the file browser. `loadedOnceRef` keeps it strictly mount-once
    // per session so toggling open/closed doesn't re-fetch.
    const loadedOnceRef = useRef(false);
    useEffect(() => {
        if (!open || loadedOnceRef.current) return;
        loadedOnceRef.current = true;
        loadFiles("", "filename");
    }, [open]);

    function handleQueryChange(val: string) {
        setQuery(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(
            () => loadFiles(val, searchMode),
            300,
        );
    }

    function handleModeChange(mode: SearchMode) {
        setSearchMode(mode);
        loadFiles(query, mode);
    }

    // ── Batch convert ────────────────────────────────────────────────────────

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
        await loadFiles(query, searchMode);
    }

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <Collapsible open={open} onOpenChange={setOpen} asChild>
            <Card className="rounded-xl border border-border shadow-none ring-0 p-5 gap-0">
                {/* Card title — doubles as the collapsible trigger */}
                <CollapsibleTrigger asChild>
                    <button
                        type="button"
                        className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground -mx-1 px-1 py-1 rounded-md hover:bg-secondary/50 transition-colors w-full text-left"
                    >
                        {open ? (
                            <ChevronDown size={11} className="shrink-0" />
                        ) : (
                            <ChevronRight size={11} className="shrink-0" />
                        )}
                        <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                        File to Rename
                        {!loading && (
                            <span className="opacity-60 text-[9px] tracking-[0.08em] tabular-nums">
                                — {files.length} file{files.length !== 1 ? "s" : ""} indexed
                            </span>
                        )}
                        <span className="ml-auto opacity-50 text-[9px] tracking-[0.08em]">
                            {open ? "click to collapse" : "click to expand"}
                        </span>
                    </button>
                </CollapsibleTrigger>

                <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out overflow-hidden">
                    <div className="mt-4">

            {/* Error banner */}
            {error && (
                <Alert
                    variant="destructive"
                    className="mb-3 py-2 text-[11px]"
                >
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Search row */}
            <div className="flex gap-2 items-center mb-3">
                <Input
                    value={query}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    placeholder="Search… (leave empty to show all)"
                    className="flex-1 min-w-0"
                />

                <ToggleGroup
                    type="single"
                    value={searchMode}
                    onValueChange={(v) =>
                        v && handleModeChange(v as SearchMode)
                    }
                    className="shrink-0 border border-input rounded-3xl overflow-hidden gap-0"
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
                                className="text-[10px] tracking-[0.06em] px-2.5 py-1.5 h-auto rounded-none! border-r border-input last:border-r-0 bg-secondary text-muted-foreground hover:bg-primary/10 hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                            >
                                {mode === "filename" ? "file" : mode}
                            </ToggleGroupItem>
                        ),
                    )}
                </ToggleGroup>

                {!loading && files.length > 0 && (
                    <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                        {files.length} file{files.length !== 1 ? "s" : ""}
                    </span>
                )}

                <Button
                    size="sm"
                    variant={batchMode ? "default" : "ghost"}
                    onClick={() => {
                        setBatchMode((v) => !v);
                        setBatchSelected(new Set());
                        setBatchProgress(null);
                    }}
                    className="shrink-0 px-2.5"
                    title="Batch convert mode"
                >
                    <ListChecks size={14} />
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => loadFiles(query, searchMode)}
                    className="shrink-0 px-2.5"
                    title="Refresh"
                >
                    <RefreshCw
                        size={14}
                        className={loading ? "animate-spin" : ""}
                    />
                </Button>
            </div>

            {/* File list */}
            <div className="bg-secondary border border-input rounded-md overflow-y-auto max-h-50">
                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                        <span className="w-3.5 h-3.5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin shrink-0" />
                        Scanning all folders…
                    </div>
                ) : files.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                        No matching files
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
                                if (batchMode) toggleBatch(file.path);
                                else
                                    setSelected(
                                        selected?.path === file.path
                                            ? null
                                            : file,
                                    );
                            }}
                            onBatchToggle={() => toggleBatch(file.path)}
                        />
                    ))
                )}
            </div>

            {/* Batch convert panel */}
            {batchMode && (
                <div className="mt-3 border border-border rounded-lg p-3 bg-secondary/50">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-[11px] font-medium text-foreground">
                            {batchSelected.size} file
                            {batchSelected.size !== 1 ? "s" : ""} selected
                        </span>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={selectAllConvertible}
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Select convertible
                            </button>
                            {batchSelected.size > 0 && (
                                <button
                                    onClick={() => setBatchSelected(new Set())}
                                    className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
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
                        onFormatChange={setConvertFormat}
                        onQualityChange={setConvertQuality}
                        onDeleteChange={setDeleteOriginal}
                        checkboxId="delete-original-batch"
                    />

                    {batchProgress && (
                        <div className="mb-3">
                            {batchProgress.currentFile ? (
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <span className="w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin shrink-0" />
                                    {batchProgress.current}/
                                    {batchProgress.total} —{" "}
                                    {batchProgress.currentFile}
                                </div>
                            ) : (
                                <div className="text-[10px] text-success">
                                    Done —{" "}
                                    {
                                        batchProgress.results.filter(
                                            (r) => r.ok,
                                        ).length
                                    }{" "}
                                    converted
                                    {batchProgress.results.filter(
                                        (r) => !r.ok,
                                    ).length > 0 &&
                                        `, ${batchProgress.results.filter((r) => !r.ok).length} failed`}
                                </div>
                            )}
                            {batchProgress.results
                                .filter((r) => !r.ok)
                                .map((r, i) => (
                                    <div
                                        key={i}
                                        className="text-[10px] text-destructive mt-1 truncate"
                                    >
                                        ✗ {r.name}: {r.error}
                                    </div>
                                ))}
                        </div>
                    )}

                    <Button
                        className="w-full gap-2"
                        disabled={
                            batchSelected.size === 0 ||
                            (batchProgress !== null &&
                                !!batchProgress.currentFile)
                        }
                        onClick={handleBatchConvert}
                    >
                        <Repeat size={16} />
                        Convert {batchSelected.size} file
                        {batchSelected.size !== 1 ? "s" : ""}
                    </Button>

                    {batchProgress && !batchProgress.currentFile && (
                        <button
                            onClick={() => setBatchProgress(null)}
                            className="w-full mt-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors text-center"
                        >
                            Clear results
                        </button>
                    )}
                </div>
            )}

            {/* Selected file work area */}
            {selected && (
                <SelectedFilePanel
                    selected={selected}
                    outputDash={outputDash}
                    outputPipe={outputPipe}
                    extractedArtist={extractedArtist}
                    convertFormat={convertFormat}
                    convertQuality={convertQuality}
                    deleteOriginal={deleteOriginal}
                    onConvertFormatChange={setConvertFormat}
                    onConvertQualityChange={setConvertQuality}
                    onDeleteOriginalChange={setDeleteOriginal}
                    onDeselect={() => setSelected(null)}
                    onSelectedChange={setSelected}
                    onListReload={() => loadFiles(query, searchMode)}
                    onError={setError}
                />
            )}
                    </div>
                </CollapsibleContent>
            </Card>
        </Collapsible>
    );
}
