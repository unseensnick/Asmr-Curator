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

/**
 * Extracts fields from a raw LLM response string.
 * The LLM sometimes wraps the JSON in prose; this grabs the first `{…}` block.
 * Returns empty strings/arrays if the response isn't valid JSON.
 */
export function parseLlmJson(raw_text: string): LlmResponse {
  try {
    const match = raw_text.match(/\{[\s\S]*\}/);
    if (match) {
      const data = JSON.parse(match[0]);
      return {
        raw_title_line: typeof data.raw_title_line === "string" ? data.raw_title_line : "",
        raw_pill_tags: Array.isArray(data.raw_pill_tags) ? data.raw_pill_tags : [],
        creator_name: typeof data.creator_name === "string" ? data.creator_name : null,
        creator_confidence: data.creator_confidence === "high" ? "high" : "low",
      };
    }
  } catch {
    // non-JSON response — caller handles gracefully
  }
  return { raw_title_line: "", raw_pill_tags: [], creator_name: null, creator_confidence: "low" };
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
  const clean = raw
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/\uFE0F/g, "")
    .replace(/\u200D/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Pipe format: "Title | Tag | Tag"
  const segments = clean
    .split(" | ")
    .map((s) => s.replace(/^\|\s*/, "").replace(/\s*\|$/, "").trim())
    .filter(Boolean);

  if (segments.length >= 2 && segments.every((s) => s.length <= 140)) {
    const title = segments[0]
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
    const inner = m[1].trim();
    if (/^[\s\p{P}]+$/u.test(inner)) continue;
    if (/^\d+\s*(days?|hours?|ago)/i.test(inner) || /^[;:,.]/.test(inner)) continue;
    embeddedTags.push(inner);
  }

  return { title, embeddedTags };
}
