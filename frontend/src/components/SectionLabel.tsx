import { type ReactNode } from "react";

type SectionLabelTone = "primary" | "success" | "warning" | "info";

interface SectionLabelProps {
    children: ReactNode;
    /** Color of the leading dot. Defaults to `primary` (teal). */
    tone?: SectionLabelTone;
    /** Optional trailing copy in muted small text — appears after the label. */
    hint?: ReactNode;
    /** Extra className for the wrapper, mostly for margin overrides. */
    className?: string;
}

const TONE_TO_BG: Record<SectionLabelTone, string> = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    info: "bg-info",
};

/**
 * Card-header label: small caps tracking-wide muted text, with a leading
 * colored dot. Shared across `OutputPanel`, `TagsEditor`,
 * `LibrarySettingsSheet`, and `FileBrowser` (where each card opens with
 * the same pattern).
 */
export default function SectionLabel({
    children,
    tone = "primary",
    hint,
    className = "",
}: SectionLabelProps) {
    return (
        <div
            className={`flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground ${className}`}
        >
            <span
                aria-hidden
                className={`size-1.5 rounded-full shrink-0 ${TONE_TO_BG[tone]}`}
            />
            {children}
            {hint && (
                <span className="opacity-45 text-[9px] tracking-[0.08em] font-medium normal-case">
                    {hint}
                </span>
            )}
        </div>
    );
}
