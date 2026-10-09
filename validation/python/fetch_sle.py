"""Measured solubilities of solids in liquids (solid-liquid equilibrium) from the NIST TRC ThermoML Archive, for the
checks of src/equilibrium/sle.js (proposal 0007, step 4; test/sle.test.js, docs/SLE_CHECKS.md).

For each solid in SOLIDS, the archive is searched by name (ThermoML-API full text, as in measured_components.py), every
record found is opened, and the binary data sets with a liquid and a crystal phase are kept when the other component is
a CHEPTA component (matched by InChI) and the solid is the one that crystallizes: the solvent is liquid at every
temperature of the set (above its own melting temperature in src/data/components.json). Kept quantities, as stored:

  - "Mole fraction" of the solute in the liquid, against temperature;
  - "Mass fraction" of the solute, or "Mass ratio of solute to solvent" (converted to mole fraction with the molar
    masses of src/data/components.json; the conversion is exact);
  - "Solid-liquid equilibrium temperature, K" against the mole fraction of either component;

at 110 kPa or less (or no stated pressure). Molar concentrations are left out (they need the solution density).
Values are stored as mole fractions of the solute with the article of each, in validation/data/sle/<solid>.json.

    python validation/python/fetch_sle.py --cache DIR
"""
import argparse
import datetime
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import thermoml_read  # noqa: E402
from measured_components import get, norm_inchi, thermoml_search  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
COMP_FILE = ROOT / "src" / "data" / "components.json"
OUT_DIR = ROOT / "validation" / "data" / "sle"
SOLIDS = {  # id: names searched in the archive
    "naphthalene": ["naphthalene"],
    "benzoic-acid": ["benzoic acid"],
    "salicylic-acid": ["2-hydroxybenzoic acid", "salicylic acid"],
}
P_MAX_KPA = 110.0


def inchi_index(comps):
    from chemicals.identifiers import search_chemical
    out = {}
    for cid, c in comps.items():
        try:
            out[norm_inchi(search_chemical(c["cas"]).InChI)] = cid
        except Exception:
            pass
    return out


def fetch(solid, comps, by_inchi, cache):
    me = next(k for k, v in by_inchi.items() if v == solid)
    dois = sorted({h["content"]["Citation"]["sDOI"] for q in SOLIDS[solid] for h in thermoml_search(q)})
    cache.mkdir(parents=True, exist_ok=True)
    sets, articles = [], {}
    for doi in dois:
        f = cache / (doi.replace("/", "_") + ".xml")
        if not f.exists():
            f.write_bytes(get("https://trc.nist.gov/ThermoML/%s.xml" % doi))
        rec = thermoml_read.parse(f.read_bytes())
        ids = {n: by_inchi.get(norm_inchi(c["inchi"])) for n, c in rec["compounds"].items()}
        mine = [n for n, cid in ids.items() if cid == solid]
        if not mine:
            continue
        s_key = mine[0]
        for s in rec["sets"]:
            if len(s["components"]) != 2 or s_key not in s["components"] or set(s["phases"]) != {"Liquid", "Crystal"}:
                continue
            other = next(c for c in s["components"] if c != s_key)
            solvent = ids.get(other)
            if solvent is None:
                continue
            P = next((c["value"] for c in s["constraints"] if c["type"] and c["type"].startswith("Pressure")), None)
            if P is not None and P > P_MAX_KPA:
                continue
            Ms, Mv = comps[solid]["MW"], comps[solvent]["MW"]
            rows = []
            for pn, p in s["properties"].items():
                for vn, v in s["variables"].items():
                    for r in s["rows"]:
                        if "p" + pn not in r or "v" + vn not in r:
                            continue
                        val, var = r["p" + pn], r["v" + vn]
                        T = x = None
                        if v["type"].startswith("Temperature") and p["name"] == "Mole fraction":
                            T, x = var, val if p["compound"] == s_key else 1 - val
                        elif v["type"].startswith("Temperature") and p["name"] == "Mass fraction":
                            w = val if p["compound"] == s_key else 1 - val
                            T, x = var, (w / Ms) / (w / Ms + (1 - w) / Mv)
                        elif v["type"].startswith("Temperature") and p["name"] == "Mass ratio of solute to solvent":
                            T, x = var, (val / Ms) / (val / Ms + 1 / Mv)
                        elif p["name"].startswith("Solid-liquid equilibrium temperature") and v["type"] == "Mole fraction":
                            T, x = val, var if v["compound"] == s_key else 1 - var
                        if T is None or not (0 < x < 1):
                            continue
                        rows.append({"T_K": T, "x_solute": x, "quantity": p["name"] if "temperature" not in p["name"]
                                     else "Solid-liquid equilibrium temperature against mole fraction"})
            if not rows:
                continue
            Tm_solvent = (comps[solvent].get("fusion") or {}).get("Tm_K")
            if Tm_solvent and min(r["T_K"] for r in rows) <= Tm_solvent:
                continue  # the solvent could be the solid that crystallizes: left out
            sets.append({"solvent": solvent, "doi": doi, "set": s["number"], "P_kPa": P, "rows": rows})
            c = rec["citation"]
            articles[doi] = {"authors": c["authors"], "title": c["title"], "journal": c["journal"], "volume": c["volume"],
                             "year": c["year"], "pages": c["pages"]}
    out = {"solid": solid, "archive": "NIST TRC ThermoML Archive, https://trc.nist.gov/ThermoML/",
           "retrieved": datetime.date.today().isoformat(),
           "searched": "ThermoML-API full-text search for %s; %d records opened" % (
               ", ".join('"%s"' % q for q in SOLIDS[solid]), len(dois)),
           "about": "Solubility of the solid as the mole fraction of the solid in the saturated liquid (x_solute), "
                    "converted from the stored quantity where needed (validation/python/fetch_sle.py); binary sets with "
                    "a CHEPTA component as the solvent, at 110 kPa or less.",
           "articles": dict(sorted(articles.items())), "sets": sets}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / ("%s.json" % solid)).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    by = {}
    for s in sets:
        by.setdefault(s["solvent"], 0)
        by[s["solvent"]] += len(s["rows"])
    print("%s: %d records opened, %d sets from %d articles: %s" % (solid, len(dois), len(sets), len(articles),
                                                                ", ".join("%s %d" % kv for kv in sorted(by.items()))))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", type=Path, required=True, help="directory for the downloaded ThermoML records")
    ap.add_argument("solids", nargs="*", help="default: all of SOLIDS")
    a = ap.parse_args()
    comps = json.loads(COMP_FILE.read_text())["components"]
    by_inchi = inchi_index(comps)
    for solid in a.solids or SOLIDS:
        fetch(solid, comps, by_inchi, a.cache)


if __name__ == "__main__":
    main()
