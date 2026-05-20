// Pure unit tests for the selection helpers. Mirrors how the
// LibraryExplorerSheet uses them: every interaction (click variants,
// drag rectangle, Ctrl+A) routes through this module so a regression
// here ripples to every selection behaviour in the explorer.

import { describe, expect, it } from "vitest";

import {
    extendRange,
    pathsInRange,
    type SelectablePath,
    selectAll,
    selectionFromClick,
    selectionFromDragHits,
    selectOne,
    toggleOne,
} from "../explorerSelection";

const entries: SelectablePath[] = [
    { path: "a" },
    { path: "b" },
    { path: "c" },
    { path: "d" },
    { path: "e" },
];

describe("pathsInRange", () => {
    it("returns the inclusive slice between two paths in order", () => {
        expect(pathsInRange(entries, "b", "d")).toEqual(["b", "c", "d"]);
    });

    it("is order-agnostic — same range whichever direction", () => {
        expect(pathsInRange(entries, "d", "b")).toEqual(["b", "c", "d"]);
    });

    it("returns a single-element array when from === to", () => {
        expect(pathsInRange(entries, "c", "c")).toEqual(["c"]);
    });

    it("returns [] when either path is missing", () => {
        expect(pathsInRange(entries, "b", "zzz")).toEqual([]);
        expect(pathsInRange(entries, "zzz", "b")).toEqual([]);
    });
});

describe("extendRange", () => {
    it("preserves the anchor in the returned update", () => {
        const result = extendRange(entries, "a", "c");
        expect(result).not.toBeNull();
        expect(result!.anchor).toBe("a");
        expect(Array.from(result!.selected).sort()).toEqual(["a", "b", "c"]);
    });

    it("returns null when the anchor isn't visible", () => {
        expect(extendRange(entries, "missing", "c")).toBeNull();
    });
});

describe("toggleOne", () => {
    it("adds a path that wasn't selected", () => {
        const { selected, anchor } = toggleOne(new Set(["a"]), "b");
        expect(Array.from(selected).sort()).toEqual(["a", "b"]);
        expect(anchor).toBe("b");
    });

    it("removes a path that was selected", () => {
        const { selected, anchor } = toggleOne(new Set(["a", "b"]), "a");
        expect(Array.from(selected)).toEqual(["b"]);
        expect(anchor).toBe("a"); // anchor moves to the clicked entry regardless
    });

    it("does not mutate the input Set", () => {
        const prev = new Set(["a"]);
        toggleOne(prev, "b");
        expect(Array.from(prev)).toEqual(["a"]);
    });
});

describe("selectOne", () => {
    it("replaces the selection with a single entry", () => {
        const { selected, anchor } = selectOne("c");
        expect(Array.from(selected)).toEqual(["c"]);
        expect(anchor).toBe("c");
    });
});

describe("selectionFromClick", () => {
    it("Shift+click extends the range from the anchor", () => {
        const { selected, anchor } = selectionFromClick(entries, new Set(["a"]), "a", "c", {
            shift: true,
            toggle: false,
        });
        expect(Array.from(selected).sort()).toEqual(["a", "b", "c"]);
        expect(anchor).toBe("a");
    });

    it("Shift+click without an anchor degrades to a plain select", () => {
        const result = selectionFromClick(entries, new Set(["a"]), null, "c", {
            shift: true,
            toggle: false,
        });
        expect(Array.from(result.selected)).toEqual(["c"]);
        expect(result.anchor).toBe("c");
    });

    it("Ctrl/Cmd+click toggles when shift is not held", () => {
        const result = selectionFromClick(entries, new Set(["a"]), "a", "b", {
            shift: false,
            toggle: true,
        });
        expect(Array.from(result.selected).sort()).toEqual(["a", "b"]);
        expect(result.anchor).toBe("b");
    });

    it("Shift+Ctrl extends as a range (shift wins over toggle)", () => {
        // Validates the documented priority: Shift > toggle.
        const result = selectionFromClick(entries, new Set(["a"]), "a", "c", {
            shift: true,
            toggle: true,
        });
        expect(Array.from(result.selected).sort()).toEqual(["a", "b", "c"]);
    });

    it("plain click replaces selection with the single target", () => {
        const result = selectionFromClick(entries, new Set(["a", "b", "c"]), "a", "d", {
            shift: false,
            toggle: false,
        });
        expect(Array.from(result.selected)).toEqual(["d"]);
        expect(result.anchor).toBe("d");
    });
});

describe("selectAll", () => {
    it("returns every visible path with the first as anchor", () => {
        const result = selectAll(entries);
        expect(result).not.toBeNull();
        expect(Array.from(result!.selected).sort()).toEqual(["a", "b", "c", "d", "e"]);
        expect(result!.anchor).toBe("a");
    });

    it("returns null on an empty list (caller should no-op)", () => {
        expect(selectAll([])).toBeNull();
    });
});

describe("selectionFromDragHits", () => {
    it("replaces the base selection when dragAdditive is false", () => {
        const result = selectionFromDragHits(new Set(["a", "b"]), new Set(["c", "d"]), false);
        expect(Array.from(result).sort()).toEqual(["c", "d"]);
    });

    it("unions base + inside when dragAdditive is true", () => {
        const result = selectionFromDragHits(new Set(["a", "b"]), new Set(["b", "c"]), true);
        expect(Array.from(result).sort()).toEqual(["a", "b", "c"]);
    });

    it("does not mutate base", () => {
        const base = new Set(["a"]);
        selectionFromDragHits(base, new Set(["b"]), true);
        expect(Array.from(base)).toEqual(["a"]);
    });
});
