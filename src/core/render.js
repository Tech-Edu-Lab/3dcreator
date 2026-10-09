// 立体（マスごとの部品番号）から、第三角法の3つの図をつくる。
//
// きまり:
//  ・見える線（実線）: となり合う「視線」で、最初に当たる面の「深さ」か「部品」がちがうところ。
//    （深さが同じで部品だけがちがうところ ＝ 板と板のつなぎ目）
//  ・かくれ線（破線）: 立体の辺があるのに、その向きからは見えないところ。
//  ・立体の辺: 方眼の線のまわりの4つのマスが、平らでない並びになっているところ。

import { SOLID, DASH, makeProblem } from './model.js';

/** 4つのマス a,b,c,d（線のまわりを一周する順）が「辺」をつくるか */
function isEdge(a, b, c, d) {
  return !((a === b && c === d) || (a === d && b === c));
}

export function renderViews(labels, nx, ny, nz) {
  const P = makeProblem(nx, ny, nz);
  const L = (i, j, k) =>
    i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : labels[i + nx * (j + ny * k)];

  // --- 見える線 ---
  // 正面図: 手前（y が小さい側）から
  const dF = new Int32Array(nx * nz), lF = new Int32Array(nx * nz);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      let t = -1, lab = 0;
      for (let j = 0; j < ny; j++) { const v = labels[i + nx * (j + ny * k)]; if (v) { t = j; lab = v; break; } }
      dF[i + k * nx] = t; lF[i + k * nx] = lab;
    }
  // 平面図: 上（z が大きい側）から
  const dT = new Int32Array(nx * ny), lT = new Int32Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let t = -1, lab = 0;
      for (let k = nz - 1; k >= 0; k--) { const v = labels[i + nx * (j + ny * k)]; if (v) { t = k; lab = v; break; } }
      dT[i + j * nx] = t; lT[i + j * nx] = lab;
    }
  // 右側面図: 右（x が大きい側）から
  const dS = new Int32Array(ny * nz), lS = new Int32Array(ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      let t = -1, lab = 0;
      for (let i = nx - 1; i >= 0; i--) { const v = labels[i + nx * (j + ny * k)]; if (v) { t = i; lab = v; break; } }
      dS[j + k * ny] = t; lS[j + k * ny] = lab;
    }
  visible(P.front, dF, lF);
  visible(P.top, dT, lT);
  visible(P.side, dS, lS);

  // --- かくれ線（見えない辺）---
  const F = P.front, T = P.top, S = P.side;
  // z 方向の辺 (x=c, y=c2, k)  → 正面図の縦線 (c,k) / 右側面図の縦線 (c2,k)
  for (let k = 0; k < nz; k++)
    for (let c2 = 0; c2 <= ny; c2++)
      for (let c = 0; c <= nx; c++) {
        if (!isEdge(L(c - 1, c2 - 1, k), L(c, c2 - 1, k), L(c, c2, k), L(c - 1, c2, k))) continue;
        const a = c + k * (nx + 1); if (!F.V[a]) F.V[a] = DASH;
        const b = c2 + k * (ny + 1); if (!S.V[b]) S.V[b] = DASH;
      }
  // y 方向の辺 (x=c, z=c3, j)  → 平面図の縦線 (c,j) / 右側面図の横線 (j,c3)
  for (let j = 0; j < ny; j++)
    for (let c3 = 0; c3 <= nz; c3++)
      for (let c = 0; c <= nx; c++) {
        if (!isEdge(L(c - 1, j, c3 - 1), L(c, j, c3 - 1), L(c, j, c3), L(c - 1, j, c3))) continue;
        const a = c + j * (nx + 1); if (!T.V[a]) T.V[a] = DASH;
        const b = j + c3 * ny; if (!S.H[b]) S.H[b] = DASH;
      }
  // x 方向の辺 (y=c2, z=c3, i)  → 平面図の横線 (i,c2) / 正面図の横線 (i,c3)
  for (let i = 0; i < nx; i++)
    for (let c3 = 0; c3 <= nz; c3++)
      for (let c2 = 0; c2 <= ny; c2++) {
        if (!isEdge(L(i, c2 - 1, c3 - 1), L(i, c2, c3 - 1), L(i, c2, c3), L(i, c2 - 1, c3))) continue;
        const a = i + c2 * nx; if (!T.H[a]) T.H[a] = DASH;
        const b = i + c3 * nx; if (!F.H[b]) F.H[b] = DASH;
      }
  return P;
}

/** 深さ(depth)と部品(lab)の表から、見える線を図にかきこむ */
function visible(view, depth, lab) {
  const { nu, nv } = view;
  for (let q = 0; q < nv; q++)
    for (let c = 0; c <= nu; c++) {
      const a = c > 0 ? c - 1 + q * nu : -1, b = c < nu ? c + q * nu : -1;
      const da = a < 0 ? -1 : depth[a], db = b < 0 ? -1 : depth[b];
      const la = a < 0 ? 0 : lab[a], lb = b < 0 ? 0 : lab[b];
      if (da !== db || la !== lb) view.V[c + q * (nu + 1)] = SOLID;
    }
  for (let c = 0; c <= nv; c++)
    for (let p = 0; p < nu; p++) {
      const a = c > 0 ? p + (c - 1) * nu : -1, b = c < nv ? p + c * nu : -1;
      const da = a < 0 ? -1 : depth[a], db = b < 0 ? -1 : depth[b];
      const la = a < 0 ? 0 : lab[a], lb = b < 0 ? 0 : lab[b];
      if (da !== db || la !== lb) view.H[p + c * nu] = SOLID;
    }
}
