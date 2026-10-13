// 方眼用紙にかくもの（四角・線・文字）のリストをつくる。
// このリストから SVG（印刷・PDF・画像用）をつくる。テストでは同じリストから擬似的な写真をつくる。

import { CELL, MARKER, MARGIN, GRID_MINOR, GRID_MAJOR, GRID_EDGE } from './templates.js';
import { encodeCode, CODE_S0, CODE_DS, CODE_HEIGHT } from './code.js';

export const GRID_TONES = {
  light: '#96dcf5',
  normal: '#69c8f0',
  dark: '#3ca0d7',
};

const INK = '#1c2530';
const SUB = '#55606c';
const FONT = "'BIZ UDPGothic','Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Yu Gothic','Meiryo',sans-serif";

/**
 * tpl: 用紙の種類（templates.js）
 * settings: { scaleMm, boardMm, thickness, boardCheck, hiddenLines, gridTone }
 * figure: はじめからかいておく図面（なければ白紙）
 * もどり値: { pageW, pageH, items, font }
 */
export function sheetPrimitives(tpl, settings, figure = null) {
  const { pageW, pageH, boxes, info, markers } = tpl;
  const items = [];
  const rect = (x, y, w, h, fill) => items.push({ t: 'rect', x, y, w, h, fill });
  const line = (x1, y1, x2, y2, sw, stroke, dash) => items.push({ t: 'line', x1, y1, x2, y2, sw, stroke, dash });
  const text = (x, y, size, str, o = {}) => items.push({ t: 'text', x, y, size, text: str, anchor: o.anchor || 'start', fill: o.fill || INK, weight: o.weight || 400 });
  const grid = GRID_TONES[settings.gridTone] || GRID_TONES.normal;

  rect(0, 0, pageW, pageH, '#ffffff');

  // 四すみのマーク（黒・白・黒の三重の四角）
  for (const [cx, cy] of markers) {
    rect(cx - MARKER / 2, cy - MARKER / 2, MARKER, MARKER, '#000000');
    rect(cx - MARKER * 5 / 14, cy - MARKER * 5 / 14, MARKER * 5 / 7, MARKER * 5 / 7, '#ffffff');
    rect(cx - MARKER * 3 / 14, cy - MARKER * 3 / 14, MARKER * 3 / 7, MARKER * 3 / 7, '#000000');
  }

  // 設定コード
  const span = markers[1][0] - markers[0][0];
  const bits = encodeCode({ template: tpl.id, ...settings });
  bits.forEach((b, i) => {
    if (!b) return;
    rect(markers[0][0] + (CODE_S0 + i * CODE_DS) * span, markers[0][1] - CODE_HEIGHT / 2, CODE_DS * span + 0.02, CODE_HEIGHT, '#000000');
  });

  // 題
  const titleX = markers[0][0] + (CODE_S0 + bits.length * CODE_DS) * span + 5;
  text(titleX, markers[0][1] + 1.6, 4.2, tpl.landscape ? '第三角法による正投影図　かきこみ用紙' : '第三角法による正投影図', { weight: 700 });

  // 方眼（わくごと）
  // 線の太さ: 5マスごとの線とわくの線は、数えやすいように少しだけ太くする。
  // 太くしすぎると、写真では灰色のこい線に写り、その上にかいた細いえんぴつの線と見分けにくくなる
  //（はじめは 0.3 / 0.35mm だった。実物の写真でたしかめて細くした）。
  for (const name of ['top', 'front', 'side']) {
    const b = boxes[name];
    for (let u = 0; u <= b.cols; u++) {
      const edge = u === 0 || u === b.cols;
      const x = b.x + u * CELL;
      line(x, b.y, x, b.y + b.h, edge ? GRID_EDGE : u % 5 === 0 ? GRID_MAJOR : GRID_MINOR, grid);
    }
    for (let v = 0; v <= b.rows; v++) {
      const edge = v === 0 || v === b.rows;
      const y = b.y + b.h - v * CELL;
      line(b.x, y, b.x + b.w, y, edge ? GRID_EDGE : v % 5 === 0 ? GRID_MAJOR : GRID_MINOR, grid);
    }
  }

  // はじめからかいておく図面（基本の作品など）
  if (figure) items.push(...figureItems(tpl, figure));

  // 図の名前
  const f = boxes.front, tp = boxes.top, sd = boxes.side;
  // 文字はわくの線から 1.5mm 以上はなす（読み取りのとき、線とまちがえないように）
  text(tp.x + 12, tp.y - 2, 3.2, '平面図（上から見た図）', { weight: 700 });
  const labelY = f.y + f.h + 4.6;
  text(f.x + 12, labelY, 3.2, '正面図（正面から見た図）', { weight: 700 });
  text(sd.x + 1, labelY, 3.2, tpl.landscape ? '右側面図（右から見た図）' : '右側面図', { weight: 700 });

  // 目もりの数字（5マスごと）: わくとわくの間
  const gy = f.y - CELL / 2 + 0.75; // 横のすき間の文字の位置
  for (let u = 0; u <= f.cols; u += 5) text(f.x + u * CELL, gy, 2.1, String(u), { anchor: 'middle', fill: SUB });
  for (let u = 0; u <= sd.cols; u += 5) text(sd.x + u * CELL, gy, 2.1, String(u), { anchor: 'middle', fill: SUB });
  const gx = f.x + f.w + CELL / 2; // 縦のすき間
  for (let v = 5; v <= f.rows; v += 5) text(gx, f.y + f.h - v * CELL + 0.75, 2.1, String(v), { anchor: 'middle', fill: SUB });
  for (let v = 5; v <= tp.rows; v += 5) text(gx, tp.y + tp.h - v * CELL + 0.75, 2.1, String(v), { anchor: 'middle', fill: SUB });

  items.push(...infoItems(tpl, settings));

  // 名前らん
  const fy = pageH - MARGIN - 1.2;
  const fx = markers[3][0] + MARKER / 2 + 4;
  text(fx, fy, 3.4, '年　　組　　番　名前');
  line(fx + 37, fy + 1, fx + 37 + (tpl.landscape ? 70 : 52), fy + 1, 0.25, SUB);
  text(markers[2][0] - MARKER / 2 - 4, fy, 2.5, `${tpl.name}／1マス=${settings.scaleMm}mm／板の厚さ${settings.boardMm}mm（${settings.thickness}マス）`, { anchor: 'end', fill: SUB });

  return { pageW, pageH, items, font: FONT };
}

/**
 * 図面（drawing: { front, top, side }）を、用紙に印刷する線にする。
 * 実線は黒の 0.5mm、かくれ線は黒の 0.4mm の破線。こくはっきり印刷されるので、写真からも読み取れる。
 * まっすぐ続く線は1本にまとめる。実線は、かどが欠けないように、両はしを線の太さの半分だけのばす。
 */
export function figureItems(tpl, figure) {
  const items = [];
  const SOLID_W = 0.5, DASH_W = 0.4, BLACK = '#000000';
  const put = (x1, y1, x2, y2, type) => {
    if (type === 1) {
      const e = SOLID_W / 2, h = y1 === y2;
      items.push({ t: 'line', x1: x1 - (h ? e : 0), y1: y1 - (h ? 0 : e), x2: x2 + (h ? e : 0), y2: y2 + (h ? 0 : e), sw: SOLID_W, stroke: BLACK });
    } else items.push({ t: 'line', x1, y1, x2, y2, sw: DASH_W, stroke: BLACK, dash: [2.6, 1.3] });
  };
  for (const name of ['top', 'front', 'side']) {
    const b = tpl.boxes[name], v = figure[name];
    if (!v) continue;
    const X = (u) => b.x + u * CELL, Y = (w) => b.y + b.h - w * CELL;
    for (let c = 0; c <= v.nu; c++)
      for (let q = 0; q < v.nv; q++) {
        const type = v.V[c + q * (v.nu + 1)];
        if (!type) continue;
        let e = q + 1;
        while (e < v.nv && v.V[c + e * (v.nu + 1)] === type) e++;
        put(X(c), Y(e), X(c), Y(q), type);
        q = e - 1;
      }
    for (let c = 0; c <= v.nv; c++)
      for (let p = 0; p < v.nu; p++) {
        const type = v.H[p + c * v.nu];
        if (!type) continue;
        let e = p + 1;
        while (e < v.nu && v.H[e + c * v.nu] === type) e++;
        put(X(p), Y(c), X(e), Y(c), type);
        p = e - 1;
      }
  }
  return items;
}

/** 右上の「かき方のきまり」のわくにかくもの（用紙にも、画面のエディタにも使う） */
export function infoItems(tpl, settings) {
  const { info } = tpl;
  const items = [];
  const line = (x1, y1, x2, y2, sw, stroke, dash) => items.push({ t: 'line', x1, y1, x2, y2, sw, stroke, dash });
  const text = (x, y, size, str, o = {}) => items.push({ t: 'text', x, y, size, text: str, anchor: o.anchor || 'start', fill: o.fill || INK, weight: o.weight || 400 });
  const grid = GRID_TONES[settings.gridTone] || GRID_TONES.normal;
  const pad = 2.5;
  items.push({ t: 'frame', x: info.x, y: info.y, w: info.w, h: info.h, stroke: grid, sw: 0.35 });
  let y = info.y + 6;
  text(info.x + pad, y, 3.3, 'かき方のきまり', { weight: 700 });
  // 板の厚さは「マス数」でかく約束。1マスの大きさと合わないとき（例: 1マス10mm・板12mm）も、
  // アプリが板の厚さのマスだけを本当の厚さに読みかえる。
  const exact = settings.scaleMm * settings.thickness === settings.boardMm;
  // かくれ線は、全部かく設定と、必要なものだけかく設定がある
  const hidden = settings.hiddenLines === 'all'
    ? [['見える線は実線、見えない線は破線']]
    : [['見える線は実線でかく'], ['見えないつなぎ目や、かくれた板は', '破線（かくれ線）でかく']];
  const rules = [
    ['線は方眼の線の上に、定規でこくかく'],
    ...hidden,
    exact
      ? [`板の厚さは${settings.thickness}マス（${settings.boardMm}mm）でかく`]
      : [`1マスは${settings.scaleMm}mm。ただし板の厚さ`, `（${settings.boardMm}mm）は${settings.thickness}マスでかく`],
    ['板と板のつなぎ目にも線をかく'],
    ['平面図は正面図の真上、右側面図は', '真横に、位置をそろえてかく'],
    ['四すみの■は、よごさない・折らない'],
  ];
  const size = info.w >= 80 ? 3.1 : 2.75;
  const lh = size * 1.55;
  y += 2.2;
  rules.forEach((lines, n) => {
    lines.forEach((s, li) => {
      y += lh;
      text(info.x + pad, y, size, li === 0 ? `${n + 1} ${s}` : `　${s}`);
    });
  });
  y += lh + 1.5;
  const lx = info.x + pad;
  line(lx, y, lx + 13, y, 0.7, INK);
  text(lx + 15, y + 1, size, '実線（外形線）');
  y += lh;
  line(lx, y, lx + 13, y, 0.5, INK, [2.6, 1.3]);
  text(lx + 15, y + 1, size, '破線（かくれ線）');

  // 寸法メモ（広い用紙だけ）: 方眼に合わない長さは、ここに数字で書いておき、読みこんだあと画面で入れる
  if (info.h >= 90 && info.w >= 90) {
    y += lh * 2;
    text(lx, y, size, '全体の大きさ（mm）', { weight: 700 });
    y += lh * 1.7;
    let x = lx;
    for (const name of ['はば', '高さ', '奥行き']) {
      text(x, y, size, name);
      const w = name.length * size + 1.5;
      line(x + w, y + 0.8, x + w + 15, y + 0.8, 0.25, SUB);
      x += w + 18;
    }
    y += lh * 1.5;
    text(lx, y, 2.6, '方眼に合わない長さは、読みこんだあと画面で数字を入れます。', { fill: SUB });
  }

  return items;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n2 = (v) => +v.toFixed(3);

/** SVG の文字列にする（大きさは mm 指定なので、そのまま実寸で印刷できる） */
export function sheetSvg(tpl, settings, figure = null) {
  const { pageW, pageH, items, font } = sheetPrimitives(tpl, settings, figure);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}mm" height="${pageH}mm" viewBox="0 0 ${pageW} ${pageH}" font-family="${font.replace(/"/g, "'")}">`);
  for (const it of items) {
    if (it.t === 'rect') out.push(`<rect x="${n2(it.x)}" y="${n2(it.y)}" width="${n2(it.w)}" height="${n2(it.h)}" fill="${it.fill}"/>`);
    else if (it.t === 'frame') out.push(`<rect x="${n2(it.x)}" y="${n2(it.y)}" width="${n2(it.w)}" height="${n2(it.h)}" fill="none" stroke="${it.stroke}" stroke-width="${it.sw}"/>`);
    else if (it.t === 'line') out.push(`<line x1="${n2(it.x1)}" y1="${n2(it.y1)}" x2="${n2(it.x2)}" y2="${n2(it.y2)}" stroke="${it.stroke}" stroke-width="${it.sw}"${it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : ''}/>`);
    else if (it.t === 'text') out.push(`<text x="${n2(it.x)}" y="${n2(it.y)}" font-size="${it.size}" fill="${it.fill}" text-anchor="${it.anchor}"${it.weight !== 400 ? ` font-weight="${it.weight}"` : ''}>${esc(it.text)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}
