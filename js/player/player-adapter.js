/**
 * player-adapter.js — provider-agnostic playback controller.
 *
 * The UI talks only to PlayerController. Each provider declares the
 * capabilities it *really* has, and the UI hides any control that the active
 * provider cannot perform (no decorative buttons).
 *
 * Provider contract (duck-typed):
 *   id, label
 *   capabilities: { playPause, seek, next, previous, volume, mute, shuffle, repeat, queue: false|'readonly'|'interactive', analysable }
 *   activate() / deactivate()
 *   play() pause() toggle() next() previous() seek(sec) setVolume(0..1) setMuted(bool)
 *   toggleShuffle() cycleRepeat() playIndex(i)
 *   state → { status, message, track, position, duration, volume, muted, shuffle, repeat, queue, index }
 *   dispatches 'state' events (EventTarget)
 */

export const EMPTY_CAPS = Object.freeze({ playPause: false, seek: false, next: false, previous: false, volume: false, mute: false, shuffle: false, repeat: false, queue: false, analysable: false });

export const EMPTY_STATE = Object.freeze({
  status: 'idle', message: '', track: null, position: 0, duration: 0, volume: 0.8, muted: false,
  shuffle: false, repeat: 'off', queue: [], index: -1,
});

export class PlayerController extends EventTarget {
  constructor() {
    super();
    this.providers = new Map();
    this.active = null;
    this._onState = () => this._emit();
  }

  register(provider) {
    this.providers.set(provider.id, provider);
    return provider;
  }

  get(id) { return this.providers.get(id); }

  /** Switch provider. The previous provider is paused (not destroyed) so its queue survives. */
  async use(id) {
    const next = this.providers.get(id);
    if (!next || next === this.active) return this.active;
    if (this.active) {
      this.active.removeEventListener('state', this._onState);
      try { await this.active.deactivate?.(); } catch (e) { console.warn(e); }
    }
    this.active = next;
    next.addEventListener('state', this._onState);
    try { await next.activate?.(); } catch (e) { console.warn(e); }
    this._emit();
    return next;
  }

  get state() { return this.active ? this.active.state : EMPTY_STATE; }
  get capabilities() { return this.active ? this.active.capabilities : EMPTY_CAPS; }

  _call(cap, fn, ...args) {
    const p = this.active;
    if (!p) return;
    if (cap && !p.capabilities[cap]) return; // never pretend
    return p[fn]?.(...args);
  }

  play() { return this._call('playPause', 'play'); }
  pause() { return this._call('playPause', 'pause'); }
  toggle() { return this._call('playPause', 'toggle'); }
  next() { return this._call('next', 'next'); }
  previous() { return this._call('previous', 'previous'); }
  seek(sec) { return this._call('seek', 'seek', sec); }
  setVolume(v) { return this._call('volume', 'setVolume', v); }
  setMuted(m) { return this._call('mute', 'setMuted', m); }
  toggleShuffle() { return this._call('shuffle', 'toggleShuffle'); }
  cycleRepeat() { return this._call('repeat', 'cycleRepeat'); }
  playIndex(i) { return this.capabilities.queue === 'interactive' ? this.active.playIndex(i) : undefined; }

  _emit() {
    this.dispatchEvent(new CustomEvent('state', { detail: { provider: this.active?.id, label: this.active?.label, state: this.state, capabilities: this.capabilities } }));
  }
}

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '–:––';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
