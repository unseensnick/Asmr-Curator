import { useEffect, useRef, useState } from "react";
import { FlaskConical, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { parseLlmJson, parseTitleLine } from "@/lib/parser";
import { apiPost, API } from "@/lib/api";
import type { AppDict } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnnotatedTag {
  raw: string;
  canonical: string | null;
  suppressed: boolean;
}

interface PreviewResult {
  title: string;
  tags: AnnotatedTag[];
}

export interface DictionaryTesterProps {
  dict: AppDict;
  onQuickFix: (action: "vocab" | "suppress", token: string) => void;
}

// ── DictionaryTester ────────────────────────────────────────────────────────────

export default function DictionaryTester({ dict, onQuickFix }: DictionaryTesterProps) {
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [rawLlmText, setRawLlmText] = useState("");
  const [debugOpen, setDebugOpen] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [result]);

  async function run() {
    if (!raw.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setRawLlmText("");
    setDebugOpen(false);
    setHasRun(true);
    try {
      const { raw_text } = await apiPost<{ raw_text: string }>(API.previewTags, { text: raw });
      setRawLlmText(raw_text);

      const { raw_title_line, raw_pill_tags } = parseLlmJson(raw_text);
      const { title, embeddedTags } = parseTitleLine(raw_title_line);

      const seen = new Set<string>();
      const rawTagList: string[] = [];
      for (const t of [...embeddedTags, ...raw_pill_tags]) {
        const k = t.trim().toLowerCase();
        if (k && !seen.has(k)) { seen.add(k); rawTagList.push(t.trim()); }
      }

      const tags: AnnotatedTag[] = rawTagList.map((tag) => {
        const key = tag.trim().toLowerCase();
        return {
          raw: tag,
          canonical: dict._canonicalMap[key] ?? null,
          suppressed: dict._suppressed.has(key),
        };
      });

      setResult({ title, tags });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const novelTags = result?.tags.filter((t) => !t.canonical && !t.suppressed) ?? [];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Fixed top: description, textarea, run button */}
      <div className="shrink-0 px-5 pt-5 flex flex-col gap-4">
        <p className="text-[11px] text-muted-foreground bg-secondary border border-border rounded-md px-3 py-2 leading-relaxed">
          Paste raw post text to see how the LLM extracts title and tags against the current
          vocabulary. Novel tags (not in vocabulary) can be added or suppressed directly.
        </p>

        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={5}
          placeholder="Paste raw title / tag text here…"
          className="resize-y leading-relaxed max-h-64"
        />

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={run} disabled={loading || !raw.trim()} className="gap-1.5 ml-auto">
            {loading ? (
              <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <FlaskConical size={13} />
            )}
            {loading ? "Asking LLM…" : "Preview"}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="py-2 text-[11px]">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Scrollable results / empty state */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5">
        {result ? (
          <div className="flex flex-col gap-3 text-sm py-4">
            {/* Title */}
            <div className="bg-secondary border border-border rounded-lg px-4 py-3">
              <div className="text-[10px] text-muted-foreground tracking-widest uppercase mb-1">Title</div>
              <div className="text-foreground font-medium">
                {result.title || <em className="text-muted-foreground">none extracted</em>}
              </div>
            </div>

            {/* Tags */}
            <div className="bg-secondary border border-border rounded-lg px-4 py-3">
              <div className="text-[10px] text-muted-foreground tracking-widest uppercase mb-2">
                Tags ({result.tags.length})
              </div>
              {result.tags.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">No tags extracted</span>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {result.tags.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 flex-wrap">
                      {t.suppressed ? (
                        <>
                          <span className="text-xs line-through text-muted-foreground min-w-35">{t.raw}</span>
                          <Badge variant="destructive" className="text-[9px]">suppressed</Badge>
                        </>
                      ) : t.canonical ? (
                        <>
                          <span className="text-foreground text-xs min-w-35">{t.canonical}</span>
                          <Badge className="text-[9px] bg-success/20 text-success border-success/30">matched</Badge>
                          {t.canonical.toLowerCase() !== t.raw.toLowerCase() && (
                            <span className="text-[10px] text-muted-foreground/60">← {t.raw}</span>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="text-foreground text-xs min-w-35">{t.raw}</span>
                          <Badge className="text-[9px] bg-info/20 text-info border-info/30">novel</Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onQuickFix("vocab", t.raw)}
                            className="text-[10px] h-auto py-0.5 px-2 border-info/40 text-info hover:bg-info/10 hover:text-info/80"
                          >
                            + Add to vocabulary
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onQuickFix("suppress", t.raw)}
                            className="text-[10px] h-auto py-0.5 px-2 border-destructive/30 text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                          >
                            Suppress
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Summary line */}
            {result.tags.length > 0 && (
              <div className="text-[10px] text-muted-foreground">
                {result.tags.filter((t) => t.canonical).length} matched ·{" "}
                {novelTags.length} novel ·{" "}
                {result.tags.filter((t) => t.suppressed).length} suppressed
              </div>
            )}

            {/* Raw LLM output */}
            {rawLlmText && (
              <div>
                <button
                  className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-primary transition-colors tracking-[0.06em] select-none"
                  onClick={() => setDebugOpen((v) => !v)}
                >
                  {debugOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Raw LLM output
                </button>
                {debugOpen && (
                  <pre className="mt-2 bg-secondary border border-border rounded-md p-3 text-[10px] text-muted-foreground whitespace-pre-wrap wrap-break-word max-h-40 overflow-y-auto leading-relaxed">
                    {rawLlmText}
                  </pre>
                )}
              </div>
            )}
          </div>
        ) : (
          !hasRun && !loading && !error && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center pb-8">
              <FlaskConical size={38} strokeWidth={1} className="text-muted-foreground/20" />
              <p className="text-xs text-muted-foreground/40 leading-relaxed max-w-55">
                Paste a raw post title above and click Preview to test tag extraction against your vocabulary
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
