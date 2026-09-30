/**
 * Local stability of a single liquid phase.
 *
 * A liquid is locally stable when the Hessian of the Gibbs energy of mixing is
 * positive definite. With independent mole fractions u = x_1..x_{n-1}, this is
 * the matrix of d(ln x_i gamma_i - ln x_n gamma_n)/du_k. If it is not positive
 * definite, the liquid lies inside the spinodal and splits into two liquids,
 * so a single-liquid VLE result there is not physical.
 *
 * This detects the spinodal region only. The true two-liquid region (binodal)
 * is somewhat larger; a full liquid-liquid flash is on the roadmap.
 *
 * @param {object} sys  from createSystem
 * @param {number[]} x  liquid composition
 * @param {number} T    K
 * @returns {boolean}   true if the single liquid is locally stable
 */
export function isLiquidStable(sys, x, T) {
  const n = sys.n, m = n - 1, h = 1e-5;
  const mu = xs => {
    const g = sys.gammas(xs, T);
    const v = xs.map((xi, i) => Math.log(Math.max(xi, 1e-15) * g[i]));
    return v.slice(0, m).map(vi => vi - v[m]);
  };
  // keep the finite-difference stencil inside the simplex
  const x0 = x.map(v => Math.min(Math.max(v, 2 * h), 1));
  const s = x0.reduce((a, b) => a + b, 0);
  const xc = x0.map(v => v / s);
  const H = [];
  for (let k = 0; k < m; k++) {
    const xp = xc.slice(), xm = xc.slice();
    xp[k] += h; xp[m] -= h; xm[k] -= h; xm[m] += h;
    const a = mu(xp), b = mu(xm);
    H.push(a.map((ai, i) => (ai - b[i]) / (2 * h)));
  }
  // symmetrize and test positive definiteness (Sylvester's criterion, m <= 2 in the interface)
  const S = H.map((row, i) => row.map((v, j) => 0.5 * (v + H[j][i])));
  if (m === 1) return S[0][0] > 0;
  if (m === 2) return S[0][0] > 0 && S[0][0] * S[1][1] - S[0][1] * S[1][0] > 0;
  // general case: Cholesky
  const L = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++) for (let j = 0; j <= i; j++) {
    let sum = S[i][j];
    for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
    if (i === j) { if (sum <= 0) return false; L[i][i] = Math.sqrt(sum); }
    else L[i][j] = sum / L[j][j];
  }
  return true;
}
