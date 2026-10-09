import test from 'node:test';
import assert from 'node:assert/strict';

import { labelsFromBoards, viewsEqual, makeProblem, viewToText } from '../src/core/model.js';
import { renderViews } from '../src/core/render.js';
import { prepare, solveStrict, evaluate, diagnose, ST_E, ST_S } from '../src/core/solver.js';
import { compress, expandLabels } from '../src/core/compress.js';
import { fromBoards, samePartition, bookshelf, rng } from './helpers.js';

function sameProblem(a, b) {
  return viewsEqual(a.front, b.front) && viewsEqual(a.top, b.top) && viewsEqual(a.side, b.side);
}

/** 正解の立体から、ブロブごとの状態をもとめる（ブロブの中はかならず一様のはず） */
function truthState(pre, labels) {
  const state = new Uint8Array(pre.nb + 1);
  state.fill(0);
  const lab = new Map();
  for (let c = 0; c < labels.length; c++) {
    const b = pre.blobOf[c];
    if (lab.has(b)) assert.equal(lab.get(b), labels[c], 'ブロブの中に2種類のマスがある');
    else lab.set(b, labels[c]);
  }
  for (const [b, v] of lab) state[b] = v ? ST_S : ST_E;
  state[0] = ST_E;
  assert.ok(!lab.get(0), '外につながるブロブに材料がある');
  return state;
}

test('本立ての図は、3つの図として正しくかける', () => {
  const { P } = fromBoards(bookshelf(), 20, 10, 14);
  // 正面図: 外わく + 側板の内側の線2本 + 底板の上の線。かくれ線はない。
  let solid = 0, dash = 0;
  for (const v of [...P.front.V, ...P.front.H]) { if (v === 1) solid++; if (v === 2) dash++; }
  assert.equal(dash, 0);
  assert.equal(solid, 2 * 20 + 2 * 14 + 2 * 14 + 18);
  // 右側面図: 外わく + 底板の上の面（かくれ線・全幅）+ 背板の前の面（かくれ線・底板の上から）
  dash = 0;
  for (const v of [...P.side.V, ...P.side.H]) if (v === 2) dash++;
  assert.equal(dash, 10 + 13);
});

test('本立て: 立体がただ1つに決まり、板4枚に分かれる', () => {
  const { labels, P } = fromBoards(bookshelf(), 20, 10, 14);
  const { P: C, bx, by, bz } = compress(P);
  const pre = prepare(C);
  const res = solveStrict(C, pre);
  assert.ok(res.solutions.length >= 1);
  // 図面と合う形は3つある:（1）板4枚 （2）背板のかわりに手前を大きなかたまりでうめた形 （3）その両方
  assert.equal(res.solutions.length, 3);
  const unit = expandLabels(res.solutions[0].labels, bx, by, bz).unit;
  assert.ok(samePartition(unit, labels), '最初の答えは、空間をうめない形');
});

test('まとめた方眼でも、かき直した図は元と同じ', () => {
  const { labels, P } = fromBoards(bookshelf(12, 6, 9), 12, 6, 9);
  const { P: C, bx, by, bz } = compress(P);
  assert.ok(C.nx < 12 && C.ny < 6 && C.nz < 9);
  const pre = prepare(C);
  const st = truthState(pre, compressLabels(labels, 12, 6, 9, bx, by, bz));
  const ev = evaluate(C, pre, st);
  assert.equal(ev.cost, 0);
});

function compressLabels(labels, nx, ny, nz, bx, by, bz) {
  const cx = bx.length - 1, cy = by.length - 1, cz = bz.length - 1;
  const out = new Int32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) out[i + cx * (j + cy * k)] = labels[bx[i] + nx * (by[j] + ny * bz[k])];
  return out;
}

/** でたらめな板の組み合わせ */
function randomBoards(r, nx, ny, nz, count) {
  const used = new Uint8Array(nx * ny * nz);
  const list = [];
  for (let tries = 0; tries < 200 && list.length < count; tries++) {
    const axis = Math.floor(r() * 3);
    const dims = [nx, ny, nz];
    const lo = [0, 0, 0], hi = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      if (a === axis) { lo[a] = Math.floor(r() * dims[a]); hi[a] = lo[a] + 1; }
      else { const len = 1 + Math.floor(r() * dims[a]); lo[a] = Math.floor(r() * (dims[a] - len + 1)); hi[a] = lo[a] + len; }
    }
    let free = true;
    for (let k = lo[2]; k < hi[2] && free; k++)
      for (let j = lo[1]; j < hi[1] && free; j++)
        for (let i = lo[0]; i < hi[0] && free; i++) if (used[i + nx * (j + ny * k)]) free = false;
    if (!free) continue;
    for (let k = lo[2]; k < hi[2]; k++)
      for (let j = lo[1]; j < hi[1]; j++)
        for (let i = lo[0]; i < hi[0]; i++) used[i + nx * (j + ny * k)] = 1;
    list.push({ x0: lo[0], x1: hi[0], y0: lo[1], y1: hi[1], z0: lo[2], z1: hi[2] });
  }
  return list;
}

test('でたらめな板の組み合わせ: 正解がかならず答えにふくまれる', () => {
  const r = rng(20261008);
  let checked = 0, exhaustive = 0;
  for (let n = 0; n < 400; n++) {
    const nx = 3 + Math.floor(r() * 4), ny = 3 + Math.floor(r() * 3), nz = 3 + Math.floor(r() * 4);
    const boards = randomBoards(r, nx, ny, nz, 1 + Math.floor(r() * 6));
    const labels = labelsFromBoards(boards, nx, ny, nz);
    const P = renderViews(labels, nx, ny, nz);
    const pre = prepare(P);
    const truth = truthState(pre, labels);
    const ev = evaluate(P, pre, truth);
    assert.equal(ev.cost, 0, `正解をかき直した図が元とちがう (#${n})`);
    assert.ok(sameProblem(ev.rendered, P));
    const res = solveStrict(P, pre, { maxSolutions: 4096, maxNodes: 200000 });
    assert.ok(!res.truncated, `探索が打ち切られた (#${n})`);
    const key = truth.join('');
    assert.ok(res.solutions.some((s) => s.state.join('') === key), `正解が答えにない (#${n})\n${viewToText(P.front)}`);
    for (const s of res.solutions) {
      const again = renderViews(s.labels, nx, ny, nz);
      assert.ok(sameProblem(again, P), `答えが図面と合わない (#${n})`);
    }
    checked++;
    // ブロブが少ないときは、全部の組み合わせとくらべる
    if (pre.nb <= 10) {
      const all = new Set();
      const state = new Uint8Array(pre.nb + 1);
      for (let m = 0; m < 1 << pre.nb; m++) {
        state[0] = ST_E;
        for (let b = 1; b <= pre.nb; b++) state[b] = (m >> (b - 1)) & 1 ? ST_S : ST_E;
        if (evaluate(P, pre, state).cost === 0) all.add(state.join(''));
      }
      const got = new Set(res.solutions.map((s) => s.state.join('')));
      assert.deepEqual([...got].sort(), [...all].sort(), `全数調べと答えがちがう (#${n})`);
      exhaustive++;
    }
  }
  assert.equal(checked, 400);
  assert.ok(exhaustive > 100);
});

test('でたらめな立体（板でないかたまり）でも、正解が答えにふくまれる', () => {
  const r = rng(77);
  for (let n = 0; n < 200; n++) {
    const nx = 3 + Math.floor(r() * 3), ny = 3 + Math.floor(r() * 3), nz = 3 + Math.floor(r() * 3);
    const labels = new Int32Array(nx * ny * nz);
    const blocks = 1 + Math.floor(r() * 4);
    for (let b = 0; b < blocks; b++) {
      const x0 = Math.floor(r() * nx), y0 = Math.floor(r() * ny), z0 = Math.floor(r() * nz);
      const x1 = x0 + 1 + Math.floor(r() * (nx - x0)), y1 = y0 + 1 + Math.floor(r() * (ny - y0)), z1 = z0 + 1 + Math.floor(r() * (nz - z0));
      const id = 1 + Math.floor(r() * 2);
      for (let k = z0; k < z1; k++) for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) labels[i + nx * (j + ny * k)] = id;
    }
    const P = renderViews(labels, nx, ny, nz);
    const pre = prepare(P);
    const truth = truthState(pre, labels);
    assert.equal(evaluate(P, pre, truth).cost, 0, `#${n}`);
    const res = solveStrict(P, pre, { maxSolutions: 4096, maxNodes: 200000 });
    assert.ok(res.solutions.some((s) => s.state.join('') === truth.join('')), `正解が答えにない (#${n})`);
  }
});

test('合わない図面: いちばん近い立体とのちがいが分かる', () => {
  // 本立ての右側面図のかくれ線を、実線でかいてしまった場合
  const { P } = fromBoards(bookshelf(), 20, 10, 14);
  for (let i = 0; i < P.side.V.length; i++) if (P.side.V[i] === 2) P.side.V[i] = 1;
  for (let i = 0; i < P.side.H.length; i++) if (P.side.H[i] === 2) P.side.H[i] = 1;
  const { P: C } = compress(P);
  const pre = prepare(C);
  assert.equal(solveStrict(C, pre).solutions.length, 0);
  const near = diagnose(C, pre);
  assert.ok(near.cost > 0);
  assert.ok(near.mismatches.every((m) => m.view === 'side' && m.drawn === 1 && m.rendered === 2));
});

test('空の問題でも落ちない', () => {
  const P = makeProblem(2, 2, 2);
  const pre = prepare(P);
  assert.equal(pre.nb, 0);
  const res = solveStrict(P, pre);
  assert.equal(res.solutions.length, 1);
});
