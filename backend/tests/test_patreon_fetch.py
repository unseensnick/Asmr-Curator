"""Tests for backend.patreon_fetch — pure helper functions.

`fetch()` itself shells out to patreon-dl and isn't unit-tested here; the
helpers (URL parsing, anchor text extraction, sidecar discovery) are pure
and exercise the bug surfaces that recent iterations kept hitting.
"""
import json
from pathlib import Path

from backend.patreon_fetch import (
    EXTERNAL_HOST_ALLOWLIST,
    ExternalLink,
    FetchedPost,
    _anchor_text,
    _extract_external_links,
    _find_cached_creator_posts,
    _find_cached_post,
    _flatten_audio,
    _flatten_dest_parts,
    _is_allowlisted_host,
    _post_id_from_url,
    _vanity_from_url,
    _walk_prosemirror_nodes,
)


# ── _post_id_from_url ──────────────────────────────────────────────────────


class TestPostIdFromUrl:
    def test_extracts_id_from_slug_with_id_suffix(self):
        url = "https://www.patreon.com/posts/exclusive-love-155300507"
        assert _post_id_from_url(url) == "155300507"

    def test_extracts_id_from_url_with_query_string(self):
        url = "https://patreon.com/posts/some-slug-12345?source=foo"
        assert _post_id_from_url(url) == "12345"

    def test_extracts_id_from_url_with_trailing_slash(self):
        url = "https://patreon.com/posts/some-slug-99999/"
        assert _post_id_from_url(url) == "99999"

    def test_extracts_id_from_url_with_only_id(self):
        # No slug, just the numeric ID.
        url = "https://patreon.com/posts/12345"
        assert _post_id_from_url(url) == "12345"

    def test_creator_url_returns_none(self):
        # Creator URLs have no `/posts/` segment — the fast-path fallback
        # must not fire for them or it'd surface every cached post.
        assert _post_id_from_url("https://www.patreon.com/solargirlasmr") is None

    def test_returns_none_for_unparseable_input(self):
        assert _post_id_from_url("not-a-url") is None

    def test_returns_none_for_empty_string(self):
        assert _post_id_from_url("") is None

    def test_returns_none_for_non_string(self):
        # Defensive — None / non-strings shouldn't blow up.
        assert _post_id_from_url(None) is None  # type: ignore[arg-type]

    def test_handles_http_and_https_uniformly(self):
        assert _post_id_from_url("http://patreon.com/posts/x-111") == "111"
        assert _post_id_from_url("https://patreon.com/posts/x-111") == "111"

    def test_is_case_insensitive(self):
        # User might paste a URL with capitalized host.
        assert _post_id_from_url("https://PATREON.COM/posts/x-222") == "222"


# ── _anchor_text ───────────────────────────────────────────────────────────


class TestAnchorText:
    def test_returns_plain_text_unchanged(self):
        assert _anchor_text("Hello World") == "Hello World"

    def test_strips_inline_tags(self):
        assert _anchor_text("<strong>Bold</strong> text") == "Bold text"

    def test_collapses_whitespace(self):
        # Patreon HTML often has line breaks and indentation inside <a> tags.
        assert _anchor_text("Line one\n  Line two\tLine three") == "Line one Line two Line three"

    def test_handles_nested_tags(self):
        assert _anchor_text("<em><strong>Nested</strong></em>") == "Nested"

    def test_returns_empty_string_for_empty_input(self):
        assert _anchor_text("") == ""

    def test_strips_leading_trailing_whitespace(self):
        assert _anchor_text("  padded  ") == "padded"


# ── _is_allowlisted_host ───────────────────────────────────────────────────


class TestIsAllowlistedHost:
    def test_drive_google_com_is_allowlisted(self):
        assert _is_allowlisted_host("https://drive.google.com/file/d/abc/view") is True

    def test_subdomain_of_allowlisted_host_is_allowlisted(self):
        # e.g. mail.drive.google.com (hypothetical) — subdomain rule.
        assert _is_allowlisted_host("https://docs.drive.google.com/x") is True

    def test_random_host_not_allowlisted(self):
        assert _is_allowlisted_host("https://example.com/file") is False

    def test_allowlist_covers_expected_hosts(self):
        # Regression guard: changing the allowlist would silently change
        # which links surface as external links on post cards.
        assert "drive.google.com" in EXTERNAL_HOST_ALLOWLIST
        assert "mega.nz" in EXTERNAL_HOST_ALLOWLIST
        assert "mediafire.com" in EXTERNAL_HOST_ALLOWLIST
        assert "dropbox.com" in EXTERNAL_HOST_ALLOWLIST

    def test_invalid_url_returns_false(self):
        assert _is_allowlisted_host("not-a-url") is False

    def test_url_without_host_returns_false(self):
        assert _is_allowlisted_host("/relative/path") is False


# ── _extract_external_links ────────────────────────────────────────────────


class TestExtractExternalLinks:
    def test_returns_empty_for_non_dict_input(self):
        assert _extract_external_links(None) == []
        assert _extract_external_links("not a dict") == []  # type: ignore[arg-type]

    def test_returns_empty_when_no_links(self):
        attrs = {"content": "<p>Just text, no links.</p>"}
        assert _extract_external_links(attrs) == []

    def test_extracts_anchor_with_text(self):
        attrs = {
            "content": '<p><a href="https://drive.google.com/file/d/A/view">Take One</a></p>'
        }
        result = _extract_external_links(attrs)
        assert len(result) == 1
        assert result[0].url == "https://drive.google.com/file/d/A/view"
        assert result[0].text == "Take One"

    def test_extracts_multiple_anchors_distinct_text(self):
        # The Love Goddess case — 4 links on the same post, each with
        # different anchor text. Anchor text is the differentiator that
        # makes saved filenames distinct downstream.
        attrs = {
            "content": (
                '<a href="https://drive.google.com/file/d/A/view">With Music | Soft</a>'
                '<a href="https://drive.google.com/file/d/B/view">With Music | Loud</a>'
                '<a href="https://drive.google.com/file/d/C/view">No Music | Soft</a>'
            )
        }
        result = _extract_external_links(attrs)
        assert len(result) == 3
        assert [link.text for link in result] == [
            "With Music | Soft",
            "With Music | Loud",
            "No Music | Soft",
        ]

    def test_extracts_iframe_with_empty_text(self):
        attrs = {
            "content": '<iframe src="https://drive.google.com/file/d/X/preview"></iframe>'
        }
        result = _extract_external_links(attrs)
        assert len(result) == 1
        assert result[0].url == "https://drive.google.com/file/d/X/preview"
        assert result[0].text == ""

    def test_extracts_plain_text_url(self):
        attrs = {"content": "<p>Get it here: https://drive.google.com/file/d/X/view</p>"}
        result = _extract_external_links(attrs)
        assert len(result) == 1
        assert result[0].url == "https://drive.google.com/file/d/X/view"
        assert result[0].text == ""

    def test_plain_text_url_trims_trailing_punctuation(self):
        # `see https://drive.google.com/file/d/X/view.` shouldn't capture
        # the trailing period.
        attrs = {"content": "<p>see https://drive.google.com/file/d/X/view.</p>"}
        result = _extract_external_links(attrs)
        assert result[0].url == "https://drive.google.com/file/d/X/view"

    def test_extracts_embed_url(self):
        attrs = {"embed": {"url": "https://drive.google.com/file/d/X/view"}}
        result = _extract_external_links(attrs)
        assert len(result) == 1
        assert result[0].url == "https://drive.google.com/file/d/X/view"

    def test_skips_embed_provider_url(self):
        # provider_url is the host homepage (drive.google.com/), not a
        # file URL — would surface a useless row in the UI.
        attrs = {"embed": {"provider_url": "https://drive.google.com"}}
        assert _extract_external_links(attrs) == []

    def test_dedupes_by_url(self):
        # Same URL surfacing in multiple sources collapses to one entry.
        attrs = {
            "content": (
                '<a href="https://drive.google.com/file/d/X/view">My Link</a>'
                "Some text https://drive.google.com/file/d/X/view"
            )
        }
        result = _extract_external_links(attrs)
        assert len(result) == 1

    def test_filters_to_allowlisted_hosts(self):
        attrs = {
            "content": (
                '<a href="https://example.com/file">Not allowed</a>'
                '<a href="https://drive.google.com/file/d/X/view">Allowed</a>'
            )
        }
        result = _extract_external_links(attrs)
        assert len(result) == 1
        assert result[0].url == "https://drive.google.com/file/d/X/view"

    def test_extracts_from_prosemirror_json_content(self):
        # Newer Patreon editor produces ProseMirror JSON in
        # content_json_string instead of HTML in content.
        prosemirror_doc = {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {
                            "type": "text",
                            "text": "Drive Link",
                            "marks": [
                                {
                                    "type": "link",
                                    "attrs": {
                                        "href": "https://drive.google.com/file/d/Y/view"
                                    },
                                }
                            ],
                        }
                    ],
                }
            ],
        }
        attrs = {"content_json_string": json.dumps(prosemirror_doc)}
        result = _extract_external_links(attrs)
        assert len(result) == 1
        assert result[0].url == "https://drive.google.com/file/d/Y/view"
        assert result[0].text == "Drive Link"

    def test_anchor_text_preferred_over_plain_text_for_duplicate_url(self):
        # If the same URL appears as both an <a> with text and a plain-text
        # mention, the anchor's text wins (it's more meaningful).
        attrs = {
            "content": (
                '<a href="https://drive.google.com/file/d/X/view">Named Link</a>'
                " also see https://drive.google.com/file/d/X/view"
            )
        }
        result = _extract_external_links(attrs)
        assert len(result) == 1
        assert result[0].text == "Named Link"


# ── _walk_prosemirror_nodes ────────────────────────────────────────────────


class TestWalkProseMirrorNodes:
    def test_collects_link_mark_with_text(self):
        node = {
            "type": "text",
            "text": "click me",
            "marks": [{"type": "link", "attrs": {"href": "https://example.com/"}}],
        }
        sink: list[ExternalLink] = []
        _walk_prosemirror_nodes(node, sink)
        assert len(sink) == 1
        assert sink[0].url == "https://example.com/"
        assert sink[0].text == "click me"

    def test_collects_attrs_href_with_empty_text(self):
        # Image / embed nodes have href in attrs, not in a mark — no text.
        node = {"type": "image", "attrs": {"src": "https://example.com/img.png"}}
        sink: list[ExternalLink] = []
        _walk_prosemirror_nodes(node, sink)
        assert len(sink) == 1
        assert sink[0].url == "https://example.com/img.png"
        assert sink[0].text == ""

    def test_recurses_into_content_children(self):
        node = {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {
                            "type": "text",
                            "text": "inner",
                            "marks": [{"type": "link", "attrs": {"href": "https://x.com/"}}],
                        }
                    ],
                }
            ],
        }
        sink: list[ExternalLink] = []
        _walk_prosemirror_nodes(node, sink)
        assert len(sink) == 1
        assert sink[0].url == "https://x.com/"

    def test_ignores_non_dict_nodes(self):
        sink: list[ExternalLink] = []
        _walk_prosemirror_nodes("not a dict", sink)  # type: ignore[arg-type]
        _walk_prosemirror_nodes(None, sink)  # type: ignore[arg-type]
        assert sink == []


# ── _find_cached_post ──────────────────────────────────────────────────────


def _write_sidecar(post_dir: Path, post_id: str, title: str = "Test", artist: str = "Artist"):
    """Helper: create a patreon-dl-shaped post_info/post-api.json sidecar."""
    info_dir = post_dir / "post_info"
    info_dir.mkdir(parents=True, exist_ok=True)
    sidecar = {
        "data": {
            "id": post_id,
            "attributes": {"title": title, "content": ""},
            "relationships": {"user": {"data": {"id": "u1"}}},
        },
        "included": [{"type": "user", "id": "u1", "attributes": {"full_name": artist}}],
    }
    (info_dir / "post-api.json").write_text(json.dumps(sidecar), encoding="utf-8")


class TestFindCachedPost:
    def test_returns_none_when_no_sidecars(self, tmp_path: Path):
        assert _find_cached_post(tmp_path, "12345") is None

    def test_finds_sidecar_by_post_id(self, tmp_path: Path):
        output_dir = tmp_path / ".patreon-dl"
        post_dir = output_dir / "Patreon" / "creator" / "posts" / "12345"
        _write_sidecar(post_dir, "12345", title="Cached Post", artist="Solar Girl")

        found = _find_cached_post(output_dir, "12345")
        assert found is not None
        assert found.post_id == "12345"
        assert found.title == "Cached Post"
        assert found.artist == "Solar Girl"

    def test_returns_none_for_unmatched_post_id(self, tmp_path: Path):
        output_dir = tmp_path / ".patreon-dl"
        post_dir = output_dir / "Patreon" / "creator" / "posts" / "12345"
        _write_sidecar(post_dir, "12345")

        assert _find_cached_post(output_dir, "99999") is None

    def test_finds_audio_in_flattened_download_path(self, tmp_path: Path):
        # _flatten_audio moves audio from patreon-dl's tree into
        # <DOWNLOAD_PATH>/<creator>/<post_id> - <title>/ on a previous
        # fetch. The cached-post lookup must find audio there, not just
        # under the post_info dir. tmp_path plays the DOWNLOAD_PATH role
        # here (the production caller passes DOWNLOAD_PATH / ".patreon-dl"
        # as `output_dir`).
        output_dir = tmp_path / ".patreon-dl"
        post_dir = output_dir / "Patreon" / "creator" / "posts" / "12345"
        _write_sidecar(post_dir, "12345", title="Cached Post", artist="Solar Girl")

        # Simulate the current flatten layout at
        # <DOWNLOAD_PATH>/<creator>/<post_id> - <title>/song.mp3.
        flat_dir = tmp_path / "Solar Girl" / "12345 - Cached Post"
        flat_dir.mkdir(parents=True)
        audio_file = flat_dir / "song.mp3"
        audio_file.write_bytes(b"fake audio")

        found = _find_cached_post(output_dir, "12345")
        assert found is not None
        assert found.audio_path == str(audio_file)

    def test_finds_audio_in_legacy_flat_layout(self, tmp_path: Path):
        # Back-compat: posts downloaded before the layout change live at
        # the old flat <DOWNLOAD_PATH>/<post_id>/<file> location. The
        # cached-sidecar fast path falls back to the legacy layout after
        # checking the new one, so re-fetches still resolve them.
        output_dir = tmp_path / ".patreon-dl"
        post_dir = output_dir / "Patreon" / "creator" / "posts" / "12345"
        _write_sidecar(post_dir, "12345", title="Old Post", artist="Solar Girl")

        legacy_dir = tmp_path / "12345"
        legacy_dir.mkdir()
        audio_file = legacy_dir / "song.mp3"
        audio_file.write_bytes(b"fake audio")

        found = _find_cached_post(output_dir, "12345")
        assert found is not None
        assert found.audio_path == str(audio_file)

    def test_audio_path_none_when_no_audio_anywhere(self, tmp_path: Path):
        output_dir = tmp_path / ".patreon-dl"
        post_dir = output_dir / "Patreon" / "creator" / "posts" / "12345"
        _write_sidecar(post_dir, "12345")
        found = _find_cached_post(output_dir, "12345")
        assert found is not None
        assert found.audio_path is None

    def test_skips_corrupt_sidecar(self, tmp_path: Path):
        # A malformed JSON file shouldn't crash the walk — just skip it.
        output_dir = tmp_path / ".patreon-dl"
        bad_dir = output_dir / "Patreon" / "creator" / "posts" / "bad" / "post_info"
        bad_dir.mkdir(parents=True)
        (bad_dir / "post-api.json").write_text("{not json", encoding="utf-8")

        # No matching sidecar → None, not an exception.
        assert _find_cached_post(output_dir, "12345") is None


# ── _flatten_audio ─────────────────────────────────────────────────────────


def _build_patreon_dl_audio(patreon_root: Path, post_id: str, filename: str) -> Path:
    """Helper: lay down a patreon-dl-shaped audio file and return its path."""
    audio_dir = patreon_root / "Patreon" / "creator" / "posts" / post_id / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    audio_path = audio_dir / filename
    audio_path.write_bytes(b"fake audio")
    return audio_path


class TestFlattenAudio:
    def test_uses_creator_postid_title_layout(self, tmp_path: Path):
        # tmp_path plays the DOWNLOAD_PATH role; patreon_root is
        # DOWNLOAD_PATH/.patreon-dl.
        patreon_root = tmp_path / ".patreon-dl"
        audio_path = _build_patreon_dl_audio(patreon_root, "12345", "song.mp3")
        post = FetchedPost(
            post_id="12345",
            title="Cached Post",
            tags=[],
            artist="Solar Girl",
            post_dir=str(audio_path.parent.parent),
            audio_path=str(audio_path),
        )

        _flatten_audio([post], patreon_root)

        expected = tmp_path / "Solar Girl" / "12345 - Cached Post" / "song.mp3"
        assert expected.is_file()
        assert post.audio_path == str(expected)

    def test_sanitises_creator_and_title(self, tmp_path: Path):
        # Slashes in creator or title would escape the destination; control
        # chars and Windows-illegal characters need substitution too.
        patreon_root = tmp_path / ".patreon-dl"
        audio_path = _build_patreon_dl_audio(patreon_root, "67890", "song.mp3")
        post = FetchedPost(
            post_id="67890",
            title="Has: Bad?Chars*",
            tags=[],
            artist="John / Jane",
            post_dir=str(audio_path.parent.parent),
            audio_path=str(audio_path),
        )

        _flatten_audio([post], patreon_root)

        # safe_filename_component substitutes `/\:*?"<>|` and control chars
        # with `_`. The post-id stays raw (it's already alphanumeric).
        expected_creator, expected_folder = _flatten_dest_parts(
            "67890", "John / Jane", "Has: Bad?Chars*"
        )
        # Sanity-check the dest_parts helper produced safe segments.
        assert "/" not in expected_creator
        assert "/" not in expected_folder
        assert ":" not in expected_folder

        expected_path = tmp_path / expected_creator / expected_folder / "song.mp3"
        assert expected_path.is_file()
        assert post.audio_path == str(expected_path)

    def test_falls_back_to_unknown_creator_when_artist_empty(self, tmp_path: Path):
        patreon_root = tmp_path / ".patreon-dl"
        audio_path = _build_patreon_dl_audio(patreon_root, "11111", "song.mp3")
        post = FetchedPost(
            post_id="11111",
            title="Has Title",
            tags=[],
            artist="",
            post_dir=str(audio_path.parent.parent),
            audio_path=str(audio_path),
        )

        _flatten_audio([post], patreon_root)

        expected = tmp_path / "Unknown creator" / "11111 - Has Title" / "song.mp3"
        assert expected.is_file()

    def test_drops_title_suffix_when_title_empty(self, tmp_path: Path):
        # Empty title → folder is just <post_id>, no trailing ` - `.
        patreon_root = tmp_path / ".patreon-dl"
        audio_path = _build_patreon_dl_audio(patreon_root, "22222", "song.mp3")
        post = FetchedPost(
            post_id="22222",
            title="",
            tags=[],
            artist="Solar Girl",
            post_dir=str(audio_path.parent.parent),
            audio_path=str(audio_path),
        )

        _flatten_audio([post], patreon_root)

        expected = tmp_path / "Solar Girl" / "22222" / "song.mp3"
        assert expected.is_file()


# ── _vanity_from_url ───────────────────────────────────────────────────────


class TestVanityFromUrl:
    def test_extracts_vanity_from_c_path(self):
        url = "https://www.patreon.com/c/solargirlasmr/posts?vanity=solargirlasmr"
        assert _vanity_from_url(url) == "solargirlasmr"

    def test_extracts_vanity_from_legacy_short_path(self):
        assert _vanity_from_url("https://www.patreon.com/solargirlasmr") == "solargirlasmr"

    def test_returns_none_for_single_post_url(self):
        url = "https://www.patreon.com/posts/exclusive-love-155300507"
        assert _vanity_from_url(url) is None

    def test_returns_none_for_reserved_paths(self):
        assert _vanity_from_url("https://www.patreon.com/home") is None
        assert _vanity_from_url("https://www.patreon.com/search") is None

    def test_returns_none_for_empty_or_non_string(self):
        assert _vanity_from_url("") is None
        assert _vanity_from_url(None) is None  # type: ignore[arg-type]


# ── _find_cached_creator_posts ─────────────────────────────────────────────


def _write_creator_sidecar(
    post_dir: Path,
    post_id: str,
    *,
    title: str = "Test",
    vanity: str = "solargirlasmr",
    published_at: str = "",
    campaign_id: str = "c1",
):
    """Helper: create a sidecar that carries campaign vanity + published_at,
    in addition to the user/artist relationship `_write_sidecar` covers."""
    info_dir = post_dir / "post_info"
    info_dir.mkdir(parents=True, exist_ok=True)
    sidecar = {
        "data": {
            "id": post_id,
            "attributes": {"title": title, "content": "", "published_at": published_at},
            "relationships": {
                "user": {"data": {"id": "u1"}},
                "campaign": {"data": {"id": campaign_id}},
            },
        },
        "included": [
            {"type": "user", "id": "u1", "attributes": {"full_name": "Solar Girl"}},
            {"type": "campaign", "id": campaign_id, "attributes": {"vanity": vanity}},
        ],
    }
    (info_dir / "post-api.json").write_text(json.dumps(sidecar), encoding="utf-8")


class TestFindCachedCreatorPosts:
    def test_returns_empty_when_nothing_cached(self, tmp_path: Path):
        assert _find_cached_creator_posts(tmp_path, "solargirlasmr", None, None) == []

    def test_returns_all_posts_for_creator(self, tmp_path: Path):
        output_dir = tmp_path / ".patreon-dl"
        for pid in ("100", "200", "300"):
            _write_creator_sidecar(
                output_dir / "Patreon" / "creator" / "posts" / pid,
                pid,
                published_at=f"2025-11-{int(pid) // 100:02d}T00:00:00.000+00:00",
            )

        found = _find_cached_creator_posts(output_dir, "solargirlasmr", None, None)
        assert {p.post_id for p in found} == {"100", "200", "300"}

    def test_filters_out_other_creators(self, tmp_path: Path):
        output_dir = tmp_path / ".patreon-dl"
        _write_creator_sidecar(
            output_dir / "Patreon" / "solar" / "posts" / "100",
            "100",
            vanity="solargirlasmr",
            campaign_id="c-solar",
        )
        _write_creator_sidecar(
            output_dir / "Patreon" / "other" / "posts" / "200",
            "200",
            vanity="someoneelse",
            campaign_id="c-other",
        )

        found = _find_cached_creator_posts(output_dir, "solargirlasmr", None, None)
        assert [p.post_id for p in found] == ["100"]

    def test_published_after_filter_excludes_earlier_posts(self, tmp_path: Path):
        output_dir = tmp_path / ".patreon-dl"
        _write_creator_sidecar(
            output_dir / "Patreon" / "creator" / "posts" / "100",
            "100",
            published_at="2025-09-01T00:00:00.000+00:00",
        )
        _write_creator_sidecar(
            output_dir / "Patreon" / "creator" / "posts" / "200",
            "200",
            published_at="2025-11-01T00:00:00.000+00:00",
        )

        found = _find_cached_creator_posts(
            output_dir, "solargirlasmr", "2025-10-01", None,
        )
        assert [p.post_id for p in found] == ["200"]

    def test_published_before_filter_excludes_later_posts(self, tmp_path: Path):
        output_dir = tmp_path / ".patreon-dl"
        _write_creator_sidecar(
            output_dir / "Patreon" / "creator" / "posts" / "100",
            "100",
            published_at="2025-09-01T00:00:00.000+00:00",
        )
        _write_creator_sidecar(
            output_dir / "Patreon" / "creator" / "posts" / "200",
            "200",
            published_at="2025-11-01T00:00:00.000+00:00",
        )

        found = _find_cached_creator_posts(
            output_dir, "solargirlasmr", None, "2025-10-01",
        )
        assert [p.post_id for p in found] == ["100"]

    def test_results_ordered_newest_first(self, tmp_path: Path):
        output_dir = tmp_path / ".patreon-dl"
        _write_creator_sidecar(
            output_dir / "Patreon" / "creator" / "posts" / "100",
            "100",
            published_at="2025-09-01T00:00:00.000+00:00",
        )
        _write_creator_sidecar(
            output_dir / "Patreon" / "creator" / "posts" / "200",
            "200",
            published_at="2025-11-01T00:00:00.000+00:00",
        )
        _write_creator_sidecar(
            output_dir / "Patreon" / "creator" / "posts" / "300",
            "300",
            published_at="2025-10-01T00:00:00.000+00:00",
        )

        found = _find_cached_creator_posts(output_dir, "solargirlasmr", None, None)
        assert [p.post_id for p in found] == ["200", "300", "100"]

    def test_skips_corrupt_sidecar(self, tmp_path: Path):
        output_dir = tmp_path / ".patreon-dl"
        _write_creator_sidecar(
            output_dir / "Patreon" / "creator" / "posts" / "100", "100",
        )
        bad_dir = output_dir / "Patreon" / "creator" / "posts" / "bad" / "post_info"
        bad_dir.mkdir(parents=True)
        (bad_dir / "post-api.json").write_text("{not json", encoding="utf-8")

        found = _find_cached_creator_posts(output_dir, "solargirlasmr", None, None)
        assert [p.post_id for p in found] == ["100"]

    def test_slugified_artist_fallback_when_campaign_missing(self, tmp_path: Path):
        # Some patreon-dl payloads omit the campaign object from `included`
        # entirely. The fallback slugifies the artist's full_name
        # ("Solar Girl ASMR" → "solargirlasmr") and matches that against
        # the URL vanity.
        output_dir = tmp_path / ".patreon-dl"
        info_dir = output_dir / "Patreon" / "solar" / "posts" / "100" / "post_info"
        info_dir.mkdir(parents=True)
        sidecar_no_campaign = {
            "data": {
                "id": "100",
                "attributes": {"title": "Cached", "published_at": ""},
                "relationships": {"user": {"data": {"id": "u1"}}},
            },
            "included": [
                {"type": "user", "id": "u1", "attributes": {"full_name": "Solar Girl ASMR"}},
            ],
        }
        (info_dir / "post-api.json").write_text(json.dumps(sidecar_no_campaign), encoding="utf-8")

        found = _find_cached_creator_posts(output_dir, "solargirlasmr", None, None)
        assert [p.post_id for p in found] == ["100"]
