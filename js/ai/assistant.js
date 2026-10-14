// Type assistant powered by Claude. Runs in the browser with the user's own API key
// (kept in localStorage on their device only) and returns structured parameter changes.
import Anthropic from '@anthropic-ai/sdk';

const KEY_STORE = 'type_space.anthropicKey';
export const MODEL = 'claude-opus-5-5';

export const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
export const setKey = k => { try { k ? localStorage.setItem(KEY_STORE, k.trim()) : localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } };

const SETTINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['weight', 'contrast', 'width', 'keepStems', 'slant', 'xHeight', 'roundness', 'roundMode', 'tracking'],
  properties: {
    weight: { type: 'number', description: 'Stem change in % of the measured vertical stem, -60..150' },
    contrast: { type: 'number', description: '-100..100; positive thins horizontal strokes' },
    width: { type: 'number', description: 'Horizontal proportion in %, 60..160' },
    keepStems: { type: 'boolean' },
    slant: { type: 'number', description: 'Degrees, -20..20, positive leans right' },
    xHeight: { type: 'number', description: 'Main-zone height (x-height / headline) in %, 75..130' },
    roundness: { type: 'number', description: 'Corner radius in thousandths of the em, 0..80' },
    roundMode: { type: 'string', enum: ['outer', 'inner', 'all'] },
    tracking: { type: 'number', description: 'Extra advance in thousandths of the em, -80..250' },
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
The designer describes an intent; you return parameter values for the tool's transform engine:
- weight: % of measured vertical stem added (FreeType-style emboldening; negative thins).
- contrast: positive thins horizontal strokes relative to vertical ones.
- width: horizontal scale, with keepStems compensating stem thickness.
- slant: oblique skew in degrees (not a true italic).
- xHeight: remaps the main zone (Latin x-height, Brahmic headline height) while keeping ascender tops fixed.
- roundness: corner radius on straight-line corners; roundMode outer/inner/all.
- tracking: extra advance per glyph; combining marks are never spaced.
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
      messages: [{ role: 'user', content: `Font analysis and current state:\n${JSON.stringify(brief, null, 1)}\n\nDesigner's request: ${ctx.request}` }],
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
