import { X } from "lucide-react";

import SectionLabel from "@/components/SectionLabel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { FileEntry } from "@/lib/types";

export type BulkEditRoot = "library" | "downloads";

interface BulkEditSheetProps {
    open: boolean;
    onClose: () => void;
    /**
     * Files the user picked in the FileBrowser. The button that opens this
     * surface only appears for 2+, but the component handles 0/1 gracefully
     * so a stale-state open at the wrong moment doesn't surface as a crash.
     */
    files: FileEntry[];
    /**
     * Root the selection lives under. Passed through to
     * `/api/files/load-cached-metadata` and `/api/files/bulk-write` so the
     * backend resolves paths against the right side of the bind-mount.
     */
    root: BulkEditRoot;
}

/**
 * Bulk metadata + optional canonical rename across a selection of audio
 * files. Right-side slide-over matching `CookiesSheet`, `HelpSheet`, and
 * `LibrarySettingsSheet` — calm chrome, three vertical sections (per-file
 * details, apply-to-all, rename), sticky footer with a Cancel + the gated
 * Preview-changes commit.
 *
 * This commit lands the structural shell only. The editable per-file table
 * (phase 4), the apply-to-all form (phase 5), the load-from-cache wiring
 * (phase 6), and the dry-run rename preview (phase 7) fill the sections
 * in. Phase 8 lands the toolbar button that actually opens this; until
 * then the sheet is wired but unreachable from the UI.
 */
export default function BulkEditSheet({ open, onClose, files, root: _root }: BulkEditSheetProps) {
    const count = files.length;
    const fileWord = count === 1 ? "file" : "files";

    return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
            <SheetContent
                className="w-full sm:max-w-2xl lg:max-w-3xl xl:max-w-4xl overflow-hidden"
                showCloseButton={false}
            >
                <SheetTitle className="sr-only">Bulk edit</SheetTitle>
                <SheetDescription className="sr-only">
                    Edit metadata across {count} selected {fileWord} and optionally rename to a
                    canonical format.
                </SheetDescription>

                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
                    <span className="text-sm font-medium tracking-wide text-foreground">
                        Bulk edit
                    </span>
                    <span className="text-sm text-muted-foreground" aria-live="polite">
                        {count} {fileWord}
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        aria-label="Close bulk edit"
                        title="Close"
                    >
                        <X size={18} aria-hidden />
                    </button>
                </div>

                {/* Body (scrollable) */}
                <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-7">
                    <section aria-label="Per-file details" className="flex flex-col gap-3">
                        <SectionLabel>Per-file details</SectionLabel>
                        {/* phase 4: per-file editable table (title + tags per row) */}
                    </section>

                    <section aria-label="Apply to all" className="flex flex-col gap-3">
                        <SectionLabel>Apply to all</SectionLabel>
                        {/* phase 5: shared artist / album artist / album / suffix form */}
                    </section>

                    <section aria-label="Rename" className="flex flex-col gap-3">
                        <SectionLabel>Rename</SectionLabel>
                        {/* phase 7: rename toggle + dry-run preview pane */}
                    </section>
                </div>

                {/* Footer — Cancel + the gated commit. Preview-changes stays
                    disabled until phases 4-7 surface an edited value to act on. */}
                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="default"
                        size="sm"
                        disabled
                        aria-label="Preview changes (no edits to commit yet)"
                    >
                        Preview changes
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
