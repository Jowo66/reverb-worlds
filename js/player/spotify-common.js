/**
 * spotify-common.js — URI parsing, script loading and PKCE OAuth helpers.
 *
 * SECURITY: this is a public client. It uses Authorization Code + PKCE, which
 * Spotify recommends for apps that cannot keep a secret. There is NO client
 * secret anywhere in this project, and there must never be one.
 * Tokens live in sessionStorage (cleared when the tab closes) — never
 * localStorage, never the repository.
 */

const TYPES = ['track', 'album', 'playlist', 'episode', 'show', 'artist'];

/** Accepts spotify:type:id or https://open.spotify.com/[intl-xx/]type/id[?…] */
export function parseSpotify(input) {
  if (!input) return null;
  const s = String(input).trim();
  let m = /^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]{10,40})$/.exec(s);
  if (!m) m = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,40})/i.exec(s);
  if (!m || !TYPES.includes(m[1].toLowerCase())) return null;
  const type = m[1].toLowerCase(), id = m[2];
  return { type, id, uri: `spotify:${type}:${id}`, url: `https://open.spotify.com/${type}/${id}` };
}

const scripts = new Map();
export function loadScript(src, timeoutMs = 15000) {
  if (scripts.has(src)) return scripts.get(src);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.async = true;
    const to = setTimeout(() => reject(new Error(`Timed out loading ${src}`)), timeoutMs);
    el.onload = () => { clearTimeout(to); resolve(); };
    el.onerror = () => { clearTimeout(to); reject(new Error(`Could not load ${src} (offline, blocked by an extension, or network policy).`)); };
    document.head.appendChild(el);
  });
  scripts.set(src, p);
  p.catch(() => scripts.delete(src));
  return p;
}

/* ------------------------------------------------------------------ */
/* OAuth 2.0 Authorization Code with PKCE                               */
/* ------------------------------------------------------------------ */
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-read-playback-state', 'user-modify-playback-state'];
const SS = { verifier: 'rw:pkce:verifier', state: 'rw:pkce:state', token: 'rw:spotify:token' };

const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} },
};

/** The exact URL that must be registered as a Redirect URI in the Spotify dashboard. */
export function redirectUri() {
  // Normalise so /reverb-worlds/ and /reverb-worlds/index.html register as one URI.
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const v = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(v, x => chars[x % chars.length]).join('');
}
async function sha256b64url(str) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function beginLogin(clientId) {
  if (!window.isSecureContext) throw new Error('Spotify login needs HTTPS (or http://127.0.0.1 for local testing).');
  const verifier = randomString(64), state = randomString(16);
  ss.set(SS.verifier, verifier); ss.set(SS.state, state);
  const params = new URLSearchParams({
    response_type: 'code', client_id: clientId, scope: SCOPES.join(' '),
    code_challenge_method: 'S256', code_challenge: await sha256b64url(verifier),
    redirect_uri: redirectUri(), state,
  });
  location.assign(`${AUTH_URL}?${params}`);
}

/** Call on page load. Returns {handled, error?}. Cleans ?code=… from the URL. */
export async function handleRedirect(clientId) {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return { handled: false };
  const clean = () => history.replaceState(null, '', location.pathname + location.hash);
  if (q.get('state') !== ss.get(SS.state)) { clean(); return { handled: true, error: 'Login state mismatch — please try connecting again.' }; }
  if (q.has('error')) { clean(); return { handled: true, error: `Spotify login was not completed (${q.get('error')}).` }; }
  if (!clientId) { clean(); return { handled: true, error: 'No Spotify Client ID configured.' }; }
  try {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), client_id: clientId, code_verifier: ss.get(SS.verifier) || '' });
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error_description || json.error || `HTTP ${res.status}`);
    storeToken(json);
    return { handled: true };
  } catch (err) {
    return { handled: true, error: `Token exchange failed: ${err.message}` };
  } finally {
    ss.del(SS.verifier); ss.del(SS.state); clean();
  }
}

function storeToken(json, prevRefresh) {
  const tok = { access: json.access_token, refresh: json.refresh_token || prevRefresh, expires: Date.now() + (json.expires_in - 60) * 1000, scope: json.scope };
  ss.set(SS.token, JSON.stringify(tok));
  return tok;
}

export function hasSession() { return !!ss.get(SS.token); }

export async function getAccessToken(clientId) {
  let tok; try { tok = JSON.parse(ss.get(SS.token) || 'null'); } catch { tok = null; }
  if (!tok) return null;
  if (Date.now() < tok.expires) return tok.access;
  if (!tok.refresh) { logout(); return null; }
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh, client_id: clientId });
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) { logout(); return null; }
  return storeToken(await res.json(), tok.refresh).access;
}

export function logout() { ss.del(SS.token); }
