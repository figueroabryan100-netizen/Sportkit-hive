"""Local helper "agents": autopilot, design lab and vendor scouts.

Everything here is deterministic, local and needs no external service or secret. The heuristics work from the
store's own data: product designs and prices, views and bag adds from /api/event, likes and paid orders.
"""
from __future__ import annotations

import colorsys
import hashlib
import json
import random
import re
import time
import urllib.parse
from collections import Counter

from fastapi import HTTPException

from . import db, shop

HOUR = 3600
DAY = 86400


def now() -> float:
    return time.time()


# ================================================================== colors

def rgb(h: str) -> tuple[float, float, float]:
    h = (h or "#000000").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return (0.0, 0.0, 0.0)


def hexc(r: float, g: float, b: float) -> str:
    return "#" + "".join(f"{max(0, min(255, round(x * 255))):02x}" for x in (r, g, b))


def lum(h: str) -> float:
    def ch(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb(h)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a: str, b: str) -> float:
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def hls(h: str) -> tuple[float, float, float]:
    return colorsys.rgb_to_hls(*rgb(h))


HUES = [(15, "Crimson"), (35, "Ember"), (50, "Amber"), (66, "Gold"), (95, "Volt"), (150, "Emerald"), (178, "Teal"), (198, "Aqua"),
        (222, "Sky"), (248, "Cobalt"), (278, "Indigo"), (308, "Violet"), (338, "Magenta"), (361, "Rose")]


def color_name(h: str) -> str:
    hh, l, s = hls(h)
    if l < 0.16:
        return "Midnight"
    if l > 0.88:
        return "Ice"
    if s < 0.14:
        return "Graphite" if l < 0.5 else "Silver"
    deg = hh * 360
    return next(n for lim, n in HUES if deg < lim)


def palette_pool() -> list[tuple[str, str, str]]:
    """Palettes found in the store's own designs and league colors, most liked first."""
    seen, out = set(), []
    for p in sorted(db.products(), key=lambda p: -(p.get("likes") or 0)):
        d = p.get("design") or {}
        t = (d.get("primary"), d.get("secondary"), d.get("accent"))
        if all(isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c) for c in t) and t not in seen:
            seen.add(t)
            out.append(t)
    for l in db.leagues():
        t = tuple(l.get("colors") or [])
        if len(t) == 3 and t not in seen:
            seen.add(t)
            out.append(t)
    return out or [("#04282e", "#c8f53c", "#ffffff"), ("#ff5a47", "#04282e", "#c8f53c"), ("#2ee6d6", "#04282e", "#ffffff")]


def _rng(*parts) -> random.Random:
    return random.Random(int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:12], 16))


# ================================================================== product changes shared with admin

def base_name(name: str) -> str:
    return re.sub(r"\s*\([^)]*\)\s*$", "", name or "").strip()


def make_colorways(p: dict, count: int, status: str = "live") -> list[dict]:
    pool = palette_pool()
    d0 = p.get("design") or {}
    cur = (d0.get("primary"), d0.get("secondary"), d0.get("accent"))
    root = base_name(p["name"])
    taken = {x["name"] for x in db.products()}
    used = {cur}
    for x in db.products():
        if base_name(x["name"]) == root:
            xd = x.get("design") or {}
            used.add((xd.get("primary"), xd.get("secondary"), xd.get("accent")))
    rnd = _rng(p["slug"], len(taken), now() // DAY)
    cands = [t for t in pool if t not in used and contrast(t[0], t[1]) >= 1.8]
    head, tail = cands[:40], cands[40:]
    rnd.shuffle(head)
    cands = head + tail
    made = []
    for pal in cands:
        if len(made) >= count:
            break
        nm = f"{color_name(pal[0])} {color_name(pal[1])}" if color_name(pal[0]) != color_name(pal[1]) else color_name(pal[0])
        name = f"{root} ({nm})"
        if name in taken:
            continue
        d = dict(d0)
        d["primary"], d["secondary"], d["accent"] = pal
        if "sleeve" in d:
            d["sleeve"] = pal[0]
        q = {k: v for k, v in p.items() if k not in ("flash_base",)}
        q.update({"slug": db.unique_slug(name), "name": name, "design": d, "status": status, "created": now(), "likes": 0,
                  "featured": False, "flash": False, "flash_ends": 0, "images": [], "sort": 0, "remix_of": p["slug"]})
        if q.get("compare_at") and q["compare_at"] <= q["price"]:
            q["compare_at"] = 0
        db.save_product(q)
        taken.add(name)
        made.append(q)
    return made


def start_flash(p: dict, percent: float, hours: float) -> None:
    pct = max(1.0, min(90.0, percent))
    hours = max(1.0, min(720.0, hours))
    base = p.get("flash_base") or {"price": p["price"], "compare_at": p.get("compare_at") or 0}
    p["flash_base"] = base
    p["compare_at"] = max(base["compare_at"], base["price"])
    p["price"] = max(0.5, round(base["price"] * (1 - pct / 100), 2))
    p["flash"] = True
    p["flash_ends"] = round(now() + hours * HOUR)


def end_flash(p: dict) -> None:
    base = p.pop("flash_base", None)
    if base:
        p["price"], p["compare_at"] = base["price"], base["compare_at"]
    p["flash"], p["flash_ends"] = False, 0


# ================================================================== autopilot

def _signals() -> tuple[list[dict], Counter]:
    ps = db.products(include_stats=True)
    units = Counter()
    for o in shop.all_orders():
        if o["status"] in shop.PAID:
            for i in o["items"]:
                if not i.get("extra"):
                    units[i["slug"]] += i["qty"]
    return ps, units


def autopilot_state() -> dict:
    s = shop.settings()["autopilot"]
    rows = db.jrows("suggestions", "id DESC")
    open_ = [r for r in rows if r.get("state") == "open"]
    done = sorted([r for r in rows if r.get("state") != "open"], key=lambda r: -(r.get("done") or 0))[:80]
    return {"settings": s, "last": db.kv_get("autopilot_last", 0), "suggestions": open_ + done}


def _recent_keys(table: str, days: int = 14) -> set:
    keys = set()
    for r in db.jrows(table):
        if r.get("state") == "open" or (r.get("done") or 0) > now() - days * DAY:
            keys.add((r.get("kind") or r.get("agent_key"), r.get("slug")))
    return keys


def autopilot_ideas(s: dict) -> list[dict]:
    ps, units = _signals()
    live = [p for p in ps if p.get("status") == "live"]
    if not live:
        return []
    taken = _recent_keys("suggestions")
    likes_sorted = sorted((p.get("likes") or 0) for p in live)
    p90 = likes_sorted[int(len(likes_sorted) * 0.9)] if likes_sorted else 0
    p98 = likes_sorted[int(len(likes_sorted) * 0.98)] if likes_sorted else 0
    tracking_days = (now() - (db.kv_get("installed", now()) or now())) / DAY
    ideas = []

    for p in live:
        if p.get("featured") or ("feature", p["slug"]) in taken:
            continue
        bags, lk = p.get("bags", 0), p.get("likes", 0) or 0
        if bags >= 3 or (lk >= p90 and lk >= 50):
            why = (f"Added to bags {bags} times" if bags >= 3 else f"Liked by {lk} shoppers, more than 90% of your catalog") + \
                  ", but it is not on the home page yet."
            ideas.append({"kind": "feature", "slug": p["slug"], "title": f"Feature {p['name']} on the home page", "why": why,
                          "score": bags * 6 + lk * 0.2 + units[p["slug"]] * 10})
    if s.get("flash"):
        for p in live:
            if p.get("flash") or ("flash", p["slug"]) in taken:
                continue
            views, bags = p.get("views", 0), p.get("bags", 0)
            if views >= s["retire_views"] and bags == 0:
                ideas.append({"kind": "flash", "slug": p["slug"], "title": f"Run a 20% flash sale on {p['name']} for 48 hours",
                              "why": f"{views} views but nobody added it to a bag. A short deal often gets people over the line.",
                              "score": views * 0.5})
    if s.get("remix"):
        for p in live:
            if ("remix", p["slug"]) in taken or p.get("remix_of"):
                continue
            u, lk = units[p["slug"]], p.get("likes", 0) or 0
            if u >= 3 or (lk >= p98 and lk >= 120):
                why = f"{u} sold already." if u >= 3 else f"One of your most liked designs ({lk} likes)."
                ideas.append({"kind": "remix", "slug": p["slug"], "title": f"Add 2 new colorways of {p['name']}",
                              "why": why + " Fresh colors of a proven design usually sell well.", "score": u * 12 + lk * 0.1})
    if tracking_days >= s["retire_days"]:
        for p in live:
            if p.get("featured") or ("retire", p["slug"]) in taken:
                continue
            age = (now() - (p.get("created") or now())) / DAY
            if age >= s["retire_days"] and p.get("views", 0) < max(3, s["retire_views"] // 10) and units[p["slug"]] == 0 and p.get("bags", 0) == 0:
                ideas.append({"kind": "retire", "slug": p["slug"], "title": f"Hide {p['name']}",
                              "why": f"Live for {int(age)} days with {p.get('views', 0)} views and no sales. Hiding it keeps your shop fresh. You can bring it back any time.",
                              "score": age * 0.05})
    order = {"feature": 0, "flash": 1, "remix": 2, "retire": 3}
    ideas.sort(key=lambda x: (order[x["kind"]], -x["score"]))
    # mix the kinds so one kind does not use up every slot
    out, by_kind = [], {}
    for i in ideas:
        by_kind.setdefault(i["kind"], []).append(i)
    while any(by_kind.values()) and len(out) < s["max_changes"]:
        for k in ("feature", "flash", "remix", "retire"):
            if by_kind.get(k) and len(out) < s["max_changes"]:
                out.append(by_kind[k].pop(0))
    return out


def _apply_suggestion(sg: dict) -> None:
    p = db.product(sg.get("slug") or "")
    if not p:
        raise HTTPException(400, "That product is gone, so this idea cannot be applied.")
    if sg["kind"] == "feature":
        p["featured"] = True
    elif sg["kind"] == "flash":
        start_flash(p, 20, 48)
    elif sg["kind"] == "retire":
        p["status"] = "draft"
    elif sg["kind"] == "remix":
        make_colorways(p, 2, "live")
        return
    db.save_product(p)


def autopilot_run(manual: bool = False) -> dict:
    s = shop.settings()["autopilot"]
    db.kv_set("autopilot_last", now())
    if s["mode"] == "off" and not manual:
        return {"found": 0, "applied": 0}
    ideas = autopilot_ideas(s)
    applied = 0
    for i in ideas:
        sg = {"kind": i["kind"], "slug": i["slug"], "title": i["title"], "why": i["why"], "state": "open", "created": now(), "done": 0}
        if s["mode"] == "auto":
            try:
                _apply_suggestion(sg)
                sg.update(state="done", done=now(), auto=True)
                applied += 1
            except HTTPException:
                sg.update(state="dismissed", done=now())
        db.jput("suggestions", sg)
    return {"found": len(ideas), "applied": applied}


def autopilot_act(sid: int, action: str) -> dict:
    sg = db.jget("suggestions", sid)
    if not sg:
        raise HTTPException(404, "That idea was not found.")
    if sg.get("state") != "open":
        raise HTTPException(400, "That idea was already handled.")
    if action == "apply":
        _apply_suggestion(sg)
        sg.update(state="done", done=now())
    elif action == "dismiss":
        sg.update(state="dismissed", done=now())
    else:
        raise HTTPException(400, "Unknown action.")
    db.jput("suggestions", sg)
    return {"ok": True, "suggestion": sg}


# ================================================================== design lab

LAB_AGENTS = [
    {"key": "color", "name": "Palette agent", "role": "Fixes weak color contrast and tunes palettes so designs read well on screen and on the field."},
    {"key": "pattern", "name": "Pattern agent", "role": "Swaps plain or tired patterns for the ones your shoppers like most in that category."},
    {"key": "fit", "name": "Fit and trim agent", "role": "Tunes collars, sleeves, outlines and trim colors so the cut looks sharp."},
    {"key": "finish", "name": "Finish agent", "role": "Matches print finish, badge and preview lighting to the price point of the product."},
    {"key": "trend", "name": "Trend agent", "role": "Borrows what is working: the colors and lettering of your most liked products."},
]
LAB_KEYS = {a["key"] for a in LAB_AGENTS}


def lab_settings() -> dict:
    return {"mode": "suggest", "per_run": 5, **(db.kv_get("lab_settings", {}) or {})}


def lab_agents() -> list[dict]:
    st = db.kv_get("lab_agents", {}) or {}
    return [{**a, "enabled": st.get(a["key"], {}).get("enabled", True), "last_run": st.get(a["key"], {}).get("last_run", 0),
             "proposals_total": st.get(a["key"], {}).get("proposals_total", 0)} for a in LAB_AGENTS]


def lab_state() -> dict:
    rows = db.jrows("proposals", "id DESC")
    open_ = [r for r in rows if r.get("state") == "open"]
    done = sorted([r for r in rows if r.get("state") != "open"], key=lambda r: -(r.get("done") or 0))[:60]
    return {"agents": lab_agents(), "proposals": open_ + done, "settings": lab_settings(), "last_run": db.kv_get("lab_last", 0)}


def lab_toggle(key: str, enabled: bool) -> dict:
    if key not in LAB_KEYS:
        raise HTTPException(404, "That agent was not found.")
    st = db.kv_get("lab_agents", {}) or {}
    st.setdefault(key, {})["enabled"] = enabled
    db.kv_set("lab_agents", st)
    return {"ok": True}


def _cat_stats(live: list[dict]) -> dict:
    out = {}
    for p in live:
        out.setdefault(p.get("category"), []).append(p)
    for k in out:
        out[k].sort(key=lambda p: -(p.get("likes") or 0))
    return out


def _idea_color(p: dict, d: dict, ctx: dict) -> tuple[str, str, dict] | None:
    pri, sec, acc = d.get("primary", "#04282e"), d.get("secondary", "#c8f53c"), d.get("accent", "#ffffff")
    if contrast(pri, sec) < 1.7:
        h0 = hls(pri)[0]
        best = None
        for pal in ctx["pool"][:120]:
            if contrast(pal[0], pal[1]) < 3:
                continue
            dist = min(abs(hls(pal[0])[0] - h0), 1 - abs(hls(pal[0])[0] - h0))
            if best is None or dist < best[0]:
                best = (dist, pal)
        if best:
            pal = best[1]
            return (f"Stronger contrast for {p['name']}",
                    f"The main and trim colors are very close (contrast {contrast(pri, sec):.1f} to 1), so the design looks flat in photos. "
                    f"This keeps a similar main color and adds a trim that stands out ({contrast(pal[0], pal[1]):.1f} to 1).",
                    {"primary": pal[0], "secondary": pal[1], "accent": pal[2]})
    if contrast(pri, acc) < 1.6:
        new = "#ffffff" if contrast(pri, "#ffffff") >= contrast(pri, "#111111") else "#111111"
        return (f"Readable details on {p['name']}",
                f"Names, numbers and logos use a color that almost disappears on the main color (contrast {contrast(pri, acc):.1f} to 1). "
                f"Switching the details to {'white' if new == '#ffffff' else 'near black'} makes them pop.", {"accent": new})
    _, l, s = hls(pri)
    if 0.25 < l < 0.75 and s < 0.18:
        pal = next((x for x in ctx["pool"][:60] if hls(x[0])[2] > 0.5 and contrast(x[0], x[1]) >= 2.5), None)
        if pal:
            return (f"Brighter palette for {p['name']}",
                    "The main color is a muted grey tone. Bright, saturated kits get more clicks in your shop, so this borrows a palette from one of your most liked designs.",
                    {"primary": pal[0], "secondary": pal[1], "accent": pal[2]})
    return None


def _idea_pattern(p: dict, d: dict, ctx: dict) -> tuple[str, str, dict] | None:
    peers = [x for x in ctx["cats"].get(p.get("category"), []) if x["slug"] != p["slug"]][:15]
    counts = Counter((x.get("design") or {}).get("pattern") for x in peers if (x.get("design") or {}).get("pattern"))
    cur = d.get("pattern", "solid")
    top = [k for k, _ in counts.most_common() if k != cur]
    if not top:
        return None
    if cur == "solid" or counts.get(cur, 0) == 0:
        new = top[0]
        return (f"Try {new} on {p['name']}",
                f"{'A plain solid body' if cur == 'solid' else 'The ' + cur + ' pattern'} is rare among your most liked {p.get('category', 'products').lower()}. "
                f"{new.capitalize()} shows up in {counts[new]} of the top {len(peers)}, so it is a safe bet.", {"pattern": new})
    return None


def _idea_fit(p: dict, d: dict, ctx: dict) -> tuple[str, str, dict] | None:
    shape = p.get("shape") or ""
    if re.match(r"^(jersey|hoodie)", shape):
        if d.get("sleeve", d.get("primary")) == d.get("primary") and contrast(d.get("primary", "#000"), d.get("secondary", "#fff")) >= 1.8:
            return (f"Contrast sleeves for {p['name']}",
                    "The sleeves are the same color as the body. Trim colored sleeves frame the chest and number and make the kit look more athletic.",
                    {"sleeve": d.get("secondary")})
        if shape == "jersey" and d.get("collar", "crew") == "crew" and p.get("sport") in ("Soccer", "Volleyball"):
            return (f"V neck collar for {p['name']}", "Most modern match shirts in this sport use a V neck. It reads as a newer, sharper cut.", {"collar": "v"})
    if not d.get("outline") and contrast(d.get("primary", "#000"), d.get("accent", "#fff")) < 3:
        return (f"Outlined lettering on {p['name']}",
                "The lettering color is close to the main color. A thin outline in the trim color keeps names and numbers easy to read from a distance.",
                {"outline": True})
    return None


def _idea_finish(p: dict, d: dict, ctx: dict) -> tuple[str, str, dict] | None:
    price = p.get("price") or 0
    fin = d.get("finish", "matte")
    if price >= ctx["price_p75"] and fin == "matte":
        return (f"Premium finish for {p['name']}",
                f"At ${price:.2f} this is one of your higher priced pieces, but it uses a plain matte print. A metallic finish matches the price.",
                {"finish": "metallic"})
    if price <= ctx["price_p25"] and fin in ("holo", "metallic"):
        return (f"Cleaner finish for {p['name']}", "A flashy finish on a budget piece can look cheap in photos. A gloss print looks clean and premium.", {"finish": "gloss"})
    if re.match(r"^(jersey)", p.get("shape") or "") and d.get("patch", "none") == "none" and p.get("league"):
        return (f"Add a badge to {p['name']}", "League kits with a chest badge look more official and get more likes in your shop.", {"patch": "star"})
    if d.get("lighting", "studio") == "studio" and p.get("category") in ("Balls", "Footwear") and ctx["rnd"].random() < 0.5:
        return (f"Stadium lighting for {p['name']}", "Game day lighting shows off the shine of balls and boots better than the flat studio light.", {"lighting": "stadium"})
    return None


def _idea_trend(p: dict, d: dict, ctx: dict) -> tuple[str, str, dict] | None:
    peers = [x for x in ctx["cats"].get(p.get("category"), []) if x["slug"] != p["slug"]]
    if not peers:
        return None
    top = peers[0]
    td = top.get("design") or {}
    if (p.get("likes") or 0) >= (top.get("likes") or 0) * 0.6:
        return None
    change = {}
    if td.get("font") and td.get("font") != d.get("font"):
        change["font"] = td["font"]
    if td.get("pattern") and td.get("pattern") != d.get("pattern"):
        change["pattern"] = td["pattern"]
    if not change:
        change = {"primary": td.get("primary"), "secondary": td.get("secondary"), "accent": td.get("accent")}
        if change["primary"] == d.get("primary"):
            return None
    cat = (p.get("category") or "products").lower()
    what = " and ".join("lettering" if k == "font" else k for k in change if k in ("font", "pattern")) or "colors"
    return (f"Borrow the look of {top['name']}",
            f"{top['name']} is the most liked design in {cat} ({top.get('likes', 0)} likes). This gives {p['name']} the same {what}.",
            change)


LAB_FUNCS = {"color": _idea_color, "pattern": _idea_pattern, "fit": _idea_fit, "finish": _idea_finish, "trend": _idea_trend}


def lab_run(manual: bool = False) -> dict:
    s = lab_settings()
    st = db.kv_get("lab_agents", {}) or {}
    runs = int(db.kv_get("lab_runs", 0) or 0) + 1
    db.kv_set("lab_runs", runs)
    db.kv_set("lab_last", now())
    agents = [a for a in lab_agents() if a["enabled"]]
    if not agents:
        return {"found": 0, "applied": 0}
    live = [p for p in db.products(include_stats=True) if p.get("status") == "live"]
    if not live:
        return {"found": 0, "applied": 0}
    recent = {r.get("slug") for r in db.jrows("proposals") if r.get("state") == "open" or (r.get("done") or 0) > now() - 30 * DAY}
    prices = sorted(p.get("price") or 0 for p in live)
    ctx = {"pool": palette_pool(), "cats": _cat_stats(live), "price_p75": prices[int(len(prices) * 0.75)],
           "price_p25": prices[int(len(prices) * 0.25)], "rnd": _rng("lab", runs)}
    # weakest first: few likes and views compared with the catalog, rotated per run so each run looks at new products
    cands = [p for p in live if p["slug"] not in recent]
    rnd = _rng("lab-order", runs)
    cands.sort(key=lambda p: (p.get("likes") or 0) + (p.get("views") or 0) * 0.5 + rnd.random() * 40)
    found, applied = 0, 0
    ai = runs % len(agents)
    for p in cands:
        if found >= s["per_run"]:
            break
        d = {**(p.get("design") or {}), "shape": p.get("shape")}
        for k in range(len(agents)):
            a = agents[(ai + k) % len(agents)]
            idea = LAB_FUNCS[a["key"]](p, d, ctx)
            if not idea:
                continue
            title, why, change = idea
            after = {**d, **{k2: v for k2, v in change.items() if v is not None}}
            if after == d:
                continue
            pr = {"agent_key": a["key"], "slug": p["slug"], "product_name": p["name"], "shape": p.get("shape"), "title": title, "why": why,
                  "before": {"design": d}, "after": {"design": after}, "state": "open", "created": now(), "done": 0}
            if s["mode"] == "auto":
                q = db.product(p["slug"])
                if q:
                    q["design"] = {**(q.get("design") or {}), **change}
                    db.save_product(q)
                    pr.update(state="applied", done=now(), auto=True)
                    applied += 1
            db.jput("proposals", pr)
            ag = st.setdefault(a["key"], {})
            ag["proposals_total"] = ag.get("proposals_total", 0) + 1
            found += 1
            ai = (ai + k + 1) % len(agents)
            break
    for a in agents:
        st.setdefault(a["key"], {})["last_run"] = now()
    db.kv_set("lab_agents", st)
    return {"found": found, "applied": applied}


def lab_act(pid: int, action: str) -> dict:
    pr = db.jget("proposals", pid)
    if not pr:
        raise HTTPException(404, "That idea was not found.")
    if pr.get("state") != "open":
        raise HTTPException(400, "That idea was already handled.")
    if action == "apply":
        p = db.product(pr["slug"])
        if not p:
            raise HTTPException(400, "That product is gone, so this idea cannot be applied.")
        before, after = pr["before"]["design"], pr["after"]["design"]
        change = {k: v for k, v in after.items() if before.get(k) != v}
        p["design"] = {**(p.get("design") or {}), **change}
        db.save_product(p)
        pr.update(state="applied", done=now())
    elif action == "dismiss":
        pr.update(state="dismissed", done=now())
    else:
        raise HTTPException(400, "Unknown action.")
    db.jput("proposals", pr)
    return {"ok": True}


# ================================================================== vendor scouts

SCOUTS = [
    {"key": "reddit", "name": "Reddit scout", "channel": "reddit", "how": "links",
     "role": "Prepares Reddit searches for supplier tips in sportswear, teamwear and print on demand communities."},
    {"key": "web", "name": "Web scout", "channel": "web", "how": "links",
     "role": "Prepares web searches for custom teamwear makers that match what you are looking for."},
    {"key": "factory", "name": "Factory finder", "channel": "web", "how": "links",
     "role": "Searches the big sportswear making hubs (Sialkot, Guangzhou, Porto, Istanbul) for factories."},
    {"key": "marketplace", "name": "Marketplace scout", "channel": "marketplace", "how": "links",
     "role": "Prepares searches on Alibaba, Made in China, Etsy and similar marketplaces."},
    {"key": "whatsapp", "name": "WhatsApp reader", "channel": "whatsapp", "how": "paste",
     "role": "Reads supplier groups you export from WhatsApp and picks out vendors, prices and contacts."},
    {"key": "telegram", "name": "Telegram and Discord reader", "channel": "telegram", "how": "paste",
     "role": "Reads messages you copy from Telegram channels or Discord servers about suppliers."},
    {"key": "facebook", "name": "Facebook groups reader", "channel": "facebook", "how": "paste",
     "role": "Reads posts and comments you copy from Facebook groups for team sports and apparel."},
    {"key": "email", "name": "Inbox reader", "channel": "email", "how": "paste",
     "role": "Reads supplier emails and price lists you paste in, and adds the senders to your pipeline."},
    {"key": "followup", "name": "Follow up keeper", "channel": "pipeline", "how": "crm",
     "role": "Watches your pipeline and sets a follow up date for vendors who went quiet."},
    {"key": "scorer", "name": "Fit scorer", "channel": "crm", "how": "crm",
     "role": "Re-scores every vendor against what you are looking for, so the best fits rise to the top."},
]
SCOUT_BY_KEY = {a["key"]: a for a in SCOUTS}
STAGES = ["new", "contacted", "talking", "sampling", "partner", "passed"]
STAGE_LABEL = {"new": "New", "contacted": "Contacted", "talking": "Talking", "sampling": "Sampling", "partner": "Partner", "passed": "Passed"}


def scout_settings() -> dict:
    return {"wishlist": "", "auto_run": False, "min_score": 40, **(db.kv_get("scout_settings", {}) or {})}


def _wish_terms(wishlist: str) -> list[str]:
    words = re.findall(r"[a-z][a-z-]{2,}", (wishlist or "").lower())
    stop = {"and", "the", "for", "with", "low", "minimum", "order", "ships", "ship", "to", "from", "that", "our", "usa", "per", "any", "good", "quality"}
    return [w for w in words if w not in stop][:12]


def scout_tasks(a: dict, wishlist: str) -> list[dict]:
    terms = _wish_terms(wishlist)
    prods = [PRODUCT_WORDS[t] for t in terms if t in PRODUCT_WORDS and PRODUCT_WORDS[t] != "sublimation printing"] or ["team jerseys", "team uniforms", "sports socks"]
    prods = list(dict.fromkeys(prods))[:3]
    enc = urllib.parse.quote_plus
    out = []
    if a["key"] == "reddit":
        for p in prods:
            out.append({"title": f"Reddit: {p} supplier recommendations",
                        "url": f"https://www.reddit.com/search/?q={enc(p + ' supplier manufacturer recommendation')}"})
        out.append({"title": "Reddit: r/printondemand teamwear suppliers", "url": "https://www.reddit.com/r/printondemand/search/?q=" + enc("sportswear supplier") + "&restrict_sr=1"})
    elif a["key"] == "web":
        for p in prods:
            out.append({"title": f"Web: custom {p} manufacturer low MOQ", "url": f"https://duckduckgo.com/?q={enc('custom ' + p + ' manufacturer low MOQ')}"})
    elif a["key"] == "factory":
        for hub in ("Sialkot", "Guangzhou", "Porto", "Istanbul"):
            out.append({"title": f"{hub}: {prods[0]} factories", "url": f"https://duckduckgo.com/?q={enc(prods[0] + ' factory ' + hub)}"})
    elif a["key"] == "marketplace":
        for p in prods[:2]:
            out.append({"title": f"Alibaba: {p}", "url": f"https://www.alibaba.com/trade/search?SearchText={enc(p)}"})
            out.append({"title": f"Made in China: {p}", "url": f"https://www.made-in-china.com/products-search/hot-china-products/{enc(p).replace('+', '_')}.html"})
        out.append({"title": f"Etsy: custom {prods[0]}", "url": f"https://www.etsy.com/search?q={enc('custom ' + prods[0])}"})
    return [{**t, "agent_key": a["key"]} for t in out]


def scouts_agents_view() -> list[dict]:
    st = db.kv_get("scout_agents", {}) or {}
    return [{**a, "status": st.get(a["key"], {}).get("status", "active"), "last_run": st.get(a["key"], {}).get("last_run", 0),
             "found_total": st.get(a["key"], {}).get("found_total", 0), "last_note": st.get(a["key"], {}).get("last_note", "")} for a in SCOUTS]


def scouts_state() -> dict:
    s = scout_settings()
    tasks = [t for a in SCOUTS if a["how"] == "links" for t in scout_tasks(a, s["wishlist"])]
    return {"agents": scouts_agents_view(), "leads": db.jrows("leads", "id DESC"), "tasks": tasks, "settings": s,
            "last_run": db.kv_get("scouts_last", 0)}


def scouts_toggle(key: str, status: str) -> dict:
    if key not in SCOUT_BY_KEY:
        raise HTTPException(404, "That scout was not found.")
    st = db.kv_get("scout_agents", {}) or {}
    st.setdefault(key, {})["status"] = status
    db.kv_set("scout_agents", st)
    return {"ok": True}


def _agent_note(key: str, note: str, found: int = 0) -> None:
    st = db.kv_get("scout_agents", {}) or {}
    a = st.setdefault(key, {})
    a["last_run"] = now()
    a["last_note"] = note
    a["found_total"] = a.get("found_total", 0) + found
    db.kv_set("scout_agents", st)


def scouts_run(agent_key: str | None = None) -> dict:
    s = scout_settings()
    view = {a["key"]: a for a in scouts_agents_view()}
    keys = [agent_key] if agent_key else [a["key"] for a in SCOUTS]
    notes = []
    for k in keys:
        a = view.get(k)
        if not a:
            raise HTTPException(404, "That scout was not found.")
        if a["status"] == "paused" or a["how"] == "paste":
            continue
        if a["how"] == "links":
            n = len(scout_tasks(a, s["wishlist"]))
            note = f"Prepared {n} searches from your wish list. Open them, copy what looks promising and paste it here."
            _agent_note(k, note)
            if agent_key:
                notes.append(f"{a['name']}: {note}")
        elif k == "followup":
            changed = 0
            for l in db.jrows("leads"):
                last = max([e.get("ts", 0) for e in l.get("events", [])] or [l.get("created", 0)])
                if l.get("stage") in ("contacted", "talking", "sampling") and not l.get("follow_up_at") and last < now() - 4 * DAY:
                    l["follow_up_at"] = round(now() + DAY)
                    l["next_step"] = l.get("next_step") or "Send a friendly follow up"
                    db.jput("leads", l)
                    changed += 1
            note = f"Set a follow up for {changed} quiet {'vendor' if changed == 1 else 'vendors'}." if changed else "Every active vendor has a next step. Nothing to do."
            _agent_note(k, note)
            notes.append(note)
        elif k == "scorer":
            leads = db.jrows("leads")
            for l in leads:
                l["score"] = score_lead(l, s["wishlist"])
                db.jput("leads", l)
            note = f"Re-scored {len(leads)} {'vendor' if len(leads) == 1 else 'vendors'} against your wish list." if leads else "No vendors to score yet."
            _agent_note(k, note)
            notes.append(note)
    db.kv_set("scouts_last", now())
    if not agent_key:
        notes.insert(0, "Live web search is not available on this server, so the search scouts prepared links for you. Open them, then paste what you find into a reader.")
    return {"found": 0, "notes": notes}


# ---------------------------------------------------------------- paste parsing

PRODUCT_WORDS = {
    "jersey": "jerseys", "jerseys": "jerseys", "kit": "kits", "kits": "kits", "uniform": "uniforms", "uniforms": "uniforms",
    "teamwear": "teamwear", "sock": "socks", "socks": "socks", "shorts": "shorts", "ball": "balls", "balls": "balls",
    "football": "balls", "cap": "caps", "caps": "caps", "hat": "caps", "hats": "caps", "beanie": "beanies", "beanies": "beanies",
    "hoodie": "hoodies", "hoodies": "hoodies", "tracksuit": "tracksuits", "tracksuits": "tracksuits", "cleats": "cleats",
    "boots": "cleats", "sneakers": "sneakers", "shoes": "shoes", "bag": "bags", "bags": "bags", "backpack": "bags", "bottle": "bottles",
    "bottles": "bottles", "gloves": "gloves", "glove": "gloves", "sublimation": "sublimation printing", "sublimated": "sublimation printing",
    "embroidery": "embroidery", "patches": "patches", "shinguards": "shin guards", "polo": "polos", "polos": "polos", "tshirts": "t-shirts",
    "t-shirts": "t-shirts", "tees": "t-shirts", "jackets": "jackets", "jacket": "jackets",
}
SUPPLIER_WORDS = re.compile(r"\b(factory|manufactur\w*|supplier|suppl(y|ies)|wholesale\w*|oem|odm|moq|bulk|vendor|maker|we make|we produce|production|"
                            r"printing|print shop|sublimat\w*|custom\w*|samples?|price list|catalog(ue)?|per piece|pcs)\b", re.I)
PLACES = ["Sialkot", "Lahore", "Karachi", "Pakistan", "Guangzhou", "Shenzhen", "Fujian", "Jinjiang", "Xiamen", "Yiwu", "China", "Hong Kong",
          "Vietnam", "Ho Chi Minh", "Bangladesh", "Dhaka", "India", "Tiruppur", "Delhi", "Turkey", "Istanbul", "Izmir", "Portugal", "Porto",
          "Spain", "Italy", "Poland", "Mexico", "Colombia", "Brazil", "Peru", "USA", "United States", "Los Angeles", "Texas", "Florida",
          "California", "New York", "Canada", "Toronto", "UK", "United Kingdom", "London", "Manchester", "Germany", "Netherlands",
          "Thailand", "Indonesia", "Philippines", "Sri Lanka", "Egypt", "Morocco", "Nigeria", "Kenya", "South Africa", "Australia"]
PLACE_RE = re.compile(r"\b(" + "|".join(re.escape(p) for p in PLACES) + r")\b", re.I)
BIZ_RE = re.compile(r"\b((?:[A-Z][A-Za-z0-9&'.-]*\s){0,3}(?:[A-Z][A-Za-z0-9&'.-]*\s)?(?:Sports(?:wear)?|Apparel|Textiles?|Industr(?:y|ies)|"
                    r"Manufacturing|Factory|Co\.?|Company|Ltd\.?|LLC|Inc\.?|Trading|Garments?|Wear|Kits|Prints?|Printing|Uniforms|"
                    r"Enterprises?|Group|Exports?|Gear|Teamwear|Clothing|Shop|Studio|Supply|Supplies))\b")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>\"')\]]+", re.I)
PHONE_RE = re.compile(r"(?<![\w/])\+?\d[\d\s().-]{7,}\d(?![\w/])")
HANDLE_RE = re.compile(r"(?<![\w.@])@([A-Za-z0-9_.]{3,30})")
MOQ_RE = re.compile(r"\b(?:moq|min(?:imum)?(?:\s+order)?(?:\s+quantity)?)\s*(?:is|of|:|=|-)?\s*(\d{1,6}\s*(?:pcs|pieces|units|sets|pairs|pc)?)", re.I)
PRICE_RE = re.compile(r"(?:\$|usd\s?|us\$)\s?\d+(?:[.,]\d+)?(?:\s?(?:-|to)\s?\$?\d+(?:[.,]\d+)?)?(?:\s*(?:/|per|each|a)\s*(?:pc|pcs|piece|unit|set|pair|jersey|kit|ball)s?)?", re.I)
WA_RE = re.compile(r"^\[?(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]?\s*(?:-\s*)?([^:]{1,60}):\s?(.*)$")
FREEMAIL = {"gmail", "yahoo", "hotmail", "outlook", "icloud", "aol", "proton", "protonmail", "mail", "live", "qq", "163", "126", "yandex", "gmx"}
SKIP_DOMAINS = {"facebook", "fb", "instagram", "reddit", "t", "telegram", "discord", "whatsapp", "wa", "chat", "youtube", "youtu", "google", "goo",
                "bit", "tiktok", "twitter", "x", "linktr"}


def _messages(text: str) -> list[dict]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    wa = [WA_RE.match(l.strip()) for l in lines]
    msgs: list[dict] = []
    if sum(1 for m in wa if m) >= 2:
        for l, m in zip(lines, wa):
            if m:
                msgs.append({"sender": m.group(3).strip(), "text": m.group(4).strip()})
            elif msgs and l.strip():
                msgs[-1]["text"] += "\n" + l.strip()
        return msgs
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    if len(blocks) <= 1:
        blocks = [l.strip() for l in lines if l.strip()]
    for b in blocks:
        m = re.match(r"^([A-Z][\w .'-]{1,40}?)(?:,\s*\[[^\]]*\])?:\s+(.+)$", b, re.S)
        if m and len(m.group(1).split()) <= 4:
            msgs.append({"sender": m.group(1).strip(), "text": m.group(2).strip()})
        else:
            msgs.append({"sender": "", "text": b})
    return msgs


def _title(s: str) -> str:
    s = re.sub(r"[-_]+", " ", s).strip()
    return " ".join(w[:1].upper() + w[1:] for w in s.split())


def _name_for(msg: dict, emails: list[str], urls: list[str], handles: list[str]) -> str:
    m = BIZ_RE.search(msg["text"])
    if m:
        name = re.sub(r"^(?:Hi|Hello|Hey|Contact|Try|Check|From|Call|Ask|We|Our|I|The|At|Is|Are|Use|Recommend)\s+", "", m.group(1).strip())
        if len(name) >= 4 and not name.lower().startswith(("co", "company", "ltd")):
            return name[:80]
    for u in urls:
        host = urllib.parse.urlparse(u if u.lower().startswith("http") else "https://" + u).hostname or ""
        parts = [p for p in host.lower().split(".") if p not in ("www", "m", "shop", "store")]
        if parts and parts[0] not in SKIP_DOMAINS:
            return _title(parts[0])[:80]
    for e in emails:
        dom = e.split("@")[1].split(".")[0].lower()
        if dom not in FREEMAIL:
            return _title(dom)[:80]
    if msg.get("sender") and not re.fullmatch(r"[+\d\s()-]+", msg["sender"]):
        return msg["sender"][:80]
    if handles:
        return "@" + handles[0]
    for e in emails:
        return _title(e.split("@")[0])[:80]
    return ""


def score_lead(l: dict, wishlist: str) -> int:
    terms = set(_wish_terms(wishlist))
    want = {PRODUCT_WORDS.get(t, t) for t in terms}
    prods = {x.lower() for x in (l.get("products") or [])}
    sc = 30
    if l.get("contact"):
        sc += 15
    if l.get("url"):
        sc += 8
    if l.get("price_note"):
        sc += 10
    if l.get("moq"):
        sc += 7
        m = re.search(r"\d+", l["moq"])
        if m and int(m.group()) <= 50:
            sc += 5
    if l.get("location"):
        sc += 5
    if want:
        hit = len(prods & want) + sum(1 for t in terms if t in (l.get("notes") or "").lower())
        sc += min(25, hit * 9)
    else:
        sc += min(20, len(prods) * 6)
    if l.get("kind") in ("factory", "print shop"):
        sc += 5
    return int(max(0, min(100, sc)))


def parse_leads(text: str, channel: str, wishlist: str) -> list[dict]:
    found: dict[str, dict] = {}
    for msg in _messages(text[:2_000_000])[:5000]:
        t = msg["text"]
        if len(t) < 8:
            continue
        emails = EMAIL_RE.findall(t)
        urls = [u.rstrip(".,;:!") for u in URL_RE.findall(t)]
        phones = [p.strip() for p in PHONE_RE.findall(t) if len(re.sub(r"\D", "", p)) >= 8]
        handles = HANDLE_RE.findall(t)
        low = t.lower()
        prods = list(dict.fromkeys(PRODUCT_WORDS[w] for w in re.findall(r"[a-z-]+", low) if w in PRODUCT_WORDS))
        supplier = bool(SUPPLIER_WORDS.search(t))
        price = PRICE_RE.search(t)
        contact = emails or phones or urls or handles
        if not ((contact and (supplier or prods or price)) or (supplier and prods and (price or MOQ_RE.search(t)))):
            continue
        name = _name_for(msg, emails, urls, handles)
        if not name:
            continue
        loc = PLACE_RE.search(t)
        moq = MOQ_RE.search(t)
        kind = ("factory" if re.search(r"factory|manufactur|oem|odm|we make|we produce|production", low) else
                "print shop" if re.search(r"print|sublimat|dtf|screen|embroider", low) else
                "wholesaler" if re.search(r"wholesale|bulk|stock|distribut", low) else
                "reseller" if re.search(r"resell|dropship|reseller", low) else "other")
        key = name.lower()
        l = found.get(key) or {"name": name, "kind": kind, "channel": channel, "contact": "", "url": "", "location": "", "products": [],
                               "moq": "", "price_note": "", "notes": ""}
        cs = [c for c in [*(emails[:1]), *(phones[:1]), *(("@" + h for h in handles[:1]) if not emails and not phones else [])] if c]
        if cs and not l["contact"]:
            l["contact"] = ", ".join(cs)[:200]
        if urls and not l["url"]:
            l["url"] = urls[0][:500]
        if loc and not l["location"]:
            hit = loc.group(1)
            l["location"] = next((p for p in PLACES if p.lower() == hit.lower()), hit)
        l["products"] = list(dict.fromkeys(l["products"] + prods))[:10]
        if moq and not l["moq"]:
            l["moq"] = moq.group(1).strip()[:80]
        if price and not l["price_note"]:
            l["price_note"] = price.group(0).strip()[:160]
        snippet = re.sub(r"\s+", " ", t).strip()[:400]
        l["notes"] = (l["notes"] + ("\n" if l["notes"] else "") + snippet)[:1500]
        if l["kind"] == "other":
            l["kind"] = kind
        found[key] = l
    out = []
    for l in found.values():
        l["score"] = score_lead(l, wishlist)
        out.append(l)
    return out


def _is_dupe(l: dict, existing: list[dict]) -> bool:
    nm = l["name"].lower()
    c = (l.get("contact") or "").lower()
    for e in existing:
        if e.get("name", "").lower() == nm:
            return True
        if c and c == (e.get("contact") or "").lower():
            return True
    return False


def scouts_paste(agent_key: str, text: str) -> dict:
    a = SCOUT_BY_KEY.get(agent_key)
    if not a:
        raise HTTPException(404, "That scout was not found.")
    if len(text.strip()) < 10:
        raise HTTPException(400, "Paste some messages first.")
    s = scout_settings()
    channel = a["channel"] if a["channel"] not in ("pipeline", "crm") else "manual"
    if a["key"] == "telegram" and re.search(r"discord", text, re.I) and not re.search(r"telegram", text, re.I):
        channel = "discord"
    existing = db.jrows("leads")
    added = []
    skipped_low = 0
    for l in parse_leads(text, channel, s["wishlist"]):
        if _is_dupe(l, existing + added):
            continue
        if l["score"] < s["min_score"]:
            skipped_low += 1
            continue
        l.update({"agent_key": a["key"], "stage": "new", "next_step": "Say hello and ask for their price list", "follow_up_at": 0,
                  "created": now(), "updated": now(),
                  "events": [{"ts": now(), "kind": "found", "text": f"Found by {a['name']} in pasted {CH_LABEL.get(channel, channel)} messages."}]})
        db.jput("leads", l)
        added.append(l)
    note = f"Found {len(added)} {'vendor' if len(added) == 1 else 'vendors'} in pasted text." + (
        f" Skipped {skipped_low} below your minimum score." if skipped_low else "")
    _agent_note(a["key"], note, len(added))
    return {"ok": True, "found": len(added), "leads": [{"id": l["id"], "name": l["name"], "location": l.get("location", "")} for l in added],
            "skipped": skipped_low}


CH_LABEL = {"whatsapp": "WhatsApp", "telegram": "Telegram", "discord": "Discord", "facebook": "Facebook", "email": "email",
            "reddit": "Reddit", "web": "web", "marketplace": "marketplace", "manual": "", "crm": ""}


def _lead(lid: int) -> dict:
    l = db.jget("leads", lid)
    if not l:
        raise HTTPException(404, "That vendor was not found.")
    return l


def _s(v, n) -> str:
    return str(v or "").strip()[:n]


def lead_create(body: dict) -> dict:
    name = _s(body.get("name"), 120)
    if not name:
        raise HTTPException(400, "Give the vendor a name.")
    s = scout_settings()
    channel = _s(body.get("channel"), 30) or "manual"
    l = {"name": name, "kind": _s(body.get("kind"), 30) or "other", "channel": channel, "agent_key": "",
         "contact": _s(body.get("contact"), 200), "url": _s(body.get("url"), 500), "location": _s(body.get("location"), 120),
         "moq": _s(body.get("moq"), 80), "price_note": _s(body.get("price_note"), 160), "notes": _s(body.get("notes"), 4000),
         "products": [_s(p, 40) for p in (body.get("products") or []) if _s(p, 40)][:20] if isinstance(body.get("products"), list) else [],
         "stage": "new", "next_step": "", "follow_up_at": 0, "created": now(), "updated": now(),
         "events": [{"ts": now(), "kind": "found", "text": "Added by you."}]}
    l["score"] = score_lead(l, s["wishlist"])
    return db.jput("leads", l)


def lead_update(lid: int, body: dict) -> dict:
    l = _lead(lid)
    if "stage" in body:
        st = body["stage"]
        if st not in STAGES:
            raise HTTPException(400, "That stage is not valid.")
        if st != l.get("stage"):
            l.setdefault("events", []).append({"ts": now(), "kind": "stage", "text": f"Moved to {STAGE_LABEL[st]}."})
            l["stage"] = st
    for k, n in (("name", 120), ("contact", 200), ("url", 500), ("location", 120), ("moq", 80), ("price_note", 160), ("notes", 4000),
                 ("next_step", 200), ("kind", 30)):
        if k in body:
            v = _s(body[k], n)
            if k == "name" and not v:
                raise HTTPException(400, "Give the vendor a name.")
            l[k] = v
    if "products" in body and isinstance(body["products"], list):
        l["products"] = [_s(p, 40) for p in body["products"] if _s(p, 40)][:20]
    if "follow_up_at" in body:
        l["follow_up_at"] = max(0, int(shop._num(body["follow_up_at"])))
    l["updated"] = now()
    return db.jput("leads", l)


def lead_event(lid: int, kind: str, text: str) -> dict:
    l = _lead(lid)
    if kind not in ("message", "reply", "note"):
        raise HTTPException(400, "Unknown kind of event.")
    text = text.strip()[:4000]
    if not text:
        raise HTTPException(400, "Write or paste what happened first.")
    evs = l.setdefault("events", [])
    evs.append({"ts": now(), "kind": kind, "text": text})
    new_stage = None
    if kind == "message" and l.get("stage") == "new":
        new_stage = "contacted"
    if kind == "reply" and l.get("stage") in ("new", "contacted"):
        new_stage = "talking"
    if new_stage:
        l["stage"] = new_stage
        evs.append({"ts": now() + 0.001, "kind": "stage", "text": f"Moved to {STAGE_LABEL[new_stage]}."})
    if kind == "message" and not l.get("follow_up_at"):
        l["follow_up_at"] = round(now() + 3 * DAY)
    if kind == "reply" and l.get("follow_up_at") and l["follow_up_at"] < now() + DAY:
        l["follow_up_at"] = 0
    l["updated"] = now()
    return db.jput("leads", l)


def lead_draft(lid: int, purpose: str) -> str:
    l = _lead(lid)
    st = shop.settings()
    store = st.get("name") or "our store"
    s = scout_settings()
    who = l["name"] if not l["name"].startswith("@") else "there"
    prods = l.get("products") or [PRODUCT_WORDS.get(t, t) for t in _wish_terms(s["wishlist"]) if t in PRODUCT_WORDS] or ["custom team jerseys"]
    items = [x for x in dict.fromkeys(prods) if x not in ("sublimation printing", "embroidery", "patches")][:4] or ["custom team jerseys"]
    plist = items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]
    sign = f"Thanks,\n{store} team" + (f"\n{st['support_email']}" if st.get("support_email") else "")
    if purpose == "follow_up":
        return (f"Hi {who},\n\nJust following up on my message about {plist}. We are still keen to work with a maker for our "
                f"custom teamwear store {store}. Could you share your price list and minimum order when you have a moment?\n\n{sign}")
    if purpose == "sample":
        return (f"Hi {who},\n\nThanks for the details so far. Before we place a first order we would like to see a sample of your "
                f"{plist}. Could you send one sample with our own design (sublimated, with a name and number), and tell us the cost "
                f"and shipping time to us?\n\n{sign}")
    if purpose == "partner":
        return (f"Hi {who},\n\nWe were happy with what we have seen from you. {store} sells made to order team kits and gear, and we "
                f"would like to work with you as a regular maker for {plist}. Could we agree on prices for runs of 10, 25 and 50 pieces, "
                f"production time and how you prefer to receive orders and payment?\n\n{sign}")
    moq = f" Is a small minimum order possible (we often start with 10 to 25 pieces)?" if not l.get("moq") else f" I saw your minimum order is {l['moq']}."
    return (f"Hi {who},\n\nI run {store}, an online store for custom team kits and sportswear. We are looking for a maker for {plist}."
            f"{moq} Could you send your price list, production time and a few photos of recent work?\n\n{sign}")


# ================================================================== scheduler

def scheduled() -> None:
    t = now()
    shop.expire_flash(db.products())
    ap = shop.settings()["autopilot"]
    if ap["mode"] != "off" and t - (db.kv_get("autopilot_last", 0) or 0) > 4 * HOUR:
        autopilot_run(manual=False)
    if db.kv_get("lab_last", 0) and t - db.kv_get("lab_last", 0) > 6 * HOUR:
        lab_run(manual=False)
    if scout_settings()["auto_run"] and t - (db.kv_get("scouts_last", 0) or 0) > 6 * HOUR:
        scouts_run(None)
    db.run("DELETE FROM events WHERE ts<?", (t - 400 * DAY,))
    db.run("DELETE FROM sessions WHERE expires<?", (t,))
