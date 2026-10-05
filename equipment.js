// SquadForge gear module: sports equipment (hockey, football, soccer, basketball,
// baseball, volleyball, training). Original procedural models, no real brand marks.
// Loaded by gear3d.js through GEAR_MODULES: default export (K) => ({ shapes, builders, defaults, meta }).
// Self-contained: every helper comes in through the kit K, so there is no circular import.

export default function equipment(K) {
  const { THREE, TAU, PI, V, lerp, clamp, smooth, spow, grid, tube, mergeGeos, placeGeo, cached, paintPattern, drawText, lum, shade, mix, applySurfaceFinish, capsuleGeo, pathFrames } = K;

  /* ---------------------------------------------------------------- */
  /* small helpers                                                     */
  /* ---------------------------------------------------------------- */
  const C = (k, fn) => cached('eq:' + k, fn);
  const col = c => new THREE.Color(c);
  const N2 = (a, b = a) => new THREE.Vector2(a, b);
  const ink = c => (lum(c) > 0.33 ? '#0b1020' : '#ffffff');
  const label = d => d.text || d.chest || d.name || '';
  const modern = d => ({ ...d, font: 'modern' });

  function surfMat(item, o = {}) {
    const base = { rough: o.rough != null ? o.rough : 0.32, coat: o.coat || 0, coatRough: o.coatRough != null ? o.coatRough : 0.08, metal: o.metal || 0 };
    const p = { color: col(o.color || '#ffffff'), roughness: base.rough, metalness: base.metal, clearcoat: base.coat, clearcoatRoughness: base.coatRough, side: o.side || THREE.FrontSide };
    if (o.map) p.map = o.map;
    if (o.normal) { p.normalMap = item.ntex(o.normal, o.nx || 4, o.ny || o.nx || 4); p.normalScale = N2(o.ns != null ? o.ns : 0.3); }
    if (o.sheen) { p.sheen = o.sheen; p.sheenRoughness = 0.5; p.sheenColor = col('#5a5a5a'); }
    if (o.transparent) { p.transparent = true; p.alphaTest = o.alphaTest || 0; p.depthWrite = o.depthWrite != null ? o.depthWrite : true; }
    const m = item.mat(p); m.userData.base = base; return m;
  }
  const plastic = (item, o = {}) => surfMat(item, { rough: 0.3, coat: 1, coatRough: 0.06, ...o });
  const metal = (item, o = {}) => surfMat(item, { color: '#d6dae0', rough: 0.2, metal: 1, ...o });
  const rubber = (item, o = {}) => surfMat(item, { rough: 0.8, normal: 'grain', nx: 6, ns: 0.35, ...o });
  const fabric = (item, o = {}) => surfMat(item, { rough: 0.86, sheen: 1, normal: 'knit', nx: 20, ny: 10, ns: 0.45, ...o });
  function ctex(item, w, h) { const cv = item.canvas(w, h); return { cv, tex: item.tex(cv), ctx: cv.getContext('2d') }; }
  const finish = (m, d, lim) => applySurfaceFinish(m, lim && d.finish === 'metallic' ? 'gloss' : d.finish);

  // spiral overlap seams of wrapped tape (continuous across the u wrap)
  function tapeWrap(c, w, h, base, turns, o = {}) {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    const step = h / turns;
    for (let y = -step * 2; y < h + step * 2; y += step) {
      const g = c.createLinearGradient(0, y, 0, y + step);
      g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(0.18, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.save(); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y + step); c.lineTo(w, y + step * 2); c.lineTo(0, y + step); c.closePath();
      c.fillStyle = g; c.fill(); c.restore();
      if (o.stripe) { c.strokeStyle = o.stripe; c.lineWidth = step * 0.12; c.beginPath(); c.moveTo(0, y + step * 0.5); c.lineTo(w, y + step * 1.5); c.stroke(); }
    }
  }
  // stitched seam line
  function stitches(c, x0, y0, x1, y1, color, len, wdt) {
    c.save(); c.strokeStyle = color; c.lineWidth = wdt; c.setLineDash([len, len * 0.8]); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.restore();
  }

  // sweep returning its frames so details can be attached to the surface
  function sweepF(ctrl, nu, nv, sec, o = {}) {
    const curve = new THREE.CatmullRomCurve3(ctrl, !!o.closed, 'centripetal');
    const pts = []; for (let j = 0; j <= nv; j++) pts.push(curve.getPointAt(j / nv));
    const F = pathFrames(pts, o.up);
    const at = (v, a, out = V()) => {
      const j = clamp(Math.round(v * nv), 0, nv); const [n, b] = sec(v, a);
      return out.copy(pts[j]).addScaledVector(F.N[j], n).addScaledVector(F.B[j], b);
    };
    const geo = grid(nu, nv, (u, v, t) => { at(v, u * TAU, t); return [u, v]; }, { outward: (u, v, p) => p.clone().sub(pts[Math.round(v * nv)]) });
    return { geo, pts, F, at, nv };
  }
  // superellipse section
  const se = (a, hn, hb, p = 0.5, q = p) => [spow(Math.cos(a), p) * hn, spow(Math.sin(a), q) * hb];
  // rounded end factor over the last `f` of a sweep (and/or the first)
  const capK = (v, f0, f1) => {
    let k = 1;
    if (f1 && v > 1 - f1) { const s = (v - (1 - f1)) / f1; k = Math.sqrt(Math.max(0, 1 - s * s)); }
    if (f0 && v < f0) { const s = 1 - v / f0; k = Math.min(k, Math.sqrt(Math.max(0, 1 - s * s))); }
    return k;
  };
  // extrude a 2D shape (XY) with uvs normalised to its bounding box
  function extrude(shape, depth, bevel, o = {}) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * (o.bs || 1), bevelSegments: o.segs || 3, curveSegments: o.curve || 16 });
    g.computeBoundingBox();
    const bb = g.boundingBox, p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
    g.translate(0, 0, -depth / 2);
    return g;
  }
  function roundRect(x, y, w, h, r) {
    const s = new THREE.Shape();
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  // a closed ring (band) with a rounded rectangular wall: radius rx/rz, height h, wall thickness t
  function ringBand(rx, rz, h, t, nu = 96, o = {}) {
    // wall section is a uniform-speed rounded rectangle: v = 0.5 is the middle of the outer face, v grows upward
    const rr = Math.min(t / 2 * 0.95, h / 2 * 0.95, o.r || t * 0.45), q = V();
    return grid(nu, 48, (u, v, p) => {
      const a = u * TAU + PI;
      rrPoint(v - 0.5, h / 2, t / 2, rr, q);
      const yy = q.x, ro = q.z + (q.z > 0 ? (o.puff || 0) * t * 0.5 * Math.cos(clamp(yy / (h / 2), -1, 1) * PI / 2) : 0);
      p.set(Math.sin(a) * (rx + ro), yy, Math.cos(a) * (rz + ro));
      return [u, v];
    }, { outward: (u, v, p) => { const a = u * TAU + PI; return p.clone().sub(V(Math.sin(a) * rx, 0, Math.cos(a) * rz)); } });
  }
  const bandFace = (h, t, r) => { const rr = Math.min(t / 2 * 0.95, h / 2 * 0.95, r || t * 0.45), sa = h / 2 - rr, sb = t / 2 - rr; return sa / (4 * sa + 4 * sb + 2 * PI * rr); };

  /* ---------------------------------------------------------------- */
  /* helmet shell family (hockey, football, batting)                   */
  /* azimuth a: 0 = front (+Z), +PI/2 = +X. u = 0.5 at the front.       */
  /* ---------------------------------------------------------------- */
  function shellP(P, a, e, s = 1, out = V()) {
    let r, y;
    if (e >= 0) { r = Math.pow(Math.max(0, Math.cos(e)), P.crown || 0.8); y = Math.sin(e) * P.ry; } else { r = 1 - (P.taper || 0.1) * e * e; y = e * (P.ry2 || P.ry); }
    const ca = Math.cos(a), sa = Math.sin(a);
    const zr = ca > 0 ? P.rf : P.rb;
    const bump = P.bump ? P.bump(a, e) : 0;
    return out.set(sa * r * (P.rx + bump) * s, y * s + (1 - s) * 0.1, ca * r * (zr + bump) * s);
  }
  function lowFn(P) {
    return a => {
      const x = Math.atan2(Math.sin(a), Math.cos(a)), ax = Math.abs(x);
      let e = lerp(P.eF, P.eS, smooth(P.a0, P.a1, ax));
      e = lerp(e, P.eB, smooth(P.b0 || 2.0, PI, ax));
      if (P.extra) e += P.extra(x);
      return e;
    };
  }
  const uA = u => (u - 0.5) * TAU;
  function shellGeos(P, nu = 112, nv = 44) {
    const low = lowFn(P);
    const ev = (a, v) => lerp(low(a), PI / 2, v);
    const outer = grid(nu, nv, (u, v, t) => { const a = uA(u); shellP(P, a, ev(a, v), 1, t); return [u, v]; }, { outward: (u, v, p) => p.clone().sub(V(0, -0.2, 0)) });
    const inner = grid(nu, nv, (u, v, t) => { const a = uA(u); shellP(P, a, ev(a, v), P.thin || 0.93, t); return [u, v]; }, { outward: (u, v, p) => V(0, -0.2, 0).sub(p) });
    const rim = [];
    for (let i = 0; i < nu; i++) { const a = uA(i / nu), e = low(a); rim.push(shellP(P, a, e, (1 + (P.thin || 0.93)) / 2)); }
    const rimG = tube(rim, { closed: true, radius: (1 - (P.thin || 0.93)) * 0.62, seg: nu * 2, radial: 10 });
    return { outer, inner, rim: rimG, low, ev };
  }
  // world normal at a shell point (numeric)
  function shellN(P, a, e) {
    const p0 = shellP(P, a, e), pa = shellP(P, a + 0.01, e), pe = shellP(P, a, e + 0.01);
    return pa.sub(p0).cross(pe.sub(p0)).normalize().multiplyScalar(-1);
  }
  // canvas position for (a, e) on a shell texture with height h, width w
  function shellUV(low, a, e, w, h) {
    const u = a / TAU + 0.5, v = (e - low(a)) / (PI / 2 - low(a));
    return [u * w, (1 - v) * h];
  }

  /* ---------------------------------------------------------------- */
  /* HOCKEY STICK                                                      */
  /* ---------------------------------------------------------------- */
  function buildStick(item, d) {
    const LIE = 0.8, SL = 3.15, SW = 0.06, SD = 0.042, BL = 1.0;
    const dir = V(-Math.sin(LIE), Math.cos(LIE), 0), H = V(0.02, 0.1, 0);
    const G = C('stick', () => {
      const p0 = H.clone().addScaledVector(dir, -0.06), p1 = H.clone().addScaledVector(dir, SL);
      const line = (a, b) => [a, a.clone().lerp(b, 0.5), b];
      const shaft = sweepF(line(p0, p1), 28, 60, (v, a) => {
        const hz = smooth(0.12, 0.0, v), k = capK(v, 0.012, 0.004);
        return [-spow(Math.cos(a), 0.3) * lerp(SD, 0.022, hz) * k, -spow(Math.sin(a), 0.3) * lerp(SW, 0.062, hz) * k];
      }, { up: V(0, 0, 1) });
      const g0 = H.clone().addScaledVector(dir, SL - 0.78), g1 = H.clone().addScaledVector(dir, SL + 0.045);
      const grip = sweepF(line(g0, g1), 28, 40, (v, a) => {
        const k = capK(v, 0, 0.09), knob = 1 + 0.32 * smooth(0.72, 0.9, v);
        return [-spow(Math.cos(a), 0.45) * (SD + 0.007) * knob * k, -spow(Math.sin(a), 0.45) * (SW + 0.007) * knob * k];
      }, { up: V(0, 0, 1) });
      // blade: u along the length, v around the thin section
      const bladeAt = (t, b, grow, out) => {
        const x = H.x - 0.05 + t * BL;
        let yb = 0.012 * Math.pow((t - 0.45) / 0.55, 2), yt = lerp(0.17, 0.215, t);
        const k = capK(t, 0, 0.2);
        const yc = (yb + yt) / 2 + (1 - k) * 0.03, hh = (yt - yb) / 2 * k + grow;
        const th = lerp(0.024, 0.014, t) * Math.pow(k, 0.35) + grow;
        const zc = -0.17 * t * t;
        return out.set(x, yc + spow(Math.sin(b), 0.3) * hh, zc + spow(Math.cos(b), 0.6) * th);
      };
      const blade = grid(64, 24, (u, v, t) => { bladeAt(u, v * TAU, 0, t); return [u, v]; }, { outward: (u, v, p) => { const c = bladeAt(u, 0, 0, V()); return V(0, p.y - (c.y), p.z - (-0.17 * u * u)); } });
      const tape = grid(48, 24, (u, v, t) => { bladeAt(lerp(0.12, 0.8, u), v * TAU, 0.005, t); return [u, v]; }, { outward: (u, v, p) => { const tt = lerp(0.12, 0.8, u); return V(0, 0, p.z + 0.17 * tt * tt).add(V(0, p.y - 0.1, 0).multiplyScalar(0.3)); } });
      return { shaft: shaft.geo, grip: grip.geo, blade, tape };
    });
    const S = ctex(item, 256, 1536);
    const shaftM = plastic(item, { map: S.tex, rough: 0.32, coat: 0.8 });
    item.add(G.shaft, shaftM);
    const GR = ctex(item, 256, 512);
    const gripM = rubber(item, { map: GR.tex, rough: 0.75, normal: 'fuzz', nx: 2, ny: 8, ns: 0.25 });
    item.add(G.grip, gripM);
    const bladeM = plastic(item, { color: '#1b1d22', rough: 0.35, coat: 0.6, normal: 'grain', nx: 3, ns: 0.15 });
    item.add(G.blade, bladeM);
    const TP = ctex(item, 512, 128);
    const tapeM = rubber(item, { map: TP.tex, rough: 0.82, normal: 'fuzz', nx: 6, ny: 2, ns: 0.3 });
    item.add(G.tape, tapeM);
    item.painters.push(d2 => {
      const c = S.ctx, w = S.cv.width, h = S.cv.height;
      paintPattern(c, 0, 0, w, h, d2, { unit: w * 1.4 });
      // hosel band and top band in secondary, accent pinlines
      c.fillStyle = d2.secondary; c.fillRect(0, h * 0.86, w, h * 0.14); c.fillRect(0, 0, w, h * 0.27);
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.85, w, h * 0.008); c.fillRect(0, h * 0.27, w, h * 0.008);
      const txt = label(d2);
      c.save(); c.translate(w * 0.5, h * 0.56); c.rotate(PI / 2);
      if (txt) drawText(c, txt, 0, 0, h * 0.42, w * 0.4, d2, { color: d2.textColor });
      c.restore();
      c.save(); c.translate(w * 0.5, h * 0.8); c.rotate(PI / 2);
      drawText(c, (d2.number ? '#' + d2.number + '  ' : '') + 'MID FLEX 85', 0, 0, h * 0.09, w * 0.16, modern(d2), { color: d2.accent, outline: false });
      c.restore();
      const tapeCol = lum(d2.primary) < 0.12 ? '#eef0f3' : '#16171b';
      const g = GR.ctx; tapeWrap(g, GR.cv.width, GR.cv.height, tapeCol, 9, { stripe: mix(d2.accent, tapeCol, 0.35) });
      const t = TP.ctx, tw = TP.cv.width, th = TP.cv.height;
      t.fillStyle = tapeCol; t.fillRect(0, 0, tw, th);
      for (let x = -th; x < tw + th; x += tw / 11) {
        t.strokeStyle = 'rgba(0,0,0,0.28)'; t.lineWidth = 3 * item.q; t.beginPath(); t.moveTo(x, 0); t.lineTo(x + th * 0.35, th); t.stroke();
        t.strokeStyle = 'rgba(255,255,255,0.08)'; t.lineWidth = 5 * item.q; t.beginPath(); t.moveTo(x + 4, 0); t.lineTo(x + 4 + th * 0.35, th); t.stroke();
      }
      gripM.color.set('#ffffff'); bladeM.color.set(mix('#1b1d22', d2.secondary, 0.25));
      finish(shaftM, d2, false);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.35, elev: 0.12, fit: 0.86 });
  }

  /* ---------------------------------------------------------------- */
  /* HOCKEY HELMET: shell, vents, ear holes, wire cage, chin strap     */
  /* ---------------------------------------------------------------- */
  const HH = { rx: 0.8, ry: 0.78, ry2: 0.74, rf: 0.98, rb: 1.0, crown: 0.75, eF: 0.3, eS: -0.62, eB: -0.6, a0: 0.45, a1: 1.05, b0: 2.2, taper: 0.12, thin: 0.92,
    bump: (a, e) => 0.025 * Math.exp(-Math.pow(Math.sin(a) / 0.1, 2)) * smooth(-0.2, 0.5, e) };
  function cagePoint(f, y) {
    const t = clamp((y + 1.15) / 1.4, 0, 1); // 0 chin .. 1 brow
    const W = lerp(0.52, 0.93, smooth(0, 0.62, t)), A = lerp(0.9, 1.22, smooth(0.05, 0.6, t));
    const Zf = lerp(0.95, 1.17, Math.sin(clamp(t, 0, 1) * PI) * 0.9 + (t > 0.5 ? 0 : 0.1 * (0.5 - t))) - (t > 0.85 ? (t - 0.85) * 0.5 : 0);
    const a = f * A, D = (Zf - lerp(0.36, 0.3, t)) / (1 - Math.cos(1.22));
    return V(Math.sin(a) * W, y, Zf - (1 - Math.cos(a)) * D);
  }
  function buildHockeyHelmet(item, d) {
    const P = HH;
    const G = C('hhelmet', () => {
      const sh = shellGeos(P);
      // vents: dark slots sunk into the crown
      const vents = [];
      for (const [a, e, L] of [[0.22, 1.0, 0.24], [-0.22, 1.0, 0.24], [0.5, 0.62, 0.2], [-0.5, 0.62, 0.2], [2.7, 0.75, 0.2], [-2.7, 0.75, 0.2], [PI, 0.95, 0.22], [1.25, 0.55, 0.18], [-1.25, 0.55, 0.18]]) {
        const p = shellP(P, a, e), n = shellN(P, a, e), tng = shellP(P, a, e + 0.05).sub(p).normalize();
        vents.push(placeGeo(capsuleGeo(L, 0.045, 6, 10, 0.4), p.addScaledVector(n, -0.004), n, 0, tng));
      }
      // wire cage
      const R = 0.013, wires = [];
      const fs = [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1];
      for (const f of fs) {
        const top = Math.abs(f) >= 0.79 || f === 0 ? 0.22 : -0.34;
        const pts = []; for (let i = 0; i <= 10; i++) pts.push(cagePoint(f, lerp(top, -1.12, i / 10)));
        wires.push(tube(pts, { radius: Math.abs(f) === 1 ? R * 1.5 : R, seg: 30, radial: 6 }));
      }
      for (const y of [0.22, -0.34, -0.52, -0.7, -0.87, -1.0, -1.12]) {
        const pts = []; for (let i = 0; i <= 16; i++) pts.push(cagePoint(lerp(-1, 1, i / 16), y));
        wires.push(tube(pts, { radius: y === 0.22 || y === -1.12 ? R * 1.5 : R, seg: 40, radial: 6 }));
      }
      const cage = mergeGeos(wires);
      const chin = new THREE.SphereGeometry(0.2, 20, 10, 0, TAU, 0, PI * 0.5); chin.scale(1, 0.8, 0.55); chin.rotateX(PI / 2);
      const cc = cagePoint(0, -1.12); chin.translate(cc.x, cc.y - 0.05, cc.z - 0.06);
      // side clips
      const clips = mergeGeos([-1, 1].flatMap(s => [cagePoint(s, 0.1), cagePoint(s, -0.55)].map(p => { const b = new THREE.BoxGeometry(0.06, 0.11, 0.05); b.translate(p.x - s * 0.01, p.y, p.z - 0.01); return b; })));
      const strap = tube([shellP(P, -1.55, -0.5), V(-0.55, -0.95, 0.35), V(-0.25, -1.17, 0.7), V(0, -1.2, 0.83), V(0.25, -1.17, 0.7), V(0.55, -0.95, 0.35), shellP(P, 1.55, -0.5)], { radius: 0.03, flat: 0.35, seg: 60, radial: 8 });
      const buckles = mergeGeos([-1, 1].map(s => { const p = shellP(P, s * 1.5, -0.42); const b = new THREE.BoxGeometry(0.03, 0.12, 0.1); b.translate(p.x + s * 0.01, p.y, p.z); return b; }));
      return { ...sh, vents: mergeGeos(vents), cage, chin, clips, strap, buckles };
    });
    const S = ctex(item, 1024, 512);
    const shellM = plastic(item, { map: S.tex, rough: 0.34, coat: 1, coatRough: 0.1 });
    item.add(G.outer, shellM);
    const linerM = surfMat(item, { color: '#26282d', rough: 0.95, normal: 'pebble', nx: 6, ns: 0.6, side: THREE.FrontSide });
    item.add(G.inner, linerM);
    const rimM = rubber(item, { color: '#17181c', rough: 0.6 });
    item.add(G.rim, rimM);
    const ventM = surfMat(item, { color: '#0c0d10', rough: 0.85 });
    item.add(G.vents, ventM);
    const cageM = metal(item, { color: '#dfe3e8', rough: 0.18 });
    item.add(G.cage, cageM); item.add(G.clips, cageM);
    const blackM = rubber(item, { color: '#141518', rough: 0.55, side: THREE.DoubleSide });
    item.add(G.chin, blackM); item.add(G.strap, blackM); item.add(G.buckles, blackM);
    item.painters.push(d2 => {
      const c = S.ctx, w = S.cv.width, h = S.cv.height;
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 3.2 });
      // two-tone lower ring (back/sides) and center seam
      c.fillStyle = d2.secondary; c.fillRect(0, h * 0.86, w, h * 0.14);
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.85, w, h * 0.012);
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(w * 0.25 - 2, 0, 4, h); c.fillRect(w * 0.75 - 2, 0, 4, h);
      // ear holes
      for (const a of [PI / 2, -PI / 2]) {
        const [x, y] = shellUV(G.low, a, -0.32, w, h);
        c.fillStyle = shade(d2.secondary, -0.25); c.beginPath(); c.ellipse(x, y, w * 0.04, h * 0.1, 0, 0, TAU); c.fill();
        c.fillStyle = '#0b0c0f';
        for (let i = 0; i < 7; i++) { const an = i / 7 * TAU; c.beginPath(); c.arc(x + Math.cos(an) * w * 0.022, y + Math.sin(an) * h * 0.05, w * 0.006, 0, TAU); c.fill(); }
        c.beginPath(); c.arc(x, y, w * 0.007, 0, TAU); c.fill();
      }
      // number on the back, name on the sides above the ears
      const tc = d2.textColor;
      if (d2.number) { const [x, y] = shellUV(G.low, PI * 0.999, 0.35, w, h); drawText(c, d2.number, x, y, w * 0.14, h * 0.2, d2, { color: tc, sx: 0.6 }); }
      const txt = label(d2);
      if (txt) for (const a of [PI / 2, -PI / 2]) { const [x, y] = shellUV(G.low, a, 0.32, w, h); drawText(c, txt, x, y, w * 0.13, h * 0.08, d2, { color: tc, sx: 0.65 }); }
      rimM.color.set(shade(d2.secondary, -0.55));
      finish(shellM, d2, true);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.55, elev: 0.18, fit: 1.0 });
  }

  /* ---------------------------------------------------------------- */
  /* HOCKEY GLOVES: padded backhand, rolled finger segments, big cuff   */
  /* back of the hand faces +Z, fingers up, thumb on the left          */
  /* ---------------------------------------------------------------- */
  function buildHockeyGloves(item, d) {
    const G = C('hgloves', () => {
      const B = [0.5, 0.44, 0.27], BY = -0.18;
      const groove = y => 1 - 0.05 * Math.exp(-Math.pow((y - 0.08) / 0.035, 2)) - 0.05 * Math.exp(-Math.pow((y + 0.16) / 0.035, 2));
      const back = grid(64, 40, (u, v, t) => {
        const th = u * TAU, ph = (v - 0.5) * PI;
        const cp = spow(Math.cos(ph), 0.45), sp = spow(Math.sin(ph), 0.45);
        const yy = B[1] * sp, g = groove(yy);
        t.set(B[0] * cp * spow(Math.cos(th), 0.4) * g, BY + yy, B[2] * cp * spow(Math.sin(th), 0.5) * g * (Math.sin(th) > 0 ? 1.05 : 0.85));
        return [u, v];
      }, { outward: (u, v, p) => p.clone().sub(V(0, BY, 0)) });
      const fingerSec = (R, segs) => (v, a) => {
        const k = capK(v, 0, 0.14), sp = v * segs, f = sp - Math.round(sp);
        const gr = (sp > 0.6 && sp < segs - 0.4) ? 0.1 * Math.exp(-Math.pow(f / 0.09, 2)) : 0;
        const r = R * (1 - gr) * k;
        return [Math.cos(a) * r * 0.92, Math.sin(a) * r];
      };
      const finger = (x0, len, R, spread) => {
        const pts = []; for (let i = 0; i <= 5; i++) { const f = i / 5; pts.push(V(x0 + spread * f * f, 0.12 + len * f, 0.02 - 0.16 * f * f)); }
        return sweepF(pts, 24, 48, fingerSec(R, 3), { up: V(0, 0, 1) }).geo;
      };
      const fingers = mergeGeos([finger(-0.36, 0.72, 0.135, -0.04), finger(-0.12, 0.84, 0.14, -0.01), finger(0.12, 0.8, 0.138, 0.01), finger(0.36, 0.66, 0.128, 0.05)]);
      const thumbPts = [V(-0.38, -0.36, -0.04), V(-0.58, -0.2, -0.06), V(-0.72, 0.04, -0.09), V(-0.76, 0.3, -0.14)];
      const thumb = sweepF(thumbPts, 24, 40, fingerSec(0.15, 2), { up: V(0, 0, 1) }).geo;
      const guard = sweepF([V(-0.68, -0.02, -0.06), V(-0.75, 0.15, -0.1), V(-0.78, 0.32, -0.15)], 20, 20, (v, a) => { const k = capK(v, 0.3, 0.35); return [Math.cos(a) * 0.162 * k * 0.95, Math.sin(a) * 0.16 * k]; }, { up: V(0, 0, 1) }).geo;
      // cuff: flared elliptic roll
      const cuff = grid(72, 30, (u, v, t) => {
        const a = u * TAU + PI, y = lerp(-0.5, -1.38, v);
        const r = lerp(1, 1.24, smooth(0, 1, v)) + 0.05 * Math.sin(v * PI) + 0.035 * Math.exp(-Math.pow((v - 0.45) / 0.06, 2)) - 0.03 * Math.exp(-Math.pow((v - 0.55) / 0.03, 2));
        t.set(Math.sin(a) * 0.55 * r, y, Math.cos(a) * 0.37 * r);
        return [u, v];
      }, { outward: (u, v, p) => V(p.x, 0, p.z) });
      const lip = []; for (let i = 0; i < 64; i++) { const a = i / 64 * TAU + PI; lip.push(V(Math.sin(a) * 0.55 * 1.24, -1.39, Math.cos(a) * 0.37 * 1.24)); }
      const lipG = tube(lip, { closed: true, radius: 0.045, seg: 128, radial: 10 });
      const hole = new THREE.CircleGeometry(1, 40); hole.rotateX(PI / 2); hole.scale(0.62, 1, 0.42); hole.translate(0, -1.36, 0);
      return { back, fingers, thumb, guard, cuff, lip: lipG, hole };
    });
    const BK = ctex(item, 768, 512), FG = ctex(item, 256, 512), CF = ctex(item, 1024, 384);
    const backM = surfMat(item, { map: BK.tex, rough: 0.5, coat: 0.5, coatRough: 0.2, sheen: 0.4, normal: 'grain', nx: 8, ns: 0.18 });
    const fingM = surfMat(item, { map: FG.tex, rough: 0.5, coat: 0.5, coatRough: 0.2, sheen: 0.4, normal: 'grain', nx: 4, ny: 8, ns: 0.18 });
    const cuffM = surfMat(item, { map: CF.tex, rough: 0.55, coat: 0.4, coatRough: 0.25, sheen: 0.5, normal: 'grain', nx: 10, ny: 4, ns: 0.2 });
    item.add(G.back, backM); item.add(G.fingers, fingM); item.add(G.thumb, fingM); item.add(G.cuff, cuffM);
    const guardM = plastic(item, { color: '#ffffff', rough: 0.35 });
    guardM.userData.base = null;
    item.add(G.guard, guardM);
    const lipM = surfMat(item, { color: '#ffffff', rough: 0.6, sheen: 0.6 });
    item.add(G.lip, lipM);
    item.add(G.hole, surfMat(item, { color: '#101114', rough: 1, side: THREE.DoubleSide }));
    item.painters.push(d2 => {
      const palm = '#c9a47a';
      // backhand: u around Y from +X; back of hand (+Z) at u = 0.25, palm at 0.75
      let c = BK.ctx, w = BK.cv.width, h = BK.cv.height;
      paintPattern(c, 0, 0, w / 2, h, d2, { unit: w / 1.7 });
      c.fillStyle = palm; c.fillRect(w / 2, 0, w / 2, h);
      c.fillStyle = d2.secondary; c.fillRect(0, h * 0.58, w / 2, h * 0.07);
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.4, w / 2, h * 0.02);
      stitches(c, 0, h * 0.57, w / 2, h * 0.57, 'rgba(255,255,255,0.5)', 8 * item.q, 2 * item.q);
      if (d2.number) { c.save(); c.translate(w * 0.25, h * 0.27); c.scale(-1, 1); drawText(c, d2.number, 0, 0, w * 0.16, h * 0.14, d2, { color: d2.textColor }); c.restore(); }
      c.strokeStyle = 'rgba(80,50,20,0.35)'; c.lineWidth = 2 * item.q; // palm seams
      for (const yy of [0.3, 0.5, 0.7]) { c.beginPath(); c.moveTo(w * 0.55, h * yy); c.lineTo(w * 0.95, h * yy); c.stroke(); }
      stitches(c, w * 0.75, h * 0.15, w * 0.75, h * 0.85, 'rgba(255,255,255,0.45)', 6 * item.q, 2 * item.q);
      // fingers: u around from +Z (back) ; palm half leather
      c = FG.ctx; w = FG.cv.width; h = FG.cv.height;
      c.fillStyle = d2.primary; c.fillRect(0, 0, w, h);
      c.fillStyle = d2.secondary; c.fillRect(0, h * 0.36, w, h * 0.3);
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.355, w, h * 0.012); c.fillRect(0, h * 0.655, w, h * 0.012);
      c.fillStyle = palm; c.fillRect(w * 0.27, 0, w * 0.46, h);
      // cuff: front (+Z) at u = 0.5
      c = CF.ctx; w = CF.cv.width; h = CF.cv.height;
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 3.2 });
      c.fillStyle = d2.secondary; c.fillRect(0, h * 0.42, w, h * 0.2);
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.4, w, h * 0.02); c.fillRect(0, h * 0.62, w, h * 0.02);
      const txt = label(d2);
      if (txt) drawText(c, txt, w * 0.5, h * 0.52, w * 0.22, h * 0.15, d2, { color: ink(d2.secondary) });
      guardM.color.set(d2.secondary); lipM.color.set(d2.secondary);
      finish(backM, d2, true); finish(fingM, d2, true); finish(cuffM, d2, true);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.4, elev: 0.14, fit: 1.0 });
  }

  /* ---------------------------------------------------------------- */
  /* HOCKEY SKATES: rigid boot, tongue, tendon guard, holder, steel     */
  /* ---------------------------------------------------------------- */
  function buildSkates(item, d) {
    const G = C('skate', () => {
      const ctrl = [V(-0.42, 1.55, 0), V(-0.43, 1.15, 0), V(-0.37, 0.76, 0), V(-0.2, 0.48, 0), V(0.12, 0.35, 0), V(0.6, 0.31, 0), V(1.0, 0.28, 0), V(1.24, 0.27, 0)];
      const dims = v => {
        const hn = v < 0.3 ? lerp(0.32, 0.31, v / 0.3) : v < 0.5 ? lerp(0.31, 0.22, smooth(0.3, 0.5, v)) : lerp(0.22, 0.13, smooth(0.5, 1, v));
        const hb = v < 0.3 ? lerp(0.25, 0.23, v / 0.3) : v < 0.6 ? lerp(0.23, 0.27, smooth(0.3, 0.6, v)) : lerp(0.27, 0.21, smooth(0.6, 1, v));
        return [hn, hb];
      };
      const sec = (v, a) => {
        const [hn, hb] = dims(v), k = capK(v, 0, 0.08);
        const c = Math.cos(a), p = c < 0 && v > 0.35 ? 0.3 : 0.6;
        return [spow(c, p) * hn * k, spow(Math.sin(a), 0.55) * hb * Math.pow(k, 0.6)];
      };
      const boot = sweepF(ctrl, 48, 96, sec, { up: V(1, 0, 0) });
      // padded collar around the opening
      const loop = []; for (let i = 0; i < 48; i++) loop.push(boot.at(0, i / 48 * TAU).addScaledVector(V(0, 1, 0), 0.005));
      const collar = tube(loop, { closed: true, radius: 0.05, seg: 96, radial: 10 });
      const hole = new THREE.CircleGeometry(1, 32); hole.rotateX(-PI / 2); hole.scale(0.3, 1, 0.23); hole.translate(-0.42, 1.52, 0);
      // tongue and tendon guard
      const tongue = sweepF([V(-0.06, 1.2, 0), V(-0.04, 1.5, 0), V(0.06, 1.74, 0)], 20, 24, (v, a) => { const k = capK(v, 0, 0.25); return [Math.cos(a) * 0.05 * Math.pow(k, 0.5), spow(Math.sin(a), 0.5) * 0.17 * k]; }, { up: V(1, 0, 0) }).geo;
      const tendon = sweepF([V(-0.72, 1.25, 0), V(-0.76, 1.52, 0), V(-0.88, 1.78, 0)], 20, 24, (v, a) => { const k = capK(v, 0, 0.3); return [Math.cos(a) * 0.024 * Math.pow(k, 0.4), spow(Math.sin(a), 0.4) * lerp(0.12, 0.17, v) * k]; }, { up: V(1, 0, 0) }).geo;
      // laces + eyelets up the instep
      const lv = [0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68];
      const eye = (v, s) => { const j = Math.round(v * boot.nv), [hn, hb] = dims(v); return boot.pts[j].clone().addScaledVector(boot.F.N[j], hn * 0.96).addScaledVector(boot.F.B[j], s * hb * 0.55); };
      const laces = [], eyes = [];
      for (let i = 0; i < lv.length; i++) {
        for (const s of [-1, 1]) {
          const e = eye(lv[i], s), j = Math.round(lv[i] * boot.nv);
          const t = new THREE.TorusGeometry(0.026, 0.008, 6, 14); eyes.push(placeGeo(t, e.clone(), boot.F.N[j].clone().add(boot.F.B[j].clone().multiplyScalar(s * 0.5)).normalize()));
          if (i < lv.length - 1) {
            const e2 = eye(lv[i + 1], -s), m = e.clone().lerp(e2, 0.5).addScaledVector(boot.F.N[j], 0.03);
            laces.push(tube([e, m, e2], { radius: 0.017, flat: 0.45, seg: 10, radial: 6, up: boot.F.N[j] }));
          }
        }
      }
      // holder (plastic chassis with a window) and steel runner
      const hs = new THREE.Shape();
      hs.moveTo(-0.4, 0.16); hs.lineTo(1.12, 0.16); hs.quadraticCurveTo(1.2, 0.1, 1.14, -0.02); hs.quadraticCurveTo(1.08, -0.11, 0.96, -0.12);
      hs.lineTo(-0.3, -0.12); hs.quadraticCurveTo(-0.44, -0.1, -0.44, 0.04); hs.quadraticCurveTo(-0.44, 0.14, -0.4, 0.16);
      const w1 = new THREE.Path(); w1.moveTo(0.1, -0.03); w1.lineTo(0.5, -0.03); w1.quadraticCurveTo(0.56, -0.03, 0.54, 0.05); w1.quadraticCurveTo(0.4, 0.09, 0.3, 0.09); w1.quadraticCurveTo(0.12, 0.08, 0.08, 0.03); w1.quadraticCurveTo(0.06, -0.03, 0.1, -0.03);
      hs.holes.push(w1);
      const holder = extrude(hs, 0.1, 0.02, { segs: 2, curve: 12 });
      const bs = new THREE.Shape();
      bs.moveTo(-0.5, -0.06); bs.lineTo(1.18, -0.06); bs.quadraticCurveTo(1.32, -0.12, 1.24, -0.2);
      const rock = x => -0.255 + 0.05 * Math.pow((x - 0.38) / 0.86, 2);
      for (let i = 0; i <= 16; i++) { const x = lerp(1.18, -0.42, i / 16); bs.lineTo(x, rock(x)); }
      bs.quadraticCurveTo(-0.52, rock(-0.42) + 0.02, -0.5, -0.06);
      const blade = extrude(bs, 0.026, 0.004, { segs: 1, curve: 10 });
      return { boot: boot.geo, collar, hole, tongue, tendon, laces: mergeGeos(laces), eyes: mergeGeos(eyes), holder, blade };
    });
    const B = ctex(item, 512, 1024);
    const bootM = surfMat(item, { map: B.tex, rough: 0.42, coat: 0.7, coatRough: 0.15, normal: 'grain', nx: 6, ny: 12, ns: 0.12 });
    item.add(G.boot, bootM);
    const collarM = surfMat(item, { color: '#1c1d21', rough: 0.85, sheen: 0.8, normal: 'knit', nx: 30, ny: 2, ns: 0.4 });
    item.add(G.collar, collarM);
    item.add(G.hole, surfMat(item, { color: '#0e0f12', rough: 1 }));
    const TG = ctex(item, 128, 256);
    const tongueM = surfMat(item, { map: TG.tex, rough: 0.8, sheen: 1, normal: 'fuzz', nx: 3, ns: 0.4 });
    item.add(G.tongue, tongueM);
    const tendonM = plastic(item, { color: '#ffffff', rough: 0.3 });
    item.add(G.tendon, tendonM);
    const laceM = fabric(item, { color: '#ffffff', normal: 'rib', nx: 1, ny: 4, ns: 0.5 });
    item.add(G.laces, laceM);
    item.add(G.eyes, metal(item, { color: '#c9ced6', rough: 0.25 }));
    const holderM = plastic(item, { color: '#ffffff', rough: 0.25 });
    item.add(G.holder, holderM);
    item.add(G.blade, metal(item, { color: '#e8ebef', rough: 0.12 }));
    item.painters.push(d2 => {
      const c = B.ctx, w = B.cv.width, h = B.cv.height;
      // x: around the section (u .25 = outside +Z, u .75 = inside, 0/1 = instep/front, .5 = sole/back)
      // y: canvas top = ankle opening (v=0)... flipY: canvas y = (1 - v) * h
      c.save(); c.translate(0, h); c.scale(1, -1); // now y == v * h
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 1.3 });
      c.fillStyle = d2.secondary; c.fillRect(0, h * 0.78, w, h * 0.22); // toe cap
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.775, w, h * 0.01);
      c.fillStyle = shade(d2.secondary, -0.35); c.fillRect(w * 0.38, h * 0.38, w * 0.24, h * 0.62); // sole edge
      c.fillStyle = d2.accent; c.fillRect(w * 0.37, h * 0.38, w * 0.012, h * 0.4); c.fillRect(w * 0.62, h * 0.38, w * 0.012, h * 0.4);
      c.fillStyle = d2.secondary; c.fillRect(0, 0, w, h * 0.05);
      c.restore();
      const txt = label(d2);
      for (const x0 of [0.25, 0.75]) {
        c.save(); c.translate(w * x0, h * (1 - 0.63)); c.rotate(x0 < 0.5 ? -PI / 2 : PI / 2);
        if (txt) drawText(c, txt, 0, 0, h * 0.26, w * 0.13, d2, { color: d2.textColor });
        c.restore();
      }
      const t = TG.ctx, tw = TG.cv.width, th = TG.cv.height;
      t.fillStyle = d2.primary === '#ffffff' ? d2.secondary : '#f4f5f7'; t.fillRect(0, 0, tw, th);
      t.fillStyle = d2.accent; t.fillRect(0, th * 0.06, tw, th * 0.1);
      if (d2.number) drawText(t, d2.number, tw * 0.25, th * 0.42, tw * 0.3, th * 0.22, d2, { color: d2.primary });
      if (d2.number) drawText(t, d2.number, tw * 0.75, th * 0.42, tw * 0.3, th * 0.22, d2, { color: d2.primary });
      tendonM.color.set(d2.secondary); holderM.color.set(lum(d2.primary) < 0.05 ? '#f4f5f7' : '#16171b');
      laceM.color.set(lum(d2.accent) > 0.4 ? d2.accent : '#f4f5f7');
      finish(bootM, d2, true);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.55, elev: 0.16, fit: 1.0 });
  }

  /* ---------------------------------------------------------------- */
  /* FOOTBALL HELMET: glossy shell, center stripe, facemask, chin cup  */
  /* ---------------------------------------------------------------- */
  const FH = { rx: 0.86, ry: 0.86, ry2: 0.8, rf: 1.03, rb: 1.05, crown: 0.72, eF: 0.34, eS: -1.0, eB: -0.62, a0: 0.4, a1: 0.95, b0: 2.0, taper: 0.17, thin: 0.92,
    bump: (a, e) => 0.03 * smooth(-0.2, -0.9, e) * smooth(0.4, 1.0, Math.abs(Math.sin(a))) };
  function maskPoint(f, y) {
    const t = clamp((y + 0.82) / 1.0, 0, 1); // 0 chin .. 1 brow
    const W = lerp(0.6, 0.86, smooth(0, 0.7, t)), A = 1.12;
    const Zf = lerp(1.06, 1.2, Math.sin(t * PI * 0.8)) - t * 0.04;
    const a = f * A, D = (Zf - 0.5) / (1 - Math.cos(A));
    return V(Math.sin(a) * W, y, Zf - (1 - Math.cos(a)) * D);
  }
  function stripeGeos(P, offs) {
    const low = lowFn(P), ptsFor = ox => {
      const pts = [];
      for (let i = 0; i <= 14; i++) pts.push(shellP(P, 0, lerp(low(0) + 0.06, PI / 2 - 0.02, i / 14), 1.006));
      for (let i = 1; i <= 16; i++) pts.push(shellP(P, PI, lerp(PI / 2 - 0.02, low(PI) + 0.05, i / 16), 1.006));
      return pts.map(p => { const s = Math.sqrt(Math.max(0, 1 - Math.pow(ox / P.rx, 2) * 0.6)); return V(ox, p.y * lerp(1, s, 0.5) + 0.004, p.z * s); });
    };
    return offs.map(([ox, hw]) => sweepF(ptsFor(ox), 8, 90, (v, a) => [spow(Math.cos(a), 0.25) * hw, spow(Math.sin(a), 0.25) * 0.006], { up: V(1, 0, 0) }).geo);
  }
  function buildFootballHelmet(item, d) {
    const P = FH;
    const G = C('fhelmet', () => {
      const sh = shellGeos(P);
      const [s0, s1, s2] = stripeGeos(P, [[0, 0.03], [-0.075, 0.035], [0.075, 0.035]]);
      const R = 0.032, bars = [];
      for (const y of [0.02, -0.3, -0.56]) { const pts = []; for (let i = 0; i <= 18; i++) pts.push(maskPoint(lerp(-1, 1, i / 18), y)); bars.push(tube(pts, { radius: R, seg: 60, radial: 10 })); }
      { const pts = []; for (let i = 0; i <= 14; i++) pts.push(maskPoint(lerp(-0.62, 0.62, i / 14), -0.8 + 0.06 * Math.pow(lerp(-1, 1, i / 14), 2))); bars.push(tube(pts, { radius: R, seg: 44, radial: 10 })); }
      for (const f of [0, -0.42, 0.42]) { const pts = []; for (let i = 0; i <= 8; i++) { const y = lerp(f ? -0.3 : 0.02, f ? -0.77 : -0.8, i / 8); pts.push(maskPoint(f, y)); } bars.push(tube(pts, { radius: R, seg: 24, radial: 10 })); }
      for (const s of [-1, 1]) { const pts = [maskPoint(s * 0.62, -0.76), maskPoint(s * 0.85, -0.66), maskPoint(s, -0.56)]; bars.push(tube(pts, { radius: R, seg: 16, radial: 10 })); }
      const mask = mergeGeos(bars);
      const clips = mergeGeos([[1, 0.02], [-1, 0.02], [1, -0.56], [-1, -0.56]].map(([s, y]) => { const p = maskPoint(s, y); const b = new THREE.BoxGeometry(0.07, 0.12, 0.09); b.translate(p.x - s * 0.02, p.y, p.z - 0.02); return b; }));
      const cup = new THREE.SphereGeometry(0.2, 22, 10, 0, TAU, 0, PI * 0.5); cup.scale(1, 0.62, 0.7); cup.rotateX(PI / 2 + 0.5); cup.translate(0, -0.98, 0.78);
      const strap = mergeGeos([-1, 1].map(s => tube([shellP(P, s * 1.25, -0.72), V(s * 0.5, -0.92, 0.55), V(s * 0.18, -1.0, 0.76)], { radius: 0.03, flat: 0.3, seg: 30, radial: 8 })));
      return { ...sh, s0, s1, s2, mask, clips, cup, strap };
    });
    const S = ctex(item, 1024, 512);
    const shellM = plastic(item, { map: S.tex, rough: 0.22, coat: 1, coatRough: 0.04 });
    item.add(G.outer, shellM);
    item.add(G.inner, surfMat(item, { color: '#24262b', rough: 0.95, normal: 'pebble', nx: 6, ns: 0.6 }));
    const rimM = rubber(item, { color: '#17181c', rough: 0.55 });
    item.add(G.rim, rimM);
    const st1 = plastic(item, { color: '#ffffff', rough: 0.25 }), st2 = plastic(item, { color: '#000000', rough: 0.25 });
    item.add(G.s0, st1); item.add(G.s1, st2); item.add(G.s2, st2);
    const maskM = plastic(item, { color: '#888888', rough: 0.38, coat: 0.6, metal: 0.25 });
    item.add(G.mask, maskM);
    const clipM = plastic(item, { color: '#f4f5f7', rough: 0.3 });
    item.add(G.clips, clipM); item.add(G.cup, clipM);
    const strapM = rubber(item, { color: '#141518', rough: 0.6 });
    item.add(G.strap, strapM);
    item.painters.push(d2 => {
      const c = S.ctx, w = S.cv.width, h = S.cv.height;
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 3.4, pattern: ['solid', 'gradient', 'flames', 'camo', 'hex', 'halftone', 'waves', 'pinstripe'].includes(d2.pattern) ? d2.pattern : 'solid' });
      // ear holes
      for (const a of [PI / 2, -PI / 2]) {
        const [x, y] = shellUV(G.low, a, -0.42, w, h);
        c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(x, y, w * 0.024, h * 0.058, 0, 0, TAU); c.fill();
        c.fillStyle = '#0b0c0f'; c.beginPath(); c.ellipse(x, y, w * 0.016, h * 0.04, 0, 0, TAU); c.fill();
      }
      // original side emblem: bold bolt in a ring, or the number
      for (const a of [PI / 2, -PI / 2]) {
        const [x, y] = shellUV(G.low, a * 0.86, 0.12, w, h);
        c.save(); c.translate(x, y); c.scale(0.6 * (a > 0 ? 1 : 1), 1);
        const R = h * 0.17;
        if (d2.number && !d2.chest) { drawText(c, d2.number, 0, 0, R * 2.2, R * 1.7, d2, { color: d2.secondary, strokeColor: d2.accent, outline: true }); }
        else {
          c.lineWidth = R * 0.16; c.strokeStyle = d2.accent; c.fillStyle = d2.secondary;
          c.beginPath(); c.moveTo(-R * 0.15, -R); c.lineTo(R * 0.55, -R); c.lineTo(R * 0.1, -R * 0.15); c.lineTo(R * 0.6, -R * 0.15); c.lineTo(-R * 0.45, R * 1.05); c.lineTo(-R * 0.05, R * 0.1); c.lineTo(-R * 0.5, R * 0.1); c.closePath();
          c.stroke(); c.fill();
        }
        c.restore();
      }
      // back bumper: name + number
      const txt = d2.name || d2.chest;
      { const [x, y] = shellUV(G.low, PI * 0.999, -0.3, w, h); if (txt) drawText(c, txt, x, y, w * 0.16, h * 0.08, d2, { color: d2.textColor, sx: 0.6, outline: false }); }
      { const [x, y] = shellUV(G.low, PI * 0.999, 0.25, w, h); if (d2.number) drawText(c, d2.number, x, y, w * 0.07, h * 0.13, d2, { color: d2.textColor, sx: 0.6 }); }
      st1.color.set(d2.accent); st2.color.set(d2.secondary);
      maskM.color.set(lum(d2.secondary) > 0.02 ? d2.secondary : '#8a8f98');
      finish(shellM, d2, false);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.7, elev: 0.14, fit: 1.0 });
  }

  /* ---------------------------------------------------------------- */
  /* BATTING HELMET: gloss shell, visor brim, single ear flap          */
  /* ---------------------------------------------------------------- */
  const BH = { rx: 0.8, ry: 0.8, ry2: 0.72, rf: 0.98, rb: 1.02, crown: 0.75, eF: 0.26, eS: -0.38, eB: -0.48, a0: 0.5, a1: 1.15, b0: 2.2, taper: 0.1, thin: 0.93,
    extra: x => -0.6 * smooth(0.55, 1.05, x) * smooth(2.5, 1.95, x) };
  function buildBattingHelmet(item, d) {
    const P = BH;
    const G = C('bhelmet', () => {
      const sh = shellGeos(P);
      const low = sh.low, AM = 1.0;
      const brimAt = (u, v, t) => {
        const a = lerp(-AM, AM, u), q = v * TAU, s = (1 - Math.cos(q)) / 2;
        const root = shellP(P, a, low(a) + 0.05, 0.99);
        const out = V(Math.sin(a), 0, Math.cos(a));
        const wd = 0.34 * Math.pow(Math.max(0, Math.cos(a / AM * PI / 2)), 0.55);
        return t.copy(root).addScaledVector(out, s * wd).add(V(0, Math.sin(q) * 0.022 * (1 - 0.5 * s) - 0.07 * s * s, 0));
      };
      const brim = grid(48, 16, (u, v, t) => { brimAt(u, v, t); return [u, v]; }, { outward: (u, v, p) => V(0, Math.sin(v * TAU), 0) });
      const vents = [];
      for (const [a, e] of [[0.32, 1.0], [-0.32, 1.0], [PI, 0.9], [2.6, 0.75], [-2.6, 0.75]]) {
        const p = shellP(P, a, e), n = shellN(P, a, e), tng = shellP(P, a, e + 0.05).sub(p).normalize();
        vents.push(placeGeo(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 18), p.addScaledVector(n, -0.003), n, 0, tng));
      }
      const ep = shellP(P, PI / 2, -0.42), en = shellN(P, PI / 2, -0.42);
      const ear = placeGeo(new THREE.TorusGeometry(0.1, 0.018, 8, 28).rotateX(PI / 2), ep.clone().addScaledVector(en, 0.004), en);
      const earIn = placeGeo(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 28), ep.clone().addScaledVector(en, -0.004), en);
      return { ...sh, brim, vents: mergeGeos(vents), ear, earIn };
    });
    const S = ctex(item, 1024, 512);
    const shellM = plastic(item, { map: S.tex, rough: 0.2, coat: 1, coatRough: 0.03 });
    item.add(G.outer, shellM);
    const brimM = plastic(item, { color: '#ffffff', rough: 0.22 });
    item.add(G.brim, brimM);
    item.add(G.inner, surfMat(item, { color: '#202227', rough: 0.95, normal: 'pebble', nx: 6, ns: 0.6 }));
    const rimM = rubber(item, { color: '#17181c', rough: 0.5 });
    item.add(G.rim, rimM);
    const dark = surfMat(item, { color: '#0d0e11', rough: 0.8 });
    item.add(G.vents, dark); item.add(G.earIn, dark);
    const earM = plastic(item, { color: '#ffffff', rough: 0.3 });
    item.add(G.ear, earM);
    item.painters.push(d2 => {
      const c = S.ctx, w = S.cv.width, h = S.cv.height;
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 3.4, pattern: ['solid', 'gradient', 'pinstripe', 'camo', 'hex', 'halftone', 'flames', 'waves'].includes(d2.pattern) ? d2.pattern : 'solid' });
      // crown piping front to back
      c.fillStyle = d2.accent; c.fillRect(w * 0.5 - w * 0.004, 0, w * 0.008, h); c.fillRect(0, 0, w * 0.004, h); c.fillRect(w - w * 0.004, 0, w * 0.004, h);
      // emblem on the open side, number on the back
      { const [x, y] = shellUV(G.low, -PI / 2, 0.2, w, h); c.save(); c.translate(x, y); c.scale(0.6, 1);
        const R = h * 0.14; c.fillStyle = d2.secondary; c.strokeStyle = d2.accent; c.lineWidth = R * 0.14;
        c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill(); c.stroke();
        const t = (d2.text || d2.chest || d2.name || 'S').slice(0, 1);
        drawText(c, t, 0, 0, R * 1.3, R * 1.2, d2, { color: ink(d2.secondary), outline: false });
        c.restore(); }
      { const [x, y] = shellUV(G.low, PI * 0.999, 0.15, w, h); if (d2.number) drawText(c, d2.number, x, y, w * 0.09, h * 0.16, d2, { color: d2.textColor, sx: 0.6 }); }
      { const [x, y] = shellUV(G.low, PI / 2, 0.42, w, h); const t = d2.name || d2.chest; if (t) drawText(c, t, x, y, w * 0.12, h * 0.07, d2, { color: d2.textColor, sx: 0.6, outline: false }); }
      brimM.color.set(d2.primary); earM.color.set(d2.secondary); rimM.color.set(shade(d2.primary, -0.6));
      finish(shellM, d2, false); finish(brimM, d2, false);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.75, elev: 0.16, fit: 1.0 });
  }

  /* ---------------------------------------------------------------- */
  /* SHOULDER PADS: arch plates, layered shoulder caps, front laces    */
  /* ---------------------------------------------------------------- */
  function buildShoulderPads(item, d) {
    const GAP = 0.03, ET = 1.33;
    const bodyP = (a, e, s = 1, out = V()) => {
      let r, y;
      if (e >= 0) { r = Math.pow(Math.max(0, Math.cos(e)), 0.5); y = 0.44 * Math.sin(e); } else { r = 1 + 0.04 * e; y = e * 0.75; }
      return out.set(0.95 * spow(Math.sin(a), 0.6) * r * s, y * s + (1 - s) * 0.05, 0.5 * spow(Math.cos(a), 0.6) * r * s);
    };
    const lowB = a => lerp(-1.0, 0.25, smooth(0.5, 0.92, Math.abs(Math.sin(a))));
    const capP = (sd, ra, rb, h, C0, D, th, ph, s = 1, out = V()) => {
      const Dn = D.clone().normalize(), Z = V(0, 0, 1), Ax = Dn.clone().cross(Z).multiplyScalar(-sd);
      return out.copy(C0).addScaledVector(Dn, Math.cos(th) * h * s).addScaledVector(Ax, Math.sin(th) * Math.cos(ph) * ra * s).addScaledVector(Z, Math.sin(th) * Math.sin(ph) * rb * s);
    };
    const G = C('spads', () => {
      const au = u => GAP + u * (TAU - 2 * GAP);
      const ev = (a, v) => lerp(lowB(a), ET, v);
      const body = grid(120, 36, (u, v, t) => { const a = au(u); bodyP(a, ev(a, v), 1, t); return [u, v]; }, { outward: (u, v, p) => V(p.x, p.y - 0.1, p.z) });
      const bodyIn = grid(120, 36, (u, v, t) => { const a = au(u); bodyP(a, ev(a, v), 0.93, t); return [u, v]; }, { outward: (u, v, p) => V(-p.x, 0.1 - p.y, -p.z) });
      const edge = (fn, n, closed) => { const pts = []; for (let i = 0; i <= n; i++) pts.push(fn(i / n)); return tube(pts, { radius: 0.03, seg: n * 2, radial: 8, closed }); };
      const rims = mergeGeos([
        edge(u => { const a = au(u); return bodyP(a, lowB(a), 0.965); }, 120),
        edge(u => { const a = au(u); return bodyP(a, ET, 0.965); }, 80),
        edge(v => { const a = au(0); return bodyP(a, ev(a, v), 0.965); }, 30),
        edge(v => { const a = au(1); return bodyP(a, ev(a, v), 0.965); }, 30),
      ]);
      const caps = [], capsIn = [], capRims = [], eps = [], epsIn = [], epRims = [];
      for (const sd of [-1, 1]) {
        const mk = (ra, rb, h, C0, D, TM, outL, inL, rimL) => {
          outL.push(grid(48, 20, (u, v, t) => { capP(sd, ra, rb, h, C0, D, v * TM, u * TAU, 1, t); return [u, v]; }, { outward: (u, v, p) => p.clone().sub(C0) }));
          inL.push(grid(48, 20, (u, v, t) => { capP(sd, ra, rb, h, C0, D, v * TM, u * TAU, 0.92, t); return [u, v]; }, { outward: (u, v, p) => C0.clone().sub(p) }));
          const pts = []; for (let i = 0; i < 48; i++) pts.push(capP(sd, ra, rb, h, C0, D, TM, i / 48 * TAU, 0.96));
          rimL.push(tube(pts, { closed: true, radius: 0.028, seg: 96, radial: 8 }));
        };
        mk(0.56, 0.62, 0.42, V(sd * 0.7, 0.06, 0), V(sd * 0.8, 0.62, 0), 1.3, caps, capsIn, capRims);
        mk(0.38, 0.44, 0.36, V(sd * 0.86, 0.12, 0), V(sd * 0.85, 0.5, 0), 1.2, eps, epsIn, epRims);
      }
      // laces across the front split
      const L = [];
      const ys = [-0.62, -0.45, -0.28, -0.11];
      const side = (y, s) => V(s * 0.13, y, 0.505);
      for (let i = 0; i < ys.length - 1; i++) for (const s of [-1, 1]) {
        const a0 = side(ys[i], s), a1 = side(ys[i + 1], -s), m = a0.clone().lerp(a1, 0.5).add(V(0, 0, 0.025));
        L.push(tube([a0, m, a1], { radius: 0.016, seg: 10, radial: 6 }));
      }
      const eyes = mergeGeos(ys.flatMap(y => [-1, 1].map(s => placeGeo(new THREE.TorusGeometry(0.025, 0.008, 6, 14), side(y, s), V(0, 0, 1)))));
      return { body, bodyIn, rims, caps: mergeGeos(caps), capsIn: mergeGeos([...capsIn, ...epsIn]), capRims: mergeGeos(capRims), eps: mergeGeos(eps), epRims: mergeGeos(epRims), laces: mergeGeos(L), eyes };
    });
    const BD = ctex(item, 1024, 384), CP = ctex(item, 512, 256), EP = ctex(item, 512, 256);
    const bodyM = plastic(item, { map: BD.tex, rough: 0.3, coat: 0.9, coatRough: 0.08 });
    const capM = plastic(item, { map: CP.tex, rough: 0.26, coat: 1 });
    const epM = plastic(item, { map: EP.tex, rough: 0.26, coat: 1 });
    item.add(G.body, bodyM); item.add(G.caps, capM); item.add(G.eps, epM);
    const foam = surfMat(item, { color: '#2a2d33', rough: 0.95, sheen: 0.6, normal: 'pebble', nx: 10, ns: 0.6 });
    item.add(G.bodyIn, foam); item.add(G.capsIn, foam);
    const rimM = rubber(item, { color: '#17181c', rough: 0.55 });
    item.add(G.rims, rimM); item.add(G.capRims, rimM); item.add(G.epRims, rimM);
    const laceM = fabric(item, { color: '#ffffff', normal: 'rib', nx: 1, ny: 4 });
    item.add(G.laces, laceM);
    item.add(G.eyes, metal(item, { color: '#c9ced6' }));
    item.painters.push(d2 => {
      let c = BD.ctx, w = BD.cv.width, h = BD.cv.height;
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 4 });
      c.fillStyle = d2.secondary; c.fillRect(0, h * 0.84, w, h * 0.16);
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.83, w, h * 0.012);
      const tc = d2.textColor;
      if (d2.number) for (const x of [0.075, 0.925]) drawText(c, d2.number, w * x, h * 0.66, w * 0.06, h * 0.18, d2, { color: tc });
      const txt = d2.name || d2.chest; if (txt) drawText(c, txt, w * 0.5, h * 0.3, w * 0.2, h * 0.16, d2, { color: tc });
      if (d2.number) drawText(c, d2.number, w * 0.5, h * 0.58, w * 0.12, h * 0.3, d2, { color: tc });
      // caps: v from dome top (canvas bottom) to rim (canvas top)
      for (const [X, k] of [[CP, 1], [EP, 0]]) {
        c = X.ctx; w = X.cv.width; h = X.cv.height;
        if (k) { paintPattern(c, 0, 0, w, h, d2, { unit: w / 2 }); c.fillStyle = d2.secondary; c.fillRect(0, 0, w, h * 0.16); c.fillStyle = d2.accent; c.fillRect(0, h * 0.2, w, h * 0.05); }
        else { c.fillStyle = d2.secondary; c.fillRect(0, 0, w, h); c.fillStyle = d2.accent; c.fillRect(0, h * 0.14, w, h * 0.06); c.fillStyle = d2.primary; c.fillRect(0, h * 0.24, w, h * 0.03); }
      }
      laceM.color.set(lum(d2.accent) > 0.4 ? d2.accent : '#f4f5f7');
      finish(bodyM, d2, false); finish(capM, d2, false); finish(epM, d2, false);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.4, elev: 0.3, fit: 1.0 });
  }

  /* ---------------------------------------------------------------- */
  /* BASEBALL BAT: turned barrel, taper, taped handle, flared knob     */
  /* ---------------------------------------------------------------- */
  function buildBat(item, d) {
    const G = C('bat', () => {
      const P = [[0.0001, 0], [0.085, 0.0], [0.112, 0.025], [0.11, 0.07], [0.068, 0.12], [0.06, 0.2], [0.062, 0.9], [0.066, 1.25], [0.085, 1.7], [0.118, 2.15], [0.134, 2.5], [0.136, 3.25], [0.13, 3.36], [0.1, 3.4], [0.0001, 3.405]];
      const pr = K.spline(P.map((p, i) => [i, p[0]])), py = K.spline(P.map((p, i) => [i, p[1]]));
      const body = K.lathe(40, 160, v => { const t = v * (P.length - 1); return [Math.max(0.0001, pr(t) * 1.15), py(t)]; }, { a0: PI, vmap: (v, y) => y / 3.405 });
      const grip = K.lathe(40, 40, v => { const y = lerp(0.16, 1.18, v); return [0.0755 + 0.003 * (y > 0.9 ? (y - 0.9) / 0.3 : 0) + (v < 0.03 || v > 0.97 ? -0.004 : 0), y]; }, { a0: PI });
      return { body, grip };
    });
    const B = ctex(item, 512, 1536);
    const bodyM = surfMat(item, { map: B.tex, rough: 0.3, coat: 1, coatRough: 0.08, metal: 0.25 });
    item.add(G.body, bodyM);
    const GR = ctex(item, 256, 512);
    const gripM = rubber(item, { map: GR.tex, rough: 0.7, normal: 'pebble', nx: 2, ny: 12, ns: 0.4 });
    item.add(G.grip, gripM);
    item.painters.push(d2 => {
      const c = B.ctx, w = B.cv.width, h = B.cv.height;
      const Y = y => (1 - y / 3.405) * h;
      paintPattern(c, 0, Y(3.405), w, Y(1.7) - Y(3.405), d2, { unit: w / 1.6 });
      c.fillStyle = d2.secondary; c.fillRect(0, Y(1.7), w, h - Y(1.7));
      const g = c.createLinearGradient(0, Y(2.2), 0, Y(1.6)); g.addColorStop(0, d2.primary); g.addColorStop(1, d2.secondary);
      c.fillStyle = g; c.fillRect(0, Y(2.2), w, Y(1.6) - Y(2.2));
      c.fillStyle = d2.accent; c.fillRect(0, Y(3.3), w, h * 0.006); c.fillRect(0, Y(2.24), w, h * 0.006);
      c.fillStyle = shade(d2.secondary, -0.4); c.fillRect(0, Y(3.405), w, Y(3.36) - Y(3.405)); c.fillRect(0, Y(0.13), w, h - Y(0.13));
      const txt = label(d2);
      c.save(); c.translate(w * 0.5, Y(2.75)); c.rotate(-PI / 2);
      if (txt) drawText(c, txt, 0, 0, h * 0.26, w * 0.16, d2, { color: d2.textColor });
      c.restore();
      c.save(); c.translate(w * 0.5, Y(2.05)); c.rotate(-PI / 2);
      drawText(c, (d2.number ? '#' + d2.number + '  ' : '') + 'ALLOY  33 IN', 0, 0, h * 0.12, w * 0.05, modern(d2), { color: ink(mix(d2.primary, d2.secondary, 0.5)), outline: false });
      c.restore();
      tapeWrap(GR.ctx, GR.cv.width, GR.cv.height, lum(d2.secondary) < 0.05 ? '#2a2c31' : shade(d2.secondary, -0.15), 14, { stripe: mix(d2.accent, d2.secondary, 0.5) });
      finish(bodyM, d2, false);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.15, roll: -0.95, elev: 0.12, fit: 0.98 });
  }

  /* ---------------------------------------------------------------- */
  /* BASEBALL MITT: cupped leather glove, laced finger tips, web       */
  /* palm (pocket) faces +Z, fingers up, thumb on the left             */
  /* ---------------------------------------------------------------- */
  function buildMitt(item, d) {
    const DEP = 0.3, BEV = 0.13, BS = 0.1;
    const bend = (x, y) => 0.36 * Math.pow(x / 0.95, 2) + 0.16 * Math.pow((y - 0.05) / 1.05, 2) - 0.14 * Math.exp(-(x * x + Math.pow(y - 0.05, 2)) / 0.16);
    const G = C('mitt', () => {
      const O = [[0, -1.02], [0.42, -1.0], [0.6, -0.7], [0.76, -0.2], [0.86, 0.22], [0.88, 0.52], [0.8, 0.68], [0.68, 0.66], [0.62, 0.74], [0.56, 0.9], [0.42, 0.98], [0.32, 0.92], [0.26, 1.04], [0.12, 1.12], [-0.0, 1.07], [-0.06, 0.98], [-0.14, 1.05], [-0.28, 1.03], [-0.36, 0.9], [-0.4, 0.6], [-0.48, 0.32], [-0.58, 0.52], [-0.7, 0.84], [-0.84, 0.92], [-0.95, 0.76], [-0.97, 0.3], [-0.86, -0.3], [-0.64, -0.82], [-0.36, -1.02]];
      const sh = new THREE.Shape(); sh.moveTo(O[0][0], O[0][1]); sh.splineThru(O.slice(1).concat([O[0]]).map(p => new THREE.Vector2(p[0], p[1])));
      const bendGeo = g => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + bend(p.getX(i), p.getY(i))); g.deleteAttribute('normal'); g.computeVertexNormals(); K.weldNormals(g); return g; };
      const body = bendGeo(extrude(sh, DEP, BEV, { bs: BS / BEV, segs: 4, curve: 4 }));
      // web: ladder between thumb and index
      const ws = new THREE.Shape(); ws.moveTo(-0.38, 0.4); ws.splineThru([[-0.38, 0.75], [-0.4, 1.0], [-0.55, 1.06], [-0.74, 0.98], [-0.66, 0.62], [-0.5, 0.36], [-0.38, 0.4]].map(p => new THREE.Vector2(p[0], p[1])));
      for (const [y0, y1] of [[0.5, 0.62], [0.68, 0.8], [0.86, 0.96]]) { const hp = new THREE.Path(); const x0 = y0 < 0.6 ? -0.55 : -0.62, x1 = -0.44; hp.moveTo(x0, y0); hp.lineTo(x1, y0); hp.lineTo(x1, y1); hp.lineTo(x0 - 0.02, y1); hp.lineTo(x0, y0); ws.holes.push(hp); }
      const web = extrude(ws, 0.07, 0.025, { segs: 2, curve: 6 });
      { const p = web.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + bend(p.getX(i), p.getY(i)) - 0.02); web.deleteAttribute('normal'); web.computeVertexNormals(); K.weldNormals(web); }
      // laces around the finger tips and thumb: half loops wrapping the rim
      const pts = sh.getSpacedPoints(150), L = [];
      for (let i = 0; i < pts.length - 1; i += 2) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        if (p.y < 0.25 || (p.x < -0.35 && p.x > -0.62 && p.y < 1.05)) continue;
        const tg = V(q.x - p.x, q.y - p.y, 0).normalize(), n = V(tg.y, -tg.x, 0);
        const R = DEP / 2 + BEV + 0.01;
        const tor = new THREE.TorusGeometry(R, 0.02, 6, 12, PI); tor.scale(1, 1, 1.6);
        const m = new THREE.Matrix4().makeBasis(V(0, 0, 1), n, V(0, 0, 1).cross(n));
        tor.applyMatrix4(m);
        tor.translate(p.x + n.x * (BS - R + 0.012), p.y + n.y * (BS - R + 0.012), bend(p.x, p.y));
        L.push(tor);
      }
      // heel roll and wrist strap on the back
      const heel = []; for (let i = 0; i <= 20; i++) { const x = lerp(-0.6, 0.55, i / 20), y = -0.9 + 0.12 * Math.pow(x / 0.6, 2); heel.push(V(x, y, bend(x, y) + DEP / 2 + 0.06)); }
      const heelG = tube(heel, { radius: 0.07, seg: 40, radial: 12 });
      const strap = extrude(roundRect(-0.5, -0.92, 0.95, 0.28, 0.12), 0.06, 0.03, { segs: 2 });
      strap.translate(0, 0, -(DEP / 2 + BEV) + bend(0, -0.78) - 0.02);
      const patch = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 28); patch.scale(1.4, 1, 1); patch.rotateX(PI / 2); patch.translate(0.0, -0.78, -(DEP / 2 + BEV) + bend(0, -0.78) - 0.065);
      return { body, web, laces: mergeGeos(L), heel: heelG, strap, patch };
    });
    const T = ctex(item, 768, 768);
    const leather = surfMat(item, { map: T.tex, rough: 0.55, coat: 0.35, coatRough: 0.3, normal: 'grain', nx: 5, ns: 0.35, sheen: 0.3 });
    item.add(G.body, leather);
    const webM = surfMat(item, { color: '#ffffff', rough: 0.55, coat: 0.3, normal: 'grain', nx: 2, ns: 0.3 });
    item.add(G.web, webM);
    const laceM = surfMat(item, { color: '#ffffff', rough: 0.6, normal: 'grain', nx: 1, ns: 0.3 });
    item.add(G.laces, laceM);
    const heelM = surfMat(item, { color: '#ffffff', rough: 0.55, normal: 'grain', nx: 2, ns: 0.3 });
    item.add(G.heel, heelM);
    const strapM = surfMat(item, { color: '#ffffff', rough: 0.5, normal: 'grain', nx: 2, ns: 0.3 });
    item.add(G.strap, strapM);
    const PT = ctex(item, 256, 128);
    item.add(G.patch, [surfMat(item, { color: '#ffffff', rough: 0.4 }), surfMat(item, { map: PT.tex, rough: 0.4 }), surfMat(item, { color: '#ffffff', rough: 0.4 })]);
    item.painters.push(d2 => {
      const c = T.ctx, w = T.cv.width, h = T.cv.height;
      const X = x => (x + 0.97) / 1.85 * w, Y = y => (1 - (y + 1.02) / 2.14) * h;
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 1.4, pattern: ['solid', 'gradient', 'pinstripe', 'camo', 'halftone'].includes(d2.pattern) ? d2.pattern : 'solid' });
      // pocket: darker oiled leather
      const g = c.createRadialGradient(X(0.05), Y(0.1), 0, X(0.05), Y(0.1), w * 0.33);
      g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      // finger stall seams + stitches
      for (const [x0, y0, x1, y1] of [[0.6, 0.66, 0.5, 0.25], [0.29, 0.93, 0.25, 0.3], [-0.05, 0.98, 0.0, 0.32]]) {
        c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 4 * item.q; c.beginPath(); c.moveTo(X(x0), Y(y0)); c.lineTo(X(x1), Y(y1)); c.stroke();
        stitches(c, X(x0) + 5 * item.q, Y(y0), X(x1) + 5 * item.q, Y(y1), d2.accent, 6 * item.q, 2 * item.q);
      }
      // palm accent welt and thumb text
      c.fillStyle = d2.secondary; c.beginPath(); c.ellipse(X(-0.8), Y(0.2), w * 0.06, h * 0.18, 0.15, 0, TAU); c.fill();
      const txt = d2.name || d2.chest;
      if (txt) { c.save(); c.translate(X(-0.8), Y(0.2)); c.rotate(-PI / 2 + 0.15); drawText(c, txt, 0, 0, h * 0.3, w * 0.07, d2, { color: ink(d2.secondary), outline: false }); c.restore(); }
      if (d2.number) drawText(c, d2.number, X(0.66), Y(0.0), w * 0.12, h * 0.1, d2, { color: d2.textColor });
      const p = PT.ctx, pw = PT.cv.width, ph = PT.cv.height;
      p.fillStyle = d2.secondary; p.fillRect(0, 0, pw, ph);
      p.strokeStyle = d2.accent; p.lineWidth = ph * 0.06; p.strokeRect(ph * 0.08, ph * 0.08, pw - ph * 0.16, ph * 0.84);
      drawText(p, d2.text || 'PRO 11.5', pw / 2, ph / 2, pw * 0.75, ph * 0.5, d2, { color: ink(d2.secondary), outline: false });
      const laceC = lum(d2.secondary) > 0.02 ? d2.secondary : '#7a4a26';
      laceM.color.set(laceC); webM.color.set(mix(d2.primary, d2.secondary, 0.4)); heelM.color.set(d2.secondary); strapM.color.set(d2.secondary);
      finish(leather, d2, true);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.3, elev: 0.12, fit: 1.0 });
  }

  /* ---------------------------------------------------------------- */
  /* GOALKEEPER GLOVES (pair): roll finger latex, wide strap, neoprene  */
  /* ---------------------------------------------------------------- */
  function gkGloveGeo() {
    return C('gkglove', () => {
      const PA = [0.46, 0.5, 0.17], PY = -0.12;
      const palm = grid(56, 36, (u, v, t) => {
        const th = (u - 0.5) * TAU, ph = (v - 0.5) * PI;
        const cp = spow(Math.cos(ph), 0.5), sp = spow(Math.sin(ph), 0.55);
        t.set(PA[0] * cp * spow(Math.sin(th), 0.45), PY + PA[1] * sp, PA[2] * cp * spow(Math.cos(th), 0.7) * (Math.cos(th) > 0 ? 1.1 : 0.95));
        return [u, v];
      }, { outward: (u, v, p) => p.clone().sub(V(0, PY, 0)) });
      const fsec = R => (v, a) => { const k = capK(v, 0, 0.16), r = R * (1 + 0.05 * Math.sin(v * PI * 2.2)) * k; return [-Math.cos(a) * r * 0.9, -Math.sin(a) * r]; };
      const finger = (x0, len, R, spread) => {
        const pts = []; for (let i = 0; i <= 5; i++) { const f = i / 5; pts.push(V(x0 + spread * f * f, 0.26 + len * f, -0.1 * f * f)); }
        return sweepF(pts, 24, 36, fsec(R), { up: V(0, 0, 1) }).geo;
      };
      const fingers = mergeGeos([finger(-0.33, 0.56, 0.118, -0.05), finger(-0.11, 0.68, 0.124, -0.015), finger(0.11, 0.64, 0.122, 0.015), finger(0.33, 0.5, 0.112, 0.06)]);
      const thumb = sweepF([V(-0.3, -0.3, -0.04), V(-0.5, -0.12, -0.07), V(-0.66, 0.12, -0.1), V(-0.72, 0.36, -0.13)], 24, 32, fsec(0.13), { up: V(0, 0, 1) }).geo;
      const cuff = grid(56, 16, (u, v, t) => { const a = (u - 0.5) * TAU, y = lerp(-0.55, -1.42, v), r = 1 + 0.06 * v; t.set(Math.sin(a) * 0.4 * r, y, Math.cos(a) * 0.23 * r); return [u, v]; }, { outward: (u, v, p) => V(p.x, 0, p.z) });
      const strap = ringBand(0.45, 0.28, 0.36, 0.06, 64, { puff: 0.2 }); strap.translate(0, -0.82, 0);
      const tab = extrude(roundRect(-0.13, -0.17, 0.3, 0.34, 0.06), 0.04, 0.015, { segs: 2 }); tab.rotateY(PI / 2); tab.translate(0.49, -0.82, 0.05);
      const hole = new THREE.CircleGeometry(1, 28); hole.rotateX(PI / 2); hole.scale(0.42, 1, 0.25); hole.translate(0, -1.4, 0);
      return { palm, fingers, thumb, cuff, strap, tab, hole };
    });
  }
  function buildGkGloves(item, d) {
    const G = gkGloveGeo();
    const PM = ctex(item, 512, 512), FG = ctex(item, 256, 256), CU = ctex(item, 512, 256), ST = ctex(item, 1024, 192);
    const palmM = surfMat(item, { map: PM.tex, rough: 0.6, coat: 0.3, coatRough: 0.3, normal: 'grain', nx: 6, ns: 0.15 });
    const fingM = surfMat(item, { map: FG.tex, rough: 0.6, coat: 0.3, coatRough: 0.3, normal: 'grain', nx: 4, ny: 6, ns: 0.2 });
    const cuffM = fabric(item, { map: CU.tex, rough: 0.8, nx: 18, ny: 6 });
    const strapM = surfMat(item, { map: ST.tex, rough: 0.5, coat: 0.5, normal: 'grain', nx: 20, ny: 2, ns: 0.15 });
    const tabM = plastic(item, { color: '#ffffff', rough: 0.4 });
    const holeM = surfMat(item, { color: '#0e0f12', rough: 1, side: THREE.DoubleSide });
    const one = () => { const g = new THREE.Group(); for (const [geo, m] of [[G.palm, palmM], [G.fingers, fingM], [G.thumb, fingM], [G.cuff, cuffM], [G.strap, strapM], [G.tab, tabM], [G.hole, holeM]]) g.add(new THREE.Mesh(geo, m)); return g; };
    const A = one(), B = one();
    A.position.set(-0.56, 0, 0.12); A.rotation.set(0, 0.25, 0.1);
    B.scale.set(-1, 1, 1); B.rotation.set(0, PI + 0.3, -0.1); B.position.set(0.6, 0.06, -0.12);
    item.group.add(A, B);
    item.painters.push(d2 => {
      const latex = lum(d2.accent) > 0.45 ? mix(d2.accent, '#ffffff', 0.25) : '#e6e9ec';
      let c = PM.ctx, w = PM.cv.width, h = PM.cv.height;
      // u: 0.5 = back of hand (+Z); 0 / 1 = palm
      c.fillStyle = latex; c.fillRect(0, 0, w, h);
      paintPattern(c, w * 0.25, 0, w * 0.5, h, d2, { unit: w / 1.2 });
      c.fillStyle = d2.secondary; c.beginPath(); c.moveTo(w * 0.25, h * 0.75); c.lineTo(w * 0.75, h * 0.45); c.lineTo(w * 0.75, h * 0.62); c.lineTo(w * 0.25, h * 0.92); c.fill();
      c.fillStyle = d2.accent; c.fillRect(w * 0.25, h * 0.3, w * 0.5, h * 0.025);
      c.fillStyle = 'rgba(0,0,0,0.12)'; for (const x of [0.06, 0.12, 0.18, 0.82, 0.88, 0.94]) c.fillRect(w * x, h * 0.1, 2 * item.q, h * 0.8);
      c = FG.ctx; w = FG.cv.width; h = FG.cv.height;
      // finger: u 0.5 = back; latex rolls round both sides
      c.fillStyle = latex; c.fillRect(0, 0, w, h);
      c.fillStyle = d2.primary; c.fillRect(w * 0.36, 0, w * 0.28, h);
      c.fillStyle = d2.secondary; c.fillRect(w * 0.45, 0, w * 0.1, h);
      c = CU.ctx; w = CU.cv.width; h = CU.cv.height;
      c.fillStyle = shade(d2.primary, -0.2); c.fillRect(0, 0, w, h); c.fillStyle = d2.accent; c.fillRect(0, h * 0.88, w, h * 0.05);
      c = ST.ctx; w = ST.cv.width; h = ST.cv.height;
      c.fillStyle = d2.secondary; c.fillRect(0, 0, w, h);
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.06, w, h * 0.08); c.fillRect(0, h * 0.86, w, h * 0.08);
      const txt = label(d2);
      if (txt) drawText(c, txt, w * 0.5, h * 0.5, w * 0.28, h * 0.5, d2, { color: ink(d2.secondary) });
      if (d2.number) drawText(c, d2.number, w * 0.3, h * 0.5, w * 0.06, h * 0.45, d2, { color: d2.accent, outline: false });
      tabM.color.set(d2.accent);
      finish(palmM, d2, true);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.2, elev: 0.12, fit: 1.0 });
  }

  /* ---------------------------------------------------------------- */
  /* CAPTAIN ARMBAND                                                   */
  /* ---------------------------------------------------------------- */
  function buildArmband(item, d) {
    const G = C('armband', () => {
      const band = ringBand(0.6, 0.48, 0.5, 0.045, 96, { puff: 0.25 });
      const flap = grid(24, 24, (u, v, t) => {
        const a = lerp(1.05, 1.75, u), q = v * TAU;
        const ro = spow(Math.cos(q), 0.35) * 0.012 + 0.04, yy = spow(Math.sin(q), 0.25) * 0.23;
        const k = capK(u, 0, 0.12);
        t.set(Math.sin(a) * (0.6 + ro), yy * (0.6 + 0.4 * k), Math.cos(a) * (0.48 + ro));
        return [u, v];
      }, { outward: (u, v, p) => { const a = lerp(1.05, 1.75, u); return p.clone().sub(V(Math.sin(a) * 0.62, 0, Math.cos(a) * 0.5)); } });
      return { band, flap };
    });
    const T = ctex(item, 1024, 256);
    const m = fabric(item, { map: T.tex, rough: 0.75, normal: 'rib', nx: 60, ny: 2, ns: 0.35 });
    item.add(G.band, m);
    const flapM = fabric(item, { color: '#ffffff', normal: 'fuzz', nx: 4, ns: 0.5 });
    item.add(G.flap, flapM);
    item.painters.push(d2 => {
      const c = T.ctx, w = T.cv.width, h = T.cv.height;
      // canvas y spans the wall profile: outer face is the middle half
      const f = bandFace(0.5, 0.045);
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 2.5 });
      c.fillStyle = shade(d2.primary, -0.15); c.fillRect(0, 0, w, h * (0.5 - f)); c.fillRect(0, h * (0.5 + f), w, h * (0.5 - f));
      c.fillStyle = d2.secondary; c.fillRect(0, h * (0.5 - f), w, h * f * 0.2); c.fillRect(0, h * (0.5 + f * 0.8), w, h * f * 0.2);
      c.fillStyle = d2.accent; c.fillRect(0, h * (0.5 - f * 0.8), w, h * f * 0.05); c.fillRect(0, h * (0.5 + f * 0.75), w, h * f * 0.05);
      const cx = w * 0.5, cy = h * 0.5, R = h * f * 0.62;
      c.fillStyle = d2.accent; c.beginPath(); c.ellipse(cx, cy, R * 1.05, R, 0, 0, TAU); c.fill();
      c.strokeStyle = d2.secondary; c.lineWidth = R * 0.12; c.stroke();
      drawText(c, 'C', cx, cy, R * 1.3, R * 1.45, { ...d2, font: d2.font === 'script' ? 'block' : d2.font }, { color: ink(d2.accent), outline: false });
      const txt = d2.text || 'CAPTAIN';
      drawText(c, txt, cx - w * 0.16, cy, w * 0.14, h * f * 0.5, d2, { color: d2.textColor, outline: false });
      drawText(c, d2.number ? '#' + d2.number : (d2.name || 'LEAD'), cx + w * 0.16, cy, w * 0.12, h * f * 0.5, d2, { color: d2.textColor, outline: false });
      flapM.color.set(d2.secondary);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.25, tilt: 0.38, elev: 0.16, fit: 1.05 });
  }

  /* ---------------------------------------------------------------- */
  /* HEADBAND (terry) and WRISTBANDS (pair)                            */
  /* ---------------------------------------------------------------- */
  function terryPaint(c, w, h, d2, o = {}) {
    const f = o.face || 0.15;
    paintPattern(c, 0, 0, w, h, d2, { unit: w / (o.k || 3), pattern: ['solid', 'stripes', 'hoops', 'gradient', 'camo', 'halftone', 'waves', 'chevron'].includes(d2.pattern) ? d2.pattern : 'solid' });
    c.fillStyle = shade(d2.primary, -0.12); c.fillRect(0, 0, w, h * (0.5 - f)); c.fillRect(0, h * (0.5 + f), w, h * (0.5 - f));
    c.fillStyle = d2.secondary; c.fillRect(0, h * (0.5 - f * 0.86), w, h * f * 0.16); c.fillRect(0, h * (0.5 + f * 0.7), w, h * f * 0.16);
    if (o.stripe) { c.fillStyle = d2.accent; c.fillRect(0, h * (0.5 - f * 0.62), w, h * f * 0.08); c.fillRect(0, h * (0.5 + f * 0.54), w, h * f * 0.08); }
  }
  function buildHeadband(item, d) {
    const G = C('headband', () => ringBand(0.62, 0.72, 0.26, 0.08, 96, { puff: 0.35, pr: 0.6, py: 0.45 }));
    const T = ctex(item, 1024, 256);
    const m = fabric(item, { map: T.tex, rough: 0.9, normal: 'fuzz', nx: 24, ny: 3, ns: 0.8 });
    item.add(G, m);
    item.painters.push(d2 => {
      const c = T.ctx, w = T.cv.width, h = T.cv.height;
      const f = bandFace(0.26, 0.08); terryPaint(c, w, h, d2, { stripe: true, face: f });
      const txt = label(d2);
      if (txt) drawText(c, txt, w * 0.5, h * 0.5, w * 0.2, h * f * 0.9, d2, { color: d2.textColor });
      if (d2.number) for (const x of [0.25, 0.75]) drawText(c, d2.number, w * x, h * 0.5, w * 0.06, h * f * 0.85, d2, { color: d2.accent, outline: false });
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.15, tilt: 0.42, elev: 0.18, fit: 1.05 });
  }
  function buildWristbands(item, d) {
    const G = C('wristband', () => ringBand(0.34, 0.34, 0.56, 0.13, 72, { puff: 0.4, pr: 0.7, py: 0.4 }));
    const T = ctex(item, 768, 256);
    const m = fabric(item, { map: T.tex, rough: 0.9, normal: 'fuzz', nx: 18, ny: 4, ns: 0.8 });
    const A = item.add(G, m), B = item.add(G, m);
    A.position.set(-0.36, 0, -0.18); A.rotation.set(0.12, 0, 0.05);
    B.rotation.set(PI / 2 - 0.1, 0, 0.45); B.position.set(0.42, -0.06, 0.22);
    item.painters.push(d2 => {
      const c = T.ctx, w = T.cv.width, h = T.cv.height;
      const f = bandFace(0.56, 0.13); terryPaint(c, w, h, d2, { k: 2, stripe: true, face: f });
      const txt = d2.number || label(d2);
      if (txt) drawText(c, txt, w * 0.5, h * 0.5, w * 0.24, h * f * 0.95, d2, { color: d2.textColor });
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.2, elev: 0.3, fit: 1.02 });
  }

  /* ---------------------------------------------------------------- */
  /* ARM SLEEVE (compression)                                          */
  /* ---------------------------------------------------------------- */
  function buildArmSleeve(item, d) {
    const G = C('armsleeve', () => {
      const ctrl = [V(0, 1.6, 0), V(0.04, 0.8, 0.02), V(0.12, 0, 0.06), V(0.1, -0.8, 0.12), V(0.05, -1.6, 0.14)];
      const R = v => K.spline([[0, 0.36], [0.2, 0.33], [0.45, 0.25], [0.62, 0.27], [0.8, 0.22], [1, 0.18]])(v);
      const outer = sweepF(ctrl, 48, 80, (v, a) => { const r = R(v) * (1 + 0.04 * Math.sin(v * PI * 6) * 0); return [-Math.cos(a) * r * 0.95, Math.sin(a) * r]; }, { up: V(0, 0, 1) });
      const inner = sweepF(ctrl, 48, 80, (v, a) => { const r = R(v) * 0.95; return [-Math.cos(a) * r * 0.95, Math.sin(a) * r]; }, { up: V(0, 0, 1) });
      const ring = (v, s) => { const pts = []; for (let i = 0; i < 48; i++) pts.push(outer.at(v, i / 48 * TAU).lerp(outer.at(v, i / 48 * TAU + PI), 0.5 * (1 - s)).multiplyScalar(1)); return pts; };
      const top = tube(ring(0, 0.975), { closed: true, radius: 0.016, seg: 96, radial: 8 });
      const bot = tube(ring(1, 0.975), { closed: true, radius: 0.014, seg: 96, radial: 8 });
      return { outer: outer.geo, inner: inner.geo, lips: mergeGeos([top, bot]) };
    });
    const T = ctex(item, 512, 1536);
    const m = fabric(item, { map: T.tex, rough: 0.6, sheen: 0.8, normal: 'knit', nx: 18, ny: 36, ns: 0.35 });
    m.userData.base = { rough: 0.6 };
    item.add(G.outer, m);
    const innerM = surfMat(item, { color: '#333333', rough: 0.9, side: THREE.BackSide });
    item.add(G.inner, innerM);
    const lipM = fabric(item, { color: '#ffffff', nx: 30, ny: 1 });
    item.add(G.lips, lipM);
    item.painters.push(d2 => {
      const c = T.ctx, w = T.cv.width, h = T.cv.height;
      c.save(); c.translate(0, h); c.scale(1, -1); // y == v (top of arm at v = 0)
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 1.6 });
      c.fillStyle = d2.secondary; c.fillRect(0, 0, w, h * 0.05); c.fillRect(0, h * 0.965, w, h * 0.035);
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.05, w, h * 0.008);
      // side panel stripes
      c.fillStyle = d2.secondary; c.fillRect(w * 0.16, 0, w * 0.05, h); c.fillStyle = d2.accent; c.fillRect(w * 0.225, 0, w * 0.012, h);
      c.restore();
      const txt = label(d2);
      c.save(); c.translate(w * 0.5, h * 0.36); c.scale(1, -1); c.rotate(-PI / 2);
      if (txt) drawText(c, txt, 0, 0, h * 0.3, w * 0.22, d2, { color: d2.textColor });
      c.restore();
      if (d2.number) { c.save(); c.translate(w * 0.5, h * 0.84); c.scale(1, -1); drawText(c, d2.number, 0, 0, w * 0.3, h * 0.08, d2, { color: d2.textColor }); c.restore(); }
      innerM.color.set(shade(d2.primary, -0.5)); lipM.color.set(d2.secondary);
      finish(m, d2, true);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.25, roll: -0.42, elev: 0.12, fit: 0.86 });
  }

  /* ---------------------------------------------------------------- */
  /* KNEE PADS (pair): knit sleeve with a domed foam pad                */
  /* ---------------------------------------------------------------- */
  function buildKneePads(item, d) {
    const G = C('kneepad', () => {
      const Rs = y => 0.36 - 0.035 * Math.cos(y / 0.55 * PI / 2) + 0.02 * y;
      const sleeve = grid(64, 24, (u, v, t) => { const a = (u - 0.5) * TAU, y = lerp(0.55, -0.55, v), r = Rs(y); t.set(Math.sin(a) * r, y, Math.cos(a) * r * 0.92); return [u, v]; }, { outward: (u, v, p) => V(p.x, 0, p.z) });
      const inner = grid(64, 24, (u, v, t) => { const a = (u - 0.5) * TAU, y = lerp(0.55, -0.55, v), r = Rs(y) * 0.95; t.set(Math.sin(a) * r, y, Math.cos(a) * r * 0.92); return [u, v]; }, { outward: (u, v, p) => V(-p.x, 0, -p.z) });
      const pad = grid(48, 40, (u, v, t) => {
        const a = lerp(-1.25, 1.25, u), y = lerp(-0.34, 0.36, v);
        const p = a / 1.25, q = (y - 0.01) / 0.35;
        const pil = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(p), 3.5)), 0.35) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(q), 3.5)), 0.35);
        const r = Rs(y) + 0.13 * pil - 0.003;
        t.set(Math.sin(a) * r, y, Math.cos(a) * r * 0.92);
        return [u, v];
      }, { outward: (u, v, p) => V(p.x, 0, p.z) });
      const lips = mergeGeos([0.55, -0.55].map(y => { const pts = []; for (let i = 0; i < 48; i++) { const a = i / 48 * TAU, r = Rs(y) * 0.975; pts.push(V(Math.sin(a) * r, y, Math.cos(a) * r * 0.92)); } return tube(pts, { closed: true, radius: 0.02, seg: 96, radial: 8 }); }));
      return { sleeve, inner, pad, lips };
    });
    const SL = ctex(item, 768, 256), PD = ctex(item, 512, 512);
    const sleeveM = fabric(item, { map: SL.tex, rough: 0.82, normal: 'knit', nx: 24, ny: 8, ns: 0.5 });
    const padM = surfMat(item, { map: PD.tex, rough: 0.7, sheen: 0.6, normal: 'pebble', nx: 3, ns: 0.5 });
    const innerM = surfMat(item, { color: '#222222', rough: 0.95, side: THREE.BackSide });
    const lipM = fabric(item, { color: '#ffffff', nx: 30, ny: 1 });
    const one = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(G.sleeve, sleeveM), new THREE.Mesh(G.inner, innerM), new THREE.Mesh(G.pad, padM), new THREE.Mesh(G.lips, lipM)); return g; };
    const A = one(), B = one();
    A.position.set(-0.42, 0, -0.15); A.rotation.y = 0.35;
    B.position.set(0.46, -0.02, 0.2); B.rotation.y = -0.25;
    item.group.add(A, B);
    item.painters.push(d2 => {
      let c = SL.ctx, w = SL.cv.width, h = SL.cv.height;
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 2.4 });
      c.fillStyle = d2.secondary; c.fillRect(0, 0, w, h * 0.1); c.fillRect(0, h * 0.9, w, h * 0.1);
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.1, w, h * 0.015); c.fillRect(0, h * 0.885, w, h * 0.015);
      const txt = label(d2);
      if (txt) for (const x of [0.12, 0.88]) drawText(c, txt, w * x, h * 0.5, w * 0.14, h * 0.12, d2, { color: d2.textColor, outline: false });
      c = PD.ctx; w = PD.cv.width; h = PD.cv.height;
      const padCol = lum(d2.primary) > 0.5 ? shade(d2.primary, -0.1) : mix(d2.primary, '#000000', 0.25);
      c.fillStyle = padCol; c.fillRect(0, 0, w, h);
      // flex grooves (hex cells) and an accent outline seam
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 4 * item.q;
      const r = w * 0.09;
      for (let row = -1; row < 8; row++) for (let col2 = -1; col2 < 7; col2++) {
        const cx = col2 * r * 1.75 + (row & 1) * r * 0.875 + w * 0.08, cy = row * r * 1.5 + h * 0.1;
        c.beginPath(); for (let k = 0; k < 6; k++) { const an = k / 6 * TAU + PI / 6; const x = cx + Math.cos(an) * r * 0.86, y = cy + Math.sin(an) * r * 0.86; k ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); c.stroke();
      }
      c.strokeStyle = d2.accent; c.lineWidth = w * 0.025; c.strokeRect(w * 0.035, h * 0.035, w * 0.93, h * 0.93);
      if (d2.number) drawText(c, d2.number, w * 0.5, h * 0.5, w * 0.3, h * 0.3, d2, { color: d2.secondary, outline: false });
      lipM.color.set(d2.secondary);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.25, elev: 0.2, fit: 1.0 });
  }

  /* ---------------------------------------------------------------- */
  /* MINI HOOP: printed backboard, steel rim, net, door hooks           */
  /* ---------------------------------------------------------------- */
  function buildMiniHoop(item, d) {
    const RIM = 0.36, RY = -0.08, RZ = 0.5;
    const G = C('minihoop', () => {
      const board = extrude(roundRect(-0.9, -0.3, 1.8, 1.24, 0.1), 0.05, 0.02, { segs: 2 });
      const rim = new THREE.TorusGeometry(RIM, 0.022, 10, 64); rim.rotateX(PI / 2); rim.translate(0, RY, RZ + 0.05);
      const plate = new THREE.BoxGeometry(0.34, 0.2, 0.05); plate.translate(0, RY - 0.02, 0.06);
      const arms = mergeGeos([-1, 1].map(s => tube([V(s * 0.12, RY - 0.08, 0.07), V(s * 0.1, RY - 0.03, 0.12), V(s * 0.08, RY, 0.17)], { radius: 0.018, seg: 8, radial: 8 })));
      const shelf = new THREE.BoxGeometry(0.3, 0.025, 0.12); shelf.translate(0, RY, 0.12);
      // net: diamond mesh from the rim to a narrower bottom ring
      const rows = 6, cols = 16, node = (k, i) => { const y = RY - 0.012 - k * 0.11, r = RIM * lerp(0.98, 0.62, Math.pow(k / rows, 0.8)), a = (i + (k % 2) * 0.5) / cols * TAU; return V(Math.sin(a) * r, y, RZ + 0.05 + Math.cos(a) * r); };
      const segs = [];
      const seg = (p, q) => { const L = p.distanceTo(q); const g = new THREE.CylinderGeometry(0.007, 0.007, L, 5, 1, true); g.translate(0, L / 2, 0); return placeGeo(g, p.clone(), q.clone().sub(p)); };
      for (let k = 0; k < rows; k++) for (let i = 0; i < cols; i++) {
        const p = node(k, i);
        segs.push(seg(p, node(k + 1, k % 2 ? i + 1 : i)), seg(p, node(k + 1, k % 2 ? i : i - 1)));
      }
      const loops = []; for (let i = 0; i < cols; i++) { const p = node(0, i); const t = new THREE.TorusGeometry(0.02, 0.006, 5, 10); t.rotateY((i / cols) * TAU); t.translate(p.x, RY, p.z); loops.push(t); }
      const hooks = mergeGeos([-1, 1].map(s => tube([V(s * 0.55, 0.88, -0.05), V(s * 0.55, 1.04, -0.05), V(s * 0.55, 1.08, -0.16), V(s * 0.55, 1.0, -0.28), V(s * 0.55, 0.86, -0.29)], { radius: 0.022, seg: 30, radial: 8, flat: 0.5 })));
      const pads = mergeGeos([-1, 1].map(s => { const b = new THREE.BoxGeometry(0.16, 0.16, 0.04); b.translate(s * 0.55, 0.78, -0.07); return b; }));
      return { board, rim, plate: mergeGeos([plate, shelf]), arms, net: mergeGeos([...segs, ...loops]), hooks, pads };
    });
    const B = ctex(item, 768, 528);
    const boardM = plastic(item, { map: B.tex, rough: 0.2, coat: 1, coatRough: 0.04 });
    item.add(G.board, boardM);
    const rimM = surfMat(item, { color: '#ff5a1f', rough: 0.3, coat: 1, metal: 0.4 });
    item.add(G.rim, rimM); item.add(G.arms, rimM); item.add(G.plate, rimM);
    const netM = fabric(item, { color: '#ffffff', normal: 'rib', nx: 1, ny: 6, ns: 0.3, side: THREE.DoubleSide });
    item.add(G.net, netM);
    item.add(G.hooks, metal(item, { color: '#bfc4cc', rough: 0.3 }));
    item.add(G.pads, rubber(item, { color: '#1a1b1f' }));
    item.painters.push(d2 => {
      const c = B.ctx, w = B.cv.width, h = B.cv.height;
      // uv spans the bounding box incl. bevel: board face is the inner area
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 2.4 });
      const m = w * 0.045;
      c.strokeStyle = d2.secondary; c.lineWidth = w * 0.035; c.strokeRect(m, m, w - 2 * m, h - 2 * m);
      // shooter square above the rim
      const sx = w * 0.5, sy = h * 0.66;
      c.strokeStyle = d2.accent; c.lineWidth = w * 0.02; c.strokeRect(sx - w * 0.14, sy - h * 0.2, w * 0.28, h * 0.24);
      const txt = label(d2);
      if (txt) drawText(c, txt, w * 0.5, h * 0.2, w * 0.6, h * 0.18, d2, { color: d2.textColor });
      if (d2.number) for (const x of [0.17, 0.83]) drawText(c, d2.number, w * x, h * 0.62, w * 0.14, h * 0.2, d2, { color: d2.accent, outline: false });
      const sat = new THREE.Color(d2.accent).getHSL({}).s;
      rimM.color.set(sat > 0.5 && lum(d2.accent) > 0.08 ? d2.accent : '#ff5a1f');
      finish(boardM, d2, true);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.45, elev: 0.2, fit: 0.98 });
  }

  /* ---------------------------------------------------------------- */
  /* BACKPACK: padded body, front pocket, zips, straps, mesh pocket    */
  /* ---------------------------------------------------------------- */
  // point on a rounded rectangle (half sizes a, b, corner r), t in [0,1] by arc length, starting front centre (+Z) toward +X
  function rrPoint(t, a, b, r, out) {
    const sa = a - r, sb = b - r, q = PI * r / 2, L = 4 * sa + 4 * sb + 4 * q;
    let s = ((t % 1) + 1) % 1 * L;
    const segs = [[sa, (k) => [k, b]], [q, (k) => { const an = k / r; return [sa + Math.sin(an) * r, sb + Math.cos(an) * r]; }], [2 * sb, (k) => [a, sb - k]],
      [q, (k) => { const an = k / r; return [sa + Math.cos(an) * r, -sb - Math.sin(an) * r]; }], [2 * sa, (k) => [sa - k, -b]],
      [q, (k) => { const an = k / r; return [-sa - Math.sin(an) * r, -sb - Math.cos(an) * r]; }], [2 * sb, (k) => [-a, -sb + k]],
      [q, (k) => { const an = k / r; return [-sa - Math.cos(an) * r, sb + Math.sin(an) * r]; }], [sa, (k) => [-sa + k, b]]];
    for (const [len, f] of segs) { if (s <= len + 1e-9) { const [x, z] = f(s); return out.set(x, 0, z); } s -= len; }
    return out.set(0, 0, b);
  }
  // rounded box lofted along a profile [[scale, y], ...]
  function roundBox(a, b, r, prof, nu, nv, c0 = V()) {
    const ps = K.spline(prof.map((p, i) => [i, p[0]])), py = K.spline(prof.map((p, i) => [i, p[1]]));
    const at = (u, v, t) => { const k = v * (prof.length - 1), sc = Math.max(0.0001, ps(k)); rrPoint(u - 0.5, a, b, r, t); return t.set(t.x * sc + c0.x, py(k) + c0.y, t.z * sc + c0.z); };
    const geo = grid(nu, nv, (u, v, t) => { at(u, v, t); return [u, v]; }, { outward: (u, v, p) => V(p.x - c0.x, (p.y - c0.y) * 0.3, p.z - c0.z) });
    return { geo, at };
  }
  function buildBackpack(item, d) {
    const PC = V(0, -0.3, 0.22);
    const G = C('backpack', () => {
      const M = roundBox(0.5, 0.24, 0.13, [[0, -0.69], [0.85, -0.68], [0.97, -0.64], [1, -0.55], [1, 0.25], [0.98, 0.4], [0.9, 0.53], [0.72, 0.63], [0.42, 0.685], [0.0, 0.7]], 96, 56);
      const Pk = roundBox(0.38, 0.1, 0.08, [[0, -0.3], [0.9, -0.295], [1, -0.25], [1, 0.2], [0.94, 0.27], [0.75, 0.31], [0, 0.32]], 64, 28, PC);
      const zp = []; for (let i = 0; i <= 60; i++) { const t = V(); const f = i / 60; if (f < 0.5) M.at(0.25, lerp(0.38, 1, f * 2), t); else M.at(0.75, lerp(1, 0.38, f * 2 - 1), t); zp.push(t.multiplyScalar(1.006)); }
      const zip = tube(zp, { radius: 0.022, flat: 0.5, seg: 200, radial: 8 });
      const pz = []; for (let i = 0; i <= 30; i++) { const t = V(); Pk.at(lerp(0.3, 0.7, i / 30), 0.78, t); pz.push(t.sub(PC).multiplyScalar(1.02).add(PC)); }
      const pzip = tube(pz, { radius: 0.018, flat: 0.5, seg: 60, radial: 8 });
      const zt = V(); Pk.at(0.62, 0.76, zt);
      const pull = capsuleGeo(0.15, 0.022, 4, 8, 0.5); pull.rotateZ(PI / 2); pull.translate(zt.x, zt.y - 0.06, zt.z + 0.035);
      const mt = V(); M.at(0.25, 0.83, mt);
      const pull2 = capsuleGeo(0.15, 0.022, 4, 8, 0.5); pull2.rotateZ(PI / 2); pull2.translate(mt.x + 0.03, mt.y - 0.07, mt.z);
      const handle = tube([V(-0.12, 0.66, -0.06), V(-0.1, 0.8, -0.08), V(0.1, 0.8, -0.08), V(0.12, 0.66, -0.06)], { radius: 0.028, flat: 0.5, seg: 30, radial: 8 });
      const strap = s => sweepF([V(s * 0.16, 0.6, -0.2), V(s * 0.22, 0.42, -0.36), V(s * 0.3, 0.0, -0.4), V(s * 0.36, -0.42, -0.34), V(s * 0.38, -0.62, -0.22)], 12, 48, (v, a) => [spow(Math.cos(a), 0.4) * 0.035, spow(Math.sin(a), 0.4) * lerp(0.1, 0.06, v)], { up: V(0, 0, -1) }).geo;
      const straps = mergeGeos([strap(-1), strap(1)]);
      const mesh = grid(24, 12, (u, v, t) => { M.at(lerp(0.19, 0.31, u), lerp(0.12, 0.42, v), t); const n = V(t.x, 0, t.z).normalize(); t.addScaledVector(n, 0.012 + 0.05 * Math.sin(v * PI) * Math.sin(u * PI)); return [u, v]; }, { outward: (u, v, p) => V(p.x, 0, p.z) });
      return { main: M.geo, pocket: Pk.geo, zip, pzip, pulls: mergeGeos([pull, pull2]), handle, straps, mesh };
    });
    const MB = ctex(item, 1024, 768), PT = ctex(item, 512, 384);
    const bodyM = fabric(item, { map: MB.tex, rough: 0.7, sheen: 0.5, normal: 'knit', nx: 40, ny: 30, ns: 0.3 });
    bodyM.userData.base = { rough: 0.7, coat: 0.1 };
    const pocketM = fabric(item, { map: PT.tex, rough: 0.7, sheen: 0.5, normal: 'knit', nx: 20, ny: 16, ns: 0.3 });
    pocketM.userData.base = { rough: 0.7, coat: 0.1 };
    item.add(G.main, bodyM); item.add(G.pocket, pocketM);
    const zipM = surfMat(item, { color: '#15161a', rough: 0.45, normal: 'knurl', nx: 1, ny: 80, ns: 0.8 });
    item.add(G.zip, zipM); item.add(G.pzip, zipM);
    const pullM = plastic(item, { color: '#ffffff', rough: 0.4 });
    item.add(G.pulls, pullM);
    const webM = fabric(item, { color: '#222222', normal: 'rib', nx: 2, ny: 30, ns: 0.5 });
    item.add(G.handle, webM); item.add(G.straps, webM);
    const meshM = fabric(item, { color: '#222222', normal: 'knit', nx: 30, ny: 12, ns: 1, side: THREE.DoubleSide });
    item.add(G.mesh, meshM);
    item.painters.push(d2 => {
      let c = MB.ctx, w = MB.cv.width, h = MB.cv.height;
      paintPattern(c, 0, 0, w, h, d2, { unit: w / 3 });
      c.fillStyle = d2.secondary; c.fillRect(0, h * 0.82, w, h * 0.18); // base panel
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.815, w, h * 0.01);
      const txt = label(d2);
      if (txt) drawText(c, txt, w * 0.5, h * 0.42, w * 0.22, h * 0.08, d2, { color: d2.textColor });
      c = PT.ctx; w = PT.cv.width; h = PT.cv.height;
      c.fillStyle = d2.secondary; c.fillRect(0, 0, w, h);
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.2, w, h * 0.03);
      if (d2.number || d2.name) drawText(c, d2.number || d2.name, w * 0.5, h * 0.52, w * 0.3, h * 0.24, d2, { color: ink(d2.secondary) });
      webM.color.set(shade(d2.secondary, -0.25)); meshM.color.set(shade(d2.secondary, -0.15)); pullM.color.set(d2.accent);
      finish(bodyM, d2, true); finish(pocketM, d2, true);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.45, elev: 0.16, fit: 1.0 });
  }

  /* ---------------------------------------------------------------- */
  /* TENNIS RACKET: oval head frame, open throat, strung bed, grip     */
  /* ---------------------------------------------------------------- */
  function buildRacket(item, d) {
    const HX = 0.5, HY = 0.64, HC = 0.95;
    const G = C('racket', () => {
      const loop = []; for (let i = 0; i < 64; i++) { const a = i / 64 * TAU; loop.push(V(Math.sin(a) * HX, HC + Math.cos(a) * HY, 0)); }
      const head = sweepF(loop, 16, 160, (v, a) => se(a, 0.05, 0.034, 0.45), { closed: true, up: V(0, 0, 1) });
      const arm = s => sweepF([V(s * Math.sin(2.55) * HX, HC + Math.cos(2.55) * HY, 0), V(s * 0.18, 0.12, 0), V(s * 0.05, -0.08, 0), V(0, -0.2, 0)], 14, 30, (v, a) => se(a, 0.046, 0.03, 0.45), { up: V(0, 0, 1) }).geo;
      const handle = grid(8, 20, (u, v, t) => {
        const a = u * TAU + PI / 8, y = lerp(-0.18, -1.05, v), k = v > 0.96 ? 1.12 : 1 + 0.06 * smooth(0.05, 0.25, v);
        const r = 0.062 * k / Math.cos(PI / 8);
        t.set(Math.sin(a) * r * 0.92, y, Math.cos(a) * r * 0.78);
        return [u, v];
      }, { outward: (u, v, p) => V(p.x, 0, p.z), weld: false });
      const cap = new THREE.CylinderGeometry(0.068, 0.07, 0.04, 8); cap.rotateY(PI / 8); cap.scale(0.92 * 1.08, 1, 0.78 * 1.08); cap.translate(0, -1.07, 0);
      const bed = new THREE.CircleGeometry(1, 64); bed.scale(HX - 0.03, HY - 0.03, 1); bed.translate(0, HC, 0);
      { const p = bed.attributes.position, uv = bed.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) / (HX - 0.03) + 1) / 2, ((p.getY(i) - HC) / (HY - 0.03) + 1) / 2); }
      return { head: head.geo, arms: mergeGeos([arm(-1), arm(1)]), handle, cap, bed };
    });
    const HD = ctex(item, 128, 1536);
    const frameM = plastic(item, { map: HD.tex, rough: 0.28, coat: 1, coatRough: 0.06 });
    item.add(G.head, frameM);
    const armM = plastic(item, { color: '#ffffff', rough: 0.28 });
    item.add(G.arms, armM);
    const GR = ctex(item, 256, 512);
    const gripM = rubber(item, { map: GR.tex, rough: 0.7, normal: 'fuzz', nx: 2, ny: 8, ns: 0.3 });
    item.add(G.handle, gripM);
    const capM = plastic(item, { color: '#111111', rough: 0.35 });
    item.add(G.cap, capM);
    const ST = ctex(item, 512, 512);
    const strM = surfMat(item, { map: ST.tex, rough: 0.5, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    item.add(G.bed, strM);
    item.painters.push(d2 => {
      let c = HD.ctx, w = HD.cv.width, h = HD.cv.height;
      paintPattern(c, 0, 0, w, h, d2, { unit: w * 2, pattern: ['solid', 'gradient', 'camo', 'stripes', 'split', 'halftone'].includes(d2.pattern) ? d2.pattern : 'solid' });
      // top of the head (v ~ 0 / 1) in secondary, accent ticks at 3 and 9
      c.fillStyle = d2.secondary; c.fillRect(0, 0, w, h * 0.08); c.fillRect(0, h * 0.92, w, h * 0.08);
      c.fillStyle = d2.accent; c.fillRect(0, h * 0.24, w, h * 0.012); c.fillRect(0, h * 0.76, w, h * 0.012);
      const txt = label(d2);
      for (const [y, r] of [[0.4, PI / 2], [0.6, -PI / 2]]) { c.save(); c.translate(w * 0.5, h * y); c.rotate(r); if (txt) drawText(c, txt, 0, 0, h * 0.11, w * 0.5, d2, { color: d2.textColor, outline: false }); c.restore(); }
      c = GR.ctx; tapeWrap(c, GR.cv.width, GR.cv.height, lum(d2.secondary) > 0.6 ? d2.secondary : '#f2f3f5', 10, { stripe: d2.accent });
      c = ST.ctx; w = ST.cv.width; h = ST.cv.height;
      c.clearRect(0, 0, w, h);
      const sc = lum(d2.accent) > 0.25 ? d2.accent : '#f1f2ee', lw = Math.max(2, 4 * item.q);
      c.fillStyle = sc;
      for (let i = 1; i < 16; i++) c.fillRect(i / 16 * w - lw / 2, 0, lw, h);
      for (let i = 1; i < 19; i++) c.fillRect(0, i / 19 * h - lw / 2, w, lw);
      // stencil mark painted onto the strings
      c.save(); c.globalCompositeOperation = 'source-atop';
      const st = (d2.text || d2.name || 'S').slice(0, 1);
      drawText(c, st, w / 2, h / 2, w * 0.5, h * 0.5, d2, { color: d2.primary, outline: false });
      c.restore();
      armM.color.set(d2.primary); capM.color.set(d2.secondary);
      finish(frameM, d2, false); finish(armM, d2, false);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.45, roll: -0.3, elev: 0.12, fit: 0.72 });
  }

  /* ---------------------------------------------------------------- */
  /* registry                                                          */
  /* ---------------------------------------------------------------- */
  const builders = {
    'hockey-stick': buildStick,
    'hockey-helmet': buildHockeyHelmet,
    'hockey-gloves': buildHockeyGloves,
    'hockey-skates': buildSkates,
    'football-helmet': buildFootballHelmet,
    'shoulder-pads': buildShoulderPads,
    'batting-helmet': buildBattingHelmet,
    'baseball-bat': buildBat,
    'baseball-mitt': buildMitt,
    'goalkeeper-gloves': buildGkGloves,
    'captain-armband': buildArmband,
    'arm-sleeve': buildArmSleeve,
    headband: buildHeadband,
    'mini-hoop': buildMiniHoop,
    'knee-pads': buildKneePads,
    wristbands: buildWristbands,
    backpack: buildBackpack,
    'tennis-racket': buildRacket,
  };
  const defaults = {
    'hockey-stick': ['#04282e', '#c8f53c', '#2ee6d6'],
    'hockey-helmet': ['#3fb8ff', '#04282e', '#ffffff'],
    'hockey-gloves': ['#ff5a47', '#04282e', '#ffffff'],
    'hockey-skates': ['#04282e', '#2ee6d6', '#c8f53c'],
    'football-helmet': ['#ff5a47', '#04282e', '#ffffff'],
    'shoulder-pads': ['#04282e', '#c8f53c', '#ffffff'],
    'batting-helmet': ['#04282e', '#ffa02e', '#ffffff'],
    'baseball-bat': ['#3fb8ff', '#04282e', '#c8f53c'],
    'baseball-mitt': ['#b5652b', '#3a1f10', '#f4e3c3'],
    'goalkeeper-gloves': ['#c8f53c', '#04282e', '#ffffff'],
    'captain-armband': ['#ff5a47', '#04282e', '#c8f53c'],
    'arm-sleeve': ['#04282e', '#2ee6d6', '#c8f53c'],
    headband: ['#2ee6d6', '#04282e', '#ffffff'],
    'mini-hoop': ['#04282e', '#ffffff', '#ffa02e'],
    'knee-pads': ['#04282e', '#ff5a47', '#c8f53c'],
    wristbands: ['#c8f53c', '#04282e', '#ffffff'],
    backpack: ['#3fb8ff', '#04282e', '#c8f53c'],
    'tennis-racket': ['#ffa02e', '#04282e', '#c8f53c'],
  };
  const meta = {
    'hockey-stick': { label: 'Hockey stick', sport: 'Hockey', category: 'Equipment', size: 'one' },
    'hockey-helmet': { label: 'Hockey helmet', sport: 'Hockey', category: 'Protection', size: 'one' },
    'hockey-gloves': { label: 'Hockey gloves', sport: 'Hockey', category: 'Protection', size: 'one' },
    'hockey-skates': { label: 'Hockey skates', sport: 'Hockey', category: 'Footwear', size: 'shoe' },
    'football-helmet': { label: 'Football helmet', sport: 'Football', category: 'Protection', size: 'one' },
    'shoulder-pads': { label: 'Shoulder pads', sport: 'Football', category: 'Protection', size: 'apparel' },
    'batting-helmet': { label: 'Batting helmet', sport: 'Baseball', category: 'Protection', size: 'one' },
    'baseball-bat': { label: 'Baseball bat', sport: 'Baseball', category: 'Equipment', size: 'one' },
    'baseball-mitt': { label: 'Baseball mitt', sport: 'Baseball', category: 'Gloves', size: 'one' },
    'goalkeeper-gloves': { label: 'Goalkeeper gloves', sport: 'Soccer', category: 'Gloves', size: 'one' },
    'captain-armband': { label: 'Captain armband', sport: 'Soccer', category: 'Equipment', size: 'one' },
    'arm-sleeve': { label: 'Arm sleeve', sport: 'Basketball', category: 'Protection', size: 'apparel' },
    headband: { label: 'Headband', sport: 'Basketball', category: 'Equipment', size: 'one' },
    'mini-hoop': { label: 'Mini hoop', sport: 'Basketball', category: 'Equipment', size: 'one' },
    'knee-pads': { label: 'Knee pads', sport: 'Volleyball', category: 'Protection', size: 'apparel' },
    wristbands: { label: 'Wristbands', sport: 'Training', category: 'Equipment', size: 'one' },
    backpack: { label: 'Backpack', sport: 'Training', category: 'Bags', size: 'one' },
    'tennis-racket': { label: 'Tennis racket', sport: 'Training', category: 'Equipment', size: 'one' },
  };
  return { shapes: Object.keys(builders), builders, defaults, meta };
}
