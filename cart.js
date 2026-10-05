import { $, $$, esc, money, chrome, cart, catalog, card, postJSON, thumbHTML, hydrateThumbs, toast, burst, track, payLabel } from "/js/app.js?v=6";
import { payPanel } from "/js/pay.js?v=6";

const s = await chrome();
const root = $("#root");
const LSK = "sf_checkout";
const saved = JSON.parse(localStorage.getItem(LSK) || "{}");
const st = { extras: {}, step: "bag", code: saved.code || "", ship: "standard", pay: "", customer: saved.customer || {}, note: "", quote: null, order: null };

function progress(i) { $$("#progress li").forEach((li, j) => li.classList.toggle("on", j <= i)); }
const persist = () => localStorage.setItem(LSK, JSON.stringify({ code: st.code, customer: st.customer }));

async function quote() {
  const items = cart.items();
  if (!items.length) return null;
  try {
    st.quote = await postJSON("/api/quote", { items, code: st.code, shipping_method: st.ship, extras: st.extras });
    return st.quote;
  } catch (e) {
    if (st.code && /code/i.test(e.message)) { const bad = st.code; st.code = ""; persist(); st.quote = await postJSON("/api/quote", { items, shipping_method: st.ship, extras: st.extras }); st.codeMsg = [false, e.message || `${bad} isn't valid`]; return st.quote; }
    toast(esc(e.message)); throw e;
  }
}
const sumHTML = (q) => `
  <div class="r"><span>Subtotal (${q.qty} ${q.qty === 1 ? "piece" : "pieces"})</span><span>${money(q.subtotal)}</span></div>
  ${q.squad_discount ? `<div class="r save"><span>Team savings ${q.squad_rate}%</span><span>&minus;${money(q.squad_discount)}</span></div>` : ""}
  ${q.discount ? `<div class="r save"><span>Code ${esc(q.discount_code)}</span><span>&minus;${money(q.discount)}</span></div>` : ""}
  ${(q.extras || []).map((x) => `<div class="r"><span>${esc(x.label)}</span><span>${money(x.amount)}</span></div>`).join("")}
  <div class="r"><span>Shipping${st.ship === "express" ? " (express)" : ""}</span><span>${q.shipping ? money(q.shipping) : "Free"}</span></div>
  <div class="r tot"><span>Total</span><span>${money(q.total)}</span></div>`;

// ---------------------------------------------------------------- step 1: bag
async function bag() {
  st.step = "bag"; progress(0);
  const items = cart.items();
  if (!items.length) {
    root.innerHTML = `<div class="empty"><h2>Your bag is empty</h2><p>Your next favorite kit is one tap away.</p><a class="btn btn-ink" href="/shop.html">Start shopping</a></div>`;
    return;
  }
  const q = await quote();
  const tiers = (s.squad_tiers || []).slice().sort((a, b) => a[0] - b[0]);
  const next = tiers.find(([n]) => q.qty < n);
  const left = Math.max(0, s.free_ship_over - (q.subtotal - q.squad_discount - q.discount));
  root.innerHTML = `<div class="co">
    <div class="box">${items.map((it, i) => `
      <div class="line">
        <a class="th" href="/design.html?p=${encodeURIComponent(it.slug)}">${thumbHTML(it.design, it.name, 240)}</a>
        <div><b>${esc(it.name)}</b>
          <small>${it.roster?.length ? `Team order: ${it.roster.length} players` : `Size ${esc(it.size)}`}${it.design.name ? ` · ${esc(it.design.name)}` : ""}${it.design.number ? ` #${esc(it.design.number)}` : ""}</small>
          <small style="display:flex;gap:4px;margin-top:4px">${[it.design.primary, it.design.secondary, it.design.accent].map((c) => `<i style="width:12px;height:12px;border-radius:50%;background:${esc(c)};border:1px solid #0002"></i>`).join("")}</small>
          <div class="ctl">${it.roster?.length ? `<button data-roster="${i}">View roster</button>` : `<button data-dec="${i}" aria-label="One less">&minus;</button><b>${it.qty}</b><button data-inc="${i}" aria-label="One more">+</button>`}<button data-dup="${i}">Duplicate</button><button data-rm="${i}">Remove</button></div>
        </div>
        <div class="amt">${money(q.items[i]?.line ?? it.price * it.qty)}</div>
      </div>`).join("")}
      <div style="display:flex;justify-content:space-between;margin-top:12px"><a class="link" href="/shop.html">Keep shopping</a><button class="btn btn-line btn-sm" id="clear">Clear bag</button></div>
    </div>
    <div class="box sum">
      <h3>Summary</h3>
      <div class="ship-meter">${left > 0 ? `Add ${money(left)} more for free shipping` : "You unlocked free shipping &#127881;"}<div class="bar"><i style="width:${Math.min(100, (100 * (s.free_ship_over - left)) / s.free_ship_over)}%"></i></div></div>
      ${next ? `<div class="ship-meter">Add ${next[0] - q.qty} more ${next[0] - q.qty === 1 ? "piece" : "pieces"} to save ${next[1]}% on everything</div>` : ""}
      ${sumHTML(q)}
      <form class="code-row" id="code-form"><input class="input" id="code" placeholder="Discount code" value="${esc(st.code)}" aria-label="Discount code"><button class="btn btn-line btn-sm">Apply</button></form>
      <p class="msg ${st.codeMsg?.[0] ? "ok" : "bad"}" id="code-msg">${esc(st.codeMsg?.[1] || "")}</p>
      <button class="btn btn-lime" style="width:100%;margin-top:12px" id="go">Checkout &rarr;</button>
      <p style="font-size:12.5px;color:var(--mute);margin-top:12px;text-align:center">Pay with ${s.payments.length ? s.payments.map((p) => esc(p.label.split(" (")[0])).join(", ") : "card, PayPal, Cash App, crypto and more"}</p>
    </div></div>`;
  hydrateThumbs(root);
  st.codeMsg = null;
  completeKit(items);
}
// "Complete the kit": suggest matching pieces the bag doesn't have yet, pre-colored to match the first item
async function completeKit(items) {
  const all = await catalog();
  const have = new Set(items.map((i) => all.find((p) => p.slug === i.slug)?.category));
  const lead = items[0];
  const want = ["Shorts", "Socks", "Caps", "Footwear", "Bags", "Balls"].filter((c) => !have.has(c));
  const picks = want.map((c) => all.filter((p) => p.category === c).sort((a, b) => b.likes - a.likes)[0]).filter(Boolean).slice(0, 4)
    .map((p) => ({ ...p, design: { ...p.design, primary: lead.design.primary, secondary: lead.design.secondary, accent: lead.design.accent } }));
  if (!picks.length || st.step !== "bag") return;
  root.insertAdjacentHTML("beforeend", `<section style="margin-top:34px"><h2>Complete the kit</h2><p style="color:var(--mute)">Matched to your colors. Add in one tap.</p><div class="grid" id="kit">${picks.map((p) => card(p).replace("</article>", `<div style="padding:0 16px 16px"><button class="btn btn-ink btn-sm" style="width:100%" data-up="${esc(p.slug)}">Add matching ${esc(p.category.toLowerCase().replace(/s$/, ""))}</button></div></article>`)).join("")}</div></section>`);
  hydrateThumbs($("#kit"));
  $("#kit").addEventListener("click", (e) => {
    const b = e.target.closest("[data-up]"); if (!b) return;
    const p = picks.find((x) => x.slug === b.dataset.up);
    const sizes = /Footwear/.test(p.category) ? "9" : /Caps|Bags|Balls|Bottles/.test(p.category) ? "One size" : items[0].size || "M";
    cart.add({ slug: p.slug, name: p.name, price: p.price, size: sizes, qty: 1, design: p.design });
    track("upsell_add", { slug: p.slug });
    burst(e.clientX, e.clientY, [p.design.primary, p.design.secondary, "#c8f53c"], 30);
    bag();
  });
}
root.addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  const items = cart.items();
  const i = +(t.dataset.inc ?? t.dataset.dec ?? t.dataset.rm ?? t.dataset.dup ?? t.dataset.roster);
  if ("inc" in t.dataset) { items[i].qty++; cart.save(items); bag(); }
  if ("dec" in t.dataset) { items[i].qty = Math.max(1, items[i].qty - 1); cart.save(items); bag(); }
  if ("rm" in t.dataset) { items.splice(i, 1); cart.save(items); bag(); }
  if ("dup" in t.dataset) { items.splice(i + 1, 0, { ...items[i], id: Math.random().toString(36).slice(2, 9) }); cart.save(items); bag(); }
  if ("roster" in t.dataset) {
    const { modal } = await import("/js/app.js?v=6");
    modal(`<h3>Roster</h3><table class="t"><tr><th>Name</th><th>No.</th><th>Size</th></tr>${items[i].roster.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.number)}</td><td>${esc(r.size)}</td></tr>`).join("")}</table><p style="margin-top:12px"><a class="link" href="/design.html?p=${encodeURIComponent(items[i].slug)}&team=1">Start a new team order</a></p>`);
  }
  if (t.id === "clear" && confirm("Remove everything from your bag?")) { cart.clear(); bag(); }
  if (t.id === "go") { track("checkout_start"); details(); }
});
root.addEventListener("submit", async (e) => {
  if (e.target.id !== "code-form") return;
  e.preventDefault();
  const code = $("#code").value.trim().toUpperCase();
  if (!code) { st.code = ""; persist(); return bag(); }
  const r = await postJSON("/api/discount/check", { code, subtotal: st.quote.subtotal - st.quote.squad_discount }).catch((x) => ({ ok: false, message: x.message }));
  if (r.ok) { st.code = r.code; persist(); st.codeMsg = [true, r.message]; const b = e.target.getBoundingClientRect(); burst(b.left + b.width / 2, b.top, undefined, 40); }
  else st.codeMsg = [false, r.message];
  bag();
});

// ---------------------------------------------------------------- step 2: details + payment choice
async function details() {
  st.step = "details"; progress(1);
  const q = st.quote || (await quote());
  const c = st.customer;
  const pays = s.payments || [];
  const groups = [["Card and wallets", ["card", "applepay", "googlepay", "shopify"]], ["Pay later", ["klarna", "affirm"]], ["Apps", ["paypal", "venmo", "cashapp", "zelle", "revolut", "wise", "chime"]], ["Crypto", ["btc", "eth", "usdt", "usdc", "sol", "ltc", "doge"]], ["Other", ["bank", "cash"]]];
  if (!st.pay && pays[0]) st.pay = pays[0].key;
  const f = (k, label, attrs = "") => `<label>${label}<input class="input" name="${k}" value="${esc(c[k] || "")}" ${attrs}></label>`;
  root.innerHTML = `<div class="co">
    <form class="box form" id="details" novalidate>
      <h3>Contact</h3>
      <div class="two">${f("name", "Full name", 'required autocomplete="name"')}${f("email", "Email", 'type="email" required autocomplete="email"')}</div>
      ${f("phone", "Phone <small style=\"font-weight:500;color:var(--mute)\">optional, for delivery updates</small>", 'type="tel" autocomplete="tel"')}
      <h3 style="margin-top:10px">Shipping address</h3>
      ${f("address1", "Address", 'required autocomplete="address-line1"')}
      ${f("address2", "Apartment, suite <small style=\"font-weight:500;color:var(--mute)\">optional</small>", 'autocomplete="address-line2"')}
      <div class="three">${f("city", "City", 'required autocomplete="address-level2"')}${f("region", "State", 'autocomplete="address-level1"')}${f("postal", "ZIP", 'autocomplete="postal-code"')}</div>
      ${f("country", "Country", 'autocomplete="country-name" placeholder="United States"')}
      <h3 style="margin-top:10px">Delivery</h3>
      <div class="ship-opts">
        <label class="pm ${st.ship === "standard" ? "on" : ""}"><input type="radio" name="ship" value="standard" ${st.ship === "standard" ? "checked" : ""}><b>Standard <small style="font-weight:500;color:var(--mute)">3 to 6 business days after production</small></b><span>${q.subtotal - q.squad_discount - q.discount >= s.free_ship_over ? "Free" : money(s.ship_flat)}</span></label>
        <label class="pm ${st.ship === "express" ? "on" : ""}"><input type="radio" name="ship" value="express" ${st.ship === "express" ? "checked" : ""}><b>Express <small style="font-weight:500;color:var(--mute)">1 to 2 business days after production</small></b><span>${money(s.ship_express)}</span></label>
      </div>
      ${s.extras?.rush_fee || s.extras?.gift_wrap_fee ? `<h3 style="margin-top:10px">Upgrades</h3><div class="ship-opts">
        ${s.extras.rush_fee ? `<label class="pm ${st.extras.rush ? "on" : ""}"><input type="checkbox" name="ex-rush" ${st.extras.rush ? "checked" : ""}><b>Rush production <small style="font-weight:500;color:var(--mute)">made in ${s.extras.rush_days || 5} days, jumps the queue</small></b><span>+${money(s.extras.rush_fee)}</span></label>` : ""}
        ${s.extras.gift_wrap_fee ? `<label class="pm ${st.extras.gift ? "on" : ""}"><input type="checkbox" name="ex-gift" ${st.extras.gift ? "checked" : ""}><b>Gift wrap and note <small style="font-weight:500;color:var(--mute)">write your message in the notes below</small></b><span>+${money(s.extras.gift_wrap_fee)}</span></label>` : ""}
      </div>` : ""}
      <h3 style="margin-top:10px">Payment</h3>
      ${pays.length ? `<div class="pm-list">${groups.map(([g, keys]) => { const list = pays.filter((p) => keys.includes(p.key)); return list.length ? `<div class="pm-group">${g}</div>` + list.map((p) => `<label class="pm ${st.pay === p.key ? "on" : ""}"><input type="radio" name="pay" value="${p.key}" ${st.pay === p.key ? "checked" : ""}><b>${esc(p.label)}</b><span class="icons">${p.icons.map((i) => `<span>${esc(payLabel(i))}</span>`).join("")}</span></label>`).join("") : ""; }).join("")}</div>`
      : `<p class="ship-meter">The shop owner is still setting up payments. Please check back soon${s.support_email ? ` or email <a class="link" href="mailto:${esc(s.support_email)}">${esc(s.support_email)}</a>` : ""}.</p>`}
      <label style="margin-top:6px">Anything we should know? <small style="font-weight:500;color:var(--mute)">optional</small><textarea class="input" name="note" rows="2" maxlength="600">${esc(st.note)}</textarea></label>
      <p class="err" id="err" role="alert"></p>
      <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap"><button type="button" class="btn btn-line" id="back">&larr; Back to bag</button><button class="btn btn-lime" id="place" ${pays.length ? "" : "disabled"}>Place order</button></div>
    </form>
    <div class="box sum"><h3>Summary</h3>${sumHTML(q)}</div>
  </div>`;
  scrollTo({ top: 0, behavior: "smooth" });
}
root.addEventListener("change", async (e) => {
  if (e.target.name === "pay") { st.pay = e.target.value; $$(".pm-list .pm").forEach((l) => l.classList.toggle("on", l.contains(e.target))); }
  if (e.target.name?.startsWith("ex-")) {
    st.extras[e.target.name.slice(3)] = e.target.checked;
    e.target.closest(".pm").classList.toggle("on", e.target.checked);
    const q = await quote(); $(".sum").innerHTML = `<h3>Summary</h3>${sumHTML(q)}`;
  }
  if (e.target.name === "ship") {
    st.ship = e.target.value; saveForm();
    $$(".ship-opts .pm").forEach((l) => l.classList.toggle("on", l.contains(e.target)));
    const q = await quote(); $(".sum").innerHTML = `<h3>Summary</h3>${sumHTML(q)}`;
  }
});
function saveForm() {
  const form = $("#details"); if (!form) return;
  const fd = new FormData(form);
  for (const k of ["name", "email", "phone", "address1", "address2", "city", "region", "postal", "country"]) st.customer[k] = (fd.get(k) || "").trim();
  st.note = fd.get("note") || "";
  persist();
}
root.addEventListener("input", (e) => { if (e.target.closest("#details")) saveForm(); });
root.addEventListener("click", (e) => { if (e.target.id === "back") bag(); });
root.addEventListener("submit", async (e) => {
  if (e.target.id !== "details") return;
  e.preventDefault();
  saveForm();
  const c = st.customer;
  const err = $("#err");
  if (!c.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email) || !c.address1 || !c.city) { err.textContent = "Please fill in your name, a valid email and your shipping address."; return; }
  if (!st.pay) { err.textContent = "Choose how you'd like to pay."; return; }
  const btn = $("#place"); btn.disabled = true; btn.textContent = "Placing order...";
  try {
    st.order = await postJSON("/api/orders", { items: cart.items(), customer: c, note: st.note, code: st.code, payment: st.pay, shipping_method: st.ship, extras: st.extras });
    cart.clear(); st.code = ""; persist();
    localStorage.setItem("sf_last_order", JSON.stringify({ code: st.order.code, email: c.email }));
    pay();
  } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = "Place order"; }
});

// ---------------------------------------------------------------- step 3: pay
function pay() {
  st.step = "pay"; progress(2);
  const o = st.order;
  root.innerHTML = `<div class="co"><div class="box">${payPanel(o, o.payment)}</div>
    <div class="box sum"><h3>Order ${esc(o.code)}</h3>${o.items.map((i) => `<div class="r"><span>${i.qty} &times; ${esc(i.name)}</span><span>${money(i.line)}</span></div>`).join("")}
    ${o.squad_discount ? `<div class="r save"><span>Team savings</span><span>&minus;${money(o.squad_discount)}</span></div>` : ""}${o.discount ? `<div class="r save"><span>Discount</span><span>&minus;${money(o.discount)}</span></div>` : ""}
    <div class="r"><span>Shipping</span><span>${o.shipping ? money(o.shipping) : "Free"}</span></div><div class="r tot"><span>Total</span><span>${money(o.total)}</span></div>
    <p style="font-size:13px;color:var(--mute);margin-top:12px">Keep your order number. You can come back to this page any time from <a class="link" href="/track.html">Track order</a>.</p></div></div>`;
  scrollTo({ top: 0, behavior: "smooth" });
  $("#paid-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await postJSON(`/api/orders/${o.code}/paid`, { email: o.email, reference: new FormData(e.target).get("ref") }).catch(() => {});
    done();
  });
}

// ---------------------------------------------------------------- step 4: done
function done() {
  progress(3);
  const o = st.order;
  root.innerHTML = `<div class="box done-hero"><div class="tick"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></div>
    <h2>You're on the roster!</h2>
    <p>Order <b>${esc(o.code)}</b> is in. We'll confirm your payment and start making your gear.</p>
    <ol class="steps-list"><li>We confirm your payment (usually within a few hours).</li><li>Your gear goes into production.</li><li>It ships with a tracking number you can see on the Track page.</li></ol>
    ${o.referral_code ? `<div class="ship-meter" style="max-width:460px;margin:16px auto;text-align:center"><b>Give ${o.referral_percent}%, share the love</b><br>Friends get ${o.referral_percent}% off with your code<div class="handle" style="display:inline-flex;gap:10px;align-items:center;font-size:22px;margin-top:8px">${esc(o.referral_code)} <button type="button" class="btn btn-ink btn-sm" data-copy="${esc(o.referral_code)}">Copy</button></div></div>` : ""}
    <div class="cta" style="justify-content:center"><a class="btn btn-ink" href="/track.html?code=${encodeURIComponent(o.code)}&email=${encodeURIComponent(o.email)}">Track this order</a><a class="btn btn-line" href="/shop.html">Keep shopping</a></div></div>`;
  burst(innerWidth / 2, innerHeight / 3);
  setTimeout(() => burst(innerWidth / 4, innerHeight / 2), 300);
  setTimeout(() => burst((innerWidth * 3) / 4, innerHeight / 2), 600);
}

bag();
