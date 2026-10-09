// 画像処理の基本（明るさ・紙の地の明るさ・黒いかたまりのラベルづけ）

/** RGBA → 明るさ（0〜255） */
export function toGray(rgba, n) {
  const g = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) g[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  return g;
}

/**
 * 紙の地の明るさ（かげや照明のむらをならす）。
 * 画像をタイルに分け、タイルごとに明るい側の値（percent 分位）をとって、なめらかにつなぐ。
 * もどり値: at(x, y) で地の明るさを返すオブジェクト
 */
export function estimateBackground(values, w, h, tile, percent = 0.8) {
  const tw = Math.max(1, Math.ceil(w / tile)), th = Math.max(1, Math.ceil(h / tile));
  const grid = new Float32Array(tw * th);
  const hist = new Int32Array(64);
  for (let ty = 0; ty < th; ty++)
    for (let tx = 0; tx < tw; tx++) {
      hist.fill(0);
      const x0 = tx * tile, x1 = Math.min(w, x0 + tile), y0 = ty * tile, y1 = Math.min(h, y0 + tile);
      let count = 0;
      for (let y = y0; y < y1; y += 2)
        for (let x = x0; x < x1; x += 2) { hist[Math.min(63, values[x + y * w] >> 2)]++; count++; }
      let acc = 0, bin = 63;
      const target = count * percent;
      for (let b = 0; b < 64; b++) { acc += hist[b]; if (acc >= target) { bin = b; break; } }
      grid[tx + ty * tw] = bin * 4 + 2;
    }
  // 3×3 でならす
  const sm = new Float32Array(tw * th);
  for (let ty = 0; ty < th; ty++)
    for (let tx = 0; tx < tw; tx++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = tx + dx, yy = ty + dy;
          if (xx < 0 || yy < 0 || xx >= tw || yy >= th) continue;
          s += grid[xx + yy * tw]; c++;
        }
      sm[tx + ty * tw] = s / c;
    }
  return {
    at(x, y) {
      let fx = x / tile - 0.5, fy = y / tile - 0.5;
      if (fx < 0) fx = 0; else if (fx > tw - 1) fx = tw - 1;
      if (fy < 0) fy = 0; else if (fy > th - 1) fy = th - 1;
      const ix = Math.min(Math.floor(fx), Math.max(0, tw - 2)), iy = Math.min(Math.floor(fy), Math.max(0, th - 2));
      const ax = fx - ix, ay = fy - iy;
      const ix1 = Math.min(tw - 1, ix + 1), iy1 = Math.min(th - 1, iy + 1);
      return (sm[ix + iy * tw] * (1 - ax) + sm[ix1 + iy * tw] * ax) * (1 - ay) + (sm[ix + iy1 * tw] * (1 - ax) + sm[ix1 + iy1 * tw] * ax) * ay;
    },
  };
}

/** 地の明るさにくらべて暗いところを 1 にする */
export function binarize(gray, w, h, bg, ratio = 0.55) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    // 地の明るさは横になめらかなので、8画素ごとに計算して間をうめる
    for (let x = 0; x < w; x += 8) {
      const b0 = bg.at(x, y), b1 = bg.at(Math.min(w - 1, x + 8), y);
      const lim = Math.min(w, x + 8);
      for (let xx = x; xx < lim; xx++) {
        const b = b0 + ((b1 - b0) * (xx - x)) / 8;
        if (gray[xx + y * w] < b * ratio) out[xx + y * w] = 1;
      }
    }
  }
  return out;
}

/**
 * つながった黒い画素のかたまり（8方向）ごとに、大きさ・位置をもとめる。
 * もどり値: [{ area, minX, maxX, minY, maxY, cx, cy }]
 */
export function components(bin, w, h) {
  const labels = new Int32Array(w * h);
  let parent = new Int32Array(1024);
  let next = 1;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let y = 0; y < h; y++) {
    const row = y * w, up = row - w;
    for (let x = 0; x < w; x++) {
      if (!bin[row + x]) continue;
      // 左・左上・上・右上のうち、すでに番号のついたものとつなぐ
      let l = 0;
      for (let n = 0; n < 4; n++) {
        let v = 0;
        if (n === 0) { if (x > 0) v = labels[row + x - 1]; }
        else if (y > 0) {
          const xx = x + n - 2;
          if (xx >= 0 && xx < w) v = labels[up + xx];
        }
        if (!v) continue;
        const r = find(v);
        if (!l) l = r;
        else if (r !== l) { if (r < l) { parent[l] = r; l = r; } else parent[r] = l; }
      }
      if (!l) {
        l = next++;
        if (l >= parent.length) { const p2 = new Int32Array(parent.length * 2); p2.set(parent); parent = p2; }
        parent[l] = l;
      }
      labels[row + x] = l;
    }
  }
  const stats = new Map();
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const v = labels[row + x];
      if (!v) continue;
      const r = find(v);
      let s = stats.get(r);
      if (!s) { s = { area: 0, minX: x, maxX: x, minY: y, maxY: y, sx: 0, sy: 0 }; stats.set(r, s); }
      s.area++; s.sx += x; s.sy += y;
      if (x < s.minX) s.minX = x;
      if (x > s.maxX) s.maxX = x;
      if (y > s.maxY) s.maxY = y;
    }
  }
  const out = [];
  for (const s of stats.values()) out.push({ area: s.area, minX: s.minX, maxX: s.maxX, minY: s.minY, maxY: s.maxY, cx: s.sx / s.area, cy: s.sy / s.area });
  return out;
}

/** 大津の方法（0〜1 の値のリストを2つに分けるしきい値） */
export function otsu(values, bins = 64) {
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; best = i; }
  }
  return (best + 1) / bins;
}

export function percentile(values, p) {
  if (!values.length) return 0;
  const a = Float32Array.from(values).sort();
  return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
}
