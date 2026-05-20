import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import type { AppDict } from "./types";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Split a backend error message of the form `... log tail: <noisy>` into a
 *  short head (safe to display to the user) and the noisy log tail (route to
 *  the dedicated log surface). When the marker isn't present, head == full
 *  message and tail == "". */
export function splitLogTail(msg: string): { head: string; logTail: string } {
    const idx = msg.indexOf("log tail:");
    if (idx === -1) return { head: msg, logTail: "" };
    return {
        head: msg
            .slice(0, idx)
            .trim()
            .replace(/[.\s]+$/, ""),
        logTail: msg.slice(idx + "log tail:".length).trim(),
    };
}

export function sanitizeFilename(str: string): string {
    return str
        .replace(/[\\/:*?"<>]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim()
        .replace(/(?<!\.)\.$/, "")
        .replace(/ +$/, "");
}

/** Normalises a tag through the dictionary.
 *  Returns null if the tag is empty or suppressed.
 *  Pass { titleCase: true } to title-case unknown tags (used during LLM extraction). */
export function normalizeTag(
    val: string,
    dict: AppDict,
    opts?: { titleCase?: boolean },
): string | null {
    const k = val.trim().toLowerCase();
    if (!k) return null;
    if (dict._suppressed.has(k)) return null;
    if (k in dict._canonicalMap) return dict._canonicalMap[k] ?? null;
    if (/^(sfw|nsfw)$/i.test(k)) return k.toUpperCase();
    const trimmed = val.trim();
    return opts?.titleCase ? trimmed.replace(/\b\w/g, (c) => c.toUpperCase()) : trimmed;
}
