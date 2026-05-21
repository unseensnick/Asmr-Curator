import type { ComponentType, ReactNode } from "react";

interface EmptyStateProps {
    icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean; className?: string }>;
    /** Short headline. Plain English, librarian voice. */
    title: ReactNode;
    /** Optional secondary line under the headline. The "what to do next" prompt. */
    hint?: ReactNode;
    /** Optional inline action — a button or anchor element. */
    action?: ReactNode;
    /** Extra className to override centering / spacing per call site. */
    className?: string;
}

/**
 * Canonical empty-state shape. Calm, centered, single icon + headline +
 * one-line hint + optional inline action. Reserved for "this surface has
 * nothing yet" states; loading and error use their own shapes
 * (RecoverableErrorBanner / inline spinners).
 */
export default function EmptyState({
    icon: Icon,
    title,
    hint,
    action,
    className,
}: EmptyStateProps) {
    return (
        <div
            className={
                "flex flex-col items-center justify-center gap-3 py-10 px-6 text-center " +
                (className ?? "")
            }
        >
            {Icon && <Icon size={20} aria-hidden className="text-muted-foreground/60" />}
            <p className="text-sm text-foreground/80 leading-relaxed max-w-prose">{title}</p>
            {hint && (
                <p className="text-xs text-muted-foreground leading-relaxed max-w-prose">{hint}</p>
            )}
            {action && <div className="mt-1">{action}</div>}
        </div>
    );
}
