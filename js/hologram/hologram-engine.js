/**
 * hologram-engine.js — one reusable, theme-agnostic visualizer.
 *
 * Pipeline per frame:
 *   features (audio-reactive or ambient)  →  smoothing + transient reactions
 *   morph state (from-form → to-form, per-point staggered progress)
 *   3D transform (rotation, pulse, compress, lift)  →  projection
 *   draw: halo → fills → lines (glow/core/leaded) → points → overlays
 *         → effects (rings, flashes, rays…) → particles → band post-effects
 *
 * Everything a world needs is data in theme.hologram (see theme-registry.js):
 * material, motion, transition, reactions, particles. The engine never knows
 * which world is active beyond those descriptors.
 */
import { buildForm, formLabel, mulberry32 } from './forms.js';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const EASE = {
  linear: t => t,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  inOutQuart: t => (t < 0.5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2),
  outQuad: t => 1 - (1 - t) * (1 - t),
};

/** Quality tiers: point count, particle cap, device-pixel-ratio cap. */
const QUALITY = {
  high: { N: 720, particles: 170, dpr: 2 },
  medium: { N: 520, particles: 110, dpr: 1.5 },
  low: { N: 320, particles: 50, dpr: 1 },
};

/**
 * Transition styles. delay(x,y,z,i,n,r) → 0..1 stagger; `spread` is how much
 * of the morph duration is used for staggering. Optional mid-flight effects:
 * scatter (random offset), explode (outward), steps (frame-skip quantisation),
 * quantize (pixel grid), dim (fade to shadow), defocus, crossfade.
 */
const TRANSITIONS = {
  'scan-wipe': { delay: (x, y) => 1 - (y + 1) / 2, spread: 0.55, ease: 'outCubic', scatter: 0.22, scanline: true },
  'iris': { delay: (x, y) => clamp(Math.hypot(x, y)), spread: 0.55, ease: 'inOutCubic' },
  'stroke-redraw': { delay: (x, y, z, i, n) => i / n, spread: 0.7, ease: 'inOutSine', scatter: 0.05 },
  'tile-reassemble': { delay: (x, y, z, i, n, r) => r, spread: 0.5, ease: 'inOutCubic', explode: 0.55 },
  'brush-reveal': { delay: x => (x + 1) / 2, spread: 0.6, ease: 'inOutSine' },
  'emerge': { delay: (x, y, z, i, n, r) => r * 0.3, spread: 0.25, ease: 'inOutSine', dim: true },
  'spray': { delay: (x, y, z, i, n, r) => r, spread: 0.6, ease: 'outQuad', scatter: 0.4 },
  'lowpoly-scan': { delay: (x, y) => 1 - (y + 1) / 2, spread: 0.5, ease: 'inOutCubic', steps: 7 },
  'slab': { delay: x => Math.floor(clamp((x + 1) / 2, 0, 0.999) * 4) / 4, spread: 0.55, ease: 'inOutQuart' },
  'lead-assemble': { delay: (x, y) => (Math.atan2(y, x) + Math.PI) / TAU, spread: 0.6, ease: 'inOutCubic' },
  'crossfade': { crossfade: true, ease: 'inOutSine' },
  'focus-pull': { delay: () => 0, spread: 0, ease: 'inOutCubic', defocus: true },
  'bubble-float': { delay: (x, y, z, i, n, r) => (1 - (y + 1) / 2) * 0.6 + r * 0.4, spread: 0.6, ease: 'inOutSine', float: 0.35 },
  'pixel-dissolve': { delay: (x, y, z, i) => (i * 0.618034) % 1, spread: 0.9, ease: 'linear', snap: true },
  'pixel-sort': { delay: (x, y, z, i, n, r) => Math.floor(clamp((x + 1) / 2, 0, 0.999) * 10) / 10 * 0.8 + r * 0.2, spread: 0.55, ease: 'inOutCubic', quantize: 0.12, sort: true },
};

/* Flash-type reactions honour the reduce-flashing setting. */
const FLASHY = new Set(['flash']);

export class HologramEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ getFeatures: () => object, onForm?: (info) => void, onQualityChange?: (q) => void, onOnset?: (kind) => void }} hooks
   */
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.hooks = hooks;
    this.opts = { motion: 'full', intensity: 0.7, glitch: 0.5, reduceFlashing: false, quality: 'auto' };
    this.qualityTier = this._initialTier();
    this.N = QUALITY[this.qualityTier].N;
    this.theme = null;
    this.running = false;
    this.time = 0;
    this.last = 0;
    this.rotY = 0; this.rotYTarget = 0; this.hardTimer = 0;
    this.env = { pulse: 0, lift: 0, compress: 0, light: 0, drift: 0, rgb: 0, mirror: 0, tear: 0, cut: 0, ray: -1, displace: 0, edge: 0, focus: -1, k: 0, s: 0, jit: 0 };
    this.smooth = { bass: 0, mid: 0, high: 0, energy: 0 };
    this.effects = [];
    this.lastFlash = 0;
    this.recent = [];
    this.seed = 1;
    this.frameTimes = [];
    this.particles = this._allocParticles(QUALITY.high.particles);
    this._alloc();
    this._resizeObs = new ResizeObserver(() => this.resize());
    this._resizeObs.observe(canvas);
    this.resize();
    this._loop = this._loop.bind(this);
    // User rotation (grab & rotate). Added on top of the automatic motion.
    this.user = { rx: 0, ry: 0, vx: 0, vy: 0, dragging: false, lastX: 0, lastY: 0, lastT: 0, id: null };
    this._bindPointer();
  }

  /* grab & rotate */
  _bindPointer() {
    const c = this.canvas, u = this.user;
    c.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      u.dragging = true; u.id = e.pointerId; u.lastX = e.clientX; u.lastY = e.clientY; u.lastT = performance.now(); u.vx = u.vy = 0;
      try { c.setPointerCapture(e.pointerId); } catch {}
      c.classList.add('grabbing');
      e.preventDefault();
    });
    c.addEventListener('pointermove', e => {
      if (!u.dragging || e.pointerId !== u.id) return;
      const now = performance.now(), dt = Math.max(1, now - u.lastT) / 1000;
      const rect = c.getBoundingClientRect(), k = Math.PI / Math.max(200, Math.min(rect.width, rect.height) * 0.9);
      const dRy = (e.clientX - u.lastX) * k, dRx = (e.clientY - u.lastY) * k;
      u.ry += dRy; u.rx = clamp(u.rx + dRx, -1.35, 1.35);
      u.vy = dRy / dt; u.vx = dRx / dt;
      u.lastX = e.clientX; u.lastY = e.clientY; u.lastT = now;
      if (!this.running) this.renderOnce();
    });
    const end = e => {
      if (!u.dragging || (e && e.pointerId !== u.id)) return;
      u.dragging = false; c.classList.remove('grabbing');
      if (performance.now() - u.lastT > 80) u.vx = u.vy = 0; // released without flick
      if (this.opts.motion !== 'full') u.vx = u.vy = 0;          // no inertia in reduced/static motion
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);
    c.addEventListener('dblclick', () => this.resetView());
    c.addEventListener('keydown', e => {
      const step = 0.12, map = { ArrowLeft: [0, -step], ArrowRight: [0, step], ArrowUp: [-step, 0], ArrowDown: [step, 0] };
      if (map[e.key]) { u.rx = clamp(u.rx + map[e.key][0], -1.35, 1.35); u.ry += map[e.key][1]; u.vx = u.vy = 0; }
      else if (e.key === 'Home' || e.key === '0') this.resetView();
      else return;
      e.preventDefault(); e.stopPropagation();
      if (!this.running) this.renderOnce();
    });
  }

  /** Return to the world's default viewing angle. */
  resetView() { Object.assign(this.user, { rx: 0, ry: 0, vx: 0, vy: 0 }); if (!this.running) this.renderOnce(); }

  _initialTier() {
    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    const cores = navigator.hardwareConcurrency || 4;
    if (small || cores <= 2) return 'low';
    if (cores <= 4) return 'medium';
    return 'high';
  }

  _alloc() {
    const N = this.N;
    this.cur = new Float32Array(N * 3);
    this.sx = new Float32Array(N); this.sy = new Float32Array(N); this.sz = new Float32Array(N);
    this.sx2 = new Float32Array(N); this.sy2 = new Float32Array(N); this.sz2 = new Float32Array(N);
    this.delays = new Float32Array(N);
    this.prog = new Float32Array(N);
    const r = mulberry32(99);
    this.rand = new Float32Array(N); for (let i = 0; i < N; i++) this.rand[i] = r();
    this.rand2 = new Float32Array(N); for (let i = 0; i < N; i++) this.rand2[i] = r();
  }

  _allocParticles(n) {
    return { n, x: new Float32Array(n), y: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n), life: new Float32Array(n), max: new Float32Array(n), size: new Float32Array(n), col: new Uint8Array(n), kind: new Uint8Array(n), alive: 0, acc: 0 };
  }

  /* Public API                                                        */
  setOptions(o) {
    const qualityChanged = 'quality' in o && o.quality !== this._lastQuality;
    Object.assign(this.opts, o);
    if (qualityChanged) {
      this._lastQuality = o.quality;
      this._setTier(o.quality === 'auto' ? this._initialTier() : o.quality === 'high' ? 'high' : 'low');
    }
    if (!this.running) this.renderOnce();
  }

  setTheme(theme) {
    const first = !this.theme;
    this.theme = theme;
    const h = theme.hologram;
    this.mat = h.material;
    this.transitionName = h.transition;
    this.pool = h.forms;
    this.tiltNow = h.motion.tilt || 0;
    this.recent = [];
    this.effects.length = 0;
    this.particles.alive = 0;
    for (let i = 0; i < this.particles.n; i++) this.particles.life[i] = 0;
    // Cross-world morph: from whatever is on screen into a form of the new world
    // (or the form asked for while this world's pack was still loading).
    const wanted = this.wanted && h.forms.includes(this.wanted) ? this.wanted : null;
    this.wanted = null;
    this.morph(wanted, { instant: first });
  }

  /** Morph to a specific form id or a random one from the pool (no immediate repeats). */
  morph(formId = null, { instant = false } = {}) {
    // A form from another world (its pack still loading): remember it for the next setTheme.
    if (formId && !this.pool?.includes(formId)) { this.wanted = formId; return this.toForm?.id; }
    if (!this.pool) return;
    const id = formId || this._pickForm();
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    const to = buildForm(id, this.N, this.seed);
    this.recent.push(id);
    const memory = Math.max(1, Math.min(3, this.pool.length - 2));
    while (this.recent.length > memory) this.recent.shift();

    if (!this.toForm || instant || this.opts.motion === 'static') {
      this.fromForm = to; this.toForm = to; this.t = 1;
    } else {
      // Freeze the current on-screen blend as the new "from" so morphs can interrupt each other.
      this.fromForm = this._snapshot();
      this.toForm = to; this.t = 0;
    }
    this.transition = this.opts.motion === 'full' ? (TRANSITIONS[this.transitionName] || TRANSITIONS.iris) : TRANSITIONS.crossfade;
    this.duration = (this.theme.hologram.motion.morph || 1.5) * (this.opts.motion === 'full' ? 1 : 0.7);
    this._computeDelays();
    this.hooks.onForm?.({ id, label: formLabel(id), theme: this.theme.id });
    if (!this.running) this.renderOnce();
    return id;
  }

  /** Reactive state for the world backdrop (smoothed bands + transient envelopes). */
  get reactive() { return { bass: this.smooth.bass, mid: this.smooth.mid, high: this.smooth.high, energy: this.smooth.energy, kick: this.env.k, snare: this.env.s }; }

  get currentForm() { return this.toForm ? { id: this.toForm.id, label: this.toForm.label } : null; }

  start() {
    if (this.running || this.opts.motion === 'static') { this.renderOnce(); return; }
    this.running = true;
    this.last = performance.now();
    this._raf = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  renderOnce() {
    if (!this.toForm) return;
    this.t = 1;
    this._frame(0, true);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.qualityTier].dpr);
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.dpr = dpr; this.W = w; this.H = h;
    if (!this.running) this.renderOnce();
  }

  destroy() { this.stop(); this._resizeObs.disconnect(); }

  /* Internals                                                         */
  _pickForm() {
    const choices = this.pool.filter(f => !this.recent.includes(f) && f !== this.toForm?.id);
    const list = choices.length ? choices : this.pool.filter(f => f !== this.toForm?.id);
    return list[Math.floor(Math.random() * list.length)] || this.pool[0];
  }

  _setTier(tier) {
    if (tier === this.qualityTier) return;
    this.qualityTier = tier;
    const N = QUALITY[tier].N;
    if (N !== this.N) {
      this.N = N;
      this._alloc();
      if (this.toForm) {
        const id = this.toForm.id;
        this.toForm = buildForm(id, N, this.seed); this.fromForm = this.toForm; this.t = 1;
      }
    }
    this.resize();
    this.hooks.onQualityChange?.(tier);
  }

  _snapshot() {
    const N = this.N, pos = new Float32Array(N * 3);
    this._blend(pos, false);
    const useTo = this.t > 0.5;
    const src = useTo ? this.toForm : this.fromForm;
    return { id: src.id, label: src.label, flat: src.flat, pos, link: src.link, groups: src.groups };
  }

  _computeDelays() {
    const tr = this.transition, N = this.N, p = this.toForm.pos;
    for (let i = 0; i < N; i++) {
      this.delays[i] = tr.delay ? clamp(tr.delay(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], i, N, this.rand[i])) : 0;
    }
  }

  /** Blend from→to into `out`, applying mid-flight transition effects. */
  _blend(out, writeProg = true) {
    const N = this.N, a = this.fromForm.pos, b = this.toForm.pos, tr = this.transition;
    const T = this.t, spread = tr.spread || 0, ease = EASE[tr.ease] || EASE.inOutCubic;
    let Tq = T;
    if (tr.steps) Tq = Math.floor(T * tr.steps) / tr.steps;
    const glitchK = this.theme?.a11y?.glitchy ? this.opts.glitch : 1;
    for (let i = 0; i < N; i++) {
      let p = tr.crossfade ? T : clamp((Tq - this.delays[i] * spread) / (1 - spread || 1));
      p = ease(p);
      if (tr.snap) p = p >= 0.5 ? 1 : 0; // each point jumps at its own moment
      if (writeProg) this.prog[i] = p;
      const k = i * 3;
      let x = lerp(a[k], b[k], p), y = lerp(a[k + 1], b[k + 1], p), z = lerp(a[k + 2], b[k + 2], p);
      if (!tr.crossfade && p > 0 && p < 1) {
        const mid = Math.sin(p * Math.PI);
        if (tr.scatter) { x += (this.rand[i] - 0.5) * tr.scatter * mid; y += (this.rand2[i] - 0.5) * tr.scatter * mid * 0.4; }
        if (tr.explode) { const l = Math.hypot(x, y, z) || 1; const e = tr.explode * mid * (0.5 + this.rand[i]); x += x / l * e; y += y / l * e; z += z / l * e; }
        if (tr.quantize) { const q = tr.quantize * mid * glitchK + 0.0001; x = Math.round(x / q) * q; y = Math.round(y / q) * q; }
        if (tr.float) { y += mid * tr.float * (0.5 + this.rand[i]); x += Math.sin(p * 6 + this.rand2[i] * 9) * 0.04 * mid; }
        if (tr.sort) { y = lerp(y, -1 + this.rand2[i] * 2, mid * 0.35 * glitchK); }
      }
      out[k] = x; out[k + 1] = y; out[k + 2] = z;
    }
  }

  /** Cap the frame rate (0 = uncapped). Used while sheets/dialogs cover the stage. */
  setThrottle(fps) { this.maxFps = fps || 0; this.frameTimes.length = 0; }

  _loop(now) {
    if (!this.running) return;
    if (this.maxFps && now - this.last < 1000 / this.maxFps) { this._raf = requestAnimationFrame(this._loop); return; }
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();
    this._frame(dt, false);
    this._trackPerf(performance.now() - t0, dt);
    this._raf = requestAnimationFrame(this._loop);
  }

  _trackPerf(cost, dt) {
    if (this.opts.quality !== 'auto' || this.maxFps) return; // throttled frames say nothing about speed
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length < 120) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    // Below ~50 fps: first let the page drop cheap-to-lose effects (the panel blur is the usual
    // culprit on GPU-less machines); only then step the hologram's own detail down.
    if (avg > 20 && this.hooks.onSlow?.()) return;
    // Under sustained load (< ~40 fps), step quality down. Never step up automatically mid-session.
    if (avg > 25) {
      if (this.qualityTier === 'high') this._setTier('medium');
      else if (this.qualityTier === 'medium') this._setTier('low');
    }
  }

  _frame(dt, still) {
    const ctx = this.ctx, W = this.W, H = this.H, N = this.N;
    if (!this.toForm || !W) return;
    const mot = this.theme.hologram.motion;
    const motion = this.opts.motion;
    const motionK = motion === 'full' ? 1 : motion === 'reduced' ? 0.25 : 0;
    const I = this.opts.intensity;
    this.time += dt;

    /* --- features & reactions --- */
    const f = still ? { bass: 0.25, mid: 0.25, high: 0.2, energy: 0.3 } : (this.hooks.getFeatures?.() || {});
    const sm = this.smooth, k = 1 - Math.exp(-dt * 10);
    // fast attack / smooth release so pulses land on the beat instead of lagging behind it
    const kr = 1 - Math.exp(-dt * 7);
    sm.bass = still ? 0.25 : ((f.bass || 0) > sm.bass ? lerp(sm.bass, f.bass, 0.85) : lerp(sm.bass, f.bass || 0, kr));
    sm.mid = still ? 0.25 : lerp(sm.mid, f.mid || 0, k);
    sm.high = still ? 0.2 : lerp(sm.high, f.high || 0, k);
    sm.energy = still ? 0.3 : ((f.energy || 0) > sm.energy ? lerp(sm.energy, f.energy, 0.7) : lerp(sm.energy, f.energy || 0, kr));
    if (!still) {
      if (f.kick) { this._react('kick'); this.hooks.onOnset?.('kick'); }
      if (f.snare) { this._react('snare'); this.hooks.onOnset?.('snare'); }
    }
    for (const key of Object.keys(this.env)) {
      if (key === 'ray' || key === 'focus') continue;
      this.env[key] *= Math.exp(-dt * (key === 'light' ? 2.4 : key === 'drift' ? 2 : 7));
    }
    if (this.env.ray >= 0) { this.env.ray += dt * 1.6; if (this.env.ray > 1.15) this.env.ray = -1; }
    if (this.env.focus >= 0) { this.env.focus += dt * 1.2; if (this.env.focus > 1.2) this.env.focus = -1; }

    /* --- morph --- */
    if (this.t < 1) this.t = still ? 1 : clamp(this.t + dt / this.duration);
    this._blend(this.cur);

    /* --- rotation --- */
    const flat = this.t > 0.5 ? this.toForm.flat : this.fromForm.flat;
    if (mot.hard && motionK > 0) {
      // Brutalist: measured, weighty steps instead of continuous spin.
      this.hardTimer += dt;
      if (this.hardTimer > 2.4) { this.hardTimer = 0; this.rotYTarget += Math.PI / 12; }
      this.rotY += (this.rotYTarget - this.rotY) * (1 - Math.exp(-dt * 6));
    } else {
      if (!this.user.dragging) this.rotY += dt * (mot.rotate + sm.mid * 0.5 * I) * motionK;
    }
    // inertia after a flick, then gentle damping
    const u = this.user;
    if (!u.dragging && (Math.abs(u.vx) > 0.001 || Math.abs(u.vy) > 0.001)) {
      u.ry += u.vy * dt; u.rx = clamp(u.rx + u.vx * dt, -1.35, 1.35);
      const damp = Math.exp(-dt * 3); u.vx *= damp; u.vy *= damp;
    }
    const sway = mot.sway ?? 0.2;
    let ry = flat ? Math.sin(this.time * 0.35) * (sway + 0.15) * motionK : this.rotY;
    // Upright forms (robots) ease toward a near-level view.
    const tiltTo = this.toForm?.upright ? 0.18 : (mot.tilt || 0);
    this.tiltNow += (tiltTo - this.tiltNow) * Math.min(1, dt * 3);
    let rx = flat ? Math.sin(this.time * 0.27) * sway * 0.6 * motionK : this.tiltNow + Math.sin(this.time * 0.21) * 0.08 * motionK;
    if (motion === 'static') { ry = flat ? 0 : 0.6; rx = flat ? 0 : (this.toForm?.upright ? 0.18 : (mot.tilt || 0.3)); }
    ry += u.ry; rx = clamp(rx + u.rx, -1.5, 1.5);
    const cY = Math.cos(ry), sY = Math.sin(ry), cX = Math.cos(rx), sX = Math.sin(rx);

    /* --- transform & project --- */
    const R = Math.min(W, H) * 0.37;
    const pulseAmt = (motion === 'full' ? 1 : 0.3) * I;
    const scaleK = 1 + this.env.pulse * 0.2 * pulseAmt + sm.bass * 0.16 * pulseAmt;
    const comp = this.env.compress * 0.2 * pulseAmt, lift = this.env.lift * 0.14 * pulseAmt;
    const cx = W / 2, cy = H / 2, F = 3.4;
    const ortho = !!this.mat.flat;
    const quant = this.mat.pixel ? Math.max(2, Math.round(3 * this.dpr)) : 0;
    const jit = motion === 'full' && this.env.jit > 0.03 ? this.env.jit * 5 * this.dpr : 0;
    const project = (src, ox, oy, oz) => {
      for (let i = 0; i < N; i++) {
        const j = i * 3;
        let x = src[j], y = src[j + 1], z = src[j + 2];
        if (lift) { const l = 1 + lift * (0.4 + this.rand[i]); x *= l; y *= l; z *= l; }
        if (comp) { y *= 1 - comp; x *= 1 + comp * 0.35; }
        // rotate Y then X
        const x1 = x * cY + z * sY, z1 = -x * sY + z * cY;
        const y2 = y * cX - z1 * sX, z2 = y * sX + z1 * cX;
        const s = ortho ? 1 : F / (F - z2);
        let px = cx + x1 * R * s * scaleK, py = cy - y2 * R * s * scaleK;
        if (jit) { px += (Math.random() - 0.5) * jit; py += (Math.random() - 0.5) * jit; }
        if (quant) { px = Math.round(px / quant) * quant; py = Math.round(py / quant) * quant; }
        ox[i] = px; oy[i] = py; oz[i] = clamp(z2, -1.2, 1.2);
      }
    };
    project(this.cur, this.sx, this.sy, this.sz);

    /* --- draw --- */
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);

    if (this.mat.halo !== false) this._drawHalo(sm, R);

    const tr = this.transition;
    if (tr.crossfade && this.t < 1) {
      // Crossfade/mask-reveal: draw outgoing and incoming forms separately.
      project(this.fromForm.pos, this.sx2, this.sy2, this.sz2);
      const e = EASE.inOutSine(this.t);
      this._drawForm(this.sx2, this.sy2, this.sz2, this.fromForm, 1 - e, null);
      this._drawForm(this.sx, this.sy, this.sz, this.toForm, e, null);
    } else {
      this._drawForm(this.sx, this.sy, this.sz, null, 1, this.prog);
    }

    if (!still) {
      this._drawEffects(dt, R);
      this._updateParticles(dt, sm, R, motionK);
    }
    this._postBands();
    if (tr.scanline && this.t < 1 && motion === 'full') this._drawScanFront();
  }

  /* drawing */

  _color(i, ci) {
    const cols = this.mat.colors;
    return cols[ci % cols.length];
  }

  _colorIndex(i, sz, groupOf) {
    const K = this.mat.colors.length, mode = this.mat.colorMode;
    if (mode === 'depth') return clamp(Math.floor(((1 - sz[i]) / 2) * K), 0, K - 1);
    if (mode === 'height') return clamp(Math.floor(((this.cur[i * 3 + 1] + 1) / 2) * K), 0, K - 1);
    if (mode === 'random') return Math.floor(this.rand2[i] * K);
    if (mode === 'light') {
      // Baroque chiaroscuro: brightness from a slowly pivoting key light.
      const j = i * 3, x = this.cur[j], y = this.cur[j + 1], z = sz[i];
      const la = this.time * 0.15, lx = Math.cos(la) * 0.6 - 0.4, ly = 0.7, lz = 0.5;
      const d = (x * lx + y * ly + z * lz) / (Math.hypot(x, y, z) || 1);
      const b = clamp(d * 0.5 + 0.5 + this.env.light * 0.35);
      return clamp(Math.floor((1 - b) * K), 0, K - 1);
    }
    // index: by group
    return groupOf ? groupOf[i] % K : i % K;
  }

  _groupOf(form) {
    if (form._groupOf) return form._groupOf;
    const g = new Uint16Array(this.N);
    form.groups.forEach((gr, gi) => { for (let i = gr.start; i < gr.start + gr.count; i++) g[i] = gi; });
    for (let i = 0; i < this.N; i++) if (!form.groups.length) g[i] = i;
    form._groupOf = g;
    return g;
  }

  /**
   * Draw one form. If `form` is null we're drawing the morph blend and pick
   * link/fill tables per point from from/to based on that point's progress.
   */
  _drawForm(sx, sy, sz, form, alphaMul, prog) {
    const ctx = this.ctx, mat = this.mat, N = this.N, dpr = this.dpr;
    const K = mat.colors.length;
    const from = form || this.fromForm, to = form || this.toForm;
    const groupOfTo = this._groupOf(to), groupOfFrom = this._groupOf(from);
    const maxSeg = Math.min(this.W, this.H) * (this.t < 1 ? 0.22 : 0.9);
    const tr = this.transition;
    const I = this.opts.intensity;

    let baseAlpha = (mat.alpha ?? 1) * alphaMul;
    if (tr.dim && this.t < 1) baseAlpha *= 0.25 + 0.75 * Math.abs(Math.cos(this.t * Math.PI));
    if (mat.spotlight) baseAlpha *= 0.72 + this.env.light * 0.28 + this.smooth.energy * 0.15;
    if (tr.defocus && this.t < 1) baseAlpha *= 0.55 + 0.45 * Math.abs(Math.cos(this.t * Math.PI));

    /* color index per point */
    const ci = this._ci || (this._ci = new Uint8Array(N));
    if (ci.length !== N) this._ci = new Uint8Array(N);
    const C = this._ci;
    for (let i = 0; i < N; i++) {
      const useTo = !prog || prog[i] >= 0.5;
      C[i] = this._colorIndex(i, sz, useTo ? groupOfTo : groupOfFrom);
    }

    /* fills (flat-print, stencil, stained panes, pigment) */
    if (mat.fill) {
      const useTo = !prog || this.t >= 0.5;
      const tbl = useTo ? to : from;
      const fa = mat.fill * baseAlpha * (prog ? Math.abs(this.t * 2 - 1) : 1) * (1 + this.env.light * 0.6 * I);
      if (fa > 0.01) {
        tbl.groups.forEach((g, gi) => {
          if (!g.fill || g.count < 6) return;
          ctx.beginPath();
          ctx.moveTo(sx[g.start], sy[g.start]);
          for (let i = g.start + 1; i < g.start + g.count; i++) ctx.lineTo(sx[i], sy[i]);
          ctx.closePath();
          ctx.globalAlpha = clamp(fa);
          ctx.fillStyle = mat.fillColors[gi % mat.fillColors.length];
          ctx.fill();
        });
      }
    }

    /* line segments bucketed by color */
    if (mat.lines) {
      const paths = [];
      for (let c = 0; c < K; c++) paths.push(new Path2D());
      const rough = mat.rough ? mat.rough * dpr : 0;
      for (let i = 0; i < N - 1; i++) {
        const useTo = !prog || prog[i] >= 0.5;
        const lk = useTo ? to.link[i] : from.link[i];
        if (!lk) continue;
        const dx = sx[i + 1] - sx[i], dy = sy[i + 1] - sy[i];
        if (dx * dx + dy * dy > maxSeg * maxSeg) continue;
        const p = paths[C[i]];
        if (rough) {
          // charcoal: slowly shifting, slightly irregular line
          const w1 = Math.sin(this.time * 2 + this.rand[i] * 20) * rough, w2 = Math.cos(this.time * 1.7 + this.rand2[i] * 20) * rough;
          p.moveTo(sx[i] + w1, sy[i] + w2); p.lineTo(sx[i + 1] + w2, sy[i + 1] + w1);
        } else { p.moveTo(sx[i], sy[i]); p.lineTo(sx[i + 1], sy[i + 1]); }
      }
      const lw = mat.lineWidth * dpr;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = mat.composite || 'source-over';

      const strokeAll = (width, alpha, colorFn) => {
        ctx.lineWidth = width;
        for (let c = 0; c < K; c++) { ctx.strokeStyle = colorFn(c); ctx.globalAlpha = clamp(alpha); ctx.stroke(paths[c]); }
      };

      if (mat.focusBand) {
        // Tilt-shift: soft (wide, faint) outside the focus band, crisp inside it.
        const band = this._focusBandY();
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, this.W, band.top); ctx.rect(0, band.bottom, this.W, this.H - band.bottom); ctx.clip();
        strokeAll(lw * 2.8, baseAlpha * 0.32, c => mat.colors[c]);
        ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(0, band.top, this.W, band.bottom - band.top); ctx.clip();
        strokeAll(lw, baseAlpha, c => mat.colors[c]);
        ctx.restore();
      } else {
        if (mat.leaded) strokeAll(lw * 3.4, baseAlpha * 0.95, () => '#0a0810');
        if (mat.glow) strokeAll(lw * mat.glow, (mat.glowAlpha || 0.15) * baseAlpha * (1 + this.smooth.high * I), c => mat.colors[c]);
        if (mat.spray) strokeAll(lw * 3, 0.12 * baseAlpha, c => mat.colors[c]);
        if (mat.ink) strokeAll(lw * 1.6, baseAlpha * 0.9, () => '#1b2232');
        strokeAll(lw, baseAlpha * (mat.leaded ? 0.9 : 1), c => (mat.leaded ? lighten(mat.colors[c], 0.35) : mat.colors[c]));
        if (mat.metallic) strokeAll(lw * 0.45, baseAlpha * 0.7, () => '#fff6dc');
        if (mat.gloss) { ctx.save(); ctx.translate(-lw * 0.6, -lw * 0.6); strokeAll(lw * 0.45, baseAlpha * 0.85, () => '#ffffff'); ctx.restore(); }
      }

      /* RGB channel split (Cyberpunk / Vaporwave / Glitch) */
      const glitchy = this.theme.a11y?.glitchy;
      const rgbAmt = this.opts.motion === 'full' ? ((mat.rgb || 0) * 0.5 + this.env.rgb) * (glitchy ? this.opts.glitch : 1) : 0;
      if (rgbAmt > 0.02) {
        const off = rgbAmt * 6 * dpr;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = lw;
        for (const [dx, col] of [[-off, '#ff1f4b'], [off, '#1fe8ff']]) {
          ctx.save(); ctx.translate(dx, 0); ctx.globalAlpha = clamp(0.35 * baseAlpha * Math.min(1, rgbAmt * 2));
          ctx.strokeStyle = col; for (let c = 0; c < K; c++) ctx.stroke(paths[c]); ctx.restore();
        }
      }
      /* Mirrored flash along the vertical axis (Art Deco) */
      if (this.env.mirror > 0.03) {
        ctx.save(); ctx.translate(this.W, 0); ctx.scale(-1, 1);
        ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = lw * 1.4; ctx.globalAlpha = clamp(this.env.mirror * 0.5 * this._flashK());
        ctx.strokeStyle = '#fff4d6'; for (let c = 0; c < K; c++) ctx.stroke(paths[c]);
        ctx.restore();
      }
      /* Ghost layer (Double Exposure): a second exposure drifting apart and merging */
      if (mat.ghost) {
        const d = (6 + this.env.drift * 26 * I) * dpr;
        ctx.save(); ctx.translate(d, -d * 0.4); ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = clamp(0.26 * baseAlpha); ctx.lineWidth = lw * 2.2; ctx.strokeStyle = mat.colors[1];
        for (let c = 0; c < K; c++) ctx.stroke(paths[c]);
        ctx.restore();
        if (this.env.edge > 0.03) { ctx.globalCompositeOperation = 'lighter'; strokeAll(lw * 1.5, this.env.edge * 0.5 * this._flashK(), () => '#fff8e6'); }
      }
      /* Candle flare along edges (Baroque) */
      if (mat.spotlight && this.env.edge > 0.03) { ctx.globalCompositeOperation = 'lighter'; strokeAll(lw * 1.2, this.env.edge * 0.6 * this._flashK(), () => '#ffd98a'); }
      /* Light ray along lead lines (Stained Glass) */
      if (this.env.ray >= 0) {
        const ray = new Path2D(), lo = (this.env.ray - 0.12) * N, hi = this.env.ray * N;
        for (let i = Math.max(0, Math.floor(lo)); i < Math.min(N - 1, hi); i++) {
          if (!to.link[i]) continue; ray.moveTo(sx[i], sy[i]); ray.lineTo(sx[i + 1], sy[i + 1]);
        }
        ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = lw * 2.2; ctx.strokeStyle = '#fffbe8';
        ctx.globalAlpha = clamp(0.85 * this._flashK()); ctx.stroke(ray);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    /* points */
    this._drawPoints(sx, sy, sz, C, baseAlpha, prog, to);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  _drawPoints(sx, sy, sz, C, baseAlpha, prog, to) {
    const ctx = this.ctx, mat = this.mat, N = this.N, dpr = this.dpr, K = mat.colors.length;
    const style = mat.point;
    if (!style || style === 'none') {
      if (mat.pigmentSpray) this._pigmentSpray(sx, sy, baseAlpha);
      return;
    }
    ctx.globalCompositeOperation = mat.composite || 'source-over';
    const size = (mat.pointSize || 1.5) * dpr;
    if (style === 'tile') {
      // Mosaic: depth-sorted tesserae in 4 layers, with grout gaps.
      const lift = this.env.lift;
      for (let layer = 0; layer < 4; layer++) {
        for (let c = 0; c < K; c++) {
          ctx.fillStyle = mat.colors[c];
          ctx.beginPath();
          for (let i = 0; i < N; i++) {
            if (C[i] !== c) continue;
            const L = Math.min(3, Math.floor((sz[i] + 1.2) / 2.4 * 4));
            if (L !== layer) continue;
            const s = size * (0.75 + (sz[i] + 1) * 0.3) * (1 + lift * 0.4 * this.rand[i]);
            ctx.rect(sx[i] - s / 2, sy[i] - s / 2, s - dpr * 0.8, s - dpr * 0.8);
          }
          ctx.globalAlpha = clamp(baseAlpha * (0.45 + layer * 0.18));
          ctx.fill();
        }
      }
      // twinkle highlight on a few tiles (high frequencies)
      const tw = Math.floor(this.smooth.high * 14 * this.opts.intensity);
      ctx.fillStyle = '#ffffff';
      for (let n = 0; n < tw; n++) { const i = Math.floor(Math.random() * N); ctx.globalAlpha = 0.7 * baseAlpha; ctx.fillRect(sx[i] - size / 3, sy[i] - size / 3, size / 1.5, size / 1.5); }
      return;
    }
    if (style === 'square') {
      // Brutalist: mark structural joints (path ends) only.
      ctx.fillStyle = mat.colors[0];
      for (let i = 0; i < N; i++) {
        const end = !to.link[i] || (i > 0 && !to.link[i - 1]);
        if (!end) continue;
        const accent = mat.accentEvery && i % mat.accentEvery === 0;
        ctx.fillStyle = accent ? mat.colors[3] : mat.colors[0];
        ctx.globalAlpha = baseAlpha;
        ctx.fillRect(sx[i] - size * 1.4, sy[i] - size * 1.4, size * 2.8, size * 2.8);
      }
      return;
    }
    if (style === 'halftone') {
      for (let c = 0; c < K; c++) {
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          if (C[i] !== c || to.link[i]) continue; // only dot clouds / path ends
          const r = size * (0.35 + (sz[i] + 1) * 0.55);
          ctx.moveTo(sx[i] + r, sy[i]); ctx.arc(sx[i], sy[i], r, 0, TAU);
        }
        ctx.fillStyle = c === 0 ? '#111111' : mat.colors[c]; ctx.globalAlpha = baseAlpha; ctx.fill();
      }
      return;
    }
    if (style === 'pixel') {
      for (let c = 0; c < K; c++) {
        ctx.fillStyle = mat.colors[c]; ctx.globalAlpha = clamp(baseAlpha * 0.9);
        ctx.beginPath();
        for (let i = 0; i < N; i += 2) if (C[i] === c) ctx.rect(sx[i] - size / 2, sy[i] - size / 2, size, size);
        ctx.fill();
      }
      return;
    }
    if (style === 'pixel-grid') {
      // Deep Field: hard squares snapped to a coarse grid; linked points are joined by stepped pixel lines.
      // Mid-morph, only join neighbours that have both jumped (or both not), and never across the stage.
      const g = (mat.grid || 3) * dpr, q = v => Math.round(v / g) * g, maxSeg = 0.22 * Math.min(this.W, this.H);
      ctx.globalAlpha = baseAlpha;
      for (let i = 0; i < N; i++) {
        ctx.fillStyle = mat.colors[C[i]];
        let x = q(sx[i]), y = q(sy[i]);
        ctx.fillRect(x, y, g, g);
        if (i + 1 >= N || !(prog && prog[i] < 0.5 ? this.fromForm : to).link[i] || (prog && prog[i] !== prog[i + 1])) continue;
        const x1 = q(sx[i + 1]), y1 = q(sy[i + 1]), d = Math.max(Math.abs(x1 - x), Math.abs(y1 - y));
        if (d > maxSeg) continue;
        const steps = Math.min(64, d / g);
        for (let k = 1; k < steps; k++) ctx.fillRect(q(x + (x1 - x) * k / steps), q(y + (y1 - y) * k / steps), g, g);
      }
      return;
    }
    if (style === 'glint') {
      ctx.fillStyle = mat.colors[3] || '#fff'; ctx.globalAlpha = clamp(baseAlpha * 0.8);
      for (let i = 0; i < N; i += 3) ctx.fillRect(sx[i] - size / 2, sy[i] - size / 2, size, size);
      const n = 6 + Math.floor(this.smooth.high * 10);
      ctx.strokeStyle = '#fff6dc'; ctx.lineWidth = dpr * 0.8;
      for (let k = 0; k < n; k++) {
        const i = Math.floor((this.rand[(k * 37) % N] * N + this.time * 30 * (k + 1)) % N), s = size * 4 * (0.5 + Math.sin(this.time * 5 + k) * 0.5);
        ctx.globalAlpha = clamp(baseAlpha * 0.8);
        ctx.beginPath(); ctx.moveTo(sx[i] - s, sy[i]); ctx.lineTo(sx[i] + s, sy[i]); ctx.moveTo(sx[i], sy[i] - s); ctx.lineTo(sx[i], sy[i] + s); ctx.stroke();
      }
      return;
    }
    // 'dot'
    for (let c = 0; c < K; c++) {
      ctx.fillStyle = mat.colors[c]; ctx.globalAlpha = clamp(baseAlpha * 0.9);
      ctx.beginPath();
      for (let i = 0; i < N; i += 2) if (C[i] === c) { const s = size * (0.7 + (sz[i] + 1) * 0.3); ctx.rect(sx[i] - s / 2, sy[i] - s / 2, s, s); }
      ctx.fill();
    }
    if (mat.focusBand) {
      // tiny lit windows / lights inside the focus band
      const band = this._focusBandY();
      ctx.fillStyle = '#fff3b0';
      for (let i = 0; i < N; i += 7) { if (sy[i] < band.top || sy[i] > band.bottom) continue; ctx.globalAlpha = clamp((0.4 + 0.6 * Math.sin(this.time * 3 + this.rand[i] * 40)) * baseAlpha); ctx.fillRect(sx[i] - dpr, sy[i] - dpr, dpr * 2, dpr * 2); }
    }
  }

  _pigmentSpray(sx, sy, baseAlpha) {
    // Cave: hand-stencil style pigment dusted around the drawing.
    const ctx = this.ctx, N = this.N, dpr = this.dpr;
    ctx.fillStyle = this.mat.colors[1];
    ctx.beginPath();
    for (let i = 0; i < N; i += 2) {
      const a = this.rand[i] * TAU, r = (4 + this.rand2[i] * 14) * dpr;
      ctx.rect(sx[i] + Math.cos(a) * r, sy[i] + Math.sin(a) * r, 1.6 * dpr, 1.6 * dpr);
    }
    ctx.globalAlpha = clamp(0.35 * baseAlpha);
    ctx.fill();
  }

  _drawHalo(sm, R) {
    const ctx = this.ctx, p = this.theme.palette;
    const a = 0.08 + sm.energy * 0.18 * this.opts.intensity + this.env.pulse * 0.1;
    const g = ctx.createRadialGradient(this.W / 2, this.H / 2, R * 0.1, this.W / 2, this.H / 2, R * 1.35);
    g.addColorStop(0, hexA(this.mat.spotlight ? '#ffcf7a' : p.secondary, clamp(a)));
    g.addColorStop(1, hexA(p.secondary, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  _focusBandY() {
    const H = this.H;
    let c = H * 0.5;
    if (this.env.focus >= 0) c = H * (0.15 + this.env.focus * 0.7);
    const half = H * 0.14;
    return { top: c - half, bottom: c + half };
  }

  /* reactions */

  _flashK() {
    let k = this.opts.reduceFlashing ? 0.35 : 1;
    if (this.opts.motion !== 'full') k *= 0.4;
    return k;
  }

  _react(kind) {
    const name = this.theme.hologram.reactions[kind];
    const I = this.opts.intensity;
    if (I <= 0.01) return;
    // Generic envelopes shared with the world backdrop.
    if (kind === 'kick') { this.env.k = 1; this.env.pulse = Math.max(this.env.pulse, 0.55); } else this.env.s = 1;
    const P = this.theme.palette, now = this.time;
    const full = this.opts.motion === 'full';
    const g = this.theme.a11y?.glitchy ? this.opts.glitch : 1;
    const flashOk = () => {
      const minGap = this.opts.reduceFlashing ? 0.9 : 0.18;
      if (now - this.lastFlash < minGap) return false;
      this.lastFlash = now; return true;
    };
    const add = e => this.effects.push({ t: 0, ...e });
    switch (name) {
      // kick
      case 'bloom-pulse': this.env.pulse = 1; if (flashOk()) add({ type: 'flash', life: 0.25, color: P.primary, alpha: 0.32 * I }); break;
      case 'sunburst': this.env.pulse = 0.6; add({ type: 'ring', life: 0.9, color: '#f6dfa6', width: 1.4, from: 0.3, to: 1.25 }); add({ type: 'ring', life: 1.1, color: '#d9b36c', width: 1, from: 0.2, to: 1.05 }); add({ type: 'rays', life: 0.7, color: '#f6dfa6', count: 16 }); break;
      case 'pigment-stamp': this.env.pulse = 0.5; add({ type: 'ring', life: 1.0, color: '#c0533a', width: 5, from: 0.4, to: 1.2, rough: true }); add({ type: 'ring', life: 1.3, color: '#e0954a', width: 3, from: 0.2, to: 1.0, rough: true }); break;
      case 'tile-lift': this.env.lift = 1; break;
      case 'wave-swell': for (let k = 0; k < 3; k++) add({ type: 'ring', life: 1.1, delay: k * 0.12, color: ['#1f3a5f', '#4f7f6b', '#b8322a'][k], width: 3, from: 0.35, to: 1.15, wave: true }); this.env.pulse = 0.4; break;
      case 'light-swell': this.env.light = 1; if (flashOk()) add({ type: 'flash', life: 0.8, color: '#ffcf7a', alpha: 0.18 * I }); break;
      case 'paint-ring': add({ type: 'ring', life: 0.7, color: pick(['#e8ff2a', '#22d3ee', '#ff3b30']), width: 7, from: 0.3, to: 1.2, rough: true }); this.env.pulse = 0.7; this._burst('splat', 5, 0.5); break;
      case 'grid-ripple': add({ type: 'ring', life: 0.8, color: '#01cdfe', width: 1.5, from: 0.2, to: 1.3, ellipse: 0.35 }); this.env.pulse = 0.6; break;
      case 'compress': this.env.compress = 1; break;
      case 'pane-brighten': this.env.light = 1; add({ type: 'ring', life: 0.9, color: '#fff3c4', width: 2, from: 0.05, to: 1.0, soft: true }); break;
      case 'layer-drift': this.env.drift = 1; break;
      case 'focus-ripple': this.env.focus = 0; break;
      case 'bubble-pop': this.env.pulse = 0.5; add({ type: 'ring', life: 0.7, color: '#7fd8ff', width: 2, from: 0.2, to: 1.1, soft: true }); this._burst('bubble', 6, 0.5); break;
      case 'band-displace': if (full) this.env.displace = 1 * g; this.env.pulse = 0.4; break;
      // snare
      case 'rgb-scan': if (full) { this.env.rgb = 0.8 * g; add({ type: 'scan', life: 0.35, color: '#34dfff' }); } break;
      case 'mirror-flash': this.env.mirror = 1; add({ type: 'vline', life: 0.3, color: '#fff4d6' }); break;
      case 'dust-burst': this._burst('dust', 14, 0.6); break;
      case 'sparkle-wave': add({ type: 'ring', life: 0.6, color: '#ffffff', width: 1, from: 0.1, to: 1.1, dashed: true }); this._burst('glint', 8, 0.8); break;
      case 'brush-flash': add({ type: 'brush', life: 0.9, color: '#b8322a', y: 0.2 + Math.random() * 0.6 }); break;
      case 'candle-flare': this.env.edge = 1; if (flashOk()) add({ type: 'flash', life: 0.4, color: '#ffd98a', alpha: 0.16 * I, ox: -0.35, oy: -0.35, r: 0.6 }); break;
      case 'splatter': this._burst('splat', 10, 1); break;
      case 'vhs-tear': if (full) this.env.tear = 1 * g; break;
      case 'hard-cut': if (full) this.env.cut = 1; else this.env.compress = 0.4; break;
      case 'lead-ray': this.env.ray = 0; break;
      case 'exposure-flash': this.env.edge = 1; if (flashOk()) add({ type: 'flash', life: 0.35, color: '#fff8e6', alpha: 0.2 * I }); break;
      case 'camera-flash': if (flashOk()) add({ type: 'flash', life: 0.18, color: '#ffffff', alpha: 0.28 * I, r: 0.5 }); break;
      case 'gloss-sheen': add({ type: 'sheen', life: 0.6 }); break;
      case 'pixel-shockwave': add({ type: 'ring', life: 0.7, color: '#ffb454', width: 2, from: 0.2, to: 1.25, dashed: true }); this.env.pulse = 0.6; break;
      case 'scanline-flash': if (full && !this.opts.reduceFlashing && flashOk()) add({ type: 'scan', life: 0.35, color: '#5fe1d6' }); else this.env.pulse = 0.3; break;
      case 'star-sparks': this._burst('glint', 8, 0.8); break;
      case 'channel-split': if (full) this.env.rgb = 1.4 * g; this._burst('pixel', 10, 0.8); break;
      case 'headlight-flare': this.env.pulse = 0.5; if (flashOk()) add({ type: 'flash', life: 0.3, color: '#ffd9a0', alpha: 0.22 * I, oy: 0.25, r: 0.9 }); break;
      case 'poly-jitter': if (full) this.env.jit = g; break;
      default: break;
    }
  }

  _drawEffects(dt, R) {
    const ctx = this.ctx, W = this.W, H = this.H, dpr = this.dpr, cx = W / 2, cy = H / 2;
    const fk = this._flashK();
    for (let n = this.effects.length - 1; n >= 0; n--) {
      const e = this.effects[n];
      e.t += dt;
      const local = e.t - (e.delay || 0);
      if (local < 0) continue;
      const p = local / e.life;
      if (p >= 1) { this.effects.splice(n, 1); continue; }
      const fade = 1 - p;
      ctx.globalCompositeOperation = this.mat.composite === 'lighter' ? 'lighter' : 'source-over';
      switch (e.type) {
        case 'flash': {
          const r = (e.r || 1.2) * R, x = cx + (e.ox || 0) * R, y = cy + (e.oy || 0) * R;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, hexA(e.color, clamp(e.alpha * fade * fk))); g.addColorStop(1, hexA(e.color, 0));
          ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
          break;
        }
        case 'ring': {
          const r = lerp(e.from, e.to, EASE.outCubic(p)) * R;
          ctx.globalAlpha = clamp(fade * (e.soft ? 0.5 : 0.85) * this.opts.intensity + 0.1 * fade);
          ctx.strokeStyle = e.color; ctx.lineWidth = e.width * dpr * (e.soft ? 4 * fade + 1 : 1);
          if (e.dashed) ctx.setLineDash([2 * dpr, 6 * dpr]);
          ctx.beginPath();
          if (e.rough || e.wave) {
            for (let k = 0; k <= 72; k++) {
              const a = k / 72 * TAU, w = e.wave ? Math.sin(a * 10 + p * 6) * 0.03 : (Math.sin(a * 13 + e.t) * 0.02 + Math.sin(a * 5) * 0.015);
              const rr = r * (1 + w), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * (e.ellipse || 1);
              k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
          } else ctx.ellipse(cx, cy, r, r * (e.ellipse || 1), 0, 0, TAU);
          ctx.stroke(); ctx.setLineDash([]);
          break;
        }
        case 'rays': {
          ctx.globalAlpha = clamp(fade * 0.5 * this.opts.intensity); ctx.strokeStyle = e.color; ctx.lineWidth = dpr;
          ctx.beginPath();
          for (let k = 0; k < e.count; k++) { const a = k / e.count * TAU, r0 = R * 0.9, r1 = R * (0.95 + p * 0.5); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); }
          ctx.stroke();
          break;
        }
        case 'scan': {
          const y = p * H;
          ctx.globalAlpha = clamp(fade * 0.6 * fk); ctx.fillStyle = e.color; ctx.fillRect(0, y, W, 2 * dpr);
          ctx.globalAlpha = clamp(fade * 0.12 * fk); ctx.fillRect(0, y - 14 * dpr, W, 14 * dpr);
          break;
        }
        case 'vline': {
          ctx.globalAlpha = clamp(fade * 0.7 * fk); ctx.fillStyle = e.color; ctx.fillRect(cx - dpr, cy - R * 1.1, 2 * dpr, R * 2.2);
          break;
        }
        case 'brush': {
          // a quick horizontal brushstroke sweeping in (ukiyo-e), or seal flash
          ctx.globalAlpha = clamp(Math.sin(p * Math.PI) * 0.55 * this.opts.intensity);
          ctx.fillStyle = e.color;
          const y = e.y * H, len = W * 0.7 * EASE.outCubic(Math.min(1, p * 2));
          ctx.beginPath(); ctx.moveTo(W * 0.15, y);
          for (let k = 0; k <= 20; k++) { const x = W * 0.15 + len * k / 20; ctx.lineTo(x, y - (3 + Math.sin(k) * 1.5) * dpr * (1 - k / 25)); }
          for (let k = 20; k >= 0; k--) { const x = W * 0.15 + len * k / 20; ctx.lineTo(x, y + (3 + Math.cos(k) * 1.5) * dpr * (1 - k / 25)); }
          ctx.fill();
          const s = 16 * dpr; ctx.fillRect(W * 0.82, H * 0.14, s, s); // seal
          break;
        }
        case 'sheen': {
          // Frutiger Aero: a diagonal glossy highlight sweeping across the stage
          const x = lerp(-0.3, 1.3, EASE.inOutSine(p)) * W;
          const g = ctx.createLinearGradient(x - W * 0.12, 0, x + W * 0.12, H);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${0.45 * fk * Math.sin(p * Math.PI)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
          break;
        }
        default: break;
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /** Band post-effects operate on the rendered canvas (bounded to the stage). */
  _postBands() {
    const ctx = this.ctx, W = this.W, H = this.H, dpr = this.dpr;
    if (this.opts.motion !== 'full') return;
    if (this.env.displace > 0.05 || this.env.tear > 0.05) {
      const amt = Math.max(this.env.displace, this.env.tear);
      const bands = this.env.tear > this.env.displace ? 2 : 5;
      for (let b = 0; b < bands; b++) {
        const h = (6 + Math.random() * 26) * dpr, y = Math.random() * (H - h), dx = (Math.random() - 0.5) * 40 * dpr * amt;
        ctx.drawImage(this.canvas, 0, y, W, h, dx, y, W, h);
      }
      if (this.env.tear > 0.05) { ctx.globalAlpha = clamp(this.env.tear * 0.18); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, Math.random() * H, W, 1.5 * dpr); ctx.globalAlpha = 1; }
    }
    if (this.env.cut > 0.05) {
      const y = H * 0.48, dx = 10 * dpr * this.env.cut;
      ctx.drawImage(this.canvas, 0, 0, W, y, dx, 0, W, y);
      ctx.fillStyle = '#121212'; ctx.globalAlpha = clamp(this.env.cut); ctx.fillRect(0, y - 1.5 * dpr, W, 3 * dpr); ctx.globalAlpha = 1;
    }
  }

  _drawScanFront() {
    const ctx = this.ctx, T = this.t, y = (T * 1.2 - 0.1) * this.H;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 * this._flashK(); ctx.fillStyle = this.mat.colors[0];
    ctx.fillRect(0, y, this.W, 1.5 * this.dpr);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* particles */
  _burst(kind, n, speed) {
    const P = this.particles, cap = QUALITY[this.qualityTier].particles;
    const K = KINDS[kind] ?? 0;
    for (let k = 0; k < n; k++) {
      const i = this._freeParticle(cap); if (i < 0) return;
      const a = Math.random() * TAU, v = (40 + Math.random() * 160) * speed * this.dpr;
      P.x[i] = this.W / 2 + Math.cos(a) * 20 * this.dpr; P.y[i] = this.H / 2 + Math.sin(a) * 20 * this.dpr;
      P.vx[i] = Math.cos(a) * v; P.vy[i] = Math.sin(a) * v;
      P.max[i] = P.life[i] = 0.5 + Math.random() * 0.7;
      P.size[i] = (kind === 'splat' ? 4 + Math.random() * 6 : kind === 'bubble' ? 5 + Math.random() * 9 : 1 + Math.random() * 2) * this.dpr;
      P.col[i] = Math.floor(Math.random() * 3); P.kind[i] = K;
    }
  }

  _freeParticle(cap) {
    const P = this.particles;
    for (let i = 0; i < cap; i++) if (P.life[i] <= 0) return i;
    return -1;
  }

  _updateParticles(dt, sm, R, motionK) {
    const P = this.particles, cfg = this.theme.hologram.particles, cap = QUALITY[this.qualityTier].particles;
    if (!cfg) return;
    const ctx = this.ctx, W = this.W, H = this.H, dpr = this.dpr;
    const kind = KINDS[cfg.kind] ?? 0;
    // emission: high-frequency energy drives shimmer
    P.acc += dt * cfg.rate * (0.25 + sm.high * 1.8) * (0.3 + this.opts.intensity) * (motionK > 0 ? Math.max(0.3, motionK) : 0);
    while (P.acc >= 1) {
      P.acc -= 1;
      const i = this._freeParticle(cap); if (i < 0) break;
      const j = Math.floor(Math.random() * this.N);
      let x = this.sx[j], y = this.sy[j], vx = (Math.random() - 0.5) * 30, vy = (Math.random() - 0.5) * 30, life = 0.6 + Math.random() * 1.2;
      if (cfg.kind === 'dust' || cfg.kind === 'speck' || cfg.kind === 'pollen') { x = Math.random() * W; y = Math.random() * H; vx = (Math.random() - 0.3) * 12; vy = -6 - Math.random() * 10; life = 2 + Math.random() * 2; }
      if (cfg.kind === 'mote') { const t = Math.random(); x = W * (0.1 + t * 0.6) + (Math.random() - 0.5) * W * 0.15; y = H * (t * 0.9); vx = 4; vy = 8; life = 3 + Math.random() * 2; }
      if (cfg.kind === 'mist') { vx = (Math.random() - 0.5) * 50; vy = (Math.random() - 0.5) * 50; life = 1.2 + Math.random(); }
      if (cfg.kind === 'bubble') { x = Math.random() * W; y = H + 10; vx = (Math.random() - 0.5) * 10; vy = -(20 + Math.random() * 40); life = 3 + Math.random() * 3; }
      if (cfg.kind === 'spark') { const a = Math.random() * TAU; vx = Math.cos(a) * 90; vy = Math.sin(a) * 90; life = 0.35 + Math.random() * 0.4; }
      P.x[i] = x; P.y[i] = y; P.vx[i] = vx * dpr; P.vy[i] = vy * dpr; P.max[i] = P.life[i] = life;
      P.size[i] = (cfg.kind === 'mist' ? 10 + Math.random() * 16 : cfg.kind === 'bubble' ? 4 + Math.random() * 10 : 0.8 + Math.random() * 1.8) * dpr;
      P.col[i] = Math.floor(Math.random() * cfg.colors.length); P.kind[i] = kind;
    }
    const comp = this.mat.composite || 'source-over';
    ctx.globalCompositeOperation = comp;
    for (let i = 0; i < cap; i++) {
      if (P.life[i] <= 0) continue;
      P.life[i] -= dt;
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt;
      if (P.kind[i] === KINDS.splat || P.kind[i] === KINDS.dust) { P.vx[i] *= 0.94; P.vy[i] *= 0.94; }
      const a = clamp(P.life[i] / P.max[i]);
      const col = (P.kind[i] === KINDS.splat ? ['#e8ff2a', '#22d3ee', '#ff3b30'] : cfg.colors)[P.col[i] % 3] || cfg.colors[0];
      ctx.fillStyle = col; ctx.strokeStyle = col;
      const s = P.size[i];
      switch (P.kind[i]) {
        case KINDS.spark:
          ctx.globalAlpha = a; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(P.x[i], P.y[i]); ctx.lineTo(P.x[i] - P.vx[i] * 0.05, P.y[i] - P.vy[i] * 0.05); ctx.stroke(); break;
        case KINDS.glint: {
          ctx.globalAlpha = a * Math.abs(Math.sin(P.life[i] * 8)); ctx.lineWidth = dpr * 0.8; const g = s * 2.5;
          ctx.beginPath(); ctx.moveTo(P.x[i] - g, P.y[i]); ctx.lineTo(P.x[i] + g, P.y[i]); ctx.moveTo(P.x[i], P.y[i] - g); ctx.lineTo(P.x[i], P.y[i] + g); ctx.stroke(); break;
        }
        case KINDS.mist: ctx.globalAlpha = a * 0.08; ctx.beginPath(); ctx.arc(P.x[i], P.y[i], s, 0, TAU); ctx.fill(); break;
        case KINDS.splat: ctx.globalAlpha = a * 0.9; ctx.beginPath(); ctx.arc(P.x[i], P.y[i], s * (0.6 + a * 0.4), 0, TAU); ctx.fill(); break;
        case KINDS.mote: ctx.globalAlpha = a * 0.6 * Math.min(1, (P.max[i] - P.life[i]) * 2); ctx.beginPath(); ctx.arc(P.x[i], P.y[i], s, 0, TAU); ctx.fill(); break;
        case KINDS.twinkle: ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(P.life[i] * 20)); ctx.fillRect(P.x[i] - s / 2, P.y[i] - s / 2, s, s); break;
        case KINDS.bubble: {
          // glossy bubble: rim + highlight
          ctx.globalAlpha = a * 0.7; ctx.lineWidth = dpr; ctx.strokeStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(P.x[i] + Math.sin(P.life[i] * 3) * 3 * dpr, P.y[i], s, 0, TAU); ctx.stroke();
          ctx.globalAlpha = a * 0.5; ctx.fillStyle = '#bfefff'; ctx.beginPath(); ctx.arc(P.x[i], P.y[i], s, 0, TAU); ctx.fill();
          ctx.globalAlpha = a * 0.9; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(P.x[i] - s * 0.35, P.y[i] - s * 0.35, s * 0.25, 0, TAU); ctx.fill();
          break;
        }
        case KINDS.pixel: { const q = 3 * dpr; ctx.globalAlpha = a; ctx.fillRect(Math.round(P.x[i] / q) * q, Math.round(P.y[i] / q) * q, q, q); break; }
        default: ctx.globalAlpha = a * 0.8; ctx.fillRect(P.x[i] - s / 2, P.y[i] - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
}

const KINDS = { bubble: 9, spark: 1, dust: 2, speck: 2, fleck: 2, pollen: 2, glint: 3, mist: 4, splat: 5, mote: 6, twinkle: 7, pixel: 8 };

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

function hexA(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}
function lighten(hex, k) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return hex;
  const c = [m[1], m[2], m[3]].map(h => Math.round(parseInt(h, 16) + (255 - parseInt(h, 16)) * k));
  return `rgb(${c.join(',')})`;
}

export { hexA };
