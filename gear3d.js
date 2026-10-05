// SquadForge gear3d: volumetric procedural 3D renders of sports kit.
// Original code. Requires the import map entries "three" and "three/addons/".
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';

/* ------------------------------------------------------------------ */
/* basics                                                              */
/* ------------------------------------------------------------------ */
const TAU = Math.PI * 2;
const PI = Math.PI;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const spow = (x, p) => Math.sign(x) * Math.pow(Math.abs(x), p);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// monotone cubic interpolation over [[x,y],...]
function spline(pts) {
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/* ------------------------------------------------------------------ */
/* design normalisation                                                */
/* ------------------------------------------------------------------ */
const SHAPES = ['jersey', 'jersey-long', 'jersey-tank', 'hoodie', 'shorts', 'socks', 'cap', 'beanie', 'cleats', 'sneakers',
  'shinguards', 'gloves', 'bag', 'bottle', 'ball-soccer', 'ball-basketball', 'ball-football', 'ball-volleyball', 'ball-baseball', 'puck'];
const PATTERNS = ['solid', 'stripes', 'hoops', 'sash', 'gradient', 'chevron', 'split', 'pinstripe', 'camo', 'hex', 'halftone', 'waves', 'flames'];
const FONTS = {
  block: { fam: 'SF Block', w: 400 }, tall: { fam: 'SF Tall', w: 400 }, varsity: { fam: 'SF Varsity', w: 400 },
  stencil: { fam: 'SF Stencil', w: 400 }, future: { fam: 'SF Future', w: 400 }, racing: { fam: 'SF Racing', w: 400 },
  script: { fam: 'SF Script', w: 400 }, modern: { fam: 'SF Modern', w: 600 },
};
const SHAPE_DEFAULTS = {
  'ball-basketball': ['#d9622b', '#1a1410', '#1a1410'],
  'ball-football': ['#7a3a1c', '#f4f5f7', '#f4f5f7'],
  'ball-baseball': ['#f2efe6', '#c8202f', '#04282e'],
  'ball-soccer': ['#f4f5f7', '#04282e', '#ff5a47'],
  'ball-volleyball': ['#f4f5f7', '#1d4ed8', '#ffcc1f'],
  puck: ['#121214', '#2ee6d6', '#ff5a47'],
};
const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const cleanText = (s, n) => String(s == null ? '' : s).replace(/[–—]/g, '-').replace(/[\u0000-\u001f]/g, '').slice(0, n);

function lum(hex) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear
}
function shade(hex, k) { // k<0 darker, k>0 lighter
  const c = new THREE.Color(hex);
  if (k < 0) c.multiplyScalar(1 + k); else c.lerp(new THREE.Color(1, 1, 1), k);
  return '#' + c.getHexString();
}
function mix(a, b, t) { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString(); }

// Unknown or missing shape names used to fall straight back to 'jersey', which made every product whose
// design carried a synonym ('hat', 'boots', 'ball', 'sock'...) or no shape at all render as a shirt.
const SHAPE_ALIAS = {
  shirt: 'jersey', tee: 'jersey', 't-shirt': 'jersey', tshirt: 'jersey', kit: 'jersey', 'jersey-short': 'jersey',
  'long-sleeve': 'jersey-long', longsleeve: 'jersey-long', 'jersey-ls': 'jersey-long', tank: 'jersey-tank', singlet: 'jersey-tank', vest: 'jersey-tank',
  hood: 'hoodie', hoody: 'hoodie', sweatshirt: 'hoodie', sock: 'socks', short: 'shorts', hat: 'cap', snapback: 'cap', 'baseball-cap': 'cap',
  toque: 'beanie', 'knit-hat': 'beanie', cleat: 'cleats', boot: 'cleats', boots: 'cleats', 'football-boots': 'cleats', shoe: 'sneakers', shoes: 'sneakers',
  sneaker: 'sneakers', trainer: 'sneakers', trainers: 'sneakers', shinguard: 'shinguards', 'shin-guard': 'shinguards', 'shin-guards': 'shinguards',
  glove: 'gloves', 'goalkeeper-gloves': 'gloves', duffel: 'bag', duffle: 'bag', backpack: 'bag', 'water-bottle': 'bottle',
  ball: 'ball-soccer', soccer: 'ball-soccer', 'soccer-ball': 'ball-soccer', basketball: 'ball-basketball', volleyball: 'ball-volleyball',
  baseball: 'ball-baseball', 'american-football': 'ball-football', 'ball-american-football': 'ball-football', 'hockey-puck': 'puck',
};
function resolveShape(d) {
  for (const k of [d.shape, d.product_shape, d.type, d.kind]) {
    if (typeof k !== 'string' || !k) continue;
    if (SHAPES.includes(k)) return k;
    const n = k.trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (SHAPES.includes(n)) return n;
    if (SHAPE_ALIAS[n] && SHAPES.includes(SHAPE_ALIAS[n])) return SHAPE_ALIAS[n];
    if (n.endsWith('s') && SHAPES.includes(n.slice(0, -1))) return n.slice(0, -1);
  }
  return 'jersey';
}
export function normalize(d) {
  d = d && typeof d === 'object' ? d : {};
  const shape = resolveShape(d);
  const def = SHAPE_DEFAULTS[shape] || ['#04282e', '#c8f53c', '#ff5a47'];
  const o = { shape };
  o.primary = isHex(d.primary) ? d.primary.toLowerCase() : def[0];
  o.secondary = isHex(d.secondary) ? d.secondary.toLowerCase() : def[1];
  o.accent = isHex(d.accent) ? d.accent.toLowerCase() : def[2];
  o.sleeve = isHex(d.sleeve) ? d.sleeve.toLowerCase() : o.primary;
  o.pattern = PATTERNS.includes(d.pattern) ? d.pattern : 'solid';
  o.collar = ['crew', 'v', 'polo'].includes(d.collar) ? d.collar : 'crew';
  o.font = FONTS[d.font] ? d.font : 'block';
  const up = s => (o.font === 'script' ? s : s.toUpperCase());
  o.name = up(cleanText(d.name, 16));
  o.number = cleanText(d.number, 3).replace(/[^0-9]/g, '').slice(0, 2);
  o.chest = up(cleanText(d.chest, 18));
  o.text = up(cleanText(d.text, 18));
  o.subtext = cleanText(d.subtext, 28);
  o.textColor = isHex(d.textColor) ? d.textColor.toLowerCase() : (lum(o.primary) > 0.33 ? '#04282e' : '#ffffff');
  o.finish = ['matte', 'gloss', 'metallic', 'holo'].includes(d.finish) ? d.finish : 'matte';
  o.outline = !!d.outline;
  o.patch = ['none', 'captain', 'star', 'champion', 'flag'].includes(d.patch) ? d.patch : 'none';
  o.lighting = ['studio', 'stadium', 'sunset', 'neon'].includes(d.lighting) ? d.lighting : 'studio';
  return o;
}

/* ------------------------------------------------------------------ */
/* fonts                                                               */
/* ------------------------------------------------------------------ */
const fontPromises = new Map();
let fontCssChecked = false;
function ensureFontCss() {
  if (fontCssChecked || typeof document === 'undefined') return;
  fontCssChecked = true;
  let has = false;
  try { document.fonts.forEach(f => { if (/^"?SF /.test(f.family)) has = true; }); } catch (e) { /* ignore */ }
  if (!has && !document.querySelector('link[href*="fonts.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/fonts.css'; document.head.appendChild(l);
  }
}
function loadFont(key) {
  const f = FONTS[key] || FONTS.block;
  if (fontPromises.has(f.fam)) return fontPromises.get(f.fam);
  ensureFontCss();
  let p;
  if (typeof document === 'undefined' || !document.fonts) p = Promise.resolve(false);
  else {
    const spec = `${f.w} 64px "${f.fam}"`;
    p = new Promise(res => {
      let tries = 0;
      const attempt = () => document.fonts.load(spec, 'AZ09').then(list => {
        if (list && list.length) res(true);
        else if (++tries < 3) setTimeout(attempt, 250); // stylesheet may still be loading
        else res(false);
      }, () => res(false));
      attempt();
    });
    p = Promise.race([p, new Promise(r => setTimeout(() => r(false), 4000))]);
  }
  fontPromises.set(f.fam, p);
  return p;
}
function fontReady(key) {
  const f = FONTS[key] || FONTS.block;
  try { return document.fonts.check(`${f.w} 64px "${f.fam}"`); } catch (e) { return true; }
}
function fontStr(d, px) {
  const f = FONTS[d.font] || FONTS.block;
  return `${f.w} ${Math.max(1, px | 0)}px "${f.fam}", Impact, "Arial Black", sans-serif`;
}

/* ------------------------------------------------------------------ */
/* canvas painting                                                     */
/* ------------------------------------------------------------------ */
function mkCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c;
}

// paints primary + pattern in rect. unit = pixels per world unit (keeps scale consistent across parts)
function paintPattern(ctx, x, y, w, h, d, o = {}) {
  const unit = o.unit || Math.min(w, h) / 2.4;
  const P = d.primary, S = d.secondary, A = d.accent;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(x, y);
  if (o.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.fillStyle = P; ctx.fillRect(0, 0, w, h);
  const R = rng(o.seed || 7);
  const u = unit * (o.scale || 1);
  switch (o.pattern || d.pattern) {
    case 'stripes': {
      const sw = u * 0.17; ctx.fillStyle = S;
      for (let i = (w / 2) % (sw * 2) - sw * 2 - sw / 2; i < w + sw; i += sw * 2) ctx.fillRect(i, 0, sw, h);
      break;
    }
    case 'pinstripe': {
      const sw = u * 0.11; ctx.fillStyle = S;
      for (let i = (w / 2) % sw - sw; i < w + sw; i += sw) ctx.fillRect(i - u * 0.006, 0, u * 0.012, h);
      break;
    }
    case 'hoops': {
      const sh = u * 0.2; ctx.fillStyle = S;
      for (let j = (o.hoopOffset || 0) % (sh * 2); j < h + sh; j += sh * 2) ctx.fillRect(0, j, w, sh);
      break;
    }
    case 'sash': {
      ctx.fillStyle = S; ctx.beginPath();
      const bw = u * 0.42;
      ctx.moveTo(-bw * 0.2, h * 0.12); ctx.lineTo(bw * 1.1, h * 0.04); ctx.lineTo(w + bw * 0.2, h * 0.88); ctx.lineTo(w - bw * 1.1, h * 0.96);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = A; ctx.lineWidth = u * 0.03; ctx.stroke();
      break;
    }
    case 'gradient': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, P); g.addColorStop(0.45, P); g.addColorStop(1, S);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'chevron': {
      const ch = u * 0.16;
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = k === 1 ? A : S;
        const y0 = h * 0.28 + k * ch * 1.5;
        ctx.beginPath();
        ctx.moveTo(-w * 0.05, y0 - w * 0.3); ctx.lineTo(w / 2, y0); ctx.lineTo(w * 1.05, y0 - w * 0.3);
        ctx.lineTo(w * 1.05, y0 - w * 0.3 + ch); ctx.lineTo(w / 2, y0 + ch); ctx.lineTo(-w * 0.05, y0 - w * 0.3 + ch);
        ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'split': {
      ctx.fillStyle = S; ctx.fillRect(w / 2, 0, w / 2 + 1, h);
      ctx.fillStyle = A; ctx.fillRect(w / 2 - u * 0.02, 0, u * 0.04, h);
      break;
    }
    case 'camo': {
      const cols = [S, shade(P, -0.35), A, mix(P, S, 0.5)];
      for (let i = 0; i < 70 * (w * h) / (u * u * 6); i++) {
        if (i > 900) break;
        ctx.fillStyle = cols[i % cols.length];
        const cx = R() * w, cy = R() * h, r = u * (0.08 + R() * 0.16);
        ctx.beginPath();
        for (let a = 0; a < 9; a++) {
          const ang = a / 9 * TAU, rr = r * (0.6 + R() * 0.6);
          const px = cx + Math.cos(ang) * rr * 1.5, py = cy + Math.sin(ang) * rr;
          a ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'hex': {
      const r = u * 0.12, hh = r * Math.sqrt(3);
      ctx.lineWidth = u * 0.014; ctx.strokeStyle = S;
      for (let row = -1, yy = 0; yy < h + hh; row++, yy = row * hh * 0.5) {
        for (let xx = (row & 1) * r * 1.5; xx < w + r * 3; xx += r * 3) {
          ctx.beginPath();
          for (let a = 0; a < 6; a++) { const ang = a / 6 * TAU; const px = xx + Math.cos(ang) * r * 0.92, py = yy + Math.sin(ang) * r * 0.92; a ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
          ctx.closePath();
          if (R() < 0.12) { ctx.fillStyle = mix(P, S, 0.35); ctx.fill(); }
          ctx.stroke();
        }
      }
      break;
    }
    case 'halftone': {
      const s = u * 0.07; ctx.fillStyle = S;
      for (let yy = 0, r = 0; yy < h + s; yy += s, r++) {
        const k = smooth(0.25, 1, yy / h);
        for (let xx = (r & 1) * s / 2; xx < w + s; xx += s) {
          const rad = s * 0.5 * k;
          if (rad > 0.5) { ctx.beginPath(); ctx.arc(xx, yy, rad, 0, TAU); ctx.fill(); }
        }
      }
      break;
    }
    case 'waves': {
      const per = u * 0.5, amp = u * 0.05, band = u * 0.09;
      for (let k = 0, yy = h * 0.35; yy < h + band; k++, yy += band * 2.2) {
        ctx.fillStyle = k % 3 === 2 ? A : S;
        ctx.beginPath();
        for (let xx = 0; xx <= w; xx += 6) ctx.lineTo(xx, yy + Math.sin(xx / per * TAU) * amp);
        for (let xx = w; xx >= 0; xx -= 6) ctx.lineTo(xx, yy + band + Math.sin(xx / per * TAU) * amp);
        ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'flames': {
      const g = ctx.createLinearGradient(0, h, 0, h * 0.35);
      g.addColorStop(0, A); g.addColorStop(1, S);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, h);
      const n = Math.max(4, Math.round(w / (u * 0.28)));
      for (let i = 0; i <= n; i++) {
        const xx = i / n * w, tip = h * (0.62 - R() * 0.3), mid = h * 0.86;
        ctx.quadraticCurveTo(xx - w / n * 0.6, mid, xx - w / n * 0.25, tip);
        ctx.quadraticCurveTo(xx - w / n * 0.1, mid - (h - mid), xx, h * 0.9);
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      break;
    }
    default: break;
  }
  ctx.restore();
}

// returns fill style for lettering finish
function letterFill(ctx, d, color, x, y, w, h) {
  if (d.finish === 'holo') {
    const g = ctx.createLinearGradient(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
    const st = ['#ff6ad5', '#c774e8', '#94d0ff', '#8cffda', '#fffa9e', '#ffb38a'];
    st.forEach((c, i) => g.addColorStop(i / (st.length - 1), mix(c, color, 0.25)));
    return g;
  }
  if (d.finish === 'metallic') {
    const g = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
    g.addColorStop(0, shade(color, 0.35)); g.addColorStop(0.5, color); g.addColorStop(0.55, shade(color, -0.3)); g.addColorStop(1, shade(color, 0.15));
    return g;
  }
  return color;
}

// centered text, fit into box. o: {color, sx (x stretch), arc (radius px, >0 arches up), outline, weight}
function drawText(ctx, text, x, y, maxW, maxH, d, o = {}) {
  if (!text) return 0;
  let px = maxH;
  ctx.font = fontStr(d, px);
  const sx = o.sx || 1;
  let w = ctx.measureText(text).width * sx;
  if (w > maxW) { px = px * maxW / w; ctx.font = fontStr(d, px); w = ctx.measureText(text).width * sx; }
  const color = o.color || d.textColor;
  const outline = o.outline != null ? o.outline : d.outline;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  const asc = m.actualBoundingBoxAscent || px * 0.7, desc = m.actualBoundingBoxDescent || 0;
  const by = (asc - desc) / 2;
  const fill = letterFill(ctx, d, color, 0, 0, w / sx, px);
  let stroke = o.strokeColor || d.accent;
  if (typeof color === 'string' && typeof stroke === 'string' && stroke.toLowerCase() === color.toLowerCase()) { // outline would merge into the letters
    stroke = d.secondary && d.secondary.toLowerCase() !== color.toLowerCase() ? d.secondary : (lum(color) > 0.4 ? '#04282e' : '#ffffff');
  }
  const lw = px * (o.strokeW || 0.12);
  if (o.arc) {
    const R = o.arc, chars = [...text];
    const widths = chars.map(c => ctx.measureText(c).width);
    const tot = widths.reduce((a, b) => a + b, 0) + (chars.length - 1) * px * 0.02;
    let a = -tot / R / 2;
    const passes = outline ? ['stroke', 'fill'] : ['fill'];
    for (const pass of passes) {
      let aa = a;
      chars.forEach((c, i) => {
        const cw = widths[i];
        const ang = aa + cw / 2 / R;
        ctx.save();
        ctx.translate(Math.sin(ang) * R, R - Math.cos(ang) * R + by);
        ctx.rotate(ang);
        if (pass === 'stroke') { ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(c, 0, 0); }
        else { ctx.fillStyle = fill; ctx.fillText(c, 0, 0); }
        ctx.restore();
        aa += (cw + px * 0.02) / R;
      });
    }
  } else {
    if (outline) { ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(text, 0, by); }
    ctx.fillStyle = fill; ctx.fillText(text, 0, by);
  }
  ctx.restore();
  return px;
}

/* ------------------------------------------------------------------ */
/* procedural normal maps (shared sources)                             */
/* ------------------------------------------------------------------ */
const normalSources = new Map();
function heightToNormal(size, hfn, strength) {
  const c = mkCanvas(size, size), ctx = c.getContext('2d');
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = hfn(x / size, y / size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = H[y * size + ((x - 1 + size) % size)], xr = H[y * size + ((x + 1) % size)];
    const yu = H[((y - 1 + size) % size) * size + x], yd = H[((y + 1) % size) * size + x];
    let nx = (xl - xr) * strength, ny = (yd - yu) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y, per) { // tileable value noise
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => hash2(((a % per) + per) % per, ((b % per) + per) % per);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}
const NORMALS = {
  // athletic mesh knit: staggered dimples on a fine rib
  knit: () => heightToNormal(128, (u, v) => {
    const cx = u * 8, cy = v * 8 + (Math.floor(u * 8) % 2) * 0.5;
    const fx = cx - Math.floor(cx) - 0.5, fy = cy - Math.floor(cy) - 0.5;
    const hole = Math.exp(-(fx * fx + fy * fy) * 28);
    return 0.6 * Math.sin(u * TAU * 32) * 0.5 - hole;
  }, 2.2),
  rib: () => heightToNormal(128, (u, v) => Math.pow(Math.abs(Math.sin(u * PI * 8)), 0.6) + 0.15 * Math.sin(v * TAU * 16 + Math.sin(u * TAU * 8) * 2), 3.0),
  pebble: () => heightToNormal(256, (u, v) => {
    const cx = u * 24, cy = v * 24 + (Math.floor(u * 24) % 2) * 0.5;
    const fx = cx - Math.floor(cx) - 0.5, fy = cy - Math.floor(cy) - 0.5;
    return Math.exp(-(fx * fx + fy * fy) * 9) + 0.25 * vnoise(u * 64, v * 64, 64);
  }, 2.2),
  grain: () => heightToNormal(256, (u, v) => vnoise(u * 32, v * 32, 32) * 0.6 + vnoise(u * 96, v * 96, 96) * 0.4, 1.6),
  fuzz: () => heightToNormal(128, (u, v) => vnoise(u * 48, v * 48, 48) + 0.5 * vnoise(u * 128, v * 128, 128), 5),
  knurl: () => heightToNormal(128, (u, v) => Math.abs(Math.sin((u + v) * PI * 8)) + Math.abs(Math.sin((u - v) * PI * 8)), 2.5),
  // sock knit: 8 raised ribs per tile with V-shaped stitch loops running along them
  sock: () => heightToNormal(128, (u, v) => {
    const rib = Math.pow(0.5 + 0.5 * Math.cos(u * TAU * 8), 0.8);
    const col = u * 16, fx = col - Math.floor(col) - 0.5;
    const row = v * 16 + Math.abs(fx) * 0.9, fy = row - Math.floor(row) - 0.5;
    return rib * 0.8 + 0.18 * Math.exp(-fy * fy * 14) * (1 - fx * fx * 2);
  }, 2.0),
};
function normalTex(kind, rx, ry) {
  if (!normalSources.has(kind)) normalSources.set(kind, NORMALS[kind]());
  const t = new THREE.CanvasTexture(normalSources.get(kind));
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace;
  return t;
}

let shadowCanvas = null;
function shadowTexSource() {
  if (shadowCanvas) return shadowCanvas;
  const c = mkCanvas(256, 256), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.62)'); g.addColorStop(0.35, 'rgba(0,0,0,0.38)'); g.addColorStop(0.7, 'rgba(0,0,0,0.1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  shadowCanvas = c; return c;
}

/* ------------------------------------------------------------------ */
/* shader patching: wind ripple, print push, glint sweep, shoe flex    */
/* ------------------------------------------------------------------ */
function makeUniforms() {
  return { uTime: { value: 0 }, uWind: { value: 0 }, uSweep: { value: -9 }, uSweepAmt: { value: 0 }, uFlex: { value: 0 } };
}
// o: {wind: amplitude, push: offset along normal, sweep: bool, flex: {x0,x1,amp}}
function patchMat(mat, U, o = {}) {
  const key = JSON.stringify(o);
  mat.customProgramCacheKey = () => 'g3d' + key;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    let pre = 'uniform float uTime;\nuniform float uWind;\nuniform float uFlex;\n';
    let body = '';
    if (o.wind) {
      body += `{ float ph = position.y * 3.3 + position.x * 1.9 - uTime * 1.7;
        float w = sin(ph) * 0.6 + sin(position.y * 7.1 + position.z * 3.0 - uTime * 2.6) * 0.3 + sin(position.x * 5.0 - uTime * 1.1) * 0.25;
        transformed += objectNormal * w * uWind * ${o.wind.toFixed(4)}; }\n`;
    }
    if (o.flex) {
      body += `{ float fx = smoothstep(${o.flex.x0.toFixed(3)}, ${o.flex.x1.toFixed(3)}, position.x);
        transformed.y += fx * fx * uFlex * ${o.flex.amp.toFixed(3)}; }\n`;
    }
    if (o.push) body += `transformed += objectNormal * ${o.push.toFixed(4)};\n`;
    if (o.sweep) { pre += 'varying vec3 vSwp;\n'; }
    sh.vertexShader = pre + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + body);
    // vivid colour: gentle saturation lift before tone mapping (keeps whites white, avoids blow-out)
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      'outgoingLight = max(mix(vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722))), outgoingLight, 1.14), 0.0);\n#include <opaque_fragment>');
    if (o.sweep) {
      sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n vSwp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform float uSweep;\nuniform float uSweepAmt;\nvarying vec3 vSwp;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
        `{ float sw = exp(-pow((vSwp.x * 0.8 + vSwp.y * 0.6 - uSweep) * 2.6, 2.0));
           outgoingLight += sw * uSweepAmt * (0.25 + diffuseColor.rgb * 0.9); }
         #include <opaque_fragment>`);
    }
  };
  return mat;
}

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */
function weldNormals(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = Math.round(p.getX(i) * 2e3) + ',' + Math.round(p.getY(i) * 2e3) + ',' + Math.round(p.getZ(i) * 2e3);
    let a = map.get(k); if (!a) map.set(k, a = []); a.push(i);
  }
  const v = V();
  for (const a of map.values()) {
    if (a.length < 2) continue;
    v.set(0, 0, 0);
    for (const i of a) v.x += n.getX(i), v.y += n.getY(i), v.z += n.getZ(i);
    v.normalize();
    for (const i of a) n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
}
function flipGeo(geo) {
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  geo.index.needsUpdate = true;
  geo.computeVertexNormals();
}
// grid surface: fn(u,v,target) ; outward(u,v,pos)-> Vector3 hint used to orient winding
function grid(nu, nv, fn, o = {}) {
  const cnt = (nu + 1) * (nv + 1);
  const P = new Float32Array(cnt * 3), UV = new Float32Array(cnt * 2);
  const t = V();
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv, k = j * (nu + 1) + i;
    t.set(0, 0, 0);
    const uv = fn(u, v, t);
    P[k * 3] = t.x; P[k * 3 + 1] = t.y; P[k * 3 + 2] = t.z;
    UV[k * 2] = uv ? uv[0] : u; UV[k * 2 + 1] = uv ? uv[1] : v;
  }
  const I = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    I.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  g.setIndex(cnt > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  g.computeVertexNormals();
  if (o.weld !== false) weldNormals(g);
  if (o.outward) {
    // orientation vote on a few sample vertices
    let vote = 0; const n = g.attributes.normal, p = g.attributes.position, pos = V(), nn = V();
    for (const [su, sv] of [[0.31, 0.43], [0.62, 0.57], [0.13, 0.71], [0.87, 0.29], [0.5, 0.5]]) {
      const i = Math.round(sv * nv) * (nu + 1) + Math.round(su * nu);
      pos.fromBufferAttribute(p, i); nn.fromBufferAttribute(n, i);
      vote += Math.sign(nn.dot(o.outward(su, sv, pos)));
    }
    if (vote < 0) { flipGeo(g); if (o.weld !== false) weldNormals(g); }
  }
  return g;
}
const fromCenter = c => (u, v, p) => p.clone().sub(c);

// tube along points with optional radius function and flattening
function tube(points, o = {}) {
  const closed = !!o.closed;
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  const seg = o.seg || Math.max(12, points.length * 6), rad = o.radial || 10;
  const frames = curve.computeFrenetFrames(seg, closed);
  const up = o.up ? o.up.clone().normalize() : null;
  const pts = [];
  for (let j = 0; j <= seg; j++) pts.push(curve.getPointAt(j / seg));
  const g = grid(rad, seg, (u, v, t) => {
    const j = Math.round(v * seg), P = pts[j], T = frames.tangents[j];
    let N = frames.normals[j], B = frames.binormals[j];
    if (up) { B = up.clone().sub(T.clone().multiplyScalar(up.dot(T))).normalize(); N = B.clone().cross(T).normalize(); }
    const r = o.rFn ? o.rFn(v) : (o.radius || 0.03);
    const a = u * TAU;
    t.copy(P).addScaledVector(N, Math.cos(a) * r * (o.flat || 1)).addScaledVector(B, Math.sin(a) * r);
  }, { outward: (u, v, p) => p.clone().sub(pts[Math.round(v * seg)]) });
  return g;
}

function mergeGeos(list) {
  let vc = 0; const hasUV = list.every(g => g.attributes.uv);
  const parts = list.map(g => { const gi = g.index ? g : (() => { const n = g.attributes.position.count; g.setIndex([...Array(n).keys()]); return g; })(); vc += gi.attributes.position.count; return gi; });
  const P = new Float32Array(vc * 3), N = new Float32Array(vc * 3), UV = new Float32Array(vc * 2), I = [];
  let off = 0;
  for (const g of parts) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    P.set(g.attributes.position.array.slice(0, n * 3), off * 3);
    N.set(g.attributes.normal.array.slice(0, n * 3), off * 3);
    if (hasUV) UV.set(g.attributes.uv.array.slice(0, n * 2), off * 2);
    const idx = g.index.array; for (let i = 0; i < idx.length; i++) I.push(idx[i] + off);
    off += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (hasUV) out.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  out.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  return out;
}
// place a small geometry at position with orientation (normal -> +Y of geo)
function placeGeo(g, pos, normal, spin = 0, tangentHint) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), normal.clone().normalize());
  if (tangentHint) {
    // rotate around normal so that local +X aligns with tangent hint
    const xAxis = V(1, 0, 0).applyQuaternion(q);
    const th = tangentHint.clone().sub(normal.clone().multiplyScalar(tangentHint.dot(normal))).normalize();
    const ang = Math.atan2(xAxis.clone().cross(th).dot(normal.clone().normalize()), xAxis.dot(th));
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(normal.clone().normalize(), ang));
  }
  if (spin) q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), spin));
  const m = new THREE.Matrix4().compose(pos, q, V(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}
// ring band around a loop. loop(a)-> {p, out(unit), ax(unit along band width)}
function loopBand(loop, o = {}) {
  const width = o.width || 0.08, thick = o.thick || 0.03, ribs = o.ribs || 0, ribAmp = o.ribAmp || 0;
  const nu = o.seg || 128, nv = o.prof || 14;
  const cache = [];
  for (let i = 0; i <= nu; i++) cache.push(loop(i / nu));
  return grid(nu, nv, (u, v, t) => {
    const L = cache[Math.round(u * nu)];
    const ps = v * TAU;
    const ax = Math.cos(ps) * width / 2;
    let rad = (Math.sin(ps) * 0.5 + 0.5) * thick - thick * (o.inset != null ? o.inset : 0.35);
    if (ribs) rad += ribAmp * (0.5 + 0.5 * Math.cos(u * TAU * ribs)) * Math.max(0, Math.sin(ps));
    t.copy(L.p).addScaledVector(L.ax, ax + (o.axOff || 0)).addScaledVector(L.out, rad);
    return [u, v];
  }, { outward: (u, v, p) => { const L = cache[Math.round(u * nu)]; return p.clone().sub(L.p.clone().addScaledVector(L.out, thick * 0.15)); } });
}

// raised badge shapes for patches
function patchShape(kind) {
  const s = new THREE.Shape();
  if (kind === 'star') {
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + PI / 2, r = i % 2 ? 0.42 : 1; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? s.lineTo(x, y) : s.moveTo(x, y); }
  } else if (kind === 'champion') {
    s.moveTo(-0.8, 0.9); s.lineTo(0.8, 0.9); s.lineTo(0.8, 0.1); s.quadraticCurveTo(0.7, -0.7, 0, -1); s.quadraticCurveTo(-0.7, -0.7, -0.8, 0.1); s.closePath();
  } else if (kind === 'flag') {
    s.moveTo(-1, -0.65); s.lineTo(1, -0.65); s.lineTo(1, 0.65); s.lineTo(-1, 0.65); s.closePath();
  } else { // captain: roundel
    s.absarc(0, 0, 1, 0, TAU, false);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Item: a built product (group + materials + repaint logic)           */
/* ------------------------------------------------------------------ */
const geoCache = new Map();
function cached(key, fn) { if (!geoCache.has(key)) geoCache.set(key, fn()); return geoCache.get(key); }

class Item {
  constructor(d, U, q) {
    this.d = d; this.U = U; this.q = q;
    this.group = new THREE.Group();
    this.texs = []; this.mats = []; this.geos = []; this.painters = [];
    this.fabric = false; this.spinner = null; this.shoe = false;
    this.yaw = 0; this.elev = 0.16; this.heroYaw = -0.6;
  }
  canvas(w, h) { return mkCanvas(Math.round(w * this.q), Math.round(h * this.q)); }
  tex(c) {
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; this.texs.push(t); return t;
  }
  ntex(kind, rx, ry) { const t = normalTex(kind, rx, ry); this.texs.push(t); return t; }
  mat(p, patch) { const m = new THREE.MeshPhysicalMaterial(p); patchMat(m, this.U, patch || this.defPatch || {}); this.mats.push(m); return m; }
  add(geo, mat, parent) { const m = new THREE.Mesh(geo, mat); (parent || this.group).add(m); return m; }
  own(g) { this.geos.push(g); return g; }
  fabricMat(map, o = {}) {
    return this.mat({
      map, roughness: o.rough != null ? o.rough : 0.8, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.35, 0.35, 0.35), specularIntensity: 0.55,
      normalMap: this.ntex(o.normal || 'knit', o.rx || 24, o.ry || 12), normalScale: new THREE.Vector2(o.ns || 0.45, o.ns || 0.45),
      side: o.side || THREE.FrontSide, color: o.color || 0xffffff,
    }, o.patch || { wind: this.fabric ? 0.012 : 0 });
  }
  printMat(map, o = {}) {
    const m = this.mat({
      map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      roughness: 0.6, side: o.side || THREE.FrontSide, bumpMap: o.bump || null, bumpScale: o.bump ? 2.5 : 1,
    }, { wind: this.fabric ? 0.012 : 0, push: o.push != null ? o.push : 0.0015, sweep: true, flex: o.flex });
    m.userData.print = true;
    return m;
  }
  liningMat(color) {
    return this.mat({ color: new THREE.Color(color), roughness: 0.9, side: THREE.BackSide, sheen: 0.6, sheenColor: new THREE.Color(0.2, 0.2, 0.2) }, { wind: this.fabric ? 0.012 : 0 });
  }
  setFinish(d) {
    for (const m of this.mats) {
      if (!m.userData.print) continue;
      const f = d.finish;
      const was = m.userData.finish;
      m.metalness = f === 'metallic' ? 0.85 : f === 'holo' ? 0.55 : 0;
      m.roughness = f === 'matte' ? 0.78 : f === 'gloss' ? 0.18 : f === 'metallic' ? 0.28 : 0.2;
      m.clearcoat = f === 'gloss' || f === 'holo' ? 1 : 0;
      m.clearcoatRoughness = 0.1;
      m.iridescence = f === 'holo' ? 1 : 0;
      m.iridescenceIOR = 1.6; m.iridescenceThicknessRange = [180, 520];
      if (was !== f) { m.needsUpdate = true; m.userData.finish = f; }
    }
  }
  paint(d) { this.d = d; for (const p of this.painters) p(d); this.setFinish(d); for (const t of this.texs) if (t.image && t.image.getContext) t.needsUpdate = true; }
  dispose() {
    for (const t of this.texs) t.dispose();
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    this.group.removeFromParent();
  }
}

// --- raised patch badge -------------------------------------------------
function patchFace(ctx, S, kind, d) {
  ctx.clearRect(0, 0, S, S);
  const c = S / 2;
  const gold = '#e8c25a';
  if (kind === 'captain') {
    ctx.fillStyle = d.accent; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = S * 0.05; ctx.beginPath(); ctx.arc(c, c, S * 0.42, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.font = `900 ${S * 0.62}px Inter, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('C', c, c * 1.04);
  } else if (kind === 'star') {
    const g = ctx.createLinearGradient(0, 0, S, S); g.addColorStop(0, '#fff2b8'); g.addColorStop(0.5, gold); g.addColorStop(1, '#a87b22');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  } else if (kind === 'champion') {
    ctx.fillStyle = d.secondary; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = d.primary; ctx.fillRect(0, S * 0.05, S, S * 0.3);
    ctx.fillStyle = gold;
    ctx.beginPath(); // cup
    ctx.moveTo(S * 0.33, S * 0.42); ctx.lineTo(S * 0.67, S * 0.42); ctx.quadraticCurveTo(S * 0.66, S * 0.66, c, S * 0.68);
    ctx.quadraticCurveTo(S * 0.34, S * 0.66, S * 0.33, S * 0.42); ctx.fill();
    ctx.fillRect(S * 0.46, S * 0.66, S * 0.08, S * 0.1); ctx.fillRect(S * 0.38, S * 0.76, S * 0.24, S * 0.06);
    ctx.fillStyle = '#ffffff'; ctx.font = `800 ${S * 0.16}px Inter, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('No.1', c, S * 0.2);
  } else if (kind === 'flag') {
    const cols = [d.primary, '#ffffff', d.secondary];
    cols.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(i * S / 3, 0, S / 3 + 1, S); });
    ctx.fillStyle = d.accent; ctx.beginPath(); ctx.arc(c, c, S * 0.12, 0, TAU); ctx.fill();
  }
}
function buildPatch(item, kind, size) {
  const shape = patchShape(kind);
  const geo = item.own(new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 3, curveSegments: 24 }));
  geo.computeBoundingBox();
  const bb = geo.boundingBox, p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
  geo.translate(0, 0, -0.1);
  const cv = item.canvas(256, 256); const tx = item.tex(cv);
  patchFace(cv.getContext('2d'), cv.width, kind, item.d);
  const face = item.mat({ map: tx, roughness: kind === 'star' ? 0.3 : 0.7, metalness: kind === 'star' ? 0.8 : 0, sheen: kind === 'star' ? 0 : 0.6, sheenColor: new THREE.Color(0.3, 0.3, 0.3) }, { wind: item.fabric ? 0.012 : 0 });
  const edge = item.mat({ color: new THREE.Color(kind === 'star' ? '#c99a2e' : '#f4f5f7'), roughness: 0.8, sheen: 0.5, sheenColor: new THREE.Color(0.3, 0.3, 0.3) }, {});
  const m = new THREE.Mesh(geo, [face, edge]);
  m.scale.setScalar(size);
  return m;
}
// attaches/updates patch on item: anchor {pos, normal, up}
function makePatchUpdater(item, anchor, size) {
  let cur = null, kind = null;
  item.painters.push(d => {
    if (d.patch === kind && cur) { // repaint colors
      const face = cur.material[0]; patchFace(face.map.image.getContext('2d'), face.map.image.width, kind, d); face.map.needsUpdate = true; return;
    }
    if (cur) { cur.removeFromParent(); cur = null; }
    kind = d.patch;
    if (kind === 'none') return;
    cur = buildPatch(item, kind, size);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), anchor.normal.clone().normalize());
    const up = V(0, 1, 0).applyQuaternion(q);
    const want = anchor.up.clone().sub(anchor.normal.clone().multiplyScalar(anchor.up.dot(anchor.normal))).normalize();
    const ang = Math.atan2(up.clone().cross(want).dot(anchor.normal.clone().normalize()), up.dot(want));
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(anchor.normal.clone().normalize(), ang));
    cur.quaternion.copy(q); cur.position.copy(anchor.pos);
    item.group.add(cur);
  });
}

/* ------------------------------------------------------------------ */
/* TORSO garments: jersey / long / tank / hoodie                       */
/* ------------------------------------------------------------------ */
const HEM = -1.25, YTOP = 1.12;
function torsoModel(kind, collar) {
  const tank = kind === 'tank', hood = kind === 'hoodie';
  const W = spline(tank
    ? [[-1.3, 0.85], [-0.6, 0.8], [0, 0.85], [0.3, 0.89], [0.55, 0.8], [0.8, 0.62], [1.0, 0.5]]
    : [[-1.3, 0.85], [-0.6, 0.81], [0, 0.86], [0.45, 0.92], [0.9, 0.96]]);
  const D = spline([[-1.3, 0.37], [-0.6, 0.355], [0.25, 0.43], [0.6, 0.42], [1.0, 0.34]]);
  const ys = tank ? 0.98 : 0.86;
  const sec = (th, y, out) => {
    const s = Math.sin(th), c = Math.cos(th);
    out.x = W(y) * spow(s, 0.8); out.z = D(y) * spow(c, 0.8) * (c < 0 ? 0.93 : 1); return out;
  };
  const rx = tank ? 0.33 : hood ? 0.25 : 0.245, rz = tank ? 0.25 : 0.2, cz = -0.045, yb = tank ? 1.1 : 1.08, fr = tank ? 0.2 : 0.07;
  const neck = (th, out) => {
    let a = Math.atan2(Math.sin(th), Math.cos(th));
    const s = Math.sin(a), c = Math.cos(a);
    let x = rx * s, z = cz + rz * c, y = yb - fr * Math.pow(Math.max(0, c), 1.5);
    if (collar === 'v' && !tank && !hood) {
      const k = Math.max(0, 1 - Math.abs(a) / 0.85);
      y -= 0.36 * Math.pow(k, 1.25);
      z = lerp(z, D(y) * 0.95, smooth(0, 0.55, k));
    }
    out.set(x, y, z); return out;
  };
  // arc-length tables for front/back halves at chest height
  const mk = (a0, a1) => {
    const n = 400, L = [0], t = V(), pr = V(); sec(a0, 0.3, pr);
    for (let i = 1; i <= n; i++) { sec(lerp(a0, a1, i / n), 0.3, t); L.push(L[i - 1] + Math.hypot(t.x - pr.x, t.z - pr.z)); pr.copy(t); }
    const tot = L[n];
    return { tot, f: f => { const target = f * tot; let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] < target) lo = m; else hi = m; } const fr2 = (target - L[lo]) / ((L[hi] - L[lo]) || 1); return lerp(a0, a1, (lo + fr2) / n); } };
  };
  const front = mk(-PI / 2, PI / 2), back = mk(PI / 2, 1.5 * PI);
  const theta = u => (u <= 0.5 ? front.f(u * 2) : back.f((u - 0.5) * 2));
  const frontZ = (x, y) => { const w = W(y), s = clamp(x / w, -1, 1); const sn = spow(s, 1.25); const c = Math.sqrt(Math.max(0, 1 - sn * sn)); return D(y) * Math.pow(c, 0.8); };
  return { W, D, ys, sec, neck, theta, frontZ, Lf: front.tot, Lb: back.tot, tank, hood };
}

function torsoBody(M) {
  const R1 = 56, R2 = 18, nv = R1 + R2, nu = 112;
  const S = V(), N = V();
  return grid(nu, nv, (u, v, t) => {
    const j = Math.round(v * nv);
    const th = M.theta(u);
    M.neck(th, N);
    const yT = Math.min(M.ys, N.y - 0.1);
    let y, fold = 0, x, z;
    if (j <= R1) {
      const f = j / R1;
      y = HEM + (yT - HEM) * f;
      y += 0.03 * Math.sin(th * 3 + 0.7) * Math.pow(1 - f, 6);
      M.sec(th, y, S); x = S.x; z = S.z;
      const low = 1 - smooth(-1.25, 0.1, y);
      fold = 0.014 * Math.sin(th * 7 + 0.4 + y * 0.8) * low + 0.006 * Math.sin(th * 13 - y * 3) * low
        + (M.hood ? 0.04 * Math.exp(-Math.pow((y + 0.98) / 0.12, 2)) * (1 + 0.3 * Math.sin(th * 9)) : 0)
        + 0.008 * Math.sin(th * 4 + y * 5) * smooth(0.0, 0.7, y) * (1 - smooth(0.7, 0.86, y));
    } else {
      const f = (j - R1) / R2;
      M.sec(th, yT, S);
      const e = 1 - Math.cos(f * PI / 2);
      x = lerp(S.x, N.x, e); z = lerp(S.z, N.z, e); y = yT + (N.y - yT) * Math.sin(f * PI / 2);
    }
    if (fold) { const w = M.W(y), dd = M.D(y); let nx = x / (w * w), nz = z / (dd * dd); const l = Math.hypot(nx, nz) || 1; x += nx / l * fold; z += nz / l * fold; }
    t.set(x, y, z);
    return [u, (y - HEM) / (YTOP - HEM)];
  }, { outward: (u, v, p) => V(p.x, 0, p.z + 0.04) });
}

function sleeveModel(side, kind) {
  const long = kind === 'long' || kind === 'hoodie';
  const a = long ? 1.2 : 0.78;
  const root = V(side * 0.64, 0.62, -0.02);
  const dir = V(side * Math.cos(a), -Math.sin(a), 0);
  const e1 = V(side * Math.sin(a), Math.cos(a), 0), e2 = V(0, 0, 1);
  const L = long ? 1.82 : 0.8;
  const r1 = long ? [0.37, 0.165] : [0.37, 0.285], r2 = long ? [0.31, 0.155] : [0.31, 0.245];
  const at = (s, ph, out) => {
    const k = smooth(0, 1, s);
    const bunch = long ? 1 + 0.035 * Math.sin(s * 34 + Math.sin(ph * 2) * 1.5) * smooth(0.62, 0.9, s) * (1 - smooth(0.93, 0.99, s)) : 1;
    const w1 = lerp(r1[0], r1[1], k) * (1 + 0.025 * Math.sin(ph * 3 + s * 9) * (1 - s)) * bunch, w2 = lerp(r2[0], r2[1], k) * bunch;
    return out.copy(root).addScaledVector(dir, s * L).addScaledVector(e1, Math.cos(ph) * w1).addScaledVector(e2, Math.sin(ph) * w2);
  };
  return { root, dir, e1, e2, L, r1, r2, at, side, long };
}
function sleeveGeo(S) {
  return grid(48, 36, (u, v, t) => { S.at(v, u * TAU, t); return [u, v]; },
    { outward: (u, v, p) => p.clone().sub(S.root.clone().addScaledVector(S.dir, v * S.L)) });
}
function sleeveCuff(S, width, thick, ribs) {
  const end = S.root.clone().addScaledVector(S.dir, S.L - width * 0.45);
  return loopBand(a => {
    const ph = a * TAU;
    const p = end.clone().addScaledVector(S.e1, Math.cos(ph) * S.r1[1]).addScaledVector(S.e2, Math.sin(ph) * S.r2[1]);
    const out = S.e1.clone().multiplyScalar(Math.cos(ph) / S.r1[1]).addScaledVector(S.e2, Math.sin(ph) / S.r2[1]).normalize();
    return { p, out, ax: S.dir };
  }, { width, thick, ribs, ribAmp: ribs ? 0.008 : 0, seg: 96 });
}

function buildTorso(item, d, kind) {
  item.fabric = true;
  const collar = d.collar;
  const key = 'torso|' + kind + '|' + (kind === 'tank' || kind === 'hoodie' ? 'crew' : collar);
  const G = cached(key, () => {
    const M = torsoModel(kind, collar);
    const out = { M, body: torsoBody(M) };
    if (kind !== 'tank') {
      out.sl = [-1, 1].map(s => sleeveModel(s, kind === 'jersey' ? 'short' : kind));
      out.sleeves = out.sl.map(sleeveGeo);
      const rib = kind !== 'short' && kind !== 'jersey';
      out.cuffs = out.sl.map(s => sleeveCuff(s, rib ? 0.2 : 0.075, rib ? 0.045 : 0.03, rib ? 40 : 0));
    }
    // hem band
    const hemW = kind === 'hoodie' ? 0.24 : 0.06;
    out.hem = loopBand(a => {
      const th = a * TAU, s = M.sec(th, HEM, V());
      const y = HEM + 0.03 * Math.sin(th * 3 + 0.7) + (kind === 'hoodie' ? hemW * 0.42 : 0.012);
      const w = M.W(HEM), dd = M.D(HEM); const out2 = V(s.x / (w * w), 0, s.z / (dd * dd)).normalize();
      return { p: V(s.x, y, s.z), out: out2, ax: V(0, 1, 0) };
    }, { width: hemW, thick: kind === 'hoodie' ? 0.05 : 0.022, ribs: kind === 'hoodie' ? 110 : 0, ribAmp: 0.008, seg: 160 });
    // collar
    out.collar = loopBand(a => {
      const th = a * TAU, n = M.neck(th, V());
      const o2 = V(n.x, 0, n.z + 0.045 - (collar === 'v' ? 0.02 : 0)).normalize();
      // the rib band lies on the shoulder slope (leaning out and down) instead of standing up like a tube
      const lean = kind === 'tank' ? 0.45 : 0.62;
      return { p: n, out: o2.clone().multiplyScalar(Math.cos(lean)).add(V(0, Math.sin(lean), 0)).normalize(), ax: o2.clone().multiplyScalar(Math.sin(lean)).add(V(0, -Math.cos(lean), 0)).normalize() };
    }, { width: kind === 'tank' ? 0.07 : 0.085, thick: 0.034, axOff: 0.022, seg: 160, ribs: kind === 'hoodie' ? 0 : 60, ribAmp: 0.003, inset: 0.45 });
    if (kind === 'tank') {
      out.arm = [-1, 1].map(side => {
        const pts = [];
        for (let i = 0; i <= 40; i++) {
          const y = lerp(0.36, M.ys + 0.02, i / 40);
          pts.push(V(side * (M.W(y) + 0.005), y, 0));
        }
        // binding runs down the side edge and over the shoulder
        const frontPts = [], backPts = [];
        for (let i = 0; i <= 12; i++) {
          const f = i / 12, y = lerp(0.3, M.ys - 0.02, f);
          const w = M.W(y) * lerp(0.98, 0.95, f);
          frontPts.push(V(side * w, y, M.D(y) * lerp(0.15, 0.6, f * f)));
          backPts.unshift(V(side * w, y, -M.D(y) * 0.93 * lerp(0.15, 0.6, f * f)));
        }
        const sideTop = M.sec(side > 0 ? PI / 2 : -PI / 2, M.ys, V());
        const top = V(side * (Math.abs(sideTop.x) - 0.03), M.ys + 0.06, -0.03);
        return tube([...backPts, top, ...frontPts.reverse()], { radius: 0.035, closed: true, seg: 90, radial: 10 });
      });
    }
    if (collar === 'polo' && kind === 'jersey' || collar === 'polo' && kind === 'long') {
      // folded collar flap around back and sides
      const n0 = V();
      out.flap = grid(80, 10, (u, v, t) => {
        const th = lerp(0.3, TAU - 0.3, u);
        M.neck(th, n0);
        const front = Math.pow(Math.max(0, Math.cos(th)), 2);
        const o2 = V(n0.x, 0, n0.z + 0.045).normalize();
        const len = 0.17 + 0.08 * front;
        const b = v;
        t.copy(n0).addScaledVector(V(0, 1, 0), 0.075 + 0.01 * Math.sin(b * PI) - 0.09 * b * b - len * 0.55 * b)
          .addScaledVector(o2, 0.03 + Math.sin(b * PI * 0.6) * len * 0.75);
        return [u, v];
      }, { outward: (u, v, p) => V(p.x, 0.6, p.z + 0.04) });
      const edge = [];
      for (let i = 0; i <= 40; i++) { const u = i / 40, th = lerp(0.3, TAU - 0.3, u); M.neck(th, n0); const front = Math.pow(Math.max(0, Math.cos(th)), 2); const o2 = V(n0.x, 0, n0.z + 0.045).normalize(); const len = 0.17 + 0.08 * front; edge.push(n0.clone().addScaledVector(V(0, 1, 0), 0.075 - 0.09 - len * 0.55).addScaledVector(o2, 0.03 + Math.sin(PI * 0.6) * len * 0.75)); }
      out.flapEdge = tube(edge, { radius: 0.014, seg: 120, radial: 6 });
      const fy = M.neck(0, V()).y;
      const pl = new THREE.BoxGeometry(0.15, 0.36, 0.03, 1, 1, 1); pl.translate(0, fy - 0.18, M.frontZ(0, fy - 0.18) + 0.005);
      pl.rotateX(0);
      const btns = [0.1, 0.24].map(dy => { const b = new THREE.CylinderGeometry(0.028, 0.028, 0.025, 16); b.rotateX(PI / 2); b.translate(0, fy - dy - 0.02, M.frontZ(0, fy - dy) + 0.03); return b; });
      out.placket = pl; out.buttons = mergeGeos(btns);
    }
    if (kind === 'hoodie') {
      // hood up on a ghost form: two halves lofted from the face-opening rim back to the centre seam,
      // their lower edges sewn onto the neckline. The face opening shows the darker lining inside.
      const Hc = V(0, 1.38, -0.11), RAD = V(0.41, 0.43, 0.42);
      const seam = s => { const ps = lerp(-0.95, 2.2, s); return V(0, Hc.y + RAD.y * Math.sin(ps), Hc.z - RAD.z * Math.cos(ps)); };
      const top = seam(1), nk0 = M.neck(0, V());
      const rimPt = (s, side, out = V()) => { // oval face opening, closing to a crossover at the chin
        const b = s * PI, k = (1 - Math.cos(b)) / 2;
        return out.set(side * 0.27 * Math.pow(Math.sin(b), 0.8) * (1 - 0.18 * s), lerp(nk0.y - 0.012, top.y, k), lerp(nk0.z + 0.04, top.z, k) + 0.08 * Math.sin(b));
      };
      const toN = p => V((p.x - Hc.x) / RAD.x, (p.y - Hc.y) / RAD.y, (p.z - Hc.z) / RAD.z);
      const hoodPt = (s, v, side, out) => {
        const a = toN(rimPt(s, side)), b = toN(seam(s));
        const la = a.length(), lb = b.length(); a.normalize(); b.normalize();
        const om = Math.acos(clamp(a.dot(b), -1, 1)), so = Math.sin(om);
        const d = so < 1e-4 ? a : a.multiplyScalar(Math.sin((1 - v) * om) / so).addScaledVector(b, Math.sin(v * om) / so);
        const puff = 1 + 0.08 * Math.sin(v * PI) * Math.pow(Math.sin(s * PI), 0.6) + 0.012 * Math.sin(v * 7 + s * 11) * Math.sin(v * PI);
        const r = lerp(la, lb, v) * puff;
        out.set(Hc.x + d.x * RAD.x * r, Hc.y + d.y * RAD.y * r, Hc.z + d.z * RAD.z * r);
        // lower edge sits on the neckline
        const w = 1 - smooth(0, 0.42, s);
        if (w > 0) {
          const nb = M.neck(side * lerp(0.03, PI, v), V()); nb.x *= 1.03; nb.z = (nb.z - M.neck(PI / 2, V()).z) * 1.03 + M.neck(PI / 2, V()).z;
          const a0 = toN(rimPt(0, side)), b0 = toN(seam(0)), la0 = a0.length(), lb0 = b0.length(); a0.normalize(); b0.normalize();
          const om0 = Math.acos(clamp(a0.dot(b0), -1, 1)), so0 = Math.sin(om0);
          const d0 = a0.multiplyScalar(Math.sin((1 - v) * om0) / so0).addScaledVector(b0, Math.sin(v * om0) / so0), r0 = lerp(la0, lb0, v);
          out.x += (nb.x - (Hc.x + d0.x * RAD.x * r0)) * w; out.y += (nb.y - (Hc.y + d0.y * RAD.y * r0)) * w; out.z += (nb.z - (Hc.z + d0.z * RAD.z * r0)) * w;
        }
        return out;
      };
      const halves = [-1, 1].map(side => grid(44, 30, (u, v, t) => { hoodPt(u, v, side, t); return [u, v]; }, { outward: (u, v, p) => p.clone().sub(Hc) }));
      out.hood = mergeGeos(halves); halves.forEach(g => g.dispose()); weldNormals(out.hood);
      const edgePts = [];
      for (let i = 0; i <= 60; i++) edgePts.push(rimPt(i / 60, -1).addScaledVector(V(0, 0, 1), 0.004));
      for (let i = 59; i >= 0; i--) edgePts.push(rimPt(i / 60, 1).addScaledVector(V(0, 0, 1), 0.004));
      out.hoodRim = tube(edgePts, { radius: 0.024, seg: 240, radial: 10 });
      out.pouch = null;
      // kangaroo pocket: slanted hand openings, soft bulge (uses the body texture so the print continues across it)
      const pk = (u, v, t) => {
        const y = lerp(-1.0, -0.38, v);
        const hw = lerp(0.6, 0.4, Math.pow(v, 0.9));
        const x = (u * 2 - 1) * hw;
        const bul = 0.014 + 0.032 * Math.sin(u * PI) * Math.pow(Math.sin(v * PI), 0.7) + 0.006 * Math.sin(u * 9 + v * 4) * Math.sin(v * PI);
        t.set(x, y, M.frontZ(x, y) + bul);
        return [0.25 + x / (2 * M.Lf), (y - HEM) / (YTOP - HEM)];
      };
      out.pocket = grid(40, 24, pk, { outward: () => V(0, 0, 1) });
      out.pocketEdge = [0, 1].map(s => {
        const pts = [];
        for (let i = 0; i <= 20; i++) { const t = V(); pk(s, i / 20, t); t.z += 0.006; pts.push(t); }
        return tube(pts, { radius: 0.016, seg: 40, radial: 6 });
      });
      // drawstrings from the eyelets at the lower face opening, hanging over the chest, with metal aglets
      out.eyelets = mergeGeos([-1, 1].map(s => {
        const p = rimPt(0.13, s).add(V(-s * 0.012, -0.03, 0.03)), g = new THREE.TorusGeometry(0.018, 0.006, 8, 16);
        placeGeo(g, p, V(0, 0.15, 1).normalize()); return g;
      }));
      const ends = [];
      out.strings = [-1, 1].map(s => {
        const top2 = rimPt(0.13, s).add(V(-s * 0.012, -0.03, 0.03));
        const pts = [top2];
        const len = s < 0 ? 0.36 : 0.42;
        for (let i = 1; i <= 10; i++) {
          const f = i / 10, y = lerp(top2.y - 0.05, len, f), x = lerp(top2.x, s * (0.11 + 0.03 * f), f);
          pts.push(V(x, y, M.frontZ(x, Math.min(y, M.ys)) + 0.03 + 0.03 * Math.sin(f * PI) * (1 - f * 0.5)));
        }
        ends.push(pts[pts.length - 1]);
        return tube(pts, { radius: 0.014, seg: 48, radial: 8, flat: 0.7 });
      });
      out.aglets = ends.map(p => { const g = new THREE.CylinderGeometry(0.018, 0.016, 0.07, 12); g.translate(p.x, p.y - 0.03, p.z); return g; });
    }
    return out;
  });
  const M = G.M;
  // canvases
  const CW = 2048, CH = Math.round(CW / 2 / M.Lf * (YTOP - HEM));
  const bodyC = item.canvas(CW, CH), printC = item.canvas(CW, CH);
  const bodyT = item.tex(bodyC), printT = item.tex(printC);
  const body = kind === 'hoodie' ? item.fabricMat(bodyT, { normal: 'fuzz', rx: 40, ry: 20, ns: 0.18, rough: 0.92 }) : item.fabricMat(bodyT, { rx: 60, ry: 30 });
  const lining = item.liningMat('#333333');
  item.add(G.body, body); item.add(G.body, lining);
  const pr = item.printMat(printT); const prMesh = item.add(G.body, pr); prMesh.renderOrder = 2;
  const trim = item.fabricMat(null, { normal: kind === 'hoodie' ? 'rib' : 'knit', rx: 30, ry: 2, ns: 0.6 });
  if (G.sleeves) {
    const slC = item.canvas(512, 512), slT = item.tex(slC);
    const slM = item.fabricMat(slT, { rx: 20, ry: 14 });
    G.sleeves.forEach(g => { item.add(g, slM); item.add(g, lining); });
    const cuffM = item.fabricMat(null, { normal: kind === 'jersey' ? 'knit' : 'rib', rx: 30, ry: 2, ns: 0.6 });
    G.cuffs.forEach(g => item.add(g, cuffM));
    item.painters.push(d2 => {
      const ctx = slC.getContext('2d'), w = slC.width, h = slC.height;
      const dd = { ...d2, primary: d2.sleeve };
      const pat = ['stripes', 'pinstripe', 'hoops', 'camo', 'hex', 'halftone'].includes(d2.pattern) ? d2.pattern : 'solid';
      paintPattern(ctx, 0, 0, w, h, dd, { unit: w / 1.6, pattern: pat });
      if (kind === 'jersey') { ctx.fillStyle = d2.accent; ctx.fillRect(0, h * 0.04, w, h * 0.03); ctx.fillStyle = d2.secondary; ctx.fillRect(0, h * 0.09, w, h * 0.02); }
      cuffM.color.set(kind === 'jersey' ? d2.secondary : d2.sleeve);
      cuffM.sheenColor.set(shade(cuffM.color.getStyle ? '#' + cuffM.color.getHexString() : d2.secondary, 0.3)).multiplyScalar(0.4);
      slM.sheenColor.set(shade(d2.sleeve, 0.12)).multiplyScalar(0.5);
    });
  }
  item.add(G.hem, trim);
  const collarM = item.fabricMat(null, { normal: 'rib', rx: 40, ry: 1, ns: 0.5 });
  if (kind !== 'hoodie') item.add(G.collar, collarM);
  if (G.arm) G.arm.forEach(g => item.add(g, collarM));
  if (G.flap) {
    const flapM = item.fabricMat(null, { side: THREE.DoubleSide, normal: 'knit', rx: 16, ry: 3, ns: 0.3 });
    item.add(G.flap, flapM); item.add(G.flapEdge, flapM);
    item.add(G.placket, collarM);
    const btnM = item.mat({ color: 0xf4f5f7, roughness: 0.25, clearcoat: 1 }, {});
    item.add(G.buttons, btnM);
    item.painters.push(d2 => { flapM.color.set(d2.secondary); });
  }
  if (G.hood) {
    const hoodM = item.fabricMat(null, { normal: 'fuzz', rx: 30, ry: 8, ns: 0.18, rough: 0.92 });
    item.add(G.hood, hoodM); if (G.pouch) item.add(G.pouch, hoodM);
    const hoodLin = item.liningMat('#222'); item.add(G.hood, hoodLin);
    item.add(G.hoodRim, collarM);
    item.add(G.pocket, body); G.pocketEdge.forEach(g => item.add(g, collarM));
    const strM = item.mat({ color: 0xffffff, roughness: 0.7, sheen: 0.8, sheenColor: new THREE.Color(0.4, 0.4, 0.4) }, { wind: 0.012 });
    G.strings.forEach(g => item.add(g, strM));
    const agM = item.mat({ color: 0xcfd3da, metalness: 1, roughness: 0.25 }, {});
    G.aglets.forEach(g => item.add(g, agM));
    if (G.eyelets) item.add(G.eyelets, agM);
    item.painters.push(d2 => {
      hoodM.color.set(d2.primary); hoodLin.color.set(shade(mix(d2.primary, d2.secondary, 0.3), -0.45));
      hoodLin.sheenColor.set(shade(d2.secondary, 0.4)).multiplyScalar(0.3);
      strM.color.set(lum(d2.accent) > 0.3 ? d2.accent : '#f4f5f7'); trim.color.set(d2.primary);
      [hoodM, trim].forEach(m => m.sheenColor.set(shade(d2.primary, 0.5)).multiplyScalar(0.55));
    });
  }
  if (kind === 'tank') item.fit = 1.02; // tall and narrow: frame on the true bounding sphere so the hem is never cropped
  // patch anchor
  if (G.sl) {
    const S = G.sl[1], ph = 1.25, s = 0.42;
    const pos = S.at(s, ph, V()), p2 = S.at(s, ph + 0.05, V()), p3 = S.at(s + 0.05, ph, V());
    const n = p2.clone().sub(pos).cross(p3.clone().sub(pos)).normalize();
    if (n.dot(pos.clone().sub(S.root.clone().addScaledVector(S.dir, s * S.L))) < 0) n.negate();
    makePatchUpdater(item, { pos: pos.addScaledVector(n, 0.012), normal: n, up: S.dir.clone().negate() }, kind === 'jersey' ? 0.1 : 0.11);
  } else {
    const y = 0.5, x = 0.42; const z = M.frontZ(x, y);
    const n = V(x / (M.W(y) ** 2) * 0.6, 0, z / (M.D(y) ** 2)).normalize();
    makePatchUpdater(item, { pos: V(x, y, z + 0.012), normal: n, up: V(0, 1, 0) }, 0.1);
  }
  // painters
  item.painters.push(d2 => {
    const ctx = bodyC.getContext('2d'), w = bodyC.width, h = bodyC.height;
    const pxu = w / 2 / M.Lf;
    paintPattern(ctx, 0, 0, w / 2, h, d2, { unit: pxu, seed: 3 });
    paintPattern(ctx, w / 2, 0, w / 2, h, d2, { unit: pxu, mirror: true, seed: 5 });
    // side panels
    if (kind !== 'hoodie') {
      const sw = 0.13 * pxu;
      for (const x of [0, w / 2, w]) {
        ctx.fillStyle = d2.secondary; ctx.fillRect(x - sw, h * 0.3, sw * 2, h);
        ctx.fillStyle = d2.accent; ctx.fillRect(x - sw - pxu * 0.012, h * 0.3, pxu * 0.012, h); ctx.fillRect(x + sw, h * 0.3, pxu * 0.012, h);
      }
    }
    const yy = y => (YTOP - y) / (YTOP - HEM) * h;
    // subtle seams
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, yy(HEM + 0.05), w, 2 * item.q);
    if (kind === 'hoodie') { // kangaroo pocket: shaded hand openings and top-stitching (the pocket panel samples this canvas)
      const PX = x => (0.25 + x / (2 * M.Lf)) * w;
      for (const sg of [-1, 1]) {
        const g = ctx.createLinearGradient(PX(sg * 0.6), 0, PX(sg * 0.47), 0);
        g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(PX(sg * 0.6), yy(-1.0)); ctx.lineTo(PX(sg * 0.4), yy(-0.38)); ctx.lineTo(PX(sg * 0.3), yy(-0.38)); ctx.lineTo(PX(sg * 0.5), yy(-1.0)); ctx.closePath(); ctx.fill();
      }
      ctx.save(); ctx.setLineDash([pxu * 0.025, pxu * 0.018]); ctx.lineWidth = Math.max(1, pxu * 0.006);
      ctx.strokeStyle = lum(d2.primary) > 0.45 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.moveTo(PX(-0.36), yy(-0.405)); ctx.lineTo(PX(0.36), yy(-0.405));
      ctx.moveTo(PX(-0.555), yy(-0.98)); ctx.lineTo(PX(-0.37), yy(-0.41)); ctx.moveTo(PX(0.555), yy(-0.98)); ctx.lineTo(PX(0.37), yy(-0.41)); ctx.stroke();
      const g2 = ctx.createLinearGradient(0, yy(-0.36), 0, yy(-0.44)); g2.addColorStop(0, 'rgba(0,0,0,0.22)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2; ctx.fillRect(PX(-0.42), yy(-0.36), PX(0.42) - PX(-0.42), yy(-0.44) - yy(-0.36));
      ctx.restore();
    }
    body.sheenColor.set(shade(d2.primary, 0.12)).multiplyScalar(0.5);
    collarM.color.set(kind === 'hoodie' ? d2.primary : d2.secondary);
    collarM.sheenColor.set(0x444444);
    lining.color.set(shade(d2.primary, -0.55));
    trim.color.set(d2.primary); trim.sheenColor.set(shade(d2.primary, 0.12)).multiplyScalar(0.5);
    // print layer
    const p = printC.getContext('2d');
    p.clearRect(0, 0, w, h);
    const fx = w * 0.25, bx = w * 0.75;
    const tc = d2.textColor;
    if (kind === 'hoodie') {
      drawText(p, d2.chest || d2.text, fx, yy(0.3), 1.0 * pxu, 0.26 * pxu, d2, { color: tc });
    } else {
      const hasChest = !!d2.chest;
      const tk = kind === 'tank' ? -0.16 : 0, vneck = d2.collar === 'v' && kind !== 'tank' ? -0.06 : 0;
      if (hasChest) drawText(p, d2.chest, fx, yy(0.42 + tk + vneck), (kind === 'tank' ? 0.95 : 1.15) * pxu, 0.3 * pxu, d2, { color: tc });
      if (d2.number) drawText(p, d2.number, fx, yy((hasChest ? 0.0 : 0.25) + tk + vneck), 0.6 * pxu, (hasChest ? 0.34 : 0.6) * pxu, d2, { color: tc });
    }
    const hd = kind === 'hoodie';
    if (d2.name) drawText(p, d2.name, bx, yy(hd ? 0.2 : 0.6), 1.2 * pxu, (hd ? 0.2 : 0.22) * pxu, d2, { color: tc, arc: 3.2 * pxu });
    if (d2.number) drawText(p, d2.number, bx, yy(hd ? -0.4 : -0.12), 1.15 * pxu, (hd ? 0.72 : 0.95) * pxu, d2, { color: tc, strokeW: 0.07 });
    if (d2.subtext) drawText(p, d2.subtext, bx, yy(0.85), 0.5 * pxu, 0.06 * pxu, d2, { color: tc, outline: false });
  });
}

/* ------------------------------------------------------------------ */
/* shared helpers for the non-torso products                           */
/* ------------------------------------------------------------------ */
const rgbOf = hex => { const n = parseInt(String(hex).slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }; // sRGB bytes
function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let xf = x - xi, yf = y - yi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
  const a = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), xf), b = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), xf);
  const c = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), xf), e = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), xf);
  return lerp(lerp(a, b, yf), lerp(c, e, yf), zf);
}
// surface finish for solid products (balls, shoes, bottles): applied on top of the material's base values
function applySurfaceFinish(m, f) {
  const b = m.userData.base;
  if (!b) return;
  m.roughness = f === 'gloss' ? b.rough * 0.55 : f === 'metallic' ? Math.min(b.rough, 0.35) : f === 'holo' ? b.rough * 0.6 : b.rough;
  m.metalness = f === 'metallic' ? Math.max(b.metal || 0, 0.45) : (b.metal || 0);
  m.clearcoat = f === 'gloss' || f === 'holo' ? 1 : (b.coat || 0);
  m.clearcoatRoughness = f === 'gloss' ? 0.04 : (b.coatRough != null ? b.coatRough : 0.12);
  m.iridescence = f === 'holo' ? 0.75 : 0;
  m.iridescenceIOR = 1.5; m.iridescenceThicknessRange = [200, 600];
  if (m.userData.finish !== f) { m.userData.finish = f; m.needsUpdate = true; }
}
// tiny rounded capsule (for stitches, lace segments, studs...) along +X, length L, radius r
function capsuleGeo(L, r, seg = 8, rad = 8, flat = 1) {
  return grid(rad, seg * 2, (u, v, t) => {
    const s = v * 2 - 1, a = u * TAU;
    const x = s * (L / 2 + r * 0.0), k = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(s), 6)));
    t.set(x, Math.cos(a) * r * k * flat, Math.sin(a) * r * k);
    return [u, v];
  }, { outward: (u, v, p) => V(0, p.y, p.z) });
}
// surface of revolution around Y: prof(v) -> [r, y]; rx/rz scale the section; mod(u,v)-> radial multiplier
function lathe(nu, nv, prof, o = {}) {
  return grid(nu, nv, (u, v, t) => {
    const [r, y] = prof(v), a = u * TAU + (o.a0 || 0), k = o.mod ? o.mod(u, v) : 1;
    t.set(Math.sin(a) * r * k * (o.rx || 1), y, Math.cos(a) * r * k * (o.rz || 1));
    return [u, o.vmap ? o.vmap(v, y) : v];
  }, { outward: o.outward || ((u, v, p) => V(p.x, o.outY ? o.outY(v) : 0, p.z)) });
}
// parallel-transport frames along a polyline (smooth, no flips), up hint fixes the initial normal
function pathFrames(pts, up) {
  const n = pts.length, T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.push(b.clone().sub(a).normalize());
  }
  let nn = (up || V(0, 1, 0)).clone(); nn.sub(T[0].clone().multiplyScalar(nn.dot(T[0]))).normalize();
  for (let i = 0; i < n; i++) {
    if (i) { const q = new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i]); nn.applyQuaternion(q); nn.sub(T[i].clone().multiplyScalar(nn.dot(T[i]))).normalize(); }
    N.push(nn.clone()); B.push(T[i].clone().cross(nn).normalize());
  }
  return { T, N, B };
}
// sweep a section along a smooth curve. sec(v, a) -> [nOffset, bOffset] (local 2D offsets); returns grid with uv (u around, v along)
function sweep(ctrl, nu, nv, sec, o = {}) {
  const curve = new THREE.CatmullRomCurve3(ctrl, !!o.closed, 'centripetal');
  const pts = []; for (let j = 0; j <= nv; j++) pts.push(curve.getPointAt(j / nv));
  const F = pathFrames(pts, o.up);
  return grid(nu, nv, (u, v, t) => {
    const j = Math.round(v * nv), [a, b] = sec(v, u * TAU, j);
    t.copy(pts[j]).addScaledVector(F.N[j], a).addScaledVector(F.B[j], b);
    return [u, v];
  }, { outward: (u, v, p) => p.clone().sub(pts[Math.round(v * nv)]) });
}

/* ------------------------------------------------------------------ */
/* BALLS: equal-angle cube sphere with per-texel baked atlas maps      */
/* ------------------------------------------------------------------ */
const CF = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
const BALL_M = 6; // tile margin in px (keeps mip filtering inside a face)
function cubeDir(f, a, b, out) {
  const [n, u, v] = CF[f], ta = Math.tan(a * PI / 4), tb = Math.tan(b * PI / 4);
  const x = n[0] + ta * u[0] + tb * v[0], y = n[1] + ta * u[1] + tb * v[1], z = n[2] + ta * u[2] + tb * v[2];
  const l = Math.hypot(x, y, z); out[0] = x / l; out[1] = y / l; out[2] = z / l; return out;
}
function atlasUV(S, f, a, b) {
  const I = S - 2 * BALL_M, ox = (f % 3) * S, oy = Math.floor(f / 3) * S;
  return [(ox + BALL_M + (a + 1) / 2 * I) / (3 * S), 1 - (oy + BALL_M + (1 - b) / 2 * I) / (2 * S)];
}
// orthonormal frame mapping model space to the ball's design space: anchor -> +Z, up -> +Y
function ballFrame(anchor, up) {
  const z = V(...anchor).normalize(), y = V(...up); y.sub(z.clone().multiplyScalar(y.dot(z))).normalize();
  const x = y.clone().cross(z);
  return (p, q) => { q[0] = p[0] * x.x + p[1] * y.x + p[2] * z.x; q[1] = p[0] * x.y + p[1] * y.y + p[2] * z.y; q[2] = p[0] * x.z + p[1] * y.z + p[2] * z.z; return q; };
}
const EMAX = 0.3;

// soccer: truncated icosahedron, classified by face planes (pentagons a touch further out than hexagons)
const SOCCER = (() => {
  const ph = (1 + Math.sqrt(5)) / 2, raw = [];
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) raw.push([0, s1, s2 * ph], [s1, s2 * ph, 0], [s2 * ph, 0, s1]);
  const vs = raw.map(v => V(...v).normalize());
  const hex = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++)
    if (vs[i].dot(vs[j]) > 0.4 && vs[j].dot(vs[k]) > 0.4 && vs[i].dot(vs[k]) > 0.4) hex.push(vs[i].clone().add(vs[j]).add(vs[k]).normalize());
  const hp = 1.5516, hh = 1.5115;
  const faces = [...vs.map(n => ({ n, w: 1 / hp, pent: 1 })), ...hex.map(n => ({ n, w: 1 / hh, pent: 0 }))];
  return { faces, front: hex[0], up: vs.find(v => v.dot(hex[0]) > 0.6) };
})();

const BALLS = {
  'ball-soccer': {
    frame: () => ballFrame(SOCCER.front.toArray(), SOCCER.up.toArray()),
    cls(q, o) {
      let b = -9, s = -9, bi = 0, si = 0, pd = 9;
      const F = SOCCER.faces;
      for (let i = 0; i < 32; i++) {
        const n = F[i].n, dt = q[0] * n.x + q[1] * n.y + q[2] * n.z, sc = dt * F[i].w;
        if (sc > b) { s = b; si = bi; b = sc; bi = i; } else if (sc > s) { s = sc; si = i; }
        if (i < 12) pd = Math.min(pd, Math.acos(clamp(dt, -1, 1)));
      }
      const nb = F[bi], ns = F[si];
      const gx = nb.n.x * nb.w - ns.n.x * ns.w, gy = nb.n.y * nb.w - ns.n.y * ns.w, gz = nb.n.z * nb.w - ns.n.z * ns.w;
      o.id = nb.pent; o.e = (b - s) / Math.hypot(gx, gy, gz); o.x = pd / 0.8;
    },
    seam: 0.016, depth: 0.016, puff: 0.02, puffW: 0.16, rough: 0.38, coat: 0.7, detail: 'fine',
    color(d) {
      const P = rgbOf(d.primary), S = rgbOf(d.secondary), A = rgbOf(d.accent);
      return (id, x) => (id === 1 ? S : (x > 0.39 && x < 0.47 ? A : P));
    },
    text: { color: d => d.secondary, y: 0.02, h: 0.16, w: 0.62 },
  },
  'ball-basketball': {
    // classic view: centre meridian just left of the logo panel, equator below it, side curve to the right
    frame: () => ballFrame([Math.sin(0.36), Math.sin(0.3), Math.cos(0.36) * Math.cos(0.3)], [0, 1, 0]),
    cls(q, o) {
      const ph = Math.atan2(q[1], q[2]), s = Math.sin(ph);
      const al = 0.78 + 0.5 * s * s;
      const ax = Math.acos(clamp(Math.abs(q[0]), -1, 1));
      o.e = Math.min(Math.abs(Math.asin(q[1])), Math.abs(Math.asin(q[0])), Math.abs(ax - al) * 0.92);
      o.id = 0; o.x = 0;
    },
    seam: 0.034, depth: 0.02, puff: 0.0, puffW: 0.1, rough: 0.62, coat: 0.12, detail: 'pebble', groove: true,
    color(d) { const P = rgbOf(d.primary); return () => P; },
    seamColor: d => d.secondary,
    text: { color: d => d.secondary, y: 0.0, h: 0.16, w: 0.44 },
  },
  'ball-volleyball': {
    frame: () => (p, q) => { q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; return q; },
    cls(q, o) {
      const ax = [Math.abs(q[0]), Math.abs(q[1]), Math.abs(q[2])];
      const k = ax[0] > ax[1] ? (ax[0] > ax[2] ? 0 : 2) : (ax[1] > ax[2] ? 1 : 2);
      const dv = (k + 2) % 3, ot = (k + 1) % 3;
      const c = Math.atan2(q[dv], ax[k]), c2 = Math.atan2(q[ot], ax[k]);
      const st = c < -PI / 12 ? 0 : c > PI / 12 ? 2 : 1;
      const cs = Math.cos(c2);
      o.e = Math.min((PI / 4 - Math.abs(c)) * cs, (PI / 4 - Math.abs(c2)) * Math.cos(c), Math.abs(Math.abs(c) - PI / 12) * cs);
      o.id = k * 3 + st; o.x = 0;
    },
    seam: 0.01, depth: 0.012, puff: 0.014, puffW: 0.12, rough: 0.4, coat: 0.55, detail: 'fine',
    color(d) {
      const P = rgbOf(d.primary), S = rgbOf(d.secondary), A = rgbOf(d.accent);
      return id => { const k = Math.floor(id / 3), st = id % 3; return st === 1 ? P : (k === 1 ? A : (st === 0 ? S : (k === 0 ? A : S))); };
    },
    text: { color: d => d.accent, y: 0, h: 0.2, w: 0.9, onStrip: true },
  },
  'ball-baseball': {
    curve: (() => {
      const b = 0.3, c = 2 * Math.sqrt(b * (1 - b)), pts = [];
      for (let i = 0; i < 240; i++) {
        const t = i / 240 * TAU;
        pts.push(V((1 - b) * Math.cos(t) + b * Math.cos(3 * t), (1 - b) * Math.sin(t) - b * Math.sin(3 * t), c * Math.sin(2 * t)).normalize());
      }
      return pts;
    })(),
    frame: () => ballFrame([0.0, 0, 1], [1, 0, 0]),
    cls(q, o) {
      const C = this.curve; let bd = -2, bi = 0;
      for (let i = 0; i < 240; i += 8) { const d = q[0] * C[i].x + q[1] * C[i].y + q[2] * C[i].z; if (d > bd) { bd = d; bi = i; } }
      for (let i = bi - 8; i <= bi + 8; i++) { const p = C[(i + 240) % 240]; const d = q[0] * p.x + q[1] * p.y + q[2] * p.z; if (d > bd) bd = d; }
      o.e = Math.acos(clamp(bd, -1, 1)); o.id = 0; o.x = 0;
    },
    seam: 0.03, depth: 0.014, puff: 0.006, puffW: 0.12, rough: 0.55, coat: 0.2, detail: 'leather',
    color(d) { const P = rgbOf(d.primary); return () => P; },
    seamColor: d => shade(d.primary, -0.18),
    text: { color: d => d.accent, y: 0, h: 0.12, w: 0.6 },
  },
  'ball-football': {
    frame: () => (p, q) => { q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; return q; },
    cls(q, o) {
      const phi = Math.atan2(q[2], q[1]), r = Math.hypot(q[1], q[2]);
      const m = ((phi - PI / 4) % (PI / 2) + PI / 2) % (PI / 2);
      o.e = Math.min(m, PI / 2 - m) * r + 0.0001;
      o.id = Math.floor(((phi - PI / 4) / (PI / 2) % 4 + 4) % 4); o.x = q[0];
    },
    seam: 0.012, depth: 0.012, puff: 0.012, puffW: 0.3, rough: 0.58, coat: 0.15, detail: 'pebble',
    color(d) {
      const P = rgbOf(d.primary), S = rgbOf(d.secondary);
      return (id, x) => { const ax = Math.abs(x); return (id === 3 || id === 0) && ax > 0.56 && ax < 0.64 ? S : P; };
    },
    xRange: [-1, 1],
    text: { color: d => d.secondary, y: 0.0, h: 0.2, w: 0.75, sx: 0.62 },
  },
};

// bake: per-texel classification + normal map (design independent, cached per shape and size)
function bakeBall(shape, S) {
  return cached('ballbake|' + shape + '|' + S, () => {
    const K = BALLS[shape], W = 3 * S, H = 2 * S, I = S - 2 * BALL_M;
    const tr = K.frame(), p = [0, 0, 0], q = [0, 0, 0], o = {};
    const id = new Uint8Array(W * H), e = new Uint8Array(W * H), xx = new Uint8Array(W * H), h = new Float32Array(W * H);
    const det = K.detail;
    for (let f = 0; f < 6; f++) {
      const ox = (f % 3) * S, oy = Math.floor(f / 3) * S;
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        const a = ((px + 0.5 - BALL_M) / I) * 2 - 1, b = 1 - ((py + 0.5 - BALL_M) / I) * 2;
        cubeDir(f, a, b, p); tr(p, q); K.cls(q, o);
        const k = (oy + py) * W + ox + px;
        id[k] = o.id; e[k] = Math.round(clamp(o.e / EMAX, 0, 1) * 255);
        xx[k] = Math.round(clamp(K.xRange ? (o.x + 1) / 2 : o.x, 0, 1) * 255);
        // height in radians: seam groove + material detail
        let hh = -K.depth * (1 - smooth(0, K.seam * (K.groove ? 1.15 : 1.6), o.e));
        if (det === 'pebble') { const n = vnoise3(q[0] * 150, q[1] * 150, q[2] * 150); hh += 0.0016 * smooth(0.35, 0.8, n); }
        else if (det === 'leather') hh += 0.0009 * vnoise3(q[0] * 90, q[1] * 90, q[2] * 90) + 0.0005 * vnoise3(q[0] * 260, q[1] * 260, q[2] * 260);
        else hh += 0.00035 * vnoise3(q[0] * 220, q[1] * 220, q[2] * 220);
        h[k] = hh;
      }
    }
    // tangent-space normals per tile (finite differences inside the tile, margins supply neighbours)
    const nc = mkCanvas(W, H), nctx = nc.getContext('2d'), img = nctx.createImageData(W, H), D = img.data;
    const step = (PI / 2) / I;
    for (let f = 0; f < 6; f++) {
      const ox = (f % 3) * S, oy = Math.floor(f / 3) * S;
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        const k = (oy + py) * W + ox + px;
        const xl = h[k - (px > 0 ? 1 : 0)], xr = h[k + (px < S - 1 ? 1 : 0)], yu = h[k - (py > 0 ? W : 0)], yd = h[k + (py < S - 1 ? W : 0)];
        let nx = (xl - xr) / (2 * step), ny = (yd - yu) / (2 * step), nz = 1;
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        D[k * 4] = (nx * 0.5 + 0.5) * 255; D[k * 4 + 1] = (ny * 0.5 + 0.5) * 255; D[k * 4 + 2] = (nz * 0.5 + 0.5) * 255; D[k * 4 + 3] = 255;
      }
    }
    nctx.putImageData(img, 0, 0);
    return { S, W, H, id, e, x: xx, nc, tr };
  });
}
function ballGeoFor(shape, N, S) {
  return cached('ballgeo|' + shape + '|' + N + '|' + S, () => {
    const K = BALLS[shape], tr = K.frame(), p = [0, 0, 0], q = [0, 0, 0], o = {};
    const foot = shape === 'ball-football';
    const faces = CF.map((F, f) => grid(N, N, (u, v, t) => {
      const a = u * 2 - 1, b = v * 2 - 1;
      cubeDir(f, a, b, p); tr(p, q); K.cls(q, o);
      let r = 1 + K.puff * smooth(0, K.puffW, o.e) - (K.groove ? 0.006 * (1 - smooth(0, K.seam * 1.2, o.e)) : 0);
      if (foot) {
        const x = p[0], k = Math.pow(Math.max(0, 1 - x * x), 0.27);
        t.set(x * 1.0 * r, p[1] * 0.6 * k * r, p[2] * 0.6 * k * r);
      } else t.set(p[0] * r, p[1] * r, p[2] * r);
      return atlasUV(S, f, a, b);
    }, { weld: false, outward: (u, v, pp) => pp.clone() }));
    const g = mergeGeos(faces);
    faces.forEach(f => f.dispose());
    weldNormals(g);
    return g;
  });
}
function paintBall(cv, shape, B, d) {
  const K = BALLS[shape], ctx = cv.getContext('2d'), { W, H, S } = B;
  const img = ctx.createImageData(W, H), D = img.data;
  const col = K.color(d), sc = rgbOf(K.seamColor ? K.seamColor(d) : shade(d.secondary === d.primary ? '#000000' : mix(d.primary, '#000000', 0.55), 0));
  const sw = K.seam;
  const lut = new Float32Array(256); for (let i = 0; i < 256; i++) lut[i] = K.groove ? 1 - smooth(sw * 0.82, sw * 1.0, i / 255 * EMAX) : 1 - smooth(sw * 0.25, sw * 0.7, i / 255 * EMAX) * 1;
  for (let k = 0, n = W * H; k < n; k++) {
    const c = col(B.id[k], K.xRange ? B.x[k] / 255 * 2 - 1 : B.x[k] / 255), t = lut[B.e[k]] * (K.groove ? 1 : 0.85);
    D[k * 4] = c[0] + (sc[0] - c[0]) * t; D[k * 4 + 1] = c[1] + (sc[1] - c[1]) * t; D[k * 4 + 2] = c[2] + (sc[2] - c[2]) * t; D[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // front tile print
  const T = K.text, txt = d.text || d.chest || d.name;
  if (T && (txt || d.subtext)) {
    const I = S - 2 * BALL_M, cx = S + BALL_M + I / 2, cy = S + BALL_M + I / 2 - T.y * I;
    ctx.save(); ctx.beginPath(); ctx.rect(S, S, S, S); ctx.clip();
    const color = T.color(d);
    const px = txt ? drawText(ctx, txt, cx, cy, I * T.w, I * T.h, d, { color, sx: T.sx || 1, strokeColor: shade(color, lum(color) > 0.4 ? -0.6 : 0.7) }) : 0;
    if (d.subtext) drawText(ctx, d.subtext.toUpperCase(), cx, cy + Math.max(px, I * 0.1) * 0.85, I * T.w * 0.7, I * 0.045, { ...d, font: 'modern' }, { color, outline: false, sx: T.sx || 1 });
    ctx.restore();
  }
}
function buildBall(item, d) {
  const shape = d.shape, K = BALLS[shape];
  const S = item.q >= 1 ? 512 : 320;
  const B = bakeBall(shape, S);
  const geo = ballGeoFor(shape, item.q >= 1 ? 64 : 52, S);
  const cv = mkCanvas(B.W, B.H), map = item.tex(cv);
  const nt = item.tex(B.nc); nt.colorSpace = THREE.NoColorSpace;
  const m = item.mat({ map, normalMap: nt, normalScale: new THREE.Vector2(1, 1), roughness: K.rough, clearcoat: K.coat, clearcoatRoughness: 0.12, sheen: 0 });
  m.userData.base = { rough: K.rough, coat: K.coat };
  const spin = new THREE.Group(); item.group.add(spin);
  item.add(geo, m, spin);
  if (shape === 'ball-baseball') buildBaseballStitches(item, spin, B);
  if (shape === 'ball-football') buildFootballLaces(item, spin);
  item.spinner = spin;
  item.painters.push(d2 => { paintBall(cv, shape, B, d2); applySurfaceFinish(m, d2.finish); });
  Object.assign(item, { heroYaw: -0.2, yaw: 0, tilt: -0.08, roll: -0.16, elev: 0.14, fit: 1.12 });
  if (shape === 'ball-football') Object.assign(item, { heroYaw: -0.25, tilt: 0.12, roll: 0.18 });
}
function buildBaseballStitches(item, parent, B) {
  const g = cached('bbstitch', () => {
    const K = BALLS['ball-baseball'], inv = (() => { // model = inverse frame: rows -> columns
      const z = V(0, 0, 1), y = V(1, 0, 0); y.sub(z.clone().multiplyScalar(y.dot(z))).normalize(); const x = y.clone().cross(z);
      return c => V(c.x * x.x + c.y * x.y + c.z * x.z, c.x * y.x + c.y * y.y + c.z * y.z, c.x * z.x + c.y * z.y + c.z * z.z);
    })();
    const C = K.curve.map(inv), parts = [], n = 108;
    for (let i = 0; i < n; i++) {
      const f = i / n * C.length, i0 = Math.floor(f), t = f - i0;
      const p = C[i0 % C.length].clone().lerp(C[(i0 + 1) % C.length], t).normalize();
      const tan = C[(i0 + 1) % C.length].clone().sub(C[i0 % C.length]).normalize();
      const side = p.clone().cross(tan).normalize();
      for (const s of [-1, 1]) {
        const c = capsuleGeo(0.085, 0.013, 4, 6, 0.75);
        // V stitch: each leg leans forward along the seam
        const dir = tan.clone().multiplyScalar(0.55).addScaledVector(side, s * 0.85).normalize();
        const mid = p.clone().addScaledVector(side, s * 0.036).addScaledVector(tan, 0.006).normalize().multiplyScalar(1.006);
        const q = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), dir);
        const up = V(0, 1, 0).applyQuaternion(q), want = mid.clone().normalize();
        const ang = Math.atan2(up.clone().cross(want).dot(dir), up.dot(want));
        q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, ang));
        c.applyMatrix4(new THREE.Matrix4().compose(mid, q, V(1, 1, 1)));
        parts.push(c);
      }
    }
    const out = mergeGeos(parts); parts.forEach(p => p.dispose()); return out;
  });
  const m = item.mat({ color: 0xc8202f, roughness: 0.75, sheen: 0.6, sheenColor: new THREE.Color(0.5, 0.2, 0.2) });
  item.add(g, m, parent);
  item.painters.push(d => m.color.set(d.secondary));
}
function buildFootballLaces(item, parent) {
  const g = cached('fblaces', () => {
    const surf = (x, phi, lift) => {
      const r = Math.sqrt(Math.max(0, 1 - x * x)), p = [x, Math.cos(phi) * r, Math.sin(phi) * r];
      const k = Math.pow(Math.max(0, 1 - x * x), 0.27), rr = 1.012 + lift;
      return V(p[0] * rr, p[1] * 0.6 * k * rr, p[2] * 0.6 * k * rr);
    };
    const parts = [], phi0 = PI / 4;
    for (let i = 0; i < 8; i++) {
      const x = lerp(-0.3, 0.3, i / 7);
      const a = surf(x, phi0 - 0.16, 0.0), b = surf(x, phi0 + 0.16, 0.0), mid = surf(x, phi0, 0.012);
      parts.push(tube([a, mid, b], { radius: 0.017, seg: 14, radial: 8, flat: 0.55, up: mid.clone().normalize() }));
    }
    const spine = []; for (let i = 0; i <= 12; i++) spine.push(surf(lerp(-0.36, 0.36, i / 12), phi0, 0.004));
    parts.push(tube(spine, { radius: 0.016, seg: 60, radial: 8, flat: 0.6 }));
    const out = mergeGeos(parts); parts.forEach(p => p.dispose()); return out;
  });
  const m = item.mat({ color: 0xffffff, roughness: 0.6, sheen: 0.5, sheenColor: new THREE.Color(0.4, 0.4, 0.4) });
  item.add(g, m, parent);
  item.painters.push(d => m.color.set(d.accent === d.primary ? '#ffffff' : (lum(d.secondary) > 0.5 ? d.secondary : '#f4f5f7')));
}

/* ------------------------------------------------------------------ */
/* FOOTWEAR: lofted last sections, cut open at the collar              */
/* right shoe, toe along +X, lateral side faces +Z                     */
/* ------------------------------------------------------------------ */
function shoeModel(kind) {
  const sn = kind === 'sneaker';
  const X = s => lerp(-1.25, 1.25, s);
  const Wb = spline(sn ? [[0, 0.31], [0.15, 0.335], [0.42, 0.31], [0.7, 0.41], [0.86, 0.375], [1, 0.28]]
    : [[0, 0.255], [0.15, 0.285], [0.42, 0.25], [0.68, 0.345], [0.86, 0.31], [1, 0.22]]);
  const endR = s => {
    let k = 1;
    if (s < 0.16) { const t = 1 - s / 0.16; k *= Math.sqrt(Math.max(0, 1 - t * t)); }
    if (s > 0.78) { const t = (s - 0.78) / 0.22; k *= Math.sqrt(Math.max(0, 1 - t * t)); }
    return k;
  };
  const W = s => Wb(s) * endR(s);
  const zc = s => -0.06 * smooth(0.5, 1, s) + 0.025 * Math.sin(s * PI);
  const spring = s => (sn ? 0.1 : 0.13) * Math.pow(smooth(0.72, 1.02, s), 1.6) + (sn ? 0.035 * Math.pow(smooth(0.25, 0, s), 2) : 0);
  const ground = s => (sn ? lerp(0.29, 0.2, smooth(0.15, 0.7, s)) : lerp(0.1, 0.07, smooth(0.15, 0.6, s))) + spring(s);
  const Hs = spline(sn ? [[0, 0.8], [0.12, 0.92], [0.3, 0.92], [0.43, 0.78], [0.56, 0.6], [0.7, 0.45], [0.85, 0.35], [1, 0.26]]
    : [[0, 0.78], [0.12, 0.88], [0.28, 0.86], [0.4, 0.7], [0.55, 0.5], [0.7, 0.36], [0.85, 0.26], [1, 0.18]]);
  const Ht = s => { let h = Hs(s); if (s > 0.86) { const t = (s - 0.86) / 0.14; h *= 0.45 + 0.55 * Math.sqrt(Math.max(0, 1 - t * t)); } return h; };
  const sT = sn ? 0.44 : 0.38;
  // collar line: high at the heel tab, dips under the ankle bones, climbs into the throat
  const Yr = spline(sn ? [[0, 0.66], [0.07, 0.68], [0.2, 0.5], [0.32, 0.54], [0.44, 0.8]] : [[0, 0.62], [0.06, 0.63], [0.17, 0.44], [0.28, 0.5], [0.38, 0.74]]);
  const yr = s => (s >= sT ? 9 : Yr(s));
  const nTop = sn ? 0.8 : 0.95, nBot = 0.32, zTop = sn ? 0.75 : 0.85, zBot = 0.35;
  const thc = s => { const r = yr(s), H = Ht(s); if (r >= H) return PI / 2; const t = clamp(2 * r / H - 1, -1, 1); return Math.asin(clamp(spow(t, 1 / nTop), -1, 1)); };
  // point on the last. th in [pi/2, 5pi/2] (pi/2 = top centre, 2pi = lateral side, 3pi/2 = sole)
  const at = (s, th, out) => {
    const sn2 = Math.sin(th), cs = Math.cos(th), H = Ht(s);
    let y = H / 2 * (1 + spow(sn2, sn2 > 0 ? nTop : nBot));
    let z = W(s) * spow(cs, sn2 > 0 ? zTop : zBot);
    z *= 1 - (sn ? 0.24 : 0.3) * smooth(0.25, 0.68, y) * (1 - smooth(0.3, 0.55, s));
    let x = X(s);
    const hb = 1 - smooth(0, 0.22, s);
    x += (-0.05 * Math.sin(PI * Math.min(1, y / 0.55)) + 0.08 * smooth(0.35, 0.8, y)) * hb;
    out.set(x, ground(s) - 0.012 + y, z + zc(s));
    return out;
  };
  const topAt = (s, zf, out) => { // point on the top of the closed vamp, zf in [-1,1] across
    const th = Math.acos(clamp(spow(zf, 1 / zTop), -1, 1));
    return at(s, th, out);
  };
  const normalAt = (s, th) => {
    const a = at(s, th, V()), b = at(Math.min(1, s + 0.004), th, V()), c = at(s, th + 0.01, V());
    return b.sub(a).cross(c.sub(a)).normalize().negate();
  };
  // arc-length texture coordinate around a reference section (so prints keep their proportions on the wall)
  const NT = 720, tab = new Float32Array(NT + 1), hf = new Float32Array(NT + 1);
  { let acc = 0, py = 0, pz = 0;
    for (let i = 0; i <= NT; i++) {
      const th = PI / 2 + i / NT * TAU, sn2 = Math.sin(th), cs = Math.cos(th);
      const y = 0.88 / 2 * (1 + spow(sn2, sn2 > 0 ? nTop : nBot)), z = 0.36 * spow(cs, sn2 > 0 ? zTop : zBot);
      if (i) acc += Math.hypot(y - py, z - pz);
      tab[i] = acc; hf[i] = y / 0.88; py = y; pz = z;
    }
    for (let i = 0; i <= NT; i++) tab[i] /= acc; }
  const uTex = th => { const f = clamp((th - PI / 2) / TAU, 0, 1) * NT, i = Math.min(NT - 1, Math.floor(f)); return lerp(tab[i], tab[i + 1], f - i); };
  // lateral half of the canvas: 0 = sole edge, 1 = top centre. returns that fraction for a wall height fraction
  const latY = h => { for (let i = NT / 2; i <= NT; i++) if (hf[i] >= h && Math.cos(PI / 2 + i / NT * TAU) >= 0) return (tab[i] - 0.5) * 2; return 1; };
  return { sn, X, W, zc, ground, Ht, yr, thc, at, topAt, normalAt, sT, spring, uTex, latY };
}

function shoeGeos(kind) {
  return cached('shoe|' + kind, () => {
    const M = shoeModel(kind), sn = M.sn;
    const NV = 100, NU = 72;
    const sOf = v => 0.5 - 0.5 * Math.cos(v * PI); // denser at heel and toe
    const upper = grid(NU, NV, (u, v, t) => {
      const s = sOf(v), c = M.thc(s);
      // sides and sole keep a fixed share of u; only the top arcs shrink where the collar is open
      const th = u < 0.25 ? lerp(PI - c, PI, u / 0.25) : u > 0.75 ? lerp(TAU, TAU + c, (u - 0.75) / 0.25) : lerp(PI, TAU, (u - 0.25) / 0.5);
      M.at(s, th, t);
      return [s, M.uTex(th)];
    }, { outward: (u, v, p) => V(p.x * 0.3, p.y - 0.4, p.z) });
    // padded collar along the rim
    const rim = [];
    for (let i = 0; i <= 40; i++) { const s = M.sT * (1 - i / 40) * 0.985; rim.push(M.at(s, PI - M.thc(s), V())); }
    for (let i = 1; i <= 40; i++) { const s = M.sT * (i / 40) * 0.985; rim.push(M.at(s, TAU + M.thc(s), V())); }
    const collar = tube(rim, { seg: 160, radial: 14, rFn: v => (sn ? 0.052 : 0.036) * (0.55 + 0.45 * Math.sin(Math.min(1, v * 1.02) * PI) ** 0.4) });
    // tongue: padded slab rising out of the throat
    const tPts = [];
    const sA = M.sT + 0.03, sTip = M.sT - 0.09;
    const p0 = M.topAt(sA, 0, V()), tip = V(M.X(sTip), M.ground(sTip) + M.yr(sTip) + (sn ? 0.17 : 0.12), M.zc(sTip));
    for (let i = 0; i <= 12; i++) {
      const f = i / 12, s = lerp(sn ? 0.64 : 0.6, sTip, f);
      const p = s >= sA ? M.topAt(s, 0, V()) : p0.clone().lerp(tip, (sA - s) / (sA - sTip));
      if (s < sA) p.y += 0.04 * Math.sin((sA - s) / (sA - sTip) * PI);
      p.y += sn ? 0.035 : 0.022; tPts.push(p);
    }
    const tongue = sweep(tPts, 32, 40, (v, a) => {
      const e = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, v - 0.82) / 0.18, 2))) * Math.sqrt(Math.min(1, v * 12 + 0.2));
      return [Math.sin(a) * (sn ? 0.045 : 0.026) * e, Math.cos(a) * (sn ? 0.2 : 0.17) * Math.max(0.6, e) * (1 - 0.1 * v)];
    }, { up: V(0, 1, 0) });
    // laces: straight bars + eyelet rings
    const laceParts = [], eyeParts = [];
    const nL = sn ? 6 : 6;
    for (let i = 0; i < nL; i++) {
      const s = sn ? lerp(0.47, 0.71, i / (nL - 1)) : lerp(M.sT + 0.035, 0.66, i / (nL - 1));
      const zf = 0.5 - 0.08 * i / (nL - 1);
      const a = M.topAt(s, zf, V()), b = M.topAt(s, -zf, V()), m = M.topAt(s, 0, V());
      const lift = sn ? 0.045 : 0.03;
      a.y += 0.012; b.y += 0.012; m.y += lift;
      laceParts.push(tube([a, a.clone().lerp(m, 0.5).add(V(0, lift * 0.55, 0)), m, b.clone().lerp(m, 0.5).add(V(0, lift * 0.55, 0)), b], { radius: sn ? 0.026 : 0.03, flat: sn ? 0.45 : 0.55, seg: 24, radial: 8, up: V(1, 0, 0) }));
      for (const p of [a, b]) {
        const g = new THREE.TorusGeometry(0.03, 0.009, 8, 16); g.rotateX(PI / 2);
        const n = V(0, 1, 0).add(V(0, 0, Math.sign(p.z - M.zc(s)) * 0.5)).normalize();
        placeGeo(g, p.clone().addScaledVector(n, -0.004), n); eyeParts.push(g);
      }
    }
    const laces = mergeGeos(laceParts); laceParts.forEach(g => g.dispose());
    const eyelets = mergeGeos(eyeParts); eyeParts.forEach(g => g.dispose());
    // sole unit: closed boxy sections hugging the outline
    const soleLayer = (yb, yt, grow, lip) => grid(56, 72, (u, v, t) => {
      const s = sOf(v), th = u * TAU, cs = Math.cos(th), si = Math.sin(th);
      const w = M.W(s) * (1 + grow) + grow * 0.4 * Math.sqrt(M.W(s) / 0.4) * (s > 0.002 && s < 0.998 ? 1 : 0);
      const y0 = yb(s), y1 = yt(s);
      const yy = (y0 + y1) / 2 + (y1 - y0) / 2 * spow(si, 0.22);
      let zz = w * spow(cs, 0.3) * (1 - (si > 0 ? lip * smooth(0.5, 1, si) : 0));
      let x = M.X(s), hb = 1 - smooth(0, 0.22, s);
      x += -0.05 * Math.sin(PI * Math.min(1, Math.max(0, yy - M.ground(s)) / 0.55)) * hb * 0;
      const ext = s < 0.02 ? -0.02 * (1 - s / 0.02) * Math.abs(cs) : 0;
      t.set(x + ext, yy, zz + M.zc(s));
      return [s, u];
    }, { outward: (u, v, p) => V(0, Math.sin(u * TAU) * 0.6, Math.cos(u * TAU)) });
    let sole, outsole, studs = null;
    if (sn) {
      sole = soleLayer(s => M.spring(s) * 0.9 + 0.055, s => M.ground(s) + 0.035, 0.07, 0.06);
      outsole = soleLayer(s => M.spring(s) * 0.9, s => M.spring(s) * 0.9 + 0.075, 0.075, 0.0);
    } else {
      sole = soleLayer(s => M.ground(s) - 0.065, s => M.ground(s) + 0.03, 0.035, 0.05);
      // conical studs: heel 4, forefoot 7
      const pos = [[0.07, 0.6], [0.07, -0.6], [0.2, 0.62], [0.2, -0.62], [0.58, 0.72], [0.58, -0.72], [0.72, 0.74], [0.72, -0.72], [0.86, 0.62], [0.86, -0.58], [0.66, 0.0]];
      const parts = pos.map(([s, zf], i) => {
        const blade = s > 0.5 && i !== 10;
        const r0 = blade ? 0.05 : 0.064, h = blade ? 0.1 : 0.11;
        const g = lathe(24, 8, v => {
          const y = -v * h, tip = smooth(0.75, 1, v);
          return [lerp(r0, r0 * 0.72, v) * (1 - 0.35 * tip * tip) + 0.0001, y];
        }, blade ? { rx: 1.55, rz: 0.7 } : {});
        if (blade) g.rotateY(zf > 0 ? 0.35 : -0.35);
        const y = M.ground(s) - 0.062;
        g.translate(M.X(s) - (s < 0.1 ? -0.02 : 0), y, M.zc(s) + zf * M.W(s) * 0.98);
        // follow toe spring tilt
        return g;
      });
      studs = mergeGeos(parts); parts.forEach(g => g.dispose());
    }
    // insole visible through the collar
    const insole = grid(24, 30, (u, v, t) => {
      const s = lerp(0.02, M.sT + 0.05, v), w = M.W(s) * 0.86;
      t.set(M.X(s) + 0.01, M.ground(s) + 0.03, M.zc(s) + (u * 2 - 1) * w);
      return [u, v];
    }, { outward: () => V(0, 1, 0) });
    // heel pull tab (sneaker)
    let tab = null;
    if (sn) {
      const p = M.at(0.0, TAU + M.thc(0.0), V());
      const pts = [V(p.x + 0.05, p.y - 0.12, 0), V(p.x - 0.05, p.y - 0.02, 0), V(p.x - 0.06, p.y + 0.08, 0), V(p.x - 0.0, p.y + 0.1, 0)];
      tab = sweep(pts, 16, 16, (v, a) => [Math.cos(a) * 0.06 * Math.sqrt(Math.min(1, (1 - v) * 8 + 0.15)), Math.sin(a) * 0.016], { up: V(0, 0, 1) });
    }
    return { M, upper, collar, tongue, laces, eyelets, sole, outsole, studs, insole, tab };
  });
}

// original side graphic: a forward-raking blade with a notch, plus a split tail
function shoeGraphic(ctx, w, h, o) {
  // coordinates: x in [0,1] heel->toe, y = wall height fraction (0 sole, 1 top of the last)
  const P = (x, y) => [x * w, (1 - o.M.latY(y)) * h];
  ctx.beginPath();
  const pts = o.sn
    ? [[0.22, 0.22], [0.56, 0.3], [0.74, 0.62], [0.67, 0.62], [0.55, 0.42], [0.39, 0.38], [0.43, 0.5], [0.29, 0.36]]
    : [[0.16, 0.16], [0.52, 0.24], [0.78, 0.6], [0.71, 0.61], [0.54, 0.37], [0.35, 0.33], [0.4, 0.46], [0.25, 0.3]];
  pts.forEach(([x, y], i) => { const [a, b] = P(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
  ctx.closePath();
}
function buildShoe(item, d, kind) {
  const G = shoeGeos(kind), M = G.M, sn = M.sn;
  item.shoe = true;
  item.defPatch = { flex: { x0: 0.15, x1: 1.3, amp: 0.07 } };
  const cv = item.canvas(1024, 512), map = item.tex(cv);
  const upM = item.mat({
    map, roughness: sn ? 0.7 : 0.48, clearcoat: sn ? 0 : 0.4, clearcoatRoughness: 0.28,
    normalMap: item.ntex(sn ? 'knit' : 'pebble', sn ? 46 : 10, sn ? 26 : 5), normalScale: new THREE.Vector2(sn ? 0.55 : 0.22, sn ? 0.55 : 0.22),
    sheen: sn ? 0.8 : 0, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.3, 0.3, 0.3),
  });
  upM.userData.base = { rough: sn ? 0.7 : 0.46, coat: sn ? 0 : 0.4, coatRough: 0.28 };
  const lining = item.mat({ color: 0x1a1a22, roughness: 0.9, side: THREE.BackSide, sheen: 0.5, sheenColor: new THREE.Color(0.2, 0.2, 0.2) });
  item.add(G.upper, upM); item.add(G.upper, lining);
  const padM = item.mat({ color: 0x222222, roughness: 0.8, sheen: 0.7, sheenColor: new THREE.Color(0.3, 0.3, 0.3), normalMap: item.ntex('fuzz', 30, 2), normalScale: new THREE.Vector2(0.25, 0.25) });
  item.add(G.collar, padM);
  const tcv = item.canvas(256, 512), tmap = item.tex(tcv);
  const tongueM = item.mat({ map: tmap, roughness: 0.75, sheen: 0.6, sheenColor: new THREE.Color(0.3, 0.3, 0.3), normalMap: item.ntex('knit', 6, 10), normalScale: new THREE.Vector2(0.4, 0.4) });
  item.add(G.tongue, tongueM);
  const laceM = item.mat({ color: 0xffffff, roughness: 0.7, sheen: 0.7, sheenColor: new THREE.Color(0.5, 0.5, 0.5), normalMap: item.ntex('rib', 2, 8), normalScale: new THREE.Vector2(0.4, 0.4) });
  item.add(G.laces, laceM);
  const eyeM = item.mat({ color: 0xd9dde4, metalness: 1, roughness: 0.25 });
  item.add(G.eyelets, eyeM);
  const insM = item.mat({ color: 0x333333, roughness: 0.85 });
  item.add(G.insole, insM);
  const scv = item.canvas(512, 256), smap = item.tex(scv);
  const soleM = item.mat({ map: smap, roughness: sn ? 0.55 : 0.32, clearcoat: sn ? 0.2 : 0.7, clearcoatRoughness: 0.15, normalMap: item.ntex(sn ? 'grain' : 'grain', 30, 4), normalScale: new THREE.Vector2(0.15, 0.15) });
  item.add(G.sole, soleM);
  let outM = null, studM = null, tabM = null;
  if (G.outsole) { outM = item.mat({ color: 0x222222, roughness: 0.85, normalMap: item.ntex('knurl', 60, 8), normalScale: new THREE.Vector2(0.6, 0.6) }); item.add(G.outsole, outM); }
  if (G.studs) { studM = item.mat({ color: 0xffffff, roughness: 0.3, clearcoat: 0.6 }); item.add(G.studs, studM); }
  if (G.tab) { tabM = item.mat({ color: 0xffffff, roughness: 0.6, sheen: 0.5, sheenColor: new THREE.Color(0.4, 0.4, 0.4) }); item.add(G.tab, tabM); }
  item.painters.push(d2 => {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height, H2 = h / 2;
    // base + subtle pattern on both sides (canvas: top half lateral, bottom half medial)
    paintPattern(c, 0, 0, w, h, d2, { unit: w / 2.6, scale: 0.6, pattern: ['camo', 'hex', 'halftone', 'pinstripe', 'gradient', 'waves', 'flames', 'split'].includes(d2.pattern) ? (d2.pattern === 'split' ? 'solid' : d2.pattern) : 'solid' });
    const col2 = d2.secondary, acc = d2.accent;
    // toe and heel overlays
    c.fillStyle = sn ? shade(d2.primary, -0.12) : 'rgba(0,0,0,0)';
    for (const [y0, flip] of [[0, false], [H2, true]]) {
      c.save(); c.translate(0, y0); if (flip) { c.translate(0, H2); c.scale(1, -1); }
      // heel counter
      c.fillStyle = sn ? col2 : acc;
      const hy = f => (1 - M.latY(f)) * H2;
      c.beginPath(); c.moveTo(0, H2); c.lineTo(w * (sn ? 0.2 : 0.16), H2); c.lineTo(w * (sn ? 0.2 : 0.16), hy(0.12)); c.quadraticCurveTo(w * 0.15, hy(0.5), w * 0.05, hy(0.7)); c.lineTo(0, hy(0.72)); c.closePath(); c.fill();
      if (sn) { // toe cap and eyestay overlays
        c.fillStyle = shade(d2.primary, -0.18);
        c.beginPath(); c.moveTo(w, 0); c.lineTo(w * 0.86, 0); c.quadraticCurveTo(w * 0.8, H2 * 0.7, w * 0.86, H2); c.lineTo(w, H2); c.fill();
      }
      // eyestay band along the lace line
      c.fillStyle = shade(d2.primary, -0.22);
      c.fillRect(w * 0.44, 0, w * 0.31, H2 * 0.07);
      // side graphic (the medial side gets it mirrored by the flip)
      shoeGraphic(c, w, H2, { sn, M });
      c.fillStyle = col2; c.fill();
      c.lineWidth = w * 0.006; c.strokeStyle = acc; c.stroke();
      // stitch lines
      c.setLineDash([w * 0.008, w * 0.006]); c.lineWidth = w * 0.0025; c.strokeStyle = 'rgba(255,255,255,0.45)';
      c.beginPath(); c.moveTo(w * 0.44, H2 * 0.09); c.lineTo(w * 0.75, H2 * 0.09); c.stroke();
      const ys = (1 - M.latY(0.1)) * H2; c.beginPath(); c.moveTo(0, ys); c.lineTo(w, ys); c.stroke();
      c.setLineDash([]);
      c.restore();
    }
    // lateral heel text
    const txt = d2.text || d2.chest || d2.name;
    if (txt) drawText(c, txt, w * 0.085, (1 - M.latY(0.4)) * H2, w * 0.11, H2 * 0.08, d2, { color: lum(sn ? col2 : acc) > 0.4 ? '#04282e' : '#ffffff', outline: false });
    // tongue label
    const tc = tcv.getContext('2d'), tw = tcv.width, th2 = tcv.height;
    tc.fillStyle = sn ? d2.primary : shade(d2.primary, -0.1); tc.fillRect(0, 0, tw, th2);
    tc.fillStyle = col2; tc.fillRect(0, 0, tw, th2 * 0.24);
    if (txt) { tc.save(); tc.translate(tw / 2, th2 * 0.12); tc.rotate(PI / 2); drawText(tc, txt, 0, 0, th2 * 0.2, tw * 0.5, d2, { color: lum(col2) > 0.4 ? '#04282e' : '#ffffff', outline: false }); tc.restore(); }
    // sole canvas (u around: 0.5 = bottom, v along)
    const sc = scv.getContext('2d'), sw = scv.width, sh = scv.height;
    const soleCol = sn ? (lum(acc) > 0.6 ? acc : '#f4f5f7') : col2;
    sc.fillStyle = soleCol; sc.fillRect(0, 0, sw, sh);
    if (sn) { // midsole sidewall grooves and an accent wedge
      sc.fillStyle = shade(soleCol, -0.08);
      for (let i = 0; i < 26; i++) sc.fillRect(i / 26 * sw, sh * 0.6, sw * 0.012, sh * 0.06);
      sc.fillStyle = acc === soleCol ? col2 : d2.primary; sc.globalAlpha = 0.9;
      sc.beginPath(); sc.moveTo(0, sh * 0.1); sc.lineTo(sw * 0.3, sh * 0.15); sc.lineTo(sw * 0.3, sh * 0.2); sc.lineTo(0, sh * 0.2); sc.fill(); sc.globalAlpha = 1;
    } else {
      sc.fillStyle = acc; sc.fillRect(0, sh * 0.38, sw, sh * 0.03);
    }
    upM.sheenColor.set(shade(d2.primary, 0.4)).multiplyScalar(0.3);
    padM.color.set(sn ? mix(d2.primary, '#ffffff', 0.08) : shade(d2.primary, -0.35));
    tongueM.sheenColor.set(shade(d2.primary, 0.4)).multiplyScalar(0.3);
    laceM.color.set(sn ? (lum(acc) > 0.5 ? acc : '#f4f5f7') : (lum(acc) > 0.4 ? acc : col2));
    insM.color.set(shade(col2, -0.5));
    lining.color.set(shade(d2.primary, -0.7));
    if (studM) studM.color.set(lum(acc) > 0.35 ? acc : mix(col2, '#ffffff', 0.4));
    if (outM) outM.color.set(lum(col2) < 0.2 ? col2 : '#26262c');
    if (tabM) tabM.color.set(acc);
    applySurfaceFinish(upM, d2.finish);
  });
  Object.assign(item, { yaw: -0.3, heroYaw: -0.26, elev: 0.2, fit: 1.1 });
}

/* ------------------------------------------------------------------ */
/* SOCKS: lofted knit tube on an invisible foot form                   */
/* side view: x toward the toe, y up, z across (lateral side = +Z).    */
/* Leg sections are horizontal, the heel sections fan around a soft    */
/* instep fillet and the foot sections are vertical, so the tube bends */
/* through ~90 degrees without pinching and the heel cup stays round.  */
/* ------------------------------------------------------------------ */
function sockModel() {
  const yTop = 1.78, yc = 0.36, rho = 0.1, HEEL_E = 0.78;
  const legF = y => 0.115 + 0.012 * Math.exp(-Math.pow((y - 1.15) / 0.35, 2));                      // shin line
  const legB = y => -(0.118 + 0.085 * Math.exp(-Math.pow((y - 1.18) / 0.3, 2)) + 0.01 * smooth(1.5, yTop, y)); // calf line
  const legW = y => 0.128 + 0.04 * Math.exp(-Math.pow((y - 1.18) / 0.32, 2)) + 0.006 * smooth(1.5, yTop, y);   // half width
  const cx = legF(yc) + rho, A = cx - legB(yc), B = yc;
  const xT = cx + 0.93;
  const footT = x => (x - cx) / (xT - cx);
  const yTopFoot = x => yc - rho - 0.1 * smooth(0, 0.92, footT(x));
  const ySole = x => 0.035 * Math.pow(smooth(0.55, 1, footT(x)), 2);
  const footW = x => { const t = footT(x); return 0.13 + 0.062 * smooth(0, 0.62, t) - 0.022 * smooth(0.72, 1, t); };
  const LEG = yTop - yc, BEND = PI / 2 * 0.24, FOOT = xT - cx;
  const TT = LEG + BEND + FOOT;
  // section at composite parameter t in [0,1]: inner (front/top) point I, outer (back/sole) point O, half width w, foot factor f, toe cap k
  const sec = t => {
    const s = t * TT;
    let I, O, w, f = 0, k = 1, zs = 0;
    if (s <= LEG) {
      const y = yTop - s;
      I = [legF(y), y]; O = [legB(y), y]; w = legW(y);
    } else if (s <= LEG + BEND) {
      const ph = (s - LEG) / BEND * PI / 2, c = Math.cos(ph), sn = Math.sin(ph);
      const hb = 0.042 * Math.pow(Math.sin(2 * ph), 2); // heel cup bulges back and down
      I = [cx - rho * c, yc - rho * sn];
      O = [cx - (A + hb) * spow(c, HEEL_E), yc - (B + hb * 0.5) * spow(sn, HEEL_E)];
      w = lerp(legW(yc), footW(cx), smooth(0, 1, ph / (PI / 2))) + 0.008 * Math.sin(2 * ph);
      f = smooth(0.2, 1, ph / (PI / 2));
    } else {
      const x = cx + (s - LEG - BEND);
      I = [x, yTopFoot(x)]; O = [x, ySole(x)]; w = footW(x); f = 1;
      const tt = footT(x);
      if (tt > 0.8) { const q = (tt - 0.8) / 0.2; k = Math.sqrt(Math.max(0, 1 - q * q)); zs = -0.028 * smooth(0.8, 1, tt); }
    }
    return { I, O, w, f, k, zs };
  };
  // rows: arc length of the midline (texture) and of midline + size change (vertex spacing, denser on the toe cap)
  const N = 1200, tl = new Float32Array(N + 1), tg = new Float32Array(N + 1);
  let prev = null;
  for (let i = 0; i <= N; i++) {
    const S = sec(i / N), mx = (S.I[0] + S.O[0]) / 2, my = (S.I[1] + S.O[1]) / 2;
    const h = Math.hypot(S.O[0] - S.I[0], S.O[1] - S.I[1]) / 2 * S.k, w = S.w * S.k;
    if (prev) {
      const dm = Math.hypot(mx - prev[0], my - prev[1]);
      tl[i] = tl[i - 1] + dm; tg[i] = tg[i - 1] + Math.hypot(dm, (h - prev[2]) * 1.3, (w - prev[3]) * 1.3);
    }
    prev = [mx, my, h, w];
  }
  const L = tl[N], G = tg[N];
  const tAtG = g => { let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tg[m] < g) lo = m; else hi = m; } return (lo + (g - tg[lo]) / ((tg[hi] - tg[lo]) || 1)) / N; };
  const texV = t => { const f = t * N, i = Math.min(N - 1, Math.floor(f)); return lerp(tl[i], tl[i + 1], f - i); };
  const vAt = t => texV(t); // texture distance from the cuff edge
  const ankleV = texV(LEG / TT), heelV = texV((LEG + BEND * 0.55) / TT), toeV = texV((LEG + BEND + FOOT * 0.8) / TT), footV0 = texV((LEG + BEND) / TT);
  // calf circumference (Ramanujan) sets the canvas aspect so prints keep their proportions on the calf
  const yCalf = 1.18, ca = (legF(yCalf) - legB(yCalf)) / 2, cb = legW(yCalf);
  const Ccalf = PI * (3 * (ca + cb) - Math.sqrt((3 * ca + cb) * (ca + 3 * cb)));
  return { yTop, sec, L, G, tAtG, vAt, ankleV, heelV, toeV, footV0, Ccalf, calfV: yTop - yCalf, LEG, BEND, FOOT, TT, xT };
}
// point on the sock: t along (0 cuff .. 1 toe), a around (0 back/sole, pi/2 lateral, pi front/instep)
function sockPoint(M, S, t, a, out, off = 0) {
  const ex = S.O[0] - S.I[0], ey = S.O[1] - S.I[1], len = Math.hypot(ex, ey) || 1;
  const h = len / 2 * S.k, w = S.w * S.k;
  const c = Math.cos(a), sn = Math.sin(a);
  // flatter sole: squarer superellipse on the sole half of the foot
  const n = c > 0 ? 2 + 1.6 * S.f : 2;
  let X = spow(c, 2 / n), Z = spow(sn, 2 / n);
  // knit details: welt + rib at the cuff, soft creases over the instep
  const v = M.vAt(t);
  const welt = 1 - smooth(0.07, 0.11, v);
  const rib = (1 - smooth(0.13, 0.2, v)) * 0.0032 * Math.cos(a * 44);
  const crease = 0.0055 * Math.max(0, -c) * Math.sin((v - M.ankleV) * 70) * Math.exp(-Math.pow((v - M.ankleV - 0.1) / 0.11, 2));
  const grow = 0.009 * welt + rib - crease + off;
  const mx = (S.I[0] + S.O[0]) / 2, my = (S.I[1] + S.O[1]) / 2;
  const hh = h + grow * S.k, ww = w + grow * S.k;
  return out.set(mx + ex / len * hh * X, my + ey / len * hh * X, Z * ww + S.zs);
}
function buildSocks(item, d) {
  item.fabric = true;
  const G = cached('socks2', () => {
    const M = sockModel();
    const NV = 168, NU = 72;
    const rows = []; for (let j = 0; j <= NV; j++) { const t = M.tAtG(j / NV * M.G); rows.push({ t, S: M.sec(t), v: M.vAt(t) }); }
    const body = grid(NU, NV, (u, v, p) => {
      const R = rows[Math.round(v * NV)];
      sockPoint(M, R.S, R.t, u * TAU, p);
      return [u, 1 - R.v / M.L];
    }, { outward: (u, v, p) => { const R = rows[Math.round(v * NV)], S = R.S; return V(p.x - (S.I[0] + S.O[0]) / 2, p.y - (S.I[1] + S.O[1]) / 2, p.z - S.zs); } });
    // rolled cuff edge
    const S0 = M.sec(0), rim = [];
    for (let i = 0; i < 96; i++) { const p = sockPoint(M, S0, 0, i / 96 * TAU, V(), -0.007); p.y -= 0.002; rim.push(p); }
    const edge = tube(rim, { closed: true, radius: 0.013, seg: 192, radial: 10 });
    return { M, body, edge };
  });
  const M = G.M;
  const CW = 512, CH = Math.round(CW * M.L / M.Ccalf);
  const cv = item.canvas(CW, CH), map = item.tex(cv);
  const m = item.fabricMat(map, { normal: 'sock', rx: 6, ry: Math.round(M.L / 0.12), ns: 0.42, rough: 0.86 });
  m.sheenRoughness = 0.45;
  const lin = item.liningMat('#222');
  const edgeM = item.fabricMat(null, { normal: 'rib', rx: 40, ry: 1, ns: 0.55, rough: 0.86 });
  // the pair: a second sock just behind and further along, turned slightly toward the camera
  for (const [x, z, ry] of [[0, 0, 0], [0.42, -0.52, 0.2]]) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; item.group.add(g);
    item.add(G.body, m, g); item.add(G.body, lin, g); item.add(G.edge, edgeM, g);
  }
  item.painters.push(d2 => {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height, pxu = h / M.L;
    const Y = v => v * pxu;
    const P = d2.primary, S2 = d2.secondary, A2 = d2.accent;
    const contrast = (a, b) => Math.abs(lum(a) - lum(b));
    const trimC = contrast(S2, P) > 0.08 ? S2 : A2;          // heel, toe and cuff stripes
    const stripe2 = contrast(A2, P) > 0.08 && A2 !== trimC ? A2 : shade(trimC, lum(trimC) > 0.4 ? -0.3 : 0.4);
    c.fillStyle = P; c.fillRect(0, 0, w, h);
    // pattern band on the leg (mirrored halves so the back seam and front line stay continuous)
    const y0 = Y(0.3), y1 = Y(M.ankleV - 0.1);
    if (d2.pattern !== 'solid') {
      const o = { unit: pxu * 0.42, seed: 4 };
      paintPattern(c, 0, y0, w / 2, y1 - y0, d2, o); paintPattern(c, w / 2, y0, w / 2, y1 - y0, d2, { ...o, mirror: true });
      // knitted-in edge where the pattern band meets the plain foot
      c.fillStyle = trimC; c.fillRect(0, y1, w, Y(0.022));
    }
    // ribbed cuff: welt in the trim colour, then two contrast stripes
    c.fillStyle = P; c.fillRect(0, 0, w, Y(0.3));
    c.fillStyle = trimC; c.fillRect(0, 0, w, Y(0.105));
    c.fillStyle = trimC; c.fillRect(0, Y(0.15), w, Y(0.04));
    c.fillStyle = stripe2; c.fillRect(0, Y(0.215), w, Y(0.025));
    c.fillStyle = trimC; c.fillRect(0, Y(0.265), w, Y(0.012));
    // cushioned sole: a darker terry zone under the foot (u ~ 0)
    c.fillStyle = shade(P, -0.16);
    for (const x0 of [0, w]) { c.beginPath(); c.ellipse(x0, Y((M.footV0 + M.toeV) / 2), w * 0.17, Y((M.toeV - M.footV0) / 2 + 0.04), 0, 0, TAU); c.fill(); }
    // heel cup (u ~ 0 at the back of the bend)
    c.fillStyle = trimC;
    for (const x0 of [0, w]) { c.beginPath(); c.ellipse(x0, Y(M.heelV + 0.03), w * 0.27, Y(0.2), 0, 0, TAU); c.fill(); }
    // toe cap: boundary sweeps a little further back under the sole
    c.beginPath(); c.moveTo(0, h);
    for (let i = 0; i <= 32; i++) { const x = i / 32 * w; c.lineTo(x, Y(M.toeV) - Y(0.035) * Math.cos(i / 32 * TAU)); }
    c.lineTo(w, h); c.closePath(); c.fill();
    // knit shadow in the instep fold (front of the ankle, u = 0.5)
    const sg = c.createRadialGradient(w / 2, Y(M.ankleV + 0.12), 0, w / 2, Y(M.ankleV + 0.12), Y(0.16));
    sg.addColorStop(0, 'rgba(0,0,0,0.16)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = sg; c.fillRect(w * 0.3, Y(M.ankleV - 0.1), w * 0.4, Y(0.45));
    // calf print on the lateral side (u = 0.25), sized in true calf units so it never stretches
    const txt = d2.text || d2.chest || d2.name;
    const num = d2.number;
    const cxp = w * 0.25, calfY = Y(M.calfV - 0.02);
    if (txt) {
      c.save(); c.translate(cxp, calfY + (num ? Y(0.08) : 0)); c.rotate(PI / 2);
      drawText(c, txt, 0, 0, Y(0.62), pxu * 0.15, d2, { color: d2.textColor });
      c.restore();
      if (num) drawText(c, num, cxp, Y(0.43), pxu * 0.2, pxu * 0.15, d2, { color: d2.textColor });
    } else if (num) drawText(c, num, cxp, calfY, pxu * 0.24, pxu * 0.24, d2, { color: d2.textColor });
    edgeM.color.set(trimC); edgeM.sheenColor.set(shade(trimC, 0.2)).multiplyScalar(0.5);
    m.sheenColor.set(shade(P, 0.25)).multiplyScalar(0.55);
    lin.color.set(shade(P, -0.45));
  });
  Object.assign(item, { yaw: -0.2, heroYaw: -0.32, elev: 0.16, fit: 1.0 });
}

/* ------------------------------------------------------------------ */
/* SHORTS: waist body pinched into two leg lobes, legs flare to hem    */
/* ------------------------------------------------------------------ */
function shortsModel() {
  // tapered waist into fuller hips and seat, legs swing slightly outward and open into a loose hem
  const W = spline([[-0.56, 0.9], [-0.36, 0.89], [-0.16, 0.82], [0, 0.72]]);
  const D = spline([[-0.56, 0.5], [-0.36, 0.52], [-0.16, 0.47], [0, 0.42]]);
  const YC = -0.56, HEM = -1.36;
  const CX = v => lerp(0.45, 0.56, Math.pow(v, 0.9));
  const RA = v => lerp(0.45, 0.5, smooth(0, 1, v)), RB = v => lerp(0.47, 0.46, v);
  const bodyAt = (th, y, out) => {
    const s = Math.sin(th), c = Math.cos(th);
    const x = W(y) * spow(s, 0.8);
    // seat is rounder at the back, front is flatter
    let z = D(y) * spow(c, 0.8) * (c < 0 ? 1.04 : 0.98);
    const k = Math.pow(smooth(-0.4, YC, y), 1.6);
    z *= 1 - k * (c > 0 ? 0.62 : 0.72) * Math.exp(-Math.pow(x / 0.3, 2)); // soft crotch gusset, no pinched knot
    return out.set(x, y, z);
  };
  const legAt = (side, phi, v, out) => {
    const y = lerp(YC, HEM, v);
    const th = side * phi * PI;
    const lobe = bodyAt(th, YC, V());
    lobe.y = y;
    const cx = side * CX(v), a = RA(v), b = RB(v);
    const top = bodyAt(th, YC, V());
    const ang = Math.atan2(top.z / 0.5, -side * (top.x - side * 0.45) / 0.45);
    const ell = V(cx - side * a * Math.cos(ang), y, b * Math.sin(ang) * (Math.sin(ang) < 0 ? 1.03 : 1));
    const t = smooth(0, 0.4, v);
    out.copy(lobe).lerp(ell, t);
    // drape: soft vertical folds that deepen toward the hem, plus a light crease at the inseam
    const f = 0.02 * Math.sin(ang * 5 + v * 4 + side) * smooth(0.15, 0.8, v)
      + 0.01 * Math.sin(ang * 11 - v * 6) * smooth(0.4, 1, v)
      - 0.012 * Math.exp(-Math.pow((Math.cos(ang) + 1) / 0.25, 2)) * smooth(0.05, 0.4, v);
    const nx = out.x - cx, nz = out.z, l = Math.hypot(nx, nz) || 1;
    out.x += nx / l * f; out.z += nz / l * f;
    // outer side split: hem rises at the outseam, slight scoop at the inseam
    const outer = Math.max(0, Math.cos(ang)), inner = Math.max(0, -Math.cos(ang));
    out.y += (0.09 * Math.pow(outer, 6) + 0.03 * Math.pow(inner, 3)) * smooth(0.82, 1, v);
    return out;
  };
  return { W, D, YC, HEM, CX, bodyAt, legAt };
}
const SHORTS_VB = 0.45; // share of the texture height used by the body above the crotch
function buildShorts(item, d) {
  item.fabric = true;
  const G = cached('shorts', () => {
    const M = shortsModel();
    const body = grid(144, 32, (u, v, t) => {
      const th = u * TAU, y = lerp(-0.02, M.YC, v);
      M.bodyAt(th, y, t);
      const f = 0.008 * Math.sin(th * 7 + y * 4) * smooth(-0.05, -0.3, y) * (1 - smooth(-0.4, M.YC, y));
      const nx = t.x / (M.W(y) ** 2), nz = t.z / (M.D(y) ** 2), l = Math.hypot(nx, nz) || 1; t.x += nx / l * f; t.z += nz / l * f;
      return [u, 1 - v * SHORTS_VB];
    }, { outward: (u, v, p) => V(p.x, 0, p.z) });
    // legs continue the body's texture space: lobe angle -> u, so prints and side panels flow across the crotch line
    const legs = [-1, 1].map(side => grid(72, 48, (u, v, t) => {
      M.legAt(side, u, v, t);
      return [side > 0 ? u / 2 : 1 - u / 2, 1 - SHORTS_VB - v * (1 - SHORTS_VB)];
    }, { outward: (u, v, p) => V(p.x - side * M.CX(v), 0, p.z) }));
    const waist = loopBand(a => {
      const th = a * TAU, p = M.bodyAt(th, -0.075, V());
      const out = V(p.x / (M.W(-0.075) ** 2), 0, p.z / (M.D(-0.075) ** 2)).normalize();
      return { p, out, ax: V(0, 1, 0) };
    }, { width: 0.16, thick: 0.05, ribs: 150, ribAmp: 0.006, seg: 192 });
    const hems = [-1, 1].map(side => loopBand(a => {
      const p = M.legAt(side, a, 1, V()), q = M.legAt(side, a, 0.97, V());
      const cx = side * M.CX(1), out = V(p.x - cx, 0, p.z).normalize();
      return { p: p.clone().add(V(0, 0.022, 0)), out, ax: p.clone().sub(q).normalize().negate() };
    }, { width: 0.05, thick: 0.015, seg: 96 }));
    // drawcord: two strands from the front eyelets
    const zf = M.bodyAt(0, -0.07, V()).z + 0.03;
    const cords = [-1, 1].map(s => tube([V(s * 0.05, -0.06, zf), V(s * 0.08, -0.12, zf + 0.025), V(s * 0.1, -0.24, zf + 0.02), V(s * 0.085, -0.36, zf + 0.012)], { radius: 0.017, seg: 40, radial: 8 }));
    const tips = [-1, 1].map(s => { const g = new THREE.CylinderGeometry(0.021, 0.019, 0.07, 12); g.translate(s * 0.085, -0.4, zf + 0.01); return g; });
    const shell = mergeGeos([body, ...legs]); weldNormals(shell); body.dispose(); legs.forEach(g => g.dispose());
    return { M, shell, waist, hems, cords: mergeGeos(cords), tips: mergeGeos(tips) };
  });
  const M = G.M;
  const cv = item.canvas(2048, 560), tx = item.tex(cv);
  const bodyM = item.fabricMat(tx, { rx: 80, ry: 22, ns: 0.4 });
  const lin = item.liningMat('#222');
  item.add(G.shell, bodyM); item.add(G.shell, lin);
  const waistM = item.fabricMat(null, { normal: 'rib', rx: 60, ry: 1, ns: 0.6 });
  item.add(G.waist, waistM);
  const hemM = item.fabricMat(null, { normal: 'knit', rx: 30, ry: 1, ns: 0.4 });
  G.hems.forEach(g => item.add(g, hemM));
  const cordM = item.mat({ color: 0xffffff, roughness: 0.7, sheen: 0.8, sheenColor: new THREE.Color(0.4, 0.4, 0.4) }, { wind: 0.012 });
  item.add(G.cords, cordM);
  const tipM = item.mat({ color: 0xd0d4da, metalness: 1, roughness: 0.3 }, { wind: 0.012 });
  item.add(G.tips, tipM);
  item.painters.push(d2 => {
    // canvas: x = around (0 front centre, 0.25 right side, 0.5 back, 0.75 left side); y = waist (top) -> hem (bottom)
    const c = cv.getContext('2d'), w = cv.width, h = cv.height, yl = h * SHORTS_VB;
    const unit = w / 4.1;
    paintPattern(c, 0, 0, w / 2, h, d2, { unit, seed: 3 }); paintPattern(c, w / 2, 0, w / 2, h, d2, { unit, seed: 3, mirror: true });
    for (const x of [w * 0.25, w * 0.75]) { // side panels + piping, widening down the leg
      c.fillStyle = d2.secondary;
      c.beginPath(); c.moveTo(x - unit * 0.07, 0); c.lineTo(x + unit * 0.07, 0); c.lineTo(x + unit * 0.12, h); c.lineTo(x - unit * 0.12, h); c.fill();
      c.strokeStyle = d2.accent; c.lineWidth = unit * 0.012;
      for (const sg of [-1, 1]) { c.beginPath(); c.moveTo(x + sg * unit * 0.075, 0); c.lineTo(x + sg * unit * 0.125, h); c.stroke(); }
    }
    // hem trim
    c.fillStyle = d2.secondary; c.fillRect(0, h * 0.93, w, h * 0.07);
    c.fillStyle = d2.accent; c.fillRect(0, h * 0.915, w, h * 0.01);
    // number on the left leg front, small text on the right leg
    const lx = w * 0.935, rx = w * 0.065, ly = yl + (h - yl) * 0.45;
    if (d2.number) drawText(c, d2.number, lx, ly, unit * 0.32, unit * 0.26, d2, { color: d2.textColor });
    const txt = d2.text || d2.chest;
    if (txt) drawText(c, txt, rx, ly + unit * 0.05, unit * 0.36, unit * 0.07, d2, { color: d2.textColor, outline: false });
    waistM.color.set(d2.secondary); waistM.sheenColor.set(shade(d2.secondary, 0.12)).multiplyScalar(0.5);
    hemM.color.set(d2.secondary);
    cordM.color.set(lum(d2.accent) > 0.3 ? d2.accent : '#f4f5f7');
    bodyM.sheenColor.set(shade(d2.primary, 0.12)).multiplyScalar(0.5);
    lin.color.set(shade(d2.primary, -0.55));
  });
  const p = M.legAt(-1, 0.25, 0.5, V());
  makePatchUpdater(item, { pos: p.clone().add(V(0.1, 0.12, 0.01)), normal: V(-0.15, 0, 1).normalize(), up: V(0, 1, 0) }, 0.07);
  Object.assign(item, { yaw: 0, heroYaw: -0.45, elev: 0.16, fit: 1.0 });
}

/* ------------------------------------------------------------------ */
/* CAP: 6-panel crown, curved brim, back strap opening                 */
/* ------------------------------------------------------------------ */
function capModel() {
  // structured 6-panel: tall upright front panels, crown sloping to the back, pre-curved visor
  const RX = 0.6, RZ = 0.68, PHI = 1.22, CURVE = 0.32, HTOP = 0.6;
  const SPH = Math.sin(PHI);
  const rimY = phi => {
    const s = Math.sin(phi), c = Math.cos(phi);
    let y = c > 0 ? -CURVE * Math.min(1, (s * s) / (SPH * SPH)) : -CURVE;
    if (c <= 0 || Math.abs(phi) > PHI) y = -CURVE;
    // back strap arch
    y += 0.2 * Math.exp(-Math.pow(Math.atan2(Math.sin(phi - PI), Math.cos(phi - PI)) / 0.34, 4));
    return y;
  };
  const seamD = phi => { const k = ((phi % (PI / 3)) + PI / 3) % (PI / 3); return Math.min(k, PI / 3 - k); };
  const at = (phi, v, out) => {
    const r0 = rimY(phi);
    const front = Math.max(0, Math.cos(phi)), f2 = front * front;
    const a = v * PI / 2;
    // fuller, more upright front; softer back
    const p = lerp(0.95, 0.5, f2), q = lerp(1.05, 0.85, f2);
    let rr = Math.pow(Math.cos(a), p);
    const sd = seamD(phi);
    // panels puff slightly between seams, seams sink a touch
    rr *= 1 - 0.014 * Math.exp(-Math.pow(sd / 0.03, 2)) * smooth(0.0, 0.12, v) * (1 - smooth(0.9, 1, v)) + 0.012 * smooth(0.05, 0.45, sd) * Math.sin(a * 2);
    const H = HTOP;
    const y = r0 + (H - r0) * Math.pow(Math.sin(a), q);
    // crown leans a little forward at the top
    const zlean = 0.05 * Math.pow(Math.sin(a), 2);
    return out.set(Math.sin(phi) * RX * rr, y, Math.cos(phi) * RZ * rr + zlean);
  };
  // visor: inner edge follows the crown rim, outer edge is a D shape; bent across, tilted down a touch
  const BL = 0.56, A = RX * SPH * 1.04, ZA = RZ * Math.cos(PHI);
  const brimPt = (t, s, out, dy = 0) => {
    const inner = at(t * PHI, 0, V()).multiplyScalar(0.99);
    const ang = t * PI / 2;
    const outer = V(A * Math.sin(ang), 0, ZA + (RZ + BL - ZA) * Math.pow(Math.cos(ang), 0.9));
    const p = inner.clone().lerp(outer, s);
    const xn = clamp(p.x / A, -1, 1);
    const ext = Math.max(0, p.z - inner.z);
    p.y = -CURVE * Math.pow(Math.abs(xn), 1.8) - 0.11 * ext - 0.06 * ext * ext + dy;
    p.y -= 0.05 * Math.pow(Math.abs(xn), 3) * s; // tips roll down
    return out.copy(p);
  };
  return { RX, RZ, PHI, CURVE, BEND: CURVE, HC: HTOP, rimY, at, brimPt };
}
function buildCap(item, d) {
  const G = cached('cap', () => {
    const M = capModel();
    const crown = grid(192, 56, (u, v, t) => { M.at((u - 0.5) * TAU, v, t); return [u, v]; }, { outward: (u, v, p) => V(p.x, p.y - 0.1, p.z) });
    const brimPt = M.brimPt;
    const TH = 0.026;
    const brimTop = grid(72, 20, (u, v, t) => { brimPt(u * 2 - 1, v, t, TH / 2); return [u, v]; }, { outward: () => V(0, 1, 0) });
    const brimBot = grid(72, 20, (u, v, t) => { brimPt(u * 2 - 1, v, t, -TH / 2); return [u, v]; }, { outward: () => V(0, -1, 0) });
    const edge = []; for (let i = 0; i <= 72; i++) edge.push(brimPt(i / 36 - 1, 1, V()));
    const brimEdge = tube(edge, { radius: TH / 2 + 0.003, seg: 180, radial: 10 });
    // top button and eyelets
    const btn = new THREE.SphereGeometry(0.055, 24, 12); btn.scale(1, 0.45, 1); { const top = M.at(0, 1, V()); btn.translate(top.x, top.y + 0.012, top.z); }
    const eyes = [];
    for (let k = 0; k < 6; k++) {
      const phi = PI / 6 + k * PI / 3, p = M.at(phi, 0.66, V()), p2 = M.at(phi, 0.67, V()), p3 = M.at(phi + 0.01, 0.66, V());
      const n = p2.clone().sub(p).cross(p3.clone().sub(p)).normalize(); if (n.dot(p) < 0) n.negate();
      const g = new THREE.TorusGeometry(0.022, 0.008, 8, 18); g.rotateX(PI / 2); placeGeo(g, p.addScaledVector(n, 0.002), n); eyes.push(g);
    }
    const eyelets = mergeGeos(eyes); eyes.forEach(g => g.dispose());
    // back strap across the arch with a slider
    const sp = []; for (let i = 0; i <= 20; i++) { const phi = PI + (i / 20 - 0.5) * 0.95; const p = M.at(phi, 0, V()); p.y = -M.BEND + 0.05; p.multiplyScalar(1); p.x *= 1.01; p.z *= 1.01; sp.push(p); }
    const strap = sweep(sp, 12, 40, (v, a) => [Math.cos(a) * 0.05, Math.sin(a) * 0.012], { up: V(0, 1, 0) });
    const slider = new THREE.BoxGeometry(0.1, 0.075, 0.03, 2, 2, 2); slider.translate(0.1, -M.BEND + 0.05, -M.RZ - 0.02);
    // sweatband binding at the rim
    const binding = loopBand(a => {
      const phi = a * TAU, p = M.at(phi, 0.0, V()), q = M.at(phi, 0.03, V());
      return { p, out: V(Math.sin(phi), 0, Math.cos(phi)), ax: q.sub(p).normalize() };
    }, { width: 0.035, thick: 0.014, seg: 192, inset: 0.9 });
    return { M, crown, brimTop, brimBot, brimEdge, btn, eyelets, strap, slider, binding };
  });
  const cv = item.canvas(1024, 512), map = item.tex(cv);
  const crownM = item.fabricMat(map, { normal: 'knit', rx: 50, ry: 16, ns: 0.35, rough: 0.82 });
  const lin = item.liningMat('#222');
  item.add(G.crown, crownM); item.add(G.crown, lin);
  const brimC = item.canvas(512, 256), brimT = item.tex(brimC);
  const brimM = item.mat({ map: brimT, roughness: 0.8, sheen: 0.7, sheenColor: new THREE.Color(0.3, 0.3, 0.3), normalMap: item.ntex('knit', 30, 10), normalScale: new THREE.Vector2(0.3, 0.3) });
  const underM = item.mat({ color: 0x222222, roughness: 0.85, sheen: 0.6, sheenColor: new THREE.Color(0.25, 0.25, 0.25), normalMap: item.ntex('knit', 30, 10), normalScale: new THREE.Vector2(0.3, 0.3) });
  item.add(G.brimTop, brimM); item.add(G.brimBot, underM);
  const edgeM = item.mat({ color: 0xffffff, roughness: 0.8, sheen: 0.6, sheenColor: new THREE.Color(0.3, 0.3, 0.3) });
  item.add(G.brimEdge, edgeM);
  const btnM = item.fabricMat(null, { ns: 0.3 });
  item.add(G.btn, btnM);
  const eyeM = item.mat({ color: 0x333333, roughness: 0.6, sheen: 0.5, sheenColor: new THREE.Color(0.3, 0.3, 0.3) });
  item.add(G.eyelets, eyeM);
  const strapM = item.fabricMat(null, { normal: 'rib', rx: 2, ry: 30, ns: 0.4, side: THREE.DoubleSide });
  item.add(G.strap, strapM);
  const slM = item.mat({ color: 0xc9ced6, metalness: 1, roughness: 0.3 });
  item.add(G.slider, slM);
  const bindM = item.fabricMat(null, { normal: 'rib', rx: 80, ry: 1, ns: 0.4 });
  item.add(G.binding, bindM);
  item.painters.push(d2 => {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    paintPattern(c, 0, 0, w, h, d2, { unit: w / 3.9 });
    // panel seams with stitch lines (u = 0.5 is the front centre seam)
    for (let k = 0; k < 6; k++) {
      const x = (0.5 + k / 6) % 1 * w;
      c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(x - 1.5, 0, 3, h);
      c.setLineDash([w * 0.006, w * 0.005]); c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = Math.max(1, w * 0.0015);
      for (const o of [-1, 1]) { c.beginPath(); c.moveTo(x + o * w * 0.008, h * 0.06); c.lineTo(x + o * w * 0.008, h); c.stroke(); }
      c.setLineDash([]);
    }
    const txt = d2.text || d2.chest || d2.name;
    if (txt) drawText(c, txt, w * 0.5, h * 0.58, w * 0.21, h * 0.2, d2, { color: d2.textColor });
    if (d2.number) drawText(c, d2.number, w * 0.04, h * 0.7, w * 0.06, h * 0.12, d2, { color: d2.accent, outline: false });
    if (d2.number) drawText(c, d2.number, w * 0.96, h * 0.7, w * 0.06, h * 0.12, d2, { color: d2.accent, outline: false });
    const b = brimC.getContext('2d'), bw = brimC.width, bh = brimC.height;
    b.fillStyle = shade(d2.primary, -0.1); b.fillRect(0, 0, bw, bh);
    if (d2.pattern !== 'solid') { b.globalAlpha = 0.9; paintPattern(b, 0, 0, bw, bh, { ...d2, pattern: d2.pattern }, { unit: bw / 2.2 }); b.globalAlpha = 1; }
    // classic visor stitching: evenly spaced rows following the edge, plus a soft shade toward the crown
    const sg = b.createLinearGradient(0, bh, 0, 0); sg.addColorStop(0, 'rgba(0,0,0,0.18)'); sg.addColorStop(0.25, 'rgba(0,0,0,0)'); b.fillStyle = sg; b.fillRect(0, 0, bw, bh);
    b.setLineDash([bw * 0.01, bw * 0.007]); b.lineWidth = Math.max(1.5, bw * 0.003);
    b.strokeStyle = lum(d2.primary) > 0.5 ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.32)';
    for (let k = 0; k < 7; k++) { const f = 0.06 + k * 0.075; b.beginPath(); b.moveTo(0, bh * f); b.lineTo(bw, bh * f); b.stroke(); }
    b.setLineDash([]);
    underM.color.set(shade(d2.secondary, -0.25)); edgeM.color.set(shade(d2.primary, -0.12));
    btnM.color.set(d2.secondary); eyeM.color.set(shade(d2.secondary, -0.3));
    strapM.color.set(d2.secondary); bindM.color.set(shade(d2.secondary, -0.2));
    lin.color.set(shade(d2.primary, -0.5));
    crownM.sheenColor.set(shade(d2.primary, 0.12)).multiplyScalar(0.5);
  });
  Object.assign(item, { yaw: 0, heroYaw: -0.55, elev: 0.26, fit: 1.04 });
}

/* ------------------------------------------------------------------ */
/* BEANIE: ribbed dome, folded cuff with label, fuzzy pom-pom          */
/* ------------------------------------------------------------------ */
function buildBeanie(item, d) {
  item.fabric = true;
  const R = 0.62, RIBS = 64;
  const G = cached('beanie', () => {
    const rib = (u, amp) => 1 + amp * (Math.pow(Math.abs(Math.cos(u * PI * RIBS)), 0.7) - 0.5);
    const prof = v => { // bottom (0) to top (1)
      const y = lerp(0.18, 1.12, v);
      const t = smooth(0.32, 1, v), a = t * PI / 2;
      const r = R * (1 - 0.04 * smooth(0, 0.3, v)) * Math.pow(Math.cos(a), 0.7);
      const yy = v < 0.32 ? y : lerp(0.18, 1.12, 0.32) + (1.12 - lerp(0.18, 1.12, 0.32)) * Math.sin(a) * 0.95;
      return [r, yy];
    };
    const body = lathe(RIBS * 4, 60, prof, { mod: (u, v) => rib(u, 0.03 * (1 - smooth(0.7, 1, v))) });
    // folded cuff: closed rounded profile ring
    const cuffProf = v => {
      const a = v * TAU, cx = R * 1.045, cy = 0.17, hw = 0.055, hh = 0.2;
      const c = Math.cos(a), s = Math.sin(a);
      return [cx + hw * spow(c, 0.45), cy + hh * spow(s, 0.3)];
    };
    const cuff = lathe(RIBS * 4, 40, cuffProf, { mod: (u, v) => rib(u + 0.5 / RIBS, 0.028 * Math.max(0, Math.cos(v * TAU))),
      outward: (u, v, p) => { const a = u * TAU; return p.clone().sub(V(Math.sin(a) * R * 1.045, 0.17, Math.cos(a) * R * 1.045)); } });
    // pom-pom: lumpy sphere
    const pom = new THREE.SphereGeometry(0.27, 72, 48);
    const pp = pom.attributes.position, q = V();
    for (let i = 0; i < pp.count; i++) {
      q.fromBufferAttribute(pp, i); const n = q.clone().normalize();
      const k = 1 + 0.12 * (vnoise3(n.x * 6 + 3, n.y * 6, n.z * 6) - 0.5) + 0.06 * (vnoise3(n.x * 18, n.y * 18, n.z * 18) - 0.5);
      q.multiplyScalar(k); pp.setXYZ(i, q.x, q.y, q.z);
    }
    pom.computeVertexNormals(); pom.translate(0, 1.12 + 0.2, 0);
    // woven label on the cuff front
    const label = grid(24, 8, (u, v, t) => {
      const a = (u - 0.5) * 0.6, y = lerp(0.08, 0.27, v), r = R * 1.045 + 0.055 + 0.03;
      t.set(Math.sin(a) * r, y, Math.cos(a) * r);
      return [u, v];
    }, { outward: (u, v, p) => V(p.x, 0, p.z) });
    return { body, cuff, pom, label };
  });
  const cv = item.canvas(1024, 512), map = item.tex(cv);
  const bodyM = item.fabricMat(map, { normal: 'fuzz', rx: 16, ry: 8, ns: 0.25, rough: 0.9 });
  const lin = item.liningMat('#222');
  item.add(G.body, bodyM);
  const cc = item.canvas(1024, 128), ct = item.tex(cc);
  const cuffM = item.fabricMat(ct, { normal: 'fuzz', rx: 16, ry: 2, ns: 0.25, rough: 0.9 });
  item.add(G.cuff, cuffM);
  const pomM = item.mat({ color: 0xffffff, roughness: 1, sheen: 1, sheenRoughness: 0.8, sheenColor: new THREE.Color(0.6, 0.6, 0.6), normalMap: item.ntex('fuzz', 4, 4), normalScale: new THREE.Vector2(1.4, 1.4) }, { wind: 0.02 });
  item.add(G.pom, pomM);
  const lc = item.canvas(512, 160), lt = item.tex(lc);
  const labM = item.mat({ map: lt, roughness: 0.75, sheen: 0.5, sheenColor: new THREE.Color(0.3, 0.3, 0.3), normalMap: item.ntex('knit', 8, 3), normalScale: new THREE.Vector2(0.3, 0.3) }, { wind: 0.012 });
  item.add(G.label, labM);
  void lin;
  item.painters.push(d2 => {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    c.save(); c.translate(0, h); c.scale(1, -1);
    const pat = d2.pattern === 'hoops' || d2.pattern === 'stripes' || d2.pattern === 'split' || d2.pattern === 'gradient' || d2.pattern === 'halftone' || d2.pattern === 'camo' || d2.pattern === 'waves' ? d2.pattern : 'solid';
    paintPattern(c, 0, 0, w, h, d2, { unit: w / 3.9, pattern: pat });
    if (pat === 'solid') { // knitted stripes
      c.fillStyle = d2.secondary; c.fillRect(0, h * 0.3, w, h * 0.06);
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.39, w, h * 0.025);
    }
    c.restore();
    const k = cc.getContext('2d'), kw = cc.width, kh = cc.height;
    k.fillStyle = d2.primary; k.fillRect(0, 0, kw, kh);
    k.fillStyle = d2.secondary; k.fillRect(0, kh * 0.3, kw, kh * 0.12); k.fillRect(0, kh * 0.58, kw, kh * 0.12);
    const l = lc.getContext('2d'), lw = lc.width, lh = lc.height;
    l.fillStyle = d2.secondary; l.fillRect(0, 0, lw, lh);
    l.strokeStyle = d2.accent; l.lineWidth = lh * 0.05; l.strokeRect(lh * 0.08, lh * 0.08, lw - lh * 0.16, lh - lh * 0.16);
    const txt = d2.text || d2.chest || d2.name || 'SQUADFORGE';
    drawText(l, txt, lw / 2, lh / 2, lw * 0.82, lh * 0.55, d2, { color: lum(d2.secondary) > 0.4 ? '#04282e' : (lum(d2.accent) > 0.3 ? d2.accent : '#ffffff'), outline: false });
    pomM.color.set(d2.accent === d2.primary ? d2.secondary : d2.secondary);
    pomM.sheenColor.set(shade(d2.secondary, 0.5)).multiplyScalar(0.6);
    bodyM.sheenColor.set(shade(d2.primary, 0.5)).multiplyScalar(0.5); cuffM.sheenColor.copy(bodyM.sheenColor);
  });
  Object.assign(item, { yaw: 0, heroYaw: -0.4, elev: 0.18, fit: 1.04 });
}

/* ------------------------------------------------------------------ */
/* SHIN GUARDS: curved shell, foam backing, bound edge (shown as pair) */
/* ------------------------------------------------------------------ */
function shinModel() {
  const H = 1.6, RC = 0.62;
  const hw = y => lerp(0.36, 0.5, smooth(-0.8, 0.5, y)) - 0.05 * smooth(0.55, 0.8, y);
  // square -> rounded shield (partial squircle) -> curved around the shin
  const plan = (a, b) => {
    const cx = a * Math.sqrt(Math.max(0, 1 - b * b / 2)), cy = b * Math.sqrt(Math.max(0, 1 - a * a / 2));
    const k = b > 0 ? 0.55 : 0.75;
    const x = lerp(a, cx, k), y = lerp(b, cy, k);
    return [x, y * H / 2];
  };
  const at = (a, b, off, out) => {
    const [px, y] = plan(a, b), x = px * hw(y);
    const ang = x / RC, r = RC + off;
    const bow = 0.07 * Math.cos(y / (H / 2) * PI / 2) + 0.03 * Math.sin(y / (H / 2) * PI);
    return out.set(Math.sin(ang) * r, y, Math.cos(ang) * r - RC + bow);
  };
  return { H, RC, at };
}
function buildShinguards(item, d) {
  const G = cached('shin', () => {
    const M = shinModel(), TH = 0.075;
    const shell = grid(48, 72, (u, v, t) => { M.at(u * 2 - 1, v * 2 - 1, 0, t); return [u, v]; }, { outward: () => V(0, 0, 1) });
    const pad = grid(48, 72, (u, v, t) => {
      const a = u * 2 - 1, b = v * 2 - 1;
      const q = Math.pow(Math.abs(Math.sin(u * PI * 3)), 0.5) * Math.pow(Math.abs(Math.sin(v * PI * 5)), 0.5);
      M.at(a * 0.985, b * 0.985, -TH - 0.012 * q * (1 - Math.max(Math.abs(a), Math.abs(b)) ** 6), t);
      return [u, v];
    }, { outward: () => V(0, 0, -1) });
    // bound edge: loop around the square boundary, profile across the thickness
    const loopAB = f => { const g = f * 4, k = Math.floor(g) % 4, s = g - Math.floor(g); return [[-1 + 2 * s, -1], [1, -1 + 2 * s], [1 - 2 * s, 1], [-1, 1 - 2 * s]][k]; };
    const edge = grid(192, 10, (u, v, t) => {
      const [a, b] = loopAB(u), f = V(), bk = V(), o = V();
      M.at(a, b, 0.004, f); M.at(a * 0.985, b * 0.985, -TH, bk);
      const [a2, b2] = loopAB((u + 0.002) % 1), n2 = M.at(a2, b2, 0, V());
      const tan = n2.sub(f).normalize(), nrm = V(f.x, 0, f.z + M.RC).normalize();
      o.copy(tan).cross(nrm).normalize();
      if (o.dot(V(f.x, f.y, 0)) < 0) o.negate();
      t.copy(f).lerp(bk, v).addScaledVector(o, 0.03 * Math.sin(v * PI));
      return [u, v];
    }, { outward: (u, v, p) => V(p.x, p.y, 0) });
    return { M, shell, pad, edge };
  });
  const cv = item.canvas(512, 820), map = item.tex(cv);
  const shellM = item.mat({ map, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, normalMap: item.ntex('grain', 4, 6), normalScale: new THREE.Vector2(0.15, 0.15) });
  shellM.userData.base = { rough: 0.32, coat: 1, coatRough: 0.08 };
  const padM = item.mat({ color: 0x222222, roughness: 0.9, normalMap: item.ntex('pebble', 6, 10), normalScale: new THREE.Vector2(0.6, 0.6), sheen: 0.4, sheenColor: new THREE.Color(0.2, 0.2, 0.2) });
  const edgeM = item.mat({ color: 0x222222, roughness: 0.75, sheen: 0.7, sheenColor: new THREE.Color(0.3, 0.3, 0.3), normalMap: item.ntex('rib', 60, 1), normalScale: new THREE.Vector2(0.4, 0.4) });
  for (const [x, z, ry] of [[0, 0, 0], [0.92, -0.42, 0.35]]) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; item.group.add(g);
    item.add(G.shell, shellM, g); item.add(G.pad, padM, g); item.add(G.edge, edgeM, g);
  }
  item.painters.push(d2 => {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    paintPattern(c, 0, 0, w, h, d2, { unit: w / 1.1 });
    // inset frame + accent speed cuts
    c.strokeStyle = d2.accent; c.lineWidth = w * 0.025;
    c.beginPath(); c.roundRect(w * 0.07, h * 0.05, w * 0.86, h * 0.9, w * 0.16); c.stroke();
    c.fillStyle = d2.secondary;
    c.beginPath(); c.moveTo(0, h * 0.78); c.lineTo(w, h * 0.66); c.lineTo(w, h * 0.72); c.lineTo(0, h * 0.84); c.fill();
    const txt = d2.text || d2.chest || d2.name;
    if (txt) drawText(c, txt, w / 2, h * 0.25, w * 0.5, h * 0.075, d2, { color: d2.textColor }); // inside the shield's narrower top
    if (d2.number) drawText(c, d2.number, w / 2, h * 0.47, w * 0.56, h * 0.25, d2, { color: d2.textColor });
    padM.color.set(shade(d2.secondary, -0.35)); edgeM.color.set(d2.secondary);
    applySurfaceFinish(shellM, d2.finish);
  });
  Object.assign(item, { yaw: 0, heroYaw: -0.3, elev: 0.16, fit: 1.02 });
}

/* ------------------------------------------------------------------ */
/* GLOVES: goalkeeper glove, latex palm, padded fingers, strap cuff    */
/* back of the hand faces +Z, fingers up                              */
/* ------------------------------------------------------------------ */
function buildGloves(item, d) {
  const G = cached('glove', () => {
    // palm block: rounded superellipsoid
    const PA = [0.5, 0.52, 0.17];
    const palm = grid(64, 40, (u, v, t) => {
      const th = u * TAU, ph = (v - 0.5) * PI;
      const cp = spow(Math.cos(ph), 0.55), sp = spow(Math.sin(ph), 0.55);
      const z = PA[2] * cp * spow(Math.sin(th), 0.7) * (Math.sin(th) > 0 ? 1.12 : 0.9);
      t.set(PA[0] * cp * spow(Math.cos(th), 0.45) * (1 - 0.06 * (v < 0.5 ? 1 - v * 2 : 0)), PA[1] * sp, z);
      return [u, v];
    }, { outward: (u, v, p) => p.clone() });
    // fingers (palm side = -Z). u around: 0 back (+Z), 0.5 palm
    const finger = (x0, len, rad, spread, curl) => {
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const f = i / 6;
        pts.push(V(x0 + spread * f * f, 0.38 + len * f, -curl * f * f));
      }
      return sweep(pts, 32, 40, (v, a) => {
        let k = 1; if (v > 0.8) { const t = (v - 0.8) / 0.2; k = Math.sqrt(Math.max(0, 1 - t * t)); }
        const r = rad * (1 + 0.04 * Math.sin(v * PI * 3)) * k;
        return [Math.cos(a) * r * 0.86, Math.sin(a) * r];
      }, { up: V(0, 0, 1) });
    };
    const fingers = mergeGeos([finger(-0.345, 0.58, 0.128, -0.05, 0.1), finger(-0.115, 0.7, 0.134, -0.015, 0.12), finger(0.115, 0.66, 0.132, 0.015, 0.11), finger(0.345, 0.5, 0.12, 0.06, 0.09)]);
    const thumb = (() => {
      const pts = [V(-0.3, -0.18, -0.05), V(-0.5, 0.0, -0.08), V(-0.66, 0.22, -0.11), V(-0.74, 0.42, -0.14)];
      return sweep(pts, 32, 36, (v, a) => {
        let k = 1; if (v > 0.75) { const t = (v - 0.75) / 0.25; k = Math.sqrt(Math.max(0, 1 - t * t)); }
        const r = 0.145 * (1 - 0.12 * v) * k;
        return [Math.cos(a) * r * 0.86, Math.sin(a) * r];
      }, { up: V(0, 0, 1) });
    })();
    // cuff and strap
    const cuff = lathe(64, 20, v => [1, lerp(-0.42, -1.12, v)], { mod: (u, v) => 1, rx: 0.43 * 1, rz: 0.24 });
    const cuffG = cuff; cuffG.scale(1, 1, 1);
    const strap = grid(72, 12, (u, v, t) => {
      const a = u * TAU + PI, y = lerp(-0.88, -0.58, v), e = Math.sin(v * PI);
      t.set(Math.sin(a) * (0.47 + 0.035 * e), y, Math.cos(a) * (0.28 + 0.035 * e));
      return [u, v];
    }, { outward: (u, v, p) => V(p.x, 0, p.z) });
    const tab = new THREE.BoxGeometry(0.16, 0.26, 0.05, 2, 2, 2); tab.translate(0.5, -0.73, 0.12); tab.rotateY(0.0);
    return { palm, fingers, thumb, cuff: cuffG, strap, tab };
  });
  // shared mask canvas for the latex side (u 0.25..0.75) used as roughness
  const cv = item.canvas(512, 512), map = item.tex(cv);
  const fc = item.canvas(256, 256), fmap = item.tex(fc);
  const backM = item.mat({ map, roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.2, normalMap: item.ntex('grain', 10, 10), normalScale: new THREE.Vector2(0.1, 0.1) });
  backM.userData.base = { rough: 0.55, coat: 0.4, coatRough: 0.2 };
  const fingM = item.mat({ map: fmap, roughness: 0.6, clearcoat: 0.3, normalMap: item.ntex('grain', 4, 8), normalScale: new THREE.Vector2(0.3, 0.3) });
  item.add(G.palm, backM); item.add(G.fingers, fingM); item.add(G.thumb, fingM);
  const cuffC = item.canvas(1024, 256), cuffT = item.tex(cuffC);
  const cuffM = item.mat({ map: cuffT, roughness: 0.8, sheen: 0.8, sheenColor: new THREE.Color(0.3, 0.3, 0.3), normalMap: item.ntex('knit', 30, 6), normalScale: new THREE.Vector2(0.45, 0.45) });
  item.add(G.cuff, cuffM);
  const stC = item.canvas(1024, 128), stT = item.tex(stC);
  const strapM = item.mat({ map: stT, roughness: 0.5, clearcoat: 0.5, normalMap: item.ntex('grain', 30, 3), normalScale: new THREE.Vector2(0.2, 0.2) });
  item.add(G.strap, strapM);
  const tabM = item.mat({ color: 0xffffff, roughness: 0.5 }); item.add(G.tab, tabM);
  item.painters.push(d2 => {
    const latex = lum(d2.accent) > 0.25 ? mix(d2.accent, '#ffffff', 0.15) : '#e9ecef';
    // palm block: u around from +X: back (+Z) at u=0.25, palm (-Z) at u=0.75
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    paintPattern(c, 0, 0, w / 2, h, d2, { unit: w / 1.6 });
    c.fillStyle = latex; c.fillRect(w / 2, 0, w / 2, h);
    // backhand punch zone in secondary
    c.fillStyle = d2.secondary; c.beginPath(); c.ellipse(w * 0.25, h * 0.7, w * 0.16, h * 0.16, 0, 0, TAU); c.fill();
    c.strokeStyle = d2.accent; c.lineWidth = w * 0.012; c.stroke();
    const txt = d2.text || d2.chest || d2.name;
    // fingers: u around from back (+Z, u=0) ; palm half = latex
    const f = fc.getContext('2d'), fw = fc.width, fh = fc.height;
    f.fillStyle = d2.primary; f.fillRect(0, 0, fw, fh);
    f.fillStyle = d2.secondary; f.fillRect(0, fh * 0.05, fw, fh * 0.08);
    f.fillStyle = latex; f.fillRect(fw * 0.25, 0, fw * 0.5, fh);
    f.fillStyle = 'rgba(0,0,0,0.25)'; f.fillRect(fw * 0.245, 0, fw * 0.012, fh); f.fillRect(fw * 0.745, 0, fw * 0.012, fh);
    // cuff knit + strap print
    const k = cuffC.getContext('2d'), kw = cuffC.width, kh = cuffC.height;
    k.fillStyle = d2.primary; k.fillRect(0, 0, kw, kh);
    k.fillStyle = d2.secondary; k.fillRect(0, kh * 0.8, kw, kh * 0.08);
    const s = stC.getContext('2d'), sw = stC.width, sh = stC.height;
    s.fillStyle = d2.secondary; s.fillRect(0, 0, sw, sh);
    s.fillStyle = d2.accent; s.fillRect(0, sh * 0.1, sw, sh * 0.06); s.fillRect(0, sh * 0.84, sw, sh * 0.06);
    if (txt) drawText(s, txt, sw * 0.5, sh * 0.5, sw * 0.26, sh * 0.56, d2, { color: lum(d2.secondary) > 0.4 ? '#04282e' : '#ffffff' });
    tabM.color.set(d2.accent);
    applySurfaceFinish(backM, d2.finish);
  });
  Object.assign(item, { yaw: 0, heroYaw: -0.35, elev: 0.14, fit: 1.04 });
}

/* ------------------------------------------------------------------ */
/* BAG: padded duffel, zip track, handles, shoulder strap              */
/* ------------------------------------------------------------------ */
function buildBag(item, d) {
  const L = 1.0, RY = 0.5, RZ = 0.46;
  const G = cached('bag', () => {
    const at = (u, v, t) => {
      // straight body with rounded flat end panels: |t| < 0.82 is the wall, the rest rolls over the edge onto the end
      const th = u * TAU, tt = v * 2 - 1, at2 = Math.abs(tt), RE = 0.16;
      const be = at2 > 0.82 ? (at2 - 0.82) / 0.18 * PI / 2 : 0;
      const xs = Math.sign(tt) * ((L - RE) * Math.min(1, at2 / 0.82) + RE * spow(Math.sin(be), 0.45)) / L;
      const rs = spow(Math.cos(be), 0.45) * (1 - RE * 0.0);
      const s = Math.sin(th), c = Math.cos(th);
      const flatB = s < 0 ? 0.9 : 1;
      const puff = 1 + 0.03 * Math.sin(Math.min(1, at2 / 0.82) * PI / 2 + PI / 2) * (1 - Math.abs(c) ** 8) * 0 + 0.025 * (1 - Math.pow(Math.min(1, at2 / 0.82), 4));
      const er = 1 - (1 - rs) * 1; // radius shrink only on the end roll
      t.set(L * xs, RY * spow(s, 0.6) * flatB * er * puff + 0.02, RZ * spow(c, 0.7) * er * puff);
      return [u, v];
    };
    const body = grid(128, 96, at, { outward: (u, v, p) => p.clone() });
    // zip track along the top
    const top = []; for (let i = 0; i <= 30; i++) { const t = V(); at(0.25, lerp(0.1, 0.9, i / 30), t); t.y += 0.006; top.push(t); }
    const zip = tube(top, { radius: 0.03, flat: 0.35, seg: 120, radial: 10, up: V(0, 0, 1) });
    const pullT = V(); at(0.25, 0.8, pullT);
    const pull = new THREE.BoxGeometry(0.045, 0.02, 0.15, 1, 1, 1); pull.translate(pullT.x, pullT.y + 0.03, 0.09);
    const ring = new THREE.TorusGeometry(0.03, 0.008, 8, 16); ring.translate(pullT.x, pullT.y + 0.03, 0.18); ring.rotateX(0);
    // handles: one per side, meeting above the zip
    const handles = mergeGeos([1, -1].map(sd => tube([V(-0.36, 0.38, sd * 0.3), V(-0.3, 0.68, sd * 0.13), V(-0.1, 0.8, sd * 0.03), V(0.1, 0.8, sd * 0.03), V(0.3, 0.68, sd * 0.13), V(0.36, 0.38, sd * 0.3)], { radius: 0.036, seg: 80, radial: 12 })));
    const wrap = new THREE.CylinderGeometry(0.075, 0.075, 0.3, 20, 1); wrap.rotateZ(PI / 2); wrap.translate(0, 0.81, 0);
    // shoulder strap: flat webbing from end to end, arcing behind
    const sp = [V(-L - 0.03, 0.22, 0), V(-L + 0.02, 0.5, -0.3), V(-0.45, 0.68, -0.62), V(0.45, 0.68, -0.62), V(L - 0.02, 0.5, -0.3), V(L + 0.03, 0.22, 0)];
    const strap = sweep(sp, 8, 140, (v, a) => [Math.cos(a) * 0.012, Math.sin(a) * 0.06], { up: V(0, 0, 1) });
    const rings = mergeGeos([-1, 1].map(s => { const g = new THREE.TorusGeometry(0.06, 0.012, 8, 20); g.rotateY(PI / 2); g.translate(s * (L + 0.02), 0.22, 0); return g; }));
    return { body, zip, pull: mergeGeos([pull, ring]), handles, wrap, strap, rings };
  });
  const cv = item.canvas(1536, 768), map = item.tex(cv);
  const bodyM = item.mat({ map, roughness: 0.62, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.25, 0.25, 0.25), clearcoat: 0.15, normalMap: item.ntex('knit', 50, 30), normalScale: new THREE.Vector2(0.35, 0.35) });
  bodyM.userData.base = { rough: 0.62, coat: 0.15 };
  item.add(G.body, bodyM);
  const zipM = item.mat({ color: 0x15151a, roughness: 0.45, normalMap: item.ntex('knurl', 2, 120), normalScale: new THREE.Vector2(0.8, 0.8) });
  item.add(G.zip, zipM);
  const metal = item.mat({ color: 0xd4d8de, metalness: 1, roughness: 0.25 });
  item.add(G.pull, metal); item.add(G.rings, metal);
  const webM = item.mat({ color: 0x222222, roughness: 0.7, sheen: 0.6, sheenColor: new THREE.Color(0.3, 0.3, 0.3), normalMap: item.ntex('rib', 2, 80), normalScale: new THREE.Vector2(0.5, 0.5), side: THREE.DoubleSide });
  item.add(G.handles, webM); item.add(G.strap, webM);
  const wrapM = item.mat({ color: 0x222222, roughness: 0.6, normalMap: item.ntex('pebble', 3, 2), normalScale: new THREE.Vector2(0.5, 0.5) });
  item.add(G.wrap, wrapM);
  item.painters.push(d2 => {
    // canvas: x = around (u: 0 front +Z ... 0.25 top ... 0.5 back ... 0.75 bottom), y = along length (v)
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    c.save(); c.translate(0, h); c.scale(1, -1); // canvas y == v
    paintPattern(c, 0, 0, w, h, d2, { unit: w / 3.0 });
    // bottom panel and end panels
    c.fillStyle = shade(d2.secondary, -0.1); c.fillRect(w * 0.62, h * 0.1, w * 0.26, h * 0.8);
    c.fillStyle = d2.secondary; c.fillRect(0, 0, w, h * 0.095); c.fillRect(0, h * 0.905, w, h * 0.095);
    c.fillStyle = d2.accent; c.fillRect(0, h * 0.095, w, h * 0.008); c.fillRect(0, h * 0.897, w, h * 0.008);
    c.fillRect(w * 0.615, h * 0.1, w * 0.006, h * 0.8); c.fillRect(w * 0.88, h * 0.1, w * 0.006, h * 0.8);
    // side print on the front face (u = 0 wraps; front spans u in [0.9,1] U [0,0.1]) -> draw centred at x=0 and x=w
    const txt = d2.text || d2.chest || d2.name;
    for (const x0 of [0, w]) {
      c.save(); c.translate(x0, h / 2); c.rotate(PI / 2);
      if (txt) drawText(c, txt, 0, 0, h * 0.62, w * 0.11, d2, { color: d2.textColor });
      if (d2.subtext) drawText(c, d2.subtext.toUpperCase(), 0, w * 0.085, h * 0.4, w * 0.03, { ...d2, font: 'modern' }, { color: d2.textColor, outline: false });
      c.restore();
    }
    c.restore();
    webM.color.set(d2.secondary); wrapM.color.set(shade(d2.secondary, -0.3));
    applySurfaceFinish(bodyM, d2.finish === 'metallic' ? 'gloss' : d2.finish);
  });
  Object.assign(item, { yaw: 0, heroYaw: -0.4, elev: 0.22, fit: 1.0 });
}

/* ------------------------------------------------------------------ */
/* BOTTLE: lathe squeeze bottle with grip waist and sport cap          */
/* ------------------------------------------------------------------ */
function buildBottle(item, d) {
  const G = cached('bottle', () => {
    const P = [[0, 0], [0.3, 0.0], [0.37, 0.03], [0.4, 0.1], [0.405, 0.5], [0.36, 0.7], [0.345, 0.78], [0.36, 0.86], [0.405, 1.05], [0.405, 1.42], [0.37, 1.55], [0.29, 1.64], [0.27, 1.7]];
    const pr = spline(P.map((p, i) => [i, p[0]])), py = spline(P.map((p, i) => [i, p[1]]));
    const body = lathe(96, 140, v => { const t = v * (P.length - 1); return [Math.max(0.0001, pr(t)), py(t)]; }, { a0: PI, vmap: (v, y) => y / 1.7 });
    const ribs = 48;
    const cap = lathe(ribs * 4, 30, v => {
      const pts = [[0.27, 1.66], [0.305, 1.68], [0.31, 1.72], [0.31, 1.86], [0.29, 1.9], [0.2, 1.93], [0.13, 1.94], [0.0001, 1.945]];
      const t = v * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(t)), f = t - i;
      return [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)];
    }, { a0: PI, mod: (u, v) => 1 + (v > 0.2 && v < 0.6 ? 0.025 * Math.pow(Math.abs(Math.cos(u * PI * ribs)), 0.6) : 0) });
    const spout = lathe(48, 20, v => {
      const pts = [[0.1, 1.9], [0.1, 2.06], [0.085, 2.1], [0.05, 2.12], [0.0001, 2.122]];
      const t = v * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(t)), f = t - i;
      return [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)];
    }, { a0: PI });
    const band = lathe(96, 6, v => [0.316 + 0.004 * Math.sin(v * PI), lerp(1.73, 1.79, v)], { a0: PI });
    // carry loop on the cap
    const loop = tube([V(0.3, 1.86, 0), V(0.42, 1.95, 0), V(0.47, 2.06, 0), V(0.4, 2.12, 0), V(0.3, 2.06, 0), V(0.25, 1.95, 0)], { radius: 0.025, seg: 60, radial: 10, flat: 0.6, up: V(0, 0, 1) });
    return { body, cap, spout, band, loop };
  });
  const cv = item.canvas(1024, 768), map = item.tex(cv);
  const bodyM = item.mat({ map, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.12, sheen: 0.2, sheenColor: new THREE.Color(0.3, 0.3, 0.3) });
  bodyM.userData.base = { rough: 0.32, coat: 0.7, coatRough: 0.12 };
  item.add(G.body, bodyM);
  const capM = item.mat({ color: 0x222222, roughness: 0.45, clearcoat: 0.4 });
  item.add(G.cap, capM); item.add(G.loop, capM);
  const spM = item.mat({ color: 0xffffff, roughness: 0.4, clearcoat: 0.3 });
  item.add(G.spout, spM);
  const metalM = item.mat({ color: 0xd4d8de, metalness: 1, roughness: 0.18 });
  item.add(G.band, metalM);
  item.painters.push(d2 => {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    // canvas x: around (0.5 = front), y: top of bottle at the top (v = profile param, 0 base)
    const Y = y => (1 - y / 1.7) * h; // approx: profile v ~ height
    c.fillStyle = d2.primary; c.fillRect(0, 0, w, h);
    const lab0 = Y(1.38), lab1 = Y(0.14);
    paintPattern(c, 0, lab0, w, lab1 - lab0, d2, { unit: w / 2.6 });
    c.fillStyle = d2.secondary; c.fillRect(0, Y(0.83), w, Y(0.73) - Y(0.83));
    c.fillStyle = d2.accent; c.fillRect(0, lab0 - h * 0.012, w, h * 0.012); c.fillRect(0, lab1, w, h * 0.012);
    const txt = d2.text || d2.chest || d2.name;
    if (txt) drawText(c, txt, w * 0.5, Y(1.12), w * 0.27, h * 0.13, d2, { color: d2.textColor });
    if (d2.subtext || d2.number) drawText(c, (d2.subtext || '#' + d2.number).toUpperCase(), w * 0.5, Y(0.45), w * 0.3, h * 0.035, { ...d2, font: 'modern' }, { color: d2.textColor, outline: false });
    // volume marks on the side
    c.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 5; i++) c.fillRect(w * 0.76, Y(0.3 + i * 0.2), w * 0.03, h * 0.004);
    capM.color.set(d2.secondary); spM.color.set(lum(d2.accent) > 0.3 ? d2.accent : '#f4f5f7');
    applySurfaceFinish(bodyM, d2.finish);
  });
  Object.assign(item, { yaw: 0, heroYaw: -0.2, elev: 0.18, fit: 1.02 });
}

/* ------------------------------------------------------------------ */
/* PUCK                                                                */
/* ------------------------------------------------------------------ */
function buildPuck(item, d) {
  const R = 1, Hh = 0.33, bev = 0.05;
  const G = cached('puck', () => {
    // side band (knurled) with rounded rims; top/bottom discs
    const side = lathe(128, 24, v => {
      const y = lerp(-Hh, Hh, v), e = Math.max(0, Math.abs(y) - (Hh - bev)) / bev;
      return [R - bev * (1 - Math.sqrt(Math.max(0, 1 - e * e))), y];
    });
    const disc = s => grid(128, 20, (u, v, t) => {
      const a = u * TAU, r = (1 - v) * (R - bev);
      t.set(Math.sin(a) * r, s * (Hh + 0.0005 * (1 - v)), Math.cos(a) * r);
      return [0.5 + Math.sin(a) * r / R / 2 * s, 0.5 - Math.cos(a) * r / R / 2];
    }, { outward: () => V(0, s, 0) });
    return { side, top: disc(1), bot: disc(-1) };
  });
  const sideM = item.mat({ color: 0x18181a, roughness: 0.62, normalMap: item.ntex('knurl', 64, 2), normalScale: new THREE.Vector2(0.7, 0.7), sheen: 0.3, sheenColor: new THREE.Color(0.2, 0.2, 0.2) });
  sideM.userData.base = { rough: 0.62 };
  const cv = item.canvas(1024, 1024), map = item.tex(cv);
  const topM = item.mat({ map, roughness: 0.5, normalMap: item.ntex('grain', 6, 6), normalScale: new THREE.Vector2(0.25, 0.25) });
  topM.userData.base = { rough: 0.5, coat: 0.2 };
  const botM = item.mat({ color: 0x141416, roughness: 0.6, normalMap: item.ntex('grain', 6, 6), normalScale: new THREE.Vector2(0.3, 0.3) });
  item.add(G.side, sideM); item.add(G.top, topM); item.add(G.bot, botM);
  item.painters.push(d2 => {
    const c = cv.getContext('2d'), S = cv.width, cx = S / 2;
    c.fillStyle = d2.primary; c.fillRect(0, 0, S, S);
    c.save(); c.beginPath(); c.arc(cx, cx, S * 0.47, 0, TAU); c.clip();
    paintPattern(c, 0, 0, S, S, d2, { unit: S / 2.2, pattern: ['hex', 'halftone', 'camo', 'pinstripe', 'stripes', 'waves'].includes(d2.pattern) ? d2.pattern : 'solid' });
    c.globalAlpha = 0.35; c.fillStyle = d2.primary; c.fillRect(0, 0, S, S); c.globalAlpha = 1;
    c.restore();
    // printed rings
    c.lineWidth = S * 0.028; c.strokeStyle = d2.secondary; c.beginPath(); c.arc(cx, cx, S * 0.43, 0, TAU); c.stroke();
    c.lineWidth = S * 0.008; c.strokeStyle = d2.accent; c.beginPath(); c.arc(cx, cx, S * 0.395, 0, TAU); c.stroke();
    const txt = d2.text || d2.chest || d2.name;
    const tc = lum(d2.primary) > 0.4 ? '#04282e' : '#ffffff';
    if (txt) drawText(c, txt, cx, cx - S * 0.02, S * 0.62, S * 0.2, d2, { color: d2.textColor || tc });
    if (d2.subtext) drawText(c, d2.subtext.toUpperCase(), cx, cx + S * 0.15, S * 0.4, S * 0.045, { ...d2, font: 'modern' }, { color: d2.accent, outline: false });
    if (d2.number) drawText(c, d2.number, cx, cx - S * 0.25, S * 0.2, S * 0.09, d2, { color: d2.accent });
    sideM.color.set(mix('#141416', d2.primary, 0.025)); botM.color.set(mix('#141416', d2.primary, 0.025));
    applySurfaceFinish(topM, d2.finish);
    topM.clearcoatRoughness = 0.28; topM.roughness = Math.max(topM.roughness, 0.42);
  });
  Object.assign(item, { heroYaw: 0, yaw: 0, tilt: 0.5, elev: 0.28, fit: 1.32 });
}

/* ------------------------------------------------------------------ */
/* registry                                                            */
/* ------------------------------------------------------------------ */
const BUILDERS = {
  jersey: (it, d) => buildTorso(it, d, 'jersey'),
  'jersey-long': (it, d) => buildTorso(it, d, 'long'),
  'jersey-tank': (it, d) => buildTorso(it, d, 'tank'),
  hoodie: (it, d) => buildTorso(it, d, 'hoodie'),
  'ball-soccer': buildBall, 'ball-basketball': buildBall, 'ball-football': buildBall, 'ball-volleyball': buildBall, 'ball-baseball': buildBall,
  puck: buildPuck,
  cleats: (it, d) => buildShoe(it, d, 'cleat'),
  sneakers: (it, d) => buildShoe(it, d, 'sneaker'),
  socks: buildSocks, shorts: buildShorts, cap: buildCap, beanie: buildBeanie,
  shinguards: buildShinguards, gloves: buildGloves, bag: buildBag, bottle: buildBottle,
};

/* ------------------------------------------------------------------ */
/* extension modules: each product family lives in ./gear/<name>.js   */
/* A module default-exports (K) => ({ shapes, builders, defaults, meta }) */
/* and its builders override the core ones above for the same shape.  */
/* Bump a module's number here whenever that file changes.            */
/* ------------------------------------------------------------------ */
const GEAR_MODULES = { equipment: 6, footwear: 2, socks: 2, skates: 2, apparel: 2 };
export const SHAPE_META = {};
const KIT = { THREE, TAU, PI, clamp, lerp, smooth, spow, V, rng, spline, SHAPES, PATTERNS, FONTS, SHAPE_DEFAULTS, isHex, cleanText, lum, shade, mix, loadFont, fontReady, fontStr, mkCanvas, paintPattern, letterFill, drawText, heightToNormal, hash2, vnoise, NORMALS, normalTex, patchMat, weldNormals, flipGeo, grid, fromCenter, tube, mergeGeos, placeGeo, loopBand, cached, Item, buildPatch, makePatchUpdater, rgbOf, hash3, vnoise3, applySurfaceFinish, capsuleGeo, lathe, pathFrames, sweep, CF, BALL_M, cubeDir, atlasUV, ballFrame, EMAX, SOCCER, BALLS, bakeBall, ballGeoFor, paintBall, buildBall, buildBaseballStitches, buildFootballLaces, shoeModel, shoeGeos, shoeGraphic, buildShoe, buildTorso, buildShinguards, buildGloves, buildBag, buildBottle, buildPuck };
{
  const mods = await Promise.allSettled(Object.entries(GEAR_MODULES).map(([n, v]) => import(`./gear/${n}.js?v=${v}`)));
  mods.forEach((r, i) => {
    const name = Object.keys(GEAR_MODULES)[i];
    if (r.status !== 'fulfilled') { console.error('gear module failed to load:', name, r.reason); return; }
    try {
      const ext = r.value.default(KIT) || {};
      for (const sh of ext.shapes || []) if (!SHAPES.includes(sh)) SHAPES.push(sh);
      Object.assign(BUILDERS, ext.builders || {});
      Object.assign(SHAPE_DEFAULTS, ext.defaults || {});
      Object.assign(SHAPE_META, ext.meta || {});
    } catch (e) { console.error('gear module failed to start:', name, e); }
  });
}
export const shapes = () => SHAPES.slice();
function geoKey(d) { return d.shape + (/^jersey(-long)?$/.test(d.shape) ? '|' + d.collar : ''); }
function buildItem(d, U, q) {
  const item = new Item(d, U, q);
  (BUILDERS[d.shape] || BUILDERS.jersey)(item, d);
  item.paint(d);
  return item;
}

/* ------------------------------------------------------------------ */
/* stage: scene, lights, env, camera framing                           */
/* ------------------------------------------------------------------ */
const LIGHTS = {
  // balanced so saturated brand colours stay saturated (lit side ~1x albedo) while whites stay white
  studio: { env: 0.6, exp: 0.88, key: ['#ffffff', 2.8], rim: ['#dfe8ff', 2.3], rim2: ['#ffffff', 0.7], fill: 0.3, shadow: 0.85 },
  stadium: { env: 0.55, exp: 0.92, key: ['#eef4ff', 3.6], rim: ['#ffffff', 3.0], rim2: ['#9fc2ff', 1.2], fill: 0.22, shadow: 1 },
  sunset: { env: 0.42, exp: 0.92, key: ['#ffad66', 3.4], rim: ['#ff5a47', 2.8], rim2: ['#3fb8ff', 1.2], fill: 0.18, shadow: 0.9 },
  neon: { env: 0.26, exp: 1.0, key: ['#7ef9ff', 2.0], rim: ['#ff5a47', 3.6], rim2: ['#c8f53c', 2.0], fill: 0.12, shadow: 0.7 },
};
const TONE_EXP = 0.94; // ACES needs a touch more exposure than the neutral curve the light rigs were balanced for
const envCache = new WeakMap();
function envFor(renderer) {
  if (!envCache.has(renderer)) {
    const pm = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const rt = pm.fromScene(room, 0.035);
    room.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    pm.dispose();
    envCache.set(renderer, rt);
  }
  return envCache.get(renderer).texture;
}
const VIEW_YAW = { front: 0, back: PI, side: -PI / 2 };

class Stage {
  constructor(renderer) {
    this.renderer = renderer;
    const s = this.scene = new THREE.Scene();
    s.environment = envFor(renderer);
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
    this.key = new THREE.DirectionalLight(0xffffff, 2); this.key.position.set(3.5, 5, 4.5);
    this.rim = new THREE.DirectionalLight(0xffffff, 2); this.rim.position.set(-5, 3.5, -4);
    this.rim2 = new THREE.DirectionalLight(0xffffff, 1); this.rim2.position.set(5, 0.5, -3);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 0.3);
    s.add(this.key, this.rim, this.rim2, this.hemi);
    this.pivot = new THREE.Group(); s.add(this.pivot);
    this.floater = new THREE.Group(); this.pivot.add(this.floater);
    const st = new THREE.CanvasTexture(shadowTexSource()); st.colorSpace = THREE.SRGBColorSpace;
    this.shadowMat = new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, toneMapped: false });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowMat);
    this.shadow.rotation.x = -PI / 2; this.shadow.renderOrder = -1;
    s.add(this.shadow);
    this.item = null; this.radius = 1.6; this.groundY = -1.2; this.shadowOpacity = 1;
    this.setLighting('studio');
  }
  setItem(item) {
    if (this.item) this.item.dispose();
    this.item = item;
    const holder = new THREE.Group();
    holder.add(item.group);
    item.group.rotation.y = item.yaw || 0;
    if (item.tilt) item.group.rotation.x = item.tilt;
    if (item.roll) item.group.rotation.z = item.roll;
    this.floater.clear(); this.floater.add(holder);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(V()), c = box.getCenter(V());
    const sc = 2.4 / Math.max(size.x, size.y, size.z);
    holder.scale.setScalar(sc);
    holder.position.set(-c.x * sc, -c.y * sc, -c.z * sc);
    holder.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(holder);
    const sph = b2.getBoundingSphere(new THREE.Sphere());
    // fit using horizontal radius (item spins about Y) and vertical half height
    let rh = 0;
    holder.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere.clone().applyMatrix4(o.matrixWorld);
      rh = Math.max(rh, Math.hypot(bs.center.x, bs.center.z) + bs.radius * 0.6);
    });
    this.radius = Math.max(sph.radius * 0.82, Math.min(rh, sph.radius), (b2.max.y - b2.min.y) / 2 * 1.08);
    if (item.fit) { // compact products: fit the true bounding sphere around the box centre
      let rv = 0; const p = V();
      holder.traverse(o => {
        if (!o.isMesh) return;
        const pa = o.geometry.attributes.position, stp = Math.max(1, Math.floor(pa.count / 4000));
        for (let i = 0; i < pa.count; i += stp) { p.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); rv = Math.max(rv, p.length()); }
      });
      this.radius = Math.max(rv * item.fit, (b2.max.y - b2.min.y) / 2 * 1.1);
    }
    this.groundY = b2.min.y - 0.02;
    const fw = Math.max(b2.max.x - b2.min.x, b2.max.z - b2.min.z);
    this.shadow.scale.set(fw * 1.25, fw * 1.25, 1);
    this.shadowSize = fw * 1.25;
    this.shadow.position.y = this.groundY;
    this.elev = item.elev != null ? item.elev : 0.16;
  }
  setLighting(name) {
    const L = LIGHTS[name] || LIGHTS.studio;
    this.lighting = name;
    this.scene.environmentIntensity = L.env;
    this.renderer.toneMappingExposure = L.exp * TONE_EXP;
    this.key.color.set(L.key[0]); this.key.intensity = L.key[1];
    this.rim.color.set(L.rim[0]); this.rim.intensity = L.rim[1];
    this.rim2.color.set(L.rim2[0]); this.rim2.intensity = L.rim2[1];
    this.hemi.intensity = L.fill;
    this.shadowOpacity = L.shadow;
  }
  frame(yaw, pitch, zoom, aspect, floatY = 0) {
    this.pivot.rotation.y = yaw;
    this.floater.position.y = floatY;
    this.shadow.rotation.z = yaw;
    const k = 1 - clamp(floatY * 2.5, -0.3, 0.3);
    this.shadow.scale.set(this.shadowSize * (2 - k), this.shadowSize * (2 - k), 1);
    this.shadowMat.opacity = this.shadowOpacity * k;
    const cam = this.camera;
    cam.aspect = aspect;
    const fov = cam.fov * PI / 180;
    let dist = this.radius / Math.sin(fov / 2);
    if (aspect < 1) dist /= Math.max(0.45, aspect) ;
    dist *= zoom;
    const el = clamp(this.elev + pitch, -0.35, 1.0);
    cam.position.set(0, Math.sin(el) * dist, Math.cos(el) * dist);
    cam.near = dist / 20; cam.far = dist * 4;
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }
}
function setupRenderer(r) {
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping; // filmic roll-off: saturated kit colours stay rich, highlights stay clean
  r.setClearColor(0x000000, 0);
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */
let supportCache = null;
export function supported() {
  if (supportCache != null) return supportCache;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    supportCache = !!gl;
    const ext = gl && gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
  } catch (e) { supportCache = false; }
  return supportCache;
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mount(container, design, opts = {}) {
  const o = Object.assign({ interactive: true, motion: true, view: 'front', autoRotate: false, background: null, preserveDrawingBuffer: false }, opts);
  let d = normalize(design);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!o.preserveDrawingBuffer, powerPreference: 'high-performance' });
  setupRenderer(renderer);
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;' + (o.interactive ? 'cursor:grab;touch-action:pan-y;' : '');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D preview of ' + d.shape.replace('-', ' '));
  container.appendChild(canvas);
  const stage = new Stage(renderer);
  const U = makeUniforms();
  let item = null, gk = '';
  let disposed = false;

  const st = {
    yaw: VIEW_YAW[o.view] != null ? VIEW_YAW[o.view] : 0, target: null, vel: 0, pitch: 0, zoom: 1, zoomTarget: 1,
    motion: (o.motion !== false) && !reducedMotion(), motionAmt: 0, t: 0, last: 0,
    auto: !!o.autoRotate, manual: false, visible: true, raf: 0, dirty: true, drag: null,
  };
  st.motionAmt = st.motion ? 1 : 0;

  function setBackground(bg) {
    if (bg) renderer.setClearColor(new THREE.Color(bg), 1); else renderer.setClearColor(0x000000, 0);
    st.dirty = true; kick();
  }
  setBackground(o.background);

  function rebuild() {
    item = buildItem(d, U, 1);
    gk = geoKey(d);
    stage.setItem(item);
    stage.setLighting(d.lighting);
    st.dirty = true; kick();
  }
  rebuild();
  let fontKey = null;
  function fontsFor(dd) {
    if (fontKey === dd.font && fontReady(dd.font)) return;
    fontKey = dd.font;
    if (!fontReady(dd.font)) loadFont(dd.font).then(() => { if (!disposed && d.font === dd.font) { item.paint(d); st.dirty = true; kick(); } });
  }
  fontsFor(d);

  let paintTimer = 0, lastPaint = 0;
  function schedulePaint() {
    const now = performance.now();
    clearTimeout(paintTimer);
    const run = () => { lastPaint = performance.now(); if (!disposed) { item.paint(d); st.dirty = true; kick(); } };
    if (now - lastPaint > 90) run(); else paintTimer = setTimeout(run, 90);
  }

  function size() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    st.dirty = true;
  }
  size();

  function animating() {
    return st.motion || st.motionAmt > 0.001 || (st.auto && !st.manual) || Math.abs(st.vel) > 1e-4 || st.target != null || Math.abs(st.zoom - st.zoomTarget) > 1e-4 || !!st.drag;
  }
  function step(now) {
    const dt = st.last ? Math.min(0.1, (now - st.last) / 1000) : 0;
    st.last = now;
    st.motionAmt = lerp(st.motionAmt, st.motion ? 1 : 0, 1 - Math.exp(-dt * 3));
    if (st.motionAmt > 0.001) st.t += dt;
    if (!st.drag && !st.manual) {
      if (st.target != null) {
        const diff = st.target - st.yaw;
        st.yaw += diff * (1 - Math.exp(-dt * 7));
        if (Math.abs(diff) < 0.002) { st.yaw = st.target; st.target = null; }
      } else {
        if (Math.abs(st.vel) > 1e-4) { st.yaw += st.vel * dt; st.vel *= Math.exp(-dt * 3.2); }
        if (st.auto) st.yaw += dt * 0.45;
      }
    }
    st.zoom += (st.zoomTarget - st.zoom) * (1 - Math.exp(-dt * 10));
    const m = st.motionAmt, t = st.t;
    U.uTime.value = t; U.uWind.value = m;
    U.uFlex.value = (Math.sin(t * 1.7) * 0.5 + 0.5) * m;
    const ph = (t % 4.8) / 4.8;
    U.uSweep.value = ph < 0.55 ? lerp(-4.5, 4.5, ph / 0.55) : 99; U.uSweepAmt.value = 0.9 * m;
    if (item && item.spinner) item.spinner.rotation.y += dt * 0.55 * m;
    st.sway = (st.manual || st.auto) ? 0 : Math.sin(t * 0.42) * 0.32 * m;
    st.floatY = Math.sin(t * 1.25) * 0.05 * m;
  }
  function render() {
    const w = canvas.width, h = canvas.height;
    stage.frame(st.yaw + (st.sway || 0), st.pitch, st.zoom, w / h, st.floatY || 0);
    renderer.render(stage.scene, stage.camera);
    st.dirty = false;
  }
  function loop(now) {
    st.raf = 0;
    if (disposed || !st.visible || document.hidden) { st.last = 0; return; }
    step(now);
    render();
    if (animating()) st.raf = requestAnimationFrame(loop); else st.last = 0;
  }
  function kick() { if (!st.raf && !disposed && st.visible && !document.hidden) st.raf = requestAnimationFrame(loop); }

  const ro = new ResizeObserver(() => { size(); kick(); }); ro.observe(container);
  const io = new IntersectionObserver(es => { st.visible = es[es.length - 1].isIntersecting; if (st.visible) kick(); }); io.observe(container);
  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', onVis);

  // interaction
  const ptrs = new Map();
  let pinch0 = 0, zoom0 = 1;
  const onDown = e => {
    if (!o.interactive) return;
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.manual) { st.manual = false; st.auto = !!o.autoRotate; }
    st.target = null; st.vel = 0;
    st.drag = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = st.zoomTarget; }
    canvas.style.cursor = 'grabbing';
    kick();
  };
  const onMove = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const dd = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) st.zoomTarget = clamp(zoom0 * pinch0 / dd, 0.5, 1.7);
      return;
    }
    const now = performance.now(), dx = e.clientX - st.drag.x, dy = e.clientY - st.drag.y, dt = Math.max(1, now - st.drag.t) / 1000;
    const k = 6 / Math.max(300, canvas.clientWidth);
    st.yaw += dx * k;
    st.vel = lerp(st.vel, dx * k / dt, 0.5);
    if (e.pointerType === 'mouse') st.pitch = clamp(st.pitch + dy * k * 0.6, -0.45, 0.7);
    st.drag = { x: e.clientX, y: e.clientY, t: now };
    kick();
  };
  const onUp = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) {
      if (st.drag && performance.now() - st.drag.t > 80) st.vel = 0;
      st.drag = null; canvas.style.cursor = o.interactive ? 'grab' : '';
      kick();
    }
  };
  const onWheel = e => {
    if (!o.interactive) return;
    e.preventDefault();
    st.zoomTarget = clamp(st.zoomTarget * Math.exp(e.deltaY * 0.0012), 0.5, 1.7); kick();
  };
  if (o.interactive) {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
  }

  const handle = {
    canvas,
    get design() { return d; },
    update(design2) {
      if (disposed) return;
      const nd = normalize(design2);
      const prev = d; d = nd;
      if (geoKey(nd) !== gk) { rebuild(); fontsFor(nd); return; }
      if (nd.lighting !== prev.lighting) { stage.setLighting(nd.lighting); st.dirty = true; kick(); }
      fontsFor(nd);
      if (JSON.stringify({ ...nd, lighting: 0 }) !== JSON.stringify({ ...prev, lighting: 0 })) schedulePaint();
    },
    setView(v) {
      const base = VIEW_YAW[v] != null ? VIEW_YAW[v] : 0;
      const cur = st.yaw;
      st.target = base + Math.round((cur - base) / TAU) * TAU;
      st.vel = 0; st.manual = false; st.auto = false; st.pitch = 0;
      kick();
    },
    zoom(stepv) { st.zoomTarget = clamp(st.zoomTarget * (stepv > 0 ? 0.85 : 1 / 0.85), 0.5, 1.7); kick(); },
    setMotion(on) { st.motion = !!on; kick(); },
    setLighting(name) { d = { ...d, lighting: LIGHTS[name] ? name : 'studio' }; stage.setLighting(d.lighting); st.dirty = true; kick(); },
    setBackground,
    setAngle(rad) { st.yaw = +rad || 0; st.target = null; st.vel = 0; st.manual = true; st.auto = false; st.dirty = true; kick(); },
    setPose(p = {}) {
      if (p.yaw != null) { st.yaw = +p.yaw; st.target = null; st.vel = 0; st.manual = true; st.auto = false; }
      if (p.pitch != null) st.pitch = clamp(+p.pitch, -0.45, 0.7);
      if (p.zoom != null) st.zoom = st.zoomTarget = clamp(+p.zoom, 0.5, 1.7);
      st.dirty = true; kick();
    },
    renderNow() { if (disposed) return; step(performance.now()); render(); },
    // Deterministic frame for video export: pose and motion come from sec, never from the wall clock.
    renderAt(sec) {
      if (disposed) return;
      st.last = 0; st.motionAmt = st.motion ? 1 : 0; st.t = +sec || 0;
      step(0);
      if (item && item.spinner) item.spinner.rotation.y = st.t * 0.55 * st.motionAmt;
      render(); st.last = 0;
    },
    snapshot(w, h) {
      return new Promise(res => {
        w = Math.round(w || canvas.width); h = Math.round(h || canvas.height);
        const pr = renderer.getPixelRatio(), cw = canvas.width, ch = canvas.height;
        renderer.setPixelRatio(1); renderer.setSize(w, h, false);
        render();
        const url = canvas.toDataURL('image/png');
        renderer.setPixelRatio(pr); renderer.setSize(cw / pr, ch / pr, false);
        render();
        res(url);
      });
    },
    resize() { size(); kick(); },
    dispose() {
      if (disposed) return; disposed = true;
      cancelAnimationFrame(st.raf); clearTimeout(paintTimer);
      ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('wheel', onWheel);
      if (item) item.dispose();
      stage.shadow.geometry.dispose(); stage.shadowMat.map.dispose(); stage.shadowMat.dispose();
      const env = envCache.get(renderer); if (env) { env.dispose(); envCache.delete(renderer); }
      renderer.dispose(); renderer.forceContextLoss();
      canvas.remove();
    },
  };
  return handle;
}

// ---- thumbnails: one shared offscreen renderer, serial queue, memory cache
let T = null;
function thumbCtx() {
  if (T) return T;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  setupRenderer(renderer);
  renderer.setPixelRatio(1);
  const stage = new Stage(renderer);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); T = null; });
  T = { canvas, renderer, stage };
  return T;
}
const thumbCache = new Map();
let thumbQueue = Promise.resolve();
export function thumb(design, size = 480) {
  size = Math.max(32, Math.min(2048, Math.round(size) || 480));
  const raw = design || {};
  const key = JSON.stringify(raw) + '|' + size;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const p = thumbQueue = thumbQueue.catch(() => {}).then(async () => {
    const d = normalize(raw);
    await loadFont(d.font);
    const ctx = thumbCtx();
    const item = buildItem(d, makeUniforms(), size <= 560 ? 0.5 : 1);
    const { stage, renderer, canvas } = ctx;
    stage.setItem(item);
    stage.setLighting(d.lighting);
    const view = raw.view;
    const yaw = VIEW_YAW[view] != null ? VIEW_YAW[view] : (item.heroYaw != null ? item.heroYaw : -0.6);
    renderer.setSize(size, size, false);
    stage.frame(yaw, view && VIEW_YAW[view] != null ? 0 : 0.06, 1, 1, 0);
    renderer.render(stage.scene, stage.camera);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    stage.item = null; item.dispose();
    return blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
  });
  thumbCache.set(key, p);
  p.catch(() => thumbCache.delete(key));
  return p;
}

/* ------------------------------------------------------------------ */
/* 2D fallback                                                         */
/* ------------------------------------------------------------------ */
export function draw2D(canvas, design) {
  const d = normalize(design);
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const s = Math.min(W, H) / 10, cx = W / 2, cy = H / 2;
  const sh = ctx.createRadialGradient(cx, cy + 4.3 * s, 0, cx, cy + 4.3 * s, 3.5 * s);
  sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sh; ctx.fillRect(0, 0, W, H);
  const path = new Path2D();
  const sp = d.shape;
  const P = (x, y) => [cx + x * s, cy + y * s];
  const poly = pts => pts.forEach(([x, y], i) => { const [a, b] = P(x, y); i ? path.lineTo(a, b) : path.moveTo(a, b); });
  let label = d.text || d.chest || d.name, round = false;
  if (/^jersey|hoodie/.test(sp)) {
    const sl = sp === 'jersey-tank' ? 0 : sp === 'jersey' ? 1 : 2;
    if (sl === 0) poly([[-1.3, -3.6], [-0.6, -3.6], [0, -3], [0.6, -3.6], [1.3, -3.6], [1.6, -2], [2.2, -1.2], [2.2, 4], [-2.2, 4], [-2.2, -1.2], [-1.6, -2]]);
    else if (sl === 1) poly([[-1.1, -3.6], [0, -3.1], [1.1, -3.6], [2.5, -3.2], [4, -1.2], [3, -0.4], [2.3, -1.2], [2.3, 4], [-2.3, 4], [-2.3, -1.2], [-3, -0.4], [-4, -1.2], [-2.5, -3.2]]);
    else poly([[-1.1, -3.6], [0, -3.1], [1.1, -3.6], [2.5, -3.2], [3.6, 2.6], [2.8, 2.8], [2.3, -1], [2.3, 4], [-2.3, 4], [-2.3, -1], [-2.8, 2.8], [-3.6, 2.6], [-2.5, -3.2]]);
    path.closePath();
  } else if (sp === 'shorts') {
    poly([[-2.4, -2.6], [2.4, -2.6], [2.9, 2.8], [0.4, 3.1], [0, 0.4], [-0.4, 3.1], [-2.9, 2.8]]); path.closePath();
  } else if (/^ball|puck/.test(sp)) {
    path.arc(cx, cy, 3.4 * s, 0, TAU); round = true;
  } else if (sp === 'cleats' || sp === 'sneakers') {
    poly([[-3.8, 1.8], [-3.9, -0.4], [-3.3, -1.6], [-1.4, -1.5], [0.2, -0.6], [2.8, 0.2], [4, 1.2], [3.9, 2.2], [-3.8, 2.2]]); path.closePath();
  } else if (sp === 'socks') {
    poly([[-1.2, -4], [0.6, -4], [0.6, 1.4], [3, 1.6], [3.3, 2.6], [2.8, 3.4], [-0.6, 3.4], [-1.3, 2.4]]); path.closePath();
  } else if (sp === 'cap' || sp === 'beanie') {
    path.moveTo(...P(-3, 1)); path.bezierCurveTo(...P(-3, -3.2), ...P(3, -3.2), ...P(3, 1)); path.closePath();
    if (sp === 'cap') { path.moveTo(...P(0.5, 1)); path.quadraticCurveTo(...P(4.2, 0.8), ...P(4.6, 1.8)); path.lineTo(...P(0.5, 1.8)); path.closePath(); }
  } else {
    const r = 1.2 * s; path.roundRect(cx - 3.4 * s, cy - 2.6 * s, 6.8 * s, 5.2 * s, r);
  }
  ctx.save(); ctx.clip(path);
  paintPattern(ctx, cx - 4.5 * s, cy - 4.5 * s, 9 * s, 9 * s, d, { unit: s * 3 });
  const g = round ? ctx.createRadialGradient(cx - 1.2 * s, cy - 1.4 * s, s * 0.3, cx, cy, 3.6 * s) : ctx.createLinearGradient(cx - 4 * s, 0, cx + 4 * s, 0);
  if (round) { g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)'); }
  else { g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.35, 'rgba(255,255,255,0.12)'); g.addColorStop(0.65, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (label) drawText(ctx, label, cx, cy - (round ? 0 : 0.6 * s), 4 * s, 1.1 * s, d);
  if (d.number && /^jersey|hoodie|shorts/.test(sp)) drawText(ctx, d.number, cx, cy + 1.3 * s, 2.6 * s, 2 * s, d);
  ctx.restore();
  ctx.lineWidth = Math.max(1, s * 0.08); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke(path);
  if (!fontReady(d.font)) loadFont(d.font).then(ok => { if (ok) draw2D(canvas, design); });
}

if (typeof window !== 'undefined') window.Gear3D = { supported, mount, thumb, draw2D, normalize };
