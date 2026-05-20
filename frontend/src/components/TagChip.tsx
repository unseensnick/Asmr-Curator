import { useEffect, useMemo, useRef, useState } from "react";
import { Check, GripVertical, Plus, X } from "lucide-react";

import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { VocabEntry } from "@/lib/types";

interface TagChipProps {
    label: string;
    onRemove: () => void;
    onStartEdit: () => void;
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;

    editing: boolean;
    editingValue: string;
    onEditingValueChange: (v: string) => void;
    onSaveEdit: () => void;
    onCancelEdit: () => void;

    /** Tag is not in the current dictionary. Renders with a faint warm-amber
     *  tint so the user can spot "review me" tags during composition. */
    novel?: boolean;

    /** Full vocabulary list, used by the right-click "Add as alias of…"
     *  picker to filter canonicals as the user types. Required when
     *  `novel` is true; otherwise unused. */
    vocabulary?: VocabEntry[];

    /** Add this chip's label to the dictionary as a new canonical entry.
     *  Wired to the right-click "Add to dictionary as new tag" item. */
    onPromoteToCanonical?: (text: string) => Promise<void>;

    /** Add this chip's label as an alias of an existing canonical entry.
     *  Wired to the right-click "Add as alias of…" submenu's picker. */
    onPromoteToAlias?: (text: string, canonical: VocabEntry) => Promise<void>;
}

/**
 * Draggable, editable tag chip used by `TagsEditor`. Mono label (filenames
 * are mono per the Two-Voices Rule), drag handle reveals on hover/focus,
 * remove X is always visible.
 *
 * Three display variants:
 *   - Canonical (default): chip with handle + clickable mono label + remove.
 *   - Novel (`novel=true`): same shape with `bg-warning/10` warm-amber tint
 *     to mark "not in your dictionary yet" without nagging — the color is
 *     the signal, plus a tooltip explains it for non-visual users. A
 *     right-click context menu offers "Add to dictionary as new tag"
 *     (creates a canonical) or "Add as alias of…" (picks an existing
 *     canonical via a searchable popover).
 *   - Edit: inline `<input>` autosizes to character count, with save +
 *     cancel buttons. Enter saves, Esc cancels, blur saves.
 *
 * Drag/drop state lives in the parent (TagsEditor); this component
 * surfaces the HTML5 DnD handlers as props. Touch DnD is a known
 * limitation, deferred to a future pass.
 */
export default function TagChip({
    label,
    onRemove,
    onStartEdit,
    onDragStart,
    onDragOver,
    onDrop,
    editing,
    editingValue,
    onEditingValueChange,
    onSaveEdit,
    onCancelEdit,
    novel = false,
    vocabulary = [],
    onPromoteToCanonical,
    onPromoteToAlias,
}: TagChipProps) {
    // Alias-picker popover state. Opens via the right-click menu's
    // "Add as alias of…" item. Radix closes the menu on pointerdown,
    // but pointerup + click still bubble to document afterwards — if
    // the popover opens too early it sees those trailing events as
    // outside-interaction and dismisses itself ("flash" bug). We defer
    // the open to the next macrotask AND swallow the first outside
    // event within a short grace window after open, belt-and-braces.
    const [aliasPickerOpen, setAliasPickerOpen] = useState(false);
    const aliasPickerOpenedAtRef = useRef(0);
    const [promoting, setPromoting] = useState(false);

    if (editing) {
        return (
            <EditingChip
                editingValue={editingValue}
                onEditingValueChange={onEditingValueChange}
                onSaveEdit={onSaveEdit}
                onCancelEdit={onCancelEdit}
            />
        );
    }

    // Whole chip is the edit target (was: only the inner label button). Same
    // click-anywhere pattern the vocabulary rows use. Drag still works because
    // the browser only fires `click` on a real click (no drag in between),
    // and the X button stops propagation so removing doesn't also enter edit.
    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onStartEdit();
        }
    }

    async function handleAddCanonical() {
        if (!onPromoteToCanonical || promoting) return;
        setPromoting(true);
        try {
            await onPromoteToCanonical(label);
        } catch {
            // Caller (App) surfaces errors via the dictionary modal /
            // toast surface in the future; for now a failed promote
            // just leaves the chip as-is so the user can retry.
        } finally {
            setPromoting(false);
        }
    }

    async function handlePickAlias(canonical: VocabEntry) {
        if (!onPromoteToAlias || promoting) return;
        setAliasPickerOpen(false);
        setPromoting(true);
        try {
            await onPromoteToAlias(label, canonical);
        } catch {
            // See handleAddCanonical — silent fail leaves the chip novel.
        } finally {
            setPromoting(false);
        }
    }

    const baseClasses =
        "group/chip inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 cursor-grab select-none active:cursor-grabbing transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
    const chromeClasses = novel
        ? "bg-warning/10 border-warning/30 hover:border-warning/50"
        : "bg-card border-border hover:border-muted-foreground/40";

    const chipBody = (
        <div
            role="button"
            tabIndex={0}
            draggable
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onClick={onStartEdit}
            onKeyDown={handleKeyDown}
            title={
                novel
                    ? "Not in your dictionary yet. Click to edit, right-click to add."
                    : "Click to edit"
            }
            aria-label={`Edit tag ${label}`}
            className={`${baseClasses} ${chromeClasses}`}
        >
            <GripVertical
                size={12}
                aria-hidden
                className="text-muted-foreground/60 opacity-0 group-hover/chip:opacity-100 group-focus-within/chip:opacity-100 transition-opacity shrink-0"
            />
            <span className="font-mono text-xs text-foreground leading-none">{label}</span>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                }}
                className="text-muted-foreground/60 hover:text-destructive transition-colors leading-none shrink-0 p-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                title="Remove tag"
                aria-label={`Remove tag ${label}`}
            >
                <X size={14} aria-hidden />
            </button>
        </div>
    );

    // Non-novel chips: no right-click menu, no alias picker — the X button
    // and click-to-edit cover everything a canonical chip needs.
    if (!novel) {
        return chipBody;
    }

    return (
        <Popover open={aliasPickerOpen} onOpenChange={setAliasPickerOpen}>
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <PopoverAnchor asChild>{chipBody}</PopoverAnchor>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuLabel>Add to dictionary</ContextMenuLabel>
                    <ContextMenuItem
                        disabled={!onPromoteToCanonical || promoting}
                        onSelect={() => {
                            // rAF: let the menu close + restore focus before the
                            // network call (matches the LibraryExplorerSheet
                            // pattern for menu → action handoffs).
                            requestAnimationFrame(() => {
                                void handleAddCanonical();
                            });
                        }}
                    >
                        <Plus aria-hidden />
                        As new canonical tag
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                        disabled={!onPromoteToAlias || promoting || vocabulary.length === 0}
                        onSelect={() => {
                            // setTimeout(0) — runs in the next macrotask,
                            // after the click event finishes bubbling. rAF
                            // would fire before that and let the trailing
                            // click reach the popover as outside-interaction.
                            setTimeout(() => {
                                aliasPickerOpenedAtRef.current = performance.now();
                                setAliasPickerOpen(true);
                            }, 0);
                        }}
                    >
                        <Plus aria-hidden />
                        As alias of…
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
            <PopoverContent
                side="bottom"
                align="start"
                className="w-72 p-2"
                onPointerDownOutside={(e) => {
                    // Ignore the trailing pointerdown that fires from the
                    // same click that closed the context menu. After the
                    // grace window, behave normally — click-outside still
                    // dismisses the picker.
                    if (performance.now() - aliasPickerOpenedAtRef.current < 150) {
                        e.preventDefault();
                    }
                }}
                onFocusOutside={(e) => {
                    // Same guard for focus restoration when the menu closes.
                    if (performance.now() - aliasPickerOpenedAtRef.current < 150) {
                        e.preventDefault();
                    }
                }}
            >
                <AliasPicker label={label} vocabulary={vocabulary} onPick={handlePickAlias} />
            </PopoverContent>
        </Popover>
    );
}

interface EditingChipProps {
    editingValue: string;
    onEditingValueChange: (v: string) => void;
    onSaveEdit: () => void;
    onCancelEdit: () => void;
}

/**
 * Rendered when a TagChip is in edit mode. Kept as its own component so the
 * focus-on-mount effect lives on a `useRef` (jsx-a11y/no-autofocus replacement)
 * and only runs once when the chip flips into edit mode — not on every
 * keystroke the way an inline callback ref would.
 */
function EditingChip({
    editingValue,
    onEditingValueChange,
    onSaveEdit,
    onCancelEdit,
}: EditingChipProps) {
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    return (
        <div className="inline-flex items-center gap-1.5 bg-card border border-primary/40 ring-2 ring-primary/15 rounded-md px-2.5 py-1.5">
            <input
                ref={inputRef}
                value={editingValue}
                onChange={(e) => onEditingValueChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") onSaveEdit();
                    if (e.key === "Escape") onCancelEdit();
                }}
                onBlur={onSaveEdit}
                className="font-mono text-xs bg-transparent outline-none text-foreground min-w-[3ch]"
                style={{ width: `${Math.max(editingValue.length, 4)}ch` }}
            />
            <button
                type="button"
                onClick={onSaveEdit}
                className="text-success hover:text-success/80 transition-colors leading-none shrink-0 p-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                title="Save"
                aria-label="Save edit"
            >
                <Check size={14} aria-hidden />
            </button>
            <button
                type="button"
                onClick={onCancelEdit}
                className="text-muted-foreground hover:text-foreground transition-colors leading-none shrink-0 p-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                title="Cancel"
                aria-label="Cancel edit"
            >
                <X size={14} aria-hidden />
            </button>
        </div>
    );
}

interface AliasPickerProps {
    /** The novel tag text being promoted — shown in the picker header so
     *  the user can confirm they're about to attach the right text. */
    label: string;
    vocabulary: VocabEntry[];
    onPick: (canonical: VocabEntry) => void;
}

/**
 * Search-and-pick canonical for the "Add as alias of…" flow. Lives in
 * TagChip.tsx because it's only ever rendered by a chip, but kept as its
 * own function so the picker's filter logic stays focused.
 */
function AliasPicker({ label, vocabulary, onPick }: AliasPickerProps) {
    const [query, setQuery] = useState("");
    const queryInputRef = useRef<HTMLInputElement | null>(null);

    // Auto-focus the search input when the popover opens. Replaces the
    // jsx-a11y-banned `autoFocus` prop while preserving the
    // open-then-type-immediately UX.
    useEffect(() => {
        queryInputRef.current?.focus();
    }, []);

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q
            ? vocabulary.filter(
                  (v) =>
                      v.canonical.toLowerCase().includes(q) ||
                      v.aliases.some((a) => a.toLowerCase().includes(q)),
              )
            : vocabulary;
        // Cap at 30 matches — the picker is a quick-add affordance, not a
        // browse surface. The Dictionary modal exists for full editing.
        return list.slice(0, 30);
    }, [query, vocabulary]);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1 px-1">
                <p className="text-xs text-muted-foreground">
                    Add <span className="font-mono text-foreground">{label}</span> as an alias of:
                </p>
            </div>
            <Input
                ref={queryInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search canonicals"
                className="h-8 font-mono text-xs"
                aria-label="Search canonical tags"
            />
            <div
                role="menu"
                aria-label="Existing canonical tags"
                className="flex flex-col gap-0.5 max-h-60 overflow-y-auto"
            >
                {matches.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-muted-foreground italic text-center">
                        No matching canonicals.
                    </p>
                ) : (
                    matches.map((entry) => (
                        <button
                            key={entry.id}
                            type="button"
                            role="menuitem"
                            onClick={() => onPick(entry)}
                            className="flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none transition-colors"
                        >
                            <span className="font-mono text-foreground">{entry.canonical}</span>
                            {entry.aliases.length > 0 && (
                                <span className="font-mono text-[10px] text-muted-foreground truncate max-w-full">
                                    {entry.aliases.join(", ")}
                                </span>
                            )}
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
