// audio.js — WebAudio synth only. No files, no network. All calls safe before init.
import { G } from './state.js';

let ctx = null, master = null, engOsc = null, engGain = null, engFilter = null;
let sirenOsc = null, sirenGain = null, sirenLFO = null, sirenOn = false;
let musicTimer = null, musicStep = 0, muted = false;
let musicNodes = [];

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    // Engine: sawtooth through lowpass, gain follows speed.
    engOsc = ctx.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 50;
    engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 400;
    engGain = ctx.createGain(); engGain.gain.value = 0;
    engOsc.connect(engFilter); engFilter.connect(engGain); engGain.connect(master);
    engOsc.start();
    startMusic();
  } catch { ctx = null; }
}

function env(gainNode, t0, a, peak, d) {
  gainNode.gain.setValueAtTime(0.0001, t0);
  gainNode.gain.linearRampToValueAtTime(peak, t0 + a);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}

function blip(freq, dur, type, vol, when = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || 'square'; o.frequency.value = freq;
  env(g, t, 0.01, vol || 0.2, dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.1);
}

function noiseBurst(dur, vol, freq) {
  if (!ctx || !master) return;
  const t = ctx.currentTime, len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 1200;
  const g = ctx.createGain(); g.gain.value = vol || 0.4;
  src.connect(f); f.connect(g); g.connect(master); src.start(t);
}

export function engineSound(speed, on) {
  if (!ctx || !engOsc || !engGain) return;
  const target = on ? Math.min(0.12, 0.02 + Math.abs(speed) * 0.003) : 0;
  engGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
  engOsc.frequency.setTargetAtTime(45 + Math.abs(speed) * 4.5, ctx.currentTime, 0.1);
  engFilter.frequency.setTargetAtTime(300 + Math.abs(speed) * 30, ctx.currentTime, 0.1);
}

function sirenStart() {
  if (!ctx || !master || sirenOn) return;
  sirenOn = true;
  sirenOsc = ctx.createOscillator(); sirenOsc.type = 'triangle';
  sirenOsc.frequency.value = 700;
  sirenLFO = ctx.createOscillator(); sirenLFO.type = 'square'; sirenLFO.frequency.value = 0.6;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 180;
  sirenLFO.connect(lfoGain); lfoGain.connect(sirenOsc.frequency);
  sirenGain = ctx.createGain(); sirenGain.gain.value = 0.05;
  sirenOsc.connect(sirenGain); sirenGain.connect(master);
  sirenOsc.start(); sirenLFO.start();
}

function sirenStop() {
  if (!sirenOn) return;
  sirenOn = false;
  try { sirenOsc.stop(); sirenLFO.stop(); } catch { /* already stopped */ }
  sirenOsc = sirenLFO = sirenGain = null;
}

export function sfx(name) {
  if (!ctx || !master) return;
  if (name === 'shot') { noiseBurst(0.18, 0.5, 900); blip(90, 0.2, 'sine', 0.5); }
  else if (name === 'punch') { noiseBurst(0.1, 0.35, 500); blip(140, 0.08, 'sine', 0.3); }
  else if (name === 'pickup') { blip(660, 0.09, 'sine', 0.25); blip(990, 0.12, 'sine', 0.25, 0.08); }
  else if (name === 'busted') { blip(220, 0.3, 'sawtooth', 0.3); blip(165, 0.5, 'sawtooth', 0.3, 0.25); }
  else if (name === 'mission') { [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.16, 'triangle', 0.25, i * 0.11)); }
  else if (name === 'click') { blip(800, 0.05, 'square', 0.12); }
  else if (name === 'cash') { [880, 1109, 1319, 1760].forEach((f, i) => blip(f, 0.12, 'sine', 0.22, i * 0.07)); }
  else if (name === 'siren') { sirenStart(); }
}

// Quiet looping bass + pad: Am – F – C – G, one bar per chord, 8th-note bass.
const CHORDS = [[110, 220, 261.6, 329.6], [87.3, 174.6, 220, 261.6], [130.8, 196, 261.6, 329.6], [98, 196, 246.9, 293.7]];
const BASS = [55, 43.65, 65.4, 49];
export function startMusic() {
  if (!ctx || !master || musicTimer) return;
  musicTimer = setInterval(() => {
    if (!ctx || muted) { musicStep++; return; }
    const bar = Math.floor(musicStep / 8) % 4, beat = musicStep % 8;
    const t = ctx.currentTime;
    // Bass on beats 0, 3, 4, 6.
    if (beat === 0 || beat === 3 || beat === 4 || beat === 6) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = BASS[bar];
      env(g, t, 0.01, 0.16, 0.22);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.3);
      musicNodes.push(o);
    }
    // Pad at bar start.
    if (beat === 0) {
      CHORDS[bar].forEach((f) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.02, t + 0.4);
        g.gain.linearRampToValueAtTime(0.0001, t + 1.9);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 2);
        musicNodes.push(o);
      });
    }
    musicNodes = musicNodes.slice(-64);
    musicStep++;
  }, 240);
}

export function toggleMute() {
  muted = !muted;
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
  return muted;
}

export function updateAudio(dt) {
  if (!ctx) return;
  const p = G.player || {};
  const driving = p.vehicle && !p.onFoot;
  engineSound(driving ? (p.vehicle.speed || p.speed || 0) : 0, !!driving && G.mode === 'play');
  if (G.wanted > 0 && G.mode === 'play') sirenStart();
  else sirenStop();
}
