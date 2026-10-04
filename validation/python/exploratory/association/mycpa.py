# Independent CPA (SRK + Wertheim TPT1 association, Michelsen-Hendriks form, simplified
# g = 1/(1 - 1.9 eta), eta = b rho / 4), equations as in P. V. Ferreira, MSc thesis, U. Porto
# (2020), eqs. 3.10-3.24, and the teqp documentation (section 4.6). Sites per molecule:
# water 4C (2 e + 2 H), ethanol 2B (1 e + 1 H); e-H bonding only. Cross association: CR-1
# (eps arithmetic mean, beta geometric mean) unless eps_cross is given.
import numpy as np
R = 8.31446261815324
NA = 6.02214076e23
class CPA:
    def __init__(self, pures, kij=0.0, eps_cross=None, beta_cross=None):
        self.pures = pures
        self.kij = kij
        self.n = len(pures)
        self.b = np.array([p["b"] for p in pures]); self.a0 = np.array([p["a0"] for p in pures])
        self.c1 = np.array([p["c1"] for p in pures]); self.Tc = np.array([p["Tc"] for p in pures])
        self.eps = np.array([p["eps"] for p in pures]); self.beta = np.array([p["beta"] for p in pures])
        self.ne = np.array([p["ne"] for p in pures]); self.nH = np.array([p["nH"] for p in pures])
        E = np.add.outer(self.eps, self.eps) / 2; B = np.sqrt(np.outer(self.beta, self.beta))
        if eps_cross is not None: E[0, 1] = E[1, 0] = eps_cross
        if beta_cross is not None: B[0, 1] = B[1, 0] = beta_cross
        self.E, self.B = E, B
        self.bij = np.add.outer(self.b, self.b) / 2
    def alpha_r(self, T, rho, x):
        x = np.asarray(x, float)
        a = self.a0 * (1 + self.c1 * (1 - np.sqrt(T / self.Tc))) ** 2
        K = np.array([[0, self.kij], [self.kij, 0]])
        am = x @ (np.sqrt(np.outer(a, a)) * (1 - K)) @ x
        bm = x @ self.b
        cub = -np.log(1 - bm * rho) - am / (R * T * bm) * np.log(1 + bm * rho)
        eta = bm * rho / 4; g = 1 / (1 - 1.9 * eta)
        D = g * (np.exp(self.E / (R * T)) - 1) * self.bij * self.B   # m3/mol
        # site fractions: XA (e sites) and XB (H sites) per component; e bonds with H only
        XA = np.ones(self.n); XB = np.ones(self.n)
        for _ in range(3000):
            XA_n = 1 / (1 + rho * (D @ (x * self.nH * XB)))
            XB_n = 1 / (1 + rho * (D @ (x * self.ne * XA)))
            XA_n = 0.3 * XA + 0.7 * XA_n; XB_n = 0.3 * XB + 0.7 * XB_n
            if max(np.max(abs(XA_n - XA)), np.max(abs(XB_n - XB))) < 1e-13: XA, XB = XA_n, XB_n; break
            XA, XB = XA_n, XB_n
        assoc = np.sum(x * (self.ne * (np.log(XA) - XA / 2 + 0.5) + self.nH * (np.log(XB) - XB / 2 + 0.5)))
        return cub + assoc
    # derivatives by central differences
    def Z(self, T, rho, x):
        h = rho * 1e-6
        return 1 + rho * (self.alpha_r(T, rho + h, x) - self.alpha_r(T, rho - h, x)) / (2 * h)
    def p(self, T, rho, x): return rho * R * T * self.Z(T, rho, x)
    def hres(self, T, rho, x):
        h = T * 1e-6
        dadT = (self.alpha_r(T + h, rho, x) - self.alpha_r(T - h, rho, x)) / (2 * h)
        return R * T * (-T * dadT + self.Z(T, rho, x) - 1)
    def lnphi(self, T, rho, x):
        # mu_i^r/RT = d(n alpha_r)/dn_i at T, V;  ln phi = mu_r/RT - ln Z
        x = np.asarray(x, float); n = 1.0; V = n / rho; out = []
        for i in range(self.n):
            dn = 1e-6
            def nA(ni):
                nv = x * n; nv = nv.copy(); nv[i] += ni; N = nv.sum()
                return N * self.alpha_r(T, N / V, nv / N)
            out.append((nA(dn) - nA(-dn)) / (2 * dn))
        return np.array(out) - np.log(self.Z(T, rho, x))
