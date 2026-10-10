import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Every page and instruction that loads CHEPTA from the CDN must use the current version,
// so assistants never build pages with an outdated or unpublished release.
// Design documents (ARCHITECTURE, ROADMAP, proposals) may mention other versions as examples.
const EXEMPT = ["ARCHITECTURE.md", "ROADMAP.md", "proposals"];
const root = new URL("..", import.meta.url).pathname;
const version = JSON.parse(readFileSync(join(root, "package.json"))).version;

function files(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (n === "node_modules" || n.startsWith(".") || n === "dist" || EXEMPT.includes(n)) return [];
    return statSync(p).isDirectory() ? files(p) : /\.(md|html)$/.test(n) ? [p] : [];
  });
}

test("CDN references match the package version", () => {
  for (const f of files(root)) {
    for (const m of readFileSync(f, "utf8").matchAll(/fugacity@(\d+\.\d+\.\d+)/g)) {
      assert.equal(m[1], version, `${f.replace(root, "")} loads fugacity@${m[1]}, package is ${version}`);
    }
  }
});
