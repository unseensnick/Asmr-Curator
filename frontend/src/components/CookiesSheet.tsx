import CookiePane from "@/components/dictionary/CookiePane";
import SheetHeaderBar from "@/components/SheetHeaderBar";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

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
            <SheetContent className="w-full sm:max-w-xl overflow-hidden" showCloseButton={false}>
                <SheetTitle className="sr-only">Cookies</SheetTitle>
                <SheetDescription className="sr-only">
                    Patreon and Google session cookies for the URL fetch and Drive download
                    workflows.
                </SheetDescription>

                <SheetHeaderBar title="Cookies" closeLabel="Close cookies" onClose={onClose} />

                <CookiePane open={open} />
            </SheetContent>
        </Sheet>
    );
}
