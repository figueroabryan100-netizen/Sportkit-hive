import { $, $$, esc, chrome, catalog, leagues, renderCards, likes, track } from "/js/app.js?v=6";
import { adSlot, fillAds } from "/js/ads.js?v=6";

const store = await chrome();
const all = await catalog();
const lgs = await leagues();
const url = new URLSearchParams(location.search);
const st = { cat: url.get("cat") || "", sport: url.get("sport") || "", league: url.get("league") || "", q: url.get("q") || "", sort: url.get("sort") || "hot", saved: url.get("saved") === "1", deals: url.get("deals") === "1", n: 24 };

const cats = ["All", ...new Set(all.map((p) => p.category))];
const sports = ["All sports", ...new Set(all.map((p) => p.sport))];
$("#cats").innerHTML = cats.map((c) => `<button class="chip" data-cat="${esc(c === "All" ? "" : c)}">${esc(c)}</button>`).join("") + `<button class="chip" data-deals>Deals</button><button class="chip" data-saved>Saved</button>`;
$("#sports").innerHTML = sports.map((c) => `<button class="chip" data-sport="${esc(c === "All sports" ? "" : c)}">${esc(c)}</button>`).join("");
$("#league").innerHTML += lgs.filter((l) => l.count).map((l) => `<option value="${l.key}">${esc(l.name)}</option>`).join("");
$("#q").value = st.q; $("#sort").value = st.sort; $("#league").value = st.league;

const score = (p) => p.likes + (p.featured ? 120 : 0) + (p.flash ? 60 : 0) + (p.new ? 40 : 0);
let list = [];
function apply() {
  const terms = st.q.toLowerCase().split(/\s+/).filter(Boolean);
  const saved = likes.all();
  list = all.filter((p) =>
    (!st.cat || p.category === st.cat) && (!st.sport || p.sport === st.sport) && (!st.league || p.league === st.league) &&
    (!st.saved || saved.includes(p.slug)) && (!st.deals || p.flash || p.compare_at > p.price) &&
    terms.every((t) => `${p.name} ${p.category} ${p.sport} ${p.league_name} ${p.description}`.toLowerCase().includes(t)));
  const sorters = { hot: (a, b) => score(b) - score(a), new: (a, b) => b.created - a.created, liked: (a, b) => b.likes - a.likes, low: (a, b) => a.price - b.price, high: (a, b) => b.price - a.price };
  list.sort(sorters[st.sort] || sorters.hot);
  $$("[data-cat]").forEach((b) => b.classList.toggle("on", b.dataset.cat === st.cat && !st.saved && !st.deals));
  $$("[data-sport]").forEach((b) => b.classList.toggle("on", b.dataset.sport === st.sport));
  $("[data-saved]").classList.toggle("on", st.saved); $("[data-deals]").classList.toggle("on", st.deals);
  $("#shop-title").textContent = st.saved ? "Your favorites" : st.deals ? "Deals" : st.cat || (st.sport ? `${st.sport} gear` : "Shop all");
  $("#count").textContent = `${list.length} ${list.length === 1 ? "design" : "designs"}`;
  draw();
  const qs = new URLSearchParams(Object.entries({ cat: st.cat, sport: st.sport, league: st.league, q: st.q, sort: st.sort === "hot" ? "" : st.sort, saved: st.saved ? 1 : "", deals: st.deals ? 1 : "" }).filter(([, v]) => v));
  history.replaceState(null, "", "?" + qs);
}
function draw() {
  const el = $("#results");
  if (!list.length) { el.innerHTML = `<div class="empty" style="grid-column:1/-1">${st.saved ? "Tap the heart on any design to save it here." : `Nothing matches yet. <a class="link" href="/design.html">Design your own</a>.`}</div>`; $("#more").hidden = true; return; }
  renderCards(el, list.slice(0, st.n));
  injectAds(el);
  $("#more").hidden = list.length <= st.n;
}
function injectAds(el) {
  const every = Math.max(4, +(store.ads?.every_n) || 12);
  const cards = [...el.querySelectorAll(":scope > .card")];
  for (let i = every - 1, n = 0; i < cards.length; i += every, n++) {
    if (cards[i].nextElementSibling?.classList.contains("ad-slot")) continue;
    const html = adSlot(store, "shop", n);
    if (html) cards[i].insertAdjacentHTML("afterend", html);
  }
  fillAds(el);
}
$("#more").addEventListener("click", () => { const from = st.n; st.n += 24; renderCards($("#results"), list.slice(from, st.n), true); injectAds($("#results")); $("#more").hidden = list.length <= st.n; });
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-cat]"); if (c) { st.cat = c.dataset.cat; st.saved = st.deals = false; st.n = 24; apply(); }
  const s = e.target.closest("[data-sport]"); if (s) { st.sport = s.dataset.sport; st.n = 24; apply(); }
  if (e.target.closest("[data-saved]")) { st.saved = !st.saved; st.deals = false; st.n = 24; apply(); }
  if (e.target.closest("[data-deals]")) { st.deals = !st.deals; st.saved = false; st.n = 24; apply(); }
});
let qT;
$("#q").addEventListener("input", (e) => { st.q = e.target.value; st.n = 24; clearTimeout(qT); qT = setTimeout(() => { apply(); if (st.q.length > 2) track("search", { q: st.q }); }, 180); });
$("#sort").addEventListener("change", (e) => { st.sort = e.target.value; apply(); });
$("#league").addEventListener("change", (e) => { st.league = e.target.value; st.n = 24; apply(); });
$("#surprise").addEventListener("click", () => { const p = (list.length ? list : all)[Math.floor(Math.random() * (list.length || all.length))]; location.href = `/design.html?p=${encodeURIComponent(p.slug)}&remix=1`; });
apply();
