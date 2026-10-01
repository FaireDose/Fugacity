"""Independent reference for the Peng-Robinson and SRK equations of state (src/thermo/eos/).

A plain implementation, written separately from the JavaScript engine and on purpose in a
different way:
  - Z from numpy.roots of the cubic in Z;
  - ln phi_i from a numerical derivative of the residual Helmholtz energy,
      ln phi_i = d(n a_res)/dn_i |_(T,V) - ln Z,   a_res = A_res / (n R T) (per mole),
      a_res(T, v, x) = -ln(1 - b/v) - a / (R T b (d1 - d2)) ln((v + d1 b) / (v + d2 b));
  - residual enthalpy by a numerical temperature derivative of a_res;
  - bubble and dew points by scipy.optimize.brentq on the pressure or temperature, with
    an inner successive-substitution loop on the incipient phase.
Equations: Peng & Robinson, Ind. Eng. Chem. Fundam. 15 (1976) 59; Soave, Chem. Eng. Sci.
27 (1972) 1197; the generic cubic form and the exact Omega constants as documented in the
open-source thermo library (thermo.eos.PR, thermo.eos.SRK).

The script also computes the same quantities with thermo (PRMIX, SRKMIX, and its VL flash)
and checks that the three agree. It writes validation/data/eos/fixtures.json, which
test/eos.test.js compares with the engine.

Usage: python validation/python/reference_eos.py [--write]
"""
import json
import math
import os
import sys

import numpy as np
from scipy.optimize import brentq

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
R = 8.314462618

COMPS = json.load(open(os.path.join(ROOT, "src", "data", "components.json")))["components"]
KIJ = json.load(open(os.path.join(ROOT, "src", "data", "kij.json")))["pairs"]


def omegas(model):
    if model == "PR":
        X = (-1 + (6 * 2 ** 0.5 + 8) ** (1 / 3) - (6 * 2 ** 0.5 - 8) ** (1 / 3)) / 3
        return 8 * (5 * X + 1) / (49 - 37 * X), X / (X + 3), 1 + 2 ** 0.5, 1 - 2 ** 0.5
    c = 2 ** (1 / 3) - 1
    return 1 / (9 * c), c / 3, 1.0, 0.0


def kmatrix(model, ids):
    n = len(ids)
    k = np.zeros((n, n))
    for p in KIJ:
        if p["model"] != model:
            continue
        if p["i"] in ids and p["j"] in ids:
            i, j = ids.index(p["i"]), ids.index(p["j"])
            k[i, j] = k[j, i] = p["kij"]
    return k


class Cubic:
    def __init__(self, model, ids):
        self.model, self.ids = model, ids
        self.Oa, self.Ob, self.d1, self.d2 = omegas(model)
        self.Tc = np.array([COMPS[i]["Tc_K"] for i in ids])
        self.Pc = np.array([COMPS[i]["Pc_Pa"] for i in ids])
        self.w = np.array([COMPS[i]["omega"] for i in ids])
        if model == "PR":
            self.m = 0.37464 + 1.54226 * self.w - 0.26992 * self.w ** 2
        else:
            self.m = 0.480 + 1.574 * self.w - 0.176 * self.w ** 2
        self.b_i = self.Ob * R * self.Tc / self.Pc
        self.k = kmatrix(model, ids)

    def ab(self, T, n):
        """a and b for mole amounts n (a is a mole-fraction average, b linear)."""
        n = np.asarray(n, dtype=float)
        x = n / n.sum()
        ai = self.Oa * R ** 2 * self.Tc ** 2 / self.Pc * (1 + self.m * (1 - np.sqrt(T / self.Tc))) ** 2
        aij = (1 - self.k) * np.sqrt(np.outer(ai, ai))
        return x @ aij @ x, x @ self.b_i

    def a_res(self, T, V, n):
        """Residual Helmholtz energy A_res/(R T) of n moles in volume V (m3)."""
        N = float(np.sum(n))
        a, b = self.ab(T, n)
        v = V / N
        return N * (-math.log(1 - b / v) - a / (R * T * b * (self.d1 - self.d2)) * math.log((v + self.d1 * b) / (v + self.d2 * b)))

    def Z(self, T, P, x, phase):
        a, b = self.ab(T, x)
        A, B = a * P / (R * T) ** 2, b * P / (R * T)
        s, p = self.d1 + self.d2, self.d1 * self.d2
        r = np.roots([1, (s - 1) * B - 1, A + p * B * B - s * B * (B + 1), -(A * B + p * B * B * (B + 1))])
        r = sorted(z.real for z in r if abs(z.imag) < 1e-10 * max(1, abs(z.real)) and z.real > B)
        z = r[0] if phase == "liquid" else r[-1]
        # polish with Newton on the cubic (a step is kept only if it reduces the residual)
        def cub(z):
            return ((z + (s - 1) * B - 1) * z + A + p * B * B - s * B * (B + 1)) * z - (A * B + p * B * B * (B + 1))
        for _ in range(3):
            d = (3 * z + 2 * ((s - 1) * B - 1)) * z + A + p * B * B - s * B * (B + 1)
            if d == 0:
                break
            zn = z - cub(z) / d
            if abs(cub(zn)) < abs(cub(z)) and zn > B:
                z = zn
            else:
                break
        return z, len(r)

    def lnphi(self, T, P, x, phase):
        x = np.asarray(x, dtype=float) / np.sum(x)
        Z, _ = self.Z(T, P, x, phase)
        V = Z * R * T / P  # for n = x (1 mol)
        out = []
        for i in range(len(x)):
            h = 1e-5
            up, dn = x.copy(), x.copy()
            up[i] += h
            dn[i] -= h if x[i] > h else 0
            hd = h if x[i] > h else 0
            d = (self.a_res(T, V, up) - self.a_res(T, V, dn)) / (h + hd)
            out.append(d - math.log(Z))
        return out

    def h_res(self, T, P, x, phase):
        """H_res = -R T^2 d(a_res)/dT|_V + R T (Z - 1), J/mol."""
        x = np.asarray(x, dtype=float) / np.sum(x)
        Z, _ = self.Z(T, P, x, phase)
        V = Z * R * T / P
        h = 1e-4
        dadT = (self.a_res(T + h, V, x) - self.a_res(T - h, V, x)) / (2 * h)
        return -R * T * T * dadT + R * T * (Z - 1)

    # --- bubble and dew points (brentq on the outer variable, substitution inside)
    def _inner(self, T, P, z, bubble, w0):
        w = np.array(w0)
        for _ in range(500):
            if bubble:
                K = np.exp(np.array(self.lnphi(T, P, z, "liquid")) - np.array(self.lnphi(T, P, w, "vapour")))
                t = K * z
            else:
                K = np.exp(np.array(self.lnphi(T, P, w, "liquid")) - np.array(self.lnphi(T, P, z, "vapour")))
                t = z / K
            S = t.sum()
            wn = t / S
            if np.max(np.abs(wn - w)) < 1e-13:
                break
            w = wn
        return math.log(S), wn

    def point(self, kind, z, given, lo, hi):
        z = np.asarray(z, dtype=float) / np.sum(z)
        bubble = kind.startswith("bubble")
        state = {"w": None}

        def wilson(T, P):
            K = self.Pc / P * np.exp(5.37 * (1 + self.w) * (1 - self.Tc / T))
            t = K * z if bubble else z / K
            return t / t.sum()

        def f(u):
            T, P = (given, u) if kind.endswith("P") else (u, given)
            w0 = state["w"] if state["w"] is not None else wilson(T, P)
            r, w = self._inner(T, P, z, bubble, w0)
            state["w"] = w
            return r

        u = brentq(f, lo, hi, xtol=1e-12, rtol=1e-13)
        f(u)
        return u, list(state["w"])


def thermo_values(model, ids, T, P, x, phase):
    from thermo import PRMIX, SRKMIX
    cls = PRMIX if model == "PR" else SRKMIX
    k = kmatrix(model, ids).tolist()
    e = cls(Tcs=[COMPS[i]["Tc_K"] for i in ids], Pcs=[COMPS[i]["Pc_Pa"] for i in ids],
            omegas=[COMPS[i]["omega"] for i in ids], zs=list(np.asarray(x) / np.sum(x)), kijs=k, T=T, P=P)
    if phase == "liquid" and hasattr(e, "V_l"):
        return {"Z": e.Z_l, "lnPhi": list(e.lnphis_l), "hR": e.H_dep_l}
    if phase == "vapour" and hasattr(e, "V_g"):
        return {"Z": e.Z_g, "lnPhi": list(e.lnphis_g), "hR": e.H_dep_g}
    # one root: thermo stores it under the phase it assigns
    if hasattr(e, "V_l"):
        return {"Z": e.Z_l, "lnPhi": list(e.lnphis_l), "hR": e.H_dep_l}
    return {"Z": e.Z_g, "lnPhi": list(e.lnphis_g), "hR": e.H_dep_g}


def thermo_point(model, ids, kind, z, given):
    """Bubble/dew point with thermo's VL flash (VF = 0 or 1)."""
    from thermo import (CEOSGas, CEOSLiquid, ChemicalConstantsPackage, FlashVL, HeatCapacityGas,
                        PRMIX, SRKMIX)
    cls = PRMIX if model == "PR" else SRKMIX
    consts = ChemicalConstantsPackage(Tcs=[COMPS[i]["Tc_K"] for i in ids], Pcs=[COMPS[i]["Pc_Pa"] for i in ids],
                                      omegas=[COMPS[i]["omega"] for i in ids], MWs=[COMPS[i]["MW"] for i in ids],
                                      CASs=[COMPS[i]["cas"] for i in ids])
    cps = [HeatCapacityGas(poly_fit=(50.0, 1500.0, [0, 0, 0, 0, 0, 0, 0, 0, 35.0])) for _ in ids]
    kw = dict(Tcs=consts.Tcs, Pcs=consts.Pcs, omegas=consts.omegas, kijs=kmatrix(model, ids).tolist())
    gas = CEOSGas(cls, kw, HeatCapacityGases=cps)
    liq = CEOSLiquid(cls, kw, HeatCapacityGases=cps)
    fl = FlashVL(consts, None, liquid=liq, gas=gas)
    zs = list(np.asarray(z) / np.sum(z))
    VF = 0 if kind.startswith("bubble") else 1
    if kind.endswith("P"):
        r = fl.flash(T=given, VF=VF, zs=zs)
        u = r.P / 1000
    else:
        r = fl.flash(P=given * 1000, VF=VF, zs=zs)
        u = r.T
    other = r.gas.zs if VF == 0 else r.liquid0.zs
    return u, list(other)


STATES = [
    # model, components, T K, P kPa, x, phase
    ("PR", ["methane", "ethane"], 200.0, 2000.0, [0.5, 0.5], "liquid"),
    ("PR", ["methane", "ethane"], 200.0, 2000.0, [0.9, 0.1], "vapour"),
    ("PR", ["methane", "ethane"], 300.0, 5000.0, [0.5, 0.5], "vapour"),
    ("PR", ["nitrogen", "methane"], 150.0, 2000.0, [0.3, 0.7], "liquid"),
    ("PR", ["nitrogen", "oxygen"], 90.0, 101.325, [0.79, 0.21], "liquid"),
    ("PR", ["methanol", "water"], 350.0, 101.325, [0.4, 0.6], "liquid"),
    ("PR", ["hydrogen", "methane", "ethane", "benzene"], 300.0, 3000.0, [0.05, 0.15, 0.2, 0.6], "liquid"),
    ("PR", ["hydrogen", "methane", "ethane", "benzene"], 300.0, 3000.0, [0.4, 0.4, 0.15, 0.05], "vapour"),
    ("PR", ["nitrogen"], 300.0, 10000.0, [1.0], "vapour"),
    ("SRK", ["methane", "ethane"], 200.0, 2000.0, [0.5, 0.5], "liquid"),
    ("SRK", ["methane", "ethane"], 200.0, 2000.0, [0.9, 0.1], "vapour"),
    ("SRK", ["nitrogen", "methane"], 150.0, 2000.0, [0.3, 0.7], "liquid"),
    ("SRK", ["hydrogen", "methane", "ethane", "benzene"], 300.0, 3000.0, [0.05, 0.15, 0.2, 0.6], "liquid"),
    ("SRK", ["ethylene", "ethane"], 250.0, 1500.0, [0.5, 0.5], "liquid"),
]

POINTS = [
    # model, components, kind, z, given (T K for *P, P kPa for *T), bracket for the unknown
    ("PR", ["methane", "ethane"], "bubbleP", [0.5, 0.5], 200.0, (1500.0, 3500.0)),
    ("PR", ["methane", "ethane"], "dewP", [0.5, 0.5], 200.0, (200.0, 800.0)),
    ("PR", ["methane", "ethane"], "bubbleT", [0.5, 0.5], 2000.0, (170.0, 205.0)),
    ("PR", ["methane", "ethane"], "dewT", [0.5, 0.5], 2000.0, (220.0, 260.0)),
    ("PR", ["nitrogen", "methane"], "bubbleP", [0.3, 0.7], 150.0, (1500.0, 3200.0)),
    ("PR", ["ethylene", "ethane"], "bubbleT", [0.4, 0.6], 1000.0, (225.0, 265.0)),
    ("PR", ["hydrogen", "methane", "ethane", "benzene"], "bubbleP", [0.01, 0.1, 0.2, 0.69], 300.0, (5000.0, 9000.0)),
    ("SRK", ["methane", "ethane"], "bubbleP", [0.5, 0.5], 200.0, (1500.0, 3500.0)),
    ("SRK", ["methane", "ethane"], "dewT", [0.5, 0.5], 2000.0, (220.0, 260.0)),
    ("SRK", ["nitrogen", "methane"], "dewP", [0.3, 0.7], 150.0, (500.0, 2000.0)),
]


def rel(a, b):
    return abs(a - b) / max(abs(b), 1e-300)


def main():
    out = {"_about": "Reference values for src/thermo/eos (Z, ln phi, residual enthalpy) and src/equilibrium/phi-phi.js (bubble and dew points), from validation/python/reference_eos.py: an independent Python implementation, cross-checked with the thermo library (PRMIX/SRKMIX and FlashVL).",
           "generated_with": {}, "states": [], "points": []}
    import thermo
    out["generated_with"] = {"thermo": thermo.__version__, "numpy": np.__version__}
    worst = {"Z": 0, "lnPhi": 0, "hR": 0, "point": 0, "comp": 0}
    print("States: own reference vs thermo")
    for model, ids, T, P, x, phase in STATES:
        e = Cubic(model, ids)
        Z, nroots = e.Z(T, P * 1000, x, phase)
        lp = e.lnphi(T, P * 1000, x, phase)
        hR = e.h_res(T, P * 1000, x, phase)
        th = thermo_values(model, ids, T, P * 1000, x, phase)
        dZ = rel(Z, th["Z"])
        dl = max(abs(a - b) for a, b in zip(lp, th["lnPhi"]))
        dh = abs(hR - th["hR"]) / max(abs(th["hR"]), 1.0)
        worst["Z"] = max(worst["Z"], dZ); worst["lnPhi"] = max(worst["lnPhi"], dl); worst["hR"] = max(worst["hR"], dh)
        print(f"  {model:3s} {'+'.join(ids):40s} {T:6.1f} K {P:8.1f} kPa {phase:7s} Z={Z:.8f} roots={nroots} "
              f"dZ={dZ:.1e} dlnphi={dl:.1e} dhR={dh:.1e}")
        out["states"].append({"model": model, "components": ids, "T_K": T, "P_kPa": P, "x": x, "phase": phase,
                              "roots": nroots, "Z": Z, "lnPhi": lp, "hR_J_mol": hR, "thermo": th})
    print("Bubble and dew points: own reference vs thermo FlashVL")
    for model, ids, kind, z, given, br in POINTS:
        e = Cubic(model, ids)
        lo, hi = br
        if kind.endswith("P"):
            u, w = e.point(kind, z, given, lo * 1000, hi * 1000)
            u /= 1000
            u_th, w_th = thermo_point(model, ids, kind, z, given)
        else:
            u, w = e.point(kind, z, given * 1000, lo, hi)
            u_th, w_th = thermo_point(model, ids, kind, z, given)
        d = rel(u, u_th)
        dw = max(abs(a - b) for a, b in zip(w, w_th))
        worst["point"] = max(worst["point"], d); worst["comp"] = max(worst["comp"], dw)
        unit = "kPa" if kind.endswith("P") else "K"
        print(f"  {model:3s} {'+'.join(ids):40s} {kind:8s} z={z} given={given}: {u:.6f} {unit} (thermo {u_th:.6f}, rel {d:.1e}, comp {dw:.1e})")
        out["points"].append({"model": model, "components": ids, "kind": kind, "z": z, "given": given,
                              "value": u, "incipient": w, "thermo": {"value": u_th, "incipient": w_th}})
    print("worst differences own vs thermo:", {k: f"{v:.1e}" for k, v in worst.items()})
    assert worst["Z"] < 1e-9 and worst["lnPhi"] < 1e-7 and worst["hR"] < 1e-6, worst
    assert worst["point"] < 1e-6 and worst["comp"] < 1e-6, worst
    if "--write" in sys.argv:
        path = os.path.join(ROOT, "validation", "data", "eos", "fixtures.json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(out, f, indent=1)
            f.write("\n")
        print("wrote", path)


if __name__ == "__main__":
    main()
