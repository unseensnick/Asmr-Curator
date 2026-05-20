import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { API, apiPost, type FileRoot } from "@/lib/api";
import { FORMAT_EXT, NEEDS_CONVERSION_EXTS } from "@/lib/audioFormats";
import type { ConvertFormat, ConvertQuality, FileEntry, RenameSep } from "@/lib/types";
import { getErrorMessage, sanitizeFilename } from "@/lib/utils";

import MoveToLibrarySection from "./MoveToLibrarySection";
import RenameSection, { RequiredConversion } from "./RenameSection";
import { FileIcon } from "./selectedFile/helpers";
import { byteLength, getExt, MAX_BYTES } from "./selectedFile/utils";

interface SelectedFilePanelProps {
    selected: FileEntry;
    /** Rename + convert stay in this root; move always targets `library`. */
    root: FileRoot;
    outputDash: string;
    outputPipe: string;
    extractedArtist: string;
    convertFormat: ConvertFormat;
    convertQuality: ConvertQuality;
    deleteOriginal: boolean;
    /** Shared with LibraryExplorerSheet so the Move-to-library picker
     *  doesn't re-walk the tree per file. */
    librarySubdir: string;
    onLibrarySubdirChange: (subdir: string) => void;
    onConvertFormatChange: (f: ConvertFormat) => void;
    onConvertQualityChange: (q: ConvertQuality) => void;
    onDeleteOriginalChange: (v: boolean) => void;
    onDeselect: () => void;
    onSelectedChange: (next: FileEntry) => void;
    onListReload: () => void;
    /** Parent switches FileBrowser to Library tab and selects the moved file. */
    onMovedToLibrary: (toPath: string, name: string) => void;
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
    librarySubdir,
    onLibrarySubdirChange,
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

    // Pending state-reset timers (rename + convert "done" badges). Tracked
    // in refs so we can cancel them on unmount and avoid React's
    // "setState on unmounted component" warning.
    const renamedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const convertedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        return () => {
            if (renamedTimerRef.current) clearTimeout(renamedTimerRef.current);
            if (convertedTimerRef.current) clearTimeout(convertedTimerRef.current);
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

    // Pre-populate artist when a new file is selected OR a fresh extract
    // lands (Patreon / Screenshot). Mirrors the TagsEditor's
    // "from <artist>" caption — both are driven by the same
    // `extractedArtist` prop, so the rename form's artist field stays in
    // sync with what the user sees above.
    //
    // NOTE(unseensnick): the project's standard "sync editable state from
    // prop" pattern (same shape as the outputPipe→metaTitle effect above).
    // react-hooks/set-state-in-effect flags it because the source is a
    // prop in deps rather than a ref; the alternative would lose the
    // post-prop-arrival catch-up (only initial-file-pick refill would
    // work). Disabled line-targeted, matching how data-fetching effects
    // elsewhere in this file handle the rule.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- see NOTE above
        if (extractedArtist) setMetaArtist(extractedArtist);
    }, [selected.path, extractedArtist]);

    useEffect(() => {
        localStorage.setItem("linkArtists", String(linkArtists));
    }, [linkArtists]);

    // ── Derived state ────────────────────────────────────────────────────

    const needsConversion = !!selected.needs_conversion || NEEDS_CONVERSION_EXTS.has(selected.ext);

    const newName = (() => {
        const text = renameSep === "dash" ? outputDash : outputPipe;
        if (!text) return null;
        return sanitizeFilename(text) + getExt(selected.name);
    })();

    const bytes = newName ? byteLength(newName) : 0;
    const bytesOver = bytes > MAX_BYTES;
    const bytesWarn = bytes > 200 && !bytesOver;

    // For optional conversion, drop the current format from the choices.
    const optionalConvertFormats = (["mp3", "flac", "ogg"] as ConvertFormat[]).filter(
        (fmt) => FORMAT_EXT[fmt] !== selected.ext,
    );

    // Guard against showing optional convert in the current format.
    const safeConvertFormat =
        !needsConversion && FORMAT_EXT[convertFormat] === selected.ext
            ? (optionalConvertFormats[0] ?? "mp3")
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
                    album_artist: linkArtists ? metaArtist : metaAlbumArtist,
                },
            });
            onSelectedChange({
                ...selected,
                path: data.path,
                name: data.new_name,
            });
            setRenamed(true);
            if (renamedTimerRef.current) clearTimeout(renamedTimerRef.current);
            renamedTimerRef.current = setTimeout(() => setRenamed(false), 2500);
            // Surface the partial-success path: rename committed, metadata
            // embed didn't. The file is on disk under the new name, but the
            // user expected tags written too.
            if (data.metadata_error) {
                onError(`Renamed, but metadata embed failed: ${data.metadata_error}`);
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
            const quality = convertFormat === "flac" ? "lossless" : convertQuality;
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
            if (convertedTimerRef.current) clearTimeout(convertedTimerRef.current);
            convertedTimerRef.current = setTimeout(() => setConverted(false), 2500);
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
                 * during the move (one server call instead of two) along
                 * with the metadata tags below. */
                pendingNewName={newName && !bytesOver && newName !== selected.name ? newName : null}
                pendingMetadata={{
                    title: metaTitle,
                    artist: metaArtist,
                    album: metaAlbum,
                    album_artist: linkArtists ? metaArtist : metaAlbumArtist,
                }}
                subdir={librarySubdir}
                onSubdirChange={onLibrarySubdirChange}
                onMoved={(toPath, name) => {
                    onListReload();
                    onMovedToLibrary(toPath, name);
                }}
                onError={onError}
            />
        </div>
    );
}
