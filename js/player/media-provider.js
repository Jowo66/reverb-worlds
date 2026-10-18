/**
 * media-provider.js — the built-in REVERB player.
 *
 * Plays same-origin audio through an <audio> element routed into the Web
 * Audio analyser, so the hologram can be *genuinely* audio-reactive:
 *   • REVERB Originals — tracks synthesised in-browser (demo-synth.js)
 *   • Your files       — local audio files you pick or drop (never uploaded)
 *
 * Supports every control: play/pause, seek, prev/next, volume/mute,
 * shuffle, repeat (off/all/one) and an interactive queue.
 */
import { DEMO_TRACKS, renderTrack, encodeWAV, makeArtwork, trackDuration, SYNTH_VERSION } from './demo-synth.js';

const AUDIO_CACHE = `rw-audio-v${SYNTH_VERSION}`;

export class MediaProvider extends EventTarget {
  constructor(analyser) {
    super();
    this.id = 'media';
    this.label = 'REVERB player';
    this.capabilities = { playPause: true, seek: true, next: true, previous: true, volume: true, mute: true, shuffle: true, repeat: true, queue: 'interactive', analysable: true };
    this.analyser = analyser;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', '');
    this.items = [];
    this.order = [];
    this.pos = -1;          // position within this.order
    this.shuffle = false;
    this.repeat = 'off';
    this.volume = 0.8;
    this.muted = false;
    this.status = 'idle';
    this.message = '';
    this.gain = null;
    this.renderCache = new Map();
    this.loadToken = 0;
    this._wire();
  }

  _wire() {
    const a = this.audio;
    const set = (status, message = '') => { this.status = status; this.message = message; this._emit(); };
    a.addEventListener('playing', () => set('playing'));
    a.addEventListener('pause', () => { if (this.status !== 'loading') set(a.ended ? 'ended' : 'paused'); });
    a.addEventListener('waiting', () => set('buffering', 'Buffering…'));
    a.addEventListener('durationchange', () => this._emit());
    a.addEventListener('seeked', () => this._emit());
    a.addEventListener('ended', () => this._onEnded());
    a.addEventListener('error', () => {
      const cur = this.current;
      set('error', cur?.kind === 'file' ? `“${cur.title}” can’t be played by this browser (unsupported format?).` : 'Playback error.');
    });
  }

  /* ---------------- queue management ---------------- */
  loadDemoPlaylist() {
    const items = DEMO_TRACKS.map(def => ({
      id: `demo:${def.id}`, kind: 'demo', title: def.title, artist: def.artist, album: def.album,
      artwork: makeArtwork(def), duration: trackDuration(def),
      getUrl: () => this._renderDemo(def),
    }));
    this._setItems(items);
  }

  addFiles(fileList, { replace = false } = {}) {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i.test(f.name));
    if (!files.length) return 0;
    const items = files.map((f, i) => {
      const url = URL.createObjectURL(f);
      return { id: `file:${Date.now()}:${i}:${f.name}`, kind: 'file', title: f.name.replace(/\.[^.]+$/, ''), artist: 'Local file', album: 'Your files', artwork: null, duration: 0, url, getUrl: async () => url };
    });
    if (replace) {
      this.items.filter(it => it.kind === 'file').forEach(it => URL.revokeObjectURL(it.url));
      this._setItems(items);
    } else {
      const wasEmpty = !this.items.length;
      this.items.push(...items);
      this.order.push(...items.map((_, k) => this.items.length - items.length + k));
      if (wasEmpty) this.pos = 0;
      this._emit();
    }
    return items.length;
  }

  _setItems(items) {
    this.items = items;
    this.order = items.map((_, i) => i);
    if (this.shuffle) this._shuffleOrder(0);
    this.pos = items.length ? 0 : -1;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.status = 'ready';
    this.message = '';
    this._emit();
  }

  /**
   * Select a track without loading or playing it, remembering where to resume.
   * Used to restore the last session: the bar shows the track paused at its
   * old position, and the next Play continues from there.
   */
  cue(index, position = 0) {
    const p = this.order.indexOf(index);
    if (p < 0) return false;
    this.pos = p;
    this.resumeAt = position > 1 ? { id: this.items[index].id, t: position } : null;
    this.status = 'ready'; this.message = '';
    this._emit();
    return true;
  }

  /** Pre-render the demo track at `pos` (no-op for local files) so the next play starts instantly. */
  prefetch(pos = 0) {
    const item = this.items[this.order[pos]];
    if (item?.kind === 'demo') item.getUrl().catch(() => {});
  }

  get current() { return this.pos >= 0 ? this.items[this.order[this.pos]] : null; }

  /**
   * Synthesised tracks are stored in Cache Storage (per SYNTH_VERSION), so each one
   * is generated once per device instead of on every visit. Falls back silently
   * when storage is unavailable (private mode, insecure origin, quota).
   */
  async _cachedOrRender(def) {
    const key = new URL(`__reverb-audio/${def.id}.wav`, location.href).href;
    let cache = null;
    try {
      cache = await caches.open(AUDIO_CACHE);
      const hit = await cache.match(key);
      if (hit) { this.cacheHits = (this.cacheHits || 0) + 1; return URL.createObjectURL(await hit.blob()); }
    } catch { cache = null; }
    const blob = encodeWAV(await renderTrack(def));
    if (cache) cache.put(key, new Response(blob, { headers: { 'Content-Type': 'audio/wav' } })).catch(() => {});
    return URL.createObjectURL(blob);
  }

  async _renderDemo(def) {
    if (!this.renderCache.has(def.id)) {
      const p = this._cachedOrRender(def);
      this.renderCache.set(def.id, p);
      p.catch(() => this.renderCache.delete(def.id));
    }
    return this.renderCache.get(def.id);
  }

  async _load(pos, autoplay) {
    if (pos < 0 || pos >= this.order.length) return;
    const token = ++this.loadToken;
    this.pos = pos;
    const item = this.current;
    if (this.resumeAt && this.resumeAt.id !== item.id) this.resumeAt = null; // picked a different track: forget the old resume point
    this.status = 'loading';
    this.message = item.kind === 'demo' ? `Synthesising “${item.title}”…` : `Loading “${item.title}”…`;
    this.audio.pause();
    this._emit();
    try {
      const url = await item.getUrl();
      if (token !== this.loadToken) return; // superseded by a newer request
      this.audio.src = url;
      this.audio.currentTime = 0;
      // Resume a cued position (Continue Session) once the file's duration is known.
      if (this.resumeAt && this.resumeAt.id === item.id) {
        const t = this.resumeAt.t; this.resumeAt = null;
        this.audio.addEventListener('loadedmetadata', () => { this.audio.currentTime = Math.min(t, Math.max(0, this.audio.duration - 1)); }, { once: true });
      }
      this.status = 'ready'; this.message = '';
      this._emit();
      if (autoplay) await this._startPlayback();
      this.prefetch(pos + 1);
    } catch (err) {
      if (token !== this.loadToken) return;
      this.status = 'error'; this.message = `Could not load “${item.title}”: ${err.message || err}`;
      this._emit();
    }
  }

  async _startPlayback() {
    // Route through the analyser on first play (needs a user gesture for AudioContext).
    if (!this.gain) {
      this.gain = this.analyser.attachMediaElement(this.audio);
      if (this.gain) this.audio.volume = 1;
      this._applyVolume();
    }
    this.analyser.ensureContext();
    try { await this.audio.play(); }
    catch (err) {
      if (err.name === 'NotAllowedError') { this.status = 'paused'; this.message = 'Press play to start audio (browser autoplay policy).'; }
      else if (err.name !== 'AbortError') { this.status = 'error'; this.message = err.message; }
      this._emit();
    }
  }

  _applyVolume() {
    const v = this.muted ? 0 : this.volume;
    if (this.gain) { this.gain.gain.value = v; this.audio.volume = 1; }
    else this.audio.volume = v;
  }

  _onEnded() {
    if (this.repeat === 'one') { this.audio.currentTime = 0; this._startPlayback(); return; }
    if (this.pos < this.order.length - 1) this._load(this.pos + 1, true);
    else if (this.repeat === 'all') this._load(0, true);
    else { this.status = 'ended'; this._emit(); }
  }

  _shuffleOrder(keepIdx) {
    const rest = this.items.map((_, i) => i).filter(i => i !== keepIdx);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    this.order = [keepIdx, ...rest];
  }

  /* ---------------- provider API ---------------- */
  async activate() { if (!this.items.length) this.loadDemoPlaylist(); this._emit(); }
  async deactivate() { this.audio.pause(); }

  async play() {
    if (!this.items.length) this.loadDemoPlaylist();
    if (this.pos < 0) this.pos = 0;
    if (this.status === 'loading') return;
    if (!this.audio.src || this.status === 'error') return this._load(this.pos, true);
    if (this.status === 'ended' || this.audio.ended) this.audio.currentTime = 0;
    return this._startPlayback();
  }
  pause() { this.audio.pause(); }
  toggle() { if (this.status === 'loading') return; return this.audio.paused ? this.play() : this.pause(); }
  next() { if (!this.order.length) return; const n = this.pos + 1 < this.order.length ? this.pos + 1 : 0; return this._load(n, true); }
  previous() {
    if (!this.order.length) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    const p = this.pos > 0 ? this.pos - 1 : (this.repeat === 'all' ? this.order.length - 1 : 0);
    return this._load(p, true);
  }
  seek(sec) { if (this.audio.src && Number.isFinite(this.audio.duration)) this.audio.currentTime = Math.max(0, Math.min(this.audio.duration - 0.05, sec)); this._emit(); }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.volume > 0) this.muted = false; this._applyVolume(); this._emit(); }
  setMuted(m) { this.muted = !!m; this._applyVolume(); this._emit(); }
  toggleShuffle() {
    this.shuffle = !this.shuffle;
    const curIdx = this.order[this.pos] ?? 0;
    if (this.shuffle) { this._shuffleOrder(curIdx); this.pos = 0; }
    else { this.order = this.items.map((_, i) => i); this.pos = curIdx; }
    this._emit();
  }
  cycleRepeat() { this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat]; this._emit(); }
  /** i is an index into the *displayed* (original) list. */
  playIndex(i) { const p = this.order.indexOf(i); if (p >= 0) return this._load(p, true); }
  removeFiles() {
    const keep = this.items.filter(it => it.kind !== 'file');
    this.items.filter(it => it.kind === 'file').forEach(it => URL.revokeObjectURL(it.url));
    if (keep.length) this._setItems(keep); else this.loadDemoPlaylist();
  }

  get state() {
    const a = this.audio, cur = this.current;
    const duration = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : (cur?.duration || 0);
    return {
      status: this.status, message: this.message,
      track: cur ? { title: cur.title, artist: cur.artist, album: cur.album, artwork: cur.artwork, kind: cur.kind } : null,
      position: a.src ? a.currentTime : (this.resumeAt && this.resumeAt.id === cur?.id ? this.resumeAt.t : 0), duration, volume: this.volume, muted: this.muted,
      shuffle: this.shuffle, repeat: this.repeat,
      queue: this.items.map((it, i) => ({ id: it.id, title: it.title, artist: it.artist, current: i === this.order[this.pos], index: i })),
      index: this.order[this.pos] ?? -1,
      playing: !a.paused && this.status === 'playing',
    };
  }

  _emit() { this.dispatchEvent(new Event('state')); }
}
