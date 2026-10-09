"""Data files and fit definitions for binary pairs from the NIST TRC ThermoML Archive, a batch at a time.

For each pair asked for, the records listed in validation/data/vle/index.json (archive search, scan_pairs.py) and
archive_index.json (the archive's whole bulk file, scan_archive.py) are opened,
their binary vapour-liquid data sets are read (validation/python/thermoml_read.py: the values as stored,
nothing rounded) and combined per record into isobaric T-x-y curves (bubble temperature and vapour
composition at the same liquid composition and pressure) and isothermal P-x(-y) curves. One data set is
chosen for the fit, by these rules, in order:

  1. isobaric T-x-y between 90 and 110 kPa with at least 8 points between the pure components, passing
     the thermodynamic consistency point test of fit_parameters.point_test (Redlich-Kister fit to T-x,
     mean |dy| < 0.01); among those, the one with the smallest mean |dy|, then the most points;
  2. else isobaric T-x-y at another pressure, the same rules;
  3. else isothermal P-x(-y) with at least 8 points and the pure-component pressures measured with it
     (rows at x = 0 and x = 1), at the temperature closest to 330 K;
  4. else isobaric bubble temperatures alone (T-x, at least 10 points; also those of a T-x-y set whose
     vapour compositions fail the point test), fitted by Barker's method, when the set's pure-component
     boiling points are within 1 K of the vapour-pressure records; nearest to 101.325 kPa, then the most
     points.

A T-x-y set is used only if its pure-component boiling points, where it has them, are within 1 K of the
vapour-pressure records of src/data/components.json.

Up to two further isobaric T-x-y sets of other articles that pass the point test are written as checks
(compared with the fit, not fitted). Each chosen set is written to validation/data/vle/<i>_<j>_<doi>.json
with a source block (citation, DOI, open copy in the archive, access, the record's set numbers) and the
pair's fit definition to validation/data/vle/fits.json, which fit_parameters.py reads with its own FITS.
A pair with no set meeting these rules is reported with the reason and left out. Only pairs for which the
method rules choose an activity model are taken (scan_pairs.needed_method: both condensable, at least one polar).

    python validation/python/vle_batch.py --cache DIR --pairs 1-propanol+water ethanol+1-propanol ...
    python validation/python/vle_batch.py --cache DIR --batch alcohols       # a named batch below
    python validation/python/vle_batch.py --cache DIR --all                  # every pair of the index

A person still compares the transcribed rows with the archive record before the pull request is merged
(AGENTS.md rule 4): the files say which set of which record they come from.
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import thermoml_read  # noqa: E402
import fit_parameters  # noqa: E402
from measured_components import get, norm_inchi  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
COMPS = json.loads((ROOT / "src" / "data" / "components.json").read_text())["components"]
VLE_DIR = ROOT / "validation" / "data" / "vle"
def _index():
    """Records per pair: the archive search (index.json, scan_pairs.py) and the whole bulk file (archive_index.json,
    scan_archive.py), each record once."""
    out = {}
    for name in ("index.json", "archive_index.json"):
        f = VLE_DIR / name
        if not f.exists():
            continue
        for k, recs in json.loads(f.read_text())["pairs"].items():
            k = "+".join(sorted(k.split("+")))
            have = {r["doi"] for r in out.setdefault(k, [])}
            out[k] += [r for r in recs if r["doi"] not in have]
    return out


INDEX = _index()
FITS_FILE = VLE_DIR / "fits.json"
ACCESS = "The journal article may be subscription-only; the same data is public in the NIST TRC ThermoML Archive (NIST open license)."

ALCOHOLS = ["methanol", "ethanol", "1-propanol", "2-propanol", "1-butanol", "isobutanol", "2-butanol"]
BATCHES = {
    # the C1-C4 alcohols with water and with each other
    "alcohols": [(a, b) for k, a in enumerate(["water"] + ALCOHOLS) for b in (["water"] + ALCOHOLS)[k + 1:]],
}


def pair_key(a, b):
    return "+".join(sorted((a, b)))


def inchi_of(cid):
    from chemicals.identifiers import search_chemical
    return norm_inchi(search_chemical(COMPS[cid]["cas"]).InChI)


def record(cache, doi):
    f = cache / (doi.replace("/", "_") + ".xml")
    if not f.exists():
        f.write_bytes(get("https://trc.nist.gov/ThermoML/%s.xml" % doi))
    return thermoml_read.parse(f.read_bytes())


def curves(rec, a, b):
    """Isobaric and isothermal curves of the pair in a record: {(kind, value): {x_a: {"T"|"P": v, "y": y_a}}},
    with the set numbers that contributed. Mole fractions are of component a."""
    ia, ib = inchi_of(a), inchi_of(b)
    num = {n: ("a" if norm_inchi(c["inchi"]) == ia else "b" if norm_inchi(c["inchi"]) == ib else None) for n, c in rec["compounds"].items()}
    out, used = defaultdict(dict), defaultdict(set)
    for s in rec["sets"]:
        if len(s["components"]) != 2 or {num.get(n) for n in s["components"]} != {"a", "b"}:
            continue
        if set(s["phases"]) != {"Liquid", "Gas"}:
            continue
        cons = {c["type"].split(",")[0]: c["value"] for c in s["constraints"] if c["type"] and c["type"].split(",")[0] in ("Temperature", "Pressure")}
        if any(c["type"] and not c["type"].split(",")[0] in ("Temperature", "Pressure") for c in s["constraints"]):
            continue   # a constraint on composition or something else: not a plain binary curve
        for r in s["rows"]:
            x = y = T = P = None
            for vn, v in s["variables"].items():
                val = r.get("v" + vn)
                t = (v["type"] or "").split(",")[0]
                if t == "Mole fraction":
                    f = val if num.get(v["compound"]) == "a" else 1 - val
                    if v["phase"] == "Liquid":
                        x = f
                    elif v["phase"] == "Gas":
                        y = f
                elif t == "Temperature":
                    T = val
                elif t == "Pressure":
                    P = val
            for pn, p in s["properties"].items():
                val = r.get("p" + pn)
                name = p["name"] or ""
                if name == "Mole fraction":
                    f = val if num.get(p["compound"]) == "a" else 1 - val
                    if p["phase"] == ["Gas"]:
                        y = f
                    elif p["phase"] == ["Liquid"]:
                        x = f
                elif name.startswith("Boiling temperature at pressure P"):
                    T = val
                elif name.startswith("Vapor or sublimation pressure"):
                    P = val
            # a set may hold the bubble temperatures (or pressures) and another the vapour compositions
            # of the same liquids: rows are merged by curve and liquid composition
            if x is None:
                continue
            if "Pressure" in cons and "Temperature" not in cons:
                key, val = ("isobaric", round(cons["Pressure"], 4)), T
            elif "Temperature" in cons and "Pressure" not in cons:
                key, val = ("isothermal", round(cons["Temperature"], 3)), P
            elif not cons and T is not None and P is not None and any((v["type"] or "").startswith("Pressure") for v in s["variables"].values()):
                # T, P and x all varying: rows at the same pressure form an isobaric curve
                key, val = ("isobaric", round(P, 2)), T
            else:
                continue
            if val is None and y is None:
                continue
            pt = out[key].setdefault(round(x, 6), {})
            if val is not None:
                pt["T" if key[0] == "isobaric" else "P"] = val
            if y is not None:
                pt["y"] = y
            used[key].add(s["number"])
    return out, used


def point_test(P, pts, pair):
    """Mean |dy| of the consistency point test on one isobaric curve (fit_parameters.point_test)."""
    saved = fit_parameters.txy_sets
    fit_parameters.txy_sets = lambda spec: [(P, pts)]
    try:
        return fit_parameters.point_test({"pair": pair, "data": "txy-file"})
    finally:
        fit_parameters.txy_sets = saved


def tsat(cid, P):
    """Boiling temperature (K) of a pure component at P (kPa) from its vapour-pressure record."""
    from scipy.optimize import brentq
    c = COMPS[cid]
    return brentq(lambda T: fit_parameters.psat_kpa(c, T) - P, 150, 800)


def end_points(pair, P, rows):
    """Largest |T - Tsat(P)| (K) of the rows of pure components, against the vapour-pressure records; None without such rows."""
    dev = [abs(T - tsat(pair[0] if x == 1 else pair[1], P)) for x, T, _ in rows if x in (0, 1)]
    return max(dev) if dev else None


def candidates(pair, cache):
    """Every usable curve of the pair, as dicts with the curve, its record and its score."""
    a, b = pair
    out = []
    for entry in INDEX.get(pair_key(a, b), []):
        try:
            rec = record(cache, entry["doi"])
        except Exception as e:
            print(f"  {entry['doi']}: record not read ({e})", file=sys.stderr)
            continue
        cs, used = curves(rec, a, b)
        for (kind, val), pts in cs.items():
            if kind == "isobaric":
                # bubble temperatures alone (T-x): a candidate for rule 4
                tx = sorted((x, p["T"], None) for x, p in pts.items() if "T" in p)
                if len([r for r in tx if 0 < r[0] < 1]) >= 10:
                    try:
                        ends_tx = end_points((a, b), val, tx)
                    except Exception:
                        ends_tx = None
                    out.append(dict(kind="isobaric-tx", P=val, rows=tx, inner=len([r for r in tx if 0 < r[0] < 1]), dy=None, ends=ends_tx,
                                    rec=rec, sets=sorted(used[(kind, val)]), doi=entry["doi"]))
                rows = sorted((x, p["T"], p["y"]) for x, p in pts.items() if "T" in p and "y" in p)
                inner = [r for r in rows if 0 < r[0] < 1]
                if len(inner) < 8:
                    continue
                try:
                    dy = point_test(val, inner, (a, b))
                except Exception:
                    dy = None
                try:
                    ends = end_points((a, b), val, rows)
                except Exception:
                    ends = None
                out.append(dict(kind="isobaric-txy", P=val, rows=rows, inner=len(inner), dy=dy, ends=ends, rec=rec, sets=sorted(used[(kind, val)]), doi=entry["doi"]))
            else:
                rows = sorted((x, p["P"], p.get("y")) for x, p in pts.items() if "P" in p)
                xs = [r[0] for r in rows]
                inner = [r for r in rows if 0 < r[0] < 1]
                if len(inner) < 8 or 0 not in xs or 1 not in xs:
                    continue
                out.append(dict(kind="isothermal-px", T=val, rows=rows, inner=len(inner), dy=None, rec=rec, sets=sorted(used[(kind, val)]), doi=entry["doi"]))
    return out


def choose(cands):
    # consistent (point test) and, where the set has them, pure-component boiling points within 1 K of the
    # vapour-pressure records (a set shifted in temperature, or measured at another pressure than stated, fails)
    ok = lambda c: c["dy"] is not None and c["dy"] < 0.01 and (c["ends"] is None or c["ends"] < 1.0)
    near = [c for c in cands if c["kind"] == "isobaric-txy" and 90 <= c["P"] <= 110 and ok(c)]
    other = [c for c in cands if c["kind"] == "isobaric-txy" and ok(c) and c not in near]
    for group in (near, other):
        if group:
            best = sorted(group, key=lambda c: (round(c["dy"], 3), -c["inner"]))[0]
            checks = [c for c in sorted(near + other, key=lambda c: (c["dy"], -c["inner"])) if c is not best and c["doi"] != best["doi"]][:2]
            return best, checks, None
    px = [c for c in cands if c["kind"] == "isothermal-px"]
    if px:
        return sorted(px, key=lambda c: (abs(c["T"] - 330), -c["inner"]))[0], [], None
    # rule 4: bubble temperatures alone (Barker's method), with the pure-component boiling points of the set
    # within 1 K of the vapour-pressure records; nearest to 101.325 kPa, then the most points
    tx = [c for c in cands if c["kind"] == "isobaric-tx" and c["ends"] is not None and c["ends"] < 1.0]
    if tx:
        return sorted(tx, key=lambda c: (not 90 <= c["P"] <= 110, -c["inner"]))[0], [], None
    txy = [c for c in cands if c["kind"] == "isobaric-txy"]
    shifted = [c for c in txy if c["dy"] is not None and c["dy"] < 0.01 and c["ends"] is not None and c["ends"] >= 1.0]
    if shifted:
        return None, [], f"{len(txy)} isobaric T-x-y sets; those passing the point test have pure-component boiling points {min(c['ends'] for c in shifted):.1f} K or more from the vapour-pressure records"
    if txy:
        return None, [], f"{len(txy)} isobaric T-x-y sets, none passes the consistency point test (best mean |dy| {min(c['dy'] for c in txy if c['dy'] is not None):.3f})" if any(c["dy"] is not None for c in txy) else "no set could be tested"
    return None, [], "no isobaric T-x-y set with 8 or more points and no isothermal P-x set with its pure-component pressures"


def author(name):
    """ThermoML "Weeks, B. L.[Brandon L.]" as "B. L. Weeks" (the form the source registry reads)."""
    import re
    name = re.sub(r"\[.*?\]", "", name).strip()
    if ", " not in name:
        return name
    last, first = name.split(", ", 1)
    initials = " ".join("-".join(f"{w[0].upper()}." for w in part.split("-") if w) for part in re.split(r"[\s.]+", first) if part)
    return f"{initials} {last}"


def citation(rec):
    c = rec["citation"]
    authors = ", ".join(author(a) for a in c["authors"])
    return f"{authors}, {c['title']}, {c['journal']} {c['volume']} ({c['year']}) {c['pages']}"


def short_ref(rec):
    c = rec["citation"]
    first = (c["authors"][0].split(",")[0] if c["authors"] else "?")
    return f"{first}{' et al.' if len(c['authors']) > 1 else ''}, {c['journal']} {c['volume']} ({c['year']}) {c['pages']}"


def write_file(pair, c):
    a, b = pair
    doi = c["doi"]
    tag = re.sub(r"[^a-z0-9]+", "-", doi.lower()).strip("-")
    name = f"vle/{a}_{b}_{tag}{'_' + str(round(c['P'], 2)) + 'kPa' + ('_tx' if c['kind'] == 'isobaric-tx' else '') if c['kind'].startswith('isobaric') else '_' + str(round(c['T'], 2)) + 'K'}.json"
    na, nb = COMPS[a]["name"], COMPS[b]["name"]
    common = dict(source=dict(citation=citation(c["rec"]), doi=doi, open_copy=f"https://trc.nist.gov/ThermoML/{doi}.html", access=ACCESS,
                              tables=f"ThermoML record, PureOrMixtureData {', '.join(map(str, c['sets']))}. The table number in the article was not checked."),
                  components=[a, b])
    if c["kind"] == "isobaric-tx":
        d = dict(_about=f"{na} (1) + {nb} (2): isobaric bubble temperatures at {c['P']} kPa (no vapour compositions are fitted). Rows: liquid mole fraction of "
                        f"{na.lower()}, boiling temperature in K, as stored in the ThermoML Archive record (mole fractions of the other component converted with x_1 = 1 - x_2).",
                 **common, kind="isobaric-tx", P_kPa=c["P"], columns=["x_1", "T_K"], rows=[[r[0], r[1]] for r in c["rows"]],
                 notes=f"Read with validation/python/vle_batch.py. Fitted to the bubble temperatures alone (Barker's method): no set of this pair with vapour compositions "
                       f"passes the consistency point test, or none was measured. Pure-component boiling points of the set within {c['ends']:.2f} K of the vapour-pressure "
                       "records. To be checked by a person against the record (AGENTS.md rule 4).")
    elif c["kind"] == "isobaric-txy":
        d = dict(_about=f"{na} (1) + {nb} (2): isobaric T-x-y at {c['P']} kPa. Rows: liquid mole fraction of {na.lower()}, boiling temperature in K, "
                        f"vapour mole fraction of {na.lower()}, as stored in the ThermoML Archive record (mole fractions of the other component converted with x_1 = 1 - x_2).",
                 **common, kind="isobaric-txy", P_kPa=c["P"], columns=["x_1", "T_K", "y_1"], rows=[list(r) for r in c["rows"]],
                 notes=f"Read with validation/python/vle_batch.py. Consistency point test (Redlich-Kister fit to T-x): mean |dy| {c['dy']:.4f}."
                       + (f" Pure-component boiling points of the set within {c['ends']:.2f} K of the vapour-pressure records." if c.get("ends") is not None else "")
                       + " To be checked by a person against the record (AGENTS.md rule 4).")
    else:
        d = dict(_about=f"{na} (1) + {nb} (2): isothermal total pressures at {c['T']} K. Rows: temperature in K, liquid mole fraction of {na.lower()}, pressure in kPa, as stored "
                        "in the ThermoML Archive record. Rows with x_1 = 0 and 1 are the pure-component pressures measured with the same set.",
                 **common, kind="isothermal-px", columns=["T_K", "x_1", "P_kPa"], rows=[[c["T"], r[0], r[1]] for r in c["rows"]],
                 notes="Read with validation/python/vle_batch.py. To be checked by a person against the record (AGENTS.md rule 4).")
    (ROOT / "validation" / "data" / name).write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n")
    return name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True, type=Path)
    ap.add_argument("--pairs", nargs="*", default=[])
    ap.add_argument("--batch", choices=sorted(BATCHES))
    ap.add_argument("--all", action="store_true", help="every pair of validation/data/vle/index.json")
    a = ap.parse_args()
    pairs = [tuple(p.split("+")) for p in a.pairs] + (BATCHES[a.batch] if a.batch else [])
    if a.all:
        pairs += [tuple(k.split("+")) for k in sorted(INDEX)]
    fits = json.loads(FITS_FILE.read_text()) if FITS_FILE.exists() else {"_about": "", "fits": []}
    fits["_about"] = ("Fit definitions written by validation/python/vle_batch.py and read by fit_parameters.py with its own FITS: "
                      "for each pair the data file fitted and the check files, all in validation/data/vle/.")
    existing_fitted = {pair_key(r["i"], r["j"]) for r in fit_parameters.ALL_BINARIES if r.get("tier") == "fitted"}
    # only pairs for which the method rules choose an activity model (docs/METHOD_SELECTION.md): nonpolar pairs
    # need an equation of state with k_ij instead, gases dissolved in a liquid Henry's law
    from scan_pairs import needed_method
    skipped = [p for p in pairs if needed_method(*p) != "activity"]
    pairs = [p for p in pairs if needed_method(*p) == "activity"]
    fits["fits"] = [f for f in fits["fits"] if needed_method(*f["pair"]) == "activity"]
    report = []
    for i, j in pairs:
        k = pair_key(i, j)
        if k in existing_fitted and not any(f["key"] == k for f in fits["fits"]):
            report.append((i, j, "already fitted (fit_parameters.FITS); left as it is"))
            continue
        cands = candidates((i, j), a.cache)
        best, checks, why = choose(cands)
        if not best:
            report.append((i, j, f"not fitted: {why} ({len(INDEX.get(k, []))} records in the index)"))
            continue
        file = write_file((i, j), best)
        check_files = [write_file((i, j), c) for c in checks]
        if best["kind"] == "isobaric-txy":
            what = f"{best['inner']} T-x-y points at {best['P']} kPa"
        elif best["kind"] == "isobaric-tx":
            what = f"{best['inner']} bubble temperatures (T-x, Barker's method; no consistent vapour compositions) at {best['P']} kPa"
        else:
            what = f"{best['inner']} total pressures at {best['T']} K with the measured pure-component pressures"
        describe = (f"Fitted to {what} from {short_ref(best['rec'])} ({fit_parameters.MAC}; validation/data/{file})"
                    + (f"; checked against {', '.join(short_ref(c['rec']) + f' at {c[chr(80)]} kPa' for c in checks)}" if checks else "") + ".")
        entry = dict(key=k, pair=[i, j], file=file, check=check_files, describe=describe)
        fits["fits"] = [f for f in fits["fits"] if f["key"] != k] + [entry]
        report.append((i, j, f"{best['kind']} {what}; {short_ref(best['rec'])}" + (f"; point test {best['dy']:.4f}" if best["dy"] is not None else "") + (f"; {len(checks)} check sets" if checks else "")))
    FITS_FILE.write_text(json.dumps(fits, indent=1, ensure_ascii=False) + "\n")
    # data files of earlier runs that no fit uses any more
    keep = {f["file"] for f in fits["fits"]} | {c for f in fits["fits"] for c in f["check"]}
    for f in VLE_DIR.glob("*.json"):
        if f.name not in ("index.json", "fits.json", "archive_index.json") and f"vle/{f.name}" not in keep:
            f.unlink()
    if skipped:
        report += [(i, j, f"not an activity-model pair ({needed_method(i, j)}): left for the equation-of-state or gas-solubility data") for i, j in skipped]
    for i, j, msg in report:
        print(f"{COMPS[i]['name']} + {COMPS[j]['name']}: {msg}")


if __name__ == "__main__":
    main()
