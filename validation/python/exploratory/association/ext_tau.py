# Exploratory (proposal 0005): NRTL/UNIQUAC with tau_ij = a + b/T + e ln T + f T, joint fit to the ethanol + water
# T-x-y data and excess enthalpies. Not used by the engine or the tests.
import sys, numpy as np
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fit_parameters as fp
from reference_model import System
from scipy.optimize import least_squares

class Ext(System):
    def __init__(self, ids, model, p):
        super().__init__(ids, model, params=[])
        self.p = p
    def tau_raw(self, T):
        a12,a21,b12,b21,e12,e21,f12,f21 = self.p
        t = np.zeros((2, 2))
        t[0,1] = a12 + b12/T + e12*np.log(T) + f12*T
        t[1,0] = a21 + b21/T + e21*np.log(T) + f21*T
        return t
    def gamma(self, x, T):
        x = np.clip(np.asarray(x, float), 1e-12, None); x = x/x.sum()
        tr = self.tau_raw(T)
        if self.model == "NRTL":
            tau = tr; G = np.exp(-0.3*tau)
            S = x @ G; C = x @ (tau*G)
            return np.exp(C/S + (G*(tau - C/S)) @ (x/S))
        tau = np.exp(tr); np.fill_diagonal(tau, 1.0)
        r, q, z = self.r, self.q, 10.0
        phi = r*x/(r@x); th = q*x/(q@x); l = z/2*(r-q)-(r-1)
        lnc = np.log(phi/x) + z/2*q*np.log(th/phi) + l - phi/x*(x@l)
        tt = th @ tau
        return np.exp(lnc + q*(1 - np.log(tt) - tau @ (th/tt)))

spec = [f for f in fp.FITS if f["pair"] == ("water", "ethanol") and not f.get("default", True)][0]
sets = fp.file_sets(spec)
for m in ("NRTL", "UNIQUAC"):
    def res(p):
        return np.nan_to_num(np.array(fp.file_residuals(Ext(["water", "ethanol"], m, p), sets)), nan=1e4, posinf=1e4, neginf=-1e4)
    best = None
    for s0 in ([0,0,700,-50,0,0,0,0], [0,0,-150,-10,0,0,0,0], [5,-3,-1300,1000,0,0,0,0]):
        try:
            r = least_squares(res, s0, x_scale=[1,1,100,100,0.1,0.1,1e-3,1e-3])
        except Exception as e:
            continue
        if best is None or r.cost < best.cost: best = r
    s = Ext(["water", "ethanol"], m, best.x)
    txy = [c for k,_,c in sets if k=="txy"]
    dT = [abs(s.bubble_t([x,1-x],P)[0]-T) for P,pts in txy for x,T,_ in pts]
    dy = [abs(s.bubble_t([x,1-x],P)[1][0]-y) for P,pts in txy for x,_,y in pts]
    he = [p for k,_,c in sets if k=="he" for p in c]
    dh = [abs(s.excess_enthalpy([x,1-x],T)-h) for T,x,h in he]
    print(m, np.round(best.x, 4), f"T-x-y AAD {np.mean(dT):.2f} K (max {max(dT):.2f}), y {np.mean(dy):.4f}; hE AAD {np.mean(dh):.0f} J/mol (max {max(dh):.0f})")
