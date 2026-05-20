import { useEffect, useRef, useState } from "react";
import { ChevronDown, FlaskConical, Info, Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { API, apiPost } from "@/lib/api";
import { parseLlmJson, parseTitleLine } from "@/lib/parser";
import type { AppDict } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

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

export default function DictionaryTester({ dict, onQuickFix }: DictionaryTesterProps) {
    const [raw, setRaw] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<PreviewResult | null>(null);
    const [rawLlmText, setRawLlmText] = useState("");
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
        setHasRun(true);
        try {
            const { raw_text } = await apiPost<{ raw_text: string }>(API.previewTags, {
                text: raw,
            });
            setRawLlmText(raw_text);

            const { raw_title_line, raw_pill_tags } = parseLlmJson(raw_text);
            const { title, embeddedTags } = parseTitleLine(raw_title_line);

            const seen = new Set<string>();
            const rawTagList: string[] = [];
            for (const t of [...embeddedTags, ...raw_pill_tags]) {
                const k = t.trim().toLowerCase();
                if (k && !seen.has(k)) {
                    seen.add(k);
                    rawTagList.push(t.trim());
                }
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

    const matchedCount = result?.tags.filter((t) => t.canonical).length ?? 0;
    const novelCount = result?.tags.filter((t) => !t.canonical && !t.suppressed).length ?? 0;
    const suppressedCount = result?.tags.filter((t) => t.suppressed).length ?? 0;

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Top: help + textarea + preview button */}
            <div className="shrink-0 px-6 pt-5 pb-3 flex flex-col gap-3">
                <p className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
                    <Info
                        size={14}
                        aria-hidden
                        className="shrink-0 mt-1 text-muted-foreground/70"
                    />
                    <span>
                        Paste raw post text to see how the LLM extracts title and tags against your
                        vocabulary. Uses the same Ollama backend as the Screenshot panel.
                    </span>
                </p>

                <Textarea
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    rows={5}
                    placeholder="Paste raw title / tag text here."
                    className="resize-y leading-relaxed max-h-64"
                    aria-label="Raw post text"
                />

                <div className="flex items-center justify-end gap-3">
                    <Button onClick={run} disabled={loading || !raw.trim()} className="gap-2">
                        {loading ? (
                            <Loader2 size={14} aria-hidden className="animate-spin" />
                        ) : (
                            <FlaskConical size={14} aria-hidden />
                        )}
                        {loading ? "Previewing" : "Preview"}
                    </Button>
                </div>

                {error && (
                    <Alert variant="destructive" className="py-2">
                        <AlertDescription className="text-sm">{error}</AlertDescription>
                    </Alert>
                )}
            </div>

            {/* Scrollable results / empty state */}
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
                {result ? (
                    <div className="flex flex-col gap-3 pt-2">
                        {/* Title block */}
                        <div className="bg-muted/40 border border-border rounded-lg px-4 py-3">
                            <p className="text-sm font-medium tracking-wide text-muted-foreground mb-1">
                                Title
                            </p>
                            <p className="text-base font-medium text-foreground break-words">
                                {result.title || (
                                    <em className="text-muted-foreground font-normal italic">
                                        none extracted
                                    </em>
                                )}
                            </p>
                        </div>

                        {/* Tags block */}
                        <div className="bg-muted/40 border border-border rounded-lg px-4 py-3">
                            <p className="text-sm font-medium tracking-wide text-muted-foreground mb-2">
                                Tags
                                <span className="font-mono text-xs ml-2 tabular-nums">
                                    {result.tags.length}
                                </span>
                            </p>
                            {result.tags.length === 0 ? (
                                <p className="text-sm text-muted-foreground italic">
                                    No tags extracted.
                                </p>
                            ) : (
                                <div className="flex flex-col">
                                    {result.tags.map((t, i) => (
                                        <TagRow
                                            key={i}
                                            tag={t}
                                            onAddToVocab={() => onQuickFix("vocab", t.raw)}
                                            onSuppress={() => onQuickFix("suppress", t.raw)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Summary */}
                        {result.tags.length > 0 && (
                            <p className="text-xs text-muted-foreground font-mono tabular-nums">
                                {matchedCount} matched · {novelCount} novel · {suppressedCount}{" "}
                                suppressed
                            </p>
                        )}

                        {/* Raw LLM output */}
                        {rawLlmText && (
                            <Collapsible>
                                <CollapsibleTrigger asChild>
                                    <button
                                        type="button"
                                        className="group/rawllm flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-1 px-1 -mx-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 w-fit"
                                    >
                                        <ChevronDown
                                            size={14}
                                            aria-hidden
                                            className="transition-transform motion-safe:duration-200 motion-safe:ease-out group-data-[state=closed]/rawllm:-rotate-90"
                                        />
                                        Raw LLM output
                                    </button>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1">
                                    <pre className="mt-2 bg-muted/40 border border-border rounded-md p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap wrap-break-word max-h-48 overflow-y-auto leading-relaxed">
                                        {rawLlmText}
                                    </pre>
                                </CollapsibleContent>
                            </Collapsible>
                        )}
                    </div>
                ) : (
                    !hasRun &&
                    !loading &&
                    !error && (
                        <div className="h-full flex flex-col items-center justify-center gap-3 text-center pb-8">
                            <FlaskConical
                                size={32}
                                strokeWidth={1.5}
                                aria-hidden
                                className="text-muted-foreground/30"
                            />
                            <p className="text-sm text-muted-foreground/80 max-w-sm leading-relaxed">
                                Paste text above and click Preview.
                            </p>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}

interface TagRowProps {
    tag: AnnotatedTag;
    onAddToVocab: () => void;
    onSuppress: () => void;
}

function TagRow({ tag, onAddToVocab, onSuppress }: TagRowProps) {
    if (tag.suppressed) {
        return (
            <div className="flex items-center gap-2 flex-wrap py-1.5">
                <span className="font-mono text-sm text-muted-foreground line-through">
                    {tag.raw}
                </span>
                <StatusPill kind="suppressed" />
            </div>
        );
    }
    if (tag.canonical) {
        const wasDifferent = tag.canonical.toLowerCase() !== tag.raw.toLowerCase();
        return (
            <div className="flex items-center gap-2 flex-wrap py-1.5">
                <span className="font-mono text-sm text-foreground">{tag.canonical}</span>
                <StatusPill kind="matched" />
                {wasDifferent && (
                    <span className="font-mono text-xs text-muted-foreground/70">
                        (was: {tag.raw})
                    </span>
                )}
            </div>
        );
    }
    return (
        <div className="flex items-center gap-2 flex-wrap py-1.5">
            <span className="font-mono text-sm text-foreground">{tag.raw}</span>
            <StatusPill kind="novel" />
            <div className="flex items-center gap-1.5 ml-auto">
                <Button
                    variant="outline"
                    size="xs"
                    onClick={onAddToVocab}
                    className="text-info border-info/40 hover:bg-info/10 hover:text-info"
                >
                    Add to vocabulary
                </Button>
                <Button
                    variant="outline"
                    size="xs"
                    onClick={onSuppress}
                    className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                >
                    Suppress
                </Button>
            </div>
        </div>
    );
}

function StatusPill({ kind }: { kind: "matched" | "novel" | "suppressed" }) {
    if (kind === "matched") {
        return (
            <span className="text-xs px-1.5 py-0.5 rounded bg-success/15 text-success border border-success/30 font-medium">
                Matched
            </span>
        );
    }
    if (kind === "novel") {
        return (
            <span className="text-xs px-1.5 py-0.5 rounded bg-info/15 text-info border border-info/30 font-medium">
                Novel
            </span>
        );
    }
    return (
        <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/30 font-medium">
            Suppressed
        </span>
    );
}
