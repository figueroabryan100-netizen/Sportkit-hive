import { $, $$, esc, chrome, catalog, leagues, renderCards, gear3d, thumbHTML, hydrateThumbs } from "/js/app.js?v=6";

await chrome();
const lgs = (await leagues()).filter((l) => l.count);
const lgCard = (l) => `<a class="lg" href="/league.html?l=${l.key}" style="--a:${l.colors[0]};--b:${l.colors[1]};--c:${l.colors[2]}"><small>${esc(l.sport)} · ${esc(l.region)}</small><b>${esc(l.name)}</b><span>${esc(l.tagline)}</span><span style="margin-top:6px;font-weight:800">${l.count} designs &rarr;</span></a>`;

if ($("#lg-index")) {
  const sports = ["All", ...new Set(lgs.map((l) => l.sport))];
  $("#lg-sports").innerHTML = sports.map((x, i) => `<button class="chip${i ? "" : " on"}" data-sp="${esc(x)}">${esc(x)}</button>`).join("");
  const draw = (sp) => ($("#lg-index").innerHTML = lgs.filter((l) => sp === "All" || l.sport === sp).map(lgCard).join(""));
  $("#lg-sports").addEventListener("click", (e) => { const b = e.target.closest("[data-sp]"); if (!b) return; $$("#lg-sports .chip").forEach((x) => x.classList.toggle("on", x === b)); draw(b.dataset.sp); });
  draw("All");
}

if ($("#lg-grid")) {
  const key = new URLSearchParams(location.search).get("l");
  const l = lgs.find((x) => x.key === key);
  if (!l) { location.replace("/leagues.html"); throw 0; }
  document.title = `${l.name} collection | SquadForge`;
  const ban = $("#lg-banner");
  ban.style.cssText = `--a:${l.colors[0]};--b:${l.colors[1]};--c:${l.colors[2]}`;
  $("#lg-meta").textContent = `${l.sport} · ${l.region}`;
  $("#lg-name").textContent = l.name;
  $("#lg-tag").textContent = l.tagline;
  const items = (await catalog()).filter((p) => p.league === key);
  $("#lg-count").textContent = `${items.length} designs in this collection`;
  const hero = items.find((p) => p.category === "Jerseys") || items[0];
  $("#lg-team").href = `/design.html?p=${encodeURIComponent(hero.slug)}&team=1`;
  gear3d().then((m) => {
    if (m?.supported?.()) m.mount($("#lg-pic"), hero.design, { interactive: true, motion: true, autoRotate: true });
    else { $("#lg-pic").innerHTML = thumbHTML(hero.design, hero.name, 600); hydrateThumbs($("#lg-pic")); }
  });
  const cats = ["All", ...new Set(items.map((p) => p.category))];
  $("#lg-cats").innerHTML = cats.map((c, i) => `<button class="chip${i ? "" : " on"}" data-c="${esc(c)}">${esc(c)}</button>`).join("");
  const draw = (c) => renderCards($("#lg-grid"), items.filter((p) => c === "All" || p.category === c));
  $("#lg-cats").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; $$("#lg-cats .chip").forEach((x) => x.classList.toggle("on", x === b)); draw(b.dataset.c); });
  draw("All");
}
