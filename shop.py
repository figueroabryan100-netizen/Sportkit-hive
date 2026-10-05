"""Store logic shared by the public API and the admin: settings, catalog views, pricing and orders."""
from __future__ import annotations

import json
import re
import secrets
import time

from fastapi import HTTPException

from . import db

NEW_DAYS = 21
BIG_SIZES = {"2XL", "3XL", "4XL"}
PAID = ("paid", "in_production", "shipped", "delivered")

STATUSES = [
    ("awaiting_payment", "Awaiting payment"),
    ("payment_review", "Payment to confirm"),
    ("paid", "Paid"),
    ("in_production", "In production"),
    ("shipped", "Shipped"),
    ("delivered", "Delivered"),
    ("cancelled", "Cancelled"),
    ("refunded", "Refunded"),
]
STATUS_LABEL = dict(STATUSES)
PUBLIC_LABEL = {**STATUS_LABEL, "awaiting_payment": "Waiting for payment", "payment_review": "Checking payment"}

# Ways to pay. kind: link (hosted checkout page), handle (payment app), crypto (wallet), manual.
PAYMENT_METHODS = [
    {"key": "card", "label": "Card (Visa, Mastercard, Amex, Discover)", "kind": "link", "icons": ["visa", "mastercard", "amex", "discover"],
     "help": "Paste a payment link from Stripe, Square, PayPal checkout or similar. Customers pay by card on that secure page."},
    {"key": "applepay", "label": "Apple Pay", "kind": "link", "icons": ["applepay"],
     "help": "Most card payment links (Stripe, Square) show Apple Pay by themselves. Paste the same link here to list it on its own."},
    {"key": "googlepay", "label": "Google Pay", "kind": "link", "icons": ["googlepay"],
     "help": "Paste a payment link that offers Google Pay, for example a Stripe payment link."},
    {"key": "shopify", "label": "Shop Pay", "kind": "link", "icons": ["shoppay"],
     "help": "Paste a Shop Pay checkout link from your Shopify account."},
    {"key": "klarna", "label": "Klarna (pay later)", "kind": "link", "icons": ["klarna"],
     "help": "Paste a payment link that offers Klarna. Customers split the price into smaller payments, you get paid in full."},
    {"key": "affirm", "label": "Affirm or Afterpay (pay later)", "kind": "link", "icons": ["affirm", "afterpay"],
     "help": "Paste a payment link that offers Affirm or Afterpay."},
    {"key": "paypal", "label": "PayPal", "kind": "handle", "icons": ["paypal"],
     "help": "Your PayPal.Me username. Customers send the amount with the order number in the note."},
    {"key": "venmo", "label": "Venmo", "kind": "handle", "icons": ["venmo"],
     "help": "Your Venmo username, without the @."},
    {"key": "cashapp", "label": "Cash App", "kind": "handle", "icons": ["cashapp"],
     "help": "Your $Cashtag, without the $."},
    {"key": "zelle", "label": "Zelle", "kind": "handle", "icons": ["zelle"],
     "help": "The email or US phone number your Zelle account uses."},
    {"key": "revolut", "label": "Revolut", "kind": "handle", "icons": ["revolut"],
     "help": "Your Revolut username (Revtag)."},
    {"key": "wise", "label": "Wise", "kind": "handle", "icons": ["wise"],
     "help": "Your Wisetag or the email of your Wise account."},
    {"key": "chime", "label": "Chime", "kind": "handle", "icons": ["chime"],
     "help": "Your Chime $ChimeSign, without the $."},
    {"key": "btc", "label": "Bitcoin", "kind": "crypto", "icons": ["btc"],
     "help": "Your Bitcoin wallet address. A QR code is shown at checkout."},
    {"key": "eth", "label": "Ethereum", "kind": "crypto", "icons": ["eth"],
     "help": "Your Ethereum wallet address (ERC-20 network)."},
    {"key": "usdt", "label": "USDT (Tether)", "kind": "crypto", "icons": ["usdt"],
     "help": "Your USDT address. Say which network (for example TRC-20 or ERC-20) in the instructions."},
    {"key": "usdc", "label": "USDC", "kind": "crypto", "icons": ["usdc"],
     "help": "Your USDC address. Say which network in the instructions."},
    {"key": "sol", "label": "Solana", "kind": "crypto", "icons": ["sol"],
     "help": "Your Solana wallet address."},
    {"key": "ltc", "label": "Litecoin", "kind": "crypto", "icons": ["ltc"],
     "help": "Your Litecoin wallet address."},
    {"key": "doge", "label": "Dogecoin", "kind": "crypto", "icons": ["doge"],
     "help": "Your Dogecoin wallet address."},
    {"key": "bank", "label": "Bank transfer", "kind": "manual", "icons": ["bank"],
     "help": "Write your account name, number and routing or IBAN in the instructions."},
    {"key": "cash", "label": "Cash on pickup", "kind": "manual", "icons": ["cash"],
     "help": "For local teams who collect in person. Say where and when in the instructions."},
]
PM_BY_KEY = {m["key"]: m for m in PAYMENT_METHODS}
HANDLE_LINK = {"paypal": "https://paypal.me/{}", "venmo": "https://venmo.com/u/{}", "cashapp": "https://cash.app/${}",
               "revolut": "https://revolut.me/{}"}

DEFAULT_SETTINGS = {
    "name": "SquadForge", "announcement": [], "hero_eyebrow": "", "hero_headline": "", "hero_sub": "",
    "free_ship_over": 80.0, "ship_flat": 6.95, "ship_express": 18.0, "big_size_fee": 3.0,
    "squad_tiers": [[6, 8], [12, 14], [25, 20]], "support_email": "", "instagram": "", "tiktok": "",
    "extras": {"rush_fee": 15, "rush_days": 5, "gift_wrap_fee": 4, "referral_percent": 10, "referral_enabled": True},
    "ads": {"adsense_client": "", "adsense_slot": "", "placements": ["shop", "footer"], "every_n": 12, "house": [], "ads_txt_extra": ""},
    "payments": {},
    "autopilot": {"mode": "suggest", "retire_days": 60, "retire_views": 40, "max_changes": 5, "remix": True, "flash": True},
}


def settings() -> dict:
    s = db.kv_get("settings", {}) or {}
    out = {**DEFAULT_SETTINGS, **s}
    for k in ("extras", "ads", "autopilot"):
        out[k] = {**DEFAULT_SETTINGS[k], **(s.get(k) or {})}
    out["payments"] = s.get("payments") or {}
    return out


def method_live(key: str, cfg: dict) -> bool:
    m = PM_BY_KEY.get(key)
    if not m or not cfg or not cfg.get("enabled"):
        return False
    if m["kind"] == "link":
        return bool(cfg.get("link"))
    if m["kind"] in ("handle", "crypto"):
        return bool(cfg.get("handle"))
    return True


def public_method(key: str, cfg: dict) -> dict:
    m = PM_BY_KEY[key]
    out = {"key": key, "label": m["label"], "kind": m["kind"], "icons": m["icons"], "instructions": cfg.get("instructions", "")}
    if m["kind"] == "link":
        out["link"] = cfg.get("link", "")
    elif m["kind"] in ("handle", "crypto"):
        h = cfg.get("handle", "")
        out["handle"] = ("$" + h) if key in ("cashapp", "chime") else h
        if key in HANDLE_LINK and h:
            out["link"] = HANDLE_LINK[key].format(h)
    return out


def live_methods(s: dict | None = None) -> list[dict]:
    s = s or settings()
    pays = s.get("payments") or {}
    return [public_method(m["key"], pays[m["key"]]) for m in PAYMENT_METHODS if method_live(m["key"], pays.get(m["key"]))]


def public_store() -> dict:
    s = settings()
    ads = {k: v for k, v in s["ads"].items() if k != "ads_txt_extra"}
    ads["house"] = [{"title": h.get("title", ""), "image": h.get("image", ""), "placement": h.get("placement", "footer")}
                    if h.get("active", True) and h.get("image") else {"title": "", "image": "", "placement": "none"}
                    for h in ads.get("house", [])]
    return {
        "name": s["name"], "announcement": s["announcement"], "hero_eyebrow": s["hero_eyebrow"], "hero_headline": s["hero_headline"],
        "hero_sub": s["hero_sub"], "free_ship_over": float(s["free_ship_over"]), "ship_flat": float(s["ship_flat"]),
        "ship_express": float(s["ship_express"]), "big_size_fee": float(s["big_size_fee"]), "squad_tiers": s["squad_tiers"],
        "support_email": s["support_email"], "instagram": s["instagram"], "tiktok": s["tiktok"],
        "extras": s["extras"], "ads": ads, "payments": live_methods(s),
        "payment_icons": sorted({i for m in PAYMENT_METHODS for i in m["icons"]}),
    }


# ------------------------------------------------------------------ catalog

def expire_flash(ps: list[dict]) -> None:
    now = time.time()
    for p in ps:
        if p.get("flash") and p.get("flash_ends") and p["flash_ends"] < now:
            base = p.pop("flash_base", None)
            if base:
                p["price"], p["compare_at"] = base["price"], base["compare_at"]
            p["flash"], p["flash_ends"] = False, 0
            db.save_product(p)


def league_names() -> dict:
    return {l["key"]: l["name"] for l in db.leagues()}


PUBLIC_KEYS = ["slug", "name", "sport", "category", "shape", "league", "description", "design", "price", "compare_at", "featured",
               "flash", "flash_ends", "lead_days", "likes", "status", "created", "images"]


def decorate(p: dict, names: dict, now: float | None = None) -> dict:
    now = now or time.time()
    p["new"] = (now - p.get("created", 0)) < NEW_DAYS * 86400
    p["league_name"] = names.get(p.get("league") or "", "")
    return p


def sort_key(p: dict):
    return (-(p.get("sort") or 0), -(p.get("created") or 0))


def public_catalog() -> list[dict]:
    ps = db.products()
    expire_flash(ps)
    names = league_names()
    now = time.time()
    out = []
    for p in sorted(ps, key=sort_key):
        if p.get("status") != "live":
            continue
        d = {k: p.get(k) for k in PUBLIC_KEYS}
        d["league"] = d["league"] or ""
        d["images"] = d["images"] or []
        out.append(decorate(d, names, now))
    return out


def public_leagues() -> list[dict]:
    counts: dict[str, int] = {}
    for p in db.products():
        if p.get("status") == "live" and p.get("league"):
            counts[p["league"]] = counts.get(p["league"], 0) + 1
    return [{**l, "count": counts.get(l["key"], 0)} for l in db.leagues()]


# ------------------------------------------------------------------ pricing

def money(x: float) -> float:
    return round(float(x) + 1e-9, 2)


def _num(v, default=0.0) -> float:
    try:
        f = float(v)
        return f if f == f else default
    except (TypeError, ValueError):
        return default


def clean_design(d) -> dict:
    if not isinstance(d, dict):
        return {}
    out = {}
    for k, v in list(d.items())[:40]:
        if not isinstance(k, str) or len(k) > 30:
            continue
        if isinstance(v, (bool, int, float)) or v is None:
            out[k] = v
        elif isinstance(v, str):
            out[k] = v[:80]
    return out


def find_discount(code: str) -> dict | None:
    r = db.q1("SELECT data FROM discounts WHERE code=?", (code.upper(),))
    return json.loads(r["data"]) if r else None


def check_discount(code: str, subtotal: float) -> tuple[dict | None, str]:
    code = (code or "").strip().upper()
    if not code:
        return None, ""
    d = find_discount(code)
    if not d or not d.get("active"):
        return None, f"The code {code} isn't valid."
    if d.get("expires") and d["expires"] < time.time():
        return None, f"The code {code} has expired."
    if d.get("max_uses") and d.get("uses", 0) >= d["max_uses"]:
        return None, f"The code {code} has been used up."
    if d.get("min_order") and subtotal < d["min_order"]:
        return None, f"The code {code} needs an order of at least ${d['min_order']:.0f}."
    return d, ""


def discount_message(d: dict) -> str:
    if d["kind"] == "percent":
        return f"{d['code']} applied: {float(d['value']):g}% off."
    if d["kind"] == "fixed":
        return f"{d['code']} applied: ${float(d['value']):.2f} off."
    return f"{d['code']} applied: free shipping."


def price_order(body: dict, strict_code: bool = True) -> dict:
    """Server side price computation. Raises HTTPException(400) with a readable message on bad input."""
    s = settings()
    items_in = body.get("items")
    if not isinstance(items_in, list) or not items_in:
        raise HTTPException(400, "Your bag is empty.")
    if len(items_in) > 60:
        raise HTTPException(400, "That is a lot of lines. Please split it into two orders.")
    big_fee = _num(s["big_size_fee"])
    lines, qty_total, subtotal, cost = [], 0, 0.0, 0.0
    lead = 0
    for raw in items_in:
        if not isinstance(raw, dict):
            raise HTTPException(400, "Something in your bag is not valid.")
        p = db.product(str(raw.get("slug", "")))
        if not p or p.get("status") != "live":
            name = str(raw.get("name") or "An item")[:60]
            raise HTTPException(400, f"{name} is no longer available. Please remove it from your bag.")
        roster = raw.get("roster") if isinstance(raw.get("roster"), list) else []
        roster = [{"name": str(r.get("name", ""))[:20], "number": str(r.get("number", ""))[:3], "size": str(r.get("size", ""))[:10]}
                  for r in roster[:200] if isinstance(r, dict)]
        unit = _num(p["price"])
        size = str(raw.get("size") or "")[:20]
        if roster:
            qty = len(roster)
            line = sum(unit + (big_fee if r["size"] in BIG_SIZES else 0) for r in roster)
        else:
            qty = int(max(1, min(500, _num(raw.get("qty"), 1))))
            line = (unit + (big_fee if size in BIG_SIZES else 0)) * qty
        design = {**(p.get("design") or {}), **clean_design(raw.get("design"))}
        design["shape"] = p.get("shape")
        lines.append({"slug": p["slug"], "name": p["name"], "shape": p.get("shape"), "category": p.get("category"), "sport": p.get("sport"),
                      "league": p.get("league") or "", "size": size if not roster else "Team", "qty": qty, "unit": money(unit),
                      "line": money(line), "design": design, "roster": roster, "cost_each": _num(p.get("cost"))})
        qty_total += qty
        subtotal += line
        cost += _num(p.get("cost")) * qty
        lead = max(lead, int(p.get("lead_days") or 10))
    subtotal = money(subtotal)
    rate = 0
    for n, pct in sorted(s.get("squad_tiers") or []):
        if qty_total >= n:
            rate = pct
    squad = money(subtotal * rate / 100)
    after_squad = subtotal - squad

    code = str(body.get("code") or "").strip().upper()
    disc, discount, ship_free = None, 0.0, False
    if code:
        disc, err = check_discount(code, after_squad)
        if not disc:
            if strict_code:
                raise HTTPException(400, err)
            code = ""
        elif disc["kind"] == "percent":
            discount = money(after_squad * min(100, _num(disc["value"])) / 100)
        elif disc["kind"] == "fixed":
            discount = money(min(after_squad, _num(disc["value"])))
        else:
            ship_free = True
    base = after_squad - discount
    method = "express" if body.get("shipping_method") == "express" else "standard"
    if method == "express":
        shipping = 0.0 if ship_free else _num(s["ship_express"])
    else:
        shipping = 0.0 if ship_free or base >= _num(s["free_ship_over"]) else _num(s["ship_flat"])
    ex_in = body.get("extras") if isinstance(body.get("extras"), dict) else {}
    extras = []
    xs = s["extras"]
    if ex_in.get("rush") and _num(xs.get("rush_fee")) > 0:
        extras.append({"key": "rush", "label": f"Rush production ({int(_num(xs.get('rush_days'), 5))} days)", "amount": money(xs["rush_fee"])})
        lead = min(lead, int(_num(xs.get("rush_days"), 5)) or lead)
    if ex_in.get("gift") and _num(xs.get("gift_wrap_fee")) > 0:
        extras.append({"key": "gift", "label": "Gift wrap and note", "amount": money(xs["gift_wrap_fee"])})
    extras_total = sum(x["amount"] for x in extras)
    total = money(base + shipping + extras_total)
    return {
        "items": lines, "qty": qty_total, "subtotal": subtotal, "squad_rate": rate, "squad_discount": squad,
        "discount": money(discount), "discount_code": code if disc else "", "shipping": money(shipping), "shipping_method": method,
        "extras": extras, "extras_total": money(extras_total), "total": total, "cost": money(cost), "lead_days": lead,
    }


def public_quote(qt: dict) -> dict:
    out = {k: v for k, v in qt.items() if k not in ("cost", "items", "lead_days")}
    out["items"] = [{"slug": i["slug"], "name": i["name"], "qty": i["qty"], "unit": i["unit"], "line": i["line"]} for i in qt["items"]]
    return out


# ------------------------------------------------------------------ orders

def new_code(prefix: str = "SF") -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        c = prefix + "-" + "".join(secrets.choice(alphabet) for _ in range(6))
        if not db.q1("SELECT 1 FROM orders WHERE code=?", (c,)):
            return c


def load_order(code: str) -> dict | None:
    r = db.q1("SELECT data FROM orders WHERE code=?", (code.upper(),))
    return json.loads(r["data"]) if r else None


def save_order(o: dict) -> None:
    db.run("INSERT INTO orders(code,created,email,status,demo,data) VALUES(?,?,?,?,?,?) "
           "ON CONFLICT(code) DO UPDATE SET email=excluded.email, status=excluded.status, data=excluded.data",
           (o["code"], o["created"], o["email"].lower(), o["status"], 1 if o.get("demo") else 0, json.dumps(o)))


def all_orders(since: float = 0) -> list[dict]:
    return [json.loads(r["data"]) for r in db.q("SELECT data FROM orders WHERE created>=? ORDER BY created DESC", (since,))]


def order_items_with_extras(qt: dict) -> list[dict]:
    items = []
    for i in qt["items"]:
        it = {k: v for k, v in i.items() if k != "cost_each"}
        items.append(it)
    for x in qt["extras"]:
        items.append({"extra": x["key"], "name": x["label"], "qty": 1, "unit": x["amount"], "line": x["amount"], "size": "", "design": {}})
    return items


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def referral_code_for(name: str) -> str:
    base = re.sub(r"[^A-Z]", "", (name or "").upper().split(" ")[0])[:8] or "FRIEND"
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        c = f"{base}-{''.join(secrets.choice(alphabet) for _ in range(4))}"
        if not find_discount(c):
            return c


def create_order(body: dict, demo: bool = False, created: float | None = None, code: str | None = None) -> dict:
    s = settings()
    cust_in = body.get("customer") if isinstance(body.get("customer"), dict) else {}
    cust = {k: str(cust_in.get(k) or "").strip()[:160] for k in ("name", "email", "phone", "address1", "address2", "city", "region", "postal", "country")}
    if not cust["name"] or not EMAIL_RE.match(cust["email"]) or not cust["address1"] or not cust["city"]:
        raise HTTPException(400, "Please fill in your name, a valid email and your shipping address.")
    pay_key = str(body.get("payment") or "")
    pays = s.get("payments") or {}
    if not demo and not method_live(pay_key, pays.get(pay_key)):
        raise HTTPException(400, "That payment method is not available. Please choose another one.")
    qt = price_order(body, strict_code=True)
    now = created or time.time()
    o = {
        "code": code or new_code("DEMO" if demo else "SF"), "created": now, "email": cust["email"].lower(), "customer": cust,
        "status": "awaiting_payment", "items": order_items_with_extras(qt), "qty": qt["qty"], "subtotal": qt["subtotal"],
        "squad_rate": qt["squad_rate"], "squad_discount": qt["squad_discount"], "discount": qt["discount"],
        "discount_code": qt["discount_code"], "shipping": qt["shipping"], "shipping_method": qt["shipping_method"],
        "extras_total": qt["extras_total"], "total": qt["total"], "cost": qt["cost"], "payment": pay_key,
        "payment_label": PM_BY_KEY.get(pay_key, {}).get("label", pay_key or "Not chosen"), "payment_ref": "",
        "customer_note": str(body.get("note") or "")[:600], "admin_note": "", "carrier": "", "tracking": "",
        "history": [{"status": "awaiting_payment", "at": now, "note": "Order placed"}],
        "eta": now + qt["lead_days"] * 86400, "lead_days": qt["lead_days"], "demo": demo, "referral_code": "", "referral_percent": 0,
    }
    with db.tx() as c:
        if qt["discount_code"]:
            r = c.execute("SELECT data FROM discounts WHERE code=?", (qt["discount_code"],)).fetchone()
            if r:
                d = json.loads(r["data"])
                d["uses"] = int(d.get("uses", 0)) + 1
                c.execute("UPDATE discounts SET data=? WHERE code=?", (json.dumps(d), d["code"]))
        xs = s["extras"]
        if not demo and xs.get("referral_enabled"):
            rc = referral_code_for(cust["name"])
            pct = int(max(1, min(50, _num(xs.get("referral_percent"), 10))))
            c.execute("INSERT INTO discounts(code,data) VALUES(?,?)", (rc, json.dumps(
                {"code": rc, "kind": "percent", "value": pct, "min_order": 0, "max_uses": 25, "expires": 0, "active": True,
                 "uses": 0, "created": now, "referral": True, "owner_order": o["code"]})))
            o["referral_code"], o["referral_percent"] = rc, pct
        c.execute("INSERT INTO orders(code,created,email,status,demo,data) VALUES(?,?,?,?,?,?)",
                  (o["code"], o["created"], o["email"], o["status"], 1 if demo else 0, json.dumps(o)))
    return o


def order_view(o: dict) -> dict:
    o = dict(o)
    o["status_label"] = STATUS_LABEL.get(o["status"], o["status"])
    return o


def set_status(o: dict, status: str, note: str = "") -> None:
    if status not in STATUS_LABEL or status == o["status"]:
        return
    o["status"] = status
    o["history"].append({"status": status, "at": time.time(), "note": note})


def payment_for_order(o: dict) -> dict | None:
    s = settings()
    cfg = (s.get("payments") or {}).get(o.get("payment"))
    if o.get("payment") in PM_BY_KEY and cfg and cfg.get("enabled"):
        return public_method(o["payment"], cfg)
    if o.get("payment") in PM_BY_KEY:
        m = PM_BY_KEY[o["payment"]]
        return {"key": m["key"], "label": m["label"], "kind": "manual", "icons": m["icons"],
                "instructions": "This payment option was switched off. Contact us and we will help you pay another way."}
    return None
