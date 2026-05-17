import { Check, Loader2, X } from "lucide-react";
import { type ReactNode } from "react";

type StatusTone = "success" | "error" | "muted" | "info";

interface StatusLineProps {
    /** Visual style + leading icon. Defaults to `muted`. */
    tone?: StatusTone;
    /** Show a spinner instead of the tone icon (for in-flight states). */
    loading?: boolean;
    /** Extra className for the wrapper, mostly for margin overrides. */
    className?: string;
    children: ReactNode;
}

const TONE_TO_COLOR: Record<StatusTone, string> = {
    success: "text-success",
    error: "text-destructive",
    muted: "text-muted-foreground",
    info: "text-info",
};

/**
 * Inline status feedback line — short transient message used near the
 * bottom of cards after an async action completes ("Saved", "Cookie set",
 * "Cookie cleared"). Replaces the duplicated `<p>` blocks in the
 * ScreenshotPanel, PatreonPanel, CookiePane and DictionaryTester.
 *
 * For persistent results that need a structured preview, keep the inline
 * JSX in the consuming component — this is for one-line transient text.
 */
export default function StatusLine({
    tone = "muted",
    loading = false,
    className = "",
    children,
}: StatusLineProps) {
    return (
        <div
            role="status"
            className={`flex items-center gap-1.5 text-[11px] min-h-4 ${TONE_TO_COLOR[tone]} ${className}`}
        >
            {loading ? (
                <Loader2 size={12} aria-hidden className="animate-spin shrink-0" />
            ) : tone === "success" ? (
                <Check size={12} className="shrink-0" aria-hidden />
            ) : tone === "error" ? (
                <X size={12} className="shrink-0" aria-hidden />
            ) : null}
            <span>{children}</span>
        </div>
    );
}
