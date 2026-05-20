"""System / liveness endpoints — health probe + frontend status-bar info."""

from fastapi import APIRouter

from backend.main import APP_VERSION, OLLAMA_MODEL

router = APIRouter()


@router.get("/api/health")
def health():
    return {"status": "ok"}


@router.get("/api/system/info")
def system_info():
    return {"model": OLLAMA_MODEL, "version": APP_VERSION}
