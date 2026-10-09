"""
Hard two-phase T-P flashes with an equation of state, for test/flash-hard.test.js: points very close to the bubble
and dew points (vapour fractions near 0 and 1) and at high pressure, where successive substitution on the K-values is
slow and the engine switches to Newton's method (src/equilibrium/flash.js, splitEos / newtonEos). Points below the
melting point of a component are skipped (docs/METHOD_SELECTION.md): they would not be liquid-vapour states.

Reference: the open-source thermo library's FlashVL (MIT) with the same Peng-Robinson parameters (eos_flasher of
reference_flash.py: the databank's Tc, Pc, omega and k_ij), never the JavaScript engine; its solution is polished with
scipy's root on the equilibrium equations with thermo's own fugacity coefficients (near the critical region FlashVL
stops at a residual of about 1e-7, stored as thermo_residual). The bubble and dew temperatures that place the points
come from thermo too.

Writes validation/fixtures/flash-hard.json.

Usage: python validation/python/reference_flash_hard.py
"""
import json
import warnings
from pathlib import Path

import numpy as np
from scipy.optimize import brentq, root

from reference_flash import eos_flasher, split
from reference_model import COMPONENTS

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "flash-hard.json"

# a natural-gas-like mixture and a CO2-rich one (compositions chosen for the test, not data)
MIXTURES = [
    ("PR", ["nitrogen", "carbon-dioxide", "methane", "ethane", "propane", "n-butane", "n-pentane", "n-hexane", "n-heptane"],
     [0.02, 0.03, 0.55, 0.12, 0.09, 0.07, 0.05, 0.04, 0.03], [1000.0, 3000.0, 6000.0]),
    ("PR", ["methane", "ethane", "propane", "isobutane", "n-butane"], [0.3, 0.25, 0.2, 0.1, 0.15], [2000.0, 4000.0, 6000.0, 7000.0, 7500.0, 7800.0]),
    ("PR", ["carbon-dioxide", "methane", "propane", "n-decane"], [0.6, 0.2, 0.1, 0.1], [2000.0, 5000.0]),
    ("SRK", ["methane", "ethane", "propane", "n-butane"], [0.4, 0.3, 0.2, 0.1], [1500.0, 4000.0, 7000.0, 8000.0, 8500.0, 8800.0]),
]
# up to close below the highest pressure of the two-phase region (the cricondenbar), where the phases become alike and
# successive substitution slows down most; where between the bubble (0) and the dew (1) temperature:
FRACTIONS = [1e-4, 1e-3, 0.02, 0.5, 0.98, 0.999, 0.9999]


def polish(res, z, T, P):
    """thermo's FlashVL stops near the critical region with a residual of about 1e-7 in ln K; its solution is refined
    here with scipy's root on the same equations, F_i = ln K_i - ln phi_i^L(x) + ln phi_i^V(y), with thermo's own
    phases (to_TP_zs, lnphis) and the Rachford-Rice vapour fraction solved by brentq, to max |F| < 1e-12."""
    z = np.asarray(z)
    liq, gas = res.liquid0, res.gas

    def comp(lnK):
        K = np.exp(lnK)
        f = lambda V: float(np.sum(z * (K - 1) / (1 + V * (K - 1))))  # noqa: E731
        V = brentq(f, 1 / (1 - K.max()) + 1e-14, 1 / (1 - K.min()) - 1e-14, xtol=1e-15)
        x = z / (1 + V * (K - 1))
        return V, x, K * x

    def F(lnK):
        V, x, y = comp(lnK)
        return lnK - np.asarray(liq.to_TP_zs(T=T, P=P * 1000, zs=list(x)).lnphis()) + \
            np.asarray(gas.to_TP_zs(T=T, P=P * 1000, zs=list(y)).lnphis())

    lnK0 = np.log(np.asarray(gas.zs) / np.asarray(liq.zs))
    sol = root(F, lnK0, method="hybr", tol=1e-15)
    if not np.max(np.abs(F(sol.x))) < 1e-12:
        raise RuntimeError("polishing did not converge: %s" % np.max(np.abs(F(sol.x))))
    V, x, y = comp(sol.x)
    return float(V), list(map(float, x)), list(map(float, y)), float(np.max(np.abs(F(lnK0))))


def main():
    warnings.simplefilter("ignore")
    cases = []
    for model, ids, z, Ps in MIXTURES:
        fl = eos_flasher(model, ids)
        for P in Ps:
            try:
                Tb = fl.flash(VF=0, P=P * 1000, zs=z).T
                Td = fl.flash(VF=1, P=P * 1000, zs=z).T
            except Exception as e:  # noqa: BLE001 - above the mixture's highest two-phase pressure: no points
                print("skip", model, P, e)
                continue
            # no point below the melting point of a component (docs/METHOD_SELECTION.md, rule 8): it would freeze
            Tm = max((COMPONENTS[c].get("fusion", {}).get("Tm_K") or 0) for c in ids)
            for f in FRACTIONS:
                T = Tb + f * (Td - Tb)
                if T < Tm:
                    print("skip: below a melting point", model, P, f)
                    continue
                res = fl.flash(T=T, P=P * 1000, zs=z)
                VF, x, y = split(res)
                if x is None or y is None:
                    print("single phase at", model, P, f)
                    continue
                VF, x, y, thermo_residual = polish(res, z, T, P)
                cases.append({"model": model, "components": ids, "z": z, "T_K": T, "P_kPa": P, "between": f,
                              "Tb_K": Tb, "Td_K": Td, "VF": VF, "x": x, "y": y, "thermo_residual": thermo_residual})
                print(f"{model} {len(ids)} comp. P {P:6.0f} kPa  T {T:8.3f} K ({f:g} of {Tb:.2f}-{Td:.2f})  VF {VF:.6f}")
    OUT.write_text(json.dumps({"_about": "Two-phase T-P flashes close to bubble and dew points, from thermo's FlashVL with "
                                         "the databank's parameters (validation/python/reference_flash_hard.py). Do not "
                                         "edit by hand.", "cases": cases}, indent=1) + "\n")
    print("wrote %d cases to %s" % (len(cases), OUT))


if __name__ == "__main__":
    main()
