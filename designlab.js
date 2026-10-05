// Design lab: helper agents that keep proposing better versions of product designs.
import { api, post, toast, esc, ago, dateTime, busy, openDrawer, onDrawerCleanup, thumbHTML, hydrateThumbs, gear3d, SHAPE_LABEL } from './ui.js?v=6';

let root, data = null;
const MODES = [['suggest', 'Suggest only, I approve', 'The agents write ideas here. Nothing changes in your store until you press Apply.'],
  ['auto', 'Apply automatically', 'The agents apply their best ideas for you, a few per run, and list them in the history below.']];
const AGENT_ICON = {
  color: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h9"/>',
  pattern: '<path d="M3 7l4-4M3 13 13 3M3 19 19 3M9 21 21 9M15 21l6-6"/>',
  fit: '<path d="M4 4h16v16H4zM9 9h6v6H9z"/>',
  finish: '<path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
};
const iconFor = (k) => AGENT_ICON[Object.keys(AGENT_ICON).find((x) => String(k).includes(x)) || 'finish'];

export async function mount(el) {
  root = el;
  el.innerHTML = `<header class="page-head"><div><h1>Design lab</h1><p class="muted">Five design agents keep looking at your products and propose better looking versions. Compare before and after, then apply the ones you like.</p></div>
    <div class="head-actions"><button class="btn btn-primary" id="dl-run">Run now</button></div></header>
    <div class="grid-2"><form class="card" id="dl-form"></form>
      <section class="card"><h2>Your design agents</h2><p class="muted small" id="dl-last"></p><div class="lab-agents" id="dl-agents"></div></section></div>
    <section class="card"><div class="card-head"><div><h2>Ideas waiting for you</h2><p class="muted small">Left is how the product looks today, right is the proposed change.</p></div></div><div id="dl-open"></div></section>
    <section class="card"><h2>History</h2><div id="dl-done"></div></section>`;
  el.querySelector('#dl-run').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const r = await post('/api/admin/designlab/run', {});
    const n = (r && r.found) || 0;
    toast(n ? `The agents came up with ${n} new ${n === 1 ? 'idea' : 'ideas'}` : 'No new ideas right now. Your designs look good.');
    await load(false);
  }));
  await load(true);
}
export function unmount() { root = null; }

async function load(withForm) {
  const d = await api('/api/admin/designlab');
  if (!root) return;
  data = { agents: [], proposals: [], settings: {}, ...d };
  if (withForm) renderForm({ mode: 'suggest', per_run: 5, ...(data.settings || {}) });
  root.querySelector('#dl-last').textContent = data.last_run ? `Last run ${ago(data.last_run)}. They also run by themselves every few hours.` : 'They have not run yet. Press Run now to get the first ideas.';
  renderAgents();
  renderProposals();
}

function renderForm(s) {
  const f = root.querySelector('#dl-form');
  f.innerHTML = `<h2>How the lab works</h2>
    <fieldset class="field"><legend>Mode</legend><div class="radio-cards">${MODES.map(([k, l, h]) => `<label class="radio-card"><input type="radio" name="mode" value="${k}" ${s.mode === k ? 'checked' : ''}><span><strong>${l}</strong><small class="muted">${h}</small></span></label>`).join('')}</div></fieldset>
    <label class="field narrow-field"><span>Most ideas per run</span><input type="number" name="per_run" min="1" max="50" value="${esc(s.per_run)}"></label>
    <button class="btn btn-primary" type="submit">Save lab settings</button>`;
  f.onsubmit = (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    busy(e.submitter, async () => { await post('/api/admin/designlab/settings', { mode: fd.mode, per_run: Math.max(1, +fd.per_run || 5) }); toast('Lab settings saved'); });
  };
}

function renderAgents() {
  const box = root.querySelector('#dl-agents');
  if (!data.agents.length) { box.innerHTML = '<p class="muted">No agents yet.</p>'; return; }
  box.innerHTML = data.agents.map((a) => `<div class="lab-agent">
      <span class="agent-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${iconFor(a.key)}</svg></span>
      <div class="lab-agent-main"><strong>${esc(a.name)}</strong><span class="muted small">${esc(a.role)}</span>
        <span class="muted small">${a.last_run ? 'Ran ' + ago(a.last_run) : 'Not run yet'}, ${Number(a.proposals_total || 0)} ideas so far</span></div>
      <label class="switch" title="${a.enabled ? 'On' : 'Off'}"><input type="checkbox" data-agent="${esc(a.key)}" ${a.enabled ? 'checked' : ''} aria-label="${esc(a.name)} on or off"><span class="switch-ui"></span></label>
    </div>`).join('');
  box.querySelectorAll('[data-agent]').forEach((c) => c.addEventListener('change', async () => {
    try {
      await post('/api/admin/designlab/agents/' + encodeURIComponent(c.dataset.agent), { enabled: c.checked });
      const a = data.agents.find((x) => x.key === c.dataset.agent); if (a) a.enabled = c.checked;
      toast(`${a ? a.name : 'Agent'} is ${c.checked ? 'on' : 'off'}`);
    } catch (e) { c.checked = !c.checked; toast(e.message, 'err'); }
  }));
}

const agentName = (k) => (data.agents.find((a) => a.key === k) || {}).name || k || 'Design agent';
const designOf = (x, side) => { const v = x[side] || {}; return { shape: x.shape, ...(v.design || v) }; };

function renderProposals() {
  const open = data.proposals.filter((x) => x.state === 'open');
  const done = data.proposals.filter((x) => x.state !== 'open').sort((a, b) => (b.done || 0) - (a.done || 0));
  const designs = {};
  const card = (x) => {
    designs['b' + x.id] = designOf(x, 'before'); designs['a' + x.id] = designOf(x, 'after');
    return `<article class="prop">
      <div class="prop-compare">
        <figure>${thumbHTML('b' + x.id, designs['b' + x.id], 140)}<figcaption>Before</figcaption></figure>
        <svg class="prop-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>
        <figure>${thumbHTML('a' + x.id, designs['a' + x.id], 140)}<figcaption>After</figcaption></figure>
      </div>
      <div class="prop-main">
        <span class="pill pill-info">${esc(agentName(x.agent_key))}</span>
        <h3 class="prop-title">${esc(x.title)}</h3>
        <p class="muted small">${esc(x.product_name)}${x.shape ? `, ${esc(SHAPE_LABEL(x.shape))}` : ''}</p>
        <p class="small">${esc(x.why)}</p>
        <div class="row-gap"><button class="btn btn-sm btn-primary" data-apply="${x.id}">Apply</button><button class="btn btn-sm" data-dismiss="${x.id}">Dismiss</button>
          <button class="btn btn-sm btn-ghost" data-compare="${x.id}">Compare in 3D</button>
          ${x.slug ? `<a class="small link" href="#/products/${esc(x.slug)}">Open product</a>` : ''}</div>
      </div></article>`;
  };
  const openBox = root.querySelector('#dl-open');
  openBox.innerHTML = open.length ? `<div class="prop-list">${open.map(card).join('')}</div>`
    : `<div class="empty small"><p>No ideas waiting. Press Run now and the agents will look at your catalog again.</p></div>`;
  const doneBox = root.querySelector('#dl-done');
  doneBox.innerHTML = done.length ? `<ul class="sugg-list">${done.map((x) => {
    designs['h' + x.id] = designOf(x, x.state === 'applied' ? 'after' : 'before');
    return `<li class="sugg lab-hist">${thumbHTML('h' + x.id, designs['h' + x.id], 48)}<div class="sugg-main"><strong>${esc(x.title)}</strong>
      <p class="muted small">${esc(x.product_name)}, by ${esc(agentName(x.agent_key))}</p></div>
      <span class="small ${x.state === 'applied' ? 'tone-ok' : 'muted'}">${x.state === 'applied' ? 'Applied' : 'Dismissed'} ${dateTime(x.done)}</span></li>`;
  }).join('')}</ul>` : '<p class="muted">Nothing applied or dismissed yet.</p>';
  root.querySelectorAll('[data-apply],[data-dismiss]').forEach((b) => b.addEventListener('click', () => act(b, b.dataset.apply || b.dataset.dismiss, b.dataset.apply ? 'apply' : 'dismiss')));
  root.querySelectorAll('[data-compare]').forEach((b) => b.addEventListener('click', () => compare(data.proposals.find((x) => String(x.id) === b.dataset.compare))));
  gear3d().then(() => { if (root) { hydrateThumbs(openBox, designs, 280); hydrateThumbs(doneBox, designs, 120); } });
}

function act(btn, id, action) {
  return busy(btn, async () => {
    await post('/api/admin/designlab/' + encodeURIComponent(id), { action });
    toast(action === 'apply' ? 'Done. The new design is live.' : 'Idea dismissed');
    await load(false);
  });
}

function compare(x) {
  if (!x) return;
  const dr = openDrawer(`<div class="drawer-body"><div class="drawer-title"><div><h2>${esc(x.title)}</h2>
      <p class="muted small">${esc(x.product_name)}. Drag either model to turn it around.</p></div></div>
    <div class="cmp3d"><figure><div class="preview3d" id="cmp-b" role="img" aria-label="Current design in 3D"></div><figcaption>Before (today)</figcaption></figure>
      <figure><div class="preview3d" id="cmp-a" role="img" aria-label="Proposed design in 3D"></div><figcaption>After (proposed)</figcaption></figure></div>
    <p class="small">${esc(x.why)}</p>
    ${x.state === 'open' ? `<div class="drawer-actions"><button class="btn btn-primary" id="cmp-apply">Apply this change</button><button class="btn" id="cmp-dismiss">Dismiss</button></div>` : ''}</div>`, { wide: true });
  const handles = []; let closed = false;
  const dispose = (h) => { try { (h?.dispose || h?.destroy || h?.unmount)?.call(h); } catch (e) { /* ignore */ } };
  onDrawerCleanup(() => { closed = true; handles.forEach(dispose); handles.length = 0; });
  gear3d().then(async (m) => {
    if (closed) return;
    const pairs = [['#cmp-b', designOf(x, 'before')], ['#cmp-a', designOf(x, 'after')]];
    if (!m || typeof m.mount !== 'function' || (m.supported && !m.supported())) {
      pairs.forEach(([sel, d]) => { const box = dr.querySelector(sel); if (box) box.innerHTML = `<div class="cmp-flat">${thumbHTML(sel, d, 240)}</div>`; });
      return;
    }
    for (const [sel, d] of pairs) {
      try {
        const h = await m.mount(dr.querySelector(sel), d, { interactive: true, autoRotate: true });
        if (closed) { dispose(h); return; }
        handles.push(h);
      } catch (e) { console.warn('3D compare unavailable', e); }
    }
  });
  const close = () => dr.querySelector('.drawer-x').click();
  dr.querySelector('#cmp-apply')?.addEventListener('click', async (e) => { await act(e.currentTarget, x.id, 'apply'); close(); });
  dr.querySelector('#cmp-dismiss')?.addEventListener('click', async (e) => { await act(e.currentTarget, x.id, 'dismiss'); close(); });
}
