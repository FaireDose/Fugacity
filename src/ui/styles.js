// Styles for the Fugacity interface. Everything is scoped under .fug so the
// widget can sit inside any page. Colours follow the host's light/dark setting:
// prefers-color-scheme, overridden by data-theme="light|dark" on <html>.
const LIGHT = `
  --fug-bg:#ffffff; --fug-panel:#f5f7f9; --fug-fg:#15191d; --fug-fg2:#4c555e; --fug-muted:#7b848c;
  --fug-rule:#dde1e5; --fug-accent:#1c5cab; --fug-on-accent:#ffffff; --fug-liq:#2a78d6; --fug-vap:#eb6834;
  --fug-halo:rgba(255,255,255,.85); --fug-iso:rgba(11,26,43,.42); --fug-err-bg:#fdecec; --fug-err-fg:#8a1c1c;
  --fug-warn-bg:#fff4dc; --fug-warn-fg:#6b4a00;`;
const DARK = `
  --fug-bg:#1a1e22; --fug-panel:#22272c; --fug-fg:#eef1f3; --fug-fg2:#b3bbc2; --fug-muted:#86909a;
  --fug-rule:#2f363c; --fug-accent:#6da7ec; --fug-on-accent:#0d1620; --fug-liq:#3987e5; --fug-vap:#d95926;
  --fug-halo:rgba(18,21,24,.8); --fug-iso:rgba(11,26,43,.5); --fug-err-bg:#3a1c1c; --fug-err-fg:#f3b0b0;
  --fug-warn-bg:#3a2e12; --fug-warn-fg:#f2d48a; color-scheme:dark;`;

export const CSS = `
.fug{${LIGHT} background:var(--fug-bg); color:var(--fug-fg); font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  border:1px solid var(--fug-rule); border-radius:10px; padding:16px; display:grid; gap:14px; max-width:1040px; box-sizing:border-box;}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) .fug{${DARK}} }
:root[data-theme="dark"] .fug{${DARK}}
.fug *{box-sizing:border-box}
.fug [hidden]{display:none !important}
.fug a{color:var(--fug-accent)}
.fug-head{display:flex; flex-wrap:wrap; gap:6px 16px; align-items:baseline; justify-content:space-between}
.fug-title{font-size:1.1rem; font-weight:600; margin:0; text-wrap:balance}
.fug-sub{font-size:.8rem; color:var(--fug-muted)}
.fug-controls{display:flex; flex-wrap:wrap; gap:10px 14px; align-items:center}
.fug-seg{display:inline-flex; border:1px solid var(--fug-rule); border-radius:8px; overflow:hidden}
.fug-seg button{font:500 .85rem inherit; font-family:inherit; padding:6px 12px; border:0; background:transparent; color:var(--fug-fg2); cursor:pointer}
.fug-seg button+button{border-left:1px solid var(--fug-rule)}
.fug-seg button[aria-pressed="true"]{background:var(--fug-accent); color:var(--fug-on-accent)}
.fug label{display:inline-flex; gap:6px; align-items:center; font-size:.85rem; color:var(--fug-fg2)}
.fug select{font:inherit; font-size:.85rem; padding:4px 6px; border:1px solid var(--fug-rule); border-radius:6px; background:var(--fug-bg); color:var(--fug-fg); max-width:100%}
.fug select:focus-visible{outline:2px solid var(--fug-accent); outline-offset:2px}
/* component picker (component-picker.js): a field you type into, with the matches listed under it */
.fug-pick{position:relative; display:grid; min-width:0}
.fug .fug-pick-in{width:100%; font:inherit; font-size:.85rem; padding:5px 8px; border:1px solid var(--fug-rule); border-radius:6px;
  background:var(--fug-bg); color:var(--fug-fg); min-width:12em}
.fug .fug-pick.is-bad .fug-pick-in{border-color:var(--fa-bad, #c0392b)}
.fug .fug-pick-in:focus-visible{outline:2px solid var(--fug-accent); outline-offset:1px}
.fug-pick-list{list-style:none; margin:4px 0 0; padding:3px; max-height:240px; overflow:auto; border:1px solid var(--fug-rule);
  border-radius:6px; background:var(--fug-bg); box-shadow:0 4px 14px rgba(0,0,0,.08); font-size:.85rem}
.fug-pick-opt{display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 8px; padding:4px 7px; border-radius:4px; cursor:pointer}
.fug-pick-opt[aria-selected="true"]{background:var(--fug-accent); color:var(--fug-on-accent)}
.fug-pick-opt[aria-selected="true"] .fug-pick-meta,.fug-pick-opt[aria-selected="true"] .fug-pick-note{color:inherit; opacity:.85}
.fug-pick-opt[aria-disabled="true"]{cursor:default; color:var(--fug-muted)}
.fug-pick-name{font-weight:500}
.fug-pick-meta{font-size:.78rem; color:var(--fug-muted); font-variant-numeric:tabular-nums}
.fug-pick-note{flex-basis:100%; font-size:.75rem; color:var(--fug-muted)}
.fug-pick-group{padding:6px 7px 2px; font-size:.7rem; letter-spacing:.06em; text-transform:uppercase; color:var(--fug-muted)}
.fug-pick-none{padding:6px 7px; color:var(--fug-muted)}
.fug-pick-row{align-items:flex-start}
.fug-pick-slot{display:flex; align-items:flex-start; gap:4px}
.fug-pick-clear{border:1px solid var(--fug-rule); background:var(--fug-bg); color:var(--fug-fg2); border-radius:6px; padding:3px 8px; cursor:pointer; font:inherit}
.fug-pick-field{display:inline-flex; gap:6px; align-items:flex-start; font-size:.85rem; color:var(--fug-fg2)}
.fug-pick-field > label{padding-top:5px}
.fug input[type=number]{width:6.5em; font:inherit; font-variant-numeric:tabular-nums; padding:4px 6px; border:1px solid var(--fug-rule); border-radius:6px; background:var(--fug-bg); color:var(--fug-fg)}
.fug button:focus-visible,.fug input:focus-visible{outline:2px solid var(--fug-accent); outline-offset:2px}
.fug-main{display:flex; flex-wrap:wrap; gap:16px; align-items:flex-start}
.fug-plot{flex:2 1 420px; min-width:0}
.fug-plot svg{width:100%; height:auto; display:block; touch-action:none}
.fug-side{flex:1 1 240px; min-width:0; display:grid; gap:12px; background:var(--fug-panel); border-radius:8px; padding:12px}
.fug-eyebrow{font-size:.7rem; letter-spacing:.07em; text-transform:uppercase; color:var(--fug-muted)}
.fug-big{font-size:1.7rem; font-weight:600; font-variant-numeric:tabular-nums; line-height:1.1}
.fug-num{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-variant-numeric:tabular-nums; font-size:.85rem}
.fug table{width:100%; border-collapse:collapse; font-size:.85rem}
.fug th,.fug td{padding:4px 3px; text-align:right; border-bottom:1px solid var(--fug-rule)}
.fug th:first-child,.fug td:first-child{text-align:left}
.fug th{font-weight:500; font-size:.78rem; color:var(--fug-muted)}
.fug-legend{display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; font-size:.8rem; color:var(--fug-fg2); margin-top:6px}
.fug-key{display:inline-flex; gap:6px; align-items:center}
.fug-key i{display:inline-block; width:18px; border-top:2px solid currentColor}
.fug-ramp{display:grid; gap:3px; width:min(100%,280px)}
.fug-ramp .bar{height:9px; border-radius:3px}
.fug-ramp .ticks{display:flex; justify-content:space-between; font-size:.7rem; color:var(--fug-muted)}
.fug-foot{font-size:.75rem; color:var(--fug-muted); display:grid; gap:2px}
.fug-err{background:var(--fug-err-bg); color:var(--fug-err-fg); border-radius:8px; padding:10px 12px; font-size:.9rem}
.fug-warn{background:var(--fug-warn-bg); color:var(--fug-warn-fg); border-radius:8px; padding:10px 12px; font-size:.9rem}
.fug svg text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
`;

let injected = false;
export function injectStyles(doc = document) {
  if (injected || doc.getElementById("fugacity-styles")) return;
  const s = doc.createElement("style");
  s.id = "fugacity-styles";
  s.textContent = CSS;
  doc.head.appendChild(s);
  injected = true;
}

// ---------------------------------------------------------------------------------------
// Property explorer (mountProperties). Series colours: the first six slots of a
// categorical palette checked for colour-vision deficiency (adjacent pairs) in both themes;
// every curve also carries a direct label, so colour is never the only key.
const PROPS_LIGHT = `--fug-s1:#2a78d6; --fug-s2:#eb6834; --fug-s3:#1baf7a; --fug-s4:#eda100; --fug-s5:#e87ba4; --fug-s6:#4a3aa7;`;
const PROPS_DARK = `--fug-s1:#3987e5; --fug-s2:#d95926; --fug-s3:#199e70; --fug-s4:#c98500; --fug-s5:#d55181; --fug-s6:#9085e9;`;

export const PROPERTIES_CSS = `
.fug.fug-props{${PROPS_LIGHT}}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) .fug.fug-props{${PROPS_DARK}} }
:root[data-theme="dark"] .fug.fug-props{${PROPS_DARK}}
.fug.fug-props{grid-template-columns:minmax(0,1fr)}
.fug-props .fug-controls>label{flex-wrap:wrap; max-width:100%; min-width:0}
.fug-props .fug-calc .v small{font-size:.75rem; font-weight:500; color:var(--fug-fg2)}
.fug-props input[type=text]{width:9em; font:inherit; font-variant-numeric:tabular-nums; padding:4px 6px; border:1px solid var(--fug-rule); border-radius:6px; background:var(--fug-bg); color:var(--fug-fg)}
.fug-props select{max-width:100%; min-width:0}
.fug-props .fug-seg button{padding:5px 10px}
.fug-props .fug-side{align-content:start}
.fug-props .fug-plot svg{touch-action:pan-y}
.fug-props .fug-read{display:grid; gap:6px}
.fug-props .fug-read .row{display:flex; justify-content:space-between; gap:8px; align-items:baseline; font-size:.85rem}
.fug-props .fug-read .row b{font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap}
.fug-props .sw{display:inline-block; width:16px; border-top:2px solid; margin-right:6px; vertical-align:middle}
.fug-props .fug-srcs{display:grid; gap:4px; font-size:.78rem; color:var(--fug-fg2); background:var(--fug-panel); border-radius:8px; padding:10px 12px; overflow-wrap:anywhere}
.fug-props .fug-srcs .k{color:var(--fug-muted); font-size:.7rem; letter-spacing:.06em; text-transform:uppercase; margin-top:4px}
.fug-props .fug-srcs .k:first-child{margin-top:0}
.fug-props .miss{color:var(--fug-err-fg)}
.fug-props .fug-tier{display:inline-block; font-size:.7rem; padding:0 6px; border-radius:999px; border:1px solid var(--fug-rule); color:var(--fug-fg2); white-space:nowrap}
.fug-props .fug-nodata{border:1px dashed var(--fug-rule); border-radius:8px; padding:18px; display:grid; gap:6px; color:var(--fug-fg2)}
.fug-props .fug-nodata strong{color:var(--fug-fg); font-size:1rem}
.fug-props .fug-sec{display:grid; gap:8px; min-width:0}
.fug-props .fug-sec h4{margin:0; font-size:.95rem; font-weight:600}
.fug-props .fug-scroll{overflow-x:auto; max-width:100%; -webkit-overflow-scrolling:touch}
.fug-props .fug-scroll th,.fug-props .fug-scroll td{padding:4px 8px; white-space:nowrap}
.fug-props th .u{display:block; font-weight:400; font-size:.7rem}
.fug-props .fug-calc{display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:8px}
.fug-props .fug-calc>div{background:var(--fug-panel); border-radius:8px; padding:8px 10px; min-width:0}
.fug-props .fug-calc .v{font-size:1.05rem; font-weight:600; font-variant-numeric:tabular-nums}
.fug-props .fug-calc .s{font-size:.7rem; color:var(--fug-muted); overflow-wrap:anywhere}
`;

/** Inject the base styles and the property-explorer section (once per document). */
export function injectPropertiesStyles(doc = document) {
  injectStyles(doc);
  if (doc.getElementById("fugacity-styles-properties")) return;
  const el = doc.createElement("style");
  el.id = "fugacity-styles-properties";
  el.textContent = PROPERTIES_CSS;
  doc.head.appendChild(el);
}
