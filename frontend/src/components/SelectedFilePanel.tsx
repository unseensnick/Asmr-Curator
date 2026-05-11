import {
    AlertTriangle,
    Check,
    ChevronDown,
    ChevronRight,
    File,
    Music2,
    PenLine,
    Repeat,
    X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ConversionPanel from "@/components/ConversionPanel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiPost, API } from "@/lib/api";
import {
    FORMAT_EXT,
    METADATA_COMPATIBLE_EXTS,
    NEEDS_CONVERSION_EXTS,
} from "@/lib/audioFormats";
import type {
    ConvertFormat,
    ConvertQuality,
    FileEntry,
    RenameSep,
} from "@/lib/types";
import { getErrorMessage, sanitizeFilename } from "@/lib/utils";

const MAX_BYTES = 255;

interface SelectedFilePanelProps {
    selected: FileEntry;
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
    /** Surface fatal errors back up to the FileBrowser banner. */
    onError: (msg: string) => void;
}

interface RenameResponse {
    path: string;
    new_name: string;
}

interface ConvertResponse {
    path: string;
    new_name: string;
}

/**
 * Work area for a single selected file: shows file metadata, lets the
 * user fill in ID3/FLAC/MP4 metadata fields, choose a rename separator,
 * preview the resulting filename with byte counter, and either rename
 * (when format is metadata-compatible) or convert (when not).
 *
 * Owns all rename/convert UI state internally — only conversion
 * preferences are lifted up to FileBrowser since the batch panel
 * shares them.
 */
export default function SelectedFilePanel({
    selected,
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
    onError,
}: SelectedFilePanelProps) {
    const [renameSep, setRenameSep] = useState<RenameSep>("dash");
    const [renaming, setRenaming] = useState(false);
    const [renamed, setRenamed] = useState(false);
    const [converting, setConverting] = useState(false);
    const [converted, setConverted] = useState(false);
    const [showOptionalConvert, setShowOptionalConvert] = useState(false);

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
    // Note: ESLint's react-hooks/set-state-in-effect doesn't fire here because
    // the call is guarded by a conditional — kept as-is.
    useEffect(() => {
        if (extractedArtistRef.current)
            setMetaArtist(extractedArtistRef.current);
    }, [selected.path]);

    useEffect(() => {
        localStorage.setItem("linkArtists", String(linkArtists));
    }, [linkArtists]);

    // ── Derived state ────────────────────────────────────────────────────────

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

    // ── Actions ──────────────────────────────────────────────────────────────

    async function handleRename() {
        if (!newName || bytesOver || needsConversion) return;
        setRenaming(true);
        onError("");
        try {
            const data = await apiPost<RenameResponse>(API.rename, {
                path: selected.path,
                new_name: newName,
                metadata: {
                    title: metaTitle,
                    artist: metaArtist,
                    album: metaAlbum,
                    album_artist: linkArtists ? metaArtist : metaAlbumArtist,
                },
            });
            onSelectedChange({
                ...selected,
                path: data.path,
                name: data.new_name,
            });
            setRenamed(true);
            setTimeout(() => setRenamed(false), 2500);
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
            const quality = convertFormat === "flac" ? "lossless" : convertQuality;
            const data = await apiPost<ConvertResponse>(API.convert, {
                path: selected.path,
                output_format: convertFormat,
                quality,
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
            setShowOptionalConvert(false);
            setTimeout(() => setConverted(false), 2500);
            onListReload();
        } catch (e) {
            onError("Conversion failed: " + getErrorMessage(e));
        } finally {
            setConverting(false);
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="mt-3 border border-border rounded-lg p-3 bg-secondary/50">
            {/* Selected file info */}
            <div className="flex items-center gap-2.5 mb-3">
                <FileIcon ext={selected.ext} />
                <div className="flex-1 min-w-0">
                    <div className="text-xs text-foreground font-medium truncate">
                        {selected.name}
                    </div>
                    {selected.folder && (
                        <div className="text-[10px] text-muted-foreground truncate">
                            {selected.folder}/{selected.name}
                        </div>
                    )}
                </div>
                <button
                    onClick={onDeselect}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    title="Deselect"
                >
                    <X size={14} />
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
                    showOptionalConvert={showOptionalConvert}
                    onShowOptionalConvertChange={setShowOptionalConvert}
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
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-views: kept in the same file because they have no value outside it
// and the props plumbing would otherwise be more boilerplate than benefit.
// ─────────────────────────────────────────────────────────────────────────────

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
}: {
    converting: boolean;
    converted: boolean;
    convertFormat: ConvertFormat;
    convertQuality: ConvertQuality;
    deleteOriginal: boolean;
    onConvertFormatChange: (f: ConvertFormat) => void;
    onConvertQualityChange: (q: ConvertQuality) => void;
    onDeleteOriginalChange: (v: boolean) => void;
    onConvert: () => void;
}) {
    return (
        <>
            <div className="flex items-center gap-1.5 text-[11px] text-warning mb-3 bg-warning/10 border border-warning/25 rounded px-2.5 py-2">
                <AlertTriangle size={13} className="shrink-0" />
                This format must be converted before it can be renamed
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
            <Button
                className={`w-full gap-2 ${
                    converted
                        ? "bg-success/20 border-success/40 text-success hover:bg-success/20"
                        : ""
                }`}
                disabled={converting}
                onClick={onConvert}
            >
                {converting ? (
                    <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                ) : converted ? (
                    <Check size={16} />
                ) : (
                    <Repeat size={16} />
                )}
                {converting ? "Converting…" : converted ? "Converted!" : "Convert File"}
            </Button>
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
    showOptionalConvert: boolean;
    onShowOptionalConvertChange: (v: boolean) => void;
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
        showOptionalConvert,
        onShowOptionalConvertChange,
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
            <div className="flex items-center gap-2 mb-2.5">
                <span className="text-[10px] text-muted-foreground tracking-[0.06em]">
                    Use separator:
                </span>
                <ToggleGroup
                    type="single"
                    value={renameSep}
                    onValueChange={(v) => v && onRenameSepChange(v as RenameSep)}
                    className="border border-input rounded-3xl overflow-hidden gap-0"
                >
                    {(["dash", "pipe"] as RenameSep[]).map((sep) => (
                        <ToggleGroupItem
                            key={sep}
                            value={sep}
                            className="text-[10px] tracking-[0.06em] px-2.5 py-1 h-auto rounded-none! border-r border-input last:border-r-0 bg-card text-muted-foreground hover:bg-primary/10 hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                        >
                            {sep === "dash" ? "— dash" : "| pipe"}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </div>

            {/* Metadata fields */}
            <div className="grid grid-cols-[5rem_1fr] gap-x-2.5 gap-y-1.5 mb-2.5 items-center">
                <span className="text-[10px] text-muted-foreground">Title</span>
                <Input
                    value={metaTitle}
                    onChange={(e) => onMetaTitleChange(e.target.value)}
                    placeholder="Track title"
                    className="h-6 text-[11px] px-2"
                />
                <span className="text-[10px] text-muted-foreground">Artist</span>
                <Input
                    value={metaArtist}
                    onChange={(e) => onMetaArtistChange(e.target.value)}
                    placeholder="Artist name"
                    className="h-6 text-[11px] px-2"
                />
                <span className="text-[10px] text-muted-foreground">Album</span>
                <Input
                    value={metaAlbum}
                    onChange={(e) => onMetaAlbumChange(e.target.value)}
                    placeholder="Album name"
                    className="h-6 text-[11px] px-2"
                />
                <span className="text-[10px] text-muted-foreground">Album Artist</span>
                <Input
                    value={linkArtists ? metaArtist : metaAlbumArtist}
                    onChange={(e) => onMetaAlbumArtistChange(e.target.value)}
                    placeholder="Album artist"
                    disabled={linkArtists}
                    className="h-6 text-[11px] px-2 disabled:opacity-40"
                />
                <div className="col-span-2 flex items-center gap-2">
                    <Checkbox
                        id="link-artists"
                        checked={linkArtists}
                        onCheckedChange={(v) => onLinkArtistsChange(v === true)}
                    />
                    <label
                        htmlFor="link-artists"
                        className="text-[10px] text-muted-foreground cursor-pointer select-none"
                    >
                        Same as Artist
                    </label>
                </div>
            </div>

            {/* Rename preview */}
            <div className="text-[11px] bg-card border border-border rounded px-2.5 py-2 mb-1.5 min-h-8 break-all leading-relaxed">
                {newName ? (
                    <>
                        <span className="text-muted-foreground">→ </span>
                        <span className="text-success">{newName}</span>
                    </>
                ) : (
                    <span className="text-muted-foreground italic">
                        Generate a filename above first
                    </span>
                )}
            </div>

            {/* Byte counter */}
            {newName && (
                <p
                    className={`text-[10px] mb-2.5 ${
                        bytesOver
                            ? "text-destructive"
                            : bytesWarn
                              ? "text-warning"
                              : "text-muted-foreground"
                    }`}
                >
                    {bytes} / {MAX_BYTES} bytes
                    {bytesOver
                        ? " — too long, remove some tags"
                        : bytesWarn
                          ? " — approaching limit"
                          : ""}
                </p>
            )}

            {/* Rename button */}
            <Button
                className={`w-full gap-2 ${
                    renamed
                        ? "bg-success/20 border-success/40 text-success hover:bg-success/20"
                        : ""
                }`}
                disabled={!newName || bytesOver || renaming}
                onClick={onRename}
            >
                {renaming ? (
                    <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                ) : renamed ? (
                    <Check size={16} />
                ) : (
                    <PenLine size={16} />
                )}
                {renaming ? "Renaming…" : renamed ? "Renamed!" : "Rename File"}
            </Button>

            {/* Optional conversion section */}
            <div className="mt-3 border-t border-border pt-3">
                <button
                    onClick={() => onShowOptionalConvertChange(!showOptionalConvert)}
                    className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                    {showOptionalConvert ? (
                        <ChevronDown size={12} className="shrink-0" />
                    ) : (
                        <ChevronRight size={12} className="shrink-0" />
                    )}
                    Convert to a different format
                    <span className="ml-1 text-[9px] opacity-50">(optional)</span>
                </button>

                {showOptionalConvert && (
                    <div className="mt-2.5">
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
                        <Button
                            className={`w-full gap-2 ${
                                converted
                                    ? "bg-success/20 border-success/40 text-success hover:bg-success/20"
                                    : ""
                            }`}
                            disabled={converting}
                            onClick={onConvert}
                        >
                            {converting ? (
                                <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                            ) : converted ? (
                                <Check size={16} />
                            ) : (
                                <Repeat size={16} />
                            )}
                            {converting ? "Converting…" : converted ? "Converted!" : "Convert File"}
                        </Button>
                    </div>
                )}
            </div>
        </>
    );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
            <AlertTriangle size={18} className="text-warning shrink-0" />
        );
    if (METADATA_COMPATIBLE_EXTS.has(ext))
        return <Music2 size={18} className="text-success shrink-0" />;
    return <File size={18} className="text-muted-foreground shrink-0" />;
}
