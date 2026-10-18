/**
 * app.js — wires settings, worlds, hologram, backdrop and the player together.
 *
 * Separation of concerns:
 *   themeManager  → presentation only (CSS tokens, data-theme)
 *   PlayerController + providers → playback only
 *   HologramEngine / Backdrop → visuals only, fed by an input layer that is
 *   either a genuine analyser or an honest ambient generator.
 * Changing world never calls into the player, so playback, position and
 * queue are untouched by theme switches.
 */
import { settings } from './settings.js';
import { THEMES, getTheme, neighbourTheme } from './theme-registry.js';
import { themeManager } from './theme-manager.js';
import { HologramEngine } from './hologram/hologram-engine.js';
import { Backdrop, requestThumbnail } from './hologram/backdrops.js';
import { BUILD } from './version.js';
import { AudioAnalyser, AmbientSource } from './audio-analyser.js';
import { PlayerController, formatTime, EMPTY_CAPS, EMPTY_STATE } from './player/player-adapter.js';
import { MediaProvider } from './player/media-provider.js';
import { lazyProvider } from './player/lazy-provider.js';
import { SPOTIFY_CLIENT_ID } from './config.js';
import * as X from './experience.js';
// Spotify modules (embed, SDK, PKCE helpers) are NOT imported here: they load on first use.

/** Same formula as spotify-common.js (kept here so Settings can show it without loading Spotify code). */
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
const hasSpotifySession = () => { try { return !!sessionStorage.getItem('rw:spotify:token'); } catch { return false; } };

const $ = sel => document.querySelector(sel);
const root = document.documentElement;

/* ---- Toast ---- */
let toastTimer;
function toast(msg, ms = 3200, action = null) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('has-action', !!action);
  if (action) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-accent'; b.textContent = action.label;
    b.addEventListener('click', action.run); el.append(' ', b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const clientId = () => settings.get('spotifyClientId') || SPOTIFY_CLIENT_ID;

/* ---- Audio input + player ---- */
const analyser = new AudioAnalyser();
const ambient = new AmbientSource();
const player = new PlayerController();
const media = player.register(new MediaProvider(analyser));
const noop = () => async () => {};
const embed = player.register(lazyProvider({
  id: 'spotify-embed', label: 'Spotify embed',
  load: () => import('./player/spotify-embed.js').then(m => new m.SpotifyEmbedProvider($('#spotify-surface'))),
  methods: ['activate', 'load', 'play', 'pause', 'toggle', 'seek', '_onReady'],
  defaults: { capabilities: EMPTY_CAPS, state: EMPTY_STATE, entity: null, status: 'idle', message: '', deactivate: noop },
}));
const sdk = player.register(lazyProvider({
  id: 'spotify-sdk', label: 'Spotify Premium (Web Playback SDK)',
  load: () => import('./player/spotify-sdk.js').then(m => new m.SpotifySdkProvider(clientId)),
  methods: ['activate', 'login', 'logout', 'connect', 'playLink', 'search', 'playItem', 'addToQueue', 'fetchPlaylists', 'play', 'pause', 'toggle', 'next', 'previous', 'seek', 'setVolume', 'setMuted', 'toggleShuffle', 'cycleRepeat'],
  defaults: {
    signedIn: () => hasSpotifySession(), configured: () => !!clientId(), deviceId: null, player: null, hasTrack: false, sdkState: null,
    capabilities: EMPTY_CAPS, state: EMPTY_STATE, status: 'auth-required', message: 'Connect your Spotify Premium account to play here.', deactivate: noop,
  },
  events: ['state', 'needs-selection'],
}));

/* ---- Visualizer input resolution (honest labelling) ---- */
let vizMode = 'ambient';
function resolveVizMode() {
  const pref = settings.get('vizInput');
  const idle = ambient.bpm ? 'beat' : 'ambient';
  if (pref === 'ambient') return idle;
  const ext = analyser.externalKind; // 'mic' | 'tab' | null
  if (ext) return ext;
  if (pref === 'mic') return idle;
  const caps = player.capabilities, st = player.state;
  if (caps.analysable && st.playing) return 'player';
  return idle;
}
function updateVizChip() {
  const mode = resolveVizMode();
  if (mode !== vizMode || !updateVizChip.done) {
    vizMode = mode; updateVizChip.done = true;
    analyser.setInput(mode === 'mic' || mode === 'tab' ? 'ext' : 'media');
    const chip = $('#viz-mode');
    const spotify = player.active?.id?.startsWith('spotify');
    const labels = {
      player: ['Audio reactive · REVERB player', 'The hologram analyses the audio playing in this page (approximate onset detection, not exact beat tracking).'],
      mic: ['Audio reactive · Microphone', 'The hologram analyses your microphone input locally. Nothing is recorded or sent.'],
      tab: ['Audio reactive · Tab audio', 'The hologram analyses this tab’s own audio, shared by you. Nothing is recorded or sent.'],
      beat: [`Beat clock · ${Math.round(ambient.bpm)} BPM (tapped)`, 'Pulses are locked to the tempo you tapped — not analysed from the audio. Tap again to re-sync.'],
      ambient: [spotify ? 'Ambient animation · not synced to Spotify' : 'Ambient animation', spotify ? 'Spotify audio is protected and cannot be analysed in the browser. Use Tap tempo (T), or Library › Sources › Live audio (microphone or tab capture), to sync the hologram.' : 'Not driven by audio. Play REVERB Originals, your own files or enable the microphone for audio-reactive visuals.'],
    };
    chip.textContent = labels[mode][0];
    chip.title = labels[mode][1];
    chip.dataset.live = mode !== 'ambient' ? 'true' : 'false';
    $('#btn-tap-clear').hidden = !ambient.bpm;
  }
}

let lastFeat = performance.now();
let onsetCount = 0;
function getFeatures() {
  const now = performance.now(), dt = Math.min(0.1, (now - lastFeat) / 1000);
  lastFeat = now;
  updateVizChip();
  if (vizMode === 'ambient' || vizMode === 'beat') return ambient.read(dt);
  return analyser.read(now);
}

/* ---- Hologram + backdrop ---- */
const engine = new HologramEngine($('#hologram'), {
  getFeatures,
  onForm: ({ label }) => {
    $('#form-name').textContent = label;
    $('#hologram').setAttribute('aria-label', `Hologram showing: ${label}. Drag, or use the arrow keys, to rotate. Double-click or press Home to reset.`);
    lastMorph = performance.now();
    if (typeof syncFavUi === 'function') { syncFavUi(); saveSessionSoon(); }
  },
  onQualityChange: tier => { root.dataset.quality = tier === 'low' ? 'low' : 'normal'; if (tier !== 'high') root.dataset.blur = 'off'; },
  // Auto quality: on sustained slow frames, turn the frosted-glass panel blur off before anything else.
  onSlow: () => {
    if (settings.get('quality') !== 'auto' || root.dataset.blur === 'off') return false;
    root.dataset.blur = 'off';
    return true;
  },
  onOnset: kind => { if (kind === 'kick' && vizMode !== 'ambient') onsetCount++; },
});
const backdrop = new Backdrop($('#backdrop'), { getReactive: () => engine.reactive });

function visualsActive() { return !visualsPaused && settings.get('motion') !== 'static' && !document.hidden; }
let visualsPaused = false;

/* ---- covered / off-screen throttling ----
 * Sheets and dialogs that cover the stage cut the hologram to ~8 fps and the
 * backdrop to 5 fps; when the stage is scrolled out of view the hologram stops. */
let stageVisible = true;
function updateCoverage() {
  const covered = ($('#library-panel').classList.contains('open') && window.matchMedia('(max-width: 1100px)').matches)
    || $('#player').classList.contains('expanded') || $('#settings').open;
  engine.setThrottle(covered ? 8 : 0);
  backdrop.setCovered(covered);
  root.dataset.covered = covered ? 'true' : 'false';
}
try {
  new IntersectionObserver(([en]) => { stageVisible = en.isIntersecting; syncRunning(); }, { threshold: 0.02 }).observe($('.stage'));
} catch {}

function applyVisualOptions() {
  const motion = settings.get('motion');
  root.dataset.motion = motion;
  engine.setOptions({ motion, intensity: settings.get('intensity') / 100, glitch: settings.get('glitch') / 100, reduceFlashing: settings.get('reduceFlashing'), quality: settings.get('quality') });
  backdrop.setOptions({ motion: visualsPaused ? 'static' : motion, quality: settings.get('quality') === 'low' ? 'low' : 'high', enabled: settings.get('backdrop'), glitch: settings.get('glitch') / 100 });
  root.dataset.quality = settings.get('quality') === 'low' ? 'low' : 'normal';
  const q = settings.get('quality');
  root.dataset.blur = q === 'low' ? 'off' : q === 'high' ? 'on' : (root.dataset.blur || 'on');
  syncRunning();
}

function syncRunning() {
  if (visualsActive()) { if (stageVisible) engine.start(); else engine.stop(); if (settings.get('backdrop') && settings.get('motion') === 'full') backdrop.start(); else { backdrop.stop(); backdrop.renderOnce(); } }
  else { engine.stop(); engine.renderOnce(); backdrop.stop(); backdrop.renderOnce(); }
}

document.addEventListener('visibilitychange', syncRunning);

/* ---- Worlds ---- */
function worldFromHash() {
  const m = /world=([a-z]+)/.exec(location.hash);
  return m && THEMES.some(t => t.id === m[1]) ? m[1] : null;
}

themeManager.addEventListener('change', e => {
  const { theme, source } = e.detail;
  $('#world-num').textContent = theme.num;
  $('#world-name').textContent = theme.name;
  $('#world-tagline').textContent = theme.tagline;
  $('#world-mood').textContent = theme.mood;
  $('#world-total').textContent = String(THEMES.length);
  engine.setTheme(theme);
  backdrop.setTheme(theme);
  document.querySelectorAll('.world-card').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.id === theme.id)));
  const url = `${location.pathname}${location.search}#world=${theme.id}`;
  history.replaceState(null, '', url);
  if (source === 'auto') toast(`World ${theme.num} — ${theme.name}`, 1800);
  lastWorld = performance.now();
});

function buildWorldGrid() {
  const grid = $('#world-grid');
  const frag = document.createDocumentFragment();
  for (const t of THEMES) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'world-card'; b.dataset.id = t.id;
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', `World ${t.num}: ${t.name} — ${t.mood}`);
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; c.setAttribute('aria-hidden', 'true');
    const body = document.createElement('span'); body.className = 'wc-body';
    body.innerHTML = `<span class="wc-num"><span>${t.num} <span class="wc-fav" hidden>★ Favourite</span></span><span class="wc-selected">Selected</span></span><span class="wc-name"></span><span class="wc-mood"></span>`;
    body.querySelector('.wc-name').textContent = t.name;
    body.querySelector('.wc-mood').textContent = t.mood;
    b.append(c, body);
    b.addEventListener('click', () => themeManager.apply(t.id, 'user'));
    li.className = 'world-card-wrap';
    const star = document.createElement('button');
    star.type = 'button'; star.className = 'btn btn-icon fav-btn'; star.dataset.favWorld = t.id;
    star.innerHTML = '<span aria-hidden="true">☆</span>';
    star.addEventListener('click', () => toggleFav('worlds', t.id, t.name));
    li.append(b, star); frag.append(li);
  }
  grid.append(frag);
  // Draw procedural thumbnails lazily (keeps first paint fast).
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const card = en.target; io.unobserve(card);
      requestThumbnail(getTheme(card.dataset.id), card.querySelector('canvas'), BUILD);
    }
  }, { rootMargin: '200px' });
  grid.querySelectorAll('.world-card').forEach(c => io.observe(c));
}

/* ---- Auto-morph / auto-world scheduler ---- */
let lastMorph = performance.now(), lastWorld = performance.now();
setInterval(() => {
  const now = performance.now();
  if (settings.get('autoMorph') && visualsActive()) {
    const byOnsets = settings.get('autoMorphTrigger') === 'onsets' && vizMode !== 'ambient';
    if (byOnsets ? onsetCount >= 16 : now - lastMorph >= settings.get('autoMorphInterval') * 1000) { onsetCount = 0; engine.morph(); }
  }
  if (settings.get('autoWorld') && !document.hidden && now - lastWorld >= settings.get('autoWorldInterval') * 1000) {
    themeManager.apply(neighbourTheme(themeManager.current.id, 1).id, 'auto');
  }
}, 250);

/* ---- Player UI ---- */
const ui = {
  play: $('#pl-play'), prev: $('#pl-prev'), next: $('#pl-next'), shuffle: $('#pl-shuffle'), repeat: $('#pl-repeat'),
  seek: $('#pl-seek'), elapsed: $('#pl-elapsed'), total: $('#pl-total'), mute: $('#pl-mute'), volume: $('#pl-volume'),
  title: $('#pl-title'), artist: $('#pl-artist'), art: $('#pl-art'),
};
let seeking = false;

function setRangeFill(el) { const pct = ((el.value - el.min) / (el.max - el.min)) * 100; el.style.setProperty('--pct', `${pct}%`); }

function renderPlayer() {
  const { state: st, capabilities: caps } = player;
  const label = player.active?.label || '';
  // capability-driven visibility: unsupported controls are removed, not faked
  ui.prev.hidden = !caps.previous; ui.next.hidden = !caps.next;
  ui.shuffle.hidden = !caps.shuffle; ui.repeat.hidden = !caps.repeat;
  ui.mute.hidden = !caps.mute; ui.volume.hidden = !caps.volume;
  ui.play.disabled = !caps.playPause;
  ui.seek.disabled = !caps.seek || !st.duration;
  ui.seek.setAttribute('aria-label', caps.seek ? 'Seek' : 'Playback progress (seeking is not available for this source)');

  const playing = !!st.playing || st.status === 'playing';
  ui.play.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  ui.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  ui.shuffle.setAttribute('aria-pressed', String(!!st.shuffle));
  ui.shuffle.setAttribute('aria-label', `Shuffle: ${st.shuffle ? 'on' : 'off'}`);
  ui.repeat.dataset.mode = st.repeat;
  ui.repeat.setAttribute('aria-pressed', String(st.repeat !== 'off'));
  ui.repeat.setAttribute('aria-label', `Repeat: ${{ off: 'off', all: 'all', one: 'one track' }[st.repeat]}`);
  const muted = st.muted || st.volume === 0;
  ui.mute.querySelector('use').setAttribute('href', muted ? '#i-mute' : '#i-volume');
  ui.mute.setAttribute('aria-pressed', String(muted));
  ui.mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  if (document.activeElement !== ui.volume) { ui.volume.value = Math.round((st.muted ? 0 : st.volume) * 100); setRangeFill(ui.volume); }

  const t = st.track;
  const title = t?.title || 'Nothing playing';
  ui.title.textContent = title; $('#np-title').textContent = t?.title || '—';
  ui.artist.textContent = t?.artist || ''; $('#np-artist').textContent = t?.artist || '';
  $('#np-source').textContent = label;
  for (const el of [ui.art, $('#np-art')]) el.style.backgroundImage = t?.artwork ? `url("${t.artwork}")` : '';

  const status = $('#np-status');
  const statusText = { loading: st.message, buffering: st.message || 'Buffering…', error: st.message, unavailable: st.message, 'auth-required': st.message, ended: 'Finished.', ready: st.message, idle: st.message }[st.status] ?? st.message;
  status.textContent = statusText || '';
  status.dataset.tone = ['error', 'unavailable'].includes(st.status) ? 'error' : 'info';

  renderQueue(st, caps);
  renderProgress();
  updateMediaSession(st, caps);
  updateSdkUi();
  updateVizChip.done = false; updateVizChip();
  if (!engine.running) engine.renderOnce();
  $('#src-files-clear').hidden = !media.items.some(i => i.kind === 'file');
}

function renderProgress() {
  const st = player.state;
  const dur = st.duration || 0, pos = Math.min(st.position || 0, dur || Infinity);
  if (!seeking) {
    ui.seek.value = dur ? Math.round((pos / dur) * 1000) : 0;
    ui.elapsed.textContent = formatTime(pos);
  }
  ui.total.textContent = dur ? formatTime(dur) : '–:––';
  ui.seek.setAttribute('aria-valuetext', `${formatTime(seeking ? (ui.seek.value / 1000) * dur : pos)} of ${formatTime(dur)}`);
  setRangeFill(ui.seek);
  $('#player').style.setProperty('--progress', `${dur ? (pos / dur) * 100 : 0}%`);
}
setInterval(() => { if (player.state.playing || player.state.status === 'playing') renderProgress(); }, 250);

function renderQueue(st, caps) {
  const list = $('#queue'), note = $('#queue-note');
  const q = st.queue || [];
  const filter = ($('#search').value || '').trim().toLowerCase();
  if (player.active?.id === 'spotify-embed') note.textContent = 'The Spotify embed manages its own tracklist. Use the controls inside the embed to skip tracks.';
  else if (player.active?.id === 'spotify-sdk') note.textContent = q.length ? 'Up next on Spotify (read-only).' : 'Connect Spotify and play a link to see what’s next.';
  else note.textContent = q.length ? '' : 'Your queue is empty. Add REVERB Originals or your own files from Sources.';
  list.replaceChildren(...q.map((item, i) => {
    const li = document.createElement('li');
    const interactive = caps.queue === 'interactive';
    const el = document.createElement(interactive ? 'button' : 'div');
    el.className = 'queue-item';
    if (interactive) { el.type = 'button'; el.addEventListener('click', () => player.playIndex(item.index ?? i)); el.setAttribute('aria-label', `Play ${item.title} by ${item.artist}`); }
    if (item.current) el.setAttribute('aria-current', 'true');
    el.innerHTML = `<span class="q-num">${String(i + 1).padStart(2, '0')}</span><span><span class="q-title"></span><span class="q-artist"></span></span>${item.current ? '<span class="q-now">Now</span>' : '<span></span>'}`;
    el.querySelector('.q-title').textContent = item.title;
    el.querySelector('.q-artist').textContent = item.artist;
    if (filter && !`${item.title} ${item.artist}`.toLowerCase().includes(filter)) li.hidden = true;
    li.append(el);
    if (player.active?.id === 'media' && /^demo:/.test(item.id || '')) {
      const id = item.id.slice(5), on = X.favs.has('tracks', id), s = document.createElement('button');
      s.type = 'button'; s.className = 'btn btn-icon btn-flat fav-btn'; s.setAttribute('aria-pressed', String(on));
      s.setAttribute('aria-label', on ? `Remove ${item.title} from favourites` : `Add ${item.title} to favourites`);
      s.innerHTML = `<span aria-hidden="true">${on ? '★' : '☆'}</span>`;
      s.addEventListener('click', () => toggleFav('tracks', id, item.title));
      li.append(s);
    }
    return li;
  }));
}

player.addEventListener('state', renderPlayer);

ui.play.addEventListener('click', () => { analyser.ensureContext(); player.toggle(); });
ui.prev.addEventListener('click', () => player.previous());
ui.next.addEventListener('click', () => player.next());
ui.shuffle.addEventListener('click', () => player.toggleShuffle());
ui.repeat.addEventListener('click', () => player.cycleRepeat());
ui.mute.addEventListener('click', () => { const st = player.state; player.setMuted(!(st.muted || st.volume === 0)); settings.set('muted', !st.muted); });
ui.volume.addEventListener('input', () => { setRangeFill(ui.volume); player.setVolume(ui.volume.value / 100); settings.set('volume', ui.volume.value / 100); });
ui.seek.addEventListener('input', () => { seeking = true; const dur = player.state.duration || 0; ui.elapsed.textContent = formatTime((ui.seek.value / 1000) * dur); setRangeFill(ui.seek); });
ui.seek.addEventListener('change', () => { const dur = player.state.duration || 0; player.seek((ui.seek.value / 1000) * dur); seeking = false; renderProgress(); });
ui.seek.addEventListener('blur', () => { seeking = false; });

$('#pl-expand').addEventListener('click', () => {
  queueMicrotask(updateCoverage);
  const p = $('#player'), open = !p.classList.contains('expanded');
  p.classList.toggle('expanded', open);
  $('#pl-expand').setAttribute('aria-expanded', String(open));
  $('#pl-expand').setAttribute('aria-label', open ? 'Collapse player' : 'Expand player');
});

/* Media Session (lock-screen / hardware keys) — only for supported actions */
function updateMediaSession(st, caps) {
  if (!('mediaSession' in navigator) || player.active?.id !== 'media') return;
  const t = st.track;
  try {
    navigator.mediaSession.metadata = t ? new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '', artwork: t.artwork ? [{ src: t.artwork, sizes: '256x256', type: 'image/png' }] : [] }) : null;
    navigator.mediaSession.playbackState = st.playing ? 'playing' : 'paused';
  } catch {}
}
if ('mediaSession' in navigator) {
  const h = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch {} };
  h('play', () => player.play()); h('pause', () => player.pause());
  h('nexttrack', () => player.next()); h('previoustrack', () => player.previous());
  h('seekto', d => player.seek(d.seekTime));
}

/* ---- Library sheet, tabs and sources ---- */
const sheetMQ = window.matchMedia('(max-width: 1100px)');
function openLibrary(open, tab) {
  queueMicrotask(updateCoverage);
  const lib = $('#library-panel');
  if (tab) selectTab(tab);
  if (!sheetMQ.matches) { if (open) lib.querySelector('[aria-selected="true"]').focus(); return; }
  lib.classList.toggle('open', open);
  $('#sheet-backdrop').hidden = !open;
  $('#nav-library').setAttribute('aria-expanded', String(open));
  if (open) lib.querySelector('[aria-selected="true"]').focus();
}
$('#nav-library').addEventListener('click', () => openLibrary(!$('#library-panel').classList.contains('open') || !sheetMQ.matches));
$('#pl-queue').addEventListener('click', () => openLibrary(true, 'queue'));
$('#library-close').addEventListener('click', () => { openLibrary(false); $('#nav-library').focus(); });
$('#sheet-backdrop').addEventListener('click', () => openLibrary(false));

const TABS = ['queue', 'sources', 'saved'];
function selectTab(name) {
  for (const t of TABS) {
    const tab = $(`#tab-${t}`), pane = $(`#pane-${t}`), on = t === name;
    tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; pane.hidden = !on;
  }
  if (name === 'saved') loadFeature('saved-panel').then(m => m.render()).catch(err => console.warn(err));
  if (name === 'sources') loadSpotifyUi().catch(err => console.warn(err));
}
for (const t of TABS) {
  $(`#tab-${t}`).addEventListener('click', () => selectTab(t));
  $(`#tab-${t}`).addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const other = TABS[(TABS.indexOf(t) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      selectTab(other); $(`#tab-${other}`).focus(); e.preventDefault();
    }
  });
}

/* ---------------- v1.1: favourites, experiences, lazy feature modules ---------------- */
const xctx = () => ({ engine, media, player, settings, themeManager, ambient });
function toggleFav(kind, id, label) {
  const on = X.favs.toggle(kind, id);
  toast(on ? `★ ${label} added to favourites.` : `${label} removed from favourites.`, 1800);
  syncFavUi();
  if (kind === 'tracks') renderQueue(player.state, player.capabilities);
  window.dispatchEvent(new Event('reverb:favs'));
}
function setStar(btn, on, label) {
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? `Remove ${label} from favourites` : `Add ${label} to favourites`);
  btn.title = on ? 'Favourite' : 'Add to favourites';
  btn.querySelector('span').textContent = on ? '★' : '☆';
}
function syncFavUi() {
  const f = X.favs.all(), t = themeManager.current, form = engine.toForm;
  document.querySelectorAll('[data-fav-world]').forEach(b => {
    const id = b.dataset.favWorld, on = f.worlds.includes(id);
    setStar(b, on, getTheme(id).name);
    b.closest('li').querySelector('.wc-fav').hidden = !on;
  });
  if (t) setStar($('#fav-world'), f.worlds.includes(t.id), `the ${t.name} world`);
  if (form) setStar($('#fav-form'), f.forms.includes(form.id), `the ${form.label} shape`);
}
$('#fav-world').addEventListener('click', () => toggleFav('worlds', themeManager.current.id, themeManager.current.name));
$('#fav-form').addEventListener('click', () => { const f = engine.toForm; if (f) toggleFav('forms', f.id, f.label); });

/** Lazy feature modules (Saved panel, Info panel, Tour): downloaded on first use only. */
const features = {};
function loadFeature(name) {
  return (features[name] ||= import(`./features/${name}.js`).then(m => {
    m.init?.({ $, X, xctx, engine, media, player, settings, themeManager, ambient, analyser, THEMES, getTheme, toast, openLibrary, selectTab, toggleFav, syncFavUi, renderQueue, useMedia: () => player.use('media'), loadFeature, sdk, embed, clientId });
    return m;
  }));
}
$('#btn-info').addEventListener('click', () => loadFeature('info-panel').then(m => m.toggle()));
$('#btn-tour').addEventListener('click', () => loadFeature('tour').then(m => m.start()));

/* ---------------- Continue Last Session ----------------
 * The current Experience (+ track position) is auto-saved; on the next visit
 * the world, shape and view come back and the track is cued, paused at the
 * same spot, with a Resume prompt (browsers don't allow autoplay). */
let sessionTimer = 0, sessionReady = false;
function saveSessionSoon() {
  if (!sessionReady) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => X.session.save(X.capture(xctx()), player.state.position || 0), 700);
}
function restoreSession() {
  const s = X.session.load();
  if (!s) return;
  const { exp } = s;
  // A deep link (#world=…) wins over the saved world; the rest still restores if it fits.
  const linked = worldFromHash();
  if (!linked || linked === exp.world) X.apply(exp, xctx(), { includeSettings: false }); // settings already persist on their own
  if (exp.source?.type === 'reverb') {
    const idx = media.items.findIndex(it => it.id === `demo:${exp.source.id}`);
    if (idx >= 0 && media.cue(idx, s.position)) {
      const title = media.items[idx].title, at = s.position > 1 ? ` from ${formatTime(s.position)}` : '';
      toast(`Welcome back. Continue “${title}”${at}?`, 12000, { label: 'Resume', run: () => { analyser.ensureContext(); player.play(); $('#toast').classList.remove('show'); } });
    }
  } else if (exp.source?.type === 'spotify') {
    toast(`Last time you were listening on Spotify${exp.source.title ? ` (“${exp.source.title}”)` : ''}. Pick it up in Library › Sources.`, 8000);
  }
}
themeManager.addEventListener('change', () => { syncFavUi(); saveSessionSoon(); });
settings.addEventListener('change', saveSessionSoon);
player.addEventListener('state', () => { if (player.state.index !== saveSessionSoon.lastIndex) { saveSessionSoon.lastIndex = player.state.index; saveSessionSoon(); } });
setInterval(() => { if (player.state.playing) saveSessionSoon(); }, 5000);
$('#hologram').addEventListener('pointerup', saveSessionSoon);
window.addEventListener('pagehide', () => { if (sessionReady) X.session.save(X.capture(xctx()), player.state.position || 0); });

async function useMedia() { if (player.active !== media) await player.use('media'); }

$('#src-demo-load').addEventListener('click', async () => {
  analyser.ensureContext();
  await useMedia();
  if (media.items.some(i => i.kind === 'file') || !media.items.length) media.loadDemoPlaylist();
  media.playIndex(0);
  selectTab('queue');
});

async function addFiles(files) {
  analyser.ensureContext();
  await useMedia();
  const onlyDemo = media.items.every(i => i.kind === 'demo');
  const before = media.items.length;
  const n = media.addFiles(files, { replace: onlyDemo });
  if (!n) { toast('No playable audio files found.'); return; }
  toast(`${n} file${n > 1 ? 's' : ''} added — analysed locally, never uploaded.`);
  media.playIndex(onlyDemo ? 0 : before);
  selectTab('queue');
}
// Copy the FileList first: resetting the input empties the live list before the async handler reads it.
$('#file-input').addEventListener('change', e => { const files = Array.from(e.target.files || []); e.target.value = ''; addFiles(files); });
const dz = $('#dropzone');
['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); dz.classList.add('dragover'); } }));
['dragleave', 'drop'].forEach(ev => window.addEventListener(ev, () => dz.classList.remove('dragover')));
window.addEventListener('drop', e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); } });
$('#src-files-clear').addEventListener('click', () => { media.removeFiles(); toast('Your files were removed from the queue.'); });

$('#embed-form').addEventListener('submit', async e => {
  e.preventDefault();
  const v = $('#embed-input').value;
  await player.use('spotify-embed');
  const ok = await embed.load(v);
  if (ok) toast('Spotify embed loaded. The hologram runs in ambient mode for Spotify audio.');
});

function updateSdkUi() {
  const configured = !!clientId(), signedIn = sdk.signedIn, connected = !!sdk.deviceId;
  $('#sdk-login').hidden = signedIn;
  $('#sdk-login').disabled = !configured;
  $('#sdk-connect').hidden = !signedIn || connected;
  $('#sdk-logout').hidden = !signedIn;
  $('#sdk-form').hidden = !connected;
  spotifyUi?.updatePlaylistsUi(); spotifyUi?.updateSearchUi();
  const note = $('#sdk-note');
  if (!configured) note.textContent = 'Not configured: add your Spotify Client ID in Settings. Requires Spotify Premium and a supported desktop browser.';
  else if (player.active === sdk && sdk.message) note.textContent = sdk.message;
  else if (signedIn) note.textContent = 'Signed in to Spotify. Start the player to play here.';
  else note.textContent = 'Client ID set. Connect with a Spotify Premium account (Development-Mode apps only allow users you add in the dashboard).';
}
$('#sdk-login').addEventListener('click', () => sdk.login());

/* ---------------- Spotify search & playlists: lazy (features/spotify-ui.js) ---------------- */
let spotifyUi = null;
const loadSpotifyUi = () => loadFeature('spotify-ui').then(m => (spotifyUi = m));
sdk.addEventListener('needs-selection', () => loadSpotifyUi().then(m => m.onNeedsSelection()));
$('#sdk-connect').addEventListener('click', async () => { await player.use('spotify-sdk'); await sdk.connect(); });
$('#sdk-logout').addEventListener('click', async () => { await sdk.logout(); spotifyUi?.reset(); await player.use('media'); updateSdkUi(); });
$('#sdk-form').addEventListener('submit', async e => { e.preventDefault(); await player.use('spotify-sdk'); await sdk.playLink($('#sdk-input').value); });

function syncLiveInputUi() {
  const k = analyser.externalKind;
  $('#mic-toggle').textContent = k === 'mic' ? 'Stop microphone' : 'Use microphone';
  $('#mic-toggle').setAttribute('aria-pressed', String(k === 'mic'));
  $('#tab-toggle').textContent = k === 'tab' ? 'Stop tab audio' : 'Capture this tab’s audio';
  $('#tab-toggle').setAttribute('aria-pressed', String(k === 'tab'));
  updateVizChip.done = false; updateVizChip();
}
analyser.onExternalEnded = kind => { toast(kind === 'tab' ? 'Tab audio sharing stopped.' : 'Microphone stopped.'); syncLiveInputUi(); };
$('#mic-toggle').addEventListener('click', async () => {
  if (analyser.externalKind === 'mic') { analyser.disableExternal(); toast('Microphone off.'); return syncLiveInputUi(); }
  try { await analyser.enableMicrophone(); toast('Microphone on — the hologram now reacts to what it hears.'); }
  catch (err) { toast(err.name === 'NotAllowedError' ? 'Microphone permission was denied.' : `Microphone unavailable: ${err.message}`, 4500); }
  syncLiveInputUi();
});
$('#tab-toggle').addEventListener('click', async () => {
  if (analyser.externalKind === 'tab') { analyser.disableExternal(); toast('Tab audio capture off.'); return syncLiveInputUi(); }
  try {
    await analyser.enableTabCapture();
    toast('Listening to this tab’s audio…');
    syncLiveInputUi();
    // Spotify's audio is DRM-protected; some browsers deliver it silent to captures. Check honestly.
    setTimeout(() => {
      if (analyser.externalKind !== 'tab') return;
      const playing = player.state.playing || player.state.status === 'playing';
      let peak = 0; for (let i = 0; i < 10; i++) peak = Math.max(peak, analyser.rawLevel());
      if (playing && peak < 0.004) {
        analyser.disableExternal(); syncLiveInputUi();
        toast('The tab capture is silent — your browser blocks protected Spotify audio from being captured. Use the microphone or Tap tempo instead.', 8000);
      }
    }, 4000);
  } catch (err) {
    toast(err.name === 'NotAllowedError' ? 'Tab audio sharing was cancelled.' : err.message, 6000);
    syncLiveInputUi();
  }
});

/* ---------------- Tap tempo (beat clock) ---------------- */
let taps = [];
function tapTempo() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  if (taps.length > 9) taps.shift();
  if (taps.length < 4) { toast(`Tap along to the beat… ${taps.length}/4`, 1200); return; }
  const iv = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b);
  const bpm = Math.max(50, Math.min(220, 60000 / iv[Math.floor(iv.length / 2)]));
  ambient.setTempo(bpm, now);
  updateVizChip.done = false; updateVizChip();
  toast(`Beat clock locked at ${Math.round(bpm)} BPM. Keep tapping to fine-tune.`, 1600);
}
$('#btn-tap').addEventListener('click', tapTempo);
$('#btn-tap-clear').addEventListener('click', () => { ambient.clearTempo(); taps = []; updateVizChip.done = false; updateVizChip(); toast('Beat clock cleared.'); });

/* ---- Stage controls ---- */
$('#btn-morph').addEventListener('click', () => { engine.morph(); onsetCount = 0; });
function syncToggles() {
  $('#btn-automorph').setAttribute('aria-pressed', String(settings.get('autoMorph')));
  $('#btn-autoworld').setAttribute('aria-pressed', String(settings.get('autoWorld')));
  $('#btn-pausefx').setAttribute('aria-pressed', String(visualsPaused));
  $('#btn-pausefx').querySelector('span:not(.toggle-dot)').textContent = visualsPaused ? 'Resume visuals' : 'Pause visuals';
}
$('#btn-automorph').addEventListener('click', () => { settings.set('autoMorph', !settings.get('autoMorph')); lastMorph = performance.now(); });
$('#btn-autoworld').addEventListener('click', () => { settings.set('autoWorld', !settings.get('autoWorld')); lastWorld = performance.now(); });
function togglePauseVisuals() { visualsPaused = !visualsPaused; syncToggles(); applyVisualOptions(); toast(visualsPaused ? 'Visuals paused.' : 'Visuals resumed.', 1400); }
$('#btn-pausefx').addEventListener('click', togglePauseVisuals);

$('#world-prev').addEventListener('click', () => themeManager.apply(neighbourTheme(themeManager.current.id, -1).id));
$('#world-next').addEventListener('click', () => themeManager.apply(neighbourTheme(themeManager.current.id, 1).id));
$('#nav-worlds').addEventListener('click', () => { const w = $('#worlds-panel'); w.scrollIntoView({ behavior: settings.get('motion') === 'full' ? 'smooth' : 'auto', block: 'start' }); w.focus({ preventScroll: true }); });

/* ---- Search ---- */
function applySearch() {
  const q = $('#search').value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('.world-card').forEach(card => {
    const t = getTheme(card.dataset.id);
    const hit = !q || `${t.name} ${t.tagline} ${t.mood} ${t.num}`.toLowerCase().includes(q);
    card.parentElement.hidden = !hit; if (hit) shown++;
  });
  $('#worlds-count').textContent = q ? `${shown} of ${THEMES.length} worlds match “${$('#search').value.trim()}”` : `${THEMES.length} worlds`;
  renderQueue(player.state, player.capabilities);
}
$('#search').addEventListener('input', applySearch);
$('#search-form').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('#search').value.trim().toLowerCase();
  if (!q) return;
  const worlds = THEMES.filter(t => `${t.name} ${t.tagline} ${t.mood} ${t.num}`.toLowerCase().includes(q));
  if (worlds.length === 1) { themeManager.apply(worlds[0].id); toast(`World: ${worlds[0].name}`); return; }
  const tracks = player.state.queue.filter(i => `${i.title} ${i.artist}`.toLowerCase().includes(q));
  if (tracks.length && player.capabilities.queue === 'interactive') { player.playIndex(tracks[0].index); toast(`Playing ${tracks[0].title}`); return; }
  if (sdk.signedIn) { openLibrary(true, 'sources'); $('#sp-search').value = $('#search').value.trim(); loadSpotifyUi().then(m => m.runSpotifySearch($('#sp-search').value)); $('#src-search').scrollIntoView({ block: 'start' }); return; }
  toast(worlds.length ? `${worlds.length} worlds match — pick one below.` : 'No worlds or tracks match.');
});

/* ---- Settings dialog ---- */
const dlg = $('#settings');
function fillSettings() {
  dlg.querySelectorAll('input[name="motion"]').forEach(r => { r.checked = r.value === settings.get('motion'); });
  const rng = (id, key, fmt) => { const el = $(id); el.value = settings.get(key); $(id.replace('set-', 'out-')).textContent = fmt(settings.get(key)); };
  rng('#set-intensity', 'intensity', v => `${v}%`);
  rng('#set-glitch', 'glitch', v => `${v}%`);
  rng('#set-morph-int', 'autoMorphInterval', v => `${v}s`);
  rng('#set-world-int', 'autoWorldInterval', v => (v >= 60 ? `${(v / 60).toFixed(v % 60 ? 1 : 0)}m` : `${v}s`));
  $('#set-flash').checked = settings.get('reduceFlashing');
  $('#set-backdrop').checked = settings.get('backdrop');
  $('#set-quality').value = settings.get('quality');
  $('#set-trigger').value = settings.get('autoMorphTrigger');
  $('#set-viz').value = settings.get('vizInput');
  $('#set-client').value = settings.get('spotifyClientId') || '';
  $('#set-client').placeholder = SPOTIFY_CLIENT_ID ? `Using site default (${SPOTIFY_CLIENT_ID.slice(0, 6)}…)` : '32-character Client ID';
  $('#redirect-uri').textContent = redirectUri();
}
$('#nav-settings').addEventListener('click', () => { fillSettings(); dlg.showModal(); updateCoverage(); });
dlg.addEventListener('close', () => { $('#nav-settings').focus(); updateCoverage(); });
dlg.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'motion') settings.set('motion', t.value);
  if (t.id === 'set-flash') settings.set('reduceFlashing', t.checked);
  if (t.id === 'set-backdrop') settings.set('backdrop', t.checked);
  if (t.id === 'set-quality') settings.set('quality', t.value);
  if (t.id === 'set-trigger') settings.set('autoMorphTrigger', t.value);
  if (t.id === 'set-viz') {
    settings.set('vizInput', t.value);
    if (t.value === 'mic' && !analyser.externalKind) $('#mic-toggle').click();
  }
  if (t.id === 'set-client') {
    const v = t.value.trim();
    if (/^[0-9a-zA-Z]{0,64}$/.test(v)) { settings.set('spotifyClientId', v); toast(v ? 'Spotify Client ID saved in this browser.' : 'Spotify Client ID cleared.'); }
    else toast('That doesn’t look like a Client ID (letters and digits only).');
  }
});
dlg.addEventListener('input', e => {
  const t = e.target, map = { 'set-intensity': 'intensity', 'set-glitch': 'glitch', 'set-morph-int': 'autoMorphInterval', 'set-world-int': 'autoWorldInterval' };
  if (map[t.id]) { settings.set(map[t.id], Number(t.value)); fillSettings(); }
});
$('#set-reset').addEventListener('click', () => { settings.reset(); fillSettings(); toast('Preferences reset.'); });

settings.addEventListener('change', e => {
  const k = e.detail.key;
  if (['motion', 'intensity', 'glitch', 'reduceFlashing', 'quality', 'backdrop'].includes(k)) applyVisualOptions();
  if (k === 'autoMorph' || k === 'autoWorld') syncToggles();
  if (k === 'vizInput') { updateVizChip.done = false; updateVizChip(); }
  if (k === 'spotifyClientId') updateSdkUi();
});
// Follow OS reduced-motion changes live (user can still override in Settings).
try {
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => settings.set('motion', e.matches ? 'reduced' : 'full'));
} catch {}

/* ---- Keyboard ---- */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (features.tour) features.tour.then(m => m.stop?.('esc'));
    if ($('#library-panel').classList.contains('open')) { openLibrary(false); $('#nav-library').focus(); }
    if ($('#player').classList.contains('expanded')) $('#pl-expand').click();
    return;
  }
  const tag = (e.target.tagName || '').toLowerCase();
  if (e.metaKey || e.ctrlKey || e.altKey || ['input', 'select', 'textarea'].includes(tag) || e.target.isContentEditable || dlg.open) return;
  const interactive = tag === 'button' || tag === 'a';
  switch (e.key) {
    case ' ': if (interactive) return; e.preventDefault(); analyser.ensureContext(); player.toggle(); break;
    case 'ArrowRight': if (interactive && e.target.getAttribute('role') === 'tab') return; if (player.capabilities.seek) { e.preventDefault(); player.seek(player.state.position + 5); } break;
    case 'ArrowLeft': if (interactive && e.target.getAttribute('role') === 'tab') return; if (player.capabilities.seek) { e.preventDefault(); player.seek(Math.max(0, player.state.position - 5)); } break;
    case 'n': case 'N': player.next(); break;
    case 'p': case 'P': player.previous(); break;
    case 'm': case 'M': engine.morph(); break;
    case '[': themeManager.apply(neighbourTheme(themeManager.current.id, -1).id); break;
    case ']': themeManager.apply(neighbourTheme(themeManager.current.id, 1).id); break;
    case 'v': case 'V': togglePauseVisuals(); break;
    case 't': case 'T': tapTempo(); break;
    case 'i': case 'I': loadFeature('info-panel').then(m => m.toggle()); break;
    case 'd': case 'D': loadFeature('dev-overlay').then(m => m.toggle()); break;
    case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9': {
      const w = X.favouriteWorlds()[Number(e.key) - 1];
      if (w) themeManager.apply(w, 'user'); else if (Number(e.key) === 1) toast('No favourite worlds yet. Press ☆ on a world to add one.', 2500);
      break;
    }
    default: break;
  }
});
const SHARE_RE = /[#&](form|src|i|rx|bpm)=/;
window.addEventListener('hashchange', () => { if (SHARE_RE.test(location.hash)) loadFeature('share').then(m => m.open(location.hash)); else { const w = worldFromHash(); if (w) themeManager.apply(w, 'url'); } });

/* ---- Boot ---- */
async function boot() {
  // Complete a Spotify PKCE login if we were redirected back from Spotify.
  // Only pull in the PKCE helpers when Spotify has actually redirected back here.
  const redirect = /[?&](code|error)=/.test(location.search)
    ? await (await import('./player/spotify-common.js')).handleRedirect(clientId())
    : { handled: false };
  const shared = SHARE_RE.test(location.hash) && location.hash; // read before the world change rewrites the hash
  buildWorldGrid();
  themeManager.apply(worldFromHash() || settings.get('world'), 'init');
  syncToggles();
  applyVisualOptions();
  media.volume = settings.get('volume'); media.muted = settings.get('muted');
  await player.use('media');
  if (shared) await loadFeature('share').then(m => m.open(shared)).then(ok => ok || restoreSession(), () => restoreSession()); // a share link wins over the saved session
  else restoreSession();
  if (/[?&]debug\b/.test(location.search)) loadFeature('dev-overlay').then(m => m.open());
  sessionReady = true;
  syncFavUi();
  renderPlayer();
  // Warm up the (cued or first) REVERB Original in the background so Play starts quickly.
  (window.requestIdleCallback || (f => setTimeout(f, 800)))(() => media.prefetch(Math.max(0, media.pos)));
  if (redirect.handled) {
    openLibrary(true, 'sources');
    if (redirect.error) toast(redirect.error, 6000);
    else { toast('Signed in to Spotify. Loading your playlists…'); loadSpotifyUi().then(m => m.loadPlaylists()); await player.use('spotify-sdk'); await sdk.connect(); }
  } else if (sdk.signedIn) loadSpotifyUi().then(m => m.loadPlaylists());
  registerServiceWorker();
  // Old synth caches are useless once the synth changes.
  try { for (const k of await caches.keys()) if (k.startsWith('rw-audio-') && !k.endsWith(`v${(await import('./player/demo-synth.js')).SYNTH_VERSION}`)) caches.delete(k); } catch {}
  // Expose a tiny debug/test surface (no secrets, no playback internals).
  window.__reverb = { engine, backdrop, player, themeManager, settings, analyser, media, embed, sdk, experience: X, loadFeature };
}
/* ---------------- offline cache (sw.js) ----------------
 * Registered on deployed builds (or locally with ?sw=1). A new deploy waits
 * in the background; the user chooses when to switch, so one session never
 * mixes old and new files. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !(BUILD !== 'dev' || /[?&]sw=1\b/.test(location.search))) return;
  const offer = reg => toast('A new version of REVERB // WORLDS is ready.', 15000, { label: 'Reload', run: () => {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    reg.waiting?.postMessage('SKIP_WAITING');
  } });
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(reg); });
    });
  }).catch(err => console.warn('[REVERB] service worker not registered', err));
}

boot().catch(err => { console.error(err); toast(`Something went wrong while starting: ${err.message}`, 8000); });
