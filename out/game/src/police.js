// Polisi & wanted — Vice Harbor.
//
// Wanted naik saat: menabrak pejalan kaki (+1), mencuri mobil di dekat
// polisi (+1), menembak (+1). Wanted turun setelah 20 detik tanpa kejahatan,
// lalu 1 level tiap 15 detik.
// Polisi = mobil kind 'police' (driver 'police'): jumlah aktif = wanted
// (maks 5), spawn di jalan dekat player, mengejar mobil player (setir ke
// arah player, menabrak/ram). Kalau player jalan kaki dan polisi menyentuh
// 3 detik -> busted.
//
// Konvensi heading: radian, 0 = +Z, bertambah berlawanan jarum jam dilihat
// dari atas; vektor maju = (sin(heading), cos(heading)) di (x, z).

export const MAX_WANTED = 5;
const WANTED_QUIET_SECONDS = 20; // tanpa kejahatan sebelum wanted mulai turun
const WANTED_DECAY_SECONDS = 15; // tiap interval ini wanted turun 1
const POLICE_SPEED = 24; // sedikit lebih lambat dari top speed player (26)
const POLICE_ACCEL = 13;
const RAM_DIST = 3.4; // jarak sentuh polisi-player
const RAM_PUSH = 12; // unit/detik dorongan ram ke mobil player
const BUSTED_SECONDS = 3; // lama sentuhan jalan kaki sebelum busted
const SPAWN_MIN_DIST = 25;
const SPAWN_MAX_DIST = 55;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function roadPointNear(city, rng, player, minDist, maxDist) {
  for (let tries = 0; tries < 12; tries += 1) {
    let p = null;
    if (city && typeof city.randomRoadPoint === 'function') {
      p = city.randomRoadPoint(rng);
    }
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) {
      p = { x: (rng() - 0.5) * 80, z: (rng() - 0.5) * 80 };
    }
    const d = player ? Math.hypot(p.x - player.x, p.z - player.z) : 0;
    if (d >= minDist && d <= maxDist) return { x: p.x, z: p.z };
  }
  // Gagal dapat jarak ideal: pakai titik jalan apa pun, geser menjauh player.
  if (city && typeof city.randomRoadPoint === 'function') {
    const p = city.randomRoadPoint(rng);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return { x: p.x, z: p.z };
  }
  return { x: (player ? player.x : 0) + SPAWN_MIN_DIST, z: player ? player.z : 0 };
}

/** Status pengendali polisi (tidak ada mobil saat wanted 0). */
export function createPolice(city, rng) {
  return { city: city || null, rng: rng || Math.random, nextId: 1000 };
}

/** Tambah wanted (maks 5) + catat waktu kejahatan terakhir. */
export function addWanted(state, n) {
  state.wanted = clamp((state.wanted || 0) + n, 0, MAX_WANTED);
  state.lastCrimeAt = state.time;
  state.wantedDropTimer = 0;
  return state.wanted;
}

/** Turunkan wanted bila sudah lama tanpa kejahatan: 1 per 15 detik. */
export function decayWanted(state, dt) {
  if ((state.wanted || 0) <= 0) return;
  if (state.time - (state.lastCrimeAt ?? -1000) < WANTED_QUIET_SECONDS) {
    state.wantedDropTimer = 0;
    return;
  }
  state.wantedDropTimer = (state.wantedDropTimer || 0) + dt;
  while (state.wantedDropTimer >= WANTED_DECAY_SECONDS && state.wanted > 0) {
    state.wanted -= 1;
    state.wantedDropTimer -= WANTED_DECAY_SECONDS;
  }
}

/** Spawn satu mobil polisi di jalan dekat player, masuk ke state.cars. */
export function spawnPoliceCar(state, city, rng) {
  const police = state.police || {};
  const id = police.nextId !== undefined ? police.nextId : 1000;
  if (state.police) state.police.nextId = id + 1;
  const p = roadPointNear(city, rng, state.player, SPAWN_MIN_DIST, SPAWN_MAX_DIST);
  const car = {
    id, kind: 'police',
    x: p.x, z: p.z,
    heading: state.player ? Math.atan2(state.player.x - p.x, state.player.z - p.z) : 0,
    speed: 6, color: '#2c3e50',
    driver: 'police', parked: false, owned: false,
    pauseTimer: 0, turnTimer: 0, targetSpeed: POLICE_SPEED,
    stunTimer: 0, touchTimer: 0,
  };
  state.cars.push(car);
  return car;
}

/** Paksa spawn n polisi dekat player (dipakai world.debug.spawnPoliceNear). */
export function spawnPoliceNear(state, city, rng, n) {
  const spawned = [];
  for (let i = 0; i < n; i += 1) spawned.push(spawnPoliceCar(state, city, rng));
  return spawned;
}

/** Mobil polisi aktif yang sekarang ada di state.cars. */
export function policeCars(state) {
  return (state.cars || []).filter((car) => car.driver === 'police');
}

/**
 * Satu langkah polisi. Mengembalikan EVENT_BUSTED (4) saat player jalan kaki
 * ditangkap, 0 bila tidak. Polisi mengejar: setir ke arah player, gas pol,
 * dan menabrak (ram) mobil player saat bersentuhan.
 */
export function stepPolice(state, dt, city, rng) {
  const random = rng || (state.police && state.police.rng) || state.rng || Math.random;
  const town = city || (state.police && state.police.city) || state.city || null;
  const wanted = state.wanted || 0;
  const player = state.player;

  // Samakan jumlah polisi aktif dengan wanted (maks 5).
  let active = policeCars(state);
  while (active.length < Math.min(wanted, MAX_WANTED)) {
    spawnPoliceCar(state, town, random);
    active = policeCars(state);
  }
  while (active.length > Math.min(wanted, MAX_WANTED)) {
    // Wanted turun: polisi terjauh pergi duluan.
    let farthest = active[0];
    let farDist = -1;
    for (const car of active) {
      const d = player ? Math.hypot(car.x - player.x, car.z - player.z) : 0;
      if (d > farDist) {
        farDist = d;
        farthest = car;
      }
    }
    const idx = state.cars.indexOf(farthest);
    if (idx >= 0) state.cars.splice(idx, 1);
    active = policeCars(state);
  }

  if (!player || state.gameOver) return 0;

  let events = 0;
  for (const car of policeCars(state)) {
    if (car.stunTimer > 0) {
      car.touchTimer = 0;
      continue;
    }
    const dx = player.x - car.x;
    const dz = player.z - car.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    // Setir ke arah player (belok paling cepat 2.4 rad/detik).
    const wantHeading = Math.atan2(dx, dz);
    const turn = clamp(angleDiff(wantHeading, car.heading), -2.4 * dt, 2.4 * dt);
    car.heading += turn;
    // Gas: kejar, tapi jangan jauh lebih cepat dari mobil player.
    const playerSpeed = player.onFoot ? 0 : Math.abs(player.speed || 0);
    const target = Math.min(POLICE_SPEED, playerSpeed + 4);
    if (car.speed < target) car.speed = Math.min(target, car.speed + POLICE_ACCEL * dt);
    else if (car.speed > target) car.speed = Math.max(target, car.speed - 4 * dt);

    if (dist < RAM_DIST) {
      if (player.onFoot) {
        // Sentuhan jalan kaki: tahan 3 detik -> busted.
        car.touchTimer += dt;
        if (car.touchTimer >= BUSTED_SECONDS) {
          state.gameOver = 'busted';
          return 4; // EVENT_BUSTED
        }
      } else if (player.car) {
        // Ram mobil player: dorong + perlambat mobil player.
        const pushX = dx / dist;
        const pushZ = dz / dist;
        player.car.x += pushX * RAM_PUSH * dt;
        player.car.z += pushZ * RAM_PUSH * dt;
        player.car.speed *= Math.max(0, 1 - 1.5 * dt);
        car.speed *= Math.max(0, 1 - 1.0 * dt);
        car.touchTimer = 0;
      }
    } else {
      car.touchTimer = 0;
    }
  }
  return events;
}
