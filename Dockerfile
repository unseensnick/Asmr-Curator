# syntax=docker/dockerfile:1.7
#
# Mirrors .devcontainer/Dockerfile: `debian:trixie-slim` base, Python 3.14
# installed via uv, Node installed via Volta. One throw-away builder stage
# for the static frontend `dist/`, then a single runtime stage.
#
# Why the convergence with dev: the Node-that-compiles-better-sqlite3 is the
# same Node that loads it at runtime, so NODE_MODULE_VERSION mismatches are
# impossible by construction. dev and prod also share one tool story for
# Python (uv) and Node (Volta) — what works in the devcontainer works here.

# ── Stage 1: Frontend ─────────────────────────────────────────────────────────
FROM node:25-slim AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM debian:trixie-slim
WORKDIR /app

# build-essential: better-sqlite3 source-compile (gcc + g++ + make + python3).
# ffmpeg: /api/convert + patreon-dl streamed downloads.
# ca-certificates + curl: uv + Volta installers fetch over HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# uv → Python 3.14 in a project venv at /opt/venv (devcontainer puts it at
# /home/devuser/.venv; same mechanism, different prefix).
RUN curl -fsSL "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz" \
    | tar -xz --strip-components=1 -C /usr/local/bin uv-x86_64-unknown-linux-gnu/uv \
 && uv python install 3.14 \
 && uv venv --python 3.14 /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Volta → Node 25 (matches the devcontainer's `volta install node@25` from
# its postStartCommand). Volta shims node/npm/etc. through $VOLTA_HOME/bin.
ENV VOLTA_HOME="/root/.volta"
ENV PATH="$VOLTA_HOME/bin:$PATH"
RUN curl -fsSL https://get.volta.sh | bash \
 && volta install node@25

# patreon-dl: same `npm install -g patreon-dl@<X>` the devcontainer's
# postStartCommand runs. 3.9.0 closed upstream parser issues #134 / #135.
ARG PATREON_DL_VERSION=3.9.0
RUN npm install -g patreon-dl@${PATREON_DL_VERSION}

# Python deps + Playwright Chromium (~180 MB native libs for the Drive scrape
# at /api/patreon/ingest-drive-link).
COPY backend/requirements.txt ./backend/requirements.txt
RUN uv pip install --python /opt/venv/bin/python --no-cache-dir -r backend/requirements.txt \
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
