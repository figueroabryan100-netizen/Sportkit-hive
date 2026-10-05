import { api, fail, esc, money, num, periodSwitch, thumbHTML, hydrateThumbs, gear3d } from './ui.js?v=6';

let root, days = 30, data = null;
const asTable = new Set();

export async function mount(el) {
  root = el;
  el.innerHTML = `<header class="page-head"><div><h1>Analytics</h1><p class="muted">Where your sales come from and where visitors drop off.</p></div>
    <div class="head-actions" id="an-period"></div></header><div id="an-body"><div class="loading">Loading...</div></div>`;
  el.querySelector('#an-period').addEventListener('click', (e) => {
    const b = e.target.closest('[data-period]'); if (!b) return;
    days = +b.dataset.period; load();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-toggle]'); if (!b) return;
    const k = b.dataset.toggle;
    asTable.has(k) ? asTable.delete(k) : asTable.add(k);
    render();
    root.querySelector(`[data-toggle="${k}"]`)?.focus();
  });
  await load();
}
export function unmount() { root = null; document.querySelector('.an-tip')?.remove(); }

async function load() {
  root.querySelector('#an-period').innerHTML = periodSwitch(days);
  try { data = await api('/api/admin/analytics?days=' + days); } catch (e) { fail(e); return; }
  if (root) render();
}

function cardShell(key, title, sub, chart, table) {
  const t = asTable.has(key);
  return `<section class="card chart-card" aria-labelledby="ch-${key}"><div class="card-head"><div><h2 id="ch-${key}">${title}</h2>${sub ? `<p class="muted small">${sub}</p>` : ''}</div>
    <button type="button" class="btn btn-sm btn-ghost" data-toggle="${key}" aria-pressed="${t}">${t ? 'Show as chart' : 'Show as table'}</button></div>
    ${t ? table : chart}</section>`;
}
const table = (heads, rows) => `<div class="table-wrap"><table class="table table-sm"><thead><tr>${heads.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>
  ${rows.length ? rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${heads.length}" class="muted">No data yet</td></tr>`}</tbody></table></div>`;

function dayLabel(i, long) {
  const d = new Date(Date.now() - (data.days - i - 1) * 86400000);
  return d.toLocaleDateString('en-US', long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
}

function niceMax(v) { if (v <= 0) return 10; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

function revenueChart() {
  let pts = data.daily.map((d, i) => ({ ...d, i }));
  // Group into weeks for long periods so bars stay readable.
  const group = data.days > 120 ? 7 : 1;
  if (group > 1) {
    const g = [];
    for (let i = 0; i < pts.length; i += group) {
      const sl = pts.slice(i, i + group);
      g.push({ i: sl[sl.length - 1].i, start: sl[0].i, revenue: sl.reduce((a, b) => a + b.revenue, 0), orders: sl.reduce((a, b) => a + b.orders, 0) });
    }
    pts = g;
  }
  const W = 760, H = 240, L = 52, B = 26, T = 10, R = 8;
  const max = niceMax(Math.max(...pts.map((p) => p.revenue)));
  const bw = (W - L - R) / pts.length;
  const barW = Math.max(2, Math.min(28, bw - 2));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(pts.length / 8);
  const lab = (p) => group > 1 ? `Week of ${dayLabel(p.start)}` : dayLabel(p.i, true);
  const svg = `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue per ${group > 1 ? 'week' : 'day'}, last ${data.days} days. Total ${money(data.revenue, 0)}.">
    ${ticks.map((t) => `<g class="grid"><line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${money(t, 0)}</text></g>`).join('')}
    ${pts.map((p, k) => {
      const h = Math.max(0, y(0) - y(p.revenue)); const x = L + k * bw + (bw - barW) / 2;
      const r = Math.min(4, barW / 2, h);
      const path = h > 0 ? `M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + barW - r} Q${x + barW},${y(0) - h} ${x + barW},${y(0) - h + r} V${y(0)} Z` : '';
      return `<g class="bar-g" data-tip="${esc(lab(p))}: ${money(p.revenue)} from ${p.orders} paid ${p.orders === 1 ? 'order' : 'orders'}">
        <rect class="hit" x="${L + k * bw}" y="${T}" width="${bw}" height="${H - T - B}"/>${path ? `<path class="bar" d="${path}"/>` : ''}
        ${k % labelEvery === 0 ? `<text class="xl" x="${x + barW / 2}" y="${H - 8}" text-anchor="middle">${esc(group > 1 ? dayLabel(p.start) : dayLabel(p.i))}</text>` : ''}</g>`;
    }).join('')}
    <line class="axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/></svg></div>`;
  const tbl = table(['Day', 'Revenue', 'Paid orders'], pts.filter((p) => p.revenue || p.orders).map((p) => [esc(lab(p)), money(p.revenue), p.orders]));
  return cardShell('revenue', 'Revenue', `${money(data.revenue)} from ${num(data.paid)} paid orders, ${money(data.profit)} profit`, svg, tbl);
}

function hbars(key, title, sub, rows, fmt = money) {
  const max = Math.max(...rows.map((r) => r[1]), 0) || 1;
  const chart = rows.length ? `<ul class="hbars">${rows.map(([label, v]) => `<li data-tip="${esc(label)}: ${esc(fmt(v))}" tabindex="0"><span class="hb-label">${esc(label)}</span>
    <span class="hb-track"><span class="hb-bar" style="width:${Math.max(1, (v / max) * 100)}%"></span></span><span class="hb-val">${esc(fmt(v))}</span></li>`).join('')}</ul>`
    : '<p class="muted small empty-chart">No data for this period yet.</p>';
  return cardShell(key, title, sub, chart, table(['Name', 'Value'], rows.map(([l, v]) => [esc(l), esc(fmt(v))])));
}

function funnel() {
  const f = data.funnel;
  const top = f[0].n || Math.max(...f.map((s) => s.n)) || 1;
  const chart = `<ol class="funnel">${f.map((s, i) => {
    const prev = i ? f[i - 1].n : 0;
    const drop = i && prev ? Math.max(0, Math.round((1 - s.n / prev) * 100)) : null;
    return `<li tabindex="0" data-tip="${esc(s.step)}: ${num(s.n)}${drop != null ? `, ${drop}% dropped off from the step before` : ''}"><span class="hb-label">${esc(s.step)}</span>
      <span class="hb-track"><span class="hb-bar" style="width:${Math.max(1, Math.min(100, (s.n / top) * 100))}%"></span></span>
      <span class="hb-val">${num(s.n)}${drop != null ? ` <span class="drop">-${drop}%</span>` : ''}</span></li>`;
  }).join('')}</ol>`;
  const tbl = table(['Step', 'People', 'Drop off'], f.map((s, i) => [esc(s.step), num(s.n), i && f[i - 1].n ? Math.max(0, Math.round((1 - s.n / f[i - 1].n) * 100)) + '%' : '']));
  return cardShell('funnel', 'Shopping funnel', 'How many visitors reach each step. Drop off shows who left since the step before.', chart, tbl);
}

function topProducts() {
  const rows = data.top;
  const chart = rows.length ? `<ol class="top-list">${rows.map((p, i) => `<li><span class="rank">${i + 1}</span>${thumbHTML('t' + i, p.design, 44)}
    <a href="#/products/${esc(p.slug)}" class="ellipsis">${esc(p.name)}</a><span class="muted small">${num(p.units)} sold</span><strong>${money(p.revenue, 0)}</strong></li>`).join('')}</ol>`
    : '<p class="muted small empty-chart">No sales in this period yet.</p>';
  return cardShell('top', 'Top products', 'By revenue from paid orders', chart, table(['Product', 'Units', 'Revenue'], rows.map((p) => [esc(p.name), num(p.units), money(p.revenue)])));
}

function extraIncome() {
  const d = data;
  const ads = d.ads || [];
  const banners = {};
  ads.filter((r) => r.type === 'ad_view' || r.type === 'ad_click').forEach((r) => {
    const k = r.slug || 'ad';
    const b = banners[k] = banners[k] || { name: '', views: 0, clicks: 0 };
    if (r.q && !b.name) b.name = r.q;
    if (r.type === 'ad_view') b.views += r.c; else b.clicks += r.c;
  });
  const bannerRows = Object.entries(banners).map(([k, b]) => [b.name || (k === 'adsense' ? 'Google AdSense' : k.replace('house-', 'Banner ')), b.views, b.clicks]).sort((a, b) => b[2] - a[2]);
  const upsells = ads.filter((r) => r.type === 'upsell_add');
  const upsellN = upsells.reduce((a, r) => a + r.c, 0);
  const refs = d.referrals || [];
  const key = 'extra';
  const body = `<div class="kpis kpis-3"><div class="kpi"><div class="kpi-label">Upgrade revenue</div><div class="kpi-val">${money(d.upgrade_revenue || 0)}</div><div class="kpi-sub">rush and gift wrap on paid orders</div></div>
      <div class="kpi"><div class="kpi-label">Upgrades added</div><div class="kpi-val">${num(upsellN)}</div><div class="kpi-sub">times ticked at checkout</div></div>
      <div class="kpi"><div class="kpi-label">Referral uses</div><div class="kpi-val">${num(refs.reduce((a, r) => a + r.uses, 0))}</div><div class="kpi-sub">orders using a friend's code</div></div></div>
    <h3>Partner banners and ads</h3>
    ${bannerRows.length ? table(['Banner', 'Views', 'Clicks'], bannerRows.map((r) => [esc(r[0]), num(r[1]), num(r[2])])) : '<p class="muted small">No ad views or clicks yet. Set them up under Ads and extra income.</p>'}
    <h3 class="mt">Top referral codes</h3>
    ${refs.length ? table(['Code', 'Times used'], refs.map((r) => [`<code class="code">${esc(r.code)}</code>`, num(r.uses)])) : '<p class="muted small">No referral codes used yet.</p>'}`;
  return `<section class="card chart-card span-all" aria-labelledby="ch-${key}"><div class="card-head"><div><h2 id="ch-${key}">Extra income</h2><p class="muted small">Checkout upgrades, ads and referrals in this period. <a href="#/income">Settings</a></p></div></div>
    ${body}</section>`;
}

function render() {
  const d = data;
  root.querySelector('#an-body').innerHTML = `${revenueChart()}
    <div class="grid-2">${funnel()}${topProducts()}
    ${hbars('sport', 'Sales by sport', '', d.by_sport)}
    ${hbars('league', 'Sales by league', '', d.by_league.slice(0, 12))}
    ${hbars('pay', 'Sales by payment method', '', d.by_payment)}
    ${hbars('status', 'Orders by status', 'All orders placed in this period', d.by_status, num)}
    ${extraIncome()}
    ${hbars('search', 'Top searches', 'What visitors typed in the search box', d.searches.map((s) => [s.q, s.c]), num)}</div>`;
  const designs = {}; d.top.forEach((p, i) => { designs['t' + i] = { ...p.design, shape: p.shape || (p.design && p.design.shape) }; });
  gear3d().then(() => hydrateThumbs(root, designs, 120));
  wireTips();
}

function wireTips() {
  let tip = document.querySelector('.an-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip an-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; document.body.appendChild(tip); }
  const show = (el, x, y) => { tip.textContent = el.dataset.tip; tip.hidden = false; const w = tip.offsetWidth; tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px'; tip.style.top = (y - tip.offsetHeight - 12) + 'px'; el.classList.add('hover'); };
  const hide = (el) => { tip.hidden = true; el && el.classList.remove('hover'); };
  root.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('mousemove', (e) => show(el, e.clientX, e.clientY));
    el.addEventListener('mouseleave', () => hide(el));
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); });
    el.addEventListener('blur', () => hide(el));
  });
}
