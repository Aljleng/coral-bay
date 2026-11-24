// Vice Harbor — mission chain for Mara Quinn.
//
// Three jobs from Sal Bianchi, played in order. The module only talks to the
// world through the shared contract: world.state (cash, wanted, player, cars,
// mission, message, gameOver, rng), world.city.randomRoadPoint(rng) for
// targets on a road, and world.step() advancing the simulation. It never
// draws, never touches the DOM and never plays sound itself — update()
// returns the EVENT_MISSION bit (2) when a stage is reached or a job is
// done, 0 otherwise, so main.js can trigger the matching sound / save.
//
// world.state.mission always mirrors the active job:
//   { id, name, stage, objective, target: { x, z } | null, timer }
// and world.state.message carries Sal's latest line.
//
// update() accepts either update(dt) (main.js) or update(state, dt) (the
// world.step missions hook) — both call shapes do the same thing.

export const EVENT_MISSION = 2;

const ARRIVE = 7; // metres (world units) that count as "reached the marker"

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.hypot(dx, dz);
}

/** A point on a road. Falls back to the given coords when the city has no helper yet. */
function roadPoint(world, fallback) {
  const city = world.city;
  if (city && typeof city.randomRoadPoint === 'function') {
    try {
      // randomRoadPoint takes the world's seeded rng; without it the call throws.
      const p = city.randomRoadPoint(world.state.rng || Math.random);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return { x: p.x, z: p.z };
    } catch {
      // A bad road helper must never break a mission: use the fallback.
    }
  }
  return { x: fallback.x, z: fallback.z };
}

/** The car the player is sitting in, as an id (player.car may be an object or an id). */
function playerCarId(player) {
  if (!player || player.onFoot || player.car == null) return null;
  return typeof player.car === 'object' ? player.car.id : player.car;
}

function nearestCar(state, wantSport) {
  const cars = state.cars || [];
  const player = state.player;
  let best = null;
  let bestD = Infinity;
  for (const car of cars) {
    if (!car || car.kind === 'police') continue;
    if (car.owned) continue; // Mara's own car is not a steal target.
    if (wantSport && car.kind !== 'sport') continue;
    // Parked cars are stealable; a moving one with a driver is a chase, not a job.
    if (car.driver) continue;
    const d = dist2(player.x, player.z, car.x, car.z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

const DEFS = [
  {
    id: 'delivery',
    name: 'First Delivery',
    reward: 150,
    brief: 'Pick up a package at the docks and drop it at the marina.',
    pickupLine: "Sal: Pick up the package at the docks. Don't keep the client waiting.",
    deliverLine: 'Sal: Package secured. Drop it at the marina — quick and quiet.',
    doneLine: "Sal: Delivery made. $150 — you're officially on the payroll, Mara.",
  },
  {
    id: 'hotwheels',
    name: 'Hot Wheels',
    reward: 300,
    brief: 'Boost a sports car, then lose the heat or reach the hideout.',
    stealLine: 'Sal: I need wheels. Boost that sports car — any color, no questions.',
    escapeLine: "Sal: Cops are on you! Lose the heat or get to the hideout.",
    doneLine: 'Sal: Sweet ride. $300. The boys will strip it by morning.',
  },
  {
    id: 'heist',
    name: 'Harbor Heist',
    reward: 800,
    brief: 'Grab the money bag at the harbor and run it to the hideout.',
    grabLine: "Sal: The money bag is at the harbor. Grab it and don't stop running.",
    escapeLine: 'Sal: You got the bag! Get to the hideout — the whole harbor is coming for you.',
    doneLine: "Sal: $800! The harbor job is ours. You're a legend, Mara.",
  },
];

export function createMissions(world) {
  const state = world.state;
  let index = 0; // which DEFS entry is active next
  let done = []; // ids of finished jobs, in order
  let active = null; // { def, stage, target, timer, hideout, targetCarId }

  function syncMission() {
    if (!active) {
      if (index >= DEFS.length) {
        state.mission = {
          id: 'done',
          name: 'Free Roam',
          stage: 'done',
          objective: 'All jobs done — free roam.',
          target: null,
          timer: 0,
        };
      } else {
        state.mission = null;
      }
      return;
    }
    const objective =
      active.def.id === 'delivery'
        ? active.stage === 'pickup'
          ? active.def.pickupLine
          : active.def.deliverLine
        : active.def.id === 'hotwheels'
          ? active.stage === 'steal'
            ? active.def.stealLine
            : active.def.escapeLine
          : active.stage === 'grab'
            ? active.def.grabLine
            : active.def.escapeLine;
    state.mission = {
      id: active.def.id,
      name: active.def.name,
      stage: active.stage,
      objective,
      target: active.target ? { x: active.target.x, z: active.target.z } : null,
      timer: active.timer,
    };
  }

  function startNext() {
    const def = DEFS[index];
    if (!def) return false;
    if (def.id === 'delivery') {
      active = {
        def,
        stage: 'pickup',
        target: roadPoint(world, { x: -180, z: 120 }),
        timer: 0,
        hideout: null,
        targetCarId: null,
      };
      state.message = def.pickupLine;
    } else if (def.id === 'hotwheels') {
      const car = nearestCar(state, true) || nearestCar(state, false);
      active = {
        def,
        stage: 'steal',
        target: car ? { x: car.x, z: car.z } : roadPoint(world, { x: 60, z: -40 }),
        timer: 0,
        hideout: roadPoint(world, { x: 200, z: 180 }),
        targetCarId: car ? car.id : null,
      };
      state.message = def.stealLine;
    } else {
      active = {
        def,
        stage: 'grab',
        target: roadPoint(world, { x: -180, z: -120 }),
        timer: 0,
        hideout: roadPoint(world, { x: 200, z: 180 }),
        targetCarId: null,
      };
      state.message = def.grabLine;
    }
    syncMission();
    return true;
  }

  function completeActive() {
    const def = active.def;
    state.cash = (state.cash || 0) + def.reward;
    done.push(def.id);
    state.missionDone = def.id;
    state.message = def.doneLine;
    active = null;
    index += 1;
    if (index >= DEFS.length) {
      state.message = 'All jobs done — free roam';
      syncMission();
      return EVENT_MISSION;
    }
    startNext();
    return EVENT_MISSION;
  }

  /**
   * Advance the active job by dt seconds. Safe to call every frame: it starts
   * the next job when none is active and does nothing once the chain is done
   * or the game is over. Returns EVENT_MISSION (2) when a stage is reached
   * or a job is done, 0 otherwise. Accepts update(dt) or update(state, dt).
   */
  function update(a, b) {
    const dt = b !== undefined ? b : a;
    if (state.gameOver) return 0;
    // The world was reset under us (time rewound below the mission timer):
    // drop the stale chain instead of resuming a job from a past life.
    if (active && state.time < active.timer - 0.001) {
      index = 0;
      done = [];
      active = null;
      syncMission();
    }
    if (!active) {
      if (index >= DEFS.length) return 0;
      startNext();
      return 0;
    }
    active.timer += dt;
    const player = state.player;
    const def = active.def;
    // A marker is easier to hit from a car than on foot.
    const arriveR = player.onFoot === false ? 10 : ARRIVE;

    if (def.id === 'delivery') {
      if (dist2(player.x, player.z, active.target.x, active.target.z) <= arriveR) {
        if (active.stage === 'pickup') {
          active.stage = 'deliver';
          active.target = roadPoint(world, { x: 150, z: -120 });
          state.message = def.deliverLine;
          syncMission();
          return EVENT_MISSION;
        }
        return completeActive();
      }
    } else if (def.id === 'hotwheels') {
      if (active.stage === 'steal') {
        // The target car may roll away or despawn: keep the marker glued to
        // it, and re-pick a stealable car when it is gone for good.
        const cars = state.cars || [];
        let targetCar = cars.find((c) => c && c.id === active.targetCarId);
        if (!targetCar) {
          targetCar = nearestCar(state, true) || nearestCar(state, false);
          if (targetCar) {
            active.targetCarId = targetCar.id;
            active.target = { x: targetCar.x, z: targetCar.z };
          }
        } else {
          active.target = { x: targetCar.x, z: targetCar.z };
        }
        const inCar = playerCarId(player);
        if (inCar !== null && (active.targetCarId === null || inCar === active.targetCarId)) {
          active.stage = 'escape';
          active.target = { ...active.hideout };
          state.wanted = Math.max(state.wanted || 0, 2);
          state.message = def.escapeLine;
          syncMission();
          return EVENT_MISSION;
        }
      } else if (state.wanted === 0 || dist2(player.x, player.z, active.target.x, active.target.z) <= arriveR) {
        return completeActive();
      }
    } else if (def.id === 'heist') {
      if (active.stage === 'grab') {
        if (dist2(player.x, player.z, active.target.x, active.target.z) <= arriveR) {
          active.stage = 'escape';
          active.target = { ...active.hideout };
          state.wanted = Math.max(state.wanted || 0, 3);
          state.message = def.escapeLine;
          syncMission();
          return EVENT_MISSION;
        }
      } else if (dist2(player.x, player.z, active.target.x, active.target.z) <= arriveR || state.wanted === 0) {
        return completeActive();
      }
    }
    syncMission();
    return 0;
  }

  function list() {
    return DEFS.map((def, i) => ({
      id: def.id,
      name: def.name,
      reward: def.reward,
      brief: def.brief,
      status: done.includes(def.id) ? 'done' : i === index ? 'active' : 'locked',
    }));
  }

  function current() {
    if (!active) return null;
    return {
      id: active.def.id,
      name: active.def.name,
      stage: active.stage,
      objective: state.mission ? state.mission.objective : '',
      target: active.target ? { x: active.target.x, z: active.target.z } : null,
      timer: active.timer,
      reward: active.def.reward,
    };
  }

  /** Skip ahead so a loaded save resumes at the first unfinished job. */
  function restore(completedCount) {
    const n = Math.max(0, Math.min(DEFS.length, completedCount || 0));
    done = DEFS.slice(0, n).map((d) => d.id);
    if (n > 0) state.missionDone = done[done.length - 1];
    index = n;
    active = null;
    syncMission();
  }

  /** Restore from a save object ({ missionDone }) — the last finished job's successor starts next. */
  function restoreSave(save) {
    if (!save || typeof save.missionDone !== 'string') return;
    const n = DEFS.findIndex((d) => d.id === save.missionDone);
    if (n >= 0) restore(n + 1);
  }

  /** Back to a fresh chain (call alongside world.reset() when starting over). */
  function reset() {
    index = 0;
    done = [];
    active = null;
    state.mission = null;
  }

  return { update, list, current, restore, restoreSave, reset };
}
