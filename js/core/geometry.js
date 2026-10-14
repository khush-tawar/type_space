// Outline geometry on TrueType-style contours: arrays of { x, y, on }.

export function signedArea(contour) {
  // Shoelace on the control polygon is sign-accurate for well-formed outlines.
  let a = 0;
  for (let i = 0, n = contour.length; i < n; i++) {
    const p = contour[i], q = contour[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** True when the glyph's net winding is clockwise (TrueType convention for outer contours). */
export function isClockwise(contours) {
  let a = 0; for (const c of contours) a += signedArea(c);
  return a <= 0;
}

export function reverseContour(c) {
  if (c.length < 2) return c.slice();
  // Keep the same start point so on/off sequencing stays valid.
  return [c[0], ...c.slice(1).reverse()];
}

export function bbox(contours) {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const c of contours) for (const p of c) {
    if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
  }
  return isFinite(xMin) ? { xMin, yMin, xMax, yMax } : { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
}

export function cloneContours(cs) { return cs.map(c => c.map(p => ({ x: p.x, y: p.y, on: p.on }))); }

/** Expand a TrueType contour into explicit segments: [{type:'L'|'Q', p0, c?, p1}]. */
export function segments(contour) {
  const n = contour.length; if (n === 0) return [];
  let start = contour.findIndex(p => p.on);
  const pts = [];
  if (start < 0) {
    // All off-curve: implied on-curve midpoints everywhere.
    for (let i = 0; i < n; i++) {
      const a = contour[i], b = contour[(i + 1) % n];
      pts.push(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
    }
    start = 1;
    const rot = pts.slice(start).concat(pts.slice(0, start));
    return segmentsFromExplicit(rot);
  }
  for (let i = 0; i < n; i++) pts.push(contour[(start + i) % n]);
  return segmentsFromExplicit(pts);
}

function segmentsFromExplicit(pts) {
  const segs = [];
  const n = pts.length;
  let cur = pts[0];
  let ctrl = null;
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n];
    if (p.on) {
      segs.push(ctrl ? { type: 'Q', p0: cur, c: ctrl, p1: p } : { type: 'L', p0: cur, p1: p });
      cur = p; ctrl = null;
    } else if (ctrl) {
      const mid = { x: (ctrl.x + p.x) / 2, y: (ctrl.y + p.y) / 2, on: true };
      segs.push({ type: 'Q', p0: cur, c: ctrl, p1: mid });
      cur = mid; ctrl = p;
    } else ctrl = p;
  }
  return segs;
}

/** SVG path data in font units (y up). Callers flip with a transform. */
export function toSvgPath(contours, round = 2) {
  const f = v => +v.toFixed(round);
  let d = '';
  for (const c of contours) {
    const segs = segments(c);
    if (!segs.length) continue;
    d += `M${f(segs[0].p0.x)} ${f(segs[0].p0.y)}`;
    for (const s of segs) d += s.type === 'L' ? `L${f(s.p1.x)} ${f(s.p1.y)}` : `Q${f(s.c.x)} ${f(s.c.y)} ${f(s.p1.x)} ${f(s.p1.y)}`;
    d += 'Z';
  }
  return d;
}

/** Ink spans of a horizontal line y=Y across the glyph (nonzero winding not needed; even-odd crossings). */
export function scanlineX(contours, Y) {
  const xs = [];
  for (const c of contours) for (const s of segments(c)) {
    if (s.type === 'L') {
      const { p0, p1 } = s;
      if ((p0.y <= Y && p1.y > Y) || (p1.y <= Y && p0.y > Y)) xs.push(p0.x + (Y - p0.y) * (p1.x - p0.x) / (p1.y - p0.y));
    } else {
      const { p0, c: q, p1 } = s;
      const a = p0.y - 2 * q.y + p1.y, b = 2 * (q.y - p0.y), cc = p0.y - Y;
      const roots = [];
      if (Math.abs(a) < 1e-9) { if (Math.abs(b) > 1e-9) roots.push(-cc / b); }
      else {
        const disc = b * b - 4 * a * cc;
        if (disc >= 0) { const sq = Math.sqrt(disc); roots.push((-b + sq) / (2 * a), (-b - sq) / (2 * a)); }
      }
      for (const t of roots) if (t >= 0 && t < 1) {
        const mt = 1 - t;
        xs.push(mt * mt * p0.x + 2 * mt * t * q.x + t * t * p1.x);
      }
    }
  }
  return xs.sort((a, b) => a - b);
}

export function scanlineY(contours, X) {
  const swapped = contours.map(c => c.map(p => ({ x: p.y, y: p.x, on: p.on })));
  return scanlineX(swapped, X);
}

// ---------- cubic -> quadratic (for CFF sources) ----------

function cubicAt(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
  };
}

function splitCubic(p0, p1, p2, p3, t0, t1) {
  // Sub-curve of a cubic between t0..t1 via blossoming.
  const B = (a, b, c) => {
    const pts = [p0, p1, p2, p3];
    let l = pts.map(p => ({ ...p }));
    for (const t of [a, b, c]) {
      const nl = [];
      for (let i = 0; i < l.length - 1; i++) nl.push({ x: l[i].x + (l[i + 1].x - l[i].x) * t, y: l[i].y + (l[i + 1].y - l[i].y) * t });
      l = nl;
    }
    return l[0];
  };
  return [B(t0, t0, t0), B(t0, t0, t1), B(t0, t1, t1), B(t1, t1, t1)];
}

/**
 * Approximate a cubic by n quadratics within `tolerance` font units.
 * Returns the off/on point sequence after p0: [{off}, {on}, {off}, {on}...] ending at p3.
 */
export function cubicToQuads(p0, p1, p2, p3, tolerance = 1) {
  for (let n = 1; n <= 32; n++) {
    const out = []; let ok = true;
    for (let k = 0; k < n && ok; k++) {
      const [a, b, c, d] = splitCubic(p0, p1, p2, p3, k / n, (k + 1) / n);
      const q = { x: (3 * (b.x + c.x) - (a.x + d.x)) / 4, y: (3 * (b.y + c.y) - (a.y + d.y)) / 4 };
      for (let i = 1; i < 8; i++) {
        const t = i / 8, mt = 1 - t;
        const qp = { x: mt * mt * a.x + 2 * mt * t * q.x + t * t * d.x, y: mt * mt * a.y + 2 * mt * t * q.y + t * t * d.y };
        const cp = cubicAt(a, b, c, d, t);
        if (Math.hypot(qp.x - cp.x, qp.y - cp.y) > tolerance) { ok = false; break; }
      }
      out.push({ x: q.x, y: q.y, on: false }, { x: d.x, y: d.y, on: true });
    }
    if (ok) return out;
  }
  return [{ x: p3.x, y: p3.y, on: true }];
}

/** opentype.js path commands (font units, y up) -> TrueType contours. */
export function commandsToContours(commands, tolerance) {
  const contours = []; let cur = null; let last = null;
  const close = () => {
    if (cur && cur.length > 1) {
      const a = cur[0], b = cur[cur.length - 1];
      if (b.on && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) cur.pop();
      contours.push(cur);
    }
    cur = null;
  };
  for (const c of commands) {
    if (c.type === 'M') { close(); cur = [{ x: c.x, y: c.y, on: true }]; last = c; }
    else if (c.type === 'L') { cur.push({ x: c.x, y: c.y, on: true }); last = c; }
    else if (c.type === 'Q') { cur.push({ x: c.x1, y: c.y1, on: false }, { x: c.x, y: c.y, on: true }); last = c; }
    else if (c.type === 'C') {
      cur.push(...cubicToQuads(last, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y }, tolerance));
      last = c;
    } else if (c.type === 'Z') close();
  }
  close();
  return contours;
}
