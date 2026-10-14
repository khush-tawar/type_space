// Style transfer between fonts: measure a reference, compare with the base for one script,
// and solve for the parameters that move the base toward the reference.
import { analyzeFont, measureSlant } from '../core/analysis.js';
import { scriptById } from '../core/scripts.js';
import { penAngleFor } from '../core/transforms.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function styleProfile(model, analysis = analyzeFont(model)) {
  const out = { family: model.info.family, upm: model.upm, primary: analysis.primary.id, scripts: {}, latin: analysis.latin };
  for (const [sid, m] of Object.entries(analysis.perScript)) {
    out.scripts[sid] = { ...m, weightRatio: m.stemV / (m.zone || 1), zoneRatio: m.zone / model.upm, slant: measureSlant(model, scriptById(sid)) };
  }
  return out;
}

/**
 * Rows comparing reference and base for `sid`, each with the setting that transfers it.
 * Cross-script comparisons only transfer stroke features (weight, contrast, stress, slant);
 * proportions are script-specific and are offered only when both fonts cover the script.
 */
export function transferRows(ref, base, sid) {
  const b = base.scripts[sid] || base.scripts[base.primary];
  const same = !!ref.scripts[sid];
  const r = ref.scripts[sid] || ref.scripts[ref.primary];
  if (!b || !r) return [];
  const rows = [];
  const w = r.weightRatio / b.weightRatio - 1;
  rows.push({ key: 'weight', label: 'Stem weight (stem ÷ main zone)', base: b.weightRatio.toFixed(3), ref: r.weightRatio.toFixed(3), value: Math.round(clamp(w * 100, -60, 150)), on: true });
  // contrast: solve for the horizontal thinning that reproduces the reference's stem/bar ratio
  const cRef = Math.max(1, r.contrast), cb = Math.max(1, b.contrast);
  const c = ((1 + w) - (b.stemV * (1 + w)) / (cRef * b.stemH)) / 0.6;
  rows.push({ key: 'contrast', label: 'Contrast (stem ÷ bar)', base: cb.toFixed(2), ref: cRef.toFixed(2), value: Math.round(clamp(c * 100, -100, 100)), on: true });
  if (ref.latin && cRef > 1.35) {
    const pen = ((ref.latin.stressDeg - 90) + 360) % 180;
    const signed = pen > 90 ? pen - 180 : pen;
    rows.push({ key: 'penAngle', label: 'Stress angle (pen)', base: `${penAngleFor(sid, {})}°`, ref: `${signed}°`, value: Math.round(clamp(signed, -60, 90)), on: Math.abs(signed) > 6 });
  }
  const slant = (r.slant || 0) - (b.slant || 0);
  rows.push({ key: 'slant', label: 'Slant', base: `${b.slant || 0}°`, ref: `${r.slant || 0}°`, value: +clamp(slant, -20, 20).toFixed(1), on: Math.abs(slant) > 1 });
  if (same) {
    rows.push({ key: 'width', label: 'Width (advance ÷ zone)', base: b.widthRatio, ref: r.widthRatio, value: Math.round(clamp(100 * r.widthRatio / b.widthRatio, 60, 160)), on: true });
    rows.push({ key: 'xHeight', label: `${sid === 'latn' ? 'x-height' : 'Main zone'} (÷ em)`, base: b.zoneRatio.toFixed(3), ref: r.zoneRatio.toFixed(3), value: Math.round(clamp(100 * r.zoneRatio / b.zoneRatio, 75, 130)), on: true });
  } else {
    rows.push({ key: 'width', label: 'Width', base: '—', ref: '—', value: 100, on: false, note: `Proportions differ by script; ${scriptById(ref.primary)?.name} proportions do not transfer to ${scriptById(sid)?.name}.` });
  }
  return rows;
}

/** Turn selected rows into settings, scaled by strength (0–1.5) from the neutral value. */
export function rowsToSettings(rows, strength) {
  const neutral = { weight: 0, contrast: 0, penAngle: 0, slant: 0, width: 100, xHeight: 100 };
  const out = {};
  for (const r of rows) {
    if (!r.on) continue;
    const n = r.neutral ?? neutral[r.key] ?? 0;
    out[r.key] = +(n + (r.value - n) * strength).toFixed(1);
    if (r.key === 'weight' || r.key === 'contrast' || r.key === 'width' || r.key === 'xHeight') out[r.key] = Math.round(out[r.key]);
  }
  return out;
}
