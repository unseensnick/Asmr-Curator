// Property tests for the LLM-response parsers in lib/parser.ts. fast-check
// throws arbitrary strings at parseLlmJson + parseTitleLine to verify the
// invariants the example tests can't enumerate.
//
// Single highest blast radius in the frontend: every screenshot extract
// flows through these, and a regression silently corrupts user data
// rather than visibly throwing.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseLlmJson, parseTitleLine } from "../parser";

describe("parseLlmJson", () => {
    it("never throws on any string input", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 500 }), (raw) => {
                // Must not throw — caller relies on this to handle
                // garbage LLM output gracefully.
                expect(() => parseLlmJson(raw)).not.toThrow();
            }),
        );
    });

    it("returns the shape the type promises", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 500 }), (raw) => {
                const result = parseLlmJson(raw);
                expect(typeof result.raw_title_line).toBe("string");
                expect(Array.isArray(result.raw_pill_tags)).toBe(true);
                expect(
                    result.creator_name === null || typeof result.creator_name === "string",
                ).toBe(true);
                expect(["high", "low"]).toContain(result.creator_confidence);
            }),
        );
    });

    it("defaults to the empty-fallback when no JSON object is present", () => {
        fc.assert(
            fc.property(
                fc.string({ maxLength: 200 }).filter((s) => !/[{}]/.test(s)),
                (rawNoBraces) => {
                    const result = parseLlmJson(rawNoBraces);
                    expect(result.raw_title_line).toBe("");
                    expect(result.raw_pill_tags).toEqual([]);
                    expect(result.creator_name).toBeNull();
                    expect(result.creator_confidence).toBe("low");
                },
            ),
        );
    });
});

describe("parseTitleLine", () => {
    it("never throws on any string input", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 500 }), (raw) => {
                expect(() => parseTitleLine(raw)).not.toThrow();
            }),
        );
    });

    it("title is always a string, embeddedTags always an array of strings", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 500 }), (raw) => {
                const { title, embeddedTags } = parseTitleLine(raw);
                expect(typeof title).toBe("string");
                expect(Array.isArray(embeddedTags)).toBe(true);
                embeddedTags.forEach((tag) => expect(typeof tag).toBe("string"));
            }),
        );
    });

    it("strips smart quotes / ellipsis / emoji so the title is ASCII-typographically clean", () => {
        // Generate strings that mix the unicode cleanups parseTitleLine
        // performs (smart quotes, ellipsis, variation selector, ZWJ)
        // with plain ASCII noise, and verify none of the targeted
        // characters survive the parse. fast-check 4 collapsed
        // `stringOf(unit, opts)` into `string({ unit, ... })` and
        // dropped `fc.char()`; the per-character generator now lives
        // under the `unit` option directly.
        const noisyAscii = fc.string({
            maxLength: 100,
            unit: fc.oneof(
                fc.constantFrom("‘", "’", "“", "”", "…", "️", "‍"),
                fc.constantFrom("a", "b", "c", "d", "e", " ", "1", "2", "!", "."),
            ),
        });
        fc.assert(
            fc.property(noisyAscii, (raw) => {
                const { title } = parseTitleLine(raw);
                // None of the chars parseTitleLine claims to clean should
                // survive. Listed via alternation (not as a character
                // class) because U+FE0F + U+200D are combining marks —
                // ESLint's no-misleading-character-class rule flags them
                // inside `[…]`.
                expect(title).not.toMatch(/‘|’|“|”|…|️|‍/);
            }),
        );
    });
});
