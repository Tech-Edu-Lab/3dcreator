// 写真（JPEG / PNG）を読み取って、結果をたしかめる開発用の道具。
//   node tools/readphoto.mjs 写真 [出力フォルダ]
// 出力フォルダに、まっすぐに直した画像に読み取った線を重ねた overlay.png と、読み取った図面 drawing.json を書く。
// 画像を開くのにブラウザ（ヘッドレス Chromium）を使う。

import fs from 'node:fs';
import path from 'node:path';
import { launch } from './browser.mjs';
import { readSheet, readRes } from '../src/reader/reader.js';
import { getTemplate, CELL } from '../src/sheet/templates.js';
import { analyze } from '../src/core/analyze.js';
import { fromPNG, toPNG } from '../test/synth.js';

/** 画像ファイル → { data, width, height }（アプリと同じく、長い辺を 2800 画素までにちぢめる） */
export async function loadPhoto(file, maxSide = 2800) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const b64 = fs.readFileSync(file).toString('base64');
    const png = await page.evaluate(async ([data, max]) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes]));
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      return c.toDataURL('image/png').split(',')[1];
    }, [b64, maxSide]);
    return fromPNG(Buffer.from(png, 'base64'));
  } finally {
    await browser.close();
  }
}

/** まっすぐに直した画像に、読み取った線を重ねる（実線: 青、かくれ線: 赤、あやしい線: 黄色の点） */
export function overlay(res) {
  const { rectified, drawing, uncertain } = res;
  const { width, height, originMm } = rectified, k = rectified.res;
  const img = { width, height, data: Uint8ClampedArray.from(rectified.data) };
  const tpl = getTemplate(res.template);
  const put = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (x + y * width) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
  };
  for (const name of ['front', 'top', 'side']) {
    const b = tpl.boxes[name], v = drawing[name];
    const px = (u, w) => [(b.x + u * CELL - originMm[0]) * k, (b.y + b.h - w * CELL - originMm[1]) * k];
    const seg = (u0, v0, u1, v1, type, doubt) => {
      const [x0, y0] = px(u0, v0), [x1, y1] = px(u1, v1);
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      const color = doubt ? [240, 190, 0] : type === 1 ? [0, 90, 255] : [255, 0, 60];
      // 線のすぐ横にずらしてかく（元の線が見えるように）
      for (let i = 0; i <= n; i++) for (const d of [3, 4]) put(x0 + ((x1 - x0) * i) / n + (y0 === y1 ? 0 : d), y0 + ((y1 - y0) * i) / n + (y0 === y1 ? d : 0), color);
    };
    const doubtful = new Set((uncertain && uncertain[name] ? uncertain[name] : []).map((g) => g.join()));
    for (let q = 0; q < v.nv; q++) for (let c = 0; c <= v.nu; c++) { const t = v.V[c + q * (v.nu + 1)]; if (t) seg(c, q, c, q + 1, t, doubtful.has(`V,${c},${q}`)); }
    for (let c = 0; c <= v.nv; c++) for (let p = 0; p < v.nu; p++) { const t = v.H[p + c * v.nu]; if (t) seg(p, c, p + 1, c, t, doubtful.has(`H,${p},${c}`)); }
  }
  return img;
}

if (process.argv[1] && process.argv[1].endsWith('readphoto.mjs')) {
  const file = process.argv[2], out = process.argv[3] || '.';
  fs.mkdirSync(out, { recursive: true });
  const photo = await loadPhoto(file);
  const t0 = Date.now();
  const res = readSheet(photo);
  console.log(`写真 ${photo.width}×${photo.height} → ${res.ok ? '読めた' : `読めない (${res.code})`} ${Date.now() - t0}ms`);
  if (res.ok) {
    const count = { solid: 0, dash: 0, doubt: 0 };
    for (const n of ['front', 'top', 'side']) {
      for (const a of [res.drawing[n].V, res.drawing[n].H]) for (const t of a) { if (t === 1) count.solid++; else if (t === 2) count.dash++; }
      count.doubt += res.uncertain[n].length;
    }
    console.log(`用紙 ${getTemplate(res.template).name}, 設定 ${JSON.stringify(res.settings)}`);
    console.log(`1mm あたり ${res.pxPerMm.toFixed(2)} 画素（直した画像は ${readRes(getTemplate(res.template))} 画素/mm）, 注意 ${JSON.stringify(res.warnings)}`);
    console.log(`実線 ${count.solid} マス, かくれ線 ${count.dash} マス, あやしい線 ${count.doubt} マス`);
    const r = analyze(res.drawing, res.settings);
    console.log(`点検: ${r.ok ? `立体になった（板 ${r.model.parts.length} 枚）` : r.issues.map((i) => i.code).join(' + ')}`);
    fs.writeFileSync(path.join(out, 'overlay.png'), await toPNG(overlay(res)));
    const pack = (v) => ({ nu: v.nu, nv: v.nv, V: Array.from(v.V), H: Array.from(v.H) });
    fs.writeFileSync(path.join(out, 'drawing.json'), JSON.stringify({ front: pack(res.drawing.front), top: pack(res.drawing.top), side: pack(res.drawing.side) }));
  }
}
