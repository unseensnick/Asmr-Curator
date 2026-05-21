import {
    type ComponentType,
    memo,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    BookMarked,
    Check,
    ChevronRight,
    ClipboardPaste,
    File,
    Folder,
    FolderPlus,
    Inbox,
    Loader2,
    Music2,
    PenLine,
    RefreshCw,
    Scissors,
    Search,
    Trash2,
    X,
} from "lucide-react";

import SheetHeaderBar from "@/components/SheetHeaderBar";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDragSelect } from "@/hooks/useDragSelect";
import { API, apiGet, apiPost, buildQueryString, type FileRoot, moveBatchStream } from "@/lib/api";
import { METADATA_COMPATIBLE_EXTS, NEEDS_CONVERSION_EXTS } from "@/lib/audioFormats";
import { selectAll, selectionFromClick } from "@/lib/explorerSelection";
import type { FileEntry, ListedDirResponse } from "@/lib/types";
import { deferToNextMacrotask, getErrorMessage } from "@/lib/utils";

/** Debounce window for the inline filter input. Tighter than the
 *  FileBrowser tab's search because the user expects in-place filter
 *  feel, not a search-box round-trip. */
const LIBRARY_FILTER_DEBOUNCE_MS = 200;

interface LibraryExplorerSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called when the user clicks a FILE row in the explorer. Parent uses
     *  this to switch the FileBrowser to the matching tab (library or
     *  downloads) and select the file so the existing rename / convert /
     *  move flows take over. */
    onSelectFile: (file: FileEntry, root: FileRoot) => void;
    /** Shared library-subdir position. Controlled from FileBrowser so
     *  navigating here updates the Move-to-library picker in
     *  SelectedFilePanel (and vice versa). Downloads has its own local
     *  state — only the library side is shared, since the move picker is
     *  library-only. */
    librarySubdir: string;
    onLibrarySubdirChange: (subdir: string) => void;
}

// Path sentinel used by the DeleteCandidate state to route through a
// bulk-delete code path in confirmDelete (loops /api/delete per item)
// without inventing a parallel dialog component for what's a small
// branch on the same prompt.
const BULK_DELETE_SENTINEL = "__bulk:delete";

function rootLabel(root: FileRoot): string {
    return root === "library" ? "Library" : "Downloads";
}

interface Entry {
    name: string;
    type: "file" | "dir";
    ext: string | null;
    path: string;
    needs_conversion?: boolean;
    /** Search-mode only: relative-to-current-subdir folder hint rendered
     *  as a small caption under the filename so the user can disambiguate
     *  results that live deeper in the tree. Folder-listing rows leave
     *  this undefined. */
    folderHint?: string;
}

interface SearchResponse {
    files: FileEntry[];
    total: number;
    truncated?: boolean;
    limit?: number;
}

interface DeleteCandidate {
    entry: Entry;
    /** Number of items inside a folder. -1 = couldn't enumerate, 0 = empty,
     *  >0 = has contents (drives recursive delete + the "N items inside"
     *  copy in the AlertDialog). Always 0 for file candidates. */
    contentsCount: number;
    /** Bulk-delete only: the first few selected entry names + the total
     *  selection size. Surfaced in the AlertDialog so the user can
     *  sanity-check what's about to be removed before confirming —
     *  drag-select can grab one extra row by accident otherwise. */
    bulkPreview?: { names: string[]; total: number };
}

/**
 * Right-side Sheet that lets the user navigate both filesystem roots
 * (LIBRARY_PATH and DOWNLOAD_PATH) folder-by-folder. A persistent left
 * rail shows Library + Downloads as two root buttons, so switching
 * roots is always one click away — no top-level "walk in / walk out"
 * indirection. Per-root affordances:
 *
 *   • Library — full CRUD: rename, delete, new folder, recursive search,
 *     OS-style multi-select with cut/paste.
 *   • Downloads — read + rename + delete + recursive search. No new
 *     folder (the backend's `/api/mkdir` is library-only by design;
 *     downloads is transient ingest staging, not a curated tree).
 *
 * Files and folders both support right-click → Delete with confirmation.
 * Folder deletes preflight `/api/files?subdir=<folder>` to count contents,
 * so the AlertDialog can show "Delete empty folder?" vs "Delete folder
 * AND N items inside?". The backend's /api/delete endpoint enforces the
 * same semantics (rmdir for empty, shutil.rmtree only when recursive=true).
 *
 * Future enhancements:
 *   • Per-row Move from Downloads into a chosen Library subfolder
 *     (would subsume the inline move picker in SelectedFilePanel).
 *   • Drag-and-drop reorganise.
 */
export default function LibraryExplorerSheet({
    open,
    onOpenChange,
    onSelectFile,
    librarySubdir,
    onLibrarySubdirChange,
}: LibraryExplorerSheetProps) {
    // Active filesystem root. Always one of "library" / "downloads" —
    // the left rail makes both visible at all times, so there's no
    // "top-level Locations" state to fall back to.
    //
    // Subdir is per-root: the library side comes from the parent
    // (controlled, shared with the Move-to-library picker) so position
    // survives across surfaces; the downloads side is local because the
    // picker doesn't target downloads. Switching root flips between the
    // two without resetting either — each remembers its own position.
    const [root, setRoot] = useState<FileRoot>("library");
    const [downloadsSubdir, setDownloadsSubdir] = useState("");
    const subdir = root === "library" ? librarySubdir : downloadsSubdir;
    const setSubdir = (next: string) => {
        if (root === "library") onLibrarySubdirChange(next);
        else setDownloadsSubdir(next);
    };
    const [entries, setEntries] = useState<Entry[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [filter, setFilter] = useState("");

    const [newFolderOpen, setNewFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [newFolderBusy, setNewFolderBusy] = useState(false);

    const [deleteCandidate, setDeleteCandidate] = useState<DeleteCandidate | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);

    // Inline rename. `renamePath` matches a single entry's `path` while
    // the inline input is showing; `renameValue` is the typed buffer.
    // Triggered by right-click → Rename or by F2 on a focused row.
    const [renamePath, setRenamePath] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [renameBusy, setRenameBusy] = useState(false);

    // Whatever entry the user last right-clicked, or null when the
    // right-click landed somewhere that isn't a row (toolbar, breadcrumb,
    // empty list area). Drives the conditional Rename + Delete items in
    // the body-level ContextMenu — empty-area right-clicks show only the
    // New folder action.
    const [menuTarget, setMenuTarget] = useState<Entry | null>(null);

    // Library multi-select state (downloads keeps the single-click-opens
    // model — no selection state). `selectedPaths` is contextual: clears
    // when the user navigates (root or subdir change) since the selection
    // belongs to the view they were just in. `anchorPath` is the last
    // plain or toggle click — Shift-click extends from anchor to target.
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [anchorPath, setAnchorPath] = useState<string | null>(null);

    // Cut clipboard: a frozen snapshot of paths the user pressed Ctrl/Cmd+X
    // on, plus the root + subdir they were in at the time. Persists across
    // navigation (the whole point — you cut here, navigate elsewhere,
    // paste there) until paste, Escape, or Sheet close clears it.
    const [cutPaths, setCutPaths] = useState<Set<string> | null>(null);
    const [cutOrigin, setCutOrigin] = useState<{ root: FileRoot; subdir: string } | null>(null);
    const [moveBusy, setMoveBusy] = useState(false);
    // Transient post-move banner ("Moved 4 of 5. Couldn't move foo: …").
    // Cleared on next user action / close.
    const [moveNotice, setMoveNotice] = useState<string | null>(null);

    // Recursive search results. `null` means folder-listing mode (default,
    // shows the contents of the current subdir). A non-null array means
    // search mode — the filter input is non-empty and we've called
    // /api/files/search?subdir=<current>&q=… so the user can find files
    // buried deeper in the tree without drilling. Empty array = no
    // matches.
    const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null);
    const [searchBusy, setSearchBusy] = useState(false);

    // Whatever row the cursor is currently hovering, or null when the
    // cursor isn't over a row. This is the explorer's effective
    // "selection" — there's no click-to-select state because clicking
    // drills/opens, so hover is what F2 (rename) and Del (delete) act
    // on. Maintained via mouseover delegation on the body wrapper.
    const hoverRef = useRef<Entry | null>(null);
    // Closure-stable mirrors of the state that the window-level keydown
    // handler needs to read. Refs let the handler bind once per `open`
    // toggle rather than re-binding on every render (which would cause
    // listener churn during normal typing in the filter input).
    const renamePathRef = useRef<string | null>(null);
    const menuTargetRef = useRef<Entry | null>(null);
    const newFolderOpenRef = useRef(false);
    const newFolderInputRef = useRef<HTMLInputElement | null>(null);
    const rootRef = useRef<FileRoot>("library");
    const selectedPathsRef = useRef<Set<string>>(new Set());
    const anchorPathRef = useRef<string | null>(null);
    const cutPathsRef = useRef<Set<string> | null>(null);
    const cutOriginRef = useRef<{ root: FileRoot; subdir: string } | null>(null);
    const subdirRef = useRef("");
    useEffect(() => {
        renamePathRef.current = renamePath;
    }, [renamePath]);
    useEffect(() => {
        menuTargetRef.current = menuTarget;
    }, [menuTarget]);
    useEffect(() => {
        newFolderOpenRef.current = newFolderOpen;
        if (!newFolderOpen) return;
        // Auto-focus the inline input when the new-folder row opens.
        // Replaces `<Input autoFocus />` (jsx-a11y/no-autofocus). The rAF
        // defers past Radix's focus management — for the toolbar button
        // path the click's default focus settles on the button after
        // commit, and for the ContextMenu path Radix returns focus to the
        // trigger when the menu closes. Either way, the synchronous focus
        // call inside the effect was getting clobbered. Waiting one frame
        // lets that settle so our focus() wins.
        const id = requestAnimationFrame(() => {
            newFolderInputRef.current?.focus();
        });
        return () => cancelAnimationFrame(id);
    }, [newFolderOpen]);
    useEffect(() => {
        rootRef.current = root;
    }, [root]);
    useEffect(() => {
        selectedPathsRef.current = selectedPaths;
    }, [selectedPaths]);
    useEffect(() => {
        anchorPathRef.current = anchorPath;
    }, [anchorPath]);
    useEffect(() => {
        cutPathsRef.current = cutPaths;
    }, [cutPaths]);
    useEffect(() => {
        cutOriginRef.current = cutOrigin;
    }, [cutOrigin]);
    useEffect(() => {
        subdirRef.current = subdir;
    }, [subdir]);

    // Tracks the currently-rendered list (either folder entries or
    // search results) so the right-click + hover delegation can resolve
    // `data-entry-path` against the latest data without re-binding the
    // handlers on every list change.
    const visibleRef = useRef<Entry[] | null>(null);

    // Drag-select (rubber-band): the hit-test, auto-scroll RAF, and
    // window-listener lifecycle all live in `useDragSelect`. The hook
    // owns its own state for the overlay rectangle and exposes a
    // `cleanup` we can call from the Sheet's close path so a drag in
    // flight doesn't leak past unmount.
    const {
        scrollContainerRef,
        onMouseDown: handleListMouseDown,
        dragRect,
        cleanup: cleanupDragSelect,
    } = useDragSelect({
        selectedPathsRef,
        renamePathRef,
        setSelectedPaths,
        setAnchorPath,
    });

    const resolveMenuTarget = useCallback((e: ReactMouseEvent) => {
        const row = (e.target as HTMLElement | null)?.closest?.("[data-entry-path]");
        if (!row) {
            setMenuTarget(null);
            return;
        }
        const path = row.getAttribute("data-entry-path");
        const list = visibleRef.current ?? [];
        setMenuTarget(list.find((en) => en.path === path) ?? null);
    }, []);

    // Resolves the "hovered/focused row" for keyboard + pointer users. The
    // body div binds this to both onMouseOver (pointer) and onFocus
    // (keyboard) so Tab navigation across rows tracks the same target the
    // mouse would.
    const handleBodyMouseOver = useCallback((e: { target: EventTarget | null }) => {
        const row = (e.target as HTMLElement | null)?.closest?.("[data-entry-path]");
        if (!row) {
            hoverRef.current = null;
            return;
        }
        const path = row.getAttribute("data-entry-path");
        if (path === hoverRef.current?.path) return;
        const list = visibleRef.current ?? [];
        hoverRef.current = list.find((en) => en.path === path) ?? null;
    }, []);

    const handleBodyMouseLeave = useCallback(() => {
        hoverRef.current = null;
    }, []);

    const loadSubdir = useCallback(async (s: string, r: FileRoot) => {
        setLoading(true);
        setError("");
        try {
            const data = await apiGet<ListedDirResponse>(
                API.files + buildQueryString({ root: r, subdir: s }),
            );
            setEntries(data.entries);
        } catch (e) {
            setError("Couldn't load folder: " + getErrorMessage(e));
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, []);

    // Lazy first load + reload on subdir/root change while open.
    //
    // NOTE(unseensnick): `loadSubdir` does a synchronous setLoading(true)
    // before kicking off the fetch — the rule flags this as
    // set-state-in-effect, but it's the standard data-fetching pattern
    // recommended in the React docs. The synchronous flag is what shows
    // the spinner before the network response arrives; moving it into
    // `.then` (the only fix the rule would accept) would lose the
    // pre-fetch spinner. Re-evaluate if React lands a stable
    // `useEvent` / data-loader story.

    useEffect(() => {
        if (!open) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- see NOTE above
        loadSubdir(subdir, root);
    }, [open, root, subdir, loadSubdir]);

    // Recursive search effect. Empty filter → folder-listing mode
    // (searchResults stays null). Non-empty filter → debounce 200ms,
    // then GET /api/files/search scoped to the current subdir so the
    // user finds matches buried deeper without losing their place. The
    // `stale` token discards results from a superseded request.
    //
    // NOTE(unseensnick): the early-clear branches set searchResults +
    // searchBusy synchronously when filter goes empty or sheet closes.
    // `react-hooks/set-state-in-effect` flags it, but the alternative
    // (carrying the previous results forward visually until the next
    // user action) is worse UX. Standard debounced-search pattern.

    useEffect(() => {
        if (!open) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- see NOTE above
            setSearchResults(null);
            setSearchBusy(false);
            return;
        }
        const q = filter.trim();
        if (!q) {
            setSearchResults(null);
            setSearchBusy(false);
            return;
        }
        setSearchBusy(true);
        let stale = false;
        const timer = setTimeout(async () => {
            try {
                const data = await apiGet<SearchResponse>(
                    API.search +
                        buildQueryString({
                            root,
                            q,
                            search_in: "both",
                            subdir,
                        }),
                );
                if (stale) return;
                setSearchResults(data.files);
            } catch (e) {
                if (stale) return;
                setError("Couldn't search: " + getErrorMessage(e));
                setSearchResults([]);
            } finally {
                if (!stale) setSearchBusy(false);
            }
        }, LIBRARY_FILTER_DEBOUNCE_MS);
        return () => {
            stale = true;
            clearTimeout(timer);
        };
    }, [open, root, filter, subdir]);

    // On close, dismiss any in-flight inline UI (so reopening doesn't
    // resurface a half-typed new-folder name, a stale filter, or an
    // unactioned delete prompt) but PRESERVE `subdir` so the user lands
    // back where they were working. Filing a batch of 10+ posts into
    // the same subfolder is the common case; resetting to root each
    // time was death-by-clicks.
    //
    // Wrapping `onOpenChange` (instead of a useEffect on `open`) puts
    // the synchronous setState in a callback rather than an effect
    // body — satisfies `react-hooks/set-state-in-effect` and the
    // effect would have run on every open-toggle anyway, this is
    // just the same logic at the cleaner timing.
    function handleOpenChange(next: boolean) {
        if (!next) {
            setNewFolderOpen(false);
            setNewFolderName("");
            setError("");
            setFilter("");
            setDeleteCandidate(null);
            setRenamePath(null);
            setRenameValue("");
            setSearchResults(null);
            setSearchBusy(false);
            // Selection + cut clipboard live with the session, not
            // across sessions. The user typically closes the sheet
            // because they're done; leaving cut state dangling would
            // surface confusing "ready to move" UI on the next open.
            setSelectedPaths(new Set());
            setAnchorPath(null);
            setCutPaths(null);
            setCutOrigin(null);
            setMoveNotice(null);
            // Drag-select may still be live if the Sheet closed before
            // the user released the mouse. Tear it down so the window
            // listeners and auto-scroll RAF don't dangle.
            cleanupDragSelect();
        }
        onOpenChange(next);
    }

    // NOTE(unseensnick): defensive workaround for a Radix focus-scope
    // race. When nested portals (ContextMenu / AlertDialog) close out
    // of sequence with the parent Sheet, SheetContent ends up flagged
    // `aria-hidden="true"` while still containing the focused element
    // — the browser warns about it as an a11y violation. This effect
    // sweeps open SheetContent nodes after every transient overlay
    // state change and clears any stuck attribute. deferToNextMacrotask
    // lets Radix's own cleanup attempt first; we only step in if it
    // didn't finish. Re-evaluate on the next radix-ui upgrade and drop
    // if the upstream behaviour is fixed.
    // `renamePath` deliberately omitted: it changes per keystroke, but the
    // aria-hidden race only fires on overlay open/close transitions — not
    // on inline input edits. Including it would run the DOM sweep on every
    // character typed during a rename. The other deps cover the actual
    // overlay-mount transitions (menu open/close, cut clipboard, etc.).
    useEffect(() => {
        if (!open) return;
        return deferToNextMacrotask(() => {
            document
                .querySelectorAll<HTMLElement>('[data-slot="sheet-content"][data-state="open"]')
                .forEach((el) => {
                    if (el.getAttribute("aria-hidden") === "true") {
                        el.removeAttribute("aria-hidden");
                        el.removeAttribute("data-aria-hidden");
                    }
                });
        });
    }, [open, menuTarget, cutPaths, moveNotice, deleteCandidate, moveBusy]);

    // File-explorer hotkeys: N / F2 / Del.
    //
    // Why not Ctrl/Cmd+N? Every major browser reserves it for "new
    // window" at the chrome level — preventDefault on the page can't
    // beat that (Firefox in particular doesn't even hand the keystroke
    // to JS). Single-letter `n` is reliably preventable, matches the
    // app-shortcut convention used by Gmail/Linear/Notion, and stays
    // out of the way while the user is typing because we gate on the
    // event target not being an editable element. F2 and Del are the
    // OS file-explorer conventions and have no browser conflict.
    //
    // F2 / Del act on whatever the cursor is hovering, falling back to
    // the last right-clicked row. There's no "selected without
    // activated" state in this explorer (single-click drills), so hover
    // is the natural anchor for keyboard actions — pointing at a row is
    // the user's signal "I mean this one."
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const tag = target?.tagName ?? "";
            const editable =
                tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable === true;

            // Ctrl/Cmd+X — stage selection for move. Library only.
            if (
                e.key.toLowerCase() === "x" &&
                (e.ctrlKey || e.metaKey) &&
                !e.shiftKey &&
                !e.altKey &&
                !editable &&
                rootRef.current === "library"
            ) {
                if (!selectedPathsRef.current.size) return;
                e.preventDefault();
                cutSelection();
                return;
            }

            // Ctrl/Cmd+V — paste cut clipboard into current subdir.
            // Library only (the destination is always LIBRARY_PATH).
            if (
                e.key.toLowerCase() === "v" &&
                (e.ctrlKey || e.metaKey) &&
                !e.shiftKey &&
                !e.altKey &&
                !editable &&
                rootRef.current === "library"
            ) {
                if (!cutPathsRef.current?.size) return;
                e.preventDefault();
                pasteHere();
                return;
            }

            // Ctrl/Cmd+A — select every visible row. Works in both roots
            // (Library + Downloads share the selection model); gated on
            // non-editable so it doesn't fight the native select-all
            // behaviour inside the filter / rename inputs.
            if (
                e.key.toLowerCase() === "a" &&
                (e.ctrlKey || e.metaKey) &&
                !e.shiftKey &&
                !e.altKey &&
                !editable
            ) {
                const list = visibleRef.current ?? [];
                const update = selectAll(list);
                if (!update) return;
                e.preventDefault();
                setSelectedPaths(update.selected);
                setAnchorPath(update.anchor);
                return;
            }

            if (e.key === "F2") {
                if (renamePathRef.current) return;
                // With a multi-selection, F2 has no clean meaning (OS
                // explorers either rename only the anchored row or
                // refuse outright). Refuse outright + hint, so the user
                // doesn't lose their selection to a half-applied rename.
                if (selectedPathsRef.current.size > 1) {
                    setMoveNotice("Rename only works on one item at a time.");
                    return;
                }
                // Anchor wins over hover/menuTarget when a single-item
                // selection exists, so the keyboard model stays consistent
                // with "F2 renames the active row" even after mouse moves
                // away from it.
                const list = visibleRef.current ?? [];
                const fromAnchor =
                    anchorPathRef.current && selectedPathsRef.current.size === 1
                        ? (list.find((en) => en.path === anchorPathRef.current) ?? null)
                        : null;
                const ent = fromAnchor ?? hoverRef.current ?? menuTargetRef.current;
                if (!ent) return;
                e.preventDefault();
                startRename(ent);
                return;
            }

            if (e.key === "Delete" && !editable) {
                if (renamePathRef.current) return;
                // Bulk path when a multi-selection exists; otherwise
                // single-target via hover/menuTarget as before.
                if (selectedPathsRef.current.size > 1) {
                    e.preventDefault();
                    requestAnimationFrame(() => deleteSelection());
                    return;
                }
                const ent = hoverRef.current ?? menuTargetRef.current;
                if (!ent) return;
                e.preventDefault();
                // rAF for the same reason the context-menu Delete uses
                // it — let any focus-holding overlay release focus before
                // the AlertDialog mounts. Without the defer Radix applies
                // aria-hidden to the still-focused Sheet and the browser
                // logs "focus inside aria-hidden ancestor".
                requestAnimationFrame(() => requestDelete(ent));
                return;
            }

            // New folder is library-only (backend's /api/mkdir refuses
            // anything else — downloads is transient ingest staging).
            if (
                e.key.toLowerCase() === "n" &&
                !e.shiftKey &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.altKey &&
                !editable &&
                rootRef.current === "library"
            ) {
                if (renamePathRef.current || newFolderOpenRef.current) return;
                e.preventDefault();
                setNewFolderOpen(true);
                setNewFolderName("");
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
        // startRename + requestDelete are recreated each render but they
        // only call stable setState / fetch helpers, so capturing the
        // first-render closures here is safe and keeps the listener
        // bound exactly once per `open` toggle.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    /** Navigation always invalidates the previous view's local
     *  state: the selection anchor, the right-click menu target,
     *  and the multi-select set. Inlining the resets at every
     *  navigation site keeps them off React's set-state-in-effect
     *  radar — the rule (correctly) calls out reset-on-prop-change
     *  effects as a smell, and the React docs recommend handling
     *  the reset where it's caused instead. */
    function clearViewState() {
        setSelectedPaths(new Set());
        setAnchorPath(null);
        setMenuTarget(null);
    }

    function switchRoot(next: FileRoot) {
        if (next === root) return;
        // Filter is contextual to the previous root's tree (rarely useful
        // after a switch); the cut clipboard is the explicit exception —
        // it persists by design so the user can cut in one root and paste
        // in another. Subdir is per-root and lives on its own state, so
        // switching just reveals the other root's saved position.
        setRoot(next);
        setFilter("");
        setNewFolderOpen(false);
        setMoveNotice(null);
        clearViewState();
    }

    function drillInto(name: string) {
        const next = subdir ? `${subdir}/${name}` : name;
        setSubdir(next);
        setNewFolderOpen(false);
        setFilter("");
        clearViewState();
    }

    function popTo(idx: number) {
        if (idx < 0) {
            setSubdir("");
            setFilter("");
            clearViewState();
            return;
        }
        const segments = subdir.split("/");
        setSubdir(segments.slice(0, idx + 1).join("/"));
        setNewFolderOpen(false);
        setFilter("");
        clearViewState();
    }

    async function handleMkdir() {
        // /api/mkdir is library-only; the New folder UI is hidden in
        // the Downloads view, so this guard is belt-and-braces.
        if (root !== "library") return;
        const name = newFolderName.trim();
        if (!name) return;
        setNewFolderBusy(true);
        try {
            const body: Record<string, unknown> = { subdir: name };
            if (subdir) body.parent = subdir;
            await apiPost(API.mkdir, body);
            setNewFolderName("");
            setNewFolderOpen(false);
            // Drill into the just-created folder so the user can immediately
            // start filing into it (mirrors the picker's UX).
            drillInto(name);
        } catch (e) {
            setError("Couldn't create folder: " + getErrorMessage(e));
        } finally {
            setNewFolderBusy(false);
        }
    }

    function handleActivate(entry: Entry) {
        // Top-level Locations cards: jump into the chosen root. Clears
        if (entry.type === "dir") {
            drillInto(entry.name);
            return;
        }
        // File row: hand off to the parent FileBrowser. The Sheet closes
        // and the file is selected in the main work area, on the matching
        // tab (library or downloads).
        const folder = entry.path.includes("/")
            ? entry.path.slice(0, entry.path.lastIndexOf("/"))
            : "";
        onSelectFile(
            {
                name: entry.name,
                ext: entry.ext ?? "",
                path: entry.path,
                folder,
                needs_conversion: entry.needs_conversion,
            },
            root,
        );
        handleOpenChange(false);
    }

    function handleSelect(entry: Entry, opts: { shift: boolean; toggle: boolean }) {
        const update = selectionFromClick(
            visible ?? [],
            selectedPathsRef.current,
            anchorPath,
            entry.path,
            opts,
        );
        setSelectedPaths(update.selected);
        setAnchorPath(update.anchor);
    }

    function handleEntryClick(entry: Entry, e: ReactMouseEvent) {
        // `event.detail` is 1 on a single click, 2 on the second of a
        // double-click. Routing double-clicks to activate (drill folder /
        // open file) and single-clicks to select gives the OS-style
        // multi-select model in both roots. Downloads previously used
        // single-click-to-open; symmetry with Library makes batching
        // (multi-select + Del, drag-select, etc.) work uniformly across
        // both roots.
        const isDouble = e.detail >= 2;
        if (isDouble) {
            handleActivate(entry);
            return;
        }
        handleSelect(entry, {
            shift: e.shiftKey,
            toggle: e.ctrlKey || e.metaKey,
        });
    }

    function cutSelection() {
        const sel = selectedPathsRef.current;
        if (!sel.size || rootRef.current !== "library") return;
        setCutPaths(new Set(sel));
        setCutOrigin({ root: "library", subdir: subdirRef.current });
        setMoveNotice(null);
    }

    function clearCut() {
        setCutPaths(null);
        setCutOrigin(null);
    }

    /** Cycle check + same-folder check before firing the batch move.
     *  Returns the human message to show if the paste should refuse;
     *  null if the paste is safe to proceed. */
    function pasteBlocker(
        cut: Set<string>,
        origin: { root: FileRoot; subdir: string },
        destSubdir: string,
    ): string | null {
        // Same-folder paste is a no-op (no API churn).
        if (origin.root === "library" && origin.subdir === destSubdir) {
            return "Already here.";
        }
        // Folder-into-itself protection — server enforces this too, but
        // catching it here saves a round-trip and gives a clearer message.
        if (origin.root === "library") {
            for (const p of cut) {
                if (destSubdir === p || destSubdir.startsWith(p + "/")) {
                    return "Can't paste a folder into itself.";
                }
            }
        }
        return null;
    }

    async function pasteHere() {
        const cut = cutPathsRef.current;
        const origin = cutOriginRef.current;
        if (!cut || !cut.size || !origin) return;
        if (rootRef.current !== "library") return;
        const destSubdir = subdirRef.current;
        const blocker = pasteBlocker(cut, origin, destSubdir);
        if (blocker) {
            setMoveNotice(blocker);
            return;
        }
        setMoveBusy(true);
        setMoveNotice(`Moving 0 / ${cut.size} ${cut.size === 1 ? "item" : "items"}…`);
        try {
            const data = await moveBatchStream(
                {
                    items: Array.from(cut).map((from_path) => ({ from_path })),
                    from_root: origin.root,
                    to_subdir: destSubdir,
                },
                (event) => {
                    if (event.event === "item") {
                        setMoveNotice(`Moving ${event.index + 1} / ${event.total}…`);
                    }
                },
            );
            const total = data.results.length;
            const fails = data.results.filter((r) => !r.ok);
            if (fails.length === 0) {
                setMoveNotice(`Moved ${data.moved} ${data.moved === 1 ? "item" : "items"}.`);
            } else {
                // Show the first failure's reason so the user sees the
                // concrete cause. Subsequent failures get a generic suffix.
                // fails.length > 0 here (the === 0 branch is handled above).
                const first = fails[0]!;
                const tail = fails.length > 1 ? ` (+${fails.length - 1} more)` : "";
                setMoveNotice(
                    `Moved ${data.moved} of ${total}. Couldn't move ${first.from_path}: ${first.error?.message ?? "unknown error"}${tail}`,
                );
            }
            setCutPaths(null);
            setCutOrigin(null);
            setSelectedPaths(new Set());
            setAnchorPath(null);
            loadSubdir(destSubdir, "library");
        } catch (e) {
            setMoveNotice("Move failed: " + getErrorMessage(e));
        } finally {
            setMoveBusy(false);
        }
    }

    async function deleteSelection() {
        // Bulk delete the current multi-selection. Folders are deleted
        // recursively without per-folder content preflight — the user
        // explicitly multi-selected, so a single "Delete N items?"
        // confirmation is the right granularity.
        const sel = Array.from(selectedPathsRef.current);
        if (!sel.length) return;
        const visibleList = visibleRef.current ?? [];
        const entries = sel
            .map((p) => visibleList.find((en) => en.path === p))
            .filter((en): en is Entry => !!en);
        // Use the single-target DeleteCandidate dialog with a synthetic
        // entry that describes the batch — the confirm handler branches
        // on path === "__bulk:N" to run the loop.
        const fileCount = entries.filter((en) => en.type === "file").length;
        const folderCount = entries.length - fileCount;
        const summary = [
            fileCount > 0 ? `${fileCount} ${fileCount === 1 ? "file" : "files"}` : null,
            folderCount > 0 ? `${folderCount} ${folderCount === 1 ? "folder" : "folders"}` : null,
        ]
            .filter(Boolean)
            .join(" and ");
        const BULK_PREVIEW_LIMIT = 5;
        setDeleteCandidate({
            entry: {
                name: summary,
                type: folderCount > 0 ? "dir" : "file",
                ext: null,
                path: BULK_DELETE_SENTINEL,
            },
            contentsCount: folderCount > 0 ? -2 : 0, // -2 = bulk sentinel
            bulkPreview: {
                names: entries.slice(0, BULK_PREVIEW_LIMIT).map((en) => en.name),
                total: entries.length,
            },
        });
    }

    async function requestDelete(entry: Entry) {
        // Files go straight to confirm; folders preflight a listing so the
        // dialog copy can be precise ("empty" vs "N items inside"). The
        // preflight failure-mode is benign — fall back to a recursive
        // prompt with -1 count.
        if (entry.type === "file") {
            setDeleteCandidate({ entry, contentsCount: 0 });
            return;
        }
        try {
            const data = await apiGet<ListedDirResponse>(
                API.files + buildQueryString({ root, subdir: entry.path }),
            );
            setDeleteCandidate({ entry, contentsCount: data.entries.length });
        } catch {
            setDeleteCandidate({ entry, contentsCount: -1 });
        }
    }

    function startRename(entry: Entry) {
        setRenamePath(entry.path);
        setRenameValue(entry.name);
        setError("");
    }

    function cancelRename() {
        setRenamePath(null);
        setRenameValue("");
    }

    async function commitRename(entry: Entry) {
        const next = renameValue.trim();
        if (!next || next === entry.name) {
            cancelRename();
            return;
        }
        setRenameBusy(true);
        try {
            await apiPost(API.renamePath, {
                path: entry.path,
                new_name: next,
                root,
            });
            cancelRename();
            loadSubdir(subdir, root);
        } catch (e) {
            setError("Couldn't rename: " + getErrorMessage(e));
            // Keep the input open so the user can fix the name and retry.
        } finally {
            setRenameBusy(false);
        }
    }

    async function confirmDelete() {
        if (!deleteCandidate) return;
        setDeleteBusy(true);
        try {
            const { entry, contentsCount } = deleteCandidate;
            // Bulk path: the synthetic sentinel from deleteSelection.
            // Loop /api/delete per real item. Folders always go recursive
            // (the user explicitly multi-selected; per-folder preflight
            // would be a lot of network for confirmation copy that we've
            // already rolled up into the prompt summary).
            if (entry.path === BULK_DELETE_SENTINEL) {
                const sel = Array.from(selectedPathsRef.current);
                const list = visibleRef.current ?? [];
                const items = sel
                    .map((p) => list.find((en) => en.path === p))
                    .filter((en): en is Entry => !!en);
                const failures: string[] = [];
                for (const it of items) {
                    try {
                        await apiPost(API.delete, {
                            path: it.path,
                            root,
                            recursive: it.type === "dir",
                        });
                    } catch (err) {
                        failures.push(`${it.name}: ${getErrorMessage(err)}`);
                    }
                }
                setDeleteCandidate(null);
                setSelectedPaths(new Set());
                setAnchorPath(null);
                loadSubdir(subdir, root);
                if (failures.length) {
                    setError(`Couldn't delete ${failures.length} item(s). First: ${failures[0]}`);
                }
                return;
            }
            await apiPost(API.delete, {
                path: entry.path,
                root,
                // Files ignore this; folders use it. -1 (preflight failed)
                // is treated as "might be non-empty, send recursive" since
                // the user already confirmed.
                recursive: entry.type === "dir" && contentsCount !== 0,
            });
            setDeleteCandidate(null);
            loadSubdir(subdir, root);
        } catch (e) {
            setError("Couldn't delete: " + getErrorMessage(e));
            setDeleteCandidate(null);
        } finally {
            setDeleteBusy(false);
        }
    }

    const breadcrumbs = subdir ? subdir.split("/") : [];
    const isSearching = filter.trim().length > 0;

    // Two render modes (the rail handles root selection, so there is no
    // top-level "no root chosen" case):
    //   1. Recursive search → flat file results with a folder hint
    //      relative to the search scope.
    //   2. Folder listing → folders first then files. Local sort is
    //      defensive — the backend already returns this order but the
    //      client sort keeps it stable across re-renders.
    const visible = useMemo<Entry[] | null>(() => {
        if (isSearching) {
            if (!searchResults) return null;
            const prefix = subdir ? subdir + "/" : "";
            return searchResults.map((f) => ({
                name: f.name,
                type: "file" as const,
                ext: f.ext,
                path: f.path,
                needs_conversion: f.needs_conversion,
                folderHint:
                    f.folder === subdir
                        ? ""
                        : prefix && f.folder.startsWith(prefix)
                          ? f.folder.slice(prefix.length)
                          : f.folder,
            }));
        }
        if (!entries) return null;
        return [...entries].sort((a, b) => {
            if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });
    }, [entries, searchResults, isSearching, subdir]);

    useEffect(() => {
        visibleRef.current = visible;
        // Visible list changed (drilled in/out, search results swapped in/out)
        // — clear the hover anchor. The next mousemove repopulates it; F2/Del
        // without a fresh hover quietly no-ops instead of acting on a row
        // that's no longer rendered.
        hoverRef.current = null;
    }, [visible]);

    return (
        <>
            <Sheet open={open} onOpenChange={handleOpenChange}>
                <SheetContent
                    className="w-full sm:max-w-2xl lg:max-w-3xl overflow-hidden"
                    showCloseButton={false}
                    onEscapeKeyDown={(e) => {
                        // Precedence: rename input → new-folder input →
                        // cut clipboard → error banner → filter → move
                        // notice. Each dismisses its own layer before
                        // letting Escape close the Sheet. The delete-confirm
                        // AlertDialog runs in its own focus scope and
                        // handles its Escape separately.
                        if (renamePath) {
                            e.preventDefault();
                            cancelRename();
                        } else if (newFolderOpen) {
                            e.preventDefault();
                            setNewFolderOpen(false);
                            setNewFolderName("");
                        } else if (cutPaths) {
                            e.preventDefault();
                            clearCut();
                        } else if (error) {
                            e.preventDefault();
                            setError("");
                        } else if (filter) {
                            e.preventDefault();
                            setFilter("");
                        } else if (moveNotice) {
                            e.preventDefault();
                            setMoveNotice(null);
                        } else if (selectedPaths.size > 0) {
                            e.preventDefault();
                            setSelectedPaths(new Set());
                            setAnchorPath(null);
                        }
                    }}
                >
                    <SheetTitle className="sr-only">Browse files</SheetTitle>
                    <SheetDescription className="sr-only">
                        Navigate the library and downloads folder trees. The left rail switches
                        between roots. In Library, click a file to select, double-click to open,
                        right-click for actions, F2 to rename, Delete to delete, N for new folder,
                        Ctrl/Cmd+X then Ctrl/Cmd+V to cut and paste. In Downloads, click a file to
                        open it in the work area.
                    </SheetDescription>

                    {/* Header — spans the full Sheet width above the rail
                     *  + main split. Lives outside the ContextMenu wrapper
                     *  so right-click on the title bar uses the browser
                     *  default (the file menu is content-only). */}
                    <SheetHeaderBar
                        title="Browse files"
                        closeLabel="Close library browser"
                        onClose={() => handleOpenChange(false)}
                    >
                        {visible && (
                            <span
                                // /80 (not /70) clears WCAG AA on the
                                // cream-tinted light-mode surface.
                                className="font-mono text-xs tabular-nums text-muted-foreground/80"
                            >
                                {selectedPaths.size > 1
                                    ? `${selectedPaths.size} selected`
                                    : visible.length}
                                {filter && entries && selectedPaths.size <= 1
                                    ? ` / ${entries.length}`
                                    : ""}
                            </span>
                        )}
                    </SheetHeaderBar>

                    {/* Body — horizontal split. Left rail = root selector
                     *  (Library / Downloads), always visible so root
                     *  switching is one click away. Right column = the
                     *  active root's content, wrapped in the ContextMenu
                     *  so right-click anywhere in the file area opens the
                     *  Sheet's own menu (and right-click on the rail
                     *  falls through to the browser default). */}
                    <div className="flex flex-1 min-h-0">
                        <aside
                            className="flex flex-col gap-1 w-40 shrink-0 px-3 py-3 border-r border-border bg-muted/15"
                            aria-label="Filesystem roots"
                        >
                            <RailButton
                                icon={BookMarked}
                                label="Library"
                                active={root === "library"}
                                onClick={() => switchRoot("library")}
                            />
                            <RailButton
                                icon={Inbox}
                                label="Downloads"
                                active={root === "downloads"}
                                onClick={() => switchRoot("downloads")}
                            />
                        </aside>

                        {/* modal={false}: skip Radix's aria-hide-siblings + focus-trap
                            so the menu's open state doesn't race the New folder
                            input's focus and trip the "Blocked aria-hidden on
                            a focused ancestor" warning on the Sheet content.
                            Outside-click dismiss still works via DismissableLayer. */}
                        <ContextMenu modal={false}>
                            <ContextMenuTrigger asChild>
                                <div
                                    className="flex flex-col flex-1 min-w-0"
                                    onContextMenu={resolveMenuTarget}
                                    onMouseOver={handleBodyMouseOver}
                                    onMouseLeave={handleBodyMouseLeave}
                                    onFocus={handleBodyMouseOver}
                                    onBlur={handleBodyMouseLeave}
                                >
                                    {/* Action row: filter input + New folder + Refresh. Stays
                                     *  one line at every width thanks to flex-1 on the filter. */}
                                    <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border shrink-0">
                                        <div className="relative flex-1 min-w-0">
                                            <Search
                                                size={12}
                                                aria-hidden
                                                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none"
                                            />
                                            <Input
                                                value={filter}
                                                onChange={(e) => setFilter(e.target.value)}
                                                placeholder={
                                                    subdir
                                                        ? `Search inside ${breadcrumbs[breadcrumbs.length - 1]}.`
                                                        : `Search ${rootLabel(root).toLowerCase()}.`
                                                }
                                                aria-label="Search files (recursive)"
                                                className="h-8 pl-7 pr-2 font-mono text-xs"
                                            />
                                        </div>
                                        {/* New folder is library-only: /api/mkdir is scoped
                                         *  to LIBRARY_PATH (curating Downloads makes no sense
                                         *  — it's transient ingest staging). The button hides
                                         *  rather than disables so the toolbar stays uncluttered
                                         *  on the views where it isn't an option. */}
                                        {root === "library" && (
                                            <Button
                                                size="sm"
                                                variant={newFolderOpen ? "default" : "outline"}
                                                onClick={() => {
                                                    setNewFolderOpen((v) => !v);
                                                    setNewFolderName("");
                                                }}
                                                className="gap-1.5 shrink-0"
                                                aria-pressed={newFolderOpen}
                                                aria-label="Create a new folder here (keyboard: N)"
                                            >
                                                <FolderPlus size={12} aria-hidden />
                                                <span className="hidden sm:inline">New folder</span>
                                            </Button>
                                        )}
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => loadSubdir(subdir, root)}
                                                    disabled={loading}
                                                    className="shrink-0"
                                                    aria-label="Refresh this folder"
                                                >
                                                    <RefreshCw
                                                        size={12}
                                                        aria-hidden
                                                        className={loading ? "animate-spin" : ""}
                                                    />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom">Refresh</TooltipContent>
                                        </Tooltip>
                                    </div>

                                    {/* Breadcrumb row: leads with the active root (Library
                                     *  or Downloads). The rail handles root *switching*; the
                                     *  breadcrumb root crumb pops to the chosen root's top
                                     *  level (resets subdir to "").  */}
                                    <div className="flex items-center gap-1.5 flex-wrap px-5 py-2 border-b border-border shrink-0 text-xs">
                                        <button
                                            type="button"
                                            onClick={() => popTo(-1)}
                                            className="font-medium text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                        >
                                            {rootLabel(root)}
                                        </button>
                                        {breadcrumbs.map((seg, i) => (
                                            <span
                                                key={i}
                                                className="inline-flex items-center gap-1.5 text-muted-foreground"
                                            >
                                                <ChevronRight
                                                    size={12}
                                                    aria-hidden
                                                    className="opacity-40"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => popTo(i)}
                                                    className="font-medium text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 break-all"
                                                >
                                                    {seg}
                                                </button>
                                            </span>
                                        ))}
                                    </div>

                                    {/* Move/cut banner — a single mode-switching slot that
                                     *  carries three states: a cut clipboard waiting to
                                     *  paste (Scissors + Paste/Cancel buttons), an in-
                                     *  flight paste (spinning Loader + progress message),
                                     *  and a completed paste notice (Check + dismiss X).
                                     *  The previous design had two separate banners that
                                     *  could stack during a paste — collapsing them keeps
                                     *  the chrome's row count predictable. aria-live=polite
                                     *  so SR users hear progress and final results without
                                     *  losing focus. */}
                                    {(() => {
                                        const cutCount = cutPaths?.size ?? 0;
                                        const visible =
                                            cutCount > 0 || moveBusy || moveNotice !== null;
                                        if (!visible) return null;
                                        const showPasteActions = cutCount > 0 && !moveBusy;
                                        const showDismiss =
                                            moveNotice !== null && !moveBusy && cutCount === 0;
                                        const message = moveNotice
                                            ? moveNotice
                                            : `${cutCount} ${cutCount === 1 ? "item" : "items"} ready to move. Press Ctrl/Cmd+V or right-click → Paste here.`;
                                        return (
                                            <div
                                                role="status"
                                                aria-live="polite"
                                                className="flex items-start gap-3 bg-muted/40 border-b border-border px-5 py-2 shrink-0 text-xs text-muted-foreground"
                                            >
                                                <span className="shrink-0 mt-0.5">
                                                    {moveBusy ? (
                                                        <Loader2
                                                            size={12}
                                                            aria-hidden
                                                            className="animate-spin"
                                                        />
                                                    ) : moveNotice && cutCount === 0 ? (
                                                        <Check size={12} aria-hidden />
                                                    ) : (
                                                        <Scissors size={12} aria-hidden />
                                                    )}
                                                </span>
                                                <span className="flex-1 leading-relaxed">
                                                    {message}
                                                </span>
                                                {showPasteActions && (
                                                    <>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={pasteHere}
                                                            className="h-6 px-2 text-xs"
                                                        >
                                                            <ClipboardPaste size={12} aria-hidden />
                                                            Paste here
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={clearCut}
                                                            className="h-6 px-2 text-xs"
                                                        >
                                                            Cancel
                                                        </Button>
                                                    </>
                                                )}
                                                {showDismiss && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setMoveNotice(null)}
                                                        className="text-muted-foreground/70 hover:text-foreground transition-colors -my-0.5"
                                                        aria-label="Dismiss move notice"
                                                    >
                                                        <X size={12} aria-hidden />
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {/* Inline new-folder input */}
                                    {newFolderOpen && (
                                        <div className="flex gap-2 items-center bg-muted/40 border-b border-border px-5 py-2.5 shrink-0">
                                            <FolderPlus
                                                size={14}
                                                aria-hidden
                                                className="text-muted-foreground shrink-0"
                                            />
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

                                    {/* Error — recoverable shape (warning, not destructive)
                                     *  since this is "load / save / move didn't work" not
                                     *  "you triggered a dangerous action." */}
                                    {error && (
                                        <p className="px-5 py-2 text-sm text-foreground/90 bg-warning/10 border-b border-warning/30 shrink-0">
                                            {error}
                                        </p>
                                    )}

                                    {/* Mode caption — surfaces the click-semantics asymmetry
                                     *  between Library (single-click selects, double-click
                                     *  activates) and Downloads (single-click activates).
                                     *  Always rendered with the same height while a listing
                                     *  is mounted, so the entry list doesn't shift up when
                                     *  the user selects something or cuts a clipboard. The
                                     *  earlier "fade on first interaction" pattern looked
                                     *  cleaner but reflowed the list under the cursor on
                                     *  the very click that triggered it — layout stability
                                     *  wins. */}
                                    {visible && visible.length > 0 && (
                                        <p className="px-5 py-1.5 text-[11px] italic text-muted-foreground/70 border-b border-border shrink-0">
                                            Click to select. Double-click to open. Right-click for
                                            more.
                                        </p>
                                    )}

                                    {/* Entry list */}
                                    <div
                                        ref={scrollContainerRef}
                                        onMouseDown={handleListMouseDown}
                                        className="flex-1 min-h-0 overflow-y-auto relative"
                                        data-explorer-list
                                        role="listbox"
                                        tabIndex={0}
                                        aria-multiselectable={true}
                                        aria-busy={isSearching ? searchBusy : loading}
                                        aria-label={`${rootLabel(root)} contents`}
                                    >
                                        {
                                            // While typing, `isSearching` flips true on the
                                            // same render the filter changes but `searchBusy`
                                            // is only set inside the debounce effect that
                                            // runs after — the `searchResults === null` guard
                                            // prevents the empty-state from flickering for
                                            // one frame.
                                            (
                                                isSearching
                                                    ? searchBusy || searchResults === null
                                                    : loading
                                            ) ? (
                                                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                                                    <Loader2
                                                        size={14}
                                                        aria-hidden
                                                        className="animate-spin shrink-0"
                                                    />
                                                    {isSearching ? "Searching." : "Loading."}
                                                </div>
                                            ) : !visible || visible.length === 0 ? (
                                                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground italic px-4 text-center leading-relaxed">
                                                    {isSearching
                                                        ? subdir
                                                            ? `No matches under ${breadcrumbs[breadcrumbs.length - 1]}.`
                                                            : `No matches in ${rootLabel(root).toLowerCase()}.`
                                                        : subdir
                                                          ? root === "library"
                                                              ? "Empty folder. Use New folder to add subfolders."
                                                              : "Empty folder."
                                                          : root === "library"
                                                            ? "Nothing filed yet. When you've fetched a post you can move it in here from Downloads."
                                                            : "No pending downloads."}
                                                </div>
                                            ) : (
                                                <>
                                                    {/* Cut-state SR hint. Rows in the cut clipboard
                                                     *  reference this via aria-describedby so screen
                                                     *  readers announce "Marked for move" alongside
                                                     *  the visual italic + opacity treatment. */}
                                                    <span id="lex-cut-hint" className="sr-only">
                                                        Marked for move.
                                                    </span>
                                                    {/* Bundle the two pieces of state the row's
                                                     *  callbacks branch on but EntryRow doesn't
                                                     *  visibly render. Memo's comparator picks
                                                     *  this up; drag-select (root + anchor
                                                     *  unchanged) lets unaffected rows skip
                                                     *  re-renders entirely. */}
                                                    {(() => {
                                                        const cacheKey = `${root}:${anchorPath ?? ""}`;
                                                        return visible.map((entry, idx) => {
                                                            const activateVerb =
                                                                entry.type === "dir"
                                                                    ? "drill in"
                                                                    : "open";
                                                            const rowTitle = `Double-click to ${activateVerb} · F2 to rename · Del to delete`;
                                                            const isRowRenaming =
                                                                renamePath === entry.path;
                                                            return (
                                                                <MemoEntryRow
                                                                    key={entry.path}
                                                                    entry={entry}
                                                                    isLast={
                                                                        idx === visible.length - 1
                                                                    }
                                                                    isRenaming={isRowRenaming}
                                                                    // Only the renaming row sees
                                                                    // live keystroke updates;
                                                                    // others get a stable empty
                                                                    // string so per-key state
                                                                    // changes don't invalidate
                                                                    // the whole list's memos.
                                                                    renameValue={
                                                                        isRowRenaming
                                                                            ? renameValue
                                                                            : ""
                                                                    }
                                                                    renameBusy={
                                                                        isRowRenaming && renameBusy
                                                                    }
                                                                    selected={selectedPaths.has(
                                                                        entry.path,
                                                                    )}
                                                                    cut={
                                                                        cutPaths?.has(entry.path) ??
                                                                        false
                                                                    }
                                                                    rowTitle={rowTitle}
                                                                    cacheKey={cacheKey}
                                                                    onRenameChange={setRenameValue}
                                                                    onRenameSubmit={() =>
                                                                        commitRename(entry)
                                                                    }
                                                                    onRenameCancel={cancelRename}
                                                                    onClick={(e) =>
                                                                        handleEntryClick(entry, e)
                                                                    }
                                                                />
                                                            );
                                                        });
                                                    })()}
                                                </>
                                            )
                                        }
                                    </div>
                                </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                                {/* New folder / Cut / Paste are library-only —
                                 *  /api/mkdir is scoped to LIBRARY_PATH and the
                                 *  move endpoint's destination is always library. */}
                                {root === "library" && (
                                    <>
                                        <ContextMenuItem
                                            onSelect={() => {
                                                // rAF defers past Radix
                                                // ContextMenu's focus-return
                                                // step, which otherwise lands
                                                // focus on the trigger area
                                                // AFTER our newFolderInputRef
                                                // focus effect runs — leaving
                                                // the input mounted but
                                                // unfocused. Same pattern the
                                                // Rename / Cut / Paste items
                                                // already use for the same
                                                // reason.
                                                requestAnimationFrame(() => {
                                                    setNewFolderOpen(true);
                                                    setNewFolderName("");
                                                });
                                            }}
                                        >
                                            <FolderPlus aria-hidden />
                                            New folder
                                            <Kbd>N</Kbd>
                                        </ContextMenuItem>
                                        {selectedPaths.size > 0 && (
                                            <ContextMenuItem
                                                onSelect={() => {
                                                    requestAnimationFrame(() => cutSelection());
                                                }}
                                            >
                                                <Scissors aria-hidden />
                                                Cut {selectedPaths.size}{" "}
                                                {selectedPaths.size === 1 ? "item" : "items"}
                                                <Kbd>Ctrl+X</Kbd>
                                            </ContextMenuItem>
                                        )}
                                        {cutPaths && cutPaths.size > 0 && (
                                            <ContextMenuItem
                                                onSelect={() => {
                                                    requestAnimationFrame(() => pasteHere());
                                                }}
                                            >
                                                <ClipboardPaste aria-hidden />
                                                Paste {cutPaths.size}{" "}
                                                {cutPaths.size === 1 ? "item" : "items"} here
                                                <Kbd>Ctrl+V</Kbd>
                                            </ContextMenuItem>
                                        )}
                                    </>
                                )}
                                {menuTarget &&
                                    (() => {
                                        // When the right-click lands on a row that
                                        // is part of an active multi-selection, the
                                        // Delete item acts on the whole selection
                                        // (matches Windows Explorer / macOS Finder).
                                        // Rename hides in that case — multi-rename
                                        // has no clean semantics.
                                        const isBulkContext =
                                            selectedPaths.size > 1 &&
                                            selectedPaths.has(menuTarget.path);
                                        return (
                                            <>
                                                {!isBulkContext && (
                                                    <ContextMenuItem
                                                        onSelect={() => {
                                                            // rAF: let the menu close
                                                            // + restore focus before
                                                            // swapping the row for
                                                            // the inline rename input
                                                            // (which steals focus
                                                            // itself).
                                                            const target = menuTarget;
                                                            requestAnimationFrame(() =>
                                                                startRename(target),
                                                            );
                                                        }}
                                                    >
                                                        <PenLine aria-hidden />
                                                        Rename
                                                        <Kbd>F2</Kbd>
                                                    </ContextMenuItem>
                                                )}
                                                <ContextMenuSeparator />
                                                <ContextMenuItem
                                                    variant="destructive"
                                                    onSelect={() => {
                                                        // rAF for the same aria-hidden
                                                        // focus-race reason: let the
                                                        // ContextMenu release focus
                                                        // before the AlertDialog mounts.
                                                        const target = menuTarget;
                                                        if (isBulkContext) {
                                                            requestAnimationFrame(() =>
                                                                deleteSelection(),
                                                            );
                                                        } else {
                                                            requestAnimationFrame(() =>
                                                                requestDelete(target),
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <Trash2 aria-hidden />
                                                    {isBulkContext
                                                        ? `Delete ${selectedPaths.size} items`
                                                        : `Delete ${menuTarget.type === "dir" ? "folder" : "file"}`}
                                                    <Kbd>Del</Kbd>
                                                </ContextMenuItem>
                                            </>
                                        );
                                    })()}
                            </ContextMenuContent>
                        </ContextMenu>
                    </div>
                    {/* Drag-select rectangle overlay — viewport-coords via
                     *  `position: fixed`, pointer-events-none so it never
                     *  intercepts the click that ends the drag. */}
                    {dragRect && (
                        <div
                            aria-hidden
                            className="pointer-events-none fixed z-50 bg-primary/15 border border-primary/40 rounded-sm"
                            style={{
                                left: dragRect.left,
                                top: dragRect.top,
                                width: dragRect.width,
                                height: dragRect.height,
                            }}
                        />
                    )}
                </SheetContent>
            </Sheet>

            {/* Sibling to the Sheet, not a child. Nesting an AlertDialog
             *  inside the Sheet's Radix Root makes the focus manager apply
             *  aria-hidden to SheetContent while it still holds focus —
             *  hoisting the dialog out of the Sheet's React subtree lets
             *  Radix treat them as independent dialog stacks. */}
            <AlertDialog
                open={deleteCandidate !== null}
                onOpenChange={(v) => {
                    if (!v && !deleteBusy) setDeleteCandidate(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {deleteCandidate?.entry.path === BULK_DELETE_SENTINEL
                                ? `Delete ${deleteCandidate.entry.name}?`
                                : deleteCandidate?.entry.type === "file"
                                  ? "Delete this file?"
                                  : deleteCandidate?.contentsCount === 0
                                    ? "Delete this empty folder?"
                                    : "Delete this folder and everything inside?"}
                        </AlertDialogTitle>
                        {/* asChild so the description can host a list for the
                         *  bulk-delete preview without invalid <p>-wrapped-<ul>
                         *  HTML (Radix's Description renders as <p> by default). */}
                        <AlertDialogDescription asChild>
                            <div>
                                {deleteCandidate && (
                                    <DeleteCandidateSummary candidate={deleteCandidate} />
                                )}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            disabled={deleteBusy}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleteBusy ? "Deleting…" : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function DeleteCandidateSummary({ candidate }: { candidate: DeleteCandidate }) {
    const { entry, contentsCount, bulkPreview } = candidate;
    if (entry.path === BULK_DELETE_SENTINEL) {
        const overflow = bulkPreview ? bulkPreview.total - bulkPreview.names.length : 0;
        return (
            <>
                <span className="block mb-2">
                    The selected items (
                    <span className="font-mono text-foreground">{entry.name}</span>) will be
                    removed. Folders include everything inside. This can&apos;t be undone.
                </span>
                {bulkPreview && bulkPreview.names.length > 0 && (
                    <ul className="font-mono text-xs text-foreground/80 space-y-0.5 pl-4 list-disc">
                        {bulkPreview.names.map((n) => (
                            <li key={n} className="break-all">
                                {n}
                            </li>
                        ))}
                        {overflow > 0 && (
                            <li className="list-none italic text-muted-foreground/80">
                                and {overflow} more.
                            </li>
                        )}
                    </ul>
                )}
            </>
        );
    }
    if (entry.type === "file") {
        return (
            <>
                <span className="font-mono text-foreground break-all">{entry.name}</span> will be
                removed from the library. This can&apos;t be undone.
            </>
        );
    }
    if (contentsCount === 0) {
        return (
            <>
                <span className="font-mono text-foreground break-all">{entry.path}</span> is empty
                and will be removed. This can&apos;t be undone.
            </>
        );
    }
    const phrase =
        contentsCount > 0
            ? `${contentsCount} item${contentsCount === 1 ? "" : "s"} inside`
            : "every item inside";
    return (
        <>
            <span className="font-mono text-foreground break-all">{entry.path}</span> and {phrase}{" "}
            will be removed. This can&apos;t be undone.
        </>
    );
}

interface EntryRowProps {
    entry: Entry;
    isLast: boolean;
    isRenaming: boolean;
    renameValue: string;
    renameBusy: boolean;
    selected: boolean;
    cut: boolean;
    /** Desktop hover hint — composed by the parent so it can differ
     *  per root (single-click vs double-click activation). */
    rowTitle: string;
    /** Memo cache-busting key. The parent encodes `root` + `anchorPath`
     *  here so React.memo's custom comparator can detect when the
     *  closures captured inside `onClick` / `onRenameSubmit` would
     *  otherwise go stale (e.g., root switched library→downloads,
     *  shift-click anchor moved). Not rendered. */
    cacheKey: string;
    onRenameChange: (v: string) => void;
    onRenameSubmit: () => void;
    onRenameCancel: () => void;
    onClick: (e: ReactMouseEvent) => void;
}

// Custom shallow comparator. React.memo's default would never skip a
// re-render because the parent passes inline arrow functions for
// onClick / onRenameSubmit / onRenameCancel — their identity changes
// every parent render. By comparing value props only (plus the bundled
// cacheKey for root + anchorPath), drag-select stops rebuilding every
// row's JSX on every mousemove. Callback closures stay valid because
// `cacheKey` invalidates all rows whenever the state those closures
// branch on (root, anchor) actually changes.
function entryRowPropsEqual(prev: EntryRowProps, next: EntryRowProps): boolean {
    return (
        prev.entry.path === next.entry.path &&
        prev.entry.name === next.entry.name &&
        prev.entry.type === next.entry.type &&
        prev.entry.ext === next.entry.ext &&
        prev.entry.needs_conversion === next.entry.needs_conversion &&
        prev.entry.folderHint === next.entry.folderHint &&
        prev.isLast === next.isLast &&
        prev.isRenaming === next.isRenaming &&
        prev.renameValue === next.renameValue &&
        prev.renameBusy === next.renameBusy &&
        prev.selected === next.selected &&
        prev.cut === next.cut &&
        prev.rowTitle === next.rowTitle &&
        prev.cacheKey === next.cacheKey
    );
}

function EntryRow({
    entry,
    isLast,
    isRenaming,
    renameValue,
    renameBusy,
    selected,
    cut,
    rowTitle,
    // cacheKey is consumed only by the memo comparator (see
    // entryRowPropsEqual). The row itself doesn't render with it.
    cacheKey: _cacheKey,
    onRenameChange,
    onRenameSubmit,
    onRenameCancel,
    onClick,
}: EntryRowProps) {
    const isDir = entry.type === "dir";
    const ext = entry.ext ?? "";
    const extLabel = ext.startsWith(".") ? ext.slice(1).toUpperCase() : "";
    const inputRef = useRef<HTMLInputElement | null>(null);

    // When the rename input mounts, select the basename (everything
    // before the last `.` for files; whole name for folders/no-ext).
    // Matches OS file-explorer rename behavior so users can immediately
    // type a replacement without manually selecting.
    useEffect(() => {
        if (!isRenaming) return;
        const el = inputRef.current;
        if (!el) return;
        const dot = entry.name.lastIndexOf(".");
        const end = !isDir && dot > 0 ? dot : entry.name.length;
        el.setSelectionRange(0, end);
        el.focus();
    }, [isRenaming, entry.name, isDir]);

    const baseClass =
        "w-full text-left px-5 py-2.5 flex items-center gap-3 text-sm transition-colors group/row " +
        (isLast ? "" : "border-b border-border/30");

    if (isRenaming) {
        // The rename row swaps the button for a row-shaped <div> that
        // hosts the inline input. The Input absorbs clicks so the parent
        // button's drill-in handler can't fire while the user is typing.
        // `data-entry-path` keeps body-level right-click detection happy
        // while the row is in rename mode (right-clicking the renaming
        // row still resolves it as the menu target).
        return (
            <div
                className={baseClass + " bg-accent/40"}
                data-entry-path={entry.path}
                role="presentation"
                onClick={(e) => e.stopPropagation()}
            >
                <EntryIcon type={entry.type} ext={ext} needsConversion={!!entry.needs_conversion} />
                <Input
                    ref={inputRef}
                    value={renameValue}
                    onChange={(e) => onRenameChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            onRenameSubmit();
                        } else if (e.key === "Escape") {
                            e.preventDefault();
                            onRenameCancel();
                        }
                    }}
                    onBlur={onRenameSubmit}
                    disabled={renameBusy}
                    aria-label={`Rename ${entry.name}`}
                    className="flex-1 h-8 font-mono text-sm"
                />
            </div>
        );
    }

    // `data-entry-path` lets the body-level ContextMenu and the hover
    // tracker resolve which entry the cursor / right-click landed on.
    // F2 / Del / right-click bind at the Sheet body level (not per-row)
    // because the row is a <button> that fires onClick on Enter/Space —
    // intercepting F2 here would still work for keyboard-Tab users, but
    // the window-level handler covers hover-driven use too.
    //
    // `data-selected` and `data-cut` drive the multi-select / clipboard
    // visuals. Tailwind variants on the className read these attributes
    // (`data-[selected=true]:bg-accent/70 …`).
    return (
        <button
            type="button"
            role="option"
            aria-selected={selected}
            aria-describedby={cut ? "lex-cut-hint" : undefined}
            title={rowTitle}
            data-entry-path={entry.path}
            data-selected={selected || undefined}
            data-cut={cut || undefined}
            onClick={onClick}
            className={
                baseClass +
                " hover:bg-accent/40 focus-visible:outline-none focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset" +
                " data-[selected=true]:bg-accent/70 data-[selected=true]:ring-1 data-[selected=true]:ring-ring/30 data-[selected=true]:ring-inset" +
                " data-[cut=true]:opacity-55 data-[cut=true]:italic"
            }
        >
            <EntryIcon type={entry.type} ext={ext} needsConversion={!!entry.needs_conversion} />
            <div className="flex-1 min-w-0">
                <span
                    className={
                        isDir
                            ? "block font-medium text-foreground break-all"
                            : "block font-mono text-foreground break-all"
                    }
                >
                    {entry.name}
                </span>
                {entry.folderHint ? (
                    <span className="block text-[10px] font-mono text-muted-foreground/70 break-all leading-tight mt-0.5">
                        in {entry.folderHint}/
                    </span>
                ) : null}
            </div>
            {isDir ? (
                <ChevronRight
                    size={14}
                    aria-hidden
                    className="text-muted-foreground/50 group-hover/row:text-foreground transition-colors shrink-0"
                />
            ) : extLabel ? (
                <span className="text-[10px] tracking-wide font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                    {extLabel}
                </span>
            ) : null}
        </button>
    );
}

/** Memoised wrapper around EntryRow. Used at the entry-list call site
 *  in place of EntryRow directly. The custom comparator
 *  (`entryRowPropsEqual`) ignores callback prop identity — the parent
 *  passes inline arrow functions so default React.memo would never
 *  skip — and bundles root + anchorPath into a `cacheKey` so stale
 *  closures get invalidated when the callbacks' branching state
 *  actually changes. */
const MemoEntryRow = memo(EntryRow, entryRowPropsEqual);

/** Small `<kbd>`-styled hint for context-menu shortcut labels.
 *  `ml-auto` so it floats right of the menu item label, matching the
 *  Finder / VS Code pattern. */
function Kbd({ children }: { children: ReactNode }) {
    return (
        <span className="ml-auto font-mono text-[10px] tracking-wide text-muted-foreground/80">
            {children}
        </span>
    );
}

function RailButton({
    icon: Icon,
    label,
    active,
    onClick,
}: {
    icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 " +
                (active
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30 ring-inset"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground")
            }
        >
            <Icon size={16} aria-hidden />
            <span>{label}</span>
        </button>
    );
}

function EntryIcon({
    type,
    ext,
    needsConversion,
}: {
    type: "file" | "dir";
    ext: string;
    needsConversion: boolean;
}) {
    if (type === "dir")
        return <Folder size={16} aria-hidden className="text-muted-foreground shrink-0" />;
    if (needsConversion || NEEDS_CONVERSION_EXTS.has(ext))
        return <File size={16} aria-hidden className="text-warning/80 shrink-0" />;
    if (METADATA_COMPATIBLE_EXTS.has(ext))
        return <Music2 size={16} aria-hidden className="text-success shrink-0" />;
    return <File size={16} aria-hidden className="text-muted-foreground shrink-0" />;
}
