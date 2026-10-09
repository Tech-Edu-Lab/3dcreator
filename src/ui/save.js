// ファイルの保存
//
// ふつうのブラウザでは、ダウンロードとして保存する。
// claude.ai のアーティファクトとして開いているときは、ページから直接ダウンロードできないので、
// 用意された保存機能（downloads）を使う。そこで使えない拡張子（.stl / .glb）は ZIP に入れて保存する。

const ALLOWED = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'txt', 'json', 'md', 'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip']);

let downloadsPromise = null;

/** アーティファクトとして開いているか */
export function inArtifact() {
  return typeof window !== 'undefined' && !!window.claude && typeof window.claude.use === 'function';
}

function downloads() {
  if (!inArtifact()) return Promise.resolve(null);
  if (!downloadsPromise) downloadsPromise = window.claude.use('downloads').catch(() => null);
  return downloadsPromise;
}

/** 起動時に呼んでおくと、保存ボタンをおしたときに待たされない */
export function warmUpSave() {
  downloads();
}

/**
 * filename: 保存するファイル名, data: Blob / ArrayBuffer / Uint8Array / 文字列
 * もどり値: { ok, name, zipped, reason }
 */
export async function saveFile(filename, data) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const ext = filename.split('.').pop().toLowerCase();
  if (inArtifact()) {
    const dl = await downloads();
    if (!dl) return { ok: false, reason: 'unavailable' };
    let name = filename, body = blob, zipped = false;
    if (!ALLOWED.has(ext)) {
      body = new Blob([zipStore([{ name: filename, data: new Uint8Array(await blob.arrayBuffer()) }])]);
      name = filename.replace(/\.[^.]+$/, '') + '.zip';
      zipped = true;
    }
    try {
      await dl.save({ filename: name, data: body });
      return { ok: true, name, zipped };
    } catch (e) {
      return { ok: false, reason: (e && e.code) || 'unavailable' };
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { ok: true, name: filename, zipped: false };
}

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 圧縮なしの ZIP をつくる。files: [{ name, data: Uint8Array }] */
export function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, 0, true); local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true); cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + size;
  }
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const endRec = new DataView(new ArrayBuffer(22));
  endRec.setUint32(0, 0x06054b50, true); endRec.setUint16(8, files.length, true); endRec.setUint16(10, files.length, true);
  endRec.setUint32(12, cdSize, true); endRec.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(endRec.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

export { crc32 };
