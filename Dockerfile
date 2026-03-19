FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (layer caching — only re-runs when requirements.txt changes)
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy source (overridden by bind mounts in dev via docker-compose volumes)
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Data directory for SQLite
RUN mkdir -p /data

ENV DB_PATH=/data/dictionary.db
ENV PYTHONPATH=/app

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
