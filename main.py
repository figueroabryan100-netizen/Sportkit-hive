"""SQUADFORGE / SPORTKIT.hive server: storefront in static/, public shop API and the owner admin API.

All state lives under DATA_DIR (default /data): SQLite at DATA_DIR/app.db and uploads at DATA_DIR/uploads.
"""
from __future__ import annotations

import asyncio
import json
import re
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend import agents, db, shop
from backend.admin import router as admin_router

ROOT = Path(__file__).resolve().parent
STATIC = (ROOT / "static").resolve()

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(admin_router)


# ------------------------------------------------------------------ lifecycle

@app.on_event("startup")
async def startup() -> None:
    db.init()
    asyncio.get_running_loop().create_task(_background())


async def _background() -> None:
    """Housekeeping and the self running helpers (autopilot, design lab, scouts) every few hours."""
    await asyncio.sleep(30)
    while True:
        try:
            await asyncio.to_thread(agents.scheduled)
        except Exception as e:  # never let the loop die
            print("background job failed:", repr(e), flush=True)
        await asyncio.sleep(15 * 60)


# ------------------------------------------------------------------ errors and headers

@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else "Something went wrong."
    return JSONResponse({"detail": detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse({"detail": "Please check the form and try again."}, status_code=422)


@app.middleware("http")
async def headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


async def json_body(request: Request, limit: int = 2_000_000) -> dict:
    raw = await request.body()
    if len(raw) > limit:
        raise HTTPException(413, "That is too much data.")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Please check the form and try again.")
    if not isinstance(data, dict):
        raise HTTPException(400, "Please check the form and try again.")
    return data


# ------------------------------------------------------------------ simple per IP limiter for public writes

_hits: dict[tuple[str, str], list[float]] = {}
_hits_lock = threading.Lock()


def limited(request: Request, bucket: str, per_minute: int) -> bool:
    ip = request.headers.get("x-forwarded-for", "").split(",")[-1].strip() or (request.client.host if request.client else "?")
    now = time.time()
    with _hits_lock:
        if len(_hits) > 20000:
            _hits.clear()
        lst = [t for t in _hits.get((bucket, ip), []) if now - t < 60]
        lst.append(now)
        _hits[(bucket, ip)] = lst
        return len(lst) > per_minute


# ------------------------------------------------------------------ public API

@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/api/store")
def api_store() -> dict:
    return shop.public_store()


@app.get("/api/catalog")
def api_catalog() -> dict:
    return {"products": shop.public_catalog()}


@app.get("/api/leagues")
def api_leagues() -> dict:
    return {"leagues": shop.public_leagues()}


EVENT_TYPES = {"visit", "view", "bag", "search", "checkout_start", "remix", "share", "upsell_add", "ad_view", "ad_click"}


@app.post("/api/event")
async def api_event(request: Request) -> dict:
    try:
        body = await json_body(request, 4000)
    except HTTPException:
        return {"ok": False}
    typ = str(body.get("type", ""))[:30]
    if typ not in EVENT_TYPES or limited(request, "event", 240):
        return {"ok": False}
    sid = str(body.get("sid", ""))[:24]
    slug = str(body.get("slug", ""))[:90]
    qtext = str(body.get("q", ""))[:80].strip().lower() if typ == "search" else ""
    db.run("INSERT INTO events(ts,type,sid,slug,q) VALUES(?,?,?,?,?)", (time.time(), typ, sid, slug, qtext))
    if typ == "view" and slug:
        db.run("UPDATE products SET views=views+1 WHERE slug=?", (slug,))
    elif typ == "bag" and slug:
        db.run("UPDATE products SET bags=bags+1 WHERE slug=?", (slug,))
    return {"ok": True}


@app.post("/api/like")
async def api_like(request: Request) -> dict:
    body = await json_body(request, 2000)
    slug = str(body.get("slug", ""))[:90]
    if limited(request, "like", 60):
        return {"ok": False}
    with db.tx() as c:
        r = c.execute("SELECT data FROM products WHERE slug=?", (slug,)).fetchone()
        if not r:
            return {"ok": False}
        p = json.loads(r["data"])
        p["likes"] = max(0, int(p.get("likes", 0)) + (-1 if body.get("unlike") else 1))
        c.execute("UPDATE products SET data=? WHERE slug=?", (json.dumps(p), slug))
    return {"ok": True, "likes": p["likes"]}


@app.post("/api/quote")
async def api_quote(request: Request) -> dict:
    body = await json_body(request)
    return shop.public_quote(shop.price_order(body, strict_code=True))


@app.post("/api/discount/check")
async def api_discount_check(request: Request) -> dict:
    body = await json_body(request, 4000)
    if limited(request, "code", 30):
        return {"ok": False, "message": "Too many tries. Wait a minute and try again."}
    code = str(body.get("code", "")).strip().upper()[:40]
    if not code:
        return {"ok": False, "message": "Type a code first."}
    d, err = shop.check_discount(code, shop._num(body.get("subtotal")))
    if not d:
        return {"ok": False, "message": err}
    return {"ok": True, "code": d["code"], "kind": d["kind"], "value": d["value"], "message": shop.discount_message(d)}


@app.post("/api/orders")
async def api_orders(request: Request) -> dict:
    body = await json_body(request)
    if limited(request, "order", 10):
        raise HTTPException(429, "Too many orders in a short time. Please wait a minute and try again.")
    o = shop.create_order(body)
    out = shop.order_view(o)
    out["status_label"] = shop.PUBLIC_LABEL[o["status"]]
    out["payment"] = shop.payment_for_order(o)
    out["items"] = [{k: v for k, v in i.items() if k not in ("cost_each",)} for i in o["items"]]
    for k in ("cost", "admin_note", "demo"):
        out.pop(k, None)
    return out


def _order_for(code: str, email: str) -> dict:
    o = shop.load_order(code.strip().upper()) if code else None
    if not o or o["email"].lower() != (email or "").strip().lower() or o.get("demo"):
        raise HTTPException(404, "We couldn't find an order with that number and email. Check both and try again.")
    return o


@app.post("/api/orders/{code}/paid")
async def api_order_paid(code: str, request: Request) -> dict:
    body = await json_body(request, 4000)
    if limited(request, "paid", 20):
        raise HTTPException(429, "Too many tries. Wait a minute and try again.")
    o = _order_for(code, str(body.get("email", "")))
    ref = str(body.get("reference") or "").strip()[:120]
    if o["status"] in ("awaiting_payment", "payment_review"):
        if ref:
            o["payment_ref"] = ref
        if o["status"] == "awaiting_payment":
            shop.set_status(o, "payment_review", "Customer says they paid" + (f" (ref {ref})" if ref else ""))
        shop.save_order(o)
    return {"ok": True, "code": o["code"], "status": o["status"], "status_label": shop.PUBLIC_LABEL[o["status"]]}


@app.get("/api/track")
def api_track(request: Request, code: str = "", email: str = "") -> dict:
    if limited(request, "track", 30):
        raise HTTPException(429, "Too many tries. Wait a minute and try again.")
    o = _order_for(code, email)
    items = [{"name": i["name"], "qty": i["qty"], "size": i.get("size", ""), "design": i.get("design") or {}, "slug": i.get("slug", "")}
             for i in o["items"] if not i.get("extra")]
    return {
        "code": o["code"], "status": o["status"], "status_label": shop.PUBLIC_LABEL.get(o["status"], o["status"]),
        "created": o["created"], "history": o["history"], "eta": o.get("eta") or o["created"] + 12 * 86400,
        "carrier": o.get("carrier", ""), "tracking": o.get("tracking", ""), "items": items,
        "extras": [{"name": i["name"], "line": i["line"]} for i in o["items"] if i.get("extra")],
        "subtotal": o["subtotal"], "shipping": o["shipping"], "total": o["total"],
        "payment": shop.payment_for_order(o) if o["status"] == "awaiting_payment" else None,
    }


@app.get("/ads.txt")
def ads_txt() -> PlainTextResponse:
    ads = shop.settings()["ads"]
    lines = []
    client = str(ads.get("adsense_client") or "")
    if re.match(r"^ca-pub-\d{6,}$", client):
        lines.append(f"google.com, {client.replace('ca-', '')}, DIRECT, f08c47fec0942fa0")
    extra = str(ads.get("ads_txt_extra") or "").strip()
    if extra:
        lines.append(extra)
    return PlainTextResponse(("\n".join(lines) if lines else "# No ad partners configured") + "\n")


@app.get("/go/{i}")
def go(i: int):
    house = shop.settings()["ads"].get("house") or []
    if 0 <= i < len(house):
        h = house[i]
        link = str(h.get("link") or "")
        if h.get("active", True) and re.match(r"^(https?://|/)", link) and not link.startswith("//"):
            db.run("INSERT INTO events(ts,type,sid,slug,q) VALUES(?,?,?,?,?)", (time.time(), "ad_click", "", f"house-{i}", str(h.get("title", ""))[:80]))
            return RedirectResponse(link, status_code=302)
    raise HTTPException(404)


# ------------------------------------------------------------------ uploads and static files

IMG_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}


@app.api_route("/uploads/{name}", methods=["GET", "HEAD"])
def uploads(name: str):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{6,64}\.(png|jpg|webp|gif)", name):
        raise HTTPException(404)
    path = db.UPLOADS / name
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type=IMG_TYPES[path.suffix], headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.api_route("/{path:path}", methods=["GET", "HEAD"])
def files(path: str):
    if path in ("", "/"):
        path = "index.html"
    elif path in ("admin", "admin/"):
        path = "admin.html"
    if any(part.startswith(("_", ".")) for part in Path(path).parts) or ".." in path or "\\" in path or "\x00" in path:
        raise HTTPException(404)
    target = (STATIC / path).resolve()
    if STATIC not in target.parents or not target.is_file():
        raise HTTPException(404)
    if target.suffix == ".html":
        cache = "no-cache"
    else:
        cache = "public, max-age=3600"
    media = None
    if target.suffix in (".js", ".mjs"):
        media = "text/javascript; charset=utf-8"
    return FileResponse(target, media_type=media, headers={"Cache-Control": cache})


@app.api_route("/{path:path}", methods=["POST", "PUT", "PATCH", "DELETE"])
def not_found(path: str):
    raise HTTPException(404)
