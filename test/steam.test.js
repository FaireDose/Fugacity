// Steam tables: IAPWS-IF97 and the IAPWS viscosity and thermal-conductivity releases.
//
// 1. Every computer-program verification table of the three releases, to the printed
//    precision (relative 1e-8 for values printed with 9 significant digits):
//      IAPWS R7-97(2012) (IF97): Tables 5, 15, 33, 35, 36, 42 and the B23 check of section 4
//        https://iapws.org/technical-guidance/release/IF97-Rev
//      IAPWS R12-08 (viscosity): Tables 4 and 5
//        https://iapws.org/technical-guidance/release/viscosity
//      IAPWS R15-11 (thermal conductivity): Tables 4, 5 (lambda0, lambda1), 7, 8, 9
//        https://iapws.org/technical-guidance/release/ThCond
//    Values are written as printed (mantissa x power of ten).
// 2. An independent cross-check on a (T, P) grid over all regions against CoolProp 8.0.0
//    (IF97::Water, and IAPWS-95 HEOS::Water as a sanity check):
//    validation/data/iapws/coolprop_grid.json, made by validation/python/make_iapws_fixtures.py.
// 3. pure("water").props() after conversion to molar units and the engine's enthalpy reference.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { steam, steamSat, pure } from "../src/index.js";
import { region3, stateTP, psatMPa, tsatMPa, pB23, tB23, hIdealGas } from "../src/thermo/iapws/if97.js";
import { viscosity, thermalConductivityParts } from "../src/thermo/iapws/transport.js";

const grid = JSON.parse(fs.readFileSync(new URL("../validation/data/iapws/coolprop_grid.json", import.meta.url)));

function rel(got, want, tol, what) {
  const d = Math.abs(got / want - 1);
  assert.ok(d <= tol, `${what}: got ${got}, want ${want} (relative deviation ${d.toExponential(2)} > ${tol})`);
}

// ---------------------------------------------------------------------------------------
// IAPWS-IF97 verification tables
// ---------------------------------------------------------------------------------------

// Columns: T (K), p (MPa), v (m3/kg), h (kJ/kg), u (kJ/kg), s (kJ/kg/K), cp (kJ/kg/K), w (m/s)
const TABLE5_REGION1 = [
  [300, 3, 0.100215168e-2, 0.115331273e3, 0.112324818e3, 0.392294792, 0.417301218e1, 0.150773921e4],
  [300, 80, 0.971180894e-3, 0.184142828e3, 0.106448356e3, 0.368563852, 0.401008987e1, 0.163469054e4],
  [500, 3, 0.120241800e-2, 0.975542239e3, 0.971934985e3, 0.258041912e1, 0.465580682e1, 0.124071337e4],
];
const TABLE15_REGION2 = [
  [300, 0.0035, 0.394913866e2, 0.254991145e4, 0.241169160e4, 0.852238967e1, 0.191300162e1, 0.427920172e3],
  [700, 0.0035, 0.923015898e2, 0.333568375e4, 0.301262819e4, 0.101749996e2, 0.208141274e1, 0.644289068e3],
  [700, 30, 0.542946619e-2, 0.263149474e4, 0.246861076e4, 0.517540298e1, 0.103505092e2, 0.480386523e3],
];
const TABLE42_REGION5 = [
  [1500, 0.5, 0.138455090e1, 0.521976855e4, 0.452749310e4, 0.965408875e1, 0.261609445e1, 0.917068690e3],
  [1500, 30, 0.230761299e-1, 0.516723514e4, 0.447495124e4, 0.772970133e1, 0.272724317e1, 0.928548002e3],
  [2000, 30, 0.311385219e-1, 0.657122604e4, 0.563707038e4, 0.853640523e1, 0.288569882e1, 0.106736948e4],
];

for (const [name, table, region] of [["Table 5 (region 1)", TABLE5_REGION1, 1],
  ["Table 15 (region 2)", TABLE15_REGION2, 2], ["Table 42 (region 5)", TABLE42_REGION5, 5]]) {
  test(`IF97 ${name} verification values`, () => {
    for (const [T, p, v, h, u, s, cp, w] of table) {
      const st = steam(T, p * 1000);
      assert.equal(st.region, region);
      const at = `${T} K, ${p} MPa`;
      rel(st.v_m3_kg, v, 1e-8, `v ${at}`);
      rel(st.h_kJ_kg, h, 1e-8, `h ${at}`);
      rel(st.u_kJ_kg, u, 1e-8, `u ${at}`);
      rel(st.s_kJ_kgK, s, 1e-8, `s ${at}`);
      rel(st.cp_kJ_kgK, cp, 1e-8, `cp ${at}`);
      rel(st.w_m_s, w, 1e-8, `w ${at}`);
    }
  });
}

// Table 33 (region 3): T (K), rho (kg/m3), p (MPa), h, u, s, cp, w
const TABLE33_REGION3 = [
  [650, 500, 0.255837018e2, 0.186343019e4, 0.181226279e4, 0.405427273e1, 0.138935717e2, 0.502005554e3],
  [650, 200, 0.222930643e2, 0.237512401e4, 0.226365868e4, 0.485438792e1, 0.446579342e2, 0.383444594e3],
  [750, 500, 0.783095639e2, 0.225868845e4, 0.210206932e4, 0.446971906e1, 0.634165359e1, 0.760696041e3],
];

test("IF97 Table 33 (region 3) verification values", () => {
  for (const [T, rho, p, h, u, s, cp, w] of TABLE33_REGION3) {
    const st = region3(rho, T);
    const at = `${T} K, ${rho} kg/m3`;
    rel(st.p, p, 1e-8, `p ${at}`);
    rel(st.h, h, 1e-8, `h ${at}`);
    rel(st.u, u, 1e-8, `u ${at}`);
    rel(st.s, s, 1e-8, `s ${at}`);
    rel(st.cp, cp, 1e-8, `cp ${at}`);
    rel(st.w, w, 1e-8, `w ${at}`);
    // The (T, P) interface finds the same density by solving the region-3 equation.
    const back = steam(T, st.p * 1000);
    assert.equal(back.region, 3);
    rel(back.rho_kg_m3, rho, 1e-11, `density from (T, P) at ${at}`);
  }
});

test("IF97 Tables 35 and 36 (saturation line) and the B23 boundary", () => {
  for (const [T, ps] of [[300, 0.353658941e-2], [500, 0.263889776e1], [600, 0.123443146e2]]) rel(psatMPa(T), ps, 1e-8, `psat(${T})`);
  for (const [p, Ts] of [[0.1, 0.372755919e3], [1, 0.453035632e3], [10, 0.584149488e3]]) rel(tsatMPa(p), Ts, 1e-8, `Tsat(${p})`);
  // Section 4: T = 0.623150000e3 K, p = 0.165291643e2 MPa
  rel(pB23(0.623150000e3), 0.165291643e2, 1e-8, "B23 p(T)");
  rel(tB23(0.165291643e2), 0.623150000e3, 1e-8, "B23 T(p)");
});

test("IF97 region limits: outside the range of validity, steam() throws", () => {
  assert.throws(() => steam(273.0, 101.325), /273.15 K/);
  assert.throws(() => steam(2300, 101.325), /2273.15 K/);
  assert.throws(() => steam(500, 100001), /100 MPa/);
  assert.throws(() => steam(1200, 50001), /50 MPa/);
  assert.throws(() => steam(500, 0), /positive pressure/);
  assert.throws(() => steamSat({ T_K: 650 }), /647.096/);
  assert.throws(() => steamSat({ P_kPa: 23000 }), /22064/);
  assert.throws(() => steamSat({}), /exactly one/);
  // Regions and phases at the boundaries
  assert.equal(steam(623.15, 20000).region, 1);
  assert.equal(steam(623.16, 20000).region, 3);
  assert.equal(steam(700, 1000).region, 2);
  assert.equal(steam(1073.15, 1000).region, 2);
  assert.equal(steam(1073.16, 1000).region, 5);
  assert.equal(steam(640, 19000).phase, "vapour");   // region 3, below psat
  assert.equal(steam(640, 19000).region, 3);
  assert.equal(steam(640, 21000).phase, "liquid");   // region 3, above psat
  assert.equal(steam(700, 30000).phase, "supercritical");
  assert.equal(steam(700, 1000).phase, "vapour");
});

// ---------------------------------------------------------------------------------------
// IAPWS R12-08 viscosity
// ---------------------------------------------------------------------------------------

test("R12-08 Table 4: viscosity with mu2 = 1", () => {
  // T (K), rho (kg/m3), mu (uPa s)
  const TABLE4 = [
    [298.15, 998, 889.735100], [298.15, 1200, 1437.649467], [373.15, 1000, 307.883622],
    [433.15, 1, 14.538324], [433.15, 1000, 217.685358], [873.15, 1, 32.619287],
    [873.15, 100, 35.802262], [873.15, 600, 77.430195], [1173.15, 1, 44.217245],
    [1173.15, 100, 47.640433], [1173.15, 400, 64.154608],
  ];
  // Printed with 6 decimals: the result must round to the printed value (half a unit, 5e-7 uPa s).
  for (const [T, rho, mu] of TABLE4) {
    const got = viscosity(T, rho) * 1e6;
    assert.ok(Math.abs(got - mu) <= 5.01e-7, `mu(${T} K, ${rho} kg/m3): ${got} vs ${mu}`);
  }
});

test("R12-08 Table 5: near the critical point the industrial form equals mu / mu2", () => {
  // T = 647.35 K; rho (kg/m3), mu2, mu (uPa s). The industrial form sets mu2 = 1, so it must
  // reproduce mu / mu2 (to the 8-9 digits printed); mu2 itself shows the size of the
  // neglected critical enhancement (up to 9.2 % at the critical density).
  const TABLE5 = [
    [122, 1.00000289, 25.520677], [222, 1.00375120, 31.337589], [272, 1.03416789, 36.228143],
    [322, 1.09190440, 42.961579], [372, 1.03665871, 45.688204], [422, 1.00596332, 49.436256],
  ];
  for (const [rho, mu2, mu] of TABLE5) rel(viscosity(647.35, rho) * 1e6, mu / mu2, 1e-7, `mu0*mu1 at ${rho} kg/m3`);
});

// ---------------------------------------------------------------------------------------
// IAPWS R15-11 thermal conductivity
// ---------------------------------------------------------------------------------------

test("R15-11 Table 4: thermal conductivity without the critical enhancement", () => {
  // T (K), rho (kg/m3), lambda (mW/(m K))
  const TABLE4 = [[298.15, 0, 18.4341883], [298.15, 998, 607.712868], [298.15, 1200, 799.038144], [873.15, 0, 79.1034659]];
  for (const [T, rho, lam] of TABLE4) rel(thermalConductivityParts(T, rho, null).k_W_mK * 1e3, lam, 1e-8, `lambda(${T}, ${rho})`);
});

test("R15-11 Table 5: lambda0 and lambda1 at 647.35 K", () => {
  const TABLE5 = [[1, 1.0068497], [122, 2.1445173], [222, 3.4840736], [272, 4.2233708],
    [322, 4.9681953], [372, 5.6961250], [422, 6.3973429], [750, 11.5870532]];
  for (const [rho, l1] of TABLE5) {
    const parts = thermalConductivityParts(647.35, rho, null);
    rel(parts.lambda0, 51.5764797, 1e-8, "lambda0(647.35 K)");
    rel(parts.lambda1, l1, 1e-7, `lambda1 at ${rho} kg/m3`);
  }
});

test("R15-11 Tables 7, 8, 9: industrial form with IAPWS-IF97", () => {
  // Each case: state, then lambda, lambda0, lambda1, lambda2 (mW/(m K)), rho (kg/m3),
  // (drho/dp)_T at (rho, T) and at (rho, T_R) (kg/(m3 MPa)), xi (nm), cp, cv (kJ/(kg K)),
  // Z(y), mu (uPa s).
  const CASES = [
    // Table 7, region 1
    [{ T: 620, p: 20 }, 0.481485195e3, 0.484911627e2, 0.966869008e1, 0.126391714e2, 0.613227777e3,
      0.520937820e1, 0.935037951, 0.377694973, 0.763433705e1, 0.303793441e1, 0.166942638, 0.709051068e2],
    [{ T: 620, p: 50 }, 0.545038940e3, 0.484911627e2, 0.111212177e2, 0.575816285e1, 0.699226043e3,
      0.184869007e1, 0.639306277, 0.189692422, 0.532047725e1, 0.291692653e1, 0.113592223, 0.841527945e2],
    // Table 8, region 2
    [{ T: 650, p: 0.3 }, 0.522311024e2, 0.518787461e2, 0.100678943e1, 0.129246457e-3, 0.100452141e1,
      0.336351419e1, 0.223819386e1, 0.104305448e-2, 0.207010035e1, 0.159675313e1, 0.121437275e-2, 0.234877453e2],
    [{ T: 800, p: 50 }, 0.177709914e3, 0.698329394e2, 0.244965343e1, 0.664341394e1, 0.218030012e3,
      0.661484493e1, 0.312182530e1, 0.193491903, 0.590718707e1, 0.252343426e1, 0.137263826, 0.393727534e2],
    // Table 9, region 3 (given at T and rho)
    [{ T: 647.35, rho: 222 }, 0.366879411e3, 0.515764797e2, 0.348407362e1, 0.187183159e3, 222,
      0.177778595e3, 0.311832789e1, 0.158223683e1, 0.101054488e3, 0.437466458e1, 0.217577777, 0.312204749e2],
    [{ T: 647.35, rho: 322 }, 0.124182415e4, 0.515764797e2, 0.496819532e1, 0.985582122e3, 322,
      0.692651138e4, 0.275192511e1, 0.124722016e2, 0.312090124e4, 0.452163449e1, 0.322306729e-1, 0.393455495e2],
  ];
  for (const [s, lam, l0, l1, l2, rho, dpT, dpTR, xi, cp, cv, Z, mu] of CASES) {
    const st = s.rho ? region3(s.rho, s.T) : stateTP(s.T, s.p * 1000);
    const k = thermalConductivityParts(s.T, st.rho, st);
    const at = s.rho ? `${s.T} K, ${s.rho} kg/m3` : `${s.T} K, ${s.p} MPa`;
    rel(k.k_W_mK * 1e3, lam, 1e-8, `lambda ${at}`);
    rel(k.lambda0, l0, 1e-8, `lambda0 ${at}`);
    rel(k.lambda1, l1, 1e-8, `lambda1 ${at}`);
    rel(k.lambda2_mW_mK, l2, 1e-8, `lambda2 ${at}`);
    rel(st.rho, rho, 1e-8, `rho ${at}`);
    rel(st.drhodp, dpT, 1e-8, `(drho/dp)_T ${at}`);
    rel(k.drhodp_TR, dpTR, 1e-8, `(drho/dp) at T_R ${at}`);
    rel(k.xi_nm, xi, 1e-8, `xi ${at}`);
    rel(st.cp, cp, 1e-8, `cp ${at}`);
    rel(st.cv, cv, 1e-8, `cv ${at}`);
    rel(k.Z, Z, 1e-8, `Z(y) ${at}`);
    rel(k.mu_Pa_s * 1e6, mu, 1e-8, `mu ${at}`);
    if (!s.rho) {
      const out = steam(s.T, s.p * 1000);
      rel(out.k_W_mK * 1e3, lam, 1e-8, `steam().k_W_mK ${at}`);
      rel(out.mu_Pa_s * 1e6, mu, 1e-8, `steam().mu_Pa_s ${at}`);
    }
  }
});

test("transport properties are not given above 1173.15 K (outside the releases)", () => {
  const st = steam(1500, 1000);
  assert.equal(st.mu_Pa_s, null);
  assert.equal(st.k_W_mK, null);
  assert.match(st.notes.join(" "), /1173.15 K/);
  assert.throws(() => viscosity(1200, 1), /1173.15 K/);
});

// ---------------------------------------------------------------------------------------
// Independent cross-check: CoolProp IF97::Water and IAPWS-95 (HEOS::Water)
// ---------------------------------------------------------------------------------------

const PROPS = ["rho_kg_m3", "h_kJ_kg", "s_kJ_kgK", "u_kJ_kg", "cp_kJ_kgK", "cv_kJ_kgK", "w_m_s", "mu_Pa_s", "k_W_mK"];
// h, u and s are compared as deviation / max(|value|, 1 unit), because they cross zero.
function dev(p, got, want) {
  return /^(h|u|s)_/.test(p) ? Math.abs(got - want) / Math.max(Math.abs(want), 1) : Math.abs(got / want - 1);
}

test("grid over all regions agrees with CoolProp's IF97 implementation", () => {
  // Regions 1, 2, 5: same equations, so agreement to round-off. Region 3: CoolProp uses the
  // backward equations v(p,T) (IAPWS SR5-05), which are consistent with the basic equation
  // only to about 1e-5 in v; Fugacity solves the basic equation itself.
  const TOL = { 1: 1e-9, 2: 1e-9, 5: 1e-9, 3: { cp_kJ_kgK: 1e-4, w_m_s: 5e-5, default: 2e-5 } };
  let n = 0;
  for (const pt of grid.points) {
    const st = steam(pt.T_K, pt.P_kPa);
    for (const p of PROPS) {
      const want = pt.IF97[p];
      if (want === null || want === undefined || st[p] === null) continue;
      const t = st.region === 3 ? (TOL[3][p] ?? TOL[3].default) : TOL[st.region];
      const d = dev(p, st[p], want);
      assert.ok(d <= t, `${p} at ${pt.T_K} K, ${pt.P_kPa} kPa (region ${st.region}): ${st[p]} vs ${want}, ${d.toExponential(2)}`);
      n++;
    }
  }
  assert.ok(n > 4000, `${n} comparisons`);
});

test("grid agrees with IAPWS-95 (HEOS::Water) within the IF97 consistency (sanity check)", () => {
  // IF97 reproduces IAPWS-95 to within its stated uncertainty; the largest differences
  // are near the critical point (region 3). Bounds used here, by property:
  const TOL = {
    outside3: { rho_kg_m3: 5e-4, h_kJ_kg: 5e-4, s_kJ_kgK: 5e-4, u_kJ_kg: 2e-2, cp_kJ_kgK: 1e-2, cv_kJ_kgK: 1e-2, w_m_s: 1e-2, mu_Pa_s: 1e-3, k_W_mK: 1e-3 },
    region3: { rho_kg_m3: 2e-2, h_kJ_kg: 5e-3, s_kJ_kgK: 5e-3, u_kJ_kg: 5e-3, cp_kJ_kgK: 0.2, cv_kJ_kgK: 5e-2, w_m_s: 2e-2, mu_Pa_s: 3e-2, k_W_mK: 3e-2 },
  };
  for (const pt of grid.points) {
    const st = steam(pt.T_K, pt.P_kPa);
    const tol = st.region === 3 ? TOL.region3 : TOL.outside3;
    for (const p of PROPS) {
      const want = pt.IAPWS95[p];
      if (want === null || want === undefined || st[p] === null) continue;
      const d = dev(p, st[p], want);
      assert.ok(d <= tol[p], `${p} at ${pt.T_K} K, ${pt.P_kPa} kPa (region ${st.region}): IF97 ${st[p]} vs IAPWS-95 ${want}`);
    }
  }
});

test("saturated liquid and vapour agree with CoolProp IF97::Water", () => {
  for (const row of grid.saturation) {
    const s = steamSat({ T_K: row.T_K });
    rel(s.P_kPa, row.P_kPa, 1e-12, `psat(${row.T_K})`);
    for (const ph of ["liquid", "vapour"]) {
      if (row.T_K <= 623.15) {
        for (const p of ["rho_kg_m3", "h_kJ_kg", "s_kJ_kgK", "u_kJ_kg"]) {
          const d = dev(p, s[ph][p], row[ph][p]);
          assert.ok(d <= 1e-9, `${ph} ${p} at ${row.T_K} K: ${s[ph][p]} vs ${row[ph][p]}`);
        }
      } else {
        // Region 3: Fugacity's saturated densities satisfy the basic equation p(rho, T) = psat
        // exactly. CoolProp takes them from the backward equations, which are consistent with
        // the basic equation to about 1e-5 in pressure; near the critical point, where
        // dp/drho -> 0, that is up to 1 % in density. So compare in pressure.
        rel(region3(s[ph].rho_kg_m3, row.T_K).p * 1000, row.P_kPa, 1e-12, `p(rho_${ph}) at ${row.T_K} K`);
        rel(region3(row[ph].rho_kg_m3, row.T_K).p * 1000, row.P_kPa, 1e-4, `CoolProp p(rho_${ph}) at ${row.T_K} K`);
      }
    }
    // the same states from the pressure
    const byP = steamSat({ P_kPa: s.P_kPa });
    rel(byP.T_K, row.T_K, 1e-9, `Tsat(psat(${row.T_K}))`);
    rel(byP.hfg_kJ_kg, s.hfg_kJ_kg, 1e-6, `hfg at ${row.T_K} K from T and from P`);
  }
  const c = steamSat({ T_K: 647.096 });
  assert.ok(Math.abs(c.liquid.rho_kg_m3 - 322) < 1 && Math.abs(c.vapour.rho_kg_m3 - 322) < 1, "critical point");
  assert.equal(c.hfg_kJ_kg, 0);
});

// ---------------------------------------------------------------------------------------
// pure("water"): molar units and the engine's enthalpy reference
// ---------------------------------------------------------------------------------------

test("pure('water').props() uses IF97, in molar units, ideal gas at 298.15 K as h = 0", () => {
  const w = pure("water");
  const M = w.MW;
  // The engine's reference value: IF97 ideal-gas enthalpy at 298.15 K, checked against the
  // iapws package (written into the fixture).
  rel(hIdealGas(298.15), grid.h_ideal_gas_298_kJ_kg.IF97, 1e-12, "h°(298.15 K)");
  for (const pt of grid.points.filter(p => p.T_K <= 1073.15).filter((_, i) => i % 3 === 0)) {
    const s = w.props(pt.T_K, pt.P_kPa);
    const st = steam(pt.T_K, pt.P_kPa);
    const tol = st.region === 3 ? 2e-5 : 1e-9;
    assert.equal(s.phase, st.phase);
    assert.ok(dev("rho", s.rho_kg_m3, pt.IF97.rho_kg_m3) <= tol);
    assert.ok(dev("cp", s.cp_J_molK, M * pt.IF97.cp_kJ_kgK) <= tol * 5);
    if (pt.IF97.mu_Pa_s) assert.ok(dev("mu", s.mu_Pa_s, pt.IF97.mu_Pa_s) <= tol);
    if (pt.IF97.k_W_mK) assert.ok(dev("k", s.k_W_mK, pt.IF97.k_W_mK) <= tol);
    // enthalpy: against CoolProp IF97 with the reference shift, and against IAPWS-95 with
    // its own ideal-gas value at 298.15 K (1 Pa)
    const hIF97 = M * (pt.IF97.h_kJ_kg - grid.h_ideal_gas_298_kJ_kg.IF97);
    const h95 = M * (pt.IAPWS95.h_kJ_kg - grid.h_ideal_gas_298_kJ_kg.IAPWS95);
    assert.ok(Math.abs(s.h_J_mol - hIF97) <= (st.region === 3 ? 0.2 : 1e-6), `h vs IF97 at ${pt.T_K} K, ${pt.P_kPa} kPa: ${s.h_J_mol} vs ${hIF97}`);
    // same bounds as the IAPWS-95 grid check above, in J/mol, plus the 0.02 kJ/kg difference
    // between the two ideal-gas reference values
    const tol95 = M * ((st.region === 3 ? 5e-3 : 5e-4) * Math.max(Math.abs(pt.IAPWS95.h_kJ_kg), 1) + 0.03);
    assert.ok(Math.abs(s.h_J_mol - h95) <= tol95, `h vs IAPWS-95 at ${pt.T_K} K, ${pt.P_kPa} kPa: ${s.h_J_mol} vs ${h95}`);
    for (const key of ["rho_kg_m3", "cp_J_molK", "h_J_mol"]) assert.equal(s.sources[key].tier, "standard");
  }
  // Physical checks: ideal gas at 298.15 K and low pressure has h close to 0; the liquid at
  // 298.15 K lies below it by about the heat of vaporization.
  // At 10 Pa the residual enthalpy is below 0.1 J/mol (at 1 kPa it is already -7 J/mol).
  const gas = w.props(298.15, 0.01);
  assert.ok(Math.abs(gas.h_J_mol) < 0.2, `h of steam at 298.15 K, 10 Pa: ${gas.h_J_mol}`);
  const liq = w.props(298.15, 101.325);
  assert.equal(liq.phase, "liquid");
  rel(liq.dHvap_J_mol, M * steamSat({ T_K: 298.15 }).hfg_kJ_kg, 1e-12, "dHvap");
  // h_liquid + dHvap = residual enthalpy of the saturated vapour at 3.17 kPa (about -25 J/mol,
  // cf. -7.8 J/mol at 1 kPa in IAPWS-95) plus v dP of the liquid (+1.8 J/mol).
  const gap = liq.h_J_mol + liq.dHvap_J_mol;
  assert.ok(gap < 0 && gap > -40, `h_liquid + dHvap at 298.15 K: ${gap}`);
  assert.equal(w.props(700, 30000).phase, "supercritical");
  assert.equal(w.props(700, 30000).dHvap_J_mol, null);
});

test("steam-table excerpt (values quoted in the pull request)", () => {
  // Saturation at 100 °C and at 1, 10, 100 bar; superheated steam at 10 bar, 300 °C.
  // Compared with CoolProp IF97 (rounded here to the digits of a printed steam table).
  const s100 = steamSat({ T_K: 373.15 });
  assert.equal(s100.P_kPa.toFixed(3), "101.418");
  assert.equal(s100.hfg_kJ_kg.toFixed(1), "2256.5");
  const sh = steam(573.15, 1000);
  assert.equal(sh.region, 2);
  assert.equal(sh.h_kJ_kg.toFixed(1), "3051.7");
  assert.equal(sh.v_m3_kg.toFixed(5), "0.25798");
});

test("pure('water'): psat, tsat, hIdealGas, available() and property() come from IAPWS", () => {
  const w = pure("water");
  // Boiling point at 1 atm is IF97's (Eq. 31), not the DIPPR fit used by the VLE models.
  assert.equal(w.tsat(101.325).toFixed(4), "373.1243");
  rel(w.tsat(101.325), tsatMPa(0.101325), 1e-15, "tsat(1 atm)");
  for (const [T, ps] of [[300, 0.353658941e-2], [500, 0.263889776e1], [600, 0.123443146e2]]) rel(w.psat(T), ps * 1000, 1e-8, `psat(${T})`);
  rel(w.psat(w.tsat(101.325)), 101.325, 1e-9, "psat(tsat(1 atm))");
  // props() and psat()/tsat() agree in the 2 mK band where IF97 and the DIPPR fit differ.
  for (const T of [373.12, 373.124, 373.1245, 373.126]) {
    const s = w.props(T, 101.325);
    assert.equal(s.psat_kPa, w.psat(T));
    assert.equal(s.phase, T < w.tsat(101.325) ? "liquid" : "vapour", `phase at ${T} K`);
  }
  // Ideal-gas enthalpy (J/mol, 0 at 298.15 K) and heat capacity against IAPWS-95 at 1 Pa.
  const M = w.MW, ig = grid.ideal_gas_IAPWS95, h298 = ig.find(r => r.T_K === 298.15).h_kJ_kg;
  assert.equal(w.hIdealGas(298.15), 0);
  for (const r of ig) {
    const want = M * (r.h_kJ_kg - h298);
    assert.ok(Math.abs(w.hIdealGas(r.T_K) - want) <= 1e-4 * Math.abs(want) + 0.5, `hIdealGas(${r.T_K}): ${w.hIdealGas(r.T_K)} vs ${want}`);
    rel(w.property("idealGasHeatCapacity", r.T_K), M * r.cp_kJ_kgK, 2e-4, `cp°(${r.T_K})`);
  }
  // The same value as props() for steam at low pressure (10 Pa).
  assert.ok(Math.abs(w.props(400, 0.01).h_J_mol - w.hIdealGas(400)) < 0.1);
  assert.throws(() => w.hIdealGas(1200), /1073.15 K/);
  // Every property IAPWS covers is listed as available, with tier "standard".
  const { have } = w.available();
  for (const n of ["vapourPressure", "liquidDensity", "idealGasHeatCapacity", "liquidHeatCapacity",
    "heatOfVaporization", "liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"]) {
    assert.ok(have.includes(n), n);
    assert.equal(w.record(n).tier, "standard");
  }
  // Saturated-liquid properties equal steamSat; low-pressure vapour transport is the dilute-gas limit.
  const sat = steamSat({ T_K: 373.15 });
  assert.equal(w.property("liquidDensity", 373.15), sat.liquid.rho_kg_m3);
  assert.equal(w.property("heatOfVaporization", 373.15), M * sat.hfg_kJ_kg);
  assert.equal(w.property("liquidViscosity", 373.15), sat.liquid.mu_Pa_s);
  assert.equal(w.property("vapourViscosity", 373.15), viscosity(373.15, 0));
  assert.ok(Math.abs(w.property("vapourViscosity", 373.15) / steam(373.15, 0.01).mu_Pa_s - 1) < 1e-6);
  assert.ok(Math.abs(w.property("vapourThermalConductivity", 373.15) / steam(373.15, 0.01).k_W_mK - 1) < 1e-5);
  assert.throws(() => w.property("liquidDensity", 700), /647.096 K/);
  assert.equal(w.record("vapourPressure").equation, "IAPWS");
});

test("transport properties start at the triple point, 273.16 K, as in the releases", () => {
  assert.throws(() => viscosity(273.155, 999.8), /273.16 K/);
  assert.throws(() => thermalConductivityParts(273.155, 999.8, null), /273.16 K/);
  const st = steam(273.155, 101.325);
  assert.equal(st.mu_Pa_s, null);
  assert.match(st.notes.join(" "), /273.16 K/);
  assert.ok(steam(273.16, 101.325).mu_Pa_s > 0);
});
