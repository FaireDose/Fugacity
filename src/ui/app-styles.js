// Styles for the workbench (Fugacity.app): navigation bar, toolbar, Inputs / canvas / Results,
// drawer, status bar. Scoped under .fug-app; the base tokens and the
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
  --fa-t-predicted-bg:#fff2d6; --fa-t-predicted:#6b4a00; --fa-t-user-bg:#f1e6fa; --fa-t-user:#5b2a86;
  --fug-s1:#2a78d6; --fug-s2:#eb6834; --fug-s3:#1baf7a; --fug-s4:#eda100; --fug-s5:#e87ba4; --fug-s6:#4a3aa7;`;
const DARK = `
  --fa-bar:#0d1216; --fa-bar-fg:#8d99a5; --fa-bar-strong:#eef1f3; --fa-bar-accent:#6da7ec;
  --fa-ribbon:#20262c; --fa-edge:#323a42; --fa-canvas:#1a1e22; --fa-panel:#1d2227; --fa-status:#14181c;
  --fa-hover:rgba(109,167,236,.10); --fa-pressed:#21344a; --fa-pressed-fg:#d3e5fb; --fa-pressed-edge:rgba(109,167,236,.35);
  --fa-ok:#2bb582; --fa-busy:#e0a526; --fa-bad:#ef6b6b;
  --fa-t-fitted-bg:#16352a; --fa-t-fitted:#8fdcbc; --fa-t-standard-bg:#1b2e45; --fa-t-standard:#a9cbf5;
  --fa-t-databank-bg:#2a3036; --fa-t-databank:#b3bbc2; --fa-t-none-bg:#3a1c1c; --fa-t-none:#f3b0b0;
  --fa-t-predicted-bg:#3a2e12; --fa-t-predicted:#f2d48a; --fa-t-user-bg:#33233f; --fa-t-user:#dbbdf3;
  --fug-s1:#3987e5; --fug-s2:#d95926; --fug-s3:#199e70; --fug-s4:#c98500; --fug-s5:#d55181; --fug-s6:#9085e9;`;

export const APP_CSS = `
.fug.fug-app{${LIGHT} padding:0; gap:0; max-width:none; width:100%; display:flex; flex-direction:column; overflow:hidden; overflow:clip;
  font-size:13px; line-height:1.45; background:var(--fa-canvas); border-radius:10px; min-width:0}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) .fug.fug-app{${DARK}} }
:root[data-theme="dark"] .fug.fug-app{${DARK}}
.fug-app button{font-family:inherit}
.fug-app .fug-ico .a{stroke:var(--fug-accent)}
.fug-app input[type=text],.fug-app input[type=search],.fug-app select{font:inherit; font-size:12.5px; padding:3px 7px; border:1px solid var(--fug-rule);
  border-radius:5px; background:var(--fug-bg); color:var(--fug-fg); min-width:0; max-width:100%}
.fug-app input[type=text]{font-variant-numeric:tabular-nums}
.fug-app input:focus-visible,.fug-app select:focus-visible,.fug-app button:focus-visible{outline:2px solid var(--fug-accent); outline-offset:1px}

/* navigation bar: workspaces (tasks), then the supporting utilities */
.fa-titlebar{margin:0; max-width:none; align-self:stretch; flex-wrap:nowrap; display:flex; align-items:stretch; gap:18px; background:var(--fa-bar); color:var(--fa-bar-fg); padding:0 6px 0 14px; min-height:44px}
.fa-brand{display:flex; align-items:center; gap:8px; color:var(--fa-bar-strong); font-weight:600; font-size:14px; letter-spacing:.01em}
.fa-brand .fug-ico .a{stroke:var(--fa-bar-accent)}
.fa-nav{display:flex; align-items:flex-end; gap:2px; min-width:0}
.fa-nav-btn{display:flex; align-items:center; gap:7px; border:0; background:transparent; color:inherit; font-size:13px; font-weight:500;
  padding:9px 14px 10px; border-radius:7px 7px 0 0; cursor:pointer; white-space:nowrap; position:relative}
.fa-nav-btn .fug-ico .a{stroke:currentColor}
.fa-nav-btn:hover{color:var(--fa-bar-strong); background:rgba(255,255,255,.07)}
.fa-nav-btn[aria-current="page"]{background:var(--fa-ribbon); color:var(--fug-fg); font-weight:600}
.fa-nav-btn[aria-current="page"] .fug-ico{color:var(--fug-accent)}
.fa-nav-btn[aria-current="page"] .fug-ico .a{stroke:var(--fug-accent)}
.fa-nav-btn[aria-current="page"]::before{content:""; position:absolute; left:10px; right:10px; top:0; height:2px; border-radius:0 0 2px 2px; background:var(--fug-accent)}
.fa-ribbon-closed .fa-nav-btn[aria-current="page"]{background:var(--fa-canvas)}
.fa-nav-short{display:none}
.fa-file-btn{margin-right:8px; border-right:1px solid rgba(255,255,255,.12) !important}
.fa-file-btn[aria-expanded="true"]{color:var(--fa-bar-strong); background:rgba(255,255,255,.1)}
.fa-subnav{display:flex; flex-wrap:wrap; align-items:center; gap:2px 4px; padding:4px 10px 0; background:var(--fa-ribbon); border-bottom:1px solid var(--fug-rule)}
.fa-subnav[hidden]{display:none}
.fa-sub-btn{display:inline-flex; align-items:center; gap:6px; border:0; background:transparent; color:var(--fug-fg2); font:inherit; font-size:12.5px; padding:6px 10px 7px; border-bottom:2px solid transparent; cursor:pointer}
.fa-sub-btn:hover{color:var(--fug-fg)}
.fa-sub-btn[aria-current="page"]{color:var(--fug-fg); font-weight:600; border-bottom-color:var(--fug-accent)}
.fa-sub-btn[aria-current="page"] .fug-ico{color:var(--fug-accent)}
.fa-sub-btn.is-locked{opacity:.55; cursor:not-allowed}
.fa-sub-btn.is-locked small{font-size:10.5px; color:var(--fug-muted)}
.fa-utils{display:flex; align-items:center; gap:2px; margin-left:auto; padding-left:12px; border-left:1px solid rgba(255,255,255,.12); align-self:center; min-height:28px}
.fa-util-btn{display:flex; align-items:center; gap:6px; border:1px solid transparent; background:transparent; color:var(--fa-bar-fg); font-size:12.5px;
  padding:4px 9px; border-radius:6px; cursor:pointer; white-space:nowrap}
.fa-util-btn .fug-ico .a{stroke:var(--fa-bar-accent)}
.fa-util-btn:hover{color:var(--fa-bar-strong); background:rgba(255,255,255,.08)}
.fa-util-btn[aria-expanded="true"]{color:var(--fa-bar-strong); background:rgba(255,255,255,.12); border-color:rgba(255,255,255,.18)}
.fa-titlebar .fa-icon-btn{color:var(--fa-bar-fg); align-self:center}
.fa-titlebar .fa-icon-btn:hover{color:var(--fa-bar-strong); background:rgba(255,255,255,.08)}
.fug-app .fa-titlebar button:focus-visible{outline:2px solid var(--fa-bar-accent); outline-offset:-2px}
.fug-app .fa-titlebar .fa-nav-btn[aria-current="page"]:focus-visible{outline-color:var(--fug-accent)}
.fa-visually-hidden{position:absolute !important; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap}

/* ribbon */
.fa-ribbon{display:flex; flex-wrap:wrap; row-gap:6px; align-items:stretch; background:var(--fa-ribbon); border-bottom:1px solid var(--fa-edge); padding:6px 4px 0; min-height:104px}
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
.fug-app .fa-field-wide{justify-content:flex-start; margin-bottom:4px} .fug-app .fa-field-wide input{flex:1; min-width:0}
.fa-hint{font-size:11px; color:var(--fug-muted); padding:0 2px}
.fa-seg button{font-size:12px; padding:4px 10px}
.fa-models{gap:3px}
.fa-model-row{display:flex; align-items:center; gap:6px}
.fa-model-cap{font-size:11px; color:var(--fug-muted); min-width:4.4em; text-align:right}
.fa-model-family{display:flex; flex-direction:column; gap:2px; padding-left:6px; border-left:2px solid transparent; border-radius:1px}
.fa-model-family.is-on{border-left-color:var(--fug-accent)}
.fa-model-sub .fa-model-cap{font-size:10.5px}
.fa-model-sub .fa-seg button{font-size:11px; padding:1px 8px}
.fa-model-sub.is-off{opacity:.45}
.fa-seg button:disabled{cursor:not-allowed}
.fa-units{display:grid; grid-template-columns:auto auto auto auto; gap:5px 10px; align-items:center; font-size:12px; color:var(--fug-fg2)}
.fa-units .fug-seg{justify-self:start}
.fa-about{font-size:12px; max-width:220px}
.fa-theme{display:flex; align-items:center; gap:8px; color:var(--fug-fg)}

/* body */
.fa-body{display:flex; align-items:stretch; min-height:560px; flex:1}
.fa-left{flex:0 0 252px; background:var(--fa-panel); border-right:1px solid var(--fug-rule); padding-bottom:12px; min-width:0}
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
.fug-app .fa-plain{margin:4px 0 8px; padding-left:18px; font-size:13px; line-height:1.45}
.fug-app .fa-plain li{margin:2px 0}
.fug-app .fa-leg{white-space:nowrap}
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
.fa-tier-user{background:var(--fa-t-user-bg); color:var(--fa-t-user)}

/* the library: set selectors, source lists, the source browser */
.fa-pairs li.has-sets{display:grid; grid-template-columns:minmax(0,1fr) auto; row-gap:3px}
.fa-pair-name{overflow:hidden; text-overflow:ellipsis}
.fug-app select.fa-set-sel{grid-column:1/-1; width:100%; font-size:11.5px; padding:2px 5px}
.fa-pair-note{grid-column:1/-1; font-size:11px; color:var(--fug-muted); line-height:1.35}
.fa-src-set{font-size:11px; color:var(--fug-muted); margin-top:1px}
.fa-src-note{font-size:11px; color:var(--fug-fg2); margin-top:2px}
.fa-kij{font-weight:400; color:var(--fug-muted)}
.fa-libsrc{list-style:none; margin:4px 0 2px; padding:0; display:grid; gap:5px}
.fa-libsrc li{font-size:11.5px; line-height:1.35; padding-left:9px; border-left:2px solid var(--fug-rule); overflow-wrap:anywhere}
.fa-libsrc a,.fa-src-card a{color:var(--fug-accent); text-decoration:none}
.fa-libsrc a:hover,.fa-src-card a:hover{text-decoration:underline}
.fa-libsrc-meta{font-size:11px; color:var(--fug-muted)}
.fa-libsrc-why{font-size:11px; color:var(--fug-fg2)}
.fa-src-tools{display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; margin-bottom:12px}
.fa-src-tools .fa-src-search{margin:0; flex:1 1 260px; min-width:0}
.fug-app .fa-src-tools svg.fug-ico{width:16px; height:16px; flex:none; display:inline-block; touch-action:auto}
.fa-check-label{display:flex; align-items:center; gap:6px; font-size:12px; color:var(--fug-fg2)}
.fa-feed{display:flex; flex-direction:column; gap:6px}
.fa-flow{display:flex; flex-direction:column; gap:4px; margin-bottom:8px}
.fa-flow .fa-seg{align-self:flex-end}
.fa-plot[data-view="flash"]{max-width:none}
.fa-flash{display:flex; flex-direction:column; gap:10px}
.fa-split{display:flex; height:30px; border-radius:6px; overflow:hidden; border:1px solid var(--fug-rule)}
.fa-split-part{background:color-mix(in srgb, var(--c) 30%, var(--fug-bg)); border-left:3px solid var(--c); display:flex; align-items:center; padding:0 8px; min-width:0}
.fa-split-part.is-next{border-left-width:3px}
.fa-split-part span{font-size:12px; color:var(--fug-fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.fug-app .fa-stream th,.fug-app .fa-stream td{padding:4px 12px 4px 0; white-space:nowrap}
.fug-app .fa-stream td.fug-num,.fug-app .fa-stream th.fug-num{text-align:right}
.fa-stream tbody th{font-weight:500; color:var(--fug-fg2)}
.fa-csv-text{width:100%; font:12px/1.4 ui-monospace,monospace}
.fa-flash .fa-in-actions svg.fug-ico{width:15px; height:15px; max-width:15px; flex:none}
.fa-srcs{display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:12px; align-items:start}
.fa-src-card{border:1px solid var(--fug-rule); border-radius:8px; padding:10px 12px; background:var(--fug-bg); display:grid; gap:5px; align-content:start; min-width:0}
.fa-src-card-head{display:flex; justify-content:space-between; align-items:flex-start; gap:10px}
.fa-src-title{font-weight:600; font-size:13px; line-height:1.35; overflow-wrap:anywhere}
.fa-kind{font-size:10.5px; padding:1px 7px; border-radius:999px; white-space:nowrap; background:var(--fa-t-databank-bg); color:var(--fa-t-databank); flex:none}
.fa-kind-thermoml,.fa-kind-open-access-article{background:var(--fa-t-fitted-bg); color:var(--fa-t-fitted)}
.fa-kind-standard{background:var(--fa-t-standard-bg); color:var(--fa-t-standard)}
.fa-kind-handbook-via-open-compilation{background:var(--fa-t-predicted-bg); color:var(--fa-t-predicted)}
.fa-kind-user{background:var(--fa-t-user-bg); color:var(--fa-t-user)}
.fa-src-dl{display:grid; grid-template-columns:auto minmax(0,1fr); gap:2px 10px; margin:2px 0 0; font-size:11.5px}
.fa-src-dl dt{color:var(--fug-muted)}
.fa-src-dl dd{margin:0; color:var(--fug-fg2); overflow-wrap:anywhere}
.fa-src-uses{font-size:11.5px; color:var(--fug-fg2)}
.fa-src-uses summary{cursor:pointer; color:var(--fug-fg); font-weight:500}
.fa-src-uses ul{margin:4px 0 0; padding-left:16px; display:grid; gap:3px; overflow-wrap:anywhere}
.fa-src-uses b{font-weight:600; color:var(--fug-fg)}
.fa-src-id{font-size:10.5px; color:var(--fug-muted)}
.fa-src-id code{font-size:inherit}
.fa-sets-cell{color:var(--fug-accent)}
.fa-plot[data-view="sources"]{max-width:none}
.fug-app[data-size="narrow"] .fa-srcs{grid-template-columns:minmax(0,1fr)}
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

/* panel headings */
.fa-panel-head h2{font-size:12.5px; font-weight:600; margin:0; color:var(--fug-fg)}
.fa-left .fa-panel-head .fa-count{font-size:11.5px}

/* Inputs panel: the components of the current view, each with its role; conditions; pairs */
.fa-in-sec{padding:4px 12px 10px}
.fa-in-sec + .fa-in-sec{border-top:1px solid var(--fug-rule); padding-top:10px}
.fa-in-sec h3{font-size:12px; font-weight:600; margin:0 0 6px; color:var(--fug-fg)}
.fa-in-hint{font-size:11.5px; color:var(--fug-fg2); margin:0 0 8px; line-height:1.4}
.fa-in-sec .fa-in-hint:last-child{margin-bottom:0}
.fa-slots{display:grid; gap:8px}
.fa-slot{display:grid; gap:3px; background:var(--fug-bg); border:1px solid var(--fug-rule); border-radius:7px; padding:6px 7px 7px}
.fa-slot label{display:flex; align-items:center; gap:7px; font-size:12px; color:var(--fug-fg); font-weight:500}
.fa-slot-role{margin-left:auto; font-weight:400; font-size:11px; color:var(--fug-muted); text-align:right}
.fug-app .fa-slot select,.fug-app .fa-slot .fug-pick-in{width:100%; font-size:13px; padding:4px 6px}
.fa-slot.is-bad{border-color:var(--fa-bad)}
.fa-slot.is-bad label{color:var(--fa-bad)}
.fug-app .fa-slot.is-bad select{border-color:var(--fa-bad)}
.fa-problems ul{margin:8px 0 0; padding:7px 10px 7px 24px; background:var(--fug-warn-bg); color:var(--fug-warn-fg); border-radius:6px; font-size:11.5px; display:grid; gap:3px; line-height:1.4}
.fa-in-actions{display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; align-items:center}
.fug-app .fa-examples{flex:1 1 120px; font-size:12px}
.fa-mini{display:inline-flex; align-items:center; gap:5px; border:1px solid var(--fug-rule); background:var(--fug-bg); color:var(--fug-fg); border-radius:6px;
  padding:3px 9px 3px 7px; font-size:12px; cursor:pointer}
.fa-mini:hover:not(:disabled){border-color:var(--fug-accent); color:var(--fug-accent)}
.fa-mini:disabled{opacity:.45; cursor:default}
.fa-mini .fug-ico{flex:none}
.fa-list .fa-chips{padding:0}
.fa-add{display:block; margin-top:6px}
.fug-app .fa-add select{width:100%}
.fa-left .fa-field{display:grid; grid-template-columns:minmax(0,1fr) auto; margin-bottom:6px}
.fa-left .fa-field small{display:block; color:var(--fug-muted)}
.fa-fixed{display:flex; align-items:baseline; gap:8px; font-size:13px; margin-bottom:4px}
.fa-pairs ul{padding:0; margin-top:6px}
.fa-pairs summary{font-size:12px; font-weight:600; cursor:pointer; color:var(--fug-fg)}
.fa-pairs summary .fa-count{font-weight:400}
.fa-pairs .fa-in-hint{margin-top:6px}

/* canvas title */
.fa-crumb{font-size:11.5px; color:var(--fug-muted); margin-bottom:1px}
.fa-role-tag{display:inline-block; vertical-align:3px; font-size:11px; font-weight:500; color:var(--fa-pressed-fg); background:var(--fa-pressed);
  border:1px solid var(--fa-pressed-edge); border-radius:999px; padding:0 8px; margin-right:8px}
/* Flowsheet workspace (flowsheet-view.js) */
.fs-wrap{position:relative}
.fs-canvas{display:block; width:100%; height:auto; min-height:320px; max-height:620px; touch-action:none; user-select:none; background:
  radial-gradient(circle, var(--fug-rule) 1px, transparent 1.2px) 0 0/20px 20px}
.fs-shape{fill:var(--fug-bg); stroke:var(--fug-fg); stroke-width:1.6}
.fs-detail{fill:none; stroke:var(--fug-fg); stroke-width:1.3; opacity:.7}
.fs-block{cursor:grab}
.fs-block:focus{outline:none}
.fs-block:focus-visible .fs-shape,.fs-block.is-sel .fs-shape{stroke:var(--fug-accent); stroke-width:2.6}
.fs-block.is-incomplete .fs-shape{stroke-dasharray:5 3}
.fs-warn-dot{fill:#d9822b; stroke:var(--fug-bg); stroke-width:1.5}
.fs-name{font-size:12px; font-weight:600; fill:var(--fug-fg)}
.fs-line{fill:none; stroke:var(--fug-fg2, #555); stroke-width:1.6}
.fs-hit{fill:none; stroke:transparent; stroke-width:12; cursor:pointer}
.fs-stream.is-sel .fs-line{stroke:var(--fug-accent); stroke-width:2.6}
.fs-stream.is-tear .fs-line{stroke-dasharray:6 4}
.fs-arrow{fill:var(--fug-fg2, #555)}
.fs-label{font-size:10.5px; fill:var(--fug-fg2, #555); paint-order:stroke; stroke:var(--fug-halo); stroke-width:3px}
.fs-handle{fill:var(--fug-bg); stroke:var(--fug-accent); stroke-width:1.6; cursor:crosshair}
.fs-handle.is-end{fill:var(--fug-bg); stroke:var(--fug-fg2); stroke-width:1.3}
.fs-handle:hover{fill:var(--fug-accent)}
.fa-field.fa-field-stack{display:grid; grid-template-columns:1fr; gap:4px}
.fa-field.fa-field-stack select{width:100%}
.fs-block.is-failed .fs-shape{stroke:#c0392b; stroke-width:2.6}
.fa-btn.is-locked{opacity:.5}
.fa-canvas-grid{display:grid; grid-template-columns:repeat(2, auto); gap:2px 4px}
.fa-soon-grid{display:grid; grid-template-columns:repeat(3, auto); gap:2px 4px}
.fs-wrap{overflow:auto}
.fs-port-in{fill:var(--fug-bg); stroke:var(--fug-fg2); stroke-width:1.4}
.fs-port-in.is-open{stroke:var(--fug-accent)}
.fs-canvas.is-connecting .fs-port-in{opacity:.35}
.fs-canvas.is-connecting .fs-port-in.is-target{opacity:1; fill:var(--fug-accent); stroke:var(--fug-accent); stroke-width:7; stroke-opacity:.25}
.fs-port-out{fill:var(--fug-accent); stroke:var(--fug-bg); stroke-width:1.2; cursor:crosshair}
.fs-port-out:hover{stroke:var(--fug-accent); stroke-width:6; stroke-opacity:.3}
.fs-port-label{font-size:9.5px; fill:var(--fug-muted); pointer-events:none}
.fs-q{fill:none; stroke:#c0392b; stroke-width:1.4; stroke-dasharray:4 3}
.fs-qarrow{fill:#c0392b}
.fs-qlabel{font-size:10px; fill:#c0392b; paint-order:stroke; stroke:var(--fug-halo); stroke-width:3px}
.fs-drag{pointer-events:none; fill:none; stroke:var(--fug-accent); stroke-width:1.6; stroke-dasharray:4 3}
.fs-empty-hint{position:absolute; inset:auto 0 45% 0; text-align:center; color:var(--fug-fg2); font-size:13px; pointer-events:none}
.fs-tables h3{font-size:13px; margin:14px 0 6px}
.fa-dof{font-size:12px; border-radius:6px; padding:6px 8px; margin:6px 0; display:flex; gap:6px; align-items:flex-start}
.fa-dof.is-ok{background:color-mix(in srgb, #2e9a5b 14%, transparent); color:inherit}
.fa-dof.is-bad{background:color-mix(in srgb, #d9822b 16%, transparent); color:inherit}
.fa-dof-list{margin:4px 0 0; padding-left:18px; font-size:12px; display:grid; gap:3px}
.fa-link{background:none; border:0; padding:0; color:var(--fug-accent); text-decoration:underline; cursor:pointer; font:inherit}
.fa-frac-row{display:flex; flex-wrap:wrap; gap:6px; margin:4px 0}
.fa-frac{display:flex; align-items:center; gap:4px; font-size:12px}
.fa-frac-name{font-size:12px; font-weight:600; margin-top:6px}
.fa-fs-model{display:grid; gap:3px; margin:6px 0}
.fa-paste{margin-top:8px}
.fa-paste summary{cursor:pointer; font-size:12.5px; color:var(--fug-fg2)}
.fa-restore{display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px; font-size:12.5px; padding:8px 10px; margin:0 0 12px; border-radius:8px; background:color-mix(in srgb, var(--fug-accent) 10%, transparent)}
.fa-store-list{list-style:none; margin:6px 0 0; padding:0; display:grid; gap:4px}
.fa-store-list li{display:flex; align-items:center; gap:8px; font-size:12.5px}
.fa-store-list .fa-store-name{font-weight:600}
.fa-store-list small{color:var(--fug-muted); margin-right:auto}
.fa-chip-x{background:none; border:0; cursor:pointer; font-size:14px; line-height:1; padding:0 2px; color:inherit}
.fa-need{max-width:520px; margin:32px auto; border:1px dashed var(--fug-rule); border-radius:10px; padding:18px 20px; background:var(--fa-panel); font-size:13px}
.fa-need h3{margin:0 0 8px; font-size:14px; font-weight:600}
.fa-need ul{margin:0 0 10px; padding-left:18px; display:grid; gap:4px; color:var(--fug-fg)}
.fa-need p{margin:0 0 10px; color:var(--fug-fg2); font-size:12.5px}

/* results */
.fa-result-card{display:grid; gap:6px; padding-bottom:10px; border-bottom:1px solid var(--fug-rule)}
.fa-result-main{display:flex; justify-content:space-between; align-items:baseline; gap:10px; font-size:12.5px; color:var(--fug-fg2)}
.fa-provenance .fa-mini{font-size:11.5px; padding:2px 8px 2px 6px}
.fa-slot-name{white-space:nowrap}

/* drawer: Library, Sources, Settings over the workspace; the navigation bar stays live */
.fa-stage{position:relative; display:flex; flex-direction:column; flex:1; min-height:0}
.fa-layer{position:absolute; inset:0; z-index:40}
.fa-scrim{position:absolute; inset:0; background:rgba(14,22,31,.36)}
.fa-drawer{position:sticky; top:0; margin-left:auto; width:min(640px, 100%); height:min(100%, 100vh); display:flex; flex-direction:column;
  background:var(--fug-bg); border-left:1px solid var(--fug-rule); box-shadow:-14px 0 36px rgba(8,16,24,.22); outline:none}
.fa-drawer-head{display:flex; align-items:flex-start; justify-content:space-between; gap:14px; padding:14px 16px 12px; border-bottom:1px solid var(--fug-rule); background:var(--fa-panel)}
.fa-drawer-head h2{display:flex; align-items:center; gap:8px; margin:0; font-size:16px; font-weight:600}
.fa-drawer-head h2 .fug-ico{color:var(--fug-accent)}
.fa-drawer-head p{margin:3px 0 0; font-size:12.5px; color:var(--fug-fg2)}
.fa-drawer-head .fa-back-note{font-size:11.5px; color:var(--fug-muted)}
.fa-close{display:inline-flex; align-items:center; gap:6px; flex:none; border:1px solid var(--fug-rule); background:var(--fug-bg); color:var(--fug-fg);
  border-radius:7px; padding:5px 12px 5px 9px; font-size:12.5px; font-weight:500; cursor:pointer}
.fa-close:hover{border-color:var(--fug-accent); color:var(--fug-accent)}
.fa-drawer-body{flex:1; overflow:auto; padding:14px 16px 20px; overscroll-behavior:contain}
.fa-drawer .fa-srcs{grid-template-columns:minmax(0,1fr)}
.fa-src-summary{margin:0 0 12px; font-size:12.5px; color:var(--fug-fg2)}
.fa-dev{margin-top:14px; font-size:12px}
.fa-dev summary{cursor:pointer; font-weight:500}
.fa-dgrid{display:grid; gap:18px}
.fa-dsec h3{font-size:12.5px; font-weight:600; margin:0 0 8px}
.fa-dsec p{margin:0 0 8px; font-size:12.5px; color:var(--fug-fg2)}
.fa-rules{display:grid; gap:6px}
.fa-rule{display:grid; gap:1px; text-align:left; border:1px solid var(--fug-rule); background:var(--fug-bg); color:var(--fug-fg); border-radius:7px; padding:8px 11px; cursor:pointer; font-size:12.5px}
.fa-rule span{font-size:11.5px; color:var(--fug-fg2)}
.fa-rule:hover{border-color:var(--fug-accent)}
.fa-rule[aria-pressed="true"]{background:var(--fa-pressed); border-color:var(--fa-pressed-edge); color:var(--fa-pressed-fg)}
.fa-rule[aria-pressed="true"] span{color:var(--fa-pressed-fg)}
@media (prefers-reduced-motion: no-preference){
  .fa-layer:not([hidden]) .fa-drawer{animation:fa-in .16s ease-out}
  .fa-layer:not([hidden]) .fa-scrim{animation:fa-fade .16s ease-out}
}
@keyframes fa-in{from{transform:translateX(24px); opacity:.6}}
@keyframes fa-fade{from{opacity:0}}

/* status bar */
.fa-status{display:flex; align-items:stretch; background:var(--fa-status); border-top:1px solid var(--fug-rule); font-size:11.5px; color:var(--fug-fg2); min-height:26px}
.fa-cell{padding:4px 11px; border-right:1px solid var(--fug-rule); white-space:nowrap; display:flex; align-items:center; gap:6px}
.fa-cell:last-child{border-right:0}
.fa-grow{flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; display:block; line-height:18px}
.fa-state i{display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--fa-ok)}
.fa-state.is-busy i{background:var(--fa-busy)}
.fa-state.is-err i{background:var(--fa-bad)}
.fa-state.is-wait i{background:transparent; border:1.5px solid var(--fa-busy)}

/* mid width: short workspace names, icon-only utilities, the results move under the canvas */
.fug-app[data-size="mid"] .fa-nav-long,.fug-app[data-size="narrow"] .fa-nav-long{display:none}
.fug-app[data-size="mid"] .fa-nav-short,.fug-app[data-size="narrow"] .fa-nav-short{display:inline}
.fug-app[data-size="mid"] .fa-util-label,.fug-app[data-size="narrow"] .fa-util-label{display:none}
.fug-app[data-size="mid"] .fa-titlebar{gap:12px}
.fug-app[data-size="mid"] .fa-body{flex-wrap:wrap}
.fug-app[data-size="mid"] .fa-canvas{flex-basis:calc(100% - 253px)}
.fug-app[data-size="mid"].fa-no-left .fa-canvas{flex-basis:100%}
.fug-app[data-size="mid"] .fa-right{flex:1 1 100%; border-left:0; border-top:1px solid var(--fug-rule); display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); align-items:start}
.fug-app[data-size="mid"] .fa-right>.fa-panel-head{grid-column:1/-1}
.fug-app[data-size="mid"] .fa-inspector-extra{padding-top:0}

.fug-app[data-size="mid"] .fa-ribbon{flex-wrap:wrap; row-gap:6px; overflow-x:visible}
.fug-app[data-size="mid"] .fa-group{border-right:0; border-left:1px solid var(--fa-edge); margin-left:-1px}

/* narrow (phones): the workspaces get their own row of four, toolbar groups and panels stack */
.fug-app[data-size="narrow"]{border-radius:0; border-left:0; border-right:0}
.fug-app[data-size="narrow"] .fa-titlebar{flex-wrap:wrap; gap:0 6px; padding:0}
.fug-app[data-size="narrow"] .fa-brand{padding:8px 0 6px 12px}
.fug-app[data-size="narrow"] .fa-utils{border-left:0; padding-left:0}
.fug-app[data-size="narrow"] .fa-util-btn{padding:6px 8px}
.fug-app[data-size="narrow"] .fa-collapse{margin-right:4px}
.fug-app[data-size="narrow"] .fa-nav{order:3; flex:1 1 100%; display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:2px; padding:0 4px}
.fug-app[data-size="narrow"] .fa-nav-btn{flex-direction:column; gap:2px; padding:6px 2px 7px; font-size:11.5px; justify-content:center; min-width:0}
.fug-app[data-size="narrow"] .fa-nav-short{overflow:hidden; text-overflow:ellipsis; max-width:100%}
.fug-app[data-size="narrow"] .fa-ribbon{flex-direction:column; overflow:visible; min-height:0; padding:4px 10px}
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
.fug-app[data-size="narrow"] .fa-canvas-bar{flex-wrap:wrap}
.fug-app[data-size="narrow"] .fa-right{order:2}
.fug-app[data-size="narrow"] .fa-status{flex-wrap:wrap}
.fug-app[data-size="narrow"] .fa-hide-narrow,.fug-app[data-size="narrow"] .fa-grow{display:none}
.fug-app[data-size="narrow"] .fa-units{grid-template-columns:auto auto}
.fug-app[data-size="narrow"] .fa-field{justify-content:flex-start}
.fug-app[data-size="narrow"] .fa-drawer{width:100%; border-left:0}
.fug-app[data-size="narrow"] .fa-drawer-head{flex-direction:column-reverse; gap:8px}
.fug-app[data-size="narrow"] .fa-close{align-self:flex-end}
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
