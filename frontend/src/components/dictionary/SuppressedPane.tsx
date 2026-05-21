import { useEffect, useRef, useState } from "react";
import { Info, ShieldOff, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API, apiDelete, apiPost } from "@/lib/api";
import type { SuppressedTerm } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface SuppressedPaneProps {
    suppressed: SuppressedTerm[];
    quickFill?: string;
    onQuickFillConsumed: () => void;
    onChange: (suppressed: SuppressedTerm[]) => void;
}

/**
 * Suppressed-terms tab body. Terms here are silently dropped from any tag
 * output, used for noisy OCR artefacts or format identifiers (`f4a`,
 * `tolovers`, etc.) that should never appear as tags. Compact chip wrap;
 * each chip has an always-visible remove button.
 */
export default function SuppressedPane({
    suppressed,
    quickFill,
    onQuickFillConsumed,
    onChange,
}: SuppressedPaneProps) {
    // quickFill is only set right before this pane mounts (tab switch), so
    // using it as the initial value of useState is safe.
    const [addVal, setAddVal] = useState(quickFill ?? "");
    const [search, setSearch] = useState("");
    const [error, setError] = useState("");
    const addRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (quickFill !== undefined) {
            addRef.current?.focus();
            onQuickFillConsumed();
        }
    }, [quickFill, onQuickFillConsumed]);

    async function handleAdd() {
        const val = addVal.trim().toLowerCase();
        if (!val) return;
        setError("");
        try {
            const row = await apiPost<SuppressedTerm>(API.suppressed, {
                term: val,
            });
            onChange([...suppressed, row]);
            setAddVal("");
        } catch (e) {
            setError(getErrorMessage(e));
        }
    }

    async function handleDelete(s: SuppressedTerm) {
        setError("");
        try {
            await apiDelete(API.suppressedEntry(s.id));
            onChange(suppressed.filter((x) => x.id !== s.id));
        } catch (e) {
            setError(getErrorMessage(e));
        }
    }

    const filtered = search
        ? suppressed.filter((s) => s.term.toLowerCase().includes(search.toLowerCase()))
        : suppressed;

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Top: help + search */}
            <div className="shrink-0 px-6 pt-5 pb-3 flex flex-col gap-3">
                <p className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
                    <Info
                        size={14}
                        aria-hidden
                        className="shrink-0 mt-1 text-muted-foreground/70"
                    />
                    <span>
                        Suppressed terms are silently dropped from output. Add OCR artefacts or
                        format identifiers (
                        <code className="font-mono text-foreground/80">f4a</code>,{" "}
                        <code className="font-mono text-foreground/80">tolovers</code>) that should
                        never appear as tags.
                    </span>
                </p>
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search suppressed."
                    aria-label="Search suppressed terms"
                />
            </div>

            {/* Scrollable chip grid */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-3">
                <div className="flex flex-wrap gap-1.5 pt-1">
                    {filtered.length === 0 && (
                        <p className="text-sm text-muted-foreground italic py-2 w-full">
                            {search ? "No matches." : "No suppressed terms yet."}
                        </p>
                    )}
                    {filtered.map((s) => (
                        <span
                            key={s.id}
                            className="font-mono inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-muted text-muted-foreground text-xs"
                        >
                            {s.term}
                            <button
                                type="button"
                                onClick={() => handleDelete(s)}
                                className="text-muted-foreground/60 hover:text-destructive transition-colors leading-none p-0.5 -m-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                aria-label={`Remove ${s.term}`}
                            >
                                <X size={12} aria-hidden />
                            </button>
                        </span>
                    ))}
                </div>
            </div>

            {/* Bottom: error + add row */}
            <div className="shrink-0 px-6 pt-3 pb-5 border-t border-border flex flex-col gap-2">
                {error && <p className="text-sm text-destructive break-words">{error}</p>}
                <div className="flex gap-2">
                    <Input
                        ref={addRef}
                        value={addVal}
                        onChange={(e) => setAddVal(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleAdd();
                        }}
                        placeholder="Add term to suppress (e.g. f4a)"
                        className="flex-1 font-mono text-sm"
                        aria-label="Add term to suppress"
                    />
                    <Button variant="outline" onClick={handleAdd} className="gap-1.5 shrink-0">
                        <ShieldOff size={14} aria-hidden />
                        Suppress
                    </Button>
                </div>
            </div>
        </div>
    );
}
