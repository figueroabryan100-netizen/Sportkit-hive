// SquadForge shared storefront module
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const money = (n) => "$" + (Number(n) || 0).toFixed(2);

// ------------------------------------------------------------- data
let _store, _catalog, _leagues;
export async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || "Something went wrong. Please try again.");
  return data;
}
export const postJSON = (url, data) => getJSON(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
export const store = () => (_store ||= getJSON("/api/store"));
export const catalog = () => (_catalog ||= getJSON("/api/catalog").then((d) => d.products));
export const leagues = () => (_leagues ||= getJSON("/api/leagues").then((d) => d.leagues));
export const bySlug = async (slug) => (await catalog()).find((p) => p.slug === slug);

// ------------------------------------------------------------- analytics
export const sid = (() => {
  let s = sessionStorage.getItem("sf_sid");
  if (!s) { s = Math.random().toString(36).slice(2, 12); sessionStorage.setItem("sf_sid", s); }
  return s;
})();
export function track(type, extra = {}) {
  try {
    const body = JSON.stringify({ type, sid, ...extra });
    navigator.sendBeacon?.("/api/event", new Blob([body], { type: "application/json" })) ||
      fetch("/api/event", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
  } catch {}
}

// ------------------------------------------------------------- local state
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
export const cart = {
  items: () => LS.get("sf_bag", []),
  save(items) { LS.set("sf_bag", items); updateBadges(true); },
  add(item) {
    const items = cart.items();
    const key = JSON.stringify([item.slug, item.size, item.design, item.roster || []]);
    const same = items.find((i) => JSON.stringify([i.slug, i.size, i.design, i.roster || []]) === key && !item.roster?.length);
    if (same) same.qty += item.qty; else items.push({ ...item, id: Math.random().toString(36).slice(2, 9) });
    cart.save(items);
    track("bag", { slug: item.slug });
  },
  count: () => cart.items().reduce((n, i) => n + (i.roster?.length || i.qty), 0),
  clear() { cart.save([]); },
};
export const likes = {
  all: () => LS.get("sf_likes", []),
  has: (slug) => likes.all().includes(slug),
  toggle(slug) {
    const a = likes.all();
    const on = !a.includes(slug);
    LS.set("sf_likes", on ? [...a, slug] : a.filter((s) => s !== slug));
    postJSON("/api/like", { slug, unlike: !on }).catch(() => {});
    updateBadges();
    return on;
  },
};
export const recent = {
  all: () => LS.get("sf_recent", []),
  push(slug) { LS.set("sf_recent", [slug, ...recent.all().filter((s) => s !== slug)].slice(0, 12)); },
};

// ------------------------------------------------------------- 3D thumbs
let _g3d;
export const gear3d = () => (_g3d ||= import("/js/gear3d.js?v=6").catch(() => null));
const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); paintThumb(e.target); }
}, { rootMargin: "300px" }) : null;
async function paintThumb(el) {
  const design = JSON.parse(el.dataset.design || "{}");
  const size = +el.dataset.size || 420;
  const m = await gear3d();
  let url = null;
  try {
    if (m?.supported?.()) url = await m.thumb(design, size);
    else if (m?.draw2D) { const c = document.createElement("canvas"); c.width = c.height = size; m.draw2D(c, design); url = c.toDataURL(); }
  } catch (err) { console.warn("thumb failed", err); }
  if (!url) return;
  const img = new Image();
  img.alt = el.dataset.alt || "";
  img.decoding = "async";
  img.src = url;
  img.onload = () => { el.querySelector(".ph")?.remove(); el.prepend(img); };
}
export function thumbHTML(design, alt, size = 420) {
  const bg = `linear-gradient(135deg,${design.primary || "#ccc"} 0 55%,${design.secondary || "#999"} 55%)`;
  return `<div class="thumb-slot" style="position:absolute;inset:0" data-size="${size}" data-alt="${esc(alt)}" data-design='${esc(JSON.stringify(design))}'><div class="ph" style="background:${bg}"></div></div>`;
}
export function hydrateThumbs(root = document) {
  for (const el of $$(".thumb-slot:not([data-h])", root)) {
    el.dataset.h = 1;
    io ? io.observe(el) : paintThumb(el);
  }
}

// ------------------------------------------------------------- product card
export function timeLeft(ts) {
  const s = Math.max(0, Math.floor(ts - Date.now() / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return d ? `${d}d ${h}h ${m}m` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
}
export function card(p) {
  const off = p.compare_at > p.price ? Math.round(100 - (p.price / p.compare_at) * 100) : 0;
  const tags = [p.flash && `<span class="tag flash">Flash deal</span>`, p.new && `<span class="tag new">New</span>`, !p.flash && off >= 15 && `<span class="tag sale">${off}% off</span>`].filter(Boolean).slice(0, 2).join("");
  const d = p.design || {};
  const on = likes.has(p.slug);
  return `<article class="card">
    <a href="/design.html?p=${encodeURIComponent(p.slug)}" class="pic" aria-label="${esc(p.name)}">${thumbHTML(d, p.name)}</a>
    <div class="tags">${tags}</div>
    <button class="qv-btn" type="button" data-qv="${esc(p.slug)}" aria-label="Quick view ${esc(p.name)}"><svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><span>Quick view</span></button>
    <button class="heart${on ? " on" : ""}" data-like="${esc(p.slug)}" aria-pressed="${on}" aria-label="Save ${esc(p.name)}"><svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg></button>
    <div class="body">
      <a class="name" href="/design.html?p=${encodeURIComponent(p.slug)}">${esc(p.name)}</a>
      <div class="sub">${esc(p.league_name || p.sport)} · ${esc(p.category)}</div>
      <div class="dots">${[d.primary, d.secondary, d.accent].filter(Boolean).map((c) => `<i style="background:${esc(c)}"></i>`).join("")}</div>
      <div class="price">${money(p.price)}${p.compare_at > p.price ? ` <s>${money(p.compare_at)}</s>` : ""}${p.flash && p.flash_ends ? ` <span class="countdown" data-ends="${p.flash_ends}">${timeLeft(p.flash_ends)}</span>` : ""}</div>
    </div>
  </article>`;
}
export function renderCards(el, products, append = false) {
  el.insertAdjacentHTML(append ? "beforeend" : "afterbegin", "");
  if (!append) el.innerHTML = "";
  el.insertAdjacentHTML("beforeend", products.map(card).join(""));
  hydrateThumbs(el);
}
setInterval(() => { for (const el of $$(".countdown[data-ends]")) el.textContent = timeLeft(+el.dataset.ends); }, 1000);

document.addEventListener("click", (e) => {
  const h = e.target.closest("[data-like]");
  if (!h) return;
  e.preventDefault();
  const on = likes.toggle(h.dataset.like);
  for (const b of $$(`[data-like="${CSS.escape(h.dataset.like)}"]`)) {
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
    b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
  }
  if (on) burst(e.clientX, e.clientY, ["#ff5a47", "#ff9a8a", "#ffffff"], 14);
  toast(on ? "Saved to your favorites. <a href=\"/shop.html?saved=1\">View all</a>" : "Removed from favorites");
});

// ------------------------------------------------------------- toast, confetti
let toastT;
export function toast(html, ms = 2600) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.innerHTML = html;
  requestAnimationFrame(() => t.classList.add("on"));
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("on"), ms);
}
export function burst(x, y, colors = ["#c8f53c", "#ff5a47", "#2ee6d6", "#3fb8ff", "#ffa02e", "#ffffff", "#04282e"], n = 120) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas");
  c.className = "confetti"; c.width = innerWidth; c.height = innerHeight;
  document.body.append(c);
  const g = c.getContext("2d");
  const parts = Array.from({ length: n }, () => ({
    x, y, vx: (Math.random() - 0.5) * (n > 40 ? 18 : 8), vy: -Math.random() * (n > 40 ? 18 : 9) - 2,
    r: Math.random() * 6 + 3, c: colors[(Math.random() * colors.length) | 0], a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4,
  }));
  let f = 0;
  (function step() {
    g.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.vy += 0.45; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c; g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); g.restore();
    }
    if (++f < 140) requestAnimationFrame(step); else c.remove();
  })();
}

// ------------------------------------------------------------- header & footer
const ICON = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>',
  bag: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6a3 3 0 016 0v2"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
};
export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2l12 5v8.5C28 23 22.6 28.4 16 30 9.4 28.4 4 23 4 15.5V7z" fill="#c8f53c"/><path d="M11 11h10l-2 3h-5l-1 2h5l-3 6h-3l2-4h-4z" fill="#04282e"/></svg>`;
const PAY_LABEL = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", applepay: "Apple Pay", googlepay: "Google Pay", klarna: "Klarna", afterpay: "Afterpay", paypal: "PayPal", venmo: "Venmo", cashapp: "Cash App", zelle: "Zelle", btc: "Bitcoin", eth: "Ethereum", usdt: "USDT", usdc: "USDC", sol: "Solana", shoppay: "Shop Pay", affirm: "Affirm", ltc: "Litecoin", doge: "Dogecoin", revolut: "Revolut", wise: "Wise", chime: "Chime", bank: "Bank transfer", cash: "Cash" };
export const payLabel = (k) => PAY_LABEL[k] || k;

function updateBadges(bump) {
  const n = cart.count();
  for (const b of $$("[data-bag-count]")) {
    b.textContent = n; b.classList.toggle("on", n > 0);
    if (bump) { b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); }
  }
  const l = likes.all().length;
  for (const b of $$("[data-like-count]")) { b.textContent = l; b.classList.toggle("on", l > 0); }
}

export async function chrome() {
  const page = document.body.dataset.page;
  const s = await store().catch(() => ({ name: "SquadForge", announcement: [], payments: [] }));
  const ann = (s.announcement || []).filter(Boolean);
  const nav = [["/shop.html", "Shop", "shop"], ["/leagues.html", "Leagues", "leagues"], ["/design.html", "Design Lab", "design"], ["/#team", "Team orders", "team"], ["/track.html", "Track order", "track"]];
  const head = document.getElementById("site-header");
  if (head) head.outerHTML = `
    ${ann.length ? `<div class="ticker" aria-label="Store news"><div class="run">${[...ann, ...ann, ...ann, ...ann].map((a) => `<span>${esc(a)}</span>`).join("")}</div></div>` : ""}
    <header class="hdr"><div class="wrap in">
      <button class="icon-btn burger" id="burger" aria-label="Menu" aria-expanded="false">${ICON.menu}</button>
      <a class="logo" href="/">${LOGO}<span>${esc(nameParts(s.name))}</span></a>
      <nav class="nav" id="nav">${nav.map(([h, t, k]) => `<a href="${h}" class="${k === page ? "on" : ""}">${t}</a>`).join("")}</nav>
      <div class="tools">
        <button class="icon-btn" id="open-search" aria-label="Search (press /)">${ICON.search}</button>
        <a class="icon-btn" href="/shop.html?saved=1" aria-label="Favorites">${ICON.heart}<span class="badge" data-like-count></span></a>
        <a class="icon-btn" href="/cart.html" aria-label="Bag">${ICON.bag}<span class="badge" data-bag-count></span></a>
      </div>
    </div></header>`;
  const foot = document.getElementById("site-footer");
  const icons = s.payments?.length ? [...new Set(s.payments.flatMap((p) => p.icons))] : ["visa", "mastercard", "amex", "applepay", "googlepay", "shoppay", "klarna", "paypal", "cashapp", "venmo", "zelle", "btc", "eth", "usdt"];
  if (foot) foot.outerHTML = `<footer class="ftr"><div class="wrap">
    <div class="cols">
      <div><a class="logo" href="/" style="color:#fff">${LOGO}<span>${esc(nameParts(s.name))}</span></a>
        <p style="margin-top:14px;max-width:24em">Custom kits and team gear, designed by you and made to order. Every piece is printed with your colors, name and number.</p>
        <form class="news" id="news"><input class="input" type="email" required placeholder="Email for drops and deals" aria-label="Email"><button class="btn btn-lime btn-sm">Join</button></form></div>
      <div><h4>Shop</h4><a href="/shop.html">All gear</a><a href="/shop.html?cat=Jerseys">Jerseys</a><a href="/shop.html?cat=Footwear">Footwear</a><a href="/shop.html?cat=Balls">Balls</a><a href="/shop.html?sort=new">New drops</a><a href="/shop.html?deals=1">Deals</a></div>
      <div><h4>Create</h4><a href="/design.html">Design Lab</a><a href="/leagues.html">League collections</a><a href="/#team">Team orders</a><a href="#" data-size-guide>Size guide</a></div>
      <div><h4>Help</h4><a href="/track.html">Track an order</a><a href="#" data-modal="shipping">Shipping and returns</a><a href="#" data-modal="faq">FAQ</a>${s.support_email ? `<a href="mailto:${esc(s.support_email)}">${esc(s.support_email)}</a>` : ""}${s.instagram ? `<a href="https://instagram.com/${esc(s.instagram.replace("@", ""))}" rel="noopener" target="_blank">Instagram</a>` : ""}${s.tiktok ? `<a href="https://tiktok.com/@${esc(s.tiktok.replace("@", ""))}" rel="noopener" target="_blank">TikTok</a>` : ""}<a href="/admin.html">Owner login</a></div>
    </div>
    <div class="bottom"><span>&copy; ${new Date().getFullYear()} ${esc(s.name)}. Original designs, made to order.</span><div class="pay-icons">${icons.map((i) => `<span>${esc(payLabel(i))}</span>`).join("")}</div></div>
  </div></footer>`;
  updateBadges();
  if ((s.ads?.placements || []).includes("footer")) import("/js/ads.js?v=6").then(({ adSlot, fillAds }) => {
    const ad = adSlot(s, "footer", 1);
    if (ad) { $(".ftr").insertAdjacentHTML("beforebegin", `<div class="wrap ad-wrap">${ad}</div>`); fillAds(); }
  });
  $("#burger")?.addEventListener("click", (e) => {
    const open = $("#nav").classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", open);
  });
  $("#news")?.addEventListener("submit", (e) => { e.preventDefault(); e.target.reset(); toast("You're on the list. Watch your inbox for the next drop."); burst(innerWidth / 2, innerHeight - 80, undefined, 60); });
  $("#open-search")?.addEventListener("click", openSearch);
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
  });
  document.addEventListener("click", (e) => {
    const m = e.target.closest("[data-modal]");
    if (m) { e.preventDefault(); infoModal(m.dataset.modal, s); }
    if (e.target.closest("[data-size-guide]")) { e.preventDefault(); sizeGuide(); }
  });
  konami();
  if (!sessionStorage.getItem("sf_v")) { sessionStorage.setItem("sf_v", 1); track("visit"); }
  revealOnScroll();
  return s;
}
const nameParts = (n) => n || "SquadForge";

// ------------------------------------------------------------- search overlay
async function openSearch() {
  let pop = $(".search-pop");
  if (!pop) {
    pop = document.createElement("div");
    pop.className = "search-pop";
    pop.innerHTML = `<div class="box" role="dialog" aria-label="Search"><input type="search" placeholder="Search jerseys, cleats, caps, leagues..." aria-label="Search the store"><div class="hits"></div><div class="tips">Try: ${["home jersey", "cleats", "match ball", "cap", "socks", "hoodie"].map((t) => `<button type="button">${t}</button>`).join("")}</div></div>`;
    document.body.append(pop);
    const input = $("input", pop), hits = $(".hits", pop);
    let sel = -1, list = [], qT;
    const run = async () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { hits.innerHTML = ""; return; }
      const terms = q.split(/\s+/);
      list = (await catalog()).filter((p) => { const h = `${p.name} ${p.category} ${p.sport} ${p.league_name}`.toLowerCase(); return terms.every((t) => h.includes(t)); }).slice(0, 8);
      sel = -1;
      hits.innerHTML = list.length ? list.map((p) => `<a class="hit" href="/design.html?p=${encodeURIComponent(p.slug)}"><div class="th" style="position:relative">${thumbHTML(p.design, p.name, 160)}</div><div><b>${esc(p.name)}</b><small>${esc(p.league_name || p.sport)} · ${money(p.price)}</small></div></a>`).join("") + `<a class="hit" href="/shop.html?q=${encodeURIComponent(q)}"><b>See all results for "${esc(q)}"</b></a>` : `<div class="empty">Nothing yet for "${esc(q)}". Try the <a class="link" href="/design.html">Design Lab</a> and make it yourself.</div>`;
      hydrateThumbs(hits);
      clearTimeout(qT); qT = setTimeout(() => track("search", { q }), 900);
    };
    input.addEventListener("input", run);
    input.addEventListener("keydown", (e) => {
      const a = $$(".hit", hits);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, Math.min(a.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1))); a.forEach((x, i) => x.classList.toggle("sel", i === sel)); }
      if (e.key === "Enter") { if (a[sel]) location.href = a[sel].href; else location.href = "/shop.html?q=" + encodeURIComponent(input.value); }
    });
    $(".tips", pop).addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") { input.value = e.target.textContent; run(); } });
    pop.addEventListener("click", (e) => { if (e.target === pop) pop.classList.remove("open"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") pop.classList.remove("open"); });
  }
  pop.classList.add("open");
  setTimeout(() => $("input", pop).focus(), 10);
}

// ------------------------------------------------------------- quick view: live 3D, colorways, size, add to bag
const QV_SIZES = { apparel: ["XS", "S", "M", "L", "XL", "2XL", "3XL"], shoe: ["6", "7", "8", "9", "10", "11", "12", "13"], one: ["One size"], ball: ["Size 5", "Size 4", "Size 3"] };
const qvSizes = (shape) => /cleats|sneakers|skates/.test(shape) ? QV_SIZES.shoe : shape === "ball-soccer" || shape === "ball-volleyball" ? QV_SIZES.ball : /^ball|puck|bottle|bag|cap|beanie|stick|helmet|hoop|bat$|mitt|racket|armband|headband|wristbands|backpack/.test(shape) ? QV_SIZES.one : QV_SIZES.apparel;
function qvColorways(d) {
  const p = d.primary || "#04282e", s = d.secondary || "#c8f53c", a = d.accent || "#ffffff";
  return [
    { label: "Original", c: [p, s, a] },
    { label: "Flipped", c: [s, p, a] },
    { label: "Blackout", c: ["#15151b", s, p] },
    { label: "Whiteout", c: ["#f4f5f7", p, s] },
  ];
}
async function quickView(slug) {
  const p = (await catalog()).find((x) => x.slug === slug);
  if (!p) return;
  const base = { ...(p.design || {}) };
  let d = { ...base }, size = null, qty = 1, handle = null;
  const sizes = qvSizes(p.shape || base.shape || "");
  if (sizes.length === 1) size = sizes[0];
  const off = p.compare_at > p.price ? Math.round(100 - (p.price / p.compare_at) * 100) : 0;
  const m = modal(`<div class="qv">
    <div class="qv-stage"><div class="qv-3d" id="qv-3d">${thumbHTML(d, p.name, 560)}</div>
      <div class="qv-views" role="group" aria-label="Angle">${["front", "side", "back"].map((v) => `<button type="button" data-qv-view="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}<button type="button" data-qv-spin aria-pressed="false">Spin</button></div>
      <p class="qv-hint">Drag to turn it. Scroll or pinch to zoom.</p></div>
    <div class="qv-info">
      <div class="sub">${esc(p.league_name || p.sport)} · ${esc(p.category)}</div>
      <h3>${esc(p.name)}</h3>
      <div class="price">${money(p.price)}${off ? ` <s>${money(p.compare_at)}</s> <span class="off">${off}% off</span>` : ""}</div>
      <p class="desc">${esc(p.description || "")}</p>
      <div class="lb">Colorway</div>
      <div class="qv-cw" role="group" aria-label="Colorway">${qvColorways(base).map((w, i) => `<button type="button" data-qv-cw="${i}" class="${i ? "" : "on"}" title="${w.label}" aria-label="${w.label}"><i style="background:linear-gradient(135deg,${w.c[0]} 0 50%,${w.c[1]} 50% 80%,${w.c[2]} 80%)"></i></button>`).join("")}</div>
      <div class="lb">Size</div>
      <div class="sizes qv-sizes">${sizes.map((x) => `<button type="button" data-qv-size="${esc(x)}" class="${x === size ? "on" : ""}">${esc(x)}</button>`).join("")}</div>
      <div class="qv-buy">
        <div class="qty"><button type="button" data-qv-q="-1" aria-label="Less">&minus;</button><b id="qv-n">1</b><button type="button" data-qv-q="1" aria-label="More">+</button></div>
        <button type="button" class="btn btn-lime" id="qv-add">Add to bag</button>
      </div>
      <a class="link" id="qv-more" href="/design.html?p=${encodeURIComponent(p.slug)}">Add your name and number in the 3D studio &rarr;</a>
      <p class="qv-meta">Made to order in about ${p.lead_days || 10} days.</p>
    </div></div>`);
  m.classList.add("qv-modal");
  hydrateThumbs(m);
  track("view", { slug: p.slug, quick: 1 });
  const g = await gear3d();
  const host = $("#qv-3d", m);
  if (g?.supported?.() && m.isConnected) {
    host.innerHTML = "";
    handle = g.mount(host, d, { interactive: true, motion: true, autoRotate: false });
  }
  const done = new MutationObserver(() => { if (!m.isConnected) { handle?.dispose(); done.disconnect(); } });
  done.observe(document.body, { childList: true });
  m.addEventListener("click", (e) => {
    const t = e.target.closest("button,a"); if (!t) return;
    if (t.dataset.qvView) { handle?.setView(t.dataset.qvView); $$("[data-qv-view]", m).forEach((b) => b.classList.toggle("on", b === t)); }
    else if (t.hasAttribute("data-qv-spin")) { const on = t.getAttribute("aria-pressed") !== "true"; t.setAttribute("aria-pressed", on); t.classList.toggle("on", on); if (handle) { if (on) { let a = 0; const tick = () => { if (t.getAttribute("aria-pressed") !== "true" || !m.isConnected) return; a += 0.02; handle.setAngle(a); requestAnimationFrame(tick); }; tick(); } } }
    else if (t.dataset.qvCw != null) { const w = qvColorways(base)[+t.dataset.qvCw]; d = { ...base, primary: w.c[0], secondary: w.c[1], accent: w.c[2], sleeve: w.c[0] }; if (+t.dataset.qvCw === 0) d = { ...base }; handle?.update(d); $$("[data-qv-cw]", m).forEach((b) => b.classList.toggle("on", b === t)); }
    else if (t.dataset.qvSize) { size = t.dataset.qvSize; $$("[data-qv-size]", m).forEach((b) => b.classList.toggle("on", b === t)); }
    else if (t.dataset.qvQ) { qty = Math.max(1, Math.min(99, qty + +t.dataset.qvQ)); $("#qv-n", m).textContent = qty; }
    else if (t.id === "qv-add") {
      if (!size) { toast("Pick a size first."); $(".qv-sizes", m).classList.add("shake"); setTimeout(() => $(".qv-sizes", m)?.classList.remove("shake"), 500); return; }
      cart.add({ slug: p.slug, name: p.name, price: p.price, size, qty, design: { ...d } });
      const r = t.getBoundingClientRect(); burst(r.left + r.width / 2, r.top, [d.primary, d.secondary, d.accent, "#ffffff"], 60);
      toast(`Added to your bag. <a class="link" href="/cart.html">Check out</a>`);
      setTimeout(() => m.remove(), 650);
    }
  });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-qv]");
  if (!b) return;
  e.preventDefault();
  quickView(b.dataset.qv);
});

// ------------------------------------------------------------- modals
export function modal(html) {
  const m = document.createElement("div");
  m.className = "modal open";
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true"><button class="x" aria-label="Close">&times;</button>${html}</div>`;
  document.body.append(m);
  const close = () => m.remove();
  m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".x")) close(); });
  document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", k); } });
  $(".x", m).focus();
  return m;
}
export function sizeGuide() {
  const rows = [["XS", "34-36", "28-30"], ["S", "36-38", "30-32"], ["M", "38-41", "32-34"], ["L", "41-44", "34-37"], ["XL", "44-47", "37-40"], ["2XL", "47-50", "40-43"], ["3XL", "50-53", "43-46"], ["4XL", "53-56", "46-49"]];
  modal(`<h3>Size guide</h3><p style="color:var(--mute)">Adult unisex, measurements in inches. Between sizes? Size up for a relaxed fit. Youth sizes YXS to YL fit ages 5 to 14.</p>
  <table class="t"><tr><th>Size</th><th>Chest</th><th>Waist</th></tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>
  <p style="margin-top:14px;color:var(--mute);font-size:13px">Footwear runs true to US sizing. Caps are adjustable one size.</p>`);
}
function infoModal(kind, s) {
  if (kind === "shipping") modal(`<h3>Shipping and returns</h3>
    <p>Every piece is made to order for you. Production takes the number of days shown on each product, then shipping takes 3 to 6 business days.</p>
    <p>Standard shipping is ${money(s.ship_flat)} and free on orders over ${money(s.free_ship_over)}. Express is ${money(s.ship_express)}.</p>
    <p><b>Printed wrong? We remake it free.</b> If anything arrives misprinted or damaged, tell us within 14 days with a photo and we send a new one. Because items are personalized, we can't take back pieces that match your design.</p>`);
  if (kind === "faq") modal(`<h3>FAQ</h3>
    <p><b>Are league collections official?</b><br>No. They are original ${esc(s.name)} designs inspired by the style of each competition, not official merchandise.</p>
    <p><b>How do team orders work?</b><br>Pick a design, switch on Team order, and paste your roster (name, number, size per line). Discounts apply automatically by piece count.</p>
    <p><b>How do I pay?</b><br>Choose any method at checkout. You'll get the exact amount and your order number to include. Once we confirm payment, production starts.</p>
    <p><b>Can I change my design after ordering?</b><br>Yes, until production starts. Reply with your order number.</p>`);
}

// ------------------------------------------------------------- fun: reveal and secret code
function revealOnScroll() {
  const els = $$(".reveal");
  if (!("IntersectionObserver" in window)) return els.forEach((e) => e.classList.add("in"));
  const ob = new IntersectionObserver((en) => en.forEach((x) => { if (x.isIntersecting) { x.target.classList.add("in"); ob.unobserve(x.target); } }), { threshold: 0.15 });
  els.forEach((e) => ob.observe(e));
}
function konami() {
  const seq = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let i = 0;
  document.addEventListener("keydown", (e) => {
    i = e.key === seq[i] ? i + 1 : e.key === seq[0] ? 1 : 0;
    if (i === seq.length) {
      i = 0;
      burst(innerWidth / 2, innerHeight / 2);
      toast("Secret unlocked: GOLAZO5 takes an extra 5% off. Shhh.", 6000);
    }
  });
}

// ------------------------------------------------------------- design share codes
export const encodeDesign = (d) => btoa(unescape(encodeURIComponent(JSON.stringify(d)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function decodeDesign(s) {
  try { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); } catch { return null; }
}
