// Morph font: a real variable font with one custom axis, MRPH (0 = original, 100 = remix).
// The draft path keeps every point, so the original and the remix are point-compatible and
// the difference can be stored as gvar deltas. Browsers interpolate it with full OpenType
// shaping, which is what drives the morph animation; it can also be exported.
import { Writer } from './sfnt.js';
import { compileRemix } from './remix.js';

export const MORPH_TAG = 'MRPH';

function packDeltas(w, values) {
  let i = 0;
  while (i < values.length) {
    const v = values[i];
    if (v === 0) {
      let n = 0; while (i + n < values.length && values[i + n] === 0 && n < 64) n++;
      w.u8(0x80 | (n - 1)); i += n;
    } else if (v >= -128 && v <= 127) {
      let n = 0; while (i + n < values.length && n < 64 && values[i + n] !== 0 && values[i + n] >= -128 && values[i + n] <= 127) n++;
      w.u8(n - 1); for (let k = 0; k < n; k++) w.i8(values[i + k]); i += n;
    } else {
      let n = 0; while (i + n < values.length && n < 64 && values[i + n] !== 0 && (values[i + n] < -128 || values[i + n] > 127)) n++;
      w.u8(0x40 | (n - 1)); for (let k = 0; k < n; k++) w.i16(Math.max(-32768, Math.min(32767, values[i + k]))); i += n;
    }
  }
}

function buildGvar(originals, targets) {
  const datas = originals.map((o, gid) => {
    const t = targets[gid];
    const op = o.contours.filter(c => c.length).flat(), tp = t.contours.filter(c => c.length).flat();
    if (op.length !== tp.length) return new Uint8Array(0); // incompatible: stays at the default shape
    const dx = op.map((p, i) => Math.round(tp[i].x) - Math.round(p.x));
    const dy = op.map((p, i) => Math.round(tp[i].y) - Math.round(p.y));
    const adv = Math.round(t.advance) - Math.round(o.advance);
    dx.push(0, adv, 0, 0); dy.push(0, 0, 0, 0);
    if (dx.every(v => v === 0) && dy.every(v => v === 0)) return new Uint8Array(0);
    const ser = new Writer(dx.length * 4 + 8);
    ser.u8(0); // packed point numbers: all points
    packDeltas(ser, dx); packDeltas(ser, dy);
    const body = ser.result();
    const w = new Writer(body.length + 16);
    w.u16(1);            // one tuple, no shared point numbers
    w.u16(4 + 6);        // offset to serialized data
    w.u16(body.length);  // variationDataSize
    w.u16(0x8000 | 0x2000); // embedded peak + private point numbers
    w.i16(0x4000);       // peak = +1.0
    w.bytes(body);
    if (w.pos % 2) w.u8(0);
    return w.result();
  });
  const n = originals.length;
  const w = new Writer(20 + (n + 1) * 4 + datas.reduce((s, d) => s + d.length, 0));
  const headerSize = 20 + (n + 1) * 4;
  w.u16(1); w.u16(0); w.u16(1); w.u16(0); w.u32(headerSize); w.u16(n); w.u16(1); w.u32(headerSize);
  let off = 0;
  for (const d of datas) { w.u32(off); off += d.length; }
  w.u32(off);
  for (const d of datas) w.bytes(d);
  return w.result();
}

function buildFvar() {
  const w = new Writer(64);
  w.u16(1); w.u16(0); w.u16(16); w.u16(2); w.u16(1); w.u16(20); w.u16(2); w.u16(8);
  w.tag(MORPH_TAG); w.i32(0); w.i32(0); w.i32(100 * 65536); w.u16(0); w.u16(256);
  w.u16(257); w.u16(0); w.i32(0);
  w.u16(258); w.u16(0); w.i32(100 * 65536);
  return w.result();
}

/** originals: per-glyph {contours, advance, name} before transforms; targets: draft outputs. */
export function buildMorphFont(project, prep, targets) {
  const originals = prep.items.map((it, i) => ({ contours: it.orig, advance: it.advance, name: targets[i].name }));
  const tables = new Map([['fvar', buildFvar()], ['gvar', buildGvar(originals, targets)]]);
  const meta = { family: 'type_space Morph', style: 'Regular', extraNames: [{ nameID: 256, value: 'Morph' }, { nameID: 257, value: 'Original' }, { nameID: 258, value: 'Remix' }] };
  const morphPrep = { ...prep, anchorFn: null, meta: { ...prep.meta, italicAngle: 0 } };
  return compileRemix(project, morphPrep, originals, { tables, meta });
}
