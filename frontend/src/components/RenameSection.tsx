import { AlertTriangle, ChevronDown } from "lucide-react";

import ConversionPanel from "@/components/ConversionPanel";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ConvertFormat, ConvertQuality, RenameSep } from "@/lib/types";

import { ActionButton, MetaField, ResetLink } from "./selectedFile/helpers";
import { MAX_BYTES } from "./selectedFile/utils";

interface RequiredConversionProps {
    converting: boolean;
    converted: boolean;
    convertFormat: ConvertFormat;
    convertQuality: ConvertQuality;
    deleteOriginal: boolean;
    convertBitrateKbps: number | null;
    powerMode: boolean;
    onConvertFormatChange: (f: ConvertFormat) => void;
    onConvertQualityChange: (q: ConvertQuality) => void;
    onDeleteOriginalChange: (v: boolean) => void;
    onConvertBitrateChange: (kbps: number | null) => void;
    onConvert: () => void;
}

export function RequiredConversion({
    converting,
    converted,
    convertFormat,
    convertQuality,
    deleteOriginal,
    convertBitrateKbps,
    powerMode,
    onConvertFormatChange,
    onConvertQualityChange,
    onDeleteOriginalChange,
    onConvertBitrateChange,
    onConvert,
}: RequiredConversionProps) {
    return (
        <>
            <div className="flex items-start gap-2 text-sm text-warning bg-warning/10 border border-warning/25 rounded-md px-3 py-2.5 leading-relaxed">
                <AlertTriangle size={16} aria-hidden className="shrink-0 mt-0.5" />
                <span>This file's format doesn't support embedded metadata. Convert it first.</span>
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
                powerMode={powerMode}
                bitrateKbps={convertBitrateKbps}
                onBitrateChange={onConvertBitrateChange}
            />
            <ActionButton kind="convert" busy={converting} done={converted} onClick={onConvert} />
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
    titleDirty: boolean;
    onResetTitle: () => void;
    onMetaTitleChange: (v: string) => void;
    onMetaArtistChange: (v: string) => void;
    onMetaAlbumChange: (v: string) => void;
    onMetaAlbumArtistChange: (v: string) => void;
    onLinkArtistsChange: (v: boolean) => void;
    newName: string | null;
    onNewNameChange: (v: string) => void;
    nameOverridden: boolean;
    onResetName: () => void;
    isMetadataOnly: boolean;
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
    convertBitrateKbps: number | null;
    powerMode: boolean;
    onConvertFormatChange: (f: ConvertFormat) => void;
    onConvertQualityChange: (q: ConvertQuality) => void;
    onDeleteOriginalChange: (v: boolean) => void;
    onConvertBitrateChange: (kbps: number | null) => void;
    converting: boolean;
    converted: boolean;
    onConvert: () => void;
}

export default function RenameSection(props: RenameSectionProps) {
    const {
        renameSep,
        onRenameSepChange,
        metaTitle,
        metaArtist,
        metaAlbum,
        metaAlbumArtist,
        linkArtists,
        titleDirty,
        onResetTitle,
        onMetaTitleChange,
        onMetaArtistChange,
        onMetaAlbumChange,
        onMetaAlbumArtistChange,
        onLinkArtistsChange,
        newName,
        onNewNameChange,
        nameOverridden,
        onResetName,
        isMetadataOnly,
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
        convertBitrateKbps,
        powerMode,
        onConvertFormatChange,
        onConvertQualityChange,
        onDeleteOriginalChange,
        onConvertBitrateChange,
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
                    onValueChange={(v) => v && onRenameSepChange(v as RenameSep)}
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
                    <label
                        htmlFor="meta-link-artists"
                        className="flex items-center gap-2 cursor-pointer select-none w-fit"
                    >
                        <Checkbox
                            id="meta-link-artists"
                            checked={linkArtists}
                            onCheckedChange={(v) => onLinkArtistsChange(v === true)}
                        />
                        <span className="text-sm text-muted-foreground">Same as artist</span>
                    </label>
                </div>
                {titleDirty && (
                    <div className="sm:col-start-2">
                        <ResetLink onClick={onResetTitle} label="Reset title to generated" />
                    </div>
                )}
            </div>

            {/* Filename — editable, so it can be shortened to fit the
             *  255-byte limit without touching the embedded title above. */}
            <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                    <label
                        htmlFor="rename-filename"
                        className="text-sm font-medium tracking-wide text-muted-foreground"
                    >
                        Will become
                    </label>
                    {nameOverridden && (
                        <ResetLink onClick={onResetName} label="Reset filename to generated" />
                    )}
                </div>
                {newName !== null ? (
                    <Input
                        id="rename-filename"
                        value={newName}
                        onChange={(e) => onNewNameChange(e.target.value)}
                        aria-invalid={bytesOver}
                        aria-describedby="rename-filename-bytes"
                        className="font-mono text-sm h-auto py-2.5 aria-invalid:border-destructive"
                    />
                ) : (
                    <div className="bg-muted/40 border border-border rounded-md px-3 py-2.5 font-mono text-sm leading-relaxed break-all min-h-10">
                        <span className="text-muted-foreground italic">
                            Generate a filename above first.
                        </span>
                    </div>
                )}
                {newName !== null && (
                    <p
                        id="rename-filename-bytes"
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
                            ? ", too long — shorten the filename here, the title above keeps its tags."
                            : bytesWarn
                              ? ", approaching limit."
                              : "."}
                    </p>
                )}
                {isMetadataOnly && !bytesOver && (
                    <p className="text-xs text-muted-foreground">
                        Filename already matches. Only the tags will be written.
                    </p>
                )}
            </div>

            <ActionButton
                kind={isMetadataOnly ? "metadata" : "rename"}
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
                            powerMode={powerMode}
                            bitrateKbps={convertBitrateKbps}
                            onBitrateChange={onConvertBitrateChange}
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
