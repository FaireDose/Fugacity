"""
Independent Python implementation of the Fugacity VLE model, used to check the
JavaScript engine. It reads the same data files (src/data/*.json) but shares no
code with it. Requires numpy and scipy.

Liquid: NRTL or UNIQUAC. Vapour: ideal gas, plus chemical theory (dimerization)
for components with an "association" record.
"""
import json
from pathlib import Path

import numpy as np
from scipy.optimize import brentq

DATA = Path(__file__).resolve().parents[2] / "src" / "data"
COMPONENTS = json.loads((DATA / "components.json").read_text())["components"]
# every parameter set; a pair may have several per model (proposal 0003), the engine and this
# model use the one marked "default" unless told otherwise
ALL_BINARIES = json.loads((DATA / "binaries.json").read_text())["pairs"]
BINARIES = [p for p in ALL_BINARIES if p.get("default", True)]


def psat_kpa(c, T):
    v = c["vapourPressure"]
    return np.exp(v["A"] + v["B"] / T + v["C"] * np.log(T) + v["D"] * T ** v["E"]) / 1000


def dimer_k(assoc, T):
    return 10 ** (assoc["log10K"]["A"] + assoc["log10K"]["B"] / T) * 7.50062


class System:
    def __init__(self, ids, model, psat=None, params=None):
        """psat: optional list of fixed pure vapour pressures (kPa).
        params: optional list of pair dicts that replace the databank entries."""
        self.ids, self.model, self.psat_fixed = ids, model, psat
        self.c = [COMPONENTS[i] for i in ids]
        n = self.n = len(ids)
        self.a = np.zeros((n, n)); self.b = np.zeros((n, n)); self.alpha = np.full((n, n), 0.3)
        for p in (params if params is not None else BINARIES):
            if p["model"] != model or p["i"] not in ids or p["j"] not in ids:
                continue
            i, j = ids.index(p["i"]), ids.index(p["j"])
            self.a[i, j], self.a[j, i], self.b[i, j], self.b[j, i] = p["a_ij"], p["a_ji"], p["b_ij"], p["b_ji"]
            if "alpha" in p:
                self.alpha[i, j] = self.alpha[j, i] = p["alpha"]
        self.r = np.array([c["uniquac"]["r"] for c in self.c])
        self.q = np.array([c["uniquac"]["q"] for c in self.c])

    def gamma(self, x, T):
        x = np.clip(np.asarray(x, float), 1e-12, None); x = x / x.sum()
        if self.model == "NRTL":
            tau = self.a + self.b / T
            G = np.exp(-self.alpha * tau)
            S = x @ G; C = x @ (tau * G)
            ln = C / S + (G * (tau - C / S)) @ (x / S)
            return np.exp(ln)
        tau = np.exp(self.a + self.b / T)
        r, q, z = self.r, self.q, 10.0
        phi = r * x / (r @ x); th = q * x / (q @ x)
        l = z / 2 * (r - q) - (r - 1)
        lnc = np.log(phi / x) + z / 2 * q * np.log(th / phi) + l - phi / x * (x @ l)
        tt = th @ tau
        lnr = q * (1 - np.log(tt) - tau @ (th / tt))
        return np.exp(lnc + lnr)

    def equilibrium(self, x, T):
        x = np.clip(np.asarray(x, float), 1e-12, None); x = x / x.sum()
        g = self.gamma(x, T)
        app = np.zeros(self.n); P = 0.0
        for i, c in enumerate(self.c):
            ps = self.psat_fixed[i] if self.psat_fixed is not None else psat_kpa(c, T)
            if "association" in c:
                K = dimer_k(c["association"], T)
                pm_sat = (-1 + np.sqrt(1 + 4 * K * ps)) / (2 * K)
                pm = x[i] * g[i] * pm_sat
                pd = K * pm ** 2
                P += pm + pd; app[i] = pm + 2 * pd
            else:
                p = x[i] * g[i] * ps
                P += p; app[i] = p
        return P, app / app.sum()

    def bubble_t(self, x, P):
        T = brentq(lambda T: self.equilibrium(x, T)[0] - P, 250.0, 600.0, xtol=1e-10)
        return T, self.equilibrium(x, T)[1]

    def isoactivity_residual(self, x_a, x_b, T):
        """ln(x_i gamma_i) in liquid a minus the same in liquid b, for every component.
        All zero at liquid-liquid equilibrium (equal activities in both liquids)."""
        x_a = np.clip(np.asarray(x_a, float), 1e-12, None); x_a = x_a / x_a.sum()
        x_b = np.clip(np.asarray(x_b, float), 1e-12, None); x_b = x_b / x_b.sum()
        return np.log(x_a * self.gamma(x_a, T)) - np.log(x_b * self.gamma(x_b, T))

    def lle_binary(self, T, guess):
        """Binary liquid-liquid equilibrium at T, solved from guess = (x1 in liquid a, x1 in
        liquid b). Returns (x1_a, x1_b), or None when the solution is a single liquid
        (x1_a = x1_b) or the isoactivity equations are not solved."""
        from scipy.optimize import least_squares
        logit = lambda v: np.log(v / (1 - v))
        expit = lambda u: 1 / (1 + np.exp(-u))
        f = lambda u: self.isoactivity_residual([expit(u[0]), 1 - expit(u[0])], [expit(u[1]), 1 - expit(u[1])], T)
        res = least_squares(f, [logit(guess[0]), logit(guess[1])], xtol=1e-14, ftol=1e-14, gtol=1e-14)
        a, b = expit(res.x[0]), expit(res.x[1])
        if np.max(np.abs(res.fun)) > 1e-8 or abs(a - b) < 1e-3:
            return None
        return a, b

    def excess_enthalpy(self, x, T, h=0.05):
        """H^E in J/mol from the temperature derivative of G^E/RT."""
        x = np.clip(np.asarray(x, float), 1e-12, None); x = x / x.sum()
        g = lambda t: x @ np.log(self.gamma(x, t))
        return -8.314462618 * T ** 2 * (g(T + h) - g(T - h)) / (2 * h)
