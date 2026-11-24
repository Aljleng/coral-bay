// peds.js — pedestrians: walk sidewalks, idle, flee, get knocked down.
import { G } from './state.js';
import { CFG } from './config.js';
import { mulberry32, rand, randi, pick, clamp } from './utils.js';

let sceneRef = null;
const SHIRTS = [0xd94f3d, 0x3d7bd9, 0x3dd95e, 0xd9c23d, 0x9b3dd9, 0xe07ba8, 0x3dd9c6, 0xd97b3d, 0xeeeeee, 0x222831];
const PANTS = [0x2b3a55, 0x333333, 0x5a4632, 0x1f4d2e, 0x6b6b6b];
const SKINS = [0xe8b88a, 0xc98d64, 0x8a5a3b, 0xf0c8a0, 0x6e4423];

// Roads run on a 56-unit pitch (BLOCK 42 + ROAD 14), GRID 9 => centres -224..224.
function roadCentres() {
  const pitch = CFG.BLOCK + CFG.ROAD, half = ((CFG.GRID - 1) / 2) * pitch, out = [];
  for (let i = 0; i < CFG.GRID; i++) out.push(-half + i * pitch);
  return out;
}

function makePedMesh(shirt, pants, skin) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.7, 0.2), mat(pants));
  legs.position.y = 0.35; g.add(legs);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.28), mat(shirt));
  body.position.y = 1.02; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat(skin));
  head.position.y = 1.62; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 6, 0, Math.PI * 2, 0, 1.2), mat(0x1a1a1a));
  hair.position.y = 1.66; g.add(hair);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function sidewalkPos(rng) {
  const roads = roadCentres(), half = ((CFG.GRID - 1) / 2) * (CFG.BLOCK + CFG.ROAD);
  const alongRoad = rng() < 0.5; // walk along an x-road (vary z) or a z-road (vary x)
  const c = pick(roads, rng);
  const off = (CFG.ROAD / 2 + 2.5) * (rng() < 0.5 ? 1 : -1);
  const along = (rng() * 2 - 1) * (half - 10);
  if (alongRoad) return { x: along, z: c + off, heading: rng() < 0.5 ? 0 : Math.PI };
  return { x: c + off, z: along, heading: rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2 };
}

export function spawnPeds(scene, n, seed) {
  sceneRef = scene || sceneRef;
  if (!sceneRef) return;
  const rng = mulberry32(seed == null ? (G.seed || 1337) : seed);
  for (let i = 0; i < n; i++) {
    const p = sidewalkPos(rng);
    const shirt = pick(SHIRTS, rng), pants = pick(PANTS, rng), skin = pick(SKINS, rng);
    const group = makePedMesh(shirt, pants, skin);
    group.position.set(p.x, 0, p.z);
    group.rotation.y = p.heading;
    sceneRef.add(group);
    G.peds.push({
      group, pos: { x: p.x, z: p.z }, heading: p.heading,
      speed: 0.8 + rng() * 1.2, state: 'walk', color: shirt,
      idleT: 0, fleeT: 0, downT: 0, walkT: 2 + rng() * 6,
    });
  }
}

export function nearestPed(pos, r) {
  let best = null, bd = r * r;
  for (const p of G.peds) {
    if (p.state === 'down') continue;
    const dx = p.pos.x - pos.x, dz = p.pos.z - pos.z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function scarePeds(pos, r) {
  for (const p of G.peds) {
    if (p.state === 'down') continue;
    const dx = p.pos.x - pos.x, dz = p.pos.z - pos.z;
    if (dx * dx + dz * dz < r * r) { p.state = 'flee'; p.fleeT = 3 + Math.random() * 3; }
  }
}

// A punch (or car hit) knocks a ped down; they lie still, then despawn.
export function knockDownPed(ped) {
  if (!ped || ped.state === 'down') return;
  ped.state = 'down'; ped.downT = 6;
  ped.group.rotation.x = -Math.PI / 2;
  ped.group.position.y = 0.25;
}

function removePed(ped) {
  const i = G.peds.indexOf(ped);
  if (i >= 0) G.peds.splice(i, 1);
  if (sceneRef) sceneRef.remove(ped.group);
}

export function updatePeds(dt) {
  if (!G.peds.length) return;
  const pp = (G.player && G.player.pos) || { x: 0, z: 0 };
  const pSpeed = Math.abs((G.player && G.player.speed) || 0);
  const half = ((CFG.GRID - 1) / 2) * (CFG.BLOCK + CFG.ROAD) + 6;
  for (let i = G.peds.length - 1; i >= 0; i--) {
    const p = G.peds[i];
    if (p.state === 'down') {
      p.downT -= dt;
      if (p.downT <= 0) removePed(p);
      continue;
    }
    // Flee: player close and fast, or in a car, or recently scared.
    const dx = p.pos.x - pp.x, dz = p.pos.z - pp.z;
    const d2 = dx * dx + dz * dz;
    if (p.state !== 'flee' && d2 < 49 && (pSpeed > 8 || !(G.player && G.player.onFoot))) {
      p.state = 'flee'; p.fleeT = 2.5;
    }
    if (p.state === 'flee') {
      p.fleeT -= dt;
      const d = Math.sqrt(d2) || 1;
      p.heading = Math.atan2(dx / d, dz / d);
      const s = p.speed * 2.6;
      p.pos.x += Math.sin(p.heading) * s * dt;
      p.pos.z += Math.cos(p.heading) * s * dt;
      if (p.fleeT <= 0) p.state = 'walk';
    } else if (p.state === 'idle') {
      p.idleT -= dt;
      if (p.idleT <= 0) { p.state = 'walk'; p.walkT = 3 + Math.random() * 6; }
    } else {
      p.walkT -= dt;
      if (p.walkT <= 0) {
        p.state = 'idle'; p.idleT = 1 + Math.random() * 3;
      } else {
        // Drift: keep walking the same heading; bounce off city edge.
        p.pos.x += Math.sin(p.heading) * p.speed * dt;
        p.pos.z += Math.cos(p.heading) * p.speed * dt;
        if (Math.abs(p.pos.x) > half || Math.abs(p.pos.z) > half) p.heading += Math.PI;
      }
    }
    p.pos.x = clamp(p.pos.x, -half, half);
    p.pos.z = clamp(p.pos.z, -half, half);
    p.group.position.set(p.pos.x, 0, p.pos.z);
    if (p.state !== 'down') p.group.rotation.y = p.heading;
    // Walk bob.
    if (p.state === 'walk' || p.state === 'flee') {
      p.group.position.y = Math.abs(Math.sin(performance.now() * 0.008 + p.pos.x)) * 0.05;
    }
  }
  // Top up the crowd if it thinned out (despawns only; never above CFG.PEDS).
  if (G.peds.length < CFG.PEDS && sceneRef && G.mode === 'play' && Math.random() < dt * 0.2) {
    spawnPeds(sceneRef, 1, (Math.random() * 1e9) | 0);
  }
}
