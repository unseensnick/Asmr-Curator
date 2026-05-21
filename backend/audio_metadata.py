"""Read / write / clear ID3, FLAC, MP4 audio metadata via mutagen.

One source of truth for the title / artist / album / album_artist
tag-field dispatch across three format families (MP3 → ID3 frames,
FLAC + OGG → Vorbis comments, M4A + AAC → MP4 atoms).
"""

from collections.abc import Callable
from pathlib import Path

from mutagen.flac import FLAC
from mutagen.id3 import ID3, TALB, TIT2, TPE1, TPE2, ID3NoHeaderError
from mutagen.mp4 import MP4
from mutagen.oggvorbis import OggVorbis

# Canonical field set. Add a new field here and in each per-format table.
FIELDS: tuple[str, ...] = ("title", "artist", "album", "album_artist")

# field name → (ID3 frame id, ID3 frame class). MP3 only.
_MP3_TAGS: dict[str, tuple[str, type]] = {
    "title": ("TIT2", TIT2),
    "artist": ("TPE1", TPE1),
    "album": ("TALB", TALB),
    "album_artist": ("TPE2", TPE2),
}

# field name → Vorbis comment key. FLAC + OGG share the comment vocabulary.
_VORBIS_TAGS: dict[str, str] = {
    "title": "title",
    "artist": "artist",
    "album": "album",
    "album_artist": "albumartist",
}

# field name → MP4 atom key. M4A + AAC.
_M4A_TAGS: dict[str, str] = {
    "title": "\xa9nam",
    "artist": "\xa9ART",
    "album": "\xa9alb",
    "album_artist": "aART",
}


class _Handle:
    """Format-uniform view over a mutagen file. `audio` is None when an
    MP3 has no ID3 header — read returns empties, write creates it,
    clear is a no-op.
    """

    def __init__(self, path: Path):
        self.path = path
        ext = path.suffix.lower()
        self.ext = ext
        self.audio: object | None = None
        self._fmt: str = ""
        if ext == ".mp3":
            self._fmt = "mp3"
            try:
                self.audio = ID3(str(path))
            except ID3NoHeaderError:
                self.audio = None
        elif ext in (".flac", ".ogg"):
            self._fmt = "vorbis"
            self.audio = FLAC(str(path)) if ext == ".flac" else OggVorbis(str(path))
        elif ext in (".m4a", ".aac"):
            self._fmt = "m4a"
            self.audio = MP4(str(path))

    @property
    def is_compatible(self) -> bool:
        return self._fmt != ""

    def read_field(self, field: str) -> str:
        if not self.is_compatible or self.audio is None:
            return ""
        if self._fmt == "mp3":
            tag_id, _ = _MP3_TAGS[field]
            frame = self.audio.get(tag_id)  # type: ignore[union-attr]
            if frame is not None and getattr(frame, "text", None):
                return _first(frame.text)
        elif self._fmt == "vorbis":
            key = _VORBIS_TAGS[field]
            if key in self.audio:  # type: ignore[operator]
                return _first(self.audio[key])  # type: ignore[index]
        elif self._fmt == "m4a":
            key = _M4A_TAGS[field]
            if key in self.audio:  # type: ignore[operator]
                return _first(self.audio[key])  # type: ignore[index]
        return ""

    def set_field(self, field: str, value: str) -> None:
        if not self.is_compatible:
            return
        # MP3 lazily creates the ID3 header on first write.
        if self._fmt == "mp3" and self.audio is None:
            self.audio = ID3()
        if self._fmt == "mp3":
            tag_id, tag_cls = _MP3_TAGS[field]
            self.audio.setall(tag_id, [tag_cls(encoding=3, text=value)])  # type: ignore[union-attr]
        elif self._fmt == "vorbis":
            self.audio[_VORBIS_TAGS[field]] = [value]  # type: ignore[index]
        elif self._fmt == "m4a":
            self.audio[_M4A_TAGS[field]] = [value]  # type: ignore[index]

    def clear_field(self, field: str) -> None:
        if not self.is_compatible or self.audio is None:
            return
        if self._fmt == "mp3":
            tag_id, _ = _MP3_TAGS[field]
            self.audio.delall(tag_id)  # type: ignore[union-attr]
        elif self._fmt == "vorbis":
            key = _VORBIS_TAGS[field]
            if key in self.audio:  # type: ignore[operator]
                del self.audio[key]  # type: ignore[index]
        elif self._fmt == "m4a":
            key = _M4A_TAGS[field]
            if key in self.audio:  # type: ignore[operator]
                del self.audio[key]  # type: ignore[index]

    def save(self) -> None:
        if not self.is_compatible or self.audio is None:
            return
        # MP3's ID3.save needs the path; FLAC / OggVorbis / MP4 already
        # carry it from construction.
        save: Callable = self.audio.save  # type: ignore[union-attr]
        if self._fmt == "mp3":
            save(str(self.path))
        else:
            save()


def _first(values: object) -> str:
    if isinstance(values, list) and values:
        v = values[0]
        return str(v) if v is not None else ""
    if isinstance(values, str):
        return values
    return ""


def write_metadata(path: Path, title: str, artist: str, album: str, album_artist: str) -> None:
    """Write the four standard fields to a metadata-compatible audio file.
    Empty values are skipped (caller's 'leave existing alone' semantic);
    use `clear_metadata` to drop a frame outright.
    """
    h = _Handle(path)
    values = {"title": title, "artist": artist, "album": album, "album_artist": album_artist}
    wrote = False
    for field, value in values.items():
        if value:
            h.set_field(field, value)
            wrote = True
    if wrote:
        h.save()


def read_metadata(path: Path) -> dict[str, str]:
    """Read the four standard fields from a metadata-compatible audio file.
    Always returns a dict with all four keys; missing tags are empty strings.
    Non-tag-compatible extensions also return all empties — callers surface
    that as 'no metadata to load'.
    """
    h = _Handle(path)
    return {field: h.read_field(field) for field in FIELDS}


def clear_metadata(path: Path, fields: list[str]) -> None:
    """Remove the given tag fields entirely (delete-frame semantics).
    Distinct from `write_metadata`'s skip-on-empty: that treats `""` as
    'leave existing alone'; this drops the frame.
    """
    h = _Handle(path)
    if not h.is_compatible or h.audio is None:
        return
    for field in fields:
        h.clear_field(field)
    h.save()
