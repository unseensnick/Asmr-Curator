/**
 * Pure selection-set helpers for the library explorer. No React, no
 * side effects — every function takes the current Set + click context
 * and returns a new Set plus (where it matters) the new anchor path.
 *
 * Centralising this lets `LibraryExplorerSheet` stay focused on render
 * + orchestration, and gives the selection semantics (Shift, Ctrl/Cmd,
 * Shift+Ctrl/Cmd combinations) a single tested home.
 */

/** Minimal shape this module needs from an explorer entry. Mirrors the
 *  `Entry` interface in `LibraryExplorerSheet.tsx` but only the `path`
 *  field, so this module stays decoupled from the row representation. */
export interface SelectablePath {
    path: string;
}

/** Result of a click-driven selection update — both the new Set and the
 *  next anchor (Shift-clicks leave the anchor in place; plain and toggle
 *  clicks move it). */
export interface SelectionUpdate {
    selected: Set<string>;
    anchor: string;
}

export interface ClickModifiers {
    /** Shift held — extend the selection from anchor to target. */
    shift: boolean;
    /** Ctrl (Windows/Linux) or Cmd (macOS) held — toggle target in-place. */
    toggle: boolean;
}

/** Return the contiguous slice of `visible` between the two paths
 *  (inclusive, order-agnostic). Empty array when either path isn't in
 *  the list, matching `handleSelect`'s previous no-op fallback. */
export function pathsInRange(
    visible: readonly SelectablePath[],
    fromPath: string,
    toPath: string,
): string[] {
    const a = visible.findIndex((e) => e.path === fromPath);
    const b = visible.findIndex((e) => e.path === toPath);
    if (a < 0 || b < 0) return [];
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return visible.slice(lo, hi + 1).map((e) => e.path);
}

/** Range-select: Shift+click extends from the anchor to the target.
 *  Leaves the anchor untouched so further Shift-clicks keep extending
 *  from the same reference point. Returns null when either the anchor
 *  or the target isn't currently visible — callers fall through to
 *  the toggle / plain branch in that case, matching the previous
 *  `handleSelect` behaviour. */
export function extendRange(
    visible: readonly SelectablePath[],
    anchor: string,
    targetPath: string,
): SelectionUpdate | null {
    const range = pathsInRange(visible, anchor, targetPath);
    if (range.length === 0) return null;
    return { selected: new Set(range), anchor };
}

/** Toggle-select: Ctrl/Cmd+click flips a single entry in the current
 *  Set. The anchor moves to the toggled entry so a subsequent
 *  Shift-click extends from there. */
export function toggleOne(prev: ReadonlySet<string>, targetPath: string): SelectionUpdate {
    const next = new Set(prev);
    if (next.has(targetPath)) next.delete(targetPath);
    else next.add(targetPath);
    return { selected: next, anchor: targetPath };
}

/** Plain click — replace selection with this single entry and move
 *  the anchor onto it. */
export function selectOne(targetPath: string): SelectionUpdate {
    return { selected: new Set([targetPath]), anchor: targetPath };
}

/** Click router. Resolves Shift / toggle / plain in the same priority
 *  order `handleSelect` used:
 *
 *    1. Shift (with a valid anchor + visible list) → range
 *    2. Ctrl/Cmd → toggle
 *    3. neither → replace
 *
 *  `anchor` may be null when no previous anchor exists (first click in
 *  the view, or after a clear) — Shift then degrades to a plain click,
 *  matching the previous fall-through behaviour. */
export function selectionFromClick(
    visible: readonly SelectablePath[],
    prev: ReadonlySet<string>,
    anchor: string | null,
    targetPath: string,
    modifiers: ClickModifiers,
): SelectionUpdate {
    if (modifiers.shift && anchor && visible.length > 0) {
        const range = extendRange(visible, anchor, targetPath);
        if (range) return range;
        // Anchor or target not visible — fall through to the
        // toggle / plain branch below.
    }
    if (modifiers.toggle) {
        return toggleOne(prev, targetPath);
    }
    return selectOne(targetPath);
}

/** Ctrl/Cmd+A — select every visible row, anchoring at the first so a
 *  follow-up Shift-click extends from a sensible reference point.
 *  Returns null when the list is empty (caller should no-op rather
 *  than clobber state). */
export function selectAll(visible: readonly SelectablePath[]): SelectionUpdate | null {
    if (visible.length === 0) return null;
    return {
        selected: new Set(visible.map((e) => e.path)),
        anchor: visible[0].path,
    };
}

/** Build the Set produced by a drag-rectangle hit-test result. Pulls
 *  in `dragAdditive` to model Ctrl/Shift-drag extending the base
 *  selection rather than replacing it. */
export function selectionFromDragHits(
    base: ReadonlySet<string>,
    inside: ReadonlySet<string>,
    dragAdditive: boolean,
): Set<string> {
    if (!dragAdditive) return new Set(inside);
    const next = new Set(base);
    for (const p of inside) next.add(p);
    return next;
}
