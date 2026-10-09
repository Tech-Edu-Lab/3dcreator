// src/icon.svg から、PNG のアイコン（src/icon-32.png, src/icon-180.png）をつくる。
// マークを変えたときだけ実行する:  node tools/icons.mjs
// （SVG のアイコンを出せないブラウザや、ホーム画面に追加したときのために PNG も入れている）
// 画像にするのにブラウザ（ヘッドレス Chromium）を使う。

import fs from 'node:fs';
import { launch } from './browser.mjs';

const svg = fs.readFileSync('src/icon.svg', 'utf8');
const browser = await launch();
try {
  for (const size of [32, 180]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body>`);
    await page.screenshot({ path: `src/icon-${size}.png`, omitBackground: true });
    await page.close();
    console.log(`src/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
