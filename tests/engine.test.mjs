// Engine regression tests (Node 20+). Downloads two open fonts on first run into tests/.cache.
import fs from 'fs';
import { loadFont } from '../js/core/font-model.js';
import { analyzeFont } from '../js/core/analysis.js';
import { buildRemixBinary } from '../js/core/remix.js';
import { readFontFile, sfntToWoff } from '../js/core/sfnt.js';

const GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl/';
const FIXTURES = { hind: GF + 'hind/Hind-Regular.ttf', deva: GF + 'notosansdevanagari/NotoSansDevanagari%5Bwdth,wght%5D.ttf', playfair: GF + 'playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf' };
fs.mkdirSync('tests/.cache', { recursive: true });
async function fixture(name) {
  const p = `tests/.cache/${name}.ttf`;
  if (!fs.existsSync(p)) fs.writeFileSync(p, new Uint8Array(await (await fetch(FIXTURES[name])).arrayBuffer()));
  return fs.readFileSync(p);
}
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };

// 1. Identity remix is lossless for a static TrueType font.
const hind = await loadFont(await fixture('hind'));
const id = buildRemixBinary({ base: hind, baseAnalysis: analyzeFont(hind), settings: {}, donors: [], meta: { family: 'Hind Copy', style: 'Regular' } });
const back = await loadFont(id.bytes);
let diff = 0;
hind.glyphs.forEach((g, i) => {
  const a = g.contours.flat(), b = back.glyphs[i].contours.flat();
  if (a.length !== b.length || g.advance !== back.glyphs[i].advance || a.some((p, k) => p.x !== b[k].x || p.y !== b[k].y || p.on !== b[k].on)) diff++;
});
check('identity round-trip (outlines, advances)', diff === 0, `${diff} of ${hind.numGlyphs} glyphs differ`);
check('cmap preserved', [...hind.cmap].every(([cp, g]) => back.cmap.get(cp) === g));
const src = await readFontFile(await fixture('hind')), out = await readFontFile(id.bytes);
check('GSUB carried byte-for-byte', Buffer.compare(Buffer.from(src.tables.get('GSUB')), Buffer.from(out.tables.get('GSUB'))) === 0);
check('renamed family', back.info.family === 'Hind Copy');

// 2. Variable instancing + donor remix produce a font that re-reads cleanly.
const deva = await loadFont(await fixture('deva'), { axisValues: { wght: 600 } });
const pf = await loadFont(await fixture('playfair'));
const remix = buildRemixBinary({ base: deva, baseAnalysis: analyzeFont(deva), settings: { weight: 30, slant: 8, width: 92, roundness: 10, tracking: 20 },
  donors: [{ id: 'pf', model: pf, analysis: analyzeFont(pf), scripts: ['latn', 'zyyy'], mode: 'replace', adjust: {} }], meta: { family: 'T', style: 'Bold Italic' } });
const rb = await loadFont(remix.bytes);
check('remix re-reads', rb.numGlyphs === remix.glyphs.length, `${rb.numGlyphs} glyphs`);
check('donor Latin mapped', rb.cmap.has(0x61) && rb.cmap.has(0x915));
check('marks keep zero advance', rb.glyphs[rb.cmap.get(0x94D)].advance === 0);
const woff = await sfntToWoff(remix.bytes);
check('WOFF wraps and re-reads', (await loadFont(woff)).numGlyphs === rb.numGlyphs, `${(woff.length / 1024).toFixed(0)} KB`);
process.exit(failed ? 1 : 0);
