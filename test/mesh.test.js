import test from 'node:test';
import assert from 'node:assert/strict';

import { analyze } from '../src/core/analyze.js';
import { buildMeshes, stlBinary, checkClosed } from '../src/core/mesh.js';
import { zipStore, crc32 } from '../src/ui/save.js';
import { buildPdf } from '../src/sheet/pdf.js';
import { fromBoards, bookshelf } from './helpers.js';

/** 三角形の集まりの体積（面が外向きなら正） */
function volume(pos) {
  let v = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = pos.subarray(i, i + 9);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

test('立体の面: 板ごとにも、全体でも、すき間なく閉じている', () => {
  const list = [...bookshelf(), [1, 19, 2, 9, 7, 8]];
  const r = analyze(fromBoards(list, 20, 10, 14).drawing, { thickness: 1 });
  assert.equal(r.ok, true);
  const scale = 12;
  const m = buildMeshes(r.model.grid, scale);
  assert.deepEqual(m.size, [240, 120, 168]);
  assert.equal(m.parts.length, 5);
  let sum = 0;
  for (const p of m.parts) {
    assert.equal(checkClosed(p.positions).closed, true);
    const vol = volume(p.positions);
    assert.ok(vol > 0, '面が外を向いている');
    sum += vol;
    // 法線は面の向きと合っている
    for (let i = 0; i < p.positions.length; i += 9) {
      const a = p.positions.subarray(i, i + 3), b = p.positions.subarray(i + 3, i + 6), c = p.positions.subarray(i + 6, i + 9);
      const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      const dot = n[0] * p.normals[i] + n[1] * p.normals[i + 1] + n[2] * p.normals[i + 2];
      assert.ok(dot > 0);
    }
  }
  const cells = r.model.parts.reduce((s, p) => s + p.cells, 0);
  assert.ok(Math.abs(sum - cells * scale ** 3) < 1, '板の体積の合計');
  assert.equal(checkClosed(m.shell.positions).closed, true);
  assert.ok(Math.abs(volume(m.shell.positions) - cells * scale ** 3) < 1, '全体の体積');
});

test('STL: 大きさと三角形の数が合っている', () => {
  const r = analyze(fromBoards(bookshelf(), 20, 10, 14).drawing, { thickness: 1 });
  const m = buildMeshes(r.model.grid, 12);
  const buf = Buffer.from(stlBinary(m.shell.positions, m.shell.normals));
  const tris = buf.readUInt32LE(80);
  assert.equal(tris, m.shell.positions.length / 9);
  assert.equal(buf.length, 84 + tris * 50);
});

test('ZIP: 中のファイルを取り出せる形になっている', async () => {
  const zlib = await import('node:zlib');
  const body = new TextEncoder().encode('solid test\nendsolid test\n');
  const zip = Buffer.from(zipStore([{ name: 'rittai.stl', data: body }]));
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(14), zlib.crc32 ? zlib.crc32(body) : crc32(body));
  const nameLen = zip.readUInt16LE(26);
  assert.equal(zip.toString('utf8', 30, 30 + nameLen), 'rittai.stl');
  assert.deepEqual(zip.subarray(30 + nameLen, 30 + nameLen + body.length), Buffer.from(body));
  // 終わりの目印と、ファイルの数
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), 1);
  assert.equal(zip.readUInt32LE(zip.readUInt32LE(end + 16)), 0x02014b50);
});

test('PDF: 紙の大きさと、相互参照表の位置が正しい', () => {
  const data = new Uint8Array([1, 2, 3, 4, 5]);
  const pdf = Buffer.from(buildPdf(297, 210, { width: 2, height: 1, data, filter: 'FlateDecode' }));
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/MediaBox \[0 0 841\.89 595\.28\]/);
  const xref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
  assert.equal(text.slice(xref, xref + 4), 'xref');
  for (let n = 1; n <= 5; n++) {
    const off = Number(text.slice(xref).split('\n')[2 + n].slice(0, 10));
    assert.ok(text.slice(off).startsWith(`${n} 0 obj`), `オブジェクト ${n} の位置`);
  }
});
