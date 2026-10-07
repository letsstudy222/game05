// vehicle.js — one drivable car: geometry generated in code, arcade physics
// with no physics engine. Local space: +Z is forward, +Y up.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { heightAt, roadCenterX, roadTangent, WORLD } from './world.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const _c = new THREE.Color();
function tint(geo, color) {
  _c.set(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function box(w, h, d, color, x, y, z, rx) {
  const rounded = new RoundedBoxGeometry(w, h, d, 2, Math.min(w,h,d)*0.15);
  const g = rounded;
  // Use indexed triangles consistently for the merged body geometry.
  g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));
  tint(g, color);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

const WHEEL_R = 0.37;
const WHEELBASE_F = 1.47;
const WHEELBASE_R = -1.44;
const TRACK = 0.85;

// a boxy 7-seat crossover — the shape that reads as "Vietnamese family car"
function buildBody(paintColor) {
  const g = [];
  const body = paintColor;
  const dark = '#1b2024';
  const glass = '#2b3d47';
  const trim = '#3a4146';

  // lower body
  g.push(box(1.86, 0.62, 4.78, body, 0, 0.92, 0));
  g.push(box(1.90, 0.30, 4.60, trim, 0, 0.60, 0));
  // sills + arches
  g.push(box(1.94, 0.22, 1.30, dark, 0, 0.66, WHEELBASE_F));
  g.push(box(1.94, 0.22, 1.30, dark, 0, 0.66, WHEELBASE_R));

  // cabin
  g.push(box(1.70, 0.70, 2.86, body, 0, 1.56, -0.12));
  // windscreen and rear screen, raked
  g.push(box(1.62, 0.74, 0.14, glass, 0, 1.55, 1.30, -0.42));
  g.push(box(1.62, 0.70, 0.14, glass, 0, 1.55, -1.55, 0.36));
  // side glass
  g.push(box(0.06, 0.50, 2.55, glass, 0.86, 1.62, -0.12));
  g.push(box(0.06, 0.50, 2.55, glass, -0.86, 1.62, -0.12));
  // pillars
  for (const z of [1.18, 0.05, -1.10]) {
    g.push(box(0.10, 0.72, 0.12, body, 0.86, 1.56, z));
    g.push(box(0.10, 0.72, 0.12, body, -0.86, 1.56, z));
  }
  // roof + rails
  g.push(box(1.72, 0.10, 2.90, body, 0, 1.92, -0.12));
  g.push(box(0.10, 0.10, 2.30, trim, 0.72, 2.00, -0.12));
  g.push(box(0.10, 0.10, 2.30, trim, -0.72, 2.00, -0.12));

  // front: bumper, grille, lamps
  g.push(box(1.88, 0.34, 0.24, trim, 0, 0.72, 2.40));
  g.push(box(1.44, 0.26, 0.14, dark, 0, 1.06, 2.38));
  g.push(box(0.44, 0.20, 0.10, '#e8f0f4', 0.63, 1.08, 2.40));
  g.push(box(0.44, 0.20, 0.10, '#e8f0f4', -0.63, 1.08, 2.40));
  // rear: bumper + tail lamps
  g.push(box(1.88, 0.34, 0.24, trim, 0, 0.72, -2.40));
  g.push(box(0.34, 0.30, 0.10, '#a8271f', 0.70, 1.10, -2.40));
  g.push(box(0.34, 0.30, 0.10, '#a8271f', -0.70, 1.10, -2.40));
  // mirrors
  g.push(box(0.26, 0.14, 0.12, body, 1.02, 1.46, 1.05));
  g.push(box(0.26, 0.14, 0.12, body, -1.02, 1.46, 1.05));

  const merged = mergeGeometries(g, false);
  merged.computeVertexNormals();
  return merged;
}

function buildWheel() {
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.27, 24, 1);
  tyre.rotateZ(Math.PI / 2);
  tint(tyre, '#17191b');
  const rim = new THREE.CylinderGeometry(WHEEL_R * 0.58, WHEEL_R * 0.58, 0.29, 10, 1);
  rim.rotateZ(Math.PI / 2);
  tint(rim, '#b9bec2');
  const spoke = new THREE.BoxGeometry(0.30, 0.07, WHEEL_R * 1.0);
  tint(spoke, '#9aa0a4');
  const g = mergeGeometries([tyre, rim, spoke], false);
  g.computeVertexNormals();
  return g;
}

export function createCar() {
  const group = new THREE.Group();
  group.name = 'car';

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.28 });
  const bodyMesh = new THREE.Mesh(buildBody('#e5dfcb'), mat);
  bodyMesh.castShadow = true;
  group.add(bodyMesh);

  const plateCanvas=document.createElement('canvas');plateCanvas.width=256;plateCanvas.height=64;
  const pc=plateCanvas.getContext('2d');pc.fillStyle='#f4f2df';pc.fillRect(0,0,256,64);
  pc.strokeStyle='#333';pc.lineWidth=4;pc.strokeRect(4,4,248,56);pc.fillStyle='#20282b';pc.font='bold 34px sans-serif';pc.textAlign='center';pc.fillText('79A-268.19',128,44);
  const plateTexture=new THREE.CanvasTexture(plateCanvas);plateTexture.colorSpace=THREE.SRGBColorSpace;
  const plate=new THREE.Mesh(new THREE.PlaneGeometry(.9,.225),new THREE.MeshBasicMaterial({map:plateTexture}));plate.position.set(0,.84,-2.54);plate.rotation.y=Math.PI;group.add(plate);
  const wheelGeo = buildWheel();
  const wheels = [];
  const steerPivots = [];
  const spec = [
    [TRACK, WHEELBASE_F, true], [-TRACK, WHEELBASE_F, true],
    [TRACK, WHEELBASE_R, false], [-TRACK, WHEELBASE_R, false]
  ];
  for (const [x, z, front] of spec) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_R, z);
    const w = new THREE.Mesh(wheelGeo, mat);
    w.castShadow = true;
    pivot.add(w);
    group.add(pivot);
    wheels.push(w);
    if (front) steerPivots.push(pivot);
  }

  const brakeMat = new THREE.MeshStandardMaterial({ color: '#8d1818', emissive: '#ff301c', emissiveIntensity: 0.15 });
  for (const x of [-0.7, 0.7]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.27, 0.04), brakeMat);
    lamp.position.set(x, 1.1, -2.46); group.add(lamp);
  }
  // headlight beams — two cheap spot lights, no shadows, off during the day
  const beams = [];
  for (const x of [0.63, -0.63]) {
    const s = new THREE.SpotLight(0xfff0cf, 0, 120, 0.48, 0.55, 1.4);
    s.position.set(x, 1.05, 2.35);
    s.target.position.set(x * 1.4, -0.4, 30);
    group.add(s, s.target);
    beams.push(s);
  }
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff3d4 });
  const glows = [];
  for (const x of [0.63, -0.63]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.04), glowMat);
    m.position.set(x, 1.08, 2.46);
    m.visible = false;
    group.add(m);
    glows.push(m);
  }

  return { group, wheels, steerPivots, beams, glows, brakeMat };
}

// ---------------------------------------------------------------------------

export class Vehicle {
  constructor(world) {
    this.world = world;
    const car = createCar();
    this.group = car.group;
    this.wheels = car.wheels;
    this.steerPivots = car.steerPivots;
    this.beams = car.beams;
    this.glows = car.glows;
    this.brakeMat = car.brakeMat;
    this.distance = 0;
    this.acceleration = 0;

    this.x = 0; this.z = 0; this.yaw = 0;
    this.speed = 0;
    this.steer = 0;
    this.spin = 0;
    this.pitch = 0; this.roll = 0; this.y = 0;
    this.onRoad = true;
    this.inWater = false;
    this.reset(0);
  }

  reset(z) {
    const zz = clamp(z === undefined ? this.z : z, WORLD.zMin + 40, WORLD.zMax - 40);
    this.z = zz;
    this.x = roadCenterX(zz);
    const t = roadTangent(zz);
    this.yaw = Math.atan2(-t.x, -t.z);
    this.speed = 0;
    this.steer = 0;
    this.y = heightAt(this.x, this.z);
    this.pitch = 0; this.roll = 0;
    this.onRoad = true; this.inWater = false;
    this.teleported = true;
    this.syncTransform();
  }

  lateralOffset() {
    const t = roadTangent(this.z);
    return Math.abs(this.x - roadCenterX(this.z)) * t.z;
  }

  update(dt, input) {
    const prevX = this.x, prevZ = this.z;
    const oldSpeed = this.speed;

    this.onRoad = this.lateralOffset() < WORLD.roadHalfWidth + 0.5;
    const on = this.onRoad;

    // ---- longitudinal ----
    const maxF = on ? 50 : 15;          // m/s : ~180 km/h on tarmac, ~54 off it
    const maxR = on ? 12 : 6;
    let a = 0;

    if (input.throttle > 0) {
      a += 9.4 * input.throttle * (1 - clamp(this.speed / maxF, 0, 1));
    }
    if (input.brake > 0) {
      if (this.speed > 0.4) a -= 21 * input.brake;
      else a -= 6.5 * input.brake * (1 - clamp(-this.speed / maxR, 0, 1));
    }
    if (input.handbrake && Math.abs(this.speed) > 0.4) {
      a -= Math.sign(this.speed) * 24;
    }

    // drag: linear rolling resistance + quadratic aero
    a -= this.speed * (on ? 0.085 : 0.60);
    a -= Math.sign(this.speed) * this.speed * this.speed * 0.0016;

    this.speed += a * dt;
    if (!input.throttle && !input.brake && Math.abs(this.speed) < 0.28) this.speed = 0;
    this.speed = clamp(this.speed, -maxR, maxF);
    this.acceleration = (this.speed - oldSpeed) / dt;

    // ---- steering ----
    this.steer += (input.steer - this.steer) * (1 - Math.exp(-dt * 7));
    const authority = 1 / (1 + Math.abs(this.speed) * 0.055);
    const grip = (input.handbrake ? 0.55 : 1) * (on ? 1 : 0.72);
    const engage = clamp(Math.abs(this.speed) / 4.5, 0, 1);
    const yawRate = this.steer * 1.35 * authority * grip * engage * Math.sign(this.speed || 1);
    this.yaw += yawRate * dt;

    // ---- integrate ----
    this.x += Math.sin(this.yaw) * this.speed * dt;
    this.z += Math.cos(this.yaw) * this.speed * dt;

    // keep inside the world
    const proposedZ=this.z;
    this.z = clamp(this.z, WORLD.zMin + 20, WORLD.zMax - 20);
    if(this.z!==proposedZ)this.speed=0;
    this.x = clamp(this.x, WORLD.xMin + 20, WORLD.xMax - 20);

    // ---- the sea is a wall, not a swimming pool ----
    const hHere = heightAt(this.x, this.z);
    this.inWater = hHere < 0.9;
    if (hHere < 0.12) {
      this.x = prevX; this.z = prevZ;
      this.speed *= -0.15;
    } else if (hHere < 0.9) {
      this.speed *= (1 - 2.2 * dt);           // wet sand and shallow water drag hard
    }

    // ---- buildings and poles ----
    const push = this.world.resolve(this.x, this.z, 1.55);
    if (push) {
      this.x += push.x; this.z += push.z;
      const f = Math.sin(this.yaw) * push.x + Math.cos(this.yaw) * push.z;
      this.speed *= (f * this.speed < 0) ? 0.3 : 0.85;
    }

    // ---- terrain following: four points around the car ----
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const sample = (lx, lz) => heightAt(this.x + lx * c + lz * s, this.z - lx * s + lz * c);
    const fl = sample(-0.9, 1.45), fr = sample(0.9, 1.45);
    const rl = sample(-0.9, -1.45), rr = sample(0.9, -1.45);

    const targetY = Math.max((fl + fr + rl + rr) / 4, 0.15);
    const targetPitch = -Math.atan2(((fl + fr) - (rl + rr)) / 2, 2.9);
    const targetRoll = Math.atan2(((fr + rr) - (fl + rl)) / 2, 1.8);

    const k = 1 - Math.exp(-dt * 9);
    this.y += (targetY - this.y) * (1 - Math.exp(-dt * 14));
    this.pitch += (targetPitch - clamp(this.acceleration * 0.0014, -0.025, 0.025) - this.pitch) * k;
    this.roll += (targetRoll + this.steer * Math.min(Math.abs(this.speed) * 0.0018, 0.045) - this.roll) * k;

    // ---- visuals ----
    this.spin += (this.speed / WHEEL_R) * dt;
    for (const w of this.wheels) w.rotation.x = this.spin;
    const visualSteer = this.steer * 0.52;
    for (const p of this.steerPivots) p.rotation.y = visualSteer;

    this.distance += Math.hypot(this.x-prevX, this.z-prevZ);
    this.onRoad = this.lateralOffset() < WORLD.roadHalfWidth + 0.5;
    this.brakeMat.emissiveIntensity = input.brake || input.handbrake ? 2.5 : 0.15;
    this.syncTransform();
  }

  syncTransform() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  setNight(night) {
    for (const b of this.beams) b.intensity = night ? 850 : 0;
    for (const g of this.glows) g.visible = !!night;
  }

  get kmh() { return Math.abs(this.speed) * 3.6; }
}
