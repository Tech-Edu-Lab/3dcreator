// 射影変換（紙の上の位置 ⇔ 写真の上の位置）

/** 4組の対応点 src[i] → dst[i] から、3×3 の変換行列（9個の数）をもとめる */
export function solveHomography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [X, Y] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X]);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
  }
  // 掃き出し法
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** 四角形 p0..p3 の面積（符号つき） */
export function quadArea(p) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % 4];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
