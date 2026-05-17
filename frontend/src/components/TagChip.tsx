import { Check, GripVertical, X } from "lucide-react";

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
 *     the signal, plus a tooltip explains it for non-visual users. The
 *     test pane already uses Matched/Novel/Suppressed pills; this is the
 *     same idea quieter, suited to a composing surface rather than a
 *     grading surface.
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
}: TagChipProps) {
    if (editing) {
        return (
            <div className="inline-flex items-center gap-1.5 bg-card border border-primary/40 ring-2 ring-primary/15 rounded-md px-2.5 py-1.5">
                <input
                    autoFocus
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

    const baseClasses =
        "group/chip inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 cursor-grab select-none active:cursor-grabbing transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
    const chromeClasses = novel
        ? "bg-warning/10 border-warning/30 hover:border-warning/50"
        : "bg-card border-border hover:border-muted-foreground/40";

    return (
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
                    ? "Not in your dictionary yet. Click to edit."
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
            <span className="font-mono text-xs text-foreground leading-none">
                {label}
            </span>
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
}
