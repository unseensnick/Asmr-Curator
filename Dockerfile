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

# Node + npm runtime (apt-shipped — Node 20 LTS on current Debian); ffmpeg used
# by /api/convert and by patreon-dl for streamed-video downloads.
#
# python3-gyp is needed because Debian's `apt install nodejs` doesn't expose
# libc to npm's env, so `prebuild-install` can't match better-sqlite3's hosted
# prebuilds (target=20.19.2 runtime=node arch=x64 libc= platform=linux — note
# the empty libc field) and falls back to source compile. Debian's node-gyp
# imports the `gyp` Python module from a separate `python3-gyp` package; if
# we don't install it the compile dies with `ModuleNotFoundError: No module
# named 'gyp'`. 1.1.1 sidestepped this by installing patreon-dl from a vendored
# .tgz that bundled the prebuilt .node, but 2.x installs from the npm registry
# which only ships source. ~10 MB image cost.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    npm \
    python3-gyp \
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
