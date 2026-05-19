# syntax=docker/dockerfile:1.7
#
# Three stages: two throw-away builders + one runtime image.
#
#   1. frontend-builder — Vite/TS compile to static dist/
#   2. patreon-dl       — `npm install -g patreon-dl`; the only stage that
#                         compiles native code (better-sqlite3)
#   3. runtime          — python:3.14-slim + Debian apt Node 20 + ffmpeg;
#                         everything is copied in pre-built
#
# Why the patreon-dl install lives in its own stage on `node:20` (not the
# `python:3.14-slim` base, not `-slim` of node):
#   • better-sqlite3's source-compile fallback needs python3 + build-essential,
#     which `node:20-slim` and `python:3.14-slim` both lack
#   • compile-time Node major MUST equal runtime Node major or the produced
#     .node fails to load (NODE_MODULE_VERSION mismatch — the 1.1.0 bug)
# Stage 3 copies only `node_modules/patreon-dl/` over, so the heavyweight
# builder image never lands in the published artifact.

# ── Stage 1: Frontend ─────────────────────────────────────────────────────────
FROM node:25-slim AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: patreon-dl ───────────────────────────────────────────────────────
FROM node:20 AS patreon-dl
ARG PATREON_DL_VERSION=3.9.0
RUN npm install -g --omit=dev patreon-dl@${PATREON_DL_VERSION}

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM python:3.14-slim
WORKDIR /app

# ffmpeg: /api/convert + patreon-dl streamed downloads.
# nodejs:  runs patreon-dl (no compile here — pre-built tree is copied in).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        nodejs \
    && rm -rf /var/lib/apt/lists/*

# patreon-dl: bring the whole global install across + symlink the entry.
COPY --from=patreon-dl /usr/local/lib/node_modules/patreon-dl /usr/local/lib/node_modules/patreon-dl
RUN ln -s /usr/local/lib/node_modules/patreon-dl/bin/patreon-dl.js /usr/local/bin/patreon-dl \
 && chmod +x /usr/local/lib/node_modules/patreon-dl/bin/patreon-dl.js

# Python deps + Playwright Chromium (~180 MB of native libs, used by
# /api/patreon/ingest-drive-link for the Drive scrape).
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt \
 && playwright install --with-deps chromium

COPY backend/ ./backend/
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist
COPY frontend/src/lib/audio-formats.json ./frontend/src/lib/audio-formats.json

RUN mkdir -p /data

ENV DB_PATH=/data/dictionary.db
ENV PYTHONPATH=/app
ENV LIBRARY_PATH=/mnt/audio
ENV DOWNLOAD_PATH=/mnt/downloads

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
