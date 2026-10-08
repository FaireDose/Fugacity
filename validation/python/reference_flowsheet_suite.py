"""
Flowsheet test suite (docs/FLOWSHEET_TESTS.md): recycle flowsheets of 3 to 16 components, solved here
equation-oriented, for test/flowsheet-suite.test.js.

  1. The Cavett problem (Cavett 1963), the standard test of tearing and recycle convergence: 16 components, four
     flash drums at fixed temperature and pressure, three recycle loops that share streams. Specification and two
     published solutions (FLOWTRAN, Rosen and Pauls 1977; VMGSim, advanced Peng-Robinson): Rosen, "VMGSim:
     Revisiting the Cavett Problem", CACHE News, Fall 2005, Figures 2 and 3,
     https://cache.org/sites/default/files/fall2005_rosen_cavett.pdf (free to read on the CACHE site).
  2. Generated flowsheets: four layouts (two to three drums, splitters, a component separator, a heater, bypasses,
     two or three recycles), each with several component sets of 3 to 7 components drawn from components whose
     pair parameters are all in the databank (NRTL, UNIQUAC) or from the Cavett hydrocarbons and gases (Peng-Robinson),
     with feeds and drum conditions drawn by a seeded random generator. Every case is kept: the generator does not
     discard a case that is hard to solve (a case the reference cannot solve stops this script).

Each flowsheet is the same JSON the JavaScript solver takes (src/flowsheet/flowsheet.js). Here it is solved
differently: the tear streams are the recycle streams chosen by hand (`reference_tears`, as Rosen and Pauls tore
the Cavett problem: R1, R2, R3), which is in general not the smallest tear set the JavaScript solver picks; their
component flows are the unknowns of g(x) - x = 0, solved by scipy.optimize.root (hybrid Powell, then
Levenberg-Marquardt if the flash's own noise stalls it) after five direct-substitution passes as a start. The
drums are the independent flash of reference_flash.py (thermo's FlashVL with the same parameters), never the
JavaScript engine. Drum specifications are T-P and P-VF, so the flows do not depend on enthalpies. That flash is
vapour-liquid only; for the equation-of-state cases each drum is checked at the solution with thermo's FlashVLN
(vapour and two liquids): `liquids_vln` is the number of liquids it finds there.

Writes validation/fixtures/flowsheet-suite.json and docs/FLOWSHEET_TESTS.md.

Usage: python validation/python/reference_flowsheet_suite.py
"""
import json
import time
import warnings
from pathlib import Path

import numpy as np
from scipy.optimize import root

from reference_model import COMPONENTS
from reference_flowsheet import flasher
from reference_flash import solve

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "flowsheet-suite.json"
DOC = Path(__file__).resolve().parents[2] / "docs" / "FLOWSHEET_TESTS.md"

# exact unit definitions: 1 psi = 0.45359237 kg x 9.80665 m/s2 / (0.0254 m)2; T(K) = (T(F) - 32) x 5/9 + 273.15
PSI_KPA = 0.45359237 * 9.80665 / 0.0254 ** 2 / 1000


def F_to_K(t):
    return (t - 32) * 5 / 9 + 273.15


# ---------------------------------------------------------------------------------------------------------------
# a sequential evaluator of the flowsheet JSON (flows only: drums are T-P or P-VF)

def parse(fs):
    blocks = {b["id"]: b for b in fs["blocks"]}
    ins, outs = {}, {}
    for s in fs["streams"]:
        fb, fp = s["from"].split(".")
        tb, tp = s["to"].split(".")
        outs.setdefault(fb, {}).setdefault(fp, []).append(s["id"])
        ins.setdefault(tb, []).append(s["id"])
    return blocks, ins, outs


def topo(blocks, fs, cut):
    edges = [(s["from"].split(".")[0], s["to"].split(".")[0]) for s in fs["streams"] if s["id"] not in cut]
    indeg = {b: 0 for b in blocks}
    for _, t in edges:
        indeg[t] += 1
    q = [b for b in blocks if indeg[b] == 0]
    out = []
    while q:
        n = q.pop(0)
        out.append(n)
        for f, t in edges:
            if f == n:
                indeg[t] -= 1
                if indeg[t] == 0:
                    q.append(t)
    if len(out) != len(blocks):
        raise ValueError("the reference tears do not break every cycle")
    return out


def fractions(fr, n):
    known = sum(f for f in fr if f != "rest")
    return [1 - known if f == "rest" else f for f in fr] + [0.0] * (n - len(fr))


class Evaluator:
    def __init__(self, case):
        self.case = case
        self.ids = case["components"]
        self.n = len(self.ids)
        self.fl = flasher(case["model"], self.ids)
        self.blocks, self.ins, self.outs = parse(case["flowsheet"])
        self.tears = case["reference_tears"]
        self.order = topo(self.blocks, case["flowsheet"], set(self.tears))
        self.flashes = 0

    def drum(self, spec, flows):
        Ftot = float(np.sum(flows))
        if Ftot <= 0:
            return None, np.zeros(self.n), np.zeros(self.n)
        z = list(flows / Ftot)
        sp = {"T": spec["T_K"], "P": spec["P_kPa"]} if "T_K" in spec else {"P": spec["P_kPa"], "VF": spec["VF"]}
        T, P, VF, x, y = solve(self.fl, sp, z, None)
        self.flashes += 1
        x = np.asarray(x if x is not None else z)
        y = np.asarray(y if y is not None else z)
        return (T, VF), VF * Ftot * y, (1 - VF) * Ftot * x

    def run(self, tear_flows):
        v = {sid: np.maximum(f, 0.0) for sid, f in zip(self.tears, tear_flows)}
        state = {}
        for bid in self.order:
            b = self.blocks[bid]
            t = b["type"]
            inflow = sum((v[s] for s in self.ins.get(bid, [])), np.zeros(self.n))
            outs = self.outs.get(bid, {})
            if t == "feed":
                res = {"out": [np.asarray(b["spec"]["flow_kmol_h"], dtype=float)]}
            elif t in ("mixer", "heater"):
                res = {"out": [inflow]}
            elif t == "splitter":
                fr = fractions(b["spec"]["fractions"], len(outs["out"]))
                res = {"out": [f * inflow for f in fr]}
            elif t == "separator":
                k = len(outs["out"])
                fr = [fractions(b["spec"]["fractions"][cid], k) for cid in self.ids]
                res = {"out": [np.array([fr[i][j] * inflow[i] for i in range(self.n)]) for j in range(k)]}
            elif t == "flash":
                st, V, L = self.drum(b["spec"], inflow)
                state[bid] = st
                res = {"vapour": [V], "liquid": [L]}
            elif t == "product":
                res = {}
            else:
                raise ValueError(t)
            for port, sids in outs.items():
                for sid, f in zip(sids, res[port]):
                    if sid in self.tears:
                        v["__new__" + sid] = f
                    else:
                        v[sid] = f
        return v, state

    def g(self, x):
        v, _ = self.run(x.reshape(len(self.tears), self.n))
        return np.concatenate([v["__new__" + s] for s in self.tears])

    def solve(self):
        Ftot = sum(float(np.sum(b["spec"]["flow_kmol_h"])) for b in self.blocks.values() if b["type"] == "feed")
        x = np.zeros(len(self.tears) * self.n)
        for _ in range(5):
            x = self.g(x)

        def res(x):
            return self.g(np.maximum(x, 0.0)) - np.maximum(x, 0.0)
        sol = root(res, x0=x, method="hybr", tol=1e-13)
        x = np.maximum(sol.x, 0.0)
        if not np.max(np.abs(res(x))) < 1e-8 * Ftot:
            sol = root(res, x0=x, method="lm", options={"xtol": 1e-15, "ftol": 1e-15, "maxiter": 2000})
            x = np.maximum(sol.x, 0.0)
        r = np.max(np.abs(res(x)))
        if not r < 1e-8 * Ftot:
            raise RuntimeError(f"{self.case['name']}: the reference did not converge ({sol.message}; residual {r:.3e})")
        v, state = self.run(x.reshape(len(self.tears), self.n))
        streams = {s["id"]: list(map(float, v[s["id"]])) for s in self.case["flowsheet"]["streams"]}
        return streams, {k: {"T_K": float(st[0]), "VF": float(st[1])} for k, st in state.items() if st}, float(r / Ftot)


def liquids_at_solution(case, streams):
    """For each drum of an equation-of-state case: how many liquids thermo's FlashVLN (vapour and two liquids, the
    same Peng-Robinson parameters) finds for the drum's inlet at its specification. The reference above is
    vapour-liquid only; where FlashVLN finds two liquids, that reference state is not the stable one and the engine
    must refuse it (two liquids with an equation of state are not supported yet)."""
    if case["model"] not in ("PR", "SRK"):
        return {}
    from thermo import CEOSGas, CEOSLiquid, ChemicalConstantsPackage, FlashVLN, HeatCapacityGas, PRMIX, SRKMIX
    from reference_eos import kmatrix
    ids = case["components"]
    cls = PRMIX if case["model"] == "PR" else SRKMIX
    consts = ChemicalConstantsPackage(Tcs=[COMPONENTS[i]["Tc_K"] for i in ids], Pcs=[COMPONENTS[i]["Pc_Pa"] for i in ids],
                                      omegas=[COMPONENTS[i]["omega"] for i in ids], MWs=[COMPONENTS[i]["MW"] for i in ids],
                                      CASs=[COMPONENTS[i]["cas"] for i in ids])
    cps = [HeatCapacityGas(poly_fit=(50.0, 1500.0, [0, 0, 0, 0, 0, 0, 0, 0, 35.0])) for _ in ids]
    kw = dict(Tcs=consts.Tcs, Pcs=consts.Pcs, omegas=consts.omegas, kijs=kmatrix(case["model"], ids).tolist())
    liq = CEOSLiquid(cls, kw, HeatCapacityGases=cps)
    fl = FlashVLN(consts, None, liquids=[liq, liq], gas=CEOSGas(cls, kw, HeatCapacityGases=cps))
    out = {}
    for b in case["flowsheet"]["blocks"]:
        if b["type"] != "flash":
            continue
        f = sum(np.asarray(streams[s["id"]]) for s in case["flowsheet"]["streams"] if s["to"].split(".")[0] == b["id"])
        z = list(f / f.sum())
        sp = b["spec"]
        r = fl.flash(T=sp["T_K"], P=sp["P_kPa"] * 1000, zs=z) if "T_K" in sp else fl.flash(VF=sp["VF"], P=sp["P_kPa"] * 1000, zs=z)
        out[b["id"]] = len(r.liquids)
    return out


# ---------------------------------------------------------------------------------------------------------------
# 1. the Cavett problem

CAVETT_FILE = Path(__file__).resolve().parents[1] / "data" / "flowsheets" / "cavett_rosen2005.json"
CAVETT = json.loads(CAVETT_FILE.read_text())
CAVETT_IDS = CAVETT["components"]


def cavett():
    """Rosen (2005), Figures 2 and 3 (validation/data/flowsheets/cavett_rosen2005.json). Compressors, valves,
    heaters and coolers only bring each stream to the drum's fixed temperature and pressure, so with T-P drums they
    do not change any flow and are left out."""
    drum = lambda d: {"T_K": F_to_K(CAVETT["drums"][d]["T_F"]), "P_kPa": CAVETT["drums"][d]["P_psia"] * PSI_KPA}
    feed = CAVETT["feed"]
    fs = {
        "blocks": [
            # mol/hr as kmol/h: the flowsheet is homogeneous in the flows, so only their ratios matter
            {"id": "FEED", "type": "feed", "spec": {"flow_kmol_h": feed["flow"], "T_K": F_to_K(feed["T_F"]),
                                                     "P_kPa": feed["P_psia"] * PSI_KPA}},
            {"id": "AD1", "type": "mixer"}, {"id": "AD2", "type": "mixer"},
            {"id": "FL1", "type": "flash", "spec": drum("FL1")},
            {"id": "FL2", "type": "flash", "spec": drum("FL2")},
            {"id": "FL3", "type": "flash", "spec": drum("FL3")},
            {"id": "FL4", "type": "flash", "spec": drum("FL4")},
            {"id": "PR1", "type": "product"}, {"id": "PR2", "type": "product"},
        ],
        "streams": [
            {"id": "F", "from": "FEED.out", "to": "AD1.in"},
            {"id": "Z1", "from": "AD1.out", "to": "FL2.in"},
            {"id": "S1", "from": "FL2.vapour", "to": "FL1.in"},
            {"id": "P1", "from": "FL1.vapour", "to": "PR1.in"},
            {"id": "R1", "from": "FL1.liquid", "to": "AD1.in"},
            {"id": "S2", "from": "FL2.liquid", "to": "AD2.in"},
            {"id": "Z2", "from": "AD2.out", "to": "FL3.in"},
            {"id": "R2", "from": "FL3.vapour", "to": "AD1.in"},
            {"id": "S3", "from": "FL3.liquid", "to": "FL4.in"},
            {"id": "R3", "from": "FL4.vapour", "to": "AD2.in"},
            {"id": "P2", "from": "FL4.liquid", "to": "PR2.in"},
        ],
    }
    # Cavett (1963) and Rosen and Pauls (1977) report slow convergence (propane builds up in all three loops); at
    # Fugacity's tolerance, 1e-8, the solver needs more than its default 50 iterations (docs/FLOWSHEET_TESTS.md)
    fs["solver"] = {"maxIterations": 300}
    return {"name": "Cavett problem", "kind": "cavett", "model": "PR", "components": CAVETT_IDS, "flowsheet": fs,
            "reference_tears": ["R1", "R2", "R3"],
            "published": {**CAVETT["products"], "source": CAVETT["source"]["citation"] + ", " + CAVETT["source"]["open_copy"],
                          "notes": CAVETT["notes"]}}


# ---------------------------------------------------------------------------------------------------------------
# 2. generated flowsheets

# component sets with every pair in the databank (src/data/binaries.json), all miscible liquids
ACTIVITY_POOLS = {
    "NRTL": [["acetone", "benzene", "chloroform", "ethanol", "methanol", "toluene"],
             ["benzene", "ethanol", "methanol", "p-xylene", "toluene"],
             ["acetonitrile", "ethanol", "methanol", "p-xylene", "toluene"],
             ["acetone", "ethanol", "methanol", "water"]],
    "UNIQUAC": [["acetone", "benzene", "chloroform", "ethanol", "methanol", "toluene"],
                ["benzene", "ethanol", "methanol", "p-xylene", "toluene"]],
}
EOS_POOL = CAVETT_IDS


def pick_components(rng, model, k):
    if model == "PR":
        # at least one light (gas) and one heavy (liquid) component, so that every drum has two phases
        # (carbon dioxide has no normal boiling point: it sublimes; it counts as light)
        light = [c for c in EOS_POOL if (COMPONENTS[c]["Tb_K"] or 0) < 273.15]
        heavy = [c for c in EOS_POOL if (COMPONENTS[c]["Tb_K"] or 0) >= 273.15]
        ids = [rng.choice(light), rng.choice(heavy)]
        rest = [c for c in EOS_POOL if c not in ids]
        ids += list(rng.choice(rest, size=k - 2, replace=False))
    else:
        pools = [p for p in ACTIVITY_POOLS[model] if len(p) >= k]
        pool = pools[rng.integers(len(pools))]
        ids = list(rng.choice(pool, size=k, replace=False))
    return sorted(ids, key=lambda c: COMPONENTS[c]["Tb_K"] or 0)   # light to heavy


def two_phase_T(fl, z, P, vf):
    """(T, P) at which the fresh feed is vf vapour (P-VF flash). Above the mixture's cricondenbar there is no such T:
    the pressure is lowered by 30 % until there is (a gas-rich feed at a high drawn pressure)."""
    for _ in range(8):
        try:
            return float(np.round(fl.flash(VF=vf, P=P * 1000, zs=z).T, 2)), P
        except Exception:
            P = float(np.round(0.7 * P, 0 if P > 500 else 1))
    raise RuntimeError("no two-phase temperature for this feed")


def layout_two_drums(c):
    """Feed, mixer, drum 1 (P-VF); its vapour is partly condensed in drum 2 (T-P), whose liquid returns (R1) and
    whose vapour is split: part recycled (R2), the rest a product."""
    return {
        "blocks": [
            {"id": "F1", "type": "feed", "spec": {"flow_kmol_h": c["feed"], "T_K": 300.0, "P_kPa": c["P"][0]}},
            {"id": "M1", "type": "mixer"},
            {"id": "V1", "type": "flash", "spec": {"P_kPa": c["P"][0], "VF": c["VF"][0]}},
            {"id": "V2", "type": "flash", "spec": {"T_K": c["T"][1], "P_kPa": c["P"][1]}},
            {"id": "SP1", "type": "splitter", "spec": {"fractions": [c["r"][0], "rest"]}},
            {"id": "LIQ", "type": "product"}, {"id": "GAS", "type": "product"},
        ],
        "streams": [
            {"id": "S1", "from": "F1.out", "to": "M1.in"},
            {"id": "S2", "from": "M1.out", "to": "V1.in"},
            {"id": "S3", "from": "V1.liquid", "to": "LIQ.in"},
            {"id": "S4", "from": "V1.vapour", "to": "V2.in"},
            {"id": "R1", "from": "V2.liquid", "to": "M1.in"},
            {"id": "S5", "from": "V2.vapour", "to": "SP1.in"},
            {"id": "R2", "from": "SP1.out", "to": "M1.in"},
            {"id": "S6", "from": "SP1.out", "to": "GAS.in"},
        ]}, ["R1", "R2"]


def layout_three_drums(c):
    """Cavett-like: drum 1 (T-P), its vapour to drum 2 (T-P) whose liquid returns (R1); drum 1's liquid to a second
    mixer and drum 3 (P-VF), whose vapour returns to the first mixer (R2) and whose liquid is split: part back to
    the second mixer (R3), the rest a product."""
    return {
        "blocks": [
            {"id": "F1", "type": "feed", "spec": {"flow_kmol_h": c["feed"], "T_K": 300.0, "P_kPa": c["P"][0]}},
            {"id": "M1", "type": "mixer"}, {"id": "M2", "type": "mixer"},
            {"id": "V1", "type": "flash", "spec": {"T_K": c["T"][0], "P_kPa": c["P"][0]}},
            {"id": "V2", "type": "flash", "spec": {"T_K": c["T"][1], "P_kPa": c["P"][1]}},
            {"id": "V3", "type": "flash", "spec": {"P_kPa": c["P"][2], "VF": c["VF"][2]}},
            {"id": "SP1", "type": "splitter", "spec": {"fractions": [c["r"][0], "rest"]}},
            {"id": "GAS", "type": "product"}, {"id": "LIQ", "type": "product"},
        ],
        "streams": [
            {"id": "S1", "from": "F1.out", "to": "M1.in"},
            {"id": "S2", "from": "M1.out", "to": "V1.in"},
            {"id": "S3", "from": "V1.vapour", "to": "V2.in"},
            {"id": "S4", "from": "V2.vapour", "to": "GAS.in"},
            {"id": "R1", "from": "V2.liquid", "to": "M1.in"},
            {"id": "S5", "from": "V1.liquid", "to": "M2.in"},
            {"id": "S6", "from": "M2.out", "to": "V3.in"},
            {"id": "R2", "from": "V3.vapour", "to": "M1.in"},
            {"id": "S7", "from": "V3.liquid", "to": "SP1.in"},
            {"id": "R3", "from": "SP1.out", "to": "M2.in"},
            {"id": "S8", "from": "SP1.out", "to": "LIQ.in"},
        ]}, ["R1", "R2", "R3"]


def layout_separator(c):
    """A component separator splits the mixed feed (light components mostly to its first outlet); the first outlet
    goes to drum 1 (P-VF) whose liquid returns (R1); the second to a mixer and drum 2 (P-VF) whose vapour is split
    three ways: back to its own mixer (R2), back to the first mixer (R3), and a product."""
    return {
        "blocks": [
            {"id": "F1", "type": "feed", "spec": {"flow_kmol_h": c["feed"], "T_K": 300.0, "P_kPa": c["P"][0]}},
            {"id": "M1", "type": "mixer"}, {"id": "M2", "type": "mixer"},
            {"id": "X1", "type": "separator", "spec": {"fractions": {cid: [a, "rest"] for cid, a in zip(c["ids"], c["a"])}}},
            {"id": "V1", "type": "flash", "spec": {"P_kPa": c["P"][0], "VF": c["VF"][0]}},
            {"id": "V2", "type": "flash", "spec": {"P_kPa": c["P"][1], "VF": c["VF"][1]}},
            {"id": "SP1", "type": "splitter", "spec": {"fractions": [c["r"][0], c["r"][1], "rest"]}},
            {"id": "TOP", "type": "product"}, {"id": "BOT", "type": "product"}, {"id": "VENT", "type": "product"},
        ],
        "streams": [
            {"id": "S1", "from": "F1.out", "to": "M1.in"},
            {"id": "S2", "from": "M1.out", "to": "X1.in"},
            {"id": "S3", "from": "X1.out", "to": "V1.in"},
            {"id": "S4", "from": "X1.out", "to": "M2.in"},
            {"id": "S5", "from": "V1.vapour", "to": "TOP.in"},
            {"id": "R1", "from": "V1.liquid", "to": "M1.in"},
            {"id": "S6", "from": "M2.out", "to": "V2.in"},
            {"id": "S7", "from": "V2.liquid", "to": "BOT.in"},
            {"id": "S8", "from": "V2.vapour", "to": "SP1.in"},
            {"id": "R2", "from": "SP1.out", "to": "M2.in"},
            {"id": "R3", "from": "SP1.out", "to": "M1.in"},
            {"id": "S9", "from": "SP1.out", "to": "VENT.in"},
        ]}, ["R1", "R2", "R3"]


def layout_bypass(c):
    """Part of the feed bypasses drum 1: a splitter sends it to the second mixer. The rest is mixed with two
    recycles, heated (the heater's T-P outlet changes no flow) and flashed in drum 1 (P-VF); drum 1's liquid joins
    the bypass in drum 2 (P-VF), whose vapour returns (R1) and whose liquid is split: part back (R2), the rest a
    product."""
    return {
        "blocks": [
            {"id": "F1", "type": "feed", "spec": {"flow_kmol_h": c["feed"], "T_K": 300.0, "P_kPa": c["P"][0]}},
            {"id": "SP0", "type": "splitter", "spec": {"fractions": [c["b"], "rest"]}},
            {"id": "M1", "type": "mixer"}, {"id": "M2", "type": "mixer"},
            {"id": "H1", "type": "heater", "spec": {"T_K": c["T"][0], "P_kPa": c["P"][0]}},
            {"id": "V1", "type": "flash", "spec": {"P_kPa": c["P"][0], "VF": c["VF"][0]}},
            {"id": "V2", "type": "flash", "spec": {"P_kPa": c["P"][1], "VF": c["VF"][1]}},
            {"id": "SP1", "type": "splitter", "spec": {"fractions": [c["r"][0], "rest"]}},
            {"id": "GAS", "type": "product"}, {"id": "LIQ", "type": "product"},
        ],
        "streams": [
            {"id": "S1", "from": "F1.out", "to": "SP0.in"},
            {"id": "B1", "from": "SP0.out", "to": "M2.in"},
            {"id": "S2", "from": "SP0.out", "to": "M1.in"},
            {"id": "S3", "from": "M1.out", "to": "H1.in"},
            {"id": "S4", "from": "H1.out", "to": "V1.in"},
            {"id": "S5", "from": "V1.vapour", "to": "GAS.in"},
            {"id": "S6", "from": "V1.liquid", "to": "M2.in"},
            {"id": "S7", "from": "M2.out", "to": "V2.in"},
            {"id": "R1", "from": "V2.vapour", "to": "M1.in"},
            {"id": "S8", "from": "V2.liquid", "to": "SP1.in"},
            {"id": "R2", "from": "SP1.out", "to": "M1.in"},
            {"id": "S9", "from": "SP1.out", "to": "LIQ.in"},
        ]}, ["R1", "R2"]


LAYOUTS = {"two drums": layout_two_drums, "three drums": layout_three_drums, "separator": layout_separator,
           "bypass": layout_bypass}
# model and number of components per layout: 3 to 7 components, every layout with each model family
PLAN = [("two drums", "PR", 3), ("two drums", "NRTL", 4), ("two drums", "PR", 6), ("two drums", "UNIQUAC", 5),
        ("three drums", "PR", 4), ("three drums", "NRTL", 3), ("three drums", "PR", 7), ("three drums", "UNIQUAC", 6),
        ("separator", "PR", 5), ("separator", "NRTL", 5), ("separator", "PR", 7), ("separator", "UNIQUAC", 3),
        ("bypass", "PR", 6), ("bypass", "NRTL", 6), ("bypass", "PR", 3), ("bypass", "UNIQUAC", 4)]
SEED = 20261008


def generated(rng):
    out = []
    for k, (layout, model, n) in enumerate(PLAN):
        ids = pick_components(rng, model, n)
        fl = flasher(model, ids)
        feed = [float(v) for v in np.round(rng.uniform(5, 50, n), 2)]
        z = list(np.asarray(feed) / sum(feed))
        # pressures: around 1 atm for the liquids, 0.5 to 5 MPa for the hydrocarbons and gases
        P = [float(np.round(rng.uniform(80, 200), 1)) if model != "PR" else float(np.round(rng.uniform(500, 5000), 0))
             for _ in range(3)]
        VF = [float(np.round(rng.uniform(0.2, 0.8), 3)) for _ in range(3)]
        # T-P drums: a temperature at which the fresh feed is partly vapour at that pressure (40 % vapour; drum 2 of
        # "two drums" and "three drums" 25 %, to condense)
        T = []
        for j in range(3):
            Tj, P[j] = two_phase_T(fl, z, P[j], 0.4 if j == 0 else 0.25)
            T.append(Tj)
        c = {"ids": ids, "feed": feed, "P": P, "VF": VF, "T": T,
             "r": [float(np.round(rng.uniform(0.2, 0.6), 3)), float(np.round(rng.uniform(0.1, 0.3), 3))],
             "b": float(np.round(rng.uniform(0.1, 0.4), 3)),
             # separator: light components mostly to the first outlet
             "a": [float(np.round(0.9 - 0.8 * i / max(1, n - 1), 3)) for i in range(n)]}
        fs, tears = LAYOUTS[layout](c)
        out.append({"name": f"G{k + 1:02d} {layout}, {model}, {n} components", "kind": "generated", "layout": layout,
                    "model": model, "components": ids, "flowsheet": fs, "reference_tears": tears})
    return out


def write_doc(cases):
    cav = cases[0]
    ids, P1, P2, pub = cav["components"], cav["streams_kmol_h"]["P1"], cav["streams_kmol_h"]["P2"], cav["published"]
    name = {c: COMPONENTS[c]["name"] for c in ids}
    L = ["# Flowsheet test suite", "",
         "Generated by `validation/python/reference_flowsheet_suite.py`; checked by `test/flowsheet-suite.test.js`.", "",
         "How do we know the flowsheet solver is right? Three kinds of test, the way simulators are usually checked:", "",
         "1. **A published benchmark with known answers:** the Cavett problem (Cavett 1963), the classic test of "
         "tearing, ordering and recycle convergence. 16 components, four flash drums at fixed temperature and pressure, "
         "three recycle loops that share streams. Specification and two published solutions: Rosen, *VMGSim: Revisiting "
         "the Cavett Problem*, CACHE News, Fall 2005 (free to read: "
         "[cache.org](https://cache.org/sites/default/files/fall2005_rosen_cavett.pdf)), Figures 2 and 3; transcribed in "
         "`validation/data/flowsheets/cavett_rosen2005.json`.",
         "2. **Many generated flowsheets against an independent solution:** four layouts (two drums with two recycles, "
         "three drums with three recycles across pressures, a component separator with nested recycles, a bypass with a "
         "heater), each with Peng-Robinson, NRTL and UNIQUAC component sets of 3 to 7 components, feeds and drum "
         "conditions drawn by a seeded random generator (seed %d). Every generated case is kept. The reference solves "
         "each flowsheet **equation-oriented**: the component flows of hand-chosen tear streams (the recycles, as Rosen "
         "and Pauls tore Cavett's problem) are the unknowns of g(x) - x = 0, solved by scipy's hybrid Powell method, "
         "with the flash of the open-source `thermo` library (FlashVL, same parameters). The engine solves the same "
         "JSON **sequential-modular**: its own tear streams (the smallest set), direct substitution and Wegstein, its "
         "own flash. Different algorithm, different tears, different flash: agreement to 2e-5 of the feed in every "
         "stream is not a coincidence." % SEED,
         "3. **Relations every correct solver must satisfy** (metamorphic tests), for every case: the same answer with "
         "the reference's tear streams, with direct substitution instead of Wegstein, and with the components and "
         "blocks listed in reverse order; ten times the feed gives ten times every flow; every block and the whole "
         "flowsheet close their component balances to 1e-7.", "",
         "## The Cavett problem", "",
         "Peng-Robinson with the databank's k_ij (ChemSep). Flows as printed (mol/hr); the flowsheet is homogeneous in "
         "the flows, so the units do not matter. The engine agrees with the reference below to better than 2e-5 of the "
         "feed (test). The tolerance against VMGSim, set before the comparison: 10 %% for every component above 1 %% of "
         "its product stream (a different program and a different Peng-Robinson, VMGSim's \"advanced\" variant with its "
         "own k_ij).", "",
         "| Component | Feed | P1, Fugacity | P1, VMGSim APR | P1, FLOWTRAN | P2, Fugacity | P2, VMGSim APR | P2, FLOWTRAN |",
         "|---|---|---|---|---|---|---|---|"]
    feed = CAVETT["feed"]["flow"]
    for i, c in enumerate(ids):
        L.append("| %s | %g | %.2f | %g | %g | %.2f | %g | %g |" % (name[c], feed[i], P1[i], pub["P1"]["VMGSim APR"][i],
                                                                pub["P1"]["FLOWTRAN"][i], P2[i], pub["P2"]["VMGSim APR"][i],
                                                                pub["P2"]["FLOWTRAN"][i]))
    L.append("| **Total** | %.1f | %.1f | %.1f | %.1f | %.1f | %.1f | %.1f |" % (
        sum(feed), sum(P1), sum(pub["P1"]["VMGSim APR"]), sum(pub["P1"]["FLOWTRAN"]), sum(P2), sum(pub["P2"]["VMGSim APR"]),
        sum(pub["P2"]["FLOWTRAN"])))
    L += ["", pub["notes"], "",
          "Drums: " + "; ".join("%s %.2f K, vapour fraction %.4f" % (k, d["T_K"], d["VF"]) for k, d in cav["drums"].items()) + ".",
          "", "Cavett (1963) and Rosen and Pauls (1977) found this problem slow to converge (propane builds up in all three "
          "loops). At Fugacity's tolerance (1e-8, relative) the solver needs about 170 Wegstein iterations with its own "
          "tear streams (91 with R1, R2, R3 torn), more than the default 50: the case sets `maxIterations: 300`, which "
          "the workbench allows (up to 1000). A faster tear method (quasi-Newton, Broyden) is a possible improvement.", "",
          "## Generated flowsheets", "",
          "| Case | Components | Recycles (reference tears) | Drums: vapour fraction at the solution | Liquids (thermo FlashVLN) |",
          "|---|---|---|---|---|"]
    for c in cases[1:]:
        L.append("| %s | %s | %s | %s | %s |" % (c["name"], ", ".join(COMPONENTS[i]["name"] for i in c["components"]),
                                               ", ".join(c["reference_tears"]),
                                               ", ".join("%s %.3f" % (k, d["VF"]) for k, d in c["drums"].items()),
                                               ", ".join("%s %s" % (k, d["liquids_vln"]) for k, d in c["drums"].items()
                                                         if "liquids_vln" in d) or "not checked (activity model)"))
    L += ["", "## What the suite found, and what changed", "",
          "Run first against the engine before this change, the suite stopped on 8 of the 16 generated cases (G01, G03, G08, "
          "G09, G12, G13, G14, G15) and on Cavett. Each "
          "stop was traced:", "",
          "- **P-H flash stepping out of a correlation's range** (mixers with benzene or p-xylene: the temperature "
          "search stepped below the liquid heat capacity's lower limit, the melting point, and threw instead of "
          "stepping back). Fixed: the bracket search halves its step at a range limit.",
          "- **A last-digit change of sign** between two evaluations of the same temperature in the P-H search (an "
          "iterative flash with a warm start) left Brent's method without a bracket. Fixed: an end within 1e-6 J/mol of "
          "the target is the root, and the first evaluation is reused.",
          "- **Peng-Robinson P-VF flash without a single-liquid bubble point** (nitrogen or CO2 with heavier "
          "hydrocarbons at 1-4 MPa: at the bubble point the liquid splits in two, or there is none). The vapour + "
          "liquid state at the specified vapour fraction exists; it is now found from the dew point down, and its liquid "
          "is checked for a second liquid.",
          "- **Peng-Robinson P-H flash starting from such a bubble point** (K-values near 1, successive substitution "
          "stalls). It now falls back to the search from 300 K, with its own warm start. Successive substitution is "
          "also accelerated (GDEM) after 50 slow steps.",
          "- **Two liquids that the engine correctly refuses** (case G01, drum V2: nitrogen + methane + n-pentane at "
          "112 K and 2 MPa). thermo's three-phase flash (FlashVLN) confirms two liquids at the reference solution: the "
          "vapour-liquid reference is not the stable state there. The test requires the engine to refuse it with a "
          "PHASE_SPLIT error naming the drum (two liquids with an equation of state are not supported yet). The error "
          "used to read as a convergence failure; it now keeps its PHASE_SPLIT code.",
          "- **Two liquids in the first pass only** (case G15: with the recycles still empty, drum V2 sees the fresh "
          "feed, whose state at the specified vapour fraction has two liquids; the converged loop does not). The "
          "engine refuses that first pass and now says so, suggesting a guess for the tear streams; with a rough guess "
          "(a fifth of the reference's recycle flows) it converges to the reference. The test checks both.",
          "- **Cavett's slow convergence**, above.", "",
          "Activity-model cases (NRTL, UNIQUAC) passed from the start once the P-H fix was in.", ""]
    DOC.write_text("\n".join(L))


def main():
    warnings.simplefilter("ignore", RuntimeWarning)
    rng = np.random.default_rng(SEED)
    cases = [cavett()] + generated(rng)
    for c in cases:
        t0 = time.time()
        ev = Evaluator(c)
        c["streams_kmol_h"], c["drums"], c["residual"] = ev.solve()
        for d, n in liquids_at_solution(c, c["streams_kmol_h"]).items():
            c["drums"][d]["liquids_vln"] = n
        print(f"{c['name']:48s} {', '.join(c['components'])[:70]:70s} drums VF "
              f"{' '.join('%.3f' % d['VF'] for d in c['drums'].values())}  liquids (VLN) "
              f"{' '.join(str(d.get('liquids_vln', '-')) for d in c['drums'].values())}  {ev.flashes} flashes {time.time() - t0:.0f} s")
    OUT.write_text(json.dumps({
        "_about": "Recycle flowsheets solved equation-oriented (scipy root on the flows of the reference_tears) with "
                  "the independent flash of reference_flash.py; validation/python/reference_flowsheet_suite.py "
                  "(seed %d). docs/FLOWSHEET_TESTS.md explains the suite. Do not edit by hand." % SEED,
        "cases": cases}, indent=1) + "\n")
    write_doc(cases)
    print(f"wrote {len(cases)} cases to {OUT} and {DOC}")


if __name__ == "__main__":
    main()
