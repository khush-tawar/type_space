// The remix pipeline: base font + donor fonts (per script) + manual point edits + parametric
// transforms -> compiled font binary.
import { planTransform, transformGlyph, transformAnchor, zoneApplies, embolden } from './transforms.js';
import { scriptOf, scriptById } from './scripts.js';
import { compileFont } from './build.js';
import { cloneContours } from './geometry.js';

export const COMMON = 'zyyy';
const isCommon = cp => !scriptOf(cp) && cp >= 0x20 && !(cp >= 0xD800 && cp <= 0xDFFF);

function scriptIdOf(cps, fallback) {
  for (const cp of cps) { const s = scriptOf(cp); if (s) return s.id; }
  return fallback;
}

function metricsFor(analysis, sid) {
  const ps = analysis.perScript[sid];
  const m = analysis.metrics;
  return ps ? { upm: m.upm, stemV: ps.stemV, stemH: ps.stemH, xHeight: ps.zone, ascender: m.ascender }
    : { upm: m.upm, stemV: m.stemV, stemH: m.stemH, xHeight: m.xHeight, ascender: m.ascender };
}

/**
 * Automatic harmonisation of a donor script to the base: scale to match the main zone,
 * then embolden to match stem thickness. Returns { scale, xs, ys, why }.
 */
export function harmonize(base, baseA, donor, donorA, sid, adjust = {}) {
  const dm = donorA.perScript[sid] || { zone: donorA.metrics.xHeight, stemV: donorA.metrics.stemV, stemH: donorA.metrics.stemH };
  const target = baseA.perScript[sid];
  const upmRatio = base.upm / donor.upm;
  let scale, why;
  if (target && target.zone && dm.zone) {
    scale = target.zone / dm.zone;
    why = `${scriptById(sid)?.name || sid} main zone matched to base (${target.zone} u)`;
  } else {
    scale = upmRatio * (baseA.metrics.xHeight / base.upm) / (donorA.metrics.xHeight / donor.upm);
    why = `body height matched to base ${baseA.primary.name} zone`;
  }
  scale *= 1 + (adjust.scale || 0) / 100;
  const tV = (target?.stemV || baseA.metrics.stemV) * (1 + (adjust.weight || 0) / 100);
  const tH = (target?.stemH || baseA.metrics.stemH) * (1 + (adjust.weight || 0) / 100);
  const xs = adjust.matchWeight === false ? 0 : tV - dm.stemV * scale;
  const ys = adjust.matchWeight === false ? 0 : tH - dm.stemH * scale;
  return { scale, xs, ys, why, baseline: adjust.baseline || 0 };
}

/**
 * project: {
 *   base, baseAnalysis, settings, scriptSettings: {sid: partialSettings},
 *   donors: [{ id, model, analysis, scripts:[sid|'zyyy'], mode:'replace'|'fill', adjust:{scale,weight,baseline,matchWeight} }],
 *   edits: Map<'base:gid'|'donorId:gid', contours>, meta
 * }
 */
export function assembleRemix(project) {
  const { base, baseAnalysis: A } = project;
  const primary = A.primary.id;
  const planCache = new Map();
  const planFor = sid => {
    if (!planCache.has(sid)) planCache.set(sid, planTransform({ ...project.settings, ...(project.scriptSettings?.[sid] || {}) }, metricsFor(A, sid)));
    return planCache.get(sid);
  };
  const edits = project.edits || new Map();
  const glyphs = base.glyphs.map(g => ({
    name: g.name, advance: g.advance,
    contours: edits.get(`base:${g.gid}`) || g.contours,
    unicodes: base.unicodesOf(g.gid), source: 'base', srcGid: g.gid,
  }));
  const cmap = new Map(base.cmap);
  const warnings = [];
  const donorReport = [];

  for (const d of project.donors || []) {
    if (!d.model || !d.scripts?.length) continue;
    const harm = {};
    let added = 0, replaced = 0;
    const wanted = new Set(d.scripts);
    const byGid = new Map();
    for (const [cp, gid] of d.model.cmap) {
      const s = scriptOf(cp);
      const sid = s ? s.id : (isCommon(cp) ? COMMON : null);
      if (!sid || !wanted.has(sid)) continue;
      if (cp === 0x20 || cp === 0xA0) continue; // keep the base's word spacing
      if (d.mode === 'fill' && cmap.has(cp)) continue;
      const hs = sid === COMMON ? (d.scripts.find(x => x !== COMMON) || scriptOf(0x61)?.id || 'latn') : sid;
      if (!harm[hs]) harm[hs] = harmonize(base, A, d.model, d.analysis, hs, d.adjust);
      const h = harm[hs];
      const src = d.model.glyphs[gid];
      let out = byGid.get(gid);
      if (!out) {
        let contours = cloneContours(edits.get(`${d.id}:${gid}`) || src.contours);
        for (const c of contours) for (const p of c) { p.x *= h.scale; p.y = p.y * h.scale + h.baseline; }
        let advance = src.advance * h.scale;
        if (h.xs || h.ys) {
          const isMark = src.advance === 0;
          contours = embolden(contours, h.xs, h.ys, { anchorLeft: !isMark });
          if (!isMark) advance += h.xs;
        }
        out = { name: src.name, advance, contours, unicodes: [], source: d.id, srcGid: gid, script: hs };
        byGid.set(gid, out);
      }
      out.unicodes.push(cp);
      if (cmap.has(cp) && d.mode !== 'fill') {
        const target = cmap.get(cp);
        if (glyphs[target].source === 'base') {
          glyphs[target] = { ...out, name: glyphs[target].name, unicodes: glyphs[target].unicodes, replaced: true };
          replaced++;
          continue;
        }
      }
      if (!out.gid) {
        out.gid = glyphs.length;
        if (out.name && glyphs.some(g => g.name === out.name)) out.name = `${out.name}.${d.id}`;
        glyphs.push(out);
      }
      cmap.set(cp, out.gid); added++;
    }
    const shapers = d.scripts.map(scriptById).filter(s => s?.shaping);
    if (shapers.length) warnings.push(`${d.model.info.family}: ${shapers.map(s => s.name).join(', ')} needs OpenType shaping. Only its default letterforms were imported — use it as the base font to keep conjuncts, joining and mark positioning.`);
    donorReport.push({ id: d.id, family: d.model.info.family, added, replaced, harmonization: Object.fromEntries(Object.entries(harm).map(([k, v]) => [k, { scale: +v.scale.toFixed(3), weightDelta: Math.round(v.xs), why: v.why }])) });
  }
  if (glyphs.length > 65535) throw new Error('The remix exceeds 65,535 glyphs. Import fewer scripts.');

  // Parametric transforms per glyph, using the plan of the glyph's script.
  const glyphInfo = [];
  const final = glyphs.map((g, gid) => {
    const sid = g.script || scriptIdOf(g.unicodes, primary);
    const plan = planFor(sid);
    const zone = zoneApplies(g, g.unicodes);
    const zoneX = metricsFor(A, sid).xHeight;
    glyphInfo[gid] = { plan, zone, zoneX, isMark: g.advance === 0 };
    const t = transformGlyph(g, plan, { zone, zoneX });
    return { contours: t.contours, advance: t.advance, name: g.name };
  });

  const basePlan = planFor(primary);
  const anchorFn = (gid, x, y, role) => {
    const info = glyphInfo[gid];
    if (!info) return [x, y];
    return transformAnchor(x, y, info.plan, { zone: info.zone, zoneX: info.zoneX, isMark: role === 'mark' || info.isMark });
  };

  const s = { ...project.settings };
  const weightClass = Math.round(Math.min(1000, Math.max(1, (base.info.weightClass || 400) * (1 + (s.weight || 0) / 100 * 0.9))) / 10) * 10;
  const widthClass = Math.min(9, Math.max(1, Math.round(5 + ((s.width ?? 100) - 100) / 12.5)));
  const meta = {
    ...project.meta,
    weightClass, widthClass,
    italicAngle: -(s.slant || 0) + (base.info.italicAngle || 0),
    xHeight: A.perScript.latn ? A.perScript.latn.zone * basePlan.zoneK : 0,
    capHeight: base.info.capHeight,
  };
  return { glyphs: final, cmap, anchorFn, xScale: basePlan.widthScale, meta, warnings, donorReport, source: glyphs };
}

export function buildRemixBinary(project) {
  const asm = assembleRemix(project);
  const bytes = compileFont(project.base, asm, asm.meta);
  return { bytes, ...asm };
}
