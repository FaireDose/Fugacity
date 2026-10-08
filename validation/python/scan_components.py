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
    python validation/python/scan_components.py --set green --webbook --chemsep path/chemsep1.xml path/chemsep2.xml

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
# Proposal 0009 (green and bio-based chemistry), by platform of the map that came with the request; names only (CAS
# from `chemicals`). Not recognized by `chemicals` by name, left for their batch: xylose, erythritol, cis,cis-muconic
# acid, levoglucosenone, glycerol carbonate, 5-ethoxymethylfurfural.
GREEN = {
    "C5 keto-acid platform": ["levulinic acid", "methyl levulinate", "ethyl levulinate", "butyl levulinate",
                              "gamma-valerolactone", "diphenolic acid", "angelica lactone"],
    "C6 furan platform": ["5-hydroxymethylfurfural", "2,5-furandicarboxylic acid", "2,5-bis(hydroxymethyl)furan",
                          "dimethyl 2,5-furandicarboxylate"],
    "Sugars and sugar alcohols": ["D-glucose", "D-fructose", "D-sorbitol", "xylitol", "isosorbide"],
    "Hydroxy acids and diacids": ["L-lactic acid", "lactide", "3-hydroxypropionic acid", "succinic acid",
                                  "itaconic acid", "adipic acid", "glucaric acid", "glycolic acid", "fumaric acid",
                                  "maleic anhydride", "malic acid", "citric acid"],
    "Diols and lactones": ["1,4-butanediol", "1,3-propanediol", "gamma-butyrolactone", "2,3-butanediol"],
    "C5 furan platform": ["furfuryl alcohol", "2-methylfuran", "furan", "tetrahydrofurfuryl alcohol",
                          "2-methyltetrahydrofuran"],
    "Cellulose to solvents": ["dihydrolevoglucosenone", "levoglucosan"],
    "Lipid platform": ["methyl laurate", "methyl myristate", "methyl palmitate", "methyl stearate", "methyl oleate",
                       "methyl linoleate", "triolein", "tripalmitin", "oleic acid", "palmitic acid", "stearic acid",
                       "n-hexadecane", "n-octadecane"],
    "Recycled polyester": ["terephthalic acid", "bis(2-hydroxyethyl) terephthalate", "dimethyl terephthalate"],
    "Green solvents": ["ethyl lactate", "methyl lactate", "dimethyl carbonate", "diethyl carbonate",
                       "ethylene carbonate", "propylene carbonate", "solketal", "cyclopentyl methyl ether",
                       "limonene", "p-cymene", "isoamyl alcohol"],
    "C2 side products and higher alcohols": ["acetaldehyde", "1-pentanol", "1-hexanol", "1-octanol",
                                             "diethylene glycol"],
}
SETS = {"0008": CANDIDATES, "green": GREEN}
# NIST WebBook: the kinds of data a compound's pages show (phase change, Mask=4; gas-phase thermochemistry, Mask=1).
# Markers only, no values: the values are read in the batch that adds the compound.
WEBBOOK_URL = "https://webbook.nist.gov/cgi/cbook.cgi?ID=C{cas}&Units=SI&Mask={mask}"
WEBBOOK_MARKS = [("Antoine Equation Parameters", "Antoine"), ("T<sub>boil</sub>", "Tboil"), ("T<sub>c</sub>", "Tc"),
                 ("P<sub>c</sub>", "Pc"), ("T<sub>fus</sub>", "Tfus"), ("C<sub>p,gas</sub>", "Cp gas"),
                 ("f</sub>H&deg;<sub>gas", "ΔfH°gas")]


def webbook_marks(cas):
    """Which kinds of data the WebBook pages of a compound show (curl, as the WebBook refuses some clients)."""
    import subprocess
    import time
    found, missing = [], 0
    for mask in (4, 1):
        t = subprocess.run(["curl", "-sL", "--max-time", "40", WEBBOOK_URL.format(cas=cas.replace("-", ""), mask=mask)],
                           capture_output=True, text=True).stdout
        if "Registry Number Not Found" in t:
            missing += 1
        found += [label for mark, label in WEBBOOK_MARKS if mark in t and label not in found]
        time.sleep(1)
    return "not a WebBook compound" if missing == 2 else (", ".join(found) or "nothing")


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


def scan(chemsep_paths, candidates=None, webbook=False):
    import CoolProp
    import CoolProp.CoolProp as CP
    from chemicals.identifiers import search_chemical
    if CoolProp.__version__ != "8.0.0":
        raise SystemExit("CoolProp 8.0.0 is required (found %s)" % CoolProp.__version__)
    coolprop = {CP.get_fluid_param_string(f, "CAS"): f for f in CP.get_global_param_string("FluidsList").split(",")}
    cs = chemsep_index(chemsep_paths)
    rows = []
    for area, names in (candidates or CANDIDATES).items():
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
            if webbook and not (row["coolprop"] or row["chemsep"]):
                row["webbook"] = webbook_marks(meta.CASs)
            rows.append(row)
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--chemsep", nargs="+", required=True, help="chemsep1.xml and chemsep2.xml from DWSIM")
    ap.add_argument("--markdown", action="store_true")
    ap.add_argument("--set", choices=sorted(SETS), default="0008", help="candidate list: proposal 0008 or 0009 (green)")
    ap.add_argument("--webbook", action="store_true", help="for candidates in neither databank, the kinds of data on "
                                                          "their NIST WebBook pages")
    args = ap.parse_args()
    rows = scan(args.chemsep, SETS[args.set], args.webbook)
    if args.markdown:
        print("| Component | CAS | Formula | At 25 °C | CoolProp 8.0.0 | ChemSep | Missing in ChemSep | NIST WebBook pages show |")
        print("|---|---|---|---|---|---|---|---|")
    for r in rows:
        missing = "—" if not r["chemsep"] else (", ".join(r["missing"]) or "nothing")
        if args.markdown:
            print("| %s | %s | %s | %s | %s | %s | %s | %s |" % (
                r["name"], r["cas"], r["formula"], r.get("phase", "?"), r["coolprop"] or "—",
                r["chemsep"] or "**not found**", missing, r.get("webbook", "")))
        else:
            print("%-24s %-10s %-9s %-7s CoolProp %-16s ChemSep %-13s missing: %s%s" % (
                r["name"], r["cas"], r["formula"], r.get("phase", "?"), r["coolprop"], r["chemsep"], missing,
                "  WebBook: " + r["webbook"] if "webbook" in r else ""))
    found = sum(1 for r in rows if r["coolprop"] or r["chemsep"])
    print("\n%d candidates; %d in CoolProp; %d in ChemSep; %d in neither" % (
        len(rows), sum(1 for r in rows if r["coolprop"]), sum(1 for r in rows if r["chemsep"]), len(rows) - found))


if __name__ == "__main__":
    main()
