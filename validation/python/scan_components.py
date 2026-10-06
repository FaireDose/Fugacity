"""Proposal 0008, Part B: scan the candidate components against the open sources, before adding them.

For each candidate it finds the CAS number and formula (open `chemicals` library, MIT), and then
which open source of AGENTS.md rule 1 has it:
  - CoolProp 8.0.0 (MIT): a reference equation of state, matched by CAS;
  - the ChemSep pure-component databases (Artistic License 2.0) as redistributed in DWSIM
    (https://github.com/DanWBR/dwsim, DWSIM.Thermodynamics/Assets/Databases): chemsep1.xml (v8.3,
    already used by add_components.py) and chemsep2.xml ("ChemSep v8.31 pure component data 2");
    for these it lists the temperature correlations and constants that fit_properties.py and
    add_components.py need and that the record lacks.
The phase at 25 degC and 1 atm comes from ChemSep's melting and normal boiling points.

    python validation/python/scan_components.py --chemsep path/chemsep1.xml path/chemsep2.xml           # table
    python validation/python/scan_components.py --chemsep path/chemsep1.xml path/chemsep2.xml --markdown

No number is typed in here: names and CAS numbers only; everything else comes from the files and
libraries named above.
"""
import argparse
import xml.etree.ElementTree as ET
from pathlib import Path

# Proposal 0008, Part B, by process area; a CAS is given where the name alone is ambiguous for `chemicals`
CANDIDATES = {
    "Extraction and solvents": ["dichloromethane", "1,2-dichloroethane", "methyl isobutyl ketone", "cyclohexanone",
                                "N,N-dimethylformamide", "dimethyl sulfoxide", ("N-methyl-2-pyrrolidone", "872-50-4"),
                                "sulfolane", "furfural", "2-methoxyethanol", "1,4-dioxane", "isobutanol", "2-butanol"],
    "Gas treating and CO2 capture": ["monoethanolamine", "diethanolamine", "methyldiethanolamine", "sulfur dioxide",
                                     "nitrous oxide"],
    "Acids, esters and reaction work": ["formic acid", "propionic acid", "acrylic acid", "vinyl acetate",
                                        "isopropyl acetate", "ethylene oxide", "propylene oxide", "formaldehyde",
                                        "hydrogen peroxide"],
    "Petrochemicals and fuels": ["cumene", "mesitylene", "n-nonane", "n-decane", "n-dodecane", "isooctane", "1-butene",
                                 "isoprene", "ethyl tert-butyl ether"],
    "Solids": ["naphthalene", "benzoic acid", "salicylic acid", "urea", "phthalic anhydride", "caprolactam"],
    "Nitrogen compounds": ["pyridine", "aniline", "acrylonitrile", "methylamine"],
}
NEEDED = ["CriticalTemperature", "CriticalPressure", "AcentricityFactor", "VaporPressure", "LiquidDensity",
          "IdealGasHeatCapacityCp", "LiquidHeatCapacityCp", "HeatOfVaporization", "LiquidViscosity", "VaporViscosity",
          "LiquidThermalConductivity", "VaporThermalConductivity", "SurfaceTension", "UniquacR", "UniquacQ"]


def chemsep_index(paths):
    index = {}
    for p in paths:
        for c in ET.parse(p).getroot():
            e = c.find("CAS")
            if e is not None and e.get("value") not in index:
                index[e.get("value")] = (Path(p).name, c)
    return index


def scan(chemsep_paths):
    import CoolProp
    import CoolProp.CoolProp as CP
    from chemicals.identifiers import search_chemical
    if CoolProp.__version__ != "8.0.0":
        raise SystemExit("CoolProp 8.0.0 is required (found %s)" % CoolProp.__version__)
    coolprop = {CP.get_fluid_param_string(f, "CAS"): f for f in CP.get_global_param_string("FluidsList").split(",")}
    cs = chemsep_index(chemsep_paths)
    rows = []
    for area, names in CANDIDATES.items():
        for n in names:
            name, cas = n if isinstance(n, tuple) else (n, None)
            meta = search_chemical(cas or name)
            if cas and meta.CASs != cas:
                raise SystemExit("%s: CAS %s does not match chemicals (%s)" % (name, cas, meta.CASs))
            hit = cs.get(meta.CASs)
            row = {"area": area, "name": name, "cas": meta.CASs, "formula": meta.formula,
                   "coolprop": coolprop.get(meta.CASs), "chemsep": hit[0] if hit else None}
            if hit:
                c = hit[1]
                val = lambda t: float(c.find(t).get("value")) if c.find(t) is not None else None  # noqa: E731
                row["missing"] = [t for t in NEEDED if c.find(t) is None]
                row["Tm_K"], row["Tb_K"] = val("NormalMeltingPointTemperature"), val("NormalBoilingPointTemperature")
                row["phase"] = ("solid" if row["Tm_K"] and row["Tm_K"] > 298.15 else
                                "gas" if row["Tb_K"] and row["Tb_K"] < 298.15 else "liquid")
            rows.append(row)
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--chemsep", nargs="+", required=True, help="chemsep1.xml and chemsep2.xml from DWSIM")
    ap.add_argument("--markdown", action="store_true")
    args = ap.parse_args()
    rows = scan(args.chemsep)
    if args.markdown:
        print("| Component | CAS | Formula | At 25 °C | CoolProp 8.0.0 | ChemSep | Missing in ChemSep |")
        print("|---|---|---|---|---|---|---|")
    for r in rows:
        missing = "—" if not r["chemsep"] else (", ".join(r["missing"]) or "nothing")
        if args.markdown:
            print("| %s | %s | %s | %s | %s | %s | %s |" % (
                r["name"], r["cas"], r["formula"], r.get("phase", "?"), r["coolprop"] or "—",
                r["chemsep"] or "**not found**", missing))
        else:
            print("%-24s %-10s %-9s %-7s CoolProp %-16s ChemSep %-13s missing: %s" % (
                r["name"], r["cas"], r["formula"], r.get("phase", "?"), r["coolprop"], r["chemsep"], missing))
    found = sum(1 for r in rows if r["coolprop"] or r["chemsep"])
    print("\n%d candidates; %d in CoolProp; %d in ChemSep; %d in neither" % (
        len(rows), sum(1 for r in rows if r["coolprop"]), sum(1 for r in rows if r["chemsep"]), len(rows) - found))


if __name__ == "__main__":
    main()
