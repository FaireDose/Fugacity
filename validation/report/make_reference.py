"""
Reference values for the engineering report (validation/report/cases.json).

    python validation/report/make_reference.py        # writes validation/report/reference/*.json

Every value comes from a source independent of Fugacity's JavaScript code:

- CoolProp 8.0.0 (open source, MIT), HEOS backend: IAPWS-95 for water and the reference
  equations of state of the other fluids, with the transport models CoolProp cites for
  each fluid (the BibTeX key of every equation is written next to each value). Mixtures:
  CoolProp's multi-fluid (GERG-2008 type) model with the binary parameters it cites.
  Bell, Wronski, Quoilin, Lemort, Ind. Eng. Chem. Res. 53 (2014) 2498-2508,
  doi:10.1021/ie4033999; documentation and sources: http://www.coolprop.org
- NIST Chemistry WebBook (SRD 69), spot values transcribed below from pages opened while
  this file was written (normal boiling points: "Tboil", method AVG; liquid heat capacity:
  table "Constant pressure heat capacity of liquid", the most recent row at 298.15 K).
- Experimental and handbook data already cited in validation/data/ (azeotropes, water +
  ethylene glycol T-x-y, Schmid et al. 2007 P-x).

A case without an open reference gets {"value": null, "why": ...}: the report then shows
"no reference" for it instead of a number from memory.

Units are the display units encoded in each quantity key (T_C in degC, P_bar, P_kPa,
rho_kg_m3, cp_kJ_kgK, dHvap_kJ_kg, h_kJ_kg, s_kJ_kgK, mu_mPa_s, k_W_mK, mole fractions).
Steam enthalpy and entropy use the IAPWS-95 convention (u = s = 0 for the saturated
liquid at the triple point), which is CoolProp's default for water.
"""
import json
import math
from pathlib import Path

import CoolProp
import CoolProp.CoolProp as CP

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "reference"
OUT.mkdir(exist_ok=True)

cases = json.loads((HERE / "cases.json").read_text())
components = json.loads((ROOT / "src/data/components.json").read_text())["components"]
azeo = json.loads((ROOT / "validation/data/azeotropes_101kPa.json").read_text())
weg = json.loads((ROOT / "validation/data/water_ethylene_glycol_760mmHg.json").read_text())
sch = json.loads((ROOT / "validation/data/schmid2007_acetic_acid_ethylene_glycol.json").read_text())
etw = json.loads((ROOT / "validation/data/ethanol_water_101kPa.json").read_text())
weh = json.loads((ROOT / "validation/data/water_ethanol_HE_fang2014.json").read_text())
flashref = json.loads((ROOT / "validation/fixtures/flash.json").read_text())["cases"]

COOLPROP = {"water": "Water", "methanol": "Methanol", "ethanol": "Ethanol", "acetone": "Acetone",
            "benzene": "Benzene", "toluene": "Toluene", "oxygen": "Oxygen", "nitrogen": "Nitrogen",
            "hydrogen": "Hydrogen", "methane": "Methane", "ethane": "Ethane", "ethylene": "Ethylene"}

WEBBOOK_URL = "https://webbook.nist.gov/cgi/cbook.cgi?ID=C{cas}&Units=SI&Mask={mask}"
# NIST Chemistry WebBook, transcribed from the pages (opened 2026-10-01).
WEBBOOK_TB = {  # Tboil, K: value, uncertainty, comment as printed
    "acetic-acid": (391.2, 0.6, "AVG, average of 80 out of 90 values"),
    "ethylene-glycol": (470.5, 0.5, "AVG, average of 27 out of 31 values"),
    "chloroform": (334.3, 0.2, "AVG, average of 36 out of 37 values"),
    "ethyl-acetate": (350.2, 0.2, "AVG, average of 58 out of 72 values"),
}
WEBBOOK_CPL = {  # Cp,liquid at 298.15 K, J/(mol K): value, reference as printed
    "acetic-acid": (123.1, "Martin and Andon, 1982"),
    "ethylene-glycol": (149.6, "Murthy and Subrahmanyam, 1977"),
    "chloroform": (114.25, "Grolier, Roux-Desgranges, et al., 1993"),
    "ethyl-acetate": (168.94, "Pintos, Bravo, et al., 1988"),
}

SOURCES = {
    "coolprop": {
        "citation": f"CoolProp {CoolProp.__version__}, HEOS backend (reference equations of state; IAPWS-95 for water). "
                    "Bell, Wronski, Quoilin, Lemort, Ind. Eng. Chem. Res. 53 (2014) 2498",
        "doi": "10.1021/ie4033999",
        "url": "http://www.coolprop.org",
        "access": "Open source (MIT license); every equation is cited in the CoolProp documentation",
    },
    "coolprop-mixture": {
        "citation": f"CoolProp {CoolProp.__version__}, HEOS multi-fluid mixture model (GERG-2008 form, Kunz and Wagner, "
                    "J. Chem. Eng. Data 57 (2012) 3032) with the binary parameters CoolProp cites per pair",
        "url": "http://www.coolprop.org/fluid_properties/Mixtures.html",
        "access": "Open source (MIT license)",
    },
    "nist-webbook": {
        "citation": "NIST Chemistry WebBook, NIST Standard Reference Database 69, phase-change data (Tboil) and "
                    "condensed-phase thermochemistry (Cp,liquid)",
        "url": "https://webbook.nist.gov/chemistry/",
        "access": "Free public access (US government work)",
    },
    "azeotrope-tables": azeo["source"],
    "water-eg-760mmHg": weg["source"],
    "schmid2007": sch["source"],
    "kamihama2012": etw["source"],
    "fang2014": weh["source"],
    "thermo-flash": {"citation": "thermo library (Caleb Bell), FlashVL with the same parameters; enthalpy flashes with the independent enthalpies of validation/python/reference_enthalpy.py (validation/python/reference_flash.py)",
                     "url": "https://github.com/CalebBell/thermo", "access": "Open source (MIT license)"},
}


def none(why):
    return {"value": None, "why": why}


def val(v, source, detail):
    return {"value": float(v), "source": source, "detail": detail}


def cp_detail(f, what=("EOS",)):
    keys = []
    for w in what:
        try:
            keys.append(f"{w.lower()} {CP.get_BibTeXKey(f, w)}")
        except Exception:
            pass
    return f"CoolProp {f}: " + "; ".join(keys)


# ---------------------------------------------------------------- pure components
def pure_ref(c, prop, T, P_kPa, state):
    """Reference for one pure-component property, display units."""
    if prop == "vapourPressure":
        if c in COOLPROP:
            f = COOLPROP[c]
            return val(CP.PropsSI("P", "T", T, "Q", 0, f) / 1000, "coolprop", cp_detail(f) + "; saturated liquid")
        return none("No open reference equation for this component in CoolProp; NIST WebBook vapour-pressure "
                    "data not transcribed for this report yet")
    if prop == "idealGasHeatCapacity":
        if c in COOLPROP:
            f = COOLPROP[c]
            return val(CP.PropsSI("CP0MASS", "T", T, "Dmass", 1e-6, f) / 1000, "coolprop", cp_detail(f))
        return none("Not in CoolProp; no open ideal-gas heat capacity transcribed for this report")
    if prop == "liquidHeatCapacity" and c in WEBBOOK_CPL and abs(T - 298.15) < 1e-9:
        v, ref = WEBBOOK_CPL[c]
        MW = components[c]["MW"]
        return val(v / MW, "nist-webbook",
                   f"Cp,liquid = {v} J/(mol K) at 298.15 K ({ref}), "
                   f"{WEBBOOK_URL.format(cas=components[c]['cas'].replace('-', ''), mask=2)}; "
                   f"converted with M = {MW} g/mol from src/data/components.json")
    if c not in COOLPROP:
        return none("Not in CoolProp; no open reference value transcribed for this report")
    f = COOLPROP[c]
    sat = state == "saturated liquid"
    inputs = ("T", T, "Q", 0) if sat else ("T", T, "P", P_kPa * 1000)
    where = "saturated liquid" if sat else f"{P_kPa:g} kPa"
    try:
        if prop == "liquidDensity":
            return val(CP.PropsSI("Dmass", *inputs, f), "coolprop", cp_detail(f) + f"; {where}")
        if prop == "density":
            phase = CP.PhaseSI("T", T, "P", P_kPa * 1000, f)
            return val(CP.PropsSI("Dmass", "T", T, "P", P_kPa * 1000, f), "coolprop", cp_detail(f) + f"; phase {phase}")
        if prop == "liquidHeatCapacity":
            return val(CP.PropsSI("Cpmass", *inputs, f) / 1000, "coolprop", cp_detail(f) + f"; {where}")
        if prop == "heatOfVaporization":
            dh = CP.PropsSI("Hmass", "T", T, "Q", 1, f) - CP.PropsSI("Hmass", "T", T, "Q", 0, f)
            return val(dh / 1000, "coolprop", cp_detail(f) + "; h(vapour) - h(liquid) at saturation")
        if prop == "liquidViscosity":
            return val(CP.PropsSI("V", *inputs, f) * 1000, "coolprop", cp_detail(f, ("EOS", "VISCOSITY")) + f"; {where}")
        if prop == "liquidThermalConductivity":
            return val(CP.PropsSI("L", *inputs, f), "coolprop", cp_detail(f, ("EOS", "CONDUCTIVITY")) + f"; {where}")
    except ValueError as e:
        msg = str(e)
        if "not available" in msg:
            return none(f"CoolProp has no {'viscosity' if 'Viscosity' in msg else 'thermal conductivity'} model for {f}")
        raise
    raise KeyError(prop)


# ---------------------------------------------------------------- steam (IAPWS-95)
def steam_state(T, P_kPa, key):
    f, P = "Water", P_kPa * 1000
    d = cp_detail(f) + " (IAPWS-95)"
    if key == "rho_kg_m3":
        return val(CP.PropsSI("Dmass", "T", T, "P", P, f), "coolprop", d)
    if key == "h_kJ_kg":
        return val(CP.PropsSI("Hmass", "T", T, "P", P, f) / 1000, "coolprop", d)
    if key == "s_kJ_kgK":
        return val(CP.PropsSI("Smass", "T", T, "P", P, f) / 1000, "coolprop", d)
    if key == "cp_kJ_kgK":
        return val(CP.PropsSI("Cpmass", "T", T, "P", P, f) / 1000, "coolprop", d)
    if key == "mu_mPa_s":
        return val(CP.PropsSI("V", "T", T, "P", P, f) * 1000, "coolprop", cp_detail(f, ("VISCOSITY",)))
    if key == "k_W_mK":
        return val(CP.PropsSI("L", "T", T, "P", P, f), "coolprop", cp_detail(f, ("CONDUCTIVITY",)))
    raise KeyError(key)


def steam_sat(T, key):
    f = "Water"
    d = cp_detail(f) + " (IAPWS-95), saturation"
    hL = CP.PropsSI("Hmass", "T", T, "Q", 0, f) / 1000
    hV = CP.PropsSI("Hmass", "T", T, "Q", 1, f) / 1000
    v = {"P_bar": CP.PropsSI("P", "T", T, "Q", 0, f) / 1e5,
         "rhoL_kg_m3": CP.PropsSI("Dmass", "T", T, "Q", 0, f),
         "rhoV_kg_m3": CP.PropsSI("Dmass", "T", T, "Q", 1, f),
         "hL_kJ_kg": hL, "hV_kJ_kg": hV, "dHvap_kJ_kg": hV - hL}[key]
    return val(v, "coolprop", d)


# ---------------------------------------------------------------- mixtures
def mixture_state(comps, z):
    names = [COOLPROP[c] for c in comps]
    AS = CP.AbstractState("HEOS", "&".join(names))
    AS.set_mole_fractions(list(z))
    cas = [CP.get_fluid_param_string(n, "CAS") for n in names]
    try:
        pair = CP.get_mixture_binary_pair_data(cas[0], cas[1], "BibTeX")
    except Exception:
        pair = "no binary parameters"
    return AS, f"CoolProp HEOS {' + '.join(names)}; binary parameters {pair}"


def mixture_density(comps, z, T, P_kPa):
    AS, d = mixture_state(comps, z)
    AS.update(CP.PT_INPUTS, P_kPa * 1000, T)
    return val(AS.rhomass(), "coolprop-mixture", d)


def mixture_bubble(comps, x1, T, key):
    AS, d = mixture_state(comps, [x1, 1 - x1])
    AS.update(CP.QT_INPUTS, 0, T)
    if key == "P_bar":
        return val(AS.p() / 1e5, "coolprop-mixture", d + "; bubble point")
    if key == "y1":
        return val(AS.mole_fractions_vapor()[0], "coolprop-mixture", d + "; bubble point")
    raise KeyError(key)


# ---------------------------------------------------------------- one case
def reference(case, key):
    t = case["type"]
    if t == "normalBoilingPoint":
        c = case["component"]
        if c in COOLPROP:
            f = COOLPROP[c]
            return val(CP.PropsSI("T", "P", case["P_kPa"] * 1000, "Q", 0, f) - 273.15, "coolprop", cp_detail(f))
        if c in WEBBOOK_TB:
            v, u, note = WEBBOOK_TB[c]
            url = WEBBOOK_URL.format(cas=components[c]["cas"].replace("-", ""), mask=4)
            return val(v - 273.15, "nist-webbook", f"Tboil = {v} ± {u} K ({note}), {url}")
        return none("No open reference")
    if t == "azeotrope":
        for a in azeo["binary"]:
            if a["components"] == case["components"]:
                if key == "T_C":
                    return val(a["T_C"], "azeotrope-tables", f"{a['type']}, {a['wt_pct_first']} wt% first component")
                return val(a["x_first"], "azeotrope-tables", f"converted from {a['wt_pct_first']} wt% (validation/data/azeotropes_101kPa.json)")
        return none("Not in the azeotrope tables")
    if t == "ternaryAzeotrope":
        a = next((t for t in azeo["ternary"] if t["components"] == case["components"]), None)
        if a is None:
            return none("Not in the azeotrope tables")
        if key == "T_C":
            return val(a["T_C"], "azeotrope-tables", f"{a['type']}, {a['wt_pct']} wt%")
        i = int(key[1:]) - 1
        mol = [w / components[c]["MW"] for w, c in zip(a["wt_pct"], a["components"])]
        return val(mol[i] / sum(mol), "azeotrope-tables", f"converted from {a['wt_pct']} wt% with M from src/data/components.json")
    if t == "bubbleT":
        if case["components"] == ["water", "ethylene-glycol"]:
            for p in weg["txy"]:
                if abs(p["x_water"] - case["x1"]) < 1e-6:
                    return val(p["T_C"] if key == "T_C" else p["y_water"], "water-eg-760mmHg",
                               f"x_water = {p['x_water']:.3f}: T = {p['T_C']} degC, y = {p['y_water']:.3f}")
        return none("No open T-x-y data transcribed for this pair yet")
    if t == "bubbleP":
        if case["components"] == ["acetic-acid", "ethylene-glycol"]:
            for p in sch["px"]:
                if abs(p["x1"] - case["x1"]) < 1e-9:
                    return val(p["P_kPa"], "schmid2007", f"Table 12, x1 = {p['x1']}, T = {sch['T_K']} K")
        if case["components"] == ["methane", "ethane"]:
            return mixture_bubble(case["components"], case["x1"], case["T_K"], key)
        return none("No open data transcribed")
    if t == "excessEnthalpy":
        if case["components"] == ["acetic-acid", "ethylene-glycol"]:
            for p in sch["HE_323K"]:
                if abs(p["x1"] - case["x1"]) < 1e-9:
                    return val(p["HE_J_mol"], "schmid2007", f"Table 17, x1 = {p['x1']}, T = 323.15 K (data used in the fit)")
        if case["components"] == ["water", "ethanol"]:
            for x1, he in weh["rows"]:
                if abs(x1 - case["x1"]) < 1e-9:
                    return val(he * 1000, "fang2014", f"x_water = {x1}, HE = {he} kJ/mol at {weh['T_K']} K, {weh['P_kPa']} kPa (converted to J/mol)")
        return none("No open excess-enthalpy data transcribed for this pair yet")
    if t == "flash":
        for c in flashref:
            if c["components"] == case["components"] and c["model"] == case["model"] and c.get("vapour") == case.get("vapour") \
                    and c["z"] == case["z"] and c["spec"] == case["spec"]:
                v = {"VF": c["VF"], "T_C": c["T_K"] - 273.15, "y1": (c["y"] or [None])[0]}[key]
                return val(v, "thermo-flash", f"spec {case['spec']}, z = {case['z']}") if v is not None else none("no vapour")
        return none("Not in validation/fixtures/flash.json")
    if t == "dewT":
        if case["components"] == ["ethanol", "water"]:
            for x1, T, y1 in etw["rows"]:
                if abs(y1 - case["y1"]) < 1e-9:
                    return val(T - 273.15 if key == "T_C" else x1, "kamihama2012",
                               f"measured point x1 = {x1}, T = {T} K, y1 = {y1} at {etw['P_kPa']} kPa: the dew point of y1 is T, its liquid x1")
        return none("No open T-x-y data transcribed for this pair yet")
    if t == "pureProperty":
        return pure_ref(case["component"], case["property"], case["T_K"], case.get("P_kPa"), case.get("state"))
    if t == "steamSaturation":
        return steam_sat(case["T_K"], key)
    if t == "steamState":
        return steam_state(case["T_K"], case["P_kPa"], key)
    if t == "mixtureDensity":
        return mixture_density(case["components"], case["z"], case["T_K"], case["P_kPa"])
    raise KeyError(t)


def expand(v):
    """Grid spec {from, to, n} or a list, the same way as scripts/engineering-report.mjs."""
    if isinstance(v, list):
        return v
    return [v["from"] + (v["to"] - v["from"]) * i / (v["n"] - 1) for i in range(v["n"])]


def curve_reference(cv):
    """Reference series for a plot: on the curve's own grid, or as data points."""
    t = cv["type"]
    if t == "bubbleT" and cv["components"] == ["water", "ethylene-glycol"]:
        return {"points": [[p["x_water"], p["T_C"]] for p in weg["txy"]], "source": "water-eg-760mmHg"}
    if t == "bubbleP" and cv["components"] == ["acetic-acid", "ethylene-glycol"]:
        return {"points": [[p["x1"], p["P_kPa"]] for p in sch["px"]], "source": "schmid2007"}
    if t in ("bubbleT", "bubbleP") and cv["components"] != ["methane", "ethane"]:
        return None
    xs = expand(cv[cv["x"]])
    ys, src = [], None
    for x in xs:
        case = {**cv, cv["x"]: x}
        try:
            r = reference(case, cv["key"])
        except ValueError:
            r = None  # CoolProp outside its range or no solution
        if r and r.get("value") is not None and math.isfinite(r["value"]):
            ys.append(r["value"])
            src = r["source"]
        else:
            ys.append(None)
    if all(y is None for y in ys):
        return None
    return {"y": ys, "source": src}


def main():
    total = with_ref = 0
    for g in cases["groups"]:
        values = {}
        for case in g["cases"]:
            values[case["id"]] = {}
            for q in case["quantities"]:
                r = reference(case, q["key"])
                if r.get("value") is not None:
                    r["value"] = float(f"{r['value']:.7g}")
                    with_ref += 1
                total += 1
                values[case["id"]][q["key"]] = r
        doc = {"_about": f"Reference values for the '{g['title']}' group of validation/report/cases.json. "
                         "Generated by validation/report/make_reference.py; do not edit by hand.",
               "coolprop_version": CoolProp.__version__,
               "sources": {k: v for k, v in SOURCES.items()
                           if any(r.get("source") == k for c in values.values() for r in c.values())},
               "values": values}
        (OUT / f"{g['id']}.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    curves = {}
    for cv in cases["curves"]:
        r = curve_reference(cv)
        if r:
            if "y" in r:
                r["y"] = [None if y is None else float(f"{y:.6g}") for y in r["y"]]
            curves[cv["id"]] = r
    doc = {"_about": "Reference series for the plots of the HTML report. Generated by make_reference.py.",
           "coolprop_version": CoolProp.__version__, "sources": SOURCES, "curves": curves}
    (OUT / "curves.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{with_ref} of {total} quantities have a reference; {len(curves)} reference curves")


if __name__ == "__main__":
    main()
