import { useState } from "react";
import { ChevronDown, Loader2, Send } from "lucide-react";

import LibrarySubdirPicker from "@/components/LibrarySubdirPicker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { API, apiPost, type FileRoot } from "@/lib/api";
import type { FileEntry } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface MoveToLibrarySectionProps {
    selected: FileEntry;
    fromRoot: FileRoot;
    pendingNewName: string | null;
    /** Current metadata field values, sent when the write-tags checkbox is
     *  ticked. Matches the backend's `MetadataIn` shape — backend writes
     *  tags after the move when the destination is a metadata-compatible
     *  audio file. Independent of the rename toggle: a move can write tags
     *  without renaming, and rename without touching tags. */
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
    const [moving, setMoving] = useState(false);
    // Default off: the move-and-rename is opt-in. Was opt-out previously,
    // which silently combined the two operations and was easy to miss
    // when the user only intended to move.
    const [applyRename, setApplyRename] = useState(false);
    // Independent of the rename toggle so tags can be written during a move
    // that leaves the filename alone.
    const [applyMetadata, setApplyMetadata] = useState(false);

    const hasMetadata = Object.values(pendingMetadata).some((v) => v.trim() !== "");

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
            }
            if (applyMetadata && hasMetadata) {
                body.metadata = pendingMetadata;
            }
            const data = await apiPost<MoveResponse>(API.move, body);
            setOpen(false);
            // Partial-success path: move committed but metadata embed
            // failed. Surface as a warning so the user knows tags didn't
            // get written; the file is at its new location either way.
            if (data.metadata_error) {
                onError(`Moved the file, but couldn't save its tags. ${data.metadata_error}`);
            }
            onMoved(data.to_path, data.new_name);
        } catch (e) {
            onError("Couldn't move the file. " + getErrorMessage(e));
        } finally {
            setMoving(false);
        }
    }

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
                    <LibrarySubdirPicker
                        subdir={subdir}
                        onSubdirChange={setSubdir}
                        onError={onError}
                    />

                    {/* Rename and tag-write are independent opt-ins — either,
                     *  both, or neither can ride along with the move. */}
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

                    {hasMetadata && (
                        <label
                            htmlFor="move-apply-metadata"
                            className="flex items-start gap-2 cursor-pointer select-none"
                        >
                            <Checkbox
                                id="move-apply-metadata"
                                checked={applyMetadata}
                                onCheckedChange={(v) => setApplyMetadata(v === true)}
                                className="mt-0.5 shrink-0"
                            />
                            <span className="text-xs text-muted-foreground leading-relaxed">
                                Write the tags above during the move.
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
