// viewer.js — the 3D Forge view (Three.js). Takes the plain mesh data the
// compiler returns; never touches manifold-3d. Everything here is cosmetic,
// so it can change freely without affecting the printability contract.
//
// Tiers are coloured by height (each triangle by its top), and glow hotter
// the higher they sit: the multi-colour layer swaps read as a heat gradient.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

/** Split a welded mesh into three flat-shaded geometries by relief tier. */
function tierGeometries(mesh, relief) {
  const P = mesh.positions, I = mesh.indices;
  const buckets = [[], [], []];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const zt = Math.max(P[a + 2], P[b + 2], P[c + 2]) - 1e-3;
    const tier = zt <= relief.t1 ? 0 : zt <= relief.t2 ? 1 : 2;
    buckets[tier].push(P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]);
  }
  return buckets.map((arr) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    return g;
  });
}

export class Forge {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.9;

    this.scene.add(new THREE.HemisphereLight(0xffd9b0, 0x2a0f24, 0.25));
    const key = new THREE.DirectionalLight(0xfff1e0, 1.4); key.position.set(-40, 60, 90); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff6a2a, 0.9); rim.position.set(40, -50, 25); this.scene.add(rim);
    const cold = new THREE.DirectionalLight(0x9fd8ff, 0.35); cold.position.set(-50, -30, 40); this.scene.add(cold);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.showBridges = true;
    this.radius = 25;

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(el);
    this.resize();
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(loop); };
    loop();
  }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.group && this.group.children.length && this.lastView) this.view(this.lastView);
  }

  clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.geometry && o.geometry.dispose();
      o.material && o.material.dispose();
    }
  }

  /** Show a compile result ({ mesh, bridgeMesh, genome }). */
  show(r, { reframe = false } = {}) {
    if (!r || !r.mesh) return;
    this.clear();
    const pal = r.genome.palette, relief = r.genome.relief;
    const glow = [0.0, 0.06, 0.22];
    tierGeometries(r.mesh, relief).forEach((geo, i) => {
      const col = new THREE.Color([pal.t1, pal.t2, pal.t3][i]);
      const mat = new THREE.MeshPhysicalMaterial({
        color: col, metalness: 0.55 + i * 0.1, roughness: 0.5 - i * 0.08, clearcoat: 0.25,
        emissive: col, emissiveIntensity: glow[i],
      });
      this.group.add(new THREE.Mesh(geo, mat));
    });
    if (r.bridgeMesh) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(r.bridgeMesh.positions, 3));
      g.setIndex(new THREE.BufferAttribute(r.bridgeMesh.indices, 1));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: pal.bridge, transparent: true, opacity: 0.8 }));
      m.name = 'bridges';
      m.visible = this.showBridges;
      this.group.add(m);
    }
    const R = r.radius || 25;
    if (reframe || Math.abs(R - this.radius) > 1) { this.radius = R; this.view('tilt'); }
  }

  setBridges(on) {
    this.showBridges = on;
    const b = this.group.getObjectByName('bridges');
    if (b) b.visible = on;
  }

  setSpin(on) { this.controls.autoRotate = on; }

  view(name) {
    this.lastView = name;
    const R = this.radius;
    const fit = (R * 1.35) / Math.tan((this.camera.fov * Math.PI) / 360);
    const d = fit / Math.min(1, this.camera.aspect);
    const at = { top: [0, -0.001, 1], tilt: [0, -0.75, 0.9], side: [0, -1, 0.12], low: [0.5, -0.8, 0.35] }[name] || [0, -0.75, 0.9];
    const v = new THREE.Vector3(...at).normalize().multiplyScalar(d);
    this.camera.position.copy(v);
    this.controls.target.set(0, 0, 2);
    this.controls.update();
  }

  snapshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
}
