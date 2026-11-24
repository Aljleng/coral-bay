// Vice Harbor — boot and the one loop.
//
// The game moves between four screens: title, play, paused and game over. Input is read every
// frame, the world advances in fixed 1/60 s steps, missions and audio update alongside it, and
// the renderer paints what is there. ?shot=start|drive|chase|mission (with &seed=N) stages that
// scene instead of running the loop, paints it twice and sets window.__shotReady for a screenshot.
import { STEP } from './config.js';
import { createRandom } from './random.js';
import { createCity } from './city.js';
import { createWorld, EVENT_BUSTED, EVENT_MISSION, EVENT_WASTED } from './world.js';
import { ACTION_CONFIRM, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';
import { createMissions } from './missions.js';
import { createAudio } from './audio.js';
import { createUI, loadSave, saveGame } from './ui.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');

let world;
let renderer;
let missions;
let audio;
let ui;
let best = 0;
let save = null;
let resumed = false;

try {
  const rng = createRandom(seed);
  const city = createCity(rng);
  world = createWorld(rng, city);
  renderer = createRenderer(canvas, city);
  missions = createMissions(world);
  audio = createAudio();
  ui = createUI(world, audio);
  const loaded = loadSave();
  save = loaded;
  best = save && Number.isFinite(save.bestCash) ? save.bestCash : 0;
  if (save) {
    if (Number.isFinite(save.cash)) world.state.cash = save.cash;
    missions.restoreSave(save);
  }
  window.__game = { world, city, state: world.state };
  window.__gameReady = true;
} catch (error) {
  window.__gameError = String(error && error.message ? error.message : error);
  throw error;
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let muted = false;
  let accumulator = 0;
  let last = performance.now();

  // Screen readers (and anyone watching the page's text) hear the screen changes.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    // First start after boot with a save resumes it (cash + mission chain);
    // every later start (e.g. after game over) is a fresh run.
    const resume = save && !resumed;
    world.reset();
    if (resume) {
      resumed = true;
      if (Number.isFinite(save.cash)) world.state.cash = save.cash;
      missions.restoreSave(save);
    } else {
      missions.reset();
    }
    accumulator = 0;
    screen = SCREEN_PLAY;
    audio.ensure();
    announce('Playing. Mara Quinn, driver for hire in Port Meridian.');
  }

  function endGame(kind) {
    screen = SCREEN_OVER;
    if (world.state.cash > best) best = world.state.cash;
    saveGame(world.state, best);
    announce(kind === 'busted' ? `Busted. Cash $${world.state.cash}.` : `Wasted. Cash $${world.state.cash}.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_CONFIRM && (screen === SCREEN_TITLE || screen === SCREEN_OVER)) startGame();
    else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
  }

  function step() {
    if (screen === SCREEN_TITLE) return;
    let events = world.step(STEP, input);
    events |= missions.update(STEP);
    audio.update(world.state);
    if (events & EVENT_MISSION) {
      if (world.state.cash > best) best = world.state.cash;
      saveGame(world.state, best);
    }
    if (events & EVENT_BUSTED) endGame('busted');
    else if (events & EVENT_WASTED) endGame('wasted');
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_PLAY) {
      while (accumulator >= STEP && screen === SCREEN_PLAY) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen, best);
    ui.update(world.state, screen);
  }

  // M toggles sound without going through the input module's action bits.
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM') {
      muted = !muted;
      audio.setMuted(muted);
    }
  });

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Vice Harbor. Press Enter or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
