/**
 * spotify-embed.js — Spotify Embed via the official iFrame API.
 *
 * What the iFrame API officially offers (developer.spotify.com/documentation/embeds):
 *   createController(el, {uri|url, width, height}, cb), loadUri/loadEntity,
 *   play(), pause(), resume(), togglePlay(), restart(), seek(seconds), destroy()
 *   events: ready, playback_started, playback_update {isPaused, isBuffering, duration(ms), position(ms), playingURI}
 *
 * Consequently this provider exposes ONLY play/pause and (for podcast
 * episodes, which the docs say seek applies to) seeking. Next/previous,
 * volume, shuffle, repeat and the queue are owned by the embed's own UI, so
 * the REVERB bar hides those controls while the embed is active.
 *
 * Notes: logged-out listeners (or users without Spotify cookies) typically
 * hear 30-second previews; full tracks require the listener to be logged in
 * to Spotify in that browser. The embed's audio is cross-origin, so the
 * hologram cannot analyse it — visualizer falls back to ambient (or mic).
 */
import { parseSpotify, loadScript } from './spotify-common.js';

const IFRAME_API = 'https://open.spotify.com/embed/iframe-api/v1';
let apiPromise = null;

function loadIframeApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = api => { prev?.(api); resolve(api); };
    loadScript(IFRAME_API).catch(err => { apiPromise = null; reject(err); });
    setTimeout(() => reject(new Error('Spotify iFrame API did not initialise in time.')), 15000);
  });
  return apiPromise;
}

const NONE = { playPause: false, seek: false, next: false, previous: false, volume: false, mute: false, shuffle: false, repeat: false, queue: false, analysable: false };

export class SpotifyEmbedProvider extends EventTarget {
  constructor(surface) {
    super();
    this.id = 'spotify-embed';
    this.label = 'Spotify embed';
    this.surface = surface; // container element the embed renders into
    this.controller = null;
    this.entity = null;
    this.meta = null;
    this.status = 'idle';
    this.message = 'Paste a Spotify link to load an embed.';
    this.pb = { isPaused: true, position: 0, duration: 0, at: 0 };
    this.capabilities = { ...NONE };
  }

  async activate() { this.surface.hidden = !this.entity; this._emit(); }
  async deactivate() { try { this.controller?.pause(); } catch {} this.surface.hidden = true; }

  async load(input) {
    const ent = parseSpotify(input);
    if (!ent) { this._set('error', 'That doesn’t look like a Spotify track, album, playlist, episode, show or artist link.'); return false; }
    this.entity = ent; this.meta = null;
    this._set('loading', 'Loading Spotify embed…');
    try {
      const api = await loadIframeApi();
      this.surface.hidden = false;
      const height = ent.type === 'track' || ent.type === 'episode' ? 152 : 352;
      if (!this.controller) {
        const mount = document.createElement('div');
        this.surface.querySelector('.embed-mount').replaceChildren(mount);
        await new Promise(res => api.createController(mount, { uri: ent.uri, width: '100%', height }, ctrl => {
          this.controller = ctrl;
          ctrl.addListener('ready', () => this._onReady());
          ctrl.addListener('playback_update', e => this._onUpdate(e.data));
          res();
        }));
      } else {
        this.controller.loadUri(ent.uri);
        const iframe = this.surface.querySelector('iframe'); if (iframe) iframe.height = String(height);
      }
      this._fetchMeta(ent);
      return true;
    } catch (err) {
      this._set('unavailable', `Spotify embed unavailable: ${err.message}`);
      return false;
    }
  }

  async _fetchMeta(ent) {
    // oEmbed gives a title + thumbnail. If the browser blocks it, we fall back gracefully.
    try {
      const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(ent.url)}`);
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      this.meta = { title: j.title, artwork: j.thumbnail_url };
    } catch { this.meta = null; }
    this._emit();
  }

  _onReady() {
    this.capabilities = { ...NONE, playPause: true, seek: this.entity?.type === 'episode' };
    this._set('ready', 'Embed ready — press play. Full tracks need you to be logged in to Spotify in this browser; otherwise Spotify plays previews.');
  }

  _onUpdate(d) {
    if (!d) return;
    this.pb = { isPaused: d.isPaused, position: (d.position || 0) / 1000, duration: (d.duration || 0) / 1000, at: performance.now() };
    this.capabilities = { ...NONE, playPause: true, seek: this.entity?.type === 'episode' };
    this._set(d.isBuffering ? 'buffering' : d.isPaused ? 'paused' : 'playing', '');
  }

  _set(status, message) { this.status = status; this.message = message; this._emit(); }

  play() { this.controller?.resume(); }
  pause() { this.controller?.pause(); }
  // resume() also starts playback if it hasn't started yet (per the iFrame API docs), so prefer it over togglePlay().
  toggle() { if (this.status === 'playing' || this.status === 'buffering') this.controller?.pause(); else this.controller?.resume(); }
  seek(sec) { if (this.capabilities.seek) this.controller?.seek(sec); }

  get state() {
    const playing = this.status === 'playing';
    const pos = this.pb.position + (playing ? (performance.now() - this.pb.at) / 1000 : 0);
    const title = this.meta?.title || (this.entity ? `Spotify ${this.entity.type}` : 'No Spotify item loaded');
    return {
      status: this.status, message: this.message,
      track: this.entity ? { title, artist: 'via Spotify embed', album: '', artwork: this.meta?.artwork || null, kind: 'spotify' } : null,
      position: Math.min(pos, this.pb.duration || pos), duration: this.pb.duration, volume: 1, muted: false,
      shuffle: false, repeat: 'off', queue: [], index: -1, playing,
    };
  }

  _emit() { this.dispatchEvent(new Event('state')); }
}
