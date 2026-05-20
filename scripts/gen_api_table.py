"""Generate the "Endpoint summary" markdown table for README.md.

Walks the FastAPI app's registered routes and prints a single markdown
table grouped by source module (`backend/routes/<module>.py`). The table
is the source-of-truth check — if a new endpoint lands without a README
entry below, the regenerated table will show it.

Usage (from repo root, inside the devcontainer):

    backend/.venv/bin/python scripts/gen_api_table.py

Then paste the output between the BEGIN/END auto-gen markers in
README.md's "## API Reference" section.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from fastapi.routing import APIRoute  # noqa: E402

from backend.main import app  # noqa: E402

SKIP_PATHS = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc", "/"}


def main() -> None:
    rows: dict[str, list[tuple[str, str]]] = defaultdict(list)

    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        if route.path in SKIP_PATHS:
            continue

        module = route.endpoint.__module__
        source = module.removeprefix("backend.").replace(".", "/") + ".py"

        for method in sorted(route.methods or set()):
            if method in {"HEAD", "OPTIONS"}:
                continue
            rows[source].append((method, route.path))

    print("| Method | Path | Source |")
    print("| ------ | ---- | ------ |")
    for source in sorted(rows):
        for method, path in sorted(rows[source], key=lambda r: (r[1], r[0])):
            print(f"| {method:<6} | `{path}` | `{source}` |")


if __name__ == "__main__":
    main()
