import test from 'node:test';
import assert from 'node:assert/strict';

import { analyze } from '../src/core/analyze.js';
import { emptyDrawing } from '../src/core/drawing.js';
import { fromBoards, bookshelf, samePartition, drawLine, drawRect, SOLID, DASH, SIZES } from './helpers.js';

const M = 2; // 図をおく位置（わくの左下からのマス数）
const codes = (r) => r.issues.map((i) => i.code);

test('本立て（板4枚）: 立体になる', () => {
  const { labels, drawing } = fromBoards(bookshelf(), 20, 10, 14);
  const r = analyze(drawing, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 4);
  assert.ok(r.model.parts.every((p) => p.isBoard));
  assert.ok(samePartition(r.model.unit, labels));
  assert.deepEqual([r.model.W, r.model.D, r.model.H], [20, 10, 14]);
  assert.equal(r.alternatives.length, 0);
});

test('たな板のある本立て（たな板は手前から2マスひっこんでいる）: 立体になる', () => {
  const list = [...bookshelf(), [1, 19, 2, 9, 7, 8]];
  const { labels, drawing } = fromBoards(list, 20, 10, 14);
  const r = analyze(drawing, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 5);
  assert.ok(samePartition(r.model.unit, labels));
});

test('ふたのない箱（板5枚）: 立体になる', () => {
  const W = 12, D = 8, H = 6;
  const list = [
    [0, W, 0, D, 0, 1], // 底板（全体）
    [0, 1, 0, D, 1, H], // 左
    [W - 1, W, 0, D, 1, H], // 右
    [1, W - 1, 0, 1, 1, H], // 前
    [1, W - 1, D - 1, D, 1, H], // 後ろ
  ];
  const { labels, drawing } = fromBoards(list, W, D, H);
  const r = analyze(drawing, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 5);
  assert.ok(samePartition(r.model.unit, labels));
});

test('ふたのある箱（板6枚・中は空どう）: 立体になる', () => {
  const W = 10, D = 7, H = 6;
  const list = [
    [0, W, 0, D, 0, 1], [0, W, 0, D, H - 1, H],
    [0, 1, 0, D, 1, H - 1], [W - 1, W, 0, D, 1, H - 1],
    [1, W - 1, 0, 1, 1, H - 1], [1, W - 1, D - 1, D, 1, H - 1],
  ];
  const { labels, drawing } = fromBoards(list, W, D, H);
  const r = analyze(drawing, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 6);
  assert.ok(samePartition(r.model.unit, labels));
});

test('板厚を考えていない図（長方形と線1本）: 出力しない', () => {
  const d = emptyDrawing(SIZES);
  drawRect(d.front, M, M, M + 20, M + 14);
  drawLine(d.front, M, M + 7, M + 20, M + 7); // たな板を線1本で
  drawRect(d.top, M, M, M + 20, M + 10);
  drawRect(d.side, M, M, M + 10, M + 14);
  drawLine(d.side, M, M + 7, M + 10, M + 7);
  const r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'boards');
  assert.deepEqual(codes(r), ['NOT_BOARD_THICK']);
  assert.equal(r.model, null);
  assert.ok(r.issues[0].marks.some((m) => m.cells.length > 0));
});

test('板厚を考えていない図（ただの長方形）: 出力しない', () => {
  const d = emptyDrawing(SIZES);
  drawRect(d.front, M, M, M + 20, M + 14);
  drawRect(d.top, M, M, M + 20, M + 10);
  drawRect(d.side, M, M, M + 10, M + 14);
  const r = analyze(d, { thickness: 1 });
  assert.deepEqual(codes(r), ['NOT_BOARD_THICK']);
  // 板厚チェックなしなら、1つのかたまりとして立体になる
  const free = analyze(d, { thickness: 1, boardCheck: false });
  assert.equal(free.ok, true);
  assert.equal(free.model.parts.length, 1);
});

test('本立てに、たな板を線1本でかきたした図: 出力しない', () => {
  const { drawing } = fromBoards(bookshelf(), 20, 10, 14);
  drawLine(drawing.front, M + 1, M + 7, M + 19, M + 7);
  drawLine(drawing.side, M, M + 7, M + 9, M + 7, DASH);
  const r = analyze(drawing, { thickness: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['NOT_BOARD_THICK']);
});

test('つなぎ目のない図（わくだけ二重にかいた箱）: 出力しない', () => {
  // 正面図: 外わくと内わく。平面図・右側面図: 内側の面をかくれ線で。
  const d = emptyDrawing(SIZES);
  const W = 16, D = 8, H = 12;
  drawRect(d.front, M, M, M + W, M + H);
  drawRect(d.front, M + 1, M + 1, M + W - 1, M + H - 1);
  drawRect(d.top, M, M, M + W, M + D);
  drawLine(d.top, M + 1, M, M + 1, M + D, DASH);
  drawLine(d.top, M + W - 1, M, M + W - 1, M + D, DASH);
  drawRect(d.side, M, M, M + D, M + H);
  drawLine(d.side, M, M + 1, M + D, M + 1, DASH);
  drawLine(d.side, M, M + H - 1, M + D, M + H - 1, DASH);
  const r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['NOT_BOARD_JOINED']);
});

test('底板と背板のつなぎ目がない本立て: 出力しない', () => {
  const { drawing } = fromBoards(bookshelf(), 20, 10, 14);
  // 右側面図の底板のかくれ線を、背板の手前で止める（どちらの板が勝つか分からない）
  drawLine(drawing.side, M + 9, M + 1, M + 10, M + 1, 0);
  // かくれ線を全部かく設定: 底板と背板が1つにつながって読める
  let r = analyze(drawing, { thickness: 1, hiddenLines: 'all' });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['NOT_BOARD_JOINED']);
  // 必要なかくれ線だけの設定: 見えないつなぎ目が決まらない、と伝える
  r = analyze(drawing, { thickness: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['HIDDEN_JOINT']);
});

test('かくれ線のかきわすれ（かくれ線を全部かく設定）: 対応する線がないと伝える', () => {
  const { drawing } = fromBoards(bookshelf(), 20, 10, 14);
  for (let i = 0; i < drawing.side.V.length; i++) if (drawing.side.V[i] === DASH) drawing.side.V[i] = 0;
  for (let i = 0; i < drawing.side.H.length; i++) if (drawing.side.H[i] === DASH) drawing.side.H[i] = 0;
  const r = analyze(drawing, { thickness: 1, hiddenLines: 'all' });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'match');
  assert.deepEqual(codes(r), ['NO_MATCH', 'NO_MATCH']);
  assert.deepEqual(r.issues.map((i) => [i.view, i.other]), [['front', 'side'], ['top', 'side']]);
  // 正面図の底板の上の線（18マス分）に印がつく
  assert.equal(r.issues[0].marks[0].segs.length, 18);
  assert.deepEqual(r.issues[0].marks[0].segs[0], ['H', M + 1, M + 1]);
});

test('かくれ線を実線でかいた: 破線にするよう伝える（どちらの設定でも）', () => {
  const { drawing } = fromBoards(bookshelf(), 20, 10, 14);
  for (let i = 0; i < drawing.side.V.length; i++) if (drawing.side.V[i] === DASH) drawing.side.V[i] = SOLID;
  for (let i = 0; i < drawing.side.H.length; i++) if (drawing.side.H[i] === DASH) drawing.side.H[i] = SOLID;
  for (const hiddenLines of ['needed', 'all']) {
    const r = analyze(drawing, { thickness: 1, hiddenLines });
    assert.equal(r.ok, false);
    assert.equal(r.stage, 'solve');
    assert.deepEqual(codes(r), ['SHOULD_DASH']);
    assert.equal(r.issues[0].view, 'side');
    assert.equal(r.issues[0].marks[0].segs.length, 10 + 13);
  }
});

test('図の位置や大きさのまちがい', () => {
  const base = () => fromBoards(bookshelf(), 20, 10, 14).P;
  const place = (P, at) => {
    const d = emptyDrawing(SIZES);
    const put = (dst, src, u0, v0) => {
      for (let q = 0; q < src.nv; q++) for (let c = 0; c <= src.nu; c++) if (src.V[c + q * (src.nu + 1)]) dst.V[u0 + c + (v0 + q) * (dst.nu + 1)] = src.V[c + q * (src.nu + 1)];
      for (let c = 0; c <= src.nv; c++) for (let p = 0; p < src.nu; p++) if (src.H[p + c * src.nu]) dst.H[u0 + p + (v0 + c) * dst.nu] = src.H[p + c * src.nu];
    };
    put(d.front, P.front, at.front[0], at.front[1]);
    put(d.top, P.top, at.top[0], at.top[1]);
    put(d.side, P.side, at.side[0], at.side[1]);
    return d;
  };
  let r = analyze(place(base(), { front: [2, 2], top: [5, 1], side: [1, 2] }));
  assert.deepEqual(codes(r), ['ALIGN_X']);
  assert.match(r.issues[0].text, /右に3マス/);
  r = analyze(place(base(), { front: [2, 2], top: [2, 1], side: [1, 0] }));
  assert.deepEqual(codes(r), ['ALIGN_Z']);
  assert.match(r.issues[0].text, /下に2マス/);
  // 位置がそろっていれば、わくの中のどこにかいてもよい
  r = analyze(place(base(), { front: [5, 3], top: [5, 0], side: [0, 3] }));
  assert.equal(r.ok, true);

  const small = fromBoards(bookshelf(18, 10, 14), 18, 10, 14).P;
  const mixed = { ...base(), top: small.top };
  r = analyze(place(mixed, { front: [2, 2], top: [2, 2], side: [2, 2] }));
  assert.deepEqual(codes(r), ['WIDTH_MISMATCH']);
  const deep = fromBoards(bookshelf(20, 8, 14), 20, 8, 14).P;
  r = analyze(place({ ...base(), side: deep.side }, { front: [2, 2], top: [2, 2], side: [2, 2] }));
  assert.deepEqual(codes(r), ['DEPTH_MISMATCH']);
});

test('とぎれた線・はなれた線・かいていない図', () => {
  let d = fromBoards(bookshelf(), 20, 10, 14).drawing;
  drawLine(d.front, M + 26, M + 5, M + 30, M + 5); // 図の外にはなれた線
  let r = analyze(d);
  assert.deepEqual(codes(r), ['STRAY']);
  assert.equal(r.issues[0].marks[0].segs.length, 4);
  d = fromBoards(bookshelf(), 20, 10, 14).drawing;
  drawLine(d.front, M + 5, M + 5, M + 9, M + 5); // 図の中にういた線は「とぎれた線」
  r = analyze(d);
  assert.deepEqual(codes(r), ['DANGLING']);
  assert.equal(r.issues[0].marks[0].nodes.length, 2);
  d = fromBoards(bookshelf(), 20, 10, 14).drawing;
  drawLine(d.front, M + 1, M + 5, M + 9, M + 5);
  r = analyze(d);
  assert.deepEqual(codes(r), ['DANGLING']);
  assert.deepEqual(r.issues[0].marks[0].nodes, [[M + 9, M + 5]]);
  d = fromBoards(bookshelf(), 20, 10, 14).drawing;
  d.top.V.fill(0); d.top.H.fill(0);
  r = analyze(d);
  assert.deepEqual(codes(r), ['EMPTY_VIEW']);
  assert.equal(analyze(emptyDrawing(SIZES)).issues[0].code, 'EMPTY_ALL');
});

test('宙にういた板: 出力しない', () => {
  // たな板が左右の側板にとどいていない（背板からも1マスはなれている）
  const list = [...bookshelf(), [3, 17, 2, 8, 7, 8]];
  const { drawing } = fromBoards(list, 20, 10, 14);
  const r = analyze(drawing, { thickness: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['FLOATING']);
  const free = analyze(drawing, { thickness: 1, boardCheck: false });
  assert.equal(free.ok, true);
  assert.equal(free.issues[0].level, 'warn');
});

test('板の厚さ2マス: 2マスの板は通り、1マスの板はうすいと伝える', () => {
  const W = 20, D = 10, H = 14;
  const two = [[0, 2, 0, D, 0, H], [W - 2, W, 0, D, 0, H], [2, W - 2, 0, D, 0, 2], [2, W - 2, D - 2, D, 2, H]];
  let r = analyze(fromBoards(two, W, D, H).drawing, { thickness: 2 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  r = analyze(fromBoards(bookshelf(), 20, 10, 14).drawing, { thickness: 2 });
  assert.deepEqual(codes(r), ['NOT_BOARD_THIN']);
  r = analyze(fromBoards(two, W, D, H).drawing, { thickness: 1 });
  assert.deepEqual(codes(r), ['NOT_BOARD_THICK']);
});

test('段のあるブロック（板厚チェックなし）: 1つの立体になる', () => {
  const nx = 6, ny = 4, nz = 5;
  const labels = new Int32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (i < 3 || k < 2) labels[i + nx * (j + ny * k)] = 1;
  const list = [[0, 3, 0, 4, 0, 5], [3, 6, 0, 4, 0, 2]];
  // 同じ形を「1つの部品」としてかいた図（つなぎ目の線なし）
  const d = emptyDrawing(SIZES);
  drawLine(d.front, M, M, M + 6, M); drawLine(d.front, M + 6, M, M + 6, M + 2); drawLine(d.front, M + 3, M + 2, M + 6, M + 2);
  drawLine(d.front, M + 3, M + 2, M + 3, M + 5); drawLine(d.front, M, M + 5, M + 3, M + 5); drawLine(d.front, M, M, M, M + 5);
  drawRect(d.top, M, M, M + 6, M + 4); drawLine(d.top, M + 3, M, M + 3, M + 4);
  drawRect(d.side, M, M, M + 4, M + 5); drawLine(d.side, M, M + 2, M + 4, M + 2);
  const r = analyze(d, { boardCheck: false });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 1);
  assert.ok(samePartition(r.model.unit, labels));
  assert.equal(list.length, 2);
});

test('すべての問題に、題と説明がついている', () => {
  const d = emptyDrawing(SIZES);
  drawRect(d.front, M, M, M + 20, M + 14);
  drawRect(d.top, M, M, M + 20, M + 10);
  drawRect(d.side, M, M, M + 10, M + 14);
  const r = analyze(d);
  for (const i of r.issues) { assert.ok(i.title.length > 3); assert.ok(i.text.length > 10); }
});

test('板厚のない図で、線の種類もまちがっている: 線の種類より先に、板の厚さのことを伝える', () => {
  const d = emptyDrawing(SIZES);
  drawRect(d.front, M, M, M + 20, M + 14);
  drawLine(d.front, M, M + 7, M + 20, M + 7);
  drawRect(d.top, M, M, M + 20, M + 10);
  drawRect(d.side, M, M, M + 10, M + 14);
  drawLine(d.side, M, M + 7, M + 10, M + 7, DASH); // 本当は見える線（実線）のはず
  for (const hiddenLines of ['needed', 'all']) {
    const r = analyze(d, { thickness: 1, hiddenLines });
    assert.equal(r.ok, false);
    assert.deepEqual(codes(r), ['NOT_BOARD_THICK']);
  }
});

test('見本: 正しい図面は立体になり、直すところのある図面は理由つきで止まる', async () => {
  const { SAMPLES } = await import('../src/core/samples.js');
  const { TEMPLATES } = await import('../src/sheet/templates.js');
  const count = (m) => (m.supplement ? Object.values(m.supplement).reduce((n, a) => n + a.length, 0) : 0);
  for (const t of TEMPLATES)
    for (const hiddenLines of ['needed', 'all']) {
      const res = Object.fromEntries(SAMPLES.map((s) => [s.id, analyze(s.make(t.sizes, { hiddenLines }), { thickness: 1, hiddenLines })]));
      const got = Object.fromEntries(Object.entries(res).map(([id, r]) => [id, r.ok ? 'ok' : codes(r).join()]));
      const hidden = hiddenLines === 'all' ? 'NO_MATCH,NO_MATCH' : 'HIDDEN_JOINT';
      assert.deepEqual(got, { shelf: 'ok', basic: 'ok', hidden, nothick: 'NOT_BOARD_THICK', noseam: 'NOT_BOARD_JOINED' }, `${t.name} ${hiddenLines}`);
      assert.equal(res.shelf.model.parts.length, 4);
      assert.equal(res.basic.model.parts.length, 4, '基本本棚: 側板2・底板・後ろの横板');
      // 「必要なものだけ」の見本は、かくれ線を1本しかかいていないので、のこりをアプリがおぎなう
      if (hiddenLines === 'all') assert.equal(count(res.shelf.model), 0);
      else assert.ok(count(res.shelf.model) > 0);
    }
  // 「必要なものだけ」の見本は、「全部かく」の設定では、かくれ線がたりないと言われる
  const t = TEMPLATES[0];
  assert.equal(analyze(SAMPLES[0].make(t.sizes, { hiddenLines: 'needed' }), { thickness: 1, hiddenLines: 'all' }).ok, false);
});

test('見本「基本本棚」: A3横の用紙では、先生の図面と同じ線になる。内のりを 300 にすると、はば 324mm', async () => {
  const { makeSample } = await import('../src/core/samples.js');
  const { getTemplate } = await import('../src/sheet/templates.js');
  const { emptyDrawing } = await import('../src/core/drawing.js');
  const { buildRuler, emptyDims } = await import('../src/core/ruler.js');
  const { viewsEqual } = await import('../src/core/model.js');
  const sizes = getTemplate(3).sizes;
  const want = emptyDrawing(sizes);
  // 正面図: 側板2枚（左から4〜5、35〜36マス）、底板、後ろの横板（高さ14〜18）
  for (const u of [4, 5, 35, 36]) drawLine(want.front, u, 0, u, 22);
  drawLine(want.front, 4, 0, 36, 0); drawLine(want.front, 4, 22, 5, 22); drawLine(want.front, 35, 22, 36, 22);
  for (const v of [1, 14, 18]) drawLine(want.front, 5, v, 35, v);
  // 平面図: 側板の奥行きは15マス、その後ろに横板
  drawRect(want.top, 4, 0, 36, 16);
  drawLine(want.top, 4, 15, 36, 15); drawLine(want.top, 5, 0, 5, 15); drawLine(want.top, 35, 0, 35, 15);
  // 右側面図: わくの左はしから
  drawRect(want.side, 0, 0, 15, 22);
  drawRect(want.side, 15, 14, 16, 18);
  const got = makeSample('basic', sizes, { hiddenLines: 'needed' });
  for (const n of ['front', 'top', 'side']) assert.ok(viewsEqual(got[n], want[n]), n);
  const r = analyze(got, { thickness: 1 });
  assert.equal(r.ok, true);
  // 1マス10mm・板12mm: 数字を入れなければ、マスの数どおり（はば 320・奥行き 160・高さ 220）。
  // 内のりを 300、側板の奥行きを 150 と入れると、はば 12＋300＋12＝324、奥行き 150＋12＝162（先生の図面の寸法）
  const settings = { scaleMm: 10, boardMm: 12, thickness: 1, boardCheck: true };
  const dims = emptyDims();
  assert.deepEqual(buildRuler(r.model, settings, dims).size, [320, 160, 220]);
  dims.x.pins = { '1-31': 300 };
  dims.y.pins = { '0-15': 150 };
  assert.deepEqual(buildRuler(r.model, settings, dims).size, [324, 162, 220]);
  // 見本には、この寸法がはじめから入っている。用紙が小さくて図をちぢめた向きには、入れない
  const { sampleDims } = await import('../src/core/samples.js');
  assert.deepEqual(sampleDims('basic', sizes), dims);
  assert.deepEqual(buildRuler(r.model, settings, sampleDims('basic', sizes)).size, [324, 162, 220]);
  // A4横の用紙: はばは同じ32マスなので 300 が入る。奥行きは13マスにちぢめるので、入れない
  assert.deepEqual(sampleDims('basic', getTemplate(0).sizes), { ...emptyDims(), x: { total: null, pins: { '1-31': 300 } } });
  assert.equal(sampleDims('shelf', sizes), null);
});

test('平面図か右側面図の手前と奥を逆にかいた: うら返しではないかと伝える', async () => {
  const { mirrorU, mirrorV } = await import('../src/core/extract.js');
  let d = fromBoards(bookshelf(), 20, 10, 14).drawing;
  d.side = mirrorU(d.side);
  // わくごとうら返したので、図を元の位置（左下から2マス）にもどす
  const move = (view, du, dv) => {
    const out = { nu: view.nu, nv: view.nv, V: new Uint8Array(view.V.length), H: new Uint8Array(view.H.length) };
    for (let q = 0; q < view.nv; q++) for (let c = 0; c <= view.nu; c++) { const t = view.V[c + q * (view.nu + 1)]; if (t) out.V[c + du + (q + dv) * (view.nu + 1)] = t; }
    for (let c = 0; c <= view.nv; c++) for (let p = 0; p < view.nu; p++) { const t = view.H[p + c * view.nu]; if (t) out.H[p + du + (c + dv) * view.nu] = t; }
    return out;
  };
  d.side = move(d.side, -(SIZES.side.cols - 10 - 2) + 2, 0);
  let r = analyze(d, { thickness: 1, hiddenLines: 'all' });
  assert.equal(r.ok, false);
  assert.equal(codes(r)[0], 'DEPTH_MIRRORED');
  assert.ok(codes(r).includes('NO_MATCH'));
  r = analyze(d, { thickness: 1 });
  assert.equal(r.ok, false);
  assert.equal(codes(r)[0], 'DEPTH_MIRRORED');

  d = fromBoards(bookshelf(), 20, 10, 14).drawing;
  d.top = move(mirrorV(d.top), 0, -(SIZES.top.rows - 10 - 2) + 2);
  for (const hiddenLines of ['needed', 'all']) {
    r = analyze(d, { thickness: 1, hiddenLines });
    assert.equal(codes(r)[0], 'DEPTH_MIRRORED', hiddenLines);
  }
});

test('板厚チェックなしのとき、「ほかの形」は出さない', () => {
  const { drawing } = fromBoards(bookshelf(), 20, 10, 14);
  const r = analyze(drawing, { thickness: 1, boardCheck: false });
  assert.equal(r.ok, true);
  assert.equal(r.model.parts.length, 4);
  assert.equal(r.alternatives.length, 0);
});

test('板だけでできた形が2つ考えられる図面: ほかの形として知らせる', () => {
  // 板1枚分の厚さのわく（4枚の板）。中があいているのか、板がはまっているのかは図面から決まらない。
  const W = 10, D = 1, H = 8;
  const frame = [[0, W, 0, D, 0, 1], [0, W, 0, D, H - 1, H], [0, 1, 0, D, 1, H - 1], [W - 1, W, 0, D, 1, H - 1]];
  const { drawing } = fromBoards(frame, W, D, H);
  const r = analyze(drawing, { thickness: 1 });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.model.parts.length, 4, 'まず、中があいた形を出す');
  assert.equal(r.alternatives.length, 1);
  assert.equal(r.alternatives[0].parts.length, 5, 'ほかの形: 中に板がはまっている');
});

test('でたらめに組んだ板の作品: 正しくかいた図面は、かならず立体になる', async () => {
  const { labelsFromBoards } = await import('../src/core/model.js');
  const { renderViews } = await import('../src/core/render.js');
  const { drawingFromProblem } = await import('../src/core/drawing.js');
  const { partGroups } = await import('../src/core/boards.js');
  const { rng } = await import('./helpers.js');
  const r = rng(424242);
  let tried = 0, same = 0, alt = 0;
  while (tried < 300) {
    const nx = 4 + Math.floor(r() * 8), ny = 3 + Math.floor(r() * 6), nz = 4 + Math.floor(r() * 8);
    // 厚さ1マスの板を、重ならないようにでたらめにおく
    const used = new Uint8Array(nx * ny * nz), boards = [];
    for (let k = 0; k < 60 && boards.length < 2 + Math.floor(r() * 6); k++) {
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
    if (partGroups(labels, nx, ny, nz).length !== 1) continue; // 宙にういた板のある組み合わせはのぞく
    // 図のはしまで使っていない組み合わせは、図の大きさが変わるのでのぞく
    const P = renderViews(labels, nx, ny, nz);
    const d = drawingFromProblem(P, SIZES, { u: 1, v: 1 });
    const res = analyze(d, { thickness: 1 });
    tried++;
    assert.equal(res.ok, true, `#${tried} ${JSON.stringify(boards)} → ${res.issues.map((i) => i.code)}`);
    assert.ok(res.model.parts.every((p) => p.isBoard));
    // 元の板の組み合わせ（板のある範囲だけを切り出したもの）とくらべる
    const lo = [nx, ny, nz], hi = [0, 0, 0];
    for (const b of boards) { lo[0] = Math.min(lo[0], b.x0); lo[1] = Math.min(lo[1], b.y0); lo[2] = Math.min(lo[2], b.z0); hi[0] = Math.max(hi[0], b.x1); hi[1] = Math.max(hi[1], b.y1); hi[2] = Math.max(hi[2], b.z1); }
    const w = hi[0] - lo[0], dd = hi[1] - lo[1], h = hi[2] - lo[2];
    assert.deepEqual([res.model.W, res.model.D, res.model.H], [w, dd, h]);
    const crop = new Int32Array(w * dd * h);
    for (let z = 0; z < h; z++) for (let y = 0; y < dd; y++) for (let x = 0; x < w; x++) crop[x + w * (y + dd * z)] = labels[x + lo[0] + nx * (y + lo[1] + ny * (z + lo[2]))];
    if (samePartition(res.model.unit, crop)) same++;
    if (res.alternatives.length) alt++;
  }
  // ほとんどの場合、元の板の組み合わせと同じ形になる
  assert.ok(same / tried > 0.97, `元と同じ形になった割合が低い: ${same}/${tried}`);
  console.log(`      元と同じ形: ${same}/${tried}、ほかの形もある図面: ${alt}`);
});

test('たなや仕切りの多い作品（板12枚）: すぐに立体になり、見えない背板もおぎなわれる', () => {
  const W = 36, D = 11, H = 16;
  const boards = [
    [0, 1, 0, D, 0, H], [W - 1, W, 0, D, 0, H], // 側板
    [1, W - 1, 0, D, 0, 1], [1, W - 1, 0, D, H - 1, H], // 底板・天板
    [1, W - 1, D - 1, D, 1, H - 1], // 背板（正面・上・右のどこからも面が見えない）
    [1, W - 1, 0, D - 1, 5, 6], [1, W - 1, 1, D - 1, 10, 11], // たな板2枚
    [12, 13, 0, D - 1, 1, 5], [24, 25, 0, D - 1, 1, 5], // 下の段の仕切り
    [18, 19, 1, D - 1, 6, 10], // 中の段の仕切り
    [9, 10, 2, D - 1, 11, H - 1], [27, 28, 2, D - 1, 11, H - 1], // 上の段の仕切り
  ];
  const { labels, drawing } = fromBoards(boards, W, D, H);
  assert.ok(drawing, '用紙に入る');
  for (const boardCheck of [true, false]) {
    const t0 = performance.now();
    const r = analyze(drawing, { thickness: 1, boardCheck });
    const ms = performance.now() - t0;
    assert.equal(r.ok, true, JSON.stringify(codes(r)));
    assert.ok(ms < 3000, `時間がかかりすぎ: ${ms.toFixed(0)}ms`);
    // たな板や仕切りが、奥から板1枚分だけ手前で止まっている → そこに背板があると読む
    assert.equal(r.model.parts.length, 12);
    assert.ok(samePartition(r.model.unit, labels));
    if (boardCheck) {
      // 背板のない形も図面とは合うので、「ほかの形」として見られる
      assert.equal(r.alternatives.length, 1);
      assert.equal(r.alternatives[0].parts.length, 11);
    }
  }
});
