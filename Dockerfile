# ── Stage 1: Build frontend ────────────────────────────────────────────────────
FROM node:25-slim AS frontend-builder

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Install patreon-dl ────────────────────────────────────────────────
# Pinned version — bump intentionally when verifying upstream changes.
FROM node:25-slim AS patreon-dl
ARG PATREON_DL_VERSION=3.8.1
RUN npm install -g --omit=dev patreon-dl@${PATREON_DL_VERSION}

# ── Stage 3: Production image ──────────────────────────────────────────────────
FROM python:3.14-slim

WORKDIR /app

# Node 20 runtime is required by patreon-dl; ffmpeg is used by /api/convert and
# also by patreon-dl when downloading streamed video.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

# patreon-dl global install — the binary stub plus its node_modules tree.
COPY --from=patreon-dl /usr/local/lib/node_modules/patreon-dl /usr/local/lib/node_modules/patreon-dl
RUN ln -s /usr/local/lib/node_modules/patreon-dl/bin/patreon-dl.js /usr/local/bin/patreon-dl \
    && chmod +x /usr/local/lib/node_modules/patreon-dl/bin/patreon-dl.js

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
