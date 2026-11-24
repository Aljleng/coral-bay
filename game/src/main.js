// Coral Bay bootstrap: renderer, world, input, camera, loop, save, ?shot= scenes.
import { G, resetGame } from './state.js';
import { CFG } from './config.js';
import { mulberry32, pick, clamp, angLerp } from './utils.js';
import { buildCity, setTimeOfDay } from './city.js';
import { createCar, driveCar, updateTraffic } from './vehicles.js';
import { createPlayer, updatePlayer, setPlayerColliders, respawnPlayer, enterCar } from './player.js';
import { spawnPeds, updatePeds } from './peds.js';
import { initPolice, updatePolice, clearWanted } from './police.js';
import { startMission, updateMissions, setMissionScene } from './missions.js';
import { initHUD, updateHUD, drawMinimap, showScreen, toast } from './hud.js';
import { initAudio, engineSound, sfx, startMusic, toggleMute, updateAudio } from './audio.js';
import { applyShot } from './shots.js';

const SAVE_KEY = 'coralbay-save-v1';
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
if (Number.isInteger(seedParam)) G.seed = seedParam;

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);

const city = buildCity(scene, G.seed);
setPlayerColliders(city.colliders);
initPolice(scene, city.colliders);
setMissionScene(scene);
const rng = mulberry32(G.seed);

// Parked sedan the player starts next to, then traffic + pedestrians.
const spot = city.randomRoadPos(rng);
const parkedCar = createCar(scene, 'sedan', spot.x, spot.z, spot.heading, 0x3a7bd5);
parkedCar.driver = false;
G.vehicles.push(parkedCar);
const spawnX = spot.x + 2.5, spawnZ = spot.z + 2.5;
createPlayer(scene, spawnX, spawnZ);
const allCars = [parkedCar];
for (let i = 0; i < CFG.TRAFFIC_CARS; i++) {
  const p = city.randomRoadPos(rng);
  const car = createCar(scene, pick(rng, ['sedan', 'taxi', 'van', 'sport', 'truck']), p.x, p.z, p.heading);
  car.driver = true;
  G.vehicles.push(car);
  allCars.push(car);
}
spawnPeds(scene, CFG.PEDS, G.seed);
setTimeOfDay(G.timeOfDay);
initHUD();

function announce(msg) { if (statusEl) statusEl.textContent = msg; }

function saveGame() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: G.cash, missionsDone: G.stats.missionsDone,
      playerPos: { x: G.player.pos.x, z: G.player.pos.z }, timeOfDay: G.timeOfDay,
    }));
  } catch { /* storage off: the save lasts this visit only */ }
}
function loadSave() {
  try {
    const s = JSON.parse(window.localStorage.getItem(SAVE_KEY) || 'null');
    return s && typeof s.cash === 'number' ? s : null;
  } catch { return null; }
}

function startGame(fromSave) {
  const save = fromSave ? loadSave() : null;
  resetGame();
  clearWanted();
  const rr = mulberry32((Math.random() * 1e9) | 0);
  G.vehicles.length = 0;
  for (const c of allCars) {
    if (!c.group.parent) scene.add(c.group); // shots.js may have removed it
    const p = city.randomRoadPos(rr);
    c.pos.set(p.x, 0, p.z);
    c.heading = p.heading; c.speed = 0; c.group.rotation.y = p.heading;
    c.isPlayer = false;
    c.driver = c === parkedCar ? false : true;
    G.vehicles.push(c);
  }
  if (save) {
    G.cash = save.cash;
    G.stats.missionsDone = save.missionsDone;
    G.timeOfDay = save.timeOfDay;
    respawnPlayer(save.playerPos.x, save.playerPos.z);
  } else {
    respawnPlayer(spawnX, spawnZ);
  }
  setTimeOfDay(G.timeOfDay);
  G.mode = 'play';
  showScreen('none');
  initAudio();
  startMusic();
  sfx('click');
  announce('Playing. Welcome to Coral Bay.');
  toast('Welcome to Coral Bay, Jay Carter.');
}
function pauseGame() {
  if (G.mode !== 'play') return;
  G.mode = 'paused'; G.paused = true;
  showScreen('pause');
  saveGame();
  announce('Paused.');
}
function resumeGame() {
  if (G.mode !== 'paused') return;
  G.mode = 'play'; G.paused = false;
  showScreen('none');
  announce('Playing.');
}

// ---- input: WASD/arrows, Shift run, E enter/exit, F steal/punch, Space brake,
// Esc pause, M mute, R restart mission, Enter start/restart, drag orbits camera.
const keys = new Set(), just = new Set();
let dragging = false, lastPX = 0, lastDrag = 0;
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code); just.add(e.code);
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Escape') {
    if (G.mode === 'play') pauseGame();
    else if (G.mode === 'paused') resumeGame();
  }
  if (e.code === 'Enter') {
    if (G.mode === 'menu') startGame(!!loadSave());
    else if (G.mode === 'wasted' || G.mode === 'busted') startGame(false);
  }
  if (e.code === 'KeyR' && G.mode === 'play' && G.mission) startMission(G.mission.id, scene);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('pointerdown', (e) => { dragging = true; lastPX = e.clientX; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  G.camOrbit -= (e.clientX - lastPX) * 0.005;
  lastPX = e.clientX; lastDrag = performance.now();
});
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('wheel', (e) => {
  G.camDist = clamp(G.camDist + Math.sign(e.deltaY), 6, 16);
  e.preventDefault();
}, { passive: false });
document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => {
  const a = b.getAttribute('data-action');
  if (a === 'start') startGame(false);
  else if (a === 'continue') startGame(true);
  else if (a === 'resume') resumeGame();
  else if (a === 'restart') startGame(false);
  else if (a === 'menu') { G.mode = 'menu'; showScreen('menu'); }
  else if (a === 'mute') toggleMute();
}));
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.mode === 'play') pauseGame();
});

function readInput() {
  return {
    fwd: keys.has('KeyW') || keys.has('ArrowUp'),
    back: keys.has('KeyS') || keys.has('ArrowDown'),
    left: keys.has('KeyA') || keys.has('ArrowLeft'),
    right: keys.has('KeyD') || keys.has('ArrowRight'),
    run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    brake: keys.has('Space'),
    enter: just.has('KeyE'),
    steal: just.has('KeyF'),
    punch: just.has('KeyF'),
  };
}

// Third-person follow camera: behind the player/car, drag orbits, auto-returns.
const camTarget = new THREE.Vector3();
const camGoal = new THREE.Vector3();
function updateCamera(dt) {
  if (G.shotCam) { // staged screenshot camera (shots.js)
    camera.position.set(G.shotCam.x, G.shotCam.y, G.shotCam.z);
    camera.lookAt(G.shotCam.lookX, G.shotCam.lookY, G.shotCam.lookZ);
    return;
  }
  if (!G.player.pos) return;
  camTarget.set(G.player.pos.x, G.player.onFoot ? 1.6 : 2.0, G.player.pos.z);
  const heading = G.player.onFoot ? G.player.heading
    : (G.player.vehicle ? G.player.vehicle.heading : G.player.heading);
  if (performance.now() - lastDrag > 2500 && Math.abs(G.player.speed) > 2) {
    G.camOrbit = angLerp(G.camOrbit, heading, 1 - Math.exp(-1.5 * dt));
  }
  camGoal.set(
    camTarget.x - Math.sin(G.camOrbit) * G.camDist,
    camTarget.y + 3.2,
    camTarget.z - Math.cos(G.camOrbit) * G.camDist);
  camera.position.lerp(camGoal, 1 - Math.exp(-8 * dt));
  camera.lookAt(camTarget);
}
camera.position.set(spawnX, 5, spawnZ - G.camDist);
camera.lookAt(spawnX, 1.6, spawnZ);

window.__game = G;

// ---- main loop (dt clamped; shot scenes stage first, then render once ready).
let last = performance.now(), saveT = 0, ready = false, prevMode = G.mode;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const input = readInput();
  if (G.mode === 'play' && !G.paused) {
    G.timeOfDay = (G.timeOfDay + dt * 0.02) % 24; // a full day in ~20 minutes
    setTimeOfDay(G.timeOfDay);
    updatePlayer(dt, input);
    if (G.player.vehicle) driveCar(G.player.vehicle, input, dt, city.colliders);
    updateTraffic(dt, city.colliders);
    updatePeds(dt);
    updatePolice(dt);
    updateMissions(dt);
    city.update(dt);
    engineSound(G.player.speed, !!G.player.vehicle);
    updateAudio(dt);
    saveT += dt;
    if (saveT > 10) { saveT = 0; saveGame(); }
  }
  if (G.mode !== prevMode) {
    if (G.mode === 'wasted' || G.mode === 'busted') {
      // police.doBusted() moves G.player.pos (which may be the car vector)
      // without re-linking the player mesh: put the mesh there and re-link.
      if (G.player.pos) {
        respawnPlayer(G.player.pos.x, G.player.pos.z);
        if (G.mode === 'busted') G.player.heading = Math.PI / 4;
      }
      saveGame();
    }
    prevMode = G.mode;
  }
  updateCamera(dt);
  updateHUD();
  drawMinimap();
  renderer.render(scene, camera);
  if (!ready) { ready = true; window.__gameReady = true; }
  just.clear();
}

if (shot) {
  applyShot(shot, G.seed, scene);
  // Shot scenes stage their own view: hide the menu overlay (on by default
  // in index.html) or it would cover the staged scene, and show the HUD.
  showScreen('none');
  // shots.js puts the player in a car by mutating pos, not by re-linking it:
  // run the real enter path so pos follows the car and the mesh hides.
  if (G.player.vehicle) { const v = G.player.vehicle; v.isPlayer = false; enterCar(v); }
  announce('Coral Bay.');
} else {
  showScreen('menu');
  announce('Coral Bay. Press Enter or Start to play.');
}
requestAnimationFrame(frame);
