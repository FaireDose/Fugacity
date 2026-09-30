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
BINARIES = json.loads((DATA / "binaries.json").read_text())["pairs"]


def psat_kpa(c, T):
    v = c["vapourPressure"]
    return np.exp(v["A"] + v["B"] / T + v["C"] * np.log(T) + v["D"] * T ** v["E"]) / 1000


def dimer_k(assoc, T):
    return 10 ** (assoc["log10K"]["A"] + assoc["log10K"]["B"] / T) * 7.50062


class System:
    def __init__(self, ids, model):
        self.ids, self.model = ids, model
        self.c = [COMPONENTS[i] for i in ids]
        n = self.n = len(ids)
        self.a = np.zeros((n, n)); self.b = np.zeros((n, n)); self.alpha = np.full((n, n), 0.3)
        for p in BINARIES:
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
            ps = psat_kpa(c, T)
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
        T = brentq(lambda T: self.equilibrium(x, T)[0] - P, 280.0, 560.0, xtol=1e-10)
        return T, self.equilibrium(x, T)[1]
