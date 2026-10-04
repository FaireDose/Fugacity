"""Peng-Robinson and SRK k_ij for gas pairs with no databank value, fitted to bubble points of
CoolProp's reference mixture models (proposal 0004, step 3: the methanol synthesis, air
separation and light-hydrocarbon benchmarks).

CoolProp 8.0.0 (open source, MIT) evaluates multi-fluid Helmholtz-energy mixture models whose
binary parameters were fitted to measured mixture data:
  Kunz-JCED-2012       O. Kunz, W. Wagner, The GERG-2008 Wide-Range Equation of State for
                       Natural Gases and Other Mixtures, J. Chem. Eng. Data 57 (2012) 3032-3091
  Bell-JCED-2016       I. H. Bell, E. W. Lemmon, Automatic fitting of binary interaction
                       parameters for multi-fluid Helmholtz-energy-explicit mixture models,
                       J. Chem. Eng. Data 61 (2016)
  Gernert-Thesis-2013  G. J. Gernert, A New Helmholtz Energy Model for Humid Gases and CCS
                       Mixtures, PhD thesis, Ruhr-Universitaet Bochum (2013)
(citations as in CoolProp's CoolPropBibTeXLibrary.bib). A pair whose CoolProp parameters are
the defaults (beta_T = gamma_T = 1, no departure function) is not fitted to anything and is
left out. Pairs with water are left out too: the benchmarks use Henry constants for gases
dilute in water.

For each pair the script computes bubble points (T, x1 -> P, y1) with CoolProp at three
temperatures and five liquid compositions, writes them to
validation/data/eos/coolprop_mixture_bubble.json, and fits k_ij to them (sum of squared
ln(P_calc / P_CoolProp), bubble pressures of the independent Python implementation,
eos_fit_kij.bubble_p_fresh). Pairs with a databank (ChemSep) value are not refitted; for them
the same comparison is printed as a check.

Usage: python validation/python/eos_kij_from_coolprop.py [--write]
"""
import itertools
import json
import math
import os
import sys

import CoolProp
import CoolProp.CoolProp as CP
import numpy as np
from scipy.optimize import minimize_scalar

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eos_fit_kij import bubble_p_fresh  # noqa: E402
from reference_eos import Cubic  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
KIJ = os.path.join(ROOT, "src", "data", "kij.json")
OUT = os.path.join(ROOT, "validation", "data", "eos", "coolprop_mixture_bubble.json")
COMPS = json.load(open(os.path.join(ROOT, "src", "data", "components.json")))["components"]
CITE = {
    "Kunz-JCED-2012": "O. Kunz, W. Wagner, J. Chem. Eng. Data 57 (2012) 3032 (GERG-2008)",
    "Bell-JCED-2016": "I. H. Bell, E. W. Lemmon, J. Chem. Eng. Data 61 (2016)",
    "Gernert-Thesis-2013": "G. J. Gernert, PhD thesis, Ruhr-Universitaet Bochum (2013)",
}
# components of the gas benchmarks (methanol synthesis, air separation, light hydrocarbons)
BENCH = ["hydrogen", "carbon-monoxide", "carbon-dioxide", "methane", "nitrogen", "methanol", "dimethyl-ether",
         "hydrogen-sulfide", "oxygen", "argon", "ethane", "ethylene", "propane", "propylene", "n-butane",
         "isobutane", "ammonia"]


def coolprop_names():
    fl = CP.FluidsList()
    fl = fl.split(",") if isinstance(fl, str) else fl
    by_cas = {CP.get_fluid_param_string(f, "CAS"): f for f in fl}
    return {cid: by_cas[c["cas"]] for cid, c in COMPS.items() if c["cas"] in by_cas}


def pair_model(a, b):
    """CoolProp's binary model for the pair: (BibTeX key, fitted?) or None."""
    ca, cb = COMPS[a]["cas"], COMPS[b]["cas"]
    for x, y in ((ca, cb), (cb, ca)):
        try:
            g = lambda k: CP.get_mixture_binary_pair_data(x, y, k)
            fitted = not (float(g("betaT")) == 1 and float(g("gammaT")) == 1 and float(g("F")) == 0)
            return g("BibTeX"), fitted
        except Exception:
            continue
    return None


def bubble_points(fa, fb, a, b):
    """CoolProp bubble points: [(T_K, x_a, P_kPa, y_a)] at three temperatures below the
    heavier component's critical temperature and above both triple points."""
    AS = CP.AbstractState("HEOS", f"{fa}&{fb}")
    Tc = sorted([COMPS[a]["Tc_K"], COMPS[b]["Tc_K"]])
    Tt = max(CP.PropsSI("Ttriple", fa), CP.PropsSI("Ttriple", fb))
    lo, hi = max(Tt + 5, 0.55 * Tc[1]), 0.92 * Tc[1]
    if hi <= lo:
        return []
    pts = []
    for T in np.linspace(lo, hi, 3):
        for x in (0.1, 0.3, 0.5, 0.7, 0.9):
            try:
                AS.set_mole_fractions([x, 1 - x])
                AS.update(CP.QT_INPUTS, 0, T)
                P, y = AS.p() / 1000, AS.mole_fractions_vapor()[0]
            except Exception:
                continue
            if 1 < P < 15000 and abs(y - x) > 1e-3:
                pts.append((round(float(T), 3), x, round(float(P), 4), round(float(y), 5)))
    return pts


def fit(model, a, b, pts):
    e = Cubic(model, [a, b])

    def resid(k):
        e.k[0, 1] = e.k[1, 0] = k
        out = []
        for T, x, P, _ in pts:
            try:
                out.append(math.log(bubble_p_fresh(e, T, x, P) / P))
            except ValueError:
                out.append(None)
        return out

    res = minimize_scalar(lambda k: sum(v * v if v is not None else 1.0 for v in resid(k)),
                          bounds=(-0.3, 0.4), method="bounded", options={"xatol": 1e-5})
    k = round(float(res.x), 4)
    r = resid(k)
    return k, r


def main(write):
    names = coolprop_names()
    doc = json.load(open(KIJ))
    have = {(p["model"], frozenset((p["i"], p["j"]))) for p in doc["pairs"]}
    ref = {"_about": "Bubble points of CoolProp's reference mixture models, used by validation/python/eos_kij_from_coolprop.py to fit Peng-Robinson and SRK k_ij. Rows: T in K, liquid mole fraction of the first component, bubble pressure in kPa, vapour mole fraction of the first component.",
           "source": {"citation": f"CoolProp {CoolProp.__version__} (open source, MIT), HEOS backend, multi-fluid mixture models; binary parameters per pair as named in `model`", "url": "https://github.com/CoolProp/CoolProp", "access": "Open source (MIT); the mixture models are published (Kunz and Wagner 2012; Bell and Lemmon 2016; Gernert 2013)"},
           "columns": ["T_K", "x_1", "P_kPa", "y_1"], "pairs": []}
    added = []
    for a, b in itertools.combinations(BENCH, 2):
        if a not in names or b not in names:
            continue
        pm = pair_model(a, b)
        if pm is None or not pm[1]:
            continue
        pts = bubble_points(names[a], names[b], a, b)
        if len(pts) < 6:
            print(f"{a}-{b}: {len(pts)} CoolProp bubble points, not enough; left out")
            continue
        ref["pairs"].append({"components": [a, b], "model": pm[0], "rows": pts})
        for model in ("PR", "SRK"):
            if (model, frozenset((a, b))) in have:
                e = Cubic(model, [a, b])
                old = next(p for p in doc["pairs"] if p["model"] == model and {p["i"], p["j"]} == {a, b})
                e.k[0, 1] = e.k[1, 0] = old["kij"]
                dev = []
                for T, x, P, _ in pts:
                    try:
                        dev.append(100 * abs(bubble_p_fresh(e, T, x, P) / P - 1))
                    except ValueError:
                        pass
                print(f"check {model} {a}-{b}: {old['tier']} k_ij = {old['kij']}: AAD {np.mean(dev):.2f} % in P against CoolProp ({len(dev)}/{len(pts)} points)")
                continue
            k, r = fit(model, a, b, pts)
            if None in r:
                print(f"{model} {a}-{b}: at k_ij = {k} {r.count(None)} points without a bubble pressure; left out")
                continue
            dev = [100 * (math.exp(v) - 1) for v in r]
            aad = sum(abs(d) for d in dev) / len(dev)
            Ts = sorted({p[0] for p in pts})
            q = f"AAD {aad:.2f} % in P (deviations {min(dev):.1f} to {max(dev):.1f} %)"
            print(f"{model} {a}-{b}: k_ij = {k:.4f}, {q}, {len(pts)} points ({pm[0]})")
            doc["pairs"].append({
                "model": model, "i": a, "j": b, "kij": k, "tier": "fitted",
                "source": {
                    "fit": f"Fitted for Fugacity with validation/python/eos_kij_from_coolprop.py to {len(pts)} bubble pressures of the CoolProp {CoolProp.__version__} mixture model ({CITE[pm[0]]}, fitted to measured mixture data): {q}",
                    "data": ["validation/data/eos/coolprop_mixture_bubble.json"],
                    "conditions": f"T = {', '.join(f'{T:g}' for T in Ts)} K, x = 0.1-0.9",
                    "T_range_K": [Ts[0], Ts[-1]],
                },
            })
            added.append((model, a, b))
    print(f"{len(added)} k_ij fitted")
    if write:
        with open(OUT, "w") as f:
            json.dump(ref, f, indent=1)
            f.write("\n")
        with open(KIJ, "w") as f:
            json.dump(doc, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print("wrote", OUT, "and", KIJ)


if __name__ == "__main__":
    main("--write" in sys.argv)
