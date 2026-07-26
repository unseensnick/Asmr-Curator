import PatreonResultRow from "@/components/PatreonResultRow";
import type { PatreonPost } from "@/lib/types";

interface PatreonResultsListProps {
    posts: PatreonPost[];
    onApply: (post: PatreonPost) => void;
    /** Threaded to each row's external-links convert controls. */
    powerMode?: boolean;
}

/**
 * Scrollable multi-post list rendered inside the panel's result surface.
 * The surrounding panel header (in PatreonPanel) carries the count and the
 * "Fetch another" affordance so this component stays focused on the rows.
 */
export default function PatreonResultsList({
    posts,
    onApply,
    powerMode = false,
}: PatreonResultsListProps) {
    return (
        <div className="max-h-[28rem] overflow-y-auto px-6 sm:px-7 py-4 space-y-2.5">
            {posts.map((post) => (
                <PatreonResultRow
                    key={post.post_id}
                    post={post}
                    onApply={onApply}
                    powerMode={powerMode}
                />
            ))}
        </div>
    );
}
