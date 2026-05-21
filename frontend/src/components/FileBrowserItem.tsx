import { memo, useEffect, useRef } from "react";
import { AlertTriangle, File, Music2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { METADATA_COMPATIBLE_EXTS, NEEDS_CONVERSION_EXTS } from "@/lib/audioFormats";
import type { FileEntry } from "@/lib/types";

interface FileBrowserItemProps {
    file: FileEntry;
    isSelected: boolean;
    batchMode: boolean;
    isBatchSelected: boolean;
    /** Parent receives both the row's file and the click modifiers, so the
     *  handler doesn't have to close over `file` per row (which would mint
     *  a fresh function per render and defeat memoization). */
    onClick: (file: FileEntry, modifiers: { shift: boolean; toggle: boolean }) => void;
    onBatchToggle: (path: string) => void;
    /** Inline rename: Enter / blur commit, Escape aborts. Matches
     *  LibraryExplorerSheet's rename UX. */
    renaming?: boolean;
    renameValue?: string;
    onRenameChange?: (next: string) => void;
    onRenameSubmit?: () => void;
    onRenameCancel?: () => void;
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
function FileBrowserItemImpl({
    file,
    isSelected,
    batchMode,
    isBatchSelected,
    onClick,
    onBatchToggle,
    renaming = false,
    renameValue = "",
    onRenameChange,
    onRenameSubmit,
    onRenameCancel,
}: FileBrowserItemProps) {
    const fileNeedsConversion = !!file.needs_conversion || NEEDS_CONVERSION_EXTS.has(file.ext);

    const highlight = batchMode ? isBatchSelected : isSelected;
    // min-h-14 keeps single-line rows (Library subdir listing, empty
    // folder field) the same height as 2-line rows in recursive search /
    // Downloads so row rhythm is consistent across tabs.
    const rowClass = highlight
        ? "flex items-center gap-3 px-3 py-2.5 min-h-14 cursor-pointer border-b border-border last:border-b-0 transition-colors bg-accent/40 text-foreground"
        : "flex items-center gap-3 px-3 py-2.5 min-h-14 cursor-pointer border-b border-border last:border-b-0 transition-colors hover:bg-muted/60";

    const renameInputRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
        if (!renaming) return;
        // Focus + select the basename (everything up to the last dot)
        // so the user can type a new title without clobbering the
        // extension.
        const el = renameInputRef.current;
        if (!el) return;
        el.focus();
        const dot = el.value.lastIndexOf(".");
        if (dot > 0) el.setSelectionRange(0, dot);
        else el.select();
    }, [renaming]);

    if (renaming) {
        return (
            <div
                className={rowClass.replace("cursor-pointer", "cursor-text")}
                data-entry-path={file.path}
            >
                <FileIcon ext={file.ext} />
                {/* min-w-0 so a long pre-filled rename value can't push the
                    row past its grid column and reflow the list. */}
                <div className="flex-1 min-w-0">
                    <Input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => onRenameChange?.(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                onRenameSubmit?.();
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                onRenameCancel?.();
                            }
                        }}
                        onBlur={() => onRenameSubmit?.()}
                        aria-label={`Rename ${file.name}`}
                        className="w-full h-8 font-mono text-sm"
                    />
                </div>
            </div>
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div
                    role="button"
                    tabIndex={0}
                    // data-entry-path is the hit-test contract for
                    // `useDragSelect` — the rubber-band hook walks
                    // these to figure out which rows fall inside the
                    // dragged rectangle.
                    data-entry-path={file.path}
                    onClick={(e) =>
                        onClick(file, {
                            shift: e.shiftKey,
                            toggle: e.ctrlKey || e.metaKey,
                        })
                    }
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onClick(file, {
                                shift: e.shiftKey,
                                toggle: e.ctrlKey || e.metaKey,
                            });
                        }
                    }}
                    className={rowClass}
                >
                    {batchMode && (
                        <Checkbox
                            checked={isBatchSelected}
                            onCheckedChange={() => onBatchToggle(file.path)}
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
    );
}

/** Custom equality so parent re-renders (drag mousemove, batch set
 *  identity churn) don't re-render every row. Callback props must be
 *  stable refs from the parent — see FileBrowser's useCallback wrappers. */
function arePropsEqual(prev: FileBrowserItemProps, next: FileBrowserItemProps): boolean {
    return (
        prev.file === next.file &&
        prev.isSelected === next.isSelected &&
        prev.batchMode === next.batchMode &&
        prev.isBatchSelected === next.isBatchSelected &&
        prev.renaming === next.renaming &&
        prev.renameValue === next.renameValue &&
        prev.onClick === next.onClick &&
        prev.onBatchToggle === next.onBatchToggle &&
        prev.onRenameChange === next.onRenameChange &&
        prev.onRenameSubmit === next.onRenameSubmit &&
        prev.onRenameCancel === next.onRenameCancel
    );
}

const FileBrowserItem = memo(FileBrowserItemImpl, arePropsEqual);
export default FileBrowserItem;

function FileIcon({ ext }: { ext: string }) {
    if (NEEDS_CONVERSION_EXTS.has(ext))
        return <AlertTriangle size={18} aria-hidden className="text-warning shrink-0" />;
    if (METADATA_COMPATIBLE_EXTS.has(ext))
        return <Music2 size={18} aria-hidden className="text-success shrink-0" />;
    return <File size={18} aria-hidden className="text-muted-foreground shrink-0" />;
}
