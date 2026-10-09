// dist/ を http://localhost:8080 で配る、かんたんなサーバ（同じ Wi-Fi のタブレットなどでためすとき用）。
//   node tools/serve.mjs [ポート番号]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'dist');
const port = Number(process.argv[2]) || 8080;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.pdf': 'application/pdf' };

http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(dist, name === '/' ? 'index.html' : name);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`http://localhost:${port}/ で開けます`);
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`同じネットワークの端末からは http://${a.address}:${port}/`);
});
