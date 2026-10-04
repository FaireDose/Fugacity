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

/**
 * Global stability of a liquid against splitting into two liquids: Michelsen's tangent-plane
 * test with the activity model (the liquid-liquid form of eos-stability.js).
 *
 * M. L. Michelsen, The isothermal flash problem. Part I. Stability, Fluid Phase Equilib. 9
 * (1982) 1-19; open descriptions as cited in eos-stability.js.
 *
 * With d_i = ln z_i + ln gamma_i(z), trial phases W are iterated to stationary points of
 *     ln W_i = d_i - ln gamma_i(w),   w = W / sum(W);
 * there tm = 1 - sum(W), and tm < 0 means the liquid z lowers its Gibbs energy by splitting
 * off a liquid w: it is not stable as one liquid. Unlike isLiquidStable (the spinodal), this
 * finds the full two-liquid region (the binodal) for the trial phases tried: one near-pure
 * trial per component present, and one rich in each pair's second component.
 *
 * @returns {{stable:boolean, tm:number, trial:number[]|null}}
 */
export function liquidTangentPlane(sys, z, T, opts = {}) {
  const n = sys.n, threshold = opts.threshold ?? -1e-8;
  const gz = sys.gammas(z, T);
  const d = z.map((v, i) => (v > 0 ? Math.log(v) + Math.log(gz[i]) : -Infinity));
  const present = z.map(v => v > 0);
  const starts = [];
  for (let k = 0; k < n; k++) if (present[k]) {
    starts.push(z.map((v, i) => (!present[i] ? 0 : i === k ? 0.98 : 0.02 * v)));
    starts.push(z.map((v, i) => (!present[i] ? 0 : i === k ? 0.999 : 0.001 * v)));
  }
  let best = { tm: 0, trial: null };
  const found = []; // converged non-trivial trials
  const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) < tol);
  for (const s0 of starts) {
    let W = s0.slice(), w = null, tm = null, same = false, converged = false;
    for (let it = 0; it < 400; it++) {
      const S = W.reduce((a, b) => a + b, 0);
      w = W.map(v => v / S);
      const g = sys.gammas(w.map(v => Math.max(v, 1e-300)), T);
      const Wn = w.map((_, i) => (present[i] ? Math.exp(d[i] - Math.log(g[i])) : 0));
      let ch = 0;
      for (let i = 0; i < n; i++) if (present[i]) ch = Math.max(ch, Math.abs(Math.log(Wn[i] / Math.max(W[i], 1e-300))));
      W = Wn;
      if (ch < 1e-10) { converged = true; break; }
      // shortcuts (same outcome, fewer steps): a trial that has come very close to the feed
      // goes on to the trivial solution; one that has reached an earlier trial's answer ends there
      let dz = 0;
      for (let i = 0; i < n; i++) if (present[i]) dz += Math.log(w[i] / z[i]) ** 2;
      if (it > 5 && dz < 1e-8) break;
      if (found.some(f => near(f, w, 1e-9))) { same = true; break; }
    }
    if (same) continue;
    const S = W.reduce((a, b) => a + b, 0);
    w = W.map(v => v / S);
    tm = 1 - S;
    let dist = 0;
    for (let i = 0; i < n; i++) if (present[i]) dist += Math.log(w[i] / z[i]) ** 2;
    if (dist < 1e-4) continue; // converged back to z: trivial
    if (!converged) {
      // not a stationary point: 1 - sum(W) means nothing there. The tangent-plane distance of
      // w itself, sum w_i (ln w_i + ln gamma_i(w) - d_i), still decides: a negative value
      // proves that z is not stable; otherwise this trial shows nothing.
      const g = sys.gammas(w.map(v => Math.max(v, 1e-300)), T);
      let tpd = 0;
      for (let i = 0; i < n; i++) if (present[i] && w[i] > 0) tpd += w[i] * (Math.log(w[i]) + Math.log(g[i]) - d[i]);
      if (!(tpd < threshold)) continue;
      tm = tpd;
    }
    found.push(w);
    if (tm < best.tm) best = { tm, trial: w };
  }
  return { stable: !(best.tm < threshold), ...best };
}
