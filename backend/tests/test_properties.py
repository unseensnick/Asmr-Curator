"""Property-based tests (Hypothesis) for the pure helpers where one
property catches a category of bugs example-based tests would miss.

Targets (ordered by catch-value, per the chore/repo-hygiene plan):
1. `validate_under_root` — security boundary for every file API. The
   property is: *for any input that doesn't raise, the resolved path
   satisfies `is_relative_to(root)`*. If raising counted as a failure
   Hypothesis would surface every traversal attempt we correctly
   reject, drowning the signal — phrase it `if not raises: assert
   under_root`.
2. `safe_filename_component` + `flatten_dest_parts` — filename
   sanitisation invariants. Output never contains the forbidden
   characters; UTF-8 byte length never exceeds the cap; empty artist
   collapses to "Unknown creator".
4. `strip_query_params` — idempotent and never lengthens the query.
6. `_post_id_from_url` / `_vanity_from_url` — non-Patreon URL → None;
   captured post ID is digits-only.

(Targets 3 and 5 live frontend-side under fast-check.)
"""

from __future__ import annotations

import string
from pathlib import Path

import pytest
from fastapi import HTTPException
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from backend.audio_utils import (
    STRIP_QUERY_PARAMS,
    flatten_dest_parts,
    safe_filename_component,
    strip_query_params,
)
from backend.main import validate_under_root
from backend.patreon_fetch import _post_id_from_url, _vanity_from_url

# Filenames in audio_utils cap UTF-8 byte length below the 255-byte
# filesystem limit. Mirror the private constant here; if the prod value
# changes the test fails until the constant is re-imported intentionally.
_FILENAME_MAX_BYTES = 200


# ── 1. validate_under_root ──────────────────────────────────────────────────


# Mix of adversarial traversal payloads, ordinary paths, Unicode escape
# attempts, encoded separators, and empty-ish input. Hypothesis explores
# the boundary far harder than a hand-written table ever could.
_PATH_STRATEGY = st.one_of(
    st.text(min_size=0, max_size=200),
    # Bias toward the known-dangerous shapes so shrinking lands on a
    # meaningful counter-example, not an unhelpful 200-char random blob.
    st.sampled_from(
        [
            "..",
            "../..",
            "../../etc/passwd",
            "./../",
            "....//",
            "..\\..\\",
            "‥",  # two-dot leader, looks like ".." to humans
            "…",  # ellipsis
            "//absolute",
            "/etc/passwd",
            "\x00",
            "",
            " ",
            "foo/../bar",
            "foo/./bar",
            "valid/path/name.mp3",
            "深い/階層/ファイル.flac",
        ]
    ),
)


@given(_PATH_STRATEGY)
@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_validate_under_root_never_escapes(tmp_path: Path, rel: str) -> None:
    """For any input that doesn't raise, the resolved path stays under root.

    Phrased as `if not raises: assert under_root` because legitimate
    rejections aren't bugs — only an *accepted* path that escapes is.
    """
    try:
        resolved = validate_under_root(rel, tmp_path)
    except HTTPException:
        return  # rejection is fine
    assert resolved.is_relative_to(tmp_path.resolve())


# ── 2. safe_filename_component + flatten_dest_parts ─────────────────────────


_FORBIDDEN_CHARS = set('\\/:*?"<>|') | {chr(c) for c in range(0x00, 0x20)}


@given(st.text(min_size=0, max_size=400))
def test_safe_filename_component_strips_forbidden_chars(raw: str) -> None:
    """Output contains none of the filesystem-hostile characters."""
    cleaned = safe_filename_component(raw)
    assert not (set(cleaned) & _FORBIDDEN_CHARS), (
        f"forbidden char survived sanitisation: {cleaned!r}"
    )


@given(st.text(min_size=0, max_size=400))
def test_safe_filename_component_caps_utf8_bytes(raw: str) -> None:
    """Output's UTF-8 byte length never exceeds the cap."""
    cleaned = safe_filename_component(raw)
    assert len(cleaned.encode("utf-8")) <= _FILENAME_MAX_BYTES


@given(st.text(min_size=0, max_size=400))
def test_safe_filename_component_never_starts_with_dot(raw: str) -> None:
    """Output never begins with `.` — dotfiles are hidden by the browser
    and surprise users."""
    cleaned = safe_filename_component(raw)
    if cleaned:
        assert not cleaned.startswith(".")


# A non-empty post_id strategy that itself can't contain path separators;
# `flatten_dest_parts` passes post_id through verbatim so the caller is
# responsible for its shape.
_POST_ID_STRATEGY = st.text(alphabet=string.digits, min_size=1, max_size=10)


@given(_POST_ID_STRATEGY)
def test_flatten_dest_parts_empty_artist_falls_back(post_id: str) -> None:
    """Empty artist always collapses to "Unknown creator"."""
    creator, _ = flatten_dest_parts(post_id, "", "")
    assert creator == "Unknown creator"


@given(_POST_ID_STRATEGY, st.text(max_size=80), st.text(max_size=80))
def test_flatten_dest_parts_creator_is_safe(
    post_id: str, artist: str, title: str
) -> None:
    """The creator segment is always free of the forbidden chars even
    when the raw artist string is full of them."""
    creator, folder = flatten_dest_parts(post_id, artist, title)
    assert not (set(creator) & _FORBIDDEN_CHARS)
    assert not (set(folder) & _FORBIDDEN_CHARS)


@given(_POST_ID_STRATEGY, st.text(max_size=80))
def test_flatten_dest_parts_empty_title_drops_suffix(post_id: str, artist: str) -> None:
    """Empty title means the folder is exactly `post_id` (no trailing dash)."""
    _, folder = flatten_dest_parts(post_id, artist, "")
    assert folder == post_id


# ── 4. strip_query_params ───────────────────────────────────────────────────


_URL_STRATEGY = st.one_of(
    st.sampled_from(
        [
            "https://example.com/path",
            "https://example.com/path?foo=bar",
            "https://example.com/path?ump=1&range=2&srfvp=3",
            "https://example.com/path?foo=bar&ump=x&keep=this",
            "https://example.com/path?mime=audio/mp4&itag=140",
            "https://googlevideo.com/videoplayback?ump=1&itag=140&range=0-100",
            "https://example.com",
        ]
    ),
    # Random-ish URLs to stress the parser
    st.builds(
        lambda host, path, query: f"https://{host}/{path}?{query}",
        st.text(alphabet=string.ascii_lowercase, min_size=1, max_size=20),
        st.text(alphabet=string.ascii_lowercase + "/", min_size=0, max_size=30),
        st.text(alphabet=string.ascii_lowercase + "=&", min_size=0, max_size=60),
    ),
)


@given(_URL_STRATEGY)
def test_strip_query_params_is_idempotent(url: str) -> None:
    """Stripping the same params twice equals stripping once — protects
    against accidental re-encoding regressions."""
    once = strip_query_params(url)
    twice = strip_query_params(once)
    assert once == twice


@given(_URL_STRATEGY)
def test_strip_query_params_never_lengthens(url: str) -> None:
    """The output URL is never longer than the input (since stripping
    only removes characters)."""
    assert len(strip_query_params(url)) <= len(url)


@given(_URL_STRATEGY)
def test_strip_query_params_removes_named_params(url: str) -> None:
    """None of the configured strip-params appear as a key in the
    stripped URL's query string."""
    stripped = strip_query_params(url)
    if "?" not in stripped:
        return
    query = stripped.split("?", 1)[1]
    for segment in query.split("&"):
        key = segment.split("=", 1)[0] if "=" in segment else segment
        assert key not in STRIP_QUERY_PARAMS, (
            f"strip-param {key!r} survived in {stripped!r}"
        )


# ── 6. _post_id_from_url / _vanity_from_url ─────────────────────────────────


_NON_PATREON_URL_STRATEGY = st.one_of(
    st.sampled_from(
        [
            "",
            "not a url",
            "https://example.com/posts/foo-12345",
            "https://patreon.com.evil.com/posts/foo-12345",
            "ftp://patreon.com/c/somevanity",
            "https://www.google.com/",
            "patreon.com",  # no scheme — still not a valid post URL shape
        ]
    ),
    st.text(min_size=0, max_size=80).filter(lambda s: "patreon.com" not in s),
)


@given(_NON_PATREON_URL_STRATEGY)
def test_post_id_from_url_returns_none_for_non_patreon(url: str) -> None:
    """Non-Patreon URLs (including `None`-shaped inputs and lookalikes)
    never produce a post id — would otherwise leak the metadata fast
    path to URLs we can't trust."""
    assert _post_id_from_url(url) is None


@given(st.integers(min_value=1, max_value=10**18))
def test_post_id_from_url_extracts_digits_only(post_id: int) -> None:
    """For a valid single-post URL, the captured ID is always digits."""
    url = f"https://www.patreon.com/posts/some-slug-here-{post_id}"
    extracted = _post_id_from_url(url)
    assert extracted is not None
    assert extracted.isdigit()
    assert extracted == str(post_id)


# Non-string types should never crash the parsers (they guard with
# isinstance) — Hypothesis throws None, ints, lists at them.
@pytest.mark.parametrize("bad", [None, 12345, [], {}, b"https://patreon.com"])
def test_url_parsers_tolerate_non_string(bad: object) -> None:
    assert _post_id_from_url(bad) is None  # type: ignore[arg-type]
    assert _vanity_from_url(bad) is None  # type: ignore[arg-type]
