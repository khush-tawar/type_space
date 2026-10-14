// type_space — application controller.
import { loadFont, resolveAll } from './core/font-model.js';
import { analyzeFont, featureVector } from './core/analysis.js';
import { prepareRemix, draftGlyphs, preciseJobs, compileRemix, COMMON, metricsFor } from './core/remix.js';
import { DEFAULT_SETTINGS, SCRIPT_PEN, needsPrecise } from './core/transforms.js';
import { buildMorphFont, MORPH_TAG } from './core/variable.js';
import { styleProfile, transferRows, rowsToSettings } from './ai/transfer.js';
import { sfntToWoff } from './core/sfnt.js';
import { SCRIPTS, scriptById, scriptCoverage, sampleFor, VITALITY_LABEL, scriptOf } from './core/scripts.js';
import { CATALOG, fetchCatalogFont, previewCssUrl, catalogFor } from './core/catalog.js';
import { saveProject, loadProject, clearProject, serializeEdits, deserializeEdits } from './core/store.js';
import * as learner from './ai/learner.js';
import { mountEditor, glyphThumb } from './ui/glyph-editor.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const S = {
  base: null, baseA: null, baseBytes: null, baseName: '', baseCatalog: null,
  donors: [],
  settings: { ...DEFAULT_SETTINGS },
  scriptSettings: {},
  scope: 'all',
  edits: new Map(),
  meta: { family: '', style: '', version: '1.000', designer: '' },
  compare: 'remix', size: 88, sampleScript: null, customText: {},
  build: null, faceSerial: 0, remixFace: null, origFace: null,
  history: [], future: [],
  selectedGlyph: null, glyphLimit: 400,
  engine: 'precise', buildId: 0, refine: null, waiters: [], openGroups: { stroke: true, proportion: true },
  morph: { face: null, serial: 0, playing: true, t: 0, raf: 0, stale: true },
  transfer: { src: 'font', rows: [], ref: null },
};
const VERSION = '1.2.0';

// ---------- toast & status ----------
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('is-error', isError); t.classList.add('is-on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), isError ? 6000 : 2600);
}
const status = (msg, ok = false) => { const s = $('#statusText'); s.textContent = msg; s.classList.toggle('ok', ok); };

// ---------- views ----------
function showView(name) {
  if (!['remix', 'glyphs', 'library', 'scripts', 'transfer', 'learn', 'about', 'privacy', 'contact'].includes(name)) name = 'remix';
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === `view-${name}`));
  $$('.tabs a').forEach(a => a.classList.toggle('is-active', a.dataset.view === name));
  document.body.classList.toggle('is-workspace', (name === 'remix' && !!S.base) || name === 'glyphs');
  if (name === 'transfer') renderTransfer();
  if (name === 'contact') renderContact();
  if (['about', 'privacy', 'contact'].includes(name)) window.scrollTo(0, 0);
  if (name === 'glyphs') renderGlyphs();
  if (name === 'library') renderLibrary();
  if (name === 'scripts') renderScripts();
  if (name === 'learn') renderLearn();
}
window.addEventListener('hashchange', () => { $$('.modal').forEach(m => { m.hidden = true; }); showView(location.hash.slice(1)); });

// ---------- history ----------
function snapshot() {
  return JSON.stringify({
    settings: S.settings, scriptSettings: S.scriptSettings, edits: serializeEdits(S.edits),
    donors: S.donors.map(d => ({ id: d.id, scripts: d.scripts, mode: d.mode, adjust: d.adjust })),
  });
}
function commit() {
  const snap = snapshot();
  if (S.history[S.history.length - 1] !== snap) { S.history.push(snap); if (S.history.length > 200) S.history.shift(); S.future = []; }
  updateUndo();
  autosave();
}
function restore(snap) {
  const o = JSON.parse(snap);
  S.settings = o.settings; S.scriptSettings = o.scriptSettings; S.edits = deserializeEdits(o.edits);
  for (const dd of o.donors) { const d = S.donors.find(x => x.id === dd.id); if (d) Object.assign(d, dd); }
  renderParams(); renderDonors(); scheduleBuild(); autosave();
}
function undo() {
  if (S.history.length < 2) return;
  const undone = S.history.pop();
  S.future.push(undone);
  try { if (S.baseA) learner.record(learningEvent('undo', JSON.parse(undone).settings)); } catch { /* ignore */ }
  restore(S.history[S.history.length - 1]); updateUndo();
}
function redo() { if (!S.future.length) return; const s = S.future.pop(); S.history.push(s); restore(s); updateUndo(); }
function updateUndo() { $('#undoBtn').disabled = S.history.length < 2; $('#redoBtn').disabled = !S.future.length; }

// ---------- persistence ----------
const autosave = debounce(() => {
  if (!S.base) return;
  saveProject('current', {
    baseBytes: S.baseBytes, baseName: S.baseName, baseCatalog: S.baseCatalog, axisValues: S.base.axisValues,
    donors: S.donors.map(d => ({ id: d.id, bytes: d.bytes, name: d.name, scripts: d.scripts, mode: d.mode, adjust: d.adjust, axisValues: d.model.axisValues })),
    settings: S.settings, scriptSettings: S.scriptSettings, edits: serializeEdits(S.edits), meta: S.meta,
    customText: S.customText, sampleScript: S.sampleScript, engine: S.engine,
  });
}, 800);

async function restoreProject() {
  const p = await loadProject('current');
  if (!p?.baseBytes) return false;
  try {
    await setBase(p.baseBytes, p.baseName, p.baseCatalog, { keepState: true, axisValues: p.axisValues });
    for (const d of p.donors || []) await addDonor(d.bytes, d.name, { id: d.id, scripts: d.scripts, mode: d.mode, adjust: d.adjust, axisValues: d.axisValues, quiet: true });
    S.settings = { ...DEFAULT_SETTINGS, ...p.settings };
    S.scriptSettings = p.scriptSettings || {};
    S.edits = deserializeEdits(p.edits);
    S.meta = { ...S.meta, ...p.meta };
    S.customText = p.customText || {};
    S.sampleScript = p.sampleScript || S.sampleScript;
    S.engine = p.engine || 'precise';
    $$('[data-engine]').forEach(x => x.classList.toggle('is-on', x.dataset.engine === S.engine));
    renderAll(); commit(); scheduleBuild();
    toast(`Restored your last session — ${S.base.info.family}`);
    return true;
  } catch (e) { console.warn(e); await clearProject('current'); return false; }
}

// ---------- loading ----------
async function readFileInput(file) { return new Uint8Array(await file.arrayBuffer()); }

async function setBase(bytes, name, catalogId = null, { keepState = false, axisValues = null } = {}) {
  status(`Reading ${name}…`);
  const model = await loadFont(bytes, { fileName: name, axisValues });
  if (model.numGlyphs > 12000) toast(`${model.numGlyphs.toLocaleString()} glyphs — previews will rebuild a little slower.`);
  S.base = model; S.baseBytes = bytes; S.baseName = name; S.baseCatalog = catalogId;
  S.baseA = analyzeFont(model);
  if (!keepState) {
    S.settings = { ...DEFAULT_SETTINGS }; S.scriptSettings = {}; S.edits = new Map(); S.scope = 'all';
    S.history = []; S.future = []; S.customText = {};
    S.meta.family = `${model.info.family} Remix`; S.meta.style = 'Regular';
    S.sampleScript = S.baseA.primary.id;
  }
  if (S.origFace) document.fonts.delete(S.origFace);
  try {
    S.origFace = new FontFace('ts-original', bytes.slice().buffer);
    await S.origFace.load(); document.fonts.add(S.origFace);
  } catch { S.origFace = null; }
  $('#emptyState').hidden = true; $('#workspace').hidden = false; $('#exportBtn').disabled = false;
  document.body.classList.toggle('is-workspace', $('#view-remix').classList.contains('is-active'));
  if (!keepState) { renderAll(); commit(); scheduleBuild(); }
}

async function addDonor(bytes, name, o = {}) {
  const model = await loadFont(bytes, { fileName: name, axisValues: o.axisValues });
  const analysis = analyzeFont(model);
  const id = o.id || `d${Date.now().toString(36)}`;
  const covered = scriptCoverage(model.cmap).map(c => c.script.id);
  let scripts = o.scripts;
  if (!scripts) {
    // Default: the donor's primary script, plus punctuation/figures when it is a Latin donor.
    const prim = analysis.primary.id;
    scripts = [prim]; if (prim === 'latn') scripts.push(COMMON);
  }
  const donor = { id, model, analysis, bytes, name, scripts: scripts.filter(s => s === COMMON || covered.includes(s)), mode: o.mode || 'replace', adjust: o.adjust || { scale: 0, weight: 0, baseline: 0, matchWeight: true } };
  if (!o.adjust && S.baseA) {
    const learned = learner.predictAdjust(featureVector(S.baseA), featureVector(analysis));
    if (learned.confidence > 0) { donor.adjust.scale = learned.scale; donor.adjust.weight = learned.weight; donor.learned = learned; }
  }
  S.donors.push(donor);
  if (!o.quiet) { renderDonors(); renderSamples(); commit(); scheduleBuild(); toast(`Added ${model.info.family} as a donor`); }
  return donor;
}

async function loadCatalog(entry, role, extra = {}) {
  try {
    status(`Downloading ${entry.family}…`);
    const bytes = await fetchCatalogFont(entry, p => status(`Downloading ${entry.family}… ${Math.round(p * 100)}%`));
    const fname = decodeURIComponent(entry.url.split('/').pop());
    if (role === 'base') { await setBase(bytes, fname, entry.id); location.hash = 'remix'; }
    else await addDonor(bytes, fname, extra);
  } catch (e) { console.error(e); toast(e.message, true); status('Ready'); }
}

async function handleFile(file, role = 'base') {
  try {
    const bytes = await readFileInput(file);
    if (role === 'base') { await setBase(bytes, file.name); location.hash = 'remix'; }
    else await addDonor(bytes, file.name);
  } catch (e) { console.error(e); toast(e.message, true); status('Ready'); }
}

// ---------- build: instant draft, then precise refinement in a worker ----------
const project = (meta = {}) => ({
  base: S.base, baseAnalysis: S.baseA, settings: S.settings, scriptSettings: S.scriptSettings,
  donors: S.donors, edits: S.edits, meta: { ...S.meta, family: S.meta.family || 'Untitled', designer: S.meta.designer, ...meta },
});
const refineCache = new Map();
let worker = null, workerOk = true;
function getWorker() {
  if (worker || !workerOk) return worker;
  try {
    worker = new Worker(new URL('./workers/refine.js', import.meta.url), { type: 'module' });
    worker.onmessage = onWorker;
    worker.onerror = e => { console.error('refine worker', e); workerOk = false; worker = null; $('#engineState').textContent = 'Precise engine unavailable — showing draft'; flushWaiters(); };
  } catch (e) { console.error(e); workerOk = false; }
  return worker;
}

let buildQueued = false;
function scheduleBuild() {
  if (buildQueued) return;
  buildQueued = true;
  const wait = (S.build?.ms || 0) > 200 ? Math.min(900, S.build.ms * 1.5) : 0;
  S.morph.stale = true;
  requestAnimationFrame(() => setTimeout(runBuild, wait));
}

async function runBuild() {
  buildQueued = false;
  if (!S.base) return;
  const t0 = performance.now();
  let prep, draft;
  try { prep = prepareRemix(project()); draft = draftGlyphs(prep); }
  catch (e) { console.error(e); status('Build failed: ' + e.message); toast(e.message, true); return; }
  const id = ++S.buildId;
  S.prep = prep; S.draft = draft;
  const glyphs = draft.slice();
  const pending = [];
  const precise = S.engine === 'precise' && workerOk;
  if (precise) for (const j of preciseJobs(prep)) {
    const hit = refineCache.get(j.key);
    if (hit) glyphs[j.gid] = { ...glyphs[j.gid], contours: hit }; else pending.push(j);
  }
  const anyPrecise = [...prep.plans.values()].some(needsPrecise);
  await present(prep, glyphs, id, performance.now() - t0, pending.length ? 'draft' : precise && anyPrecise ? 'precise' : 'exact');
  if (pending.length && getWorker()) {
    S.refine = { id, prep, glyphs, total: pending.length };
    $('#engineState').textContent = `Refining ${pending.length.toLocaleString()} glyphs…`;
    worker.postMessage({ id, jobs: pending });
  } else { S.refine = null; flushWaiters(); }
  if (S.compare === 'morph') refreshMorph();
}

function onWorker(e) {
  const { id, results, done, progress } = e.data;
  const r = S.refine;
  if (!r || r.id !== id) return;
  for (const res of results || []) {
    if (res.error) { console.warn('refine failed for glyph', res.gid, res.error); continue; }
    refineCache.set(res.key, res.contours);
    r.glyphs[res.gid] = { ...r.glyphs[res.gid], contours: res.contours };
  }
  if (refineCache.size > 30000) refineCache.clear();
  if (progress != null && !done) $('#engineState').textContent = `Refining ${Math.round(progress * 100)}%`;
  if (done) { S.refine = null; present(r.prep, r.glyphs, id, null, 'precise').then(flushWaiters); }
}

function flushWaiters() { const w = S.waiters.splice(0); w.forEach(f => f()); }
const whenPrecise = () => new Promise(res => { if (!S.refine) res(); else S.waiters.push(res); });

async function present(prep, glyphs, id, ms, quality) {
  if (id !== S.buildId) return;
  let bytes;
  try { bytes = compileRemix(project(), prep, glyphs); }
  catch (e) { console.error(e); status('Compile failed: ' + e.message); return; }
  const serial = ++S.faceSerial;
  const face = new FontFace(`ts-remix-${serial}`, bytes.slice().buffer);
  try { await face.load(); }
  catch (e) { status(`The browser's font sanitizer rejected this build (${e.message || e}).`); console.error(e); return; }
  if (serial !== S.faceSerial || id !== S.buildId) return;
  document.fonts.add(face);
  if (S.remixFace) document.fonts.delete(S.remixFace);
  S.remixFace = face;
  S.build = { bytes, glyphs, cmap: prep.cmap, warnings: prep.warnings, donorReport: prep.donorReport, meta: prep.meta, source: prep.items, prep, faceName: face.family, ms: ms ?? S.build?.ms, quality };
  applyFonts();
  const label = { draft: 'draft preview', precise: 'precise outlines', exact: 'exact' }[quality];
  status(`${prep.items.length.toLocaleString()} glyphs · ${prep.cmap.size.toLocaleString()} code points · ${(bytes.length / 1024).toFixed(0)} KB · ${label} · accepted by browser sanitizer`, quality !== 'draft');
  $('#engineState').textContent = quality === 'draft' ? 'Draft — refining…' : quality === 'precise' ? 'Precise ✓' : '';
  const sig = scriptCoverage(prep.cmap).map(c => c.script.id).join();
  if (sig !== S.scriptSig) { S.scriptSig = sig; renderSamples(); }
  const rep = JSON.stringify(prep.donorReport);
  if (rep !== S.reportSig && !document.activeElement?.closest?.('#donorList')) { S.reportSig = rep; renderDonors(); }
  $('#warnText').textContent = prep.warnings[0] || '';
  $('#warnText').title = prep.warnings.join('\n');
  if ($('#view-glyphs').classList.contains('is-active')) renderGlyphs();
  scheduleDwell();
}

function applyFonts() {
  const morphing = S.compare === 'morph' && S.morph.face;
  const fam = morphing ? `'${S.morph.face.family}', 'ts-original', serif` : S.build ? `'${S.build.faceName}', 'ts-original', serif` : `'ts-original'`;
  $('#specRemix').style.fontFamily = fam;
  $('#specOrig').style.fontFamily = `'ts-original'`;
  const vs = S.base?.axisValues ? Object.entries(S.base.axisValues).map(([k, v]) => `'${k}' ${v}`).join(', ') : 'normal';
  $('#specOrig').style.fontVariationSettings = vs;
  $$('#waterfall [data-wf]').forEach(n => { n.style.fontFamily = fam; });
  if (!morphing) { $('#specRemix').style.fontVariationSettings = 'normal'; $$('#waterfall [data-wf]').forEach(n => { n.style.fontVariationSettings = 'normal'; }); }
}

// ---------- morph ----------
async function refreshMorph() {
  if (!S.prep || !S.draft) return;
  if (!S.morph.stale && S.morph.face) return;
  S.morph.stale = false;
  let bytes;
  try { bytes = buildMorphFont(project(), S.prep, S.draft); } catch (e) { console.error(e); $('#morphNote').textContent = 'Morph font could not be built: ' + e.message; return; }
  const serial = ++S.morph.serial;
  const face = new FontFace(`ts-morph-${serial}`, bytes.slice().buffer);
  try { await face.load(); } catch (e) { $('#morphNote').textContent = 'The browser rejected the morph font.'; return; }
  if (serial !== S.morph.serial) return;
  document.fonts.add(face);
  if (S.morph.face) document.fonts.delete(S.morph.face);
  S.morph.face = face; S.morph.bytes = bytes;
  applyFonts(); setMorph(S.morph.t);
}
function setMorph(t) {
  S.morph.t = t;
  const v = `'${MORPH_TAG}' ${t.toFixed(2)}`;
  $('#specRemix').style.fontVariationSettings = v;
  $$('#waterfall [data-wf]').forEach(n => { n.style.fontVariationSettings = v; });
  $('#morphRange').value = t;
}
function morphLoop(ts) {
  if (S.compare !== 'morph' || !S.morph.playing) { S.morph.raf = 0; return; }
  // ease in-out ping-pong, 4 s period
  const p = (ts / 4000) % 2, x = p < 1 ? p : 2 - p;
  setMorph(100 * (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2));
  S.morph.raf = requestAnimationFrame(morphLoop);
}
function startMorph() { if (!S.morph.raf && S.morph.playing) S.morph.raf = requestAnimationFrame(morphLoop); }

// ---------- learning signals ----------
let lastDwellKey = '';
const scheduleDwell = debounce(() => {
  if (!S.base) return;
  const key = JSON.stringify([S.settings, S.scriptSettings, S.donors.map(d => d.adjust)]);
  const isDefault = JSON.stringify(S.settings) === JSON.stringify({ ...DEFAULT_SETTINGS }) && !S.donors.length;
  if (key === lastDwellKey || isDefault) return;
  lastDwellKey = key;
  learner.record(learningEvent('dwell'));
}, 12000);

function learningEvent(kind, settings = S.settings) {
  const baseF = featureVector(S.baseA);
  return {
    kind, classification: S.baseA.classification, primary: S.baseA.primary.id, settings: { ...settings }, baseF,
    harmonies: S.donors.flatMap(d => d.scripts.filter(s => s !== COMMON).map(sid => ({
      sid, baseF, donorF: featureVector(d.analysis), adjust: { scale: d.adjust.scale, weight: d.adjust.weight },
    }))),
  };
}

// ---------- rendering: sources ----------
function renderAll() { renderBase(); renderDonors(); renderParams(); renderSamples(); renderPresets(); }

function fontCardStats(a) {
  return `<dl class="kv">
    <dt>Class</dt><dd>${esc(a.classification)}</dd>
    <dt>Stem / bar</dt><dd>${a.metrics.stemV} / ${a.metrics.stemH} u</dd>
    <dt>Contrast</dt><dd>${a.metrics.contrast}× · ${esc(a.contrastName)}</dd>
    <dt>${a.primary.id === 'latn' ? 'x-height' : 'Main zone'}</dt><dd>${a.metrics.xHeight} / ${a.metrics.upm}</dd>
    <dt>Glyphs</dt><dd>${a.glyphCount.toLocaleString()} · ${a.codepoints.toLocaleString()} cp</dd>
  </dl>`;
}

function axesBlock(model, prefix) {
  if (!model.variation) return '';
  const inst = model.variation.instances;
  return `<div class="panel__section"><div class="row-between"><h3>Variable axes</h3>
    ${inst.length ? `<select class="inline-select" data-inst="${prefix}"><option value="">Instance…</option>${inst.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join('')}</select>` : ''}</div>
    ${model.variation.axes.map(ax => `<div class="slider"><div class="slider__top"><label>${esc(ax.name)} <small style="display:inline">${ax.tag}</small></label><output>${+model.axisValues[ax.tag].toFixed(1)}</output></div>
      <input type="range" data-axis="${prefix}:${ax.tag}" min="${ax.min}" max="${ax.max}" step="${ax.max - ax.min > 20 ? 1 : 0.1}" value="${model.axisValues[ax.tag]}" style="--p:${((model.axisValues[ax.tag] - ax.min) / (ax.max - ax.min)) * 100}%" /></div>`).join('')}
    <p class="hint">Instanced exactly from gvar deltas; the export is a static font at these values.</p></div>`;
}

function renderBase() {
  const m = S.base, a = S.baseA;
  const cov = a.coverage.slice(0, 8);
  $('#baseCard').innerHTML = `<div class="font-card">
    <div class="row-between"><span class="eyebrow" style="margin:0">Base font</span>
      <span class="row-gap"><label class="btn btn--small btn--ghost">Replace<input type="file" accept=".ttf,.otf,.woff,.ttc" id="replaceBase" hidden /></label><button class="btn btn--small btn--ghost" id="closeProject">New</button></span></div>
    <div class="font-card__name">${esc(m.info.family)}</div>
    <div class="font-card__meta">${esc(m.info.style)} · ${m.info.isCFF ? 'PostScript (CFF) → converted to TrueType' : 'TrueType'}${m.variation ? ' · variable' : ''}</div>
    <div class="tags">${a.traits.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    ${fontCardStats(a)}
    <div class="tags" style="margin-top:10px">${cov.map(c => `<span class="tag ${c.script.id === a.primary.id ? 'tag--accent' : ''}">${esc(c.script.name)} ${c.count}</span>`).join('')}</div>
    ${a.latin && a.primary.id !== 'latn' ? `<p class="hint">Latin companion: ${esc(a.latin.cls)}</p>` : ''}
    ${a.latin ? `<p class="hint">${a.latin.notes.map(esc).join(' · ')}</p>` : ''}
  </div>${axesBlock(m, 'base')}`;
  $('#replaceBase').onchange = e => e.target.files[0] && handleFile(e.target.files[0], 'base');
  $('#closeProject').onclick = async () => { await clearProject('current'); location.hash = 'remix'; location.reload(); };
  bindAxes($('#baseCard'), m, () => { S.baseA = analyzeFont(S.base); renderBase(); });
}

function bindAxes(root, model, after) {
  const apply = debounce(() => { resolveAll(model, model.axisValues); after?.(); scheduleBuild(); autosave(); }, 60);
  root.querySelectorAll('[data-axis]').forEach(inp => {
    inp.addEventListener('input', () => {
      const tag = inp.dataset.axis.split(':')[1];
      model.axisValues = { ...model.axisValues, [tag]: +inp.value };
      inp.previousElementSibling.querySelector('output').textContent = (+inp.value).toFixed(inp.step < 1 ? 1 : 0);
      inp.style.setProperty('--p', `${((inp.value - inp.min) / (inp.max - inp.min)) * 100}%`);
      apply();
    });
  });
  root.querySelectorAll('[data-inst]').forEach(sel => sel.addEventListener('change', () => {
    if (sel.value === '') return;
    model.axisValues = { ...model.variation.instances[+sel.value].coords };
    resolveAll(model, model.axisValues); after?.(); scheduleBuild(); autosave();
  }));
}

function renderDonors() {
  const box = $('#donorList');
  if (!S.donors.length) { box.innerHTML = '<p class="hint">No donors yet.</p>'; return; }
  box.innerHTML = S.donors.map(d => {
    const cov = scriptCoverage(d.model.cmap).slice(0, 10);
    const rep = S.build?.donorReport?.find(r => r.id === d.id);
    const harm = rep ? Object.entries(rep.harmonization).map(([sid, h]) => `${esc(scriptById(sid)?.name || sid)}: ×${h.scale}, stem ${h.weightDelta >= 0 ? '+' : ''}${h.weightDelta} u`).join(' · ') : '';
    return `<div class="font-card donor" data-donor="${d.id}">
      <div class="row-between"><div class="font-card__name" style="font-size:15px">${esc(d.model.info.family)}</div><button class="btn btn--small btn--ghost btn--danger" data-remove>Remove</button></div>
      <div class="font-card__meta">${esc(d.analysis.classification)} · ${esc(d.analysis.traits.slice(0, 2).join(', '))}</div>
      <div class="chips chips--wrap">${cov.map(c => `<button class="chip ${d.scripts.includes(c.script.id) ? 'is-on' : ''}" data-script="${c.script.id}">${esc(c.script.name)} <small>${c.count}</small></button>`).join('')}
        <button class="chip ${d.scripts.includes(COMMON) ? 'is-on' : ''}" data-script="${COMMON}">Figures &amp; punctuation</button></div>
      <div class="seg" style="margin-bottom:6px"><button data-mode="replace" class="${d.mode === 'replace' ? 'is-on' : ''}">Replace base glyphs</button><button data-mode="fill" class="${d.mode === 'fill' ? 'is-on' : ''}">Only fill gaps</button></div>
      ${sliderHtml(`${d.id}:scale`, 'Scale correction', d.adjust.scale, -30, 30, 0.5, '%')}
      ${sliderHtml(`${d.id}:weight`, 'Weight correction', d.adjust.weight, -60, 60, 1, '%')}
      ${sliderHtml(`${d.id}:baseline`, 'Baseline shift', d.adjust.baseline, -200, 200, 1, 'u')}
      <label class="toggle"><input type="checkbox" data-matchweight ${d.adjust.matchWeight !== false ? 'checked' : ''}/> Match stem weight to base</label>
      ${harm ? `<p class="hint">Auto-harmonised — ${harm}${rep.added || rep.replaced ? ` · ${rep.replaced} replaced, ${rep.added} added` : ''}</p>` : ''}
      ${d.learned ? `<p class="hint">Learned from ${d.learned.n} of your past remixes.</p>` : ''}
      ${axesBlock(d.model, d.id)}
    </div>`;
  }).join('');
  box.querySelectorAll('[data-donor]').forEach(card => {
    const d = S.donors.find(x => x.id === card.dataset.donor);
    card.querySelector('[data-remove]').onclick = () => { S.donors = S.donors.filter(x => x !== d); renderDonors(); renderSamples(); commit(); scheduleBuild(); };
    card.querySelectorAll('[data-script]').forEach(ch => ch.onclick = () => {
      const s = ch.dataset.script;
      d.scripts = d.scripts.includes(s) ? d.scripts.filter(x => x !== s) : [...d.scripts, s];
      ch.classList.toggle('is-on'); renderSamples(); commit(); scheduleBuild();
    });
    card.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { d.mode = b.dataset.mode; renderDonors(); commit(); scheduleBuild(); });
    card.querySelector('[data-matchweight]').onchange = e => { d.adjust.matchWeight = e.target.checked; commit(); scheduleBuild(); };
    bindSliders(card, (key, v) => { d.adjust[key.split(':')[1]] = v; scheduleBuild(); }, () => { commit(); renderDonorsSoon(); });
    bindAxes(card, d.model, () => { d.analysis = analyzeFont(d.model); });
  });
}
const renderDonorsSoon = debounce(renderDonors, 400);

// ---------- rendering: parameters ----------
// Controls grouped the way type designers think about a design. `when` hides controls that
// do not apply to the scripts in this font (e.g. headline thickness without a headline script).
const GROUPS = [
  { id: 'stroke', title: 'Stroke', items: [
    { key: 'weight', label: 'Weight', min: -60, max: 150, step: 1, unit: '%', help: 'Grows or thins every stroke with a pen. Thinning is proportional to each stroke, so joins and hairlines never snap.' },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, unit: '', help: 'Thins (+) or thickens (−) the strokes that run across the pen angle.' },
    { key: 'penAngle', label: 'Pen angle', min: -60, max: 90, step: 1, unit: '°', help: 'Stress direction used by weight and contrast.' },
    { key: 'headline', label: 'Headline thickness', min: -60, max: 150, step: 1, unit: '%', help: 'Shirorekha of headline scripts — Devanagari, Bengali, Gurmukhi, Tirhuta, Modi…', when: () => Object.values(S.baseA.perScript).some(p => p.headline) },
  ] },
  { id: 'proportion', title: 'Proportions', items: [
    { key: 'width', label: 'Width', min: 60, max: 160, step: 1, unit: '%', help: 'Horizontal proportion. With “keep stroke thickness”, every stroke keeps its weight in every direction.' },
    { key: 'xHeight', label: 'Main zone', min: 75, max: 130, step: 1, unit: '%', help: 'x-height or headline height. Bars keep their thickness; ascender tops stay put.' },
    { key: 'ascender', label: 'Ascenders', min: 80, max: 125, step: 1, unit: '%', help: 'Height of ascenders, caps-zone accents and tall letters.' },
    { key: 'descender', label: 'Descenders', min: 70, max: 130, step: 1, unit: '%', help: 'Depth below the baseline — descenders, subscript conjunct forms, below-base marks.' },
    { key: 'waist', label: 'Waist', min: -25, max: 25, step: 1, unit: '%', help: 'Moves crossbars, bowls and joins up or down inside the main zone.' },
    { key: 'scale', label: 'Script scale', min: 70, max: 140, step: 1, unit: '%', help: 'Optical size of a script next to the others — use with “Apply to: one script”.' },
    { key: 'baseline', label: 'Baseline shift', min: -150, max: 150, step: 1, unit: '‰', help: 'Raises or lowers a script relative to the others.' },
  ] },
  { id: 'shape', title: 'Shape', items: [
    { key: 'slant', label: 'Slant', min: -20, max: 20, step: 0.5, unit: '°', help: 'Oblique with optically correct stroke thickness; italic angle is written to the font.' },
    { key: 'tension', label: 'Curve tension', min: -40, max: 40, step: 1, unit: '%', help: 'Squarer (+) or softer (−) curves, measured between extrema.' },
    { key: 'roundOuter', label: 'Outer corners', min: 0, max: 80, step: 1, unit: '‰', help: 'Rounds convex corners and terminals with true arcs.' },
    { key: 'roundInner', label: 'Inner corners', min: 0, max: 60, step: 1, unit: '‰', help: 'Fills concave corners and crotches — a soft, ink-spread look.' },
    { key: 'inktrap', label: 'Ink traps', min: 0, max: 40, step: 1, unit: '‰', help: 'Notches at acute inner joins, for small sizes and display effect.' },
    { key: 'dots', label: 'Dots & diacritics', min: 50, max: 180, step: 1, unit: '%', help: 'Size of i-dots, nuqta, anusvara, Arabic and Thai dots — scaled in place.' },
  ] },
  { id: 'spacing', title: 'Spacing', items: [
    { key: 'tracking', label: 'Tracking', min: -80, max: 250, step: 1, unit: '‰', help: 'Adds to every advance; combining marks are never spaced.' },
    { key: 'kerning', label: 'Kerning', min: 0, max: 200, step: 1, unit: '%', help: 'Scales the font’s own kerning pairs.' },
  ] },
];
const SLIDERS = GROUPS.flatMap(g => g.items);
const scopeScript = () => S.scope === 'all' ? S.baseA.primary.id : S.scope;
const valueOf = (e, key) => key === 'penAngle' ? (e.penAngle ?? SCRIPT_PEN[scopeScript()] ?? 0) : e[key];

function sliderHtml(key, label, value, min, max, step, unit, help = '', changed = false) {
  const p = ((value - min) / (max - min)) * 100;
  return `<div class="slider"><div class="slider__top"><label for="sl-${key}">${esc(label)}</label><output class="${changed ? 'is-changed' : ''}" title="Double-click to reset">${value}${unit}</output></div>
    <input type="range" id="sl-${key}" data-key="${key}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${value}" style="--p:${p}%" />${help ? `<small>${esc(help)}</small>` : ''}</div>`;
}

function bindSliders(root, onInput, onCommit) {
  root.querySelectorAll('input[type=range][data-key]').forEach(inp => {
    const out = inp.previousElementSibling.querySelector('output');
    const upd = () => { out.textContent = `${inp.value}${inp.dataset.unit}`; inp.style.setProperty('--p', `${((inp.value - inp.min) / (inp.max - inp.min)) * 100}%`); };
    inp.addEventListener('input', () => { upd(); onInput(inp.dataset.key, +inp.value); });
    inp.addEventListener('change', () => { learner.noteSliderUse(inp.dataset.key.split(':').pop()); onCommit?.(); });
    out.addEventListener('dblclick', () => {
      const k = inp.dataset.key;
      if (k === 'penAngle') { onInput(k, null); onCommit?.(); return; }
      inp.value = k.includes(':') ? 0 : DEFAULT_SETTINGS[k] ?? 0; upd(); onInput(k, +inp.value); onCommit?.();
    });
  });
}

const effective = () => S.scope === 'all' ? S.settings : { ...S.settings, ...(S.scriptSettings[S.scope] || {}) };

function renderParams() {
  if (!S.base) return;
  const cov = S.baseA.coverage.map(c => c.script);
  const sel = $('#scopeSelect');
  sel.innerHTML = `<option value="all">All scripts</option>${cov.map(s => `<option value="${s.id}">${esc(s.name)} only</option>`).join('')}`;
  sel.value = S.scope;
  const e = effective();
  const zoneName = scopeScript() === 'latn' ? 'x-height' : 'Main zone';
  const penDefault = SCRIPT_PEN[scopeScript()] ?? 0;
  $('#sliders').innerHTML = GROUPS.map(g => {
    const items = g.items.filter(it => !it.when || it.when());
    const changed = items.filter(it => it.key === 'penAngle' ? e.penAngle != null : e[it.key] !== DEFAULT_SETTINGS[it.key]).length;
    return `<details class="pgroup" data-group="${g.id}" ${S.openGroups[g.id] ? 'open' : ''}><summary><span>${g.title}${changed ? `<span class="badge">${changed}</span>` : ''}</span></summary>
      ${items.map(it => {
        const label = it.key === 'xHeight' ? zoneName : it.label;
        const help = it.key === 'penAngle' ? `${it.help} ${scriptById(scopeScript())?.name || ''} default: ${penDefault}°.` : it.help;
        const v = valueOf(e, it.key);
        const isChanged = it.key === 'penAngle' ? e.penAngle != null : v !== DEFAULT_SETTINGS[it.key];
        return sliderHtml(it.key, label, v, it.min, it.max, it.step, it.unit, help, isChanged);
      }).join('')}</details>`;
  }).join('');
  $('#sl-width').parentElement.insertAdjacentHTML('beforeend', `<label class="toggle"><input type="checkbox" id="keepStems" ${e.keepStems ? 'checked' : ''}/> Keep stroke thickness</label>`);
  $$('#sliders details').forEach(d => d.addEventListener('toggle', () => { S.openGroups[d.dataset.group] = d.open; }));
  const set = (k, v) => {
    if (S.scope === 'all') S.settings = { ...S.settings, [k]: v };
    else S.scriptSettings = { ...S.scriptSettings, [S.scope]: { ...(S.scriptSettings[S.scope] || {}), [k]: v } };
  };
  bindSliders($('#sliders'), (k, v) => { set(k, v); scheduleBuild(); }, () => { commit(); renderParamsSoon(); });
  $('#keepStems').onchange = ev => { set('keepStems', ev.target.checked); commit(); scheduleBuild(); };
}
const renderParamsSoon = debounce(renderParams, 500);

const PRESETS = [
  ['Heavier', { weight: 45 }], ['Lighter', { weight: -35 }], ['Condensed', { width: 82, keepStems: true }], ['Extended', { width: 125, keepStems: true }],
  ['Oblique', { slant: 10 }], ['Soft', { roundOuter: 30, roundInner: 14 }], ['Ink traps', { inktrap: 18, weight: 25 }],
  ['Calligraphic', { contrast: 60, penAngle: 30, weight: 10 }], ['Reverse contrast', { contrast: -70 }], ['Squarish', { tension: 28, roundOuter: 8 }],
  ['Big zone', { xHeight: 112, ascender: 95 }], ['Airy', { tracking: 60 }],
];

function renderPresets() {
  const prior = S.baseA ? learner.stylePrior(S.baseA.classification) : null;
  const items = [...PRESETS];
  const near = S.baseA ? learner.nearestStyles(featureVector(S.baseA), 1)[0] : null;
  if (near && near.similarity > 0.6) items.unshift([`Like your ${near.classification} remix`, near.settings]);
  if (prior) items.unshift([`Your style${prior.specific ? '' : ' (all fonts)'}`, prior.settings]);
  $('#presets').innerHTML = items.map(([n], i) => `<button class="chip ${i === 0 && prior ? 'is-on' : ''}" data-preset="${i}">${esc(n)}</button>`).join('');
  $('#presets').querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    const vals = items[+b.dataset.preset][1];
    if (S.scope === 'all') S.settings = { ...S.settings, ...vals };
    else S.scriptSettings = { ...S.scriptSettings, [S.scope]: { ...(S.scriptSettings[S.scope] || {}), ...vals } };
    renderParams(); commit(); scheduleBuild();
  });
}

// ---------- rendering: specimen ----------
function outputScripts() {
  const cmap = S.build?.cmap || S.base?.cmap;
  if (!cmap) return [];
  return scriptCoverage(cmap).map(c => c.script);
}

function renderSamples() {
  if (!S.base) return;
  const scripts = outputScripts();
  if (!S.sampleScript || (S.sampleScript !== 'mix' && !scripts.some(s => s.id === S.sampleScript))) S.sampleScript = scripts[0]?.id || 'latn';
  $('#sampleChips').innerHTML = [...scripts.slice(0, 12).map(s => `<button class="chip ${S.sampleScript === s.id ? 'is-on' : ''}" data-sample="${s.id}">${esc(s.name)}</button>`),
    scripts.length > 1 ? `<button class="chip ${S.sampleScript === 'mix' ? 'is-on' : ''}" data-sample="mix">Mixed</button>` : ''].join('');
  $('#sampleChips').querySelectorAll('[data-sample]').forEach(b => b.onclick = () => { S.sampleScript = b.dataset.sample; renderSamples(); autosave(); });
  const cmap = S.build?.cmap || S.base.cmap;
  let text = S.customText[S.sampleScript];
  if (!text) text = S.sampleScript === 'mix' ? scripts.slice(0, 4).map(s => sampleFor(s, cmap).split(' ').slice(0, 3).join(' ')).join(' · ') : sampleFor(scriptById(S.sampleScript), cmap);
  const dir = scriptById(S.sampleScript)?.dir || 'ltr';
  const remix = $('#specRemix');
  if (document.activeElement !== remix) remix.textContent = text;
  remix.dir = dir; $('#specOrig').dir = dir;
  $('#specOrig').textContent = remix.textContent;
  $('#waterfall').innerHTML = [48, 32, 24, 18, 14, 11].map(sz => `<div dir="${dir}"><small>${sz}px</small><span data-wf style="font-size:${sz}px">${esc(remix.textContent)}</span></div>`).join('');
  applyFonts();
}

// ---------- AI assistant ----------
async function askAssistant() {
  const prompt = $('#aiPrompt').value.trim();
  if (!prompt) { $('#aiPrompt').focus(); return; }
  $('#aiGo').disabled = true; $('#aiState').textContent = 'Thinking…'; $('#aiResult').innerHTML = '';
  try {
    const { suggest } = await import('./ai/assistant.js');
    const res = await suggest({
      request: prompt, analysis: S.baseA, settings: S.settings,
      scripts: outputScripts().map(s => ({ id: s.id, name: s.name, type: s.type, shaping: s.shaping })),
      history: learner.recentHistory(5),
    });
    $('#aiResult').innerHTML = `<div class="ai-result"><p style="margin:0 0 8px">${esc(res.rationale)}</p>
      ${res.cautions?.length ? `<ul>${res.cautions.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      <div class="row-gap" style="margin-top:10px"><button class="btn btn--small btn--primary" id="aiApply">Apply</button><span class="hint">${Object.entries(res.settings).filter(([k, v]) => v !== DEFAULT_SETTINGS[k]).map(([k, v]) => `${k} ${v}`).join(' · ')}</span></div></div>`;
    $('#aiApply').onclick = () => {
      const clampS = st => Object.fromEntries(Object.entries(st).map(([k, v]) => {
        const sl = SLIDERS.find(x => x.key === k);
        return [k, sl && typeof v === 'number' ? Math.max(sl.min, Math.min(sl.max, v)) : v];
      }));
      S.settings = { ...DEFAULT_SETTINGS, ...clampS(res.settings) };
      S.scriptSettings = {};
      for (const ps of res.perScript || []) if (scriptById(ps.script)) S.scriptSettings[ps.script] = clampS(ps.settings);
      S.scope = 'all'; renderParams(); commit(); scheduleBuild(); toast('Applied the assistant’s settings');
    };
    $('#aiState').textContent = '';
  } catch (e) { $('#aiState').textContent = ''; $('#aiResult').innerHTML = `<p class="hint" style="color:#b3261e">${esc(e.message)}</p>`; }
  finally { $('#aiGo').disabled = false; }
}

// ---------- glyphs ----------
function outMetrics() {
  const i = S.base.info;
  return { upm: S.base.upm, ascender: Math.max(i.ascender, i.hheaAscender), descender: Math.min(i.descender, i.hheaDescender), xHeight: S.baseA.metrics.xHeight, capHeight: i.capHeight, zoneName: S.baseA.primary.id === 'latn' ? 'x-height' : 'main zone' };
}

function renderGlyphs() {
  if (!S.build) { $('#glyphGrid').innerHTML = '<p class="hint">Load a font first.</p>'; return; }
  const sel = $('#glyphScript');
  const scripts = outputScripts();
  if (!sel.options.length || sel.dataset.sig !== scripts.map(s => s.id).join()) {
    sel.innerHTML = `<option value="">All glyphs</option>${scripts.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}<option value="unmapped">Unencoded (ligatures, conjuncts, alternates)</option>`;
    sel.dataset.sig = scripts.map(s => s.id).join();
  }
  const q = $('#glyphSearch').value.trim();
  const qcp = /^u\+?([0-9a-f]{4,6})$/i.exec(q);
  const onlyEdited = $('#glyphShowEdited').checked;
  const src = S.build.source;
  const items = [];
  for (let gid = 0; gid < src.length; gid++) {
    const g = src[gid];
    const cps = g.unicodes || [];
    if (sel.value === 'unmapped' && cps.length) continue;
    if (sel.value && sel.value !== 'unmapped' && !cps.some(cp => scriptOf(cp)?.id === sel.value)) continue;
    if (onlyEdited && !S.edits.has(`${g.source}:${g.srcGid}`)) continue;
    if (q) {
      const hit = qcp ? cps.includes(parseInt(qcp[1], 16)) : (cps.some(cp => String.fromCodePoint(cp) === q) || (g.name || '').toLowerCase().includes(q.toLowerCase()));
      if (!hit) continue;
    }
    items.push(gid);
  }
  $('#glyphCount').textContent = `${items.length.toLocaleString()} glyphs`;
  const m = outMetrics();
  const shown = items.slice(0, S.glyphLimit);
  $('#glyphGrid').innerHTML = shown.map(gid => {
    const g = S.build.glyphs[gid], s = src[gid];
    const cp = s.unicodes?.[0];
    const label = cp != null ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : (s.name || `#${gid}`);
    const edited = S.edits.has(`${s.source}:${s.srcGid}`);
    return `<div class="gcell ${S.selectedGlyph === gid ? 'is-selected' : ''} ${edited ? 'is-edited' : ''}" data-gid="${gid}" title="${esc(s.name)}${s.source !== 'base' ? ' · donor' : ''}">${glyphThumb(g.contours, g.advance, m)}<span>${esc(label)}</span></div>`;
  }).join('') + (items.length > shown.length ? `<button class="btn btn--glass" id="moreGlyphs" style="grid-column:1/-1">Show ${Math.min(400, items.length - shown.length)} more</button>` : '');
  $('#moreGlyphs')?.addEventListener('click', () => { S.glyphLimit += 400; renderGlyphs(); });
  $('#glyphGrid').querySelectorAll('.gcell').forEach(c => c.onclick = () => { S.selectedGlyph = +c.dataset.gid; $$('.gcell.is-selected').forEach(x => x.classList.remove('is-selected')); c.classList.add('is-selected'); renderInspector(); });
  if (S.selectedGlyph != null && S.selectedGlyph < src.length) renderInspector(true);
}

let editor = null;
function renderInspector(refreshOnly = false) {
  const gid = S.selectedGlyph;
  const src = S.build.source[gid];
  const res = S.build.glyphs[gid];
  if (!src) return;
  const key = `${src.source}:${src.srcGid}`;
  const donor = src.source !== 'base' ? S.donors.find(d => d.id === src.source) : null;
  if (refreshOnly && editor && editor.key === key) { if (!donor) editor.api.setResult(res); return; }
  const model = donor ? donor.model : S.base;
  const orig = model.glyphs[src.srcGid];
  const cps = src.unicodes || [];
  const insp = $('#inspector');
  insp.innerHTML = `<div class="row-between"><div><div class="font-card__name">${cps.length ? esc(String.fromCodePoint(cps[0])) + ' ' : ''}<span style="font-size:13px;color:var(--ink-3)">${esc(src.name || '')}</span></div>
      <div class="font-card__meta">${cps.map(c => 'U+' + c.toString(16).toUpperCase().padStart(4, '0')).join(', ') || 'Unencoded — reached through OpenType substitution'} · ${esc((scriptOf(cps[0] ?? -1) || {}).name || (donor ? donor.model.info.family : S.baseA.primary.name))}</div></div>
      <div class="row-gap">${donor ? '' : '<label class="toggle"><input type="checkbox" id="showRes" checked /> Result</label>'}</div></div>
    <div id="editorBox"></div>
    <dl class="kv"><dt>Source</dt><dd>${esc(donor ? donor.model.info.family + ' (donor, edits apply before harmonising)' : S.base.info.family)}</dd>
      <dt>Advance</dt><dd>${Math.round(orig.advance)} → ${Math.round(res.advance)}</dd>
      <dt>Contours / points</dt><dd>${orig.contours.length} / ${orig.contours.reduce((s, c) => s + c.length, 0)} → ${res.contours.length} / ${res.contours.reduce((s, c) => s + c.length, 0)}</dd></dl>
    <div class="row-gap"><button class="btn btn--small btn--glass" id="resetGlyph" ${S.edits.has(key) ? '' : 'disabled'}>Revert edits</button>
      <button class="btn btn--small btn--glass" id="svgGlyph">Copy result SVG</button></div>`;
  const metrics = donor ? { upm: model.upm, ascender: model.info.ascender, descender: model.info.descender, xHeight: donor.analysis.metrics.xHeight, capHeight: model.info.capHeight, zoneName: 'main zone' } : outMetrics();
  const api = mountEditor($('#editorBox'), {
    contours: S.edits.get(key) || orig.contours, advance: orig.advance, result: donor ? null : res, metrics,
    onCommit: contours => { S.edits.set(key, contours); commit(); scheduleBuild(); $('#resetGlyph').disabled = false; },
  });
  editor = { key, api };
  $('#showRes')?.addEventListener('change', e => api.toggleResult(e.target.checked));
  $('#resetGlyph').onclick = () => { S.edits.delete(key); commit(); scheduleBuild(); editor = null; setTimeout(() => renderInspector(), 50); };
  $('#svgGlyph').onclick = async () => {
    const svg = glyphThumb(res.contours, res.advance, outMetrics()).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    try { await navigator.clipboard.writeText(svg); toast('SVG copied'); } catch { toast('Clipboard unavailable', true); }
  };
}

// ---------- library ----------
const REGION = {
  Latin: s => ['latn', 'grek', 'cyrl'].includes(s[0]),
  'South Asia': s => ['deva', 'beng', 'guru', 'gujr', 'orya', 'taml', 'telu', 'knda', 'mlym', 'sinh', 'tibt'].includes(s[0]),
  'Middle East': s => ['arab', 'hebr', 'armn', 'geor'].includes(s[0]),
  'Southeast Asia': s => ['thai', 'khmr', 'bali', 'java', 'bugi', 'batk', 'rjng', 'hano', 'tavt', 'lana', 'cakm'].includes(s[0]),
  'Africa & Americas': s => ['ethi', 'adlm', 'nkoo', 'tfng', 'vaii', 'bamu', 'cher', 'cans'].includes(s[0]),
  'Endangered & historic': s => ['endangered', 'historic', 'vulnerable'].includes(scriptById(s[0])?.vitality),
};
let libFilter = 'All', libLoaded = new Set();
function libSample(entry) {
  const s = scriptById(entry.scripts[0]);
  if (s.id === 'latn') return 'Hamburgefontsiv Quartz 0123';
  return sampleFor(s, null).split(' ').slice(0, 5).join(' ');
}
function renderLibrary() {
  $('#libFilters').innerHTML = ['All', ...Object.keys(REGION)].map(n => `<button class="chip ${libFilter === n ? 'is-on' : ''}" data-f="${esc(n)}">${esc(n)}</button>`).join('');
  $('#libFilters').querySelectorAll('[data-f]').forEach(b => b.onclick = () => { libFilter = b.dataset.f; renderLibrary(); });
  const q = $('#libSearch').value.trim().toLowerCase();
  const list = CATALOG.filter(e => (libFilter === 'All' || REGION[libFilter](e.scripts)) && (!q || e.family.toLowerCase().includes(q) || e.scripts.some(s => scriptById(s).name.toLowerCase().includes(q)) || e.cat.toLowerCase().includes(q)));
  $('#libList').innerHTML = list.map(e => {
    const s = scriptById(e.scripts[0]);
    return `<div class="lib-row glass" data-id="${e.id}">
      <div class="lib-row__meta"><b>${esc(e.family)}</b><span>${esc(e.cat)} · ${e.scripts.map(x => esc(scriptById(x).name)).join(', ')}</span>
        ${s.vitality !== 'thriving' && s.vitality !== 'stable' ? `<div class="tags"><span class="tag tag--warn">${esc(VITALITY_LABEL[s.vitality])}</span></div>` : ''}</div>
      <div class="lib-row__sample" dir="${s.dir}" style="font-family:'${esc(e.family)}', var(--ui)">${esc(libSample(e))}</div>
      <div class="lib-row__actions"><button class="btn btn--small btn--primary" data-use="base">Use as base</button><button class="btn btn--small btn--glass" data-use="donor" ${S.base ? '' : 'disabled title="Load a base font first"'}>Add as donor</button></div>
      <div class="progress" hidden><i></i></div></div>`;
  }).join('');
  const io = new IntersectionObserver(ents => ents.forEach(en => {
    if (!en.isIntersecting) return;
    const e = CATALOG.find(x => x.id === en.target.dataset.id);
    if (!libLoaded.has(e.id)) {
      libLoaded.add(e.id);
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = previewCssUrl(e.family, libSample(e)); document.head.appendChild(l);
    }
    io.unobserve(en.target);
  }), { rootMargin: '200px' });
  $$('#libList .lib-row').forEach(r => {
    io.observe(r);
    r.querySelectorAll('[data-use]').forEach(b => b.onclick = async () => {
      const e = CATALOG.find(x => x.id === r.dataset.id);
      b.disabled = true; b.textContent = 'Loading…';
      await loadCatalog(e, b.dataset.use);
      b.disabled = false; b.textContent = b.dataset.use === 'base' ? 'Use as base' : 'Add as donor';
    });
  });
}

// ---------- scripts ----------
let scriptFilter = 'All';
function renderScripts() {
  const groups = { All: () => true, 'Endangered & historic': s => ['endangered', 'historic', 'vulnerable'].includes(s.vitality), Abugidas: s => s.type === 'abugida', 'Alphabets & abjads': s => ['alphabet', 'abjad'].includes(s.type), Syllabaries: s => s.type === 'syllabary', 'Right-to-left': s => s.dir === 'rtl' };
  $('#scriptFilters').innerHTML = Object.keys(groups).map(n => `<button class="chip ${scriptFilter === n ? 'is-on' : ''}" data-f="${n}">${n}</button>`).join('');
  $('#scriptFilters').querySelectorAll('[data-f]').forEach(b => b.onclick = () => { scriptFilter = b.dataset.f; renderScripts(); });
  const list = SCRIPTS.filter(groups[scriptFilter]);
  $('#scriptGrid').innerHTML = list.map(s => {
    const fonts = catalogFor(s.id);
    const font = fonts.find(f => f.scripts[0] === s.id) || fonts[0];
    const sample = sampleFor(s, null).split(' ').slice(0, 2).join(' ');
    if (font && !libLoaded.has(font.id)) { libLoaded.add(font.id); const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = previewCssUrl(font.family, libSample(font) + sample); document.head.appendChild(l); }
    return `<div class="script-card glass" data-sid="${s.id}">
      <div class="script-card__glyphs" dir="${s.dir}" style="font-family:${font ? `'${esc(font.family)}', ` : ''}var(--ui)">${esc(sample)}</div>
      <h3>${esc(s.name)}</h3>
      <div class="tags"><span class="tag">${esc(s.type)}</span><span class="tag">${s.dir.toUpperCase()}</span>${s.shaping ? '<span class="tag">complex shaping</span>' : ''}<span class="tag ${['endangered', 'historic', 'vulnerable'].includes(s.vitality) ? 'tag--warn' : ''}">${esc(VITALITY_LABEL[s.vitality])}</span></div>
      <p>${esc(s.anatomy)}</p>
      ${font ? `<div class="row-gap"><button class="btn btn--small btn--primary" data-act="base">Start a design</button><button class="btn btn--small btn--glass" data-act="donor" ${S.base ? '' : 'disabled'}>Add to remix</button></div>` : '<p class="hint">No open font in the library yet — upload one.</p>'}
    </div>`;
  }).join('');
  $$('#scriptGrid [data-act]').forEach(b => b.onclick = async () => {
    const sid = b.closest('[data-sid]').dataset.sid;
    const font = catalogFor(sid).find(f => f.scripts[0] === sid) || catalogFor(sid)[0];
    b.disabled = true; b.textContent = 'Loading…';
    await loadCatalog(font, b.dataset.act, { scripts: [sid] });
    b.disabled = false;
    if (b.dataset.act === 'donor') location.hash = 'remix';
  });
}

// ---------- learn ----------
async function renderLearn() {
  const st = learner.stats();
  const use = Object.entries(st.sliderUse).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const maxU = Math.max(1, ...use.map(u => u[1]));
  $('#learnStats').innerHTML = `<h3>What type_space has learned</h3>
    <div class="row-gap" style="gap:28px"><div><div class="big-num">${st.examples}</div><span class="hint">harmonisation examples</span></div>
    <div><div class="big-num">${st.exports}</div><span class="hint">exports</span></div><div><div class="big-num">${st.events}</div><span class="hint">signals</span></div></div>
    <p class="hint">${st.examples < 3 ? 'Export a few remixes with donor fonts and the harmoniser starts correcting the geometric match toward your taste.' : `Model retrained ${new Date(st.trainedAt).toLocaleTimeString()} — corrections are applied automatically when you add a donor.`}</p>
    ${use.length ? `<div class="bars">${use.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i style="width:${(v / maxU) * 100}%"></i><span>${v}</span></div>`).join('')}</div>` : ''}`;
  if (!$('#learnHonest')) $('#learnStats').insertAdjacentHTML('afterend', '<div class="card glass" id="learnHonest"></div>');
  const rep = learner.accuracyReport();
  const curve = rep.curve;
  const chart = curve.length >= 2 ? (() => {
    const W = 320, H = 110, max = Math.max(1, ...curve.map(c => Math.max(c.model, c.baseline)));
    const x = i => 8 + (i / (curve.length - 1)) * (W - 16), y = v => H - 14 - (v / max) * (H - 28);
    const line = k => curve.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(c[k]).toFixed(1)}`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px" role="img" aria-label="Prediction error as examples grow">
      <path d="${line('baseline')}" fill="none" stroke="#b9b9c3" stroke-width="2" stroke-dasharray="4 4"/><path d="${line('model')}" fill="none" stroke="#3d2bff" stroke-width="2.5"/>
      <text x="8" y="${H - 2}" font-size="10" fill="#7a7a85">${curve[0].n} examples</text><text x="${W - 8}" y="${H - 2}" font-size="10" fill="#7a7a85" text-anchor="end">${curve[curve.length - 1].n}</text></svg>
      <p class="hint"><span style="color:#3d2bff">━</span> learned model &nbsp; <span style="color:#9a9aa5">┅</span> no learning · average error of the scale + weight corrections you made, predicted before seeing them (leave-one-out).</p>`;
  })() : '<p class="hint">After three harmonisation examples this card shows a leave-one-out test: how well the model predicts the corrections you make, compared with not learning at all.</p>';
  $('#learnHonest').innerHTML = `<h3>Is it actually learning?</h3>
    <p class="hint">Yes — in your browser, from your own work. Every export (strong signal), every setting you settle on for 12 s (weak signal) and every undo (negative signal) updates two models: a ridge-regression harmoniser that predicts the scale and weight corrections you apply when pairing scripts, and a style prior / nearest-neighbour memory of what you do with each class of type. It does not learn from other people: there is no server, so nothing leaves this device unless you export the data.</p>
    ${chart}${st.importedFromV1 ? `<p class="hint">Includes ${st.importedFromV1} signals carried over from version 1.0.</p>` : ''}${st.undos ? `<p class="hint">${st.undos} undos are steering the style prior away from settings you rejected.</p>` : ''}`;
  const prior = S.baseA ? learner.stylePrior(S.baseA.classification) : learner.stylePrior(null);
  $('#learnPrior').innerHTML = `<h3>Your style prior${S.baseA ? ` for ${esc(S.baseA.classification)}` : ''}</h3>
    ${prior ? `<p class="hint">Weighted by recency and signal strength from ${prior.basedOn} sessions.</p><dl class="kv">${Object.entries(prior.settings).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      ${S.base ? '<button class="btn btn--small btn--primary" id="applyPrior" style="margin-top:12px">Apply to current font</button>' : ''}` : '<p class="hint">No history yet. Your preferences appear here as you work.</p>'}
    ${Object.keys(st.scripts).length ? `<p class="hint" style="margin-top:12px">Scripts you have harmonised: ${Object.entries(st.scripts).map(([k, v]) => `${esc(scriptById(k)?.name || k)} (${v})`).join(', ')}</p>` : ''}`;
  $('#applyPrior')?.addEventListener('click', () => { S.settings = { ...S.settings, ...prior.settings }; renderParams(); commit(); scheduleBuild(); location.hash = 'remix'; });
  const { getKey } = await import('./ai/assistant.js').catch(() => ({ getKey: () => '' }));
  $('#keyState').textContent = getKey() ? 'A key is saved in this browser.' : 'No key saved.';
}

// ---------- export ----------
function openExport() {
  if (!S.build) return;
  $('#exFamily').value = S.meta.family; $('#exStyle').value = S.meta.style; $('#exVersion').value = S.meta.version; $('#exDesigner').value = S.meta.designer;
  const lic = [S.base, ...S.donors.map(d => d.model)].map(m => ({ fam: m.info.family, text: m.info.license || m.info.copyright || 'No license information in the font.', fsType: m.info.fsType }));
  const ofl = lic.some(l => /open font license|OFL/i.test(l.text));
  $('#exLicense').innerHTML = `<b>Licensing.</b> ${ofl ? 'Sources under the SIL Open Font License allow modification and redistribution, but a modified font must not use a Reserved Font Name and must stay under the OFL — give the remix its own family name.' : 'Check that the source licenses allow modification.'}
    <ul style="margin:6px 0 0;padding-left:16px">${lic.map(l => `<li>${esc(l.fam)}: ${esc(l.text.slice(0, 160))}${l.fsType & 2 ? ' <b style="color:#b3261e">(restricted embedding)</b>' : ''}</li>`).join('')}</ul>`;
  const cov = scriptCoverage(S.build.cmap);
  $('#exCoverage').innerHTML = `<h3 style="margin-bottom:6px">Coverage</h3><table class="cov-table">${cov.slice(0, 14).map(c => `<tr><td>${esc(c.script.name)}</td><td>${c.count} letters</td></tr>`).join('')}<tr><td>Total code points</td><td>${S.build.cmap.size.toLocaleString()}</td></tr><tr><td>Total glyphs</td><td>${S.build.glyphs.length.toLocaleString()}</td></tr></table>`;
  const t = S.base.source.tables;
  const checks = [
    ['Compiled TrueType outlines (quadratic, unhinted) accepted by the browser sanitizer', true],
    [S.engine === 'precise' ? 'Precise engine: overlaps removed, strokes rebuilt with constant thickness, curves refitted with nodes on extrema' : 'Draft engine: original point structure kept (switch to Precise for clean outlines)', S.engine === 'precise'],
    [`Unicode cmap rebuilt (format 4${[...S.build.cmap.keys()].some(c => c > 0xFFFF) ? ' + 12 for supplementary planes' : ''})`, true],
    [t.has('GSUB') ? 'GSUB substitutions carried over (conjuncts, ligatures, contextual forms)' : 'No GSUB in base font', !!t.has('GSUB')],
    [t.has('GPOS') ? 'GPOS mark anchors and kerning transformed with the outlines' : 'No GPOS in base font', !!t.has('GPOS')],
    ['Glyph names kept (post v2) for further editing in FontForge, Glyphs or FontLab', true],
    [S.base.variation ? 'Variable source instanced to a static font at the chosen axis values' : 'Static source', true],
    ...S.build.warnings.map(w => [w, false]),
  ];
  $('#exChecks').innerHTML = `<ul class="checks">${checks.map(([c, ok]) => `<li class="${ok ? '' : 'warn'}">${esc(c)}</li>`).join('')}</ul>`;
  $('#exportModal').hidden = false;
}

function exportMeta() {
  S.meta = { family: $('#exFamily').value.trim() || 'Untitled Remix', style: $('#exStyle').value.trim() || 'Regular', version: $('#exVersion').value.trim() || '1.000', designer: $('#exDesigner').value.trim() };
  autosave();
}

async function finalBytes() {
  exportMeta();
  if (S.engine === 'precise' && S.refine) { status('Finishing precise outlines before export…'); await whenPrecise(); }
  const b = S.build;
  return compileRemix(project(), b.prep, b.glyphs, { meta: { family: S.meta.family, style: S.meta.style, version: `Version ${S.meta.version}`, designer: S.meta.designer } });
}

function save(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function download(fmt) {
  const ttf = await finalBytes();
  const bytes = fmt === 'woff' ? await sfntToWoff(ttf) : ttf;
  const name = `${S.meta.family}-${S.meta.style}`.replace(/[^\w.-]+/g, '');
  save(bytes, `${name}.${fmt}`, fmt === 'woff' ? 'font/woff' : 'font/ttf');
  learner.record(learningEvent('export'));
  toast(`Downloaded ${name}.${fmt} — the learner just got a new example`);
}

async function downloadMorph() {
  exportMeta();
  const bytes = buildMorphFont(project({ family: `${S.meta.family} Morph` }), S.prep, S.draft);
  save(bytes, `${S.meta.family.replace(/[^\w.-]+/g, '')}-Morph-VF.ttf`, 'font/ttf');
  toast('Downloaded the variable morph font — axis MRPH 0 (original) to 100 (remix)');
}

// ---------- empty-state starters ----------
const STARTERS = [
  ['Noto Sans Devanagari', 'Playfair Display', 'सभी मनुष्य Aa', 'Devanagari with a Didone Latin'],
  ['Noto Sans Tirhuta', 'EB Garamond', '𑒧𑒱𑒟𑒱𑒪𑒰 Ag', 'Tirhuta (Maithili) with Garamond'],
  ['Noto Sans Cherokee', 'Inter', 'ᏣᎳᎩ Gg', 'Cherokee syllabary with Inter'],
  ['Noto Naskh Arabic', 'Fraunces', 'الكرامة Rr', 'Naskh Arabic with a soft serif'],
  ['Noto Sans Ol Chiki', 'Space Grotesk', 'ᱥᱟᱱᱛᱟᱲᱤ Sk', 'Santali Ol Chiki with a grotesque'],
  ['Noto Sans Modi', 'Work Sans', '𑘦𑘻𑘚𑘲 Mw', 'Modi script with Work Sans'],
];
function renderStarters() {
  $('#starters').innerHTML = STARTERS.map(([b, d, sample, label], i) => `<button class="starter glass" data-i="${i}"><b>${esc(sample)}</b><span>${esc(label)}</span></button>`).join('');
  $$('#starters [data-i]').forEach(btn => btn.onclick = async () => {
    const [b, d] = STARTERS[+btn.dataset.i];
    btn.disabled = true; btn.querySelector('span').textContent = 'Loading fonts…';
    const be = CATALOG.find(x => x.family === b), de = CATALOG.find(x => x.family === d);
    await loadCatalog(be, 'base');
    if (S.base) await loadCatalog(de, 'donor', { scripts: ['latn', COMMON] });
    btn.disabled = false;
  });
}

// ---------- style transfer ----------
async function transferRefModel() {
  const v = $('#tRefSelect').value;
  if (v.startsWith('donor:')) return S.donors.find(d => d.id === v.slice(6))?.model;
  if (v === 'upload') return S.transfer.uploaded;
  if (v.startsWith('lib:')) {
    const e = CATALOG.find(x => x.id === v.slice(4));
    $('#tState').textContent = `Downloading ${e.family}…`;
    return loadFont(await fetchCatalogFont(e), { fileName: e.family });
  }
  return null;
}

function renderTransfer() {
  const sel = $('#tRefSelect');
  const cur = sel.value;
  sel.innerHTML = [
    S.transfer.uploaded ? `<option value="upload">Uploaded: ${esc(S.transfer.uploaded.info.family)}</option>` : '',
    ...S.donors.map(d => `<option value="donor:${d.id}">Donor: ${esc(d.model.info.family)}</option>`),
    ...CATALOG.map(e => `<option value="lib:${e.id}">${esc(e.family)} — ${esc(e.cat)}</option>`),
  ].join('');
  if (cur) sel.value = cur;
  const scope = $('#tScope');
  scope.innerHTML = S.baseA ? `<option value="all">All scripts</option>${S.baseA.coverage.map(c => `<option value="${c.script.id}">${esc(c.script.name)} only</option>`).join('')}` : '<option>Load a base font first</option>';
  $('#tAnalyze').disabled = !S.base;
  drawTransferTable();
}

function drawTransferTable() {
  const rows = S.transfer.rows;
  if (!rows.length) { $('#tTable').innerHTML = `<p class="hint">${S.base ? 'Pick a reference and measure it.' : 'Load a base font in Remix first.'}</p>`; $('#tApply').disabled = true; $('#tPreview').textContent = ''; return; }
  $('#tTable').innerHTML = `<table class="ttable"><tr><th></th><th>Feature</th><th>Base</th><th>Reference</th><th>Setting</th></tr>${rows.map((r, i) => `<tr title="${esc(r.note || '')}"><td><input type="checkbox" data-row="${i}" ${r.on ? 'checked' : ''} ${r.note ? 'disabled' : ''}/></td><td>${esc(r.label)}${r.note ? `<br><span class="hint">${esc(r.note)}</span>` : ''}</td><td>${esc(r.base)}</td><td>${esc(r.ref)}</td><td>${esc(r.value)}</td></tr>`).join('')}</table>
    ${S.transfer.rationale ? `<p class="hint" style="margin-top:10px">${esc(S.transfer.rationale)}</p>` : ''}`;
  $$('#tTable [data-row]').forEach(cb => cb.onchange = () => { rows[+cb.dataset.row].on = cb.checked; previewTransfer(); });
  $('#tApply').disabled = false;
  previewTransfer();
}

function previewTransfer() {
  const st = rowsToSettings(S.transfer.rows, +$('#tStrength').value / 100);
  $('#tPreview').textContent = Object.keys(st).length ? 'Will set: ' + Object.entries(st).map(([k, v]) => `${k} ${v}`).join(' · ') : 'Nothing selected.';
  return st;
}

async function measureReference() {
  if (!S.base) return;
  const src = S.transfer.src;
  $('#tAnalyze').disabled = true; $('#tState').textContent = 'Measuring…'; S.transfer.rationale = '';
  try {
    if (src === 'font') {
      const model = await transferRefModel();
      if (!model) throw new Error('Choose a reference font.');
      const sid = $('#tScope').value === 'all' ? S.baseA.primary.id : $('#tScope').value;
      S.transfer.rows = transferRows(styleProfile(model), styleProfile(S.base, S.baseA), sid);
      S.transfer.ref = model.info.family;
      $('#tState').textContent = `Measured ${model.info.family} against ${S.base.info.family} (${scriptById(sid)?.name}).`;
    } else {
      const { suggest } = await import('./ai/assistant.js');
      const image = src === 'image' ? S.transfer.image : null;
      if (src === 'image' && !image) throw new Error('Choose an image first.');
      const request = src === 'image' ? 'Transfer the style of the lettering in this image onto my font.' : $('#tText').value.trim();
      if (!request) throw new Error('Describe the style you want.');
      const res = await suggest({ request, image, analysis: S.baseA, settings: S.settings, scripts: outputScripts().map(s => ({ id: s.id, name: s.name, type: s.type, shaping: s.shaping })), history: learner.recentHistory(5) });
      S.transfer.rows = Object.entries(res.settings).filter(([k, v]) => k !== 'keepStems' && v !== (k === 'penAngle' ? 0 : DEFAULT_SETTINGS[k]))
        .map(([k, v]) => ({ key: k, label: SLIDERS.find(x => x.key === k)?.label || k, base: k === 'penAngle' ? '0' : String(DEFAULT_SETTINGS[k]), ref: String(v), value: v, neutral: k === 'penAngle' ? 0 : DEFAULT_SETTINGS[k], on: true }));
      S.transfer.rationale = res.rationale + (res.cautions?.length ? ' Cautions: ' + res.cautions.join(' ') : '');
      $('#tState').textContent = 'Estimated by the type assistant.';
    }
  } catch (e) { $('#tState').textContent = e.message; S.transfer.rows = []; }
  $('#tAnalyze').disabled = false;
  drawTransferTable();
}

function wireTransfer() {
  $$('[data-tsrc]').forEach(b => b.onclick = () => {
    S.transfer.src = b.dataset.tsrc;
    $$('[data-tsrc]').forEach(x => x.classList.toggle('is-on', x === b));
    $$('[data-tpane]').forEach(p => { p.hidden = p.dataset.tpane !== S.transfer.src; });
  });
  $('#tRefUpload').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { S.transfer.uploaded = await loadFont(await readFileInput(f), { fileName: f.name }); renderTransfer(); $('#tRefSelect').value = 'upload'; }
    catch (err) { toast(err.message, true); }
  };
  $('#tImg').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 5e6) { toast('Please use an image under 5 MB.', true); return; }
    const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    S.transfer.image = { mediaType: f.type || 'image/png', data: String(data).split(',')[1] };
    $('#tImgPreview').src = data; $('#tImgPreview').hidden = false;
  };
  $('#tAnalyze').onclick = measureReference;
  $('#tStrength').oninput = e => { $('#tStrengthOut').textContent = `${e.target.value}%`; e.target.style.setProperty('--p', `${e.target.value / 1.5}%`); previewTransfer(); };
  $('#tApply').onclick = () => {
    const st = previewTransfer();
    const scope = $('#tScope').value;
    if (scope === 'all') S.settings = { ...S.settings, ...st };
    else S.scriptSettings = { ...S.scriptSettings, [scope]: { ...(S.scriptSettings[scope] || {}), ...st } };
    renderParams(); commit(); scheduleBuild();
    location.hash = 'remix';
    toast(`Transferred ${Object.keys(st).length} features${S.transfer.ref ? ' from ' + S.transfer.ref : ''}`);
  };
}

// ---------- contact ----------
function renderContact() {
  $('#contactAlt').innerHTML = 'No GitHub account? Browse existing reports at <a href="https://github.com/khush-tawar/type_space/issues" target="_blank" rel="noopener">github.com/khush-tawar/type_space/issues</a>, or reach the maintainer through <a href="https://github.com/khush-tawar" target="_blank" rel="noopener">their GitHub profile</a>.';
}
function wireContact() {
  $('#contactForm').addEventListener('submit', e => {
    e.preventDefault();
    const topic = $('#cTopic').value, msg = $('#cMsg').value.trim(), name = $('#cName').value.trim();
    if (!msg) { $('#cMsg').focus(); return; }
    let body = `${msg}\n\n— ${name || 'anonymous'}`;
    if ($('#cDiag').checked) {
      body += `\n\n<details><summary>Diagnostics</summary>\n\n- type_space ${VERSION}\n- ${navigator.userAgent}\n- Base font: ${S.base ? S.base.info.family + ' ' + S.base.info.style : 'none'}\n- Scripts: ${S.baseA ? S.baseA.coverage.slice(0, 6).map(c => c.script.name).join(', ') : '—'}\n- Engine: ${S.engine}\n- Settings: \`${JSON.stringify(S.settings)}\`\n</details>`;
    }
    const url = `https://github.com/khush-tawar/type_space/issues/new?title=${encodeURIComponent(`[${topic}] ${msg.split('\n')[0].slice(0, 70)}`)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener');
    toast('Opened a pre-filled issue on GitHub');
  });
}

// ---------- wiring ----------
function wire() {
  $('#uploadBase').onchange = e => e.target.files[0] && handleFile(e.target.files[0], 'base');
  $('#uploadDonor').onchange = e => { if (e.target.files[0]) { handleFile(e.target.files[0], 'donor'); $('#pickModal').hidden = true; } };
  $('#addDonorBtn').onclick = () => { $('#pickModal').hidden = false; renderPick(); $('#pickSearch').focus(); };
  $('#pickSearch').oninput = renderPick;
  $('#exportBtn').onclick = openExport;
  $('#dlTtf').onclick = () => download('ttf');
  $('#dlWoff').onclick = () => download('woff');
  $('#copyCss').onclick = async () => {
    exportMeta();
    const name = `${S.meta.family}-${S.meta.style}`.replace(/[^\w.-]+/g, '');
    const css = `@font-face {\n  font-family: '${S.meta.family}';\n  src: url('${name}.woff') format('woff'), url('${name}.ttf') format('truetype');\n  font-weight: ${S.build.meta.weightClass};\n  font-style: ${Math.abs(S.settings.slant) > 0.5 ? 'oblique' : 'normal'};\n  font-display: swap;\n}`;
    try { await navigator.clipboard.writeText(css); toast('CSS copied'); } catch { toast('Clipboard unavailable', true); }
  };
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; }));
  $('#resetParams').onclick = () => {
    if (S.scope === 'all') S.settings = { ...DEFAULT_SETTINGS }; else { const ss = { ...S.scriptSettings }; delete ss[S.scope]; S.scriptSettings = ss; }
    renderParams(); commit(); scheduleBuild();
  };
  $('#scopeSelect').onchange = e => { S.scope = e.target.value; renderParams(); };
  $$('.seg [data-compare]').forEach(b => b.onclick = () => {
    S.compare = b.dataset.compare; $$('.seg [data-compare]').forEach(x => x.classList.toggle('is-on', x === b));
    $('#specimen').className = `specimen glass compare-${S.compare}`;
    $('#morphBar').hidden = S.compare !== 'morph';
    if (S.compare === 'morph') { refreshMorph().then(startMorph); } else { applyFonts(); }
  });
  $('#morphPlay').onclick = () => { S.morph.playing = !S.morph.playing; $('#morphPlay').textContent = S.morph.playing ? 'Pause' : 'Play'; startMorph(); };
  $('#morphRange').oninput = e => { S.morph.playing = false; $('#morphPlay').textContent = 'Play'; setMorph(+e.target.value); };
  $$('[data-engine]').forEach(b => b.onclick = () => {
    S.engine = b.dataset.engine; $$('[data-engine]').forEach(x => x.classList.toggle('is-on', x === b));
    $('#engineState').textContent = ''; scheduleBuild(); autosave();
  });
  $('#dlMorph').onclick = downloadMorph;
  $$('.site-footer [data-anchor]').forEach(a => a.addEventListener('click', () => setTimeout(() => document.getElementById(a.dataset.anchor)?.scrollIntoView({ behavior: 'smooth' }), 60)));
  wireTransfer();
  wireContact();
  $('#sizeRange').oninput = e => { S.size = +e.target.value; $('#specRemix').style.fontSize = $('#specOrig').style.fontSize = `${S.size}px`; };
  $('#specRemix').addEventListener('input', () => {
    S.customText[S.sampleScript] = $('#specRemix').textContent;
    $('#specOrig').textContent = $('#specRemix').textContent;
    $$('#waterfall [data-wf]').forEach(n => { n.textContent = $('#specRemix').textContent; });
    autosave();
  });
  $('#aiGo').onclick = askAssistant;
  $('#aiPrompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) askAssistant(); });
  $('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
  document.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    e.preventDefault(); e.shiftKey ? redo() : undo();
  });
  $('#glyphSearch').oninput = debounce(() => { S.glyphLimit = 400; renderGlyphs(); }, 150);
  $('#glyphScript').onchange = () => { S.glyphLimit = 400; renderGlyphs(); };
  $('#glyphShowEdited').onchange = renderGlyphs;
  $('#libSearch').oninput = debounce(renderLibrary, 150);
  $('#saveKey').onclick = async () => { const { setKey } = await import('./ai/assistant.js'); setKey($('#apiKey').value); $('#apiKey').value = ''; renderLearn(); toast('Key saved in this browser'); };
  $('#clearKey').onclick = async () => { const { setKey } = await import('./ai/assistant.js'); setKey(''); renderLearn(); };
  $('#exportLearn').onclick = () => {
    const url = URL.createObjectURL(new Blob([learner.exportData()], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'type_space-learning.json' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };
  $('#importLearn').onchange = async e => { try { const n = learner.importData(await e.target.files[0].text()); toast(`Imported — ${n} signals`); renderLearn(); } catch (err) { toast(err.message, true); } };
  $('#resetLearn').onclick = () => { learner.reset(); renderLearn(); toast('Learning data cleared'); };

  // drag & drop
  let depth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { depth++; $('#dropzone').hidden = false; } });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('#dropzone').hidden = true; } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); depth = 0; $('#dropzone').hidden = true; const f = e.dataTransfer.files[0]; if (f) handleFile(f, 'base'); });
}

function renderPick() {
  const q = $('#pickSearch').value.trim().toLowerCase();
  const list = CATALOG.filter(e => !q || e.family.toLowerCase().includes(q) || e.scripts.some(s => scriptById(s).name.toLowerCase().includes(q))).slice(0, 60);
  $('#pickList').innerHTML = list.map(e => `<button class="pick-item" data-id="${e.id}"><b>${esc(e.family)}</b><span>${esc(e.cat)} · ${e.scripts.map(s => esc(scriptById(s).name)).join(', ')}</span></button>`).join('');
  $$('#pickList [data-id]').forEach(b => b.onclick = async () => {
    const e = CATALOG.find(x => x.id === b.dataset.id);
    $('#pickModal').hidden = true;
    await loadCatalog(e, 'donor');
  });
}

async function init() {
  wire();
  renderStarters();
  showView(location.hash.slice(1) || 'remix');
  const params = new URLSearchParams(location.search);
  if (params.get('base')) {
    const be = CATALOG.find(x => x.id === params.get('base'));
    if (be) { await loadCatalog(be, 'base'); const de = CATALOG.find(x => x.id === params.get('donor')); if (de && S.base) await loadCatalog(de, 'donor'); return; }
  }
  await restoreProject();
}

init();
