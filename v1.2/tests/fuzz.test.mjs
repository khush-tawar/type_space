// Robustness sweep: many scripts × extreme settings through the precise engine.
import fs from 'fs';
import Clipper from 'clipper-lib';
import { loadFont } from '../js/core/font-model.js';
import { analyzeFont } from '../js/core/analysis.js';
import { buildRemixBinary } from '../js/core/remix.js';
import { useClipper, refineGlyph } from '../js/core/outline.js';
import { makeMapper } from '../js/core/transforms.js';
useClipper(Clipper);
const GF = 'https://raw.githubusercontent.com/google/fonts/main/';
const FONTS = {
  arabic: 'ofl/notonaskharabic/NotoNaskhArabic%5Bwght%5D.ttf', hebrew: 'ofl/notosanshebrew/NotoSansHebrew%5Bwdth,wght%5D.ttf',
  thai: 'ofl/notosansthai/NotoSansThai%5Bwdth,wght%5D.ttf', cherokee: 'ofl/notosanscherokee/NotoSansCherokee%5Bwght%5D.ttf',
  olchiki: 'ofl/notosansolchiki/NotoSansOlChiki%5Bwght%5D.ttf', tirhuta: 'ofl/notosanstirhuta/NotoSansTirhuta-Regular.ttf',
  fraunces: 'ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf', bengali: 'ofl/notosansbengali/NotoSansBengali%5Bwdth,wght%5D.ttf',
  tamil: 'ofl/notosanstamil/NotoSansTamil%5Bwdth,wght%5D.ttf', garamond: 'ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf',
};
const CACHE = new URL('../../tests/.cache/', import.meta.url);
const SETTINGS = [
  { weight: 140, contrast: -60 }, { weight: -55, width: 145, slant: -12 }, { width: 62, xHeight: 125, ascender: 85, descender: 120 },
  { roundOuter: 70, roundInner: 50, inktrap: 35, tension: 35 }, { contrast: 100, penAngle: 45, weight: 30, dots: 170, headline: 120, waist: 20 },
];
const refine = job => refineGlyph(job, job.mapped ? makeMapper(job.spec, job.zone) : null);
let failures = 0;
for (const [name, path] of Object.entries(FONTS)) {
  const p = new URL(`fz-${name}.ttf`, CACHE);
  if (!fs.existsSync(p)) fs.writeFileSync(p, new Uint8Array(await (await fetch(GF + path)).arrayBuffer()));
  const m = await loadFont(fs.readFileSync(p)); const a = analyzeFont(m);
  for (const [i, st] of SETTINGS.entries()) {
    const t = performance.now();
    try {
      const r = buildRemixBinary({ base: m, baseAnalysis: a, settings: st, donors: [], meta: { family: 'F', style: 'Regular' } }, { refine });
      const bad = r.glyphs.filter(g => g.contours.some(c => c.some(q => !Number.isFinite(q.x) || !Number.isFinite(q.y)))).length;
      const lost = r.prep.items.filter((it, k) => it.contours.length && !r.glyphs[k].contours.length).length;
      const re = await loadFont(r.bytes);
      const ok = !bad && lost <= Math.ceil(m.numGlyphs * 0.002) && re.numGlyphs === r.glyphs.length;
      if (!ok) failures++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} #${i} ${a.primary.id} ${m.numGlyphs} glyphs ${Math.round(performance.now() - t)} ms${bad ? ` NaN:${bad}` : ''}${lost ? ` lost:${lost}` : ''}`);
    } catch (e) { failures++; console.log(`FAIL ${name} #${i}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
  }
}
process.exit(failures ? 1 : 0);
