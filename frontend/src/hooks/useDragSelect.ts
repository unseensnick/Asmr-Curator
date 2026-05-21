import {
    type MouseEvent as ReactMouseEvent,
    type MutableRefObject,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import { selectionFromDragHits } from "@/lib/explorerSelection";

/** Viewport-coords rectangle drawn while a drag-select is active. The
 *  consumer renders a translucent overlay positioned with these values. */
export interface DragRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface UseDragSelectOptions {
    /** Live mirror of the selection so the listener loop doesn't capture
     *  a stale Set at mousedown. */
    selectedPathsRef: MutableRefObject<Set<string>>;
    /** Non-null means an inline rename is active; drag-select stays off. */
    renamePathRef: MutableRefObject<string | null>;
    setSelectedPaths: (next: Set<string>) => void;
    /** Cleared alongside the selection on an empty-area no-op click. */
    setAnchorPath: (next: string | null) => void;
}

export interface UseDragSelectResult {
    scrollContainerRef: MutableRefObject<HTMLDivElement | null>;
    onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
    dragRect: DragRect | null;
    /** Force-teardown of the window listeners + auto-scroll RAF.
     *  Idempotent; safe from Sheet close / unmount paths. */
    cleanup: () => void;
}

/**
 * Drag-rectangle (rubber-band) selection with near-edge auto-scroll.
 * Ctrl/Cmd/Shift at mousedown make the drag additive; a no-movement
 * empty-area click clears the selection (OS file-explorer parity).
 */
export function useDragSelect(options: UseDragSelectOptions): UseDragSelectResult {
    const { selectedPathsRef, renamePathRef, setSelectedPaths, setAnchorPath } = options;

    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    const dragBaseRef = useRef<Set<string>>(new Set());
    const dragAdditiveRef = useRef(false);
    const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
    const autoScrollRafRef = useRef<number | null>(null);
    // Holds the active drag's `onUp` so the close / unmount paths can
    // force-tear the window listeners + RAF if the consumer goes away
    // before the user releases the mouse.
    const dragCleanupRef = useRef<(() => void) | null>(null);

    const [dragRect, setDragRect] = useState<DragRect | null>(null);

    const updateDragSelection = useCallback(
        (clientX: number, clientY: number) => {
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
            container.querySelectorAll<HTMLElement>("[data-entry-path]").forEach((row) => {
                const r = row.getBoundingClientRect();
                if (r.right < left || r.left > right || r.bottom < top || r.top > bottom) return;
                const p = row.getAttribute("data-entry-path");
                if (p) inside.add(p);
            });
            const next = selectionFromDragHits(
                dragBaseRef.current,
                inside,
                dragAdditiveRef.current,
            );
            setSelectedPaths(next);
        },
        [setSelectedPaths],
    );

    const stopAutoScroll = useCallback(() => {
        if (autoScrollRafRef.current != null) {
            cancelAnimationFrame(autoScrollRafRef.current);
            autoScrollRafRef.current = null;
        }
    }, []);

    const ensureAutoScroll = useCallback(() => {
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
    }, [updateDragSelection]);

    const onMouseDown = useCallback(
        (e: ReactMouseEvent<HTMLDivElement>) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement | null;
            // Don't drag-select while the inline rename input is showing —
            // it's already a focus-stealing surface.
            if (renamePathRef.current) return;
            // Mousedown ON a row still starts tracking, but `engaged`
            // only flips to true once movement crosses the 3px threshold.
            // That way: a quiet click + release lets the row's onClick
            // handle the file normally; a click + drag engages the
            // rubber-band starting from the clicked row. Dense lists
            // (FileBrowser's Downloads tab) need this — relying on
            // gaps-between-rows for drag-select fails there because
            // there are no gaps.
            const onRow = !!target?.closest?.("[data-entry-path]");
            // Only preventDefault on empty-space clicks; on rows let the
            // browser deliver focus + the row's click event normally
            // until / unless we engage.
            if (!onRow) e.preventDefault();
            dragStartRef.current = { x: e.clientX, y: e.clientY };
            dragBaseRef.current = new Set(selectedPathsRef.current);
            dragAdditiveRef.current = e.ctrlKey || e.metaKey || e.shiftKey;
            lastPointerRef.current = { x: e.clientX, y: e.clientY };
            let engaged = false;
            const onMove = (ev: MouseEvent) => {
                if (!dragStartRef.current) return;
                lastPointerRef.current = { x: ev.clientX, y: ev.clientY };
                if (!engaged) {
                    const start = dragStartRef.current;
                    const moved =
                        Math.abs(ev.clientX - start.x) > 3 || Math.abs(ev.clientY - start.y) > 3;
                    if (!moved) return;
                    engaged = true;
                    // Now that we're committed to a drag, suppress the
                    // browser's text selection that would otherwise
                    // build up as the pointer sweeps over rows.
                    ev.preventDefault();
                }
                updateDragSelection(ev.clientX, ev.clientY);
                ensureAutoScroll();
            };
            const onUp = () => {
                const start = dragStartRef.current;
                const last = lastPointerRef.current;
                // No-drag click in empty space — clear selection if it was a
                // genuine click (no Shift/Ctrl held to preserve, no
                // movement, and the click landed outside any row). Mirrors
                // what an OS file explorer does when you click the empty
                // area of a folder. Row clicks always fall through to the
                // row's onClick instead.
                if (start && last) {
                    const moved = Math.abs(last.x - start.x) > 3 || Math.abs(last.y - start.y) > 3;
                    if (!moved && !dragAdditiveRef.current && !onRow) {
                        setSelectedPaths(new Set());
                        setAnchorPath(null);
                        setDragRect(null);
                    }
                }
                // When the drag actually engaged, swallow the trailing
                // click event the browser will fire on the row under
                // mouseup. Without this, the row's onClick would race
                // ahead and toggle the file we just drag-selected.
                if (engaged) {
                    const cancelClick = (ev: Event) => {
                        ev.stopPropagation();
                        ev.preventDefault();
                        window.removeEventListener("click", cancelClick, true);
                    };
                    window.addEventListener("click", cancelClick, true);
                    // Safety: if for some reason no click follows
                    // (e.g. mouseup landed outside any clickable
                    // surface), drop the suppressor so a future click
                    // unrelated to the drag isn't swallowed.
                    setTimeout(() => {
                        window.removeEventListener("click", cancelClick, true);
                    }, 100);
                }
                dragStartRef.current = null;
                setDragRect(null);
                stopAutoScroll();
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
                dragCleanupRef.current = null;
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
            dragCleanupRef.current = onUp;
        },
        [
            renamePathRef,
            selectedPathsRef,
            updateDragSelection,
            ensureAutoScroll,
            stopAutoScroll,
            setSelectedPaths,
            setAnchorPath,
        ],
    );

    const cleanup = useCallback(() => {
        dragCleanupRef.current?.();
    }, []);

    // Component-unmount safety net — covers the cases where the consumer
    // unmounts without first calling `cleanup` (hot reload, route change).
    useEffect(() => {
        return () => {
            dragCleanupRef.current?.();
        };
    }, []);

    return {
        scrollContainerRef,
        onMouseDown,
        dragRect,
        cleanup,
    };
}
