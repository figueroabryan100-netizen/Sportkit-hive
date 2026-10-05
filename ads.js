// Ad studio: animated product ads (3D spin, kinetic text, generated beat) exported as PNG or video.
import { api, toast, fail, esc, money, debounce, gear3d } from './ui.js?v=6';

let root = null, products = [], storeName = 'SquadForge', product = null;
let viewer = null, viewerFor = '', viewerBox = null, flat = null, gearM = null;
let raf = 0, playing = true, soundOn = false, showSafe = false, pausedT = 0, startedAt = 0, clockFn = () => performance.now() / 1000;
let exactClock = false;
let actx = null, master = null, comp = null, sched = null, exportJob = null, viewerToken = 0;

// ---------------------------------------------------------------- formats
const FORMATS = {
  reels: { label: 'Reels', file: 'reels', W: 1080, H: 1920, safe: { t: 250, b: 420, l: 70, r: 120 }, zones: ['Profile and audio', 'Caption, likes and comments'] },
  tiktok: { label: 'TikTok', file: 'tiktok', W: 1080, H: 1920, safe: { t: 170, b: 500, l: 70, r: 170 }, zones: ['Following and For You tabs', 'Caption and sound'], right: 'Like, comment and share buttons' },
  square: { label: 'Feed square', file: 'feed-square', W: 1080, H: 1080, safe: { t: 70, b: 70, l: 70, r: 70 } },
  portrait: { label: 'Feed portrait', file: 'feed-portrait', W: 1080, H: 1350, safe: { t: 80, b: 80, l: 70, r: 70 } },
  wide: { label: 'Widescreen', file: 'widescreen', W: 1920, H: 1080, safe: { t: 80, b: 80, l: 100, r: 100 } },
};
const BGS = { neon: 'Neon gradient', solar: 'Solar burst', aqua: 'Aqua wave', team: 'Team colors', studio: 'Clean studio' };
const STYLES = { slam: 'Slam', slide: 'Slide', glitch: 'Glitch', type: 'Typewriter' };
const C = { ink: '#04282e', magenta: '#ff5a47', solar: '#c8f53c', aqua: '#2ee6d6', blue: '#3fb8ff', violet: '#1f7ae0', white: '#ffffff' };

// ---------------------------------------------------------------- beats (16 steps per bar, original patterns)
const BEATS = {
  trap: { label: 'Hype trap', bpm: 140, kick: 'x.....x...x.....', snare: '........x.......', clap: '........x.......', hat: 'x.x.x.x.xxx.x.xr', open: '.......x........', bass: 'x.....x...x.....', stab: 'x...............', bass808: true, swing: 0 },
  house: { label: 'Four on the floor', bpm: 124, kick: 'x...x...x...x...', snare: '', clap: '....x.......x...', hat: '..x...x...x...x.', open: '..x...x...x...x.', bass: '..x...x...x...xx', stab: '...x..x....x..x.', bass808: false, swing: 0 },
  drill: { label: 'Drill', bpm: 142, kick: 'x.........x.....', snare: '........x.....x.', clap: '', hat: 'x..x..x.x..x.rx.', open: '', bass: 'x.....x...x...x.', stab: 'x.......x.......', bass808: true, slide: true, swing: 0 },
  lofi: { label: 'Lo-fi', bpm: 84, kick: 'x......x..x.....', snare: '....x.......x...', clap: '', hat: 'x.x.x.x.x.x.x.x.', open: '', bass: 'x.........x.....', stab: 'x...............', bass808: false, soft: true, swing: 0.16 },
};
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const hit = (s, i) => !!s && s[i % 16] !== '.' && s[i % 16] !== undefined;

// ---------------------------------------------------------------- small helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (u) => 1 - Math.pow(1 - clamp(u, 0, 1), 3);
const easeBack = (u) => { u = clamp(u, 0, 1); const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const slugify = (s) => String(s || 'ad').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ad';
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean); const lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines;
}
function hexA(hex, a) { const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#04282e'; return `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`; }

// ---------------------------------------------------------------- mount
export async function mount(el) {
  root = el; playing = true; pausedT = 0; showSafe = false;
  const [p, s] = await Promise.all([api('/api/admin/products'), api('/api/admin/settings').catch(() => ({ settings: {} }))]);
  if (!root) return;
  products = (p.products || []).filter((x) => x.status === 'live');
  storeName = (s && s.settings && s.settings.name) || 'SquadForge';
  product = products.find((x) => x.featured) || products[0] || null;
  const seg = (name, obj, cur) => `<div class="seg seg-wrap">${Object.entries(obj).map(([k, v]) => `<label class="seg-radio"><input type="radio" name="${name}" value="${k}" ${k === cur ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>`;
  el.innerHTML = `<header class="page-head"><div><h1>Ad studio</h1><p class="muted">Make animated video ads and images: a spinning 3D product, moving text and a fresh beat, sized for Reels, TikTok, feed posts and widescreen.</p></div></header>
  <div class="ad-layout">
    <form class="card ad-controls" id="ad-form" autocomplete="off">
      <details class="ad-group" open><summary>Product and words</summary>
        <label class="field"><span>Find a product</span><input type="search" id="ad-q" placeholder="Type to search"></label>
        <label class="field"><span>Product</span><select id="ad-prod" size="5"></select></label>
        <label class="field"><span>Headline</span><input name="headline" maxlength="40" value="Game day ready"></label>
        <label class="field"><span>Second line</span><input name="sub" maxlength="70" value="Custom names and numbers. Made for your squad."></label>
        <div class="form-grid"><label class="field"><span>Promo code (optional)</span><input name="code" maxlength="20" placeholder="TEAM15" class="upper"></label>
        <label class="field"><span>Button text</span><input name="cta" maxlength="22" value="Shop now"></label></div>
        <label class="check"><input type="checkbox" name="price" checked><span>Show the price</span></label>
      </details>
      <details class="ad-group" open><summary>Look</summary>
        <fieldset class="field"><legend>Background</legend>${seg('bg', BGS, 'neon')}</fieldset>
        <fieldset class="field"><legend>Text animation</legend>${seg('style', STYLES, 'slam')}</fieldset>
        <fieldset class="field"><legend>Size</legend><div class="seg seg-wrap">${Object.entries(FORMATS).map(([k, f]) => `<label class="seg-radio"><input type="radio" name="fmt" value="${k}" ${k === 'reels' ? 'checked' : ''}><span>${f.label} <small>${f.W}x${f.H}</small></span></label>`).join('')}</div></fieldset>
        <fieldset class="field"><legend>Length</legend>${seg('dur', { 6: '6 seconds', 10: '10 seconds', 15: '15 seconds' }, '10')}</fieldset>
      </details>
      <details class="ad-group" open><summary>Music</summary>
        <fieldset class="field"><legend>Beat</legend>${seg('beat', Object.fromEntries(Object.entries(BEATS).map(([k, b]) => [k, b.label])), 'trap')}</fieldset>
        <label class="field"><span>Speed <output id="ad-bpm-out">140</output> beats per minute</span><input type="range" name="bpm" min="70" max="170" step="1" value="140"></label>
        <label class="field"><span>Volume</span><input type="range" name="vol" min="0" max="100" step="1" value="80"></label>
        <p class="muted small">The beat is made fresh in your browser for every ad, so there are no music rights to worry about.</p>
      </details>
    </form>
    <div class="ad-stage card">
      <div class="ad-toolbar">
        <button type="button" class="btn btn-sm" id="ad-play" aria-pressed="true">Pause</button>
        <button type="button" class="btn btn-sm" id="ad-sound" aria-pressed="false">Sound off</button>
        <label class="check ad-safe"><input type="checkbox" id="ad-safe"><span>Show safe zones</span></label>
        <span class="muted small" id="ad-time"></span>
      </div>
      <div class="ad-canvas-wrap"><canvas id="ad-canvas" width="360" height="640" aria-label="Animated ad preview" role="img"></canvas></div>
      <div class="ad-scrub"><span id="ad-prog"></span></div>
      <p class="muted small center" id="ad-status"></p>
      <div class="ad-actions">
        <button class="btn" type="button" id="ad-png">Download PNG</button>
        <button class="btn btn-primary" type="button" id="ad-vid">Download video</button>
        <button class="btn" type="button" id="ad-all">Download all sizes</button>
      </div>
      <div class="ad-export" id="ad-export" hidden>
        <div class="row-between"><strong id="ad-exp-label">Recording...</strong><button class="btn btn-sm btn-danger-ghost" type="button" id="ad-cancel">Cancel</button></div>
        <div class="ad-progress"><span id="ad-exp-bar"></span></div>
        <p class="muted small">Every frame is rendered one by one at a steady 30 fps (H.264 MP4), so the export can take a little longer than the ad itself. Keep this tab open.</p>
      </div>
      <p class="muted small" id="ad-mp4-note" hidden></p>
      <div class="ad-results" id="ad-results"></div>
    </div>
  </div>
  <div id="ad-hidden" class="offscreen ad-offscreen" aria-hidden="true"></div>`;

  const sel = el.querySelector('#ad-prod');
  const fill = (q) => {
    const list = products.filter((x) => !q || `${x.name} ${x.sport} ${x.category}`.toLowerCase().includes(q)).slice(0, 200);
    sel.innerHTML = list.length ? list.map((x) => `<option value="${esc(x.slug)}"${product && x.slug === product.slug ? ' selected' : ''}>${esc(x.name)} (${money(x.price)})</option>`).join('') : '<option disabled>No products match</option>';
  };
  fill('');
  el.querySelector('#ad-q').addEventListener('input', debounce((e) => fill(e.target.value.trim().toLowerCase()), 150));
  sel.addEventListener('change', () => { const np = products.find((x) => x.slug === sel.value); if (np) { product = np; layoutCache.clear(); prepareProduct(); } });
  const form = el.querySelector('#ad-form');
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => {
    const n = e.target.name;
    if (n === 'beat') { const b = BEATS[e.target.value]; form.elements.bpm.value = b.bpm; }
    el.querySelector('#ad-bpm-out').textContent = form.elements.bpm.value;
    if (n === 'vol' && master) master.gain.value = (+form.elements.vol.value / 100) * 0.9;
    if (n === 'fmt') sizePreview();
    if (['beat', 'bpm', 'dur'].includes(n) || n === undefined) rebaseClock();
    layoutCache.clear();
    if (!playing) drawPreview();
  });
  el.querySelector('#ad-play').addEventListener('click', togglePlay);
  el.querySelector('#ad-sound').addEventListener('click', toggleSound);
  el.querySelector('#ad-safe').addEventListener('change', (e) => { showSafe = e.target.checked; if (!playing) drawPreview(); });
  el.querySelector('#ad-png').addEventListener('click', (e) => withBtn(e.currentTarget, downloadPNG));
  el.querySelector('#ad-vid').addEventListener('click', (e) => withBtn(e.currentTarget, () => exportFormats([opts().fmt], true)));
  el.querySelector('#ad-all').addEventListener('click', (e) => withBtn(e.currentTarget, () => exportFormats(Object.keys(FORMATS), false)));
  el.querySelector('#ad-cancel').addEventListener('click', () => { if (exportJob) exportJob.cancelled = true; });
  el.querySelector('.ad-scrub').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = clamp((e.clientX - r.left) / r.width, 0, 0.999) * opts().dur;
    pausedT = t; startedAt = clockFn() - t; resetScheduler(); if (!playing) drawPreview();
  });
  if (canEncode()) {
    pickVideoConfig(1080, 1920).then((cfg) => {
      if (cfg || !root) return;
      const n = root.querySelector('#ad-mp4-note'); n.hidden = false;
      n.textContent = 'This browser cannot encode MP4 frame by frame, so videos are recorded live and may stutter. For smooth TikTok and Reels videos use the latest Chrome, Edge or Safari.';
    });
  } else if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    el.querySelector('#ad-vid').disabled = true; el.querySelector('#ad-all').disabled = true;
    const n = el.querySelector('#ad-mp4-note'); n.hidden = false; n.textContent = 'This browser cannot record video. Try the latest Chrome, Edge or Safari. PNG images still work.';
  } else {
    const n = el.querySelector('#ad-mp4-note'); n.hidden = false;
    n.textContent = 'This browser records videos live, which can stutter and may save WebM. For smooth TikTok and Reels videos use the latest Chrome, Edge or Safari, which render every frame as MP4.';
  }
  await Promise.all(['72px "SF Block"', '800 32px Inter', '600 32px Inter'].map((f) => document.fonts.load(f).catch(() => {})));
  if (!root) return;
  sizePreview();
  startedAt = clockFn();
  loop();
  prepareProduct();
}

export function unmount() {
  root = null;
  cancelAnimationFrame(raf); raf = 0;
  if (exportJob) exportJob.cancelled = true;
  stopScheduler();
  disposeViewer();
  if (actx) actx.close().catch(() => {});
  actx = null; master = null; comp = null; soundOn = false;
  clockFn = () => performance.now() / 1000;
  layoutCache.clear();
}

async function withBtn(btn, fn) {
  if (exportJob) { toast('A video is still recording. Wait for it or press Cancel.', 'err'); return; }
  btn.disabled = true; btn.classList.add('is-busy');
  try { await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; btn.classList.remove('is-busy'); }
}

function opts() {
  const f = root.querySelector('#ad-form');
  const fd = new FormData(f);
  const beat = BEATS[fd.get('beat')] ? fd.get('beat') : 'trap';
  return {
    headline: (fd.get('headline') || '').trim(), sub: (fd.get('sub') || '').trim(), code: String(fd.get('code') || '').toUpperCase().replace(/\s+/g, '').trim(),
    cta: (fd.get('cta') || '').trim() || 'Shop now', price: !!fd.get('price'), bg: fd.get('bg') || 'neon', style: fd.get('style') || 'slam',
    fmt: FORMATS[fd.get('fmt')] ? fd.get('fmt') : 'reels', dur: +fd.get('dur') || 10, beat, bpm: clamp(+fd.get('bpm') || BEATS[beat].bpm, 60, 190), vol: clamp(+fd.get('vol') / 100, 0, 1),
  };
}

// ---------------------------------------------------------------- 3D product source
const dispose = (h) => { try { (h?.dispose || h?.destroy || h?.unmount)?.call(h); } catch (e) { /* ignore */ } };
function disposeViewer() { viewerToken++; if (viewer) dispose(viewer); viewer = null; viewerFor = ''; flat = null; if (viewerBox) viewerBox.innerHTML = ''; }

async function prepareProduct() {
  if (!root) return;
  const p = product;
  const status = root.querySelector('#ad-status');
  disposeViewer();
  const token = viewerToken;
  if (!p) { status.textContent = 'Add a live product to make an ad.'; return; }
  status.textContent = 'Loading the 3D model...';
  gearM = gearM || await gear3d();
  if (!root || token !== viewerToken) return;
  viewerBox = root.querySelector('#ad-hidden');
  viewerBox.innerHTML = '<div class="ad-viewer"></div>';
  const host = viewerBox.firstChild;
  host.style.width = host.style.height = '520px';
  const m = gearM;
  let h = null;
  if (m && typeof m.mount === 'function' && (!m.supported || m.supported())) {
    try { h = await m.mount(host, p.design || {}, { interactive: false, motion: true, autoRotate: true, preserveDrawingBuffer: true }); } catch (e) { console.warn('3D unavailable for ads', e); h = null; }
  }
  if (!root || token !== viewerToken) { dispose(h); return; }
  if (h) { viewer = h; viewerFor = p.slug; }
  else {
    // 2D fallback: a flat drawing that we squash to fake a spin
    flat = document.createElement('canvas'); flat.width = flat.height = 720;
    try { if (m && m.draw2D) m.draw2D(flat, p.design || {}); else throw new Error('no 2D'); } catch (e) { flatFallback(flat, p.design || {}); }
  }
  status.textContent = h ? '' : '3D is not available in this browser, so the ad uses a flat drawing.';
}
function flatFallback(c, d) {
  const x = c.getContext('2d'), s = c.width;
  rr(x, s * 0.15, s * 0.15, s * 0.7, s * 0.7, s * 0.1);
  const g = x.createLinearGradient(0, 0, s, s); g.addColorStop(0, d.primary || C.ink); g.addColorStop(0.6, d.primary || C.ink); g.addColorStop(0.6, d.secondary || C.solar); g.addColorStop(1, d.secondary || C.solar);
  x.fillStyle = g; x.fill();
  x.fillStyle = d.accent || '#fff'; x.font = `${s * 0.25}px "SF Block", Impact, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(d.number || 'SF', s / 2, s / 2);
}
function viewerCanvas() { return viewer && viewerBox ? viewerBox.querySelector('canvas') : null; }
function setViewerSize(px) {
  const host = viewerBox && viewerBox.firstChild;
  if (!host || !viewer) return;
  const dpr = window.devicePixelRatio || 1;
  const css = Math.round(px / Math.min(2, dpr));
  if (host.style.width !== css + 'px') { host.style.width = host.style.height = css + 'px'; try { viewer.resize && viewer.resize(); } catch (e) { /* ignore */ } }
}
// Turn the product to a yaw for time t and return something drawable.
function productFrame(t, o) {
  const yaw = -0.6 + t * (Math.PI * 2 / 6) + Math.sin(t * Math.PI * 2 / o.dur) * 0.2;
  if (viewer) {
    try {
      if (typeof viewer.setPose === 'function') viewer.setPose({ yaw, pitch: 0.06 });
      else if (typeof viewer.setAngle === 'function') viewer.setAngle(yaw);
      if (exactClock && typeof viewer.renderAt === 'function') viewer.renderAt(t);
      else if (typeof viewer.renderNow === 'function') viewer.renderNow();
    } catch (e) { /* keep last frame */ }
    const c = viewerCanvas();
    if (c && c.width > 2) return { img: c, squash: 1 };
  }
  if (flat) return { img: flat, squash: Math.cos(yaw + 0.6) };
  return null;
}

// ---------------------------------------------------------------- clock and preview loop
function curT(o) { const d = o.dur; return playing ? (((clockFn() - startedAt) % d) + d) % d : pausedT; }
function rebaseClock() { if (!root) return; const t = curT(opts()); startedAt = clockFn() - t; resetScheduler(); }

function sizePreview() {
  const o = opts(), F = FORMATS[o.fmt];
  const k = 640 / Math.max(F.W, F.H);
  const c = root.querySelector('#ad-canvas');
  c.width = Math.round(F.W * k); c.height = Math.round(F.H * k);
  c.dataset.fmt = o.fmt;
}

function loop() {
  raf = 0;
  if (!root) return;
  if (!exportJob) drawPreview();
  if (playing) raf = requestAnimationFrame(loop);
}
function drawPreview() {
  if (!root || exportJob) return;
  const o = opts(), F = FORMATS[o.fmt];
  const c = root.querySelector('#ad-canvas');
  if (c.dataset.fmt !== o.fmt) sizePreview();
  const t = curT(o);
  const ctx = c.getContext('2d');
  const k = c.width / F.W;
  setViewerSize(560);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawFrame(ctx, F, o, t);
  if (showSafe) drawSafe(ctx, F);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  root.querySelector('#ad-prog').style.width = (t / o.dur * 100).toFixed(2) + '%';
  root.querySelector('#ad-time').textContent = `${t.toFixed(1)} / ${o.dur} s`;
}

function togglePlay() {
  const o = opts();
  const b = root.querySelector('#ad-play');
  if (playing) { pausedT = curT(o); playing = false; stopScheduler(); cancelAnimationFrame(raf); raf = 0; drawPreview(); }
  else { playing = true; startedAt = clockFn() - pausedT; resetScheduler(); loop(); }
  b.textContent = playing ? 'Pause' : 'Play'; b.setAttribute('aria-pressed', playing);
}

function ensureAudio() {
  if (actx) return actx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  actx = new AC();
  comp = actx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.ratio.value = 4;
  master = actx.createGain(); master.gain.value = opts().vol * 0.9;
  master.connect(comp);
  return actx;
}
async function toggleSound() {
  const b = root.querySelector('#ad-sound');
  const a = ensureAudio();
  if (!a) { toast('Sound is not supported in this browser.', 'err'); return; }
  soundOn = !soundOn;
  if (soundOn) {
    await a.resume().catch(() => {});
    const t = curT(opts());
    clockFn = () => actx.currentTime; startedAt = clockFn() - t;
    comp.connect(a.destination);
    if (!playing) togglePlay();
  } else { try { comp.disconnect(); } catch (e) { /* ignore */ } }
  resetScheduler();
  b.textContent = soundOn ? 'Sound on' : 'Sound off'; b.setAttribute('aria-pressed', soundOn);
}

// Lookahead scheduler for the live preview, locked to the same clock as the visuals.
function stopScheduler() { if (sched) clearInterval(sched.timer); sched = null; }
function resetScheduler() {
  stopScheduler();
  if (!soundOn || !playing || !actx || !root) return;
  const o = opts();
  const stepDur = 60 / o.bpm / 4;
  const el = actx.currentTime - startedAt;
  let loopN = Math.floor(el / o.dur), step = Math.ceil((el - loopN * o.dur) / stepDur - 1e-6);
  if (step * stepDur >= o.dur) { loopN++; step = 0; }
  sched = { o, stepDur, loopN, step };
  const tick = () => {
    if (!actx || !sched) return;
    const s = sched;
    for (;;) {
      const at = startedAt + s.loopN * o.dur + s.step * stepDur + swingOf(o, s.step);
      if (at > actx.currentTime + 0.15) break;
      if (at >= actx.currentTime - 0.02) playStep(actx, master, o, s.step, at);
      s.step++;
      if (s.step * stepDur >= o.dur) { s.step = 0; s.loopN++; }
    }
  };
  tick();
  sched.timer = setInterval(tick, 30);
}
const swingOf = (o, step) => (step % 2 ? BEATS[o.beat].swing * 60 / o.bpm / 4 : 0);

// ---------------------------------------------------------------- synthesis
let noiseBuf = null;
function noise(a) {
  if (noiseBuf && noiseBuf.sampleRate === a.sampleRate) return noiseBuf;
  noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
function env(a, g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
function kick(a, out, t, long, soft) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(soft ? 120 : 160, t);
  o.frequency.exponentialRampToValueAtTime(long ? 38 : 48, t + (long ? 0.2 : 0.12));
  env(a, g, t, soft ? 0.7 : 1, 0.003, long ? 0.55 : 0.32);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.7);
}
function noiseHit(a, out, t, { type = 'highpass', freq = 7000, q = 0.7, peak = 0.3, decay = 0.05 }) {
  const s = a.createBufferSource(); s.buffer = noise(a);
  const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = a.createGain(); env(a, g, t, peak, 0.002, decay);
  s.connect(f); f.connect(g); g.connect(out);
  s.start(t, Math.random() * 0.5); s.stop(t + decay + 0.05);
}
function snare(a, out, t, soft) {
  noiseHit(a, out, t, { type: 'bandpass', freq: soft ? 2200 : 1800, q: 0.6, peak: soft ? 0.25 : 0.5, decay: soft ? 0.14 : 0.18 });
  const o = a.createOscillator(), g = a.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
  env(a, g, t, soft ? 0.15 : 0.3, 0.002, 0.09); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.15);
}
function clap(a, out, t) {
  [0, 0.011, 0.023].forEach((d, i) => noiseHit(a, out, t + d, { type: 'bandpass', freq: 1400, q: 1.2, peak: 0.45, decay: i === 2 ? 0.16 : 0.025 }));
}
function bassNote(a, out, t, midi, dur, o808, slideTo) {
  const o = a.createOscillator(), g = a.createGain();
  if (o808) {
    o.type = 'sine'; o.frequency.setValueAtTime(mtof(midi), t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(mtof(slideTo), t + dur * 0.8);
    const sh = a.createWaveShaper(); const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
    sh.curve = curve;
    env(a, g, t, 0.55, 0.005, dur); o.connect(sh); sh.connect(g);
  } else {
    o.type = 'sawtooth'; o.frequency.setValueAtTime(mtof(midi), t);
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(140, t + dur);
    env(a, g, t, 0.32, 0.005, dur); o.connect(f); f.connect(g);
  }
  g.connect(out); o.start(t); o.stop(t + dur + 0.1);
}
function stab(a, out, t, notes, dur, soft) {
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(soft ? 1400 : 3200, t); f.frequency.exponentialRampToValueAtTime(soft ? 600 : 500, t + dur);
  const g = a.createGain(); env(a, g, t, soft ? 0.12 : 0.1, soft ? 0.03 : 0.004, dur);
  f.connect(g); g.connect(out);
  notes.forEach((n, i) => [-6, 6].forEach((det) => {
    const o = a.createOscillator(); o.type = soft ? 'triangle' : 'sawtooth'; o.frequency.value = mtof(n + 12); o.detune.value = det + i;
    o.connect(f); o.start(t); o.stop(t + dur + 0.1);
  }));
}
function playStep(a, out, o, step, t) {
  const B = BEATS[o.beat], i = step % 16, bar = Math.floor(step / 16) % 4, sd = 60 / o.bpm / 4;
  const ch = CHORDS[bar];
  if (hit(B.kick, i)) kick(a, out, t, B.bass808, B.soft);
  if (hit(B.snare, i)) snare(a, out, t, B.soft);
  if (hit(B.clap, i)) clap(a, out, t);
  if (hit(B.hat, i)) {
    const pk = B.soft ? 0.07 : 0.11;
    noiseHit(a, out, t, { peak: pk * (i % 4 === 0 ? 1 : 0.7), decay: 0.035 });
    if (B.hat[i] === 'r') { noiseHit(a, out, t + sd / 3, { peak: pk * 0.6, decay: 0.03 }); noiseHit(a, out, t + 2 * sd / 3, { peak: pk * 0.7, decay: 0.03 }); }
  }
  if (hit(B.open, i)) noiseHit(a, out, t, { freq: 6000, peak: 0.08, decay: 0.2 });
  if (hit(B.bass, i)) {
    const root = ch[0] - 24;
    const slide = B.slide && i === 14 ? CHORDS[(bar + 1) % 4][0] - 24 : 0;
    bassNote(a, out, t, B.bass808 ? root : root + (i % 4 === 3 ? 12 : 0), B.bass808 ? sd * 5 : sd * 1.6, B.bass808, slide);
  }
  if (hit(B.stab, i)) stab(a, out, t, ch, B.soft ? sd * 14 : sd * (o.beat === 'house' ? 1.5 : 6), B.soft);
}

// Visual pulse locked to the beat pattern: time since the latest kick or snare.
function pulses(o, t) {
  const B = BEATS[o.beat], sd = 60 / o.bpm / 4, step = Math.floor(t / sd);
  let kp = 0, sp = 0;
  for (let s = step; s >= Math.max(0, step - 16); s--) {
    const dt = t - s * sd;
    if (!kp && hit(B.kick, s)) kp = Math.exp(-dt * 9);
    if (!sp && (hit(B.snare, s) || hit(B.clap, s))) sp = Math.exp(-dt * 10);
    if (kp && sp) break;
  }
  return { kick: kp, snare: sp, step, sd, beat: t / (sd * 4) };
}
function kickTimes(o, t, n) {
  const B = BEATS[o.beat], sd = 60 / o.bpm / 4, out = [];
  for (let s = Math.floor(t / sd); s >= 0 && out.length < n; s--) if (hit(B.kick, s)) out.push([s, s * sd]);
  return out;
}

// ---------------------------------------------------------------- drawing
function palette(o, d) {
  const dark = o.bg !== 'studio' && o.bg !== 'solar';
  const accent = { neon: C.solar, solar: C.magenta, aqua: C.solar, team: C.solar, studio: C.magenta }[o.bg];
  return { dark, ink: dark ? '#ffffff' : C.ink, soft: dark ? 'rgba(255,255,255,0.88)' : 'rgba(4,40,46,0.82)', accent, accentInk: accent === C.solar ? C.ink : '#04282e', team: [d.primary || C.ink, d.secondary || C.magenta] };
}

function drawBackground(ctx, W, H, o, t, P, pal) {
  const M = Math.max(W, H), m = Math.min(W, H);
  ctx.save();
  if (o.bg === 'neon') {
    ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
    const blobs = [[C.magenta, 0.2, 0.25, 0.7], [C.blue, 0.85, 0.3, 0.8], [C.violet, 0.5, 0.85, 0.9]];
    ctx.globalCompositeOperation = 'lighter';
    blobs.forEach(([col, x, y, r], i) => {
      const cx = W * (x + Math.sin(t * 0.5 + i * 2) * 0.12), cy = H * (y + Math.cos(t * 0.4 + i) * 0.08);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, M * r * (0.9 + P.kick * 0.08));
      g.addColorStop(0, hexA(col, 0.55)); g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    });
    ctx.globalCompositeOperation = 'source-over';
    // perspective floor grid
    const hy = H * 0.68; ctx.strokeStyle = hexA(C.aqua, 0.16 + P.kick * 0.2); ctx.lineWidth = Math.max(1.5, m / 500);
    for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * W * 0.02, hy); ctx.lineTo(W / 2 + i * W * 0.22, H); ctx.stroke(); }
    for (let j = 0; j < 9; j++) { const u = ((j + (t * 0.8) % 1) / 9); const y = hy + (H - hy) * u * u; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  } else if (o.bg === 'solar') {
    const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, M * 0.8);
    g.addColorStop(0, '#f6ffd6'); g.addColorStop(0.35, C.solar); g.addColorStop(1, '#2ee6d6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H * 0.45); ctx.rotate(t * 0.15);
    ctx.fillStyle = hexA(C.magenta, 0.1 + P.kick * 0.08);
    for (let i = 0; i < 18; i++) { ctx.rotate(Math.PI * 2 / 18); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(M * 1.2, -M * 0.09); ctx.lineTo(M * 1.2, M * 0.09); ctx.fill(); }
  } else if (o.bg === 'aqua') {
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, C.aqua); g.addColorStop(0.55, C.blue); g.addColorStop(1, C.violet);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let k = 0; k < 5; k++) {
      ctx.beginPath(); const base = H * (0.3 + k * 0.16), amp = m * (0.035 + k * 0.008);
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += W / 40) ctx.lineTo(x, base + Math.sin(x / W * Math.PI * 2.4 + t * (1 + k * 0.3) + k) * amp * (1 + P.kick * 0.4));
      ctx.lineTo(W, H); ctx.closePath();
      ctx.fillStyle = `rgba(255,255,255,${0.05 + k * 0.012})`; ctx.fill();
    }
  } else if (o.bg === 'team') {
    const [a, b] = pal.team;
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, a); g.addColorStop(1, b);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    const sw = m * 0.09, off = (t * m * 0.08) % (sw * 3);
    for (let x = -H - sw * 3 + off; x < W + H; x += sw * 3) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + sw, H); ctx.lineTo(x + sw + H, 0); ctx.lineTo(x + H, 0); ctx.fill(); }
  } else {
    ctx.fillStyle = '#f1faf7'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, M * 0.6);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#d9f1ea');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = hexA(C.violet, 0.08 + P.kick * 0.1); ctx.lineWidth = m * 0.004;
    for (let r = 1; r < 6; r++) { ctx.beginPath(); ctx.arc(W / 2, H * 0.45, m * 0.12 * r + (t * m * 0.03) % (m * 0.12), 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.restore();
}

const layoutCache = new Map();
function layoutFor(ctx, F, o) {
  const key = [F.file, o.headline, o.sub, o.code, o.price, o.cta, product && product.slug].join('|');
  if (layoutCache.has(key)) return layoutCache.get(key);
  const { W, H, safe } = F;
  const u = Math.min(W, H) / 1080;
  const wide = W / H > 1.3;
  const x0 = safe.l, x1 = W - safe.r, y0 = safe.t, y1 = H - safe.b;
  const textW = wide ? W * 0.5 - x0 : x1 - x0;
  let hs = (wide ? 170 : H / W > 1.5 ? 150 : 124) * u, lines = [];
  for (let i = 0; i < 12; i++) {
    ctx.font = `${hs}px "SF Block", Impact, sans-serif`;
    lines = wrap(ctx, (o.headline || storeName).toUpperCase(), textW);
    if (lines.length <= (wide ? 3 : 2) && lines.every((l) => ctx.measureText(l).width <= textW)) break;
    hs *= 0.9;
  }
  const ss = 40 * u;
  ctx.font = `600 ${ss}px Inter, sans-serif`;
  const sub = o.sub ? wrap(ctx, o.sub, textW).slice(0, wide ? 3 : 2) : [];
  const brand = { x: x0, y: y0 + 34 * u, size: 34 * u };
  const L = { u, wide, x0, x1, y0, y1, hs, lines, ss, sub, brand, textW };
  const chipH = o.code ? 80 * u : 0;
  if (wide) {
    const blockH = lines.length * hs * 0.98 + (sub.length ? 24 * u + sub.length * ss * 1.35 : 0) + (chipH ? chipH + 36 * u : 0);
    const top = Math.max(y0 + 110 * u, (H - blockH) / 2 + 40 * u);
    L.headY = top + hs * 0.8;
    L.subY = L.headY + (lines.length - 1) * hs * 0.98 + 30 * u + ss;
    L.chipY = L.subY + (sub.length ? (sub.length - 1) * ss * 1.35 : -ss) + 46 * u;
    L.prod = { cx: W * 0.74, cy: H * 0.53, size: Math.min(H * 0.86, W * 0.44) };
  } else {
    L.headY = brand.y + 70 * u + hs * 0.8;
    const headBottom = L.headBottom = L.headY + (lines.length - 1) * hs * 0.98 + hs * 0.3;
    const subH = sub.length ? sub.length * ss * 1.35 : 0;
    L.chipY = y1 - chipH;
    L.subY = (chipH ? L.chipY - 34 * u : y1) - subH + ss;
    const subTop = L.subY - ss - 20 * u;
    const avail = subTop - headBottom;
    const size = clamp(Math.min(avail * 1.12, (x1 - x0) * 1.02), 200 * u, W);
    L.prod = { cx: (x0 + x1) / 2, cy: headBottom + avail / 2, size };
  }
  const pr = L.prod;
  L.badge = { r: 96 * u, x: Math.min(pr.cx + pr.size * 0.36, x1 - 100 * u), y: Math.max(pr.cy - pr.size * 0.3, (wide ? y0 + 20 * u : L.headBottom + 20 * u) + 96 * u) };
  layoutCache.set(key, L);
  return L;
}

function drawProduct(ctx, L, t, o, P, alpha, scaleMul, cx, cy, size) {
  const fr = productFrame(t, o);
  const f = Math.sin(t * 2.1) * size * 0.022;
  const s = size * (1 + P.kick * 0.035) * scaleMul;
  ctx.save(); ctx.globalAlpha = alpha;
  // shadow
  const sy = cy + size * 0.44;
  const g = ctx.createRadialGradient(cx, sy, 0, cx, sy, s * 0.36);
  g.addColorStop(0, 'rgba(0,0,0,0.38)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save(); ctx.translate(cx, sy); ctx.scale(1, 0.22); ctx.translate(-cx, -sy);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, sy, s * 0.36 * (1 - f / size * 3), 0, Math.PI * 2); ctx.fill(); ctx.restore();
  if (fr) {
    ctx.translate(cx, cy + f);
    ctx.scale(fr.squash < 0 ? -Math.max(0.04, -fr.squash) : Math.max(0.04, fr.squash), 1);
    ctx.drawImage(softEdge(fr.img), -s / 2, -s / 2, s, s);
  }
  ctx.restore();
}

// Fade the square edges of the 3D render so its floor shadow never shows a hard line.
let maskC = null;
function softEdge(img) {
  const n = Math.min(1024, img.width || 512);
  if (!maskC || maskC.width !== n) { maskC = document.createElement('canvas'); maskC.width = maskC.height = n; }
  const m = maskC.getContext('2d');
  m.globalCompositeOperation = 'source-over';
  m.clearRect(0, 0, n, n);
  m.drawImage(img, 0, 0, n, n);
  m.globalCompositeOperation = 'destination-in';
  const g = m.createRadialGradient(n / 2, n / 2, n * 0.4, n / 2, n / 2, n * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  m.fillStyle = g; m.fillRect(0, 0, n, n);
  m.globalCompositeOperation = 'source-over';
  return maskC;
}

function lightSweep(ctx, W, H, t, period) {
  const ph = (t % period) / period;
  if (ph > 0.4) return;
  const x = -W * 0.5 + ph / 0.4 * W * 2;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const g = ctx.createLinearGradient(x - W * 0.25, 0, x + W * 0.25, H * 0.3);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function particles(ctx, L, o, t, pal) {
  const { cx, cy, size } = L.prod;
  const cols = [C.solar, C.magenta, C.aqua, C.blue, '#ffffff'];
  ctx.save();
  kickTimes(o, t, 4).forEach(([s, ht]) => {
    const age = t - ht;
    if (age > 1.2) return;
    for (let i = 0; i < 16; i++) {
      const a = hash(s * 31 + i) * Math.PI * 2, sp = (0.35 + hash(s * 7 + i * 3) * 0.6) * size;
      const d = size * 0.3 + sp * ease(age / 1.2);
      ctx.globalAlpha = (1 - age / 1.2) * 0.85;
      ctx.fillStyle = cols[(s + i) % cols.length];
      const r = L.u * (5 + hash(i + s) * 9);
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, r, 0, Math.PI * 2); ctx.fill();
    }
  });
  ctx.restore();
}

function headlineText(ctx, L, o, t, pal, tIn, fade) {
  if (t < tIn) return;
  const style = o.style, hs = L.hs, x = L.x0;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.font = `${hs}px "SF Block", Impact, sans-serif`;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  if (pal.dark) { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = hs * 0.15; }
  const lh = hs * 0.98;
  if (style === 'slam') {
    const words = []; L.lines.forEach((line, li) => { let wx = x; line.split(' ').forEach((w) => { const ww = ctx.measureText(w).width; words.push({ w, x: wx, y: L.headY + li * lh, ww }); wx += ww + ctx.measureText(' ').width; }); });
    const stagger = 60 / o.bpm / 2;
    words.forEach((wd, i) => {
      const st = tIn + i * stagger, u = (t - st) / 0.22;
      if (u < 0) return;
      const sc = u < 1 ? 1 + 2.4 * Math.pow(1 - ease(u), 2) : 1;
      ctx.save(); ctx.globalAlpha = fade * clamp(u * 2.5, 0, 1);
      ctx.translate(wd.x + wd.ww / 2, wd.y - hs * 0.35); ctx.scale(sc, sc);
      ctx.fillStyle = i % 3 === 2 ? pal.accent : pal.ink;
      ctx.fillText(wd.w, -wd.ww / 2, hs * 0.35);
      ctx.restore();
    });
  } else if (style === 'slide') {
    L.lines.forEach((line, li) => {
      const st = tIn + li * 0.18, u = (t - st) / 0.5;
      if (u < 0) return;
      const dir = li % 2 ? 1 : -1, off = (1 - ease(u)) * L.textW * 1.1 * dir;
      for (let g = 3; g >= 0; g--) {
        ctx.globalAlpha = fade * (g ? 0.12 * (u < 1 ? 1 : 0) : clamp(u * 2, 0, 1));
        ctx.fillStyle = g ? pal.accent : pal.ink;
        ctx.fillText(line, x + off * (1 + g * 0.18), L.headY + li * lh);
      }
    });
    ctx.globalAlpha = fade;
    const bu = ease((t - tIn - 0.4) / 0.4);
    ctx.fillStyle = pal.accent; ctx.fillRect(x, L.headY + (L.lines.length - 1) * lh + hs * 0.16, L.textW * 0.35 * bu, hs * 0.07);
  } else if (style === 'glitch') {
    const u = t - tIn, P = pulses(o, t);
    const amt = (u < 0.6 ? 1 - u / 0.6 : 0) + P.snare * 0.8;
    const fr = Math.floor(t * 24);
    L.lines.forEach((line, li) => {
      const y = L.headY + li * lh;
      if (u < 0.6 && hash(fr + li) < 0.25) return; // flicker on entry
      if (amt > 0.05) {
        const dx = (hash(fr * 3 + li) - 0.5) * hs * 0.24 * amt;
        ctx.save(); ctx.globalAlpha = fade * 0.85; ctx.shadowBlur = 0;
        ctx.fillStyle = C.aqua; ctx.fillText(line, x - dx - hs * 0.04 * amt, y);
        ctx.fillStyle = C.magenta; ctx.fillText(line, x + dx + hs * 0.04 * amt, y);
        ctx.restore();
      }
      ctx.fillStyle = pal.ink;
      if (amt > 0.15) {
        for (let b = 0; b < 4; b++) {
          ctx.save(); ctx.beginPath(); ctx.rect(0, y - hs * 0.8 + b * hs * 0.24, L.x1 + 400, hs * 0.24); ctx.clip();
          ctx.fillText(line, x + (hash(fr + b * 13 + li) - 0.5) * hs * 0.3 * amt, y);
          ctx.restore();
        }
      } else ctx.fillText(line, x, y);
    });
  } else {
    const cps = 16;
    let n = Math.floor((t - tIn) * cps);
    let cursor = null;
    L.lines.forEach((line, li) => {
      if (n <= 0) return;
      const part = line.slice(0, n); n -= line.length + 1;
      ctx.fillStyle = pal.ink; ctx.fillText(part, x, L.headY + li * lh);
      cursor = [x + ctx.measureText(part).width + hs * 0.06, L.headY + li * lh];
    });
    if (cursor && Math.floor(t * 2.5) % 2 === 0) { ctx.fillStyle = pal.accent; ctx.fillRect(cursor[0], cursor[1] - hs * 0.72, hs * 0.1, hs * 0.78); }
  }
  ctx.restore();
}

function priceBadge(ctx, L, o, t, P, pal, tIn, fade) {
  if (!product || !o.price || t < tIn) return;
  const u = (t - tIn) / 0.45, sc = easeBack(u) * (1 + P.kick * 0.06), { x, y, r } = L.badge;
  ctx.save(); ctx.globalAlpha = fade; ctx.translate(x, y); ctx.rotate(-0.18 + Math.sin(t * 2) * 0.04); ctx.scale(sc, sc);
  ctx.beginPath();
  for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2, rr2 = i % 2 ? r * 0.86 : r; ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); }
  ctx.closePath(); ctx.fillStyle = o.bg === 'solar' ? C.ink : C.magenta; ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = r * 0.2; ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const pr = money(product.price, product.price % 1 ? 2 : 0);
  ctx.font = `800 ${r * (pr.length > 6 ? 0.42 : 0.52)}px Inter, sans-serif`; ctx.fillText(pr, 0, product.compare_at > product.price ? r * 0.12 : 0);
  if (product.compare_at > product.price) {
    ctx.font = `600 ${r * 0.26}px Inter, sans-serif`; ctx.globalAlpha = fade * 0.8;
    const c = money(product.compare_at, 0), w = ctx.measureText(c).width; ctx.fillText(c, 0, -r * 0.38); ctx.fillRect(-w / 2, -r * 0.38, w, Math.max(2, r * 0.03));
  }
  ctx.restore();
}

function promoChip(ctx, L, o, t, pal, x, y, tIn, fade, center) {
  if (!o.code || t < tIn) return;
  const u = ease((t - tIn) / 0.4), cs = 34 * L.u;
  ctx.save(); ctx.globalAlpha = fade * u;
  ctx.font = `800 ${cs}px Inter, sans-serif`;
  const label = `USE CODE ${o.code}`, w = ctx.measureText(label).width + cs * 1.6, h = cs * 2.2;
  const bx = center ? x - w / 2 : x;
  ctx.translate(0, (1 - u) * h);
  ctx.fillStyle = pal.accent; rr(ctx, bx, y, w, h, h / 2); ctx.fill();
  ctx.setLineDash([cs * 0.4, cs * 0.3]); ctx.strokeStyle = pal.accentInk; ctx.globalAlpha = fade * u * 0.4; ctx.lineWidth = 2 * L.u; rr(ctx, bx + 6 * L.u, y + 6 * L.u, w - 12 * L.u, h - 12 * L.u, h / 2); ctx.stroke();
  ctx.globalAlpha = fade * u; ctx.fillStyle = pal.accentInk; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(label, bx + w / 2, y + h / 2 + 1);
  ctx.restore();
}

function brandMark(ctx, L, pal, x, y, size, align = 'left') {
  ctx.save(); ctx.font = `800 ${size}px Inter, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = pal.ink;
  const name = storeName.toUpperCase(); ctx.fillText(name, x, y);
  const w = ctx.measureText(name).width;
  ctx.fillStyle = pal.accent; ctx.fillRect(align === 'center' ? x - w * 0.2 : x, y + size * 0.3, w * (align === 'center' ? 0.4 : 0.35), Math.max(3, size * 0.14));
  ctx.restore();
}

function drawFrame(ctx, F, o, t) {
  const { W, H } = F;
  const d = (product && product.design) || {};
  const pal = palette(o, d);
  const P = pulses(o, t);
  const L = layoutFor(ctx, F, o);
  const D = o.dur, endDur = Math.min(2.8, D * 0.3), tEnd = D - endDur;
  ctx.save();
  drawBackground(ctx, W, H, o, t, P, pal);
  // snare flash
  if (P.snare > 0.02) { ctx.fillStyle = `rgba(255,255,255,${P.snare * (pal.dark ? 0.07 : 0.12)})`; ctx.fillRect(0, 0, W, H); }
  if (o.style === 'slam' && P.kick > 0.2 && t < tEnd) ctx.translate((hash(P.step) - 0.5) * 16 * L.u * P.kick, (hash(P.step + 9) - 0.5) * 16 * L.u * P.kick);
  const bt = 60 / o.bpm; // one beat
  const tHead = Math.max(0.25, bt), tSub = tHead + 1.2, tPrice = Math.min(D * 0.35, tHead + 1.8), tCode = Math.min(D * 0.48, tHead + 2.6);
  const mainFade = 1 - ease((t - tEnd) / 0.35);
  if (mainFade > 0.001) {
    const intro = ease(t / 0.8);
    const { cx, cy, size } = L.prod;
    particles(ctx, L, o, t, pal);
    drawProduct(ctx, L, t, o, P, mainFade, (0.55 + 0.45 * intro) * (1 - (1 - mainFade) * 0.2), cx, cy, size);
    brandMark(ctx, L, pal, L.brand.x, L.brand.y, L.brand.size);
    headlineText(ctx, L, o, t, pal, tHead, mainFade);
    if (L.sub.length && t >= tSub) {
      const u = ease((t - tSub) / 0.5);
      ctx.save(); ctx.globalAlpha = mainFade * u; ctx.font = `600 ${L.ss}px Inter, sans-serif`; ctx.fillStyle = pal.soft; ctx.textBaseline = 'alphabetic';
      const n = o.style === 'type' ? Math.floor((t - tSub) * 30) : Infinity; let left = n;
      L.sub.forEach((line, i) => { if (left <= 0) return; ctx.fillText(line.slice(0, left), L.x0, L.subY + i * L.ss * 1.35 + (1 - u) * L.ss); left -= line.length + 1; });
      ctx.restore();
    }
    priceBadge(ctx, L, o, t, P, pal, tPrice, mainFade);
    promoChip(ctx, L, o, t, pal, L.x0, L.chipY, tCode, mainFade, false);
    lightSweep(ctx, W, H, t, 3.2);
  }
  if (t >= tEnd) drawEndCard(ctx, F, L, o, t - tEnd, endDur, t, P, pal);
  ctx.restore();
}

function drawEndCard(ctx, F, L, o, et, endDur, t, P, pal) {
  const { W, H } = F, u = L.u;
  const wipe = ease(et / 0.45);
  ctx.save();
  // wipe circle in brand color
  ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.hypot(W, H) * 0.55 * wipe, 0, Math.PI * 2); ctx.clip();
  const endPal = { ...pal, dark: true, ink: '#ffffff', accent: C.solar, accentInk: C.ink };
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, C.violet); g.addColorStop(0.55, C.ink); g.addColorStop(1, C.magenta);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const ey0 = L.y0, ey1 = L.y1, eh = ey1 - ey0;
  const size = Math.min(W - L.x0 - (W - L.x1), eh * (L.wide ? 0.55 : 0.48));
  const cx = W / 2, cy = ey0 + eh * (L.wide ? 0.3 : 0.3);
  drawProduct(ctx, L, t, o, P, ease((et - 0.15) / 0.4), 0.9, cx, cy, size);
  const ns = (L.wide ? 64 : 72) * u;
  ctx.globalAlpha = ease((et - 0.3) / 0.4);
  brandMark(ctx, L, endPal, W / 2, ey0 + eh * (L.wide ? 0.69 : 0.66), ns, 'center');
  // CTA button pulses with the kick
  const ca = ease((et - 0.45) / 0.35), cs = 46 * u * (1 + P.kick * 0.05);
  ctx.globalAlpha = ca;
  ctx.font = `800 ${cs}px Inter, sans-serif`;
  const label = o.cta.toUpperCase(), bw = ctx.measureText(label).width + cs * 2.4, bh = cs * 2.3, by = ey0 + eh * (L.wide ? 0.76 : 0.73);
  ctx.save(); ctx.translate(W / 2, by + bh / 2); ctx.scale(0.8 + 0.2 * easeBack((et - 0.45) / 0.35), 0.8 + 0.2 * easeBack((et - 0.45) / 0.35));
  ctx.fillStyle = C.solar; ctx.shadowColor = hexA(C.solar, 0.6); ctx.shadowBlur = cs * (0.6 + P.kick); rr(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 0, 2);
  ctx.restore();
  ctx.globalAlpha = 1;
  promoChip(ctx, L, o, t, endPal, W / 2, by + bh + 26 * u, t - et + 0.7, 1, true);
  ctx.restore();
}

function drawSafe(ctx, F) {
  const { W, H, safe } = F;
  ctx.save();
  ctx.fillStyle = 'rgba(255,90,71,0.28)';
  ctx.fillRect(0, 0, W, safe.t); ctx.fillRect(0, H - safe.b, W, safe.b);
  ctx.fillRect(0, safe.t, safe.l, H - safe.t - safe.b); ctx.fillRect(W - safe.r, safe.t, safe.r, H - safe.t - safe.b);
  ctx.strokeStyle = '#ff5a47'; ctx.lineWidth = 4; ctx.setLineDash([18, 12]); ctx.strokeRect(safe.l, safe.t, W - safe.l - safe.r, H - safe.t - safe.b);
  ctx.setLineDash([]);
  const fs = Math.min(W, H) * 0.03;
  ctx.fillStyle = '#ffffff'; ctx.font = `700 ${fs}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (F.zones) { ctx.fillText(F.zones[0], W / 2, safe.t / 2); ctx.fillText(F.zones[1], W / 2, H - safe.b / 2); }
  else ctx.fillText('Keep text inside the dashed line', W / 2, safe.t / 2);
  if (F.right) { ctx.save(); ctx.translate(W - safe.r / 2, H / 2); ctx.rotate(Math.PI / 2); ctx.fillText(F.right, 0, 0); ctx.restore(); }
  ctx.restore();
}

// ---------------------------------------------------------------- exports
function fileBase(fmt) { const F = FORMATS[fmt]; return `squadforge-${slugify(product ? product.slug : 'ad')}-${F.file}-${F.W}x${F.H}`; }
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

async function downloadPNG() {
  const o = opts(), F = FORMATS[o.fmt];
  const c = document.createElement('canvas'); c.width = F.W; c.height = F.H;
  const ctx = c.getContext('2d');
  setViewerSize(Math.min(1200, FORMATS[o.fmt].W));
  const D = o.dur, hero = Math.min(D - Math.min(2.8, D * 0.3) - 0.5, Math.max(4, D * 0.45));
  drawFrame(ctx, F, o, hero);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Could not create the image.');
  saveBlob(blob, fileBase(o.fmt) + '.png');
  toast('Image downloaded');
}

function pickMime() {
  if (!window.MediaRecorder) return '';
  const list = ['video/mp4;codecs=avc1,mp4a', 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return list.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
}

async function exportFormats(keys, autoSave) {
  if (!product) { toast('Pick a product first.', 'err'); return; }
  const base = opts();
  const box = root.querySelector('#ad-export');
  const job = exportJob = { cancelled: false };
  box.hidden = false;
  const wasPlaying = playing;
  if (playing) togglePlay();
  let done = 0;
  try {
    for (let i = 0; i < keys.length; i++) {
      if (job.cancelled || !root) break;
      const o = { ...base, fmt: keys[i] };
      root.querySelector('#ad-exp-label').textContent = keys.length > 1 ? `Recording ${FORMATS[o.fmt].label} (${i + 1} of ${keys.length})...` : `Recording ${FORMATS[o.fmt].label}...`;
      const res = await recordVideo(o, job, (p) => { if (root) root.querySelector('#ad-exp-bar').style.width = ((i + p) / keys.length * 100).toFixed(1) + '%'; });
      if (!res || !root) break;
      done++;
      addResult(res, o);
      if (autoSave) saveBlob(res.blob, res.name);
    }
  } finally {
    exportJob = null;
    if (root) {
      box.hidden = true; root.querySelector('#ad-exp-bar').style.width = '0';
      layoutCache.clear();
      if (wasPlaying && !playing) togglePlay(); else drawPreview();
    }
  }
  if (!root) return;
  if (job.cancelled) toast('Recording cancelled');
  else if (done) toast(done > 1 ? `${done} videos are ready below` : (autoSave ? 'Video downloaded' : 'Video ready'));
}

// ---------------------------------------------------------------- frame-exact MP4 export
// Live recording (MediaRecorder) drops frames whenever a frame takes longer than 33 ms to
// draw and writes a variable frame rate file, which TikTok and Instagram re-encode into a
// choppy clip. Here every frame is drawn at an exact time t = i / FPS, encoded with WebCodecs
// at a constant frame rate, and muxed with offline-rendered audio into an MP4 (H.264 + AAC).
const FPS = 30;
const canEncode = () => typeof window.VideoEncoder === 'function' && typeof window.VideoFrame === 'function';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const cfgCache = new Map();
async function pickVideoConfig(W, H) {
  const key = W + 'x' + H;
  if (cfgCache.has(key)) return cfgCache.get(key);
  let found = null;
  const bitrate = W * H >= 2e6 ? 14e6 : 10e6;
  // High, Main, then Baseline profile, all level 4.0+ (enough for 1080x1920 at 30 fps)
  outer: for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640032', 'avc1.42e032']) {
    for (const hw of ['no-preference', 'prefer-software']) {
      const cfg = { codec, width: W, height: H, bitrate, framerate: FPS, bitrateMode: 'variable', latencyMode: 'quality', hardwareAcceleration: hw, avc: { format: 'avc' } };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r && r.supported) { found = cfg; break outer; } } catch (e) { /* try next */ }
    }
  }
  cfgCache.set(key, found);
  return found;
}
async function pickAudioConfig() {
  if (typeof window.AudioEncoder !== 'function') return null;
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
    try { const r = await AudioEncoder.isConfigSupported(cfg); if (r && r.supported) return { cfg, mux }; } catch (e) { /* try next */ }
  }
  return null;
}
// The same beat as the live preview, rendered faster than real time into a buffer.
async function renderAudio(o) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;
  const sr = 48000, len = Math.ceil(o.dur * sr);
  const a = new OAC(2, len, sr);
  const bus = a.createGain(); bus.gain.value = o.vol * 0.9;
  const cmp = a.createDynamicsCompressor(); cmp.threshold.value = -10; cmp.ratio.value = 4;
  bus.connect(cmp); cmp.connect(a.destination);
  const sd = 60 / o.bpm / 4;
  for (let s = 0; s * sd < o.dur; s++) playStep(a, bus, o, s, s * sd + swingOf(o, s));
  return a.startRendering();
}
async function recordVideo(o, job, onProgress) {
  if (canEncode()) {
    const F = FORMATS[o.fmt];
    const vcfg = await pickVideoConfig(F.W, F.H);
    if (vcfg) return encodeVideo(o, job, onProgress, vcfg);
  }
  return recordLive(o, job, onProgress);
}
async function encodeVideo(o, job, onProgress, vcfg) {
  const F = FORMATS[o.fmt];
  const { Muxer, ArrayBufferTarget } = await import('/vendor/mp4-muxer/mp4-muxer.mjs');
  const audio = await pickAudioConfig();
  const abuf = audio ? await renderAudio(o).catch((e) => { console.warn('audio render failed', e); return null; }) : null;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: F.W, height: F.H, frameRate: FPS },
    ...(abuf ? { audio: { codec: audio.mux, numberOfChannels: 2, sampleRate: 48000 } } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let encErr = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  venc.configure(vcfg);
  let aenc = null;
  if (abuf) {
    aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { encErr = e; } });
    aenc.configure(audio.cfg);
    const sr = abuf.sampleRate, n = abuf.length, L = abuf.getChannelData(0), R = abuf.getChannelData(abuf.numberOfChannels > 1 ? 1 : 0);
    const BLOCK = 4800;
    for (let i = 0; i < n; i += BLOCK) {
      const k = Math.min(BLOCK, n - i), data = new Float32Array(k * 2);
      data.set(L.subarray(i, i + k), 0); data.set(R.subarray(i, i + k), k);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: k, numberOfChannels: 2, timestamp: Math.round(i / sr * 1e6), data });
      aenc.encode(ad); ad.close();
    }
  }
  const c = document.createElement('canvas'); c.width = F.W; c.height = F.H;
  const ctx = c.getContext('2d', { alpha: false });
  setViewerSize(Math.min(1100, Math.round(Math.min(F.W, F.H) * 0.95)));
  await nextPaint();
  const total = Math.round(o.dur * FPS), frameUs = 1e6 / FPS;
  exactClock = true;
  try {
    for (let i = 0; i < total; i++) {
      if (job.cancelled || !root) break;
      if (encErr) throw encErr;
      drawFrame(ctx, F, o, i / FPS);
      const vf = new VideoFrame(c, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      venc.encode(vf, { keyFrame: i % FPS === 0 });
      vf.close();
      while (venc.encodeQueueSize > 3) await sleep(4);
      if (i % 3 === 0) { onProgress(i / total); await sleep(0); }
    }
  } finally { exactClock = false; }
  if (job.cancelled || !root) { try { venc.close(); aenc && aenc.close(); } catch (e) { /* ignore */ } return null; }
  await venc.flush(); if (aenc) await aenc.flush();
  if (encErr) throw encErr;
  venc.close(); if (aenc) aenc.close();
  muxer.finalize();
  onProgress(1);
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  if (!blob.size) throw new Error('The video came out empty. Please try again.');
  const note = !abuf ? 'No sound: this browser cannot encode audio. Add a sound in the TikTok or Instagram editor.' : audio.mux === 'opus' ? 'Sound saved as Opus. If an app rejects it, export from Chrome or Edge on Windows or Mac for AAC sound.' : '';
  return { blob, name: fileBase(o.fmt) + '.mp4', type: 'video/mp4', note };
}

// Fallback for browsers without WebCodecs: live capture (may drop frames on slow machines).
async function recordLive(o, job, onProgress) {
  const F = FORMATS[o.fmt];
  const mime = pickMime();
  const c = document.createElement('canvas'); c.width = F.W; c.height = F.H;
  const ctx = c.getContext('2d');
  setViewerSize(Math.min(1100, Math.round(Math.min(F.W, F.H) * 0.95)));
  drawFrame(ctx, F, o, 0);
  const stream = c.captureStream(30);
  const a = ensureAudio();
  let dest = null, bus = null;
  if (a) {
    await a.resume().catch(() => {});
    dest = a.createMediaStreamDestination();
    bus = a.createGain(); bus.gain.value = o.vol * 0.9;
    const cmp = a.createDynamicsCompressor(); cmp.threshold.value = -10; cmp.ratio.value = 4;
    bus.connect(cmp); cmp.connect(dest);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  }
  const clock = a && a.state === 'running' ? () => a.currentTime : () => performance.now() / 1000;
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: F.W * F.H > 2e6 ? 9e6 : 7e6, audioBitsPerSecond: 160000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => { rec.onstop = r; });
  const start = clock() + 0.08;
  if (a && bus && a.state === 'running') {
    const sd = 60 / o.bpm / 4;
    for (let s = 0; s * sd < o.dur; s++) playStep(a, bus, o, s, start + s * sd + swingOf(o, s));
  }
  rec.start(500);
  await new Promise((resolve) => {
    const frame = () => {
      if (job.cancelled || !root) { resolve(); return; }
      const t = Math.max(0, clock() - start);
      if (t >= o.dur) { drawFrame(ctx, F, o, o.dur - 0.001); resolve(); return; }
      drawFrame(ctx, F, o, t);
      onProgress(t / o.dur);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  rec.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());
  if (bus) { try { bus.disconnect(); } catch (e) { /* ignore */ } }
  if (job.cancelled || !root) return null;
  const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
  const blob = new Blob(chunks, { type });
  if (!blob.size) throw new Error('The recording came out empty. Please try again in Chrome, Edge or Safari.');
  return { blob, name: fileBase(o.fmt) + (type.includes('mp4') ? '.mp4' : '.webm'), type };
}

function addResult(res, o) {
  const box = root.querySelector('#ad-results');
  const url = URL.createObjectURL(res.blob);
  const F = FORMATS[o.fmt];
  const item = document.createElement('div');
  item.className = 'ad-result';
  item.innerHTML = `<video src="${esc(url)}" controls playsinline preload="metadata" style="aspect-ratio:${F.W}/${F.H}"></video>
    <div><strong>${esc(F.label)}</strong><span class="muted small">${F.W}x${F.H}, ${o.dur} s, ${(res.blob.size / 1048576).toFixed(1)} MB, ${res.type.includes('mp4') ? 'MP4' : 'WebM'}</span>${res.note ? `<span class="muted small">${esc(res.note)}</span>` : ''}
    <a class="btn btn-sm" href="${esc(url)}" download="${esc(res.name)}">Save video</a></div>`;
  box.prepend(item);
}
