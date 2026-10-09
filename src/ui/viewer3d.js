// 3Dビュー: 立体を表示して、ドラッグで360度回せるようにする（three.js）。
//
// three.js の座標は Y が上。立体の座標 (x:左右, y:前後, z:上下) は (x, z, -y) に置きかえる。
// こうすると、画面の手前が正面図の向きになる。

import {
  Scene, OrthographicCamera, WebGLRenderer, BufferGeometry, BufferAttribute, Mesh, MeshLambertMaterial,
  MeshStandardMaterial, EdgesGeometry, LineSegments, LineBasicMaterial, HemisphereLight, DirectionalLight,
  Group, Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// 板の色（木の色を少しずつ変えて、板の境目が分かるようにする）
const WOOD = ['#e2bd8a', '#d3a56c', '#ecd3a8', '#c99657', '#e8c796', '#d8b27c', '#f0dcb8', '#bf8a4c'];
const EDGE = '#3b2a1a';

/** 立体座標の三角形 → three.js の座標（中心を原点に） */
function toThree(src, center, isNormal) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    if (isNormal) { out[i] = src[i]; out[i + 1] = src[i + 2]; out[i + 2] = -src[i + 1]; }
    else { out[i] = src[i] - center[0]; out[i + 1] = src[i + 2] - center[2]; out[i + 2] = -(src[i + 1] - center[1]); }
  }
  return out;
}

export class Viewer3D {
  constructor(container) {
    this.container = container;
    this.scene = new Scene();
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', '立体の表示。ドラッグで回せます。');
    container.appendChild(this.canvas);

    this.scene.add(new HemisphereLight(0xffffff, 0x8b8f98, 1.25));
    this.light = new DirectionalLight(0xffffff, 1.9);
    this.camera.add(this.light);
    this.light.position.set(-0.6, 0.9, 1.2); // カメラから見て左上の手前から照らす
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.9;
    this.controls.addEventListener('change', () => this.draw());

    this.group = new Group();
    this.scene.add(this.group);
    this.parts = [];
    this.radius = 100;
    this.explode = 0;
    this.auto = false;
    this.raf = 0;
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  /** meshes: buildMeshes() の結果。keepView: 見ている向きをそのままにする（図面を直しながら見るとき） */
  setModel(meshes, { keepView = false } = {}) {
    const had = this.parts.length > 0;
    this.clear();
    const [sx, sy, sz] = meshes.size;
    const center = [sx / 2, sy / 2, sz / 2];
    this.radius = Math.max(10, Math.hypot(sx, sy, sz) / 2);
    meshes.parts.forEach((p, n) => {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(toThree(p.positions, center, false), 3));
      geo.setAttribute('normal', new BufferAttribute(toThree(p.normals, center, true), 3));
      geo.computeBoundingBox();
      const mat = new MeshLambertMaterial({ color: WOOD[n % WOOD.length], polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const mesh = new Mesh(geo, mat);
      const lines = new LineSegments(new EdgesGeometry(geo, 1), new LineBasicMaterial({ color: EDGE }));
      const holder = new Group();
      holder.add(mesh, lines);
      holder.userData.dir = geo.boundingBox.getCenter(new Vector3());
      holder.name = `板${n + 1}`;
      this.group.add(holder);
      this.parts.push({ holder, mesh, lines, color: WOOD[n % WOOD.length], id: p.id });
    });
    this.applyExplode();
    if (keepView && had) {
      // 向きはそのまま、大きさだけ合わせ直す
      const dist = this.radius * 4;
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
      this.camera.far = dist * 3;
      this.fit();
      this.controls.update();
      this.draw();
    } else this.setView('iso');
  }

  clear() {
    for (const p of this.parts) {
      p.mesh.geometry.dispose(); p.mesh.material.dispose();
      p.lines.geometry.dispose(); p.lines.material.dispose();
      this.group.remove(p.holder);
    }
    this.parts = [];
    this.draw();
  }

  /** 部品をばらして見せる（t: 0〜1） */
  setExplode(t) { this.explode = t; this.applyExplode(); this.fit(); this.draw(); }

  applyExplode() {
    for (const p of this.parts) p.holder.position.copy(p.holder.userData.dir).multiplyScalar(this.explode * 0.9);
  }

  /** 見る向き: iso（ななめ上）/ front（正面）/ top（上）/ side（右） */
  setView(name) {
    const r = this.radius * 4;
    const dir = {
      iso: [0.82, 0.62, 1.0],
      front: [0, 0, 1],
      top: [0, 1, 0.0002],
      side: [1, 0, 0],
    }[name] || [0.82, 0.62, 1.0];
    const v = new Vector3(...dir).normalize().multiplyScalar(r);
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(v);
    this.camera.zoom = 1;
    this.camera.near = 0.1;
    this.camera.far = r * 3;
    this.fit();
    this.controls.update();
    this.draw();
  }

  setAutoRotate(on) {
    this.auto = on;
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 2.4;
    cancelAnimationFrame(this.raf);
    if (on) {
      const tick = () => { this.controls.update(); this.raf = requestAnimationFrame(tick); };
      this.raf = requestAnimationFrame(tick);
    }
  }

  fit() {
    const w = this.container.clientWidth || 300, h = this.container.clientHeight || 300;
    const aspect = w / h;
    const half = this.radius * (1.12 + this.explode * 1.0);
    const hh = aspect >= 1 ? half : half / aspect;
    this.camera.left = -hh * aspect; this.camera.right = hh * aspect;
    this.camera.top = hh; this.camera.bottom = -hh;
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.fit();
    this.draw();
  }

  draw() {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * GLB（glTF バイナリ）にする。単位はメートル、Y が上。部品ごとに分かれたまま入る。
   * meshes: buildMeshes() の結果
   */
  async exportGLB(meshes) {
    const scene = new Scene();
    const root = new Group();
    root.name = '立体';
    const center = [meshes.size[0] / 2, meshes.size[1] / 2, 0]; // 底を高さ0に
    meshes.parts.forEach((p, n) => {
      const geo = new BufferGeometry();
      const pos = toThree(p.positions, center, false);
      for (let i = 0; i < pos.length; i++) pos[i] *= 0.001;
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('normal', new BufferAttribute(toThree(p.normals, center, true), 3));
      const mesh = new Mesh(geo, new MeshStandardMaterial({ color: WOOD[n % WOOD.length], roughness: 0.85, metalness: 0 }));
      mesh.name = `板${n + 1}`;
      root.add(mesh);
    });
    scene.add(root);
    const exporter = new GLTFExporter();
    const result = await new Promise((resolve, reject) => exporter.parse(scene, resolve, reject, { binary: true }));
    root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    return result;
  }
}
