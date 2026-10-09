"""Which binary pairs of the activity-model components have open vapour-liquid data, and where.

For every pair of the components that NRTL and UNIQUAC describe (those with UNIQUAC r and q in
src/data/components.json, as docs/DATA_WANTED.md counts them), this lists:

  - the parameter sets Fugacity has (src/data/binaries.json): fitted, databank, none;
  - whether the ChemSep databank (Artistic License 2.0, as shipped with the open-source thermo
    library) has NRTL or UNIQUAC parameters for it;
  - the records of the NIST TRC ThermoML Archive (open data, free to read even where the article is
    not) with binary vapour-liquid data of the pair: each record is opened and its data sets are
    classified (isobaric T-x-y, isothermal P-x-y or P-x, azeotrope, activity coefficient at infinite
    dilution), with the number of points.

    python validation/python/scan_pairs.py --cache DIR            # search, open the records, write
                                                                   # validation/data/vle/index.json and
                                                                   # docs/PAIR_SCAN.md
    python validation/python/scan_pairs.py --cache DIR --report   # docs/PAIR_SCAN.md again from the index
                                                                   # (after fitting; no network)

Stage 1 searches the archive's full-text interface for each component (by name; the hits carry the
compounds of each record by InChI and a summary of its data). Water is not searched: every pair with
water is found through the search for its other component. A record is a candidate for a pair when
both compounds are in it and its summary has binary phase-equilibrium data. Stage 2 opens the
candidates (cached in DIR) and keeps the binary data sets of the pair with a liquid and a gas phase.
"""
import argparse
import concurrent.futures as cf
import datetime
import json
import sys
import warnings
from collections import defaultdict
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import thermoml_read  # noqa: E402
from measured_components import get, norm_inchi, thermoml_search  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
COMPS = json.loads((ROOT / "src" / "data" / "components.json").read_text())["components"]
BINS = json.loads((ROOT / "src" / "data" / "binaries.json").read_text())["pairs"]
INDEX_FILE = ROOT / "validation" / "data" / "vle" / "index.json"
DOC_FILE = ROOT / "docs" / "PAIR_SCAN.md"

ACTIVITY = [cid for cid, c in COMPS.items() if c.get("uniquac")]
NOT_SEARCHED = {"water"}
VLE_SUMMARY = {
    ("VaporPBoilingTAzeotropTandP", None),
    ("CompositionAtPhaseEquilibrium", "Mole fraction"),
    ("CompositionAtPhaseEquilibrium", "Azeotropic composition: mole fraction"),
    ("ActivityFugacityOsmoticProp", "Activity coefficient"),
}
VLE_PHASES = {"Liquid", "Gas"}


def key(a, b):
    return tuple(sorted((a, b)))


def inchi_index():
    from chemicals.identifiers import search_chemical
    out = {}
    for cid in ACTIVITY:
        out[norm_inchi(search_chemical(COMPS[cid]["cas"]).InChI)] = cid
    return out


def has_vle_summary(hit):
    b = hit["content"].get("data_summary", {}).get("binary", {})
    for cat, prop in VLE_SUMMARY:
        v = b.get(cat)
        if isinstance(v, dict) and (prop is None or isinstance(v.get(prop), dict)):
            return True
    return False


def search_all(cache, by_inchi):
    """{pair: set(doi)} of candidate records, from one archive search per component."""
    cache.mkdir(parents=True, exist_ok=True)

    def one(cid):
        f = cache / f"search_{cid}.json"
        if f.exists():
            return cid, json.loads(f.read_text())
        hits = thermoml_search(COMPS[cid]["name"].lower())
        slim = [{"doi": h["content"]["Citation"].get("sDOI"),
                 "inchis": [norm_inchi(c.get("sStandardInChI")) for c in h["content"].get("Compound", [])],
                 "vle": has_vle_summary(h)} for h in hits]
        f.write_text(json.dumps(slim))
        return cid, slim

    cand = defaultdict(set)
    todo = [c for c in ACTIVITY if c not in NOT_SEARCHED]
    with cf.ThreadPoolExecutor(4) as ex:
        for k, (cid, hits) in enumerate(ex.map(one, todo)):
            for h in hits:
                if not h["vle"] or not h["doi"]:
                    continue
                ids = sorted({by_inchi[i] for i in h["inchis"] if i in by_inchi})
                for a in range(len(ids)):
                    for b in range(a + 1, len(ids)):
                        cand[(ids[a], ids[b])].add(h["doi"])
            print(f"  searched {k + 1}/{len(todo)}: {cid} ({len(hits)} records)", file=sys.stderr)
    return cand


def record(cache, doi):
    f = cache / (doi.replace("/", "_") + ".xml")
    if not f.exists():
        f.write_bytes(get("https://trc.nist.gov/ThermoML/%s.xml" % doi))
    return thermoml_read.parse(f.read_bytes())


def classify(s, rec, ids):
    """The kind of a binary liquid-gas data set, or None."""
    props = [p["name"] or "" for p in s["properties"].values()]
    var = [v["type"] or "" for v in s["variables"].values()]
    con = [c["type"] or "" for c in s["constraints"]]
    phases_of = {p["name"]: p["phase"] for p in s["properties"].values()}
    if any(p.startswith("Activity coefficient") for p in props) and not any(p.startswith("Mole fraction") for p in props):
        return "gamma"
    if any("Azeotropic" in p for p in props):
        return "azeotrope"
    gas_x = any(p == "Mole fraction" and "Gas" in (phases_of.get(p) or []) for p in props)
    has_T = any(t.startswith("Temperature") for t in var + con)
    has_P = any(t.startswith("Pressure") for t in var + con) or any(p.startswith("Vapor or sublimation pressure") for p in props)
    fixed_P = any(t.startswith("Pressure") for t in con)
    fixed_T = any(t.startswith("Temperature") for t in con)
    if fixed_P and (gas_x or any(p.startswith("Boiling temperature") for p in props) or has_T):
        return "isobaric-txy" if gas_x else "isobaric-tx"
    if fixed_T and has_P:
        return "isothermal-pxy" if gas_x else "isothermal-px"
    if has_T and has_P:
        return "txy-varying" if gas_x else "tpx-varying"
    return None


def open_records(cand, cache, by_inchi, only=None):
    """{pair: [{doi, citation, sets: [{number, kind, points}]}]} from the candidate records."""
    dois = sorted({d for p, ds in cand.items() if only is None or p in only for d in ds})
    print(f"  opening {len(dois)} records", file=sys.stderr)

    def one(doi):
        try:
            return doi, record(cache, doi)
        except Exception as e:  # a record that cannot be fetched or read is reported, not skipped silently
            return doi, {"error": str(e)}

    found, errors = defaultdict(list), []
    with cf.ThreadPoolExecutor(4) as ex:
        for k, (doi, rec) in enumerate(ex.map(one, dois)):
            if k % 100 == 0:
                print(f"  {k}/{len(dois)}", file=sys.stderr)
            if "error" in rec:
                errors.append((doi, rec["error"]))
                continue
            ids = {n: by_inchi.get(norm_inchi(c["inchi"])) for n, c in rec["compounds"].items()}
            per_pair = defaultdict(list)
            for s in rec["sets"]:
                if len(s["components"]) != 2 or not s["rows"]:
                    continue
                a, b = (ids.get(n) for n in s["components"])
                if not a or not b or a == b or set(s["phases"]) - VLE_PHASES or not VLE_PHASES & set(s["phases"]):
                    continue
                if "Liquid" not in s["phases"]:
                    continue
                kind = classify(s, rec, ids)
                if kind:
                    per_pair[key(a, b)].append({"number": s["number"], "kind": kind, "points": len(s["rows"])})
            c = rec["citation"]
            for p, sets in per_pair.items():
                found[p].append({"doi": doi, "year": c["year"], "journal": c["journal"],
                                 "first_author": (c["authors"][0] if c["authors"] else ""), "sets": sets})
    return found, errors


def params():
    global BINS_NOW
    BINS_NOW = json.loads((ROOT / "src" / "data" / "binaries.json").read_text())["pairs"]
    have = defaultdict(set)
    for r in BINS_NOW:
        if r["i"] in ACTIVITY and r["j"] in ACTIVITY:
            have[key(r["i"], r["j"])].add(f"{r['model']} {r['tier']}")
    return have


def chemsep():
    from thermo.interaction_parameters import IPDB
    out = defaultdict(set)
    for a in range(len(ACTIVITY)):
        for b in range(a + 1, len(ACTIVITY)):
            i, j = ACTIVITY[a], ACTIVITY[b]
            for model, table in (("NRTL", "ChemSep NRTL"), ("UNIQUAC", "ChemSep UNIQUAC")):
                ci, cj = COMPS[i]["cas"], COMPS[j]["cas"]
                if IPDB.get_ip_specific(table, [ci, cj], "bij") or IPDB.get_ip_specific(table, [cj, ci], "bij"):
                    out[key(i, j)].add(model)
    return out


def write(found, errors, have, cs, index=True):
    pairs = [key(ACTIVITY[a], ACTIVITY[b]) for a in range(len(ACTIVITY)) for b in range(a + 1, len(ACTIVITY))]
    if index:
        write_index(found, pairs)
    write_doc(found, errors, have, cs, pairs)


def write_index(found, pairs):
    index = {f"{a}+{b}": found[(a, b)] for a, b in pairs if found.get((a, b))}
    INDEX_FILE.parent.mkdir(parents=True, exist_ok=True)
    INDEX_FILE.write_text(json.dumps({
        "_about": "Records of the NIST TRC ThermoML Archive (https://trc.nist.gov/ThermoML/; open data, free to read even "
                  "where the article is not) with binary vapour-liquid data of each pair, found by "
                  "validation/python/scan_pairs.py. Set numbers and point counts as stored in each record; the values "
                  "themselves are read from the record when a pair is fitted.",
        "scanned": datetime.date.today().isoformat(), "pairs": index}, indent=1) + "\n")


def write_doc(found, errors, have, cs, pairs):

    def name(c):
        return COMPS[c]["name"]

    def vle_points(p):
        return sum(s["points"] for r in found.get(p, []) for s in r["sets"] if s["kind"] in ("isobaric-txy", "isothermal-pxy", "isothermal-px", "isobaric-tx"))

    fitted = [p for p in pairs if any(t.endswith("fitted") for t in have[p])]
    databank = [p for p in pairs if p not in fitted and have[p]]
    none = [p for p in pairs if not have[p]]
    groups = [
        ("Databank only, with open data to fit", [p for p in databank if vle_points(p)]),
        ("No parameters, in the ChemSep databank (not imported yet)", [p for p in none if cs.get(p)]),
        ("No parameters, with open data to fit", [p for p in none if not cs.get(p) and vle_points(p)]),
    ]
    lines = [
        "# Binary pairs: parameters and open vapour-liquid data", "",
        "Generated by `validation/python/scan_pairs.py`; do not edit by hand. Archive scanned "
        f"{json.loads(INDEX_FILE.read_text())['scanned']}.", "",
        f"{len(ACTIVITY)} components with UNIQUAC r and q (the ones NRTL and UNIQUAC describe) make {len(pairs)} pairs: "
        f"{len(fitted)} fitted to open data, {len(databank)} from a databank only, {len(none)} with no parameters. "
        f"For {sum(1 for p in none if cs.get(p))} pairs without parameters the ChemSep databank has a set. "
        f"For {sum(1 for p in pairs if vle_points(p))} pairs the NIST TRC ThermoML Archive has binary vapour-liquid data "
        "(isobaric T-x-y, isothermal P-x(-y)); the record list is in `validation/data/vle/index.json`.", "",
        "Kinds: T-x-y isobaric with vapour; T-x isobaric bubble points; P-x-y and P-x isothermal; az. azeotrope; "
        "γ∞ activity coefficient at infinite dilution. A record is counted once per pair; points are the rows of its sets.", "",
    ]
    for title, ps in groups:
        ps = sorted(ps, key=lambda p: -vle_points(p))
        lines += [f"## {title} ({len(ps)})", "", "| Pair | Fugacity | ChemSep | Records | VLE points | Kinds |", "|---|---|---|---|---|---|"]
        for p in ps:
            kinds = defaultdict(int)
            for r in found.get(p, []):
                for s in r["sets"]:
                    kinds[s["kind"]] += 1
            short = {"isobaric-txy": "T-x-y", "isobaric-tx": "T-x", "isothermal-pxy": "P-x-y", "isothermal-px": "P-x",
                     "azeotrope": "az.", "gamma": "γ∞", "txy-varying": "T-P-x-y", "tpx-varying": "T-P-x"}
            lines.append(f"| {name(p[0])} + {name(p[1])} | {', '.join(sorted(have[p])) or '–'} | {', '.join(sorted(cs.get(p, []))) or '–'} | "
                         f"{len(found.get(p, []))} | {vle_points(p)} | {', '.join(f'{short[k]} {n}' for k, n in sorted(kinds.items()))} |")
        lines.append("")
    # the fits of this scan (vle_batch.py, fit_parameters.py)
    gen_file = ROOT / "validation" / "data" / "vle" / "fits.json"
    gen = json.loads(gen_file.read_text())["fits"] if gen_file.exists() else []
    if gen:
        import re
        lines += [f"## Fitted to archive data by vle_batch.py ({len(gen)} pairs with a chosen data set)", "",
                  "Models written: the fit met its limits (fit_parameters.GATE) and predicts no spurious second liquid. "
                  "Check: the largest mean deviation from another article's set at the same kind of conditions; above 1 K the "
                  "articles disagree and a person should look at both.", "",
                  "| Pair | Data | Models written | Check |", "|---|---|---|---|"]
        for f in sorted(gen, key=lambda f: f["key"]):
            recs = [r for r in BINS_NOW if r.get("tier") == "fitted" and r.get("default", True) and {r["i"], r["j"]} == set(f["pair"]) and f["file"] in r.get("source", "")]
            models = ", ".join(sorted(r["model"] for r in recs)) or "none (limits not met)"
            checks = [float(m) for r in recs for m in re.findall(r"Check against vle/[^:]*: AAD ([0-9.]+) K", r["source"])]
            kind = json.loads((ROOT / "validation" / "data" / f["file"]).read_text())["kind"]
            lines.append(f"| {name(f['pair'][0])} + {name(f['pair'][1])} | {kind} | {models} | "
                         f"{(('**' if max(checks) > 1 else '') + f'{max(checks):.2f} K' + ('**' if max(checks) > 1 else '')) if checks else '–'} |")
        lines.append("")
    lines += coverage_by_method()
    rest = [p for p in none if not cs.get(p) and not vle_points(p)]
    lines += [f"## No parameters and no open vapour-liquid data found ({len(rest)})", "",
              "Many of these are pairs of a liquid with a component that is far from its boiling range (a gas or a "
              "heavy solvent), where liquid-liquid or solubility data matter more.", "",
              ", ".join(f"{name(a)} + {name(b)}" for a, b in rest), ""]
    if errors:
        lines += ["## Records that could not be read", "", *[f"- {d}: {e}" for d, e in errors], ""]
    DOC_FILE.write_text("\n".join(lines))
    print(f"wrote {INDEX_FILE.relative_to(ROOT)} and {DOC_FILE.relative_to(ROOT)}", file=sys.stderr)


# The method a pair needs (docs/METHOD_SELECTION.md): polar = a heteroatom in the formula, except the light
# gases that cubic equations of state describe (as src/thermo/method-advice.js decides); a gas = boiling below 0 degC.
EOS_GASES = {"nitrogen", "carbon-dioxide", "hydrogen-sulfide", "carbon-monoxide", "oxygen", "argon", "hydrogen",
             "nitrous-oxide", "sulfur-dioxide", "ammonia"}


def is_polar(cid):
    import re
    return cid not in EOS_GASES and bool(re.search(r"O|N(?!a)|S(?!i)|P|F|Cl|Br|I", COMPS[cid].get("formula", "")))


def is_gas(cid):
    return (COMPS[cid].get("Tb_K") or 0) < 273.15


def needed_method(a, b):
    if not is_polar(a) and not is_polar(b):
        return "eos"
    if is_gas(a) and is_gas(b):
        return "eos"
    if is_gas(a) or is_gas(b):
        return "gas-in-liquid"
    return "activity"


def coverage_by_method():
    """Pairs of all components by the method the rules choose, and how many have parameters or open data."""
    arch_file = ROOT / "validation" / "data" / "vle" / "archive_index.json"
    if not arch_file.exists():
        return []
    arch = json.loads(arch_file.read_text())
    data = {tuple(k.split("+")) for k, v in arch["pairs"].items()
            if any(s["kind"] in ("isobaric-txy", "isobaric-tx", "isothermal-pxy", "isothermal-px", "txy-varying", "tpx-varying") for r in v for s in r["sets"])}
    kij = {key(p["i"], p["j"]) for p in json.loads((ROOT / "src" / "data" / "kij.json").read_text())["pairs"] if p.get("tier") != "none"}
    henry = {key(p["gas"], p["solvent"]) for p in json.loads((ROOT / "src" / "data" / "henry.json").read_text())["pairs"]}
    act = {key(r["i"], r["j"]) for r in BINS_NOW if r.get("default", True)}
    ids = sorted(COMPS)
    rows = defaultdict(lambda: [0, 0, 0, 0])
    for x in range(len(ids)):
        for y in range(x + 1, len(ids)):
            p = key(ids[x], ids[y])
            m = needed_method(*p)
            have = p in (kij if m == "eos" else henry if m == "gas-in-liquid" else act)
            r = rows[m]
            r[0] += 1
            r[1] += have
            r[2] += (not have) and p in data
            r[3] += (not have) and p not in data
    label = {"eos": "Nonpolar, or both gases: an equation of state with k_ij", "activity": "Polar liquids: an activity model (NRTL, UNIQUAC)",
             "gas-in-liquid": "A gas in a polar liquid: Henry's law (water only), else PSRK or MHV2 (not in CHEPTA yet)"}
    out = ["## Coverage by the method each pair needs", "",
           f"All {len(ids)} components, {len(ids) * (len(ids) - 1) // 2} pairs, each counted once for the method the rules of "
           "docs/METHOD_SELECTION.md choose (polar: a heteroatom in the formula, except the light gases cubic equations describe; "
           "gas: boiling below 0 °C). Open data: binary vapour-liquid data in the whole NIST TRC ThermoML Archive "
           f"(bulk file, {arch['records_read']} records; validation/data/vle/archive_index.json, scan_archive.py).", "",
           "| Method needed | Pairs | With parameters | No parameters, open data in the archive | No parameters, no data in the archive |",
           "|---|---|---|---|---|"]
    for m in ("activity", "eos", "gas-in-liquid"):
        r = rows[m]
        out.append(f"| {label[m]} | {r[0]} | {r[1]} | {r[2]} | {r[3]} |")
    out += ["", f"The whole archive has binary vapour-liquid data for {arch['archive_binary_vle_compound_pairs']} distinct compound pairs "
            "(of every compound it holds, not only CHEPTA's).", ""]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True, type=Path)
    ap.add_argument("--report", action="store_true", help="only rewrite docs/PAIR_SCAN.md from the index")
    a = ap.parse_args()
    if a.report:
        idx = json.loads(INDEX_FILE.read_text())["pairs"]
        found = defaultdict(list, {tuple(k.split("+")): v for k, v in idx.items()})
        write(found, [], params(), chemsep(), index=False)
        return
    by_inchi = inchi_index()
    cand = search_all(a.cache, by_inchi)
    found, errors = open_records(cand, a.cache, by_inchi)
    write(found, errors, params(), chemsep())


if __name__ == "__main__":
    main()
