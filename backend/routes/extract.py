"""Vision LLM extraction via Ollama + text-only preview for the dictionary test pane."""

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import database
from backend.main import MAX_IMAGE_B64_BYTES, OLLAMA_BASE_URL, OLLAMA_MODEL

router = APIRouter()


def _vocab_section() -> str:
    """Return the vocabulary injection block for Ollama prompts, or empty string."""
    vocab = database.get_vocabulary()
    if not vocab:
        return ""
    tag_list = "\n".join(f"  - {e['canonical']}" for e in vocab)
    return (
        "\nKnown tag vocabulary — use these canonical forms when the extracted tag matches:\n"
        + tag_list
        + "\nIf a tag doesn't match any entry, return it verbatim.\n"
    )


def _build_extract_prompt() -> str:
    return (
        "Look at this ASMR post screenshot and identify these regions.\n"
        "Return valid JSON only:\n\n"
        "{\n"
        '  "raw_title_line": "the full first heading text exactly as written",\n'
        '  "raw_pill_tags": ["each pill/badge tag at the bottom — one entry per badge, keep multi-word badges as a single string verbatim"],\n'
        '  "creator_name": "the channel or creator name shown near a profile picture or avatar, or null if not visible",\n'
        '  "creator_confidence": "high if a clear creator name with profile picture was found, low otherwise"\n'
        "}" + _vocab_section()
    )


def _build_preview_prompt(text: str) -> str:
    return (
        "Parse this ASMR post text. Extract the full title line and any separate tags.\n"
        "Tags may be short labels or longer descriptive phrases — keep each tag as a single string, do not split multi-word tags.\n"
        "Return valid JSON only:\n\n"
        "{\n"
        '  "raw_title_line": "the full title text as written",\n'
        '  "raw_pill_tags": ["each tag as one string — multi-word tags stay together"]\n'
        "}\n" + _vocab_section() + "\nText to parse:\n" + text
    )


async def _call_ollama(payload: dict) -> str:
    """POST a chat payload to Ollama and return the response content string."""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
        r.raise_for_status()
        return r.json().get("message", {}).get("content", "")
    except httpx.ConnectError:
        raise HTTPException(502, f"Cannot reach Ollama at {OLLAMA_BASE_URL}")
    except httpx.TimeoutException:
        raise HTTPException(504, "Ollama timed out — try a smaller model")
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"Ollama error {e.response.status_code}: {e.response.text}")


class ExtractIn(BaseModel):
    image_b64: str
    model: str | None = None


@router.post("/api/extract")
async def extract(body: ExtractIn):
    if len(body.image_b64) > MAX_IMAGE_B64_BYTES:
        raise HTTPException(
            413,
            f"Image too large ({len(body.image_b64)} bytes of base64). "
            f"Limit is {MAX_IMAGE_B64_BYTES} bytes.",
        )
    model = body.model or OLLAMA_MODEL
    prompt = _build_extract_prompt()
    payload = {
        "model": model,
        "stream": False,
        "messages": [{"role": "user", "content": prompt, "images": [body.image_b64]}],
    }
    raw_text = await _call_ollama(payload)
    return {"raw_text": raw_text}


class PreviewTagsIn(BaseModel):
    text: str


@router.post("/api/preview-tags")
async def preview_tags(body: PreviewTagsIn):
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "text cannot be empty")
    prompt = _build_preview_prompt(text)
    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [{"role": "user", "content": prompt}],
    }
    raw_text = await _call_ollama(payload)
    return {"raw_text": raw_text}
