// Load a font binary into an editable model: decomposed quadratic outlines per glyph,
// Unicode map, metrics, and the untouched source tables for lossless re-export.
import { readFontFile } from './sfnt.js';
import { parseHead, parseHhea, parseMaxp, parseHmtx, parseCmap, parseName, parseOS2, parsePost, parseFvar, parseAvar, normalizeCoords } from './tables.js';
import { parseLoca, parseGvarHeader, resolveGlyph } from './glyf.js';
import { isClockwise, reverseContour, commandsToContours, bbox } from './geometry.js';

let opentypePromise = null;
async function loadOpentype() {
  if (!opentypePromise) opentypePromise = import('opentype.js').then(m => m.default || m);
  return opentypePromise;
}

export async function loadFont(buffer, { fileName = 'font', axisValues = null } = {}) {
  const { flavor, tables } = await readFontFile(buffer);
  for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'cmap']) {
    if (!tables.has(t)) throw new Error(`Font is missing the required '${t}' table.`);
  }
  if (tables.has('CFF2')) throw new Error('CFF2 (variable PostScript) fonts are not supported yet. Use the TrueType (.ttf) build of this family.');

  const head = parseHead(tables.get('head'));
  const hhea = parseHhea(tables.get('hhea'));
  const { numGlyphs } = parseMaxp(tables.get('maxp'));
  const { advances, lsbs } = parseHmtx(tables.get('hmtx'), numGlyphs, hhea.numberOfHMetrics);
  const { map: cmap, uvs } = parseCmap(tables.get('cmap'));
  const name = tables.has('name') ? parseName(tables.get('name')) : { records: [], get: () => '' };
  const os2 = tables.has('OS/2') ? parseOS2(tables.get('OS/2')) : null;
  const post = tables.has('post') ? parsePost(tables.get('post'), numGlyphs) : null;
  const fvar = tables.has('fvar') ? parseFvar(tables.get('fvar'), name) : null;
  const avar = fvar && tables.has('avar') ? parseAvar(tables.get('avar'), fvar.axes.length) : null;
  const isCFF = tables.has('CFF ');

  const model = {
    fileName,
    source: { flavor, tables, buffer: buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer) },
    upm: head.unitsPerEm,
    numGlyphs,
    cmap,
    uvs,
    names: name,
    info: {
      family: name.get(16) || name.get(1) || fileName.replace(/\.[^.]+$/, ''),
      style: name.get(17) || name.get(2) || 'Regular',
      designer: name.get(9), license: name.get(13), licenseURL: name.get(14), copyright: name.get(0),
      ascender: os2?.sTypoAscender ?? hhea.ascender,
      descender: os2?.sTypoDescender ?? hhea.descender,
      lineGap: os2?.sTypoLineGap ?? hhea.lineGap,
      hheaAscender: hhea.ascender, hheaDescender: hhea.descender,
      xHeight: os2?.sxHeight || 0,
      capHeight: os2?.sCapHeight || 0,
      italicAngle: post?.italicAngle || 0,
      weightClass: os2?.usWeightClass || 400,
      widthClass: os2?.usWidthClass || 5,
      fsType: os2?.fsType || 0,
      panose: os2?.panose || null,
      isCFF,
    },
    variation: fvar ? { axes: fvar.axes, instances: fvar.instances, avar } : null,
    axisValues: null,
    glyphs: [],
    glyphNames: post?.names || null,
  };

  const reverse = new Map();
  for (const [cp, g] of cmap) { if (!reverse.has(g)) reverse.set(g, []); reverse.get(g).push(cp); }
  model.unicodesOf = gid => reverse.get(gid) || [];

  if (isCFF) {
    const ot = await loadOpentype();
    const ab = model.source.buffer.buffer.slice(model.source.buffer.byteOffset, model.source.buffer.byteOffset + model.source.buffer.byteLength);
    let font;
    try { font = ot.parse(ab); } catch (e) { throw new Error('Could not read the PostScript (CFF) outlines: ' + e.message); }
    const tol = Math.max(0.5, head.unitsPerEm / 2000);
    for (let gid = 0; gid < numGlyphs; gid++) {
      const g = font.glyphs.get(gid);
      let contours = commandsToContours(g?.path?.commands || [], tol);
      // CFF outer contours run counter-clockwise; TrueType expects clockwise.
      if (contours.length && !isClockwise(contours)) contours = contours.map(reverseContour);
      model.glyphs.push({ gid, contours, advance: advances[gid], name: g?.name || model.glyphNames?.[gid] || '' });
    }
  } else {
    if (!tables.has('glyf') || !tables.has('loca')) throw new Error('Font has no glyf/loca or CFF outlines (bitmap-only or color-only fonts are not editable).');
    const ctx = {
      glyf: tables.get('glyf'),
      loca: parseLoca(tables.get('loca'), numGlyphs, head.indexToLocFormat === 1),
      advances, lsbs,
      gvar: fvar && tables.has('gvar') ? parseGvarHeader(tables.get('gvar')) : null,
      coords: null,
    };
    model._ctx = ctx;
    resolveAll(model, axisValues);
  }
  return model;
}

/** (Re)instantiate a variable font at user-space axis values. No-op coordinates for static fonts. */
export function resolveAll(model, axisValues) {
  const ctx = model._ctx;
  if (!ctx) return;
  if (model.variation) {
    const values = {};
    for (const a of model.variation.axes) values[a.tag] = axisValues?.[a.tag] ?? a.def;
    model.axisValues = values;
    ctx.coords = normalizeCoords(model.variation.axes, model.variation.avar, values);
  }
  model.glyphs = [];
  for (let gid = 0; gid < model.numGlyphs; gid++) {
    const { contours, advance } = resolveGlyph(ctx, gid);
    model.glyphs.push({ gid, contours, advance: Math.round(advance), name: model.glyphNames?.[gid] || '' });
  }
}

export function glyphForChar(model, ch) {
  const gid = model.cmap.get(typeof ch === 'number' ? ch : ch.codePointAt(0));
  return gid == null ? null : model.glyphs[gid];
}

/** Font-level vertical metrics, measuring from outlines when OS/2 lacks them. */
export function measuredHeights(model) {
  const h = { xHeight: model.info.xHeight, capHeight: model.info.capHeight };
  const top = ch => { const g = glyphForChar(model, ch); return g && g.contours.length ? bbox(g.contours).yMax : 0; };
  if (!h.xHeight) h.xHeight = top('x') || top('z') || Math.round(model.upm * 0.5);
  if (!h.capHeight) h.capHeight = top('H') || top('I') || Math.round(model.upm * 0.7);
  return h;
}
