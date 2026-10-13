import test from 'node:test';
import assert from 'node:assert/strict';

import { getTemplate, TEMPLATES } from '../src/sheet/templates.js';
import { encodeCode, decodeCode, encodeOldCode } from '../src/sheet/code.js';
import { sheetSvg } from '../src/sheet/layout.js';
import { readSheet } from '../src/reader/reader.js';
import { analyze } from '../src/core/analyze.js';
import { emptyDrawing, drawingFromProblem } from '../src/core/drawing.js';
import fs from 'node:fs';
import { rasterSheet, drawPencil, photograph, diffDrawings, repaintCode, fromPNG } from './synth.js';
import { fromBoards, bookshelf, drawLine, drawRect, DASH } from './helpers.js';

const SETTINGS = { scaleMm: 10, boardMm: 12, thickness: 1, boardCheck: true, hiddenLines: 'needed', gridTone: 'normal' };
// たな板2枚と仕切りのある本立て（かくれ線や、1マスだけの線が多い）。1マス10mmで はば300×奥行き150×高さ220
const SHELF = [...bookshelf(30, 15, 22), [1, 29, 2, 14, 8, 9], [1, 29, 1, 14, 15, 16], [14, 15, 1, 14, 1, 8]];
const SMALL = [...bookshelf(20, 9, 12), [1, 19, 2, 8, 5, 6], [9, 10, 1, 8, 1, 5]];

/** 用紙に図面をかいて、写真にとる。tpl: 用紙の番号（3 = A3横） */
function shoot({ tpl = 3, boards = SHELF, dims = [30, 15, 22], sheet = {}, pencil = {}, camera = {}, origin } = {}) {
  const t = getTemplate(tpl);
  const model = fromBoards(boards, ...dims, t.sizes);
  // origin: 図をかく位置（わくの左下からのマス数）。指定しなければ、わくから2マスあける
  if (origin) model.drawing = drawingFromProblem(model.P, t.sizes, origin);
  assert.ok(model.drawing, '図が用紙に入らない');
  const raster = rasterSheet(t, { ...SETTINGS, ...sheet }, t.pageW > 300 || t.pageH > 300 ? 8 : 10, { mono: sheet.mono, oldGrid: sheet.oldGrid });
  drawPencil(raster, model.drawing, { seed: 3, ...pencil });
  const big = t.landscape ? { width: 2400, height: 1800 } : { width: 1800, height: 2400 };
  const photo = photograph(raster, { seed: 5, ...big, ...camera });
  return { model, photo, res: readSheet(photo) };
}

test('設定コード: 入れた設定がそのまま読める', () => {
  for (const template of [0, 1, 2, 3, 4])
    for (const scaleMm of [5, 10, 12, 15])
      for (const boardMm of [9, 12, 15, 19])
        for (const thickness of [1, 2])
          for (const boardCheck of [true, false])
            for (const hiddenLines of ['needed', 'all']) {
              const bits = encodeCode({ template, scaleMm, boardMm, thickness, boardCheck, hiddenLines });
              assert.equal(bits.length, 28);
              assert.deepEqual(decodeCode(bits), { template, scaleMm, thickness, boardCheck, boardMm, hiddenLines });
            }
  assert.equal(decodeCode(new Array(28).fill(0)), null);
  assert.equal(decodeCode(new Array(28).fill(1)), null);
  assert.equal(decodeCode(new Array(24).fill(1)), null);
});

test('設定コード: ます目を3か所まで読みまちがえても、かならず「読めない」になる（ちがう設定に化けない）', () => {
  for (const set of [{ template: 3, scaleMm: 10, boardMm: 12, thickness: 1, boardCheck: true, hiddenLines: 'needed' }, { template: 4, scaleMm: 15, boardMm: 19, thickness: 2, boardCheck: false, hiddenLines: 'all' }]) {
    const bits = encodeCode(set);
    let tried = 0;
    for (let a = 0; a < 28; a++)
      for (let b = a; b < 28; b++)
        for (let c = b; c < 28; c++) {
          const broken = bits.slice();
          for (const at of new Set([a, b, c])) broken[at] ^= 1;
          assert.equal(decodeCode(broken), null, `${a},${b},${c}`);
          tried++;
        }
    assert.equal(tried, 4060); // 1か所 28通り、2か所 378通り（2回ずつ数える）、3か所 3276通り
  }
});

test('設定コード: 前の形式の用紙も読める（かくれ線のかき方は入っていない）', () => {
  for (const template of [0, 2, 3, 4])
    for (const scaleMm of [5, 10, 15])
      for (const boardCheck of [true, false]) {
        const set = { template, scaleMm, boardMm: 12, thickness: 1, boardCheck };
        assert.deepEqual(decodeCode(encodeOldCode(set)), { template, scaleMm, thickness: 1, boardCheck, boardMm: 12, hiddenLines: null });
      }
});

test('用紙: SVG がつくれて、3つのわくが紙の中におさまる', () => {
  for (const t of TEMPLATES) {
    const svg = sheetSvg(t, SETTINGS);
    assert.match(svg, /^<svg /);
    assert.ok(svg.includes(`width="${t.pageW}mm"`));
    assert.ok(svg.includes('板の厚さ'));
    for (const b of Object.values(t.boxes)) {
      assert.ok(b.x >= 10 && b.x + b.w <= t.pageW - 10);
      assert.ok(b.y >= 20.5 && b.y + b.h <= t.pageH - 20.5);
    }
    // 正面図と平面図は左右が、正面図と右側面図は上下がそろっている
    assert.equal(t.boxes.front.x, t.boxes.top.x);
    assert.equal(t.boxes.front.y, t.boxes.side.y);
    assert.equal(t.boxes.top.rows, t.boxes.side.cols);
  }
  // A3横には、はば300×高さ220×奥行き150（1マス10mm）の作品が、まわりに2マスあけて入る
  const a3 = getTemplate(3);
  assert.deepEqual([a3.pageW, a3.pageH], [420, 297]);
  assert.ok(a3.sizes.front.cols >= 34 && a3.sizes.front.rows >= 26 && a3.sizes.top.rows >= 19);
});

test('写真の読み取り（A3）: ふつうの写真で、線を1本もまちがえない', () => {
  const { model, res } = shoot();
  assert.equal(res.ok, true);
  assert.deepEqual(res.settings, { template: 3, scaleMm: 10, thickness: 1, boardCheck: true, boardMm: 12, hiddenLines: 'needed' });
  assert.deepEqual(res.warnings, []);
  const d = diffDrawings(model.drawing, res.drawing);
  assert.ok(d.total > 600);
  assert.deepEqual({ ...d, total: 0 }, { missed: 0, extra: 0, type: 0, total: 0 });
  // 読み取った図面が、そのまま立体になる
  const r = analyze(res.drawing, res.settings);
  assert.equal(r.ok, true);
  assert.equal(r.model.parts.length, 7);
});

// 小さなカメラ（Chromebook など）と、はじめの版の用紙（5マスごとの線が太い）、細いペン
const CHROMEBOOK = {
  sheet: { gridTone: 'dark', oldGrid: true },
  pencil: { color: [0.3, 0.3, 0.34], thick: 0.3, dashThick: 0.3 },
  camera: { width: 2592, height: 1944, chroma: 5, sharpen: 0.8, tint: [0.92, 0.9, 1.0], blur: 1.1 },
};

const CASES = [
  ['A3: 紙が90度回っている', { camera: { rotate: 1 } }],
  ['A3: 紙が逆さま', { camera: { rotate: 2 } }],
  ['A3: ななめからとった', { camera: { tilt: 0.08, seed: 11 } }],
  ['A3: 紙が少しかたむいて小さく写っている', { camera: { spin: 0.2, fill: 0.72 } }],
  ['A3: 解像度が低い (1600×1200)', { camera: { width: 1600, height: 1200 } }],
  ['A3: ピントがあまい', { camera: { blur: 2.2 } }],
  ['A3: かげで暗い・ノイズが多い', { camera: { shade: 0.5, noise: 0.04 } }],
  ['A3: レンズのゆがみが大きい', { camera: { lens: 0.06 } }],
  ['A3: 逆さまで、ゆがみもとても大きい', { camera: { rotate: 2, lens: 0.1 } }],
  ['A3: 白黒で印刷した用紙・うすいえんぴつ', { sheet: { mono: true }, pencil: { color: [0.5, 0.5, 0.52], thick: 0.45 } }],
  ['A3: 白黒印刷・こい方眼', { sheet: { mono: true, gridTone: 'dark' } }],
  ['A3: 赤ペンでかいた', { pencil: { color: [0.8, 0.15, 0.15] } }],
  ['A3: 線が方眼から少しずれている', { pencil: { jitter: 0.7 } }],
  ['A3: 太いペン', { pencil: { color: [0.1, 0.1, 0.12], thick: 1.0, dashThick: 0.9, dash: [3, 2] } }],
  ['A3縦の用紙', { tpl: 4, boards: [...bookshelf(20, 12, 40), [1, 19, 2, 11, 13, 14], [1, 19, 2, 11, 26, 27]], dims: [20, 12, 40] }],
  ['A4横の用紙', { tpl: 0, boards: SMALL, dims: [20, 9, 12], camera: { width: 1800, height: 1350 } }],
  ['A4横・奥行き広めの用紙', { tpl: 1, boards: [...bookshelf(20, 10, 9), [9, 10, 1, 9, 1, 9]], dims: [20, 10, 9], camera: { width: 1800, height: 1350 } }],
  ['A4縦の用紙', { tpl: 2, boards: [...bookshelf(14, 9, 20), [1, 13, 2, 8, 9, 10]], dims: [14, 9, 20], camera: { width: 1350, height: 1800 } }],
  ['A4横: 解像度が低い (1024×768)', { tpl: 0, boards: SMALL, dims: [20, 9, 12], camera: { width: 1024, height: 768 } }],
  // Chromebook のカメラで、実物の用紙をとったときのようす（2026-10 に先生がためした写真から）:
  // 水色の方眼の色がにじんで灰色のこい線に写り、5マスごとの線は、細いペンの線と同じくらいのこさになる。
  ['A3: 小さなカメラ（方眼が灰色にこく写る）・細いペン', { ...CHROMEBOOK }],
  ['A3: 小さなカメラ・図をわくのはしに合わせてかいた', { ...CHROMEBOOK, origin: { u: 0, v: 0 } }],
  ['A3: 小さなカメラ・方眼の太い線の上にぴったりかいた', { ...CHROMEBOOK, origin: { u: 5, v: 5 }, pencil: { ...CHROMEBOOK.pencil, jitter: 0 } }],
  ['A3: 小さなカメラ・いまの用紙（太い線を細くした）', { ...CHROMEBOOK, sheet: { gridTone: 'dark' }, origin: { u: 5, v: 5 } }],
];
for (const [name, o] of CASES) {
  test(`写真の読み取り: ${name}`, () => {
    const { model, res } = shoot(o);
    assert.equal(res.ok, true, res.code);
    assert.equal(res.template, o.tpl ?? 3);
    assert.ok(!res.warnings.includes('CODE_UNREADABLE'), '設定コードが読めなかった');
    assert.deepEqual([res.settings.scaleMm, res.settings.boardMm], [10, 12]);
    const d = diffDrawings(model.drawing, res.drawing);
    assert.equal(d.missed, 0, '読み落とした線がある');
    assert.equal(d.extra, 0, 'ない線を読んだ');
    assert.ok(d.type <= 1, `実線と破線のまちがいが多い: ${d.type}`);
  });
}

test('「かくれ線は全部かく」の用紙: 写真から、その設定が読める', () => {
  const { model, res } = shoot({ sheet: { hiddenLines: 'all' } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.settings.hiddenLines, 'all');
  assert.deepEqual({ ...diffDrawings(model.drawing, res.drawing), total: 0 }, { missed: 0, extra: 0, type: 0, total: 0 });
  assert.equal(analyze(res.drawing, res.settings).ok, true);
});

test('「基本本棚」を印刷しておいた用紙: 写真から、印刷した図面が読める。たな板をかきたしても読める', async () => {
  const { makeSample } = await import('../src/core/samples.js');
  for (const [tplId, camera] of [[3, { width: 2400, height: 1800 }], [3, CHROMEBOOK.camera], [0, { width: 1800, height: 1350 }]])
    for (const hiddenLines of ['needed', 'all']) {
      const t = getTemplate(tplId), settings = { ...SETTINGS, hiddenLines };
      const figure = makeSample('basic', t.sizes, settings);
      const raster = rasterSheet(t, settings, t.pageW > 300 ? 8 : 10, { figure });
      // 何もかきたさずに写真にとる
      let res = readSheet(photograph(raster, { seed: 5, ...camera }));
      assert.equal(res.ok, true);
      assert.deepEqual({ ...diffDrawings(figure, res.drawing), total: 0 }, { missed: 0, extra: 0, type: 0, total: 0 }, `${t.name} ${hiddenLines}`);
      assert.equal(analyze(res.drawing, res.settings).ok, true);
      if (tplId !== 3 || hiddenLines !== 'needed') continue;
      // 生徒が、えんぴつでたな板（厚さ1マス）をかきたす
      const added = emptyDrawing(t.sizes);
      drawLine(added.front, 5, 7, 35, 7); drawLine(added.front, 5, 8, 35, 8);
      drawPencil(raster, added, { seed: 3 });
      res = readSheet(photograph(raster, { seed: 5, ...camera }));
      const want = structuredClone(figure);
      drawLine(want.front, 5, 7, 35, 7); drawLine(want.front, 5, 8, 35, 8);
      assert.deepEqual({ ...diffDrawings(want, res.drawing), total: 0 }, { missed: 0, extra: 0, type: 0, total: 0 }, 'たな板をかきたした');
      const r = analyze(res.drawing, res.settings);
      assert.equal(r.ok, true, r.issues.map((i) => i.code).join());
      assert.equal(r.model.parts.length, 5);
    }
});

test('必要なかくれ線だけをかいた図面の写真: 立体になり、のこりのかくれ線はアプリがおぎなう', () => {
  const t = getTemplate(3);
  const full = fromBoards(bookshelf(30, 15, 22), 30, 15, 22, t.sizes);
  // かくれ線は、右側面図の「底板の上の面」だけ
  const drawing = structuredClone(full.drawing);
  for (const n of ['front', 'top', 'side']) for (const k of ['V', 'H']) drawing[n][k] = drawing[n][k].map((v) => (v === DASH ? 0 : v));
  drawLine(drawing.side, 2, 3, 17, 3, DASH);
  const raster = rasterSheet(t, SETTINGS, 8);
  drawPencil(raster, drawing, { seed: 3 });
  const res = readSheet(photograph(raster, { seed: 5, width: 2400, height: 1800 }));
  assert.equal(res.ok, true);
  assert.deepEqual({ ...diffDrawings(drawing, res.drawing), total: 0 }, { missed: 0, extra: 0, type: 0, total: 0 });
  const r = analyze(res.drawing, res.settings);
  assert.equal(r.ok, true);
  assert.equal(r.model.parts.length, 4);
  assert.ok(r.model.supplement.side.length > 0, 'おぎなったかくれ線がない');
  // 「全部かく」の設定では、かくれ線がたりないので立体にしない
  assert.equal(analyze(res.drawing, { ...res.settings, hiddenLines: 'all' }).ok, false);
});

test('前の形式の用紙の写真: 読めて、かくれ線のかき方は画面の設定のままになる', () => {
  const t = getTemplate(3);
  const model = fromBoards(SHELF, 30, 15, 22, t.sizes);
  for (const hiddenLines of ['needed', 'all']) {
    const raster = rasterSheet(t, SETTINGS, 8);
    repaintCode(raster, encodeOldCode({ template: 3, scaleMm: 10, boardMm: 12, thickness: 1, boardCheck: true }));
    drawPencil(raster, model.drawing, { seed: 3 });
    const res = readSheet(photograph(raster, { seed: 5, width: 2400, height: 1800 }), { fallback: { template: 0, scaleMm: 15, boardMm: 15, thickness: 1, boardCheck: true, hiddenLines } });
    assert.equal(res.ok, true);
    assert.deepEqual(res.warnings, []);
    assert.deepEqual(res.settings, { template: 3, scaleMm: 10, thickness: 1, boardCheck: true, boardMm: 12, hiddenLines });
    assert.equal(diffDrawings(model.drawing, res.drawing).missed + diffDrawings(model.drawing, res.drawing).extra, 0);
  }
});

test('パソコンやタブレットで直接かきこんだ画像（ゆがみなし）も読める', () => {
  const t = getTemplate(3);
  const model = fromBoards(SHELF, 30, 15, 22, t.sizes);
  const raster = rasterSheet(t, SETTINGS, 6);
  drawPencil(raster, model.drawing, { jitter: 0, thick: 0.8, color: [0, 0, 0] });
  const data = new Uint8ClampedArray(raster.w * raster.h * 4);
  for (let i = 0; i < raster.w * raster.h; i++) { for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(raster.rgb[i * 3 + c] * 255); data[i * 4 + 3] = 255; }
  const res = readSheet({ data, width: raster.w, height: raster.h });
  assert.equal(res.ok, true);
  assert.deepEqual({ ...diffDrawings(model.drawing, res.drawing), total: 0 }, { missed: 0, extra: 0, type: 0, total: 0 });
});

test('何もかいていない用紙: 線は0本', () => {
  const t = getTemplate(3);
  const photo = photograph(rasterSheet(t, SETTINGS, 8), { seed: 5, width: 2400, height: 1800 });
  const res = readSheet(photo);
  assert.equal(res.ok, true);
  assert.deepEqual(diffDrawings(emptyDrawing(t.sizes), res.drawing), { missed: 0, extra: 0, type: 0, total: 0 });
  assert.ok(res.warnings.includes('NO_LINES'));
});

test('用紙ではない画像: マークが見つからないと伝える', () => {
  const w = 640, h = 480;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = 120 + 100 * Math.sin(i * 0.01) * Math.cos((i % w) * 0.05); data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  const res = readSheet({ data, width: w, height: h });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NO_MARKERS');
  assert.ok(res.message.length > 10);
});

test('設定コードがよごれて読めないとき: 画面の設定で読む', () => {
  const t = getTemplate(3);
  const model = fromBoards(SHELF, 30, 15, 22, t.sizes);
  const raster = rasterSheet(t, SETTINGS, 8);
  // コードのあたりを白くぬりつぶす
  for (let y = Math.round(12 * 8); y < Math.round(19 * 8); y++)
    for (let x = Math.round(24 * 8); x < Math.round(180 * 8); x++) for (let c = 0; c < 3; c++) raster.rgb[(x + y * raster.w) * 3 + c] = 1;
  drawPencil(raster, model.drawing, { seed: 3 });
  const res = readSheet(photograph(raster, { seed: 5, width: 2400, height: 1800 }), { fallback: { template: 3, scaleMm: 15, boardMm: 15, thickness: 1, boardCheck: true, hiddenLines: 'all' } });
  assert.equal(res.ok, true);
  assert.ok(res.warnings.includes('CODE_UNREADABLE'));
  assert.equal(res.settings.scaleMm, 15);
  assert.equal(res.settings.boardMm, 15);
  assert.equal(res.settings.hiddenLines, 'all');
  const d = diffDrawings(model.drawing, res.drawing);
  assert.equal(d.missed + d.extra, 0);
});

// 実物の写真（test/photos/ は手元にだけ置き、公開しない）。あるときだけ、ためす。
const REAL = new URL('./photos/chromebook-2026-10-09.png', import.meta.url);
test('実物の写真: Chromebook でとった手書きの図面（細いペン）を、手直しなしで読める', { skip: fs.existsSync(REAL) ? false : '写真が手元にない' }, async () => {
  const res = readSheet(await fromPNG(fs.readFileSync(REAL)));
  assert.equal(res.ok, true);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.template, 3);
  // 写真にかいてある図面（側板2枚・底板・後ろの横板）
  const want = emptyDrawing(getTemplate(3).sizes);
  drawRect(want.front, 4, 0, 36, 22);
  drawLine(want.front, 5, 0, 5, 22); drawLine(want.front, 35, 0, 35, 22);
  for (const v of [1, 14, 18]) drawLine(want.front, 5, v, 35, v);
  drawRect(want.top, 4, 0, 36, 16);
  drawLine(want.top, 4, 15, 36, 15); drawLine(want.top, 5, 0, 5, 15); drawLine(want.top, 35, 0, 35, 15);
  drawRect(want.side, 0, 0, 15, 22);
  drawRect(want.side, 15, 14, 16, 18);
  assert.deepEqual(diffDrawings(want, res.drawing), { missed: 0, extra: 0, type: 0, total: 480 });
});
