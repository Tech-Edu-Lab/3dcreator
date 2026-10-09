// 3つの図から立体をさがす（ソルバー）
//
// 考え方:
//  1. 立体の面は、2つの図の両方に線がある場所にしかできない（「壁の候補」）。
//     壁の候補で仕切られていないマスどうしは、かならず同じもの（同じ板か、同じ空間）になる。
//     こうしてできるマスのかたまりを「ブロブ」とよぶ。
//  2. ブロブごとに「材料がある／空間」を決めれば立体が決まる。
//     実線でかこまれた1つの領域は、同じ深さの1つの面でなければならない、というきまりから
//     決まるものを先に決め（伝播）、決まらないところだけを順にためす（探索）。
//  3. できた立体から図をかき直し（render）、元の図面とまったく同じになるものだけを答えにする。

import { SOLID, DASH, NONE } from './model.js';
import { renderViews } from './render.js';

const ST_U = 0; // 未定
const ST_E = 1; // 空間
const ST_S = 2; // 材料あり

class UnionFind {
  constructor(n) { this.p = new Int32Array(n); for (let i = 0; i < n; i++) this.p[i] = i; }
  find(x) { const p = this.p; while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; }
  union(a, b) { a = this.find(a); b = this.find(b); if (a !== b) this.p[a] = b; }
}

/** 図ごとの視線の向き。cell(p,q,t) = 図のマス(p,q)から見て手前から t 番目のマス */
function viewSpecs(P) {
  const { nx, ny, nz } = P;
  return [
    { name: 'front', view: P.front, nu: nx, nv: nz, nd: ny, cell: (p, q, t) => p + nx * (t + ny * q) },
    { name: 'top', view: P.top, nu: nx, nv: ny, nd: nz, cell: (p, q, t) => p + nx * (q + ny * (nz - 1 - t)) },
    { name: 'side', view: P.side, nu: ny, nv: nz, nd: nx, cell: (p, q, t) => nx - 1 - t + nx * (p + ny * q) },
  ];
}

/**
 * ブロブと、図ごとの「領域」をもとめる。
 *
 * opts.cells が真のとき（かくれ線がはぶかれているかもしれない図面用）:
 *   かくれ線がなくても面はありうるので、壁の候補をしぼらない。マス1つ1つを別のブロブとする。
 *   ただし、どれかの図で「背景」（図の外がわ）に見えている視線の上のマスは、かならず空間。
 */
export function prepare(P, opts = {}) {
  const { nx, ny, nz } = P;
  const n = nx * ny * nz, OUT = n;
  const cid = (i, j, k) => i + nx * (j + ny * k);
  const F = P.front, T = P.top, S = P.side;

  // 図ごとの領域: 実線で仕切られていないマスどうしは同じ領域
  const regionsOf = viewSpecs(P).map((spec) => {
    const { nu, nv, view } = spec;
    const ncol = nu * nv, OUTSIDE = ncol;
    const ruf = new UnionFind(ncol + 1);
    const adj = []; // 実線のない境目（図の中どうし）: [a0,b0, a1,b1, ...]
    for (let q = 0; q < nv; q++)
      for (let c = 0; c <= nu; c++) {
        if (view.V[c + q * (nu + 1)] === SOLID) continue;
        const a = c > 0 ? c - 1 + q * nu : OUTSIDE, b = c < nu ? c + q * nu : OUTSIDE;
        ruf.union(a, b);
        if (a !== OUTSIDE && b !== OUTSIDE) adj.push(a, b);
      }
    for (let c = 0; c <= nv; c++)
      for (let p = 0; p < nu; p++) {
        if (view.H[p + c * nu] === SOLID) continue;
        const a = c > 0 ? p + (c - 1) * nu : OUTSIDE, b = c < nv ? p + c * nu : OUTSIDE;
        ruf.union(a, b);
        if (a !== OUTSIDE && b !== OUTSIDE) adj.push(a, b);
      }
    const byRoot = new Map();
    const outRoot = ruf.find(OUTSIDE);
    const background = new Uint8Array(ncol);
    for (let col = 0; col < ncol; col++) {
      const r = ruf.find(col);
      let reg = byRoot.get(r);
      if (!reg) { reg = { cols: [], outside: r === outRoot }; byRoot.set(r, reg); }
      reg.cols.push(col);
      if (r === outRoot) background[col] = 1;
    }
    return { regions: [...byRoot.values()], adj: Int32Array.from(adj), background };
  });

  const blobOf = new Int32Array(n);
  let nb = 0;
  if (opts.cells) {
    const [bgF, bgT, bgS] = regionsOf.map((r) => r.background);
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const c = cid(i, j, k);
          blobOf[c] = bgF[i + k * nx] || bgT[i + j * nx] || bgS[j + k * ny] ? 0 : c + 1;
        }
    nb = n;
  } else {
    const uf = new UnionFind(n + 1);
    // x に垂直な壁: 正面図の縦線と平面図の縦線の両方があるところだけが候補
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let c = 0; c <= nx; c++) {
          if (F.V[c + k * (nx + 1)] && T.V[c + j * (nx + 1)]) continue;
          uf.union(c > 0 ? cid(c - 1, j, k) : OUT, c < nx ? cid(c, j, k) : OUT);
        }
    // y に垂直な壁: 平面図の横線と右側面図の縦線
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++)
        for (let c = 0; c <= ny; c++) {
          if (T.H[i + c * nx] && S.V[c + k * (ny + 1)]) continue;
          uf.union(c > 0 ? cid(i, c - 1, k) : OUT, c < ny ? cid(i, c, k) : OUT);
        }
    // z に垂直な壁: 正面図の横線と右側面図の横線
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        for (let c = 0; c <= nz; c++) {
          if (F.H[i + c * nx] && S.H[j + c * ny]) continue;
          uf.union(c > 0 ? cid(i, j, c - 1) : OUT, c < nz ? cid(i, j, c) : OUT);
        }
    const ids = new Map([[uf.find(OUT), 0]]);
    for (let c = 0; c < n; c++) {
      const r = uf.find(c);
      let id = ids.get(r);
      if (id === undefined) { id = ++nb; ids.set(r, id); }
      blobOf[c] = id;
    }
  }

  const views = viewSpecs(P).map((spec, v) => {
    const { nu, nv, nd } = spec;
    const ncol = nu * nv;
    const colBlobs = new Int32Array(ncol * nd);
    for (let q = 0; q < nv; q++)
      for (let p = 0; p < nu; p++)
        for (let t = 0; t < nd; t++) colBlobs[(p + q * nu) * nd + t] = blobOf[spec.cell(p, q, t)];
    return { ...spec, ncol, colBlobs, regions: regionsOf[v].regions, adj: regionsOf[v].adj, depth: new Int32Array(ncol) };
  });

  // かかれた線分ごとに、「その線になりうる立体の辺」をならべておく（探索のむだをはぶくため）。
  // 辺 = まわりの4つのマスのブロブ番号 [a,b,c,d]。ブロブの並びだけで平らと分かる辺ははぶく。
  const B = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : blobOf[cid(i, j, k)]);
  const quads = [];
  const lists = new Map(); // "図:種類:番号" → 辺の番号のリスト
  const add = (a, b, c, d, keys) => {
    if ((a === b && c === d) || (a === d && b === c)) return;
    const e = quads.length / 4;
    quads.push(a, b, c, d);
    for (const key of keys) { let l = lists.get(key); if (!l) { l = []; lists.set(key, l); } l.push(e); }
  };
  for (let k = 0; k < nz; k++)
    for (let c2 = 0; c2 <= ny; c2++)
      for (let c = 0; c <= nx; c++) add(B(c - 1, c2 - 1, k), B(c, c2 - 1, k), B(c, c2, k), B(c - 1, c2, k), [`front:V:${c + k * (nx + 1)}`, `side:V:${c2 + k * (ny + 1)}`]);
  for (let j = 0; j < ny; j++)
    for (let c3 = 0; c3 <= nz; c3++)
      for (let c = 0; c <= nx; c++) add(B(c - 1, j, c3 - 1), B(c, j, c3 - 1), B(c, j, c3), B(c - 1, j, c3), [`top:V:${c + j * (nx + 1)}`, `side:H:${j + c3 * ny}`]);
  for (let i = 0; i < nx; i++)
    for (let c3 = 0; c3 <= nz; c3++)
      for (let c2 = 0; c2 <= ny; c2++) add(B(i, c2 - 1, c3 - 1), B(i, c2, c3 - 1), B(i, c2, c3), B(i, c2 - 1, c3), [`top:H:${i + c2 * nx}`, `front:H:${i + c3 * nx}`]);
  const drawn = []; // かかれた線分ごとの辺のリスト
  let hopeless = false; // どの辺にもなりえない線がある
  for (const name of ['front', 'top', 'side'])
    for (const kind of ['V', 'H']) {
      const arr = P[name][kind];
      for (let i = 0; i < arr.length; i++) {
        if (!arr[i]) continue;
        const l = lists.get(`${name}:${kind}:${i}`);
        if (!l) { hopeless = true; continue; }
        drawn.push(Int32Array.from(l));
      }
    }
  // touch[b]: ブロブ b の状態が変わったときに、たしかめ直す必要のある線分（drawn の番号）
  const sets = Array.from({ length: nb + 1 }, () => null);
  drawn.forEach((list, d) => {
    for (const e of list)
      for (let k = 0; k < 4; k++) {
        const b = quads[e * 4 + k];
        if (!b) continue;
        if (!sets[b]) sets[b] = new Set();
        sets[b].add(d);
      }
  });
  const touch = sets.map((x) => (x ? Int32Array.from(x) : new Int32Array(0)));
  return { nb, blobOf, views, quads: Int32Array.from(quads), drawn, hopeless, touch };
}

/** 2組の図をくらべ、ちがう線分をならべる */
export function compareProblems(P, R) {
  const list = [];
  let cost = 0;
  for (const name of ['front', 'top', 'side']) {
    const a = P[name], b = R[name];
    for (const kind of ['V', 'H']) {
      const A = a[kind], B = b[kind];
      for (let i = 0; i < A.length; i++) {
        if (A[i] === B[i]) continue;
        list.push({ view: name, kind, index: i, drawn: A[i], rendered: B[i] });
        cost += A[i] !== NONE && B[i] !== NONE ? 1 : 4;
      }
    }
  }
  return { list, cost };
}

/**
 * ブロブの状態（材料あり／空間）から立体をつくり、図面とくらべる。
 * 同じ領域（実線で仕切られていない）で同じ深さに見えるブロブは、同じ部品にまとめる。
 */
export function evaluate(P, pre, state, merge = true) {
  const { nx, ny, nz } = P;
  const n = nx * ny * nz;
  const uf = new UnionFind(pre.nb + 1);
  for (const vw of merge ? pre.views : []) {
    const { nd, colBlobs, ncol, adj, depth } = vw;
    for (let col = 0; col < ncol; col++) {
      let t = 0;
      const base = col * nd;
      while (t < nd && state[colBlobs[base + t]] !== ST_S) t++;
      depth[col] = t;
    }
    for (let e = 0; e < adj.length; e += 2) {
      const a = adj[e], b = adj[e + 1], t = depth[a];
      if (t < nd && t === depth[b]) uf.union(colBlobs[a * nd + t], colBlobs[b * nd + t]);
    }
  }
  const labels = new Int32Array(n);
  for (let c = 0; c < n; c++) {
    const b = pre.blobOf[c];
    if (state[b] === ST_S) labels[c] = uf.find(b);
  }
  const rendered = renderViews(labels, nx, ny, nz);
  const cmp = compareProblems(P, rendered);
  return { labels, rendered, mismatches: cmp.list, cost: cmp.cost };
}

/**
 * 図面とぴったり合う立体をすべて（上限まで）さがす。
 * opts.forbidSolid[b] が真のブロブは、かならず空間とする。
 */
export function solveStrict(P, pre, opts = {}) {
  // onLeaf: 見えている面の深さがすべて決まったところで呼ばれる（どの図からも見えないブロブは未定のまま）。
  //         これを指定すると、未定のブロブを自分でためすかわりに、呼び出し側にまかせる。
  // depthFilter(R, t): 領域 R の面が深さ t にあってよいか（呼び出し側の条件でしぼる）
  const { maxSolutions = 64, maxNodes = 20000, forbidSolid = null, onLeaf = null, depthFilter = null } = opts;
  const nb = pre.nb;
  const solutions = [];
  const seen = new Set();
  let nodes = 0, truncated = false;
  const mark = new Int32Array(nb + 1);
  let stamp = 0;

  function setState(state, b, val) {
    const cur = state[b];
    if (cur === val) return 0;
    if (cur !== ST_U) return -1;
    state[b] = val;
    return 1;
  }

  // 領域 R の面が深さ t にある、としてよいか
  function depthOk(state, vw, R, t) {
    const { nd, colBlobs } = vw;
    stamp++;
    for (const col of R.cols) {
      const base = col * nd;
      if (state[colBlobs[base + t]] === ST_E) return false;
      for (let s = 0; s < t; s++) mark[colBlobs[base + s]] = stamp;
    }
    for (const col of R.cols) if (mark[colBlobs[col * nd + t]] === stamp) return false;
    return true;
  }

  // 領域 R でとりうる深さ（nd = 何もない＝背景）。深い順。
  function feasibleDepths(state, vw, R) {
    const { nd, colBlobs } = vw;
    let tmax = nd;
    for (const col of R.cols) {
      const base = col * nd;
      for (let t = 0; t < tmax; t++) if (state[colBlobs[base + t]] === ST_S) { tmax = t; break; }
    }
    if (R.outside) return tmax === nd ? [nd] : [];
    const out = [];
    if (tmax === nd) out.push(nd);
    for (let t = Math.min(tmax, nd - 1); t >= 0; t--) if ((!depthFilter || depthFilter(R, t)) && depthOk(state, vw, R, t)) out.push(t);
    return out;
  }

  // 領域 R の深さを t に決める。もどり値: -1 矛盾 / 0 変化なし / 1 変化あり
  function enforce(state, vw, R, t) {
    const { nd, colBlobs } = vw;
    let changed = 0;
    for (const col of R.cols) {
      const base = col * nd;
      const lim = Math.min(t, nd);
      for (let s = 0; s < lim; s++) {
        const r = setState(state, colBlobs[base + s], ST_E);
        if (r < 0) return -1;
        changed |= r;
      }
      if (t < nd) {
        const r = setState(state, colBlobs[base + t], ST_S);
        if (r < 0) return -1;
        changed |= r;
      }
    }
    return changed;
  }

  // かかれた線は、どれかの辺で説明できなければならない。
  // いまの状態で、もう説明できなくなった線があれば false。
  const { quads, drawn, touch } = pre;
  function segAlive(state, list) {
    for (let n = 0; n < list.length; n++) {
      const e = list[n] * 4, a = quads[e], b = quads[e + 1], c = quads[e + 2], d = quads[e + 3];
      // 「かならず同じ」= 同じブロブ、または両方とも空間
      const ab = a === b || (state[a] === ST_E && state[b] === ST_E), cd = c === d || (state[c] === ST_E && state[d] === ST_E);
      if (ab && cd) continue;
      const ad = a === d || (state[a] === ST_E && state[d] === ST_E), bc = b === c || (state[b] === ST_E && state[c] === ST_E);
      if (ad && bc) continue;
      return true;
    }
    return false;
  }
  function alive(state) {
    for (const list of drawn) if (!segAlive(state, list)) return false;
    return true;
  }
  // ブロブ b を空間にしたとき、説明できなくなる線が出ないか（b にかかわる線だけを見ればよい）
  function aliveWithout(state, b) {
    const t = touch[b];
    for (let n = 0; n < t.length; n++) if (!segAlive(state, drawn[t[n]])) return false;
    return true;
  }

  // 実線は、となり合う視線で「深さ」か「部品」がちがうところにしかできない。
  // 両がわの深さがもう決まっていて、同じ深さ・同じブロブ（または両方とも背景）なら矛盾。
  function visibleOk(state) {
    for (const vw of pre.views) {
      const { nu, nv, nd, colBlobs, ncol, view, depth } = vw;
      for (let col = 0; col < ncol; col++) {
        const base = col * nd;
        let t = 0;
        while (t < nd && state[colBlobs[base + t]] === ST_E) t++;
        depth[col] = t === nd ? nd : state[colBlobs[base + t]] === ST_S ? t : -1; // -1: まだ決まらない
      }
      const same = (a, b) => {
        const da = a < 0 ? nd : depth[a], db = b < 0 ? nd : depth[b];
        if (da < 0 || db < 0 || da !== db) return false;
        return da === nd || colBlobs[a * nd + da] === colBlobs[b * nd + db];
      };
      for (let q = 0; q < nv; q++)
        for (let c = 0; c <= nu; c++)
          if (view.V[c + q * (nu + 1)] === SOLID && same(c > 0 ? c - 1 + q * nu : -1, c < nu ? c + q * nu : -1)) return false;
      for (let c = 0; c <= nv; c++)
        for (let p = 0; p < nu; p++)
          if (view.H[p + c * nu] === SOLID && same(c > 0 ? p + (c - 1) * nu : -1, c < nv ? p + c * nu : -1)) return false;
    }
    return true;
  }

  // 決まるところをすべて決める。矛盾したら null。まだ選べる領域があればその情報を返す。
  function propagate(state) {
    for (;;) {
      const res = propagateRegions(state);
      if (!res) return null;
      if (!alive(state) || !visibleOk(state)) return null;
      // ためしおき: 未定のブロブを空間にしてみて、説明できない線が出るなら「材料あり」に決まる
      let forced = false;
      for (let b = 1; b <= nb; b++) {
        if (state[b] !== ST_U) continue;
        state[b] = ST_E;
        const ok = aliveWithout(state, b);
        state[b] = ok ? ST_U : ST_S;
        if (!ok) forced = true;
      }
      if (!forced) return res;
    }
  }

  function propagateRegions(state) {
    for (;;) {
      let changed = false;
      let pick = null;
      for (const vw of pre.views) {
        for (const R of vw.regions) {
          const f = feasibleDepths(state, vw, R);
          if (f.length === 0) return null;
          if (f.length === 1) {
            const r = enforce(state, vw, R, f[0]);
            if (r < 0) return null;
            if (r > 0) changed = true;
          } else if (!pick || f.length < pick.f.length) {
            pick = { vw, R, f };
          }
        }
      }
      if (!changed) return { pick };
    }
  }

  function leaf(state) {
    const key = state.join('');
    if (seen.has(key)) return;
    seen.add(key);
    const ev = evaluate(P, pre, state);
    if (ev.cost === 0) solutions.push({ state: state.slice(), labels: ev.labels });
  }

  // どの図からも見えないブロブを、空間 → 材料あり の順にためす
  function hidden(state, list, at) {
    if (truncated || solutions.length >= maxSolutions) return;
    if (++nodes > maxNodes) { truncated = true; return; }
    if (at === list.length) { leaf(state); return; }
    const b = list[at];
    state[b] = ST_E;
    if (alive(state)) hidden(state, list, at + 1);
    state[b] = ST_S; hidden(state, list, at + 1);
    state[b] = ST_U;
  }

  function dfs(state) {
    if (truncated || solutions.length >= maxSolutions) return;
    if (++nodes > maxNodes) { truncated = true; return; }
    const res = propagate(state);
    if (!res) return;
    if (res.pick) {
      const { vw, R, f } = res.pick;
      for (const t of f) {
        const s2 = state.slice();
        if (enforce(s2, vw, R, t) < 0) continue;
        dfs(s2);
      }
      return;
    }
    if (onLeaf) {
      if (onLeaf(state) === false) truncated = true;
      return;
    }
    const list = [];
    for (let b = 1; b <= nb; b++) if (state[b] === ST_U) list.push(b);
    hidden(state, list, 0);
  }

  const init = new Uint8Array(nb + 1);
  init[0] = ST_E;
  if (forbidSolid) for (let b = 1; b <= nb; b++) if (forbidSolid[b]) init[b] = ST_E;
  if (!pre.hopeless) dfs(init);
  if (solutions.length >= maxSolutions) truncated = true;
  return { solutions, truncated, nodes };
}

/**
 * ぴったり合う立体がないとき、「いちばん近い立体」をさがして、図面とのちがいを返す（赤ペン用）。
 * ブロブが少なければ全部ためし、多ければ山登り法でさがす。
 * better(a, b) は同点のときの比較（a のほうがよければ真）。
 */
export function diagnose(P, pre, opts = {}) {
  const { exhaustiveLimit = 11, maxEvals = 3000, better = null, forbidSolid = null } = opts;
  const nb = pre.nb;
  const free = [];
  for (let b = 1; b <= nb; b++) if (!forbidSolid || !forbidSolid[b]) free.push(b);
  let best = null;
  let evals = 0;
  // 線の種類（実線・破線）がまちがっているかもしれないので、
  // 「実線のないところは同じ部品」とみなす場合と、みなさない場合の両方をためす。
  const consider = (state) => {
    evals++;
    let cost = Infinity;
    for (const merge of [true, false]) {
      const ev = evaluate(P, pre, state, merge);
      if (ev.cost < cost) cost = ev.cost;
      if (!best || ev.cost < best.cost || (ev.cost === best.cost && better && better(ev, best))) {
        best = { ...ev, state: state.slice() };
      }
    }
    return cost;
  };
  const base = new Uint8Array(nb + 1);
  base.fill(ST_E);

  if (free.length <= exhaustiveLimit) {
    const total = 1 << free.length;
    const state = base.slice();
    for (let m = 0; m < total; m++) {
      for (let f = 0; f < free.length; f++) state[free[f]] = (m >> f) & 1 ? ST_S : ST_E;
      consider(state);
    }
    return best;
  }

  // 山登り: いくつかの出発点から、1つずつ入れかえてよくなる方へ進む
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const starts = [];
  const allS = base.slice(); for (const b of free) allS[b] = ST_S; starts.push(allS);
  starts.push(base.slice());
  for (let r = 0; r < 6; r++) {
    const s = base.slice();
    for (const b of free) s[b] = rnd() < 0.5 ? ST_S : ST_E;
    starts.push(s);
  }
  for (const start of starts) {
    if (evals >= maxEvals) break;
    const state = start.slice();
    let cur = consider(state);
    for (let iter = 0; iter < 4 * free.length && evals < maxEvals; iter++) {
      let bestB = -1, bestC = cur;
      for (const b of free) {
        state[b] = state[b] === ST_S ? ST_E : ST_S;
        const c = consider(state);
        state[b] = state[b] === ST_S ? ST_E : ST_S;
        if (c < bestC) { bestC = c; bestB = b; }
      }
      if (bestB < 0) break;
      state[bestB] = state[bestB] === ST_S ? ST_E : ST_S;
      cur = bestC;
    }
  }
  return best;
}

export { ST_U, ST_E, ST_S, DASH };
