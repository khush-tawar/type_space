// v1.2 remix pipeline.
//   prepareRemix  — merge base + donors + edits, resolve per-script plans, run structure-preserving pre-steps
//   draftGlyphs   — instant outlines (point-compatible with the source → also the morph target)
//   preciseJobs   — plain-data jobs for the stroke-aware engine (outline.js, run in a worker)
//   compileRemix  — TrueType binary from whichever outlines are ready
import { planTransform, draftGlyph, preciseJob, needsPrecise, transformAnchor, zoneApplies, scaleDots, adjustHeadline, advanceOf } from './transforms.js';
import { scriptOf, scriptById } from './scripts.js';
import { compileFont } from './build.js';
import { cloneContours } from './geometry.js';

export const COMMON = 'zyyy';
const isCommon = cp => !scriptOf(cp) && cp >= 0x20 && !(cp >= 0xD800 && cp <= 0xDFFF);

function scriptIdOf(cps, fallback) {
  for (const cp of cps) { const s = scriptOf(cp); if (s) return s.id; }
  return fallback;
}

export function metricsFor(base, analysis, sid) {
  const ps = analysis.perScript[sid];
  const m = analysis.metrics;
  return {
    upm: m.upm, script: sid,
    stemV: ps?.stemV || m.stemV, stemH: ps?.stemH || m.stemH, xHeight: ps?.zone || m.xHeight,
    capHeight: base.info.capHeight || 0, ascender: Math.max(base.info.ascender, base.info.hheaAscender || 0),
    headline: !!ps?.headline,
  };
}

/** Scale + stem match of a donor script to the base. Returns { scale, xs, ys, why, baseline }. */
export function harmonize(base, baseA, donor, donorA, sid, adjust = {}) {
  const dm = donorA.perScript[sid] || { zone: donorA.metrics.xHeight, stemV: donorA.metrics.stemV, stemH: donorA.metrics.stemH };
  const target = baseA.perScript[sid];
  let scale, why;
  if (target && target.zone && dm.zone) {
    scale = target.zone / dm.zone;
    why = `${scriptById(sid)?.name || sid} main zone matched to base (${target.zone} u)`;
  } else {
    scale = (base.upm / donor.upm) * (baseA.metrics.xHeight / base.upm) / (donorA.metrics.xHeight / donor.upm);
    why = `body height matched to base ${baseA.primary.name} zone`;
  }
  scale *= 1 + (adjust.scale || 0) / 100;
  const tV = (target?.stemV || baseA.metrics.stemV) * (1 + (adjust.weight || 0) / 100);
  const tH = (target?.stemH || baseA.metrics.stemH) * (1 + (adjust.weight || 0) / 100);
  const xs = adjust.matchWeight === false ? 0 : tV - dm.stemV * scale;
  const ys = adjust.matchWeight === false ? 0 : tH - dm.stemH * scale;
  return { scale, xs, ys, why, baseline: (adjust.baseline || 0) };
}

/**
 * project: { base, baseAnalysis, settings, scriptSettings, donors:[{id, model, analysis, scripts, mode, adjust}], edits: Map, meta }
 */
export function prepareRemix(project) {
  const { base, baseAnalysis: A } = project;
  const primary = A.primary.id;
  const plans = new Map();
  const planFor = (sid, extra = null, key = sid) => {
    if (!plans.has(key)) {
      const p = planTransform({ ...project.settings, ...(project.scriptSettings?.[sid] || {}) }, metricsFor(base, A, sid));
      if (extra) { p.gx += extra.xs; p.gy += extra.ys; p.advGrowth += extra.xs; }
      plans.set(key, p);
    }
    return key;
  };
  const edits = project.edits || new Map();
  const items = base.glyphs.map(g => {
    const unicodes = base.unicodesOf(g.gid);
    const script = scriptIdOf(unicodes, primary);
    const contours = edits.get(`base:${g.gid}`) || g.contours;
    return { name: g.name, advance: g.advance, orig: contours, unicodes, source: 'base', srcGid: g.gid, script, zone: zoneApplies(g, unicodes), planKey: planFor(script) };
  });
  const cmap = new Map(base.cmap);
  const warnings = [], donorReport = [];

  for (const d of project.donors || []) {
    if (!d.model || !d.scripts?.length) continue;
    const harm = {};
    let added = 0, replaced = 0;
    const wanted = new Set(d.scripts);
    const byGid = new Map();
    for (const [cp, gid] of d.model.cmap) {
      const s = scriptOf(cp);
      const sid = s ? s.id : (isCommon(cp) ? COMMON : null);
      if (!sid || !wanted.has(sid) || cp === 0x20 || cp === 0xA0) continue;
      if (d.mode === 'fill' && cmap.has(cp)) continue;
      const hs = sid === COMMON ? (d.scripts.find(x => x !== COMMON) || 'latn') : sid;
      if (!harm[hs]) harm[hs] = harmonize(base, A, d.model, d.analysis, hs, d.adjust);
      const h = harm[hs];
      let item = byGid.get(gid);
      if (!item) {
        const src = d.model.glyphs[gid];
        const contours = cloneContours(edits.get(`${d.id}:${gid}`) || src.contours);
        const baseline = h.baseline * base.upm / 1000;
        for (const c of contours) for (const p of c) { p.x *= h.scale; p.y = p.y * h.scale + baseline; }
        item = {
          name: src.name, advance: src.advance * h.scale, orig: contours, unicodes: [], source: d.id, srcGid: gid, script: hs,
          zone: true, planKey: planFor(hs, h, `${hs}|${d.id}`),
        };
        byGid.set(gid, item);
      }
      item.unicodes.push(cp);
      if (cmap.has(cp) && d.mode !== 'fill' && items[cmap.get(cp)].source === 'base') {
        const t = cmap.get(cp);
        items[t] = { ...item, name: items[t].name, unicodes: items[t].unicodes, replaced: true };
        replaced++;
        continue;
      }
      if (item.gid == null) {
        item.gid = items.length;
        if (item.name && items.some(g => g.name === item.name)) item.name = `${item.name}.${d.id}`;
        items.push(item);
      }
      cmap.set(cp, item.gid); added++;
    }
    for (const it of byGid.values()) it.zone = zoneApplies(it, it.unicodes);
    const shapers = d.scripts.map(scriptById).filter(s => s?.shaping);
    if (shapers.length) warnings.push(`${d.model.info.family}: ${shapers.map(s => s.name).join(', ')} needs OpenType shaping. Only its default letterforms were imported — use it as the base font to keep conjuncts, joining and mark positioning.`);
    donorReport.push({ id: d.id, family: d.model.info.family, added, replaced, harmonization: Object.fromEntries(Object.entries(harm).map(([k, v]) => [k, { scale: +v.scale.toFixed(3), weightDelta: Math.round(v.xs), why: v.why }])) });
  }
  if (items.length > 65535) throw new Error('The remix exceeds 65,535 glyphs. Import fewer scripts.');

  // Structure-preserving pre-steps per glyph: dots/diacritic size, headline thickness.
  for (const it of items) {
    const plan = plans.get(it.planKey);
    let c = it.orig;
    if (plan.dotsK !== 1) c = scaleDots(c, plan.dotsK, plan.stemV);
    if (plan.headlineDelta && A.perScript[it.script]?.headline) c = adjustHeadline(c, plan.spec.X, plan.stemH, plan.headlineDelta);
    it.contours = c;
  }

  const anchorFn = (gid, x, y, role) => {
    const it = items[gid];
    if (!it) return [x, y];
    return transformAnchor(x, y, plans.get(it.planKey), { zone: it.zone, isMark: role === 'mark' || it.advance === 0 });
  };
  const bp = plans.get(primary) || plans.values().next().value;
  const s = { ...project.settings };
  const meta = {
    ...project.meta,
    weightClass: Math.round(Math.min(1000, Math.max(1, (base.info.weightClass || 400) * (1 + (s.weight || 0) / 100 * 0.9))) / 10) * 10,
    widthClass: Math.min(9, Math.max(1, Math.round(5 + ((s.width ?? 100) - 100) / 12.5))),
    italicAngle: -(s.slant || 0) + (base.info.italicAngle || 0),
    xHeight: A.perScript.latn ? A.perScript.latn.zone * (s.xHeight ?? 100) / 100 : 0,
    capHeight: base.info.capHeight,
  };
  return { items, plans, cmap, warnings, donorReport, anchorFn, meta, xScale: bp.spec.w * bp.spec.sc * bp.kern };
}

export function draftGlyphs(prep) {
  return prep.items.map(it => {
    const plan = prep.plans.get(it.planKey);
    if (plan.isIdentity && !it.replaced && it.source === 'base') return { contours: it.contours, advance: it.advance, name: it.name };
    const r = draftGlyph(it, plan);
    return { contours: r.contours, advance: r.advance, name: it.name };
  });
}

/** Jobs for glyphs that need the precise engine: [{ gid, key, job }]. key identifies cacheable work. */
export function preciseJobs(prep) {
  const out = [];
  prep.items.forEach((it, gid) => {
    const plan = prep.plans.get(it.planKey);
    if (!needsPrecise(plan) || !it.contours.length) return;
    const job = preciseJob(it, plan);
    out.push({ gid, key: jobKey(job), job });
  });
  return out;
}

export const advances = prep => prep.items.map(it => advanceOf(it, prep.plans.get(it.planKey)));

function jobKey(job) {
  // FNV-1a over the geometry and parameters — cheap and stable across builds.
  let h = 0x811c9dc5;
  const mix = v => { const x = Math.round(v * 8) | 0; h ^= x & 0xff; h = Math.imul(h, 16777619); h ^= (x >>> 8) & 0xff; h = Math.imul(h, 16777619); h ^= (x >>> 16) & 0xff; h = Math.imul(h, 16777619); };
  for (const c of job.contours) { mix(c.length); for (const p of c) { mix(p.x); mix(p.y); mix(p.on ? 1 : 0); } }
  const s = job.spec;
  for (const v of [s.w, s.sc, s.tan, s.kz, s.ka, s.kd, s.waist, s.base, job.zone ? 1 : 0, job.core, job.compX, job.pen.rx, job.pen.ry, job.pen.angle, job.round.outer, job.round.inner, job.inktrap, job.tension, job.shiftX]) mix((v || 0) * 100);
  return (h >>> 0).toString(36) + job.contours.length;
}

/** glyphs: [{contours, advance, name}] — draft and/or refined outlines. */
export function compileRemix(project, prep, glyphs, extra = {}) {
  return compileFont(project.base, { glyphs, cmap: prep.cmap, anchorFn: prep.anchorFn, xScale: prep.xScale, extraTables: extra.tables }, { ...prep.meta, ...extra.meta });
}

/** Synchronous build (Node/tests). `refine(job)` runs the precise engine; omit for draft only. */
export function buildRemixBinary(project, { refine = null } = {}) {
  const prep = prepareRemix(project);
  const glyphs = draftGlyphs(prep);
  if (refine) for (const { gid, job } of preciseJobs(prep)) glyphs[gid] = { ...glyphs[gid], contours: refine(job) };
  const bytes = compileRemix(project, prep, glyphs);
  return { bytes, glyphs, prep, cmap: prep.cmap, warnings: prep.warnings, donorReport: prep.donorReport, meta: prep.meta, source: prep.items };
}
