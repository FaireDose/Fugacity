"""
Independent reference for the dew points of activity-coefficient systems
(src/equilibrium/dew.js, proposal 0001 step 1).

Two independent calculations, neither sharing code with the JavaScript engine:

1. reference_model.System (this folder) with a different method from the engine: the
   dew-point equations
       y_i P = x_i gamma_i P_i^sat           (apparent pressures for a dimerizing acid)
   are solved for (x, T) or (x, P) at once with scipy.optimize.root, from several starting
   liquids; liquids that are not stable (d2 g_mix / dx2 <= 0, binaries) are discarded and
   the solution with the lowest P (highest T) is kept.
2. The open-source `thermo` library (MIT), FlashVL with a Gibbs-excess liquid (its NRTL and
   UNIQUAC classes) and an ideal-gas vapour, with the same parameters and vapour-pressure
   equations: thermo.flash.FlashVL.flash(VF=1, P=...) and (VF=1, T=...). It has no
   chemical theory for acids, so it checks only the systems without acetic acid.

The script stops with an error if the two disagree by more than 0.01 K, 1e-3 relative in
P, or 1e-4 in x (thermo converges the dew temperature and pressure tightly, the liquid
composition only to about 1e-5), and writes validation/fixtures/dew_points.json from
calculation 1.

Usage: python validation/python/reference_dew.py
"""
import json
from pathlib import Path

import warnings

import numpy as np
from scipy.optimize import root

from reference_model import System, psat_kpa

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "dew_points.json"


def dew(s, y, P=None, T=None):
    """Dew temperature at P, or dew pressure at T. Returns (T, P, x)."""
    y = np.asarray(y, float)
    n = s.n

    def unpack(u):
        x = np.exp(u[:n]); x = x / x.sum()
        return x, u[n]

    def resid(u):
        x, v = unpack(u)
        TT, PP = (v, P) if P is not None else (T, np.exp(v))
        Pcalc, yc = s.equilibrium(x, TT)
        return np.concatenate([np.log(yc[: n - 1]) - np.log(y[: n - 1]), [np.log(Pcalc / PP)],
                               [np.log(np.exp(u[:n]).sum())]])

    def ideal_guess(TT):
        ps = np.array([psat_kpa(c, TT) for c in s.c])
        return y / ps / (y / ps).sum()

    sols = []
    starts = []
    if P is not None:
        for T0 in np.linspace(250, 550, 13):
            starts.append((ideal_guess(T0), T0))
    else:
        Pg = 1 / sum(y / np.array([psat_kpa(c, T) for c in s.c]))
        for f in (1.0, 0.5, 2.0):
            for x0 in (ideal_guess(T), y, np.full(n, 1 / n)):
                starts.append((x0, np.log(Pg * f)))
    for k in range(n):
        for x0, v0 in list(starts[:1]) + list(starts[len(starts) // 2: len(starts) // 2 + 1]):
            xr = np.full(n, 0.02) * np.maximum(y, 1e-6); xr[k] = 0.98
            starts.append((xr / xr.sum(), v0))
    for x0, v0 in starts:
        r = root(resid, np.concatenate([np.log(np.clip(x0, 1e-12, None)), [v0]]), method="hybr", options={"xtol": 1e-14})
        if not r.success or np.max(np.abs(resid(r.x))) > 1e-10:
            continue
        x, v = unpack(r.x)
        TT, PP = (v, P) if P is not None else (T, np.exp(v))
        if not (200 < TT < 700) or any(np.max(np.abs(x - q[2])) < 1e-7 for q in sols):
            continue
        if n == 2 and not stable_binary(s, x, TT):
            continue
        sols.append((TT, PP, x))
    if not sols:
        raise RuntimeError(f"no dew point for {s.ids} y={list(y)} P={P} T={T}")
    return max(sols, key=lambda q: q[0]) if P is not None else min(sols, key=lambda q: q[1])


def stable_binary(s, x, T, h=1e-5):
    """Binary liquid locally stable: d2(g_mix/RT)/dx1^2 > 0."""
    def g(x1):
        xx = np.array([x1, 1 - x1])
        return float(xx @ np.log(xx * s.gamma(xx, T)))
    x1 = min(max(x[0], 2 * h), 1 - 2 * h)
    return g(x1 + h) - 2 * g(x1) + g(x1 - h) > 0


def thermo_flasher(s):
    """thermo FlashVL with the same NRTL/UNIQUAC parameters and DIPPR-101 vapour pressures."""
    from thermo import (ChemicalConstantsPackage, PropertyCorrelationsPackage, VaporPressure,
                        HeatCapacityGas, VolumeLiquid, GibbsExcessLiquid, IdealGas, FlashVL)
    from thermo.nrtl import NRTL
    from thermo.uniquac import UNIQUAC
    n = s.n
    VPs = []
    for c in s.c:
        v = c["vapourPressure"]
        vp = VaporPressure()
        vp.add_correlation("fug", "DIPPR101", Tmin=150.0, Tmax=800.0,
                           A=v["A"], B=v["B"], C=v["C"], D=v["D"], E=v["E"])
        vp.method = "fug"
        VPs.append(vp)
    # heat capacities and liquid volumes do not enter T-VF and P-VF flashes with the "Psat"
    # equilibrium basis (no Poynting term); constants keep thermo's phase objects complete
    HCs = [HeatCapacityGas(poly_fit=(150.0, 800.0, [0.0, 30.0])) for _ in range(n)]
    VLs = [VolumeLiquid(poly_fit=(150.0, 800.0, [0.0, 1e-4])) for _ in range(n)]
    consts = ChemicalConstantsPackage(Tcs=[c["Tc_K"] for c in s.c], Pcs=[c["Pc_Pa"] for c in s.c],
                                      omegas=[c["omega"] for c in s.c], MWs=[c["MW"] for c in s.c],
                                      names=s.ids, CASs=[c.get("cas", "") for c in s.c])
    corr = PropertyCorrelationsPackage(constants=consts, VaporPressures=VPs, HeatCapacityGases=HCs, VolumeLiquids=VLs,
                                       skip_missing=True)
    xs = [1 / n] * n
    if s.model == "NRTL":
        GE = NRTL(T=300.0, xs=xs, tau_as=s.a.tolist(), tau_bs=s.b.tolist(), alpha_cs=s.alpha.tolist())
    else:
        GE = UNIQUAC(T=300.0, xs=xs, rs=s.r.tolist(), qs=s.q.tolist(), tau_as=s.a.tolist(), tau_bs=s.b.tolist())
    liq = GibbsExcessLiquid(VaporPressures=VPs, HeatCapacityGases=HCs, VolumeLiquids=VLs, GibbsExcessModel=GE,
                            equilibrium_basis="Psat", caloric_basis="Psat", T=300.0, P=1e5, zs=xs)
    gas = IdealGas(HeatCapacityGases=HCs, T=300.0, P=1e5, zs=xs)
    return FlashVL(consts, corr, liquid=liq, gas=gas)


CASES = [
    # (model, components, vapour compositions); P-dew at 101.325 kPa and T-dew at a fixed T
    ("NRTL", ["ethanol", "water"], [[0.1, 0.9], [0.5, 0.5], [0.85, 0.15]], 350.0),
    ("UNIQUAC", ["ethanol", "water"], [[0.1, 0.9], [0.5, 0.5], [0.85, 0.15]], 350.0),
    ("NRTL", ["methanol", "acetone", "chloroform"], [[0.3, 0.3, 0.4], [0.6, 0.2, 0.2], [0.1, 0.6, 0.3]], 330.0),
    ("UNIQUAC", ["methanol", "acetone", "chloroform"], [[0.3, 0.3, 0.4], [0.6, 0.2, 0.2], [0.1, 0.6, 0.3]], 330.0),
    ("NRTL", ["water", "ethyl-acetate"], [[0.1, 0.9], [0.2, 0.8], [0.5, 0.5], [0.9, 0.1]], 345.0),
    ("NRTL", ["water", "acetic-acid"], [[0.2, 0.8], [0.5, 0.5], [0.9, 0.1]], 380.0),
    ("UNIQUAC", ["water", "acetic-acid"], [[0.2, 0.8], [0.5, 0.5], [0.9, 0.1]], 380.0),
]
P0 = 101.325


def main():
    warnings.simplefilter("ignore", RuntimeWarning)  # root() probes overflow on purpose
    out, worst = [], {"T_K": 0.0, "P_rel": 0.0, "x": 0.0}
    for model, ids, ys, Tfix in CASES:
        s = System(ids, model)
        assoc = any("association" in c for c in s.c)
        fl = None if assoc else thermo_flasher(s)
        for y in ys:
            T, _, x = dew(s, y, P=P0)
            _, Pd, xp = dew(s, y, T=Tfix)
            case = {"model": model, "components": ids, "y": y,
                    "dewT": {"P_kPa": P0, "T_K": T, "x": list(x)},
                    "dewP": {"T_K": Tfix, "P_kPa": Pd, "x": list(xp)}}
            if fl is not None:
                try:
                    a = fl.flash(VF=1, P=P0 * 1000, zs=y)
                    b = fl.flash(VF=1, T=Tfix, zs=y)
                except Exception as e:  # thermo 0.6.1 fails on a few inputs; recorded, not hidden
                    case["thermo"] = {"error": f"{type(e).__name__}: {e}"}
                    print(f"thermo failed for {model} {ids} y={y}: {type(e).__name__}: {e}")
                    out.append(case)
                    continue
                dT = abs(a.T - T); dP = abs(b.P / 1000 - Pd) / Pd
                dx = max(np.max(np.abs(np.array(a.liquid0.zs) - x)), np.max(np.abs(np.array(b.liquid0.zs) - xp)))
                case["thermo"] = {"dewT_K": a.T, "dewP_kPa": b.P / 1000}
                worst = {"T_K": max(worst["T_K"], dT), "P_rel": max(worst["P_rel"], dP), "x": max(worst["x"], dx)}
                print(f"{model:8s} {'+'.join(ids):32s} y={y}: dT={dT:.1e} K dP/P={dP:.1e} dx={dx:.1e}")
                if dT > 0.01 or dP > 1e-3 or dx > 1e-4:
                    raise SystemExit(f"reference and thermo disagree for {model} {ids} y={y}: "
                                     f"dT={dT:.2e} K, dP/P={dP:.2e}, dx={dx:.2e}")
            out.append(case)
    OUT.write_text(json.dumps({
        "_about": "Dew points of activity-coefficient systems from validation/python/reference_dew.py: "
                  "scipy root on the full dew-point equations (reference_model.System), checked against "
                  "the thermo library's FlashVL for the systems without acetic acid "
                  f"(largest differences: {worst['T_K']:.1e} K, {worst['P_rel']:.1e} relative in P, "
                  f"{worst['x']:.1e} in x).",
        "cases": out}, indent=1))
    print(f"wrote {len(out)} cases to {OUT}; largest reference-thermo differences: {worst}")


if __name__ == "__main__":
    main()
