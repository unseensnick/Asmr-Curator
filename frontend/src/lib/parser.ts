// =============================================================================
// parser.ts — LLM response helpers
// =============================================================================

// ── LLM JSON helper ───────────────────────────────────────────────────────────

export interface LlmResponse {
    raw_title_line: string;
    raw_pill_tags: string[];
    creator_name: string | null;
    creator_confidence: "high" | "low";
}

const EMPTY_RESPONSE: LlmResponse = {
    raw_title_line: "",
    raw_pill_tags: [],
    creator_name: null,
    creator_confidence: "low",
};

/**
 * Scans `text` for the first balanced `{…}` block and returns the substring.
 *
 * Brace-balanced, not greedy — a greedy `/\{[\s\S]*\}/` match against prose
 * with multiple JSON-looking blobs (e.g. an example followed by the real
 * answer) captures from the first `{` to the *last* `}`, producing invalid
 * JSON that fails the parse and silently degrades to the empty fallback.
 * String literals are tracked so braces inside `"…"` don't perturb depth.
 */
function findFirstJsonObject(text: string): string | null {
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        if (inString) {
            if (escape) escape = false;
            else if (c === "\\") escape = true;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') {
            inString = true;
            continue;
        }
        if (c === "{") {
            if (depth === 0) start = i;
            depth++;
        } else if (c === "}") {
            depth--;
            if (depth === 0 && start !== -1) {
                return text.slice(start, i + 1);
            }
        }
    }
    return null;
}

/**
 * Extracts fields from a raw LLM response string.
 * The LLM sometimes wraps the JSON in prose; this grabs the first balanced
 * `{…}` block. Returns empty strings/arrays if the response isn't valid JSON.
 */
export function parseLlmJson(raw_text: string): LlmResponse {
    const candidate = findFirstJsonObject(raw_text);
    if (!candidate) return EMPTY_RESPONSE;
    try {
        const data = JSON.parse(candidate);
        return {
            raw_title_line: typeof data.raw_title_line === "string" ? data.raw_title_line : "",
            raw_pill_tags: Array.isArray(data.raw_pill_tags) ? data.raw_pill_tags : [],
            creator_name: typeof data.creator_name === "string" ? data.creator_name : null,
            creator_confidence: data.creator_confidence === "high" ? "high" : "low",
        };
    } catch {
        return EMPTY_RESPONSE;
    }
}

// ── Title line parser ─────────────────────────────────────────────────────────

/**
 * Splits a raw LLM title line into a clean title and any tags embedded in it.
 *
 * Handles two Patreon formats:
 *  1. Pipe:  "Title | Tag1 | Tag2"
 *  2. Plain: "Title (Tag1) (Tag2)"
 *
 * Does NOT normalise against the dictionary — callers handle that.
 */
export function parseTitleLine(raw: string): { title: string; embeddedTags: string[] } {
    // Emoji handling: use Unicode property escapes instead of hand-picked
    // ranges. The previous logic ([\u{1F000}-\u{1FFFF}] + [\u{2600}-\u{27BF}])
    // missed Misc Symbols & Arrows (U+2B00 to U+2BFF \u2014 stars and shapes),
    // Misc Technical (U+2300 to U+23FF \u2014 clocks and hourglasses), and
    // emoji-shaped punctuation in lower blocks.
    //
    //   - \p{Extended_Pictographic} is the spec-canonical set for
    //     emoji-shaped characters; the standard "is this an emoji" check.
    //   - \p{Regional_Indicator} covers the paired regional-indicator
    //     points that compose country flags.
    //   - Variation selectors (FE00-FE0F) and ZWJ (200D) are joiner code
    //     points used inside multi-codepoint emoji sequences.
    //   - Tag characters (E0020-E007F) compose subdivision flags. Strip
    //     them so no orphan joiners survive a partial sequence.
    const clean = raw
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/\u2026/g, "...")
        .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}]/gu, "")
        .replace(/[\uFE00-\uFE0F]/g, "")
        .replace(/\u200D/g, "")
        .replace(/[\u{E0020}-\u{E007F}]/gu, "")
        .replace(/\s{2,}/g, " ")
        .trim();

    // Pipe format: "Title | Tag | Tag"
    const segments = clean
        .split(" | ")
        .map((s) =>
            s
                .replace(/^\|\s*/, "")
                .replace(/\s*\|$/, "")
                .trim(),
        )
        .filter(Boolean);

    if (segments.length >= 2 && segments.every((s) => s.length <= 140)) {
        // segments.length >= 2 guarantees segments[0] is defined.
        const title = segments[0]!
            .replace(/[-–\s]+$/, "")
            .replace(/^[\s&#+¥*~©®°|\\/<>@]+/, "")
            .trim();
        return { title, embeddedTags: segments.slice(1) };
    }

    // Plain format — title before first paren, paren contents become tags.
    // When no paren exists we keep the whole cleaned string — silently
    // truncating long titles surprised callers (see review note).
    const parenIdx = clean.indexOf("(");
    const title = (parenIdx > 0 ? clean.slice(0, parenIdx) : clean)
        .trim()
        .replace(/[-–\s]+$/, "")
        .trim();

    const embeddedTags: string[] = [];
    const rx = /\(([^)]{2,200})\)/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(clean)) !== null) {
        // Capture group 1 is always present when the regex matches.
        const inner = m[1]!.trim();
        if (/^[\s\p{P}]+$/u.test(inner)) continue;
        if (/^\d+\s*(days?|hours?|ago)/i.test(inner) || /^[;:,.]/.test(inner)) continue;
        embeddedTags.push(inner);
    }

    return { title, embeddedTags };
}
