// main.js — renderer, sky, cameras, input, HUD.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildWorld, coastZ, roadZ, districtAt } from './world.js';
import { createCar } from './vehicle.js';
import { GOOGLE_3D_TILES_KEY, attachGoogleTiles } from './tiles.js';

const $ = (s) => document.querySelector(s);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/* ------------------------------------------------------------------ */
/* renderer + scene                                                    */
/* ------------------------------------------------------------------ */

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
const LOW_POWER = matchMedia('(pointer: coarse)').matches;
renderer.shadowMap.enabled = !LOW_POWER;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#bcd3d6', 0.00135);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.4, 6500);

const sky = new Sky();
sky.scale.setScalar(9000);   // recentred on the camera every frame
scene.add(sky);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 6;
skyU.rayleigh.value = 1.6;
skyU.mieCoefficient.value = 0.006;
skyU.mieDirectionalG.value = 0.82;

const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 460;
Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight(0xbfe3ec, 0x6d6146, 0.75);
scene.add(hemi);

const sunDir = new THREE.Vector3();
function setSun(elevationDeg, azimuthRad) {
  const el = THREE.MathUtils.degToRad(elevationDeg);
  sunDir.set(Math.sin(azimuthRad) * Math.cos(el), Math.sin(el), Math.cos(azimuthRad) * Math.cos(el)).normalize();
  skyU.sunPosition.value.copy(sunDir);
}

/* ------------------------------------------------------------------ */
/* input                                                               */
/* ------------------------------------------------------------------ */

const keys = new Set();
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyC') cycleCamera();
  if (e.code === 'KeyN') nightTarget = nightTarget > 0.5 ? 0 : 1;
  if (e.code === 'KeyR') car.respawn();
  if (e.code === 'KeyH') $('#hud').classList.toggle('on');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const touch = { g: 0, b: 0, l: 0, r: 0 };
if (LOW_POWER) document.body.classList.add('touch');
for (const [id, k] of [['#tg', 'g'], ['#tb', 'b'], ['#tl', 'l'], ['#tr', 'r']]) {
  const el = $(id);
  const on = (e) => { e.preventDefault(); touch[k] = 1; };
  const off = (e) => { e.preventDefault(); touch[k] = 0; };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('pointercancel', off);
}

function readInput() {
  const up = keys.has('KeyW') || keys.has('ArrowUp') || touch.g;
  const dn = keys.has('KeyS') || keys.has('ArrowDown') || touch.b;
  const lf = keys.has('KeyA') || keys.has('ArrowLeft') || touch.l;
  const rt = keys.has('KeyD') || keys.has('ArrowRight') || touch.r;
  return {
    throttle: (up ? 1 : 0) - (dn ? 1 : 0),
    steer: (lf ? 1 : 0) - (rt ? 1 : 0),
    handbrake: keys.has('Space'),
  };
}

/* ------------------------------------------------------------------ */
/* cameras                                                             */
/* ------------------------------------------------------------------ */

const CAMS = ['chase', 'hood', 'wide'];
let camIdx = 0;
function cycleCamera() { camIdx = (camIdx + 1) % CAMS.length; }

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const _v = new THREE.Vector3();

function updateCamera(dt) {
  const mode = CAMS[camIdx];
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const v = Math.abs(car.speed);

  if (mode === 'hood') {
    _v.set(0, 1.52, 0.5).applyMatrix4(car.root.matrixWorld);
    camPos.copy(_v);
    camLook.set(0, 1.35, 40).applyMatrix4(car.root.matrixWorld);
    camera.position.copy(camPos);
  } else {
    const back = mode === 'wide' ? 15 : 8.6;
    const up = mode === 'wide' ? 7.5 : 3.5;
    camPos.set(
      car.x - fx * (back + v * 0.09),
      car.root.position.y + up,
      car.z - fz * (back + v * 0.09)
    );
    camLook.set(car.x + fx * 9, car.root.position.y + 1.6, car.z + fz * 9);
    camera.position.lerp(camPos, 1 - Math.pow(0.0016, dt));
  }
  camera.lookAt(camLook);

  const wantFov = (mode === 'hood' ? 68 : 60) + Math.min(14, v * 0.34);
  camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ */
/* minimap                                                             */
/* ------------------------------------------------------------------ */

const mapCv = $('#map');
const mx = mapCv.getContext('2d');
const R = mapCv.width / 2;
const MSCALE = 0.42;          // px per metre

function drawMap() {
  const cx = car.x, cz = car.z, yaw = car.yaw;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const to = (x, z) => {
    const ex = x - cx, ez = z - cz;
    return [R + (ex * c - ez * s) * MSCALE, R - (ex * s + ez * c) * MSCALE];
  };

  mx.clearRect(0, 0, R * 2, R * 2);
  mx.save();
  mx.beginPath(); mx.arc(R, R, R - 2, 0, Math.PI * 2); mx.clip();
  mx.fillStyle = '#2f4436'; mx.fillRect(0, 0, R * 2, R * 2);

  const x0 = cx - 700, x1 = cx + 700, step = 20;

  mx.beginPath();
  for (let x = x0; x <= x1; x += step) { const p = to(x, coastZ(x)); x === x0 ? mx.moveTo(...p) : mx.lineTo(...p); }
  for (let x = x1; x >= x0; x -= step) { mx.lineTo(...to(x, coastZ(x) - 1400)); }
  mx.closePath();
  mx.fillStyle = '#0e5d68'; mx.fill();

  mx.beginPath();
  for (let x = x0; x <= x1; x += step) { const p = to(x, roadZ(x)); x === x0 ? mx.moveTo(...p) : mx.lineTo(...p); }
  mx.strokeStyle = '#d9d2c0'; mx.lineWidth = 4; mx.lineCap = 'round'; mx.stroke();

  mx.restore();

  mx.beginPath();
  mx.moveTo(R, R - 9); mx.lineTo(R - 6, R + 7); mx.lineTo(R + 6, R + 7);
  mx.closePath();
  mx.fillStyle = '#e2483a'; mx.fill();
  mx.strokeStyle = '#f2f7f5'; mx.lineWidth = 1.5; mx.stroke();
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

const bar = $('#bootbar i');
const bootMsg = $('#bootmsg');
let world, car, tiles = null;

async function progress(p, msg) {
  bar.style.width = (p * 100).toFixed(0) + '%';
  bootMsg.textContent = msg;
  await nextFrame(); await nextFrame();
}

let nightTarget = 0, night = 0;

async function boot() {
  setSun(34, 2.35);
  await progress(0.03, 'Khởi động WebGL…');

  world = await buildWorld(scene, progress);
  if (world.lamps) world.lamps.material.emissive = new THREE.Color('#ffd9a0');
  car = createCar(scene, '#c8452f');
  car.respawn(-400);

  if (GOOGLE_3D_TILES_KEY) {
    await progress(0.95, 'Nối Google Photorealistic 3D Tiles…');
    try { tiles = await attachGoogleTiles(scene, camera, renderer); }
    catch (err) { console.warn('3D Tiles không tải được:', err); }
  }

  await progress(1, 'Sẵn sàng');
  const start = $('#start');
  start.classList.add('ready');
  start.focus();
  start.addEventListener('click', () => {
    $('#boot').remove();
    $('#hud').classList.add('on');
    clock.start();
    loop();
  }, { once: true });
}

/* ------------------------------------------------------------------ */
/* loop                                                                */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock(false);
let elapsed = 0, lastDistrict = null, hudTick = 0;

const speedEl = $('#speed b');
const placeEl = $('#place b');
const subEl = $('#place small');
const thrEl = $('#throttle i');
const offEl = $('#offroad');

const FOG_DAY = new THREE.Color('#bcd3d6');
const FOG_NIGHT = new THREE.Color('#06131b');
const HEMI_DAY = new THREE.Color('#bfe3ec');
const HEMI_NIGHT = new THREE.Color('#25405a');

function applyNight(dt) {
  night += (nightTarget - night) * Math.min(1, dt * 1.2);
  setSun(34 - night * 42, 2.35 + night * 0.25);

  sun.intensity = 2.2 * Math.max(0, 1 - night * 1.05) + 0.04;
  sun.color.setHSL(0.09, 0.35 * (1 - night) + 0.05, 0.62 - night * 0.2);
  hemi.intensity = 0.75 * (1 - night) + 0.1;
  hemi.color.copy(HEMI_DAY).lerp(HEMI_NIGHT, night);

  skyU.turbidity.value = 6 - night * 4;
  skyU.rayleigh.value = 1.6 + night * 1.6;
  renderer.toneMappingExposure = 0.85 - night * 0.36;

  scene.fog.color.copy(FOG_DAY).lerp(FOG_NIGHT, night);
  scene.fog.density = 0.00135 + night * 0.0008;

  for (const b of car.beams) b.intensity = night * 70;
  if (world.lamps) world.lamps.material.emissiveIntensity = night * 0.3;
  world.setNight(night, sunDir);
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;

  car.update(dt, readInput());
  updateCamera(dt);
  sky.position.copy(camera.position);
  if (tiles) tiles.update();
  applyNight(dt);
  world.update(elapsed);

  sun.position.set(car.x + sunDir.x * 170, car.root.position.y + sunDir.y * 170, car.z + sunDir.z * 170);
  sun.target.position.set(car.x, car.root.position.y, car.z);
  sun.target.updateMatrixWorld();

  hudTick += dt;
  if (hudTick > 0.08) {
    hudTick = 0;
    speedEl.textContent = Math.round(car.kmh());
    thrEl.style.width = Math.min(100, Math.abs(car.throttle) * 100) + '%';
    offEl.classList.toggle('on', car.offroad && car.kmh() > 4);
    const d = districtAt(car.x);
    if (d !== lastDistrict) { lastDistrict = d; placeEl.textContent = d.name; subEl.textContent = d.sub; }
    drawMap();
  }

  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

boot();
