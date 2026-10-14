// Point-level glyph editor: on-curve squares, off-curve circles, handles, metric lines.
// Edits are made on the source outline; parametric transforms are re-applied on top.
import { toSvgPath, bbox, cloneContours } from '../core/geometry.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

/**
 * mount(container, {
 *   contours, advance, result:{contours, advance}|null, metrics:{ascender, descender, xHeight, capHeight, upm, zoneName},
 *   onChange(contours) // live, during drag
 *   onCommit(contours) // drag end / nudge
 * })
 */
export function mountEditor(container, opts) {
  let contours = cloneContours(opts.contours);
  let selected = null; // [ci, pi]
  let showResult = !!opts.result;
  const m = opts.metrics;
  const b = bbox([...contours, ...(opts.result?.contours || [])]);
  const width = Math.max(opts.advance, opts.result?.advance || 0, b.xMax, m.upm * 0.4);
  const pad = m.upm * 0.12;
  const x0 = Math.min(0, b.xMin) - pad, x1 = width + pad;
  const yTop = Math.max(m.ascender, b.yMax) + pad, yBot = Math.min(m.descender, b.yMin) - pad;
  const vw = x1 - x0, vh = yTop - yBot;

  container.innerHTML = '';
  const svg = el('svg', { class: 'editor', viewBox: `${x0} ${-yTop} ${vw} ${vh}`, tabindex: 0, role: 'img', 'aria-label': 'Glyph outline editor' }, container);
  const unit = vw / 500; // ≈ one CSS px in font units
  const g = el('g', {}, svg);
  const lines = [
    [0, 'baseline'], [m.xHeight, m.zoneName || 'x-height'], [m.capHeight, 'cap'], [m.ascender, 'ascender'], [m.descender, 'descender'],
  ];
  for (const [y, label] of lines) {
    if (!y && label !== 'baseline') continue;
    el('line', { class: 'metric', x1: x0, x2: x1, y1: -y, y2: -y }, g);
    const t = el('text', { class: 'metric-label', x: x0 + 6 * unit, y: -y - 4 * unit, 'font-size': 11 * unit }, g);
    t.textContent = label;
  }
  el('line', { class: 'metric', x1: 0, x2: 0, y1: -yTop, y2: -yBot }, g);
  const advLine = el('line', { class: 'metric', x1: opts.advance, x2: opts.advance, y1: -yTop, y2: -yBot }, g);
  const flip = el('g', { transform: 'scale(1,-1)' }, svg);
  const resPath = el('path', { class: 'res', 'fill-rule': 'nonzero' }, flip);
  const srcPath = el('path', { class: 'src', 'fill-rule': 'nonzero' }, flip);
  const handles = el('g', {}, flip);
  const pts = el('g', {}, flip);

  function draw() {
    srcPath.setAttribute('d', toSvgPath(contours));
    resPath.setAttribute('d', showResult && opts.result ? toSvgPath(opts.result.contours) : '');
    advLine.setAttribute('x1', opts.advance); advLine.setAttribute('x2', opts.advance);
    handles.innerHTML = ''; pts.innerHTML = '';
    const r = 4.5 * unit;
    contours.forEach((c, ci) => c.forEach((p, pi) => {
      const prev = c[(pi - 1 + c.length) % c.length], next = c[(pi + 1) % c.length];
      if (!p.on) {
        if (prev.on) el('line', { class: 'handle', x1: prev.x, y1: prev.y, x2: p.x, y2: p.y }, handles);
        if (next.on) el('line', { class: 'handle', x1: p.x, y1: p.y, x2: next.x, y2: next.y }, handles);
      }
      const isSel = selected && selected[0] === ci && selected[1] === pi;
      const cls = `pt ${p.on ? 'pt-on' : 'pt-off'}${pi === 0 ? ' pt-start' : ''}${isSel ? ' is-sel' : ''}`;
      const node = p.on
        ? el('rect', { class: cls, x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r }, pts)
        : el('circle', { class: cls, cx: p.x, cy: p.y, r: r * 0.85 }, pts);
      node.dataset.ci = ci; node.dataset.pi = pi;
    }));
    info();
  }

  const infoEl = document.createElement('div');
  infoEl.className = 'pt-info';
  container.appendChild(infoEl);
  function info() {
    const nPts = contours.reduce((s, c) => s + c.length, 0);
    if (selected) {
      const p = contours[selected[0]][selected[1]];
      infoEl.textContent = `Contour ${selected[0] + 1}, point ${selected[1]} · ${p.on ? 'on-curve' : 'off-curve'} · x ${Math.round(p.x)}  y ${Math.round(p.y)} — arrows nudge (⇧ ×10)`;
    } else infoEl.textContent = `${contours.length} contours · ${nPts} points · drag points to edit`;
  }

  function toFont(evt) {
    const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: -p.y };
  }

  let drag = null;
  svg.addEventListener('pointerdown', e => {
    const t = e.target;
    if (!t.dataset || t.dataset.ci == null) { selected = null; draw(); return; }
    selected = [+t.dataset.ci, +t.dataset.pi];
    const p = contours[selected[0]][selected[1]];
    const start = toFont(e);
    drag = { start, orig: { x: p.x, y: p.y }, moved: false };
    svg.setPointerCapture(e.pointerId);
    draw();
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const cur = toFont(e);
    let dx = cur.x - drag.start.x, dy = cur.y - drag.start.y;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const p = contours[selected[0]][selected[1]];
    p.x = Math.round(drag.orig.x + dx); p.y = Math.round(drag.orig.y + dy);
    drag.moved = true;
    draw();
    opts.onChange?.(contours);
  });
  const end = () => { if (drag?.moved) opts.onCommit?.(cloneContours(contours)); drag = null; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('keydown', e => {
    if (!selected) return;
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const p = contours[selected[0]][selected[1]];
    p.x += d[0]; p.y += d[1];
    draw();
    opts.onCommit?.(cloneContours(contours));
  });

  draw();
  return {
    setResult(result) { opts.result = result; draw(); },
    toggleResult(on) { showResult = on; draw(); },
    getContours: () => cloneContours(contours),
  };
}

/** Static glyph thumbnail SVG markup in a fixed em box. */
export function glyphThumb(contours, advance, m) {
  const pad = m.upm * 0.06;
  const w = Math.max(advance, m.upm * 0.25);
  const top = m.ascender + pad, bot = m.descender - pad;
  const d = toSvgPath(contours, 0);
  return `<svg viewBox="${-pad} ${-top} ${w + 2 * pad} ${top - bot}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path transform="scale(1,-1)" d="${d}"/></svg>`;
}
