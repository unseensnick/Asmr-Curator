import { X } from "lucide-react";

import CookiePane from "@/components/dictionary/CookiePane";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetTitle,
} from "@/components/ui/sheet";

interface CookiesSheetProps {
    open: boolean;
    onClose: () => void;
}

/**
 * Standalone slide-over for cookie management. Lifts CookiePane out of
 * the old Tag Dictionary modal where it lived as an IA mismatch — auth
 * state has no conceptual reason to share a surface with vocabulary
 * editing. Opened from the Settings dropdown.
 *
 * Right-side Sheet matches the Library settings overlay so the two
 * settings surfaces feel like the same primitive. CookiePane internally
 * uses a flex column with a sticky bottom and a scrollable middle, so
 * the Sheet's `h-full flex flex-col` content frame is what makes that
 * scroll actually engage.
 */
export default function CookiesSheet({ open, onClose }: CookiesSheetProps) {
    return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
            <SheetContent
                className="w-full sm:max-w-xl overflow-hidden"
                showCloseButton={false}
            >
                <SheetTitle className="sr-only">Cookies</SheetTitle>
                <SheetDescription className="sr-only">
                    Patreon and Google session cookies for the URL fetch and
                    Drive download workflows.
                </SheetDescription>

                <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
                    <span className="text-sm font-medium tracking-wide text-foreground">
                        Cookies
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        aria-label="Close cookies"
                        title="Close"
                    >
                        <X size={18} aria-hidden />
                    </button>
                </div>

                <CookiePane open={open} />
            </SheetContent>
        </Sheet>
    );
}
