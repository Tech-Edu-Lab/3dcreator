// ビルド: src/ のプログラムを1つにまとめ、HTML 1ファイルにする。
//
//   dist/index.html    … そのまま開けるアプリ本体（ネット接続なしで動く。学校のサーバや共有フォルダに置ける）
//   dist/artifact.html … claude.ai のアーティファクトとして公開するときの形（中身は同じ）

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

const page = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${TITLE}</title>
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
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', page);
fs.writeFileSync('dist/artifact.html', fragment);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/index.html ${kb(page)}  (JS ${kb(js)}, CSS ${kb(css)})`);
