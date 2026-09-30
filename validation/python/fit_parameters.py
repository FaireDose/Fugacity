"""
Fit binary NRTL / UNIQUAC parameters to experimental data and write them to
src/data/binaries.json. Each fit is defined in FITS below: which pair, which data
file, and which parameters are free.

    python validation/python/fit_parameters.py            # fit and print, no changes
    python validation/python/fit_parameters.py --write    # fit and update binaries.json

Objective: bubble temperature (weight 1/0.5 K) and vapour composition (1/0.01) for
isobaric T-x-y data; relative pressure (1/0.5 %) for isothermal P-x data; excess
enthalpy (1/20 J/mol) when given.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

from reference_model import System, DATA

ROOT = Path(__file__).resolve().parents[2]
VAL = ROOT / "validation" / "data"
BIN_FILE = DATA / "binaries.json"


def load(name):
    return json.loads((VAL / name).read_text())


def water_eg_txy():
    d = load("water_ethylene_glycol_760mmHg.json")
    return d["P_kPa"], [(p["x_water"], p["T_C"] + 273.15, p["y_water"]) for p in d["txy"]]


def schmid():
    d = load("schmid2007_acetic_acid_ethylene_glycol.json")
    px = [(p["x1"], p["P_kPa"]) for p in d["px"]]
    he = [(p["x1"], p["HE_J_mol"]) for p in d["HE_323K"]]
    return d["T_K"], px, he


def uniquac_curve(i, j):
    """Reference T-x-y curve from the databank UNIQUAC set, used when no open experimental
    data set is at hand; the NRTL set is then fitted to reproduce it."""
    s = System([i, j], "UNIQUAC")
    pts = []
    for x1 in [0.01, 0.03] + [0.05 + 0.9 * k / 16 for k in range(17)] + [0.97, 0.99]:
        T, y = s.bubble_t([x1, 1 - x1], 101.325)
        pts.append((x1, T, y[0]))
    return 101.325, pts


FITS = [
    dict(pair=("water", "acetic-acid"), data="uniquac-curve", models=["NRTL"], temperature_dependent=False,
         describe="Fitted to reproduce the ChemSep UNIQUAC T-x-y curve at 101.325 kPa (no open experimental set yet)."),
    dict(pair=("water", "ethylene-glycol"), data="txy", temperature_dependent=False,
         describe="Fitted to 18 T-x-y points at 760 mmHg (compilation on Wikipedia ethylene glycol data page)."),
    dict(pair=("acetic-acid", "ethylene-glycol"), data="schmid", temperature_dependent=True,
         describe="Fitted to Schmid, Doeker, Gmehling, Fluid Phase Equilib. 258 (2007) 115 (data public in the NIST TRC ThermoML Archive): P-x at 363.15 K (with the paper's pure-component pressures) and HE at 323.15 K."),
]


def make_params(model, i, j, p):
    a_ij, a_ji = (p[2], p[3]) if len(p) > 2 else (0.0, 0.0)
    e = dict(model=model, i=i, j=j, a_ij=float(a_ij), a_ji=float(a_ji), b_ij=float(p[0]), b_ji=float(p[1]))
    if model == "NRTL":
        e["alpha"] = 0.3
    return e


def fit(spec, model):
    i, j = spec["pair"]
    if spec["data"] in ("txy", "uniquac-curve"):
        P, pts = water_eg_txy() if spec["data"] == "txy" else uniquac_curve(i, j)

        def residuals(p):
            s = System([i, j], model, params=[make_params(model, i, j, p)])
            r = []
            for x1, T, y1 in pts:
                Tc, y = s.bubble_t([x1, 1 - x1], P)
                r += [(Tc - T) / 0.5, (y[0] - y1) / 0.01]
            return np.array(r)
    else:
        T0, px, he = schmid()
        pure = [px[-1][1], px[0][1]]

        def residuals(p):
            s = System([i, j], model, psat=pure, params=[make_params(model, i, j, p)])
            r = [(s.equilibrium([x1, 1 - x1], T0)[0] - P) / P / 0.005 for x1, P in px[1:-1]]
            r += [(s.excess_enthalpy([x1, 1 - x1], 323.15) - h) / 20.0 for x1, h in he]
            return np.array(r)

    n = 4 if spec["temperature_dependent"] else 2
    best = None
    for start in [(100, -100), (-100, 100), (300, -200), (-200, 300), (500, -300), (-300, 500)]:
        try:
            res = least_squares(residuals, list(start) + [0.0] * (n - 2), method="lm")
        except Exception:
            continue
        if best is None or res.cost < best.cost:
            best = res
    return make_params(model, i, j, best.x), best


def quality(spec, model, params):
    i, j = spec["pair"]
    if spec["data"] in ("txy", "uniquac-curve"):
        P, pts = water_eg_txy() if spec["data"] == "txy" else uniquac_curve(i, j)
        s = System([i, j], model, params=[params])
        dT = [abs(s.bubble_t([x1, 1 - x1], P)[0] - T) for x1, T, _ in pts]
        dy = [abs(s.bubble_t([x1, 1 - x1], P)[1][0] - y1) for x1, _, y1 in pts]
        return f"AAD {np.mean(dT):.1f} K, {np.mean(dy):.3f} in y."
    T0, px, he = schmid()
    s = System([i, j], model, psat=[px[-1][1], px[0][1]], params=[params])
    dP = [abs(s.equilibrium([x1, 1 - x1], T0)[0] / P - 1) * 100 for x1, P in px]
    dH = [abs(s.excess_enthalpy([x1, 1 - x1], 323.15) - h) for x1, h in he]
    return f"AAD {np.mean(dP):.1f} % in P, {np.mean(dH):.0f} J/mol in HE."


def main(write):
    binaries = json.loads(BIN_FILE.read_text())
    for spec in FITS:
        for model in spec.get("models", ["NRTL", "UNIQUAC"]):
            params, _ = fit(spec, model)
            q = quality(spec, model, params)
            params["source"] = f"{spec['describe']} {q}"
            params["tier"] = "databank" if spec["data"] == "uniquac-curve" else "fitted"
            print(model, spec["pair"], {k: round(v, 4) for k, v in params.items() if isinstance(v, float)}, q)
            for k, old in enumerate(binaries["pairs"]):
                if old["model"] == model and {old["i"], old["j"]} == set(spec["pair"]):
                    binaries["pairs"][k] = params
    if write:
        BIN_FILE.write_text(json.dumps(binaries, indent=2) + "\n")
        print(f"updated {BIN_FILE}")


if __name__ == "__main__":
    main("--write" in sys.argv)
