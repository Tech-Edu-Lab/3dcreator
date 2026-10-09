// 1ページ・画像1枚だけの、かんたんな PDF をつくる（外部ライブラリなし）。
// 用紙（SVG）を高い解像度の画像にして、紙いっぱいにはりつける。

/**
 * pageWmm, pageHmm: 紙の大きさ (mm)
 * image: { width, height, data: Uint8Array, filter: 'FlateDecode' | 'DCTDecode' }
 *   FlateDecode … RGB の画素を zlib で圧縮したもの / DCTDecode … JPEG ファイルそのもの
 */
export function buildPdf(pageWmm, pageHmm, image) {
  const pt = (mm) => +((mm * 72) / 25.4).toFixed(2);
  const W = pt(pageWmm), H = pt(pageHmm);
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); length += b.length; };
  const obj = (n, body) => { offsets[n] = length; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };

  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.data.length} >>\nstream\n`);
    push(image.data);
    push('\nendstream');
  });
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  obj(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let n = 1; n <= 5; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

/** RGBA の画素 → zlib で圧縮した RGB（ブラウザの CompressionStream を使う）。使えなければ null */
export async function deflateRgb(rgba, width, height) {
  if (typeof CompressionStream === 'undefined') return null;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
  try {
    const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}
