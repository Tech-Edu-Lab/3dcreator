// 見本の図面
//
// 正しい図面は、板のならべ方（立体）から図をつくるので、かならず3つの図がそろう。
// 「直すところのある図面」は、生徒がよくかく形をまねたもの。

import { labelsFromBoards, drawLine, drawRect, DASH } from './model.js';
import { renderViews } from './render.js';
import { drawingFromProblem, emptyDrawing } from './drawing.js';

const W = 30, D = 15, H = 22; // 本立ての大きさ（マス）。1マス10mmなら はば300×奥行き150×高さ220mm
const M = 2; // わくの左下からのあき

const SHELF_BOARDS = [
  { x0: 0, x1: 1, y0: 0, y1: D, z0: 0, z1: H }, // 左の側板
  { x0: W - 1, x1: W, y0: 0, y1: D, z0: 0, z1: H }, // 右の側板
  { x0: 1, x1: W - 1, y0: 0, y1: D, z0: 0, z1: 1 }, // 底板
  { x0: 1, x1: W - 1, y0: D - 1, y1: D, z0: 1, z1: H }, // 背板
];

/** 用紙に入るように、見本の大きさを決める */
function fit(sizes) {
  const w = Math.min(W, sizes.front.cols - 2 * M), h = Math.min(H, sizes.front.rows - 2 * M), d = Math.min(D, sizes.top.rows - 2 * M);
  return { w, h, d };
}

function shelfBoards(w, d, h) {
  return SHELF_BOARDS.map((b) => ({
    x0: b.x0 === W - 1 ? w - 1 : b.x0, x1: b.x1 === W ? w : b.x1 === W - 1 ? w - 1 : b.x1,
    y0: b.y0 === D - 1 ? d - 1 : b.y0, y1: b.y1 === D ? d : b.y1,
    z0: b.z0, z1: b.z1 === H ? h : b.z1,
  }));
}

/** 図面のかくれ線を全部消す */
function strip(d) {
  for (const n of ['front', 'top', 'side']) for (const k of ['V', 'H']) for (let i = 0; i < d[n][k].length; i++) if (d[n][k][i] === DASH) d[n][k][i] = 0;
  return d;
}

function shelfDrawing(sizes) {
  const { w, h, d } = fit(sizes);
  const labels = labelsFromBoards(shelfBoards(w, d, h), w, d, h);
  return { drawing: drawingFromProblem(renderViews(labels, w, d, h), sizes, { u: M, v: M }), w, h, d };
}

// make(sizes, settings): settings.hiddenLines が 'all' のときは、かくれ線を全部かいた図面にする
export const SAMPLES = [
  {
    id: 'shelf',
    name: '本立て（正しい図面）',
    note: '板4枚（側板2・底板・背板）。板の厚さは1マスでかく。',
    make(sizes, settings = {}) {
      const { drawing, d } = shelfDrawing(sizes);
      if (settings.hiddenLines === 'all') return drawing;
      // 必要なかくれ線だけ: 底板の上の面（右側面図）。背板の前の面は、アプリがおぎなう。
      strip(drawing);
      drawLine(drawing.side, M, M + 1, M + d, M + 1, DASH);
      return drawing;
    },
  },
  {
    id: 'hidden',
    name: 'かくれ線がたりない図面',
    note: '底板と背板のつなぎ目が、どの図からも見えない。',
    make(sizes) {
      return strip(shelfDrawing(sizes).drawing);
    },
  },
  {
    id: 'nothick',
    name: '板の厚さを考えていない図面',
    note: '外形の長方形と、たな板の線1本だけ。',
    make(sizes) {
      const { w, h, d } = fit(sizes);
      const dr = emptyDrawing(sizes);
      const mid = M + Math.floor(h / 2);
      drawRect(dr.front, M, M, M + w, M + h);
      drawLine(dr.front, M, mid, M + w, mid);
      drawRect(dr.top, M, M, M + w, M + d);
      drawRect(dr.side, M, M, M + d, M + h);
      drawLine(dr.side, M, mid, M + d, mid);
      return dr;
    },
  },
  {
    id: 'noseam',
    name: 'つなぎ目のない図面',
    note: '板の厚さはかいてあるが、側板と底板の境目がない。',
    make(sizes) {
      const { w, h, d } = fit(sizes);
      const labels = labelsFromBoards(shelfBoards(w, d, h), w, d, h);
      // 側板2枚と底板を「1つの部品」にしてしまう
      for (let i = 0; i < labels.length; i++) if (labels[i] === 2 || labels[i] === 3) labels[i] = 1;
      return drawingFromProblem(renderViews(labels, w, d, h), sizes, { u: M, v: M });
    },
  },
];

export function makeSample(id, sizes, settings = {}) {
  const s = SAMPLES.find((x) => x.id === id) || SAMPLES[0];
  return s.make(sizes, settings);
}
