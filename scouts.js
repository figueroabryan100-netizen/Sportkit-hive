// Vendor scouts: ten agents that find suppliers, plus a pipeline to build relationships with them.
import { api, post, toast, fail, esc, ago, date, dateTime, busy, confirmBox, openDrawer, closeDrawer, debounce } from './ui.js?v=6';

let root, data = null, stageView = 'new', q = '';

const STAGES = [['new', 'New'], ['contacted', 'Contacted'], ['talking', 'Talking'], ['sampling', 'Sampling'], ['partner', 'Partner'], ['passed', 'Passed']];
const STAGE_LABEL = Object.fromEntries(STAGES);
const HOW = {
  live: 'Searches public pages by itself',
  paste: 'Works from messages you paste in',
  links: 'Gives you ready searches, you paste what you find',
  crm: 'Looks after your vendor pipeline',
};
const CH = {
  reddit: ['Reddit', '<circle cx="12" cy="14" r="7"/><path d="M9 14h.01M15 14h.01M9.5 17c1.5 1 3.5 1 5 0M12 7l1.5-4 4 1M19 4h.01"/>'],
  whatsapp: ['WhatsApp', '<path d="M4 20l1.4-4A8 8 0 1 1 8.5 19z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1.2-1.2 1.8.9"/>'],
  telegram: ['Telegram', '<path d="M21 4 3 11l6 2 2 6 3-4 5 4z"/><path d="M9 13l8-6"/>'],
  discord: ['Discord', '<path d="M7 6c3-1.3 7-1.3 10 0l2 4c.6 3 .3 5.5-1 8l-3-1-1-2H10l-1 2-3 1c-1.3-2.5-1.6-5-1-8z"/><path d="M9.5 12h.01M14.5 12h.01"/>'],
  facebook: ['Facebook', '<path d="M14 21v-8h3l.5-3H14V8c0-1 .5-1.5 1.5-1.5H18V3.5A20 20 0 0 0 15 3c-2.5 0-4 1.6-4 4.2V10H8v3h3v8"/>'],
  marketplace: ['Marketplaces', '<path d="M4 9h16l-1 11H5zM8 9V7a4 4 0 0 1 8 0v2"/>'],
  web: ['Web', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.3 3 14.7 0 18M12 3c-3 3.3-3 14.7 0 18"/>'],
  crm: ['Pipeline', '<path d="M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8"/>'],
  email: ['Email', '<path d="M3 5h18v14H3z"/><path d="m3 6 9 7 9-7"/>'],
  manual: ['Added by you', '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'],
};
const chKey = (c) => {
  const s = String(c || '').toLowerCase();
  if (s.includes('reddit')) return 'reddit';
  if (s.includes('whatsapp')) return 'whatsapp';
  if (s.includes('telegram')) return 'telegram';
  if (s.includes('discord')) return 'discord';
  if (s.includes('facebook') || s === 'fb') return 'facebook';
  if (/market|alibaba|etsy|ebay|amazon/.test(s)) return 'marketplace';
  if (/crm|pipeline|relationship|integration/.test(s)) return 'crm';
  if (/mail/.test(s)) return 'email';
  if (/manual|hand|you/.test(s)) return 'manual';
  return 'web';
};
const chIcon = (c, cls = 'agent-ico') => `<span class="${cls} ch-${chKey(c)}" aria-hidden="true"><svg viewBox="0 0 24 24">${CH[chKey(c)][1]}</svg></span>`;
const chChip = (c) => `<span class="ch-chip ch-${chKey(c)}">${esc(c && !CH[c] ? c : CH[chKey(c)][0])}</span>`;

const PASTE_HELP = {
  whatsapp: `<ol class="small"><li>Open the WhatsApp group on your phone.</li><li>Tap the group name, then <strong>More</strong> (or scroll down) and <strong>Export chat</strong>.</li>
    <li>Choose <strong>Without media</strong> and send it to yourself (email or notes).</li><li>Open the file, copy all the text and paste it below. You can also pick the .txt file directly.</li></ol>`,
  telegram: `<ol class="small"><li>On Telegram Desktop, open the group, click the three dots and <strong>Export chat history</strong>, choose text only. Or select a few messages and press copy.</li>
    <li>On Discord, click and drag over the messages to select them, then copy.</li><li>Paste everything below.</li></ol>`,
  facebook: `<ol class="small"><li>Open the Facebook group in a browser.</li><li>Select the posts or comments that mention suppliers, factories or prices and copy them.</li><li>Paste below. Names, phone numbers and links in the text are picked up.</li></ol>`,
  marketplace: `<ol class="small"><li>Open the searches above in new tabs.</li><li>Copy the seller name, shop link and price of the listings you like (several at once is fine).</li><li>Paste below and the scout turns them into vendor leads.</li></ol>`,
  web: `<p class="small">Open the searches above, copy anything useful (company name, website, contact, prices) and paste it below.</p>`,
};

export async function mount(el) {
  root = el; q = '';
  el.innerHTML = `<header class="page-head"><div><h1>Vendor scouts</h1><p class="muted">Ten helpers that look for new suppliers and help you build a relationship with them, from the first hello to a real partnership.</p></div>
    <div class="head-actions"><button class="btn" id="sc-add">Add a vendor</button><button class="btn btn-primary" id="sc-run">Run all scouts</button></div></header>
    <p class="muted small sc-last" id="sc-last"></p>
    <div class="explain"><p><strong>How they find vendors.</strong> The Reddit and web scouts search public Reddit posts and public web pages by themselves. Private groups (WhatsApp, Telegram, Discord, Facebook) cannot be joined by a bot, so those readers work from messages you copy and paste in. Nothing is invented: every lead comes from a real post, page or message.</p></div>
    <form class="card" id="sc-settings"></form>
    <section><div class="row-between sc-sec-head"><h2>Your scouts</h2></div><div class="scout-grid" id="sc-agents"></div></section>
    <section class="card mt"><div class="card-head sc-pipe-head"><div><h2>Vendor pipeline</h2><p class="muted small" id="sc-pipe-sub"></p></div>
      <label class="search"><span class="sr-only">Search vendors</span><input type="search" id="sc-q" placeholder="Search vendors, products, places"></label></div>
      <div class="tabs board-tabs" id="sc-tabs" role="tablist" aria-label="Pipeline stage"></div>
      <div class="board" id="sc-board"></div></section>`;
  el.querySelector('#sc-run').addEventListener('click', (e) => busy(e.currentTarget, () => run()));
  el.querySelector('#sc-add').addEventListener('click', addVendor);
  el.querySelector('#sc-q').addEventListener('input', debounce((e) => { q = e.target.value.trim().toLowerCase(); renderBoard(); }, 180));
  await load(true);
}
export function unmount() { root = null; }

async function load(withSettings) {
  const d = await api('/api/admin/scouts');
  if (!root) return;
  data = { agents: [], leads: [], tasks: [], settings: {}, last_run: 0, ...d };
  data.settings = { wishlist: '', auto_run: false, min_score: 40, ...(data.settings || {}) };
  root.querySelector('#sc-last').textContent = data.last_run ? `Last run ${ago(data.last_run)}.${data.settings.auto_run ? ' They also run by themselves every few hours.' : ''}` : 'The scouts have not run yet. Press Run all scouts to start.';
  if (withSettings) renderSettings();
  renderAgents();
  renderBoard();
}

async function run(agentKey) {
  const r = await post('/api/admin/scouts/run', agentKey ? { agent_key: agentKey } : {});
  const n = (r && r.found) || 0;
  toast(n ? `Found ${n} new ${n === 1 ? 'vendor' : 'vendors'}. They are in the New column.` : (r && Array.isArray(r.notes) && r.notes.length ? r.notes.join(' ') : (r && typeof r.notes === 'string' && r.notes)) || 'No new vendors this time. Try again later or widen what you are looking for.');
  await load(false);
}

function renderSettings() {
  const s = data.settings;
  const f = root.querySelector('#sc-settings');
  f.innerHTML = `<div class="sc-settings">
      <label class="field sc-wish"><span>What we are looking for</span><textarea name="wishlist" rows="3" placeholder="For example: sublimated jerseys and socks, match balls, low minimum order, ships to the USA">${esc(s.wishlist)}</textarea>
        <small class="muted">The scouts use this to decide what to search for and how well a vendor fits.</small></label>
      <div class="sc-set-side">
        <label class="row-gap sc-toggle"><span class="switch"><input type="checkbox" name="auto_run" ${s.auto_run ? 'checked' : ''}><span class="switch-ui"></span></span><span><strong>Run by themselves</strong><br><small class="muted">Every few hours</small></span></label>
        <label class="field"><span>Only keep vendors scoring at least</span><input type="number" name="min_score" min="0" max="100" value="${esc(s.min_score)}"></label>
        <button class="btn btn-primary" type="submit">Save</button>
      </div></div>`;
  f.onsubmit = (e) => {
    e.preventDefault();
    const body = { wishlist: f.elements.wishlist.value.trim(), auto_run: f.elements.auto_run.checked, min_score: Math.max(0, Math.min(100, +f.elements.min_score.value || 0)) };
    busy(e.submitter, async () => { await post('/api/admin/scouts/settings', body); Object.assign(data.settings, body); toast('Saved. The scouts will use this on their next run.'); });
  };
}

function renderAgents() {
  const box = root.querySelector('#sc-agents');
  if (!data.agents.length) { box.innerHTML = '<div class="empty card"><p>No scouts are set up yet.</p></div>'; return; }
  box.innerHTML = data.agents.map((a) => {
    const tasks = data.tasks.filter((t) => t.agent_key === a.key);
    const on = a.status !== 'paused';
    const paste = a.how === 'paste' || a.how === 'links';
    return `<article class="scout${on ? '' : ' paused'}">
      <div class="scout-head">${chIcon(a.channel)}<div class="scout-title"><strong>${esc(a.name)}</strong><span class="muted small">${esc(HOW[a.how] || '')}</span></div>
        <label class="switch" title="${on ? 'Active' : 'Paused'}"><input type="checkbox" data-status="${esc(a.key)}" ${on ? 'checked' : ''} aria-label="${esc(a.name)} active"><span class="switch-ui"></span></label></div>
      <p class="small scout-role">${esc(a.role)}</p>
      <div class="scout-stats small"><span>${a.last_run ? 'Ran ' + ago(a.last_run) : 'Not run yet'}</span><span><strong>${Number(a.found_total || 0)}</strong> found</span><span class="pill pill-${on ? 'ok' : 'muted'}">${on ? 'Active' : 'Paused'}</span></div>
      ${a.last_note ? `<p class="muted small scout-note">${esc(a.last_note)}</p>` : ''}
      <div class="row-gap scout-actions">
        ${a.how !== 'paste' ? `<button class="btn btn-sm" data-run="${esc(a.key)}" ${on ? '' : 'disabled'}>Run</button>` : ''}
        ${paste ? `<button class="btn btn-sm${a.how === 'paste' ? ' btn-primary' : ''}" data-paste="${esc(a.key)}">${a.how === 'links' ? 'Open searches and paste' : 'Paste messages'}</button>` : ''}
        ${a.how === 'live' && tasks.length ? `<button class="btn btn-sm btn-ghost" data-paste="${esc(a.key)}">Search links (${tasks.length})</button>` : ''}
      </div></article>`;
  }).join('');
  box.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => busy(b, () => run(b.dataset.run))));
  box.querySelectorAll('[data-paste]').forEach((b) => b.addEventListener('click', () => pasteDrawer(data.agents.find((a) => a.key === b.dataset.paste))));
  box.querySelectorAll('[data-status]').forEach((c) => c.addEventListener('change', async () => {
    const status = c.checked ? 'active' : 'paused';
    try {
      await post('/api/admin/scouts/agents/' + encodeURIComponent(c.dataset.status), { status });
      const a = data.agents.find((x) => x.key === c.dataset.status); if (a) a.status = status;
      toast(`${a ? a.name : 'Scout'} is ${status === 'active' ? 'active' : 'paused'}`);
      renderAgents();
    } catch (e) { c.checked = !c.checked; fail(e); }
  }));
}

function pasteDrawer(a) {
  if (!a) return;
  const tasks = data.tasks.filter((t) => t.agent_key === a.key);
  const help = PASTE_HELP[chKey(a.channel)] || PASTE_HELP.web;
  const dr = openDrawer(`<form class="drawer-body" id="pd-form"><div class="drawer-title"><div><h2>${esc(a.name)}</h2><p class="muted small">${esc(a.role)}</p></div></div>
    ${tasks.length ? `<section class="od-sec"><h3>Searches to open</h3><p class="muted small">Each opens in a new tab. Look through the results and copy what looks promising.</p>
      <ul class="task-list">${tasks.map((t) => `<li><a class="btn btn-sm" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Open search</a><span>${esc(t.title)}</span></li>`).join('')}</ul></section>` : ''}
    <section class="od-sec"><h3>Paste here</h3>${a.how === 'paste' || a.how === 'links' ? `<details class="howto" ${tasks.length ? '' : 'open'}><summary>How to copy the messages</summary>${help}</details>` : ''}
      <label class="field"><span class="sr-only">Pasted text</span><textarea name="text" rows="12" class="paste-box" placeholder="Paste messages, posts or listings here"></textarea></label>
      <div class="row-gap"><label class="btn btn-sm file-btn">Pick a .txt file<input type="file" accept=".txt,text/plain" class="sr-only" id="pd-file"></label><span class="muted small" id="pd-count"></span></div>
      <p class="muted small">Only what you paste is read. Phone numbers, emails and links are kept with each vendor so you can contact them.</p></section>
    <div class="drawer-actions"><button class="btn btn-primary" type="submit">Find vendors in this text</button></div>
    <div id="pd-result"></div></form>`);
  const form = dr.querySelector('#pd-form');
  const ta = form.elements.text;
  const count = () => { dr.querySelector('#pd-count').textContent = ta.value ? `${ta.value.split(/\n/).length} lines pasted` : ''; };
  ta.addEventListener('input', count);
  dr.querySelector('#pd-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 5e6) { toast('That file is too big. Copy only the recent part of the chat.', 'err'); return; }
    ta.value = await file.text(); count();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (text.length < 10) { toast('Paste some messages first.', 'err'); ta.focus(); return; }
    busy(e.submitter, async () => {
      const r = await post('/api/admin/scouts/paste', { agent_key: a.key, text });
      const n = (r && r.found) || 0;
      const leads = (r && r.leads) || [];
      dr.querySelector('#pd-result').innerHTML = `<div class="explain mt"><p><strong>${n ? `Found ${n} ${n === 1 ? 'vendor' : 'vendors'}.` : 'No vendors found in this text.'}</strong>
        ${n ? ' They are in the New column of your pipeline.' : ' Try pasting messages where people mention a shop, factory, price or contact.'}</p>
        ${leads.length ? `<ul class="plain small">${leads.map((l) => `<li>${esc(l.name)}${l.location ? `, ${esc(l.location)}` : ''}</li>`).join('')}</ul>` : ''}</div>`;
      toast(n ? `Added ${n} ${n === 1 ? 'vendor' : 'vendors'}` : 'No vendors found in that text');
      if (n) ta.value = '';
      count();
      await load(false);
    });
  });
  setTimeout(() => ta.focus(), 50);
}

// ---------------------------------------------------------------- pipeline
const nowS = () => Date.now() / 1000;
function followBadge(l) {
  if (!l.follow_up_at || l.stage === 'passed') return '';
  const days = Math.floor((l.follow_up_at - nowS()) / 86400);
  if (l.follow_up_at <= nowS() + 3600 * 6) return `<span class="due due-now">Follow up ${l.follow_up_at < nowS() - 86400 ? 'overdue' : 'today'}</span>`;
  return `<span class="due">Follow up ${days < 1 ? 'tomorrow' : esc(date(l.follow_up_at).replace(/, \d{4}$/, ''))}</span>`;
}
const scoreTone = (s) => (s >= 70 ? 'hi' : s >= 40 ? 'mid' : 'lo');
const matches = (l) => !q || `${l.name} ${l.location} ${(l.products || []).join(' ')} ${l.channel} ${l.notes} ${l.contact}`.toLowerCase().includes(q);

function leadCard(l) {
  const sc = Math.max(0, Math.min(100, Math.round(+l.score || 0)));
  const low = sc < (+data.settings.min_score || 0);
  return `<button type="button" class="lead${low ? ' lead-low' : ''}" data-lead="${l.id}" draggable="true">
    <span class="lead-top"><strong>${esc(l.name)}</strong>${chChip(l.channel)}</span>
    <span class="meter" title="Fit score ${sc} of 100"><span class="meter-bar meter-${scoreTone(sc)}" style="width:${sc}%"></span></span>
    <span class="lead-meta small"><span>Fit ${sc}/100</span>${l.location ? `<span>${esc(l.location)}</span>` : ''}</span>
    ${(l.products || []).length ? `<span class="chips">${l.products.slice(0, 4).map((p) => `<span class="badge">${esc(p)}</span>`).join('')}</span>` : ''}
    ${l.next_step ? `<span class="small lead-next">Next: ${esc(l.next_step)}</span>` : ''}
    ${followBadge(l)}</button>`;
}

function renderBoard() {
  if (!root) return;
  const leads = data.leads.filter(matches);
  const by = Object.fromEntries(STAGES.map(([k]) => [k, []]));
  leads.forEach((l) => (by[l.stage] || by.new).push(l));
  Object.values(by).forEach((arr) => arr.sort((a, b) => (b.follow_up_at && b.follow_up_at <= nowS()) - (a.follow_up_at && a.follow_up_at <= nowS()) || (b.score || 0) - (a.score || 0)));
  const due = data.leads.filter((l) => l.follow_up_at && l.follow_up_at <= nowS() + 3600 * 6 && l.stage !== 'passed' && l.stage !== 'partner').length;
  root.querySelector('#sc-pipe-sub').textContent = data.leads.length
    ? `${data.leads.length} vendors, ${by.partner.length} ${by.partner.length === 1 ? "partner" : "partners"}.${due ? ` ${due} need a follow up.` : ''} Drag a card to another column, or tap it to open.`
    : '';
  root.querySelector('#sc-tabs').innerHTML = STAGES.map(([k, l]) => `<button type="button" class="tab${k === stageView ? ' on' : ''}" data-tab="${k}" role="tab" aria-selected="${k === stageView}">${l}<span class="count">${by[k].length}</span></button>`).join('');
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { stageView = b.dataset.tab; renderBoard(); }));
  const board = root.querySelector('#sc-board');
  if (!data.leads.length) {
    board.innerHTML = `<div class="empty board-empty"><p><strong>No vendors yet.</strong></p><p>Press <strong>Run all scouts</strong> to search Reddit and the web, paste a group chat into one of the readers above, or add a vendor you already know.</p>
      <button class="btn" type="button" data-add>Add a vendor</button></div>`;
    board.querySelector('[data-add]').addEventListener('click', addVendor);
    return;
  }
  const EMPTY = { new: 'New finds land here.', contacted: 'Vendors you have messaged.', talking: 'Vendors who replied.', sampling: 'Ordered or asked for a sample.', partner: 'Vendors you work with.', passed: 'Not a fit for now.' };
  board.innerHTML = STAGES.map(([k, label]) => `<div class="col${k === stageView ? ' on' : ''}" data-col="${k}"><div class="col-head"><span>${label}</span><span class="count">${by[k].length}</span></div>
    <div class="col-body">${by[k].length ? by[k].map(leadCard).join('') : `<p class="muted small col-empty">${q ? 'No matches.' : EMPTY[k]}</p>`}</div></div>`).join('');
  board.querySelectorAll('[data-lead]').forEach((b) => {
    b.addEventListener('click', () => openLead(+b.dataset.lead || b.dataset.lead));
    b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', b.dataset.lead); e.dataTransfer.effectAllowed = 'move'; b.classList.add('dragging'); });
    b.addEventListener('dragend', () => b.classList.remove('dragging'));
  });
  board.querySelectorAll('[data-col]').forEach((c) => {
    c.addEventListener('dragover', (e) => { e.preventDefault(); c.classList.add('drop-on'); });
    c.addEventListener('dragleave', () => c.classList.remove('drop-on'));
    c.addEventListener('drop', async (e) => {
      e.preventDefault(); c.classList.remove('drop-on');
      const l = findLead(e.dataTransfer.getData('text/plain'));
      if (!l || l.stage === c.dataset.col) return;
      try { await saveLead(l, { stage: c.dataset.col }); toast(`${l.name} moved to ${STAGE_LABEL[c.dataset.col]}`); } catch (ex) { fail(ex); }
    });
  });
}

const findLead = (id) => data.leads.find((l) => String(l.id) === String(id));
async function saveLead(l, patch) {
  const r = await post('/api/admin/scouts/leads/' + encodeURIComponent(l.id), patch);
  const fresh = (r && r.lead) || { ...l, ...patch };
  Object.assign(l, fresh);
  renderBoard();
  return l;
}

const EV = { found: ['Found', 'info'], message: ['You sent', 'ok'], reply: ['They replied', 'done'], note: ['Note', 'muted'], stage: ['Moved', 'warn'] };
const toDateInput = (t) => { if (!t) return ''; const d = new Date(t * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromDateInput = (v) => { if (!v) return 0; const [y, m, d] = v.split('-').map(Number); return Math.round(new Date(y, m - 1, d, 10).getTime() / 1000); };
const phoneOf = (s) => { const m = String(s || '').match(/\+?\d[\d\s().-]{6,}\d/); return m ? m[0].replace(/\D/g, '') : ''; };
const emailOf = (s) => { const m = String(s || '').match(/[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}/i); return m ? m[0] : ''; };
const safeUrl = (u) => { const s = String(u || '').trim(); if (!s) return ''; const full = /^https?:\/\//i.test(s) ? s : 'https://' + s; try { const x = new URL(full); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } };

function openLead(id) {
  const l = findLead(id);
  if (!l) return;
  const agent = data.agents.find((a) => a.key === l.agent_key);
  const dr = openDrawer(`<div class="drawer-body">
    <div class="drawer-title"><div><h2 id="ld-name">${esc(l.name)}</h2><p class="muted small">${chChip(l.channel)} ${l.kind ? esc(l.kind) + ', ' : ''}${l.location ? esc(l.location) + ', ' : ''}fit ${Math.round(+l.score || 0)}/100. ${agent ? `Found by ${esc(agent.name)}` : 'Added'} ${date(l.created)}.</p></div></div>
    <section class="od-sec"><h3>Where it stands</h3>
      <div class="stage-pick" role="radiogroup" aria-label="Stage">${STAGES.map(([k, lab]) => `<label class="seg-radio"><input type="radio" name="ld-stage" value="${k}" ${l.stage === k ? 'checked' : ''}><span>${lab}</span></label>`).join('')}</div>
      <div class="form-grid">
        <label class="field span-2"><span>Next step</span><input id="ld-next" maxlength="200" value="${esc(l.next_step)}" placeholder="For example: ask for a sample jersey and their price list"></label>
        <label class="field"><span>Follow up on</span><input type="date" id="ld-follow" value="${toDateInput(l.follow_up_at)}"></label>
        <div class="field"><span>Quick dates</span><div class="row-gap">${[[2, 'In 2 days'], [7, 'Next week']].map(([d, t]) => `<button type="button" class="btn btn-sm" data-days="${d}">${t}</button>`).join('')}<button type="button" class="btn btn-sm btn-ghost" data-days="0">Clear</button></div></div>
      </div>
      <button class="btn btn-primary btn-sm" type="button" id="ld-save-step">Save stage and follow up</button></section>
    <section class="od-sec"><h3>Contact them</h3>
      <div class="form-grid"><label class="field"><span>What to write</span><select id="ld-purpose">
        <option value="intro">First hello</option><option value="follow_up">Friendly follow up</option><option value="sample">Ask for a sample</option><option value="partner">Propose working together</option></select></label>
        <div class="field"><span>&nbsp;</span><button class="btn" type="button" id="ld-draft">Write a message for me</button></div></div>
      <label class="field"><span class="sr-only">Message</span><textarea id="ld-msg" rows="6" placeholder="Your message will appear here. You can edit it before sending."></textarea></label>
      <div class="row-gap" id="ld-links"></div>
      <p class="muted small">Sending opens WhatsApp, your email app or their page. Nothing is sent by itself. After you send it, press "Log a message I sent" below.</p></section>
    <section class="od-sec"><h3>History</h3>
      <label class="field"><span class="sr-only">What happened</span><textarea id="ld-ev" rows="3" placeholder="Paste the message you sent, their reply, or a note"></textarea></label>
      <div class="row-gap"><button class="btn btn-sm" type="button" data-ev="message">Log a message I sent</button><button class="btn btn-sm" type="button" data-ev="reply">Log their reply</button><button class="btn btn-sm btn-ghost" type="button" data-ev="note">Add note</button></div>
      <ul class="timeline mt" id="ld-tl"></ul></section>
    <form class="od-sec" id="ld-form"><h3>Details</h3><div class="form-grid">
      <label class="field span-2"><span>Name</span><input name="name" required maxlength="120" value="${esc(l.name)}"></label>
      <label class="field"><span>Contact (phone, email or handle)</span><input name="contact" maxlength="200" value="${esc(l.contact)}"></label>
      <label class="field"><span>Website or post link</span><input name="url" maxlength="500" value="${esc(l.url)}"></label>
      <label class="field span-2"><span>Products (comma separated)</span><input name="products" value="${esc((l.products || []).join(', '))}"></label>
      <label class="field"><span>Minimum order</span><input name="moq" maxlength="80" value="${esc(l.moq)}" placeholder="For example 50 pieces"></label>
      <label class="field"><span>Prices</span><input name="price_note" maxlength="160" value="${esc(l.price_note)}" placeholder="For example $7 per jersey"></label>
      <label class="field span-2"><span>Notes</span><textarea name="notes" rows="3">${esc(l.notes)}</textarea></label></div>
      <div class="row-gap"><button class="btn btn-primary" type="submit">Save details</button><button class="btn btn-danger-ghost" type="button" id="ld-del">Delete vendor</button></div></form>
  </div>`, { wide: false });

  const msg = dr.querySelector('#ld-msg');
  const renderLinks = () => {
    const text = msg.value.trim();
    const phone = phoneOf(l.contact), email = emailOf(l.contact), url = safeUrl(l.url);
    const out = [];
    if (phone) out.push(`<a class="btn btn-sm wa-btn" target="_blank" rel="noopener noreferrer" href="https://wa.me/${phone}${text ? '?text=' + encodeURIComponent(text) : ''}">Open in WhatsApp</a>`);
    if (email) out.push(`<a class="btn btn-sm" href="mailto:${encodeURI(email)}?subject=${encodeURIComponent('SquadForge: working together')}${text ? '&body=' + encodeURIComponent(text) : ''}">Email them</a>`);
    if (url) out.push(`<a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="${esc(url)}">Open their page</a>`);
    out.push(`<button type="button" class="btn btn-sm" id="ld-copy" ${text ? '' : 'disabled'}>Copy message</button>`);
    if (!phone && !email && !url) out.push('<span class="muted small">Add a phone, email or link under Details to get quick buttons here.</span>');
    const box = dr.querySelector('#ld-links');
    box.innerHTML = out.join('');
    box.querySelector('#ld-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(msg.value); toast('Message copied'); } catch (e) { msg.select(); document.execCommand('copy'); toast('Message copied'); }
    });
  };
  msg.addEventListener('input', debounce(renderLinks, 200));
  renderLinks();

  const renderTl = () => {
    const evs = [...(l.events || [])].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    dr.querySelector('#ld-tl').innerHTML = evs.length ? evs.map((e) => {
      const [lab, tone] = EV[e.kind] || [e.kind, 'muted'];
      return `<li><span class="tl-dot ev-${tone}"></span><div><span class="pill pill-${tone}">${esc(lab)}</span> <span class="muted small">${dateTime(e.ts)}</span><p class="small ev-text">${esc(e.text)}</p></div></li>`;
    }).join('') : '<li class="muted small">Nothing logged yet.</li>';
  };
  renderTl();

  const refreshHead = () => { dr.querySelector('#ld-name').textContent = l.name; };

  dr.querySelector('#ld-draft').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const r = await post(`/api/admin/scouts/leads/${encodeURIComponent(l.id)}/draft`, { purpose: dr.querySelector('#ld-purpose').value });
    msg.value = (r && r.text) || '';
    renderLinks();
    msg.focus();
  }));

  const follow = dr.querySelector('#ld-follow');
  dr.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
    const d = +b.dataset.days;
    follow.value = d ? toDateInput(nowS() + d * 86400) : '';
  }));
  dr.querySelector('#ld-save-step').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const stage = (dr.querySelector('[name="ld-stage"]:checked') || {}).value || l.stage;
    await saveLead(l, { stage, next_step: dr.querySelector('#ld-next').value.trim(), follow_up_at: fromDateInput(follow.value) });
    renderTl();
    toast(`Saved. ${l.name} is in ${STAGE_LABEL[l.stage] || l.stage}.`);
  }));

  dr.querySelectorAll('[data-ev]').forEach((b) => b.addEventListener('click', () => {
    const ta = dr.querySelector('#ld-ev');
    let text = ta.value.trim();
    if (!text && b.dataset.ev === 'message' && msg.value.trim()) text = msg.value.trim();
    if (!text) { toast('Write or paste what happened first.', 'err'); ta.focus(); return; }
    busy(b, async () => {
      const r = await post(`/api/admin/scouts/leads/${encodeURIComponent(l.id)}/event`, { kind: b.dataset.ev, text });
      if (r && r.lead) Object.assign(l, r.lead); else (l.events = l.events || []).push({ ts: nowS(), kind: b.dataset.ev, text });
      ta.value = '';
      renderTl(); renderBoard();
      const st = dr.querySelector(`[name="ld-stage"][value="${l.stage}"]`); if (st) st.checked = true;
      toast(b.dataset.ev === 'note' ? 'Note added' : 'Logged');
    });
  }));

  const form = dr.querySelector('#ld-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    if (!fd.name.trim()) { toast('Give the vendor a name.', 'err'); return; }
    const body = { name: fd.name.trim(), contact: fd.contact.trim(), url: fd.url.trim(), moq: fd.moq.trim(), price_note: fd.price_note.trim(), notes: fd.notes,
      products: fd.products.split(',').map((s) => s.trim()).filter(Boolean) };
    busy(e.submitter, async () => { await saveLead(l, body); refreshHead(); renderLinks(); toast('Vendor saved'); });
  });
  dr.querySelector('#ld-del').addEventListener('click', async (e) => {
    if (!await confirmBox(`Delete ${l.name} and its history? If they are just not a fit, move them to Passed instead.`, { ok: 'Delete', danger: true })) return;
    busy(e.currentTarget, async () => {
      await api('/api/admin/scouts/leads/' + encodeURIComponent(l.id), { method: 'DELETE' });
      data.leads = data.leads.filter((x) => x !== l);
      closeDrawer(); renderBoard(); toast('Vendor deleted');
    });
  });
}

function addVendor() {
  const dr = openDrawer(`<form class="drawer-body" id="av-form"><div class="drawer-title"><div><h2>Add a vendor</h2><p class="muted small">Someone you already know or found yourself. Only the name is needed.</p></div></div>
    <div class="form-grid">
      <label class="field span-2"><span>Name</span><input name="name" required maxlength="120" placeholder="For example Sialkot Pro Balls"></label>
      <label class="field"><span>What they are</span><select name="kind"><option value="factory">Factory or maker</option><option value="print shop">Print shop</option><option value="wholesaler">Wholesaler</option><option value="reseller">Reseller</option><option value="other">Other</option></select></label>
      <label class="field"><span>Where you found them</span><select name="channel">${['manual', 'whatsapp', 'telegram', 'discord', 'facebook', 'reddit', 'marketplace', 'web', 'email'].map((c) => `<option value="${c}">${esc(CH[c][0])}</option>`).join('')}</select></label>
      <label class="field"><span>Contact (phone, email or handle)</span><input name="contact" maxlength="200"></label>
      <label class="field"><span>Website or post link</span><input name="url" maxlength="500"></label>
      <label class="field"><span>Location</span><input name="location" maxlength="120" placeholder="City, country"></label>
      <label class="field"><span>Minimum order</span><input name="moq" maxlength="80"></label>
      <label class="field span-2"><span>Products (comma separated)</span><input name="products" placeholder="jerseys, socks, balls"></label>
      <label class="field span-2"><span>Prices</span><input name="price_note" maxlength="160"></label>
      <label class="field span-2"><span>Notes</span><textarea name="notes" rows="3"></textarea></label>
    </div><div class="drawer-actions"><button class="btn btn-primary" type="submit">Add to pipeline</button></div></form>`);
  const form = dr.querySelector('#av-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    if (!fd.name.trim()) { toast('Give the vendor a name.', 'err'); return; }
    const body = { ...fd, name: fd.name.trim(), products: fd.products.split(',').map((s) => s.trim()).filter(Boolean) };
    busy(e.submitter, async () => {
      const r = await post('/api/admin/scouts/leads', body);
      toast(`${body.name} added to your pipeline`);
      await load(false);
      stageView = 'new';
      if (r && r.lead) { if (!findLead(r.lead.id)) data.leads.push(r.lead); renderBoard(); openLead(r.lead.id); } else closeDrawer();
    });
  });
  setTimeout(() => form.elements.name.focus(), 50);
}
