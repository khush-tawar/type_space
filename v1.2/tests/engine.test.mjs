// v1.2 engine tests (Node 20+). Fixtures are cached in tests/.cache at the repo root.
import fs from 'fs';
import Clipper from 'clipper-lib';
import { loadFont } from '../js/core/font-model.js';
import { analyzeFont } from '../js/core/analysis.js';
import { buildRemixBinary, prepareRemix, draftGlyphs } from '../js/core/remix.js';
import { buildMorphFont } from '../js/core/variable.js';
import { useClipper, refineGlyph } from '../js/core/outline.js';
import { makeMapper } from '../js/core/transforms.js';
import { readFontFile } from '../js/core/sfnt.js';
useClipper(Clipper);

const GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl/';
const FIX = { hind: GF + 'hind/Hind-Regular.ttf', deva: GF + 'notosansdevanagari/NotoSansDevanagari%5Bwdth,wght%5D.ttf', playfair: GF + 'playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf', inter: GF + 'inter/Inter%5Bopsz,wght%5D.ttf' };
const CACHE = new URL('../../tests/.cache/', import.meta.url);
fs.mkdirSync(CACHE, { recursive: true });
async function fixture(n) { const p = new URL(`${n}.ttf`, CACHE); if (!fs.existsSync(p)) fs.writeFileSync(p, new Uint8Array(await (await fetch(FIX[n])).arrayBuffer())); return fs.readFileSync(p); }
const refine = job => refineGlyph(job, job.mapped ? makeMapper(job.spec, job.zone) : null);
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };

// 1. identity is still lossless
const hind = await loadFont(await fixture('hind'));
const id = buildRemixBinary({ base: hind, baseAnalysis: analyzeFont(hind), settings: {}, donors: [], meta: { family: 'Hind Copy', style: 'Regular' } }, { refine });
const back = await loadFont(id.bytes);
let diff = 0;
hind.glyphs.forEach((g, i) => { const a = g.contours.flat(), b = back.glyphs[i].contours.flat(); if (a.length !== b.length || g.advance !== back.glyphs[i].advance || a.some((p, k) => p.x !== b[k].x || p.y !== b[k].y)) diff++; });
check('identity round-trip', diff === 0, `${diff} glyphs differ`);
check('GSUB byte-identical', Buffer.compare(Buffer.from((await readFontFile(await fixture('hind'))).tables.get('GSUB')), Buffer.from((await readFontFile(id.bytes)).tables.get('GSUB'))) === 0);

// 2. precise remix of a variable Devanagari font with a Latin donor
const deva = await loadFont(await fixture('deva'));
const pf = await loadFont(await fixture('playfair'));
const project = { base: deva, baseAnalysis: analyzeFont(deva), settings: { weight: 60, slant: 6, width: 115, headline: 30, dots: 120, roundOuter: 12, inktrap: 8 },
  donors: [{ id: 'pf', model: pf, analysis: analyzeFont(pf), scripts: ['latn', 'zyyy'], mode: 'replace', adjust: {} }], meta: { family: 'Precise Test', style: 'Bold' } };
const t0 = performance.now();
const r = buildRemixBinary(project, { refine });
const ms = performance.now() - t0;
const rb = await loadFont(r.bytes);
check('precise remix compiles and re-reads', rb.numGlyphs === r.glyphs.length, `${rb.numGlyphs} glyphs in ${Math.round(ms)} ms`);
const nan = r.glyphs.some(g => g.contours.some(c => c.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))));
check('no NaN coordinates', !nan);
const empty = r.prep.items.filter((it, i) => it.contours.length && !r.glyphs[i].contours.length).length;
check('no glyph vanished', empty === 0, `${empty} lost`);
fs.writeFileSync(new URL('precise.ttf', CACHE), r.bytes);

// 3. morph font is a valid variable font
const prep = prepareRemix(project);
const morph = buildMorphFont(project, prep, draftGlyphs(prep));
const mt = await readFontFile(morph);
check('morph font has fvar+gvar', mt.tables.has('fvar') && mt.tables.has('gvar'), `${(morph.length / 1024).toFixed(0)} KB`);
fs.writeFileSync(new URL('morph.ttf', CACHE), morph);

// 4. thin + wide + slanted Latin stays connected (topology preserved)
const inter = await loadFont(await fixture('inter'));
const ia = analyzeFont(inter);
const thin = buildRemixBinary({ base: inter, baseAnalysis: ia, settings: { weight: -55, width: 150, slant: 10 }, donors: [], meta: {} }, { refine });
const pieces = ch => thin.glyphs[inter.cmap.get(ch.codePointAt(0))].contours.length;
const srcPieces = ch => inter.glyphs[inter.cmap.get(ch.codePointAt(0))].contours.length;
const broken = [...'hkmnurBEFHKMRxyz'].filter(ch => pieces(ch) > Math.max(1, srcPieces(ch)) + 0 && pieces(ch) > 1);
check('thin/wide/slanted letters stay in one piece', broken.length === 0, broken.join(''));
process.exit(failed ? 1 : 0);
