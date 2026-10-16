/**
 * demo-synth.js — "REVERB Originals": five short original tracks that are
 * synthesised in the browser (OfflineAudioContext → WAV blob URL).
 *
 * Why: the hologram needs a *legitimately analysable* audio source that works
 * out of the box on GitHub Pages without shipping copyrighted audio or large
 * files. These tracks are generated from code in this file, so they are
 * same-origin, licence-free and fully analysable by the Web Audio API.
 */
import { mulberry32 } from '../hologram/forms.js';

const hz = m => 440 * Math.pow(2, (m - 69) / 12);

export const DEMO_TRACKS = [
  { id: 'neon-rain', title: 'Neon Rain', artist: 'REVERB Originals', album: 'Worlds, Vol. 1', bpm: 100, bars: 24, style: 'synthwave', art: ['#ff3ec9', '#34dfff', '#070914'], chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]] },
  { id: 'gilded-hour', title: 'Gilded Hour', artist: 'REVERB Originals', album: 'Worlds, Vol. 1', bpm: 112, bars: 24, style: 'deco', art: ['#d9b36c', '#0a1d18', '#f3ead3'], chords: [[50, 53, 57, 60], [43, 47, 50, 53], [48, 52, 55, 59], [45, 49, 52, 55]] },
  { id: 'ochre-pulse', title: 'Ochre Pulse', artist: 'REVERB Originals', album: 'Worlds, Vol. 1', bpm: 90, bars: 22, style: 'tribal', art: ['#e0954a', '#c0533a', '#2a1a10'], scale: [64, 67, 69, 71, 74, 76, 79] },
  { id: 'tessellate', title: 'Tessellate', artist: 'REVERB Originals', album: 'Worlds, Vol. 1', bpm: 124, bars: 28, style: 'house', art: ['#33c9c4', '#f2a93b', '#0b1430'], chords: [[59, 62, 66], [55, 59, 62], [50, 54, 57], [57, 61, 64]] },
  { id: 'paper-tide', title: 'Paper Tide', artist: 'REVERB Originals', album: 'Worlds, Vol. 1', bpm: 78, bars: 20, style: 'ambient', art: ['#1f3a5f', '#b8322a', '#efe5cf'], scale: [62, 64, 66, 69, 71, 74, 76], chords: [[50, 54, 57], [47, 50, 54], [43, 47, 50], [45, 49, 52]] },
];

/** Bump when the synth or track definitions change: it keys the persistent audio cache. */
export const SYNTH_VERSION = 1;

export function trackDuration(def) { return def.bars * 4 * 60 / def.bpm + 2.5; }

/* ------------------------------------------------------------------ */
function noiseBuffer(ctx) {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
  const r = mulberry32(42);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return b;
}
function impulse(ctx, sec = 1.8, decay = 2.8) {
  const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate), r = mulberry32(9);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, decay); }
  return b;
}

function makeKit(ctx, out, rev, dly) {
  const noise = noiseBuffer(ctx);
  const env = (g, t, peak, a, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const send = (node, r = 0, d = 0) => { node.connect(out); if (r) { const g = ctx.createGain(); g.gain.value = r; node.connect(g); g.connect(rev); } if (d) { const g = ctx.createGain(); g.gain.value = d; node.connect(g); g.connect(dly); } };
  const noiseSrc = (t, dur) => { const s = ctx.createBufferSource(); s.buffer = noise; s.start(t, Math.random() * 0.5, dur + 0.05); return s; };
  return {
    kick(t, v = 1) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.13); env(g, t, 0.9 * v, 0.004, 0.38); o.connect(g); send(g); o.start(t); o.stop(t + 0.45); },
    snare(t, v = 1) { const s = noiseSrc(t, 0.25), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7; env(g, t, 0.45 * v, 0.002, 0.2); s.connect(f); f.connect(g); send(g, 0.25);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'triangle'; o.frequency.value = 190; env(og, t, 0.25 * v, 0.002, 0.09); o.connect(og); send(og); o.start(t); o.stop(t + 0.15); },
    clap(t, v = 1) { for (let k = 0; k < 3; k++) { const tt = t + k * 0.012, s = noiseSrc(tt, 0.2), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 1.2; env(g, tt, 0.35 * v, 0.001, k === 2 ? 0.18 : 0.02); s.connect(f); f.connect(g); send(g, 0.3); } },
    hat(t, open = false, v = 1) { const s = noiseSrc(t, open ? 0.3 : 0.06), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 7500; env(g, t, 0.16 * v, 0.001, open ? 0.22 : 0.045); s.connect(f); f.connect(g); send(g, 0.05); },
    shaker(t, v = 1) { const s = noiseSrc(t, 0.08), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 5200; env(g, t, 0.07 * v, 0.01, 0.05); s.connect(f); f.connect(g); send(g); },
    tom(t, f0, v = 1) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.3); env(g, t, 0.6 * v, 0.003, 0.42); o.connect(g); send(g, 0.2); o.start(t); o.stop(t + 0.5); },
    bass(t, m, dur, v = 1) { const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = hz(m); f.type = 'lowpass'; f.Q.value = 5; f.frequency.setValueAtTime(260, t); f.frequency.exponentialRampToValueAtTime(950, t + 0.02); f.frequency.exponentialRampToValueAtTime(280, t + Math.max(0.08, dur * 0.8)); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32 * v, t + 0.006); g.gain.setValueAtTime(0.32 * v, t + dur * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(f); f.connect(g); send(g); o.start(t); o.stop(t + dur + 0.02); },
    pad(t, notes, dur, v = 1) { const f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'lowpass'; f.frequency.value = 1300; f.Q.value = 0.5; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * v, t + Math.min(0.6, dur * 0.4)); g.gain.setValueAtTime(0.05 * v, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.5); f.connect(g); send(g, 0.5);
      for (const m of notes) for (const det of [-8, 8]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.6); } },
    lead(t, m, dur, v = 1, type = 'square') { const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = type; o.frequency.value = hz(m); f.type = 'lowpass'; f.frequency.value = 2600; env(g, t, 0.07 * v, 0.004, Math.max(0.08, dur)); o.connect(f); f.connect(g); send(g, 0.15, 0.35); o.start(t); o.stop(t + dur + 0.1); },
    pluck(t, m, v = 1) { const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = hz(m); o2.frequency.value = hz(m + 12); env(g, t, 0.16 * v, 0.003, 0.7); o.connect(g); o2.connect(g); send(g, 0.35, 0.3); o.start(t); o2.start(t); o.stop(t + 0.8); o2.stop(t + 0.8); },
    stab(t, notes, v = 1) { const f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'lowpass'; f.frequency.value = 1800; env(g, t, 0.06 * v, 0.004, 0.18); f.connect(g); send(g, 0.3); for (const m of notes) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz(m); o.connect(f); o.start(t); o.stop(t + 0.25); } },
  };
}

/** Render one demo track to an AudioBuffer (offline, faster than real-time). */
export async function renderTrack(def, sampleRate = 44100) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) throw new Error('OfflineAudioContext not supported');
  const dur = trackDuration(def);
  const ctx = new OAC(2, Math.ceil(dur * sampleRate), sampleRate);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
  const master = ctx.createGain(); master.gain.value = 0.9;
  master.connect(comp); comp.connect(ctx.destination);
  const rev = ctx.createConvolver(); rev.buffer = impulse(ctx); const revOut = ctx.createGain(); revOut.gain.value = 0.35; rev.connect(revOut); revOut.connect(master);
  const step = 60 / def.bpm / 4;
  const dly = ctx.createDelay(2); dly.delayTime.value = step * 3; const fb = ctx.createGain(); fb.gain.value = 0.35; const dOut = ctx.createGain(); dOut.gain.value = 0.5;
  dly.connect(fb); fb.connect(dly); dly.connect(dOut); dOut.connect(master);
  const K = makeKit(ctx, master, rev, dly);
  const rng = mulberry32(def.bpm * 31 + def.bars);
  const B = def.bars;
  const fadeOut = b => (b >= B - 2 ? 0.6 : 1);

  // Nodes are created bar-by-bar using offline suspend(): creating every note
  // up front keeps thousands of idle nodes in the graph and makes rendering
  // ~20× slower.
  const scheduleBar = b => {
    const bt = 0.05 + b * 16 * step;
    const chord = def.chords ? def.chords[b % def.chords.length] : null;
    const v = fadeOut(b);
    for (let s = 0; s < 16; s++) {
      const t = bt + s * step;
      switch (def.style) {
        case 'synthwave': {
          const drums = b >= 4 && !(b >= 16 && b < 18) && b < B - 1;
          if (drums && (s === 0 || s === 8)) K.kick(t, v);
          if (drums && (s === 4 || s === 12)) K.snare(t, v);
          if (b >= 2 && s % 2 === 0) K.hat(t, false, s % 4 === 2 ? 1 : 0.6);
          if (b >= 4 && b < B - 1 && s % 2 === 0) K.bass(t, chord[0] - 24 + (s % 4 === 2 ? 12 : 0), step * 1.8, v);
          if (b >= 8 && b < 20) { const n = chord[s % 3] + 12 + (s >= 8 ? 12 : 0); K.lead(t, n, step * 0.9, 0.9, 'square'); }
          break;
        }
        case 'deco': {
          const sw = s % 2 === 1 ? step * 0.33 : 0, tt = t + sw;
          const drums = b >= 2 && b < B - 1;
          if (drums && (s === 0 || s === 10)) K.kick(t, 0.85 * v);
          if (drums && (s === 4 || s === 12)) K.snare(t, 0.55 * v);
          if (b >= 1 && s % 2 === 0) K.hat(t + (s % 4 === 2 ? step * 0.33 : 0), false, 0.7);
          if (b >= 2 && b < B - 1 && s % 4 === 0) { const walk = [chord[0] - 12, chord[1] - 12, chord[2] - 12, chord[1] - 12 + 1][s / 4]; K.bass(t, walk - 12, step * 3.6, 0.9 * v); }
          if (b >= 4 && (s === 6 || s === 14)) K.stab(tt, chord.map(n => n + 12), v);
          if (b >= 8 && b < 20 && s % 2 === 0 && rng() < 0.45) K.lead(tt, chord[Math.floor(rng() * chord.length)] + 24, step * 1.5, 0.8, 'triangle');
          break;
        }
        case 'tribal': {
          const drums = b >= 2 && b < B - 1;
          if (s === 0 && b % 2 === 0) K.bass(t, 40, step * 31, 0.7 * v);
          if (drums && (s === 0 || s === 8)) K.kick(t, 0.9 * v);
          if (drums && [3, 6, 10, 13].includes(s)) K.tom(t, [180, 140, 120, 160][[3, 6, 10, 13].indexOf(s)], v);
          if (b >= 1) K.shaker(t, s % 4 === 0 ? 1.4 : 0.8);
          if (b >= 6 && b < 18 && s === 12) K.snare(t, 0.5);
          if (b >= 4 && b < B - 1 && s % 2 === 0 && rng() < 0.5) K.pluck(t, def.scale[Math.floor(rng() * def.scale.length)], v);
          break;
        }
        case 'house': {
          const drums = b >= 2 && !(b >= 16 && b < 20) && b < B - 1;
          if (drums && s % 4 === 0) K.kick(t, v);
          if (b >= 4 && drums && (s === 4 || s === 12)) K.clap(t, v);
          if (b >= 2 && s % 4 === 2) K.hat(t, true, 0.8);
          if (b >= 3 && s % 2 === 1) K.hat(t, false, 0.4);
          if (b >= 4 && b < B - 1 && s % 4 === 2) K.bass(t, chord[0] - 24, step * 1.6, v);
          if (s === 0) K.pad(t, chord.map(n => n - 12), step * 15.5, b >= 16 && b < 20 ? 1.4 : 0.9);
          if (b >= 8 && b < 24) { const seq = [0, 1, 2, 1]; K.lead(t, chord[seq[s % 4]] + 12 + (Math.floor(s / 4) % 2) * 12, step * 0.8, 0.75, 'sawtooth'); }
          break;
        }
        case 'ambient': {
          if (s === 0) K.pad(t, chord, step * 15.8, 1.1);
          if (b >= 4 && b < B - 2 && (s === 0 || s === 10)) K.kick(t, 0.55);
          if (b >= 4 && b < B - 2 && s === 8) K.snare(t, 0.3);
          if (b >= 2 && s % 8 === 0) K.bass(t, chord[0] - 12, step * 7.5, 0.6 * v);
          if (b >= 2 && s % 2 === 0 && rng() < 0.38) K.pluck(t, def.scale[Math.floor(rng() * def.scale.length)], 0.9 * v);
          if (b >= 6 && s % 4 === 1) K.hat(t, false, 0.35);
          break;
        }
        default: break;
      }
    }
    if (def.style === 'synthwave') K.pad(bt, chord.map(n => n - 12), step * 15.5, b < 4 ? 1.2 : 0.85);
  };
  scheduleBar(0);
  for (let b = 1; b < B; b++) {
    const at = Math.floor(Math.max(0.01, 0.05 + b * 16 * step - step * 2) * sampleRate / 128) * 128 / sampleRate;
    ctx.suspend(at).then(() => { scheduleBar(b); ctx.resume(); });
  }
  return ctx.startRendering();
}

/** 16-bit PCM WAV encoder. */
export function encodeWAV(buffer) {
  const ch = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true); data.setUint32(24, sr, true);
  data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([data], { type: 'audio/wav' });
}

/** Procedural cover art (no image assets). */
export function makeArtwork(def, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), [a, b, bg] = def.art, r = mulberry32(def.title.length * 97);
  x.fillStyle = bg; x.fillRect(0, 0, size, size);
  const g = x.createLinearGradient(0, 0, size, size); g.addColorStop(0, a); g.addColorStop(1, b);
  x.globalAlpha = 0.85; x.strokeStyle = g; x.lineWidth = size * 0.012;
  for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(size / 2, size / 2, size * (0.08 + i * 0.045), r() * 6, r() * 6 + 3 + r() * 3); x.stroke(); }
  x.fillStyle = g; x.globalAlpha = 0.9; x.beginPath(); x.arc(size / 2, size / 2, size * 0.06, 0, Math.PI * 2); x.fill();
  x.globalAlpha = 1; x.fillStyle = a; x.font = `700 ${Math.round(size * 0.07)}px system-ui, sans-serif`; x.fillText(def.title.toUpperCase(), size * 0.07, size * 0.92);
  return c.toDataURL('image/png');
}
