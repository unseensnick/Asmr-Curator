#!/bin/bash
trap "kill 0" EXIT
cd frontend && npm run dev &
# --host 0.0.0.0 so the devcontainer's Docker-published port reaches the
# server. On bare metal this is also harmless: 0.0.0.0 includes 127.0.0.1.
# Production uses the same flag (see Dockerfile CMD).
cd "$(dirname "$0")" && uvicorn backend.main:app --reload --host 0.0.0.0 &
wait
