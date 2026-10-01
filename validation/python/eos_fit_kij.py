"""Fit Peng-Robinson / SRK binary parameters k_ij to open experimental data.

Used where the databank value is contradicted by open data. The fitted entry replaces the
databank entry in src/data/kij.json (tier "fitted"); the databank value is kept in
`replaced` with the reason.

Fits (objective: sum of squared ln(P_bubble,calc / P_exp) at the measured T and liquid x,
bubble pressure from the independent Python implementation in reference_eos.py):

  hydrogen + toluene, PR (the SRK databank value, +0.39, agrees with these data and is kept):
    Tsuji et al., Fluid Phase Equilib. 228-229 (2005) 499, 303.15 K, 9 points
    Aslam et al., J. Chem. Eng. Data 61 (2016) 643, 293-333 K, 510-891 kPa, 20 points
    (both from the NIST TRC ThermoML Archive; validation/data/eos/*_hydrogen_toluene.json)

Usage: python validation/python/eos_fit_kij.py [--write]
"""
import json
import math
import os
import sys

import numpy as np
from scipy.optimize import minimize_scalar

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


FITS = [
    {
        "pair": ("hydrogen", "toluene"),
        "models": ["PR"],  # SRK: the ChemSep value +0.39 fits these data as well as a refit (0.3858), see the PR
        "data": load_h2_toluene,
        "data_files": ["validation/data/eos/tsuji2005_hydrogen_toluene.json", "validation/data/eos/aslam2016_hydrogen_toluene.json"],
        "reason": "The ChemSep PR value (-0.51) under-predicts the bubble pressure of the open data sets of Tsuji et al. (2005) and Aslam et al. (2016) by 66-78 % (k_ij = 0: 38-51 %), i.e. it predicts 3-4 times too much hydrogen solubility; the SRK value from the same DECHEMA page is +0.39. Found by the independent review of pull request #13.",
    },
]


def main():
    path = os.path.join(ROOT, "src", "data", "kij.json")
    doc = json.load(open(path))
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
