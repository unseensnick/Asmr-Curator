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
# that'll run it at runtime. Previously we copied a Node-25-compiled .node into
# a Node-20 (Debian apt) runtime and crashed on every fetch with
# `NODE_MODULE_VERSION 141 vs 115`.
FROM python:3.14-slim

WORKDIR /app

# Node + npm runtime (apt-shipped — Node 20 LTS on current Debian); ffmpeg used
# by /api/convert and by patreon-dl for streamed-video downloads.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install patreon-dl from the locally-patched tarball (upstream 3.8.1 ships a
# parser regex that doesn't match Patreon's current HTML — issues #134/#135).
# See vendor/patreon-dl/README.md for the patch + rebuild instructions.
COPY vendor/patreon-dl/patreon-dl-3.8.1-localfix.tgz /tmp/patreon-dl.tgz
RUN npm install -g --omit=dev /tmp/patreon-dl.tgz && rm /tmp/patreon-dl.tgz

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/

# Built frontend assets served by FastAPI at /
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist

# Shared config read by the backend at startup
COPY frontend/src/lib/audio-formats.json ./frontend/src/lib/audio-formats.json

RUN mkdir -p /data

ENV DB_PATH=/data/dictionary.db
ENV PYTHONPATH=/app
ENV AUDIO_ROOT=/mnt/audio

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
