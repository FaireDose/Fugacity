"""
Independent reference for the flowsheet solver (src/flowsheet/flowsheet.js, proposal 0006 step 3).

The JavaScript solver is sequential modular: it tears the recycle and iterates (direct
substitution, then Wegstein). Here the same flowsheets are solved equation-oriented: the
recycle flows are the unknowns of one system of equations,

    R - r * L(F + R) = 0,

with F the feed, r the recycle fraction of the splitter and L(.) the liquid (or vapour) flow
of the flash drum, solved all at once with scipy.optimize.root (hybrid Powell, or Levenberg-Marquardt when the
flash's own tolerance stalls it); the residual is below 1e-8 of the feed flow. The drum is the
independent flash of reference_flash.py (the thermo library's FlashVL with the same
parameters), never the JavaScript engine. The drum specifications are T-P and P-VF, so no
enthalpy enters these cases.

Writes validation/fixtures/flowsheet.json.

Usage: python validation/python/reference_flowsheet.py
"""
import json
import warnings
from pathlib import Path

import numpy as np
from scipy.optimize import root

from reference_model import System
import reference_dew
from reference_flash import eos_flasher, solve

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "flowsheet.json"

# feed (kmol/h) -> mixer -> flash drum -> the recycled phase -> splitter (fraction r back to the mixer)
CASES = [
    dict(name="ethanol-water liquid recycle", model="NRTL", components=["ethanol", "water"], feed=[30.0, 70.0],
         drum={"T": 360.0, "P": 101.325}, recycle_phase="liquid", r=0.7),
    dict(name="methanol-acetone-chloroform liquid recycle", model="UNIQUAC", components=["methanol", "acetone", "chloroform"],
         feed=[30.0, 30.0, 40.0], drum={"P": 101.325, "VF": 0.5}, recycle_phase="liquid", r=0.5),
    dict(name="methane-ethane vapour recycle", model="PR", components=["methane", "ethane"], feed=[50.0, 50.0],
         drum={"T": 220.0, "P": 2000.0}, recycle_phase="vapour", r=0.6),
]


def flasher(model, ids):
    if model in ("PR", "SRK"):
        return eos_flasher(model, ids)
    return reference_dew.thermo_flasher(System(ids, model))


def drum(fl, spec, flows):
    """(T, P, VF, vapour flows, liquid flows) of the drum fed with these flows."""
    F = float(np.sum(flows))
    z = list(np.asarray(flows) / F)
    T, P, VF, x, y = solve(fl, spec, z, None)
    x = np.asarray(x if x is not None else z)
    y = np.asarray(y if y is not None else z)
    return T, P, VF, VF * F * y, (1 - VF) * F * x


def main():
    warnings.simplefilter("ignore", RuntimeWarning)
    out = []
    for c in CASES:
        fl = flasher(c["model"], c["components"])
        feed = np.asarray(c["feed"])
        pick = 3 if c["recycle_phase"] == "vapour" else 4

        def residual(R):
            res = drum(fl, c["drum"], feed + np.maximum(R, 0))
            return R - c["r"] * res[pick]

        sol = root(residual, x0=0.5 * feed, method="hybr", tol=1e-13)
        if not np.max(np.abs(residual(sol.x))) < 1e-8 * np.sum(feed):
            # thermo's P-VF flash is noisy at the 1e-10 level, which can stall hybr: Levenberg-Marquardt
            sol = root(residual, x0=sol.x, method="lm", options={"xtol": 1e-14, "ftol": 1e-14})
        R = sol.x
        assert np.max(np.abs(residual(R))) < 1e-8 * np.sum(feed), (c["name"], sol.message, residual(R))
        T, P, VF, V, L = drum(fl, c["drum"], feed + R)
        recycled = V if c["recycle_phase"] == "vapour" else L
        other = L if c["recycle_phase"] == "vapour" else V
        out.append({**c, "recycle_kmol_h": list(R), "purge_kmol_h": list((1 - c["r"]) * recycled),
                    "other_product_kmol_h": list(other), "drum_T_K": T, "drum_P_kPa": P, "drum_VF": VF})
        print(c["name"], "R =", np.round(R, 6), "T =", round(T, 5), "VF =", round(VF, 6))
    OUT.write_text(json.dumps({
        "_about": "Recycle flowsheets solved equation-oriented (scipy root on the recycle flows) with the independent "
                  "flash of reference_flash.py; validation/python/reference_flowsheet.py.",
        "cases": out}, indent=1))
    print(f"wrote {len(out)} cases to {OUT}")


if __name__ == "__main__":
    main()
