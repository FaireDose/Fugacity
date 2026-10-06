# Exploratory: CPA (SRK + Wertheim, teqp 0.23.2) for water + ethanol, parameters as printed in
# the teqp documentation's CPA example (water 4C, ethanol 2B; no literature source stated there).
# One k_ij fitted to the 1-atm T-x-y of Kamihama et al. (2012); excess enthalpies predicted.
import json, sys, numpy as np, teqp
from scipy.optimize import brentq, minimize_scalar
R = 8.31446261815324
eth = {"a0i / Pa m^6/mol^2": 0.85164, "bi / m^3/mol": 0.0491e-3, "c1": 0.7502, "Tc / K": 513.92,
       "epsABi / J/mol": 21500.0, "betaABi": 0.008, "sites": ["e", "H"]}
wat = {"a0i / Pa m^6/mol^2": 0.12277, "bi / m^3/mol": 0.0000145, "c1": 0.6736, "Tc / K": 647.13,
       "epsABi / J/mol": 16655.0, "betaABi": 0.0692, "sites": ["e", "e", "H", "H"]}

def make(kij):
    j = {"cubic": "SRK", "radial_dist": "CS", "pures": [wat, eth], "R_gas / J/mol/K": R}
    if kij:
        j["kmat"] = [[0, kij], [kij, 0]]
    return teqp.make_model({"kind": "CPA", "model": j, "validate": False}, False)

def p_of(m, T, rho, x):
    return rho * R * T * (1 + m.get_Ar01(T, rho, x))

def rho_at(m, T, P, x, phase):
    b = x[0] * wat["bi / m^3/mol"] + x[1] * eth["bi / m^3/mol"]
    if phase == "L":
        grid = np.linspace(0.99 / b, 0.2 / b, 300)
    else:
        grid = np.geomspace(1e-3, 0.2 / b, 300)
    f = [p_of(m, T, r, x) - P for r in grid]
    for k in range(len(grid) - 1):
        if f[k] * f[k + 1] < 0:
            r = brentq(lambda r: p_of(m, T, r, x) - P, grid[k], grid[k + 1], xtol=1e-10)
            # stable branch: dp/drho > 0
            if (p_of(m, T, r * 1.0001, x) - p_of(m, T, r, x)) > 0:
                return r
    raise ValueError(f"no {phase} root at T={T}, P={P}, x={x}")

def lnphi(m, T, P, x, phase):
    rho = rho_at(m, T, P, x, phase)
    return np.log(np.array(m.get_fugacity_coefficients(T, rho * np.array(x)))), rho

def bubble_T(m, x1, P, T0):
    x = np.array([x1, 1 - x1])   # water, ethanol
    def f(T):
        y = x.copy()
        for _ in range(200):
            lL, _ = lnphi(m, T, P, x, "L")
            try:
                lV, _ = lnphi(m, T, P, y, "V")
            except ValueError:
                return 10.0
            K = np.exp(lL - lV); S = (K * x).sum(); yn = K * x / S
            if np.max(np.abs(yn - y)) < 1e-10: break
            y = yn
        f.y = y
        return np.log(S)
    T = brentq(f, T0 - 15, T0 + 15, xtol=1e-6)
    f(T)
    return T, f.y[0]

def hres(m, T, P, x):
    rho = rho_at(m, T, P, x, "L")
    return R * T * (m.get_Ar10(T, rho, x) + m.get_Ar01(T, rho, x))

def hE(m, T, P, xw):
    x = np.array([xw, 1 - xw])
    return hres(m, T, P, x) - xw * hres(m, T, P, np.array([1.0, 0.0])) - (1 - xw) * hres(m, T, P, np.array([0.0, 1.0]))

import os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "data") + "/"
kam = json.load(open(D + "ethanol_water_101kPa.json"))   # x of ethanol
txy = [(1 - r[0], r[1], 1 - r[2]) for r in kam["rows"]]  # -> x_water, T, y_water
P = kam["P_kPa"] * 1000
def obj(k):
    m = make(k); s = 0
    for xw, T, yw in txy:
        try: Tc, _ = bubble_T(m, xw, P, T); s += ((Tc - T) / 0.5) ** 2
        except Exception: s += 1e4
    return s
for k in (0.0,):
    pass
res = minimize_scalar(obj, bounds=(-0.15, 0.15), method="bounded", options={"xatol": 1e-4})
k = res.x; m = make(k)
dT = []; dy = []
for xw, T, yw in txy:
    Tc, yc = bubble_T(m, xw, P, T); dT.append(abs(Tc - T)); dy.append(abs(yc - yw))
print(f"k_ij = {k:.4f}: T-x-y AAD {np.mean(dT):.2f} K (max {max(dT):.2f}), y {np.mean(dy):.4f}")
m0 = make(0.0)
dT0 = [abs(bubble_T(m0, xw, P, T)[0] - T) for xw, T, _ in txy]
print(f"k_ij = 0: T-x-y AAD {np.mean(dT0):.2f} K")
nag = json.load(open(D + "ethanol_water_HE_nagamachi2006.json"))   # T, x_ethanol, HE kJ/mol
fang = json.load(open(D + "water_ethanol_HE_fang2014.json"))       # x_water, HE kJ/mol at 423.2 K, 5000 kPa
pts = [(r[0], 1 - r[1], 1000 * r[2], 101e3) for r in nag["rows"]] + [(fang["T_K"], r[0], 1000 * r[1], fang["P_kPa"] * 1000) for r in fang["rows"]]
for lab, mm in (("fitted k_ij", m), ("k_ij = 0", m0)):
    out = {}
    for T, xw, h, Pp in pts:
        out.setdefault(T, []).append((xw, h, hE(mm, T, Pp, xw)))
    for T, v in out.items():
        d = [abs(c - h) for _, h, c in v]
        print(f"{lab}: hE at {T} K: AAD {np.mean(d):.0f} J/mol; points (x_water, data, CPA):", [(round(a, 3), round(b), round(c)) for a, b, c in v[::3]])
