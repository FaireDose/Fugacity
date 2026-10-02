"""
Independent reference for activity-coefficient systems with a cubic vapour
(src/thermo/gamma-phi-vapour.js, proposal 0001 step 2):

    y_i phi_i^V(T, P, y) P = x_i gamma_i(T, x) P_i^sat phi_i^sat exp[v_i^L (P - P_i^sat) / (R T)]

Written separately from the JavaScript engine and solved differently:
  - gamma and P^sat from reference_model.System (this folder);
  - phi from reference_eos.Cubic (numerical derivative of the residual Helmholtz energy);
    phi_i^sat as pure saturated vapour at T and the databank vapour pressure;
  - v_i^L from the liquid-density records of src/data/components.json (DIPPR 105 / 100),
    and for water from IAPWS-IF97 (the open `iapws` package), as the engine uses;
  - bubble and dew points by scipy.optimize.root on all equations at once
    (unknowns ln y or ln x, and T or ln P).

It also runs the open-source `thermo` library (MIT) with the same parameters: FlashVL with
GibbsExcessLiquid(equilibrium_basis="Poynting&PhiSat") and a PRMIX / SRKMIX gas. thermo
evaluates phi_i^sat at the equation of state's own saturation pressure; for the check its
pure-component equations of state are wrapped so that phi_i^sat is taken at the databank
vapour pressure (thermo's own PR / SRK vapour root there), as in the engine. The two must
then agree within 1e-3 K and 1e-5 in P. thermo with its own convention is stored too, to
show the size of that choice. The engine is tested against the first calculation to 1e-4 K.

Writes validation/fixtures/gamma_phi_vapour.json.
Usage: python validation/python/reference_gamma_phi.py
"""
import json
import math
import warnings
from pathlib import Path

import numpy as np
from scipy.optimize import root

from reference_model import System, psat_kpa
from reference_eos import Cubic, KIJ

R = 8.314462618
OUT = Path(__file__).resolve().parents[1] / "fixtures" / "gamma_phi_vapour.json"


def liquid_volume(c, cid, T):
    """m3/mol, with T clamped to the record's range (as the engine does)."""
    rec = c["properties"]["liquidDensity"]
    if cid == "water":
        from iapws import IAPWS97
        T = min(max(T, 273.15), 647.096)
        rho = IAPWS97(T=T, x=0).rho
    else:
        T = min(max(T, rec["Tmin_K"]), rec["Tmax_K"])
        k = rec["coefficients"]
        if rec["equation"] == "DIPPR105":
            rho = k["A"] / k["B"] ** (1 + (1 - T / k["C"]) ** k["D"])
        elif rec["equation"] == "DIPPR100":
            rho = sum(k.get(n, 0.0) * T ** p for p, n in enumerate("ABCDE"))
        else:
            raise ValueError(rec["equation"])
    return c["MW"] / 1000 / rho


class GammaPhi(System):
    def __init__(self, ids, model, vapour):
        super().__init__(ids, model)
        self.vap = Cubic(vapour, ids)
        self.vapour = vapour

    def fug_terms(self, x, T):
        """x_i gamma_i P_i^sat phi_i^sat (kPa) and v_i^L."""
        g = self.gamma(x, T)
        out, vl = [], []
        for i, c in enumerate(self.c):
            ps = psat_kpa(c, T)
            e = np.zeros(self.n); e[i] = 1.0
            lnphisat = self.vap.lnphi(T, ps * 1000, e, "vapour")[i]
            out.append(x[i] * g[i] * ps * math.exp(lnphisat))
            vl.append(liquid_volume(c, self.ids[i], T))
        return np.array(out), np.array(vl), np.array([psat_kpa(c, T) for c in self.c])

    def resid(self, x, y, T, P):
        """ln(y_i phi_i P) - ln(x_i gamma_i Psat_i phi_sat_i Poynting_i), i = 1..n."""
        base, vl, ps = self.fug_terms(x, T)
        lnphi = np.array(self.vap.lnphi(T, P * 1000, y, "vapour"))
        return np.log(y) + lnphi + math.log(P) - np.log(base) - vl * (P - ps) * 1000 / (R * T)

    def bubble(self, x, P=None, T=None):
        x = np.asarray(x, float); n = self.n
        T0, y0 = self.bubble_t(x, P) if P is not None else (T, self.equilibrium(x, T)[1])
        P0 = P if P is not None else self.equilibrium(x, T)[0]

        def f(u):
            y = np.exp(u[:n]); v = u[n]
            TT, PP = (v, P) if P is not None else (T, math.exp(v))
            return np.concatenate([self.resid(x, y, TT, PP), [y.sum() - 1]])
        u0 = np.concatenate([np.log(y0), [T0 if P is not None else math.log(P0)]])
        r = root(f, u0, method="hybr", options={"xtol": 1e-13})
        if np.max(np.abs(f(r.x))) > 1e-10:  # hybr can stall far from the start; Levenberg-Marquardt from its end
            r = root(f, r.x, method="lm", options={"xtol": 1e-15, "ftol": 1e-15})
        assert np.max(np.abs(f(r.x))) < 1e-10, r.message
        y = np.exp(r.x[:n])
        return (r.x[n], P, y) if P is not None else (T, math.exp(r.x[n]), y)

    def dew(self, y, P):
        y = np.asarray(y, float); n = self.n
        # start: the ideal-vapour dew point, from the bubble point of a guessed liquid
        Tb = [brent_tb(self, i, P) for i in range(n)]
        T0 = float(np.dot(y, Tb)); x0 = y.copy()

        def f(u):
            x = np.exp(u[:n]); TT = u[n]
            return np.concatenate([self.resid(x, y, TT, P), [x.sum() - 1]])
        best = None
        for T0s in (T0, T0 + 5, T0 - 5):
            for xs in (x0, np.full(n, 1 / n)):
                r = root(f, np.concatenate([np.log(xs), [T0s]]), method="hybr", options={"xtol": 1e-13})
                if r.success and np.max(np.abs(f(r.x))) < 1e-10:
                    cand = (r.x[n], np.exp(r.x[:n]))
                    if best is None or cand[0] > best[0]:
                        best = cand
        assert best is not None
        return best


def brent_tb(s, i, P):
    from scipy.optimize import brentq
    return brentq(lambda T: psat_kpa(s.c[i], T) - P, 150, 700)


class PhiSatAtPsat:
    """thermo's pure cubic, but phi_sat evaluated at the databank vapour pressure (the engine's
    convention) instead of the equation of state's own saturation pressure. thermo's own
    PR/SRK computes the fugacity coefficient of the vapour root there."""
    def __init__(self, eos, vp):
        self.eos, self.vp, self.Tc = eos, vp, eos.Tc

    def phi_sat(self, T, polish=True):
        return self.eos.to(T=T, P=self.vp(T)).phi_g

    def dphi_sat_dT(self, T, polish=True, h=1e-3):
        return (self.phi_sat(T + h) - self.phi_sat(T - h)) / (2 * h)

    def d2phi_sat_dT2(self, T, polish=True, h=1e-2):
        return (self.phi_sat(T + h) - 2 * self.phi_sat(T) + self.phi_sat(T - h)) / h ** 2


def thermo_flasher(s, same_phi_sat=True):
    from thermo import (ChemicalConstantsPackage, PropertyCorrelationsPackage, VaporPressure, HeatCapacityGas,
                        VolumeLiquid, GibbsExcessLiquid, CEOSGas, PRMIX, SRKMIX, PR, SRK, FlashVL)
    from thermo.nrtl import NRTL
    from thermo.uniquac import UNIQUAC
    n = s.n
    VPs, VLs = [], []
    for cid, c in zip(s.ids, s.c):
        v = c["vapourPressure"]
        vp = VaporPressure()
        vp.add_correlation("fug", "DIPPR101", Tmin=150.0, Tmax=800.0, A=v["A"], B=v["B"], C=v["C"], D=v["D"], E=v["E"])
        vp.method = "fug"; VPs.append(vp)
        Ts = np.linspace(250, 640, 400)
        vl = VolumeLiquid(); vl.add_tabular_data(Ts=list(Ts), properties=[liquid_volume(c, cid, t) for t in Ts], name="fug")
        vl.method = "fug"; VLs.append(vl)
    HCs = [HeatCapacityGas(poly_fit=(150.0, 800.0, [0.0, 30.0])) for _ in range(n)]
    Tcs, Pcs, ws = [c["Tc_K"] for c in s.c], [c["Pc_Pa"] for c in s.c], [c["omega"] for c in s.c]
    consts = ChemicalConstantsPackage(Tcs=Tcs, Pcs=Pcs, omegas=ws, MWs=[c["MW"] for c in s.c], names=s.ids, CASs=[""] * n)
    corr = PropertyCorrelationsPackage(constants=consts, VaporPressures=VPs, HeatCapacityGases=HCs, VolumeLiquids=VLs, skip_missing=True)
    xs = [1 / n] * n
    GE = (NRTL(T=300.0, xs=xs, tau_as=s.a.tolist(), tau_bs=s.b.tolist(), alpha_cs=s.alpha.tolist()) if s.model == "NRTL"
          else UNIQUAC(T=300.0, xs=xs, rs=s.r.tolist(), qs=s.q.tolist(), tau_as=s.a.tolist(), tau_bs=s.b.tolist()))
    pure_cls, mix_cls = (PR, PRMIX) if s.vapour == "PR" else (SRK, SRKMIX)
    pures = [pure_cls(Tc=Tc, Pc=Pc, omega=w, T=300.0, P=1e5) for Tc, Pc, w in zip(Tcs, Pcs, ws)]
    if same_phi_sat:
        pures = [PhiSatAtPsat(e, vp) for e, vp in zip(pures, VPs)]
    liq = GibbsExcessLiquid(VaporPressures=VPs, HeatCapacityGases=HCs, VolumeLiquids=VLs, GibbsExcessModel=GE,
                            eos_pure_instances=pures, equilibrium_basis="Poynting&PhiSat", caloric_basis="Psat",
                            T=300.0, P=1e5, zs=xs)
    gas = CEOSGas(mix_cls, dict(Tcs=Tcs, Pcs=Pcs, omegas=ws, kijs=s.vap.k.tolist()), HeatCapacityGases=HCs, T=300.0, P=1e5, zs=xs)
    return FlashVL(consts, corr, liquid=liq, gas=gas)


CASES = [  # model, vapour, components, compositions, pressures (kPa) for bubble/dew T, temperature for bubble P
    ("NRTL", "PR", ["ethanol", "water"], [[0.1, 0.9], [0.5, 0.5], [0.85, 0.15]], [101.325, 500.0, 1500.0], 400.0),
    ("UNIQUAC", "SRK", ["ethanol", "water"], [[0.5, 0.5]], [101.325, 1000.0], 400.0),
    ("UNIQUAC", "SRK", ["methanol", "acetone", "chloroform"], [[0.3, 0.3, 0.4], [0.6, 0.2, 0.2]], [101.325, 1000.0], 380.0),
    ("NRTL", "PR", ["toluene", "chloroform"], [[0.3, 0.7], [0.7, 0.3]], [101.325, 1000.0], 420.0),
    ("NRTL", "PR", ["methanol", "water"], [[0.5, 0.5]], [101.325, 2000.0], 450.0),
]


def main():
    warnings.simplefilter("ignore", RuntimeWarning)
    cases, worst = [], {"T_K": 0.0, "P_rel": 0.0}
    for model, vap, ids, zs, Ps, Tfix in CASES:
        s = GammaPhi(ids, model, vap)
        fl = thermo_flasher(s)                       # same phi_sat convention: must agree closely
        fl0 = thermo_flasher(s, same_phi_sat=False)  # thermo's own convention: reported only
        for z in zs:
            for P in Ps:
                Tb, _, yb = s.bubble(z, P=P)
                Td, xd = s.dew(z, P)
                c = {"model": model, "vapour": vap, "components": ids, "z": z, "P_kPa": P,
                     "bubbleT": {"T_K": Tb, "y": list(yb)}, "dewT": {"T_K": Td, "x": list(xd)}}
                a = fl.flash(VF=0, P=P * 1000, zs=z); b = fl.flash(VF=1, P=P * 1000, zs=z)
                a0 = fl0.flash(VF=0, P=P * 1000, zs=z); b0 = fl0.flash(VF=1, P=P * 1000, zs=z)
                c["thermo"] = {"bubbleT_K": a.T, "dewT_K": b.T}
                c["thermo_own_phi_sat"] = {"bubbleT_K": a0.T, "dewT_K": b0.T}
                dT = max(abs(a.T - Tb), abs(b.T - Td))
                worst["T_K"] = max(worst["T_K"], dT)
                worst["T_K_own"] = max(worst.get("T_K_own", 0.0), abs(a0.T - Tb), abs(b0.T - Td))
                print(f"{model}/{vap} {'+'.join(ids):28s} z={z} P={P:7.1f}: bubble {Tb:.5f} (thermo {a.T:.5f}), dew {Td:.5f} (thermo {b.T:.5f})")
                if dT > 1e-3:
                    raise SystemExit(f"reference and thermo differ by {dT:.2e} K")
                cases.append(c)
            _, Pb, yb = s.bubble(z, T=Tfix)
            a = fl.flash(VF=0, T=Tfix, zs=z)
            a0 = fl0.flash(VF=0, T=Tfix, zs=z)
            worst["P_rel_own"] = max(worst.get("P_rel_own", 0.0), abs(a0.P / 1000 / Pb - 1))
            dP = abs(a.P / 1000 / Pb - 1)
            worst["P_rel"] = max(worst["P_rel"], dP)
            print(f"{model}/{vap} {'+'.join(ids):28s} z={z} T={Tfix}: bubble P {Pb:.4f} kPa (thermo {a.P / 1000:.4f})")
            if dP > 1e-5:
                raise SystemExit(f"reference and thermo differ by {dP:.2e} in P")
            cases.append({"model": model, "vapour": vap, "components": ids, "z": z, "T_K": Tfix,
                          "bubbleP": {"P_kPa": Pb, "y": list(yb)}, "thermo": {"bubbleP_kPa": a.P / 1000},
                          "thermo_own_phi_sat": {"bubbleP_kPa": a0.P / 1000}})
    OUT.write_text(json.dumps({
        "_about": "Bubble and dew points of activity-coefficient systems with a Peng-Robinson or SRK vapour, from "
                  "validation/python/reference_gamma_phi.py (independent implementation; scipy root on all equations), "
                  "checked against thermo's FlashVL (Poynting&PhiSat) with phi_sat at the databank vapour pressure: "
                  f"largest differences {worst['T_K']:.1e} K and {worst['P_rel']:.1e} relative in P. 'thermo_own_phi_sat' is thermo "
                  "with phi_sat at the equation of state's own saturation pressure (a different convention): "
                  f"up to {worst['T_K_own']:.2f} K and {worst['P_rel_own']:.1e} relative in P.",
        "cases": cases}, indent=1))
    print(f"wrote {len(cases)} cases; largest reference-thermo differences {worst}")


if __name__ == "__main__":
    main()
