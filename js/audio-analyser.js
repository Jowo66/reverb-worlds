/**
 * audio-analyser.js — the visualizer's input layer.
 *
 * The hologram asks one question per frame: getFeatures() → {bass, mid,
 * high, energy, kick, snare}. Two kinds of source can answer:
 *
 *   AudioAnalyser  — genuine Web Audio analysis of audio the browser is
 *                    allowed to inspect: the built-in REVERB player (demo
 *                    synth + your local files, same-origin blob URLs) or a
 *                    microphone the user explicitly enables.
 *   AmbientSource  — a synthetic, smoothly varying signal used whenever no
 *                    analysable audio exists (e.g. while a Spotify embed or
 *                    the Spotify SDK is playing — their audio is cross-origin
 *                    / DRM-protected and cannot be analysed).
 *
 * kick / snare are *approximate onsets* from adaptive spectral-flux
 * thresholds — not precise beat tracking. The UI labels it accordingly.
 */

const BANDS = { bass: [25, 160], mid: [160, 2200], high: [2200, 12000], snare: [1500, 6000] };

export class AudioAnalyser {
  constructor() {
    this.ctx = null;
    this.mediaAnalyser = null;
    this.micAnalyser = null;
    this.gain = null;
    this.mediaSources = new WeakMap();
    this.mic = null;
    this.input = 'media'; // 'media' | 'mic'
    this.state = this._freshState();
  }

  _freshState() {
    return { bass: 0, mid: 0, high: 0, energy: 0, peak: { bass: 0.2, mid: 0.2, high: 0.2 }, prevBass: 0, prevSn: 0, fluxB: [], fluxS: [], lastKick: 0, lastSnare: 0, kick: false, snare: false };
  }

  /** Must be called from a user gesture the first time (autoplay policy). */
  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
      this.mediaAnalyser = this._makeAnalyser();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  _makeAnalyser() {
    const a = this.ctx.createAnalyser();
    a.fftSize = 2048;
    a.smoothingTimeConstant = 0.55;
    a.minDecibels = -90; a.maxDecibels = -15;
    a.buf = new Uint8Array(a.frequencyBinCount);
    return a;
  }

  /**
   * Route a same-origin <audio> element through the analyser.
   * element → source → analyser (tap)
   *                  → gain(volume) → speakers
   * The element itself stays at volume 1 so analysis is independent of the
   * user's volume. Returns the GainNode used for volume, or null on failure.
   */
  attachMediaElement(el) {
    if (!this.ensureContext()) return null;
    if (this.mediaSources.has(el)) return this.gain;
    try {
      const src = this.ctx.createMediaElementSource(el);
      src.connect(this.mediaAnalyser);
      src.connect(this.gain);
      this.mediaSources.set(el, src);
      return this.gain;
    } catch (err) {
      console.warn('[REVERB] Could not attach media element to analyser', err);
      return null;
    }
  }

  /** Route an external live stream (microphone or captured tab audio) into its own analyser. */
  _attachStream(stream, kind) {
    this.disableExternal();
    const src = this.ctx.createMediaStreamSource(stream);
    this.micAnalyser = this._makeAnalyser();
    src.connect(this.micAnalyser); // never to destination — no feedback / double audio
    this.mic = { stream, src, kind };
    this.state = this._freshState();
    // If the user stops sharing from the browser UI, drop back cleanly.
    stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (this.mic?.stream === stream) { this.disableExternal(); this.onExternalEnded?.(kind); } }));
  }

  async enableMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone input is not supported in this browser.');
    if (!this.ensureContext()) throw new Error('Web Audio is not supported in this browser.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    this._attachStream(stream, 'mic');
  }

  /**
   * Capture this tab's own audio (Chrome / Edge: the user picks “This tab” and
   * keeps “Share tab audio” on). Whether DRM-protected Spotify audio comes
   * through is up to the browser — callers check for silence and say so.
   */
  async enableTabCapture() {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Tab audio capture is not supported in this browser (try Chrome or Edge on desktop).');
    if (!this.ensureContext()) throw new Error('Web Audio is not supported in this browser.');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, // required by browsers; the video track is stopped immediately
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'include',
    });
    stream.getVideoTracks().forEach(t => t.stop());
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error('No audio was shared. Choose “This tab” and keep “Also share tab audio” switched on.');
    }
    this._attachStream(stream, 'tab');
  }

  disableExternal() {
    if (!this.mic) return;
    this.mic.stream.getTracks().forEach(t => t.stop());
    try { this.mic.src.disconnect(); } catch {}
    this.mic = null;
    this.micAnalyser = null;
  }
  disableMicrophone() { this.disableExternal(); }

  /** 'mic' | 'tab' | null */
  get externalKind() { return this.mic?.kind || null; }
  get micEnabled() { return this.mic?.kind === 'mic'; }

  /** Raw (un-normalised) level 0..1 of the external stream — used to detect silent captures. */
  rawLevel() {
    const an = this.micAnalyser;
    if (!an) return 0;
    an.getByteFrequencyData(an.buf);
    let s = 0; for (let i = 0; i < an.buf.length; i++) s += an.buf[i];
    return s / (an.buf.length * 255);
  }

  setInput(input) {
    if (input !== this.input) { this.input = input; this.state = this._freshState(); }
  }

  _bandLevel(an, [lo, hi]) {
    const nyq = this.ctx.sampleRate / 2, n = an.frequencyBinCount;
    const a = Math.max(0, Math.floor(lo / nyq * n)), b = Math.min(n - 1, Math.ceil(hi / nyq * n));
    let s = 0;
    for (let i = a; i <= b; i++) s += an.buf[i];
    return s / ((b - a + 1) * 255);
  }

  /** Called once per animation frame by the engine via getFeatures(). */
  read(nowMs) {
    const an = this.input === 'ext' ? this.micAnalyser : this.mediaAnalyser;
    const st = this.state;
    if (!this.ctx || !an) return { bass: 0, mid: 0, high: 0, energy: 0, kick: false, snare: false, real: false };
    an.getByteFrequencyData(an.buf);
    const raw = { bass: this._bandLevel(an, BANDS.bass), mid: this._bandLevel(an, BANDS.mid), high: this._bandLevel(an, BANDS.high) };
    const sn = this._bandLevel(an, BANDS.snare);
    // automatic gain: normalise each band to a slowly decaying peak
    for (const k of ['bass', 'mid', 'high']) {
      st.peak[k] = Math.max(raw[k], st.peak[k] * 0.996, 0.08);
      st[k] = Math.min(1, raw[k] / st.peak[k]);
    }
    st.energy = st.bass * 0.45 + st.mid * 0.35 + st.high * 0.2;

    // onset detection: positive flux vs adaptive threshold (mean + k·σ over ~1s), with cooldowns
    const fluxB = Math.max(0, raw.bass - st.prevBass), fluxS = Math.max(0, sn - st.prevSn);
    st.prevBass = raw.bass; st.prevSn = sn;
    const kick = this._onset(st.fluxB, fluxB, 1.6, nowMs - st.lastKick > 140 && raw.bass > 0.25);
    const snare = this._onset(st.fluxS, fluxS, 1.9, nowMs - st.lastSnare > 160 && sn > 0.12);
    if (kick) st.lastKick = nowMs;
    if (snare) st.lastSnare = nowMs;
    return { bass: st.bass, mid: st.mid, high: st.high, energy: st.energy, kick, snare, real: true };
  }

  _onset(hist, v, k, gate) {
    hist.push(v); if (hist.length > 50) hist.shift();
    if (hist.length < 12) return false;
    const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
    const sd = Math.sqrt(hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length);
    return gate && v > mean + k * sd && v > 0.015;
  }
}

/**
 * AmbientSource — an honest, synthetic signal. It is NOT derived from any
 * audio; it simply gives the hologram gentle "beat-inspired" movement.
 */
export class AmbientSource {
  constructor() { this.t = 0; this.nextKick = 0.8; this.nextSnare = 1.6; this.rng = Math.random; this.bpm = 0; this.anchor = 0; this.lastBeat = -1; }

  /** Lock pulses to a tapped tempo: beats fall exactly on anchorMs + n·(60000/bpm). */
  setTempo(bpm, anchorMs) { this.bpm = bpm; this.anchor = anchorMs; this.lastBeat = Math.floor((performance.now() - anchorMs) / (60000 / bpm)); }
  clearTempo() { this.bpm = 0; }

  read(dt) {
    this.t += dt;
    if (this.bpm) {
      const period = 60000 / this.bpm, x = (performance.now() - this.anchor) / period;
      const beat = Math.floor(x), ph = x - beat;
      const kick = beat > this.lastBeat;
      const snare = kick && ((beat % 2) + 2) % 2 === 1; // backbeat on 2 and 4
      if (kick) this.lastBeat = beat;
      const env = Math.exp(-ph * 5);
      return { bass: 0.2 + 0.75 * env, mid: 0.3 + 0.3 * env, high: 0.25 + 0.3 * Math.exp(-((x * 2) % 1) * 6), energy: 0.3 + 0.5 * env, kick, snare, real: false };
    }
    const t = this.t;
    const kick = t >= this.nextKick, snare = t >= this.nextSnare;
    if (kick) this.nextKick = t + 1.15 + this.rng() * 0.9;
    if (snare) this.nextSnare = t + 2.3 + this.rng() * 1.6;
    const breathe = 0.5 + 0.5 * Math.sin(t * 0.6);
    return {
      bass: 0.25 + 0.2 * breathe,
      mid: 0.3 + 0.15 * Math.sin(t * 0.37 + 1),
      high: 0.2 + 0.15 * (0.5 + 0.5 * Math.sin(t * 1.3)),
      energy: 0.3 + 0.15 * breathe,
      kick, snare, real: false,
    };
  }
}
