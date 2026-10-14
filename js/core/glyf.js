// TrueType outline reading (glyf/loca) with exact on/off-curve point structure,
// composite decomposition, and gvar variation instancing (tuple scalars + IUP).
import { Reader } from './sfnt.js';

const ON_CURVE = 1, X_SHORT = 2, Y_SHORT = 4, REPEAT = 8, X_SAME = 16, Y_SAME = 32;
const ARG_WORDS = 1, ARGS_XY = 2, HAVE_SCALE = 8, MORE = 32, HAVE_XY_SCALE = 64, HAVE_2X2 = 128, SCALED_OFFSET = 0x800;

export function parseLoca(b, numGlyphs, longFormat) {
  const r = new Reader(b);
  const offs = new Array(numGlyphs + 1);
  for (let i = 0; i <= numGlyphs; i++) offs[i] = longFormat ? r.u32() : r.u16() * 2;
  return offs;
}

/** Raw glyph: { kind: 'empty'|'simple'|'composite', contours | components, endPts }. */
export function parseRawGlyph(glyf, loca, gid) {
  const start = loca[gid], end = loca[gid + 1];
  if (end <= start) return { kind: 'empty', points: [], endPts: [] };
  const r = new Reader(glyf, start);
  const nContours = r.i16();
  r.pos += 8;
  if (nContours >= 0) {
    const endPts = []; for (let i = 0; i < nContours; i++) endPts.push(r.u16());
    const nPts = nContours ? endPts[nContours - 1] + 1 : 0;
    const instrLen = r.u16(); r.pos += instrLen; // skip instructions (hinting is dropped on export)
    const flags = new Uint8Array(nPts);
    for (let i = 0; i < nPts;) {
      const f = r.u8(); flags[i++] = f;
      if (f & REPEAT) { let n = r.u8(); while (n-- > 0 && i < nPts) flags[i++] = f; }
    }
    const points = new Array(nPts);
    let x = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & X_SHORT) x += (f & X_SAME) ? r.u8() : -r.u8();
      else if (!(f & X_SAME)) x += r.i16();
      points[i] = { x, y: 0, on: !!(f & ON_CURVE) };
    }
    let y = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & Y_SHORT) y += (f & Y_SAME) ? r.u8() : -r.u8();
      else if (!(f & Y_SAME)) y += r.i16();
      points[i].y = y;
    }
    return { kind: 'simple', points, endPts };
  }
  const components = [];
  let flags;
  do {
    flags = r.u16();
    const glyphIndex = r.u16();
    let a1, a2;
    if (flags & ARG_WORDS) { a1 = (flags & ARGS_XY) ? r.i16() : r.u16(); a2 = (flags & ARGS_XY) ? r.i16() : r.u16(); }
    else { a1 = (flags & ARGS_XY) ? r.i8() : r.u8(); a2 = (flags & ARGS_XY) ? r.i8() : r.u8(); }
    let m = [1, 0, 0, 1];
    if (flags & HAVE_SCALE) { const s = r.f2dot14(); m = [s, 0, 0, s]; }
    else if (flags & HAVE_XY_SCALE) { m = [r.f2dot14(), 0, 0, r.f2dot14()]; }
    else if (flags & HAVE_2X2) { m = [r.f2dot14(), r.f2dot14(), r.f2dot14(), r.f2dot14()]; }
    components.push({ glyphIndex, flags, matrix: m, dx: (flags & ARGS_XY) ? a1 : 0, dy: (flags & ARGS_XY) ? a2 : 0, matchPoints: (flags & ARGS_XY) ? null : [a1, a2] });
  } while (flags & MORE);
  return { kind: 'composite', components };
}

// ---------- gvar ----------

export function parseGvarHeader(b) {
  const r = new Reader(b);
  r.u32();
  const axisCount = r.u16(), sharedCount = r.u16(), sharedOff = r.u32(), glyphCount = r.u16(), flags = r.u16(), dataOff = r.u32();
  const offsets = [];
  for (let i = 0; i <= glyphCount; i++) offsets.push((flags & 1) ? r.u32() : r.u16() * 2);
  const shared = [];
  r.seek(sharedOff);
  for (let i = 0; i < sharedCount; i++) { const t = []; for (let a = 0; a < axisCount; a++) t.push(r.f2dot14()); shared.push(t); }
  return { bytes: b, axisCount, shared, offsets, dataOff, glyphCount };
}

function readPackedPoints(r) {
  let count = r.u8();
  if (count === 0) return null; // all points
  if (count & 0x80) count = ((count & 0x7F) << 8) | r.u8();
  const pts = []; let last = 0;
  while (pts.length < count) {
    const ctl = r.u8(); const n = (ctl & 0x7F) + 1; const words = ctl & 0x80;
    for (let i = 0; i < n && pts.length < count; i++) { last += words ? r.u16() : r.u8(); pts.push(last); }
  }
  return pts;
}

function readPackedDeltas(r, count) {
  const out = [];
  while (out.length < count) {
    const ctl = r.u8(); const n = (ctl & 0x3F) + 1;
    const kind = ctl & 0xC0;
    for (let i = 0; i < n && out.length < count; i++) {
      if (kind === 0x80) out.push(0);
      else if (kind === 0x40) out.push(r.i16());
      else if (kind === 0xC0) out.push(r.i32());
      else out.push(r.i8());
    }
  }
  return out;
}

function tupleScalar(peak, start, end, coords) {
  let s = 1;
  for (let i = 0; i < peak.length; i++) {
    const p = peak[i]; if (p === 0) continue;
    const v = coords[i]; if (v === 0) return 0;
    const lo = start ? start[i] : Math.min(0, p), hi = end ? end[i] : Math.max(0, p);
    if (start && (lo > p || p > hi || (lo < 0 && hi > 0))) continue;
    if (v < lo || v > hi) return 0;
    if (v === p) continue;
    s *= v < p ? (v - lo) / (p - lo) : (hi - v) / (hi - p);
  }
  return s;
}

/** Interpolate untouched points of each contour (IUP), mutating dx/dy for indices not in `touched`. */
function iup(orig, endPts, dx, dy, touched) {
  let start = 0;
  for (const end of endPts) {
    const idx = []; for (let i = start; i <= end; i++) if (touched[i]) idx.push(i);
    if (idx.length && idx.length < end - start + 1) {
      if (idx.length === 1) {
        for (let i = start; i <= end; i++) if (!touched[i]) { dx[i] = dx[idx[0]]; dy[i] = dy[idx[0]]; }
      } else {
        for (let k = 0; k < idx.length; k++) {
          const p1 = idx[k], p2 = idx[(k + 1) % idx.length];
          let i = p1 + 1 > end ? start : p1 + 1;
          while (i !== p2) {
            for (const axis of ['x', 'y']) {
              const d = axis === 'x' ? dx : dy;
              const c1 = orig[p1][axis], c2 = orig[p2][axis], c = orig[i][axis];
              let v;
              if (c1 === c2) v = d[p1] === d[p2] ? d[p1] : 0;
              else {
                const [lo, hi, dlo, dhi] = c1 < c2 ? [c1, c2, d[p1], d[p2]] : [c2, c1, d[p2], d[p1]];
                if (c <= lo) v = dlo; else if (c >= hi) v = dhi;
                else v = dlo + (dhi - dlo) * (c - lo) / (hi - lo);
              }
              d[i] = v;
            }
            i = i + 1 > end ? start : i + 1;
          }
        }
      }
    }
    start = end + 1;
  }
}

/**
 * Deltas for one glyph at normalized coords.
 * nPoints includes the 4 phantom points. orig/endPts are used for IUP on simple glyphs.
 */
export function glyphDeltas(gvar, gid, nPoints, coords, orig, endPts) {
  const dx = new Float64Array(nPoints), dy = new Float64Array(nPoints);
  if (!gvar || gid >= gvar.glyphCount) return { dx, dy };
  const start = gvar.offsets[gid], end = gvar.offsets[gid + 1];
  if (end <= start) return { dx, dy };
  const base = gvar.dataOff + start;
  const b = gvar.bytes;
  const r = new Reader(b, base);
  const countWord = r.u16();
  const tupleCount = countWord & 0x0FFF;
  const dataOffset = r.u16();
  const headers = [];
  for (let t = 0; t < tupleCount; t++) {
    const size = r.u16(), index = r.u16();
    let peak, s = null, e = null;
    if (index & 0x8000) { peak = []; for (let a = 0; a < gvar.axisCount; a++) peak.push(r.f2dot14()); }
    else peak = gvar.shared[index & 0x0FFF];
    if (index & 0x4000) {
      s = []; for (let a = 0; a < gvar.axisCount; a++) s.push(r.f2dot14());
      e = []; for (let a = 0; a < gvar.axisCount; a++) e.push(r.f2dot14());
    }
    headers.push({ size, privatePoints: !!(index & 0x2000), peak, s, e });
  }
  const d = new Reader(b, base + dataOffset);
  let sharedPts = null;
  if (countWord & 0x8000) sharedPts = readPackedPoints(d);
  let pos = d.pos;
  for (const h of headers) {
    const scalar = tupleScalar(h.peak, h.s, h.e, coords);
    const next = pos + h.size;
    if (scalar !== 0) {
      d.seek(pos);
      const pts = h.privatePoints ? readPackedPoints(d) : sharedPts;
      const n = pts ? pts.length : nPoints;
      const xs = readPackedDeltas(d, n), ys = readPackedDeltas(d, n);
      if (!pts) {
        for (let i = 0; i < nPoints; i++) { dx[i] += xs[i] * scalar; dy[i] += ys[i] * scalar; }
      } else {
        const tx = new Float64Array(nPoints), ty = new Float64Array(nPoints), touched = new Uint8Array(nPoints);
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i]; if (p >= nPoints) continue;
          tx[p] += xs[i]; ty[p] += ys[i]; touched[p] = 1;
        }
        if (orig && endPts) iup(orig, endPts, tx, ty, touched);
        for (let i = 0; i < nPoints; i++) { dx[i] += tx[i] * scalar; dy[i] += ty[i] * scalar; }
      }
    }
    pos = next;
  }
  return { dx, dy };
}

/**
 * Fully resolved, decomposed glyph outline at a variation location.
 * Returns { contours: [[{x,y,on}]], advance }.
 */
export function resolveGlyph(ctx, gid, depth = 0) {
  const raw = parseRawGlyph(ctx.glyf, ctx.loca, gid);
  const adv = ctx.advances[gid] ?? 0;
  const lsb = ctx.lsbs[gid] ?? 0;
  if (depth > 16) return { contours: [], advance: adv };
  const vary = ctx.gvar && ctx.coords && ctx.coords.some(c => c !== 0);

  if (raw.kind === 'empty') {
    let advance = adv;
    if (vary) {
      const { dx } = glyphDeltas(ctx.gvar, gid, 4, ctx.coords, null, null);
      advance = adv + dx[1] - dx[0];
    }
    return { contours: [], advance };
  }

  if (raw.kind === 'simple') {
    const pts = raw.points.map(p => ({ ...p }));
    let advance = adv;
    let xMin = Infinity; for (const p of raw.points) xMin = Math.min(xMin, p.x);
    if (!isFinite(xMin)) xMin = 0;
    const pp1x = xMin - lsb;
    // Origin is the left phantom point; normalise so it sits at x = 0.
    if (pp1x && !vary) for (const p of pts) p.x -= pp1x;
    if (vary) {
      const orig = [...raw.points, { x: pp1x, y: 0 }, { x: pp1x + adv, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
      const endPts = [...raw.endPts];
      const { dx, dy } = glyphDeltas(ctx.gvar, gid, pts.length + 4, ctx.coords, orig, endPts);
      for (let i = 0; i < pts.length; i++) { pts[i].x += dx[i]; pts[i].y += dy[i]; }
      advance = adv + dx[pts.length + 1] - dx[pts.length];
      // Shift so the left phantom point stays at the origin.
      const shift = pp1x + dx[pts.length];
      if (shift) for (const p of pts) p.x -= shift;
    }
    const contours = []; let s = 0;
    for (const e of raw.endPts) { if (e >= s) contours.push(pts.slice(s, e + 1)); s = e + 1; }
    return { contours, advance };
  }

  // Composite: component offsets are the variable "points".
  const comps = raw.components.map(c => ({ ...c }));
  let advance = adv;
  if (vary) {
    const { dx, dy } = glyphDeltas(ctx.gvar, gid, comps.length + 4, ctx.coords, null, null);
    comps.forEach((c, i) => { c.dx += dx[i]; c.dy += dy[i]; });
    advance = adv + dx[comps.length + 1] - dx[comps.length];
  }
  const contours = [];
  const flat = [];
  for (const c of comps) {
    const sub = resolveGlyph(ctx, c.glyphIndex, depth + 1);
    const [a, b, cc, d] = c.matrix;
    let ox = c.dx, oy = c.dy;
    if (c.matchPoints) {
      const subFlat = sub.contours.flat();
      const p1 = flat[c.matchPoints[0]], p2 = subFlat[c.matchPoints[1]];
      if (p1 && p2) { ox = p1.x - (a * p2.x + cc * p2.y); oy = p1.y - (b * p2.x + d * p2.y); }
    } else if (c.flags & SCALED_OFFSET) {
      ox = a * c.dx + cc * c.dy; oy = b * c.dx + d * c.dy;
    }
    for (const contour of sub.contours) {
      const t = contour.map(p => ({ x: a * p.x + cc * p.y + ox, y: b * p.x + d * p.y + oy, on: p.on }));
      contours.push(t); flat.push(...t);
    }
  }
  return { contours, advance };
}
