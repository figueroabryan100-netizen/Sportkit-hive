// SquadForge gear module: ice hockey skates. Original procedural model, no real brand marks.
// Loaded by gear3d.js through GEAR_MODULES: default export (K) => ({ shapes, builders, defaults, meta }).
//
// Model space is centimetres: x runs heel -> toe (toe at +x), y is up (ice at y = 0), z is the lateral side (+z).
// The boot shell is a loft of "stations": each station is a segment in the side view from a back/sole point B
// to a front/instep point F, swept across z into a rounded D-shaped section. Stations rotate from horizontal
// (ankle shaft) through diagonal (heel) to vertical (foot), so heel and instep stay smooth without pinches.
// Two virtual stations above the collar carry the tongue (front) and the tendon guard (back).

export default function skates(K) {
  const { THREE, TAU, PI, V, lerp, clamp, smooth, spow, grid, tube, mergeGeos, placeGeo, cached, paintPattern, drawText, lum, shade, mix, applySurfaceFinish, weldNormals } = K;

  /* ---------------------------------------------------------------- */
  /* helpers (material helpers mirror equipment.js)                    */
  /* ---------------------------------------------------------------- */
  const C = (k, fn) => cached('skates:' + k, fn);
  const col = c => new THREE.Color(c);
  const N2 = (a, b = a) => new THREE.Vector2(a, b);
  const label = d => d.text || d.name || d.chest || '';
  function surfMat(item, o = {}) {
    const base = { rough: o.rough != null ? o.rough : 0.32, coat: o.coat || 0, coatRough: o.coatRough != null ? o.coatRough : 0.08, metal: o.metal || 0 };
    const p = { color: col(o.color || '#ffffff'), roughness: base.rough, metalness: base.metal, clearcoat: base.coat, clearcoatRoughness: base.coatRough, side: o.side || THREE.FrontSide };
    if (o.map) p.map = o.map;
    if (o.normal) { p.normalMap = item.ntex(o.normal, o.nx || 4, o.ny || o.nx || 4); p.normalScale = N2(o.ns != null ? o.ns : 0.3); }
    if (o.sheen) { p.sheen = o.sheen; p.sheenRoughness = 0.5; p.sheenColor = col(o.sheenColor || '#5a5a5a'); }
    const m = item.mat(p); m.userData.base = base; return m;
  }
  const plastic = (item, o = {}) => surfMat(item, { rough: 0.3, coat: 1, coatRough: 0.06, ...o });
  const metal = (item, o = {}) => surfMat(item, { color: '#d6dae0', rough: 0.2, metal: 1, ...o });
  const fabric = (item, o = {}) => surfMat(item, { rough: 0.86, sheen: 1, normal: 'knit', nx: 20, ny: 10, ns: 0.45, ...o });
  function ctex(item, w, h) { const cv = item.canvas(w, h); return { cv, tex: item.tex(cv), ctx: cv.getContext('2d') }; }
  const finish = (m, d, lim) => applySurfaceFinish(m, lim && d.finish === 'metallic' ? 'gloss' : d.finish);
  const capK = (v, f0, f1) => {
    let k = 1;
    if (f1 && v > 1 - f1) { const s = (v - (1 - f1)) / f1; k = Math.sqrt(Math.max(0, 1 - s * s)); }
    if (f0 && v < f0) { const s = 1 - v / f0; k = Math.min(k, Math.sqrt(Math.max(0, 1 - s * s))); }
    return k;
  };
  function extrude(shape, depth, bevel, o = {}) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: o.bt || bevel, bevelSize: bevel, bevelSegments: o.segs || 3, curveSegments: o.curve || 16 });
    g.translate(0, 0, -depth / 2);
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* boot stations                                                     */
  /* [Bx, By, Fx, Fy, Wb, Wf, eB, eF, q]                                */
  /*  B/F: back-or-sole / front-or-instep ends of the station (side view)*/
  /*  Wb/Wf: half widths near the B and F ends; eB/eF: end roundness     */
  /*  (1 round .. 0.3 flat); q: squareness of the side walls             */
  /* ---------------------------------------------------------------- */
  const ST = [
    [-2.3, 32.0, 16.0, 32.6, 6.0, 5.6, 0.9, 0.85, 0.8], // 0 virtual: tendon guard tip / tongue top
    [-0.7, 29.4, 14.7, 28.6, 4.8, 4.8, 0.9, 0.82, 0.78], // 1 virtual
    [0.7, 26.0, 13.4, 24.5, 4.0, 4.15, 0.9, 0.78, 0.72], // 2 collar
    [1.15, 21.6, 13.15, 20.9, 3.65, 3.95, 0.9, 0.76, 0.68],
    [0.95, 17.4, 13.6, 17.7, 3.45, 4.0, 0.88, 0.76, 0.64],
    [-0.45, 13.0, 15.0, 15.7, 3.55, 4.1, 0.84, 0.76, 0.6],
    [-0.4, 10.0, 17.0, 14.45, 3.6, 4.2, 0.7, 0.76, 0.58],
    [1.7, 7.8, 19.0, 13.75, 3.6, 4.3, 0.42, 0.76, 0.56],
    [6.0, 7.45, 20.8, 13.3, 3.8, 4.45, 0.34, 0.76, 0.55],
    [11.0, 7.2, 22.3, 12.95, 4.2, 4.6, 0.34, 0.74, 0.55],
    [16.0, 7.0, 23.7, 12.65, 4.6, 4.7, 0.34, 0.72, 0.55],
    [20.5, 6.85, 25.1, 12.35, 4.8, 4.7, 0.36, 0.7, 0.56],
    [24.4, 6.85, 26.75, 11.9, 4.6, 4.4, 0.42, 0.7, 0.6],
    [27.1, 7.15, 28.35, 11.1, 3.95, 3.7, 0.52, 0.72, 0.66],
  ];
  const TIP = [29.85, 9.25];
  const LAST = ST.length - 1, SMAX = ST.length, COL = 2;
  // the last segment closes the toe: B and F run on Hermite curves into TIP (arriving vertically, so the
  // toe is round in side view) while the width falls off as (1 - t^2); tangents match the spline at LAST
  const getS = i => (i < 0 ? ST[0].map((v, k) => 2 * v - ST[1][k]) : i > LAST ? ST[LAST].map((v, k) => 2 * v - ST[LAST - 1][k]) : ST[i]);
  function station(s, out = new Array(9)) {
    s = clamp(s, 0, SMAX);
    if (s >= LAST) {
      const t = s - LAST, t2 = t * t, t3 = t2 * t, S = ST[LAST], Q = ST[LAST - 1];
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      const L = Math.hypot(S[2] - S[0], S[3] - S[1]) * 0.75;
      out[0] = h00 * S[0] + h10 * (S[0] - Q[0]) + h01 * TIP[0];
      out[1] = h00 * S[1] + h10 * (S[1] - Q[1]) + h01 * TIP[1] + h11 * L;
      out[2] = h00 * S[2] + h10 * (S[2] - Q[2]) + h01 * TIP[0];
      out[3] = h00 * S[3] + h10 * (S[3] - Q[3]) + h01 * TIP[1] - h11 * L;
      out[4] = S[4] * (1 + (S[4] - Q[4]) / S[4] * t) * (1 - t2);
      out[5] = S[5] * (1 + (S[5] - Q[5]) / S[5] * t) * (1 - t2);
      out[6] = S[6]; out[7] = S[7]; out[8] = S[8];
      return out;
    }
    const i = Math.floor(s), t = s - i, t2 = t * t, t3 = t2 * t;
    const p0 = getS(i - 1), p1 = getS(i), p2 = getS(i + 1), p3 = getS(i + 2);
    for (let k = 0; k < 9; k++) out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    return out;
  }
  // a: 0 = B end (sole / back), PI/2 = lateral (+z), PI = F end (instep / front), 3PI/2 = medial
  const tOf = (st, c) => 0.5 - 0.5 * spow(c, c > 0 ? st[6] : st[7]);
  function zOf(st, a) { const t = tOf(st, Math.cos(a)); return lerp(st[4], st[5], smooth(0, 1, t)) * spow(Math.sin(a), st[8]); }
  function sp(st, a, out) {
    const t = tOf(st, Math.cos(a));
    return out.set(lerp(st[0], st[2], t), lerp(st[1], st[3], t), zOf(st, a));
  }
  const _st = new Array(9);
  const P = (s, a, out = V()) => sp(station(s, _st), a, out);
  const centre = s => { const st = station(s, _st); return V((st[0] + st[2]) / 2, (st[1] + st[3]) / 2, 0); };
  // outward surface normal (numeric)
  const _a = V(), _b = V(), _c = V(), _d = V();
  function nrm(s, a, out = V()) {
    const h = 2e-3, sc = clamp(s, h, SMAX - 0.03);
    P(sc + h, a, _a).sub(P(sc - h, a, _b));
    P(sc, a + h, _c).sub(P(sc, a - h, _d));
    out.crossVectors(_a, _c).normalize();
    if (out.dot(P(sc, a, _b).sub(centre(sc))) < 0) out.negate();
    return out;
  }
  // angle on the front (or back) half where the section reaches |z|
  function aOfZ(s, z, back) {
    const st = station(s), az = Math.abs(z);
    let lo = back ? 0 : PI / 2, hi = back ? PI / 2 : PI;
    for (let i = 0; i < 36; i++) { const m = (lo + hi) / 2, zm = zOf(st, m); if (back ? zm < az : zm > az) lo = m; else hi = m; }
    const a = (lo + hi) / 2;
    return z < 0 ? TAU - a : a;
  }
  // n + 1 angles over [0, PI], spaced evenly by arc length (keeps the side walls well sampled)
  function aRow(st, n) {
    const N = 192, L = new Float64Array(N + 1), p = V(), q = V();
    sp(st, 0, q);
    for (let i = 1; i <= N; i++) { sp(st, i / N * PI, p); L[i] = L[i - 1] + p.distanceTo(q); q.copy(p); }
    const tot = L[N], out = [];
    for (let j = 0; j <= n; j++) {
      if (tot < 1e-5) { out.push(j / n * PI); continue; }
      const tg = tot * j / n; let i = 1; while (i < N && L[i] < tg) i++;
      const f = (tg - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]);
      out.push(lerp((i - 1 + f) / N * PI, j / n * PI, 0.12));
    }
    return out;
  }

  // side-projected texture space for the shell: lateral half u 0..0.5 (toe right), medial half 0.5..1 (toe left)
  const SX0 = -3.5, SX1 = 31, SY0 = 5.5, SY1 = 27.5;
  const uvSide = (p, side) => [side > 0 ? 0.5 * (p.x - SX0) / (SX1 - SX0) : 0.5 + 0.5 * (SX1 - p.x) / (SX1 - SX0), (p.y - SY0) / (SY1 - SY0)];

  /* ---------------------------------------------------------------- */
  /* layout constants                                                  */
  /* ---------------------------------------------------------------- */
  const ZG = 1.55, FW = 1.45;
  const sTop = a => COL + 0.42 * Math.pow(Math.sin(a), 2); // quarter top edge dips over the ankle // lace gap half width, eyelet facing width
  const S_FACE1 = 10.95, S_EYE1 = 10.15; // facings / laces end here (toe box)
  const capS = a => 10.62 + 0.28 * Math.pow(Math.cos(a), 2); // toe cap edge
  const TONGUE = [0.12, 10.95];
  const tongueHalf = s => lerp(lerp(3.7, 3.35, smooth(0.3, 2.2, s)), 2.55, smooth(2.2, 9, s)) + ZG * 0;
  const tongueThick = s => lerp(lerp(0.75, 0.5, smooth(0.4, 2.6, s)), 0.07, smooth(4, 10.9, s));
  const tongueBase = s => lerp(0.3, 0.02, smooth(5, 10.9, s));
  const tongueDive = s => 0.62 * smooth(1.5, 2.6, s);
  // tongue top surface height above the shell at (s, z)
  function tongueTop(s, z) {
    const zh = tongueHalf(s), w = clamp(z / zh, -1, 1), v = (s - TONGUE[0]) / (TONGUE[1] - TONGUE[0]);
    const k = capK(v, 0.06, 0.03);
    return tongueBase(s) - tongueDive(s) * Math.pow(w, 4) + tongueThick(s) * Math.pow(k, 0.6) * spow(Math.sqrt(Math.max(0, 1 - w * w)), 0.6);
  }
  const FACE_T = 0.15;
  const faceDc = (f, s = 5) => lerp(0.62, -0.1, Math.pow(f, 0.8)) * lerp(1, 0.15, smooth(9.9, 10.9, s)); // f: 0 at the gap edge, 1 at the outer edge
  function eyeletRows(n) {
    // even spacing along the instep line between the collar and the toe box
    const N = 200, L = [0]; let q = P(COL + 0.3, PI), p = V();
    for (let i = 1; i <= N; i++) { P(lerp(COL + 0.3, S_EYE1, i / N), PI, p); L.push(L[i - 1] + p.distanceTo(q)); q = p.clone(); }
    const rows = [];
    for (let j = 0; j < n; j++) { const tg = L[N] * j / (n - 1); let i = 1; while (i < N && L[i] < tg) i++; rows.push(lerp(COL + 0.3, S_EYE1, (i - 1 + (tg - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1])) / N)); }
    return rows;
  }

  /* ---------------------------------------------------------------- */
  /* geometry                                                          */
  /* ---------------------------------------------------------------- */
  function shellHalf(nu, nv, s0, s1, side, off) {
    const rows = [];
    for (let j = 0; j <= nv; j++) { const s = lerp(s0, s1, j / nv), st = station(s); rows.push({ s, st, as: aRow(st, nu), c: V((st[0] + st[2]) / 2, (st[1] + st[3]) / 2, 0) }); }
    return grid(nu, nv, (u, v, t) => {
      const R = rows[Math.round(v * nv)], a0 = R.as[Math.round(u * nu)], a = side > 0 ? a0 : TAU - a0;
      const s = s0 === COL ? lerp(sTop(a), s1, v) : R.s;
      sp(s === R.s ? R.st : station(s), a, t);
      const uv = uvSide(t, side);
      if (off) t.addScaledVector(nrm(s, a), off);
      return uv;
    }, { outward: (u, v, p) => { const d = p.clone().sub(rows[Math.round(v * nv)].c); return off < 0 ? d.negate() : d; } });
  }
  // surface displaced along its own (welded) vertex normals: map(u, v) -> [s, a], dist(u, v)
  function displaced(nu, nv, map, dist, uvf) {
    const g = grid(nu, nv, (u, v, t) => { const [s, a] = map(u, v); P(s, a, t); return uvf ? uvf(u, v) : [u, v]; },
      { outward: (u, v, p) => { const [s] = map(u, v); return p.clone().sub(centre(s)); } });
    const p = g.attributes.position, n = g.attributes.normal;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const k = j * (nu + 1) + i, d = dist(i / nu, j / nv);
      p.setXYZ(k, p.getX(k) + n.getX(k) * d, p.getY(k) + n.getY(k) * d, p.getZ(k) + n.getZ(k) * d);
    }
    g.computeVertexNormals(); weldNormals(g);
    return g;
  }
  // closed padded strip lying on the shell: base(v, w) -> [s, a] (w across -1..1), prof(v, w) -> [centre offset, half thickness]
  function pillow(nu, nv, base, prof, uvf) {
    const n = V();
    return grid(nu, nv, (u, v, t) => {
      const ph = u * TAU, w = Math.cos(ph), sd = Math.sin(ph);
      const [s, a] = base(v, w), [dc, th] = prof(v, w);
      P(s, a, t).addScaledVector(nrm(s, a, n), dc + th * spow(sd, 0.55));
      return uvf ? uvf(u, v) : [u, 1 - v];
    }, { outward: (u, v, p) => { const ph = u * TAU, [s, a] = base(v, Math.cos(ph)); return nrm(s, a, V()).multiplyScalar(Math.sin(ph) >= 0 ? 1 : -1); } });
  }

  function skateGeos() {
    // ---- shell (two halves so each side gets its own graphics), liner and footbed
    const NU = 40, NV = 104;
    const shell = mergeGeos([shellHalf(NU, NV, COL, SMAX, 1, 0), shellHalf(NU, NV, COL, SMAX, -1, 0)]);
    weldNormals(shell);
    const LS1 = COL + 2.3;
    const liner = mergeGeos([shellHalf(28, 14, COL, LS1, 1, -0.5), shellHalf(28, 14, COL, LS1, -1, -0.5)]);
    weldNormals(liner);
    const fl = [], st = station(LS1), as = aRow(st, 28);
    for (const a0 of as) fl.push(P(LS1, a0).addScaledVector(nrm(LS1, a0), -0.5));
    for (let i = as.length - 2; i > 0; i--) fl.push(P(LS1, TAU - as[i]).addScaledVector(nrm(LS1, TAU - as[i]), -0.5));
    const fc = fl.reduce((m, p) => m.add(p), V()).multiplyScalar(1 / fl.length);
    const fpos = [fc.x, fc.y, fc.z], fidx = [];
    fl.forEach((p, i) => { fpos.push(p.x, p.y, p.z); fidx.push(0, 1 + i, 1 + ((i + 1) % fl.length)); });
    const floor = new THREE.BufferGeometry();
    floor.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    floor.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(fpos.length / 3 * 2).fill(0.5), 2));
    floor.setIndex(fidx); floor.computeVertexNormals();
    if (floor.attributes.normal.getY(0) < 0) { const ia = floor.index.array; for (let i = 0; i < ia.length; i += 3) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; } floor.computeVertexNormals(); }

    // ---- toe cap: shell region beyond capS(a), rising out of the shell with a bevelled edge
    const ref = aRow(station(11.8), 32);
    const capA = u => (u <= 0.5 ? ref[Math.round(u * 2 * 32)] : TAU - ref[Math.round((1 - u) * 2 * 32)]);
    const toecap = displaced(64, 44, (u, v) => { const a = capA(u); return [lerp(capS(a), SMAX, Math.pow(v, 1.5)), a]; },
      (u, v) => -0.06 + 0.24 * smooth(0, 0.1, v));

    // ---- tongue: padded strip over the instep that rises above the collar
    const tv = v => (v < 0.25 ? 0.25 * Math.pow(v / 0.25, 1.8) : v); // more rows in the rounded top
    const tongue = pillow(40, 72, (v, w) => { v = tv(v); const s = lerp(TONGUE[0], TONGUE[1], v), k = capK(v, 0.06, 0.03); return [s, aOfZ(s, w * tongueHalf(s) * Math.pow(k, 0.3))]; },
      (v, w) => { v = tv(v); const s = lerp(TONGUE[0], TONGUE[1], v), k = capK(v, 0.06, 0.03); return [tongueBase(s) - tongueDive(s) * Math.pow(w, 4), tongueThick(s) * Math.pow(k, 0.6)]; },
      (u, v) => [u, 1 - tv(v)]);

    // ---- eyelet facings (both sides)
    const F_S0 = sTop(aOfZ(COL, ZG + FW)) + 0.05, facings = [];
    for (const sd of [1, -1]) {
      facings.push(pillow(16, 60, (v, w) => {
        const s = lerp(F_S0, S_FACE1, v), k = capK(v, 0.025, 0.04), f = (1 - w) / 2;
        return [s, aOfZ(s, sd * (ZG + FW * (0.5 + (f - 0.5) * k)))];
      }, (v, w) => { const k = capK(v, 0.025, 0.04); return [faceDc((1 - w) / 2, lerp(F_S0, S_FACE1, v)), FACE_T * Math.pow(k, 0.5)]; }));
    }
    const facing = mergeGeos(facings);
    const faceTop = (s, z) => { const f = clamp((Math.abs(z) - ZG) / FW, 0, 1); return faceDc(f, s) + FACE_T; };

    // ---- eyelets and laces
    const rows = eyeletRows(9), ZE = ZG + 0.5, eyes = [], laces = [], laceTop = [];
    const eyeAt = (s, z) => { const a = aOfZ(s, z), n = nrm(s, a); return { p: P(s, a).addScaledVector(n, faceTop(s, z)), n }; };
    for (const s of rows) for (const sd of [1, -1]) {
      const { p, n } = eyeAt(s, sd * ZE);
      eyes.push(placeGeo(new THREE.TorusGeometry(0.27, 0.075, 6, 14).rotateX(PI / 2), p.clone().addScaledVector(n, 0.02), n));
    }
    const lacePt = (s, z, lift) => {
      const a = aOfZ(s, z), n = nrm(s, a), h = Math.abs(z) < ZG + 0.1 ? Math.max(tongueTop(s, z), Math.abs(z) > ZG - 0.25 ? faceTop(s, z) : -9) : faceTop(s, z);
      return P(s, a).addScaledVector(n, h + 0.13 + lift);
    };
    for (let i = 0; i < rows.length - 1; i++) {
      for (const sd of [1, -1]) {
        const s0 = rows[i], s1 = rows[i + 1], pts = [], over = sd > 0 ? 0.16 : 0;
        for (let k = 0; k <= 6; k++) {
          const f = k / 6, s = lerp(s0, s1, f), z = lerp(sd * ZE, -sd * ZE, f);
          const lift = over * Math.sin(f * PI) - (k === 0 || k === 6 ? 0.14 : 0);
          pts.push(lacePt(s, z, lift));
        }
        const n = nrm(lerp(s0, s1, 0.5), PI), dir = pts[6].clone().sub(pts[0]);
        laces.push(tube(pts, { radius: 0.15, flat: 0.42, seg: 28, radial: 7, up: n.clone().cross(dir).normalize() }));
      }
    }
    // top bar across the last pair, then a loose bow with two tails
    {
      const s = rows[0];
      const pts = []; for (let k = 0; k <= 6; k++) pts.push(lacePt(s, lerp(ZE, -ZE, k / 6), k === 0 || k === 6 ? -0.14 : 0));
      const n = nrm(s, PI); laces.push(tube(pts, { radius: 0.15, flat: 0.42, seg: 24, radial: 7, up: n.clone().cross(pts[6].clone().sub(pts[0])).normalize() }));
      const knot = lacePt(s, 0, 0.18), up = centre(s - 0.6).sub(centre(s)).normalize(), side = V(0, 0, 1);
      const nk = nrm(s, PI);
      for (const sd of [1, -1]) {
        const loop = [knot, knot.clone().addScaledVector(side, sd * 1.6).addScaledVector(up, 0.9).addScaledVector(nk, 0.35), knot.clone().addScaledVector(side, sd * 2.6).addScaledVector(up, 0.1).addScaledVector(nk, 0.45), knot.clone().addScaledVector(side, sd * 1.4).addScaledVector(up, -0.5).addScaledVector(nk, 0.25), knot.clone().addScaledVector(side, sd * 0.2).addScaledVector(nk, 0.05)];
        laces.push(tube(loop, { radius: 0.14, flat: 0.5, seg: 36, radial: 7, up: nk }));
        const tail = [knot, knot.clone().addScaledVector(side, sd * 0.7).addScaledVector(up, -1.2).addScaledVector(nk, 0.4), knot.clone().addScaledVector(side, sd * 1.1).addScaledVector(up, -3.0).addScaledVector(nk, 0.7), knot.clone().addScaledVector(side, sd * 0.8).addScaledVector(up, -4.6).addScaledVector(nk, 0.7)];
        laces.push(tube(tail, { radius: 0.14, flat: 0.5, seg: 30, radial: 7, up: nk, rFn: v => 0.14 * (v > 0.94 ? 1.25 : 1) }));
      }
      const kg = new THREE.SphereGeometry(0.3, 12, 8); kg.scale(1.3, 1, 0.8); kg.translate(knot.x, knot.y, knot.z); laces.push(kg);
    }

    // ---- collar roll around the opening (open at the lace gap)
    const A0 = aOfZ(COL, ZG + 0.35), roll = [];
    for (let i = 0; i <= 64; i++) {
      const a = lerp(A0, TAU - A0, i / 64), sr = sTop(a), n = nrm(sr, a), up = P(sr - 0.05, a).sub(P(sr, a)).normalize();
      roll.push(P(sr, a).addScaledVector(n, -0.3).addScaledVector(up, 0.24));
    }
    const collar = tube(roll, { seg: 140, radial: 12, rFn: v => 0.66 * Math.pow(capK(v, 0.07, 0.07), 0.8) + 0.02 });

    // ---- tendon guard: stiff flared fin on the back of the shaft
    const TG = [0.35, 4.6];
    const tgHalf = s => lerp(lerp(3.3, 2.4, smooth(0.3, 2.2, s)), 1.25, smooth(2.2, 4.6, s));
    const tendon = pillow(28, 44, (v, w) => { const s = lerp(TG[0], TG[1], v), k = capK(v, 0.08, 0); return [s, aOfZ(s, w * tgHalf(s) * Math.pow(k, 0.6), true)]; },
      (v, w) => { const s = lerp(TG[0], TG[1], v), k = capK(v, 0.08, 0); return [lerp(0.55, -0.25, smooth(2.6, 4.6, s)) - 0.25 * w * w * smooth(1.8, 2.4, s), 0.27 * Math.pow(k, 0.5)]; });

    // ---- holder and runner (side profile from the real sole line)
    const sole = []; for (let i = 0; i <= 120; i++) { const p = P(lerp(6.4, SMAX - 0.02, i / 120), 0); sole.push([p.x, p.y]); }
    const soleY = x => { for (let i = 1; i < sole.length; i++) if (sole[i][0] >= x) { const [x0, y0] = sole[i - 1], [x1, y1] = sole[i]; return lerp(y0, y1, (x - x0) / Math.max(1e-6, x1 - x0)); } return sole[sole.length - 1][1]; };
    const RAIL = 1.9, HX0 = 1.6, HX1 = 26.6;
    const hs = new THREE.Shape();
    const top = x => soleY(x) + 0.3, BT = 3.95;
    hs.moveTo(HX0, top(HX0));
    for (let i = 1; i <= 10; i++) { const x = lerp(HX0, 7.0, i / 10); hs.lineTo(x, top(x)); }
    hs.bezierCurveTo(8.7, top(7.6) - 0.2, 8.7, BT, 10.6, BT);
    hs.lineTo(14.4, BT);
    hs.bezierCurveTo(16.6, BT, 16.7, top(18) - 0.2, 18.6, top(18.6));
    for (let i = 1; i <= 14; i++) { const x = lerp(18.6, HX1, i / 14); hs.lineTo(x, top(x)); }
    hs.bezierCurveTo(HX1 + 0.1, 5.0, 26.3, 3.0, 25.4, RAIL + 0.15);
    hs.quadraticCurveTo(25.25, RAIL, 24.9, RAIL);
    hs.lineTo(3.3, RAIL);
    hs.quadraticCurveTo(2.9, RAIL, 2.75, RAIL + 0.2);
    hs.bezierCurveTo(2.0, 3.2, HX0 - 0.1, 5.2, HX0, soleY(HX0) + 0.3);
    const win = (x0, x1, xt0, xt1, yb, yt, r) => {
      const w = new THREE.Path();
      w.moveTo(x0 + r, yb); w.lineTo(x1 - r, yb); w.quadraticCurveTo(x1, yb, x1 - 0.12 * r, yb + r);
      w.lineTo(xt1 + 0.1 * r, yt - r); w.quadraticCurveTo(xt1, yt, xt1 - r, yt); w.lineTo(xt0 + r, yt);
      w.quadraticCurveTo(xt0, yt, xt0 - 0.1 * r, yt - r); w.lineTo(x0 + 0.12 * r, yb + r); w.quadraticCurveTo(x0, yb, x0 + r, yb);
      return w;
    };
    hs.holes.push(win(3.6, 6.6, 4.3, 6.0, 3.05, top(5) - 1.5, 0.55));
    hs.holes.push(win(19.2, 23.8, 20.0, 22.6, 3.05, top(21.5) - 1.5, 0.6));
    const holder = extrude(hs, 2, 0.16, { bt: 0.08, segs: 3, curve: 14 });
    { // taper: narrow at the runner rail, wide under the sole (affine in y keeps faces flat)
      const p = holder.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i), w = 0.5 + (y - RAIL) * 0.33; p.setZ(i, p.getZ(i) * w); }
      holder.computeVertexNormals();
    }
    const rk = x => 0.29 * Math.pow((x - 14.6) / 12.4, 2);
    const bs = new THREE.Shape();
    bs.moveTo(1.4, 3.3); bs.lineTo(25.0, 3.3);
    bs.bezierCurveTo(27.2, 3.2, 28.75, 2.4, 28.75, 1.3);
    bs.quadraticCurveTo(28.7, 0.35, 27.2, rk(27.2));
    for (let i = 1; i <= 24; i++) { const x = lerp(27.2, 2.2, i / 24); bs.lineTo(x, rk(x)); }
    bs.quadraticCurveTo(0.9, 0.45, 0.85, 1.4);
    bs.quadraticCurveTo(0.85, 2.6, 1.4, 3.3);
    const blade = extrude(bs, 0.3, 0.025, { segs: 1, curve: 10 });
    { const p = blade.attributes.position, uv = blade.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - 0.8) / 28.2, p.getY(i) / 3.4); }

    return { shell, liner, floor, toecap, tongue, facing, eyes: mergeGeos(eyes), laces: mergeGeos(laces), collar, tendon, holder, blade };
  }

  /* ---------------------------------------------------------------- */
  /* painting                                                          */
  /* ---------------------------------------------------------------- */
  // run fn once per side with the context mapped to model cm (x right toward the toe, y up)
  function eachSide(c, w, h, fn) {
    const kx = (w / 2) / (SX1 - SX0), ky = h / (SY1 - SY0);
    for (const sg of [1, -1]) {
      c.save();
      c.beginPath(); c.rect(sg > 0 ? 0 : w / 2, 0, w / 2, h); c.clip();
      c.setTransform(sg * kx, 0, 0, -ky, sg > 0 ? -SX0 * kx : w / 2 + SX1 * kx, SY1 * ky);
      fn(sg, kx, ky);
      c.restore();
    }
  }
  function paintShell(c, w, h, d, soleLine) {
    paintPattern(c, 0, 0, w, h, d, { unit: w / 2.6 });
    eachSide(c, w, h, (sg, kx, ky) => {
      // heel counter wing (secondary) with an accent pinline
      c.fillStyle = d.secondary;
      c.beginPath(); c.moveTo(-5, 4); c.lineTo(9.5, 4); c.bezierCurveTo(7.5, 8.5, 4.6, 11.0, 3.6, 15.0); c.bezierCurveTo(3.0, 18.0, 2.6, 22.0, 2.2, 30); c.lineTo(-5, 30); c.closePath(); c.fill();
      c.strokeStyle = d.accent; c.lineWidth = 0.32;
      c.beginPath(); c.moveTo(10.6, 4); c.bezierCurveTo(8.4, 8.9, 5.5, 11.4, 4.5, 15.2); c.bezierCurveTo(3.9, 18.3, 3.5, 22.0, 3.1, 30); c.stroke();
      // sweeping secondary band up the quarter toward the lacing
      c.fillStyle = d.secondary;
      c.beginPath(); c.moveTo(11.6, 4); c.bezierCurveTo(13.0, 9.5, 14.2, 14.0, 17.5, 16.6); c.lineTo(19.5, 15.4); c.bezierCurveTo(16.4, 13.0, 15.4, 9.0, 14.2, 4); c.closePath(); c.fill();
      // dark outsole edge around the bottom
      c.fillStyle = '#121418';
      c.beginPath(); c.moveTo(soleLine[0][0], soleLine[0][1]);
      for (const [x, y] of soleLine) c.lineTo(x, y + 0.55);
      c.lineTo(35, 4); c.lineTo(-5, 4); c.closePath(); c.fill();
      // wordmark on the quarter
      const txt = label(d);
      if (txt) {
        c.save(); c.translate(7.6, 17.4); c.scale(sg / kx, -1 / ky); c.rotate(-0.12 * sg);
        drawText(c, txt, 0, 0, 9.4 * kx, 2.5 * ky, d, { color: d.textColor });
        c.restore();
      }
      c.save(); c.translate(9.0, 11.2); c.scale(sg / kx, -1 / ky); c.rotate(-0.36 * sg);
      drawText(c, 'PRO  ' + (d.number ? d.number : 'X'), 0, 0, 4.2 * kx, 0.8 * ky, { ...d, font: 'modern' }, { color: d.accent, outline: false });
      c.restore();
    });
  }

  function buildSkates(item, d) {
    const G = C('geo', skateGeos);
    const soleLine = C('sole', () => { const o = []; for (let i = 0; i <= 80; i++) { const p = P(lerp(6.2, SMAX - 0.6, i / 80), 0); o.push([p.x, p.y]); } return o; });
    const B = ctex(item, 2048, 640);
    const shellM = surfMat(item, { map: B.tex, rough: 0.36, coat: 1, coatRough: 0.07 });
    item.add(G.shell, shellM);
    const linerM = surfMat(item, { color: '#26282d', rough: 0.9, sheen: 0.7, normal: 'knit', nx: 10, ny: 3, ns: 0.5 });
    item.add(G.liner, linerM);
    item.add(G.floor, surfMat(item, { color: '#17181b', rough: 0.95 }));
    const capM = plastic(item, { rough: 0.22, coat: 1, coatRough: 0.04 });
    item.add(G.toecap, capM);
    const TT = ctex(item, 256, 512);
    const tongueM = surfMat(item, { map: TT.tex, rough: 0.8, sheen: 1, sheenColor: '#9a9a9a', normal: 'fuzz', nx: 6, ny: 14, ns: 0.1 });
    item.add(G.tongue, tongueM);
    const faceM = surfMat(item, { color: '#17191d', rough: 0.55, coat: 0.3, coatRough: 0.3, normal: 'pebble', nx: 2, ny: 12, ns: 0.25 });
    item.add(G.facing, faceM);
    item.add(G.eyes, metal(item, { color: '#cfd4da', rough: 0.22 }));
    const laceM = fabric(item, { color: '#f2f3f5', normal: 'rib', nx: 1, ny: 30, ns: 0.6 });
    item.add(G.laces, laceM);
    item.add(G.collar, surfMat(item, { color: '#1b1c20', rough: 0.85, sheen: 1, normal: 'fuzz', nx: 16, ny: 2, ns: 0.3 }));
    const TGT = ctex(item, 256, 512);
    const tendonM = plastic(item, { map: TGT.tex, rough: 0.26, coat: 1, coatRough: 0.05 });
    item.add(G.tendon, tendonM);
    const holderM = plastic(item, { rough: 0.32, coat: 0.6, coatRough: 0.12 });
    item.add(G.holder, holderM);
    const BL = ctex(item, 64, 256);
    { // steel: polished face with a darker holder line and a bright ground edge
      const c = BL.ctx, w = BL.cv.width, h = BL.cv.height, g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#8d939b'); g.addColorStop(0.42, '#9aa1a9'); g.addColorStop(0.47, '#e9edf2'); g.addColorStop(0.7, '#c9cfd6');
      g.addColorStop(0.88, '#f4f6f9'); g.addColorStop(0.93, '#7c838c'); g.addColorStop(1, '#eef1f5');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }
    item.add(G.blade, metal(item, { map: BL.tex, color: '#ffffff', rough: 0.24, metal: 0.6 }));

    item.painters.push(d2 => {
      paintShell(B.ctx, B.cv.width, B.cv.height, d2, soleLine);
      const dark = lum(d2.primary) < 0.12;
      capM.color.set(dark ? mix(d2.primary, '#0b0c0f', 0.55) : mix(d2.primary, '#0b0c0f', 0.25));
      holderM.color.set(dark ? '#eceef1' : '#18191d');
      laceM.color.set('#1e2025');
      // tongue: white felt with a printed top panel
      const t = TT.ctx, tw = TT.cv.width, th = TT.cv.height;
      t.fillStyle = '#e6e8eb'; t.fillRect(0, 0, tw, th);
      t.fillStyle = '#1c1d22'; t.fillRect(0, 0, tw * 0.035, th); t.fillRect(tw * 0.465, 0, tw * 0.07, th); t.fillRect(tw * 0.965, 0, tw * 0.035, th); t.fillRect(0, 0, tw, th * 0.012);
      t.fillStyle = d2.primary; t.beginPath(); t.roundRect(tw * 0.06, th * 0.03, tw * 0.38, th * 0.15, tw * 0.05); t.fill();
      t.strokeStyle = d2.accent; t.lineWidth = tw * 0.012; t.stroke();
      drawText(t, d2.number || label(d2).slice(0, 1) || 'S', tw * 0.25, th * 0.105, tw * 0.28, th * 0.085, d2, { color: d2.textColor });
      // tendon guard
      const g = TGT.ctx, gw = TGT.cv.width, gh = TGT.cv.height;
      g.fillStyle = mix(d2.primary, '#0b0c0f', dark ? 0.4 : 0.15); g.fillRect(0, 0, gw, gh);
      g.fillStyle = d2.secondary; g.fillRect(0, gh * 0.05, gw / 2, gh * 0.05);
      g.fillStyle = d2.accent; g.fillRect(0, gh * 0.115, gw / 2, gh * 0.015);
      if (d2.number) { g.save(); g.translate(gw * 0.25, gh * 0.24); g.scale(-1, 1); drawText(g, d2.number, 0, 0, gw * 0.3, gh * 0.075, d2, { color: d2.textColor }); g.restore(); } // outer face is mirrored in u
      finish(shellM, d2, false); finish(capM, d2, true); finish(tendonM, d2, true);
    });
    Object.assign(item, { yaw: 0, heroYaw: -0.5, elev: 0.12, fit: 1.1 });
  }

  return {
    shapes: ['hockey-skates'],
    builders: { 'hockey-skates': buildSkates },
    defaults: { 'hockey-skates': ['#04282e', '#2ee6d6', '#c8f53c'] },
    meta: { 'hockey-skates': { label: 'Hockey skates', sport: 'Hockey', category: 'Footwear', size: 'shoe' } },
  };
}
