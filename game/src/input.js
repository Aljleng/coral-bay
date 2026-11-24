// Input — Vice Harbor / Port Meridian.
//
// Konvensi heading (dipakai semua sistem gameplay):
//   heading dalam radian, heading 0 = arah +Z, bertambah berlawanan jarum jam
//   dilihat dari atas. Vektor maju = (sin(heading), cos(heading)) di (x, z).
//   moveZ +1 = maju, moveX +1 = strafe ke kanan, steer +1 = belok kanan,
//   throttle +1 = gas, -1 = rem/mundur.
//
// createInput(canvas) mengembalikan objek dengan properti yang dibaca tiap
// frame (moveX, moveZ, steer, throttle, mouse) plus takeActions() yang
// mengembalikan bitmask aksi sekali-tekan dan mengosongkannya (dikonsumsi
// per frame, jadi satu tekanan tidak pernah terhitung dua kali).
// Tombol M tidak menghasilkan aksi: ia melempar CustomEvent
// 'viceharbor:toggle-mute' di window agar lapisan audio (main.js) yang
// menanganinya. Game ini tidak melakukan network request apa pun.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_INTERACT = 4;
export const ACTION_PUNCH = 8;
export const ACTION_SHOOT = 16;

const UP = new Set(['KeyW', 'ArrowUp']);
const DOWN = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const CONFIRM = new Set(['Enter', 'Space']);
const PAUSE = new Set(['Escape', 'KeyP']);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  const mouse = { x: 0, y: 0 };

  function onKeyDown(event) {
    if (
      UP.has(event.code) || DOWN.has(event.code) ||
      LEFT.has(event.code) || RIGHT.has(event.code) ||
      CONFIRM.has(event.code) || PAUSE.has(event.code) ||
      event.code === 'KeyE' || event.code === 'KeyF' || event.code === 'KeyM'
    ) {
      event.preventDefault();
    }
    if (event.repeat) return;
    if (UP.has(event.code) || DOWN.has(event.code) ||
        LEFT.has(event.code) || RIGHT.has(event.code)) {
      held.add(event.code);
      return;
    }
    if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM;
    else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
    else if (event.code === 'KeyE') actions |= ACTION_INTERACT;
    else if (event.code === 'KeyF') actions |= ACTION_PUNCH;
    else if (event.code === 'KeyM') {
      window.dispatchEvent(new CustomEvent('viceharbor:toggle-mute'));
    }
  }

  function onKeyUp(event) {
    held.delete(event.code);
  }

  function onBlur() {
    held.clear();
  }

  function onPointerMove(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
  }

  function onPointerDown(event) {
    onPointerMove(event);
    if (!event.repeat) actions |= ACTION_SHOOT;
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  // Mencegah menu konteks saat klik kanan dipakai menembak.
  canvas.addEventListener('contextmenu', onContextMenu);

  function has(codes) {
    for (const code of codes) if (held.has(code)) return true;
    return false;
  }

  return {
    /** -1 (kiri/A) .. +1 (kanan/D): strafe jalan kaki, relatif heading. */
    get moveX() {
      return (has(RIGHT) ? 1 : 0) - (has(LEFT) ? 1 : 0);
    },
    /** -1 (mundur/S) .. +1 (maju/W): gerak jalan kaki, relatif heading. */
    get moveZ() {
      return (has(UP) ? 1 : 0) - (has(DOWN) ? 1 : 0);
    },
    /** -1 (kiri) .. +1 (kanan): setir mobil. */
    get steer() {
      return (has(RIGHT) ? 1 : 0) - (has(LEFT) ? 1 : 0);
    },
    /** -1 (rem/mundur) .. +1 (gas): pedal mobil. */
    get throttle() {
      return (has(UP) ? 1 : 0) - (has(DOWN) ? 1 : 0);
    },
    /** Posisi pointer terakhir di dalam canvas (koordinat CSS). */
    mouse,
    /** Aksi sekali-tekan sejak pemanggilan terakhir, sebagai bitmask ACTION_*. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Lepas semua listener (dipakai saat input dibuat ulang / tes). */
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('contextmenu', onContextMenu);
      held.clear();
      actions = 0;
    },
  };
}
