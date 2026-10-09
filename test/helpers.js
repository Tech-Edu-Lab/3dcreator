// テスト用の道具

import { labelsFromBoards, drawLine, drawRect, SOLID, DASH, makeView } from '../src/core/model.js';
import { renderViews } from '../src/core/render.js';
import { drawingFromProblem } from '../src/core/drawing.js';

// A3横・標準の用紙と同じ大きさのわく
export const SIZES = { front: { cols: 59, rows: 28 }, top: { cols: 59, rows: 20 }, side: { cols: 20, rows: 28 } };

/** 板 [x0,x1,y0,y1,z0,z1] のリスト → { labels, P, drawing } */
export function fromBoards(list, nx, ny, nz, sizes = SIZES) {
  const boards = list.map(([x0, x1, y0, y1, z0, z1]) => ({ x0, x1, y0, y1, z0, z1 }));
  const labels = labelsFromBoards(boards, nx, ny, nz);
  const P = renderViews(labels, nx, ny, nz);
  return { labels, P, drawing: drawingFromProblem(P, sizes) };
}

/** 2つの部品番号の表が、同じ分け方か（番号のつけ方はちがってよい） */
export function samePartition(a, b) {
  if (a.length !== b.length) return false;
  const ab = new Map(), ba = new Map();
  for (let i = 0; i < a.length; i++) {
    if (!a[i] !== !b[i]) return false;
    if (!a[i]) continue;
    if (ab.has(a[i]) ? ab.get(a[i]) !== b[i] : ba.has(b[i])) return false;
    ab.set(a[i], b[i]); ba.set(b[i], a[i]);
  }
  return true;
}

/** 本立て: 側板2枚・底板・背板（見本と同じ形） */
export function bookshelf(W = 20, D = 10, H = 14) {
  return [
    [0, 1, 0, D, 0, H], // 左の側板
    [W - 1, W, 0, D, 0, H], // 右の側板
    [1, W - 1, 0, D, 0, 1], // 底板
    [1, W - 1, D - 1, D, 1, H], // 背板
  ];
}

/** かんたんな乱数（毎回同じ結果になる） */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export { drawLine, drawRect, SOLID, DASH, makeView };
