/** Error-shape handling in the shared `request` wrapper.
 *
 *  Components render `err.message` verbatim, so a non-2xx must never leave
 *  a raw FastAPI envelope in it — users were seeing
 *  `{"detail":"A file with that name already exists."}`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiGet } from "@/lib/api";

function mockResponse(body: string, status = 400, contentType = "application/json") {
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
            ok: false,
            status,
            headers: new Headers({ "content-type": contentType }),
            text: async () => body,
            json: async () => JSON.parse(body),
        })),
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("request error handling", () => {
    it("unwraps a string detail into the message", async () => {
        mockResponse(JSON.stringify({ detail: "A file with that name already exists." }), 409);
        await expect(apiGet("/api/files")).rejects.toThrow("A file with that name already exists.");
    });

    it("does not leave a JSON envelope in the message", async () => {
        mockResponse(JSON.stringify({ detail: "Nope." }), 409);
        const err = await apiGet("/api/files").catch((e: unknown) => e);
        expect((err as Error).message.startsWith("{")).toBe(false);
    });

    it("exposes the status on the error", async () => {
        mockResponse(JSON.stringify({ detail: "Nope." }), 409);
        const err = await apiGet("/api/files").catch((e: unknown) => e);
        expect((err as ApiError).status).toBe(409);
    });

    it("keeps a structured detail available to callers", async () => {
        // bulk-write returns `{ok, results}` and needs the per-item results
        // rather than a sentence.
        const detail = { ok: false, results: [{ path: "a.mp3", ok: false, error: "too long" }] };
        mockResponse(JSON.stringify({ detail }), 422);
        const err = await apiGet("/api/files").catch((e: unknown) => e);
        expect((err as ApiError).detail).toEqual(detail);
    });

    it("uses an embedded message when detail is an object", async () => {
        // /api/delete answers 409 with `{message, count, path}`.
        mockResponse(
            JSON.stringify({ detail: { message: "Folder is not empty.", count: 3 } }),
            409,
        );
        await expect(apiGet("/api/files")).rejects.toThrow("Folder is not empty.");
    });

    it("falls back to the raw body when the response is not JSON", async () => {
        mockResponse("502 Bad Gateway", 502, "text/html");
        await expect(apiGet("/api/files")).rejects.toThrow("502 Bad Gateway");
    });
});
