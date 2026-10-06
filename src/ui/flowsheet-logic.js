/**
 * Flowsheet workspace (proposal 0006, step 5), DOM-free: the edits a person makes on the
 * canvas, as functions from one flowsheet document (src/flowsheet/document.js) to the next.
 * No thermodynamics here.
 *
 * Products are automatic: every outlet of a unit that is not connected to another unit ends in
 * a Product block, which the canvas draws as an open arrow (a stream leaving the flowsheet).
 * Placing a unit gives it these product streams; connecting an outlet to a unit removes its
 * Product; disconnecting or deleting gives one back. So the flowsheet is always complete in
 * structure, and the degrees of freedom are the only thing left to fill in.
 */
import { unitType } from "../units/units.js";

/** Id prefix of each block type: F1, M1, SP1, X1, V1, E1, P1. */
export const PREFIX = { feed: "F", mixer: "M", splitter: "SP", separator: "X", flash: "V", heater: "E", product: "P" };
/** The block types of the palette, in order (products are automatic). */
export const PALETTE = ["feed", "mixer", "splitter", "separator", "flash", "heater"];

const clone = fs => JSON.parse(JSON.stringify(fs));
const nextId = (taken, prefix) => { let i = 1; while (taken.has(prefix + i)) i++; return prefix + i; };
const blockIds = fs => new Set(fs.blocks.map(b => b.id));
const streamIds = fs => new Set([...fs.streams.map(s => s.id), ...fs.blocks.map(b => b.energy).filter(Boolean)]);
const portOf = end => { const i = end.lastIndexOf("."); return { block: end.slice(0, i), port: end.slice(i + 1) }; };
const isProduct = (fs, id) => fs.blocks.find(b => b.id === id)?.type === "product";

/** A free spot for a new block: right of the rightmost block, on a 140 px grid. */
export function freeSpot(fs, near) {
  if (near) return { x: near.x, y: near.y };
  const units = fs.blocks.filter(b => b.type !== "product");
  if (!units.length) return { x: 120, y: 160 };
  const x = Math.max(...units.map(b => b.x ?? 0)) + 160;
  return { x, y: units[units.length - 1].y ?? 160 };
}

/** Add a Product block and a stream from `from` (BLOCK.port) to it, placed right of the unit. */
function addProductStream(fs, from, k = 0) {
  const src = fs.blocks.find(b => b.id === portOf(from).block);
  const pid = nextId(blockIds(fs), PREFIX.product), sid = nextId(streamIds(fs), "S");
  const dy = { vapour: -60, liquid: 60, liquid2: 100 }[portOf(from).port] ?? (k - 0.5) * 70;
  fs.blocks.push({ id: pid, type: "product", x: (src?.x ?? 0) + 130, y: (src?.y ?? 0) + dy });
  fs.streams.push({ id: sid, from, to: `${pid}.in` });
  return sid;
}

/** The outlet streams a new block starts with (minimum count of each outlet port). */
function outletEnds(type) {
  const u = unitType(type);
  return u.outlets.filter(p => !p.optional).flatMap(p => Array.from({ length: p.min === Infinity ? 2 : p.min }, () => p.port));
}

/** Default specification of a new block (left to fill in; a splitter starts at half and half). */
function defaultSpec(type, fs) {
  if (type === "splitter") return { fractions: [0.5, "rest"] };
  if (type === "separator") return { fractions: Object.fromEntries(fs.components.map(c => [c, [0.5, "rest"]])) };
  return {};
}

/** Place a block of `type` at (x, y) (or a free spot) with automatic products on its outlets. */
export function addBlock(fs, type, pos) {
  if (!PALETTE.includes(type)) throw new Error(`Unknown block type "${type}". The palette has: ${PALETTE.join(", ")}.`);
  const out = clone(fs);
  const id = nextId(blockIds(out), PREFIX[type]);
  const { x, y } = freeSpot(out, pos);
  out.blocks.push({ id, type, x, y, spec: defaultSpec(type, out) });
  outletEnds(type).forEach((port, k) => addProductStream(out, `${id}.${port}`, k));
  return { fs: out, id };
}

/** A new Feed connected to an inlet port of a unit (BLOCK.port). */
export function addFeedTo(fs, to) {
  const out = clone(fs);
  const dst = out.blocks.find(b => b.id === portOf(to).block);
  const id = nextId(blockIds(out), PREFIX.feed), sid = nextId(streamIds(out), "S");
  const n = out.streams.filter(s => s.to === to).length;
  out.blocks.push({ id, type: "feed", x: (dst?.x ?? 160) - 140, y: (dst?.y ?? 160) + n * 60, spec: {} });
  out.streams.push({ id: sid, from: `${id}.out`, to });
  return { fs: out, id, stream: sid };
}

/** The inlets that take one more stream, as "BLOCK.port", for the stream "goes to" choice. */
export function openInlets(fs, exceptBlock) {
  const out = [];
  for (const b of fs.blocks) {
    if (b.type === "product" || b.type === "feed" || b.id === exceptBlock) continue;
    for (const p of unitType(b.type).inlets) {
      const n = fs.streams.filter(s => s.to === `${b.id}.${p.port}`).length;
      if (n < p.max) out.push(`${b.id}.${p.port}`);
    }
  }
  return out;
}

/**
 * Send stream `sid` to an inlet (BLOCK.port), or out of the flowsheet (to = null: a new
 * Product). A Product it went to is removed.
 */
export function connect(fs, sid, to) {
  const out = clone(fs);
  const s = out.streams.find(x => x.id === sid);
  if (!s) throw new Error(`No stream ${sid}.`);
  const old = portOf(s.to).block;
  if (to == null) {
    if (isProduct(out, old)) return out;
    const pid = nextId(blockIds(out), PREFIX.product);
    const src = out.blocks.find(b => b.id === portOf(s.from).block);
    out.blocks.push({ id: pid, type: "product", x: (src?.x ?? 0) + 130, y: (src?.y ?? 0) + 40 });
    s.to = `${pid}.in`;
    delete s.tear; delete s.guess;
  } else {
    if (!openInlets(out).includes(to) && s.to !== to) throw new Error(`${to} takes no more streams.`);
    s.to = to;
  }
  if (isProduct(out, old) && !out.streams.some(x => portOf(x.to).block === old)) out.blocks = out.blocks.filter(b => b.id !== old);
  return out;
}

/**
 * Delete a block. Streams into it from units go back to being products; streams out of it are
 * removed with the Products they went to (a unit they went to loses that inlet stream).
 */
export function deleteBlock(fs, id) {
  let out = clone(fs);
  const b = out.blocks.find(x => x.id === id);
  if (!b || b.type === "product") return out;
  for (const s of out.streams.filter(x => portOf(x.to).block === id)) {
    if (out.blocks.find(x => x.id === portOf(s.from).block)?.type === "feed") {
      out.blocks = out.blocks.filter(x => x.id !== portOf(s.from).block);
      out.streams = out.streams.filter(x => x.id !== s.id);
    } else out = connect(out, s.id, null);
  }
  for (const s of out.streams.filter(x => portOf(x.from).block === id)) {
    out.streams = out.streams.filter(x => x.id !== s.id);
    if (isProduct(out, portOf(s.to).block)) out.blocks = out.blocks.filter(x => x.id !== portOf(s.to).block);
  }
  out.blocks = out.blocks.filter(x => x.id !== id);
  return out;
}

/** Add an outlet to a splitter or component separator (a new product stream and its fraction). */
export function addOutlet(fs, id) {
  const out = clone(fs);
  const b = out.blocks.find(x => x.id === id);
  if (!b || !["splitter", "separator"].includes(b.type)) return out;
  const k = out.streams.filter(s => s.from === `${id}.out`).length;
  addProductStream(out, `${id}.out`, k);
  const grow = list => { const l = Array.isArray(list) ? list.slice() : []; l.splice(Math.max(0, l.length - 1), 0, 0); return l; };
  b.spec ??= {};
  if (b.type === "splitter") b.spec.fractions = grow(b.spec.fractions);
  else b.spec.fractions = Object.fromEntries(Object.entries(b.spec.fractions ?? {}).map(([c, l]) => [c, grow(l)]));
  return out;
}

/** Remove the last outlet of a splitter or separator (it must lead to a Product, and two stay). */
export function removeOutlet(fs, id) {
  const out = clone(fs);
  const b = out.blocks.find(x => x.id === id);
  const outs = out.streams.filter(s => s.from === `${id}.out`);
  if (!b || outs.length <= 2) return out;
  const last = outs[outs.length - 1];
  if (!isProduct(out, portOf(last.to).block)) throw new Error(`The last outlet of ${id} (${last.id}) goes to a unit; send it out of the flowsheet first.`);
  out.streams = out.streams.filter(s => s.id !== last.id);
  out.blocks = out.blocks.filter(x => x.id !== portOf(last.to).block);
  const shrink = list => { const l = list.slice(0, -1); if (list[list.length - 1] === "rest" && !l.includes("rest")) l[l.length - 1] = "rest"; return l; };
  if (b.type === "splitter" && Array.isArray(b.spec?.fractions)) b.spec.fractions = shrink(b.spec.fractions);
  if (b.type === "separator") b.spec.fractions = Object.fromEntries(Object.entries(b.spec?.fractions ?? {}).map(([c, l]) => [c, shrink(l)]));
  return out;
}

/** Change a block's specification (merged; a key set to null or "" is removed). */
export function setSpec(fs, id, patch) {
  const out = clone(fs);
  const b = out.blocks.find(x => x.id === id);
  if (!b) throw new Error(`No block ${id}.`);
  const spec = { ...(b.spec ?? {}), ...patch };
  for (const k of Object.keys(spec)) if (spec[k] == null || spec[k] === "") delete spec[k];
  b.spec = spec;
  return out;
}

/** Move a block. */
export function moveBlock(fs, id, x, y) {
  const out = clone(fs);
  const b = out.blocks.find(v => v.id === id);
  if (b) { b.x = Math.round(x); b.y = Math.round(y); }
  return out;
}

/** Mark or unmark a stream as a tear stream (recycle). */
export function setTear(fs, sid, on) {
  const out = clone(fs);
  const s = out.streams.find(x => x.id === sid);
  if (s) { if (on) s.tear = true; else { delete s.tear; delete s.guess; } }
  return out;
}

/**
 * Change the setup's components: the specifications follow (a removed component leaves the
 * feeds and the separators; a new one starts at zero flow and with "rest" to the last
 * outlet). Returns the new flowsheet and a note of what changed for the person.
 */
export function setComponents(fs, ids) {
  const out = clone(fs);
  const removed = out.components.filter(c => !ids.includes(c)), added = ids.filter(c => !out.components.includes(c));
  out.components = ids.slice();
  let touched = 0;
  for (const b of out.blocks) {
    if (b.type === "feed" && b.spec) {
      for (const key of ["flow_kmol_h", "flow_kg_h"]) {
        if (b.spec[key] && typeof b.spec[key] === "object" && !Array.isArray(b.spec[key])) {
          for (const c of removed) if (c in b.spec[key]) { delete b.spec[key][c]; touched++; }
        }
      }
    }
    if (b.type === "separator" && b.spec?.fractions) {
      const n = out.streams.filter(s => s.from === `${b.id}.out`).length;
      for (const c of removed) if (c in b.spec.fractions) { delete b.spec.fractions[c]; touched++; }
      for (const c of added) b.spec.fractions[c] = [...Array(Math.max(1, n - 1)).fill(0), "rest"];
    }
  }
  const units = out.blocks.filter(b => b.type !== "product").length;
  const note = !units || (!removed.length && !added.length) ? ""
    : [removed.length ? `Removed ${removed.join(", ")} from ${touched ? `${touched} specification${touched === 1 ? "" : "s"}` : "the flowsheet"}.` : "",
      added.length ? `${added.join(", ")} start${added.length === 1 ? "s" : ""} at zero flow in the feeds${out.blocks.some(b => b.type === "separator") ? " and goes to the last outlet of each separator" : ""}.` : ""].filter(Boolean).join(" ");
  return { fs: out, note };
}

/** The stream ids a block has, by port: { in: [...], out: [...], vapour: [...], ... }. */
export function streamsOf(fs, id) {
  const res = {};
  for (const s of fs.streams) {
    const f = portOf(s.from), t = portOf(s.to);
    if (f.block === id) (res[f.port] ??= []).push(s.id);
    if (t.block === id) (res[t.port] ??= []).push(s.id);
  }
  return res;
}

/** Where a stream ends: { kind: "product" } or { kind: "unit", block, port }. */
export function endOf(fs, sid) {
  const s = fs.streams.find(x => x.id === sid);
  if (!s) return null;
  const t = portOf(s.to);
  return isProduct(fs, t.block) ? { kind: "product", block: t.block } : { kind: "unit", block: t.block, port: t.port };
}

/**
 * Delete a stream, as far as the flowsheet allows; returns { fs, note } (note says what
 * happened, or why nothing did):
 *  - a feed's stream: the feed goes with it;
 *  - a stream into a unit: disconnected, it leaves the flowsheet (a product);
 *  - an outlet of a splitter or separator with more than two: that outlet is removed with its
 *    fraction;
 *  - any other stream already leaving the flowsheet: kept, since every outlet of a unit must
 *    go somewhere (delete the unit instead).
 */
export function deleteStream(fs, sid) {
  const s = fs.streams.find(x => x.id === sid);
  if (!s) return { fs, note: `No stream ${sid}.` };
  const src = fs.blocks.find(b => b.id === portOf(s.from).block);
  if (src?.type === "feed") {
    const out = clone(fs);
    out.streams = out.streams.filter(x => x.id !== sid);
    out.blocks = out.blocks.filter(b => b.id !== src.id);
    return { fs: out, note: `Deleted the feed ${src.id} with its stream ${sid}.` };
  }
  const end = endOf(fs, sid);
  if (end.kind === "unit") return { fs: connect(fs, sid, null), note: `${sid} no longer goes to ${end.block}: it now leaves the flowsheet.` };
  const outs = fs.streams.filter(x => x.from === s.from);
  if (src && ["splitter", "separator"].includes(src.type) && portOf(s.from).port === "out" && outs.length > 2) {
    const k = outs.findIndex(x => x.id === sid);
    const out = clone(fs);
    out.streams = out.streams.filter(x => x.id !== sid);
    out.blocks = out.blocks.filter(b => b.id !== end.block);
    const b = out.blocks.find(x => x.id === src.id);
    const cut = list => { if (!Array.isArray(list)) return list; const l = list.slice(); const was = l[k]; l.splice(k, 1); if (was === "rest" && !l.includes("rest")) l[l.length - 1] = "rest"; return l; };
    if (b.type === "splitter") b.spec = { ...b.spec, fractions: cut(b.spec?.fractions) };
    else b.spec = { ...b.spec, fractions: Object.fromEntries(Object.entries(b.spec?.fractions ?? {}).map(([c, l]) => [c, cut(l)])) };
    return { fs: out, note: `Removed the outlet ${sid} of ${src.id}.` };
  }
  return { fs, note: `${sid} is how ${src?.id ?? "a unit"} sends its ${portOf(s.from).port} out of the flowsheet; every outlet must go somewhere. To remove it, delete ${src?.id ?? "the unit"}, or connect ${sid} to another block.` };
}
