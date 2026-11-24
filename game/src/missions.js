// missions.js — 6-mission story chain for Jay Carter in Coral Bay.
import { G } from './state.js';
import { addWanted } from './police.js';
import { sfx } from './audio.js';

export const MISSIONS = [
  {
    id: 1, title: 'First Wheels', reward: 150,
    brief: 'Mara needs a driver. Get to the marker and prove you can handle Coral Bay traffic.',
    steps: [{ type: 'goto', x: 140, z: 60, r: 9, text: 'Drive to the marker downtown' }],
  },
  {
    id: 2, title: 'Cab Fare', reward: 250,
    brief: 'A fare is waiting at the north docks. Pick them up, then drop them across town.',
    steps: [
      { type: 'pickup', x: -120, z: 140, r: 8, text: 'Pick up the passenger at the docks' },
      { type: 'deliver', x: 180, z: -140, r: 9, text: 'Deliver the passenger across town' },
    ],
  },
  {
    id: 3, title: 'Boost the Comet', reward: 400,
    brief: 'A Comet sport coupe is parked somewhere in the city. Steal one and bring it to the garage.',
    steps: [
      { type: 'steal', model: 'sport', text: 'Steal a Comet sport car' },
      { type: 'deliver', x: 60, z: 180, r: 9, text: 'Deliver the Comet to the garage' },
    ],
  },
  {
    id: 4, title: 'Heat', reward: 500,
    brief: 'Time to make a name. Draw the attention of the Coral Bay PD, then vanish.',
    steps: [
      { type: 'goto', x: 0, z: 0, r: 10, text: 'Get to Coral Plaza and draw heat (2 stars)' },
      { type: 'lose', stars: 0, text: 'Lose the cops!' },
    ],
  },
  {
    id: 5, title: 'Rooftop Rumble', reward: 600,
    brief: 'Rival crew cornered Mara on the east rooftops. Get there on foot and deal with all five.',
    steps: [
      { type: 'goto', x: -60, z: -120, r: 9, text: 'Get to the east rooftops on foot' },
      { type: 'defeat', count: 5, text: 'Defeat the 5 attackers' },
    ],
  },
  {
    id: 6, title: 'The Big One', reward: 1500,
    brief: 'The Coral Bay Reserve Bank. Grab the cash, outrun the response, and bring it to the hideout.',
    steps: [
      { type: 'drive', x: 200, z: 40, r: 9, text: 'Drive to the Reserve Bank' },
      { type: 'pickup', x: 200, z: 40, r: 7, text: 'Grab the cash from the vault' },
      { type: 'deliver', x: -200, z: 200, r: 9, text: 'Escape to the hideout' },
    ],
  },
];

let sceneRef = null, beacon = null, beaconRing = null;

export function setMissionScene(scene) {
  sceneRef = scene || sceneRef;
  if (sceneRef && !beacon) {
    beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 34, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    beaconRing = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.4, 24),
      new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
    );
    beaconRing.rotation.x = -Math.PI / 2;
    beacon.visible = false; beaconRing.visible = false;
    sceneRef.add(beacon); sceneRef.add(beaconRing);
  }
}

function stepMarker(step) {
  if (!step || step.x == null || step.z == null) return null;
  return { x: step.x, z: step.z };
}

function applyStep(m) {
  const step = MISSIONS.find((x) => x.id === m.id).steps[m.stepIndex];
  m.objective = step.text || step.type;
  m.marker = stepMarker(step);
  m.data.stepT = 0;
  m.data.killsStart = G.stats.kills;
  m.data.stolenStart = G.stats.carsStolen;
  m.data.heatReached = false;
  moveBeacon(m.marker);
}

export function startMission(id, scene) {
  if (scene) setMissionScene(scene);
  const def = MISSIONS.find((x) => x.id === id);
  if (!def) return;
  const m = {
    id: def.id, title: def.title, objective: '', stepIndex: 0,
    marker: null, data: { stepT: 0, killsStart: G.stats.kills, stolenStart: G.stats.carsStolen, heatReached: false },
  };
  G.mission = m;
  applyStep(m);
  G.flashToast = `Mission: ${def.title} — ${m.objective}`;
  sfx('mission');
}

function moveBeacon(marker) {
  if (!beacon) return;
  const on = !!marker;
  beacon.visible = on; beaconRing.visible = on;
  if (on) {
    beacon.position.set(marker.x, 17, marker.z);
    beaconRing.position.set(marker.x, 0.15, marker.z);
  }
}

export function missionMarkerPos() {
  if (G.mission && G.mission.marker) return { x: G.mission.marker.x, z: G.mission.marker.z };
  return null;
}

// Re-sync the beacon with the current mission marker (e.g. after shots.js overrides it).
export function refreshBeacon() { moveBeacon(G.mission ? G.mission.marker : null); }

function nearMarker(step) {
  const p = G.player.pos;
  const dx = p.x - step.x, dz = p.z - step.z;
  return dx * dx + dz * dz < step.r * step.r;
}

function advanceStep(m) {
  const def = MISSIONS.find((x) => x.id === m.id);
  sfx('pickup');
  m.stepIndex++;
  if (m.stepIndex >= def.steps.length) return completeMission(m, def);
  applyStep(m);
  G.flashToast = m.objective;
}

function completeMission(m, def) {
  G.cash += def.reward;
  G.stats.missionsDone++;
  G.flashToast = `Mission complete: ${def.title}  +$${def.reward.toLocaleString('en-US')}`;
  if (typeof window !== 'undefined' && window.__cashPop) window.__cashPop(def.reward);
  G.mission = null;
  moveBeacon(null);
  sfx('mission'); sfx('cash');
}

export function updateMissions(dt) {
  // Beacon pulse (cheap, runs even between missions when hidden it is skipped).
  if (beacon && beacon.visible) {
    const t = performance.now() * 0.003;
    beacon.material.opacity = 0.25 + Math.sin(t) * 0.12;
    beacon.rotation.y = t * 0.5;
    const s = 1 + Math.sin(t * 2) * 0.12;
    beaconRing.scale.set(s, s, 1);
  }
  const m = G.mission;
  if (!m || G.mode !== 'play') return;
  const def = MISSIONS.find((x) => x.id === m.id);
  if (!def) { G.mission = null; moveBeacon(null); return; }
  const step = def.steps[m.stepIndex];
  if (!step) { completeMission(m, def); return; }
  m.data.stepT += dt;

  switch (step.type) {
    case 'goto':
    case 'drive':
    case 'deliver':
      if (nearMarker(step)) advanceStep(m);
      break;
    case 'pickup':
      if (nearMarker(step)) {
        // The Big One: grabbing the vault cash trips the alarm — 3 stars.
        if (m.id === 6 && m.stepIndex === 1) addWanted(3);
        advanceStep(m);
      }
      break;
    case 'steal': {
      const v = G.player.vehicle;
      if (G.stats.carsStolen > m.data.stolenStart && v && v.model === step.model) advanceStep(m);
      else if (G.stats.carsStolen > m.data.stolenStart && !v) {
        // Stole the right car then got out: still counts — no soft-lock.
        advanceStep(m);
      }
      break;
    }
    case 'lose': {
      if (G.wanted >= 2) m.data.heatReached = true;
      if ((m.data.heatReached && G.wanted <= step.stars) || m.data.stepT > 120) advanceStep(m);
      break;
    }
    case 'defeat':
      if (G.stats.kills - m.data.killsStart >= step.count) advanceStep(m);
      break;
    default:
      advanceStep(m);
  }
}
