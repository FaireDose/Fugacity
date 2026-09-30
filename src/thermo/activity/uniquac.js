/**
 * UNIQUAC activity coefficients.
 * tau_ij = exp(a_ij + b_ij / T), coordination number z = 10.
 *
 * @param {{a:number[][], b:number[][], r:number[], q:number[]}} p
 * @returns {(x:number[], T:number)=>number[]}
 */
export function uniquac(p) {
  const n = p.r.length, z = 10;
  const { r, q } = p;
  const l = r.map((ri, i) => z / 2 * (ri - q[i]) - (ri - 1));
  return function gammas(xIn, T) {
    // guard against exact zeros so the combinatorial term stays finite
    let x = xIn.map(v => Math.max(v, 1e-12));
    const sx = x.reduce((a, b) => a + b, 0);
    x = x.map(v => v / sx);
    const tau = [];
    for (let i = 0; i < n; i++) {
      tau.push([]);
      for (let j = 0; j < n; j++) tau[i].push(Math.exp(p.a[i][j] + p.b[i][j] / T));
    }
    let rx = 0, qx = 0, lx = 0;
    for (let i = 0; i < n; i++) { rx += r[i] * x[i]; qx += q[i] * x[i]; lx += l[i] * x[i]; }
    const phi = x.map((xi, i) => r[i] * xi / rx);
    const th = x.map((xi, i) => q[i] * xi / qx);
    // tt_i = sum_j theta_j tau_ji
    const tt = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) tt[i] += th[j] * tau[j][i];
    const g = new Array(n);
    for (let i = 0; i < n; i++) {
      const lnc = Math.log(phi[i] / x[i]) + z / 2 * q[i] * Math.log(th[i] / phi[i]) + l[i] - phi[i] / x[i] * lx;
      let s = 0;
      for (let j = 0; j < n; j++) s += th[j] * tau[i][j] / tt[j];
      const lnr = q[i] * (1 - Math.log(tt[i]) - s);
      g[i] = Math.exp(lnc + lnr);
    }
    return g;
  };
}
