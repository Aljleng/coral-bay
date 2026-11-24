// shots.js — deterministic staged scenes for screenshots (?shot=NAME&seed=N).
// Called by main.js before the first frame. Sets G state + stages cars/peds/missions.
import { G } from './state.js';
import { mulberry32, rand } from './utils.js';
import { createCar, updateTraffic } from './vehicles.js';
import { spawnPeds } from './peds.js';
import { startMission, refreshBeacon } from './missions.js';

function stageCar(scene, rng, model, x, z, heading, color) {
  let car = null;
  try { car = createCar(scene, model, x, z, heading, color); } catch { return null; }
  if (car && !G.vehicles.includes(car)) G.vehicles.push(car);
  return car;
}

function setPlayerInCar(car) {
  if (!car) return;
  car.isPlayer = true;
  G.player.vehicle = car;
  G.player.onFoot = false;
  G.player.pos.x = car.pos.x; G.player.pos.z = car.pos.z;
  G.player.heading = car.heading;
  G.player.speed = car.speed || 0;
}

function clearStaged(scene) {
  // Remove previously staged vehicles/peds so repeated runs look identical.
  if (scene) {
    for (const v of G.vehicles) if (v.group) scene.remove(v.group);
    for (const p of G.peds) if (p.group) scene.remove(p.group);
    for (const u of G.police) if (u.group) scene.remove(u.group);
  }
  G.vehicles.length = 0; G.peds.length = 0; G.police.length = 0;
  G.wanted = 0; G.mission = null;
}

export function applyShot(name, seed, scene) {
  const rng = mulberry32(seed == null ? 1337 : seed);
  if (scene) clearStaged(scene);
  G.shotStaged = false;

  if (name === 'start') {
    G.mode = 'menu';
    G.timeOfDay = 18.5; // dusk over the skyline
    G.cash = 250; G.health = 100;
    // High camera over the skyline; main.js camera uses G.shotCam when set.
    G.shotCam = { x: 150, y: 120, z: 190, lookX: 0, lookY: 12, lookZ: 0 };
    if (scene) {
      // Stage traffic ON roads: pick a road line (multiples of 56) for one
      // axis and a random point along it for the other. Random (x, z) pairs
      // land on block centres, where the buildings are.
      const lines = [-224, -168, -112, -56, 0, 56, 112, 168, 224];
      for (let i = 0; i < 8; i++) {
        const line = lines[Math.floor(rng() * lines.length)];
        const along = -224 + rng() * 448;
        if (rng() < 0.5) {
          stageCar(scene, rng, ['sedan', 'taxi', 'van', 'sport'][i % 4],
            line, along, rng() < 0.5 ? 0 : Math.PI, 0x888888);
        } else {
          stageCar(scene, rng, ['sedan', 'taxi', 'van', 'sport'][i % 4],
            along, line, rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2, 0x888888);
        }
      }
      spawnPeds(scene, 14, seed);
    }
  } else if (name === 'drive') {
    G.mode = 'play';
    G.timeOfDay = 10;
    G.cash = 250; G.health = 100;
    G.shotCam = null;
    if (scene) {
      const car = stageCar(scene, rng, 'sport', 28, 0, Math.PI / 2, 0xc0392b);
      setPlayerInCar(car);
      // All spots on roads: one coordinate on a road line (multiple of 56),
      // headings along the road. (28,28)/(28,-28)/(84,-28) were block centres.
      const spots = [[28, 56], [-28, -56], [0, 56], [56, 28], [-28, 0], [84, 0]];
      const headings = [Math.PI / 2, -Math.PI / 2, 0, 0, Math.PI / 2, -Math.PI / 2];
      const models = ['sedan', 'taxi', 'van', 'sedan', 'truck', 'taxi'];
      spots.forEach(([x, z], i) => stageCar(scene, rng, models[i], x, z, headings[i], 0x888888));
      spawnPeds(scene, 10, seed);
    }
  } else if (name === 'chase') {
    G.mode = 'play';
    G.timeOfDay = 15;
    G.cash = 640; G.health = 86;
    G.wanted = 3;
    G.shotCam = null;
    if (scene) {
      const car = stageCar(scene, rng, 'sport', 0, 0, 0, 0xc0392b);
      setPlayerInCar(car);
      if (car) car.speed = 24;
      // Two police cars close behind, one ahead cutting across — all on the
      // x=0 road so none sits inside a building.
      const p1 = stageCar(scene, rng, 'police', 0, -28, 0, 0x1a2a44);
      const p2 = stageCar(scene, rng, 'police', 0, -40, 0, 0x1a2a44);
      const p3 = stageCar(scene, rng, 'police', 0, 42, Math.PI, 0x1a2a44);
      for (const [c, sp] of [[p1, 22], [p2, 20], [p3, 12]]) {
        if (!c) continue;
        c.speed = sp;
        G.police.push({ group: c.group, model: 'police', pos: c.pos, heading: c.heading, speed: sp, onFoot: false, bustTimer: 0, car: c });
      }
      stageCar(scene, rng, 'taxi', -28, 56, Math.PI / 2, 0x888888);
      stageCar(scene, rng, 'sedan', 56, -28, 0, 0x888888);
      spawnPeds(scene, 8, seed);
      startMission(4, scene);
      if (G.mission) {
        G.mission.stepIndex = 1;
        G.mission.objective = 'Lose the cops!';
        G.mission.marker = null;
        G.mission.data.heatReached = true;
        refreshBeacon();
      }
    } else {
      startMission(4);
      if (G.mission) { G.mission.stepIndex = 1; G.mission.objective = 'Lose the cops!'; G.mission.marker = null; G.mission.data.heatReached = true; }
    }
  } else if (name === 'mission') {
    G.mode = 'play';
    G.timeOfDay = 12;
    G.cash = 1240; G.health = 78;
    G.shotCam = null;
    if (scene) {
      G.player.onFoot = true; G.player.vehicle = null;
      G.player.pos.x = -52; G.player.pos.z = -108;
      G.player.heading = Math.PI / 4;
      spawnPeds(scene, 12, seed);
      // Three attackers standing near the marker, on/near the -56 road line
      // (was (-64,-124): 8 units off the line, inside the block).
      const spots = [[-58, -116], [-56, -124], [-54, -126]];
      for (let i = 0; i < 3 && i < G.peds.length; i++) {
        const p = G.peds[G.peds.length - 1 - i];
        p.pos.x = spots[i][0]; p.pos.z = spots[i][1];
        p.state = 'flee'; p.fleeT = 999;
        p.group.position.set(p.pos.x, 0, p.pos.z);
      }
      stageCar(scene, rng, 'sedan', -56, -84, Math.PI / 2, 0x888888); // was (-28,-84): block centre
      startMission(5, scene);
      if (G.mission) { G.mission.stepIndex = 1; G.mission.objective = 'Defeat the 5 attackers'; G.mission.marker = { x: -60, z: -120 }; refreshBeacon(); }
    } else {
      startMission(5);
      if (G.mission) { G.mission.stepIndex = 1; G.mission.objective = 'Defeat the 5 attackers'; G.mission.marker = { x: -60, z: -120 }; }
    }
  } else {
    return; // unknown shot name: leave the game untouched
  }

  G.shotStaged = true;
  if (typeof window !== 'undefined') window.__gameReady = true;
}
