"""
Independent reference for the solid-liquid equilibrium of src/equilibrium/sle.js (proposal 0007, step 4), and the
report of the ideal solubility against measured data.

  - The equilibrium equation: the open-source `chemicals` library (MIT), chemicals.solubility.solubility_eutectic,
    which cites Gmehling et al., Chemical Thermodynamics for Process Simulation (Wiley-VCH 2012) and carries a
    worked example from it.
  - Solubilities with activity coefficients: the same function with gamma from reference_model.System (the
    independent Python NRTL and UNIQUAC), solved for x by scipy's brentq.
  - Eutectics of binaries: the two liquidus temperatures from the same pieces, intersected by brentq.

Neither shares code with the JavaScript engine. Writes validation/fixtures/sle.json, and docs/SLE_CHECKS.md: the
ideal solubility (gamma = 1) of each solid against the measured solubilities of validation/data/sle/<solid>.json
(validation/python/fetch_sle.py, NIST TRC ThermoML Archive).

Usage: python validation/python/reference_sle.py
"""
import json
import statistics
from pathlib import Path

import numpy as np
from chemicals.solubility import solubility_eutectic
from scipy.optimize import brentq

from reference_model import System, COMPONENTS

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "validation" / "fixtures" / "sle.json"
DOC = ROOT / "docs" / "SLE_CHECKS.md"
SOLIDS = ["naphthalene", "benzoic-acid", "salicylic-acid"]


def fus(cid):
    f = COMPONENTS[cid]["fusion"]
    return f["Tm_K"], f["Hfus_J_mol"]


def equation_cases():
    """solubility_eutectic for a spread of inputs (gamma, heat capacity difference)."""
    out = []
    for T, Tm, Hm, Cpl, Cps, g in [(260.0, 278.68, 9952.0, 0, 0, 3.0176), (298.15, 353.39, 19030.0, 0, 0, 1.0),
                                   (298.15, 353.39, 19030.0, 200.0, 170.0, 1.0), (250.0, 395.52, 17320.0, 0, 0, 2.5),
                                   (300.0, 432.0, 24600.0, 260.0, 190.0, 0.7), (150.0, 178.0, 6614.5, 0, 0, 1.3)]:
        out.append({"T_K": T, "Tm_K": Tm, "Hfus_J_mol": Hm, "dCp_J_molK": Cpl - Cps, "gamma": g,
                    "x": solubility_eutectic(T, Tm, Hm, Cpl, Cps, g)})
    return out


def solubility(model, ids, solute, T):
    """x of the solute (binary) with gamma from the Python activity model: x = solubility_eutectic(gamma(x))."""
    i = ids.index(solute)
    Tm, Hm = fus(solute)
    if model == "ideal":
        return solubility_eutectic(T, Tm, Hm)
    s = System(ids, model)

    def f(lx):
        xi = np.exp(lx)
        x = np.array([xi, 1 - xi]) if i == 0 else np.array([1 - xi, xi])
        return lx + np.log(s.gamma(x, T)[i]) - np.log(solubility_eutectic(T, Tm, Hm))
    # the solvent-rich root: the first sign change from x = 1e-12 upwards (as the engine)
    grid = np.linspace(np.log(1e-12), 0.0, 241)
    fs = [f(u) for u in grid]
    for k in range(len(grid) - 1):
        if fs[k] < 0 <= fs[k + 1]:
            return float(np.exp(brentq(f, grid[k], grid[k + 1], xtol=1e-14)))
    raise RuntimeError("no root")


def liquidus(model, ids, k, x1):
    """Temperature at which solid k crystallizes from the liquid [x1, 1 - x1]."""
    Tm, Hm = fus(ids[k])
    x = np.array([x1, 1 - x1])
    s = None if model == "ideal" else System(ids, model)
    g = (lambda T: 1.0) if s is None else (lambda T: s.gamma(x, T)[k])
    return brentq(lambda T: np.log(x[k] * g(T)) - np.log(solubility_eutectic(T, Tm, Hm)), 0.2 * Tm, Tm - 1e-9, xtol=1e-11)


def eutectic(model, ids):
    def d(x1):
        try:
            a = liquidus(model, ids, 0, x1)
        except ValueError:
            a = 0.0
        try:
            b = liquidus(model, ids, 1, x1)
        except ValueError:
            b = 0.0
        return a - b
    grid = [10 ** e for e in np.arange(-9, -2, 0.25)] + [k / 100 for k in range(1, 100)] + \
        [1 - 10 ** e for e in np.arange(-2.25, -9.01, -0.25)]
    for a, b in zip(grid, grid[1:]):
        if d(a) < 0 <= d(b):
            xe = brentq(d, a, b, xtol=1e-14)
            return {"x1": xe, "T_K": liquidus(model, ids, 0, xe)}
    raise RuntimeError("no eutectic")


SYSTEM_CASES = [  # model, components, solute, temperatures
    ("ideal", ["naphthalene", "toluene"], "naphthalene", [260.0, 298.15, 330.0]),
    ("ideal", ["benzoic-acid", "ethanol"], "benzoic-acid", [298.15, 320.0]),
    ("NRTL", ["phenol", "water"], "phenol", [300.0, 310.0]),
    ("UNIQUAC", ["phenol", "water"], "phenol", [305.0]),
    ("NRTL", ["acetic-acid", "water"], "acetic-acid", [270.0, 285.0]),
    ("NRTL", ["water", "ethylene-glycol"], "water", [250.0, 265.0]),
]
EUTECTIC_CASES = [("ideal", ["benzene", "naphthalene"]), ("ideal", ["naphthalene", "toluene"]),
                  ("ideal", ["benzene", "p-xylene"]), ("NRTL", ["acetic-acid", "water"]),
                  ("NRTL", ["water", "ethylene-glycol"]), ("UNIQUAC", ["water", "ethylene-glycol"])]


def measured_report():
    """Ideal solubility against the measured values: per solid and solvent, the median over the articles of each
    article's median ratio x_ideal / x_measured (which is the activity coefficient the data imply, with dCp = 0)."""
    lines = ["# Solid solubility: ideal solution against measured data", "",
             "Generated by `validation/python/reference_sle.py`. For each solid, the ideal solubility (activity coefficient "
             "1, no heat-capacity term: `sys.solidSolubility` with model \"ideal\"; melting temperature and enthalpy of "
             "fusion from `src/data/components.json`) is compared with the measured solubilities of the NIST TRC ThermoML "
             "Archive in `validation/data/sle/<solid>.json` (`validation/python/fetch_sle.py`). Each article counts once "
             "(the median of its ratios); the table gives the median over the articles.", "",
             "The ratio x_ideal / x_measured is the activity coefficient of the solid in the saturated solution that the "
             "data imply. Near 1, the ideal solubility is a usable estimate; far from 1, an activity model with "
             "parameters fitted to solid-liquid data is needed (none yet: no open parameters for these pairs).", ""]
    summary = {}
    for solid in SOLIDS:
        d = json.loads((ROOT / "validation" / "data" / "sle" / ("%s.json" % solid)).read_text())
        Tm, Hm = fus(solid)
        by = {}
        for s in d["sets"]:
            for r in s["rows"]:
                if r["T_K"] >= Tm:
                    continue
                by.setdefault(s["solvent"], {}).setdefault(s["doi"], []).append(
                    (r["T_K"], solubility_eutectic(r["T_K"], Tm, Hm) / r["x_solute"]))
        lines += ["## %s" % COMPONENTS[solid]["name"], "",
                  "Melting temperature %.2f K, enthalpy of fusion %.0f J/mol (%s)." % (
                      Tm, Hm, COMPONENTS[solid]["fusion"]["source"]["name"]), "",
                  "| Solvent | Values | Articles | Range (K) | x_ideal / x_measured (median of the articles) | Articles' medians |",
                  "|---|---|---|---|---|---|"]
        for sv in sorted(by, key=lambda k: COMPONENTS[k]["name"].lower()):
            arts = by[sv]
            meds = [statistics.median(r for _, r in v) for v in arts.values()]
            Ts = [T for v in arts.values() for T, _ in v]
            med = statistics.median(meds)
            summary.setdefault(solid, {})[sv] = {"ratio": med, "articles": len(arts), "values": len(Ts)}
            lines.append("| %s | %d | %d | %.1f-%.1f | %s | %s |" % (
                COMPONENTS[sv]["name"], len(Ts), len(arts), min(Ts), max(Ts), fmt(med), ", ".join(fmt(m) for m in meds)))
        lines.append("")
    DOC.write_text("\n".join(lines))
    return summary


def fmt(v):
    return "%.3g" % v if v < 100 else "%.0f" % v


def main():
    cases = []
    for model, ids, solute, Ts in SYSTEM_CASES:
        for T in Ts:
            cases.append({"model": model, "components": ids, "solute": solute, "T_K": T, "x": solubility(model, ids, solute, T)})
    eut = [{"model": m, "components": ids, **eutectic(m, ids)} for m, ids in EUTECTIC_CASES]
    summary = measured_report()
    OUT.write_text(json.dumps({
        "_about": "Reference values for test/sle.test.js, from validation/python/reference_sle.py (chemicals."
                  "solubility_eutectic, reference_model.System, scipy brentq). Do not edit by hand.",
        "equation": equation_cases(), "solubility": cases, "eutectic": eut, "measured_summary": summary},
        indent=1) + "\n")
    print("wrote %s (%d solubilities, %d eutectics) and %s" % (OUT.relative_to(ROOT), len(cases), len(eut),
                                                              DOC.relative_to(ROOT)))


if __name__ == "__main__":
    main()
