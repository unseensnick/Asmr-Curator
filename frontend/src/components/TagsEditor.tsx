import { useRef, useState } from "react";
import { Sparkles, BookOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import SectionLabel from "@/components/SectionLabel";
import TagChip from "@/components/TagChip";
import type { AppDict } from "@/lib/types";
import { normalizeTag } from "@/lib/utils";

interface TagsEditorProps {
  title: string;
  onTitleChange: (t: string) => void;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  suffix: string;
  onSuffixChange: (s: string) => void;
  dict: AppDict;
  onGenerate: () => void;
  onOpenDictionary: () => void;
}


export default function TagsEditor({
  title,
  onTitleChange,
  tags,
  onTagsChange,
  suffix,
  onSuffixChange,
  dict,
  onGenerate,
  onOpenDictionary,
}: TagsEditorProps) {
  const [tagInputVal, setTagInputVal] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingVal, setEditingVal] = useState("");
  const dragSrcIdx = useRef<number | null>(null);

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
    setEditingVal(tags[i]);
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
      setTimeout(() => setTitleError(false), 1200);
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
    next.splice(i, 0, moved);
    dragSrcIdx.current = null;
    onTagsChange(next);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Card className="rounded-xl border border-border shadow-none ring-0 p-5 gap-0">
      {/* Card title */}
      <SectionLabel className="mb-4">Title &amp; Tags</SectionLabel>

      {/* Audio title */}
      <div className="mb-4">
        <label className="text-[10px] tracking-widest uppercase text-muted-foreground mb-1.5 block">
          Audio Title
        </label>
        <Input
          value={title}
          onChange={(e) => {
            onTitleChange(e.target.value);
            if (titleError) setTitleError(false);
          }}
          placeholder="e.g. Villain Queen Ties You Up...Then Gets Soft With You"
          aria-invalid={titleError ? true : undefined}
        />
      </div>

      {/* Tags */}
      <div className="mb-4">
        <label className="text-[10px] tracking-widest uppercase text-muted-foreground mb-1.5 block">
          Tags{" "}
          <span className="opacity-45 text-[9px] tracking-[0.05em] normal-case">
            — drag to reorder
          </span>
        </label>

        {/* Draggable tag chips */}
        <div
          className="flex flex-wrap gap-1.5 min-h-11.5 p-2 bg-secondary border border-input rounded-md transition-colors"
          onDragOver={(e) => e.preventDefault()}
        >
          {tags.map((tag, i) => (
            <TagChip
              key={i}
              label={tag}
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
            />
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground mt-1.5 tracking-[0.03em]">
          ⠿ drag to reorder &nbsp;·&nbsp; × to remove
        </p>

        {/* Tag input */}
        <div className="flex gap-2 mt-2">
          <Input
            value={tagInputVal}
            onChange={(e) => setTagInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Type a tag and press Enter to add"
            className="flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={addTag}
            className="gap-1.5 shrink-0"
          >
            <Plus size={14} />
            Add
          </Button>
        </div>
      </div>

      <Separator className="mb-4" />

      {/* Generate row */}
      <div className="grid grid-cols-[170px_1fr] gap-4 items-end max-[480px]:grid-cols-1">
        {/* Format suffix */}
        <div>
          <label className="text-[10px] tracking-widest uppercase text-muted-foreground mb-1.5 block">
            Format Suffix
          </label>
          <Input
            value={suffix}
            onChange={(e) => onSuffixChange(e.target.value)}
            placeholder="F4A / F4M / M4A"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Appended before .mp3
          </p>
        </div>

        {/* Dictionary + Generate */}
        <div className="flex gap-2 items-end">
          <Button
            variant="outline"
            onClick={onOpenDictionary}
            title="Tag Dictionary"
            className="shrink-0 px-3.5"
          >
            <BookOpen size={18} />
          </Button>
          <Button
            onClick={handleGenerate}
            className="flex-1 justify-center gap-2 py-2.75"
          >
            <Sparkles size={16} />
            Generate Filename
          </Button>
        </div>
      </div>
    </Card>
  );
}
