import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { AppDict } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  if (k in dict._canonicalMap) return dict._canonicalMap[k];
  if (/^(sfw|nsfw)$/i.test(k)) return k.toUpperCase();
  const trimmed = val.trim();
  return opts?.titleCase ? trimmed.replace(/\b\w/g, (c) => c.toUpperCase()) : trimmed;
}
