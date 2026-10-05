"""SQLite storage. Everything stateful lives in DATA_DIR/app.db (and DATA_DIR/uploads)."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "seed"
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
UPLOADS = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "app.db"

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (
  slug TEXT PRIMARY KEY, data TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, bags INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS leagues (key TEXT PRIMARY KEY, data TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders (
  code TEXT PRIMARY KEY, created REAL NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS orders_created ON orders(created);
CREATE INDEX IF NOT EXISTS orders_email ON orders(email);
CREATE TABLE IF NOT EXISTS discounts (code TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, type TEXT NOT NULL, sid TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '', q TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created REAL NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
"""


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        with _lock:
            if _conn is None:
                DATA_DIR.mkdir(parents=True, exist_ok=True)
                UPLOADS.mkdir(parents=True, exist_ok=True)
                c = sqlite3.connect(str(DB_PATH), check_same_thread=False, isolation_level=None)
                c.row_factory = sqlite3.Row
                c.execute("PRAGMA journal_mode=WAL")
                c.execute("PRAGMA synchronous=NORMAL")
                c.executescript(SCHEMA)
                _conn = c
    return _conn


def q(sql: str, args: tuple | list = ()) -> list[sqlite3.Row]:
    with _lock:
        return conn().execute(sql, args).fetchall()


def q1(sql: str, args: tuple | list = ()):
    with _lock:
        return conn().execute(sql, args).fetchone()


def run(sql: str, args: tuple | list = ()) -> int:
    with _lock:
        cur = conn().execute(sql, args)
        return cur.lastrowid


class tx:
    """Serialised transaction: `with tx(): ...`."""

    def __enter__(self):
        _lock.acquire()
        conn().execute("BEGIN IMMEDIATE")
        return conn()

    def __exit__(self, et, ev, tb):
        try:
            conn().execute("ROLLBACK" if et else "COMMIT")
        finally:
            _lock.release()
        return False


# ------------------------------------------------------------------ kv

def kv_get(key: str, default=None):
    row = q1("SELECT value FROM kv WHERE key=?", (key,))
    return json.loads(row["value"]) if row else default


def kv_set(key: str, value) -> None:
    run("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))


# ------------------------------------------------------------------ json tables

def jrows(table: str, order: str = "id") -> list[dict]:
    out = []
    for r in q(f"SELECT id, data FROM {table} ORDER BY {order}"):
        d = json.loads(r["data"])
        d["id"] = r["id"]
        out.append(d)
    return out


def jget(table: str, id_: int) -> dict | None:
    r = q1(f"SELECT id, data FROM {table} WHERE id=?", (id_,))
    if not r:
        return None
    d = json.loads(r["data"])
    d["id"] = r["id"]
    return d


def jput(table: str, d: dict) -> dict:
    body = {k: v for k, v in d.items() if k != "id"}
    if d.get("id"):
        run(f"UPDATE {table} SET data=? WHERE id=?", (json.dumps(body), d["id"]))
    else:
        d["id"] = run(f"INSERT INTO {table}(data) VALUES(?)", (json.dumps(body),))
    return d


# ------------------------------------------------------------------ products

def products(include_stats: bool = False) -> list[dict]:
    out = []
    for r in q("SELECT slug, data, views, bags FROM products"):
        p = json.loads(r["data"])
        if include_stats:
            p["views"] = r["views"]
            p["bags"] = r["bags"]
        out.append(p)
    return out


def product(slug: str) -> dict | None:
    r = q1("SELECT data FROM products WHERE slug=?", (slug,))
    return json.loads(r["data"]) if r else None


def save_product(p: dict) -> dict:
    p = {k: v for k, v in p.items() if k not in ("views", "bags", "units", "revenue", "league_name", "new")}
    run("INSERT INTO products(slug,data) VALUES(?,?) ON CONFLICT(slug) DO UPDATE SET data=excluded.data", (p["slug"], json.dumps(p)))
    return p


def delete_product(slug: str) -> None:
    run("DELETE FROM products WHERE slug=?", (slug,))


def unique_slug(base: str) -> str:
    import re
    s = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")[:60] or "product"
    cand, n = s, 2
    while q1("SELECT 1 FROM products WHERE slug=?", (cand,)):
        cand = f"{s}-{n}"
        n += 1
    return cand


# ------------------------------------------------------------------ leagues

def leagues() -> list[dict]:
    return [json.loads(r["data"]) for r in q("SELECT data FROM leagues ORDER BY pos, key")]


def save_league(l: dict) -> None:
    row = q1("SELECT pos FROM leagues WHERE key=?", (l["key"],))
    pos = row["pos"] if row else (q1("SELECT COALESCE(MAX(pos),0)+1 AS p FROM leagues")["p"])
    body = {k: v for k, v in l.items() if k != "count"}
    run("INSERT INTO leagues(key,data,pos) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data", (l["key"], json.dumps(body), pos))


# ------------------------------------------------------------------ first boot

def init() -> None:
    conn()
    if kv_get("installed") is None:
        kv_set("installed", time.time())
    if not q1("SELECT 1 FROM products LIMIT 1") and kv_get("seeded_products") is None:
        cat = json.loads((SEED / "catalog.json").read_text())
        with tx() as c:
            for p in cat.get("products", []):
                p = dict(p)
                p.setdefault("cost", round(p.get("price", 0) * 0.38, 2))
                p.setdefault("sort", 0)
                p.pop("new", None)
                p.pop("league_name", None)
                c.execute("INSERT OR IGNORE INTO products(slug,data) VALUES(?,?)", (p["slug"], json.dumps(p)))
        kv_set("seeded_products", time.time())
    if not q1("SELECT 1 FROM leagues LIMIT 1") and kv_get("seeded_leagues") is None:
        lg = json.loads((SEED / "leagues.json").read_text())
        with tx() as c:
            for i, l in enumerate(lg.get("leagues", [])):
                body = {k: v for k, v in l.items() if k != "count"}
                c.execute("INSERT OR IGNORE INTO leagues(key,data,pos) VALUES(?,?,?)", (l["key"], json.dumps(body), i))
        kv_set("seeded_leagues", time.time())
    if kv_get("settings") is None:
        st = json.loads((SEED / "store.json").read_text())
        st.pop("payments", None)
        st.pop("payment_icons", None)
        st.setdefault("payments", {})
        kv_set("settings", st)
    if kv_get("seeded_discounts") is None:
        now = time.time()
        if not q1("SELECT 1 FROM discounts WHERE code='GOLAZO5'"):
            run("INSERT INTO discounts(code,data) VALUES(?,?)", ("GOLAZO5", json.dumps(
                {"code": "GOLAZO5", "kind": "percent", "value": 5, "min_order": 0, "max_uses": 0, "expires": 0,
                 "active": True, "uses": 0, "created": now})))
        kv_set("seeded_discounts", now)
