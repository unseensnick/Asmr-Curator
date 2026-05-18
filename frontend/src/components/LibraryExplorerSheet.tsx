import {
    Check,
    ChevronRight,
    ClipboardPaste,
    File,
    Folder,
    FolderPlus,
    Loader2,
    Music2,
    PenLine,
    RefreshCw,
    Scissors,
    Search,
    Trash2,
    X,
} from "lucide-react";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
} from "react";

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
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetTitle,
} from "@/components/ui/sheet";
import { API, apiGet, apiPost, type FileRoot } from "@/lib/api";
import { METADATA_COMPATIBLE_EXTS, NEEDS_CONVERSION_EXTS } from "@/lib/audioFormats";
import type { FileEntry, ListedDirResponse } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface LibraryExplorerSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called when the user clicks a FILE row in the explorer. Parent uses
     *  this to switch the FileBrowser to the matching tab (library or
     *  downloads) and select the file so the existing rename / convert /
     *  move flows take over. */
    onSelectFile: (file: FileEntry, root: FileRoot) => void;
}

// Synthetic top-level rows. The explorer opens to a "Locations" view
// that shows Library and Downloads side by side; drilling into either
// scopes the rest of navigation to that root. Their paths are sentinels
// that handleEntryClick matches on — they aren't real filesystem paths
// and never reach the backend.
const ROOT_CARD_LIBRARY = "__locations:library";
const ROOT_CARD_DOWNLOADS = "__locations:downloads";
// Path sentinel used by the DeleteCandidate state to route through a
// bulk-delete code path in confirmDelete (loops /api/delete per item)
// without inventing a parallel dialog component for what's a small
// branch on the same prompt.
const BULK_DELETE_SENTINEL = "__bulk:delete";
const LOCATION_ENTRIES: Entry[] = [
    {
        name: "Library",
        type: "dir",
        ext: null,
        path: ROOT_CARD_LIBRARY,
    },
    {
        name: "Downloads",
        type: "dir",
        ext: null,
        path: ROOT_CARD_DOWNLOADS,
    },
];

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
}

/**
 * Right-side Sheet that lets the user navigate both filesystem roots
 * (LIBRARY_PATH and DOWNLOAD_PATH) folder-by-folder. Opens to a
 * "Locations" top level showing Library and Downloads as two synthetic
 * folder cards; drilling into either scopes the rest of navigation to
 * that root. Per-root affordances:
 *
 *   • Library — full CRUD: rename, delete, new folder, recursive search.
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
}: LibraryExplorerSheetProps) {
    // `null` = top-level Locations view (Library and Downloads side by
    // side). A FileRoot value scopes the rest of navigation to that root.
    // Both `root` and `subdir` are preserved across opens — the user
    // typically files batches into the same destination, and re-walking
    // from the top each time is death-by-clicks.
    const [root, setRoot] = useState<FileRoot | null>(null);
    const [subdir, setSubdir] = useState("");
    const [entries, setEntries] = useState<Entry[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [filter, setFilter] = useState("");

    const [newFolderOpen, setNewFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [newFolderBusy, setNewFolderBusy] = useState(false);

    const [deleteCandidate, setDeleteCandidate] =
        useState<DeleteCandidate | null>(null);
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
    const [cutOrigin, setCutOrigin] = useState<
        { root: FileRoot; subdir: string } | null
    >(null);
    const [moveBusy, setMoveBusy] = useState(false);
    // Transient post-move banner ("Moved 4 of 5. Couldn't move foo: …").
    // Cleared on next user action / close.
    const [moveNotice, setMoveNotice] = useState<string | null>(null);

    // Drag-select (rubber-band) state. `dragStart` non-null = a drag is
    // in progress; `dragRect` is the current rectangle in viewport
    // coordinates rendered as a translucent overlay. `dragBaseSelection`
    // captures `selectedPaths` at mousedown so Ctrl/Shift-drag can add
    // to the previous set instead of replacing.
    const [dragRect, setDragRect] = useState<
        { left: number; top: number; width: number; height: number } | null
    >(null);

    // Recursive search results. `null` means folder-listing mode (default,
    // shows the contents of the current subdir). A non-null array means
    // search mode — the filter input is non-empty and we've called
    // /api/files/search?subdir=<current>&q=… so the user can find files
    // buried deeper in the tree without drilling. Empty array = no
    // matches.
    const [searchResults, setSearchResults] = useState<FileEntry[] | null>(
        null,
    );
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
    const rootRef = useRef<FileRoot | null>(null);
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

    // Drag-select (rubber-band) infrastructure. Refs for the bits that
    // mutate per-mousemove (start point, base selection, last pointer,
    // auto-scroll RAF handle) so the listener loop doesn't re-render
    // the tree every frame; `dragRect` stays as state because the
    // overlay <div> follows it.
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    const dragBaseRef = useRef<Set<string>>(new Set());
    const dragAdditiveRef = useRef(false);
    const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
    const autoScrollRafRef = useRef<number | null>(null);

    const resolveMenuTarget = useCallback((e: ReactMouseEvent) => {
        const row = (e.target as HTMLElement | null)?.closest?.(
            "[data-entry-path]",
        );
        if (!row) {
            setMenuTarget(null);
            return;
        }
        const path = row.getAttribute("data-entry-path");
        const list = visibleRef.current ?? [];
        setMenuTarget(list.find((en) => en.path === path) ?? null);
    }, []);

    const handleBodyMouseOver = useCallback((e: ReactMouseEvent) => {
        const row = (e.target as HTMLElement | null)?.closest?.(
            "[data-entry-path]",
        );
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
            const params = new URLSearchParams({ root: r });
            if (s) params.set("subdir", s);
            const data = await apiGet<ListedDirResponse>(
                `${API.files}?${params.toString()}`,
            );
            setEntries(data.entries);
        } catch (e) {
            setError("Couldn't load folder: " + getErrorMessage(e));
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, []);

    // Lazy first load + reload on subdir/root change while open. Skipped
    // at top level — the Locations view renders synthetic cards instead
    // of hitting the backend.
    useEffect(() => {
        if (!open || root === null) return;
        loadSubdir(subdir, root);
    }, [open, root, subdir, loadSubdir]);

    // Recursive search effect. Empty filter, or top-level Locations view
    // → folder-listing / synthetic-cards mode (searchResults stays null
    // and the filter at top level just narrows the two cards client-side).
    // Non-empty filter inside a chosen root → debounce 200ms, then GET
    // /api/files/search scoped to the current subdir so the user finds
    // matches buried deeper without losing their place. The `stale`
    // token discards results from a superseded request.
    useEffect(() => {
        if (!open || root === null) {
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
                const params = new URLSearchParams({
                    root,
                    q,
                    search_in: "both",
                });
                if (subdir) params.set("subdir", subdir);
                const data = await apiGet<SearchResponse>(
                    `${API.search}?${params.toString()}`,
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
        }, 200);
        return () => {
            stale = true;
            clearTimeout(timer);
        };
    }, [open, root, filter, subdir]);

    // On close, dismiss any in-flight inline UI (so reopening doesn't
    // resurface a half-typed new-folder name, a stale filter, or an
    // unactioned delete prompt) but PRESERVE `subdir` so the user lands
    // back where they were working. Filing a batch of 10+ posts into the
    // same subfolder is the common case; resetting to root each time was
    // death-by-clicks.
    useEffect(() => {
        if (!open) {
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
        }
    }, [open]);

    // Selection is contextual to the current view (root + subdir). When
    // the user navigates, the previously-selected rows aren't on screen
    // anymore — keeping them in `selectedPaths` would leak ghost state
    // into Cut, Delete, and the count badge. cutPaths is the opposite:
    // it's the clipboard, it persists across navigation by design.
    useEffect(() => {
        setSelectedPaths(new Set());
        setAnchorPath(null);
    }, [root, subdir]);

    // Defensive a11y cleanup. Radix can leave `aria-hidden="true"` on
    // SheetContent when nested portals (ContextMenu, AlertDialog) close
    // out of sequence with the Sheet's focus scope — the SheetContent
    // ends up flagged hidden while still containing the focused element,
    // which the browser warns about as an a11y violation. After every
    // transient overlay state change (paste, delete, rename, menu open),
    // sweep open SheetContent nodes and clear any aria-hidden left
    // behind. setTimeout(0) lets Radix's own cleanup attempt first; we
    // only step in if it didn't finish.
    useEffect(() => {
        if (!open) return;
        const id = window.setTimeout(() => {
            document
                .querySelectorAll<HTMLElement>(
                    '[data-slot="sheet-content"][data-state="open"]',
                )
                .forEach((el) => {
                    if (el.getAttribute("aria-hidden") === "true") {
                        el.removeAttribute("aria-hidden");
                        el.removeAttribute("data-aria-hidden");
                    }
                });
        }, 0);
        return () => window.clearTimeout(id);
    }, [
        open,
        menuTarget,
        cutPaths,
        moveNotice,
        deleteCandidate,
        moveBusy,
        renamePath,
    ]);

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
                tag === "INPUT" ||
                tag === "TEXTAREA" ||
                target?.isContentEditable === true;

            // F2 / Del / N are no-ops at top-level Locations — there's
            // no folder to rename or create there, and the synthetic
            // root cards aren't deletable. Cut/paste are also no-ops
            // outside library.
            if (rootRef.current === null) return;

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

            // Ctrl/Cmd+A — select every visible row. Library only;
            // gated on non-editable so it doesn't fight the native
            // select-all behaviour inside the filter / rename inputs.
            if (
                e.key.toLowerCase() === "a" &&
                (e.ctrlKey || e.metaKey) &&
                !e.shiftKey &&
                !e.altKey &&
                !editable &&
                rootRef.current === "library"
            ) {
                const list = visibleRef.current ?? [];
                if (!list.length) return;
                e.preventDefault();
                setSelectedPaths(new Set(list.map((en) => en.path)));
                // Anchor at the first visible entry so a follow-up
                // Shift-click extends from a sensible reference point.
                setAnchorPath(list[0].path);
                return;
            }

            if (e.key === "F2") {
                if (renamePathRef.current) return;
                // With a multi-selection, F2 has no clean meaning (OS
                // explorers either rename only the anchored row or
                // refuse outright). Refuse outright + hint, so the user
                // doesn't lose their selection to a half-applied rename.
                if (selectedPathsRef.current.size > 1) {
                    setMoveNotice(
                        "Rename only works on one item at a time.",
                    );
                    return;
                }
                // Anchor wins over hover/menuTarget when a single-item
                // selection exists, so the keyboard model stays consistent
                // with "F2 renames the active row" even after mouse moves
                // away from it.
                const list = visibleRef.current ?? [];
                const fromAnchor =
                    anchorPathRef.current && selectedPathsRef.current.size === 1
                        ? list.find(
                              (en) => en.path === anchorPathRef.current,
                          ) ?? null
                        : null;
                const ent =
                    fromAnchor ?? hoverRef.current ?? menuTargetRef.current;
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

    function drillInto(name: string) {
        const next = subdir ? `${subdir}/${name}` : name;
        setSubdir(next);
        setNewFolderOpen(false);
        setFilter("");
    }

    function popTo(idx: number) {
        if (idx < 0) {
            setSubdir("");
            setFilter("");
            return;
        }
        const segments = subdir.split("/");
        setSubdir(segments.slice(0, idx + 1).join("/"));
        setNewFolderOpen(false);
        setFilter("");
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
        // any leftover subdir / filter so the user lands at that root's
        // top (root switch is rare enough that preserving subdir across
        // roots is more confusing than helpful — folders won't match).
        if (entry.path === ROOT_CARD_LIBRARY) {
            setRoot("library");
            setSubdir("");
            setFilter("");
            return;
        }
        if (entry.path === ROOT_CARD_DOWNLOADS) {
            setRoot("downloads");
            setSubdir("");
            setFilter("");
            return;
        }
        if (entry.type === "dir") {
            drillInto(entry.name);
            return;
        }
        if (!root) return; // unreachable: files only appear inside a chosen root
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
        onOpenChange(false);
    }

    function handleSelect(
        entry: Entry,
        opts: { shift: boolean; toggle: boolean },
    ) {
        // Shift-click extends from the last anchor to the current entry
        // across the visible list (the same order shown in the UI, which
        // already handles search-results vs folder-listing).
        if (opts.shift && anchorPath && visible) {
            const a = visible.findIndex((e) => e.path === anchorPath);
            const b = visible.findIndex((e) => e.path === entry.path);
            if (a >= 0 && b >= 0) {
                const [lo, hi] = a < b ? [a, b] : [b, a];
                const range = visible.slice(lo, hi + 1).map((e) => e.path);
                setSelectedPaths(new Set(range));
                return;
            }
        }
        if (opts.toggle) {
            setSelectedPaths((prev) => {
                const next = new Set(prev);
                if (next.has(entry.path)) next.delete(entry.path);
                else next.add(entry.path);
                return next;
            });
            setAnchorPath(entry.path);
            return;
        }
        // Plain click — replace selection with this single entry.
        setSelectedPaths(new Set([entry.path]));
        setAnchorPath(entry.path);
    }

    function handleEntryClick(entry: Entry, e: ReactMouseEvent) {
        // `event.detail` is 1 on a single click, 2 on the second of a
        // double-click. Routing double-clicks to activate (drill / open)
        // and single-clicks to select gives the OS-style multi-select
        // model the user expects in Library.
        const isDouble = e.detail >= 2;
        const isSyntheticRootCard =
            entry.path === ROOT_CARD_LIBRARY ||
            entry.path === ROOT_CARD_DOWNLOADS;
        // Downloads + the top-level Locations cards keep single-click =
        // activate (no selection model there — the asymmetry is
        // intentional: Library is where the user organises, Downloads
        // is transient).
        if (isDouble || root !== "library" || isSyntheticRootCard) {
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
        try {
            const body = {
                items: Array.from(cut).map((from_path) => ({ from_path })),
                from_root: origin.root,
                to_subdir: destSubdir,
            };
            const data = await apiPost<{
                moved: number;
                results: Array<{
                    from_path: string;
                    ok: boolean;
                    to_path?: string;
                    error?: { code: string; message: string };
                }>;
            }>(API.moveBatch, body);
            const total = data.results.length;
            const fails = data.results.filter((r) => !r.ok);
            if (fails.length === 0) {
                setMoveNotice(
                    `Moved ${data.moved} ${data.moved === 1 ? "item" : "items"}.`,
                );
            } else {
                // Show the first failure's reason so the user sees the
                // concrete cause. Subsequent failures get a generic suffix.
                const first = fails[0];
                const tail =
                    fails.length > 1 ? ` (+${fails.length - 1} more)` : "";
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

    function updateDragSelection(clientX: number, clientY: number) {
        const start = dragStartRef.current;
        const container = scrollContainerRef.current;
        if (!start || !container) return;
        const left = Math.min(start.x, clientX);
        const right = Math.max(start.x, clientX);
        const top = Math.min(start.y, clientY);
        const bottom = Math.max(start.y, clientY);
        setDragRect({
            left,
            top,
            width: right - left,
            height: bottom - top,
        });
        const inside = new Set<string>();
        container
            .querySelectorAll<HTMLElement>("[data-entry-path]")
            .forEach((row) => {
                const r = row.getBoundingClientRect();
                if (
                    r.right < left ||
                    r.left > right ||
                    r.bottom < top ||
                    r.top > bottom
                )
                    return;
                const p = row.getAttribute("data-entry-path");
                if (p) inside.add(p);
            });
        const next = dragAdditiveRef.current
            ? new Set([...dragBaseRef.current, ...inside])
            : inside;
        setSelectedPaths(next);
    }

    function ensureAutoScroll() {
        // Only run while a drag is active and the pointer is close to an
        // edge. Idempotent — re-entrant calls noop while the RAF is live.
        if (autoScrollRafRef.current != null) return;
        const tick = () => {
            const container = scrollContainerRef.current;
            const pointer = lastPointerRef.current;
            if (!container || !pointer || !dragStartRef.current) {
                autoScrollRafRef.current = null;
                return;
            }
            const rect = container.getBoundingClientRect();
            const edge = 40;
            let dy = 0;
            if (pointer.y < rect.top + edge) {
                dy = -Math.max(2, (rect.top + edge - pointer.y) * 0.3);
            } else if (pointer.y > rect.bottom - edge) {
                dy = Math.max(2, (pointer.y - (rect.bottom - edge)) * 0.3);
            }
            if (dy === 0) {
                autoScrollRafRef.current = null;
                return;
            }
            container.scrollTop += dy;
            // Content under the rect shifted — recompute hit-test so
            // newly-revealed rows get picked up immediately.
            updateDragSelection(pointer.x, pointer.y);
            autoScrollRafRef.current = requestAnimationFrame(tick);
        };
        autoScrollRafRef.current = requestAnimationFrame(tick);
    }

    function stopAutoScroll() {
        if (autoScrollRafRef.current != null) {
            cancelAnimationFrame(autoScrollRafRef.current);
            autoScrollRafRef.current = null;
        }
    }

    function handleListMouseDown(e: ReactMouseEvent<HTMLDivElement>) {
        if (e.button !== 0) return;
        if (rootRef.current !== "library") return;
        const target = e.target as HTMLElement | null;
        // Mousedown on a row defers to its click handler — drag-select
        // only starts in empty space (between rows or below the list).
        if (target?.closest?.("[data-entry-path]")) return;
        // Don't drag-select while the inline rename input is showing —
        // it's already a focus-stealing surface.
        if (renamePathRef.current) return;
        e.preventDefault();
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        dragBaseRef.current = new Set(selectedPathsRef.current);
        dragAdditiveRef.current = e.ctrlKey || e.metaKey || e.shiftKey;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        const onMove = (ev: MouseEvent) => {
            if (!dragStartRef.current) return;
            lastPointerRef.current = { x: ev.clientX, y: ev.clientY };
            updateDragSelection(ev.clientX, ev.clientY);
            ensureAutoScroll();
        };
        const onUp = () => {
            const start = dragStartRef.current;
            const last = lastPointerRef.current;
            // No-drag click in empty space — clear selection if it was a
            // genuine click (no Shift/Ctrl held to preserve, no
            // movement). Mirrors what an OS file explorer does when you
            // click the empty area of a folder.
            if (start && last) {
                const moved =
                    Math.abs(last.x - start.x) > 3 ||
                    Math.abs(last.y - start.y) > 3;
                if (!moved && !dragAdditiveRef.current) {
                    setSelectedPaths(new Set());
                    setAnchorPath(null);
                    setDragRect(null);
                }
            }
            dragStartRef.current = null;
            setDragRect(null);
            stopAutoScroll();
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }

    async function deleteSelection() {
        // Bulk delete the current multi-selection. Folders are deleted
        // recursively without per-folder content preflight — the user
        // explicitly multi-selected, so a single "Delete N items?"
        // confirmation is the right granularity.
        const sel = Array.from(selectedPathsRef.current);
        if (!sel.length || rootRef.current === null) return;
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
            fileCount > 0
                ? `${fileCount} ${fileCount === 1 ? "file" : "files"}`
                : null,
            folderCount > 0
                ? `${folderCount} ${folderCount === 1 ? "folder" : "folders"}`
                : null,
        ]
            .filter(Boolean)
            .join(" and ");
        setDeleteCandidate({
            entry: {
                name: summary,
                type: folderCount > 0 ? "dir" : "file",
                ext: null,
                path: BULK_DELETE_SENTINEL,
            },
            contentsCount: folderCount > 0 ? -2 : 0, // -2 = bulk sentinel
        });
    }

    async function requestDelete(entry: Entry) {
        if (!root) return; // synthetic root cards aren't deletable
        // Files go straight to confirm; folders preflight a listing so the
        // dialog copy can be precise ("empty" vs "N items inside"). The
        // preflight failure-mode is benign — fall back to a recursive
        // prompt with -1 count.
        if (entry.type === "file") {
            setDeleteCandidate({ entry, contentsCount: 0 });
            return;
        }
        try {
            const params = new URLSearchParams({
                root,
                subdir: entry.path,
            });
            const data = await apiGet<ListedDirResponse>(
                `${API.files}?${params.toString()}`,
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
        if (!root) return;
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
        if (!deleteCandidate || !root) return;
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
                    setError(
                        `Couldn't delete ${failures.length} item(s). First: ${failures[0]}`,
                    );
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
    const atTopLevel = root === null;

    // Three render modes:
    //   1. Top-level Locations (`root === null`) → two synthetic cards,
    //      client-side filtered by the search input only. No backend.
    //   2. Recursive search inside a chosen root → flat file results
    //      with a folder hint relative to the search scope.
    //   3. Folder listing inside a chosen root → folders first then
    //      files. The local sort is defensive: the backend already
    //      returns this order but client sorting keeps it stable
    //      across re-renders.
    const visible = useMemo<Entry[] | null>(() => {
        if (atTopLevel) {
            const q = filter.trim().toLowerCase();
            return q
                ? LOCATION_ENTRIES.filter((e) =>
                      e.name.toLowerCase().includes(q),
                  )
                : LOCATION_ENTRIES;
        }
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
    }, [atTopLevel, entries, searchResults, isSearching, subdir, filter]);

    useEffect(() => {
        visibleRef.current = visible;
        // Visible list changed (drilled in/out, search results swapped in/out)
        // — clear the hover anchor. The next mousemove repopulates it; F2/Del
        // without a fresh hover quietly no-ops instead of acting on a row
        // that's no longer rendered.
        hoverRef.current = null;
    }, [visible]);

    // Root switch also invalidates the last right-clicked menu target.
    // Otherwise a synthetic "__locations:library" entry could linger as
    // a stale F2 anchor after the user picks Open Library from the
    // top-level menu and then keyboards before hovering anything.
    useEffect(() => {
        setMenuTarget(null);
    }, [root]);

    return (
        <>
        <Sheet open={open} onOpenChange={onOpenChange}>
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
                    Navigate the library and downloads folder trees. Pick
                    Library or Downloads from the Locations view to drill
                    in. Click a file to open it in the work area; click a
                    folder to drill in. Right-click anywhere for actions —
                    a row shows Rename and Delete, and Library also shows
                    New folder.
                </SheetDescription>

                <ContextMenu>
                    <ContextMenuTrigger asChild>
                        <div
                            className="flex flex-col h-full min-h-0"
                            onContextMenu={resolveMenuTarget}
                            onMouseOver={handleBodyMouseOver}
                            onMouseLeave={handleBodyMouseLeave}
                        >
                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
                    <span className="text-sm font-medium tracking-wide text-foreground">
                        Browse files
                    </span>
                    {visible && (
                        <span
                            className="font-mono text-xs tabular-nums text-muted-foreground/70"
                            title={
                                selectedPaths.size > 1
                                    ? `${selectedPaths.size} selected`
                                    : `${visible.length} ${visible.length === 1 ? "item" : "items"}`
                            }
                        >
                            {selectedPaths.size > 1
                                ? `${selectedPaths.size} selected`
                                : visible.length}
                            {/* Match-ratio is only meaningful inside a
                             *  root where `entries` reflects the current
                             *  folder's total. At top level entries is
                             *  stale from a previous load — skip the
                             *  ratio there. Selection mode also skips
                             *  the ratio (count of selected is the
                             *  primary metric there). */}
                            {filter &&
                            root !== null &&
                            entries &&
                            selectedPaths.size <= 1
                                ? ` / ${entries.length}`
                                : ""}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        aria-label="Close library browser"
                        title="Close"
                    >
                        <X size={18} aria-hidden />
                    </button>
                </div>

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
                                root === null
                                    ? "Filter locations."
                                    : subdir
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
                            title="Create a new folder here (N)"
                            aria-pressed={newFolderOpen}
                        >
                            <FolderPlus size={12} aria-hidden />
                            <span className="hidden sm:inline">New folder</span>
                        </Button>
                    )}
                    {root !== null && (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => loadSubdir(subdir, root)}
                            disabled={loading}
                            className="shrink-0"
                            title="Refresh this folder"
                            aria-label="Refresh"
                        >
                            <RefreshCw
                                size={12}
                                aria-hidden
                                className={loading ? "animate-spin" : ""}
                            />
                        </Button>
                    )}
                </div>

                {/* Breadcrumb row: own row, wraps freely below at deep
                 *  nesting without pushing the actions to a second line.
                 *  Always leads with Locations so the user can jump back
                 *  to the top regardless of how deep they've drilled. */}
                <div className="flex items-center gap-1.5 flex-wrap px-5 py-2 border-b border-border shrink-0 text-xs">
                    <button
                        type="button"
                        onClick={() => {
                            setRoot(null);
                            setSubdir("");
                            setFilter("");
                            setNewFolderOpen(false);
                        }}
                        className="font-medium text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                        Locations
                    </button>
                    {root !== null && (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <ChevronRight
                                size={12}
                                aria-hidden
                                className="opacity-40"
                            />
                            <button
                                type="button"
                                onClick={() => popTo(-1)}
                                className="font-medium text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            >
                                {rootLabel(root)}
                            </button>
                        </span>
                    )}
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

                {/* Paste banner: surfaces when the user has cut a set
                 *  of items and is navigating to a destination. Quiet
                 *  styling — informational, not destructive. */}
                {cutPaths && cutPaths.size > 0 && root === "library" && (
                    <div className="flex items-center gap-3 bg-muted/40 border-b border-border px-5 py-2 shrink-0 text-xs text-muted-foreground">
                        <Scissors size={12} aria-hidden className="shrink-0" />
                        <span className="flex-1">
                            {cutPaths.size}{" "}
                            {cutPaths.size === 1 ? "item" : "items"} ready to
                            move. Press Ctrl/Cmd+V here or right-click for
                            Paste.
                        </span>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={pasteHere}
                            disabled={moveBusy}
                            className="h-6 px-2 text-xs"
                        >
                            <ClipboardPaste size={12} aria-hidden />
                            Paste here
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={clearCut}
                            disabled={moveBusy}
                            className="h-6 px-2 text-xs"
                        >
                            Cancel
                        </Button>
                    </div>
                )}

                {/* Transient move result. Quiet bg-muted, never red — even
                 *  partial failures are informational not destructive. */}
                {moveNotice && (
                    <div className="flex items-start gap-3 bg-muted/30 border-b border-border px-5 py-2 shrink-0 text-xs text-muted-foreground">
                        <span className="flex-1 leading-relaxed">
                            {moveNotice}
                        </span>
                        <button
                            type="button"
                            onClick={() => setMoveNotice(null)}
                            className="text-muted-foreground/70 hover:text-foreground transition-colors -my-0.5"
                            aria-label="Dismiss move notice"
                        >
                            <X size={12} aria-hidden />
                        </button>
                    </div>
                )}

                {/* Inline new-folder input */}
                {newFolderOpen && (
                    <div className="flex gap-2 items-center bg-muted/40 border-b border-border px-5 py-2.5 shrink-0">
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

                {/* Error */}
                {error && (
                    <p className="px-5 py-2 text-sm text-destructive bg-destructive/10 border-b border-border shrink-0">
                        {error}
                    </p>
                )}

                {/* Entry list */}
                <div
                    ref={scrollContainerRef}
                    onMouseDown={handleListMouseDown}
                    className="flex-1 min-h-0 overflow-y-auto relative"
                    data-explorer-list
                >
                    {(
                        // Top level is never loading (synthetic cards
                        // render synchronously). Inside a root: while
                        // typing, `isSearching` flips true on the same
                        // render the filter changes but `searchBusy` is
                        // only set inside the debounce effect that runs
                        // after — the `searchResults === null` guard
                        // prevents the empty-state from flickering for
                        // one frame.
                        atTopLevel
                            ? false
                            : isSearching
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
                            {root === null
                                ? "No locations match that filter."
                                : isSearching
                                  ? subdir
                                      ? `No matches under ${breadcrumbs[breadcrumbs.length - 1]}.`
                                      : `No matches in ${rootLabel(root).toLowerCase()}.`
                                  : subdir
                                    ? root === "library"
                                        ? "Empty folder. Use New folder to add subfolders."
                                        : "Empty folder."
                                    : root === "library"
                                      ? "Library is empty. Fetch some posts and use Move to library to file them here."
                                      : "No pending downloads."}
                        </div>
                    ) : (
                        visible.map((entry, idx) => (
                            <EntryRow
                                key={entry.path}
                                entry={entry}
                                isLast={idx === visible.length - 1}
                                isRenaming={renamePath === entry.path}
                                renameValue={renameValue}
                                renameBusy={
                                    renameBusy && renamePath === entry.path
                                }
                                selected={selectedPaths.has(entry.path)}
                                cut={cutPaths?.has(entry.path) ?? false}
                                onRenameChange={setRenameValue}
                                onRenameSubmit={() => commitRename(entry)}
                                onRenameCancel={cancelRename}
                                onClick={(e) => handleEntryClick(entry, e)}
                            />
                        ))
                    )}
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
                        </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                        {/* At top level the right-click menu doubles as
                         *  an extra way to jump into a root. Inside a
                         *  root, "New folder" is library-only (mirrors
                         *  the toolbar button's gating). */}
                        {atTopLevel ? (
                            <>
                                <ContextMenuItem
                                    onSelect={() => {
                                        setRoot("library");
                                        setSubdir("");
                                        setFilter("");
                                    }}
                                >
                                    <Folder aria-hidden />
                                    Open Library
                                </ContextMenuItem>
                                <ContextMenuItem
                                    onSelect={() => {
                                        setRoot("downloads");
                                        setSubdir("");
                                        setFilter("");
                                    }}
                                >
                                    <Folder aria-hidden />
                                    Open Downloads
                                </ContextMenuItem>
                            </>
                        ) : (
                            root === "library" && (
                                <>
                                    <ContextMenuItem
                                        onSelect={() => {
                                            setNewFolderOpen(true);
                                            setNewFolderName("");
                                        }}
                                    >
                                        <FolderPlus aria-hidden />
                                        New folder
                                    </ContextMenuItem>
                                    {selectedPaths.size > 0 && (
                                        <ContextMenuItem
                                            onSelect={() => {
                                                requestAnimationFrame(() =>
                                                    cutSelection(),
                                                );
                                            }}
                                        >
                                            <Scissors aria-hidden />
                                            Cut {selectedPaths.size}{" "}
                                            {selectedPaths.size === 1
                                                ? "item"
                                                : "items"}
                                        </ContextMenuItem>
                                    )}
                                    {cutPaths && cutPaths.size > 0 && (
                                        <ContextMenuItem
                                            onSelect={() => {
                                                requestAnimationFrame(() =>
                                                    pasteHere(),
                                                );
                                            }}
                                        >
                                            <ClipboardPaste aria-hidden />
                                            Paste {cutPaths.size}{" "}
                                            {cutPaths.size === 1
                                                ? "item"
                                                : "items"}{" "}
                                            here
                                        </ContextMenuItem>
                                    )}
                                </>
                            )
                        )}
                        {root !== null && menuTarget && (() => {
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
                                    </ContextMenuItem>
                                </>
                            );
                        })()}
                    </ContextMenuContent>
                </ContextMenu>
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
                    <AlertDialogDescription>
                        {deleteCandidate && (
                            <DeleteCandidateSummary candidate={deleteCandidate} />
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleteBusy}>
                        Cancel
                    </AlertDialogCancel>
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

function DeleteCandidateSummary({
    candidate,
}: {
    candidate: DeleteCandidate;
}) {
    const { entry, contentsCount } = candidate;
    if (entry.path === BULK_DELETE_SENTINEL) {
        return (
            <>
                The selected items (
                <span className="font-mono text-foreground break-all">
                    {entry.name}
                </span>
                ) will be removed. Folders include everything inside. This
                can&apos;t be undone.
            </>
        );
    }
    if (entry.type === "file") {
        return (
            <>
                <span className="font-mono text-foreground break-all">
                    {entry.name}
                </span>{" "}
                will be removed from the library. This can&apos;t be undone.
            </>
        );
    }
    if (contentsCount === 0) {
        return (
            <>
                <span className="font-mono text-foreground break-all">
                    {entry.path}
                </span>{" "}
                is empty and will be removed. This can&apos;t be undone.
            </>
        );
    }
    const phrase =
        contentsCount > 0
            ? `${contentsCount} item${contentsCount === 1 ? "" : "s"} inside`
            : "every item inside";
    return (
        <>
            <span className="font-mono text-foreground break-all">
                {entry.path}
            </span>{" "}
            and {phrase} will be removed. This can&apos;t be undone.
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
    onRenameChange: (v: string) => void;
    onRenameSubmit: () => void;
    onRenameCancel: () => void;
    onClick: (e: ReactMouseEvent) => void;
}

function EntryRow({
    entry,
    isLast,
    isRenaming,
    renameValue,
    renameBusy,
    selected,
    cut,
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
                onClick={(e) => e.stopPropagation()}
            >
                <EntryIcon
                    type={entry.type}
                    ext={ext}
                    needsConversion={!!entry.needs_conversion}
                />
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
            <EntryIcon
                type={entry.type}
                ext={ext}
                needsConversion={!!entry.needs_conversion}
            />
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
        return (
            <Folder
                size={16}
                aria-hidden
                className="text-muted-foreground shrink-0"
            />
        );
    if (needsConversion || NEEDS_CONVERSION_EXTS.has(ext))
        return (
            <File
                size={16}
                aria-hidden
                className="text-warning/80 shrink-0"
            />
        );
    if (METADATA_COMPATIBLE_EXTS.has(ext))
        return (
            <Music2
                size={16}
                aria-hidden
                className="text-success shrink-0"
            />
        );
    return (
        <File
            size={16}
            aria-hidden
            className="text-muted-foreground shrink-0"
        />
    );
}
