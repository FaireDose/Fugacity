"""
Fit binary NRTL / UNIQUAC parameters to experimental data and write them to
src/data/binaries.json. Each fit is defined in FITS below: which pair, which data
file, and which parameters are free.

    python validation/python/fit_parameters.py            # fit and print, no changes
    python validation/python/fit_parameters.py --write    # fit and update binaries.json

Objective: bubble temperature (weight 1/0.5 K) and vapour composition (1/0.01) for
isobaric T-x-y data; relative pressure (1/0.5 %) for isothermal P-x data; excess
enthalpy (1/20 J/mol) when given; equal activities of both components in the two
liquids of liquid-liquid data (ln a, 1/0.05); ln gamma at infinite dilution (1/0.05);
heterogeneous azeotrope: bubble pressure of the two liquids (1/0.5 kPa) and vapour mole
fraction (1/0.01). Temperature-dependent fits of data files store the temperature range
of their data as "T_range_K" and state it in "source".

Data kinds a FITS entry can use:
  "txy"            water + ethylene glycol compilation (water_ethylene_glycol_760mmHg.json)
  "uniquac-curve"  the databank UNIQUAC T-x-y curve (no open experimental data)
  "schmid"         Schmid et al. (2007) P-x and HE for acetic acid + ethylene glycol
  "txy-file"       data files in validation/data/ (spec key "file", or "files" for several),
                   each with "components", "kind", "columns" and "rows":
                     kind "isobaric-txy"  columns x_1, y_1, T_K or T_C; "P_kPa". Rows of
                                          pure components are left out.
                     kind "lle"           columns T_K and x_1_I / x_1_II / x_2_I / x_2_II
                                          (mole fractions in liquids I and II). Rows with
                                          both liquids are fitted (isoactivity); rows with
                                          one liquid are only compared.
                     kind "gamma-infinite-dilution"  columns T_K and gamma_1 or gamma_2
                                          (activity coefficient of that component at x -> 0).
                     kind "azeotrope" with "heterogeneous": true  columns T_C (or T_K) and
                                          wt_pct_1 or wt_pct_2 (overall = vapour composition)
                                          and "P_kPa": the two liquids in equilibrium at T
                                          must boil at P with that vapour. Fitted in a second
                                          stage, started from the fit without it.
                   Files under "check" are compared with the result but not fitted.
For "txy-file" fits a spec may also set "alpha" (NRTL non-randomness, default 0.3).
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import brentq, least_squares

from reference_model import System, DATA, COMPONENTS, ALL_BINARIES, psat_kpa

ROOT = Path(__file__).resolve().parents[2]
VAL = ROOT / "validation" / "data"
BIN_FILE = DATA / "binaries.json"


def load(name):
    return json.loads((VAL / name).read_text())


def water_eg_txy():
    d = load("water_ethylene_glycol_760mmHg.json")
    return d["P_kPa"], [(p["x_water"], p["T_C"] + 273.15, p["y_water"]) for p in d["txy"]]


def schmid():
    d = load("schmid2007_acetic_acid_ethylene_glycol.json")
    px = [(p["x1"], p["P_kPa"]) for p in d["px"]]
    he = [(p["x1"], p["HE_J_mol"]) for p in d["HE_323K"]]
    return d["T_K"], px, he


def _orient(d, name, pair):
    """True if the file lists the pair's components in reverse order."""
    comps = list(d["components"])
    if comps == list(pair):
        return False
    if comps == [pair[1], pair[0]]:
        return True
    raise ValueError(f"{name}: components {comps} do not match the pair {pair}")


def txy_file(name, pair):
    """Isobaric T-x-y file as (P_kPa, [(x1, T_K, y1)]) with x1, y1 of pair[0]. Pure-component
    rows are left out: they test the vapour-pressure equations, not the pair parameters."""
    d = load(name)
    if d.get("kind") != "isobaric-txy":
        raise ValueError(f"{name}: kind {d.get('kind')!r} is not isobaric-txy")
    flip = _orient(d, name, pair)
    col = {c: k for k, c in enumerate(d["columns"])}
    pts = []
    for r in d["rows"]:
        x1, y1 = r[col["x_1"]], r[col["y_1"]]
        T = r[col["T_K"]] if "T_K" in col else r[col["T_C"]] + 273.15
        if x1 <= 0 or x1 >= 1:
            continue
        pts.append((1 - x1, T, 1 - y1) if flip else (x1, T, y1))
    return d["P_kPa"], pts


def lle_file(name, pair):
    """Liquid-liquid file as [(T_K, x1 in liquid I or None, x1 in liquid II or None)] with
    x1 of pair[0]."""
    d = load(name)
    flip = _orient(d, name, pair)
    col = {c: k for k, c in enumerate(d["columns"])}

    def x_first(r, phase):
        if f"x_1_{phase}" in col:
            v = r[col[f"x_1_{phase}"]]
        elif f"x_2_{phase}" in col:
            v = 1 - r[col[f"x_2_{phase}"]]
        else:
            return None
        return 1 - v if flip else v
    return [(r[col["T_K"]], x_first(r, "I"), x_first(r, "II")) for r in d["rows"]]


def gamma_inf_file(name, pair):
    """Infinite-dilution file as [(T_K, index in pair of the solute, gamma)]."""
    d = load(name)
    flip = _orient(d, name, pair)
    col = {c: k for k, c in enumerate(d["columns"])}
    k_file = 0 if "gamma_1" in col else 1
    k = 1 - k_file if flip else k_file
    return [(r[col["T_K"]], k, r[col[f"gamma_{k_file + 1}"]]) for r in d["rows"]]


def het_azeotrope_file(name, pair):
    """Heterogeneous azeotrope file as [(T_K, P_kPa, y1)] with y1 the vapour mole fraction of
    pair[0], converted from weight percent with the molar masses in components.json."""
    d = load(name)
    if not d.get("heterogeneous"):
        raise ValueError(f"{name}: only heterogeneous azeotropes are supported")
    flip = _orient(d, name, pair)
    col = {c: k for k, c in enumerate(d["columns"])}
    M = [COMPONENTS[c]["MW"] for c in d["components"]]
    out = []
    for r in d["rows"]:
        T = r[col["T_K"]] if "T_K" in col else r[col["T_C"]] + 273.15
        w1 = r[col["wt_pct_1"]] if "wt_pct_1" in col else 100 - r[col["wt_pct_2"]]
        n1, n2 = w1 / M[0], (100 - w1) / M[1]
        y1 = n1 / (n1 + n2)
        out.append((T, d["P_kPa"], 1 - y1 if flip else y1))
    return out


def file_sets(spec, key="files"):
    """Data sets of a "txy-file" fit: list of (kind, name, content)."""
    names = spec.get(key, [spec["file"]] if key == "files" and "file" in spec else [])
    out = []
    for name in names:
        kind = load(name)["kind"]
        if kind == "isobaric-txy":
            out.append(("txy", name, txy_file(name, spec["pair"])))
        elif kind == "lle":
            out.append(("lle", name, lle_file(name, spec["pair"])))
        elif kind == "gamma-infinite-dilution":
            out.append(("ginf", name, gamma_inf_file(name, spec["pair"])))
        elif kind == "azeotrope":
            out.append(("haz", name, het_azeotrope_file(name, spec["pair"])))
        else:
            raise ValueError(f"{name}: unknown kind {kind!r}")
    return out


def txy_sets(spec):
    """List of (P_kPa, points) for the T-x-y kinds."""
    i, j = spec["pair"]
    if spec["data"] == "txy":
        return [water_eg_txy()]
    if spec["data"] == "uniquac-curve":
        return [uniquac_curve(i, j)]
    if spec["data"] == "txy-file":
        return [c for kind, _, c in file_sets(spec) if kind == "txy"]
    return None


def uniquac_curve(i, j):
    """Reference T-x-y curve from the databank UNIQUAC set, used when no open experimental
    data set is at hand; the NRTL set is then fitted to reproduce it."""
    s = System([i, j], "UNIQUAC")
    pts = []
    for x1 in [0.01, 0.03] + [0.05 + 0.9 * k / 16 for k in range(17)] + [0.97, 0.99]:
        T, y = s.bubble_t([x1, 1 - x1], 101.325)
        pts.append((x1, T, y[0]))
    return 101.325, pts


MAC = "data public in the NIST TRC ThermoML Archive"
FITS = [
    dict(pair=("water", "acetic-acid"), data="uniquac-curve", models=["NRTL"], temperature_dependent=False,
         describe="Fitted to reproduce the ChemSep UNIQUAC T-x-y curve at 101.325 kPa (no open experimental set yet)."),
    dict(pair=("water", "ethylene-glycol"), data="txy", temperature_dependent=False,
         describe="Fitted to 18 T-x-y points at 760 mmHg (compilation on Wikipedia ethylene glycol data page)."),
    dict(pair=("acetic-acid", "ethylene-glycol"), data="schmid", temperature_dependent=True,
         describe="Fitted to Schmid, Doeker, Gmehling, Fluid Phase Equilib. 258 (2007) 115 (data public in the NIST TRC ThermoML Archive): P-x at 363.15 K (with the paper's pure-component pressures) and HE at 323.15 K."),
    # Methanol + acetone + chloroform: the three pairs of the saddle-azeotrope ternary.
    dict(pair=("methanol", "acetone"), data="txy-file", file="acetone_methanol_101kPa.json", temperature_dependent=False,
         describe=f"Fitted to 19 T-x-y points at 101.3 kPa from Li, Du, Chen, Li, Guo, Zhang, Fluid Phase Equilib. 459 (2018) 10 ({MAC}; validation/data/acetone_methanol_101kPa.json)."),
    dict(pair=("methanol", "chloroform"), data="txy-file", file="chloroform_methanol_101kPa.json", temperature_dependent=False,
         describe=f"Fitted to 19 T-x-y points at 101.3 kPa from Li, Cao, Zhang, Liu, Wang, J. Chem. Eng. Data 59 (2014) 234 ({MAC}; validation/data/chloroform_methanol_101kPa.json)."),
    dict(pair=("acetone", "chloroform"), data="txy-file", file="acetone_chloroform_101kPa.json", temperature_dependent=False,
         describe="Fitted to 9 T-x-y points at 101.3 kPa from Gao, Zhao, Jia, Zhang, Appl. Sci. 8 (2018) 1519 (open access, CC BY 3.0; validation/data/acetone_chloroform_101kPa.json)."),
    # Ethanol + water + ethyl acetate: the three pairs of the minimum-boiling ternary azeotrope.
    dict(pair=("water", "ethanol"), data="txy-file", file="ethanol_water_101kPa.json", temperature_dependent=False,
         describe=f"Fitted to 21 T-x-y points at 101.3 kPa from Kamihama, Matsuda, Kurihara, Tochigi, Oba, J. Chem. Eng. Data 57 (2012) 339 ({MAC}; validation/data/ethanol_water_101kPa.json)."),
    dict(pair=("ethanol", "ethyl-acetate"), data="txy-file", file="ethyl-acetate_ethanol_101kPa.json",
         check=["ethyl-acetate_ethanol_101kPa_zhang2017.json"], temperature_dependent=False,
         describe=f"Fitted to 24 T-x-y points at 101.3 kPa from Calvar, Dominguez, Tojo, Fluid Phase Equilib. 235 (2005) 215 ({MAC}; validation/data/ethyl-acetate_ethanol_101kPa.json); checked against Zhang et al., Fluid Phase Equilib. 454 (2017) 91."),
    # Partially miscible: liquid-liquid data, activity coefficients at infinite dilution and the
    # heterogeneous azeotrope at 1 atm together, temperature-dependent. No open finite-
    # concentration VLE data for this pair was found, so the handbook azeotrope is the only VLE
    # target away from infinite dilution; without it the fit puts the 1-atm azeotrope about 2 K
    # too high (pull request #19).
    dict(pair=("water", "ethyl-acetate"), data="txy-file", temperature_dependent=True,
         files=["water_ethyl-acetate_lle_grande2005.json", "water_ethyl-acetate_lle_cehreli2006.json",
                "water_ethyl-acetate_gamma_inf_fenclova2014.json", "water_ethyl-acetate_gamma_inf_atik2004.json",
                "water_ethyl-acetate_azeotrope_101kPa.json"],
         check=["water_ethyl-acetate_lle_xu2017.json"],
         wanted="open finite-concentration VLE data (isobaric T-x-y near 101.3 kPa, isothermal P-x-y, or VLLE); the 1-atm VLE target is a handbook azeotrope. Excess enthalpies (in the ThermoML Archive, Brandt et al., Fluid Phase Equilib. 376 (2014) 48) could also constrain the temperature dependence.",
         describe=f"Fitted to mutual solubilities at 298-333 K (Grande, Marschoff, J. Chem. Eng. Data 50 (2005) 1324; Cehreli, Ozmen, Dramur, Fluid Phase Equilib. 239 (2006) 156), activity coefficients of ethyl acetate at infinite dilution in water at 273-343 K (Fenclova et al., Fluid Phase Equilib. 375 (2014) 347; Atik et al., J. Chem. Eng. Data 49 (2004) 1429), both {MAC}, and the heterogeneous azeotrope at 101.325 kPa, 70.4 degC and 91.9 wt % ethyl acetate (handbook value, Wikipedia 'Azeotrope tables', from Lange's 10th ed. and CRC 44th ed.); files validation/data/water_ethyl-acetate_*.json. No open finite-concentration VLE data was found for this pair."),
]


def make_params(model, i, j, p, alpha=0.3):
    a_ij, a_ji = (p[2], p[3]) if len(p) > 2 else (0.0, 0.0)
    e = dict(model=model, i=i, j=j, a_ij=float(a_ij), a_ji=float(a_ji), b_ij=float(p[0]), b_ji=float(p[1]))
    if model == "NRTL":
        e["alpha"] = alpha
    return e


def file_residuals(s, sets):
    """Weighted residuals of a system against the data sets of a "txy-file" fit."""
    r = []
    for kind, _, c in sets:
        if kind == "txy":
            P, pts = c
            for x1, T, y1 in pts:
                Tc, y = s.bubble_t([x1, 1 - x1], P)
                r += [(Tc - T) / 0.5, (y[0] - y1) / 0.01]
        elif kind == "lle":
            for T, a, b in c:
                if a is not None and b is not None:
                    r += list(s.isoactivity_residual([a, 1 - a], [b, 1 - b], T) / 0.05)
        elif kind == "ginf":
            for T, k, g in c:
                x = [1e-9, 1 - 1e-9] if k == 0 else [1 - 1e-9, 1e-9]
                r.append((np.log(max(s.gamma(x, T)[k], 1e-300)) - np.log(g)) / 0.05)
        else:  # heterogeneous azeotrope: the two liquids at T boil at P with vapour y1
            for T, P, y1 in c:
                z = lle_from_data(s, T, None, None)
                if z is None:
                    r += [100.0, 100.0]
                    continue
                Pc, y = s.equilibrium([z[0], 1 - z[0]], T)
                r += [(Pc - P) / 0.5, (y[0] - y1) / 0.01]
    return r


def fit(spec, model):
    i, j = spec["pair"]
    alpha = spec.get("alpha", 0.3)
    if spec["data"] == "txy-file":
        all_sets = file_sets(spec)
        sets = [st for st in all_sets if st[0] != "haz"]   # first stage: without azeotrope targets

        def residuals(p):
            return np.array(file_residuals(System([i, j], model, params=[make_params(model, i, j, p, alpha)]), sets))
    elif txy_sets(spec) is not None:
        sets = txy_sets(spec)

        def residuals(p):
            s = System([i, j], model, params=[make_params(model, i, j, p, alpha)])
            r = []
            for P, pts in sets:
                for x1, T, y1 in pts:
                    Tc, y = s.bubble_t([x1, 1 - x1], P)
                    r += [(Tc - T) / 0.5, (y[0] - y1) / 0.01]
            return np.array(r)
    else:
        T0, px, he = schmid()
        pure = [px[-1][1], px[0][1]]

        def residuals(p):
            s = System([i, j], model, psat=pure, params=[make_params(model, i, j, p)])
            r = [(s.equilibrium([x1, 1 - x1], T0)[0] - P) / P / 0.005 for x1, P in px[1:-1]]
            r += [(s.excess_enthalpy([x1, 1 - x1], 323.15) - h) / 20.0 for x1, h in he]
            return np.array(r)

    n = 4 if spec["temperature_dependent"] else 2
    best = None
    for start in [(100, -100), (-100, 100), (300, -200), (-200, 300), (500, -300), (-300, 500)]:
        try:
            res = least_squares(residuals, list(start) + [0.0] * (n - len(start)), method="lm")
        except Exception:
            continue
        if best is None or res.cost < best.cost:
            best = res
    if spec["data"] == "txy-file" and len(sets) < len(all_sets):
        # second stage: all targets, started from the first-stage optimum (where the
        # liquid-liquid split needed by the azeotrope target exists)
        sets = all_sets
        best = least_squares(residuals, best.x, method="lm")
    return make_params(model, i, j, best.x, alpha), best


def txy_deviations(sets, model, i, j, params):
    """Absolute deviations in T (K) and y over all points, with a given parameter list."""
    s = System([i, j], model, params=params)
    dT, dy = [], []
    for P, pts in sets:
        for x1, T, y1 in pts:
            Tc, y = s.bubble_t([x1, 1 - x1], P)
            dT.append(abs(Tc - T)); dy.append(abs(y[0] - y1))
    return np.array(dT), np.array(dy)


def lle_from_data(s, T, a, b):
    """Model liquid-liquid split at T started from the measured compositions; when only one
    liquid was measured, the other is searched from several starting values and the widest
    split is kept."""
    if a is not None and b is not None:
        return s.lle_binary(T, (a, b))
    if a is None and b is None:
        a = 0.985   # no data: start the first liquid rich in the first component of the pair
    best = None
    for g in (0.02, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.98):
        z = s.lle_binary(T, (a, g) if a is not None else (g, b))
        if z is not None and (best is None or abs(z[0] - z[1]) > abs(best[0] - best[1])):
            best = z
    return best


def describe_fit(sets, model, i, j, params):
    """Fit quality against "txy-file" data sets, one phrase per kind of data."""
    s = System([i, j], model, params=params)
    out = []
    txy = [c for kind, _, c in sets if kind == "txy"]
    if txy:
        dT, dy = txy_deviations(txy, model, i, j, params)
        out.append(f"AAD {np.mean(dT):.2f} K in T, {np.mean(dy):.4f} in y (max {dT.max():.2f} K, {dy.max():.4f})")
    lle = [p for kind, _, c in sets if kind == "lle" for p in c]
    if lle:
        dI, dII, miss = [], [], 0
        for T, a, b in lle:
            z = lle_from_data(s, T, a, b)
            if z is None:
                miss += 1
                continue
            if a is not None:
                dI.append(abs(z[0] - a))
            if b is not None:
                dII.append(abs(z[1] - b))
        phr = f"liquid-liquid: AAD {np.mean(dI):.4f} in x of {i} in the {i}-rich liquid" if dI else "liquid-liquid:"
        if dII:
            phr += f", {np.mean(dII):.4f} in the {j}-rich liquid"
        if miss:
            phr += f" ({miss} points without a predicted split)"
        out.append(phr)
    ginf = [p for kind, _, c in sets if kind == "ginf" for p in c]
    if ginf:
        dev = []
        for T, k, g in ginf:
            x = [1e-9, 1 - 1e-9] if k == 0 else [1 - 1e-9, 1e-9]
            dev.append(abs(s.gamma(x, T)[k] / g - 1) * 100)
        out.append(f"gamma at infinite dilution: AARD {np.mean(dev):.1f} % (max {np.max(dev):.1f} %)")
    for T, P, y1 in [p for kind, _, c in sets if kind == "haz" for p in c]:
        az = heterogeneous_azeotrope(s, P, T)
        out.append(f"heterogeneous azeotrope at {P} kPa: {az[0] - 273.15:.2f} degC, vapour x of {i} {az[3]:.3f}, liquids {az[1]:.3f} / {az[2]:.3f} (target {T - 273.15:.2f} degC, {y1:.3f})"
                   if az else f"heterogeneous azeotrope at {P} kPa: none found (target {T - 273.15:.2f} degC)")
    return "; ".join(out)


def heterogeneous_azeotrope(s, P, T_guess, span=15.0):
    """Binary heterogeneous azeotrope: the temperature at which the two liquids in equilibrium
    boil at P. Follows the liquid-liquid split from T_guess - span upwards and bisects.
    Returns (T, x1 in liquid a, x1 in liquid b, y1) or None."""
    T0 = T_guess - span
    z0 = lle_from_data(s, T0, None, None)
    if z0 is None:
        return None
    P0 = s.equilibrium([z0[0], 1 - z0[0]], T0)[0]
    while T0 < T_guess + span:
        T1 = T0 + 0.5
        z1 = s.lle_binary(T1, z0)
        if z1 is None:
            return None
        P1 = s.equilibrium([z1[0], 1 - z1[0]], T1)[0]
        if (P0 - P) * (P1 - P) <= 0:
            a, b, za = T0, T1, z0
            for _ in range(50):
                m = (a + b) / 2
                zm = s.lle_binary(m, za)
                if zm is None:
                    return None
                if (s.equilibrium([zm[0], 1 - zm[0]], m)[0] - P) * (P0 - P) > 0:
                    a, za = m, zm
                else:
                    b = m
            y = s.equilibrium([zm[0], 1 - zm[0]], m)[1]
            return m, zm[0], zm[1], y[0]
        T0, P0, z0 = T1, P1, z1
    return None


def data_T_range(sets):
    """Lowest and highest temperature (K) in the data sets of a "txy-file" fit."""
    Ts = []
    for kind, _, c in sets:
        Ts += [T for _, T, _ in c[1]] if kind == "txy" else [q[0] for q in c]
    return [round(min(Ts), 2), round(max(Ts), 2)]


def quality(spec, model, params):
    i, j = spec["pair"]
    if spec["data"] in ("txy", "uniquac-curve"):
        P, pts = water_eg_txy() if spec["data"] == "txy" else uniquac_curve(i, j)
        s = System([i, j], model, params=[params])
        dT = [abs(s.bubble_t([x1, 1 - x1], P)[0] - T) for x1, T, _ in pts]
        dy = [abs(s.bubble_t([x1, 1 - x1], P)[1][0] - y1) for x1, _, y1 in pts]
        return f"AAD {np.mean(dT):.1f} K, {np.mean(dy):.3f} in y."
    if spec["data"] == "txy-file":
        q = describe_fit(file_sets(spec), model, i, j, [params]) + "."
        for kind, name, c in file_sets(spec, "check"):
            q += f" Check against {name}: {describe_fit([(kind, name, c)], model, i, j, [params])}."
        return q
    T0, px, he = schmid()
    s = System([i, j], model, psat=[px[-1][1], px[0][1]], params=[params])
    dP = [abs(s.equilibrium([x1, 1 - x1], T0)[0] / P - 1) * 100 for x1, P in px]
    dH = [abs(s.excess_enthalpy([x1, 1 - x1], 323.15) - h) for x1, h in he]
    return f"AAD {np.mean(dP):.1f} % in P, {np.mean(dH):.0f} J/mol in HE."


def point_test(spec, nterms=4):
    """Thermodynamic consistency point test (Van Ness et al. 1973; Fredenslund et al. 1977):
    fit a Redlich-Kister expansion of G^E/RT to the T-x data only (Barker's method, ideal
    vapour, the databank vapour pressures) and compare the vapour compositions it predicts
    with the measured ones. Mean |dy| below 0.01 is the usual pass criterion.
    Returns None when the fit has no T-x-y data."""
    i, j = spec["pair"]
    c = [COMPONENTS[i], COMPONENTS[j]]
    sets = txy_sets(spec)
    if not sets:
        return None

    def lngam(A, x1):
        x2 = 1 - x1
        d = x1 - x2
        g = x1 * x2 * sum(a * d ** k for k, a in enumerate(A))
        dg = (x2 - x1) * sum(a * d ** k for k, a in enumerate(A)) + x1 * x2 * sum(2 * k * a * d ** (k - 1) for k, a in enumerate(A) if k)
        return g + x2 * dg, g - x1 * dg

    def bubble(A, x1, P):
        l1, l2 = lngam(A, x1)
        f = lambda T: x1 * np.exp(l1) * psat_kpa(c[0], T) + (1 - x1) * np.exp(l2) * psat_kpa(c[1], T) - P
        T = brentq(f, 250.0, 600.0, xtol=1e-10)
        return T, x1 * np.exp(l1) * psat_kpa(c[0], T) / P

    def res(A):
        return np.array([(bubble(A, x1, P)[0] - T) for P, pts in sets for x1, T, _ in pts])

    A = least_squares(res, [0.0] * nterms, method="lm").x
    dy = [abs(bubble(A, x1, P)[1] - y1) for P, pts in sets for x1, _, y1 in pts]
    return float(np.mean(dy))


def main(write):
    binaries = json.loads(BIN_FILE.read_text())
    for spec in FITS:
        test = ""
        if spec["data"] == "txy-file":
            dy_test = point_test(spec)
            if dy_test is not None:
                print(f"{spec['pair']}: point test (Redlich-Kister, 4 terms, T-x only): mean |dy| = {dy_test:.4f}")
                test = f" Data consistency point test (Redlich-Kister fit to T-x): mean |dy| {dy_test:.3f}{' (passes, < 0.01)' if dy_test < 0.01 else ' (fails, >= 0.01)'}."
        for model in spec.get("models", ["NRTL", "UNIQUAC"]):
            params, _ = fit(spec, model)
            q = quality(spec, model, params) + test
            params["source"] = f"{spec['describe']} {q}"
            params["tier"] = "databank" if spec["data"] == "uniquac-curve" else "fitted"
            if spec.get("wanted"):
                params["data_wanted"] = spec["wanted"]
            if spec["data"] == "txy-file" and spec["temperature_dependent"]:
                # temperature-dependent sets are trusted only inside the range of their data
                params["T_range_K"] = data_T_range(file_sets(spec))
                params["source"] += f" Temperature range of the data: {params['T_range_K'][0]}-{params['T_range_K'][1]} K; outside it the parameters are extrapolated."
            if spec["data"] == "txy-file":
                # the databank set this fit replaced (kept as a non-default set), on the same data
                i, j = spec["pair"]
                old = [p for p in ALL_BINARIES if p["model"] == model and {p["i"], p["j"]} == {i, j} and p.get("tier") != "fitted"]
                if old:
                    old_q = describe_fit(file_sets(spec) + file_sets(spec, "check"), model, i, j, [dict(old[0], model=model)])
                    print(f"  {model} replaced databank parameters on the same data: {old_q}")
            print(model, spec["pair"], {k: round(v, 4) for k, v in params.items() if isinstance(v, float)}, q)
            # A pair can have several parameter sets per model (proposal 0003); the fit replaces
            # the default set. A databank default replaced by a fit to data stays as a
            # non-default set. Run make_sources.py afterwards: it names new sets and adds their
            # source_ids.
            recs = binaries["pairs"]
            for k, old in enumerate(recs):
                if old["model"] == model and {old["i"], old["j"]} == set(spec["pair"]) and old.get("default", True):
                    params = {"model": params.pop("model"), "i": params.pop("i"), "j": params.pop("j"), "default": True, **params}
                    if spec["data"] == "txy-file" and old.get("tier") != "fitted":
                        recs[k] = dict(old, default=False)
                        recs.insert(k, params)
                    else:
                        if old.get("set") and old.get("tier") == params["tier"]:
                            params = {"model": params["model"], "i": params["i"], "j": params["j"], "set": old["set"], **params}
                        recs[k] = params
                    break
    if write:
        BIN_FILE.write_text(json.dumps(binaries, indent=2) + "\n")
        print(f"updated {BIN_FILE}")


if __name__ == "__main__":
    main("--write" in sys.argv)
