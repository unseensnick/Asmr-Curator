---
paths:
  - "backend/**"
---

# Error Handling

- FastAPI routes in `backend/main.py` should raise `HTTPException` with explicit status codes (400 validation, 404 not found, 409 conflict, 500 unexpected). Don't return generic `{"error": "..."}` 200 responses.
- Never expose stack traces, internal absolute paths, or raw SQLite errors in production responses. Log them server-side, return a clean message.
- Ollama, `ffmpeg`, and Patreon-fetch subprocess calls are I/O-bound and fail in mundane ways (network timeout, binary missing, file locked). Catch the specific exception, log it with context (the file path or model name involved), and surface a user-facing message — never let the exception bubble as a 500 with internals.
- Never swallow errors silently. Either log with context or rethrow with added context about what operation failed.
- Mutagen metadata writes (`/api/rename`) can fail without the file rename failing — treat them as a soft warning the UI can surface, not a request failure, unless the user explicitly asked for tags to be required.
- Frontend `lib/api.ts` is the single I/O boundary; component error handling should consume its rejection, not re-implement parsing of error bodies.
