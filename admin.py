"""Owner admin API (/api/admin/*)."""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import random
import re
import secrets
import statistics
import time
from collections import Counter, defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from . import agents, auth, db, shop

router = APIRouter(prefix="/api/admin")
guard = [Depends(auth.require_admin)]

SPORTS = ["Soccer", "Basketball", "Football", "Baseball", "Hockey", "Volleyball", "Training", "Multi sport"]
PATTERNS = ["solid", "stripes", "hoops", "sash", "gradient", "chevron", "split", "pinstripe", "camo", "hex", "halftone", "waves", "flames"]
FONTS = ["block", "tall", "varsity", "stencil", "future", "racing", "script", "modern"]
SHAPE_CATEGORY = {
    "jersey": "Jerseys", "jersey-long": "Jerseys", "jersey-tank": "Jerseys", "hoodie": "Hoodies", "shorts": "Shorts", "socks": "Socks",
    "cap": "Caps", "beanie": "Caps", "bag": "Bags", "backpack": "Bags", "bottle": "Bottles", "cleats": "Footwear", "sneakers": "Footwear",
    "hockey-skates": "Footwear", "gloves": "Gloves", "goalkeeper-gloves": "Protection", "hockey-gloves": "Protection",
    "shinguards": "Protection", "knee-pads": "Protection", "shoulder-pads": "Protection", "football-helmet": "Protection",
    "batting-helmet": "Protection", "hockey-helmet": "Protection", "ball-soccer": "Balls", "ball-basketball": "Balls",
    "ball-football": "Balls", "ball-volleyball": "Balls", "ball-baseball": "Balls", "puck": "Equipment", "hockey-stick": "Equipment",
    "baseball-bat": "Equipment", "baseball-mitt": "Equipment", "mini-hoop": "Equipment", "tennis-racket": "Equipment",
    "captain-armband": "Equipment", "arm-sleeve": "Protection", "headband": "Equipment", "wristbands": "Equipment",
}
DEFAULT_DESIGN = {"primary": "#04282e", "secondary": "#c8f53c", "accent": "#ffffff", "pattern": "solid", "font": "block", "finish": "matte",
                  "outline": False, "patch": "none", "lighting": "studio"}


def now() -> float:
    return time.time()


# ------------------------------------------------------------------ auth

@router.get("/state")
def state(request: Request) -> dict:
    return {"setup_needed": auth.setup_needed(), "authed": bool(not auth.setup_needed() and auth.current_token(request))}


async def _body(request: Request) -> dict:
    try:
        raw = await request.body()
        data = json.loads(raw) if raw else {}
    except ValueError:
        raise HTTPException(400, "Please check the form and try again.")
    if not isinstance(data, dict):
        raise HTTPException(400, "Please check the form and try again.")
    return data


@router.post("/setup")
async def setup(request: Request, response: Response) -> dict:
    body = await _body(request)
    if not auth.setup_needed():
        raise HTTPException(400, "The owner password is already set. Sign in instead.")
    pw = str(body.get("password", ""))
    if len(pw) < 8:
        raise HTTPException(400, "The password needs at least 8 characters.")
    if len(pw) > 200:
        raise HTTPException(400, "That password is too long.")
    db.kv_set("admin_pw", auth.hash_pw(pw))
    auth.new_session(request, response)
    return {"ok": True}


@router.post("/login")
async def login(request: Request, response: Response) -> dict:
    body = await _body(request)
    if auth.setup_needed():
        raise HTTPException(400, "No password is set yet. Reload the page to create one.")
    auth.rate_check(request)
    pw = str(body.get("password", ""))[:200]
    if not auth.check_pw(pw, db.kv_get("admin_pw", "")):
        auth.rate_fail(request)
        raise HTTPException(401, "That password is not right. Try again.")
    auth.rate_clear(request)
    auth.new_session(request, response)
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response) -> dict:
    auth.end_session(request, response)
    return {"ok": True}


@router.post("/password", dependencies=guard)
async def password(request: Request) -> dict:
    body = await _body(request)
    auth.rate_check(request)
    if not auth.check_pw(str(body.get("current", ""))[:200], db.kv_get("admin_pw", "")):
        auth.rate_fail(request)
        raise HTTPException(400, "Your current password is not right.")
    new = str(body.get("new", ""))
    if len(new) < 8 or len(new) > 200:
        raise HTTPException(400, "The new password needs at least 8 characters.")
    db.kv_set("admin_pw", auth.hash_pw(new))
    keep = auth.current_token(request)
    db.run("DELETE FROM sessions WHERE token<>?", (keep or "",))
    return {"ok": True}


# ------------------------------------------------------------------ helpers

def order_summary(o: dict) -> dict:
    return {"code": o["code"], "created": o["created"], "email": o["email"], "customer": o.get("customer") or {},
            "status": o["status"], "status_label": shop.STATUS_LABEL.get(o["status"], o["status"]), "total": o["total"],
            "items": o["items"], "payment": o.get("payment"), "payment_label": o.get("payment_label", ""),
            "payment_ref": o.get("payment_ref", ""), "demo": bool(o.get("demo"))}


def product_stats() -> tuple[dict, dict]:
    units, revenue = Counter(), Counter()
    for o in shop.all_orders():
        if o["status"] not in shop.PAID:
            continue
        for i in o["items"]:
            if i.get("extra"):
                continue
            units[i["slug"]] += i["qty"]
            revenue[i["slug"]] += i["line"]
    return units, revenue


def admin_product(p: dict, names: dict, units: dict, revenue: dict) -> dict:
    p = shop.decorate(dict(p), names)
    p["units"] = units.get(p["slug"], 0)
    p["revenue"] = round(revenue.get(p["slug"], 0.0), 2)
    p.setdefault("views", 0)
    p.setdefault("bags", 0)
    p.setdefault("cost", 0)
    p.setdefault("sort", 0)
    p.setdefault("images", [])
    p["league"] = p.get("league") or ""
    p.pop("flash_base", None)
    return p


def period_since(days: int) -> float:
    return now() - max(1, min(366, days)) * 86400


def _num(v, d=0.0) -> float:
    return shop._num(v, d)


# ------------------------------------------------------------------ dashboard

@router.get("/overview", dependencies=guard)
def overview(days: int = 30) -> dict:
    since = period_since(days)
    orders = shop.all_orders()
    period = [o for o in orders if o["created"] >= since]
    paid = [o for o in period if o["status"] in shop.PAID]
    revenue = sum(o["total"] for o in paid)
    cost = sum(o.get("cost", 0) for o in paid)
    visitors = db.q1("SELECT COUNT(DISTINCT sid) AS n FROM events WHERE ts>=? AND sid<>''", (since,))["n"]
    open_sugg = sum(1 for s in db.jrows("suggestions") if s.get("state") == "open")
    return {
        "days": days, "needs_review": sum(1 for o in orders if o["status"] == "payment_review"),
        "awaiting": sum(1 for o in orders if o["status"] == "awaiting_payment"),
        "to_make": sum(1 for o in orders if o["status"] in ("paid", "in_production")),
        "payments_on": bool(shop.live_methods()), "open_suggestions": open_sugg,
        "revenue": round(revenue, 2), "profit": round(revenue - cost, 2), "paid_orders": len(paid), "orders": len(period),
        "aov": round(revenue / len(paid), 2) if paid else 0, "visitors": visitors,
        "conversion": round(len(paid) / visitors * 100, 2) if visitors else 0.0,
        "recent": [order_summary(o) for o in orders[:8]], "activity": activity(orders),
    }


def activity(orders: list[dict]) -> list[dict]:
    feed = []
    for o in orders[:40]:
        name = (o.get("customer") or {}).get("name") or o["email"]
        for h in o.get("history", []):
            if h["status"] == "awaiting_payment":
                feed.append({"at": h["at"], "text": f"New order {o['code']} from {name}, ${o['total']:.2f}"})
            elif h["status"] == "payment_review":
                feed.append({"at": h["at"], "text": f"{name} says they paid for {o['code']}"})
            else:
                feed.append({"at": h["at"], "text": f"{o['code']} is now {shop.STATUS_LABEL.get(h['status'], h['status']).lower()}"})
    names = {p["slug"]: p["name"] for p in db.products()}
    for e in db.q("SELECT ts, type, slug, q FROM events WHERE ts>=? AND type IN ('bag','view','search','checkout_start','upsell_add','ad_click') "
                  "ORDER BY ts DESC LIMIT 40", (now() - 7 * 86400,)):
        n = names.get(e["slug"], "a product")
        text = {"bag": f"Someone added {n} to their bag", "view": f"Someone is looking at {n}",
                "search": f"Someone searched for \"{e['q']}\"", "checkout_start": "Someone started checking out",
                "upsell_add": f"Someone added a matching {n}", "ad_click": "Someone clicked a partner banner"}[e["type"]]
        feed.append({"at": e["ts"], "text": text})
    feed.sort(key=lambda x: -x["at"])
    return feed[:20]


@router.get("/analytics", dependencies=guard)
def analytics(days: int = 30) -> dict:
    days = max(1, min(366, days))
    since = period_since(days)
    today = dt.datetime.now(dt.timezone.utc).date()
    period = [o for o in shop.all_orders(since)]
    paid = [o for o in period if o["status"] in shop.PAID]
    daily = [{"revenue": 0.0, "orders": 0} for _ in range(days)]
    for o in paid:
        idx = days - 1 - (today - dt.datetime.fromtimestamp(o["created"], dt.timezone.utc).date()).days
        if 0 <= idx < days:
            daily[idx]["revenue"] = round(daily[idx]["revenue"] + o["total"], 2)
            daily[idx]["orders"] += 1
    revenue = sum(o["total"] for o in paid)
    cost = sum(o.get("cost", 0) for o in paid)
    prods = {p["slug"]: p for p in db.products()}
    lnames = shop.league_names()
    units, rev = Counter(), Counter()
    by_sport, by_league, by_pay = Counter(), Counter(), Counter()
    for o in paid:
        by_pay[o.get("payment_label") or "Other"] += o["total"]
        for i in o["items"]:
            if i.get("extra"):
                continue
            units[i["slug"]] += i["qty"]
            rev[i["slug"]] += i["line"]
            p = prods.get(i["slug"], {})
            by_sport[i.get("sport") or p.get("sport") or "Other"] += i["line"]
            lg = i.get("league") or p.get("league") or ""
            by_league[lnames.get(lg, "No league") if lg else "No league"] += i["line"]
    top = []
    for slug, r in rev.most_common(8):
        p = prods.get(slug)
        it = next((i for o in paid for i in o["items"] if i.get("slug") == slug), {})
        top.append({"slug": slug, "name": (p or it).get("name", slug), "units": units[slug], "revenue": round(r, 2),
                    "design": (p or {}).get("design") or it.get("design") or {}, "shape": (p or it).get("shape")})

    def distinct(where: str) -> int:
        return db.q1(f"SELECT COUNT(DISTINCT sid) AS n FROM events WHERE ts>=? AND sid<>'' AND {where}", (since,))["n"]
    visitors = distinct("1=1")
    funnel = [{"step": "Visited the store", "n": visitors}, {"step": "Looked at a product", "n": distinct("type='view'")},
              {"step": "Added to bag", "n": distinct("type='bag'")}, {"step": "Started checkout", "n": distinct("type='checkout_start'")},
              {"step": "Placed an order", "n": len(period)}, {"step": "Paid", "n": len(paid)}]
    s = shop.settings()
    house = s["ads"].get("house") or []
    ads = []
    for r in db.q("SELECT type, slug, COUNT(*) AS c FROM events WHERE ts>=? AND type IN ('ad_view','ad_click','upsell_add') GROUP BY type, slug", (since,)):
        qn = ""
        m = re.match(r"house-(\d+)$", r["slug"] or "")
        if m and int(m.group(1)) < len(house):
            qn = house[int(m.group(1))].get("title", "")
        ads.append({"type": r["type"], "slug": r["slug"], "q": qn, "c": r["c"]})
    refcodes = {json.loads(r["data"])["code"] for r in db.q("SELECT data FROM discounts") if json.loads(r["data"]).get("referral")}
    refs = Counter(o["discount_code"] for o in period if o.get("discount_code") in refcodes)
    searches = [{"q": r["q"], "c": r["c"]} for r in db.q(
        "SELECT q, COUNT(*) AS c FROM events WHERE ts>=? AND type='search' AND q<>'' GROUP BY q ORDER BY c DESC LIMIT 15", (since,))]
    return {
        "days": days, "daily": daily, "revenue": round(revenue, 2), "profit": round(revenue - cost, 2), "paid": len(paid),
        "orders": len(period), "funnel": funnel, "top": top,
        "by_sport": [[k, round(v, 2)] for k, v in by_sport.most_common()],
        "by_league": [[k, round(v, 2)] for k, v in by_league.most_common()],
        "by_payment": [[k, round(v, 2)] for k, v in by_pay.most_common()],
        "by_status": [[shop.STATUS_LABEL.get(k, k), v] for k, v in Counter(o["status"] for o in period).most_common()],
        "ads": ads, "referrals": [{"code": k, "uses": v} for k, v in refs.most_common(10)],
        "upgrade_revenue": round(sum(o.get("extras_total", 0) for o in paid), 2), "searches": searches,
    }


# ------------------------------------------------------------------ orders

@router.get("/orders", dependencies=guard)
def orders(status: str = "", q: str = "") -> dict:
    allo = shop.all_orders()
    ql = q.strip().lower()
    if ql:
        allo = [o for o in allo if ql in f"{o['code']} {o['email']} {(o.get('customer') or {}).get('name', '')}".lower()]
    counts = Counter(o["status"] for o in allo)
    shown = [o for o in allo if not status or o["status"] == status][:500]
    return {"orders": [order_summary(o) for o in shown], "counts": dict(counts),
            "statuses": [{"key": k, "label": v} for k, v in shop.STATUSES]}


@router.get("/orders.csv", dependencies=guard)
def orders_csv() -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["code", "placed", "status", "name", "email", "phone", "address", "items", "pieces", "subtotal", "team_discount",
                "discount", "discount_code", "shipping", "upgrades", "total", "cost", "payment", "payment_ref", "carrier", "tracking", "demo"])
    for o in shop.all_orders():
        c = o.get("customer") or {}
        addr = ", ".join(x for x in [c.get("address1"), c.get("address2"), c.get("city"), c.get("region"), c.get("postal"), c.get("country")] if x)
        items = "; ".join(f"{i['qty']} x {i['name']}" + (f" ({i.get('size')})" if i.get("size") else "") for i in o["items"])
        row = [o["code"], dt.datetime.fromtimestamp(o["created"], dt.timezone.utc).strftime("%Y-%m-%d %H:%M"), o["status"], c.get("name", ""),
               o["email"], c.get("phone", ""), addr, items, o.get("qty", ""), o["subtotal"], o["squad_discount"], o["discount"],
               o.get("discount_code", ""), o["shipping"], o.get("extras_total", 0), o["total"], o.get("cost", 0), o.get("payment_label", ""),
               o.get("payment_ref", ""), o.get("carrier", ""), o.get("tracking", ""), "yes" if o.get("demo") else ""]
        w.writerow([("'" + v) if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") else v for v in row])
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="orders-{dt.date.today().isoformat()}.csv"'})


def order_detail(o: dict) -> dict:
    out = shop.order_view(o)
    out["customer_orders"] = [{"code": x["code"], "created": x["created"], "status": shop.STATUS_LABEL.get(x["status"], x["status"]),
                               "total": x["total"]} for x in
                              [json.loads(r["data"]) for r in db.q("SELECT data FROM orders WHERE email=? ORDER BY created DESC LIMIT 30", (o["email"],))]]
    return out


@router.get("/orders/{code}", dependencies=guard)
def order_get(code: str) -> dict:
    o = shop.load_order(code)
    if not o:
        raise HTTPException(404, "That order was not found.")
    return order_detail(o)


@router.post("/orders/{code}", dependencies=guard)
async def order_update(code: str, request: Request) -> dict:
    body = await _body(request)
    o = shop.load_order(code)
    if not o:
        raise HTTPException(404, "That order was not found.")
    for k, n in (("carrier", 60), ("admin_note", 2000)):
        if k in body:
            o[k] = str(body[k] or "").strip()[:n]
    new_tracking = None
    if "tracking" in body:
        t = str(body["tracking"] or "").strip()[:80]
        if t and t != o.get("tracking"):
            new_tracking = t
        o["tracking"] = t
    status = str(body.get("status") or o["status"])
    if status not in shop.STATUS_LABEL:
        raise HTTPException(400, "That status is not valid.")
    note = str(body.get("status_note") or "")[:200]
    if new_tracking and status == o["status"] and o["status"] in ("paid", "in_production"):
        status = "shipped"
        note = note or f"Tracking {new_tracking}" + (f" ({o['carrier']})" if o.get("carrier") else "")
    shop.set_status(o, status, note)
    shop.save_order(o)
    return order_detail(o)


# ------------------------------------------------------------------ demo orders

DEMO_PEOPLE = [("Maya Kim", "Portland", "OR"), ("Daniel Okafor", "Houston", "TX"), ("Lucia Reyes", "Miami", "FL"), ("Sam Patel", "Chicago", "IL"),
               ("Ava Johnson", "Denver", "CO"), ("Noah Schmidt", "Columbus", "OH"), ("Zara Ali", "Seattle", "WA"), ("Leo Rossi", "Boston", "MA"),
               ("Emma Brown", "Austin", "TX"), ("Kofi Mensah", "Atlanta", "GA"), ("Ines Duarte", "San Diego", "CA"), ("Jack Wilson", "Nashville", "TN")]
DEMO_STATUSES = ["awaiting_payment", "payment_review", "payment_review", "paid", "paid", "in_production", "in_production", "shipped",
                 "shipped", "delivered", "delivered", "cancelled"]
ROSTER_NAMES = ["KIM", "OKAFOR", "REYES", "PATEL", "SILVA", "NOVAK", "ADEYEMI", "LARSEN", "MORENO", "CHEN", "BAKER", "SATO", "RUIZ", "DIAZ"]


def demo_size(shape: str, rnd: random.Random) -> str:
    if re.search(r"cleats|sneakers|skates", shape):
        return rnd.choice(["8", "9", "10", "11"])
    if shape in ("ball-soccer", "ball-volleyball"):
        return rnd.choice(["Size 5", "Size 4"])
    if re.search(r"^ball|puck|bottle|bag|cap|beanie|stick|helmet|hoop|bat$|mitt|racket|armband|headband|wristbands|backpack", shape):
        return "One size"
    return rnd.choice(["S", "M", "L", "XL"])


@router.post("/demo-orders", dependencies=guard)
def demo_orders() -> dict:
    live = [p for p in db.products() if p.get("status") == "live"]
    if not live:
        raise HTTPException(400, "Add a live product first.")
    rnd = random.Random()
    pays = [m["key"] for m in shop.live_methods()] or ["paypal", "cashapp", "card", "zelle"]
    made = 0
    for k, (name, city, region) in enumerate(DEMO_PEOPLE):
        created = now() - rnd.uniform(0.2, 27) * 86400
        items = []
        for _ in range(rnd.choice([1, 1, 2, 3])):
            p = rnd.choice(live)
            shirt = re.match(r"^(jersey|hoodie)", p.get("shape") or "")
            if shirt and rnd.random() < 0.35:
                n = rnd.choice([6, 8, 12, 15])
                roster = [{"name": rnd.choice(ROSTER_NAMES), "number": str(rnd.randint(1, 99)), "size": rnd.choice(["S", "M", "L", "XL", "2XL"])} for _ in range(n)]
                items.append({"slug": p["slug"], "qty": n, "size": "M", "design": p.get("design"), "roster": roster})
            else:
                items.append({"slug": p["slug"], "qty": rnd.choice([1, 1, 2]), "size": demo_size(p.get("shape") or "", rnd), "design": p.get("design")})
        first = name.split()[0].lower()
        body = {"items": items, "payment": rnd.choice(pays), "shipping_method": rnd.choice(["standard", "standard", "express"]),
                "extras": {"rush": rnd.random() < 0.2}, "note": rnd.choice(["", "", "Please ship before the season opener!", "Gift for my son's team"]),
                "customer": {"name": name, "email": f"{first}.demo{k}@example.com", "phone": f"555-01{k:02d}", "address1": f"{rnd.randint(10, 999)} Demo Street",
                             "city": city, "region": region, "postal": f"{rnd.randint(10000, 99999)}", "country": "United States"}}
        o = shop.create_order(body, demo=True, created=created)
        target = DEMO_STATUSES[k % len(DEMO_STATUSES)]
        flow = ["awaiting_payment", "payment_review", "paid", "in_production", "shipped", "delivered"]
        t = created
        o["history"] = [{"status": "awaiting_payment", "at": created, "note": "Order placed"}]
        if target == "cancelled":
            o["history"].append({"status": "cancelled", "at": created + 3600 * 30, "note": "Customer changed their mind"})
        else:
            for st in flow[1:flow.index(target) + 1]:
                t = min(now() - 60, t + rnd.uniform(2, 30) * 3600)
                o["history"].append({"status": st, "at": t, "note": ""})
        o["status"] = target
        if target in ("payment_review", "paid", "in_production", "shipped", "delivered"):
            o["payment_ref"] = rnd.choice(["", f"{name.split()[0]} {name.split()[1][0]}.", f"TX{rnd.randint(100000, 999999)}"])
        if target in ("shipped", "delivered"):
            o["carrier"], o["tracking"] = "USPS", f"9400{rnd.randint(10**15, 10**16 - 1)}"
        shop.save_order(o)
        made += 1
    return {"ok": True, "created": made}


@router.post("/demo-orders/clear", dependencies=guard)
def demo_clear() -> dict:
    n = db.q1("SELECT COUNT(*) AS n FROM orders WHERE demo=1")["n"]
    db.run("DELETE FROM orders WHERE demo=1")
    return {"ok": True, "removed": n}


# ------------------------------------------------------------------ products

@router.get("/products", dependencies=guard)
def products() -> dict:
    ps = db.products(include_stats=True)
    shop.expire_flash(ps)
    names = shop.league_names()
    units, revenue = product_stats()
    out = [admin_product(p, names, units, revenue) for p in sorted(ps, key=shop.sort_key)]
    cats = sorted({p.get("category") for p in ps if p.get("category")} | set(SHAPE_CATEGORY.values()))
    sports = SPORTS + sorted({p.get("sport") for p in ps if p.get("sport") and p.get("sport") not in SPORTS})
    shapes = sorted({p.get("shape") for p in ps if p.get("shape")} | set(SHAPE_CATEGORY))
    return {"products": out, "categories": cats, "sports": sports, "shapes": shapes, "patterns": PATTERNS, "fonts": FONTS}


def _one_admin_product(slug: str) -> dict:
    r = db.q1("SELECT data, views, bags FROM products WHERE slug=?", (slug,))
    p = json.loads(r["data"])
    p["views"], p["bags"] = r["views"], r["bags"]
    units, revenue = product_stats()
    return admin_product(p, shop.league_names(), units, revenue)


def suggested_price(shape: str) -> float:
    prices = [p["price"] for p in db.products() if p.get("shape") == shape and p.get("price")]
    if not prices:
        return 39.99
    return round(int(statistics.median(prices)) + 0.99, 2)


def template_design(shape: str) -> dict:
    same = [p for p in db.products() if p.get("shape") == shape]
    if same:
        best = max(same, key=lambda p: p.get("likes", 0))
        return dict(best.get("design") or {})
    return dict(DEFAULT_DESIGN)


def clean_images(v) -> list[str]:
    out = []
    for u in (v if isinstance(v, list) else [])[:8]:
        u = str(u)
        if re.fullmatch(r"/uploads/[a-zA-Z0-9_-]{6,64}\.(png|jpg|webp|gif)", u) or re.match(r"^https://[^\s\"'<>]{4,400}$", u):
            out.append(u)
    return out


def apply_fields(p: dict, body: dict) -> None:
    if "name" in body:
        name = str(body["name"] or "").strip()[:120]
        if not name:
            raise HTTPException(400, "Give the product a name.")
        p["name"] = name
    for k, n in (("description", 2000), ("sport", 40), ("category", 40)):
        if k in body:
            p[k] = str(body[k] or "").strip()[:n]
    if "league" in body:
        lg = str(body["league"] or "")
        if lg and not db.q1("SELECT 1 FROM leagues WHERE key=?", (lg,)):
            raise HTTPException(400, "That league does not exist.")
        p["league"] = lg
    if "price" in body:
        price = round(_num(body["price"]), 2)
        if price <= 0:
            raise HTTPException(400, "Set a price above zero.")
        p["price"] = price
    for k in ("compare_at", "cost"):
        if k in body:
            p[k] = round(max(0.0, _num(body[k])), 2)
    if "lead_days" in body:
        p["lead_days"] = int(max(1, min(120, _num(body["lead_days"], 12))))
    if "sort" in body:
        p["sort"] = int(max(-100000, min(100000, _num(body["sort"]))))
    if "status" in body:
        if body["status"] not in ("live", "draft", "archived"):
            raise HTTPException(400, "That status is not valid.")
        p["status"] = body["status"]
    if "featured" in body:
        p["featured"] = bool(body["featured"])
    if "design" in body and isinstance(body["design"], dict):
        d = shop.clean_design(body["design"])
        d["shape"] = p.get("shape")
        p["design"] = d
    if "images" in body:
        p["images"] = clean_images(body["images"])


@router.post("/products", dependencies=guard)
async def product_create(request: Request) -> dict:
    body = await _body(request)
    name = str(body.get("name") or "").strip()[:120]
    if not name:
        raise HTTPException(400, "Give the product a name.")
    shape = str(body.get("shape") or "jersey")[:40]
    if not re.fullmatch(r"[a-z0-9-]+", shape):
        raise HTTPException(400, "That product type is not valid.")
    price = round(_num(body.get("price")), 2) if body.get("price") not in (None, "") else suggested_price(shape)
    design = shop.clean_design(body["design"]) if isinstance(body.get("design"), dict) else template_design(shape)
    design["shape"] = shape
    p = {"slug": db.unique_slug(name), "name": name, "sport": str(body.get("sport") or "Multi sport")[:40],
         "category": SHAPE_CATEGORY.get(shape, "Equipment"), "shape": shape, "league": "", "description": "", "design": design,
         "price": price if price > 0 else suggested_price(shape), "compare_at": 0, "cost": 0, "featured": False, "flash": False, "flash_ends": 0,
         "lead_days": 12, "likes": 0, "status": "draft", "created": now(), "images": [], "sort": 0}
    p["cost"] = round(p["price"] * 0.38, 2)
    rest = {k: v for k, v in body.items() if k not in ("name", "shape", "design")}
    if not rest.get("price"):
        rest.pop("price", None)
    if not rest.get("category"):
        rest.pop("category", None)
    apply_fields(p, rest)
    db.save_product(p)
    return _one_admin_product(p["slug"])


@router.post("/products/{slug}", dependencies=guard)
async def product_update(slug: str, request: Request) -> dict:
    body = await _body(request)
    p = db.product(slug)
    if not p:
        raise HTTPException(404, "That product was not found.")
    apply_fields(p, body)
    db.save_product(p)
    return _one_admin_product(slug)


@router.post("/products/{slug}/colorways", dependencies=guard)
async def product_colorways(slug: str, request: Request) -> dict:
    body = await _body(request)
    p = db.product(slug)
    if not p:
        raise HTTPException(404, "That product was not found.")
    count = int(max(1, min(12, _num(body.get("count"), 3))))
    created = agents.make_colorways(p, count, status="live")
    return {"ok": True, "created": [{"slug": c["slug"], "name": c["name"]} for c in created]}


@router.post("/products-bulk", dependencies=guard)
async def products_bulk(request: Request) -> dict:
    body = await _body(request)
    action = str(body.get("action") or "")
    slugs = [str(s) for s in (body.get("slugs") or [])][:2000]
    if action not in ("feature", "unfeature", "flash", "endflash", "price", "live", "draft", "archive", "delete"):
        raise HTTPException(400, "That action is not valid.")
    n = 0
    for slug in slugs:
        p = db.product(slug)
        if not p:
            continue
        if action == "delete":
            db.delete_product(slug)
        else:
            if action == "feature":
                p["featured"] = True
            elif action == "unfeature":
                p["featured"] = False
            elif action == "flash":
                agents.start_flash(p, _num(body.get("percent"), 20), _num(body.get("hours"), 48))
            elif action == "endflash":
                agents.end_flash(p)
            elif action == "price":
                pct = max(-90.0, min(300.0, _num(body.get("percent"))))
                p["price"] = max(0.5, round(p["price"] * (1 + pct / 100), 2))
                if p.get("flash_base"):
                    p["flash_base"]["price"] = max(0.5, round(p["flash_base"]["price"] * (1 + pct / 100), 2))
            elif action in ("live", "draft"):
                p["status"] = action
            elif action == "archive":
                p["status"] = "archived"
            db.save_product(p)
        n += 1
    return {"ok": True, "changed": n}


# ------------------------------------------------------------------ leagues

@router.get("/leagues", dependencies=guard)
def leagues() -> dict:
    return {"leagues": shop.public_leagues()}


@router.post("/leagues/{key}", dependencies=guard)
async def league_save(key: str, request: Request) -> dict:
    body = await _body(request)
    key = re.sub(r"[^a-z0-9-]+", "-", key.lower()).strip("-")[:60]
    if not key:
        raise HTTPException(400, "Give the league a name.")
    if body.get("delete"):
        db.run("DELETE FROM leagues WHERE key=?", (key,))
        for p in db.products():
            if p.get("league") == key:
                p["league"] = ""
                db.save_product(p)
        return {"ok": True}
    name = str(body.get("name") or "").strip()[:80]
    if not name:
        raise HTTPException(400, "Give the league a name.")
    colors = [c for c in (body.get("colors") or []) if isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c)][:3]
    while len(colors) < 3:
        colors.append(["#04282e", "#c8f53c", "#ffffff"][len(colors)])
    l = {"key": key, "name": name, "sport": str(body.get("sport") or "Soccer")[:40], "region": str(body.get("region") or "").strip()[:60],
         "tagline": str(body.get("tagline") or "").strip()[:240], "colors": colors}
    db.save_league(l)
    return {"ok": True, "league": l}


# ------------------------------------------------------------------ discounts

@router.get("/discounts", dependencies=guard)
def discounts() -> dict:
    ds = [json.loads(r["data"]) for r in db.q("SELECT data FROM discounts")]
    ds.sort(key=lambda d: (bool(d.get("referral")), -(d.get("created") or 0)))
    return {"discounts": ds}


@router.post("/discounts", dependencies=guard)
async def discount_save(request: Request) -> dict:
    body = await _body(request)
    code = str(body.get("code") or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9_-]{1,24}", code):
        raise HTTPException(400, "Use only letters, numbers, dash or underscore in the code.")
    if body.get("delete"):
        db.run("DELETE FROM discounts WHERE code=?", (code,))
        return {"ok": True}
    kind = body.get("kind")
    if kind not in ("percent", "fixed", "ship"):
        raise HTTPException(400, "Pick a discount type.")
    value = 0.0 if kind == "ship" else round(_num(body.get("value")), 2)
    if kind != "ship" and value <= 0:
        raise HTTPException(400, "Enter how much the code takes off.")
    if kind == "percent" and value > 100:
        raise HTTPException(400, "A percent discount can be at most 100.")
    old = shop.find_discount(code) or {"uses": 0, "created": now()}
    d = {**old, "code": code, "kind": kind, "value": value, "min_order": max(0.0, _num(body.get("min_order"))),
         "max_uses": int(max(0, _num(body.get("max_uses")))), "expires": max(0.0, _num(body.get("expires"))), "active": bool(body.get("active"))}
    db.run("INSERT INTO discounts(code,data) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data", (code, json.dumps(d)))
    return {"ok": True, "discount": d}


# ------------------------------------------------------------------ settings

def _str(v, n=200) -> str:
    return str(v or "").strip()[:n]


@router.get("/settings", dependencies=guard)
def settings_get() -> dict:
    return {"settings": shop.settings(), "payment_methods": shop.PAYMENT_METHODS}


@router.post("/settings", dependencies=guard)
async def settings_save(request: Request) -> dict:
    body = await _body(request)
    s = shop.settings()
    if "name" in body:
        if not _str(body["name"]):
            raise HTTPException(400, "Your store needs a name.")
        s["name"] = _str(body["name"], 80)
    if "support_email" in body:
        em = _str(body["support_email"], 120)
        if em and not shop.EMAIL_RE.match(em):
            raise HTTPException(400, "The support email does not look right.")
        s["support_email"] = em
    for k in ("instagram", "tiktok"):
        if k in body:
            v = _str(body[k], 120)
            v = re.sub(r"^https?://(www\.)?(instagram\.com|tiktok\.com)/@?", "", v).strip("/").lstrip("@")
            s[k] = v
    for k, n in (("hero_eyebrow", 80), ("hero_headline", 120), ("hero_sub", 400)):
        if k in body:
            s[k] = _str(body[k], n)
    for k in ("free_ship_over", "ship_flat", "ship_express", "big_size_fee"):
        if k in body:
            s[k] = round(max(0.0, min(100000.0, _num(body[k]))), 2)
    if "announcement" in body and isinstance(body["announcement"], list):
        s["announcement"] = [_str(a, 90) for a in body["announcement"] if _str(a)][:12]
    if "squad_tiers" in body and isinstance(body["squad_tiers"], list):
        tiers = []
        for t in body["squad_tiers"][:10]:
            if isinstance(t, (list, tuple)) and len(t) == 2:
                n, p = int(_num(t[0])), int(_num(t[1]))
                if n > 0 and 0 < p <= 90:
                    tiers.append([n, p])
        s["squad_tiers"] = sorted(tiers)
    if isinstance(body.get("payments"), dict):
        pays = {}
        for k, c in body["payments"].items():
            if k not in shop.PM_BY_KEY or not isinstance(c, dict):
                continue
            link = _str(c.get("link"), 500)
            if link and not re.match(r"^https://[^\s\"'<>]+$", link):
                raise HTTPException(400, "The payment link should start with https://")
            pays[k] = {"enabled": bool(c.get("enabled")), "link": link, "handle": _str(c.get("handle"), 200).lstrip("@$"),
                       "instructions": _str(c.get("instructions"), 1000)}
        s["payments"] = pays
    if isinstance(body.get("extras"), dict):
        e = body["extras"]
        s["extras"] = {"rush_fee": round(max(0.0, _num(e.get("rush_fee"))), 2), "rush_days": int(max(1, min(60, _num(e.get("rush_days"), 5)))),
                       "gift_wrap_fee": round(max(0.0, _num(e.get("gift_wrap_fee"))), 2),
                       "referral_percent": int(max(1, min(50, _num(e.get("referral_percent"), 10)))), "referral_enabled": bool(e.get("referral_enabled"))}
    if isinstance(body.get("ads"), dict):
        a = body["ads"]
        client = _str(a.get("adsense_client"), 40)
        if client and not re.fullmatch(r"ca-pub-\d{10,20}", client):
            raise HTTPException(400, "The publisher ID should look like ca-pub- followed by numbers.")
        house = []
        for h in (a.get("house") or [])[:12]:
            if not isinstance(h, dict):
                continue
            link = _str(h.get("link"), 500)
            img = _str(h.get("image"), 500)
            active = bool(h.get("active"))
            if active and (not img or not re.match(r"^(https?://|/)", link) or link.startswith("//")):
                raise HTTPException(400, "Each active banner needs an image and a link starting with https:// (or switch it off).")
            if img and not (clean_images([img])):
                raise HTTPException(400, "Upload the banner image here first.")
            house.append({"title": _str(h.get("title"), 120), "image": img, "link": link, "active": active,
                          "placement": h.get("placement") if h.get("placement") in ("home", "shop", "product", "footer") else "footer"})
        s["ads"] = {"adsense_client": client, "adsense_slot": re.sub(r"[^0-9]", "", _str(a.get("adsense_slot"), 20)),
                    "placements": [p for p in (a.get("placements") or []) if p in ("home", "shop", "product", "footer")],
                    "every_n": int(max(4, min(60, _num(a.get("every_n"), 12)))), "ads_txt_extra": str(a.get("ads_txt_extra") or "")[:4000],
                    "house": house}
    if isinstance(body.get("autopilot"), dict):
        a = body["autopilot"]
        s["autopilot"] = {"mode": a.get("mode") if a.get("mode") in ("off", "suggest", "auto") else "suggest",
                          "retire_days": int(max(7, min(365, _num(a.get("retire_days"), 60)))),
                          "retire_views": int(max(5, min(5000, _num(a.get("retire_views"), 40)))),
                          "max_changes": int(max(1, min(50, _num(a.get("max_changes"), 5)))),
                          "remix": bool(a.get("remix")), "flash": bool(a.get("flash"))}
    db.kv_set("settings", s)
    return {"ok": True, "settings": s}


# ------------------------------------------------------------------ uploads

MAGIC = [(b"\x89PNG\r\n\x1a\n", "png"), (b"\xff\xd8\xff", "jpg"), (b"GIF87a", "gif"), (b"GIF89a", "gif")]


@router.post("/upload", dependencies=guard)
async def upload(request: Request) -> dict:
    try:
        form = await request.form(max_files=1, max_fields=5)
    except Exception:
        raise HTTPException(400, "That upload did not work. Try again.")
    f = form.get("file")
    if f is None or not hasattr(f, "read"):
        raise HTTPException(400, "Pick a photo to upload.")
    data = await f.read(6 * 1024 * 1024 + 1)
    if len(data) > 6 * 1024 * 1024:
        raise HTTPException(400, "That photo is bigger than 6 MB. Try a smaller one.")
    ext = next((e for m, e in MAGIC if data.startswith(m)), None)
    if not ext and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        ext = "webp"
    if not ext:
        raise HTTPException(400, "Use a PNG, JPG, WEBP or GIF image.")
    name = f"{secrets.token_urlsafe(12).replace('-', 'a').replace('_', 'b')}.{ext}"
    db.UPLOADS.mkdir(parents=True, exist_ok=True)
    (db.UPLOADS / name).write_bytes(data)
    return {"ok": True, "url": f"/uploads/{name}"}


# ------------------------------------------------------------------ autopilot, design lab, scouts

@router.get("/autopilot", dependencies=guard)
def autopilot_get() -> dict:
    return agents.autopilot_state()


@router.post("/autopilot/run", dependencies=guard)
def autopilot_run() -> dict:
    return agents.autopilot_run(manual=True)


@router.post("/autopilot/{sid}", dependencies=guard)
async def autopilot_act(sid: int, request: Request) -> dict:
    body = await _body(request)
    return agents.autopilot_act(sid, str(body.get("action") or ""))


@router.get("/designlab", dependencies=guard)
def designlab_get() -> dict:
    return agents.lab_state()


@router.post("/designlab/run", dependencies=guard)
def designlab_run() -> dict:
    return agents.lab_run(manual=True)


@router.post("/designlab/settings", dependencies=guard)
async def designlab_settings(request: Request) -> dict:
    body = await _body(request)
    s = {"mode": body.get("mode") if body.get("mode") in ("suggest", "auto") else "suggest",
         "per_run": int(max(1, min(50, _num(body.get("per_run"), 5))))}
    db.kv_set("lab_settings", s)
    return {"ok": True, "settings": s}


@router.post("/designlab/agents/{key}", dependencies=guard)
async def designlab_agent(key: str, request: Request) -> dict:
    body = await _body(request)
    return agents.lab_toggle(key, bool(body.get("enabled")))


@router.post("/designlab/{pid}", dependencies=guard)
async def designlab_act(pid: int, request: Request) -> dict:
    body = await _body(request)
    return agents.lab_act(pid, str(body.get("action") or ""))


@router.get("/scouts", dependencies=guard)
def scouts_get() -> dict:
    return agents.scouts_state()


@router.post("/scouts/run", dependencies=guard)
async def scouts_run(request: Request) -> dict:
    body = await _body(request)
    return agents.scouts_run(str(body.get("agent_key") or "") or None)


@router.post("/scouts/paste", dependencies=guard)
async def scouts_paste(request: Request) -> dict:
    body = await _body(request)
    text = str(body.get("text") or "")
    if len(text) > 5_000_000:
        raise HTTPException(400, "That is too much text. Paste only the recent part of the chat.")
    return agents.scouts_paste(str(body.get("agent_key") or ""), text)


@router.post("/scouts/settings", dependencies=guard)
async def scouts_settings(request: Request) -> dict:
    body = await _body(request)
    s = {"wishlist": _str(body.get("wishlist"), 2000), "auto_run": bool(body.get("auto_run")),
         "min_score": int(max(0, min(100, _num(body.get("min_score"), 40))))}
    db.kv_set("scout_settings", s)
    return {"ok": True, "settings": s}


@router.post("/scouts/agents/{key}", dependencies=guard)
async def scouts_agent(key: str, request: Request) -> dict:
    body = await _body(request)
    return agents.scouts_toggle(key, "paused" if body.get("status") == "paused" else "active")


@router.post("/scouts/leads", dependencies=guard)
async def scouts_lead_new(request: Request) -> dict:
    body = await _body(request)
    return {"ok": True, "lead": agents.lead_create(body)}


@router.post("/scouts/leads/{lid}", dependencies=guard)
async def scouts_lead_update(lid: int, request: Request) -> dict:
    body = await _body(request)
    return {"ok": True, "lead": agents.lead_update(lid, body)}


@router.delete("/scouts/leads/{lid}", dependencies=guard)
def scouts_lead_delete(lid: int) -> dict:
    db.run("DELETE FROM leads WHERE id=?", (lid,))
    return {"ok": True}


@router.post("/scouts/leads/{lid}/draft", dependencies=guard)
async def scouts_lead_draft(lid: int, request: Request) -> dict:
    body = await _body(request)
    return {"ok": True, "text": agents.lead_draft(lid, str(body.get("purpose") or "intro"))}


@router.post("/scouts/leads/{lid}/event", dependencies=guard)
async def scouts_lead_event(lid: int, request: Request) -> dict:
    body = await _body(request)
    return {"ok": True, "lead": agents.lead_event(lid, str(body.get("kind") or "note"), str(body.get("text") or ""))}
