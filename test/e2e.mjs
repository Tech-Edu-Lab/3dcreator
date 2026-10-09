// ブラウザでの通し確認（node test/e2e.mjs [スクリーンショットの保存先]）
//
//  アプリを開く → 見本が立体になる → 直すところのある見本は出力されない
//  → 用紙を PDF / PNG で保存 → その PNG にえんぴつで図面をかいて写真にとったつもりの画像を読みこむ
//  → 立体になる → STL / GLB を保存して中身をたしかめる
//
// 先に `npm run build` をしておくこと。
// OFFLINE=1 をつけると、ネットワークを切った状態（フォントも読みこめない状態）でためす。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch } from '../tools/browser.mjs';
import { getTemplate } from '../src/sheet/templates.js';
import { checkClosed } from '../src/core/mesh.js';
import { fromPNG, toPNG, rasterFromImage, drawPencil, photograph, diffDrawings } from './synth.js';
import { fromBoards, bookshelf } from './helpers.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), '3dcreator-e2e-'));
fs.mkdirSync(out, { recursive: true });
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
if (process.env.OFFLINE) await context.route(/^https?:/, (r) => r.abort());
const page = await context.newPage();
const problems = [];
// 文字のフォントが読みこめないのは問題にしない（パソコンのフォントで表示される）
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(e.message));
const step = (s) => console.log(`・${s}`);
const app = (fn, arg) => page.evaluate(fn, arg);
const save = async (click, name) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const file = path.join(out, name || dl.suggestedFilename());
  await dl.saveAs(file);
  return { file, name: dl.suggestedFilename(), data: fs.readFileSync(file) };
};

await page.goto(`file://${root}/dist/index.html`);
await page.waitForFunction(() => window.__app && window.__app.viewer());
await page.waitForTimeout(600);

// 図面にかいてある線の数（実線・かくれ線）と、アプリがおぎなった線・考えられる線の数
const lines = () => app(() => {
  const e = window.__app.editor(), d = e.getDrawing();
  const n = { solid: 0, dash: 0 };
  for (const v of [d.front, d.top, d.side]) for (const a of [v.V, v.H]) for (const x of a) { if (x === 1) n.solid++; else if (x === 2) n.dash++; }
  const count = (o) => (o ? Object.values(o).reduce((k, a) => k + a.length, 0) : 0);
  n.supplement = count(e.supplement);
  n.ghost = e.issues.reduce((k, i) => k + (i.marks || []).reduce((q, m) => q + (m.ghost ? m.ghost.length : 0), 0), 0);
  return n;
});
const pos = (name, u, v) => app(([n, uu, vv]) => {
  const e = window.__app.editor(), b = e.tpl.boxes[n], r = e.canvas.getBoundingClientRect();
  return { x: r.left + (b.x + uu * 5 - e.vx) * e.scale, y: r.top + (b.y + b.h - vv * 5 - e.vy) * e.scale };
}, [name, u, v]);
const drag = async (name, u0, v0, u1, v1) => {
  const a = await pos(name, u0, v0), b = await pos(name, u1, v1);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2 + 2, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(500);
};

step('開いたとき: 見本の本立て（かくれ線は必要な1本だけ）が立体になり、のこりのかくれ線はアプリがおぎなう');
let st = await app(() => ({ ok: window.__app.state.result.ok, parts: window.__app.state.shown.parts.length, tag: !document.getElementById('sampleTag').hidden, mode: window.__app.state.settings.hiddenLines, sel: document.getElementById('setHidden').value }));
assert.deepEqual(st, { ok: true, parts: 4, tag: true, mode: 'needed', sel: 'needed' });
let ln = await lines();
assert.equal(ln.dash, 15, '見本のかくれ線は、底板の上の面（奥行き15マス）だけ');
assert.ok(ln.supplement > 0 && ln.ghost === 0, 'おぎなったかくれ線が出ている');
assert.match(await page.innerText('#hint'), /緑の破線＝アプリがおぎなったかくれ線/);
assert.match(await page.innerText('#readNote'), /線のない所は「何もない」と読んでいます/);
await page.screenshot({ path: path.join(out, '01-start.png') });

step('かくれ線がたりない見本: 出力されず、考えられるかくれ線（オレンジ）をしめしてたずねる');
await page.selectOption('#sampleSelect', 'hidden');
await page.waitForTimeout(300);
st = await app(() => ({ ok: window.__app.state.result.ok, codes: window.__app.state.result.issues.map((i) => i.code), saveHidden: document.getElementById('saveRow').hidden, fb: document.getElementById('feedback').innerText }));
assert.deepEqual([st.ok, st.codes, st.saveHidden], [false, ['HIDDEN_JOINT'], true]);
assert.match(st.fb, /見えない所の形が決まりません/);
ln = await lines();
assert.deepEqual([ln.dash, ln.supplement, ln.ghost], [0, 0, 2], '考えられるかくれ線は2本');
assert.match(await page.innerText('#hint'), /オレンジの破線＝考えられるかくれ線/);
await page.screenshot({ path: path.join(out, '01a-hidden-joint.png') });
// 考えられる線の1本（底板が背板の下までのびている）を、かくれ線の道具でかく → 立体になる
await page.click('[data-tool="dash"]');
await drag('side', 16, 3, 17, 3);
st = await app(() => ({ ok: window.__app.state.result.ok, parts: window.__app.state.shown && window.__app.state.shown.parts.length, bottom: window.__app.state.shown && window.__app.state.shown.parts.map((p) => p.size.join('×')) }));
assert.equal(st.ok, true, 'かくれ線を1マスかいたら、形が決まる');
assert.equal(st.parts, 4);
ln = await lines();
assert.equal(ln.dash, 1);
assert.ok(ln.supplement > 0 && ln.ghost === 0);
await page.screenshot({ path: path.join(out, '01b-hidden-joint-fixed.png') });
// もう1本のほう（背板が下までのびている）をかくと、べつの組み立て方になる
await page.click('#btnUndo');
await page.waitForTimeout(400);
assert.equal(await app(() => window.__app.state.result.ok), false);
await drag('side', 16, 2, 16, 3);
const other = await app(() => ({ ok: window.__app.state.result.ok, sizes: window.__app.state.shown && window.__app.state.shown.parts.map((p) => p.size.join('×')) }));
assert.equal(other.ok, true);
assert.notDeepEqual(other.sizes, st.bottom, '底板と背板の大きさが、えらんだ線によって変わる');
console.log(`   底板が奥まで: ${st.bottom.join(' / ')}\n   背板が下まで: ${other.sizes.join(' / ')}`);
await page.click('[data-tool="solid"]');

step('設定「かくれ線: 全部かく」: 見本はかくれ線を全部かいた図面になり、たりない図面は通らない');
await page.selectOption('#sampleSelect', 'shelf');
await page.waitForTimeout(300);
await page.selectOption('#setHidden', 'all');
await page.waitForTimeout(400);
ln = await lines();
st = await app(() => ({ ok: window.__app.state.result.ok, parts: window.__app.state.shown.parts.length, tag: !document.getElementById('sampleTag').hidden }));
assert.deepEqual(st, { ok: true, parts: 4, tag: true });
assert.ok(ln.dash > 15 && ln.supplement === 0, `見本にかくれ線が全部かいてある（${ln.dash}）`);
assert.doesNotMatch(await page.innerText('#hint'), /緑の破線/);
assert.equal(await page.isVisible('#readNote'), false, '「全部かく」のときは、読み方の注意は出さない');
await page.screenshot({ path: path.join(out, '01c-all-hidden-lines.png') });
await page.selectOption('#sampleSelect', 'hidden');
await page.waitForTimeout(300);
st = await app(() => ({ ok: window.__app.state.result.ok, codes: window.__app.state.result.issues.map((i) => i.code) }));
assert.deepEqual(st, { ok: false, codes: ['NO_MATCH', 'NO_MATCH'] });
// 同じ図面のまま「必要なものだけ」にもどすと、たずね方が変わる
await page.selectOption('#setHidden', 'needed');
await page.waitForTimeout(400);
assert.deepEqual(await app(() => window.__app.state.result.issues.map((i) => i.code)), ['HIDDEN_JOINT']);

step('板の厚さを考えていない見本: 出力されず、直し方が出る');
await page.selectOption('#sampleSelect', 'nothick');
await page.waitForTimeout(300);
st = await app(() => ({ ok: window.__app.state.result.ok, codes: window.__app.state.result.issues.map((i) => i.code), saveHidden: document.getElementById('saveRow').hidden, fb: document.getElementById('feedback').innerText }));
assert.equal(st.ok, false);
assert.deepEqual(st.codes, ['NOT_BOARD_THICK']);
assert.equal(st.saveHidden, true, '保存ボタンはかくれている');
assert.match(st.fb, /板の厚さがかかれていません/);
await page.screenshot({ path: path.join(out, '02-no-thickness.png') });

step('つなぎ目のない見本: 出力されず、直し方が出る');
await page.selectOption('#sampleSelect', 'noseam');
await page.waitForTimeout(300);
st = await app(() => ({ ok: window.__app.state.result.ok, codes: window.__app.state.result.issues.map((i) => i.code) }));
assert.deepEqual(st, { ok: false, codes: ['NOT_BOARD_JOINED'] });
await page.screenshot({ path: path.join(out, '03-no-seam.png') });

step('エディタ: 線をかきたすと点検結果が変わり、「元に戻す」でもどる');
await page.selectOption('#sampleSelect', 'shelf');
await page.waitForTimeout(300);
await drag('front', 3, 12, 31, 12);
st = await app(() => ({ ok: window.__app.state.result.ok, codes: window.__app.state.result.issues.map((i) => i.code), tag: !document.getElementById('sampleTag').hidden }));
assert.equal(st.ok, false, '線1本のたな板は通らない');
assert.deepEqual(st.codes, ['BOARD_END'], '板のはしか、厚さのない線かを、たしかめる');
assert.equal(st.tag, false, '手を入れたら「見本」の印は消える');
assert.match(await page.innerText('#feedback'), /板のはしか、厚さのない線か、決まりません/);
await page.screenshot({ path: path.join(out, '04-edited.png') });
// たな板を厚さ1マスの長方形にすると、たな板のある本立てになる
await drag('front', 3, 13, 31, 13);
st = await app(() => ({ ok: window.__app.state.result.ok, parts: window.__app.state.shown && window.__app.state.shown.parts.length }));
assert.deepEqual(st, { ok: true, parts: 5 }, 'たな板が1枚ふえた');
await page.screenshot({ path: path.join(out, '04a-shelf-with-thickness.png') });
await page.click('#btnUndo');
await page.waitForTimeout(400);
await page.click('#btnUndo');
await page.waitForTimeout(500);
assert.equal(await app(() => window.__app.state.result.ok), true);

step('用紙: ダイアログを開いて、PDF と PNG を保存する');
await page.click('#btnSheet');
await page.waitForTimeout(300);
assert.match(await page.innerHTML('#sheetPreview'), /見えないつなぎ目や、かくれた板は/, '用紙のきまり: 必要なかくれ線だけ');
await page.selectOption('#dlgHidden', 'all');
await page.waitForTimeout(200);
assert.match(await page.innerHTML('#sheetPreview'), /見える線は実線、見えない線は破線/, '用紙のきまり: 全部かく');
const pngAll = await save(() => page.click('#btnPng'), 'sheet-all.png');
await page.selectOption('#dlgHidden', 'needed');
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, '05-sheet-dialog.png') });
const pdf = await save(() => page.click('#btnPdf'), 'sheet.pdf');
assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
assert.match(pdf.name, /^hougan-A3yoko3-10mm\.pdf$/);
assert.ok(pdf.data.length > 20000, `PDF が小さすぎる: ${pdf.data.length}`);
assert.match(pdf.data.toString('latin1'), /\/MediaBox \[0 0 1190\.55 841\.89\]/, 'A3横の大きさ');
const png = await save(() => page.click('#btnPng'), 'sheet.png');
const sheetImg = await fromPNG(png.data);
assert.deepEqual([sheetImg.width, sheetImg.height], [2480, 1754], 'A3横・150dpi');
await page.click('#dlgClose');

step('読みこみ: ブラウザが出した用紙に図面をかき、ななめから写真にとった画像を読む');
const tpl = getTemplate(3);
const boards = [...bookshelf(30, 15, 22), [1, 29, 2, 14, 8, 9], [14, 15, 1, 14, 1, 8]];
const model = fromBoards(boards, 30, 15, 22, tpl.sizes);
const raster = rasterFromImage(sheetImg, tpl);
drawPencil(raster, model.drawing, { seed: 21 });
const photo = photograph(raster, { seed: 9, tilt: 0.05, rotate: 2, width: 2400, height: 1800 });
const photoFile = path.join(out, 'photo.png');
fs.writeFileSync(photoFile, await toPNG(photo));
await page.setInputFiles('#fileInput', photoFile);
await page.waitForFunction(() => document.getElementById('busy').hidden && window.__app.editor().photo);
await page.waitForTimeout(700);
const read = await app(() => {
  const e = window.__app.editor(), d = e.getDrawing();
  const pack = (v) => ({ nu: v.nu, nv: v.nv, V: Array.from(v.V), H: Array.from(v.H) });
  return { drawing: { front: pack(d.front), top: pack(d.top), side: pack(d.side) }, ok: window.__app.state.result.ok, parts: window.__app.state.shown && window.__app.state.shown.parts.length, issues: window.__app.state.result.issues.map((i) => i.code), toast: document.getElementById('toast').textContent };
});
const diff = diffDrawings(model.drawing, read.drawing);
console.log('   読み取りのちがい:', JSON.stringify(diff), read.toast);
assert.equal(diff.missed + diff.extra, 0, '線の読み落とし・読みすぎがある');
assert.ok(diff.type <= 1);
await page.screenshot({ path: path.join(out, '06-photo-loaded.png') });
if (diff.type === 0) { assert.equal(read.ok, true, read.issues.join()); assert.equal(read.parts, 6); }

step('読みこみ: 「かくれ線は全部かく」の用紙を読むと、画面の設定もそれに合う');
{
  const r2 = rasterFromImage(await fromPNG(pngAll.data), tpl);
  drawPencil(r2, model.drawing, { seed: 4 });
  const f2 = path.join(out, 'photo-all.png');
  fs.writeFileSync(f2, await toPNG(photograph(r2, { seed: 12, tilt: 0.03, width: 2400, height: 1800 })));
  await app(() => { window.__app.editor().photo = null; });
  await page.setInputFiles('#fileInput', f2);
  await page.waitForFunction(() => document.getElementById('busy').hidden && window.__app.editor().photo);
  await page.waitForTimeout(500);
  assert.deepEqual(await app(() => [window.__app.state.settings.hiddenLines, document.getElementById('setHidden').value, window.__app.state.result.ok]), ['all', 'all', true]);
  await page.selectOption('#setHidden', 'needed');
  await page.waitForTimeout(300);
  assert.equal(await app(() => window.__app.state.result.ok), true, 'かくれ線が全部かいてある図面は、どちらの設定でも立体になる');
}

step('読みこみ: 画像のはりつけ（Ctrl+V）と、ドラッグ＆ドロップでも読める');
for (const how of ['paste', 'drop']) {
  await page.selectOption('#sampleSelect', 'nothick');
  await page.waitForTimeout(200);
  await app(async ([kind, b64]) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'photo.png', { type: 'image/png' }));
    if (kind === 'paste') document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    else document.getElementById('app').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [how, fs.readFileSync(photoFile).toString('base64')]);
  await page.waitForFunction(() => document.getElementById('busy').hidden && window.__app.editor().photo);
  const n = await app(() => { const d = window.__app.editor().getDrawing(); let c = 0; for (const v of [d.front, d.top, d.side]) for (const a of [v.V, v.H]) for (const x of a) if (x) c++; return c; });
  assert.equal(n, diff.total - diff.missed + diff.extra, `${how}: 読み取った線の数`);
}

step('立体: STL と GLB を保存して中身をたしかめる');
await page.selectOption('#sampleSelect', 'shelf');
await page.waitForTimeout(400);
const stl = await save(() => page.click('#btnStl'));
assert.match(stl.name, /^rittai-\d{8}-\d{4}\.stl$/);
const tris = stl.data.readUInt32LE(80);
assert.equal(stl.data.length, 84 + tris * 50);
const posArr = new Float32Array(tris * 9);
for (let t = 0; t < tris; t++) for (let k = 0; k < 9; k++) posArr[t * 9 + k] = stl.data.readFloatLE(84 + t * 50 + 12 + k * 4);
assert.equal(checkClosed(posArr).closed, true, 'STL が閉じた形になっていない');
let max = [0, 0, 0];
for (let i = 0; i < posArr.length; i += 3) for (let k = 0; k < 3; k++) max[k] = Math.max(max[k], posArr[i + k]);
assert.deepEqual(max, [300, 150, 220], 'STL の大きさ (mm): マスの数 × 10mm');
const glb = await save(() => page.click('#btnGlb'));
assert.equal(glb.data.toString('latin1', 0, 4), 'glTF');
assert.equal(glb.data.readUInt32LE(4), 2);
const jsonLen = glb.data.readUInt32LE(12);
const gltf = JSON.parse(glb.data.toString('utf8', 20, 20 + jsonLen));
assert.equal(gltf.meshes.length, 4, 'GLB は板ごとに分かれている');
assert.deepEqual(gltf.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name), ['板1', '板2', '板3', '板4']);
const top = Math.max(...gltf.meshes.map((m) => gltf.accessors[m.primitives[0].attributes.POSITION].max[1]));
assert.ok(Math.abs(top - 0.22) < 1e-6, `GLB の単位はメートル・Y が上（高さ ${top}）`);
console.log(`   STL: 三角形 ${tris} 枚 / GLB: ${glb.data.length} バイト, メッシュ ${gltf.meshes.length}`);

step('寸法: 板の厚さは12mmに読みかえられ、数字を入れると立体と部品表が変わる');
const chain = (axis) => app((a) => {
  const row = document.querySelector(`.dim-row[data-axis="${a}"]`);
  return [...row.querySelectorAll('.dim-board, .dim-in')].map((el) => (el.matches('.dim-board') ? `[${el.textContent}]` : el.value)).join(' ');
}, axis);
assert.equal(await chain('x'), '[12] 276 [12] 300', 'はば: 12 + 276 + 12 = 300');
assert.equal(await chain('z'), '[12] 208 220', '高さ: 底板 12 + 208 = 220');
assert.equal(await chain('y'), '138 [12] 150', '奥行き: 138 + 背板 12 = 150');
let partsText = await page.innerText('#parts');
assert.match(partsText, /276 × 150 × 12/, '底板は 300 − 24 = 276');
assert.match(partsText, /276 × 208 × 12/, '背板');
await page.hover('#dim-x-1-29');
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(out, '07a-dimension-focus.png') });
// あいだを 300 にする → 全体は 324
await page.fill('#dim-x-1-29', '300');
await page.press('#dim-x-1-29', 'Enter');
await page.waitForTimeout(300);
assert.equal(await chain('x'), '[12] 300 [12] 324');
partsText = await page.innerText('#parts');
assert.match(partsText, /300 × 150 × 12/);
assert.match(partsText, /はば 324 × 奥行き 150 × 高さ 220/);
{
  const stl2 = await save(() => page.click('#btnStl'), 'wide.stl');
  let mx = 0;
  for (let t = 0; t < stl2.data.readUInt32LE(80); t++) for (let k = 0; k < 9; k += 3) mx = Math.max(mx, stl2.data.readFloatLE(84 + t * 50 + 12 + k * 4));
  assert.equal(mx, 324, 'STL のはばも 324mm');
}
// 全体の高さを 250 にする → あいだは 238
await page.fill('#dim-z-total', '250');
await page.press('#dim-z-total', 'Tab');
await page.waitForTimeout(300);
assert.equal(await chain('z'), '[12] 238 250');
await page.screenshot({ path: path.join(out, '07b-dimensions-edited.png') });
// 自動にもどす
await page.click('.dim-row[data-axis="x"] .dim-reset');
await page.click('.dim-row[data-axis="z"] .dim-reset');
await page.waitForTimeout(300);
assert.equal(await chain('x'), '[12] 276 [12] 300');
assert.equal(await chain('z'), '[12] 208 220');

step('寸法: たな板で分かれた2つのすき間。片方に数字を入れると、もう片方と全体のつじつまが合う');
await app(() => {
  // 見本の本立てに、たな板（厚さ1マス）をかきたす: 正面図は実線、右側面図はかくれ線
  const d = window.__app.editor().getDrawing();
  for (const row of [12, 13]) {
    for (let u = 3; u < 31; u++) d.front.H[u + row * d.front.nu] = 1;
    for (let u = 2; u < 16; u++) d.side.H[u + row * d.side.nu] = 2;
  }
  window.__app.run();
});
await page.waitForTimeout(400);
assert.equal(await app(() => window.__app.state.shown.parts.length), 5, 'たな板が1枚ふえた');
assert.equal(await chain('z'), '[12] 88 [12] 108 220', '196 を 9マス:11マス に分ける');
const type = async (id, value, key = 'Enter') => { await page.fill(id, value); await page.press(id, key); await page.waitForTimeout(250); };
await type('#dim-z-1-10', '100');
assert.equal(await chain('z'), '[12] 100 [12] 96 220', '外形 220 はそのまま、のこりが 96 に');
await type('#dim-z-11-22', '150');
assert.equal(await chain('z'), '[12] 100 [12] 150 274', '両方に数字を入れたら、全体は足し算');
await type('#dim-z-total', '300');
assert.equal(await chain('z'), '[12] 100 [12] 176 300', '全体を決めたら、長いほうのすき間で合わせる');
await type('#dim-z-1-10', '');
assert.equal(await chain('z'), '[12] 124 [12] 152 300', '数字を消すと自動にもどる');
assert.match(await page.innerText('#parts'), /300 × 150 × 12/, '側板の長さも 300 に');
await page.click('.dim-row[data-axis="z"] .dim-reset');
await page.waitForTimeout(250);
assert.equal(await chain('z'), '[12] 88 [12] 108 220');

step('設定: 板の厚さを変えると読みかえが変わる。板厚チェックを外すと、どのマスも同じ大きさ');
await page.selectOption('#setBoard', '15');
await page.waitForTimeout(400);
assert.equal(await chain('x'), '[15] 270 [15] 300');
await page.selectOption('#setBoard', '12');
await page.uncheck('#setCheck');
await page.waitForTimeout(400);
assert.equal(await chain('x'), '10 280 10 300');
await page.check('#setCheck');
await page.waitForTimeout(400);
assert.equal(await chain('x'), '[12] 276 [12] 300');
await page.selectOption('#sampleSelect', 'shelf');
await page.waitForTimeout(400);

step('立体: 向きを変える・ばらす・回す');
await page.click('[data-view="front"]');
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, '07-front-view.png') });
await page.click('[data-view="iso"]');
await page.fill('#explode', '70');
await page.dispatchEvent('#explode', 'input');
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, '08-exploded.png') });
await page.fill('#explode', '0');
await page.dispatchEvent('#explode', 'input');
const box = await page.locator('#view3d canvas').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, '09-rotated.png') });

step('せまい画面（スマートフォンのはば）と、暗い表示');
await page.setViewportSize({ width: 400, height: 860 });
await page.waitForTimeout(400);
const overflow = await app(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert.ok(overflow <= 1, `横にはみ出している: ${overflow}px`);
await page.screenshot({ path: path.join(out, '10-phone.png'), fullPage: true });
await page.setViewportSize({ width: 1280, height: 800 });
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, '11-dark.png') });

step('アーティファクトとして開いたとき: 印刷ボタンは出さず、STL は ZIP に入れて保存する');
{
  // claude.ai がページをつつむのと同じ形にして、保存機能（downloads）のかわりを入れる
  const fragment = fs.readFileSync(path.join(root, 'dist/artifact.html'), 'utf8');
  const wrapped = path.join(out, 'artifact-wrapped.html');
  fs.writeFileSync(wrapped, `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui;background:#f7f7f5}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${fragment}</body></html>`);
  const p2 = await context.newPage();
  p2.on('pageerror', (e) => problems.push(e.message));
  await p2.addInitScript(() => {
    window.__saved = [];
    window.claude = {
      use: async (name) => (name === 'downloads' ? {
        save: async ({ filename, data }) => {
          const bytes = new Uint8Array(await new Blob([data]).arrayBuffer());
          window.__saved.push({ filename, size: bytes.length, head: Array.from(bytes.slice(0, 120)) });
          return { status: 'saved' };
        },
      } : null),
    };
  });
  await p2.goto(`file://${wrapped}`);
  await p2.waitForFunction(() => window.__app && window.__app.viewer());
  assert.equal(await p2.title(), '正投影図 3Dクリエイター');
  await p2.click('#btnStl');
  await p2.click('#btnSheet');
  assert.equal(await p2.isVisible('#btnPrint'), false, '印刷ボタンは出さない');
  await p2.click('#btnPdf');
  await p2.waitForFunction(() => window.__saved.length >= 2);
  const saved = await p2.evaluate(() => window.__saved);
  assert.match(saved[0].filename, /^rittai-\d{8}-\d{4}\.zip$/);
  const head = Buffer.from(saved[0].head);
  assert.equal(head.readUInt32LE(0), 0x04034b50, 'ZIP の先頭');
  assert.match(head.toString('utf8', 30, 30 + head.readUInt16LE(26)), /^rittai-\d{8}-\d{4}\.stl$/);
  assert.match(saved[1].filename, /\.pdf$/);
  assert.equal(Buffer.from(saved[1].head).toString('latin1', 0, 5), '%PDF-');
  await p2.close();
}

step('公開ページの入口（フォルダ直下の index.html）から開いても、アプリが出る');
{
  const p3 = await context.newPage();
  p3.on('pageerror', (e) => problems.push(e.message));
  await p3.goto(`file://${root}/index.html`);
  await p3.waitForURL(/\/dist\/index\.html/);
  await p3.waitForFunction(() => window.__app && window.__app.viewer());
  assert.equal(await p3.title(), '正投影図 3Dクリエイター');
  // タブに出すマーク（アプリのマーク）が、画像として開ける
  const icons = await p3.evaluate(() => Promise.all([...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map((l) => new Promise((done) => {
    const img = new Image();
    img.onload = () => done(`${l.rel} ${img.naturalWidth > 0 ? 'ok' : 'ng'}`);
    img.onerror = () => done(`${l.rel} ng`);
    img.src = l.href;
  }))));
  assert.deepEqual(icons, ['icon ok', 'icon ok', 'apple-touch-icon ok']);
  await p3.close();
}

await browser.close();
assert.deepEqual(problems, [], 'ブラウザのエラー');
console.log(`\nすべて確認できました。スクリーンショット: ${out}`);
