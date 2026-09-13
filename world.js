// world.js — procedural Vietnamese coastline: terrain, sea, road, buildings, plants.
// Everything is generated from math so the whole thing is a few hundred KB of text,
// which is exactly what GitHub Pages is good at serving.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ROAD_OFFSET = 70;   // metres inland from the waterline
export const ROAD_HALF = 7.2;    // half width of the tarmac
export const X_MIN = -2200;
export const X_MAX = 2200;

/* ------------------------------------------------------------------ */
/* small maths helpers                                                  */
/* ------------------------------------------------------------------ */

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = (r, a, b) => a + r() * (b - a);
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const smooth = (t) => t * t * (3 - 2 * t);

function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y) {
  return noise2(x, y) * 0.58 + noise2(x * 2.1, y * 2.1) * 0.27 + noise2(x * 4.3, y * 4.3) * 0.15;
}

/* ------------------------------------------------------------------ */
/* terrain profile — shared by the mesh, the car and the sea shader     */
/* ------------------------------------------------------------------ */

export function coastZ(x) {
  return 46 * Math.sin(x * 0.00092) + 20 * Math.sin(x * 0.0031 + 1.7) + 9 * Math.sin(x * 0.0071 + 0.4);
}
export function roadZ(x) { return coastZ(x) + ROAD_OFFSET; }
export function roadY(x) {
  return 7.0 + 3.0 * Math.sin(x * 0.0013 + 0.9) + 1.5 * Math.sin(x * 0.0041 + 2.2);
}

export function heightAt(x, z) {
  const d = z - coastZ(x);
  let h;
  if (d < 0) {
    const t = Math.min(1, -d / 260);
    h = -17 * smooth(t);
  } else {
    const beach = 46;
    if (d < beach) {
      h = 1.6 * smooth(d / beach);
    } else {
      const t = d - beach;
      const rise = 1.6 + 30 * (1 - Math.exp(-t / 430));
      const n = (fbm(x * 0.0016 + 11, z * 0.0016 + 7) - 0.5) * Math.min(1, t / 130) * 26;
      h = rise + n;
    }
  }
  // Flatten a corridor so the tarmac is never pierced by the landscape.
  const dr = Math.abs(d - ROAD_OFFSET);
  if (dr < 46) {
    const w = dr < 14 ? 1 : smooth(1 - (dr - 14) / 32);
    h = h * (1 - w) + roadY(x) * w;
  }
  return h;
}

/** Unit vector pointing inland, perpendicular to the road, in the XZ plane. */
export function inlandNormal(x) {
  const dz = (coastZ(x + 1) - coastZ(x - 1)) / 2;
  const len = Math.hypot(1, dz);
  return { x: -dz / len, z: 1 / len };
}

/* ------------------------------------------------------------------ */
/* districts                                                            */
/* ------------------------------------------------------------------ */

export const DISTRICTS = [
  { name: 'Bãi Dài — Cam Ranh', sub: 'Resort ven biển', x0: X_MIN, x1: -1150, kind: 'resort' },
  { name: 'Nha Trang — Trần Phú', sub: 'Đường ven biển', x0: -1150, x1: 100, kind: 'city' },
  { name: 'Làng chài ven quốc lộ', sub: 'Bãi neo thuyền thúng', x0: 100, x1: 1150, kind: 'village' },
  { name: 'Phố cổ — mô phỏng Hà Nội', sub: 'Nhà ống 36 phố phường', x0: 1150, x1: X_MAX, kind: 'oldquarter' },
];

export function districtAt(x) {
  for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1) return d;
  return DISTRICTS[x < 0 ? 0 : DISTRICTS.length - 1];
}

/* ------------------------------------------------------------------ */
/* geometry helpers with baked vertex colours                           */
/* ------------------------------------------------------------------ */

const _c = new THREE.Color();
function paint(g, color) {
  _c.set(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function box(w, h, d, color, x, y, z, rz = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, color);
}
function cyl(rt, rb, h, color, x, y, z, seg = 8) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return paint(g, color);
}

/* ------------------------------------------------------------------ */
/* building kits                                                        */
/* ------------------------------------------------------------------ */

const WALLS = ['#f0e4c8', '#e9d7a8', '#dfe8dd', '#f2ddd2', '#e3ecef', '#f5eedd', '#dfd2b8', '#e8e2d0'];
const OCHRE = ['#e4c07a', '#d9a75e', '#e8cf9c', '#cf9f6a', '#e3b985', '#d8b98d'];
const TRIM = ['#8d5b3c', '#5c6f5a', '#7a4a48', '#4d6272', '#8a7248'];
const SIGNS = ['#e2483a', '#f2b134', '#2f8f7a', '#3d6fb4', '#d94f8c'];
const AWN = ['#d1503f', '#3f7f6a', '#2f5f9e', '#d9a13b', '#8c4f7d'];

/** Nhà ống — the narrow, deep Vietnamese shophouse. Front face looks toward +Z. */
function tubeHouse(r, { minF = 2, maxF = 6, wide = false, palette = WALLS } = {}) {
  const w = wide ? rand(r, 6.5, 9.5) : rand(r, 3.8, 6.2);
  const dp = rand(r, 9, 16);
  const floors = Math.max(1, Math.round(rand(r, minF, maxF)));
  const fh = 3.35, H = floors * fh;
  const wall = pick(r, palette);
  const trim = pick(r, TRIM);
  const g = [];

  g.push(box(w, H, dp, wall, 0, H / 2, 0));
  g.push(box(w + 0.08, 2.7, 0.14, '#2a2119', 0, 1.35, dp / 2));              // shopfront
  g.push(box(w * 0.82, 0.5, 0.2, pick(r, SIGNS), 0, 2.95, dp / 2 + 0.05));   // fascia sign

  const aw = new THREE.BoxGeometry(w + 0.6, 0.1, 1.8);
  aw.rotateX(-0.2); aw.translate(0, 3.45, dp / 2 + 0.85);
  g.push(paint(aw, pick(r, AWN)));                                           // mái hiên

  for (let f = 1; f < floors; f++) {
    const y = f * fh;
    g.push(box(w + 0.55, 0.18, 1.05, '#ded7c8', 0, y, dp / 2 + 0.42));       // balcony slab
    g.push(box(w + 0.55, 0.95, 0.08, trim, 0, y + 0.56, dp / 2 + 0.92));     // railing
    g.push(box(w * 0.66, 1.55, 0.1, '#31505a', 0, y + 1.95, dp / 2 + 0.02)); // window band
  }
  g.push(box(w + 0.3, 0.75, dp + 0.3, wall, 0, H + 0.37, 0));                // parapet
  g.push(cyl(0.55, 0.55, 1.2, '#3f7fb0', w * 0.18, H + 1.35, -dp * 0.18));   // bồn nước
  if (r() > 0.45) g.push(box(w * 0.6, 2.4, dp * 0.34, wall, 0, H + 1.95, -dp * 0.16));
  if (r() > 0.4) {                                                            // vertical sign
    const sh = rand(r, 2.6, 5.2);
    g.push(box(0.16, sh, 1.1, pick(r, SIGNS), w / 2 + 0.12, rand(r, 4, Math.max(5, H - 2)), dp / 2 - 0.4));
  }
  return { geos: g, w, front: dp / 2 + 1.8 };   // awning is the frontmost part
}

/** Low village house with a pitched tile roof and a courtyard wall. */
function villageHouse(r) {
  const w = rand(r, 7, 11), dp = rand(r, 7, 10);
  const floors = r() > 0.75 ? 2 : 1;
  const H = floors * 3.2;
  const wall = pick(r, WALLS);
  const tile = pick(r, ['#9c4a33', '#8a4030', '#a85c3c', '#7d4a3a']);
  const g = [];
  g.push(box(w, H, dp, wall, 0, H / 2, 0));
  g.push(box(w * 0.5, 2.1, 0.1, '#2a2119', -w * 0.18, 1.05, dp / 2 + 0.01));
  g.push(box(1.5, 1.2, 0.1, '#31505a', w * 0.26, 1.9, dp / 2 + 0.01));
  const s = w * 0.62;
  const l = new THREE.BoxGeometry(s, 0.24, dp + 1.4); l.rotateZ(0.44); l.translate(-w * 0.24, H + 0.62, 0);
  const rr = new THREE.BoxGeometry(s, 0.24, dp + 1.4); rr.rotateZ(-0.44); rr.translate(w * 0.24, H + 0.62, 0);
  g.push(paint(l, tile), paint(rr, tile));
  g.push(box(w + 3, 1.5, 0.2, pick(r, WALLS), 0, 0.75, dp / 2 + 5));         // tường rào
  return { geos: g, w: w + 5, front: dp / 2 + 5.2 };
}

/** Long low resort block, cream walls, deep balconies. */
function resortBlock(r) {
  const w = rand(r, 16, 30), dp = rand(r, 10, 14);
  const floors = Math.round(rand(r, 2, 4));
  const fh = 3.4, H = floors * fh;
  const wall = pick(r, ['#f6f1e6', '#efe7d6', '#f3ece0']);
  const g = [];
  g.push(box(w, H, dp, wall, 0, H / 2, 0));
  for (let f = 1; f <= floors; f++) {
    g.push(box(w, 0.2, 1.6, '#e2dac9', 0, f * fh, dp / 2 + 0.7));
    g.push(box(w, 0.9, 0.08, '#6f8377', 0, f * fh + 0.55, dp / 2 + 1.45));
  }
  g.push(box(w + 1.2, 0.35, dp + 1.6, '#cfc4ad', 0, H + 0.18, 0));
  for (let i = 0; i < Math.floor(w / 6); i++) {
    g.push(cyl(0.28, 0.28, 3.2, '#e6dcc6', -w / 2 + 3 + i * 6, 1.6, dp / 2 + 1.4, 6));
  }
  return { geos: g, w: w + rand(r, 10, 26), front: dp / 2 + 1.6 };
}

/* ------------------------------------------------------------------ */
/* plants                                                              */
/* ------------------------------------------------------------------ */

function palmGeo() {
  const g = [];
  const h = 9;
  for (let i = 0; i < 3; i++) {                       // gently curved trunk
    const t = i / 3, y = t * h;
    g.push(cyl(0.22 - t * 0.08, 0.3 - t * 0.08, h / 3 + 0.1, i % 2 ? '#8a7256' : '#7d6650',
      Math.sin(t * 1.5) * 0.55, y + h / 6, 0, 5));
  }
  const bend = Math.sin(1.0) * 0.55;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const fr = new THREE.BoxGeometry(0.35, 0.1, 4.4);
    fr.rotateX(0.42); fr.translate(0, 0, 2.2); fr.rotateY(a);
    fr.translate(bend, h + 0.2, 0);
    g.push(paint(fr, i % 2 ? '#3f7a44' : '#4c8c4a'));
  }
  g.push(cyl(0.3, 0.55, 0.7, '#6f5f42', bend, h - 0.1, 0, 5));
  return mergeGeometries(g);
}

function broadleafGeo(leaf) {
  // IcosahedronGeometry is non-indexed, so everything here is flattened to
  // match before merging.
  const trunk = cyl(0.3, 0.5, 4.4, '#6b563f', 0, 2.2, 0, 6).toNonIndexed();
  const g = [paint(trunk, '#6b563f')];
  const blobs = [[2.6, 1.25, 0.80, 1.15, 0, 5.2, 0],
                 [1.9, 1.20, 0.85, 1.20, 1.6, 4.3, -0.9],
                 [1.7, 1.20, 0.85, 1.20, -1.5, 4.5, 1.0]];
  for (const [r0, sx, sy, sz, tx, ty, tz] of blobs) {
    const c = new THREE.IcosahedronGeometry(r0, 0);
    c.scale(sx, sy, sz); c.translate(tx, ty, tz);
    g.push(paint(c, leaf));
  }
  return mergeGeometries(g);
}

function boatGeo() {
  const g = [];
  const hull = new THREE.SphereGeometry(1.9, 10, 6, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
  hull.scale(1, 0.55, 1);
  g.push(paint(hull, '#c9a86b'));
  g.push(cyl(1.95, 1.95, 0.18, '#8d6f43', 0, 0, 0, 12));
  g.push(box(2.6, 0.14, 0.3, '#6f5836', 0, -0.25, 0));
  return mergeGeometries(g);
}

function poleGeo() {
  const g = [];
  g.push(box(0.28, 9, 0.28, '#9a9a92', 0, 4.5, 0));
  g.push(box(2.0, 0.16, 0.16, '#8b8b83', 0, 8.4, 0));
  g.push(box(1.5, 0.16, 0.16, '#8b8b83', 0, 7.7, 0));
  return mergeGeometries(g);
}

function lampGeo() {
  const g = [];
  g.push(cyl(0.11, 0.16, 8, '#b9c0bd', 0, 4, 0, 6));
  const arm = new THREE.BoxGeometry(2.2, 0.14, 0.14); arm.translate(1.1, 8.0, 0);
  g.push(paint(arm, '#b9c0bd'));
  g.push(box(0.85, 0.22, 0.4, '#fff3cf', 2.1, 7.86, 0));
  return mergeGeometries(g);
}

/* ------------------------------------------------------------------ */
/* sea                                                                 */
/* ------------------------------------------------------------------ */

function makeSea() {
  const g = new THREE.PlaneGeometry(5600, 1700, 220, 90);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -700);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(0.4, 0.6, 0.5) },
      uDeep: { value: new THREE.Color('#053b4f') },
      uShallow: { value: new THREE.Color('#1fa6a0') },
      uFoam: { value: new THREE.Color('#eef6f3') },
      uNight: { value: 0 },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vP;
      varying float vH;
      float coastZ(float x){
        return 46.0*sin(x*0.00092)+20.0*sin(x*0.0031+1.7)+9.0*sin(x*0.0071+0.4);
      }
      void main(){
        vec3 p = position;
        float w = sin(p.x*0.031 + uTime*1.15)*0.34
                + sin(p.z*0.047 - uTime*0.85)*0.26
                + sin((p.x+p.z)*0.017 + uTime*0.55)*0.42;
        float sh = clamp((coastZ(p.x) - p.z)/240.0, 0.0, 1.0); // 0 at shore, 1 offshore
        p.y += w * mix(0.35, 1.0, sh);
        vH = w;
        vP = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uDeep, uShallow, uFoam, uSun;
      uniform float uTime, uNight;
      varying vec3 vP;
      varying float vH;
      float coastZ(float x){
        return 46.0*sin(x*0.00092)+20.0*sin(x*0.0031+1.7)+9.0*sin(x*0.0071+0.4);
      }
      void main(){
        float d = coastZ(vP.x) - vP.z;                 // metres offshore
        float sh = clamp(d/300.0, 0.0, 1.0);
        vec3 col = mix(uShallow, uDeep, pow(sh, 0.65));

        // breaking surf: a moving band hugging the shoreline
        float band = 1.0 - smoothstep(0.0, 26.0, d);
        float surge = sin(vP.x*0.09 - uTime*2.2)*0.5 + 0.5;
        float foam = band * smoothstep(0.25, 0.9, surge*0.6 + vH*0.6 + 0.35);
        foam += (1.0 - smoothstep(0.0, 5.0, d)) * 0.55;
        col = mix(col, uFoam, clamp(foam, 0.0, 1.0));

        // cheap glitter
        vec3 n = normalize(vec3(-vH*0.35, 1.0, -vH*0.3));
        float spec = pow(max(dot(n, normalize(uSun)), 0.0), 42.0);
        col += spec * (1.0 - uNight) * 0.85;
        col = mix(col, col * vec3(0.16,0.22,0.34), uNight);

        float a = mix(0.72, 0.97, sh);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 1;
  return m;
}

/* ------------------------------------------------------------------ */
/* the world builder                                                    */
/* ------------------------------------------------------------------ */

export async function buildWorld(scene, onProgress = async () => {}) {
  const r = mulberry32(20260913);
  const parts = [];

  /* ---- terrain ---------------------------------------------------- */
  await onProgress(0.08, 'Đổ địa hình và bãi cát…');
  const NX = 300, NZ = 170;
  const zTop = -520, zBot = 940;
  const pos = [], col = [], idx = [];
  const cSea = new THREE.Color('#7d7256'), cSand = new THREE.Color('#e3d0a4');
  const cGrass = new THREE.Color('#4d6b3c'), cHill = new THREE.Color('#3a5530');
  const tmp = new THREE.Color();
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = X_MIN - 200 + (i / NX) * (X_MAX - X_MIN + 400);
      const z = zTop + (j / NZ) * (zBot - zTop);
      const y = heightAt(x, z);
      pos.push(x, y, z);
      const d = z - coastZ(x);
      if (d < 2) tmp.copy(cSea).lerp(cSand, Math.max(0, 1 + d / 90));
      else if (d < 52) tmp.copy(cSand);
      else {
        const t = Math.min(1, (d - 52) / 130);
        tmp.copy(cSand).lerp(cGrass, smooth(t));
        tmp.lerp(cHill, Math.min(0.8, Math.max(0, (y - 8) / 40)));
      }
      const v = 0.9 + fbm(x * 0.02, z * 0.02) * 0.22;
      col.push(tmp.r * v, tmp.g * v, tmp.b * v);
    }
  }
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d2 = c + 1;
      idx.push(a, c, b, b, c, d2);
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  const ground = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true }));
  ground.receiveShadow = true;
  scene.add(ground);
  parts.push(ground);

  /* ---- sea -------------------------------------------------------- */
  const sea = makeSea();
  scene.add(sea);

  /* ---- road ------------------------------------------------------- */
  await onProgress(0.25, 'Trải nhựa quốc lộ ven biển…');
  const rp = [], rc = [], ri = [];
  const dashP = [], dashI = [];
  const STEP = 6;
  let row = 0;
  const asphalt = new THREE.Color('#3a3c3d'), edge = new THREE.Color('#57585a');
  for (let x = X_MIN - 120; x <= X_MAX + 120; x += STEP, row++) {
    const n = inlandNormal(x);
    const cz = roadZ(x), cy = roadY(x) + 0.08;
    const w = ROAD_HALF;
    for (const [o, c] of [[-w - 1.6, edge], [-w, asphalt], [0, asphalt], [w, asphalt], [w + 1.6, edge]]) {
      rp.push(x + n.x * o, cy + (Math.abs(o) > w ? -0.1 : 0), cz + n.z * o);
      rc.push(c.r, c.g, c.b);
    }
    dashP.push(x + n.x * -0.18, cy + 0.02, cz + n.z * -0.18);
    dashP.push(x + n.x * 0.18, cy + 0.02, cz + n.z * 0.18);
  }
  const cols = 5;
  for (let j = 0; j < row - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d2 = c + 1;
      ri.push(a, c, b, b, c, d2);
    }
  }
  for (let j = 0; j < row - 1; j++) {
    if (Math.floor(j / 2) % 2) continue;                 // dashed centre line
    const a = j * 2, b = a + 1, c = a + 2, d2 = a + 3;
    dashI.push(a, c, b, b, c, d2);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  rg.setIndex(ri); rg.computeVertexNormals();
  const road = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ vertexColors: true }));
  road.receiveShadow = true;
  scene.add(road); parts.push(road);

  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(dashP, 3));
  dg.setIndex(dashI); dg.computeVertexNormals();
  const dash = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ color: '#e6e2cf' }));
  scene.add(dash); parts.push(dash);

  /* ---- buildings -------------------------------------------------- */
  await onProgress(0.42, 'Dựng nhà ống, resort và làng chài…');
  // Buildings are merged into 300 m chunks: one draw call per chunk, and the
  // frustum can throw away everything behind the car.
  const CHUNK = 300;
  const chunks = new Map();
  const buildingMeshes = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

  function drop(local, x, dist, jitter) {
    const n = inlandNormal(x);
    const px = x + n.x * dist, pz = roadZ(x) + n.z * dist;
    _p.set(px, heightAt(px, pz) - 0.7, pz);
    q.setFromAxisAngle(up, Math.atan2(-n.x, -n.z) + rand(r, -0.06, 0.06) + jitter);
    m4.compose(_p, q, _s);
    const key = Math.floor(x / CHUNK);
    let arr = chunks.get(key);
    if (!arr) { arr = []; chunks.set(key, arr); }
    for (const g of local) { g.applyMatrix4(m4); arr.push(g); }
  }

  for (const dst of DISTRICTS) {
    const plans = {
      resort:     [{ d: 20, gap: 14 }],
      city:       [{ d: 11, gap: 6 }, { d: 34, gap: 7 }],
      village:    [{ d: 12, gap: 10 }, { d: 38, gap: 14 }],
      oldquarter: [{ d: 10.5, gap: 3 }, { d: 33, gap: 3 }, { d: 55, gap: 4 }, { d: 77, gap: 5 }],
    }[dst.kind];

    for (const plan of plans) {
      let x = dst.x0 + 8;
      while (x < dst.x1 - 8) {
        let b;
        if (dst.kind === 'resort') b = r() > 0.35 ? resortBlock(r) : villageHouse(r);
        else if (dst.kind === 'city') b = tubeHouse(r, { minF: 3, maxF: 8, wide: r() > 0.7 });
        else if (dst.kind === 'village') b = r() > 0.3 ? villageHouse(r) : tubeHouse(r, { minF: 1, maxF: 3 });
        else b = tubeHouse(r, { minF: 3, maxF: 5, palette: OCHRE });
        drop(b.geos, x + b.w / 2, plan.d + b.front, 0);
        x += b.w + rand(r, 0, plan.gap);
      }
    }
  }
  for (const arr of chunks.values()) {
    const mesh = new THREE.Mesh(
      mergeGeometries(arr), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh); parts.push(mesh); buildingMeshes.push(mesh);
  }
  chunks.clear();

  /* ---- vegetation & street furniture ------------------------------ */
  await onProgress(0.66, 'Trồng dừa, phi lao và cột điện…');

  function instanced(geo, count, place, cast = true) {
    const mesh = new THREE.InstancedMesh(
      geo, new THREE.MeshLambertMaterial({ vertexColors: true }), count);
    const m = new THREE.Matrix4(), s = new THREE.Vector3(), qq = new THREE.Quaternion(), p = new THREE.Vector3();
    let k = 0;
    for (let i = 0; i < count; i++) {
      if (!place(i, p, s, qq)) continue;
      m.compose(p, qq, s); mesh.setMatrixAt(k++, m);
    }
    mesh.count = k;
    mesh.castShadow = cast;
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh); parts.push(mesh);
    return mesh;
  }

  // coconut palms on the beach strip
  instanced(palmGeo(), 850, (i, p, s, qq) => {
    const x = rand(r, X_MIN, X_MAX);
    const d = rand(r, 8, 46);
    const n = inlandNormal(x);
    p.set(x + n.x * d, 0, coastZ(x) + n.z * d);
    p.y = heightAt(p.x, p.z) - 0.2;
    if (p.y < 0.1) return false;
    const sc = rand(r, 0.75, 1.35);
    s.set(sc, sc, sc);
    qq.setFromAxisAngle(up, r() * Math.PI * 2);
    return true;
  }, false);

  // palms + trees lining the road, and hillside greenery inland
  instanced(palmGeo(), 420, (i, p, s, qq) => {
    const x = rand(r, X_MIN, X_MAX);
    const side = r() > 0.5 ? -1 : 1;
    const d = side * rand(r, 11, 20);
    const n = inlandNormal(x);
    p.set(x + n.x * d, 0, roadZ(x) + n.z * d);
    p.y = heightAt(p.x, p.z) - 0.2;
    const sc = rand(r, 0.8, 1.15); s.set(sc, sc, sc);
    qq.setFromAxisAngle(up, r() * Math.PI * 2);
    return true;
  }, false);

  for (const [leaf, n0] of [['#3f6b34', 700], ['#4f8040', 520], ['#b8402f', 130]]) {
    instanced(broadleafGeo(leaf), n0, (i, p, s, qq) => {
      const x = rand(r, X_MIN - 150, X_MAX + 150);
      const d = rand(r, 60, 620);
      const n = inlandNormal(x);
      p.set(x + n.x * d, 0, roadZ(x) + n.z * d);
      p.y = heightAt(p.x, p.z) - 0.3;
      const sc = rand(r, 0.7, 1.6); s.set(sc, sc, sc);
      qq.setFromAxisAngle(up, r() * Math.PI * 2);
      return true;
    }, false);
  }

  // power poles + street lamps every 34 m of highway
  const nPole = Math.floor((X_MAX - X_MIN) / 34);
  instanced(poleGeo(), nPole, (i, p, s, qq) => {
    const x = X_MIN + i * 34;
    const n = inlandNormal(x), d = 11.5;
    p.set(x + n.x * d, 0, roadZ(x) + n.z * d);
    p.y = heightAt(p.x, p.z) - 0.2;
    s.set(1, 1, 1);
    qq.setFromAxisAngle(up, Math.atan2(n.x, n.z));
    return true;
  }, false);
  const lamps = instanced(lampGeo(), Math.floor((X_MAX - X_MIN) / 52), (i, p, s, qq) => {
    const x = X_MIN + i * 52;
    const n = inlandNormal(x), d = -9.6;
    p.set(x + n.x * d, 0, roadZ(x) + n.z * d);
    p.y = heightAt(p.x, p.z) - 0.2;
    s.set(1, 1, 1);
    qq.setFromAxisAngle(up, Math.atan2(-n.z, n.x));   // arm reaches over the tarmac
    return true;
  }, false);

  // sagging overhead wires — the signature of a Vietnamese street
  const wp = [];
  for (let i = 0; i < nPole - 1; i++) {
    const xa = X_MIN + i * 34, xb = xa + 34;
    for (const lv of [8.4, 7.7]) {
      let prev = null;
      for (let t = 0; t <= 4; t++) {
        const x = xa + (xb - xa) * (t / 4);
        const n = inlandNormal(x), d = 11.5;
        const px = x + n.x * d, pz = roadZ(x) + n.z * d;
        const sag = Math.sin((t / 4) * Math.PI) * 0.9;
        const cur = [px, heightAt(px, pz) - 0.2 + lv - sag, pz];
        if (prev) wp.push(...prev, ...cur);
        prev = cur;
      }
    }
  }
  const wires = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)),
    new THREE.LineBasicMaterial({ color: '#20262a', transparent: true, opacity: 0.75 })
  );
  scene.add(wires); parts.push(wires);

  /* ---- thuyền thúng bobbing offshore ------------------------------ */
  const boats = instanced(boatGeo(), 90, (i, p, s, qq) => {
    const x = rand(r, 80, 1200);                       // near the fishing village
    p.set(x, 0, coastZ(x) - rand(r, 20, 190));
    const sc = rand(r, 0.8, 1.5); s.set(sc, sc, sc);
    qq.setFromAxisAngle(up, r() * Math.PI * 2);
    return true;
  }, false);

  await onProgress(0.9, 'Chỉnh nắng, sương biển và đường chân trời…');

  return {
    sea, ground, road, lamps, boats, buildingMeshes, parts,
    update(t) { sea.material.uniforms.uTime.value = t; },
    setNight(k, sunDir) {
      sea.material.uniforms.uNight.value = k;
      sea.material.uniforms.uSun.value.copy(sunDir);
    },
  };
}
