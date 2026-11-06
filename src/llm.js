// llm.js — the optional Oracle: Claude reads free-text effects and returns the
// SAME intermediate form the deterministic lexicon produces (domain weights,
// a few primitive hints, a name and an inscription). That goes back through
// compileEffects(), so the LLM can colour the reading but can never produce
// an invalid or unprintable genome.
//
// Bring-your-own-key: the key stays in this browser (memory, or localStorage
// only if the user ticks "remember"), and requests go straight from the
// browser to the Claude API. The SDK is loaded only when the Oracle is used.
import { CATALOG, DOMAINS } from './genome.js?v=1.1.0';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.4.0/+esm';
export const ORACLE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best reading)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest)' },
];

const weights = {
  type: 'object', additionalProperties: false, required: DOMAINS,
  properties: Object.fromEntries(DOMAINS.map((d) => [d, { type: 'number', description: '0..1 share of this domain' }])),
};
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'inscription', 'effects', 'hints'],
  properties: {
    name: { type: 'string', description: 'Short evocative sigil name, e.g. "Sigil of the Quiet Hearth"' },
    inscription: { type: 'string', description: '3–5 short lines in the soulfire voice; whimsical, never solemn about real harm' },
    effects: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['slot', 'label', 'weights'],
        properties: { slot: { type: 'integer', enum: [1, 2, 3] }, label: { type: 'string' }, weights },
      },
    },
    hints: {
      type: 'object', additionalProperties: false,
      required: ['symmetry', 'core', 'spokes', 'terminal', 'ring', 'lattice', 'motifs'],
      properties: {
        symmetry: { type: 'string', enum: ['D1', 'D2', 'D3', 'D4', 'D6', 'D8', 'D12', 'C1', 'C2', 'C3', 'C5', 'C7'] },
        core: { type: 'string', enum: CATALOG.core },
        spokes: { type: 'string', enum: CATALOG.spokes },
        terminal: { type: 'string', enum: CATALOG.terminal },
        ring: { type: 'string', enum: CATALOG.ring },
        lattice: { type: 'string', enum: CATALOG.lattice },
        motifs: { type: 'array', items: { type: 'string', enum: CATALOG.motif } },
      },
    },
  },
};

const SYSTEM = `You are the Thaumaturgical Compiler of Soulfire Mage's Spellforge, a novelty site that turns
"effects" into 3D-printable sigils. You never draw. You translate 1–3 effects into parameters.

Slots: 1 = Primary Intent (core glyph and symmetry), 2 = Secondary Modifier (spokes, lattice, motifs),
3 = Tertiary Binding (outer ring and framing).

Each effect gets weights over four domains (they need not sum to 1; they are normalised):
- ward: protection, stasis, home, boundaries → high dihedral symmetry (D6, D8, D12), thick rings, inward teeth, fork terminals
- kinetic: energy, catalyst, courage, projection → odd rotational symmetry (C3, C5, C7), spirals, spear and flame terminals
- focus: clarity, harmony, wisdom, calm → bilateral or harmonic (D1, D2, D4), golden-ratio rings, eye / rosette / seed cores
- entropy: banishing, change, luck, disruption → C1, C2 or D3, zigzag lightning spokes, split rings, wedge glyphs

Hints are preferences only; the forge ignores any hint the effects' domains don't allow.
The inscription is in a warm mythic voice about soulfire, the first flame from which life was forged:
playful, tongue in cheek, 3–5 short lines. Never claim real-world efficacy. If an effect asks for
something harmful, reinterpret it gently as protection, calm or courage.`;

let sdkPromise = null;
const loadSDK = () => (sdkPromise ||= import(SDK_URL).then((m) => m.default || m.Anthropic));

/**
 * Ask Claude to read the effects. Returns { name, inscription, effects:[{slot,label,w}], hints }.
 * @param {string[]} texts   1–3 effect strings (preset labels or free text)
 * @param {{ apiKey: string, model?: string }} cfg
 */
export async function consultOracle(texts, { apiKey, model = ORACLE_MODELS[0].id } = {}) {
  if (!apiKey) throw new Error('No API key: add one under "Oracle" to use it.');
  const Anthropic = await loadSDK();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const fallback = model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  const user = texts.map((t, i) => `Slot ${i + 1}: ${t}`).join('\n');
  let res;
  try {
    res = await client.beta.messages.create({
      model,
      max_tokens: 2000,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: `Compile these effects:\n${user}` }],
      ...fallback,
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('The Oracle rejected that API key.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('The Oracle is busy (rate limited). Try again shortly.');
    if (err instanceof Anthropic.APIError) throw new Error(`Oracle error ${err.status}: ${err.message}`);
    throw err;
  }
  if (res.stop_reason === 'refusal') throw new Error('The Oracle declined to read those effects. Try different words.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = JSON.parse(text);
  const effects = texts.map((label, i) => {
    const e = out.effects.find((x) => x.slot === i + 1) || out.effects[i] || {};
    return { slot: i + 1, id: null, text: label, label: e.label || label, w: e.weights || { focus: 1 } };
  });
  return { name: out.name, inscription: out.inscription, effects, hints: out.hints };
}

const KEY = 'spellforge.oracle';
export function loadOracleSettings() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (_) { return {}; }
}
export function saveOracleSettings(s) {
  try {
    if (s.remember) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.setItem(KEY, JSON.stringify({ model: s.model, remember: false }));
  } catch (_) { /* storage blocked: memory only */ }
}
