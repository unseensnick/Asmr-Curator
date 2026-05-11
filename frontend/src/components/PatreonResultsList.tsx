import PatreonResultRow from "@/components/PatreonResultRow";
import type { PatreonPost } from "@/lib/types";

interface PatreonResultsListProps {
    posts: PatreonPost[];
    onApply: (post: PatreonPost) => void;
}

/**
 * Scrollable multi-post list. One `PatreonResultRow` per post. Header
 * line shows the count so the user can confirm filters returned what
 * they expected.
 */
export default function PatreonResultsList({
    posts,
    onApply,
}: PatreonResultsListProps) {
    return (
        <div className="mt-3 flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
            <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground shrink-0 flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-primary shrink-0" />
                {posts.length} posts fetched
                <span className="opacity-45 text-[9px] tracking-[0.08em] font-medium normal-case">
                    — click any row to apply
                </span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-1">
                {posts.map((post) => (
                    <PatreonResultRow
                        key={post.post_id}
                        post={post}
                        onApply={onApply}
                    />
                ))}
            </div>
        </div>
    );
}
