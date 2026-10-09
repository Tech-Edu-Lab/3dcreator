// 方眼用紙（フォーマット）の種類と、紙の上の位置（単位 mm、原点は紙の左上）
//
//   ┌──────────────┬─────┐
//   │  平面図      │きまり│   ← 上のわく（奥行き depth マス）
//   ├──────────────┼─────┤
//   │  正面図      │右側 │   ← 下のわく（高さ front.rows マス）
//   │              │面図 │
//   └──────────────┴─────┘
//     front.cols マス   depth マス
//
// わくとわくの間は1マス分あいている。四すみに位置合わせ用の■マークがある。

export const CELL = 5; // 方眼1マスの大きさ (mm)
export const MARGIN = 10; // 紙のふちからマークまで (mm)
export const MARKER = 10.5; // 四すみのマークの一辺 (mm)
export const GRID_TOP = 25.5; // 方眼の上のはし (mm)

/** 1マスあたりの実物の大きさ (mm) の選び方。用紙のコードには、この並びの番号を入れる。 */
export const SCALES = [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 14, 15, 18, 20, 24, 30];

/** 板の厚さ (mm) の選び方。用紙のコードには、この並びの番号を入れる。 */
export const BOARD_MM = [9, 12, 13, 14, 15, 18, 19, 20];

/** はじめの設定: A3横、1マス＝10mm、板の厚さ12mmを1マスでかく、かくれ線は必要なものだけ */
export const DEFAULT_SETTINGS = { template: 3, scaleMm: 10, boardMm: 12, thickness: 1, boardCheck: true, hiddenLines: 'needed', gridTone: 'normal' };

// id は用紙のコードに入る番号（変えないこと）。ならび順は、画面の選び方の順。
const DEFS = [
  { id: 3, name: 'A3横・標準', hint: '本立て・たななど', pageW: 420, pageH: 297, cols: 59, rows: 28, depth: 20 },
  { id: 4, name: 'A3縦・背の高いもの', hint: 'ラックなど', pageW: 297, pageH: 420, cols: 34, rows: 53, depth: 20 },
  { id: 0, name: 'A4横・小さな作品', hint: '小物入れなど', pageW: 297, pageH: 210, cols: 41, rows: 18, depth: 13 },
  { id: 1, name: 'A4横・奥行き広め', hint: '箱・トレーなど', pageW: 297, pageH: 210, cols: 36, rows: 13, depth: 18 },
  { id: 2, name: 'A4縦・背の高いもの', hint: '小さなラックなど', pageW: 210, pageH: 297, cols: 23, rows: 35, depth: 14 },
];

function build(def) {
  const { pageW, pageH, cols, rows, depth } = def;
  const totalW = (cols + 1 + depth) * CELL;
  const gx = (pageW - totalW) / 2;
  const gy = GRID_TOP;
  const top = { x: gx, y: gy, w: cols * CELL, h: depth * CELL, cols, rows: depth };
  const front = { x: gx, y: gy + (depth + 1) * CELL, w: cols * CELL, h: rows * CELL, cols, rows };
  const side = { x: gx + (cols + 1) * CELL, y: front.y, w: depth * CELL, h: rows * CELL, cols: depth, rows };
  const info = { x: side.x, y: gy, w: depth * CELL, h: depth * CELL };
  const m = MARGIN + MARKER / 2;
  return {
    ...def,
    landscape: pageW > pageH,
    boxes: { front, top, side },
    info,
    sizes: { front: { cols, rows }, top: { cols, rows: depth }, side: { cols: depth, rows } },
    // マークの中心（左上・右上・右下・左下）
    markers: [[m, m], [pageW - m, m], [pageW - m, pageH - m], [m, pageH - m]],
    // 方眼全体の範囲
    area: { x: gx, y: gy, w: totalW, h: (depth + 1 + rows) * CELL },
  };
}

export const TEMPLATES = DEFS.map(build);

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}

/** 紙の大きさの名前（'A3' / 'A4'） */
export function paperName(tpl) {
  return Math.max(tpl.pageW, tpl.pageH) > 300 ? 'A3' : 'A4';
}

/** わくの中の交点 (u, v)（v は下から）→ 紙の上の位置 (mm) */
export function nodeToMm(box, u, v) {
  return [box.x + u * CELL, box.y + box.h - v * CELL];
}

/** 紙の位置 (mm) → マーク基準の割合 (s, t)。左上のマークが (0,0)、右下が (1,1) */
export function mmToUnit(tpl, x, y) {
  const [x0, y0] = tpl.markers[0], [x1, y1] = tpl.markers[2];
  return [(x - x0) / (x1 - x0), (y - y0) / (y1 - y0)];
}

export function unitToMm(tpl, s, t) {
  const [x0, y0] = tpl.markers[0], [x1, y1] = tpl.markers[2];
  return [x0 + s * (x1 - x0), y0 + t * (y1 - y0)];
}
