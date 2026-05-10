export const API = {
  search:          "/api/files/search",
  rename:          "/api/rename",
  convert:         "/api/convert",
  extract:         "/api/extract",
  previewTags:     "/api/preview-tags",
  dictionary:      "/api/dictionary",
  dictionaryReset: "/api/dictionary/reset",
  vocabulary:      "/api/vocabulary",
  vocabEntry:      (id: number) => `/api/vocabulary/${id}`,
  suppressed:      "/api/suppressed",
  suppressedEntry: (id: number) => `/api/suppressed/${id}`,
  patreonFetch:    "/api/patreon/fetch",
  patreonCookie:   "/api/settings/patreon-cookie",
} as const;

// Thin fetch wrappers — all requests go to the same origin (FastAPI)

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

async function apiDelete<T>(path: string): Promise<T> {
  const r = await fetch(path, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

export { apiGet, apiPost, apiDelete, apiPut, apiPatch };

// ── Patreon helpers ──────────────────────────────────────────────────────────
// JSON.stringify handles the inner `"` chars in `g_state` etc. correctly, so
// the regular JSON path works from the browser despite the shell-quoting pain
// that motivated the backend's text/plain alternative.

import type {
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

export function fetchPatreonPost(
  url: string,
  options: PatreonFetchOptions = {},
): Promise<PatreonFetchResponse> {
  return apiPost<PatreonFetchResponse>(API.patreonFetch, {
    url,
    metadata_only: options.metadataOnly ?? false,
  });
}
