/**
 * Icons for the workbench: small line drawings on a 24 x 24 grid, drawn for Fugacity
 * (most are tiny phase diagrams). They use currentColor, so they follow the theme;
 * an element with class "a" takes the accent colour.
 */
import { s } from "./dom.js";

const P = {
  // a T-x-y lens: bubble and dew curves between the two pure boiling points
  logo: '<path d="M4 17 C8 16.5 14 13 20 7" /><path d="M4 17 C9 12 13 8.5 20 7" class="a"/><circle cx="4" cy="17" r="1.6" fill="currentColor" stroke="none"/><circle cx="20" cy="7" r="1.6" fill="currentColor" stroke="none"/>',
  flask: '<path d="M9.5 3.5h5M10.5 3.5v5.2L5.2 18.2a1.6 1.6 0 0 0 1.4 2.3h10.8a1.6 1.6 0 0 0 1.4-2.3L13.5 8.7V3.5"/><path d="M7.4 14.5h9.2" class="a"/>',
  txy: '<path d="M4 3.5v16.5h16.5"/><path d="M5.5 7 C10 7.5 15 12 19 17" class="a"/><path d="M5.5 7 C8 11 13 15.5 19 17"/>',
  ternary: '<path d="M12 3.5 21 19.5H3z"/><path d="M7 15.5C10 13 13 12.5 17 15" class="a"/><path d="M9.5 11.5C12 10.5 14 11 15.5 12.5" class="a"/>',
  azeo: '<path d="M4 3.5v16.5h16.5"/><path d="M5.5 9 C8 13 10 14.5 12 14.5 S16 12 19 8" class="a"/><path d="M5.5 9 C8 11.5 10 14.3 12 14.5 S17 10 19 8"/><circle cx="12" cy="14.5" r="1.7" fill="currentColor" stroke="none"/>',
  residue: '<path d="M12 3.5 21 19.5H3z"/><path d="M6.5 17.5C9 11 13 9.5 15.5 9.8" class="a"/><path d="m13.6 8.4 2.2 1.4-1.6 2" class="a"/>',
  isotherm: '<path d="M12 3.5 21 19.5H3z"/><path d="M6.2 14c2-1.2 3.6-.2 5.4-1s3.6-.9 6 .6M8.4 10c1.5-.8 2.6-.1 3.8-.6s2.4-.6 3.6.3" class="a"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5" class="a"/><path d="m3.5 16.3 8.5 4.5 8.5-4.5"/>',
  gauge: '<path d="M4.2 16.5a8.2 8.2 0 1 1 15.6 0"/><path d="m12 13.5 4-4.5" class="a"/><circle cx="12" cy="13.5" r="1.4"/><path d="M7 19.5h10"/>',
  thermo: '<path d="M10 14.2V5a2 2 0 1 1 4 0v9.2a3.6 3.6 0 1 1-4 0z"/><path d="M12 9v7" class="a"/>',
  // a van der Waals-type isotherm of a cubic equation of state
  cubic: '<path d="M4 3.5v16.5h16.5"/><path d="M5.5 5 C6.5 13 7.5 14.5 9 14.5 S11.5 9.5 13 9.5 S15 13 20 15.5" class="a"/><path d="M8 12.6h10" stroke-dasharray="1.6 1.8"/>',
  envelope: '<path d="M4 3.5v16.5h16.5"/><path d="M6 18 C9 17 11 13 13 8.5 C14.5 6 16.5 6.5 17.5 9 C18.5 12 18 15 15 18" class="a"/><circle cx="14.6" cy="7.2" r="1.5" fill="currentColor" stroke="none"/>',
  pxy: '<path d="M4 3.5v16.5h16.5"/><path d="M5.5 16.5 C10 15.5 15 11 19 6" class="a"/><path d="M5.5 16.5 C8 11 13 7.5 19 6"/>',
  henry: '<path d="M5.5 8.5v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-10"/><path d="M5.5 12.5c2.2-1 4.2 1 6.5 0s4.3-1 6.5 0" class="a"/><circle cx="10" cy="16.5" r="1.2"/><circle cx="14.2" cy="17.6" r=".9"/><circle cx="12.8" cy="4.8" r="1.3"/><circle cx="9.6" cy="7" r=".9"/>',
  curves: '<path d="M4 3.5v16.5h16.5"/><path d="M5.5 17C10 16 14 12 19.5 5.5" class="a"/><path d="M5.5 13C10 12.5 14 10 19.5 9"/>',
  // a flash drum: feed in at the side, vapour out at the top, liquid at the bottom
  drum: '<rect x="8" y="3.5" width="8" height="17" rx="4"/><path d="M3 12h5"/><path d="M8.2 13.5h7.6" class="a"/><path d="M12 3.5V1.5M12 20.5v2"/>',
  // a sheet of paper with a folded corner (project files)
  file: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/><path d="M9 12.5h6M9 16h6" class="a"/>',
  // flowsheet blocks
  flowsheet: '<rect x="3" y="9" width="5" height="6" rx="1"/><rect x="16" y="4" width="5" height="16" rx="2.5"/><path d="M8 12h8" class="a"/><path d="M21 7h1.5M21 17h1.5"/>',
  feed: '<path d="M3 12h13"/><path d="m12 7.5 4.5 4.5-4.5 4.5" class="a"/><circle cx="19.5" cy="12" r="1.6"/>',
  mixer: '<path d="M5 5v14l14-7z"/><path d="M2 8h3M2 16h3" class="a"/>',
  splitter: '<path d="M19 5v14L5 12z"/><path d="M19 8h3M19 16h3" class="a"/>',
  separator: '<rect x="6" y="3.5" width="12" height="17" rx="1.5"/><path d="m6 17 12-10" class="a"/>',
  heater: '<circle cx="12" cy="12" r="8"/><path d="M6.5 13.5 9 9l3 6 3-6 2.5 4.5" class="a"/>',
  solve: '<path d="M7 5v14l11-7z" class="a"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" class="a"/>',
  column: '<rect x="8.5" y="2.5" width="7" height="19" rx="3.5"/><path d="M8.5 7.5h7M8.5 11h7M8.5 14.5h7" class="a"/><path d="M15.5 4.5h3M15.5 19.5h3M5 12h3.5"/>',
  pump: '<circle cx="11" cy="13" r="7"/><path d="M11 6h9v3" class="a"/><path d="M8 12.5l3-3 3 3" class="a"/><path d="M6 20h10"/>',
  compressor: '<path d="M5 6.5 19 9.5v5L5 17.5z"/><path d="M2 12h3M19 12h3" class="a"/>',
  valve: '<path d="M4 7v10l8-5zM20 7v10l-8-5z"/><path d="M12 12V5M9 5h6" class="a"/>',
  extract: '<rect x="7.5" y="2.5" width="9" height="19" rx="2"/><path d="M7.5 9.5h9M7.5 14.5h9" class="a"/><circle cx="10.5" cy="12" r=".8" fill="currentColor"/><circle cx="13.5" cy="17" r=".8" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/><path d="M10.5 10.5v6M13.5 10.5v6" class="a"/>',
  download: '<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5"/><path d="M4.5 16.5v3h15v-3" class="a"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5v-3a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" class="a"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9h17M3.5 13.5h17M9.5 4.5v15" /><path d="M3.5 9h17" class="a"/>',
  calc: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8 7.5h8" class="a"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01" stroke-width="2.2" stroke-linecap="round"/>',
  // water T-s diagram: saturation dome with an isobar
  dome: '<path d="M4 3.5v16.5h16.5"/><path d="M6 18.5C7.5 10 10 5.5 12 5.5s4.5 4.5 6 13"/><path d="M5.5 16C7 15 7.5 13 8.2 11.5h7.6C17 9 18 6.5 20 4.5" class="a"/>',
  units: '<path d="m4 15.5 11.5-11.5 4.5 4.5L8.5 20z"/><path d="m8 11.5 1.8 1.8M10.5 9l1.8 1.8M13 6.5l1.8 1.8" class="a"/>',
  panelL: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9 4.5v15"/><path d="M5.5 8h1.5M5.5 11h1.5" class="a"/>',
  panelR: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M15 4.5v15"/><path d="M17 8h1.5M17 11h1.5" class="a"/>',
  status: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 16h17"/><path d="M6 18h4" class="a"/>',
  rotate: '<path d="M18.5 12a6.5 6.5 0 1 1-2-4.7"/><path d="M17.5 3.8v4h-4" class="a"/>',
  swap: '<path d="M5 8.5h13m-3-3 3 3-3 3"/><path d="M19 15.5H6m3 3-3-3 3-3" class="a"/>',
  clear: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6m0-6-6 6" class="a"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5" class="a"/>',
  chevronUp: '<path d="m6 14.5 6-6 6 6"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6.5 6.5 11 11m0-11-11 11"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5" class="a"/><path d="M12 7.8h.01" stroke-width="2.4" stroke-linecap="round"/>',
  theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  grid: '<path d="M12 3.5 21 19.5H3z"/><path d="M7.5 11.5h9M5.2 15.5h13.6M9.8 7.5l5.4 12M14.2 7.5l-5.4 12" stroke-width="1"/>',
  check: '<path d="m5.5 12.5 4 4 9-9"/>',
  // a speech bubble: feedback and discussion
  chat: '<path d="M4.5 5.5h15v10.5h-8.5L7 19.5v-3.5H4.5z"/><path d="M8 9.5h8M8 12.5h5" class="a"/>',
  // the library: an open book
  book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13" class="a"/>',
  star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/><path d="M12 8.2v5.3" class="a"/>',
};

/** An icon as an SVG element (24 x 24 grid, drawn at `size` px). */
export function icon(name, size = 20) {
  const svg = s("svg", { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
    "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "fug-ico", focusable: "false" });
  svg.innerHTML = P[name] ?? P.info;
  return svg;
}

export const ICON_NAMES = Object.keys(P);
