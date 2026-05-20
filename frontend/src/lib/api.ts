export const API = {
    files: "/api/files",
    search: "/api/files/search",
    rename: "/api/rename",
    renamePath: "/api/rename-path",
    convert: "/api/convert",
    mkdir: "/api/mkdir",
    move: "/api/move",
    moveBatch: "/api/move/batch",
    delete: "/api/delete",
    extract: "/api/extract",
    previewTags: "/api/preview-tags",
    dictionary: "/api/dictionary",
    dictionaryReset: "/api/dictionary/reset",
    vocabulary: "/api/vocabulary",
    vocabEntry: (id: number) => `/api/vocabulary/${id}`,
    suppressed: "/api/suppressed",
    suppressedEntry: (id: number) => `/api/suppressed/${id}`,
    patreonFetch: "/api/patreon/fetch",
    patreonCookie: "/api/settings/patreon-cookie",
    googleCookie: "/api/settings/google-cookie",
    ingestDriveLink: "/api/patreon/ingest-drive-link",
    systemInfo: "/api/system/info",
} as const;

/** Root selector for file ops. Library = curated archive, Downloads = ingest staging. */
export type FileRoot = "library" | "downloads";

// Thin fetch wrappers — same-origin (FastAPI). AbortController per-call so
// a stalled Ollama / hung patreon-dl / dead backend can't leave the UI
// spinning forever. Generous defaults, bounded.

const DEFAULT_TIMEOUT_MS = 60_000;

// Per-endpoint overrides for the slow paths.
const ENDPOINT_TIMEOUTS: Array<{ match: RegExp; ms: number }> = [
    { match: /^\/api\/extract\b/, ms: 120_000 }, // Ollama vision can be slow on cold start
    { match: /^\/api\/preview-tags\b/, ms: 120_000 },
    { match: /^\/api\/convert\b/, ms: 600_000 }, // ffmpeg encodes; matches backend timeout
    { match: /^\/api\/patreon\/fetch\b/, ms: 1_800_000 }, // creator-wide downloads
    { match: /^\/api\/patreon\/ingest-external-audio\b/, ms: 600_000 },
    // `/api/patreon/ingest-drive-link` and `/api/move/batch` are SSE
    // streams (see ingestDriveLinkStream / moveBatchStream) — no total
    // timeout, that would cut healthy long streams short.
];

function timeoutFor(path: string): number {
    for (const { match, ms } of ENDPOINT_TIMEOUTS) {
        if (match.test(path)) return ms;
    }
    return DEFAULT_TIMEOUT_MS;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutFor(path));
    try {
        const r = await fetch(path, { ...init, signal: controller.signal });
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as T;
    } catch (e) {
        // Surface a clearer message than the default AbortError.
        if (e instanceof DOMException && e.name === "AbortError") {
            throw new Error(`Request timed out after ${timeoutFor(path) / 1000}s: ${path}`);
        }
        throw e;
    } finally {
        clearTimeout(id);
    }
}

const JSON_HEADERS = { "Content-Type": "application/json" };

async function apiGet<T>(path: string): Promise<T> {
    return request<T>(path);
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
    });
}

async function apiDelete<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
    });
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
    });
}

// `?key=val&...` from a flat object. Skips undefined/null/"". Returns
// `""` when no entries survive — safe to concatenate to the base path.
export function buildQueryString(
    params: Record<string, string | number | undefined | null>,
): string {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === "") continue;
        usp.set(k, String(v));
    }
    const s = usp.toString();
    return s ? `?${s}` : "";
}

export { apiGet, apiPost, apiDelete, apiPut, apiPatch };

// ── Patreon helpers ──────────────────────────────────────────────────────────
// JSON.stringify handles the inner `"` chars in `g_state` etc. correctly, so
// the regular JSON path works from the browser despite the shell-quoting pain
// that motivated the backend's text/plain alternative.

import type {
    GoogleCookieStatus,
    IngestDriveLinkEvent,
    IngestDriveLinkResponse,
    PatreonCookieStatus,
    PatreonFetchOptions,
    PatreonFetchResponse,
} from "./types";

export function getPatreonCookieStatus(): Promise<PatreonCookieStatus> {
    return apiGet<PatreonCookieStatus>(API.patreonCookie);
}

export function setPatreonCookie(cookie: string): Promise<PatreonCookieStatus> {
    return apiPut<PatreonCookieStatus>(API.patreonCookie, { cookie });
}

export function getGoogleCookieStatus(): Promise<GoogleCookieStatus> {
    return apiGet<GoogleCookieStatus>(API.googleCookie);
}

// Manual setting is not exposed: Google cookies are an array of structured
// entries that can't reasonably be pasted by hand. The browser extension
// (extension/) is the sync path. Clearing IS supported here so the user can
// drop a stale session from the UI without round-tripping curl.
export function clearGoogleCookies(): Promise<GoogleCookieStatus> {
    return apiPut<GoogleCookieStatus>(API.googleCookie, { cookies: [] });
}

/**
 * Stream Drive-link ingest progress via SSE.
 *
 * `onEvent` fires for each progress event (`launching_browser` →
 * `loading_page` → `captured` → `downloading` → `done`/`error`). Resolves
 * on `done`, rejects on `error`. `AbortSignal` cancels mid-stream — the
 * backend tears down the Playwright session on client disconnect.
 */
export async function ingestDriveLinkStream(
    postId: string,
    driveUrl: string,
    onEvent: (event: IngestDriveLinkEvent) => void,
    options: {
        filename?: string;
        title?: string;
        artist?: string;
        signal?: AbortSignal;
    } = {},
): Promise<IngestDriveLinkResponse> {
    const body: Record<string, unknown> = { post_id: postId, drive_url: driveUrl };
    if (options.filename) body.filename = options.filename;
    if (options.title) body.title = options.title;
    if (options.artist) body.artist = options.artist;

    const response = await fetch(API.ingestDriveLink, {
        method: "POST",
        headers: { ...JSON_HEADERS, Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: options.signal,
    });
    if (!response.ok) {
        // Up-front validation errors (412 missing cookie, 400 bad post_id) come
        // through as regular JSON responses, not SSE. Surface their `detail`.
        const text = await response.text().catch(() => "");
        throw new Error(text || `Request failed: ${response.status}`);
    }
    if (!response.body) {
        throw new Error("Response has no body — SSE not supported in this browser?");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let finalResult: IngestDriveLinkResponse | undefined;
    let finalError: { code: string; message: string; debug_dir: string | null } | undefined;

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // Frames are separated by a blank line per SSE spec. Each frame
            // contains one or more `field: value` lines; we only emit `data:`.
            // Stripping `\r` makes us robust to CRLF servers (Windows uvicorn).
            while (true) {
                const sepIdx = buffer.indexOf("\n\n");
                if (sepIdx < 0) break;
                const frame = buffer.slice(0, sepIdx).replace(/\r/g, "");
                buffer = buffer.slice(sepIdx + 2);
                for (const line of frame.split("\n")) {
                    if (!line.startsWith("data:")) continue;
                    const payload = line.slice(5).trimStart();
                    let parsed: IngestDriveLinkEvent;
                    try {
                        parsed = JSON.parse(payload) as IngestDriveLinkEvent;
                    } catch {
                        continue; // Malformed frame — ignore rather than crash.
                    }
                    onEvent(parsed);
                    if (parsed.state === "done") {
                        const { state: _state, ...rest } = parsed;
                        finalResult = rest as IngestDriveLinkResponse;
                    } else if (parsed.state === "error") {
                        finalError = {
                            code: parsed.code,
                            message: parsed.message,
                            debug_dir: parsed.debug_dir,
                        };
                    }
                }
            }
        }
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // Already released by abort — no-op.
        }
    }

    if (finalError) {
        const err = new Error(finalError.message);
        (err as Error & { code?: string; debug_dir?: string | null }).code = finalError.code;
        (err as Error & { code?: string; debug_dir?: string | null }).debug_dir =
            finalError.debug_dir;
        throw err;
    }
    if (!finalResult) {
        throw new Error("Drive scrape ended without a final `done` event");
    }
    return finalResult;
}

export function fetchPatreonPost(
    url: string,
    options: PatreonFetchOptions = {},
): Promise<PatreonFetchResponse> {
    const body: Record<string, unknown> = {
        url,
        metadata_only: options.metadataOnly ?? false,
    };
    if (options.contentTypes && options.contentTypes.length > 0) {
        body.content_types = options.contentTypes;
    }
    if (options.publishedAfter) {
        body.published_after = options.publishedAfter;
    }
    if (options.publishedBefore) {
        body.published_before = options.publishedBefore;
    }
    if (options.dryRun) {
        body.dry_run = true;
    }
    return apiPost<PatreonFetchResponse>(API.patreonFetch, body);
}

// ── Batch move (cut/paste) ───────────────────────────────────────────────────
//
// `/api/move/batch` is a Server-Sent-Events route so the client can show
// per-item progress on long cross-mount batches (the backend runs each
// `shutil.move` in an `asyncio.to_thread`). Frames:
//   • `started`  — `{ event, total }`
//   • `item`     — `{ event, index, total, from_path, ok, to_path?, error? }`
//   • `complete` — `{ event, moved, results }`  (final aggregate)

export interface MoveBatchItem {
    from_path: string;
    new_name?: string;
}

export interface MoveBatchRequest {
    items: MoveBatchItem[];
    from_root: FileRoot;
    to_subdir: string;
}

export interface MoveBatchResult {
    from_path: string;
    ok: boolean;
    to_path?: string;
    error?: { code: string; message: string };
}

export interface MoveBatchResponse {
    moved: number;
    results: MoveBatchResult[];
}

export type MoveBatchEvent =
    | { event: "started"; total: number }
    | ({ event: "item"; index: number; total: number } & MoveBatchResult)
    | { event: "complete"; moved: number; results: MoveBatchResult[] };

export async function moveBatchStream(
    body: MoveBatchRequest,
    onEvent?: (e: MoveBatchEvent) => void,
): Promise<MoveBatchResponse> {
    const response = await fetch(API.moveBatch, {
        method: "POST",
        headers: { ...JSON_HEADERS, Accept: "text/event-stream" },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        // Up-front validation errors (e.g. malformed body) come through as a
        // normal JSON response, not an SSE stream. Surface their `detail`.
        const text = await response.text().catch(() => "");
        throw new Error(text || `Request failed: ${response.status}`);
    }
    if (!response.body) {
        throw new Error("Response has no body — SSE not supported in this browser?");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let final: MoveBatchResponse | undefined;

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            while (true) {
                const sepIdx = buffer.indexOf("\n\n");
                if (sepIdx < 0) break;
                const frame = buffer.slice(0, sepIdx).replace(/\r/g, "");
                buffer = buffer.slice(sepIdx + 2);
                for (const line of frame.split("\n")) {
                    if (!line.startsWith("data:")) continue;
                    const payload = line.slice(5).trimStart();
                    let parsed: MoveBatchEvent;
                    try {
                        parsed = JSON.parse(payload) as MoveBatchEvent;
                    } catch {
                        continue; // Malformed frame — ignore rather than crash.
                    }
                    onEvent?.(parsed);
                    if (parsed.event === "complete") {
                        final = { moved: parsed.moved, results: parsed.results };
                    }
                }
            }
        }
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // Already released — no-op.
        }
    }

    if (!final) {
        throw new Error("Move batch ended without a final `complete` event");
    }
    return final;
}
