"""Read a record of the NIST TRC ThermoML Archive and print its data sets, so pair data can be
transcribed into validation/data/ from the record itself (AGENTS.md rules 1-3).

    python validation/python/thermoml_read.py 10.1021/je2008704            # fetch and list
    python validation/python/thermoml_read.py 10.1021/je2008704 --set 4    # one set, all rows
    python validation/python/thermoml_read.py file.xml --json              # all sets as JSON

The record is fetched from https://trc.nist.gov/ThermoML/<doi>.xml (the archive is public,
NIST open license; the articles themselves may be subscription-only). Values are printed as
stored in the record, with the record's units (K, kPa, mole fraction, kJ/mol); nothing is
converted or rounded. A person still compares the transcription with the record.
"""
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"t": "http://www.iupac.org/namespaces/ThermoML"}
UA = "Fugacity data script (https://github.com/FaireDose/Fugacity)"


def fetch(doi_or_file):
    p = Path(doi_or_file)
    if p.exists():
        return p.read_bytes()
    url = f"https://trc.nist.gov/ThermoML/{doi_or_file}.xml"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def _t(el, path):
    e = el.find(path, NS)
    return None if e is None else e.text


def _first_text(el, tags):
    """Text of the first descendant whose tag (without namespace) is in tags."""
    for e in el.iter():
        if e.tag.split("}")[1] in tags:
            return e.text
    return None


def parse(xml):
    root = ET.fromstring(xml)
    cit = root.find("t:Citation", NS)
    authors = [a.text for a in cit.findall("t:sAuthor", NS)] if cit is not None else []
    citation = dict(
        authors=authors, title=_t(cit, "t:sTitle"), journal=_t(cit, "t:sPubName"),
        volume=_t(cit, "t:sVol"), year=_t(cit, "t:yrPubYr"), pages=_t(cit, "t:sPage"),
        doi=_t(cit, "t:sDOI"))
    comps = {}
    for c in root.findall("t:Compound", NS):
        n = _t(c, "t:RegNum/t:nOrgNum")
        names = [e.text for e in c.findall("t:sCommonName", NS)]
        comps[n] = dict(names=names, formula=_t(c, "t:sFormulaMolec"), inchi=_t(c, "t:sStandardInChI"))
    sets = []
    for d in root.findall("t:PureOrMixtureData", NS):
        num = _t(d, "t:nPureOrMixtureDataNumber")
        members = [_t(c, "t:RegNum/t:nOrgNum") for c in d.findall("t:Component", NS)]
        props = {}
        for p in d.findall("t:Property", NS):
            pn = _t(p, "t:nPropNumber")
            name = _first_text(p, {"ePropName"})
            phase = [e.text for e in p.findall("t:PropPhaseID/t:ePropPhase", NS)]
            comp = _t(p, "t:Property-MethodID/t:RegNum/t:nOrgNum")
            props[pn] = dict(name=name, phase=phase, compound=comp)
        consts = []
        for c in d.findall("t:Constraint", NS):
            consts.append(dict(type=_first_text(c, {"eTemperature", "ePressure", "eComponentComposition", "eSolventComposition", "eMiscellaneous"}),
                               compound=_t(c, "t:ConstraintID/t:RegNum/t:nOrgNum"),
                               phase=_t(c, "t:ConstrPhaseID/t:eConstrPhase"),
                               value=float(_t(c, "t:nConstraintValue"))))
        variables = {}
        for v in d.findall("t:Variable", NS):
            vn = _t(v, "t:nVarNumber")
            variables[vn] = dict(type=_first_text(v, {"eTemperature", "ePressure", "eComponentComposition", "eSolventComposition", "eMiscellaneous"}),
                                 compound=_t(v, "t:VariableID/t:RegNum/t:nOrgNum"),
                                 phase=_t(v, "t:VarPhaseID/t:eVarPhase"))
        phases = [e.text for e in d.findall("t:PhaseID/t:ePhase", NS)]
        rows = []
        for nv in d.findall("t:NumValues", NS):
            row = {}
            for v in nv.findall("t:VariableValue", NS):
                row["v" + _t(v, "t:nVarNumber")] = float(_t(v, "t:nVarValue"))
            for p in nv.findall("t:PropertyValue", NS):
                key = "p" + _t(p, "t:nPropNumber")
                row[key] = float(_t(p, "t:nPropValue"))
                u = _first_text(p, {"nCombExpandUncertValue", "nExpandUncertValue", "nCombStdUncertValue", "nStdUncertValue"})
                if u is not None:
                    row[key + "_unc"] = float(u)
            rows.append(row)
        sets.append(dict(number=int(num), components=members, phases=phases, properties=props,
                         constraints=consts, variables=variables, rows=rows))
    return dict(citation=citation, compounds=comps, sets=sets)


def name(comps, n):
    return comps[n]["names"][0] if n in comps else n


def summary(rec):
    c = rec["citation"]
    print(f"{', '.join(c['authors'])}: {c['title']}. {c['journal']} {c['volume']} ({c['year']}) {c['pages']}. doi {c['doi']}")
    for n, v in rec["compounds"].items():
        print(f"  compound {n}: {v['names'][0]} ({v['formula']})")
    for s in rec["sets"]:
        comps = " + ".join(name(rec["compounds"], n) for n in s["components"])
        props = "; ".join(f"p{k} {v['name']}" + (f" of {name(rec['compounds'], v['compound'])}" if v["compound"] else "") for k, v in s["properties"].items())
        vars_ = "; ".join(f"v{k} {v['type']}" + (f" of {name(rec['compounds'], v['compound'])} ({v['phase']})" if v["compound"] else "") for k, v in s["variables"].items())
        cons = "; ".join(f"{c['type']} = {c['value']}" for c in s["constraints"])
        print(f"set {s['number']}: {comps} | phases {', '.join(s['phases'])} | {props} | variables {vars_} | constraints {cons} | {len(s['rows'])} rows")


if __name__ == "__main__":
    rec = parse(fetch(sys.argv[1]))
    if "--json" in sys.argv:
        print(json.dumps(rec, indent=1))
    elif "--set" in sys.argv:
        k = int(sys.argv[sys.argv.index("--set") + 1])
        s = next(s for s in rec["sets"] if s["number"] == k)
        print(json.dumps({key: s[key] for key in ("components", "phases", "properties", "constraints", "variables")}, indent=1))
        for r in s["rows"]:
            print(r)
    else:
        summary(rec)
