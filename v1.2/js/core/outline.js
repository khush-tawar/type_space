// Precise outline engine (v1.2).
//
// Instead of pushing individual points along normals (which spikes at acute corners and
// folds where strokes overlap), outlines are treated as filled regions:
//   1. flatten curves to a dense polygon and merge overlaps (nonzero union)
//   2. erode to a thin "core" when a geometric transform would distort stroke thickness,
//      transform the core, then grow it back with a pen — stroke thickness survives width,
//      slant and zone changes in every direction, not just vertically
//   3. grow/shrink with an elliptical, rotatable pen (weight, contrast, stress angle)
//   4. morphological corner rounding, ink traps
//   5. refit clean curves: corners and straight lines kept exact, nodes on extrema,
//      cubic least-squares fitting (Schneider) then cubic→quadratic for TrueType.
// Polygon boolean/offset work is done by Clipper (Angus Johnson), injected via useClipper().
import { segments, cubicToQuads, signedArea } from './geometry.js';

let C = null;
export function useClipper(lib) { C = lib?.ClipperOffset ? lib : lib?.default; }
export const hasClipper = () => !!C;

const SCALE = 16; // Clipper works on integers: 1/16 font unit resolution

// ---------- flatten ----------

export function flatten(contours, tol, maxLen) {
  const out = [];
  for (const c of contours) {
    const segs = segments(c);
    if (!segs.length) continue;
    const poly = [[segs[0].p0.x, segs[0].p0.y]];
    for (const s of segs) {
      if (s.type === 'L') { poly.push([s.p1.x, s.p1.y]); continue; }
      const { p0, c: q, p1 } = s;
      const dev = Math.hypot(p0.x - 2 * q.x + p1.x, p0.y - 2 * q.y + p1.y) / 4;
      const len = Math.hypot(q.x - p0.x, q.y - p0.y) + Math.hypot(p1.x - q.x, p1.y - q.y);
      const n = Math.max(1, Math.ceil(Math.sqrt(dev / tol)), Math.ceil(len / maxLen));
      for (let i = 1; i <= n; i++) {
        const t = i / n, mt = 1 - t;
        poly.push([mt * mt * p0.x + 2 * mt * t * q.x + t * t * p1.x, mt * mt * p0.y + 2 * mt * t * q.y + t * t * p1.y]);
      }
    }
    poly.pop(); // closing point duplicates the start
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

const toPaths = polys => polys.map(p => p.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) })));
const fromPaths = paths => paths.map(p => p.map(pt => [pt.X / SCALE, pt.Y / SCALE]));

function union(paths) {
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const sol = new C.Paths();
  c.Execute(C.ClipType.ctUnion, sol, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return sol;
}

function offset(paths, delta, join = 'miter', miterLimit = 2.5) {
  if (!delta) return paths;
  const co = new C.ClipperOffset(miterLimit, 0.2 * SCALE);
  co.AddPaths(paths, join === 'round' ? C.JoinType.jtRound : join === 'square' ? C.JoinType.jtSquare : C.JoinType.jtMiter, C.EndType.etClosedPolygon);
  const sol = new C.Paths();
  co.Execute(sol, delta * SCALE);
  return sol;
}

// Topology signature: number of filled pieces and counters. Erosion must not change it,
// otherwise thin joins (a shoulder meeting a stem, an arm meeting a spine) snap apart.
function topo(paths) {
  let outer = 0, holes = 0;
  for (const p of paths) { const a = C.Clipper.Area(p); if (Math.abs(a) < SCALE * SCALE * 2) continue; if (a > 0) outer++; else holes++; }
  return outer * 1000 + holes;
}

/** Apply an eroding operation, backing off its strength until the shape stays in one piece. */
function safeErode(paths, op, amount) {
  if (!amount) return { paths, used: 0 };
  const sig = topo(paths);
  for (const f of [1, 0.75, 0.55, 0.38, 0.24, 0.12]) {
    const out = op(paths, amount * f);
    if (topo(out) === sig) return { paths: out, used: amount * f };
  }
  return { paths, used: 0 };
}

function unionPositive(paths) {
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const sol = new C.Paths();
  c.Execute(C.ClipType.ctUnion, sol, C.PolyFillType.pftPositive, C.PolyFillType.pftPositive);
  return sol;
}

/**
 * Proportional thinning: every point moves inward by a fraction of the local stroke
 * thickness (measured by casting a ray to the opposite side). A stem thinned by 40% and a
 * narrow shoulder joint thinned by 40% both survive — the letter thins organically
 * instead of snapping at its weakest join. fx/fy are fractions along/across the pen angle.
 */
function proportionalShrink(paths, fx, fy, angle, tCap) {
  // Densify long edges so the inscribed-ball test sees straight sides too.
  const step = tCap / 6;
  const polys = fromPaths(paths).map(p => {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push(a);
      const L = len(sub(b, a)), k = Math.floor(L / step);
      for (let j = 1; j <= k; j++) { const t = j / (k + 1); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  });
  const cos = Math.cos(angle), sin = Math.sin(angle);
  // Spatial grid: a boundary point can only shrink the ball at v if it lies within tCap of v.
  const cell = tCap / 2, grid = new Map();
  const keyOf = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  polys.forEach((p, qi) => p.forEach((q, qj) => { const k = keyOf(q[0], q[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(qi, qj); }));
  const near = v => {
    const cx = Math.floor(v[0] / cell), cy = Math.floor(v[1] / cell), out = [];
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) { const l = grid.get(`${cx + dx},${cy + dy}`); if (l) out.push(l); }
    return out;
  };
  const moved = polys.map((p, pi) => {
    const n = p.length;
    const normals = new Array(n), rad = new Array(n);
    // signed turning at each vertex (positive = convex, since ink lies to the left)
    const turnAt = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], v = p[i], b = p[(i + 1) % n];
      const e1 = norm(sub(v, a)), e2 = norm(sub(b, v));
      turnAt[i] = Math.atan2(e1[0] * e2[1] - e1[1] * e2[0], dot(e1, e2));
    }
    // Points reached from i along a purely convex stretch (< ~100° of turning) belong to
    // the same end or corner of the stroke; they must not limit its thickness, or stems
    // would flare at their ends.
    const excluded = i => {
      const ex = new Set([i]);
      for (const dir of [1, -1]) {
        let acc = 0, arc = 0, j = i;
        for (let k = 0; k < n; k++) {
          const nj = (j + dir + n) % n;
          arc += len(sub(p[nj], p[j]));
          if (arc > tCap) break;
          j = nj;
          ex.add(j);
          const t = turnAt[j];
          if (t < -0.26) break;
          acc += t;
          if (acc > 1.75) break;
        }
      }
      return ex;
    };
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], v = p[i], b = p[(i + 1) % n];
      const e1 = norm(sub(v, a)), e2 = norm(sub(b, v));
      let nx = -(e1[1] + e2[1]), ny = e1[0] + e2[0];
      const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      normals[i] = [nx, ny];
      // Shrinking-ball medial radius: the largest disc tangent at v (centre v + r·n) that
      // contains no other boundary point. r = |q−v|² / (2 (q−v)·n) minimised over q.
      let r = tCap / 2;
      const skip = excluded(i);
      for (const list of near(v)) for (let li = 0; li < list.length; li += 2) {
        const qi = list[li], qj = list[li + 1];
        if (qi === pi && skip.has(qj)) continue;
        const q = polys[qi][qj];
        const dx = q[0] - v[0], dy = q[1] - v[1];
        const proj = dx * nx + dy * ny;
        if (proj <= 1e-6) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) continue;
        const rr = d2 / (2 * proj);
        if (rr < r) r = rr;
      }
      rad[i] = r;
    }
    const sm = rad.map((r, i) => Math.min(r, (rad[(i - 1 + n) % n] + 2 * r + rad[(i + 1) % n]) / 4 * 1.1));
    return p.map((v, i) => {
      const [nx, ny] = normals[i];
      const u = nx * cos + ny * sin, w = -nx * sin + ny * cos;
      const f = Math.min(0.9, Math.hypot(fx * u, fy * w));
      const d = sm[i] * f;
      return [v[0] + nx * d, v[1] + ny * d];
    });
  });
  return unionPositive(toPaths(moved));
}

function mapPaths(paths, fn) {
  return paths.map(p => p.map(pt => { const [x, y] = fn(pt.X / SCALE, pt.Y / SCALE); return { X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }; }));
}

/** Minkowski sum with an ellipse of semi-axes rx (along `angle`) and ry (perpendicular). Negative = erosion. */
export function penOffset(paths, rx, ry, angle = 0, join = 'miter') {
  const ax = Math.abs(rx), ay = Math.abs(ry);
  if (ax < 0.05 && ay < 0.05) return paths;
  if (rx * ry < 0 && ax >= 0.05 && ay >= 0.05) {
    // Mixed growth: grow along one axis, then shrink along the other.
    const first = rx > 0 ? penOffset(paths, rx, 0, angle, join) : penOffset(paths, 0, ry, angle, join);
    return rx > 0 ? penOffset(first, 0, ry, angle, join) : penOffset(first, rx, 0, angle, join);
  }
  const sign = (rx || ry) < 0 ? -1 : 1;
  const R = Math.max(ax, ay);
  const sx = Math.max(ax / R, 0.03), sy = Math.max(ay / R, 0.03);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const fwd = (x, y) => { const u = x * cos + y * sin, v = -x * sin + y * cos; return [u / sx, v / sy]; };
  const inv = (u, v) => { u *= sx; v *= sy; return [u * cos - v * sin, u * sin + v * cos]; };
  if (sx === 1 && sy === 1) return offset(paths, sign * R, join);
  return mapPaths(offset(mapPaths(paths, fwd), sign * R, join), inv);
}

// ---------- ink traps ----------

function inkTraps(polys, depth) {
  if (depth <= 0) return polys;
  return polys.map(p => {
    const n = p.length, out = [];
    for (let i = 0; i < n; i++) {
      const v = p[i], a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
      const ax = a[0] - v[0], ay = a[1] - v[1], bx = b[0] - v[0], by = b[1] - v[1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      const cross = (v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0]);
      const cosT = (ax * bx + ay * by) / (la * lb || 1);
      // Concave (right turn with ink on the left) and reasonably sharp.
      if (cross < 0 && cosT > -0.64 && la > depth * 2 && lb > depth * 2) {
        const ux = ax / la, uy = ay / la, wx = bx / lb, wy = by / lb;
        let dx = -(ux + wx), dy = -(uy + wy); const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        const s = depth * 0.9;
        out.push([v[0] + ux * s, v[1] + uy * s], [v[0] + dx * depth, v[1] + dy * depth], [v[0] + wx * s, v[1] + wy * s]);
      } else out.push(v);
    }
    return out;
  });
}

// ---------- curve fitting (Schneider, "An Algorithm for Automatically Fitting Digitized Curves") ----------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = a => Math.hypot(a[0], a[1]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

function bez(b, t) {
  const mt = 1 - t;
  return add(add(mul(b[0], mt * mt * mt), mul(b[1], 3 * mt * mt * t)), add(mul(b[2], 3 * mt * t * t), mul(b[3], t * t * t)));
}
function bezD1(b, t) {
  const mt = 1 - t;
  return add(add(mul(sub(b[1], b[0]), 3 * mt * mt), mul(sub(b[2], b[1]), 6 * mt * t)), mul(sub(b[3], b[2]), 3 * t * t));
}
function bezD2(b, t) {
  return add(mul(add(sub(b[2], mul(b[1], 2)), b[0]), 6 * (1 - t)), mul(add(sub(b[3], mul(b[2], 2)), b[1]), 6 * t));
}

function chordParams(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const L = u[u.length - 1] || 1;
  return u.map(x => x / L);
}

function generateBezier(pts, u, t1, t2) {
  const p0 = pts[0], p3 = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], mt = 1 - t;
    const b1 = 3 * t * mt * mt, b2 = 3 * t * t * mt;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(p0, mt * mt * mt + b1), mul(p3, b2 + t * t * t)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = det ? (x0 * c11 - c01 * x1) / det : 0, ar = det ? (c00 * x1 - c01 * x0) / det : 0;
  const seg = len(sub(p3, p0)), eps = 1e-6 * seg;
  if (al < eps || ar < eps || al > seg * 2 || ar > seg * 2) { al = ar = seg / 3; }
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
}

function maxError(pts, b, u) {
  let max = 0, idx = pts.length >> 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len(sub(bez(b, u[i]), pts[i]));
    if (d > max) { max = d; idx = i; }
  }
  return [max, idx];
}

function reparam(pts, u, b) {
  return u.map((t, i) => {
    const d = sub(bez(b, t), pts[i]), d1 = bezD1(b, t), d2 = bezD2(b, t);
    const den = dot(d1, d1) + dot(d, d2);
    const nt = den ? t - dot(d, d1) / den : t;
    return Math.min(1, Math.max(0, nt));
  });
}

function fitCubic(pts, t1, t2, err, out, depth = 0) {
  if (pts.length === 2) {
    const d = len(sub(pts[1], pts[0])) / 3;
    out.push([pts[0], add(pts[0], mul(t1, d)), add(pts[1], mul(t2, d)), pts[1]]);
    return;
  }
  let u = chordParams(pts);
  let b = generateBezier(pts, u, t1, t2);
  let [e, split] = maxError(pts, b, u);
  if (e < err) { out.push(b); return; }
  if (e < err * 6) {
    for (let k = 0; k < 6; k++) {
      u = reparam(pts, u, b);
      b = generateBezier(pts, u, t1, t2);
      [e, split] = maxError(pts, b, u);
      if (e < err) { out.push(b); return; }
    }
  }
  if (depth > 14 || pts.length < 4) { out.push(b); return; }
  split = Math.max(1, Math.min(pts.length - 2, split));
  const tc = norm(sub(pts[split - 1], pts[split + 1]));
  fitCubic(pts.slice(0, split + 1), t1, tc, err, out, depth + 1);
  fitCubic(pts.slice(split), mul(tc, -1), t2, err, out, depth + 1);
}

// Douglas–Peucker on a closed polygon: removes jitter on straight edges while keeping
// curves sampled within eps.
function simplifyClosed(p, eps) {
  const n = p.length;
  if (n < 5) return p;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) { const d = len(sub(p[i], p[0])); if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1;
  const rec = (a, b) => {
    // indices a..b along the ring (b may wrap)
    const A = p[a % n], B = p[b % n];
    const ab = sub(B, A), L = len(ab) || 1e-9;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const q = p[i % n];
      const d = Math.abs((q[0] - A[0]) * ab[1] - (q[1] - A[1]) * ab[0]) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi % n] = 1; rec(a, mi); rec(mi, b); }
  };
  rec(0, far); rec(far, n);
  return p.filter((_, i) => keep[i]);
}

function cleanPoly(p, eps) {
  const out = [];
  for (const q of p) { const l = out[out.length - 1]; if (!l || Math.abs(l[0] - q[0]) > eps || Math.abs(l[1] - q[1]) > eps) out.push(q); }
  while (out.length > 2 && Math.abs(out[0][0] - out[out.length - 1][0]) <= eps && Math.abs(out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
  // drop exactly collinear points so straight edges are single segments
  for (let i = out.length - 1; i >= 0 && out.length > 3; i--) {
    const a = out[(i - 1 + out.length) % out.length], v = out[i], b = out[(i + 1) % out.length];
    const cr = (v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0]);
    if (Math.abs(cr) < 1e-6 * (len(sub(v, a)) * len(sub(b, v)) + 1e-9) && dot(sub(v, a), sub(b, v)) > 0) out.splice(i, 1);
  }
  return out;
}

/**
 * Fit one closed polygon with lines and cubics. Returns [{type:'L', p0, p1} | {type:'C', b:[p0,p1,p2,p3]}].
 * cornerDeg: turning angle above which a vertex is kept as a sharp corner.
 */
export function fitPolygon(poly, { tol, lineLen, cornerDeg = 38 }) {
  const p = cleanPoly(simplifyClosed(poly, tol * 0.35), tol * 0.05);
  const n = p.length;
  if (n < 3) return [];
  const dirIn = i => norm(sub(p[i], p[(i - 1 + n) % n]));
  const dirOut = i => norm(sub(p[(i + 1) % n], p[i]));
  const turn = new Array(n), edgeLen = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = dirIn(i), b = dirOut(i);
    turn[i] = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
    edgeLen[i] = len(sub(p[(i + 1) % n], p[i])); // edge i -> i+1
  }
  const isCorner = i => turn[i] > cornerDeg;
  // An edge is a genuine straight segment when long and its ends are corners or tangent joins.
  const isLine = i => edgeLen[i] > lineLen && (isCorner(i) || turn[i] < 4) && (isCorner((i + 1) % n) || turn[(i + 1) % n] < 4);
  const brk = new Map(); // index -> forced tangent or null (corner)
  for (let i = 0; i < n; i++) {
    if (isCorner(i)) brk.set(i, null);
    if (isLine(i)) { if (!brk.has(i)) brk.set(i, 'line'); if (!brk.has((i + 1) % n)) brk.set((i + 1) % n, 'line'); }
  }
  // Extrema of curved stretches become on-curve nodes with axis-aligned tangents.
  for (let i = 0; i < n; i++) {
    if (brk.has(i)) continue;
    const a = p[(i - 1 + n) % n], v = p[i], b = p[(i + 1) % n];
    if ((v[1] > a[1] && v[1] >= b[1]) || (v[1] < a[1] && v[1] <= b[1])) brk.set(i, [Math.sign(b[0] - a[0]) || 1, 0]);
    else if ((v[0] > a[0] && v[0] >= b[0]) || (v[0] < a[0] && v[0] <= b[0])) brk.set(i, [0, Math.sign(b[1] - a[1]) || 1]);
  }
  // Thin out extremum nodes that are too close to another break (flat plateaus produce several).
  const keys = [...brk.keys()].sort((x, y) => x - y);
  const minGap = lineLen * 0.35;
  for (let k = 0; k < keys.length; k++) {
    const i = keys[k];
    if (!Array.isArray(brk.get(i))) continue;
    const prev = keys[(k - 1 + keys.length) % keys.length], next = keys[(k + 1) % keys.length];
    if (prev !== i && len(sub(p[i], p[prev])) < minGap && brk.get(prev) !== undefined && !Array.isArray(brk.get(prev))) brk.delete(i);
    else if (next !== i && len(sub(p[i], p[next])) < minGap && Array.isArray(brk.get(next))) brk.delete(i);
  }
  let idx = [...brk.keys()].sort((x, y) => x - y);
  if (!idx.length) idx = [0];
  const segsOut = [];
  for (let k = 0; k < idx.length; k++) {
    const s = idx[k], e = idx[(k + 1) % idx.length];
    const run = [];
    for (let i = s; ; i = (i + 1) % n) { run.push(p[i]); if (i === e && run.length > 1) break; if (run.length > n + 1) break; }
    if (run.length === 2 || (run.length === n + 1 && idx.length === 1 && false)) { segsOut.push({ type: 'L', p0: run[0], p1: run[1] }); continue; }
    const chord = sub(run[run.length - 1], run[0]), cl = len(chord) || 1;
    let straight = true;
    for (const q of run) { const d = Math.abs((q[0] - run[0][0]) * chord[1] - (q[1] - run[0][1]) * chord[0]) / cl; if (d > tol) { straight = false; break; } }
    if (straight) { segsOut.push({ type: 'L', p0: run[0], p1: run[run.length - 1] }); continue; }
    const tangentAt = (i, forward) => {
      const f = brk.get(i);
      if (Array.isArray(f)) return forward ? norm(f) : mul(norm(f), -1);
      if (f === 'line' && !isCorner(i)) {
        // tangent join between a straight edge and a curve: continue the line's direction
        const d = isLine(i) ? dirOut(i) : dirIn(i);
        return forward ? d : mul(d, -1);
      }
      // corner: estimate from the run itself
      const ref = forward ? run.slice(1, 4) : run.slice(-4, -1).reverse();
      const base = forward ? run[0] : run[run.length - 1];
      let acc = [0, 0]; for (const q of ref) acc = add(acc, norm(sub(q, base)));
      return norm(acc);
    };
    const bs = [];
    fitCubic(run, tangentAt(s, true), tangentAt(e, false), tol, bs);
    for (const b of bs) segsOut.push({ type: 'C', b });
  }
  return segsOut;
}

/** Fitted segments -> TrueType contour (quadratic), with optional curve tension on cubics. */
export function segmentsToContour(segs, { tension = 1, quadTol = 0.5 } = {}) {
  const out = [];
  for (const s of segs) {
    if (s.type === 'L') { out.push({ x: s.p1[0], y: s.p1[1], on: true }); continue; }
    let [p0, p1, p2, p3] = s.b;
    if (tension !== 1) {
      p1 = add(p0, mul(sub(p1, p0), tension));
      p2 = add(p3, mul(sub(p2, p3), tension));
    }
    out.push(...cubicToQuads({ x: p0[0], y: p0[1] }, { x: p1[0], y: p1[1] }, { x: p2[0], y: p2[1] }, { x: p3[0], y: p3[1] }, quadTol));
  }
  // rotate so the contour starts with an on-curve point (the last point closes onto the first)
  if (out.length && out[out.length - 1].on) out.unshift(out.pop());
  return out;
}

/**
 * Run the precise pipeline for one glyph. All geometry parameters are plain data so the
 * job can be shipped to a Web Worker.
 *
 * job = { contours, upm, map: mapperSpec|null, core, pen:{rx, ry, angle}, round:{outer, inner}, inktrap, tension, shiftX }
 */
export function refineGlyph(job, mapper) {
  if (!C) throw new Error('Clipper not loaded');
  const upm = job.upm;
  const tol = upm / 2500, flatTol = upm / 5000, maxLen = upm / 90;
  let P = union(toPaths(flatten(job.contours, flatTol, maxLen)));
  if (!P.length) return [];
  let core = 0;
  if (mapper) {
    if (job.core > 0) ({ paths: P, used: core } = safeErode(P, (p, r) => offset(p, -r, 'miter', 3), job.core));
    P = union(mapPaths(P, mapper));
  }
  const angle = job.pen?.angle || 0;
  let rx = (job.pen?.rx || 0) + core + (job.compX || 0);
  let ry = (job.pen?.ry || 0) + core;
  // Growth is always safe; shrinking components go through the topology guard.
  const grow = { x: Math.max(rx, 0), y: Math.max(ry, 0) }, shrink = { x: Math.min(rx, 0), y: Math.min(ry, 0) };
  if (grow.x || grow.y) P = penOffset(P, grow.x, grow.y, angle, 'miter');
  if (shrink.x || shrink.y) {
    // Convert absolute shrink (from the reference stems) into fractions of local thickness.
    const fx = -2 * shrink.x / (job.stemV || upm * 0.08), fy = -2 * shrink.y / (job.stemH || upm * 0.07);
    P = proportionalShrink(P, fx, fy, angle, (job.stemV || upm * 0.08) * 1.6);
  }
  const ro = job.round?.outer || 0, ri = job.round?.inner || 0;
  if (ro > 0) { const e = safeErode(P, (p, r) => offset(p, -r, 'miter', 3), ro); if (e.used) P = offset(e.paths, e.used, 'round'); }
  if (ri > 0) { P = offset(P, ri, 'miter', 3); P = offset(P, -ri, 'round'); }
  let polys = fromPaths(P);
  if (job.inktrap > 0) polys = inkTraps(polys, job.inktrap);
  const contours = [];
  for (const poly of polys) {
    if (Math.abs(polyArea(poly)) < (upm / 1000) ** 2 * 4) continue; // dust from boolean ops
    const segs = fitPolygon(poly, { tol, lineLen: upm / 45 });
    if (segs.length) contours.push(segmentsToContour(segs, { tension: job.tension || 1, quadTol: upm / 2500 }));
  }
  // TrueType wants clockwise outer contours; Clipper returns counter-clockwise outers.
  let big = null, bigA = 0;
  for (const c of contours) { const a = signedArea(c); if (Math.abs(a) > Math.abs(bigA)) { bigA = a; big = c; } }
  const flip = bigA > 0;
  const final = flip ? contours.map(c => [c[0], ...c.slice(1).reverse()]) : contours;
  if (job.shiftX) for (const c of final) for (const q of c) q.x += job.shiftX;
  return final;
}

function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
