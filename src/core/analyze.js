// 図面を点検して立体にする、全体の流れ。
//
//  1. 図のかき方（位置・大きさ・線のとぎれ）
//  2. 図どうしの線の対応（かくれ線を「全部かく」設定のときだけ）
//  3. 立体をさがす
//       ・まず、かかれた線だけでぴったり決まる立体をさがす（solver.js）
//       ・かくれ線が「必要なものだけ」の設定で、それが見つからないときは、
//         見える線から板の組み合わせを考え、かくれ線をおぎなう（lenient.js）。
//         見えない所の形が決まらないとき・厚さのない線かもしれないとき
//         （同じ平面にならんだ板のつなぎ目、たしかめようのない板のはし）は、出力せずにたずねる
//  4. 板の厚さと組み立て方（板厚チェック）
//
// どこかで問題が見つかったら、立体は出力せず、直し方（issues）を返す。

import { NONE, SOLID, DASH, VIEW_NAMES } from './model.js';
import { extractViews, unmatchedLines, mirrorU } from './extract.js';
import { compress, expandLabels } from './compress.js';
import { prepare, solveStrict, diagnose, compareProblems } from './solver.js';
import { solveLenient } from './lenient.js';
import { renderViews } from './render.js';
import { analyzeParts, partGroups, thickBlobs } from './boards.js';
import { describeIssue } from './messages.js';

/**
 * drawing: { front, top, side }（用紙のわくごとの方眼）
 * settings: { thickness: 板の厚さ（マス）, boardCheck: 板厚チェックをするか,
 *             hiddenLines: 'needed'（必要なかくれ線だけ。標準）/ 'all'（かくれ線を全部かく） }
 * もどり値: { ok, stage, issues, model, alternatives }
 *   model.supplement: アプリがおぎなったかくれ線（図ごとの線分のリスト）
 */
export function analyze(drawing, settings = {}) {
  const T = Math.max(1, settings.thickness | 0 || 1);
  const boardCheck = settings.boardCheck !== false;
  const lenient = settings.hiddenLines !== 'all';
  const finish = (list) => list.map((i) => describeIssue({ level: 'error', marks: [], ...i }, T));
  const fail = (stage, list) => ({ ok: false, stage, issues: finish(list), model: null });

  // 1. 図のかき方
  const ex = extractViews(drawing, { solidOnly: lenient });
  if (ex.issues.length) return fail('layout', ex.issues);
  const { unit: Pu, origin } = ex;
  const toBox = (view, segs) => segs.map(([kind, a, b]) => [kind, a + origin[view].u, b + origin[view].v]);

  // 2. 図どうしの対応（かくれ線を全部かく設定のとき）
  if (!lenient) {
    const um = unmatchedLines(Pu);
    if (um.length) {
      const list = um.map((m) => ({
        code: 'NO_MATCH', view: m.view, other: m.other, kind: m.kind,
        marks: [{ view: m.view, segs: toBox(m.view, m.segs) }],
      }));
      // よくあるまちがい: 平面図と右側面図で「手前と奥」が逆。
      // 右側面図を左右うら返すと合う（＝平面図を上下うら返しても合う）なら、それを先に伝える。
      if (!unmatchedLines({ ...Pu, side: mirrorU(Pu.side) }).length) list.unshift({ code: 'DEPTH_MIRRORED' });
      return fail('match', list);
    }
  }

  // 3. 立体をさがす
  const { P, bx, by, bz } = compress(Pu);
  const pre = prepare(P);
  // ブロブ（線で仕切られたかたまり）の形。「板の形をしたすき間」を見つけるのに使う。
  const blobs = expandLabels(pre.blobOf, bx, by, bz);
  const blobShapes = analyzeParts(blobs.unit, blobs.W, blobs.D, blobs.H, T);
  const describe = (labels, exact = true) => {
    const { unit, W, D, H } = expandLabels(labels, bx, by, bz);
    const parts = analyzeParts(unit, W, D, H, T);
    const groups = partGroups(unit, W, D, H);
    let cells = 0;
    for (const p of parts) cells += p.cells;
    return {
      labels, unit, W, D, H, parts, groups, cells,
      bad: parts.filter((p) => !p.isBoard).length,
      missing: exact ? missingBoards(unit, W, D, H, parts, blobs.unit, blobShapes, T) : 0,
    };
  };
  const toModel = (d) => ({
    // origin: 用紙の各わくの中で、図の左下がどこにあるか（寸法を図に重ねてかくのに使う）
    W: d.W, D: d.D, H: d.H, unit: d.unit, parts: d.parts, origin,
    grid: { labels: d.labels, nx: P.nx, ny: P.ny, nz: P.nz, bx, by, bz },
  });
  // 立体のマスの集まり → 各図での位置（赤くぬる所）
  const cellMarks = (d, inSet) => {
    const sets = { front: new Set(), top: new Set(), side: new Set() };
    const { W, D, H } = d;
    for (let z = 0; z < H; z++)
      for (let y = 0; y < D; y++)
        for (let x = 0; x < W; x++) {
          if (!inSet(x + W * (y + D * z))) continue;
          sets.front.add(`${x},${z}`); sets.top.add(`${x},${y}`); sets.side.add(`${y},${z}`);
        }
    return VIEW_NAMES.map((view) => ({
      view,
      cells: [...sets[view]].map((s) => { const [p, q] = s.split(',').map(Number); return [p + origin[view].u, q + origin[view].v]; }),
    }));
  };
  const partMarks = (d, ids) => { const want = new Set(ids); return cellMarks(d, (i) => want.has(d.unit[i])); };
  // まとめた方眼の線分のリスト → 図ごとの、用紙の上の線分
  const segsByView = (list) => {
    const out = { front: [], top: [], side: [] };
    for (const m of list) out[m.view].push(...expandSeg(m.view, m.kind, m.index, bx, by, bz));
    for (const v of VIEW_NAMES) out[v] = toBox(v, out[v]);
    return out;
  };

  // --- かかれた線だけで、ぴったり決まる立体 ---
  let found = [];
  if (boardCheck) {
    // まず「板だけでできた立体」をさがす（板厚より厚いかたまりは空間とみなす）
    const thick = thickBlobs(blobs.unit, blobs.W, blobs.D, blobs.H, pre.nb, T);
    found = solveStrict(P, pre, { forbidSolid: thick }).solutions;
  }
  if (!found.length) found = solveStrict(P, pre).solutions;
  // 同じ図面に合う形がいくつかあるときの優先順:
  //   板でない部品が少ない → 宙にういた部品がない
  //   → 「板がぬけたようなすき間」が少ない（背板など、正面・上・右から見えない板をおぎなう）
  //   → 部品の数が少ない → 材料が少ない
  const ranked = found.map((s) => describe(healSplits(s.labels, P, bx, by, bz, T)));
  ranked.sort((a, b) => (boardCheck ? a.bad - b.bad || (a.groups.length > 1) - (b.groups.length > 1) : 0) || a.missing - b.missing || a.parts.length - b.parts.length || a.cells - b.cells);
  const exactOk = ranked.length > 0 && (!boardCheck || (ranked[0].bad === 0 && ranked[0].groups.length === 1));

  // 4. 板の厚さと組み立て方（ぴったり決まる立体について）
  const judge = (best, extra = {}) => {
    const issues = [];
    if (boardCheck && best.bad) {
      for (const [kind, code] of [['thick', 'NOT_BOARD_THICK'], ['joined', 'NOT_BOARD_JOINED'], ['thin', 'NOT_BOARD_THIN']]) {
        const ids = best.parts.filter((p) => !p.isBoard && p.kind === kind).map((p) => p.id);
        if (ids.length) issues.push({ code, hidden: lenient, marks: partMarks(best, ids) });
      }
      return fail('boards', issues);
    }
    if (best.groups.length > 1) {
      const ids = best.groups.slice(1).flatMap((g) => g.ids);
      const issue = { code: 'FLOATING', marks: partMarks(best, ids) };
      if (boardCheck) return fail('boards', [issue]);
      issues.push({ ...issue, level: 'warn' });
    }
    return { ok: true, stage: 'ok', issues: finish(issues), model: { ...toModel(best), ...extra }, alternatives: [] };
  };

  if (exactOk || (!lenient && ranked.length)) {
    const res = judge(ranked[0]);
    if (res.ok) {
      // 「ほかの形」は、板だけでできた形が2つ以上あるときだけ知らせる
      //（板厚チェックなしのときは、すき間をつめものでうめた形がいくらでも考えられるので出さない）
      const usable = boardCheck ? ranked.filter((d) => d.bad === 0 && d.groups.length === 1) : [ranked[0]];
      res.alternatives = usable.slice(1, 6).map(toModel);
    }
    return res;
  }

  // --- ぴったり合う立体がないとき: かかれた線に「いちばん近い立体」とのちがいをしらべる ---
  // もどり値: { model }（実はぴったり合う立体があった）または { list, typeOnly, near }
  //   typeOnly: ちがいが「実線か破線か」だけ（線の種類を直せば合う）
  const typeIssues = () => {
    // 同じくらい近い立体がいくつかあるときは、板でない部品が少ないもの、次に材料が少ないものをえらぶ
    const look = (ev) => ev.shape || (ev.shape = describe(ev.labels, false));
    const near = diagnose(P, pre, { better: (a, b) => ((boardCheck ? look(a).bad - look(b).bad : 0) || look(a).cells - look(b).cells) < 0 });
    if (near.cost === 0) return { model: describe(near.labels) };
    const groups = new Map();
    for (const m of near.mismatches) {
      const code = m.rendered === NONE ? 'UNEXPLAINED' : m.drawn === NONE ? 'MISSING' : m.drawn === SOLID ? 'SHOULD_DASH' : 'SHOULD_SOLID';
      const key = `${code}:${m.view}`;
      if (!groups.has(key)) groups.set(key, { code, view: m.view, list: [] });
      groups.get(key).list.push(m);
    }
    const order = { UNEXPLAINED: 0, MISSING: 1, SHOULD_DASH: 2, SHOULD_SOLID: 3 };
    const list = [...groups.values()]
      .sort((a, b) => order[a.code] - order[b.code])
      .map((g) => ({ code: g.code, view: g.view, marks: [{ view: g.view, segs: segsByView(g.list)[g.view] }] }));
    return { list, near: describe(near.labels), typeOnly: list.length > 0 && list.every((i) => i.code === 'SHOULD_DASH' || i.code === 'SHOULD_SOLID') };
  };
  // 線の種類を直しても板にならないなら、線の種類より先に、板の厚さのことを伝える
  const afterTypeFix = (t) => (boardCheck && t.near.bad ? judge(t.near) : fail('solve', t.list));
  if (!lenient) {
    const t = typeIssues();
    if (t.model) return judge(t.model);
    if (t.typeOnly) return afterTypeFix(t);
    return fail('solve', t.list.length ? t.list : [{ code: 'INCONSISTENT' }]);
  }

  // --- かくれ線は必要なものだけ: 見える線から板の組み合わせを考える ---
  let len = solveLenient(P, { bx, by, bz }, T, { boards: boardCheck });
  if (!boardCheck && len.status !== 'ok') {
    // 板厚チェックなしで、1つのかたまりとしては読めないとき: 板を組んだ作品として読んでみる
    const asBoards = solveLenient(P, { bx, by, bz }, T, { boards: true });
    if (asBoards.status === 'ok' || asBoards.status === 'ambiguous') len = asBoards;
  }
  if (len.status === 'ok' && len.complex && (boardCheck || len.models[0].S !== undefined)) {
    // さがし方を打ち切った: ほかにも同じくらい自然な形があるかもしれないので、出力しない
    return fail('hidden', [{ code: 'HIDDEN_MORE' }]);
  }
  if (len.status === 'ok') {
    const m = len.models[0];
    const d = describe(m.labels, false);
    if (boardCheck && !d.bad) {
      const doubt = flatSeam(m, d) || looseEnd(m, d);
      if (doubt) return fail('boards', [doubt]);
    }
    return judge(d, { supplement: segsByView(m.supplement) });
  }
  if (len.status === 'ambiguous') {
    // 同じくらい自然な形がいくつかある: どこがちがうのかをしめし、かくれ線でかいてもらう
    const base = describe(len.models[0].labels, false);
    const differ = new Uint8Array(base.unit.length);
    for (const m of len.models.slice(1)) {
      const other = expandLabels(m.labels, bx, by, bz).unit;
      // 板の番号のつけ方をそろえる（いちばん重なりの大きい板どうしを同じ板とみなす）
      const overlap = new Map();
      for (let i = 0; i < other.length; i++) {
        if (!base.unit[i] || !other[i]) continue;
        const k = `${base.unit[i]},${other[i]}`;
        overlap.set(k, (overlap.get(k) || 0) + 1);
      }
      const match = new Map();
      for (const [k, v] of overlap) { const [a, b] = k.split(',').map(Number); if (!match.has(a) || match.get(a)[1] < v) match.set(a, [b, v]); }
      for (let i = 0; i < other.length; i++) {
        const want = base.unit[i] ? (match.has(base.unit[i]) ? match.get(base.unit[i])[0] : -1) : 0;
        if (other[i] !== want) differ[i] = 1;
      }
    }
    // 考えられるかくれ線: ある形にはあって、別の形にはない線
    const seen = new Map();
    for (const m of len.models) for (const g of m.supplement) { const k = `${g.view}:${g.kind}:${g.index}`; seen.set(k, [g, (seen.has(k) ? seen.get(k)[1] : 0) + 1]); }
    const ghosts = segsByView([...seen.values()].filter(([, cnt]) => cnt < len.models.length).map(([g]) => g));
    const marks = cellMarks(base, (i) => differ[i] === 1).map((m) => ({ ...m, ghost: ghosts[m.view] }));
    return fail('hidden', [{ code: 'HIDDEN_JOINT', marks }]);
  }

  if (len.status === 'thickness') {
    // 板にはなるが、厚さ（厚さの向きでの位置）がどの図にも表れていない板がある
    const d = describe(len.model.labels, false);
    // 同じ平面にならんだ板のつなぎ目に読めるなら、厚さのない線かもしれない
    const seam = d.bad ? null : flatSeam(len.model, d);
    if (seam) return fail('boards', [seam]);
    const FACE = ['side', 'front', 'top']; // 板の厚さの向き（x, y, z）ごとの、広い面が見える図
    const marks = len.bad.flatMap((b) => cellMarks(d, (i) => d.unit[i] === b.id).filter((m) => m.view === FACE[b.axis]));
    return fail('boards', [{ code: 'NO_THICKNESS', marks }]);
  }

  // ここから先は、見える線からは自然な立体が決まらなかった場合。
  // かかれた線どおりの立体（板でない部品がある）があれば、それで説明する（例: たな板を線1本でかいた）
  if (ranked.length) return judge(ranked[0]);
  // しらべきれなかったとき（板が多く、見えない所の決め方が多すぎる）は、あてずっぽうの理由を言わない
  if (len.complex) return fail('hidden', [{ code: 'HIDDEN_MORE' }]);
  // 線の種類（実線・破線）のまちがいなら、それを伝える
  const t = typeIssues();
  if (t.model) return judge(t.model);
  if (t.typeOnly) return afterTypeFix(t);
  // 平面図と右側面図で、手前と奥が逆になっていないか
  const hints = [];
  {
    const flipped = compress({ ...Pu, side: mirrorU(Pu.side) });
    const st = solveLenient(flipped.P, flipped, T, { boards: boardCheck, budget: 4000, maxLeaves: 1500, deadline: Date.now() + 400 }).status;
    if (st === 'ok' || st === 'ambiguous') hints.push({ code: 'DEPTH_MIRRORED' });
  }
  if (len.status === 'unexplained') {
    const by2 = segsByView(len.bad);
    return fail('hidden', [...hints, ...VIEW_NAMES.filter((v) => by2[v].length).map((v) => ({ code: 'HIDDEN_UNEXPLAINED', view: v, marks: [{ view: v, segs: by2[v] }] }))]);
  }
  if (hints.length) return fail('solve', [...hints, { code: 'INCONSISTENT_VISIBLE' }]);
  // 実線を1本だけかくれ線にすると合うなら、その線をしめす（見えない線を実線でかいた）
  const started = Date.now();
  for (const st of solidStrokes(Pu)) {
    if (Date.now() - started > 900) break;
    const trial = { ...Pu, [st.view]: { ...Pu[st.view], V: Pu[st.view].V.slice(), H: Pu[st.view].H.slice() } };
    for (const [kind, a, b2] of st.segs) trial[st.view][kind][kind === 'V' ? a + b2 * (trial[st.view].nu + 1) : a + b2 * trial[st.view].nu] = DASH;
    const c = compress(trial);
    const r = solveLenient(c.P, c, T, { boards: boardCheck, budget: 3000, maxLeaves: 1500, deadline: started + 900 });
    if (r.status === 'ok' || r.status === 'ambiguous') return fail('solve', [{ code: 'SHOULD_DASH', view: st.view, marks: [{ view: st.view, segs: toBox(st.view, st.segs) }] }]);
  }
  if (len.status === 'nonboard') return judge(describe(len.patches, false));
  return fail('solve', [{ code: 'INCONSISTENT_VISIBLE' }]);

  /**
   * 同じ平面にならんだ2枚の板のあいだの「見えるつなぎ目」をしらべる。
   * たな板などを線1本でかくと、こう読めてしまうことがある（板の厚さを考えていない線）。
   * つなぎ目のかくれ線（板の厚さの中を通る線）がかいてあれば、本当に2枚の板だと分かるので通す。
   * かいてなければ、立体は出さずにたしかめてもらう。
   */
  function flatSeam(m, d) {
    const { nx, ny, nz } = P;
    const LO = ['x0', 'y0', 'z0'], HI = ['x1', 'y1', 'z1'];
    const byId = new Map(d.parts.map((p) => [p.id, p]));
    const pairs = new Set();
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const a = m.labels[i + nx * (j + ny * k)];
          if (!a) continue;
          for (const b of [i + 1 < nx ? m.labels[i + 1 + nx * (j + ny * k)] : 0, j + 1 < ny ? m.labels[i + nx * (j + 1 + ny * k)] : 0, k + 1 < nz ? m.labels[i + nx * (j + ny * (k + 1))] : 0]) {
            if (b && b !== a) pairs.add(a < b ? `${a},${b}` : `${b},${a}`);
          }
        }
    for (const key of pairs) {
      const [a, b] = key.split(',').map(Number);
      const pa = byId.get(a), pb = byId.get(b);
      let flat = false;
      for (let ax = 0; ax < 3; ax++) if (pa.thinAxes[ax] && pb.thinAxes[ax] && pa.box[LO[ax]] === pb.box[LO[ax]] && pa.box[HI[ax]] === pb.box[HI[ax]]) flat = true;
      if (!flat) continue;
      // 2枚を1枚にしてみて、消える線をしらべる
      const merged = m.labels.slice();
      for (let i = 0; i < merged.length; i++) if (merged[i] === b) merged[i] = a;
      const R2 = renderViews(merged, nx, ny, nz);
      const lines = [], ghost = [];
      let confirmed = false;
      for (const view of VIEW_NAMES)
        for (const kind of ['V', 'H']) {
          const drawn = P[view][kind], now = m.rendered[view][kind], then = R2[view][kind];
          for (let i = 0; i < drawn.length; i++) {
            if (now[i] === then[i]) continue;
            if (drawn[i] === DASH) confirmed = true; // つなぎ目のかくれ線がかいてある
            else if (drawn[i] === SOLID) lines.push({ view, kind, index: i });
            else if (now[i] === DASH) ghost.push({ view, kind, index: i });
          }
        }
      // つなぎ目が2つの図にかいてあれば（片方は、板の厚さを横切る短い線）、厚さを考えてかいた線
      if (confirmed || new Set(lines.map((l) => l.view)).size > 1) continue;
      const red = segsByView(lines), gh = segsByView(ghost);
      return { code: 'FLAT_SEAM', marks: VIEW_NAMES.map((view) => ({ view, segs: red[view], ghost: gh[view] })) };
    }
    return null;
  }

  /**
   * 板のはし（ほかの板にふれていない、板のふち）が、図面のほかの線でたしかめられるかをしらべる。
   * たな板などを線1本でかくと、「その線の所で板が終わっていて、その先には何もない」と読めてしまうことがある
   *（板の厚さを考えていない線）。その板を先までのばした立体でも、ほかの線がすべて合うなら、
   * その線が板のはしなのか、厚さをかきわすれた線なのかは、図面からは決められない。
   * 次のどちらかなら、板のはしだと分かるので通す。
   *   ・板のはしのかくれ線がかいてある（のばした立体には、その線がない）
   *   ・かいてあるかくれ線が、板のはしの所で終わっている（のばした立体なら、もっと先まで続くはず）
   *   ・板のはしが、2つの図に実線でかいてある（片方は、板の厚さを横切る短い線）
   */
  function looseEnd(m, d) {
    const { nx, ny, nz } = P;
    const dims = [nx, ny, nz];
    const AXES = { front: [0, 2], top: [0, 1], side: [1, 2] }; // 図のよこ・たてが、立体のどの向きか
    const at = (v) => v[0] + nx * (v[1] + ny * v[2]);
    // 部品ごとの範囲（まとめた方眼で）
    const boxes = new Map();
    const v = [0, 0, 0];
    for (v[2] = 0; v[2] < nz; v[2]++)
      for (v[1] = 0; v[1] < ny; v[1]++)
        for (v[0] = 0; v[0] < nx; v[0]++) {
          const id = m.labels[at(v)];
          if (!id) continue;
          let b = boxes.get(id);
          if (!b) { b = { lo: v.slice(), hi: v.slice(), count: 0 }; boxes.set(id, b); }
          for (let a = 0; a < 3; a++) { if (v[a] < b.lo[a]) b.lo[a] = v[a]; if (v[a] > b.hi[a]) b.hi[a] = v[a]; }
          b.count++;
        }

    // のばした立体 labels が、板のはし（向き ax・位置 edge の面）の線のほかは図面と合うか。合えば問題として返す
    const doubt = (labels, ax, edge) => {
      const R2 = renderViews(labels, nx, ny, nz);
      const lost = [], ghost = [];
      for (const view of VIEW_NAMES) {
        const nu = P[view].nu;
        for (const kind of ['V', 'H']) {
          const drawn = P[view][kind], now = m.rendered[view][kind], then = R2[view][kind];
          const axis = AXES[view][kind === 'V' ? 0 : 1], step = kind === 'V' ? nu + 1 : 1;
          for (let i = 0; i < drawn.length; i++) {
            if (then[i] === SOLID && drawn[i] !== SOLID) return null; // のばすと、図面にない線が見えてしまう
            if (drawn[i] === SOLID && then[i] !== SOLID) {
              // 消えてよいのは、板のはしの線だけ
              if (axis !== ax || (kind === 'V' ? i % (nu + 1) : Math.floor(i / nu)) !== edge) return null;
              lost.push({ view, kind, index: i });
            } else if (drawn[i] === DASH) {
              if (then[i] !== DASH) return null; // 板のはしのかくれ線がかいてある
              for (const n of [i - step, i + step]) {
                if (n < 0 || n >= drawn.length || (kind === 'H' && Math.floor(n / nu) !== Math.floor(i / nu))) continue;
                if (drawn[n] === NONE && then[n] === DASH && now[n] !== DASH) return null; // かくれ線が、板のはしで終わっている
              }
            } else if (drawn[i] === NONE && now[i] === DASH && then[i] !== DASH) ghost.push({ view, kind, index: i });
          }
        }
      }
      if (!lost.length || !ghost.length) return null;
      if (new Set(lost.map((l) => l.view)).size > 1) return null; // 板のはしが2つの図にかいてある
      const red = segsByView(lost), gh = segsByView(ghost);
      return { code: 'BOARD_END', marks: VIEW_NAMES.map((view) => ({ view, segs: red[view], ghost: gh[view] })) };
    };

    for (const p of d.parts) {
      const b = boxes.get(p.id);
      if (!b || !p.isBoard) continue;
      if (b.count !== (b.hi[0] - b.lo[0] + 1) * (b.hi[1] - b.lo[1] + 1) * (b.hi[2] - b.lo[2] + 1)) continue; // 切り欠きのある板はしらべない
      for (let ax = 0; ax < 3; ax++) {
        if (ax === p.axis) continue; // 厚さの向きにはのばさない
        const [a1, a2] = [0, 1, 2].filter((a) => a !== ax);
        for (const dir of [-1, 1]) {
          const labels = m.labels.slice();
          const edge = dir > 0 ? b.hi[ax] + 1 : b.lo[ax];
          for (let t = dir > 0 ? b.hi[ax] + 1 : b.lo[ax] - 1; t >= 0 && t < dims[ax]; t += dir) {
            // 先の1層がすべて空いていれば、板をそこまでのばしてみる
            const cells = [];
            const w = [0, 0, 0];
            w[ax] = t;
            let free = true;
            for (w[a1] = b.lo[a1]; w[a1] <= b.hi[a1] && free; w[a1]++)
              for (w[a2] = b.lo[a2]; w[a2] <= b.hi[a2]; w[a2]++) {
                if (labels[at(w)]) { free = false; break; }
                cells.push(at(w));
              }
            if (!free) break;
            for (const c of cells) labels[c] = p.id;
            const issue = doubt(labels, ax, edge);
            if (issue) return issue;
          }
        }
      }
    }
    return null;
  }
}

/** まっすぐ続く実線（図の外わくをのぞく）を、交点で区切らずに1本ずつならべる */
function solidStrokes(Pu) {
  const out = [];
  for (const view of VIEW_NAMES) {
    const v = Pu[view];
    for (let c = 1; c < v.nu; c++) {
      let q = 0;
      while (q < v.nv) {
        if (v.V[c + q * (v.nu + 1)] !== SOLID) { q++; continue; }
        const segs = [];
        while (q < v.nv && v.V[c + q * (v.nu + 1)] === SOLID) { segs.push(['V', c, q]); q++; }
        out.push({ view, segs });
      }
    }
    for (let c = 1; c < v.nv; c++) {
      let p = 0;
      while (p < v.nu) {
        if (v.H[p + c * v.nu] !== SOLID) { p++; continue; }
        const segs = [];
        while (p < v.nu && v.H[p + c * v.nu] === SOLID) { segs.push(['H', p, c]); p++; }
        out.push({ view, segs });
      }
    }
  }
  return out.sort((a, b) => a.segs.length - b.segs.length);
}

/**
 * 「板がぬけたようなすき間」の数。
 * 線でかこまれた板の形（厚さ T・たてよこは 2T 以上）の空間があり、その広い面に、
 * ほかの板の木口（はし）がつき当たっているとき、そこには板があると考えるのがふつう。
 * 例: たな板や仕切りが、奥の面から板1枚分だけ手前で止まっている → そこは背板。
 * （背板は正面図・平面図・右側面図のどれにも面が見えないので、図面からは「ある」とも「ない」とも読める。）
 */
function missingBoards(unit, W, D, H, parts, blobUnit, blobShapes, T) {
  const partById = new Map(parts.map((p) => [p.id, p]));
  const dims = [W, D, H];
  const LO = ['x0', 'y0', 'z0'], HI = ['x1', 'y1', 'z1'];
  let count = 0;
  for (const s of blobShapes) {
    if (!s.isBoard) continue;
    const ax = s.axis, o1 = (ax + 1) % 3, o2 = (ax + 2) % 3;
    if (s.size[o1] < 2 * T || s.size[o2] < 2 * T) continue;
    const pos = [0, 0, 0];
    let empty = true, butted = false;
    for (pos[o1] = s.box[LO[o1]]; pos[o1] < s.box[HI[o1]] && empty && !butted; pos[o1]++)
      for (pos[o2] = s.box[LO[o2]]; pos[o2] < s.box[HI[o2]] && empty && !butted; pos[o2]++) {
        pos[ax] = s.box[LO[ax]];
        const here = pos[0] + W * (pos[1] + D * pos[2]);
        if (blobUnit[here] !== s.id) continue;
        if (unit[here]) { empty = false; break; }
        // 広い面のすぐ外がわにある部品が、この面に「はし」を当てているか
        for (const side of [s.box[LO[ax]] - 1, s.box[HI[ax]]]) {
          if (side < 0 || side >= dims[ax]) continue;
          pos[ax] = side;
          const p = partById.get(unit[pos[0] + W * (pos[1] + D * pos[2])]);
          if (p && p.size[ax] > T) butted = true;
        }
      }
    if (empty && butted) count++;
  }
  return count;
}

/**
 * 1枚の板が、ほかの板の線の延長でたまたま2つに分かれてしまうことがある。
 * 同じ平面にならんだ板どうしをつなぐと1枚の長方形の板になり、
 * しかも図面がまったく変わらないなら、1枚の板にもどす。
 * （つないだ形がL字などになるときは、2枚の板のままにする。）
 */
function healSplits(labels, P, bx, by, bz, T) {
  const { nx, ny, nz } = P;
  const LO = ['x0', 'y0', 'z0'], HI = ['x1', 'y1', 'z1'];
  for (;;) {
    const { unit, W, D, H } = expandLabels(labels, bx, by, bz);
    const byId = new Map(analyzeParts(unit, W, D, H, T).map((p) => [p.id, p]));
    const pairs = new Set();
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const a = labels[i + nx * (j + ny * k)];
          if (!a) continue;
          for (const b of [i + 1 < nx ? labels[i + 1 + nx * (j + ny * k)] : 0, j + 1 < ny ? labels[i + nx * (j + 1 + ny * k)] : 0, k + 1 < nz ? labels[i + nx * (j + ny * (k + 1))] : 0]) {
            if (b && b !== a) pairs.add(a < b ? `${a},${b}` : `${b},${a}`);
          }
        }
    let next = null;
    for (const key of pairs) {
      const [a, b] = key.split(',').map(Number);
      const pa = byId.get(a), pb = byId.get(b);
      if (!pa.isBoard || !pb.isBoard) continue;
      // 厚さの方向と位置が同じ（同じ平面にならんでいる）か
      let slab = false;
      for (let ax = 0; ax < 3; ax++) if (pa.size[ax] === T && pb.size[ax] === T && pa.box[LO[ax]] === pb.box[LO[ax]] && pa.box[HI[ax]] === pb.box[HI[ax]]) slab = true;
      if (!slab) continue;
      // つないだ形が、すき間のない直方体になるか
      let vol = 1;
      for (let ax = 0; ax < 3; ax++) vol *= Math.max(pa.box[HI[ax]], pb.box[HI[ax]]) - Math.min(pa.box[LO[ax]], pb.box[LO[ax]]);
      if (vol !== pa.cells + pb.cells) continue;
      const trial = labels.slice();
      for (let i = 0; i < trial.length; i++) if (trial[i] === b) trial[i] = a;
      if (compareProblems(P, renderViews(trial, nx, ny, nz)).cost === 0) { next = trial; break; }
    }
    if (!next) return labels;
    labels = next;
  }
}

/** まとめた方眼の線分 → 1マス単位の線分のリスト（図の中の座標） */
function expandSeg(view, kind, index, bx, by, bz) {
  const [bu, bv] = view === 'front' ? [bx, bz] : view === 'top' ? [bx, by] : [by, bz];
  const nu = bu.length - 1;
  const segs = [];
  if (kind === 'V') {
    const c = index % (nu + 1), q = Math.floor(index / (nu + 1));
    for (let v = bv[q]; v < bv[q + 1]; v++) segs.push(['V', bu[c], v]);
  } else {
    const p = index % nu, c = Math.floor(index / nu);
    for (let u = bu[p]; u < bu[p + 1]; u++) segs.push(['H', u, bv[c]]);
  }
  return segs;
}

export { NONE, SOLID, DASH };
