// Type assistant powered by Claude. Runs in the browser with the user's own API key
// (kept in localStorage on their device only) and returns structured parameter changes.
import Anthropic from '@anthropic-ai/sdk';

const KEY_STORE = 'type_space.anthropicKey';
export const MODEL = 'claude-opus-5-5';

export const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
export const setKey = k => { try { k ? localStorage.setItem(KEY_STORE, k.trim()) : localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } };

const num = (description) => ({ type: 'number', description });
const SETTINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['weight', 'contrast', 'penAngle', 'headline', 'width', 'keepStems', 'xHeight', 'ascender', 'descender', 'waist', 'slant', 'tension', 'roundOuter', 'roundInner', 'inktrap', 'dots', 'tracking', 'kerning'],
  properties: {
    weight: num('Stem change in % of the measured vertical stem, -60..150'),
    contrast: num('-100..100; positive thins strokes across the pen angle'),
    penAngle: num('Stress/pen angle in degrees, -60..90. 0 = vertical stress (Latin), 90 = thick horizontals (Hebrew), ~70 Arabic naskh'),
    headline: num('Headline (shirorekha) thickness change in % of bar thickness, -60..150; only for headline scripts'),
    width: num('Horizontal proportion in %, 60..160'),
    keepStems: { type: 'boolean' },
    xHeight: num('Main zone (x-height / headline height) in %, 75..130'),
    ascender: num('Ascender height in %, 80..125'),
    descender: num('Descender depth in %, 70..130'),
    waist: num('Crossbar / join height shift in % of the main zone, -25..25'),
    slant: num('Degrees, -20..20, positive leans right'),
    tension: num('Curve tension in %, -40..40; positive = squarer curves'),
    roundOuter: num('Outer corner radius, thousandths of the em, 0..80'),
    roundInner: num('Inner corner radius, thousandths of the em, 0..60'),
    inktrap: num('Ink trap depth, thousandths of the em, 0..40'),
    dots: num('Size of dots and small diacritics in %, 50..180'),
    tracking: num('Extra advance, thousandths of the em, -80..250'),
    kerning: num('Kerning scale in %, 0..200'),
  },
};

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['settings', 'perScript', 'rationale', 'cautions'],
  properties: {
    settings: SETTINGS_SCHEMA,
    perScript: {
      type: 'array',
      description: 'Optional per-script overrides (ISO 15924 lowercase ids present in the font). Empty when not needed.',
      items: {
        type: 'object', additionalProperties: false, required: ['script', 'settings'],
        properties: { script: { type: 'string' }, settings: SETTINGS_SCHEMA },
      },
    },
    rationale: { type: 'string', description: 'Short typographic reasoning, 2-5 sentences.' },
    cautions: { type: 'array', items: { type: 'string' }, description: 'Script-specific risks (legibility, shaping, mark collisions).' },
  },
};

const SYSTEM = `You are the type-design assistant inside type_space, a parametric font remixer.
You know typographic classification (Vox-ATypI and its critiques), stroke modulation and stress, and the writing systems of the world — alphabets, abjads, abugidas and syllabaries — including how shaping, headlines, matras, nuqta, joining and stacking constrain letterform changes.
The designer describes an intent (or shows lettering); you return parameter values for the tool's stroke-aware engine:
- weight: grows/shrinks strokes with an elliptical pen; thinning is proportional to local stroke thickness, so joins never snap.
- contrast + penAngle: thin the strokes that lie across the pen angle; penAngle sets the stress (0 vertical stress, 90 thick horizontals).
- headline: thickens or thins the shirorekha of headline scripts (Devanagari, Bengali, Gurmukhi, Tirhuta, Modi…).
- width, xHeight, ascender, descender, waist, slant: geometric changes applied to the letter's core, so stroke thickness stays constant in every direction.
- tension: squarer (+) or rounder (−) curves. roundOuter / roundInner: corner radii. inktrap: notches at acute inner joins.
- dots: size of dots, nuqta, anusvara and tittles. tracking / kerning: spacing (combining marks are never spaced).
Defaults are weight 0, contrast 0, penAngle = the script's tradition (0 if unsure), headline 0, width 100, keepStems true, xHeight 100, ascender 100, descender 100, waist 0, slant 0, tension 0, roundOuter 0, roundInner 0, inktrap 0, dots 100, tracking 0, kerning 100.
Use the measured analysis you are given rather than generic assumptions. Be conservative where a change would damage legibility or shaping in a script (for example, heavy weight closes Devanagari counters and can make conjunct stacks collide; slanting Arabic is culturally unusual; Hebrew already has reverse contrast). Values must stay inside the documented ranges.`;

/**
 * @param {object} ctx { request, analysis, settings, scripts, history }
 * @returns {Promise<{settings, perScript, rationale, cautions}>}
 */
export async function suggest(ctx) {
  const apiKey = getKey();
  if (!apiKey) throw new Error('Add your Anthropic API key in the Learn tab to use the assistant.');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const a = ctx.analysis;
  const content = [];
  if (ctx.image) content.push({ type: 'image', source: { type: 'base64', media_type: ctx.image.mediaType, data: ctx.image.data } });
  const brief = {
    font: { classification: a.classification, traits: a.traits, primaryScript: a.primary.name, metrics: a.metrics, latin: a.latin && { class: a.latin.cls, notes: a.latin.notes } },
    scriptsInFont: ctx.scripts,
    perScriptMeasurements: a.perScript,
    currentSettings: ctx.settings,
    designerHistory: ctx.history,
  };
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: [...content, { type: 'text', text: `Font analysis and current state:\n${JSON.stringify(brief, null, 1)}\n\n${ctx.image ? 'The image shows reference lettering. Estimate its stroke weight, contrast, stress angle, proportions, slant, corner and curve character relative to this font, and return settings that move the font toward it. ' : ''}Designer's request: ${ctx.request}` }] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('The API key was rejected. Check it in the Learn tab.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the API — try again in a minute.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the Anthropic API (network or browser blocking).');
    if (e instanceof Anthropic.APIError) throw new Error(`Assistant error ${e.status ?? ''}: ${e.message}`);
    throw e;
  }
  if (response.stop_reason === 'refusal') throw new Error('The assistant declined this request.');
  if (response.stop_reason === 'max_tokens') throw new Error('The assistant ran out of room — try a shorter request.');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try { return JSON.parse(text); } catch { throw new Error('The assistant returned an unexpected format.'); }
}
