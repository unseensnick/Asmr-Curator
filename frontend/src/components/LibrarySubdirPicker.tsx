import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Folder, FolderPlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API, apiGet, apiPost, buildQueryString } from "@/lib/api";
import type { ListedDirResponse } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface LibrarySubdirPickerProps {
    /** Current subdir position (controlled). Empty string = library root. */
    subdir: string;
    onSubdirChange: (subdir: string) => void;
    /** Surface load + mkdir failures upstream. Called with "" to clear,
     *  matching the existing `MoveToLibrarySection` convention. */
    onError: (msg: string) => void;
}

/**
 * Folder picker for browsing into LIBRARY_PATH. Breadcrumb header, list
 * of subfolders below, inline "+ New folder" affordance for filing on
 * the fly. Used by:
 *
 *   • `MoveToLibrarySection` — the single-file Move-to-library flow
 *     inside `SelectedFilePanel`, wrapped in a Collapsible.
 *   • `BulkEditSheet` — the Move-into-library section in the bulk-edit
 *     surface, rendered inline once the user opts into a move.
 *
 * Owns its own entries + loading + new-folder state; surface decisions
 * (collapsible chrome, destination preview, commit button, rename
 * toggle) stay with the caller. Lazy first load + reload on subdir
 * change so navigation is responsive without a full refresh.
 */
export default function LibrarySubdirPicker({
    subdir,
    onSubdirChange,
    onError,
}: LibrarySubdirPickerProps) {
    const [entries, setEntries] = useState<{ name: string; type: "dir" }[] | null>(null);
    const [loading, setLoading] = useState(false);

    // Inline "+ New folder" state — creates under the currently-viewed subdir.
    const [newFolderOpen, setNewFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [newFolderBusy, setNewFolderBusy] = useState(false);
    const newFolderInputRef = useRef<HTMLInputElement | null>(null);

    // Programmatic focus on the inline new-folder input when its row
    // appears. Replaces `<Input autoFocus />` (jsx-a11y/no-autofocus)
    // while preserving the type-immediately UX.
    useEffect(() => {
        if (newFolderOpen) newFolderInputRef.current?.focus();
    }, [newFolderOpen]);

    // useCallback so the effect's deps can include loadSubdir cleanly
    // (without it, the function ref churns every render and the effect
    // would re-fire on every render, or we'd need an exhaustive-deps
    // disable).
    const loadSubdir = useCallback(
        async (s: string) => {
            setLoading(true);
            try {
                const data = await apiGet<ListedDirResponse>(
                    API.files + buildQueryString({ root: "library", subdir: s }),
                );
                setEntries(
                    data.entries
                        .filter((e) => e.type === "dir")
                        .map((e) => ({ name: e.name, type: "dir" as const })),
                );
            } catch (e) {
                onError("Couldn't load library folders: " + getErrorMessage(e));
                setEntries([]);
            } finally {
                setLoading(false);
            }
        },
        [onError],
    );

    // Reload on subdir change. Synchronous setLoading(true) is the
    // standard data-fetching pattern recommended in the React docs;
    // the rule's lint suggestion would force a worse split here.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
        loadSubdir(subdir);
    }, [subdir, loadSubdir]);

    function drillInto(name: string) {
        const next = subdir ? `${subdir}/${name}` : name;
        onSubdirChange(next);
        setNewFolderOpen(false);
    }

    function popTo(idx: number) {
        // idx === -1 jumps to library root; otherwise the index points at
        // the breadcrumb segment to land on.
        if (idx < 0) {
            onSubdirChange("");
            return;
        }
        const segments = subdir.split("/");
        onSubdirChange(segments.slice(0, idx + 1).join("/"));
        setNewFolderOpen(false);
    }

    async function handleMkdir() {
        const name = newFolderName.trim();
        if (!name) return;
        setNewFolderBusy(true);
        try {
            const body: Record<string, unknown> = { subdir: name };
            if (subdir) body.parent = subdir;
            await apiPost(API.mkdir, body);
            setNewFolderName("");
            setNewFolderOpen(false);
            // Drill into the just-created folder so the user can use it
            // immediately. Reloads the picker contents on the way (effect
            // on `subdir`).
            drillInto(name);
        } catch (e) {
            onError("Couldn't create folder: " + getErrorMessage(e));
        } finally {
            setNewFolderBusy(false);
        }
    }

    const breadcrumbs = subdir ? subdir.split("/") : [];

    return (
        <div className="flex flex-col gap-3">
            {/* Breadcrumb + actions */}
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
                <button
                    type="button"
                    onClick={() => popTo(-1)}
                    className="font-medium text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                    Library
                </button>
                {breadcrumbs.map((seg, i) => (
                    <span
                        key={i}
                        className="inline-flex items-center gap-1.5 text-muted-foreground"
                    >
                        <ChevronRight size={12} aria-hidden className="opacity-40" />
                        <button
                            type="button"
                            onClick={() => popTo(i)}
                            className="font-medium text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 break-all"
                        >
                            {seg}
                        </button>
                    </span>
                ))}
                <span className="flex items-center gap-1 ml-auto">
                    <Button
                        size="sm"
                        variant={newFolderOpen ? "default" : "outline"}
                        onClick={() => {
                            setNewFolderOpen((v) => !v);
                            setNewFolderName("");
                        }}
                        className="gap-1.5"
                        title="Create a new folder here"
                        aria-pressed={newFolderOpen}
                    >
                        <FolderPlus size={12} aria-hidden />
                        New folder
                    </Button>
                </span>
            </div>

            {/* Inline new-folder input */}
            {newFolderOpen && (
                <div className="flex gap-2 items-center bg-muted/40 border border-border rounded-md px-3 py-2">
                    <FolderPlus size={14} aria-hidden className="text-muted-foreground shrink-0" />
                    <Input
                        ref={newFolderInputRef}
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                handleMkdir();
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                setNewFolderOpen(false);
                                setNewFolderName("");
                            }
                        }}
                        placeholder="New folder name"
                        disabled={newFolderBusy}
                        aria-label="New folder name"
                        className="flex-1 h-8 font-mono text-sm"
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleMkdir}
                        disabled={newFolderBusy || !newFolderName.trim()}
                        className="shrink-0"
                        aria-label="Create folder"
                    >
                        <Check size={14} aria-hidden />
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                            setNewFolderOpen(false);
                            setNewFolderName("");
                        }}
                        disabled={newFolderBusy}
                        className="shrink-0"
                        aria-label="Cancel new folder"
                    >
                        <X size={14} aria-hidden />
                    </Button>
                </div>
            )}

            {/* Folder list */}
            <div className="bg-muted/40 border border-border rounded-md max-h-[18rem] overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 size={14} aria-hidden className="animate-spin shrink-0" />
                        Loading.
                    </div>
                ) : !entries || entries.length === 0 ? (
                    <div className="flex items-center justify-center py-6 text-sm text-muted-foreground italic px-4 text-center leading-relaxed">
                        No subfolders here. Create one to start filing.
                    </div>
                ) : (
                    entries.map((entry) => (
                        <button
                            key={entry.name}
                            type="button"
                            onClick={() => drillInto(entry.name)}
                            className="w-full text-left px-3 py-2 flex items-center gap-2.5 text-sm hover:bg-accent/40 focus-visible:outline-none focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset transition-colors group/folder"
                        >
                            <Folder
                                size={14}
                                aria-hidden
                                className="text-muted-foreground shrink-0"
                            />
                            <span className="flex-1 font-mono text-sm text-foreground break-all">
                                {entry.name}
                            </span>
                            <ChevronRight
                                size={14}
                                aria-hidden
                                className="text-muted-foreground/50 group-hover/folder:text-foreground transition-colors shrink-0"
                            />
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
