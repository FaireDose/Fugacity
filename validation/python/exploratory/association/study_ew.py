import json, sys, numpy as np
from scipy.optimize import brentq, least_squares
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from mycpa import CPA, R
wat = dict(a0=0.12277, b=0.0000145, c1=0.6736, Tc=647.13, eps=16655.0, beta=0.0692, ne=2, nH=2)
eth = dict(a0=0.85164, b=0.0491e-3, c1=0.7502, Tc=513.92, eps=21500.0, beta=0.008, ne=1, nH=1)
def rho_at(m, T, P, x, ph):
    b = np.asarray(x) @ m.b
    r = 0.7 / b if ph == "L" else P / (R * T)
    for _ in range(50):
        f = m.p(T, r, x) - P; h = r * 1e-5
        d = (m.p(T, r + h, x) - m.p(T, r - h, x)) / (2 * h)
        if d <= 0: break
        rn = r - f / d
        if not (0 < rn < 1 / b): break
        if abs(rn - r) < 1e-9 * r:
            if (ph == "L" and rn * b > 0.2) or (ph == "V" and rn * b < 0.05): return rn
            break
        r = rn
    grid = np.linspace(0.95 / b, 0.25 / b, 120) if ph == "L" else np.geomspace(1e-2, 0.05 / b, 120)
    f = [m.p(T, r, x) - P for r in grid]
    for k in range(len(grid) - 1):
        if f[k] * f[k + 1] < 0:
            r = brentq(lambda r: m.p(T, r, x) - P, grid[k], grid[k + 1], xtol=1e-9)
            if m.p(T, r * 1.0001, x) > m.p(T, r, x): return r
    raise ValueError(ph)
def bubble_T(m, xw, P, T0):
    x = np.array([xw, 1 - xw]); st = {}
    def f(T):
        y = st.get("y", x.copy())
        for _ in range(60):
            lL = m.lnphi(T, rho_at(m, T, P, x, "L"), x)
            lV = m.lnphi(T, rho_at(m, T, P, y, "V"), y)
            K = np.exp(lL - lV); S = (K * x).sum(); yn = K * x / S
            if np.max(abs(yn - y)) < 1e-8: break
            y = yn
        st["y"] = y; return np.log(S)
    T = brentq(f, T0 - 6, T0 + 6, xtol=1e-4); return T, st["y"][0]
def hE(m, T, P, xw):
    h = lambda x: m.hres(T, rho_at(m, T, P, x, "L"), x)
    return h(np.array([xw, 1 - xw])) - xw * h(np.array([1.0, 0.0])) - (1 - xw) * h(np.array([0.0, 1.0]))
import os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "data") + "/"
kam = json.load(open(D + "ethanol_water_101kPa.json"))
txy = [(1 - r[0], r[1], 1 - r[2]) for r in kam["rows"]][::4]   # every other point, for speed
P = kam["P_kPa"] * 1000
nag = json.load(open(D + "ethanol_water_HE_nagamachi2006.json")); fang = json.load(open(D + "water_ethanol_HE_fang2014.json"))
he = [(r[0], 1 - r[1], 1000 * r[2], 101e3) for r in nag["rows"]][::4] + [(fang["T_K"], r[0], 1000 * r[1], fang["P_kPa"] * 1000) for r in fang["rows"]][::3]
def resid(p, use_he):
    m = CPA([wat, eth], kij=p[0], eps_cross=p[1] if len(p) > 1 else None)
    r = []
    for xw, T, yw in txy:
        try: Tc, yc = bubble_T(m, xw, P, T); r += [(Tc - T) / 0.5, (yc - yw) / 0.01]
        except Exception: r += [20, 20]
    if use_he:
        for T, xw, h, Pp in he:
            try: r.append((hE(m, T, Pp, xw) - h) / 20)
            except Exception: r.append(50)
    return np.array(r)
def report(lab, p):
    m = CPA([wat, eth], kij=p[0], eps_cross=p[1] if len(p) > 1 else None)
    full = [(1 - r[0], r[1], 1 - r[2]) for r in kam["rows"]]
    dT = [abs(bubble_T(m, xw, P, T)[0] - T) for xw, T, _ in full]
    allhe = [(r[0], 1 - r[1], 1000 * r[2], 101e3) for r in nag["rows"]] + [(fang["T_K"], r[0], 1000 * r[1], fang["P_kPa"] * 1000) for r in fang["rows"]]
    byT = {}
    for T, xw, h, Pp in allhe: byT.setdefault(T, []).append(abs(hE(m, T, Pp, xw) - h))
    print(lab, "params", np.round(p, 4), f"| T-x-y AAD {np.mean(dT):.2f} K (max {max(dT):.2f})", "| hE AAD by T:", {T: round(float(np.mean(v))) for T, v in byT.items()}, flush=True)
r1 = least_squares(lambda p: resid(p, False), [0.0], diff_step=1e-3)
report("CR-1, k_ij fitted to T-x-y:", r1.x)
r2 = least_squares(lambda p: resid(p, True), [r1.x[0], (16655 + 21500) / 2], x_scale=[0.01, 1000], diff_step=1e-3)
report("k_ij + eps_cross fitted to T-x-y and hE:", r2.x)
