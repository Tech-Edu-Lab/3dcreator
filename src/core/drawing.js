// 用紙の上の図面（3つのわく）をあつかう道具

import { makeView, cloneView, VIEW_NAMES } from './model.js';

/** わくの大きさ sizes = { front:{cols,rows}, top:{cols,rows}, side:{cols,rows} } の白紙 */
export function emptyDrawing(sizes) {
  return {
    front: makeView(sizes.front.cols, sizes.front.rows),
    top: makeView(sizes.top.cols, sizes.top.rows),
    side: makeView(sizes.side.cols, sizes.side.rows),
  };
}

export function cloneDrawing(d) {
  return { front: cloneView(d.front), top: cloneView(d.top), side: cloneView(d.side) };
}

/** src の図を dst の (u0,v0) にうつす。はみ出したら false */
export function pasteView(dst, src, u0, v0) {
  if (u0 < 0 || v0 < 0 || u0 + src.nu > dst.nu || v0 + src.nv > dst.nv) return false;
  for (let q = 0; q < src.nv; q++)
    for (let c = 0; c <= src.nu; c++) {
      const t = src.V[c + q * (src.nu + 1)];
      if (t) dst.V[u0 + c + (v0 + q) * (dst.nu + 1)] = t;
    }
  for (let c = 0; c <= src.nv; c++)
    for (let p = 0; p < src.nu; p++) {
      const t = src.H[p + c * src.nu];
      if (t) dst.H[u0 + p + (v0 + c) * dst.nu] = t;
    }
  return true;
}

/**
 * 立体の座標にそろった3つの図（問題）を、用紙のわくに第三角法の位置でならべる。
 * margin: わくの左下からのあき（マス）。入らなければ null
 */
export function drawingFromProblem(P, sizes, margin = { u: 2, v: 2 }) {
  const d = emptyDrawing(sizes);
  const ok =
    pasteView(d.front, P.front, margin.u, margin.v) &&
    pasteView(d.top, P.top, margin.u, margin.v) &&
    pasteView(d.side, P.side, margin.u, margin.v);
  return ok ? d : null;
}

export function drawingIsEmpty(d) {
  return VIEW_NAMES.every((n) => d[n].V.every((x) => !x) && d[n].H.every((x) => !x));
}

/** 保存用の文字列にする／もどす */
export function serializeDrawing(d) {
  const enc = (a) => Array.from(a).join('');
  return JSON.stringify(Object.fromEntries(VIEW_NAMES.map((n) => [n, { nu: d[n].nu, nv: d[n].nv, V: enc(d[n].V), H: enc(d[n].H) }])));
}

export function deserializeDrawing(text) {
  const o = JSON.parse(text);
  const out = {};
  for (const n of VIEW_NAMES) {
    const s = o[n];
    const v = makeView(s.nu, s.nv);
    if (s.V.length !== v.V.length || s.H.length !== v.H.length) throw new Error('bad drawing');
    for (let i = 0; i < v.V.length; i++) v.V[i] = +s.V[i] || 0;
    for (let i = 0; i < v.H.length; i++) v.H[i] = +s.H[i] || 0;
    out[n] = v;
  }
  return out;
}
