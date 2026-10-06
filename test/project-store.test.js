// Where projects are kept besides files (proposal 0006, step 6): this browser's storage, the
// host page's storage, and the automatic copy of the open work. A stand-in for the browser's
// localStorage is used; blocked storage must make the store unavailable, not break anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserStore, hostStore, autosave, lastAutosave, clearAutosave, browserStorageAvailable } from "../src/ui/project-store.js";
import { projectOf, projectText, stateFromProject } from "../src/ui/project.js";
import { initialState } from "../src/ui/app-logic.js";

class MemoryStorage {
  constructor(limit = Infinity) { this.m = new Map(); this.limit = limit; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { if (String(v).length > this.limit) throw new Error("QuotaExceededError"); this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
const withStorage = (st, fn) => async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: st, configurable: true });
  try { await fn(); } finally { if (had) Object.defineProperty(globalThis, "localStorage", had); else delete globalThis.localStorage; }
};
const doc = () => projectOf(initialState({ components: ["ethanol", "water"], title: "Column feed" }));

test("this browser: keep, list (newest first), open and delete projects", withStorage(new MemoryStorage(), async () => {
  const st = browserStore();
  assert.equal(st.available, true);
  assert.deepEqual(await st.list(), []);
  await st.put("Column feed", doc());
  await st.put("Flash test", projectText(doc()));
  await st.put("Column feed", doc());   // again: replaces it and moves it first
  assert.deepEqual((await st.list()).map(x => x.name), ["Column feed", "Flash test"]);
  const back = stateFromProject(await st.get("Column feed"));
  assert.deepEqual(back.components, ["ethanol", "water"]);
  await st.remove("Flash test");
  assert.deepEqual((await st.list()).map(x => x.name), ["Column feed"]);
  await assert.rejects(st.get("Flash test"), /No project called "Flash test"/);
}));

test("full or blocked browser storage is reported, not thrown at the workbench", withStorage(new MemoryStorage(50), async () => {
  const st = browserStore();
  await assert.rejects(st.put("Big", doc()), /full or blocked/);
  assert.equal(autosave("x".repeat(100)), false);
}));

test("no browser storage (a sandboxed page): unavailable", withStorage(undefined, async () => {
  assert.equal(browserStorageAvailable(), false);
  assert.equal(browserStore().available, false);
  assert.equal(lastAutosave(), null);
  assert.equal(autosave("{}"), false);
}));

test("the automatic copy of the open work", withStorage(new MemoryStorage(), async () => {
  assert.equal(lastAutosave(), null);
  assert.equal(autosave(projectText(doc())), true);
  const a = lastAutosave();
  assert.ok(a.saved_at && stateFromProject(a.text).title === "Column feed");
  clearAutosave();
  assert.equal(lastAutosave(), null);
}));

test("the host page's storage (an AI chat's): the adapter is checked and used as given", async () => {
  const kept = new Map();
  const st = hostStore({
    list: () => [...kept.keys()],
    get: name => kept.get(name),
    put: async (name, p) => { kept.set(name, p); },
    remove: name => { kept.delete(name); },
  });
  await st.put("Run 1", doc());
  assert.deepEqual(await st.list(), [{ name: "Run 1" }]);
  assert.equal((await st.get("Run 1")).fugacity_project, 2);
  await st.remove("Run 1");
  assert.deepEqual(await st.list(), []);
  assert.equal(hostStore(null), null);
  assert.throws(() => hostStore({ list() {} }), /storage.get must be a function/);
});
