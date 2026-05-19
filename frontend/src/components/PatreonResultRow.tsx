import { User } from "lucide-react";

import ExternalLinksHint from "@/components/ExternalLinksHint";
import { Badge } from "@/components/ui/badge";
import type { PatreonPost } from "@/lib/types";

interface PatreonResultRowProps {
  post: PatreonPost;
  /**
   * Fires when the user activates the row. Parent owns the
   * parseTitleLine + dictionary normalisation pipeline so we don't
   * duplicate it per row.
   */
  onApply: (post: PatreonPost) => void;
}

/**
 * One row in the multi-post list. The row's primary content is the apply
 * trigger (whole title area is a button). External-link disclosure renders
 * as a sibling so its anchor tags stay reachable to keyboards and screen
 * readers without nesting interactive elements inside a button.
 */
export default function PatreonResultRow({
  post,
  onApply,
}: PatreonResultRowProps) {
  const hasExternal = (post.external_links?.length ?? 0) > 0;

  return (
    <div className="group/row rounded-lg border border-border hover:border-muted-foreground/40 transition-colors overflow-hidden bg-background/60">
      <button
        type="button"
        onClick={() => onApply(post)}
        className="w-full text-left p-4 flex flex-col gap-2.5 hover:bg-accent/40 focus-visible:outline-none focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset transition-colors"
      >
        <div className="flex items-start gap-2.5 min-w-0">
          <Badge
            variant="outline"
            className="font-mono text-[10px] tracking-wide shrink-0 mt-0.5"
          >
            #{post.post_id}
          </Badge>
          <span className="text-sm font-medium text-foreground leading-snug flex-1 min-w-0 wrap-break-word">
            {post.title || (
              <span className="text-muted-foreground italic font-normal">
                Untitled post
              </span>
            )}
          </span>
        </div>

        {(post.artist || post.tags.length > 0) && (
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 text-xs">
            {post.artist && (
              <span className="text-muted-foreground flex items-center gap-1.5">
                <User size={12} aria-hidden />
                {post.artist}
              </span>
            )}
            {post.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {post.tags.map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {post.audio_path ? (
          <div className="flex items-baseline gap-2 text-xs min-w-0">
            <span className="text-muted-foreground/80 shrink-0">Saved to</span>
            <code className="font-mono text-foreground/80 break-all min-w-0">
              {post.audio_path}
            </code>
          </div>
        ) : !hasExternal ? (
          <p className="text-xs text-muted-foreground/70 italic">
            No audio and no recognised links. Open the post manually to check.
          </p>
        ) : null}
      </button>

      {hasExternal && (
        <div className="px-4 pb-3 -mt-1">
          <ExternalLinksHint
            postId={post.post_id}
            artist={post.artist}
            title={post.title}
            links={post.external_links ?? []}
          />
        </div>
      )}
    </div>
  );
}
