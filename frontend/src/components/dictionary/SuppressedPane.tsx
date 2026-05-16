import { useEffect, useRef, useState } from "react";
import { ShieldOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiDelete, apiPost, API } from "@/lib/api";
import type { SuppressedTerm } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface SuppressedPaneProps {
    suppressed: SuppressedTerm[];
    quickFill?: string;
    onQuickFillConsumed: () => void;
    onChange: (suppressed: SuppressedTerm[]) => void;
}

/**
 * Suppressed-terms tab body. Terms here are silently dropped from any
 * tag output — used for noisy OCR artefacts or format identifiers
 * (`f4a`, `tolovers`, etc.) that should never appear as tags.
 */
export default function SuppressedPane({
    suppressed,
    quickFill,
    onQuickFillConsumed,
    onChange,
}: SuppressedPaneProps) {
    // quickFill is only set right before this pane mounts (tab switch), so using it
    // as the initial value of useState is safe — the pane always mounts fresh.
    const [addVal, setAddVal] = useState(quickFill ?? "");
    const [search, setSearch] = useState("");
    const [error, setError] = useState("");
    const addRef = useRef<HTMLInputElement>(null);

    // Mount-only: focus the pre-filled input and tell the parent the value was consumed.
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
            const row = await apiPost<SuppressedTerm>(API.suppressed, { term: val });
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
        ? suppressed.filter((s) =>
              s.term.toLowerCase().includes(search.toLowerCase()),
          )
        : suppressed;

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Fixed top: description + search */}
            <div className="shrink-0 px-5 pt-5">
                <p className="text-[11px] text-muted-foreground bg-secondary border border-border rounded-md px-3 py-2 mb-4 leading-relaxed">
                    Suppressed terms are silently dropped from tag output. Use
                    these for noisy OCR artefacts or format identifiers (e.g.{" "}
                    <code className="text-primary">f4a</code>,{" "}
                    <code className="text-primary">tolovers</code>) that should
                    never appear as tags.
                </p>
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search suppressed terms…"
                    className="mb-3"
                />
            </div>

            {/* Scrollable chip grid */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5">
                <div className="flex flex-wrap gap-2 pb-2 pt-1">
                    {filtered.length === 0 && (
                        <span className="text-xs text-muted-foreground italic py-2 w-full">
                            {search ? "No matches" : "No suppressed terms yet"}
                        </span>
                    )}
                    {filtered.map((s) => (
                        <span
                            key={s.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-destructive/20 bg-destructive/8 text-destructive/70 text-xs"
                        >
                            {s.term}
                            <button
                                onClick={() => handleDelete(s)}
                                className="text-destructive/40 hover:text-destructive transition-colors leading-none"
                                title="Remove"
                            >
                                <X size={10} />
                            </button>
                        </span>
                    ))}
                </div>
            </div>

            {/* Fixed bottom: add row + error surface */}
            <div className="shrink-0 px-5 pt-3 pb-5 border-t border-border">
                {error && (
                    <div className="mb-2 text-[11px] text-destructive break-words">
                        {error}
                    </div>
                )}
                <div className="flex gap-2">
                    <Input
                        ref={addRef}
                        value={addVal}
                        onChange={(e) => setAddVal(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleAdd();
                        }}
                        placeholder="Add term to suppress (e.g. f4a)"
                        className="flex-1"
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleAdd}
                        className="gap-1.5 shrink-0"
                    >
                        <ShieldOff size={13} />
                        Suppress
                    </Button>
                </div>
            </div>
        </div>
    );
}
