import { GripVertical, Pencil, Check, X } from "lucide-react";

/**
 * Draggable, editable tag chip used by `TagsEditor`.
 *
 * Two modes:
 *   - Display mode (`editing=false`): drag handle, click-to-edit label,
 *     pencil hint, delete button.
 *   - Edit mode (`editing=true`): an inline `<input>` autosizes to the
 *     value's character count, with save/cancel buttons.
 *
 * Drag/drop is handled by the parent (TagsEditor owns the source index
 * state via a ref). This component just surfaces the HTML5 DnD
 * handlers as props.
 */
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
}

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
}: TagChipProps) {
    if (editing) {
        return (
            <div className="inline-flex items-center gap-1 bg-card border border-primary/50 rounded px-2 py-1">
                <GripVertical
                    size={10}
                    className="text-muted-foreground opacity-45 pointer-events-none shrink-0"
                />
                <input
                    autoFocus
                    value={editingValue}
                    onChange={(e) => onEditingValueChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") onSaveEdit();
                        if (e.key === "Escape") onCancelEdit();
                    }}
                    className="text-xs bg-transparent outline-none text-foreground min-w-[3ch]"
                    style={{ width: `${Math.max(editingValue.length, 4)}ch` }}
                />
                <button
                    onClick={onSaveEdit}
                    className="text-success hover:text-success/80 transition-colors leading-none shrink-0"
                    title="Save"
                >
                    <Check size={11} />
                </button>
                <button
                    onClick={onCancelEdit}
                    className="text-muted-foreground hover:text-foreground transition-colors leading-none shrink-0"
                    title="Cancel"
                >
                    <X size={11} />
                </button>
            </div>
        );
    }

    return (
        <div
            draggable
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            className="inline-flex items-center gap-1 bg-card border border-border rounded px-2 py-1 text-xs text-foreground cursor-grab select-none active:cursor-grabbing hover:border-primary/50 transition-colors group"
        >
            <GripVertical
                size={10}
                className="text-muted-foreground opacity-45 pointer-events-none shrink-0"
            />
            <button
                onClick={onStartEdit}
                className="text-foreground hover:text-primary transition-colors leading-none"
                title="Click to edit"
            >
                {label}
            </button>
            <Pencil
                size={9}
                className="text-muted-foreground/25 group-hover:text-muted-foreground/60 transition-colors shrink-0"
            />
            <button
                onClick={onRemove}
                className="text-muted-foreground hover:text-destructive transition-colors leading-none ml-0.5 shrink-0"
                title="Remove"
            >
                <X size={13} />
            </button>
        </div>
    );
}
