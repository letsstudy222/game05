// main.js — renderer, sky, lights, cameras, input, HUD, loop.

import * as THREE from 'three';
import {
  buildWorld, heightAt, roadCenterX, roadY, roadTangent, districtAt, WORLD
} from './world.js?v=nt-city-02';
import { Vehicle } from './vehicle.js?v=nt-city-02';
import { createRouteMap } from './map.js?v=nt-city-02';
import { createTraffic } from './traffic.js?v=nt-city-02';
import { loadDetailedCar } from './detailed-car.js?v=nt-city-02';
import { ROUTE_KM } from './route.js?v=nt-city-02';

const BUILD_ID='NT-CITY-02';
let paused = true, routeMap = null, mapWasPaused = true, started = false, traffic=null;
let quality = window.matchMedia('(pointer: coarse)').matches ? 'low' : 'balanced';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

const COARSE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
if (COARSE) document.body.classList.add('touch');

// ---------------------------------------------------------------------------
// renderer / scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: !COARSE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, COARSE ? 1 : 1.5));
renderer.domElement.setAttribute("aria-label", "Cảnh lái xe 3D ven biển");
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !COARSE;              // shadows off on phones
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// A small generated sky environment gives paint and windows daylight reflections.
const envCanvas=document.createElement('canvas');envCanvas.width=256;envCanvas.height=128;
const envContext=envCanvas.getContext('2d');
const envGradient=envContext.createLinearGradient(0,0,0,128);
envGradient.addColorStop(0,'#77b8dc');envGradient.addColorStop(.48,'#e8f0e4');envGradient.addColorStop(.55,'#afbaa1');envGradient.addColorStop(1,'#57604c');
envContext.fillStyle=envGradient;envContext.fillRect(0,0,256,128);
envContext.fillStyle='#fff8e7';envContext.beginPath();envContext.arc(55,27,6,0,Math.PI*2);envContext.fill();
const envTexture=new THREE.CanvasTexture(envCanvas);envTexture.mapping=THREE.EquirectangularReflectionMapping;envTexture.colorSpace=THREE.SRGBColorSpace;
const pmrem=new THREE.PMREMGenerator(renderer);const skyEnvironment=pmrem.fromEquirectangular(envTexture);
scene.environment=skyEnvironment.texture;scene.environmentIntensity=.35;envTexture.dispose();pmrem.dispose();
// The far plane is deliberately tight: it is the main triangle-budget lever,
// and the coastal haze hides the cut.
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.25, 1750);

// ---------------------------------------------------------------------------
// day / night palettes
// ---------------------------------------------------------------------------

const DAY = {
  skyTop: new THREE.Color('#348bc5'), skyBottom: new THREE.Color('#deede9'),
  fog: new THREE.Color('#c3dde5'), fogNear: 450, fogFar: 1500,
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
    uStars: { value: 0 },
    uTime: { value: 0 }
  },
  vertexShader: `
    varying vec3 vDir;
    void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    precision highp float;
    uniform vec3 uTop, uBottom, uSun, uSunColor;
    uniform float uStars, uTime;
    varying vec3 vDir;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);
    }
    void main(){
      vec3 d = normalize(vDir);
      float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 col = mix(uBottom, uTop, pow(t, 0.85));
      float s = max(dot(d, normalize(uSun)), 0.0);
      col += uSunColor * pow(s, 220.0) * 2.2;
      col += uSunColor * pow(s, 7.0) * 0.16;
      vec2 cp=d.xz/max(d.y,0.12)*2.8+vec2(uTime*0.004,0);
      float clouds=noise(cp)*0.55+noise(cp*2.1)*0.28+noise(cp*4.3)*0.17;
      float cover=smoothstep(0.56,0.78,clouds)*smoothstep(0.02,0.22,d.y);
      col=mix(col,mix(vec3(0.98,0.96,0.91),vec3(0.14,0.19,0.27),uStars),cover*0.78);
      if (uStars > 0.01 && d.y > 0.0) {
        vec2 g = floor(d.xz * 190.0 / max(d.y, 0.18));
        float n = h21(g);
        float star = step(0.9975, n) * (0.5 + 0.5 * h21(g + 7.0));
        col += vec3(star) * uStars * d.y;
      }
      gl_FragColor = vec4(col, 1.0);
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1700, 32, 20), skyMat);
sky.name = 'sky';
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

function clearInput() {
  for (const k in keys) delete keys[k];
  for (const k in touch) touch[k] = false;
  document.querySelectorAll('.tbtn.active').forEach(e => e.classList.remove('active'));
}
function togglePause(force) {
  if (!started || routeMap?.isOpen) return;
  paused = force === undefined ? !paused : force;
  clearInput();
  document.getElementById('pauseMenu').hidden = !paused;
  document.getElementById('pauseButton').textContent = paused ? '▶' : 'II';
}
window.addEventListener('keydown', e => {
  if (e.target.matches('select,input,a') && !['Escape','m'].includes(e.key.toLowerCase())) return;
  const k=e.key.toLowerCase();
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
  if (routeMap?.isOpen) { if (k==='m') routeMap.close(); return; }
  if (k==='escape') { togglePause(); return; }
  if (k==='m') { routeMap?.open(); return; }
  if (paused) return;
  if (keys[k]) return;
  keys[k]=true;
  if(k==='c') cycleCamera();
  if(k==='n') setNight(!night);
  if(k==='r') respawn();
  if(k==='h') document.getElementById('keys').classList.toggle('hidden');
});
window.addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});
window.addEventListener('blur',()=>{clearInput(); if(started && !routeMap?.isOpen)togglePause(true);});
// A hidden tab must never retain throttle or accumulate seconds of simulation.
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(started && !routeMap?.isOpen)togglePause(true);}});

function bindTouch(id, on, off) {
  const el = document.getElementById(id);
  if (!el) return;
  const down = e => { e.preventDefault(); if (paused) return; el.setPointerCapture(e.pointerId); el.classList.add('active'); on(); };
  const up = e => { e.preventDefault(); el.classList.remove('active'); if (off) off(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
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
  // Driver command: negative is left, positive is right. Vehicle converts to +Z yaw.
  input.steer = (left ? -1 : 0) + (right ? 1 : 0);
  input.handbrake = !!(keys[' '] || touch.hand);
  return input;
}

// ---------------------------------------------------------------------------
// cameras
// ---------------------------------------------------------------------------

const CAMS = ['chase', 'bonnet', 'cinematic'];
let camMode = 0;
function cycleCamera() { camMode = (camMode + 1) % CAMS.length; camSmooth = null;
  const label=['Theo xe','Trong xe','Điện ảnh'][camMode];
  document.getElementById('cameraLabel').textContent=label;
  document.getElementById('cameraHint').textContent=label.toUpperCase();
}

let camSmooth = null, lookSmooth = null;
const _off = new THREE.Vector3();
const _want = new THREE.Vector3();
const _look = new THREE.Vector3();

function updateCamera(car, dt, time) {
  const mode = CAMS[camMode];
  const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
  const speedF = clamp(car.kmh / 180, 0, 1);

  if (mode === 'bonnet') {
    _want.set(car.x + s * 1.4, car.y + 1.66, car.z + c * 1.4);
    _look.set(car.x + s * 40, car.y + 1.9, car.z + c * 40);
    camera.position.copy(_want);
    camera.fov = lerp(74, 88, speedF);
  } else {
    if (mode === 'chase') _off.set(0, 3.25, -8.2 - speedF * 2.5);
    else _off.set(7.0 + Math.sin(time * 0.13) * 3.5, 3.4, -11.5);

    const wx = car.x + _off.x * c + _off.z * s;
    const wz = car.z - _off.x * s + _off.z * c;
    const ground = heightAt(wx, wz);
    _want.set(wx, Math.max(car.y + _off.y, ground + 1.6), wz);

    if (!camSmooth) camSmooth = _want.clone();
    // position is smoothed, look-at is not
    camSmooth.lerp(_want, 1 - Math.exp(-dt * (mode === 'chase' ? 8 : 3.0)));
    camera.position.copy(camSmooth);
    _look.set(car.x + s * 6, car.y + 1.35, car.z + c * 6);
    camera.fov = mode === 'chase' ? lerp(62, 78, speedF) : lerp(48, 56, speedF);
  }

  if (!lookSmooth || dt >= 0.5 || mode === 'bonnet') lookSmooth = _look.clone();
  else lookSmooth.lerp(_look, 1 - Math.exp(-dt * 14));
  camera.lookAt(lookSmooth);
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
  scene.environmentIntensity = p === NIGHT ? .04 : .35;

  if (world) {
    world.setNight(p === NIGHT);
    world.setSun(sunDir, p.sun);
    world.setFog(p.fog, p.fogNear, p.fogFar);
  }
  if (car) car.setNight(p === NIGHT);
  traffic?.setNight(p === NIGHT);
}

function setNight(v) {
  night = !!v;
  applyPalette(night ? NIGHT : DAY, night ? SUN_NIGHT : SUN_DAY);
  const b = document.getElementById('tNight');
  if (b) b.textContent = night ? 'NGÀY' : 'ĐÊM';
  document.getElementById('dayButton').textContent = night ? '☾' : '☀';
  document.getElementById('dayButton').setAttribute('aria-label', night ? 'Chuyển sang ngày' : 'Chuyển sang đêm');
}

function respawn() { if (car) { car.reset(car.z); camSmooth = null; lookSmooth = null; } }

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
    document.getElementById('miniLocation').textContent = d.name.split(' · ')[0];
    document.getElementById('gear').textContent = car.speed < -0.3 ? 'R' : car.speed > 0.3 ? 'D' : 'N';
    document.getElementById('driveState').textContent = paused ? 'TẠM DỪNG' : input.brake ? 'ĐANG PHANH' : 'KHÁM PHÁ';
    document.getElementById('distance').textContent = (car.distance/1000).toFixed(1) + ' km đã đi';
    document.getElementById('journeyFill').style.width = clamp((3060-car.z)/6120*100,0,100)+'%';
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
const MAP_RANGE = 320;
function drawMap() {
  const w = el.map.width, h = el.map.height;
  const R = w / 2, centerY = h / 2, scale = R / MAP_RANGE;
  const ctx = mapCtx;
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.beginPath(); ctx.rect(0,0,w,h); ctx.clip();
  ctx.fillStyle = '#64816b'; ctx.fillRect(0, 0, w, h);

  // heading-up: the car's forward direction always points to the top of the dial
  const cs = Math.cos(car.yaw) * scale, sn = Math.sin(car.yaw) * scale;
  ctx.translate(R, centerY);
  ctx.transform(-cs, -sn, sn, -cs, 0, 0);
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
  ctx.fillStyle = '#386f81';
  ctx.fill();

  if(world.city) {
    ctx.fillStyle='#b9bfac';
    for(const b of world.city.footprints)ctx.fillRect(b.x-b.w/2,b.z-b.d/2,b.w,b.d);
    for(const points of world.city.mapLines) {
      ctx.beginPath();for(let i=0;i<points.length;i+=2){i?ctx.lineTo(points[i],points[i+1]):ctx.moveTo(points[i],points[i+1]);}
      ctx.strokeStyle='#e4dfcb';ctx.lineWidth=8/scale;ctx.stroke();ctx.strokeStyle='#778079';ctx.lineWidth=4/scale;ctx.stroke();
    }
  }
  line(world.coastPts, 'rgba(230,225,190,0.85)', 2.5);
  line(world.roadPts, '#e0ddc4', 9);
  line(world.roadPts, '#e4b878', 3);
  ctx.restore();

  // the car, always at the centre pointing up
  ctx.save();
  ctx.translate(R, centerY);
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0,0,w,h);
  ctx.fillStyle='#e9e9d4';ctx.font='10px sans-serif';ctx.fillText('100 m',10,h-9);
  ctx.fillRect(10,h-17,100*scale,2);
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
    el.bar.style.width = Math.round(p * 80) + '%';
    el.stage.textContent = t;
  });

  car = new Vehicle(world);
  scene.add(car.group);
  car.reset(3060);
  el.stage.textContent='Mô hình xe 3D và vật liệu…';
  await loadDetailedCar(car);
  el.bar.style.width='95%';
  traffic=createTraffic(scene,world,roadCenterX,roadY);                                 // start on Trần Phú

  routeMap = await createRouteMap({getCar:()=>car,getCity:()=>world.city,
    onOpen:()=>{mapWasPaused=paused;paused=true;clearInput();},
    onClose:()=>{paused=mapWasPaused;clearInput();document.activeElement?.blur();},
    travel:z=>{car.reset(z);camSmooth=null;lookSmooth=null;}
  });
  setNight(false);
  applyQuality(quality);
  updateCamera(car, 1, 0);

  el.bar.style.width='100%';
  el.loading.classList.add('done');
  setTimeout(() => el.loading.remove(), 700);

  document.getElementById("welcome").hidden=false;
  updateHud(0.2);
  renderer.setAnimationLoop(tick);
}

const STEP = 1/120;
let accumulator=0,simulationTime=0,previous=null,qualityTimer=0,qualityFrames=0;
function snapshot(){return {x:car.x,y:car.y,z:car.z,yaw:car.yaw,pitch:car.pitch,roll:car.roll};}
function tick() {
  const dt=Math.min(clock.getDelta(),0.15);
  if(car.teleported){camSmooth=null;lookSmooth=null;car.teleported=false;previous=snapshot();accumulator=0;}
  if(!paused) {
    accumulator+=dt;
    const controls=readInput();
    let steps=0;
    while(accumulator>=STEP && steps<18) {
      previous=snapshot();car.update(STEP,controls);accumulator-=STEP;simulationTime+=STEP;steps++;
    }
  } else {accumulator=0;previous=snapshot();input.throttle=0;input.brake=0;input.steer=0;}
  const alpha=paused?1:accumulator/STEP;
  const visual={...car};
  if(previous)for(const key of ['x','y','z','yaw','pitch','roll'])visual[key]=lerp(previous[key],car[key],alpha);
  visual.kmh=car.kmh;
  car.group.position.set(visual.x,visual.y,visual.z);
  car.group.rotation.set(visual.pitch,visual.yaw,visual.roll,'YXZ');
  updateCamera(visual,dt,simulationTime);
  world.update(simulationTime,camera.position.x,camera.position.z);
  traffic?.update(simulationTime,car);
  skyMat.uniforms.uTime.value=simulationTime;
  const dir=night?SUN_NIGHT:SUN_DAY;
  sun.position.set(visual.x+dir.x*130,visual.y+dir.y*130,visual.z+dir.z*130);
  sun.target.position.set(visual.x,visual.y,visual.z);sun.target.updateMatrixWorld();
  renderer.render(scene,camera);
  updateHud(dt);drawMap();
  qualityTimer+=dt;qualityFrames++;
  if(quality==='balanced' && qualityTimer>4) {
    const observed=qualityFrames/qualityTimer;
    if(observed<28 && renderer.getPixelRatio()>.8)renderer.setPixelRatio(Math.max(.8,renderer.getPixelRatio()-.15));
    qualityTimer=0;qualityFrames=0;
  }
}
function applyQuality(value) {
  quality=value;
  const low=value==='low',cap=value==='high'?2:low?1:1.5;
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,cap));
  renderer.shadowMap.enabled=!low;sun.castShadow=!low;
  sun.shadow.mapSize.set(value==='high'?2048:1024,value==='high'?2048:1024);
  if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}
  renderer.shadowMap.needsUpdate=true;
  scene.traverse(o=>{if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.needsUpdate=true;}});
  qualityTimer=0;qualityFrames=0;
  document.getElementById('quality').value=value;
}
function startDrive(inCity) {
  car.reset(inCity?2950:3060);
  if(inCity){car.x=world.city.originX+80;car.yaw=-Math.PI;car.y=heightAt(car.x,car.z);car.syncTransform();}
  started=true;paused=false;document.getElementById('welcome').hidden=true;clearInput();document.activeElement?.blur();
}
document.getElementById('startDrive').addEventListener('click',()=>startDrive(true));
document.getElementById('startCoast').addEventListener('click',()=>startDrive(false));
document.getElementById('resumeDrive').addEventListener('click',()=>{togglePause(false);document.activeElement?.blur();});
document.getElementById('pauseButton').addEventListener('click',()=>togglePause());
document.getElementById('resetButton').addEventListener('click',()=>respawn());
document.getElementById('cameraButton').addEventListener('click',()=>{cycleCamera();document.activeElement?.blur();});
document.getElementById('dayButton').addEventListener('click',()=>{setNight(!night);document.activeElement?.blur();});
document.getElementById('quality').addEventListener('change',e=>applyQuality(e.target.value));
document.getElementById('showStats').addEventListener('change',e=>{el.stats.hidden=!e.target.checked;});

boot().catch(err => {
  console.error(err);
  const f = document.getElementById('fatal');
  f.style.display = 'flex';
  document.getElementById('fatalMsg').textContent = (err && err.stack) || String(err);
});

// keep bundlers/linters honest about the shared helpers we re-export for debugging
window.__vcd = { get car() { return car; }, get world() { return world; }, renderer, scene, camera, heightAt, roadCenterX, roadTangent, get paused(){return paused;}, get map(){return routeMap;}, get quality(){return quality;}, get traffic(){return traffic;}, BUILD_ID, ROUTE_KM };
