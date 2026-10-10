"""
The CHEPTA Library (proposal 0003), step 1: one list of sources, src/data/sources.json,
and records that point to it by id.

    python validation/python/make_sources.py           # update the files
    python validation/python/make_sources.py --check   # exit 1 if a file would change

What it does (only standard library; safe to run again, it changes nothing the second time):

1. Sources. Every distinct source once, with an id. Entries already in sources.json are kept
   as they are (a person may have corrected them by hand); only their "files" list (the
   repository files that cite them) is recomputed. New entries come from
     - SEEDS below: sources cited in free text (ChemSep, CoolProp, IAPWS, ...); every field
       is copied from the repository file named in the comment next to it;
     - the "source" blocks of validation/data/**/*.json (citation, doi, open_copy, access):
       authors, title, journal and year are split out of the citation text, so a person
       should check them (the pull request lists them).
   Nothing is looked up or typed from memory: a field that the repository does not state is
   left out.
2. Records. Every parameter record gets "source_ids" (the ids of the sources named in its
   text "source", which stays) and, for pair parameters, a "set" name and "default":
     - src/data/binaries.json: the "replaced" entries of the refitted pairs become ordinary
       records with "default": false right after the current set; a "T_range_K" is also
       stored as "valid": {"T_K": [...]};
     - src/data/kij.json: "set", "default", "source_ids", "valid"; the "replaced" entry
       (tested in test/eos.test.js) stays where it is and gets "set" and "source_ids";
     - src/data/henry.json: "set", "default", "source_ids" (inserted into the hand-formatted
       file without reformatting it);
     - src/data/components.json: "source_ids" on vapour-pressure, UNIQUAC, association, fusion and
       property records, "constants_source_ids" and "omega_source_ids" next to the text;
     - src/data/known-issues.json: "source_ids".
   A record whose text matches no source stops the script with a list (fail loudly).
3. src/data/LICENSES.md: the table between the "sources table" markers is generated from
   sources.json; the text around it (and the license texts) is kept.

Scripts that rewrite these data files (fit_parameters.py, fit_properties.py,
eos_kij_from_chemsep.py, eos_fit_kij.py) drop or do not know these fields; run this script
after them. fit_parameters.py keeps the non-default sets.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "src" / "data"
VAL = ROOT / "validation" / "data"
SOURCES_FILE = DATA / "sources.json"
LICENSES_FILE = DATA / "LICENSES.md"

KINDS = ["standard", "open-source library", "databank", "thermoml", "open-access article",
         "free book", "handbook via open compilation"]

# ------------------------------------------------------------------------------------------
# Sources cited in free text. Each field is copied from the file named in the comment.
SEEDS = {
    # src/data/LICENSES.md (ChemSep row); src/data/binaries.json ("ChemSep NRTL databank (via the
    # open-source thermo library)", "DECHEMA-based"); AGENTS.md (link to the thermo library)
    "chemsep-ipd": {
        "title": "ChemSep interaction parameter files for NRTL and UNIQUAC",
        "authors": "Harry Kooijman, Ross Taylor",
        "kind": "databank",
        "url": "https://github.com/CalebBell/thermo",
        "access": "Open: Artistic License 2.0 (Copyright Harry Kooijman and Ross Taylor)",
        "license": "Artistic License 2.0",
        "via": "the open-source thermo library",
        "note": "DECHEMA-based (as stated in binaries.json for water + acetic acid).",
    },
    # src/data/kij.json "source" block (name, copy_used, license)
    "chemsep-eos-ipd": {
        "title": "ChemSep interaction parameter files pr.ipd and srk.ipd (DECHEMA Peng-Robinson / Soave-Redlich-Kwong EOS data)",
        "authors": "library created by A. L. Dill (1996) and J. A. Clark (2014), updated by H. Kooijman",
        "kind": "databank",
        "url": "https://github.com/DanWBR/dwsim/tree/windows/DWSIM.Thermodynamics/Assets/ChemSepIPD",
        "access": "Open: Artistic License 2.0, Copyright Harry Kooijman and Ross Taylor",
        "license": "Artistic License 2.0",
        "via": "DWSIM",
    },
    # src/data/components.json property records ("Kooijman and Taylor, ChemSep v8.3, chemsep1.xml
    # (2021), via https://github.com/DanWBR/dwsim (DWSIM.Thermodynamics/Assets/Databases)");
    # src/data/LICENSES.md (UNIQUAC r and q row)
    "chemsep-8.3": {
        "title": "ChemSep pure-component database v8.3 (chemsep1.xml)",
        "authors": "Harry Kooijman, Ross Taylor",
        "year": 2021,
        "kind": "databank",
        "url": "https://github.com/DanWBR/dwsim",
        "access": "Open: Artistic License 2.0",
        "license": "Artistic License 2.0",
        "via": "DWSIM (DWSIM.Thermodynamics/Assets/Databases)",
    },
    # validation/python/fit_properties.py (CHEMSEP2_REF): the compounds not in chemsep1.xml (N-methyl-2-pyrrolidone)
    "chemsep-8.31-2": {
        "title": "ChemSep pure component data 2, v8.31 (chemsep2.xml)",
        "authors": "Harry Kooijman, Ross Taylor",
        "year": 2022,
        "kind": "databank",
        "url": "https://github.com/DanWBR/dwsim",
        "access": "Open: Artistic License 2.0",
        "license": "Artistic License 2.0",
        "via": "DWSIM (DWSIM.Thermodynamics/Assets/Databases)",
    },
    # validation/data/iapws/coolprop_grid.json "source"; src/data/LICENSES.md (CoolProp rows)
    "coolprop": {
        "title": "CoolProp 8.0.0",
        "authors": "Bell, Wronski, Quoilin, Lemort",
        "kind": "open-source library",
        "url": "https://github.com/CoolProp/CoolProp",
        "access": "Open source, MIT",
        "license": "MIT",
        "reference": "Bell, Wronski, Quoilin, Lemort, Ind. Eng. Chem. Res. 53 (2014) 2498",
        "note": "Values from the reference equations of state cited in each record (for example IAPWS-95 for water).",
        "files": ["validation/data/eos/coolprop_reference.json", "validation/report/reference/"],
    },
    # src/data/LICENSES.md (vapour-pressure row: "open-source thermo library (MIT)"); AGENTS.md (link)
    "thermo-library": {
        "title": "thermo, open-source chemical engineering library",
        "kind": "open-source library",
        "url": "https://github.com/CalebBell/thermo",
        "access": "Open source, MIT",
        "license": "MIT",
    },
    # validation/data/pure/measured/webbook.json "source"; src/data/LICENSES.md (WebBook rows)
    "nist-webbook": {
        "title": "NIST Chemistry WebBook, NIST Standard Reference Database 69",
        "kind": "databank",
        "url": "https://webbook.nist.gov/chemistry/",
        "access": "Free to read online (NIST); an allowed source under AGENTS.md rule 1",
        "note": "Values cited per record, not redistributed as a database.",
        "files": ["validation/report/reference/", "validation/data/pure/fusion/webbook_fusion.json"],
    },
    # validation/python/thermoml_read.py docstring ("the archive is public, NIST open license"); the
    # pure-component values of validation/python/measured_components.py (proposal 0008, Part B)
    "nist-thermoml-archive": {
        "title": "NIST TRC ThermoML Archive (pure-component data sets of the cited articles)",
        "authors": "NIST Thermodynamics Research Center",
        "kind": "databank",
        "url": "https://trc.nist.gov/ThermoML/",
        "access": "Open: the archive is public, NIST open license (the articles themselves may be subscription-only)",
        "note": "Values cited per article in each record and in validation/data/pure/measured/thermoml_<id>.json.",
        "files": ["validation/data/pure/measured/", "validation/data/sle/"],
    },
    # src/thermo/iapws/if97.js header; src/data/LICENSES.md (IAPWS row)
    "iapws-r7-97": {
        "title": "IAPWS R7-97(2012), Revised Release on the IAPWS Industrial Formulation 1997 for the Thermodynamic Properties of Water and Steam",
        "authors": "International Association for the Properties of Water and Steam",
        "year": 2012,
        "kind": "standard",
        "url": "https://iapws.org/technical-guidance/release/IF97-Rev",
        "access": "Published international standard, free from IAPWS and intended for implementation; equations and coefficients reproduced with citation",
        "files": ["src/thermo/iapws/if97.js", "src/thermo/iapws/steam.js"],
    },
    # src/thermo/iapws/transport.js header
    "iapws-r12-08": {
        "title": "IAPWS R12-08, Release on the IAPWS Formulation 2008 for the Viscosity of Ordinary Water Substance",
        "authors": "International Association for the Properties of Water and Steam",
        "year": 2008,
        "kind": "standard",
        "url": "https://iapws.org/technical-guidance/release/viscosity",
        "access": "Published international standard, free from IAPWS and intended for implementation; equations and coefficients reproduced with citation",
        "files": ["src/thermo/iapws/transport.js"],
    },
    # src/thermo/iapws/transport.js header
    "iapws-r15-11": {
        "title": "IAPWS R15-11, Release on the IAPWS Formulation 2011 for the Thermal Conductivity of Ordinary Water Substance",
        "authors": "International Association for the Properties of Water and Steam",
        "year": 2011,
        "kind": "standard",
        "url": "https://iapws.org/technical-guidance/release/ThCond",
        "access": "Published international standard, free from IAPWS and intended for implementation; equations and coefficients reproduced with citation",
        "files": ["src/thermo/iapws/transport.js"],
    },
    # src/thermo/henry.js header; src/data/henry.json; src/data/LICENSES.md (Henry row)
    "iapws-g7-04": {
        "title": "IAPWS G7-04, Guideline on the Henry's constant and vapor-liquid distribution constant for gases in H2O and D2O at high temperatures",
        "authors": "International Association for the Properties of Water and Steam",
        "year": 2004,
        "kind": "standard",
        "url": "http://www.iapws.org",
        "access": "IAPWS: publication in whole or in part allowed with attribution to IAPWS",
        "files": ["src/thermo/henry.js"],
    },
    # src/data/henry.json (water vapour pressure: "transcribed from the open-source iapws Python
    # package 1.5.5"); src/thermo/iapws/if97.js (link); validation/python/make_iapws_fixtures.py (GPL-3.0)
    "iapws-python": {
        "title": "iapws Python package 1.5.5",
        "kind": "open-source library",
        "url": "https://github.com/jjgomera/iapws",
        "access": "Open source, GPL-3.0",
        "license": "GPL-3.0",
        "note": "Implements the IAPWS releases and guidelines; used to transcribe and cross-check coefficients of the standards, which are cited themselves.",
    },
    # src/data/henry.json (ethylene); src/data/LICENSES.md
    "sander2023-henry": {
        "title": "Compilation of Henry's law constants (version 5.0.0) for water as solvent",
        "authors": "R. Sander",
        "year": 2023,
        "published": "Atmos. Chem. Phys. 23 (2023) 10901-12440",
        "kind": "open-access article",
        "doi": "10.5194/acp-23-10901-2023",
        "url": "https://henrys-law.org/henry/casrn/74-85-1",
        "access": "Open access, CC BY 4.0",
        "license": "CC BY 4.0",
    },
    # validation/data/azeotropes_101kPa.json and water_ethyl-acetate_azeotrope_101kPa.json "source";
    # src/data/LICENSES.md (azeotrope rows)
    "wikipedia-azeotrope-tables": {
        "title": "Azeotrope tables (Wikipedia)",
        "kind": "handbook via open compilation",
        "url": "https://en.wikipedia.org/wiki/Azeotrope_tables",
        "access": "Open (CC BY-SA text; handbook values)",
        "license": "CC BY-SA",
        "original": "Lange's Handbook of Chemistry (10th ed., 1961) and the CRC Handbook of Chemistry and Physics (44th ed., 1962)",
        "note": "Secondary compilation. Used as test references, and as one weighted fit target for water + ethyl acetate because no open finite-concentration VLE data for that pair was found; to be replaced by open primary data.",
    },
    # validation/data/water_ethylene_glycol_760mmHg.json "source"
    "wikipedia-ethylene-glycol-data": {
        "title": "Ethylene glycol (data page), Wikipedia: vapor-liquid equilibrium table for ethylene glycol/water at 760 mmHg",
        "kind": "handbook via open compilation",
        "url": "https://en.wikipedia.org/wiki/Ethylene_glycol_(data_page)",
        "access": "Open (CC BY-SA text; the numbers are compiled experimental data)",
        "license": "CC BY-SA",
        "note": "Secondary compilation with visible scatter. To be replaced by an open primary source.",
    },
}

# validation files whose source is one of the seeds (matched by url)
SEED_BY_URL = {v["url"]: k for k, v in SEEDS.items()}
SEED_BY_URL["https://webbook.nist.gov/chemistry/"] = "nist-webbook"
SEED_BY_FILE = {"validation/data/iapws/coolprop_grid.json": "coolprop"}


def ascii_fold(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


def parse_citation(c):
    """Split 'A. Author, B. Author, Title, Journal 1 (2000) 1-2' into authors, title, published, year."""
    parts = [p.strip() for p in c.split(", ")]
    authors = []
    while parts and re.match(r"^(?:[A-Z]\.\s?-?)+(?:[a-z]+ [A-Z]\. )?[A-Z]", parts[0]) and len(parts[0].split()) <= 5:
        authors.append(parts.pop(0))
    jidx = max((k for k, p in enumerate(parts) if re.search(r"\(\d{4}\)", p)), default=None)
    if not authors or jidx is None or jidx == 0:
        raise ValueError(f"cannot split citation: {c}")
    title = ", ".join(parts[:jidx])
    published = ", ".join(parts[jidx:])
    year = int(re.search(r"\((\d{4})\)", published).group(1))
    return authors, title, published, year


def validation_sources():
    """Sources of validation/data/**/*.json: (id, entry, file) for each file with a source block."""
    out = []
    for f in sorted(VAL.rglob("*.json")):
        rel = f.relative_to(ROOT).as_posix()
        d = json.loads(f.read_text())
        src = d.get("source") if isinstance(d, dict) else None
        if not isinstance(src, dict):
            continue
        url = (src.get("open_copy") or src.get("url") or "").split(" (")[0].strip()
        if rel in SEED_BY_FILE:
            out.append((SEED_BY_FILE[rel], None, rel))
            continue
        if url in SEED_BY_URL:
            out.append((SEED_BY_URL[url], None, rel))
            continue
        authors, title, published, year = parse_citation(src["citation"])
        surname = re.sub(r"[^a-z]", "", ascii_fold(authors[0].split()[-1]).lower())
        comps = d.get("components")
        if comps:
            slug = "-".join(comps)
        else:  # from the file name, without the author-year and pressure tokens
            slug = "-".join(w for w in f.stem.lower().split("_") if not re.match(r"^[a-z]+\d{4}$|^\d+(kpa|mmhg)$", w)).replace("_", "-")
        sid = f"{surname}{year}-{slug}"
        thermoml = "trc.nist.gov/ThermoML" in url
        entry = {
            "title": title,
            "authors": ", ".join(authors),
            "year": year,
            "published": published,
            "kind": "thermoml" if thermoml else ("open-access article" if re.search(r"open access", src.get("access", ""), re.I) else None),
            "doi": src.get("doi") or None,
            "url": url,
            "access": src["access"].rstrip("."),
        }
        if thermoml:
            entry["via"] = "the NIST TRC ThermoML Archive"
        if entry["kind"] is None:
            raise ValueError(f"{rel}: cannot tell the kind of source from its access text")
        out.append((sid, {k: v for k, v in entry.items() if v is not None}, rel))
    # one article, several data files (e.g. the binary sets of one paper): one source. Its id
    # is the one already in sources.json, else the first file's.
    known = json.loads(SOURCES_FILE.read_text())["sources"] if SOURCES_FILE.exists() else {}
    by_url = {}
    for sid, entry, rel in out:
        if entry is not None:
            by_url.setdefault(entry["url"], []).append(sid)
    keep = {url: next((i for i in ids if i in known), ids[0]) for url, ids in by_url.items()}
    return [(sid if entry is None else keep[entry["url"]], entry, rel) for sid, entry, rel in out]


# ------------------------------------------------------------------------------------------
# Text of a record -> source ids


def text_rules(val):
    """(regex, id) pairs: the ChemSep / CoolProp / ... wording, and for every validation source
    its first author's surname followed by its year in parentheses, and its file name."""
    rules = [
        (r"ChemSep (?:NRTL|UNIQUAC) databank|ChemSep UNIQUAC T-x-y", "chemsep-ipd"),
        (r"ChemSep (?:pr|srk)\.ipd", "chemsep-eos-ipd"),
        (r"ChemSep (?:pure-component database )?v8\.3(?!1)", "chemsep-8.3"),
        (r"ChemSep (?:pure-component database )?v8\.31|ChemSep v8\.31 pure component data 2", "chemsep-8.31-2"),
        (r"CoolProp 8\.0\.0", "coolprop"),
        (r"open-source thermo library", "thermo-library"),
        (r"NIST Chemistry WebBook", "nist-webbook"),
        (r"NIST TRC ThermoML Archive", "nist-thermoml-archive"),
        (r"IAPWS G7-04", "iapws-g7-04"),
        (r"iapws Python package", "iapws-python"),
        (r"Sander, Compilation of Henry's law constants", "sander2023-henry"),
        (r"Wikipedia 'Azeotrope tables'|Azeotrope tables, Wikipedia", "wikipedia-azeotrope-tables"),
        (r"Wikipedia ethylene glycol data page", "wikipedia-ethylene-glycol-data"),
    ]
    for sid, entry, rel in val:
        if entry is None:
            continue
        surname = ascii_fold(entry["authors"].split(", ")[0].split()[-1])
        rules.append((rf"\b{re.escape(surname)}\b[^()]{{0,140}}\({entry['year']}\)", sid))
        rules.append((re.escape(Path(rel).name), sid))
    return rules


# a source reached through another one: the other one is its "via", not a second source
VIA = {"chemsep-ipd": "thermo-library"}


def ids_in(text, rules):
    """Source ids named in a text, in order of first appearance."""
    hits = []
    for pattern, sid in rules:
        m = re.search(pattern, text)
        if m:
            hits.append((m.start(), sid))
    out = []
    for _, sid in sorted(hits):
        if sid not in out:
            out.append(sid)
    for sid, via in VIA.items():
        if sid in out and via in out:
            out.remove(via)
    return out


def src_text(src):
    """The text of a record's source that names where the numbers come from. For structured
    sources only name, reference, file and data: their "chain" and "notes" also name sources
    that were looked at and had no data."""
    if isinstance(src, str):
        return src
    parts = []
    for k in ("name", "reference", "file", "data"):
        v = src.get(k)
        if v:
            parts.append(" ".join(v) if isinstance(v, list) else str(v))
    return " ".join(parts)


# ------------------------------------------------------------------------------------------
# Records


def with_keys_after(rec, after, new):
    """A copy of rec with the keys of `new` placed right after key `after` (others in order)."""
    out = {}
    for k, v in rec.items():
        if k in new:
            continue
        out[k] = v
        if k == after:
            out.update(new)
    for k, v in new.items():
        out.setdefault(k, v)
    return out


def set_name(rec_tier, sids, text):
    data = [s for s in sids if s not in ("chemsep-ipd", "chemsep-eos-ipd", "thermo-library")]
    if rec_tier == "fitted" and data:
        name = "fitted-" + data[0].split("-")[0]
        return name + ("-etal" if len(data) >= 3 else "")
    if "ChemSep UNIQUAC T-x-y" in text:
        return "chemsep-uniquac-curve"
    if sids == ["chemsep-ipd"] or sids == ["chemsep-eos-ipd"]:
        return "chemsep"
    raise ValueError(f"no set name for a {rec_tier} record citing {sids}: {text[:120]}")


def annotate_pair(rec, rules, unmapped, where, default):
    text = src_text(rec["source"])
    sids = rec.get("source_ids") or ids_in(text, rules)
    if not sids:
        unmapped.append(f"{where}: {text[:160]}")
        return rec
    head = {"set": rec.get("set") or set_name(rec.get("tier", "databank"), sids, text), "default": rec.get("default", default)}
    rec = with_keys_after(rec, "j", head) if "j" in rec else {**head, **rec}
    rec = with_keys_after(rec, "source", {"source_ids": sids})
    rng = rec.get("T_range_K") or (rec["source"].get("T_range_K") if isinstance(rec["source"], dict) else None)
    if rng and "valid" not in rec:
        rec["valid"] = {"T_K": rng}
    return rec


def annotate_binaries(doc, rules, unmapped):
    out = []
    for p in doc["pairs"]:
        old = p.get("replaced")
        cur = {k: v for k, v in p.items() if k != "replaced"}
        cur = annotate_pair(cur, rules, unmapped, f"binaries {p['model']} {p['i']}-{p['j']}", True)
        out.append(cur)
        if old:
            alt = {"model": p["model"], "i": old.get("i", p["i"]), "j": old.get("j", p["j"])}
            alt.update({k: v for k, v in old.items() if k not in ("i", "j")})
            out.append(annotate_pair(alt, rules, unmapped, f"binaries {p['model']} {p['i']}-{p['j']} (replaced)", False))
    doc["pairs"] = out
    return doc


def annotate_kij(doc, rules, unmapped):
    out = []
    for p in doc["pairs"]:
        where = f"kij {p['model']} {p['i']}-{p['j']}"
        q = annotate_pair(p, rules, unmapped, where, True)
        if q.get("replaced"):
            r = q["replaced"]
            text = src_text(r["source"])
            sids = r.get("source_ids") or ids_in(text, rules)
            if not sids:
                unmapped.append(f"{where} (replaced): {text[:160]}")
            else:
                head = {"set": r.get("set") or set_name(r.get("tier", "databank"), sids, text), "default": False}
                r = {**head, **{k: v for k, v in r.items() if k not in head}}
                r = with_keys_after(r, "source", {"source_ids": sids})
                q["replaced"] = r
        out.append(q)
    doc["pairs"] = out
    return doc


def annotate_henry_text(text, rules, unmapped):
    """Insert set/default/source_ids into the hand-formatted henry.json without reformatting."""
    doc = json.loads(text)
    for p in doc["pairs"]:
        if "source_ids" in p:
            continue
        sids = ids_in(p["source"], rules)
        if not sids:
            unmapped.append(f"henry {p['gas']}: {p['source'][:160]}")
            continue
        name = "iapws-g7-04" if sids[0] == "iapws-g7-04" else sids[0].split("-")[0]
        ins = f'"set": "{name}", "default": true, "source_ids": {json.dumps(sids)},'
        pat = re.compile(r'(\{\s*\n(\s*)"gas": "' + re.escape(p["gas"]) + r'",[^\n]*\n)')
        text, n = pat.subn(lambda m: m.group(1) + m.group(2) + ins + "\n", text, count=1)
        assert n == 1, p["gas"]
    vp = doc["solvents"]["water"]["vapourPressure"]
    if "source_ids" not in vp:
        sids = ids_in(vp["source"], rules)
        if not sids:
            unmapped.append("henry water vapour pressure")
        else:
            text, n = re.subn(r'(\n(\s*)"source": "IAPWS G7-04 \(2004\), Guideline[^\n]*")\n',
                              lambda m: m.group(1) + ",\n" + m.group(2) + f'"source_ids": {json.dumps(sids)}\n', text, count=1)
            assert n == 1
    json.loads(text)  # still valid
    return text


PROPERTY_SOURCE_KEYS = ("vapourPressure", "uniquac", "association", "fusion")


def annotate_components(doc, rules, unmapped):
    for cid, c in doc["components"].items():
        for key in PROPERTY_SOURCE_KEYS:
            r = c.get(key)
            if isinstance(r, dict) and "source" in r and "source_ids" not in r:
                sids = ids_in(src_text(r["source"]), rules)
                if not sids:
                    unmapped.append(f"components {cid}.{key}: {src_text(r['source'])[:160]}")
                    continue
                c[key] = with_keys_after(r, "source", {"source_ids": sids})
        for name, r in (c.get("properties") or {}).items():
            if "source" in r and "source_ids" not in r:
                sids = ids_in(src_text(r["source"]), rules)
                if not sids:
                    unmapped.append(f"components {cid}.properties.{name}: {src_text(r['source'])[:160]}")
                    continue
                c["properties"][name] = with_keys_after(r, "source", {"source_ids": sids})
        for field in ("constants_source", "omega_source"):
            if field in c and f"{field}_ids" not in c:
                sids = ids_in(c[field], rules)
                if not sids:
                    unmapped.append(f"components {cid}.{field}: {c[field][:160]}")
                    continue
                doc["components"][cid] = c = with_keys_after(c, field, {f"{field}_ids": sids})
    return doc


def annotate_known_issues(doc, rules, unmapped):
    out = []
    for k in doc["issues"]:
        if "source_ids" not in k:
            sids = ids_in(k["reference"], rules)
            if not sids:
                unmapped.append(f"known-issues {k['model']} {k['components']}: {k['reference']}")
            else:
                k = with_keys_after(k, "reference", {"source_ids": sids})
        out.append(k)
    doc["issues"] = out
    return doc


# ------------------------------------------------------------------------------------------
# Who uses each source (for LICENSES.md; the engine computes the same at run time)

PROPERTY_LABELS = {"vapourPressure": "vapour pressure", "uniquac": "UNIQUAC r and q", "association": "vapour association",
                   "fusion": "melting temperature and enthalpy of fusion",
                   "constants_source": "critical constants and normal boiling point", "omega_source": "acentric factor"}


def uses(binaries, kij, henry, components, issues):
    u = {}
    add = lambda sid, what: u.setdefault(sid, []).append(what)
    for p in binaries["pairs"]:
        for s in p.get("source_ids", []):
            add(s, ("pair", p["model"], p.get("default", True)))
    for p in kij["pairs"]:
        for s in p.get("source_ids", []):
            add(s, ("kij", p["model"], True))
        for s in (p.get("replaced") or {}).get("source_ids", []):
            add(s, ("kij", p["model"], False))
    for p in henry["pairs"]:
        for s in p.get("source_ids", []):
            add(s, ("henry", p["gas"], True))
    for s in henry["solvents"]["water"]["vapourPressure"].get("source_ids", []):
        add(s, ("henry-solvent", "water", True))
    for cid, c in components["components"].items():
        for key in PROPERTY_SOURCE_KEYS:
            for s in (c.get(key) or {}).get("source_ids", []):
                add(s, ("component", PROPERTY_LABELS[key], cid))
        for name, r in (c.get("properties") or {}).items():
            for s in r.get("source_ids", []):
                add(s, ("component", re.sub(r"([A-Z])", lambda m: " " + m.group(1).lower(), name), cid))
        for field in ("constants_source", "omega_source"):
            for s in c.get(f"{field}_ids", []):
                add(s, ("component", PROPERTY_LABELS[field], cid))
    for k in issues["issues"]:
        for s in k.get("source_ids", []):
            add(s, ("issue", k["model"], True))
    return u


def used_for(entry, items):
    parts = []
    pairs = [i for i in items if i[0] == "pair"]
    if pairs:
        d = sum(1 for i in pairs if i[2])
        models = sorted({i[1] for i in pairs})
        parts.append(f"{len(pairs)} {'/'.join(models)} parameter set{'s' if len(pairs) != 1 else ''}"
                     + (f" ({d} default, {len(pairs) - d} alternative)" if d != len(pairs) else ""))
    kij = [i for i in items if i[0] == "kij"]
    if kij:
        d = sum(1 for i in kij if i[2])
        parts.append(f"{len(kij)} k_ij ({', '.join(sorted({i[1] for i in kij}))})" + (f", {len(kij) - d} of them alternative" if d != len(kij) else ""))
    henry = [i[1] for i in items if i[0] == "henry"]
    if henry:
        parts.append("Henry's law constants of " + ", ".join(henry))
    if any(i[0] == "henry-solvent" for i in items):
        parts.append("water vapour pressure of the Henry's law equations")
    comp = [i for i in items if i[0] == "component"]
    if comp:
        props = sorted({i[1] for i in comp})
        parts.append(f"{len(comp)} pure-component record{'s' if len(comp) != 1 else ''} ({', '.join(props)}) of {len({i[2] for i in comp})} component{'s' if len({i[2] for i in comp}) != 1 else ''}")
    if any(i[0] == "issue" for i in items):
        parts.append("known-deviation notes")
    files = entry.get("files", [])
    if files:
        parts.append(", ".join(f"`{f}`" for f in files))
    return "; ".join(parts) or "not used yet"


def md_escape(s):
    return str(s).replace("|", "\\|")


def licenses_table(sources, u):
    rows = ["| Source | Kind | Used for | Why it is open |", "|---|---|---|---|"]
    order = {k: n for n, k in enumerate(KINDS)}
    for sid, e in sorted(sources.items(), key=lambda kv: (order.get(kv[1]["kind"], 99), kv[0])):
        name = e["title"]
        if e.get("authors"):
            name = f"{e['authors']}, {name}"
        if e.get("published"):
            name += f", {e['published']}"
        elif e.get("year"):
            name += f" ({e['year']})"
        link = e.get("url") or (f"https://doi.org/{e['doi']}" if e.get("doi") else "")
        cell = f"{md_escape(name)} ([link]({link}))" + (f", via {md_escape(e['via'])}" if e.get("via") else "") + f"<br>`{sid}`"
        why = md_escape(e["access"]) + (f". {md_escape(e['note'])}" if e.get("note") else "")
        rows.append(f"| {cell} | {e['kind']} | {md_escape(used_for(e, u.get(sid, [])))} | {why} |")
    return "\n".join(rows)


START = "<!-- sources table: generated by validation/python/make_sources.py from sources.json; do not edit by hand -->"
END = "<!-- end of sources table -->"


def licenses_md(old, table):
    if START in old:
        head, rest = old.split(START, 1)
        tail = rest.split(END, 1)[1]
        return head + START + "\n" + table + "\n" + END + tail
    # first run: replace the hand-written table (header row to the first blank line)
    lines = old.split("\n")
    a = next(k for k, l in enumerate(lines) if l.startswith("| Data | Source | License |"))
    b = next(k for k in range(a, len(lines)) if not lines[k].startswith("|"))
    intro = [
        "Every source is listed once in [`sources.json`](sources.json), with an id; parameter records",
        "refer to it in `source_ids` (their text `source` stays). The table below is generated from",
        "that file. Parameters fitted for CHEPTA (tier `fitted`, with `validation/python/`) are",
        "MIT-licensed like the code; the data they were fitted to keeps the terms of its source.",
        "",
    ]
    return "\n".join(lines[:a] + intro + [START, table, END] + lines[b:])


# ------------------------------------------------------------------------------------------


def dump(obj, indent, ascii_):
    return json.dumps(obj, indent=indent, ensure_ascii=ascii_) + "\n"


def main(check):
    val = validation_sources()
    rules = text_rules(val)
    unmapped = []

    files = {
        "binaries": (DATA / "binaries.json", 2, True),
        "kij": (DATA / "kij.json", 1, False),
        "components": (DATA / "components.json", 2, False),
        "issues": (DATA / "known-issues.json", 2, False),
    }
    docs = {k: json.loads(f.read_text()) for k, (f, _, _) in files.items()}
    docs["binaries"] = annotate_binaries(docs["binaries"], rules, unmapped)
    docs["kij"] = annotate_kij(docs["kij"], rules, unmapped)
    docs["components"] = annotate_components(docs["components"], rules, unmapped)
    docs["issues"] = annotate_known_issues(docs["issues"], rules, unmapped)
    henry_text = annotate_henry_text((DATA / "henry.json").read_text(), rules, unmapped)
    if unmapped:
        sys.exit("No source found for:\n  " + "\n  ".join(unmapped))

    # sources: existing entries kept; new ones from the seeds and the validation files
    old = json.loads(SOURCES_FILE.read_text()) if SOURCES_FILE.exists() else {"sources": {}}
    sources = dict(old["sources"])
    for sid, seed in SEEDS.items():
        sources.setdefault(sid, {k: v for k, v in seed.items() if k != "files"})
    cited = {}
    for sid, entry, rel in val:
        cited.setdefault(sid, []).append(rel)
        if sid not in sources:
            sources[sid] = dict(SEEDS[sid]) if entry is None else entry
    used = uses(docs["binaries"], docs["kij"], json.loads(henry_text), docs["components"], docs["issues"])
    for sid in used:
        if sid not in sources:
            if sid not in SEEDS:
                sys.exit(f"source id {sid} is used but has no entry")
            sources[sid] = dict(SEEDS[sid])
    for sid, e in sources.items():
        seed_files = SEEDS.get(sid, {}).get("files", [])
        f = sorted(set(seed_files) | set(cited.get(sid, [])))
        e.pop("files", None)
        if f:
            e["files"] = f
        if e.get("kind") not in KINDS:
            sys.exit(f"source {sid}: kind {e.get('kind')!r} is not one of {KINDS}")
        if not e.get("access") or not (e.get("url") or e.get("doi")):
            sys.exit(f"source {sid}: needs access and a link")
    unused = [s for s in sources if s not in used and not sources[s].get("files")]
    if unused:
        print("sources not used by any record or file:", ", ".join(unused))
    sources = dict(sorted(sources.items()))
    out_sources = {
        "_about": "The CHEPTA Library (proposal 0003): every source once, with an id. Records in the other data files refer to it in `source_ids`. kind: " + ", ".join(KINDS) + ". url: where anyone can read the numbers (the open copy); doi: the original publication; access: why it is open; via: the open copy the numbers were taken from, when it is not the source itself; files: repository files (code, validation data) that use the source besides the data records. Made by validation/python/make_sources.py; entries can be corrected by hand (the script keeps them).",
        "sources": sources,
    }

    outputs = {SOURCES_FILE: dump(out_sources, 2, False), DATA / "henry.json": henry_text}
    for k, (f, ind, asc) in files.items():
        outputs[f] = dump(docs[k], ind, asc)
    outputs[LICENSES_FILE] = licenses_md(LICENSES_FILE.read_text(), licenses_table(sources, used))

    changed = [f for f, t in outputs.items() if not f.exists() or f.read_text() != t]
    if check:
        if changed:
            sys.exit("out of date: " + ", ".join(str(f.relative_to(ROOT)) for f in changed) + " (run validation/python/make_sources.py)")
        print("sources and records are up to date")
        return
    for f in changed:
        f.write_text(outputs[f])
        print("wrote", f.relative_to(ROOT))
    kinds = {}
    for e in sources.values():
        kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
    print(f"{len(sources)} sources:", ", ".join(f"{n} {k}" for k, n in sorted(kinds.items())))


if __name__ == "__main__":
    main("--check" in sys.argv)
