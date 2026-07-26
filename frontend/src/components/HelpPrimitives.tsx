import type { ReactNode } from "react";

/**
 * Presentational building blocks shared by the Help sheet's topics.
 *
 * Split out of `HelpSheet.tsx` so an optional private topic can reuse them
 * without importing the sheet itself. Importing the sheet would either form a
 * cycle (the sheet lists the private topics) or pull its lazy-loaded chunk into
 * the main bundle, since the private domain is discovered eagerly.
 */

export function TopicHeader({ title, lede }: { title: string; lede: string }) {
    return (
        <div className="flex flex-col gap-1.5 mb-5">
            <h2 className="text-base font-medium tracking-wide text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">{lede}</p>
        </div>
    );
}

export function HelpCard({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
    return (
        <div className="flex flex-col gap-1 px-3 py-2.5 rounded-md border border-border bg-background">
            <div className="flex items-center gap-2 text-foreground/90">
                <span className="text-muted-foreground/80">{icon}</span>
                <span className="text-sm font-medium">{title}</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">{body}</p>
        </div>
    );
}
