import { api, post, toast, fail, esc, money, num, date, debounce, openDrawer, onDrawerCleanup, busy, confirmBox, promptBox, thumbHTML, hydrateThumbs, gear3d, SHAPE_LABEL } from './ui.js?v=6';

let root, data = null, leagues = [], selected = new Set(), limit = 60;
const f = { q: '', category: '', sport: '', league: '', status: '', sort: 'newest' };

const SORTS = { newest: ['Newest', (a, b) => b.created - a.created], views: ['Most viewed', (a, b) => b.views - a.views],
  sales: ['Best selling', (a, b) => b.units - a.units || b.revenue - a.revenue], likes: ['Most liked', (a, b) => b.likes - a.likes],
  price_hi: ['Price high to low', (a, b) => b.price - a.price], price_lo: ['Price low to high', (a, b) => a.price - b.price], name: ['Name A to Z', (a, b) => a.name.localeCompare(b.name)] };
const STATUS = { live: 'Live', draft: 'Draft (hidden)', archived: 'Archived (hidden)' };

export async function mount(el, { param }) {
  root = el; selected = new Set(); limit = 60;
  if (param && param.startsWith('league:')) { Object.assign(f, { q: '', category: '', sport: '', status: '', league: decodeURIComponent(param.slice(7)) }); param = ''; history.replaceState(null, '', '#/products'); }
  el.innerHTML = `<header class="page-head"><div><h1>Products</h1><p class="muted" id="pr-sub">Everything in your catalog.</p></div>
    <div class="head-actions"><button class="btn btn-primary" id="pr-new">New product</button></div></header>
    <div class="toolbar wrap" id="pr-filters"></div>
    <div class="bulkbar" id="pr-bulk" hidden></div>
    <div id="pr-list" class="card card-flush"></div>`;
  el.querySelector('#pr-new').addEventListener('click', newProduct);
  await reload();
  if (param) openEditor(decodeURIComponent(param));
}
export function unmount() { root = null; }

async function reload() {
  const [p, l] = await Promise.all([api('/api/admin/products'), api('/api/admin/leagues')]);
  data = p; leagues = l.leagues;
  if (!root) return;
  renderFilters();
  renderList();
}

function opt(v, label, cur) { return `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`; }

function renderFilters() {
  const cats = data.categories, sports = data.sports;
  const box = root.querySelector('#pr-filters');
  box.innerHTML = `<label class="search grow"><span class="sr-only">Search products</span><input type="search" id="pr-q" placeholder="Search products" value="${esc(f.q)}"></label>
    <label class="field-inline"><span class="sr-only">Category</span><select data-f="category">${opt('', 'All categories', f.category)}${cats.map((c) => opt(c, c, f.category)).join('')}</select></label>
    <label class="field-inline"><span class="sr-only">Sport</span><select data-f="sport">${opt('', 'All sports', f.sport)}${sports.map((c) => opt(c, c, f.sport)).join('')}</select></label>
    <label class="field-inline"><span class="sr-only">League</span><select data-f="league">${opt('', 'All leagues', f.league)}${opt('-', 'No league', f.league)}${leagues.map((c) => opt(c.key, c.name, f.league)).join('')}</select></label>
    <label class="field-inline"><span class="sr-only">Status</span><select data-f="status">${opt('', 'Any status', f.status)}${Object.entries(STATUS).map(([k, v]) => opt(k, v, f.status)).join('')}${opt('featured', 'Featured', f.status)}${opt('flash', 'On flash sale', f.status)}</select></label>
    <label class="field-inline"><span class="sr-only">Sort by</span><select data-f="sort">${Object.entries(SORTS).map(([k, v]) => opt(k, 'Sort: ' + v[0], f.sort)).join('')}</select></label>`;
  box.querySelector('#pr-q').addEventListener('input', debounce((e) => { f.q = e.target.value.trim().toLowerCase(); limit = 60; renderList(); }, 200));
  box.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; limit = 60; renderList(); }));
}

function filtered() {
  return data.products.filter((p) => {
    if (f.q && !(`${p.name} ${p.slug} ${p.league_name} ${p.sport} ${p.category}`.toLowerCase().includes(f.q))) return false;
    if (f.category && p.category !== f.category) return false;
    if (f.sport && p.sport !== f.sport) return false;
    if (f.league && (f.league === '-' ? p.league : p.league !== f.league)) return false;
    if (f.status === 'featured') return p.featured;
    if (f.status === 'flash') return p.flash;
    if (f.status && p.status !== f.status) return false;
    return true;
  }).sort(SORTS[f.sort][1]);
}

function renderList() {
  const rows = filtered();
  const shown = rows.slice(0, limit);
  root.querySelector('#pr-sub').textContent = `${num(data.products.length)} products, ${num(data.products.filter((p) => p.status === 'live').length)} live. Showing ${num(rows.length)}.`;
  const designs = {};
  shown.forEach((p) => { designs[p.slug] = { ...p.design, shape: p.shape || (p.design && p.design.shape) }; });
  const allOn = shown.length && shown.every((p) => selected.has(p.slug));
  const list = root.querySelector('#pr-list');
  list.innerHTML = rows.length ? `<div class="table-wrap"><table class="table products-table"><thead><tr>
      <th class="chk"><input type="checkbox" id="pr-all" aria-label="Select all shown" ${allOn ? 'checked' : ''}></th><th>Product</th><th>Price</th><th>Status</th>
      <th class="num">Views</th><th class="num">Sold</th><th class="num">Likes</th></tr></thead><tbody>
    ${shown.map((p) => `<tr data-slug="${esc(p.slug)}"${selected.has(p.slug) ? ' class="sel"' : ''}>
      <td class="chk"><input type="checkbox" data-sel="${esc(p.slug)}" aria-label="Select ${esc(p.name)}" ${selected.has(p.slug) ? 'checked' : ''}></td>
      <td><div class="prod-cell">${thumbHTML(p.slug, p.design, 48)}<div><button class="link strong" data-edit="${esc(p.slug)}">${esc(p.name)}</button>
        <div class="muted small">${esc(p.category)}, ${esc(p.sport)}${p.league_name ? `, ${esc(p.league_name)}` : ''}</div>
        <div class="badges">${p.featured ? '<span class="badge badge-lime">Featured</span>' : ''}${p.flash ? '<span class="badge badge-orange">Flash sale</span>' : ''}${p.new ? '<span class="badge">New</span>' : ''}</div></div></div></td>
      <td><strong>${money(p.price)}</strong>${p.compare_at > p.price ? `<div class="muted small strike">${money(p.compare_at)}</div>` : ''}</td>
      <td><span class="pill pill-${p.status === 'live' ? 'ok' : 'muted'}">${esc(p.status === 'live' ? 'Live' : p.status === 'draft' ? 'Draft' : 'Archived')}</span></td>
      <td class="num">${num(p.views)}</td><td class="num">${num(p.units)}</td><td class="num">${num(p.likes)}</td></tr>`).join('')}
    </tbody></table></div>${rows.length > limit ? `<div class="more"><button class="btn" id="pr-more">Show more (${num(rows.length - limit)} left)</button></div>` : ''}`
    : '<div class="empty"><p>No products match these filters.</p></div>';
  list.querySelector('#pr-more')?.addEventListener('click', () => { limit += 60; renderList(); });
  list.querySelector('#pr-all')?.addEventListener('change', (e) => { shown.forEach((p) => e.target.checked ? selected.add(p.slug) : selected.delete(p.slug)); renderList(); });
  list.querySelectorAll('[data-sel]').forEach((c) => c.addEventListener('change', () => {
    c.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel);
    c.closest('tr').classList.toggle('sel', c.checked);
    renderBulk();
  }));
  list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditor(b.dataset.edit)));
  renderBulk();
  gear3d().then(() => hydrateThumbs(list, designs, 120));
}

const BULK = [['feature', 'Feature'], ['unfeature', 'Unfeature'], ['flash', 'Flash sale'], ['endflash', 'End flash sale'], ['price', 'Change price'],
  ['live', 'Make live'], ['draft', 'Hide'], ['archive', 'Archive'], ['delete', 'Delete']];

function renderBulk() {
  const bar = root.querySelector('#pr-bulk');
  bar.hidden = !selected.size;
  if (!selected.size) return;
  bar.innerHTML = `<strong>${selected.size} selected</strong><div class="bulk-actions">${BULK.map(([k, l]) => `<button class="btn btn-sm${k === 'delete' ? ' btn-danger-ghost' : ''}" data-bulk="${k}">${l}</button>`).join('')}
    <button class="btn btn-sm btn-ghost" data-bulk="clear">Clear selection</button></div>`;
  bar.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', () => bulk(b.dataset.bulk, b)));
}

async function bulk(action, btn) {
  if (action === 'clear') { selected.clear(); renderList(); return; }
  const n = selected.size;
  const body = { action, slugs: [...selected] };
  if (action === 'flash') {
    const v = await promptBox(`Flash sale on ${n} products`, [{ name: 'percent', label: 'Discount (percent off)', value: 20, min: 1, max: 90 }, { name: 'hours', label: 'Runs for (hours)', value: 48, min: 1, max: 720 }], 'Start flash sale');
    if (!v) return; Object.assign(body, { percent: +v.percent, hours: +v.hours });
  } else if (action === 'price') {
    const v = await promptBox(`Change price of ${n} products`, [{ name: 'percent', label: 'Change by percent (use a minus sign to lower, for example -10)', value: 10, min: -90, max: 300 }], 'Change prices');
    if (!v) return; body.percent = +v.percent;
  } else if (action === 'delete') {
    if (!await confirmBox(`Delete ${n} products for good? This cannot be undone. Archiving hides them instead.`, { ok: 'Delete', danger: true })) return;
  }
  await busy(btn, async () => {
    await post('/api/admin/products-bulk', body);
    toast(`Done: ${BULK.find((b) => b[0] === action)[1].toLowerCase()} on ${n} products`);
    if (action === 'delete') selected.clear();
    await reload();
  });
}

async function newProduct() {
  const shapes = data.shapes;
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="np-t"><h3 id="np-t">New product</h3>
    <label class="field"><span>Name</span><input name="name" required placeholder="For example Volt Home Jersey"></label>
    <div class="form-grid"><label class="field"><span>Type</span><select name="shape">${shapes.map((s) => `<option value="${s}">${esc(SHAPE_LABEL(s))}</option>`).join('')}</select></label>
    <label class="field"><span>Sport</span><select name="sport">${data.sports.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
    <label class="field"><span>Price ($)</span><input name="price" type="number" min="1" step="0.01" placeholder="Leave empty for a suggested price"></label>
    <label class="field"><span>Status</span><select name="status"><option value="draft">Draft (hidden until ready)</option><option value="live">Live now</option></select></label></div>
    <div class="row-end"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn btn-primary">Create and edit design</button></div></form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form');
  const close = () => { wrap.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  wrap.querySelector('[data-cancel]').onclick = close;
  form.onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (!body.price) delete body.price;
    busy(e.submitter, async () => {
      const p = await post('/api/admin/products', body);
      close(); toast('Product created'); await reload(); openEditor(p.slug);
    });
  };
  form.querySelector('input').focus();
}

// ---------------------------------------------------------------- editor
const PATCHES = ['none', 'captain', 'star', 'champion', 'flag'];
const FINISHES = ['matte', 'gloss', 'metallic', 'holo'];
const LIGHTS = ['studio', 'stadium', 'sunset', 'neon'];
const FONT_CSS = { block: 'SF Block', tall: 'SF Tall', varsity: 'SF Varsity', stencil: 'SF Stencil', future: 'SF Future', racing: 'SF Racing', script: 'SF Script', modern: 'SF Modern' };
const cap = (s) => String(s).replace(/^\w/, (c) => c.toUpperCase());

function openEditor(slug) {
  const p0 = data.products.find((x) => x.slug === slug);
  if (!p0) { toast('That product was not found.', 'err'); return; }
  const p = JSON.parse(JSON.stringify(p0));
  const d = p.design = { primary: '#04282e', secondary: '#c8f53c', accent: '#ffffff', pattern: 'solid', font: 'block', finish: 'matte', outline: false, patch: 'none', lighting: 'studio', ...p.design, shape: p.shape };
  const isJersey = /^jersey|hoodie/.test(p.shape);
  const colorField = (k, label) => `<label class="color-field"><input type="color" data-d="${k}" value="${esc(d[k] || d.primary)}"><span>${label}</span></label>`;
  const sel = (k, label, opts, fmt = cap) => `<label class="field"><span>${label}</span><select data-d="${k}">${opts.map((o) => `<option value="${o}"${String(d[k]) === o ? ' selected' : ''}>${esc(fmt(o))}</option>`).join('')}</select></label>`;
  const txt = (k, label, max, ph = '') => `<label class="field"><span>${label}</span><input data-d="${k}" maxlength="${max}" value="${esc(d[k] || '')}" placeholder="${esc(ph)}"></label>`;

  const dr = openDrawer(`<form class="drawer-body" id="pe-form" novalidate>
    <div class="drawer-title"><div><h2>${esc(p.name)}</h2><p class="muted small">${esc(SHAPE_LABEL(p.shape))}, added ${date(p.created)}. ${num(p.views)} views, ${num(p.units)} sold in total, ${num(p.likes)} likes.</p></div>
      <a class="btn btn-sm" href="/design.html?p=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">View in store</a></div>
    <div class="editor">
      <div class="editor-preview"><div class="preview3d" id="pe-preview" aria-label="Live 3D preview of the design" role="img"></div>
        <p class="muted small center">Drag to turn it around.</p></div>
      <div class="editor-fields">
        <section class="od-sec"><h3>Design</h3>
          <div class="colors">${colorField('primary', 'Main')}${colorField('secondary', 'Trim')}${colorField('accent', 'Details')}${isJersey ? colorField('sleeve', 'Sleeves') : ''}</div>
          <div class="form-grid">
            ${sel('pattern', 'Pattern', data.patterns)}
            ${isJersey ? sel('collar', 'Collar', ['crew', 'v', 'polo'], (o) => ({ crew: 'Crew neck', v: 'V neck', polo: 'Polo' })[o]) : ''}
            ${sel('font', 'Lettering font', data.fonts)}
            ${sel('finish', 'Print finish', FINISHES)}
            ${sel('patch', 'Badge', PATCHES, (o) => o === 'none' ? 'No badge' : cap(o))}
            ${sel('lighting', 'Preview lighting', LIGHTS)}
            ${isJersey ? txt('chest', 'Chest text', 16, 'VOLT') + txt('name', 'Back name', 14, 'REYES') + txt('number', 'Number', 2, '10') : txt('text', 'Main text', 16, 'SQUAD') + txt('subtext', 'Small text', 20, 'MATCH PRO') + (/shorts|socks/.test(p.shape) ? txt('number', 'Number', 2, '7') : '')}
            <label class="check"><input type="checkbox" data-d="outline" ${d.outline ? 'checked' : ''}><span>Outline letters in the details color</span></label>
          </div>
        </section>
        <section class="od-sec"><h3>Details</h3>
          <div class="form-grid">
            <label class="field span-2"><span>Name</span><input name="name" required value="${esc(p.name)}"></label>
            <label class="field span-2"><span>Description</span><textarea name="description" rows="3">${esc(p.description)}</textarea></label>
            <label class="field"><span>Sport</span><select name="sport">${data.sports.map((s) => opt(s, s, p.sport)).join('')}${data.sports.includes(p.sport) ? '' : opt(p.sport, p.sport, p.sport)}</select></label>
            <label class="field"><span>Category</span><select name="category">${data.categories.map((s) => opt(s, s, p.category)).join('')}</select></label>
            <label class="field span-2"><span>League collection</span><select name="league">${opt('', 'No league', p.league)}${leagues.map((l) => opt(l.key, l.name, p.league)).join('')}</select></label>
            <label class="field"><span>Price ($)</span><input name="price" type="number" step="0.01" min="0" value="${p.price}"></label>
            <label class="field"><span>Compare at ($)</span><input name="compare_at" type="number" step="0.01" min="0" value="${p.compare_at || ''}" placeholder="Shown crossed out"></label>
            <label class="field"><span>Your cost ($)</span><input name="cost" type="number" step="0.01" min="0" value="${p.cost || ''}"></label>
            <div class="field"><span>Profit per sale</span><output id="pe-margin" class="margin"></output></div>
            <label class="field"><span>Made in (days)</span><input name="lead_days" type="number" min="1" max="120" value="${p.lead_days}"></label>
            <label class="field"><span>Sort boost</span><input name="sort" type="number" value="${p.sort || 0}" aria-describedby="pe-sort-h"><small id="pe-sort-h" class="muted">Higher shows first in the store.</small></label>
            <label class="field"><span>Status</span><select name="status">${Object.entries(STATUS).map(([k, v]) => opt(k, v, p.status)).join('')}</select></label>
            <label class="check"><input type="checkbox" name="featured" ${p.featured ? 'checked' : ''}><span>Feature on the home page</span></label>
          </div>
        </section>
        <section class="od-sec"><h3>Photos</h3><p class="muted small">Optional real photos shown next to the 3D view. PNG, JPG, WEBP or GIF up to 6 MB, max 8.</p>
          <div class="images" id="pe-images"></div>
          <label class="btn btn-sm file-btn">Upload photo<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="pe-file" class="sr-only"></label>
        </section>
      </div>
    </div>
    <div class="drawer-actions">
      <button class="btn btn-primary" type="submit">Save product</button>
      <button class="btn" type="button" id="pe-dup">Duplicate</button>
      <button class="btn" type="button" id="pe-cw">New colorways</button>
      <button class="btn btn-danger-ghost" type="button" id="pe-del">Delete</button>
    </div></form>`, { wide: true, onClose: () => { if (location.hash.startsWith('#/products/')) history.replaceState(null, '', '#/products'); } });
  history.replaceState(null, '', '#/products/' + p.slug);

  const form = dr.querySelector('#pe-form');
  const prev = dr.querySelector('#pe-preview');
  let handle = null, disposed = false;

  function fallbackPreview() {
    const tc = d.textColor || d.accent;
    const label = isJersey ? (d.number || d.chest || '') : (d.text || '');
    prev.innerHTML = `<div class="fallback-preview" style="background:linear-gradient(160deg, ${esc(d.primary)} 0 58%, ${esc(d.secondary)} 58% 78%, ${esc(d.sleeve || d.accent)} 78%)">
      <span style="font-family:'${FONT_CSS[d.font] || 'SF Block'}';color:${esc(tc)};${d.outline ? `-webkit-text-stroke:2px ${esc(d.secondary)}` : ''}">${esc(label)}</span>
      ${isJersey && d.name ? `<small style="font-family:'${FONT_CSS[d.font] || 'SF Block'}';color:${esc(tc)}">${esc(d.name)}</small>` : ''}</div>`;
  }
  fallbackPreview();
  gear3d().then(async (m) => {
    if (!m || typeof m.mount !== 'function' || disposed) return;
    try {
      const h = await m.mount(prev, d, { interactive: true });
      if (disposed) { dispose(h); return; }
      handle = h;
      prev.querySelector('.fallback-preview')?.remove();
    } catch (e) { console.warn('3D preview unavailable', e); }
  });
  const dispose = (h) => { try { (h?.destroy || h?.dispose || h?.unmount)?.call(h); } catch (e) { /* ignore */ } };
  onDrawerCleanup(() => { disposed = true; dispose(handle); });

  const updatePreview = () => {
    if (handle && typeof handle.update === 'function') { try { handle.update({ ...d }); return; } catch (e) { console.warn(e); } }
    if (!handle) fallbackPreview();
  };
  dr.querySelectorAll('[data-d]').forEach((inp) => {
    const ev = inp.type === 'color' || inp.tagName === 'INPUT' && inp.type !== 'checkbox' ? 'input' : 'change';
    inp.addEventListener(ev, () => {
      const k = inp.dataset.d;
      d[k] = inp.type === 'checkbox' ? inp.checked : (k === 'name' || k === 'chest' || k === 'text' || k === 'subtext' ? inp.value.toUpperCase() : inp.value);
      if (k === 'number') d[k] = inp.value.replace(/\D/g, '').slice(0, 2);
      updatePreview();
    });
  });

  const margin = dr.querySelector('#pe-margin');
  const calcMargin = () => {
    const price = +form.elements.price.value || 0, cost = +form.elements.cost.value || 0;
    const pr = price - cost;
    margin.textContent = price ? `${money(pr)} (${Math.round((pr / price) * 100)}% margin)` : 'Set a price';
    margin.className = 'margin ' + (pr <= 0 ? 'bad' : pr / price < 0.3 ? 'meh' : 'good');
  };
  form.elements.price.addEventListener('input', calcMargin); form.elements.cost.addEventListener('input', calcMargin); calcMargin();

  const imgBox = dr.querySelector('#pe-images');
  const renderImages = () => {
    imgBox.innerHTML = p.images.length ? p.images.map((u, i) => `<figure class="img-tile"><img src="${esc(u)}" alt="Product photo ${i + 1}"><button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove photo ${i + 1}">&times;</button></figure>`).join('') : '<p class="muted small">No photos yet.</p>';
    imgBox.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { p.images.splice(+b.dataset.rm, 1); renderImages(); }));
  };
  renderImages();
  dr.querySelector('#pe-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (p.images.length >= 8) { toast('You can add up to 8 photos.', 'err'); return; }
    const fd = new FormData(); fd.append('file', file);
    try { const r = await api('/api/admin/upload', { body: fd }); p.images.push(r.url); renderImages(); toast('Photo uploaded. Save to keep it.'); } catch (ex) { fail(ex); }
    e.target.value = '';
  });

  const collect = () => {
    const fd = Object.fromEntries(new FormData(form));
    return { name: fd.name, description: fd.description, sport: fd.sport, category: fd.category, league: fd.league,
      price: +fd.price || 0, compare_at: +fd.compare_at || 0, cost: +fd.cost || 0, lead_days: +fd.lead_days || 12, sort: +fd.sort || 0,
      status: fd.status, featured: form.elements.featured.checked ? 1 : 0, design: { ...d }, images: p.images };
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = collect();
    if (!body.name.trim()) { toast('Give the product a name.', 'err'); form.elements.name.focus(); return; }
    if (body.price <= 0) { toast('Set a price above zero.', 'err'); form.elements.price.focus(); return; }
    busy(e.submitter, async () => {
      const saved = await post('/api/admin/products/' + encodeURIComponent(p.slug), body);
      Object.assign(p0, saved);
      toast('Product saved');
      dr.querySelector('.drawer-title h2').textContent = saved.name;
      renderList();
    });
  });
  dr.querySelector('#pe-dup').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const b = collect();
    const copy = await post('/api/admin/products', { ...b, name: b.name + ' copy', shape: p.shape, status: 'draft' });
    toast('Copy created as a draft');
    await reload(); openEditor(copy.slug);
  }));
  dr.querySelector('#pe-cw').addEventListener('click', async (e) => {
    const v = await promptBox('Create new colorways', [{ name: 'count', label: 'How many new color versions?', value: 3, min: 1, max: 12, step: 1 }], 'Create');
    if (!v) return;
    busy(e.currentTarget, async () => {
      const r = await post(`/api/admin/products/${encodeURIComponent(p.slug)}/colorways`, { count: +v.count });
      toast(`${r.created.length} new colorways are live`);
      await reload();
    });
  });
  dr.querySelector('#pe-del').addEventListener('click', async (e) => {
    if (!await confirmBox(`Delete "${p.name}" for good? To just hide it, set the status to Archived instead.`, { ok: 'Delete', danger: true })) return;
    busy(e.currentTarget, async () => {
      await post('/api/admin/products-bulk', { action: 'delete', slugs: [p.slug] });
      selected.delete(p.slug);
      toast('Product deleted');
      dr.querySelector('.drawer-x').click();
      await reload();
    });
  });
}
