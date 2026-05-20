"""Tests for backend.audio_utils — pure helper functions for URL cleaning and
filename derivation, shared between the legacy external-audio ingest and the
new Drive scrape paths.

These functions are the single source of truth for two semantics that must
not drift between ingest paths:
- which query params are stripped from a captured Google playback URL
- how a filename is derived (caller override > Content-Disposition > fallback)
"""

from pathlib import Path

from backend.audio_utils import (
    STRIP_QUERY_PARAMS,
    derive_filename,
    ext_from_content_type,
    filename_from_content_disposition,
    flatten_dest_parts,
    safe_filename_component,
    strip_query_params,
    unique_destination,
)

# ── strip_query_params ─────────────────────────────────────────────────────


class TestStripQueryParams:
    def test_returns_url_unchanged_when_no_query(self):
        url = "https://example.com/path"
        assert strip_query_params(url) == url

    def test_strips_named_param_default_set(self):
        # Drive playback URLs carry these three; all should be stripped.
        url = "https://rr.c.drive.google.com/videoplayback?ump=1&range=0-100&sig=abc"
        result = strip_query_params(url)
        assert "ump=" not in result
        assert "range=" not in result
        assert "sig=abc" in result  # untouched param survives

    def test_preserves_byte_identical_values_with_slashes(self):
        # Drive's signed URLs contain `mime=audio/mp4` — a `/` in the value
        # would be percent-encoded by parse_qsl+urlencode, invalidating the
        # signature. The function operates on raw query segments to avoid this.
        url = "https://example.com/v?mime=audio/mp4&sig=xyz"
        assert strip_query_params(url, names=("ump",)) == url

    def test_preserves_param_order_of_kept_params(self):
        url = "https://example.com/v?a=1&ump=2&b=3&range=4&c=5"
        result = strip_query_params(url)
        # Kept params keep their relative order from the original URL.
        assert result == "https://example.com/v?a=1&b=3&c=5"

    def test_srfvp_is_in_default_strip_set(self):
        # Regression guard: srfvp was added late in the Drive iteration
        # because Drive's CDN honoured it by capping the response to a
        # tiny initial range. Make sure it stays in the default tuple.
        assert "srfvp" in STRIP_QUERY_PARAMS
        assert "ump" in STRIP_QUERY_PARAMS
        assert "range" in STRIP_QUERY_PARAMS

    def test_segment_without_equals_sign_preserved(self):
        # Bare flags like `?secure` (no `=value`) are kept verbatim unless
        # the flag name itself is in the strip set.
        url = "https://example.com/v?secure&ump=1"
        result = strip_query_params(url)
        assert result == "https://example.com/v?secure"


# ── safe_filename_component ────────────────────────────────────────────────


class TestSafeFilenameComponent:
    def test_replaces_path_separators(self):
        assert safe_filename_component("a/b\\c") == "a_b_c"

    def test_replaces_windows_reserved_chars(self):
        assert safe_filename_component('a:b*c?d"e<f>g|h') == "a_b_c_d_e_f_g_h"

    def test_replaces_control_chars(self):
        # \x00-\x1f are stripped (replaced with _).
        result = safe_filename_component("foo\x00bar\x1fbaz")
        assert "\x00" not in result
        assert "\x1f" not in result

    def test_strips_leading_dots(self):
        # `.foo` would create a hidden file on Unix — strip leading dots.
        assert safe_filename_component(".hidden") == "hidden"
        assert safe_filename_component("...still-leading") == "still-leading"

    def test_strips_surrounding_whitespace(self):
        assert safe_filename_component("  padded  ") == "padded"

    def test_empty_input_returns_empty_string(self):
        assert safe_filename_component("") == ""

    def test_only_invalid_chars_returns_underscores(self):
        # All chars replaced → still non-empty (caller's fallback decides
        # what to do with an all-underscore stem).
        assert safe_filename_component("///") == "___"

    def test_byte_aware_truncation_at_200_bytes_for_emoji_heavy_input(self):
        # 100 emoji × 4 UTF-8 bytes each = 400 bytes — well over the 200 B cap.
        emoji_heavy = "🎵" * 100
        result = safe_filename_component(emoji_heavy)
        assert len(result.encode("utf-8")) <= 200

    def test_truncation_does_not_split_multibyte_char(self):
        # The cut at exactly 200 bytes could fall in the middle of a 4-byte
        # emoji; errors="ignore" must drop the partial byte sequence cleanly.
        emoji_heavy = "🎵" * 100
        result = safe_filename_component(emoji_heavy)
        # If the decode left a mojibake artifact, encoding back would
        # produce non-UTF-8 bytes. Just verify it round-trips clean.
        result.encode("utf-8").decode("utf-8")  # raises if truncation was unsafe

    def test_pipe_replacement_matches_existing_convention(self):
        # Patreon link text like "Title | With Music | Soft Waves" has pipes
        # which are filename-invalid on Windows. Existing convention is
        # underscore-for-pipe (kept simple; the project's parser pipeline
        # downstream re-normalises filenames via the dictionary).
        title = "Love Goddess | With Music | Soft Waves"
        result = safe_filename_component(title)
        assert "|" not in result
        assert "_" in result


# ── filename_from_content_disposition ──────────────────────────────────────


class TestFilenameFromContentDisposition:
    def test_returns_none_for_missing_header(self):
        assert filename_from_content_disposition(None) is None
        assert filename_from_content_disposition("") is None

    def test_returns_none_for_header_without_filename(self):
        assert filename_from_content_disposition("attachment") is None

    def test_parses_plain_filename(self):
        assert filename_from_content_disposition('attachment; filename="audio.mp3"') == "audio.mp3"

    def test_parses_filename_without_quotes(self):
        assert filename_from_content_disposition("attachment; filename=audio.mp3") == "audio.mp3"

    def test_parses_rfc_5987_encoded_filename(self):
        # Drive sometimes uses filename*=UTF-8''… for non-ASCII names.
        header = "attachment; filename*=UTF-8''na%C3%AFve.mp3"
        result = filename_from_content_disposition(header)
        assert result == "naïve.mp3"

    def test_strips_unsafe_chars_from_parsed_filename(self):
        # The parser routes through safe_filename_component, so a malicious
        # Content-Disposition can't introduce path-traversal characters.
        header = 'attachment; filename="../../etc/passwd"'
        result = filename_from_content_disposition(header)
        assert ".." in result  # `.` itself is allowed, just no separators
        assert "/" not in result


# ── ext_from_content_type ──────────────────────────────────────────────────


class TestExtFromContentType:
    def test_returns_mp3_default_for_none(self):
        # Conservative fallback when the server omits Content-Type.
        assert ext_from_content_type(None) == ".mp3"
        assert ext_from_content_type("") == ".mp3"

    def test_maps_audio_mp4_to_m4a(self):
        # Drive's itag=140 audio stream comes back as audio/mp4 → .m4a.
        assert ext_from_content_type("audio/mp4") == ".m4a"

    def test_maps_audio_mpeg_to_mp3(self):
        assert ext_from_content_type("audio/mpeg") == ".mp3"

    def test_maps_audio_flac_to_flac(self):
        assert ext_from_content_type("audio/flac") == ".flac"

    def test_ignores_charset_parameter(self):
        # Real Content-Type headers often include `; charset=utf-8` etc.
        assert ext_from_content_type("audio/mp4; charset=utf-8") == ".m4a"

    def test_unknown_type_falls_back_to_mp3(self):
        # Conservative default — better to give the file a recognisable ext
        # than to leave it stem-only.
        assert ext_from_content_type("application/octet-stream") == ".mp3"


# ── unique_destination ─────────────────────────────────────────────────────


class TestUniqueDestination:
    def test_returns_target_when_no_collision(self, tmp_path: Path):
        target = tmp_path / "song.mp3"
        assert unique_destination(target) == target

    def test_appends_underscore_2_on_collision(self, tmp_path: Path):
        existing = tmp_path / "song.mp3"
        existing.write_bytes(b"")
        result = unique_destination(tmp_path / "song.mp3")
        assert result == tmp_path / "song_2.mp3"

    def test_skips_already_used_suffix_numbers(self, tmp_path: Path):
        (tmp_path / "song.mp3").write_bytes(b"")
        (tmp_path / "song_2.mp3").write_bytes(b"")
        result = unique_destination(tmp_path / "song.mp3")
        assert result == tmp_path / "song_3.mp3"

    def test_preserves_extension_across_renames(self, tmp_path: Path):
        (tmp_path / "track.flac").write_bytes(b"")
        result = unique_destination(tmp_path / "track.flac")
        assert result.suffix == ".flac"


# ── derive_filename ────────────────────────────────────────────────────────


class TestDeriveFilename:
    def test_explicit_wins_over_content_disposition(self):
        result = derive_filename(
            explicit="My Title.m4a",
            content_disposition='attachment; filename="server-name.mp3"',
            content_type="audio/mp4",
            fallback_stem="post_123",
        )
        assert result == "My Title.m4a"

    def test_content_disposition_wins_when_no_explicit(self):
        result = derive_filename(
            explicit=None,
            content_disposition='attachment; filename="server-name.mp3"',
            content_type="audio/mp4",
            fallback_stem="post_123",
        )
        assert result == "server-name.mp3"

    def test_fallback_stem_used_when_nothing_else(self):
        result = derive_filename(
            explicit=None,
            content_disposition=None,
            content_type="audio/mp4",
            fallback_stem="post_123",
        )
        # Fallback shape is `<stem>_<unix_ts><ext>`; the timestamp varies but
        # the stem and extension are deterministic.
        assert result.startswith("post_123_")
        assert result.endswith(".m4a")

    def test_extension_appended_when_explicit_has_none(self):
        result = derive_filename(
            explicit="no-extension-here",
            content_disposition=None,
            content_type="audio/flac",
            fallback_stem="post_123",
        )
        assert result == "no-extension-here.flac"

    def test_explicit_with_extension_unchanged(self):
        result = derive_filename(
            explicit="already.m4a",
            content_disposition=None,
            content_type="audio/mpeg",  # would map to .mp3 if appended
            fallback_stem="post_123",
        )
        assert result == "already.m4a"

    def test_explicit_sanitised_before_use(self):
        # Same path-traversal protection as filename_from_content_disposition.
        result = derive_filename(
            explicit="bad/name.mp3",
            content_disposition=None,
            content_type="audio/mpeg",
            fallback_stem="post_123",
        )
        assert "/" not in result

    def test_empty_explicit_falls_through(self):
        # Empty string after sanitisation triggers the next-priority source.
        result = derive_filename(
            explicit="",
            content_disposition='attachment; filename="x.mp3"',
            content_type="audio/mpeg",
            fallback_stem="post_123",
        )
        assert result == "x.mp3"


# ── flatten_dest_parts ─────────────────────────────────────────────────────


class TestFlattenDestParts:
    def test_returns_creator_and_post_folder_for_happy_path(self):
        creator, folder = flatten_dest_parts("12345", "Foo Bar", "My Post Title")
        assert creator == "Foo Bar"
        assert folder == "12345 - My Post Title"

    def test_falls_back_to_unknown_creator_when_artist_empty(self):
        creator, _ = flatten_dest_parts("12345", "", "Some Title")
        assert creator == "Unknown creator"

    def test_drops_title_suffix_when_title_empty(self):
        _, folder = flatten_dest_parts("12345", "Foo", "")
        assert folder == "12345"

    def test_substitutes_invalid_chars_rather_than_dropping_them(self):
        # safe_filename_component replaces `/\:*?"<>|` and control chars
        # with `_` rather than stripping them, so an artist of `///`
        # becomes `___` (still a valid, scoped folder name) — not empty,
        # so no "Unknown creator" fallback fires.
        creator, _ = flatten_dest_parts("12345", "///", "Some Title")
        assert creator == "___"

    def test_sanitises_slash_in_creator(self):
        creator, _ = flatten_dest_parts("12345", "Foo/Bar", "T")
        # A literal slash would let the path escape DOWNLOAD_PATH/<creator>/.
        assert "/" not in creator
        assert "\\" not in creator

    def test_sanitises_slash_in_title(self):
        _, folder = flatten_dest_parts("12345", "Foo", "Bad/Title")
        assert "/" not in folder
        assert "\\" not in folder

    def test_post_id_passes_through_unsanitised(self):
        # Caller is responsible for rejecting traversal in post_id (the
        # ingest endpoints check for '/', '\\', leading dot). The helper
        # itself is path-agnostic about the id.
        _, folder = flatten_dest_parts("12345", "Foo", "Title")
        assert folder.startswith("12345 - ")
