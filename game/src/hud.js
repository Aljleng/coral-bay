// hud.js — HUD text, minimap, screens, toasts, menu wiring. All DOM access guarded.
import { G, resetGame } from './state.js';
import { CFG } from './config.js';
import { MISSIONS, missionMarkerPos, startMission } from './missions.js';
import { toggleMute } from './audio.js';

let el = {};
let toastTimer = null;
let minimapCtx = null;

function $(id) { return document.getElementById(id) || null; }

export function initHUD() {
  el = {
    cash: $('cash'), healthFill: $('health-fill'), health: $('health'), stars: $('stars'),
    speed: $('speed'), clock: $('clock'), objective: $('objective'), toast: $('toast'),
    minimap: $('minimap'), hud: $('hud'), status: $('status'),
    menu: $('screen-menu'), pause: $('screen-pause'), busted: $('screen-busted'),
    wasted: $('screen-wasted'), complete: $('screen-complete'),
    btnNew: $('btn-new'), btnContinue: $('btn-continue'), btnMute: $('btn-mute'),
    btnResume: $('btn-resume'), btnRestart: $('btn-restart'), btnMenu: $('btn-menu'),
    btnBustedOk: $('btn-busted-ok'), btnWastedRetry: $('btn-wasted-retry'),
    btnCompleteAgain: $('btn-complete-again'),
  };
  if (el.minimap) minimapCtx = el.minimap.getContext('2d');
  if (typeof window !== 'undefined') window.__cashPop = showCashPop;

  const click = (btn, fn) => { if (btn) btn.addEventListener('click', () => { fn(); }); };
  click(el.btnNew, () => {
    resetGame(); G.mode = 'play'; showScreen('none');
    toast('Welcome to Coral Bay, Jay. Press M for missions.');
    announce('Playing.');
  });
  click(el.btnContinue, () => {
    let save = null;
    try { save = JSON.parse(window.localStorage.getItem('coralbay-save-v1') || 'null'); } catch { save = null; }
    if (!save) { toast('No save found yet — start a New Game.'); return; }
    try {
      if (typeof save.cash === 'number') G.cash = save.cash;
      if (typeof save.health === 'number') G.health = save.health;
      if (typeof save.timeOfDay === 'number') G.timeOfDay = save.timeOfDay;
      if (save.player && typeof save.player.x === 'number') { G.player.pos.x = save.player.x; G.player.pos.z = save.player.z; }
      if (save.stats) Object.assign(G.stats, save.stats);
    } catch { /* partial save: keep defaults */ }
    G.mode = 'play'; showScreen('none'); toast('Save loaded. Welcome back, Jay.');
    announce('Playing. Save loaded.');
  });
  click(el.btnResume, () => { G.paused = false; G.mode = 'play'; showScreen('none'); announce('Playing.'); });
  click(el.btnRestart, () => {
    if (G.mission) { startMission(G.mission.id); toast('Mission restarted.'); }
    else toast('No active mission — press M to start one.');
    G.paused = false; G.mode = 'play'; showScreen('none');
  });
  click(el.btnMenu, () => { G.mode = 'menu'; showScreen('menu'); });
  click(el.btnBustedOk, () => { G.mode = 'play'; showScreen('none'); announce('Playing.'); });
  click(el.btnWastedRetry, () => { resetGame(); G.mode = 'play'; showScreen('none'); announce('Playing.'); });
  click(el.btnCompleteAgain, () => { resetGame(); G.mode = 'play'; showScreen('none'); announce('Playing.'); });
  const muteFn = () => {
    const m = toggleMute();
    if (el.btnMute) el.btnMute.textContent = m ? 'Sound: Off' : 'Sound: On';
    toast(m ? 'Sound muted.' : 'Sound on.');
  };
  click(el.btnMute, muteFn);
}

function announce(msg) { if (el.status) el.status.textContent = msg; }

export function toast(msg) {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (el.toast) el.toast.style.opacity = '0'; }, 3600);
}

export function showCashPop(amount) {
  if (!el.hud) return;
  const d = document.createElement('div');
  d.className = 'cash-pop';
  d.textContent = `+$${Number(amount).toLocaleString('en-US')}`;
  d.style.cssText = 'position:absolute;right:24px;top:64px;color:#ffd94d;font-weight:700;font-size:20px;text-shadow:0 2px 4px #000;transition:all 1.2s ease-out;pointer-events:none;';
  el.hud.appendChild(d);
  requestAnimationFrame(() => { d.style.transform = 'translateY(-28px)'; d.style.opacity = '0'; });
  setTimeout(() => d.remove(), 1300);
}

function fmtCash(n) { return '$' + Math.floor(n).toLocaleString('en-US'); }

export function updateHUD() {
  if (el.cash) el.cash.textContent = fmtCash(G.cash);
  if (el.healthFill) {
    const h = Math.max(0, Math.min(100, G.health));
    el.healthFill.style.width = h + '%';
    el.healthFill.style.background = h > 50 ? '#4caf50' : h > 25 ? '#ff9800' : '#f44336';
  }
  if (el.stars) {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < G.wanted ? '★' : '☆';
    el.stars.textContent = s;
    el.stars.style.color = G.wanted > 0 ? '#ff5252' : '#ffffff';
  }
  if (el.speed) {
    const v = G.player.vehicle ? Math.abs(G.player.vehicle.speed || 0) : Math.abs(G.player.speed || 0);
    el.speed.textContent = Math.round(v * 3.6) + ' km/h';
  }
  if (el.clock) {
    const h = Math.floor(G.timeOfDay) % 24, m = Math.floor((G.timeOfDay % 1) * 60);
    el.clock.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  if (el.objective) {
    if (G.mission) el.objective.textContent = `${G.mission.title}: ${G.mission.objective}`;
    else el.objective.textContent = 'Free roam — press M for missions';
  }
  if (G.flashToast) { toast(G.flashToast); G.flashToast = null; }
  // Mission-complete line on the complete screen.
  if (G.stats.missionsDone >= MISSIONS.length && el.complete) {
    const line = el.complete.querySelector('p');
    if (line) line.textContent = `All ${MISSIONS.length} missions done. Coral Bay is yours, Jay.`;
  }
}

const SCREENS = { menu: 'menu', pause: 'pause', busted: 'busted', wasted: 'wasted', complete: 'complete' };

export function showScreen(name) {
  const map = { menu: el.menu, pause: el.pause, busted: el.busted, wasted: el.wasted, complete: el.complete };
  for (const k of Object.keys(map)) {
    if (map[k]) map[k].style.display = k === SCREENS[name] ? 'flex' : 'none';
  }
  if (el.hud) el.hud.style.display = name === 'none' || name === 'pause' ? 'block' : (name === 'menu' ? 'none' : 'block');
  const labels = { menu: 'Main menu.', pause: 'Paused.', busted: 'Busted by the police.', wasted: 'Wasted.', complete: 'Story complete.' };
  if (name !== 'none' && labels[name]) announce(labels[name]);
}

// Minimap: world ±252 maps onto the 200px canvas, north up.
export function drawMinimap() {
  if (!minimapCtx || !el.minimap) return;
  const c = minimapCtx, W = 200, H = 200;
  const half = ((CFG.GRID - 1) / 2) * (CFG.BLOCK + CFG.ROAD) + 28; // 252
  const toMap = (x, z) => [((x + half) / (2 * half)) * W, ((z + half) / (2 * half)) * H];
  c.clearRect(0, 0, W, H);
  c.fillStyle = 'rgba(10,14,20,0.85)'; c.fillRect(0, 0, W, H);
  // Roads: grey lines on the city grid.
  const pitch = CFG.BLOCK + CFG.ROAD, hc = ((CFG.GRID - 1) / 2) * pitch;
  c.strokeStyle = '#5a6270'; c.lineWidth = Math.max(2, (CFG.ROAD / (2 * half)) * W);
  for (let i = 0; i < CFG.GRID; i++) {
    const v = -hc + i * pitch;
    const [x1, y1] = toMap(v, -half), [x2, y2] = toMap(v, half);
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    const [x3, y3] = toMap(-half, v), [x4, y4] = toMap(half, v);
    c.beginPath(); c.moveTo(x3, y3); c.lineTo(x4, y4); c.stroke();
  }
  // Blocks: faint fill between roads.
  c.fillStyle = 'rgba(40,48,60,0.6)';
  for (let i = 0; i < CFG.GRID - 1; i++) {
    for (let j = 0; j < CFG.GRID - 1; j++) {
      const [x, y] = toMap(-hc + i * pitch + CFG.ROAD / 2, -hc + j * pitch + CFG.ROAD / 2);
      const s = (CFG.BLOCK / (2 * half)) * W;
      c.fillRect(x, y, s, s);
    }
  }
  const dot = (x, z, color, r) => {
    const [mx, my] = toMap(x, z);
    c.fillStyle = color; c.beginPath(); c.arc(mx, my, r, 0, Math.PI * 2); c.fill();
  };
  // Peds: faint dots.
  for (const p of G.peds) dot(p.pos.x, p.pos.z, 'rgba(200,200,200,0.5)', 1.2);
  // Traffic: yellow dots.
  for (const v of G.vehicles) {
    if (v.isPlayer) continue;
    dot(v.pos.x, v.pos.z, '#ffd94d', 2);
  }
  // Police: flashing red/blue.
  const flash = Math.floor(performance.now() / 350) % 2 === 0;
  for (const u of G.police) dot(u.pos.x, u.pos.z, flash ? '#ff2222' : '#2266ff', 3);
  // Mission marker: pulsing gold diamond.
  const mk = missionMarkerPos();
  if (mk) {
    const [mx, my] = toMap(mk.x, mk.z);
    const r = 5 + Math.sin(performance.now() * 0.006) * 2;
    c.fillStyle = '#ffc93c';
    c.beginPath(); c.moveTo(mx, my - r); c.lineTo(mx + r, my); c.lineTo(mx, my + r); c.lineTo(mx - r, my); c.closePath(); c.fill();
  }
  // Player: white arrow, rotated by heading (north up, heading 0 = +z = down on map).
  const [px, py] = toMap(G.player.pos.x, G.player.pos.z);
  c.save();
  c.translate(px, py); c.rotate(Math.PI - (G.player.heading || 0));
  c.fillStyle = '#ffffff';
  c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath(); c.fill();
  c.restore();
  // Border.
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1;
  c.strokeRect(0.5, 0.5, W - 1, H - 1);
}
