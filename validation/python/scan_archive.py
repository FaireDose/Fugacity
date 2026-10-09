"""Every binary vapour-liquid data set of the whole NIST TRC ThermoML Archive for the pairs of CHEPTA's components.

The archive's full-text search (scan_pairs.py) finds records by component name. This reads every record of the
archive's bulk download instead, so nothing depends on the search: ThermoML/Data Archive, NIST, doi
10.18434/mds2-2422, file ThermoML.v2020-09-30.tgz (https://data.nist.gov/od/ds/mds2-2422/ThermoML.v2020-09-30.tgz;
NIST open license; check its SHA-256 against the .sha256 file published next to it).

For every binary data set whose two compounds are CHEPTA components (matched by InChI) and whose phases are a
liquid and a gas, the kind (scan_pairs.classify) and the number of points are recorded, and for the whole archive
the number of distinct compound pairs with such data. Output: validation/data/vle/archive_index.json.

    python validation/python/scan_archive.py ThermoML.v2020-09-30.tgz
"""
import json
import sys
import tarfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import thermoml_read  # noqa: E402
from measured_components import norm_inchi  # noqa: E402
from scan_pairs import classify, key  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
COMPS = json.loads((ROOT / "src" / "data" / "components.json").read_text())["components"]
OUT = ROOT / "validation" / "data" / "vle" / "archive_index.json"


def inchi_index():
    from chemicals.identifiers import search_chemical
    out = {}
    for cid, c in COMPS.items():
        try:
            out[norm_inchi(search_chemical(c["cas"]).InChI)] = cid
        except Exception as e:
            print(f"  {cid}: no InChI ({e})", file=sys.stderr)
    return out


def main(path):
    by_inchi = inchi_index()
    pairs = defaultdict(list)
    all_pairs = set()
    n_files = n_bad = 0
    with tarfile.open(path, "r:gz") as tar:
        for m in tar:
            if not m.isfile() or not m.name.endswith(".xml"):
                continue
            n_files += 1
            try:
                rec = thermoml_read.parse(tar.extractfile(m).read())
            except Exception:
                n_bad += 1
                continue
            inchis = {n: norm_inchi(c["inchi"]) for n, c in rec["compounds"].items()}
            ours = {n: by_inchi.get(i) for n, i in inchis.items()}
            per = defaultdict(list)
            for s in rec["sets"]:
                if len(s["components"]) != 2 or not s["rows"] or set(s["phases"]) != {"Liquid", "Gas"}:
                    continue
                a, b = s["components"]
                if inchis.get(a) and inchis.get(b) and inchis[a] != inchis[b]:
                    all_pairs.add(tuple(sorted((inchis[a], inchis[b]))))
                ca, cb = ours.get(a), ours.get(b)
                if not ca or not cb or ca == cb:
                    continue
                kind = classify(s, rec, ours)
                if kind:
                    per[key(ca, cb)].append({"number": s["number"], "kind": kind, "points": len(s["rows"])})
            c = rec["citation"]
            for p, sets in per.items():
                pairs[p].append({"doi": c["doi"], "year": c["year"], "journal": c["journal"], "file": m.name, "sets": sets})
            if n_files % 2000 == 0:
                print(f"  {n_files} records, {len(pairs)} CHEPTA pairs so far", file=sys.stderr)
    OUT.write_text(json.dumps({
        "_about": "Binary liquid-gas data sets of the whole NIST TRC ThermoML Archive (bulk file ThermoML.v2020-09-30.tgz, "
                  "doi 10.18434/mds2-2422, NIST open license) for pairs of CHEPTA components, by validation/python/scan_archive.py.",
        "records_read": n_files, "records_unreadable": n_bad,
        "archive_binary_vle_compound_pairs": len(all_pairs),
        "pairs": {f"{a}+{b}": v for (a, b), v in sorted(pairs.items())},
    }, indent=1) + "\n")
    print(f"{n_files} records ({n_bad} unreadable); {len(all_pairs)} compound pairs with binary liquid-gas data in the archive; "
          f"{len(pairs)} of them are CHEPTA pairs. Wrote {OUT.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
