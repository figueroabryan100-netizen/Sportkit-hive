// Shared helpers for the SquadForge admin: API calls, toasts, formatting, drawers, previews.

export class AuthError extends Error {}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, opts = {}) {
  const init = { credentials: 'same-origin', method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(path, init); } catch (e) { throw new Error('Could not reach the server. Check your connection.'); }
  if (res.status === 401 && !opts.allow401) { onUnauthorized(); throw new AuthError('Please sign in again.'); }
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) data = await res.json().catch(() => null);
  if (!res.ok) {
    let msg = data && data.detail ? data.detail : `Something went wrong (${res.status}).`;
    if (typeof msg !== 'string') msg = 'Please check the form and try again.';
    throw new Error(msg);
  }
  return data;
}
export const post = (path, body) => api(path, { body: body === undefined ? {} : body });

export function toast(msg, kind = 'ok') {
  const box = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast toast-' + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3600);
  setTimeout(() => t.remove(), 4000);
}
export function fail(e) { if (!(e instanceof AuthError)) toast(e.message || String(e), 'err'); }

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const money = (n, dec = 2) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const num = (n) => Number(n || 0).toLocaleString('en-US');
export const date = (t) => t ? new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
export const dateTime = (t) => t ? new Date(t * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
export function ago(t) {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
  return date(t);
}

export const STATUS_TONE = {
  awaiting_payment: 'warn', payment_review: 'alert', paid: 'ok', in_production: 'info',
  shipped: 'info', delivered: 'done', cancelled: 'muted', refunded: 'muted',
};
export const statusPill = (key, label) => `<span class="pill pill-${STATUS_TONE[key] || 'muted'}">${esc(label || key)}</span>`;

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- design previews
export function swatchHTML(d = {}, size = 56) {
  const p = d.primary || '#04282e', s = d.secondary || '#c8f53c', a = d.accent || '#ffffff';
  return `<span class="swatch" style="width:${size}px;height:${size}px;background:linear-gradient(135deg, ${esc(p)} 0 55%, ${esc(s)} 55% 80%, ${esc(a)} 80%)" aria-hidden="true"></span>`;
}

const thumbCache = new Map();
let thumbQueue = Promise.resolve();
// Fill every [data-thumb] placeholder in root with a 3D render when Gear3D is available.
export function hydrateThumbs(root, designs, size = 240) {
  if (!window.Gear3D || typeof window.Gear3D.thumb !== 'function') return;
  $$('[data-thumb]', root).forEach((el) => {
    const d = designs[el.dataset.thumb];
    if (!d) return;
    const key = JSON.stringify(d) + size;
    const apply = (url) => { if (url && el.isConnected) el.innerHTML = `<img src="${esc(url)}" alt="" width="${el.offsetWidth || 56}" height="${el.offsetHeight || 56}">`; };
    if (thumbCache.has(key)) { apply(thumbCache.get(key)); return; }
    thumbQueue = thumbQueue.then(async () => {
      if (!el.isConnected) return;
      try { const url = await window.Gear3D.thumb(d, size); thumbCache.set(key, url); apply(url); } catch (e) { /* keep swatch */ }
    });
  });
}
export const thumbHTML = (key, design, size = 56) => `<span class="thumb" data-thumb="${esc(key)}" style="width:${size}px;height:${size}px">${swatchHTML(design, size)}</span>`;

// Load the 3D module once. Resolves to the module or null.
let gearMod;
export function gear3d() {
  if (gearMod === undefined) {
    gearMod = import('/js/gear3d.js?v=6').then((m) => {
      if (!window.Gear3D && m && m.thumb) window.Gear3D = m;
      return m;
    }).catch(() => null);
  }
  return gearMod;
}

// ---------- drawer and dialogs
export function openDrawer(html, { wide = false, onClose } = {}) {
  closeDrawer();
  const root = document.getElementById('drawer-root');
  const prev = document.activeElement;
  root.innerHTML = `<div class="scrim" data-close></div>
    <aside class="drawer${wide ? ' drawer-wide' : ''}" role="dialog" aria-modal="true" tabindex="-1">
      <button class="icon-btn drawer-x" data-close aria-label="Close">&times;</button>${html}</aside>`;
  const dr = root.querySelector('.drawer');
  document.body.classList.add('has-drawer');
  const close = () => { closeDrawer(); onClose && onClose(); prev && prev.focus && prev.focus(); };
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  root._key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', root._key);
  root._close = close;
  setTimeout(() => dr.focus(), 0);
  return dr;
}
export function closeDrawer() {
  const root = document.getElementById('drawer-root');
  if (root._key) document.removeEventListener('keydown', root._key);
  root._key = null;
  if (root._cleanup) { try { root._cleanup(); } catch (e) { /* ignore */ } root._cleanup = null; }
  root.innerHTML = '';
  document.body.classList.remove('has-drawer');
}
export function onDrawerCleanup(fn) { document.getElementById('drawer-root')._cleanup = fn; }

export function confirmBox(message, { ok = 'Yes, continue', danger = false } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="cf-msg">
      <p id="cf-msg">${esc(message)}</p>
      <div class="row-end"><button class="btn" data-v="0">Cancel</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-v="1">${esc(ok)}</button></div></div>`;
    document.body.appendChild(wrap);
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', key);
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); else if (e.target === wrap) done(false); });
    wrap.querySelector('[data-v="1"]').focus();
  });
}

export function promptBox(title, fields, okLabel = 'Apply') {
  // fields: [{name,label,type,value,min,max,step}]
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="pb-t">
      <h3 id="pb-t">${esc(title)}</h3>
      ${fields.map((f) => `<label class="field"><span>${esc(f.label)}</span><input name="${f.name}" type="${f.type || 'number'}" value="${esc(f.value ?? '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} step="${f.step || 'any'}" required></label>`).join('')}
      <div class="row-end"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn btn-primary">${esc(okLabel)}</button></div></form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form');
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', key);
    wrap.querySelector('[data-cancel]').onclick = () => done(null);
    form.onsubmit = (e) => { e.preventDefault(); done(Object.fromEntries(new FormData(form))); };
    form.querySelector('input').focus();
  });
}

// Run an async action while a button shows it is busy.
export async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
  try { return await fn(); } catch (e) { fail(e); return undefined; } finally { if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); } }
}

export function periodSwitch(current, name = 'period') {
  return `<div class="seg" role="group" aria-label="Time period">${[7, 30, 90, 365].map((d) =>
    `<button type="button" class="seg-btn${d === current ? ' on' : ''}" data-${name}="${d}" aria-pressed="${d === current}">${d === 365 ? '12 months' : d + ' days'}</button>`).join('')}</div>`;
}

export const SHAPE_LABEL = (s) => String(s || '').replace('ball-', '').replace('-', ' ').replace(/^\w/, (c) => c.toUpperCase());
