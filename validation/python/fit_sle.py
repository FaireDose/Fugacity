"""
NRTL parameters for solid + solvent pairs fitted to measured solubilities (proposal 0007, step 4; the data of
validation/data/sle/<solid>.json, NIST TRC ThermoML Archive, validation/python/fetch_sle.py).

The model is the one the engine uses (src/equilibrium/sle.js): a pure solid in equilibrium with the liquid,

    ln(x_s γ_s) = −(ΔH_fus / R T)(1 − T / T_m)        (ΔCp of fusion 0; T_m, ΔH_fus from src/data/components.json)

with γ_s from NRTL, τ_ij = b_ij / T (a_ij = 0) and α = 0.3: two parameters per pair. The objective is the
activity residual ln(x γ(x, T)) − right-hand side at each measured (T, x), each article weighted equally (weight
1/sqrt(n) per point of an article with n points), plus a weak penalty on the size of the parameters
(RIDGE · b / 1000 K per parameter): solubility data of a dilute solid fix ln γ of the solid, not of the solvent, so
one parameter is often ill-determined and drifts to thousands of kelvin, which predicts a liquid split that the
pair does not have. Started from several points and refined by least squares (scipy). The fitted set is then judged by the solubility it gives: x solved from the equation (the solvent-rich
root, as the engine does) against the measured x, as the median and maximum of |x_calc / x_meas − 1|, and the same
for each article.

Validation on data not used in the fit: for a pair with three or more articles, the fit is repeated without each
article in turn and the left-out article is compared with it (median of its deviations); the table and the record
give the median over the left-out articles.

Rules (stated in each record):
  - a pair is fitted when it has at least 6 measured points over at least 10 K; with fewer it is reported only;
  - a fitted set is written when the median deviation of its articles is 15 % or less (the scatter between
    articles of the same pair in docs/SLE_CHECKS.md is often 5-20 %); otherwise it is reported, not written;
  - and when the liquid stays one phase at every composition over the measured temperatures (the Gibbs energy of
    mixing convex in x), except with water, which forms two liquids with these solids; a set that splits the
    liquid of a fully miscible pair is reported, not written;
  - with water, the model's solubility branch can end inside the measured range: above that temperature it
    predicts that the solid melts into a second, solid-rich liquid (a monotectic), and x jumps. The record's valid
    range then ends 0.5 K below it, says so, and the deviations are those inside the valid range;
  - the parameters come from solubility data only: the record says that they were not checked against
    vapour-liquid data, and they are extrapolated outside the measured temperatures.

    python validation/python/fit_sle.py            # fit and print
    python validation/python/fit_sle.py --write    # also write the sets to src/data/binaries.json and the
                                                   # report docs/SLE_FITS.md
"""
import argparse
import json
import statistics
from pathlib import Path

import numpy as np
from scipy.optimize import brentq, least_squares

from reference_model import System, COMPONENTS, DATA

ROOT = Path(__file__).resolve().parents[2]
SLE_DIR = ROOT / "validation" / "data" / "sle"
BIN_FILE = DATA / "binaries.json"
DOC = ROOT / "docs" / "SLE_FITS.md"
R = 8.314462618
ALPHA = 0.3
MIN_POINTS, MIN_SPAN_K, MAX_MEDIAN = 6, 10.0, 0.15
RIDGE = 0.02
SPLITS_ALLOWED = {"water"}   # solvents that really form two liquids with these solids
SET = "fitted-sle-thermoml"
STARTS = [(0.0, 0.0), (300.0, 300.0), (-300.0, 600.0), (600.0, -300.0), (1500.0, 500.0), (500.0, 1500.0), (2500.0, 2500.0)]


def rhs(Tm, H, T):
    return -(H / (R * T)) * (1 - T / Tm)


def params(i, j, b):
    return [{"model": "NRTL", "i": i, "j": j, "a_ij": 0.0, "a_ji": 0.0, "b_ij": float(b[0]), "b_ji": float(b[1]), "alpha": ALPHA}]


def solubility(s, Tm, H, T):
    """x of component 0 (the solid) at T: the first rising sign change of ln x + ln γ − rhs from x = 1e-12 (the
    solvent-rich root), as src/equilibrium/sle.js."""
    r = rhs(Tm, H, T)

    def f(u):
        x = np.exp(u)
        return u + np.log(s.gamma([x, 1 - x], T)[0]) - r
    grid = np.linspace(np.log(1e-12), 0.0, 241)
    fs = [f(u) for u in grid]
    for k in range(len(grid) - 1):
        if fs[k] < 0 <= fs[k + 1]:
            return float(np.exp(brentq(f, grid[k], grid[k + 1], xtol=1e-13)))
    return None


def pairs():
    """{(solid, solvent): {doi: [(T, x)]}} from the measured files, below the solid's melting temperature."""
    out = {}
    for f in sorted(SLE_DIR.glob("*.json")):
        d = json.loads(f.read_text())
        solid = d["solid"]
        Tm = COMPONENTS[solid]["fusion"]["Tm_K"]
        for st in d["sets"]:
            for r in st["rows"]:
                if r["T_K"] < Tm:
                    out.setdefault((solid, st["solvent"]), {}).setdefault(st["doi"], []).append((r["T_K"], r["x_solute"]))
    return out, {json.loads(f.read_text())["solid"]: json.loads(f.read_text())["articles"] for f in SLE_DIR.glob("*.json")}


def fit(solid, solvent, arts):
    f = COMPONENTS[solid]["fusion"]
    Tm, H = f["Tm_K"], f["Hfus_J_mol"]
    pts = [(T, x, 1 / np.sqrt(len(v))) for v in arts.values() for T, x in v]
    T = np.array([p[0] for p in pts]); X = np.array([p[1] for p in pts]); W = np.array([p[2] for p in pts])
    rh = rhs(Tm, H, T)

    def res(b):
        s = System([solid, solvent], "NRTL", params=params(solid, solvent, b))
        lg = np.array([np.log(s.gamma([x, 1 - x], t)[0]) for t, x in zip(T, X)])
        return np.concatenate([W * (np.log(X) + lg - rh), RIDGE * np.asarray(b) / 1000.0])
    best = None
    for b0 in STARTS:
        try:
            r = least_squares(res, b0, method="lm", max_nfev=2000)
        except Exception:
            continue
        if best is None or r.cost < best.cost:
            best = r
    b = best.x
    s = System([solid, solvent], "NRTL", params=params(solid, solvent, b))
    per = {}
    for doi, v in arts.items():
        dev = []
        for t, x in v:
            xc = solubility(s, Tm, H, t)
            dev.append(abs(xc / x - 1) if xc else float("inf"))
        per[doi] = dev
    # the ideal solution, for comparison (γ = 1)
    ideal = {doi: [abs(np.exp(rhs(Tm, H, t)) / x - 1) for t, x in v] for doi, v in arts.items()}
    return b, per, ideal


def held_out(solid, solvent, arts):
    """Leave-one-article-out: the median, over the articles, of each left-out article's median deviation."""
    if len(arts) < 3:
        return None
    f = COMPONENTS[solid]["fusion"]
    out = []
    for doi in arts:
        rest = {k: v for k, v in arts.items() if k != doi}
        b, _, _ = fit(solid, solvent, rest)
        s = System([solid, solvent], "NRTL", params=params(solid, solvent, b))
        dev = []
        for t, x in arts[doi]:
            xc = solubility(s, f["Tm_K"], f["Hfus_J_mol"], t)
            dev.append(abs(xc / x - 1) if xc else float("inf"))
        out.append(statistics.median(dev))
    return statistics.median(out)


def branch_end(solid, solvent, b, T0, T1):
    """The temperature where the solvent-rich solubility jumps (by more than 5 times between 0.25 K steps), or None."""
    f = COMPONENTS[solid]["fusion"]
    s = System([solid, solvent], "NRTL", params=params(solid, solvent, b))
    prev = None
    for T in np.arange(T0, T1 + 0.25, 0.25):
        x = solubility(s, f["Tm_K"], f["Hfus_J_mol"], T)
        if prev is not None and (x is None or x > 5 * prev):
            return float(T)
        prev = x
    return None


def splits(solid, solvent, b, T0, T1):
    """True if the NRTL liquid is unstable (two liquids) somewhere in x at T0, the middle or T1: g = Gmix/RT not
    convex (second difference negative) on a fine grid."""
    s = System([solid, solvent], "NRTL", params=params(solid, solvent, b))
    xs = np.linspace(1e-4, 1 - 1e-4, 401)
    for T in (T0, 0.5 * (T0 + T1), T1):
        g = np.array([x * np.log(x * s.gamma([x, 1 - x], T)[0]) + (1 - x) * np.log((1 - x) * s.gamma([x, 1 - x], T)[1]) for x in xs])
        if np.any(np.diff(g, 2) < -1e-12):
            return True
    return False


def fmt_pct(v):
    return "∞" if not np.isfinite(v) else "%.1f %%" % (100 * v)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    data, articles = pairs()
    existing = json.loads(BIN_FILE.read_text())
    have_nrtl = {(p["i"], p["j"]) for p in existing["pairs"] if p["model"] == "NRTL"}
    have_nrtl |= {(j, i) for i, j in have_nrtl}
    lines = ["# NRTL fits to measured solid solubilities", "",
             "Generated by `validation/python/fit_sle.py`. NRTL with τ = b/T and α = 0.3 for each solid + solvent pair, fitted "
             "to the measured solubilities of the NIST TRC ThermoML Archive (`validation/data/sle/`), with the melting data of "
             "`src/data/components.json` and ΔCp of fusion 0. Deviation: |x_calc / x_measured − 1|, x_calc solved as the engine "
             "does. Each article counts once (the median of its deviations); the table gives the median and the largest single "
             "deviation, and the ideal solution (γ = 1) for comparison.", "",
             "Rules: a pair is fitted with at least %d points over at least %g K; a set is written when the median deviation "
             "of its articles is %d %% or less." % (MIN_POINTS, MIN_SPAN_K, round(100 * MAX_MEDIAN)), "",
             "| Solid | Solvent | Points (articles) | T range, K | b_12, b_21 (K) | Median deviation | Largest | Left-out articles, median | Ideal solution, median | Result |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    written = []
    for (solid, solvent), arts in sorted(data.items()):
        Ts = [t for v in arts.values() for t, _ in v]
        n, span = len(Ts), max(Ts) - min(Ts)
        name = "| %s | %s | %d (%d) | %.1f-%.1f |" % (COMPONENTS[solid]["name"], COMPONENTS[solvent]["name"], n, len(arts), min(Ts), max(Ts))
        if (solid, solvent) in have_nrtl:
            lines.append(name + " | | | | | already has NRTL parameters (not replaced) |")
            continue
        if n < MIN_POINTS or span < MIN_SPAN_K:
            ideal = statistics.median([statistics.median([abs(np.exp(rhs(COMPONENTS[solid]["fusion"]["Tm_K"], COMPONENTS[solid]["fusion"]["Hfus_J_mol"], t)) / x - 1) for t, x in v]) for v in arts.values()])
            lines.append(name + " | | | | | %s | too few data (%d points, %.1f K): not fitted |" % (fmt_pct(ideal), n, span))
            print("%-14s %-20s %3d points %5.1f K  not fitted (too few data)" % (solid, solvent, n, span))
            continue
        b, per, ideal = fit(solid, solvent, arts)
        Tvalid = max(Ts)
        end = branch_end(solid, solvent, b, min(Ts), max(Ts)) if solvent in SPLITS_ALLOWED else None
        if end is not None:
            # the deviations inside the valid range (below the model's monotectic)
            Tvalid = round(end - 0.5, 2)
            per = {doi: [d for (t, _), d in zip(arts[doi], v) if t <= Tvalid] for doi, v in per.items()}
            per = {k: v for k, v in per.items() if v}
        med = statistics.median([statistics.median(v) for v in per.values()])
        mx = max(max(v) for v in per.values())
        imed = statistics.median([statistics.median(v) for v in ideal.values()])
        split = splits(solid, solvent, b, min(Ts), max(Ts))
        loo = held_out(solid, solvent, arts)
        ok = med <= MAX_MEDIAN and (not split or solvent in SPLITS_ALLOWED)
        why = ("written" + (" (two liquids at some compositions, as with water)" if split else "")
               + (", valid to %.1f K (model monotectic)" % Tvalid if end is not None else "") if ok
               else "not written (median above %d %%)" % round(100 * MAX_MEDIAN) if med > MAX_MEDIAN
               else "not written (splits the liquid of a miscible pair)")
        lines.append(name + " %.0f, %.0f | %s | %s | %s | %s | %s |" % (b[0], b[1], fmt_pct(med), fmt_pct(mx),
                                                                     fmt_pct(loo) if loo is not None else "–", fmt_pct(imed), why))
        print("%-14s %-20s %3d points %5.1f K  b = %8.1f %8.1f  median %6.1f %%  max %7.1f %%  left out %s  ideal %8.1f %%  %s" % (
            solid, solvent, n, span, b[0], b[1], 100 * med, 100 * mx, fmt_pct(loo) if loo is not None else "-", 100 * imed, why))
        if ok:
            refs = []
            for doi in arts:
                c = articles[solid].get(doi, {})
                refs.append("%s, %s %s (%s), doi:%s" % ((c.get("authors") or ["?"])[0].split(",")[0], c.get("journal", ""), c.get("volume", ""), c.get("year", ""), doi))
            written.append({
                "model": "NRTL", "i": solid, "j": solvent, "set": SET, "default": True,
                "a_ij": 0.0, "a_ji": 0.0, "b_ij": round(float(b[0]), 4), "b_ji": round(float(b[1]), 4), "alpha": ALPHA,
                "source": ("Fitted to %d measured solubilities of solid %s in %s, %.1f-%.1f K, from %d article%s (data public in the NIST TRC "
                           "ThermoML Archive; validation/data/sle/%s.json): %s. Pure-solid equilibrium with the melting data of the databank "
                           "and dCp of fusion 0 (validation/python/fit_sle.py, docs/SLE_FITS.md). Solubility deviation: median of the "
                           "articles %.1f %%, largest %.1f %%%s (ideal solution: %.1f %%). From solid-liquid data only: not checked against "
                           "vapour-liquid data; outside %.1f-%.1f K the parameters are extrapolated.%s") % (
                    n, COMPONENTS[solid]["name"].lower(), COMPONENTS[solvent]["name"].lower(), min(Ts), max(Ts), len(arts),
                    "s" if len(arts) > 1 else "", solid, "; ".join(refs), 100 * med, 100 * mx,
                    "; refitted without each article in turn, the left-out articles deviate by %.1f %% (median)" % (100 * loo) if loo is not None else "",
                    100 * imed, min(Ts), Tvalid,
                    (" Above %.1f K the model has the solid melt into a second, %s-rich liquid (a monotectic) before the measured "
                     "solubilities do, so the set is valid to %.1f K; the deviations are those below it." % (end, COMPONENTS[solid]["name"].lower(), Tvalid))
                    if end is not None else ""),
                "tier": "fitted", "T_range_K": [round(min(Ts), 2), round(max(Ts), 2)], "valid": {"T_K": [round(min(Ts), 2), round(Tvalid, 2)]},
            })
    lines += ["", "%d sets written." % len(written), ""]
    if a.write:
        existing["pairs"] = [p for p in existing["pairs"] if p.get("set") != SET] + written
        BIN_FILE.write_text(json.dumps(existing, indent=2) + "\n")
        DOC.write_text("\n".join(lines))
        print("written %d sets to %s and %s" % (len(written), BIN_FILE.relative_to(ROOT), DOC.relative_to(ROOT)))
    else:
        print("%d sets would be written" % len(written))


if __name__ == "__main__":
    main()
