"""
Fit binary NRTL / UNIQUAC parameters to experimental data and write them to
src/data/binaries.json. Each fit is defined in FITS below: which pair, which data
file, and which parameters are free.

    python validation/python/fit_parameters.py            # fit and print, no changes
    python validation/python/fit_parameters.py --write    # fit and update binaries.json

Objective: bubble temperature (weight 1/0.5 K) and vapour composition (1/0.01) for
isobaric T-x-y data; relative pressure (1/0.5 %) for isothermal P-x data; excess
enthalpy (1/20 J/mol) when given.

Data kinds a FITS entry can use:
  "txy"            water + ethylene glycol compilation (water_ethylene_glycol_760mmHg.json)
  "uniquac-curve"  the databank UNIQUAC T-x-y curve (no open experimental data)
  "schmid"         Schmid et al. (2007) P-x and HE for acetic acid + ethylene glycol
  "txy-file"       any isobaric T-x-y file in validation/data/ with "kind": "isobaric-txy",
                   "components", "P_kPa", "columns" and "rows" (spec key "file", or "files"
                   for several sets of the same pair). Rows of pure components are left out.
For "txy-file" fits a spec may also set "alpha" (NRTL non-randomness, default 0.3).
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import brentq, least_squares

from reference_model import System, DATA, COMPONENTS, BINARIES, psat_kpa

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


def txy_file(name, pair):
    """Isobaric T-x-y file as (P_kPa, [(x1, T_K, y1)]) with x1, y1 of pair[0]. Pure-component
    rows are left out: they test the vapour-pressure equations, not the pair parameters."""
    d = load(name)
    if d.get("kind") != "isobaric-txy":
        raise ValueError(f"{name}: kind {d.get('kind')!r} is not isobaric-txy")
    comps = list(d["components"])
    if comps == list(pair):
        flip = False
    elif comps == [pair[1], pair[0]]:
        flip = True
    else:
        raise ValueError(f"{name}: components {comps} do not match the pair {pair}")
    col = {c: k for k, c in enumerate(d["columns"])}
    pts = []
    for r in d["rows"]:
        x1, y1 = r[col["x_1"]], r[col["y_1"]]
        T = r[col["T_K"]] if "T_K" in col else r[col["T_C"]] + 273.15
        if x1 <= 0 or x1 >= 1:
            continue
        pts.append((1 - x1, T, 1 - y1) if flip else (x1, T, y1))
    return d["P_kPa"], pts


def txy_sets(spec):
    """List of (P_kPa, points) for the T-x-y kinds."""
    i, j = spec["pair"]
    if spec["data"] == "txy":
        return [water_eg_txy()]
    if spec["data"] == "uniquac-curve":
        return [uniquac_curve(i, j)]
    if spec["data"] == "txy-file":
        return [txy_file(f, spec["pair"]) for f in spec.get("files", [spec.get("file")])]
    return None


def uniquac_curve(i, j):
    """Reference T-x-y curve from the databank UNIQUAC set, used when no open experimental
    data set is at hand; the NRTL set is then fitted to reproduce it."""
    s = System([i, j], "UNIQUAC")
    pts = []
    for x1 in [0.01, 0.03] + [0.05 + 0.9 * k / 16 for k in range(17)] + [0.97, 0.99]:
        T, y = s.bubble_t([x1, 1 - x1], 101.325)
        pts.append((x1, T, y[0]))
    return 101.325, pts


MAC = "data public in the NIST TRC ThermoML Archive"
FITS = [
    dict(pair=("water", "acetic-acid"), data="uniquac-curve", models=["NRTL"], temperature_dependent=False,
         describe="Fitted to reproduce the ChemSep UNIQUAC T-x-y curve at 101.325 kPa (no open experimental set yet)."),
    dict(pair=("water", "ethylene-glycol"), data="txy", temperature_dependent=False,
         describe="Fitted to 18 T-x-y points at 760 mmHg (compilation on Wikipedia ethylene glycol data page)."),
    dict(pair=("acetic-acid", "ethylene-glycol"), data="schmid", temperature_dependent=True,
         describe="Fitted to Schmid, Doeker, Gmehling, Fluid Phase Equilib. 258 (2007) 115 (data public in the NIST TRC ThermoML Archive): P-x at 363.15 K (with the paper's pure-component pressures) and HE at 323.15 K."),
    # Methanol + acetone + chloroform: the three pairs of the saddle-azeotrope ternary.
    dict(pair=("methanol", "acetone"), data="txy-file", file="acetone_methanol_101kPa.json", temperature_dependent=False,
         describe=f"Fitted to 19 T-x-y points at 101.3 kPa from Li, Du, Chen, Li, Guo, Zhang, Fluid Phase Equilib. 459 (2018) 10 ({MAC}; validation/data/acetone_methanol_101kPa.json)."),
    dict(pair=("methanol", "chloroform"), data="txy-file", file="chloroform_methanol_101kPa.json", temperature_dependent=False,
         describe=f"Fitted to 19 T-x-y points at 101.3 kPa from Li, Cao, Zhang, Liu, Wang, J. Chem. Eng. Data 59 (2014) 234 ({MAC}; validation/data/chloroform_methanol_101kPa.json)."),
    dict(pair=("acetone", "chloroform"), data="txy-file", file="acetone_chloroform_101kPa.json", temperature_dependent=False,
         describe="Fitted to 9 T-x-y points at 101.3 kPa from Gao, Zhao, Jia, Zhang, Appl. Sci. 8 (2018) 1519 (open access, CC BY 3.0; validation/data/acetone_chloroform_101kPa.json)."),
]


def make_params(model, i, j, p, alpha=0.3):
    a_ij, a_ji = (p[2], p[3]) if len(p) > 2 else (0.0, 0.0)
    e = dict(model=model, i=i, j=j, a_ij=float(a_ij), a_ji=float(a_ji), b_ij=float(p[0]), b_ji=float(p[1]))
    if model == "NRTL":
        e["alpha"] = alpha
    return e


def fit(spec, model):
    i, j = spec["pair"]
    alpha = spec.get("alpha", 0.3)
    sets = txy_sets(spec)
    if sets is not None:
        def residuals(p):
            s = System([i, j], model, params=[make_params(model, i, j, p, alpha)])
            r = []
            for P, pts in sets:
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
    return make_params(model, i, j, best.x, alpha), best


def txy_deviations(sets, model, i, j, params):
    """Absolute deviations in T (K) and y over all points, with a given parameter list."""
    s = System([i, j], model, params=params)
    dT, dy = [], []
    for P, pts in sets:
        for x1, T, y1 in pts:
            Tc, y = s.bubble_t([x1, 1 - x1], P)
            dT.append(abs(Tc - T)); dy.append(abs(y[0] - y1))
    return np.array(dT), np.array(dy)


def quality(spec, model, params):
    i, j = spec["pair"]
    if spec["data"] in ("txy", "uniquac-curve"):
        P, pts = water_eg_txy() if spec["data"] == "txy" else uniquac_curve(i, j)
        s = System([i, j], model, params=[params])
        dT = [abs(s.bubble_t([x1, 1 - x1], P)[0] - T) for x1, T, _ in pts]
        dy = [abs(s.bubble_t([x1, 1 - x1], P)[1][0] - y1) for x1, _, y1 in pts]
        return f"AAD {np.mean(dT):.1f} K, {np.mean(dy):.3f} in y."
    if spec["data"] == "txy-file":
        dT, dy = txy_deviations(txy_sets(spec), model, i, j, [params])
        return f"AAD {np.mean(dT):.2f} K in T, {np.mean(dy):.4f} in y (max {dT.max():.2f} K, {dy.max():.4f})."
    T0, px, he = schmid()
    s = System([i, j], model, psat=[px[-1][1], px[0][1]], params=[params])
    dP = [abs(s.equilibrium([x1, 1 - x1], T0)[0] / P - 1) * 100 for x1, P in px]
    dH = [abs(s.excess_enthalpy([x1, 1 - x1], 323.15) - h) for x1, h in he]
    return f"AAD {np.mean(dP):.1f} % in P, {np.mean(dH):.0f} J/mol in HE."


def point_test(spec, nterms=4):
    """Thermodynamic consistency point test (Van Ness et al. 1973; Fredenslund et al. 1977):
    fit a Redlich-Kister expansion of G^E/RT to the T-x data only (Barker's method, ideal
    vapour, the databank vapour pressures) and compare the vapour compositions it predicts
    with the measured ones. Mean |dy| below 0.01 is the usual pass criterion."""
    i, j = spec["pair"]
    c = [COMPONENTS[i], COMPONENTS[j]]
    sets = txy_sets(spec)

    def lngam(A, x1):
        x2 = 1 - x1
        d = x1 - x2
        g = x1 * x2 * sum(a * d ** k for k, a in enumerate(A))
        dg = (x2 - x1) * sum(a * d ** k for k, a in enumerate(A)) + x1 * x2 * sum(2 * k * a * d ** (k - 1) for k, a in enumerate(A) if k)
        return g + x2 * dg, g - x1 * dg

    def bubble(A, x1, P):
        l1, l2 = lngam(A, x1)
        f = lambda T: x1 * np.exp(l1) * psat_kpa(c[0], T) + (1 - x1) * np.exp(l2) * psat_kpa(c[1], T) - P
        T = brentq(f, 250.0, 600.0, xtol=1e-10)
        return T, x1 * np.exp(l1) * psat_kpa(c[0], T) / P

    def res(A):
        return np.array([(bubble(A, x1, P)[0] - T) for P, pts in sets for x1, T, _ in pts])

    A = least_squares(res, [0.0] * nterms, method="lm").x
    dy = [abs(bubble(A, x1, P)[1] - y1) for P, pts in sets for x1, _, y1 in pts]
    return float(np.mean(dy))


def main(write):
    binaries = json.loads(BIN_FILE.read_text())
    for spec in FITS:
        test = ""
        if spec["data"] == "txy-file":
            dy_test = point_test(spec)
            print(f"{spec['pair']}: point test (Redlich-Kister, 4 terms, T-x only): mean |dy| = {dy_test:.4f}")
            test = f" Data consistency point test (Redlich-Kister fit to T-x): mean |dy| {dy_test:.3f}{' (passes, < 0.01)' if dy_test < 0.01 else ' (fails, >= 0.01)'}."
        for model in spec.get("models", ["NRTL", "UNIQUAC"]):
            params, _ = fit(spec, model)
            q = quality(spec, model, params) + test
            params["source"] = f"{spec['describe']} {q}"
            params["tier"] = "databank" if spec["data"] == "uniquac-curve" else "fitted"
            if spec["data"] == "txy-file":
                # the databank set this fit replaced (kept under "replaced"), on the same data
                i, j = spec["pair"]
                old = [p.get("replaced", p) for p in BINARIES if p["model"] == model and {p["i"], p["j"]} == {i, j}]
                if old:
                    dT, dy = txy_deviations(txy_sets(spec), model, i, j, [dict(old[0], model=model)])
                    print(f"  {model} replaced databank parameters on the same data: AAD {dT.mean():.2f} K, {dy.mean():.4f} in y")
            print(model, spec["pair"], {k: round(v, 4) for k, v in params.items() if isinstance(v, float)}, q)
            for k, old in enumerate(binaries["pairs"]):
                if old["model"] == model and {old["i"], old["j"]} == set(spec["pair"]):
                    if spec["data"] == "txy-file" and old.get("tier") != "fitted":
                        params["replaced"] = {key: old[key] for key in ("a_ij", "a_ji", "b_ij", "b_ji", "alpha", "source", "tier") if key in old}
                        params["replaced"]["i"], params["replaced"]["j"] = old["i"], old["j"]
                    elif "replaced" in old:
                        params["replaced"] = old["replaced"]
                    binaries["pairs"][k] = params
    if write:
        BIN_FILE.write_text(json.dumps(binaries, indent=2) + "\n")
        print(f"updated {BIN_FILE}")


if __name__ == "__main__":
    main("--write" in sys.argv)
