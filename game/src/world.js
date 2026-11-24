// World — Vice Harbor: aturan main, state, dan satu langkah simulasi.
//
// Kota fiktif "Port Meridian", protagonis Mara Quinn (driver-for-hire).
// Game ini tidak melakukan network request apa pun.
//
// Konvensi heading: radian, 0 = +Z, bertambah berlawanan jarum jam dilihat
// dari atas; vektor maju = (sin(heading), cos(heading)) di (x, z).
//
// createWorld(rng, city, missions?) -> { state, step, reset, debug, city }.
//   rng: fungsi acak () -> [0, 1). city: hasil createCity(rng) dari city.js;
//     bila tidak diberikan, world membuat kotanya sendiri dari rng.
//   missions: modul misi opsional (builder lain); bila ada dan punya
//     update(state, dt), dipanggil tiap langkah dan bitmask yang
//     dikembalikannya digabung ke hasil step().
// step(dt, input) maju satu langkah tetap (biasanya 1/60) dan mengembalikan
// bitmask kejadian EVENT_* di bawah. input: hasil createInput() (atau stub
// dengan properti moveX/moveZ/steer/throttle + takeActions()).

import { createCity } from './city.js';
import { createVehicles, stepVehicles, enterCar, exitCar } from './vehicles.js';
import { createPeds, stepPeds, knockDown } from './peds.js';
import {
  createPolice, stepPolice, addWanted, decayWanted, spawnPoliceNear,
} from './police.js';

export const EVENT_CRIME = 1;
export const EVENT_MISSION = 2;
export const EVENT_BUSTED = 4;
export const EVENT_WASTED = 8;
export const EVENT_PICKUP = 16;

const START_CLOCK_MIN = 18 * 60 + 30; // 18:30, senja Port Meridian
const START_CASH = 250;
const START_HEALTH = 100;
const WALK_SPEED = 6;
const ENTER_DIST = 3.5;
const PUNCH_DIST = 2.0;
const PUNCH_ARC = 0.9; // radian dari arah hadap (~52 derajat tiap sisi)
const SHOOT_DIST = 25;
const SHOOT_ARC = 0.35; // radian dari arah hadap (~20 derajat tiap sisi)
const RUN_OVER_SPEED = 3; // mobil player harus melaju segini untuk melindas
const RUN_OVER_DIST = 2.2;
const HURT_COOLDOWN = 1; // detik kebal setelah tertabrak saat jalan kaki
const MESSAGE_SECONDS = 4;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createWorld(rng, city, missions) {
  const random = typeof rng === 'function' ? rng : Math.random;
  const town = city || createCity(random);

  const state = {
    time: 0,
    clockMin: START_CLOCK_MIN,
    cash: START_CASH,
    health: START_HEALTH,
    wanted: 0,
    player: { x: 0, z: 0, heading: 0, speed: 0, onFoot: true, car: null, hurtTimer: 0 },
    cars: [],
    peds: [],
    mission: null,
    message: '',
    gameOver: null,
    // Internal (dipakai subsistem, bukan HUD): waktu kejahatan terakhir,
    // timer penurunan wanted, dan referensi kota/rng.
    lastCrimeAt: -1000,
    wantedDropTimer: 0,
    messageTimer: 0,
    city: town,
    rng: random,
    police: null,
  };

  function spawnPoint() {
    // Spawn resmi kota bila ada (city.playerSpawn), lalu titik jalan terdekat.
    if (town && town.playerSpawn && Number.isFinite(town.playerSpawn.x) && Number.isFinite(town.playerSpawn.z)) {
      return { x: town.playerSpawn.x, z: town.playerSpawn.z, heading: town.playerSpawn.heading || 0 };
    }
    if (town && typeof town.nearestRoadPoint === 'function') {
      const p = town.nearestRoadPoint(0, 0);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return { x: p.x, z: p.z, heading: 0 };
    }
    if (town && typeof town.randomRoadPoint === 'function') {
      const p = town.randomRoadPoint(random);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return { x: p.x, z: p.z, heading: 0 };
    }
    return { x: 0, z: 0, heading: 0 };
  }

  function reset() {
    const spawn = spawnPoint();
    state.time = 0;
    state.clockMin = START_CLOCK_MIN;
    state.cash = START_CASH;
    state.health = START_HEALTH;
    state.wanted = 0;
    state.player.x = spawn.x;
    state.player.z = spawn.z;
    state.player.heading = spawn.heading || 0;
    state.player.speed = 0;
    state.player.onFoot = true;
    state.player.car = null;
    state.player.hurtTimer = 0;
    state.cars = createVehicles(town, random).cars;
    state.peds = createPeds(town, random);
    state.police = createPolice(town, random);
    state.mission = null;
    state.message = '';
    state.messageTimer = 0;
    state.gameOver = null;
    state.lastCrimeAt = -1000;
    state.wantedDropTimer = 0;
  }

  function setMessage(text) {
    state.message = text;
    state.messageTimer = MESSAGE_SECONDS;
  }

  function blockedAt(x, z) {
    // city.isBlocked(x, z, r) butuh radius eksplisit (tanpa r hasilnya NaN
    // -> selalu false); isBlocked kota tidak memeriksa batas, jadi cek
    // bounds di sini juga.
    if (town && town.bounds) {
      const b = town.bounds;
      if (Number.isFinite(b.minX) && (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ)) return true;
    }
    if (town && typeof town.isBlocked === 'function') return town.isBlocked(x, z, 0.5);
    return false;
  }

  function nearestCar(maxDist) {
    let best = null;
    let bestDist = maxDist;
    for (const car of state.cars) {
      const d = Math.hypot(car.x - state.player.x, car.z - state.player.z);
      if (d < bestDist) {
        bestDist = d;
        best = car;
      }
    }
    return best;
  }

  function policeNear(dist) {
    for (const car of state.cars) {
      if (car.driver !== 'police') continue;
      if (Math.hypot(car.x - state.player.x, car.z - state.player.z) < dist) return true;
    }
    return false;
  }

  function tryEnterExitCar() {
    if (state.player.onFoot) {
      const car = nearestCar(ENTER_DIST);
      if (!car) {
        setMessage('Tidak ada mobil di dekatmu.');
        return;
      }
      if (car.driver === 'player') return;
      const stealing = car.driver === 'traffic' || car.kind === 'police' || !car.owned;
      enterCar(state, car);
      if (stealing && (policeNear(30) || car.kind === 'police')) {
        addWanted(state, 1);
        setMessage('Mobil dicuri di depan polisi! Wanted +1.');
      } else if (stealing) {
        setMessage('Mobil dicuri. Jangan sampai ketahuan polisi.');
      } else {
        setMessage('Masuk mobil sendiri.');
      }
    } else {
      exitCar(state);
    }
  }

  function stepOnFoot(dt, input) {
    const player = state.player;
    if (player.hurtTimer > 0) player.hurtTimer -= dt;
    const moveX = input && Number.isFinite(input.moveX) ? input.moveX : 0;
    const moveZ = input && Number.isFinite(input.moveZ) ? input.moveZ : 0;
    if (moveX === 0 && moveZ === 0) {
      player.speed = 0;
      return;
    }
    // Gerak relatif heading player: maju = (sin h, cos h),
    // kanan = (-cos h, sin h).
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    const rx = -Math.cos(player.heading);
    const rz = Math.sin(player.heading);
    let mx = fx * moveZ + rx * moveX;
    let mz = fz * moveZ + rz * moveX;
    const len = Math.hypot(mx, mz) || 1;
    mx /= len;
    mz /= len;
    player.heading = Math.atan2(mx, mz);
    player.speed = WALK_SPEED;
    const nx = player.x + mx * WALK_SPEED * dt;
    const nz = player.z + mz * WALK_SPEED * dt;
    if (!blockedAt(nx, nz)) {
      player.x = nx;
      player.z = nz;
    } else if (!blockedAt(nx, player.z)) {
      player.x = nx;
    } else if (!blockedAt(player.x, nz)) {
      player.z = nz;
    }
    // Tetap di dalam batas kota bila city menyediakannya.
    if (town && town.bounds) {
      player.x = clamp(player.x, town.bounds.minX, town.bounds.maxX);
      player.z = clamp(player.z, town.bounds.minZ, town.bounds.maxZ);
    }
  }

  function punch() {
    const player = state.player;
    if (!player.onFoot) return 0;
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    let hit = false;
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      const dx = ped.x - player.x;
      const dz = ped.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > PUNCH_DIST) continue;
      if (Math.abs(angleDiff(Math.atan2(dx, dz), player.heading)) > PUNCH_ARC) continue;
      knockDown(ped);
      hit = true;
    }
    // Pukul mobil polisi di depan: mobil terdorong, tidak menambah wanted.
    for (const car of state.cars) {
      if (car.driver !== 'police') continue;
      const dx = car.x - player.x;
      const dz = car.z - player.z;
      if (Math.hypot(dx, dz) > PUNCH_DIST + 1) continue;
      car.x += fx * 1.5;
      car.z += fz * 1.5;
      car.speed = 0;
      hit = true;
    }
    if (hit) {
      // Kejahatan terlihat: pejalan kaki sekitar panik, tapi level wanted
      // hanya naik lewat tabrak/curi/tembak (lihat police.js).
      state.lastCrimeAt = state.time;
      setMessage('Pukulan mendarat.');
    }
    return 0;
  }

  function shoot() {
    const player = state.player;
    // Target terdekat dalam kerucut depan: pejalan kaki dulu, lalu mobil polisi.
    let bestPed = null;
    let bestPedDist = SHOOT_DIST;
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      const dx = ped.x - player.x;
      const dz = ped.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > bestPedDist) continue;
      if (Math.abs(angleDiff(Math.atan2(dx, dz), player.heading)) > SHOOT_ARC) continue;
      bestPed = ped;
      bestPedDist = dist;
    }
    if (bestPed) {
      knockDown(bestPed);
      addWanted(state, 1);
      setMessage('Tembakan kena pejalan kaki! Wanted +1.');
      return EVENT_CRIME;
    }
    let bestCar = null;
    let bestCarDist = SHOOT_DIST;
    for (const car of state.cars) {
      if (car.driver !== 'police') continue;
      const dx = car.x - player.x;
      const dz = car.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > bestCarDist) continue;
      if (Math.abs(angleDiff(Math.atan2(dx, dz), player.heading)) > SHOOT_ARC) continue;
      bestCar = car;
      bestCarDist = dist;
    }
    if (bestCar) {
      bestCar.stunTimer = 2;
      bestCar.speed = 0;
      addWanted(state, 1);
      setMessage('Mobil polisi kena tembak! Wanted +1.');
      return EVENT_CRIME;
    }
    setMessage('Tembakan meleset.');
    return 0;
  }

  /** Mobil player melindas pejalan kaki -> jatuh + wanted +1 (sekali per korban). */
  function checkRunOver() {
    const car = state.player.car;
    if (state.player.onFoot || !car) return 0;
    if (Math.abs(car.speed) < RUN_OVER_SPEED) return 0;
    let events = 0;
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      if (Math.hypot(ped.x - car.x, ped.z - car.z) < RUN_OVER_DIST) {
        knockDown(ped);
        addWanted(state, 1);
        setMessage('Kamu melindas pejalan kaki! Wanted +1.');
        events |= EVENT_CRIME;
      }
    }
    return events;
  }

  /** Mobil lain menabrak Mara saat jalan kaki -> health berkurang. */
  function checkPlayerHitByTraffic() {
    const player = state.player;
    if (!player.onFoot || player.hurtTimer > 0) return;
    for (const car of state.cars) {
      if (car.driver === 'player' || car.driver === null) continue;
      if (Math.abs(car.speed) < 5) continue;
      if (Math.hypot(car.x - player.x, car.z - player.z) < 2.2) {
        state.health -= 20;
        player.hurtTimer = HURT_COOLDOWN;
        setMessage('Kamu tertabrak mobil! -20 HP.');
        break;
      }
    }
  }

  function step(dt, input) {
    if (state.gameOver) return 0;
    let events = 0;
    state.time += dt;
    // 1 detik nyata = 1 menit jam game.
    state.clockMin = (state.clockMin + dt) % (24 * 60);
    if (state.messageTimer > 0) {
      state.messageTimer -= dt;
      if (state.messageTimer <= 0) state.message = '';
    }

    const actions = input && typeof input.takeActions === 'function' ? input.takeActions() : 0;
    if (actions & 4) tryEnterExitCar(); // ACTION_INTERACT (E)
    if (actions & 8) punch(); // ACTION_PUNCH (F)
    if (actions & 16) events |= shoot(); // ACTION_SHOOT (klik)

    if (state.player.onFoot) stepOnFoot(dt, input);
    stepVehicles(state, dt, input);
    // No car leaves the map: clamp every car inside the city bounds (the
    // on-foot player is already clamped by stepOnFoot/blockedAt).
    if (town && town.bounds) {
      const b = town.bounds;
      for (const car of state.cars) {
        car.x = clamp(car.x, b.minX, b.maxX);
        car.z = clamp(car.z, b.minZ, b.maxZ);
      }
    }
    // Sinkronkan player dengan mobil yang dikendarai.
    if (!state.player.onFoot && state.player.car) {
      const car = state.player.car;
      state.player.x = car.x;
      state.player.z = car.z;
      state.player.heading = car.heading;
      state.player.speed = car.speed;
    }
    events |= checkRunOver();
    checkPlayerHitByTraffic();
    stepPeds(state, dt, town, random);
    decayWanted(state, dt);
    events |= stepPolice(state, dt, town, random);

    if (missions && typeof missions.update === 'function') {
      const missionEvents = missions.update(state, dt);
      if (Number.isFinite(missionEvents)) events |= missionEvents;
    }

    if (state.health <= 0) {
      state.health = 0;
      state.gameOver = 'wasted';
      setMessage('WASTED — Mara tumbang.');
      events |= EVENT_WASTED;
    } else if (state.gameOver === 'busted') {
      setMessage('BUSTED — polisi menangkap Mara.');
      events |= EVENT_BUSTED;
    }
    return events;
  }

  const debug = {
    /** Taruh Mara di dalam mobil terdekat (buat screenshot staged). */
    putPlayerInCar() {
      if (!state.player.onFoot) return true;
      const car = nearestCar(60) || state.cars[0];
      if (!car) return false;
      return enterCar(state, car);
    },
    /** Set level wanted langsung (0..5). */
    setWanted(n) {
      state.wanted = clamp(n, 0, 5);
      state.lastCrimeAt = state.time;
      state.wantedDropTimer = 0;
      return state.wanted;
    },
    /** Paksa spawn n polisi dekat player (buat screenshot staged). */
    spawnPoliceNear(n) {
      return spawnPoliceNear(state, town, random, n);
    },
    /** Teleport Mara (dan mobilnya bila sedang menyetir) ke x, z. */
    teleportPlayer(x, z) {
      state.player.x = x;
      state.player.z = z;
      if (!state.player.onFoot && state.player.car) {
        state.player.car.x = x;
        state.player.car.z = z;
      }
    },
  };

  reset();
  return { state, step, reset, debug, city: town };
}
