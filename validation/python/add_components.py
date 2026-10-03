"""Proposal 0004, step 2: new components, with their constants from CoolProp.

Adds (or updates) the records of the components in BATCHES to src/data/components.json:
name, formula and CAS (from the open `chemicals` library, MIT), aliases, and the constants
MW, Tc_K, Pc_Pa, Tb_K and omega from CoolProp 8.0.0 (MIT), which implements the reference
equation of state cited in `constants_source` for each fluid. Tb is the saturation temperature
of that equation of state at 101.325 kPa. Values are rounded to 7 significant digits (omega to
6), as for the components added earlier.

The temperature correlations (vapour pressure, densities, heat capacities, transport
properties) are then fitted by validation/python/fit_properties.py, and the sources are linked
by make_sources.py:

    python validation/python/add_components.py --batch 1 --write
    python validation/python/fit_properties.py --chemsep chemsep1.xml --bib CoolPropBibTeXLibrary.bib --write
    python validation/python/make_sources.py

No number is typed in by hand: every value comes from a library run here.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMP_FILE = ROOT / "src" / "data" / "components.json"

# id, name, CoolProp fluid name, aliases (lower case; the name, id and formula are always found)
BATCHES = {
    1: [  # gases at 25 degC and 1 atm, for the methanol, air-separation and light-hydrocarbon benchmarks
        ("carbon-monoxide", "Carbon monoxide", "CarbonMonoxide", ["co"]),
        ("carbon-dioxide", "Carbon dioxide", "CarbonDioxide", ["co2"]),
        ("hydrogen-sulfide", "Hydrogen sulfide", "HydrogenSulfide", ["h2s", "hydrogen sulphide"]),
        ("argon", "Argon", "Argon", ["ar"]),
        ("propane", "Propane", "n-Propane", ["c3h8", "n-propane"]),
        ("propylene", "Propylene", "Propylene", ["propene", "c3h6"]),
        ("n-butane", "n-Butane", "n-Butane", ["butane"]),
        ("isobutane", "Isobutane", "IsoButane", ["2-methylpropane", "i-butane"]),
        ("ammonia", "Ammonia", "Ammonia", ["nh3"]),
        ("dimethyl-ether", "Dimethyl ether", "DimethylEther", ["dme", "methoxymethane"]),
    ],
}


def sig(x, n=7):
    return float("%.*g" % (n, x))


def record(cid, name, fluid, aliases):
    import CoolProp.CoolProp as CP
    from chemicals.identifiers import search_chemical
    cas = CP.get_fluid_param_string(fluid, "CAS")
    meta = search_chemical(cas)
    if meta.CASs != cas:
        raise SystemExit("%s: CoolProp CAS %s does not match chemicals (%s)" % (cid, cas, meta.CASs))
    eos = CP.get_fluid_param_string(fluid, "BibTeX-EOS")
    src = "CoolProp 8.0.0 (%s: equation of state %s); open source, MIT." % (fluid, eos)
    p_triple = CP.PropsSI("ptriple", fluid)
    if p_triple > 101325.0:
        # no liquid at 1 atm (carbon dioxide sublimes): no normal boiling point
        Tb, tb_text = None, (" No normal boiling point: the triple-point pressure (%.4g kPa) is above 101.325 kPa, so "
                             "%s has no liquid at 1 atm (it sublimes); Tb_K is null." % (p_triple / 1000, name.lower()))
    else:
        Tb, tb_text = sig(CP.PropsSI("T", "P", 101325.0, "Q", 0, fluid)), " Tb at 101.325 kPa from the same equation of state."
    return {
        "name": name,
        "formula": meta.formula,
        "cas": cas,
        "aliases": aliases,
        "MW": sig(CP.PropsSI("molar_mass", fluid) * 1000),
        "Tc_K": sig(CP.PropsSI("Tcrit", fluid)),
        "Pc_Pa": sig(CP.PropsSI("pcrit", fluid)),
        "Tb_K": Tb,
        "omega": sig(CP.PropsSI("acentric", fluid), 6),
        "constants_source": src + tb_text + " Formula and CAS: chemicals library (MIT).",
        "constants_source_ids": ["coolprop"],
        "omega_source": src,
        "omega_source_ids": ["coolprop"],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--batch", type=int, required=True, choices=sorted(BATCHES))
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    import CoolProp
    if CoolProp.__version__ != "8.0.0":
        raise SystemExit("CoolProp 8.0.0 is required (found %s)" % CoolProp.__version__)
    data = json.loads(COMP_FILE.read_text())
    comps = data["components"]
    for cid, name, fluid, aliases in BATCHES[args.batch]:
        rec = record(cid, name, fluid, aliases)
        tb = rec["Tb_K"] if rec["Tb_K"] is not None else float("nan")
        old = comps.get(cid, {})
        # keep fitted records (vapourPressure, properties) when the script is run again
        for k in ("vapourPressure", "properties"):
            if k in old:
                rec[k] = old[k]
        comps[cid] = rec
        print("%-17s %-8s %-10s MW %-9g Tc %-9g Pc %-9g Tb %-9g omega %g" % (
            cid, rec["formula"], rec["cas"], rec["MW"], rec["Tc_K"], rec["Pc_Pa"], tb, rec["omega"]))
    if args.write:
        COMP_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print("written:", COMP_FILE.relative_to(ROOT))


if __name__ == "__main__":
    main()
