import {
    Check,
    ChevronDown,
    ChevronRight,
    Folder,
    FolderPlus,
    Loader2,
    Send,
    X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { API, apiGet, apiPost, buildQueryString, type FileRoot } from "@/lib/api";
import type { FileEntry, ListedDirResponse } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface MoveToLibrarySectionProps {
    selected: FileEntry;
    fromRoot: FileRoot;
    pendingNewName: string | null;
    /** Current metadata field values, sent alongside `new_name` when the
     *  rename-during-move checkbox is ticked. Matches the backend's
     *  `MetadataIn` shape — backend writes tags after the move when the
     *  destination is a metadata-compatible audio file. */
    pendingMetadata: {
        title: string;
        artist: string;
        album: string;
        album_artist: string;
    };
    /** Controlled-from-parent so the picker shares its current position
     *  with the LibraryExplorerSheet — see FileBrowser's `librarySubdir`. */
    subdir: string;
    onSubdirChange: (subdir: string) => void;
    onMoved: (toPath: string, name: string) => void;
    onError: (msg: string) => void;
}

interface MoveResponse {
    to_path: string;
    new_name: string;
    // Partial-success path: move committed, metadata embed failed. The
    // file is on disk at to_path but its tags weren't written.
    metadata_error?: string;
}

export default function MoveToLibrarySection({
    selected,
    fromRoot,
    pendingNewName,
    pendingMetadata,
    subdir,
    onSubdirChange: setSubdir,
    onMoved,
    onError,
}: MoveToLibrarySectionProps) {
    const [open, setOpen] = useState(false);
    // `subdir` is controlled from the parent (FileBrowser's
    // `librarySubdir`) so navigation here stays in sync with the
    // LibraryExplorerSheet — filing multiple files into the same
    // destination doesn't re-walk the tree.
    const [entries, setEntries] = useState<{ name: string; type: "file" | "dir" }[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [moving, setMoving] = useState(false);
    // Default off: the move-and-rename is opt-in. Was opt-out previously,
    // which silently combined the two operations and was easy to miss
    // when the user only intended to move.
    const [applyRename, setApplyRename] = useState(false);

    // Inline "+ New folder" state (creates under the currently-viewed subdir).
    const [newFolderOpen, setNewFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [newFolderBusy, setNewFolderBusy] = useState(false);

    // useCallback so the effect's deps can include loadSubdir cleanly
    // (without it, the function ref churns every render and the
    // effect would re-fire on every render, or we'd need an
    // exhaustive-deps disable).
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

    // Lazy first load + reload on subdir change while open.
    //
    // NOTE(unseensnick): `loadSubdir` does a synchronous setLoading(true)
    // to show the spinner before the fetch arrives — the rule flags
    // this as set-state-in-effect, but it's the standard data-fetching
    // pattern recommended in the React docs.
    useEffect(() => {
        if (!open) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- see NOTE above
        loadSubdir(subdir);
    }, [open, subdir, loadSubdir]);

    function drillInto(name: string) {
        const next = subdir ? `${subdir}/${name}` : name;
        setSubdir(next);
        setNewFolderOpen(false);
    }

    function popTo(idx: number) {
        // idx === -1 jumps to library root; otherwise the index points at
        // the breadcrumb segment to land on.
        if (idx < 0) {
            setSubdir("");
            return;
        }
        const segments = subdir.split("/");
        setSubdir(segments.slice(0, idx + 1).join("/"));
        setNewFolderOpen(false);
    }

    async function handleMove() {
        setMoving(true);
        onError("");
        try {
            const body: Record<string, unknown> = {
                from_path: selected.path,
                from_root: fromRoot,
                to_subdir: subdir,
            };
            if (applyRename && pendingNewName) {
                body.new_name = pendingNewName;
                body.metadata = pendingMetadata;
            }
            const data = await apiPost<MoveResponse>(API.move, body);
            setOpen(false);
            // Partial-success path: move committed but metadata embed
            // failed. Surface as a warning so the user knows tags didn't
            // get written; the file is at its new location either way.
            if (data.metadata_error) {
                onError(`Moved, but metadata embed failed: ${data.metadata_error}`);
            }
            onMoved(data.to_path, data.new_name);
        } catch (e) {
            onError("Move failed: " + getErrorMessage(e));
        } finally {
            setMoving(false);
        }
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
            // Drill into the just-created folder so the user can click
            // Move here immediately. Reloads the picker contents on the
            // way (effect on `subdir`).
            drillInto(name);
        } catch (e) {
            onError("Couldn't create folder: " + getErrorMessage(e));
        } finally {
            setNewFolderBusy(false);
        }
    }

    const breadcrumbs = subdir ? subdir.split("/") : [];
    const destinationLabel = subdir ? `Library / ${subdir}` : "Library";

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    className="group/move flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-1 px-1 -mx-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 w-fit"
                >
                    <ChevronDown
                        size={14}
                        aria-hidden
                        className="transition-transform motion-safe:duration-200 motion-safe:ease-out group-data-[state=closed]/move:-rotate-90"
                    />
                    Move to library
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1">
                <div className="pt-3 flex flex-col gap-3">
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
                            <FolderPlus
                                size={14}
                                aria-hidden
                                className="text-muted-foreground shrink-0"
                            />
                            <Input
                                autoFocus
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

                    {/* Optional rename-during-move toggle */}
                    {pendingNewName && (
                        <label className="flex items-start gap-2 cursor-pointer select-none">
                            <Checkbox
                                checked={applyRename}
                                onCheckedChange={(v) => setApplyRename(v === true)}
                                className="mt-0.5 shrink-0"
                            />
                            <span className="text-xs text-muted-foreground leading-relaxed">
                                Rename to{" "}
                                <span className="font-mono text-foreground">{pendingNewName}</span>{" "}
                                during the move.
                            </span>
                        </label>
                    )}

                    {/* Destination + commit */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-muted-foreground flex-1 min-w-0">
                            Moving to:{" "}
                            <span className="font-mono text-foreground break-all">
                                {destinationLabel}
                            </span>
                        </span>
                        <Button
                            onClick={handleMove}
                            disabled={moving}
                            className="gap-2 shrink-0"
                            size="lg"
                        >
                            {moving ? (
                                <Loader2 size={14} aria-hidden className="animate-spin" />
                            ) : (
                                <Send size={14} aria-hidden />
                            )}
                            {moving ? "Moving" : "Move here"}
                        </Button>
                    </div>
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
