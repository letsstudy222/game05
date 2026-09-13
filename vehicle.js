// vehicle.js — one drivable car: arcade physics, no physics engine needed.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, roadZ, coastZ, ROAD_HALF, X_MIN, X_MAX } from './world.js';

const _c = new THREE.Color();
function paint(g, color) {
  _c.set(color);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function box(w, h, d, color, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, color);
}

const WHEEL_R = 0.36;
const MAX_FWD = 41;   // m/s ≈ 148 km/h
const MAX_REV = 9;
const ACCEL = 11;
const BRAKE = 24;

export function createCar(scene, color = '#c8452f') {
  const root = new THREE.Group();

  // A boxy 7-seat crossover — the workhorse of Vietnamese highways.
  const g = [
    box(1.86, 0.52, 4.36, color, 0, 0.62, 0),
    box(1.80, 0.42, 2.55, color, 0, 1.06, -0.15),
    box(1.66, 0.62, 2.20, '#12232b', 0, 1.44, -0.20),   // glass
    box(1.70, 0.10, 2.30, color, 0, 1.76, -0.20),       // roof
    box(1.62, 0.30, 1.05, color, 0, 0.98, 1.62),        // bonnet
    box(1.90, 0.26, 0.30, '#2b2f31', 0, 0.62, 2.16),
    box(1.90, 0.26, 0.30, '#2b2f31', 0, 0.62, -2.16),
    box(0.42, 0.16, 0.10, '#fff6dc', 0.66, 0.92, 2.20),
    box(0.42, 0.16, 0.10, '#fff6dc', -0.66, 0.92, 2.20),
    box(0.40, 0.16, 0.10, '#c0362c', 0.68, 0.96, -2.20),
    box(0.40, 0.16, 0.10, '#c0362c', -0.68, 0.96, -2.20),
    box(1.30, 0.07, 1.60, '#5c6266', 0, 1.83, -0.20),   // roof rack
    box(0.10, 0.16, 4.20, '#2b2f31', 0.94, 0.72, 0),
    box(0.10, 0.16, 4.20, '#2b2f31', -0.94, 0.72, 0),
  ];
  const body = new THREE.Mesh(mergeGeometries(g), new THREE.MeshLambertMaterial({ vertexColors: true }));
  body.castShadow = true;
  root.add(body);

  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.26, 14); tyre.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.14, 0.14, 0.28, 8); hub.rotateZ(Math.PI / 2);
  const wheelGeo = mergeGeometries([paint(tyre, '#171a1c'), paint(hub, '#9aa0a3')]);
  const wheelMat = new THREE.MeshLambertMaterial({ vertexColors: true });

  const wheels = [];
  for (const [x, z, front] of [[0.88, 1.42, 1], [-0.88, 1.42, 1], [0.88, -1.46, 0], [-0.88, -1.46, 0]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_R, z);
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.castShadow = true;
    pivot.add(w);
    pivot.userData = { front: !!front, spin: w };
    root.add(pivot);
    wheels.push(pivot);
  }

  const beams = [];
  for (const sx of [0.7, -0.7]) {
    const sl = new THREE.SpotLight(0xfff0cc, 0, 110, 0.42, 0.5, 1.0);
    sl.position.set(sx, 0.95, 2.2);
    sl.target.position.set(sx * 0.5, -1.0, 34);
    root.add(sl, sl.target);
    beams.push(sl);
  }

  scene.add(root);

  const state = {
    root, wheels, beams, WHEEL_R,
    x: -400, z: 0, yaw: 0, speed: 0, steer: 0, throttle: 0,
    offroad: false, prevSpeed: 0,
  };

  state.respawn = (x = state.x) => {
    state.x = THREE.MathUtils.clamp(x, X_MIN + 60, X_MAX - 60);
    state.z = roadZ(state.x);
    const dz = (roadZ(state.x + 4) - roadZ(state.x - 4)) / 8;
    state.yaw = Math.atan2(1, dz);   // forward = (sin yaw, cos yaw) ≈ (1, dz)
    state.speed = 0;
    state.steer = 0;
  };
  state.respawn(state.x);

  state.update = (dt, input) => {
    const t = THREE.MathUtils.clamp(input.throttle, -1, 1);
    state.throttle = t;

    if (t > 0) state.speed += (state.speed < 0 ? BRAKE : ACCEL) * t * dt;
    else if (t < 0) state.speed += (state.speed > 0 ? BRAKE : ACCEL * 0.6) * t * dt;

    if (input.handbrake) state.speed *= Math.pow(0.05, dt);

    const drag = state.offroad ? 2.6 : 1;
    state.speed -= state.speed * 0.34 * drag * dt;
    state.speed -= Math.sign(state.speed) * state.speed * state.speed * 0.0012 * dt;
    if (Math.abs(state.speed) < 0.08 && Math.abs(t) < 0.01) state.speed = 0;
    state.speed = THREE.MathUtils.clamp(
      state.speed, -MAX_REV, state.offroad ? MAX_FWD * 0.45 : MAX_FWD);

    state.steer += (input.steer - state.steer) * Math.min(1, dt * 9);
    const v = Math.abs(state.speed);
    const authority = Math.min(1, v / 6) * (1 - Math.min(0.62, v / 70));
    state.yaw += state.steer * 1.8 * authority * (input.handbrake ? 1.5 : 1)
      * dt * (state.speed < 0 ? -1 : 1);

    const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
    state.x = THREE.MathUtils.clamp(state.x + fx * state.speed * dt, X_MIN + 20, X_MAX - 20);
    state.z = THREE.MathUtils.clamp(state.z + fz * state.speed * dt,
      coastZ(state.x) + 5, roadZ(state.x) + 600);

    state.offroad = Math.abs(state.z - roadZ(state.x)) > ROAD_HALF + 0.6;

    root.position.set(state.x, heightAt(state.x, state.z) + 0.08, state.z);

    const hF = heightAt(state.x + fx * 2, state.z + fz * 2);
    const hB = heightAt(state.x - fx * 2, state.z - fz * 2);
    const hR = heightAt(state.x + fz, state.z - fx);
    const hL = heightAt(state.x - fz, state.z + fx);
    const squat = THREE.MathUtils.clamp((state.speed - state.prevSpeed) * 0.02, -0.05, 0.05);
    state.prevSpeed = state.speed;

    root.rotation.set(0, 0, 0);
    root.rotateY(state.yaw);
    root.rotateX(Math.atan2(hB - hF, 4) - squat);
    root.rotateZ(Math.atan2(hR - hL, 2));

    const spin = (state.speed * dt) / WHEEL_R;
    for (const w of wheels) {
      w.userData.spin.rotation.x -= spin;
      if (w.userData.front) w.rotation.y = state.steer * 0.5;
    }
    return state;
  };

  state.kmh = () => Math.abs(state.speed) * 3.6;
  return state;
}
