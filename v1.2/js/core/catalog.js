// Open-licensed fonts loadable straight from the google/fonts repository (CORS-enabled).
// Every path here was checked against the repository.
const GF = 'https://raw.githubusercontent.com/google/fonts/main/';

const F = (family, path, cat, scripts, extra = {}) => ({ id: family.toLowerCase().replace(/[^a-z0-9]+/g, '-'), family, url: GF + path, cat, scripts, ...extra });

export const CATALOG = [
  F('Inter', 'ofl/inter/Inter%5Bopsz,wght%5D.ttf', 'Neo-grotesque', ['latn', 'grek', 'cyrl']),
  F('Work Sans', 'ofl/worksans/WorkSans%5Bwght%5D.ttf', 'Grotesque', ['latn']),
  F('Space Grotesk', 'ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf', 'Grotesque', ['latn']),
  F('Syne', 'ofl/syne/Syne%5Bwght%5D.ttf', 'Display sans', ['latn']),
  F('Noto Sans', 'ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf', 'Humanist sans', ['latn', 'grek', 'cyrl']),
  F('Noto Serif', 'ofl/notoserif/NotoSerif%5Bwdth,wght%5D.ttf', 'Transitional', ['latn', 'grek', 'cyrl']),
  F('EB Garamond', 'ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf', 'Garalde', ['latn', 'grek', 'cyrl']),
  F('Libre Baskerville', 'ofl/librebaskerville/LibreBaskerville%5Bwght%5D.ttf', 'Transitional', ['latn']),
  F('Playfair Display', 'ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf', 'Didone', ['latn', 'cyrl']),
  F('Bodoni Moda', 'ofl/bodonimoda/BodoniModa%5Bopsz,wght%5D.ttf', 'Didone', ['latn']),
  F('DM Serif Display', 'ofl/dmserifdisplay/DMSerifDisplay-Regular.ttf', 'Display serif', ['latn']),
  F('Fraunces', 'ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf', 'Soft serif', ['latn']),
  F('Roboto Slab', 'apache/robotoslab/RobotoSlab%5Bwght%5D.ttf', 'Slab serif', ['latn', 'grek', 'cyrl']),

  F('Noto Sans Devanagari', 'ofl/notosansdevanagari/NotoSansDevanagari%5Bwdth,wght%5D.ttf', 'Sans', ['deva', 'latn']),
  F('Noto Serif Devanagari', 'ofl/notoserifdevanagari/NotoSerifDevanagari%5Bwdth,wght%5D.ttf', 'Serif', ['deva', 'latn']),
  F('Hind', 'ofl/hind/Hind-Regular.ttf', 'Humanist sans', ['deva', 'latn']),
  F('Martel', 'ofl/martel/Martel-Regular.ttf', 'Serif', ['deva', 'latn']),
  F('Noto Sans Bengali', 'ofl/notosansbengali/NotoSansBengali%5Bwdth,wght%5D.ttf', 'Sans', ['beng', 'latn']),
  F('Noto Serif Bengali', 'ofl/notoserifbengali/NotoSerifBengali%5Bwdth,wght%5D.ttf', 'Serif', ['beng', 'latn']),
  F('Noto Sans Gurmukhi', 'ofl/notosansgurmukhi/NotoSansGurmukhi%5Bwdth,wght%5D.ttf', 'Sans', ['guru', 'latn']),
  F('Noto Sans Gujarati', 'ofl/notosansgujarati/NotoSansGujarati%5Bwdth,wght%5D.ttf', 'Sans', ['gujr', 'latn']),
  F('Noto Sans Oriya', 'ofl/notosansoriya/NotoSansOriya%5Bwdth,wght%5D.ttf', 'Sans', ['orya', 'latn']),
  F('Noto Sans Tamil', 'ofl/notosanstamil/NotoSansTamil%5Bwdth,wght%5D.ttf', 'Sans', ['taml', 'latn']),
  F('Noto Sans Telugu', 'ofl/notosanstelugu/NotoSansTelugu%5Bwdth,wght%5D.ttf', 'Sans', ['telu', 'latn']),
  F('Noto Sans Kannada', 'ofl/notosanskannada/NotoSansKannada%5Bwdth,wght%5D.ttf', 'Sans', ['knda', 'latn']),
  F('Noto Sans Malayalam', 'ofl/notosansmalayalam/NotoSansMalayalam%5Bwdth,wght%5D.ttf', 'Sans', ['mlym', 'latn']),
  F('Noto Sans Sinhala', 'ofl/notosanssinhala/NotoSansSinhala%5Bwdth,wght%5D.ttf', 'Sans', ['sinh', 'latn']),
  F('Noto Sans Arabic', 'ofl/notosansarabic/NotoSansArabic%5Bwdth,wght%5D.ttf', 'Kufi-influenced sans', ['arab']),
  F('Noto Naskh Arabic', 'ofl/notonaskharabic/NotoNaskhArabic%5Bwght%5D.ttf', 'Naskh', ['arab']),
  F('Amiri', 'ofl/amiri/Amiri-Regular.ttf', 'Naskh (Bulaq)', ['arab', 'latn']),
  F('Noto Sans Hebrew', 'ofl/notosanshebrew/NotoSansHebrew%5Bwdth,wght%5D.ttf', 'Sans', ['hebr']),
  F('Noto Sans Thai', 'ofl/notosansthai/NotoSansThai%5Bwdth,wght%5D.ttf', 'Loopless sans', ['thai']),
  F('Noto Sans Khmer', 'ofl/notosanskhmer/NotoSansKhmer%5Bwdth,wght%5D.ttf', 'Sans', ['khmr']),
  F('Noto Sans Georgian', 'ofl/notosansgeorgian/NotoSansGeorgian%5Bwdth,wght%5D.ttf', 'Sans', ['geor']),
  F('Noto Sans Armenian', 'ofl/notosansarmenian/NotoSansArmenian%5Bwdth,wght%5D.ttf', 'Sans', ['armn']),
  F('Noto Sans Ethiopic', 'ofl/notosansethiopic/NotoSansEthiopic%5Bwdth,wght%5D.ttf', 'Sans', ['ethi']),
  F('Noto Serif Tibetan', 'ofl/notoseriftibetan/NotoSerifTibetan%5Bwght%5D.ttf', 'Serif', ['tibt']),

  F('Noto Sans Tirhuta', 'ofl/notosanstirhuta/NotoSansTirhuta-Regular.ttf', 'Sans', ['tirh']),
  F('Noto Sans Modi', 'ofl/notosansmodi/NotoSansModi-Regular.ttf', 'Sans', ['modi']),
  F('Noto Sans Sharada', 'ofl/notosanssharada/NotoSansSharada-Regular.ttf', 'Sans', ['shrd']),
  F('Noto Sans Takri', 'ofl/notosanstakri/NotoSansTakri-Regular.ttf', 'Sans', ['takr']),
  F('Noto Sans Syloti Nagri', 'ofl/notosanssylotinagri/NotoSansSylotiNagri-Regular.ttf', 'Sans', ['sylo']),
  F('Noto Sans Kaithi', 'ofl/notosanskaithi/NotoSansKaithi-Regular.ttf', 'Sans', ['kthi']),
  F('Noto Sans Mahajani', 'ofl/notosansmahajani/NotoSansMahajani-Regular.ttf', 'Sans', ['mahj']),
  F('Noto Sans Khojki', 'ofl/notosanskhojki/NotoSansKhojki-Regular.ttf', 'Sans', ['khoj']),
  F('Noto Sans Grantha', 'ofl/notosansgrantha/NotoSansGrantha-Regular.ttf', 'Sans', ['gran']),
  F('Noto Sans Siddham', 'ofl/notosanssiddham/NotoSansSiddham-Regular.ttf', 'Sans', ['sidd']),
  F('Noto Sans Brahmi', 'ofl/notosansbrahmi/NotoSansBrahmi-Regular.ttf', 'Sans', ['brah']),
  F('Noto Sans Saurashtra', 'ofl/notosanssaurashtra/NotoSansSaurashtra-Regular.ttf', 'Sans', ['saur']),
  F('Noto Sans Chakma', 'ofl/notosanschakma/NotoSansChakma-Regular.ttf', 'Sans', ['cakm']),
  F('Noto Sans Lepcha', 'ofl/notosanslepcha/NotoSansLepcha-Regular.ttf', 'Sans', ['lepc']),
  F('Noto Sans Limbu', 'ofl/notosanslimbu/NotoSansLimbu-Regular.ttf', 'Sans', ['limb']),
  F('Noto Sans Meetei Mayek', 'ofl/notosansmeeteimayek/NotoSansMeeteiMayek%5Bwght%5D.ttf', 'Sans', ['mtei']),
  F('Noto Sans Wancho', 'ofl/notosanswancho/NotoSansWancho-Regular.ttf', 'Sans', ['wcho']),
  F('Noto Sans Ol Chiki', 'ofl/notosansolchiki/NotoSansOlChiki%5Bwght%5D.ttf', 'Sans', ['olck']),
  F('Noto Sans Soyombo', 'ofl/notosanssoyombo/NotoSansSoyombo-Regular.ttf', 'Sans', ['soyo']),
  F('Noto Sans Tai Tham', 'ofl/notosanstaitham/NotoSansTaiTham%5Bwght%5D.ttf', 'Sans', ['lana']),
  F('Noto Sans Tai Viet', 'ofl/notosanstaiviet/NotoSansTaiViet-Regular.ttf', 'Sans', ['tavt']),
  F('Noto Sans Balinese', 'ofl/notosansbalinese/NotoSansBalinese%5Bwght%5D.ttf', 'Sans', ['bali']),
  F('Noto Sans Javanese', 'ofl/notosansjavanese/NotoSansJavanese%5Bwght%5D.ttf', 'Sans', ['java']),
  F('Noto Sans Buginese', 'ofl/notosansbuginese/NotoSansBuginese-Regular.ttf', 'Sans', ['bugi']),
  F('Noto Sans Batak', 'ofl/notosansbatak/NotoSansBatak-Regular.ttf', 'Sans', ['batk']),
  F('Noto Sans Rejang', 'ofl/notosansrejang/NotoSansRejang-Regular.ttf', 'Sans', ['rjng']),
  F('Noto Sans Hanunoo', 'ofl/notosanshanunoo/NotoSansHanunoo-Regular.ttf', 'Sans', ['hano']),
  F('Noto Sans Cherokee', 'ofl/notosanscherokee/NotoSansCherokee%5Bwght%5D.ttf', 'Sans', ['cher']),
  F('Noto Sans Canadian Aboriginal', 'ofl/notosanscanadianaboriginal/NotoSansCanadianAboriginal%5Bwght%5D.ttf', 'Sans', ['cans']),
  F('Noto Sans Adlam', 'ofl/notosansadlam/NotoSansAdlam%5Bwght%5D.ttf', 'Sans', ['adlm']),
  F('Noto Sans NKo', 'ofl/notosansnko/NotoSansNKo-Regular.ttf', 'Sans', ['nkoo']),
  F('Noto Sans Tifinagh', 'ofl/notosanstifinagh/NotoSansTifinagh-Regular.ttf', 'Sans', ['tfng']),
  F('Noto Sans Vai', 'ofl/notosansvai/NotoSansVai-Regular.ttf', 'Sans', ['vaii']),
  F('Noto Sans Bamum', 'ofl/notosansbamum/NotoSansBamum%5Bwght%5D.ttf', 'Sans', ['bamu']),
];

export const catalogFor = sid => CATALOG.filter(f => f.scripts[0] === sid || f.scripts.includes(sid));

const CACHE = 'type_space-fonts-v1';

/** Fetch a catalog font, cached in the Cache API so it is downloaded once per browser. */
export async function fetchCatalogFont(entry, onProgress) {
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(entry.url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch { /* private mode */ }
  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${entry.family}`);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress?.(total ? got / total : 0);
  }
  const bytes = new Uint8Array(got); let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }
  try { await cache?.put(entry.url, new Response(bytes, { headers: { 'content-type': 'font/ttf' } })); } catch { /* quota */ }
  return bytes;
}

/** Lightweight specimen preview through the Google Fonts CSS API (subset to `text`). */
export function previewCssUrl(family, text) {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&text=${encodeURIComponent(text)}&display=swap`;
}
