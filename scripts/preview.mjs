// A one-file preview of the workbench: the browser bundle inlined into a page that opens from disk, with no
// network and nothing to install. Used by .github/workflows/preview.yml, which attaches it to every pull
// request, so a reviewer can try the change before approving it; also `npm run preview` after `npm run build`.
//
//   node scripts/preview.mjs [out.html]     (default preview/workbench-preview.html)
//
// The banner says what the page was built from: PREVIEW_LABEL (e.g. "Pull request #91"), PREVIEW_COMMIT and
// PREVIEW_URL when set (the workflow sets them), else "local build".
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const bundle = ["dist/chepta.js", "dist/fugacity.js"].find(f => existsSync(f));
if (!bundle) throw new Error("No browser bundle in dist/: run npm run build first.");
const global = bundle.endsWith("chepta.js") ? "CHEPTA" : "Fugacity";
const out = process.argv[2] ?? "preview/workbench-preview.html";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const label = process.env.PREVIEW_LABEL || "Local build";
const commit = (process.env.PREVIEW_COMMIT || "").slice(0, 7);
const url = process.env.PREVIEW_URL || "";
// a "</script" inside the bundle would end the inline script early
const js = readFileSync(bundle, "utf8").replace(/<\/script/gi, "<\\/script");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Workbench preview${commit ? ` ${commit}` : ""}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 16px; background: Canvas; color: CanvasText; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .banner { max-width: 1240px; margin: 0 auto 12px; padding: 10px 14px; border-radius: 8px; border: 1px solid #c9a227; background: #fff7d6; color: #4a3b00; }
  @media (prefers-color-scheme: dark) { .banner { background: #3a2f05; color: #f3e3a6; border-color: #7a6514; } }
  .banner a { color: inherit; }
  #app { max-width: 1240px; margin: 0 auto; }
  @media (max-width: 600px) { body { padding: 0; } .banner { border-radius: 0; } }
</style>
</head>
<body>
<div class="banner"><b>Preview, not a release.</b> ${esc(label)}${commit ? `, commit ${esc(commit)}` : ""}, version ${esc(version)}${url ? ` (<a href="${esc(url)}">open on GitHub</a>)` : ""}.
Everything runs in this page; nothing is sent anywhere. Report what looks wrong in the pull request.</div>
<div id="app"></div>
<script>${js}</script>
<script>${global}.app("#app", { components: [] });</script>
</body>
</html>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1e6).toFixed(1)} MB, from ${bundle})`);
