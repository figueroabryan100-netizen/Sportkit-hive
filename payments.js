import { api, post, toast, esc, busy } from './ui.js?v=6';

// Simple original text chips (not brand artwork).
const CHIP = {
  visa: ['VISA', '#1a1f71', '#fff'], mastercard: ['MC', '#252525', '#ffb000'], amex: ['AMEX', '#2e77bc', '#fff'], discover: ['DISC', '#fff', '#e5641b'],
  applepay: ['Apple Pay', '#000', '#fff'], googlepay: ['G Pay', '#fff', '#3c4043'], klarna: ['Klarna', '#ffb3c7', '#0b0b0b'], afterpay: ['Afterpay', '#b2fce4', '#0b0b0b'],
  paypal: ['PayPal', '#003087', '#fff'], venmo: ['Venmo', '#3d95ce', '#fff'], cashapp: ['Cash App', '#00d632', '#fff'], zelle: ['Zelle', '#6d1ed4', '#fff'],
  btc: ['BTC', '#f7931a', '#fff'], eth: ['ETH', '#627eea', '#fff'], usdt: ['USDT', '#26a17b', '#fff'], usdc: ['USDC', '#2775ca', '#fff'], sol: ['SOL', '#14f195', '#04282e'],
  bank: ['Bank', '#334155', '#fff'], cash: ['Cash', '#166534', '#fff'],
};
export const chip = (k) => { const [t, bg, fg] = CHIP[k] || [k, '#e5e7eb', '#111']; return `<span class="pay-chip" style="background:${bg};color:${fg}">${esc(t)}</span>`; };

let root, settings, methods;
const GROUPS = [['link', 'Cards and pay later', 'Customers tap a button and pay on a secure page from Stripe, Square or similar.'],
  ['handle', 'Payment apps', 'Customers send money to your account in the app. You confirm when it arrives.'],
  ['crypto', 'Crypto', 'Customers send to your wallet address. A QR code is shown at checkout.'],
  ['manual', 'Other', 'Plain instructions, like bank details or cash on pickup.']];

export async function mount(el) {
  root = el;
  const d = await api('/api/admin/settings');
  settings = d.settings; methods = d.payment_methods;
  settings.payments = settings.payments || {};
  el.innerHTML = `<header class="page-head"><div><h1>Payments</h1><p class="muted">Choose how customers can pay you. Money goes straight to your own accounts. Switch on at least one.</p></div></header>
    <div id="pm-summary"></div>
    ${GROUPS.map(([kind, title, sub]) => `<section class="pm-group"><h2>${title}</h2><p class="muted small">${sub}</p><div class="pm-grid">
      ${methods.filter((m) => m.kind === kind).map(card).join('')}</div></section>`).join('')}`;
  el.querySelectorAll('.pm-card').forEach(wire);
  summary();
}
export function unmount() { root = null; }

function card(m) {
  const c = settings.payments[m.key] || {};
  const field = m.kind === 'link'
    ? `<label class="field"><span>Payment link</span><input name="link" type="url" inputmode="url" placeholder="https://buy.stripe.com/..." value="${esc(c.link || '')}"></label>`
    : m.kind === 'handle' || m.kind === 'crypto'
      ? `<label class="field"><span>${m.kind === 'crypto' ? 'Wallet address' : m.key === 'zelle' ? 'Email or phone' : 'Username'}</span><input name="handle" autocomplete="off" spellcheck="false" value="${esc(c.handle || '')}" placeholder="${m.kind === 'crypto' ? 'Paste your address' : m.key === 'cashapp' ? 'squadforge (no $)' : m.key === 'zelle' ? 'you@example.com' : 'squadforge'}"></label>` : '';
  return `<form class="card pm-card${c.enabled ? ' on' : ''}" data-key="${m.key}" aria-labelledby="pm-${m.key}">
    <div class="pm-head"><div><h3 id="pm-${m.key}">${esc(m.label)}</h3><div class="chips">${m.icons.map(chip).join('')}</div></div>
      <label class="switch"><input type="checkbox" name="enabled" ${c.enabled ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span class="sr-only">Accept ${esc(m.label)}</span></label></div>
    <p class="muted small">${esc(m.help)}</p>
    <div class="pm-fields">${field}
      <label class="field"><span>Instructions for the customer</span><textarea name="instructions" rows="2" placeholder="${m.kind === 'manual' ? 'For example account name, number and routing' : 'Optional. For example: put your order number in the note.'}">${esc(c.instructions || '')}</textarea></label></div>
    <div class="row-between"><span class="pm-state small"></span><button class="btn btn-sm btn-primary" type="submit">Save</button></div></form>`;
}

function stateOf(m, c) {
  if (!c.enabled) return ['muted', 'Off'];
  if (m.kind === 'link' && !c.link) return ['warn', 'Add your payment link to show it at checkout'];
  if ((m.kind === 'handle' || m.kind === 'crypto') && !c.handle) return ['warn', `Add your ${m.kind === 'crypto' ? 'wallet address' : 'username'} to show it at checkout`];
  return ['ok', 'Showing at checkout'];
}

function wire(form) {
  const m = methods.find((x) => x.key === form.dataset.key);
  const read = () => {
    const fd = new FormData(form);
    return { enabled: form.elements.enabled.checked, link: (fd.get('link') || '').trim(), handle: (fd.get('handle') || '').trim().replace(/^[@$]/, ''), instructions: (fd.get('instructions') || '').trim() };
  };
  const paint = () => {
    const c = read();
    const [tone, txt] = stateOf(m, c);
    const s = form.querySelector('.pm-state');
    s.className = 'pm-state small tone-' + tone; s.textContent = txt;
    form.classList.toggle('on', c.enabled);
  };
  const save = async (btn) => {
    const c = read();
    if (m.kind === 'link' && c.link && !/^https:\/\//i.test(c.link)) { toast('The payment link should start with https://', 'err'); return; }
    await busy(btn, async () => {
      const next = { ...settings.payments, [m.key]: c };
      await post('/api/admin/settings', { payments: next });
      settings.payments = next;
      toast(c.enabled ? `${m.label} saved` : `${m.label} switched off`);
      summary();
    });
  };
  form.addEventListener('input', paint);
  form.elements.enabled.addEventListener('change', () => save(null));
  form.addEventListener('submit', (e) => { e.preventDefault(); save(e.submitter); });
  paint();
}

function summary() {
  if (!root) return;
  const live = methods.filter((m) => stateOf(m, settings.payments[m.key] || {})[0] === 'ok');
  root.querySelector('#pm-summary').innerHTML = live.length
    ? `<div class="alert alert-ok"><span class="alert-dot" aria-hidden="true"></span><span><strong>${live.length} ${live.length === 1 ? 'way' : 'ways'} to pay showing at checkout</strong><span class="chips">${live.map((m) => chip(m.icons[0])).join('')}</span></span></div>`
    : '<div class="alert alert-alert"><span class="alert-dot" aria-hidden="true"></span><span><strong>No payment method is switched on yet</strong><span class="muted small">Customers cannot check out until you turn one on and fill in its details.</span></span></div>';
}
