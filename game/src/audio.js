// Vice Harbor — synthesized sound, no audio files, no network.
//
// Everything is built with WebAudio oscillators and filtered noise, so the
// game ships zero audio assets. Nothing is created until ensure() runs, and
// ensure() must be called from a user gesture (first key / click) so the
// browser allows audio. Until then every method is a harmless no-op.

const MASTER_VOLUME = 0.5;
const ENGINE_BASE = 55; // Hz at a standstill
const ENGINE_SPAN = 165; // extra Hz at full speed
const SIREN_LOW = 700;
const SIREN_HIGH = 950;
const SIREN_FLIP_SECONDS = 0.42;

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let muted = false;
  let sirenHigh = false;
  let lastSirenFlip = 0;

  /** Create (or resume) the audio graph. Call from the first user gesture. */
  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_VOLUME;
      master.connect(ctx.destination);

      // Engine: a sawtooth through a lowpass, pitch follows speed.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = ENGINE_BASE;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 700;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();

      // Siren: a triangle that alternates between two notes while wanted > 0.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = SIREN_LOW;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  /** Engine pitch/volume for a 0..1 speed value. */
  function setEngine(speed01) {
    if (!ctx || !engineOsc || !engineGain) return;
    const s = clamp01(speed01);
    const now = ctx.currentTime;
    engineOsc.frequency.setTargetAtTime(ENGINE_BASE + s * ENGINE_SPAN, now, 0.08);
    engineGain.gain.setTargetAtTime(s <= 0.01 ? 0 : 0.015 + s * 0.05, now, 0.1);
  }

  function siren(on) {
    if (!ctx || !sirenGain) return;
    sirenGain.gain.setTargetAtTime(on ? 0.045 : 0, ctx.currentTime, 0.1);
  }

  function tone(freq, at, dur, type, vol) {
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    osc.type = type || 'square';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(vol || 0.12, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  /** Short filtered noise burst: a gunshot / backfire. */
  function shot() {
    if (!ctx || !master) return;
    try {
      const len = Math.floor(ctx.sampleRate * 0.16);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start();
    } catch {
      // A failed burst is silence, never a crash.
    }
  }

  /** One bright blip: pickup / marker reached. */
  function blip() {
    if (!ctx) return;
    tone(880, ctx.currentTime, 0.09, 'square', 0.1);
  }

  /** Rising four-note chime: a job is done. */
  function jingle() {
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      tone(freq, now + i * 0.11, 0.22, 'triangle', 0.14);
    });
  }

  /** Falling notes: busted / wasted. */
  function busted() {
    if (!ctx) return;
    const now = ctx.currentTime;
    [392, 311.13, 233.08].forEach((freq, i) => {
      tone(freq, now + i * 0.22, 0.3, 'sawtooth', 0.12);
    });
  }

  function setMuted(m) {
    muted = !!m;
    if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.05);
  }

  function isMuted() {
    return muted;
  }

  /**
   * Per-frame hook: engine follows the player's speed, siren follows the
   * wanted level. state is world.state (player.speed, wanted).
   */
  function update(state) {
    if (!ctx || !state) return;
    const player = state.player || {};
    const speed01 =
      typeof player.speed01 === 'number'
        ? player.speed01
        : clamp01((player.speed || 0) / 26); // MAX_SPEED is 26 units/s (~94 km/h)
    setEngine(player.onFoot ? 0 : speed01);
    const wanted = state.wanted || 0;
    if (wanted > 0) {
      siren(true);
      const now = ctx.currentTime;
      if (now - lastSirenFlip >= SIREN_FLIP_SECONDS) {
        lastSirenFlip = now;
        sirenHigh = !sirenHigh;
        if (sirenOsc) sirenOsc.frequency.setTargetAtTime(sirenHigh ? SIREN_HIGH : SIREN_LOW, now, 0.05);
      }
    } else {
      siren(false);
    }
  }

  return { ensure, setEngine, siren, shot, blip, jingle, busted, setMuted, isMuted, update };
}
