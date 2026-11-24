// Pejalan kaki — Vice Harbor.
//
// Pejalan kaki berjalan pelan di trotoar, menghindar dari mobil yang
// mendekat, lari (flee) saat ada kejahatan di dekatnya atau wanted naik,
// dan jatuh (down) kalau dipukul/ditabrak lalu hilang setelah beberapa detik.
//
// Konvensi heading: radian, 0 = +Z, bertambah berlawanan jarum jam dilihat
// dari atas; vektor maju = (sin(heading), cos(heading)) di (x, z).
//
// Bentuk pejalan kaki: { x, z, heading, speed, state, color, downTimer,
//   timer, targetX, targetZ }.
// state: 'walk' | 'flee' | 'down'.

const PED_COUNT = 14;
const WALK_SPEED = 1.4;
const FLEE_SPEED = 3.6;
const DOWN_TIME = 4; // detik tergeletak sebelum hilang
const AVOID_DIST = 7; // jarak mobil mulai dihindari
const FLEE_DIST = 14; // jarak kejahatan/player yang memicu lari

const SHIRT_PALETTE = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#ecf0f1', '#e67e22', '#fd79a8', '#636e72',
];

/** Ambil satu elemen acak. PERHATIAN urutan argumen: rng dulu, array kedua. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function sidewalkPoint(city, rng) {
  if (city && typeof city.randomSidewalkPoint === 'function') {
    const p = city.randomSidewalkPoint(rng);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return { x: p.x, z: p.z, heading: p.heading };
  }
  if (city && typeof city.randomRoadPoint === 'function') {
    const p = city.randomRoadPoint(rng);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      return { x: p.x + 3.5, z: p.z + 3.5, heading: p.heading };
    }
  }
  return { x: (rng() - 0.5) * 60, z: (rng() - 0.5) * 60, heading: undefined };
}

function blockedAt(city, x, z) {
  // city.isBlocked(x, z, r) butuh radius eksplisit; cek bounds juga karena
  // isBlocked kota tidak memeriksa batas peta.
  if (city && city.bounds) {
    const b = city.bounds;
    if (Number.isFinite(b.minX) && (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ)) return true;
  }
  if (city && typeof city.isBlocked === 'function') return city.isBlocked(x, z, 0.5);
  return false;
}

function makePed(city, rng) {
  const p = sidewalkPoint(city, rng);
  const target = sidewalkPoint(city, rng);
  return {
    x: p.x, z: p.z,
    heading: Number.isFinite(p.heading) ? p.heading : Math.atan2(target.x - p.x, target.z - p.z),
    speed: WALK_SPEED * (0.8 + rng() * 0.5),
    state: 'walk',
    color: pick(rng, SHIRT_PALETTE),
    downTimer: 0, timer: 0,
    targetX: target.x, targetZ: target.z,
  };
}

export function createPeds(city, rng) {
  const peds = [];
  for (let i = 0; i < PED_COUNT; i += 1) peds.push(makePed(city, rng));
  return peds;
}

/** Mobil terdekat dari pejalan kaki (dipakai untuk menghindar). */
function nearestCar(ped, cars) {
  let best = null;
  let bestDist = Infinity;
  for (const car of cars || []) {
    if (car.driver === null && car.parked) continue;
    const d = Math.hypot(car.x - ped.x, car.z - ped.z);
    if (d < bestDist) {
      bestDist = d;
      best = car;
    }
  }
  return best === null ? null : { car: best, dist: bestDist };
}

export function stepPeds(state, dt, city, rng) {
  const peds = state.peds || [];
  const cars = state.cars || [];
  const player = state.player;
  const random = rng || state.rng || Math.random;
  // Kejahatan baru saja terjadi (pukulan/tembakan/tabrak) atau wanted > 0:
  // pejalan kaki di sekitar panik.
  const crimeRecent = state.time - (state.lastCrimeAt ?? -1000) < 6;
  const panic = crimeRecent || (state.wanted || 0) > 0;

  for (let i = peds.length - 1; i >= 0; i -= 1) {
    const ped = peds[i];

    if (ped.state === 'down') {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) peds.splice(i, 1);
      continue;
    }

    // Tentukan apakah lari: panik + player/kejahatan cukup dekat.
    const playerDist = player ? Math.hypot(player.x - ped.x, player.z - ped.z) : Infinity;
    const near = nearestCar(ped, cars);
    if (panic && playerDist < FLEE_DIST) {
      ped.state = 'flee';
    } else if (ped.state === 'flee' && !panic) {
      ped.state = 'walk';
    }

    let moveX = 0;
    let moveZ = 0;
    let speed = ped.speed;

    if (ped.state === 'flee') {
      // Lari menjauhi player.
      speed = FLEE_SPEED;
      const dx = ped.x - (player ? player.x : ped.x);
      const dz = ped.z - (player ? player.z : ped.z);
      const dist = Math.hypot(dx, dz) || 1;
      moveX = dx / dist;
      moveZ = dz / dist;
      ped.heading = Math.atan2(moveX, moveZ);
    } else {
      // Jalan menuju target trotoar; sampai -> pilih target baru.
      const dx = ped.targetX - ped.x;
      const dz = ped.targetZ - ped.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.5) {
        const next = sidewalkPoint(city, random);
        ped.targetX = next.x;
        ped.targetZ = next.z;
      } else {
        moveX = dx / dist;
        moveZ = dz / dist;
        ped.heading = Math.atan2(moveX, moveZ);
      }
      // Menghindar: mobil mendekat dari depan -> geser menyamping.
      if (near && near.dist < AVOID_DIST && Math.abs(near.car.speed) > 2) {
        const carDx = ped.x - near.car.x;
        const carDz = ped.z - near.car.z;
        const carDist = Math.hypot(carDx, carDz) || 1;
        // Arah menghindar tegak lurus arah mobil.
        const side = (Math.sin(near.car.heading) * carDz - Math.cos(near.car.heading) * carDx) > 0 ? 1 : -1;
        moveX += -Math.cos(near.car.heading) * side * 0.9 + (carDx / carDist) * 0.6;
        moveZ += Math.sin(near.car.heading) * side * 0.9 + (carDz / carDist) * 0.6;
        const len = Math.hypot(moveX, moveZ) || 1;
        moveX /= len;
        moveZ /= len;
        ped.heading = Math.atan2(moveX, moveZ);
      }
    }

    const nx = ped.x + moveX * speed * dt;
    const nz = ped.z + moveZ * speed * dt;
    // Jangan masuk ke dalam bangunan: coba sumbu demi sumbu.
    if (!blockedAt(city, nx, nz)) {
      ped.x = nx;
      ped.z = nz;
    } else if (!blockedAt(city, nx, ped.z)) {
      ped.x = nx;
    } else if (!blockedAt(city, ped.x, nz)) {
      ped.z = nz;
    } else {
      // Terjebak di dinding: pilih target baru.
      const next = sidewalkPoint(city, random);
      ped.targetX = next.x;
      ped.targetZ = next.z;
    }
  }
}

/** Tandai pejalan kaki jatuh (dipukul/ditabrak); kembali false bila sudah jatuh. */
export function knockDown(ped) {
  if (!ped || ped.state === 'down') return false;
  ped.state = 'down';
  ped.downTimer = DOWN_TIME;
  ped.speed = 0;
  return true;
}
