import { adSlot, fillAds } from "/js/ads.js?v=6";
import { $, $$, esc, money, chrome, catalog, bySlug, cart, toast, burst, gear3d, renderCards, recent, track, encodeDesign, decodeDesign, sizeGuide, thumbHTML, hydrateThumbs, timeLeft } from "/js/app.js?v=6";

const s = await chrome();
const all = await catalog();
const qs = new URLSearchParams(location.search);
let p = qs.get("p") ? await bySlug(qs.get("p")) : null;
if (qs.get("p") && !p) {
  $("#title").textContent = "This one is gone";
  $("#panes").innerHTML = `<p>It may have been retired. Plenty more where that came from.</p><a class="btn btn-ink" href="/shop.html">Shop all</a>`;
  $(".buybar").remove();
  throw 0;
}
if (!p) p = all.find((x) => x.shape === "jersey" && x.featured) || all[0];

const PATTERNS = ["solid", "stripes", "hoops", "sash", "gradient", "chevron", "split", "pinstripe", "camo", "hex", "halftone", "waves", "flames"];
const FONTS = { block: "SF Block", tall: "SF Tall", varsity: "SF Varsity", stencil: "SF Stencil", future: "SF Future", racing: "SF Racing", script: "SF Script", modern: "SF Modern" };
const LOOKS = [["#04282e", "#c8f53c", "#ffffff"], ["#ff5a47", "#04282e", "#c8f53c"], ["#2ee6d6", "#04282e", "#ffffff"], ["#3fb8ff", "#ffffff", "#ff5a47"], ["#ffa02e", "#04282e", "#c8f53c"], ["#c8f53c", "#04282e", "#2ee6d6"], ["#ff3355", "#ffc93c", "#111111"], ["#00d66b", "#0b0b0b", "#ffffff"], ["#ff8fb1", "#04282e", "#ffffff"], ["#1a8cff", "#ffffff", "#ffa02e"], ["#141a1c", "#c8f53c", "#2ee6d6"], ["#04282e", "#2ee6d6", "#ff5a47"]];
const SIZES = { apparel: ["YS", "YM", "YL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"], shoe: ["5", "6", "7", "8", "9", "10", "11", "12", "13"], one: ["One size"], ball: ["Size 5", "Size 4", "Size 3"] };
const shape = p.shape;
const isShirt = /^jersey|hoodie/.test(shape);
const hasNameNum = isShirt || shape === "shorts";
const sizeSet = /cleats|sneakers|skates/.test(shape) ? SIZES.shoe : shape === "ball-soccer" || shape === "ball-volleyball" ? SIZES.ball : /^ball|puck|bottle|bag|cap|beanie|stick|helmet|hoop|bat$|mitt|racket|armband|headband|wristbands|backpack/.test(shape) ? SIZES.one : SIZES.apparel;
const teamable = isShirt || shape === "shorts" || shape === "socks";

const original = { ...p.design, shape };
let d = { ...original, ...(qs.get("d") ? decodeDesign(qs.get("d")) || {} : {}), shape };
let size = sizeSet.includes("M") ? "M" : sizeSet[0];
let team = qs.get("team") === "1" && teamable;
let roster = [];
const undo = [];

// ---------------- header info
recent.push(p.slug);
track("view", { slug: p.slug });
document.title = `${p.name} | ${s.name}`;
$("#crumb").textContent = p.name;
$("#title").textContent = p.name;
$("#meta").innerHTML = [p.flash && `<span class="hot">Flash deal</span>`, p.new && `<span class="new">New drop</span>`, `<span>${esc(p.sport)}</span>`, p.league_name && `<span>${esc(p.league_name)}</span>`, `<span>${esc(p.category)}</span>`].filter(Boolean).join("");
$("#unit").textContent = money(p.price);
if (p.compare_at > p.price) $("#was").textContent = money(p.compare_at);
if (p.flash && p.flash_ends) setInterval(() => ($("#cd").textContent = "Ends in " + timeLeft(p.flash_ends)), 1000);
const eta = new Date(Date.now() + (p.lead_days + 4) * 86400000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
$("#ship").textContent = `Made to order in ${p.lead_days} days. Arrives around ${eta}. Free shipping over ${money(s.free_ship_over)}.`;
$("#desc").textContent = p.description;

// ---------------- 3D viewer
let view = null;
const m = await gear3d();
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (m?.supported?.()) {
  view = m.mount($("#viewer"), d, { interactive: true, motion: !reduce });
  $("#fx").setAttribute("aria-pressed", String(!reduce));
} else {
  $("#viewer").innerHTML = `<canvas width="900" height="900" style="width:100%;height:100%;object-fit:contain"></canvas>`;
  m?.draw2D?.($("#viewer canvas"), d);
  $("#fx").hidden = true;
}
const redraw = () => { view ? view.update(d) : m?.draw2D?.($("#viewer canvas"), d); };
$("#viewer").addEventListener("pointerdown", () => $("#hint").classList.add("gone"), { once: true });
setTimeout(() => $("#hint").classList.add("gone"), 6000);
$("#fx").addEventListener("click", (e) => { const on = e.currentTarget.getAttribute("aria-pressed") !== "true"; e.currentTarget.setAttribute("aria-pressed", on); view?.setMotion(on); });
$("#views").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (!b) return; setView(b.dataset.v); });
function setView(v) { $$("#views button").forEach((x) => x.classList.toggle("on", x.dataset.v === v)); view?.setView(v); }
$("#zin").onclick = () => view?.zoom(1);
$("#zout").onclick = () => view?.zoom(-1);
$("#lights").addEventListener("click", (e) => {
  const b = e.target.closest("[data-l]"); if (!b) return;
  $$("#lights button").forEach((x) => x.classList.toggle("on", x === b));
  $("#stage").className = "lab-stage l-" + b.dataset.l;
  d.lighting = b.dataset.l; view?.setLighting(b.dataset.l);
});

// ---------------- editing
function change(patch, push = true) {
  if (push) { undo.push(JSON.stringify(d)); if (undo.length > 60) undo.shift(); $("#undo").disabled = false; }
  Object.assign(d, patch);
  redraw();
  syncInputs();
}
$("#undo").onclick = () => { if (!undo.length) return; d = JSON.parse(undo.pop()); $("#undo").disabled = !undo.length; redraw(); syncInputs(); };
$("#reset").onclick = () => { change({ ...original }); toast("Back to the original design"); };
function remix() {
  const look = LOOKS[Math.floor(Math.random() * LOOKS.length)];
  const sh = [...look].sort(() => Math.random() - 0.5);
  const patch = { primary: sh[0], secondary: sh[1], accent: sh[2], pattern: PATTERNS[Math.floor(Math.random() * PATTERNS.length)] };
  if (isShirt) { patch.sleeve = Math.random() < 0.6 ? sh[0] : sh[1]; patch.collar = ["crew", "v", "polo"][Math.floor(Math.random() * 3)]; }
  if (Math.random() < 0.4) patch.font = Object.keys(FONTS)[Math.floor(Math.random() * 8)];
  change(patch);
  track("remix", { slug: p.slug });
  const r = $("#remix").getBoundingClientRect();
  burst(r.left + r.width / 2, r.top, sh, 26);
}
$("#remix").onclick = remix;
if (qs.get("remix") === "1") setTimeout(remix, 600);

$("#share").onclick = async () => {
  const link = `${location.origin}/design.html?p=${encodeURIComponent(p.slug)}&d=${encodeDesign(diff())}`;
  track("share", { slug: p.slug });
  if (navigator.share) { try { await navigator.share({ title: p.name, text: "Check out my design", url: link }); return; } catch {} }
  await navigator.clipboard?.writeText(link).catch(() => {});
  toast("Link copied. Anyone who opens it sees your exact design.");
};
$("#shot").onclick = async () => {
  if (!view) return;
  const url = await view.snapshot(1600, 1600);
  const a = document.createElement("a"); a.href = url; a.download = `${p.slug}-my-design.png`; a.click();
  toast("Photo saved");
};
const diff = () => Object.fromEntries(Object.entries(d).filter(([k, v]) => original[k] !== v && k !== "shape"));

// ---------------- panes
const tabs = [["colors", "Colors"], ["pattern", "Pattern"]];
if (isShirt || hasNameNum || "text" in original || "chest" in original || /cap|beanie|bag|bottle|ball|puck|cleats|sneakers|shinguards|gloves|stick|helmet|skates|pads|armband|sleeve|headband|hoop|bat$|mitt|wristbands|backpack|racket/.test(shape)) tabs.push(["letters", "Lettering"]);
tabs.push(["extras", "Effects"], ["size", "Size"]);
$("#tabs").innerHTML = tabs.map(([k, t], i) => `<button type="button" role="tab" data-tab="${k}" class="${i ? "" : "on"}" aria-selected="${!i}">${i + 1}. ${t}</button>`).join("");
const colorField = (k, label) => `<label class="color"><input type="color" data-k="${k}" aria-label="${label}"> ${label} <code data-code="${k}"></code></label>`;
const optRow = (k, items, cls = "") => `<div class="opts" data-opts="${k}">${items.map(([v, html]) => `<button type="button" class="opt ${cls}" data-v="${esc(v)}">${html}</button>`).join("")}</div>`;
const textIn = (k, label, max, ph = "") => `<div class="field"><label for="in-${k}">${label}</label><input class="input" id="in-${k}" data-k="${k}" maxlength="${max}" placeholder="${ph}"></div>`;

$("#panes").innerHTML = `
<div class="pane on" data-pane="colors">
  <div class="field"><span class="lb">Quick looks <small>one tap colorways</small></span><div class="looks">${LOOKS.map((c, i) => `<button type="button" data-look="${i}" aria-label="Colorway ${i + 1}"><i style="background:linear-gradient(135deg,${c[0]} 0 45%,${c[1]} 45% 75%,${c[2]} 75%)"></i></button>`).join("")}</div></div>
  <div class="field"><span class="lb">Your colors</span><div class="colors">${colorField("primary", "Main")}${colorField("secondary", "Second")}${colorField("accent", "Accent")}${isShirt ? colorField("sleeve", "Sleeves") : ""}</div></div>
</div>
<div class="pane" data-pane="pattern">
  <div class="field"><span class="lb">Pattern</span>${optRow("pattern", PATTERNS.map((x) => [x, `<span class="sw" data-sw="${x}"></span>${x[0].toUpperCase() + x.slice(1)}`]))}</div>
  ${isShirt ? `<div class="field"><span class="lb">Collar</span>${optRow("collar", [["crew", "Crew"], ["v", "V neck"], ["polo", "Polo"]])}</div>` : ""}
</div>
<div class="pane" data-pane="letters">
  ${isShirt ? textIn("chest", "Front text", 14, "TEAM NAME") : ""}
  ${!isShirt && shape !== "shorts" ? textIn("text", "Print text", 12, "YOUR TEXT") : ""}
  ${/^ball|bag|bottle/.test(shape) ? textIn("subtext", "Small print", 16, "MATCH PRO") : ""}
  ${hasNameNum ? `<div class="row2">${textIn("name", "Back name", 14, "YOUR NAME")}${textIn("number", "Number", 2, "10")}</div>` : ""}
  <div class="field"><span class="lb">Lettering style</span>${optRow("font", Object.entries(FONTS).map(([k, f]) => [k, `<span style="font-family:'${f}'">${k === "script" ? "Aa" : "AB"}</span><br><small>${k}</small>`]), "font-opt")}</div>
  <div class="field"><span class="lb">Lettering finish</span>${optRow("finish", [["matte", "Matte"], ["gloss", "Gloss"], ["metallic", "Metallic"], ["holo", "Holographic"]])}</div>
  <div class="colors" style="margin-bottom:14px">${colorField("textColor", "Letters")}<label class="color"><input type="checkbox" data-k="outline" style="width:20px;height:20px"> Outline</label></div>
</div>
<div class="pane" data-pane="extras">
  <div class="field"><span class="lb">Patch</span>${optRow("patch", [["none", "None"], ["captain", "Captain"], ["star", "Star"], ["champion", "Champion"], ["flag", "Flag"]])}</div>
  <div class="field"><span class="lb">Lighting <small>for your photo</small></span>${optRow("lighting", [["studio", "Studio"], ["stadium", "Stadium"], ["sunset", "Sunset"], ["neon", "Neon"]])}</div>
  <p class="kbd">Shortcuts: <kbd>R</kbd> remix, <kbd>F</kbd> front, <kbd>B</kbd> back, <kbd>S</kbd> side, <kbd>M</kbd> 4D motion, <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</p>
</div>
<div class="pane" data-pane="size">
  <div class="field"><span class="lb">Size ${sizeSet.length > 3 ? `<small><a href="#" class="link" data-size-guide>Size guide</a></small>` : ""}</span><div class="sizes" id="sizes">${sizeSet.map((x) => `<button type="button" data-size="${x}">${x}</button>`).join("")}</div>
  ${sizeSet === SIZES.apparel && s.big_size_fee ? `<p style="color:var(--mute);font-size:13px;margin-top:8px">2XL and up add ${money(s.big_size_fee)}.</p>` : ""}</div>
</div>`;

// pattern swatch previews (tiny css versions)
const swCSS = { solid: "var(--a)", stripes: "repeating-linear-gradient(90deg,var(--a) 0 6px,var(--b) 6px 10px)", hoops: "repeating-linear-gradient(0deg,var(--a) 0 6px,var(--b) 6px 11px)", sash: "linear-gradient(120deg,var(--a) 40%,var(--b) 40% 60%,var(--a) 60%)", gradient: "linear-gradient(var(--a),var(--b))", chevron: "linear-gradient(135deg,var(--a) 33%,var(--b) 33% 50%,var(--a) 50%)", split: "linear-gradient(90deg,var(--a) 50%,var(--b) 50%)", pinstripe: "repeating-linear-gradient(90deg,var(--a) 0 5px,var(--b) 5px 6px)", camo: "radial-gradient(circle at 30% 30%,var(--b) 18%,transparent 19%),radial-gradient(circle at 70% 70%,var(--b) 20%,transparent 21%),var(--a)", hex: "radial-gradient(circle,var(--b) 25%,transparent 26%) 0 0/9px 9px,var(--a)", halftone: "radial-gradient(circle,var(--b) 30%,transparent 32%) 0 0/6px 6px,var(--a)", waves: "repeating-radial-gradient(circle at 0 100%,var(--a) 0 5px,var(--b) 5px 8px)", flames: "linear-gradient(0deg,var(--b),var(--a) 70%)" };

function syncInputs() {
  for (const el of $$("[data-k]")) {
    const k = el.dataset.k;
    if (el.type === "color") el.value = d[k] || (k === "sleeve" ? d.primary : k === "textColor" ? "#ffffff" : "#000000");
    else if (el.type === "checkbox") el.checked = !!d[k];
    else if (document.activeElement !== el) el.value = d[k] || "";
  }
  for (const c of $$("[data-code]")) c.textContent = (d[c.dataset.code] || "").toUpperCase();
  for (const row of $$("[data-opts]")) for (const b of $$(".opt", row)) b.classList.toggle("on", (d[row.dataset.opts] || (row.dataset.opts === "patch" ? "none" : row.dataset.opts === "lighting" ? "studio" : "")) === b.dataset.v);
  for (const sw of $$("[data-sw]")) { sw.style.setProperty("--a", d.primary); sw.style.setProperty("--b", d.secondary); sw.style.background = swCSS[sw.dataset.sw]; }
  $$("#sizes button").forEach((b) => b.classList.toggle("on", b.dataset.size === size));
}
let colorT;
$("#panes").addEventListener("input", (e) => {
  const k = e.target.dataset.k; if (!k) return;
  if (e.target.type === "color") {
    if (!colorT) { undo.push(JSON.stringify(d)); $("#undo").disabled = false; }
    clearTimeout(colorT); colorT = setTimeout(() => (colorT = null), 600);
    change({ [k]: e.target.value }, false);
  } else if (e.target.type === "checkbox") change({ [k]: e.target.checked });
  else {
    let v = e.target.value.toUpperCase();
    if (k === "number") v = v.replace(/\D/g, "").slice(0, 2);
    change({ [k]: v }, false);
    if (k === "name" || k === "number") setView("back");
    else if (k === "chest") setView("front");
  }
});
$("#panes").addEventListener("click", (e) => {
  const look = e.target.closest("[data-look]");
  if (look) { const [a, b, c] = LOOKS[look.dataset.look]; change({ primary: a, secondary: b, accent: c, ...(isShirt ? { sleeve: a } : {}) }); }
  const opt = e.target.closest(".opt");
  if (opt) {
    const k = opt.closest("[data-opts]").dataset.opts;
    if (k === "lighting") { $(`#lights [data-l="${opt.dataset.v}"]`).click(); syncInputs(); }
    else change({ [k]: opt.dataset.v });
  }
  const sz = e.target.closest("[data-size]");
  if (sz) { size = sz.dataset.size; syncInputs(); price(); }
});
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]"); if (!b) return;
  $$("#tabs button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b); });
  $$(".pane").forEach((x) => x.classList.toggle("on", x.dataset.pane === b.dataset.tab));
});
syncInputs();

// ---------------- team order
const tiers = (s.squad_tiers || []).slice().sort((a, b) => a[0] - b[0]);
function drawTeam() {
  const box = $("#team-box");
  if (!teamable) { box.hidden = true; return; }
  box.classList.toggle("on", team);
  box.innerHTML = `<label class="switch"><input type="checkbox" id="team-on" ${team ? "checked" : ""}> Team order <small style="font-weight:500;color:var(--mute)">every player gets their own name, number and size</small></label>
  <div class="tier-bar">${tiers.map(([n, pc]) => `<span data-tier="${n}">${n}+ save ${pc}%</span>`).join("")}</div>
  ${team ? `<div class="roster">
    <label class="lb" for="paste" style="font-weight:800;font-size:13px">Paste your roster <small style="font-weight:500;color:var(--mute)">one player per line: name, number, size</small></label>
    <textarea class="input" id="paste" rows="3" placeholder="KIM, 7, M&#10;OKAFOR, 10, L&#10;REYES, 4, S"></textarea>
    <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn btn-ink btn-sm" id="paste-go">Add players</button><button type="button" class="btn btn-line btn-sm" id="row-add">+ One player</button></div>
    <table><thead><tr><th>Name</th><th style="width:70px">No.</th><th style="width:90px">Size</th><th style="width:30px"></th></tr></thead><tbody>${roster.map((r, i) => `<tr data-i="${i}"><td><input data-f="name" value="${esc(r.name)}" maxlength="14" aria-label="Name"></td><td><input data-f="number" value="${esc(r.number)}" maxlength="2" inputmode="numeric" aria-label="Number"></td><td><select data-f="size" aria-label="Size">${sizeSet.map((z) => `<option ${z === r.size ? "selected" : ""}>${z}</option>`).join("")}</select></td><td><button class="x" type="button" data-del="${i}" aria-label="Remove">&times;</button></td></tr>`).join("")}</tbody></table>
  </div>` : ""}`;
  $("#qty-box").hidden = team;
  price();
}
$("#team-box").addEventListener("change", (e) => {
  if (e.target.id === "team-on") { team = e.target.checked; if (team && !roster.length) roster = [{ name: d.name || "", number: d.number || "", size }]; drawTeam(); }
  const f = e.target.dataset.f;
  if (f) { const i = +e.target.closest("tr").dataset.i; roster[i][f] = f === "size" ? e.target.value : e.target.value.toUpperCase(); }
});
$("#team-box").addEventListener("input", (e) => {
  const f = e.target.dataset.f; if (!f || f === "size") return;
  const i = +e.target.closest("tr").dataset.i; roster[i][f] = e.target.value.toUpperCase();
  change({ name: roster[i].name, number: roster[i].number }, false); setView("back");
});
$("#team-box").addEventListener("click", (e) => {
  if (e.target.id === "paste-go") {
    const lines = $("#paste").value.split(/\n+/).map((l) => l.split(/[,\t;]+/).map((x) => x.trim())).filter((x) => x[0]);
    for (const [name, number = "", sz = size] of lines) roster.push({ name: name.toUpperCase().slice(0, 14), number: number.replace(/\D/g, "").slice(0, 2), size: sizeSet.includes(sz.toUpperCase()) ? sz.toUpperCase() : size });
    toast(`${lines.length} players added`); drawTeam();
  }
  if (e.target.id === "row-add") { roster.push({ name: "", number: "", size }); drawTeam(); }
  const del = e.target.closest("[data-del]"); if (del) { roster.splice(+del.dataset.del, 1); drawTeam(); }
});

// ---------------- price + add to bag
const qtyIn = $("#qty");
const qty = () => Math.max(1, Math.min(500, parseInt(qtyIn.value) || 1));
$("#qm").onclick = () => { qtyIn.value = Math.max(1, qty() - 1); price(); };
$("#qp").onclick = () => { qtyIn.value = qty() + 1; price(); };
qtyIn.addEventListener("input", price);
function price() {
  const big = (z) => (["2XL", "3XL", "4XL"].includes(z) ? s.big_size_fee || 0 : 0);
  const pieces = team ? roster.length : qty();
  const sub = team ? roster.reduce((t, r) => t + p.price + big(r.size), 0) : (p.price + big(size)) * pieces;
  let rate = 0; for (const [n, pc] of tiers) if (pieces >= n) rate = pc;
  const total = sub * (1 - rate / 100);
  $("#total").textContent = money(total);
  const next = tiers.find(([n]) => pieces < n);
  $("#total-note").textContent = pieces > 1 ? `${pieces} pieces${rate ? `, ${rate}% team savings` : ""}${next ? `. ${next[0] - pieces} more to save ${next[1]}%` : ""}` : next ? `each. Order ${next[0]}+ to save ${next[1]}%` : "each";
  $$("[data-tier]").forEach((x) => x.classList.toggle("on", pieces >= +x.dataset.tier));
}
$("#add").onclick = (e) => {
  if (team && !roster.length) { toast("Add at least one player to your roster"); return; }
  if (team && roster.some((r) => hasNameNum && !r.name && !r.number)) { toast("Each player needs a name or a number"); return; }
  cart.add({ slug: p.slug, name: p.name, price: p.price, size, qty: team ? roster.length : qty(), design: { ...d }, roster: team ? roster.map((r) => ({ ...r })) : undefined });
  const r = e.currentTarget.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top, [d.primary, d.secondary, d.accent, "#c8f53c"], 50);
  toast(`Added to your bag. <a href="/cart.html">Check out</a>`, 4000);
};
drawTeam();

// ---------------- keyboard
document.addEventListener("keydown", (e) => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); $("#undo").click(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "r") remix();
  if (k === "f") setView("front");
  if (k === "b") setView("back");
  if (k === "s") setView("side");
  if (k === "m") $("#fx").click();
  if (k === "+" || k === "=") view?.zoom(1);
  if (k === "-") view?.zoom(-1);
});

// ---------------- related
const rel = all.filter((x) => x.slug !== p.slug && (x.league && x.league === p.league || x.category === p.category)).sort(() => Math.random() - 0.5).slice(0, 8);
renderCards($("#more"), rel);
{ const ad = adSlot(s, "product", 0); if (ad) { $("#more").insertAdjacentHTML("afterend", `<div class="ad-wrap">${ad}</div>`); fillAds(); } }
