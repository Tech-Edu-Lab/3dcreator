// かくれ線が全部はかかれていない図面から、板の組み合わせをさがす（「必要なかくれ線だけ」の読み方）。
//
// 考え方:
//  1. 見える線（実線）だけから、正面・上・右に見えている面の位置（深さ）の決め方を、すべてならべる。
//     実線でかこまれた1つの領域は、1枚の板の、同じ深さの面である（または、何もない所）。
//  2. 決め方ごとに、見えている面を、重ならない長方形の板でちょうどおおう方法をならべる。
//     板は、見えない所では、ほかの板に当たるまで続いているものと考える。
//     どの板も、厚さがどこかの図に表れていなければならない
//     （板を横から見た面が見えている。または、その板のふちにかくれ線がかいてある）。
//  3. いちばん自然なものをえらぶ:
//       細長い領域（はばが板厚の長方形）を「板を横から見た面」と読めている
//       → 板の数が少ない → 材料のある所が、いちばん大きく続いている。
//     同じくらい自然なものがいくつも残るとき（例: 底板と背板のつなぎ目）は、図面からは決まらない。
//     そのときは立体を出さず、かくれ線でかくようにうながす。
//  4. かいてあるかくれ線は、かならず立体の見えない辺になっていなければならない。
//     のばせるだけのばした板では合わないときは、とちゅうで止まる板や、
//     まるごと見えない板（いすの後ろがわの幕板など）で説明できないかをためす。
//  5. 長方形の板だけでは図面と合わないとき（切り欠きのある板）は、
//     見えないマスを1つずつ板へふり分ける方法でさがす（数が多いと打ち切る）。
//
// できた立体から図をかき直し、実線がまったく同じになるものだけを答えにする。
// しらべる数には上限がある。打ち切ったときは complex を返し、呼び出し側は立体を出さない。

import { SOLID, DASH, NONE } from './model.js';
import { prepare, solveStrict, ST_E, ST_S, ST_U } from './solver.js';
import { renderViews } from './render.js';

/**
 * 図面 P と、立体からかき直した図 R をくらべる。
 *   visible:    実線のくいちがいの数（0 でなければ、その立体は図面と合わない）
 *   unexplained: かいてあるかくれ線のうち、立体の見えない辺になっていないもの
 *   supplement:  図面にはないが、立体にはある見えない辺（アプリがおぎなうかくれ線）
 */
export function compareLenient(P, R) {
  let visible = 0;
  const unexplained = [], supplement = [];
  for (const name of ['front', 'top', 'side'])
    for (const kind of ['V', 'H']) {
      const A = P[name][kind], B = R[name][kind];
      for (let i = 0; i < A.length; i++) {
        const d = A[i], r = B[i];
        if ((d === SOLID) !== (r === SOLID)) visible++;
        else if (d === DASH && r !== DASH) unexplained.push({ view: name, kind, index: i });
        else if (d === NONE && r === DASH) supplement.push({ view: name, kind, index: i });
      }
    }
  return { visible, unexplained, supplement };
}

/**
 * P: まとめた方眼の問題, breaks: { bx, by, bz }, T: 板の厚さ（マス）
 * opts.boards: 板だけでできた立体をさがす（板厚チェックあり）。false なら、1つのかたまりとしてうめる。
 * opts.budget / maxLeaves: しらべる数の上限。opts.deadline: 時間切れの時刻（ヒントをさがすときだけ使う）
 * もどり値の complex: しらべきれずに打ち切った（答えがあっても、ほかの答えがあるかもしれない）
 * もどり値: { status, models, ... }
 *   'ok'          models[0] が答え
 *   'ambiguous'   models が同じくらい自然な答えのならび（かくれ線がないと決まらない）
 *   'nonboard'    見えている面のうしろが板にならない（patches: 板にならないかたまり）
 *   'unexplained' かいてあるかくれ線が立体と合わない（model, bad）
 *   'thickness'   板にはなるが、厚さがどの図にも表れていない板がある（model, bad: [{ id, axis }]）
 *   'none'        実線だけで考えても、合う立体がない
 */
export function solveLenient(P, breaks, T, opts = {}) {
  const boardMode = opts.boards !== false;
  const { nx, ny, nz } = P;
  const n = nx * ny * nz, dims = [nx, ny, nz];
  const B = [breaks.bx, breaks.by, breaks.bz];
  const size = (a, i) => B[a][i + 1] - B[a][i];
  const coord = (c) => [c % nx, Math.floor(c / nx) % ny, Math.floor(c / (nx * ny))];
  const cid = (v) => v[0] + nx * (v[1] + ny * v[2]);
  const vol = new Float64Array(n);
  for (let c = 0; c < n; c++) { const v = coord(c); vol[c] = size(0, v[0]) * size(1, v[1]) * size(2, v[2]); }

  // 板がおさまる「層」: ある方向に、ちょうど板厚 T マスぶんの区間
  const slabs = [];
  const slabsAt = dims.map((d) => Array.from({ length: d }, () => []));
  for (let a = 0; a < 3; a++)
    for (let i0 = 0; i0 < dims[a]; i0++) {
      let sum = 0;
      for (let i1 = i0; i1 < dims[a]; i1++) {
        sum += size(a, i1);
        if (sum === T) { const id = slabs.length; slabs.push({ a, i0, i1: i1 + 1 }); for (let i = i0; i <= i1; i++) slabsAt[a][i].push(id); break; }
        if (sum > T) break;
      }
    }
  const cellSlabs = new Array(n);
  for (let c = 0; c < n; c++) { const v = coord(c); cellSlabs[c] = [...slabsAt[0][v[0]], ...slabsAt[1][v[1]], ...slabsAt[2][v[2]]]; }
  const inSlab = (s, c) => { const sl = slabs[s], i = coord(c)[sl.a]; return i >= sl.i0 && i < sl.i1; };
  // 同じ層の中で、厚さの方向にならんだマス（板なら、これらはいっしょに材料になる）
  const mates = (s, c) => {
    const sl = slabs[s];
    if (sl.i1 - sl.i0 === 1) return [c];
    const v = coord(c), out = [];
    for (let i = sl.i0; i < sl.i1; i++) { v[sl.a] = i; out.push(cid(v)); }
    return out;
  };
  const nbr = new Array(n);
  for (let c = 0; c < n; c++) {
    const v = coord(c), list = [];
    for (let a = 0; a < 3; a++) {
      if (v[a] > 0) { v[a]--; list.push(cid(v)); v[a]++; }
      if (v[a] < dims[a] - 1) { v[a]++; list.push(cid(v)); v[a]--; }
    }
    nbr[c] = list;
  }
  const neighbors = (c) => nbr[c];
  // マスごとの、もとの方眼での範囲（lo0,lo1,lo2,hi0,hi1,hi2）
  const range = new Int32Array(n * 6);
  for (let c = 0; c < n; c++) { const v = coord(c); for (let a = 0; a < 3; a++) { range[c * 6 + a] = B[a][v[a]]; range[c * 6 + 3 + a] = B[a][v[a] + 1]; } }

  const pre = prepare(P, { cells: true });
  if (pre.hopeless) return { status: 'none', models: [] };

  // 実線でへだてられた、となり合う視線の組（図ごと）
  const solidPairs = pre.views.map((vw) => {
    const { nu, nv, view } = vw, out = [];
    for (let q = 0; q < nv; q++) for (let c = 1; c < nu; c++) if (view.V[c + q * (nu + 1)] === SOLID) out.push(c - 1 + q * nu, c + q * nu);
    for (let c = 1; c < nv; c++) for (let p = 0; p < nu; p++) if (view.H[p + c * nu] === SOLID) out.push(p + (c - 1) * nu, p + c * nu);
    return out;
  });

  // ---- 見えている面の決め方をならべる（切り欠きのある板をさがすとき・板厚チェックなしのとき用）----
  const surfaces = (forbidThick) => {
    const leaves = [];
    let forbid = null;
    if (forbidThick) {
      forbid = new Uint8Array(n + 1);
      for (let c = 0; c < n; c++) if (pre.blobOf[c] && !cellSlabs[c].length) forbid[c + 1] = 1; // どの方向にも板厚より厚いマスは、板になれない
    }
    solveStrict(P, pre, {
      forbidSolid: forbid, maxNodes: 40000,
      onLeaf: (state) => {
        // マスごとの状態にそろえる（図の外がわのマスは、かならず空間）
        const s = state.slice();
        for (let c = 0; c < n; c++) if (!pre.blobOf[c]) s[c + 1] = ST_E;
        leaves.push(s);
        if (leaves.length >= 200) { leaves.capped = true; return false; }
        return true;
      },
    });
    return leaves;
  };

  // 自然な順: 長方形でない板が少ない → 板の数が少ない → 見えないすき間が少ない。
  // ここまで同じもののうち、材料のある所が、ほかの形をまるごとふくんでいるもの（板がいちばん大きく続いている形）をえらぶ。
  // それでも1つに決まらなければ、図面からは決まらない（かくれ線でかいてもらう）。
  const order = (a, b) => a.nonRect - b.nonRect || a.boards - b.boards || a.gaps - b.gaps;
  /** a の材料のある所が b をふくむか: 1 = a が b をふくむ（同じもふくむ）, -1 = b が a をふくむ, 0 = どちらでもない */
  const contains = (a, b) => {
    let aMore = false, bMore = false;
    for (let c = 0; c < n; c++) {
      if (a[c] && !b[c]) aMore = true; else if (!a[c] && b[c]) bMore = true;
      if (aMore && bMore) return 0;
    }
    return bMore ? -1 : 1;
  };
  const BUDGET = opts.budget || 6000; // ためす組み合わせの上限
  const BUILDS = BUDGET * 5; // 板にまとめてみる回数の上限
  const late = () => !!opts.deadline && Date.now() > opts.deadline; // 時間切れ（ヒントをさがすときだけ使う）

  // ---- 見えている面から板をつくる（切り欠きのある板もゆるす、マスごとのふり分け）----
  const find = (uf, x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };

  /** 見えている面ごとのまとまり（同じ領域で、同じ深さに見えているマスは同じ板） */
  function patchesOf(state) {
    const uf = new Int32Array(n);
    for (let i = 0; i < n; i++) uf[i] = i;
    const seps = [];
    pre.views.forEach((vw, v) => {
      const { nd, colBlobs, ncol, adj, depth } = vw;
      for (let col = 0; col < ncol; col++) {
        let t = 0;
        while (t < nd && state[colBlobs[col * nd + t]] !== ST_S) t++;
        depth[col] = t;
      }
      for (let e = 0; e < adj.length; e += 2) {
        const a = adj[e], b = adj[e + 1], t = depth[a];
        if (t < nd && t === depth[b]) uf[find(uf, colBlobs[a * nd + t] - 1)] = find(uf, colBlobs[b * nd + t] - 1);
      }
      const sp = solidPairs[v];
      for (let e = 0; e < sp.length; e += 2) {
        const a = sp[e], b = sp[e + 1], t = depth[a];
        if (t < nd && t === depth[b]) seps.push(colBlobs[a * nd + t] - 1, colBlobs[b * nd + t] - 1);
      }
    });
    const groups = new Map();
    for (let c = 0; c < n; c++) {
      if (state[c + 1] !== ST_S) continue;
      const r = find(uf, c);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(c);
    }
    return { patches: [...groups.values()], seps };
  }

  /** owner（マスごとの層の番号。-1 は空間）から、板の番号をふる。板として成り立たなければ null */
  function build(state, owner, seps) {
    for (let c = 0; c < n; c++) {
      if (owner[c] < 0) continue;
      for (const m of mates(owner[c], c)) if (owner[m] !== owner[c]) return null; // 厚さの方向にそろっていない
    }
    const cut = new Set();
    for (let e = 0; e < seps.length; e += 2) cut.add(seps[e] < seps[e + 1] ? `${seps[e]},${seps[e + 1]}` : `${seps[e + 1]},${seps[e]}`);
    const labels = new Int32Array(n);
    const info = []; // 板ごとの { slab, lo, hi }
    let boards = 0, nonRect = 0, volume = 0;
    for (let c0 = 0; c0 < n; c0++) {
      if (owner[c0] < 0 || labels[c0]) continue;
      const id = ++boards, s = owner[c0], queue = [c0], cells = [];
      labels[c0] = id;
      let seen = false;
      while (queue.length) {
        const c = queue.pop();
        cells.push(c);
        if (state[c + 1] === ST_S) seen = true;
        for (const m of neighbors(c)) {
          if (owner[m] !== s || labels[m]) continue;
          if (cut.size && cut.has(c < m ? `${c},${m}` : `${m},${c}`)) continue; // 見えるつなぎ目
          labels[m] = id;
          queue.push(m);
        }
      }
      if (!seen) { for (const c of cells) labels[c] = -1; boards--; continue; } // まるごと見えない板はつくらない
      const lo = [Infinity, Infinity, Infinity], hi = [-1, -1, -1];
      let v = 0;
      for (const c of cells) {
        for (let a = 0; a < 3; a++) { if (range[c * 6 + a] < lo[a]) lo[a] = range[c * 6 + a]; if (range[c * 6 + 3 + a] > hi[a]) hi[a] = range[c * 6 + 3 + a]; }
        v += vol[c];
      }
      volume += v;
      if (v !== (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2])) nonRect++;
      info.push({ slab: s, lo, hi });
    }
    for (let c = 0; c < n; c++) if (labels[c] < 0) labels[c] = 0;
    for (let e = 0; e < seps.length; e += 2) if (labels[seps[e]] === labels[seps[e + 1]]) return null; // 実線のある所が同じ板になった
    return { labels, boards, nonRect, volume, info };
  }

  /** 1つの「見えている面の決め方」（state）について、板の組み合わせをならべる */
  function complete(state, out) {
    const { patches, seps } = patchesOf(state);
    for (let e = 0; e < seps.length; e += 2) if (seps[e] === seps[e + 1]) return;
    // 見えている面ごとに、とりうる板の向き
    const options = [];
    let bad = 0;
    for (const cells of patches) {
      let common = cellSlabs[cells[0]];
      for (const c of cells) common = common.filter((s) => cellSlabs[c].includes(s));
      options.push(common);
      if (!common.length) bad++;
    }
    if (bad) {
      // 板にならないかたまりがある: 点検用に、かたまりの分け方をおぼえておく
      if (!out.nonboard || bad < out.nonboard.bad) {
        const labels = new Int32Array(n);
        patches.forEach((cells, p) => { for (const c of cells) labels[c] = p + 1; });
        out.nonboard = { bad, labels };
      }
      return;
    }
    const pick = new Array(patches.length).fill(0);
    let combos = 1;
    for (const o of options) combos *= o.length;
    if (combos > 64) { out.complex = true; return; }
    for (let combo = 0; combo < combos; combo++) {
      if (out.work > BUDGET || out.builds > BUILDS || late()) { out.complex = true; return; }
      let rest = combo;
      for (let p = 0; p < patches.length; p++) { pick[p] = options[p][rest % options[p].length]; rest = Math.floor(rest / options[p].length); }
      assign(state, patches, pick, seps, out);
    }
  }

  function assign(state, patches, pick, seps, out) {
    const owner = new Int32Array(n).fill(-1);
    patches.forEach((cells, p) => { for (const c of cells) owner[c] = pick[p]; });
    // 厚さの方向にならんだマスは、同じ板になる
    for (let c = 0; c < n; c++) {
      if (state[c + 1] !== ST_S) continue;
      const s = owner[c];
      for (const m of mates(s, c)) {
        if (state[m + 1] === ST_E) return;
        if (owner[m] >= 0 && owner[m] !== s) return;
        owner[m] = s;
      }
    }
    // 見えないマスへ、となりの板をのばす。claim[c] = そのマスまでのびてこられる層
    const claim = new Array(n).fill(null);
    for (let s = 0; s < slabs.length; s++) {
      const queue = [];
      for (let c = 0; c < n; c++) if (owner[c] === s) queue.push(c);
      if (!queue.length) continue;
      const seen = new Uint8Array(n);
      while (queue.length) {
        const c = queue.pop();
        for (const m of neighbors(c)) {
          if (seen[m] || owner[m] >= 0 || state[m + 1] !== ST_U || !inSlab(s, m)) continue;
          if (!mates(s, m).every((x) => owner[x] === s || (owner[x] < 0 && state[x + 1] === ST_U))) continue;
          seen[m] = 1;
          (claim[m] || (claim[m] = [])).push(s);
          queue.push(m);
        }
      }
    }
    // とり合いになるマスを、まとまりごとに分ける
    const groups = [];
    const mark = new Int32Array(n).fill(-1);
    for (let c0 = 0; c0 < n; c0++) {
      if (!claim[c0] || mark[c0] >= 0) continue;
      const sig = claim[c0].join(','), cells = [], queue = [c0];
      mark[c0] = groups.length;
      while (queue.length) {
        const c = queue.pop();
        cells.push(c);
        for (const m of neighbors(c)) if (claim[m] && mark[m] < 0 && claim[m].join(',') === sig) { mark[m] = groups.length; queue.push(m); }
      }
      // のばしてくる板のどれかにふくめるか、すき間のままにするか（-1）
      groups.push({ cells, choices: [...claim[c0], -1] });
    }
    const claimable = groups.reduce((sum, g) => sum + g.cells.reduce((t, c) => t + vol[c], 0), 0);
    // まず、見えないマスはどれかの板にふくめる（すき間なし）としてためす。
    // 合う形がないとき・長方形でない板ができるときだけ、すき間のままにする選び方もためす。
    const tryAll = (withEmpty, limit) => {
      let combos = 1;
      for (const g of groups) { combos *= g.choices.length - (withEmpty ? 0 : 1); if (combos > limit) { out.complex = true; combos = limit; break; } }
      let found = false, rect = false, retry = false;
      for (let combo = 0; combo < combos; combo++) {
        if (out.work > BUDGET || ++out.builds > BUILDS) { out.complex = true; break; }
        const own = owner.slice();
        let rest = combo, empties = 0;
        for (const g of groups) {
          const k = g.choices.length - (withEmpty ? 0 : 1);
          const s = g.choices[rest % k];
          rest = Math.floor(rest / k);
          if (s >= 0) for (const c of g.cells) own[c] = s; else empties++;
        }
        if (withEmpty && !empties) continue; // すき間なしの組み合わせは、もうためした
        const built = build(state, own, seps);
        if (!built) { retry = true; continue; }
        // 板のりんかくの内がわに、見えないすき間をのこした形（見えない切り欠き）はとらない。
        // そういう形は、かくれ線を全部かいた図面でだけ表せる。
        let carved = false;
        for (let c = 0; c < n && !carved; c++) {
          if (!claim[c] || built.labels[c]) continue;
          const r = c * 6;
          for (const b of built.info) {
            if (!claim[c].includes(b.slab)) continue;
            if (range[r] >= b.lo[0] && range[r + 3] <= b.hi[0] && range[r + 1] >= b.lo[1] && range[r + 4] <= b.hi[1] && range[r + 2] >= b.lo[2] && range[r + 5] <= b.hi[2]) { carved = true; break; }
          }
        }
        if (carved) continue;
        let hiddenSolid = 0;
        for (let c = 0; c < n; c++) if (built.labels[c] && state[c + 1] === ST_U) hiddenSolid += vol[c];
        const res = record(built, claimable - hiddenSolid, out);
        if (res > 0) { found = true; if (!built.nonRect) rect = true; } else if (res < 0) retry = true;
      }
      return { found, rect, retry };
    };
    // すき間もためすのは、すき間なしでは「かくれ線と合わない」「実線のある所がつながってしまう」
    // 「長方形でない板ができる」とき。実線が合わないだけなら、見えないマスをどうしても変わらない。
    const first = tryAll(false, 256);
    if (first.found ? !first.rect : first.retry) tryAll(true, 512);
  }

  /** できた形を図面とくらべて記録する。もどり値: 1 = 図面と合う（または調べずみ）, 0 = 実線が合わない, -1 = かくれ線が合わない */
  function record(built, gaps, out) {
    out.work++;
    const cand = { boards: built.boards, nonRect: built.nonRect, gaps, volume: built.volume };
    // いま持っている答えより不自然なものは、くわしく調べない
    if (out.models.length) {
      const o = order(cand, out.models[0]);
      if (o > 0) return 1;
      // 同じくらい自然で、すでにある答えにまるごとふくまれる形も、調べなくてよい
      if (o === 0) for (const m of out.models) if (m.volume > built.volume && contains(m.labels, built.labels) === 1) return 1;
    }
    // 番号のつけ方によらない形にして、同じ立体を2回数えない
    const map = new Map();
    let h1 = 17, h2 = 71;
    for (let c = 0; c < n; c++) {
      let l = built.labels[c];
      if (l) { if (!map.has(l)) map.set(l, map.size + 1); l = map.get(l); }
      h1 = (Math.imul(h1, 31) + l) >>> 0;
      h2 = (Math.imul(h2, 131) + l + 7) >>> 0;
    }
    const key = `${h1}:${h2}`;
    if (out.seen.has(key)) return out.seen.get(key);
    const rendered = renderViews(built.labels, nx, ny, nz);
    const cmp = compareLenient(P, rendered);
    out.seen.set(key, cmp.visible ? 0 : cmp.unexplained.length ? -1 : 1);
    if (cmp.visible) return 0;
    const model = { labels: built.labels, rendered, supplement: cmp.supplement, axes: built.info ? built.info.map((b) => slabs[b.slab].a) : null, ...cand };
    if (cmp.unexplained.length) {
      if (!out.models.length && (!out.unexplained || cmp.unexplained.length < out.unexplained.bad.length)) out.unexplained = { model, bad: cmp.unexplained };
      return -1;
    }
    keep(model, out);
    return 1;
  }

  /** 図面と合う形を、答えの候補にくわえる（いまある答えより自然なら入れかえる） */
  function keep(model, out) {
    if (!out.models.length || order(model, out.models[0]) < 0) { out.models = [model]; return; }
    // 同じくらい自然なもの: 材料のある所が大きいほうをのこす（分け方だけがちがうものは両方のこす）
    let dominated = false;
    out.models = out.models.filter((m) => {
      const rel = contains(model.labels, m.labels);
      if (rel === -1) dominated = true;
      if (rel === 1 && m.volume < model.volume) return false; // m は model にふくまれる
      return true;
    });
    if (!dominated && out.models.length < 12) out.models.push(model);
  }

  // ---- まるごと見えない板 ----
  const VIEW_AXES = { front: [0, 2], top: [0, 1], side: [1, 2] }; // 図のよこ・たてが、立体のどの向きか
  /** 図の線分 → 立体での位置。axis: 線がのっている面の向き, coord: その面の位置, along: 線の走る向き, pos: その向きでの位置 */
  const segPlace = (g) => {
    const [ua, va] = VIEW_AXES[g.view], nu = P[g.view].nu;
    return g.kind === 'V'
      ? { axis: ua, coord: g.index % (nu + 1), along: va, pos: Math.floor(g.index / (nu + 1)) }
      : { axis: va, coord: Math.floor(g.index / nu), along: ua, pos: g.index % nu };
  };

  /**
   * かいてあるかくれ線のうち、見えている板では説明できないものを、「まるごと見えない板」で説明できないかためす
   *（例: いすの後ろがわの幕板。前の幕板・天板・あしにかくれて、どの向きからも見えない）。
   * 見えない板は、どの図からも見えない空間に、板の形（層の中の直方体）でおく。
   * 板のはしは、ほかの物に当たるまでのびているか、かくれ線のある位置で止まっているものだけを考える。
   * もどり値: { labels, rendered, cmp, count: くわえた板の数, volume } または null
   */
  function addHidden(state, built, cmp0) {
    const free = new Uint8Array(n);
    let any = false;
    for (let c = 0; c < n; c++) if (state[c + 1] === ST_U && !built.labels[c]) { free[c] = 1; any = true; }
    if (!any) return null;
    const planes = [new Set(), new Set(), new Set()];
    for (const g of cmp0.unexplained) { const sp = segPlace(g); planes[sp.axis].add(sp.coord); }
    const cands = [];
    const v = [0, 0, 0];
    for (const { a, i0, i1 } of slabs) {
      const [b, c] = [0, 1, 2].filter((x) => x !== a);
      const nb = dims[b], nc = dims[c];
      // 層をつらぬく柱ごとに、空いているか
      const ok = new Uint8Array(nb * nc);
      let count = 0;
      for (let ib = 0; ib < nb; ib++)
        for (let ic = 0; ic < nc; ic++) {
          v[b] = ib; v[c] = ic;
          let f = 1;
          for (let ia = i0; ia < i1 && f; ia++) { v[a] = ia; if (!free[cid(v)]) f = 0; }
          ok[ib + ic * nb] = f;
          count += f;
        }
      if (!count) continue;
      // その列・行が、はしからはしまで空いているか（空いていれば、板はまだのばせる）
      const rowFree = (ib, c0, c1) => { if (ib < 0 || ib >= nb) return false; for (let ic = c0; ic < c1; ic++) if (!ok[ib + ic * nb]) return false; return true; };
      const colFree = (ic, b0, b1) => { if (ic < 0 || ic >= nc) return false; for (let ib = b0; ib < b1; ib++) if (!ok[ib + ic * nb]) return false; return true; };
      for (let b0 = 0; b0 < nb; b0++)
        for (let c0 = 0; c0 < nc; c0++) {
          if (!ok[b0 + c0 * nb]) continue;
          let maxC = nc;
          for (let b1 = b0 + 1; b1 <= nb; b1++) {
            let len = 0;
            while (c0 + len < maxC && ok[b1 - 1 + (c0 + len) * nb]) len++;
            if (!len) break;
            maxC = c0 + len;
            for (let c1 = c0 + 1; c1 <= maxC; c1++) {
              if (!planes[b].has(b0) && rowFree(b0 - 1, c0, c1)) continue;
              if (!planes[b].has(b1) && rowFree(b1, c0, c1)) continue;
              if (!planes[c].has(c0) && colFree(c0 - 1, b0, b1)) continue;
              if (!planes[c].has(c1) && colFree(c1, b0, b1)) continue;
              const lo = [0, 0, 0], hi = [0, 0, 0];
              lo[a] = i0; hi[a] = i1; lo[b] = b0; hi[b] = b1; lo[c] = c0; hi[c] = c1;
              cands.push({ lo, hi, volume: (B[0][hi[0]] - B[0][lo[0]]) * (B[1][hi[1]] - B[1][lo[1]]) * (B[2][hi[2]] - B[2][lo[2]]) });
            }
          }
        }
    }
    if (!cands.length) return null;
    cands.sort((p, q) => q.volume - p.volume); // 大きく続いている板から
    const explains = (cd, g) => {
      const sp = segPlace(g);
      return (cd.lo[sp.axis] === sp.coord || cd.hi[sp.axis] === sp.coord) && cd.lo[sp.along] <= sp.pos && sp.pos < cd.hi[sp.along];
    };
    let tries = 0;
    const search = (labels, list, count, volume, depth) => {
      const g = list[0];
      for (const cd of cands) {
        if (!explains(cd, g)) continue;
        if (++tries > 40) return null;
        const next = labels.slice();
        let clash = false;
        for (v[2] = cd.lo[2]; v[2] < cd.hi[2] && !clash; v[2]++)
          for (v[1] = cd.lo[1]; v[1] < cd.hi[1] && !clash; v[1]++)
            for (v[0] = cd.lo[0]; v[0] < cd.hi[0]; v[0]++) { const c = cid(v); if (next[c]) { clash = true; break; } next[c] = built.boards + count + 1; }
        if (clash) continue;
        const rendered = renderViews(next, nx, ny, nz);
        const cmp = compareLenient(P, rendered);
        if (cmp.visible) continue;
        if (!cmp.unexplained.length) return { labels: next, rendered, cmp, count: count + 1, volume: volume + cd.volume };
        if (depth > 1) { const r = search(next, cmp.unexplained, count + 1, volume + cd.volume, depth - 1); if (r) return r; }
      }
      return null;
    };
    return search(built.labels, cmp0.unexplained, 0, 0, 3);
  }

  // 板厚チェックなし: 見えている面のうしろを、1つのかたまりとしてうめる
  function fill(state, out) {
    const labels = new Int32Array(n);
    let volume = 0;
    for (let c = 0; c < n; c++) if (pre.blobOf[c] && state[c + 1] !== ST_E) { labels[c] = 1; volume += vol[c]; }
    record({ labels, boards: 1, nonRect: 0, volume }, 0, out);
  }

  // ---- 長方形の板だけでおおう ----
  // 板がどれも長方形（切り欠きなし）の作品は、こちらで全部しらべつくす。
  //   ・見えている面のまとまりを、重ならない長方形の板で、ちょうどおおう。
  //   ・どの板も、厚さがどこかに表れていなければならない
  //     （板を横から見た面が見えている。または、厚さがかくれ線でかいてある）。
  //   ・自然な順: 細長い領域（はばが板厚の長方形）を「板を横から見た面」と読めている数が多い
  //     → 板の数が少ない → 材料のある所がいちばん大きく続いている。
  const VIEW_DEPTH = [1, 2, 0]; // pre.views の順（正面・平面・右側面）: 見る向き
  const VIEW_UV = [[0, 2], [0, 1], [1, 2]]; // 図のよこ・たての向き
  const VIEW_NAME = ['front', 'top', 'side'];
  /** 図の領域ごとの、マスの範囲 [p0, p1, q0, q1]（両はしをふくむ） */
  const regionBox = (vw, R) => {
    let p0 = Infinity, p1 = -1, q0 = Infinity, q1 = -1;
    for (const col of R.cols) { const pp = col % vw.nu, q = Math.floor(col / vw.nu); if (pp < p0) p0 = pp; if (pp > p1) p1 = pp; if (q < q0) q0 = q; if (q > q1) q1 = q; }
    return [p0, p1, q0, q1];
  };
  // 細長い領域（はばがちょうど板厚の長方形）: 板を横から見た面のはず。thin = 厚さの向き
  // ただし、次のものは板のしるしとはみなさない（ただのすき間かもしれない）:
  //   ・たてもよこも板厚の小さな四角
  //   ・両がわを、同じ向きの細長い領域にはさまれたもの（平行な2枚の板のあいだの、板厚と同じはばのすき間）
  const strips = pre.views.map((vw, v) => {
    const [ua, va] = VIEW_UV[v], { nu, nv } = vw;
    const regionOf = new Int32Array(nu * nv).fill(-1);
    const info = vw.regions.map((R, ri) => {
      if (R.outside) return null;
      for (const col of R.cols) regionOf[col] = ri;
      const [p0, p1, q0, q1] = regionBox(vw, R);
      if (R.cols.length !== (p1 - p0 + 1) * (q1 - q0 + 1)) return null;
      const wu = B[ua][p1 + 1] - B[ua][p0], wv = B[va][q1 + 1] - B[va][q0];
      if ((wu === T) === (wv === T)) return null;
      return { col: R.cols[0], thin: wu === T ? ua : va, along: wu === T ? 'u' : 'v', p0, p1, q0, q1 };
    });
    // となりの領域が、同じ向きの細長い領域か（side = -1: 手前がわ, +1: 向こうがわ）
    const flanked = (st, side) => {
      const ids = new Set();
      if (st.along === 'u') {
        const pp = side < 0 ? st.p0 - 1 : st.p1 + 1;
        if (pp < 0 || pp >= nu) return false;
        for (let q = st.q0; q <= st.q1; q++) ids.add(regionOf[pp + q * nu]);
      } else {
        const q = side < 0 ? st.q0 - 1 : st.q1 + 1;
        if (q < 0 || q >= nv) return false;
        for (let pp = st.p0; pp <= st.p1; pp++) ids.add(regionOf[pp + q * nu]);
      }
      if (ids.size !== 1) return false;
      const nb = info[[...ids][0]];
      return !!nb && nb.along === st.along;
    };
    return info.filter((st) => st && !(flanked(st, -1) && flanked(st, 1))).map((st) => ({ col: st.col, thin: [st.thin] }));
  });
  // 領域の面がその深さにあってよいか: 板を正面から見ているなら、その深さに板厚ぶんの層があること。
  // 板を横から見ているなら、領域が1つの層におさまっていること。
  const depthAllowed = new Map();
  pre.views.forEach((vw, v) => {
    const w = VIEW_DEPTH[v], [ua, va] = VIEW_UV[v];
    const inOneSlab = (a, i0, i1) => slabs.some((sl) => sl.a === a && sl.i0 <= i0 && i1 < sl.i1);
    for (const R of vw.regions) {
      const [p0, p1, q0, q1] = regionBox(vw, R);
      const edgeOn = inOneSlab(ua, p0, p1) || inOneSlab(va, q0, q1);
      const ok = new Uint8Array(vw.nd);
      for (let t = 0; t < vw.nd; t++) ok[t] = edgeOn || slabsAt[w][v === 0 ? t : dims[w] - 1 - t].length > 0 ? 1 : 0;
      depthAllowed.set(R, ok);
    }
  });

  /** 立体（マスごとの板の番号）で、どのマスがどの図から最初に見えているか（ビットのならび） */
  function seenFrom(solidAt) {
    const seen = new Uint8Array(n);
    const first = pre.views.map((vw, v) => {
      const { nd, colBlobs, ncol } = vw, f = new Int32Array(ncol).fill(-1);
      for (let col = 0; col < ncol; col++)
        for (let t = 0; t < nd; t++) {
          const cell = colBlobs[col * nd + t] - 1;
          if (cell >= 0 && solidAt(cell)) { seen[cell] |= 1 << v; f[col] = cell; break; }
        }
      return f;
    });
    return { seen, first };
  }

  /** 葉（見えている面の決め方）をしらべる: 面のまとまり・それぞれがとりうる板の向き */
  function inspect(state) {
    const { patches, seps } = patchesOf(state);
    const patchOf = new Int32Array(n).fill(-1);
    patches.forEach((cells, pi) => { for (const c of cells) patchOf[c] = pi; });
    const allowed = patches.map((cells) => {
      let common = cellSlabs[cells[0]];
      for (const c of cells) common = common.filter((sl) => cellSlabs[c].includes(sl));
      return common.filter((sl) => cells.every((c) => mates(sl, c).every((m) => state[m + 1] !== ST_E)));
    });
    const sepPairs = [];
    let broken = false;
    for (let e = 0; e < seps.length; e += 2) {
      const a = patchOf[seps[e]], b = patchOf[seps[e + 1]];
      if (a === b) broken = true; else sepPairs.push(a, b);
    }
    return { patches, patchOf, allowed, sepPairs, broken: broken || allowed.some((x) => !x.length), ...seenFrom((c) => state[c + 1] === ST_S) };
  }

  /**
   * 板の位置（厚さの向きでの位置）が、かくれ線でかいてあるか:
   * 板を横から見る図で、その板のふちのどこかに、かくれ線がかいてある。
   */
  function dashEvidence(a, lo, hi) {
    for (let vi = 0; vi < 3; vi++) {
      if (VIEW_DEPTH[vi] === a) continue;
      const [ua, va] = VIEW_UV[vi], view = P[VIEW_NAME[vi]], nu = view.nu;
      for (const at of [lo[ua], hi[ua]]) for (let q = lo[va]; q < hi[va]; q++) if (view.V[at + q * (nu + 1)] === DASH) return true;
      for (const at of [lo[va], hi[va]]) for (let pp = lo[ua]; pp < hi[ua]; pp++) if (view.H[pp + at * nu] === DASH) return true;
    }
    return false;
  }

  /** 板の候補: 層の中の長方形で、面のまとまりをまるごとふくみ、空間（ST_E）をふくまないもの。多すぎたら null */
  function candidates(state, info) {
    const { patches, patchOf, seen, allowed, sepPairs } = info;
    const cols = new Map(); // 層ごとの、柱（層をつらぬくマスのならび）のようす
    const colsOf = (si) => {
      let m = cols.get(si);
      if (m) return m;
      const { a, i0, i1 } = slabs[si];
      const [b, c] = [0, 1, 2].filter((x) => x !== a);
      const nb = dims[b], nc = dims[c];
      const blocked = new Uint8Array(nb * nc), pats = new Array(nb * nc).fill(null);
      const v = [0, 0, 0];
      for (let ib = 0; ib < nb; ib++)
        for (let ic = 0; ic < nc; ic++) {
          v[b] = ib; v[c] = ic;
          const k = ib + ic * nb;
          for (let ia = i0; ia < i1; ia++) {
            v[a] = ia;
            const cell = cid(v), st = state[cell + 1];
            if (st === ST_E) { blocked[k] = 1; break; }
            if (st === ST_S) { if (!pats[k]) pats[k] = [patchOf[cell]]; else if (!pats[k].includes(patchOf[cell])) pats[k].push(patchOf[cell]); }
          }
        }
      m = { a, b, c, nb, nc, i0, i1, blocked, pats };
      cols.set(si, m);
      return m;
    };
    const boxes = new Map(); // 面のまとまりの、その層の面での範囲
    const boxOf = (pi, si, m) => {
      const key = pi * slabs.length + si;
      let r = boxes.get(key);
      if (r) return r;
      r = [Infinity, -1, Infinity, -1];
      for (const cell of patches[pi]) { const v = coord(cell); if (v[m.b] < r[0]) r[0] = v[m.b]; if (v[m.b] > r[1]) r[1] = v[m.b]; if (v[m.c] < r[2]) r[2] = v[m.c]; if (v[m.c] > r[3]) r[3] = v[m.c]; }
      boxes.set(key, r);
      return r;
    };
    // rect = [b0, b1, c0, c1]（両はしをふくむ）を、面のまとまりをまるごとふくむまで広げる。板にできなければ null
    const closure = (si, m, rect) => {
      const found = new Set();
      for (;;) {
        let grew = false;
        for (let ib = rect[0]; ib <= rect[1]; ib++)
          for (let ic = rect[2]; ic <= rect[3]; ic++) {
            const k = ib + ic * m.nb;
            if (m.blocked[k]) return null;
            if (!m.pats[k]) continue;
            for (const pi of m.pats[k]) {
              if (found.has(pi)) continue;
              if (!allowed[pi].includes(si)) return null;
              found.add(pi);
              const r = boxOf(pi, si, m);
              if (r[0] < rect[0]) { rect[0] = r[0]; grew = true; }
              if (r[1] > rect[1]) { rect[1] = r[1]; grew = true; }
              if (r[2] < rect[2]) { rect[2] = r[2]; grew = true; }
              if (r[3] > rect[3]) { rect[3] = r[3]; grew = true; }
            }
          }
        if (!grew) break;
      }
      // 実線でへだてられた面どうしは、同じ板にならない
      for (let e = 0; e < sepPairs.length; e += 2) if (found.has(sepPairs[e]) && found.has(sepPairs[e + 1])) return null;
      return found;
    };
    const list = [], keys = new Set();
    const v = [0, 0, 0];
    for (let pi = 0; pi < patches.length; pi++)
      for (const si of allowed[pi]) {
        const m = colsOf(si);
        const queue = [boxOf(pi, si, m).slice()];
        while (queue.length) {
          const rect = queue.pop();
          const found = closure(si, m, rect);
          if (!found) continue;
          const key = `${si}:${rect.join()}`;
          if (keys.has(key)) continue;
          keys.add(key);
          if (list.length >= 800) return null;
          const lo = [0, 0, 0], hi = [0, 0, 0];
          lo[m.a] = m.i0; hi[m.a] = m.i1; lo[m.b] = rect[0]; hi[m.b] = rect[1] + 1; lo[m.c] = rect[2]; hi[m.c] = rect[3] + 1;
          const cells = [];
          let evid = false;
          for (v[2] = lo[2]; v[2] < hi[2]; v[2]++)
            for (v[1] = lo[1]; v[1] < hi[1]; v[1]++)
              for (v[0] = lo[0]; v[0] < hi[0]; v[0]++) {
                const cell = cid(v);
                cells.push(cell);
                // 板を横から見た面（厚さの見える面）が、どれかの図で見えているか
                if (!evid && seen[cell]) for (let vi = 0; vi < 3; vi++) if (seen[cell] & (1 << vi) && VIEW_DEPTH[vi] !== m.a) evid = true;
              }
          if (!evid) evid = dashEvidence(m.a, lo, hi);
          list.push({
            a: m.a, lo, hi, cells, patches: [...found], evid, wide: 0,
            volume: (B[0][hi[0]] - B[0][lo[0]]) * (B[1][hi[1]] - B[1][lo[1]]) * (B[2][hi[2]] - B[2][lo[2]]),
          });
          if (rect[0] > 0) queue.push([rect[0] - 1, rect[1], rect[2], rect[3]]);
          if (rect[1] < m.nb - 1) queue.push([rect[0], rect[1] + 1, rect[2], rect[3]]);
          if (rect[2] > 0) queue.push([rect[0], rect[1], rect[2] - 1, rect[3]]);
          if (rect[3] < m.nc - 1) queue.push([rect[0], rect[1], rect[2], rect[3] + 1]);
        }
      }
    return list;
  }

  /** 長方形の板だけでできた立体をさがす */
  function solveRect(maxLeaves, maxWork) {
    // onlyFull: 見えない所へ、のばせるだけのばした板だけを考える（1回目）。
    //           かくれ線がそれと合わないときは、とちゅうで止まる板も考える（2回目）。
    const res = { models: [], best: null, pending: [], pendingBest: null, thin: null, complex: false, work: 0, leaves: 0, onlyFull: true, skipped: 0 };
    const tierLess = (p, q) => !!p && (!q || p.S < q.S || (p.S === q.S && p.boards < q.boards));
    // 自然な順でくらべる（S: 板を横から見た面と読めなかった細長い領域の数）
    const worse = (S, boards) => !!res.best && (S > res.best.S || (S === res.best.S && boards > res.best.boards));
    const better = (S, boards) => !res.best || S < res.best.S || (S === res.best.S && boards < res.best.boards);
    const offer = (model) => {
      if (worse(model.S, model.boards)) return;
      if (better(model.S, model.boards)) { res.best = { S: model.S, boards: model.boards }; res.models = [model]; } else keep(model, res);
    };
    const stamp = new Int32Array(n);
    let stampNo = 0;

    const leaf = (state) => {
      const info = inspect(state);
      if (info.broken) return;
      // 何もない所になっている細長い領域の数
      let S0 = 0;
      const faces = []; // 細長い領域の、見えているマスと厚さの向き
      strips.forEach((list, v) => { for (const st of list) { const cell = info.first[v][st.col]; if (cell < 0) S0++; else faces.push(cell, st.thin); } });
      if (worse(S0, 1)) return;
      const list = candidates(state, info);
      if (!list) { res.complex = true; return; }
      for (const cd of list) {
        stampNo++;
        for (const c of cd.cells) stamp[c] = stampNo;
        for (let e = 0; e < faces.length; e += 2) if (stamp[faces[e]] === stampNo && !faces[e + 1].includes(cd.a)) cd.wide++;
      }
      const np = info.patches.length;
      const used = new Uint8Array(n), covered = new Uint8Array(np), chosen = [];
      const fits = (cd) => { for (const pi of cd.patches) if (covered[pi]) return false; for (const c of cd.cells) if (used[c]) return false; return true; };

      // どの板も、見えない空いた所へ、これ以上のばせないか
      const full = () => {
        const w = [0, 0, 0];
        for (const cd of chosen) {
          const [b, c] = [0, 1, 2].filter((x) => x !== cd.a);
          for (const [ax, other] of [[b, c], [c, b]])
            for (const at of [cd.lo[ax] - 1, cd.hi[ax]]) {
              if (at < 0 || at >= dims[ax]) continue;
              let free = true;
              w[ax] = at;
              for (w[other] = cd.lo[other]; w[other] < cd.hi[other] && free; w[other]++)
                for (w[cd.a] = cd.lo[cd.a]; w[cd.a] < cd.hi[cd.a]; w[cd.a]++) { const cell = cid(w); if (state[cell + 1] !== ST_U || used[cell]) { free = false; break; } }
              if (free) return false;
            }
        }
        return true;
      };

      const evaluate = (S) => {
        if (worse(S, chosen.length)) return;
        if (full() !== res.onlyFull) { res.skipped++; return; }
        res.work++;
        const labels = new Int32Array(n);
        let volume = 0;
        chosen.forEach((cd, i) => { for (const c of cd.cells) labels[c] = i + 1; volume += cd.volume; });
        const rendered = renderViews(labels, nx, ny, nz);
        const cmp = compareLenient(P, rendered);
        if (cmp.visible) return;
        const cand = { S, boards: chosen.length, nonRect: 0, gaps: 0, volume };
        if (cmp.unexplained.length) {
          // かくれ線が合わない: あとで、とちゅうで止まる板や、まるごと見えない板をためす
          if (tierLess(cand, res.pendingBest)) res.pendingBest = { S, boards: cand.boards };
          if (res.pending.length < 400) res.pending.push({ state, labels, rendered, cmp, ...cand });
          return;
        }
        offer({ labels, rendered, supplement: cmp.supplement, ...cand });
      };

      // evidence = true: 厚さの表れている板だけを使う
      const search = (evidence, onCover) => {
        const byPatch = info.patches.map(() => []);
        list.forEach((cd, i) => { if (!evidence || cd.evid) for (const pi of cd.patches) byPatch[pi].push(i); });
        if (byPatch.some((x) => !x.length)) return false;
        // 大きな板から先にためす（板の少ないおおい方が、早く見つかる）
        for (const l of byPatch) l.sort((p, q) => list[q].patches.length - list[p].patches.length || list[q].volume - list[p].volume);
        let any = false;
        const dfs = (S) => {
          if (res.work > maxWork) { res.complex = true; return false; }
          let pick = -1, options = null;
          for (let pi = 0; pi < np; pi++) {
            if (covered[pi]) continue;
            const ok = byPatch[pi].filter((i) => fits(list[i]));
            if (!ok.length) return true;
            if (!options || ok.length < options.length) { pick = pi; options = ok; }
          }
          if (pick < 0) { any = true; return onCover(S) !== false; }
          if (evidence && worse(S, chosen.length + 1)) return true;
          for (const i of options) {
            const cd = list[i];
            if (evidence && worse(S + cd.wide, chosen.length + 1)) continue;
            for (const pi of cd.patches) covered[pi] = 1;
            for (const c of cd.cells) used[c] = 1;
            chosen.push(cd);
            const go = dfs(S + cd.wide);
            chosen.pop();
            for (const pi of cd.patches) covered[pi] = 0;
            for (const c of cd.cells) used[c] = 0;
            if (!go) return false;
          }
          return true;
        };
        dfs(S0);
        return any;
      };

      const found = search(true, evaluate);
      // 厚さの表れていない板を使えばできる形: 「厚さが分からない板」として知らせるためにおぼえておく
      if (!found && !res.models.length && !res.pending.length && (!res.thin || res.thin.bad.length > 1)) {
        search(false, () => {
          const bad = [];
          chosen.forEach((cd, i) => { if (!cd.evid) bad.push({ id: i + 1, axis: cd.a }); });
          if (res.thin && res.thin.bad.length <= bad.length) return false;
          const labels = new Int32Array(n);
          chosen.forEach((cd, i) => { for (const c of cd.cells) labels[c] = i + 1; });
          const rendered = renderViews(labels, nx, ny, nz);
          const cmp = compareLenient(P, rendered);
          if (!cmp.visible && !cmp.unexplained.length) res.thin = { labels, rendered, bad };
          return false;
        });
      }
    };

    const forbid = new Uint8Array(n + 1);
    for (let c = 0; c < n; c++) if (pre.blobOf[c] && !cellSlabs[c].length) forbid[c + 1] = 1;
    const states = [];
    solveStrict(P, pre, {
      forbidSolid: forbid, maxNodes: maxLeaves * 20,
      depthFilter: (R, t) => depthAllowed.get(R)[t] === 1,
      onLeaf: (state) => {
        const s2 = state.slice();
        for (let c = 0; c < n; c++) if (!pre.blobOf[c]) s2[c + 1] = ST_E;
        states.push(s2);
        leaf(s2);
        if (++res.leaves >= maxLeaves || res.work > maxWork || late()) { res.complex = true; return false; }
        return true;
      },
    });
    // のばせるだけのばした板では、かくれ線と合わなかった（または、もっと自然な形がそのせいで外れた）:
    // とちゅうで止まる板も考える
    if (res.skipped && (res.models.length ? tierLess(res.pendingBest, res.best) : true)) {
      res.onlyFull = false;
      const kept = res.pending;
      res.pending = [];
      for (const st of states) { if (res.work > maxWork || late()) { res.complex = true; break; } leaf(st); }
      res.pending.push(...kept);
    }

    // かいてあるかくれ線が、見えている板では説明できないとき: まるごと見えない板をためす
    if (!res.models.length && res.pending.length) {
      res.pending.sort((p, q) => p.cmp.unexplained.length - q.cmp.unexplained.length || p.S - q.S || p.boards - q.boards);
      for (const pd of res.pending.slice(0, 200)) {
        if (late()) break;
        const more = addHidden(pd.state, pd, pd.cmp);
        if (more) offer({ labels: more.labels, rendered: more.rendered, supplement: more.cmp.supplement, S: pd.S, boards: pd.boards + more.count, nonRect: 0, gaps: 0, volume: pd.volume + more.volume });
      }
    }
    return res;
  }

  const run = (leaves) => {
    const out = { models: [], seen: new Map(), nonboard: null, unexplained: null, complex: false, work: 0, builds: 0 };
    for (const state of leaves) { if (boardMode) complete(state, out); else fill(state, out); }
    return out;
  };

  let rect = null;
  if (boardMode) {
    // まず、長方形の板だけでできた立体をしらべる
    rect = solveRect(opts.maxLeaves || 6000, opts.budget || 15000);
    if (rect.models.length) return { status: rect.models.length > 1 ? 'ambiguous' : 'ok', models: rect.models.slice(0, 8), complex: rect.complex };
    // 長方形の板でおおえるが、かくれ線が合わない／厚さの分からない板がある
    if (rect.pending.length) return { status: 'unexplained', models: [], model: rect.pending[0], bad: rect.pending[0].cmp.unexplained, complex: rect.complex };
    if (rect.thin) return { status: 'thickness', models: [], model: rect.thin, bad: rect.thin.bad, complex: rect.complex };
    // しらべきれなかった: 板の数が多く、見えない所の決め方が多すぎる
    if (rect.complex) return { status: 'none', models: [], complex: true };
  }

  // 切り欠きのある板をふくむ立体（または、板厚チェックなし）
  let leaves = surfaces(boardMode);
  let out = run(leaves);
  let cut = out.complex || !!leaves.capped;
  if (!out.models.length && !out.unexplained && boardMode && !out.nonboard && !late()) {
    // 板厚より厚いかたまりをゆるして、どこが板になっていないかをしらべる
    leaves = surfaces(false);
    out = run(leaves);
    cut = cut || out.complex || !!leaves.capped;
  }
  if (!out.models.length) {
    if (out.unexplained) return { status: 'unexplained', models: [], model: out.unexplained.model, bad: out.unexplained.bad, complex: cut };
    if (out.nonboard) return { status: 'nonboard', models: [], patches: out.nonboard.labels, complex: cut };
    return { status: 'none', models: [], complex: cut };
  }
  if (boardMode) {
    // どの板も、厚さがどこかに表れていること
    const m = out.models[0];
    const { seen } = seenFrom((c) => m.labels[c] > 0);
    const bad = [];
    for (let id = 1; id <= m.boards; id++) {
      const a = m.axes ? m.axes[id - 1] : -1;
      const lo = [Infinity, Infinity, Infinity], hi = [-1, -1, -1];
      let evid = a < 0;
      for (let c = 0; c < n; c++) {
        if (m.labels[c] !== id) continue;
        const v = coord(c);
        for (let k = 0; k < 3; k++) { if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] + 1 > hi[k]) hi[k] = v[k] + 1; }
        if (!evid && seen[c]) for (let vi = 0; vi < 3; vi++) if (seen[c] & (1 << vi) && VIEW_DEPTH[vi] !== a) evid = true;
      }
      if (!evid && hi[0] >= 0 && !dashEvidence(a, lo, hi)) bad.push({ id, axis: a });
    }
    if (bad.length) return { status: 'thickness', models: [], model: m, bad };
  }

  // out.models には、いちばん自然な答え（同点ならその全部）だけが残っている
  return { status: out.models.length > 1 ? 'ambiguous' : 'ok', models: out.models.slice(0, 8), complex: cut };
}

export { ST_U };
