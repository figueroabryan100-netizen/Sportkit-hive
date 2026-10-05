// SquadForge gear module: footwear (football boots and lifestyle trainers).
// Original procedural models, no real brand marks. Loaded by gear3d.js through GEAR_MODULES.
//
// Right shoe, toe along +X, lateral side faces +Z, ground at y = 0.
// The upper is lofted from cross sections of a shoe last: section s (0 heel .. 1 toe) is a
// superellipse arch standing on the footbed, cut open at the collar line behind the throat.
// Texture space of the upper: u = s, v = arc position on the wall (lateral half on top of
// the canvas, medial half mirrored below), so panels, prints and the baked relief share one map.

export default function footwear(K) {
  const { THREE, PI, V, lerp, clamp, smooth, spow, spline, grid, tube, mergeGeos, placeGeo, cached, paintPattern, drawText, lum, shade, mix, applySurfaceFinish } = K;
  const C = (k, fn) => cached('fw3:' + k, fn);
  const col = c => new THREE.Color(c);
  const N2 = (a, b = a) => new THREE.Vector2(a, b);
  const ink = c => (lum(c) > 0.36 ? '#10141c' : '#ffffff');
  const label = d => d.text || d.chest || d.name || '';

  /* ---------------------------------------------------------------- */
  /* specs (1 unit ~ 115 mm)                                          */
  /* ---------------------------------------------------------------- */
  const SPEC = {
    sneaker: {
      x0: -1.25, x1: 1.25,
      wL: [[0, 0.29], [0.12, 0.3], [0.3, 0.31], [0.45, 0.335], [0.62, 0.405], [0.74, 0.42], [0.86, 0.39], [0.93, 0.34], [1, 0.3]],
      wM: [[0, 0.28], [0.12, 0.29], [0.3, 0.285], [0.45, 0.28], [0.62, 0.375], [0.74, 0.4], [0.86, 0.395], [0.93, 0.37], [1, 0.33]],
      capH: 0.12, capTL: 0.15, capTM: 0.13, capTH: 0.13, toeK: 0.36,
      zc: s => -0.04 * smooth(0.55, 1, s),
      yb: [[0, 0.265], [0.2, 0.258], [0.45, 0.215], [0.62, 0.18], [0.78, 0.172], [0.9, 0.19], [1, 0.225]],
      ground: s => 0.035 * Math.pow(smooth(0.12, 0, s), 2) + 0.1 * Math.pow(smooth(0.66, 1, s), 1.7),
      yTop: [[0, 1.08], [0.2, 1.07], [0.36, 0.93], [0.48, 0.82], [0.6, 0.72], [0.72, 0.64], [0.82, 0.595], [0.9, 0.58], [0.96, 0.57], [1, 0.56]],
      rim: [[0, 0.9], [0.04, 0.885], [0.12, 0.77], [0.2, 0.725], [0.27, 0.765], [0.32, 0.84]],
      sT: 0.36, sL: 0.69, fe: 0.36, chDepth: 0.03,
      p: 0.8, q: 0.86,
      taper: [[0, 0.16], [0.3, 0.26], [0.5, 0.3], [0.7, 0.2], [0.85, 0.12], [1, 0.08]],
      lean: (s, h) => (1 - smooth(0, 0.22, s)) * (-0.035 * Math.sin(PI * clamp(h / 0.4, 0, 1)) + 0.08 * smooth(0.32, 0.62, h)),
      sole: { tO: 0.04, wrap: [[0, 0.1], [0.1, 0.095], [0.28, 0.045], [0.5, 0.024], [0.75, 0.026], [0.92, 0.042], [1, 0.06]], delta: [[0, 0.045], [0.3, 0.032], [0.5, 0.026], [0.75, 0.034], [1, 0.03]], flare: 0.024, groove: 0.02, rb: 0.03, rt: 0.02 },
      laces: { n: 6, r: 0.021, flat: 0.42, s0: 0.395, s1: 0.65, f: 0.52 },
      tongue: { top: 1.03, w: 0.15, th: 0.045 },
      collarR: 0.042,
    },
    cleat: {
      x0: -1.25, x1: 1.25,
      wL: [[0, 0.27], [0.12, 0.28], [0.3, 0.29], [0.45, 0.31], [0.62, 0.37], [0.74, 0.385], [0.86, 0.36], [1, 0.3]],
      wM: [[0, 0.265], [0.12, 0.27], [0.3, 0.26], [0.45, 0.25], [0.62, 0.34], [0.74, 0.37], [0.86, 0.36], [1, 0.33]],
      capH: 0.11, capTL: 0.22, capTM: 0.19, capTH: 0.15, toeK: 0.3,
      zc: s => -0.04 * smooth(0.55, 1, s),
      yb: [[0, 0.175], [0.2, 0.17], [0.45, 0.16], [0.62, 0.15], [0.78, 0.15], [0.9, 0.17], [1, 0.215]],
      ground: s => 0.125 + 0.015 * Math.pow(smooth(0.1, 0, s), 2) + 0.07 * Math.pow(smooth(0.7, 1, s), 1.8),
      yTop: [[0, 0.9], [0.2, 0.88], [0.36, 0.7], [0.48, 0.59], [0.6, 0.5], [0.72, 0.43], [0.84, 0.39], [0.94, 0.35], [1, 0.32]],
      rim: [[0, 0.64], [0.05, 0.62], [0.13, 0.55], [0.21, 0.53], [0.28, 0.57], [0.32, 0.62]],
      sT: 0.36, sL: 0.7, fe: 0.3, chDepth: 0.012,
      p: 0.66, q: 0.86,
      taper: [[0, 0.14], [0.3, 0.24], [0.5, 0.28], [0.7, 0.2], [0.85, 0.12], [1, 0.08]],
      lean: (s, h) => (1 - smooth(0, 0.22, s)) * (-0.03 * Math.sin(PI * clamp(h / 0.3, 0, 1)) + 0.06 * smooth(0.25, 0.5, h)),
      sole: { tO: 0, wrap: [[0, 0.12], [0.1, 0.1], [0.24, 0.025], [0.4, 0.012], [1, 0.012]], delta: [[0, 0.016], [1, 0.012]], flare: 0.004, groove: 0, rb: 0.012, rt: 0.008 },
      laces: { n: 6, r: 0.017, flat: 0.4, s0: 0.405, s1: 0.665, f: 0.42 },
      sock: { top: 1.06, xa: -0.93, rx: 0.33, rz: 0.27 },
      collarR: 0.03,
    },
  };

  /* ---------------------------------------------------------------- */
  /* the last                                                          */
  /* ---------------------------------------------------------------- */
  function model(kind) {
    return C('model|' + kind, () => {
      const S = SPEC[kind];
      const WL = spline(S.wL), WM = spline(S.wM), YB = spline(S.yb), YT = spline(S.yTop), TP = spline(S.taper), RIM = spline(S.rim);
      const cap = (s, tc) => {
        let k = 1;
        if (s < S.capH) { const t = 1 - s / S.capH; k *= Math.sqrt(Math.max(0, 1 - t * t)); }
        if (s > 1 - tc) { const t = (s - 1 + tc) / tc; k *= Math.sqrt(Math.max(0, 1 - t * t)); }
        return k;
      };
      const X = s => lerp(S.x0, S.x1, s);
      const sOfX = x => (x - S.x0) / (S.x1 - S.x0);
      const sec = s => {
        const yb = YB(s);
        let H = YT(s) - yb;
        if (s > 1 - S.capTH) { const t = (s - 1 + S.capTH) / S.capTH; H *= S.toeK + (1 - S.toeK) * Math.sqrt(Math.max(0, 1 - t * t)); }
        return { s, x: X(s), yb, H, wl: WL(s) * cap(s, S.capTL), wm: WM(s) * cap(s, S.capTM), tp: TP(s), zc: S.zc(s) };
      };
      const chan = s => S.chDepth * smooth(S.sT - 0.03, S.sT + 0.05, s) * (1 - smooth(S.sL - 0.05, S.sL + 0.02, s));
      // phi in [0, pi]: 0 lateral footbed edge, pi/2 top centre, pi medial footbed edge
      const pt = (R, phi, out = V(), noChan) => {
        const c = Math.cos(phi), sn = Math.max(0, Math.sin(phi));
        const yf = Math.pow(sn, S.q), f = spow(c, S.p);
        const w = c >= 0 ? R.wl : R.wm;
        const z = R.zc + w * f * (1 - R.tp * yf * yf);
        let y = R.yb + R.H * yf;
        if (!noChan) { const dc = chan(R.s); if (dc) y -= dc * (1 - smooth(S.fe - 0.1, S.fe + 0.02, Math.abs(f))); }
        return out.set(R.x + S.lean(R.s, y - R.yb), y, z);
      };
      // arc tables (fraction A from footbed edge 0 to top centre 1) for one side of a section
      const arcTab = (R, lat) => {
        const n = 64, L = new Float32Array(n + 1), a = V(), b = V();
        for (let i = 0; i <= n; i++) {
          const ph = lat ? i / n * PI / 2 : PI - i / n * PI / 2;
          pt(R, ph, b, true); b.x = 0;
          L[i] = i ? L[i - 1] + b.distanceTo(a) : 0; a.copy(b);
        }
        const tot = L[n] || 1e-6;
        for (let i = 0; i <= n; i++) L[i] /= tot;
        return {
          A: phi => { const t = clamp((lat ? phi : PI - phi) / (PI / 2), 0, 1) * n, i = Math.min(n - 1, Math.floor(t)); return lerp(L[i], L[i + 1], t - i); },
          phi: A => { let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] < A) lo = m; else hi = m; } const t = (A - L[lo]) / ((L[hi] - L[lo]) || 1); const p = (lo + t) / n * PI / 2; return lat ? p : PI - p; },
        };
      };
      // collar cut: fraction of the arch height kept at section s
      const rimF = R => {
        const s = R.s;
        if (s >= S.sT) return 1;
        const fa = clamp((RIM(Math.min(s, S.rim[S.rim.length - 1][0])) - R.yb) / R.H, 0, 1);
        const t = clamp((s - (S.sT - 0.12)) / 0.12, 0, 1);
        return clamp(lerp(fa, 1, t * t), 0, 1);
      };
      const phiC = R => { const f = rimF(R); return f >= 1 ? PI / 2 : Math.asin(Math.pow(f, 1 / S.q)); };
      // point on the closed top at across fraction f in [-1, 1] (+ lateral)
      const topAt = (s, f, out = V()) => pt(sec(s), Math.acos(clamp(spow(f, 1 / S.p), -1, 1)), out);
      // wall z of the upper at height y on the vertical slice through x (no channel); null outside
      const wallZ = (x, y, lat) => {
        const xa = s => sec(s).x + S.lean(s, y - YB(s));
        if (x < xa(0) || x > xa(1)) return null;
        let lo = 0, hi = 1;
        for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (xa(m) < x) lo = m; else hi = m; }
        const R = sec((lo + hi) / 2), yf = clamp((y - R.yb) / R.H, 0, 1);
        const c = Math.cos(Math.asin(Math.pow(yf, 1 / S.q)));
        const w = lat ? R.wl : -R.wm;
        return R.zc + w * Math.pow(c, S.p) * (1 - R.tp * yf * yf);
      };
      return { S, kind, X, sOfX, sec, pt, arcTab, rimF, phiC, topAt, chan, wallZ, YB, ground: S.ground };
    });
  }

  /* ---------------------------------------------------------------- */
  /* geometry                                                          */
  /* ---------------------------------------------------------------- */
  const NW = 42, NB = 6, NU = 2 * NW + NB, NV = 116;
  const sOfV = v => lerp(v, 0.5 - 0.5 * Math.cos(PI * v), 0.55);
  // texture v of the upper for arc fraction A (lateral above the middle, medial mirrored below)
  const texV = (A, lat) => (lat ? 0.53 + 0.47 * A : 0.47 - 0.47 * A);

  function upperRows(M) {
    return C('rows|' + M.kind, () => {
      const rows = [];
      for (let j = 0; j <= NV; j++) {
        const R = M.sec(sOfV(j / NV));
        const tl = M.arcTab(R, true), tm = M.arcTab(R, false), pc = M.phiC(R);
        rows.push({ R, tl, tm, pc, aL: tl.A(pc), aM: tm.A(PI - pc) });
      }
      return rows;
    });
  }
  // rim (collar edge) at s on one side
  function rimPt(M, s, lat, out = V()) { const R = M.sec(s), pc = M.phiC(R); return M.pt(R, lat ? pc : PI - pc, out); }

  function buildUpper(M) {
    const rows = upperRows(M), S = M.S;
    return grid(NU, NV, (u, v, t) => {
      const i = Math.round(u * NU), j = Math.round(v * NV), W = rows[j], R = W.R;
      if (i <= NW) { // medial wall: rim -> footbed
        const A = W.aM * (1 - i / NW);
        M.pt(R, W.tm.phi(A), t);
        return [R.s, texV(A, false)];
      }
      if (i >= NW + NB) { // lateral wall: footbed -> rim
        const A = W.aL * ((i - NW - NB) / NW);
        M.pt(R, W.tl.phi(A), t);
        return [R.s, texV(A, true)];
      }
      const k = (i - NW) / NB; // hidden underside, tucked into the sole
      const zm = R.zc - R.wm * 0.96, zl = R.zc + R.wl * 0.96;
      t.set(R.x + S.lean(R.s, 0), R.yb - 0.04 * Math.sin(k * PI) - 0.004, lerp(zm, zl, k));
      return [R.s, lerp(0.47, 0.53, k)];
    }, { outward: (u, v, p) => { const R = rows[Math.round(v * NV)].R; return V((p.x - (S.x0 + S.x1) / 2) * 0.15, p.y - (R.yb + R.H * 0.35), p.z - R.zc); } });
  }

  // loop around the collar opening: lateral from the throat back to the heel, then medial forward
  function rimLoop(M, n, sEnd) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const s = sEnd * (1 - i / n); pts.push(rimPt(M, s * 0.9999 + 1e-4, true)); }
    for (let i = 1; i <= n; i++) { const s = sEnd * (i / n); pts.push(rimPt(M, s * 0.9999 + 1e-4, false)); }
    return pts;
  }

  function buildCollar(M) {
    const S = M.S, sEnd = S.sT - 0.015;
    const pts = rimLoop(M, 44, sEnd);
    const n = pts.length, cen = pts.reduce((a, p) => a.add(p), V()).multiplyScalar(1 / n);
    const r0 = S.collarR;
    const rf = v => { const e = Math.min(v, 1 - v); return r0 * (0.16 + 0.84 * smooth(0, 0.2, e)) * (1 + 0.12 * smooth(0.3, 0.5, e)); };
    const cpts = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const T = b.clone().sub(a); T.y = 0; T.normalize();
      let nin = V(-T.z, 0, T.x); if (nin.dot(cen.clone().sub(p).setY(0)) < 0) nin.negate();
      const r = rf(i / (n - 1));
      return p.clone().addScaledVector(nin, r * 0.3).add(V(0, -r * 0.2, 0));
    });
    return tube(cpts, { seg: 150, radial: 16, rFn: rf });
  }

  function tongueSweep(pts, T) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const nv = 48, nu = 28, P = [];
    for (let j = 0; j <= nv; j++) P.push(curve.getPointAt(j / nv));
    const F = K.pathFrames(P, V(0, 1, 0));
    const g = grid(nu, nv, (u, v, t) => {
      const j = Math.round(v * nv), a = u * PI * 2;
      const e = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, v - 0.88) / 0.12, 2)));
      const w = T.w * (0.94 + 0.06 * smooth(0, 0.5, v) - 0.1 * smooth(0.55, 1, v)) * Math.max(0.05, Math.pow(e, 0.5));
      const th = T.th * (0.36 + 0.64 * smooth(0.22, 0.6, v)) * Math.max(0.05, e);
      const cb = Math.cos(a), sb = Math.sin(a);
      const bx = w * spow(cb, 0.35), nx = th * 0.5 * spow(sb, 0.7) - 0.075 * Math.pow(bx / T.w, 2) * smooth(0.12, 0.5, v);
      t.copy(P[j]).addScaledVector(F.N[j], nx).addScaledVector(F.B[j], bx);
      return [0.5 + 0.5 * spow(cb, 0.3), v];
    }, { outward: (u, v, p) => p.clone().sub(P[Math.round(v * nv)]) });
    return g;
  }

  // laces: criss-cross between eyelet pairs on the eyestays, plus a bar at the toe end
  function buildLaces(M) {
    const S = M.S, L = S.laces, parts = [], eyes = [];
    const ss = []; for (let i = 0; i < L.n; i++) ss.push(lerp(L.s1, L.s0, i / (L.n - 1)));
    const eye = (i, lat) => ({ s: ss[i], f: (lat ? 1 : -1) * L.f * (1 - 0.1 * i / (L.n - 1)) });
    const seg = (a, b, over) => {
      const pa = M.topAt(a.s, a.f), pb = M.topAt(b.s, b.f), pts = [];
      const N = 14;
      for (let k = 0; k <= N; k++) {
        const t = k / N, s = lerp(a.s, b.s, t), f = lerp(a.f, b.f, t);
        const surf = M.topAt(s, f);
        const lin = pa.clone().lerp(pb, t);
        const arch = Math.sin(PI * t);
        const tg = S.tongue ? 0.012 * (1 - smooth(S.tongue.w * 0.7, S.tongue.w * 1.0, Math.abs(surf.z - S.zc(s)))) : 0;
        const y = Math.max(lin.y + (0.012 + 0.02 * arch) + (over ? 0.012 * arch : 0), surf.y + tg + L.r * 0.6 + (over ? 0.012 * arch : 0) + 0.004);
        const yEnd = surf.y + L.r * 0.35;
        const e = smooth(0, 0.12, Math.min(t, 1 - t));
        pts.push(V(surf.x, lerp(yEnd, y, e), surf.z));
      }
      const dir = pb.clone().sub(pa); dir.y = 0; dir.normalize();
      const up = V(-dir.z, 0, dir.x);
      parts.push(tube(pts, { radius: L.r, flat: L.flat, seg: 28, radial: 8, up }));
    };
    seg(eye(0, true), eye(0, false), false);
    for (let i = 0; i < L.n - 1; i++) { seg(eye(i, true), eye(i + 1, false), true); seg(eye(i, false), eye(i + 1, true), false); }
    for (let i = 0; i < L.n; i++) for (const lat of [true, false]) {
      const e = eye(i, lat), p = M.topAt(e.s, e.f), q = M.topAt(e.s, e.f + (lat ? 0.02 : -0.02));
      const nrm = V(0, 1, 0).add(V(0, 0, (lat ? 1 : -1) * 0.35)).normalize();
      const g = new THREE.TorusGeometry(L.r * 1.25, L.r * 0.38, 6, 14); g.rotateX(PI / 2);
      placeGeo(g, p.clone().addScaledVector(nrm, 0.002), nrm); eyes.push(g);
      void q;
    }
    const laces = mergeGeos(parts); parts.forEach(g => g.dispose());
    const eyelets = mergeGeos(eyes); eyes.forEach(g => g.dispose());
    return { laces, eyelets, ss, eye };
  }

  // offset outline (plan) of the footbed: lateral max z / medial min z at x, offset by delta(s)
  function planOffset(M, deltaFn) {
    const n = 400, xs = [], zl = [], zm = [], dl = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n, R = M.sec(s);
      xs.push(R.x); zl.push(R.zc + R.wl); zm.push(R.zc - R.wm); dl.push(deltaFn(s));
    }
    const x0 = xs[0] - dl[0], x1 = xs[n] + dl[n];
    const at = x => {
      let L = -9, Mm = 9, zc = 0;
      for (let i = 0; i <= n; i++) {
        const dx = x - xs[i], d = dl[i];
        if (Math.abs(dx) >= d) continue;
        const h = Math.sqrt(d * d - dx * dx);
        if (zl[i] + h > L) L = zl[i] + h;
        if (zm[i] - h < Mm) Mm = zm[i] - h;
      }
      if (L < -8) { zc = M.S.zc(clamp(M.sOfX(x), 0, 1)); return { L: zc, M: zc }; }
      return { L, M: Mm };
    };
    return { x0, x1, at };
  }

  // sole unit: closed rounded sections along x. kind 'mid' (midsole / plate) or 'out' (outsole)
  function buildSole(M, part) {
    const S = M.S, SO = S.sole, WR = spline(SO.wrap), DL = spline(SO.delta);
    const plan = planOffset(M, s => DL(s) + (part === 'out' ? 0.006 : 0));
    const out = part === 'out', NX = out ? 84 : 92, nB = out ? 4 : 5, nC = out ? 4 : 6, nW = out ? 3 : 12, nT = out ? 3 : 6, nI = out ? 3 : 7, half = nB + nC + nW + nT + nI, NUs = half * 2;
    const xOf = v => lerp(plan.x0, plan.x1, lerp(v, 0.5 - 0.5 * Math.cos(PI * v), 0.6));
    const secs = [];
    for (let j = 0; j <= NX; j++) {
      const x = xOf(j / NX), s = clamp(M.sOfX(x), 0, 1), o = plan.at(x);
      const g = M.ground(s), yb = M.YB(s), zc = (o.L + o.M) / 2;
      const hw = Math.max(0, (o.L - o.M) / 2);
      const y0 = part === 'out' ? g : g + SO.tO;
      const yLip = part === 'out' ? g + SO.tO + 0.012 + 0.05 * smooth(0.86, 1, s) * (SO.tO ? 1 : 0) : yb + WR(s);
      const loop = [];
      for (const lat of [true, false]) {
        const sg = lat ? 1 : -1, zT = lat ? o.L : o.M;
        const fl = SO.flare;
        const zB = zT + sg * fl * Math.min(1, hw / 0.1);
        const rb = Math.min(SO.rb, hw * 0.45 + 1e-4), rt = Math.min(SO.rt, hw * 0.3 + 1e-4);
        const P = [];
        for (let i = 0; i < nB; i++) P.push([zc + (zB - sg * rb - zc) * i / nB, y0, 0]);
        for (let i = 0; i < nC; i++) { const a = -PI / 2 + i / nC * PI / 2; P.push([zB - sg * rb + sg * rb * Math.cos(a), y0 + rb + rb * Math.sin(a), 1]); }
        for (let i = 0; i < nW; i++) {
          const t = i / nW, y = lerp(y0 + rb, yLip - rt, t);
          const kw = Math.min(1, hw / 0.15), gr = part === 'out' ? 0 : (SO.groove * Math.exp(-Math.pow((t - 0.3) / 0.06, 2)) - SO.groove * 0.9 * Math.sin(PI * t)) * kw;
          P.push([lerp(zB, zT, t) - sg * gr, y, 2]);
        }
        for (let i = 0; i < nT; i++) { const a = i / nT * PI / 2; P.push([zT - sg * rt + sg * rt * Math.cos(a), yLip - rt + rt * Math.sin(a), 3]); }
        // inner: hug the upper wall (just outside it) down to below the footbed, then to the centre
        const zLipIn = zT - sg * rt;
        for (let i = 0; i < nI; i++) {
          const t = i / (nI - 1);
          let y, z;
          if (part === 'out') { y = lerp(yLip, y0 + 0.01, t); z = lerp(zLipIn, zc, smooth(0, 1, t)); }
          else {
            const yy = lerp(yLip, yb - 0.025, Math.min(1, t * 1.25));
            const wz = M.wallZ(x, yy, lat);
            let zi = wz == null ? zc : wz + sg * 0.004;
            if (sg * (zi - zLipIn) > -0.002) zi = zLipIn - sg * 0.002;
            if (sg * (zi - zc) < 0) zi = zc;
            y = yy; z = t < 0.8 ? zi : lerp(zi, zc, (t - 0.8) / 0.2);
          }
          P.push([z, y, 4]);
        }
        loop.push(lat ? P : P.reverse());
      }
      secs.push({ x, s, pts: [...loop[0], ...loop[1]] });
    }
    // uv: u along x; v by band (lateral 0..0.5 bottom->top, medial mirrored)
    const vBand = [0, 0.1, 0.16, 0.4, 0.46, 0.5];
    const g = grid(NUs, NX, (u, v, t) => {
      const i = Math.round(u * NUs) % NUs, j = Math.round(v * NX), sc = secs[j];
      const p = sc.pts[i];
      t.set(sc.x, p[1], p[0]);
      // band v
      let k = i < half ? i : NUs - i; // index from bottom centre
      if (Math.round(u * NUs) === NUs) k = 0;
      const cnt = [nB, nC, nW, nT, nI]; let b = 0, kk = k; while (b < 4 && kk >= cnt[b]) { kk -= cnt[b]; b++; }
      const vv = lerp(vBand[b], vBand[b + 1], kk / cnt[b]);
      return [(sc.x - plan.x0) / (plan.x1 - plan.x0), i < half && Math.round(u * NUs) !== NUs ? 0.5 - vv : 0.5 + vv];
    }, { outward: (u, v, p) => { const sc = secs[Math.round(v * NX)]; const yc = (sc.pts[0][1] + sc.pts[half][1]) / 2; return V(0, p.y - yc, p.z - (sc.pts[0][0])); } });
    // the end sections collapse onto a vertical line: give them the neighbouring normals turned outward
    const nrm = g.attributes.normal, cols = NUs + 1, n = V();
    for (const [j, jn, sg] of [[0, 1, -1], [NX, NX - 1, 1]]) for (let i = 0; i < cols; i++) {
      n.fromBufferAttribute(nrm, jn * cols + i); n.set(sg * Math.max(0.6, Math.abs(n.x)), n.y, n.z * 0.35).normalize();
      nrm.setXYZ(j * cols + i, n.x, n.y, n.z);
    }
    nrm.needsUpdate = true;
    return { g, plan, vBand };
  }

  function buildInsole(M) {
    const S = M.S;
    return grid(20, 40, (u, v, t) => {
      const s = lerp(0.005, S.sT + 0.12, v), R = M.sec(s);
      const z = lerp(R.zc - R.wm * 0.96, R.zc + R.wl * 0.96, u);
      t.set(R.x + S.lean(s, 0.02), R.yb + 0.018 + 0.012 * Math.pow(Math.abs(u * 2 - 1), 3), z);
      return [u, v];
    }, { outward: () => V(0, 1, 0) });
  }

  function buildTab(M) {
    const S = M.S, R = M.sec(0), pc = M.phiC(R), top = M.pt(R, pc);
    const bx = top.x;
    const pts = [V(bx + 0.06, top.y - 0.08, R.zc), V(bx + 0.03, top.y + 0.02, R.zc), V(bx - 0.015, top.y + 0.06, R.zc), V(bx - 0.055, top.y + 0.02, R.zc), V(bx - 0.055, top.y - 0.1, R.zc)];
    return K.sweep(pts, 16, 30, (v, a) => [Math.sin(a) * 0.008, Math.cos(a) * 0.036], { up: V(1, 0, 0) });
  }

  // knit sock collar (boots): lofted from the rim loop up to an ankle ring
  function buildSock(M) {
    const S = M.S, SK = S.sock, sEnd = S.sT - 0.004;
    const base = rimLoop(M, 60, sEnd);
    // resample by arc length so the ring has even spacing
    const n = 120, cl = [0];
    for (let i = 1; i < base.length; i++) cl.push(cl[i - 1] + base[i].distanceTo(base[i - 1]));
    const tot = cl[cl.length - 1];
    const ring = [];
    for (let k = 0; k <= n; k++) {
      const d = k / n * tot; let i = 1; while (i < cl.length - 1 && cl[i] < d) i++;
      const t = (d - cl[i - 1]) / ((cl[i] - cl[i - 1]) || 1);
      ring.push(base[i - 1].clone().lerp(base[i], t));
    }
    const zc = S.zc(0.2);
    // wall direction at the rim (continuity with the upper)
    const dirs = ring.map(p => {
      const s = clamp(M.sOfX(p.x), 0, 1), lat = p.z > zc;
      const R = M.sec(Math.min(s, sEnd)), pc = M.phiC(R), ph = lat ? pc : PI - pc;
      const a = M.pt(R, ph), b = M.pt(R, lat ? ph - 0.08 : ph + 0.08);
      return a.sub(b).normalize().lerp(V(-0.35, 1, 0).normalize(), smooth(S.sT - 0.16, S.sT, s)).normalize();
    });
    // outward wall normals at the rim: the knit collar laps over the upper instead of cutting through it
    const cen = ring.reduce((a, p) => a.add(p), V()).multiplyScalar(1 / ring.length);
    const outs = ring.map((p, k) => {
      const a = ring[(k + 1) % n].clone().sub(ring[(k + n - 1) % n]);
      const o = a.cross(dirs[k]).normalize();
      const h = p.clone().sub(cen); h.y = 0;
      return o.dot(h) < 0 ? o.negate() : o;
    });
    const NVk = 28;
    return grid(n, NVk, (u, v, t) => {
      const k = Math.round(u * n) % n, p0 = ring[k].clone().addScaledVector(dirs[k], -0.035).addScaledVector(outs[k], 0.006);
      const ang = Math.atan2(p0.z - zc, (p0.x - SK.xa) * 0.85);
      const back = Math.max(0, -Math.cos(ang));
      const p3 = V(SK.xa + Math.cos(ang) * SK.rx, SK.top + 0.04 * back - 0.02 * Math.max(0, Math.cos(ang)), zc + Math.sin(ang) * SK.rz);
      const p1 = p0.clone().addScaledVector(dirs[k], 0.14);
      const p2 = p3.clone().add(V(0, -0.16, 0));
      const tt = v, m = 1 - tt;
      t.copy(p0).multiplyScalar(m * m * m).addScaledVector(p1, 3 * m * m * tt).addScaledVector(p2, 3 * m * tt * tt).addScaledVector(p3, tt * tt * tt);
      return [u, v];
    }, { outward: (u, v, p) => V(p.x - SK.xa, 0, p.z - zc) });
  }
  function sockTopRing(M) {
    const S = M.S, SK = S.sock, zc = S.zc(0.2);
    return K.loopBand(a => {
      const ang = a * PI * 2, back = Math.max(0, -Math.cos(ang));
      const p = V(SK.xa + Math.cos(ang) * SK.rx, SK.top + 0.04 * back - 0.02 * Math.max(0, Math.cos(ang)), zc + Math.sin(ang) * SK.rz);
      return { p, out: V(Math.cos(ang) / SK.rx, 0, Math.sin(ang) / SK.rz).normalize(), ax: V(0, 1, 0) };
    }, { width: 0.05, thick: 0.03, seg: 120, prof: 12, ribs: 0, inset: 0.6, axOff: -0.012 });
  }

  // studs: conical and bladed, with a root fillet and rounded tips
  function studGeo(len, wid, h, ex) {
    return grid(22, 10, (u, v, t) => {
      const a = u * PI * 2, c = Math.cos(a), s = Math.sin(a);
      const k = lerp(1, 0.62, v) * (1 + 0.22 * Math.pow(1 - smooth(0, 0.22, v), 2));
      const tip = v > 0.84 ? Math.sqrt(Math.max(0, 1 - Math.pow((v - 0.84) / 0.16, 2))) : 1;
      const y = -v * h;
      t.set(len / 2 * spow(c, ex) * k * tip, y + 0.012, wid / 2 * spow(s, ex) * k * tip);
      return [u, v];
    }, { outward: (u, v, p) => V(p.x, -0.2, p.z) });
  }
  function buildStuds(M, plan) {
    const S = M.S;
    const L = [ // [s, across f (+lat), type, angle]
      [0.06, 0.55, 'c', 0], [0.06, -0.55, 'c', 0], [0.19, 0.6, 'b', -0.5], [0.19, -0.6, 'b', 0.5],
      [0.57, 0.74, 'b', -0.25], [0.57, -0.72, 'b', 0.25], [0.7, 0.76, 'b', 0.1], [0.7, -0.74, 'b', -0.1],
      [0.82, 0.62, 'b', 0.45], [0.82, -0.62, 'b', -0.45], [0.66, 0.0, 'c', 0], [0.92, -0.15, 'c', 0],
    ];
    const parts = L.map(([s, f, ty, ang]) => {
      const x = M.X(s), o = plan.at(x), zc = (o.L + o.M) / 2, hw = (o.L - o.M) / 2;
      const y = M.ground(s);
      const h = Math.max(0.05, y - 0.006);
      const g = ty === 'c' ? studGeo(0.085, 0.085, h, 1) : studGeo(0.15, 0.06, h, 0.7);
      if (ang) g.rotateY(ang);
      g.translate(x, y, zc + f * hw * 0.9);
      return g;
    });
    const out = mergeGeos(parts); parts.forEach(g => g.dispose()); return out;
  }

  function geos(kind) {
    return C('geo|' + kind, () => {
      const M = model(kind), S = M.S;
      const out = { M };
      out.upper = buildUpper(M);
      const L = buildLaces(M); out.laces = L.laces; out.eyelets = L.eyelets; out.laceInfo = L;
      const mid = buildSole(M, 'mid'); out.sole = mid.g; out.solePlan = mid.plan;
      if (S.sole.tO) out.outsole = buildSole(M, 'out').g;
      out.insole = buildInsole(M);
      if (S.tongue) { out.tongue = tongueSweep(tonguePts(M), S.tongue); out.collar = buildCollar(M); out.tab = buildTab(M); }
      if (S.sock) { out.sock = buildSock(M); out.sockTop = sockTopRing(M); out.studs = buildStuds(M, mid.plan); }
      let tri = 0; for (const k in out) if (out[k] && out[k].isBufferGeometry) tri += (out[k].index ? out[k].index.count : out[k].attributes.position.count) / 3;
      out.tris = tri;
      return out;
    });
  }
  function tonguePts(M) {
    const S = M.S, T = S.tongue, sT = S.sT;
    const lift = 0.012;
    const chanPt = s => M.topAt(s, 0).add(V(0, lift, 0));
    const pA = chanPt(sT + 0.16), pB = chanPt(sT + 0.08), pC = chanPt(sT + 0.01);
    return [pA, pB, pC, V(M.X(sT - 0.035), pC.y + 0.06, pC.z), V(M.X(sT - 0.065), lerp(pC.y + 0.06, T.top, 0.6), pC.z), V(M.X(sT - 0.075), T.top, pC.z)];
  }

  /* ---------------------------------------------------------------- */
  /* panels in (s, A) texture space                                    */
  /* ---------------------------------------------------------------- */
  function rimTable(M) {
    return C('rimtab|' + M.kind, () => {
      const n = 200, L = [], Mm = [], ch = [], ey = [];
      for (let i = 0; i <= n; i++) {
        const R = M.sec(i / n), tl = M.arcTab(R, true), tm = M.arcTab(R, false), pc = M.phiC(R);
        L.push(tl.A(pc)); Mm.push(tm.A(PI - pc));
        const ph = f => Math.acos(clamp(spow(f, 1 / M.S.p), -1, 1));
        ch.push(tl.A(ph(M.S.fe))); ey.push(tl.A(ph(M.S.laces.f + 0.2)));
      }
      const look = arr => s => { const t = clamp(s, 0, 1) * n, i = Math.min(n - 1, Math.floor(t)); return lerp(arr[i], arr[i + 1], t - i); };
      // height above the footbed -> arc fraction A (lateral wall), tabulated per section
      const nh = 48, HA = [];
      for (let i = 0; i <= n; i++) {
        const R = M.sec(i / n), tl = M.arcTab(R, true), row = [];
        for (let k = 0; k <= nh; k++) { const ph = k / nh * PI / 2, p = M.pt(R, ph, V(), true); row.push([p.y - R.yb, tl.A(ph)]); }
        HA.push(row);
      }
      const aOfH1 = (row, h) => {
        if (h <= 0) return h / Math.max(0.05, row[nh][0]);
        if (h >= row[nh][0]) return 1 + (h - row[nh][0]) * 2;
        let k = 1; while (k < nh && row[k][0] < h) k++;
        const [h0, a0] = row[k - 1], [h1, a1] = row[k];
        return lerp(a0, a1, (h - h0) / ((h1 - h0) || 1));
      };
      const aOfH = (s, h) => { const t = clamp(s, 0, 1) * n, i = Math.min(n - 1, Math.floor(t)); return lerp(aOfH1(HA[i], h), aOfH1(HA[i + 1], h), t - i); };
      return { rimL: look(L), rimM: look(Mm), chan: look(ch), eyeLo: look(ey), aOfH };
    });
  }
  // smooth closed path through points via midpoint quadratics
  function smoothPath(c, pts, closed = true) {
    const n = pts.length;
    c.beginPath();
    if (!closed) { c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < n - 1; i++) { const m = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]; c.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); } c.lineTo(pts[n - 1][0], pts[n - 1][1]); return; }
    const mid = i => [(pts[i % n][0] + pts[(i + 1) % n][0]) / 2, (pts[i % n][1] + pts[(i + 1) % n][1]) / 2];
    const m0 = mid(n - 1); c.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) { const m = mid(i); c.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
    c.closePath();
  }
  // panel list per kind; each: pts in (s, A) with optional 'sharp' flag, role
  function panels(M) {
    return C('panels|' + M.kind, () => {
      const RT = rimTable(M), S = M.S, out = [];
      const samp = (f, a, b, n = 24) => { const r = []; for (let i = 0; i <= n; i++) { const s = lerp(a, b, i / n); r.push([s, f(s)]); } return r; };
      if (M.kind === 'sneaker') {
        // mudguard wrapping the toe
        out.push({ id: 'mud', role: 'over', h: true, cover: 0.955, pts: [[0.44, -0.08], [0.47, 0.055], [0.52, 0.095], ...samp(s => 0.1 + 0.025 * smooth(0.6, 0.95, s), 0.58, 1.0, 16), [1.04, 0.125], [1.04, -0.08]] });
        // heel counter
        out.push({ id: 'heel', role: 'over', h: true, pts: [[-0.05, -0.08], [0.29, -0.08], [0.3, 0.05], [0.27, 0.16], [0.2, 0.28], [0.12, 0.4], [0.06, 0.5], [-0.05, 0.55]] });
        // eyestay strip along the lacing
        out.push({ id: 'eye', role: 'over', pts: [...samp(s => RT.eyeLo(s) - 0.04, S.sT - 0.06, S.sL + 0.025, 20), [S.sL + 0.06, RT.chan(S.sL) + 0.05], [S.sL + 0.04, 1.2], [S.sT - 0.08, 1.2], [S.sT - 0.09, RT.eyeLo(S.sT - 0.06) + 0.05]] });
        // side emblem: forward chevron
        out.push({ id: 'emb', role: 'emblem', sharp: true, pts: [[0.36, 0.24], [0.42, 0.24], [0.5, 0.42], [0.42, 0.6], [0.36, 0.6], [0.44, 0.42]] });
        // heel window band on the counter
        out.push({ id: 'heelband', role: 'accent', sharp: true, pts: [[-0.05, 0.36], [0.17, 0.36], [0.205, 0.43], [-0.05, 0.43]] });
      } else {
        // heel: two tone with a raked edge
        out.push({ id: 'heel', role: 'over', pts: [[-0.05, -0.2], [0.3, -0.2], [0.27, 0.15], [0.2, 0.38], [0.12, 0.6], [0.06, 0.78], [-0.05, 0.84]] });
        // lacing strip
        out.push({ id: 'eye', role: 'over', pts: [...samp(s => RT.eyeLo(s) - 0.02, S.sT - 0.02, S.sL + 0.02, 20), [S.sL + 0.05, RT.chan(S.sL) + 0.04], [S.sL + 0.03, 1.2], [S.sT - 0.04, 1.2]] });
        // long slim emblem: a single raked blade with a fletched tail
        out.push({ id: 'emb', role: 'emblem', sharp: true, pts: [[0.25, 0.2], [0.31, 0.25], [0.27, 0.3], [0.66, 0.44], [0.69, 0.4]] });
        // toe guard: thin skin over the nose (keeps prints clean where the sections converge)
        out.push({ id: 'toe', role: 'toe', h: true, cover: 0.95, pts: [[0.8, -0.08], [0.83, 0.03], [0.88, 0.05], [0.93, 0.06], [0.97, 0.07], [1.04, 0.08], [1.04, -0.08]] });
        // forefoot strike zone (textured)
        out.push({ id: 'zone', role: 'zone', pts: [[0.62, 0.25], [0.8, 0.24], [0.95, 0.3], [1.02, 0.6], [1.02, 1.2], [0.62, 1.2]] });
      }
      return out;
    });
  }

  // canvas helpers: map (s, A, side) -> px
  const mapper = (w, h) => (s, A, lat) => [s * w, (lat ? 0.47 - 0.47 * A : 0.53 + 0.47 * A) * h];
  function panelPath(c, P, pn, lat, RT) {
    const pts = pn.pts.map(([s, A]) => { let a = pn.h ? RT.aOfH(s, A) : A; if (pn.cover && A > 0) a = lerp(a, 1.4, smooth(pn.cover, pn.cover + 0.03, s)); return P(s, a, lat); });
    if (pn.sharp) { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); }
    else smoothPath(c, pts);
  }

  /* ---------------------------------------------------------------- */
  /* baked relief (normal) and roughness maps, per kind (shared)       */
  /* ---------------------------------------------------------------- */
  function reliefMaps(kind) {
    return C('maps|' + kind, () => {
      const M = model(kind), RT = rimTable(M), PN = panels(M), sn = kind === 'sneaker';
      const w = 2048, h = 1024, P = mapper(w, h);
      const hc = document.createElement('canvas'); hc.width = w; hc.height = h;
      const c = hc.getContext('2d');
      // base micro texture
      const tile = document.createElement('canvas'); tile.width = 8; tile.height = 8;
      const tc = tile.getContext('2d'), img = tc.createImageData(8, 8);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        let v;
        if (sn) { // engineered mesh: staggered open cells
          const ox = (x + (y >= 4 ? 4 : 0)) % 8, dx = (ox - 3.5) / 3.5, dy = ((y % 4) - 1.5) / 2;
          v = 120 - 70 * Math.exp(-(dx * dx * 2.2 + dy * dy * 2.2));
        } else { // fine synthetic grain
          v = 128 + 10 * Math.sin(x * 1.7 + y * 2.3) + 8 * Math.cos(y * 3.1 - x);
        }
        const i = (y * 8 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      tc.putImageData(img, 0, 0);
      c.fillStyle = c.createPattern(tile, 'repeat'); c.fillRect(0, 0, w, h);
      // channel (tongue knit) region slightly different
      // overlays: raised plateaus with soft bevel
      const rough = document.createElement('canvas'); rough.width = 512; rough.height = 256;
      const rc = rough.getContext('2d'); const RP = mapper(512, 256);
      rc.fillStyle = sn ? 'rgb(0,215,0)' : 'rgb(0,120,0)'; rc.fillRect(0, 0, 512, 256);
      for (const lat of [true, false]) {
        for (const pn of PN) {
          if (pn.role === 'over' || pn.role === 'emblem' || pn.role === 'toe') {
            c.save(); c.filter = 'blur(2.5px)'; c.fillStyle = pn.role === 'emblem' ? '#d2d2d2' : '#c8c8c8'; panelPath(c, P, pn, lat, RT); c.fill(); c.restore();
            // fine leather grain on the overlay
            c.save(); panelPath(c, P, pn, lat, RT); c.clip(); c.globalAlpha = 0.06; c.fillStyle = '#000';
            for (let k = 0; k < 2500; k++) { const x = Math.random() * w, y = Math.random() * h; c.fillRect(x, y, 2, 2); }
            c.restore();
            // stitching just inside the edge
            if (pn.role === 'over') {
              c.save(); panelPath(c, P, pn, lat, RT); c.clip();
              c.setLineDash([9, 6]); c.lineWidth = 22; c.strokeStyle = '#7a7a7a'; panelPath(c, P, pn, lat, RT); c.stroke();
              c.setLineDash([]); c.lineWidth = 15; c.strokeStyle = '#c8c8c8'; panelPath(c, P, pn, lat, RT); c.stroke();
              c.restore();
            }
            rc.save(); rc.fillStyle = pn.role === 'emblem' ? 'rgb(0,90,0)' : sn ? 'rgb(0,120,0)' : 'rgb(0,95,0)'; panelPath(rc, RP, pn, lat, RT); rc.fill(); rc.restore();
          } else if (pn.role === 'zone') {
            c.save(); panelPath(c, P, pn, lat, RT); c.clip();
            c.fillStyle = '#808080';
            for (let y = 0; y < h; y += 9) for (let x = (y / 9 % 2) * 6; x < w; x += 12) { c.beginPath(); c.arc(x, y, 2.6, 0, PI * 2); c.fillStyle = '#b4b4b4'; c.fill(); }
            c.restore();
          }
        }
        if (sn) { // toe-box perforations
          for (let s = 0.775; s < 0.95; s += 0.016) for (let A = 0.56; A < 0.98; A += 0.06) {
            const [x, y] = P(s + ((Math.round(A / 0.06) % 2) * 0.008), A, lat);
            c.beginPath(); c.arc(x, y, 3.2, 0, PI * 2); c.fillStyle = '#303030'; c.fill();
          }
        }
        // channel floor: soft knit of the tongue
        c.save(); c.beginPath();
        for (let i = 0; i <= 30; i++) { const s = lerp(S0(M), M.S.sL + 0.04, i / 30); const [x, y] = P(s, RT.chan(s) - 0.01, lat); i ? c.lineTo(x, y) : c.moveTo(x, y); }
        { const [x, y] = P(M.S.sL + 0.04, 1.3, lat); c.lineTo(x, y); const [x2, y2] = P(S0(M), 1.3, lat); c.lineTo(x2, y2); }
        c.closePath(); c.fillStyle = '#909090'; c.globalAlpha = 0.6; c.fill(); c.restore();
      }
      // height -> normal
      const src = c.getImageData(0, 0, w, h).data, H = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) H[i] = src[i * 4] / 255;
      const nc = document.createElement('canvas'); nc.width = w; nc.height = h;
      const nctx = nc.getContext('2d'), out = nctx.createImageData(w, h), D = out.data, str = 3.2;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const xl = H[y * w + Math.max(0, x - 1)], xr = H[y * w + Math.min(w - 1, x + 1)];
        const yu = H[Math.max(0, y - 1) * w + x], yd = H[Math.min(h - 1, y + 1) * w + x];
        let nx = (xl - xr) * str, ny = (yd - yu) * str; const l = Math.hypot(nx, ny, 1);
        const i = (y * w + x) * 4;
        D[i] = (nx / l * 0.5 + 0.5) * 255; D[i + 1] = (ny / l * 0.5 + 0.5) * 255; D[i + 2] = (1 / l * 0.5 + 0.5) * 255; D[i + 3] = 255;
      }
      nctx.putImageData(out, 0, 0);
      return { normal: nc, rough };
    });
  }
  const S0 = M => M.S.sT - 0.04;
  // tileable heather noise (grey streaks along the knit rows), shared
  const melange = () => C('melange', () => {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const c = cv.getContext('2d'), img = c.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const v = K.vnoise(x / 4, y / 4, 32) * 0.5 + K.vnoise(x / 2, y / 2, 64) * 0.5;
      const g = v > 0.5 ? 255 : 0, i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = Math.abs(v - 0.5) * 2 * 255;
    }
    c.putImageData(img, 0, 0); return cv;
  });

  /* ---------------------------------------------------------------- */
  /* build                                                             */
  /* ---------------------------------------------------------------- */
  function buildShoe(item, d, kind) {
    const G = geos(kind), M = G.M, S = M.S, sn = kind === 'sneaker';
    const RM = reliefMaps(kind), PN = panels(M), RT = rimTable(M);
    item.shoe = true;
    item.defPatch = { flex: { x0: 0.15, x1: 1.3, amp: 0.06 } };
    const own = cv => { const t = new THREE.CanvasTexture(cv); t.anisotropy = 8; item.texs.push(t); return t; };
    const nmap = own(RM.normal); nmap.colorSpace = THREE.NoColorSpace;
    const rmap = own(RM.rough); rmap.colorSpace = THREE.NoColorSpace;
    const cv = item.canvas(2048, 1024), map = item.tex(cv);
    const upM = item.mat({
      map, normalMap: nmap, normalScale: N2(sn ? 0.9 : 0.6, sn ? -0.9 : -0.6), roughnessMap: rmap, roughness: 1,
      sheen: sn ? 0.7 : 0.25, sheenRoughness: 0.45, sheenColor: col('#555555'), clearcoat: sn ? 0 : 0.5, clearcoatRoughness: 0.3, specularIntensity: 0.7,
    });
    upM.userData.base = { rough: 1, coat: sn ? 0 : 0.5, coatRough: 0.3 };
    const lining = item.mat({ color: col('#1b1d22'), roughness: 0.92, side: THREE.BackSide, sheen: 0.5, sheenColor: col('#333333') });
    item.add(G.upper, upM); item.add(G.upper, lining);
    const insM = item.mat({ color: col('#2a2c31'), roughness: 0.9, sheen: 0.4, sheenColor: col('#444444') });
    item.add(G.insole, insM);
    const laceM = item.mat({ color: col('#ffffff'), roughness: 0.75, sheen: 0.8, sheenColor: col('#777777'), normalMap: item.ntex('rib', 1, 10), normalScale: N2(0.35) });
    item.add(G.laces, laceM);
    const eyeM = item.mat({ color: col('#d9dde4'), metalness: sn ? 0 : 0.9, roughness: sn ? 0.5 : 0.3 });
    item.add(G.eyelets, eyeM);
    const scv = item.canvas(1024, 256), smap = item.tex(scv);
    const soleM = item.mat({ map: smap, roughness: sn ? 0.62 : 0.28, clearcoat: sn ? 0.15 : 0.8, clearcoatRoughness: 0.2, normalMap: item.ntex('grain', 30, 3), normalScale: N2(sn ? 0.12 : 0.05) });
    item.add(G.sole, soleM);
    let outM = null, collarM = null, tongueM = null, tabM = null, sockM = null, sockTopM = null, studM = null, tcv = null;
    if (G.outsole) { outM = item.mat({ color: col('#26272b'), roughness: 0.88, normalMap: item.ntex('knurl', 70, 3), normalScale: N2(0.5) }); item.add(G.outsole, outM); }
    if (G.collar) { collarM = item.mat({ color: col('#ffffff'), roughness: 0.85, sheen: 1, sheenRoughness: 0.5, sheenColor: col('#666666'), normalMap: item.ntex('fuzz', 40, 3), normalScale: N2(0.18) }); item.add(G.collar, collarM); }
    if (G.tongue) {
      tcv = item.canvas(256, 512);
      tongueM = item.mat({ map: item.tex(tcv), roughness: 0.82, sheen: 0.8, sheenRoughness: 0.5, sheenColor: col('#666666'), normalMap: item.ntex('knit', 4, 10), normalScale: N2(0.35) });
      item.add(G.tongue, tongueM);
    }
    if (G.tab) { tabM = item.mat({ color: col('#ffffff'), roughness: 0.7, sheen: 0.6, sheenColor: col('#666666'), normalMap: item.ntex('rib', 6, 1), normalScale: N2(0.4), side: THREE.DoubleSide }); item.add(G.tab, tabM); }
    if (G.sock) {
      sockM = item.mat({ color: col('#ffffff'), roughness: 0.88, sheen: 1, sheenRoughness: 0.55, sheenColor: col('#666666'), normalMap: item.ntex('sock', 10, 4), normalScale: N2(0.6) });
      item.add(G.sock, sockM);
      item.add(G.sock, lining);
      sockTopM = item.mat({ color: col('#ffffff'), roughness: 0.85, sheen: 1, sheenColor: col('#666666'), normalMap: item.ntex('rib', 40, 1), normalScale: N2(0.5) });
      item.add(G.sockTop, sockTopM);
    }
    if (G.studs) { studM = item.mat({ color: col('#ffffff'), roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }); item.add(G.studs, studM); }

    item.painters.push(d2 => {
      const c = cv.getContext('2d'), w = cv.width, h = cv.height, P = mapper(w, h), k = w / 2048;
      const pri = d2.primary, sec2 = d2.secondary, acc = d2.accent;
      const over = sn ? sec2 : sec2;
      const tongueCol = shade(pri, -0.12);
      // base + pattern on the lateral half, mirrored to the medial half (seamless along the top centre)
      const pat = d2.pattern === 'split' ? 'solid' : d2.pattern;
      paintPattern(c, 0, 0, w, h / 2, d2, { unit: w / 2.4, scale: 0.55, pattern: pat });
      if (sn) { // heathered knit: faint yarn-to-yarn tone variation on the base
        const nz = melange();
        c.save(); c.globalAlpha = lum(pri) > 0.5 ? 0.05 : 0.08; c.fillStyle = c.createPattern(nz, 'repeat'); c.fillRect(0, 0, w, h / 2); c.restore();
      }
      c.save(); c.translate(0, h); c.scale(1, -1); c.drawImage(cv, 0, 0, w, h / 2, 0, 0, w, h / 2); c.restore();
      if (d2.pattern === 'split') { // raked two-tone: forefoot in a deep tone of the secondary colour
        c.save(); c.fillStyle = mix(sec2, '#000000', 0.25);
        for (const lat of [true, false]) { c.beginPath(); const a = P(0.5, -0.2, lat), b = P(0.62, 1.2, lat), e1 = P(1.05, 1.2, lat), e2 = P(1.05, -0.2, lat); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(e1[0], e1[1]); c.lineTo(e2[0], e2[1]); c.closePath(); c.fill(); }
        c.restore();
      }
      for (const lat of [true, false]) {
        // channel floor (tongue colour)
        c.save(); c.beginPath();
        for (let i = 0; i <= 30; i++) { const s = lerp(S0(M), S.sL + 0.04, i / 30); const [x, y] = P(s, RT.chan(s) - 0.01, lat); i ? c.lineTo(x, y) : c.moveTo(x, y); }
        { const [x, y] = P(S.sL + 0.04, 1.3, lat); c.lineTo(x, y); const [x2, y2] = P(S0(M), 1.3, lat); c.lineTo(x2, y2); }
        c.closePath(); c.fillStyle = tongueCol; c.fill(); c.restore();
        for (const pn of PN) {
          if (pn.role === 'zone') {
            c.save(); panelPath(c, P, pn, lat, RT); c.clip(); c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(0, 0, w, h); c.restore();
            continue;
          }
          const fill = pn.role === 'toe' ? (d2.pattern === 'split' ? mix(sec2, '#000000', 0.25) : d2.pattern === 'gradient' ? sec2 : shade(pri, lum(pri) > 0.5 ? -0.04 : 0.04)) : pn.role === 'over' ? over : pn.role === 'emblem' ? acc : (pn.role === 'accent' ? acc : over);
          c.save();
          c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 7 * k;
          c.fillStyle = fill; panelPath(c, P, pn, lat, RT); c.fill();
          c.restore();
          if (pn.role === 'over') { // stitching
            c.save(); panelPath(c, P, pn, lat, RT); c.clip();
            c.setLineDash([9 * k, 6 * k]); c.lineWidth = 22 * k; c.strokeStyle = lum(fill) > 0.5 ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.45)'; panelPath(c, P, pn, lat, RT); c.stroke();
            c.setLineDash([]); c.lineWidth = 15 * k; c.strokeStyle = fill; panelPath(c, P, pn, lat, RT); c.stroke();
            c.restore();
          }
        }
        if (sn) { // perforation shading
          for (let s = 0.775; s < 0.95; s += 0.016) for (let A = 0.56; A < 0.98; A += 0.06) {
            const [x, y] = P(s + ((Math.round(A / 0.06) % 2) * 0.008), A, lat);
            c.beginPath(); c.arc(x, y, 2.6 * k, 0, PI * 2); c.fillStyle = 'rgba(0,0,0,0.45)'; c.fill();
          }
        }
        // eyelet holes
        const LI = G.laceInfo;
        for (let i = 0; i < S.laces.n; i++) {
          const e = LI.eye(i, true);
          // A of eyelet: approximate via table
          void e;
        }
      }
      { // soft contact shadow where the upper meets the sole
        const WR = spline(S.sole.wrap), n = 96;
        for (const lat of [true, false]) for (let i = 0; i < n; i++) {
          const sA = i / n, sB = (i + 1) / n, sm = (sA + sB) / 2, hj = WR(sm);
          const [x0, ya] = P(sA, RT.aOfH(sm, hj), lat), [x1, yb2] = P(sB, RT.aOfH(sm, hj + 0.07), lat);
          const g = c.createLinearGradient(0, ya, 0, yb2);
          g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g; c.fillRect(x0, Math.min(ya, yb2) - (lat ? 0 : 0), x1 - x0 + 0.5, Math.abs(yb2 - ya) + 2);
        }
      }
      // lateral heel text
      const txt = label(d2);
      if (txt) {
        const [x, y] = P(sn ? 0.1 : 0.1, sn ? 0.5 : 0.46, true);
        drawText(c, txt, x, y, w * 0.1, h * 0.045, d2, { color: ink(over), outline: false });
      }
      // tongue
      if (tcv) {
        const tc = tcv.getContext('2d'), tw = tcv.width, th = tcv.height;
        tc.fillStyle = tongueCol; tc.fillRect(0, 0, tw, th);
        tc.fillStyle = over; tc.fillRect(tw * 0.2, th * 0.1, tw * 0.6, th * 0.1);
        tc.strokeStyle = 'rgba(255,255,255,0.35)'; tc.setLineDash([4, 3]); tc.lineWidth = 1.5; tc.strokeRect(tw * 0.22, th * 0.11, tw * 0.56, th * 0.08); tc.setLineDash([]);
        if (txt) drawText(tc, txt, tw / 2, th * 0.15, tw * 0.5, th * 0.06, d2, { color: ink(over), outline: false });
      }
      // sole canvas: u along x, v bands (lateral 0..0.5 from the bottom)
      const sc = scv.getContext('2d'), sw = scv.width, sh = scv.height;
      const midCol = sn ? (lum(acc) > 0.55 ? acc : '#f2f2ee') : sec2;
      sc.fillStyle = midCol; sc.fillRect(0, 0, sw, sh);
      if (sn) {
        const row = (vv, lat) => (lat ? 0.5 + vv : 0.5 - vv) * sh, wv = t => 0.16 + 0.24 * t;
        for (const lat of [true, false]) {
          // contact shading under the upper, a crisp sculpt crease and a soft shade above the outsole
          const gy = (a, b) => [row(a, lat), row(b, lat)];
          let [y0, y1] = gy(0.5, 0.36); let g = sc.createLinearGradient(0, y0, 0, y1);
          g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)'); sc.fillStyle = g; sc.fillRect(0, Math.min(y0, y1), sw, Math.abs(y1 - y0));
          [y0, y1] = gy(0.1, 0.22); g = sc.createLinearGradient(0, y0, 0, y1);
          g.addColorStop(0, 'rgba(0,0,0,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)'); sc.fillStyle = g; sc.fillRect(0, Math.min(y0, y1), sw, Math.abs(y1 - y0));
          const yc = row(wv(0.3), lat), dir = lat ? 1 : -1;
          sc.fillStyle = 'rgba(0,0,0,0.13)'; sc.fillRect(0, yc - 1.2, sw, 2.4);
          sc.fillStyle = 'rgba(255,255,255,0.5)'; sc.fillRect(0, yc + dir * 1.8 - 0.8, sw, 1.6);
        }
      }
      // materials
      if (collarM) collarM.color.set(lum(pri) > 0.6 ? shade(pri, -0.05) : pri);
      if (tongueM) tongueM.sheenColor.set(shade(pri, 0.4)).multiplyScalar(0.3);
      upM.sheenColor.set(shade(pri, 0.4)).multiplyScalar(0.25);
      laceM.color.set(sn ? (lum(acc) > 0.5 ? acc : '#f4f4f2') : (lum(pri) > 0.5 ? shade(pri, -0.08) : pri));
      if (tabM) tabM.color.set(over);
      if (outM) outM.color.set(lum(sec2) < 0.05 ? sec2 : '#2a2b30');
      if (sockM) { sockM.color.set(shade(pri, -0.15)); sockTopM.color.set(shade(pri, -0.3)); }
      if (studM) studM.color.set(lum(acc) > 0.3 ? acc : mix(sec2, '#ffffff', 0.3));
      insM.color.set(shade(pri, -0.75));
      lining.color.set(mix(shade(pri, -0.7), '#15171c', 0.5));
      eyeM.color.set(sn ? over : '#d9dde4');
      applySurfaceFinish(upM, d2.finish);
      if (!sn) applySurfaceFinish(soleM, d2.finish);
    });
    Object.assign(item, { yaw: -0.3, heroYaw: -0.26, elev: 0.2, fit: 1.1 });
  }

  return {
    builders: {
      cleats: (it, d) => buildShoe(it, d, 'cleat'),
      sneakers: (it, d) => buildShoe(it, d, 'sneaker'),
    },
  };
}
