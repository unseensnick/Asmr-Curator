import { AlertTriangle, File, Music2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { METADATA_COMPATIBLE_EXTS, NEEDS_CONVERSION_EXTS } from "@/lib/audioFormats";
import type { FileEntry } from "@/lib/types";

interface FileBrowserItemProps {
    file: FileEntry;
    isSelected: boolean;
    batchMode: boolean;
    isBatchSelected: boolean;
    onClick: () => void;
    onBatchToggle: () => void;
}

/**
 * One row in the file list. Renders the appropriate icon for the file's
 * format (warning for needs-conversion, music note for metadata-compatible,
 * generic file otherwise), the filename in mono (it IS the data), an
 * optional folder path in mono below, a "convert" warning hint for
 * incompatible formats, and a leading checkbox in batch mode.
 *
 * Selection / batch-toggle state lives in the parent (`FileBrowser`); this
 * component just renders and dispatches clicks. Selected state uses a
 * full-row warm tint (`bg-accent/40`), NOT the older `border-l` stripe
 * (banned).
 *
 * A hover tooltip surfaces the full filename + folder path so long names
 * that the row truncates stay legible without a selection or right-click.
 * The delay (`delayDuration={500}`) keeps the tooltip from popping on
 * every pointer fly-over.
 */
export default function FileBrowserItem({
    file,
    isSelected,
    batchMode,
    isBatchSelected,
    onClick,
    onBatchToggle,
}: FileBrowserItemProps) {
    const fileNeedsConversion = !!file.needs_conversion || NEEDS_CONVERSION_EXTS.has(file.ext);

    const highlight = batchMode ? isBatchSelected : isSelected;
    const rowClass = highlight
        ? "flex items-center gap-3 px-3 py-2.5 cursor-pointer border-b border-border last:border-b-0 transition-colors bg-accent/40 text-foreground"
        : "flex items-center gap-3 px-3 py-2.5 cursor-pointer border-b border-border last:border-b-0 transition-colors hover:bg-muted/60";

    return (
        <TooltipProvider delayDuration={500}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div onClick={onClick} className={rowClass}>
                        {batchMode && (
                            <Checkbox
                                checked={isBatchSelected}
                                onCheckedChange={onBatchToggle}
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0"
                            />
                        )}
                        <FileIcon ext={file.ext} />
                        <div className="flex-1 min-w-0">
                            <div className="font-mono text-sm text-foreground truncate">
                                {file.name}
                            </div>
                            {file.folder && (
                                <div className="font-mono text-xs text-muted-foreground truncate">
                                    {file.folder}
                                </div>
                            )}
                        </div>
                        {fileNeedsConversion && (
                            <span className="text-xs text-warning shrink-0">Convert</span>
                        )}
                    </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-md">
                    <div className="flex flex-col gap-0.5 font-mono text-left">
                        <span className="break-all">{file.name}</span>
                        {file.folder && (
                            <span className="text-background/70 break-all">{file.folder}/</span>
                        )}
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

function FileIcon({ ext }: { ext: string }) {
    if (NEEDS_CONVERSION_EXTS.has(ext))
        return <AlertTriangle size={18} aria-hidden className="text-warning shrink-0" />;
    if (METADATA_COMPATIBLE_EXTS.has(ext))
        return <Music2 size={18} aria-hidden className="text-success shrink-0" />;
    return <File size={18} aria-hidden className="text-muted-foreground shrink-0" />;
}
