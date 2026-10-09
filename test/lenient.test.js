// 「必要なかくれ線だけ」の読み方のテスト

import test from 'node:test';
import assert from 'node:assert/strict';

import { analyze } from '../src/core/analyze.js';
import { labelsFromBoards, viewsEqual, SOLID } from '../src/core/model.js';
import { renderViews } from '../src/core/render.js';
import { drawingFromProblem } from '../src/core/drawing.js';
import { partGroups, analyzeParts } from '../src/core/boards.js';
import { extractViews } from '../src/core/extract.js';
import { compress, expandLabels } from '../src/core/compress.js';
import { solveLenient } from '../src/core/lenient.js';
import { fromBoards, bookshelf, samePartition, drawLine, DASH, SIZES, rng } from './helpers.js';

const M = 2;
const codes = (r) => r.issues.map((i) => i.code);
const count = (segs) => Object.values(segs).reduce((s, a) => s + a.length, 0);
/** 図面のかくれ線を全部消す */
function strip(d) {
  for (const n of ['front', 'top', 'side']) for (const k of ['V', 'H']) for (let i = 0; i < d[n][k].length; i++) if (d[n][k][i] === DASH) d[n][k][i] = 0;
  return d;
}
/** 立体から、実線だけの図をつくる */
function solidOnly(P) {
  for (const n of ['front', 'top', 'side']) for (const k of ['V', 'H']) for (let i = 0; i < P[n][k].length; i++) if (P[n][k][i] !== SOLID) P[n][k][i] = 0;
  return P;
}

test('本立て・かくれ線なし: 底板と背板のつなぎ目が決まらないので、出力せずにたずねる', () => {
  const { drawing } = fromBoards(bookshelf(), 20, 10, 14);
  const r = analyze(strip(drawing), { thickness: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.model, null);
  assert.deepEqual(codes(r), ['HIDDEN_JOINT']);
  const side = r.issues[0].marks.find((m) => m.view === 'side');
  // 決まらないのは、奥の下のかどの1マスだけ
  assert.deepEqual(side.cells, [[M + 9, M]]);
  // 考えられるかくれ線は2本: 底板の上の面の続き（よこ）と、背板の前の面の続き（たて）
  assert.deepEqual(side.ghost.map((g) => g.join()).sort(), [`H,${M + 9},${M + 1}`, `V,${M + 9},${M}`].sort());
});

test('本立て・考えられるかくれ線の片方をかく: その形に決まり、のこりのかくれ線はアプリがおぎなう', () => {
  // よこの線（底板が奥までのびる）
  let m = fromBoards(bookshelf(), 20, 10, 14);
  let d = strip(m.drawing);
  drawLine(d.side, M + 9, M + 1, M + 10, M + 1, DASH);
  let r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.ok(samePartition(r.model.unit, m.labels), '底板が背板の下までのびる形');
  // おぎなったのは、右側面図の「底板の上の面（手前の9マス）」と「背板の前の面（13マス）」
  assert.equal(r.model.supplement.side.length, 9 + 13);
  assert.equal(r.model.supplement.front.length + r.model.supplement.top.length, 0);

  // たての線（背板が下までのびる）
  d = strip(fromBoards(bookshelf(), 20, 10, 14).drawing);
  drawLine(d.side, M + 9, M, M + 9, M + 1, DASH);
  r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  const other = fromBoards([[0, 1, 0, 10, 0, 14], [19, 20, 0, 10, 0, 14], [1, 19, 0, 9, 0, 1], [1, 19, 9, 10, 0, 14]], 20, 10, 14);
  assert.ok(samePartition(r.model.unit, other.labels), '背板が底板のうしろまで下りる形');
});

test('本立て・底板の上の面だけをかくれ線でかく（ふつうのかき方）: 立体になる', () => {
  const m = fromBoards(bookshelf(), 20, 10, 14);
  const d = strip(m.drawing);
  drawLine(d.side, M, M + 1, M + 10, M + 1, DASH);
  const r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, true);
  assert.ok(samePartition(r.model.unit, m.labels));
  assert.equal(count(r.model.supplement), 13);
  // かくれ線を全部かく設定では、たりないと伝える
  assert.equal(analyze(d, { thickness: 1, hiddenLines: 'all' }).ok, false);
});

test('かくれ線が全部かいてある図面: どちらの設定でも同じ立体になり、おぎなう線はない', () => {
  const m = fromBoards([...bookshelf(), [1, 19, 2, 9, 7, 8]], 20, 10, 14);
  for (const hiddenLines of ['needed', 'all']) {
    const r = analyze(m.drawing, { thickness: 1, hiddenLines });
    assert.equal(r.ok, true);
    assert.ok(samePartition(r.model.unit, m.labels));
    assert.ok(!r.model.supplement || count(r.model.supplement) === 0);
  }
});

test('たな板のうしろの背板: 上下に分かれて見えても、1枚の背板として読む', () => {
  const m = fromBoards([...bookshelf(), [1, 19, 0, 9, 7, 8]], 20, 10, 14);
  const d = strip(m.drawing);
  drawLine(d.side, M, M + 1, M + 10, M + 1, DASH);
  const r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 5);
  assert.ok(samePartition(r.model.unit, m.labels));
});

test('天板のある箱形のたな: かくれ線がなければ「線のない所には何もない」と読み、かけばそのとおりになる', () => {
  // たな板は手前から3マスひっこんでいて、奥に背板がある（どちらも、天板と側板にかくれて見えない）
  const W = 16, D = 10, H = 12;
  const boards = [[0, 1, 0, D, 0, H], [W - 1, W, 0, D, 0, H], [1, W - 1, 0, D, 0, 1], [1, W - 1, 0, D, H - 1, H], [1, W - 1, D - 1, D, 1, H - 1], [1, W - 1, 3, D - 1, 6, 7]];
  const m = fromBoards(boards, W, D, H);
  // 全部かいた図面は、そのまま読める（背板あり・たな板はひっこんでいる）
  let r = analyze(m.drawing, { thickness: 1 });
  assert.equal(r.ok, true);
  assert.ok(samePartition(r.model.unit, m.labels));
  // かくれ線を1本もかかないと、背板もひっこみも図面のどこにも出てこない:
  // 背板のない、たな板が手前から奥まで通った形として読む
  r = analyze(strip(fromBoards(boards, W, D, H).drawing), { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  const plain = fromBoards([[0, 1, 0, D, 0, H], [W - 1, W, 0, D, 0, H], [1, W - 1, 0, D, 0, 1], [1, W - 1, 0, D, H - 1, H], [1, W - 1, 0, D, 6, 7]], W, D, H);
  assert.ok(samePartition(r.model.unit, plain.labels));
});

test('ふたのある箱: 前と後ろの板は、かくれ線で厚さをかかないと出てこない', () => {
  const W = 10, D = 7, H = 6;
  const list = [[0, W, 0, D, 0, 1], [0, W, 0, D, H - 1, H], [0, 1, 0, D, 1, H - 1], [W - 1, W, 0, D, 1, H - 1], [1, W - 1, 0, 1, 1, H - 1], [1, W - 1, D - 1, D, 1, H - 1]];
  // 全部かけば、板6枚の箱になる
  let r = analyze(fromBoards(list, W, D, H).drawing, { thickness: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.model.parts.length, 6);
  // かくれ線がないと、前と後ろの板の厚さがどの図にもない: 前後のあいた「つつ」の形として読む
  r = analyze(strip(fromBoards(list, W, D, H).drawing), { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 4);
});

test('どの図にも板の厚さがない図面（ただの長方形）: 板の厚さをかくよう伝える', () => {
  const d = drawingFromProblem(solidOnly(renderViews(new Int32Array(20 * 10 * 14).fill(1), 20, 10, 14)), SIZES);
  const r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['NOT_BOARD_THICK']);
  assert.match(r.issues[0].text, /かくれ線/);
});

test('厚さのない線が、ならんだ板のつなぎ目に読めてしまうとき: 出力せずにたしかめる', () => {
  // 2枚の板をならべた底板と、そのはしをかくす右の板（立っている）
  const boards = [[0, 10, 0, 5, 0, 1], [0, 10, 5, 10, 0, 1], [10, 11, 0, 10, 0, 3]];
  const m = fromBoards(boards, 11, 10, 3);
  // かくれ線（右の板にかくれた、つなぎ目のはし）をかかないと…
  let r = analyze(strip(fromBoards(boards, 11, 10, 3).drawing), { thickness: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['FLAT_SEAM']);
  const top = r.issues[0].marks.find((x) => x.view === 'top');
  assert.equal(top.segs.length, 10, '平面図のつなぎ目の線（10マス）が赤くなる');
  const side = r.issues[0].marks.find((x) => x.view === 'side');
  assert.deepEqual(side.ghost, [['V', M + 5, M]], '右側面図の、つなぎ目のかくれ線の場所をしめす');
  // つなぎ目のかくれ線をかけば、2枚の板として通る
  r = analyze(m.drawing, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 3);
});

test('つなぎ目のはしが、ほかの図にも実線で見えているとき: 厚さを考えてかいた線なので、2枚の板として通す', () => {
  // 上と同じ2枚の底板。右の板が低い位置にないので、右側面図に、つなぎ目のはし（1マスの線）が見える
  const boards = [[0, 10, 0, 5, 0, 1], [0, 10, 5, 10, 0, 1], [0, 1, 0, 10, 1, 3]];
  const m = fromBoards(boards, 10, 10, 3);
  const r = analyze(strip(m.drawing), { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.ok(samePartition(r.model.unit, m.labels));
});

test('たな板を線1本でかいた（正面図だけ）: 背板のはしとも読めてしまうので、出力せずにたしかめる', () => {
  const full = fromBoards(bookshelf(), 20, 10, 14).drawing;
  const d = strip(structuredClone(full));
  drawLine(d.side, M, M + 1, M + 10, M + 1, DASH); // 底板の上の面（ふつうにかくかくれ線）
  drawLine(d.front, M + 1, M + 7, M + 19, M + 7, SOLID); // たな板のつもりの線1本
  let r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['BOARD_END']);
  assert.match(r.issues[0].title, /板のはしか、厚さのない線か/);
  const front = r.issues[0].marks.find((x) => x.view === 'front'), side = r.issues[0].marks.find((x) => x.view === 'side');
  assert.equal(front.segs.length, 18, '正面図の線（18マス）が赤くなる');
  assert.deepEqual(side.ghost, [['H', M + 9, M + 7]], '右側面図の、背板の下のはしの場所をしめす');
  // 「全部かく」の設定でも、出力しない
  assert.equal(analyze(d, { thickness: 1, hiddenLines: 'all' }).ok, false);

  // 直し方1: たな板を、厚さ1マスの長方形にする → たな板のある本立て（板5枚）
  const shelf = structuredClone(d);
  drawLine(shelf.front, M + 1, M + 8, M + 19, M + 8, SOLID);
  r = analyze(shelf, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 5);
  assert.ok(r.model.parts.some((p) => p.box.z0 === 7 && p.box.z1 === 8 && p.box.x0 === 1 && p.box.x1 === 19), 'たな板');

  // 直し方2: 本当に背板がそこで終わっているなら、そのはしをかくれ線でかく → 上半分だけの背板（板4枚）
  const half = structuredClone(d);
  drawLine(half.side, M + 9, M + 7, M + 10, M + 7, DASH);
  r = analyze(half, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 4);
  assert.ok(r.model.parts.some((p) => p.box.y0 === 9 && p.box.z0 === 7 && p.box.z1 === 14), '背板は、線から上だけ');
});

test('板のはしが、図の外形からはっきり分かるとき: たしかめずに通す（背板の低い本立て）', () => {
  const boards = [[0, 1, 0, 10, 0, 14], [19, 20, 0, 10, 0, 14], [1, 19, 0, 10, 0, 1], [1, 19, 9, 10, 1, 8]];
  const m = fromBoards(boards, 20, 10, 14);
  const d = strip(m.drawing);
  drawLine(d.side, M, M + 1, M + 10, M + 1, DASH);
  const r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.ok(samePartition(r.model.unit, m.labels));
});

test('いす: 幕板の厚さは、かくれ線でかかないと分からない。かけば、まるごと見えない後ろの幕板も立体になる', () => {
  // 天板・あし2枚・前と後ろの幕板。後ろの幕板は、前の幕板・天板・あしにかくれて、どの向きからも見えない
  const boards = [[0, 20, 0, 10, 13, 14], [0, 1, 0, 10, 0, 13], [19, 20, 0, 10, 0, 13], [1, 19, 0, 1, 9, 13], [1, 19, 9, 10, 9, 13]];
  const m = fromBoards(boards, 20, 10, 14);
  let r = analyze(strip(structuredClone(m.drawing)), { thickness: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['NOT_BOARD_THICK']);
  assert.match(r.issues[0].text, /かくれ線/);
  // 右側面図に、2枚の幕板の厚さをかくれ線でかく（平面図・正面図のかくれ線はなし）
  const d = strip(structuredClone(m.drawing));
  d.side = structuredClone(m.drawing.side);
  r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 5);
  assert.ok(samePartition(r.model.unit, m.labels));
  // 前の幕板のぶんだけかくと、後ろの幕板はない形になる（かいていない板は、ないものとして読む）
  const one = strip(structuredClone(m.drawing));
  drawLine(one.side, M + 1, M + 9, M + 1, M + 13, DASH);
  r = analyze(one, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 4);
});

test('広い面だけが見えていて、厚さがどの図にも表れていない板: 厚さをかくれ線でかくよう伝える', () => {
  // 天板の下の奥にある低い板（y 3〜4）。正面からは広い面が見えるが、上は天板に、右は別の板にかくれている
  const boards = [[0, 5, 0, 4, 4, 5], [0, 4, 3, 4, 0, 2], [0, 1, 0, 3, 0, 4], [1, 2, 1, 3, 0, 4], [4, 5, 1, 4, 0, 3]];
  const m = fromBoards(boards, 5, 4, 5);
  let r = analyze(strip(structuredClone(m.drawing)), { thickness: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['NO_THICKNESS']);
  assert.deepEqual(r.issues[0].marks.map((x) => [x.view, x.cells.length]), [['front', 8]], '正面図の、その板の面が赤くなる');
  // 右側面図に、その板のかくれ線をかけば、厚さのことは言われなくなる
  const d = strip(structuredClone(m.drawing));
  d.side = structuredClone(m.drawing.side);
  r = analyze(d, { thickness: 1 });
  assert.ok(!codes(r).includes('NO_THICKNESS'));
  // かくれ線を全部かけば、元のとおりの立体になる
  r = analyze(m.drawing, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.ok(samePartition(r.model.unit, m.labels));
});

test('小物入れ（かべが底板の上にのっている）: 底板のない形には読まない', () => {
  // 前板と仕切りは底板の上にのっている。かくれ線がないと「底板がなくて、前板がういている」形も実線だけは合うが、
  // 正面図の細長い長方形（底板を横から見た面）は、板として読む
  const boards = [[0, 1, 0, 10, 0, 14], [19, 20, 0, 10, 0, 14], [1, 19, 0, 10, 0, 1], [1, 19, 9, 10, 1, 14], [1, 19, 0, 1, 1, 5], [1, 19, 4, 5, 1, 9]];
  const m = fromBoards(boards, 20, 10, 14);
  const d = strip(structuredClone(m.drawing));
  // かくれ線なし: 前板・仕切り・背板の高さの組み合わせが決まらないので、たずねる
  const c = compress(extractViews(d, { solidOnly: true }).unit);
  const res = solveLenient(c.P, c, 1, { boards: true });
  assert.equal(res.status, 'ambiguous');
  assert.equal(res.complex, false, 'しらべつくしている');
  for (const md of res.models) {
    const { unit, W, D, H } = expandLabels(md.labels, c.bx, c.by, c.bz);
    const parts = analyzeParts(unit, W, D, H, 1);
    assert.equal(parts.length, 6);
    assert.ok(parts.some((p) => p.box.z0 === 0 && p.box.z1 === 1 && p.box.x0 === 1 && p.box.x1 === 19 && p.box.y0 === 0 && p.box.y1 >= 9), 'どの候補にも、底板がある');
  }
  assert.deepEqual(codes(analyze(d, { thickness: 1 })), ['HIDDEN_JOINT']);
  // 右側面図に、かくれている板（底板・前板・仕切り・背板）をかくれ線でかけば、元のとおりになる
  d.side = structuredClone(m.drawing.side);
  const r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.ok(samePartition(r.model.unit, m.labels));
});

test('板が多く、見えない所の決め方が多すぎる図面: 時間をかけすぎず、かくれ線をかきたすよう伝える', () => {
  // でたらめに組んだ8枚の板（かくれ線は右側面図だけ）
  const boards = [[6, 7, 0, 5, 1, 8], [1, 5, 3, 5, 2, 3], [5, 6, 1, 5, 1, 7], [1, 5, 1, 5, 6, 7], [2, 5, 0, 4, 5, 6], [1, 7, 0, 4, 0, 1], [4, 5, 1, 5, 3, 5], [2, 4, 0, 4, 1, 2]]
    .map(([x0, x1, y0, y1, z0, z1]) => [x0 - 1, x1 - 1, y0, y1, z0, z1]);
  const m = fromBoards(boards, 6, 5, 8);
  const d = strip(structuredClone(m.drawing));
  d.side = structuredClone(m.drawing.side);
  const t0 = Date.now();
  const r = analyze(d, { thickness: 1 });
  assert.ok(Date.now() - t0 < 4000, `${Date.now() - t0}ms`);
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['HIDDEN_MORE']);
  // かくれ線を全部かけば、立体になる
  const all = analyze(m.drawing, { thickness: 1 });
  assert.equal(all.ok, true, JSON.stringify(codes(all)));
  assert.ok(all.model.parts.length >= 8 && all.model.parts.every((p) => p.isBoard));
});

test('見えない線を実線でかいた（ほかのかくれ線ははぶいた）: その線を破線にするよう伝える', () => {
  const d = strip(fromBoards(bookshelf(), 20, 10, 14).drawing);
  drawLine(d.side, M, M + 1, M + 10, M + 1, SOLID);
  const r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['SHOULD_DASH']);
  assert.equal(r.issues[0].view, 'side');
  assert.equal(r.issues[0].marks[0].segs.length, 10);
});

test('立体と合わないかくれ線: 場所をしめす', () => {
  const d = strip(fromBoards(bookshelf(), 20, 10, 14).drawing);
  drawLine(d.side, M, M + 1, M + 10, M + 1, DASH);
  drawLine(d.side, M + 4, M + 3, M + 4, M + 9, DASH); // どの板の辺でもない所
  const r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['HIDDEN_UNEXPLAINED']);
  assert.equal(r.issues[0].marks[0].segs.length, 6);
});

test('かくれ線はとちゅうで終わっていてもよいが、実線のとぎれは伝える', () => {
  let d = strip(fromBoards(bookshelf(), 20, 10, 14).drawing);
  drawLine(d.side, M + 6, M + 1, M + 10, M + 1, DASH); // 底板の線の、奥の4マス分だけ
  assert.equal(analyze(d, { thickness: 1 }).ok, true);
  assert.deepEqual(codes(analyze(d, { thickness: 1, hiddenLines: 'all' })), ['DANGLING']);
  d = fromBoards(bookshelf(), 20, 10, 14).drawing;
  drawLine(d.front, M + 1, M + 5, M + 9, M + 5);
  assert.deepEqual(codes(analyze(d, { thickness: 1 })), ['DANGLING']);
});

test('板厚チェックなし・かくれ線なし: 見えている面のうしろは、つまったかたまりとして読む', () => {
  // うしろの下に切り欠きのあるブロック（切り欠きは正面・上・右から見えない）
  const nx = 4, ny = 4, nz = 4;
  const labels = new Int32Array(nx * ny * nz).fill(1);
  const Pu = solidOnly(renderViews(labels, nx, ny, nz));
  const r = analyze(drawingFromProblem(Pu, SIZES), { boardCheck: false });
  assert.equal(r.ok, true);
  assert.equal(r.model.parts.length, 1);
  assert.deepEqual([r.model.W, r.model.D, r.model.H], [4, 4, 4]);
});

test('板厚チェックなし・必要なかくれ線だけの本立て: 板を組んだ作品として読む', () => {
  const m = fromBoards(bookshelf(), 20, 10, 14);
  const d = strip(structuredClone(m.drawing));
  drawLine(d.side, M, M + 1, M + 10, M + 1, DASH);
  const r = analyze(d, { thickness: 1, boardCheck: false });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.ok(samePartition(r.model.unit, m.labels));
  // かくれ線がまったくないときは、板厚チェックなしでも、つなぎ目をたずねる
  assert.deepEqual(codes(analyze(strip(structuredClone(m.drawing)), { thickness: 1, boardCheck: false })), ['HIDDEN_JOINT']);
});

test('でたらめに組んだ板の作品・かくれ線なし: 出力した立体は、かならず実線が図面と同じ', () => {
  const r = rng(99);
  let tried = 0, ok = 0, ask = 0, other = 0, same = 0;
  while (tried < 200) {
    const nx = 4 + Math.floor(r() * 7), ny = 3 + Math.floor(r() * 5), nz = 4 + Math.floor(r() * 7);
    const used = new Uint8Array(nx * ny * nz), boards = [];
    for (let k = 0; k < 60 && boards.length < 2 + Math.floor(r() * 5); k++) {
      const axis = Math.floor(r() * 3), dims = [nx, ny, nz], lo = [0, 0, 0], hi = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        if (a === axis) { lo[a] = Math.floor(r() * dims[a]); hi[a] = lo[a] + 1; }
        else { const len = 2 + Math.floor(r() * (dims[a] - 1)); lo[a] = Math.floor(r() * (dims[a] - len + 1)); hi[a] = lo[a] + len; }
      }
      let free = true;
      for (let z = lo[2]; z < hi[2] && free; z++) for (let y = lo[1]; y < hi[1] && free; y++) for (let x = lo[0]; x < hi[0] && free; x++) if (used[x + nx * (y + ny * z)]) free = false;
      if (!free) continue;
      for (let z = lo[2]; z < hi[2]; z++) for (let y = lo[1]; y < hi[1]; y++) for (let x = lo[0]; x < hi[0]; x++) used[x + nx * (y + ny * z)] = 1;
      boards.push({ x0: lo[0], x1: hi[0], y0: lo[1], y1: hi[1], z0: lo[2], z1: hi[2] });
    }
    const labels = labelsFromBoards(boards, nx, ny, nz);
    if (partGroups(labels, nx, ny, nz).length !== 1) continue;
    const full = renderViews(labels, nx, ny, nz);
    const d = strip(drawingFromProblem(full, SIZES, { u: 1, v: 1 }));
    const res = analyze(d, { thickness: 1 });
    tried++;
    if (res.ok) {
      ok++;
      assert.ok(res.model.parts.every((p) => p.isBoard), `#${tried}`);
      // 立体からかき直した実線が、図面の実線と同じ
      const again = solidOnly(renderViews(res.model.unit, res.model.W, res.model.D, res.model.H));
      const want = solidOnly(renderViews(crop(labels, boards, nx, ny), res.model.W, res.model.D, res.model.H));
      for (const n of ['front', 'top', 'side']) assert.ok(viewsEqual(again[n], want[n]), `#${tried} ${n}`);
      if (samePartition(res.model.unit, crop(labels, boards, nx, ny))) same++;
    } else if (codes(res).includes('HIDDEN_JOINT')) ask++;
    else other++;
  }
  console.log(`      立体になった ${ok}（元と同じ ${same}）、かくれ線をたずねた ${ask}、そのほか ${other}`);
  assert.ok(ok > 120);
  assert.ok(same > ok * 0.8);
});

/** 板のある範囲だけを切り出す */
function crop(labels, boards, nx, ny) {
  const lo = [Infinity, Infinity, Infinity], hi = [0, 0, 0];
  for (const b of boards) { lo[0] = Math.min(lo[0], b.x0); lo[1] = Math.min(lo[1], b.y0); lo[2] = Math.min(lo[2], b.z0); hi[0] = Math.max(hi[0], b.x1); hi[1] = Math.max(hi[1], b.y1); hi[2] = Math.max(hi[2], b.z1); }
  const w = hi[0] - lo[0], d = hi[1] - lo[1], h = hi[2] - lo[2];
  const out = new Int32Array(w * d * h);
  for (let z = 0; z < h; z++) for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) out[x + w * (y + d * z)] = labels[x + lo[0] + nx * (y + lo[1] + ny * (z + lo[2]))];
  return out;
}
