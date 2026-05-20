import { useMemo, useRef, useState } from "react";
import { Plus, Sparkles, User } from "lucide-react";

import TagChip from "@/components/TagChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppDict, VocabEntry } from "@/lib/types";
import { normalizeTag } from "@/lib/utils";

/** How long the title input flashes red when Generate is pressed with
 *  an empty title. */
const TITLE_VALIDATION_FLASH_MS = 1200;

/** Platform-appropriate label for the Generate shortcut. Mac users see the
 *  command symbol; everyone else sees "Ctrl". `navigator` is guarded so the
 *  module loads under any SSR config that strips browser globals. */
const SHORTCUT_LABEL =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘↵" : "Ctrl↵";

interface TagsEditorProps {
    title: string;
    onTitleChange: (t: string) => void;
    tags: string[];
    onTagsChange: (tags: string[]) => void;
    suffix: string;
    onSuffixChange: (s: string) => void;
    /** Most-recently extracted creator name (from the Patreon or Screenshot
     *  source panels). Surfaced as a passive "from <artist>" caption above
     *  the title input so the user keeps the context in view while editing.
     *  Empty string when nothing has been extracted yet (artist workflow). */
    artist?: string;
    dict: AppDict;
    /** Add an unrecognised tag to the dictionary as a new canonical entry. */
    onPromoteToCanonical: (text: string) => Promise<void>;
    /** Add an unrecognised tag as an alias of an existing canonical. The
     *  caller (TagChip) hands back the canonical entry it picked so this
     *  handler doesn't have to look it up against potentially-stale state. */
    onPromoteToAlias: (text: string, canonical: VocabEntry) => Promise<void>;
    onGenerate: () => void;
}

/**
 * User editing surface: title input, draggable tag chips, format suffix,
 * Generate CTA. Sits between the source panels and the OutputPanel. Auto-
 * populated by extraction (Patreon/Screenshot), refined by the user, then
 * Generate composes the final filename for the OutputPanel above.
 *
 * The in-component Dictionary button is gone (the new header carries one).
 */
export default function TagsEditor({
    title,
    onTitleChange,
    tags,
    onTagsChange,
    suffix,
    onSuffixChange,
    artist,
    dict,
    onPromoteToCanonical,
    onPromoteToAlias,
    onGenerate,
}: TagsEditorProps) {
    const [tagInputVal, setTagInputVal] = useState("");
    const [titleError, setTitleError] = useState(false);
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

    // ── Tag CRUD ──────────────────────────────────────────────────────────────

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

    // ── Generate ──────────────────────────────────────────────────────────────

    function handleGenerate() {
        if (!title.trim()) {
            setTitleError(true);
            setTimeout(() => setTitleError(false), TITLE_VALIDATION_FLASH_MS);
            return;
        }
        onGenerate();
    }

    // ── Drag and drop ─────────────────────────────────────────────────────────

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

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col gap-6">
            {/* Title */}
            <div className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2 flex-wrap">
                    <label
                        htmlFor="tags-editor-title"
                        className="text-sm font-medium tracking-wide text-muted-foreground"
                    >
                        Audio title
                    </label>
                    {artist && (
                        <span className="text-xs text-muted-foreground/70 inline-flex items-center gap-1">
                            <User size={11} aria-hidden />
                            from {artist}
                        </span>
                    )}
                </div>
                <Input
                    id="tags-editor-title"
                    value={title}
                    onChange={(e) => {
                        onTitleChange(e.target.value);
                        if (titleError) setTitleError(false);
                    }}
                    onKeyDown={(e) => {
                        // Ctrl/Cmd+Enter fires Generate from inside the title
                        // input so the late-night repeat workflow doesn't have
                        // to reach for the mouse. Plain Enter is intentionally
                        // not bound — too easy to fire mid-edit.
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            handleGenerate();
                        }
                    }}
                    placeholder="e.g. Villain Queen Ties You Up...Then Gets Soft With You"
                    aria-invalid={titleError ? true : undefined}
                    className="h-12"
                />
            </div>

            {/* Tags */}
            <div className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium tracking-wide text-muted-foreground">
                        Tags
                    </span>
                    {tags.length > 0 && (
                        <span className="text-xs text-muted-foreground/70">
                            Drag to reorder, click to edit
                        </span>
                    )}
                </div>

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

                <div className="flex gap-2 mt-1">
                    <Input
                        value={tagInputVal}
                        onChange={(e) => setTagInputVal(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                addTag();
                            }
                        }}
                        placeholder="Add a tag"
                        className="flex-1 font-mono text-sm"
                        aria-label="Add a new tag"
                    />
                    <Button variant="outline" onClick={addTag} className="gap-1.5 shrink-0">
                        <Plus size={14} aria-hidden />
                        Add
                    </Button>
                </div>
            </div>

            {/* Generate row */}
            <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-3 gap-y-3 items-end">
                <div className="flex flex-col gap-2">
                    <label
                        htmlFor="tags-editor-suffix"
                        className="text-sm font-medium tracking-wide text-muted-foreground"
                    >
                        Format
                    </label>
                    <Input
                        id="tags-editor-suffix"
                        value={suffix}
                        onChange={(e) => onSuffixChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                handleGenerate();
                            }
                        }}
                        onBlur={(e) => {
                            // Normalize the format suffix on blur so trivial typos like
                            // "f4a", " F4A", or "F4A " don't propagate into filenames.
                            // Values are conventionally uppercase ASMR codes (F4A, F4M,
                            // F4F, M4A, GN4A, etc.); the user defines their own.
                            const normalized = e.target.value.trim().toUpperCase();
                            if (normalized !== suffix) onSuffixChange(normalized);
                        }}
                        placeholder="F4A"
                        className="h-12 font-mono text-sm"
                        aria-describedby="tags-editor-suffix-hint"
                    />
                    <p
                        id="tags-editor-suffix-hint"
                        className="text-xs text-muted-foreground/80 leading-relaxed"
                    >
                        Goes between the tags and the file extension.
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="lg"
                    onClick={handleGenerate}
                    disabled={!title.trim()}
                    title={
                        !title.trim()
                            ? "Add an audio title first"
                            : `Generate filename (${SHORTCUT_LABEL})`
                    }
                    className="gap-2 justify-self-end"
                >
                    <Sparkles size={16} aria-hidden />
                    Generate filename
                    <kbd
                        aria-hidden
                        className="ml-1 hidden sm:inline-flex items-center font-mono text-[0.65rem] text-muted-foreground/80"
                    >
                        {SHORTCUT_LABEL}
                    </kbd>
                </Button>
            </div>
        </div>
    );
}
