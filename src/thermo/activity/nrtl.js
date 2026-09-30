/**
 * NRTL activity coefficients.
 * tau_ij = a_ij + b_ij / T,  G_ij = exp(-alpha_ij tau_ij)
 *
 * @param {{a:number[][], b:number[][], alpha:number[][]}} p  n x n matrices
 * @returns {(x:number[], T:number)=>number[]}  returns activity coefficients gamma_i
 */
export function nrtl(p) {
  const n = p.a.length;
  return function gammas(x, T) {
    const tau = [], G = [];
    for (let i = 0; i < n; i++) {
      tau.push([]); G.push([]);
      for (let j = 0; j < n; j++) {
        const t = p.a[i][j] + p.b[i][j] / T;
        tau[i].push(t);
        G[i].push(Math.exp(-p.alpha[i][j] * t));
      }
    }
    // column sums: S_j = sum_k x_k G_kj,  C_j = sum_k x_k tau_kj G_kj
    const S = new Array(n).fill(0), C = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) { S[j] += x[k] * G[k][j]; C[j] += x[k] * tau[k][j] * G[k][j]; }
    }
    const g = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = C[i] / S[i];
      for (let j = 0; j < n; j++) s += x[j] * G[i][j] / S[j] * (tau[i][j] - C[j] / S[j]);
      g[i] = Math.exp(s);
    }
    return g;
  };
}
