/**
 * UNIQUAC activity coefficients.
 * tau_ij = exp(a_ij + b_ij / T), coordination number z = 10.
 * Optional qp (q') replaces q in the residual term (Anderson-Prausnitz modification,
 * used for water and alcohols in some parameter sets).
 *
 * @param {{a:number[][], b:number[][], r:number[], q:number[], qp?:number[]}} p
 * @returns {(x:number[], T:number)=>number[]}
 */
export function uniquac(p) {
  const n = p.r.length, z = 10;
  const { r, q } = p;
  const qr = p.qp || q;
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
    let qrx = 0;
    for (let i = 0; i < n; i++) qrx += qr[i] * x[i];
    const thr = x.map((xi, i) => qr[i] * xi / qrx);
    // tt_i = sum_j theta'_j tau_ji  (residual term uses q')
    const tt = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) tt[i] += thr[j] * tau[j][i];
    const g = new Array(n);
    for (let i = 0; i < n; i++) {
      const lnc = Math.log(phi[i] / x[i]) + z / 2 * q[i] * Math.log(th[i] / phi[i]) + l[i] - phi[i] / x[i] * lx;
      let s = 0;
      for (let j = 0; j < n; j++) s += thr[j] * tau[i][j] / tt[j];
      const lnr = qr[i] * (1 - Math.log(tt[i]) - s);
      g[i] = Math.exp(lnc + lnr);
    }
    return g;
  };
}
