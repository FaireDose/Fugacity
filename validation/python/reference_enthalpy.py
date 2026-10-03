"""
Independent reference for mixture enthalpies (src/thermo/enthalpy.js, proposal 0001 step 3).

Every piece is computed here without the JavaScript engine:
  - ideal-gas enthalpy: the heat-capacity records of src/data/components.json (DIPPR 107,
    written out below) integrated with scipy.integrate.quad from 298.15 K; water from the
    ideal-gas part of IAPWS-IF97 region 2 (the open `iapws` package, at 1e-12 MPa);
  - heat of vaporization: the DIPPR 106 records; water h'' - h' from IAPWS-IF97 (`iapws`);
  - residual enthalpies of the PR / SRK vapour: reference_eos.Cubic.h_res (numerical
    temperature derivative of the residual Helmholtz energy);
  - excess enthalpy: the open-source `thermo` library's NRTL and UNIQUAC classes (MIT),
    GibbsExcess.HE() (analytic), with the same parameters.
The formulas are those of proposal 0001, section 4:
  liquid  h = sum x_i [h_IG,i + h_R,i^sat - dHvap_i] + h^E
  vapour  h = sum y_i h_IG,i + h_R(T, P, y)
  equation of state  h = sum z_i h_IG,i + h_R(T, P, z), either phase.

Writes validation/fixtures/enthalpy.json.
Usage: python validation/python/reference_enthalpy.py
"""
import json
import math
from pathlib import Path

import numpy as np
from scipy.integrate import quad

from reference_model import System, psat_kpa, COMPONENTS
from reference_eos import Cubic

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "enthalpy.json"
T_REF = 298.15


def dippr107(T, k):
    s = (k["C"] / T) / math.sinh(k["C"] / T)
    c = (k["E"] / T) / math.cosh(k["E"] / T)
    return k["A"] + k["B"] * s * s + k["D"] * c * c


def h_ig(cid, T):
    if cid == "water":
        from iapws.iapws97 import _Region2
        M = COMPONENTS["water"]["MW"]
        return M * (_Region2(T, 1e-12)["h"] - _Region2(T_REF, 1e-12)["h"])
    rec = COMPONENTS[cid]["properties"]["idealGasHeatCapacity"]
    assert rec["equation"] == "DIPPR107"
    k = {n: rec["coefficients"].get(n, 0.0) for n in "ABCDE"}
    return quad(lambda t: dippr107(t, k), T_REF, T, epsabs=1e-10, epsrel=1e-13)[0]


def dhvap(cid, T):
    if cid == "water":
        from iapws import IAPWS97
        M = COMPONENTS["water"]["MW"]
        return M * (IAPWS97(T=T, x=1).h - IAPWS97(T=T, x=0).h)
    rec = COMPONENTS[cid]["properties"]["heatOfVaporization"]
    assert rec["equation"] == "DIPPR106"
    k = {n: rec["coefficients"].get(n, 0.0) for n in "ABCDE"}
    r = T / rec["Tc_K"]
    return k["A"] * (1 - r) ** (k["B"] + r * (k["C"] + r * (k["D"] + r * k["E"])))


def h_excess(s, x, T):
    from thermo.nrtl import NRTL
    from thermo.uniquac import UNIQUAC
    x = list(np.asarray(x, float) / np.sum(x))
    if s.model == "NRTL":
        GE = NRTL(T=T, xs=x, tau_as=s.a.tolist(), tau_bs=s.b.tolist(), alpha_cs=s.alpha.tolist())
    else:
        GE = UNIQUAC(T=T, xs=x, rs=s.r.tolist(), qs=s.q.tolist(), tau_as=s.a.tolist(), tau_bs=s.b.tolist())
    return GE.HE()


def liquid_h(s, x, T, vapour):
    x = np.asarray(x, float)
    h = 0.0
    cub = Cubic(vapour, s.ids) if vapour != "ideal" else None
    for i, cid in enumerate(s.ids):
        if x[i] == 0:
            continue
        hrs = 0.0
        if cub is not None:
            e = np.zeros(s.n); e[i] = 1.0
            hrs = cub.h_res(T, psat_kpa(s.c[i], T) * 1000, e, "vapour")
        h += x[i] * (h_ig(cid, T) + hrs - dhvap(cid, T))
    he = h_excess(s, x, T) if s.model != "ideal" else 0.0
    return h + he, he


def vapour_h(ids, y, T, P_kPa, vapour):
    h = sum(yi * h_ig(cid, T) for cid, yi in zip(ids, y) if yi > 0)
    if vapour != "ideal":
        h += Cubic(vapour, ids).h_res(T, P_kPa * 1000, np.asarray(y, float), "vapour")
    return h


ACTIVITY = [  # model, vapour, components, liquid cases (x, T), vapour cases (y, T, P)
    ("NRTL", "ideal", ["ethanol", "water"], [([0.5, 0.5], 330.0), ([0.2, 0.8], 350.0), ([0.9, 0.1], 300.0)], [([0.6, 0.4], 380.0, 101.325)]),
    ("NRTL", "PR", ["ethanol", "water"], [([0.5, 0.5], 330.0), ([0.2, 0.8], 420.0)], [([0.6, 0.4], 450.0, 1000.0)]),
    ("UNIQUAC", "ideal", ["methanol", "acetone", "chloroform"], [([0.3, 0.3, 0.4], 320.0), ([0.6, 0.2, 0.2], 330.0)], [([0.3, 0.3, 0.4], 360.0, 101.325)]),
    ("UNIQUAC", "SRK", ["methanol", "acetone", "chloroform"], [([0.3, 0.3, 0.4], 380.0)], [([0.3, 0.3, 0.4], 420.0, 800.0)]),
    ("NRTL", "ideal", ["benzene", "toluene"], [([0.5, 0.5], 360.0)], [([0.5, 0.5], 400.0, 101.325)]),
]
EXCESS = [  # excess enthalpy only (works with acetic acid)
    ("NRTL", ["acetic-acid", "ethylene-glycol"], [0.098, 0.4445, 0.898], 323.15),
    ("UNIQUAC", ["acetic-acid", "ethylene-glycol"], [0.098, 0.4445, 0.898], 323.15),
    ("NRTL", ["ethanol", "water"], [0.1, 0.3, 0.7], 298.15),
]
EOS = [  # model, components, (phase, z, T, P)
    ("PR", ["methane", "ethane"], [("vapour", [0.5, 0.5], 250.0, 2000.0), ("liquid", [0.3, 0.7], 180.0, 2000.0)]),
    ("SRK", ["nitrogen", "methane"], [("vapour", [0.8, 0.2], 200.0, 5000.0), ("liquid", [0.2, 0.8], 120.0, 1000.0)]),
]


def main():
    cases = []
    for model, vap, ids, liq, vapc in ACTIVITY:
        s = System(ids, model)
        for x, T in liq:
            h, he = liquid_h(s, x, T, vap)
            cases.append({"kind": "activity", "model": model, "vapour": vap, "components": ids, "phase": "liquid",
                          "z": x, "T_K": T, "P_kPa": 101.325, "h_J_mol": h, "hE_J_mol": he})
        for y, T, P in vapc:
            cases.append({"kind": "activity", "model": model, "vapour": vap, "components": ids, "phase": "vapour",
                          "z": y, "T_K": T, "P_kPa": P, "h_J_mol": vapour_h(ids, y, T, P, vap)})
    for model, ids, x1s, T in EXCESS:
        s = System(ids, model)
        for x1 in x1s:
            cases.append({"kind": "excess", "model": model, "components": ids, "z": [x1, 1 - x1], "T_K": T,
                          "hE_J_mol": h_excess(s, [x1, 1 - x1], T)})
    for model, ids, pts in EOS:
        for ph, z, T, P in pts:
            cases.append({"kind": "eos", "model": model, "components": ids, "phase": ph, "z": z, "T_K": T, "P_kPa": P,
                          "h_J_mol": sum(zi * h_ig(c, T) for c, zi in zip(ids, z)) + Cubic(model, ids).h_res(T, P * 1000, np.asarray(z), ph)})
    for c in cases:
        print(c["kind"], c.get("model"), c.get("vapour", ""), "+".join(c["components"]), c.get("phase", ""), c["z"], c["T_K"],
              round(c.get("h_J_mol", c.get("hE_J_mol")), 3))
    OUT.write_text(json.dumps({
        "_about": "Mixture enthalpies (J/mol, reference ideal gas at 298.15 K) from validation/python/reference_enthalpy.py: "
                  "ideal-gas enthalpy by quadrature of the heat-capacity records (IAPWS-IF97 for water, iapws package), "
                  "heat of vaporization from the DIPPR 106 records (IAPWS-IF97 for water), residual enthalpies from "
                  "reference_eos.Cubic, excess enthalpies from the thermo library's NRTL and UNIQUAC.",
        "cases": cases}, indent=1))
    print(f"wrote {len(cases)} cases to {OUT}")


if __name__ == "__main__":
    main()
