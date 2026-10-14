// The harmoniser should learn a consistent correction from repeated exports.
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
const L = await import('../js/ai/learner.js');
const baseF = [1, 0.65, 0.56, 1.24, 0, 1, 1], donorF = [1, 0.87, 2.2, 1.03, 1, 0, 0];
console.log('before:', L.predictAdjust(baseF, donorF));
for (let i = 0; i < 12; i++) L.record({ kind: 'export', classification: 'Didone', primary: 'deva', settings: { weight: 20 + i % 3, width: 100, xHeight: 100 },
  harmonies: [{ sid: 'latn', baseF, donorF: donorF.map((v, j) => j ? v + (i % 4) * 0.01 : v), adjust: { scale: -8, weight: 12 } }] });
const p = L.predictAdjust(baseF, donorF);
console.log('after 12 exports:', p);
console.log('style prior:', L.stylePrior('Didone'));
if (Math.abs(p.scale + 8) > 2 || Math.abs(p.weight - 12) > 3) { console.error('FAIL: learner did not converge'); process.exit(1); }
console.log('PASS');
