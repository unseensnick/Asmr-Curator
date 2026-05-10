import { useRef, useState } from "react";
import { GripVertical, X, Sparkles, BookOpen, Plus, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
      <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground mb-4">
        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
        Title &amp; Tags
      </div>

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
          {tags.map((tag, i) =>
            editingIdx === i ? (
              <div
                key={i}
                className="inline-flex items-center gap-1 bg-card border border-primary/50 rounded px-2 py-1"
              >
                <GripVertical size={10} className="text-muted-foreground opacity-45 pointer-events-none shrink-0" />
                <input
                  autoFocus
                  value={editingVal}
                  onChange={(e) => setEditingVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit(i);
                    if (e.key === "Escape") cancelEdit();
                  }}
                  className="text-xs bg-transparent outline-none text-foreground min-w-[3ch]"
                  style={{ width: `${Math.max(editingVal.length, 4)}ch` }}
                />
                <button onClick={() => saveEdit(i)} className="text-green-400 hover:text-green-300 transition-colors leading-none shrink-0" title="Save">
                  <Check size={11} />
                </button>
                <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground transition-colors leading-none shrink-0" title="Cancel">
                  <X size={11} />
                </button>
              </div>
            ) : (
              <div
                key={i}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, i)}
                className="inline-flex items-center gap-1 bg-card border border-border rounded px-2 py-1 text-xs text-foreground cursor-grab select-none active:cursor-grabbing hover:border-primary/50 transition-colors group"
              >
                <GripVertical size={10} className="text-muted-foreground opacity-45 pointer-events-none shrink-0" />
                <button
                  onClick={() => startEdit(i)}
                  className="text-foreground hover:text-primary transition-colors leading-none"
                  title="Click to edit"
                >
                  {tag}
                </button>
                <Pencil size={9} className="text-muted-foreground/25 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
                <button
                  onClick={() => removeTag(i)}
                  className="text-muted-foreground hover:text-destructive transition-colors leading-none ml-0.5 shrink-0"
                >
                  <X size={13} />
                </button>
              </div>
            )
          )}
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
