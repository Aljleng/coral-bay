// police.js — wanted stars, police cars + foot cops, busts, heat decay.
import { G } from './state.js';
import { CFG } from './config.js';
import { angLerp, clamp } from './utils.js';
import { createCar } from './vehicles.js';
import { sfx } from './audio.js';

let sceneRef = null, collidersRef = null;
let decayTimer = 0, noNearTimer = 0, spawnTimer = 0;

export function initPolice(scene, colliders) {
  sceneRef = scene || sceneRef;
  collidersRef = colliders || collidersRef;
}

export function addWanted(n) {
  const before = G.wanted;
  G.wanted = clamp(G.wanted + n, 0, 5);
  if (G.wanted > 0 && before === 0) sfx('siren');
}

export function clearWanted() { G.wanted = 0; }

export function policeCount() { return G.police.length; }

function makeFootCop(x, z) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.7, 0.2), mat(0x1a2a44));
  legs.position.y = 0.35; g.add(legs);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.65, 0.28), mat(0x1a2a44));
  body.position.y = 1.02; g.add(body);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.3, 0.3), mat(0x2244aa));
  vest.position.y = 1.1; g.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat(0xe8b88a));
  head.position.y = 1.62; g.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.4), mat(0x0d1526));
  cap.position.y = 1.8; g.add(cap);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.position.set(x, 0, z);
  return g;
}

function spawnPoliceCar() {
  if (!sceneRef) return;
  const pp = G.player.pos;
  const a = Math.random() * Math.PI * 2, r = 45 + Math.random() * 25;
  const x = clamp(pp.x + Math.sin(a) * r, -230, 230);
  const z = clamp(pp.z + Math.cos(a) * r, -230, 230);
  let car = null;
  try { car = createCar(sceneRef, 'police', x, z, Math.atan2(pp.x - x, pp.z - z), 0x1a2a44); } catch { car = null; }
  if (!car) return;
  if (!G.vehicles.includes(car)) G.vehicles.push(car);
  G.police.push({ group: car.group, model: 'police', pos: car.pos, heading: car.heading, speed: 0, onFoot: false, bustTimer: 0, car });
}

function spawnFootCop() {
  if (!sceneRef) return;
  const pp = G.player.pos;
  const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 10;
  const group = makeFootCop(pp.x + Math.sin(a) * r, pp.z + Math.cos(a) * r);
  sceneRef.add(group);
  G.police.push({
    group, model: 'police', pos: { x: group.position.x, z: group.position.z },
    heading: 0, speed: 0, onFoot: true, bustTimer: 0, car: null,
  });
}

function removeUnit(u) {
  const i = G.police.indexOf(u);
  if (i >= 0) G.police.splice(i, 1);
  if (u.car) {
    const vi = G.vehicles.indexOf(u.car);
    if (vi >= 0) G.vehicles.splice(vi, 1);
  }
  if (sceneRef && u.group) sceneRef.remove(u.group);
}

export function updatePolice(dt) {
  if (G.mode !== 'play') return;
  const pp = G.player.pos;
  const maxCars = Math.min(1 + G.wanted, 5);
  const cars = G.police.filter((u) => !u.onFoot);
  const cops = G.police.filter((u) => u.onFoot);

  // Spawn: police cars up to the wanted cap; foot cops at 3+ stars (max 3).
  spawnTimer -= dt;
  if (G.wanted > 0 && spawnTimer <= 0) {
    spawnTimer = 2.5;
    if (cars.length < maxCars) spawnPoliceCar();
    else if (G.wanted >= 3 && cops.length < 3) spawnFootCop();
  }
  if (G.wanted === 0 && G.police.length) {
    // Heat gone: units drive off / walk away, despawn when far.
    for (let i = G.police.length - 1; i >= 0; i--) {
      const u = G.police[i];
      const dx = u.pos.x - pp.x, dz = u.pos.z - pp.z;
      if (dx * dx + dz * dz > 120 * 120) removeUnit(u);
    }
  }

  let nearest = 1e9;
  const onFoot = G.player.onFoot;
  const playerStopped = !onFoot && Math.abs((G.player.vehicle && G.player.vehicle.speed) || 0) < 0.5;

  for (let i = G.police.length - 1; i >= 0; i--) {
    const u = G.police[i];
    const dx = pp.x - u.pos.x, dz = pp.z - u.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    if (d < nearest) nearest = d;
    const targetHeading = Math.atan2(dx, dz);

    if (u.onFoot) {
      // Foot cop chases on foot (run speed 5.5); busted if close for 2s.
      u.heading = angLerp(u.heading, targetHeading, dt * 6);
      const sp = G.wanted >= 3 ? 5.5 : 4.5;
      u.speed = sp;
      u.pos.x += Math.sin(u.heading) * sp * dt;
      u.pos.z += Math.cos(u.heading) * sp * dt;
      u.group.position.set(u.pos.x, 0, u.pos.z);
      u.group.rotation.y = u.heading;
      if (onFoot && d < 2.2) {
        u.bustTimer += dt;
        if (u.bustTimer >= 2) return doBusted();
      } else u.bustTimer = 0;
      if (d > 90) removeUnit(u);
    } else {
      // Police car: steer toward the player, ram speed scales with stars.
      u.heading = angLerp(u.heading, targetHeading, dt * 2.2);
      const maxSp = 20 + G.wanted * 3.5;
      u.speed = Math.min(maxSp, u.speed + 16 * dt);
      // Ram: slow down right on top of the player so it nudges, not tunnels.
      if (d < 4) u.speed = Math.max(4, u.speed - 20 * dt);
      u.pos.x += Math.sin(u.heading) * u.speed * dt;
      u.pos.z += Math.cos(u.heading) * u.speed * dt;
      if (u.car) { u.car.heading = u.heading; u.car.speed = u.speed; }
      u.group.position.set(u.pos.x, 0, u.pos.z);
      u.group.rotation.y = u.heading;
      // Busted in a car: fully stopped with a police car adjacent for 3s.
      if (!onFoot && playerStopped && d < 4) {
        u.bustTimer += dt;
        if (u.bustTimer >= 3) return doBusted();
      } else u.bustTimer = 0;
      if (d > 160) removeUnit(u);
    }
  }

  // Wanted decay: no unit within 60m for 10s, then -1 star every 8s.
  if (G.wanted > 0) {
    if (nearest > 60) {
      noNearTimer += dt;
      if (noNearTimer >= 10) {
        decayTimer += dt;
        if (decayTimer >= 8) { decayTimer = 0; G.wanted = Math.max(0, G.wanted - 1); }
      }
    } else { noNearTimer = 0; decayTimer = 0; }
  } else { noNearTimer = 0; decayTimer = 0; }
}

function doBusted() {
  // Clear the scene's police, fine the player, respawn at the station corner.
  for (let i = G.police.length - 1; i >= 0; i--) removeUnit(G.police[i]);
  G.stats.busted++;
  G.cash = Math.max(0, G.cash - 100);
  G.wanted = 0;
  if (G.player.vehicle) { G.player.vehicle.isPlayer = false; G.player.vehicle = null; }
  G.player.onFoot = true;
  G.player.speed = 0;
  G.player.pos.x = -210; G.player.pos.z = -210; // police station corner
  G.player.heading = Math.PI / 4;
  G.health = 50;
  G.mode = 'busted';
  sfx('busted');
}
