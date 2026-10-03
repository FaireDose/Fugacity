"""
Independent reference for the flash with two liquids (src/equilibrium/flash.js, proposal 0001
step 5). Activity models with the ideal-gas vapour; the liquid model of reference_model.py.

  - Binary (water + ethyl acetate): the two liquids from reference_model.lle_binary (least
    squares on the isoactivity equations), their bubble pressure P3 = sum x_i gamma_i Psat_i,
    the three-phase temperature at given P by brentq on P3(T) = P, and the phase fractions by
    the lever rule (vapour fraction or, with the enthalpies of reference_enthalpy.py, the
    energy balance). Vapour + liquid by thermo's FlashVL.
  - Ternary (ethanol + water + ethyl acetate): minimum of the Gibbs energy over the mole numbers
    of the vapour and of a second liquid (scipy SLSQP from several starts), polished by solving
    the equal-fugacity equations with scipy.optimize.root; vapour-fraction flashes by brentq on
    T. The `thermo` library's FlashVLN (MIT) with the same parameters is run on the same states
    and reported next to it, with the Gibbs energy of each answer: near the boundaries it
    misses states of lower Gibbs energy (it returns two liquids where vapour and two liquids,
    or vapour and one liquid, have a lower Gibbs energy).
Neither part shares code with the JavaScript engine. Writes validation/fixtures/three_phase.json.

Gibbs energy used for the comparisons: G/RT = sum over phases of beta sum_i x_i ln f_i, with
f_i = x_i gamma_i Psat_i (liquid) and y_i P (vapour), the same reference state in every phase.

Usage: python validation/python/reference_three_phase.py
"""
import json
import warnings
from pathlib import Path

import numpy as np
from scipy.optimize import brentq, minimize, root

from reference_model import System, psat_kpa
from reference_enthalpy import liquid_h, vapour_h
import reference_dew

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "three_phase.json"
P_ATM = 101.325


def lnf(s, kind, x, T, P):
    x = np.asarray(x, float)
    if kind == "vapour":
        return np.log(np.clip(x, 1e-300, None) * P)
    ps = np.array([psat_kpa(c, T) for c in s.c])
    return np.log(np.clip(x, 1e-300, None) * s.gamma(x, T) * ps)


def gibbs(s, T, P, phases):
    g = 0.0
    for p in phases:
        x = np.asarray(p["x"], float)
        m = x > 0
        g += p["fraction"] * float(np.sum(x[m] * lnf(s, p["type"], x, T, P)[m]))
    return g


# ------------------------------------------------------------------ binary: exact construction

def binary_ll(s, T):
    """(x_water in the ester-rich liquid, in the water-rich liquid)."""
    a, b = s.lle_binary(T, (0.2, 0.98))
    return min(a, b), max(a, b)


def p3_y3(s, T):
    lo, hi = binary_ll(s, T)
    P, y = s.equilibrium([lo, 1 - lo], T)
    return P, y, lo, hi


def t3(s, P):
    return brentq(lambda T: p3_y3(s, T)[0] - P, 330.0, 350.0, xtol=1e-11)


def lever3(xa, xb, y, z1, row, rhs):
    """Fractions (liquid a, liquid b, vapour) from sum = 1, component 1 and row . beta = rhs."""
    M = np.array([[1.0, 1.0, 1.0], [xa, xb, y], row])
    return np.linalg.solve(M, [1.0, z1, rhs])


def phases_ll(lo, hi, z1):
    f_hi = (z1 - lo) / (hi - lo)
    return [{"type": "liquid", "fraction": 1 - f_hi, "x": [lo, 1 - lo]}, {"type": "liquid", "fraction": f_hi, "x": [hi, 1 - hi]}]


def phases_three(lo, hi, y, beta):
    out = [{"type": "vapour", "fraction": beta[2], "x": [y, 1 - y]}] if beta[2] > 0 else []
    return out + [{"type": "liquid", "fraction": beta[0], "x": [lo, 1 - lo]}, {"type": "liquid", "fraction": beta[1], "x": [hi, 1 - hi]}]


def total_h(s, T, P, phases):
    h = 0.0
    for p in phases:
        h += p["fraction"] * (vapour_h(s.ids, p["x"], T, P, "ideal") if p["type"] == "vapour" else liquid_h(s, p["x"], T, "ideal")[0])
    return h


def binary_cases():
    s = System(["water", "ethyl-acetate"], "NRTL")
    T3 = t3(s, P_ATM)
    P3, y3, lo3, hi3 = p3_y3(s, T3)
    y3 = float(y3[0])
    print(f"binary NRTL: T3 = {T3:.6f} K, x = {lo3:.6f} / {hi3:.6f}, y3 = {y3:.6f}")
    cases = []
    add = lambda spec, z, T, P, phases, note="": cases.append({
        "model": "NRTL", "components": ["water", "ethyl-acetate"], "z": z, "spec": spec, "T_K": T, "P_kPa": P,
        "phases": phases, "H_J_mol": total_h(s, T, P, phases), "G_RT": gibbs(s, T, P, phases), "note": note})
    # T-P flashes with two liquids (below the three-phase temperature)
    for T, z1 in [(300.0, 0.5), (320.0, 0.21), (340.0, 0.3), (340.0, 0.98), (343.7, 0.5)]:
        lo, hi = binary_ll(s, T)
        P3T = p3_y3(s, T)[0]
        assert P3T < P_ATM and lo < z1 < hi
        add({"T": T, "P": P_ATM}, [z1, 1 - z1], T, P_ATM, phases_ll(lo, hi, z1), f"two liquids; they boil at {P3T:.4f} kPa")
    # vapour-fraction flashes at the three-phase temperature
    for z1, VF in [(0.5, 0.0), (0.98, 0.0), (0.3, 0.0), (0.5, 0.2), (0.5, 0.7)]:
        beta = lever3(lo3, hi3, y3, z1, [0.0, 0.0, 1.0], VF)
        add({"P": P_ATM, "VF": VF}, [z1, 1 - z1], T3, P_ATM, phases_three(lo3, hi3, y3, beta), "three-phase temperature, lever rule")
    # enthalpy flashes: at the three-phase temperature (energy balance), and two liquids below it
    for z1, H in [(0.3, -20000.0), (0.5, -21000.0)]:
        ha = liquid_h(s, [lo3, 1 - lo3], T3, "ideal")[0]
        hb = liquid_h(s, [hi3, 1 - hi3], T3, "ideal")[0]
        hv = vapour_h(s.ids, [y3, 1 - y3], T3, P_ATM, "ideal")
        beta = lever3(lo3, hi3, y3, z1, [ha, hb, hv], H)
        assert np.all(beta > 0)
        add({"P": P_ATM, "H": H}, [z1, 1 - z1], T3, P_ATM, phases_three(lo3, hi3, y3, beta), "three-phase temperature, energy balance")
    z1 = 0.5
    h_ll = lambda T: total_h(s, T, P_ATM, phases_ll(*binary_ll(s, T), z1))
    H = h_ll(T3) - 2000.0
    T = brentq(lambda T: h_ll(T) - H, 300.0, T3, xtol=1e-11)
    add({"P": P_ATM, "H": H}, [z1, 1 - z1], T, P_ATM, phases_ll(*binary_ll(s, T), z1), "two liquids below the three-phase temperature")
    # vapour-fraction flashes at given T: the three-phase pressure
    T = 343.0
    P3T, y, lo, hi = p3_y3(s, T)
    for VF in (0.0, 0.3):
        beta = lever3(lo, hi, float(y[0]), 0.5, [0.0, 0.0, 1.0], VF)
        add({"T": T, "VF": VF}, [0.5, 0.5], T, P3T, phases_three(lo, hi, float(y[0]), beta), "three-phase pressure, lever rule")
    # vapour + water-rich liquid just above the three-phase temperature (thermo FlashVL)
    fl = reference_dew.thermo_flasher(s)
    for T in (343.8, 346.0):
        r = fl.flash(T=T, P=P_ATM * 1000, zs=[0.5, 0.5])
        ph = [{"type": "vapour", "fraction": r.VF, "x": list(r.gas.zs)}, {"type": "liquid", "fraction": 1 - r.VF, "x": list(r.liquid0.zs)}]
        assert ph[1]["x"][0] > 0.9  # the water-rich liquid
        add({"T": T, "P": P_ATM}, [0.5, 0.5], T, P_ATM, ph, "vapour + liquid, thermo FlashVL")
    return cases, {"T3_K": T3, "P_kPa": P_ATM, "x_water": [lo3, hi3], "y_water": y3}


# ------------------------------------------------------------------ ternary: Gibbs minimum

def gibbs_min(s, z, T, P):
    """Minimum of G/RT over the vapour and a second liquid; returns the phases present."""
    z = np.asarray(z, float)
    n = len(z)

    def unpack(u):
        nv, n2 = u[:n], u[n:]
        return nv, n2, z - nv - n2

    def G(u):
        g = 0.0
        for kind, m in zip(("vapour", "liquid", "liquid"), unpack(u)):
            tot = m.sum()
            if tot <= 1e-14:
                continue
            x = np.clip(m / tot, 1e-300, None)
            g += float(np.sum(m * lnf(s, kind, x, T, P)))
        return g

    best = None
    cons = [{"type": "ineq", "fun": lambda u: unpack(u)[2]}]
    for fv in (0.0, 0.2, 0.6):
        for k in range(n):
            w = np.full(n, 0.05 / (n - 1)); w[k] = 0.95
            n2 = 0.3 * np.minimum(w, z / np.max(w / z))
            u0 = np.concatenate([fv * (z - n2), n2])
            r = minimize(G, u0, method="SLSQP", bounds=[(0, zi) for zi in np.concatenate([z, z])], constraints=cons,
                         options={"ftol": 1e-15, "maxiter": 1000})
            if best is None or r.fun < best.fun:
                best = r
    phases = []
    for kind, m in zip(("vapour", "liquid", "liquid"), unpack(best.x)):
        if m.sum() > 1e-6:
            x = m / m.sum()
            same = next((p for p in phases if p["type"] == kind and np.max(np.abs(np.asarray(p["x"]) - x)) < 1e-3), None)
            if same:  # the minimizer split one liquid in two: merge them
                f = same["fraction"] + m.sum()
                same["x"] = list((np.asarray(same["x"]) * same["fraction"] + m) / f)
                same["fraction"] = f
            else:
                phases.append({"type": kind, "fraction": float(m.sum()), "x": list(x)})
    return polish(s, z, T, P, phases)


def polish(s, z, T, P, phases):
    """Equal fugacities and the mass balance, solved from the Gibbs-minimum estimate."""
    ref = next(p for p in phases if p["type"] == "liquid")
    others = [p for p in phases if p is not ref]
    if not others:
        return phases
    n = len(z)
    x0 = np.asarray(ref["x"])

    def comps(u):
        lnK = u[: n * len(others)].reshape(len(others), n)
        b = u[n * len(others):]
        K = np.exp(lnK)
        xr = z / (1 + (b[:, None] * (K - 1)).sum(axis=0))
        return xr, [xr * Kj for Kj in K], b

    def F(u):
        xr, xs, b = comps(u)
        res = [xj.sum() - xr.sum() for xj in xs]
        for p, xj in zip(others, xs):
            res.extend(lnf(s, p["type"], xj, T, P) - lnf(s, "liquid", xr, T, P))
        return np.array(res)

    u0 = np.concatenate([np.log(np.asarray(p["x"]) / x0) for p in others] + [[p["fraction"] for p in others]])
    sol = root(F, u0, method="hybr", tol=1e-14)
    # hybr may stop with "no further improvement" at the limit of double precision: the
    # residual decides
    if np.max(np.abs(F(sol.x))) > 1e-11:
        raise RuntimeError(f"polish failed: {sol.message} (residual {np.max(np.abs(F(sol.x))):.1e})")
    xr, xs, b = comps(sol.x)
    if np.any(b < -1e-12) or b.sum() > 1 + 1e-12:
        raise RuntimeError(f"polish gave a negative phase fraction: {b}")
    out = [{"type": "liquid", "fraction": float(1 - b.sum()), "x": list(xr / xr.sum())}]
    out += [{"type": p["type"], "fraction": float(bj), "x": list(xj / xj.sum())} for p, xj, bj in zip(others, xs, b)]
    return out


def thermo_vln(s):
    from thermo import FlashVLN
    fl = reference_dew.thermo_flasher(s)
    return FlashVLN(fl.constants, fl.correlations, liquids=[fl.liquid, fl.liquid], gas=fl.gas)


def thermo_phases(r):
    out = []
    if r.gas is not None:
        out.append({"type": "vapour", "fraction": r.VF, "x": list(r.gas.zs)})
    liq_betas = r.betas[1:] if r.gas is not None else r.betas
    for b, l in zip(liq_betas, r.liquids):
        out.append({"type": "liquid", "fraction": b, "x": list(l.zs)})
    return out


def ternary_cases():
    cases = []
    for model, z, specs in [
        ("NRTL", [0.1, 0.4, 0.5], [{"T": 300.0}, {"T": 343.1402}, {"T": 343.3}, {"VF": 0.0}, {"VF": 0.3}]),
        ("UNIQUAC", [0.05, 0.5, 0.45], [{"T": 300.0}, {"VF": 0.1}, {"VF": 0.3}, {"VF": 0.35}]),
        # feeds from the review of pull request #36, where the first version failed
        ("NRTL", [0.2, 0.4, 0.4], [{"T": 343.5}, {"VF": 0.0}, {"VF": 0.5}]),
    ]:
        ids = ["ethanol", "water", "ethyl-acetate"]
        s = System(ids, model)
        vln = thermo_vln(s)
        tp = lambda T: gibbs_min(s, z, T, P_ATM)
        for spec in specs:
            if "T" in spec:
                T = spec["T"]
                ph = tp(T)
            else:
                # the two liquids of the feed boil where P_bub(liquid 1) = P; above it vapour + two liquids
                def p_bub_ll(T):
                    ll = [p for p in tp(T - 0.5) if p["type"] == "liquid"]
                    ph = polish(s, z, T, P_ATM, ll)
                    return s.equilibrium(ph[0]["x"], T)[0]
                T0 = brentq(lambda T: p_bub_ll(T) - P_ATM, 330.0, 350.0, xtol=1e-11)
                if spec["VF"] == 0:
                    T = T0
                    ph = polish(s, z, T, P_ATM, [p for p in tp(T - 0.5) if p["type"] == "liquid"])
                else:
                    start = tp(T0 + 1e-3)
                    assert len(start) == 3, start

                    def vf(T):
                        ph = polish(s, z, T, P_ATM, start)
                        return next(p["fraction"] for p in ph if p["type"] == "vapour")
                    hi = T0 + 1e-4
                    while vf(hi) < spec["VF"]:
                        hi = T0 + 2 * (hi - T0)
                    T = brentq(lambda T: vf(T) - spec["VF"], T0 + 1e-9, hi, xtol=1e-12)
                    ph = polish(s, z, T, P_ATM, start)
            full = {"P": P_ATM, **spec}
            th = thermo_phases(vln.flash(T=T, P=P_ATM * 1000, zs=z))
            case = {"model": model, "components": ids, "z": z, "spec": full, "T_K": T, "P_kPa": P_ATM, "phases": ph,
                    "G_RT": gibbs(s, T, P_ATM, ph), "thermo_FlashVLN": {"phases": th, "G_RT": gibbs(s, T, P_ATM, th)}}
            cases.append(case)
            print(model, full, f"T={T:.6f}", [(p["type"][0], round(p["fraction"], 6)) for p in ph],
                  f"G={case['G_RT']:.10f}; thermo FlashVLN:", [(p["type"][0], round(p["fraction"], 6)) for p in th],
                  f"G={case['thermo_FlashVLN']['G_RT']:.10f}")
    return cases


def tp_cases():
    """T-P flashes at the Gibbs-energy minimum, at states from the review of pull request #36
    where the first version returned all vapour (vapour + liquid, two liquids, or vapour + two
    liquids are stable) or did not converge; also at other pressures."""
    out = []
    for model, ids, z, T, P in [
        ("NRTL", ["water", "ethyl-acetate"], [0.35, 0.65], 344.0, P_ATM),
        ("NRTL", ["water", "ethyl-acetate"], [0.35, 0.65], 343.66, P_ATM),
        ("UNIQUAC", ["water", "ethyl-acetate"], [0.35, 0.65], 345.0, P_ATM),
        ("NRTL", ["water", "ethyl-acetate"], [0.35, 0.65], 323.0, 50.0),
        ("NRTL", ["water", "ethyl-acetate"], [0.35, 0.65], 377.0, 300.0),
        ("NRTL", ["ethanol", "water", "ethyl-acetate"], [0.04, 0.33, 0.63], 343.431, P_ATM),
        ("UNIQUAC", ["ethanol", "water", "ethyl-acetate"], [0.1, 0.4, 0.5], 375.379, 300.0),
    ]:
        s = System(ids, model)
        ph = gibbs_min(s, z, T, P)
        th = thermo_phases(thermo_vln(s).flash(T=T, P=P * 1000, zs=z))
        c = {"model": model, "components": ids, "z": z, "spec": {"T": T, "P": P}, "T_K": T, "P_kPa": P, "phases": ph,
             "G_RT": gibbs(s, T, P, ph), "thermo_FlashVLN": {"phases": th, "G_RT": gibbs(s, T, P, th)}}
        out.append(c)
        print(model, "+".join(ids), z, T, P, [(p["type"][0], round(p["fraction"], 6)) for p in ph], f"G={c['G_RT']:.10f};",
              "thermo:", [(p["type"][0], round(p["fraction"], 6)) for p in th], f"G={c['thermo_FlashVLN']['G_RT']:.10f}")
    return out


def main():
    warnings.simplefilter("ignore", RuntimeWarning)
    b, point = binary_cases()
    t = ternary_cases()
    e = tp_cases()
    OUT.write_text(json.dumps({
        "_about": "Flashes with two liquids from validation/python/reference_three_phase.py: binary water + ethyl "
                  "acetate (NRTL) built from reference_model.lle_binary, its bubble pressure and the lever rule; "
                  "ternary ethanol + water + ethyl acetate from the minimum of the Gibbs energy polished by the "
                  "equal-fugacity equations, with thermo's FlashVLN on the same states for comparison. Ideal-gas vapour.",
        "three_phase_point": point, "binary": b, "ternary": t, "tp_review": e}, indent=1))
    print(f"wrote {len(b) + len(t) + len(e)} cases to {OUT}")


if __name__ == "__main__":
    main()
