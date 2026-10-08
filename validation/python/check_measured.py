"""Measured data for components whose records come from a databank or an equation of state (proposal 0008,
Part B): every pure-component value of the NIST TRC ThermoML Archive (2003-2019; NIST open data, also
where the article is paywalled), and the pure end points of binary data sets, for comparison with the
records. The values are not fitted here: test/measured-checks.test.js compares the records in
src/data/components.json with them.

    python validation/python/check_measured.py --fetch --cache DIR   # download (records cached in DIR)
    python validation/python/check_measured.py --report               # write docs/MEASURED_CHECKS.md

--fetch stores validation/data/pure/measured/thermoml_<id>.json (the same format as
measured_components.py: one row per measured value, with the article of every value).

The comparison (same rules in test/measured-checks.test.js): liquid values at 110 kPa or less,
inside the temperature range of the record, and with a stated uncertainty no larger than the
tolerance; the tolerances are those of the engineering report in proposal 0002 (vapour pressure 1 %,
liquid density 1 %, heat capacity 2 %, heat of vaporization 2 %, viscosity 5 %, thermal conductivity
5 %; surface tension has none, so it is reported only). Each article counts once (the median of its
deviations), so that neither an article with many values nor one wrong value decides; the median of
the articles' deviations is compared with the tolerance: ✅ within it, ⚠️ above it (as in the
engineering report: a warning for the reviewer), ❌ above three times it with at least three articles
(the test fails; with fewer, the median cannot single out a discordant article). The largest
single deviation is reported with its article, so that a reader can see which data sets disagree.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
from fit_properties import ev  # noqa: E402
from measured_components import THERMOML_PROPS, fetch_thermoml  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
COMP_FILE = ROOT / "src" / "data" / "components.json"
MEASURED_DIR = ROOT / "validation" / "data" / "pure" / "measured"
DOC_FILE = ROOT / "docs" / "MEASURED_CHECKS.md"
# proposal 0002, "Engineering basis": tolerances of the engineering report
TOLERANCE = {"vapourPressure": 0.01, "liquidDensity": 0.01, "liquidHeatCapacity": 0.02, "heatOfVaporization": 0.02,
             "liquidViscosity": 0.05, "liquidThermalConductivity": 0.05, "surfaceTension": None}
LABEL = {"vapourPressure": "Vapour pressure", "liquidDensity": "Liquid density", "liquidHeatCapacity": "Liquid heat capacity",
         "heatOfVaporization": "Heat of vaporization", "liquidViscosity": "Liquid viscosity",
         "liquidThermalConductivity": "Liquid thermal conductivity", "surfaceTension": "Surface tension"}

# known issues: records above the tolerance that stay as they are for now, with the reason (also shown in the
# engineering report: validation/report/make_measured_cases.py reads this)
KNOWN = {
    ("mesitylene", "liquidViscosity"):
        "the ChemSep v8.3 viscosity is 10-20 % above all six articles (278-350 K); a refit to them would cover only "
        "278-350 K instead of 228-550 K, so the record stays for now (proposal 0008, batch 3)",
}

# the components checked, and the names searched in the archive (its full-text search finds the compound
# names of the records; the compound itself is then matched by its InChI)
CHECKED = {
    # proposal 0008, Part B, batch 1: extraction solvents
    "dichloroethane": ["1,2-dichloroethane"],
    "mibk": ["4-methyl-2-pentanone", "methyl isobutyl ketone"],
    "cyclohexanone": ["cyclohexanone"],
    "dmf": ["N,N-dimethylformamide"],
    "dmso": ["dimethyl sulfoxide"],
    "nmp": ["1-methyl-2-pyrrolidinone", "N-methyl-2-pyrrolidone"],
    "sulfolane": ["sulfolane"],
    "furfural": ["furfural", "2-furaldehyde"],
    "dioxane": ["1,4-dioxane"],
    "isobutanol": ["2-methyl-1-propanol", "isobutanol"],
    "2-butanol": ["2-butanol", "butan-2-ol"],
    # proposal 0004 and v0.1: the components whose records come from ChemSep, all of them or the transport
    # properties CoolProp does not model (the CoolProp records are reference equations of state)
    "acetic-acid": ["acetic acid"],
    "ethylene-glycol": ["ethane-1,2-diol", "ethylene glycol"],
    "chloroform": ["trichloromethane", "chloroform"],
    "ethyl-acetate": ["ethyl acetate"],
    "styrene": ["ethenylbenzene", "styrene"],
    "1-propanol": ["propan-1-ol", "1-propanol"],
    "2-propanol": ["propan-2-ol", "2-propanol"],
    "1-butanol": ["butan-1-ol", "1-butanol"],
    "2-butanone": ["butan-2-one", "2-butanone"],
    "methyl-acetate": ["methyl acetate"],
    "n-butyl-acetate": ["butyl acetate"],
    "acetonitrile": ["acetonitrile"],
    "mtbe": ["2-methoxy-2-methylpropane", "methyl tert-butyl ether"],
    "glycerol": ["propane-1,2,3-triol", "glycerol"],
    "phenol": ["phenol"],
    "acetone": ["acetone", "propan-2-one"],
    "ethylene": ["ethene", "ethylene"],
    "carbon-monoxide": ["carbon monoxide"],
    "hydrogen-sulfide": ["hydrogen sulfide"],
    "dimethyl-ether": ["methoxymethane", "dimethyl ether"],
    "cyclohexane": ["cyclohexane"],
    "diethyl-ether": ["ethoxyethane", "diethyl ether"],
    "propylene-glycol": ["propane-1,2-diol", "propylene glycol"],
    "tetrahydrofuran": ["oxolane", "tetrahydrofuran"],
    # proposal 0008, Part B, batch 2: gas treating, acids, esters and reaction work
    "mea": ["2-aminoethanol", "monoethanolamine", "ethanolamine"],
    "dea": ["diethanolamine", "2,2'-iminodiethanol"],
    "mdea": ["N-methyldiethanolamine", "methyldiethanolamine"],
    "sulfur-dioxide": ["sulfur dioxide"],
    "nitrous-oxide": ["nitrous oxide", "dinitrogen monoxide"],
    "formic-acid": ["formic acid", "methanoic acid"],
    "propionic-acid": ["propanoic acid", "propionic acid"],
    "acrylic-acid": ["acrylic acid", "prop-2-enoic acid"],
    "vinyl-acetate": ["vinyl acetate", "ethenyl acetate"],
    "isopropyl-acetate": ["isopropyl acetate", "propan-2-yl acetate"],
    "ethylene-oxide": ["oxirane", "ethylene oxide"],
    "propylene-oxide": ["methyloxirane", "propylene oxide"],
    "formaldehyde": ["formaldehyde", "methanal"],
    "hydrogen-peroxide": ["hydrogen peroxide"],
    # proposal 0008, Part B, batch 3: petrochemicals and fuels, nitrogen compounds
    "cumene": ["(1-methylethyl)benzene", "isopropylbenzene", "cumene"],
    "mesitylene": ["1,3,5-trimethylbenzene", "mesitylene"],
    "n-nonane": ["nonane"],
    "n-decane": ["decane"],
    "n-dodecane": ["dodecane"],
    "isooctane": ["2,2,4-trimethylpentane", "isooctane"],
    "1-butene": ["1-butene", "but-1-ene"],
    "isoprene": ["2-methyl-1,3-butadiene", "isoprene"],
    "etbe": ["2-ethoxy-2-methylpropane", "ethyl tert-butyl ether"],
    "pyridine": ["pyridine"],
    "aniline": ["aniline", "benzenamine"],
    "acrylonitrile": ["2-propenenitrile", "acrylonitrile"],
    "methylamine": ["methanamine", "methylamine"],
    # proposal 0008, Part B, batch 5: the Cavett problem's missing components
    "isopentane": ["2-methylbutane", "isopentane"],
    "n-undecane": ["undecane"],
    # proposal 0008, Part B, batch 4: solids at 25 degC (liquid records from the melting point up)
    "naphthalene": ["naphthalene"],
    "benzoic-acid": ["benzoic acid", "benzenecarboxylic acid"],
    "salicylic-acid": ["2-hydroxybenzoic acid", "salicylic acid"],
}


def record_of(c, prop):
    if prop == "vapourPressure":
        v = c["vapourPressure"]
        return {"equation": v["equation"], "coefficients": {k: v[k] for k in "ABCDE"}, "Tmin_K": v["Tmin_K"],
                "Tmax_K": v["Tmax_K"]}
    r = c["properties"].get(prop)
    return None if not r or r.get("available") is False else r


def measured(rows, prop):
    """(T, value in record units, relative uncertainty or None, doi) of the values the comparison uses."""
    out, seen = [], set()
    for r in rows:
        spec = THERMOML_PROPS.get(r["property"])
        if not spec or spec[0] != prop or r["T_K"] is None or "Liquid" not in r["phases"] or "Crystal" in r["phases"]:
            continue
        if prop not in ("vapourPressure", "heatOfVaporization") and ("Gas" in r["phases"] or (r["P_kPa"] or 0) > 110):
            continue
        if not r["value"] > 0:  # a value stored as 0 (a pressure below the article's resolution): not comparable
            continue
        key = (r["doi"], r["T_K"], r["value"])
        if key in seen:
            continue
        seen.add(key)
        u = r["uncertainty"] / r["value"] if r["uncertainty"] else None
        out.append((r["T_K"], r["value"] * spec[1], u, r["doi"]))
    return out


def compare(cid, comp, data, prop):
    rec = record_of(comp, prop)
    tol = TOLERANCE[prop]
    vals = measured(data["rows"], prop)
    if rec is None:
        return {"status": "no record", "n_all": len(vals)}
    inside = [v for v in vals if rec["Tmin_K"] - 1e-6 <= v[0] <= rec["Tmax_K"] + 1e-6]
    used = [v for v in inside if v[2] is None or tol is None or v[2] <= tol]
    if len(used) < 3 or len({v[3] for v in used}) < 1:
        return {"status": "too few values", "n_all": len(vals), "n": len(used)}
    T = np.array([v[0] for v in used])
    y = np.array([v[1] for v in used])
    d = ev(rec["equation"], rec["coefficients"], T, rec.get("Tc_K")) / y - 1
    # one number per article (the median of its deviations), so that an article with many values, or a single
    # wrong value, does not decide the result; then the median over the articles
    per = {}
    for v, dd in zip(used, d):
        per.setdefault(v[3], []).append(dd)
    art = np.array([np.median(x) for x in per.values()])
    med = float(np.median(np.abs(art)))
    within = int(np.sum(np.abs(art) <= tol)) if tol else None
    k = int(np.argmax(np.abs(d)))
    a = data["articles"][used[k][3]]
    # with fewer than three articles the median cannot single out a discordant article: a warning, not a failure
    status = "reported" if tol is None else ("pass" if med <= tol else ("warn" if med <= 3 * tol or len(per) < 3 else "FAIL"))
    return {"status": status, "n_all": len(vals), "n": len(used), "articles": len(per), "within": within,
            "T": [float(T.min()), float(T.max())], "median": med, "max": float(d[k]), "max_T": float(T[k]),
            "max_ref": "%s %s, doi:%s" % (a["authors"][0].split(",")[0], a["year"], used[k][3]), "tol": tol}


def fitted_here(comp, prop):
    """True for a record fitted to the ThermoML values themselves (MEASURED_REFIT of fit_properties.py): for it the
    comparison confirms the fit and is not an independent check."""
    if prop == "vapourPressure":
        return "NIST TRC ThermoML Archive" in comp["vapourPressure"]["source"]
    r = comp["properties"].get(prop) or {}
    return isinstance(r.get("source"), dict) and r["source"].get("name", "").startswith("Measured values (NIST TRC ThermoML")


def report():
    comps = json.loads(COMP_FILE.read_text())["components"]
    L = ["# Records against measured data", "",
         "Generated by `validation/python/check_measured.py --report`. Every record of the components below comes "
         "from a databank (ChemSep) or an equation of state (CoolProp); here it is compared with the pure-component "
         "values of the NIST TRC ThermoML Archive (2003-2019), stored in "
         "`validation/data/pure/measured/thermoml_<id>.json`. `test/measured-checks.test.js` checks the same.", "",
         "Rules: liquid values at 110 kPa or less, inside the record's temperature range, with a stated uncertainty no "
         "larger than the tolerance. Tolerances of the engineering report (proposal 0002): vapour pressure 1 %, liquid "
         "density 1 %, heat capacity 2 %, heat of vaporization 2 %, viscosity 5 %, thermal conductivity 5 %; surface "
         "tension has none and is reported only. Each article counts once (the median of its deviations); the median "
         "of the articles is compared with the tolerance: ✅ within it, ⚠️ above it (a warning, as in the engineering "
         "report), ❌ above three times it with at least three articles (the test fails; with fewer articles the median "
         "cannot single out a discordant one, so it stays a warning). The largest single deviation and its article show which "
         "data sets disagree. For a record fitted to these values (marked) the comparison only confirms the fit.", ""]
    fails = []
    for cid in CHECKED:
        f = MEASURED_DIR / ("thermoml_%s.json" % cid)
        if not f.exists():
            continue
        data = json.loads(f.read_text())
        L += ["## %s" % comps[cid]["name"], "", "| Property | Values used | Articles (within tolerance) | Range (K) | "
              "Median deviation of the articles | Largest single deviation | Result |", "|---|---|---|---|---|---|---|"]
        for prop in TOLERANCE:
            r = compare(cid, comps[cid], data, prop)
            if r["status"] in ("no record", "too few values"):
                if r["n_all"]:
                    L.append("| %s | %d | | | | | %s (%d measured in all) |" % (LABEL[prop], r.get("n", 0), r["status"], r["n_all"]))
                continue
            L.append("| %s | %d | %s | %.1f-%.1f | %.2f %% | %+.2f %% at %.1f K (%s) | %s |" % (
                LABEL[prop], r["n"], "%d" % r["articles"] if r["within"] is None else "%d (%d)" % (r["articles"], r["within"]),
                r["T"][0], r["T"][1], 100 * r["median"], 100 * r["max"], r["max_T"], r["max_ref"],
                ("reported (no tolerance)" if r["tol"] is None else
                 {"pass": "✅ within %g %%", "warn": "⚠️ above %g %%", "FAIL": "❌ above 3 × %g %%"}[r["status"]] % (100 * r["tol"]))
                + (" (record fitted to these values)" if fitted_here(comps[cid], prop) else "")
                + (" — known issue: " + KNOWN[(cid, prop)] if (cid, prop) in KNOWN and r["status"] != "pass" else "")))
            if r["status"] in ("warn", "FAIL"):
                fails.append((cid, prop, round(100 * r["median"], 2), r["status"]))
        L.append("")
    DOC_FILE.write_text("\n".join(L) + "\n")
    print("written %s; above the tolerance: %s" % (DOC_FILE.relative_to(ROOT), fails or "none"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--cache", type=Path, help="directory for the downloaded ThermoML records (with --fetch)")
    ap.add_argument("ids", nargs="*", help="components (default: all of CHECKED)")
    args = ap.parse_args()
    comps = json.loads(COMP_FILE.read_text())["components"]
    if args.fetch:
        for cid in args.ids or CHECKED:
            fetch_thermoml(cid, args.cache, {"cas": comps[cid]["cas"], "thermoml_queries": CHECKED[cid]})
    if args.report:
        report()


if __name__ == "__main__":
    main()
