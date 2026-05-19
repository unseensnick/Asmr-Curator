import { useEffect, useMemo, useRef, useState } from "react";
import {
    AlertCircle,
    Check,
    GripVertical,
    Info,
    Plus,
    Trash2,
    X,
} from "lucide-react";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API, apiDelete, apiPatch, apiPost } from "@/lib/api";
import type { VocabEntry } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface VocabularyPaneProps {
    vocabulary: VocabEntry[];
    quickFill?: string;
    onQuickFillConsumed: () => void;
    onChange: (vocabulary: VocabEntry[]) => void;
    /** Persist a reordered vocabulary (bulk-replace; backend re-inserts and
     *  reissues ids). Parent handles the round-trip + reload. */
    onReorder: (newOrder: VocabEntry[]) => Promise<void>;
}

/**
 * Vocabulary tab body. Lists every canonical tag + its aliases, supports
 * inline edit / delete / add. Search filters by canonical OR alias. Whole
 * row is clickable to enter edit mode (no need to hit the canonical text
 * precisely). Rows are draggable to reorder; the order controls which
 * entry claims a contested alias on lookup (last-write-wins in the
 * canonical map, so entries lower in the list win).
 */
export default function VocabularyPane({
    vocabulary,
    quickFill,
    onQuickFillConsumed,
    onChange,
    onReorder,
}: VocabularyPaneProps) {
    const [search, setSearch] = useState("");
    // quickFill is only set right before this pane mounts (tab switch), so
    // using it as the initial value of useState is safe.
    const [addCanonical, setAddCanonical] = useState(quickFill ?? "");
    const [editingId, setEditingId] = useState<number | null>(null);
    const [deleteCandidate, setDeleteCandidate] = useState<VocabEntry | null>(null);
    const [error, setError] = useState("");
    const [savingOrder, setSavingOrder] = useState(false);
    const addRef = useRef<HTMLInputElement>(null);
    const dragSrcIdx = useRef<number | null>(null);

    // Mount-only: focus the pre-filled input and tell the parent the value
    // was consumed.
    useEffect(() => {
        if (quickFill !== undefined) {
            addRef.current?.focus();
            onQuickFillConsumed();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
    }, []);

    async function handleAdd() {
        const val = addCanonical.trim();
        if (!val) return;
        setError("");
        try {
            const row = await apiPost<VocabEntry>(API.vocabulary, {
                canonical: val,
                aliases: [],
            });
            onChange([...vocabulary, row]);
            setAddCanonical("");
        } catch (e) {
            setError(getErrorMessage(e));
        }
    }

    async function performDelete() {
        const entry = deleteCandidate;
        if (!entry) return;
        setError("");
        setDeleteCandidate(null);
        try {
            await apiDelete(API.vocabEntry(entry.id));
            onChange(vocabulary.filter((x) => x.id !== entry.id));
        } catch (e) {
            setError(getErrorMessage(e));
        }
    }

    async function handleSave(updated: VocabEntry) {
        setError("");
        try {
            const row = await apiPatch<VocabEntry>(
                API.vocabEntry(updated.id),
                {
                    canonical: updated.canonical,
                    aliases: updated.aliases,
                },
            );
            onChange(vocabulary.map((x) => (x.id === row.id ? row : x)));
            setEditingId(null);
        } catch (e) {
            setError(getErrorMessage(e));
        }
    }

    async function handleReorder(srcIdx: number, dstIdx: number) {
        if (srcIdx === dstIdx) return;
        const next = [...vocabulary];
        const [moved] = next.splice(srcIdx, 1);
        next.splice(dstIdx, 0, moved);
        // Optimistic local update for instant feedback; the parent's reload
        // (inside onReorder) will overwrite with fresh ids shortly after.
        onChange(next);
        setSavingOrder(true);
        setError("");
        try {
            await onReorder(next);
        } catch (e) {
            setError("Reorder failed: " + getErrorMessage(e));
        } finally {
            setSavingOrder(false);
        }
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
    // Drag-to-reorder doesn't work cleanly against a filtered view (visible
    // indices don't match the source array). Disable drag while searching.
    const dragEnabled = !search;

    // Build a lowercase -> all claimants map across the entire vocabulary.
    // Used to flag aliases that are also claimed by another entry (as
    // canonical or alias). buildDictDerived is last-write-wins on the
    // canonical map, so the entry with the highest list index wins lookup.
    const aliasClaims = useMemo(() => {
        const map = new Map<
            string,
            { entry: VocabEntry; role: "canonical" | "alias"; index: number }[]
        >();
        vocabulary.forEach((entry, index) => {
            const claim = (key: string, role: "canonical" | "alias") => {
                const k = key.toLowerCase();
                const arr = map.get(k) ?? [];
                arr.push({ entry, role, index });
                map.set(k, arr);
            };
            claim(entry.canonical, "canonical");
            entry.aliases.forEach((a) => claim(a, "alias"));
        });
        return map;
    }, [vocabulary]);

    return (
        <>
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
                        Canonical tags display in filenames. Aliases are
                        alternate spellings the parser maps back to the
                        canonical. Click any entry to edit. Drag to reorder;
                        when two entries share an alias, the one lower in the
                        list wins.
                    </span>
                </p>
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search vocabulary."
                    aria-label="Search vocabulary"
                />
            </div>

            {/* Scrollable list */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6">
                <div className="flex flex-col gap-1.5 pb-3">
                    {filtered.length === 0 && (
                        <p className="text-sm text-muted-foreground italic py-2">
                            {search
                                ? "No matches."
                                : "No vocabulary entries yet."}
                        </p>
                    )}
                    {filtered.map((entry) =>
                        editingId === entry.id ? (
                            <VocabEntryEditor
                                key={entry.id}
                                entry={entry}
                                vocabulary={vocabulary}
                                onSave={handleSave}
                                onCancel={() => setEditingId(null)}
                            />
                        ) : (
                            <VocabEntryRow
                                key={entry.id}
                                entry={entry}
                                aliasClaims={aliasClaims}
                                draggable={dragEnabled}
                                onEdit={() => setEditingId(entry.id)}
                                onDelete={() => setDeleteCandidate(entry)}
                                onDragStart={() => {
                                    dragSrcIdx.current = vocabulary.findIndex(
                                        (x) => x.id === entry.id,
                                    );
                                }}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    const src = dragSrcIdx.current;
                                    const dst = vocabulary.findIndex(
                                        (x) => x.id === entry.id,
                                    );
                                    dragSrcIdx.current = null;
                                    if (
                                        src !== null &&
                                        dst !== -1 &&
                                        src !== dst
                                    ) {
                                        handleReorder(src, dst);
                                    }
                                }}
                            />
                        ),
                    )}
                </div>
            </div>

            {/* Bottom: error + add row */}
            <div className="shrink-0 px-6 pt-3 pb-5 border-t border-border flex flex-col gap-2">
                {savingOrder && (
                    <p className="text-xs text-muted-foreground italic">
                        Saving new order.
                    </p>
                )}
                {error && (
                    <p className="text-sm text-destructive break-words">
                        {error}
                    </p>
                )}
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
                        aria-label="Add canonical tag"
                    />
                    <Button
                        variant="outline"
                        onClick={handleAdd}
                        className="gap-1.5 shrink-0"
                    >
                        <Plus size={14} aria-hidden />
                        Add
                    </Button>
                </div>
            </div>
        </div>

        <AlertDialog
            open={deleteCandidate !== null}
            onOpenChange={(v) => !v && setDeleteCandidate(null)}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Delete{" "}
                        <span className="font-medium">
                            {deleteCandidate?.canonical}
                        </span>
                        ?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {deleteCandidate && deleteCandidate.aliases.length > 0
                            ? `Removes the canonical tag and its ${deleteCandidate.aliases.length} ${deleteCandidate.aliases.length === 1 ? "alias" : "aliases"}. Tags already in saved filenames keep their text; future extractions stop matching.`
                            : "Future extractions stop matching this tag. Tags already in saved filenames keep their text."}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={performDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </>
    );
}

// ── Display row ──────────────────────────────────────────────────────────

interface VocabEntryRowProps {
    entry: VocabEntry;
    /** Lowercase -> all claimants map across the full vocabulary. Used to
     *  flag aliases also owned by another entry. */
    aliasClaims: Map<
        string,
        { entry: VocabEntry; role: "canonical" | "alias"; index: number }[]
    >;
    /** When true, the row is draggable for reordering. Disabled during
     *  active search (visible/source indices diverge). */
    draggable: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
}

function VocabEntryRow({
    entry,
    aliasClaims,
    draggable,
    onEdit,
    onDelete,
    onDragStart,
    onDragOver,
    onDrop,
}: VocabEntryRowProps) {
    return (
        <div
            draggable={draggable}
            onDragStart={draggable ? onDragStart : undefined}
            onDragOver={draggable ? onDragOver : undefined}
            onDrop={draggable ? onDrop : undefined}
            onClick={onEdit}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onEdit();
                }
            }}
            role="button"
            tabIndex={0}
            aria-label={`Edit ${entry.canonical}`}
            title="Click to edit"
            className="group/vocab flex items-start gap-2 px-3 py-2.5 rounded-lg border border-border bg-background hover:bg-muted/40 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
            {draggable && (
                <GripVertical
                    size={14}
                    aria-hidden
                    className="text-muted-foreground/40 opacity-0 group-hover/vocab:opacity-100 transition-opacity shrink-0 mt-0.5 cursor-grab active:cursor-grabbing"
                />
            )}
            <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground block">
                    {entry.canonical}
                </span>
                {entry.aliases.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                        {entry.aliases.map((a) => {
                            const claimants = aliasClaims.get(a.toLowerCase()) ?? [];
                            const others = claimants.filter(
                                (c) => c.entry.id !== entry.id,
                            );
                            if (others.length === 0) {
                                return (
                                    <span
                                        key={a}
                                        className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                                    >
                                        {a}
                                    </span>
                                );
                            }
                            const myIndex =
                                claimants.find((c) => c.entry.id === entry.id)?.index ??
                                -1;
                            const maxIndex = Math.max(
                                ...claimants.map((c) => c.index),
                            );
                            const wins = myIndex === maxIndex;
                            const otherNames = others
                                .map(
                                    (c) =>
                                        `${c.entry.canonical} (${c.role})`,
                                )
                                .join(", ");
                            const tip = wins
                                ? `Also on ${otherNames}. This entry wins lookup because it sits lower in the list.`
                                : `Also on ${otherNames}, which wins lookup (lower in the list).`;
                            return (
                                <span
                                    key={a}
                                    title={tip}
                                    aria-label={tip}
                                    className="font-mono inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-warning/40 bg-warning/10 text-warning"
                                >
                                    <AlertCircle size={10} aria-hidden />
                                    {a}
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                }}
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-1 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                title="Delete"
                aria-label={`Delete ${entry.canonical}`}
            >
                <Trash2 size={14} aria-hidden />
            </button>
        </div>
    );
}

// ── Inline editor ────────────────────────────────────────────────────────

interface VocabEntryEditorProps {
    entry: VocabEntry;
    /** Full vocabulary list, used to detect contested aliases as the user
     *  types one. The editor filters out the entry being edited itself so a
     *  self-alias isn't flagged. */
    vocabulary: VocabEntry[];
    onSave: (updated: VocabEntry) => void;
    onCancel: () => void;
}

function VocabEntryEditor({
    entry,
    vocabulary,
    onSave,
    onCancel,
}: VocabEntryEditorProps) {
    const [canonical, setCanonical] = useState(entry.canonical);
    const [aliases, setAliases] = useState<string[]>(entry.aliases);
    const [newAlias, setNewAlias] = useState("");

    // Live conflict surface: as the user types an alias that already exists
    // (as another entry's canonical OR as another entry's alias), flag which
    // entry currently owns it. buildDictDerived is last-write-wins on the
    // canonical map, so adding here is allowed — the warning just makes the
    // override behavior visible instead of silent.
    const aliasConflict = useMemo(() => {
        const a = newAlias.trim().toLowerCase();
        if (!a) return null;
        return (
            vocabulary.find(
                (e) =>
                    e.id !== entry.id &&
                    (e.canonical.toLowerCase() === a ||
                        e.aliases.some((x) => x.toLowerCase() === a)),
            ) ?? null
        );
    }, [newAlias, vocabulary, entry.id]);

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
        <div className="flex flex-col gap-2.5 px-3 py-3 rounded-lg border border-border bg-accent/40">
            {/* Canonical input + save/cancel */}
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
                    className="flex-1 h-9"
                />
                <button
                    type="button"
                    onClick={save}
                    className="text-success hover:text-success/80 transition-colors p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    title="Save"
                    aria-label="Save changes"
                >
                    <Check size={16} aria-hidden />
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    title="Cancel"
                    aria-label="Cancel edit"
                >
                    <X size={16} aria-hidden />
                </button>
            </div>

            {/* Alias chips */}
            <div className="flex flex-wrap gap-1.5 min-h-7 items-center">
                {aliases.length === 0 ? (
                    <span className="text-xs text-muted-foreground/70 italic">
                        No aliases yet.
                    </span>
                ) : (
                    aliases.map((a) => (
                        <span
                            key={a}
                            className="font-mono inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-card border border-border text-foreground/90"
                        >
                            {a}
                            <button
                                type="button"
                                onClick={() => removeAlias(a)}
                                className="text-muted-foreground hover:text-destructive transition-colors leading-none"
                                aria-label={`Remove alias ${a}`}
                            >
                                <X size={11} aria-hidden />
                            </button>
                        </span>
                    ))
                )}
            </div>

            {/* Add alias */}
            <div className="flex flex-col gap-1.5">
                <div className="flex gap-2">
                    <Input
                        value={newAlias}
                        onChange={(e) => setNewAlias(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") addAlias();
                        }}
                        placeholder="Add alias (lowercase)"
                        className="flex-1 h-9 font-mono text-sm"
                        aria-label="Add alias"
                    />
                    <Button
                        variant="outline"
                        onClick={addAlias}
                        className="gap-1.5 shrink-0"
                    >
                        <Plus size={14} aria-hidden />
                        Alias
                    </Button>
                </div>
                {aliasConflict && (
                    <p className="text-xs text-warning flex items-start gap-1.5 leading-relaxed">
                        <AlertCircle
                            size={12}
                            aria-hidden
                            className="shrink-0 mt-0.5"
                        />
                        <span>
                            Already on{" "}
                            <strong className="font-medium">
                                {aliasConflict.canonical}
                            </strong>
                            . Adding here lets this entry override on lookup if
                            it sits lower in the list.
                        </span>
                    </p>
                )}
            </div>
        </div>
    );
}
