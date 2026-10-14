// In-place GPOS patching so mark attachment anchors and kerning follow transformed outlines.
// Handles SinglePos, PairPos (both formats), CursivePos, MarkBase, MarkLig, MarkMark, through Extension.
import { Reader } from './sfnt.js';

function coverage(b, off) {
  const r = new Reader(b, off);
  const fmt = r.u16(); const out = [];
  if (fmt === 1) { const n = r.u16(); for (let i = 0; i < n; i++) out.push(r.u16()); }
  else if (fmt === 2) {
    const n = r.u16();
    for (let i = 0; i < n; i++) { const s = r.u16(), e = r.u16(), idx = r.u16(); for (let g = s; g <= e; g++) out[idx + g - s] = g; }
  }
  return out;
}

const popcount = v => { let c = 0; while (v) { c += v & 1; v >>= 1; } return c; };
const clamp16 = v => Math.max(-32768, Math.min(32767, Math.round(v)));

/**
 * @param {Uint8Array} src original GPOS bytes
 * @param {(gid:number, x:number, y:number, role:'base'|'mark') => [number, number]} anchorFn
 * @param {number} xScale horizontal scale applied to x placements/advances (kerning)
 */
export function patchGpos(src, anchorFn, xScale) {
  const b = src.slice();
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const doneAnchor = new Set(), doneValue = new Set();
  const r = new Reader(b);
  const major = r.u16(); const minor = r.u16();
  if (major !== 1) return b;
  r.u16(); r.u16();
  const lookupListOff = r.u16();
  if (minor >= 1) dv.setUint16(2, 0); // drop FeatureVariations: no fvar in the static output
  if (!lookupListOff) return b;

  const anchor = (off, gid, role) => {
    if (!off || doneAnchor.has(off) || off + 6 > b.length) return;
    doneAnchor.add(off);
    const x = dv.getInt16(off + 2), y = dv.getInt16(off + 4);
    const [nx, ny] = anchorFn(gid, x, y, role);
    dv.setInt16(off + 2, clamp16(nx)); dv.setInt16(off + 4, clamp16(ny));
  };

  const value = (off, fmt) => {
    if (doneValue.has(off)) return;
    doneValue.add(off);
    let p = off;
    for (let bit = 1; bit <= 0x80; bit <<= 1) {
      if (!(fmt & bit)) continue;
      if ((bit === 1 || bit === 4) && xScale !== 1) dv.setInt16(p, clamp16(dv.getInt16(p) * xScale));
      p += 2;
    }
  };

  const baseArray = (arrOff, glyphs, classCount, role) => {
    const n = dv.getUint16(arrOff);
    for (let i = 0; i < n; i++) for (let c = 0; c < classCount; c++) {
      const o = dv.getUint16(arrOff + 2 + (i * classCount + c) * 2);
      if (o) anchor(arrOff + o, glyphs[i], role);
    }
  };

  const markArray = (arrOff, glyphs) => {
    const n = dv.getUint16(arrOff);
    for (let i = 0; i < n; i++) { const o = dv.getUint16(arrOff + 2 + i * 4 + 2); if (o) anchor(arrOff + o, glyphs[i], 'mark'); }
  };

  const subtable = (type, off) => {
    const fmt = dv.getUint16(off);
    if (type === 9) {
      const extType = dv.getUint16(off + 2);
      return subtable(extType, off + dv.getUint32(off + 4));
    }
    if (type === 1) {
      const vf = dv.getUint16(off + 4);
      if (fmt === 1) value(off + 6, vf);
      else if (fmt === 2) { const n = dv.getUint16(off + 6), sz = popcount(vf) * 2; for (let i = 0; i < n; i++) value(off + 8 + i * sz, vf); }
    } else if (type === 2) {
      const vf1 = dv.getUint16(off + 4), vf2 = dv.getUint16(off + 6);
      const s1 = popcount(vf1) * 2, s2 = popcount(vf2) * 2;
      if (fmt === 1) {
        const n = dv.getUint16(off + 8);
        for (let i = 0; i < n; i++) {
          const ps = off + dv.getUint16(off + 10 + i * 2);
          if (doneValue.has('ps' + ps)) continue; doneValue.add('ps' + ps);
          const cnt = dv.getUint16(ps);
          for (let j = 0; j < cnt; j++) { const rec = ps + 2 + j * (2 + s1 + s2); value(rec + 2, vf1); value(rec + 2 + s1, vf2); }
        }
      } else if (fmt === 2) {
        const c1 = dv.getUint16(off + 12), c2 = dv.getUint16(off + 14);
        for (let i = 0; i < c1 * c2; i++) { const rec = off + 16 + i * (s1 + s2); value(rec, vf1); value(rec + s1, vf2); }
      }
    } else if (type === 3) {
      const glyphs = coverage(b, off + dv.getUint16(off + 2));
      const n = dv.getUint16(off + 4);
      for (let i = 0; i < n; i++) {
        const en = dv.getUint16(off + 6 + i * 4), ex = dv.getUint16(off + 8 + i * 4);
        if (en) anchor(off + en, glyphs[i], 'base'); if (ex) anchor(off + ex, glyphs[i], 'base');
      }
    } else if (type === 4 || type === 6) {
      const marks = coverage(b, off + dv.getUint16(off + 2));
      const bases = coverage(b, off + dv.getUint16(off + 4));
      const classCount = dv.getUint16(off + 6);
      markArray(off + dv.getUint16(off + 8), marks);
      baseArray(off + dv.getUint16(off + 10), bases, classCount, type === 4 ? 'base' : 'mark');
    } else if (type === 5) {
      const marks = coverage(b, off + dv.getUint16(off + 2));
      const ligs = coverage(b, off + dv.getUint16(off + 4));
      const classCount = dv.getUint16(off + 6);
      markArray(off + dv.getUint16(off + 8), marks);
      const la = off + dv.getUint16(off + 10);
      const n = dv.getUint16(la);
      for (let i = 0; i < n; i++) {
        const at = la + dv.getUint16(la + 2 + i * 2);
        const comps = dv.getUint16(at);
        for (let k = 0; k < comps * classCount; k++) { const o = dv.getUint16(at + 2 + k * 2); if (o) anchor(at + o, ligs[i], 'base'); }
      }
    }
  };

  try {
    const lc = dv.getUint16(lookupListOff);
    for (let i = 0; i < lc; i++) {
      const lo = lookupListOff + dv.getUint16(lookupListOff + 2 + i * 2);
      const type = dv.getUint16(lo), sc = dv.getUint16(lo + 4);
      for (let s = 0; s < sc; s++) subtable(type, lo + dv.getUint16(lo + 6 + s * 2));
    }
  } catch (e) {
    console.warn('GPOS patch incomplete:', e);
  }
  return b;
}

/** Strip variation-only parts of GSUB/GDEF so a static instance stays valid without fvar. */
export function staticizeLayout(tag, src) {
  const b = src.slice();
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (tag === 'GSUB' && dv.getUint16(0) === 1 && dv.getUint16(2) >= 1) dv.setUint16(2, 0);
  if (tag === 'GDEF' && dv.getUint16(0) === 1 && dv.getUint16(2) >= 3) dv.setUint16(2, 2);
  return b;
}
