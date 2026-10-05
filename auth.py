"""Owner password, session cookies and login rate limiting."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
import time

from fastapi import HTTPException, Request, Response

from . import db

COOKIE = "sf_admin"
SESSION_DAYS = 30
_fails: dict[str, list[float]] = {}
_fail_lock = threading.Lock()
MAX_FAILS = 8
WINDOW = 15 * 60


def hash_pw(pw: str) -> str:
    salt = secrets.token_bytes(16)
    n, r, p = 2 ** 14, 8, 1
    h = hashlib.scrypt(pw.encode(), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${base64.b64encode(salt).decode()}${base64.b64encode(h).decode()}"


def check_pw(pw: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, h = stored.split("$")
        if algo != "scrypt":
            return False
        got = hashlib.scrypt(pw.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got, base64.b64decode(h))
    except Exception:
        return False


def setup_needed() -> bool:
    return not db.kv_get("admin_pw")


def client_ip(req: Request) -> str:
    fwd = req.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[-1].strip()
    return req.client.host if req.client else "?"


def is_https(req: Request) -> bool:
    proto = req.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return proto == "https" or req.url.scheme == "https"


def rate_check(req: Request) -> None:
    ip = client_ip(req)
    now = time.time()
    with _fail_lock:
        lst = [t for t in _fails.get(ip, []) if now - t < WINDOW]
        _fails[ip] = lst
        if len(lst) >= MAX_FAILS:
            wait = int((WINDOW - (now - lst[0])) / 60) + 1
            raise HTTPException(429, f"Too many wrong tries. Wait {wait} minutes and try again.")


def rate_fail(req: Request) -> None:
    with _fail_lock:
        _fails.setdefault(client_ip(req), []).append(time.time())


def rate_clear(req: Request) -> None:
    with _fail_lock:
        _fails.pop(client_ip(req), None)


def new_session(req: Request, resp: Response) -> str:
    tok = secrets.token_urlsafe(32)
    now = time.time()
    db.run("DELETE FROM sessions WHERE expires<?", (now,))
    db.run("INSERT INTO sessions(token,created,expires) VALUES(?,?,?)", (hashlib.sha256(tok.encode()).hexdigest(), now, now + SESSION_DAYS * 86400))
    resp.set_cookie(COOKIE, tok, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=is_https(req), path="/")
    return tok


def current_token(req: Request) -> str | None:
    tok = req.cookies.get(COOKIE)
    if not tok:
        return None
    h = hashlib.sha256(tok.encode()).hexdigest()
    row = db.q1("SELECT expires FROM sessions WHERE token=?", (h,))
    if not row or row["expires"] < time.time():
        return None
    return h


def end_session(req: Request, resp: Response) -> None:
    tok = req.cookies.get(COOKIE)
    if tok:
        db.run("DELETE FROM sessions WHERE token=?", (hashlib.sha256(tok.encode()).hexdigest(),))
    resp.delete_cookie(COOKIE, path="/")


def require_admin(req: Request) -> None:
    if setup_needed() or not current_token(req):
        raise HTTPException(401, "Please sign in.")
