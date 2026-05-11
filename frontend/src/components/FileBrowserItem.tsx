import { AlertTriangle, File, Music2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
    METADATA_COMPATIBLE_EXTS,
    NEEDS_CONVERSION_EXTS,
} from "@/lib/audioFormats";
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
 * generic file otherwise), the filename, optional folder path, a
 * "convert" badge for incompatible formats, and a leading checkbox when
 * batch mode is on.
 *
 * Selection state and batch-toggle live in the parent (`FileBrowser`);
 * this component just renders and dispatches clicks.
 */
export default function FileBrowserItem({
    file,
    isSelected,
    batchMode,
    isBatchSelected,
    onClick,
    onBatchToggle,
}: FileBrowserItemProps) {
    const fileNeedsConversion =
        !!file.needs_conversion || NEEDS_CONVERSION_EXTS.has(file.ext);

    const highlight = batchMode ? isBatchSelected : isSelected;

    return (
        <div
            onClick={onClick}
            className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b border-border last:border-b-0 transition-colors ${
                highlight
                    ? "bg-primary/10 border-l-2 border-l-primary"
                    : "hover:bg-card"
            }`}
        >
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
                <div className="text-xs text-foreground truncate">
                    {file.name}
                </div>
                {file.folder && (
                    <div className="text-[10px] text-muted-foreground truncate">
                        {file.folder}
                    </div>
                )}
            </div>
            {fileNeedsConversion && (
                <span className="text-[9px] text-warning border border-warning/40 rounded px-1.5 py-0.5 shrink-0">
                    convert
                </span>
            )}
        </div>
    );
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
