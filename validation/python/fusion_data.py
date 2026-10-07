"""Melting temperature and enthalpy of fusion of every component (proposal 0007, step 4: solid-liquid equilibrium).

Source (AGENTS.md rule 1, step 3): the phase-change data of the NIST Chemistry WebBook (SRD 69), read from each
component's page (https://webbook.nist.gov/cgi/cbook.cgi?ID=C<CAS>&Units=SI&Mask=4). The values are measurements, each
with its reference, as the WebBook lists them; they are stored as printed in
validation/data/pure/fusion/webbook_fusion.json and chosen here by a fixed rule:

  - melting temperature T_m: the triple-point temperature (the WebBook average, "AVG" row, or the median of the
    individual values), which is the temperature the solid-liquid equilibrium equation needs and is measured more
    precisely than the melting point at 1 atm (for a pure substance the two differ by millikelvin; 1-butanol: Ttriple
    184.5 K, Tfus average 188 +/- 9 K); without one, the WebBook average (or median) of the measured Tfus values;
  - enthalpy of fusion: the median of the values in the WebBook "Enthalpy of fusion" table and the ΔfusH rows of its
    one-dimensional table (one value per article: the same article listed twice, by two compilations, counts once);
    the number of values and their spread are stored with the record, and a spread above 10 % of the value is stated
    as a warning. With only two values that disagree by more than 10 %, the median is just their mean and means
    nothing: the one closer to the independent ChemSep value is taken, and the record says so (ethane, methanol). Rows the
    WebBook marks with a temperature far from T_m (a transition of another solid phase) are left out: only values
    within 3 K of T_m are used.

Where the WebBook has no enthalpy of fusion (or no melting temperature), the next source of rule 1 (step 4): the ChemSep
v8.3 databank (chemsep1.xml, TriplePointTemperature or NormalMeltingPointTemperature, and HeatOfFusionAtMeltingPoint),
labelled so. Otherwise the ChemSep values are the cross-check, stated in the record.

    python validation/python/fusion_data.py --fetch --chemsep chemsep1.xml chemsep2.xml   # download, then choose
    python validation/python/fusion_data.py --chemsep chemsep1.xml chemsep2.xml --write   # write the records

The records go to src/data/components.json as `fusion` (read by src/thermo/pure.js; used by
src/equilibrium/sle.js). A component without WebBook phase-change data gets `fusion: {available: false, searched}`.
"""
import argparse
import datetime
import html as H
import json
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from add_components import ChemSep  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
COMP_FILE = ROOT / "src" / "data" / "components.json"
DATA_FILE = ROOT / "validation" / "data" / "pure" / "fusion" / "webbook_fusion.json"
URL = "https://webbook.nist.gov/cgi/cbook.cgi?ID={ID}&Units=SI&Mask=4"
NEAR_TM_K = 3.0
ACCESS = "Free to read online (NIST Standard Reference Database 69); values cited per record"


def webbook_id(cas):
    return "C" + cas.replace("-", "")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Fugacity data script (https://github.com/FaireDose/Fugacity)"})
    for attempt in range(6):  # the WebBook gateway sometimes times out (HTTP 502-504)
        try:
            with urllib.request.urlopen(req, timeout=120) as f:
                return f.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code not in (502, 503, 504) or attempt == 5:
                raise
            time.sleep(5 * 2 ** attempt)


def table_rows(page, label):
    """Rows of the table with this aria-label, as lists of cell texts (header rows included)."""
    out = []
    for m in re.finditer(r'<table[^>]*aria-label="%s"[^>]*>(.*?)</table>' % re.escape(label), page, re.S):
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(1), re.S):
            cells = [" ".join(H.unescape(re.sub(r"<[^>]+>", "", c)).split())
                     for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
            out.append(cells)
    return out


def number(text):
    """'353.2 ± 0.7' -> (353.2, 0.7); '19.0' -> (19.0, None); '353.' -> 353.0."""
    m = re.match(r"^\s*([-+]?\d+\.?\d*(?:[eE][-+]?\d+)?)\s*(?:±\s*(\d+\.?\d*))?", text or "")
    if not m:
        return None, None
    return float(m.group(1)), (float(m.group(2)) if m.group(2) else None)


def parse(page):
    """The phase-change rows that matter here, as printed."""
    one = {"Tfus": [], "Ttriple": [], "ΔfusH": []}
    for cells in table_rows(page, "One dimensional data"):
        if len(cells) >= 5 and cells[0] in one:
            v, u = number(cells[1])
            if v is not None:
                one[cells[0]].append({"value": v, "uncertainty": u, "units": cells[2], "method": cells[3],
                                      "reference": cells[4], "comment": cells[5] if len(cells) > 5 else ""})
    fus, cols = [], None
    for cells in table_rows(page, "Enthalpy of fusion"):
        if cells and cells[0].startswith("ΔfusH"):
            # the columns differ between pages (some have no "Method" column): read them from the header
            cols = {name.split(" (")[0]: k for k, name in enumerate(cells)}
            continue
        if cols is None or len(cells) < len(cols):
            continue
        v, _ = number(cells[cols["ΔfusH"]])
        T, _ = number(cells[cols["Temperature"]]) if "Temperature" in cols else (None, None)
        if v is not None:
            fus.append({"Hfus_kJ_mol": v, "T_K": T, "method": cells[cols["Method"]] if "Method" in cols else "",
                        "reference": cells[cols["Reference"]], "comment": cells[cols["Comment"]] if "Comment" in cols else ""})
    return {"one_dimensional": one, "enthalpy_of_fusion": fus}


def fetch(comps):
    data = json.loads(DATA_FILE.read_text()) if DATA_FILE.exists() else {}
    for cid, c in comps.items():
        if cid in data:  # already downloaded (delete the entry to download it again)
            continue
        url = URL.format(ID=webbook_id(c["cas"]))
        page = get(url)
        rec = {"url": url, "retrieved": datetime.date.today().isoformat()}
        if "Phase change data" not in page and "One dimensional data" not in page:
            rec["none"] = "no phase-change data on the page"
        else:
            rec.update(parse(page))
        data[cid] = rec
        n = len(rec.get("enthalpy_of_fusion", [])) + len(rec.get("one_dimensional", {}).get("ΔfusH", []))
        print("fetched %-18s Tfus rows %d, enthalpy of fusion rows %d" % (
            cid, len(rec.get("one_dimensional", {}).get("Tfus", [])), n))
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps({k: data[k] for k in sorted(data)}, indent=1, ensure_ascii=False) + "\n")


def choose(rec, chemsep=None):
    """(Tm_K, Hfus_J_mol, description) by the rule in the module docstring, or None and the reason."""
    one = rec.get("one_dimensional", {})
    avg = [r for r in one.get("Tfus", []) if r["method"] == "AVG" and r["units"] == "K"]
    ind = [r["value"] for r in one.get("Tfus", []) if r["method"] != "AVG" and r["units"] == "K"]
    tri = [r for r in one.get("Ttriple", []) if r["method"] == "AVG" and r["units"] == "K"]
    tri_ind = [r["value"] for r in one.get("Ttriple", []) if r["method"] != "AVG" and r["units"] == "K"]
    if tri:
        Tm, how = tri[0]["value"], "WebBook average of the triple-point temperatures (Ttriple, %s)" % tri[0]["comment"]
        Tm_unc = tri[0]["uncertainty"]
    elif tri_ind:
        Tm, how, Tm_unc = statistics.median(tri_ind), "median of %d WebBook triple-point temperatures (%s)" % (
            len(tri_ind), "; ".join(r["reference"] for r in one["Ttriple"] if r["method"] != "AVG")), None
    elif avg:
        Tm, how = avg[0]["value"], "WebBook average of the measured melting temperatures (Tfus, %s)" % avg[0]["comment"]
        Tm_unc = avg[0]["uncertainty"]
    elif ind:
        Tm, how, Tm_unc = statistics.median(ind), "median of %d WebBook melting temperatures (Tfus)" % len(ind), None
    else:
        return None, "no melting or triple-point temperature on the WebBook page"
    vals = []

    def add(v, ref, T):
        stem = re.sub(r",\s*\d+$", "", ref)
        # the same article listed twice (by two compilations, or as "Author, year, 2"): once
        if any(re.sub(r",\s*\d+$", "", o[1]) == stem and abs(o[0] / v - 1) <= 0.01 for o in vals):
            return
        vals.append((v, ref, T))
    for r in rec.get("enthalpy_of_fusion", []):
        if r["T_K"] is None or abs(r["T_K"] - Tm) <= NEAR_TM_K:
            add(r["Hfus_kJ_mol"], r["reference"], r["T_K"])
    for r in one.get("ΔfusH", []):
        if r["units"] == "kJ/mol" and r["method"] != "AVG":
            add(r["value"], r["reference"], None)
    if not vals:
        return {"Tm_K": Tm, "Tm_uncertainty_K": Tm_unc, "Tm_how": how}, \
            "no enthalpy of fusion within %g K of the melting temperature on the WebBook page" % NEAR_TM_K
    Hs = sorted(v[0] for v in vals)
    H, pick = statistics.median(Hs), None
    if len(Hs) == 2 and (Hs[1] - Hs[0]) / H > 0.10 and chemsep and chemsep.get("Hfus_J_mol"):
        H = min(Hs, key=lambda v: abs(v * 1000 - chemsep["Hfus_J_mol"]))
        pick = ("the two measured values disagree; the one closer to the independent ChemSep v8.3 value (%.0f J/mol) is "
                "taken" % chemsep["Hfus_J_mol"])
    return {"Tm_K": Tm, "Tm_uncertainty_K": Tm_unc, "Tm_how": how, "Hfus_kJ_mol": H, "n": len(Hs),
            "Hfus_min": Hs[0], "Hfus_max": Hs[-1], "pick": pick, "references": sorted({v[1] for v in vals})}, None


def chemsep_values(cs, cas):
    if cas not in cs.by_cas:
        return None
    c = cs.compound(cas)

    def val(tag):
        e = c.find(tag)
        return float(e.get("value")) if e is not None and e.get("value") not in (None, "") else None
    Tt, Tm, Hf = val("TriplePointTemperature"), val("NormalMeltingPointTemperature"), val("HeatOfFusionAtMeltingPoint")
    return {"Tm_K": Tt or Tm or None, "Tm_tag": "triple point" if Tt else "melting point",
            "Hfus_J_mol": Hf / 1000 if Hf else None}


def build(comps, data, cs):
    out, report = {}, []
    for cid, c in comps.items():
        rec = data.get(cid)
        if rec is None:
            raise SystemExit("%s: not downloaded (run with --fetch)" % cid)
        url = rec["url"]
        x = chemsep_values(cs, c["cas"])
        ch, why = (None, rec["none"]) if "none" in rec else choose(rec, x)
        if ch is None or why:
            # the next source of rule 1: the ChemSep databank, where it has both values
            if x and x["Tm_K"] and x["Hfus_J_mol"]:
                out[cid] = {"Tm_K": x["Tm_K"], "Hfus_J_mol": round(x["Hfus_J_mol"], 1), "tier": "databank",
                            "source": {"name": cs.name(c["cas"])[0],
                                       "reference": "Kooijman and Taylor, ChemSep pure-component database "
                                                    "(TriplePointTemperature or NormalMeltingPointTemperature, "
                                                    "HeatOfFusionAtMeltingPoint)",
                                       "access": "Artistic License 2.0",
                                       "selection": "ChemSep %s and enthalpy of fusion; NIST WebBook (%s): %s" % (
                                           x["Tm_tag"], url, why)}}
                report.append((cid, x["Tm_K"], x["Hfus_J_mol"], 0, None, "ChemSep (WebBook: %s)" % why))
                continue
            out[cid] = {"available": False, "searched": [
                "NIST Chemistry WebBook, phase change data (%s): %s" % (url, why),
                "ChemSep v8.3: %s" % ("no enthalpy of fusion" if x and x["Tm_K"] else "no value")]}
            report.append((cid, None, None, None, None, why))
            continue
        Hf = round(ch["Hfus_kJ_mol"] * 1000, 1)
        spread = (ch["Hfus_max"] - ch["Hfus_min"]) / ch["Hfus_kJ_mol"]
        sel = ("melting temperature: %s; enthalpy of fusion: %s of %d measured value%s (%s-%s kJ/mol) within %g K of it" % (
            ch["Tm_how"], "median" if ch["n"] > 1 else "the only one", ch["n"], "s" if ch["n"] > 1 else "",
            ch["Hfus_min"], ch["Hfus_max"], NEAR_TM_K))
        if ch["pick"]:
            sel = sel.replace("median of 2", "one of 2") + "; " + ch["pick"]
        elif spread > 0.10:
            sel += "; the measured values disagree by %.0f %% of the median: the enthalpy of fusion is uncertain" % (100 * spread)
        cross = ""
        if x and x["Tm_K"]:
            cross = "ChemSep v8.3: %s %.2f K (%+.2f K)" % (x["Tm_tag"], x["Tm_K"], x["Tm_K"] - ch["Tm_K"])
            if x["Hfus_J_mol"]:
                cross += ", enthalpy of fusion %.0f J/mol (%+.1f %%)" % (x["Hfus_J_mol"], 100 * (x["Hfus_J_mol"] / Hf - 1))
        out[cid] = {"Tm_K": ch["Tm_K"], "Hfus_J_mol": Hf, "tier": "databank",
                    "source": {"name": "NIST Chemistry WebBook (SRD 69), phase change data", "url": url, "access": ACCESS,
                               "reference": "; ".join(ch["references"]), "selection": sel,
                               **({"Tm_uncertainty_K": ch["Tm_uncertainty_K"]} if ch["Tm_uncertainty_K"] else {}),
                               **({"crossCheck": cross} if cross else {})}}
        report.append((cid, ch["Tm_K"], Hf, ch["n"], x, "spread %.0f %%" % (100 * spread) if spread > 0.10 else ""))
    return out, report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fetch", action="store_true", help="download the WebBook pages first")
    ap.add_argument("--chemsep", required=True, nargs="+", help="chemsep1.xml (and chemsep2.xml) for the cross-check")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    doc = json.loads(COMP_FILE.read_text())
    comps = doc["components"]
    if a.fetch:
        fetch(comps)
    data = json.loads(DATA_FILE.read_text())
    out, report = build(comps, data, ChemSep(a.chemsep))
    for cid, Tm, Hf, n, x, why in report:
        if Tm is None:
            print("%-18s no data: %s" % (cid, why))
            continue
        xs = ""
        if x and x["Tm_K"]:
            xs = "ChemSep %.2f K" % x["Tm_K"] + (" %.0f J/mol (%+.1f %%)" % (x["Hfus_J_mol"], 100 * (x["Hfus_J_mol"] / Hf - 1))
                                                 if x["Hfus_J_mol"] else "")
        print("%-18s Tm %8.2f K  Hfus %8.1f J/mol (%2d values)   %s %s" % (cid, Tm, Hf, n, xs, why))
    if a.write:
        for cid, rec in out.items():
            comps[cid]["fusion"] = rec
        COMP_FILE.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
        print("written %s" % COMP_FILE.relative_to(ROOT))


if __name__ == "__main__":
    main()
