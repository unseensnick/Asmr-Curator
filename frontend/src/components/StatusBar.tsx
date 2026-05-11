import { useEffect, useState } from "react";
import { apiGet, API } from "@/lib/api";

interface StatusBarProps {
    /** Vocabulary count, sourced from the App's dict state. */
    dictTagCount: number;
}

interface SystemInfo {
    model: string;
    version: string;
}

/**
 * Persistent footer strip showing dictionary size, the Ollama model in use,
 * and the app version. One line of muted, mono-numeric text — gives the
 * app a "system tool" feel without being terminal-coded.
 */
export default function StatusBar({ dictTagCount }: StatusBarProps) {
    const [info, setInfo] = useState<SystemInfo | null>(null);

    useEffect(() => {
        let cancelled = false;
        apiGet<SystemInfo>(API.systemInfo)
            .then((data) => {
                if (!cancelled) setInfo(data);
            })
            .catch(() => {
                if (!cancelled) setInfo({ model: "—", version: "—" });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <footer className="mt-12 pt-4 border-t border-border">
            <p className="text-[10px] text-muted-foreground tracking-[0.04em] flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                    dict:{" "}
                    <span className="font-mono tabular-nums text-foreground/80">
                        {dictTagCount}
                    </span>{" "}
                    tags
                </span>
                <span aria-hidden className="opacity-40">
                    ·
                </span>
                <span>
                    model:{" "}
                    <span className="font-mono text-foreground/80">
                        {info?.model ?? "…"}
                    </span>
                </span>
                <span aria-hidden className="opacity-40">
                    ·
                </span>
                <span>
                    <span className="font-mono text-foreground/80">
                        v{info?.version ?? "…"}
                    </span>
                </span>
            </p>
        </footer>
    );
}
