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
import { Backdrop, renderThumbnail } from './hologram/backdrops.js';
import { AudioAnalyser, AmbientSource } from './audio-analyser.js';
import { PlayerController, formatTime } from './player/player-adapter.js';
import { MediaProvider } from './player/media-provider.js';
import { SpotifyEmbedProvider } from './player/spotify-embed.js';
import { SpotifySdkProvider } from './player/spotify-sdk.js';
import { handleRedirect, redirectUri } from './player/spotify-common.js';
import { SPOTIFY_CLIENT_ID } from './config.js';

const $ = sel => document.querySelector(sel);
const root = document.documentElement;

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */
let toastTimer;
function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const clientId = () => settings.get('spotifyClientId') || SPOTIFY_CLIENT_ID;

/* ------------------------------------------------------------------ */
/* Audio input + player                                                */
/* ------------------------------------------------------------------ */
const analyser = new AudioAnalyser();
const ambient = new AmbientSource();
const player = new PlayerController();
const media = player.register(new MediaProvider(analyser));
const embed = player.register(new SpotifyEmbedProvider($('#spotify-surface')));
const sdk = player.register(new SpotifySdkProvider(clientId));

/* ------------------------------------------------------------------ */
/* Visualizer input resolution (honest labelling)                      */
/* ------------------------------------------------------------------ */
let vizMode = 'ambient';
function resolveVizMode() {
  const pref = settings.get('vizInput');
  if (pref === 'ambient') return 'ambient';
  if (pref === 'mic' || analyser.micEnabled) return analyser.micEnabled ? 'mic' : 'ambient';
  const caps = player.capabilities, st = player.state;
  if (caps.analysable && st.playing) return 'player';
  return 'ambient';
}
function updateVizChip() {
  const mode = resolveVizMode();
  if (mode !== vizMode || !updateVizChip.done) {
    vizMode = mode; updateVizChip.done = true;
    analyser.setInput(mode === 'mic' ? 'mic' : 'media');
    const chip = $('#viz-mode');
    const spotify = player.active?.id?.startsWith('spotify');
    const labels = {
      player: ['Audio reactive · REVERB player', 'The hologram analyses the audio playing in this page (approximate onset detection, not exact beat tracking).'],
      mic: ['Audio reactive · Microphone', 'The hologram analyses your microphone input locally. Nothing is recorded or sent.'],
      ambient: [spotify ? 'Ambient animation · not synced to Spotify' : 'Ambient animation', spotify ? 'Spotify audio is protected and cannot be analysed in the browser. Enable the microphone in Library › Sources for audio-reactive visuals.' : 'Not driven by audio. Play REVERB Originals, your own files or enable the microphone for audio-reactive visuals.'],
    };
    chip.textContent = labels[mode][0];
    chip.title = labels[mode][1];
    chip.dataset.live = mode !== 'ambient' ? 'true' : 'false';
  }
}

let lastFeat = performance.now();
let onsetCount = 0;
function getFeatures() {
  const now = performance.now(), dt = Math.min(0.1, (now - lastFeat) / 1000);
  lastFeat = now;
  updateVizChip();
  if (vizMode === 'ambient') return ambient.read(dt);
  return analyser.read(now);
}

/* ------------------------------------------------------------------ */
/* Hologram + backdrop                                                 */
/* ------------------------------------------------------------------ */
const engine = new HologramEngine($('#hologram'), {
  getFeatures,
  onForm: ({ label }) => {
    $('#form-name').textContent = label;
    $('#hologram').setAttribute('aria-label', `Hologram showing: ${label}`);
    lastMorph = performance.now();
  },
  onQualityChange: tier => { root.dataset.quality = tier === 'low' ? 'low' : 'normal'; },
  onOnset: kind => { if (kind === 'kick' && vizMode !== 'ambient') onsetCount++; },
});
const backdrop = new Backdrop($('#backdrop'), { getReactive: () => engine.reactive });

function visualsActive() { return !visualsPaused && settings.get('motion') !== 'static' && !document.hidden; }
let visualsPaused = false;

function applyVisualOptions() {
  const motion = settings.get('motion');
  root.dataset.motion = motion;
  engine.setOptions({ motion, intensity: settings.get('intensity') / 100, glitch: settings.get('glitch') / 100, reduceFlashing: settings.get('reduceFlashing'), quality: settings.get('quality') });
  backdrop.setOptions({ motion: visualsPaused ? 'static' : motion, quality: settings.get('quality') === 'low' ? 'low' : 'high', enabled: settings.get('backdrop'), glitch: settings.get('glitch') / 100 });
  root.dataset.quality = settings.get('quality') === 'low' ? 'low' : 'normal';
  syncRunning();
}

function syncRunning() {
  if (visualsActive()) { engine.start(); if (settings.get('backdrop') && settings.get('motion') === 'full') backdrop.start(); else { backdrop.stop(); backdrop.renderOnce(); } }
  else { engine.stop(); engine.renderOnce(); backdrop.stop(); backdrop.renderOnce(); }
}

document.addEventListener('visibilitychange', syncRunning);

/* ------------------------------------------------------------------ */
/* Worlds                                                              */
/* ------------------------------------------------------------------ */
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
    body.innerHTML = `<span class="wc-num"><span>${t.num}</span><span class="wc-selected">Selected</span></span><span class="wc-name"></span><span class="wc-mood"></span>`;
    body.querySelector('.wc-name').textContent = t.name;
    body.querySelector('.wc-mood').textContent = t.mood;
    b.append(c, body);
    b.addEventListener('click', () => themeManager.apply(t.id, 'user'));
    li.append(b); frag.append(li);
  }
  grid.append(frag);
  // Draw procedural thumbnails lazily (keeps first paint fast).
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const card = en.target; io.unobserve(card);
      const draw = () => { try { renderThumbnail(getTheme(card.dataset.id), card.querySelector('canvas')); } catch (err) { console.warn('thumbnail', err); } };
      (window.requestIdleCallback || (f => setTimeout(f, 30)))(draw);
    }
  }, { rootMargin: '200px' });
  grid.querySelectorAll('.world-card').forEach(c => io.observe(c));
}

/* ------------------------------------------------------------------ */
/* Auto-morph / auto-world scheduler                                   */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* Player UI                                                           */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* Library sheet, tabs and sources                                     */
/* ------------------------------------------------------------------ */
const sheetMQ = window.matchMedia('(max-width: 1100px)');
function openLibrary(open, tab) {
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

function selectTab(name) {
  for (const t of ['queue', 'sources']) {
    const tab = $(`#tab-${t}`), pane = $(`#pane-${t}`), on = t === name;
    tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; pane.hidden = !on;
  }
}
for (const t of ['queue', 'sources']) {
  $(`#tab-${t}`).addEventListener('click', () => selectTab(t));
  $(`#tab-${t}`).addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const other = t === 'queue' ? 'sources' : 'queue'; selectTab(other); $(`#tab-${other}`).focus(); e.preventDefault(); }
  });
}

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
  if (typeof updatePlaylistsUi === 'function') updatePlaylistsUi();
  const note = $('#sdk-note');
  if (!configured) note.textContent = 'Not configured: add your Spotify Client ID in Settings. Requires Spotify Premium and a supported desktop browser.';
  else if (player.active === sdk && sdk.message) note.textContent = sdk.message;
  else if (signedIn) note.textContent = 'Signed in to Spotify. Start the player to play here.';
  else note.textContent = 'Client ID set. Connect with a Spotify Premium account (Development-Mode apps only allow users you add in the dashboard).';
}
$('#sdk-login').addEventListener('click', () => sdk.login());

/* ---------------- Spotify playlist picker ---------------- */
let playlists = [], currentPlaylist = null, playlistsLoading = false;
function updatePlaylistsUi() {
  const configured = !!clientId(), signedIn = sdk.signedIn;
  $('#playlists-connect').hidden = signedIn;
  $('#playlists-connect').disabled = !configured;
  $('#playlists-refresh').hidden = !signedIn;
  const note = $('#playlists-note');
  if (!configured) note.textContent = 'Add your Spotify Client ID in Settings, then connect to pick from your playlists.';
  else if (!signedIn) note.textContent = 'Connect Spotify to pick from your playlists here.';
  else if (playlistsLoading) note.textContent = 'Loading your playlists…';
  else if (!playlists.length) note.textContent = note.dataset.error || 'No playlists found on this account.';
  else note.textContent = sdk.deviceId ? `${playlists.length} playlists — click one to play it here (Spotify Premium player).` : `${playlists.length} playlists — click one to open it in the Spotify embed. Start the Premium player below for full controls.`;
}
function renderPlaylists() {
  const q = ($('#search').value || '').trim().toLowerCase();
  $('#playlist-grid').replaceChildren(...playlists.filter(p => !q || `${p.name} ${p.owner}`.toLowerCase().includes(q)).map(p => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pl-card';
    if (currentPlaylist === p.id) b.setAttribute('aria-current', 'true');
    b.setAttribute('aria-label', `Play playlist ${p.name}${p.count != null ? `, ${p.count} tracks` : ''}`);
    b.innerHTML = '<span class="pl-cover" aria-hidden="true"></span><span class="pl-name"></span><span class="pl-meta"></span>';
    const cover = b.querySelector('.pl-cover');
    if (p.image) cover.style.backgroundImage = `url("${p.image.replace(/"/g, '%22')}")`; else cover.textContent = '♪';
    b.querySelector('.pl-name').textContent = p.name;
    b.querySelector('.pl-meta').textContent = [p.count != null ? `${p.count} tracks` : '', p.owner].filter(Boolean).join(' · ');
    b.addEventListener('click', () => playPlaylist(p));
    li.append(b);
    return li;
  }));
  updatePlaylistsUi();
}
async function loadPlaylists() {
  if (!sdk.signedIn || playlistsLoading) return;
  playlistsLoading = true; $('#playlists-note').dataset.error = ''; updatePlaylistsUi();
  try { playlists = await sdk.fetchPlaylists(); }
  catch (err) { playlists = []; $('#playlists-note').dataset.error = `Couldn’t load playlists: ${err.message}`; }
  playlistsLoading = false;
  renderPlaylists();
}
async function playPlaylist(p) {
  analyser.ensureContext();
  currentPlaylist = p.id; renderPlaylists();
  if (sdk.deviceId) {
    await player.use('spotify-sdk');
    await sdk.playLink(p.uri);
    if (player.state.status !== 'error') toast(`Playing “${p.name}” on Spotify.`);
  } else {
    await player.use('spotify-embed');
    if (await embed.load(p.url)) toast(`“${p.name}” loaded in the Spotify embed — press play.`);
  }
}
$('#playlists-connect').addEventListener('click', () => sdk.login());
$('#playlists-refresh').addEventListener('click', loadPlaylists);
$('#search').addEventListener('input', () => { if (playlists.length) renderPlaylists(); });
$('#sdk-connect').addEventListener('click', async () => { await player.use('spotify-sdk'); await sdk.connect(); });
$('#sdk-logout').addEventListener('click', async () => { await sdk.logout(); playlists = []; currentPlaylist = null; renderPlaylists(); await player.use('media'); updateSdkUi(); });
$('#sdk-form').addEventListener('submit', async e => { e.preventDefault(); await player.use('spotify-sdk'); await sdk.playLink($('#sdk-input').value); });

$('#mic-toggle').addEventListener('click', async () => {
  const btn = $('#mic-toggle');
  if (analyser.micEnabled) {
    analyser.disableMicrophone();
    btn.textContent = 'Enable microphone'; btn.setAttribute('aria-pressed', 'false');
    toast('Microphone off.');
  } else {
    try {
      await analyser.enableMicrophone();
      btn.textContent = 'Disable microphone'; btn.setAttribute('aria-pressed', 'true');
      toast('Microphone on — the hologram now reacts to the room.');
    } catch (err) {
      toast(err.name === 'NotAllowedError' ? 'Microphone permission was denied.' : `Microphone unavailable: ${err.message}`, 4500);
    }
  }
  updateVizChip.done = false; updateVizChip();
});

/* ------------------------------------------------------------------ */
/* Stage controls                                                      */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */
function applySearch() {
  const q = $('#search').value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('.world-card').forEach(card => {
    const t = getTheme(card.dataset.id);
    const hit = !q || `${t.name} ${t.tagline} ${t.mood} ${t.num}`.toLowerCase().includes(q);
    card.parentElement.hidden = !hit; if (hit) shown++;
  });
  $('#worlds-count').textContent = q ? `${shown} of 13 worlds match “${$('#search').value.trim()}”` : '13 worlds';
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
  toast(worlds.length ? `${worlds.length} worlds match — pick one below.` : 'No worlds or tracks match.');
});

/* ------------------------------------------------------------------ */
/* Settings dialog                                                     */
/* ------------------------------------------------------------------ */
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
$('#nav-settings').addEventListener('click', () => { fillSettings(); dlg.showModal(); });
dlg.addEventListener('close', () => $('#nav-settings').focus());
dlg.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'motion') settings.set('motion', t.value);
  if (t.id === 'set-flash') settings.set('reduceFlashing', t.checked);
  if (t.id === 'set-backdrop') settings.set('backdrop', t.checked);
  if (t.id === 'set-quality') settings.set('quality', t.value);
  if (t.id === 'set-trigger') settings.set('autoMorphTrigger', t.value);
  if (t.id === 'set-viz') {
    settings.set('vizInput', t.value);
    if (t.value === 'mic' && !analyser.micEnabled) $('#mic-toggle').click();
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

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
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
    default: break;
  }
});
window.addEventListener('hashchange', () => { const w = worldFromHash(); if (w) themeManager.apply(w, 'url'); });

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
async function boot() {
  // Complete a Spotify PKCE login if we were redirected back from Spotify.
  const redirect = await handleRedirect(clientId());
  buildWorldGrid();
  themeManager.apply(worldFromHash() || settings.get('world'), 'init');
  syncToggles();
  applyVisualOptions();
  media.volume = settings.get('volume'); media.muted = settings.get('muted');
  await player.use('media');
  renderPlayer();
  // Warm up the first REVERB Original in the background so Play starts quickly.
  (window.requestIdleCallback || (f => setTimeout(f, 800)))(() => media.prefetch(0));
  if (redirect.handled) {
    openLibrary(true, 'sources');
    if (redirect.error) toast(redirect.error, 6000);
    else { toast('Signed in to Spotify. Loading your playlists…'); loadPlaylists(); await player.use('spotify-sdk'); await sdk.connect(); }
  } else if (sdk.signedIn) loadPlaylists();
  updatePlaylistsUi();
  // Expose a tiny debug/test surface (no secrets, no playback internals).
  window.__reverb = { engine, backdrop, player, themeManager, settings, analyser, media, embed, sdk };
}
boot().catch(err => { console.error(err); toast(`Something went wrong while starting: ${err.message}`, 8000); });
