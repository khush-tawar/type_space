// Parametric outline transforms. Everything works on quadratic TrueType contours and
// (except corner rounding) preserves point structure, so outlines stay interpolation-compatible.
import { isClockwise, cloneContours } from './geometry.js';

export const DEFAULT_SETTINGS = Object.freeze({
  weight: 0,        // stem change, % of measured vertical stem   (-60 … 150)
  contrast: 0,      // thins (+) or thickens (−) horizontals       (-100 … 100)
  width: 100,       // horizontal proportion, %                    (60 … 160)
  keepStems: true,  // compensate stem thickness when changing width
  slant: 0,         // degrees, positive leans right               (-20 … 20)
  xHeight: 100,     // lowercase / main-zone height, %             (75 … 130)
  roundness: 0,     // corner radius, ‰ of em                      (0 … 80)
  roundMode: 'outer',
  tracking: 0,      // ‰ of em added to each glyph's advance        (-80 … 250)
});

const UPPER_NAME = /^[A-Z](?:[._]|$)|^[A-Z][a-z]*(?:acute|grave|dieresis|circumflex|tilde|ring|caron|cedilla|macron|breve|ogonek|dotaccent|hungarumlaut|commaaccent)/;

/** Should the main-zone (x-height) remap apply to this glyph? Caps, figures and their alternates are left alone. */
export function zoneApplies(glyph, unicodes) {
  for (const cp of unicodes) {
    const ch = String.fromCodePoint(cp);
    if (/\p{Lu}|\p{Lt}|\p{N}/u.test(ch)) return false;
  }
  if (!unicodes.length && glyph.name && UPPER_NAME.test(glyph.name)) return false;
  return true;
}

function zoneMap(y, X, A, k) {
  if (k === 1 || y <= 0) return y;
  if (y <= X) return y * k;
  if (y <= A) return X * k + (y - X) * (A - X * k) / (A - X);
  return y;
}

/** FreeType-style outline emboldening (FT_Outline_EmboldenXY), in float precision. */
export function embolden(contours, xStrength, yStrength, { anchorLeft = true } = {}) {
  if (!xStrength && !yStrength) return contours;
  const cw = isClockwise(contours);
  const xs = xStrength / 2, ys = yStrength / 2;
  return contours.map(c => {
    const n = c.length;
    if (n < 2) return c.slice();
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const cur = c[i];
      let j = (i - 1 + n) % n, guard = 0;
      while (Math.hypot(c[j].x - cur.x, c[j].y - cur.y) < 1e-6 && guard++ < n) j = (j - 1 + n) % n;
      let k = (i + 1) % n; guard = 0;
      while (Math.hypot(c[k].x - cur.x, c[k].y - cur.y) < 1e-6 && guard++ < n) k = (k + 1) % n;
      let ix = cur.x - c[j].x, iy = cur.y - c[j].y; const lin = Math.hypot(ix, iy) || 1; ix /= lin; iy /= lin;
      let ox = c[k].x - cur.x, oy = c[k].y - cur.y; const lout = Math.hypot(ox, oy) || 1; ox /= lout; oy /= lout;
      let d = ix * ox + iy * oy;
      let sx = 0, sy = 0;
      if (d > -0.9375) {
        d += 1;
        sx = iy + oy; sy = ix + ox;
        if (cw) sx = -sx; else sy = -sy;
        let q = ox * iy - oy * ix;
        if (cw) q = -q;
        const l = Math.min(lin, lout);
        sx = (xs * q <= l * d) ? sx * xs / d : sx * l / q;
        sy = (ys * q <= l * d) ? sy * ys / d : sy * l / q;
      }
      out[i] = { x: cur.x + (anchorLeft ? xs : 0) + sx, y: cur.y + ys + sy, on: cur.on };
    }
    return out;
  });
}

/** Replace sharp straight-line corners with quadratic arcs of radius r (font units). */
export function roundCorners(contours, r, mode = 'outer') {
  if (r <= 0) return contours;
  const cw = isClockwise(contours);
  return contours.map(c => {
    const n = c.length;
    if (n < 3) return c.slice();
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = c[i], a = c[(i - 1 + n) % n], b = c[(i + 1) % n];
      if (!p.on || !a.on || !b.on) { out.push(p); continue; }
      let ix = p.x - a.x, iy = p.y - a.y; const lin = Math.hypot(ix, iy);
      let ox = b.x - p.x, oy = b.y - p.y; const lout = Math.hypot(ox, oy);
      if (lin < 1 || lout < 1) { out.push(p); continue; }
      ix /= lin; iy /= lin; ox /= lout; oy /= lout;
      const turn = Math.acos(Math.max(-1, Math.min(1, ix * ox + iy * oy)));
      if (turn < 0.35 || turn > 2.9) { out.push(p); continue; }
      const cross = ix * oy - iy * ox;
      const convex = cw ? cross < 0 : cross > 0;
      if ((mode === 'outer' && !convex) || (mode === 'inner' && convex)) { out.push(p); continue; }
      const rr = Math.min(r, lin * 0.45, lout * 0.45);
      out.push({ x: p.x - ix * rr, y: p.y - iy * rr, on: true }, { x: p.x, y: p.y, on: false }, { x: p.x + ox * rr, y: p.y + oy * rr, on: true });
    }
    return out;
  });
}

/**
 * Derive the numeric transform plan from user settings and font measurements.
 * metrics: { upm, stemV, stemH, xHeight, ascender }
 */
export function planTransform(settings, metrics) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const w = s.width / 100;
  const stemV = metrics.stemV || metrics.upm * 0.08;
  const stemH = metrics.stemH || stemV * 0.85;
  let xs = stemV * s.weight / 100;
  if (s.keepStems) xs += stemV * (1 - w);
  let ys = stemH * s.weight / 100 - (s.contrast / 100) * stemH * 0.6;
  xs = Math.max(xs, -0.85 * stemV * w);
  ys = Math.max(ys, -0.85 * stemH);
  const X = metrics.xHeight || metrics.upm * 0.5;
  return {
    widthScale: w,
    xs, ys,
    zoneK: s.xHeight / 100,
    zoneX: X,
    zoneTop: Math.max(metrics.ascender || metrics.upm * 0.8, X * 1.2),
    tan: Math.tan(s.slant * Math.PI / 180),
    slantPivot: X / 2,
    radius: metrics.upm * s.roundness / 1000,
    roundMode: s.roundMode,
    track: metrics.upm * s.tracking / 1000,
    isIdentity: s.weight === 0 && s.contrast === 0 && s.width === 100 && s.slant === 0 && s.xHeight === 100 && s.roundness === 0 && s.tracking === 0,
  };
}

/**
 * Apply a plan to one glyph. `opts.zone` toggles the main-zone remap, `opts.zoneX` overrides
 * the zone height for this glyph's script; zero-advance glyphs (combining marks) are not spaced.
 */
export function transformGlyph(glyph, plan, opts = {}) {
  const isMark = glyph.advance === 0;
  let contours = cloneContours(glyph.contours);
  let advance = glyph.advance;
  if (plan.isIdentity || !contours.length && isMark) return { contours, advance };

  const X = opts.zoneX || plan.zoneX;
  if (opts.zone !== false && plan.zoneK !== 1) {
    const A = Math.max(plan.zoneTop, X * 1.2);
    for (const c of contours) for (const p of c) p.y = zoneMap(p.y, X, A, plan.zoneK);
  }
  if (plan.widthScale !== 1) {
    for (const c of contours) for (const p of c) p.x *= plan.widthScale;
    advance *= plan.widthScale;
  }
  if (plan.xs || plan.ys) {
    contours = embolden(contours, plan.xs, plan.ys, { anchorLeft: !isMark });
    if (!isMark) advance += plan.xs;
  }
  if (plan.radius > 0) contours = roundCorners(contours, plan.radius, plan.roundMode);
  if (plan.tan) {
    const pivot = (opts.zoneX || plan.zoneX) * (opts.zone !== false ? plan.zoneK : 1) / 2;
    for (const c of contours) for (const p of c) p.x += (p.y - pivot) * plan.tan;
  }
  if (plan.track && !isMark) {
    const half = plan.track / 2;
    for (const c of contours) for (const p of c) p.x += half;
    advance += plan.track;
  }
  return { contours, advance: Math.max(0, advance) };
}

/** The affine part of a glyph's transform, used to move GPOS anchors consistently with outlines. */
export function transformAnchor(x, y, plan, opts = {}) {
  if (plan.isIdentity) return [x, y];
  const X = opts.zoneX || plan.zoneX;
  if (opts.zone !== false && plan.zoneK !== 1) y = zoneMap(y, X, Math.max(plan.zoneTop, X * 1.2), plan.zoneK);
  x *= plan.widthScale;
  if (!opts.isMark) x += plan.xs / 2;
  y += plan.ys / 2;
  if (plan.tan) x += (y - X * (opts.zone !== false ? plan.zoneK : 1) / 2) * plan.tan;
  if (!opts.isMark) x += plan.track / 2;
  return [x, y];
}
