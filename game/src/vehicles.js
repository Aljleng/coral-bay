// Kendaraan — fisika mobil arcade Vice Harbor.
//
// Konvensi heading: radian, 0 = +Z, bertambah berlawanan jarum jam dilihat
// dari atas; vektor maju = (sin(heading), cos(heading)) di (x, z).
// steer +1 = belok kanan (heading berkurang saat maju), throttle +1 = gas.
//
// Bentuk mobil: { id, kind, x, z, heading, speed, color, driver, parked,
//   owned, pauseTimer, turnTimer, targetSpeed, stunTimer, touchTimer }.
// driver: 'player' | 'traffic' | 'police' | null (parkir / tidak berawak).
// kind: 'sedan' | 'taxi' | 'truck' | 'police'.
// Mobil polisi dikendalikan stepPolice (police.js), bukan di sini: file ini
// hanya mengintegrasikan gerak mereka dari heading/speed yang sudah disetel,
// supaya tidak ada dua pengendali yang berebut satu mobil.

const CAR_LENGTH = 4.2;
const CAR_WIDTH = 2.0;
const CAR_RADIUS = 2.3; // radius tabrakan mobil-mobil (setengah diagonal kasar)
const ACCEL = 14; // unit/detik^2 saat gas penuh
const REVERSE_ACCEL = 8;
const BRAKE = 26; // pengereman saat throttle berlawanan arah gerak
const MAX_SPEED = 26; // ~94 km/jam skala game
const MAX_REVERSE = 9;
const DRAG = 0.55; // gesekan/drag per detik (kecepatan meluruh)
const ROLLING = 1.6; // gesekan gelinding saat tanpa gas
const TURN_RATE = 1.9; // radian/detik pada kecepatan penuh
const TRAFFIC_SPEED = 9;
const TRAFFIC_COUNT = 8;
const PARKED_COUNT = 6;

const TRAFFIC_COLORS = ['#c0392b', '#2980b9', '#7f8c8d', '#e67e22', '#16a085', '#8e44ad', '#f1c40f'];
const TAXI_COLOR = '#f1c40f';

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Titik jalan acak; jatuh kembali ke tengah peta bila city belum menyediakan. */
function roadPoint(city, rng) {
  if (city && typeof city.randomRoadPoint === 'function') {
    const p = city.randomRoadPoint(rng);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      return { x: p.x, z: p.z, heading: p.heading };
    }
  }
  return { x: (rng() - 0.5) * 60, z: (rng() - 0.5) * 60, heading: undefined };
}

function blockedAt(city, x, z) {
  // city.isBlocked(x, z, r) butuh radius eksplisit; isBlocked kota tidak
  // memeriksa batas, jadi cek bounds di sini juga (mobil jangan keluar peta).
  if (city && city.bounds) {
    const b = city.bounds;
    if (Number.isFinite(b.minX) && (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ)) return true;
  }
  if (city && typeof city.isBlocked === 'function') return city.isBlocked(x, z, 2);
  if (city && city.bounds) return false;
  return false;
}

/** Buat semua mobil awal: traffic yang jalan + mobil parkir (satu milik Mara). */
export function createVehicles(city, rng) {
  const cars = [];
  let id = 0;

  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const p = roadPoint(city, rng);
    // Traffic mengikuti grid jalan: pakai heading sepanjang jalan dari
    // city (randomRoadPoint menyertakan heading), dan melaju di lajur kanan
    // (offset +2,2 tegak lurus heading) supaya arah berlawanan tidak
    // tabrakan depan-depan terus.
    const heading = Number.isFinite(p.heading) ? p.heading : Math.floor(rng() * 4) * (Math.PI / 2);
    const rightX = -Math.cos(heading);
    const rightZ = Math.sin(heading);
    cars.push({
      id: id++, kind: rng() < 0.2 ? 'taxi' : 'sedan',
      x: p.x + rightX * 2.2, z: p.z + rightZ * 2.2, heading, speed: TRAFFIC_SPEED * (0.7 + rng() * 0.5),
      color: rng() < 0.2 ? TAXI_COLOR : pick(rng, TRAFFIC_COLORS),
      driver: 'traffic', parked: false, owned: false,
      pauseTimer: 0, turnTimer: 2 + rng() * 4, targetSpeed: TRAFFIC_SPEED,
      stunTimer: 0, touchTimer: 0,
    });
  }

  for (let i = 0; i < PARKED_COUNT; i += 1) {
    const p = roadPoint(city, rng);
    // Parkir sejajar jalan: pakai heading sepanjang jalan dari city.
    const heading = Number.isFinite(p.heading) ? p.heading : Math.floor(rng() * 4) * (Math.PI / 2);
    const side = rng() < 0.5 ? -1 : 1;
    // Parkir di tepi jalan: geser tegak lurus arah jalan.
    const px = p.x + -Math.cos(heading) * side * 3.4;
    const pz = p.z + Math.sin(heading) * side * 3.4;
    cars.push({
      id: id++, kind: 'sedan',
      x: px, z: pz, heading, speed: 0,
      color: pick(rng, TRAFFIC_COLORS),
      driver: null, parked: true, owned: i === 0, // mobil pertama = mobil Mara
      pauseTimer: 0, turnTimer: 0, targetSpeed: 0,
      stunTimer: 0, touchTimer: 0,
    });
  }

  return { cars, nextId: id };
}

/** Dorong mobil keluar dari bangunan: coba gerak sumbu demi sumbu. */
function moveWithBuildings(car, dx, dz, city) {
  const nx = car.x + dx;
  const nz = car.z + dz;
  const half = CAR_LENGTH / 2;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  // Uji hidung + ekor, bukan cuma titik tengah.
  const noseBlocked = blockedAt(city, nx + fx * half, nz + fz * half) ||
    blockedAt(city, nx - fx * half, nz - fz * half);
  if (!noseBlocked && !blockedAt(city, nx, nz)) {
    car.x = nx;
    car.z = nz;
    return true;
  }
  // Coba satu sumbu saja (meluncur di sepanjang dinding).
  if (!blockedAt(city, nx, car.z) && !blockedAt(city, nx + fx * half, car.z + fz * half)) {
    car.x = nx;
    return false;
  }
  if (!blockedAt(city, car.x, nz) && !blockedAt(city, car.x + fx * half, nz + fz * half)) {
    car.z = nz;
    return false;
  }
  return false;
}

/** Tabrakan mobil-mobil: dorong pisah sepanjang garis pusat, redam kecepatan. */
function collideCars(cars) {
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      const a = cars[i];
      const b = cars[j];
      if (a.parked && b.parked) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      const min = CAR_RADIUS * 2;
      if (dist === 0 || dist >= min) continue;
      const overlap = min - dist;
      const ux = dx / dist;
      const uz = dz / dist;
      const aMovable = !a.parked;
      const bMovable = !b.parked;
      // Bagi overlap: masing-masing setengah bila dua-duanya bisa gerak,
      // seluruhnya oleh yang bisa gerak bila satunya parkir.
      const aShare = aMovable && bMovable ? 0.5 : aMovable ? 1 : 0;
      const bShare = aMovable && bMovable ? 0.5 : bMovable ? 1 : 0;
      a.x -= ux * overlap * aShare;
      a.z -= uz * overlap * aShare;
      b.x += ux * overlap * bShare;
      b.z += uz * overlap * bShare;
      // Hanya redam kecepatan bila kedua mobil saling mendekat (tabrakan
      // sungguhan); kalau satu mendorong yang lain dari belakang, momentum
      // diteruskan, bukan dimatikan tiap frame.
      const aVx = Math.sin(a.heading) * a.speed;
      const aVz = Math.cos(a.heading) * a.speed;
      const bVx = Math.sin(b.heading) * b.speed;
      const bVz = Math.cos(b.heading) * b.speed;
      const closing = (aVx - bVx) * ux + (aVz - bVz) * uz;
      if (closing > 0.5) {
        if (aMovable) a.speed *= 0.85;
        if (bMovable) b.speed *= 0.85;
      }
    }
  }
}

/** Kendali traffic: ikuti jalan, belok di persimpangan, kadang berhenti singkat. */
function stepTraffic(car, dt, city, rng) {
  if (car.stunTimer > 0) {
    car.stunTimer -= dt;
    car.speed = 0;
    return;
  }
  if (car.pauseTimer > 0) {
    car.pauseTimer -= dt;
    car.speed = Math.max(0, car.speed - BRAKE * dt);
    return;
  }
  car.turnTimer -= dt;
  if (car.turnTimer <= 0) {
    car.turnTimer = 3 + rng() * 5;
    const roll = rng();
    if (roll < 0.12) {
      car.pauseTimer = 1 + rng() * 2; // berhenti singkat (lampu / pejalan kaki)
    } else if (roll < 0.42) {
      // Belok 90 derajat di persimpangan.
      car.heading += (rng() < 0.5 ? -1 : 1) * (Math.PI / 2);
    }
  }
  // Koreksi: kalau melenceng jauh dari jalan, belok pelan ke titik jalan terdekat.
  if (city && typeof city.nearestRoadPoint === 'function') {
    const near = city.nearestRoadPoint(car.x, car.z);
    if (near && Number.isFinite(near.x) && Number.isFinite(near.z)) {
      const dx = near.x - car.x;
      const dz = near.z - car.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 5) {
        const want = Math.atan2(dx, dz);
        car.heading += clamp(angleDiff(want, car.heading), -0.9 * dt, 0.9 * dt);
      }
    }
  }
  const target = car.targetSpeed || TRAFFIC_SPEED;
  if (car.speed < target) car.speed = Math.min(target, car.speed + ACCEL * 0.5 * dt);
  else if (car.speed > target) car.speed = Math.max(target, car.speed - ROLLING * dt);
}

/** Satu langkah fisika mobil player dari input (steer/throttle). */
function stepPlayerCar(car, dt, input, city) {
  if (car.stunTimer > 0) {
    car.stunTimer -= dt;
    car.speed = 0;
    return;
  }
  const throttle = input && Number.isFinite(input.throttle) ? input.throttle : 0;
  const steer = input && Number.isFinite(input.steer) ? input.steer : 0;
  if (throttle > 0) {
    car.speed += (car.speed < 0 ? BRAKE : ACCEL) * throttle * dt;
  } else if (throttle < 0) {
    car.speed += (car.speed > 0.5 ? -BRAKE : REVERSE_ACCEL) * -throttle * dt;
  } else {
    // Tanpa gas: gesekan gelinding + drag menghentikan mobil.
    const dec = ROLLING * dt;
    car.speed = car.speed > dec ? car.speed - dec : car.speed < -dec ? car.speed + dec : 0;
  }
  car.speed -= car.speed * DRAG * 0.12 * dt;
  car.speed = clamp(car.speed, -MAX_REVERSE, MAX_SPEED);
  // Radius belok mengecil saat pelan: mobil hampir diam hampir tidak berputar.
  const speedFactor = clamp(Math.abs(car.speed) / 12, 0, 1);
  const direction = car.speed >= 0 ? 1 : -1;
  car.heading -= steer * TURN_RATE * speedFactor * direction * dt;
}

export function stepVehicles(state, dt, input) {
  const city = state.city;
  const rng = state.rng || Math.random;
  const cars = state.cars || [];

  for (const car of cars) {
    if (car.driver === 'player') stepPlayerCar(car, dt, input, city);
    else if (car.driver === 'traffic') stepTraffic(car, dt, city, rng);
    else if (car.driver === 'police') {
      // Polisi disetir police.js; di sini hanya integrasi gerak + stun.
      if (car.stunTimer > 0) {
        car.stunTimer -= dt;
        car.speed = 0;
      }
    }
    // Parkir (driver null): diam.
  }

  // Integrasi gerak semua mobil yang bergerak.
  for (const car of cars) {
    if (car.driver === null || car.parked) continue;
    if (Math.abs(car.speed) < 0.01) continue;
    const dx = Math.sin(car.heading) * car.speed * dt;
    const dz = Math.cos(car.heading) * car.speed * dt;
    const moved = moveWithBuildings(car, dx, dz, city);
    if (!moved) {
      // Menabrak bangunan: pantul sedikit, kecepatan terpangkas.
      car.speed *= -0.25;
    }
  }

  collideCars(cars);
}

/** Mara masuk ke mobil: mobil jadi milik player untuk dikendarai. */
export function enterCar(state, car) {
  if (!car) return false;
  car.driver = 'player';
  car.parked = false;
  state.player.onFoot = false;
  state.player.car = car;
  state.player.x = car.x;
  state.player.z = car.z;
  state.player.heading = car.heading;
  state.player.speed = car.speed;
  return true;
}

/** Mara keluar dari mobil di sampingnya; mobil jadi parkir tak berawak. */
export function exitCar(state) {
  const car = state.player.car;
  if (!car) return false;
  const sideX = -Math.cos(car.heading);
  const sideZ = Math.sin(car.heading);
  state.player.x = car.x + sideX * 2.2;
  state.player.z = car.z + sideZ * 2.2;
  state.player.heading = car.heading;
  state.player.speed = 0;
  state.player.onFoot = true;
  state.player.car = null;
  car.driver = null;
  car.parked = true;
  car.speed = 0;
  return true;
}
