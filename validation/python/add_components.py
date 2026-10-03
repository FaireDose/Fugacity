"""Proposal 0004, step 2: new components, with their constants from CoolProp.

Adds (or updates) the records of the components in BATCHES to src/data/components.json:
name, formula and CAS (from the open `chemicals` library, MIT), aliases, and the constants
MW, Tc_K, Pc_Pa, Tb_K and omega
  - from CoolProp 8.0.0 (MIT), which implements the reference equation of state cited in
    `constants_source` for each fluid; Tb is the saturation temperature of that equation of
    state at 101.325 kPa;
  - for a component that is not a CoolProp fluid (fluid None in BATCHES), from the ChemSep
    pure-component database v8.3 (Artistic License 2.0), as proposal 0004 says for those 13;
and, for liquids (normal boiling point above 298.15 K), the UNIQUAC r and q from ChemSep, which
the activity-coefficient models need (as for the liquids of v0.1). Values are rounded to 7
significant digits (omega to 6), as for the components added earlier.

The temperature correlations (vapour pressure, densities, heat capacities, transport
properties) are then fitted by validation/python/fit_properties.py, and the sources are linked
by make_sources.py:

    python validation/python/add_components.py --batch 1 --chemsep chemsep1.xml --write
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
    2: [  # hydrocarbon liquids, for the aromatics, ethanol-dehydration and higher-boiler benchmarks
        ("cyclohexane", "Cyclohexane", "Cyclohexane", ["c6h12"]),
        ("o-xylene", "o-Xylene", "o-Xylene", ["1,2-dimethylbenzene", "ortho-xylene"]),
        ("m-xylene", "m-Xylene", "m-Xylene", ["1,3-dimethylbenzene", "meta-xylene"]),
        ("p-xylene", "p-Xylene", "p-Xylene", ["1,4-dimethylbenzene", "para-xylene"]),
        ("ethylbenzene", "Ethylbenzene", "EthylBenzene", ["ethyl benzene", "phenylethane"]),
        ("styrene", "Styrene", None, ["vinylbenzene", "ethenylbenzene", "phenylethylene"]),
        ("n-pentane", "n-Pentane", "n-Pentane", ["pentane"]),
        ("n-hexane", "n-Hexane", "n-Hexane", ["hexane"]),
        ("n-heptane", "n-Heptane", "n-Heptane", ["heptane"]),
        ("n-octane", "n-Octane", "n-Octane", ["octane"]),
    ],
    # dichloromethane is not in this batch: it is neither a CoolProp fluid nor in ChemSep v8.3 (as shipped
    # with DWSIM); its data have to come from measured data (NIST WebBook, ThermoML), a separate step
    3: [  # solvents, alcohols, glycols and phenol, for the solvent-recovery and higher-boiler benchmarks
        ("diethyl-ether", "Diethyl ether", "DiethylEther", ["ether", "ethoxyethane"]),
        ("propylene-glycol", "Propylene glycol", "PropyleneGlycol", ["1,2-propanediol", "propane-1,2-diol"]),
        ("tetrahydrofuran", "Tetrahydrofuran", "Tetrahydrofuran", ["thf", "oxolane"]),
        ("1-propanol", "1-Propanol", None, ["n-propanol", "propan-1-ol", "propyl alcohol"]),
        ("2-propanol", "2-Propanol", None, ["isopropanol", "propan-2-ol", "isopropyl alcohol", "ipa"]),
        ("1-butanol", "1-Butanol", None, ["n-butanol", "butan-1-ol", "butyl alcohol"]),
        ("2-butanone", "2-Butanone", None, ["methyl ethyl ketone", "mek", "butanone"]),
        ("methyl-acetate", "Methyl acetate", None, ["methyl ethanoate"]),
        ("n-butyl-acetate", "n-Butyl acetate", None, ["butyl acetate", "butyl ethanoate"]),
        ("acetonitrile", "Acetonitrile", None, ["methyl cyanide", "mecn"]),
        ("mtbe", "MTBE", None, ["methyl tert-butyl ether", "2-methoxy-2-methylpropane"]),
        ("glycerol", "Glycerol", None, ["glycerine", "propane-1,2,3-triol"]),
        ("phenol", "Phenol", None, ["hydroxybenzene", "carbolic acid"]),
    ],
}
CHEMSEP_NAME = "ChemSep pure-component database v8.3 (Kooijman & Taylor)"
CHEMSEP_CAS = {"styrene": "100-42-5", "1-propanol": "71-23-8", "2-propanol": "67-63-0", "1-butanol": "71-36-3",
               "2-butanone": "78-93-3", "methyl-acetate": "79-20-9", "n-butyl-acetate": "123-86-4",
               "acetonitrile": "75-05-8", "mtbe": "1634-04-4", "glycerol": "56-81-5",
               "phenol": "108-95-2"}   # CAS of the components taken from ChemSep (checked against `chemicals`)


class ChemSep:
    def __init__(self, path):
        import xml.etree.ElementTree as ET
        self.root = ET.parse(path).getroot()

    def compound(self, cas):
        for c in self.root:
            e = c.find("CAS")
            if e is not None and e.get("value") == cas:
                return c
        raise SystemExit("ChemSep has no compound with CAS %s" % cas)

    def value(self, cas, tag):
        e = self.compound(cas).find(tag)
        return None if e is None else float(e.get("value"))


def uniquac_or_none(cs, cas):
    """UNIQUAC r and q from ChemSep, or None when ChemSep does not have the compound or the values."""
    try:
        cs.compound(cas)
    except SystemExit:
        return None
    if cs.value(cas, "UniquacR") is None or cs.value(cas, "UniquacQ") is None:
        return None
    return uniquac(cs, cas)


def uniquac(cs, cas):
    r, q = cs.value(cas, "UniquacR"), cs.value(cas, "UniquacQ")
    if r is None or q is None:
        raise SystemExit("ChemSep has no UNIQUAC r and q for %s" % cas)
    return {"r": r, "q": q, "source": CHEMSEP_NAME + ", UNIQUAC r and q; Artistic License 2.0.",
            "source_ids": ["chemsep-8.3"]}


def record_chemsep(cid, name, aliases, cs):
    from chemicals.identifiers import search_chemical
    cas = CHEMSEP_CAS[cid]
    meta = search_chemical(cas)
    if meta.CASs != cas:
        raise SystemExit("%s: CAS %s does not match chemicals (%s)" % (cid, cas, meta.CASs))
    v = lambda tag: cs.value(cas, tag)  # noqa: E731
    src = (CHEMSEP_NAME + " (MolecularWeight, CriticalTemperature, CriticalPressure, NormalBoilingPointTemperature); "
           "Artistic License 2.0. Not a CoolProp 8.0.0 fluid. Formula and CAS: chemicals library (MIT).")
    return {
        "name": name, "formula": meta.formula, "cas": cas, "aliases": aliases,
        "MW": sig(v("MolecularWeight")), "Tc_K": sig(v("CriticalTemperature")), "Pc_Pa": sig(v("CriticalPressure")),
        "Tb_K": sig(v("NormalBoilingPointTemperature")), "omega": sig(v("AcentricityFactor"), 6),
        "constants_source": src, "constants_source_ids": ["chemsep-8.3"],
        "omega_source": CHEMSEP_NAME + ", AcentricityFactor; Artistic License 2.0.",
        "omega_source_ids": ["chemsep-8.3"],
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
    ap.add_argument("--chemsep", required=True, help="path to ChemSep chemsep1.xml (v8.3)")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    import CoolProp
    if CoolProp.__version__ != "8.0.0":
        raise SystemExit("CoolProp 8.0.0 is required (found %s)" % CoolProp.__version__)
    data = json.loads(COMP_FILE.read_text())
    comps = data["components"]
    cs = ChemSep(args.chemsep)
    for cid, name, fluid, aliases in BATCHES[args.batch]:
        rec = record(cid, name, fluid, aliases) if fluid else record_chemsep(cid, name, aliases, cs)
        if rec["Tb_K"] is not None and rec["Tb_K"] > 298.15:
            # a liquid at 25 degC: UNIQUAC r and q for the activity-coefficient models, after Tb (as in v0.1);
            # where no open source has them, the record says so and the component is for equations of state only
            rq = uniquac_or_none(cs, rec["cas"])
            new = {}
            for k, v in rec.items():
                new[k] = v
                if k == "Tb_K":
                    if rq:
                        new["uniquac"] = rq
                    else:
                        new["uniquac_missing"] = {
                            "searched": [CHEMSEP_NAME + " (compound not included)",
                                         "thermo and chemicals libraries (no UNIQUAC r and q tables)"],
                            "note": "no open data: UNIQUAC r and q could be computed from UNIFAC group volumes and "
                                    "areas, but the licence of those group tables is the open question of roadmap A3; "
                                    "until it is settled the component has no activity-model data."}
            rec = new
        tb = rec["Tb_K"] if rec["Tb_K"] is not None else float("nan")
        old = comps.get(cid, {})
        # keep fitted records (vapourPressure, properties) when the script is run again
        if "vapourPressure" in old:
            new = {}
            for k, v in rec.items():
                new[k] = v
                if k == "Tb_K":
                    new["vapourPressure"] = old["vapourPressure"]
            rec = new
        if "properties" in old:
            rec["properties"] = old["properties"]
        comps[cid] = rec
        print("%-17s %-8s %-10s MW %-9g Tc %-9g Pc %-9g Tb %-9g omega %g" % (
            cid, rec["formula"], rec["cas"], rec["MW"], rec["Tc_K"], rec["Pc_Pa"], tb, rec["omega"]))
    if args.write:
        COMP_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print("written:", COMP_FILE.relative_to(ROOT))


if __name__ == "__main__":
    main()
