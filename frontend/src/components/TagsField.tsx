import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";

import TagChip from "@/components/TagChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppDict, VocabEntry } from "@/lib/types";
import { normalizeTag } from "@/lib/utils";

interface TagsFieldProps {
    tags: string[];
    onTagsChange: (tags: string[]) => void;
    dict: AppDict;
    /** Add an unrecognised tag to the dictionary as a new canonical entry. */
    onPromoteToCanonical: (text: string) => Promise<void>;
    /** Add an unrecognised tag as an alias of an existing canonical. The
     *  caller (TagChip) hands back the canonical entry it picked so this
     *  handler doesn't have to look it up against potentially-stale state. */
    onPromoteToAlias: (text: string, canonical: VocabEntry) => Promise<void>;
    /** Placeholder for the add-tag input. Defaults to a generic prompt;
     *  the BulkEditSheet's per-file rows pass a tighter one. */
    placeholder?: string;
    /** aria-label for the add-tag input. Required when the parent
     *  doesn't already give the field a heading (e.g. multiple instances
     *  on one surface). */
    ariaLabel?: string;
}

/**
 * Chip-based tag editor: draggable chips, click to inline-edit, right-
 * click to promote a novel tag into the dictionary, normalised on add
 * through the user's vocabulary so aliases snap to their canonical
 * form. Extracted from `TagsEditor` so the BulkEditSheet's per-file
 * rows can drop the comma-separated-text input for the same surface.
 *
 * Pure presentation + local edit state; the canonical tag list lives
 * with the caller. Dictionary mutations route through the same
 * `onPromoteToCanonical` / `onPromoteToAlias` callbacks `TagsEditor`
 * uses, so all promotions land in App.tsx's single state path.
 */
export default function TagsField({
    tags,
    onTagsChange,
    dict,
    onPromoteToCanonical,
    onPromoteToAlias,
    placeholder = "Add a tag",
    ariaLabel = "Add a new tag",
}: TagsFieldProps) {
    const [tagInputVal, setTagInputVal] = useState("");
    const [editingIdx, setEditingIdx] = useState<number | null>(null);
    const [editingVal, setEditingVal] = useState("");
    const dragSrcIdx = useRef<number | null>(null);

    // Lowercase canonical lookup so each chip can flag whether it's in the
    // dictionary. Tags come in normalized via normalizeTag (which resolves
    // aliases to the canonical Title Case form), so a direct lowercase
    // membership check is enough — no need to walk aliases again per chip.
    const canonicalSet = useMemo(
        () => new Set(dict.vocabulary.map((v) => v.canonical.toLowerCase())),
        [dict.vocabulary],
    );

    // Wrap the alias-promotion handler so that, after the dictionary
    // PATCH succeeds, this chip's displayed text snaps to the canonical
    // form (matches what normalizeTag would have produced if the
    // dictionary entry had existed at extract time). Dedupe in case the
    // canonical is already present elsewhere in the list.
    async function handlePromoteToAlias(text: string, canonical: VocabEntry): Promise<void> {
        await onPromoteToAlias(text, canonical);
        const textLc = text.toLowerCase();
        const seen = new Set<string>();
        const next: string[] = [];
        for (const t of tags) {
            const display = t.toLowerCase() === textLc ? canonical.canonical : t;
            const key = display.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            next.push(display);
        }
        const changed = next.length !== tags.length || next.some((v, i) => v !== tags[i]);
        if (changed) onTagsChange(next);
    }

    function addTag() {
        const val = tagInputVal.trim();
        if (!val) return;
        const display = normalizeTag(val, dict) || val;
        if (!tags.map((t) => t.toLowerCase()).includes(display.toLowerCase())) {
            onTagsChange([...tags, display]);
        }
        setTagInputVal("");
    }

    function removeTag(i: number) {
        onTagsChange(tags.filter((_, idx) => idx !== i));
    }

    function startEdit(i: number) {
        setEditingIdx(i);
        setEditingVal(tags[i] ?? "");
    }

    function saveEdit(i: number) {
        const display = normalizeTag(editingVal, dict) || editingVal.trim();
        if (display) {
            const next = [...tags];
            next[i] = display;
            onTagsChange(next);
        }
        setEditingIdx(null);
        setEditingVal("");
    }

    function cancelEdit() {
        setEditingIdx(null);
        setEditingVal("");
    }

    function onDragStart(i: number) {
        dragSrcIdx.current = i;
    }

    function onDrop(e: React.DragEvent, i: number) {
        e.preventDefault();
        const src = dragSrcIdx.current;
        if (src === null || src === i) return;
        const next = [...tags];
        const [moved] = next.splice(src, 1);
        if (moved === undefined) return;
        next.splice(i, 0, moved);
        dragSrcIdx.current = null;
        onTagsChange(next);
    }

    return (
        <div className="flex flex-col gap-2">
            {tags.length > 0 && (
                <div
                    className="flex flex-wrap gap-1.5 p-3 bg-muted/40 border border-border rounded-md transition-colors"
                    onDragOver={(e) => e.preventDefault()}
                >
                    {tags.map((tag, i) => (
                        <TagChip
                            key={i}
                            label={tag}
                            novel={!canonicalSet.has(tag.toLowerCase())}
                            editing={editingIdx === i}
                            editingValue={editingVal}
                            onEditingValueChange={setEditingVal}
                            onStartEdit={() => startEdit(i)}
                            onSaveEdit={() => saveEdit(i)}
                            onCancelEdit={cancelEdit}
                            onRemove={() => removeTag(i)}
                            onDragStart={() => onDragStart(i)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => onDrop(e, i)}
                            vocabulary={dict.vocabulary}
                            onPromoteToCanonical={onPromoteToCanonical}
                            onPromoteToAlias={handlePromoteToAlias}
                        />
                    ))}
                </div>
            )}
            <div className="flex gap-2">
                <Input
                    value={tagInputVal}
                    onChange={(e) => setTagInputVal(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            addTag();
                        }
                    }}
                    placeholder={placeholder}
                    className="flex-1 font-mono text-sm"
                    aria-label={ariaLabel}
                />
                <Button variant="outline" onClick={addTag} className="gap-1.5 shrink-0">
                    <Plus size={14} aria-hidden />
                    Add
                </Button>
            </div>
        </div>
    );
}
