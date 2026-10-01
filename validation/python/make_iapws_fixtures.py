"""Reference values for Fugacity's steam tables (IAPWS-IF97 and the IAPWS transport releases).

Writes validation/data/iapws/coolprop_grid.json: a grid of (T, P) states over every IF97
region, evaluated with two independent implementations in CoolProp 8.0.0 (open source, MIT):

  - "IF97::Water": CoolProp's own IAPWS-IF97 implementation (github.com/CoolProp/IF97),
    including its IF97-based viscosity and thermal conductivity. Region 3 there uses the
    backward equations v(p,T) of IAPWS SR5-05, so region-3 densities differ slightly from a
    solution of the basic equation.
  - "HEOS::Water": the IAPWS-95 scientific formulation (Wagner and Pruss, J. Phys. Chem. Ref.
    Data 31 (2002) 387) with the full IAPWS 2008/2011 transport formulations. IF97 is designed
    to agree with IAPWS-95 within its stated uncertainty, so this is a sanity check only.

Both use the same reference state (u = s = 0 for the saturated liquid at the triple point).

Run:  python validation/python/make_iapws_fixtures.py
Units in the file: T in K, P in kPa, rho kg/m3, h and u kJ/kg, s, cp, cv kJ/(kg K),
w m/s, mu Pa s, k W/(m K).
"""
import json
import os

import CoolProp
from CoolProp.CoolProp import PropsSI

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "iapws", "coolprop_grid.json")

T_GRID = [273.16, 280, 300, 350, 400, 450, 500, 550, 600, 620, 630, 640, 645, 650, 655,
          660, 680, 700, 750, 800, 850, 900, 1000, 1070, 1100, 1300, 1500, 1800, 2000, 2270]
P_GRID = [1, 5, 10, 50, 101.325, 500, 1000, 3000, 10000, 16000, 20000, 22000, 23000, 25000,
          30000, 50000, 75000, 100000]

FIELDS = [("rho_kg_m3", "D", 1), ("h_kJ_kg", "H", 1e-3), ("s_kJ_kgK", "S", 1e-3),
          ("u_kJ_kg", "U", 1e-3), ("cp_kJ_kgK", "C", 1e-3), ("cv_kJ_kgK", "O", 1e-3),
          ("w_m_s", "A", 1)]
TRANSPORT = [("mu_Pa_s", "V", 1), ("k_W_mK", "L", 1)]


def iapws_version():
    import iapws
    return iapws.__version__


def psat_if97(T):
    return PropsSI("P", "T", T, "Q", 0, "IF97::Water") / 1000


def state(backend, T, P, transport):
    out = {}
    for name, key, f in FIELDS + (TRANSPORT if transport else []):
        try:
            out[name] = PropsSI(key, "T", T, "P", P * 1000, backend) * f
        except ValueError as e:
            out[name] = None
    return out


def main():
    points = []
    for T in T_GRID:
        for P in P_GRID:
            if T > 1073.15 and P > 50000:
                continue
            if T < 647.096:
                ps = psat_if97(T)
                if abs(P / ps - 1) < 2e-3:
                    continue  # too close to the saturation line: phase is ambiguous
            transport = T <= 1173.15
            pt = {"T_K": T, "P_kPa": P,
                  "IF97": state("IF97::Water", T, P, transport),
                  "IAPWS95": state("HEOS::Water", T, P, transport)}
            points.append(pt)
    sat = []
    for T in [273.16, 300, 373.15, 400, 450, 500, 550, 600, 620, 630, 640, 645, 647]:
        row = {"T_K": T, "P_kPa": psat_if97(T)}
        for q, phase in [(0, "liquid"), (1, "vapour")]:
            row[phase] = {name: PropsSI(key, "T", T, "Q", q, "IF97::Water") * f for name, key, f in FIELDS[:4]}
        sat.append(row)
    # Ideal-gas enthalpy at 298.15 K (the engine's enthalpy reference), used to check the
    # conversion in pure("water").props(): IF97 ideal-gas part of region 2 from the `iapws`
    # package, and IAPWS-95 at 1 Pa (where the residual part is negligible).
    from iapws.iapws97 import Region2_cp0, R as R_IF97
    tau = 540 / 298.15
    got = Region2_cp0(tau, 1)[3]
    h0 = {"IF97": R_IF97 * 298.15 * tau * got,
          "IAPWS95": PropsSI("H", "T", 298.15, "P", 1, "HEOS::Water") / 1000}
    # Ideal-gas enthalpy and heat capacity of IAPWS-95 at 1 Pa (residual part negligible),
    # to check pure("water").hIdealGas() and the idealGasHeatCapacity property.
    ideal = [{"T_K": T,
              "h_kJ_kg": PropsSI("H", "T", T, "P", 1, "HEOS::Water") / 1000,
              "cp_kJ_kgK": PropsSI("C", "T", T, "P", 1, "HEOS::Water") / 1000}
             for T in [275, 298.15, 350, 400, 500, 700, 900, 1070]]
    data = {
        "description": "Water and steam reference values for test/steam.test.js, from CoolProp: "
                       "IF97::Water (IAPWS-IF97 with IF97-based transport) and HEOS::Water "
                       "(IAPWS-95 with the full IAPWS transport formulations).",
        "generated_by": "validation/python/make_iapws_fixtures.py",
        "source": {
            "name": "CoolProp %s" % CoolProp.__version__,
            "reference": "Bell, Wronski, Quoilin, Lemort, Ind. Eng. Chem. Res. 53 (2014) 2498; "
                         "IAPWS R7-97(2012); Wagner and Pruss, J. Phys. Chem. Ref. Data 31 (2002) 387; "
                         "IAPWS R12-08; IAPWS R15-11",
            "access": "open source, MIT (https://github.com/CoolProp/CoolProp)",
        },
        "units": {"T_K": "K", "P_kPa": "kPa", "rho_kg_m3": "kg/m3", "h_kJ_kg": "kJ/kg",
                  "s_kJ_kgK": "kJ/(kg K)", "u_kJ_kg": "kJ/kg", "cp_kJ_kgK": "kJ/(kg K)",
                  "cv_kJ_kgK": "kJ/(kg K)", "w_m_s": "m/s", "mu_Pa_s": "Pa s", "k_W_mK": "W/(m K)"},
        "points": points,
        "saturation": sat,
        "h_ideal_gas_298_kJ_kg": h0,
        "ideal_gas_IAPWS95": ideal,
        "h_ideal_gas_298_note": "IF97: ideal-gas part of region 2 (R T tau dgamma0/dtau), iapws package "
                                "%s (github.com/jjgomera/iapws, GPL-3.0; used only to generate this value); "
                                "IAPWS95: HEOS::Water at 298.15 K and 1 Pa." % iapws_version(),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f, indent=1)
    print("wrote %d points and %d saturation states to %s" % (len(points), len(sat), OUT))


if __name__ == "__main__":
    main()
