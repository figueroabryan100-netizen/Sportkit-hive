import { api, post, toast, esc, busy } from './ui.js?v=6';

let root, s;

export async function mount(el) {
  root = el;
  s = (await api('/api/admin/settings')).settings;
  const ann = [...(s.announcement || [])];
  const tiers = (s.squad_tiers || []).map((t) => [...t]);
  el.innerHTML = `<header class="page-head"><div><h1>Store settings</h1><p class="muted">Your store name, home page text, shipping and team discounts.</p></div></header>
  <form id="st-form" class="settings-form">
    <section class="card"><h2>Basics</h2><div class="form-grid">
      <label class="field"><span>Store name</span><input name="name" required value="${esc(s.name)}"></label>
      <label class="field"><span>Support email</span><input name="support_email" type="email" value="${esc(s.support_email)}" placeholder="help@yourstore.com"></label>
      <label class="field"><span>Instagram</span><input name="instagram" value="${esc(s.instagram)}" placeholder="yourhandle or full link"></label>
      <label class="field"><span>TikTok</span><input name="tiktok" value="${esc(s.tiktok)}" placeholder="yourhandle or full link"></label>
    </div></section>
    <section class="card"><h2>Announcement bar</h2><p class="muted small">Short lines that scroll across the top of every page.</p>
      <ul class="ann-list" id="st-ann"></ul><button type="button" class="btn btn-sm" id="st-ann-add">Add a line</button></section>
    <section class="card"><h2>Home page banner</h2><div class="form-grid">
      <label class="field"><span>Small line above the headline</span><input name="hero_eyebrow" value="${esc(s.hero_eyebrow)}"></label>
      <label class="field"><span>Headline</span><input name="hero_headline" value="${esc(s.hero_headline)}"></label>
      <label class="field span-2"><span>Text under the headline</span><textarea name="hero_sub" rows="2">${esc(s.hero_sub)}</textarea></label>
    </div></section>
    <section class="card"><h2>Shipping and fees</h2><div class="form-grid four">
      <label class="field"><span>Free shipping over ($)</span><input name="free_ship_over" type="number" min="0" step="1" value="${s.free_ship_over}"></label>
      <label class="field"><span>Standard shipping ($)</span><input name="ship_flat" type="number" min="0" step="0.01" value="${s.ship_flat}"></label>
      <label class="field"><span>Express shipping ($)</span><input name="ship_express" type="number" min="0" step="0.01" value="${s.ship_express}"></label>
      <label class="field"><span>Extra for 2XL and up ($)</span><input name="big_size_fee" type="number" min="0" step="0.01" value="${s.big_size_fee}"></label>
    </div></section>
    <section class="card"><h2>Team order discounts</h2><p class="muted small">The more pieces in one order, the bigger the discount. The highest matching level applies.</p>
      <div class="tiers" id="st-tiers"></div><button type="button" class="btn btn-sm" id="st-tier-add">Add a level</button></section>
    <div class="sticky-save"><button class="btn btn-primary" type="submit">Save settings</button></div>
  </form>
  <form id="pw-form" class="card narrow"><h2>Change password</h2><p class="muted small">You will stay signed in here. Other devices get signed out.</p>
    <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
    <label class="field"><span>New password (at least 8 characters)</span><input type="password" name="new" autocomplete="new-password" minlength="8" required></label>
    <label class="field"><span>New password again</span><input type="password" name="again" autocomplete="new-password" minlength="8" required></label>
    <button class="btn" type="submit">Change password</button></form>`;

  const annBox = el.querySelector('#st-ann');
  const readAnn = () => { annBox.querySelectorAll('input').forEach((inp, i) => { ann[i] = inp.value; }); };
  const renderAnn = () => {
    annBox.innerHTML = ann.map((t, i) => `<li><label class="sr-only" for="ann-${i}">Line ${i + 1}</label><input id="ann-${i}" value="${esc(t)}" maxlength="90">
      <button type="button" class="icon-btn" data-up="${i}" aria-label="Move line ${i + 1} up" ${i ? '' : 'disabled'}>&uarr;</button>
      <button type="button" class="icon-btn" data-down="${i}" aria-label="Move line ${i + 1} down" ${i < ann.length - 1 ? '' : 'disabled'}>&darr;</button>
      <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove line ${i + 1}">&times;</button></li>`).join('') || '<li class="muted small">No lines. The bar is hidden.</li>';
  };
  annBox.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    readAnn();
    if (b.dataset.rm) ann.splice(+b.dataset.rm, 1);
    if (b.dataset.up) { const i = +b.dataset.up; [ann[i - 1], ann[i]] = [ann[i], ann[i - 1]]; }
    if (b.dataset.down) { const i = +b.dataset.down; [ann[i + 1], ann[i]] = [ann[i], ann[i + 1]]; }
    renderAnn();
    const focus = b.dataset.up ? +b.dataset.up - 1 : b.dataset.down ? +b.dataset.down + 1 : null;
    if (focus != null) annBox.querySelectorAll('input')[focus]?.focus();
  });
  el.querySelector('#st-ann-add').addEventListener('click', () => { readAnn(); ann.push(''); renderAnn(); annBox.querySelector('li:last-child input')?.focus(); });
  renderAnn();

  const tierBox = el.querySelector('#st-tiers');
  const readTiers = () => { tierBox.querySelectorAll('.tier').forEach((row, i) => { tiers[i] = [+row.querySelector('[data-min]').value || 0, +row.querySelector('[data-pct]').value || 0]; }); };
  const renderTiers = () => {
    tierBox.innerHTML = tiers.map(([mn, pct], i) => `<div class="tier"><label class="field-inline"><span>From</span><input data-min type="number" min="2" step="1" value="${mn}" aria-label="Level ${i + 1} minimum pieces"><span>pieces</span></label>
      <label class="field-inline"><span>save</span><input data-pct type="number" min="1" max="90" step="1" value="${pct}" aria-label="Level ${i + 1} percent off"><span>%</span></label>
      <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove level ${i + 1}">&times;</button></div>`).join('') || '<p class="muted small">No team discounts.</p>';
  };
  tierBox.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; readTiers(); tiers.splice(+b.dataset.rm, 1); renderTiers(); });
  el.querySelector('#st-tier-add').addEventListener('click', () => { readTiers(); const last = tiers[tiers.length - 1] || [4, 5]; tiers.push([last[0] + 10, Math.min(90, last[1] + 5)]); renderTiers(); });
  renderTiers();

  el.querySelector('#st-form').addEventListener('submit', (e) => {
    e.preventDefault();
    readAnn(); readTiers();
    const fd = Object.fromEntries(new FormData(e.currentTarget));
    if (!fd.name.trim()) { toast('Your store needs a name.', 'err'); return; }
    const body = {
      name: fd.name.trim(), support_email: fd.support_email.trim(), instagram: fd.instagram.trim(), tiktok: fd.tiktok.trim(),
      hero_eyebrow: fd.hero_eyebrow, hero_headline: fd.hero_headline, hero_sub: fd.hero_sub,
      free_ship_over: +fd.free_ship_over || 0, ship_flat: +fd.ship_flat || 0, ship_express: +fd.ship_express || 0, big_size_fee: +fd.big_size_fee || 0,
      announcement: ann.map((t) => t.trim()).filter(Boolean),
      squad_tiers: tiers.filter(([m, p]) => m > 0 && p > 0).sort((a, b) => a[0] - b[0]),
    };
    busy(e.submitter, async () => { await post('/api/admin/settings', body); toast('Settings saved. Your store is updated.'); });
  });

  el.querySelector('#pw-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const fd = Object.fromEntries(new FormData(f));
    if (fd.new.length < 8) { toast('The new password needs at least 8 characters.', 'err'); return; }
    if (fd.new !== fd.again) { toast('The two new passwords do not match.', 'err'); return; }
    busy(e.submitter, async () => { await post('/api/admin/password', { current: fd.current, new: fd.new }); f.reset(); toast('Password changed'); });
  });
}
export function unmount() { root = null; }
