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
    setAnchorPath: (next: string | null) => void;
}

export interface UseDragSelectResult {
    scrollContainerRef: MutableRefObject<HTMLDivElement | null>;
    onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
    dragRect: DragRect | null;
    /** Idempotent teardown; safe to call from Sheet-close / unmount. */
    cleanup: () => void;
}

/** Movement (px) the pointer must cross before mousedown commits to a
 *  drag-select gesture. Set higher than the OS double-click tolerance so
 *  hand jitter on a click doesn't accidentally toggle the row into batch
 *  mode. */
const DRAG_ENGAGE_THRESHOLD_PX = 8;

/** How long after a real drag ends to keep swallowing trailing clicks.
 *  The browser fires the click synchronously on mouseup; 50ms is plenty
 *  of headroom without swallowing a deliberate follow-up click. */
const POST_DRAG_CLICK_SWALLOW_MS = 50;

/**
 * Drag-rectangle (rubber-band) selection with near-edge auto-scroll.
 * Ctrl/Cmd/Shift at mousedown make the drag additive; a no-movement
 * empty-area click clears the selection (OS file-explorer parity).
 */
export function useDragSelect(options: UseDragSelectOptions): UseDragSelectResult {
    const { selectedPathsRef, renamePathRef, setSelectedPaths, setAnchorPath } = options;

    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    // Container origin at mousedown so we can re-anchor dragStartRef when
    // layout reflows mid-drag (e.g. SelectionActionBar mounting above the
    // list pushes rows down out of the rect).
    const dragContainerOriginRef = useRef<{ left: number; top: number } | null>(null);
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
            // Re-anchor start against container shift since mousedown so
            // the row originally under the cursor stays inside the rect
            // when layout reflows. Hit-test below still uses viewport coords.
            const origin = dragContainerOriginRef.current;
            const c = container.getBoundingClientRect();
            const shiftX = origin ? c.left - origin.left : 0;
            const shiftY = origin ? c.top - origin.top : 0;
            const anchorX = start.x + shiftX;
            const anchorY = start.y + shiftY;
            const left = Math.min(anchorX, clientX);
            const right = Math.max(anchorX, clientX);
            const top = Math.min(anchorY, clientY);
            const bottom = Math.max(anchorY, clientY);
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
            // Bail when the container has no room to scroll in the
            // requested direction. Browsers clamp the scrollTop
            // assignment silently, so without an explicit bounds check
            // the tick reschedules forever — dy stays non-zero as long
            // as the pointer hovers near the edge.
            const maxScroll = container.scrollHeight - container.clientHeight;
            const atTop = container.scrollTop <= 0;
            const atBottom = container.scrollTop >= maxScroll;
            if ((dy < 0 && atTop) || (dy > 0 && atBottom)) {
                autoScrollRafRef.current = null;
                return;
            }
            // Clamp per-frame velocity so a pointer dragged far outside
            // the container (clientY hundreds of px past the edge) can't
            // jump the scrollTop by enormous deltas each frame.
            const clamped = Math.sign(dy) * Math.min(Math.abs(dy), 24);
            const before = container.scrollTop;
            container.scrollTop += clamped;
            // Defence in depth: sub-pixel scrollTop quirks can leave the
            // value unchanged even when bounds allow movement — stop the
            // RAF on zero progress so it can never spin in place.
            if (container.scrollTop === before) {
                autoScrollRafRef.current = null;
                return;
            }
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
            // Mousedown on a row starts tracking but only engages once
            // movement passes DRAG_ENGAGE_THRESHOLD_PX. Required for dense
            // lists (Downloads tab) where there are no gaps between rows
            // to mousedown into — a quiet click still falls through to
            // the row's onClick.
            const onRow = !!target?.closest?.("[data-entry-path]");
            // Only preventDefault on empty-space clicks; on rows let the
            // browser deliver focus + the row's click event normally
            // until / unless we engage.
            if (!onRow) e.preventDefault();
            dragStartRef.current = { x: e.clientX, y: e.clientY };
            const c0 = scrollContainerRef.current?.getBoundingClientRect();
            dragContainerOriginRef.current = c0 ? { left: c0.left, top: c0.top } : null;
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
                        Math.abs(ev.clientX - start.x) > DRAG_ENGAGE_THRESHOLD_PX ||
                        Math.abs(ev.clientY - start.y) > DRAG_ENGAGE_THRESHOLD_PX;
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
                // area of a folder.
                if (start && last) {
                    const moved =
                        Math.abs(last.x - start.x) > DRAG_ENGAGE_THRESHOLD_PX ||
                        Math.abs(last.y - start.y) > DRAG_ENGAGE_THRESHOLD_PX;
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
                    // Drop the suppressor if no click follows (mouseup
                    // outside a clickable surface) so a later unrelated
                    // click isn't eaten.
                    setTimeout(() => {
                        window.removeEventListener("click", cancelClick, true);
                    }, POST_DRAG_CLICK_SWALLOW_MS);
                }
                dragStartRef.current = null;
                dragContainerOriginRef.current = null;
                lastPointerRef.current = null;
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
