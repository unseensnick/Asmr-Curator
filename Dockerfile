# ── Stage 1: Build frontend ────────────────────────────────────────────────────
FROM node:25-slim AS frontend-builder

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production image ──────────────────────────────────────────────────
# patreon-dl installs IN this stage (not a separate node:25-slim builder stage)
# so its better-sqlite3 native binary is compiled against the exact Node version
# that'll run it at runtime. Previously the split builder copied a Node-25-compiled
# .node into a Node-20 (Debian apt) runtime and crashed on every fetch with
# `NODE_MODULE_VERSION 141 vs 115` (hotfixed in 1.1.1).
FROM python:3.14-slim

WORKDIR /app

# ffmpeg for /api/convert + patreon-dl's streamed-video downloads. Node 20 LTS
# comes from nodesource, not Debian apt — Debian Trixie's `nodejs` package
# ships a broken split with node-gyp (the gyp Python module lives in a
# separate apt package that doesn't exist in Trixie), so `npm install` of
# anything with native bindings dies on the source-compile fallback. Nodesource
# bundles upstream npm + node-gyp with its own gyp source, so `npm install -g
# patreon-dl@3.9.0` builds better-sqlite3 cleanly. The build dies one of two
# ways without this: prebuild-install can't match the hosted binary because
# Debian's npm leaves `libc=` empty, then source-compile fails with
# `ModuleNotFoundError: No module named 'gyp'`.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
       | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# patreon-dl from upstream npm. 3.9.0 ships the parser fix that closed issues
# #134 / #135; pre-3.9.0 we shipped a locally-patched tarball from
# vendor/patreon-dl/ (see git history if a future regression makes that
# pattern necessary again).
ARG PATREON_DL_VERSION=3.9.0
RUN npm install -g --omit=dev patreon-dl@${PATREON_DL_VERSION}

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
