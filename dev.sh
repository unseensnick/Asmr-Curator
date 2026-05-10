#!/bin/bash
trap "kill 0" EXIT
cd frontend && npm run dev &
cd "$(dirname "$0")" && uvicorn backend.main:app --reload &
wait
