// SquadForge admin shell: sign in, navigation and screen routing.
import { api, post, toast, fail, setUnauthorizedHandler, closeDrawer, gear3d, esc } from './ui.js?v=6';

const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z"/>',
  orders: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
  products: '<path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
  leagues: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  discounts: '<path d="M20 12 12 20l-9-9V3h8zM7.5 7.5h.01"/>',
  payments: '<path d="M2 6h20v12H2zM2 10h20M6 15h4"/>',
  settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.8-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14.1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.8h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  analytics: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  income: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  ads: '<path d="M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6"/>',
  autopilot: '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>',
  designlab: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10"/>',
  scouts: '<path d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM21 21l-5.2-5.2M8 10.5h5M10.5 8v5"/>',
};

const SCREENS = [
  ['dashboard', 'Dashboard', () => import('./dashboard.js?v=6')],
  ['orders', 'Orders', () => import('./orders.js?v=6')],
  ['products', 'Products', () => import('./products.js?v=6')],
  ['leagues', 'Leagues', () => import('./leagues.js?v=6')],
  ['discounts', 'Discount codes', () => import('./discounts.js?v=6')],
  ['payments', 'Payments', () => import('./payments.js?v=6')],
  ['settings', 'Store settings', () => import('./settings.js?v=6')],
  ['analytics', 'Analytics', () => import('./analytics.js?v=6')],
  ['ads', 'Ad studio', () => import('./ads.js?v=6')],
  ['income', 'Ads and extra income', () => import('./income.js?v=6')],
  ['autopilot', 'Autopilot', () => import('./autopilot.js?v=6')],
  ['designlab', 'Design lab', () => import('./designlab.js?v=6')],
  ['scouts', 'Vendor scouts', () => import('./scouts.js?v=6')],
];
const MOBILE_MAIN = new Set(['dashboard', 'orders', 'products', 'payments']);

const shell = document.getElementById('shell');
const auth = document.getElementById('auth');
const main = document.getElementById('main');
let current = null; // {name, mod}
let authMode = 'login';

function buildNav() {
  document.getElementById('nav').innerHTML = SCREENS.map(([key, label]) =>
    `<li class="${MOBILE_MAIN.has(key) ? '' : 'nav-extra'}"><a href="#/${key}" data-nav="${key}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[key]}</svg><span>${esc(label)}</span></a></li>`).join('') +
    `<li class="nav-more"><button type="button" id="nav-more" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>More</span></button></li>`;
  document.getElementById('nav-more').addEventListener('click', (e) => {
    const open = shell.classList.toggle('more-open');
    e.currentTarget.setAttribute('aria-expanded', open);
  });
}

function showAuth(mode) {
  authMode = mode;
  if (current && current.mod.unmount) { try { current.mod.unmount(); } catch (e) { /* ignore */ } }
  current = null;
  closeDrawer();
  shell.hidden = true;
  auth.hidden = false;
  const setup = mode === 'setup';
  document.getElementById('auth-title').textContent = setup ? 'Create your owner password' : 'Sign in';
  document.getElementById('auth-sub').textContent = setup
    ? 'Welcome to your new store. Pick a password only you know. You will use it to sign in here.'
    : 'Enter your owner password to manage your store.';
  document.getElementById('auth-pw2-wrap').hidden = !setup;
  document.getElementById('auth-pw').autocomplete = setup ? 'new-password' : 'current-password';
  document.getElementById('auth-btn').textContent = setup ? 'Create password and continue' : 'Sign in';
  document.getElementById('auth-err').textContent = '';
  document.getElementById('auth-pw').value = '';
  document.getElementById('auth-pw2').value = '';
  setTimeout(() => document.getElementById('auth-pw').focus(), 0);
}

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('auth-pw').value;
  const err = document.getElementById('auth-err');
  const btn = document.getElementById('auth-btn');
  err.textContent = '';
  if (pw.length < 8) { err.textContent = 'The password needs at least 8 characters.'; return; }
  if (authMode === 'setup' && pw !== document.getElementById('auth-pw2').value) { err.textContent = 'The two passwords do not match.'; return; }
  btn.disabled = true;
  try {
    await api(authMode === 'setup' ? '/api/admin/setup' : '/api/admin/login', { body: { password: pw }, allow401: true });
    if (authMode === 'setup') toast('Password saved. Welcome to your store!');
    startApp();
  } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
});

document.getElementById('signout').addEventListener('click', async () => {
  try { await post('/api/admin/logout'); } catch (e) { /* ignore */ }
  location.hash = '';
  showAuth('login');
});

setUnauthorizedHandler(() => { if (!auth.hidden) return; toast('Please sign in again.', 'err'); showAuth('login'); });

async function route() {
  if (shell.hidden) return;
  const name = (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]) || 'dashboard';
  const entry = SCREENS.find((s) => s[0] === name) || SCREENS[0];
  shell.classList.remove('more-open');
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === entry[0]) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const extraActive = !MOBILE_MAIN.has(entry[0]);
  document.getElementById('nav-more').classList.toggle('active', extraActive);
  if (current && current.mod.unmount) { try { current.mod.unmount(); } catch (e) { /* ignore */ } }
  closeDrawer();
  document.title = `${entry[1]} | SquadForge admin`;
  main.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const mod = await entry[2]();
    current = { name: entry[0], mod };
    main.innerHTML = '';
    await mod.mount(main, { param: location.hash.split('/')[2] || '' });
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    fail(e);
    if (!shell.hidden) main.innerHTML = `<div class="empty"><p>This page could not load.</p><button class="btn" onclick="location.reload()">Reload</button></div>`;
  }
}
window.addEventListener('hashchange', route);

function startApp() {
  auth.hidden = true;
  shell.hidden = false;
  route();
}

async function boot() {
  buildNav();
  gear3d(); // start loading the 3D renderer in the background
  try {
    const st = await api('/api/admin/state', { allow401: true });
    if (st.setup_needed) showAuth('setup');
    else if (!st.authed) showAuth('login');
    else startApp();
  } catch (e) {
    showAuth('login');
    fail(e);
  }
}
boot();
