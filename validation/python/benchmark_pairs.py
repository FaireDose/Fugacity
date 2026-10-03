"""Proposal 0004, step 1: the benchmark processes and the binary pairs each one needs.

Writes docs/BENCHMARKS.md: for every benchmark, its components and every pair between them,
with
  - the primary model family and the second one (maintainer's decision, 2026-10-03: every
    liquid pair gets both an equation of state and an activity model, with the one the
    open simulator guides recommend first):
      * a gas at 25 degC and 1 atm (normal boiling point at or below 298.15 K, from the
        `chemicals` library) in the pair: equation of state (k_ij), or Henry's law for a
        gas dilute in water; no activity model (no vapour pressure above the critical point);
      * two hydrocarbons (HYDROCARBONS below): equation of state first, activity model second;
      * otherwise (a polar component): activity model first, equation of state second;
  - what Fugacity has today (src/data/binaries.json, kij.json, henry.json);
  - what the ChemSep databank has (NRTL, UNIQUAC, PR k_ij, Henry), looked up in the copy of
    the ChemSep interaction-parameter files shipped with the open-source `thermo` library
    (ChemSep: Artistic License 2.0; thermo: MIT);
  - a proposed priority: 1 for pairs with water and pairs between the key components of the
    benchmark (KEY below), 2 for the others. The team changes the list (the proposal's step 1
    is a team decision); this script only makes the data coverage visible.

No numbers are written: only names, CAS numbers and yes/no flags. Pure-component and pair
data come in steps 2 and 3, with their sources.

Usage:  python validation/python/benchmark_pairs.py [--write]
"""
import itertools
import json
import os
import sys

from chemicals import CAS_from_any, Tb
from thermo.interaction_parameters import IPDB
import thermo
import chemicals

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "docs", "BENCHMARKS.md")

# The draft list of proposal 0004, section 1 (names only).
BENCHMARKS = [
    ("Ethanol dehydration (extractive and azeotropic distillation)", ["ethanol", "water", "ethylene glycol", "cyclohexane"]),
    ("Ethyl acetate by esterification", ["acetic acid", "ethanol", "ethyl acetate", "water"]),
    ("Methanol synthesis from syngas, with gas cleaning by cold methanol",
     ["hydrogen", "carbon monoxide", "carbon dioxide", "methane", "nitrogen", "methanol", "water", "dimethyl ether", "hydrogen sulfide"]),
    ("Air separation (small case for equations of state)", ["nitrogen", "oxygen", "argon"]),
    ("Light hydrocarbons and refrigeration", ["methane", "ethane", "ethylene", "propane", "propylene", "n-butane", "isobutane", "ammonia"]),
    ("Aromatics (BTX) and styrene", ["benzene", "toluene", "o-xylene", "m-xylene", "p-xylene", "ethylbenzene", "styrene"]),
    ("Solvent recovery (pharmaceutical and coatings solvents)",
     ["acetone", "methanol", "ethanol", "ethyl acetate", "toluene", "1-propanol", "2-propanol", "1-butanol", "2-butanone",
      "methyl acetate", "n-butyl acetate", "tetrahydrofuran", "dichloromethane", "acetonitrile", "diethyl ether", "MTBE",
      "n-hexane", "n-heptane", "water"]),
    ("Higher boilers and glycols", ["propylene glycol", "glycerol", "phenol", "n-pentane", "n-octane", "water"]),
]

# Key components: the ones a benchmark's main separation is about. Pairs between two of them,
# and every pair with water, get priority 1. A proposal for the team to change.
KEY = {
    "Ethanol dehydration (extractive and azeotropic distillation)": ["ethanol", "water", "ethylene glycol", "cyclohexane"],
    "Ethyl acetate by esterification": ["acetic acid", "ethanol", "ethyl acetate", "water"],
    "Methanol synthesis from syngas, with gas cleaning by cold methanol": ["methanol", "water", "carbon dioxide", "hydrogen sulfide", "dimethyl ether"],
    "Air separation (small case for equations of state)": ["nitrogen", "oxygen", "argon"],
    "Light hydrocarbons and refrigeration": ["ethane", "ethylene", "propane", "propylene", "n-butane", "isobutane"],
    "Aromatics (BTX) and styrene": ["benzene", "toluene", "ethylbenzene", "styrene", "p-xylene", "m-xylene", "o-xylene"],
    "Solvent recovery (pharmaceutical and coatings solvents)": ["water", "methanol", "ethanol", "acetone", "ethyl acetate", "toluene"],
    "Higher boilers and glycols": ["water", "propylene glycol", "glycerol", "phenol"],
}

# Hydrocarbons of the benchmarks: pairs of two of them take an equation of state first.
HYDROCARBONS = {"methane", "ethane", "ethylene", "propane", "propylene", "n-butane", "isobutane", "n-pentane",
                "n-hexane", "n-heptane", "n-octane", "cyclohexane", "benzene", "toluene", "o-xylene", "m-xylene",
                "p-xylene", "ethylbenzene", "styrene"}

# Spelling used for the lookups in `chemicals` where the common name is ambiguous.
LOOKUP = {"MTBE": "methyl tert-butyl ether", "n-butyl acetate": "butyl acetate"}


def load(name):
    with open(os.path.join(ROOT, "src", "data", name)) as f:
        return json.load(f)


def main(write):
    comps = load("components.json")["components"]
    have_cas = {v["cas"]: k for k, v in comps.items()}
    binaries = load("binaries.json")["pairs"]
    kij = load("kij.json")["pairs"]
    henry = load("henry.json")

    names = sorted({n for _, cs in BENCHMARKS for n in cs})
    cas = {n: CAS_from_any(LOOKUP.get(n, n)) for n in names}
    tb = {n: Tb(cas[n]) for n in names}
    new = [n for n in names if cas[n] not in have_cas]

    def fug_id(n):
        return have_cas.get(cas[n])

    def has_binary(a, b, model):
        ia, ib = fug_id(a), fug_id(b)
        return any(p["model"] == model and {p["i"], p["j"]} == {ia, ib} for p in binaries) if ia and ib else False

    def tiers(a, b):
        ia, ib = fug_id(a), fug_id(b)
        if not (ia and ib):
            return set()
        return {p["tier"] for p in binaries if {p["i"], p["j"]} == {ia, ib}}

    def has_kij(a, b):
        ia, ib = fug_id(a), fug_id(b)
        return any({p["i"], p["j"]} == {ia, ib} for p in kij) if ia and ib else False

    henry_pairs = {tuple(sorted((p["gas"], p["solvent"]))) for p in henry["pairs"]}

    def has_henry(a, b):
        ia, ib = fug_id(a), fug_id(b)
        return tuple(sorted((ia, ib))) in henry_pairs if ia and ib else False

    def chemsep(table, a, b):
        key = [cas[a], cas[b]]
        par = {"ChemSep NRTL": "bij", "ChemSep UNIQUAC": "bij", "ChemSep PR": "kij"}[table]
        return IPDB.has_ip_specific(table, key, par) or IPDB.has_ip_specific(table, key[::-1], par)

    def chemsep_henry(a, b):
        t = IPDB.tables["ChemSep Henry"]
        return f"{cas[a]} {cas[b]}" in t or f"{cas[b]} {cas[a]}" in t

    yes = lambda v: "yes" if v else "–"
    lines = []
    w = lines.append
    w("# Benchmark processes and their pairs")
    w("")
    w("Proposal [0004](../proposals/0004-first-50-components.md), step 1: the benchmark processes,")
    w("their components, and the binary pairs each one needs, with what Fugacity and the ChemSep")
    w("databank have today. **A draft for the team to change**: which pairs matter is an")
    w("engineering decision, recorded here before any data is added.")
    w("")
    w("Generated by `python validation/python/benchmark_pairs.py --write` "
      f"(thermo {thermo.__version__}, chemicals {chemicals.__version__}). No numbers: names, CAS")
    w("numbers and yes/no flags only. Pure-component and pair data come in steps 2 and 3, each")
    w("with its open source, following AGENTS.md.")
    w("")
    w("How to read the tables:")
    w("")
    w("- **Primary / second model**: every pair of two liquids gets both an equation of state")
    w("  (Peng–Robinson or SRK, with a k_ij) and an activity model (NRTL, UNIQUAC), so they can be")
    w("  compared; the primary one is what the workbench and the benchmark cases use first. As in")
    w("  the selection guides of open and commercial simulators (DWSIM's property package guide;")
    w("  Carlson's decision trees): *EOS* first for two hydrocarbons (non-polar), *activity*")
    w("  first when a polar component is in the pair. With a gas at 25 °C and 1 atm (normal")
    w("  boiling point at or below 298.15 K, from the `chemicals` library): *EOS* only, or *Henry*")
    w("  for a gas dilute in water; an activity model cannot describe a component above its")
    w("  critical temperature.")
    w("- **Fugacity now**: the pair's parameter sets in `src/data/` today (tier in brackets).")
    w("- **ChemSep NRTL / UNIQUAC / PR k_ij / Henry**: the pair is in the ChemSep databank")
    w("  (Artistic License 2.0), as shipped with the open-source `thermo` library. A databank")
    w("  pair is tier `databank`; where open experimental data exist, step 3 fits the pair to")
    w("  them (tier `fitted`) and keeps the databank set as an alternative.")
    w("- **Priority** (proposed): 1 for pairs with water and pairs between the benchmark's key")
    w("  components (listed under each table), 2 for the others.")
    w("")
    w(f"## The components: {len(names)} in the benchmarks, {len(new)} new")
    w("")
    w("| Component | CAS | In Fugacity | Liquid at 25 °C, 1 atm |")
    w("|---|---|---|---|")
    for n in names:
        w(f"| {n} | {cas[n]} | {yes(fug_id(n))} | {yes(tb[n] and tb[n] > 298.15)} |")
    w("")

    total_pairs, seen = 0, {}
    for title, cs in BENCHMARKS:
        key = KEY[title]
        pairs = list(itertools.combinations(cs, 2))
        w(f"## {title}")
        w("")
        w("| Pair | Primary | Second | Priority | Fugacity now | ChemSep NRTL | ChemSep UNIQUAC | ChemSep PR k_ij | ChemSep Henry |")
        w("|---|---|---|---|---|---|---|---|---|")
        for a, b in pairs:
            liquid = all(tb[x] and tb[x] > 298.15 for x in (a, b))
            hc = a in HYDROCARBONS and b in HYDROCARBONS
            if not liquid:
                primary, second = ("Henry or EOS" if "water" in (a, b) else "EOS"), "–"
            elif hc:
                primary, second = "EOS", "activity"
            else:
                primary, second = "activity", "EOS"
            prio = 1 if ("water" in (a, b) or (a in key and b in key)) else 2
            now = []
            if has_binary(a, b, "NRTL"):
                now.append("NRTL")
            if has_binary(a, b, "UNIQUAC"):
                now.append("UNIQUAC")
            if has_kij(a, b):
                now.append("k_ij")
            if has_henry(a, b):
                now.append("Henry")
            t = tiers(a, b)
            now_text = (", ".join(now) + (f" ({', '.join(sorted(t))})" if t else "")) if now else "–"
            row = (f"| {a} + {b} | {primary} | {second} | {prio} | {now_text} | "
                   f"{yes(chemsep('ChemSep NRTL', a, b))} | {yes(chemsep('ChemSep UNIQUAC', a, b))} | "
                   f"{yes(chemsep('ChemSep PR', a, b))} | {yes(chemsep_henry(a, b))} |")
            w(row)
            seen[tuple(sorted((a, b)))] = dict(prio=prio, liquid=liquid, eos_first=(not liquid) or hc,
                                               act_now=has_binary(a, b, "NRTL") or has_binary(a, b, "UNIQUAC"),
                                               eos_now=has_kij(a, b) or has_henry(a, b),
                                               act_db=chemsep("ChemSep NRTL", a, b) or chemsep("ChemSep UNIQUAC", a, b),
                                               eos_db=chemsep("ChemSep PR", a, b) or chemsep_henry(a, b))
        total_pairs += len(pairs)
        w("")
        w(f"Key components: {', '.join(key)}. {len(pairs)} pairs.")
        w("")

    # summary over distinct pairs: for the primary and the second model of each pair
    p1 = [k for k, v in seen.items() if v["prio"] == 1]
    allp = list(seen)
    def count(sel, f):
        return sum(1 for k in sel if f(seen[k]))
    def status(v, family):
        now, db = (v["eos_now"], v["eos_db"]) if family == "eos" else (v["act_now"], v["act_db"])
        return "now" if now else "db" if db else "none"
    w("## Summary")
    w("")
    w(f"{len(seen)} distinct pairs ({total_pairs} counted per benchmark); {len(p1)} with priority 1. "
      f"Primary model: equation of state for {count(allp, lambda v: v['eos_first'])} pairs "
      f"({count(p1, lambda v: v['eos_first'])} of priority 1), activity model for {count(allp, lambda v: not v['eos_first'])} "
      f"({count(p1, lambda v: not v['eos_first'])}).")
    w("")
    w("| Parameters for the model | Primary, all | Primary, priority 1 | Second, all | Second, priority 1 |")
    w("|---|--:|--:|--:|--:|")
    for label, st in [("In Fugacity now", "now"), ("In ChemSep, not yet in Fugacity", "db"),
                      ("Neither: search open data, else missing (an EOS uses k_ij = 0 with a warning)", "none")]:
        def prim(v):
            return status(v, "eos" if v["eos_first"] else "act") == st
        def sec(v):
            return v["liquid"] and status(v, "act" if v["eos_first"] else "eos") == st
        w(f"| {label} | {count(allp, prim)} | {count(p1, prim)} | {count(allp, sec)} | {count(p1, sec)} |")
    w("")
    w("Every pair, including one with a ChemSep set, is checked against open experimental data in")
    w("step 3 (NIST TRC ThermoML Archive, open-access articles, free books), and the places searched")
    w("are recorded, also when nothing is found.")
    w("")
    text = "\n".join(lines)
    if write:
        with open(OUT, "w") as f:
            f.write(text)
        print(f"wrote {OUT}")
    else:
        print(text)


if __name__ == "__main__":
    main("--write" in sys.argv)
