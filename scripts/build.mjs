// Builds three bundles from src/index.js:
//   dist/chepta.js   browser script, defines the global `CHEPTA` (use this in artifacts), and
//                    `Fugacity` as an alias for pages written before the rename (version 0.3)
//   dist/chepta.mjs  ES module
//   dist/chepta.cjs  CommonJS (Node require)
import { build } from "esbuild";

const common = { entryPoints: ["src/index.js"], bundle: true, target: "es2019", loader: { ".json": "json" }, legalComments: "none" };

await Promise.all([
  build({ ...common, outfile: "dist/chepta.js", format: "iife", globalName: "CHEPTA", minify: true, footer: { js: "var Fugacity=CHEPTA;" } }),
  build({ ...common, outfile: "dist/chepta.mjs", format: "esm" }),
  build({ ...common, outfile: "dist/chepta.cjs", format: "cjs", platform: "node" }),
]);
console.log("Built dist/chepta.js, dist/chepta.mjs, dist/chepta.cjs");
