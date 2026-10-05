import { $, esc, money, chrome, getJSON, thumbHTML, hydrateThumbs } from "/js/app.js?v=6";
import { payPanel } from "/js/pay.js?v=6";

await chrome();
const form = $("#track-form");
const qs = new URLSearchParams(location.search);
const last = JSON.parse(localStorage.getItem("sf_last_order") || "null");
form.code.value = qs.get("code") || last?.code || "";
form.email.value = qs.get("email") || last?.email || "";
const FLOW = ["awaiting_payment", "payment_review", "paid", "in_production", "shipped", "delivered"];
const LABEL = { awaiting_payment: "Order placed", payment_review: "Checking payment", paid: "Paid", in_production: "In production", shipped: "Shipped", delivered: "Delivered" };
const fmt = (t) => new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function look() {
  $("#err").textContent = "";
  try {
    const o = await getJSON(`/api/track?code=${encodeURIComponent(form.code.value.trim())}&email=${encodeURIComponent(form.email.value.trim())}`);
    const cur = FLOW.indexOf(o.status);
    const when = Object.fromEntries(o.history.map((h) => [h.status, h.at]));
    const ended = ["cancelled", "refunded"].includes(o.status);
    $("#result").innerHTML = `<hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">${esc(o.code)}</h3><span class="status-pill">${esc(o.status_label)}</span></div>
      ${!ended && cur < 4 ? `<p style="color:var(--mute);margin-top:8px">Estimated delivery around <b>${new Date((o.eta + 4 * 86400) * 1000).toLocaleDateString(undefined, { month: "long", day: "numeric" })}</b></p>` : ""}
      ${o.tracking ? `<p><b>${esc(o.carrier || "Tracking")}:</b> ${esc(o.tracking)}</p>` : ""}
      ${ended ? `<p>This order was ${esc(o.status_label.toLowerCase())}.</p>` : `<ul class="timeline">${FLOW.map((k, i) => `<li class="${i < cur ? "done" : i === cur ? "cur" : ""}"><b>${LABEL[k]}</b><small>${when[k] ? fmt(when[k]) : ""}</small></li>`).join("")}</ul>`}
      <div style="display:grid;gap:10px;margin-top:10px">${o.items.map((i) => `<div style="display:flex;gap:12px;align-items:center"><div style="position:relative;width:64px;height:64px;border-radius:12px;background:var(--paper);overflow:hidden">${thumbHTML(i.design, i.name, 160)}</div><div><b>${esc(i.name)}</b><br><small style="color:var(--mute)">${i.qty} &times; size ${esc(i.size)}</small></div></div>`).join("")}</div>
      <p style="text-align:right;font-weight:800;margin-top:12px">Total ${money(o.total)}</p>
      ${o.payment ? `<div class="box" style="margin-top:16px;box-shadow:none;border:1px solid var(--line)">${payPanel({ code: o.code, total: o.total }, o.payment)}</div>` : ""}`;
    hydrateThumbs($("#result"));
    $("#paid-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await fetch(`/api/orders/${o.code}/paid`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email.value.trim(), reference: new FormData(e.target).get("ref") }) });
      look();
    });
  } catch (e) { $("#result").innerHTML = ""; $("#err").textContent = e.message; }
}
form.addEventListener("submit", (e) => { e.preventDefault(); look(); });
if (form.code.value && form.email.value) look();
