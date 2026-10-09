// 図面と立体の基本データ
//
// 立体の座標:  x = 左右（右が＋）, y = 前後（奥が＋）, z = 上下（上が＋）
//
// 第三角法の3つの図は、次の向きから見た図として扱う。
//   front（正面図）  : 手前から奥へ見る。  横軸 u = x, 縦軸 v = z
//   top  （平面図）  : 上から下へ見る。    横軸 u = x, 縦軸 v = y（紙の上が奥）
//   side （右側面図）: 右から左へ見る。    横軸 u = y（紙の右が奥）, 縦軸 v = z
//
// 1つの図（View）は方眼の線分の集まり。
//   V[c + q*(nu+1)] : u = c の縦線のうち v が q〜q+1 の1マス分
//   H[p + c*nu]     : v = c の横線のうち u が p〜p+1 の1マス分
// 値は NONE / SOLID / DASH。

export const NONE = 0;
export const SOLID = 1; // 外形線（見える線・実線）
export const DASH = 2; // かくれ線（見えない線・破線）

export const VIEW_NAMES = ['front', 'top', 'side'];

export function makeView(nu, nv) {
  return { nu, nv, V: new Uint8Array((nu + 1) * nv), H: new Uint8Array(nu * (nv + 1)) };
}

export function cloneView(v) {
  return { nu: v.nu, nv: v.nv, V: v.V.slice(), H: v.H.slice() };
}

/** 3つの図を立体の座標にそろえたもの（「問題」） */
export function makeProblem(nx, ny, nz) {
  return { nx, ny, nz, front: makeView(nx, nz), top: makeView(nx, ny), side: makeView(ny, nz) };
}

export function viewIsEmpty(v) {
  for (let i = 0; i < v.V.length; i++) if (v.V[i]) return false;
  for (let i = 0; i < v.H.length; i++) if (v.H[i]) return false;
  return true;
}

/** 図の上に (u1,v1)-(u2,v2) の水平または垂直の線をひく（方眼の交点どうし） */
export function drawLine(view, u1, v1, u2, v2, type = SOLID) {
  if (u1 !== u2 && v1 !== v2) throw new Error('水平か垂直の線だけひけます');
  if (v1 === v2) {
    const a = Math.min(u1, u2), b = Math.max(u1, u2);
    for (let p = a; p < b; p++) view.H[p + v1 * view.nu] = type;
  } else {
    const a = Math.min(v1, v2), b = Math.max(v1, v2);
    for (let q = a; q < b; q++) view.V[u1 + q * (view.nu + 1)] = type;
  }
  return view;
}

/** 長方形のわくをひく */
export function drawRect(view, u1, v1, u2, v2, type = SOLID) {
  drawLine(view, u1, v1, u2, v1, type);
  drawLine(view, u1, v2, u2, v2, type);
  drawLine(view, u1, v1, u1, v2, type);
  drawLine(view, u2, v1, u2, v2, type);
  return view;
}

/**
 * 直方体（板）のリストから、マスごとの部品番号をつくる。
 * boards: [{x0,x1,y0,y1,z0,z1}]  （x0 <= x < x1 のマスをうめる）
 * もどり値: labels[i + nx*(j + ny*k)] = 部品番号（1〜）, 空間は 0
 */
export function labelsFromBoards(boards, nx, ny, nz) {
  const labels = new Int32Array(nx * ny * nz);
  boards.forEach((b, n) => {
    for (let k = b.z0; k < b.z1; k++)
      for (let j = b.y0; j < b.y1; j++)
        for (let i = b.x0; i < b.x1; i++) {
          const idx = i + nx * (j + ny * k);
          if (labels[idx]) throw new Error(`板 ${labels[idx]} と板 ${n + 1} が重なっています`);
          labels[idx] = n + 1;
        }
  });
  return labels;
}

/** 2つの図がまったく同じ線かどうか */
export function viewsEqual(a, b) {
  if (a.nu !== b.nu || a.nv !== b.nv) return false;
  for (let i = 0; i < a.V.length; i++) if (a.V[i] !== b.V[i]) return false;
  for (let i = 0; i < a.H.length; i++) if (a.H[i] !== b.H[i]) return false;
  return true;
}

/** デバッグ用: 図を文字でかく（上が紙の上） */
export function viewToText(view) {
  const { nu, nv } = view;
  const rows = [];
  for (let r = nv; r >= 0; r--) {
    let line = '';
    for (let c = 0; c <= nu; c++) {
      line += '+';
      if (c < nu) {
        const t = view.H[c + r * nu];
        line += t === SOLID ? '--' : t === DASH ? '..' : '  ';
      }
    }
    rows.push(line);
    if (r > 0) {
      let l2 = '';
      for (let c = 0; c <= nu; c++) {
        const t = view.V[c + (r - 1) * (nu + 1)];
        l2 += (t === SOLID ? '|' : t === DASH ? ':' : ' ') + (c < nu ? '  ' : '');
      }
      rows.push(l2);
    }
  }
  return rows.join('\n');
}
