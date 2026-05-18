import {
    AlertTriangle,
    ArrowUpRight,
    Check,
    ChevronDown,
    ChevronRight,
    File,
    Folder,
    FolderPlus,
    Loader2,
    Music2,
    PenLine,
    Repeat,
    Send,
    X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import ConversionPanel from "@/components/ConversionPanel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { API, apiGet, apiPost, type FileRoot } from "@/lib/api";
import {
    FORMAT_EXT,
    METADATA_COMPATIBLE_EXTS,
    NEEDS_CONVERSION_EXTS,
} from "@/lib/audioFormats";
import type {
    ConvertFormat,
    ConvertQuality,
    FileEntry,
    ListedDirResponse,
    RenameSep,
} from "@/lib/types";
import { getErrorMessage, sanitizeFilename } from "@/lib/utils";

const MAX_BYTES = 255;

interface SelectedFilePanelProps {
    selected: FileEntry;
    /** Which root the selected file lives under. Rename + convert stay in
     *  the same root; move always targets `library`. */
    root: FileRoot;
    /** Outputs from the title/tags generator, used as rename target. */
    outputDash: string;
    outputPipe: string;
    /** Artist pre-fill from the screenshot/Patreon extract. */
    extractedArtist: string;
    /** Shared conversion preferences (also used by the batch panel). */
    convertFormat: ConvertFormat;
    convertQuality: ConvertQuality;
    deleteOriginal: boolean;
    onConvertFormatChange: (f: ConvertFormat) => void;
    onConvertQualityChange: (q: ConvertQuality) => void;
    onDeleteOriginalChange: (v: boolean) => void;
    /** Called when the user closes the panel via the × button. */
    onDeselect: () => void;
    /** Update the selected entry in place after a successful rename/convert. */
    onSelectedChange: (next: FileEntry) => void;
    /** Reload the file list after rename/convert so it stays in sync. */
    onListReload: () => void;
    /** Called after a successful move: parent switches FileBrowser to the
     *  Library tab and selects the moved file at its new path. */
    onMovedToLibrary: (toPath: string, name: string) => void;
    /** Surface fatal errors back up to the FileBrowser banner. */
    onError: (msg: string) => void;
}

interface RenameResponse {
    path: string;
    new_name: string;
    // Set when the rename succeeded but the optional ID3/FLAC/MP4 metadata
    // embed step failed. The file is still on disk under the new name.
    metadata_error?: string;
}

interface ConvertResponse {
    path: string;
    new_name: string;
}

/**
 * Work area for a single selected file. Lives in the right column of the
 * FileBrowser two-column layout. Shows file info, lets the user fill in
 * embedded ID3/FLAC/MP4 metadata fields, choose a rename separator, preview
 * the resulting filename with a byte counter, and either rename (metadata-
 * compatible formats) or convert (otherwise). Conversion preferences are
 * lifted up to FileBrowser so the batch panel can share them.
 */
export default function SelectedFilePanel({
    selected,
    root,
    outputDash,
    outputPipe,
    extractedArtist,
    convertFormat,
    convertQuality,
    deleteOriginal,
    onConvertFormatChange,
    onConvertQualityChange,
    onDeleteOriginalChange,
    onDeselect,
    onSelectedChange,
    onListReload,
    onMovedToLibrary,
    onError,
}: SelectedFilePanelProps) {
    const [renameSep, setRenameSep] = useState<RenameSep>("dash");
    const [renaming, setRenaming] = useState(false);
    const [renamed, setRenamed] = useState(false);
    const [converting, setConverting] = useState(false);
    const [converted, setConverted] = useState(false);

    // Metadata fields
    const [metaTitle, setMetaTitle] = useState("");
    const [metaArtist, setMetaArtist] = useState("");
    const [metaAlbum, setMetaAlbum] = useState("");
    const [metaAlbumArtist, setMetaAlbumArtist] = useState("");
    const [linkArtists, setLinkArtists] = useState(
        () => localStorage.getItem("linkArtists") !== "false",
    );

    const extractedArtistRef = useRef(extractedArtist);
    useEffect(() => {
        extractedArtistRef.current = extractedArtist;
    }, [extractedArtist]);

    // Pending state-reset timers (rename + convert "done" badges). Tracked
    // in refs so we can cancel them on unmount and avoid React's
    // "setState on unmounted component" warning.
    const renamedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const convertedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        return () => {
            if (renamedTimerRef.current)
                clearTimeout(renamedTimerRef.current);
            if (convertedTimerRef.current)
                clearTimeout(convertedTimerRef.current);
        };
    }, []);

    // Title syncs from the pipe-format output continuously. metaTitle is
    // editable by the user after the sync, so we can't just derive it on
    // every render — we need state that *starts* as outputPipe and accepts
    // edits.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing editable state from prop
        setMetaTitle(outputPipe);
    }, [outputPipe]);

    // Pre-populate artist when a new file is selected (so switching files
    // refills the artist box from the latest extract).
    // ESLint's react-hooks/set-state-in-effect doesn't fire here because the
    // call is guarded by a conditional.
    useEffect(() => {
        if (extractedArtistRef.current)
            setMetaArtist(extractedArtistRef.current);
    }, [selected.path]);

    useEffect(() => {
        localStorage.setItem("linkArtists", String(linkArtists));
    }, [linkArtists]);

    // ── Derived state ────────────────────────────────────────────────────

    const needsConversion =
        !!selected.needs_conversion ||
        NEEDS_CONVERSION_EXTS.has(selected.ext);

    const newName = (() => {
        const text = renameSep === "dash" ? outputDash : outputPipe;
        if (!text) return null;
        return sanitizeFilename(text) + getExt(selected.name);
    })();

    const bytes = newName ? byteLength(newName) : 0;
    const bytesOver = bytes > MAX_BYTES;
    const bytesWarn = bytes > 200 && !bytesOver;

    // For optional conversion, drop the current format from the choices.
    const optionalConvertFormats = (
        ["mp3", "flac", "ogg"] as ConvertFormat[]
    ).filter((fmt) => FORMAT_EXT[fmt] !== selected.ext);

    // Guard against showing optional convert in the current format.
    const safeConvertFormat =
        !needsConversion && FORMAT_EXT[convertFormat] === selected.ext
            ? optionalConvertFormats[0] ?? "mp3"
            : convertFormat;

    // ── Actions ──────────────────────────────────────────────────────────

    async function handleRename() {
        if (!newName || bytesOver || needsConversion) return;
        setRenaming(true);
        onError("");
        try {
            const data = await apiPost<RenameResponse>(API.rename, {
                path: selected.path,
                new_name: newName,
                root,
                metadata: {
                    title: metaTitle,
                    artist: metaArtist,
                    album: metaAlbum,
                    album_artist: linkArtists
                        ? metaArtist
                        : metaAlbumArtist,
                },
            });
            onSelectedChange({
                ...selected,
                path: data.path,
                name: data.new_name,
            });
            setRenamed(true);
            if (renamedTimerRef.current)
                clearTimeout(renamedTimerRef.current);
            renamedTimerRef.current = setTimeout(
                () => setRenamed(false),
                2500,
            );
            // Surface the partial-success path: rename committed, metadata
            // embed didn't. The file is on disk under the new name, but the
            // user expected tags written too.
            if (data.metadata_error) {
                onError(
                    `Renamed, but metadata embed failed: ${data.metadata_error}`,
                );
            }
            onListReload();
        } catch (e) {
            onError("Rename failed: " + getErrorMessage(e));
        } finally {
            setRenaming(false);
        }
    }

    async function handleConvert() {
        setConverting(true);
        onError("");
        try {
            const quality =
                convertFormat === "flac" ? "lossless" : convertQuality;
            const data = await apiPost<ConvertResponse>(API.convert, {
                path: selected.path,
                output_format: convertFormat,
                quality,
                root,
                delete_original: deleteOriginal,
            });
            const newExt = FORMAT_EXT[convertFormat];
            onSelectedChange({
                ...selected,
                name: data.new_name,
                ext: newExt,
                path: data.path,
                needs_conversion: false,
            });
            setConverted(true);
            if (convertedTimerRef.current)
                clearTimeout(convertedTimerRef.current);
            convertedTimerRef.current = setTimeout(
                () => setConverted(false),
                2500,
            );
            onListReload();
        } catch (e) {
            onError("Conversion failed: " + getErrorMessage(e));
        } finally {
            setConverting(false);
        }
    }

    // ── Render ───────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col gap-4">
            {/* Selected file header */}
            <div className="flex items-start gap-2.5">
                <FileIcon ext={selected.ext} />
                <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm font-medium text-foreground break-all">
                        {selected.name}
                    </div>
                    {selected.folder && (
                        <div className="font-mono text-xs text-muted-foreground break-all">
                            {selected.folder}
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    onClick={onDeselect}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-1 -m-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    title="Deselect"
                    aria-label="Deselect file"
                >
                    <X size={16} aria-hidden />
                </button>
            </div>

            {needsConversion ? (
                <RequiredConversion
                    converting={converting}
                    converted={converted}
                    convertFormat={convertFormat}
                    convertQuality={convertQuality}
                    deleteOriginal={deleteOriginal}
                    onConvertFormatChange={onConvertFormatChange}
                    onConvertQualityChange={onConvertQualityChange}
                    onDeleteOriginalChange={onDeleteOriginalChange}
                    onConvert={handleConvert}
                />
            ) : (
                <RenameSection
                    renameSep={renameSep}
                    onRenameSepChange={setRenameSep}
                    metaTitle={metaTitle}
                    metaArtist={metaArtist}
                    metaAlbum={metaAlbum}
                    metaAlbumArtist={metaAlbumArtist}
                    linkArtists={linkArtists}
                    onMetaTitleChange={setMetaTitle}
                    onMetaArtistChange={setMetaArtist}
                    onMetaAlbumChange={setMetaAlbum}
                    onMetaAlbumArtistChange={setMetaAlbumArtist}
                    onLinkArtistsChange={setLinkArtists}
                    newName={newName}
                    bytes={bytes}
                    bytesOver={bytesOver}
                    bytesWarn={bytesWarn}
                    renaming={renaming}
                    renamed={renamed}
                    onRename={handleRename}
                    optionalConvertFormats={optionalConvertFormats}
                    safeConvertFormat={safeConvertFormat}
                    convertQuality={convertQuality}
                    deleteOriginal={deleteOriginal}
                    onConvertFormatChange={onConvertFormatChange}
                    onConvertQualityChange={onConvertQualityChange}
                    onDeleteOriginalChange={onDeleteOriginalChange}
                    converting={converting}
                    converted={converted}
                    onConvert={handleConvert}
                />
            )}

            <MoveToLibrarySection
                selected={selected}
                fromRoot={root}
                /* If the user has a generated rename preview that differs
                 * from the current filename, the move offers to apply it
                 * during the move (one server call instead of two). */
                pendingNewName={
                    newName && !bytesOver && newName !== selected.name
                        ? newName
                        : null
                }
                onMoved={(toPath, name) => {
                    onListReload();
                    onMovedToLibrary(toPath, name);
                }}
                onError={onError}
            />
        </div>
    );
}

// ── Move to library ──────────────────────────────────────────────────────

interface MoveToLibrarySectionProps {
    selected: FileEntry;
    fromRoot: FileRoot;
    pendingNewName: string | null;
    onMoved: (toPath: string, name: string) => void;
    onError: (msg: string) => void;
}

interface MoveResponse {
    to_path: string;
    new_name: string;
}

interface SystemInfoResponse {
    os_explorer: boolean;
}

function MoveToLibrarySection({
    selected,
    fromRoot,
    pendingNewName,
    onMoved,
    onError,
}: MoveToLibrarySectionProps) {
    const [open, setOpen] = useState(false);
    // Picker state: which library subdir is the user currently inside?
    // "" means LIBRARY_PATH root. Drilling pushes path segments; the
    // breadcrumb at the top lets the user pop back up.
    const [subdir, setSubdir] = useState("");
    const [entries, setEntries] = useState<
        { name: string; type: "file" | "dir" }[] | null
    >(null);
    const [loading, setLoading] = useState(false);
    const [moving, setMoving] = useState(false);
    const [applyRename, setApplyRename] = useState(true);

    // Inline "+ New folder" state (creates under the currently-viewed subdir).
    const [newFolderOpen, setNewFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [newFolderBusy, setNewFolderBusy] = useState(false);

    // OS-explorer capability gate. Fetched once on mount; the button hides
    // when running in Docker / devcontainer where the host's file manager
    // isn't reachable.
    const [canOpenOs, setCanOpenOs] = useState(false);
    useEffect(() => {
        let cancelled = false;
        apiGet<SystemInfoResponse>(API.systemInfo)
            .then((data) => {
                if (!cancelled) setCanOpenOs(!!data.os_explorer);
            })
            .catch(() => {
                /* non-fatal — button stays hidden */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    async function loadSubdir(s: string) {
        setLoading(true);
        try {
            const params = new URLSearchParams({ root: "library" });
            if (s) params.set("subdir", s);
            const data = await apiGet<ListedDirResponse>(
                `${API.files}?${params.toString()}`,
            );
            setEntries(
                data.entries
                    .filter((e) => e.type === "dir")
                    .map((e) => ({ name: e.name, type: "dir" as const })),
            );
        } catch (e) {
            onError("Couldn't load library folders: " + getErrorMessage(e));
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }

    // Lazy first load + reload on subdir change while open.
    useEffect(() => {
        if (!open) return;
        loadSubdir(subdir);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- subdir + open drive the reload
    }, [open, subdir]);

    function drillInto(name: string) {
        const next = subdir ? `${subdir}/${name}` : name;
        setSubdir(next);
        setNewFolderOpen(false);
    }

    function popTo(idx: number) {
        // idx === -1 jumps to library root; otherwise the index points at
        // the breadcrumb segment to land on.
        if (idx < 0) {
            setSubdir("");
            return;
        }
        const segments = subdir.split("/");
        setSubdir(segments.slice(0, idx + 1).join("/"));
        setNewFolderOpen(false);
    }

    async function handleMove() {
        setMoving(true);
        onError("");
        try {
            const body: Record<string, unknown> = {
                from_path: selected.path,
                from_root: fromRoot,
                to_subdir: subdir,
            };
            if (applyRename && pendingNewName) {
                body.new_name = pendingNewName;
            }
            const data = await apiPost<MoveResponse>(API.move, body);
            setOpen(false);
            onMoved(data.to_path, data.new_name);
        } catch (e) {
            onError("Move failed: " + getErrorMessage(e));
        } finally {
            setMoving(false);
        }
    }

    async function handleMkdir() {
        const name = newFolderName.trim();
        if (!name) return;
        setNewFolderBusy(true);
        try {
            const body: Record<string, unknown> = { subdir: name };
            if (subdir) body.parent = subdir;
            await apiPost(API.mkdir, body);
            setNewFolderName("");
            setNewFolderOpen(false);
            // Drill into the just-created folder so the user can click
            // Move here immediately. Reloads the picker contents on the
            // way (effect on `subdir`).
            drillInto(name);
        } catch (e) {
            onError("Couldn't create folder: " + getErrorMessage(e));
        } finally {
            setNewFolderBusy(false);
        }
    }

    async function handleOpenInOs() {
        try {
            await apiPost(API.systemExplore, {
                root: "library",
                subdir,
            });
        } catch (e) {
            onError("Couldn't open file explorer: " + getErrorMessage(e));
        }
    }

    const breadcrumbs = subdir ? subdir.split("/") : [];
    const destinationLabel = subdir ? `Library / ${subdir}` : "Library";

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    className="group/move flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-1 px-1 -mx-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 w-fit"
                >
                    <ChevronDown
                        size={14}
                        aria-hidden
                        className="transition-transform motion-safe:duration-200 motion-safe:ease-out group-data-[state=closed]/move:-rotate-90"
                    />
                    Move to library
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1">
                <div className="pt-3 flex flex-col gap-3">
                    {/* Breadcrumb + actions */}
                    <div className="flex items-center gap-1.5 flex-wrap text-xs">
                        <button
                            type="button"
                            onClick={() => popTo(-1)}
                            className="font-medium text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        >
                            Library
                        </button>
                        {breadcrumbs.map((seg, i) => (
                            <span
                                key={i}
                                className="inline-flex items-center gap-1.5 text-muted-foreground"
                            >
                                <ChevronRight
                                    size={12}
                                    aria-hidden
                                    className="opacity-40"
                                />
                                <button
                                    type="button"
                                    onClick={() => popTo(i)}
                                    className="font-medium text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 break-all"
                                >
                                    {seg}
                                </button>
                            </span>
                        ))}
                        <span className="flex items-center gap-1 ml-auto">
                            <Button
                                size="sm"
                                variant={newFolderOpen ? "default" : "outline"}
                                onClick={() => {
                                    setNewFolderOpen((v) => !v);
                                    setNewFolderName("");
                                }}
                                className="gap-1.5"
                                title="Create a new folder here"
                                aria-pressed={newFolderOpen}
                            >
                                <FolderPlus size={12} aria-hidden />
                                New folder
                            </Button>
                            {canOpenOs && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleOpenInOs}
                                    className="gap-1.5"
                                    title="Open this folder in the host file manager"
                                >
                                    <ArrowUpRight size={12} aria-hidden />
                                    Open in OS
                                </Button>
                            )}
                        </span>
                    </div>

                    {/* Inline new-folder input */}
                    {newFolderOpen && (
                        <div className="flex gap-2 items-center bg-muted/40 border border-border rounded-md px-3 py-2">
                            <FolderPlus
                                size={14}
                                aria-hidden
                                className="text-muted-foreground shrink-0"
                            />
                            <Input
                                autoFocus
                                value={newFolderName}
                                onChange={(e) =>
                                    setNewFolderName(e.target.value)
                                }
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        handleMkdir();
                                    } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        setNewFolderOpen(false);
                                        setNewFolderName("");
                                    }
                                }}
                                placeholder="New folder name"
                                disabled={newFolderBusy}
                                aria-label="New folder name"
                                className="flex-1 h-8 font-mono text-sm"
                            />
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleMkdir}
                                disabled={
                                    newFolderBusy || !newFolderName.trim()
                                }
                                className="shrink-0"
                                aria-label="Create folder"
                            >
                                <Check size={14} aria-hidden />
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    setNewFolderOpen(false);
                                    setNewFolderName("");
                                }}
                                disabled={newFolderBusy}
                                className="shrink-0"
                                aria-label="Cancel new folder"
                            >
                                <X size={14} aria-hidden />
                            </Button>
                        </div>
                    )}

                    {/* Folder list */}
                    <div className="bg-muted/40 border border-border rounded-md max-h-[18rem] overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                                <Loader2
                                    size={14}
                                    aria-hidden
                                    className="animate-spin shrink-0"
                                />
                                Loading.
                            </div>
                        ) : !entries || entries.length === 0 ? (
                            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground italic px-4 text-center leading-relaxed">
                                No subfolders here. Create one to start filing.
                            </div>
                        ) : (
                            entries.map((entry) => (
                                <button
                                    key={entry.name}
                                    type="button"
                                    onClick={() => drillInto(entry.name)}
                                    className="w-full text-left px-3 py-2 flex items-center gap-2.5 text-sm hover:bg-accent/40 focus-visible:outline-none focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset transition-colors group/folder"
                                >
                                    <Folder
                                        size={14}
                                        aria-hidden
                                        className="text-muted-foreground shrink-0"
                                    />
                                    <span className="flex-1 font-mono text-sm text-foreground break-all">
                                        {entry.name}
                                    </span>
                                    <ChevronRight
                                        size={14}
                                        aria-hidden
                                        className="text-muted-foreground/50 group-hover/folder:text-foreground transition-colors shrink-0"
                                    />
                                </button>
                            ))
                        )}
                    </div>

                    {/* Optional rename-during-move toggle */}
                    {pendingNewName && (
                        <label className="flex items-start gap-2 cursor-pointer select-none">
                            <Checkbox
                                checked={applyRename}
                                onCheckedChange={(v) =>
                                    setApplyRename(v === true)
                                }
                                className="mt-0.5 shrink-0"
                            />
                            <span className="text-xs text-muted-foreground leading-relaxed">
                                Rename to{" "}
                                <span className="font-mono text-foreground">
                                    {pendingNewName}
                                </span>{" "}
                                during the move.
                            </span>
                        </label>
                    )}

                    {/* Destination + commit */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-muted-foreground flex-1 min-w-0">
                            Moving to:{" "}
                            <span className="font-mono text-foreground break-all">
                                {destinationLabel}
                            </span>
                        </span>
                        <Button
                            onClick={handleMove}
                            disabled={moving}
                            className="gap-2 shrink-0"
                            size="lg"
                        >
                            {moving ? (
                                <Loader2
                                    size={14}
                                    aria-hidden
                                    className="animate-spin"
                                />
                            ) : (
                                <Send size={14} aria-hidden />
                            )}
                            {moving ? "Moving" : "Move here"}
                        </Button>
                    </div>
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-views: kept in the same file because they have no value outside it
// and the props plumbing would otherwise be more boilerplate than benefit.
// ─────────────────────────────────────────────────────────────────────────

interface RequiredConversionProps {
    converting: boolean;
    converted: boolean;
    convertFormat: ConvertFormat;
    convertQuality: ConvertQuality;
    deleteOriginal: boolean;
    onConvertFormatChange: (f: ConvertFormat) => void;
    onConvertQualityChange: (q: ConvertQuality) => void;
    onDeleteOriginalChange: (v: boolean) => void;
    onConvert: () => void;
}

function RequiredConversion({
    converting,
    converted,
    convertFormat,
    convertQuality,
    deleteOriginal,
    onConvertFormatChange,
    onConvertQualityChange,
    onDeleteOriginalChange,
    onConvert,
}: RequiredConversionProps) {
    return (
        <>
            <div className="flex items-start gap-2 text-sm text-warning bg-warning/10 border border-warning/25 rounded-md px-3 py-2.5 leading-relaxed">
                <AlertTriangle
                    size={16}
                    aria-hidden
                    className="shrink-0 mt-0.5"
                />
                <span>
                    This file's format doesn't support embedded metadata.
                    Convert it first.
                </span>
            </div>
            <ConversionPanel
                formats={["mp3", "flac", "ogg"]}
                format={convertFormat}
                quality={convertQuality}
                deleteOriginal={deleteOriginal}
                onFormatChange={onConvertFormatChange}
                onQualityChange={onConvertQualityChange}
                onDeleteChange={onDeleteOriginalChange}
                checkboxId="delete-original-required"
            />
            <ActionButton
                kind="convert"
                busy={converting}
                done={converted}
                onClick={onConvert}
            />
        </>
    );
}

interface RenameSectionProps {
    renameSep: RenameSep;
    onRenameSepChange: (s: RenameSep) => void;
    metaTitle: string;
    metaArtist: string;
    metaAlbum: string;
    metaAlbumArtist: string;
    linkArtists: boolean;
    onMetaTitleChange: (v: string) => void;
    onMetaArtistChange: (v: string) => void;
    onMetaAlbumChange: (v: string) => void;
    onMetaAlbumArtistChange: (v: string) => void;
    onLinkArtistsChange: (v: boolean) => void;
    newName: string | null;
    bytes: number;
    bytesOver: boolean;
    bytesWarn: boolean;
    renaming: boolean;
    renamed: boolean;
    onRename: () => void;
    optionalConvertFormats: ConvertFormat[];
    safeConvertFormat: ConvertFormat;
    convertQuality: ConvertQuality;
    deleteOriginal: boolean;
    onConvertFormatChange: (f: ConvertFormat) => void;
    onConvertQualityChange: (q: ConvertQuality) => void;
    onDeleteOriginalChange: (v: boolean) => void;
    converting: boolean;
    converted: boolean;
    onConvert: () => void;
}

function RenameSection(props: RenameSectionProps) {
    const {
        renameSep,
        onRenameSepChange,
        metaTitle,
        metaArtist,
        metaAlbum,
        metaAlbumArtist,
        linkArtists,
        onMetaTitleChange,
        onMetaArtistChange,
        onMetaAlbumChange,
        onMetaAlbumArtistChange,
        onLinkArtistsChange,
        newName,
        bytes,
        bytesOver,
        bytesWarn,
        renaming,
        renamed,
        onRename,
        optionalConvertFormats,
        safeConvertFormat,
        convertQuality,
        deleteOriginal,
        onConvertFormatChange,
        onConvertQualityChange,
        onDeleteOriginalChange,
        converting,
        converted,
        onConvert,
    } = props;

    return (
        <>
            {/* Separator choice */}
            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium tracking-wide text-muted-foreground">
                    Separator
                </span>
                <ToggleGroup
                    type="single"
                    value={renameSep}
                    onValueChange={(v) =>
                        v && onRenameSepChange(v as RenameSep)
                    }
                    className="border border-border rounded-md overflow-hidden gap-0"
                >
                    {(["dash", "pipe"] as RenameSep[]).map((sep) => (
                        <ToggleGroupItem
                            key={sep}
                            value={sep}
                            className="text-sm px-3 py-1.5 h-auto rounded-none! border-r border-border last:border-r-0 bg-background text-muted-foreground hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:border-accent"
                        >
                            {sep === "dash" ? "Dashes (-)" : "Pipes (|)"}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </div>

            {/* Metadata fields */}
            <div className="grid grid-cols-1 sm:grid-cols-[6rem_1fr] gap-x-3 gap-y-2.5 sm:items-center">
                <MetaField
                    id="meta-title"
                    label="Title"
                    value={metaTitle}
                    onChange={onMetaTitleChange}
                    placeholder="Track title"
                />
                <MetaField
                    id="meta-artist"
                    label="Artist"
                    value={metaArtist}
                    onChange={onMetaArtistChange}
                    placeholder="Artist name"
                />
                <MetaField
                    id="meta-album"
                    label="Album"
                    value={metaAlbum}
                    onChange={onMetaAlbumChange}
                    placeholder="Album name"
                />
                <MetaField
                    id="meta-album-artist"
                    label="Album artist"
                    value={linkArtists ? metaArtist : metaAlbumArtist}
                    onChange={onMetaAlbumArtistChange}
                    placeholder="Album artist"
                    disabled={linkArtists}
                />
                <div className="sm:col-start-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                        <Checkbox
                            checked={linkArtists}
                            onCheckedChange={(v) =>
                                onLinkArtistsChange(v === true)
                            }
                        />
                        <span className="text-sm text-muted-foreground">
                            Same as artist
                        </span>
                    </label>
                </div>
            </div>

            {/* Rename preview */}
            <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium tracking-wide text-muted-foreground">
                    Will become
                </span>
                <div className="bg-muted/40 border border-border rounded-md px-3 py-2.5 font-mono text-sm leading-relaxed break-all min-h-10">
                    {newName ? (
                        <span className="text-foreground">{newName}</span>
                    ) : (
                        <span className="text-muted-foreground italic">
                            Generate a filename above first.
                        </span>
                    )}
                </div>
                {newName && (
                    <p
                        className={
                            bytesOver
                                ? "text-xs text-destructive"
                                : bytesWarn
                                  ? "text-xs text-warning"
                                  : "text-xs text-muted-foreground"
                        }
                    >
                        <span className="font-mono tabular-nums">
                            {bytes} / {MAX_BYTES}
                        </span>{" "}
                        bytes
                        {bytesOver
                            ? ", too long, remove some tags."
                            : bytesWarn
                              ? ", approaching limit."
                              : "."}
                    </p>
                )}
            </div>

            <ActionButton
                kind="rename"
                busy={renaming}
                done={renamed}
                disabled={!newName || bytesOver}
                onClick={onRename}
            />

            {/* Optional conversion disclosure */}
            <Collapsible>
                <CollapsibleTrigger asChild>
                    <button
                        type="button"
                        className="group/optconv flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-1 px-1 -mx-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 w-fit"
                    >
                        <ChevronDown
                            size={14}
                            aria-hidden
                            className="transition-transform motion-safe:duration-200 motion-safe:ease-out group-data-[state=closed]/optconv:-rotate-90"
                        />
                        Convert to a different format
                    </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1">
                    <div className="pt-3 flex flex-col gap-3">
                        <ConversionPanel
                            formats={optionalConvertFormats}
                            format={safeConvertFormat}
                            quality={convertQuality}
                            deleteOriginal={deleteOriginal}
                            onFormatChange={onConvertFormatChange}
                            onQualityChange={onConvertQualityChange}
                            onDeleteChange={onDeleteOriginalChange}
                            checkboxId="delete-original-optional"
                        />
                        <ActionButton
                            kind="convert"
                            busy={converting}
                            done={converted}
                            onClick={onConvert}
                        />
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </>
    );
}

interface ActionButtonProps {
    kind: "rename" | "convert";
    busy: boolean;
    done: boolean;
    disabled?: boolean;
    onClick: () => void;
}

function ActionButton({
    kind,
    busy,
    done,
    disabled,
    onClick,
}: ActionButtonProps) {
    const label =
        kind === "rename"
            ? busy
                ? "Renaming"
                : done
                  ? "Renamed"
                  : "Rename file"
            : busy
              ? "Converting"
              : done
                ? "Converted"
                : "Convert file";
    const Icon = kind === "rename" ? PenLine : Repeat;
    return (
        <Button
            onClick={onClick}
            disabled={disabled || busy}
            className="h-12 w-full gap-2 text-base"
        >
            {busy ? (
                <Loader2 size={16} aria-hidden className="animate-spin" />
            ) : done ? (
                <Check size={18} aria-hidden />
            ) : (
                <Icon size={18} aria-hidden />
            )}
            {label}
        </Button>
    );
}

interface MetaFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    disabled?: boolean;
}

function MetaField({
    id,
    label,
    value,
    onChange,
    placeholder,
    disabled,
}: MetaFieldProps) {
    return (
        <>
            <label
                htmlFor={id}
                className="text-sm font-medium tracking-wide text-muted-foreground sm:text-right"
            >
                {label}
            </label>
            <Input
                id={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                className="h-9 disabled:opacity-50"
            />
        </>
    );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getExt(name: string): string {
    const m = name.match(/(\.[^.]+)$/);
    return m ? m[1] : "";
}

function byteLength(str: string): number {
    return new TextEncoder().encode(str).length;
}

function FileIcon({ ext }: { ext: string }) {
    if (NEEDS_CONVERSION_EXTS.has(ext))
        return (
            <AlertTriangle
                size={18}
                aria-hidden
                className="text-warning shrink-0 mt-0.5"
            />
        );
    if (METADATA_COMPATIBLE_EXTS.has(ext))
        return (
            <Music2
                size={18}
                aria-hidden
                className="text-success shrink-0 mt-0.5"
            />
        );
    return (
        <File
            size={18}
            aria-hidden
            className="text-muted-foreground shrink-0 mt-0.5"
        />
    );
}
