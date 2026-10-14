# type_space

**A parametric font remixer for every script.** Start from any font, borrow letterforms from another script, reshape outlines with precise vector transforms, and export a real, installable font. Unicode mapping, conjuncts, joining and mark positioning stay intact.

type_space runs entirely in the browser. It is a static site with no build step, and your fonts never leave your machine.

## What it does

- **Load** `.ttf`, `.otf` (CFF), `.woff` or `.ttc`. You can also pick from 70 open fonts in the Google Fonts repository, including Noto families for endangered and historic scripts such as Tirhuta, Modi, Sharada, Lepcha, Ol Chiki, Bamum, Wancho and Siddham.
- **Remix scripts.** Keep a base font and add donor fonts per script (or for figures and punctuation). Donors are harmonised automatically: they are scaled so their main zone matches the base (x-height, headline or body), and their stems are emboldened or thinned to the base's measured stem weight.
- **Transform outlines** with sliders for weight, contrast, width (with stem compensation), slant, main-zone height, corner radius and spacing. You can apply them globally or per script.
- **Edit points directly** in the glyph inspector. You can drag on-curve and off-curve points or nudge them with the arrow keys. Edits are stored on the source outline, and the parametric transforms re-apply on top.
- **Variable fonts** are instanced exactly from `gvar` deltas, with IUP and intermediate regions, at any axis location.
- **Export** `.ttf` or `.woff` with a new family name, a rebuilt Unicode `cmap` (format 4, plus format 12 for supplementary planes) and glyph names kept for further work in FontForge, Glyphs or FontLab.

## How the engine stays accurate

| Stage | What happens |
|---|---|
| Parse | The SFNT/WOFF container is read table by table. TrueType `glyf` is decoded with the exact on/off-curve point structure, and composites are decomposed with their transforms. CFF outlines (via opentype.js) are converted to quadratics within a tolerance of upm/2000. |
| Variations | `fvar`/`avar` normalisation, then `gvar` tuple scalars, shared and private point numbers, and IUP. Phantom points carry the advance-width changes. |
| Transforms | Emboldening uses FreeType's `FT_Outline_EmboldenXY` algorithm in float precision. Everything except corner rounding preserves point structure, so outlines stay interpolation-compatible. |
| Layout | `GSUB`, `GDEF`, `BASE`, `MATH` and `kern` are carried over byte-for-byte. `GPOS` is patched in place: mark-to-base, mark-to-ligature, mark-to-mark and cursive anchors move with the outlines (per glyph, per script), and kerning scales with width. |
| Compile | Unhinted TrueType: `glyf`/`loca`, `hmtx`, `maxp` 1.0, `head`/`hhea` bounds and caret slope, `OS/2` weight/width/selection/x-height, `name`, `post` v2, `gasp`. Variation-only tables and feature variations are removed, so the static instance stays valid. |

Verified with the test suite and against fontTools:

- Decoding matches `fontTools` exactly on static fonts. On variable instances it is within 0.5 units, the difference being rounding only (5,000+ glyphs checked).
- An identity remix reproduces every glyph point-for-point, and `GSUB` comes out byte-identical.
- Compiled fonts pass Chrome's OTS sanitizer, and Devanagari and Tirhuta conjuncts shape correctly in the output.

## AI and learning

- **Font analysis** works on the actual outlines by scanline measurement, for any script: stem and bar thickness, contrast, main-zone height, headline detection, stress angle, aperture and serif structure. For Latin it estimates a classification such as Didone, Garalde, Transitional, Slab, Neo-grotesque, Humanist or Geometric.
- **Script knowledge base.** 55 scripts are described by their Unicode blocks, writing-system type, direction, shaping needs, typographic anatomy and how well they are supported by digital type.
- **On-device learner.** Each export is a strong training signal and each setting you settle on is a weak one. A ridge-regression harmoniser learns the scale and weight corrections you make for a given pair of base and donor fonts, and applies them automatically the next time. A style prior learns the moves you typically make for each class of type. You can export and import the data as JSON.
- **Type assistant (Claude).** Describe an intent, for example "a warm, slightly condensed display cut for a Maithili poetry book". The assistant reads the measured analysis and returns slider settings with reasoning and script-specific cautions. It uses your own Anthropic API key, which is stored only in your browser, and calls `claude-opus-5-5` with structured outputs. Server-side refusal fallbacks are enabled.

## Run locally

```bash
npm install          # only needed for tests (opentype.js, puppeteer-core)
npm start            # serves on http://localhost:5173
npm test             # engine + learner tests
npm run e2e          # drives the app in Chrome (needs `npm start` running)
```

## Deploy

- **GitHub Pages.** Push to `main`. The workflow in `.github/workflows/pages.yml` publishes the site. In the repo settings, set Pages → Source to "GitHub Actions".
- **Vercel.** Run `vercel deploy --prod` from the repo root. No configuration is needed because the site is static.

## Limitations

- WOFF2 input and CFF2 (variable PostScript) are not supported yet. Use the `.ttf`/`.otf` source.
- Exported fonts are static and unhinted. Hinting instructions are dropped because transformed outlines would invalidate them.
- Donor glyphs bring their default forms only: their own `GSUB`/`GPOS` are not merged. For a script that needs shaping (Indic, Arabic, Southeast Asian), make that font the **base**, so its conjuncts, joining and mark positioning are kept.
- If a donor replaces glyphs in the base, the base's kerning and anchors for those glyphs still apply.
- Learning stays in your browser. To pool training data across people, share the exported JSON. A shared server-side model would need a backend.

## Licensing

The code is under the MIT License. Fonts you load keep their own licenses. Open Font License sources may be modified, but a remix must use a new family name and must not use a Reserved Font Name. The export dialog shows the license text of every source font.
