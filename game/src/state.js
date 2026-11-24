// Shared mutable game state: the single source of truth every module reads/writes.
export const G = {
  mode: 'menu', // menu | play | paused | busted | wasted | complete
  timeOfDay: 10,
  cash: 250,
  health: 100,
  wanted: 0,
  player: { pos: null, heading: 0, onFoot: true, speed: 0, vehicle: null },
  vehicles: [],
  peds: [],
  police: [],
  mission: null,
  stats: { kills: 0, carsStolen: 0, missionsDone: 0, busted: 0 },
  settings: { muted: false },
  seed: 1337,
  paused: false,
  camOrbit: 0,
  camDist: 9,
};

// Reset a run to its initial values. Settings and seed survive.
// World population (vehicles/peds/police) is owned by the scene, not the run:
// a restart repositions it (main.js) instead of dropping live objects.
// G.player.pos is NOT nulled: it is a live link to the player mesh / car
// position vector owned by player.js (hud.js also calls resetGame() from its
// own buttons and expects the game to keep running afterwards).
export function resetGame() {
  G.mode = 'menu';
  G.timeOfDay = 10;
  G.cash = 250;
  G.health = 100;
  G.wanted = 0;
  G.player.heading = 0;
  G.player.onFoot = true;
  G.player.speed = 0;
  G.player.vehicle = null;
  G.mission = null;
  G.stats.kills = 0;
  G.stats.carsStolen = 0;
  G.stats.missionsDone = 0;
  G.stats.busted = 0;
  G.paused = false;
  G.camOrbit = 0;
  G.camDist = 9;
}
