"""Patreon + Google session-cookie storage (backed by the SQLite settings table).

The browser extension is the only client that writes cookies. The Drive-link
ingest endpoint (`routes/patreon.py`) reads the stored Google cookie via the
same DB key when it kicks off a scrape.
"""
import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from backend import database, drive_fetch
from backend.main import GOOGLE_COOKIE_KEY, PATREON_COOKIE_KEY

router = APIRouter()


# Playwright accepts only these three sameSite values. Browser cookie APIs use
# different vocabularies — Chrome ("no_restriction"|"lax"|"strict"|"unspecified")
# and Firefox ("no_restriction"|"lax"|"strict"). Normalise here so the
# extension can dump cookies in whatever shape its host browser produces.
_SAMESITE_NORMALISE = {
    "no_restriction": "None",
    "none":           "None",
    "lax":            "Lax",
    "strict":         "Strict",
    "unspecified":    "Lax",
}


def _normalise_cookie_for_playwright(raw: dict) -> Optional[dict]:
    """Reshape one chrome.cookies.getAll() entry into Playwright's add_cookies
    shape. Returns None when minimum fields (name/value/domain) are missing.
    """
    if not isinstance(raw, dict):
        return None
    name = raw.get("name")
    value = raw.get("value")
    domain = raw.get("domain")
    if not (isinstance(name, str) and isinstance(value, str) and isinstance(domain, str)):
        return None
    out: dict = {"name": name, "value": value, "domain": domain, "path": raw.get("path") or "/"}
    if raw.get("httpOnly") is True:
        out["httpOnly"] = True
    if raw.get("secure") is True:
        out["secure"] = True
    same_site = raw.get("sameSite")
    if isinstance(same_site, str):
        normalised = _SAMESITE_NORMALISE.get(same_site.lower())
        if normalised:
            out["sameSite"] = normalised
    # `expirationDate` is Chrome's name; Firefox uses `expires`. Both come
    # through as a float epoch in seconds. Session cookies omit it entirely.
    expires = raw.get("expirationDate", raw.get("expires"))
    if isinstance(expires, (int, float)) and expires > 0:
        out["expires"] = float(expires)
    return out


@router.get("/api/settings/patreon-cookie")
def get_patreon_cookie():
    value = database.get_setting(PATREON_COOKIE_KEY) or ""
    return {"set": bool(value), "length": len(value)}


@router.put("/api/settings/patreon-cookie")
async def set_patreon_cookie(request: Request):
    """Accepts the cookie as either `application/json {"cookie": "..."}` or as
    a raw text/plain body. The text/plain path lets `curl --data-binary @cookie.txt`
    work without JSON-escaping embedded quotes in `g_state={...}` etc."""
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()

    if content_type == "application/json":
        try:
            data = await request.json()
        except ValueError:
            raise HTTPException(400, "Invalid JSON body")
        if not isinstance(data, dict):
            raise HTTPException(400, "JSON body must be an object")
        cookie = str(data.get("cookie") or "").strip()
    else:
        cookie = (await request.body()).decode("utf-8", errors="replace").strip()

    if not cookie:
        database.delete_setting(PATREON_COOKIE_KEY)
        return {"set": False, "length": 0}
    database.set_setting(PATREON_COOKIE_KEY, cookie)
    return {"set": True, "length": len(cookie)}


@router.get("/api/settings/google-cookie")
def get_google_cookie():
    """Returns count + total byte size — never the values (long-lived auth tokens)."""
    value = database.get_setting(GOOGLE_COOKIE_KEY) or ""
    if not value:
        return {"set": False, "count": 0, "length": 0}
    try:
        parsed = json.loads(value)
        count = len(parsed) if isinstance(parsed, list) else 0
    except (ValueError, json.JSONDecodeError):
        count = 0
    return {"set": True, "count": count, "length": len(value)}


@router.put("/api/settings/google-cookie")
async def set_google_cookie(request: Request):
    """Body: `{"cookies": [...]}` of chrome.cookies.getAll-style entries. Entries
    missing required fields are silently dropped; an empty array clears the
    setting. Always invalidates the shared Playwright context so the next
    scrape picks up the freshly-synced (or cleared) cookies."""
    try:
        data = await request.json()
    except ValueError:
        raise HTTPException(400, "Invalid JSON body")
    if not isinstance(data, dict):
        raise HTTPException(400, "JSON body must be an object")
    cookies = data.get("cookies")
    if not isinstance(cookies, list):
        raise HTTPException(400, "`cookies` must be an array")

    cleaned: list[dict] = []
    for entry in cookies:
        normalised = _normalise_cookie_for_playwright(entry)
        if normalised is not None:
            cleaned.append(normalised)

    if not cleaned:
        database.delete_setting(GOOGLE_COOKIE_KEY)
        drive_fetch.invalidate_shared_context()
        return {"set": False, "count": 0, "length": 0}

    serialised = json.dumps(cleaned, separators=(",", ":"))
    database.set_setting(GOOGLE_COOKIE_KEY, serialised)
    drive_fetch.invalidate_shared_context()
    return {"set": True, "count": len(cleaned), "length": len(serialised)}
