// Usage: npm run check-package -- path/to/package.json
import { readFileSync } from "node:fs";
import { checkPackage } from "../src/contrib/package-check.js";

const file = process.argv[2];
if (!file) { console.error("Usage: npm run check-package -- path/to/package.json"); process.exit(2); }
let pkg;
try { pkg = JSON.parse(readFileSync(file, "utf8")); }
catch (e) { console.error(`Not valid JSON: ${e.message}`); process.exit(1); }
const known = JSON.parse(readFileSync(new URL("../src/data/components.json", import.meta.url))).components;
const { errors, warnings } = checkPackage(pkg, known);
for (const w of warnings) console.log(`warning: ${w}`);
for (const e of errors) console.log(`error:   ${e}`);
console.log(errors.length ? `\n${errors.length} error(s). Fix them before submitting.` : "\nPackage looks complete. A reviewer will now check the numbers against the source.");
process.exit(errors.length ? 1 : 0);
