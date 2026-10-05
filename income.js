import { api, post, toast, fail, esc, busy, confirmBox } from './ui.js?v=6';

const PLACES = [['home', 'Home page', 'Between sections on the home page'], ['shop', 'Shop grid', 'One ad tile inside the product grid'],
  ['product', 'Product pages', 'Below the product details'], ['footer', 'Footer', 'A banner above the footer on every page']];

let root, ads, extras;

export async function mount(el) {
  root = el;
  const s = (await api('/api/admin/settings')).settings;
  ads = { adsense_client: '', adsense_slot: '', placements: ['shop', 'footer'], every_n: 12, house: [], ads_txt_extra: '', ...(s.ads || {}) };
  ads.house = (ads.house || []).map((h) => ({ title: '', image: '', link: '', active: true, placement: 'footer', ...h }));
  extras = { rush_fee: 15, rush_days: 5, gift_wrap_fee: 4, referral_percent: 10, referral_enabled: true, ...(s.extras || {}) };
  el.innerHTML = `<header class="page-head"><div><h1>Ads and extra income</h1><p class="muted">Ways to earn a little more from every visit and every order. Everything here is optional.</p></div></header>
  <form id="in-extras" class="card"><h2>Checkout upgrades</h2>
    <p class="muted small">Small add-ons customers can tick at checkout. They show up as their own line on the order and the packing slip.</p>
    <div class="form-grid four">
      <label class="field"><span>Rush production fee ($)</span><input name="rush_fee" type="number" min="0" step="0.01" value="${+extras.rush_fee}"></label>
      <label class="field"><span>Rush ready in (days)</span><input name="rush_days" type="number" min="1" max="60" step="1" value="${+extras.rush_days}"></label>
      <label class="field"><span>Gift wrap fee ($)</span><input name="gift_wrap_fee" type="number" min="0" step="0.01" value="${+extras.gift_wrap_fee}"></label>
    </div>
    <p class="muted small">Set a fee to 0 to hide that option.</p>
    <h2 class="mt">Refer a friend</h2>
    <p class="muted small">After each order the buyer gets a personal code to share. Friends save with it (up to 25 uses per code), and you get new customers.</p>
    <label class="check"><input type="checkbox" name="referral_enabled" ${extras.referral_enabled ? 'checked' : ''}><span>Give every buyer a referral code</span></label>
    <label class="field narrow-field"><span>Friends save (percent)</span><input name="referral_percent" type="number" min="1" max="50" step="1" value="${+extras.referral_percent}"></label>
    <button class="btn btn-primary" type="submit">Save upgrades</button></form>

  <form id="in-ads" class="card"><h2>Google AdSense</h2>
    <div class="explain"><p>AdSense shows ads from Google on your pages and pays you per view and click. You need a Google AdSense account and Google must approve your site first, which can take a few days.</p>
      <p>Once approved, paste your publisher ID below (it looks like <code>ca-pub-1234567890123456</code>). Ads only appear in the places you tick. Ads on a store can distract buyers, so we suggest starting with just the shop grid and the footer.</p></div>
    <div class="form-grid">
      <label class="field"><span>Publisher ID</span><input name="adsense_client" value="${esc(ads.adsense_client)}" placeholder="ca-pub-1234567890123456" spellcheck="false" autocomplete="off"></label>
      <label class="field"><span>Ad unit ID (optional)</span><input name="adsense_slot" value="${esc(ads.adsense_slot)}" placeholder="1234567890" spellcheck="false" autocomplete="off"></label>
    </div>
    <fieldset class="field"><legend>Where ads may appear</legend><div class="place-grid">
      ${PLACES.map(([k, l, h]) => `<label class="radio-card"><input type="checkbox" name="placements" value="${k}" ${ads.placements.includes(k) ? 'checked' : ''}><span><strong>${l}</strong><small class="muted">${h}</small></span></label>`).join('')}</div></fieldset>
    <label class="field narrow-field"><span>In the shop grid, one ad every (products)</span><input name="every_n" type="number" min="4" max="60" step="1" value="${+ads.every_n || 12}"></label>
    <label class="field"><span>Extra ads.txt lines (only if an ad partner asks you)</span><textarea name="ads_txt_extra" rows="2" spellcheck="false">${esc(ads.ads_txt_extra || '')}</textarea></label>
    <p class="muted small">Your <a href="/ads.txt" target="_blank" rel="noopener">ads.txt file</a> is created for you from the publisher ID.</p>
    <h2 class="mt">Partner banners</h2>
    <p class="muted small">Your own sponsored banners, for example a local club, a sponsor or a partner shop. Clicks are counted in Analytics.</p>
    <div id="in-house"></div>
    <button type="button" class="btn btn-sm" id="in-house-add">Add a banner</button>
    <div class="row-gap mt"><button class="btn btn-primary" type="submit">Save ads</button></div></form>`;

  renderHouse();
  el.querySelector('#in-house-add').addEventListener('click', () => { readHouse(); ads.house.push({ title: '', image: '', link: '', active: true, placement: 'footer' }); renderHouse(); });
  el.querySelector('#in-extras').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    const body = { rush_fee: Math.max(0, +f.rush_fee.value || 0), rush_days: Math.max(1, +f.rush_days.value || 5), gift_wrap_fee: Math.max(0, +f.gift_wrap_fee.value || 0),
      referral_percent: Math.min(50, Math.max(1, +f.referral_percent.value || 10)), referral_enabled: f.referral_enabled.checked };
    busy(e.submitter, async () => { await post('/api/admin/settings', { extras: body }); extras = body; toast('Checkout upgrades saved'); });
  });
  el.querySelector('#in-ads').addEventListener('submit', (e) => {
    e.preventDefault();
    readHouse();
    const f = e.currentTarget.elements;
    const client = f.adsense_client.value.trim();
    if (client && !/^ca-pub-\d{10,20}$/.test(client)) { toast('The publisher ID should look like ca-pub- followed by numbers.', 'err'); f.adsense_client.focus(); return; }
    const bad = ads.house.find((h) => h.active && (!h.image || !/^(https?:\/\/|\/)/.test(h.link)));
    if (bad) { toast('Each active banner needs an image and a link starting with https:// (or switch it off).', 'err'); return; }
    const body = { adsense_client: client, adsense_slot: f.adsense_slot.value.trim(), placements: [...e.currentTarget.querySelectorAll('[name=placements]:checked')].map((c) => c.value),
      every_n: Math.max(4, +f.every_n.value || 12), ads_txt_extra: f.ads_txt_extra.value, house: ads.house };
    busy(e.submitter, async () => { await post('/api/admin/settings', { ads: body }); ads = body; toast('Ad settings saved'); });
  });
}
export function unmount() { root = null; }

function readHouse() {
  root.querySelectorAll('.house-row').forEach((row, i) => {
    const h = ads.house[i];
    h.title = row.querySelector('[data-k=title]').value.trim();
    h.link = row.querySelector('[data-k=link]').value.trim();
    h.placement = row.querySelector('[data-k=placement]').value;
    h.active = row.querySelector('[data-k=active]').checked;
  });
}

function renderHouse() {
  const box = root.querySelector('#in-house');
  box.innerHTML = ads.house.length ? ads.house.map((h, i) => `<div class="house-row">
      <div class="house-img">${h.image ? `<img src="${esc(h.image)}" alt="">` : '<span class="muted small">No image</span>'}
        <label class="btn btn-sm file-btn">${h.image ? 'Replace' : 'Upload'} image<input type="file" class="sr-only" accept="image/png,image/jpeg,image/webp,image/gif" data-up="${i}"></label></div>
      <div class="form-grid house-fields">
        <label class="field"><span>Title</span><input data-k="title" value="${esc(h.title)}" placeholder="For example Harbor City FC tryouts"></label>
        <label class="field"><span>Link</span><input data-k="link" type="url" value="${esc(h.link)}" placeholder="https://"></label>
        <label class="field"><span>Show in</span><select data-k="placement">${PLACES.map(([k, l]) => `<option value="${k}"${h.placement === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="row-gap"><label class="check"><input type="checkbox" data-k="active" ${h.active ? 'checked' : ''}><span>Active</span></label>
          <button type="button" class="btn btn-sm btn-danger-ghost" data-rm="${i}">Remove</button></div>
      </div></div>`).join('') : '<p class="muted small">No partner banners yet.</p>';
  box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmBox('Remove this banner? Save ads afterwards to make it final.', { ok: 'Remove' })) return;
    readHouse(); ads.house.splice(+b.dataset.rm, 1); renderHouse();
  }));
  box.querySelectorAll('[data-up]').forEach((inp) => inp.addEventListener('change', async () => {
    const file = inp.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try { const r = await api('/api/admin/upload', { body: fd }); readHouse(); ads.house[+inp.dataset.up].image = r.url; renderHouse(); toast('Image uploaded. Save ads to keep it.'); } catch (e) { fail(e); }
  }));
}
