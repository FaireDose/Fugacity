"""
Pure-component temperature correlations (proposal 0002, sections 2, 4, 5), for the 16 components
of v0.2 and the components of proposal 0004 (added with add_components.py).

For each component and property this script takes the source chosen by the source chain
(proposal 0002, section 4), samples it, fits a DIPPR equation (forms 100-107 only, as
implemented in src/thermo/correlations.js), and reports the maximum relative deviation
from the source over the fit range.

    python validation/python/fit_properties.py --chemsep path/to/chemsep1.xml           # fit, print
    python validation/python/fit_properties.py --chemsep path/to/chemsep1.xml --write   # and write

After --write, run make_sources.py: it adds the source_ids of the records (proposal 0003).

--write updates:
  src/data/components.json        `properties` of every component; top-level `vapourPressure`
                                  of the six gases (the ten liquids' records are not touched)
  validation/data/pure/<id>.json  the sampled source points, for test/properties.test.js
  docs/PURE_DATA.md               coverage table, spot checks and cross-checks

Sources, in the order of the chain:
  1/2. CoolProp 8.0.0 (open source, MIT), reference equations of state and transport
       correlations cited per fluid (water: IAPWS-95 and the IAPWS 2008/2011 transport
       formulations as implemented in CoolProp). Requires `pip install CoolProp==8.0.0`.
  3.   NIST Chemistry WebBook (SRD 69): gas-phase heat capacity tables or Shomate equations,
       transcribed in WEBBOOK_CP0 below from the pages cited there; and the fluid tables
       (Thermophysical Properties of Fluid Systems) for transport properties CoolProp does not
       model, downloaded as tab-delimited text by --fetch-webbook into
       validation/data/pure/webbook_fluid/<id>.json (WEBBOOK_FLUID below); only where the page
       names the model behind the values.
  4.   ChemSep pure-component database v8.3 (chemsep1.xml), Copyright (c) Harry Kooijman and
       Ross Taylor, Artistic License 2.0, as redistributed in DWSIM
       (https://github.com/DanWBR/dwsim, DWSIM.Thermodynamics/Assets/Databases/chemsep1.xml).
       DIPPR 101, 102, 105 and 106 coefficients are taken over (units converted from the kmol
       basis); ChemSep equation 16, Y = A + exp(B/T + C + D T + E T^2) (as implemented in
       DWSIM, PropertyPackage.vb, CalcCSTDepProp), is not in Fugacity, so it is sampled and
       refitted in a DIPPR form.

Equation forms: ChemSep documentation (Kooijman & Taylor) and the open-source `chemicals`
library (chemicals.dippr), equations 100-107; see src/thermo/correlations.js.

Fit targets: maximum relative deviation 1 % (thermodynamic properties) and 3 % (transport
properties). Where a target is not met over the default range the range is narrowed in
steps and the record says so.
"""
import argparse
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parents[2]
COMP_FILE = ROOT / "src" / "data" / "components.json"
POINTS_DIR = ROOT / "validation" / "data" / "pure"
MEASURED_FILE = POINTS_DIR / "measured" / "webbook.json"
DOC_FILE = ROOT / "docs" / "PURE_DATA.md"

N_FIT = 200        # points sampled from the source per record (uniform in T)
N_STORE = 41       # of which this many are stored for the test (every 5th, ends included)

IDS = ["water", "acetic-acid", "ethylene-glycol", "methanol", "ethanol", "acetone", "chloroform",
       "benzene", "toluene", "ethyl-acetate", "oxygen", "nitrogen", "hydrogen", "methane", "ethane",
       "ethylene",
       # proposal 0004, batch 1: gases at 25 degC and 1 atm
       "carbon-monoxide", "carbon-dioxide", "hydrogen-sulfide", "argon", "propane", "propylene", "n-butane",
       "isobutane", "ammonia", "dimethyl-ether",
       # proposal 0004, batch 2: hydrocarbon liquids
       "cyclohexane", "o-xylene", "m-xylene", "p-xylene", "ethylbenzene", "styrene", "n-pentane", "n-hexane",
       "n-heptane", "n-octane",
       # proposal 0004, batch 3: solvents, alcohols, glycols and phenol
       "diethyl-ether", "propylene-glycol", "tetrahydrofuran", "1-propanol", "2-propanol", "1-butanol", "2-butanone",
       "methyl-acetate", "n-butyl-acetate", "acetonitrile", "mtbe", "glycerol", "phenol",
       # proposal 0008, Part B, batch 1: extraction solvents
       "dichloroethane", "mibk", "cyclohexanone", "dmf", "dmso", "nmp", "sulfolane", "furfural", "dioxane",
       "isobutanol", "2-butanol",
       # proposal 0008, Part B, batch 2: gas treating, acids, esters and reaction work
       "mea", "dea", "mdea", "sulfur-dioxide", "nitrous-oxide", "formic-acid", "propionic-acid", "acrylic-acid",
       "vinyl-acetate", "isopropyl-acetate", "ethylene-oxide", "propylene-oxide", "formaldehyde", "hydrogen-peroxide",
       # proposal 0008, Part B, batch 3: petrochemicals and fuels, nitrogen compounds
       "cumene", "mesitylene", "n-nonane", "n-decane", "n-dodecane", "isooctane", "1-butene", "isoprene",
       "etbe", "pyridine", "aniline", "acrylonitrile", "methylamine"]
# components whose vapour-pressure record is made here (the ten liquids of v0.1 keep theirs): from CoolProp,
# or from ChemSep for a component that is not a CoolProp fluid
VP_FITTED = ["oxygen", "nitrogen", "hydrogen", "methane", "ethane", "ethylene",
             "carbon-monoxide", "carbon-dioxide", "hydrogen-sulfide", "argon", "propane", "propylene", "n-butane",
             "isobutane", "ammonia", "dimethyl-ether",
             "cyclohexane", "o-xylene", "m-xylene", "p-xylene", "ethylbenzene", "styrene", "n-pentane", "n-hexane",
             "n-heptane", "n-octane",
             "diethyl-ether", "propylene-glycol", "tetrahydrofuran", "1-propanol", "2-propanol", "1-butanol",
             "2-butanone", "methyl-acetate", "n-butyl-acetate", "acetonitrile", "mtbe", "glycerol", "phenol",
             "dichloroethane", "mibk", "cyclohexanone", "dmf", "dmso", "nmp", "sulfolane", "furfural", "dioxane",
             "isobutanol", "2-butanol",
             "mea", "dea", "mdea", "sulfur-dioxide", "nitrous-oxide", "formic-acid", "propionic-acid", "acrylic-acid",
             "vinyl-acetate", "isopropyl-acetate", "ethylene-oxide", "propylene-oxide", "formaldehyde", "hydrogen-peroxide",
             "cumene", "mesitylene", "n-nonane", "n-decane", "n-dodecane", "isooctane", "1-butene", "isoprene",
             "etbe", "pyridine", "aniline", "acrylonitrile", "methylamine"]
# proposal 0008, Part B, batches 1 to 3 (the record notes name the proposal)
BATCH_0008 = ["dichloroethane", "mibk", "cyclohexanone", "dmf", "dmso", "nmp", "sulfolane", "furfural", "dioxane",
       "isobutanol", "2-butanol",
       "mea", "dea", "mdea", "sulfur-dioxide", "nitrous-oxide", "formic-acid", "propionic-acid", "acrylic-acid",
       "vinyl-acetate", "isopropyl-acetate", "ethylene-oxide", "propylene-oxide", "formaldehyde", "hydrogen-peroxide",
       "cumene", "mesitylene", "n-nonane", "n-decane", "n-dodecane", "isooctane", "1-butene", "isoprene",
       "etbe", "pyridine", "aniline", "acrylonitrile", "methylamine"]

COOLPROP = {"water": "Water", "methanol": "Methanol", "ethanol": "Ethanol", "acetone": "Acetone",
            "benzene": "Benzene", "toluene": "Toluene", "oxygen": "Oxygen", "nitrogen": "Nitrogen",
            "hydrogen": "Hydrogen", "methane": "Methane", "ethane": "Ethane", "ethylene": "Ethylene",
            "carbon-monoxide": "CarbonMonoxide", "carbon-dioxide": "CarbonDioxide",
            "hydrogen-sulfide": "HydrogenSulfide", "argon": "Argon", "propane": "n-Propane",
            "propylene": "Propylene", "n-butane": "n-Butane", "isobutane": "IsoButane", "ammonia": "Ammonia",
            "dimethyl-ether": "DimethylEther",
            "cyclohexane": "Cyclohexane", "o-xylene": "o-Xylene", "m-xylene": "m-Xylene", "p-xylene": "p-Xylene",
            "ethylbenzene": "EthylBenzene", "n-pentane": "n-Pentane", "n-hexane": "n-Hexane", "n-heptane": "n-Heptane",
            "n-octane": "n-Octane", "diethyl-ether": "DiethylEther", "propylene-glycol": "PropyleneGlycol",
            "tetrahydrofuran": "Tetrahydrofuran", "dichloroethane": "Dichloroethane",
            "sulfur-dioxide": "SulfurDioxide", "nitrous-oxide": "NitrousOxide", "ethylene-oxide": "EthyleneOxide",
            "n-nonane": "n-Nonane", "n-decane": "n-Decane", "n-dodecane": "n-Dodecane", "1-butene": "1-Butene"}

PROPS = ["liquidDensity", "idealGasHeatCapacity", "liquidHeatCapacity", "heatOfVaporization",
         "liquidViscosity", "vapourViscosity", "liquidThermalConductivity",
         "vapourThermalConductivity", "surfaceTension"]
UNITS = {"liquidDensity": "kg/m3", "idealGasHeatCapacity": "J/mol/K", "liquidHeatCapacity": "J/mol/K",
         "heatOfVaporization": "J/mol", "liquidViscosity": "Pa s", "vapourViscosity": "Pa s",
         "liquidThermalConductivity": "W/m/K", "vapourThermalConductivity": "W/m/K",
         "surfaceTension": "N/m", "vapourPressure": "Pa"}
TRANSPORT = {"liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"}
LIQUID_SIDE = {"liquidDensity", "liquidHeatCapacity", "heatOfVaporization", "liquidViscosity",
               "liquidThermalConductivity", "surfaceTension"}
# DIPPR form used for each property when Fugacity fits it
FORM = {"liquidDensity": "DIPPR105", "idealGasHeatCapacity": "DIPPR107", "liquidHeatCapacity": "DIPPR100",
        "heatOfVaporization": "DIPPR106", "liquidViscosity": "DIPPR101", "vapourViscosity": "DIPPR102",
        "liquidThermalConductivity": "DIPPR100", "vapourThermalConductivity": "DIPPR102",
        "surfaceTension": "DIPPR106", "vapourPressure": "DIPPR101"}
# ChemSep XML tag for each property
CHEMSEP_TAG = {"liquidDensity": "LiquidDensity", "idealGasHeatCapacity": "IdealGasHeatCapacityCp",
               "liquidHeatCapacity": "LiquidHeatCapacityCp", "heatOfVaporization": "HeatOfVaporization",
               "liquidViscosity": "LiquidViscosity", "vapourViscosity": "VaporViscosity",
               "liquidThermalConductivity": "LiquidThermalConductivity",
               "vapourThermalConductivity": "VaporThermalConductivity", "surfaceTension": "SurfaceTension",
               "vapourPressure": "VaporPressure"}

# ---------------------------------------------------------------------------------------------
# The source chosen for every component and property (proposal 0002, section 4).
# "coolprop": CoolProp 8.0.0; "webbook": NIST WebBook; "chemsep": ChemSep v8.3.
# Why each choice was made is in CHAIN_NOTES and in the records.
# ---------------------------------------------------------------------------------------------
NOT_IN_COOLPROP = ["acetic-acid", "ethylene-glycol", "chloroform", "ethyl-acetate", "styrene", "1-propanol",
                   "2-propanol", "1-butanol", "2-butanone", "methyl-acetate", "n-butyl-acetate", "acetonitrile", "mtbe",
                   "glycerol", "phenol", "mibk", "cyclohexanone", "dmf", "dmso", "nmp", "sulfolane", "furfural",
                   "dioxane", "isobutanol", "2-butanol", "mea", "dea", "mdea", "formic-acid", "propionic-acid",
                   "acrylic-acid", "vinyl-acetate", "isopropyl-acetate", "propylene-oxide", "formaldehyde",
                   "hydrogen-peroxide", "cumene", "mesitylene", "isooctane", "isoprene", "etbe", "pyridine", "aniline",
                   "acrylonitrile", "methylamine"]
COOLPROP_GAPS = {  # property models CoolProp 8.0.0 does not have (checked in this script)
    "acetone": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"],
    "ethylene": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"],
    "carbon-monoxide": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"],
    "hydrogen-sulfide": ["liquidThermalConductivity", "vapourThermalConductivity"],
    "dimethyl-ether": ["liquidThermalConductivity", "vapourThermalConductivity"],
    "cyclohexane": ["liquidThermalConductivity", "vapourThermalConductivity"],
    "diethyl-ether": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"],
    "propylene-glycol": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity",
                         "surfaceTension"],
    "tetrahydrofuran": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity",
                        "surfaceTension"],
    "dichloroethane": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity",
                       "surfaceTension"],
    "sulfur-dioxide": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"],
    "nitrous-oxide": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"],
    "ethylene-oxide": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity",
                       "surfaceTension"],
    "1-butene": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"],
}

# NIST WebBook fluid tables (step 3 of the chain) for properties in COOLPROP_GAPS, where the WebBook
# page names the model behind the values. Checked on the pages (2026-10-03):
#  - carbon monoxide: transport model Huber, NISTIR 8209 (2018); used.
#  - hydrogen sulfide: the page cites a viscosity model (Schmidt et al. 2008) but no thermal
#    conductivity model, so its conductivity values cannot be cited: ChemSep is used (WEBBOOK_UNCITED).
#  - dimethyl ether: not a WebBook fluid.
WEBBOOK_FLUID = {
    "carbon-monoxide": {
        "ID": "C630080",
        "props": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"],
        "reference": "Huber M.L., Models for the Viscosity, Thermal Conductivity, and Surface Tension of Selected "
                     "Pure Fluids as Implemented in REFPROP v10.0, NISTIR 8209, NIST, Boulder (2018), "
                     "doi:10.6028/NIST.IR.8209; thermal conductivity critical enhancement: Perkins, Sengers, "
                     "Abdulagatov, Huber, Int. J. Thermophys. 34 (2013) 191-212, doi:10.1007/s10765-013-1409-z; "
                     "as computed by the NIST Chemistry WebBook (SRD 69), Thermophysical Properties of Fluid Systems",
        "notes": "WebBook: estimated uncertainty of the gas viscosity to atmospheric pressure 1 %, saturated liquid "
                 "2 %; gas thermal conductivity 2 %, saturated liquid 5 %; upper temperature limit 500 K.",
        "Tmax_vapour": 500.0,
    },
    "cyclohexane": {
        "ID": "C110827",
        "props": ["liquidThermalConductivity", "vapourThermalConductivity"],
        "reference": "Koutian A., Assael M.J., Huber M.L., Perkins R.A., Reference Correlation of the Thermal "
                     "Conductivity of Cyclohexane from the Triple Point to 640 K and up to 175 MPa, J. Phys. Chem. "
                     "Ref. Data 46 (2017) 013102, doi:10.1063/1.4974325; as computed by the NIST Chemistry WebBook "
                     "(SRD 69), Thermophysical Properties of Fluid Systems",
        "notes": "WebBook: estimated uncertainty 4 % for the compressed liquid, 2.5 % for the low-pressure gas "
                 "(280-680 K).",
        "Tmax_vapour": 640.0,
    },
}
# proposal 0008, batch 2 (pages read 2026-10-07): sulfur dioxide and nitrous oxide name the transport model of
# Huber, NISTIR 8209 (2018), with the uncertainties quoted below.
WEBBOOK_FLUID.update({
    "sulfur-dioxide": {
        "ID": "C7446095",
        "props": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"],
        "reference": "Huber M.L., Models for the Viscosity, Thermal Conductivity, and Surface Tension of Selected "
                     "Pure Fluids as Implemented in REFPROP v10.0, NISTIR 8209, NIST, Boulder (2018), "
                     "doi:10.6028/NIST.IR.8209; thermal conductivity critical enhancement: Perkins, Sengers, "
                     "Abdulagatov, Huber, Int. J. Thermophys. 34 (2013) 191-212, doi:10.1007/s10765-013-1409-z; "
                     "as computed by the NIST Chemistry WebBook (SRD 69), Thermophysical Properties of Fluid Systems",
        "notes": "WebBook: estimated uncertainty of the viscosity and of the thermal conductivity 5 % in the liquid along "
                 "the saturation boundary and in the gas; the equation of state is valid from the triple point "
                 "(197.7 K) to 523 K.",
        "Tmax_vapour": 523.0,
    },
    "nitrous-oxide": {
        "ID": "C10024972",
        "props": ["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"],
        "reference": "Huber M.L., Models for the Viscosity, Thermal Conductivity, and Surface Tension of Selected "
                     "Pure Fluids as Implemented in REFPROP v10.0, NISTIR 8209, NIST, Boulder (2018), "
                     "doi:10.6028/NIST.IR.8209; thermal conductivity critical enhancement: Perkins, Sengers, "
                     "Abdulagatov, Huber, Int. J. Thermophys. 34 (2013) 191-212, doi:10.1007/s10765-013-1409-z; "
                     "as computed by the NIST Chemistry WebBook (SRD 69), Thermophysical Properties of Fluid Systems",
        "notes": "WebBook: estimated uncertainty of the viscosity 10 % (Lennard-Jones parameters from Reid, Prausnitz and "
                 "Poling, 4th ed., 1987); no uncertainty stated for the thermal conductivity. Tables requested to 500 K; "
                 "the WebBook limits them to the range of its models.",
        "Tmax_vapour": 500.0,
    },
})
WEBBOOK_UNCITED = {"hydrogen-sulfide": "NIST WebBook fluid tables: thermal conductivity values given without a "
                                      "cited model, so not used"}
WEBBOOK_FLUID_DIR = Path(__file__).resolve().parents[2] / "validation" / "data" / "pure" / "webbook_fluid"
WEBBOOK_FLUID_URL = ("https://webbook.nist.gov/cgi/fluid.cgi?Action=Data&Wide=on&ID={ID}&Digits=8&RefState=DEF"
                     "&TUnit=K&PUnit=MPa&DUnit=mol%2Fl&HUnit=kJ%2Fmol&WUnit=m%2Fs&VisUnit=Pa*s&STUnit=N%2Fm")
WEBBOOK_DILUTE_MPa = 0.001   # the dilute-gas isobar, 1 kPa

# NIST WebBook Antoine equations (phase change data), to cross-check vapour pressures taken from ChemSep
# (proposal 0004: "checked against the NIST WebBook where it has data"). Downloaded by --fetch-webbook into
# validation/data/pure/measured/webbook_antoine.json: log10(P/bar) = A - B / (T/K + C).
WEBBOOK_ANTOINE = {cid: "C" + cas.replace("-", "") for cid, cas in [
    ("styrene", "100-42-5"), ("1-propanol", "71-23-8"), ("2-propanol", "67-63-0"), ("1-butanol", "71-36-3"),
    ("2-butanone", "78-93-3"), ("methyl-acetate", "79-20-9"), ("n-butyl-acetate", "123-86-4"),
    ("acetonitrile", "75-05-8"), ("mtbe", "1634-04-4"), ("glycerol", "56-81-5"), ("phenol", "108-95-2"),
    # proposal 0008, Part B, batch 1
    ("mibk", "108-10-1"), ("cyclohexanone", "108-94-1"), ("dmf", "68-12-2"), ("dmso", "67-68-5"), ("nmp", "872-50-4"),
    ("sulfolane", "126-33-0"), ("furfural", "98-01-1"), ("dioxane", "123-91-1"), ("isobutanol", "78-83-1"),
    ("2-butanol", "78-92-2"),
    # proposal 0008, Part B, batch 2
    ("mea", "141-43-5"), ("dea", "111-42-2"), ("mdea", "105-59-9"), ("formic-acid", "64-18-6"),
    ("propionic-acid", "79-09-4"), ("acrylic-acid", "79-10-7"), ("vinyl-acetate", "108-05-4"),
    ("isopropyl-acetate", "108-21-4"), ("propylene-oxide", "75-56-9"), ("formaldehyde", "50-00-0"),
    ("hydrogen-peroxide", "7722-84-1"),
    # proposal 0008, Part B, batch 3 (the components that are not CoolProp fluids)
    ("cumene", "98-82-8"), ("mesitylene", "108-67-8"), ("isooctane", "540-84-1"), ("isoprene", "78-79-5"),
    ("etbe", "637-92-3"), ("pyridine", "110-86-1"), ("aniline", "62-53-3"), ("acrylonitrile", "107-13-1"),
    ("methylamine", "74-89-5")]}
# Vapour pressures fitted to a WebBook Antoine set plus the critical point, where the ChemSep equation does not
# reproduce the measured normal boiling point. Styrene: the ChemSep equation 101 gives 417.14 K at 101.325 kPa
# against 418.31 K (ChemSep's own Tb, and the Antoine equation of Dreyer et al. (1955), measured to 417.92 K;
# WebBook average of 18 measured Tb values: 419 +/- 2 K), and differs from Dreyer et al. by +6.7 % at 303 K.
VP_FROM_ANTOINE = {"styrene": "Dreyer, Martin, et al., 1955"}
# Vapour pressures fitted to the measured values of the ThermoML Archive (check_measured.py) and the ChemSep critical
# point, where the ChemSep equation deviates from them by more than the 1 % tolerance of the engineering report
# (docs/MEASURED_CHECKS.md, proposal 0008)
# Records fitted to the measured values of the ThermoML Archive instead of the databank (docs/MEASURED_CHECKS.md).
# The rule (proposal 0008, batch 1): a databank record is replaced when it misses the tolerance of the engineering
# report (proposal 0002) and the measured values within the record's target cover the working range, from 25 degC
# (or the melting point) to 100 degC (or the normal boiling point if lower); or, whatever the coverage, when it
# misses three times the tolerance (then the record covers only the measured temperatures). The reason is stated
# in each record.
# measured Antoine equations of the NIST WebBook (webbook_antoine.json) fitted together with the ThermoML values
VP_MEASURED_ANTOINE = {"phenol": ("Dreisbach and Shrader, 1949",)}
MEASURED_REFIT = {
    "nmp": {"liquidViscosity": "the ChemSep v8.31 viscosity deviates from 22 articles by 9 % (median)"},
    "2-butanol": {"vapourPressure": "the ChemSep vapour pressure deviates from 24 articles by 1.1 % (median)"},
    "dmso": {"liquidThermalConductivity": "the ChemSep thermal conductivity deviates from the measured values by 16 %"},
    "sulfolane": {"liquidThermalConductivity": "the ChemSep thermal conductivity deviates from the measured values by 19 %"},
    # the older components (docs/MEASURED_CHECKS.md)
    "glycerol": {"vapourPressure": "the ChemSep vapour pressure deviates from the measured values by 7 % (median of the "
                                   "articles)",
                 "liquidViscosity": "the ChemSep viscosity deviates from the measured values by 38 % (median of the articles)"},
    "phenol": {"vapourPressure": "the ChemSep vapour pressure deviates from the measured values by 3.5 % (median of the "
                                 "articles) and by up to 32 % below 400 K"},
    "1-butanol": {"vapourPressure": "the ChemSep vapour pressure deviates from 25 articles by 1.8 % (median)"},
    "acetonitrile": {"vapourPressure": "the ChemSep vapour pressure deviates from 8 articles by 1.2 % (median)"},
}
VP_FROM_MEASURED = {cid for cid, props in MEASURED_REFIT.items() if "vapourPressure" in props}
WEBBOOK_ANTOINE_FILE = Path(__file__).resolve().parents[2] / "validation" / "data" / "pure" / "measured" / "webbook_antoine.json"
WEBBOOK_ANTOINE_URL = "https://webbook.nist.gov/cgi/cbook.cgi?ID={ID}&Units=SI&Mask=4"


def chosen_source(cid, prop):
    if prop in MEASURED_REFIT.get(cid, {}):
        return "measured"
    if cid in COOLPROP and prop not in COOLPROP_GAPS.get(cid, []):
        return "coolprop"
    if prop == "idealGasHeatCapacity" and cid in WEBBOOK_CP0:
        return "webbook"
    if cid in WEBBOOK_FLUID and prop in WEBBOOK_FLUID[cid]["props"]:
        return "webbook-fluid"
    return "chemsep"


def chain_note(cid, prop):
    """What was checked above the chosen source, for the record."""
    src = chosen_source(cid, prop)
    if src == "coolprop":
        return None
    notes = []
    if src == "webbook-fluid":
        return "CoolProp 8.0.0: no %s model" % ("viscosity" if "Viscosity" in prop else "thermal conductivity")
    if cid in NOT_IN_COOLPROP:
        notes.append("CoolProp 8.0.0: fluid not included")
    else:
        notes.append("CoolProp 8.0.0: no %s model" % ("viscosity" if "Viscosity" in prop else "thermal conductivity"))
    if src == "chemsep":
        if cid == "ethylene":
            notes.append("NIST WebBook fluid tables (ethene): could not be opened in this session")
        elif cid in WEBBOOK_UNCITED and "Conductivity" in prop:
            notes.append(WEBBOOK_UNCITED[cid])
        elif cid in ("dimethyl-ether", "diethyl-ether", "propylene-glycol", "tetrahydrofuran", "dichloroethane",
                     "ethylene-oxide", "1-butene"):
            notes.append("NIST WebBook: %s is not a WebBook fluid" % ("1-butene" if cid == "1-butene" else cid.replace("-", " ")))
        elif cid == "styrene":
            notes.append("ChemSep, as proposal 0004 sets for the components that are not CoolProp fluids; NIST "
                         "WebBook: not a WebBook fluid, and no gas-phase heat capacity table on its page")
        elif cid in WEBBOOK_ANTOINE and cid in BATCH_0008:
            notes.append("ChemSep, as proposal 0008 sets for the components that are not CoolProp fluids (checked "
                         "against the NIST WebBook where it has data: vapour pressure)")
        elif cid in WEBBOOK_ANTOINE:
            notes.append("ChemSep, as proposal 0004 sets for the components that are not CoolProp fluids (checked "
                         "against the NIST WebBook where it has data: vapour pressure)")
        elif cid == "acetone":
            notes.append("NIST WebBook: acetone is not a WebBook fluid")
        elif prop in ("liquidHeatCapacity", "heatOfVaporization"):
            notes.append("NIST WebBook: measured values at single temperatures only, not a correlation over the "
                         "liquid range; where available they are compared with this record in `measured`")
        else:
            notes.append("NIST WebBook: no data")
    return "; ".join(notes)


# ---------------------------------------------------------------------------------------------
# NIST WebBook gas-phase heat capacity (step 3 of the chain) for the four liquids that are not in
# CoolProp. Values transcribed from the pages below (opened 2026-10-01). Ideal gas at 1 bar.
# ---------------------------------------------------------------------------------------------
WEBBOOK_CP0 = {
    "acetic-acid": {
        "url": "https://webbook.nist.gov/cgi/inchi?ID=C64197&Mask=1",
        "reference": "Chao J., Thermodynamic properties of key organic oxygen compounds in the carbon range "
                     "C1 to C4. Part 2. Ideal gas properties, J. Phys. Chem. Ref. Data 15 (1986) 1369-1436, "
                     "as tabulated in the NIST Chemistry WebBook (SRD 69), gas phase thermochemistry data, Cp,gas",
        "notes": "Monomer (ideal gas of single CH3COOH molecules): the real vapour is largely dimerized "
                 "(see the association record). Statistically calculated; the WebBook notes that values differ "
                 "from other statistical calculations by 3.1-5.4 J/mol/K.",
        "table": [(50.0, 39.54), (100.0, 40.42), (150.0, 42.74), (200.0, 48.34), (273.15, 59.38),
                  (298.15, 63.44), (300.0, 63.74), (400.0, 79.66), (500.0, 93.93), (600.0, 106.18),
                  (700.0, 116.63), (800.0, 125.50), (900.0, 132.99), (1000.0, 139.26), (1100.0, 144.46),
                  (1200.0, 148.76), (1300.0, 152.30), (1400.0, 155.22), (1500.0, 157.63)],
    },
    "ethylene-glycol": {
        "url": "https://webbook.nist.gov/cgi/inchi?ID=C107211&Mask=1",
        "reference": "Yeh T.-S., Global conformational analysis of 1,2-ethanediol, J. Phys. Chem. 98 (1994) "
                     "8921-8929, as tabulated in the NIST Chemistry WebBook (SRD 69), gas phase thermochemistry "
                     "data, Cp,gas",
        "notes": "Statistically calculated values.",
        "table": [(200.0, 59.79), (298.15, 77.99), (300.0, 78.41), (400.0, 97.99), (500.0, 113.64),
                  (600.0, 125.65), (700.0, 135.23), (800.0, 143.26), (900.0, 150.25), (1000.0, 156.40)],
    },
    "chloroform": {
        "url": "https://webbook.nist.gov/cgi/inchi?ID=C67663&Mask=1",
        "reference": "Chase M.W., Jr., NIST-JANAF Thermochemical Tables, Fourth Edition, J. Phys. Chem. Ref. "
                     "Data, Monograph 9 (1998) 1-1951, Shomate equation as given in the NIST Chemistry "
                     "WebBook (SRD 69), gas phase thermochemistry data",
        "notes": "Shomate equation Cp = A + B t + C t^2 + D t^3 + E/t^2, t = T/1000, range 298-1200 K "
                 "(JANAF data last reviewed in December 1968).",
        "shomate": {"Tmin": 298.0, "Tmax": 1200.0,
                    "A": 44.24706, "B": 114.6734, "C": -88.81837, "D": 25.89992, "E": -0.522808},
    },
    "ethyl-acetate": {
        "url": "https://webbook.nist.gov/cgi/inchi?ID=C141786&Mask=1",
        "reference": "Stull D.R., The Chemical Thermodynamics of Organic Compounds, "
                     "Wiley, New York (1969), selected values as tabulated in the NIST Chemistry WebBook "
                     "(SRD 69), gas phase thermochemistry data, Cp,gas",
        "notes": "Selected values based on extrapolation of heat-capacity data to high temperatures (WebBook "
                 "comment). Cross-check: measured vapour heat capacities of Connett et al., J. Chem. "
                 "Thermodyn. 8 (1976) 1199 (360-450 K), on the same WebBook page.",
        "table": [(298.15, 113.64), (300.0, 113.97), (400.0, 137.40), (500.0, 161.92), (600.0, 182.63),
                  (700.0, 199.53), (800.0, 213.43), (900.0, 224.89), (1000.0, 234.51)],
        "check": [(360.0, 125.82), (380.0, 131.06), (400.0, 136.22), (425.0, 142.80), (450.0, 149.47)],
        "check_reference": "Connett J.E. et al., J. Chem. Thermodyn. 8 (1976) 1199-1203 (measured), via the "
                           "NIST WebBook page above",
    },
}

# ---------------------------------------------------------------------------------------------
# DIPPR equations (same as src/thermo/correlations.js) and ChemSep equation 16
# ---------------------------------------------------------------------------------------------


def ev(eq, c, T, Tc=None):
    A, B, C, D, E = (c.get(k, 0.0) for k in "ABCDE")
    T = np.asarray(T, dtype=float)
    if eq == "DIPPR100":
        return A + T * (B + T * (C + T * (D + T * E)))
    if eq == "DIPPR101":
        return np.exp(A + B / T + C * np.log(T) + D * T ** E)
    if eq == "DIPPR102":
        return A * T ** B / (1 + C / T + D / T ** 2)
    if eq == "DIPPR105":
        return A / B ** (1 + (1 - T / C) ** D)
    if eq == "DIPPR106":
        r = T / Tc
        return A * (1 - r) ** (B + r * (C + r * (D + r * E)))
    if eq == "DIPPR107":
        s = (C / T) / np.sinh(C / T)
        h = (E / T) / np.cosh(E / T)
        return A + B * s * s + D * h * h
    if eq == "CS16":  # ChemSep equation 16
        return A + np.exp(B / T + C + D * T + E * T ** 2)
    if eq == "CS116":  # ChemSep equation 116, with Tr = T/Tc (DWSIM, PropertyPackage.vb, CalcCSTDepProp)
        t = 1 - T / Tc
        return A + B * t ** 0.35 + C * t ** (2 / 3) + D * t + E * t ** (4 / 3)
    if eq == "CS10":  # ChemSep equation 10 (Antoine form), as implemented in DWSIM, PropertyPackage.vb, CalcCSTDepProp
        return np.exp(A - B / (T + C))
    raise ValueError(eq)


def rel_dev(fit, ref):
    return np.max(np.abs(fit / ref - 1))

# ---------------------------------------------------------------------------------------------
# Fitting, one function per DIPPR form. Each returns (coefficients, extra record fields).
# Residuals are relative (fits in ln y, or weighted by 1/y).
# ---------------------------------------------------------------------------------------------


def _lstsq(M, b, w=None):
    if w is not None:
        M, b = M * w[:, None], b * w
    s = np.abs(M).max(axis=0)
    s[s == 0] = 1
    x = np.linalg.lstsq(M / s, b, rcond=None)[0]
    return x / s


def _minimax(fit_once, T, y, iters=30):
    """Lawson-type reweighting of a weighted least-squares fit, to lower the maximum deviation."""
    w = np.ones_like(T)
    best = None
    for _ in range(iters):
        c = fit_once(w)
        d = np.abs(c[0](T) / y - 1)
        m = d.max()
        if best is None or m < best[0]:
            best = (m, c)
        w = w * (d / m + 1e-3) ** 0.5
        w /= w.mean()
    return best[1]


def fit_100(T, y, target):
    best = None
    for deg in range(1, 5):
        def once(w, deg=deg):
            M = np.vstack([T ** k for k in range(deg + 1)]).T
            x = _lstsq(M, np.ones_like(T), w / 1.0) if False else _lstsq(M / y[:, None], np.ones_like(T), w)
            return (lambda t, x=x: sum(x[k] * t ** k for k in range(len(x))), x)
        f, x = _minimax(once, T, y)
        m = rel_dev(f(T), y)
        c = {k: float(v) for k, v in zip("ABCDE", x)}
        if best is None or m < best[0] - 1e-12:
            best = (m, c)
        if m <= target / 4:
            break
    return best[1], {}


def fit_101(T, y, target, Es=(1, 2, 3, 4, 6, 10)):
    """ln y = A + B/T + C ln T + D T^E: linear in A-D for a given E; E from a grid, then refined."""
    from scipy.optimize import minimize_scalar
    ly = np.log(y)

    def for_E(E):
        def once(w):
            cols = [np.ones_like(T), 1 / T, np.log(T)] + ([T ** E] if E else [])
            x = _lstsq(np.vstack(cols).T, ly, w)
            c = {"A": x[0], "B": x[1], "C": x[2], "D": x[3] if E else 0.0, "E": float(E) if E else 0.0}
            return (lambda t, c=c: ev("DIPPR101", c, t), c)
        f, c = _minimax(once, T, y)
        return rel_dev(f(T), y), c

    best = min((for_E(E) for E in (None,) + tuple(Es)), key=lambda b: b[0])
    if best[0] > target / 4:
        # refine E continuously (rounded to 0.01 so the record stays readable)
        r = minimize_scalar(lambda E: for_E(round(E, 2))[0], bounds=(0.5, 12), method="bounded",
                            options={"xatol": 0.01})
        cand = for_E(round(r.x, 2))
        if cand[0] < best[0]:
            best = cand
    return {k: float(v) for k, v in best[1].items()}, {}


def _polish(model, p0, T, y, bounds=(-np.inf, np.inf), iters=15):
    """Reweighted nonlinear least squares on relative residuals, keeping the lowest maximum deviation."""
    best = None
    w = np.ones_like(T)
    p = np.array(p0, dtype=float)
    for _ in range(iters):
        def res(q, w=w):
            v = model(q)
            return w * (v / y - 1) if v is not None else np.full_like(T, 10.0)
        try:
            r = least_squares(res, p, bounds=bounds, max_nfev=3000)
        except Exception:
            break
        v = model(r.x)
        if v is None:
            break
        d = np.abs(v / y - 1)
        if best is None or d.max() < best[0]:
            best = (d.max(), r.x.copy())
        w = w * (d / d.max() + 1e-3) ** 0.5
        w /= w.mean()
        p = r.x
    return best


def fit_102(T, y, target):
    ly = np.log(y)
    x0 = _lstsq(np.vstack([np.ones_like(T), np.log(T)]).T, ly)
    Tm = T.mean()

    def model(p):
        den = 1 + p[2] / T + p[3] / T ** 2
        if np.any(den <= 0):
            return None
        return math.exp(p[0]) * T ** p[1] / den

    starts = []
    for C0 in (0.0, 0.3 * Tm, Tm, 3 * Tm, -0.3 * T.min()):
        for D0 in (0.0, 0.1 * Tm ** 2, -0.1 * T.min() ** 2, Tm ** 2):
            def res(p):
                v = model(p)
                return np.log(v) - ly if v is not None else np.full_like(T, 10.0)
            try:
                r = least_squares(res, [x0[0], x0[1], C0, D0], x_scale=[1, 0.1, Tm, Tm ** 2], max_nfev=20000)
            except Exception:
                continue
            v = model(r.x)
            if v is not None:
                starts.append((rel_dev(v, y), r.x))
    starts.sort(key=lambda s: s[0])
    best = starts[0]
    for m, p in starts[:4]:
        b = _polish(model, p, T, y)
        if b and b[0] < best[0]:
            best = b
    p = best[1]
    return {"A": float(math.exp(p[0])), "B": float(p[1]), "C": float(p[2]), "D": float(p[3])}, {}


def fit_105(T, y, target, Tc):
    ly = np.log(y)
    best = None
    for free_C in (False, True):
        def res(p):
            A, B, D = math.exp(p[0]), math.exp(p[1]), p[2]
            C = p[3] if free_C else Tc
            if C <= T.max():
                return np.full_like(T, 10.0)
            return np.log(A) - (1 + (1 - T / C) ** D) * np.log(B) - ly
        p0 = [math.log(y[0] * 0.27 ** 1.5), math.log(0.27), 0.28] + ([Tc] if free_C else [])
        r = least_squares(res, p0, max_nfev=20000)
        c = {"A": math.exp(r.x[0]), "B": math.exp(r.x[1]), "C": r.x[3] if free_C else Tc, "D": r.x[2]}
        m = rel_dev(ev("DIPPR105", c, T), y)
        if best is None or m < best[0]:
            best = (m, c, free_C)
        if m <= target / 4:
            break
    return {k: float(v) for k, v in best[1].items()}, {}


def fit_106(T, y, target, Tc):
    ly = np.log(y)
    r = T / Tc
    L = np.log(1 - r)
    best = None
    for nterms in range(1, 5):
        def once(w, n=nterms):
            cols = [np.ones_like(T)] + [L * r ** k for k in range(n)]
            x = _lstsq(np.vstack(cols).T, ly, w)
            c = {"A": math.exp(x[0])}
            for k, name in enumerate("BCDE"[:n]):
                c[name] = x[k + 1]
            return (lambda t, c=c: ev("DIPPR106", c, t, Tc), c)
        f, c = _minimax(once, T, y)
        m = rel_dev(f(T), y)
        if best is None or m < best[0] - 1e-12:
            best = (m, c)
        if m <= target / 4:
            break
    return {k: float(v) for k, v in best[1].items()}, {"Tc_K": Tc}


def fit_107(T, y, target):
    best = None
    lo, hi = y.min(), y.max()
    for C0 in (300.0, 800.0, 1500.0, 3000.0):
        for E0 in (100.0, 400.0, 800.0, 1500.0):
            for split in (0.3, 0.7):
                def res(p):
                    c = {"A": p[0], "B": p[1], "C": p[2], "D": p[3], "E": p[4]}
                    return ev("DIPPR107", c, T) / y - 1
                p0 = [lo * 0.9, (hi - lo) * 1.5, C0, (hi - lo) * split, E0]
                try:
                    r = least_squares(res, p0, bounds=([0, -np.inf, 1, -np.inf, 1], [np.inf] * 5),
                                      x_scale=[lo, hi, 1000, hi, 500], max_nfev=5000)
                except Exception:
                    continue
                c = {"A": r.x[0], "B": r.x[1], "C": r.x[2], "D": r.x[3], "E": r.x[4]}
                m = rel_dev(ev("DIPPR107", c, T), y)
                if best is None or m < best[0]:
                    best = (m, c)
    # polish for the maximum deviation
    m0, c0 = best
    p0 = [c0[k] for k in "ABCDE"]
    w = np.ones_like(T)
    for _ in range(15):
        def res(p, w=w):
            c = {"A": p[0], "B": p[1], "C": p[2], "D": p[3], "E": p[4]}
            return w * (ev("DIPPR107", c, T) / y - 1)
        r = least_squares(res, p0, bounds=([0, -np.inf, 1, -np.inf, 1], [np.inf] * 5), max_nfev=3000)
        c = {"A": r.x[0], "B": r.x[1], "C": r.x[2], "D": r.x[3], "E": r.x[4]}
        d = np.abs(ev("DIPPR107", c, T) / y - 1)
        if d.max() < best[0]:
            best = (d.max(), c)
        w = w * (d / d.max() + 1e-3) ** 0.5
        w /= w.mean()
        p0 = list(r.x)
    return {k: float(v) for k, v in best[1].items()}, {}


def fit_range(form, sample, Tmin, Tmax, target, Tc=None, step=0.05, max_trim=0.6, keep=()):
    """Fit over [Tmin, Tmax]; if the target is missed, trim the range from either end in steps of
    5 % of its span and keep the widest range that meets the target (lowest deviation among equals),
    preferring ranges that still contain the temperatures in `keep` (25 °C, normal boiling point).
    Returns T, y, coefficients, extra fields, max deviation, Tmin, Tmax and a note (or None)."""
    keep = [t for t in keep if Tmin <= t <= Tmax]
    span = Tmax - Tmin
    tried = {}

    def attempt(lo_k, hi_k):
        lo = math.ceil((Tmin + lo_k * step * span) * 100) / 100 if lo_k else Tmin
        hi = math.floor((Tmax - hi_k * step * span) * 100) / 100 if hi_k else Tmax
        T = grid(lo, hi)
        y = sample(T)
        c, extra = fit(form, T, y, target, Tc)
        m = rel_dev(ev(form, c, T, Tc), y)
        tried[(lo_k, hi_k)] = (T, y, c, extra, m, lo, hi)
        return tried[(lo_k, hi_k)]

    first = attempt(0, 0)
    if first[4] <= target:
        return first + (None,)
    nmax = int(round(max_trim / step))
    for strict in ((True, False) if keep else (False,)):
        for k in range(1, nmax + 1):
            ok = [tried.get((b, k - b)) or attempt(b, k - b) for b in range(k + 1)]
            ok = [o for o in ok if o[4] <= target and (not strict or all(o[5] <= t <= o[6] for t in keep))]
            if ok:
                best = min(ok, key=lambda o: o[4])
                note = ("range narrowed from %.2f-%.2f K (max deviation there %s %%) to meet the %g %% target"
                        % (Tmin, Tmax, pct(first[4]), target * 100))
                if keep and not strict:
                    note += "; the narrowed range no longer contains %s" % " and ".join("%.2f K" % t for t in keep)
                return best + (note,)
    return first + ("target of %g %% not met" % (target * 100),)



def fit(form, T, y, target, Tc=None):
    if form == "DIPPR100":
        return fit_100(T, y, target)
    if form == "DIPPR101":
        return fit_101(T, y, target)
    if form == "DIPPR102":
        return fit_102(T, y, target)
    if form == "DIPPR105":
        return fit_105(T, y, target, Tc)
    if form == "DIPPR106":
        return fit_106(T, y, target, Tc)
    if form == "DIPPR107":
        return fit_107(T, y, target)
    raise ValueError(form)

# ---------------------------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------------------------


class CoolPropFluid:
    def __init__(self, name):
        import CoolProp
        import CoolProp.CoolProp as CP
        self.CoolProp, self.CP, self.name = CoolProp, CP, name
        self.AS = CoolProp.AbstractState("HEOS", name)
        self.Ttriple, self.Tc, self.Tmax = self.AS.Ttriple(), self.AS.T_critical(), self.AS.Tmax()
        self.M = self.AS.molar_mass()  # kg/mol

    def keys(self, what):
        return [k.strip() for k in self.CP.get_fluid_param_string(self.name, "BibTeX-" + what).split(",") if k.strip()]

    def sat(self, T, Q):
        self.AS.update(self.CoolProp.QT_INPUTS, Q, T)
        return self.AS

    def dilute(self, T):
        """State at low pressure: 1 kPa, or 1 % of the vapour pressure if that is lower."""
        P = 1000.0
        if T < self.Tc:
            P = min(P, 0.01 * self.sat(T, 1).p())
        # density input: CoolProp refuses p below the triple-point pressure on the T = Ttriple isotherm
        self.AS.update(self.CoolProp.DmolarT_INPUTS, P / (8.314462618 * T), T)
        return self.AS

    def value(self, prop, T):
        if prop == "liquidDensity":
            return self.sat(T, 0).rhomass()
        if prop == "liquidHeatCapacity":
            return self.sat(T, 0).cpmolar()
        if prop == "heatOfVaporization":
            h1 = self.sat(T, 1).hmolar()
            return h1 - self.sat(T, 0).hmolar()
        if prop == "liquidViscosity":
            return self.sat(T, 0).viscosity()
        if prop == "liquidThermalConductivity":
            return self.sat(T, 0).conductivity()
        if prop == "surfaceTension":
            return self.sat(T, 0).surface_tension()
        if prop == "idealGasHeatCapacity":
            # cp0 depends on T only; the state is set by density, since CoolProp refuses p below the
            # triple-point pressure at the triple-point temperature (carbon monoxide)
            self.AS.update(self.CoolProp.DmolarT_INPUTS, 1000.0 / (8.314462618 * T), T)
            return self.AS.cp0molar()
        if prop == "vapourViscosity":
            return self.dilute(T).viscosity()
        if prop == "vapourThermalConductivity":
            return self.dilute(T).conductivity()
        if prop == "vapourPressure":
            return self.sat(T, 0).p()
        raise ValueError(prop)

    def what(self, prop):
        return {"liquidViscosity": "VISCOSITY", "vapourViscosity": "VISCOSITY",
                "liquidThermalConductivity": "CONDUCTIVITY", "vapourThermalConductivity": "CONDUCTIVITY",
                "surfaceTension": "SURFACE_TENSION"}.get(prop, "EOS")


class Bib:
    def __init__(self, path):
        import re
        self.re = re
        self.txt = Path(path).read_text(encoding="utf-8", errors="replace") if path else ""
        self.used = set()

    def surname(self, a):
        a = a.strip()
        return a.split(",")[0].strip() if "," in a else a.split()[-1]

    def short(self, key):
        """Short citation for a record: first author, journal, volume, year, pages, DOI."""
        self.used.add(key)
        return self.cite(key, short=True)

    def cite(self, key, short=False):
        re = self.re
        m = re.search(r"@\w+\{" + re.escape(key) + r",(.*?)\n\}", self.txt, re.S)
        if not m:
            return key
        body = m.group(1)

        def f(name):
            mm = re.search(r"\b" + name + r"\s*=\s*[{\"](.*?)[}\"],?\s*\n", body, re.S | re.I)
            if not mm:
                return ""
            s = " ".join(mm.group(1).split()).replace("{", "").replace("}", "")
            return s.replace("\\v s", "š").replace("\\~n", "ñ").replace("\\ss", "ß").replace("\\", "")
        authors = [a.strip() for a in f("author").split(" and ") if a.strip()]
        if not authors:  # an entry without authors (a report): its institution, or the key
            authors = [f("institution") or f("organization") or key]
            short = False if not f("author") else short
        if short:
            authors = [self.surname(a) for a in authors]
        au = authors[0] + (" et al." if len(authors) > 2 else (" and " + authors[1] if len(authors) == 2 else ""))
        parts = [au + ","] + ([] if short else [f("title") + ","])
        if f("journal"):
            parts.append("%s %s (%s) %s" % (f("journal"), f("volume"), f("year"), f("pages").replace("--", "-")))
        else:
            parts.append("%s (%s)" % (f("publisher"), f("year")))
        s = " ".join(p for p in parts if p.strip(", "))
        if f("doi"):
            s += ", doi:" + f("doi")
        return s.strip()


class ChemSep:
    """chemsep1.xml (v8.3) and, optionally, chemsep2.xml (v8.31 data 2, same databank and licence); a compound is
    taken from the first file that has it."""
    def __init__(self, paths):
        self.by_cas, self.file_of = {}, {}
        for i, path in enumerate(paths):
            for c in ET.parse(path).getroot().findall("compound"):
                cas = c.find("CAS")
                if cas is not None and cas.get("value") not in self.by_cas and (i == 0 or cas.get("value") in CHEMSEP2_USE):
                    self.by_cas[cas.get("value")] = c
                    self.file_of[cas.get("value")] = i

    def name(self, cas):
        return CHEMSEP2_NAME if self.file_of.get(cas) == 1 else CHEMSEP_NAME

    def ref(self, cas):
        return CHEMSEP2_REF if self.file_of.get(cas) == 1 else CHEMSEP_REF

    def compound(self, cas):
        c = self.by_cas.get(cas)
        if c is None:
            raise KeyError("CAS %s not in ChemSep file" % cas)
        return c

    def const(self, cas, tag):
        return float(self.compound(cas).find(tag).get("value"))

    def corr(self, cas, prop):
        if cas not in self.by_cas:   # a compound ChemSep does not include (propylene glycol): no record
            return None
        el = self.compound(cas).find(CHEMSEP_TAG[prop])
        if el is None or el.find("eqno") is None:
            return None
        d = {"eqno": int(el.find("eqno").get("value")), "units": el.get("units")}
        for k in "ABCDE":
            e = el.find(k)
            d[k] = float(e.get("value")) if e is not None else 0.0
        d["Tmin"] = float(el.find("Tmin").get("value"))
        d["Tmax"] = float(el.find("Tmax").get("value"))
        if d["eqno"] <= 4:
            # ChemSep equations 1-4 are polynomials of degree eqno - 1 (DWSIM, PropertyPackage.vb, CalcCSTDepProp): the
            # file may still carry higher coefficients (monoethanolamine, equation 4, has an E), which they do not use
            for k in "ABCDE"[d["eqno"]:]:
                d[k] = 0.0
        return d

    def value_si(self, cas, prop, T):
        """ChemSep correlation in Fugacity's record units (mol basis)."""
        d = self.corr(cas, prop)
        eq = {1: "DIPPR100", 2: "DIPPR100", 3: "DIPPR100", 4: "DIPPR100", 10: "CS10", 16: "CS16", 116: "CS116", 100: "DIPPR100", 101: "DIPPR101", 102: "DIPPR102", 105: "DIPPR105",
              106: "DIPPR106", 107: "DIPPR107"}[d["eqno"]]
        y = ev(eq, d, T, self.const(cas, "CriticalTemperature"))
        return y * unit_factor(d["units"], prop, self.const(cas, "MolecularWeight"))


def unit_factor(units, prop, MW):
    """Factor from ChemSep units to Fugacity record units."""
    table = {("kmol/m3", "liquidDensity"): MW, ("J/kmol", "heatOfVaporization"): 1e-3,
             ("J/kmol/K", "liquidHeatCapacity"): 1e-3, ("J/kmol/K", "idealGasHeatCapacity"): 1e-3,
             ("Pa.s", "liquidViscosity"): 1, ("Pa.s", "vapourViscosity"): 1,
             ("W/m/K", "liquidThermalConductivity"): 1, ("W/m/K", "vapourThermalConductivity"): 1,
             ("N/m", "surfaceTension"): 1, ("Pa", "vapourPressure"): 1}
    return table[(units, prop)]


CHEMSEP_NAME = "ChemSep v8.3 pure-component database"
CHEMSEP_REF = ("Kooijman and Taylor, ChemSep v8.3, chemsep1.xml (2021), "
               "via https://github.com/DanWBR/dwsim (DWSIM.Thermodynamics/Assets/Databases)")
CHEMSEP_REF_FULL = ("H. Kooijman, R. Taylor, ChemSep pure-component database v8.3, file chemsep1.xml (2021), "
                    "Artistic License 2.0, as redistributed in DWSIM, https://github.com/DanWBR/dwsim, "
                    "DWSIM.Thermodynamics/Assets/Databases/chemsep1.xml")
CHEMSEP2_NAME = "ChemSep v8.31 pure-component database, data file 2"
# compounds taken from chemsep2.xml: N-methyl-2-pyrrolidone (proposal 0008), and propylene glycol, a CoolProp fluid
# whose viscosities, thermal conductivities and surface tension CoolProp 8.0.0 does not model (chemsep1.xml does not
# have it)
CHEMSEP2_USE = {"872-50-4", "57-55-6", "64-18-6", "7722-84-1"}  # and formic acid, hydrogen peroxide (batch 2)
CHEMSEP2_REF = ("Kooijman and Taylor, ChemSep v8.31 pure component data 2, chemsep2.xml (2022), "
                "via https://github.com/DanWBR/dwsim (DWSIM.Thermodynamics/Assets/Databases)")
CHEMSEP_ACCESS = "Artistic License 2.0"
COOLPROP_ACCESS = "MIT (open source)"
WEBBOOK_ACCESS = "free to read (NIST SRD 69)"

# ---------------------------------------------------------------------------------------------
# Building the records
# ---------------------------------------------------------------------------------------------


def pct(m):
    """Maximum deviation, rounded up, as text."""
    p = m * 100
    if p < 1e-4:
        return "0.0001"
    digits = max(0, 2 - int(math.floor(math.log10(p))) - 1)
    q = math.ceil(p * 10 ** digits) / 10 ** digits
    return ("%." + str(digits) + "f") % q


def rnd(x, sig=10):
    return float("%.*g" % (sig, x))


def grid(Tmin, Tmax, n=N_FIT):
    return np.linspace(Tmin, Tmax, n)


def store_idx(n=N_FIT, k=N_STORE):
    return sorted(set(np.round(np.linspace(0, n - 1, k)).astype(int).tolist()))


class Builder:
    def __init__(self, comps, chemsep, bib):
        self.comps, self.cs, self.bib = comps, chemsep, bib
        self.cp = {}
        self.log = []

    def coolprop(self, cid):
        if cid not in self.cp:
            self.cp[cid] = CoolPropFluid(COOLPROP[cid])
        return self.cp[cid]

    def coolprop_ranges(self, F, prop):
        Tt = math.ceil(F.Ttriple * 100) / 100
        if prop in LIQUID_SIDE:
            return Tt, math.floor(0.95 * F.Tc * 100) / 100, "triple point to 0.95 Tc"
        if prop == "idealGasHeatCapacity":
            return Tt, min(F.Tmax, 1500.0), "triple point to %s" % ("the upper limit of the equation of state"
                                                                    if F.Tmax <= 1500 else "1500 K")
        if prop in ("vapourViscosity", "vapourThermalConductivity"):
            return Tt, min(F.Tmax, 1000.0), "triple point to %s" % ("the upper limit of the equation of state"
                                                                    if F.Tmax <= 1000 else "1000 K")
        if prop == "vapourPressure":
            return math.ceil(F.Ttriple * 1000) / 1000, math.floor(F.Tc * 1000) / 1000, "triple point to critical point"
        raise ValueError(prop)

    def from_coolprop(self, cid, prop):
        F = self.coolprop(cid)
        Tmin, Tmax, why = self.coolprop_ranges(F, prop)
        target = 0.03 if prop in TRANSPORT else 0.01
        form = FORM[prop]
        Tc = rnd(F.Tc, 8)
        sample = lambda T: np.array([F.value(prop, t) for t in T])  # noqa: E731
        keep = keep_T(self.comps[cid])
        T0, T1 = Tmin, Tmax
        start_note = None
        if prop in ("vapourViscosity", "vapourThermalConductivity"):
            # CoolProp's corresponding-states transport model (propylene) does not converge for the dilute gas
            # at the lowest temperatures, where the vapour pressure is tiny: start where it does
            Tg = grid(T0, T1)
            ok = []
            for tq in Tg:
                try:
                    F.value(prop, tq)
                    ok.append(True)
                except ValueError:
                    ok.append(False)
            if not all(ok):
                first = next(i for i in range(len(Tg)) if all(ok[i:]))
                T0 = math.ceil(Tg[first] * 100) / 100
                start_note = ("starts at %.2f K: below it the CoolProp transport model does not converge for the "
                              "dilute gas" % T0)
        Tg = grid(T0, T1)
        yg = sample(Tg)
        if prop == "idealGasHeatCapacity" and np.ptp(yg) <= 1e-9 * np.mean(yg):
            # a monatomic gas (argon): cp0 = 5/2 R at every temperature, a constant (DIPPR 100, A only)
            form, c, extra = "DIPPR100", {"A": float(np.mean(yg))}, {}
            T, y, Tmin, Tmax, narrowed = Tg, yg, T0, T1, None
            m = rel_dev(ev(form, c, T), y)
        else:
            T, y, c, extra, m, Tmin, Tmax, narrowed = fit_range(form, sample, T0, T1, target, Tc, keep=keep)
        if narrowed and prop == "liquidDensity":
            # DIPPR105 cannot follow a density maximum (water at 4 °C): try the DIPPR100 polynomial
            alt = fit_range("DIPPR100", sample, T0, T1, target, Tc, keep=keep)
            if not alt[-1]:
                T, y, c, extra, m, Tmin, Tmax, _ = alt
                form = "DIPPR100"
                narrowed = ("DIPPR100 used because DIPPR105 does not meet the 1 %% target over %.2f-%.2f K "
                            "(it cannot follow the density maximum of water)" % (T0, T1))
        if start_note:
            narrowed = (narrowed + "; " if narrowed else "") + start_note
        if narrowed and prop == "liquidViscosity" and Tmin > T0:
            narrowed += ("; DIPPR 101 cannot follow the steep rise of the viscosity towards the triple point, "
                         "so this range starts above the triple point (%.2f K)" % T0)
        keys = F.keys(F.what(prop))
        eos = F.keys("EOS")
        ref = "; ".join(self.bib.short(k) for k in keys)
        how = {
            "liquidDensity": "saturated liquid density",
            "liquidHeatCapacity": "cp of the saturated liquid",
            "heatOfVaporization": "h(saturated vapour) - h(saturated liquid)",
            "liquidViscosity": "saturated liquid",
            "liquidThermalConductivity": "saturated liquid",
            "surfaceTension": "surface tension",
            "idealGasHeatCapacity": "cp0molar",
            "vapourViscosity": "dilute gas (1 kPa, or 1 % of Psat if lower)",
            "vapourThermalConductivity": "dilute gas (1 kPa, or 1 % of Psat if lower)",
            "vapourPressure": "saturation pressure",
        }[prop]
        name = "CoolProp 8.0.0 (%s: %s)" % (F.name, ", ".join(keys))
        if cid == "water":
            name += {"EOS": " = IAPWS-95", "VISCOSITY": " = IAPWS 2008 viscosity formulation",
                     "CONDUCTIVITY": " = IAPWS 2011 thermal conductivity formulation",
                     "SURFACE_TENSION": ""}[F.what(prop)]
        fit_text = "%d points %.2f-%.2f K%s, max deviation %s %%" % (
            len(T), Tmin, Tmax, "" if narrowed else " (%s)" % why, pct(m))
        if narrowed:
            fit_text += "; " + narrowed
        source = {"name": name, "reference": ref, "access": COOLPROP_ACCESS,
                  "quantity": how, "fit": fit_text}
        return self._record(cid, prop, form, c, extra, Tmin, Tmax, "fitted", source, T, y, m, target)

    def from_webbook(self, cid, prop):
        W = WEBBOOK_CP0[cid]
        if "shomate" in W:
            s = W["shomate"]
            T = grid(s["Tmin"], s["Tmax"])
            t = T / 1000
            y = s["A"] + s["B"] * t + s["C"] * t ** 2 + s["D"] * t ** 3 + s["E"] / t ** 2
            Tmin, Tmax = s["Tmin"], s["Tmax"]
            npts = "%d points sampled from the Shomate equation" % len(T)
        else:
            T = np.array([p[0] for p in W["table"]])
            y = np.array([p[1] for p in W["table"]])
            Tmin, Tmax = float(T.min()), float(T.max())
            npts = "%d tabulated points" % len(T)
        c, extra = fit("DIPPR107", T, y, 0.01)
        m = rel_dev(ev("DIPPR107", c, T), y)
        source = {"name": "NIST Chemistry WebBook", "reference": W["reference"], "url": W["url"],
                  "access": WEBBOOK_ACCESS, "fit": "%s, %.2f-%.2f K, max deviation %s %%" % (npts, Tmin, Tmax, pct(m)),
                  "notes": W["notes"], "chain": chain_note(cid, prop)}
        rec = self._record(cid, prop, "DIPPR107", c, extra, Tmin, Tmax, "fitted", source, T, y, m, 0.01,
                           store_all="shomate" not in W)
        if "check" in W:
            Tc_ = np.array([p[0] for p in W["check"]])
            yc = np.array([p[1] for p in W["check"]])
            dev = ev("DIPPR107", c, Tc_) / yc - 1
            self.log.append("  cross-check %s cp0 vs %s: deviations %s %%" % (
                cid, W["check_reference"], ", ".join("%.2f" % (100 * d) for d in dev)))
            rec[1]["crossCheck"] = {"reference": W["check_reference"], "T_K": Tc_.tolist(), "values": yc.tolist(),
                                    "deviation_percent": [round(100 * d, 2) for d in dev]}
        return rec

    def from_webbook_fluid(self, cid, prop):
        W = WEBBOOK_FLUID[cid]
        D = json.loads((WEBBOOK_FLUID_DIR / ("%s.json" % cid)).read_text())
        liquid = prop in LIQUID_SIDE
        tab = D["saturation"] if liquid else D["dilute"]
        col = {"liquidViscosity": "Viscosity (l, Pa*s)", "liquidThermalConductivity": "Therm. Cond. (l, W/m*K)",
               "vapourViscosity": "Viscosity (Pa*s)", "vapourThermalConductivity": "Therm. Cond. (W/m*K)"}[prop]
        i, j = tab["columns"].index("Temperature (K)"), tab["columns"].index(col)
        # the liquid side ends at 0.95 Tc, as for every other record
        T95 = math.floor(0.95 * self.coolprop(cid).Tc * 100) / 100
        rows = [(r[i], r[j]) for r in tab["rows"] if isinstance(r[j], float) and r[i] <= T95]
        if not liquid:
            k = tab["columns"].index("Phase")
            rows = [(r[i], r[j]) for r in tab["rows"] if isinstance(r[j], float) and r[k] in ("vapor", "supercritical")]
        T = np.array([r[0] for r in rows])
        y = np.array([r[1] for r in rows])
        target = 0.03
        form = FORM[prop]
        # fit_range samples its own grid: linear interpolation between the (dense, about 120) tabulated
        # points; the deviation reported below is then recomputed at the tabulated points themselves
        sample = lambda Tq: np.interp(Tq, T, y)  # noqa: E731
        Tc = rnd(self.coolprop(cid).Tc, 8)
        lo, hi = float(T.min()), float(T.max())
        T2, y2, c, extra, m, Tmin, Tmax, narrowed = fit_range(form, sample, lo, hi, target, Tc,
                                                              keep=keep_T(self.comps[cid]))
        sel = (T >= Tmin - 1e-9) & (T <= Tmax + 1e-9)
        T, y = T[sel], y[sel]
        m = rel_dev(ev(form, c, T, extra.get("Tc_K")), y)
        how = "saturated liquid" if liquid else "dilute gas, %g kPa isobar" % (1000 * WEBBOOK_DILUTE_MPa)
        source = {"name": "NIST Chemistry WebBook, fluid tables (%s)" % how, "reference": W["reference"],
                  "url": D["urls"]["saturation" if liquid else "dilute"], "access": WEBBOOK_ACCESS,
                  "fit": "%d tabulated points %.2f-%.2f K, max deviation %s %%%s" % (
                      len(T), Tmin, Tmax, pct(m), ("; " + narrowed) if narrowed else ""),
                  "notes": W["notes"] + " Tables downloaded %s (validation/data/pure/webbook_fluid/%s.json)." % (
                      D["retrieved"], cid),
                  "chain": chain_note(cid, prop)}
        return self._record(cid, prop, form, c, extra, Tmin, Tmax, "fitted", source, T, y, m, target, store_all=True)

    def from_chemsep(self, cid, prop):
        cas = self.comps[cid]["cas"]
        d = self.cs.corr(cas, prop)
        if d is None:
            return None
        MW = self.cs.const(cas, "MolecularWeight")
        Tc = self.cs.const(cas, "CriticalTemperature")
        f = unit_factor(d["units"], prop, MW)
        Tmin, Tmax = d["Tmin"], d["Tmax"]
        conv = ""
        if prop in LIQUID_SIDE and Tmax > Tc:
            Tmax = Tc
            conv += "Tmax limited to the ChemSep critical temperature %.2f K (ChemSep: %.2f K). " % (Tc, d["Tmax"])
        if prop in LIQUID_SIDE:
            Tt = self.cs.const(cas, "TriplePointTemperature")
            if cid in COOLPROP:
                Tt = max(Tt, self.coolprop(cid).Ttriple)
            Tt = math.ceil(Tt * 100) / 100
            if Tmin < Tt:
                Tmin = Tt
                conv += "Tmin raised to the triple point %.2f K (ChemSep: %.2f K). " % (Tt, d["Tmin"])
        target = 0.03 if prop in TRANSPORT else 0.01
        chain = chain_note(cid, prop)
        if d["eqno"] in (1, 2, 3, 4, 100, 101, 102, 105, 106, 107):
            # ChemSep equations 1-4 are the polynomials A, A + B T, A + B T + C T^2, A + ... + D T^3: DIPPR 100
            form = "DIPPR%d" % (100 if d["eqno"] <= 4 else d["eqno"])
            c = {k: d[k] for k in "ABCDE"}
            if form in ("DIPPR102", "DIPPR105"):
                c.pop("E")
            if d["eqno"] <= 4:
                conv += "ChemSep equation %d is DIPPR 100 with the higher coefficients zero. " % d["eqno"]
            if form == "DIPPR100" and f != 1:  # (chemsep2.xml: N-methyl-2-pyrrolidone)
                c = {k: v * f for k, v in c.items()}
                conv += "coefficients converted from J/kmol/K to J/mol/K."
            elif form == "DIPPR107" and f != 1:
                c.update({k: d[k] * f for k in "ABD"})
                conv += "A, B and D converted from J/kmol/K to J/mol/K."
            elif form == "DIPPR105":
                c["A"] = d["A"] * f
                conv += "A converted from kmol/m3 to kg/m3 with the ChemSep molar mass %.4f kg/kmol." % MW
            elif form == "DIPPR106":
                c["A"] = d["A"] * f
                conv += "A converted from J/kmol to J/mol."
            elif f != 1:
                raise ValueError("unexpected units")
            extra = {"Tc_K": Tc} if form == "DIPPR106" else {}
            if form == "DIPPR106" and Tmax >= Tc:
                Tmax = math.floor(0.999 * Tc * 100) / 100
            if form == "DIPPR105" and Tmax > c["C"]:
                # the equation's own critical temperature C is below the end of its ChemSep range (hydrogen peroxide,
                # chemsep2.xml): (1 - T/C) is negative beyond it
                Tmax = math.floor(0.999 * c["C"] * 100) / 100
                conv += "Tmax lowered to %.2f K, below the equation's C = %.2f K (ChemSep range to %.2f K). " % (
                    Tmax, c["C"], d["Tmax"])
            T = grid(Tmin, Tmax)
            y = self.cs.value_si(cas, prop, T)
            if form == "DIPPR100" and np.any(y <= 0):
                # a polynomial that reaches zero inside its ChemSep range (formic acid surface tension, chemsep2.xml,
                # near the critical point): the record ends at 0.95 times the temperature where it first does
                T0 = float(T[np.argmax(y <= 0)])
                Tmax = math.floor(0.95 * T0 * 100) / 100
                conv += ("Tmax lowered to %.2f K: the ChemSep polynomial reaches zero at %.1f K (ChemSep range to %.2f K). "
                         % (Tmax, T0, d["Tmax"]))
                T = grid(Tmin, Tmax)
                y = self.cs.value_si(cas, prop, T)
            m = rel_dev(ev(form, c, T, Tc), y)
            source = {"name": self.cs.name(cas), "reference": self.cs.ref(cas), "access": CHEMSEP_ACCESS,
                      "fit": ("ChemSep equation %d coefficients taken over unchanged%s; reproduces ChemSep within "
                              "%s %% at %d points %.2f-%.2f K" % (d["eqno"], (" except: " + conv.strip()) if conv else "",
                                                                   pct(m), len(T), Tmin, Tmax)),
                      "chain": chain}
            return self._record(cid, prop, form, c, extra, Tmin, Tmax, "databank", source, T, y, m, target)
        if d["eqno"] not in (10, 16, 116):
            raise ValueError("ChemSep equation %d for %s %s" % (d["eqno"], cid, prop))
        form = FORM[prop]
        why = "ChemSep range" + (", Tmin raised to the triple point" if Tmin > d["Tmin"] else "")
        if prop in LIQUID_SIDE and Tmax > 0.95 * Tc:
            Tmax = math.floor(0.95 * Tc * 100) / 100
            why += ", limited to 0.95 Tc"
        T, y, c, extra, m, Tmin, Tmax, narrowed = fit_range(
            form, lambda T: self.cs.value_si(cas, prop, T), Tmin, Tmax, target, Tc,
            keep=keep_T(self.comps[cid]))
        source = {"name": self.cs.name(cas), "reference": self.cs.ref(cas), "access": CHEMSEP_ACCESS,
                  "fit": ("refitted in the %s form to ChemSep equation %s, %s, converted to the mol basis): %d points "
                          "%.2f-%.2f K (%s), max deviation %s %%%s"
                          % (form, {16: "16 (Y = A + exp(B/T + C + D T + E T^2)",
                                    116: "116 (Y = A + B t^0.35 + C t^(2/3) + D t + E t^(4/3), t = 1 - T/Tc",
                                    10: "10 (Y = exp(A - B/(T + C))"}[d["eqno"]], d["units"], len(T), Tmin, Tmax, why, pct(m),
                             ("; " + narrowed) if narrowed else "")),
                  "chain": chain}
        return self._record(cid, prop, form, c, extra, Tmin, Tmax, "fitted", source, T, y, m, target)

    def _record(self, cid, prop, form, c, extra, Tmin, Tmax, tier, source, T, y, m, target, store_all=False):
        coeffs = {k: rnd(v) for k, v in c.items() if k in "ABCDE"}
        if form == "DIPPR101" and coeffs.get("E", 0) == 0 and coeffs.get("D", 0) == 0:
            coeffs.pop("E", None)
        rec = {"equation": form, "coefficients": coeffs, "units": UNITS[prop],
               "Tmin_K": rnd(Tmin, 8), "Tmax_K": rnd(Tmax, 8)}
        if "Tc_K" in extra:
            rec["Tc_K"] = rnd(extra["Tc_K"], 10)
        rec["tier"] = tier
        rec["source"] = {k: v for k, v in source.items() if v}
        # deviation of the rounded coefficients
        m2 = rel_dev(ev(form, coeffs, T, rec.get("Tc_K")), y)
        if m2 > m * 1.001 + 1e-7:
            raise RuntimeError("%s %s: rounding the coefficients changed the deviation (%g -> %g)" % (cid, prop, m, m2))
        idx = list(range(len(T))) if store_all else store_idx(len(T))
        # also at the stored points (T and values rounded to 8 digits), which the test checks
        Ts = np.array([rnd(float(T[i]), 8) for i in idx])
        ys = np.array([rnd(float(y[i]), 8) for i in idx])
        m3 = rel_dev(ev(form, coeffs, Ts, rec.get("Tc_K")), ys)
        if max(m2, m3) > m and pct(max(m2, m3)) != pct(m):
            # state the deviation of the stored (rounded) coefficients
            rec["source"]["fit"] = rec["source"]["fit"].replace("max deviation %s %%" % pct(m),
                                                                "max deviation %s %%" % pct(max(m2, m3)))
            m = max(m2, m3)
        pts = {"units": UNITS[prop], "source": rec["source"],
               "T_K": [rnd(float(T[i]), 8) for i in idx], "values": [rnd(float(y[i]), 8) for i in idx]}
        flag = "" if m <= target else "   <-- above target %g %%" % (target * 100)
        self.log.append("%-16s %-27s %-9s %-8s %7.2f-%7.2f K  max dev %8s %%%s" % (
            cid, prop, form, tier, Tmin, Tmax, pct(m), flag))
        return rec, pts

    def from_measured(self, cid, prop):
        """A record fitted to the measured values of the ThermoML Archive (MEASURED_REFIT), with the rules of
        measured_components.py; the databank record it replaces is compared in the record."""
        from measured_components import ThermoML, fit_measured_loose
        tml = ThermoML(cid)
        cas = self.comps[cid]["cas"]
        Tc = self.coolprop(cid).Tc if cid in COOLPROP else self.cs.const(cas, "CriticalTemperature")
        form = FORM[prop]
        target = 0.03 if prop in TRANSPORT else 0.01
        coeffs, use, kept, exc, m = fit_measured_loose(cid, prop, form, tml.values(prop), target, Tc=Tc)
        T = np.array([p["T"] for p in use])
        y = np.array([p["y"] for p in use])
        Tall = [p["T"] for p in use + kept]
        refs = []
        for p in use + kept:
            if tml.cite(p["doi"]) not in refs:
                refs.append(tml.cite(p["doi"]))
        old = None
        if self.cs.corr(cas, prop):
            d = self.cs.corr(cas, prop)
            inside = (T >= d["Tmin"]) & (T <= d["Tmax"])
            if inside.any():
                dd = self.cs.value_si(cas, prop, T[inside]) / y[inside] - 1
                old = "%+.1f %% (median, %+.1f %% at most)" % (100 * float(np.median(dd)), 100 * float(dd[np.argmax(np.abs(dd))]))
        source = {"name": "Measured values (NIST TRC ThermoML Archive)", "reference": "; ".join(refs),
                  "access": "open data (NIST TRC ThermoML Archive), free to read even where the article is not",
                  "fit": "%d measured values with stated uncertainties within %g %% from %d articles, %.2f-%.2f K, max "
                         "deviation %s %%%s" % (len(use), 100 * target, len({p["doi"] for p in use}), T.min(), T.max(), pct(m),
                                               "; %d values with larger stated uncertainties agree within them" % len(kept)
                                               if kept else ""),
                  "notes": "Fitted to measured data instead of the databank: %s%s. Rules: "
                           "validation/python/measured_components.py." % (
                               MEASURED_REFIT[cid][prop], "; the databank record deviates from these values by %s" % old
                               if old else ""),
                  "chain": "Measured data (ThermoML Archive) above the databank: see docs/MEASURED_CHECKS.md"}
        if exc:
            source["excluded"] = [{"T_K": p["T"], "value": rnd(p["y"], 8), "reference": p["ref"],
                                   "deviation_percent": p["deviation_percent"], "why": p["why"]} for p in exc]
        extra = {"Tc_K": rnd(Tc, 10)} if form == "DIPPR106" else {}
        rec, pts = self._record(cid, prop, form, coeffs, extra, min(Tall), max(Tall), "fitted", source, T, y, m, target,
                                store_all=True)
        return rec, pts

    def build(self, cid, prop):
        src = chosen_source(cid, prop)
        if src == "measured":
            return self.from_measured(cid, prop)
        if src == "coolprop":
            return self.from_coolprop(cid, prop)
        if src == "webbook":
            return self.from_webbook(cid, prop)
        if src == "webbook-fluid":
            return self.from_webbook_fluid(cid, prop)
        r = self.from_chemsep(cid, prop)
        if r is None:
            searched = ["CoolProp 8.0.0 (no model for this property)", "NIST Chemistry WebBook (not a WebBook fluid)",
                        CHEMSEP_NAME + (" (compound not included)" if self.comps[cid]["cas"] not in self.cs.by_cas else
                                        " (no correlation)")]
            self.log.append("%-16s %-27s no open data" % (cid, prop))
            return {"available": False, "searched": searched}, None
        return r

    def vapour_pressure(self, cid):
        """DIPPR101 vapour pressure, triple point to critical point: fitted to CoolProp, or taken over from
        ChemSep for a component that is not a CoolProp fluid."""
        if cid not in COOLPROP:
            return self.vapour_pressure_chemsep(cid)
        F = self.coolprop(cid)
        Tmin, Tmax, why = self.coolprop_ranges(F, "vapourPressure")
        T = grid(Tmin, Tmax)
        y = np.array([F.value("vapourPressure", t) for t in T])
        c, _ = fit_101(T, y, 0.01, Es=(1, 2, 3, 4, 5, 6, 8, 10))
        m = rel_dev(ev("DIPPR101", c, T), y)
        T00 = Tmin
        while m > 0.01 and Tmin < 298.15:
            # one DIPPR 101 curve cannot follow the steep low end (propylene glycol near its triple point, where the
            # pressure is below 1 Pa): raise the lower limit in steps of 5 K, at most to 25 degC
            Tmin = min(298.15, Tmin + 5.0)
            T = grid(Tmin, Tmax)
            y = np.array([F.value("vapourPressure", t) for t in T])
            c, _ = fit_101(T, y, 0.01, Es=(1, 2, 3, 4, 5, 6, 8, 10))
            m = rel_dev(ev("DIPPR101", c, T), y)
        if Tmin > T00:
            why = ("narrowed: from the triple point (%.2f K, where the pressure is %.2g Pa) one DIPPR 101 curve does "
                   "not meet the 1 %% target; it starts at %.2f K" % (T00, F.value("vapourPressure", T00), Tmin))
        keys = F.keys("EOS")
        coeffs = {k: rnd(v) for k, v in c.items()}
        m2 = rel_dev(ev("DIPPR101", coeffs, T), y)
        tb = self.comps[cid]["Tb_K"]
        source = ("Fitted to the saturation pressure of CoolProp 8.0.0 (%s: equation of state %s; %s); "
                  "%d points %.3f-%.3f K (%s), max deviation %s %%." % (
                      F.name, ", ".join(keys), "; ".join(self.bib.short(k) for k in keys), len(T), Tmin, Tmax, why,
                      pct(max(m, m2))))
        rec = {"equation": "DIPPR101", "form": "ln(P/Pa) = A + B/T + C ln T + D T^E", "units": "Pa",
               "A": coeffs["A"], "B": coeffs["B"], "C": coeffs["C"], "D": coeffs["D"], "E": coeffs["E"],
               "Tmin_K": rnd(Tmin, 8), "Tmax_K": rnd(Tmax, 8), "tier": "fitted", "source": source}
        idx = store_idx(len(T))
        # also store the normal boiling point from the same source, for the test
        pts = {"units": "Pa", "source": {"name": "CoolProp 8.0.0 (%s)" % F.name, "fit": source},
               "T_K": [rnd(float(T[i]), 8) for i in idx], "values": [rnd(float(y[i]), 8) for i in idx],
               "Tb_K_at_101325Pa": tb}
        self.log.append("%-16s %-27s %-9s %-8s %7.2f-%7.2f K  max dev %8s %%" % (
            cid, "vapourPressure", "DIPPR101", "fitted", Tmin, Tmax, pct(max(m, m2))))
        return rec, pts

    def vapour_pressure_antoine(self, cid):
        """DIPPR101 fitted to a WebBook Antoine set (sampled over its range) and the ChemSep critical point."""
        W = json.loads(WEBBOOK_ANTOINE_FILE.read_text())[cid]
        s = next(x for x in W["sets"] if x["reference"] == VP_FROM_ANTOINE[cid])
        cas = self.comps[cid]["cas"]
        Tc, Pc = self.cs.const(cas, "CriticalTemperature"), self.cs.const(cas, "CriticalPressure")
        Ta = grid(s["Tmin_K"], s["Tmax_K"], 60)
        ya = 1e5 * 10 ** (s["A"] - s["B"] / (Ta + s["C"]))
        T = np.append(Ta, Tc)
        y = np.append(ya, Pc)
        c, _ = fit_101(T, y, 0.01, Es=(1, 2, 3, 4, 5, 6, 8, 10))
        coeffs = {k: rnd(v) for k, v in c.items()}
        m = rel_dev(ev("DIPPR101", coeffs, T), y)
        ma = rel_dev(ev("DIPPR101", coeffs, Ta), ya)
        pc_dev = float(ev("DIPPR101", coeffs, np.array([Tc]))[0] / Pc - 1)
        cs_curve = self.cs.corr(cas, "vapourPressure")
        source = ("Fitted to the Antoine equation of %s (log10(P/bar) = %g - %g/(T/K %+g), %.2f-%.2f K, coefficients "
                  "calculated by NIST from the authors' data; NIST Chemistry WebBook (SRD 69), %s), sampled at %d "
                  "points, and to the ChemSep v8.3 critical point (%.2f K, %.0f Pa): max deviation %s %% from the "
                  "Antoine equation, %+.2f %% at the critical point. Range %.2f-%.2f K: below %.2f K there are no "
                  "measured data in the WebBook; between %.2f K and the critical point the curve is held only by the "
                  "critical point. The ChemSep vapour-pressure equation was not used: it gives %.2f K at 101.325 kPa "
                  "against the measured %.2f K, and it diverges above about 420 K (%.3g Pa at the critical "
                  "temperature, against the critical pressure %.3g Pa)."
                  % (s["reference"], s["A"], s["B"], s["C"], s["Tmin_K"], s["Tmax_K"], W["url"], len(Ta), Tc, Pc,
                     pct(ma), 100 * pc_dev, s["Tmin_K"], Tc, s["Tmin_K"], s["Tmax_K"],
                     brent_tb(cs_curve), self.comps[cid]["Tb_K"],
                     float(self.cs.value_si(cas, "vapourPressure", np.array([Tc]))[0]), Pc))
        rec = {"equation": "DIPPR101", "form": "ln(P/Pa) = A + B/T + C ln T + D T^E", "units": "Pa",
               "A": coeffs["A"], "B": coeffs["B"], "C": coeffs["C"], "D": coeffs["D"], "E": coeffs["E"],
               "Tmin_K": rnd(s["Tmin_K"], 8), "Tmax_K": rnd(Tc, 8), "tier": "fitted", "source": source}
        checks = []
        for o in W["sets"]:
            if o is s:
                continue
            Tq = np.linspace(o["Tmin_K"], o["Tmax_K"], 21)
            dev = ev("DIPPR101", coeffs, Tq) / (1e5 * 10 ** (o["A"] - o["B"] / (Tq + o["C"]))) - 1
            k = int(np.argmax(np.abs(dev)))
            checks.append({"reference": o["reference"] + " (Antoine equation, NIST WebBook)", "url": W["url"],
                           "T_range_K": [o["Tmin_K"], o["Tmax_K"]], "max_deviation_percent": round(100 * float(dev[k]), 2)})
            self.log.append("  cross-check %s vapour pressure vs %s, %.2f-%.2f K: max %+.2f %% at %.1f K" % (
                cid, o["reference"], o["Tmin_K"], o["Tmax_K"], 100 * dev[k], Tq[k]))
        Tq = np.linspace(s["Tmin_K"], Tc, 21)
        dev = ev("DIPPR101", coeffs, Tq) / self.cs.value_si(cas, "vapourPressure", Tq) - 1
        k = int(np.argmax(np.abs(dev)))
        checks.append({"reference": CHEMSEP_NAME + ", vapour pressure (equation 101)",
                       "T_range_K": [s["Tmin_K"], Tc], "max_deviation_percent": round(100 * float(dev[k]), 2)})
        self.log.append("  cross-check %s vapour pressure vs ChemSep, %.2f-%.2f K: max %+.2f %% at %.1f K" % (
            cid, s["Tmin_K"], Tc, 100 * dev[k], Tq[k]))
        rec["crossCheck"] = checks
        idx = list(range(len(T)))
        pts = {"units": "Pa", "source": {"name": "NIST Chemistry WebBook (Antoine equation) and ChemSep critical point",
                                         "fit": source},
               "T_K": [rnd(float(T[i]), 8) for i in idx], "values": [rnd(float(y[i]), 8) for i in idx],
               "Tb_K_at_101325Pa": self.comps[cid]["Tb_K"]}
        self.log.append("%-16s %-27s %-9s %-8s %7.2f-%7.2f K  max dev %8s %%" % (
            cid, "vapourPressure", "DIPPR101", "fitted", s["Tmin_K"], Tc, pct(m)))
        return rec, pts

    def vapour_pressure_measured(self, cid):
        """DIPPR101 fitted to the measured vapour pressures of the ThermoML Archive (validation/data/pure/measured/
        thermoml_<id>.json, from check_measured.py) and the ChemSep critical point, with the rules of
        measured_components.py; values whose stated uncertainty is above 1 % stay only where they agree within it."""
        from measured_components import ThermoML, fit_measured_loose
        tml = ThermoML(cid)
        cas = self.comps[cid]["cas"]
        Tc, Pc = self.cs.const(cas, "CriticalTemperature"), self.cs.const(cas, "CriticalPressure")
        crit = {"T": Tc, "y": Pc, "u_rel": None, "ref": "%s critical point" % self.cs.name(cas), "doi": None}
        pts = tml.values("vapourPressure")
        # measured Antoine equations of the NIST WebBook, where the ThermoML values alone are too few (phenol)
        W = json.loads(WEBBOOK_ANTOINE_FILE.read_text()).get(cid, {}) if WEBBOOK_ANTOINE_FILE.exists() else {}
        for st in W.get("sets", []):
            if st["reference"] in VP_MEASURED_ANTOINE.get(cid, ()):
                for T in np.linspace(st["Tmin_K"], st["Tmax_K"], 9):
                    pts.append({"T": float(T), "y": 1e5 * 10 ** (st["A"] - st["B"] / (T + st["C"])), "u_rel": None,
                                "ref": "%s (Antoine equation, NIST WebBook, %s)" % (st["reference"], W["url"]), "doi": None})
        coeffs, use, kept, exc, m = fit_measured_loose(cid, "vapourPressure", "DIPPR101", pts, 0.01, fixed=[crit])
        coeffs.setdefault("D", 0.0)
        coeffs.setdefault("E", 0.0)
        meas = [p for p in use if p is not crit]
        ant = [p for p in meas if not p.get("doi")]
        meas = [p for p in meas if p.get("doi")]
        Tmin = min(p["T"] for p in meas + kept + ant)
        Tdata = max(p["T"] for p in meas + kept + ant)
        refs = []
        for p in meas + kept:
            r = tml.cite(p["doi"])
            if r not in refs:
                refs.append(r)
        cs_curve = self.cs.corr(cas, "vapourPressure")
        Tq = np.array([p["T"] for p in meas])
        dcs = self.cs.value_si(cas, "vapourPressure", Tq) / np.array([p["y"] for p in meas]) - 1
        source = ("Fitted to measured vapour pressures (NIST TRC ThermoML Archive): %d values with stated uncertainties "
                  "within 1 %% from %d articles, max deviation %s %%, and %d values with larger stated uncertainties, "
                  "kept where the fit is within them (they extend the range to %.2f K); %sand the %s critical point "
                  "(%.2f K, %.0f Pa). Between %.2f K and the critical point the curve is held only by the critical point. "
                  "The ChemSep vapour-pressure equation was not used: it deviates from the values within 1 %% by "
                  "%+.1f %% (median, %+.1f %% at most); see docs/MEASURED_CHECKS.md. Articles: %s. Rules: "
                  "validation/python/measured_components.py (fit_measured_loose)."
                  % (len(meas), len({p["doi"] for p in meas}), pct(m), len(kept), Tmin,
                     ("%d points of the measured Antoine equation of %s; " % (len(ant), ", ".join(VP_MEASURED_ANTOINE[cid])))
                     if ant else "", self.cs.name(cas), Tc, Pc, Tdata,
                     100 * float(np.median(dcs)), 100 * float(dcs[np.argmax(np.abs(dcs))]), "; ".join(refs)))
        rec = {"equation": "DIPPR101", "form": "ln(P/Pa) = A + B/T + C ln T + D T^E", "units": "Pa",
               **{k: coeffs[k] for k in "ABCDE"}, "Tmin_K": rnd(Tmin, 8), "Tmax_K": rnd(Tc, 8), "tier": "fitted",
               "source": source}
        checks = []
        if WEBBOOK_ANTOINE_FILE.exists() and cid in json.loads(WEBBOOK_ANTOINE_FILE.read_text()):
            W = json.loads(WEBBOOK_ANTOINE_FILE.read_text())[cid]
            for st in W["sets"]:
                Ta = np.linspace(st["Tmin_K"], st["Tmax_K"], 21)
                dev = ev("DIPPR101", coeffs, Ta) / (1e5 * 10 ** (st["A"] - st["B"] / (Ta + st["C"]))) - 1
                k = int(np.argmax(np.abs(dev)))
                checks.append({"reference": st["reference"] + " (Antoine equation, NIST WebBook)", "url": W["url"],
                               "T_range_K": [st["Tmin_K"], st["Tmax_K"]], "max_deviation_percent": round(100 * float(dev[k]), 2)})
                self.log.append("  cross-check %s vapour pressure vs %s: max %+.2f %% at %.1f K" % (
                    cid, st["reference"], 100 * dev[k], Ta[k]))
        if checks:
            rec["crossCheck"] = checks
        if kept:
            rec["looser"] = [{"T_K": p["T"], "value": rnd(p["y"], 8), "reference": p["ref"], "deviation_percent":
                              p["deviation_percent"], "stated_uncertainty_percent": round(100 * p["u_rel"], 2)} for p in kept]
        if exc:
            rec["excluded"] = [{"T_K": p["T"], "value": rnd(p["y"], 8), "reference": p["ref"], "deviation_percent":
                                p["deviation_percent"], "why": p["why"]} for p in exc]
        order = sorted(range(len(use)), key=lambda i: use[i]["T"])
        pts = {"units": "Pa", "source": {"name": "measured vapour pressures (NIST TRC ThermoML Archive) and the critical "
                                                 "point", "fit": source},
               "T_K": [rnd(use[i]["T"], 8) for i in order], "values": [rnd(use[i]["y"], 8) for i in order],
               "Tb_K_at_101325Pa": self.comps[cid]["Tb_K"]}
        self.log.append("%-16s %-27s %-9s %-8s %7.2f-%7.2f K  max dev %8s %%  (measured: %d + %d looser, %d left out; "
                        "ChemSep median %+.1f %%)" % (cid, "vapourPressure", "DIPPR101", "fitted", Tmin, Tc, pct(m), len(meas),
                                                     len(kept), len(exc), 100 * float(np.median(dcs))))
        return rec, pts

    def vapour_pressure_chemsep10(self, cid, d):
        """ChemSep equation 10 (P = exp(A - B/(T + C)), monoethanolamine, diethanolamine) refitted in the DIPPR 101
        form over its range, up to the critical temperature, narrowed if needed to meet the 1 % target."""
        cas = self.comps[cid]["cas"]
        Tc = self.cs.const(cas, "CriticalTemperature")
        Tmin, Tmax = d["Tmin"], min(d["Tmax"], math.floor(0.999 * Tc * 100) / 100)
        sample = lambda T: self.cs.value_si(cas, "vapourPressure", T)  # noqa: E731
        T, y, c, extra, m, Tmin, Tmax, narrowed = fit_range("DIPPR101", sample, Tmin, Tmax, 0.01,
                                                             keep=keep_T(self.comps[cid]))
        coeffs = {k: rnd(v) for k, v in c.items()}
        coeffs.setdefault("D", 0.0)
        coeffs.setdefault("E", 0.0)
        m = max(m, rel_dev(ev("DIPPR101", coeffs, T), y))
        source = ("%s, vapour pressure: ChemSep equation 10 (P = exp(A - B/(T + C)), Pa) refitted in the DIPPR 101 form, "
                  "%d points %.2f-%.2f K, max deviation %s %%%s. Not a CoolProp 8.0.0 fluid. %s"
                  % (self.cs.name(cas), len(T), Tmin, Tmax, pct(m), ("; " + narrowed) if narrowed else "", CHEMSEP_ACCESS))
        rec = {"equation": "DIPPR101", "form": "ln(P/Pa) = A + B/T + C ln T + D T^E", "units": "Pa",
               **{k: coeffs[k] for k in "ABCDE"}, "Tmin_K": rnd(Tmin, 8), "Tmax_K": rnd(Tmax, 8), "tier": "fitted",
               "source": source}
        if WEBBOOK_ANTOINE_FILE.exists() and cid in json.loads(WEBBOOK_ANTOINE_FILE.read_text()):
            W = json.loads(WEBBOOK_ANTOINE_FILE.read_text())[cid]
            checks = []
            for st in W["sets"]:
                Tq = np.linspace(max(st["Tmin_K"], Tmin), min(st["Tmax_K"], Tmax), 21)
                dev = ev("DIPPR101", coeffs, Tq) / (1e5 * 10 ** (st["A"] - st["B"] / (Tq + st["C"]))) - 1
                k = int(np.argmax(np.abs(dev)))
                checks.append({"reference": st["reference"] + " (Antoine equation, NIST WebBook)", "url": W["url"],
                               "T_range_K": [st["Tmin_K"], st["Tmax_K"]], "max_deviation_percent": round(100 * float(dev[k]), 2)})
                self.log.append("  cross-check %s vapour pressure vs %s, %.2f-%.2f K: max %+.2f %% at %.1f K" % (
                    cid, st["reference"], st["Tmin_K"], st["Tmax_K"], 100 * dev[k], Tq[k]))
            if checks:
                rec["crossCheck"] = checks
        idx = store_idx(len(T))
        pts = {"units": "Pa", "source": {"name": self.cs.name(cas), "fit": source},
               "T_K": [rnd(float(T[i]), 8) for i in idx], "values": [rnd(float(y[i]), 8) for i in idx],
               "Tb_K_at_101325Pa": self.comps[cid]["Tb_K"]}
        self.log.append("%-16s %-27s %-9s %-8s %7.2f-%7.2f K  max dev %8s %%" % (
            cid, "vapourPressure", "DIPPR101", "fitted", Tmin, Tmax, pct(m)))
        return rec, pts

    def vapour_pressure_chemsep(self, cid):
        if cid in VP_FROM_MEASURED:
            return self.vapour_pressure_measured(cid)
        if cid in VP_FROM_ANTOINE:
            return self.vapour_pressure_antoine(cid)
        cas = self.comps[cid]["cas"]
        d = self.cs.corr(cas, "vapourPressure")
        if d is not None and d["eqno"] == 10 and d["units"] == "Pa":
            return self.vapour_pressure_chemsep10(cid, d)
        if d is None or d["eqno"] != 101 or d["units"] != "Pa":
            raise ValueError("%s: ChemSep vapour pressure is not equation 101 or 10 in Pa" % cid)
        Tmin, Tmax = d["Tmin"], d["Tmax"]
        c = {k: d[k] for k in "ABCDE"}
        Tc, Pc = self.cs.const(cas, "CriticalTemperature"), self.cs.const(cas, "CriticalPressure")
        why = "ChemSep range"
        # the equation must reach the critical pressure at the critical temperature; where it overshoots by more
        # than 5 % (n-butyl acetate) the record ends at 0.95 Tc
        p_end = float(ev("DIPPR101", c, np.array([min(Tc, Tmax)]))[0])
        if Tmax >= 0.95 * Tc and abs(p_end / Pc - 1) > 0.05 and min(Tc, Tmax) < Tc + 1e-9:
            T95 = math.floor(0.95 * Tc * 100) / 100
            why = ("ChemSep range, ending at 0.95 Tc: near the critical point the equation overshoots (%.3g Pa at "
                   "%.2f K against the critical pressure %.3g Pa at %.2f K)" % (p_end, min(Tc, Tmax), Pc, Tc))
            Tmax = min(Tmax, T95)
        T = grid(Tmin, Tmax)
        y = self.cs.value_si(cas, "vapourPressure", T)
        m = rel_dev(ev("DIPPR101", c, T), y)
        # also at the stored points (rounded to 8 digits), which the test checks
        idx = store_idx(len(T))
        m = max(m, rel_dev(ev("DIPPR101", c, np.array([rnd(float(T[i]), 8) for i in idx])),
                           np.array([rnd(float(y[i]), 8) for i in idx])))
        source = ("%s, vapour pressure: ChemSep equation 101 coefficients taken over unchanged; %.2f-%.2f K "
                  "(%s); reproduces ChemSep within %s %% at %d points. Not a CoolProp 8.0.0 fluid. %s"
                  % (self.cs.name(cas), Tmin, Tmax, why, pct(m), len(T), CHEMSEP_ACCESS))
        rec = {"equation": "DIPPR101", "form": "ln(P/Pa) = A + B/T + C ln T + D T^E", "units": "Pa",
               "A": c["A"], "B": c["B"], "C": c["C"], "D": c["D"], "E": c["E"],
               "Tmin_K": rnd(Tmin, 8), "Tmax_K": rnd(Tmax, 8), "tier": "databank", "source": source}
        idx = store_idx(len(T))
        pts = {"units": "Pa", "source": {"name": self.cs.name(cas), "fit": source},
               "T_K": [rnd(float(T[i]), 8) for i in idx], "values": [rnd(float(y[i]), 8) for i in idx],
               "Tb_K_at_101325Pa": self.comps[cid]["Tb_K"]}
        self.log.append("%-16s %-27s %-9s %-8s %7.2f-%7.2f K  max dev %8s %%" % (
            cid, "vapourPressure", "DIPPR101", "databank", Tmin, Tmax, pct(m)))
        if WEBBOOK_ANTOINE_FILE.exists() and cid in json.loads(WEBBOOK_ANTOINE_FILE.read_text()):
            W = json.loads(WEBBOOK_ANTOINE_FILE.read_text())[cid]
            checks = []
            if not W["sets"]:
                checks.append({"reference": "NIST Chemistry WebBook: no Antoine equation on the page", "url": W["url"]})
            for s in W["sets"]:
                Tq = np.linspace(max(s["Tmin_K"], Tmin), min(s["Tmax_K"], Tmax), 21)
                ref = 1e5 * 10 ** (s["A"] - s["B"] / (Tq + s["C"]))
                dev = ev("DIPPR101", c, Tq) / ref - 1
                k = int(np.argmax(np.abs(dev)))
                checks.append({"reference": s["reference"] + " (Antoine equation, NIST WebBook)", "url": W["url"],
                               "T_range_K": [s["Tmin_K"], s["Tmax_K"]],
                               "max_deviation_percent": round(100 * float(dev[k]), 2)})
                self.log.append("  cross-check %s vapour pressure vs %s, %.2f-%.2f K: max %+.2f %% at %.1f K" % (
                    cid, s["reference"], s["Tmin_K"], s["Tmax_K"], 100 * dev[k], Tq[k]))
            rec["crossCheck"] = checks
        return rec, pts

    def chemsep_check(self, cid, prop, T):
        """ChemSep value (mol basis) for a cross-check, or None."""
        try:
            cas = self.comps[cid]["cas"]
            d = self.cs.corr(cas, prop)
            if d is None or not (d["Tmin"] - 1e-6 <= T <= d["Tmax"] + 1e-6):
                return None
            return float(self.cs.value_si(cas, prop, T))
        except Exception:
            return None

# ---------------------------------------------------------------------------------------------
# Report (docs/PURE_DATA.md)
# ---------------------------------------------------------------------------------------------

SHORT = {"liquidDensity": "ρL", "idealGasHeatCapacity": "cp°", "liquidHeatCapacity": "cpL",
         "heatOfVaporization": "ΔHvap", "liquidViscosity": "μL", "vapourViscosity": "μV",
         "liquidThermalConductivity": "kL", "vapourThermalConductivity": "kV", "surfaceTension": "σ"}
DISPLAY = {"liquidDensity": (1, "kg/m³"), "idealGasHeatCapacity": (1, "J/(mol·K)"),
           "liquidHeatCapacity": (1, "J/(mol·K)"), "heatOfVaporization": (1e-3, "kJ/mol"),
           "liquidViscosity": (1e3, "mPa·s"), "vapourViscosity": (1e6, "μPa·s"),
           "liquidThermalConductivity": (1e3, "mW/(m·K)"), "vapourThermalConductivity": (1e3, "mW/(m·K)"),
           "surfaceTension": (1e3, "mN/m"), "vapourPressure": (1e-3, "kPa")}


def short_source(rec):
    if rec.get("available") is False:
        return "no open data"
    s = rec["source"]["name"]
    if s.startswith("CoolProp"):
        return "CoolProp"
    if s.startswith("NIST"):
        return "WebBook"
    return "ChemSep"


def max_dev_text(rec):
    import re
    txt = rec["source"]["fit"] if isinstance(rec["source"], dict) else rec["source"]
    m = re.search(r"(?:max deviation|within) ([0-9.]+) %", txt)
    return m.group(1) if m else "?"


def brent_tb(d):
    """Temperature (K) at which a ChemSep equation-101 vapour pressure reaches 101.325 kPa."""
    from scipy.optimize import brentq
    c = {k: d[k] for k in "ABCDE"}
    return brentq(lambda T: float(ev("DIPPR101", c, np.array([T]))[0]) - 101325.0, d["Tmin"], d["Tmax"])


def keep_T(c):
    """Temperatures a fitted range keeps when it is narrowed: 25 degC and the normal boiling point."""
    return tuple(x for x in (298.15, c["Tb_K"]) if x is not None)


def spot_T(cid, comps):
    if comps[cid]["Tb_K"] is not None and comps[cid]["Tb_K"] > 298.15:
        return 298.15
    if comps[cid]["Tb_K"] is not None:
        return comps[cid]["Tb_K"]
    # no normal boiling point (carbon dioxide): midway between the triple point and 0.95 Tc
    import CoolProp
    AS = CoolProp.AbstractState("HEOS", COOLPROP[cid])
    return round(0.5 * (AS.Ttriple() + 0.95 * AS.T_critical()), 2)


def webbook_value(cid, T):
    """WebBook ideal-gas cp at T: Shomate equation, or a tabulated value at exactly T; else None."""
    W = WEBBOOK_CP0[cid]
    if "shomate" in W:
        s, t = W["shomate"], T / 1000
        return s["A"] + s["B"] * t + s["C"] * t ** 2 + s["D"] * t ** 3 + s["E"] / t ** 2
    return next((v for (t, v) in W["table"] if abs(t - T) < 1e-9), None)


def write_doc(comps, records, builder, vp_gas, measured=()):
    L = []
    L.append("# Pure-component data: sources and fit quality\n")
    L.append("Generated by `validation/python/fit_properties.py --write`; do not edit by hand. "
             "Proposal 0002, sections 2, 4 and 5.\n")
    L.append("Each cell: source of the record and the maximum deviation of the correlation from that source "
             "over its range (%). Sources: **CoolProp** 8.0.0 (reference equations cited in each record), "
             "**WebBook** = NIST Chemistry WebBook, **ChemSep** = ChemSep pure-component database v8.3 "
             "(Artistic License 2.0). Tier: (f) fitted by Fugacity, (d) databank coefficients taken over.\n")
    head = "| Component | Psat | " + " | ".join(SHORT[p] for p in PROPS) + " |"
    L.append(head)
    L.append("|" + "---|" * (len(PROPS) + 2))
    for cid in IDS:
        c = comps[cid]
        vp = c.get("vapourPressure")
        vps = ("%s %s (%s)" % ("CoolProp" if cid in COOLPROP else "ChemSep", max_dev_text({"source": vp["source"]}),
                               vp["tier"][0])) if cid in VP_FITTED else "existing"
        cells = []
        for p in PROPS:
            r = records[cid][p]
            if r.get("available") is False:
                cells.append("no open data")
            else:
                cells.append("%s %s (%s)" % (short_source(r), max_dev_text(r), r["tier"][0]))
        L.append("| %s | %s | %s |" % (c["name"], vps, " | ".join(cells)))
    L.append("\n\"existing\": the vapour-pressure records of the ten liquids from v0.1 (not changed).\n")

    L.append("## Ranges\n")
    L.append("| Component | " + " | ".join(SHORT[p] for p in PROPS) + " |")
    L.append("|" + "---|" * (len(PROPS) + 1))
    for cid in IDS:
        cells = []
        for p in PROPS:
            r = records[cid][p]
            cells.append("–" if r.get("available") is False else "%g–%g" % (r["Tmin_K"], r["Tmax_K"]))
        L.append("| %s | %s |" % (comps[cid]["name"], " | ".join(cells)))
    L.append("\nTemperatures in K.\n")

    L.append("## Spot checks\n")
    L.append("At 25 °C (298.15 K) for the liquids and at the normal boiling point for the gases (carbon dioxide, "
             "which has no liquid at 1 atm: midway between its triple point and 0.95 Tc). "
             "\"Fugacity\" is the stored correlation, \"source\" the value of the source it was fitted to "
             "or taken from, and \"ChemSep\" an independent databank value (ChemSep v8.3) where the record "
             "is not itself from ChemSep. A dash: outside the range of the record.\n")
    for cid in IDS:
        T = spot_T(cid, comps)
        L.append("### %s, T = %.2f K\n" % (comps[cid]["name"], T))
        L.append("| Property | Unit | Fugacity | Source | Deviation | ChemSep |")
        L.append("|---|---|---|---|---|---|")
        for p in (["vapourPressure"] if cid in VP_FITTED else []) + PROPS:
            f, u = DISPLAY[p]
            if p == "vapourPressure":
                v = comps[cid]["vapourPressure"]
                ours = float(ev("DIPPR101", {k: v[k] for k in "ABCDE"}, T))
                src = builder.coolprop(cid).value(p, T) if cid in COOLPROP else builder.chemsep_check(cid, p, T)
                cs = None
                label = "Psat"
            else:
                r = records[cid][p]
                label = SHORT[p]
                if r.get("available") is False or not (r["Tmin_K"] <= T <= r["Tmax_K"]):
                    L.append("| %s | %s | – | – | – | – |" % (label, u))
                    continue
                ours = float(ev(r["equation"], r["coefficients"], T, r.get("Tc_K")))
                s = chosen_source(cid, p)
                if s == "coolprop":
                    src = builder.coolprop(cid).value(p, T)
                elif s == "chemsep":
                    src = builder.chemsep_check(cid, p, T)
                elif s in ("webbook-fluid", "measured"):
                    src = None  # tabulated or measured points: the deviation over them is in the record
                else:
                    src = webbook_value(cid, T)
                cs = builder.chemsep_check(cid, p, T) if s != "chemsep" else None
            dev = "%.2f %%" % (100 * (ours / src - 1)) if src else "–"
            L.append("| %s | %s | %.5g | %s | %s | %s |" % (
                label, u, ours * f, ("%.5g" % (src * f)) if src else "(table)", dev,
                ("%.5g" % (cs * f)) if cs else "–"))
        L.append("")
    L.append("## Comparison with measured data\n")
    L.append("Measured values from the NIST WebBook in `validation/data/pure/measured/webbook.json` "
             "(rules and references there), checked by `test/properties.test.js` at 2 %. Liquid heat capacity at "
             "298.15 K against the mean of the values measured in 1970 or later; heat of vaporization at the "
             "normal boiling point against Majer and Svoboda (1985). Ethylene glycol has no Majer-Svoboda value "
             "at Tb on its WebBook page. Liquid densities of the four ChemSep liquids are not compared with "
             "measurements: the WebBook has none and the ThermoML Archive could not be reached.\n")
    L.append("| Component | Property | Record | Deviation from measured |")
    L.append("|---|---|---|---|")
    for line in measured:
        cid, rest = line.split(" ", 1)
        what, txt = rest.split(": ", 1)
        L.append("| %s | %s | %s |" % (comps[cid]["name"], what, txt))
    L.append("")
    L.append("## Range limits to note\n")
    L.append("Liquid records whose range was narrowed by the fit so that it starts above the other liquid "
             "properties of the component, and vapour records that start above the normal boiling point. (ChemSep "
             "records keep ChemSep's own ranges, raised to the triple point where ChemSep starts below it; see "
             "Ranges.) Outside its range a record throws; `props()` then returns null for that property, with a "
             "note.\n")
    for cid in IDS:
        c = comps[cid]
        for p in PROPS:
            r = records[cid][p]
            if r.get("available") is False:
                continue
            if (p in ("vapourViscosity", "vapourThermalConductivity", "idealGasHeatCapacity") and c["Tb_K"] is not None
                    and r["Tmin_K"] > c["Tb_K"]):
                L.append("- %s, %s: starts at %g K, above the normal boiling point %g K (%s range); vapour states "
                         "between Tb and %g K have no value." % (c["name"], SHORT[p], r["Tmin_K"], c["Tb_K"],
                                                                  short_source(r), r["Tmin_K"]))
            elif "narrowed" in r["source"]["fit"] and p in LIQUID_SIDE:
                first = [rr["Tmin_K"] for pp, rr in records[cid].items()
                         if pp in LIQUID_SIDE and rr.get("available") is not False]
                if r["Tmin_K"] > min(first) + 1e-9:
                    L.append("- %s, %s: starts at %g K, above the other liquid properties (%g K): %s" % (
                        c["name"], SHORT[p], r["Tmin_K"], min(first), r["source"]["fit"].split("; ", 1)[1]))
    L.append("")
    L.append("## Cross-checks\n")
    for line in builder.log:
        if "cross-check" in line:
            L.append("- " + line.strip())
    L.append("")
    L.append("## Notes\n")
    L.append("- Acetic acid: the ideal-gas heat capacity is that of the monomer. The heat of vaporization "
             "(ChemSep) is the enthalpy change to the real, largely dimerized vapour, so h(liquid) = h°(T) − ΔHvap "
             "is not consistent for acetic acid; the vapour association model is needed for that.")
    L.append("- Liquid properties are along the saturation line; vapour viscosity and thermal conductivity "
             "are dilute-gas (low-pressure) values.")
    L.append("- Water: the correlations are fitted to IAPWS-95 and the IAPWS transport formulations as "
             "implemented in CoolProp; `props()` will use IAPWS-IF97 directly for water.")
    L.append("")
    L.append("## References\n")
    L.append("- CoolProp 8.0.0: %s; https://github.com/CoolProp/CoolProp (MIT). The equations it "
             "implements for these fluids:" % builder.bib.cite("Bell-IECR-2014"))
    for k in sorted(builder.bib.used):
        L.append("  - %s: %s" % (k, builder.bib.cite(k)))
    L.append("- " + CHEMSEP_REF_FULL + ".")
    for cid, W in WEBBOOK_CP0.items():
        L.append("- %s, ideal-gas heat capacity: %s; %s" % (comps[cid]["name"], W["reference"], W["url"]))
    DOC_FILE.write_text("\n".join(L) + "\n")


# Warnings carried in the records themselves (the reviewer of #12, finding 1)
RECORD_NOTES = {
    "acetic-acid": {
        "heatOfVaporization": "Enthalpy of vaporization to the real, largely dimerized vapour (as measured), not "
                              "to the ideal-gas monomer of the idealGasHeatCapacity record: h(liquid) = h°(T) - "
                              "dHvap(T) is not consistent for acetic acid until the vapour association is included "
                              "in the enthalpy.",
    },
}


def measured_mean(entry):
    vals = [v["cp_J_molK"] for v in entry["values"] if v["year"] >= 1970 and abs(v["T_K"] - 298.15) <= 0.5]
    return sum(vals) / len(vals), len(vals)


def add_measured(records):
    """Compare records with measured WebBook values (validation/data/pure/measured/webbook.json) and
    state the deviation in the record's source. Returns report lines."""
    M = json.loads(MEASURED_FILE.read_text())
    out = []
    for cid, e in M["liquidHeatCapacity"].items():
        r = records[cid]["liquidHeatCapacity"]
        mean, n = measured_mean(e)
        v = float(ev(r["equation"], r["coefficients"], 298.15, r.get("Tc_K")))
        lo = min(x["cp_J_molK"] for x in e["values"])
        hi = max(x["cp_J_molK"] for x in e["values"])
        txt = ("%+.1f %% vs the mean (%.2f J/mol/K) of %d measured value%s at 298.15 K, 1970 or later, "
               "range %.2f-%.2f (NIST WebBook, %s)" % (100 * (v / mean - 1), mean, n, "" if n == 1 else "s",
                                                       lo, hi, e["url"]))
        r["source"]["measured"] = txt
        out.append("%s cpL(298.15 K) %.2f: %s" % (cid, v, txt))
    for cid, e in M["heatOfVaporization"].items():
        r = records[cid]["heatOfVaporization"]
        v = float(ev(r["equation"], r["coefficients"], e["T_K"], r.get("Tc_K"))) / 1000
        txt = ("%+.1f %% vs %.2f kJ/mol at %.1f K (Majer and Svoboda 1985, via the NIST WebBook, %s)"
               % (100 * (v / e["dHvap_kJ_mol"] - 1), e["dHvap_kJ_mol"], e["T_K"], e["url"]))
        r["source"]["measured"] = txt
        out.append("%s dHvap(%.1f K) %.3f kJ/mol: %s" % (cid, e["T_K"], v, txt))
    return out


def add_measured_checks(records, vp_gas, comps):
    """For the components of check_measured.py: the comparison of each record with the measured values of the
    ThermoML Archive, stated in the record ("measuredCheck"). Returns report lines."""
    import check_measured as CM
    out = []
    for cid in CM.CHECKED:
        f = CM.MEASURED_DIR / ("thermoml_%s.json" % cid)
        if cid not in records or not f.exists():
            continue
        data = json.loads(f.read_text())
        # the vapour pressure made here, or the component's own (the liquids of v0.1 keep theirs)
        vpd = vp_gas[cid] if cid in vp_gas else comps[cid]["vapourPressure"]
        comp = {"vapourPressure": vpd, "properties": records[cid]}
        for prop in CM.TOLERANCE:
            r = CM.compare(cid, comp, data, prop)
            if r["status"] in ("no record", "too few values"):
                continue
            txt = ("NIST TRC ThermoML Archive (validation/python/check_measured.py): %d measured values from %d articles, "
                   "%.1f-%.1f K; median deviation of the articles %.2f %%%s; largest single deviation %+.2f %% at %.1f K (%s); "
                   "docs/MEASURED_CHECKS.md" % (
                       r["n"], r["articles"], r["T"][0], r["T"][1], 100 * r["median"],
                       "" if r["tol"] is None else (" (within the %g %% tolerance of the engineering report)" if r["status"] == "pass"
                                                    else " (above the %g %% tolerance of the engineering report)") % (100 * r["tol"]),
                       100 * r["max"], r["max_T"], r["max_ref"]))
            if prop == "vapourPressure":
                vpd["measuredCheck"] = txt
            else:
                records[cid][prop]["source"]["measuredCheck"] = txt
            out.append("%s %s: %s" % (cid, prop, txt[:160]))
    return out


def fetch_webbook_fluid(cid):
    """Download the WebBook fluid tables of WEBBOOK_FLUID[cid] (saturation line and the dilute-gas
    isobar) as tab-delimited text and store them unchanged (numbers as given) for the fit."""
    import datetime
    import urllib.error
    import urllib.request
    import CoolProp
    W = WEBBOOK_FLUID[cid]
    AS = CoolProp.AbstractState("HEOS", COOLPROP[cid])
    Tt, Tc = AS.Ttriple(), AS.T_critical()
    lo, hi = math.ceil(Tt * 100) / 100, math.floor(0.95 * Tc * 100) / 100
    base = WEBBOOK_FLUID_URL.format(ID=W["ID"])
    urls = {
        "saturation": base + "&Type=SatT&TLow=%g&THigh=%g&TInc=%g" % (lo, hi, round((hi - lo) / 120, 3)),
        "dilute": base + "&Type=IsoBar&P=%g&TLow=%g&THigh=%g&TInc=%g" % (
            WEBBOOK_DILUTE_MPa, lo, W["Tmax_vapour"], round((W["Tmax_vapour"] - lo) / 120, 3)),
    }
    out = {"component": cid, "source": "NIST Chemistry WebBook (SRD 69), Thermophysical Properties of Fluid Systems",
           "reference": W["reference"], "retrieved": datetime.date.today().isoformat(), "urls": urls}
    for key, url in urls.items():
        req = urllib.request.Request(url, headers={"User-Agent": "Fugacity data script (https://github.com/FaireDose/Fugacity)"})
        for attempt in range(5):  # the WebBook gateway sometimes times out (HTTP 504)
            try:
                with urllib.request.urlopen(req, timeout=120) as f:
                    text = f.read().decode("utf-8")
                break
            except urllib.error.HTTPError as e:
                if e.code not in (502, 503, 504) or attempt == 4:
                    raise
                import time
                time.sleep(5 * 2 ** attempt)
        lines = [ln.split("\t") for ln in text.strip().splitlines()]
        cols = lines[0]

        def num(v):
            try:
                return float(v)
            except ValueError:
                return v
        # keep only the columns the fit uses (the WebBook is cited per record, not redistributed)
        keep = [i for i, c in enumerate(cols) if c.startswith(("Temperature", "Pressure", "Viscosity", "Therm. Cond.", "Phase"))]
        out[key] = {"columns": [cols[i] for i in keep], "rows": [[num(ln[i]) for i in keep] for ln in lines[1:]]}
    WEBBOOK_FLUID_DIR.mkdir(parents=True, exist_ok=True)
    (WEBBOOK_FLUID_DIR / ("%s.json" % cid)).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print("fetched %s: %d saturation rows, %d isobar rows" % (cid, len(out["saturation"]["rows"]), len(out["dilute"]["rows"])))


def fetch_webbook_antoine():
    """Download the Antoine equations on the WebBook pages of WEBBOOK_ANTOINE (as printed there)."""
    import datetime
    import html as H
    import re
    import urllib.error
    import urllib.request
    out = json.loads(WEBBOOK_ANTOINE_FILE.read_text()) if WEBBOOK_ANTOINE_FILE.exists() else {}
    for cid, ID in WEBBOOK_ANTOINE.items():
        if cid in out:  # already downloaded (delete the entry to download it again)
            continue
        url = WEBBOOK_ANTOINE_URL.format(ID=ID)
        req = urllib.request.Request(url, headers={"User-Agent": "Fugacity data script (https://github.com/FaireDose/Fugacity)"})
        for attempt in range(6):  # the WebBook gateway sometimes times out (HTTP 504)
            try:
                with urllib.request.urlopen(req, timeout=120) as f:
                    page = f.read().decode("utf-8")
                break
            except urllib.error.HTTPError as e:
                if e.code not in (502, 503, 504) or attempt == 5:
                    raise
                import time
                time.sleep(5 * 2 ** attempt)
        if "Antoine Equation Parameters" not in page:
            out[cid] = {"url": url, "retrieved": datetime.date.today().isoformat(), "sets": []}
            print("fetched %s: no Antoine sets on the page" % cid)
            continue
        seg = page[page.index("Antoine Equation Parameters"):]
        seg = seg[:seg.index("</table>")]
        sets = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", seg, re.S)[1:]:
            cells = [H.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
            lo, hi = (float(v) for v in cells[0].split(" to "))
            v = lambda c: float(c.split("±")[0])  # noqa: E731  (some sets print an uncertainty: "4.1033 ± 0.00099")
            sets.append({"Tmin_K": lo, "Tmax_K": hi, "A": v(cells[1]), "B": v(cells[2]), "C": v(cells[3]),
                         "reference": cells[4], "comment": cells[5] if len(cells) > 5 else ""})
        out[cid] = {"url": url, "retrieved": datetime.date.today().isoformat(),
                    "equation": "log10(P/bar) = A - B / (T/K + C)", "sets": sets}
        print("fetched %s: %d Antoine sets" % (cid, len(sets)))
    WEBBOOK_ANTOINE_FILE.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fetch-webbook", action="store_true", help="download the WebBook fluid tables first")
    ap.add_argument("--chemsep", required=True, nargs="+",
                    help="path to ChemSep chemsep1.xml (v8.3), and chemsep2.xml (v8.31 data 2) for the compounds not in it")
    ap.add_argument("--bib", help="CoolProp's CoolPropBibTeXLibrary.bib (v8.0.0) for full references "
                    "(https://github.com/CoolProp/CoolProp/blob/v8.0.0/CoolPropBibTeXLibrary.bib)")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    import CoolProp
    if CoolProp.__version__ != "8.0.0":
        raise SystemExit("CoolProp 8.0.0 is required (found %s)" % CoolProp.__version__)
    if args.fetch_webbook:
        for cid in WEBBOOK_FLUID:
            if not (WEBBOOK_FLUID_DIR / ("%s.json" % cid)).exists():  # already downloaded: delete it to download again
                fetch_webbook_fluid(cid)
        fetch_webbook_antoine()
    data = json.loads(COMP_FILE.read_text())
    comps = data["components"]
    cs = ChemSep(args.chemsep)
    b = Builder(comps, cs, Bib(args.bib))

    # check that the CoolProp gaps listed above are real, and that nothing else is missing
    for cid, props in COOLPROP_GAPS.items():
        F = b.coolprop(cid)
        F.sat(0.7 * F.Tc, 0)
        for name, fn in (("Viscosity", F.AS.viscosity), ("ThermalConductivity", F.AS.conductivity)):
            listed = any(name in p for p in props)
            try:
                fn()
                has = True
            except ValueError:
                has = False
            if has and listed:
                raise SystemExit("CoolProp has a %s model for %s now: update COOLPROP_GAPS" % (name, cid))
            if not has and not listed:
                raise SystemExit("CoolProp has no %s model for %s: add it to COOLPROP_GAPS" % (name, cid))

    records, points, vp_gas = {}, {}, {}
    for cid in IDS:
        records[cid], points[cid] = {}, {}
        for p in PROPS:
            rec, pts = b.build(cid, p)
            records[cid][p] = rec
            if pts:
                points[cid][p] = pts
        if cid in VP_FITTED:
            rec, pts = b.vapour_pressure(cid)
            vp_gas[cid] = rec
            points[cid]["vapourPressure"] = pts
    measured = add_measured(records)
    measured += add_measured_checks(records, vp_gas, comps)
    for cid, notes in RECORD_NOTES.items():
        for p, text in notes.items():
            records[cid][p]["source"]["notes"] = text
    print("\n".join(b.log))
    for line in measured:
        print("  measured: " + line)

    if args.write:
        for cid in VP_FITTED:
            if cid in COOLPROP:
                continue
            # not a CoolProp fluid: Tb is where the vapour-pressure record reaches 101.325 kPa (as Tb of a CoolProp
            # fluid is that of its equation of state), so that the two agree; ChemSep's listed value is stated
            v = vp_gas[cid]
            from scipy.optimize import brentq
            f = lambda T: float(ev("DIPPR101", {k: v[k] for k in "ABCDE"}, np.array([T]))[0]) - 101325.0  # noqa: E731
            tb = float("%.7g" % brentq(f, v["Tmin_K"], v["Tmax_K"]))
            listed = cs.const(comps[cid]["cas"], "NormalBoilingPointTemperature")
            comps[cid]["Tb_K"] = tb
            note = (" Tb: the temperature at which the vapour-pressure record reaches 101.325 kPa (%g K); ChemSep "
                    "lists %g K." % (tb, listed))
            base = comps[cid]["constants_source"].split(" Tb: the temperature")[0]
            comps[cid]["constants_source"] = base + note
            points[cid]["vapourPressure"]["Tb_K_at_101325Pa"] = tb
        for cid in IDS:
            c = comps[cid]
            if cid in VP_FITTED:
                # insert vapourPressure after Tb_K, like the liquids
                new = {}
                for k, v in c.items():
                    if k == "vapourPressure":
                        continue
                    new[k] = v
                    if k == "Tb_K":
                        new["vapourPressure"] = vp_gas[cid]
                c.clear()
                c.update(new)
            c["properties"] = records[cid]
        COMP_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        POINTS_DIR.mkdir(parents=True, exist_ok=True)
        for cid in IDS:
            doc = {"component": cid, "name": comps[cid]["name"],
                   "about": "Points sampled from the source of each property record (or the source's own "
                            "tabulated values) by validation/python/fit_properties.py. test/properties.test.js "
                            "checks that the coefficients in src/data/components.json reproduce them within the "
                            "maximum deviation stated in each record.",
                   "records": points[cid]}
            (POINTS_DIR / ("%s.json" % cid)).write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
        write_doc(comps, records, b, vp_gas, measured)
        print("written: %s, %s, %s" % (COMP_FILE.relative_to(ROOT), POINTS_DIR.relative_to(ROOT),
                                       DOC_FILE.relative_to(ROOT)))


if __name__ == "__main__":
    main()
