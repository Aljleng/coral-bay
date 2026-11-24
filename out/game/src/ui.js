// Vice Harbor — HUD, minimap, menus and save/load (DOM only, no canvas game
// drawing here except the 2D minimap). createUI(world, audio) wires the
// elements index.html provides; every lookup is guarded, so the module also
// loads safely when an element is missing. DOM text is only rewritten when
// its value actually changes — never rebuilt per frame.

export const SAVE_KEY = 'viceharbor-save-v1';

const MINIMAP_SIZE = 180;

/** Read the save, or null when there is none / it is unreadable. */
export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      cash: Number.isFinite(data.cash) ? data.cash : 0,
      missionDone: typeof data.missionDone === 'string' ? data.missionDone : null,
      bestCash: Number.isFinite(data.bestCash) ? data.bestCash : 0,
      savedAt: Number.isFinite(data.savedAt) ? data.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Persist cash, last finished job and best cash. Returns false when storage is off. */
export function saveGame(state, bestCash) {
  try {
    const prev = loadSave();
    const cash = state.cash || 0;
    // missionDone is the last COMPLETED job only — never the active one, so
    // a save never claims a job the player has not finished yet.
    const data = {
      cash,
      missionDone: state.missionDone ?? (prev ? prev.missionDone : null),
      bestCash: Math.max(cash, bestCash || 0, state.bestCash || 0, prev ? prev.bestCash : 0),
      savedAt: Date.now(),
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function el(id) {
  return document.getElementById(id);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** City bounds for the minimap: city.bounds, else derived from roads, else a default. */
function cityBounds(city) {
  if (city && city.bounds) {
    const b = city.bounds;
    if (Number.isFinite(b.minX) && Number.isFinite(b.maxX) && Number.isFinite(b.minZ) && Number.isFinite(b.maxZ)) return b;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const roads = (city && city.roads) || [];
  for (const road of roads) {
    for (const p of roadPoints(road)) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
  }
  if (!Number.isFinite(minX)) return { minX: -400, maxX: 400, minZ: -400, maxZ: 400 };
  const pad = 20;
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

/** Police cars: kind 'police' and driver 'police' both mark them (either is enough). */
function isPolice(car) {
  return car && (car.kind === 'police' || car.driver === 'police');
}
function roadPoints(road) {
  if (!road) return [];
  if (Array.isArray(road)) return road.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z));
  if (Array.isArray(road.points)) return road.points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z));
  if (Array.isArray(road.path)) return road.path.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z));
  const pts = [];
  if (road.a && Number.isFinite(road.a.x)) pts.push(road.a);
  if (road.b && Number.isFinite(road.b.x)) pts.push(road.b);
  if (Number.isFinite(road.x1) && Number.isFinite(road.z1)) pts.push({ x: road.x1, z: road.z1 });
  if (Number.isFinite(road.x2) && Number.isFinite(road.z2)) pts.push({ x: road.x2, z: road.z2 });
  return pts;
}

/**
 * Draw the minimap: roads, mission marker (yellow), police (red/blue),
 * traffic (grey) and the player (white arrow). canvasEl is optional and
 * defaults to #minimap.
 */
export function drawMinimap(state, city, canvasEl) {
  const canvas = canvasEl || el('minimap');
  if (!canvas || !state) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = MINIMAP_SIZE;
  const b = cityBounds(city);
  const sx = (x) => ((x - b.minX) / (b.maxX - b.minX)) * size;
  const sz = (z) => ((z - b.minZ) / (b.maxZ - b.minZ)) * size;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#0d1020';
  ctx.fillRect(0, 0, size, size);

  const roads = (city && city.roads) || [];
  ctx.strokeStyle = '#3a4358';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const road of roads) {
    const pts = roadPoints(road);
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(sx(pts[0].x), sz(pts[0].z));
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(sx(pts[i].x), sz(pts[i].z));
    ctx.stroke();
  }

  // Traffic cars, then police on top so they stay visible.
  const cars = state.cars || [];
  for (const car of cars) {
    if (!car || isPolice(car)) continue;
    ctx.fillStyle = '#8b93a3';
    ctx.fillRect(sx(car.x) - 1.5, sz(car.z) - 1.5, 3, 3);
  }
  for (const car of cars) {
    if (!car || !isPolice(car)) continue;
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath();
    ctx.arc(sx(car.x), sz(car.z), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mission marker: a yellow diamond.
  const mission = state.mission;
  if (mission && mission.target && Number.isFinite(mission.target.x)) {
    const mx = sx(mission.target.x);
    const my = sz(mission.target.z);
    ctx.fillStyle = '#f2c94c';
    ctx.beginPath();
    ctx.moveTo(mx, my - 6);
    ctx.lineTo(mx + 6, my);
    ctx.lineTo(mx, my + 6);
    ctx.lineTo(mx - 6, my);
    ctx.closePath();
    ctx.fill();
  }

  // Player: a white arrow pointing along the heading.
  const player = state.player;
  if (player && Number.isFinite(player.x)) {
    const px = sx(player.x);
    const py = sz(player.z);
    const heading = player.heading || 0;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(heading);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
}

export function createUI(world, audio) {
  const hud = el('hud');
  const healthFill = el('health-fill');
  const cashEl = el('cash');
  const wantedEl = el('wanted');
  const clockEl = el('clock');
  const speedEl = el('speed');
  const muteEl = el('mute-indicator');
  const missionEl = el('mission');
  const messageEl = el('message');
  const statusEl = el('status');
  const titleMenu = el('menu-title');
  const pauseMenu = el('menu-pause');
  const overMenu = el('menu-over');
  const finalScoreEl = el('final-score');
  const continueEl = el('continue-line');

  const last = {
    health: -1,
    cash: '',
    wanted: -1,
    clock: '',
    speed: '',
    mission: '',
    screen: '',
    muted: null,
  };
  let messageTimer = 0;

  const save = loadSave();
  if (continueEl && save && save.cash > 0) {
    continueEl.hidden = false;
    continueEl.textContent = `Save found — $${save.cash} banked${save.missionDone ? `, last job: ${save.missionDone}` : ''}. Press Enter to play.`;
  }

  function setVisible(node, show) {
    if (node) node.hidden = !show;
  }

  /** Centre-screen toast + the screen-reader status line. */
  function showMessage(text, secs) {
    if (messageEl) {
      messageEl.textContent = text;
      messageEl.hidden = false;
    }
    if (statusEl) statusEl.textContent = text;
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => {
      if (messageEl) messageEl.hidden = true;
    }, (secs || 4) * 1000);
  }

  /** Refresh HUD, mission brief, minimap and menus. Call once per frame. */
  function update(state, screen) {
    if (!state) return;
    if (hud) hud.hidden = screen !== 'play' && screen !== 'paused';

    const health = Math.max(0, Math.min(100, Math.round(state.health ?? 100)));
    if (health !== last.health) {
      last.health = health;
      if (healthFill) {
        healthFill.style.width = `${health}%`;
        healthFill.style.background = health > 50 ? '#37d67a' : health > 25 ? '#f2c94c' : '#e5534b';
      }
    }

    const cashText = `$${Math.floor(state.cash || 0)}`;
    if (cashText !== last.cash) {
      last.cash = cashText;
      if (cashEl) cashEl.textContent = cashText;
    }

    const wanted = Math.max(0, Math.min(5, state.wanted || 0));
    if (wanted !== last.wanted) {
      last.wanted = wanted;
      if (wantedEl) {
        wantedEl.textContent = wanted > 0 ? '★'.repeat(wanted) : '☆☆☆☆☆';
        wantedEl.classList.toggle('hot', wanted > 0);
      }
    }

    const clockMin = state.clockMin ?? (state.time != null ? Math.floor(state.time / 60) : 0);
    const clockText = `${pad2(Math.floor(clockMin / 60) % 24)}:${pad2(Math.floor(clockMin) % 60)}`;
    if (clockText !== last.clock) {
      last.clock = clockText;
      if (clockEl) clockEl.textContent = clockText;
    }

    const player = state.player || {};
    const speedText = player.onFoot ? 'ON FOOT' : `${Math.round((player.speed || 0) * 3.6)} km/h`;
    if (speedText !== last.speed) {
      last.speed = speedText;
      if (speedEl) speedEl.textContent = speedText;
    }

    const muted = audio && typeof audio.isMuted === 'function' ? audio.isMuted() : false;
    if (muted !== last.muted) {
      last.muted = muted;
      if (muteEl) muteEl.hidden = !muted;
    }

    const missionText = state.mission
      ? `${state.mission.name} — ${state.mission.objective}`
      : 'Free roam — find Sal for work.';
    if (missionText !== last.mission) {
      last.mission = missionText;
      if (missionEl) missionEl.textContent = missionText;
    }

    if (screen !== last.screen) {
      last.screen = screen;
      setVisible(titleMenu, screen === 'title');
      setVisible(pauseMenu, screen === 'paused');
      setVisible(overMenu, screen === 'over');
      if (screen === 'over' && finalScoreEl) {
        const kind = state.gameOver === 'wasted' ? 'WASTED' : 'BUSTED';
        finalScoreEl.textContent = `Cash $${Math.floor(state.cash || 0)} — ${kind}. Press Enter to play again.`;
      }
    }

    drawMinimap(state, world ? world.city : null);
  }

  return { update, showMessage };
}
