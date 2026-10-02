/**
 * Component lookup (layer 1): the components of src/data/components.json by id, name, alias,
 * formula or CAS number. Kept apart from system.js so that the library (library.js) and the
 * systems can both use it.
 */
import componentData from "../data/components.json" with { type: "json" };

/**
 * All components in the databank, as { id, name, formula, cas, activity }.
 * `activity` is true when the component has the data for activity-coefficient (NRTL,
 * UNIQUAC) vapour-liquid equilibria; light gases are described by equations of state.
 */
export function listComponents() {
  return Object.entries(componentData.components).map(([id, c]) => ({
    id, name: c.name, formula: c.formula, cas: c.cas, activity: Boolean(c.uniquac && c.vapourPressure),
  }));
}

const norm = s => String(s).trim().toLowerCase().replace(/[\s_]+/g, " ");

/**
 * Find a component by id, name, alias or CAS number (case-insensitive).
 * @param {string} key
 * @returns {string} component id
 */
export function findComponent(key) {
  const k = norm(key);
  for (const [id, c] of Object.entries(componentData.components)) {
    const names = [id, c.name, c.cas, c.formula, ...(c.aliases || [])].map(norm);
    if (names.includes(k) || names.includes(k.replace(/ /g, "-"))) return id;
  }
  const known = listComponents().map(c => c.name).join(", ");
  throw new Error(`Unknown component "${key}". Available: ${known}.`);
}
