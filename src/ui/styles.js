// Styles for the Fugacity interface. Everything is scoped under .fug so the
// widget can sit inside any page. Colours follow the host's light/dark setting:
// prefers-color-scheme, overridden by data-theme="light|dark" on <html>.
const LIGHT = `
  --fug-bg:#ffffff; --fug-panel:#f5f7f9; --fug-fg:#15191d; --fug-fg2:#4c555e; --fug-muted:#7b848c;
  --fug-rule:#dde1e5; --fug-accent:#1c5cab; --fug-on-accent:#ffffff; --fug-liq:#2a78d6; --fug-vap:#eb6834;
  --fug-halo:rgba(255,255,255,.85); --fug-iso:rgba(11,26,43,.42); --fug-err-bg:#fdecec; --fug-err-fg:#8a1c1c;`;
const DARK = `
  --fug-bg:#1a1e22; --fug-panel:#22272c; --fug-fg:#eef1f3; --fug-fg2:#b3bbc2; --fug-muted:#86909a;
  --fug-rule:#2f363c; --fug-accent:#6da7ec; --fug-on-accent:#0d1620; --fug-liq:#3987e5; --fug-vap:#d95926;
  --fug-halo:rgba(18,21,24,.8); --fug-iso:rgba(11,26,43,.5); --fug-err-bg:#3a1c1c; --fug-err-fg:#f3b0b0; color-scheme:dark;`;

export const CSS = `
.fug{${LIGHT} background:var(--fug-bg); color:var(--fug-fg); font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  border:1px solid var(--fug-rule); border-radius:10px; padding:16px; display:grid; gap:14px; max-width:1040px; box-sizing:border-box;}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) .fug{${DARK}} }
:root[data-theme="dark"] .fug{${DARK}}
.fug *{box-sizing:border-box}
.fug-head{display:flex; flex-wrap:wrap; gap:6px 16px; align-items:baseline; justify-content:space-between}
.fug-title{font-size:1.1rem; font-weight:600; margin:0; text-wrap:balance}
.fug-sub{font-size:.8rem; color:var(--fug-muted)}
.fug-controls{display:flex; flex-wrap:wrap; gap:10px 14px; align-items:center}
.fug-seg{display:inline-flex; border:1px solid var(--fug-rule); border-radius:8px; overflow:hidden}
.fug-seg button{font:500 .85rem inherit; font-family:inherit; padding:6px 12px; border:0; background:transparent; color:var(--fug-fg2); cursor:pointer}
.fug-seg button+button{border-left:1px solid var(--fug-rule)}
.fug-seg button[aria-pressed="true"]{background:var(--fug-accent); color:var(--fug-on-accent)}
.fug label{display:inline-flex; gap:6px; align-items:center; font-size:.85rem; color:var(--fug-fg2)}
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
