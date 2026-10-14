// Compile an edited glyph set back into a valid, unhinted TrueType font. Layout tables
// (GSUB/GDEF/BASE/MATH…) from the base font are carried over byte-for-byte; GPOS is patched.
import { Writer, writeSfnt } from './sfnt.js';
import { STANDARD_MAC_NAMES } from './tables.js';
import { patchGpos, staticizeLayout } from './gpos.js';

const DROP = new Set(['CFF ', 'CFF2', 'VORG', 'gvar', 'fvar', 'avar', 'HVAR', 'VVAR', 'MVAR', 'STAT', 'cvar',
  'hdmx', 'LTSH', 'VDMX', 'fpgm', 'prep', 'cvt ', 'DSIG', 'SVG ', 'sbix', 'CBDT', 'CBLC', 'EBDT', 'EBLC', 'EBSC',
  'vhea', 'vmtx', 'glyf', 'loca', 'hmtx', 'maxp', 'cmap', 'name', 'post', 'gasp', 'TSI0', 'TSI1', 'TSI2', 'TSI3', 'TSI5']);

// ---------- glyf ----------

// Round to the integer grid but keep every point — sources sometimes rely on duplicate
// points (e.g. for gvar or hinting), and dropping them would change the point structure.
function cleanContours(contours) {
  return contours.filter(c => c.length).map(c => c.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), on: p.on })));
}

function encodeGlyph(contours) {
  if (!contours.length) return { bytes: new Uint8Array(0), bbox: null, nPts: 0 };
  const pts = contours.flat();
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const p of pts) { xMin = Math.min(xMin, p.x); yMin = Math.min(yMin, p.y); xMax = Math.max(xMax, p.x); yMax = Math.max(yMax, p.y); }
  const w = new Writer(pts.length * 5 + 32);
  w.i16(contours.length); w.i16(xMin); w.i16(yMin); w.i16(xMax); w.i16(yMax);
  let end = -1; for (const c of contours) { end += c.length; w.u16(end); }
  w.u16(0); // no instructions
  const flags = [], xb = new Writer(pts.length * 2 + 8), yb = new Writer(pts.length * 2 + 8);
  let px = 0, py = 0;
  for (const p of pts) {
    let f = p.on ? 1 : 0;
    const dx = p.x - px, dy = p.y - py;
    if (dx === 0) f |= 16;
    else if (Math.abs(dx) < 256) { f |= 2; if (dx > 0) f |= 16; xb.u8(Math.abs(dx)); }
    else xb.i16(dx);
    if (dy === 0) f |= 32;
    else if (Math.abs(dy) < 256) { f |= 4; if (dy > 0) f |= 32; yb.u8(Math.abs(dy)); }
    else yb.i16(dy);
    flags.push(f); px = p.x; py = p.y;
  }
  for (let i = 0; i < flags.length;) {
    let run = 1;
    while (i + run < flags.length && flags[i + run] === flags[i] && run < 256) run++;
    if (run > 2) { w.u8(flags[i] | 8); w.u8(run - 1); i += run; }
    else { w.u8(flags[i]); i++; }
  }
  w.bytes(xb.result()); w.bytes(yb.result());
  return { bytes: w.result(), bbox: { xMin, yMin, xMax, yMax }, nPts: pts.length, nContours: contours.length };
}

// ---------- cmap ----------

function buildCmap(cmap, uvs) {
  const entries = [...cmap.entries()].sort((a, b) => a[0] - b[0]);
  const bmp = entries.filter(([c]) => c <= 0xFFFF);
  const needs12 = entries.some(([c]) => c > 0xFFFF);

  // format 4
  const segs = [];
  for (const [c, g] of bmp) {
    if (c === 0xFFFF) continue;
    const s = segs[segs.length - 1];
    if (s && c === s.end + 1) { s.end = c; s.gids.push(g); } else segs.push({ start: c, end: c, gids: [g] });
  }
  segs.push({ start: 0xFFFF, end: 0xFFFF, gids: [0], last: true });
  const n = segs.length;
  const glyphIdArray = [];
  const rangeOffsetsLater = [];
  for (const s of segs) {
    const consecutive = s.gids.every((g, i) => g === s.gids[0] + i);
    if (s.last) { s.delta = 1; s.ro = 0; }
    else if (consecutive) { s.delta = (s.gids[0] - s.start) & 0xFFFF; s.ro = 0; }
    else { s.delta = 0; s.ro = -1; s.arrStart = glyphIdArray.length; glyphIdArray.push(...s.gids); }
    rangeOffsetsLater.push(s);
  }
  let entrySelector = 0; while ((1 << (entrySelector + 1)) <= n) entrySelector++;
  const searchRange = 2 * (1 << entrySelector);
  const f4 = new Writer(16 + n * 8 + glyphIdArray.length * 2);
  f4.u16(4); f4.u16(0); f4.u16(0);
  f4.u16(n * 2); f4.u16(searchRange); f4.u16(entrySelector); f4.u16(n * 2 - searchRange);
  for (const s of segs) f4.u16(s.end);
  f4.u16(0);
  for (const s of segs) f4.u16(s.start);
  for (const s of segs) f4.u16(s.delta);
  segs.forEach((s, i) => f4.u16(s.ro === -1 ? (n - i) * 2 + s.arrStart * 2 : 0));
  for (const g of glyphIdArray) f4.u16(g);
  const f4b = f4.result();
  new DataView(f4b.buffer).setUint16(2, Math.min(f4b.length, 0xFFFF));

  let f12b = null;
  if (needs12) {
    const groups = [];
    for (const [c, g] of entries) {
      const last = groups[groups.length - 1];
      if (last && c === last.end + 1 && g === last.g + (c - last.start)) last.end = c;
      else groups.push({ start: c, end: c, g });
    }
    const w = new Writer(16 + groups.length * 12);
    w.u16(12); w.u16(0); w.u32(16 + groups.length * 12); w.u32(0); w.u32(groups.length);
    for (const gr of groups) { w.u32(gr.start); w.u32(gr.end); w.u32(gr.g); }
    f12b = w.result();
  }

  const subs = [{ p: 0, e: 3, data: f4b }];
  if (f12b) subs.push({ p: 0, e: 4, data: f12b });
  if (uvs) subs.push({ p: 0, e: 5, data: uvs });
  subs.push({ p: 3, e: 1, data: f4b });
  if (f12b) subs.push({ p: 3, e: 10, data: f12b });
  const w = new Writer(4096);
  w.u16(0); w.u16(subs.length);
  let off = 4 + subs.length * 8;
  const placed = new Map();
  const order = [];
  for (const s of subs) {
    if (!placed.has(s.data)) { placed.set(s.data, off); order.push(s.data); off += s.data.length; }
    w.u16(s.p); w.u16(s.e); w.u32(placed.get(s.data));
  }
  for (const d of order) w.bytes(d);
  return w.result();
}

// ---------- name ----------

function buildName(records) {
  const strs = records.map(r => {
    const bytes = new Uint8Array(r.value.length * 2);
    for (let i = 0; i < r.value.length; i++) { const c = r.value.charCodeAt(i); bytes[i * 2] = c >> 8; bytes[i * 2 + 1] = c & 255; }
    return bytes;
  });
  const w = new Writer(4096);
  w.u16(0); w.u16(records.length); w.u16(6 + records.length * 12);
  let off = 0;
  const sorted = records.map((r, i) => ({ r, i })).sort((a, b) => a.r.nameID - b.r.nameID);
  for (const { r, i } of sorted) { w.u16(3); w.u16(1); w.u16(0x409); w.u16(r.nameID); w.u16(strs[i].length); w.u16(off); off += strs[i].length; }
  for (const { i } of sorted) w.bytes(strs[i]);
  return w.result();
}

const psSafe = s => s.replace(/[^A-Za-z0-9-]/g, '').slice(0, 60) || 'Untitled';
const RIBBI = new Set(['Regular', 'Bold', 'Italic', 'Bold Italic']);

// ---------- post ----------

function buildPost(names, italicAngle, src) {
  const std = new Map(STANDARD_MAC_NAMES.map((n, i) => [n, i]));
  const extra = []; const idx = [];
  for (const n of names) {
    if (std.has(n)) idx.push(std.get(n));
    else { idx.push(258 + extra.length); extra.push(n); }
  }
  const w = new Writer(64 + names.length * 12);
  w.u32(0x00020000); w.i32(Math.round(italicAngle * 65536));
  w.i16(src?.underlinePosition ?? -100); w.i16(src?.underlineThickness ?? 50);
  w.u32(src?.isFixedPitch ?? 0); w.u32(0); w.u32(0); w.u32(0); w.u32(0);
  w.u16(names.length); for (const i of idx) w.u16(i);
  for (const n of extra) { const s = n.slice(0, 63); w.u8(s.length); for (let i = 0; i < s.length; i++) w.u8(s.charCodeAt(i) & 0x7F); }
  return w.result();
}

function uniqueNames(glyphs, cmapRev) {
  const used = new Set(); const out = [];
  glyphs.forEach((g, gid) => {
    let n = (g.name || '').replace(/[^A-Za-z0-9._-]/g, '');
    if (!n) {
      const cps = cmapRev.get(gid);
      n = gid === 0 ? '.notdef' : cps?.length ? (cps[0] > 0xFFFF ? 'u' + cps[0].toString(16).toUpperCase() : 'uni' + cps[0].toString(16).toUpperCase().padStart(4, '0')) : 'glyph' + gid;
    }
    let base = n, k = 1;
    while (used.has(n)) n = `${base}.${k++}`;
    used.add(n); out.push(n);
  });
  return out;
}

/**
 * @param base     loaded source model (supplies tables to carry over)
 * @param out      { glyphs:[{contours, advance, name}], cmap: Map<cp,gid>, anchorFn?, xScale? }
 * @param meta     { family, style, version, weightClass, widthClass, italicAngle, xHeight, capHeight, designer, notice }
 */
export function compileFont(base, out, meta) {
  const src = base.source.tables;
  const tables = new Map();
  for (const [tag, data] of src) if (!DROP.has(tag)) tables.set(tag, data.slice());
  const numGlyphs = out.glyphs.length;
  if (numGlyphs > 65535) throw new Error('Too many glyphs for one font (max 65,535).');

  // glyf / loca / hmtx
  const glyfW = new Writer(1 << 20);
  const loca = new Uint32Array(numGlyphs + 1);
  const advances = [], lsbs = [];
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
  let maxPts = 0, maxCont = 0, minLsb = Infinity, minRsb = Infinity, maxExtent = -Infinity, maxAdv = 0;
  out.glyphs.forEach((g, i) => {
    loca[i] = glyfW.pos;
    const enc = encodeGlyph(cleanContours(g.contours));
    const adv = Math.max(0, Math.min(65535, Math.round(g.advance)));
    advances.push(adv); maxAdv = Math.max(maxAdv, adv);
    if (enc.bbox) {
      glyfW.bytes(enc.bytes); glyfW.pad4();
      const b = enc.bbox;
      gx0 = Math.min(gx0, b.xMin); gy0 = Math.min(gy0, b.yMin); gx1 = Math.max(gx1, b.xMax); gy1 = Math.max(gy1, b.yMax);
      lsbs.push(b.xMin);
      minLsb = Math.min(minLsb, b.xMin); minRsb = Math.min(minRsb, adv - b.xMax); maxExtent = Math.max(maxExtent, b.xMax);
      maxPts = Math.max(maxPts, enc.nPts); maxCont = Math.max(maxCont, enc.nContours);
    } else lsbs.push(0);
  });
  loca[numGlyphs] = glyfW.pos;
  if (!isFinite(gx0)) { gx0 = gy0 = gx1 = gy1 = 0; minLsb = minRsb = maxExtent = 0; }
  tables.set('glyf', glyfW.result());
  const locaW = new Writer((numGlyphs + 1) * 4);
  for (const o of loca) locaW.u32(o);
  tables.set('loca', locaW.result());
  const hmtxW = new Writer(numGlyphs * 4);
  for (let i = 0; i < numGlyphs; i++) { hmtxW.u16(advances[i]); hmtxW.i16(lsbs[i]); }
  tables.set('hmtx', hmtxW.result());

  // head
  const head = tables.get('head');
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  hv.setInt16(36, gx0); hv.setInt16(38, gy0); hv.setInt16(40, gx1); hv.setInt16(42, gy1);
  hv.setInt16(50, 1);
  hv.setUint16(16, hv.getUint16(16) & ~(1 << 4)); // instructions no longer alter advance widths
  const now = BigInt(Math.floor(Date.now() / 1000) + 2082844800);
  hv.setBigUint64(28, now);
  const italic = Math.abs(meta.italicAngle) > 0.01;
  const bold = (meta.weightClass || 400) >= 700;
  hv.setUint16(44, (bold ? 1 : 0) | (italic ? 2 : 0));

  // hhea
  const hhea = tables.get('hhea');
  const hh = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength);
  hh.setUint16(10, maxAdv); hh.setInt16(12, minLsb); hh.setInt16(14, minRsb); hh.setInt16(16, maxExtent);
  if (italic) { hh.setInt16(18, 1000); hh.setInt16(20, Math.round(Math.tan(-meta.italicAngle * Math.PI / 180) * 1000)); }
  else { hh.setInt16(18, 1); hh.setInt16(20, 0); }
  hh.setUint16(34, numGlyphs);

  // maxp 1.0
  const mx = new Writer(32);
  mx.u32(0x00010000); mx.u16(numGlyphs); mx.u16(maxPts); mx.u16(maxCont); mx.u16(0); mx.u16(0);
  mx.u16(2); mx.u16(0); mx.u16(0); mx.u16(0); mx.u16(0); mx.u16(0); mx.u16(0); mx.u16(0); mx.u16(0);
  tables.set('maxp', mx.result());

  tables.set('cmap', buildCmap(out.cmap, base.uvs)); // base glyph IDs are stable, so variation sequences stay valid

  // OS/2
  const os2 = tables.get('OS/2');
  if (os2) {
    const ov = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
    const nz = advances.filter(a => a > 0);
    ov.setInt16(2, Math.round(nz.reduce((s, a) => s + a, 0) / Math.max(1, nz.length)));
    ov.setUint16(4, Math.max(1, Math.min(1000, Math.round(meta.weightClass || 400))));
    ov.setUint16(6, Math.max(1, Math.min(9, Math.round(meta.widthClass || 5))));
    let fs = ov.getUint16(62) & ~(1 | 32 | 64);
    if (italic) fs |= 1; if (bold) fs |= 32; if (!italic && !bold) fs |= 64;
    ov.setUint16(62, fs);
    const cps = [...out.cmap.keys()];
    const bmpCps = cps.filter(c => c <= 0xFFFF);
    if (bmpCps.length) { ov.setUint16(64, Math.min(...bmpCps)); ov.setUint16(66, Math.min(0xFFFF, Math.max(...cps))); }
    if (ov.getUint16(0) >= 2 && os2.length >= 90) {
      if (meta.xHeight) ov.setInt16(86, Math.round(meta.xHeight));
      if (meta.capHeight) ov.setInt16(88, Math.round(meta.capHeight));
    }
    // Keep Windows clipping metrics outside the new outline extremes.
    ov.setUint16(74, Math.max(ov.getUint16(74), gy1)); ov.setUint16(76, Math.max(ov.getUint16(76), -gy0));
  }

  // name
  const family = (meta.family || 'type_space Remix').trim();
  const style = (meta.style || 'Regular').trim();
  const ribbi = RIBBI.has(style);
  const version = meta.version || 'Version 1.000';
  const ps = `${psSafe(family)}-${psSafe(style)}`;
  const orig = base.names;
  const recs = [
    { nameID: 0, value: [orig.get(0), meta.notice || `Remixed with type_space from ${base.info.family}.`].filter(Boolean).join(' ') },
    { nameID: 1, value: ribbi ? family : `${family} ${style}` },
    { nameID: 2, value: ribbi ? style : 'Regular' },
    { nameID: 3, value: `${version.replace(/^Version\s*/, '')};TYPESPACE;${ps}` },
    { nameID: 4, value: `${family} ${style}` },
    { nameID: 5, value: version },
    { nameID: 6, value: ps },
  ];
  if (meta.designer || orig.get(9)) recs.push({ nameID: 9, value: [meta.designer, orig.get(9)].filter(Boolean).join('; ') });
  if (orig.get(13)) recs.push({ nameID: 13, value: orig.get(13) });
  if (orig.get(14)) recs.push({ nameID: 14, value: orig.get(14) });
  if (!ribbi) { recs.push({ nameID: 16, value: family }, { nameID: 17, value: style }); }
  for (const r of meta.extraNames || []) recs.push(r);
  tables.set('name', buildName(recs));

  // post (format 2 keeps glyph names for further editing in Glyphs/FontLab/FontForge)
  const rev = new Map();
  for (const [cp, g] of out.cmap) { if (!rev.has(g)) rev.set(g, []); rev.get(g).push(cp); }
  const srcPost = src.get('post');
  const pv = srcPost ? new DataView(srcPost.buffer, srcPost.byteOffset, srcPost.byteLength) : null;
  tables.set('post', buildPost(uniqueNames(out.glyphs, rev), meta.italicAngle || 0,
    pv ? { underlinePosition: pv.getInt16(8), underlineThickness: pv.getInt16(10), isFixedPitch: pv.getUint32(12) } : null));

  // gasp: smooth at all sizes (outlines are unhinted)
  const gasp = new Writer(8); gasp.u16(1); gasp.u16(1); gasp.u16(0xFFFF); gasp.u16(0x000F);
  tables.set('gasp', gasp.result());

  if (tables.has('GPOS')) tables.set('GPOS', out.anchorFn ? patchGpos(tables.get('GPOS'), out.anchorFn, out.xScale ?? 1) : patchGpos(tables.get('GPOS'), (g, x, y) => [x, y], 1));
  for (const t of ['GSUB', 'GDEF']) if (tables.has(t)) tables.set(t, staticizeLayout(t, tables.get(t)));

  for (const [tag, data] of out.extraTables || []) tables.set(tag, data);
  return writeSfnt(tables, 0x00010000);
}
