"""
Independent reference for the two-phase flash (src/equilibrium/flash.js, proposal 0001 step 4).

  - Phase split (T-P, P-VF, T-VF flashes): the open-source `thermo` library's FlashVL (MIT) with
    the same parameters: activity models with an ideal-gas vapour (reference_dew.thermo_flasher),
    with a PR/SRK vapour and phi_sat at the databank vapour pressure
    (reference_gamma_phi.thermo_flasher), and PR/SRK for both phases (CEOSLiquid + CEOSGas).
  - P-H flashes: thermo's T-P split inside scipy.optimize.brentq on T, with the enthalpies
    from reference_enthalpy.py (independent pieces: scipy quadrature of the heat capacities,
    IAPWS-IF97 via `iapws`, the separate Python cubic, thermo's excess enthalpy) on the liquid
    heat-capacity basis.
Neither shares code with the JavaScript engine. Writes validation/fixtures/flash.json.

Usage: python validation/python/reference_flash.py
"""
import json
import warnings
from pathlib import Path

import numpy as np
from scipy.optimize import brentq

from reference_model import System, COMPONENTS
from reference_eos import kmatrix
import reference_dew
import reference_gamma_phi
from reference_enthalpy import liquid_h, vapour_h, h_ig
from reference_eos import Cubic

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "flash.json"


def eos_flasher(model, ids):
    from thermo import CEOSGas, CEOSLiquid, ChemicalConstantsPackage, FlashVL, HeatCapacityGas, PRMIX, SRKMIX
    cls = PRMIX if model == "PR" else SRKMIX
    consts = ChemicalConstantsPackage(Tcs=[COMPONENTS[i]["Tc_K"] for i in ids], Pcs=[COMPONENTS[i]["Pc_Pa"] for i in ids],
                                      omegas=[COMPONENTS[i]["omega"] for i in ids], MWs=[COMPONENTS[i]["MW"] for i in ids],
                                      CASs=[COMPONENTS[i]["cas"] for i in ids])
    cps = [HeatCapacityGas(poly_fit=(50.0, 1500.0, [0, 0, 0, 0, 0, 0, 0, 0, 35.0])) for _ in ids]
    kw = dict(Tcs=consts.Tcs, Pcs=consts.Pcs, omegas=consts.omegas, kijs=kmatrix(model, ids).tolist())
    return FlashVL(consts, None, liquid=CEOSLiquid(cls, kw, HeatCapacityGases=cps), gas=CEOSGas(cls, kw, HeatCapacityGases=cps))


def split(res):
    """(VF, x, y) from a thermo flash result."""
    VF = res.VF if res.VF is not None else (1.0 if res.phase == "V" else 0.0)
    liq = getattr(res, "liquid0", None)
    gas = getattr(res, "gas", None)
    x = list(liq.zs) if liq is not None else None
    y = list(gas.zs) if gas is not None else None
    return VF, x, y


ACTIVITY = [  # model, vapour, components, z, list of specs
    ("NRTL", "ideal", ["ethanol", "water"], [0.4, 0.6],
     [{"T": 360.0, "P": 101.325}, {"T": 355.0, "P": 101.325}, {"P": 101.325, "VF": 0.5}, {"T": 360.0, "VF": 0.3},
      {"P": 101.325, "H": -20000.0}, {"P": 101.325, "H": -38000.0}, {"P": 101.325, "H": 5000.0}]),
    ("UNIQUAC", "ideal", ["methanol", "acetone", "chloroform"], [0.3, 0.3, 0.4],
     [{"T": 331.0, "P": 101.325}, {"P": 101.325, "VF": 0.7}, {"P": 101.325, "H": -15000.0}]),
    ("NRTL", "ideal", ["benzene", "toluene"], [0.5, 0.5], [{"T": 365.0, "P": 101.325}, {"P": 101.325, "H": -10000.0}]),
    ("NRTL", "PR", ["ethanol", "water"], [0.5, 0.5], [{"T": 430.0, "P": 1000.0}, {"P": 1000.0, "H": -15000.0}]),
]
EOS = [
    ("PR", ["methane", "ethane"], [0.5, 0.5], [{"T": 220.0, "P": 2000.0}, {"T": 200.0, "VF": 0.4}, {"P": 2000.0, "H": -6000.0}]),
    ("SRK", ["nitrogen", "methane"], [0.4, 0.6], [{"T": 140.0, "P": 2000.0}, {"P": 2000.0, "VF": 0.5}]),
]


def activity_H(s, vap, VF, x, y, T, P):
    h = 0.0
    if VF < 1:
        h += (1 - VF) * liquid_h(s, x, T, vap)[0]
    if VF > 0:
        h += VF * vapour_h(s.ids, y, T, P, vap)
    return h


def eos_H(model, ids, VF, x, y, T, P):
    cub = Cubic(model, ids)
    def h(ph, c):
        return sum(ci * h_ig(cid, T) for cid, ci in zip(ids, c)) + cub.h_res(T, P * 1000, np.asarray(c), ph)
    return (h("liquid", x) if VF < 1 else 0) * (1 - VF) + (h("vapour", y) if VF > 0 else 0) * VF


def solve(fl, spec, z, Hfun):
    if "H" in spec:
        P = spec["P"]
        def f(T):
            VF, x, y = split(fl.flash(T=T, P=P * 1000, zs=z))
            return Hfun(VF, x or z, y or z, T, P) - spec["H"]
        Tb = fl.flash(VF=0, P=P * 1000, zs=z).T
        Td = fl.flash(VF=1, P=P * 1000, zs=z).T
        lo, hi = Tb - 1e-9, Td + 1e-9
        while f(lo) > 0: lo -= 20.0
        while f(hi) < 0: hi += 40.0
        T = brentq(f, lo, hi, xtol=1e-10)
        VF, x, y = split(fl.flash(T=T, P=P * 1000, zs=z))
        return T, P, VF, x, y
    if "VF" in spec:
        r = fl.flash(VF=spec["VF"], P=spec["P"] * 1000, zs=z) if "P" in spec else fl.flash(VF=spec["VF"], T=spec["T"], zs=z)
        VF, x, y = split(r)
        return r.T, r.P / 1000, VF, x, y
    VF, x, y = split(fl.flash(T=spec["T"], P=spec["P"] * 1000, zs=z))
    return spec["T"], spec["P"], VF, x, y


def main():
    warnings.simplefilter("ignore", RuntimeWarning)
    cases = []
    for model, vap, ids, z, specs in ACTIVITY:
        s = System(ids, model)
        fl = reference_dew.thermo_flasher(s) if vap == "ideal" else reference_gamma_phi.thermo_flasher(reference_gamma_phi.GammaPhi(ids, model, vap))
        for spec in specs:
            T, P, VF, x, y = solve(fl, spec, z, lambda VF, x, y, T, P: activity_H(s, vap, VF, x, y, T, P))
            H = activity_H(s, vap, VF, x or z, y or z, T, P)
            cases.append({"model": model, "vapour": vap, "components": ids, "z": z, "spec": spec,
                          "T_K": T, "P_kPa": P, "VF": VF, "x": x, "y": y, "H_J_mol": H})
            print(model, vap, "+".join(ids), spec, f"T={T:.5f} P={P:.5f} VF={VF:.6f} H={H:.2f}")
    for model, ids, z, specs in EOS:
        fl = eos_flasher(model, ids)
        for spec in specs:
            T, P, VF, x, y = solve(fl, spec, z, lambda VF, x, y, T, P: eos_H(model, ids, VF, x, y, T, P))
            H = eos_H(model, ids, VF, x or z, y or z, T, P)
            cases.append({"model": model, "components": ids, "z": z, "spec": spec,
                          "T_K": T, "P_kPa": P, "VF": VF, "x": x, "y": y, "H_J_mol": H})
            print(model, "+".join(ids), spec, f"T={T:.5f} P={P:.5f} VF={VF:.6f} H={H:.2f}")
    OUT.write_text(json.dumps({
        "_about": "Two-phase flashes from validation/python/reference_flash.py: phase split by the thermo library's "
                  "FlashVL with the same parameters; enthalpy flashes by brentq on T with the independent enthalpies "
                  "of reference_enthalpy.py (liquid heat-capacity basis).",
        "cases": cases}, indent=1))
    print(f"wrote {len(cases)} cases to {OUT}")


if __name__ == "__main__":
    main()
