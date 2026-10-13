// テスト用: 方眼用紙にえんぴつで図面をかき、カメラでとった「擬似的な写真」をつくる。

import { sheetPrimitives } from '../src/sheet/layout.js';
import { CODE_S0, CODE_DS, CODE_HEIGHT } from '../src/sheet/code.js';
import { GRID_MAJOR, GRID_EDGE } from '../src/sheet/templates.js';
import { CELL } from '../src/sheet/templates.js';
import { solveHomography, applyH } from '../src/reader/geometry.js';
import { SOLID, DASH } from '../src/core/model.js';
import { rng } from './helpers.js';

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * 用紙を res 画素/mm でえがく（文字ははぶく）。mono=true で白黒印刷のつもり。
 * oldGrid=true で、はじめの版の用紙（5マスごとの線 0.3mm・わくの線 0.35mm と太かった）にする。
 */
export function rasterSheet(tpl, settings, res, { mono = false, oldGrid = false, figure = null } = {}) {
  // figure: 用紙にはじめから印刷しておく図面
  const { pageW, pageH, items } = sheetPrimitives(tpl, settings, figure);
  if (oldGrid) for (const it of items) if (it.t === 'line') it.sw = it.sw === GRID_MAJOR ? 0.3 : it.sw === GRID_EDGE ? 0.35 : it.sw;
  const w = Math.round(pageW * res), h = Math.round(pageH * res);
  const rgb = new Float32Array(w * h * 3).fill(1);
  const fillRect = (x0, y0, x1, y1, col) => {
    x0 *= res; x1 *= res; y0 *= res; y1 *= res;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) {
      const cy = Math.min(y + 1, y1) - Math.max(y, y0);
      if (cy <= 0) continue;
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) {
        const cx = Math.min(x + 1, x1) - Math.max(x, x0);
        if (cx <= 0) continue;
        const a = cx * cy, o = (x + y * w) * 3;
        for (let c = 0; c < 3; c++) rgb[o + c] = rgb[o + c] * (1 - a) + col[c] * a;
      }
    }
  };
  const lineRect = (it) => {
    const col = hex(it.stroke), s = it.sw / 2;
    const horizontal = it.y1 === it.y2;
    const len = horizontal ? Math.abs(it.x2 - it.x1) : Math.abs(it.y2 - it.y1);
    const pieces = [];
    if (it.dash) { for (let t = 0; t < len; t += it.dash[0] + it.dash[1]) pieces.push([t, Math.min(len, t + it.dash[0])]); } else pieces.push([0, len]);
    for (const [a, b] of pieces) {
      if (horizontal) fillRect(Math.min(it.x1, it.x2) + a, it.y1 - s, Math.min(it.x1, it.x2) + b, it.y1 + s, col);
      else fillRect(it.x1 - s, Math.min(it.y1, it.y2) + a, it.x1 + s, Math.min(it.y1, it.y2) + b, col);
    }
  };
  for (const it of items) {
    if (it.t === 'rect') fillRect(it.x, it.y, it.x + it.w, it.y + it.h, hex(it.fill));
    else if (it.t === 'line') lineRect(it);
    else if (it.t === 'frame') {
      const s = { stroke: it.stroke, sw: it.sw };
      lineRect({ ...s, x1: it.x, y1: it.y, x2: it.x + it.w, y2: it.y });
      lineRect({ ...s, x1: it.x, y1: it.y + it.h, x2: it.x + it.w, y2: it.y + it.h });
      lineRect({ ...s, x1: it.x, y1: it.y, x2: it.x, y2: it.y + it.h });
      lineRect({ ...s, x1: it.x + it.w, y1: it.y, x2: it.x + it.w, y2: it.y + it.h });
    } else if (it.t === 'text') {
      // 文字のかわりに、うすい帯をおく
      const wdt = it.text.length * it.size * 0.8;
      const x0 = it.anchor === 'middle' ? it.x - wdt / 2 : it.anchor === 'end' ? it.x - wdt : it.x;
      const c = hex(it.fill).map((v) => 1 - (1 - v) * 0.35);
      fillRect(x0, it.y - it.size * 0.8, x0 + wdt, it.y, c);
    }
  }
  if (mono) for (let i = 0; i < w * h; i++) { const g = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]; rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = g; }
  return { w, h, rgb, res, tpl };
}

/** 用紙の設定コードを、べつのます目の列（0/1 の配列）にかきかえる（前の形式の用紙をつくるときに使う） */
export function repaintCode(raster, bits) {
  const { w, rgb, res, tpl } = raster;
  const [mx, my] = tpl.markers[0], span = tpl.markers[1][0] - mx;
  const paint = (x0, x1, v) => {
    for (let y = Math.round((my - CODE_HEIGHT / 2) * res) - 1; y <= Math.round((my + CODE_HEIGHT / 2) * res); y++)
      for (let x = Math.round(x0 * res); x < Math.round(x1 * res); x++) for (let c = 0; c < 3; c++) rgb[(x + y * w) * 3 + c] = v;
  };
  paint(mx + CODE_S0 * span - 0.5, mx + (CODE_S0 + bits.length * CODE_DS) * span + 0.5, 1);
  bits.forEach((b, i) => { if (b) paint(mx + (CODE_S0 + i * CODE_DS) * span, mx + (CODE_S0 + (i + 1) * CODE_DS) * span, 0); });
}

/** 図面の線を、えんぴつでかいたように重ねる */
export function drawPencil(raster, drawing, opts = {}) {
  const { seed = 1, thick = 0.6, color = [0.28, 0.28, 0.3], jitter = 0.3, dash = [3, 1.2], dashThick = 0.5 } = opts;
  const r = rng(seed);
  const { w, h, rgb, res, tpl } = raster;
  const stroke = (x1, y1, x2, y2, th) => {
    const hw = (th / 2) * res;
    x1 *= res; y1 *= res; x2 *= res; y2 *= res;
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
    for (let y = Math.max(0, Math.floor(Math.min(y1, y2) - hw - 1)); y <= Math.min(h - 1, Math.ceil(Math.max(y1, y2) + hw + 1)); y++)
      for (let x = Math.max(0, Math.floor(Math.min(x1, x2) - hw - 1)); x <= Math.min(w - 1, Math.ceil(Math.max(x1, x2) + hw + 1)); x++) {
        const px = x + 0.5 - x1, py = y + 0.5 - y1;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const d = Math.hypot(px - t * dx, py - t * dy);
        const a = Math.max(0, Math.min(1, hw + 0.5 - d));
        if (!a) continue;
        const o = (x + y * w) * 3;
        for (let c = 0; c < 3; c++) rgb[o + c] = Math.min(rgb[o + c], rgb[o + c] * (1 - a) + color[c] * a);
      }
  };
  const run = (x1, y1, x2, y2, type) => {
    // 手がきのずれ
    const j = () => (r() * 2 - 1) * jitter;
    const ox = j(), oy = j();
    x1 += ox + j() * 0.3; y1 += oy + j() * 0.3; x2 += ox + j() * 0.3; y2 += oy + j() * 0.3;
    if (type === SOLID) return stroke(x1, y1, x2, y2, thick * (0.85 + r() * 0.3));
    const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const on = dash[0] * (0.85 + r() * 0.3), off = dash[1] * (0.85 + r() * 0.3);
    for (let t = -r() * on * 0.5; t < len; t += on + off) {
      const a = Math.max(0, t), b = Math.min(len, t + on);
      if (b - a > 0.3) stroke(x1 + ux * a, y1 + uy * a, x1 + ux * b, y1 + uy * b, dashThick);
    }
  };
  for (const name of ['front', 'top', 'side']) {
    const b = tpl.boxes[name], v = drawing[name];
    const X = (u) => b.x + u * CELL, Y = (q) => b.y + b.h - q * CELL;
    // 同じ種類が続くところを1本の線としてかく
    for (let c = 0; c <= v.nu; c++) {
      let q = 0;
      while (q < v.nv) {
        const t = v.V[c + q * (v.nu + 1)];
        if (!t) { q++; continue; }
        let e = q;
        while (e < v.nv && v.V[c + e * (v.nu + 1)] === t) e++;
        run(X(c), Y(q), X(c), Y(e), t);
        q = e;
      }
    }
    for (let c = 0; c <= v.nv; c++) {
      let p = 0;
      while (p < v.nu) {
        const t = v.H[p + c * v.nu];
        if (!t) { p++; continue; }
        let e = p;
        while (e < v.nu && v.H[e + c * v.nu] === t) e++;
        run(X(p), Y(c), X(e), Y(c), t);
        p = e;
      }
    }
  }
  return raster;
}

/**
 * 紙を机において、カメラでとる。
 * opts: { width, height, tilt(0〜0.1: 台形のゆがみ), rotate(0〜3: 90度ずつ), fill(紙が写真にしめる割合),
 *         lens(たるゆがみ), blur, noise, shade(明るさのむら 0〜0.5), seed }
 */
export function photograph(raster, opts = {}) {
  const { width = 1800, height = 1350, tilt = 0.03, rotate = 0, fill = 0.9, lens = 0, blur = 0.7, noise = 0.012, shade = 0.2, seed = 7, spin = 0, chroma = 0, sharpen = 0, tint = null } = opts;
  const r = rng(seed);
  const { w, h, rgb, res } = raster;
  const pw = w / res, ph = h / res;
  // 写真の中の紙の四すみ
  const landscape = rotate % 2 === 0 ? pw > ph : ph > pw;
  let fw, fh;
  if (landscape) { fw = width * fill; fh = (fw * Math.min(pw, ph)) / Math.max(pw, ph); if (fh > height * fill) { fh = height * fill; fw = (fh * Math.max(pw, ph)) / Math.min(pw, ph); } }
  else { fh = height * fill; fw = (fh * Math.min(pw, ph)) / Math.max(pw, ph); if (fw > width * fill) { fw = width * fill; fh = (fw * Math.max(pw, ph)) / Math.min(pw, ph); } }
  const cx = width / 2, cy = height / 2;
  let corners = [[cx - fw / 2, cy - fh / 2], [cx + fw / 2, cy - fh / 2], [cx + fw / 2, cy + fh / 2], [cx - fw / 2, cy + fh / 2]];
  const ca = Math.cos(spin), sa = Math.sin(spin);
  corners = corners.map(([x, y]) => [cx + (x - cx) * ca - (y - cy) * sa + (r() * 2 - 1) * tilt * fw, cy + (x - cx) * sa + (y - cy) * ca + (r() * 2 - 1) * tilt * fh]);
  // 紙の四すみ（mm）。rotate で紙を回す
  const page = [[0, 0], [pw, 0], [pw, ph], [0, ph]];
  const src = [0, 1, 2, 3].map((i) => page[(i + 4 - rotate) % 4]);
  const toPage = solveHomography(corners, src);
  const out = new Float32Array(width * height * 3);
  const desk = [0.42, 0.34, 0.26];
  const sub = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  const rmax = Math.hypot(cx, cy);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const acc = [0, 0, 0];
      for (const [sx, sy] of sub) {
        let px = x + sx, py = y + sy;
        if (lens) { const dx = px - cx, dy = py - cy, rr = (dx * dx + dy * dy) / (rmax * rmax); px = cx + dx * (1 + lens * rr); py = cy + dy * (1 + lens * rr); }
        const [mx, my] = applyH(toPage, px, py);
        const fx = mx * res - 0.5, fy = my * res - 0.5;
        if (fx < 0 || fy < 0 || fx >= w - 1 || fy >= h - 1) { const n = 0.04 * Math.sin(px * 0.07 + py * 0.013); for (let c = 0; c < 3; c++) acc[c] += desk[c] + n; continue; }
        const ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy;
        const o = (ix + iy * w) * 3, o2 = o + w * 3;
        for (let c = 0; c < 3; c++) acc[c] += (rgb[o + c] * (1 - ax) + rgb[o + 3 + c] * ax) * (1 - ay) + (rgb[o2 + c] * (1 - ax) + rgb[o2 + 3 + c] * ax) * ay;
      }
      // 明るさのむら（左上が暗い）とまわりの暗さ
      const light = 1 - shade * (1 - (x / width) * 0.6 - (y / height) * 0.4) - shade * 0.3 * ((x - cx) ** 2 + (y - cy) ** 2) / (rmax * rmax);
      const o = (x + y * width) * 3;
      for (let c = 0; c < 3; c++) out[o + c] = (acc[c] / 4) * light * (c === 2 ? 0.96 : 1);
    }
  // ぼかし（横・縦に分けてかける）
  if (blur > 0) {
    const rad = Math.ceil(blur * 2.5), k = [];
    let ks = 0;
    for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * blur * blur)); k.push(v); ks += v; }
    const tmp = new Float32Array(out.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let i = -rad; i <= rad; i++) s += out[(Math.min(width - 1, Math.max(0, x + i)) + y * width) * 3 + c] * k[i + rad];
      tmp[(x + y * width) * 3 + c] = s / ks;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let i = -rad; i <= rad; i++) s += tmp[(x + Math.min(height - 1, Math.max(0, y + i)) * width) * 3 + c] * k[i + rad];
      out[(x + y * width) * 3 + c] = s / ks;
    }
  }
  // 小さなカメラ（Chromebook など）のくせ:
  //   chroma  … 色の情報が粗く、細い線の色がにじんで消える（水色の方眼が、灰色の線に写る）。にじむはば（画素）
  //   sharpen … りんかくを強める処理（線のわきが、紙より明るくなる）
  //   tint    … 色かぶり（[R, G, B] のかけ率）
  if (chroma > 0 || sharpen > 0) {
    const n = width * height;
    const box = (src, rad) => {
      const tmp = new Float32Array(n), dst = new Float32Array(n);
      for (let y = 0; y < height; y++) {
        let s = 0;
        for (let i = -rad; i <= rad; i++) s += src[Math.min(width - 1, Math.max(0, i)) + y * width];
        for (let x = 0; x < width; x++) { tmp[x + y * width] = s / (2 * rad + 1); s += src[Math.min(width - 1, x + rad + 1) + y * width] - src[Math.max(0, x - rad) + y * width]; }
      }
      for (let x = 0; x < width; x++) {
        let s = 0;
        for (let i = -rad; i <= rad; i++) s += tmp[x + Math.min(height - 1, Math.max(0, i)) * width];
        for (let y = 0; y < height; y++) { dst[x + y * width] = s / (2 * rad + 1); s += tmp[x + Math.min(height - 1, y + rad + 1) * width] - tmp[x + Math.max(0, y - rad) * width]; }
      }
      return dst;
    };
    let luma = new Float32Array(n);
    const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
      luma[i] = 0.299 * out[i * 3] + 0.587 * out[i * 3 + 1] + 0.114 * out[i * 3 + 2];
      for (let c = 0; c < 3; c++) ch[c][i] = out[i * 3 + c] - luma[i];
    }
    const soft = chroma > 0 ? ch.map((a) => box(a, Math.round(chroma))) : ch;
    if (sharpen > 0) {
      const wide = box(luma, 2), sharp = new Float32Array(n);
      for (let i = 0; i < n; i++) sharp[i] = luma[i] + sharpen * (luma[i] - wide[i]);
      luma = sharp;
    }
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = luma[i] + soft[c][i];
  }
  if (tint) for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] *= tint[c];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      const n = noise ? (r() + r() + r() - 1.5) * noise * 2 : 0;
      data[i * 4 + c] = Math.max(0, Math.min(255, Math.round((out[i * 3 + c] + n) * 255)));
    }
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

/** 2つの図面をくらべて、ちがう線分の数を数える */
export function diffDrawings(a, b) {
  const out = { missed: 0, extra: 0, type: 0, total: 0 };
  for (const name of ['front', 'top', 'side'])
    for (const k of ['V', 'H']) {
      const A = a[name][k], B = b[name][k];
      for (let i = 0; i < A.length; i++) {
        if (A[i]) out.total++;
        if (A[i] === B[i]) continue;
        if (A[i] && !B[i]) out.missed++; else if (!A[i] && B[i]) out.extra++; else out.type++;
      }
    }
  return out;
}

/** PPM 形式で保存できるバイト列（目で見てたしかめる用） */
export function toPPM(img) {
  const head = Buffer.from(`P6\n${img.width} ${img.height}\n255\n`);
  const body = Buffer.alloc(img.width * img.height * 3);
  for (let i = 0; i < img.width * img.height; i++) { body[i * 3] = img.data[i * 4]; body[i * 3 + 1] = img.data[i * 4 + 1]; body[i * 3 + 2] = img.data[i * 4 + 2]; }
  return Buffer.concat([head, body]);
}

export { DASH, SOLID };

/** PNG のバイト列（目で見てたしかめる用。Node 専用） */
export async function toPNG(img, scale = 1) {
  const zlib = await import('node:zlib');
  const w = Math.floor(img.width / scale), h = Math.floor(img.height / scale);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (x * scale + y * scale * img.width) * 4, d = y * (w * 3 + 1) + 1 + x * 3;
      raw[d] = img.data[s]; raw[d + 1] = img.data[s + 1]; raw[d + 2] = img.data[s + 2];
    }
  }
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type), body]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** PNG（8ビットの RGB / RGBA、インターレースなし）を読む。Node 専用 */
export async function fromPNG(buf) {
  const zlib = await import('node:zlib');
  let p = 8, width = 0, height = 0, type = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), name = buf.toString('latin1', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); type = body[9]; if (body[8] !== 8 || body[12] !== 0 || (type !== 2 && type !== 6)) throw new Error('この PNG は読めません'); }
    else if (name === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4] = out[i * bpp]; data[i * 4 + 1] = out[i * bpp + 1]; data[i * 4 + 2] = out[i * bpp + 2]; data[i * 4 + 3] = 255; }
  return { data, width, height };
}

/** 画像（RGBA）を、えんぴつでかきこめる「用紙」の形にする */
export function rasterFromImage(img, tpl) {
  const rgb = new Float32Array(img.width * img.height * 3);
  for (let i = 0; i < img.width * img.height; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = img.data[i * 4 + c] / 255;
  return { w: img.width, h: img.height, rgb, res: img.width / tpl.pageW, tpl };
}
