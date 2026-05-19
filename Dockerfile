# ── Stage 1: Build frontend ────────────────────────────────────────────────────
FROM node:25-slim AS frontend-builder

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Install patreon-dl ────────────────────────────────────────────────
# Must be Node 20 LTS — Stage 3's runtime is Node 20 (Debian apt), and
# better-sqlite3's native .node binary is compiled here against this stage's
# Node ABI. Mismatching the two stages was the 1.1.0 bug
# (NODE_MODULE_VERSION 141 vs 115). Using the official node:20 image instead
# of `apt install nodejs` on python:3.14-slim avoids the entire Debian-Trixie
# nodejs/node-gyp mess: node:20 ships upstream npm + node-gyp + prebuilt
# better-sqlite3 binaries that match its own Node, so `npm install` just works.
FROM node:20-slim AS patreon-dl
ARG PATREON_DL_VERSION=3.9.0
RUN npm install -g --omit=dev patreon-dl@${PATREON_DL_VERSION}

# ── Stage 3: Production image ──────────────────────────────────────────────────
FROM python:3.14-slim

WORKDIR /app

# Node 20 runtime + ffmpeg (used by /api/convert and patreon-dl's streamed
# downloads). Debian Trixie ships Node 20.x as `nodejs` — apt install is
# sufficient at the runtime stage because we copy patreon-dl's already-built
# node_modules from Stage 2; nothing is compiled here.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

# patreon-dl: binary stub + its node_modules tree (with better-sqlite3's
# prebuilt .node already in place from Stage 2).
COPY --from=patreon-dl /usr/local/lib/node_modules/patreon-dl /usr/local/lib/node_modules/patreon-dl
RUN ln -s /usr/local/lib/node_modules/patreon-dl/bin/patreon-dl.js /usr/local/bin/patreon-dl \
    && chmod +x /usr/local/lib/node_modules/patreon-dl/bin/patreon-dl.js

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Playwright Chromium + its native deps (~180 MB) — used by
# /api/patreon/ingest-drive-link to scrape Drive playback URLs headlessly.
# Must run after `pip install playwright` (already in requirements.txt).
RUN playwright install --with-deps chromium

COPY backend/ ./backend/

# Built frontend assets served by FastAPI at /
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist

# Shared config read by the backend at startup
COPY frontend/src/lib/audio-formats.json ./frontend/src/lib/audio-formats.json

RUN mkdir -p /data

ENV DB_PATH=/data/dictionary.db
ENV PYTHONPATH=/app
ENV LIBRARY_PATH=/mnt/audio
ENV DOWNLOAD_PATH=/mnt/downloads

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
