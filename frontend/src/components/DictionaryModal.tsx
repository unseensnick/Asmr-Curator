import { useEffect, useRef, useState } from "react";
import {
  X,
  BookOpen,
  ShieldOff,
  Trash2,
  Check,
  Download,
  Upload,
  RotateCcw,
  FlaskConical,
  Plus,
  Pencil,
  Cookie,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import ParserTestPane from "@/components/ParserTestPane";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  apiPost,
  apiDelete,
  apiPatch,
  apiGet,
  apiPut,
  API,
  getPatreonCookieStatus,
  setPatreonCookie,
} from "@/lib/api";
import { dictFromApiResponse, buildDictDerived } from "@/lib/types";
import type {
  AppDict,
  VocabEntry,
  SuppressedTerm,
  DictionaryApiResponse,
} from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type DictTab = "vocabulary" | "suppressed" | "test" | "cookie";

interface DictionaryModalProps {
  open: boolean;
  onClose: () => void;
  dict: AppDict;
  onDictChange: (next: AppDict) => void;
}

// ── DictionaryModal ───────────────────────────────────────────────────────────

export default function DictionaryModal({
  open,
  onClose,
  dict,
  onDictChange,
}: DictionaryModalProps) {
  const [tab, setTab] = useState<DictTab>("vocabulary");
  // Quick-fill: navigate to a tab and pre-populate its add input
  const [quickFill, setQuickFill] = useState<{
    tab: DictTab;
    value?: string;
  } | null>(null);

  async function reloadDict() {
    const data = await apiGet<DictionaryApiResponse>(API.dictionary);
    onDictChange(dictFromApiResponse(data));
  }

  // ── Export ────────────────────────────────────────────────────────────────
  async function handleExport() {
    const data = await apiGet<DictionaryApiResponse>(API.dictionary);
    const blob = new Blob(
      [JSON.stringify({ vocabulary: data.vocabulary, suppressed: data.suppressed }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "asmr-tag-dictionary.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  // ── Import ────────────────────────────────────────────────────────────────
  const importRef = useRef<HTMLInputElement>(null);
  async function handleImportFile(file: File) {
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported.vocabulary) || !Array.isArray(imported.suppressed))
        throw new Error("Missing 'vocabulary' or 'suppressed' arrays");
      await apiPut(API.dictionary, imported);
      await reloadDict();
    } catch (err) {
      alert("Import failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  async function handleReset() {
    if (!confirm("Reset dictionary to built-in defaults? All custom entries will be lost.")) return;
    await apiPost(API.dictionaryReset, {});
    await reloadDict();
  }

  function handleQuickFix(action: "vocab" | "suppress", token: string) {
    if (action === "suppress") {
      setQuickFill({ tab: "suppressed", value: token });
      setTab("suppressed");
    } else {
      setQuickFill({ tab: "vocabulary", value: token });
      setTab("vocabulary");
    }
  }

  const tabs: { id: DictTab; label: string; count?: number }[] = [
    { id: "vocabulary",  label: "Vocabulary",       count: dict.vocabulary.length },
    { id: "suppressed",  label: "Suppressed Terms",  count: dict.suppressed.length },
    { id: "test",        label: "Test" },
    { id: "cookie",      label: "Patreon Cookie" },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="w-full max-w-225 sm:max-w-225 h-[88vh] flex flex-col rounded-2xl p-0 gap-0 overflow-hidden"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            Tag Dictionary
          </span>
          <div className="flex gap-1.5 ml-1">
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
              {dict.vocabulary.length} tags
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {dict.suppressed.length} suppressed
            </Badge>
          </div>
          <button
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab bar */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as DictTab)}>
          <TabsList
            variant="line"
            className="border-b border-border px-4 w-full rounded-none justify-start h-auto gap-0 bg-transparent overflow-x-auto shrink-0"
          >
            {tabs.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="flex items-center gap-1.5 px-3.5 py-3 text-[11px] tracking-[0.06em] whitespace-nowrap rounded-none"
              >
                {t.id === "vocabulary"  && <BookOpen size={12} />}
                {t.id === "suppressed"  && <ShieldOff size={12} />}
                {t.id === "test"        && <FlaskConical size={12} />}
                {t.id === "cookie"      && <Cookie size={12} />}
                {t.label}
                {t.count !== undefined && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground tabular-nums">
                    {t.count}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Pane body */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {tab === "vocabulary" && (
            <VocabularyPane
              vocabulary={dict.vocabulary}
              quickFill={quickFill?.tab === "vocabulary" ? quickFill.value : undefined}
              onQuickFillConsumed={() => setQuickFill(null)}
              onChange={(vocabulary) => {
                onDictChange({
                  ...dict,
                  vocabulary,
                  ...buildDictDerived(vocabulary, dict.suppressed),
                });
              }}
            />
          )}
          {tab === "suppressed" && (
            <SuppressedPane
              suppressed={dict.suppressed}
              quickFill={quickFill?.tab === "suppressed" ? quickFill.value : undefined}
              onQuickFillConsumed={() => setQuickFill(null)}
              onChange={(suppressed) => {
                onDictChange({
                  ...dict,
                  suppressed,
                  ...buildDictDerived(dict.vocabulary, suppressed),
                });
              }}
            />
          )}
          {tab === "test" && (
            <ParserTestPane dict={dict} onQuickFix={handleQuickFix} />
          )}
          {tab === "cookie" && <CookiePane open={open && tab === "cookie"} />}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border shrink-0 flex-wrap">
          <span className="text-[10px] text-muted-foreground tracking-[0.08em] mr-1">
            Dictionary
          </span>
          <Button variant="outline" size="sm" onClick={handleExport} className="text-[11px] gap-1.5">
            <Download size={13} />
            Export JSON
          </Button>
          <Button variant="outline" size="sm" onClick={() => importRef.current?.click()} className="text-[11px] gap-1.5">
            <Upload size={13} />
            Import JSON
          </Button>
          <input
            ref={importRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" onClick={handleReset} className="text-[11px] gap-1.5 ml-auto text-destructive/70 hover:text-destructive hover:border-destructive/50">
            <RotateCcw size={13} />
            Reset defaults
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Vocabulary pane
// ══════════════════════════════════════════════════════════════════════════════

function VocabularyPane({
  vocabulary,
  quickFill,
  onQuickFillConsumed,
  onChange,
}: {
  vocabulary: VocabEntry[];
  quickFill?: string;
  onQuickFillConsumed: () => void;
  onChange: (vocabulary: VocabEntry[]) => void;
}) {
  const [search, setSearch] = useState("");
  // quickFill is only set right before this pane mounts (tab switch), so using it
  // as the initial value of useState is safe — the pane always mounts fresh.
  const [addCanonical, setAddCanonical] = useState(quickFill ?? "");
  const [editingId, setEditingId] = useState<number | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  // Mount-only: focus the pre-filled input and tell the parent the value was consumed.
  // No setState here. This effect intentionally has no deps — it runs once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (quickFill !== undefined) { addRef.current?.focus(); onQuickFillConsumed(); } }, []);

  async function handleAdd() {
    const val = addCanonical.trim();
    if (!val) return;
    const row = await apiPost<VocabEntry>(API.vocabulary, { canonical: val, aliases: [] });
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
          e.aliases.some((a) => a.toLowerCase().includes(search.toLowerCase())),
      )
    : vocabulary;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Fixed top: description + search */}
      <div className="shrink-0 px-5 pt-5">
        <p className="text-[11px] text-muted-foreground bg-secondary border border-border rounded-md px-3 py-2 mb-4 leading-relaxed">
          Canonical tags are the display forms used in filenames. Aliases (lowercase) are alternate
          spellings the parser and LLM will recognise and map to the canonical form.
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
                      onClick={() => setEditingId(entry.id)}
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
                        <Badge key={a} variant="secondary" className="text-[10px]">
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
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            placeholder="Add canonical tag (e.g. Friends to Lovers)"
            className="flex-1"
          />
          <Button size="sm" variant="outline" onClick={handleAdd} className="gap-1.5 shrink-0">
            <Plus size={13} />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Inline editor for a single vocabulary entry ───────────────────────────────

function VocabEntryEditor({
  entry,
  onSave,
  onCancel,
}: {
  entry: VocabEntry;
  onSave: (updated: VocabEntry) => void;
  onCancel: () => void;
}) {
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
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onCancel(); }}
          placeholder="Canonical name"
          className="flex-1"
        />
        <button onClick={save} className="text-green-400 hover:text-green-300 transition-colors" title="Save">
          <Check size={15} />
        </button>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors" title="Cancel">
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
          <span className="text-[10px] text-muted-foreground/50 italic">No aliases</span>
        )}
      </div>

      {/* Add alias */}
      <div className="flex gap-1.5">
        <Input
          value={newAlias}
          onChange={(e) => setNewAlias(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addAlias(); }}
          placeholder="Add alias (lowercase)"
          className="flex-1 text-xs"
        />
        <Button variant="outline" size="sm" onClick={addAlias} className="text-xs">
          + alias
        </Button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Suppressed terms pane
// ══════════════════════════════════════════════════════════════════════════════

function SuppressedPane({
  suppressed,
  quickFill,
  onQuickFillConsumed,
  onChange,
}: {
  suppressed: SuppressedTerm[];
  quickFill?: string;
  onQuickFillConsumed: () => void;
  onChange: (suppressed: SuppressedTerm[]) => void;
}) {
  // quickFill is only set right before this pane mounts (tab switch), so using it
  // as the initial value of useState is safe — the pane always mounts fresh.
  const [addVal, setAddVal] = useState(quickFill ?? "");
  const [search, setSearch] = useState("");
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
    const row = await apiPost<SuppressedTerm>(API.suppressed, { term: val });
    onChange([...suppressed, row]);
    setAddVal("");
  }

  async function handleDelete(s: SuppressedTerm) {
    await apiDelete(API.suppressedEntry(s.id));
    onChange(suppressed.filter((x) => x.id !== s.id));
  }

  const filtered = search
    ? suppressed.filter((s) => s.term.toLowerCase().includes(search.toLowerCase()))
    : suppressed;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Fixed top: description + search */}
      <div className="shrink-0 px-5 pt-5">
        <p className="text-[11px] text-muted-foreground bg-secondary border border-border rounded-md px-3 py-2 mb-4 leading-relaxed">
          Suppressed terms are silently dropped from tag output. Use these for noisy OCR
          artefacts or format identifiers (e.g. <code className="text-primary">f4a</code>,&nbsp;
          <code className="text-primary">tolovers</code>) that should never appear as tags.
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

      {/* Fixed bottom: add row */}
      <div className="shrink-0 px-5 pt-3 pb-5 border-t border-border">
        <div className="flex gap-2">
          <Input
            ref={addRef}
            value={addVal}
            onChange={(e) => setAddVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            placeholder="Add term to suppress (e.g. f4a)"
            className="flex-1"
          />
          <Button size="sm" variant="outline" onClick={handleAdd} className="gap-1.5 shrink-0">
            <ShieldOff size={13} />
            Suppress
          </Button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Patreon cookie pane
// ══════════════════════════════════════════════════════════════════════════════

function CookiePane({ open }: { open: boolean }) {
  const [status, setStatus] = useState<{ set: boolean; length: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // Refresh status whenever the pane becomes visible.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getPatreonCookieStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus({ set: false, length: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    setFeedback(null);
    try {
      const next = await setPatreonCookie(trimmed);
      setStatus(next);
      setDraft("");
      setFeedback({
        type: "success",
        msg: `Saved — ${next.length} chars stored locally`,
      });
    } catch (err) {
      setFeedback({ type: "error", msg: getErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm("Clear the saved Patreon cookie?")) return;
    setSaving(true);
    setFeedback(null);
    try {
      const next = await setPatreonCookie("");
      setStatus(next);
      setFeedback({ type: "success", msg: "Cookie cleared" });
    } catch (err) {
      setFeedback({ type: "error", msg: getErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Fixed top: description + status */}
      <div className="shrink-0 px-5 pt-5">
        <p className="text-[11px] text-muted-foreground bg-secondary border border-border rounded-md px-3 py-2 mb-4 leading-relaxed">
          The Patreon URL panel uses your browser session cookie to download
          posts via <code className="text-primary">patreon-dl</code>. The cookie
          is stored locally in <code className="text-primary">data/dictionary.db</code>.
          It expires periodically — refresh it from your browser when the URL
          fetch starts failing.
        </p>

        {/* Status badge */}
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
            Status
          </span>
          {status === null ? (
            <Badge variant="outline" className="text-[10px]">
              Loading…
            </Badge>
          ) : status.set ? (
            <Badge
              variant="outline"
              className="text-[10px] border-green-400/40 text-green-400"
            >
              ✓ Cookie is set ({status.length} chars)
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] border-destructive/40 text-destructive/80"
            >
              ✗ Not set
            </Badge>
          )}
          {status?.set && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={saving}
              className="ml-auto text-[11px] gap-1.5 text-destructive/70 hover:text-destructive hover:border-destructive/50"
            >
              <Trash2 size={12} />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Scrollable middle: textarea + help */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-3">
        <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground block mb-2">
          New cookie value
        </label>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="patreon_device_id=…; session_id=…; cf_clearance=…; …"
          className="font-mono text-[11px] min-h-32 leading-relaxed wrap-break-word"
          spellCheck={false}
        />

        {/* Inline feedback after save */}
        {feedback && (
          <div
            className={`flex items-center gap-2 text-[11px] mt-2 min-h-4 ${
              feedback.type === "success" ? "text-green-400" : "text-destructive"
            }`}
          >
            {feedback.type === "success" ? "✓ " : "✗ "}
            {feedback.msg}
          </div>
        )}

        {/* Help drawer */}
        <button
          className="mt-5 flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-primary transition-colors tracking-[0.06em] select-none"
          onClick={() => setHelpOpen((v) => !v)}
        >
          {helpOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          How do I get my cookie?
        </button>

        {helpOpen && (
          <div className="mt-2 bg-secondary border border-border rounded-md p-4 text-[11px] text-muted-foreground leading-relaxed">
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>
                Open <a
                  href="https://www.patreon.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-2 hover:underline"
                >patreon.com</a> in a new tab and log in.
              </li>
              <li>
                Open DevTools (<kbd className="text-[10px] px-1 py-0.5 rounded border border-border bg-background">F12</kbd>)
                and switch to the <strong className="text-foreground">Network</strong> tab.
              </li>
              <li>
                Filter to <strong className="text-foreground">Doc</strong> and reload the page so the
                document request appears.
              </li>
              <li>
                Click the document request → <strong className="text-foreground">Headers</strong> →
                scroll to <strong className="text-foreground">Request Headers</strong> → right-click the
                <code className="text-primary mx-1">cookie:</code>line → <strong className="text-foreground">Copy value</strong>.
              </li>
              <li>
                Paste the entire value above and click <strong className="text-foreground">Save</strong>.
                Don&apos;t include the leading <code className="text-primary">cookie:</code> label.
              </li>
            </ol>
            <p className="mt-3 text-muted-foreground/80">
              See the <a
                href="https://github.com/patrickkfkan/patreon-dl/wiki/How-to-obtain-Cookie"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >patreon-dl wiki</a> for screenshots.
            </p>
          </div>
        )}
      </div>

      {/* Fixed bottom: save button */}
      <div className="shrink-0 px-5 pt-3 pb-5 border-t border-border">
        <Button
          onClick={handleSave}
          disabled={!draft.trim() || saving}
          className="w-full gap-2"
        >
          {saving ? (
            <span className="size-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
          ) : (
            <Cookie size={14} />
          )}
          {saving ? "Saving…" : "Save cookie"}
        </Button>
      </div>
    </div>
  );
}
