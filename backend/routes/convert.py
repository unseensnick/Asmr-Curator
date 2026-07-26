"""Audio-format conversion via ffmpeg subprocess."""

import contextlib

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.audio_convert import ConversionError, convert_audio, validate_conversion_request
from backend.main import (
    AUDIO_EXTS,
    OUTPUT_FORMATS,
    reject_if_exists,
    require_file,
    root_for,
    validate_under_root,
)

router = APIRouter()


@router.get("/api/convert/formats")
def get_convert_formats():
    """Return the list of supported output formats for conversion."""
    return OUTPUT_FORMATS


class ConvertIn(BaseModel):
    path: str
    output_format: str
    quality: str
    root: str = "library"
    delete_original: bool = False
    # Power-mode override: explicit CBR target in kbps. When present, the
    # preset's `-q:a` is swapped for `-b:a <N>k` and the codec name from
    # the preset is kept. Rejected for FLAC (lossless has no bitrate).
    bitrate_kbps: int | None = None


@router.post("/api/convert")
def convert_file(body: ConvertIn):
    root_path = root_for(body.root)
    src = validate_under_root(body.path, root_path)
    require_file(src)
    if not src.is_file():
        raise HTTPException(400, "Path is not a file")
    if src.suffix.lower() not in AUDIO_EXTS:
        raise HTTPException(400, f"{src.suffix} is not a supported audio format")

    fmt = body.output_format.lower()
    quality = body.quality.lower()
    try:
        validate_conversion_request(fmt, quality, body.bitrate_kbps)
    except ConversionError as e:
        raise HTTPException(400, str(e))

    fmt_info = next(f for f in OUTPUT_FORMATS if f["value"] == fmt)
    if src.suffix.lower() == fmt_info["ext"]:
        raise HTTPException(400, "File is already in this format")
    dest = src.with_suffix(fmt_info["ext"])
    reject_if_exists(dest)

    try:
        convert_audio(src, dest, fmt, quality, body.bitrate_kbps)
    except ConversionError as e:
        # ffmpeg stderr is already logged inside convert_audio; the message
        # here is the user-safe one. Timeout keeps its own status.
        status = 504 if "timed out" in str(e) else 500
        raise HTTPException(status, str(e))

    if body.delete_original:
        with contextlib.suppress(OSError):
            src.unlink()

    return {
        "converted": True,
        "old_name": src.name,
        "new_name": dest.name,
        "path": str(dest.relative_to(root_path)),
        "root": body.root,
    }
