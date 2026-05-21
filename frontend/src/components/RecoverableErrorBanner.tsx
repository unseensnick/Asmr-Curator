import type { ReactNode } from "react";

interface RecoverableErrorBannerProps {
    /** The message shown to the user. Plain English; the librarian voice. */
    message: ReactNode;
    /** Label on the inline action button (typically "Retry", sometimes
     *  "Dismiss" or a workflow-specific verb). */
    actionLabel?: string;
    /** Callback for the inline action. Omit both this and `actionLabel` to
     *  render the banner without an action (display-only). */
    onAction?: () => void;
    /** Optional extra className to stretch the banner inside a flex layout. */
    className?: string;
}

/**
 * Quiet warning surface for recoverable load / save errors. Warm-amber
 * border + tinted background, body-tone text, inline action button. This
 * is the canonical shape for "thing didn't work, try again" feedback —
 * destructive (warm red) is reserved for irreversible actions, not for
 * "the dictionary didn't load." Use this wherever a load / save / fetch
 * failure would surface to the user.
 */
export default function RecoverableErrorBanner({
    message,
    actionLabel,
    onAction,
    className,
}: RecoverableErrorBannerProps) {
    return (
        <div
            role="alert"
            className={
                "flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground/90 " +
                (className ?? "")
            }
        >
            <span className="flex-1 leading-relaxed">{message}</span>
            {actionLabel && onAction && (
                <button
                    type="button"
                    onClick={onAction}
                    className="font-medium text-foreground hover:text-primary transition-colors underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded"
                >
                    {actionLabel}
                </button>
            )}
        </div>
    );
}
