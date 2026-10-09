import test from 'node:test';
import assert from 'node:assert/strict';

import { analyze } from '../src/core/analyze.js';
import { buildRuler, partSize, emptyDims } from '../src/core/ruler.js';
import { buildMeshes, checkClosed } from '../src/core/mesh.js';
import { fromBoards, bookshelf } from './helpers.js';

const SET = { scaleMm: 10, boardMm: 12, thickness: 1, boardCheck: true };
const lens = (axis) => axis.intervals.map((s) => (s.kind === 'board' ? `[${s.mm}]` : `${s.mm}`)).join(' + ');

// はば30マス・奥行き12マス・高さ22マスの本立て（側板2・底板・背板）
function shelf() {
  const r = analyze(fromBoards(bookshelf(30, 12, 22), 30, 12, 22).drawing, { thickness: 1 });
  assert.equal(r.ok, true);
  return r.model;
}

test('外形基準: 全体はマスの数×10mm、板の厚さのマスは12mm、のこりが自動で決まる', () => {
  const m = shelf();
  const r = buildRuler(m, SET);
  assert.equal(lens(r.axes.x), '[12] + 276 + [12]'); // はば 300 = 12 + 276 + 12
  assert.equal(lens(r.axes.z), '[12] + 208'); // 高さ 220 = 底板 12 + 208
  assert.equal(lens(r.axes.y), '108 + [12]'); // 奥行き 120 = 108 + 背板 12
  assert.deepEqual(r.size, [300, 120, 220]);
  // 部品表: 側板 12×120×220、底板 276×120×12、背板 276×12×208
  const sizes = m.parts.map((p) => partSize(p, r).join('x')).sort();
  assert.deepEqual(sizes, ['12x120x220', '12x120x220', '276x120x12', '276x12x208']);
});

test('数字を入れる: あいだを 300 にすると、全体は 324 になる', () => {
  const m = shelf();
  const dims = emptyDims();
  dims.x.pins['1-29'] = 300;
  const r = buildRuler(m, SET, dims);
  assert.equal(lens(r.axes.x), '[12] + 300 + [12]');
  assert.equal(r.axes.x.total, 324);
  assert.equal(r.axes.x.intervals[1].pinned, true);
  assert.equal(r.axes.x.conflict, false);
  assert.deepEqual(r.size, [324, 120, 220]);
});

test('数字を入れる: 全体の大きさを変えると、あいだが自動で変わる', () => {
  const m = shelf();
  const dims = emptyDims();
  dims.z.total = 250;
  const r = buildRuler(m, SET, dims);
  assert.equal(lens(r.axes.z), '[12] + 238');
  assert.equal(r.axes.z.totalPinned, true);
});

test('たな板で2つに分かれるとき: のこりをマスの数に応じて分ける。片方に数字を入れると、もう片方が変わる', () => {
  // 高さ22マス: 底板(1) + 9マス + たな板(1) + 11マス
  const r0 = analyze(fromBoards([...bookshelf(30, 12, 22), [1, 29, 0, 11, 10, 11]], 30, 12, 22).drawing, { thickness: 1 });
  assert.equal(r0.ok, true);
  let r = buildRuler(r0.model, SET);
  assert.equal(lens(r.axes.z), '[12] + 88 + [12] + 108'); // 220 − 24 = 196 を 9:11 に分ける
  assert.equal(r.axes.z.total, 220);
  const dims = emptyDims();
  dims.z.pins['1-10'] = 100;
  r = buildRuler(r0.model, SET, dims);
  assert.equal(lens(r.axes.z), '[12] + 100 + [12] + 96'); // 外形 220 はそのまま
  assert.equal(r.axes.z.total, 220);
  // 全部に数字を入れたら、全体は足し算で決まる
  dims.z.pins['11-22'] = 150;
  r = buildRuler(r0.model, SET, dims);
  assert.equal(r.axes.z.total, 274);
  // 大きすぎる数字で外形におさまらないとき: 外形のほうを大きくする
  const big = emptyDims();
  big.z.pins['1-10'] = 400;
  r = buildRuler(r0.model, SET, big);
  assert.equal(lens(r.axes.z), '[12] + 400 + [12] + 110');
  assert.equal(r.axes.z.total, 534);
  assert.equal(r.axes.z.conflict, false);
  // 全体の大きさと、中の数字が合わないとき
  big.z.total = 300;
  r = buildRuler(r0.model, SET, big);
  assert.equal(r.axes.z.conflict, true);
  assert.equal(r.axes.z.total, 534);
});

test('板1枚だけ: 厚さの向きは、マスの大きさではなく板の厚さになる', () => {
  const r0 = analyze(fromBoards([[0, 30, 0, 15, 0, 1]], 30, 15, 1).drawing, { thickness: 1 });
  assert.equal(r0.ok, true);
  const r = buildRuler(r0.model, SET);
  assert.deepEqual(r.size, [300, 150, 12]);
});

test('板厚チェックなし（ブロックの練習）: どのマスも同じ大きさ', () => {
  const r0 = analyze(fromBoards(bookshelf(30, 12, 22), 30, 12, 22).drawing, { thickness: 1, boardCheck: false });
  const r = buildRuler(r0.model, { ...SET, boardCheck: false });
  assert.deepEqual(r.size, [300, 120, 220]);
  assert.equal(lens(r.axes.x), '10 + 280 + 10');
});

test('1マス＝板の厚さ（12mm）のときは、どこも読みかえなしで同じ', () => {
  const m = shelf();
  const r = buildRuler(m, { scaleMm: 12, boardMm: 12, thickness: 1, boardCheck: true });
  assert.equal(lens(r.axes.x), '[12] + 336 + [12]');
  assert.deepEqual(r.size, [360, 144, 264]);
});

test('板の厚さを2マスでかく設定: 2マスで12mm', () => {
  const W = 20, D = 10, H = 14;
  const two = [[0, 2, 0, D, 0, H], [W - 2, W, 0, D, 0, H], [2, W - 2, 0, D, 0, 2], [2, W - 2, D - 2, D, 2, H]];
  const r0 = analyze(fromBoards(two, W, D, H).drawing, { thickness: 2 });
  assert.equal(r0.ok, true);
  const r = buildRuler(r0.model, { scaleMm: 5, boardMm: 12, thickness: 2, boardCheck: true });
  assert.equal(lens(r.axes.x), '[12] + 76 + [12]'); // 20マス × 5mm = 100
});

test('読みかえた長さで、すき間のない立体になる', () => {
  const m = shelf();
  const dims = emptyDims();
  dims.x.pins['1-29'] = 300;
  const r = buildRuler(m, SET, dims);
  const mesh = buildMeshes(m.grid, r.coords);
  assert.deepEqual(mesh.size, [324, 120, 220]);
  assert.equal(checkClosed(mesh.shell.positions).closed, true);
  let maxX = 0;
  for (let i = 0; i < mesh.shell.positions.length; i += 3) maxX = Math.max(maxX, mesh.shell.positions[i]);
  assert.equal(maxX, 324);
});
