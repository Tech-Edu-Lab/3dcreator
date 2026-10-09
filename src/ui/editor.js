// 図面エディタ: 用紙と同じ3つの方眼のわくに、線をかく・消す・直す。
// 読みこんだ写真を下じきにして、読み取った線とくらべることもできる。

import { NONE, SOLID, DASH } from '../core/model.js';
import { cloneDrawing } from '../core/drawing.js';
import { CELL } from '../sheet/templates.js';

const INK = '#1c2530';
const OVER = '#0a5fb4'; // 写真の上に重ねるときの線の色
const RED = '#d6382d';
const AMBER = '#e58a00';
const GRID = '#69c8f0';
const DIM = '#0a5fb4'; // 寸法線と寸法の数字
const GREEN = '#17794a'; // アプリがおぎなったかくれ線
const VIEW_TITLES = { top: '平面図（上から見た図）', front: '正面図（正面から見た図）', side: '右側面図（右から見た図）' };

export class SheetEditor {
  /** canvas: かく場所, wrap: スクロールする親要素 */
  constructor(canvas, wrap, opts = {}) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.ctx = canvas.getContext('2d');
    this.onChange = opts.onChange || (() => {});
    this.onState = opts.onState || (() => {});
    this.tool = 'solid';
    this.zoom = 1;
    this.tpl = null;
    this.drawing = null;
    this.issues = [];
    this.focus = -1;
    this.uncertain = null;
    this.photo = null;
    this.showPhoto = true;
    this.info = null;
    this.supplement = null; // アプリがおぎなったかくれ線（図ごとの線分のリスト）
    this.dim = null; // 図に重ねる寸法（全体の大きさ）
    this.dimFocus = null; // 寸法らんでえらんでいる区間
    this.undoStack = [];
    this.redoStack = [];
    this.drag = null;
    this.hover = null;
    this.scale = 1;

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', () => { this.drag = null; this.render(); });
    canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.render(); } });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(wrap);
  }

  // ---- 外から使うもの ----

  setTemplate(tpl) {
    this.tpl = tpl;
    this.resize();
  }

  /** 図面を入れかえる（元に戻す用に、前の状態をおぼえる） */
  setDrawing(drawing, { remember = true } = {}) {
    if (remember && this.drawing) this.pushUndo();
    this.drawing = drawing;
    this.render();
    this.onState();
  }

  getDrawing() { return this.drawing; }

  setTool(tool) { this.tool = tool; this.canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair'; this.onState(); }

  setZoom(z) {
    this.zoom = Math.max(1, Math.min(3, z));
    this.resize();
    this.onState();
  }

  /** 赤ペンの印。issues: analyze() の issues、focus: 強調する番号（-1 で全部） */
  setIssues(issues, focus = -1) { this.issues = issues || []; this.focus = focus; this.render(); }

  setUncertain(u) { this.uncertain = u; this.render(); }

  /** アプリがおぎなったかくれ線。s: { front, top, side }（線分のリスト）または null */
  setSupplement(s) { this.supplement = s; this.render(); }

  /**
   * 図に重ねてかく寸法。dim: { origin, cells: {x,y,z}, totals: {x,y,z} } または null
   *   origin: 各わくの中での図の左下 { front:{u,v}, top:{u,v}, side:{u,v} }
   */
  setDimInfo(dim) { this.dim = dim; this.render(); }

  /** 寸法らんでえらんでいる区間を図の上で光らせる。f: { axis:'x'|'y'|'z', u0, u1 } または null */
  setDimFocus(f) { this.dimFocus = f; this.render(); }

  /** 右上の「かき方のきまり」（layout.js の infoItems の結果） */
  setInfo(items) { this.info = items; this.render(); }

  /** 写真の下じき。photo: { canvas, originMm:[x,y], res } または null */
  setPhoto(photo) { this.photo = photo; this.render(); this.onState(); }

  setShowPhoto(v) { this.showPhoto = v; this.render(); }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  snapshot() { return { drawing: cloneDrawing(this.drawing), tpl: this.tpl, photo: this.photo, uncertain: this.uncertain }; }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  restore(s) {
    if (s.tpl !== this.tpl) { this.tpl = null; this.setTemplate(s.tpl); }
    this.drawing = s.drawing; this.photo = s.photo; this.uncertain = s.uncertain; this.supplement = null;
    this.render();
    this.onChange({ templateChanged: true });
    this.onState();
  }

  undo() { if (!this.undoStack.length) return; this.redoStack.push(this.snapshot()); this.restore(this.undoStack.pop()); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(this.snapshot()); this.restore(this.redoStack.pop()); }

  // ---- 大きさ ----

  resize() {
    if (!this.tpl) return;
    const avail = Math.max(280, this.wrap.clientWidth - 2);
    const cssW = Math.round(avail * this.zoom);
    // 見える範囲 (mm)。上下には図の名前を入れる分をあける（小さい画面でも文字が切れないよう、画素で決める）
    const a = this.tpl.area;
    this.vx = a.x - 2; this.vw = a.w + 4;
    const s = cssW / this.vw;
    const top = Math.max(6.5, 19 / s), bottom = Math.max(7, 21 / s);
    this.vy = a.y - top; this.vh = a.h + top + bottom;
    const cssH = Math.round((cssW * this.vh) / this.vw);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) { this.canvas.width = bw; this.canvas.height = bh; }
    this.scale = cssW / this.vw; // 画面の画素 / mm
    this.k = this.scale * dpr;
    this.render();
  }

  // ---- 位置の計算 ----

  toMm(e) {
    const r = this.canvas.getBoundingClientRect();
    return [this.vx + (e.clientX - r.left) / this.scale, this.vy + (e.clientY - r.top) / this.scale];
  }

  /** 紙の位置 (mm) → いちばん近いわくと交点 */
  pick(x, y) {
    const tol = 3;
    for (const name of ['front', 'top', 'side']) {
      const b = this.tpl.boxes[name];
      if (x < b.x - tol || x > b.x + b.w + tol || y < b.y - tol || y > b.y + b.h + tol) continue;
      const fu = (x - b.x) / CELL, fv = (b.y + b.h - y) / CELL;
      const u = Math.max(0, Math.min(b.cols, Math.round(fu))), v = Math.max(0, Math.min(b.rows, Math.round(fv)));
      return { name, u, v, fu, fv };
    }
    return null;
  }

  // ---- 入力 ----

  down(e) {
    if (!this.drawing) return;
    if (this.tool === 'pan') {
      this.drag = { pan: true, x: e.clientX, y: e.clientY, sl: this.wrap.scrollLeft, st: this.wrap.scrollTop };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    const p = this.pick(...this.toMm(e));
    if (!p) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { start: p, end: p, moved: false };
    this.render();
  }

  move(e) {
    if (this.drag && this.drag.pan) {
      this.wrap.scrollLeft = this.drag.sl - (e.clientX - this.drag.x);
      this.wrap.scrollTop = this.drag.st - (e.clientY - this.drag.y);
      return;
    }
    const [x, y] = this.toMm(e);
    const p = this.pick(x, y);
    if (!this.drag) { this.hover = p; this.render(); return; }
    const s = this.drag.start, b = this.tpl.boxes[s.name];
    // 始点と同じわくの中で、水平か垂直にそろえる
    const u = Math.max(0, Math.min(b.cols, Math.round((x - b.x) / CELL))), v = Math.max(0, Math.min(b.rows, Math.round((b.y + b.h - y) / CELL)));
    const end = Math.abs(u - s.u) >= Math.abs(v - s.v) ? { name: s.name, u, v: s.v } : { name: s.name, u: s.u, v };
    if (end.u !== s.u || end.v !== s.v) this.drag.moved = true;
    this.drag.end = end;
    this.render();
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    if (!d || d.pan) return;
    const type = this.tool === 'solid' ? SOLID : this.tool === 'dash' ? DASH : NONE;
    const view = this.drawing[d.start.name];
    const before = cloneDrawing(this.drawing);
    let changed = false;
    const set = (kind, a, b, t) => {
      const i = kind === 'V' ? a + b * (view.nu + 1) : a + b * view.nu;
      if (view[kind][i] !== t) { view[kind][i] = t; changed = true; }
    };
    if (d.moved) {
      const { u: u1, v: v1 } = d.start, { u: u2, v: v2 } = d.end;
      if (v1 === v2) for (let p = Math.min(u1, u2); p < Math.max(u1, u2); p++) set('H', p, v1, type);
      else for (let q = Math.min(v1, v2); q < Math.max(v1, v2); q++) set('V', u1, q, type);
    } else {
      // その場でおした: いちばん近い線分1つ。同じ種類の線なら消す。
      const seg = this.nearestSegment(d.start);
      if (seg) {
        const i = seg.kind === 'V' ? seg.a + seg.b * (view.nu + 1) : seg.a + seg.b * view.nu;
        set(seg.kind, seg.a, seg.b, view[seg.kind][i] === type ? NONE : type);
      }
    }
    if (changed) {
      this.undoStack.push({ drawing: before, tpl: this.tpl, photo: this.photo, uncertain: this.uncertain });
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack.length = 0;
      this.uncertain = null;
      this.onChange({});
      this.onState();
    }
    this.hover = this.pick(...this.toMm(e));
    this.render();
  }

  nearestSegment(p) {
    const b = this.tpl.boxes[p.name];
    const iu = Math.max(0, Math.min(b.cols - 1, Math.floor(p.fu))), iv = Math.max(0, Math.min(b.rows - 1, Math.floor(p.fv)));
    const du = p.fu - iu, dv = p.fv - iv;
    const c = [
      { kind: 'H', a: iu, b: iv, d: dv },
      { kind: 'H', a: iu, b: iv + 1, d: 1 - dv },
      { kind: 'V', a: iu, b: iv, d: du },
      { kind: 'V', a: iu + 1, b: iv, d: 1 - du },
    ];
    c.sort((m, n) => m.d - n.d);
    return c[0].d <= 0.45 ? c[0] : null;
  }

  // ---- 表示 ----

  render() {
    const { ctx, tpl } = this;
    if (!tpl || !this.k) return;
    const css = getComputedStyle(this.canvas);
    const paper = css.getPropertyValue('--paper').trim() || '#fbfcfd';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.k, 0, 0, this.k, -this.vx * this.k, -this.vy * this.k);
    ctx.fillStyle = paper;
    ctx.fillRect(this.vx, this.vy, this.vw, this.vh);
    const px = 1 / this.scale; // 画面の1画素 (mm)
    const withPhoto = !!(this.photo && this.showPhoto);

    if (withPhoto) {
      const ph = this.photo;
      ctx.drawImage(ph.canvas, ph.originMm[0], ph.originMm[1], ph.canvas.width / ph.res, ph.canvas.height / ph.res);
    } else {
      for (const name of ['top', 'front', 'side']) this.drawGrid(tpl.boxes[name], px);
      if (this.info) this.drawInfo(css.fontFamily, px);
    }

    // 図の名前と目もり
    ctx.fillStyle = '#3b4753';
    ctx.textBaseline = 'alphabetic';
    const f = tpl.boxes.front, tp = tpl.boxes.top, sd = tpl.boxes.side;
    const title = Math.max(3.2, 11 * px);
    ctx.font = `700 ${title}px ${css.fontFamily}`;
    // 名前が長くてわくからはみ出すときは、短い名前にする
    const label = (name, b, y) => {
      const long = VIEW_TITLES[name];
      ctx.fillText(ctx.measureText(long).width <= b.w - 1 ? long : long.replace(/（.*）/, ''), b.x + 1, y);
    };
    label('top', tp, tp.y - 1.6);
    label('front', f, f.y + f.h + title + 0.8);
    label('side', sd, sd.y + sd.h + title + 0.8);
    if (!withPhoto && 2.1 >= 7 * px) {
      ctx.font = `400 2.1px ${css.fontFamily}`;
      ctx.fillStyle = '#6b7783';
      ctx.textAlign = 'center';
      for (let u = 0; u <= f.cols; u += 5) ctx.fillText(String(u), f.x + u * CELL, f.y - CELL / 2 + 0.75);
      for (let u = 0; u <= sd.cols; u += 5) ctx.fillText(String(u), sd.x + u * CELL, f.y - CELL / 2 + 0.75);
      for (let v = 5; v <= f.rows; v += 5) ctx.fillText(String(v), f.x + f.w + CELL / 2, f.y + f.h - v * CELL + 0.75);
      for (let v = 5; v <= tp.rows; v += 5) ctx.fillText(String(v), f.x + f.w + CELL / 2, tp.y + tp.h - v * CELL + 0.75);
      ctx.textAlign = 'start';
    }

    if (!this.drawing) return;

    // 赤ペン: ぬる部分
    this.issues.forEach((issue, n) => {
      const strong = this.focus < 0 || this.focus === n;
      for (const m of issue.marks || []) {
        if (!m.cells || !m.cells.length) continue;
        const b = tpl.boxes[m.view];
        ctx.fillStyle = issue.level === 'warn' ? `rgba(229,138,0,${strong ? 0.22 : 0.08})` : `rgba(214,56,45,${strong ? 0.2 : 0.07})`;
        for (const [p, q] of m.cells) ctx.fillRect(b.x + p * CELL, b.y + b.h - (q + 1) * CELL, CELL, CELL);
      }
    });

    // あやしい線・赤ペンの線（下に太くひく）
    const halo = (name, segs, color, alpha) => {
      const b = tpl.boxes[name];
      ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.8, 7 * px);
      ctx.beginPath();
      for (const [kind, a, c] of segs) {
        const x = b.x + a * CELL, y = b.y + b.h - c * CELL;
        ctx.moveTo(x, y);
        if (kind === 'V') ctx.lineTo(x, y - CELL); else ctx.lineTo(x + CELL, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    if (this.uncertain) for (const name of ['front', 'top', 'side']) if (this.uncertain[name] && this.uncertain[name].length) halo(name, this.uncertain[name], AMBER, 0.45);
    this.issues.forEach((issue, n) => {
      const strong = this.focus < 0 || this.focus === n;
      for (const m of issue.marks || []) if (m.segs && m.segs.length) halo(m.view, m.segs, RED, strong ? 0.5 : 0.15);
    });

    if (this.dim && this.dimFocus) this.drawDimFocus();

    // 破線をまとめてひく（おぎなった線・考えられる線）
    const dashed = (name, segs, color, width) => {
      const b = tpl.boxes[name];
      ctx.strokeStyle = color; ctx.lineCap = 'butt'; ctx.lineWidth = Math.max(width, width * 3.2 * px);
      ctx.setLineDash([2.2, 1.5]);
      ctx.beginPath();
      for (const [kind, a, c] of segs) {
        const x = b.x + a * CELL, y = b.y + b.h - c * CELL;
        ctx.moveTo(x, y);
        if (kind === 'V') ctx.lineTo(x, y - CELL); else ctx.lineTo(x + CELL, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    // アプリがおぎなったかくれ線（緑）
    if (this.supplement) for (const name of ['front', 'top', 'side']) if (this.supplement[name] && this.supplement[name].length) dashed(name, this.supplement[name], GREEN, 0.5);

    // かいた線
    for (const name of ['top', 'front', 'side']) this.drawLines(tpl.boxes[name], this.drawing[name], withPhoto ? OVER : INK, px);

    if (this.dim) this.drawDimTotals(css.fontFamily, px);

    // 赤ペン: 考えられるかくれ線（オレンジの破線）。1〜2マスの短い線は見落としやすいので、丸でかこむ
    const ringShort = (name, segs) => {
      const b = tpl.boxes[name];
      const groups = [], at = new Map(); // つながった線ごとにまとめる
      for (const [kind, a, c] of segs) {
        const ends = [[a, c], kind === 'V' ? [a, c + 1] : [a + 1, c]];
        const [g1, g2] = ends.map((e) => at.get(e.join()));
        let g = g1 || g2;
        if (!g) { g = { pts: [] }; groups.push(g); }
        if (g1 && g2 && g1 !== g2) { for (const pt of g2.pts) { g1.pts.push(pt); at.set(pt.join(), g1); } g2.pts = []; g = g1; }
        for (const e of ends) { g.pts.push(e); at.set(e.join(), g); }
      }
      ctx.strokeStyle = AMBER; ctx.lineWidth = Math.max(0.45, 2 * px);
      for (const g of groups) {
        if (!g.pts.length) continue;
        const us = g.pts.map((e) => e[0]), vs = g.pts.map((e) => e[1]);
        const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
        if (u1 - u0 > 2 || v1 - v0 > 2) continue;
        ctx.beginPath();
        ctx.arc(b.x + ((u0 + u1) / 2) * CELL, b.y + b.h - ((v0 + v1) / 2) * CELL, Math.max(1.6 * CELL, 9 * px), 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    this.issues.forEach((issue, n) => {
      const strong = this.focus < 0 || this.focus === n;
      ctx.globalAlpha = strong ? 1 : 0.3;
      for (const m of issue.marks || []) if (m.ghost && m.ghost.length) { dashed(m.view, m.ghost, AMBER, 0.75); ringShort(m.view, m.ghost); }
      ctx.globalAlpha = 1;
    });

    // 赤ペン: 丸
    this.issues.forEach((issue, n) => {
      const strong = this.focus < 0 || this.focus === n;
      for (const m of issue.marks || []) {
        if (!m.nodes) continue;
        const b = tpl.boxes[m.view];
        ctx.strokeStyle = RED; ctx.globalAlpha = strong ? 1 : 0.3; ctx.lineWidth = Math.max(0.5, 2 * px);
        for (const [u, v] of m.nodes) { ctx.beginPath(); ctx.arc(b.x + u * CELL, b.y + b.h - v * CELL, Math.max(2, 7 * px), 0, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
    });

    // かいているとちゅうの線
    if (this.drag && this.drag.start && this.tool !== 'pan') {
      const b = tpl.boxes[this.drag.start.name];
      const s = this.drag.start, e = this.drag.end;
      ctx.beginPath();
      ctx.moveTo(b.x + s.u * CELL, b.y + b.h - s.v * CELL);
      ctx.lineTo(b.x + e.u * CELL, b.y + b.h - e.v * CELL);
      if (this.tool === 'erase') { ctx.strokeStyle = RED; ctx.globalAlpha = 0.45; ctx.lineWidth = Math.max(1.6, 6 * px); ctx.setLineDash([]); }
      else { ctx.strokeStyle = OVER; ctx.globalAlpha = 0.9; ctx.lineWidth = Math.max(0.8, 2.5 * px); ctx.setLineDash(this.tool === 'dash' ? [2.4, 1.4] : []); }
      ctx.lineCap = 'butt';
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    const mark = this.drag && this.drag.start ? this.drag.end : this.hover;
    if (mark && this.tool !== 'pan') {
      const b = tpl.boxes[mark.name];
      ctx.beginPath();
      ctx.arc(b.x + mark.u * CELL, b.y + b.h - mark.v * CELL, Math.max(0.9, 3.5 * px), 0, Math.PI * 2);
      ctx.fillStyle = this.tool === 'erase' ? RED : OVER;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** 寸法らんでえらんだ区間を、その長さが見える2つの図の上に帯でしめす */
  drawDimFocus() {
    const { ctx, tpl } = this;
    const { origin, cells } = this.dim, { axis, u0, u1 } = this.dimFocus;
    const band = (name, horizontal, a0, a1, b0, b1) => {
      // horizontal: 横の帯（たての位置が a0〜a1、よこは b0〜b1）
      const b = tpl.boxes[name], o = origin[name];
      const x0 = b.x + (o.u + (horizontal ? b0 : a0)) * CELL, x1 = b.x + (o.u + (horizontal ? b1 : a1)) * CELL;
      const y0 = b.y + b.h - (o.v + (horizontal ? a1 : b1)) * CELL, y1 = b.y + b.h - (o.v + (horizontal ? a0 : b0)) * CELL;
      ctx.fillStyle = 'rgba(10, 95, 180, 0.2)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = OVER; ctx.lineWidth = Math.max(0.3, 1.5 / this.scale); ctx.setLineDash([]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    };
    if (axis === 'x') { band('front', false, u0, u1, 0, cells.z); band('top', false, u0, u1, 0, cells.y); }
    else if (axis === 'y') { band('top', true, u0, u1, 0, cells.x); band('side', false, u0, u1, 0, cells.z); }
    else { band('front', true, u0, u1, 0, cells.x); band('side', true, u0, u1, 0, cells.y); }
  }

  /** 全体の大きさ（はば・高さ・奥行き）を、寸法線と数字で図にそえる */
  drawDimTotals(font, px) {
    const { ctx, tpl } = this;
    const { origin, cells, totals } = this.dim;
    const size = Math.max(3, 11.5 * px), gap = Math.max(4, size * 1.25), tick = Math.max(1, 3 * px);
    const fmt = (v) => String(Math.round(v * 10) / 10);
    ctx.strokeStyle = DIM; ctx.fillStyle = DIM; ctx.lineWidth = Math.max(0.2, 1.1 * px); ctx.setLineDash([]); ctx.lineCap = 'butt';
    ctx.font = `700 ${size}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    // よこの寸法線（図の下。下にすき間がなければ上）
    const across = (name, n, value) => {
      const b = tpl.boxes[name], o = origin[name];
      const x0 = b.x + o.u * CELL, x1 = x0 + n * CELL;
      const below = o.v * CELL >= gap + size * 0.4;
      const rows = name === 'top' ? cells.y : cells.z;
      const y = below ? b.y + b.h - o.v * CELL + gap : b.y + b.h - (o.v + rows) * CELL - gap * 0.55;
      if (y < b.y + size || y > b.y + b.h) return;
      ctx.beginPath();
      ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      ctx.moveTo(x0, y - tick); ctx.lineTo(x0, y + tick); ctx.moveTo(x1, y - tick); ctx.lineTo(x1, y + tick);
      ctx.stroke();
      const label = fmt(value), w = ctx.measureText(label).width + size * 0.5;
      ctx.fillStyle = 'rgba(251, 252, 253, 0.9)'; ctx.fillRect((x0 + x1) / 2 - w / 2, y - size * 0.62, w, size * 1.2);
      ctx.fillStyle = DIM; ctx.fillText(label, (x0 + x1) / 2, y + size * 0.36);
    };
    // たての寸法線（図の左。左にすき間がなければ右）
    const upright = (name, n, value) => {
      const b = tpl.boxes[name], o = origin[name];
      const y1 = b.y + b.h - o.v * CELL, y0 = y1 - n * CELL;
      const left = o.u * CELL >= gap + size * 0.4;
      const x = left ? b.x + o.u * CELL - gap : b.x + (o.u + cells.x) * CELL + gap;
      if (x < b.x + size * 0.5 || x > b.x + b.w - size * 0.5) return;
      ctx.beginPath();
      ctx.moveTo(x, y0); ctx.lineTo(x, y1);
      ctx.moveTo(x - tick, y0); ctx.lineTo(x + tick, y0); ctx.moveTo(x - tick, y1); ctx.lineTo(x + tick, y1);
      ctx.stroke();
      const label = fmt(value), w = ctx.measureText(label).width + size * 0.5;
      ctx.save();
      ctx.translate(x, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(251, 252, 253, 0.9)'; ctx.fillRect(-w / 2, -size * 0.62, w, size * 1.2);
      ctx.fillStyle = DIM; ctx.fillText(label, 0, size * 0.36);
      ctx.restore();
    };
    across('front', cells.x, totals.x);
    upright('front', cells.z, totals.z);
    across('side', cells.y, totals.y);
    ctx.textAlign = 'start';
  }

  /** 用紙と同じ「かき方のきまり」をかく */
  drawInfo(font, px) {
    const { ctx } = this;
    for (const it of this.info) {
      if (it.t === 'frame') {
        ctx.strokeStyle = GRID; ctx.globalAlpha = 0.95; ctx.lineWidth = Math.max(0.3, px * 0.9);
        ctx.strokeRect(it.x, it.y, it.w, it.h);
        ctx.globalAlpha = 1;
      } else if (it.t === 'line') {
        ctx.strokeStyle = it.stroke; ctx.lineWidth = Math.max(it.sw, px); ctx.lineCap = 'butt';
        ctx.setLineDash(it.dash || []);
        ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); ctx.stroke();
        ctx.setLineDash([]);
      } else if (it.t === 'text') {
        ctx.fillStyle = it.fill; ctx.textAlign = it.anchor === 'middle' ? 'center' : it.anchor === 'end' ? 'right' : 'left';
        ctx.font = `${it.weight} ${it.size}px ${font}`;
        ctx.fillText(it.text, it.x, it.y);
      }
    }
    ctx.textAlign = 'start';
  }

  drawGrid(b, px) {
    const { ctx } = this;
    ctx.strokeStyle = GRID;
    const pass = (pick, width, alpha) => {
      ctx.lineWidth = Math.max(width, px * 0.9);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let u = 0; u <= b.cols; u++) if (pick(u, b.cols)) { ctx.moveTo(b.x + u * CELL, b.y); ctx.lineTo(b.x + u * CELL, b.y + b.h); }
      for (let v = 0; v <= b.rows; v++) if (pick(v, b.rows)) { ctx.moveTo(b.x, b.y + b.h - v * CELL); ctx.lineTo(b.x + b.w, b.y + b.h - v * CELL); }
      ctx.stroke();
    };
    pass((i, n) => i % 5 !== 0 && i !== n, 0.15, 0.55);
    pass((i, n) => i % 5 === 0 || i === n, 0.3, 0.95);
    ctx.globalAlpha = 1;
  }

  /** 同じ種類が続く線分を、1本の線としてかく */
  drawLines(b, view, color, px) {
    const { ctx } = this;
    const X = (u) => b.x + u * CELL, Y = (v) => b.y + b.h - v * CELL;
    const runs = { [SOLID]: [], [DASH]: [] };
    for (let c = 0; c <= view.nu; c++) {
      let q = 0;
      while (q < view.nv) {
        const t = view.V[c + q * (view.nu + 1)];
        if (!t) { q++; continue; }
        let e = q;
        while (e < view.nv && view.V[c + e * (view.nu + 1)] === t) e++;
        runs[t].push([X(c), Y(q), X(c), Y(e)]);
        q = e;
      }
    }
    for (let c = 0; c <= view.nv; c++) {
      let p = 0;
      while (p < view.nu) {
        const t = view.H[p + c * view.nu];
        if (!t) { p++; continue; }
        let e = p;
        while (e < view.nu && view.H[e + c * view.nu] === t) e++;
        runs[t].push([X(p), Y(c), X(e), Y(c)]);
        p = e;
      }
    }
    ctx.strokeStyle = color;
    ctx.lineCap = 'square';
    ctx.lineWidth = Math.max(0.7, 2.2 * px);
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of runs[SOLID]) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.lineWidth = Math.max(0.5, 1.6 * px);
    ctx.setLineDash([2.4, 1.4]);
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of runs[DASH]) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
