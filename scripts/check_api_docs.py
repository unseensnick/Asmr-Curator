"""Fail when any backend route is missing from the README's API Reference.

Walks `backend.main:app`'s registered routes and grep-checks README.md for a
line that mentions both the HTTP method and the route path. The detailed
manual tables under `## API Reference` are the source-of-truth — any new
route the developer adds without a corresponding README row makes this
script exit non-zero.

Usage (from repo root, inside the devcontainer):

    backend/.venv/bin/python scripts/check_api_docs.py

CI runs the same invocation in `.github/workflows/build_check.yml`. Run it
locally before pushing so a release attempt isn't the first time a missing
row trips you up.

Matching is loose by design: path parameter names can differ between code
(`/api/vocabulary/{entry_id}`) and README (`/api/vocabulary/{id}`).
Curl examples and inline mentions don't count — the line has to contain
both the METHOD and the backtick-wrapped path.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.main import app  # noqa: E402

SKIP_PATHS = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc", "/"}
SKIP_METHODS = {"HEAD", "OPTIONS"}

README = REPO_ROOT / "README.md"


def _path_to_regex(path: str) -> re.Pattern[str]:
    """Build a regex that matches the path with loose path-param names.

    `/api/vocabulary/{entry_id}` should match a README mention written as
    `/api/vocabulary/{id}` or `/api/vocabulary/{anything}`. The path
    segments outside the `{...}` brackets are matched literally.
    """
    escaped = re.escape(path)
    # re.escape turns `{x}` into `\{x\}`; replace any such segment with a
    # wildcard that won't cross path separators.
    loose = re.sub(r"\\\{[^}]+\\\}", r"\\{[^/}`]+\\}", escaped)
    return re.compile(loose)


def _registered_routes() -> list[tuple[str, str]]:
    """Return `(METHOD, path)` for every documented route, via the OpenAPI schema.

    Deliberately not a walk over `app.routes`: FastAPI 0.140 stopped
    flattening `include_router`'s routes into that list, leaving an
    `_IncludedRouter` wrapper (no `.routes`, just `original_router`) in their
    place. The previous `isinstance(route, APIRoute)` pass silently dropped
    from 38 routes to 0 and reported success. `app.openapi()` is the public
    contract, already carries fully-resolved paths including any router
    prefix, and doesn't move with FastAPI's internals.
    """
    schema = app.openapi()
    found: list[tuple[str, str]] = []
    for path, operations in schema.get("paths", {}).items():
        if path in SKIP_PATHS:
            continue
        for method in sorted(operations):
            upper = method.upper()
            if upper in SKIP_METHODS:
                continue
            found.append((upper, path))
    return found


def _is_documented(method: str, path: str, readme_text: str) -> bool:
    path_re = _path_to_regex(path)
    method_re = re.compile(rf"\b{re.escape(method)}\b")
    for line in readme_text.splitlines():
        if method_re.search(line) and re.search(rf"`{path_re.pattern}`", line):
            return True
    return False


def main() -> int:
    if not README.exists():
        print(f"README.md not found at {README}", file=sys.stderr)
        return 2

    readme_text = README.read_text(encoding="utf-8")

    routes = _registered_routes()

    # A silent zero means the route walk broke against a new FastAPI layout,
    # not that the app has no routes. Fail loudly rather than green-lighting
    # a check that verified nothing.
    if not routes:
        print(
            "No API routes discovered — the route walk is broken (FastAPI "
            "layout change?). Refusing to report success.",
            file=sys.stderr,
        )
        return 2

    missing = [(m, p) for m, p in routes if not _is_documented(m, p, readme_text)]

    if missing:
        print(
            "API docs drift detected — the following routes have no matching "
            "line in README.md's `## API Reference`:",
            file=sys.stderr,
        )
        for method, path in missing:
            print(f"  {method:<6} {path}", file=sys.stderr)
        print(
            "\nAdd a row under the appropriate `### <Group>` table in README.md, "
            "then re-run this script.",
            file=sys.stderr,
        )
        return 1

    print(f"All {len(routes)} routes documented.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
