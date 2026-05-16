import { ArrowDown, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ExternalLinksHint from "@/components/ExternalLinksHint";
import type { PatreonPost } from "@/lib/types";

interface PatreonResultRowProps {
    post: PatreonPost;
    /**
     * Fires when the user clicks "Use for filename". Parent owns the
     * parseTitleLine + dictionary normalisation pipeline so we don't
     * duplicate it per row.
     */
    onApply: (post: PatreonPost) => void;
}

/**
 * One card per Patreon post in the multi-post list. Same visual shape as
 * the single-post preview that lives in `PatreonPanel`, just rendered
 * inside a list and with its own per-row Apply action.
 */
export default function PatreonResultRow({
    post,
    onApply,
}: PatreonResultRowProps) {
    return (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex flex-col gap-2">
            <div className="flex items-start gap-2">
                <Badge
                    variant="outline"
                    className="text-[9px] tracking-[0.1em] border-primary/40 text-primary shrink-0 mt-0.5"
                >
                    #{post.post_id}
                </Badge>
                <p className="text-xs font-medium text-foreground leading-relaxed flex-1 min-w-0 wrap-break-word">
                    {post.title || (
                        <span className="text-muted-foreground italic">
                            untitled
                        </span>
                    )}
                </p>
            </div>

            {post.artist && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <User size={11} className="text-primary/80" />
                    <span>{post.artist}</span>
                </div>
            )}

            {post.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {post.tags.map((t) => (
                        <Badge
                            key={t}
                            variant="secondary"
                            className="text-[10px]"
                        >
                            {t}
                        </Badge>
                    ))}
                </div>
            )}

            {post.audio_path ? (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground wrap-break-word">
                    <span className="text-primary/80">audio →</span>
                    <code className="font-mono break-all">
                        {post.audio_path}
                    </code>
                </div>
            ) : !post.external_links?.length ? (
                <div className="text-[10px] text-muted-foreground/70 italic">
                    No Patreon-hosted audio and no recognised external links — open the post manually to check.
                </div>
            ) : null}

            {post.external_links && post.external_links.length > 0 && (
                <ExternalLinksHint postId={post.post_id} links={post.external_links} />
            )}

            <div className="pt-1">
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onApply(post)}
                    className="gap-1.5"
                >
                    <ArrowDown size={13} />
                    Use for filename
                </Button>
            </div>
        </div>
    );
}
