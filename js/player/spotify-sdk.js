/**
 * spotify-sdk.js — Spotify Web Playback SDK provider (optional, needs YOUR setup).
 *
 * Requirements (verify current rules at developer.spotify.com before use):
 *  • A Spotify developer app (Client ID only — no secret is used or needed).
 *  • The redirect URI shown in Settings registered EXACTLY in the dashboard
 *    (HTTPS, e.g. https://<user>.github.io/reverb-worlds/).
 *  • Spotify Premium for the listener (the SDK only works with Premium).
 *  • Since Feb/Mar 2026, Development-Mode apps require the app owner to have
 *    Premium and are limited to a small allow-list of users you add in the
 *    dashboard. Other visitors will get an auth/account error.
 *  • Supported desktop browser with DRM (Widevine/EME). Many mobile browsers
 *    are not supported by the SDK.
 *
 * The SDK's audio is DRM-protected; it cannot be analysed. The hologram stays
 * ambient (or microphone-driven) while this provider plays.
 */
import { loadScript, getAccessToken, beginLogin, hasSession, logout, parseSpotify } from './spotify-common.js';

const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js';
const API = 'https://api.spotify.com/v1';
const NONE = { playPause: false, seek: false, next: false, previous: false, volume: false, mute: false, shuffle: false, repeat: false, queue: false, analysable: false };
const FULL = { playPause: true, seek: true, next: true, previous: true, volume: true, mute: true, shuffle: true, repeat: true, queue: 'readonly', analysable: false };

let sdkReady = null;
function loadSdk() {
  if (sdkReady) return sdkReady;
  sdkReady = new Promise((resolve, reject) => {
    if (window.Spotify?.Player) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    loadScript(SDK_SRC).catch(e => { sdkReady = null; reject(e); });
  });
  return sdkReady;
}

export class SpotifySdkProvider extends EventTarget {
  constructor(getClientId) {
    super();
    this.id = 'spotify-sdk';
    this.label = 'Spotify Premium (Web Playback SDK)';
    this.getClientId = getClientId;
    this.player = null;
    this.deviceId = null;
    this.sdkState = null;
    this.stateAt = 0;
    this.volume = 0.8;
    this.muted = false;
    this.capabilities = { ...NONE };
    this.status = hasSession() ? 'idle' : 'auth-required';
    this.message = hasSession() ? 'Signed in. Connect the player to start.' : 'Connect your Spotify Premium account to play here.';
  }

  get configured() { return !!this.getClientId(); }
  get signedIn() { return hasSession(); }

  async activate() { this._emit(); if (this.signedIn && !this.player) this.connect().catch(() => {}); }
  async deactivate() { try { await this.player?.pause(); } catch {} }

  async login() {
    const id = this.getClientId();
    if (!id) { this._set('auth-required', 'Add your Spotify Client ID in Settings first.'); return; }
    await beginLogin(id); // navigates away
  }

  async logout() {
    try { this.player?.disconnect(); } catch {}
    this.player = null; this.deviceId = null; this.sdkState = null;
    logout();
    this.capabilities = { ...NONE };
    this._set('auth-required', 'Signed out of Spotify.');
  }

  async connect() {
    const clientId = this.getClientId();
    if (!clientId) return this._set('auth-required', 'Add your Spotify Client ID in Settings first.');
    if (!(await getAccessToken(clientId))) return this._set('auth-required', 'Spotify session expired — please connect again.');
    this._set('loading', 'Loading the Spotify Web Playback SDK…');
    try { await loadSdk(); } catch (e) { return this._set('unavailable', e.message); }
    const player = new window.Spotify.Player({
      name: 'REVERB // WORLDS',
      getOAuthToken: cb => { getAccessToken(clientId).then(t => t && cb(t)); },
      volume: this.volume,
    });
    this.player = player;
    player.addListener('ready', async ({ device_id }) => {
      this.deviceId = device_id;
      this.capabilities = { ...FULL };
      this._set('ready', 'Connected to Spotify. Search above or pick one of your playlists to start.');
      // Make this browser the active device (does not start playback).
      await this._api('PUT', '/me/player', { device_ids: [device_id], play: false }).catch(() => {});
    });
    player.addListener('not_ready', () => { this.deviceId = null; this._set('loading', 'Spotify device went offline — it will reconnect when you play something.'); });
    player.addListener('initialization_error', ({ message }) => this._set('unavailable', `This browser can’t run the Spotify SDK: ${message}`));
    player.addListener('authentication_error', ({ message }) => { logout(); this._set('auth-required', `Spotify authentication failed: ${message}`); });
    player.addListener('account_error', ({ message }) => this._set('error', `Spotify account error (Premium required, or your account isn’t on this app’s Development-Mode allow-list): ${message}`));
    player.addListener('playback_error', ({ message }) => this._set('error', /no list was loaded/i.test(message || '')
      ? 'Nothing is loaded on the Spotify player yet — pick one of your playlists in Library › Sources.'
      : `Spotify playback error: ${message}`));
    player.addListener('player_state_changed', s => {
      this.sdkState = s; this.stateAt = performance.now();
      if (!s) return this._set('ready', 'Playback moved to another device.');
      this._set(s.loading ? 'buffering' : s.paused ? 'paused' : 'playing', '');
    });
    const ok = await player.connect();
    if (!ok) return this._set('unavailable', 'The Spotify SDK could not connect.');
    setTimeout(() => { if (!this.deviceId && this.player === player) this._set('unavailable', 'The Spotify SDK did not report ready. Check Premium status, the Development-Mode user allow-list and browser DRM support.'); }, 15000);
  }

  async playLink(input) {
    const ent = parseSpotify(input);
    if (!ent) return this._set('error', 'Paste a Spotify track, album, playlist, artist or show link.');
    this.player?.activateElement?.(); // required by some browsers (mobile/Safari) inside a user gesture
    const body = ent.type === 'track' || ent.type === 'episode' ? { uris: [ent.uri] } : { context_uri: ent.uri };
    try { await this._play(body); }
    catch (e) { this._set('error', e.message); }
  }

  /**
   * Search the whole Spotify catalogue. Development-Mode apps (2026) are capped at
   * limit=10 per type per request, so callers page with `offset`.
   */
  async search(q, types = ['track', 'playlist', 'album', 'artist'], offset = 0) {
    const params = new URLSearchParams({ q, type: types.join(','), limit: '10', offset: String(offset) });
    const res = await this._api('GET', `/search?${params}`, undefined, 'search');
    const j = await res.json();
    const img = imgs => { const a = (imgs || []).filter(Boolean); return (a.find(i => (i.width || 300) <= 320) || a[a.length - 1] || a[0])?.url || null; };
    const out = { track: [], playlist: [], album: [], artist: [], more: {} };
    for (const t of types) {
      const block = j[`${t}s`];
      if (!block) continue;
      out.more[t] = !!block.next;
      for (const it of block.items || []) {
        if (!it) continue;
        if (t === 'track') out.track.push({ type: t, uri: it.uri, url: it.external_urls?.spotify, title: it.name, subtitle: (it.artists || []).map(a => a.name).join(', ') + (it.album?.name ? ` · ${it.album.name}` : ''), image: img(it.album?.images), contextUri: it.album?.uri || null, duration: it.duration_ms });
        if (t === 'playlist') out.playlist.push({ type: t, uri: it.uri, url: it.external_urls?.spotify, title: it.name, subtitle: `Playlist · ${it.owner?.display_name || 'Spotify'}${(it.items?.total ?? it.tracks?.total) != null ? ` · ${it.items?.total ?? it.tracks?.total} tracks` : ''}`, image: img(it.images) });
        if (t === 'album') out.album.push({ type: t, uri: it.uri, url: it.external_urls?.spotify, title: it.name, subtitle: `Album · ${(it.artists || []).map(a => a.name).join(', ')}${it.release_date ? ` · ${it.release_date.slice(0, 4)}` : ''}`, image: img(it.images) });
        if (t === 'artist') out.artist.push({ type: t, uri: it.uri, url: it.external_urls?.spotify, title: it.name, subtitle: 'Artist', image: img(it.images) });
      }
    }
    return out;
  }

  /** Play a search result. Tracks play inside their album so next/previous keep working. */
  async playItem(item) {
    this.player?.activateElement?.();
    const body = item.type === 'track'
      ? (item.contextUri ? { context_uri: item.contextUri, offset: { uri: item.uri } } : { uris: [item.uri] })
      : { context_uri: item.uri };
    try { await this._play(body); }
    catch (e) { this._set('error', e.message); throw e; }
  }

  /* ---------------- device recovery ----------------
   * Spotify's Web API can answer 404 "device not found" right after the SDK
   * reports ready, or after an idle tab was dropped. We then (1) wait for the
   * device to appear in /me/player/devices and transfer playback to it, or
   * (2) reconnect the SDK, and retry the request once. */
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  _waitReady(ms = 12000) {
    return new Promise(resolve => {
      const t0 = performance.now();
      const tick = () => { if (this.deviceId) return resolve(true); if (performance.now() - t0 > ms) return resolve(false); setTimeout(tick, 200); };
      tick();
    });
  }

  async _reconnect() {
    this._set('loading', 'Reconnecting the Spotify player…');
    try { this.player?.disconnect(); } catch {}
    this.player = null; this.deviceId = null;
    await this.connect();
    return this._waitReady();
  }

  async _ensureDevice() {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!this.deviceId) break;
      try {
        const res = await this._api('GET', '/me/player/devices');
        const { devices = [] } = await res.json();
        if (devices.some(d => d.id === this.deviceId)) {
          await this._api('PUT', '/me/player', { device_ids: [this.deviceId], play: false }).catch(() => {});
          await this._sleep(400);
          return true;
        }
      } catch {}
      await this._sleep(700 * (attempt + 1));
    }
    if (!(await this._reconnect())) return false;
    await this._api('PUT', '/me/player', { device_ids: [this.deviceId], play: false }).catch(() => {});
    await this._sleep(600);
    return true;
  }

  /** PUT /me/player/play on this device, recovering from a stale/unknown device once. */
  async _play(body) {
    if (!this.deviceId && !(await this._reconnect())) throw new Error('The Spotify player is not connected. Check Premium, the app’s User Management allow-list, and that this browser supports DRM playback.');
    const send = () => this._api('PUT', `/me/player/play?device_id=${encodeURIComponent(this.deviceId)}`, body);
    try { return await send(); }
    catch (e) {
      if (e.status !== 404) throw e;
      this._set('loading', 'Waking up the Spotify player…');
      if (!(await this._ensureDevice())) throw new Error('Spotify can’t see this browser as a playback device. Reload the page and press Connect again; if it persists, open the Spotify app once on any device and retry.');
      const res = await send();
      this._set('buffering', ''); // the SDK's next state event replaces this
      return res;
    }
  }

  /** Add a track to the Spotify queue on this device. */
  async addToQueue(uri) {
    if (!this.deviceId && !(await this._reconnect())) throw new Error('Connect the Spotify player first.');
    const send = () => this._api('POST', `/me/player/queue?uri=${encodeURIComponent(uri)}&device_id=${encodeURIComponent(this.deviceId)}`, undefined, 'add to your queue');
    try { await send(); }
    catch (e) { if (e.status !== 404 || !(await this._ensureDevice())) throw e; await send(); }
  }

  /** The signed-in user's playlists (GET /me/playlists — available to Development-Mode apps in 2026). */
  async fetchPlaylists(max = 500) {
    const out = [];
    let path = '/me/playlists?limit=50';
    while (path && out.length < max) {
      const res = await this._api('GET', path, undefined, 'list your playlists');
      const j = await res.json();
      for (const p of j.items || []) {
        if (!p) continue;
        const imgs = p.images || [];
        out.push({
          id: p.id, name: p.name, uri: p.uri, url: p.external_urls?.spotify || `https://open.spotify.com/playlist/${p.id}`,
          image: (imgs.find(i => (i.width || 300) <= 320) || imgs[0])?.url || null,
          // Feb 2026 renamed playlist `tracks` → `items`; support both shapes.
          count: p.items?.total ?? p.tracks?.total ?? null,
          owner: p.owner?.display_name || '',
        });
      }
      path = j.next ? j.next.replace('https://api.spotify.com/v1', '') : null;
    }
    return out;
  }

  async _api(method, path, body, what = '') {
    const token = await getAccessToken(this.getClientId());
    if (!token) throw new Error('Not signed in to Spotify.');
    const res = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const fail = (status, msg) => Object.assign(new Error(msg), { status });
    if (res.status === 403) throw fail(403, what
      ? `Spotify refused to ${what} (403). Sign out and connect again to grant the new permission, and make sure your account is on the app’s User Management allow-list.`
      : 'Spotify refused the request (403). Premium is required, and Development-Mode apps only allow users on the app’s allow-list.');
    if (res.status === 404) throw fail(404, 'Spotify can’t find this player device (404).');
    if (!res.ok && res.status !== 204) { let msg = `HTTP ${res.status}`; try { msg = (await res.json()).error?.message || msg; } catch {} throw fail(res.status, `Spotify API: ${msg}`); }
    return res;
  }

  /** True when the SDK has a track loaded (otherwise resume/toggle fail with “no list was loaded”). */
  get hasTrack() { return !!this.sdkState?.track_window?.current_track; }

  /** Start something when nothing is loaded: resume the account's last context on this device. */
  async _startFromIdle() {
    this.player?.activateElement?.();
    try {
      await this._play();
      setTimeout(() => { if (!this.hasTrack) this._set('ready', 'Pick one of your playlists in Library › Sources to start playing.'); this.dispatchEvent(new Event('needs-selection')); }, 2500);
    } catch {
      this._set('ready', 'Pick one of your playlists in Library › Sources to start playing.');
      this.dispatchEvent(new Event('needs-selection'));
    }
  }

  play() { return this.hasTrack ? this.player?.resume() : this._startFromIdle(); }
  pause() { return this.player?.pause(); }
  toggle() { this.player?.activateElement?.(); return this.hasTrack ? this.player?.togglePlay() : this._startFromIdle(); }
  next() { return this.player?.nextTrack(); }
  previous() { return this.player?.previousTrack(); }
  seek(sec) { return this.player?.seek(Math.round(sec * 1000)); }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.muted = false; this.player?.setVolume(this.volume); this._emit(); }
  setMuted(m) { this.muted = !!m; this.player?.setVolume(m ? 0 : this.volume); this._emit(); }
  async toggleShuffle() {
    const next = !(this.sdkState?.shuffle);
    try { await this._api('PUT', `/me/player/shuffle?state=${next}&device_id=${this.deviceId}`); } catch (e) { this._set('error', e.message); }
  }
  async cycleRepeat() {
    const cur = this.sdkState?.repeat_mode ?? 0, next = ['context', 'track', 'off'][cur];
    try { await this._api('PUT', `/me/player/repeat?state=${next}&device_id=${this.deviceId}`); } catch (e) { this._set('error', e.message); }
  }

  get state() {
    const s = this.sdkState;
    const t = s?.track_window?.current_track;
    const playing = !!s && !s.paused;
    const pos = s ? s.position / 1000 + (playing ? (performance.now() - this.stateAt) / 1000 : 0) : 0;
    const dur = s ? s.duration / 1000 : 0;
    return {
      status: this.status, message: this.message,
      track: t ? { title: t.name, artist: t.artists.map(a => a.name).join(', '), album: t.album?.name || '', artwork: t.album?.images?.[0]?.url || null, kind: 'spotify' } : null,
      position: Math.min(pos, dur || pos), duration: dur, volume: this.volume, muted: this.muted,
      shuffle: !!s?.shuffle, repeat: ['off', 'all', 'one'][s?.repeat_mode ?? 0],
      queue: s ? [
        ...(t ? [{ id: t.uri, title: t.name, artist: t.artists.map(a => a.name).join(', '), current: true }] : []),
        ...(s.track_window.next_tracks || []).map(n => ({ id: n.uri, title: n.name, artist: n.artists.map(a => a.name).join(', '), current: false })),
      ] : [],
      index: 0, playing,
    };
  }

  _set(status, message) { this.status = status; this.message = message; this._emit(); }
  _emit() { this.dispatchEvent(new Event('state')); }
}
