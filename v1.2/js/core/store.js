// Minimal IndexedDB persistence for the current project (font binaries + edits + settings).
const DB = 'type_space_v12', STORE = 'projects'; // separate from 1.0 so the two versions never share a project

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(key, value) {
  try {
    const db = await open();
    await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (e) { console.warn('Autosave failed', e); }
}

export async function loadProject(key) {
  try {
    const db = await open();
    return await new Promise((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  } catch { return null; }
}

export async function clearProject(key) {
  try { const db = await open(); db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key); } catch { /* ignore */ }
}

/** Contour maps survive structured clone, but Map keys need flattening for portability. */
export const serializeEdits = edits => [...edits.entries()];
export const deserializeEdits = arr => new Map(arr || []);
