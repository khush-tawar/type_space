// SFNT container I/O: TrueType/OpenType (.ttf/.otf), WOFF 1.0 and TrueType Collections.
// Tables are kept as raw bytes so anything we do not touch (GSUB, GPOS, GDEF, BASE, MATH...)
// round-trips byte-for-byte.

export class Reader {
  constructor(bytes, offset = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = offset;
  }
  seek(p) { this.pos = p; return this; }
  u8() { return this.view.getUint8(this.pos++); }
  i8() { return this.view.getInt8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  f2dot14() { return this.i16() / 16384; }
  fixed() { return this.i32() / 65536; }
  tag() { let s = ''; for (let i = 0; i < 4; i++) s += String.fromCharCode(this.u8()); return s; }
}

export class Writer {
  constructor(size = 1024) { this.buf = new Uint8Array(size); this.view = new DataView(this.buf.buffer); this.pos = 0; }
  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size); nb.set(this.buf); this.buf = nb; this.view = new DataView(nb.buffer);
  }
  u8(v) { this.ensure(1); this.view.setUint8(this.pos++, v); }
  i8(v) { this.ensure(1); this.view.setInt8(this.pos++, v); }
  u16(v) { this.ensure(2); this.view.setUint16(this.pos, v); this.pos += 2; }
  i16(v) { this.ensure(2); this.view.setInt16(this.pos, v); this.pos += 2; }
  u32(v) { this.ensure(4); this.view.setUint32(this.pos, v >>> 0); this.pos += 4; }
  i32(v) { this.ensure(4); this.view.setInt32(this.pos, v); this.pos += 4; }
  tag(s) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i) || 32); }
  bytes(arr) { this.ensure(arr.length); this.buf.set(arr, this.pos); this.pos += arr.length; }
  pad4() { while (this.pos % 4) this.u8(0); }
  result() { return this.buf.slice(0, this.pos); }
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(bytes) {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readDirectory(bytes, offset) {
  const r = new Reader(bytes, offset);
  const flavor = r.u32();
  const numTables = r.u16();
  r.pos += 6;
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const tag = r.tag(); r.u32();
    const off = r.u32(); const len = r.u32();
    if (off + len > bytes.length) throw new Error(`Table '${tag}' extends past end of file — the font is truncated or corrupt.`);
    tables.set(tag, bytes.slice(off, off + len));
  }
  return { flavor, tables };
}

/** Parse any supported font binary into { flavor, tables: Map<tag, Uint8Array> }. */
export async function readFontFile(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 12) throw new Error('File is too small to be a font.');
  const r = new Reader(bytes);
  const sig = r.tag();
  if (sig === 'wOF2') {
    throw new Error('WOFF2 is not supported for editing yet. Please upload the .ttf or .otf source (Google Fonts and most foundries ship these).');
  }
  if (sig === 'wOFF') {
    const flavor = r.u32(); r.u32();
    const numTables = r.u16();
    r.pos = 44;
    const tables = new Map();
    for (let i = 0; i < numTables; i++) {
      const tag = r.tag(); const off = r.u32(); const compLen = r.u32(); const origLen = r.u32(); r.u32();
      const data = bytes.slice(off, off + compLen);
      tables.set(tag, compLen < origLen ? await inflate(data) : data);
    }
    return { flavor, tables };
  }
  if (sig === 'ttcf') {
    r.u32();
    const numFonts = r.u32();
    if (!numFonts) throw new Error('Empty font collection.');
    return readDirectory(bytes, r.u32()); // first face of the collection
  }
  const flavor = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  if (flavor !== 0x00010000 && sig !== 'OTTO' && sig !== 'true') {
    throw new Error('Unrecognised font format. Supported: .ttf, .otf, .woff, .ttc');
  }
  return readDirectory(bytes, 0);
}

function checksum(bytes) {
  const padded = bytes.length % 4 ? new Uint8Array(bytes.length + 4 - (bytes.length % 4)) : bytes;
  if (padded !== bytes) padded.set(bytes);
  const v = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}

/** Serialise tables into an SFNT binary, computing checksums and head.checkSumAdjustment. */
export function writeSfnt(tables, flavor = 0x00010000) {
  const tags = [...tables.keys()].sort();
  const numTables = tags.length;
  let entrySelector = 0;
  while ((1 << (entrySelector + 1)) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const head = tables.get('head');
  if (head) new DataView(head.buffer, head.byteOffset, head.byteLength).setUint32(8, 0);

  const w = new Writer(1 << 16);
  w.u32(flavor); w.u16(numTables); w.u16(searchRange); w.u16(entrySelector); w.u16(numTables * 16 - searchRange);
  let offset = 12 + numTables * 16;
  const placed = [];
  for (const tag of tags) {
    const data = tables.get(tag);
    w.tag(tag); w.u32(checksum(data)); w.u32(offset); w.u32(data.length);
    placed.push(data);
    offset += (data.length + 3) & ~3;
  }
  for (const data of placed) { w.bytes(data); w.pad4(); }
  const out = w.result();
  if (head) {
    const headOffset = new DataView(out.buffer).getUint32(12 + tags.indexOf('head') * 16 + 8);
    const adj = (0xB1B0AFBA - checksum(out)) >>> 0;
    new DataView(out.buffer).setUint32(headOffset + 8, adj);
  }
  return out;
}

/** Wrap an SFNT binary as WOFF 1.0 (zlib-compressed tables). */
export async function sfntToWoff(sfnt) {
  const { flavor, tables } = readDirectory(sfnt, 0);
  const tags = [...tables.keys()].sort();
  const entries = [];
  for (const tag of tags) {
    const orig = tables.get(tag);
    const comp = await deflate(orig);
    entries.push({ tag, orig, data: comp.length < orig.length ? comp : orig, checksum: checksum(orig) });
  }
  const headerSize = 44 + entries.length * 20;
  let offset = headerSize;
  const w = new Writer(sfnt.length);
  w.tag('wOFF'); w.u32(flavor); w.u32(0); w.u16(entries.length); w.u16(0); w.u32(sfnt.length);
  w.u16(1); w.u16(0); w.u32(0); w.u32(0); w.u32(0); w.u32(0); w.u32(0);
  for (const e of entries) {
    w.tag(e.tag); w.u32(offset); w.u32(e.data.length); w.u32(e.orig.length); w.u32(e.checksum);
    offset += (e.data.length + 3) & ~3;
  }
  for (const e of entries) { w.bytes(e.data); w.pad4(); }
  const out = w.result();
  new DataView(out.buffer).setUint32(8, out.length);
  return out;
}
