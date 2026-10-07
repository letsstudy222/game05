// world.js — terrain, sea, road ribbon, buildings, vegetation, street furniture.
// Everything is generated in code from one seeded PRNG: no external assets, no
// map data, and an identical world on every reload.
//
// Culling rule followed throughout: nothing is ever a single world-sized mesh.
// Static geometry is merged into ~400 m chunks so the frustum can throw it away.

import * as THREE from 'three';
import { routeX, STAGES } from './route.js';
import { buildCoastalDetails } from './scenery.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// world extents
// ---------------------------------------------------------------------------

export const WORLD = {
  zMin: -3200, zMax: 3200,   // the road runs roughly north-south along the coast
  xMin: -900, xMax: 1100,    // sea to the west (-x), mountains to the east (+x)
  roadHalfWidth: 4.6,        // tarmac half width; also the off-road test
  chunk: 400
};

// ---------------------------------------------------------------------------
// seeded randomness
// ---------------------------------------------------------------------------

export function makeRng(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, z, oct) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < (oct || 4); i++) { s += amp * vnoise(x * f, z * f); amp *= 0.5; f *= 2; }
  return s;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Road follows a compressed geographic reference corridor. The coastline in 3D
// is stylized; the expanded map uses the separate Natural Earth geographic data.
// ---------------------------------------------------------------------------

export function roadCenterX(z) {
  return routeX(z);
}

export function roadY(z) {
  const ridge = Math.exp(-Math.pow((z - 950) / 420, 2));
  return 4.2 + ridge * 30 + 1.2 * Math.sin(z * 0.0013);
}

export function coastX(z) {
  const town = smooth(clamp((z - 2380) / 220, 0, 1));
  return roadCenterX(z) - lerp(100 + 22 * Math.sin(z * 0.002), 54, town);
}

export function roadTangent(z) {
  const d = roadCenterX(z + 0.5) - roadCenterX(z - 0.5);
  const len = Math.hypot(d, 1);
  return { x: d / len, z: 1 / len };
}

// A point offset from the road centre. Positive `off` is INLAND (+x side),
// negative is seaward. `yaw` orients an object whose local +Z points away from
// the road, so buildings and lamps always face the tarmac.
export function sidePoint(z, off) {
  const t = roadTangent(z);
  const roadYaw = Math.atan2(t.x, t.z);
  return {
    x: roadCenterX(z) + t.z * off,
    z: z - t.x * off,
    yaw: roadYaw + (off >= 0 ? Math.PI / 2 : -Math.PI / 2),
    roadYaw
  };
}

const FLAT = 26;    // fully flat corridor half width
const BLEND = 84;   // blends back to natural terrain by here

// ---------------------------------------------------------------------------
// heightAt — THE single source of truth for ground height. The terrain mesh,
// the car and every object placement call this. Never duplicate it.
// ---------------------------------------------------------------------------

export function heightAt(x, z) {
  const d = x - coastX(z);          // metres inland from the waterline
  let h;

  if (d < 0) {
    const s = -d / 230;
    h = -Math.pow(s, 1.25) * 27 - 0.25;
    if (h < -60) h = -60;
  } else {
    const beach = Math.min(1, d / 30);
    h = beach * beach * 1.9;

    const inland = Math.max(0, d - 34);
    const ramp = Math.min(1, inland / 280);
    const hills = fbm(x * 0.0016, z * 0.0016, 4);
    const bumps = fbm(x * 0.0062 + 50, z * 0.0062 + 50, 3);
    h += ramp * (hills * 46 + bumps * 7) * Math.min(1, 0.35 + inland / 900);

    const far = Math.max(0, x - 520) / 600;
    h += far * far * 92 * (0.6 + 0.5 * fbm(x * 0.0009 + 9, z * 0.0009 + 9, 3));
  }

  const dr = Math.abs(x - roadCenterX(z));
  let w = 0;
  if (dr <= FLAT) w = 1;
  else if (dr < BLEND) w = smooth(1 - (dr - FLAT) / (BLEND - FLAT));
  w *= smooth(clamp(d / 22, 0, 1));
  if (w > 0) h = h * (1 - w) + roadY(z) * w;

  return h;
}

// ---------------------------------------------------------------------------
// districts
// ---------------------------------------------------------------------------

export const DISTRICTS = STAGES;

export function districtAt(z) {
  for (let i = 0; i < DISTRICTS.length; i++) {
    if (z >= DISTRICTS[i].z0 && z < DISTRICTS[i].z1) return DISTRICTS[i];
  }
  return DISTRICTS[z < 0 ? 0 : DISTRICTS.length - 1];
}

// ---------------------------------------------------------------------------
// geometry helpers — all static geometry carries baked vertex colours
// ---------------------------------------------------------------------------

const _c = new THREE.Color();

function tint(geo, color, jitter) {
  _c.set(color);
  if (jitter) { _c.r *= jitter; _c.g *= jitter; _c.b *= jitter; }
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function box(w, h, d, color, x, y, z, yaw, jitter) {
  const g = new THREE.BoxGeometry(w, h, d);
  tint(g, color, jitter);
  if (yaw) g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

function cyl(rt, rb, h, seg, color, x, y, z, jitter) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1);
  tint(g, color, jitter);
  g.translate(x, y, z);
  return g;
}

const pick = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

// bucket things by z into ~400 m chunks
function chunkKey(z) { return Math.floor(z / WORLD.chunk); }
function bucket(map, z, item) {
  const k = chunkKey(z);
  let a = map.get(k);
  if (!a) { a = []; map.set(k, a); }
  a.push(item);
}

const STATIC_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.87 });
// World-space grain stays stable as the camera moves; no external texture downloads.
STATIC_MAT.onBeforeCompile = shader => {
  shader.vertexShader = 'varying vec3 vDetail;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDetail = (modelMatrix * vec4(position, 1.0)).xyz;');
  shader.fragmentShader = 'varying vec3 vDetail;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    float grain = fract(sin(dot(floor(vDetail.xz * 6.0), vec2(127.1,311.7))) * 43758.5453);
    float ripple = sin(vDetail.x * 3.0 + sin(vDetail.z * 0.8));
    diffuseColor.rgb *= 0.94 + grain * 0.10 + ripple * 0.018;`);
};
const PLANT_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
const windTime = { value: 0 };
PLANT_MAT.onBeforeCompile = shader => {
  shader.uniforms.uWindTime = windTime;
  shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    transformed.x += sin(uWindTime * 0.9 + position.y * 0.8) * pow(max(0.0, position.y - 3.0) / 8.0, 2.0) * 0.16;`);
};

function mergedMeshes(map, opts) {
  const out = [];
  for (const [, geos] of map) {
    if (!geos.length) continue;
    const m = new THREE.Mesh(mergeGeometries(geos, false), (opts && opts.material) || STATIC_MAT);
    m.castShadow = !!(opts && opts.cast);
    m.receiveShadow = !!(opts && opts.receive);
    m.geometry.computeBoundingSphere();
    out.push(m);
  }
  return out;
}

// one InstancedMesh per chunk so frustum culling still bites
function instancedChunks(geo, itemMap, name, material) {
  const group = new THREE.Group();
  group.name = name;
  const d = new THREE.Object3D();
  for (const [, items] of itemMap) {
    if (!items.length) continue;
    const m = new THREE.InstancedMesh(geo, material || PLANT_MAT, items.length);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      d.position.set(it.x, it.y, it.z);
      d.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
      d.scale.setScalar(it.s || 1);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = false;
    m.receiveShadow = false;
    m.computeBoundingSphere();
    group.add(m);
  }
  return group;
}

// ---------------------------------------------------------------------------
// terrain
// ---------------------------------------------------------------------------

const SAND = new THREE.Color('#e0cd9e');
const SCRUB = new THREE.Color('#8a9b5e');
const GREEN = new THREE.Color('#4f7343');
const DARKGREEN = new THREE.Color('#375a3a');
const ROCK = new THREE.Color('#7b7468');
const SEABED = new THREE.Color('#3f6a6b');

function terrainColor(x, z, h, out) {
  const beachWidth = districtAt(z).kind === 'resort' ? 70 : 38;
  if (h < -0.2) {
    out.copy(SEABED).lerp(SAND, clamp(1 + h / 6, 0, 1));
  } else if (h < 2.4 || (x - coastX(z) > 0 && x - coastX(z) < beachWidth)) {
    out.copy(SAND);
    out.multiplyScalar(0.84 + 0.16 * smooth(clamp((x - coastX(z)) / 12, 0, 1)));
  } else {
    out.copy(SCRUB).lerp(GREEN, smooth(clamp((h - 2.4) / 26, 0, 1)));
    if (h > 34) out.lerp(ROCK, clamp((h - 34) / 55, 0, 1));
    if (h > 12 && h < 40) out.lerp(DARKGREEN, 0.25 * vnoise(x * 0.01, z * 0.01));
  }
  out.multiplyScalar(0.9 + 0.2 * vnoise(x * 0.004 + 3, z * 0.004 + 3));
  return out;
}

function buildTerrain() {
  // denser X sampling across the beach + road band, coarse out to the edges
  const xs = [];
  for (let x = WORLD.xMin; x < -180; x += 30) xs.push(x);
  for (let x = -180; x < 320; x += 8) xs.push(x);
  for (let x = 320; x <= WORLD.xMax; x += 30) xs.push(x);

  const rowsPerSlab = 40;
  const dz = WORLD.chunk / rowsPerSlab;
  const cols = xs.length;

  const slabs = Math.ceil((WORLD.zMax - WORLD.zMin) / WORLD.chunk);
  const tmp = new THREE.Color();
  const meshes = [];

  for (let s = 0; s < slabs; s++) {
    const z0 = WORLD.zMin + s * WORLD.chunk;
    const rows = rowsPerSlab + 1;                 // +1 row of overlap: no seams
    const pos = new Float32Array(cols * rows * 3);
    const col = new Float32Array(cols * rows * 3);

    for (let j = 0; j < rows; j++) {
      const z = z0 + j * dz;
      for (let i = 0; i < cols; i++) {
        const k = (j * cols + i) * 3;
        const x = xs[i];
        let h = heightAt(x, z);
        // Estuary cut beneath the Bình Tân bridge. The vehicle height sampler
        // retains the deck elevation, while the terrain mesh sits below it.
        const riverWidth = 26 + 3 * Math.sin(x * 0.018);
        const river = smooth(clamp((riverWidth - Math.abs(z - 2200)) / 6, 0, 1));
        if (x < roadCenterX(2200) + 170) h = lerp(h, -3.5, river);
        pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
        terrainColor(x, z, h, tmp);
        col[k] = tmp.r; col[k + 1] = tmp.g; col[k + 2] = tmp.b;
      }
    }

    const idx = [];
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, STATIC_MAT);
    mesh.receiveShadow = true;
    mesh.name = 'terrain' + s;
    meshes.push(mesh);
  }
  return meshes;
}

// ---------------------------------------------------------------------------
// sea + surf
// ---------------------------------------------------------------------------

// Sample the same JS coastline in the ocean shader, avoiding divergent shoreline formulas.
const GLSL_COAST = `
  uniform sampler2D uCoastMap;
  float coastX(float z){
    float u = clamp((z + 3200.0) / 6400.0, 0.0, 1.0) * 1023.0;
    float i = floor(u);
    float a = texture2D(uCoastMap, vec2((i + 0.5) / 1024.0, 0.5)).r;
    float b = texture2D(uCoastMap, vec2((min(i + 1.0, 1023.0) + 0.5) / 1024.0, 0.5)).r;
    return mix(a, b, fract(u));
  }
`;
function coastTexture() {
  const values = new Float32Array(1024 * 4);
  for (let i = 0; i < 1024; i++) { values[i*4] = coastX(WORLD.zMin + i/1023*6400); values[i*4+3] = 1; }
  const texture = new THREE.DataTexture(values, 1024, 1, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

function buildSea() {
  const geo = new THREE.PlaneGeometry(2600, WORLD.zMax - WORLD.zMin + 900, 40, 120);
  geo.rotateX(-Math.PI / 2);
  geo.translate(-1000, 0, (WORLD.zMin + WORLD.zMax) / 2);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCoastMap: { value: coastTexture() },
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color('#37b8b1') },
      uDeep: { value: new THREE.Color('#0d4863') },
      uSun: { value: new THREE.Vector3(0.4, 0.7, 0.5) },
      uSunColor: { value: new THREE.Color('#fff2cf') },
      uNight: { value: 0 },
      uFogColor: { value: new THREE.Color('#bcd9e2') },
      uFogNear: { value: 500 },
      uFogFar: { value: 2400 }
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        wp.y += sin(wp.x * 0.035 + wp.z * 0.021 + uTime * 0.7) * 0.22;
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      precision highp float;
      uniform float uTime, uNight, uFogNear, uFogFar;
      uniform vec3 uShallow, uDeep, uSun, uSunColor, uFogColor;
      varying vec3 vW;
      ${GLSL_COAST}
      void main(){
        float off = coastX(vW.z) - vW.x;                  // metres offshore
        if (off < -2.0) discard;
        float t = clamp(off / 280.0, 0.0, 1.0);
        vec3 col = mix(uShallow, uDeep, pow(t, 0.7));

        // ripples live entirely in the fragment shader: the plane stays flat,
        // which keeps the vertex count (and the frame time) low.
        float a = sin(vW.x * 0.085 + uTime * 1.05);
        float b = sin(vW.z * 0.121 - uTime * 0.83);
        float c = sin((vW.x * 0.6 + vW.z) * 0.037 + uTime * 0.55);
        vec3 n = normalize(vec3((a * 0.55 + c * 0.45) * 0.075, 1.0, (b * 0.6 + c * 0.4) * 0.075));

        vec3 v = normalize(cameraPosition - vW);
        vec3 s = normalize(uSun);
        float spec = pow(max(dot(reflect(-s, n), v), 0.0), 70.0);
        float sheen = pow(1.0 - max(dot(n, v), 0.0), 3.0);

        col += uSunColor * spec * (1.0 - uNight) * 0.95;
        col = mix(col, uFogColor * 0.9 + uSunColor * 0.1, sheen * 0.45);
        float crest = pow(max(0.0, sin(off * 0.65 - uTime * 1.6 + sin(vW.z * 0.09))), 12.0);
        float foam = crest * (1.0 - smoothstep(3.0, 30.0, off));
        col = mix(col, vec3(0.91, 0.98, 0.97), foam * 0.85);
        col *= 1.0 + 0.035 * (a + b);
        col *= mix(1.0, 0.28, uNight);

        float dist = length(cameraPosition - vW);
        col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));
        gl_FragColor = vec4(col, 1.0);
      }`
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  mesh.name = 'sea';
  return mesh;
}

function buildSurf() {
  const step = 9;
  const n = Math.floor((WORLD.zMax - WORLD.zMin) / step);
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  const OUT = 25, IN = 6;

  for (let i = 0; i <= n; i++) {
    const z = WORLD.zMin + i * step;
    const cx = coastX(z);
    const k = i * 6, u = i * 4;
    pos[k] = cx - OUT; pos[k + 1] = 0.14; pos[k + 2] = z;
    pos[k + 3] = cx + IN; pos[k + 4] = 0.6; pos[k + 5] = z;
    uv[u] = i * step * 0.02; uv[u + 1] = 0;
    uv[u + 2] = i * step * 0.02; uv[u + 3] = 1;
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      varying float vDepth;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision mediump float;
      uniform float uTime, uNight;
      varying vec2 vUv;
      varying float vDepth;
      void main(){
        // a swell travelling along the shore: foam builds, breaks, washes up
        float phase = fract(vUv.x * 0.35 - uTime * 0.11);
        float sweep = smoothstep(0.0, 0.35, phase) * smoothstep(1.0, 0.55, phase);
        float band = smoothstep(0.02, 0.30, vUv.y) * smoothstep(1.0, 0.45, vUv.y + sweep * 0.35);
        float grain = (sin(vUv.x * 46.0 + uTime * 1.9) * 0.5 + 0.5)
                    * (sin(vUv.x * 17.3 - uTime * 1.1) * 0.5 + 0.5);
        float a = band * (0.30 + 0.85 * grain) * (0.45 + 0.75 * sweep);
        a *= 1.0 - smoothstep(500.0, 1900.0, vDepth);   // let the fog swallow it
        vec3 col = mix(vec3(1.0), vec3(0.62, 0.78, 0.82), uNight);
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
      }`
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.name = 'surf';
  return mesh;
}

// ---------------------------------------------------------------------------
// road ribbon
// ---------------------------------------------------------------------------

function ribbon(rows, cols, quadPairs) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (let p = 0; p < cols; p++) {
      pos.push(r.p[p * 3], r.p[p * 3 + 1], r.p[p * 3 + 2]);
      col.push(r.c[p * 3], r.c[p * 3 + 1], r.c[p * 3 + 2]);
    }
    if (i < rows.length - 1) {
      const base = i * cols;
      for (const p of quadPairs) {
        const a = base + p, b = a + 1, c = a + cols, d = c + 1;
        // offsets run along the road's left normal, so this winding (not the
        // terrain's) is the one that leaves the surface facing the sky
        idx.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildRoad() {
  const step = 8;
  const HW = WORLD.roadHalfWidth;
  const SH = 2.2;
  const VG = 11.6;
  const tar = new THREE.Color('#3b3b3f');
  const grav = new THREE.Color('#9d9382');
  const line = new THREE.Color('#ded9c8');
  const verge = new THREE.Color('#b6ab94');

  const chunks = new Map();   // key -> { tar: rows[], sho: rows[], lin: rows[] }
  const dashes = new Map();

  const zEnd = WORLD.zMax;
  for (let z = WORLD.zMin; z <= zEnd; z += step) {
    const cx = roadCenterX(z), cy = roadY(z) + 0.07;
    const t = roadTangent(z);
    const nx = -t.z, nz = t.x;
    const yaw = Math.atan2(t.x, t.z);

    // a row is emitted into its own chunk and into the previous one, so the
    // strips join up across the chunk boundary
    const keys = [chunkKey(z)];
    if (chunkKey(z - step) !== keys[0]) keys.push(chunkKey(z - step));
    const paved = districtAt(z).kind !== 'open' && districtAt(z).kind !== 'rocky';

    const mk = (offs, ys, color, wearSeed) => {
      const p = [], c = [];
      for (let i = 0; i < offs.length; i++) {
        const o = offs[i];
        p.push(cx + nx * o, cy + ys[i], z + nz * o);
        const w = 0.9 + 0.2 * vnoise(z * 0.05 + wearSeed + i, o * 0.3);
        c.push(color.r * w, color.g * w, color.b * w);
      }
      return { p, c };
    };

    const tarRow = mk([-HW, 0, HW], [0, 0.06, 0], tar, 0);
    const shoRow = mk([-HW - SH, -HW, HW, HW + SH], [-0.05, 0, 0, -0.05], grav, 11);
    const linRow = mk([-HW + 0.30, -HW + 0.52, HW - 0.52, HW - 0.30], [0.085, 0.085, 0.085, 0.085], line, 23);
    const vrgRow = mk([-VG, -HW - SH, HW + SH, VG], [0.04, -0.05, -0.05, 0.04],
      paved ? verge : grav, 37);

    for (const k of keys) {
      let o = chunks.get(k);
      if (!o) { o = { tar: [], sho: [], lin: [], vrg: [] }; chunks.set(k, o); }
      o.tar.push(tarRow); o.sho.push(shoRow); o.lin.push(linRow); o.vrg.push(vrgRow);
    }

    // dashed centre line, one dash every other step
    if (Math.round((z - WORLD.zMin) / step) % 2 === 0) {
      bucket(dashes, z, box(0.16, 0.02, 5.0, '#ece7d6', cx, cy + 0.10, z, yaw));
    }
  }

  const meshes = [];
  for (const [, o] of chunks) {
    if (o.tar.length < 2) continue;
    const g = mergeGeometries([
      ribbon(o.vrg, 4, [0, 2]),
      ribbon(o.tar, 3, [0, 1]),
      ribbon(o.sho, 4, [0, 2]),
      ribbon(o.lin, 4, [0, 2])
    ], false);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, STATIC_MAT);
    m.receiveShadow = true;
    m.name = 'road';
    meshes.push(m);
  }
  for (const m of mergedMeshes(dashes, { receive: true })) { m.name = 'roadPaint'; meshes.push(m); }
  return meshes;
}

// ---------------------------------------------------------------------------
// buildings
// ---------------------------------------------------------------------------

const NHAONG_WALLS = ['#f2e3c2', '#e9d3a6', '#dfc98f', '#f0d9d0', '#cfe0dd', '#e8c9a0',
  '#f5e9d2', '#d8c6a4', '#c9ddd2', '#eed9b6', '#e6b98f', '#fbf0d8'];
const OLD_WALLS = ['#e6c07a', '#dcae63', '#e8cf9a', '#d4a05c', '#efd9ad', '#cf9f6e', '#e2b87f'];
const SHUTTERS = ['#5a6b6e', '#7b4f3a', '#4a5f52', '#8a6b3f', '#3f4d55'];
const AWNINGS = ['#c4453c', '#2f6f8f', '#3f7a4a', '#c98a2b', '#7b4a7f'];
const SIGNS = ['#d24b3e', '#1f6fa8', '#e0a32a', '#2f8f5e', '#b8452f'];

// The narrow deep shophouse. Local origin sits on the pavement edge; the front
// faces -Z and the building runs back along +Z. The caller rotates and places.
function nhaOng(rng, opts) {
  const g = [];
  const w = lerp(3.5, 6.0, rng());
  const d = lerp(10, 16, rng());
  const floors = opts.floors || (2 + Math.floor(rng() * 4));
  const fh = lerp(3.3, 3.8, rng());
  const h = floors * fh;
  const wall = pick(rng, opts.palette || NHAONG_WALLS);
  const j = 0.88 + rng() * 0.24;
  const skirt = 4;   // buried foundation, so sloping ground never shows a gap

  g.push(box(w, h + skirt, d, wall, 0, (h - skirt) / 2, d / 2, 0, j));

  // shopfront + roll-down shutter at ground level
  g.push(box(w * 0.94, fh * 0.82, 0.35, pick(rng, SHUTTERS), 0, fh * 0.41, -0.1, 0, j));

  // fabric awning over the pavement
  const awG = new THREE.BoxGeometry(w * 1.02, 0.12, 2.1);
  tint(awG, pick(rng, AWNINGS), j);
  awG.rotateX(-0.20);
  awG.translate(0, fh * 0.94, -1.0);
  g.push(awG);

  // cantilevered balconies with metal railings
  for (let f = 1; f < floors; f++) {
    const y = f * fh;
    g.push(box(w * 1.06, 0.16, 1.0, wall, 0, y, -0.45, 0, j * 0.94));
    g.push(box(w * 1.06, 0.85, 0.07, '#8e9699', 0, y + 0.5, -0.92, 0, 1));
    g.push(box(w * 0.58, fh * 0.44, 0.14, '#3b5262', 0, y + fh * 0.52, -0.04, 0, 1));
  }

  // roof: parapet, blue plastic water tank, often a small extra room
  g.push(box(w * 1.02, 0.55, d, wall, 0, h + 0.27, d / 2, 0, j * 0.9));
  g.push(cyl(0.55, 0.55, 1.2, 6, '#2f7fc4', w * 0.18, h + 1.15, d * 0.35, 1));
  if (rng() > 0.45) {
    g.push(box(w * 0.7, 2.4, d * 0.3, wall, -w * 0.1, h + 1.2, d * 0.62, 0, j * 0.95));
    g.push(box(w * 0.74, 0.12, d * 0.34, '#8d5c46', -w * 0.1, h + 2.45, d * 0.62, 0, 1));
  }

  // tall thin vertical signboard bolted to the side
  if (rng() > 0.3) {
    const sh = Math.min(h * 0.72, 9);
    g.push(box(0.12, sh, 0.9, pick(rng, SIGNS),
      (rng() > 0.5 ? 1 : -1) * (w / 2 + 0.1), h - sh / 2 - 0.6, 0.5, 0, 1));
  }

  return { geos: g, width: w, depth: d, height: h };
}

function villageHouse(rng) {
  const g = [];
  const w = lerp(6, 9, rng()), d = lerp(7, 11, rng());
  const h = rng() > 0.7 ? 6.4 : 3.4;
  const wall = pick(rng, ['#e7ddc6', '#d6c7a6', '#cfd9cd', '#e8cfa8']);
  const j = 0.88 + rng() * 0.24;
  g.push(box(w, h + 4, d, wall, 0, (h - 4) / 2, d / 2, 0, j));
  const roof = new THREE.BoxGeometry(w * 1.14, 0.14, d * 1.16);
  tint(roof, '#9aa3a6', j);
  roof.rotateX(0.10);
  roof.translate(0, h + 0.3, d / 2);
  g.push(roof);
  g.push(box(1.0, 2.1, 0.16, '#6b4a33', 0, 1.05, -0.06, 0, 1));
  g.push(cyl(0.5, 0.5, 1.1, 8, '#2f7fc4', w * 0.28, h + 0.95, d * 0.5, 1));
  return { geos: g, width: w, depth: d, height: h };
}

function resortBlock(rng) {
  const g = [];
  const w = lerp(38, 66, rng());
  const d = lerp(13, 18, rng());
  const floors = 3 + Math.floor(rng() * 2);
  const fh = 3.6, h = floors * fh;
  const cream = pick(rng, ['#f4ecdc', '#efe4cd', '#f7f1e4']);
  const j = 0.94 + rng() * 0.12;

  g.push(box(w, h + 4, d, cream, 0, (h - 4) / 2, d / 2, 0, j));
  for (let f = 1; f <= floors; f++) {
    const y = f * fh;
    g.push(box(w * 1.02, 0.2, 2.6, cream, 0, y, -1.1, 0, j * 0.95));
    g.push(box(w * 1.02, 0.9, 0.08, '#c8bda6', 0, y + 0.45, -2.32, 0, 1));
    g.push(box(w * 0.9, fh * 0.6, 0.12, '#31454f', 0, y + fh * 0.52, -0.03, 0, 1));
  }
  const cols = Math.max(4, Math.round(w / 5));
  for (let i = 0; i < cols; i++) {
    g.push(cyl(0.26, 0.30, fh, 6, cream, -w / 2 + (i + 0.5) * (w / cols), fh / 2, -1.9, j * 0.97));
  }
  g.push(box(w * 1.04, 0.35, 4.4, cream, 0, fh + 0.17, -1.9, 0, j * 0.92));
  g.push(box(w * 1.06, 0.5, d * 1.04, '#b4694f', 0, h + 0.25, d / 2 - 0.2, 0, j));
  return { geos: g, width: w, depth: d, height: h };
}

function placeBuildings(rng, colliders) {
  const chunks = new Map();

  function drop(maker, z, side, offset, extraYaw) {
    const p = sidePoint(z, offset * side);
    const px = p.x, pz = p.z;
    if (px < coastX(z) + 8) return null;          // never on the sand or in the sea

    const b = maker();
    const yaw = p.yaw + (extraYaw || 0);
    const y = heightAt(px, pz);

    const merged = mergeGeometries(b.geos, false);
    merged.rotateY(yaw);
    merged.translate(px, y, pz);
    bucket(chunks, z, merged);

    colliders.push({
      x: px + Math.sin(yaw) * b.depth * 0.5,
      z: pz + Math.cos(yaw) * b.depth * 0.5,
      r: Math.max(b.width, b.depth) * 0.42
    });
    return b;
  }

  for (const dist of DISTRICTS) {
    if (dist.kind === 'open') continue;

    if (dist.kind === 'town' || dist.kind === 'oldquarter') {
      const old = dist.kind === 'oldquarter';
      const palette = old ? OLD_WALLS : NHAONG_WALLS;
      // The town keeps its seaward side clear: the point of Trần Phú is that you
      // can see the beach from the car. The old quarter is enclosed on both sides.
      const rows = old ? [13, 31, 49] : [14, 33];
      for (const rowOff of rows) {
        for (const side of [1, -1]) {
          if (side < 0 && (!old || rowOff > 35)) continue;
          let z = dist.z0 + 6;
          let run = 0;
          while (z < dist.z1 - 10) {
            // the deepest block row is thinned out: it is mostly roofline
            const skip = rowOff > 40 && rng() > 0.55;
            const b = skip ? null : drop(() => nhaOng(rng, {
              palette,
              floors: old ? 3 + Math.floor(rng() * 4) : 2 + Math.floor(rng() * 4)
            }), z, side, rowOff, 0);
            const w = b ? b.width : 5;
            z += w + 0.25;
            run += w;
            if (run > lerp(45, 80, rng())) {       // a ngõ: narrow alley through the block
              z += lerp(3.0, 4.5, rng());
              run = 0;
            }
          }
        }
      }
    }

    if (dist.kind === 'village') {
      for (const side of [1, -1]) {
        let z = dist.z0;
        while (z < dist.z1) {
          if (rng() > 0.35) drop(() => villageHouse(rng), z, side, lerp(17, 30, rng()), (rng() - 0.5) * 0.5);
          z += lerp(16, 30, rng());
        }
      }
      const zc = (dist.z0 + dist.z1) / 2;
      let z = zc - 110;
      while (z < zc + 110) {
        const b = drop(() => nhaOng(rng, { floors: 2 + Math.floor(rng() * 2) }), z, 1, 15, 0);
        z += (b ? b.width : 5) + 0.3;
      }
    }

    if (dist.kind === 'resort') {
      let z = dist.z0 + 60;
      while (z < dist.z1 - 60) {
        drop(() => resortBlock(rng), z, 1, lerp(46, 74, rng()), (rng() - 0.5) * 0.22);
        z += lerp(130, 200, rng());
      }
      z = dist.z0 + 120;
      while (z < dist.z1 - 120) {
        drop(() => villageHouse(rng), z, -1, lerp(22, 34, rng()), (rng() - 0.5) * 0.4);
        z += lerp(180, 300, rng());
      }
    }

    if (dist.kind === 'rocky') {
      let z = dist.z0;
      while (z < dist.z1) {
        if (rng() > 0.6) drop(() => villageHouse(rng), z, 1, lerp(24, 60, rng()), (rng() - 0.5) * 0.8);
        z += lerp(40, 90, rng());
      }
    }
  }

  return mergedMeshes(chunks, { cast: true, receive: true });
}

// ---------------------------------------------------------------------------
// vegetation
// ---------------------------------------------------------------------------

function palmGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.15, 0.29, 8.5, 10, 8);
  tint(trunk, '#91775a');
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + 4.25) / 8.5;
    p.setX(i, p.getX(i) + t*t*0.9);
  }
  trunk.translate(0,4.25,0);parts.push(trunk);
  for (let f=0;f<9;f++) {
    const angle=f/9*Math.PI*2;
    const positions=[],uv=[];
    for(let k=1;k<=10;k++) {
      const t=k/11,reach=t*4.8;
      const y=8.5+Math.sin(t*Math.PI)*0.85-t*t*1.6;
      const leaf=0.9*Math.sin(t*Math.PI)+0.12;
      for(const side of [-1,1]) {
        const points=[[reach-0.15,y,0],[reach+0.30,y-0.15,side*leaf],[reach+0.45,y-0.22,side*leaf*0.85],[reach+0.09,y,0]];
        for(const idx of [0,1,2,0,2,3]){positions.push(...points[idx]);uv.push(idx%2,idx>1?1:0);}
      }
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(Array.from({length:positions.length/3},(_,i)=>i));
    g.computeVertexNormals();g.rotateY(angle);g.translate(.9,0,0);tint(g,f%2?'#428144':'#60944a');parts.push(g);
  }
  for(const x of [-.2,.2])parts.push(cyl(.18,.21,.35,8,'#938346',.9+x,8.15,.12));
  const g=mergeGeometries(parts,false);g.computeVertexNormals();return g;
}

function casuarinaGeometry() {
  const parts=[cyl(.13,.23,5.5,8,'#7b6a53',0,2.75,0)];
  const crowns=[[0,6.4,0,2.3],[-1,5.2,.4,1.7],[1,6.0,-.3,1.8],[.2,8.0,.1,1.6],[0,9.1,0,1.0]];
  for(const [x,y,z,r] of crowns) {
    const g=new THREE.SphereGeometry(r,10,7);g.scale(.85,1.25,.85);g.translate(x,y,z);tint(g,y>7?'#557a45':'#416d47');parts.push(g);
  }
  const g=mergeGeometries(parts,false);g.computeVertexNormals();return g;
}

// phượng vĩ — flame tree, red in bloom
function flameTreeGeometry() {
  const parts = [cyl(0.20, 0.38, 3.6, 6, '#6d5b48', 0, 1.8, 0)];
  const crowns = [[0, 4.6, 0, 3.1, '#c9402f'], [1.9, 4.2, 0.7, 2.3, '#d8552f'], [-1.7, 4.3, -0.9, 2.2, '#b8371f']];
  for (const [x, y, z, r, col] of crowns) {
    const c = new THREE.SphereGeometry(r, 6, 3);
    c.scale(1, 0.52, 1);
    tint(c, col);
    c.translate(x, y, z);
    parts.push(c);
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

function placeVegetation(rng) {
  const palms = new Map(), casu = new Map(), flame = new Map();

  for (let z = WORLD.zMin; z < WORLD.zMax; z += 7) {
    const cx = coastX(z), rx = roadCenterX(z);
    const kind = districtAt(z).kind;

    // coconut palms on the sand
    const density = kind === 'resort' ? 0.85 : kind === 'town' ? 0.5 : 0.62;
    if (rng() < density) {
      const x = lerp(cx + 12, rx - 14, Math.pow(rng(), 0.7));
      const y = heightAt(x, z);
      if (y > 0.4) bucket(palms, z, { x, y, z: z + rng() * 6, ry: rng() * 6.28, s: lerp(0.75, 1.25, rng()), rz: (rng() - 0.5) * 0.2 });
    }
    // a row of palms on the seaward pavement, the Trần Phú signature
    if (kind !== 'open' && rng() < 0.30) {
      const p = sidePoint(z, -lerp(8.6, 10.8, rng()));
      const y = heightAt(p.x, p.z);
      if (y > 0.4) bucket(palms, p.z, { x: p.x, y, z: p.z, ry: rng() * 6.28, s: lerp(0.85, 1.15, rng()) });
    }
    // casuarina + flame trees on the inland verge — in the dense districts they
    // sit between the tarmac and the pavement, where the shophouses are not
    const dense = kind === 'town' || kind === 'oldquarter';
    if (rng() < (dense ? 0.34 : 0.5)) {
      const off = dense ? lerp(8.2, 11.0, rng()) : lerp(12, 21, rng());
      const p = sidePoint(z, off);
      const x = p.x, zz = p.z;
      const y = heightAt(x, zz);
      if (y > 0.6) {
        if (rng() < 0.35) bucket(flame, zz, { x, y, z: zz, ry: rng() * 6.28, s: lerp(0.8, 1.2, rng()) });
        else bucket(casu, zz, { x, y, z: zz, ry: rng() * 6.28, s: lerp(0.7, 1.15, rng()) });
      }
    }
    // scattered inland greenery, well behind the built-up strip
    if (rng() < 0.35) {
      const x = rx + lerp(dense ? 150 : 95, 620, Math.pow(rng(), 0.6));
      const y = heightAt(x, z);
      if (y > 1.5 && y < 70) bucket(casu, z, { x, y, z, ry: rng() * 6.28, s: lerp(0.6, 1.3, rng()) });
    }
  }

  return [
    instancedChunks(palmGeometry(), palms, 'palms'),
    instancedChunks(casuarinaGeometry(), casu, 'casuarina'),
    instancedChunks(flameTreeGeometry(), flame, 'flametrees')
  ];
}

// ---------------------------------------------------------------------------
// street furniture: poles + cables, lamps, km markers, sea wall
// ---------------------------------------------------------------------------

function poleGeometry() {
  const g = mergeGeometries([
    cyl(0.13, 0.20, 9.4, 5, '#b0aca4', 0, 4.7, 0),
    box(1.7, 0.10, 0.10, '#9d9890', 0, 8.5, 0),
    box(1.35, 0.10, 0.10, '#9d9890', 0, 7.7, 0)
  ], false);
  g.computeVertexNormals();
  return g;
}

function lampGeometry() {
  const arm = new THREE.BoxGeometry(0.13, 0.13, 3.0);
  tint(arm, '#8e9498'); arm.rotateX(0.30); arm.translate(0, 8.35, -1.45);
  const g = mergeGeometries([
    cyl(0.10, 0.16, 8.4, 6, '#8e9498', 0, 4.2, 0),
    arm,
    box(0.46, 0.18, 0.95, '#6f7579', 0, 8.78, -2.85)
  ], false);
  g.computeVertexNormals();
  return g;
}

// A soft additive pool of light on the tarmac under each lamp. Far cheaper
// than 200 real lights, and it is what actually sells the night.
function lampPoolGeometry() {
  const g = new THREE.CircleGeometry(8.6, 20);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const centre = i === 0 ? 1 : 0;              // CircleGeometry: vertex 0 is the hub
    col[i * 3] = 0.40 * centre;
    col[i * 3 + 1] = 0.33 * centre;
    col[i * 3 + 2] = 0.20 * centre;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.09, -2.85);
  return g;
}

function lampHeadGeometry() {
  const g = new THREE.BoxGeometry(0.40, 0.07, 0.85);
  tint(g, '#fff4d2');
  g.translate(0, 8.66, -2.85);
  return g;
}

function placeFurniture(rng, colliders) {
  const group = new THREE.Group();
  group.name = 'furniture';

  const poles = new Map(), lamps = new Map(), lampsFlat = [], markers = new Map();
  const cables = new Map(), wall = new Map();
  const polePositions = [];

  for (let z = WORLD.zMin; z < WORLD.zMax; z += 30) {
    const p = sidePoint(z, 12.2);                 // inland pavement edge
    const y = heightAt(p.x, p.z);
    bucket(poles, p.z, { x: p.x, y, z: p.z, ry: p.roadYaw });
    polePositions.push({ x: p.x, y, z: p.z });
    colliders.push({ x: p.x, z: p.z, r: 0.55 });
  }

  // heavy sagging cable bundles — the single most recognisable detail
  for (let i = 0; i < polePositions.length - 1; i++) {
    const a = polePositions[i], b = polePositions[i + 1];
    const pts = [];
    for (let c = 0; c < 4; c++) {
      const top = 8.5 - (c % 2) * 0.8;
      const lateral = (c < 2 ? -0.55 : 0.55) + (c % 2) * 0.25;
      const sag = 1.25 + (c % 2) * 0.35;
      const SEG = 6;
      let px = 0, py = 0, pz = 0;
      for (let s = 0; s <= SEG; s++) {
        const u = s / SEG;
        const x = lerp(a.x, b.x, u) + lateral;
        const z = lerp(a.z, b.z, u);
        const y = lerp(a.y, b.y, u) + top - Math.sin(u * Math.PI) * sag;
        if (s > 0) pts.push(px, py, pz, x, y, z);
        px = x; py = y; pz = z;
      }
    }
    bucket(cables, a.z, pts);
  }

  // single-arm street lamps leaning over the tarmac, alternating sides
  let side = 1;
  for (let z = WORLD.zMin; z < WORLD.zMax; z += 46) {
    const p = sidePoint(z, 7.5 * side);
    const item = { x: p.x, y: heightAt(p.x, p.z), z: p.z, ry: p.yaw };
    bucket(lamps, p.z, item);
    lampsFlat.push(item);
    side = -side;
  }

  // blue-and-white kilometre markers
  for (let z = WORLD.zMin; z < WORLD.zMax; z += 100) {
    const p = sidePoint(z, -7.3);
    bucket(markers, p.z, { x: p.x, y: heightAt(p.x, p.z), z: p.z, ry: p.yaw });
  }

  // low concrete sea wall along the seaward shoulder of the built-up stretches
  for (let z = WORLD.zMin; z < WORLD.zMax; z += 4) {
    const kind = districtAt(z).kind;
    if (kind !== 'town' && kind !== 'village') continue;
    if (Math.abs(z - 2200) < 30) continue;
    const p = sidePoint(z, -11.4);               // seaward edge of the pavement
    bucket(wall, p.z, box(0.45, 1.5, 4.1, '#d9d3c2', p.x, heightAt(p.x, p.z) + 0.30, p.z,
      p.roadYaw, 0.9 + vnoise(z * 0.2, 0) * 0.2));
  }

  const markerGeo = mergeGeometries([
    box(0.34, 1.05, 0.26, '#f2f0e8', 0, 0.52, 0),
    box(0.36, 0.34, 0.28, '#1f5fa8', 0, 0.87, 0)
  ], false);

  group.add(instancedChunks(poleGeometry(), poles, 'poles', STATIC_MAT));
  group.add(instancedChunks(lampGeometry(), lamps, 'lamps', STATIC_MAT));
  group.add(instancedChunks(markerGeo, markers, 'kmMarkers', STATIC_MAT));
  for (const m of mergedMeshes(wall, { cast: true, receive: true })) group.add(m);

  // glowing lamp heads, only visible at night
  const headGroup = new THREE.Group();
  headGroup.name = 'lampHeads';
  headGroup.visible = false;
  const headMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const poolMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const headGeo = lampHeadGeometry();
  const poolGeo = lampPoolGeometry();
  const dummy = new THREE.Object3D();
  const headChunks = new Map();
  for (const it of lampsFlat) bucket(headChunks, it.z, it);
  for (const [, items] of headChunks) {
    const mats = [];
    for (let i = 0; i < items.length; i++) {
      dummy.position.set(items[i].x, items[i].y, items[i].z);
      dummy.rotation.set(0, items[i].ry, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mats.push(dummy.matrix.clone());
    }
    for (const [geo, mat, order] of [[headGeo, headMat, 0], [poolGeo, poolMat, 3]]) {
      const m = new THREE.InstancedMesh(geo, mat, mats.length);
      for (let i = 0; i < mats.length; i++) m.setMatrixAt(i, mats[i]);
      m.instanceMatrix.needsUpdate = true;
      m.renderOrder = order;
      m.computeBoundingSphere();
      headGroup.add(m);
    }
  }
  group.add(headGroup);

  const cableMat = new THREE.LineBasicMaterial({ color: 0x14171a, transparent: true, opacity: 0.9 });
  for (const [, spans] of cables) {
    const flat = [];
    for (const s of spans) for (let i = 0; i < s.length; i++) flat.push(s[i]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
    g.computeBoundingSphere();
    group.add(new THREE.LineSegments(g, cableMat));
  }

  return { group, lampHeads: headGroup };
}

// thuyền thúng — round woven basket boats
function basketBoatGeometry() {
  const bowl = new THREE.SphereGeometry(1.45, 12, 5, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
  bowl.scale(1, 0.42, 1);
  tint(bowl, '#a5783f');
  const rim = new THREE.TorusGeometry(1.44, 0.09, 4, 14);
  rim.rotateX(Math.PI / 2);
  tint(rim, '#6f4d27');
  const g = mergeGeometries([bowl, rim], false);
  g.computeVertexNormals();
  return g;
}

function placeBoats(rng) {
  const items = [];
  const zc = 2200;                 // moored off the fishing village
  for (let i = 0; i < 26; i++) {
    const z = zc + (rng() - 0.5) * 700;
    items.push({ x: coastX(z) - lerp(6, 70, rng()), y: 0.1, z, ry: rng() * 6.28, s: lerp(0.8, 1.2, rng()) });
  }
  const mesh = new THREE.InstancedMesh(basketBoatGeometry(), PLANT_MAT, items.length);
  mesh.frustumCulled = false;
  mesh.name = 'boats';
  mesh.userData.items = items;
  return mesh;
}

// ---------------------------------------------------------------------------
// collision lookup — a coarse grid of circles, queried by the car each frame
// ---------------------------------------------------------------------------

const CELL = 120;
function buildColliderGrid(list) {
  const grid = new Map();
  for (const c of list) {
    const i0 = Math.floor((c.x - c.r) / CELL), i1 = Math.floor((c.x + c.r) / CELL);
    const j0 = Math.floor((c.z - c.r) / CELL), j1 = Math.floor((c.z + c.r) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = i + ',' + j;
        let a = grid.get(k);
        if (!a) { a = []; grid.set(k, a); }
        a.push(c);
      }
    }
  }
  return grid;
}

// ---------------------------------------------------------------------------
// build entry point
// ---------------------------------------------------------------------------

const frame = () => new Promise(r => requestAnimationFrame(() => r()));

// Frustum culling alone still draws everything inside a long view cone, so
// chunks past the fog line are switched off outright. This is the cheapest
// triangle-budget lever there is.
const CULL_DIST = 1200;

function collectCullables(root, out) {
  root.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh || o.isLineSegments)) return;
    let sphere = o.boundingSphere;
    if (!sphere) {
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      sphere = o.geometry.boundingSphere;
    }
    if (!sphere) return;
    o.updateWorldMatrix(true, false);
    const bound = sphere.clone().applyMatrix4(o.matrixWorld);
    out.push({ obj: o, cx: bound.center.x, cz: bound.center.z, r: bound.radius });
  });
  return out;
}

export async function buildWorld(scene, report) {
  const rng = makeRng(20260913);
  const colliders = [];
  const say = (p, t) => report && report(p, t);

  say(0.05, 'Địa hình và bờ biển…'); await frame();
  for (const m of buildTerrain()) scene.add(m);

  say(0.24, 'Biển và sóng vỗ…'); await frame();
  const sea = buildSea(), surf = buildSurf();
  scene.add(sea, surf);

  say(0.34, 'Quốc lộ ven biển…'); await frame();
  for (const m of buildRoad()) scene.add(m);

  say(0.46, 'Nhà ống, làng chài, khu nghỉ dưỡng…'); await frame();
  for (const m of placeBuildings(rng, colliders)) scene.add(m);

  say(0.72, 'Dừa, phi lao, phượng vĩ…'); await frame();
  for (const m of placeVegetation(rng)) scene.add(m);

  say(0.88, 'Cột điện, dây điện, đèn đường…'); await frame();
  const furniture = placeFurniture(rng, colliders);
  scene.add(furniture.group);

  say(0.94, 'Quán ven biển, bãi cát, thuyền cá…');
  const details = buildCoastalDetails({ heightAt, roadY, sidePoint, coastX, roadCenterX, districtAt, WORLD, rng, colliders });
  scene.add(details.group);

  say(0.98, 'Thuyền thúng…'); await frame();
  const boats = placeBoats(rng);
  scene.add(boats);

  const roadPts = [], coastPts = [];
  for (let z = WORLD.zMin; z <= WORLD.zMax; z += 40) {
    roadPts.push(roadCenterX(z), z);
    coastPts.push(coastX(z), z);
  }

  const grid = buildColliderGrid(colliders);
  const boatItems = boats.userData.items;
  const bd = new THREE.Object3D();

  const cullables = [];
  for (const o of scene.children) {
    if (o === sea || o === surf || o === boats || o === details.group || o.name === 'sky') continue;
    collectCullables(o, cullables);
  }

  say(1, 'Xong.');

  return {
    sea, surf,
    roadPts: new Float32Array(roadPts),
    coastPts: new Float32Array(coastPts),

    update(t, camX, camZ) {
      details.update(t, camZ);
      windTime.value = t;
      sea.material.uniforms.uTime.value = t;
      surf.material.uniforms.uTime.value = t;

      if (camX !== undefined) {
        for (let i = 0; i < cullables.length; i++) {
          const c = cullables[i];
          const dx = c.cx - camX, dz = c.cz - camZ;
          const lim = CULL_DIST + c.r;
          c.obj.visible = dx * dx + dz * dz < lim * lim;
        }
      }

      for (let i = 0; i < boatItems.length; i++) {
        const it = boatItems[i];
        bd.position.set(it.x, 0.1 + Math.sin(t * 1.1 + i * 1.7) * 0.16, it.z);
        bd.rotation.set(Math.sin(t * 0.9 + i) * 0.05, it.ry, Math.cos(t * 0.8 + i * 2) * 0.05);
        bd.scale.setScalar(it.s);
        bd.updateMatrix();
        boats.setMatrixAt(i, bd.matrix);
      }
      boats.instanceMatrix.needsUpdate = true;
    },

    setNight(night) {
      sea.material.uniforms.uNight.value = night ? 1 : 0;
      surf.material.uniforms.uNight.value = night ? 1 : 0;
      furniture.lampHeads.visible = !!night;
      details.setNight(night);
    },

    setSun(dir, color) {
      sea.material.uniforms.uSun.value.copy(dir);
      sea.material.uniforms.uSunColor.value.copy(color);
    },

    setFog(color, near, far) {
      sea.material.uniforms.uFogColor.value.copy(color);
      sea.material.uniforms.uFogNear.value = near;
      sea.material.uniforms.uFogFar.value = far;
    },

    // push a circle of radius r out of anything solid it overlaps
    resolve(x, z, r) {
      const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
      let dx = 0, dz = 0, hit = false;
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const list = grid.get((i + a) + ',' + (j + b));
          if (!list) continue;
          for (const c of list) {
            const ox = x - c.x, oz = z - c.z;
            const d2 = ox * ox + oz * oz;
            const rr = c.r + r;
            if (d2 < rr * rr && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              const push = rr - d;
              dx += (ox / d) * push; dz += (oz / d) * push;
              hit = true;
            }
          }
        }
      }
      return hit ? { x: dx, z: dz } : null;
    }
  };
}
