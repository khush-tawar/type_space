// v1.2 transform model.
// One geometric mapping (proportions, zones, slant, scale) is shared by three consumers:
//   - the draft path (instant, point-structure preserving — also used for morphing)
//   - the precise path (outline.js: stroke-preserving core + pen, clean refit)
//   - GPOS anchors, so marks follow their bases exactly.
import { isClockwise, cloneContours, bbox, signedArea } from './geometry.js';

export const DEFAULT_SETTINGS = Object.freeze({
  // stroke
  weight: 0, contrast: 0, penAngle: null, headline: 0,
  // proportions
  width: 100, keepStems: true, xHeight: 100, ascender: 100, descender: 100, waist: 0, scale: 100, baseline: 0,
  // shape
  slant: 0, tension: 0, roundOuter: 0, roundInner: 0, inktrap: 0, dots: 100,
  // spacing
  tracking: 0, kerning: 100,
});

// Pen traditions: the stress direction a script's tools leave in its letterforms.
// 0° = the pen grows vertical strokes most (Latin-style vertical stress); 90° = horizontals.
export const SCRIPT_PEN = { hebr: 90, arab: 70, nkoo: 60, adlm: 55 };
export const penAngleFor = (sid, s) => (s.penAngle ?? SCRIPT_PEN[sid] ?? 0);

const UPPER_NAME = /^[A-Z](?:[._]|$)|^[A-Z][a-z]*(?:acute|grave|dieresis|circumflex|tilde|ring|caron|cedilla|macron|breve|ogonek|dotaccent|hungarumlaut|commaaccent)/;

/** Main-zone remap applies to lowercase-like glyphs; caps, figures and their alternates use the cap zone. */
export function zoneApplies(glyph, unicodes) {
  for (const cp of unicodes) if (/\p{Lu}|\p{Lt}|\p{N}/u.test(String.fromCodePoint(cp))) return false;
  if (!unicodes.length && glyph.name && UPPER_NAME.test(glyph.name)) return false;
  return true;
}

/**
 * Numeric plan from settings + measurements of the glyph's script.
 * metrics: { upm, stemV, stemH, xHeight, capHeight, ascender, script }
 */
export function planTransform(settings, metrics) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const upm = metrics.upm;
  const stemV = metrics.stemV || upm * 0.08;
  const stemH = metrics.stemH || stemV * 0.85;
  const w = s.width / 100, sc = s.scale / 100;
  let gx = stemV * s.weight / 100;
  let gy = stemH * s.weight / 100 - (s.contrast / 100) * stemH * 0.6;
  gx = Math.max(gx, -0.8 * stemV); gy = Math.max(gy, -0.8 * stemH);
  const X = metrics.xHeight || upm * 0.5;
  const Cp = metrics.capHeight || X * 1.4;
  const A = Math.max(metrics.ascender || upm * 0.8, Cp * 1.04, X * 1.2);
  const geometric = w !== 1 || s.slant !== 0 || s.xHeight !== 100 || s.ascender !== 100 || s.descender !== 100 || s.waist !== 0;
  // Stroke-preserving core: erode to a thin skeleton-like core before geometric transforms.
  const core = s.keepStems && geometric ? 0.42 * Math.min(stemV, stemH) : 0;
  // Residual vertical-stem change from width scaling that the core does not absorb.
  const compX = s.keepStems && w !== 1 ? -(stemV - 2 * core) * (w - 1) / 2 : 0;
  const spec = {
    w, sc, tan: Math.tan(s.slant * Math.PI / 180), kz: s.xHeight / 100, ka: s.ascender / 100, kd: s.descender / 100,
    waist: s.waist / 100, base: s.baseline * upm / 1000, X, Cp, A,
  };
  return {
    upm, stemV, stemH, spec, geometric, core, compX, keepStems: s.keepStems,
    gx, gy, penAngle: penAngleFor(metrics.script, s) * Math.PI / 180,
    roundOuter: Math.min(upm * s.roundOuter / 1000, Math.min(stemV, stemH) * 0.95),
    roundInner: upm * s.roundInner / 1000,
    inktrap: upm * s.inktrap / 1000,
    tension: 1 + s.tension / 100,
    dotsK: s.dots / 100,
    headlineDelta: stemH * s.headline / 100,
    track: upm * s.tracking / 1000,
    kern: s.kerning / 100,
    // advance growth from weight, independent of draft/precise so both agree exactly
    advGrowth: gx + 2 * compX,
    isIdentity: Object.entries(DEFAULT_SETTINGS).every(([k, v]) => k === 'keepStems' || k === 'penAngle' || s[k] === v),
  };
}

function warp(y, top, waist) {
  if (!waist) return y;
  const m = top / 2, m2 = Math.min(top * 0.8, Math.max(top * 0.2, m + waist * top));
  return y <= m ? y * m2 / m : m2 + (y - m) * (top - m2) / (top - m);
}

/** Build the geometric point mapper for one glyph. Pure data in, function out (works in workers). */
export function makeMapper(spec, zone) {
  const { w, sc, tan, kz, ka, kd, waist, base, X, Cp, A } = spec;
  const top = zone ? X : Cp;
  const k = zone ? kz : 1;
  // Keep the mapping monotonic: the ascender band may shrink, but never invert, even when
  // the main zone grows past the requested ascender height.
  const A2 = Math.max(A * ka, top * k + (A - top) * 0.2);
  const pivot = X * kz * sc / 2;
  const ymap = y => {
    if (y <= 0) return y * kd;
    if (y <= top) return warp(y, top, waist) * k;
    const t = top * k;
    if (y <= A) return t + (y - top) * (A2 - t) / (A - top);
    return y - A + A2;
  };
  return (x, y) => {
    const yy = ymap(y) * sc;
    const xx = x * w * sc + (yy - pivot) * tan;
    return [xx, yy + base];
  };
}

// ---------- structure-preserving pre-steps (used by both paths) ----------

/** Scale small isolated contours (dots, nuqta, anusvara, tittles) about their own centres. */
export function scaleDots(contours, k, stemV) {
  if (k === 1) return contours;
  const cw = isClockwise(contours);
  const limit = stemV * 2.4;
  return contours.map(c => {
    const b = bbox([c]);
    const a = signedArea(c);
    const outer = cw ? a < 0 : a > 0;
    if (!outer || b.xMax - b.xMin > limit || b.yMax - b.yMin > limit || c.length < 3) return c;
    const cx = (b.xMin + b.xMax) / 2, cy = (b.yMin + b.yMax) / 2;
    return c.map(p => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k, on: p.on }));
  });
}

/** Thicken/thin a headline (shirorekha) band: top edge moves up, bottom edge moves down. */
export function adjustHeadline(contours, zoneTop, thick, delta) {
  if (!delta || !zoneTop) return contours;
  const band = thick * 0.3;
  return contours.map(c => c.map(p => {
    if (Math.abs(p.y - zoneTop) < band) return { ...p, y: p.y + delta / 2 };
    if (Math.abs(p.y - (zoneTop - thick)) < band) return { ...p, y: p.y - delta / 2 };
    return p;
  }));
}

// ---------- draft path ----------

/** FreeType-style emboldening (FT_Outline_EmboldenXY), symmetric, in float precision. */
export function embolden(contours, xStrength, yStrength) {
  if (!xStrength && !yStrength) return contours;
  const cw = isClockwise(contours);
  const xs = xStrength / 2, ys = yStrength / 2;
  return contours.map(c => {
    const n = c.length;
    if (n < 2) return c.slice();
    return c.map((cur, i) => {
      let j = (i - 1 + n) % n, guard = 0;
      while (Math.hypot(c[j].x - cur.x, c[j].y - cur.y) < 1e-6 && guard++ < n) j = (j - 1 + n) % n;
      let k = (i + 1) % n; guard = 0;
      while (Math.hypot(c[k].x - cur.x, c[k].y - cur.y) < 1e-6 && guard++ < n) k = (k + 1) % n;
      let ix = cur.x - c[j].x, iy = cur.y - c[j].y; const lin = Math.hypot(ix, iy) || 1; ix /= lin; iy /= lin;
      let ox = c[k].x - cur.x, oy = c[k].y - cur.y; const lout = Math.hypot(ox, oy) || 1; ox /= lout; oy /= lout;
      let d = ix * ox + iy * oy, sx = 0, sy = 0;
      if (d > -0.9375) {
        d += 1; sx = iy + oy; sy = ix + ox;
        if (cw) sx = -sx; else sy = -sy;
        let q = ox * iy - oy * ix; if (cw) q = -q;
        const l = Math.min(lin, lout);
        sx = (xs * q <= l * d) ? sx * xs / d : sx * l / q;
        sy = (ys * q <= l * d) ? sy * ys / d : sy * l / q;
      }
      return { x: cur.x + sx, y: cur.y + sy, on: cur.on };
    });
  });
}

function rotate(contours, a) {
  if (!a) return contours;
  const c = Math.cos(a), s = Math.sin(a);
  return contours.map(ct => ct.map(p => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c, on: p.on })));
}

export function advanceOf(g, plan) {
  if (g.advance === 0) return 0;
  return Math.max(0, g.advance * plan.spec.w * plan.spec.sc + plan.advGrowth + plan.track);
}

/** Instant preview. Keeps every point, so it is also the morph target. */
export function draftGlyph(g, plan) {
  const isMark = g.advance === 0;
  let contours = cloneContours(g.contours);
  const mapper = makeMapper(plan.spec, g.zone);
  for (const c of contours) for (const p of c) { const [x, y] = mapper(p.x, p.y); p.x = x; p.y = y; }
  // Approximates the stroke-preserving compensation that the precise path does exactly.
  const comp = plan.keepStems && plan.spec.w !== 1 ? plan.stemV * (1 - plan.spec.w) : 0;
  const ex = plan.gx + comp, ey = plan.gy;
  if (ex || ey) contours = rotate(embolden(rotate(contours, -plan.penAngle), ex, ey), plan.penAngle);
  const shift = isMark ? 0 : plan.advGrowth / 2 + plan.track / 2;
  if (shift) for (const c of contours) for (const p of c) p.x += shift;
  return { contours, advance: advanceOf(g, plan) };
}

/** Plain-data job for the precise engine (shipped to a worker). */
export function preciseJob(g, plan) {
  const isMark = g.advance === 0;
  return {
    contours: g.contours, upm: plan.upm, zone: g.zone, spec: plan.spec, stemV: plan.stemV, stemH: plan.stemH,
    mapped: plan.geometric || plan.spec.sc !== 1 || plan.spec.base !== 0,
    core: plan.core, compX: plan.compX,
    pen: { rx: plan.gx / 2, ry: plan.gy / 2, angle: plan.penAngle },
    round: { outer: plan.roundOuter, inner: plan.roundInner },
    inktrap: plan.inktrap, tension: plan.tension,
    shiftX: isMark ? 0 : plan.advGrowth / 2 + plan.track / 2,
  };
}

/** Does this plan need the precise engine? Pure mapping changes are already exact in the draft. */
export const needsPrecise = plan => !!(plan.gx || plan.gy || plan.core || plan.roundOuter || plan.roundInner || plan.inktrap || plan.tension !== 1 || plan.compX);

/** Affine part for GPOS anchors — identical mapping and shifts to the outlines. */
export function transformAnchor(x, y, plan, { zone, isMark }) {
  const [nx, ny] = makeMapper(plan.spec, zone)(x, y);
  return [nx + (isMark ? 0 : plan.advGrowth / 2 + plan.track / 2), ny];
}
