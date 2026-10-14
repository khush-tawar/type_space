// Precise outline engine in a worker. Jobs arrive as plain data; results stream back in chunks
// so a newer request (slider moved again) can cancel stale work.
import ClipperLib from 'https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/+esm';
import { useClipper, refineGlyph } from '../core/outline.js';
import { makeMapper } from '../core/transforms.js';

useClipper(ClipperLib);
let current = 0;

self.onmessage = e => {
  const { id, jobs } = e.data;
  current = id;
  let i = 0;
  const results = [];
  const step = () => {
    if (id !== current) return; // superseded
    const t0 = performance.now();
    while (i < jobs.length && performance.now() - t0 < 30) {
      const { gid, key, job } = jobs[i++];
      try {
        results.push({ gid, key, contours: refineGlyph(job, job.mapped ? makeMapper(job.spec, job.zone) : null) });
      } catch (err) {
        results.push({ gid, key, error: String(err?.message || err) });
      }
    }
    self.postMessage({ id, progress: i / jobs.length, results: results.splice(0) });
    if (i < jobs.length) setTimeout(step, 0);
    else self.postMessage({ id, done: true });
  };
  step();
};
