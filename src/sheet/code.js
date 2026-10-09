// 用紙の左上にある「設定コード」（白黒のます目の列）
//
// 用紙の種類・1マスの大きさ・板の厚さ（mm と、かくときのマス数）・板厚チェックの有無・
// かくれ線のかき方（必要なものだけ／全部）を入れておき、
// 写真を読みこんだときに、紙の向きと設定を自動で知るために使う。
//
// 位置は、上の2つのマークを結ぶ線の上。左のマークから右のマークまでを 0〜1 として
// CODE_S0 から CODE_DS ずつ、CODE_CELLS 個ならぶ（用紙の種類によらず同じ割合）。
//
// ならび: 始まりの目印4 ＋ 設定14 ＋ たしかめ6 ＋ 終わりの目印4 ＝ 28
// （前の形式「設定13 ＋ たしかめ7」の用紙も、目印のちがいで見分けて読める。
//   前の形式には、かくれ線のかき方が入っていないので hiddenLines は null になる）

import { SCALES, BOARD_MM } from './templates.js';

export const CODE_CELLS = 28;
export const CODE_S0 = 0.05;
export const CODE_DS = 0.0125;
export const CODE_HEIGHT = 4; // mm

const HEAD = [1, 0, 0, 1], TAIL = [1, 0, 1, 1];
const OLD_HEAD = [1, 0, 1, 1], OLD_TAIL = [1, 1, 0, 1]; // かくれ線の設定がない、前の形式

/**
 * たしかめの数（CRC-6、生成多項式 x^6+x^4+x^3+1）。
 * 設定14けた＋たしかめ6けたのうち、3か所までの読みまちがいは、かならず見つかる。
 */
function crc6(d) {
  let r = d << 6;
  for (let i = 19; i >= 6; i--) if (r & (1 << i)) r ^= 0x59 << (i - 6);
  return (r & 63) ^ 0x2b;
}

/** 前の形式のたしかめの数 */
function oldCheck(d) {
  return ((d * 73) ^ (d >>> 5) ^ 0x2b) & 127;
}

/** settings: { template(0-7), scaleMm, boardMm, thickness(1-4), boardCheck, hiddenLines } → 28個の 0/1 */
export function encodeCode(settings) {
  let si = SCALES.indexOf(settings.scaleMm);
  if (si < 0) si = SCALES.indexOf(10);
  let bi = BOARD_MM.indexOf(settings.boardMm);
  if (bi < 0) bi = BOARD_MM.indexOf(12);
  const th = Math.min(4, Math.max(1, settings.thickness | 0)) - 1;
  const base = ((settings.template & 7) << 10) | (si << 6) | (th << 4) | ((settings.boardCheck === false ? 0 : 1) << 3) | bi;
  const d = (base << 1) | (settings.hiddenLines === 'all' ? 1 : 0);
  const bits = [...HEAD];
  for (let i = 13; i >= 0; i--) bits.push((d >> i) & 1);
  const c = crc6(d);
  for (let i = 5; i >= 0; i--) bits.push((c >> i) & 1);
  bits.push(...TAIL);
  return bits;
}

/** 28個の 0/1 → settings。読めなければ null。前の形式の用紙では hiddenLines が null（用紙からは分からない） */
export function decodeCode(bits) {
  if (!bits || bits.length !== CODE_CELLS) return null;
  const ends = (h, t) => h.every((v, i) => bits[i] === v) && t.every((v, i) => bits[CODE_CELLS - 4 + i] === v);
  const read = (from, count) => { let v = 0; for (let i = 0; i < count; i++) v = (v << 1) | bits[from + i]; return v; };
  let base, hiddenLines = null;
  if (ends(HEAD, TAIL)) {
    const d = read(4, 14);
    if (crc6(d) !== read(18, 6)) return null;
    base = d >> 1;
    hiddenLines = d & 1 ? 'all' : 'needed';
  } else if (ends(OLD_HEAD, OLD_TAIL)) {
    base = read(4, 13);
    if (oldCheck(base) !== read(17, 7)) return null;
  } else return null;
  return {
    template: (base >> 10) & 7,
    scaleMm: SCALES[(base >> 6) & 15],
    thickness: ((base >> 4) & 3) + 1,
    boardCheck: ((base >> 3) & 1) === 1,
    boardMm: BOARD_MM[base & 7],
    hiddenLines,
  };
}

/** 前の形式のコードをつくる（テスト用: 古い用紙が読めることのたしかめ） */
export function encodeOldCode(settings) {
  const si = SCALES.indexOf(settings.scaleMm), bi = BOARD_MM.indexOf(settings.boardMm);
  const d = ((settings.template & 7) << 10) | (si << 6) | ((settings.thickness - 1) << 4) | ((settings.boardCheck === false ? 0 : 1) << 3) | bi;
  const bits = [...OLD_HEAD];
  for (let i = 12; i >= 0; i--) bits.push((d >> i) & 1);
  const c = oldCheck(d);
  for (let i = 6; i >= 0; i--) bits.push((c >> i) & 1);
  bits.push(...OLD_TAIL);
  return bits;
}
