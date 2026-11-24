// Vice Harbor — screenshot scenes behind ?shot=start|drive|chase|mission.
// Each one plays the real rules forward from a fresh world for a fixed
// number of steps, steered by simple scripted inputs, so the frame is what
// a short game really looks like and the same seed always gives the same
// frame. No scene reads the starter's old 2D world: input is the GTA
// contract { moveX, moveZ, steer, throttle } and staging uses world.debug
// (putPlayerInCar, setWanted, spawnPoliceNear, teleportPlayer).
import { STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createMissions } from './missions.js';

const START_SECONDS = 5;
const DRIVE_SECONDS = 6;
const CHASE_SECONDS = 6;
const MISSION_SECONDS = 4;

const IDLE = { moveX: 0, moveZ: 0, steer: 0, throttle: 0 };
const DRIVE = { moveX: 0, moveZ: 0, steer: 0, throttle: 0.8 };

function stepFor(world, seconds, inputOrFn) {
  const steps = Math.round(seconds / STEP);
  for (let index = 0; index < steps; index += 1) {
    const input = typeof inputOrFn === 'function' ? inputOrFn(index) : inputOrFn;
    world.step(STEP, input);
  }
}

/** Put the player in a car when the debug helper exists; fall back to standing by one. */
function ensureInCar(world) {
  const debug = world.debug || {};
  const state = world.state;
  if (state.player && !state.player.onFoot) return;
  if (typeof debug.putPlayerInCar === 'function') {
    debug.putPlayerInCar();
    if (state.player && !state.player.onFoot) return;
  }
  // Second chance: teleport onto the nearest car, then try again.
  const cars = state.cars || [];
  if (cars.length > 0 && typeof debug.teleportPlayer === 'function') {
    debug.teleportPlayer(cars[0].x, cars[0].z);
    if (typeof debug.putPlayerInCar === 'function') debug.putPlayerInCar();
  }
}

/**
 * Set `world` to the named scene (start, drive, chase or mission; any other
 * name is start) and return the screen to draw over it and the best score to
 * show (always 0: Vice Harbor scores in cash, not points).
 */
export function stageShot(name, world) {
  world.reset();
  const debug = world.debug || {};

  if (name === 'drive') {
    ensureInCar(world);
    stepFor(world, DRIVE_SECONDS, DRIVE);
    return { screen: SCREEN_PLAY, best: 0 };
  }

  if (name === 'chase') {
    ensureInCar(world);
    if (typeof debug.setWanted === 'function') debug.setWanted(3);
    else if (world.state) world.state.wanted = 3;
    if (typeof debug.spawnPoliceNear === 'function') debug.spawnPoliceNear(3);
    // Straight-line escape at full throttle: any steering drifts the car
    // off the road into a building, where it stalls (verified in testing).
    stepFor(world, CHASE_SECONDS, DRIVE);
    return { screen: SCREEN_PLAY, best: 0 };
  }

  if (name === 'mission') {
    // Let the world's own missions (if wired by main.js) activate first;
    // only drive a local instance when no mission appeared, so the job is
    // never advanced twice per step.
    stepFor(world, 0.5, IDLE);
    let missions = null;
    if (!world.state.mission) {
      missions = createMissions(world);
      missions.update(STEP);
    }
    const mission = world.state.mission;
    if (mission && mission.target && typeof debug.teleportPlayer === 'function') {
      debug.teleportPlayer(mission.target.x + 5, mission.target.z + 5);
    }
    // Walk toward the marker for a few seconds so the frame shows Mara on
    // foot closing in on the yellow objective. Movement input is relative
    // to the player's heading (moveZ forward, moveX strafe), so convert the
    // world-space direction into heading space first.
    const steps = Math.round(MISSION_SECONDS / STEP);
    for (let index = 0; index < steps; index += 1) {
      const target = world.state.mission && world.state.mission.target;
      const player = world.state.player;
      let input = IDLE;
      if (target && player) {
        const dx = target.x - player.x;
        const dz = target.z - player.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len;
        const uz = dz / len;
        const h = player.heading || 0;
        input = {
          moveX: ux * -Math.cos(h) + uz * Math.sin(h),
          moveZ: ux * Math.sin(h) + uz * Math.cos(h),
          steer: 0,
          throttle: 0,
        };
      }
      world.step(STEP, input);
      if (missions) missions.update(STEP);
    }
    return { screen: SCREEN_PLAY, best: 0 };
  }

  // start (and any unknown name): title screen over a living city.
  stepFor(world, START_SECONDS, IDLE);
  return { screen: SCREEN_TITLE, best: 0 };
}
