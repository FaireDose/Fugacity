"""
Write reference results from the independent Python model to validation/fixtures/.
The JavaScript tests (test/*.test.js) compare against these files.

    python validation/python/make_fixtures.py
"""
import json
from pathlib import Path

from reference_model import System

OUT = Path(__file__).resolve().parents[1] / "fixtures"
OUT.mkdir(exist_ok=True)
import itertools

P = 101.325
TERNARIES = [["water", "acetic-acid", "ethylene-glycol"],
             ["methanol", "acetone", "chloroform"],
             ["ethanol", "water", "ethylene-glycol"]]
BINARIES = sorted({tuple(sorted(p)) for t in TERNARIES for p in itertools.combinations(t, 2)})

cases = []
for model in ["NRTL", "UNIQUAC"]:
    for ids in TERNARIES:
        s = System(ids, model)
        n = 8
        for i in range(n + 1):
            for j in range(n + 1 - i):
                x = [i / n, j / n, (n - i - j) / n]
                T, y = s.bubble_t(x, P)
                cases.append({"model": model, "components": ids, "P_kPa": P, "x": x, "T_K": T, "y": list(y)})
    for pair in BINARIES:
        pair = list(pair)
        s2 = System(pair, model)
        for k in range(11):
            x = [k / 10, 1 - k / 10]
            T, y = s2.bubble_t(x, P)
            cases.append({"model": model, "components": pair, "P_kPa": P, "x": x, "T_K": T, "y": list(y)})

(OUT / "bubble_T_101kPa.json").write_text(json.dumps({
    "_about": "Bubble-point temperatures from validation/python/reference_model.py (independent implementation).",
    "cases": cases}, indent=1))
print(f"wrote {len(cases)} cases")
