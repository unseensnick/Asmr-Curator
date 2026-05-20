---
paths:
  - "backend/**"
  - "frontend/src/**"
  - "extension/**"
---

# Security

- Validate all user input at the system boundary. Never trust request parameters.
- Use parameterized queries. Never concatenate user input into SQL or shell commands. The backend uses `sqlite3` via `backend/database.py` helpers; all DB writes go through those helpers.
- `backend/routes/convert.py` shells out to `ffmpeg`; `backend/patreon_fetch.py` shells out to `patreon-dl`. Quote and validate every user-supplied path or argument. Reject path traversal (`..`, absolute paths outside the root specified by the request).
- File operations must canonicalise paths and confirm they stay within the **root specified by the request**. The split is:
  - `/api/files*`, `/api/rename`, `/api/convert` validate against the `root` field of the request (`library` → `LIBRARY_PATH`, `downloads` → `DOWNLOAD_PATH`).
  - `/api/patreon/*` ingest endpoints always validate against `DOWNLOAD_PATH`.
  - `/api/mkdir` and `/api/move`'s destination always validate against `LIBRARY_PATH` (the curated archive is the only writable target for new structure); `/api/move`'s source uses the `from_root` field.
  - Use `validate_under_root` / `validate_under_library` / `validate_under_download` in `backend/main.py` — never roll a hand check.
- Sanitise output to prevent XSS in the React UI. Never dangerouslySetInnerHTML user-supplied strings.
- Never log secrets, tokens, or absolute filesystem paths containing PII.
- The Chrome extension (`extension/`) runs in the user's browser — treat anything the content script reads from the page as untrusted, and validate before forwarding to the backend.
- CORS middleware in `backend/main.py` is restricted to the dev Vite origin (`http://localhost:5173` / `http://127.0.0.1:5173`); production serves the SPA same-origin from port 8000 so no cross-origin requests should occur. Don't widen `allow_origins` without a documented reason — it's the gate that blocks malicious-tab `text/plain` PUTs against `/api/settings/patreon-cookie`.
- **Patreon session cookie:** stored in the SQLite DB (`PATREON_COOKIE_KEY` in `backend/main.py`). Never log it, never include it in error messages or subprocess argv that may leak to logs, never return the cookie value from any API route (the existing `/api/settings/patreon-cookie` correctly returns only `{set, length}` — preserve that). Treat it like a long-lived password.
- **Payload size limits:** `/api/extract` accepts a base64-encoded image. Enforce a max request body size (FastAPI `Request.body()` length check or middleware) — otherwise a single multi-megabyte payload can OOM the server. Reject before base64 decode, not after.
- **Subprocess argv:** when invoking `ffmpeg` or `patreon-dl`, never f-string user input into the command string. Pass the argv as a list to `subprocess.run([...])`; quote any path that came from a request body; on errors, do not include the full argv in the response (it may contain the Patreon cookie).
