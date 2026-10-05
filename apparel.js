// SquadForge gear module: apparel (wristbands, hoodie, knee pads, training gloves).
// Original procedural models, no real brand marks.
// Loaded by gear3d.js through GEAR_MODULES: default export (K) => ({ shapes, builders, defaults, meta }).
// Self-contained: every helper comes in through the kit K.

export default function apparel(K) {
  const { THREE, TAU, PI, V, lerp, clamp, smooth, spow, spline, grid, tube, mergeGeos, placeGeo, cached, paintPattern, drawText,
    lum, shade, mix, makePatchUpdater, pathFrames, weldNormals, NORMALS, heightToNormal, vnoise } = K;

  /* ---------------------------------------------------------------- */
  /* shared helpers                                                    */
  /* ---------------------------------------------------------------- */
  const C = (k, fn) => cached('ap:' + k, fn);
  const col = c => new THREE.Color(c);
  const N2 = (a, b = a) => new THREE.Vector2(a, b);
  const label = d => d.text || d.chest || d.name || '';
  const frac = x => x - Math.floor(x);

  // terry cloth: dense little loops over a soft noise
  if (!NORMALS.terry) {
    NORMALS.terry = () => heightToNormal(256, (u, v) => {
      const n = 32, cx = u * n, cy = v * n + (Math.floor(u * n) % 2) * 0.5;
      const fx = frac(cx) - 0.5, fy = frac(cy) - 0.5;
      const loop = Math.exp(-(fx * fx + fy * fy) * 11);
      return loop * 0.75 + 0.45 * vnoise(u * 64, v * 64, 64) + 0.25 * vnoise(u * 128, v * 128, 128);
    }, 2.6);
  }
  // fine jersey/fleece face: low, even grain (no visible repeat)
  if (!NORMALS.fleece) {
    NORMALS.fleece = () => heightToNormal(256, (u, v) => 0.6 * vnoise(u * 96, v * 96, 96) + 0.4 * vnoise(u * 192, v * 192, 192) + 0.15 * Math.sin(u * TAU * 64), 1.4);
  }
  // stretch knit with a raised honeycomb (sleeves of knee pads, glove backs)
  if (!NORMALS.spacer) {
    NORMALS.spacer = () => heightToNormal(256, (u, v) => {
      const cx = u * 16, cy = v * 16 * 0.866 * 2, row = Math.floor(cy);
      const fx = frac(cx + (row % 2) * 0.5) - 0.5, fy = frac(cy) - 0.5;
      return -Math.exp(-(fx * fx + fy * fy) * 16) + 0.12 * vnoise(u * 128, v * 128, 128);
    }, 2.4);
  }

  function surfMat(item, o = {}) {
    const p = { color: col(o.color || '#ffffff'), roughness: o.rough != null ? o.rough : 0.8, metalness: o.metal || 0, side: o.side || THREE.FrontSide };
    if (o.map) p.map = o.map;
    if (o.normal) { p.normalMap = item.ntex(o.normal, o.nx || 4, o.ny || o.nx || 4); p.normalScale = N2(o.ns != null ? o.ns : 0.4); }
    if (o.sheen) { p.sheen = o.sheen; p.sheenRoughness = o.sheenRough || 0.55; p.sheenColor = col(o.sheenColor || '#555555'); }
    if (o.coat) { p.clearcoat = o.coat; p.clearcoatRoughness = o.coatRough != null ? o.coatRough : 0.2; }
    const m = item.mat(p, o.patch);
    m.userData.base = { rough: p.roughness, coat: o.coat || 0, coatRough: o.coatRough, metal: o.metal || 0 };
    return m;
  }
  function ctex(item, w, h) { const cv = item.canvas(w, h); return { cv, tex: item.tex(cv), ctx: cv.getContext('2d') }; }
  // soft mottling so solid fabrics are not flat CG colour
  function mottle(c, w, h, seed, amt = 0.05, n = 900) {
    let s = seed >>> 0; const R = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    c.save();
    for (let i = 0; i < n; i++) {
      c.fillStyle = R() < 0.5 ? `rgba(0,0,0,${amt * R()})` : `rgba(255,255,255,${amt * 0.7 * R()})`;
      const r = (1 + R() * 3) * (w / 1024);
      c.fillRect(R() * w, R() * h, r * 2, r);
    }
    c.restore();
  }

  // thread / print colour that reads on the primary (and on the secondary too when a pattern mixes them)
  const cdist = (a, b) => { const x = col(a), y = col(b); return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b) + Math.abs(lum(a) - lum(b)) * 1.5; };
  function inkFor(d, patterned) {
    let best = null, bs = -1;
    for (const [c, bias] of [[d.secondary, 0.12], [d.accent, 0.06], ['#ffffff', 0], ['#0b1020', 0]]) {
      const s = Math.min(cdist(c, d.primary), patterned ? cdist(c, d.secondary) : 9) + bias;
      if (s > bs) { bs = s; best = c; }
    }
    return best;
  }

  // closed band around a ring. ring(u) -> { p, n, a } : wall midline point, outward unit, axis unit (band height direction).
  // Stadium section: half height hh along a, half thickness ht along n (rolled edges).
  // v runs around the section; the outer face is centred at v = 0.5 and spans bandOuter(hh, ht) of v.
  function bandOuter(hh, ht) { const s = 2 * (hh - ht); return s / (2 * s + TAU * ht); }
  function band(ring, hh, ht, nu, nv, o = {}) {
    const R = []; for (let i = 0; i <= nu; i++) R.push(ring(i / nu));
    const r = ht, st = 2 * (hh - r), L = 2 * st + TAU * r;
    const sec = (s, out) => { // s in [0,1) -> [dn, da]
      let k = s * L;
      if (k < st / 2) { out[0] = -r; out[1] = -k; return out; } k -= st / 2;
      if (k < PI * r) { const al = k / r; out[0] = -r * Math.cos(al); out[1] = -(hh - r) - r * Math.sin(al); return out; } k -= PI * r;
      if (k < st) { out[0] = r; out[1] = -(hh - r) + k; return out; } k -= st;
      if (k < PI * r) { const al = k / r; out[0] = r * Math.cos(al); out[1] = (hh - r) + r * Math.sin(al); return out; } k -= PI * r;
      out[0] = -r; out[1] = (hh - r) - k; return out;
    };
    const q = [0, 0];
    const g = grid(nu, nv, (u, v, t) => {
      const Q = R[Math.round(u * nu)];
      sec(v % 1, q);
      let dn = q[0], da = q[1];
      if (o.puff) dn += o.puff * Math.sign(dn) * Math.max(0, Math.cos(clamp(da / hh, -1, 1) * PI / 2)) * Math.min(1, Math.abs(dn) / r);
      if (o.mod) { const m = o.mod(u, da / hh, dn / r); dn += m; }
      t.copy(Q.p).addScaledVector(Q.n, dn).addScaledVector(Q.a, da);
      return [u, v];
    }, { outward: (u, v, P) => P.clone().sub(R[Math.round(u * nu)].p) });
    return g;
  }

  // satin-stitch embroidery: colour layer + bump layer (thread direction lines inside the glyphs)
  function embroider(colC, bumpC, draw, color, q) {
    const c = colC.getContext('2d'), b = bumpC.getContext('2d');
    const w = colC.width, h = colC.height;
    c.clearRect(0, 0, w, h); b.fillStyle = '#000'; b.fillRect(0, 0, bumpC.width, bumpC.height);
    draw(c, color);
    // thread shading on the colour layer
    c.save(); c.globalCompositeOperation = 'source-atop';
    const step = Math.max(2, 3 * q);
    for (let x = -h; x < w + h; x += step) {
      c.strokeStyle = 'rgba(0,0,0,0.16)'; c.lineWidth = step * 0.35; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + h * 0.45, h); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = step * 0.25; c.beginPath(); c.moveTo(x + step * 0.5, 0); c.lineTo(x + step * 0.5 + h * 0.45, h); c.stroke();
    }
    c.restore();
    // bump: raised glyphs with soft shoulders and stitch lines
    b.save(); b.filter = `blur(${Math.max(1, 1.5 * q)}px)`; draw(b, '#b0b0b0'); b.restore();
    b.save(); b.globalCompositeOperation = 'source-over'; draw(b, '#ffffff'); b.globalCompositeOperation = 'multiply';
    for (let x = -h; x < w + h; x += step) { b.strokeStyle = '#9a9a9a'; b.lineWidth = step * 0.3; b.beginPath(); b.moveTo(x, 0); b.lineTo(x + h * 0.45, h); b.stroke(); }
    b.restore();
  }

  /* ---------------------------------------------------------------- */
  /* WRISTBANDS: pair of soft terry bands, embroidered number          */
  /* ---------------------------------------------------------------- */
  const WB = { R: 0.4, hh: 0.4, ht: 0.036 };
  function wristGeo() {
    return C('wristband', () => band(u => {
      const a = (u - 0.5) * TAU; // u = 0.5 faces +Z
      const wob = 1 + 0.012 * Math.sin(2 * a + 0.6) + 0.006 * Math.sin(3 * a - 1.1);
      const s = Math.sin(a), c = Math.cos(a);
      return { p: V(s * WB.R * wob, 0.006 * Math.sin(2 * a + 1.3), c * WB.R * wob), n: V(s, 0, c), a: V(0, 1, 0) };
    }, WB.hh, WB.ht, 128, 72, {
      puff: 0.012,
      // soft fabric: shallow lengthwise waves on the outer face, gathered a touch at the rolled edges
      mod: (u, y, n) => (n > 0 ? 0.0035 * Math.sin(u * TAU * 9 + y * 1.5) * Math.cos(y * PI / 2) : 0),
    }));
  }
  function buildWristbands(item, d) {
    const G = wristGeo();
    const T = ctex(item, 1024, 512);
    const m = surfMat(item, { map: T.tex, rough: 0.95, normal: 'terry', nx: 5, ny: 3, ns: 0.9, sheen: 1, sheenRough: 0.4, sheenColor: '#6a6a6a' });
    const EC = item.canvas(1024, 512), EB = item.canvas(1024, 512);
    const embM = item.printMat(item.tex(EC), { bump: item.tex(EB), push: 0.004 });
    embM.bumpScale = 3;
    const one = spin => {
      const g = new THREE.Group(), sp = new THREE.Group(); sp.rotation.y = spin; g.add(sp);
      sp.add(new THREE.Mesh(G, m)); const e = new THREE.Mesh(G, embM); e.renderOrder = 2; sp.add(e); return g;
    };
    // A stands upright; B lies on its side in front, a touch squashed by its own softness
    const A = one(-0.62), B = one(PI - 1.1);
    A.position.set(-0.36, 0, -0.34);
    B.rotation.set(0, 0.93 + PI, PI / 2, 'YXZ'); B.scale.set(0.89, 1, 1.05);
    B.updateMatrix();
    const Ro = WB.R + WB.ht, pts = [];
    for (let i = 0; i < 96; i++) for (const y of [-WB.hh, -WB.hh * 0.5, 0, WB.hh * 0.5, WB.hh]) {
      const a = i / 96 * TAU, rr = Ro - (Math.abs(y) > WB.hh * 0.9 ? WB.ht : 0);
      pts.push(V(Math.sin(a) * rr, y, Math.cos(a) * rr).applyMatrix4(B.matrix));
    }
    const minY = Math.min(...pts.map(p => p.y)), dir = V(0.9, 0, 1).normalize();
    let k = 0;
    for (let it = 0; it < 300; it++, k += 0.01) { // slide B out of A, leave a hair of air
      const ox = A.position.x + dir.x * k, oz = A.position.z + dir.z * k;
      if (!pts.some(p => p.y - minY < WB.hh * 2 && Math.hypot(p.x + ox - A.position.x, p.z + oz - A.position.z) < Ro + 0.02)) break;
    }
    B.position.set(A.position.x + dir.x * k, -WB.hh - minY, A.position.z + dir.z * k);
    item.group.add(A, B);
    const f = bandOuter(WB.hh, WB.ht);
    item.painters.push(d2 => {
      const c = T.ctx, w = T.cv.width, h = T.cv.height;
      c.fillStyle = d2.primary; c.fillRect(0, 0, w, h);
      const y0 = h * (0.5 - f / 2), fh = h * f;
      const pat = ['stripes', 'hoops', 'gradient', 'camo', 'halftone', 'waves', 'chevron', 'split', 'pinstripe'].includes(d2.pattern) ? d2.pattern : 'solid';
      if (pat === 'hoops') { // classic tri-stripe band
        paintPattern(c, 0, y0, w, fh, d2, { pattern: 'solid' });
        c.fillStyle = d2.secondary; c.fillRect(0, y0 + fh * 0.2, w, fh * 0.12); c.fillRect(0, y0 + fh * 0.68, w, fh * 0.12);
      } else paintPattern(c, 0, y0, w, fh, d2, { unit: w / 4.5, pattern: pat });
      mottle(c, w, h, 11, 0.06, 1400);
      // a quiet stitched channel near each rolled edge
      c.save(); c.setLineDash([w * 0.006, w * 0.004]); c.lineWidth = Math.max(1, h * 0.004); c.strokeStyle = 'rgba(0,0,0,0.22)';
      for (const yy of [y0 + fh * 0.035, y0 + fh * 0.965]) { c.beginPath(); c.moveTo(0, yy); c.lineTo(w, yy); c.stroke(); }
      c.restore();
      const txt = d2.number || label(d2);
      const tc = inkFor(d2, pat !== 'solid');
      embroider(EC, EB, (cx, colr) => {
        if (txt) drawText(cx, txt, EC.width * 0.5, EC.height * 0.5, EC.width * (d2.number ? 0.11 : 0.2), fh * 0.42, d2, { color: colr, outline: false });
      }, tc, item.q);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.12, elev: 0.3, fit: 1.0 });
  }

  /* ---------------------------------------------------------------- */
  /* HOODIE: pullover on a ghost form, hood down, kangaroo pocket       */
  /* front +Z, wearer's left on +X                                     */
  /* ---------------------------------------------------------------- */
  const HD = { HEM: -1.25, YTOP: 1.12, ys: 0.6, band: 0.22 };
  function hoodieModel() {
    const { HEM, ys } = HD;
    const W = spline([[-1.25, 0.84], [-1.02, 0.875], [-0.6, 0.865], [0, 0.875], [0.4, 0.9], [0.75, 0.92]]);
    const D = spline([[-1.25, 0.35], [-0.95, 0.375], [-0.4, 0.37], [0.15, 0.415], [0.5, 0.42], [0.75, 0.4]]);
    const gath = y => 1 - 0.052 * (1 - smooth(HEM + 0.17, HEM + 0.36, y)); // body gathers into the rib hem
    const sec = (th, y, out) => {
      const s = Math.sin(th), c = Math.cos(th), g = gath(y);
      out.x = W(y) * spow(s, 0.8) * g; out.z = D(y) * spow(c, 0.8) * (c < 0 ? 0.94 : 1) * g; return out;
    };
    const rx = 0.29, rz = 0.235, cz = -0.06, yb = 1.04;
    const neck = (th, out = V()) => { const s = Math.sin(th), c = Math.cos(th); return out.set(rx * s, yb - 0.11 * Math.pow(Math.max(0, c), 1.6), cz + rz * c); };
    const neckN = th => { const N = neck(th); return V(N.x / (rx * rx), 0, (N.z - cz) / (rz * rz)).normalize(); };
    // arc-length tables at chest height (u: 0..0.5 front half, 0.5..1 back half)
    const mk = (a0, a1) => {
      const n = 400, L = [0], A = [a0], t = V(), pr = V(); sec(a0, 0.3, pr);
      for (let i = 1; i <= n; i++) { const a = lerp(a0, a1, i / n); sec(a, 0.3, t); L.push(L[i - 1] + Math.hypot(t.x - pr.x, t.z - pr.z)); A.push(a); pr.copy(t); }
      const tot = L[n];
      const f = q => { const target = q * tot; let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] < target) lo = m; else hi = m; } const k = (target - L[lo]) / ((L[hi] - L[lo]) || 1); return lerp(A[lo], A[hi], k); };
      const inv = a => { const k = clamp((a - a0) / (a1 - a0), 0, 1) * n, i = Math.min(n - 1, Math.floor(k)); return lerp(L[i], L[i + 1], k - i) / tot; };
      return { tot, f, inv };
    };
    const front = mk(-PI / 2, PI / 2), back = mk(PI / 2, 1.5 * PI);
    const theta = u => (u <= 0.5 ? front.f(u * 2) : back.f((u - 0.5) * 2));
    const uOf = th => { th = Math.atan2(Math.sin(th), Math.cos(th)); if (Math.abs(th) <= PI / 2) return front.inv(th) * 0.5; return 0.5 + back.inv(th < 0 ? th + TAU : th) * 0.5; };
    // soft drape: a few long vertical folds low on the sides and back, none across the pocket
    const fold = (th, y) => {
      const side = smooth(0.85, 1.4, Math.abs(Math.atan2(Math.sin(th), Math.cos(th))));
      const low = 1 - smooth(-1.0, 0.3, y);
      return (0.011 * Math.sin(th * 7 + 0.4 + y * 0.9) + 0.005 * Math.sin(th * 13 - y * 2.5)) * low * side * smooth(HEM + 0.12, HEM + 0.4, y);
    };
    const wallPt = (th, y, out) => {
      sec(th, y, out);
      const f = fold(th, y);
      if (f) { const w = W(y), dd = D(y); const nx = out.x / (w * w), nz = out.z / (dd * dd), l = Math.hypot(nx, nz) || 1; out.x += nx / l * f; out.z += nz / l * f; }
      out.y = y; return out;
    };
    // shoulder cap: quadratic bezier from the side wall (vertical tangent) to the neckline, sloping like a shoulder
    const capPt = (th, f, out) => {
      const S = wallPt(th, ys, V()), N = neck(th);
      const run = Math.hypot(S.x - N.x, S.z - N.z), side = Math.abs(Math.sin(th));
      const cy = clamp(N.y - run * lerp(0.62, 0.36, side), ys + 0.02, N.y - 0.01);
      const a = (1 - f) * (1 - f), b = 2 * f * (1 - f), c = f * f;
      out.set(a * S.x + b * S.x + c * N.x, a * S.y + b * cy + c * N.y, a * S.z + b * S.z + c * N.z);
      // a soft rounded shoulder (slight crown between neck and shoulder point)
      out.y += 0.025 * Math.sin(f * PI) * side;
      return out;
    };
    // front surface z for a point (x, y) on the wall (pocket, prints)
    const frontTh = (x, y) => { const w = W(y) * gath(y); return Math.asin(clamp(spow(clamp(x / w, -1, 1), 1.25), -1, 1)); };
    return { W, D, sec, neck, neckN, rx, rz, cz, yb, theta, uOf, wallPt, capPt, frontTh, Lf: front.tot, Lb: back.tot };
  }
  function hoodProfile(M, th) {
    // one column of the lowered hood: from the neck seam (t = 0) to the face-opening rim (t = 1).
    // sides: a standing collar. back: the hood drops down the back, curls at the crown and rises again to the rim.
    const ath = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
    const b = smooth(0.95, 2.45, ath), fr = 1 - smooth(0.05, 1.15, ath);
    const N = M.neck(th), rh = M.neckN(th), up = V(0, 1, 0);
    const phS = 0.42 + 0.5 * fr;
    const ph0 = lerp(phS, PI - 0.2, b), ph1 = lerp(phS, -0.1, b);
    const A = 0.56 * Math.max(0, 1 - Math.pow((PI - ath) / (PI - 0.85), 2)) * b * b, rc = 0.048, dph = ph1 - ph0, Cl = Math.abs(dph) * rc;
    const Hr = lerp(lerp(0.05, 0.17, smooth(0.04, 1.35, ath)), 0.1, b);
    const curl = (s, o) => { // integrated offsets after arc s along the curl
      if (Math.abs(dph) < 1e-4 || Cl < 1e-6) { o[0] = s * Math.sin(ph0); o[1] = s * Math.cos(ph0); return ph0; }
      const ph = ph0 + dph * s / Cl, k = Cl / dph;
      o[0] = k * (Math.cos(ph0) - Math.cos(ph)); o[1] = k * (Math.sin(ph) - Math.sin(ph0)); return ph;
    };
    const o = [0, 0]; curl(Cl, o);
    const dyAC = A * Math.cos(ph0) + o[1];
    const B = Math.max(0.03, (Hr - dyAC) / Math.max(0.35, Math.cos(ph1)));
    const L = A + Cl + B;
    const at = (t, out = V(), nrm) => {
      let s = t * L, r, y, ph;
      if (s <= A) { r = s * Math.sin(ph0); y = s * Math.cos(ph0); ph = ph0; }
      else if (s <= A + Cl) { ph = curl(s - A, o); r = A * Math.sin(ph0) + o[0]; y = A * Math.cos(ph0) + o[1]; }
      else { curl(Cl, o); const k = s - A - Cl; r = A * Math.sin(ph0) + o[0] + k * Math.sin(ph1); y = A * Math.cos(ph0) + o[1] + k * Math.cos(ph1); ph = ph1; }
      // the hanging part spreads sideways into a soft rounded pouch
      const dn = Math.max(0, -y);
      out.copy(N).addScaledVector(rh, r).addScaledVector(up, y);
      out.x += N.x * (1.0 * Math.pow(Math.sin(PI * clamp(s / L, 0, 1)), 0.8) + 0.6 * dn) * b;
      out.z -= 0.04 * Math.sin(Math.min(1, s / Math.max(1e-3, A + Cl)) * PI) * b; // fullness
      if (nrm) nrm.copy(rh).multiplyScalar(Math.cos(ph)).addScaledVector(up, -Math.sin(ph)).normalize();
      return out;
    };
    return { at, L, Hr, b };
  }
  function hoodieGeos() {
    return C('hoodie', () => {
      const M = hoodieModel(), { HEM, YTOP, ys } = HD;
      const R1 = 50, R2 = 16, nv = R1 + R2, nu = 100;
      const yB = HEM + HD.band - 0.05;
      const vOf = y => (y - HEM) / (YTOP - HEM);
      const body = grid(nu, nv, (u, v, t) => {
        const j = Math.round(v * nv), th = M.theta(u);
        if (j <= R1) { M.wallPt(th, lerp(yB, ys, j / R1), t); return [u, vOf(t.y)]; }
        M.capPt(th, (j - R1) / R2, t);
        // keep vertical prints/stripes straight over the chest and upper back (no fan into the neckline)
        const sn = Math.sin(th), k = 1 - sn * sn, a = Math.asin(clamp(spow(clamp(t.x / (M.W(ys) * 0.98), -1, 1), 1.25), -1, 1));
        const ux = Math.cos(th) >= 0 ? M.uOf(a) : M.uOf(PI - a);
        return [lerp(u, ux, k * k), vOf(t.y)];
      }, { outward: (u, v, p) => V(p.x, 0, p.z + 0.05) });
      // rib hem band
      const hemY = HEM + HD.band / 2;
      const hem = band(u => {
        const th = M.theta(u), p = M.sec(th, hemY, V()); p.y = hemY;
        const w = M.W(hemY), dd = M.D(hemY);
        return { p: p.multiplyScalar(1.0).setY(hemY), n: V(p.x / (w * w), 0, p.z / (dd * dd)).normalize(), a: V(0, 1, 0) };
      }, HD.band / 2, 0.024, 128, 20);
      // sleeves
      const sleeves = [], cuffs = [], sl = [];
      for (const side of [-1, 1]) {
        const ctrl = [V(0.42, 0.6, -0.03), V(0.84, 0.5, -0.03), V(1.0, -0.05, 0.0), V(1.1, -0.55, 0.05), V(1.16, -0.98, 0.07)].map(p => V(p.x * side, p.y, p.z));
        const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
        const NV = 60, pts = []; for (let j = 0; j <= NV; j++) pts.push(curve.getPointAt(j / NV));
        const F = pathFrames(pts, V(0, 0, 1));
        const Rr = spline([[0, 0.25], [0.12, 0.275], [0.4, 0.232], [0.68, 0.205], [0.86, 0.19], [0.95, 0.178], [1, 0.152]]);
        const secAt = (v, a, out) => {
          const j = clamp(Math.round(v * NV), 0, NV);
          const gather = smooth(0.74, 0.92, v) * (1 - smooth(0.975, 1, v));
          const ripple = 1 + gather * (0.03 * Math.sin(v * 70 + 1.6 * Math.sin(a * 2 + v * 9)) + 0.012 * Math.sin(a * 3 + v * 40))
            + 0.012 * Math.sin(a * 2 + 0.5) * smooth(0.35, 0.55, v) * (1 - smooth(0.55, 0.75, v)); // soft elbow crease
          const r = Rr(v) * ripple;
          return out.copy(pts[j]).addScaledVector(F.N[j], Math.cos(a) * r * 0.92).addScaledVector(F.B[j], Math.sin(a) * r);
        };
        const g = grid(40, NV, (u, v, t) => { secAt(v, u * TAU, t); return [u, v]; }, { outward: (u, v, p) => p.clone().sub(pts[Math.round(v * NV)]) });
        sleeves.push(g);
        const end = pts[NV], T = F.T[NV];
        const cc = end.clone().addScaledVector(T, 0.07);
        cuffs.push(band(u => {
          const a = u * TAU, n = F.N[NV].clone().multiplyScalar(Math.cos(a) * 0.92).addScaledVector(F.B[NV], Math.sin(a));
          const nn = n.clone().normalize();
          return { p: cc.clone().addScaledVector(n, 0.142), n: nn, a: T.clone() };
        }, 0.1, 0.022, 56, 16));
        sl.push({ secAt, side, pts, F, NV });
      }
      // hood
      const th0 = 0.07, HU = 100, HV = 36;
      const hp = []; for (let i = 0; i <= HU; i++) hp.push(hoodProfile(M, lerp(th0, TAU - th0, i / HU)));
      const nTmp = V();
      const hood = grid(HU, HV, (u, v, t) => { hp[Math.round(u * HU)].at(v, t); return [u, v]; },
        { outward: (u, v) => { hp[Math.round(u * HU)].at(v, V(), nTmp); return nTmp.clone(); } });
      // lining layer: the hood is two plies of fleece, so the free edge has real thickness
      const HT = 0.032, thk = v => HT * smooth(0, 0.3, v);
      const inPt = (i, v, t = V()) => { hp[i].at(v, t, nTmp); return t.addScaledVector(nTmp, -thk(v)); };
      const hoodIn = grid(HU, HV, (u, v, t) => { inPt(Math.round(u * HU), v, t); return [u, v]; },
        { outward: (u, v) => { hp[Math.round(u * HU)].at(v, V(), nTmp); return nTmp.clone().negate(); } });
      const mid = (i, v) => { const a = hp[i].at(v, V(), nTmp); return a.addScaledVector(nTmp, -thk(v) / 2); };
      const edge = [];
      for (let i = 0; i <= 10; i++) edge.push(mid(0, i / 10));
      for (let i = 1; i < HU; i++) edge.push(mid(i, 1));
      for (let i = 10; i >= 0; i--) edge.push(mid(HU, i / 10));
      const nE = edge.length - 1;
      const rim = tube(edge, { rFn: v => { const k = Math.min(v, 1 - v) * nE; return (k < 10 ? lerp(0.006, HT / 2 + 0.003, smooth(0, 10, k)) : HT / 2 + 0.003); }, seg: 300, radial: 10 });
      // kangaroo pocket (front panel stands slightly proud, open slanted sides)
      const pY0 = HEM + HD.band - 0.02, pY1 = -0.36;
      const pk = (u, v, t) => {
        const y = lerp(pY0, pY1, v), hw = lerp(0.6, 0.38, Math.pow(v, 0.85)), x = (u * 2 - 1) * hw;
        const th = M.frontTh(x, y); M.wallPt(th, y, t);
        const off = 0.008 + 0.024 * Math.pow(Math.sin(v * PI), 0.8) * (0.7 + 0.3 * Math.sin(u * PI)) + 0.014 * Math.sin(v * PI) * (1 - Math.sin(u * PI));
        const n = V(t.x / (M.W(y) ** 2) * 0.5, 0, t.z / (M.D(y) ** 2)).normalize();
        t.addScaledVector(n, off);
        return [M.uOf(th), vOf(y)];
      };
      const pocket = grid(32, 24, pk, { outward: () => V(0, 0, 1) });
      const pocketEdge = mergeGeos([0, 1].map(s => { const ps = []; for (let i = 0; i <= 24; i++) { const t = V(); pk(s, i / 24, t); ps.push(t); } return tube(ps, { radius: 0.013, seg: 48, radial: 8 }); }));
      // drawcords: out of eyelets low on the hood front, hanging over the chest
      const ray = new THREE.Raycaster(), tmpM = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      const hits = [new THREE.Mesh(body, tmpM), new THREE.Mesh(hood, tmpM)];
      const surfZ = (x, y) => { ray.set(V(x, y, 3), V(0, 0, -1)); const h = ray.intersectObjects(hits, false); return h.length ? h[0].point.z : M.D(y); };
      const eyelets = [], cords = [], aglets = [];
      for (const s of [-1, 1]) {
        const th = s * 0.36, P = hoodProfile(M, th), n = V();
        const e = P.at(0.42, V(), n);
        const ring = new THREE.TorusGeometry(0.019, 0.006, 8, 20); ring.rotateX(PI / 2); placeGeo(ring, e.clone().addScaledVector(n, 0.002), n);
        eyelets.push(ring);
        const len = s < 0 ? 0.42 : 0.37, pts = [e.clone().addScaledVector(n, 0.004)];
        const p1 = e.clone().addScaledVector(n, 0.03); p1.y -= 0.03; pts.push(p1);
        for (let i = 1; i <= 9; i++) {
          const f = i / 9, y = e.y - 0.05 - len * f, x = e.x * lerp(0.95, 0.72, f) + s * 0.012 * Math.sin(f * PI);
          pts.push(V(x, y, Math.max(surfZ(x, y), surfZ(x - 0.02, y), surfZ(x + 0.02, y)) + 0.016));
        }
        const cd = tube(pts, { radius: 0.0125, seg: 64, radial: 8, flat: 0.62, up: V(0, 0, 1) });
        cords.push(cd);
        const tip = pts[pts.length - 1], dir = tip.clone().sub(pts[pts.length - 2]).normalize();
        const ag = new THREE.CylinderGeometry(0.0145, 0.0125, 0.075, 14, 1); ag.translate(0, -0.03, 0);
        ag.applyMatrix4(new THREE.Matrix4().compose(tip, new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), dir), V(1, 1, 1)));
        aglets.push(ag);
      }
      tmpM.dispose();
      return { M, body, hem, sleeves: mergeGeos(sleeves), cuffs: mergeGeos(cuffs), sl, hood, hoodIn, rim, pocket, pocketEdge,
        eyelets: mergeGeos(eyelets), cords: mergeGeos(cords), aglets: mergeGeos(aglets), pY0, pY1 };
    });
  }
  function buildHoodie(item, d) {
    item.fabric = true;
    const G = hoodieGeos(), M = G.M, { HEM, YTOP } = HD;
    const CW = 2048, CH = Math.round(CW / 2 / M.Lf * (YTOP - HEM));
    const bodyC = item.canvas(CW, CH), printC = item.canvas(CW, CH), pocC = item.canvas(CW / 2, CH / 2);
    const bodyT = item.tex(bodyC), printT = item.tex(printC), pocT = item.tex(pocC);
    const fl = { normal: 'fleece', rx: 22, ry: 14, ns: 0.35, rough: 0.92 };
    const body = item.fabricMat(bodyT, fl);
    const pocM = item.fabricMat(pocT, fl);
    const lining = item.liningMat('#333333');
    item.add(G.body, body); item.add(G.body, lining);
    const pr = item.printMat(printT); item.add(G.body, pr).renderOrder = 2;
    item.add(G.pocket, pocM); item.add(G.pocket, lining);
    const slC = item.canvas(512, 768), slT = item.tex(slC);
    const slM = item.fabricMat(slT, { ...fl, rx: 10, ry: 14 });
    item.add(G.sleeves, slM); item.add(G.sleeves, lining);
    const rib = item.fabricMat(null, { normal: 'rib', rx: 36, ry: 1, ns: 0.75, rough: 0.9 });
    const cuffRib = item.fabricMat(null, { normal: 'rib', rx: 7, ry: 1, ns: 0.75, rough: 0.9 });
    item.add(G.hem, rib); item.add(G.cuffs, cuffRib);
    const hoodM = item.fabricMat(null, { ...fl, rx: 10, ry: 4 });
    const hoodLin = item.mat({ color: col('#333333'), roughness: 0.95, side: THREE.DoubleSide, sheen: 1, sheenRoughness: 0.6, sheenColor: col('#444444'),
      normalMap: item.ntex('fleece', 10, 4), normalScale: N2(0.5) }, { wind: 0.012 });
    item.add(G.hood, hoodM); item.add(G.hood, lining); item.add(G.hoodIn, hoodLin);
    const rimM = item.fabricMat(null, { normal: 'rib', rx: 60, ry: 1, ns: 0.4, rough: 0.9 });
    item.add(G.rim, rimM); item.add(G.pocketEdge, rimM);
    const cordM = item.mat({ color: 0xffffff, roughness: 0.75, sheen: 1, sheenColor: col('#666666'), normalMap: item.ntex('knurl', 1, 40), normalScale: N2(0.6) }, { wind: 0.012 });
    item.add(G.cords, cordM);
    const metalM = item.mat({ color: 0xd9dde2, metalness: 1, roughness: 0.28 }, { wind: 0.012 });
    item.add(G.eyelets, metalM); item.add(G.aglets, metalM);
    // sleeve patch (wearer's left upper arm, facing out and slightly forward)
    {
      const S = G.sl[1], v = 0.27, a = -1.1;
      const pos = S.secAt(v, a, V()), p2 = S.secAt(v, a + 0.05, V()), p3 = S.secAt(v + 0.02, a, V());
      const n = p2.clone().sub(pos).cross(p3.clone().sub(pos)).normalize();
      const j = Math.round(v * S.NV); if (n.dot(pos.clone().sub(S.pts[j])) < 0) n.negate();
      makePatchUpdater(item, { pos: pos.addScaledVector(n, 0.012), normal: n, up: S.F.T[j].clone().negate() }, 0.1);
    }
    item.painters.push(d2 => {
      const ctx = bodyC.getContext('2d'), w = bodyC.width, h = bodyC.height, pxu = w / 2 / M.Lf;
      paintPattern(ctx, 0, 0, w / 2, h, d2, { unit: pxu, seed: 3 });
      paintPattern(ctx, w / 2, 0, w / 2, h, d2, { unit: pxu, mirror: true, seed: 5 });
      mottle(ctx, w, h, 5, 0.03, 2500);
      const yy = y => (YTOP - y) / (YTOP - HEM) * h, PX = x => M.uOf(M.frontTh(x, -0.7)) * w;
      // pocket panel copy (before shadows), then its own stitching
      const pc = pocC.getContext('2d'); pc.drawImage(bodyC, 0, 0, pocC.width, pocC.height);
      const sc = pocC.width / w;
      const thread = lum(d2.primary) > 0.45 ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.28)';
      pc.save(); pc.scale(sc, sc); pc.setLineDash([pxu * 0.022, pxu * 0.014]); pc.lineWidth = Math.max(1.5, pxu * 0.006); pc.strokeStyle = thread;
      pc.beginPath();
      for (const off of [0.025, 0.045]) { pc.moveTo(PX(-0.36), yy(G.pY1 - off)); pc.lineTo(PX(0.36), yy(G.pY1 - off)); }
      pc.stroke(); pc.restore();
      // under-pocket shadow on the body (seen through the hand openings) and the body seams
      for (const s of [-1, 1]) {
        const g = ctx.createLinearGradient(PX(s * 0.62), 0, PX(s * 0.45), 0);
        g.addColorStop(0, 'rgba(0,0,0,0.0)'); g.addColorStop(0.35, 'rgba(0,0,0,0.38)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(PX(s * 0.62), yy(G.pY0)); ctx.lineTo(PX(s * 0.4), yy(G.pY1)); ctx.lineTo(PX(s * 0.3), yy(G.pY1)); ctx.lineTo(PX(s * 0.5), yy(G.pY0)); ctx.closePath(); ctx.fill();
      }
      ctx.save(); ctx.setLineDash([pxu * 0.022, pxu * 0.014]); ctx.lineWidth = Math.max(1.5, pxu * 0.006); ctx.strokeStyle = thread;
      ctx.beginPath(); ctx.moveTo(0, yy(HEM + HD.band + 0.03)); ctx.lineTo(w, yy(HEM + HD.band + 0.03)); ctx.stroke(); ctx.restore();
      // sleeves
      const sx = slC.getContext('2d'), sw = slC.width, sh = slC.height;
      const pat = ['stripes', 'pinstripe', 'hoops', 'camo', 'hex', 'halftone'].includes(d2.pattern) ? d2.pattern : 'solid';
      paintPattern(sx, 0, 0, sw, sh, { ...d2, primary: d2.sleeve }, { unit: sw / 1.5, pattern: pat });
      mottle(sx, sw, sh, 9, 0.03, 600);
      // colours
      const P = d2.primary, ribC = shade(P, lum(P) > 0.5 ? -0.06 : -0.02);
      body.sheenColor.set(shade(P, 0.15)).multiplyScalar(0.5); pocM.sheenColor.copy(body.sheenColor);
      slM.sheenColor.set(shade(d2.sleeve, 0.15)).multiplyScalar(0.5);
      hoodM.color.set(P); hoodM.sheenColor.copy(body.sheenColor);
      rib.color.set(ribC); rib.sheenColor.copy(body.sheenColor);
      cuffRib.color.set(shade(d2.sleeve, lum(d2.sleeve) > 0.5 ? -0.06 : -0.02)); cuffRib.sheenColor.copy(slM.sheenColor);
      rimM.color.set(ribC); rimM.sheenColor.copy(body.sheenColor);
      lining.color.set(shade(P, -0.6));
      hoodLin.color.set(shade(mix(P, '#808080', 0.25), -0.28)); hoodLin.sheenColor.set(shade(P, 0.3)).multiplyScalar(0.4);
      const cordC = lum(P) > 0.55 ? (lum(d2.secondary) < 0.4 ? d2.secondary : '#1b1f27') : (lum(d2.accent) > 0.35 ? d2.accent : '#f4f5f7');
      cordM.color.set(cordC); cordM.sheenColor.set(shade(cordC, 0.3)).multiplyScalar(0.5);
      // print layer: chest graphic front, name + number on the back below the hood
      const p = printC.getContext('2d'); p.clearRect(0, 0, w, h);
      const tc = d2.textColor, fx = w * 0.25, bx = w * 0.75;
      const chest = d2.chest || d2.text;
      if (chest) drawText(p, chest, fx, yy(0.3), 1.0 * pxu, 0.24 * pxu, d2, { color: tc });
      if (d2.subtext) drawText(p, d2.subtext.toUpperCase(), fx, yy(0.14), 0.7 * pxu, 0.055 * pxu, { ...d2, font: 'modern' }, { color: tc, outline: false });
      if (d2.name) drawText(p, d2.name, bx, yy(0.3), 1.1 * pxu, 0.19 * pxu, d2, { color: tc, arc: 3.2 * pxu });
      if (d2.number) drawText(p, d2.number, bx, yy(-0.25), 1.0 * pxu, 0.62 * pxu, d2, { color: tc, strokeW: 0.07 });
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.5, elev: 0.14 });
  }

  /* ---------------------------------------------------------------- */
  /* KNEE PADS: contoured knit sleeves (knee slightly bent) with a      */
  /* segmented foam pad built into the front. Pad faces +Z.            */
  /* ---------------------------------------------------------------- */
  const KP = { NU: 112, NV: 84, T: 0.075 };
  function kneeModel() {
    const ctrl = [V(0, -0.56, -0.07), V(0, -0.26, -0.005), V(0, 0.02, 0.02), V(0, 0.3, -0.01), V(0, 0.58, -0.09)];
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const NV = KP.NV, pts = []; for (let j = 0; j <= NV; j++) pts.push(curve.getPointAt(j / NV));
    const F = pathFrames(pts, V(0, 0, 1)); // N ~ front (+Z), B ~ side
    const Rr = spline([[0, 0.33], [0.2, 0.335], [0.45, 0.35], [0.62, 0.36], [0.85, 0.375], [1, 0.38]]);
    // pad: rounded rectangle in (a, v) with three quilted segments
    const PA = 1.0, PV0 = 0.2, PV1 = 0.8;
    const padH = (a, v) => {
      const x = a / PA, y = (v - (PV0 + PV1) / 2) / ((PV1 - PV0) / 2);
      const e = Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(y), 4), 0.25); // 1 at the rim
      if (e >= 1) return 0;
      let h = Math.pow(smooth(1, 0.62, e), 0.9) * (1 - 0.22 * x * x);
      for (const g of [-0.36, 0.36]) h *= 1 - 0.55 * Math.exp(-Math.pow((y - g) / 0.05, 2)); // horizontal channels
      h *= 1 - 0.25 * Math.exp(-Math.pow(x / 0.04, 2)) * (Math.abs(y) < 0.36 ? 0 : 1); // centre crease on the end segments
      return h;
    };
    const at = (u, v, out, inset = 0) => {
      const j = clamp(Math.round(v * NV), 0, NV), a = (u - 0.5) * TAU;
      const r = Rr(v) * (1 + 0.006 * Math.sin(a * 3 + v * 5)) - inset;
      const pad = inset ? 0 : KP.T * padH(a, v);
      const cx = Math.cos(a) * r * 0.94, sx = Math.sin(a) * r * 1.04;
      const nn = Math.hypot(Math.cos(a) / 0.94, Math.sin(a) / 1.04);
      out.copy(pts[j]).addScaledVector(F.N[j], cx + pad * Math.cos(a) / 0.94 / nn).addScaledVector(F.B[j], sx + pad * Math.sin(a) / 1.04 / nn);
      return out;
    };
    return { pts, F, Rr, at, padH, PA, PV0, PV1, NV };
  }
  function kneeGeos() {
    return C('kneepad', () => {
      const M = kneeModel(), { NU, NV } = KP;
      const v0 = 0.035, v1 = 0.965; // knit body ends inside the rib welts
      const outer = grid(NU, NV, (u, v, t) => { const vv = lerp(v0, v1, v); M.at(u, vv, t); return [u, vv]; },
        { outward: (u, v, p) => p.clone().sub(M.pts[Math.round(lerp(v0, v1, v) * NV)]) });
      const inner = grid(64, 40, (u, v, t) => { const vv = lerp(v0, v1, v); M.at(u, vv, t, 0.03); return [u, vv]; },
        { outward: (u, v, p) => M.pts[Math.round(lerp(v0, v1, v) * NV)].clone().sub(p) });
      const welt = vEnd => {
        const j = Math.round(vEnd * NV);
        return band(u => {
          const p = M.at(u, vEnd, V(), 0.015), c = M.pts[j];
          return { p, n: p.clone().sub(c).normalize(), a: M.F.T[j].clone() };
        }, 0.045, 0.02, 96, 20);
      };
      return { M, outer, inner, welts: mergeGeos([welt(0.03), welt(0.97)]) };
    });
  }
  function buildKneePads(item, d) {
    const G = kneeGeos(), M = G.M;
    const T = ctex(item, 1536, 768);
    const m = surfMat(item, { map: T.tex, rough: 0.78, normal: 'spacer', nx: 9, ny: 4, ns: 0.45, sheen: 0.9, sheenRough: 0.45 });
    const innerM = surfMat(item, { color: '#222222', rough: 0.95, side: THREE.BackSide, normal: 'knit', nx: 8, ny: 4, ns: 0.3 });
    const weltM = surfMat(item, { color: '#ffffff', rough: 0.85, normal: 'rib', nx: 40, ny: 1, ns: 0.6, sheen: 0.8 });
    const one = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(G.outer, m), new THREE.Mesh(G.inner, innerM), new THREE.Mesh(G.welts, weltM)); return g; };
    const A = one(), B = one();
    A.position.set(-0.5, 0, -0.34); A.rotation.y = 0.45;
    B.position.set(0.42, 0, 0.2); B.rotation.y = -0.2;
    item.group.add(A, B);
    item.painters.push(d2 => {
      const c = T.ctx, w = T.cv.width, h = T.cv.height;
      const X = a => (a / TAU + 0.5) * w, Y = v => (1 - v) * h; // canvas: u across (front centre at w/2), top of the sleeve at the top
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 2.4 });
      mottle(c, w, h, 21, 0.03, 900);
      // contrast side panels with a fine accent piping
      const padCol = d2.secondary === d2.primary ? shade(d2.primary, -0.25) : d2.secondary;
      c.fillStyle = shade(d2.primary, -0.18);
      c.fillRect(X(PI * 0.5) - w * 0.035, 0, w * 0.07, h); c.fillRect(X(-PI * 0.5) - w * 0.035, 0, w * 0.07, h);
      // pad cover
      const a0 = -M.PA, a1 = M.PA;
      c.save();
      c.beginPath();
      for (let i = 0; i <= 72; i++) { const t = i / 72 * TAU, ca = Math.cos(t), sa = Math.sin(t); const x = spow(ca, 0.5), y = spow(sa, 0.5); const px = X(x * M.PA * 0.985), py = Y((M.PV0 + M.PV1) / 2 + y * (M.PV1 - M.PV0) / 2 * 0.985); i ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.closePath();
      c.fillStyle = padCol; c.fill();
      c.clip();
      const g = c.createLinearGradient(0, Y(M.PV1), 0, Y(M.PV0)); g.addColorStop(0, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      mottle(c, w, h, 4, 0.05, 600);
      c.restore();
      // stitching: around the pad and along the quilting channels
      const ink = lum(padCol) > 0.45 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)';
      c.save(); c.setLineDash([w * 0.006, w * 0.004]); c.lineWidth = Math.max(1.5, w * 0.0018); c.strokeStyle = ink;
      c.beginPath();
      for (let i = 0; i <= 72; i++) { const t = i / 72 * TAU; const x = spow(Math.cos(t), 0.5), y = spow(Math.sin(t), 0.5); const px = X(x * M.PA * 0.93), py = Y((M.PV0 + M.PV1) / 2 + y * (M.PV1 - M.PV0) / 2 * 0.93); i ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.closePath();
      for (const gy of [-0.36, 0.36]) { const v = (M.PV0 + M.PV1) / 2 + gy * (M.PV1 - M.PV0) / 2; c.moveTo(X(a0 * 0.86), Y(v)); c.lineTo(X(a1 * 0.86), Y(v)); }
      c.stroke(); c.restore();
      // print: number on the pad, label up the outer side
      const tc = inkFor({ ...d2, primary: padCol, secondary: padCol }, false);
      if (d2.number) drawText(c, d2.number, X(0), Y(0.5), w * 0.08, h * 0.17, d2, { color: tc, outline: false });
      const txt = label(d2);
      if (txt) for (const s of [-1, 1]) {
        c.save(); c.translate(X(s * PI * 0.5), Y(0.5)); c.rotate(-PI / 2);
        drawText(c, txt, 0, 0, h * 0.5, w * 0.045, d2, { color: inkFor({ ...d2, primary: shade(d2.primary, -0.18) }, false), outline: false });
        c.restore();
      }
      weltM.color.set(shade(d2.primary, -0.1)); weltM.sheenColor.set(shade(d2.primary, 0.3)).multiplyScalar(0.4);
      innerM.color.set(shade(d2.primary, -0.6));
      m.sheenColor.set(shade(d2.primary, 0.25)).multiplyScalar(0.45);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.25, elev: 0.2, fit: 1.0 });
  }

  /* ---------------------------------------------------------------- */
  /* GLOVES: goalkeeper glove as one smooth signed-distance surface     */
  /* (palm, padded fingers, thumb, knit cuff, wrap strap), polygonised  */
  /* with surface nets. Right hand: back of the hand faces +Z, fingers  */
  /* up, thumb on -X. Texture is projected front/back (planar), so the  */
  /* backhand canvas and the latex palm canvas sit side by side.       */
  /* ---------------------------------------------------------------- */
  const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); };
  const smax = (a, b, k) => -smin(-a, -b, k);
  function capsule(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
    const bax = bx - ax, bay = by - ay, baz = bz - az, pax = px - ax, pay = py - ay, paz = pz - az;
    const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - lerp(r1, r2, h);
  }
  function rbox(px, py, pz, bx, by, bz, r) {
    const qx = Math.abs(px) - bx, qy = Math.abs(py) - by, qz = Math.abs(pz) - bz;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
  }
  const GL = {
    fingers: [ // base x, base y, length, radius base, radius tip, tip spread, curl
      [-0.335, 0.3, 0.68, 0.124, 0.11, -0.05, 0.1], [-0.112, 0.32, 0.77, 0.127, 0.113, -0.012, 0.11],
      [0.112, 0.31, 0.72, 0.124, 0.11, 0.02, 0.105], [0.33, 0.26, 0.58, 0.114, 0.1, 0.065, 0.09]],
    cuffY0: -1.17, cuffY1: -0.42, strapY: -0.83, strapH: 0.15,
    box: [-0.97, -1.22, -0.38, 0.68, 1.2, 0.36],
  };
  const cuffR = y => [lerp(0.385, 0.425, smooth(-0.55, -1.1, y)), lerp(0.235, 0.26, smooth(-0.55, -1.1, y))];
  function gloveSDF(x, y, z) {
    // palm: cupped rounded slab, a little narrower at the wrist
    const tw = lerp(0.9, 1.0, smooth(-0.5, 0.3, y)), zb = z + 0.2 * x * x;
    let d = rbox(x / tw, y + 0.03, zb, 0.345, 0.36, 0.05, 0.125) * tw;
    // raised backhand punch panel
    d = smin(d, rbox(x, y - 0.06, zb - 0.16, 0.3, 0.25, 0.006, 0.035), 0.02);
    // fingers (hard union between fingers: the gusset creases)
    let fd = 9;
    for (const [fx, fy, L, r1, r2, sp, cu] of GL.fingers) {
      const mx = fx + sp * 0.35, my = fy + L * 0.58, mz = -cu * 0.2, tx = fx + sp, ty = fy + L, tz = -cu;
      const rm = lerp(r1, r2, 0.58);
      fd = Math.min(fd, smin(capsule(x, y, z, fx, fy, -0.01, mx, my, mz, r1, rm), capsule(x, y, z, mx, my, mz, tx, ty, tz, rm, r2), 0.03));
    }
    d = smin(d, fd, 0.07);
    // thumb
    const th = smin(capsule(x, y, z, -0.28, -0.24, -0.03, -0.57, 0.0, -0.08, 0.135, 0.128), capsule(x, y, z, -0.57, 0.0, -0.08, -0.7, 0.31, -0.13, 0.128, 0.114), 0.04);
    d = smin(d, th, 0.08);
    // cuff: elliptic tube with a hollow opening at the bottom
    const [rx, rz] = cuffR(y), e = Math.hypot(x / rx, z / rz);
    let cf = smax((e - 1) * Math.min(rx, rz), GL.cuffY0 - y, 0.03);
    cf = smax(cf, y - GL.cuffY1, 0.05);
    d = smin(d, cf, 0.12);
    const hol = smax((Math.hypot(x / (rx - 0.035), z / (rz - 0.035)) - 1) * (rz - 0.035), y - (GL.cuffY0 + 0.3), 0.02);
    d = smax(d, -hol, 0.012);
    // wrap strap and its tab
    const se = (Math.hypot(x / (rx + 0.032), z / (rz + 0.032)) - 1) * (rz + 0.032);
    const st = smax(se, Math.abs(y - GL.strapY) - GL.strapH, 0.02);
    d = Math.min(d, smax(st, -hol, 0.01));
    d = Math.min(d, rbox(x - 0.16, y - GL.strapY, z - (rz + 0.045), 0.17, GL.strapH - 0.01, 0.006, 0.016));
    return d;
  }
  function surfaceNets(f, box, h) {
    const [x0, y0, z0, x1, y1, z1] = box;
    const nx = Math.ceil((x1 - x0) / h), ny = Math.ceil((y1 - y0) / h), nz = Math.ceil((z1 - z0) / h);
    const sx = nx + 1, sxy = (nx + 1) * (ny + 1);
    const F = new Float32Array(sxy * (nz + 1));
    for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) F[i + sx * j + sxy * k] = f(x0 + i * h, y0 + j * h, z0 + k * h);
    const vid = new Int32Array(nx * ny * nz).fill(-1), P = [];
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const cv = new Float32Array(8);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let neg = 0;
      for (let c = 0; c < 8; c++) { cv[c] = F[(i + (c & 1)) + sx * (j + ((c >> 1) & 1)) + sxy * (k + ((c >> 2) & 1))]; if (cv[c] < 0) neg++; }
      if (neg === 0 || neg === 8) continue;
      let ax = 0, ay = 0, az = 0, n = 0;
      for (const [a, b] of E) {
        if ((cv[a] < 0) === (cv[b] < 0)) continue;
        const t = cv[a] / (cv[a] - cv[b]);
        ax += (a & 1) + t * ((b & 1) - (a & 1)); ay += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1)); az += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1)); n++;
      }
      vid[i + nx * (j + ny * k)] = P.length / 3;
      P.push(x0 + (i + ax / n) * h, y0 + (j + ay / n) * h, z0 + (k + az / n) * h);
    }
    const I = [], cell = (i, j, k) => vid[i + nx * (j + ny * k)];
    const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) I.push(a, c, b, a, d, c); else I.push(a, b, c, a, c, d); };
    for (let k = 1; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = F[i + sx * j + sxy * k], b = F[i + 1 + sx * j + sxy * k]; if ((a < 0) === (b < 0)) continue;
      quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), a < 0);
    }
    for (let k = 1; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) {
      const a = F[i + sx * j + sxy * k], b = F[i + sx * (j + 1) + sxy * k]; if ((a < 0) === (b < 0)) continue;
      quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), a < 0);
    }
    for (let k = 0; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) {
      const a = F[i + sx * j + sxy * k], b = F[i + sx * j + sxy * (k + 1)]; if ((a < 0) === (b < 0)) continue;
      quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), a < 0);
    }
    // project vertices onto the surface and take normals from the field gradient
    const N = new Float32Array(P.length), e = h * 0.35;
    for (let v = 0; v < P.length; v += 3) {
      let x = P[v], y = P[v + 1], z = P[v + 2], gx = 0, gy = 0, gz = 1;
      for (let it = 0; it < 3; it++) {
        const dd = f(x, y, z);
        gx = f(x + e, y, z) - f(x - e, y, z); gy = f(x, y + e, z) - f(x, y - e, z); gz = f(x, y, z + e) - f(x, y, z - e);
        const g2 = (gx * gx + gy * gy + gz * gz) / (4 * e * e) || 1;
        const s = dd / g2 / (2 * e);
        if (it < 2) { x -= gx * s; y -= gy * s; z -= gz * s; }
      }
      const l = Math.hypot(gx, gy, gz) || 1;
      P[v] = x; P[v + 1] = y; P[v + 2] = z; N[v] = gx / l; N[v + 1] = gy / l; N[v + 2] = gz / l;
    }
    return { P, N, I };
  }
  function gloveGeos() {
    return C('glove', () => {
      const S = surfaceNets(gloveSDF, GL.box, 0.019);
      // check winding against the gradient normals once
      { const [a, b, c] = [S.I[0] * 3, S.I[1] * 3, S.I[2] * 3];
        const u = V(S.P[b] - S.P[a], S.P[b + 1] - S.P[a + 1], S.P[b + 2] - S.P[a + 2]), w = V(S.P[c] - S.P[a], S.P[c + 1] - S.P[a + 1], S.P[c + 2] - S.P[a + 2]);
        if (u.cross(w).dot(V(S.N[a], S.N[a + 1], S.N[a + 2])) < 0) for (let i = 0; i < S.I.length; i += 3) { const t = S.I[i + 1]; S.I[i + 1] = S.I[i + 2]; S.I[i + 2] = t; } }
      // split into backhand (+Z facing) and palm (-Z facing) parts, each with its own planar uv
      const [bx0, by0, , bx1, by1] = GL.box;
      const parts = [[], []], maps = [new Map(), new Map()], out = [{ P: [], N: [], UV: [], F: [] }, { P: [], N: [], UV: [], F: [] }];
      for (let i = 0; i < S.I.length; i += 3) {
        const t = [S.I[i], S.I[i + 1], S.I[i + 2]];
        const nz = S.N[t[0] * 3 + 2] + S.N[t[1] * 3 + 2] + S.N[t[2] * 3 + 2];
        const g = nz >= 0 ? 0 : 1, O = out[g], mp = maps[g];
        for (const vi of t) {
          let ni = mp.get(vi);
          if (ni == null) {
            ni = O.P.length / 3; mp.set(vi, ni);
            const x = S.P[vi * 3], y = S.P[vi * 3 + 1], z = S.P[vi * 3 + 2];
            O.P.push(x, y, z); O.N.push(S.N[vi * 3], S.N[vi * 3 + 1], S.N[vi * 3 + 2]);
            const fu = (x - bx0) / (bx1 - bx0);
            O.UV.push(g === 0 ? fu * 0.5 : 1 - fu * 0.5, (y - by0) / (by1 - by0));
            O.F.push(Math.abs(S.N[vi * 3 + 2]));
          }
          parts[g].push(ni);
        }
      }
      const geos = out.map((O, g) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(O.P, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(O.N, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(O.UV, 2));
        geo.setIndex(O.P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(parts[g], 1) : new THREE.Uint16BufferAttribute(parts[g], 1));
        return geo;
      });
      return { back: geos[0], palm: geos[1], tri: out.map((O, g) => ({ UV: O.UV, F: O.F, I: parts[g] })) };
    });
  }
  // canvas-space "facing" map (|n.z|): 1 on the flat back/palm, 0 on the side walls, so the sides can be painted as a gusset
  function facingMap(G, w, h) {
    return C('glovefacing|' + w + 'x' + h, () => {
      const cv = K.mkCanvas(w, h), c = cv.getContext('2d');
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      for (const T of G.tri) for (let i = 0; i < T.I.length; i += 3) {
        const a = T.I[i], b = T.I[i + 1], d = T.I[i + 2];
        const f = Math.round(255 * (T.F[a] + T.F[b] + T.F[d]) / 3);
        c.fillStyle = c.strokeStyle = `rgb(${f},${f},${f})`; c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(T.UV[a * 2] * w, (1 - T.UV[a * 2 + 1]) * h); c.lineTo(T.UV[b * 2] * w, (1 - T.UV[b * 2 + 1]) * h); c.lineTo(T.UV[d * 2] * w, (1 - T.UV[d * 2 + 1]) * h); c.closePath(); c.fill(); c.stroke();
      }
      const px = c.getImageData(0, 0, w, h).data, F = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) F[i] = px[i * 4];
      return F;
    });
  }
  function buildGloves(item, d) {
    const G = gloveGeos();
    const T = ctex(item, 1536, 1152);
    const backM = surfMat(item, { map: T.tex, rough: 0.62, coat: 0.18, coatRough: 0.5, sheen: 0.4, normal: 'grain', nx: 3, ny: 4, ns: 0.06 });
    const palmM = surfMat(item, { map: T.tex, rough: 0.82, normal: 'pebble', nx: 5, ny: 8, ns: 0.35, sheen: 0.6, sheenColor: '#777777' });
    const one = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(G.back, backM), new THREE.Mesh(G.palm, palmM)); return g; };
    const A = one(), B = one();
    A.position.set(-0.46, 0, 0.12); A.rotation.set(0, -0.1, 0.07);
    B.position.set(0.56, 0.03, -0.3); B.rotation.set(0, PI + 0.3, -0.07);
    item.group.add(A, B);
    const [bx0, by0, , bx1, by1] = GL.box;
    item.painters.push(d2 => {
      const c = T.ctx, w = T.cv.width, h = T.cv.height, hw = w / 2;
      const BX = x => (x - bx0) / (bx1 - bx0) * hw, PXp = x => w - (x - bx0) / (bx1 - bx0) * hw, Y = y => (1 - (y - by0) / (by1 - by0)) * h;
      const ux = hw / (bx1 - bx0);
      const latex = lum(d2.accent) > 0.25 && d2.accent !== d2.primary ? mix(d2.accent, '#ffffff', 0.2) : '#eef0f2';
      const gus = d2.secondary;
      // ---- backhand (left half)
      c.save(); c.beginPath(); c.rect(0, 0, hw, h); c.clip();
      paintPattern(c, 0, 0, hw, h, d2, { unit: ux * 0.9 });
      // finger spines
      for (const [fx, fy, L] of GL.fingers) {
        c.fillStyle = d2.secondary; c.beginPath(); c.roundRect(BX(fx) - ux * 0.022, Y(fy + L - 0.05), ux * 0.044, Y(fy + 0.16) - Y(fy + L - 0.05), ux * 0.022); c.fill();
      }
      // punch zone
      // punch zone: follows the raised panel (rounded rect, x +-0.335, y -0.225..0.345)
      c.fillStyle = d2.secondary; c.beginPath(); c.roundRect(BX(-0.33), Y(0.34), ux * 0.66, Y(-0.22) - Y(0.34), ux * 0.05); c.fill();
      c.save(); c.clip();
      const pg = c.createLinearGradient(0, Y(0.34), 0, Y(-0.22)); pg.addColorStop(0, 'rgba(255,255,255,0.10)'); pg.addColorStop(1, 'rgba(0,0,0,0.12)');
      c.fillStyle = pg; c.fillRect(0, 0, hw, h);
      c.restore();
      c.save(); c.setLineDash([ux * 0.02, ux * 0.014]); c.strokeStyle = d2.accent; c.lineWidth = ux * 0.008;
      c.beginPath(); c.roundRect(BX(-0.3), Y(0.31), ux * 0.6, Y(-0.19) - Y(0.31), ux * 0.04); c.stroke(); c.restore();
      const txt = label(d2);
      if (d2.number) drawText(c, d2.number, BX(0), Y(0.06), ux * 0.3, ux * 0.26, d2, { color: inkFor({ ...d2, primary: d2.secondary, secondary: d2.secondary }, false), outline: false });
      c.restore();
      // ---- palm latex (right half)
      c.fillStyle = latex; c.fillRect(hw, 0, hw, h);
      mottle(c, w, h, 31, 0.035, 1500);
      c.save(); c.setLineDash([ux * 0.02, ux * 0.014]); c.lineWidth = Math.max(1, ux * 0.006); c.strokeStyle = 'rgba(0,0,0,0.22)';
      c.beginPath(); c.moveTo(PXp(-0.4), Y(-0.36)); c.lineTo(PXp(0.4), Y(-0.36)); c.stroke(); c.restore();
      // ---- cuff and strap all the way round
      for (const [x0, x1] of [[0, hw], [hw, w]]) {
        c.fillStyle = shade(d2.primary, -0.12); c.fillRect(x0, Y(GL.cuffY1 - 0.08), x1 - x0, h - Y(GL.cuffY1 - 0.08));
        c.fillStyle = d2.secondary; c.fillRect(x0, Y(GL.cuffY0 + 0.07), x1 - x0, h * 0.012);
        c.fillStyle = d2.secondary; c.fillRect(x0, Y(GL.strapY + GL.strapH + 0.04), x1 - x0, Y(GL.strapY - GL.strapH - 0.04) - Y(GL.strapY + GL.strapH + 0.04));
        c.fillStyle = d2.accent; c.fillRect(x0, Y(GL.strapY + GL.strapH - 0.02), x1 - x0, h * 0.006); c.fillRect(x0, Y(GL.strapY - GL.strapH + 0.02), x1 - x0, h * 0.006);
      }
      if (txt) drawText(c, txt, BX(0.02), Y(GL.strapY), ux * 0.62, ux * 0.17, d2, { color: inkFor({ ...d2, primary: d2.secondary }, false), outline: false });
      // ---- side gussets: blend to the gusset colour where the surface turns away from the camera axis
      const fm = facingMap(G, w, h), img = c.getImageData(0, 0, w, h), D = img.data;
      const gc = K.rgbOf(gus), g2 = K.rgbOf(shade(gus, -0.2));
      const yStrap = Y(GL.strapY + GL.strapH + 0.05);
      for (let y = 0; y < yStrap; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, f = fm[i] / 255;
        if (f > 0.5) continue;
        const k = 1 - smooth(0.3, 0.5, f), m = k * k * (3 - 2 * k);
        D[i * 4] += ((f < 0.12 ? g2 : gc)[0] - D[i * 4]) * m; D[i * 4 + 1] += ((f < 0.12 ? g2 : gc)[1] - D[i * 4 + 1]) * m; D[i * 4 + 2] += ((f < 0.12 ? g2 : gc)[2] - D[i * 4 + 2]) * m;
      }
      c.putImageData(img, 0, 0);
      K.applySurfaceFinish(backM, d2.finish === 'metallic' ? 'gloss' : d2.finish);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.12, elev: 0.12, fit: 1.0 });
  }

  const builders = { wristbands: buildWristbands, hoodie: buildHoodie, 'knee-pads': buildKneePads, gloves: buildGloves };
  return { builders };
}
