// Styles for the workbench (Fugacity.app). Scoped under .fug-app; the base tokens and the
// view styles come from styles.js. Light and dark follow the host page, as in styles.js:
// prefers-color-scheme, overridden by data-theme="light|dark" on <html>.
import { injectPropertiesStyles } from "./styles.js";

const LIGHT = `
  --fa-bar:#1f2d3b; --fa-bar-fg:#b6c3d0; --fa-bar-strong:#ffffff; --fa-bar-accent:#8ab9f1;
  --fa-ribbon:#f6f7f9; --fa-edge:#d9dee4; --fa-canvas:#ffffff; --fa-panel:#f3f5f7; --fa-status:#e9edf1;
  --fa-hover:rgba(28,92,171,.08); --fa-pressed:#dbe7f6; --fa-pressed-fg:#113b70; --fa-pressed-edge:rgba(28,92,171,.28);
  --fa-ok:#1a9d6e; --fa-busy:#d99100; --fa-bad:#c93434;
  --fa-t-fitted-bg:#e1f3ea; --fa-t-fitted:#0c6443; --fa-t-standard-bg:#e1ebf8; --fa-t-standard:#174f94;
  --fa-t-databank-bg:#eceff2; --fa-t-databank:#46505a; --fa-t-none-bg:#fbe9e9; --fa-t-none:#8a1c1c;
  --fa-t-predicted-bg:#fff2d6; --fa-t-predicted:#6b4a00;
  --fug-s1:#2a78d6; --fug-s2:#eb6834; --fug-s3:#1baf7a; --fug-s4:#eda100; --fug-s5:#e87ba4; --fug-s6:#4a3aa7;`;
const DARK = `
  --fa-bar:#0d1216; --fa-bar-fg:#8d99a5; --fa-bar-strong:#eef1f3; --fa-bar-accent:#6da7ec;
  --fa-ribbon:#20262c; --fa-edge:#323a42; --fa-canvas:#1a1e22; --fa-panel:#1d2227; --fa-status:#14181c;
  --fa-hover:rgba(109,167,236,.10); --fa-pressed:#21344a; --fa-pressed-fg:#d3e5fb; --fa-pressed-edge:rgba(109,167,236,.35);
  --fa-ok:#2bb582; --fa-busy:#e0a526; --fa-bad:#ef6b6b;
  --fa-t-fitted-bg:#16352a; --fa-t-fitted:#8fdcbc; --fa-t-standard-bg:#1b2e45; --fa-t-standard:#a9cbf5;
  --fa-t-databank-bg:#2a3036; --fa-t-databank:#b3bbc2; --fa-t-none-bg:#3a1c1c; --fa-t-none:#f3b0b0;
  --fa-t-predicted-bg:#3a2e12; --fa-t-predicted:#f2d48a;
  --fug-s1:#3987e5; --fug-s2:#d95926; --fug-s3:#199e70; --fug-s4:#c98500; --fug-s5:#d55181; --fug-s6:#9085e9;`;

export const APP_CSS = `
.fug.fug-app{${LIGHT} padding:0; gap:0; max-width:none; width:100%; display:flex; flex-direction:column; overflow:hidden;
  font-size:13px; line-height:1.45; background:var(--fa-canvas); border-radius:10px; min-width:0}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) .fug.fug-app{${DARK}} }
:root[data-theme="dark"] .fug.fug-app{${DARK}}
.fug-app button{font-family:inherit}
.fug-app .fug-ico .a{stroke:var(--fug-accent)}
.fug-app input[type=text],.fug-app input[type=search],.fug-app select{font:inherit; font-size:12.5px; padding:3px 7px; border:1px solid var(--fug-rule);
  border-radius:5px; background:var(--fug-bg); color:var(--fug-fg); min-width:0; max-width:100%}
.fug-app input[type=text]{font-variant-numeric:tabular-nums}
.fug-app input:focus-visible,.fug-app select:focus-visible,.fug-app button:focus-visible{outline:2px solid var(--fug-accent); outline-offset:1px}

/* title bar and tabs */
.fa-titlebar{display:flex; align-items:stretch; gap:18px; background:var(--fa-bar); color:var(--fa-bar-fg); padding:0 6px 0 14px; min-height:40px}
.fa-brand{display:flex; align-items:center; gap:8px; color:var(--fa-bar-strong); font-weight:600; font-size:14px; letter-spacing:.01em}
.fa-brand .fug-ico .a{stroke:var(--fa-bar-accent)}
.fa-tabs{display:flex; align-items:flex-end; gap:2px; min-width:0; overflow-x:auto; scrollbar-width:none}
.fa-tab{border:0; background:transparent; color:inherit; font-size:12.5px; font-weight:500; padding:8px 13px 9px; border-radius:6px 6px 0 0; cursor:pointer; white-space:nowrap}
.fa-tab:hover{color:var(--fa-bar-strong); background:rgba(255,255,255,.06)}
.fa-tab[aria-selected="true"]{background:var(--fa-ribbon); color:var(--fug-fg)}
.fa-ribbon-closed .fa-tab[aria-selected="true"]{background:rgba(255,255,255,.1); color:var(--fa-bar-strong)}
.fa-titlebar .fa-icon-btn{color:var(--fa-bar-fg); margin-left:auto; align-self:center}
.fa-titlebar .fa-icon-btn:hover{color:var(--fa-bar-strong); background:rgba(255,255,255,.08)}
.fa-menu-wrap{position:relative; display:flex; align-items:center; min-width:0}
.fa-menu-btn{display:flex; align-items:center; gap:8px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.06); color:var(--fa-bar-strong);
  border-radius:6px; padding:4px 10px; font-size:13px; font-weight:500; cursor:pointer; white-space:nowrap}
.fa-menu{position:absolute; top:calc(100% + 2px); left:0; z-index:30; display:grid; min-width:210px; padding:4px; background:var(--fug-bg);
  border:1px solid var(--fug-rule); border-radius:8px; box-shadow:0 10px 28px rgba(8,16,24,.22)}
.fa-menu button{border:0; background:transparent; color:var(--fug-fg); text-align:left; padding:8px 10px; border-radius:5px; font-size:13px; cursor:pointer}
.fa-menu button:hover{background:var(--fa-hover)}
.fa-menu button[aria-checked="true"]{background:var(--fa-pressed); color:var(--fa-pressed-fg); font-weight:600}

/* ribbon */
.fa-ribbon{display:flex; align-items:stretch; background:var(--fa-ribbon); border-bottom:1px solid var(--fa-edge); padding:6px 4px 0; overflow-x:auto; min-height:104px}
.fa-group{display:flex; flex-direction:column; padding:0 10px; border-right:1px solid var(--fa-edge); flex:0 0 auto}
.fa-group:last-child{border-right:0}
.fa-group-body{display:flex; align-items:center; gap:3px; flex:1}
.fa-group-label{font-size:11px; color:var(--fug-muted); text-align:center; padding:3px 0 5px; white-space:nowrap}
.fa-btn{border:1px solid transparent; background:transparent; color:var(--fug-fg); border-radius:6px; cursor:pointer; font-size:12px}
.fa-btn .fug-ico{color:var(--fug-fg2); flex:none}
.fa-big{display:flex; flex-direction:column; align-items:center; gap:4px; padding:7px 8px 5px; min-width:66px; line-height:1.2}
.fa-small{display:flex; align-items:center; gap:7px; padding:3px 8px 3px 6px; white-space:nowrap; text-align:left; line-height:1.3}
.fa-btn:hover:not(:disabled){background:var(--fa-hover)}
.fa-btn[aria-pressed="true"]{background:var(--fa-pressed); color:var(--fa-pressed-fg); border-color:var(--fa-pressed-edge)}
.fa-btn[aria-pressed="true"] .fug-ico{color:var(--fa-pressed-fg)}
.fa-btn:disabled{opacity:.4; cursor:default}
.fa-glyph{font-family:"Cambria Math",Cambria,"STIX Two Math","Times New Roman",serif; font-style:italic; font-size:15px; font-weight:500; color:var(--fug-accent);
  min-width:26px; text-align:center; line-height:1}
.fa-glyph sub,.fa-glyph sup{font-size:.62em; font-style:normal}
.fa-stack{display:flex; flex-direction:column; gap:4px; justify-content:center; min-height:72px}
.fa-cols{display:grid; grid-template-rows:repeat(3, auto); grid-auto-flow:column; gap:1px 2px}
.fug-app .fa-field{display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; color:var(--fug-fg2)}
.fa-hint{font-size:11px; color:var(--fug-muted); padding:0 2px}
.fa-seg button{font-size:12px; padding:4px 10px}
.fa-units{display:grid; grid-template-columns:auto auto auto auto; gap:5px 10px; align-items:center; font-size:12px; color:var(--fug-fg2)}
.fa-units .fug-seg{justify-self:start}
.fa-about{font-size:12px; max-width:220px}
.fa-theme{display:flex; align-items:center; gap:8px; color:var(--fug-fg)}

/* body */
.fa-body{display:flex; align-items:stretch; min-height:560px; flex:1}
.fa-left{flex:0 0 236px; background:var(--fa-panel); border-right:1px solid var(--fug-rule); padding-bottom:12px; min-width:0}
.fa-right{flex:0 0 312px; background:var(--fa-panel); border-left:1px solid var(--fug-rule); min-width:0}
.fa-canvas{flex:1 1 auto; min-width:0; padding:14px 20px 20px; display:flex; flex-direction:column; gap:12px; background:var(--fa-canvas)}
.fa-panel-head{display:flex; justify-content:space-between; align-items:center; padding:11px 12px 6px; font-size:12px; font-weight:600; color:var(--fug-fg)}
.fa-panel-sub{font-size:12px; font-weight:600; color:var(--fug-fg); padding:12px 12px 5px}
.fa-panel-toggle{width:100%; border:0; background:transparent; cursor:pointer; font-family:inherit; text-align:left}
.fa-panel-toggle:hover{color:var(--fug-accent)}
.fa-panel-toggle .fa-count{display:inline-flex; align-items:center; gap:4px}
.fa-count{font-weight:500; color:var(--fug-muted); font-variant-numeric:tabular-nums}
.fa-empty{font-size:12px; color:var(--fug-fg2); padding:2px 12px}
.fa-chips{list-style:none; margin:0; padding:0 8px; display:grid; gap:4px}
.fa-chip{display:grid; grid-template-columns:18px minmax(0,1fr) auto 22px; align-items:center; gap:7px; background:var(--fug-bg);
  border:1px solid var(--fug-rule); border-radius:6px; padding:4px 3px 4px 6px; font-size:12.5px}
.fa-chip-n{width:18px; height:18px; border-radius:50%; background:var(--fug-accent); color:var(--fug-on-accent); font-size:10.5px; font-weight:600;
  display:grid; place-items:center; font-variant-numeric:tabular-nums}
.fa-chip-name{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.fa-chip-f,.fa-lib-f{font-size:11px; color:var(--fug-muted)}
.fa-x{border:0; background:transparent; color:var(--fug-muted); width:22px; height:22px; border-radius:4px; display:grid; place-items:center; cursor:pointer; padding:0}
.fa-x:hover{background:var(--fa-hover); color:var(--fug-fg)}
.fa-pairs ul{list-style:none; margin:0; padding:0 12px; display:grid; gap:4px; font-size:12px}
.fa-pairs li{display:flex; justify-content:space-between; align-items:center; gap:8px; color:var(--fug-fg2)}
.fa-search{margin:0 8px 6px; display:flex; align-items:center; gap:6px; border:1px solid var(--fug-rule); background:var(--fug-bg); border-radius:6px; padding:0 8px; color:var(--fug-muted)}
.fa-search:focus-within{outline:2px solid var(--fug-accent); outline-offset:1px}
.fug-app .fa-search input{border:0; background:transparent; flex:1; padding:5px 0; outline:none}
.fa-lib{padding:0 6px; display:grid; gap:1px}
.fa-lib-head{font-size:11px; color:var(--fug-muted); padding:7px 6px 2px}
.fa-lib-row{display:grid; grid-template-columns:16px minmax(0,1fr) auto; gap:8px; align-items:center; border:0; background:transparent; text-align:left;
  padding:4px 6px; border-radius:5px; cursor:pointer; color:var(--fug-fg); font-size:12.5px}
.fa-lib-row:hover:not(:disabled){background:var(--fa-hover)}
.fa-lib-row:disabled{opacity:.45; cursor:default}
.fa-check{width:15px; height:15px; border:1.5px solid var(--fug-muted); border-radius:4px; display:grid; place-items:center; color:var(--fug-on-accent)}
.fa-lib-row[aria-pressed="true"] .fa-check{background:var(--fug-accent); border-color:var(--fug-accent)}
.fa-lib-row[aria-pressed="true"] .fa-check .fug-ico{stroke-width:2.6}

/* canvas */
.fa-canvas-bar{display:flex; justify-content:space-between; align-items:flex-start; gap:12px}
.fa-canvas-title{min-width:0}
.fa-canvas-title h2{font-size:17px; font-weight:600; margin:0; line-height:1.3; text-wrap:balance}
.fa-sub{font-size:12px; color:var(--fug-fg2); margin-top:1px}
.fa-canvas-tools{display:flex; gap:2px; border:1px solid var(--fug-rule); border-radius:7px; padding:2px; background:var(--fug-bg); flex:none}
.fa-icon-btn{border:0; background:transparent; color:var(--fug-muted); width:30px; height:28px; border-radius:5px; display:grid; place-items:center; cursor:pointer; padding:0}
.fa-icon-btn:hover{background:var(--fa-hover); color:var(--fug-fg)}
.fa-canvas-tools .fa-icon-btn[aria-pressed="true"]{color:var(--fug-accent)}
.fa-canvas-tools .fa-icon-btn[aria-pressed="false"] .fug-ico .a{stroke:currentColor}
.fa-notes{display:grid; gap:8px}
.fa-notes:empty{display:none}
.fa-plot{width:100%; max-width:780px; margin:0 auto; transition:opacity .15s}
.fa-plot[data-view="ternary"]{max-width:620px}
.fa-plot[data-view="azeotropes"],.fa-plot[data-view="properties"]{max-width:none}
.fa-busy .fa-plot{opacity:.5}
.fa-nobg .fug-bg-layer{display:none !important}
.fa-below:empty{display:none}
.fa-gaps{font-size:11.5px; color:var(--fug-fg2); margin-top:8px; display:grid; gap:2px; overflow-wrap:anywhere}
.fa-gaps strong{font-weight:600; color:var(--fug-fg)}
.fug-app .fug-props{border:0; padding:0; max-width:none; background:transparent; border-radius:0}
.fug-app .sw{display:inline-block; width:14px; border-top:2px solid; margin-right:6px; vertical-align:middle}
.fa-cards{display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:12px}
.fa-card{border:1px solid var(--fug-rule); border-radius:8px; padding:10px 12px 12px; display:grid; gap:6px; align-content:start; background:var(--fug-bg)}
.fa-card svg{width:100%; height:auto; display:block}
.fa-card-head{display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:13px}
.fa-card-text{font-size:12px; color:var(--fug-fg2)}
.fa-card.is-missing{border-style:dashed}
.fa-link-btn{justify-self:start; border:0; background:none; color:var(--fug-accent); padding:0; font-size:12px; cursor:pointer; text-decoration:underline; text-underline-offset:2px}
.fa-table{font-size:12.5px}
.fug-app .fa-table th,.fug-app .fa-table td{text-align:left; padding:5px 8px 5px 0}
.fug-app .fa-num-table th,.fug-app .fa-num-table td{text-align:right; padding:4px 8px; white-space:nowrap}
.fug-app .fa-num-table th:first-child,.fug-app .fa-num-table td:first-child{text-align:right}
.fug-app th .u{display:block; font-weight:400; font-size:.7rem}
.fug-app .fug-scroll{overflow-x:auto; max-width:100%}

/* inspector: readouts from the existing renderers in the workbench's type */
.fug-app .fug-eyebrow{text-transform:none; letter-spacing:0; font-size:11.5px; font-weight:600; color:var(--fug-fg2)}
.fug-app .fa-right .fug-num,.fug-app .fa-right table{font-family:inherit; font-variant-numeric:tabular-nums; font-size:12.5px}
.fug-app .fa-right .fug-big{font-size:26px}
.fug-app .fa-right .fug-foot{font-size:11.5px}
.fa-right .fug-side{background:transparent; border-radius:0; padding:2px 14px 12px; gap:10px}
.fa-inspector-extra{padding:0 14px 16px; display:grid; gap:4px}
.fa-sec h3{font-size:12px; font-weight:600; margin:0 0 8px; padding-top:12px; border-top:1px solid var(--fug-rule)}
.fa-below .fa-sec h3{font-size:13px; border-top:0; padding-top:4px}
.fa-sources{list-style:none; margin:0; padding:0; display:grid; gap:9px}
.fa-src-head{display:flex; justify-content:space-between; align-items:flex-start; gap:8px; font-size:12px; font-weight:500}
.fa-src-text{font-size:11.5px; color:var(--fug-fg2); overflow-wrap:anywhere; line-height:1.4; margin-top:1px}
.fa-src-text.is-clamped{display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; cursor:pointer}
.fa-tier{font-size:10.5px; font-weight:500; padding:1px 7px; border-radius:999px; white-space:nowrap; background:var(--fa-t-databank-bg); color:var(--fa-t-databank)}
.fa-tier-fitted{background:var(--fa-t-fitted-bg); color:var(--fa-t-fitted)}
.fa-tier-standard{background:var(--fa-t-standard-bg); color:var(--fa-t-standard)}
.fa-tier-none{background:var(--fa-t-none-bg); color:var(--fa-t-none)}
.fa-tier-predicted{background:var(--fa-t-predicted-bg); color:var(--fa-t-predicted)}
.fa-read{display:grid; gap:5px}
.fa-row{display:flex; justify-content:space-between; align-items:baseline; gap:8px; font-size:12.5px; font-family:inherit}
.fa-row b{font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap}
.fa-row small{color:var(--fug-muted)}
.fa-comp-name{font-size:18px; font-weight:600; line-height:1.2}
.fa-kv{width:100%; border-collapse:collapse; font-size:12.5px}
.fug-app .fa-kv th{font-weight:400; color:var(--fug-fg2); font-size:12px; text-align:left; padding:4px 0}
.fug-app .fa-kv td{text-align:right; padding:4px 0; white-space:nowrap}
.fa-kv td small{color:var(--fug-muted); font-family:system-ui,sans-serif}
.fa-form{display:grid; grid-template-columns:repeat(auto-fill, minmax(118px, 1fr)); gap:8px; margin-bottom:6px}
.fug-app .fa-form label{display:flex; flex-direction:column; gap:2px; font-size:11.5px; color:var(--fug-fg2); align-items:stretch}
.fa-form label span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.fa-form input,.fa-form select{width:100%}
.fa-calc-out{display:grid; gap:2px}
.fa-result{padding:6px 0; border-bottom:1px solid var(--fug-rule); display:grid; gap:2px}
.fa-result:last-child{border-bottom:0}
.fa-result-head{display:flex; justify-content:space-between; align-items:baseline; gap:8px; font-size:12.5px}
.fa-result-head small{color:var(--fug-muted)}
.fa-result-head b{white-space:nowrap}
.fa-result.is-err b{color:var(--fug-muted); font-weight:500}
.fa-result .fug-sub{overflow-wrap:anywhere}
.fa-phase{font-size:15px; font-weight:600}
.fa-phase small{font-weight:400; color:var(--fug-muted); font-size:12px}

/* status bar */
.fa-status{display:flex; align-items:stretch; background:var(--fa-status); border-top:1px solid var(--fug-rule); font-size:11.5px; color:var(--fug-fg2); min-height:26px}
.fa-cell{padding:4px 11px; border-right:1px solid var(--fug-rule); white-space:nowrap; display:flex; align-items:center; gap:6px}
.fa-cell:last-child{border-right:0}
.fa-grow{flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; display:block; line-height:18px}
.fa-state i{display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--fa-ok)}
.fa-state.is-busy i{background:var(--fa-busy)}
.fa-state.is-err i{background:var(--fa-bad)}

/* mid width: the inspector moves under the canvas */
.fug-app[data-size="mid"] .fa-body{flex-wrap:wrap}
.fug-app[data-size="mid"] .fa-canvas{flex-basis:calc(100% - 237px)}
.fug-app[data-size="mid"].fa-no-left .fa-canvas{flex-basis:100%}
.fug-app[data-size="mid"] .fa-right{flex:1 1 100%; border-left:0; border-top:1px solid var(--fug-rule); display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); align-items:start}
.fug-app[data-size="mid"] .fa-right>.fa-panel-head{grid-column:1/-1}
.fug-app[data-size="mid"] .fa-inspector-extra{padding-top:0}

.fug-app[data-size="mid"] .fa-ribbon{flex-wrap:wrap; row-gap:6px; overflow-x:visible}
.fug-app[data-size="mid"] .fa-group{border-right:0; border-left:1px solid var(--fa-edge); margin-left:-1px}

/* narrow (phones): menu instead of tabs, ribbon groups stack, panels stack */
.fug-app[data-size="narrow"]{border-radius:0; border-left:0; border-right:0}
.fug-app[data-size="narrow"] .fa-titlebar{gap:10px; padding-left:10px}
.fug-app[data-size="narrow"] .fa-ribbon{flex-direction:column; overflow:visible; min-height:0; padding:4px 8px}
.fug-app[data-size="narrow"] .fa-group{border-right:0; border-bottom:1px solid var(--fa-edge); padding:6px 0; flex-direction:column-reverse}
.fug-app[data-size="narrow"] .fa-group:last-child{border-bottom:0}
.fug-app[data-size="narrow"] .fa-group-label{text-align:left; padding:0 2px 4px; font-weight:600; color:var(--fug-fg2)}
.fug-app[data-size="narrow"] .fa-group-body{flex-wrap:wrap}
.fug-app[data-size="narrow"] .fa-cols{grid-template-rows:none; grid-auto-flow:row; grid-template-columns:repeat(2, minmax(0,1fr)); width:100%}
.fug-app[data-size="narrow"] .fa-cols .fa-small{white-space:normal}
.fug-app[data-size="narrow"] .fa-stack{min-height:0; flex-direction:row; flex-wrap:wrap; align-items:flex-end; gap:6px}
.fug-app[data-size="narrow"] .fa-big{flex-direction:row; min-width:0; padding:5px 10px 5px 6px; gap:7px}
.fug-app[data-size="narrow"] .fa-big .fug-ico{width:20px; height:20px}
.fug-app[data-size="narrow"] .fa-body{flex-direction:column; min-height:0}
.fug-app[data-size="narrow"] .fa-left,.fug-app[data-size="narrow"] .fa-right{flex:none; border:0; border-top:1px solid var(--fug-rule)}
.fug-app[data-size="narrow"] .fa-left{order:0; border-top:0}
.fug-app[data-size="narrow"] .fa-canvas{order:1; padding:12px}
.fug-app[data-size="narrow"] .fa-right{order:2}
.fug-app[data-size="narrow"] .fa-lib{max-height:220px}
.fug-app[data-size="narrow"] .fa-status{flex-wrap:wrap}
.fug-app[data-size="narrow"] .fa-hide-narrow,.fug-app[data-size="narrow"] .fa-grow{display:none}
.fug-app[data-size="narrow"] .fa-units{grid-template-columns:auto auto}
.fug-app[data-size="narrow"] .fa-field{justify-content:flex-start}
@media (prefers-reduced-motion: reduce){ .fa-plot{transition:none} }
`;

/** Inject the base, property-explorer and workbench styles (once per document). */
export function injectAppStyles(doc = document) {
  injectPropertiesStyles(doc);
  if (doc.getElementById("fugacity-styles-app")) return;
  const el = doc.createElement("style");
  el.id = "fugacity-styles-app";
  el.textContent = APP_CSS;
  doc.head.appendChild(el);
}
