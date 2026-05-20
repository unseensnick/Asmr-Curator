// Tests for parser.ts — the LLM response parser.
//
// Per CLAUDE.md: "LLM-response parsing lives in `frontend/src/lib/parser.ts`
// (client-side). Do not move it to the backend or duplicate it in components."
// A regression here silently corrupts every filename downstream — this is
// the most-critical client-side logic in the project.

import { describe, expect, it } from "vitest";

import { parseLlmJson, parseTitleLine } from "../parser";

// ── parseLlmJson ─────────────────────────────────────────────────────────────

describe("parseLlmJson", () => {
    it("extracts fields from a clean JSON response", () => {
        const raw = JSON.stringify({
            raw_title_line: "My Title | Tag1",
            raw_pill_tags: ["a", "b"],
            creator_name: "Solar Girl",
            creator_confidence: "high",
        });
        const result = parseLlmJson(raw);
        expect(result.raw_title_line).toBe("My Title | Tag1");
        expect(result.raw_pill_tags).toEqual(["a", "b"]);
        expect(result.creator_name).toBe("Solar Girl");
        expect(result.creator_confidence).toBe("high");
    });

    it("extracts JSON wrapped in prose (LLM preamble)", () => {
        // Vision LLMs sometimes prefix the JSON with explanation text;
        // the parser grabs the first `{…}` block.
        const raw =
            'Here is the extracted data: {"raw_title_line": "X", "raw_pill_tags": [], "creator_name": null, "creator_confidence": "low"} - hope this helps!';
        expect(parseLlmJson(raw).raw_title_line).toBe("X");
    });

    it("returns safe defaults on invalid JSON", () => {
        const result = parseLlmJson("not valid json at all");
        expect(result.raw_title_line).toBe("");
        expect(result.raw_pill_tags).toEqual([]);
        expect(result.creator_name).toBeNull();
        expect(result.creator_confidence).toBe("low");
    });

    it("returns safe defaults on empty string", () => {
        expect(parseLlmJson("")).toEqual({
            raw_title_line: "",
            raw_pill_tags: [],
            creator_name: null,
            creator_confidence: "low",
        });
    });

    it("coerces non-string raw_title_line to empty string", () => {
        const raw = JSON.stringify({
            raw_title_line: 12345,
            raw_pill_tags: [],
            creator_name: null,
            creator_confidence: "low",
        });
        expect(parseLlmJson(raw).raw_title_line).toBe("");
    });

    it("coerces non-array raw_pill_tags to empty array", () => {
        const raw = JSON.stringify({
            raw_title_line: "X",
            raw_pill_tags: "not an array",
            creator_name: null,
            creator_confidence: "low",
        });
        expect(parseLlmJson(raw).raw_pill_tags).toEqual([]);
    });

    it("coerces invalid creator_confidence to low", () => {
        const raw = JSON.stringify({
            raw_title_line: "X",
            raw_pill_tags: [],
            creator_name: null,
            creator_confidence: "maybe",
        });
        expect(parseLlmJson(raw).creator_confidence).toBe("low");
    });
});

// ── parseTitleLine (pipe format) ─────────────────────────────────────────────

describe("parseTitleLine — pipe format", () => {
    it("splits on ' | ' into title + tags", () => {
        const { title, embeddedTags } = parseTitleLine("Love Goddess | With Music | Soft Waves");
        expect(title).toBe("Love Goddess");
        expect(embeddedTags).toEqual(["With Music", "Soft Waves"]);
    });

    it("returns single-segment title when no pipe split", () => {
        const { title, embeddedTags } = parseTitleLine("Just a title");
        expect(title).toBe("Just a title");
        expect(embeddedTags).toEqual([]);
    });

    it("trims trailing dashes from the title", () => {
        const { title } = parseTitleLine("Title with dash- | Tag");
        expect(title).toBe("Title with dash");
    });

    it("strips leading special chars from title", () => {
        const { title } = parseTitleLine("&Title | Tag");
        expect(title).toBe("Title");
    });
});

// ── parseTitleLine (parenthetical format) ────────────────────────────────────

describe("parseTitleLine — parenthetical format", () => {
    it("splits title from paren tags", () => {
        const { title, embeddedTags } = parseTitleLine("Some Title (Soft) (Whispering)");
        expect(title).toBe("Some Title");
        expect(embeddedTags).toEqual(["Soft", "Whispering"]);
    });

    it("handles single paren tag", () => {
        const { title, embeddedTags } = parseTitleLine("Some Title (Soft Touches)");
        expect(title).toBe("Some Title");
        expect(embeddedTags).toEqual(["Soft Touches"]);
    });

    it("ignores age-style parens like (5 days ago)", () => {
        const { embeddedTags } = parseTitleLine("Title (5 days ago) (real tag)");
        expect(embeddedTags).toEqual(["real tag"]);
    });

    it("ignores punctuation-only paren contents", () => {
        const { embeddedTags } = parseTitleLine("Title (...) (real)");
        expect(embeddedTags).toEqual(["real"]);
    });
});

// ── parseTitleLine — no-truncation regression ────────────────────────────────

describe("parseTitleLine — no silent truncation", () => {
    it("does NOT truncate long titles to 120 chars when no paren and no pipe", () => {
        // Regression guard: prior behaviour silently truncated to 120 chars
        // which surprised users with long Patreon titles. Now the whole
        // cleaned string is preserved when there's no paren or pipe split.
        const longTitle = "A".repeat(200);
        const { title } = parseTitleLine(longTitle);
        expect(title.length).toBeGreaterThan(120);
        expect(title).toBe(longTitle);
    });
});

// ── parseTitleLine — unicode normalisation ───────────────────────────────────

describe("parseTitleLine — unicode + emoji handling", () => {
    it("replaces curly single quotes with straight ones", () => {
        // ‘ = ‘, ’ = ’
        const { title } = parseTitleLine("It’s a title");
        expect(title).toBe("It's a title");
    });

    it("replaces curly double quotes with straight ones", () => {
        const { title } = parseTitleLine("“Quoted” title");
        expect(title).toBe('"Quoted" title');
    });

    it("expands ellipsis character to three dots", () => {
        const { title } = parseTitleLine("Trailing… title");
        expect(title).toBe("Trailing... title");
    });

    it("strips emoji from title", () => {
        // \u{1F495} = 💕 (in the U+1F000-U+1FFFF range stripped by the parser)
        const { title } = parseTitleLine("Love \u{1F495} Title");
        expect(title).not.toContain("\u{1F495}");
        // Whitespace collapse means "Love  Title" becomes "Love Title"
        expect(title).toBe("Love Title");
    });

    it("strips dingbats from title", () => {
        // ✨ = ✨ (in the U+2600-U+27BF dingbat range)
        const { title } = parseTitleLine("✨ Sparkles");
        expect(title).not.toContain("✨");
    });

    it("collapses multiple spaces into one", () => {
        const { title } = parseTitleLine("Lots    of    spaces");
        expect(title).toBe("Lots of spaces");
    });

    it("trims whitespace around the title", () => {
        const { title } = parseTitleLine("   padded title   ");
        expect(title).toBe("padded title");
    });
});

// ── parseTitleLine — combined formats ────────────────────────────────────────

describe("parseTitleLine — mixed real-world inputs", () => {
    it("handles a Love-Goddess-style Patreon title", () => {
        const input =
            "[EXCLUSIVE] \u{1F496}\u{1F339} Love Goddess Guides You Towards Pleasure | With Music | Soft Waves";
        const { title, embeddedTags } = parseTitleLine(input);
        // Emojis stripped, square-bracket prefix kept (not in the strip set),
        // pipe split applied.
        expect(title).toBe("[EXCLUSIVE] Love Goddess Guides You Towards Pleasure");
        expect(embeddedTags).toEqual(["With Music", "Soft Waves"]);
    });

    it("handles plain title with no special formatting", () => {
        const { title, embeddedTags } = parseTitleLine("Casual Conversation");
        expect(title).toBe("Casual Conversation");
        expect(embeddedTags).toEqual([]);
    });
});
