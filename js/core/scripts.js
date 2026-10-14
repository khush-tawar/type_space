// Script knowledge base: Unicode blocks, writing-system structure and typographic anatomy.
// `vitality` flags scripts with a thin digital-type ecosystem (often a single Noto design),
// which is where type_space aims to help most.

const R = (a, b) => [a, b];

export const SCRIPTS = [
  { id: 'latn', name: 'Latin', type: 'alphabet', dir: 'ltr', ranges: [R(0x41, 0x5A), R(0x61, 0x7A), R(0xC0, 0x24F), R(0x1E00, 0x1EFF)], refHeight: 'x', refStem: 'l', refBar: 'H', zoneName: 'x-height', shaping: false, vitality: 'thriving',
    sample: 'The quick brown fox jumps over the lazy dog', anatomy: 'Two-case alphabet: caps sit on baseline to cap-height, lowercase on the x-height with ascenders and descenders.' },
  { id: 'grek', name: 'Greek', type: 'alphabet', dir: 'ltr', ranges: [R(0x370, 0x3FF), R(0x1F00, 0x1FFF)], refHeight: 'χ', refStem: 'ι', shaping: false, vitality: 'thriving',
    sample: 'Όλοι οι άνθρωποι γεννιούνται ελεύθεροι και ίσοι στην αξιοπρέπεια και τα δικαιώματα', anatomy: 'Bicameral alphabet sharing proportions with Latin; lowercase has rounder, more cursive ductus.' },
  { id: 'cyrl', name: 'Cyrillic', type: 'alphabet', dir: 'ltr', ranges: [R(0x400, 0x52F)], refHeight: 'х', refStem: 'п', shaping: false, vitality: 'thriving',
    sample: 'Все люди рождаются свободными и равными в своём достоинстве и правах', anatomy: 'Bicameral alphabet; lowercase is mostly small-cap-like, so x-height and horizontal rhythm matter more than in Latin.' },
  { id: 'armn', name: 'Armenian', type: 'alphabet', dir: 'ltr', ranges: [R(0x530, 0x58F)], shaping: false, vitality: 'stable',
    anatomy: 'Bicameral alphabet with many descending and ascending forms built on an open, arched ductus.' },
  { id: 'geor', name: 'Georgian', type: 'alphabet', dir: 'ltr', ranges: [R(0x10D0, 0x10FF), R(0x10A0, 0x10CF)], shaping: false, vitality: 'stable',
    anatomy: 'Mkhedruli is unicameral with four-line structure: many letters ascend or descend from a central body.' },
  { id: 'hebr', name: 'Hebrew', type: 'abjad', dir: 'rtl', ranges: [R(0x591, 0x5FF)], refHeight: 'ה', refStem: 'ו', shaping: true, vitality: 'stable',
    sample: 'כל בני האדם נולדו בני חורין ושווים בערכם ובזכויותיהם', anatomy: 'Square abjad; heavy horizontals and light verticals (reverse contrast to Latin). Vowel points are positioned marks.' },
  { id: 'arab', name: 'Arabic', type: 'abjad', dir: 'rtl', ranges: [R(0x600, 0x6FF), R(0x750, 0x77F), R(0x8A0, 0x8FF)], refHeight: 'ب', refStem: 'ا', shaping: true, vitality: 'thriving',
    sample: 'يولد جميع الناس أحرارًا متساوين في الكرامة والحقوق', anatomy: 'Cursive abjad: each letter has isolated/initial/medial/final forms joined on a baseline; tall alef and lam set the ascender rhythm.' },
  { id: 'nkoo', name: "N'Ko", type: 'alphabet', dir: 'rtl', ranges: [R(0x7C0, 0x7FF)], shaping: true, vitality: 'growing',
    anatomy: 'Joined right-to-left alphabet created in 1949 for Manding languages; letters connect along a baseline.' },
  { id: 'deva', name: 'Devanagari', type: 'abugida', dir: 'ltr', ranges: [R(0x900, 0x97F), R(0xA8E0, 0xA8FF)], refHeight: 'क', refStem: 'ा', shaping: true, headline: true, vitality: 'thriving',
    sample: 'सभी मनुष्यों को गौरव और अधिकारों के मामले में जन्मजात स्वतन्त्रता और समानता प्राप्त है', anatomy: 'Abugida hung from a headline (shirorekha). Conjuncts, reph and vowel signs are built by GSUB/GPOS shaping.' },
  { id: 'beng', name: 'Bengali', type: 'abugida', dir: 'ltr', ranges: [R(0x980, 0x9FF)], refHeight: 'ক', refStem: 'া', shaping: true, headline: true, vitality: 'thriving',
    sample: 'সমস্ত মানুষ স্বাধীনভাবে সমান মর্যাদা এবং অধিকার নিয়ে জন্মগ্রহণ করে', anatomy: 'Headline abugida with rounder bowls than Devanagari and many stacked conjuncts.' },
  { id: 'guru', name: 'Gurmukhi', type: 'abugida', dir: 'ltr', ranges: [R(0xA00, 0xA7F)], refHeight: 'ਕ', refStem: 'ਾ', shaping: true, headline: true, vitality: 'stable',
    sample: 'ਸਾਰਾ ਮਨੁੱਖੀ ਪਰਿਵਾਰ ਆਪਣੀ ਮਹਿਮਾ, ਸ਼ਾਨ ਅਤੇ ਹੱਕਾਂ ਦੇ ਪੱਖੋਂ ਜਨਮ ਤੋਂ ਹੀ ਆਜ਼ਾਦ ਹੈ', anatomy: 'Headline abugida; fewer conjuncts than Devanagari, subjoined forms below the base.' },
  { id: 'gujr', name: 'Gujarati', type: 'abugida', dir: 'ltr', ranges: [R(0xA80, 0xAFF)], refHeight: 'ક', refStem: 'ા', shaping: true, vitality: 'stable',
    sample: 'પ્રતિષ્ઠા અને અધિકારોની દૃષ્ટિએ સર્વ માનવો જન્મથી સ્વતંત્ર અને સમાન હોય છે', anatomy: 'Devanagari-derived abugida without a headline; lighter, more cursive forms.' },
  { id: 'orya', name: 'Odia', type: 'abugida', dir: 'ltr', ranges: [R(0xB00, 0xB7F)], shaping: true, vitality: 'stable', anatomy: 'Abugida with a distinctive rounded canopy over most letters.' },
  { id: 'taml', name: 'Tamil', type: 'abugida', dir: 'ltr', ranges: [R(0xB80, 0xBFF)], refHeight: 'க', shaping: true, vitality: 'thriving',
    sample: 'மனிதப் பிறவியினர் சகலரும் சுதந்திரமாகவே பிறக்கின்றனர்', anatomy: 'Abugida with few conjuncts; a dot (pulli) kills the inherent vowel. Wide, looped letterforms.' },
  { id: 'telu', name: 'Telugu', type: 'abugida', dir: 'ltr', ranges: [R(0xC00, 0xC7F)], shaping: true, vitality: 'thriving', anatomy: 'Rounded abugida with a check-mark-like talakattu and subscript conjunct forms.' },
  { id: 'knda', name: 'Kannada', type: 'abugida', dir: 'ltr', ranges: [R(0xC80, 0xCFF)], shaping: true, vitality: 'stable', anatomy: 'Close sibling of Telugu with rounded bowls and subjoined consonants.' },
  { id: 'mlym', name: 'Malayalam', type: 'abugida', dir: 'ltr', ranges: [R(0xD00, 0xD7F)], shaping: true, vitality: 'stable', anatomy: 'Looping abugida with a large traditional conjunct repertoire.' },
  { id: 'sinh', name: 'Sinhala', type: 'abugida', dir: 'ltr', ranges: [R(0xD80, 0xDFF)], shaping: true, vitality: 'stable', anatomy: 'Curvilinear abugida derived from Brahmi; letters are built from circular strokes.' },
  { id: 'thai', name: 'Thai', type: 'abugida', dir: 'ltr', ranges: [R(0xE00, 0xE7F)], refHeight: 'ก', shaping: true, vitality: 'thriving',
    sample: 'มนุษย์ทั้งหลายเกิดมามีอิสระและเสมอภาคกันในเกียรติศักด์และสิทธิ', anatomy: 'Looped (or loopless modern) abugida, no word spaces, stacked tone marks above.' },
  { id: 'tibt', name: 'Tibetan', type: 'abugida', dir: 'ltr', ranges: [R(0xF00, 0xFFF)], shaping: true, vitality: 'vulnerable', anatomy: 'Hangs from a headline like Devanagari, with deep vertical stacking of consonants.' },
  { id: 'khmr', name: 'Khmer', type: 'abugida', dir: 'ltr', ranges: [R(0x1780, 0x17FF)], shaping: true, vitality: 'stable', anatomy: 'Abugida with subscript consonant clusters and tall vowel signs.' },
  { id: 'ethi', name: 'Ethiopic', type: 'abugida', dir: 'ltr', ranges: [R(0x1200, 0x137F)], shaping: false, vitality: 'stable', anatomy: 'Syllabic abugida (fidel): vowels are modifications of each consonant form, no shaping engine needed.' },
  { id: 'cher', name: 'Cherokee', type: 'syllabary', dir: 'ltr', ranges: [R(0x13A0, 0x13FF), R(0xAB70, 0xABBF)], shaping: false, vitality: 'endangered',
    anatomy: 'Syllabary devised by Sequoyah (1821); uppercase forms resemble Latin caps but carry different sounds.' },
  { id: 'cans', name: 'Canadian Syllabics', type: 'abugida', dir: 'ltr', ranges: [R(0x1400, 0x167F)], shaping: false, vitality: 'vulnerable', anatomy: 'Rotational syllabics: vowel quality is shown by the orientation of a consonant shape.' },
  { id: 'tfng', name: 'Tifinagh', type: 'alphabet', dir: 'ltr', ranges: [R(0x2D30, 0x2D7F)], shaping: false, vitality: 'growing', anatomy: 'Geometric Amazigh alphabet of circles, lines and dots — a natural fit for geometric remixing.' },
  { id: 'vaii', name: 'Vai', type: 'syllabary', dir: 'ltr', ranges: [R(0xA500, 0xA63F)], shaping: false, vitality: 'vulnerable', anatomy: 'Liberian syllabary of the 1830s with geometric, often symmetrical signs.' },
  { id: 'bamu', name: 'Bamum', type: 'syllabary', dir: 'ltr', ranges: [R(0xA6A0, 0xA6FF)], shaping: false, vitality: 'endangered', anatomy: 'Syllabary created by King Njoya of Cameroon (c. 1896); rarely available in digital type.' },
  { id: 'adlm', name: 'Adlam', type: 'alphabet', dir: 'rtl', ranges: [R(0x1E900, 0x1E95F)], shaping: true, vitality: 'growing', anatomy: 'Joined RTL alphabet invented in the 1980s for Fulani; bicameral with flowing connections.' },
  { id: 'olck', name: 'Ol Chiki', type: 'alphabet', dir: 'ltr', ranges: [R(0x1C50, 0x1C7F)], shaping: false, vitality: 'growing', anatomy: 'Santali alphabet (1925) whose letter shapes are pictographic of their names.' },
  { id: 'lepc', name: 'Lepcha', type: 'abugida', dir: 'ltr', ranges: [R(0x1C00, 0x1C4F)], shaping: true, vitality: 'endangered', anatomy: 'Sikkimese abugida written with distinctive hooks; very few typefaces exist.' },
  { id: 'limb', name: 'Limbu', type: 'abugida', dir: 'ltr', ranges: [R(0x1900, 0x194F)], shaping: true, vitality: 'endangered', anatomy: 'Sirijunga abugida of eastern Nepal and Sikkim.' },
  { id: 'bugi', name: 'Buginese (Lontara)', type: 'abugida', dir: 'ltr', ranges: [R(0x1A00, 0x1A1F)], shaping: true, vitality: 'endangered', anatomy: 'Angular Sulawesi script, traditionally used for Bugis and Makassarese manuscripts.' },
  { id: 'bali', name: 'Balinese', type: 'abugida', dir: 'ltr', ranges: [R(0x1B00, 0x1B7F)], shaping: true, vitality: 'vulnerable', anatomy: 'Highly ornamental Brahmic abugida with complex stacking.' },
  { id: 'batk', name: 'Batak', type: 'abugida', dir: 'ltr', ranges: [R(0x1BC0, 0x1BFF)], shaping: true, vitality: 'endangered', anatomy: 'Sumatran abugida historically written on bark books (pustaha).' },
  { id: 'java', name: 'Javanese', type: 'abugida', dir: 'ltr', ranges: [R(0xA980, 0xA9DF)], shaping: true, vitality: 'vulnerable', anatomy: 'Hanacaraka abugida with hanging subscript forms (pasangan).' },
  { id: 'sylo', name: 'Syloti Nagri', type: 'abugida', dir: 'ltr', ranges: [R(0xA800, 0xA82F)], shaping: true, vitality: 'endangered', anatomy: 'Headline abugida of Sylhet, revived digitally only recently.' },
  { id: 'saur', name: 'Saurashtra', type: 'abugida', dir: 'ltr', ranges: [R(0xA880, 0xA8DF)], shaping: true, vitality: 'endangered', anatomy: 'Brahmic script of the Saurashtra community in Tamil Nadu.' },
  { id: 'rjng', name: 'Rejang', type: 'abugida', dir: 'ltr', ranges: [R(0xA930, 0xA95F)], shaping: true, vitality: 'endangered', anatomy: 'Angular Sumatran script, traditionally incised on bamboo.' },
  { id: 'hano', name: 'Hanunoo', type: 'abugida', dir: 'ltr', ranges: [R(0x1720, 0x173F)], shaping: true, vitality: 'endangered', anatomy: 'Philippine script still taught among Hanunó\'o Mangyan communities, traditionally carved on bamboo.' },
  { id: 'tavt', name: 'Tai Viet', type: 'abugida', dir: 'ltr', ranges: [R(0xAA80, 0xAADF)], shaping: true, vitality: 'endangered', anatomy: 'Script of the Tai Dam and Tai Don in Vietnam; vowels may precede consonants visually.' },
  { id: 'mtei', name: 'Meetei Mayek', type: 'abugida', dir: 'ltr', ranges: [R(0xABC0, 0xABFF)], shaping: true, vitality: 'growing', anatomy: 'Manipuri script whose letters are named after parts of the human body.' },
  { id: 'lana', name: 'Tai Tham', type: 'abugida', dir: 'ltr', ranges: [R(0x1A20, 0x1AAF)], shaping: true, vitality: 'endangered', anatomy: 'Lanna script with heavy stacking, used in northern Thailand and Laos.' },
  { id: 'brah', name: 'Brahmi', type: 'abugida', dir: 'ltr', ranges: [R(0x11000, 0x1107F)], shaping: true, vitality: 'historic', anatomy: 'Ancestor of most South and Southeast Asian scripts; geometric strokes of Ashokan inscriptions.' },
  { id: 'kthi', name: 'Kaithi', type: 'abugida', dir: 'ltr', ranges: [R(0x11080, 0x110CF)], shaping: true, vitality: 'historic', anatomy: 'Headline-less administrative script of North India used until the 20th century.' },
  { id: 'cakm', name: 'Chakma', type: 'abugida', dir: 'ltr', ranges: [R(0x11100, 0x1114F)], shaping: true, vitality: 'endangered', anatomy: 'Burmese-related abugida of the Chakma people in Bangladesh and India.' },
  { id: 'mahj', name: 'Mahajani', type: 'abugida', dir: 'ltr', ranges: [R(0x11150, 0x1117F)], shaping: true, vitality: 'historic', anatomy: 'Mercantile Landa-family script once used for bookkeeping in North India.' },
  { id: 'shrd', name: 'Sharada', type: 'abugida', dir: 'ltr', ranges: [R(0x11180, 0x111DF)], shaping: true, vitality: 'historic', anatomy: 'Kashmiri Brahmic script; ancestor of Gurmukhi and Takri.' },
  { id: 'khoj', name: 'Khojki', type: 'abugida', dir: 'ltr', ranges: [R(0x11200, 0x1124F)], shaping: true, vitality: 'historic', anatomy: 'Liturgical script of the Khoja Ismaili community of Sindh.' },
  { id: 'gran', name: 'Grantha', type: 'abugida', dir: 'ltr', ranges: [R(0x11300, 0x1137F)], shaping: true, vitality: 'historic', anatomy: 'South Indian script used for Sanskrit; ancestor of Malayalam.' },
  { id: 'tirh', name: 'Tirhuta (Mithilakshar)', type: 'abugida', dir: 'ltr', ranges: [R(0x11480, 0x114DF)], shaping: true, headline: true, vitality: 'endangered', anatomy: 'Maithili script of Mithila, a headline abugida closely related to Bengali.' },
  { id: 'sidd', name: 'Siddham', type: 'abugida', dir: 'ltr', ranges: [R(0x11580, 0x115FF)], shaping: true, vitality: 'historic', anatomy: 'Medieval Brahmic script preserved in East Asian Buddhist calligraphy.' },
  { id: 'modi', name: 'Modi', type: 'abugida', dir: 'ltr', ranges: [R(0x11600, 0x1165F)], shaping: true, headline: true, vitality: 'endangered', anatomy: 'Cursive Marathi script written without lifting the pen, used until the 1950s.' },
  { id: 'takr', name: 'Takri', type: 'abugida', dir: 'ltr', ranges: [R(0x11680, 0x116CF)], shaping: true, vitality: 'endangered', anatomy: 'Himalayan script of Himachal Pradesh and Jammu, descended from Sharada.' },
  { id: 'soyo', name: 'Soyombo', type: 'abugida', dir: 'ltr', ranges: [R(0x11A50, 0x11AAF)], shaping: true, vitality: 'historic', anatomy: 'Mongolian script created by Zanabazar in 1686; letters hang from a frame.' },
  { id: 'wcho', name: 'Wancho', type: 'alphabet', dir: 'ltr', ranges: [R(0x1E2C0, 0x1E2FF)], shaping: false, vitality: 'growing', anatomy: 'Alphabet created 2001–2012 for the Wancho language of Arunachal Pradesh.' },
];

const byId = new Map(SCRIPTS.map(s => [s.id, s]));
export const scriptById = id => byId.get(id);

const sortedRanges = SCRIPTS.flatMap(s => s.ranges.map(([a, b]) => ({ a, b, s }))).sort((x, y) => x.a - y.a);

export function scriptOf(cp) {
  let lo = 0, hi = sortedRanges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, r = sortedRanges[mid];
    if (cp < r.a) hi = mid - 1; else if (cp > r.b) lo = mid + 1; else return r.s;
  }
  return null;
}

const isLetter = ch => /[\p{L}\p{M}]/u.test(ch);

/** Letters of a script that a font actually covers (in code-point order). */
export function coveredLetters(script, cmap) {
  const out = [];
  for (const [a, b] of script.ranges) for (let cp = a; cp <= b; cp++) {
    if (cmap.has(cp) && /\p{L}/u.test(String.fromCodePoint(cp))) out.push(cp);
  }
  return out;
}

/** Per-script coverage for a font: [{ script, count, total }], most covered first. */
export function scriptCoverage(cmap) {
  const counts = new Map();
  for (const cp of cmap.keys()) {
    const s = scriptOf(cp); if (!s) continue;
    if (!isLetter(String.fromCodePoint(cp))) continue;
    counts.set(s.id, (counts.get(s.id) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ script: byId.get(id), count }))
    .filter(x => x.count >= 5 || x.script.id !== 'latn')
    .sort((a, b) => b.count - a.count);
}

/** A preview string: curated sentence when available, otherwise the covered alphabet. */
export function sampleFor(script, cmap) {
  if (script.sample && [...script.sample].every(ch => ch === ' ' || ch === ',' || !cmap || cmap.has(ch.codePointAt(0)))) return script.sample;
  // Without a font, list the script's encoded letters straight from its Unicode blocks.
  const pool = cmap || { has: cp => /\p{L}/u.test(String.fromCodePoint(cp)) };
  const letters = coveredLetters(script, pool).slice(0, 48).map(cp => String.fromCodePoint(cp));
  const words = [];
  for (let i = 0; i < letters.length; i += 6) words.push(letters.slice(i, i + 6).join(''));
  return words.join(' ');
}

/** The script whose glyphs dominate a font, ignoring incidental Latin in non-Latin fonts. */
export function primaryScript(cmap) {
  const cov = scriptCoverage(cmap);
  // Fonts for complex scripts usually bundle a Latin companion; the complex script is the point.
  const complex = cov.find(c => c.script.id !== 'latn' && c.script.shaping && c.count >= 30);
  const minority = cov.find(c => c.script.id !== 'latn' && c.count >= 15 && !['grek', 'cyrl'].includes(c.script.id));
  return (complex || minority || cov[0])?.script || byId.get('latn');
}

export const VITALITY_LABEL = {
  thriving: 'Well supported', stable: 'Supported', growing: 'Revitalising', vulnerable: 'Limited type',
  endangered: 'Endangered — few typefaces', historic: 'Historic / scholarly',
};
