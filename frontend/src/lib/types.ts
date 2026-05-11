// ── Dictionary ────────────────────────────────────────────────────────────────

export interface VocabEntry {
  id: number;
  canonical: string;    // display form used in filenames, e.g. "Soft Spot For You"
  aliases: string[];    // lowercase alternate spellings, e.g. ["soft spot foryou"]
}

export interface SuppressedTerm {
  id: number;
  term: string;         // lowercase term to suppress
}

/** Shape of the /api/dictionary response */
export interface DictionaryApiResponse {
  vocabulary: VocabEntry[];
  suppressed: SuppressedTerm[];
}

/** Client-side dictionary state */
export interface AppDict {
  vocabulary: VocabEntry[];
  suppressed: SuppressedTerm[];
  // derived — rebuilt after every mutation
  _canonicalMap: Record<string, string>;  // lowercase alias/canonical → canonical display
  _suppressed: Set<string>;              // lowercase terms to suppress (O(1) lookup)
}

/** Build the derived fields from vocabulary + suppressed arrays. */
export function buildDictDerived(
  vocabulary: VocabEntry[],
  suppressed: SuppressedTerm[],
): Pick<AppDict, "_canonicalMap" | "_suppressed"> {
  const _canonicalMap: Record<string, string> = {};
  for (const entry of vocabulary) {
    _canonicalMap[entry.canonical.toLowerCase()] = entry.canonical;
    for (const alias of entry.aliases) {
      if (alias) _canonicalMap[alias.toLowerCase()] = entry.canonical;
    }
  }
  const _suppressed = new Set(suppressed.map((s) => s.term.toLowerCase()));
  return { _canonicalMap, _suppressed };
}

export function dictFromApiResponse(data: DictionaryApiResponse): AppDict {
  return {
    vocabulary: data.vocabulary,
    suppressed: data.suppressed,
    ...buildDictDerived(data.vocabulary, data.suppressed),
  };
}

export const emptyDict = (): AppDict => ({
  vocabulary: [],
  suppressed: [],
  _canonicalMap: {},
  _suppressed: new Set(),
});

// ── File browser ──────────────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  ext: string;
  path: string;
  folder: string;
  needs_conversion?: boolean;
}

export type SearchMode = "filename" | "folder" | "both";
export type RenameSep = "dash" | "pipe";

// ── Conversion ────────────────────────────────────────────────────────────────

export type ConvertFormat = "mp3" | "flac" | "ogg";
export type ConvertQuality = "low" | "standard" | "high" | "best";

export interface OutputFormat {
  value: ConvertFormat;
  label: string;
  lossless: boolean;
  ext: string;
}

// ── Patreon download ──────────────────────────────────────────────────────────

export interface PatreonPost {
  post_id: string;
  title: string;
  tags: string[];
  artist: string;
  post_dir: string | null;
  audio_path: string | null;
}

export interface PatreonFetchResponse {
  output_dir: string | null;
  count: number;
  metadata_only: boolean;
  dry_run: boolean;
  posts: PatreonPost[];
  hint?: string;
  log_tail?: string;
}

export type PatreonContentType = "audio" | "video" | "image" | "attachment";

export interface PatreonFetchOptions {
  metadataOnly?: boolean;
  /** Media types patreon-dl should download. Omit / empty → backend default ["audio"]. */
  contentTypes?: PatreonContentType[];
  /** ISO YYYY-MM-DD. Only meaningful for creator URLs. */
  publishedAfter?: string;
  publishedBefore?: string;
  /** Walk the pipeline without writing files. Returns no parsed posts; log tail is the preview. */
  dryRun?: boolean;
}

export interface PatreonCookieStatus {
  set: boolean;
  length: number;
}

