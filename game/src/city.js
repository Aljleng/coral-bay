// Coral Bay: procedural 9x9-block city. Roads, buildings, lights, props, sky.
// No shadow maps: cheap blob shadows live on cars / the player instead.
import { CFG } from './config.js';
import { mulberry32, rand, randi, pick, clamp } from './utils.js';

const PITCH = CFG.BLOCK + CFG.ROAD; // 56
export const ROAD_LINES = [];
for (let i = 0; i < CFG.GRID; i++) ROAD_LINES.push((i - (CFG.GRID - 1) / 2) * PITCH);
export const CITY_HALF = ((CFG.GRID - 1) / 2) * PITCH + PITCH / 2 + CFG.BLOCK / 2; // 273
const LEN = CITY_HALF * 2;

let sun, hemi, lampMat, sceneRef;
const skyDay = new THREE.Color(0x8fc3ea);
const skyNight = new THREE.Color(0x0d1526);
const skyDusk = new THREE.Color(0xe8905a);
const fogC = new THREE.Color();

function nearLine(v) {
  let b = 1e9;
  for (const L of ROAD_LINES) { const d = Math.abs(v - L); if (d < b) b = d; }
  return b;
}
export function roadAt(x, z) {
  return nearLine(x) <= CFG.ROAD / 2 + 0.5 || nearLine(z) <= CFG.ROAD / 2 + 0.5;
}
// A random spot on a road, heading along it. Forward = (sin h, cos h).
export function randomRoadPos(rng) {
  const line = pick(rng, ROAD_LINES);
  const along = rand(rng, -230, 230);
  if (rng() < 0.5) return { x: line + rand(rng, -3, 3), z: along, heading: rng() < 0.5 ? 0 : Math.PI };
  return { x: along, z: line + rand(rng, -3, 3), heading: rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2 };
}

function facadeTexture(base, litRatio, rng) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, 128, 10);
  for (let r = 0; r < 10; r++) for (let col = 0; col < 5; col++) {
    g.fillStyle = rng() < litRatio ? '#ffd98a' : '#232a33';
    g.fillRect(10 + col * 23, 18 + r * 23, 15, 14);
  }
  return new THREE.CanvasTexture(c);
}

function roadTexture(repeatU, repeatV) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#26292e'; g.fillRect(0, 0, 64, 256);
  g.fillStyle = '#3a3e44';
  for (let i = 0; i < 200; i++) g.fillRect(Math.random() * 64, Math.random() * 256, 2, 2);
  g.fillStyle = '#e8c33a';
  for (let y = 0; y < 256; y += 64) g.fillRect(30, y, 4, 34); // centre dashes
  g.fillStyle = '#c8ccd2';
  g.fillRect(2, 0, 2, 256); g.fillRect(60, 0, 2, 256); // edge lines
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatU, repeatV);
  return t;
}

// Sun / sky / lamps for hour h (0-24). Day 6h-18h, dusk at both ends.
export function setTimeOfDay(h) {
  if (!sun) return;
  const el = ((h - 6) / 12) * Math.PI;
  const day = clamp(Math.sin(el), 0, 1);
  const dusk = h > 6 && h < 18 ? clamp(1 - Math.abs(Math.sin(el)) * 3, 0, 1) : 0;
  sun.position.set(Math.cos(el) * 200, Math.max(Math.sin(el), 0.08) * 200, 90);
  sun.intensity = 0.12 + day * 1.05;
  sun.color.setHex(day > 0.6 ? 0xfff2d8 : 0xffb36b);
  hemi.intensity = 0.25 + day * 0.55;
  fogC.copy(skyNight).lerp(skyDay, day).lerp(skyDusk, dusk * 0.6);
  if (sceneRef) {
    sceneRef.background = fogC;
    if (sceneRef.fog) sceneRef.fog.color.copy(fogC);
  }
  lampMat.emissiveIntensity = day < 0.3 ? 1.4 : 0;
}

export function buildCity(scene, seed) {
  const rng = mulberry32(seed);
  sceneRef = scene;
  const colliders = [];
  scene.background = new THREE.Color(0x8fc3ea);
  scene.fog = new THREE.Fog(0x8fc3ea, 200, 560);
  sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
  sun.position.set(120, 180, 80);
  scene.add(sun);
  hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.7);
  scene.add(hemi);
  lampMat = new THREE.MeshLambertMaterial({ color: 0xfff2c0, emissive: 0xffdf80, emissiveIntensity: 0 });

  // Sandy apron under everything (coastal city), then the sidewalk-grey ground.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(LEN + 160, LEN + 160),
    new THREE.MeshLambertMaterial({ color: 0xc2a878 }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.05; scene.add(apron);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(LEN, LEN),
    new THREE.MeshLambertMaterial({ color: 0x6a6f75 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);

  // Road strips with dashed centre lines.
  const roadMatV = new THREE.MeshLambertMaterial({ map: roadTexture(1, 12) });
  const roadMatH = new THREE.MeshLambertMaterial({ map: roadTexture(12, 1) });
  const geoV = new THREE.PlaneGeometry(CFG.ROAD, LEN);
  const geoH = new THREE.PlaneGeometry(LEN, CFG.ROAD);
  for (const L of ROAD_LINES) {
    const v = new THREE.Mesh(geoV, roadMatV);
    v.rotation.x = -Math.PI / 2; v.position.set(L, 0.02, 0); scene.add(v);
    const h = new THREE.Mesh(geoH, roadMatH);
    h.rotation.x = -Math.PI / 2; h.position.set(0, 0.02, L); scene.add(h);
  }

  // Buildings: shared unit box, 6 facade materials, taller near the centre.
  const box = new THREE.BoxGeometry(1, 1, 1);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x2c2f34 });
  const facades = ['#b98a5e', '#7d8a99', '#a89a7d', '#8a6f7d', '#6f8a7a', '#9a8a6f']
    .map((base, i) => new THREE.MeshLambertMaterial({ map: facadeTexture(base, 0.2 + i * 0.06, rng) }));
  for (let bx = 0; bx < CFG.GRID; bx++) for (let bz = 0; bz < CFG.GRID; bz++) {
    const cx = (bx - 4) * PITCH + PITCH / 2, cz = (bz - 4) * PITCH + PITCH / 2;
    const downtown = 1 - Math.hypot(cx, cz) / (CITY_HALF * 1.2);
    const r = rng();
    const spots = r < 0.4 ? [[0, 0, 30, 30]]
      : r < 0.75 ? [[-9, 0, 15, 30], [9, 0, 15, 30]]
      : [[-9, -9, 14, 14], [9, -9, 14, 14], [-9, 9, 14, 14], [9, 9, 14, 14]];
    for (const s of spots) {
      const h = Math.round((8 + downtown * 30 + rand(rng, 0, 14)) * 2) / 2;
      const m = new THREE.Mesh(box, pick(rng, facades));
      m.scale.set(s[2], h, s[3]);
      m.position.set(cx + s[0], h / 2, cz + s[1]);
      scene.add(m);
      const roof = new THREE.Mesh(box, roofMat);
      roof.scale.set(s[2] + 0.8, 0.6, s[3] + 0.8);
      roof.position.set(cx + s[0], h + 0.3, cz + s[1]);
      scene.add(roof);
      colliders.push({
        minX: cx + s[0] - s[2] / 2, maxX: cx + s[0] + s[2] / 2,
        minZ: cz + s[1] - s[3] / 2, maxZ: cz + s[1] + s[3] / 2,
      });
    }
  }

  // Streetlights at every other intersection corner.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 6, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
  const headGeo = new THREE.BoxGeometry(0.5, 0.18, 1.1);
  for (let i = 0; i < ROAD_LINES.length; i++) for (let j = 0; j < ROAD_LINES.length; j++) {
    if ((i + j) % 2) continue;
    const x = ROAD_LINES[i] + 8.5, z = ROAD_LINES[j] + 8.5;
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 3, z); scene.add(pole);
    const head = new THREE.Mesh(headGeo, lampMat);
    head.position.set(x - 0.4, 6.05, z); scene.add(head);
  }

  // Props: trees on block corners, hydrants + benches along road edges.
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1.8, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const leafGeo = new THREE.BoxGeometry(2, 2, 2);
  const leafMats = [0x3f7a3a, 0x4c8a3f].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const hydGeo = new THREE.CylinderGeometry(0.22, 0.28, 0.9, 8);
  const hydMat = new THREE.MeshLambertMaterial({ color: 0xc23b2e });
  const benchMat = new THREE.MeshLambertMaterial({ color: 0x7a5c38 });
  for (let n = 0; n < 60; n++) {
    const cx = (randi(rng, 0, 8) - 4) * PITCH + PITCH / 2;
    const cz = (randi(rng, 0, 8) - 4) * PITCH + PITCH / 2;
    const x = cx + pick(rng, [-19, 19]) + rand(rng, -1, 1), z = cz + rand(rng, -19, 19);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 0.9, z); scene.add(trunk);
    const leaf = new THREE.Mesh(leafGeo, pick(rng, leafMats));
    leaf.position.set(x, 2.9, z); leaf.rotation.y = rand(rng, 0, 3); scene.add(leaf);
  }
  for (let n = 0; n < 18; n++) {
    const hyd = new THREE.Mesh(hydGeo, hydMat);
    hyd.position.set(pick(rng, ROAD_LINES) + 8.2, 0.45, rand(rng, -230, 230));
    scene.add(hyd);
  }
  for (let n = 0; n < 16; n++) {
    const bench = new THREE.Mesh(box, benchMat);
    bench.scale.set(2, 0.45, 0.7);
    bench.position.set(rand(rng, -230, 230), 0.25, pick(rng, ROAD_LINES) + 8.2);
    scene.add(bench);
  }

  setTimeOfDay(10);
  return { colliders, roadAt, randomRoadPos, update };
}

// Nothing animates in the city itself yet; kept for the main loop contract.
function update() {}
