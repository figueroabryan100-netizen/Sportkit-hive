import { api, post, toast, fail, esc, money, date, dateTime, ago, statusPill, debounce, openDrawer, busy, thumbHTML, hydrateThumbs, swatchHTML, gear3d } from './ui.js?v=6';

let root, state = { status: '', q: '' }, statuses = [], lastOrders = [];

export async function mount(el, { param }) {
  root = el;
  const isCode = param && /^(SF|DEMO)-/i.test(param);
  state.status = param && !isCode ? param : state.status;
  el.innerHTML = `<header class="page-head"><div><h1>Orders</h1><p class="muted">Confirm payments, track production and add shipping details.</p></div>
    <div class="head-actions"><a class="btn" href="/api/admin/orders.csv" download>Export CSV</a></div></header>
    <div class="tabs" id="or-tabs" role="tablist" aria-label="Filter by status"></div>
    <div class="toolbar"><label class="search"><span class="sr-only">Search orders</span>
      <input type="search" id="or-q" placeholder="Search by order number, name or email" value="${esc(state.q)}"></label></div>
    <div id="or-list" class="card card-flush"></div>`;
  el.querySelector('#or-q').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); load(); }, 300));
  el.querySelector('#or-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]'); if (!b) return;
    state.status = b.dataset.status; load();
  });
  await load();
  if (isCode) openOrder(param.toUpperCase());
}
export function unmount() { root = null; }

async function load() {
  const d = await api(`/api/admin/orders?status=${encodeURIComponent(state.status)}&q=${encodeURIComponent(state.q)}`);
  if (!root) return;
  statuses = d.statuses;
  lastOrders = d.orders;
  const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
  const tabs = [{ key: '', label: 'All', n: total }, ...d.statuses.map((s) => ({ ...s, n: d.counts[s.key] || 0 }))];
  root.querySelector('#or-tabs').innerHTML = tabs.map((t) =>
    `<button role="tab" type="button" class="tab${t.key === state.status ? ' on' : ''}" aria-selected="${t.key === state.status}" data-status="${t.key}">${esc(t.label)} <span class="count">${t.n}</span></button>`).join('');
  const list = root.querySelector('#or-list');
  if (!d.orders.length) {
    list.innerHTML = `<div class="empty"><p>${state.q || state.status ? 'No orders match.' : 'No orders yet. Try "Add demo orders" on the Dashboard to practice.'}</p></div>`;
    return;
  }
  list.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Payment</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>
    ${d.orders.map((o) => `<tr class="click" tabindex="0" data-code="${esc(o.code)}">
      <td><strong>${esc(o.code)}</strong></td><td>${date(o.created)}<div class="muted small">${ago(o.created)}</div></td>
      <td>${esc(o.customer.name || '')}<div class="muted small">${esc(o.email)}</div></td>
      <td>${o.items.filter((i) => !i.extra).reduce((a, i) => a + i.qty, 0)} pcs<div class="muted small ellipsis">${esc(o.items.map((i) => i.name).join(', '))}</div></td>
      <td>${esc(o.payment_label)}${o.payment_ref ? `<div class="muted small">Ref ${esc(o.payment_ref)}</div>` : ''}</td>
      <td>${statusPill(o.status, o.status_label)}</td><td class="num"><strong>${money(o.total)}</strong></td></tr>`).join('')}</tbody></table></div>`;
  list.querySelectorAll('tr[data-code]').forEach((tr) => {
    tr.addEventListener('click', () => openOrder(tr.dataset.code));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openOrder(tr.dataset.code); });
  });
}

const fmtAddr = (c) => [c.address1, c.address2, [c.city, c.region, c.postal].filter(Boolean).join(', '), c.country].filter(Boolean).map(esc).join('<br>');

function designSpec(d) {
  const rows = [['Colors', [d.primary, d.secondary, d.accent, d.sleeve].filter(Boolean).join(' / ')], ['Pattern', d.pattern], ['Collar', d.collar],
    ['Font', d.font], ['Name', d.name], ['Number', d.number], ['Chest', d.chest], ['Text', d.text], ['Small text', d.subtext],
    ['Finish', d.finish], ['Outline', d.outline ? 'Yes' : ''], ['Patch', d.patch && d.patch !== 'none' ? d.patch : '']];
  return rows.filter((r) => r[1]).map(([k, v]) => `<span class="spec"><b>${k}:</b> ${esc(v)}</span>`).join('');
}

async function openOrder(code) {
  let o;
  try { o = await api('/api/admin/orders/' + encodeURIComponent(code)); } catch (e) { fail(e); return; }
  if (location.hash !== '#/orders/' + o.code) history.replaceState(null, '', '#/orders/' + o.code);
  render(o);
}

function render(o) {
  const c = o.customer || {};
  const needsConfirm = o.status === 'payment_review' || o.status === 'awaiting_payment';
  const designs = {};
  o.items.forEach((it, i) => { if (!it.extra) designs['i' + i] = { ...it.design, shape: it.shape || (it.design && it.design.shape) }; });
  const others = (o.customer_orders || []).filter((x) => x.code !== o.code);
  const dr = openDrawer(`<div class="drawer-body">
    <div class="drawer-title"><div><h2>Order ${esc(o.code)}</h2><p class="muted small">Placed ${dateTime(o.created)}</p></div>${statusPill(o.status, o.status_label)}</div>
    ${needsConfirm ? `<div class="confirm-box"><div><strong>${o.status === 'payment_review' ? 'The customer says they paid.' : 'Waiting for the customer to pay.'}</strong>
      <p class="small">Check your ${esc(o.payment_label)} account for ${money(o.total)}${o.payment_ref ? ` with reference <b>${esc(o.payment_ref)}</b>` : ''}. When you see it, confirm below.</p></div>
      <button class="btn btn-primary btn-lg" id="od-confirm">Confirm payment received</button></div>` : ''}
    <section class="od-sec"><h3>Items</h3>
      ${o.items.map((it, i) => it.extra ? `<div class="od-item od-extra"><span class="extra-ico" aria-hidden="true">${it.extra === 'gift' ? 'Gift' : 'Rush'}</span>
        <div class="od-item-main"><div class="row-between"><strong>${esc(it.name)}</strong><span>${money(it.line)}</span></div><div class="muted small">Checkout upgrade</div></div></div>` : `<div class="od-item">${thumbHTML('i' + i, it.design, 88)}
        <div class="od-item-main"><div class="row-between"><strong>${esc(it.name)}</strong><span>${money(it.line)}</span></div>
        <div class="muted small">${it.qty} x ${money(it.unit)}${it.roster && it.roster.length ? ' (team order)' : `, size ${esc(it.size)}`}</div>
        <div class="specs small">${designSpec(it.design || {})}</div>
        ${it.roster && it.roster.length ? `<div class="table-wrap"><table class="table table-sm"><caption class="sr-only">Team roster</caption><thead><tr><th>#</th><th>Name</th><th>Number</th><th>Size</th></tr></thead><tbody>
          ${it.roster.map((r, k) => `<tr><td>${k + 1}</td><td>${esc(r.name)}</td><td>${esc(r.number)}</td><td>${esc(r.size)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        </div></div>`).join('')}
      <dl class="totals"><dt>Subtotal</dt><dd>${money(o.subtotal)}</dd>
        ${o.squad_discount ? `<dt>Team discount</dt><dd>-${money(o.squad_discount)}</dd>` : ''}
        ${o.discount ? `<dt>Code ${esc(o.discount_code)}</dt><dd>-${money(o.discount)}</dd>` : ''}
        <dt>Shipping (${esc(o.shipping_method || 'standard')})</dt><dd>${money(o.shipping)}</dd>
        <dt class="big">Total</dt><dd class="big">${money(o.total)}</dd>
        <dt class="muted">Your cost</dt><dd class="muted">${money(o.cost)} (profit ${money(o.total - o.cost)})</dd></dl>
    </section>
    <div class="grid-2 tight">
      <section class="od-sec"><h3>Customer</h3><p><strong>${esc(c.name)}</strong><br><a href="mailto:${esc(o.email)}">${esc(o.email)}</a>${c.phone ? `<br>${esc(c.phone)}` : ''}</p>
        <p class="small">${fmtAddr(c)}</p>${o.customer_note ? `<p class="note"><b>Customer note:</b> ${esc(o.customer_note)}</p>` : ''}</section>
      <section class="od-sec"><h3>Payment</h3><p>${esc(o.payment_label)}</p><p class="small">Customer's reference: ${o.payment_ref ? `<b>${esc(o.payment_ref)}</b>` : '<span class="muted">none given</span>'}</p></section>
    </div>
    <form class="od-sec" id="od-form"><h3>Update</h3>
      <div class="form-grid">
        <label class="field"><span>Status</span><select name="status">${statuses.map((s) => `<option value="${s.key}"${s.key === o.status ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Carrier</span><input name="carrier" list="carriers" value="${esc(o.carrier)}" placeholder="For example USPS"></label>
        <label class="field span-2"><span>Tracking number</span><input name="tracking" value="${esc(o.tracking)}" placeholder="Adding one marks a paid order as shipped"></label>
        <label class="field span-2"><span>Internal note (only you see this)</span><textarea name="admin_note" rows="2">${esc(o.admin_note)}</textarea></label>
      </div>
      <datalist id="carriers"><option>USPS</option><option>UPS</option><option>FedEx</option><option>DHL</option><option>Royal Mail</option><option>Canada Post</option></datalist>
      <div class="row-gap"><button class="btn btn-primary" type="submit">Save changes</button><button class="btn" type="button" id="od-print">Print packing slip</button></div>
    </form>
    <section class="od-sec"><h3>History</h3><ol class="timeline">
      ${o.history.slice().reverse().map((h) => `<li><span class="tl-dot tone-${h.status}" aria-hidden="true"></span><div><strong>${esc(statuses.find((s) => s.key === h.status)?.label || h.status)}</strong>${h.note ? ` <span class="muted">${esc(h.note)}</span>` : ''}<div class="muted small">${dateTime(h.at)}</div></div></li>`).join('')}</ol></section>
    <section class="od-sec"><h3>Other orders by this customer</h3>
      ${others.length ? `<ul class="plain">${others.map((x) => `<li><button class="link" data-other="${esc(x.code)}">${esc(x.code)}</button> <span class="muted small">${date(x.created)}, ${esc(x.status)}, ${money(x.total)}</span></li>`).join('')}</ul>` : '<p class="muted small">This is their first order.</p>'}
    </section></div>`, { wide: true, onClose: () => { if (/^#\/orders\/(SF|DEMO)-/i.test(location.hash)) history.replaceState(null, '', '#/orders'); } });

  gear3d().then(() => hydrateThumbs(dr, designs, 240));
  const save = async (body, msg) => {
    const upd = await post('/api/admin/orders/' + encodeURIComponent(o.code), body);
    toast(msg);
    await openOrder(o.code);
    if (root) load().catch(fail);
    return upd;
  };
  dr.querySelector('#od-confirm')?.addEventListener('click', (e) => busy(e.currentTarget, () => save({ status: 'paid', status_note: 'Payment confirmed by owner' }, 'Payment confirmed. Time to make it!')));
  dr.querySelector('#od-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    busy(e.submitter, () => save(body, 'Order saved'));
  });
  dr.querySelector('#od-print').addEventListener('click', () => printSlip(o));
  dr.querySelectorAll('[data-other]').forEach((b) => b.addEventListener('click', () => openOrder(b.dataset.other)));
}

function printSlip(o) {
  const c = o.customer || {};
  const pr = document.getElementById('print-root');
  pr.innerHTML = `<div class="slip"><div class="slip-head"><div><h1>Packing slip</h1><p>Order <b>${esc(o.code)}</b>, placed ${date(o.created)}</p></div><div class="slip-brand">SquadForge</div></div>
    <div class="slip-cols"><div><h3>Ship to</h3><p><b>${esc(c.name)}</b><br>${fmtAddr(c)}${c.phone ? '<br>' + esc(c.phone) : ''}</p></div>
    <div><h3>Shipping</h3><p>${esc(o.shipping_method || 'standard')}${o.carrier ? '<br>' + esc(o.carrier) : ''}${o.tracking ? '<br>Tracking ' + esc(o.tracking) : ''}</p></div></div>
    ${o.items.map((it) => it.extra ? `<div class="slip-item slip-extra"><b>${esc(it.name)}</b>${it.extra === 'rush' ? ' (make this order first)' : it.extra === 'gift' ? ' (wrap it and add a note)' : ''}</div>` : `<div class="slip-item"><div class="slip-item-head">${swatchHTML(it.design, 36)}<div><b>${esc(it.name)}</b> (${esc(it.shape || '')})<br>Qty ${it.qty}${it.roster && it.roster.length ? '' : `, size ${esc(it.size)}`}</div></div>
      <div class="specs">${designSpec(it.design || {})}</div>
      ${it.roster && it.roster.length ? `<table><thead><tr><th>#</th><th>Name</th><th>Number</th><th>Size</th><th>Packed</th></tr></thead><tbody>${it.roster.map((r, k) => `<tr><td>${k + 1}</td><td>${esc(r.name)}</td><td>${esc(r.number)}</td><td>${esc(r.size)}</td><td>&#9744;</td></tr>`).join('')}</tbody></table>` : ''}
    </div>`).join('')}
    ${o.customer_note ? `<p><b>Customer note:</b> ${esc(o.customer_note)}</p>` : ''}
    <p class="slip-foot">Thank you for your order! Questions? Reply to your order email.</p></div>`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); pr.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(() => { if (!window.matchMedia('print').matches) done(); }, 1500);
}
