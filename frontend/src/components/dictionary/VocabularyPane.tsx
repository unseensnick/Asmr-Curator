import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiDelete, apiPatch, apiPost, API } from "@/lib/api";
import type { VocabEntry } from "@/lib/types";

interface VocabularyPaneProps {
    vocabulary: VocabEntry[];
    quickFill?: string;
    onQuickFillConsumed: () => void;
    onChange: (vocabulary: VocabEntry[]) => void;
}

/**
 * Vocabulary tab body. Lists every canonical tag + its aliases, supports
 * inline edit / delete / add. Search filters by canonical OR alias.
 */
export default function VocabularyPane({
    vocabulary,
    quickFill,
    onQuickFillConsumed,
    onChange,
}: VocabularyPaneProps) {
    const [search, setSearch] = useState("");
    // quickFill is only set right before this pane mounts (tab switch), so using it
    // as the initial value of useState is safe — the pane always mounts fresh.
    const [addCanonical, setAddCanonical] = useState(quickFill ?? "");
    const [editingId, setEditingId] = useState<number | null>(null);
    const addRef = useRef<HTMLInputElement>(null);

    // Mount-only: focus the pre-filled input and tell the parent the value was consumed.
    // No setState here. This effect intentionally has no deps — it runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (quickFill !== undefined) {
            addRef.current?.focus();
            onQuickFillConsumed();
        }
    }, []);

    async function handleAdd() {
        const val = addCanonical.trim();
        if (!val) return;
        const row = await apiPost<VocabEntry>(API.vocabulary, {
            canonical: val,
            aliases: [],
        });
        onChange([...vocabulary, row]);
        setAddCanonical("");
    }

    async function handleDelete(entry: VocabEntry) {
        await apiDelete(API.vocabEntry(entry.id));
        onChange(vocabulary.filter((x) => x.id !== entry.id));
    }

    async function handleSave(updated: VocabEntry) {
        const row = await apiPatch<VocabEntry>(API.vocabEntry(updated.id), {
            canonical: updated.canonical,
            aliases: updated.aliases,
        });
        onChange(vocabulary.map((x) => (x.id === row.id ? row : x)));
        setEditingId(null);
    }

    const filtered = search
        ? vocabulary.filter(
              (e) =>
                  e.canonical.toLowerCase().includes(search.toLowerCase()) ||
                  e.aliases.some((a) =>
                      a.toLowerCase().includes(search.toLowerCase()),
                  ),
          )
        : vocabulary;

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Fixed top: description + search */}
            <div className="shrink-0 px-5 pt-5">
                <p className="text-[11px] text-muted-foreground bg-secondary border border-border rounded-md px-3 py-2 mb-4 leading-relaxed">
                    Canonical tags are the display forms used in filenames.
                    Aliases (lowercase) are alternate spellings the parser and
                    LLM will recognise and map to the canonical form.
                </p>
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search tags or aliases…"
                    className="mb-3"
                />
            </div>

            {/* Scrollable list */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5">
                <div className="flex flex-col gap-1 pb-2">
                    {filtered.length === 0 && (
                        <span className="text-xs text-muted-foreground italic py-2">
                            {search ? "No matches" : "No vocabulary entries yet"}
                        </span>
                    )}
                    {filtered.map((entry) =>
                        editingId === entry.id ? (
                            <VocabEntryEditor
                                key={entry.id}
                                entry={entry}
                                onSave={handleSave}
                                onCancel={() => setEditingId(null)}
                            />
                        ) : (
                            <div
                                key={entry.id}
                                className="flex items-start gap-2 px-3 py-2 rounded-lg border border-border bg-secondary/50 group hover:border-border/80 transition-colors"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start gap-1.5">
                                        <button
                                            className="flex-1 min-w-0 text-sm font-medium text-foreground hover:text-primary transition-colors text-left"
                                            title="Click to edit"
                                            onClick={() =>
                                                setEditingId(entry.id)
                                            }
                                        >
                                            {entry.canonical}
                                        </button>
                                        <Pencil
                                            size={11}
                                            className="shrink-0 mt-0.5 text-muted-foreground/25 group-hover:text-muted-foreground/60 transition-colors"
                                        />
                                    </div>
                                    {entry.aliases.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {entry.aliases.map((a) => (
                                                <Badge
                                                    key={a}
                                                    variant="secondary"
                                                    className="text-[10px]"
                                                >
                                                    {a}
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={() => handleDelete(entry)}
                                    className="text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
                                    title="Delete"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ),
                    )}
                </div>
            </div>

            {/* Fixed bottom: add row */}
            <div className="shrink-0 px-5 pt-3 pb-5 border-t border-border">
                <div className="flex gap-2">
                    <Input
                        ref={addRef}
                        value={addCanonical}
                        onChange={(e) => setAddCanonical(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleAdd();
                        }}
                        placeholder="Add canonical tag (e.g. Friends to Lovers)"
                        className="flex-1"
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleAdd}
                        className="gap-1.5 shrink-0"
                    >
                        <Plus size={13} />
                        Add
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ── Inline editor for a single vocabulary entry ───────────────────────────────

interface VocabEntryEditorProps {
    entry: VocabEntry;
    onSave: (updated: VocabEntry) => void;
    onCancel: () => void;
}

function VocabEntryEditor({ entry, onSave, onCancel }: VocabEntryEditorProps) {
    const [canonical, setCanonical] = useState(entry.canonical);
    const [aliases, setAliases] = useState<string[]>(entry.aliases);
    const [newAlias, setNewAlias] = useState("");

    function addAlias() {
        const a = newAlias.trim().toLowerCase();
        if (!a || aliases.includes(a)) return;
        setAliases([...aliases, a]);
        setNewAlias("");
    }

    function removeAlias(a: string) {
        setAliases(aliases.filter((x) => x !== a));
    }

    function save() {
        const c = canonical.trim();
        if (!c) return;
        onSave({ ...entry, canonical: c, aliases });
    }

    return (
        <div className="flex flex-col gap-2 px-3 py-3 rounded-lg border border-primary/50 bg-primary/5">
            {/* Canonical input */}
            <div className="flex gap-2 items-center">
                <Input
                    autoFocus
                    value={canonical}
                    onChange={(e) => setCanonical(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") save();
                        if (e.key === "Escape") onCancel();
                    }}
                    placeholder="Canonical name"
                    className="flex-1"
                />
                <button
                    onClick={save}
                    className="text-success hover:text-success/80 transition-colors"
                    title="Save"
                >
                    <Check size={15} />
                </button>
                <button
                    onClick={onCancel}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Cancel"
                >
                    <X size={15} />
                </button>
            </div>

            {/* Alias chips */}
            <div className="flex flex-wrap gap-1 min-h-6">
                {aliases.map((a) => (
                    <span
                        key={a}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground"
                    >
                        {a}
                        <button
                            onClick={() => removeAlias(a)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                            <X size={10} />
                        </button>
                    </span>
                ))}
                {aliases.length === 0 && (
                    <span className="text-[10px] text-muted-foreground/50 italic">
                        No aliases
                    </span>
                )}
            </div>

            {/* Add alias */}
            <div className="flex gap-1.5">
                <Input
                    value={newAlias}
                    onChange={(e) => setNewAlias(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") addAlias();
                    }}
                    placeholder="Add alias (lowercase)"
                    className="flex-1 text-xs"
                />
                <Button
                    variant="outline"
                    size="sm"
                    onClick={addAlias}
                    className="text-xs"
                >
                    + alias
                </Button>
            </div>
        </div>
    );
}
