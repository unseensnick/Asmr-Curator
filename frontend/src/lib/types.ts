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

/** A third-party file-host link surfaced from a Patreon post's body. `text`
 * is the visible anchor text when the source was an `<a>` element (used as
 * the per-download filename hint for Drive scrapes); empty string when the
 * source was an iframe, plain-text URL, or embed. */
export interface ExternalLink {
  url: string;
  text: string;
}

export interface PatreonPost {
  post_id: string;
  title: string;
  tags: string[];
  artist: string;
  post_dir: string | null;
  audio_path: string | null;
  /** URLs found in the post body HTML pointing at third-party file hosts
   * (Google Drive, Mega, MediaFire, Dropbox). patreon-dl can't download these
   * directly — the user opens them in the browser with the extension
   * installed to capture the audio. */
  external_links?: ExternalLink[];
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

export type PatreonContentType =
  | "audio"
  | "video"
  | "image"
  | "attachment"
  // Synthetic flag interpreted by the backend wrapper, not by patreon-dl:
  // when present in `content_types`, the wrapper drops patreon-dl's
  // `posts.with.media.type` filter so posts whose only audio is a Drive
  // link in the body actually surface in the result.
  | "external";

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

/** Response from `POST /api/patreon/ingest-drive-link`. Backend scrapes Drive
 * headlessly, downloads the audio, returns the destination path relative to
 * `LIBRARY_PATH`. */
export interface IngestDriveLinkResponse {
  audio_path: string;
  size: number;
  source_url: string;
  file_id: string;
}

/** Streaming progress events from `POST /api/patreon/ingest-drive-link`.
 * Discriminated by `state`. The endpoint emits each event as a single
 * `data: <json>\n\n` SSE frame; consumers parse with `ingestDriveLinkStream`
 * in `lib/api.ts`. */
export type IngestDriveLinkEvent =
  | { state: "queued"; ahead: number; elapsed_s: number }
  | { state: "launching_browser"; elapsed_s: number }
  | { state: "loading_page"; drive_url: string; elapsed_s: number }
  | { state: "waiting_for_player"; elapsed_s: number }
  | { state: "captured"; elapsed_s: number }
  | {
      state: "downloading";
      bytes: number | null;
      total: number | null;
      download_elapsed_s?: number;
      elapsed_s: number;
    }
  | ({ state: "done" } & IngestDriveLinkResponse)
  | {
      state: "error";
      code: "invalid_url" | "missing_player" | "timeout" | "auth_expired" | "fetch_failed" | "internal";
      message: string;
      debug_dir: string | null;
    };

