import type { ReactNode } from "react";
import { X } from "lucide-react";

interface SheetHeaderBarProps {
    /** Title text shown left-aligned. Sheet-titled, sentence case. */
    title: ReactNode;
    /** Accessible label on the close X. The five existing sheets each have
     *  their own ("Close cookies", "Close dictionary", etc.). */
    closeLabel: string;
    onClose: () => void;
    /** Slot rendered between the title and the close X. Most sheets render
     *  nothing here; BulkEditSheet has a Dictionary button, LibraryExplorerSheet
     *  has a count badge + Refresh icon. Anything passed here flows in the
     *  same row at the right side of the title. */
    children?: ReactNode;
}

/**
 * Shared header bar for the right-side Sheets. Five sheets — Cookies, Help,
 * Library settings, Bulk edit, Library explorer — open with the same close-X
 * + spacing shape (only the title text and any per-sheet right-slot actions
 * differ). One source of truth for the chrome.
 */
export default function SheetHeaderBar({
    title,
    closeLabel,
    onClose,
    children,
}: SheetHeaderBarProps) {
    return (
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
            <span className="text-sm font-medium tracking-wide text-foreground">{title}</span>
            {children}
            <button
                type="button"
                onClick={onClose}
                className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                aria-label={closeLabel}
            >
                <X size={18} aria-hidden />
            </button>
        </div>
    );
}
