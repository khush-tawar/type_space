// Outline measurement and typographic classification. Everything here is computed from the
// actual vector data (scanline intersections), so it works for any script the font covers.
import { bbox, scanlineX, scanlineY } from './geometry.js';
import { glyphForChar, measuredHeights } from './font-model.js';
import { scriptCoverage, scriptById, coveredLetters, primaryScript } from './scripts.js';

const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

function spans(xs) { const out = []; for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]); return out; }

function rotate(contours, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return contours.map(ct => ct.map(p => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c, on: p.on })));
}

/** Stroke thickness along a line through (cx, cy) at `angle` (radians): the span containing the line's first ink. */
function thicknessAlong(contours, cx, cy, angle) {
  const moved = contours.map(ct => ct.map(p => ({ x: p.x - cx, y: p.y - cy, on: p.on })));
  const r = rotate(moved, -angle);
  const sp = spans(scanlineX(r, 0.01));
  return sp.length ? Math.min(...sp.map(([a, b]) => b - a)) : 0;
}

function glyphOf(model, cp) { const gid = model.cmap.get(cp); return gid == null ? null : model.glyphs[gid]; }

/** Vertical stem, horizontal stroke and main-zone height for one script, measured from up to 40 letters. */
export function measureScript(model, script) {
  const upm = model.upm;
  const letters = coveredLetters(script, model.cmap).slice(0, 60);
  const glyphs = letters.map(cp => glyphOf(model, cp)).filter(g => g && g.contours.length && g.advance > 0);
  if (!glyphs.length) return null;

  let zone;
  const refH = script.refHeight && glyphOf(model, script.refHeight.codePointAt(0));
  if (refH && refH.contours.length) zone = bbox(refH.contours).yMax;
  else if (script.id === 'latn') zone = measuredHeights(model).xHeight;
  else zone = median(glyphs.map(g => bbox(g.contours).yMax));

  const minSpan = upm * 0.012;
  let stemV;
  const refS = script.refStem && glyphOf(model, script.refStem.codePointAt(0));
  if (refS && refS.contours.length) {
    const b = bbox(refS.contours);
    const sp = spans(scanlineX(refS.contours, b.yMin + (b.yMax - b.yMin) * 0.45)).map(([a, c]) => c - a).filter(w => w > minSpan);
    stemV = sp.length ? Math.min(...sp) : 0;
  }
  if (!stemV) {
    const widths = [];
    for (const g of glyphs) for (const [a, c] of spans(scanlineX(g.contours, zone * 0.4))) if (c - a > minSpan && c - a < upm * 0.35) widths.push(c - a);
    stemV = median(widths);
  }
  let stemH;
  const bar = script.refBar && glyphOf(model, script.refBar.codePointAt(0));
  if (bar && bar.contours.length) {
    const b = bbox(bar.contours);
    const sp = spans(scanlineY(bar.contours, (b.xMin + b.xMax) / 2)).map(([a, c]) => c - a).filter(w => w > minSpan);
    stemH = sp.length ? Math.min(...sp) : 0;
  }
  if (!stemH) {
    const hs = [];
    for (const g of glyphs) {
      const b = bbox(g.contours);
      for (const [a, c] of spans(scanlineY(g.contours, (b.xMin + b.xMax) / 2))) if (c - a > minSpan && c - a < upm * 0.3) hs.push(c - a);
    }
    stemH = median(hs);
  }
  // Headline detection: share of letters whose top band is mostly ink.
  let headlined = 0;
  for (const g of glyphs) {
    const b = bbox(g.contours);
    const xs = spans(scanlineX(g.contours, zone - stemH * 0.5));
    const ink = xs.reduce((s, [a, c]) => s + (c - a), 0);
    if (ink > (b.xMax - b.xMin) * 0.7) headlined++;
  }
  const avgWidth = median(glyphs.map(g => g.advance));
  return {
    script: script.id, letters: glyphs.length,
    zone: Math.round(zone), stemV: Math.round(stemV), stemH: Math.round(stemH),
    contrast: stemH ? +(stemV / stemH).toFixed(2) : 1,
    headline: headlined / glyphs.length > 0.55,
    widthRatio: zone ? +(avgWidth / zone).toFixed(2) : 1,
  };
}

function latinClassification(model, m) {
  const notes = [];
  const g = ch => glyphForChar(model, ch);
  const H = measuredHeights(model);
  const o = g('o'), n = g('n') || g('h'), c = g('c');
  let serif = false, slab = false, stressDeg = 90, aperture = null, circular = false;
  if (n && n.contours.length) {
    // Feet of “n”: serif faces carry extra ink just above the baseline.
    const b = bbox(n.contours);
    const ink = y => spans(scanlineX(n.contours, y)).reduce((s, [a, cc]) => s + cc - a, 0);
    const foot = ink(b.yMin + H.xHeight * 0.02), mid = ink(b.yMin + H.xHeight * 0.4);
    serif = foot > mid * 1.35;
    if (serif) {
      const v = spans(scanlineY(n.contours, b.xMin + (b.xMax - b.xMin) * 0.03));
      const t = v.length ? v[0][1] - v[0][0] : 0;
      slab = t > m.stemV * 0.55;
    }
  }
  if (o && o.contours.length) {
    const b = bbox(o.contours);
    const cx = (b.xMin + b.xMax) / 2, cy = (b.yMin + b.yMax) / 2;
    let thin = Infinity;
    for (let deg = 0; deg < 180; deg += 6) {
      const t = thicknessAlong(o.contours, cx, cy, deg * Math.PI / 180);
      if (t > 0 && t < thin) { thin = t; stressDeg = deg; }
    }
    const ratio = (b.xMax - b.xMin) / (b.yMax - b.yMin);
    circular = ratio > 0.93 && m.contrast < 1.35;
  }
  if (c && c.contours.length) {
    const b = bbox(c.contours);
    const v = spans(scanlineY(c.contours, b.xMin + (b.xMax - b.xMin) * 0.88));
    if (v.length >= 2) aperture = (v[1][0] - v[0][1]) / (b.yMax - b.yMin);
    else if (v.length <= 1) aperture = 0.6;
  }
  // stressDeg is the direction of the thinnest stroke through the centre: 90° = vertical stress axis.
  const oblique = Math.abs(stressDeg - 90) > 14;
  let cls, family;
  if (serif) {
    family = 'Serif';
    if (slab) cls = m.contrast > 1.6 ? 'Clarendon / Ionic slab' : 'Slab serif (Mechanistic)';
    else if (m.contrast > 3.2 && !oblique) cls = 'Didone (Modern)';
    else if (!oblique) cls = 'Transitional';
    else cls = m.contrast > 1.9 ? 'Garalde (Old-style)' : 'Venetian / Humanist serif';
  } else {
    family = 'Sans serif';
    if (circular) cls = 'Geometric sans';
    else if (aperture != null && aperture > 0.45) cls = 'Humanist sans';
    else cls = m.contrast > 1.35 ? 'Grotesque' : 'Neo-grotesque';
  }
  notes.push(`${serif ? (slab ? 'Slab' : 'Bracketed/hairline') + ' serifs on “n” feet' : 'No serifs on “n” feet'}`);
  notes.push(`Stress axis ${oblique ? `oblique (${Math.abs(90 - stressDeg)}° from vertical)` : 'vertical'}`);
  if (aperture != null) notes.push(`Aperture of “c”: ${aperture > 0.45 ? 'open' : aperture > 0.2 ? 'moderate' : 'closed'} (${aperture.toFixed(2)})`);
  return { family, cls, serif, slab, stressDeg, aperture, notes };
}

const WEIGHT_NAMES = [[0.07, 'Thin'], [0.1, 'Light'], [0.14, 'Regular'], [0.18, 'Medium'], [0.23, 'Semibold'], [0.3, 'Bold'], [Infinity, 'Black']];

export function analyzeFont(model) {
  const coverage = scriptCoverage(model.cmap);
  const primary = primaryScript(model.cmap);
  const perScript = {};
  for (const { script } of coverage.slice(0, 8)) {
    const m = measureScript(model, script);
    if (m) perScript[script.id] = m;
  }
  const pm = perScript[primary.id] || Object.values(perScript)[0] || { stemV: model.upm * 0.08, stemH: model.upm * 0.07, zone: model.upm * 0.5, contrast: 1.1, widthRatio: 1 };
  const weightRatio = pm.stemV / (pm.zone || model.upm * 0.5);
  const weightName = WEIGHT_NAMES.find(([t]) => weightRatio < t)[1];
  const widthName = pm.widthRatio < 0.95 ? 'Condensed' : pm.widthRatio > 1.35 ? 'Extended' : 'Normal width';
  const contrastName = pm.contrast < 1.25 ? 'Monolinear' : pm.contrast < 1.9 ? 'Low contrast' : pm.contrast < 3 ? 'Moderate contrast' : 'High contrast';
  const latin = perScript.latn ? latinClassification(model, perScript.latn) : null;
  const ps = scriptById(primary.id);
  const traits = [weightName, widthName, contrastName];
  if (pm.headline) traits.push('Headline (shirorekha) construction');
  if (Math.abs(model.info.italicAngle) > 0.5) traits.push(`Italic/oblique ${Math.abs(model.info.italicAngle).toFixed(1)}°`);
  return {
    primary: ps, coverage, perScript,
    metrics: { upm: model.upm, stemV: pm.stemV, stemH: pm.stemH, xHeight: pm.zone, ascender: model.info.ascender, contrast: pm.contrast, weightRatio: +weightRatio.toFixed(3) },
    weightName, widthName, contrastName, traits, latin,
    classification: ps.id === 'latn' && latin ? latin.cls : `${ps.name} ${pm.contrast > 1.9 ? 'modulated (calligraphic)' : 'monolinear'} ${ps.type}${pm.headline ? ' with headline' : ''}`,
    glyphCount: model.numGlyphs, codepoints: model.cmap.size,
  };
}

/** Numeric feature vector used by the learner (kept stable — order matters). */
export function featureVector(analysis) {
  const m = analysis.metrics;
  return [
    1,
    m.weightRatio * 5,
    Math.min(m.contrast, 5) / 2,
    (m.xHeight / m.upm) * 2,
    analysis.latin?.serif ? 1 : 0,
    analysis.perScript[analysis.primary.id]?.headline ? 1 : 0,
    analysis.primary.shaping ? 1 : 0,
  ];
}
