import { api, post, toast, fail, esc, money, num, ago, statusPill, periodSwitch, busy, confirmBox } from './ui.js?v=6';

let timer = null;
let days = 30;
let root = null;

export async function mount(el) {
  root = el;
  el.innerHTML = `<header class="page-head"><div><h1>Dashboard</h1><p class="muted">How your store is doing at a glance.</p></div>
    <div class="head-actions"><span id="db-period"></span></div></header>
    <div id="db-alerts" class="alerts"></div>
    <section class="kpis" id="db-kpis" aria-label="Key numbers"></section>
    <div class="grid-2">
      <section class="card"><div class="card-head"><h2>Recent orders</h2><a href="#/orders" class="link">All orders</a></div><div id="db-recent"></div></section>
      <section class="card"><div class="card-head"><h2>Live activity</h2><span class="muted small" id="db-live"><span class="live-dot" aria-hidden="true"></span>Updates every 20 seconds</span></div><ul class="feed" id="db-feed" aria-live="off"></ul></section>
    </div>
    <section class="card demo-card"><div><h2>Try it with sample orders</h2>
      <p class="muted">Add a dozen demo orders (codes start with DEMO) so you can practice confirming payments and shipping. Remove them any time.</p></div>
      <div class="row-gap"><button class="btn btn-primary" id="db-demo-add">Add demo orders</button><button class="btn" id="db-demo-clear">Remove demo orders</button></div></section>`;
  el.querySelector('#db-period').innerHTML = periodSwitch(days);
  el.querySelector('#db-period').addEventListener('click', (e) => {
    const b = e.target.closest('[data-period]'); if (!b) return;
    days = +b.dataset.period;
    el.querySelector('#db-period').innerHTML = periodSwitch(days);
    load();
  });
  el.querySelector('#db-demo-add').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    await post('/api/admin/demo-orders'); toast('Demo orders added'); await load();
  }));
  el.querySelector('#db-demo-clear').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    if (!await confirmBox('Remove all demo orders? Real orders are not touched.', { ok: 'Remove demo orders' })) return;
    await post('/api/admin/demo-orders/clear'); toast('Demo orders removed'); await load();
  }));
  await load();
  timer = setInterval(() => { if (!document.hidden) load(true); }, 20000);
}

export function unmount() { clearInterval(timer); timer = null; root = null; }

async function load(quiet) {
  let d;
  try { d = await api('/api/admin/overview?days=' + days); } catch (e) { if (!quiet) fail(e); return; }
  if (!root) return;
  const alerts = [];
  if (d.needs_review) alerts.push(['alert', `${d.needs_review} ${d.needs_review === 1 ? 'payment' : 'payments'} to confirm`, 'Customers say they paid. Check your account and confirm.', '#/orders/payment_review', 'Review payments']);
  if (!d.payments_on) alerts.push(['alert', 'No payment method is switched on yet', 'Customers cannot check out until you turn on at least one way to pay.', '#/payments', 'Set up payments']);
  if (d.to_make) alerts.push(['info', `${d.to_make} paid ${d.to_make === 1 ? 'order' : 'orders'} to make and ship`, 'Add a tracking number when they leave.', '#/orders/paid', 'Open orders']);
  if (d.awaiting) alerts.push(['warn', `${d.awaiting} ${d.awaiting === 1 ? 'order is' : 'orders are'} waiting for payment`, 'The customer has not told us they paid yet.', '#/orders/awaiting_payment', 'View']);
  if (d.open_suggestions) alerts.push(['info', `Autopilot has ${d.open_suggestions} ${d.open_suggestions === 1 ? 'idea' : 'ideas'} for you`, 'Small changes that could sell more.', '#/autopilot', 'See ideas']);
  root.querySelector('#db-alerts').innerHTML = alerts.map(([tone, t, sub, href, cta]) =>
    `<a class="alert alert-${tone}" href="${href}"><span class="alert-dot" aria-hidden="true"></span><span><strong>${esc(t)}</strong><span class="muted small">${esc(sub)}</span></span><span class="alert-cta">${esc(cta)} &rsaquo;</span></a>`).join('');
  const kp = [
    ['Revenue', money(d.revenue), 'from paid orders'],
    ['Profit', money(d.profit), 'revenue minus product cost'],
    ['Paid orders', num(d.paid_orders), `${num(d.orders)} placed in total`],
    ['Average order', money(d.aov), 'per paid order'],
    ['Visitors', num(d.visitors), 'unique visitors'],
    ['Conversion', (d.conversion || 0).toFixed(1) + '%', 'visitors who paid'],
  ];
  root.querySelector('#db-kpis').innerHTML = kp.map(([l, v, s]) =>
    `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-val">${v}</div><div class="kpi-sub">${s}</div></div>`).join('');
  root.querySelector('#db-recent').innerHTML = d.recent.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>
    ${d.recent.map((o) => `<tr class="click" data-href="#/orders/${esc(o.code)}" tabindex="0"><td><strong>${esc(o.code)}</strong><div class="muted small">${ago(o.created)}</div></td>
      <td>${esc(o.customer.name || o.email)}</td><td>${statusPill(o.status, o.status_label)}</td><td class="num">${money(o.total)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty small"><p>No orders yet. Share your store, or add demo orders below to practice.</p></div>';
  root.querySelectorAll('tr[data-href]').forEach((tr) => {
    const go = () => { location.hash = tr.dataset.href; };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
  root.querySelector('#db-feed').innerHTML = d.activity.length ? d.activity.map((a) =>
    `<li><span class="feed-dot" aria-hidden="true"></span><span>${esc(a.text)}</span><time class="muted small">${ago(a.at)}</time></li>`).join('') : '<li class="muted">Nothing yet.</li>';
}
