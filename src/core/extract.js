// 用紙の3つのわく（正面図・平面図・右側面図）にかかれた線から、
// 図の位置と大きさをしらべ、立体の座標にそろえた「問題」をつくる。
// あわせて、図のかき方（位置がそろっているか、線がとぎれていないか）を点検する。

import { makeProblem, VIEW_NAMES, SOLID } from './model.js';

/** 図の中で線がかかれている範囲 */
export function bounds(view) {
  const { nu, nv } = view;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, count = 0;
  for (let q = 0; q < nv; q++)
    for (let c = 0; c <= nu; c++)
      if (view.V[c + q * (nu + 1)]) {
        count++;
        if (c < u0) u0 = c; if (c > u1) u1 = c;
        if (q < v0) v0 = q; if (q + 1 > v1) v1 = q + 1;
      }
  for (let c = 0; c <= nv; c++)
    for (let p = 0; p < nu; p++)
      if (view.H[p + c * nu]) {
        count++;
        if (p < u0) u0 = p; if (p + 1 > u1) u1 = p + 1;
        if (c < v0) v0 = c; if (c > v1) v1 = c;
      }
  return count ? { u0, u1, v0, v1, count } : null;
}

/** 交点 (u,v) に集まっている線分の数（solidOnly: 実線だけを数える） */
function degree(view, u, v, solidOnly) {
  const { nu, nv } = view;
  const on = (t) => (solidOnly ? t === SOLID : t !== 0);
  let d = 0;
  if (u > 0 && on(view.H[u - 1 + v * nu])) d++;
  if (u < nu && on(view.H[u + v * nu])) d++;
  if (v > 0 && on(view.V[u + (v - 1) * (nu + 1)])) d++;
  if (v < nv && on(view.V[u + v * (nu + 1)])) d++;
  return d;
}

/**
 * 線のはしが、ほかの線につながっていない交点。
 * solidOnly: 見える線（実線）だけをしらべる。かくれ線を必要な所だけかくときは、
 *            かくれ線がとちゅうで終わっていてもよいので、実線だけを見る。
 */
export function danglingNodes(view, solidOnly = false) {
  const out = [];
  for (let v = 0; v <= view.nv; v++)
    for (let u = 0; u <= view.nu; u++) if (degree(view, u, v, solidOnly) === 1) out.push([u, v]);
  return out;
}

/**
 * つながった線のまとまりごとに分ける。まとまりの「かこむ四角」が重なるものは1つにする。
 * もどり値: [{segs:[[kind,a,b],...], u0,u1,v0,v1}] 線分の多い順
 */
export function clusters(view) {
  const { nu, nv } = view;
  const nn = (nu + 1) * (nv + 1);
  const parent = new Int32Array(nn);
  for (let i = 0; i < nn; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const node = (u, v) => u + v * (nu + 1);
  const segs = [];
  for (let q = 0; q < nv; q++)
    for (let c = 0; c <= nu; c++)
      if (view.V[c + q * (nu + 1)]) { segs.push(['V', c, q]); parent[find(node(c, q))] = find(node(c, q + 1)); }
  for (let c = 0; c <= nv; c++)
    for (let p = 0; p < nu; p++)
      if (view.H[p + c * nu]) { segs.push(['H', p, c]); parent[find(node(p, c))] = find(node(p + 1, c)); }
  const groups = new Map();
  for (const s of segs) {
    const [kind, a, b] = s;
    const r = find(node(a, b));
    let g = groups.get(r);
    if (!g) { g = { segs: [], u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity }; groups.set(r, g); }
    g.segs.push(s);
    const ua = a, ub = kind === 'H' ? a + 1 : a, va = b, vb = kind === 'V' ? b + 1 : b;
    g.u0 = Math.min(g.u0, ua); g.u1 = Math.max(g.u1, ub);
    g.v0 = Math.min(g.v0, va); g.v1 = Math.max(g.v1, vb);
  }
  let list = [...groups.values()];
  // かこむ四角が重なる（ふれる）ものをまとめる
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.u0 <= b.u1 && b.u0 <= a.u1 && a.v0 <= b.v1 && b.v0 <= a.v1) {
          a.segs.push(...b.segs);
          a.u0 = Math.min(a.u0, b.u0); a.u1 = Math.max(a.u1, b.u1);
          a.v0 = Math.min(a.v0, b.v0); a.v1 = Math.max(a.v1, b.v1);
          list.splice(j, 1);
          merged = true;
          break outer;
        }
      }
  }
  return list.sort((a, b) => b.segs.length - a.segs.length);
}

/**
 * drawing: { front, top, side }（それぞれ用紙のわくの方眼。原点は左下）
 * もどり値: { issues, unit, origin, size }
 *   issues: かき方の問題（空なら unit が使える）
 *   unit:   1マス単位の問題
 *   origin: 各わくの中での図の左下の位置 { front:{u,v}, top:{u,v}, side:{u,v} }
 */
export function extractViews(drawing, opts = {}) {
  const issues = [];
  const bb = {};
  for (const name of VIEW_NAMES) bb[name] = bounds(drawing[name]);
  const empty = VIEW_NAMES.filter((n) => !bb[n]);
  if (empty.length === 3) return { issues: [{ code: 'EMPTY_ALL' }] };
  if (empty.length) return { issues: empty.map((view) => ({ code: 'EMPTY_VIEW', view })) };

  // 図からはなれた線
  for (const name of VIEW_NAMES) {
    const cl = clusters(drawing[name]);
    if (cl.length > 1) {
      issues.push({ code: 'STRAY', view: name, marks: [{ view: name, segs: cl.slice(1).flatMap((c) => c.segs) }] });
    }
  }
  if (issues.length) return { issues };

  // とぎれた線
  for (const name of VIEW_NAMES) {
    const nodes = danglingNodes(drawing[name], !!opts.solidOnly);
    if (nodes.length) issues.push({ code: 'DANGLING', view: name, marks: [{ view: name, nodes }] });
  }

  // 図の大きさと位置
  const f = bb.front, t = bb.top, s = bb.side;
  const W = f.u1 - f.u0, H = f.v1 - f.v0;
  const Wt = t.u1 - t.u0, Dt = t.v1 - t.v0;
  const Ds = s.u1 - s.u0, Hs = s.v1 - s.v0;
  if (W !== Wt) issues.push({ code: 'WIDTH_MISMATCH', front: W, top: Wt });
  else if (f.u0 !== t.u0) issues.push({ code: 'ALIGN_X', shift: t.u0 - f.u0 });
  if (H !== Hs) issues.push({ code: 'HEIGHT_MISMATCH', front: H, side: Hs });
  else if (f.v0 !== s.v0) issues.push({ code: 'ALIGN_Z', shift: s.v0 - f.v0 });
  if (Dt !== Ds) issues.push({ code: 'DEPTH_MISMATCH', top: Dt, side: Ds });
  if (issues.length) return { issues };

  const D = Dt;
  const unit = makeProblem(W, D, H);
  const crop = (src, dst, u0, v0) => {
    for (let q = 0; q < dst.nv; q++)
      for (let c = 0; c <= dst.nu; c++) dst.V[c + q * (dst.nu + 1)] = src.V[u0 + c + (v0 + q) * (src.nu + 1)];
    for (let c = 0; c <= dst.nv; c++)
      for (let p = 0; p < dst.nu; p++) dst.H[p + c * dst.nu] = src.H[u0 + p + (v0 + c) * src.nu];
  };
  crop(drawing.front, unit.front, f.u0, f.v0);
  crop(drawing.top, unit.top, t.u0, t.v0);
  crop(drawing.side, unit.side, s.u0, s.v0);
  return {
    issues,
    unit,
    origin: { front: { u: f.u0, v: f.v0 }, top: { u: t.u0, v: t.v0 }, side: { u: s.u0, v: s.v0 } },
    size: { W, D, H },
  };
}

/**
 * 図どうしの線の対応をしらべる。
 * 立体の面は、かならず2つの図に線としてあらわれる。
 *   正面図の縦線 ⇔ 平面図の縦線（左右の位置が同じ）
 *   正面図の横線 ⇔ 右側面図の横線（高さが同じ）
 *   平面図の横線 ⇔ 右側面図の縦線（奥行きの位置が同じ）
 * もどり値: [{view, other, segs:[[kind,a,b],...]}]（図の中の座標）
 */
export function unmatchedLines(Pu) {
  const out = [];
  const anyV = (view, c) => { for (let q = 0; q < view.nv; q++) if (view.V[c + q * (view.nu + 1)]) return true; return false; };
  const anyH = (view, c) => { for (let p = 0; p < view.nu; p++) if (view.H[p + c * view.nu]) return true; return false; };
  const check = (name, kind, other, has) => {
    const view = Pu[name];
    const segs = [];
    if (kind === 'V') {
      for (let c = 0; c <= view.nu; c++) {
        if (has(c)) continue;
        for (let q = 0; q < view.nv; q++) if (view.V[c + q * (view.nu + 1)]) segs.push(['V', c, q]);
      }
    } else {
      for (let c = 0; c <= view.nv; c++) {
        if (has(c)) continue;
        for (let p = 0; p < view.nu; p++) if (view.H[p + c * view.nu]) segs.push(['H', p, c]);
      }
    }
    if (segs.length) out.push({ view: name, other, kind, segs });
  };
  check('front', 'V', 'top', (c) => anyV(Pu.top, c));
  check('front', 'H', 'side', (c) => anyH(Pu.side, c));
  check('top', 'V', 'front', (c) => anyV(Pu.front, c));
  check('top', 'H', 'side', (c) => anyV(Pu.side, c));
  check('side', 'V', 'top', (c) => anyH(Pu.top, c));
  check('side', 'H', 'front', (c) => anyH(Pu.front, c));
  return out;
}

/** 図を左右うら返しにしたもの */
export function mirrorU(view) {
  const { nu, nv } = view;
  const out = { nu, nv, V: new Uint8Array(view.V.length), H: new Uint8Array(view.H.length) };
  for (let q = 0; q < nv; q++) for (let c = 0; c <= nu; c++) out.V[c + q * (nu + 1)] = view.V[nu - c + q * (nu + 1)];
  for (let c = 0; c <= nv; c++) for (let p = 0; p < nu; p++) out.H[p + c * nu] = view.H[nu - 1 - p + c * nu];
  return out;
}

/** 図を上下うら返しにしたもの */
export function mirrorV(view) {
  const { nu, nv } = view;
  const out = { nu, nv, V: new Uint8Array(view.V.length), H: new Uint8Array(view.H.length) };
  for (let q = 0; q < nv; q++) for (let c = 0; c <= nu; c++) out.V[c + q * (nu + 1)] = view.V[c + (nv - 1 - q) * (nu + 1)];
  for (let c = 0; c <= nv; c++) for (let p = 0; p < nu; p++) out.H[p + c * nu] = view.H[p + (nv - c) * nu];
  return out;
}
