// Builds three bundles from src/index.js:
//   dist/fugacity.js   browser script, defines the global `Fugacity` (use this in artifacts)
//   dist/fugacity.mjs  ES module
//   dist/fugacity.cjs  CommonJS (Node require)
import { build } from "esbuild";

const common = { entryPoints: ["src/index.js"], bundle: true, target: "es2019", loader: { ".json": "json" }, legalComments: "none" };

await Promise.all([
  build({ ...common, outfile: "dist/fugacity.js", format: "iife", globalName: "Fugacity", minify: true }),
  build({ ...common, outfile: "dist/fugacity.mjs", format: "esm" }),
  build({ ...common, outfile: "dist/fugacity.cjs", format: "cjs", platform: "node" }),
]);
console.log("Built dist/fugacity.js, dist/fugacity.mjs, dist/fugacity.cjs");
