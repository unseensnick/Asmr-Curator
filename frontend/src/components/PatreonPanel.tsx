import { useEffect, useState } from "react";
import { Link2, Sparkles, ExternalLink, ArrowDown, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import DatePicker from "@/components/DatePicker";
import ExternalLinksHint from "@/components/ExternalLinksHint";
import PatreonResultsList from "@/components/PatreonResultsList";
import { fetchPatreonPost } from "@/lib/api";
import { parseTitleLine } from "@/lib/parser";
import type { AppDict, PatreonContentType, PatreonPost } from "@/lib/types";
import { normalizeTag, getErrorMessage, splitLogTail } from "@/lib/utils";

interface PatreonPanelProps {
  dict: AppDict;
  onExtracted: (title: string, tags: string[], artist: string) => void;
}

const CONTENT_TYPE_KEY = "patreon.contentTypes";
const ALL_CONTENT_TYPES: { value: PatreonContentType; label: string }[] = [
  { value: "audio", label: "Audio" },
  { value: "video", label: "Video" },
  { value: "image", label: "Images" },
  { value: "attachment", label: "Attachments" },
  // "External" widens the walk to every post so body-text Drive links
  // surface — the per-link Download button in ExternalLinksHint is the
  // action that pulls the actual audio via the Playwright scrape.
  { value: "external", label: "External" },
];

function loadStoredContentTypes(): PatreonContentType[] {
  try {
    const raw = localStorage.getItem(CONTENT_TYPE_KEY);
    if (!raw) return ["audio"];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return ["audio"];
    const allowed = new Set<PatreonContentType>([
      "audio", "video", "image", "attachment", "external",
    ]);
    const cleaned = parsed.filter((v): v is PatreonContentType =>
      typeof v === "string" && allowed.has(v as PatreonContentType)
    );
    return cleaned.length > 0 ? cleaned : ["audio"];
  } catch {
    return ["audio"];
  }
}

export default function PatreonPanel({ dict, onExtracted }: PatreonPanelProps) {
  const [url, setUrl] = useState("");
  const [metadataOnly, setMetadataOnly] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [contentTypes, setContentTypes] = useState<PatreonContentType[]>(
    () => loadStoredContentTypes(),
  );
  const [publishedAfter, setPublishedAfter] = useState("");
  const [publishedBefore, setPublishedBefore] = useState("");
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<{
    type: "success" | "error" | "info";
    msg: string;
  } | null>(null);
  const [post, setPost] = useState<PatreonPost | null>(null);
  const [posts, setPosts] = useState<PatreonPost[]>([]);
  const [logTail, setLogTail] = useState<string>("");

  // Persist whenever the include selection changes.
  useEffect(() => {
    try {
      localStorage.setItem(CONTENT_TYPE_KEY, JSON.stringify(contentTypes));
    } catch {
      // localStorage unavailable — non-fatal
    }
  }, [contentTypes]);

  function toggleContentType(t: PatreonContentType) {
    setContentTypes((prev) => {
      if (prev.includes(t)) {
        // Don't allow clearing all — keep at least one selected (audio fallback)
        const next = prev.filter((x) => x !== t);
        return next.length > 0 ? next : ["audio"];
      }
      return [...prev, t];
    });
  }

  function clearResult() {
    setPost(null);
    setPosts([]);
    setLogTail("");
    setStatus(null);
  }

  async function handleFetch() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setFetching(true);
    setStatus({
      type: "info",
      msg: dryRun
        ? "Dry run — walking the pipeline without writing files…"
        : metadataOnly
          ? "Fetching metadata only…"
          : "Asking patreon-dl to download…",
    });
    setPost(null);
    setPosts([]);
    setLogTail("");
    try {
      const res = await fetchPatreonPost(trimmed, {
        metadataOnly,
        contentTypes,
        publishedAfter: publishedAfter || undefined,
        publishedBefore: publishedBefore || undefined,
        dryRun,
      });
      // Dry run intentionally returns no parsed posts — the log tail is the
      // preview surface. Show the success/hint and the expandable log.
      if (res.dry_run) {
        setStatus({
          type: "info",
          msg: res.hint ?? "Dry run complete — see log below for posts patreon-dl would have downloaded.",
        });
        if (res.log_tail) setLogTail(res.log_tail);
        return;
      }
      if (res.count === 0 || res.posts.length === 0) {
        setStatus({
          type: "error",
          msg: res.hint ?? "patreon-dl downloaded nothing — check the URL or refresh your cookie",
        });
        if (res.log_tail) setLogTail(res.log_tail);
        return;
      }
      const noun = res.metadata_only ? "metadata" : "post";
      if (res.posts.length > 1) {
        // Multi-post case (creator URL): render the full list, no auto-apply.
        setPosts(res.posts);
        setStatus({
          type: "success",
          msg: `Fetched ${res.count} ${noun}s — click any row to apply`,
        });
      } else {
        // Single-post case: keep the existing single-card UI.
        setPost(res.posts[0]);
        setStatus({
          type: "success",
          msg: `Done — ${noun} ready, review and apply below`,
        });
      }
    } catch (err) {
      // Backend errors from patreon-dl often suffix a noisy log tail with
      // absolute container paths. Split it off so the status banner stays
      // readable; route the tail into the existing expandable log surface.
      const { head, logTail: tail } = splitLogTail(getErrorMessage(err));
      setStatus({ type: "error", msg: head || "Patreon fetch failed" });
      if (tail) setLogTail(tail);
    } finally {
      setFetching(false);
    }
  }

  /**
   * Pipe a post's metadata into App-level state. Mirrors the screenshot
   * extraction pipeline: split the raw title into a clean title + embedded
   * tags (pipe / parenthetical), merge with the API's user-defined tags,
   * normalise through the dictionary, dedupe.
   *
   * Used by both the single-post card (when count===1) and per-row Apply
   * buttons (when count>1). Same outcome either way.
   */
  function applyPost(p: PatreonPost) {
    const { title, embeddedTags } = parseTitleLine(p.title || "");
    const seen = new Set<string>();
    const normalised: string[] = [];
    for (const raw of [...embeddedTags, ...p.tags]) {
      const n = normalizeTag(raw, dict, { titleCase: true });
      if (n && !seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase());
        normalised.push(n);
      }
    }
    onExtracted(title || p.title || "", normalised, p.artist || "");
    setStatus({
      type: "success",
      msg: `Applied #${p.post_id} — title and tags below`,
    });
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

      {/* Metadata-only + Dry-run toggles */}
      <div className="mt-3 shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex items-start gap-2 cursor-pointer select-none group">
          <Checkbox
            checked={metadataOnly}
            onCheckedChange={(v) => setMetadataOnly(v === true)}
            disabled={fetching || dryRun}
            className="mt-0.5 shrink-0"
          />
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] font-medium text-foreground group-hover:text-primary transition-colors">
              Metadata only
            </span>
            <span className="text-[10px] text-muted-foreground/80 leading-relaxed">
              Skip audio download. Use when the file is already on disk; metadata
              still gets saved.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer select-none group">
          <Checkbox
            checked={dryRun}
            onCheckedChange={(v) => setDryRun(v === true)}
            disabled={fetching || metadataOnly}
            className="mt-0.5 shrink-0"
          />
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] font-medium text-foreground group-hover:text-primary transition-colors">
              Dry run
            </span>
            <span className="text-[10px] text-muted-foreground/80 leading-relaxed">
              Preview only — writes nothing to disk. Shows the log of what would
              be downloaded.
            </span>
          </span>
        </label>
      </div>

      {/* Include media-type toggles. Disabled when nothing's going to be downloaded
          anyway (metadata-only or dry-run). */}
      <div
        className={`mt-3 shrink-0 transition-opacity ${
          metadataOnly ? "opacity-40 pointer-events-none" : ""
        }`}
      >
        <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground mb-1.5">
          Include
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_CONTENT_TYPES.map(({ value, label }) => {
            const active = contentTypes.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleContentType(value)}
                disabled={fetching || metadataOnly}
                className={`text-[10px] tracking-[0.06em] px-2.5 py-1 rounded-md border transition-colors ${
                  active
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-secondary border-input text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-1 leading-relaxed">
          Audio-only by default. Pick <strong>External</strong> too if posts only have a Drive link in their body. Untoggling everything reverts to audio.
        </p>
      </div>

      {/* Date range filter — only meaningful for creator URLs; no-op on single posts */}
      <div className="mt-3 shrink-0">
        <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground mb-1.5">
          Published between
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground/80">After</span>
            <DatePicker
              value={publishedAfter}
              onChange={setPublishedAfter}
              placeholder="any date"
              disabled={fetching}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground/80">Before</span>
            <DatePicker
              value={publishedBefore}
              onChange={setPublishedBefore}
              placeholder="any date"
              disabled={fetching}
            />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-1 leading-relaxed">
          Optional. Only applies to creator URLs. Re-fetches skip posts already downloaded.
        </p>
      </div>

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
            ? dryRun
              ? "Previewing…"
              : metadataOnly
                ? "Fetching…"
                : "Downloading…"
            : dryRun
              ? "Dry run"
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
              ? "text-success"
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
          ) : !post.external_links?.length ? (
            // No Patreon-hosted audio AND no recognised external links —
            // the extractor came up empty, surface that explicitly instead
            // of inheriting the older "metadata-only fetch" copy that
            // misled the user when External was on.
            <div className="text-[10px] text-muted-foreground/70 italic shrink-0">
              No Patreon-hosted audio and no recognised external links — open the post manually to check.
            </div>
          ) : null}

          {post.external_links && post.external_links.length > 0 && (
            <ExternalLinksHint postId={post.post_id} links={post.external_links} />
          )}

          <div className="mt-auto pt-1 shrink-0">
            <Button size="sm" variant="outline" onClick={() => applyPost(post)} className="gap-1.5">
              <ArrowDown size={13} />
              Use for filename
            </Button>
          </div>
        </div>
      )}

      {/* Result list (count > 1) — one card per post, each with its own apply button */}
      {posts.length > 0 && (
        <PatreonResultsList posts={posts} onApply={applyPost} />
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
