// Unit tests for the shared utilities in lib/utils.ts. Focuses on
// normaliseAndDedupeTags — the loop that both extraction panels (Patreon
// URL fetch + Screenshot LLM) flatten raw incoming strings through. The
// existing parser test file covers parseLlmJson / parseTitleLine, so
// utility helpers belong here so things stay easy to find.

import { describe, expect, it } from "vitest";

import { type AppDict, buildDictDerived } from "../types";
import { normaliseAndDedupeTags } from "../utils";

function makeDict(canonicals: { canonical: string; aliases?: string[] }[] = []): AppDict {
    const vocabulary = canonicals.map((c, i) => ({
        id: i + 1,
        canonical: c.canonical,
        aliases: c.aliases ?? [],
    }));
    return {
        vocabulary,
        suppressed: [],
        ...buildDictDerived(vocabulary, []),
    };
}

describe("normaliseAndDedupeTags", () => {
    it("returns an empty array for empty input", () => {
        expect(normaliseAndDedupeTags([], makeDict())).toEqual([]);
    });

    it("title-cases unknown tags", () => {
        expect(normaliseAndDedupeTags(["soft whispering"], makeDict())).toEqual([
            "Soft Whispering",
        ]);
    });

    it("resolves aliases to their canonical form", () => {
        const dict = makeDict([{ canonical: "Soft Whispering", aliases: ["whisper", "soft"] }]);
        expect(normaliseAndDedupeTags(["whisper"], dict)).toEqual(["Soft Whispering"]);
    });

    it("dedupes by lowercase form (first occurrence wins)", () => {
        // "soft whispering" + "Soft Whispering" → one entry, the form
        // that arrived first (title-cased by normalizeTag).
        const result = normaliseAndDedupeTags(["soft whispering", "Soft Whispering"], makeDict());
        expect(result).toEqual(["Soft Whispering"]);
    });

    it("dedupes across raw + alias forms of the same canonical", () => {
        const dict = makeDict([{ canonical: "Soft Whispering", aliases: ["whisper"] }]);
        expect(normaliseAndDedupeTags(["whisper", "Soft Whispering"], dict)).toEqual([
            "Soft Whispering",
        ]);
    });

    it("drops empty strings + whitespace-only entries", () => {
        expect(normaliseAndDedupeTags(["", "   ", "actual"], makeDict())).toEqual(["Actual"]);
    });

    it("uppercases SFW / NSFW shorthand", () => {
        expect(normaliseAndDedupeTags(["sfw", "Nsfw"], makeDict())).toEqual(["SFW", "NSFW"]);
    });

    it("preserves input order for non-duplicate tags", () => {
        expect(normaliseAndDedupeTags(["alpha", "beta", "gamma"], makeDict())).toEqual([
            "Alpha",
            "Beta",
            "Gamma",
        ]);
    });
});
