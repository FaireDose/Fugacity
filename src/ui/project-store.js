/**
 * Where projects are kept besides files (proposal 0006, step 6): a store is
 *
 *   { id, label, list(): Promise<{ name, saved_at? }[]>, get(name): Promise<project|text>,
 *     put(name, project): Promise<void>, remove(name): Promise<void> }
 *
 *  - browserStore(): this browser's local storage (one origin: the page, or the chat page that
 *    shows the workbench). Kept until the person clears the site's data; not shared with other
 *    browsers or people.
 *  - hostStore(storage): the storage the host page gives to CHEPTA.app({ storage }), for
 *    example the persistent storage an AI chat platform offers its pages; the page decides
 *    where it goes. CHEPTA itself never sends a project anywhere.
 *
 * And an automatic copy of the open work (autosave) in the browser, offered back after a
 * reload. Every call is wrapped: storage that is blocked (private windows, sandboxed pages)
 * makes the store unavailable, it never breaks the workbench.
 */
const INDEX = "fugacity:projects";
const ITEM = name => `fugacity:project:${name}`;
const AUTOSAVE = "fugacity:autosave";

function ls() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const k = "fugacity:probe";
    s.setItem(k, "1"); s.removeItem(k);
    return s;
  } catch { return null; }
}

/** Is browser storage usable here? */
export const browserStorageAvailable = () => !!ls();

/** The projects kept in this browser. */
export function browserStore() {
  const s = ls();
  const index = () => { try { return JSON.parse(s.getItem(INDEX) ?? "[]"); } catch { return []; } };
  const writeIndex = list => s.setItem(INDEX, JSON.stringify(list));
  return {
    id: "browser", label: "In this browser", available: !!s,
    async list() { return s ? index() : []; },
    async get(name) {
      const t = s?.getItem(ITEM(name));
      if (t == null) throw new Error(`No project called "${name}" in this browser.`);
      return t;
    },
    async put(name, project) {
      if (!s) throw new Error("This page cannot use the browser's storage (a private window or a sandboxed page).");
      const text = typeof project === "string" ? project : JSON.stringify(project);
      try { s.setItem(ITEM(name), text); } catch (e) { throw new Error(`The browser's storage is full or blocked (${e.message}); download the file instead.`); }
      const saved_at = new Date().toISOString();
      writeIndex([{ name, saved_at }, ...index().filter(x => x.name !== name)]);
    },
    async remove(name) { if (!s) return; s.removeItem(ITEM(name)); writeIndex(index().filter(x => x.name !== name)); },
  };
}

/** The host page's storage, checked; null when none is given. */
export function hostStore(storage) {
  if (storage == null) return null;
  for (const k of ["list", "get", "put"]) {
    if (typeof storage[k] !== "function") throw new Error(`storage.${k} must be a function: give { list(), get(name), put(name, project), remove(name) }.`);
  }
  return {
    id: "host", label: storage.label ?? "In this page's storage", available: true,
    async list() {
      const l = await storage.list();
      return (Array.isArray(l) ? l : []).map(x => (typeof x === "string" ? { name: x } : x));
    },
    get: name => Promise.resolve(storage.get(name)),
    put: (name, project) => Promise.resolve(storage.put(name, project)),
    remove: name => Promise.resolve(typeof storage.remove === "function" ? storage.remove(name) : undefined),
  };
}

/** Keep an automatic copy of the open work (project text). Returns false when it cannot. */
export function autosave(text) {
  const s = ls();
  if (!s) return false;
  try { s.setItem(AUTOSAVE, JSON.stringify({ saved_at: new Date().toISOString(), text })); return true; } catch { return false; }
}

/** The automatic copy, or null: { saved_at, text }. */
export function lastAutosave() {
  const s = ls();
  if (!s) return null;
  try { const v = JSON.parse(s.getItem(AUTOSAVE) ?? "null"); return v && typeof v.text === "string" ? v : null; } catch { return null; }
}

/** Forget the automatic copy. */
export function clearAutosave() { try { ls()?.removeItem(AUTOSAVE); } catch { /* nothing to do */ } }
