// 方眼1マスごとの図面を、「線のある位置」だけの粗い方眼にまとめる（計算を軽くするため）。
// まとめた後も、線のつながり方はまったく同じになる。

import { makeProblem } from './model.js';

/**
 * Pu: 1マス単位の問題
 * もどり値: { P: まとめた問題, bx, by, bz: 区切りの位置（1マス単位の座標） }
 */
export function compress(Pu) {
  const { nx, ny, nz } = Pu;
  const F = Pu.front, T = Pu.top, S = Pu.side;

  // ある座標が「区切り」になる条件: そこに線がある／そこで線が始まる・終わる・種類が変わる
  const cuts = (n, hasLineAt, changesAt) => {
    const out = [0];
    for (let c = 1; c < n; c++) if (hasLineAt(c) || changesAt(c)) out.push(c);
    out.push(n);
    return Int32Array.from(out);
  };
  const anyV = (view, c) => { for (let q = 0; q < view.nv; q++) if (view.V[c + q * (view.nu + 1)]) return true; return false; };
  const anyH = (view, c) => { for (let p = 0; p < view.nu; p++) if (view.H[p + c * view.nu]) return true; return false; };
  // 横線が u = c をまたいで変わるか
  const chgH = (view, c) => { for (let r = 0; r <= view.nv; r++) if (view.H[c - 1 + r * view.nu] !== view.H[c + r * view.nu]) return true; return false; };
  // 縦線が v = c をまたいで変わるか
  const chgV = (view, c) => { for (let u = 0; u <= view.nu; u++) if (view.V[u + (c - 1) * (view.nu + 1)] !== view.V[u + c * (view.nu + 1)]) return true; return false; };

  const bx = cuts(nx, (c) => anyV(F, c) || anyV(T, c), (c) => chgH(F, c) || chgH(T, c));
  const by = cuts(ny, (c) => anyH(T, c) || anyV(S, c), (c) => chgV(T, c) || chgH(S, c));
  const bz = cuts(nz, (c) => anyH(F, c) || anyH(S, c), (c) => chgV(F, c) || chgV(S, c));

  const P = makeProblem(bx.length - 1, by.length - 1, bz.length - 1);
  const copy = (src, dst, bu, bv) => {
    for (let q = 0; q < dst.nv; q++)
      for (let c = 0; c <= dst.nu; c++) dst.V[c + q * (dst.nu + 1)] = src.V[bu[c] + bv[q] * (src.nu + 1)];
    for (let c = 0; c <= dst.nv; c++)
      for (let p = 0; p < dst.nu; p++) dst.H[p + c * dst.nu] = src.H[bu[p] + bv[c] * src.nu];
  };
  copy(F, P.front, bx, bz);
  copy(T, P.top, bx, by);
  copy(S, P.side, by, bz);
  return { P, bx, by, bz };
}

/** まとめた方眼の部品番号を、1マス単位にもどす */
export function expandLabels(labels, bx, by, bz) {
  const nx = bx.length - 1, ny = by.length - 1, nz = bz.length - 1;
  const W = bx[nx], D = by[ny], H = bz[nz];
  const unit = new Int32Array(W * D * H);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = labels[i + nx * (j + ny * k)];
        if (!v) continue;
        for (let z = bz[k]; z < bz[k + 1]; z++)
          for (let y = by[j]; y < by[j + 1]; y++)
            for (let x = bx[i]; x < bx[i + 1]; x++) unit[x + W * (y + D * z)] = v;
      }
  return { unit, W, D, H };
}
