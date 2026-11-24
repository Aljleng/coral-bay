// Jay Carter on foot: move, enter/exit cars, steal, punch. Health regen, wasted.
import { G } from './state.js';
import { CFG } from './config.js';
import { clamp, angLerp, dist2 } from './utils.js';
import { CITY_HALF } from './city.js';
import { addWanted } from './police.js';
import { nearestPed, scarePeds, knockDownPed } from './peds.js';
import { nearestCar } from './vehicles.js';
import { showScreen, toast } from './hud.js';

let mesh = null;
let sceneRef = null;
let colliders = [];
let bobPhase = 0;
const fleeing = []; // ejected drivers running away {group, t, dx, dz}
const fleeColors = [0xc23b2e, 0x3a7bd5, 0x4c8a3f, 0xf2c200, 0x8a6f7d];

export function setPlayerColliders(c) { colliders = c; }

export function createPlayer(scene, x, z) {
  sceneRef = scene;
  mesh = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x2e86ab });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.3), shirt);
  body.position.y = 1.05; mesh.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skin);
  head.position.y = 1.62; mesh.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.38), pants);
  cap.position.y = 1.82; mesh.add(cap);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.24), pants);
    leg.position.set(sx * 0.15, 0.35, 0); mesh.add(leg);
  }
  const sh = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.02; mesh.add(sh);
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  G.player.pos = mesh.position;
  G.player.heading = 0;
  return mesh;
}

export function respawnPlayer(x, z) {
  if (!mesh) return;
  mesh.position.set(x, 0, z);
  mesh.visible = true;
  G.player.pos = mesh.position;
  G.player.heading = 0;
  G.player.onFoot = true;
  G.player.speed = 0;
  G.player.vehicle = null;
}

export function enterCar(car) {
  if (!car || car.isPlayer) return;
  G.player.onFoot = false;
  G.player.vehicle = car;
  car.isPlayer = true;
  if (mesh) mesh.visible = false;
  G.player.pos = car.pos;
  G.player.heading = car.heading;
}

export function exitCar() {
  const car = G.player.vehicle;
  if (!car) return;
  car.isPlayer = false;
  const rx = Math.cos(car.heading), rz = -Math.sin(car.heading); // car right side
  const x = car.pos.x + rx * 2.2, z = car.pos.z + rz * 2.2;
  if (mesh) {
    mesh.position.set(clamp(x, -CITY_HALF, CITY_HALF), 0, clamp(z, -CITY_HALF, CITY_HALF));
    mesh.visible = true;
    G.player.pos = mesh.position;
  }
  G.player.onFoot = true;
  G.player.speed = 0;
  G.player.vehicle = null;
  G.player.heading = car.heading;
}

function spawnFleeingDriver(x, z) {
  if (!sceneRef) return;
  const g = new THREE.Group();
  const col = fleeColors[Math.floor(Math.random() * fleeColors.length)];
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.3),
    new THREE.MeshLambertMaterial({ color: col }));
  body.position.y = 1.05; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34),
    new THREE.MeshLambertMaterial({ color: 0xd9a066 }));
  head.position.y = 1.62; g.add(head);
  g.position.set(x, 0, z);
  sceneRef.add(g);
  const a = Math.random() * Math.PI * 2;
  fleeing.push({ group: g, t: 0, dx: Math.sin(a), dz: Math.cos(a) });
}

function nearestPolicePed(pos, r) {
  let best = null, bd = r * r;
  for (const p of G.police) {
    const pp = p.pos || (p.group && p.group.position);
    if (!pp) continue;
    const d = dist2(pos.x, pos.z, pp.x, pp.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function hitsBuilding(x, z, r) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
  }
  return false;
}

export function updatePlayer(dt, input) {
  // Ejected drivers keep running, then vanish.
  for (let i = fleeing.length - 1; i >= 0; i--) {
    const f = fleeing[i];
    f.t += dt;
    f.group.position.x += f.dx * 7 * dt;
    f.group.position.z += f.dz * 7 * dt;
    if (f.t > 4) { sceneRef.remove(f.group); fleeing.splice(i, 1); }
  }
  if (G.mode !== 'play') return;
  if (G.health > 0 && G.health < 100) G.health = Math.min(100, G.health + 1.5 * dt);
  if (G.health <= 0) { G.mode = 'wasted'; showScreen('wasted'); return; }

  if (!G.player.onFoot) {
    const car = G.player.vehicle;
    G.player.speed = car ? car.speed : 0;
    if (input.enter) exitCar();
    return;
  }

  // On foot: WASD relative to camera yaw, Shift to run.
  const f = (input.fwd ? 1 : 0) - (input.back ? 1 : 0);
  const s = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const fx = Math.sin(G.camOrbit), fz = Math.cos(G.camOrbit);
  const rx = -Math.cos(G.camOrbit), rz = Math.sin(G.camOrbit);
  let mx = fx * f + rx * s, mz = fz * f + rz * s;
  const len = Math.hypot(mx, mz);
  const speed = input.run ? CFG.RUN_SPEED : CFG.WALK_SPEED;
  if (len > 0.01) {
    mx /= len; mz /= len;
    const nx = G.player.pos.x + mx * speed * dt;
    const nz = G.player.pos.z + mz * speed * dt;
    if (!hitsBuilding(nx, G.player.pos.z, 0.5)) G.player.pos.x = nx;
    if (!hitsBuilding(G.player.pos.x, nz, 0.5)) G.player.pos.z = nz;
    G.player.pos.x = clamp(G.player.pos.x, -CITY_HALF, CITY_HALF);
    G.player.pos.z = clamp(G.player.pos.z, -CITY_HALF, CITY_HALF);
    G.player.heading = angLerp(G.player.heading, Math.atan2(mx, mz), 1 - Math.exp(-12 * dt));
    G.player.speed = speed;
    bobPhase += dt * speed * 1.6;
    if (mesh) mesh.position.y = Math.abs(Math.sin(bobPhase)) * 0.06;
  } else {
    G.player.speed = 0;
    if (mesh) mesh.position.y = 0;
  }
  if (mesh) mesh.rotation.y = G.player.heading;

  if (input.enter) {
    const car = nearestCar(G.player.pos, 3.2, false);
    if (car && !car.driver) enterCar(car);
    else if (car) toast('That car has a driver — press F to steal it');
  }
  if (input.steal || input.punch) {
    const car = nearestCar(G.player.pos, 3.5, false);
    if (car && car.driver) {
      car.driver = false; // eject the driver
      spawnFleeingDriver(car.pos.x, car.pos.z);
      addWanted(1);
      G.stats.carsStolen++;
      enterCar(car);
      toast('Car stolen! The police are on to you.');
    } else if (nearestPolicePed(G.player.pos, 2.4)) {
      addWanted(1);
      toast('You hit an officer!');
    } else {
      const ped = nearestPed(G.player.pos, 2.4);
      if (ped) {
        knockDownPed(ped);
        scarePeds(G.player.pos, 10);
        addWanted(1);
        toast('You punched a pedestrian!');
      }
    }
  }
}
