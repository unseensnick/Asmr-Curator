"""Audio-format conversion via ffmpeg subprocess."""
import subprocess

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.main import (
    AUDIO_EXTS,
    FFMPEG_SUBPROCESS_TIMEOUT_S,
    OUTPUT_FORMATS,
    QUALITY_FLAGS,
    log,
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
    if fmt not in QUALITY_FLAGS:
        raise HTTPException(400, f"Unsupported output format: {fmt}")

    quality = body.quality.lower()
    if quality not in QUALITY_FLAGS[fmt]:
        raise HTTPException(400, f"Unsupported quality '{quality}' for format '{fmt}'")

    fmt_info = next(f for f in OUTPUT_FORMATS if f["value"] == fmt)
    if src.suffix.lower() == fmt_info["ext"]:
        raise HTTPException(400, "File is already in this format")
    dest = src.with_suffix(fmt_info["ext"])
    reject_if_exists(dest)

    codec_flags = QUALITY_FLAGS[fmt][quality]
    cmd = ["ffmpeg", "-i", str(src), "-vn"] + codec_flags + [str(dest)]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=FFMPEG_SUBPROCESS_TIMEOUT_S,
        )
    except FileNotFoundError:
        raise HTTPException(500, "ffmpeg not found — make sure it is installed")
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Conversion timed out")

    if result.returncode != 0:
        # Log full stderr server-side; return a generic message so internal
        # filesystem paths + command lines don't leak.
        log.error("ffmpeg conversion failed for %s: %s", src.name, result.stderr)
        raise HTTPException(500, "Conversion failed. Check the server log for ffmpeg output.")

    if body.delete_original:
        try:
            src.unlink()
        except OSError:
            pass

    return {
        "converted": True,
        "old_name": src.name,
        "new_name": dest.name,
        "path": str(dest.relative_to(root_path)),
        "root": body.root,
    }
