// 立体（マスごとの部品番号）から、3D表示・保存用の三角形をつくる。
//
// 座標は立体の座標 (x:左右, y:前後, z:上下) で、単位は mm。
// 面は「線のある位置」で区切った方眼の面をそのまま使うので、
// となり合う面どうしの辺がぴったり一致する（すき間のない閉じた形になる）。

// 面の向きごとの4頂点（外から見て反時計回り）。[x,y,z] は 0=小さい側 / 1=大きい側。
const FACES = [
  { n: [1, 0, 0], d: [1, 0, 0], q: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], d: [-1, 0, 0], q: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], d: [0, 1, 0], q: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], d: [0, -1, 0], q: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], d: [0, 0, 1], q: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], d: [0, 0, -1], q: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

/**
 * grid: { labels, nx, ny, nz, bx, by, bz }（analyze の model.grid）
 * ruler: 方眼の線 → 実物の位置 (mm) の対応。{ x, y, z }（ruler.js の coords）。
 *        数を1つわたすと、どのマスも同じ大きさ（その数 mm）としてあつかう。
 * もどり値:
 *   parts: [{ id, positions, normals }]  部品ごとの閉じた面（部品どうしの合わせ目もふくむ）
 *   shell: { positions, normals }        全体を1つにまとめた外側の面（3Dプリンタ用）
 *   size:  [x, y, z] 全体の大きさ (mm)
 */
export function buildMeshes(grid, ruler) {
  const { labels, nx, ny, nz, bx, by, bz } = grid;
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : labels[i + nx * (j + ny * k)]);
  const pos = typeof ruler === 'number'
    ? [Array.from(bx, (u) => u * ruler), Array.from(by, (u) => u * ruler), Array.from(bz, (u) => u * ruler)]
    : [Array.from(bx, (u) => ruler.x[u]), Array.from(by, (u) => ruler.y[u]), Array.from(bz, (u) => ruler.z[u])];
  const perPart = new Map();
  const shell = { pos: [], nrm: [] };
  const push = (buf, lo, hi, f) => {
    const c = f.q.map(([a, b, cc]) => [a ? hi[0] : lo[0], b ? hi[1] : lo[1], cc ? hi[2] : lo[2]]);
    for (const t of [0, 1, 2, 0, 2, 3]) { buf.pos.push(c[t][0], c[t][1], c[t][2]); buf.nrm.push(f.n[0], f.n[1], f.n[2]); }
  };
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const id = labels[i + nx * (j + ny * k)];
        if (!id) continue;
        const lo = [pos[0][i], pos[1][j], pos[2][k]], hi = [pos[0][i + 1], pos[1][j + 1], pos[2][k + 1]];
        let buf = perPart.get(id);
        if (!buf) { buf = { pos: [], nrm: [] }; perPart.set(id, buf); }
        for (const f of FACES) {
          const other = at(i + f.d[0], j + f.d[1], k + f.d[2]);
          if (other !== id) push(buf, lo, hi, f);
          if (!other) push(shell, lo, hi, f);
        }
      }
  const pack = (b) => ({ positions: Float32Array.from(b.pos), normals: Float32Array.from(b.nrm) });
  return {
    parts: [...perPart.entries()].sort((a, b) => a[0] - b[0]).map(([id, b]) => ({ id, ...pack(b) })),
    shell: pack(shell),
    size: [pos[0][nx], pos[1][ny], pos[2][nz]],
  };
}

/** バイナリSTL（単位 mm、Z が上） */
export function stlBinary(positions, normals, title = '3D Creator') {
  const tris = positions.length / 9;
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  for (let i = 0; i < Math.min(79, title.length); i++) dv.setUint8(i, title.charCodeAt(i) & 0x7f);
  dv.setUint32(80, tris, true);
  let o = 84;
  for (let t = 0; t < tris; t++) {
    for (let a = 0; a < 3; a++) dv.setFloat32(o + a * 4, normals[t * 9 + a], true);
    for (let v = 0; v < 9; v++) dv.setFloat32(o + 12 + v * 4, positions[t * 9 + v], true);
    o += 50;
  }
  return buf;
}

/**
 * 三角形の集まりが「閉じた形」か点検する（どの辺も、ちょうど2枚の面に、逆向きではさまれている）。
 * もどり値: { closed, edges, bad }
 */
export function checkClosed(positions) {
  const key = (i) => `${positions[i]},${positions[i + 1]},${positions[i + 2]}`;
  const edges = new Map();
  for (let t = 0; t < positions.length; t += 9) {
    const v = [key(t), key(t + 3), key(t + 6)];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(k, (edges.get(k) || 0) + (a < b ? 1 : -1) + 1000);
    }
  }
  let bad = 0;
  for (const v of edges.values()) {
    const count = Math.round(v / 1000), balance = v - count * 1000;
    if (count % 2 !== 0 || balance !== 0) bad++;
  }
  return { closed: bad === 0, edges: edges.size, bad };
}
