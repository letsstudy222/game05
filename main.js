// main.js — renderer, sky, lights, cameras, input, HUD, loop.

import * as THREE from 'three';
import {
  buildWorld, heightAt, roadCenterX, roadTangent, districtAt, WORLD
} from './world.js';
import { Vehicle } from './vehicle.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

const COARSE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
if (COARSE) document.body.classList.add('touch');

// ---------------------------------------------------------------------------
// renderer / scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: !COARSE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, COARSE ? 1 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !COARSE;              // shadows off on phones
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// The far plane is deliberately tight: it is the main triangle-budget lever,
// and the coastal haze hides the cut.
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.35, 1400);

// ---------------------------------------------------------------------------
// day / night palettes
// ---------------------------------------------------------------------------

const DAY = {
  skyTop: new THREE.Color('#3e8fd0'), skyBottom: new THREE.Color('#cfe6ef'),
  fog: new THREE.Color('#c3dde5'), fogNear: 260, fogFar: 1180,
  sun: new THREE.Color('#fff3d6'), sunI: 2.05,
  hemiSky: new THREE.Color('#bfe0f0'), hemiGround: new THREE.Color('#8a7f60'), hemiI: 0.85,
  ambient: 0.22, exposure: 1.05, stars: 0
};
const NIGHT = {
  skyTop: new THREE.Color('#050c1c'), skyBottom: new THREE.Color('#15304a'),
  fog: new THREE.Color('#0d1b2a'), fogNear: 130, fogFar: 780,
  sun: new THREE.Color('#9fb6d8'), sunI: 0.32,
  hemiSky: new THREE.Color('#16283c'), hemiGround: new THREE.Color('#0b0f14'), hemiI: 0.30,
  ambient: 0.10, exposure: 1.25, stars: 1
};

const SUN_DAY = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();
const SUN_NIGHT = new THREE.Vector3(0.42, 0.34, -0.72).normalize();

scene.fog = new THREE.Fog(DAY.fog.clone(), DAY.fogNear, DAY.fogFar);
scene.background = null;

// ---------------------------------------------------------------------------
// sky dome — rides along with the camera
// ---------------------------------------------------------------------------

const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    uTop: { value: DAY.skyTop.clone() },
    uBottom: { value: DAY.skyBottom.clone() },
    uSun: { value: SUN_DAY.clone() },
    uSunColor: { value: DAY.sun.clone() },
    uStars: { value: 0 }
  },
  vertexShader: `
    varying vec3 vDir;
    void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    precision mediump float;
    uniform vec3 uTop, uBottom, uSun, uSunColor;
    uniform float uStars;
    varying vec3 vDir;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec3 d = normalize(vDir);
      float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 col = mix(uBottom, uTop, pow(t, 0.85));
      float s = max(dot(d, normalize(uSun)), 0.0);
      col += uSunColor * pow(s, 220.0) * 2.2;
      col += uSunColor * pow(s, 7.0) * 0.16;
      if (uStars > 0.01 && d.y > 0.0) {
        vec2 g = floor(d.xz * 190.0 / max(d.y, 0.18));
        float n = h21(g);
        float star = step(0.9975, n) * (0.5 + 0.5 * h21(g + 7.0));
        col += vec3(star) * uStars * d.y;
      }
      gl_FragColor = vec4(col, 1.0);
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1300, 24, 16), skyMat);
sky.frustumCulled = false;
sky.renderOrder = -10;
scene.add(sky);

// ---------------------------------------------------------------------------
// lights — exactly one shadow caster
// ---------------------------------------------------------------------------

const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiI);
scene.add(hemi);

const ambient = new THREE.AmbientLight(0xffffff, DAY.ambient);
scene.add(ambient);

const sun = new THREE.DirectionalLight(DAY.sun.clone(), DAY.sunI);
sun.castShadow = !COARSE;
sun.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 340;
sun.shadow.camera.left = -62;
sun.shadow.camera.right = 62;
sun.shadow.camera.top = 62;
sun.shadow.camera.bottom = -62;
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 0.6;
scene.add(sun);
scene.add(sun.target);

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------

const keys = Object.create(null);
const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const touch = { up: false, down: false, left: false, right: false, hand: false };

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (keys[k]) return;
  keys[k] = true;
  if (k === 'c') cycleCamera();
  if (k === 'n') setNight(!night);
  if (k === 'r') respawn();
  if (k === 'h') document.getElementById('keys').classList.toggle('hidden');
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function bindTouch(id, on, off) {
  const el = document.getElementById(id);
  if (!el) return;
  const down = e => { e.preventDefault(); el.classList.add('active'); on(); };
  const up = e => { e.preventDefault(); el.classList.remove('active'); if (off) off(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
}
bindTouch('tGas', () => touch.up = true, () => touch.up = false);
bindTouch('tBrake', () => touch.down = true, () => touch.down = false);
bindTouch('tLeft', () => touch.left = true, () => touch.left = false);
bindTouch('tRight', () => touch.right = true, () => touch.right = false);
bindTouch('tHand', () => touch.hand = true, () => touch.hand = false);
bindTouch('tCam', () => cycleCamera());
bindTouch('tNight', () => setNight(!night));
bindTouch('tReset', () => respawn());

function readInput() {
  const up = keys['w'] || keys['arrowup'] || touch.up;
  const down = keys['s'] || keys['arrowdown'] || touch.down;
  const left = keys['a'] || keys['arrowleft'] || touch.left;
  const right = keys['d'] || keys['arrowright'] || touch.right;
  input.throttle = up ? 1 : 0;
  input.brake = down ? 1 : 0;
  input.steer = (left ? -1 : 0) + (right ? 1 : 0);
  input.handbrake = !!(keys[' '] || touch.hand);
  return input;
}

// ---------------------------------------------------------------------------
// cameras
// ---------------------------------------------------------------------------

const CAMS = ['chase', 'bonnet', 'cinematic'];
let camMode = 0;
function cycleCamera() { camMode = (camMode + 1) % CAMS.length; camSmooth = null; }

let camSmooth = null;
const _off = new THREE.Vector3();
const _want = new THREE.Vector3();
const _look = new THREE.Vector3();

function updateCamera(car, dt, time) {
  const mode = CAMS[camMode];
  const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
  const speedF = clamp(car.kmh / 180, 0, 1);

  if (mode === 'bonnet') {
    _want.set(car.x + s * 0.75, car.y + 1.58, car.z + c * 0.75);
    _look.set(car.x + s * 40, car.y + 1.9, car.z + c * 40);
    camera.position.copy(_want);
    camera.fov = lerp(74, 88, speedF);
  } else {
    if (mode === 'chase') _off.set(0, 3.0, -7.8 - speedF * 2.4);
    else _off.set(7.0 + Math.sin(time * 0.13) * 3.5, 3.4, -11.5);

    const wx = car.x + _off.x * c + _off.z * s;
    const wz = car.z - _off.x * s + _off.z * c;
    const ground = heightAt(wx, wz);
    _want.set(wx, Math.max(car.y + _off.y, ground + 1.6), wz);

    if (!camSmooth) camSmooth = _want.clone();
    // position is smoothed, look-at is not
    camSmooth.lerp(_want, Math.min(1, dt * (mode === 'chase' ? 6.5 : 3.0)));
    camera.position.copy(camSmooth);
    _look.set(car.x + s * 6, car.y + 1.35, car.z + c * 6);
    camera.fov = mode === 'chase' ? lerp(62, 78, speedF) : lerp(48, 56, speedF);
  }

  camera.lookAt(_look);
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
}

// ---------------------------------------------------------------------------
// day / night
// ---------------------------------------------------------------------------

let night = false;
let world = null;
let car = null;

function applyPalette(p, sunDir) {
  skyMat.uniforms.uTop.value.copy(p.skyTop);
  skyMat.uniforms.uBottom.value.copy(p.skyBottom);
  skyMat.uniforms.uSun.value.copy(sunDir);
  skyMat.uniforms.uSunColor.value.copy(p.sun);
  skyMat.uniforms.uStars.value = p.stars;

  scene.fog.color.copy(p.fog);
  scene.fog.near = p.fogNear;
  scene.fog.far = p.fogFar;

  hemi.color.copy(p.hemiSky);
  hemi.groundColor.copy(p.hemiGround);
  hemi.intensity = p.hemiI;
  ambient.intensity = p.ambient;
  sun.color.copy(p.sun);
  sun.intensity = p.sunI;
  renderer.toneMappingExposure = p.exposure;

  if (world) {
    world.setNight(p === NIGHT);
    world.setSun(sunDir, p.sun);
    world.setFog(p.fog, p.fogNear, p.fogFar);
  }
  if (car) car.setNight(p === NIGHT);
}

function setNight(v) {
  night = !!v;
  applyPalette(night ? NIGHT : DAY, night ? SUN_NIGHT : SUN_DAY);
  const b = document.getElementById('tNight');
  if (b) b.textContent = night ? 'NGÀY' : 'ĐÊM';
}

function respawn() { if (car) { car.reset(car.z); camSmooth = null; } }

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

const el = {
  speed: document.getElementById('speed'),
  throttle: document.getElementById('throttleFill'),
  district: document.getElementById('district'),
  offroad: document.getElementById('offroad'),
  stats: document.getElementById('stats'),
  bar: document.getElementById('barFill'),
  stage: document.getElementById('stage'),
  loading: document.getElementById('loading'),
  map: document.getElementById('map')
};
const mapCtx = el.map.getContext('2d');

let hudTimer = 0, fpsCount = 0, fpsT0 = performance.now(), fps = 60;

function updateHud(dt) {
  hudTimer += dt;
  fpsCount++;

  el.throttle.style.width = (input.throttle ? 100 : (input.brake ? 100 : 0)) + '%';
  el.throttle.classList.toggle('brake', !!input.brake && !input.throttle);
  el.offroad.classList.toggle('on', !car.onRoad);

  if (hudTimer > 0.1) {
    el.speed.firstChild.nodeValue = Math.round(car.kmh);
    const d = districtAt(car.z);
    if (el.district.textContent !== d.name) el.district.textContent = d.name;
    hudTimer = 0;
  }
  const now = performance.now();
  if (now - fpsT0 > 500) {
    fps = (fpsCount * 1000) / (now - fpsT0); fpsT0 = now; fpsCount = 0;
    const i = renderer.info.render;
    el.stats.textContent =
      Math.round(fps) + ' fps · ' + (1000 / fps).toFixed(1) + ' ms · ' +
      i.calls + ' draw · ' + Math.round(i.triangles / 1000) + 'k tri';
  }
}

// heading-up circular minimap
const MAP_RANGE = 620;
function drawMap() {
  const w = el.map.width, h = el.map.height;
  const R = w / 2, scale = R / MAP_RANGE;
  const ctx = mapCtx;
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = 'rgba(10,32,42,0.55)'; ctx.fillRect(0, 0, w, h);

  // heading-up: the car's forward direction always points to the top of the dial
  const cs = Math.cos(car.yaw) * scale, sn = Math.sin(car.yaw) * scale;
  ctx.translate(R, R);
  ctx.transform(cs, -sn, -sn, -cs, 0, 0);
  ctx.translate(-car.x, -car.z);

  const i0 = Math.max(0, Math.floor((car.z - MAP_RANGE * 1.6 - WORLD.zMin) / 40));
  const i1 = Math.min(world.roadPts.length / 2 - 1, Math.ceil((car.z + MAP_RANGE * 1.6 - WORLD.zMin) / 40));

  const line = (pts, color, width) => {
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1];
      if (i === i0) ctx.moveTo(x, z); else ctx.lineTo(x, z);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width / scale;
    ctx.stroke();
  };

  // sea fill, west of the coastline
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    const x = world.coastPts[i * 2], z = world.coastPts[i * 2 + 1];
    if (i === i0) ctx.moveTo(x, z); else ctx.lineTo(x, z);
  }
  ctx.lineTo(world.coastPts[i1 * 2] - 4000, world.coastPts[i1 * 2 + 1]);
  ctx.lineTo(world.coastPts[i0 * 2] - 4000, world.coastPts[i0 * 2 + 1]);
  ctx.closePath();
  ctx.fillStyle = 'rgba(42,150,160,0.45)';
  ctx.fill();

  line(world.coastPts, 'rgba(230,225,190,0.85)', 2.5);
  line(world.roadPts, 'rgba(255,255,255,0.30)', 12);
  line(world.roadPts, 'rgba(255,209,102,0.95)', 3);
  ctx.restore();

  // the car, always at the centre pointing up
  ctx.save();
  ctx.translate(R, R);
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.stroke();
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

async function boot() {
  world = await buildWorld(scene, (p, t) => {
    el.bar.style.width = Math.round(p * 100) + '%';
    el.stage.textContent = t;
  });

  car = new Vehicle(world);
  scene.add(car.group);
  car.reset(120);                                 // start on Trần Phú

  setNight(false);
  updateCamera(car, 1, 0);

  el.loading.classList.add('done');
  setTimeout(() => el.loading.remove(), 700);

  renderer.setAnimationLoop(tick);
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (car.teleported) { camSmooth = null; car.teleported = false; }
  car.update(dt, readInput());
  world.update(t, camera.position.x, camera.position.z);
  updateCamera(car, dt, t);

  // the shadow frustum rides with the car
  const dir = night ? SUN_NIGHT : SUN_DAY;
  sun.position.set(car.x + dir.x * 130, car.y + dir.y * 130, car.z + dir.z * 130);
  sun.target.position.set(car.x, car.y, car.z);
  sun.target.updateMatrixWorld();

  renderer.render(scene, camera);
  updateHud(dt);
  drawMap();
}

boot().catch(err => {
  console.error(err);
  const f = document.getElementById('fatal');
  f.style.display = 'flex';
  document.getElementById('fatalMsg').textContent = (err && err.stack) || String(err);
});

// keep bundlers/linters honest about the shared helpers we re-export for debugging
window.__vcd = { get car() { return car; }, get world() { return world; }, renderer, scene, camera, heightAt, roadCenterX, roadTangent };
