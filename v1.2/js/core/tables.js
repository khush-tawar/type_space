// Parsers for the OpenType tables type_space reads. Writers live in build.js.
import { Reader } from './sfnt.js';

export function parseHead(b) {
  const r = new Reader(b);
  return {
    unitsPerEm: r.seek(18).u16(),
    xMin: r.seek(36).i16(), yMin: r.i16(), xMax: r.i16(), yMax: r.i16(),
    macStyle: r.seek(44).u16(),
    indexToLocFormat: r.seek(50).i16(),
  };
}

export function parseHhea(b) {
  const r = new Reader(b);
  return {
    ascender: r.seek(4).i16(), descender: r.i16(), lineGap: r.i16(),
    numberOfHMetrics: r.seek(34).u16(),
  };
}

export function parseMaxp(b) {
  return { numGlyphs: new Reader(b, 4).u16() };
}

export function parseHmtx(b, numGlyphs, numberOfHMetrics) {
  const r = new Reader(b);
  const advances = new Array(numGlyphs); const lsbs = new Array(numGlyphs);
  let last = 0;
  for (let i = 0; i < numGlyphs; i++) {
    if (i < numberOfHMetrics) { last = r.u16(); advances[i] = last; lsbs[i] = r.i16(); }
    else { advances[i] = last; lsbs[i] = r.pos + 2 <= b.length ? r.i16() : 0; }
  }
  return { advances, lsbs };
}

/** Union of every Unicode cmap subtable -> Map<codepoint, glyphId>. Also returns raw format-14 (variation selectors). */
export function parseCmap(b) {
  const r = new Reader(b);
  r.u16();
  const n = r.u16();
  const recs = [];
  for (let i = 0; i < n; i++) recs.push({ platform: r.u16(), encoding: r.u16(), offset: r.u32() });
  const map = new Map();
  let uvs = null;
  const isUnicode = (p, e) => p === 0 || (p === 3 && (e === 1 || e === 10));
  // Read BMP tables first, then full-repertoire tables so format 12 wins on conflicts.
  const sorted = recs.filter(x => isUnicode(x.platform, x.encoding) || (x.platform === 0 && x.encoding === 5))
    .map(x => ({ ...x, format: new Reader(b, x.offset).u16() }))
    .sort((a, c) => (a.format === 12) - (c.format === 12));
  const seen = new Set();
  for (const rec of sorted) {
    if (seen.has(rec.offset)) continue;
    seen.add(rec.offset);
    const s = new Reader(b, rec.offset);
    const format = s.u16();
    if (format === 14) {
      const len = new Reader(b, rec.offset + 2).u32();
      uvs = b.slice(rec.offset, rec.offset + len);
    } else if (format === 4) {
      s.u16(); s.u16();
      const segX2 = s.u16(); const segs = segX2 / 2;
      s.pos += 6;
      const base = s.pos;
      const endO = base, startO = base + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
      const v = new Reader(b);
      for (let i = 0; i < segs; i++) {
        const end = v.seek(endO + i * 2).u16();
        const start = v.seek(startO + i * 2).u16();
        const delta = v.seek(deltaO + i * 2).i16();
        const ro = v.seek(rangeO + i * 2).u16();
        for (let c = start; c <= end && c !== 0xFFFF; c++) {
          let g;
          if (ro === 0) g = (c + delta) & 0xFFFF;
          else {
            const at = rangeO + i * 2 + ro + (c - start) * 2;
            if (at + 2 > b.length) continue;
            g = v.seek(at).u16();
            if (g !== 0) g = (g + delta) & 0xFFFF;
          }
          if (g) map.set(c, g);
        }
      }
    } else if (format === 12) {
      s.u16(); s.u32(); s.u32();
      const groups = s.u32();
      for (let i = 0; i < groups; i++) {
        const start = s.u32(), end = s.u32(), g0 = s.u32();
        for (let c = start; c <= end; c++) if (g0 + c - start) map.set(c, g0 + c - start);
      }
    } else if (format === 0) {
      s.u16(); s.u16();
      for (let c = 0; c < 256; c++) { const g = s.u8(); if (g) map.set(c, g); }
    } else if (format === 6) {
      s.u16(); s.u16();
      const first = s.u16(), count = s.u16();
      for (let i = 0; i < count; i++) { const g = s.u16(); if (g) map.set(first + i, g); }
    }
  }
  return { map, uvs };
}

const MAC_ROMAN_HIGH = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

export function parseName(b) {
  const r = new Reader(b);
  r.u16();
  const count = r.u16(); const strOff = r.u16();
  const records = [];
  for (let i = 0; i < count; i++) {
    const platformID = r.u16(), encodingID = r.u16(), languageID = r.u16(), nameID = r.u16(), length = r.u16(), offset = r.u16();
    const start = strOff + offset;
    let str = '';
    if (platformID === 0 || platformID === 3) {
      for (let j = 0; j + 1 < length; j += 2) str += String.fromCharCode((b[start + j] << 8) | b[start + j + 1]);
    } else if (platformID === 1 && encodingID === 0) {
      for (let j = 0; j < length; j++) { const c = b[start + j]; str += c < 128 ? String.fromCharCode(c) : MAC_ROMAN_HIGH[c - 128]; }
    } else continue;
    records.push({ platformID, encodingID, languageID, nameID, value: str });
  }
  const get = id => (records.find(x => x.nameID === id && x.platformID === 3 && x.languageID === 0x409)
    || records.find(x => x.nameID === id))?.value || '';
  return { records, get };
}

export function parseOS2(b) {
  const r = new Reader(b);
  const version = r.u16();
  const o = {
    version, xAvgCharWidth: r.i16(), usWeightClass: r.u16(), usWidthClass: r.u16(), fsType: r.u16(),
  };
  o.panose = Array.from(b.slice(32, 42));
  r.seek(62); o.fsSelection = r.u16(); o.usFirstCharIndex = r.u16(); o.usLastCharIndex = r.u16();
  o.sTypoAscender = r.i16(); o.sTypoDescender = r.i16(); o.sTypoLineGap = r.i16();
  o.usWinAscent = r.u16(); o.usWinDescent = r.u16();
  if (version >= 2 && b.length >= 96) { r.seek(86); o.sxHeight = r.i16(); o.sCapHeight = r.i16(); }
  return o;
}

export const STANDARD_MAC_NAMES = '.notdef .null nonmarkingreturn space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute agrave acircumflex adieresis atilde aring ccedilla eacute egrave ecircumflex edieresis iacute igrave icircumflex idieresis ntilde oacute ograve ocircumflex odieresis otilde uacute ugrave ucircumflex udieresis dagger degree cent sterling section bullet paragraph germandbls registered copyright trademark acute dieresis notequal AE Oslash infinity plusminus lessequal greaterequal yen mu partialdiff summation product pi integral ordfeminine ordmasculine Omega ae oslash questiondown exclamdown logicalnot radical florin approxequal Delta guillemotleft guillemotright ellipsis nonbreakingspace Agrave Atilde Otilde OE oe endash emdash quotedblleft quotedblright quoteleft quoteright divide lozenge ydieresis Ydieresis fraction currency guilsinglleft guilsinglright fi fl daggerdbl periodcentered quotesinglbase quotedblbase perthousand Acircumflex Ecircumflex Aacute Edieresis Egrave Iacute Icircumflex Idieresis Igrave Oacute Ocircumflex apple Ograve Uacute Ucircumflex Ugrave dotlessi circumflex tilde macron breve dotaccent ring cedilla hungarumlaut ogonek caron Lslash lslash Scaron scaron Zcaron zcaron brokenbar Eth eth Yacute yacute Thorn thorn minus multiply onesuperior twosuperior threesuperior onehalf onequarter threequarters franc Gbreve gbreve Idotaccent Scedilla scedilla Cacute cacute Ccaron ccaron dcroat'.split(' ');

export function parsePost(b, numGlyphs) {
  const r = new Reader(b);
  const version = r.fixed();
  const italicAngle = r.fixed();
  const out = { version, italicAngle, underlinePosition: r.i16(), underlineThickness: r.i16(), names: null };
  if (Math.abs(version - 2) < 1e-6) {
    r.seek(32);
    const n = r.u16();
    const idx = []; for (let i = 0; i < n; i++) idx.push(r.u16());
    const extra = [];
    while (r.pos < b.length) { const len = r.u8(); let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(r.u8()); extra.push(s); }
    out.names = idx.slice(0, numGlyphs).map(i => (i < 258 ? STANDARD_MAC_NAMES[i] : extra[i - 258]) || '');
  }
  return out;
}

export function parseFvar(b, nameTable) {
  const r = new Reader(b);
  r.u32();
  const axesOff = r.u16(); r.u16();
  const axisCount = r.u16(), axisSize = r.u16(), instCount = r.u16(), instSize = r.u16();
  const axes = [];
  for (let i = 0; i < axisCount; i++) {
    r.seek(axesOff + i * axisSize);
    const tag = r.tag();
    const min = r.fixed(), def = r.fixed(), max = r.fixed();
    r.u16();
    const nameID = r.u16();
    axes.push({ tag, min, def, max, name: nameTable?.get(nameID) || tag });
  }
  const instances = [];
  const instStart = axesOff + axisCount * axisSize;
  for (let i = 0; i < instCount; i++) {
    r.seek(instStart + i * instSize);
    const nameID = r.u16(); r.u16();
    const coords = {};
    for (const a of axes) coords[a.tag] = r.fixed();
    instances.push({ name: nameTable?.get(nameID) || `Instance ${i + 1}`, coords });
  }
  return { axes, instances };
}

export function parseAvar(b, axisCount) {
  const r = new Reader(b);
  r.u32(); r.u16();
  const n = r.u16();
  const maps = [];
  for (let i = 0; i < Math.min(n, axisCount); i++) {
    const count = r.u16(); const m = [];
    for (let j = 0; j < count; j++) m.push([r.f2dot14(), r.f2dot14()]);
    maps.push(m);
  }
  return maps;
}

/** User-space axis values -> normalized [-1, 1] coordinates (fvar + avar). */
export function normalizeCoords(axes, avar, user) {
  return axes.map((a, i) => {
    let v = user[a.tag] ?? a.def;
    v = Math.min(a.max, Math.max(a.min, v));
    let n = v < a.def ? (a.def === a.min ? 0 : (v - a.def) / (a.def - a.min))
      : v > a.def ? (a.max === a.def ? 0 : (v - a.def) / (a.max - a.def)) : 0;
    const map = avar?.[i];
    if (map && map.length) {
      for (let k = 1; k < map.length; k++) {
        const [f0, t0] = map[k - 1], [f1, t1] = map[k];
        if (n <= f1) { n = f1 === f0 ? t0 : t0 + (t1 - t0) * (n - f0) / (f1 - f0); break; }
      }
    }
    return Math.round(n * 16384) / 16384;
  });
}
