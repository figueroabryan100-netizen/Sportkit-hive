import { api, post, toast, esc, ago, dateTime, busy } from './ui.js?v=6';

let root;
const KIND = { retire: ['Hide', 'muted'], flash: ['Flash sale', 'warn'], remix: ['New colors', 'info'], feature: ['Feature', 'ok'] };
const MODES = [['off', 'Off', 'Autopilot does nothing.'], ['suggest', 'Suggest only, I approve', 'It writes ideas here. Nothing changes until you press Apply.'],
  ['auto', 'Apply automatically', 'It makes the changes for you, a few at a time, and lists them below.']];

export async function mount(el) {
  root = el;
  el.innerHTML = `<header class="page-head"><div><h1>Autopilot</h1><p class="muted">Your store helper. It watches views, bag adds and sales, then suggests small changes that tend to sell more.</p></div>
    <div class="head-actions"><button class="btn btn-primary" id="ap-run">Run now</button></div></header>
    <div class="grid-2 ap-grid"><form class="card" id="ap-form"></form>
    <section class="card"><h2>What it looks for</h2><ul class="ap-explain">
      <li><span class="pill pill-muted">Hide</span> Products live for a long time with almost no views and no sales.</li>
      <li><span class="pill pill-warn">Flash sale</span> Products many people look at but nobody adds to their bag.</li>
      <li><span class="pill pill-info">New colors</span> Best sellers get fresh colorways.</li>
      <li><span class="pill pill-ok">Feature</span> Products often added to bags get a spot on the home page.</li></ul>
      <p class="muted small" id="ap-last"></p></section></div>
    <section class="card"><h2>Ideas waiting for you</h2><div id="ap-open"></div></section>
    <section class="card"><h2>History</h2><div id="ap-done"></div></section>`;
  el.querySelector('#ap-run').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const r = await post('/api/admin/autopilot/run');
    toast(r.found ? `Found ${r.found} new ${r.found === 1 ? 'idea' : 'ideas'}` : 'No new ideas right now. Your catalog looks healthy.');
    await load(false);
  }));
  await load(true);
}
export function unmount() { root = null; }

async function load(withForm) {
  const d = await api('/api/admin/autopilot');
  if (!root) return;
  const s = { mode: 'suggest', retire_days: 60, retire_views: 40, max_changes: 5, remix: true, flash: true, ...(d.settings || {}) };
  if (withForm) renderForm(s);
  root.querySelector('#ap-last').textContent = d.last ? `Last run ${ago(d.last)}. It also runs by itself every few hours.` : 'It has not run yet. It runs by itself every few hours, or press Run now.';
  const open = d.suggestions.filter((x) => x.state === 'open');
  const done = d.suggestions.filter((x) => x.state !== 'open');
  const item = (x, actions) => {
    const [label, tone] = KIND[x.kind] || [x.kind, 'muted'];
    return `<li class="sugg"><span class="pill pill-${tone}">${esc(label)}</span><div class="sugg-main"><strong>${esc(x.title)}</strong><p class="muted small">${esc(x.why)}</p>
      ${x.slug ? `<a class="small link" href="#/products/${esc(x.slug)}">Open product</a>` : ''}</div>
      ${actions ? `<div class="row-gap"><button class="btn btn-sm btn-primary" data-apply="${x.id}">Apply</button><button class="btn btn-sm" data-dismiss="${x.id}">Dismiss</button></div>`
        : `<span class="small ${x.state === 'done' ? 'tone-ok' : 'muted'}">${x.state === 'done' ? 'Applied' : 'Dismissed'} ${dateTime(x.done)}</span>`}</li>`;
  };
  root.querySelector('#ap-open').innerHTML = open.length ? `<ul class="sugg-list">${open.map((x) => item(x, true)).join('')}</ul>` : '<p class="muted">No ideas waiting. Press Run now to check again.</p>';
  root.querySelector('#ap-done').innerHTML = done.length ? `<ul class="sugg-list">${done.map((x) => item(x, false)).join('')}</ul>` : '<p class="muted">Nothing yet.</p>';
  root.querySelectorAll('[data-apply],[data-dismiss]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    const apply = !!b.dataset.apply;
    await post('/api/admin/autopilot/' + (b.dataset.apply || b.dataset.dismiss), { action: apply ? 'apply' : 'dismiss' });
    toast(apply ? 'Done. The change is live.' : 'Idea dismissed');
    await load(false);
  })));
}

function renderForm(s) {
  const f = root.querySelector('#ap-form');
  f.innerHTML = `<h2>Settings</h2>
    <fieldset class="field"><legend>Mode</legend><div class="radio-cards">${MODES.map(([k, l, h]) => `<label class="radio-card"><input type="radio" name="mode" value="${k}" ${s.mode === k ? 'checked' : ''}><span><strong>${l}</strong><small class="muted">${h}</small></span></label>`).join('')}</div></fieldset>
    <div class="form-grid">
      <label class="field"><span>Hide quiet products after (days)</span><input type="number" name="retire_days" min="7" max="365" value="${s.retire_days}"></label>
      <label class="field"><span>Suggest a flash sale after (views with no bag adds)</span><input type="number" name="retire_views" min="5" max="5000" value="${s.retire_views}"></label>
      <label class="field"><span>Most changes per run</span><input type="number" name="max_changes" min="1" max="50" value="${s.max_changes}"></label>
    </div>
    <label class="check"><input type="checkbox" name="remix" ${s.remix ? 'checked' : ''}><span>Allow new colorways of best sellers</span></label>
    <label class="check"><input type="checkbox" name="flash" ${s.flash ? 'checked' : ''}><span>Allow flash sales</span></label>
    <button class="btn btn-primary" type="submit">Save autopilot settings</button>`;
  f.onsubmit = (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    const ap = { mode: fd.mode, retire_days: +fd.retire_days || 60, retire_views: +fd.retire_views || 40, max_changes: +fd.max_changes || 5, remix: !!fd.remix, flash: !!fd.flash };
    busy(e.submitter, async () => { await post('/api/admin/settings', { autopilot: ap }); toast('Autopilot settings saved'); });
  };
}
