import { $, $$, esc, chrome, catalog, leagues, renderCards, thumbHTML, hydrateThumbs, gear3d, recent, money } from "/js/app.js?v=6";
import { adSlot, fillAds } from "/js/ads.js?v=6";

const s = await chrome();
if (s.hero_eyebrow) $("#hero-eyebrow").textContent = s.hero_eyebrow;
if (s.hero_headline) $("#hero-h1").textContent = s.hero_headline;
if (s.hero_sub) $("#hero-sub").textContent = s.hero_sub;
$("#perk-ship").textContent = `On orders over ${money(s.free_ship_over)}`;
$("#tiers").innerHTML = (s.squad_tiers || []).map(([n, p]) => `<div class="tier"><b>${p}%</b><span>${n}+ pieces</span></div>`).join("");

const all = await catalog();
$("#st-n").textContent = all.length + "+";
const score = (p) => p.likes + (p.featured ? 120 : 0) + (p.flash ? 60 : 0) + (p.new ? 40 : 0);

// ---------------- hero: interactive 3D with item + colorway pickers
const HERO = [
  ["jersey", "Jersey"], ["cleats", "Cleats"], ["sneakers", "Trainers"], ["shorts", "Shorts"], ["socks", "Socks"],
  ["cap", "Cap"], ["hoodie", "Hoodie"], ["ball-soccer", "Ball"],
];
const pickFor = (shape) => all.filter((p) => p.shape === shape && p.featured).sort((a, b) => score(b) - score(a))[0] || all.find((p) => p.shape === shape);
const COLORWAYS = [["#04282e", "#c8f53c", "#ffffff"], ["#ff5a47", "#04282e", "#c8f53c"], ["#2ee6d6", "#04282e", "#ffffff"], ["#3fb8ff", "#ffffff", "#ff5a47"], ["#ffa02e", "#04282e", "#c8f53c"], ["#c8f53c", "#04282e", "#2ee6d6"]];
let heroP = pickFor("jersey"), heroD = { ...heroP.design }, handle = null;
$("#hero-shapes").innerHTML = HERO.filter(([sh]) => all.some((p) => p.shape === sh)).map(([sh, t], i) => `<button type="button" data-shape="${sh}" class="${i ? "" : "on"}" aria-pressed="${!i}">${t}</button>`).join("");
const swatches = () => {
  const base = [heroP.design.primary, heroP.design.secondary, heroP.design.accent];
  $("#hero-sw").innerHTML = [base, ...COLORWAYS].map((c, i) => `<button type="button" data-cw="${i}" class="${i ? "" : "on"}" aria-label="Colorway ${i + 1}" data-c='${JSON.stringify(c)}'><i style="background:linear-gradient(135deg,${c[0]} 50%,${c[1]} 50%)"></i></button>`).join("");
};
swatches();
const setHero = () => { $("#hero-use").href = `/design.html?p=${encodeURIComponent(heroP.slug)}`; handle?.update(heroD); };
setHero();
$("#hero-shapes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-shape]"); if (!b) return;
  $$("#hero-shapes button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
  heroP = pickFor(b.dataset.shape); heroD = { ...heroP.design }; swatches(); setHero();
});
$("#hero-sw").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cw]"); if (!b) return;
  $$("#hero-sw button").forEach((x) => x.classList.toggle("on", x === b));
  const [p, q, a] = JSON.parse(b.dataset.c);
  heroD = { ...heroD, primary: p, secondary: q, accent: a, sleeve: heroD.sleeve ? p : undefined };
  setHero();
});
gear3d().then((m) => {
  const el = $("#hero-3d");
  if (m?.supported?.()) handle = m.mount(el, heroD, { interactive: true, motion: true, autoRotate: true });
  else { el.innerHTML = thumbHTML(heroD, heroP.name, 640); hydrateThumbs(el); }
});

// ---------------- rails and grids
renderCards($("#trend"), [...all].sort((a, b) => score(b) - score(a)).slice(0, 12));
for (const b of $$("[data-rail]")) b.addEventListener("click", () => { const r = $("#" + b.dataset.rail); r.scrollBy({ left: r.clientWidth * 0.9 * b.dataset.dir, behavior: "smooth" }); });
const deals = all.filter((p) => p.flash).slice(0, 4);
if (deals.length) { $("#deals-wrap").hidden = false; renderCards($("#deals"), deals); }
renderCards($("#fresh"), [...all].sort((a, b) => b.created - a.created).slice(0, 8));
{ const ad = adSlot(s, "home", 0); if (ad) { $("#fresh").insertAdjacentHTML("afterend", `<div class="ad-wrap">${ad}</div>`); fillAds(); } }

// gear tiles: one 3D render per category
const cats = [...new Set(all.map((p) => p.category))];
$("#tiles").innerHTML = cats.map((c) => {
  const p = all.filter((x) => x.category === c).sort((a, b) => score(b) - score(a))[0];
  return `<a class="tile" href="/shop.html?cat=${encodeURIComponent(c)}"><div class="th" style="position:relative">${thumbHTML(p.design, c, 320)}</div>${esc(c)}</a>`;
}).join("");
hydrateThumbs($("#tiles"));

// leagues rail with sport filter
const lgs = (await leagues()).filter((l) => l.count);
const sports = ["All", ...new Set(lgs.map((l) => l.sport))];
const lgCard = (l) => `<a class="lg" href="/league.html?l=${l.key}" style="--a:${l.colors[0]};--b:${l.colors[1]};--c:${l.colors[2]}"><small>${esc(l.sport)} · ${esc(l.region)}</small><b>${esc(l.name)}</b><span>${l.count} designs</span></a>`;
const drawLg = (sp) => { $("#lg-rail").innerHTML = lgs.filter((l) => sp === "All" || l.sport === sp).map(lgCard).join(""); };
$("#lg-sports").innerHTML = sports.map((x, i) => `<button class="chip${i ? "" : " on"}" data-sp="${esc(x)}">${esc(x)}</button>`).join("");
$("#lg-sports").addEventListener("click", (e) => { const b = e.target.closest("[data-sp]"); if (!b) return; $$("#lg-sports .chip").forEach((x) => x.classList.toggle("on", x === b)); drawLg(b.dataset.sp); });
drawLg("All");

// team row: three jerseys in one colorway with different names
const tp = pickFor("jersey");
$("#team-cta").href = `/design.html?p=${encodeURIComponent(tp.slug)}&team=1`;
const team = [["KIM", "7"], ["OKAFOR", "10"], ["REYES", "4"]];
const m = await gear3d();
if (m?.supported?.()) {
  for (const [name, number] of team) {
    const img = new Image(); img.alt = `Team jersey for ${name}`;
    $("#squad-row").append(img);
    m.thumb({ ...tp.design, name, number, view: "back" }, 380).then((u) => (img.src = u)).catch(() => img.remove());
  }
}

// recently viewed
const rv = recent.all().map((sl) => all.find((p) => p.slug === sl)).filter(Boolean);
if (rv.length) {
  $("#recent-wrap").hidden = false;
  $("#recent").innerHTML = rv.map((p) => `<a href="/design.html?p=${encodeURIComponent(p.slug)}"><div class="th" style="position:relative">${thumbHTML(p.design, p.name, 200)}</div>${esc(p.name)}</a>`).join("");
  hydrateThumbs($("#recent"));
}
