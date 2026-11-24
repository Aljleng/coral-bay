// Drawing only: the world's state and the current screen in, pixels out. Three.js renders
// Port Meridian at golden hour — sunset sky, neon signs, lit windows, dark asphalt — with a
// third-person camera that follows Mara (on foot or in her car). The HUD and the title /
// pause / game-over panels are DOM overlaid on the canvas, updated only when they change.
//
// The renderer only READS world.state (see the state contract in the task): it never
// simulates, never mutates state, and makes no network requests. Heading follows config.js:
// 0 = +Z, counter-clockwise from above, so mesh.rotation.y = heading.
import * as THREE from '../vendor/three.module.min.js';
import { CAMERA, CITY, DEFAULT_SEED, PALETTE, TRAFFIC } from './config.js';
import { createRandom } from './random.js';
import { createCity } from './city.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const MAX_CARS = TRAFFIC.maxCars;
const MAX_PEDS = TRAFFIC.maxPeds;

/** Sky gradient painted once onto a canvas and used as the scene background. */
function makeSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, PALETTE.skyTop);
  grad.addColorStop(0.55, PALETTE.skyHorizon);
  grad.addColorStop(1, PALETTE.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Lit windows on black: used as the emissive map of every building facade. */
function makeWindowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 12; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      if (Math.random() < 0.45) continue; // dark window
      ctx.fillStyle = Math.random() < 0.75 ? '#ffd166' : '#9be8ff';
      ctx.fillRect(8 + col * 20, 10 + row * 20, 12, 12);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRenderer(canvas, city) {
  const theCity = city || createCity(createRandom(DEFAULT_SEED));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(PALETTE.fog, CAMERA.fogNear, CAMERA.fogFar);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 1200);

  // Low warm sun from the west, plus a soft ambient so shadows never go black.
  const sun = new THREE.DirectionalLight(0xffb36b, 1.6);
  sun.position.set(-160, 55, 120);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xff9a66, 0x2a2140, 0.9));
  const dusk = new THREE.AmbientLight(0x604060, 0.5);
  scene.add(dusk);

  // ---- shared geometry / materials (reused everywhere; nothing allocates per frame) ----
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const wheelGeo = new THREE.BoxGeometry(0.32, 0.62, 0.62);
  const materialCache = new Map();
  function material(color) {
    if (!materialCache.has(color)) {
      materialCache.set(color, new THREE.MeshLambertMaterial({ color }));
    }
    return materialCache.get(color);
  }
  const windowTex = makeWindowTexture();
  const facadeCache = new Map();
  function facade(color) {
    if (!facadeCache.has(color)) {
      facadeCache.set(
        color,
        new THREE.MeshLambertMaterial({ color, emissive: 0xffffff, emissiveMap: windowTex, emissiveIntensity: 0.55 }),
      );
    }
    return facadeCache.get(color);
  }
  const neonCache = new Map();
  function neon(color) {
    if (!neonCache.has(color)) {
      neonCache.set(color, new THREE.MeshBasicMaterial({ color }));
    }
    return neonCache.get(color);
  }

  // ---- static city: ground, roads, dashes, parks, sea, beach, buildings, lamps, palms ----
  const { minX, maxX, minZ, maxZ } = theCity.bounds;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX + 60, maxZ - minZ + 60), material(PALETTE.ground));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 0);
  scene.add(ground);

  const roadMat = material(PALETTE.road);
  const roadGeoX = new THREE.PlaneGeometry(CITY.halfExtent * 2 + CITY.roadWidth, CITY.roadWidth);
  const roadGeoZ = new THREE.PlaneGeometry(CITY.roadWidth, CITY.halfExtent * 2 + CITY.roadWidth);
  for (const road of theCity.roads) {
    const horizontal = road.z1 === road.z2;
    const mesh = new THREE.Mesh(horizontal ? roadGeoX : roadGeoZ, roadMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((road.x1 + road.x2) / 2, 0.02, (road.z1 + road.z2) / 2);
    scene.add(mesh);
  }

  // Centre dashes, one instanced draw call for the whole city.
  const dashGeo = new THREE.BoxGeometry(0.5, 0.06, 3);
  const dashMat = material(PALETTE.roadLine);
  const dashPositions = [];
  for (let i = 0; i < theCity.roads.length; i += 1) {
    const r = theCity.roads[i];
    const horizontal = r.z1 === r.z2;
    const len = horizontal ? r.x2 - r.x1 : r.z2 - r.z1;
    for (let d = -len / 2 + 8; d < len / 2 - 4; d += 12) {
      dashPositions.push(horizontal ? { x: d, z: r.z1, rot: 0 } : { x: r.x1, z: d, rot: Math.PI / 2 });
    }
  }
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashPositions.length);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < dashPositions.length; i += 1) {
      const p = dashPositions[i];
      q.setFromAxisAngle(up, p.rot);
      m.compose(new THREE.Vector3(p.x, 0.05, p.z), q, new THREE.Vector3(1, 1, 1));
      dashes.setMatrixAt(i, m);
    }
  }
  scene.add(dashes);

  // Parks: green slabs slightly above the ground.
  const parkMat = material('#3f7a44');
  for (const park of theCity.parks) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(park.size, park.size), parkMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(park.x, 0.03, park.z);
    scene.add(mesh);
  }

  // Sea to the north + a sand strip along the promenade.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX + 400, 320), material(PALETTE.sea));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.4, CITY.seaZ - 160);
  scene.add(sea);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX + 120, 10), material(PALETTE.sand));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, CITY.seaZ + 2);
  scene.add(sand);

  // Buildings: one shared box, scaled per building, facade material cached per colour.
  // A few get a neon sign strip on their south face.
  for (let i = 0; i < theCity.buildings.length; i += 1) {
    const b = theCity.buildings[i];
    const mesh = new THREE.Mesh(boxGeo, facade(b.color));
    mesh.scale.set(b.w, b.h, b.d);
    mesh.position.set(b.x, b.h / 2, b.z);
    scene.add(mesh);
    if (i % 9 === 0) {
      const sign = new THREE.Mesh(boxGeo, neon(PALETTE.neon[i % PALETTE.neon.length]));
      sign.scale.set(Math.min(b.w * 0.7, 10), 1.1, 0.4);
      sign.position.set(b.x, Math.min(b.h - 1.5, 12), b.z + b.d / 2 + 0.25);
      scene.add(sign);
    }
  }

  // Street lamps: instanced poles + glowing heads.
  {
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 5.4, 6);
    const poleMat = material('#2c2c34');
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, theCity.lamps.length);
    const headGeo = new THREE.BoxGeometry(1.4, 0.28, 0.5);
    const headMat = new THREE.MeshBasicMaterial({ color: PALETTE.lampGlow });
    const heads = new THREE.InstancedMesh(headGeo, headMat, theCity.lamps.length);
    const m = new THREE.Matrix4();
    for (let i = 0; i < theCity.lamps.length; i += 1) {
      const l = theCity.lamps[i];
      m.makeTranslation(l.x, 2.7, l.z);
      poles.setMatrixAt(i, m);
      m.makeTranslation(l.x, 5.5, l.z);
      heads.setMatrixAt(i, m);
    }
    scene.add(poles);
    scene.add(heads);
  }

  // Palms: instanced trunks + cone canopies.
  {
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 1, 6);
    const trunkMat = material(PALETTE.palmTrunk);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, theCity.palms.length);
    const canopyGeo = new THREE.ConeGeometry(2.2, 2.4, 7);
    const canopyMat = material(PALETTE.palmLeaves);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, theCity.palms.length);
    const m = new THREE.Matrix4();
    for (let i = 0; i < theCity.palms.length; i += 1) {
      const p = theCity.palms[i];
      m.makeScale(1, p.h, 1);
      m.setPosition(p.x, p.h / 2, p.z);
      trunks.setMatrixAt(i, m);
      m.makeScale(1, 1, 1);
      m.setPosition(p.x, p.h + 1, p.z);
      canopies.setMatrixAt(i, m);
    }
    scene.add(trunks);
    scene.add(canopies);
  }

  // The setting sun: a big warm disc low over the sea.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(26, 32),
    new THREE.MeshBasicMaterial({ color: PALETTE.sun, fog: false }),
  );
  sunDisc.position.set(-140, 26, -520);
  scene.add(sunDisc);

  // ---- dynamic pools: cars, peds, player, mission beacon ----
  function makeCarMesh() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(boxGeo, material(PALETTE.carColors[0]));
    body.scale.set(2, 0.85, 4.4);
    body.position.y = 0.75;
    group.add(body);
    const cabin = new THREE.Mesh(boxGeo, material('#1a2028'));
    cabin.scale.set(1.7, 0.7, 2.2);
    cabin.position.set(0, 1.45, -0.2);
    group.add(cabin);
    const wheelMat = material('#111111');
    for (const [wx, wz] of [[-1.05, 1.45], [1.05, 1.45], [-1.05, -1.45], [1.05, -1.45]]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wx, 0.35, wz);
      group.add(wheel);
    }
    const bar = new THREE.Group();
    const barR = new THREE.Mesh(boxGeo, neon('#ff2e2e'));
    barR.scale.set(0.7, 0.25, 0.5);
    barR.position.set(-0.45, 1.9, -0.2);
    const barB = new THREE.Mesh(boxGeo, neon('#2e6bff'));
    barB.scale.set(0.7, 0.25, 0.5);
    barB.position.set(0.45, 1.9, -0.2);
    bar.add(barR, barB);
    bar.visible = false;
    group.add(bar);
    const sign = new THREE.Mesh(boxGeo, neon(PALETTE.taxi));
    sign.scale.set(0.9, 0.3, 0.5);
    sign.position.set(0, 1.95, -0.2);
    sign.visible = false;
    group.add(sign);
    group.userData = { body, bar, sign };
    group.visible = false;
    scene.add(group);
    return group;
  }

  const carPool = [];
  for (let i = 0; i < MAX_CARS; i += 1) carPool.push(makeCarMesh());

  function makePedMesh() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(boxGeo, material(PALETTE.pedShirts[0]));
    body.scale.set(0.7, 1.1, 0.4);
    body.position.y = 0.95;
    group.add(body);
    const head = new THREE.Mesh(boxGeo, material(PALETTE.pedSkin[0]));
    head.scale.set(0.42, 0.42, 0.42);
    head.position.y = 1.75;
    group.add(head);
    group.userData = { body, head };
    group.visible = false;
    scene.add(group);
    return group;
  }

  const pedPool = [];
  for (let i = 0; i < MAX_PEDS; i += 1) pedPool.push(makePedMesh());

  // Mara Quinn, on foot: teal jacket, dark jeans, unmistakable.
  const playerMesh = new THREE.Group();
  const playerBody = new THREE.Mesh(boxGeo, material(PALETTE.playerJacket));
  playerBody.scale.set(0.72, 1.15, 0.42);
  playerBody.position.y = 0.98;
  playerMesh.add(playerBody);
  const playerHead = new THREE.Mesh(boxGeo, material(PALETTE.pedSkin[0]));
  playerHead.scale.set(0.44, 0.44, 0.44);
  playerHead.position.y = 1.78;
  playerMesh.add(playerHead);
  const playerHair = new THREE.Mesh(boxGeo, material(PALETTE.playerHair));
  playerHair.scale.set(0.46, 0.2, 0.46);
  playerHair.position.y = 1.98;
  playerMesh.add(playerHair);
  // Small marker above Mara so the player never loses her in a crowd.
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), neon(PALETTE.neon[1]));
  marker.position.y = 2.5;
  playerMesh.add(marker);
  scene.add(playerMesh);

  // Mission target beacon: a pulsing column of light.
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 26, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: PALETTE.neon[2], transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  beacon.visible = false;
  scene.add(beacon);
  const beaconBase = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 0.2, 24),
    new THREE.MeshBasicMaterial({ color: PALETTE.neon[2], transparent: true, opacity: 0.6 }),
  );
  beaconBase.visible = false;
  scene.add(beaconBase);

  // ---- camera ----
  const camTarget = new THREE.Vector3(0, 0, 60);
  const camPos = new THREE.Vector3(0, 130, 260);
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  let lastTime = 0;

  function updateCamera(state, screen, dt) {
    if (screen === SCREEN_TITLE) {
      const angle = state.time * CAMERA.overviewSpeed;
      desiredPos.set(Math.sin(angle) * CAMERA.overviewRadius, CAMERA.overviewHeight, Math.cos(angle) * CAMERA.overviewRadius);
      desiredLook.set(0, 0, 0);
    } else {
      const focus = state.player.car || state.player;
      const fx = focus.x;
      const fz = focus.z;
      const heading = focus.heading || 0;
      const dist = state.player.onFoot ? CAMERA.followDistFoot : CAMERA.followDistCar;
      const height = state.player.onFoot ? CAMERA.followHeightFoot : CAMERA.followHeightCar;
      desiredPos.set(fx - Math.sin(heading) * dist, height, fz - Math.cos(heading) * dist);
      desiredLook.set(fx + Math.sin(heading) * CAMERA.lookAhead, CAMERA.lookHeight, fz + Math.cos(heading) * CAMERA.lookAhead);
    }
    const k = 1 - Math.exp(-dt * (screen === SCREEN_TITLE ? CAMERA.lerpTitle : CAMERA.lerpPlay));
    camPos.lerp(desiredPos, k);
    camTarget.lerp(desiredLook, k);
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
  }

  function syncCars(state) {
    const cars = state.cars || [];
    for (let i = 0; i < carPool.length; i += 1) {
      const mesh = carPool[i];
      if (i >= cars.length) {
        mesh.visible = false;
        continue;
      }
      const car = cars[i];
      if (typeof car.x !== 'number' || typeof car.z !== 'number') {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(car.x, 0, car.z);
      mesh.rotation.y = car.heading;
      const sport = car.kind === 'sport';
      mesh.userData.body.scale.set(sport ? 1.9 : 2, sport ? 0.7 : 0.85, sport ? 4.9 : 4.4);
      mesh.userData.body.material = car.kind === 'police'
        ? material(PALETTE.policeBody)
        : car.kind === 'taxi'
          ? material(PALETTE.taxi)
          : material(car.color || PALETTE.carColors[i % PALETTE.carColors.length]);
      mesh.userData.bar.visible = car.kind === 'police';
      mesh.userData.sign.visible = car.kind === 'taxi';
    }
  }

  function syncPeds(state) {
    const peds = state.peds || [];
    for (let i = 0; i < pedPool.length; i += 1) {
      const mesh = pedPool[i];
      if (i >= peds.length) {
        mesh.visible = false;
        continue;
      }
      const ped = peds[i];
      if (typeof ped.x !== 'number' || typeof ped.z !== 'number') {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(ped.x, 0, ped.z);
      mesh.rotation.y = ped.heading;
      mesh.rotation.z = ped.state === 'down' ? Math.PI / 2 : 0;
      mesh.position.y = ped.state === 'down' ? 0.35 : 0;
      mesh.userData.body.material = material(PALETTE.pedShirts[ped.id % PALETTE.pedShirts.length]);
      mesh.userData.head.material = material(PALETTE.pedSkin[ped.id % PALETTE.pedSkin.length]);
    }
  }

  function syncPlayer(state) {
    const p = state.player;
    if (!p || typeof p.x !== 'number' || typeof p.z !== 'number') {
      playerMesh.visible = false;
      return;
    }
    if (p.onFoot) {
      playerMesh.visible = true;
      playerMesh.position.set(p.x, 0, p.z);
      playerMesh.rotation.y = p.heading;
      marker.position.y = 2.5 + Math.sin(state.time * 3) * 0.12;
      marker.rotation.y = state.time * 2;
    } else {
      playerMesh.visible = false;
    }
  }

  function syncBeacon(state) {
    const m = state.mission;
    if (m && m.target) {
      beacon.visible = true;
      beaconBase.visible = true;
      beacon.position.set(m.target.x, 13, m.target.z);
      beaconBase.position.set(m.target.x, 0.15, m.target.z);
      const pulse = 0.3 + 0.12 * Math.sin(state.time * 4);
      beacon.material.opacity = pulse;
      beacon.scale.set(1 + 0.15 * Math.sin(state.time * 4), 1, 1 + 0.15 * Math.sin(state.time * 4));
    } else {
      beacon.visible = false;
      beaconBase.visible = false;
    }
  }

  let mode = SCREEN_TITLE;

  function setMode(next) {
    mode = next;
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  /** Paint one frame from world.state and the current screen. */
  function draw(state, screen) {
    const active = screen || mode;
    const dt = Math.min(Math.max((state.time || 0) - lastTime, 0), 0.1);
    lastTime = state.time || 0;
    updateCamera(state, active, dt || 0.016);
    syncCars(state);
    syncPeds(state);
    syncPlayer(state);
    syncBeacon(state);
    renderer.render(scene, camera);
  }

  return { draw, setMode, camera };
}
