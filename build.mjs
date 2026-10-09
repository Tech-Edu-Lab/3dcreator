// ビルド: src/ のプログラムを1つにまとめ、HTML 1ファイルにする。
//
//   dist/index.html    … そのまま開けるアプリ本体（ネット接続なしで動く。学校のサーバや共有フォルダに置ける）
//   dist/artifact.html … claude.ai のアーティファクトとして公開するときの形（中身は同じ）
//   index.html         … 公開ページ（GitHub Pages）の入口。dist/index.html へ送るだけ

import { build } from 'esbuild';
import fs from 'node:fs';

const TITLE = '正投影図 3Dクリエイター';
const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['es2020'],
  legalComments: 'eof',
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('src/app.css', 'utf8');
const body = fs.readFileSync('src/app.html', 'utf8');

// ブラウザのタブに出すマーク（画面左上のマークと同じ形）。1ファイルで動くように、中にうめこむ
const b64 = (file) => fs.readFileSync(file).toString('base64');
const icons = `<link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,${b64('src/icon-32.png')}">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${b64('src/icon.svg')}">
<link rel="apple-touch-icon" href="data:image/png;base64,${b64('src/icon-180.png')}">`;

const page = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${TITLE}</title>
${icons}
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${js}
</script>
</body>
</html>
`;
const fragment = `<title>${TITLE}</title>
<style>
${css}
</style>
${body}
<script>
${js}
</script>
`;
// 公開ページ（GitHub Pages）の入口。アプリ本体（dist/index.html）へ送るだけ
const entrance = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${TITLE}</title>
${icons}
<meta http-equiv="refresh" content="0; url=dist/index.html">
<script>location.replace('dist/index.html' + location.search + location.hash);</script>
</head>
<body>
<p><a href="dist/index.html">${TITLE}を開く</a></p>
</body>
</html>
`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', page);
fs.writeFileSync('dist/artifact.html', fragment);
fs.writeFileSync('index.html', entrance);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/index.html ${kb(page)}  (JS ${kb(js)}, CSS ${kb(css)})`);
