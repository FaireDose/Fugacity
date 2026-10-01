// Checks a Fugacity contribution package (the JSON an AI assistant prepares for a
// contributor). Used by `npm run check-package <file>` and by the tests.
// It checks structure and plausibility only; a reviewer still checks the numbers
// against the source. The person confirms they checked every number with a required
// checkbox in the Data issue form; the old "checked_by_human" field is accepted and ignored.

export const COLUMN_UNITS = {
  T_K: "K", T_C: "°C", P_kPa: "kPa",
  x_1: "mole fraction", x_2: "mole fraction", y_1: "mole fraction", y_2: "mole fraction",
  HE_J_mol: "J/mol", gamma_1: "-", gamma_2: "-", Psat_kPa: "kPa",
};
const KINDS = ["isobaric-txy", "isothermal-px", "isothermal-pxy", "azeotrope", "excess-enthalpy", "pure-vapour-pressure", "lle"];
const TYPES = ["pair-data", "component", "correction", "review"];

/** CAS number format and check digit. */
export function validCas(cas) {
  const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(String(cas));
  if (!m) return false;
  const digits = (m[1] + m[2]).split("").reverse();
  const sum = digits.reduce((s, d, i) => s + Number(d) * (i + 1), 0);
  return sum % 10 === Number(m[3]);
}

/**
 * @param {object} pkg  parsed JSON
 * @param {object} [known]  components.json "components" object, to flag new components
 * @returns {{errors:string[], warnings:string[]}}
 */
export function checkPackage(pkg, known = {}) {
  const errors = [], warnings = [];
  const err = m => errors.push(m), warn = m => warnings.push(m);

  if (pkg.fugacity_package !== 1) err('"fugacity_package" must be 1.');
  if (!TYPES.includes(pkg.type)) err(`"type" must be one of: ${TYPES.join(", ")}.`);
  if (!pkg.summary) err('"summary" is missing: one line describing the contribution.');
  if (!pkg.prepared_with) warn('"prepared_with" is empty: say which assistant helped (ChatGPT, Claude, Gemini, other, or none).');

  // components
  if (!Array.isArray(pkg.components) || pkg.components.length === 0) err('"components" must list the components with name and CAS number.');
  else for (const c of pkg.components) {
    if (!c.name) err("A component has no name.");
    if (!validCas(c.cas)) err(`CAS number "${c.cas}" for ${c.name || "a component"} is not valid (format or check digit). Check it on the NIST Chemistry WebBook.`);
    const inBank = Object.values(known).some(k => k.cas === c.cas);
    if (known && Object.keys(known).length && !inBank) warn(`${c.name} (${c.cas}) is not in the databank yet; the package should include a component entry or a note.`);
  }

  // source
  const s = pkg.source || {};
  if (!s.citation) err('"source.citation" is missing.');
  if (!s.open_copy || !/^https:\/\//.test(s.open_copy)) err('"source.open_copy" must be an https link where anyone can read the numbers for free.');
  if (!s.access) err('"source.access" is missing: say why the source is open (open access and license, ThermoML Archive, NIST WebBook, ...).');
  if (!s.tables) warn('"source.tables" is empty: name the table or figure the numbers come from.');

  // data
  const blocks = Array.isArray(pkg.data) ? pkg.data : pkg.data ? [pkg.data] : [];
  if (pkg.type === "pair-data" && blocks.length === 0) err('"data" is missing.');
  blocks.forEach((b, k) => {
    const where = `data[${k}]`;
    if (!KINDS.includes(b.kind)) err(`${where}.kind must be one of: ${KINDS.join(", ")}.`);
    if (!Array.isArray(b.columns) || b.columns.length < 2) { err(`${where}.columns must name at least two columns.`); return; }
    for (const col of b.columns) if (!(col in COLUMN_UNITS)) err(`${where}: unknown column "${col}". Use: ${Object.keys(COLUMN_UNITS).join(", ")}.`);
    if (!Array.isArray(b.rows) || b.rows.length === 0) { err(`${where}.rows is empty.`); return; }
    const isothermal = b.kind.startsWith("isothermal") || b.kind === "excess-enthalpy";
    if (isothermal && !(b.conditions && (b.conditions.T_K || b.conditions.T_C))) err(`${where}: give the temperature in "conditions" (T_K or T_C).`);
    if (b.kind === "isobaric-txy" && !(b.conditions && b.conditions.P_kPa)) err(`${where}: give the pressure in "conditions" (P_kPa).`);
    b.rows.forEach((r, i) => {
      if (!Array.isArray(r) || r.length !== b.columns.length) { err(`${where}.rows[${i}] has ${Array.isArray(r) ? r.length : 0} values, expected ${b.columns.length}.`); return; }
      r.forEach((v, j) => {
        const col = b.columns[j];
        if (typeof v !== "number" || !Number.isFinite(v)) err(`${where}.rows[${i}] ${col} is not a number.`);
        else if (/^[xy]_/.test(col) && (v < 0 || v > 1)) err(`${where}.rows[${i}] ${col} = ${v} is outside 0..1.`);
        else if (col === "T_K" && (v < 50 || v > 1500)) err(`${where}.rows[${i}] T_K = ${v} is implausible.`);
        else if ((col === "P_kPa" || col === "Psat_kPa") && v <= 0) err(`${where}.rows[${i}] ${col} must be positive.`);
      });
    });
    if (b.rows.length < 5 && b.kind !== "azeotrope") warn(`${where} has only ${b.rows.length} rows.`);
  });

  if (pkg.type === "component" && !pkg.component_entry) err('A "component" package needs "component_entry" in the format of src/data/components.json.');
  return { errors, warnings };
}
