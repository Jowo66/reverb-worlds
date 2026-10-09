/**
 * settings.js — harmless user preferences with graceful storage fallback.
 *
 * Only presentation preferences (world, motion, intensity…) and a Spotify
 * *Client ID* (public, not a secret) are persisted. Playback state and OAuth
 * tokens are never written to localStorage.
 */

const STORAGE_KEY = 'reverb-worlds:settings:v1';

const prefersReducedMotion = (() => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
})();

export const DEFAULTS = Object.freeze({
  world: 'cyberpunk',
  motion: prefersReducedMotion ? 'reduced' : 'full', // 'full' | 'reduced' | 'static'
  intensity: 70,            // 0–100: strength of audio reactions & effects
  glitch: 50,               // 0–100: glitch/RGB/tear strength (Cyberpunk, Vaporwave, Glitch Art)
  reduceFlashing: false,    // caps flash brightness & rate across all worlds
  quality: 'auto',          // 'auto' | 'high' | 'low'
  backdrop: true,           // animated world backdrop on/off
  autoMorph: true,
  autoMorphTrigger: 'timer',// 'timer' | 'onsets' (onsets only when real audio data exists)
  autoMorphInterval: 12,    // seconds
  autoWorld: false,
  autoWorldInterval: 90,    // seconds
  vizInput: 'auto',         // 'auto' | 'ambient' | 'mic'
  volume: 0.8,
  muted: false,
  spotifyClientId: '',
});

const VALIDATORS = {
  motion: v => ['full', 'reduced', 'static'].includes(v),
  quality: v => ['auto', 'high', 'low'].includes(v),
  autoMorphTrigger: v => ['timer', 'onsets'].includes(v),
  vizInput: v => ['auto', 'ambient', 'mic'].includes(v),
  intensity: v => Number.isFinite(v) && v >= 0 && v <= 100,
  glitch: v => Number.isFinite(v) && v >= 0 && v <= 100,
  autoMorphInterval: v => Number.isFinite(v) && v >= 4 && v <= 120,
  autoWorldInterval: v => Number.isFinite(v) && v >= 15 && v <= 900,
  volume: v => Number.isFinite(v) && v >= 0 && v <= 1,
  spotifyClientId: v => typeof v === 'string' && /^[0-9a-zA-Z]{0,64}$/.test(v),
};

function safeRead() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function safeWrite(obj) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); return true; }
  catch { return false; }
}

class Settings extends EventTarget {
  constructor() {
    super();
    const stored = safeRead();
    this.values = { ...DEFAULTS };
    for (const [k, v] of Object.entries(stored)) {
      if (!(k in DEFAULTS)) continue;
      if (typeof v !== typeof DEFAULTS[k]) continue;
      if (VALIDATORS[k] && !VALIDATORS[k](v)) continue;
      this.values[k] = v;
    }
    this.persistent = safeWrite(this.values);
  }
  get(key) { return this.values[key]; }
  set(key, value) {
    if (!(key in DEFAULTS)) throw new Error(`Unknown setting ${key}`);
    if (VALIDATORS[key] && !VALIDATORS[key](value)) return false;
    if (this.values[key] === value) return true;
    this.values[key] = value;
    safeWrite(this.values);
    this.dispatchEvent(new CustomEvent('change', { detail: { key, value } }));
    return true;
  }
  reset() {
    const keep = this.values.spotifyClientId;
    this.values = { ...DEFAULTS, spotifyClientId: keep };
    safeWrite(this.values);
    for (const key of Object.keys(DEFAULTS)) {
      this.dispatchEvent(new CustomEvent('change', { detail: { key, value: this.values[key] } }));
    }
  }
  on(key, fn) {
    this.addEventListener('change', e => { if (e.detail.key === key) fn(e.detail.value); });
  }
}

export const settings = new Settings();
