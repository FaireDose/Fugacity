"""Add NRTL and UNIQUAC parameters from the ChemSep databank (Artistic License 2.0, as shipped
with the open-source thermo library) for pairs that have no open experimental data to fit
(proposal 0004, step 3). Pairs that already have a set of that model are left alone.

    python validation/python/chemsep_pairs.py            # print, no changes
    python validation/python/chemsep_pairs.py --write    # add to src/data/binaries.json

Then run make_sources.py (it names the sets "chemsep" and adds their source_ids).

Each entry of PAIRS lists where open data was searched; the reason is kept in the pair's
"data_wanted" so the interface and docs/DATA_WANTED.md can show it.
"""
import json
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
from thermo.interaction_parameters import IPDB  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BIN_FILE = ROOT / "src" / "data" / "binaries.json"
COMPONENTS = json.loads((ROOT / "src" / "data" / "components.json").read_text())["components"]

PAIRS = [
    dict(pair=("ethanol", "cyclohexane"),
         wanted="open binary vapour-liquid data (isobaric T-x-y near 101.3 kPa or isothermal P-x-y) and liquid-liquid or miscibility data below 323 K. Searched: NIST TRC ThermoML Archive (ternary sets with water only: Gomis et al., Fluid Phase Equilib. 235 (2005) 7; Antosik et al., J. Chem. Eng. Data 49 (2004) 7; Cui et al., J. Chem. Eng. Data 49 (2004) 212), Crossref, open repositories. Open checks: the 1-atm azeotrope (64.9 degC, 69.5 wt % cyclohexane; validation/data/ethanol_cyclohexane_azeotrope_101kPa.json) and the excess enthalpy at 323.15 K, one liquid over the whole range (Lien et al., J. Chem. Eng. Data 48 (2003) 359; validation/data/ethanol_cyclohexane_HE_lien2003.json). A fit to these two alone predicts two liquids at 323 K, against the second; NRTL: the databank set passes both checks but predicts two liquids below about 315 K, not checked against data; UNIQUAC: the databank set predicts two liquids at 323-338 K (src/data/known-issues.json)"),
]


def cas(cid):
    return COMPONENTS[cid]["cas"]


def record(model, i, j, wanted):
    table = "ChemSep NRTL" if model == "NRTL" else "ChemSep UNIQUAC"
    ci, cj = cas(i), cas(j)
    b_ij = IPDB.get_ip_specific(table, [ci, cj], "bij")
    b_ji = IPDB.get_ip_specific(table, [cj, ci], "bij")
    if b_ij == 0 and b_ji == 0:
        raise SystemExit(f"{model} {i} + {j}: not in the ChemSep databank")
    rec = {"model": model, "i": i, "j": j, "a_ij": 0.0, "a_ji": 0.0, "b_ij": float(b_ij), "b_ji": float(b_ji)}
    if model == "NRTL":
        rec["alpha"] = float(IPDB.get_ip_specific(table, [ci, cj], "alphaij"))
    rec["source"] = f"ChemSep {model} databank (via the open-source thermo library)."
    rec["tier"] = "databank"
    rec["data_wanted"] = wanted
    return rec


def main(write):
    doc = json.loads(BIN_FILE.read_text())
    for p in PAIRS:
        i, j = p["pair"]
        for model in ("NRTL", "UNIQUAC"):
            if any(r["model"] == model and {r["i"], r["j"]} == {i, j} for r in doc["pairs"]):
                print(f"{model} {i} + {j}: already has a set, left alone")
                continue
            rec = record(model, i, j, p["wanted"])
            print({k: v for k, v in rec.items() if k not in ("source", "data_wanted")})
            doc["pairs"].append(rec)
    if write:
        BIN_FILE.write_text(json.dumps(doc, indent=2) + "\n")
        print(f"updated {BIN_FILE}")


if __name__ == "__main__":
    main("--write" in sys.argv)
