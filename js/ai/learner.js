// On-device learning from how the tool is used. Every export (strong signal) and every
// setting the designer dwells on (weak signal) becomes a training example. Two models:
//   1. Harmoniser correction — ridge regression predicting the scale/weight corrections a
//      designer applies on top of the geometric auto-match, from base+donor font features.
//   2. Style prior — recency- and signal-weighted settings per typographic class.
// Data never leaves the browser unless the user exports it.

const KEY = 'type_space.learning.v1';
const SETTING_KEYS = ['weight', 'contrast', 'width', 'slant', 'xHeight', 'roundness', 'tracking'];

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.events) return s; } catch { /* ignore */ }
  return { events: [], sliderUse: {}, created: Date.now() };
}
let state = load();
let model = null;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota or private mode */ } };

export function noteSliderUse(key) { state.sliderUse[key] = (state.sliderUse[key] || 0) + 1; save(); }

/**
 * ev: { kind:'export'|'dwell', classification, primary, settings, harmonies:[{ sid, baseF, donorF, adjust:{scale,weight} }] }
 */
export function record(ev) {
  const weight = ev.kind === 'export' ? 1 : 0.3;
  state.events.push({ ...ev, weight, t: Date.now() });
  if (state.events.length > 2000) state.events = state.events.slice(-2000);
  save();
  model = null;
}

// Solve (XᵀWX + λI) b = XᵀWy by Gaussian elimination (dimension is small).
function ridge(X, y, w, lambda) {
  const d = X[0].length;
  const A = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j && i > 0 ? lambda : 0)));
  const b = new Array(d).fill(0);
  X.forEach((x, n) => {
    for (let i = 0; i < d; i++) { b[i] += w[n] * x[i] * y[n]; for (let j = 0; j < d; j++) A[i][j] += w[n] * x[i] * x[j]; }
  });
  A[0][0] += 1e-6;
  for (let c = 0; c < d; c++) {
    let p = c; for (let r = c + 1; r < d; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    const piv = A[c][c] || 1e-9;
    for (let r = 0; r < d; r++) {
      if (r === c) continue;
      const f = A[r][c] / piv;
      for (let k = c; k < d; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / (A[i][i] || 1e-9));
}

const pairFeatures = (baseF, donorF) => [1, ...baseF.slice(1), ...donorF.slice(1), ...baseF.slice(1).map((v, i) => v - donorF[i + 1])];

function train() {
  const X = [], ys = [], yw = [], w = [];
  const now = Date.now();
  for (const e of state.events) for (const h of e.harmonies || []) {
    if (!h.baseF || !h.donorF) continue;
    X.push(pairFeatures(h.baseF, h.donorF));
    ys.push(h.adjust?.scale || 0); yw.push(h.adjust?.weight || 0);
    const ageDays = (now - e.t) / 864e5;
    w.push(e.weight * Math.exp(-ageDays / 120));
  }
  model = { n: X.length, trainedAt: now };
  if (X.length >= 2) {
    const lambda = 4 / Math.sqrt(X.length);
    model.scale = ridge(X, ys, w, lambda);
    model.weight = ridge(X, yw, w, lambda);
  }
  return model;
}

/** Learned correction for a base/donor pair, shrunk toward 0 until enough examples exist. */
export function predictAdjust(baseF, donorF) {
  if (!model) train();
  if (!model.scale) return { scale: 0, weight: 0, confidence: 0, n: model.n };
  const x = pairFeatures(baseF, donorF);
  const dot = beta => beta.reduce((s, b, i) => s + b * x[i], 0);
  const confidence = Math.min(1, model.n / 12);
  const clamp = (v, m) => Math.max(-m, Math.min(m, v));
  return { scale: +clamp(dot(model.scale) * confidence, 25).toFixed(1), weight: +clamp(dot(model.weight) * confidence, 60).toFixed(1), confidence, n: model.n };
}

/** Typical settings this designer chooses for a class of fonts (falls back to all history). */
export function stylePrior(classification) {
  const now = Date.now();
  const pick = state.events.filter(e => e.settings && (!classification || e.classification === classification));
  const pool = pick.length >= 2 ? pick : state.events.filter(e => e.settings);
  if (!pool.length) return null;
  const acc = {}; let tw = 0;
  for (const e of pool) {
    const w = e.weight * Math.exp(-(now - e.t) / 864e5 / 90);
    tw += w;
    for (const k of SETTING_KEYS) acc[k] = (acc[k] || 0) + w * (e.settings[k] ?? (k === 'width' || k === 'xHeight' ? 100 : 0));
  }
  const out = {};
  for (const k of SETTING_KEYS) out[k] = Math.round(acc[k] / tw);
  return { settings: out, basedOn: pool.length, specific: pick.length >= 2 };
}

export function stats() {
  if (!model) train();
  const exports = state.events.filter(e => e.kind === 'export').length;
  const byClass = {};
  for (const e of state.events) if (e.classification) byClass[e.classification] = (byClass[e.classification] || 0) + 1;
  const scripts = {};
  for (const e of state.events) for (const h of e.harmonies || []) scripts[h.sid] = (scripts[h.sid] || 0) + 1;
  return { events: state.events.length, exports, examples: model.n, sliderUse: { ...state.sliderUse }, byClass, scripts, since: state.created, trainedAt: model.trainedAt };
}

export function exportData() { return JSON.stringify({ format: 'type_space-learning', version: 1, ...state }, null, 1); }

export function importData(json, merge = true) {
  const d = JSON.parse(json);
  if (d.format !== 'type_space-learning' || !Array.isArray(d.events)) throw new Error('Not a type_space learning file.');
  state = merge ? { ...state, events: [...state.events, ...d.events], sliderUse: { ...d.sliderUse, ...state.sliderUse } } : d;
  save(); model = null;
  return state.events.length;
}

export function reset() { state = { events: [], sliderUse: {}, created: Date.now() }; save(); model = null; }

export function recentHistory(n = 5) {
  return state.events.filter(e => e.kind === 'export').slice(-n).map(e => ({ classification: e.classification, primary: e.primary, settings: e.settings }));
}
