// Box-built cars: player driving physics + traffic AI on the road grid.
import { CFG } from './config.js';
import { G } from './state.js';
import { clamp, dist2 } from './utils.js';
import { ROAD_LINES, CITY_HALF, randomRoadPos } from './city.js';

const DEFAULTS = { sedan: 0x3a7bd5, taxi: 0xf2c200, van: 0x8a8f96, sport: 0xc23b2e, truck: 0x4a6b4f, police: 0xe8e8e8 };
const DIMS = { // width, bodyLen, bodyH, cabinLen, cabinH
  sedan: [1.9, 4.4, 0.62, 2.2, 0.55], taxi: [1.9, 4.4, 0.62, 2.2, 0.55],
  van: [2.0, 5.2, 1.05, 3.4, 0.8], sport: [2.0, 4.2, 0.5, 1.9, 0.45],
  truck: [2.2, 6.4, 0.9, 1.6, 1.0], police: [1.9, 4.4, 0.62, 2.2, 0.55],
};
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 10);
const shadowGeo = new THREE.CircleGeometry(1, 20);
const glassMat = new THREE.MeshLambertMaterial({ color: 0x1c2733 });
const tireMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
const matCache = new Map();
function paint(color) {
  let m = matCache.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); matCache.set(color, m); }
  return m;
}
function box(parent, mat, w, h, l, x, y, z) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, l);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export function createCar(scene, model, x, z, heading, color) {
  const d = DIMS[model] || DIMS.sedan;
  const w = d[0], len = d[1];
  const col = color === undefined ? (DEFAULTS[model] || 0x888888) : color;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = heading;
  const bodyMat = paint(col);
  if (model === 'truck') {
    box(g, bodyMat, w, d[2], 1.8, 0, 0.85, len / 2 - 0.9); // cab
    box(g, glassMat, w - 0.2, 0.7, 0.3, 0, 1.15, len / 2 - 1.6);
    box(g, paint(0xd8d8d8), w, 1.5, len - 2.2, 0, 1.05, -len / 2 + (len - 2.2) / 2 + 0.2); // cargo
  } else {
    box(g, bodyMat, w, d[2], len, 0, 0.55, 0);
    box(g, glassMat, w - 0.2, d[4], d[3], 0, 0.55 + d[2] / 2 + d[4] / 2 - 0.05, -0.2); // cabin
  }
  if (model === 'taxi') box(g, paint(0x222222), 0.9, 0.28, 0.5, 0, 1.45, -0.2); // roof sign
  if (model === 'sport') box(g, bodyMat, w, 0.08, 0.5, 0, 1.05, -len / 2 + 0.1); // spoiler
  if (model === 'police') {
    box(g, paint(0x111111), w + 0.05, 0.18, len * 0.4, 0, 0.62, 0); // black band
    box(g, paint(0xd21f2b), 0.5, 0.22, 0.4, -0.45, 1.42, -0.2); // light bar
    box(g, paint(0x1f4fd2), 0.5, 0.22, 0.4, 0.45, 1.42, -0.2);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wh = new THREE.Mesh(wheelGeo, tireMat);
    wh.rotation.z = Math.PI / 2;
    wh.position.set(sx * (w / 2), 0.42, sz * len * 0.32);
    g.add(wh);
  }
  const sh = new THREE.Mesh(shadowGeo, shadowMat); // blob shadow, no shadow maps
  sh.rotation.x = -Math.PI / 2;
  sh.scale.set(w * 0.85, len * 0.62, 1);
  sh.position.y = 0.03;
  g.add(sh);
  scene.add(g);
  return {
    group: g, model, pos: g.position, heading, speed: 0,
    driver: false, isPlayer: false, color: col, width: w, length: len,
    ai: { target: 9 + Math.random() * 3, turned: false },
  };
}

function hitsCollider(x, z, r, colliders) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
  }
  return false;
}

// Arcade driving: accel / brake / steer, slide along building colliders.
export function driveCar(car, input, dt, colliders) {
  if (input.fwd) car.speed += CFG.CAR_ACCEL * dt;
  if (input.back) car.speed -= (car.speed > 0.5 ? CFG.CAR_BRAKE : CFG.CAR_ACCEL * 0.6) * dt;
  if (input.brake) car.speed -= Math.sign(car.speed) * CFG.CAR_BRAKE * dt;
  if (!input.fwd && !input.back && !input.brake) car.speed -= Math.sign(car.speed) * 6 * dt;
  if (Math.abs(car.speed) < 0.08 && !input.fwd && !input.back) car.speed = 0;
  car.speed = clamp(car.speed, -12, CFG.CAR_MAX);
  const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  car.heading += steer * CFG.CAR_TURN * dt * clamp(Math.abs(car.speed) / 8, 0, 1) * (car.speed < 0 ? -1 : 1);
  const r = car.width / 2 + 0.3;
  const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
  if (!hitsCollider(nx, car.pos.z, r, colliders)) car.pos.x = nx; else car.speed *= 0.4;
  if (!hitsCollider(car.pos.x, nz, r, colliders)) car.pos.z = nz; else car.speed *= 0.4;
  car.pos.x = clamp(car.pos.x, -CITY_HALF, CITY_HALF);
  car.pos.z = clamp(car.pos.z, -CITY_HALF, CITY_HALF);
  car.group.rotation.y = car.heading;
}

function nearIntersection(x, z) {
  for (const L of ROAD_LINES) {
    if (Math.abs(x - L) < 6 && Math.abs(z - L) < 6) return true;
  }
  return false;
}

// Traffic: follow the road grid, turn at intersections, stop for the car ahead,
// respawn near the player when far away. Parked cars (driver false) stay put.
export function updateTraffic(dt, colliders) {
  const px = G.player.pos ? G.player.pos.x : 0;
  const pz = G.player.pos ? G.player.pos.z : 0;
  const cars = G.vehicles;
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    if (car.isPlayer || !car.driver) continue;
    let target = car.ai.target;
    // Stop if a car is close ahead in the same direction.
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    for (let j = 0; j < cars.length; j++) {
      if (i === j) continue;
      const o = cars[j];
      const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 100 && d2 > 0.01 && (dx * fx + dz * fz) / Math.sqrt(d2) > 0.7) { target = 0; break; }
    }
    if (nearIntersection(car.pos.x, car.pos.z)) {
      if (!car.ai.turned) {
        car.ai.turned = true;
        const r = Math.random();
        if (r > 0.65) car.heading += r > 0.825 ? Math.PI / 2 : -Math.PI / 2;
      }
    } else car.ai.turned = false;
    car.speed += clamp(target - car.speed, -8 * dt, 6 * dt);
    if (car.speed < 0) car.speed = 0;
    const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
    const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
    if (hitsCollider(nx, nz, car.width / 2 + 0.3, colliders)) {
      car.heading += Math.PI; // blocked (shouldn't happen on roads): U-turn
      car.speed = 0;
    } else { car.pos.x = nx; car.pos.z = nz; }
    car.group.rotation.y = car.heading;
    // Far from the player: respawn on a road nearby.
    if (dist2(car.pos.x, car.pos.z, px, pz) > 130 * 130) {
      const rng = Math.random;
      let p = randomRoadPos(rng);
      for (let t = 0; t < 4 && dist2(p.x, p.z, px, pz) > 90 * 90; t++) p = randomRoadPos(rng);
      car.pos.set(p.x, 0, p.z);
      car.heading = p.heading;
      car.speed = 0;
      car.group.rotation.y = p.heading;
    }
  }
}

export function nearestCar(pos, radius, excludePlayer) {
  let best = null, bd = radius * radius;
  for (const c of G.vehicles) {
    if (excludePlayer && c.isPlayer) continue;
    const d = dist2(pos.x, pos.z, c.pos.x, c.pos.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
