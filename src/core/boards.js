// 部品（板）の調査: 大きさ・「板になっているか」・ほかの板にふれているか
//
// 「板」とは: ある1つの向きの厚さがちょうど板厚 T マスで、その向きにまっすぐな形（どこで切っても同じ断面）。
// 板でないものは、次の3つに分ける。
//   thick  … 板厚より厚い「かたまり」をふくむ（板の厚さを考えていない）
//   thin   … 板厚よりうすい部分がある
//   joined … 板がいくつかつながった形（つなぎ目がないので、組み立て方が分からない）

/**
 * unit: 1マス単位の部品番号（0 = 空間）, 大きさ W×D×H, T: 板厚（マス）
 * もどり値: 部品のリスト
 */
export function analyzeParts(unit, W, D, H, T) {
  const idx = (x, y, z) => x + W * (y + D * z);
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= W || y >= D || z >= H ? 0 : unit[idx(x, y, z)]);
  const byId = new Map();
  for (let z = 0; z < H; z++)
    for (let y = 0; y < D; y++)
      for (let x = 0; x < W; x++) {
        const id = unit[idx(x, y, z)];
        if (!id) continue;
        let p = byId.get(id);
        if (!p) { p = { id, count: 0, x0: x, x1: x, y0: y, y1: y, z0: z, z1: z }; byId.set(id, p); }
        p.count++;
        if (x < p.x0) p.x0 = x; if (x > p.x1) p.x1 = x;
        if (y < p.y0) p.y0 = y; if (y > p.y1) p.y1 = y;
        if (z < p.z0) p.z0 = z; if (z > p.z1) p.z1 = z;
      }
  const parts = [];
  for (const p of byId.values()) {
    const ex = p.x1 - p.x0 + 1, ey = p.y1 - p.y0 + 1, ez = p.z1 - p.z0 + 1;
    // 断面の数（その向きから見た影のマス数）
    const shadow = [0, 0, 0];
    for (let z = p.z0; z <= p.z1; z++)
      for (let y = p.y0; y <= p.y1; y++) { let f = false; for (let x = p.x0; x <= p.x1 && !f; x++) f = unit[idx(x, y, z)] === p.id; if (f) shadow[0]++; }
    for (let z = p.z0; z <= p.z1; z++)
      for (let x = p.x0; x <= p.x1; x++) { let f = false; for (let y = p.y0; y <= p.y1 && !f; y++) f = unit[idx(x, y, z)] === p.id; if (f) shadow[1]++; }
    for (let y = p.y0; y <= p.y1; y++)
      for (let x = p.x0; x <= p.x1; x++) { let f = false; for (let z = p.z0; z <= p.z1 && !f; z++) f = unit[idx(x, y, z)] === p.id; if (f) shadow[2]++; }
    const ext = [ex, ey, ez];
    // 板の向き（厚さの方向）をさがす。広い面が大きい向きを優先。
    // thinAxes: 厚さがちょうど板厚になっている向きすべて（角材のように2方向が板厚のこともある）
    let axis = -1;
    const thinAxes = [false, false, false];
    for (let a = 0; a < 3; a++) {
      if (ext[a] !== T || p.count !== shadow[a] * T) continue;
      thinAxes[a] = true;
      if (axis < 0 || shadow[a] > shadow[axis]) axis = a;
    }
    const part = {
      id: p.id, cells: p.count,
      box: { x0: p.x0, x1: p.x1 + 1, y0: p.y0, y1: p.y1 + 1, z0: p.z0, z1: p.z1 + 1 },
      size: ext, isBoard: axis >= 0, axis, thinAxes, kind: 'board',
      rect: p.count === ex * ey * ez, // 切り欠きのない直方体か
    };
    if (axis < 0) part.kind = classify(p, T, at);
    parts.push(part);
  }
  parts.sort((a, b) => a.id - b.id);
  return parts;
}

function classify(p, T, at) {
  // 板厚より大きい立方体が入るなら「かたまり」
  const n = T + 1;
  for (let z = p.z0; z + n - 1 <= p.z1; z++)
    for (let y = p.y0; y + n - 1 <= p.y1; y++)
      for (let x = p.x0; x + n - 1 <= p.x1; x++) {
        let full = true;
        for (let dz = 0; dz < n && full; dz++)
          for (let dy = 0; dy < n && full; dy++)
            for (let dx = 0; dx < n && full; dx++) if (at(x + dx, y + dy, z + dz) !== p.id) full = false;
        if (full) return 'thick';
      }
  // どの向きにも T マス続かないところがあれば「うすい」
  if (T > 1) {
    const run = (x, y, z, dx, dy, dz) => {
      let len = 1;
      for (let s = 1; at(x + dx * s, y + dy * s, z + dz * s) === p.id; s++) len++;
      for (let s = 1; at(x - dx * s, y - dy * s, z - dz * s) === p.id; s++) len++;
      return len;
    };
    for (let z = p.z0; z <= p.z1; z++)
      for (let y = p.y0; y <= p.y1; y++)
        for (let x = p.x0; x <= p.x1; x++) {
          if (at(x, y, z) !== p.id) continue;
          if (Math.min(run(x, y, z, 1, 0, 0), run(x, y, z, 0, 1, 0), run(x, y, z, 0, 0, 1)) < T) return 'thin';
        }
  }
  return 'joined';
}

/**
 * 面でふれ合っている部品どうしをグループにする。
 * もどり値: グループのリスト（大きい順）。グループが2つ以上なら、宙にういた部品がある。
 */
export function partGroups(unit, W, D, H) {
  const idx = (x, y, z) => x + W * (y + D * z);
  const parent = new Map();
  const size = new Map();
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  const add = (a) => { if (!parent.has(a)) { parent.set(a, a); size.set(a, 0); } };
  for (let z = 0; z < H; z++)
    for (let y = 0; y < D; y++)
      for (let x = 0; x < W; x++) {
        const a = unit[idx(x, y, z)];
        if (!a) continue;
        add(a); size.set(a, size.get(a) + 1);
        const nbs = [x + 1 < W ? unit[idx(x + 1, y, z)] : 0, y + 1 < D ? unit[idx(x, y + 1, z)] : 0, z + 1 < H ? unit[idx(x, y, z + 1)] : 0];
        for (const b of nbs) {
          if (!b || b === a) continue;
          add(b);
          const ra = find(a), rb = find(b);
          if (ra !== rb) parent.set(ra, rb);
        }
      }
  const groups = new Map();
  for (const id of parent.keys()) {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, { ids: [], cells: 0 });
    const g = groups.get(r);
    g.ids.push(id); g.cells += size.get(id);
  }
  return [...groups.values()].sort((a, b) => b.cells - a.cells);
}

/** ブロブごとに「板厚より厚いかたまり」かどうか（そういうブロブは板の一部になれない） */
export function thickBlobs(blobUnit, W, D, H, nb, T) {
  const thick = new Uint8Array(nb + 1);
  const n = T + 1;
  const idx = (x, y, z) => x + W * (y + D * z);
  for (let z = 0; z + n <= H; z++)
    for (let y = 0; y + n <= D; y++)
      for (let x = 0; x + n <= W; x++) {
        const id = blobUnit[idx(x, y, z)];
        if (!id || thick[id]) continue;
        let full = true;
        for (let dz = 0; dz < n && full; dz++)
          for (let dy = 0; dy < n && full; dy++)
            for (let dx = 0; dx < n && full; dx++) if (blobUnit[idx(x + dx, y + dy, z + dz)] !== id) full = false;
        if (full) thick[id] = 1;
      }
  return thick;
}
