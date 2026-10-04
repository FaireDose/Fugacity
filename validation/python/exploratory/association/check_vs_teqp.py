import numpy as np, teqp, sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mycpa import CPA, R
wat = dict(a0=0.12277, b=0.0000145, c1=0.6736, Tc=647.13, eps=16655.0, beta=0.0692, ne=2, nH=2)
eth = dict(a0=0.85164, b=0.0491e-3, c1=0.7502, Tc=513.92, eps=21500.0, beta=0.008, ne=1, nH=1)
tw = {"a0i / Pa m^6/mol^2": 0.12277, "bi / m^3/mol": 0.0000145, "c1": 0.6736, "Tc / K": 647.13, "epsABi / J/mol": 16655.0, "betaABi": 0.0692, "sites": ["e", "e", "H", "H"]}
te = {"a0i / Pa m^6/mol^2": 0.85164, "bi / m^3/mol": 0.0491e-3, "c1": 0.7502, "Tc / K": 513.92, "epsABi / J/mol": 21500.0, "betaABi": 0.008, "sites": ["e", "H"]}
for rd in ("KG", "CS"):
    m = teqp.make_model({"kind": "CPA", "model": {"cubic": "SRK", "radial_dist": rd, "pures": [tw, te], "R_gas / J/mol/K": R}, "validate": False}, False)
    me = CPA([wat, eth])
    for T, rho, x in ((300, 30000, [0.6, 0.4]), (350, 15000, [0.3, 0.7]), (400, 100, [0.5, 0.5]), (298.15, 50000, [0.95, 0.05])):
        print(rd, T, rho, x, "teqp", m.get_Ar00(T, rho, np.array(x)), "mine", me.alpha_r(T, rho, x))
