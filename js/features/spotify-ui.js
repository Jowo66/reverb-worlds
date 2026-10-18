/**
 * spotify-ui.js: Spotify catalogue search + "Your Spotify playlists" picker
 * (Library › Sources). Lazy-loaded the first time Sources is opened, or at
 * startup only for visitors already signed in to Spotify, so everyone else
 * never downloads it. The Spotify provider itself is lazy too (lazy-provider.js).
 */
let $, sdk, embed, player, analyser, openLibrary, toast, clientId;

export function init(api) {
  ({ $, sdk, embed, player, analyser, openLibrary, toast, clientId } = api);
  wire();
  updatePlaylistsUi(); updateSearchUi();
}

/** Play was pressed with nothing loaded on the Spotify device: show the picker. */
export function onNeedsSelection() {
  if (sdk.hasTrack) return;
  openLibrary(true, 'sources');
  $('#src-playlists').scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (!playlists.length) loadPlaylists();
}

/** Signed out: forget the lists. */
export function reset() { playlists = []; currentPlaylist = null; renderPlaylists(); }

export { updatePlaylistsUi, updateSearchUi, loadPlaylists, renderPlaylists, runSpotifySearch };

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
  if (sdk.deviceId || sdk.player) {
    await player.use('spotify-sdk');
    await sdk.playLink(p.uri);
    if (player.state.status !== 'error') toast(`Playing “${p.name}” on Spotify.`);
  } else {
    await player.use('spotify-embed');
    if (await embed.load(p.url)) toast(`“${p.name}” loaded in the Spotify embed — press play.`);
  }
}

/* ---------------- Spotify catalogue search ---------------- */
const spSearch = { q: '', type: 'all', results: null, offset: 0, token: 0, current: null };
const spTypes = () => (spSearch.type === 'all' ? ['track', 'playlist', 'album', 'artist'] : [spSearch.type]);
function spNote(msg) { $('#sp-search-note').textContent = msg; }
function updateSearchUi() {
  const ok = sdk.signedIn;
  $('#sp-search').disabled = !ok;
  $('#sp-search-form button').disabled = !ok;
  if (!ok) { spNote(clientId() ? 'Connect Spotify (below) to search the whole catalogue.' : 'Add your Spotify Client ID in Settings, then connect to search Spotify.'); $('#sp-results').replaceChildren(); }
  else if (!spSearch.q) spNote('Search any song, playlist, album or artist on Spotify.');
}
async function runSpotifySearch(q, { append = false } = {}) {
  q = (q || '').trim();
  if (!sdk.signedIn) return updateSearchUi();
  if (!q) { spSearch.q = ''; spSearch.results = null; $('#sp-results').replaceChildren(); return updateSearchUi(); }
  const token = ++spSearch.token;
  if (!append) { spSearch.q = q; spSearch.offset = 0; }
  spNote(append ? 'Loading more…' : `Searching Spotify for “${q}”…`);
  try {
    const r = await sdk.search(q, spTypes(), spSearch.offset);
    if (token !== spSearch.token) return; // a newer search superseded this one
    if (append && spSearch.results) { for (const t of ['track', 'playlist', 'album', 'artist']) spSearch.results[t].push(...r[t]); spSearch.results.more = r.more; }
    else spSearch.results = r;
    const n = ['track', 'playlist', 'album', 'artist'].reduce((a, t) => a + spSearch.results[t].length, 0);
    spNote(n ? `${n} results for “${q}”${sdk.deviceId ? '' : ' — playing opens the Spotify embed until the Premium player is connected'}.` : `No results for “${q}”.`);
    renderSpotifyResults();
  } catch (err) {
    if (token === spSearch.token) spNote(`Search failed: ${err.message}`);
  }
}
const LABELS = { track: 'Songs', playlist: 'Playlists', album: 'Albums', artist: 'Artists' };
function renderSpotifyResults() {
  const r = spSearch.results, box = $('#sp-results');
  if (!r) return box.replaceChildren();
  const groups = spTypes().filter(t => r[t].length).map(t => {
    const g = document.createElement('div'); g.className = 'sp-group';
    const h = document.createElement('h4'); h.textContent = LABELS[t];
    const ul = document.createElement('ul'); ul.className = 'sp-list'; ul.setAttribute('role', 'list');
    for (const item of r[t]) {
      const li = document.createElement('li'); li.className = 'sp-item'; li.dataset.type = t;
      if (spSearch.current === item.uri) li.setAttribute('aria-current', 'true');
      li.innerHTML = '<span class="sp-cover" aria-hidden="true"></span><button type="button" class="sp-play"><span class="sp-title"></span><span class="sp-sub"></span></button><span class="sp-actions"></span>';
      const cover = li.querySelector('.sp-cover');
      if (item.image) cover.style.backgroundImage = `url("${item.image.replace(/"/g, '%22')}")`; else cover.textContent = '♪';
      li.querySelector('.sp-title').textContent = item.title;
      li.querySelector('.sp-sub').textContent = item.subtitle;
      const play = li.querySelector('.sp-play');
      play.setAttribute('aria-label', `Play ${LABELS[t].slice(0, -1).toLowerCase()} ${item.title}${item.subtitle ? ', ' + item.subtitle : ''}`);
      play.addEventListener('click', () => playSpotifyItem(item));
      if (t === 'track') {
        const q = document.createElement('button'); q.type = 'button'; q.className = 'btn btn-ghost'; q.textContent = '+ Queue';
        q.setAttribute('aria-label', `Add ${item.title} to the Spotify queue`);
        q.disabled = !sdk.deviceId; if (!sdk.deviceId) q.title = 'Start the Premium player to use the queue';
        q.addEventListener('click', async () => { try { await sdk.addToQueue(item.uri); toast(`Added “${item.title}” to your Spotify queue.`); } catch (e) { toast(e.message, 5000); } });
        li.querySelector('.sp-actions').append(q);
      }
      ul.append(li);
    }
    g.append(h, ul);
    return g;
  });
  const anyMore = spTypes().some(t => r.more?.[t]);
  if (anyMore) {
    const more = document.createElement('button'); more.type = 'button'; more.className = 'btn sp-more'; more.textContent = 'Load more results';
    more.addEventListener('click', () => { spSearch.offset += 10; runSpotifySearch(spSearch.q, { append: true }); });
    groups.push(more);
  }
  box.replaceChildren(...groups);
}
async function playSpotifyItem(item) {
  analyser.ensureContext();
  spSearch.current = item.uri; renderSpotifyResults();
  if (sdk.deviceId || sdk.player) {
    await player.use('spotify-sdk');
    try { await sdk.playItem(item); toast(`Playing “${item.title}” on Spotify.`); } catch {}
  } else {
    await player.use('spotify-embed');
    if (await embed.load(item.url || item.uri)) toast(`“${item.title}” loaded in the Spotify embed — press play.`);
  }
}
let spDebounce;

function wire() {
  $('#playlists-connect').addEventListener('click', () => sdk.login());
  $('#sp-search').addEventListener('input', e => { clearTimeout(spDebounce); spDebounce = setTimeout(() => runSpotifySearch(e.target.value), 450); });
  $('#sp-search-form').addEventListener('submit', e => { e.preventDefault(); clearTimeout(spDebounce); runSpotifySearch($('#sp-search').value); });
  document.querySelectorAll('input[name="sp-type"]').forEach(r => r.addEventListener('change', () => { spSearch.type = r.value; if (spSearch.q) runSpotifySearch(spSearch.q); }));
  $('#playlists-refresh').addEventListener('click', loadPlaylists);
  $('#search').addEventListener('input', () => { if (playlists.length) renderPlaylists(); });
}
