// 方眼用紙の写真・スキャン画像から、かかれた線を読み取る。
//
//  1. 四すみの■マーク（黒・白・黒の三重の四角）をさがす
//  2. 設定コードを読んで、紙の向き・用紙の種類・設定を知る
//  3. 紙をまっすぐに直した画像（補正画像）をつくる
//  4. 方眼の線分1つずつについて、えんぴつの線があるか、実線か破線かをしらべる
//
// ブラウザでもテスト（Node）でも動くように、画像は { data: RGBA, width, height } で受けとる。

import { NONE, SOLID, DASH, makeView } from '../core/model.js';
import { getTemplate, mmToUnit, CELL, TEMPLATES, DEFAULT_SETTINGS } from '../sheet/templates.js';
import { decodeCode, CODE_CELLS, CODE_S0, CODE_DS } from '../sheet/code.js';
import { toGray, estimateBackground, binarize, components, percentile } from './image.js';
import { solveHomography, applyH, quadArea } from './geometry.js';

// 補正画像の細かさ (画素/mm)。大きい紙（A3）は、画素数がふえすぎないように少し粗くする。
export function readRes(tpl) {
  return tpl.pageW * tpl.pageH > 70000 ? 6 : 8;
}
const PAD = 2; // 方眼のまわりに余分にとる幅 (mm)

/**
 * img: { data, width, height }（RGBA）
 * opts.fallback: コードが読めないときに使う設定 { template, scaleMm, boardMm, thickness, boardCheck, hiddenLines }
 * もどり値: 成功 { ok:true, template, settings, drawing, uncertain, rectified, warnings }
 *           失敗 { ok:false, code, message }
 */
export function readSheet(img, opts = {}) {
  const { width: w, height: h, data } = img;
  if (!w || !h) return failure('NO_IMAGE');
  const gray = toGray(data, w * h);
  const tile = Math.max(24, Math.round(Math.max(w, h) / 24));
  const bg = estimateBackground(gray, w, h, tile, 0.8);
  const bin = binarize(gray, w, h, bg, 0.55);

  // 1. マーク
  const marks = findMarkers(components(bin, w, h), w, h);
  if (marks.length < 4) return failure('NO_MARKERS', { found: marks.length });
  const quad = pickQuad(marks);
  if (!quad) return failure('NO_MARKERS', { found: marks.length });

  // 2. 向きと設定
  const unit = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const ratioAt = (x, y, r) => {
    let s = 0, c = 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const xx = Math.round(x + dx), yy = Math.round(y + dy);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        s += gray[xx + yy * w] / Math.max(1, bg.at(xx, yy)); c++;
      }
    return c ? s / c : 1;
  };
  let H = null, settings = null;
  const warnings = [];
  // 設定コードを読む。紙のそりやレンズのゆがみで位置が少しずれていても読めるように、
  // (1) まず計算どおりの位置で、(2) だめなら、ます目の上下をさがしたり、左右に少しずらしたりして読む。
  const sizes = marks.map((m) => m.size).sort((p, q) => p - q);
  const pxMm = sizes[sizes.length >> 1] / 10.5; // マークの一辺は 10.5mm
  const readStrip = (Hc, scan, shift, stretch) => {
    const bits = [];
    let black = 0; // はっきり黒います目の数
    for (let i = 0; i < CODE_CELLS; i++) {
      const s0 = CODE_S0 + ((i + 0.5) * stretch + shift) * CODE_DS;
      const [x, y] = applyH(Hc, s0, 0);
      const [x2, y2] = applyH(Hc, s0 + CODE_DS, 0);
      const r = Math.max(1, Math.min(4, Math.floor(Math.hypot(x2 - x, y2 - y) * 0.22)));
      let v = ratioAt(x, y, r);
      if (scan) {
        const [xn, yn] = applyH(Hc, s0, 0.02);
        const len = Math.hypot(xn - x, yn - y) || 1, nx = (xn - x) / len, ny = (yn - y) / len;
        for (let d = -4; d <= 4; d++) if (d) v = Math.min(v, ratioAt(x + nx * d * pxMm, y + ny * d * pxMm, r));
      }
      bits.push(v < 0.6 ? 1 : 0);
      if (v < 0.45) black++;
    }
    return { bits, black };
  };
  const tries = [[false, 0, 1]];
  for (const stretch of [1, 0.985, 1.015]) for (const shift of [0, -0.3, 0.3, -0.6, 0.6]) tries.push([true, shift, stretch]);
  const rotations = [0, 1, 2, 3].map((rot) => solveHomography(unit, [0, 1, 2, 3].map((i) => quad[(i + rot) % 4])));
  for (const [scan, shift, stretch] of tries) {
    for (let rot = 0; rot < 4 && !settings; rot++) {
      if (!rotations[rot]) continue;
      const dec = decodeCode(readStrip(rotations[rot], scan, shift, stretch).bits);
      if (dec && TEMPLATES.some((t) => t.id === dec.template)) {
        // 前の形式の用紙には、かくれ線のかき方が入っていない → 画面の設定のまま
        if (!dec.hiddenLines) dec.hiddenLines = (opts.fallback && opts.fallback.hiddenLines) || DEFAULT_SETTINGS.hiddenLines;
        settings = dec; H = rotations[rot];
      }
    }
    if (settings) break;
  }
  if (!settings) {
    // コードが読めない: 画面で選ばれている設定を使う。
    // 紙の向きは、黒います目がならんでいる辺（コードのある辺）を上とみなす。
    // どの辺にもます目が見えない（コードがかくれている）ときは、写真の上を紙の上とみなす。
    const fb = opts.fallback || DEFAULT_SETTINGS;
    const tplF = getTemplate(fb.template);
    const cands = [];
    for (let rot = 0; rot < 4; rot++) {
      if (!rotations[rot]) continue;
      const c = [0, 1, 2, 3].map((i) => quad[(i + rot) % 4]);
      const wide = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) > Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]);
      if (wide !== tplF.landscape) continue;
      cands.push({ rot, black: readStrip(rotations[rot], true, 0, 1).black, corner: c[0][0] + c[0][1] });
    }
    let bestRot = -1;
    if (cands.length) {
      const byBlack = [...cands].sort((p, q) => q.black - p.black);
      if (byBlack[0].black >= 6 && (byBlack.length < 2 || byBlack[0].black - byBlack[1].black >= 3)) bestRot = byBlack[0].rot;
      else bestRot = [...cands].sort((p, q) => p.corner - q.corner)[0].rot; // 左上に近いマークを、紙の左上とする
    }
    if (bestRot < 0) return failure('NO_MARKERS', { found: marks.length });
    H = rotations[bestRot];
    settings = { template: fb.template, scaleMm: fb.scaleMm, boardMm: fb.boardMm, thickness: fb.thickness, boardCheck: fb.boardCheck, hiddenLines: fb.hiddenLines || 'needed' };
    warnings.push('CODE_UNREADABLE');
  }
  const tpl = getTemplate(settings.template);

  // 3. 補正画像
  const R = readRes(tpl);
  const ox = tpl.area.x - PAD, oy = tpl.area.y - PAD;
  const rw = Math.round((tpl.area.w + 2 * PAD) * R), rh = Math.round((tpl.area.h + 2 * PAD) * R);
  const rect = rectify(data, w, h, H, tpl, ox, oy, rw, rh, R);
  const pxPerMm = Math.hypot(...sub(applyH(H, ...mmToUnit(tpl, ox + 10, oy)), applyH(H, ...mmToUnit(tpl, ox, oy)))) / 10;
  if (pxPerMm < 2.5) warnings.push('LOW_RESOLUTION');

  // 4. 線の読み取り
  const { ink, red } = inkMap(rect, rw, rh, R);
  const shift = gridShift(red, rw, rh, tpl, ox, oy, R);
  const { drawing, uncertain, total } = readLines(ink, rw, rh, tpl, ox, oy, R, shift);
  if (!total) warnings.push('NO_LINES');

  return {
    ok: true,
    template: tpl.id,
    settings,
    drawing,
    uncertain,
    warnings,
    pxPerMm,
    rectified: { data: toRGBA(rect, rw, rh), width: rw, height: rh, res: R, originMm: [ox, oy] },
  };
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }

function failure(code, extra = {}) {
  const message = {
    NO_IMAGE: '画像を開けませんでした。',
    NO_MARKERS: '用紙の四すみの■マークが見つかりませんでした。四すみが全部うつるように、明るい場所で真上からとり直してください。',
  }[code];
  return { ok: false, code, message, ...extra };
}

/** 黒いかたまりの中から、三重の四角（輪と中心）の組をさがす */
export function findMarkers(comps, w, h) {
  const maxSize = Math.max(w, h) / 5;
  const rings = [], cores = [];
  for (const c of comps) {
    const cw = c.maxX - c.minX + 1, ch = c.maxY - c.minY + 1;
    const size = Math.max(cw, ch);
    if (size > maxSize || Math.min(cw, ch) / size < 0.45) continue;
    const fill = c.area / (cw * ch);
    c.size = size; c.bx = (c.minX + c.maxX) / 2; c.by = (c.minY + c.maxY) / 2;
    if (size >= 12 && fill >= 0.2 && fill <= 0.72) rings.push(c);
    if (size >= 4 && fill >= 0.45) cores.push(c);
  }
  const found = [];
  for (const r of rings) {
    if (Math.hypot(r.cx - r.bx, r.cy - r.by) > 0.12 * r.size) continue;
    let best = null, bestScore = Infinity;
    for (const c of cores) {
      if (c === r || c.minX <= r.minX || c.maxX >= r.maxX || c.minY <= r.minY || c.maxY >= r.maxY) continue;
      const ratio = Math.sqrt(c.area / r.area); // 正しくは √(9/24) ≒ 0.61
      const sizeRatio = c.size / r.size; // 正しくは 3/7 ≒ 0.43
      const off = Math.hypot(c.cx - r.cx, c.cy - r.cy) / r.size;
      if (ratio < 0.4 || ratio > 0.85 || sizeRatio < 0.28 || sizeRatio > 0.6 || off > 0.12) continue;
      const score = Math.abs(ratio - 0.61) + Math.abs(sizeRatio - 0.43) + off;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (best) found.push({ x: (r.cx + best.cx) / 2, y: (r.cy + best.cy) / 2, size: r.size, score: bestScore });
  }
  return found;
}

/** マークの候補から、紙の四すみにあたる4つをえらび、時計回りにならべる */
export function pickQuad(marks) {
  let cand = marks;
  if (cand.length > 8) cand = [...cand].sort((a, b) => a.score - b.score).slice(0, 8);
  let best = null, bestArea = 0;
  const n = cand.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++) {
          const four = [cand[a], cand[b], cand[c], cand[d]];
          const sizes = four.map((m) => m.size);
          if (Math.max(...sizes) / Math.min(...sizes) > 2.6) continue;
          const mx = four.reduce((s, m) => s + m.x, 0) / 4, my = four.reduce((s, m) => s + m.y, 0) / 4;
          const pts = four.map((m) => [m.x, m.y]).sort((p, q) => Math.atan2(p[1] - my, p[0] - mx) - Math.atan2(q[1] - my, q[0] - mx));
          const area = Math.abs(quadArea(pts));
          if (area > bestArea) { bestArea = area; best = pts; }
        }
  return best;
}

/** 紙をまっすぐに直した画像（RGB、各 0〜255 の Float32Array）をつくる */
function rectify(data, w, h, H, tpl, ox, oy, rw, rh, R) {
  const out = [new Float32Array(rw * rh), new Float32Array(rw * rh), new Float32Array(rw * rh)];
  const [mx0, my0] = tpl.markers[0], [mx1, my1] = tpl.markers[2];
  const ku = 1 / (mx1 - mx0), kv = 1 / (my1 - my0);
  for (let y = 0; y < rh; y++) {
    const t = (oy + (y + 0.5) / R - my0) * kv;
    for (let x = 0; x < rw; x++) {
      const s = (ox + (x + 0.5) / R - mx0) * ku;
      const den = H[6] * s + H[7] * t + H[8];
      const sx = (H[0] * s + H[1] * t + H[2]) / den - 0.5, sy = (H[3] * s + H[4] * t + H[5]) / den - 0.5;
      const o = x + y * rw;
      if (sx < 0 || sy < 0 || sx >= w - 1 || sy >= h - 1) { out[0][o] = out[1][o] = out[2][o] = 255; continue; }
      const ix = sx | 0, iy = sy | 0, ax = sx - ix, ay = sy - iy;
      const p = (ix + iy * w) * 4, q = p + w * 4;
      const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
      for (let c = 0; c < 3; c++) out[c][o] = data[p + c] * w00 + data[p + 4 + c] * w10 + data[q + c] * w01 + data[q + 4 + c] * w11;
    }
  }
  return out;
}

function toRGBA(rect, rw, rh) {
  const out = new Uint8ClampedArray(rw * rh * 4);
  for (let i = 0, p = 0; i < rw * rh; i++, p += 4) { out[p] = rect[0][i]; out[p + 1] = rect[1][i]; out[p + 2] = rect[2][i]; out[p + 3] = 255; }
  return out;
}

/**
 * 「インクのこさ」の画像（0〜1）。
 * 色ごとに紙の地とくらべた暗さを出し、3色のまん中の値をとる。
 * 水色の方眼の線は赤だけが暗いので消え、えんぴつ（3色とも暗い）や色ペン（2色が暗い）は残る。
 * あわせて、印刷された方眼がよく見える「赤の暗さ」も返す（位置合わせ用）。
 */
function inkMap(rect, rw, rh, R) {
  const tile = Math.round(12 * R);
  const bgs = rect.map((ch) => estimateBackground(ch, rw, rh, tile, 0.8));
  const ink = new Float32Array(rw * rh), red = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++)
    for (let x0 = 0; x0 < rw; x0 += 16) {
      const x1 = Math.min(rw - 1, x0 + 16);
      const b0 = bgs.map((b) => b.at(x0, y)), b1 = bgs.map((b) => b.at(x1, y));
      const lim = Math.min(rw, x0 + 16);
      for (let x = x0; x < lim; x++) {
        const f = (x - x0) / 16, o = x + y * rw;
        const d0 = 1 - rect[0][o] / Math.max(1, b0[0] + (b1[0] - b0[0]) * f);
        const d1 = 1 - rect[1][o] / Math.max(1, b0[1] + (b1[1] - b0[1]) * f);
        const d2 = 1 - rect[2][o] / Math.max(1, b0[2] + (b1[2] - b0[2]) * f);
        // まん中の値
        const mid = d0 > d1 ? (d1 > d2 ? d1 : d0 > d2 ? d2 : d0) : d0 > d2 ? d0 : d1 > d2 ? d2 : d1;
        ink[o] = mid < 0 ? 0 : mid > 1 ? 1 : mid;
        red[o] = d0 < 0 ? 0 : d0 > 1 ? 1 : d0;
      }
    }
  return { ink, red };
}

/**
 * 印刷された方眼を手がかりに、補正画像の細かなずれ（レンズのゆがみ・紙のそり）をはかる。
 * わくを小さな区画に分け、区画ごとに「方眼の線が本来の位置からどれだけずれているか」を
 * 方眼の周期（1マス）でたたみこんで求める。
 * もどり値: shift(name, xmm, ymm) → [dx, dy]（画素）
 */
function gridShift(red, rw, rh, tpl, ox, oy, R) {
  const cell = CELL * R;
  const period = Math.round(cell);
  const fields = {};
  const acc = new Float32Array(period), sm = new Float32Array(period);
  const phase = (x0, y0, x1, y1, origin, vertical) => {
    // 区画の中で、線に直角な方向の位置（1マスの中のどこか）ごとに暗さを足しあげる
    acc.fill(0);
    if (vertical) {
      for (let x = x0; x < x1; x++) {
        let sum = 0;
        for (let y = y0; y < y1; y += 2) sum += red[x + y * rw];
        acc[(((x - origin) % period) + period) % period] += sum;
      }
    } else {
      for (let y = y0; y < y1; y++) {
        let sum = 0;
        for (let x = x0; x < x1; x += 2) sum += red[x + y * rw];
        acc[(((y - origin) % period) + period) % period] += sum;
      }
    }
    let best = 0, bv = -1, mean = 0;
    for (let i = 0; i < period; i++) {
      sm[i] = acc[(i + period - 1) % period] + acc[i] + acc[(i + 1) % period];
      mean += sm[i];
      if (sm[i] > bv) { bv = sm[i]; best = i; }
    }
    mean /= period;
    if (bv < mean * 1.25 + 1e-6) return null; // 方眼がはっきり見えない
    // 山のまわりの重心で、1画素より細かく
    let num = 0, den = 0;
    for (let d = -2; d <= 2; d++) { const v = Math.max(0, sm[(best + d + period) % period] - mean); num += d * v; den += v; }
    let off = best + (den ? num / den : 0);
    if (off > period / 2) off -= period;
    return off;
  };
  for (const name of ['front', 'top', 'side']) {
    const b = tpl.boxes[name];
    const bx0 = (b.x - ox) * R, by0 = (b.y - oy) * R;
    const step = 4; // 区画の大きさ（マス）
    const nxp = Math.max(1, Math.round(b.cols / step)), nyp = Math.max(1, Math.round(b.rows / step));
    const dx = new Float32Array(nxp * nyp), dy = new Float32Array(nxp * nyp);
    const ok = new Uint8Array(nxp * nyp);
    for (let j = 0; j < nyp; j++)
      for (let i = 0; i < nxp; i++) {
        const x0 = Math.max(0, Math.round(bx0 + (i * b.cols / nxp) * cell)), x1 = Math.min(rw, Math.round(bx0 + ((i + 1) * b.cols / nxp) * cell));
        const y0 = Math.max(0, Math.round(by0 + (j * b.rows / nyp) * cell)), y1 = Math.min(rh, Math.round(by0 + ((j + 1) * b.rows / nyp) * cell));
        const px = phase(x0, y0, x1, y1, Math.round(bx0), true);
        const py = phase(x0, y0, x1, y1, Math.round(by0), false);
        if (px === null || py === null) continue;
        dx[i + j * nxp] = px + (Math.round(bx0) - bx0); dy[i + j * nxp] = py + (Math.round(by0) - by0);
        ok[i + j * nxp] = 1;
      }
    // 1マス以上のずれは、山の位置だけでは分からない（ちょうど1マスずれても同じに見える）。
    // 四すみのマークの近くではずれが小さいので、そこを出発点にして、となりの区画へ
    // なめらかにつながるように（1マスの整数倍を足し引きして）順に決めていく。
    const pw0 = (b.cols * cell) / nxp, ph0 = (b.rows * cell) / nyp;
    let seed = -1, nearest = Infinity;
    for (let j = 0; j < nyp; j++)
      for (let i = 0; i < nxp; i++) {
        if (!ok[i + j * nxp]) continue;
        const mx = ox + (bx0 + (i + 0.5) * pw0) / R, my = oy + (by0 + (j + 0.5) * ph0) / R;
        for (const [qx, qy] of tpl.markers) {
          const d = Math.hypot(mx - qx, my - qy);
          if (d < nearest) { nearest = d; seed = i + j * nxp; }
        }
      }
    const unwrap = (arr) => {
      if (seed < 0) return;
      const done = new Uint8Array(nxp * nyp);
      done[seed] = 1;
      const queue = [seed];
      while (queue.length) {
        const cur = queue.shift(), ci = cur % nxp, cj = Math.floor(cur / nxp);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = ci + di, jj = cj + dj;
          if (ii < 0 || jj < 0 || ii >= nxp || jj >= nyp) continue;
          const n = ii + jj * nxp;
          if (!ok[n] || done[n]) continue;
          arr[n] += Math.round((arr[cur] - arr[n]) / period) * period;
          done[n] = 1;
          queue.push(n);
        }
      }
    };
    unwrap(dx);
    unwrap(dy);
    // はずれ値をおさえる: まわりの区画とのまん中の値にする
    const smooth = (src) => {
      const out = new Float32Array(src.length);
      for (let j = 0; j < nyp; j++)
        for (let i = 0; i < nxp; i++) {
          const v = [];
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= nxp || jj >= nyp || !ok[ii + jj * nxp]) continue;
              v.push(src[ii + jj * nxp]);
            }
          v.sort((p, q) => p - q);
          out[i + j * nxp] = v.length ? v[v.length >> 1] : 0;
        }
      return out;
    };
    fields[name] = { nxp, nyp, dx: smooth(dx), dy: smooth(dy), bx0, by0, pw: (b.cols * cell) / nxp, ph: (b.rows * cell) / nyp };
  }
  return (name, x, y) => {
    const f = fields[name];
    let fx = (x - f.bx0) / f.pw - 0.5, fy = (y - f.by0) / f.ph - 0.5;
    fx = Math.max(0, Math.min(f.nxp - 1, fx)); fy = Math.max(0, Math.min(f.nyp - 1, fy));
    const ix = Math.min(Math.floor(fx), Math.max(0, f.nxp - 2)), iy = Math.min(Math.floor(fy), Math.max(0, f.nyp - 2));
    const ax = fx - ix, ay = fy - iy;
    const ix1 = Math.min(f.nxp - 1, ix + 1), iy1 = Math.min(f.nyp - 1, iy + 1);
    const lerp = (a) => (a[ix + iy * f.nxp] * (1 - ax) + a[ix1 + iy * f.nxp] * ax) * (1 - ay) + (a[ix + iy1 * f.nxp] * (1 - ax) + a[ix1 + iy1 * f.nxp] * ax) * ay;
    return [lerp(f.dx), lerp(f.dy)];
  };
}

/**
 * 方眼の線分すべてについて、えんぴつの線があるか・実線か破線かを決める。
 *
 *  (1) 線分ごとに、方眼の線のまわり ±1.4mm でいちばん線らしい位置をさがし、
 *      線にそった「こさ」の並び（プロファイル）をとる。
 *  (2) まん中の8割がどれだけうまっているかで、線の「ある・なし」を決める。
 *  (3) まっすぐ続く線を、直角の線とまじわる交点で区切る（区間）。
 *      1つの区間は1種類の線のはずなので、区間ごとに、すき間の割合と数から実線・破線を決める。
 */
function readLines(ink, rw, rh, tpl, ox, oy, R, shift) {
  const tol = Math.round(1.4 * R), cell = Math.round(CELL * R), end = Math.round(0.45 * R);
  const rowMean = new Float32Array(2 * tol + 1);
  const sample = (along, across, vertical) => {
    const x = vertical ? across : along, y = vertical ? along : across;
    return x < 0 || y < 0 || x >= rw || y >= rh ? 0 : ink[x + y * rw];
  };
  // a0: 線分の始点（線の方向の画素位置）, c0: 線の位置（直角方向）。out に cell 個の値を入れる。
  // まじわる線（直角の線）は、線からはなれた行にも同じこさで写るので、それを引いて消す。
  // outward: わくのふちの線のとき、わくの外がどちら側か（-1 / +1。ふちでなければ 0）。
  //   外側には文字や数字が印刷されているので、外へは 0.7mm までしかさがさない。
  const far = [7, 9, 11, 13].map((d) => Math.round((d * R) / 8));
  const outLimit = Math.round(0.7 * R);
  const fv = new Float32Array(8);
  const measure = (a0, c0, vertical, out, at, outward) => {
    const s0 = Math.round(a0), cc0 = Math.round(c0);
    const lo = outward < 0 ? -outLimit : -tol, hi = outward > 0 ? outLimit : tol;
    for (let o = lo; o <= hi; o++) {
      let sum = 0;
      for (let s = s0 + end; s < s0 + cell - end; s++) sum += sample(s, cc0 + o, vertical);
      rowMean[o + tol] = sum;
    }
    let bo = 0, bv = -1;
    for (let o = lo + 1; o <= hi - 1; o++) {
      const v = rowMean[o - 1 + tol] + rowMean[o + tol] + rowMean[o + 1 + tol] - Math.abs(o) * 0.006 * (cell - 2 * end);
      if (v > bv) { bv = v; bo = o; }
    }
    for (let s = 0; s < cell; s++) {
      let m = 0;
      for (let d = -2; d <= 2; d++) { const v = sample(s0 + s, cc0 + bo + d, vertical); if (v > m) m = v; }
      let bgv;
      if (outward) {
        // 内側の行だけで地をはかる
        for (let k = 0; k < 4; k++) fv[k] = sample(s0 + s, cc0 + bo - outward * far[k], vertical);
        const f4 = fv.subarray(0, 4).sort();
        bgv = (f4[1] + f4[2]) / 2;
      } else {
        for (let k = 0; k < 4; k++) { fv[k * 2] = sample(s0 + s, cc0 + bo + far[k], vertical); fv[k * 2 + 1] = sample(s0 + s, cc0 + bo - far[k], vertical); }
        fv.sort();
        bgv = (fv[3] + fv[4]) / 2;
      }
      const v = m - bgv;
      out[at + s] = v > 0 ? v : 0;
    }
  };

  const boxes = {};
  const mids = [[], [], []]; // 方眼の線の太さの種類ごとの、線分のまん中のこさ
  const all = [];
  for (const name of ['front', 'top', 'side']) {
    const b = tpl.boxes[name];
    const px = (b.x - ox) * R, pyBottom = (b.y + b.h - oy) * R;
    const nV = (b.cols + 1) * b.rows, nH = b.cols * (b.rows + 1);
    const profV = new Float32Array(nV * cell), profH = new Float32Array(nH * cell);
    // 縦線: プロファイルは下から上へ
    const tmp = new Float32Array(cell);
    for (let q = 0; q < b.rows; q++)
      for (let c = 0; c <= b.cols; c++) {
        const [sx, sy] = shift(name, px + c * CELL * R, pyBottom - (q + 0.5) * CELL * R);
        measure(pyBottom - (q + 1) * CELL * R + sy, px + c * CELL * R + sx, true, tmp, 0, c === 0 ? -1 : c === b.cols ? 1 : 0);
        const at = (c + q * (b.cols + 1)) * cell;
        for (let s = 0; s < cell; s++) profV[at + s] = tmp[cell - 1 - s];
      }
    for (let c = 0; c <= b.rows; c++)
      for (let p = 0; p < b.cols; p++) {
        const [sx, sy] = shift(name, px + (p + 0.5) * CELL * R, pyBottom - c * CELL * R);
        measure(px + p * CELL * R + sx, pyBottom - c * CELL * R + sy, false, profH, (p + c * b.cols) * cell, c === 0 ? 1 : c === b.rows ? -1 : 0);
      }
    boxes[name] = { b, profV, profH, nV, nH };
    const collect = (prof, n, clsOf) => {
      const mid = new Float32Array(cell - 2 * end);
      for (let i = 0; i < n; i++) {
        for (let s = end; s < cell - end; s++) { mid[s - end] = prof[i * cell + s]; if (s % 3 === 0) all.push(prof[i * cell + s]); }
        mids[clsOf(i)].push(percentile(mid, 0.5));
      }
    };
    collect(profV, nV, (i) => { const c = i % (b.cols + 1); return c === 0 || c === b.cols ? 2 : c % 5 === 0 ? 1 : 0; });
    collect(profH, nH, (i) => { const c = Math.floor(i / b.cols); return c === 0 || c === b.rows ? 2 : c % 5 === 0 ? 1 : 0; });
  }
  // 印刷された方眼の線のこさ（base）と、えんぴつの線のこさ（hi）から、しきい値を決める
  // base: 何もかいていない線分のこさ（印刷された方眼の線のこさ）。spread: そのばらつき。
  const base = mids.map((m) => percentile(m, 0.5));
  const spread = mids.map((m, c) => percentile(m.map((v) => Math.abs(v - base[c])), 0.5));
  const hi = percentile(all, 0.995);
  const thrOf = (cls) => Math.max(base[cls] + Math.max(0.07, 5 * spread[cls]), 0.1, Math.min(0.33 * hi, 0.25));

  const drawing = {}, uncertain = {};
  let total = 0;
  const mask = Math.round(0.6 * R), minGap = Math.max(2, Math.round(0.25 * R));
  for (const name of ['front', 'top', 'side']) {
    const { b, profV, profH, nV, nH } = boxes[name];
    const view = makeView(b.cols, b.rows);
    const unc = [];
    // (2) ある・なし
    const hasV = new Uint8Array(nV), hasH = new Uint8Array(nH);
    const presence = (prof, n, has, clsOf) => {
      for (let i = 0; i < n; i++) {
        const thr = thrOf(clsOf(i));
        let on = 0;
        for (let s = end; s < cell - end; s++) if (prof[i * cell + s] > thr) on++;
        if (on / (cell - 2 * end) >= 0.3) has[i] = 1;
      }
    };
    const clsV = (i) => { const c = i % (b.cols + 1); return c === 0 || c === b.cols ? 2 : c % 5 === 0 ? 1 : 0; };
    const clsH = (i) => { const c = Math.floor(i / b.cols); return c === 0 || c === b.rows ? 2 : c % 5 === 0 ? 1 : 0; };
    presence(profV, nV, hasV, clsV);
    presence(profH, nH, hasH, clsH);
    const vAt = (c, q) => (c >= 0 && c <= b.cols && q >= 0 && q < b.rows ? hasV[c + q * (b.cols + 1)] : 0);
    const hAt = (p, c) => (p >= 0 && p < b.cols && c >= 0 && c <= b.rows ? hasH[p + c * b.cols] : 0);

    // (3) 区間ごとに実線・破線を決める
    const classify = (prof, ids, thrAbs, floor) => {
      const n = ids.length, len = n * cell;
      const raw = new Float32Array(len - 2 * mask);
      for (let k = 0; k < n; k++)
        for (let s = 0; s < cell; s++) { const t = k * cell + s - mask; if (t >= 0 && t < raw.length) raw[t] = prof[ids[k] * cell + s]; }
      // 線にそって少しならしてから、線のこさの6割より下がるところを「すき間」とする
      const vals = new Float32Array(raw.length);
      for (let t = 0; t < raw.length; t++) vals[t] = (raw[Math.max(0, t - 1)] + raw[t] + raw[Math.min(raw.length - 1, t + 1)]) / 3;
      // floor: 印刷された方眼の線のこさ。すき間でもそこまでは下がらないので、その上で6割をはかる
      const thr = Math.max(thrAbs, floor + 0.6 * (percentile(vals, 0.8) - floor));
      let on = 0, gaps = 0, run = 0, seenOn = false;
      for (let t = 0; t < vals.length; t++) {
        if (vals[t] > thr) {
          on++;
          if (seenOn && run >= minGap) gaps++; // 線と線にはさまれたすき間だけ数える
          run = 0; seenOn = true;
        } else run++;
      }
      const cover = on / vals.length;
      const need = Math.max(1, Math.ceil(0.5 * n)); // 破線なら、1マスに1つ近くすき間がある
      let type;
      if (cover < 0.25) type = NONE;
      else if (cover < 0.8 || gaps >= need) type = DASH;
      else type = SOLID;
      const doubt = type !== NONE && ((type === SOLID && (cover < 0.9 || gaps > 0)) || (type === DASH && cover > 0.86 && gaps <= need));
      return { type, doubt, cover };
    };
    const spans = []; // { kind, line, from, to, type, doubt }
    for (let c = 0; c <= b.cols; c++) {
      let q = 0;
      while (q < b.rows) {
        if (!vAt(c, q)) { q++; continue; }
        let e = q + 1;
        while (e < b.rows && vAt(c, e) && !hAt(c - 1, e) && !hAt(c, e)) e++;
        const ids = [];
        for (let k = q; k < e; k++) ids.push(c + k * (b.cols + 1));
        spans.push({ kind: 'V', line: c, from: q, to: e, ...classify(profV, ids, thrOf(clsV(ids[0])), base[clsV(ids[0])]) });
        q = e;
      }
    }
    for (let c = 0; c <= b.rows; c++) {
      let p = 0;
      while (p < b.cols) {
        if (!hAt(p, c)) { p++; continue; }
        let e = p + 1;
        while (e < b.cols && hAt(e, c) && !vAt(e, c - 1) && !vAt(e, c)) e++;
        const ids = [];
        for (let k = p; k < e; k++) ids.push(k + c * b.cols);
        spans.push({ kind: 'H', line: c, from: p, to: e, ...classify(profH, ids, thrOf(clsH(ids[0])), base[clsH(ids[0])]) });
        p = e;
      }
    }
    // 1マスだけの区間は、破線のすき間がたまたま入らないことがある。
    // 破線は1本の線として続けてかくものなので、同じ直線のとなりが破線なら、その続きとみなす:
    //   ・両どなりが破線 → 破線
    //   ・片方のとなりが破線で、この区間にも少しでも切れ目がある → 破線
    for (const sp of spans) {
      if (sp.type !== SOLID || sp.to - sp.from !== 1) continue;
      const prev = spans.find((o) => o.kind === sp.kind && o.line === sp.line && o.to === sp.from);
      const next = spans.find((o) => o.kind === sp.kind && o.line === sp.line && o.from === sp.to);
      const dashes = (prev && prev.type === DASH ? 1 : 0) + (next && next.type === DASH ? 1 : 0);
      if (dashes === 2 || (dashes === 1 && sp.cover < 0.97)) { sp.type = DASH; sp.doubt = true; }
      else if (dashes === 1) sp.doubt = true;
    }
    for (const sp of spans) {
      if (!sp.type) continue;
      for (let k = sp.from; k < sp.to; k++) {
        if (sp.kind === 'V') view.V[sp.line + k * (b.cols + 1)] = sp.type; else view.H[k + sp.line * b.cols] = sp.type;
        total++;
        if (sp.doubt) unc.push(sp.kind === 'V' ? ['V', sp.line, k] : ['H', k, sp.line]);
      }
    }
    drawing[name] = view;
    uncertain[name] = unc;
  }
  return { drawing, uncertain, total };
}
