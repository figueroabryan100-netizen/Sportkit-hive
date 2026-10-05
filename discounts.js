import { api, post, toast, esc, money, num, date, openDrawer, closeDrawer, busy, confirmBox } from './ui.js?v=6';

let root, list = [];
const KIND = { percent: 'Percent off', fixed: 'Dollar amount off', ship: 'Free shipping' };

export async function mount(el) {
  root = el;
  el.innerHTML = `<header class="page-head"><div><h1>Discount codes</h1><p class="muted">Codes customers type at checkout. Great for team deals, influencers and social posts.</p></div>
    <div class="head-actions"><button class="btn btn-primary" id="dc-new">New code</button></div></header>
    <div id="dc-list" class="card card-flush"></div>`;
  el.querySelector('#dc-new').addEventListener('click', () => edit(null));
  await load();
}
export function unmount() { root = null; }

const describe = (d) => d.kind === 'percent' ? `${+d.value}% off` : d.kind === 'fixed' ? `${money(d.value)} off` : 'Free shipping';
function state(d) {
  if (!d.active) return ['muted', 'Paused'];
  if (d.expires && d.expires < Date.now() / 1000) return ['muted', 'Expired'];
  if (d.max_uses && d.uses >= d.max_uses) return ['muted', 'Used up'];
  return ['ok', 'Active'];
}

async function load() {
  list = (await api('/api/admin/discounts')).discounts;
  if (!root) return;
  root.querySelector('#dc-list').innerHTML = list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Discount</th><th>Minimum order</th><th>Used</th><th>Expires</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
    ${list.map((d) => { const [tone, label] = state(d); return `<tr><td><code class="code">${esc(d.code)}</code></td><td>${describe(d)}</td><td>${d.min_order ? money(d.min_order, 0) : 'None'}</td>
      <td>${num(d.uses)}${d.max_uses ? ` of ${num(d.max_uses)}` : ''}</td><td>${d.expires ? date(d.expires) : 'Never'}</td><td><span class="pill pill-${tone}">${label}</span></td>
      <td class="num"><button class="btn btn-sm" data-edit="${esc(d.code)}">Edit</button></td></tr>`; }).join('')}</tbody></table></div>`
    : '<div class="empty"><p>No codes yet. Create one to reward your first teams.</p></div>';
  root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => edit(list.find((d) => d.code === b.dataset.edit))));
}

function toDateInput(t) { if (!t) return ''; const d = new Date(t * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function edit(d) {
  const isNew = !d;
  d = d || { code: '', kind: 'percent', value: 10, min_order: 0, max_uses: 0, expires: 0, active: 1, uses: 0 };
  const dr = openDrawer(`<form class="drawer-body" id="dc-form"><div class="drawer-title"><h2>${isNew ? 'New discount code' : 'Edit ' + esc(d.code)}</h2></div>
    <div class="form-grid">
      <label class="field span-2"><span>Code</span><input name="code" required maxlength="24" value="${esc(d.code)}" ${isNew ? '' : 'readonly'} placeholder="For example TEAM15" pattern="[A-Za-z0-9_\\-]+" aria-describedby="dc-code-h" style="text-transform:uppercase"><small id="dc-code-h" class="muted">Letters, numbers, dash and underscore. Customers can type it in any case.</small></label>
      <label class="field"><span>Type</span><select name="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}"${k === d.kind ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field" id="dc-val-wrap"><span id="dc-val-label">Value</span><input name="value" type="number" min="0" step="0.01" value="${+d.value || ''}"></label>
      <label class="field"><span>Minimum order ($)</span><input name="min_order" type="number" min="0" step="1" value="${+d.min_order || ''}" placeholder="No minimum"></label>
      <label class="field"><span>Max uses</span><input name="max_uses" type="number" min="0" step="1" value="${+d.max_uses || ''}" placeholder="Unlimited"></label>
      <label class="field"><span>Expires on</span><input name="expires" type="date" value="${toDateInput(d.expires)}"></label>
      <label class="check"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}><span>Active (customers can use it)</span></label>
    </div>
    ${isNew ? '' : `<p class="muted small">Used ${num(d.uses)} times so far.</p>`}
    <div class="drawer-actions"><button class="btn btn-primary" type="submit">${isNew ? 'Create code' : 'Save code'}</button>
      ${isNew ? '' : '<button class="btn btn-danger-ghost" type="button" id="dc-del">Delete code</button>'}</div></form>`);
  const form = dr.querySelector('#dc-form');
  const kind = form.elements.kind;
  const sync = () => {
    const k = kind.value;
    dr.querySelector('#dc-val-wrap').hidden = k === 'ship';
    dr.querySelector('#dc-val-label').textContent = k === 'percent' ? 'Percent off' : 'Amount off ($)';
    form.elements.value.max = k === 'percent' ? 100 : '';
  };
  kind.addEventListener('change', sync); sync();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const code = fd.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(code)) { toast('Use only letters, numbers, dash or underscore in the code.', 'err'); return; }
    if (fd.kind !== 'ship' && !(+fd.value > 0)) { toast('Enter how much the code takes off.', 'err'); return; }
    if (fd.kind === 'percent' && +fd.value > 100) { toast('A percent discount can be at most 100.', 'err'); return; }
    if (isNew && list.some((x) => x.code === code)) { toast('That code already exists.', 'err'); return; }
    const expires = fd.expires ? new Date(fd.expires + 'T23:59:59').getTime() / 1000 : 0;
    busy(e.submitter, async () => {
      await post('/api/admin/discounts', { code, kind: fd.kind, value: fd.kind === 'ship' ? 0 : +fd.value, min_order: +fd.min_order || 0, max_uses: +fd.max_uses || 0, expires, active: !!fd.active });
      toast(isNew ? `Code ${code} created` : 'Code saved'); closeDrawer(); await load();
    });
  });
  dr.querySelector('#dc-del')?.addEventListener('click', async (e) => {
    if (!await confirmBox(`Delete the code ${d.code}? Customers will not be able to use it anymore.`, { ok: 'Delete code', danger: true })) return;
    busy(e.currentTarget, async () => { await post('/api/admin/discounts', { code: d.code, delete: true }); toast('Code deleted'); closeDrawer(); await load(); });
  });
}
