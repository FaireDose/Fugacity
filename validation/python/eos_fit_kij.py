"""Fit Peng-Robinson / SRK binary parameters k_ij to open experimental data.

Used where the databank value is contradicted by open data. The fitted entry replaces the
databank entry in src/data/kij.json (tier "fitted"); the databank value is kept in
`replaced` with the reason. Then run make_sources.py (it adds set names and source_ids).

Fits (bubble points from the independent Python implementation in reference_eos.py).
Isothermal P-x data: objective sum of squared ln(P_bubble,calc / P_exp) at the measured T and
liquid x. Isobaric T-x-y data ("txy" entries): sum of squared (T_bubble,calc - T_exp) / 0.5 K
at the measured P and liquid x; the vapour composition is compared, not fitted.

  hydrogen + toluene, PR (the SRK databank value, +0.39, agrees with these data and is kept):
    Tsuji et al., Fluid Phase Equilib. 228-229 (2005) 499, 303.15 K, 9 points
    Aslam et al., J. Chem. Eng. Data 61 (2016) 643, 293-333 K, 510-891 kPa, 20 points
    (both from the NIST TRC ThermoML Archive; validation/data/eos/*_hydrogen_toluene.json)

  methanol synthesis benchmark: dimethyl ether + methanol, total pressures at 323.15 K of
  Park, Han, Gmehling, J. Chem. Eng. Data 52 (2007) 230
  (validation/data/dimethyl-ether_methanol_px_park2007.json)
  ethanol dehydration benchmark (proposal 0004 step 3; the equation of state is the second
  model of these pairs, docs/BENCHMARKS.md), PR and SRK, isobaric T-x-y at 101.3 kPa from
  Kamihama et al., J. Chem. Eng. Data 57 (2012) 339 (NIST TRC ThermoML Archive):
    ethanol + water, ethanol + ethylene glycol, water + ethylene glycol
    (validation/data/ethanol_water_101kPa.json, ethanol_ethylene-glycol_101kPa.json,
    water_ethylene-glycol_101kPa_kamihama2012.json)

Usage: python validation/python/eos_fit_kij.py [--write]
"""
import json
import math
import os
import sys

import numpy as np
from scipy.optimize import brentq, minimize_scalar

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reference_eos import Cubic  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DATA = os.path.join(ROOT, "validation", "data", "eos")


def load_h2_toluene():
    pts = []
    ts = json.load(open(os.path.join(DATA, "tsuji2005_hydrogen_toluene.json")))
    for x, P, _ in ts["rows"]:
        pts.append((ts["conditions"]["T_K"], x, P, "Tsuji 2005"))
    asl = json.load(open(os.path.join(DATA, "aslam2016_hydrogen_toluene.json")))
    for T, P, x, _ in asl["rows"]:
        pts.append((T, x, P, "Aslam 2016"))
    return pts


def bubble_p(e, T, x1, P_guess):
    """Bubble pressure (kPa) of liquid [x1, 1 - x1] at T."""
    P, _ = e.point("bubbleP", [x1, 1 - x1], T, 0.2 * P_guess * 1000, 5 * P_guess * 1000)
    return P / 1000


def load_txy(name):
    """Isobaric T-x-y file of validation/data as [(P_kPa, x1, T_K, y1)], x1 and y1 of the
    file's first component; pure-component rows left out."""
    d = json.load(open(os.path.join(ROOT, "validation", "data", name)))
    c = {k: n for n, k in enumerate(d["columns"])}
    return [(d["P_kPa"], r[c["x_1"]], r[c["T_K"]], r[c["y_1"]]) for r in d["rows"] if 0 < r[c["x_1"]] < 1]


def bubble_t(e, P_kPa, x1, T_guess):
    """Bubble temperature (K) and vapour mole fraction of the first component, liquid [x1, 1 - x1]."""
    T, y = e.point("bubbleT", [x1, 1 - x1], P_kPa * 1000, T_guess - 25, T_guess + 25)
    return T, y[0]


TXY_FITS = [
    {"pair": ("ethanol", "water"), "file": "ethanol_water_101kPa.json"},
    {"pair": ("ethanol", "ethylene-glycol"), "file": "ethanol_ethylene-glycol_101kPa.json"},
    {"pair": ("water", "ethylene-glycol"), "file": "water_ethylene-glycol_101kPa_kamihama2012.json"},
]


FITS = [
    {
        "pair": ("hydrogen", "toluene"),
        "models": ["PR"],  # SRK: the ChemSep value +0.39 fits these data as well as a refit (0.3858), see the PR
        "data": load_h2_toluene,
        "data_files": ["validation/data/eos/tsuji2005_hydrogen_toluene.json", "validation/data/eos/aslam2016_hydrogen_toluene.json"],
        "reason": "The ChemSep PR value (-0.51) under-predicts the bubble pressure of the open data sets of Tsuji et al. (2005) and Aslam et al. (2016) by 66-78 % (k_ij = 0: 38-51 %), i.e. it predicts 3-4 times too much hydrogen solubility; the SRK value from the same DECHEMA page is +0.39. Found by the independent review of pull request #13.",
    },
]


PX_FITS = [
    # methanol synthesis benchmark: Park, Han, Gmehling, J. Chem. Eng. Data 52 (2007) 230
    # (NIST TRC ThermoML Archive), total pressures at 323.15 K
    {"pair": ("dimethyl-ether", "methanol"), "file": "dimethyl-ether_methanol_px_park2007.json", "cite": "Park et al. (2007)"},
]


def load_px(name):
    """Isothermal P-x file of validation/data ("isothermal-px": columns T_K, x_1, P_kPa) as
    [(T_K, x1, P_kPa)], x1 of the file's first component; pure-component rows left out (they
    test the equation of state's vapour pressures, not k_ij)."""
    d = json.load(open(os.path.join(ROOT, "validation", "data", name)))
    c = {k: n for n, k in enumerate(d["columns"])}
    return [(r[c["T_K"]], r[c["x_1"]], r[c["P_kPa"]]) for r in d["rows"] if 0 < r[c["x_1"]] < 1]


def bubble_p_fresh(e, T, x1, P_guess):
    """Bubble pressure (kPa) of liquid [x1, 1 - x1] at T for the P-x fits. Every evaluation
    starts the vapour from Wilson's K-values (the solver of reference_eos.py carries the last
    vapour over, which can slide onto the trivial solution y = x); the trivial solution is
    rejected, and the root is bracketed by a scan of 0.3-3 times the measured pressure."""
    z = np.array([x1, 1 - x1])

    def f(P):
        K = e.Pc / P * np.exp(5.37 * (1 + e.w) * (1 - e.Tc / T))
        r, w = e._inner(T, P, z, True, K * z / (K * z).sum())
        return None if np.max(np.abs(w - z)) < 1e-4 else r

    Ps = np.geomspace(0.3 * P_guess * 1000, 3 * P_guess * 1000, 25)
    vals = [f(P) for P in Ps]
    for a, b, fa, fb in zip(Ps, Ps[1:], vals, vals[1:]):
        if fa is not None and fb is not None and fa * fb < 0:
            return brentq(f, a, b, xtol=1e-6) / 1000
    raise ValueError(f"no bubble pressure at T = {T} K, x1 = {x1}")


def fit_px(doc):
    """k_ij of the PX_FITS entries, both models: sum of squared ln(P_bubble,calc / P_exp)."""
    for fit in PX_FITS:
        i, j = fit["pair"]
        comps = json.load(open(os.path.join(ROOT, "validation", "data", fit["file"])))["components"]
        if list(comps) != [i, j]:
            raise SystemExit(f"{fit['file']}: components {comps}, pair {fit['pair']}: list the pair in the file's order")
        pts = load_px(fit["file"])
        for model in ("PR", "SRK"):
            e = Cubic(model, [i, j])

            def resid(k):
                e.k[0, 1] = e.k[1, 0] = k
                out = []
                for T, x, P in pts:
                    try:
                        out.append(math.log(bubble_p_fresh(e, T, x, P) / P))
                    except ValueError:
                        out.append(None)
                return out

            res = minimize_scalar(lambda k: sum(v * v if v is not None else 1.0 for v in resid(k)), bounds=(-0.3, 0.3), method="bounded", options={"xatol": 1e-5})
            k = round(float(res.x), 4)
            r = resid(k)
            if None in r:
                raise SystemExit(f"{model} {i}-{j}: at the optimum k_ij = {k} {r.count(None)} data points have no bubble pressure")
            dev = [100 * (math.exp(v) - 1) for v in r]
            aad = sum(abs(d) for d in dev) / len(dev)
            Ts = sorted({T for T, _, _ in pts})
            q = f"AAD {aad:.2f} % in P (deviations {min(dev):.1f} to {max(dev):.1f} %)"
            print(f"{model} {i}-{j}: k_ij = {k:.4f}, {q}, {len(pts)} points")
            entry = {
                "model": model, "i": i, "j": j, "kij": k, "tier": "fitted",
                "source": {
                    "fit": f"Fitted for Fugacity with validation/python/eos_fit_kij.py to the {len(pts)} total pressures of {fit['cite']} at {', '.join(f'{T:g}' for T in Ts)} K (the equation of state's own vapour pressures): {q}",
                    "data": [f"validation/data/{fit['file']}"],
                    "conditions": f"T = {', '.join(f'{T:g}' for T in Ts)} K, P = {min(p for _, _, p in pts):g}-{max(p for _, _, p in pts):g} kPa",
                    "T_range_K": [min(Ts), max(Ts)],
                },
            }
            idx = [n for n, p in enumerate(doc["pairs"]) if p["model"] == model and {p["i"], p["j"]} == {i, j}]
            if idx:
                if doc["pairs"][idx[0]].get("tier") != "fitted":
                    raise SystemExit(f"{model} {i}-{j}: a databank value exists; keep it under 'replaced' as for hydrogen + toluene")
                doc["pairs"][idx[0]] = entry
            else:
                doc["pairs"].append(entry)


def fit_txy(doc):
    """kij of the TXY_FITS entries, both models, added or replaced in doc (tier "fitted")."""
    for fit in TXY_FITS:
        i, j = fit["pair"]
        pts = load_txy(fit["file"])
        for model in ("PR", "SRK"):
            e = Cubic(model, [i, j])

            def calc(k):
                """Bubble points at k; None where there is none within 25 K of the data."""
                e.k[0, 1] = e.k[1, 0] = k
                out = []
                for P, x, T, _ in pts:
                    try:
                        out.append(bubble_t(e, P, x, T))
                    except ValueError:
                        out.append(None)
                return out

            def obj(k):
                return sum(((r[0] - T) / 0.5) ** 2 if r else (25 / 0.5) ** 2 for r, (_, _, T, _) in zip(calc(k), pts))

            res = minimize_scalar(obj, bounds=(-0.3, 0.3), method="bounded", options={"xatol": 1e-5})
            k = round(float(res.x), 4)
            out = calc(k)
            if None in out:
                raise SystemExit(f"{model} {i}-{j}: at the optimum k_ij = {k} {out.count(None)} data points have no bubble point within 25 K")
            dT = [abs(Tc - T) for (Tc, _), (_, _, T, _) in zip(out, pts)]
            dy = [abs(yc - y) for (_, yc), (_, _, _, y) in zip(out, pts)]
            q = f"AAD {sum(dT) / len(dT):.2f} K in T (max {max(dT):.2f} K), {sum(dy) / len(dy):.4f} in y (max {max(dy):.4f})"
            print(f"{model} {i}-{j}: k_ij = {k:.4f}, {q}, {len(pts)} points")
            Ts = [T for _, _, T, _ in pts]
            entry = {
                "model": model, "i": i, "j": j, "kij": k, "tier": "fitted",
                "source": {
                    "fit": f"Fitted for Fugacity with validation/python/eos_fit_kij.py to the {len(pts)} bubble temperatures of Kamihama et al. (2012) at {pts[0][0]} kPa: {q}",
                    "data": [f"validation/data/{fit['file']}"],
                    "conditions": f"P = {pts[0][0]} kPa, T = {min(Ts):g}-{max(Ts):g} K",
                    "T_range_K": [min(Ts), max(Ts)],
                },
            }
            idx = [n for n, p in enumerate(doc["pairs"]) if p["model"] == model and {p["i"], p["j"]} == {i, j}]
            if idx:
                old = doc["pairs"][idx[0]]
                if old.get("tier") != "fitted":
                    raise SystemExit(f"{model} {i}-{j}: a databank value exists; keep it under 'replaced' as for hydrogen + toluene")
                doc["pairs"][idx[0]] = entry
            else:
                doc["pairs"].append(entry)


def main():
    path = os.path.join(ROOT, "src", "data", "kij.json")
    doc = json.load(open(path))
    fit_txy(doc)
    fit_px(doc)
    for fit in FITS:
        i, j = fit["pair"]
        pts = fit["data"]()
        Ts = [p[0] for p in pts]
        for model in fit["models"]:
            e = Cubic(model, [i, j])

            def resid(k):
                e.k[0, 1] = e.k[1, 0] = k
                return [math.log(bubble_p(e, T, x, P) / P) for T, x, P, _ in pts]

            def obj(k):
                r = resid(k)
                return sum(v * v for v in r)

            res = minimize_scalar(obj, bounds=(-0.3, 1.0), method="bounded", options={"xatol": 1e-5})
            k = round(float(res.x), 4)
            dev = [100 * (math.exp(v) - 1) for v in resid(k)]
            aad = sum(abs(d) for d in dev) / len(dev)
            print(f"{model} {i}-{j}: k_ij = {k:.4f}, AAD P = {aad:.2f} %, range {min(dev):.2f} to {max(dev):.2f} %, {len(pts)} points")
            for (T, x, P, src), d in zip(pts, dev):
                print(f"   {src:10s} T={T:7.2f} x_H2={x:.6f} P_exp={P:7.1f} kPa  dev {d:6.2f} %")
            # replace the entry
            idx = [n for n, p in enumerate(doc["pairs"]) if p["model"] == model and {p["i"], p["j"]} == {i, j}]
            old = doc["pairs"][idx[0]] if idx else None
            replaced = old.get("replaced") if old and old.get("tier") == "fitted" else (
                {"kij": old["kij"], "tier": old["tier"], "source": old["source"], "alternatives": old.get("alternatives", []), "reason": fit["reason"]} if old else None)
            entry = {
                "model": model, "i": i, "j": j, "kij": k, "tier": "fitted",
                "source": {
                    "fit": f"Fitted for Fugacity with validation/python/eos_fit_kij.py to {len(pts)} bubble pressures: AAD {aad:.2f} %, deviations {min(dev):.1f} to {max(dev):.1f} %",
                    "data": fit["data_files"],
                    "conditions": f"T = {min(Ts):g}-{max(Ts):g} K, P = {min(p[2] for p in pts):g}-{max(p[2] for p in pts):g} kPa, x_H2 <= {max(p[1] for p in pts):g}",
                    "T_range_K": [min(Ts), max(Ts)],
                },
                "replaced": replaced,
            }
            if idx:
                doc["pairs"][idx[0]] = entry
            else:
                doc["pairs"].append(entry)
    if "--write" in sys.argv:
        with open(path, "w") as f:
            json.dump(doc, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print("wrote", path)


if __name__ == "__main__":
    main()
