"""
Writes validation/report/cases.json, the fixed list of engineering results of the report.

    python validation/report/make_cases.py && python validation/report/make_reference.py

Edit this file (not cases.json) to add or change a case, then regenerate the references.
CoolProp is used here only to choose the temperature range of the plots.
"""
import json
from pathlib import Path

import CoolProp.CoolProp as CP

ROOT = Path(__file__).resolve().parents[2]
comp = json.loads((ROOT / "src/data/components.json").read_text())["components"]
azeo = json.loads((ROOT / "validation/data/azeotropes_101kPa.json").read_text())
weg = json.loads((ROOT / "validation/data/water_ethylene_glycol_760mmHg.json").read_text())
sch = json.loads((ROOT / "validation/data/schmid2007_acetic_acid_ethylene_glycol.json").read_text())

LIQUIDS = ["water", "acetic-acid", "ethylene-glycol", "methanol", "ethanol", "acetone",
           "chloroform", "benzene", "toluene", "ethyl-acetate"]
GASES = ["oxygen", "nitrogen", "hydrogen", "methane", "ethane", "ethylene"]
ALL = LIQUIDS + GASES
COOLPROP = {"water": "Water", "methanol": "Methanol", "ethanol": "Ethanol", "acetone": "Acetone",
            "benzene": "Benzene", "toluene": "Toluene", "oxygen": "Oxygen", "nitrogen": "Nitrogen",
            "hydrogen": "Hydrogen", "methane": "Methane", "ethane": "Ethane", "ethylene": "Ethylene"}
# Normal boiling points used as the evaluation temperature of the "at Tb" points, K.
# CoolProp 8.0.0 (T at 101325 Pa, Q = 0) for the CoolProp fluids; NIST WebBook Tboil (AVG) for the others.
TB_POINT = {"water": 373.12, "methanol": 337.63, "ethanol": 351.57, "acetone": 329.23,
            "benzene": 353.22, "toluene": 383.75, "oxygen": 90.19, "nitrogen": 77.36,
            "hydrogen": 20.37, "methane": 111.67, "ethane": 184.57, "ethylene": 169.38,
            "acetic-acid": 391.2, "ethylene-glycol": 470.5, "chloroform": 334.3, "ethyl-acetate": 350.2}

LIQ_PROPS = [("liquidDensity", "rho_kg_m3", "liquidDensity"),
             ("liquidHeatCapacity", "cp_kJ_kgK", "heatCapacity"),
             ("heatOfVaporization", "dHvap_kJ_kg", "heatOfVaporization"),
             ("liquidViscosity", "mu_mPa_s", "viscosity"),
             ("liquidThermalConductivity", "k_W_mK", "thermalConductivity")]

groups = []

# (a) normal boiling points
groups.append({
    "id": "boiling", "title": "Normal boiling points at 101.325 kPa",
    "cases": [{"id": f"tb/{c}", "type": "normalBoilingPoint", "component": c, "P_kPa": 101.325,
               "quantities": [{"key": "T_C", "tol": "boilingPoint"}]} for c in ALL]})

# (b) azeotropes
cases = []
for model in ["NRTL", "UNIQUAC"]:
    for a in azeo["binary"]:
        a1, a2 = a["components"]
        cases.append({"id": f"azeo/{a1}+{a2}/{model}", "type": "azeotrope", "components": [a1, a2],
                      "model": model, "P_kPa": azeo["P_kPa"], "near_x1": a["x_first"],
                      "quantities": [{"key": "T_C", "tol": "azeotropeT"}, {"key": "x1", "tol": "azeotropeX"}]})
t = azeo["ternary"][0]
mol = [w / comp[c]["MW"] for w, c in zip(t["wt_pct"], t["components"])]
x0 = [round(m / sum(mol), 4) for m in mol]
cases.append({"id": "azeo/" + "+".join(t["components"]) + "/NRTL", "type": "ternaryAzeotrope",
              "components": t["components"], "model": "NRTL", "P_kPa": azeo["P_kPa"], "x0": x0,
              "quantities": [{"key": "T_C", "tol": "azeotropeT"}] +
                            [{"key": f"x{i+1}", "tol": "azeotropeX"} for i in range(3)]})
groups.append({"id": "azeotropes", "title": "Azeotropes at 101.325 kPa", "cases": cases})

# (c) T-x-y and P-x spot points
cases = []
for model in ["NRTL", "UNIQUAC"]:
    for i in [4, 13, 16]:  # x_water = 0.482, 0.178, 0.065
        p = weg["txy"][i]
        x = round(p["x_water"], 6)
        cases.append({"id": f"txy/water+ethylene-glycol/{model}/x={x}", "type": "bubbleT",
                      "components": ["water", "ethylene-glycol"], "model": model, "P_kPa": weg["P_kPa"], "x1": x,
                      "quantities": [{"key": "T_C", "tol": "bubbleT_scatter"}, {"key": "y1", "tol": "bubbleY"}]})
for model in ["NRTL", "UNIQUAC"]:
    for i in [4, 7, 10]:  # x1 = 0.2188, 0.4797, 0.7728
        p = sch["px"][i]
        cases.append({"id": f"px/acetic-acid+ethylene-glycol/{model}/x={p['x1']}", "type": "bubbleP",
                      "components": ["acetic-acid", "ethylene-glycol"], "model": model, "T_K": sch["T_K"], "x1": p["x1"],
                      "quantities": [{"key": "P_kPa", "tol": "bubbleP"}]})
for comps, xs in [(["ethanol", "water"], [0.1, 0.5]), (["methanol", "water"], [0.5]),
                  (["benzene", "toluene"], [0.5]), (["acetone", "chloroform"], [0.5]),
                  (["ethanol", "ethyl-acetate"], [0.5])]:
    for x in xs:
        cases.append({"id": f"txy/{'+'.join(comps)}/NRTL/x={x}", "type": "bubbleT", "components": comps,
                      "model": "NRTL", "P_kPa": 101.325, "x1": x,
                      "quantities": [{"key": "T_C", "tol": "bubbleT"}, {"key": "y1", "tol": "bubbleY"}]})
# dew points against the measured vapour of the ethanol + water T-x-y set (Kamihama et al. 2012)
for model in ["NRTL", "UNIQUAC"]:
    for y in [0.418, 0.567, 0.736]:  # x1 = 0.079, 0.244, 0.670 in the data
        cases.append({"id": f"dew/ethanol+water/{model}/y={y}", "type": "dewT", "components": ["ethanol", "water"],
                      "model": model, "P_kPa": 101.3, "y1": y,
                      "quantities": [{"key": "T_C", "tol": "bubbleT"}, {"key": "x1", "tol": "dewX"}]})
# excess enthalpy of acetic acid + ethylene glycol at 323.15 K (Schmid et al. 2007, Table 17)
for model in ["NRTL", "UNIQUAC"]:
    for x1 in [0.098, 0.4445, 0.898]:
        cases.append({"id": f"he/acetic-acid+ethylene-glycol/{model}/x={x1}", "type": "excessEnthalpy",
                      "components": ["acetic-acid", "ethylene-glycol"], "model": model, "T_K": 323.15, "x1": x1,
                      "quantities": [{"key": "HE_J_mol", "tol": "excessEnthalpy"}]})
# excess enthalpy of water + ethanol at 423.2 K, 5000 kPa (Fang et al. 2014): an independent check,
# the parameters were fitted to vapour-liquid data near 101.3 kPa only
for model in ["NRTL", "UNIQUAC"]:
    for x1 in [0.2673, 0.5845, 0.8312]:
        cases.append({"id": f"he/water+ethanol/{model}/x={x1}", "type": "excessEnthalpy",
                      "components": ["water", "ethanol"], "model": model, "T_K": 423.2, "x1": x1,
                      "quantities": [{"key": "HE_J_mol", "tol": "excessEnthalpyPredicted"}]})
groups.append({"id": "txy", "title": "Bubble and dew points (T-x-y and P-x spot points)", "cases": cases})

# (d) pure-component properties
cases = []
for c in LIQUIDS:
    cases.append({"id": f"pure/{c}/psat/25C", "type": "pureProperty", "component": c, "property": "vapourPressure",
                  "T_K": 298.15, "quantities": [{"key": "psat_kPa", "tol": "vapourPressure"}]})
    for prop, key, tol in LIQ_PROPS:
        cases.append({"id": f"pure/{c}/{prop}/25C", "type": "pureProperty", "component": c, "property": prop,
                      "T_K": 298.15, "P_kPa": 101.325, "state": "liquid", "quantities": [{"key": key, "tol": tol}]})
for c in ALL:
    for prop, key, tol in LIQ_PROPS:
        cases.append({"id": f"pure/{c}/{prop}/Tb", "type": "pureProperty", "component": c, "property": prop,
                      "T_K": TB_POINT[c], "P_kPa": 101.325, "state": "saturated liquid",
                      "quantities": [{"key": key, "tol": tol}]})
for c in ALL:
    cases.append({"id": f"pure/{c}/idealGasHeatCapacity/25C", "type": "pureProperty", "component": c,
                  "property": "idealGasHeatCapacity", "T_K": 298.15, "quantities": [{"key": "cp_kJ_kgK", "tol": "heatCapacity"}]})
for c in GASES:
    for P_bar in [1, 10, 50]:
        cases.append({"id": f"pure/{c}/density/300K/{P_bar}bar", "type": "pureProperty", "component": c,
                      "property": "density", "T_K": 300.0, "P_kPa": P_bar * 100.0, "state": "fluid",
                      "quantities": [{"key": "rho_kg_m3", "tol": "gasDensity"}]})
groups.append({"id": "pure", "title": "Pure-component properties at standard points", "cases": cases})

# (e) steam tables
cases = []
for T_C in [100, 150, 200, 250, 300]:
    cases.append({"id": f"steam/sat/{T_C}C", "type": "steamSaturation", "T_K": T_C + 273.15,
                  "quantities": [{"key": k, "tol": "steam"} for k in
                                 ["P_bar", "rhoL_kg_m3", "rhoV_kg_m3", "hL_kJ_kg", "hV_kJ_kg", "dHvap_kJ_kg"]]})
for P_bar, T_C, label in [(10, 300, "superheated steam"), (100, 500, "superheated steam"), (100, 100, "compressed water")]:
    cases.append({"id": f"steam/{P_bar}bar/{T_C}C", "type": "steamState", "label": label,
                  "T_K": T_C + 273.15, "P_kPa": P_bar * 100.0,
                  "quantities": [{"key": k, "tol": "steam"} for k in
                                 ["rho_kg_m3", "h_kJ_kg", "s_kJ_kgK", "cp_kJ_kgK", "mu_mPa_s", "k_W_mK"]]})
groups.append({"id": "steam", "title": "Steam tables (water)", "cases": cases})

# (f) equations of state
cases = []
for comps, z, T, P_bar, name in [(["nitrogen", "oxygen"], [0.79, 0.21], 300.0, 1, "air"),
                                  (["nitrogen", "oxygen"], [0.79, 0.21], 300.0, 50, "air"),
                                  (["methane", "ethane"], [0.9, 0.1], 300.0, 50, "natural gas"),
                                  (["hydrogen", "methane"], [0.5, 0.5], 300.0, 50, "hydrogen + methane")]:
    cases.append({"id": f"eos/density/{'+'.join(comps)}/{P_bar}bar", "type": "mixtureDensity", "label": name,
                  "components": comps, "z": z, "model": "PR", "T_K": T, "P_kPa": P_bar * 100.0,
                  "quantities": [{"key": "rho_kg_m3", "tol": "eos"}]})
for T in [200.0, 250.0]:
    cases.append({"id": f"eos/bubble/methane+ethane/{T:g}K", "type": "bubbleP", "components": ["methane", "ethane"],
                  "model": "PR", "T_K": T, "x1": 0.3,
                  "quantities": [{"key": "P_bar", "tol": "eos"}, {"key": "y1", "tol": "eosY"}]})
groups.append({"id": "eos", "title": "Equation of state (Peng-Robinson)", "cases": cases})


# curves for the HTML report
def grid(lo, hi, n):
    return {"from": round(lo, 2), "to": round(hi, 2), "n": n}


curves = []
for c in ALL:
    if c in COOLPROP:
        f = COOLPROP[c]
        lo = max(CP.PropsSI("Ttriple", f) + 1.0, 273.16 if c in LIQUIDS else 0)
        hi = 0.95 * CP.PropsSI("Tcrit", f)
    else:
        lo, hi = 280.0, 0.9 * comp[c]["Tc_K"]
    Ts = grid(lo, hi, 21)
    for prop, key in [("vapourPressure", "psat_kPa")] + [(p, k) for p, k, _ in LIQ_PROPS]:
        curves.append({"id": f"curve/{c}/{prop}", "type": "pureProperty", "component": c, "property": prop,
                       "state": "saturated liquid", "x": "T_K", "T_K": Ts, "key": key})
    curves.append({"id": f"curve/{c}/idealGasHeatCapacity", "type": "pureProperty", "component": c,
                   "property": "idealGasHeatCapacity", "x": "T_K", "T_K": grid(200.0, 1000.0, 17), "key": "cp_kJ_kgK"})
for c in GASES:
    curves.append({"id": f"curve/{c}/density/300K", "type": "pureProperty", "component": c, "property": "density",
                   "state": "fluid", "x": "P_kPa", "T_K": 300.0, "P_kPa": grid(100.0, 10000.0, 12), "key": "rho_kg_m3"})
for P_bar in [1, 10, 100]:
    for key in ["rho_kg_m3", "h_kJ_kg"]:
        curves.append({"id": f"curve/steam/{P_bar}bar/{key}", "type": "steamState", "x": "T_K",
                       "T_K": grid(280.0, 800.0, 27), "P_kPa": P_bar * 100.0, "key": key})
curves.append({"id": "curve/steam/sat/P_bar", "type": "steamSaturation", "x": "T_K",
               "T_K": grid(280.0, 640.0, 19), "key": "P_bar"})
xs = grid(0.0, 1.0, 21)
for model in ["NRTL", "UNIQUAC"]:
    curves.append({"id": f"curve/txy/water+ethylene-glycol/{model}", "type": "bubbleT", "components": ["water", "ethylene-glycol"],
                   "model": model, "P_kPa": 101.325, "x": "x1", "x1": xs, "key": "T_C"})
    curves.append({"id": f"curve/px/acetic-acid+ethylene-glycol/{model}", "type": "bubbleP",
                   "components": ["acetic-acid", "ethylene-glycol"], "model": model, "T_K": 363.15, "x": "x1", "x1": xs, "key": "P_kPa"})
curves.append({"id": "curve/txy/ethanol+water/NRTL", "type": "bubbleT", "components": ["ethanol", "water"], "model": "NRTL",
               "P_kPa": 101.325, "x": "x1", "x1": xs, "key": "T_C"})
curves.append({"id": "curve/eos/bubble/methane+ethane/200K", "type": "bubbleP", "components": ["methane", "ethane"],
               "model": "PR", "T_K": 200.0, "x": "x1", "x1": grid(0.05, 0.8, 16), "key": "P_bar"})

TOL = {
    "boilingPoint": {"abs": 0.5, "unit": "K", "basis": "Proposal 0002 engineering-report tolerances (team brief)"},
    "vapourPressure": {"rel": 0.01, "basis": "Proposal 0002"},
    "liquidDensity": {"rel": 0.01, "basis": "Proposal 0002"},
    "heatCapacity": {"rel": 0.02, "basis": "Proposal 0002"},
    "heatOfVaporization": {"rel": 0.02, "basis": "Proposal 0002"},
    "viscosity": {"rel": 0.05, "basis": "Proposal 0002"},
    "thermalConductivity": {"rel": 0.05, "basis": "Proposal 0002"},
    "azeotropeT": {"abs": 1.0, "unit": "K", "basis": "Same bound as test/azeotropes.test.js"},
    "azeotropeX": {"abs": 0.05, "unit": "mole fraction", "basis": "Same bound as test/azeotropes.test.js"},
    "bubbleT": {"abs": 1.0, "unit": "K", "basis": "Chosen for this report, as for azeotrope temperatures (not in proposal 0002)"},
    "bubbleT_scatter": {"abs": 3.5, "unit": "K", "basis": "Secondary compilation with visible scatter; same bound as test/vle.test.js"},
    "bubbleY": {"abs": 0.02, "unit": "mole fraction", "basis": "Chosen for this report (not in proposal 0002)"},
    "excessEnthalpy": {"abs": 50.0, "unit": "J/mol", "informational": True, "basis": "Report only: these data were used in the fit (AAD 24-30 J/mol), so this is a consistency check"},
    "excessEnthalpyPredicted": {"rel": 0.25, "informational": True, "basis": "Report only: excess enthalpy predicted from parameters fitted to vapour-liquid data, here outside their temperature range"},
    "dewX": {"abs": 0.03, "unit": "mole fraction", "basis": "Chosen for this report: the liquid at a dew point (not in proposal 0002)"},
    "bubbleP": {"rel": 0.03, "basis": "Chosen for this report: fit AAD 1.2 % with the paper's own pure-component pressures, plus the databank vapour pressures (not in proposal 0002)"},
    "steam": {"rel": 0.001, "basis": "IAPWS-IF97 against IAPWS-95: IF97 agrees with IAPWS-95 within its stated uncertainty, not to 1e-8 (team brief)"},
    "gasDensity": {"rel": 0.05, "informational": True, "basis": "Report only: equation of state against the reference equation of state (team brief)"},
    "eos": {"rel": 0.05, "informational": True, "basis": "Report only: Peng-Robinson against the reference mixture model (team brief)"},
    "eosY": {"abs": 0.05, "unit": "mole fraction", "informational": True, "basis": "Report only (team brief)"},
}

out = {
    "_about": ("Fixed list of engineering results computed for every pull request by scripts/engineering-report.mjs "
               "and compared with validation/report/reference/*.json (made by make_reference.py). "
               "Engine inputs: T in K, P in kPa, mole fractions. Quantity keys carry their display units. "
               "Tolerance classes are named in `tolerances`; `rel` is a fraction, `abs` is in the quantity's units."),
    "version": 1,
    "tolerances": TOL,
    "groups": groups,
    "curves": curves,
}
def j(v):
    return json.dumps(v, ensure_ascii=False)


L = ["{", f' "_about": {j(out["_about"])},', ' "version": 1,', ' "tolerances": {']
L += [",\n".join(f"  {j(k)}: {j(v)}" for k, v in TOL.items())]
L += [" },", ' "groups": [']
gs = []
for g in groups:
    gs.append(f'  {{"id": {j(g["id"])}, "title": {j(g["title"])}, "cases": [\n'
              + ",\n".join("   " + j(c) for c in g["cases"]) + "\n  ]}")
L += [",\n".join(gs), " ],", ' "curves": [', ",\n".join("  " + j(c) for c in curves), " ]", "}"]
txt = "\n".join(L) + "\n"
assert json.loads(txt) == json.loads(json.dumps(out))
(ROOT / "validation/report/cases.json").write_text(txt)
print(sum(len(g["cases"]) for g in groups), "cases;", sum(len(c["quantities"]) for g in groups for c in g["cases"]), "quantities;", len(curves), "curves")
