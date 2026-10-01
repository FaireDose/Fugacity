// Henry's law constants of gases in water (src/thermo/henry.js, src/data/henry.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { henry, henryInfo, gasSolubility, HENRY_GASES } from "../src/index.js";

// IAPWS G7-04 (2004), table 6: check values of ln(kH / 1 GPa) for gases in H2O.
// http://www.iapws.org/relguide/HenGuide.html. Values above the gas's Tmax are omitted
// (C2H6 at 500 and 600 K: Tmax = 473.46 K).
const IAPWS_CHECK = {
  hydrogen: { 300: 1.9702, 400: 1.8464, 500: 1.0513, 600: -0.1848 },
  nitrogen: { 300: 2.1716, 400: 2.3509, 500: 1.4842, 600: 0.1647 },
  oxygen: { 300: 1.5024, 400: 1.8832, 500: 1.1630, 600: -0.0276 },
  methane: { 300: 1.4034, 400: 1.7946, 500: 1.0342, 600: -0.2209 },
  ethane: { 300: 1.1418, 400: 1.8495 },
};

test("Henry's constants reproduce the IAPWS G7-04 check values (table 6)", () => {
  for (const [gas, rows] of Object.entries(IAPWS_CHECK)) {
    for (const [T, want] of Object.entries(rows)) {
      const got = Math.log(henry(gas, "water", +T) / 1e6); // kPa -> GPa
      assert.ok(Math.abs(got - want) < 6e-5, `${gas} ${T} K: ln(kH/GPa) = ${got.toFixed(5)}, IAPWS ${want}`);
    }
  }
});

// Unit conversion used for the ethylene entry (Sander 2023 compilation):
// Hxp = Hcp * M_w / rho_w with rho_w = 997 kg/m3, so H (p = H x) = rho_w / (M_w Hcp).
// Sander (2023), table 2: Hcp = 1 mol/(m3 Pa) corresponds to Hxp = 1.83089 atm^-1.
test("Henry unit conversion: Hcp in mol/(m3 Pa) to H in kPa, as in Sander (2023)", () => {
  const M_w = 0.01801528, rho = 997;
  const H_kPa = rho / (M_w * 1) / 1000;              // Hcp = 1 mol/(m3 Pa)
  const Hxp_per_atm = 101.325 / H_kPa;               // x / p, p in atm
  assert.ok(Math.abs(Hxp_per_atm - 1.83089) < 1e-5, `${Hxp_per_atm}`);
  // the engine's ethylene value at 298.15 K, recomputed by hand from the stored fit
  const Hcp = Math.exp(-175.14932 + 9028.23984 / 298.15 + 23.67665 * Math.log(298.15));
  const want = rho / (M_w * Hcp) / 1000;
  assert.ok(Math.abs(henry("ethylene", "water", 298.15) / want - 1) < 1e-12);
});

// Independent measurements, as three-parameter fits Hcp = exp(A + B/T + C ln T) mol/(m3 Pa)
// given in R. Sander, Compilation of Henry's law constants v5.0.0, Atmos. Chem. Phys. 23
// (2023) 10901, CC BY 4.0, https://henrys-law.org (notes on each gas's page).
const MEASURED = {
  oxygen: {
    "Rettich et al. 2000 (note 8), 274-328 K": { fit: [-179.13838, 8707.18054, 24.33474], T: [278.15, 298.15, 313.15, 328.15], tol: 0.015 },
    "Morrison & Billett 1952 (note 18)": { fit: [-167.89318, 8254.03507, 22.62745], T: [288.15, 298.15, 313.15, 328.15], tol: 0.035 },
  },
  nitrogen: {
    "Rettich et al. 1984 (note 56), 278-323 K": { fit: [-187.67959, 8903.42739, 25.60079], T: [278.15, 298.15, 313.15, 323.15], tol: 0.02 },
    "Morrison & Billett 1952 (note 58)": { fit: [-193.68170, 9249.62932, 26.45116], T: [288.15, 298.15, 313.15, 328.15], tol: 0.035 },
  },
  ethylene: {
    "Maassen 1995 (note 307)": { fit: [-187.57834, 9639.75167, 25.50544], T: [273.15, 298.15, 323.15, 353.15], tol: 0.075 },
    "Reichl 1995 (note 308)": { fit: [-166.44396, 8613.39370, 22.39721], T: [273.15, 298.15, 323.15, 353.15], tol: 0.03 },
  },
};
const fromHcp = ([A, B, C], T) => 997 / (0.01801528 * Math.exp(A + B / T + C * Math.log(T))) / 1000;

test("Henry's constants agree with independent measurements (Sander compilation)", () => {
  const lines = [];
  for (const [gas, sets] of Object.entries(MEASURED)) {
    for (const [name, s] of Object.entries(sets)) {
      for (const T of s.T) {
        const H = henry(gas, "water", T), ref = fromHcp(s.fit, T);
        const dev = H / ref - 1;
        lines.push(`${gas} ${T} K: H = ${(H / 1000).toFixed(0)} MPa, ${name}: ${(ref / 1000).toFixed(0)} MPa (${(100 * dev).toFixed(2)} %)`);
        assert.ok(Math.abs(dev) < s.tol, lines[lines.length - 1]);
      }
    }
  }
});

test("gas solubility x = p / H, with range checks and sources", () => {
  assert.deepEqual(HENRY_GASES, ["hydrogen", "nitrogen", "oxygen", "methane", "ethane", "ethylene"]);
  const p = 21.0; // kPa
  assert.equal(gasSolubility("O2", 298.15, p), p / henry("oxygen", "water", 298.15));
  assert.ok(gasSolubility("oxygen", 298.15, p) > gasSolubility("nitrogen", 298.15, p)); // O2 more soluble than N2
  assert.throws(() => henry("oxygen", "water", 250), /outside the range/);
  assert.throws(() => henry("ethane", "water", 500), /outside the range/);
  assert.throws(() => henry("ethylene", "water", 360), /outside the range/);
  assert.throws(() => henry("benzene", "water", 300), /No Henry's law constant/);
  assert.throws(() => gasSolubility("oxygen", 300, -1), /non-negative/);
  for (const g of HENRY_GASES) {
    const i = henryInfo(g);
    assert.ok(i.source && i.tier && i.Tmin_K < 298.15 && i.Tmax_K > 298.15, g);
  }
});
