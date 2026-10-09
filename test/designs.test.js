// よくある作品を、かくれ線のかき方をいろいろに変えて読ませる（かくれ線「必要なものだけ」の設定）
import test from 'node:test';
import assert from 'node:assert/strict';

import { analyze } from '../src/core/analyze.js';
import { fromBoards, samePartition, DASH } from './helpers.js';
import { DESIGNS, sizeOf } from './designs.js';

const NAMES = ['front', 'top', 'side'];
const codes = (r) => r.issues.map((i) => i.code);
/** keep にない図のかくれ線を消す */
const strip = (d, keep = []) => {
  const o = structuredClone(d);
  for (const n of NAMES) if (!keep.includes(n)) for (const k of ['V', 'H']) o[n][k] = o[n][k].map((v) => (v === DASH ? 0 : v));
  return o;
};
const read = (name, keep) => {
  const m = fromBoards(DESIGNS[name], ...sizeOf(DESIGNS[name]));
  const r = analyze(strip(m.drawing, keep), { thickness: 1 });
  return r.ok ? (samePartition(r.model.unit, m.labels) ? '○' : `ちがう形（板${r.model.parts.length}枚）`) : codes(r).join('+');
};

test('よくある作品: かくれ線を全部かけば、どれも元のとおりの立体になる', () => {
  for (const name of Object.keys(DESIGNS)) assert.equal(read(name, NAMES), '○', name);
});

test('よくある作品: かくれ線を右側面図にだけかいても、どれも元のとおりの立体になる', () => {
  for (const name of Object.keys(DESIGNS)) assert.equal(read(name, ['side']), '○', name);
});

test('よくある作品: かくれ線がまったくないとき、決まるものは立体にし、決まらないものはたずねる', () => {
  const got = Object.fromEntries(Object.keys(DESIGNS).map((name) => [name, read(name, [])]));
  assert.deepEqual(got, {
    // 見えない所に、決まらないつなぎ目がある
    '本立て': 'HIDDEN_JOINT',
    '背板が低い本立て': 'HIDDEN_JOINT',
    '底板が奥に引っこんだ本立て': 'HIDDEN_JOINT',
    'たな板のある本立て': 'HIDDEN_JOINT',
    '引っこんだたな板のある本立て': 'HIDDEN_JOINT',
    '前板の低い小物入れ': 'HIDDEN_JOINT',
    '仕切りのある小物入れ': 'HIDDEN_JOINT',
    'たての仕切りのある本立て': 'HIDDEN_JOINT',
    'たな板2枚と仕切り': 'HIDDEN_JOINT',
    'ペン立て（かべの高さがちがう）': 'HIDDEN_JOINT',
    // 板の厚さが、どの図にも表れていない（幕板）
    'いす（天板・あし2枚・幕板2枚）': 'NOT_BOARD_THICK',
    'いす（あしが内がわ・幕板1枚）': 'NOT_BOARD_THICK',
    // 見える線だけで決まる
    '天板のある箱形のたな（背板なし）': '○',
    'ふたのない箱': '○',
    'L字（底板と背板）': '○',
    'ブックエンド（底板と立て板）': '○',
    'つくえ（天板とあし2枚）': '○',
    // かいていない板は、ないものとして読む（背板は、天板と側板にかくれて、どの図にも線がない）
    '天板のある箱形のたな（背板あり）': 'ちがう形（板4枚）',
  });
});

/**
 * アプリの言うとおりに、かくれ線をかきたしていく生徒のまね。
 * かくれ線なしから始めて、「考えられるかくれ線」のうち自分の作品に合うものをかきたす。
 * whole: その線分をふくむ破線を、1本まるごとかく
 */
function follow(name, whole) {
  const m = fromBoards(DESIGNS[name], ...sizeOf(DESIGNS[name]));
  const truth = m.drawing, d = strip(truth);
  const at = (view, [kind, a, c]) => (kind === 'V' ? a + c * (view.nu + 1) : a + c * view.nu);
  const trace = [];
  for (let round = 0; round < 6; round++) {
    const r = analyze(d, { thickness: 1 });
    if (r.ok) return { end: samePartition(r.model.unit, m.labels) ? '○' : 'ちがう形', trace };
    trace.push(codes(r).join('+'));
    let drew = 0;
    for (const issue of r.issues) for (const mk of issue.marks || []) for (const g of mk.ghost || []) {
      const v = truth[mk.view], dv = d[mk.view], i = at(v, g), arr = v[g[0]];
      if (arr[i] !== DASH || dv[g[0]][i]) continue;
      dv[g[0]][i] = DASH; drew++;
      if (!whole) continue;
      const step = g[0] === 'V' ? v.nu + 1 : 1;
      for (const s of [-step, step]) for (let j = i + s; j >= 0 && j < arr.length && arr[j] === DASH && (g[0] === 'V' || Math.floor(j / v.nu) === Math.floor(i / v.nu)); j += s) dv[g[0]][j] = DASH;
    }
    if (!drew) return { end: 'かける線がない', trace };
  }
  return { end: '終わらない', trace };
}

test('アプリがしめした「考えられるかくれ線」から、自分の作品に合うものをかきたすと、1回で元のとおりの立体になる', () => {
  const asked = Object.keys(DESIGNS).filter((name) => read(name, []) === 'HIDDEN_JOINT');
  assert.equal(asked.length, 10);
  for (const whole of [false, true])
    for (const name of asked) {
      const f = follow(name, whole);
      // たな板2枚と仕切り: 下のたな板は前が1マス引っこんでいるが、上のたな板にかくれて、どの図にも線がない。
      // 生徒がその線をかかないかぎり、前までとどいた形として読む（それ以外は元のとおり）
      assert.equal(f.end, name === 'たな板2枚と仕切り' ? 'ちがう形' : '○', `${name} ${JSON.stringify(f.trace)}`);
      assert.deepEqual(f.trace, ['HIDDEN_JOINT'], name);
    }
});

test('よくある作品は、どのかき方でも、すぐに答えが出る', () => {
  for (const name of Object.keys(DESIGNS))
    for (const keep of [[], ['side'], ['top'], ['front'], ['side', 'top']]) {
      const t0 = Date.now();
      read(name, keep);
      assert.ok(Date.now() - t0 < 1500, `${name} ${keep.join()}: ${Date.now() - t0}ms`);
    }
});
