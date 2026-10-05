// SquadForge gear module: socks (team / crew / over-the-calf athletic socks).
// Original procedural model, no real brand marks.
// Loaded by gear3d.js through GEAR_MODULES: default export (K) => ({ shapes, builders, defaults, meta }).
//
// How the sock is built:
//  - an invisible foot form is described as a smooth implicit surface (calf, Achilles, heel,
//    midfoot, rounded toe and ankle bones blended with smooth unions), all in centimetres.
//  - a knit tube is "shrink wrapped" onto it: rays are cast from a spine that runs down the
//    leg, bends round the ankle and runs out to the toe, and every vertex sits exactly on the
//    implicit surface. Rows and columns are re-spaced by true surface arc length, so the
//    heel cup and toe stay evenly tessellated with no pinches or folds.
//  - knit zones (ribbed cuff, ribbed leg, compression arch band, cushioned heel, toe and sole,
//    ventilation over the instep) share one UV layout and drive the colour map, a baked
//    knit normal map and small geometric offsets, so everything lines up.
// Axes: x toward the toe, y up, z across the foot (+z is the lateral side of the right sock).

export default function socks(K) {
  const { THREE, TAU, PI, V, lerp, clamp, smooth, spline, grid, cached, paintPattern, drawText, lum, shade, mix } = K;

  /* ---------------------------------------------------------------- */
  /* the invisible foot form                                           */
  /* ---------------------------------------------------------------- */
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const smax = (a, b, k) => -smin(-a, -b, k);
  const gauss = (x, c, w) => Math.exp(-((x - c) / w) * ((x - c) / w));

  const YTOP = 34.5;                      // cuff height above the floor (cm): just over the calf belly
  // leg: front (shin) and back (calf / Achilles) lines, half width
  const legXF = spline([[2, 8.4], [6, 8.1], [9, 7.75], [14, 7.8], [20, 8.0], [27, 8.25], [31, 8.25], [36, 8.1], [44, 7.9]]);
  const legXB = spline([[2, 1.8], [6, 1.45], [9, 1.35], [13, 1.15], [18, 0.3], [23, -1.2], [27, -2.15], [30, -2.45], [33, -2.3], [37, -1.8], [44, -1.0]]);
  const legB = spline([[2, 3.5], [6, 3.45], [9, 3.15], [13, 3.3], [18, 4.05], [23, 4.85], [27, 5.3], [30, 5.45], [33, 5.35], [37, 5.1], [44, 4.9]]);
  function fLeg(x, y, z) {
    const yy = clamp(y, 2, 46);
    const xf = legXF(yy), xb = legXB(yy), b = legB(yy);
    const xc = (xf + xb) / 2, ax = (xf - xb) / 2;
    // calf belly sits a touch medial (the inner calf head is lower and fuller)
    const zc = -0.35 * gauss(yy, 26, 6);
    const dx = (x - xc) / ax;
    const sx = clamp(dx, 0, 1), bz = b * (1 - 0.12 * sx * sx); // the shin narrows toward the front
    const dz = (z - zc) / bz;
    const k = Math.hypot(dx, dz);
    return smax((k - 1) * Math.min(ax, bz), 2.5 - y, 1.2);
  }
  // foot: lofted section along x
  const X0 = -1.7, X1 = 24.6, HX = 1.6, TX = 20.9;
  const footTop = spline([[X0, 6.2], [0, 7.0], [4, 8.2], [8, 7.9], [11, 6.75], [15, 5.4], [18.5, 4.5], [21, 4.05], [23, 3.6], [X1, 3.0]]);
  const footBot = spline([[X0, 1.4], [0, 0.35], [2, 0.0], [20, 0.0], [22.5, 0.25], [X1, 0.75]]);
  const footW = spline([[X0, 3.0], [1, 3.15], [4, 3.45], [8, 3.85], [13, 4.25], [17.5, 4.8], [20, 4.75], [22.5, 4.3], [X1, 3.9]]);
  const footZ = spline([[X0, 0.1], [8, 0], [14, -0.15], [18, -0.35], [X1, -0.75]]);
  function fFoot(x, y, z) {
    let k = 1;
    if (x < HX) { const q = (HX - x) / (HX - X0); k = Math.sqrt(Math.max(0, 1 - q * q)); }
    else if (x > TX) { const q = (x - TX) / (X1 - TX); k = Math.sqrt(Math.max(0, 1 - q * q)); }
    const top = footTop(x), bot = footBot(x);
    if (k < 1e-3) { // beyond the heel or toe tip: distance to the tip point keeps the field continuous
      const xe = x < HX ? X0 : X1;
      return Math.hypot(x - xe, y - (footTop(xe) + footBot(xe)) / 2, z - footZ(xe));
    }
    const ym = (top + bot) / 2, hy = (top - bot) / 2 * k, ww = footW(x) * k;
    const dy = (y - ym) / hy, dz = (z - footZ(x)) / ww;
    const n = dy < 0 ? 2.7 : 2.15;
    const q = Math.pow(Math.pow(Math.abs(dy), n) + Math.pow(Math.abs(dz), n), 1 / n);
    return (q - 1) * Math.min(hy, ww);
  }
  const ell = (x, y, z, cx, cy, cz, rx, ry, rz) => {
    const k = Math.hypot((x - cx) / rx, (y - cy) / ry, (z - cz) / rz);
    return (k - 1) * Math.min(rx, ry, rz);
  };
  function F(x, y, z) {
    let f = smin(fLeg(x, y, z), fFoot(x, y, z), 2.2);
    // ankle bones: lateral sits lower and further back than medial
    f = smin(f, ell(x, y, z, 4.2, 6.7, 2.55, 1.5, 1.7, 0.95), 1.1);
    f = smin(f, ell(x, y, z, 5.0, 7.6, -2.45, 1.5, 1.7, 0.95), 1.1);
    return f;
  }

  /* ---------------------------------------------------------------- */
  /* spine: down the leg, round the ankle, out along the foot          */
  /* ---------------------------------------------------------------- */
  const XS = 4.6, R = 6.5, TURN = PI / 2 - 0.122, Y1 = 9.7, XE = 21.3;
  const L1 = YTOP - Y1, L2 = R * TURN;
  const arcEnd = [XS + R * (1 - Math.cos(TURN)), Y1 - R * Math.sin(TURN)];
  const dirF = [Math.sin(TURN), -Math.cos(TURN)];
  const L3 = (XE - arcEnd[0]) / dirF[0];
  const SA = L1 + L2 + L3, ST = 5.2, STOT = SA + ST;
  function spine(s) {
    if (s <= L1) return { P: [XS, YTOP - s], T: [0, -1], part: 0 };
    if (s <= L1 + L2) {
      const ph = (s - L1) / R;
      return { P: [XS + R * (1 - Math.cos(ph)), Y1 - R * Math.sin(ph)], T: [Math.sin(ph), -Math.cos(ph)], part: 1 };
    }
    const q = Math.min(s, SA) - L1 - L2;
    return { P: [arcEnd[0] + dirF[0] * q, arcEnd[1] + dirF[1] * q], T: dirF, part: 2 };
  }
  // ray for composite parameter s and angle a (0 back/sole, pi/2 lateral, pi front/top)
  function ray(s, a, O, D) {
    const sp = spine(s), c = Math.cos(a), sn = Math.sin(a);
    const No = [sp.T[1], -sp.T[0]];
    O[0] = sp.P[0]; O[1] = sp.P[1]; O[2] = 0;
    let dx = No[0] * c, dy = No[1] * c, dz = sn;
    if (s > SA) {
      const phi = Math.min(1, (s - SA) / ST) * PI / 2, cp = Math.cos(phi), sp2 = Math.sin(phi);
      dx = dx * cp + sp.T[0] * sp2; dy = dy * cp + sp.T[1] * sp2; dz *= cp;
    }
    D[0] = dx; D[1] = dy; D[2] = dz;
  }
  // distance along the ray to the form surface; a guess (neighbouring ray) gives a tight bracket
  function hitDist(O, D, guess) {
    const at = t => F(O[0] + D[0] * t, O[1] + D[1] * t, O[2] + D[2] * t);
    let t0 = 0, t1 = 0.35, it = 18;
    if (guess > 0.6 && at(guess - 0.3) < 0 && at(guess + 0.3) >= 0 && at(guess - 0.6) < 0) { t0 = guess - 0.3; t1 = guess + 0.3; it = 13; }
    else while (t1 < 24 && at(t1) < 0) { t0 = t1; t1 += 0.35; }
    for (let i = 0; i < it; i++) { const m = (t0 + t1) / 2; if (at(m) < 0) t0 = m; else t1 = m; }
    return (t0 + t1) / 2;
  }
  function gradN(x, y, z, out) {
    const e = 0.02;
    out[0] = F(x + e, y, z) - F(x - e, y, z); out[1] = F(x, y + e, z) - F(x, y - e, z); out[2] = F(x, y, z + e) - F(x, y, z - e);
    const l = Math.hypot(out[0], out[1], out[2]) || 1; out[0] /= l; out[1] /= l; out[2] /= l;
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* surface sampling with arc-length re-spacing                       */
  /* ---------------------------------------------------------------- */
  const NU = 88, NV = 140, NA = 320;
  function buildModel() {
    const O = [0, 0, 0], D = [0, 0, 0];
    // 1. dense rows at a few angles -> row spacing metric and mean surface length (texture v)
    const NS = 700, NQ = 16, prev = [], prevT = [], met = new Float64Array(NS + 1), mean = new Float64Array(NS + 1);
    for (let i = 0; i <= NS; i++) {
      const s = i / NS * STOT; let mx = 0, sm = 0;
      for (let q = 0; q < NQ; q++) {
        ray(s, q / NQ * TAU, O, D); const t = hitDist(O, D, i ? prevT[q] : 0); prevT[q] = t;
        const p = [O[0] + D[0] * t, O[1] + D[1] * t, O[2] + D[2] * t];
        if (i) { const dd = Math.hypot(p[0] - prev[q][0], p[1] - prev[q][1], p[2] - prev[q][2]); mx = Math.max(mx, dd); sm += dd; }
        prev[q] = p;
      }
      if (i) { met[i] = met[i - 1] + 0.55 * mx + 0.45 * sm / NQ; mean[i] = mean[i - 1] + sm / NQ; }
    }
    const L = mean[NS];
    const sAtMet = g => { let lo = 0, hi = NS; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (met[m] < g) lo = m; else hi = m; } const f = (g - met[lo]) / ((met[hi] - met[lo]) || 1); return (lo + f) / NS * STOT; };
    const vAtS = s => { const f = clamp(s / STOT, 0, 1) * NS, i = Math.min(NS - 1, Math.floor(f)); return lerp(mean[i], mean[i + 1], f - i); };
    const sAtV = v => { let lo = 0, hi = NS; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (mean[m] < v) lo = m; else hi = m; } const f = (v - mean[lo]) / ((mean[hi] - mean[lo]) || 1); return (lo + f) / NS * STOT; };
    // landmarks along the sock (texture distance from the cuff edge, cm)
    const sAtX = x => L1 + L2 + (x - arcEnd[0]) / dirF[0];
    const lm = {
      ankle: vAtS(L1), heel: vAtS(L1 + L2 * 0.5), foot0: vAtS(L1 + L2), arch1: vAtS(sAtX(14.5)), toe: vAtS(sAtX(19.6)), L,
      calf: vAtS(YTOP - 27), calf2: vAtS(YTOP - 22),
    };
    // 2. final rows: even in the metric, each row re-spaced by arc length per quarter
    const rows = [];
    const pos = new Float32Array((NU + 1) * (NV + 1) * 3), nrm = new Float32Array((NU + 1) * (NV + 1) * 3), us = new Float32Array((NU + 1) * (NV + 1));
    const tmp = new Float64Array((NA + 1) * 3), cum = new Float64Array(NA + 1), g = [0, 0, 0];
    for (let j = 0; j <= NV; j++) {
      const s = j === NV ? STOT : sAtMet(j / NV * met[NS]);
      const v = vAtS(s);
      let tg = 0;
      for (let k = 0; k <= NA; k++) {
        ray(s, k / NA * TAU, O, D); const t = tg = hitDist(O, D, tg);
        tmp[k * 3] = O[0] + D[0] * t; tmp[k * 3 + 1] = O[1] + D[1] * t; tmp[k * 3 + 2] = O[2] + D[2] * t;
        cum[k] = k ? cum[k - 1] + Math.hypot(tmp[k * 3] - tmp[k * 3 - 3], tmp[k * 3 + 1] - tmp[k * 3 - 2], tmp[k * 3 + 2] - tmp[k * 3 - 1]) : 0;
      }
      const sp = spine(Math.min(s, SA));
      rows.push({ s, v, O: [sp.P[0], sp.P[1], 0], circ: cum[NA] });
      const QA = NA / 4, QU = NU / 4;
      for (let i = 0; i <= NU; i++) {
        const qd = Math.min(3, Math.floor(i / QU)), f = i / QU - qd;
        const k0 = qd * QA, c0 = cum[k0], c1 = cum[k0 + QA];
        let kk;
        if (c1 - c0 < 1e-4) kk = k0 + f * QA;
        else {
          const target = c0 + f * (c1 - c0);
          let lo = k0, hi = k0 + QA; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < target) lo = m; else hi = m; }
          kk = lo + (target - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
        }
        const ka = Math.min(NA - 1, Math.floor(kk)), fr = kk - ka, o = (j * (NU + 1) + i) * 3;
        for (let c = 0; c < 3; c++) pos[o + c] = lerp(tmp[ka * 3 + c], tmp[ka * 3 + 3 + c], fr);
        gradN(pos[o], pos[o + 1], pos[o + 2], g);
        nrm[o] = g[0]; nrm[o + 1] = g[1]; nrm[o + 2] = g[2];
        us[j * (NU + 1) + i] = i / NU;
      }
    }
    // 3. knit offsets: welt, cuff grip, cushioning, compression band, soft ankle creases
    const Z = zoneFns(lm);
    for (let j = 0; j <= NV; j++) {
      const v = rows[j].v;
      for (let i = 0; i <= NU; i++) {
        const u = i / NU, o = (j * (NU + 1) + i) * 3, z = Z(u, v);
        let off = 0.13 * z.welt - 0.05 * z.cuff * (1 - z.welt) + 0.11 * z.cush - 0.07 * z.arch * (1 - z.cush);
        // a couple of soft folds where the knit gathers over the front of the ankle
        const fu = Math.max(0, Math.cos((u - 0.5) * PI / 0.42)), fv = (v - lm.ankle + 1.5);
        if (fu > 0 && fv > 0 && fv < 7) off += 0.09 * fu * fu * Math.sin(fv / 7 * PI * 3) * Math.sin(fv / 7 * PI);
        // the leg pulls taut toward the cuff, slightly looser over the shin
        for (let c = 0; c < 3; c++) pos[o + c] += nrm[o + c] * off;
      }
    }
    // calf circumference sets the texture aspect so prints keep true proportions on the calf
    const jc = rows.reduce((b, r, j) => (Math.abs(r.v - lm.calf) < Math.abs(rows[b].v - lm.calf) ? j : b), 0);
    const Ccalf = rows[jc].circ;
    const body = grid(NU, NV, (u, v, t) => {
      const j = Math.round(v * NV), i = Math.round(u * NU), o = (j * (NU + 1) + i) * 3;
      t.set(pos[o], pos[o + 1], pos[o + 2]);
      return [u, 1 - rows[j].v / L];
    }, { outward: (u, v, p) => { const r = rows[Math.round(v * NV)]; return p.clone().sub(V(r.O[0], r.O[1], 0)); } });
    // cuff: rolled lip over the top edge and the inside wall, closed deep inside so steep views never see through
    const TH = 0.32, NL = 6, NI = 16, depth = 16;
    const jMax = rows.findIndex(r => r.v > depth);
    const inner = grid(NU, NL + NI + 4, (u, v, t) => {
      const k = Math.round(v * (NL + NI + 4)), i = Math.round(u * NU);
      const o0 = i * 3, n0 = V(nrm[o0], 0, nrm[o0 + 2]).normalize(), p0 = V(pos[o0], pos[o0 + 1], pos[o0 + 2]);
      if (k <= NL) {
        const th = k / NL * PI;
        t.copy(p0).addScaledVector(n0, -TH / 2 + Math.cos(th) * TH / 2).add(V(0, Math.sin(th) * TH * 0.55, 0));
        return [u, 1 - 0.05 / L];
      }
      if (k <= NL + NI) {
        const j = Math.round((k - NL) / NI * jMax), o = (j * (NU + 1) + i) * 3;
        const n = V(nrm[o], nrm[o + 1], nrm[o + 2]);
        t.set(pos[o], pos[o + 1], pos[o + 2]).addScaledVector(n, -TH);
        return [u, 1 - rows[j].v / L];
      }
      const o = (jMax * (NU + 1) + i) * 3, f = (k - NL - NI) / 4, c = V(rows[jMax].O[0], rows[jMax].O[1], 0);
      t.set(pos[o], pos[o + 1], pos[o + 2]).addScaledVector(V(nrm[o], nrm[o + 1], nrm[o + 2]), -TH).lerp(c, Math.sin(f * PI / 2));
      return [u, 1 - rows[jMax].v / L];
    }, { outward: (u, v, p) => { const k = Math.round(v * (NL + NI + 4)); if (k <= NL) return V(0, 1, 0); const r = rows[Math.min(jMax, Math.round((k - NL) / NI * jMax))]; return V(r.O[0], r.O[1], 0).sub(p); } });
    for (const gm of [body, inner]) { gm.scale(0.05, 0.05, 0.05); gm.computeBoundingSphere(); }
    return { body, inner, lm, L, Ccalf, rows };
  }

  /* ---------------------------------------------------------------- */
  /* knit zones in (u, v cm) shared by geometry, colour and normals    */
  /* ---------------------------------------------------------------- */
  function zoneFns(lm) {
    const wrapU = u => { const a = u - Math.round(u); return a; }; // distance from the back line (u = 0)
    return (u, v) => {
      const du = Math.abs(wrapU(u)), dfront = Math.abs(u - 0.5);
      const welt = 1 - smooth(1.2, 1.7, v);
      const cuff = 1 - smooth(3.6, 4.2, v);
      // heel cup: a rounded pocket on the back of the bend, rising a few cm up the Achilles
      const hv = (v - (lm.heel + 0.4)) / (v < lm.heel + 0.4 ? 5.8 : 4.6), hu = du / 0.245;
      const heel = 1 - smooth(0.965, 1.0, Math.hypot(hu, hv));
      // toe cap: the seam sits further back under the sole than over the toes
      const toeEdge = lm.toe - 1.1 * Math.cos(u * TAU);
      const toe = smooth(toeEdge - 0.12, toeEdge + 0.12, v);
      // cushioned sole between heel and toe
      const sole = (1 - smooth(0.14, 0.16, du)) * smooth(lm.foot0 - 1, lm.foot0 + 1.5, v);
      const cush = Math.max(heel, toe, sole);
      // compression band round the arch
      // compression band wraps right round the midfoot, swept back toward the heel under the sole
      const sw = 1.1 * Math.cos(u * TAU);
      const arch = smooth(lm.foot0 + 1.4 - sw - 0.12, lm.foot0 + 1.4 - sw + 0.12, v) * (1 - smooth(lm.arch1 - sw - 0.12, lm.arch1 - sw + 0.12, v));
      // ventilation panel over the instep
      const vent = (1 - smooth(0.1, 0.13, dfront)) * smooth(lm.arch1 + 0.3, lm.arch1 + 0.8, v) * (1 - smooth(toeEdge - 1.4, toeEdge - 0.9, v));
      return { welt, cuff, heel, toe, sole, cush, arch, vent };
    };
  }

  /* ---------------------------------------------------------------- */
  /* baked knit normal map in the sock UV layout                       */
  /* ---------------------------------------------------------------- */
  function knitNormals(G) {
    const W = 1024, H = Math.round(W * G.L / G.Ccalf);
    const Z = zoneFns(G.lm), Hf = new Float32Array(W * H);
    const RIB = 104, CRIB = 72;
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H * G.L;
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W, z = Z(u, v);
        // jersey stitch: little V loops in columns
        const col = u * RIB * 2, fx = col - Math.floor(col) - 0.5;
        const row = v / 0.21 + Math.abs(fx) * 0.9, fy = row - Math.floor(row) - 0.5;
        const stitch = Math.exp(-fy * fy * 12) * (1 - fx * fx * 2.4);
        const legRib = Math.pow(0.5 + 0.5 * Math.cos(u * TAU * RIB), 0.8);
        const cuffRib = Math.pow(0.5 + 0.5 * Math.cos(u * TAU * CRIB), 0.6);
        const archRib = 0.5 + 0.5 * Math.cos(v / 0.32 * TAU);
        const fv = v / 0.42, fu = u * 150; // ventilation eyelets
        const ex = fu - Math.floor(fu) - 0.5, ey = fv + (Math.floor(fu) % 2) * 0.5, ey2 = ey - Math.floor(ey) - 0.5;
        const eyelet = -Math.exp(-(ex * ex + ey2 * ey2) * 26);
        let h = 0;
        const weltLines = 0.25 * Math.sin(v / 0.18 * TAU);
        const plain = 1 - z.cuff;
        h += z.welt * weltLines;
        h += z.cuff * (1 - z.welt) * (cuffRib * 1.25 + 0.12 * stitch);
        let rest = plain * (legRib * 0.7 + 0.22 * stitch);
        const cushK = Math.max(z.heel, z.toe, z.sole * (1 - z.arch)), archK = z.arch * (1 - Math.max(z.heel, z.toe)), ventK = z.vent * (1 - cushK);
        rest = rest * (1 - cushK - archK - ventK) + plain * (cushK * (0.45 * stitch) + archK * (0.65 * archRib + 0.15 * stitch) + ventK * (0.25 * stitch + 0.75 * eyelet));
        h += rest;
        Hf[y * W + x] = h;
      }
    }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'), img = ctx.createImageData(W, H), S = 2.1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const xl = Hf[y * W + ((x - 1 + W) % W)], xr = Hf[y * W + ((x + 1) % W)];
      const yu = Hf[Math.max(0, y - 1) * W + x], yd = Hf[Math.min(H - 1, y + 1) * W + x];
      let nx = (xl - xr) * S, ny = (yd - yu) * S, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * W + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /* ---------------------------------------------------------------- */
  /* colour artwork                                                    */
  /* ---------------------------------------------------------------- */
  function paintSock(c, w, h, d, G, flipText) {
    const lm = G.lm, pxu = h / G.L, Y = v => v * pxu, U = u => u * w;
    const Z = zoneFns(lm);
    const P = d.primary, S2 = d.secondary, A2 = d.accent;
    const contrast = (a, b) => Math.abs(lum(a) - lum(b));
    const trim = contrast(S2, P) > 0.06 ? S2 : A2;
    const stripe2 = contrast(A2, P) > 0.06 && A2 !== trim ? A2 : shade(trim, lum(trim) > 0.4 ? -0.3 : 0.4);
    const tone = k => (lum(P) < 0.02 ? mix(P, trim, k * 0.9) : shade(P, -k * 1.4));
    c.clearRect(0, 0, w, h);
    c.fillStyle = P; c.fillRect(0, 0, w, h);
    // pattern on the leg between the cuff stripes and the ankle (mirrored halves keep the back line continuous)
    const y0 = Y(8.6), y1 = Y(lm.ankle - 1.2);
    if (d.pattern !== 'solid') {
      const o = { unit: pxu * 7, seed: 4 };
      // geometric patterns are mirrored about the shin so they sit centred on each side of the leg;
      // organic ones run once round the leg (the wrap seam is on the back line) so they never look like an inkblot
      if (/^(stripes|pinstripe|chevron|sash|split)$/.test(d.pattern)) {
        paintPattern(c, 0, y0, w / 2, y1 - y0, d, o); paintPattern(c, w / 2, y0, w / 2, y1 - y0, d, { ...o, mirror: true });
      } else paintPattern(c, 0, y0, w, y1 - y0, d, o);
      c.fillStyle = trim; c.fillRect(0, y1, w, Y(0.35));
    }
    // cuff stripes, knitted in
    c.fillStyle = trim; c.fillRect(0, Y(4.9), w, Y(1.1));
    c.fillStyle = stripe2; c.fillRect(0, Y(6.55), w, Y(0.55));
    c.fillStyle = trim; c.fillRect(0, Y(7.6), w, Y(0.45));
    // tonal zones: arch band, cushioned sole, ventilation, then heel and toe caps in the trim colour
    const img = c.getImageData(0, 0, w, h);
    const toRGB = hex => { const q = new THREE.Color(hex); q.convertLinearToSRGB(); return [q.r * 255, q.g * 255, q.b * 255]; };
    const cArch = toRGB(tone(0.07)), cSole = toRGB(tone(0.16)), cVent = toRGB(tone(0.04)), cTrim = toRGB(trim);
    const vStart = lm.ankle - 3;
    for (let y = Math.floor(Y(vStart)); y < h; y++) {
      const v = (y + 0.5) / pxu;
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, z = Z(u, v), i = (y * w + x) * 4;
        let r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        const mixIn = (col, k) => { if (k > 0) { r = lerp(r, col[0], k); g = lerp(g, col[1], k); b = lerp(b, col[2], k); } };
        mixIn(cSole, z.sole);
        mixIn(cArch, z.arch);
        mixIn(cVent, z.vent * 0.8);
        mixIn(cTrim, Math.max(z.heel, z.toe));
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
      }
    }
    c.putImageData(img, 0, 0);
    // soft knit shading: under the folded welt and in the crease over the front of the ankle
    const wg = c.createLinearGradient(0, Y(1.45), 0, Y(2.6));
    wg.addColorStop(0, 'rgba(0,0,0,0.16)'); wg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = wg; c.fillRect(0, Y(1.45), w, Y(1.15));
    const ay = Y(lm.ankle + 2.2), ag = c.createRadialGradient(U(0.5), ay, 0, U(0.5), ay, Y(4.5));
    ag.addColorStop(0, 'rgba(0,0,0,0.13)'); ag.addColorStop(1, 'rgba(0,0,0,0)');
    c.save(); c.translate(U(0.5), ay); c.scale(1.6, 1); c.translate(-U(0.5), -ay); c.fillStyle = ag; c.fillRect(U(0.5) - Y(5), ay - Y(5), Y(10), Y(10)); c.restore();
    // thin linking seam across the toe
    c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = Math.max(1, Y(0.08));
    c.beginPath();
    for (let i = 0; i <= 64; i++) { const u = i / 64, yy = Y(lm.toe - 1.1 * Math.cos(u * TAU)); i ? c.lineTo(U(u), yy) : c.moveTo(U(u), yy); }
    c.stroke();
    // calf print on the lateral side (u = 0.25), sized in true calf centimetres
    const name = d.text || d.chest || d.name, num = d.number;
    const cx = U(0.27);
    const drawFlip = fn => {
      c.save();
      if (flipText) { c.translate(cx, 0); c.scale(-1, 1); c.translate(-cx, 0); }
      fn(); c.restore();
    };
    drawFlip(() => {
      if (num) {
        drawText(c, num, cx, Y(lm.calf + 0.4), pxu * 8, pxu * 5.2, d, { color: d.textColor });
        if (name) drawText(c, name, cx, Y(lm.calf + 4.6), pxu * 9, pxu * 1.75, d, { color: d.textColor });
      } else if (name) {
        c.save(); c.translate(cx, Y(lm.calf + 2)); c.rotate(PI / 2);
        drawText(c, name, 0, 0, pxu * 13, pxu * 2.6, d, { color: d.textColor });
        c.restore();
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* builder                                                           */
  /* ---------------------------------------------------------------- */
  // the pair on invisible forms: right sock in front, left sock (mirrored) a step behind and further along
  const PLACE = [[0, 0, 0, 1], [0.34, -0.6, 0.12, -1]];
  function pairGeos(G) {
    const mats = PLACE.map(([x, z, ry, sz]) => new THREE.Matrix4().compose(V(x, 0, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(1, 1, sz)));
    const merge = src => {
      const n = src.attributes.position.count, idx = src.index.array, out = new THREE.BufferGeometry();
      const P = new Float32Array(n * 6), N = new Float32Array(n * 6), UV = new Float32Array(n * 4), I = new Uint32Array(idx.length * 2);
      const p = V(), q = V();
      mats.forEach((m, k) => {
        const nm = new THREE.Matrix3().getNormalMatrix(m), flip = m.determinant() < 0;
        for (let i = 0; i < n; i++) {
          p.fromBufferAttribute(src.attributes.position, i).applyMatrix4(m); p.toArray(P, (k * n + i) * 3);
          q.fromBufferAttribute(src.attributes.normal, i).applyMatrix3(nm).normalize(); q.toArray(N, (k * n + i) * 3);
          UV[(k * n + i) * 2] = src.attributes.uv.getX(i); UV[(k * n + i) * 2 + 1] = src.attributes.uv.getY(i);
        }
        for (let t = 0; t < idx.length; t += 3) {
          const o = k * idx.length + t;
          I[o] = idx[t] + k * n; I[o + 1] = idx[t + (flip ? 2 : 1)] + k * n; I[o + 2] = idx[t + (flip ? 1 : 2)] + k * n;
        }
      });
      out.setAttribute('position', new THREE.BufferAttribute(P, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      out.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
      out.setIndex(new THREE.BufferAttribute(I, 1));
      out.addGroup(0, idx.length, 0); out.addGroup(idx.length, idx.length, 1);
      return out;
    };
    const body = merge(G.body), inner = merge(G.inner);
    body.computeBoundingBox();
    const c = body.boundingBox.getCenter(V());
    for (const g of [body, inner]) { g.translate(-c.x, -c.y, -c.z); g.computeBoundingBox(); g.computeBoundingSphere(); }
    return { body, inner };
  }
  let normalSrc = null;
  function buildSocks(item, d) {
    const G = cached('socks-v4', buildModel);
    if (!normalSrc) normalSrc = knitNormals(G);
    const ntex = new THREE.CanvasTexture(normalSrc);
    ntex.colorSpace = THREE.NoColorSpace; ntex.anisotropy = 8; ntex.wrapS = THREE.RepeatWrapping;
    item.texs.push({ dispose: () => ntex.dispose(), image: null });
    const CW = 1024, CH = Math.round(CW * G.L / G.Ccalf);
    const sides = [0, 1].map(k => {
      const cv = item.canvas(CW, CH), map = item.tex(cv);
      map.wrapS = THREE.RepeatWrapping;
      const knit = item.mat({
        map, normalMap: ntex, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.9, specularIntensity: 0.35,
        sheen: 1, sheenRoughness: 0.42, sheenColor: new THREE.Color(0.3, 0.3, 0.3),
      }, {});
      const inside = item.mat({
        color: new THREE.Color(0.42, 0.42, 0.42), roughness: 0.95, specularIntensity: 0.2,
        normalMap: ntex, normalScale: new THREE.Vector2(0.5, 0.5), sheen: 0.6, sheenColor: new THREE.Color(0.15, 0.15, 0.15),
      }, {});
      return { cv, knit, inside, flip: k === 1 };
    });
    // one mesh per layer holding both socks (material groups 0 and 1), centred on the origin:
    // the stage then frames the pair the same way whatever view it showed before
    const P2 = cached('socks-v4-pair', () => pairGeos(G));
    item.add(P2.body, sides.map(sd => sd.knit));
    item.add(P2.inner, sides.map(sd => sd.inside));
    item.painters.push(d2 => {
      for (const sd of sides) paintSock(sd.cv.getContext('2d'), sd.cv.width, sd.cv.height, d2, G, sd.flip);
      const sh = shade(d2.primary, 0.3);
      for (const sd of sides) {
        sd.knit.sheenColor.set(sh).multiplyScalar(0.45);
        // inside of the sock: same yarn, in its own shade (the lip and wall never pick up stripes or prints)
        sd.inside.color.set(shade(d2.primary, -0.3)); sd.inside.sheenColor.set(sh).multiplyScalar(0.25);
      }
    });
    Object.assign(item, { yaw: -0.08, heroYaw: -0.18, elev: 0.14, fit: 1.1 });
  }

  return {
    shapes: ['socks'],
    builders: { socks: buildSocks },
    defaults: {},
    meta: {},
  };
}
