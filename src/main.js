// アプリ全体の流れ（画面のボタンと、図面・読み取り・点検・3D表示をつなぐ）

import { TEMPLATES, getTemplate, SCALES, BOARD_MM, DEFAULT_SETTINGS, paperName } from './sheet/templates.js';
import { sheetSvg, infoItems } from './sheet/layout.js';
import { buildPdf, deflateRgb } from './sheet/pdf.js';
import { readSheet } from './reader/reader.js';
import { analyze } from './core/analyze.js';
import { buildMeshes, stlBinary } from './core/mesh.js';
import { buildRuler, partSize, emptyDims } from './core/ruler.js';
import { emptyDrawing, drawingIsEmpty, pasteView, serializeDrawing, deserializeDrawing } from './core/drawing.js';
import { bounds } from './core/extract.js';
import { makeView, VIEW_NAMES } from './core/model.js';
import { SAMPLES, makeSample } from './core/samples.js';
import { SheetEditor } from './ui/editor.js';
import { saveFile, inArtifact, warmUpSave } from './ui/save.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'seizu3d.v2';
const WOOD = ['#e2bd8a', '#d3a56c', '#ecd3a8', '#c99657', '#e8c796', '#d8b27c', '#f0dcb8', '#bf8a4c'];

const state = {
  settings: { ...DEFAULT_SETTINGS },
  result: null, // analyze() の結果（まだ点検していなければ null）
  shown: null, // いま表示している立体（result.model か、ほかの形）
  alt: 0,
  dims: emptyDims(), // 生徒が入れた寸法の数字
  ruler: null, // マス → mm の読みかえ（ruler.js）
  meshes: null,
  sample: null, // 見本を開いたままなら、その id
  focus: -1,
};

let editor = null;
let viewer = null;
let Viewer3D = null;
let timer = 0;

// ---------- 小さな道具 ----------

let toastTimer = 0;
function toast(message, kind = '') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 9000 : 5200);
}

function busy(text) {
  $('busyText').textContent = text || '';
  $('busy').hidden = !text;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ settings: state.settings, sample: state.sample, dims: state.dims, drawing: serializeDrawing(editor.getDrawing()) }));
  } catch { /* 保存できなくても動く */ }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    const s = { ...state.settings, ...o.settings };
    if (!TEMPLATES.some((t) => t.id === s.template) || !SCALES.includes(s.scaleMm) || !BOARD_MM.includes(s.boardMm)) return null;
    if (s.hiddenLines !== 'all') s.hiddenLines = 'needed';
    const tpl = getTemplate(s.template);
    const d = deserializeDrawing(o.drawing);
    for (const n of VIEW_NAMES) if (d[n].nu !== tpl.sizes[n].cols || d[n].nv !== tpl.sizes[n].rows) return null;
    const dims = emptyDims();
    for (const a of ['x', 'y', 'z']) if (o.dims && o.dims[a]) dims[a] = { total: o.dims[a].total ?? null, cells: o.dims[a].cells, pins: { ...(o.dims[a].pins || {}) } };
    return { settings: s, drawing: d, sample: o.sample || null, dims };
  } catch {
    return null;
  }
}

// ---------- 設定 ----------

function fillSelects() {
  for (const el of document.querySelectorAll('[data-setting="template"]')) el.innerHTML = TEMPLATES.map((t) => `<option value="${t.id}">${el.id === 'setTemplate' ? t.name : `${t.name}（${t.hint}）`}</option>`).join('');
  for (const el of document.querySelectorAll('[data-setting="scaleMm"]')) el.innerHTML = SCALES.map((v) => `<option value="${v}">${v}</option>`).join('');
  for (const el of document.querySelectorAll('[data-setting="boardMm"]')) el.innerHTML = BOARD_MM.map((v) => `<option value="${v}">${v}</option>`).join('');
  for (const el of document.querySelectorAll('[data-setting="thickness"]')) el.innerHTML = [1, 2, 3, 4].map((v) => `<option value="${v}">${v}</option>`).join('');
  $('sampleSelect').innerHTML = '<option value="">見本をひらく…</option>' + SAMPLES.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
}

function showSettings() {
  const s = state.settings;
  for (const el of document.querySelectorAll('[data-setting]')) {
    const key = el.dataset.setting;
    if (el.type === 'checkbox') el.checked = !!s[key]; else el.value = String(s[key]);
  }
  for (const el of document.querySelectorAll('[data-derived="thick"]')) el.textContent = `（${s.thickness}マスでかく）`;
  const tpl = getTemplate(s.template);
  if (editor) editor.setInfo(infoItems(tpl, s));
  $('dlgSize').textContent = `${paperName(tpl)}の用紙です。かける大きさ: はば ${tpl.sizes.front.cols}・高さ ${tpl.sizes.front.rows}・奥行き ${tpl.sizes.top.rows} マスまで（1マス${s.scaleMm}mmなら、およそ ${tpl.sizes.front.cols * s.scaleMm}×${tpl.sizes.front.rows * s.scaleMm}×${tpl.sizes.top.rows * s.scaleMm} mm まで）`;
  if ($('dlgSheet').open) showPreview();
}

function onSetting(el) {
  const key = el.dataset.setting;
  let value = el.type === 'checkbox' ? el.checked : el.value;
  if (key === 'template' || key === 'scaleMm' || key === 'thickness' || key === 'boardMm') value = Number(value);
  if (state.settings[key] === value) return;
  if (key === 'template') { changeTemplate(value); return; }
  state.settings[key] = value;
  showSettings();
  // 見本を開いたままなら、かくれ線のかき方に合わせて見本もかきかえる
  if (key === 'hiddenLines' && state.sample) {
    const d = makeSample(state.sample, getTemplate(state.settings.template).sizes, state.settings);
    if (d) editor.setDrawing(d);
  }
  persist();
  if (key !== 'gridTone' && state.result) run();
}

/** 用紙の種類を変える。かいてある図は、入るならそのままうつす */
function changeTemplate(id) {
  const tpl = getTemplate(id);
  const old = editor.getDrawing();
  const next = emptyDrawing(tpl.sizes);
  let kept = true;
  if (state.sample) {
    const d = makeSample(state.sample, tpl.sizes, state.settings);
    if (d) for (const n of VIEW_NAMES) next[n] = d[n];
  } else if (!drawingIsEmpty(old)) {
    const bb = Object.fromEntries(VIEW_NAMES.map((n) => [n, bounds(old[n])]));
    const moved = {};
    for (const n of VIEW_NAMES) {
      const b = bb[n];
      if (!b) continue;
      const w = b.u1 - b.u0, h = b.v1 - b.v0;
      if (w > next[n].nu || h > next[n].nv) { kept = false; break; }
      const part = makeView(w, h);
      for (let q = 0; q < h; q++) for (let c = 0; c <= w; c++) part.V[c + q * (w + 1)] = old[n].V[b.u0 + c + (b.v0 + q) * (old[n].nu + 1)];
      for (let c = 0; c <= h; c++) for (let p = 0; p < w; p++) part.H[p + c * w] = old[n].H[b.u0 + p + (b.v0 + c) * old[n].nu];
      moved[n] = { part, u: Math.min(b.u0, next[n].nu - w), v: Math.min(b.v0, next[n].nv - h) };
    }
    if (kept) {
      // 正面図と平面図は左右を、正面図と右側面図は上下をそろえたままにする
      if (moved.front && moved.top) moved.top.u = moved.front.u = Math.min(moved.front.u, moved.top.u);
      if (moved.front && moved.side) moved.side.v = moved.front.v = Math.min(moved.front.v, moved.side.v);
      for (const n of VIEW_NAMES) if (moved[n]) pasteView(next[n], moved[n].part, moved[n].u, moved[n].v);
    }
  }
  editor.pushUndo();
  state.settings.template = id;
  editor.photo = null; editor.uncertain = null;
  editor.setTemplate(tpl);
  editor.setDrawing(next, { remember: false });
  if (!kept) toast('新しい用紙に入りきらないので、白紙にしました。「元に戻す」で前の図面にもどせます。');
  showSettings();
  afterEdit();
}

// ---------- 点検と立体 ----------

function run({ byButton = false } = {}) {
  clearTimeout(timer);
  const keepView = !!state.meshes && !byButton;
  state.result = analyze(editor.getDrawing(), state.settings);
  state.alt = 0;
  state.focus = -1;
  showResult(keepView);
  if (byButton) {
    if (state.result.ok) toast('立体にできました。ドラッグで回して、図面どおりかたしかめましょう。');
    else $('stage').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function afterEdit() {
  persist();
  $('sampleTag').hidden = !state.sample;
  showHint();
  if (!state.result) return;
  clearTimeout(timer);
  timer = setTimeout(() => run(), 220);
}

async function ensureViewer() {
  if (viewer) return viewer;
  if (viewer === false) return null;
  try {
    if (!Viewer3D) ({ Viewer3D } = await import('./ui/viewer3d.js'));
    viewer = new Viewer3D($('view3d'));
  } catch (e) {
    viewer = false;
    console.error(e);
    return null;
  }
  return viewer;
}

async function showResult(keepView) {
  const r = state.result;
  const ok = !!(r && r.ok);
  const status = $('status');
  status.hidden = !r;
  $('empty').hidden = !!r;
  $('feedback').hidden = !r || ok;
  $('view3d').hidden = !ok;
  $('stageNote').hidden = !ok;
  for (const id of ['resultTools', 'saveRow', 'parts', 'dims']) $(id).hidden = !ok;
  $('altLine').hidden = true;
  $('warnLine').hidden = true;
  $('readNote').hidden = true;
  if (!ok) { state.ruler = null; editor.setDimInfo(null); editor.setSupplement(null); }
  if (!r) { editor.setIssues([]); showHint(); return; }

  if (!ok) {
    status.className = 'status ng';
    status.textContent = `直すところ ${r.issues.length}`;
    state.shown = null; state.meshes = null;
    editor.setIssues(r.issues, state.focus);
    showHint();
    const fb = $('feedback');
    fb.innerHTML = '';
    const lead = document.createElement('p');
    lead.className = 'fb-lead';
    lead.innerHTML = 'まだ立体にできません。図面の<em>赤いところ</em>を直しましょう。';
    const list = document.createElement('ol');
    list.className = 'fb-list';
    r.issues.forEach((issue, n) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fb-item';
      b.setAttribute('aria-pressed', String(state.focus === n));
      const num = document.createElement('span'); num.className = 'fb-num'; num.textContent = String(n + 1);
      const body = document.createElement('span'); body.className = 'fb-body';
      const t = document.createElement('b'); t.textContent = issue.title;
      const x = document.createElement('span'); x.textContent = issue.text;
      body.append(t, x); b.append(num, body); li.append(b); list.append(li);
      b.addEventListener('click', () => {
        state.focus = state.focus === n ? -1 : n;
        editor.setIssues(r.issues, state.focus);
        list.querySelectorAll('.fb-item').forEach((el, i) => el.setAttribute('aria-pressed', String(state.focus === i)));
        if (state.focus >= 0) $('sheetWrap').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    });
    const foot = document.createElement('p');
    foot.className = 'fb-foot';
    foot.textContent = r.issues.length > 1 ? 'コメントをおすと、図面のその場所だけが赤くなります。直すと、ここの表示も変わります。' : '図面を直すと、ここの表示も変わります。';
    fb.append(lead, list, foot);
    if (viewer) viewer.clear();
    return;
  }

  status.className = 'status ok';
  status.textContent = '立体にできました';
  const all = [r.model, ...(r.alternatives || [])];
  state.shown = all[state.alt] || r.model;
  editor.setSupplement(state.shown.supplement || null);
  showHint();
  // かくれ線を「必要なものだけ」で読んだときの注意
  if (state.settings.hiddenLines !== 'all') {
    const added = state.shown.supplement ? Object.values(state.shown.supplement).reduce((k, a) => k + a.length, 0) : 0;
    $('readNote').hidden = false;
    $('readNote').textContent = `${added ? '図面の緑の破線は、アプリがおぎなったかくれ線です。' : ''}線のない所は「何もない」と読んでいます。ほかの板にかくれた板があるときは、かくれ線でかきたしましょう。`;
  }
  measure();
  editor.setIssues(r.issues.filter((i) => i.level === 'warn'));
  const warn = r.issues.filter((i) => i.level === 'warn');
  if (warn.length) { $('warnLine').hidden = false; $('warnLine').textContent = `${warn[0].title}。${warn[0].text}`; }
  if (all.length > 1) {
    const al = $('altLine');
    al.hidden = false;
    al.innerHTML = '';
    const s = document.createElement('span');
    s.textContent = `この図面からは、ほかの形も考えられます（${state.alt + 1} / ${all.length}）。`;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.textContent = 'ほかの形を見る';
    b.addEventListener('click', () => { state.alt = (state.alt + 1) % all.length; showResult(true); });
    al.append(s, b);
  }
  const v = await ensureViewer();
  if (!v) {
    $('view3d').hidden = true;
    $('empty').hidden = false;
    $('empty').firstElementChild.innerHTML = '<b>3Dを表示できません</b>このブラウザやパソコンでは3D表示（WebGL）が使えません。STL・GLBの保存はできます。';
    return;
  }
  if (state.result !== r) return;
  v.resize();
  v.setModel(state.meshes, { keepView });
  v.setExplode($('explode').value / 100);
}

/**
 * 寸法を決め直す: マス → mm の読みかえをつくり、立体・部品表・寸法らん・図の寸法を新しくする。
 * 図面の線が変わって、数字を入れた区間がなくなっていたら、その数字はすてる。
 */
function measure() {
  const m = state.shown;
  let ruler = buildRuler(m, state.settings, state.dims);
  let changed = false;
  for (const a of ['x', 'y', 'z']) {
    const d = state.dims[a], axis = ruler.axes[a];
    const keys = new Set(axis.intervals.filter((s) => s.kind === 'free').map((s) => s.key));
    for (const k of Object.keys(d.pins)) if (!keys.has(k)) { delete d.pins[k]; changed = true; }
    if (d.total !== null && d.cells !== undefined && d.cells !== axis.cells) { d.total = null; changed = true; }
    // 全体の大きさと中の数字が合わないときは、全体を足し算で決め直す
    if (axis.conflict) { d.total = null; changed = true; }
  }
  if (changed) ruler = buildRuler(m, state.settings, state.dims);
  state.ruler = ruler;
  state.meshes = buildMeshes(m.grid, ruler.coords);
  editor.setDimInfo({ origin: m.origin, cells: { x: m.W, y: m.D, z: m.H }, totals: { x: ruler.axes.x.total, y: ruler.axes.y.total, z: ruler.axes.z.total } });
  showParts();
  showDims();
}

const mmText = (v) => String(Math.round(v * 10) / 10);

function showParts() {
  const m = state.shown, ruler = state.ruler;
  const el = $('parts');
  const groups = new Map();
  m.parts.forEach((p, n) => {
    const size = partSize(p, ruler);
    let dims;
    if (p.isBoard) {
      const others = [0, 1, 2].filter((a) => a !== p.axis).map((a) => size[a]).sort((a, b) => b - a);
      dims = [...others, size[p.axis]];
    } else dims = [...size].sort((a, b) => b - a);
    const key = `${dims.join('x')}:${p.rect ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, { dims, rect: p.rect, list: [] });
    groups.get(key).list.push(n);
  });
  const rows = [...groups.values()].map((g) => {
    const sw = g.list.map((n) => `<i class="sw" style="background:${WOOD[n % WOOD.length]}"></i>`).join('');
    return `<tr><td>${sw}</td><td class="num">${g.dims.map(mmText).join(' × ')}</td><td class="num">${g.list.length}</td><td>${g.rect ? '' : '切り欠きあり'}</td></tr>`;
  }).join('');
  el.innerHTML = `<p class="dims-line"><b>部品表</b>　全体の大きさは はば ${mmText(ruler.size[0])} × 奥行き ${mmText(ruler.size[1])} × 高さ ${mmText(ruler.size[2])} mm</p>
    <div class="parts-scroll"><table><thead><tr><th>色</th><th class="num">長さ × はば × 厚さ (mm)</th><th class="num">枚数</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------- 寸法らん ----------

const AXIS_LABEL = { x: ['はば', '左から右へ'], z: ['高さ', '下から上へ'], y: ['奥行き', '手前から奥へ'] };
let dimSignature = '';

/** 寸法のたし算（例: 12 ＋ 276 ＋ 12 ＝ 300）を、はば・高さ・奥行きごとにならべる */
function showDims() {
  const ruler = state.ruler, box = $('dimRows');
  const sig = ['x', 'z', 'y'].map((a) => ruler.axes[a].intervals.map((s) => `${s.key}${s.kind[0]}`).join(',')).join('|');
  if (sig !== dimSignature) {
    // 区間のならびが変わったときだけ作り直す（数字を入れているとちゅうで入力らんが消えないように）
    dimSignature = sig;
    box.innerHTML = '';
    for (const a of ['x', 'z', 'y']) {
      const axis = ruler.axes[a];
      const row = document.createElement('div');
      row.className = 'dim-row';
      row.dataset.axis = a;
      const name = document.createElement('span');
      name.className = 'dim-name';
      name.innerHTML = `${AXIS_LABEL[a][0]}<small>${AXIS_LABEL[a][1]}</small>`;
      const chain = document.createElement('div');
      chain.className = 'dim-chain';
      const op = (t) => { const o = document.createElement('span'); o.className = 'op'; o.textContent = t; chain.append(o); };
      axis.intervals.forEach((s, i) => {
        if (i) op('＋');
        let el;
        if (s.kind === 'board') { el = document.createElement('span'); el.className = 'dim-board'; el.title = '板の厚さ'; }
        else {
          el = document.createElement('input');
          el.type = 'number'; el.inputMode = 'decimal'; el.min = '1'; el.max = '5000'; el.step = '1';
          el.className = 'dim-in'; el.id = `dim-${a}-${s.key}`;
          el.setAttribute('aria-label', `${AXIS_LABEL[a][0]}の${i + 1}番目の長さ（mm）`);
        }
        el.dataset.key = s.key; el.dataset.u0 = s.u0; el.dataset.u1 = s.u1;
        chain.append(el);
      });
      op('＝');
      const total = document.createElement('input');
      total.type = 'number'; total.inputMode = 'decimal'; total.min = '1'; total.max = '9000'; total.step = '1';
      total.className = 'dim-in total'; total.id = `dim-${a}-total`;
      total.dataset.total = '1'; total.dataset.u0 = 0; total.dataset.u1 = axis.cells;
      total.setAttribute('aria-label', `全体の${AXIS_LABEL[a][0]}（mm）`);
      const unit = document.createElement('span'); unit.className = 'op'; unit.textContent = 'mm';
      const reset = document.createElement('button');
      reset.type = 'button'; reset.className = 'dim-reset'; reset.textContent = '↺';
      reset.title = '入れた数字を消して、マスの数からの自動計算にもどす';
      reset.setAttribute('aria-label', `${AXIS_LABEL[a][0]}の数字を自動にもどす`);
      chain.append(total, unit, reset);
      row.append(name, chain);
      box.append(row);
    }
  }
  // 数字とようすを入れ直す
  for (const a of ['x', 'z', 'y']) {
    const axis = ruler.axes[a], d = state.dims[a];
    const row = box.querySelector(`.dim-row[data-axis="${a}"]`);
    const free = axis.intervals.filter((s) => s.kind === 'free');
    for (const s of axis.intervals) {
      const el = row.querySelector(`[data-key="${s.key}"]`);
      if (s.kind === 'board') el.textContent = mmText(s.mm);
      else { if (document.activeElement !== el) el.value = mmText(s.mm); el.classList.toggle('auto', !s.pinned); }
    }
    const total = row.querySelector('[data-total]');
    if (document.activeElement !== total) total.value = mmText(axis.total);
    total.classList.toggle('auto', !axis.totalPinned);
    total.readOnly = free.length === 0;
    row.querySelector('.dim-reset').hidden = !(axis.totalPinned || Object.keys(d.pins).length);
  }
}

function onDimChange(el) {
  const row = el.closest('.dim-row');
  if (!row || !state.ruler) return;
  const a = row.dataset.axis, d = state.dims[a], axis = state.ruler.axes[a];
  const raw = el.value.trim();
  const val = raw === '' ? null : Number(raw);
  if (val !== null && !(val >= 1 && val <= 9000)) {
    toast('1 から 9000 までの数字（mm）を入れてください。', 'error');
    el.value = '';
    showDims();
    return;
  }
  const free = axis.intervals.filter((s) => s.kind === 'free');
  if (el.dataset.total) {
    d.total = val; d.cells = axis.cells;
    // 自由に変えられる所がないときは、いちばん長い所を自動にもどして、そこで合わせる
    if (val !== null && free.length && free.every((s) => s.pinned)) {
      const big = free.reduce((m, s) => (s.mm > m.mm ? s : m), free[0]);
      delete d.pins[big.key];
    }
  } else {
    const key = el.dataset.key;
    if (val === null) delete d.pins[key]; else d.pins[key] = val;
    // 全部の所に数字が入ったら、全体は足し算で決まる
    if (free.every((s) => (s.key === key ? val !== null : s.pinned))) d.total = null;
    else if (d.total === null) d.cells = axis.cells;
  }
  const before = state.ruler.axes[a].total;
  measure();
  persist();
  refresh3D();
  const after = state.ruler.axes[a].total;
  if (!el.dataset.total && after !== before) toast(`全体の${AXIS_LABEL[a][0]}が ${mmText(after)} mm になりました。`);
}

async function refresh3D() {
  const v = await ensureViewer();
  if (!v || !state.meshes) return;
  v.setModel(state.meshes, { keepView: true });
  v.setExplode($('explode').value / 100);
}

function showHint() {
  const hasPhoto = !!editor.photo;
  $('photoWrap').hidden = !hasPhoto;
  const unc = editor.uncertain ? Object.values(editor.uncertain).reduce((n, a) => n + a.length, 0) : 0;
  const sup = editor.supplement ? Object.values(editor.supplement).reduce((n, a) => n + a.length, 0) : 0;
  const ghost = !!(state.result && !state.result.ok && state.result.issues.some((i) => (i.marks || []).some((m) => m.ghost && m.ghost.length)));
  let html = '<span class="legend"><i></i>実線＝見える線</span><span class="legend"><i class="dash"></i>かくれ線＝見えない線</span>';
  if (hasPhoto) html = '<span class="legend"><i class="blue"></i>青い線＝読み取った線</span>' + (unc ? '<span class="legend"><i class="amber"></i>オレンジ＝実線か破線か、はっきりしない線</span>' : '');
  if (sup) html += '<span class="legend"><i class="green"></i>緑の破線＝アプリがおぎなったかくれ線</span>';
  if (ghost) html += '<span class="legend"><i class="ghost"></i>オレンジの破線＝考えられるかくれ線</span>';
  html += hasPhoto ? '写真とちがうところは、上の道具で直せます。' : '方眼の交点から交点へドラッグして線をひきます。線を1回おすと、その1マス分だけ消えます。';
  $('hint').innerHTML = html;
}

// ---------- 図面の読みこみ ----------

async function loadImage(blob) {
  if (!blob) return;
  if (blob.type && !blob.type.startsWith('image/')) { toast('画像ファイル（JPEG・PNG）をえらんでください。PDFは、画像にしてから読みこめます。', 'error'); return; }
  busy('図面を読み取っています…');
  await nextFrame();
  try {
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch { toast('この画像は開けませんでした。JPEG か PNG の画像にしてください。', 'error'); return; }
    const k = Math.min(1, 2800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    const res = readSheet(ctx.getImageData(0, 0, c.width, c.height), { fallback: state.settings });
    if (!res.ok) { toast(res.message, 'error'); return; }

    const pc = document.createElement('canvas');
    pc.width = res.rectified.width; pc.height = res.rectified.height;
    pc.getContext('2d').putImageData(new ImageData(res.rectified.data, pc.width, pc.height), 0, 0);
    editor.pushUndo();
    state.settings = { ...state.settings, ...res.settings };
    state.sample = null;
    state.dims = emptyDims();
    editor.setTemplate(getTemplate(res.template));
    editor.photo = { canvas: pc, originMm: res.rectified.originMm, res: res.rectified.res };
    // 実線か破線かあやしい線。多すぎるとき（うすい線・小さい写真）は、1本ずつの印はやめて、まとめて知らせる
    let drawn = 0, doubtful = 0;
    for (const n of VIEW_NAMES) {
      for (const a of [res.drawing[n].V, res.drawing[n].H]) for (const t of a) if (t) drawn++;
      doubtful += res.uncertain[n].length;
    }
    const faint = drawn > 0 && doubtful > drawn * 0.25;
    editor.uncertain = faint ? null : res.uncertain;
    editor.setShowPhoto(true);
    $('photoToggle').checked = true;
    editor.setDrawing(res.drawing, { remember: false });
    showSettings();
    persist();
    $('sampleTag').hidden = true;
    showHint();
    run();

    const notes = [];
    if (res.warnings.includes('NO_LINES')) notes.push('線が見つかりませんでした。こいえんぴつで、方眼の線の上にかいてください。');
    else notes.push(state.result.ok ? '用紙を読み取って、立体にしました。' : '用紙を読み取りました。');
    if (res.warnings.includes('CODE_UNREADABLE')) notes.push('左上の設定コードが読めなかったので、いまの画面の設定で読みました。');
    if (res.warnings.includes('LOW_RESOLUTION')) notes.push('写真が小さいので、読みまちがいがあるかもしれません。');
    else if (faint) notes.push('線がうすいか、写真がぼけているので、実線と破線を読みまちがえているかもしれません。写真と見くらべてください。');
    toast(notes.join(' '), res.warnings.includes('NO_LINES') ? 'error' : '');
  } catch (e) {
    console.error(e);
    toast('読み取りのとちゅうで問題がおきました。もう一度ためしてください。', 'error');
  } finally {
    busy('');
  }
}

// ---------- 用紙の出力 ----------

function currentSvg() {
  return sheetSvg(getTemplate(state.settings.template), state.settings);
}

function showPreview() {
  $('sheetPreview').innerHTML = currentSvg();
  const svg = $('sheetPreview').querySelector('svg');
  if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '方眼用紙の見本'); }
}

async function rasterSheet(dpi) {
  const tpl = getTemplate(state.settings.template);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(currentSvg())}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.round((tpl.pageW / 25.4) * dpi); c.height = Math.round((tpl.pageH / 25.4) * dpi);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { canvas: c, tpl };
}

function sheetName(ext) {
  const tpl = getTemplate(state.settings.template);
  return `hougan-${paperName(tpl)}${tpl.landscape ? 'yoko' : 'tate'}${tpl.id}-${state.settings.scaleMm}mm.${ext}`;
}

function reportSave(r) {
  if (r.ok) toast(r.zipped ? `「${r.name}」に入れて保存しました（この画面では ZIP になります。開くと中にファイルがあります）。` : `「${r.name}」を保存しました。`);
  else if (r.reason === 'declined') toast('保存をやめました。');
  else toast('この画面では保存できませんでした。', 'error');
}

async function savePdf() {
  busy('PDFをつくっています…');
  await nextFrame();
  try {
    // A3 は画素数が多くなりすぎないように、少し粗くする
    const { canvas, tpl } = await rasterSheet(paperName(getTemplate(state.settings.template)) === 'A3' ? 240 : 300);
    const ctx = canvas.getContext('2d');
    const data = await deflateRgb(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    let image;
    if (data) image = { width: canvas.width, height: canvas.height, data, filter: 'FlateDecode' };
    else {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.93));
      image = { width: canvas.width, height: canvas.height, data: new Uint8Array(await blob.arrayBuffer()), filter: 'DCTDecode' };
    }
    busy('');
    reportSave(await saveFile(sheetName('pdf'), new Blob([buildPdf(tpl.pageW, tpl.pageH, image)], { type: 'application/pdf' })));
  } catch (e) {
    console.error(e);
    toast('PDFをつくれませんでした。「画像（PNG）で保存」をためしてください。', 'error');
  } finally {
    busy('');
  }
}

async function savePng() {
  busy('画像をつくっています…');
  await nextFrame();
  try {
    const { canvas } = await rasterSheet(paperName(getTemplate(state.settings.template)) === 'A3' ? 150 : 200);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    busy('');
    reportSave(await saveFile(sheetName('png'), blob));
  } catch (e) {
    console.error(e);
    toast('画像をつくれませんでした。', 'error');
  } finally {
    busy('');
  }
}

function printSheet() {
  const tpl = getTemplate(state.settings.template);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${sheetName('pdf')}</title><style>@page{size:${tpl.pageW}mm ${tpl.pageH}mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:${tpl.pageW}mm;height:${tpl.pageH}mm}</style></head><body>${currentSvg()}</body></html>`;
  frame.onload = () => {
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 60000);
    }, 120);
  };
  document.body.appendChild(frame);
}

// ---------- 立体の保存 ----------

async function saveStl() {
  if (!state.meshes) return;
  const buf = stlBinary(state.meshes.shell.positions, state.meshes.shell.normals, '3D Creator (mm)');
  reportSave(await saveFile(`rittai-${stamp()}.stl`, new Blob([buf], { type: 'model/stl' })));
}

async function saveGlb() {
  if (!state.meshes) return;
  const v = await ensureViewer();
  if (!v) { toast('このブラウザではGLBをつくれません。STLで保存してください。', 'error'); return; }
  try {
    const buf = await v.exportGLB(state.meshes);
    reportSave(await saveFile(`rittai-${stamp()}.glb`, new Blob([buf], { type: 'model/gltf-binary' })));
  } catch (e) {
    console.error(e);
    toast('GLBをつくれませんでした。', 'error');
  }
}

// ---------- 起動 ----------

function openSample(id) {
  const tpl = getTemplate(state.settings.template);
  const d = makeSample(id, tpl.sizes, state.settings);
  if (!d) return;
  editor.photo = null; editor.uncertain = null;
  state.sample = id;
  state.dims = emptyDims();
  editor.setDrawing(d);
  $('sampleTag').hidden = false;
  showHint();
  persist();
  run();
}

function syncButtons() {
  $('btnUndo').disabled = !editor.canUndo();
  $('btnRedo').disabled = !editor.canRedo();
  $('btnZoomOut').disabled = editor.zoom <= 1;
  $('btnZoomIn').disabled = editor.zoom >= 3;
  $('btnPan').hidden = editor.zoom <= 1;
  if (editor.zoom <= 1 && editor.tool === 'pan') editor.tool = 'solid';
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === editor.tool));
}

function start() {
  // 文字のフォント（ネットにつながらないときは、パソコンのフォントで表示される）
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Klee+One:wght@600&family=Zen+Maru+Gothic:wght@700;900&display=swap';
  document.head.appendChild(link);
  // フォントがとどいたら、方眼用紙の文字をかき直す
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { if (editor) editor.render(); });

  fillSelects();
  const saved = restore();
  if (saved) { state.settings = saved.settings; state.sample = saved.sample; state.dims = saved.dims; }
  editor = new SheetEditor($('sheet'), $('sheetWrap'), {
    onChange: (info) => {
      if (info && info.templateChanged) { state.settings.template = editor.tpl.id; showSettings(); }
      state.sample = null;
      afterEdit();
    },
    onState: () => syncButtons(),
  });
  const tpl = getTemplate(state.settings.template);
  editor.setTemplate(tpl);
  if (saved) editor.setDrawing(saved.drawing, { remember: false });
  else { state.sample = SAMPLES[0].id; editor.setDrawing(makeSample(state.sample, tpl.sizes, state.settings), { remember: false }); }
  $('sampleTag').hidden = !state.sample;
  showSettings();
  showHint();
  syncButtons();
  if (!drawingIsEmpty(editor.getDrawing())) run();
  else showResult(false);

  // 設定
  document.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.setting) onSetting(e.target); });

  // 道具
  $('tools').addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (b) editor.setTool(b.dataset.tool); });
  $('btnPan').addEventListener('click', () => editor.setTool(editor.tool === 'pan' ? 'solid' : 'pan'));
  $('btnUndo').addEventListener('click', () => editor.undo());
  $('btnRedo').addEventListener('click', () => editor.redo());
  $('btnZoomIn').addEventListener('click', () => editor.setZoom(editor.zoom + 0.5));
  $('btnZoomOut').addEventListener('click', () => editor.setZoom(editor.zoom - 0.5));
  $('photoToggle').addEventListener('change', (e) => editor.setShowPhoto(e.target.checked));
  $('btnClear').addEventListener('click', () => {
    if (drawingIsEmpty(editor.getDrawing())) return;
    editor.photo = null; editor.uncertain = null;
    state.sample = null;
    state.dims = emptyDims();
    editor.setDrawing(emptyDrawing(getTemplate(state.settings.template).sizes));
    state.result = null;
    showResult(false);
    afterEdit();
    toast('白紙にしました。「元に戻す」で前の図面にもどせます。');
  });
  $('sampleSelect').addEventListener('change', (e) => { if (e.target.value) openSample(e.target.value); e.target.value = ''; });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); editor.redo(); }
    else if (!mod && e.key === '1') editor.setTool('solid');
    else if (!mod && e.key === '2') editor.setTool('dash');
    else if (!mod && e.key === '3') editor.setTool('erase');
  });

  // 手順のボタン
  const dlg = $('dlgSheet');
  $('btnSheet').addEventListener('click', () => { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); showPreview(); });
  $('dlgClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  $('btnLoad').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; loadImage(f); });
  $('btnBuild').addEventListener('click', () => run({ byButton: true }));
  $('btnPdf').addEventListener('click', savePdf);
  $('btnPng').addEventListener('click', savePng);
  $('btnPrint').addEventListener('click', printSheet);

  // はりつけ・ドラッグ＆ドロップ
  document.addEventListener('paste', (e) => {
    const item = [...((e.clipboardData && e.clipboardData.items) || [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); loadImage(item.getAsFile()); }
  });
  const app = $('app');
  app.addEventListener('dragover', (e) => { e.preventDefault(); app.classList.add('drop-on'); });
  app.addEventListener('dragleave', (e) => { if (e.target === app || !app.contains(e.relatedTarget)) app.classList.remove('drop-on'); });
  app.addEventListener('drop', (e) => {
    e.preventDefault();
    app.classList.remove('drop-on');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadImage(f);
  });

  // 寸法らん
  const rows = $('dimRows');
  rows.addEventListener('change', (e) => { if (e.target.classList.contains('dim-in')) onDimChange(e.target); });
  rows.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('dim-in')) e.target.blur(); });
  rows.addEventListener('click', (e) => {
    const b = e.target.closest('.dim-reset');
    if (!b) return;
    state.dims[b.closest('.dim-row').dataset.axis] = { total: null, pins: {} };
    measure(); persist(); refresh3D();
  });
  const pointAt = (e) => {
    const el = e.target.closest('[data-u0]');
    editor.setDimFocus(el ? { axis: el.closest('.dim-row').dataset.axis, u0: Number(el.dataset.u0), u1: Number(el.dataset.u1) } : null);
  };
  rows.addEventListener('focusin', pointAt);
  rows.addEventListener('mouseover', pointAt);
  rows.addEventListener('focusout', () => editor.setDimFocus(null));
  rows.addEventListener('mouseleave', () => { if (!rows.contains(document.activeElement)) editor.setDimFocus(null); });

  // 立体の操作
  $('views').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b && viewer) viewer.setView(b.dataset.view); });
  $('autoRotate').addEventListener('change', (e) => { if (viewer) viewer.setAutoRotate(e.target.checked); });
  $('explode').addEventListener('input', (e) => { if (viewer) viewer.setExplode(e.target.value / 100); });
  $('btnStl').addEventListener('click', saveStl);
  $('btnGlb').addEventListener('click', saveGlb);

  // claude.ai のアーティファクトとして開いているとき: 印刷はできない。STL/GLB は ZIP に入れて保存する。
  if (inArtifact()) {
    warmUpSave();
    $('btnPrint').hidden = true;
    $('saveNote').textContent = 'この画面では、STL・GLB は ZIP に入れて保存されます（開くと中にファイルがあります）。';
  }

  // テストや確認用に、中の状態を見られるようにしておく
  window.__app = { state, editor: () => editor, viewer: () => viewer, loadImage, run };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
