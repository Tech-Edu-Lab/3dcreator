// 「ものさし」: 方眼のマスの位置を、実物の長さ (mm) に読みかえる。
//
// 板の厚さ（例: 12mm）と、きりのよい寸法（10mm きざみ）は、同じ方眼にはぴったり乗らない。
// そこで、図は「形」と「およその大きさ」を表すものとし、長さは次のきまりで決める。
//
//  1. 全体の大きさ = マスの数 × 1マスの大きさ        （外形基準。例: 22マス × 10mm = 220mm）
//  2. 板の厚さにあたるマスは、いつも本当の板の厚さ    （例: 1マスでかいた板 = 12mm）
//  3. のこりを、板でないところにマスの数に応じて分ける （例: 220 − 12 − 12 = 196mm）
//  4. 数字を入れたところは、その数字のとおり           （例: あいだを 300 にする → 全体は 324mm）
//
// 立体をさがす計算（solver.js）は線のつながり方しか使わないので、
// 長さの読みかえは、立体が決まったあとで自由に行える。

export const AXES = ['x', 'y', 'z'];
const LO = ['x0', 'y0', 'z0'], HI = ['x1', 'y1', 'z1'];

/** 何も入れていない寸法の指定 */
export function emptyDims() {
  return { x: { total: null, pins: {} }, y: { total: null, pins: {} }, z: { total: null, pins: {} } };
}

/** 整数 total を、重み weights の割合で整数に分ける（合計はかならず total） */
function share(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = Math.round(total - out.reduce((a, b) => a + b, 0));
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k++, rest--) out[order[k % order.length][1]]++;
  return out;
}

/**
 * model: analyze() の model（W, D, H, parts, grid）
 * settings: { scaleMm: 1マスの大きさ, boardMm: 板の厚さ, thickness: 板の厚さをかくマス数, boardCheck }
 * dims: 生徒が入れた数字 { x: { total, pins: { "始-終": mm } }, y: …, z: … }（マスの位置は図の左下から）
 * もどり値:
 *   axes.x / .y / .z = { cells, intervals: [{ key, u0, u1, cells, kind: 'board'|'free', mm, pinned }],
 *                        total, totalPinned, defaultTotal, conflict }
 *   coords.x / .y / .z = マスの線ごとの位置 (mm)
 *   size = [はば, 奥行き, 高さ] (mm)
 */
export function buildRuler(model, settings, dims = emptyDims()) {
  const T = Math.max(1, settings.thickness | 0 || 1);
  const cellMm = settings.scaleMm, boardMm = settings.boardMm ?? settings.scaleMm * T;
  const useBoards = settings.boardCheck !== false;
  const breaks = [model.grid.bx, model.grid.by, model.grid.bz];
  const axes = {}, coords = {};
  AXES.forEach((name, a) => {
    const B = breaks[a];
    const cellsAll = B[B.length - 1];
    const want = (dims[name] && dims[name].pins) || {};
    const intervals = [];
    for (let i = 0; i + 1 < B.length; i++) {
      const u0 = B[i], u1 = B[i + 1], cells = u1 - u0, key = `${u0}-${u1}`;
      // 板の厚さの向きが、この区間をふくんでいるか
      const board = useBoards && model.parts.some((p) => p.thinAxes && p.thinAxes[a] && p.box[LO[a]] <= u0 && u1 <= p.box[HI[a]]);
      if (board) { intervals.push({ key, u0, u1, cells, kind: 'board', mm: (boardMm * cells) / T, pinned: false }); continue; }
      const pin = Number(want[key]);
      const pinned = Number.isFinite(pin) && pin > 0;
      intervals.push({ key, u0, u1, cells, kind: 'free', mm: pinned ? pin : 0, pinned });
    }
    const fixed = intervals.filter((s) => s.kind === 'board' || s.pinned).reduce((sum, s) => sum + s.mm, 0);
    const open = intervals.filter((s) => s.kind === 'free' && !s.pinned);
    const defaultTotal = cellsAll * cellMm;
    const asked = dims[name] && Number.isFinite(Number(dims[name].total)) && dims[name].total !== null && dims[name].total !== '' ? Number(dims[name].total) : null;
    let total, conflict = false, totalPinned = false;
    if (!open.length) {
      // 自由に決められる所がない: 全体は足し算で決まる
      total = fixed;
      conflict = asked !== null && Math.abs(asked - total) > 0.05;
    } else {
      const target = asked !== null ? asked : defaultTotal;
      const rest = target - fixed;
      if (rest >= open.length) {
        if (Number.isInteger(rest)) {
          let parts = share(rest, open.map((s) => s.cells));
          if (parts.some((v) => v < 1)) parts = share(rest - open.length, open.map((s) => s.cells)).map((v) => v + 1);
          open.forEach((s, i) => { s.mm = parts[i]; });
        } else {
          const parts = share(Math.round(rest * 10), open.map((s) => s.cells));
          open.forEach((s, i) => { s.mm = parts[i] / 10; });
        }
        total = target;
        totalPinned = asked !== null;
      } else {
        // 全体の大きさにおさまらない: 板でない所を「マスの数 × 1マスの大きさ」として足し算する
        open.forEach((s) => { s.mm = s.cells * cellMm; });
        total = intervals.reduce((sum, s) => sum + s.mm, 0);
        conflict = asked !== null;
      }
    }
    total = Math.round(total * 10) / 10;
    const c = new Float64Array(cellsAll + 1);
    let at = 0;
    for (const s of intervals) {
      for (let u = s.u0; u <= s.u1; u++) c[u] = at + (s.mm * (u - s.u0)) / s.cells;
      at += s.mm;
    }
    axes[name] = { cells: cellsAll, intervals, total, totalPinned, defaultTotal, conflict };
    coords[name] = c;
  });
  return { axes, coords, size: [axes.x.total, axes.y.total, axes.z.total] };
}

/** 部品の大きさ (mm): [x, y, z] */
export function partSize(part, ruler) {
  return AXES.map((name, a) => Math.round((ruler.coords[name][part.box[HI[a]]] - ruler.coords[name][part.box[LO[a]]]) * 10) / 10);
}
