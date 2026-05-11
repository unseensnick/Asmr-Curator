import { useRef, useState } from "react";
import { useClipboard } from "@/hooks/useClipboard";
import {
  ImagePlus,
  Sparkles,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { parseLlmJson, parseTitleLine } from "@/lib/parser";
import { apiPost, API } from "@/lib/api";
import type { AppDict } from "@/lib/types";
import { normalizeTag, getErrorMessage } from "@/lib/utils";

interface ScreenshotPanelProps {
  dict: AppDict;
  onExtracted: (title: string, tags: string[], artist: string) => void;
}

interface ExtractResponse {
  raw_text: string;
}

export default function ScreenshotPanel({ dict, onExtracted }: ScreenshotPanelProps) {
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [status, setStatus] = useState<{
    type: "success" | "error" | "info";
    msg: string;
  } | null>(null);
  const [rawLlmText, setRawLlmText] = useState("");
  const [debugOpen, setDebugOpen] = useState(false);
  const { copied: debugCopied, copy: copyDebug } = useClipboard();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Image handling ────────────────────────────────────────────────────────

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setImageBase64(dataUrl.split(",")[1]);
      setPreviewUrl(dataUrl);
      setStatus(null);
      setRawLlmText("");
      setDebugOpen(false);
    };
    reader.readAsDataURL(file);
  }

  function clearImage() {
    setImageBase64(null);
    setPreviewUrl(null);
    setStatus(null);
    setRawLlmText("");
    setDebugOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave() {
    setDragOver(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }
  function onPaste(e: React.ClipboardEvent) {
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) { handleFile(f); break; }
      }
    }
  }

  // ── Extract ───────────────────────────────────────────────────────────────

  async function handleExtract() {
    if (!imageBase64) return;
    setExtracting(true);
    setStatus({ type: "info", msg: "Sending to Ollama…" });
    try {
      const { raw_text } = await apiPost<ExtractResponse>(API.extract, {
        image_b64: imageBase64,
      });

      const { raw_title_line: rawTitleLine, raw_pill_tags: rawPillTags, creator_name, creator_confidence } = parseLlmJson(raw_text);
      const { title, embeddedTags } = parseTitleLine(rawTitleLine);

      // Merge embedded title tags + LLM pill tags, normalised, deduped
      const seen = new Set<string>();
      const allTags: string[] = [];
      for (const raw of [...embeddedTags, ...rawPillTags]) {
        const normalized = normalizeTag(raw, dict, { titleCase: true });
        if (normalized && !seen.has(normalized.toLowerCase())) {
          seen.add(normalized.toLowerCase());
          allTags.push(normalized);
        }
      }

      setRawLlmText(raw_text);
      setDebugOpen(false);
      const artist = creator_confidence === "high" && creator_name ? creator_name : "";
      onExtracted(title || rawTitleLine || "", allTags, artist);
      setStatus(
        title
          ? { type: "success", msg: "Done — review and adjust below" }
          : { type: "info", msg: "No title found — fill manually" },
      );
    } catch (err) {
      setStatus({
        type: "error",
        msg: getErrorMessage(err),
      });
    } finally {
      setExtracting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Card
        className="flex-1 flex flex-col rounded-xl border border-border shadow-none ring-0 p-5 gap-0"
        onPaste={onPaste}
      >
        {/* Upload zone / preview */}
        {!previewUrl ? (
          <div
            className={`flex-1 min-h-0 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 text-center px-4 py-7 cursor-pointer transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border bg-secondary hover:border-primary hover:bg-primary/5"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) handleFile(e.target.files[0]);
              }}
            />
            <ImagePlus size={28} className="opacity-40 text-primary" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-primary font-normal">Click</strong>
              , drag &amp; drop, or{" "}
              <strong className="text-primary font-normal">Ctrl+V</strong> to paste
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-45 relative rounded-lg overflow-hidden bg-secondary">
            <img
              src={previewUrl}
              alt="Screenshot preview"
              className="absolute inset-0 w-full h-full object-contain object-top cursor-zoom-in hover:opacity-90 transition-opacity rounded-lg"
              onClick={() => setLightboxOpen(true)}
            />
            <div className="absolute top-2 right-2 flex gap-1.5 z-10">
              <button
                onClick={() => {
                  clearImage();
                  fileInputRef.current?.click();
                }}
                className="w-7 h-7 rounded-md border border-white/15 bg-background/80 backdrop-blur-sm text-foreground flex items-center justify-center hover:border-primary hover:text-primary transition-all text-sm"
                title="Change image"
              >
                ↩
              </button>
              <button
                onClick={clearImage}
                className="w-7 h-7 rounded-md border border-white/15 bg-background/80 backdrop-blur-sm text-foreground flex items-center justify-center hover:border-destructive hover:text-destructive transition-all text-sm"
                title="Remove image"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Extract button */}
        <div className="mt-3 shrink-0">
          <Button
            className="w-full gap-2"
            disabled={!imageBase64 || extracting}
            onClick={handleExtract}
          >
            {extracting ? (
              <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {extracting ? "Extracting…" : "Extract"}
          </Button>
        </div>

        {/* Status line */}
        {status && (
          <div
            className={`flex items-center gap-2 text-[11px] mt-2 min-h-4 shrink-0 ${
              status.type === "success"
                ? "text-success"
                : status.type === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
            }`}
          >
            {status.type === "info" && extracting && (
              <span className="w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin shrink-0" />
            )}
            {status.type === "success" && "✓ "}
            {status.type === "error" && "✗ "}
            {status.msg}
          </div>
        )}

        {/* Debug toggle — only shown after a successful extract */}
        {rawLlmText && (
          <div className="shrink-0 mt-3">
            <div className="flex items-center w-full">
              <button
                className="flex flex-1 items-center gap-1.5 text-[10px] text-muted-foreground hover:text-primary transition-colors tracking-[0.06em] select-none"
                onClick={() => setDebugOpen((v) => !v)}
              >
                {debugOpen ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                Raw LLM output
              </button>
              <button
                className={`flex items-center border rounded px-1.5 py-0.5 transition-all ${
                  debugCopied
                    ? "text-success border-success/30 bg-success/10"
                    : "text-muted-foreground border-transparent hover:border-border hover:text-foreground hover:bg-secondary"
                }`}
                onClick={() => copyDebug(rawLlmText)}
                title="Copy raw LLM text"
              >
                {debugCopied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>

            {debugOpen && (
              <pre className="mt-2 bg-secondary border border-border rounded-md p-3 text-[10px] text-muted-foreground whitespace-pre-wrap wrap-break-word max-h-42.5 overflow-y-auto leading-relaxed">
                <span className="text-primary font-medium">Raw LLM JSON:</span>
                {"\n"}
                {rawLlmText}
              </pre>
            )}
          </div>
        )}
      </Card>

      {/* Lightbox */}
      {lightboxOpen && previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-6 cursor-zoom-out animate-in fade-in duration-150"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-w-205 w-full cursor-default animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute -top-3.5 -right-3.5 w-7 h-7 rounded-full bg-secondary border border-border text-muted-foreground flex items-center justify-center hover:border-primary hover:text-primary transition-all text-sm"
              onClick={() => setLightboxOpen(false)}
            >
              ×
            </button>
            <img
              src={previewUrl}
              alt="Screenshot preview"
              className="w-full rounded-xl block shadow-2xl ring-1 ring-border"
            />
          </div>
        </div>
      )}
    </>
  );
}
