// On-device learning from how the tool is used. Every export (strong signal) and every
// setting the designer dwells on (weak signal) becomes a training example. Two models:
//   1. Harmoniser correction — ridge regression predicting the scale/weight corrections a
//      designer applies on top of the geometric auto-match, from base+donor font features.
//   2. Style prior — recency- and signal-weighted settings per typographic class.
// Data never leaves the browser unless the user exports it.

const KEY = 'type_space.learning.v12';
const V1_KEY = 'type_space.learning.v1';
const SETTING_KEYS = ['weight', 'contrast', 'width', 'slant', 'xHeight', 'ascender', 'descender', 'waist', 'tension', 'roundOuter', 'roundInner', 'inktrap', 'dots', 'headline', 'tracking'];
const NEUTRAL = { width: 100, xHeight: 100, ascender: 100, descender: 100, dots: 100 };

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.events) return s; } catch { /* ignore */ }
  // First run of 1.2: start from what 1.0 learned (read-only — 1.0's data is left untouched).
  try { const v1 = JSON.parse(localStorage.getItem(V1_KEY)); if (v1 && v1.events) return { ...v1, importedFromV1: v1.events.length }; } catch { /* ignore */ }
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
  const weight = ev.kind === 'export' ? 1 : ev.kind === 'undo' ? 0 : 0.3;
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
    if (!h.baseF || !h.donorF || e.kind === 'undo') continue;
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
const settingsDistance = (a, b) => SETTING_KEYS.reduce((d, k) => d + Math.abs((a?.[k] ?? NEUTRAL[k] ?? 0) - (b?.[k] ?? NEUTRAL[k] ?? 0)), 0);

/** Typical settings this designer chooses for a class of fonts. Settings that were undone count against similar ones. */
export function stylePrior(classification) {
  const now = Date.now();
  const undone = state.events.filter(e => e.kind === 'undo' && e.settings);
  const positive = state.events.filter(e => e.settings && e.kind !== 'undo');
  const pick = positive.filter(e => !classification || e.classification === classification);
  const pool = pick.length >= 2 ? pick : positive;
  if (!pool.length) return null;
  const acc = {}; let tw = 0;
  for (const e of pool) {
    let w = e.weight * Math.exp(-(now - e.t) / 864e5 / 90);
    for (const u of undone) if (settingsDistance(u.settings, e.settings) < 12) w *= 0.5;
    tw += w;
    for (const k of SETTING_KEYS) acc[k] = (acc[k] || 0) + w * (e.settings[k] ?? NEUTRAL[k] ?? 0);
  }
  if (tw <= 0) return null;
  const out = {};
  for (const k of SETTING_KEYS) out[k] = Math.round(acc[k] / tw);
  return { settings: out, basedOn: pool.length, specific: pick.length >= 2, penalised: undone.length };
}

/** k-nearest past exports by font features — "what did I do with fonts like this one?" */
export function nearestStyles(baseF, k = 3) {
  const ex = state.events.filter(e => e.kind === 'export' && e.baseF && e.settings);
  if (!ex.length) return [];
  const d = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - (b[i] ?? 0)) ** 2, 0));
  return ex.map(e => ({ e, dist: d(baseF, e.baseF) })).sort((x, y) => x.dist - y.dist).slice(0, k)
    .map(({ e, dist }) => ({ classification: e.classification, primary: e.primary, settings: e.settings, similarity: +(1 / (1 + dist)).toFixed(2), t: e.t }));
}

/**
 * Honest accuracy report for the harmoniser: leave-one-out error of the learned model versus
 * the untrained baseline (no correction), as the number of examples grows.
 */
export function accuracyReport() {
  const ex = [];
  for (const e of state.events) for (const h of e.harmonies || []) if (h.baseF && h.donorF && e.kind !== 'undo') ex.push({ x: pairFeatures(h.baseF, h.donorF), y: [h.adjust?.scale || 0, h.adjust?.weight || 0], w: e.weight });
  if (ex.length < 3) return { n: ex.length, curve: [] };
  const curve = [];
  for (let n = 3; n <= ex.length; n++) {
    let errModel = 0, errBase = 0;
    const set = ex.slice(0, n);
    for (let i = 0; i < n; i++) {
      const train = set.filter((_, j) => j !== i);
      const lambda = 4 / Math.sqrt(train.length);
      const bs = ridge(train.map(t => t.x), train.map(t => t.y[0]), train.map(t => t.w), lambda);
      const bw = ridge(train.map(t => t.x), train.map(t => t.y[1]), train.map(t => t.w), lambda);
      const conf = Math.min(1, train.length / 12);
      const ps = bs.reduce((s, b, k) => s + b * set[i].x[k], 0) * conf, pw = bw.reduce((s, b, k) => s + b * set[i].x[k], 0) * conf;
      errModel += Math.abs(ps - set[i].y[0]) + Math.abs(pw - set[i].y[1]);
      errBase += Math.abs(set[i].y[0]) + Math.abs(set[i].y[1]);
    }
    curve.push({ n, model: +(errModel / n).toFixed(2), baseline: +(errBase / n).toFixed(2) });
  }
  return { n: ex.length, curve };
}

export function stats() {
  if (!model) train();
  const exports = state.events.filter(e => e.kind === 'export').length;
  const byClass = {};
  for (const e of state.events) if (e.classification) byClass[e.classification] = (byClass[e.classification] || 0) + 1;
  const scripts = {};
  for (const e of state.events) for (const h of e.harmonies || []) scripts[h.sid] = (scripts[h.sid] || 0) + 1;
  return { importedFromV1: state.importedFromV1 || 0, undos: state.events.filter(e => e.kind === 'undo').length, events: state.events.length, exports, examples: model.n, sliderUse: { ...state.sliderUse }, byClass, scripts, since: state.created, trainedAt: model.trainedAt };
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
