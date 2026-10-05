import { api, post, toast, esc, num, openDrawer, closeDrawer, busy, confirmBox } from './ui.js?v=6';

let root, sports = ['Soccer', 'Basketball', 'Football', 'Baseball', 'Hockey', 'Volleyball', 'Training', 'Multi sport'];

export async function mount(el) {
  root = el;
  el.innerHTML = `<header class="page-head"><div><h1>Leagues</h1><p class="muted">League collections group your kits by style of competition. They are your own original collections.</p></div>
    <div class="head-actions"><button class="btn btn-primary" id="lg-new">Add league</button></div></header>
    <div id="lg-list" class="league-grid"></div>`;
  el.querySelector('#lg-new').addEventListener('click', () => edit(null));
  await load();
}
export function unmount() { root = null; }

let leagues = [];
async function load() {
  leagues = (await api('/api/admin/leagues')).leagues;
  if (!root) return;
  root.querySelector('#lg-list').innerHTML = leagues.length ? leagues.map((l) => `<article class="card league-card">
      <div class="league-colors" aria-hidden="true">${l.colors.map((c) => `<span style="background:${esc(c)}"></span>`).join('')}</div>
      <div class="league-body"><h2>${esc(l.name)}</h2><p class="muted small">${esc(l.sport)}${l.region ? ', ' + esc(l.region) : ''}. ${num(l.count)} live products</p>
      <p class="small">${esc(l.tagline)}</p></div>
      <div class="row-gap"><button class="btn btn-sm" data-edit="${esc(l.key)}">Edit</button><a class="btn btn-sm btn-ghost" href="#/products/league:${encodeURIComponent(l.key)}">See products</a></div></article>`).join('')
    : '<div class="empty"><p>No leagues yet.</p></div>';
  root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => edit(leagues.find((l) => l.key === b.dataset.edit))));
}

function edit(l) {
  const isNew = !l;
  l = l || { key: '', name: '', sport: 'Soccer', region: '', tagline: '', colors: ['#04282e', '#c8f53c', '#ffffff'] };
  const dr = openDrawer(`<form class="drawer-body" id="lg-form"><div class="drawer-title"><h2>${isNew ? 'New league' : 'Edit ' + esc(l.name)}</h2></div>
    <div class="form-grid">
      <label class="field span-2"><span>Name</span><input name="name" required value="${esc(l.name)}" placeholder="For example Harbor City League"></label>
      <label class="field"><span>Sport</span><select name="sport">${sports.map((s) => `<option${s === l.sport ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label class="field"><span>Region</span><input name="region" value="${esc(l.region)}" placeholder="For example Europe"></label>
      <label class="field span-2"><span>Tagline</span><textarea name="tagline" rows="2">${esc(l.tagline)}</textarea></label>
      <fieldset class="span-2 colors"><legend>Colors</legend>
        ${l.colors.map((c, i) => `<label class="color-field"><input type="color" name="c${i}" value="${esc(c)}"><span>${['Main', 'Second', 'Accent'][i]}</span></label>`).join('')}</fieldset>
    </div>
    <div class="drawer-actions"><button class="btn btn-primary" type="submit">${isNew ? 'Add league' : 'Save league'}</button>
      ${isNew ? '' : '<button class="btn btn-danger-ghost" type="button" id="lg-del">Delete league</button>'}</div></form>`);
  const form = dr.querySelector('#lg-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    if (!fd.name.trim()) { toast('Give the league a name.', 'err'); return; }
    const key = isNew ? fd.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : l.key;
    if (isNew && leagues.some((x) => x.key === key)) { toast('A league with that name already exists.', 'err'); return; }
    busy(e.submitter, async () => {
      await post('/api/admin/leagues/' + encodeURIComponent(key), { name: fd.name, sport: fd.sport, region: fd.region, tagline: fd.tagline, colors: [fd.c0, fd.c1, fd.c2] });
      toast(isNew ? 'League added' : 'League saved'); closeDrawer(); await load();
    });
  });
  dr.querySelector('#lg-del')?.addEventListener('click', async (e) => {
    if (!await confirmBox(`Delete ${l.name}? Its products stay in your store, they just will not belong to a league anymore.`, { ok: 'Delete league', danger: true })) return;
    busy(e.currentTarget, async () => {
      await post('/api/admin/leagues/' + encodeURIComponent(l.key), { delete: true });
      toast('League deleted'); closeDrawer(); await load();
    });
  });
}
