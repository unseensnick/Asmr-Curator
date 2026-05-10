import { useState } from "react";
import { Link2, Sparkles, ExternalLink, ArrowDown, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { fetchPatreonPost } from "@/lib/api";
import { parseTitleLine } from "@/lib/parser";
import type { AppDict, PatreonPost } from "@/lib/types";
import { normalizeTag, getErrorMessage } from "@/lib/utils";

interface PatreonPanelProps {
  dict: AppDict;
  onExtracted: (title: string, tags: string[], artist: string) => void;
}

export default function PatreonPanel({ dict, onExtracted }: PatreonPanelProps) {
  const [url, setUrl] = useState("");
  const [metadataOnly, setMetadataOnly] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<{
    type: "success" | "error" | "info";
    msg: string;
  } | null>(null);
  const [post, setPost] = useState<PatreonPost | null>(null);
  const [logTail, setLogTail] = useState<string>("");

  function clearResult() {
    setPost(null);
    setLogTail("");
    setStatus(null);
  }

  async function handleFetch() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setFetching(true);
    setStatus({
      type: "info",
      msg: metadataOnly ? "Fetching metadata only…" : "Asking patreon-dl to download…",
    });
    setPost(null);
    setLogTail("");
    try {
      const res = await fetchPatreonPost(trimmed, { metadataOnly });
      if (res.count === 0 || res.posts.length === 0) {
        setStatus({
          type: "error",
          msg: res.hint ?? "patreon-dl downloaded nothing — check the URL or refresh your cookie",
        });
        if (res.log_tail) setLogTail(res.log_tail);
        return;
      }
      const first = res.posts[0];
      setPost(first);
      const noun = res.metadata_only ? "metadata" : "post";
      setStatus({
        type: "success",
        msg:
          res.count === 1
            ? `Done — ${noun} ready, review and apply below`
            : `Fetched ${res.count} ${noun}s — first shown below`,
      });
    } catch (err) {
      setStatus({ type: "error", msg: getErrorMessage(err) });
    } finally {
      setFetching(false);
    }
  }

  function handleApply() {
    if (!post) return;
    // Mirror the screenshot pipeline: split the raw title into a clean title
    // plus embedded tags (pipe / parenthetical), then merge with the API's
    // user-defined tags, normalise through the dictionary, dedupe.
    const { title, embeddedTags } = parseTitleLine(post.title || "");
    const seen = new Set<string>();
    const normalised: string[] = [];
    for (const raw of [...embeddedTags, ...post.tags]) {
      const n = normalizeTag(raw, dict, { titleCase: true });
      if (n && !seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase());
        normalised.push(n);
      }
    }
    onExtracted(title || post.title || "", normalised, post.artist || "");
    setStatus({ type: "success", msg: "Applied to title and tags below" });
  }

  return (
    <Card className="flex-1 flex flex-col rounded-xl border border-border shadow-none ring-0 p-5 gap-0">
      {/* URL field */}
      <div className="shrink-0">
        <div className="relative">
          <Link2
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"
          />
          <Input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (post) clearResult();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !fetching && url.trim()) handleFetch();
            }}
            placeholder="https://www.patreon.com/posts/…"
            className="pl-9 font-mono text-xs"
            spellCheck={false}
          />
        </div>
        <p className="text-[10px] text-muted-foreground/80 mt-1.5 px-0.5">
          Single post URL or creator URL. Cookie must be set in the dictionary modal first.
        </p>
      </div>

      {/* Metadata-only toggle */}
      <label className="flex items-start gap-2 mt-3 shrink-0 cursor-pointer select-none group">
        <Checkbox
          checked={metadataOnly}
          onCheckedChange={(v) => setMetadataOnly(v === true)}
          disabled={fetching}
          className="mt-0.5 shrink-0"
        />
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[11px] font-medium text-foreground group-hover:text-primary transition-colors">
            Metadata only
          </span>
          <span className="text-[10px] text-muted-foreground/80 leading-relaxed">
            Skip the audio download. Use when the file is already on disk and you only
            need the title + tags. Faster.
          </span>
        </span>
      </label>

      {/* Fetch button */}
      <div className="mt-3 shrink-0">
        <Button
          className="w-full gap-2"
          disabled={!url.trim() || fetching}
          onClick={handleFetch}
        >
          {fetching ? (
            <span className="size-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {fetching
            ? metadataOnly
              ? "Fetching…"
              : "Downloading…"
            : metadataOnly
              ? "Fetch metadata"
              : "Fetch from Patreon"}
        </Button>
      </div>

      {/* Status line */}
      {status && (
        <div
          className={`flex items-center gap-2 text-[11px] mt-2 min-h-4 shrink-0 ${
            status.type === "success"
              ? "text-green-400"
              : status.type === "error"
                ? "text-destructive"
                : "text-muted-foreground"
          }`}
        >
          {status.type === "info" && fetching && (
            <span className="size-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin shrink-0" />
          )}
          {status.type === "success" && "✓ "}
          {status.type === "error" && "✗ "}
          {status.msg}
        </div>
      )}

      {/* Result card */}
      {post && (
        <div className="mt-3 flex-1 min-h-0 flex flex-col rounded-lg border border-primary/20 bg-primary/5 p-3 gap-2 overflow-hidden">
          <div className="flex items-start gap-2 shrink-0">
            <Badge
              variant="outline"
              className="text-[9px] tracking-[0.1em] border-primary/40 text-primary shrink-0 mt-0.5"
            >
              #{post.post_id}
            </Badge>
            <p className="text-xs font-medium text-foreground leading-relaxed flex-1 min-w-0 wrap-break-word">
              {post.title || <span className="text-muted-foreground italic">untitled</span>}
            </p>
          </div>

          {post.artist && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
              <User size={11} className="text-primary/80" />
              <span>{post.artist}</span>
            </div>
          )}

          {post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 shrink-0">
              {post.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}

          {post.audio_path ? (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground shrink-0 wrap-break-word">
              <span className="text-primary/80">audio →</span>
              <code className="font-mono break-all">{post.audio_path}</code>
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground/70 italic shrink-0">
              metadata-only fetch — no audio downloaded
            </div>
          )}

          <div className="mt-auto pt-1 shrink-0">
            <Button size="sm" variant="outline" onClick={handleApply} className="gap-1.5">
              <ArrowDown size={13} />
              Use for filename
            </Button>
          </div>
        </div>
      )}

      {/* Log tail (only on count==0 / failure) */}
      {logTail && (
        <details className="mt-3 shrink-0">
          <summary className="text-[10px] text-muted-foreground hover:text-primary tracking-[0.06em] cursor-pointer select-none flex items-center gap-1.5">
            <ExternalLink size={11} />
            patreon-dl log tail
          </summary>
          <pre className="mt-2 bg-secondary border border-border rounded-md p-3 text-[10px] text-muted-foreground whitespace-pre-wrap wrap-break-word max-h-42.5 overflow-y-auto leading-relaxed">
            {logTail}
          </pre>
        </details>
      )}
    </Card>
  );
}
