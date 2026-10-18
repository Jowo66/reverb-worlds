/**
 * experience.js: one "Experience" format for Continue Session, Saved
 * Experiences, built-in Presets and (next release) Share links.
 *
 * (Built-in presets and the saved-Experience list live in features/saved-panel.js,
 * which loads with the Saved tab.)
 *
 * An Experience is what you're looking at and listening to: world, form,
 * view angle, a few visual settings, the music source and an optional tapped
 * tempo. Anything that isn't ours (stored data, presets, later: links) goes
 * through validate(), and a few accessibility rules apply on top:
 *   • motion can only be *lowered* (full → reduced → static), never raised;
 *   • "reduce flashing" can be switched on, never off.
 * Local files never appear in an Experience (their blob URLs die with the tab).
 */
import { THEMES, THEME_BY_ID } from './theme-registry.js';
import { DEMO_TRACKS } from './player/demo-synth.js';

export const SCHEMA = 1;
const MOTION_RANK = { static: 0, reduced: 1, full: 2 };
export const KEYS = { session: 'reverb-worlds:session:v1', saved: 'reverb-worlds:saved:v1', favs: 'reverb-worlds:favs:v1' };
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
const SPOTIFY_URI = /^spotify:(track|album|playlist|artist|episode|show):[A-Za-z0-9]{10,40}$/;

/** Clean an untrusted Experience. Returns null if it doesn't name a real world. */
export function validate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const theme = THEME_BY_ID[raw.world];
  if (!theme) return null;
  const exp = { v: SCHEMA, world: theme.id };
  if (typeof raw.name === 'string') exp.name = raw.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
  if (theme.hologram.forms.includes(raw.form)) exp.form = raw.form;
  const rx = num(raw.view?.rx, -1.35, 1.35), ry = num(raw.view?.ry, -1e4, 1e4);
  if (rx !== undefined && ry !== undefined) exp.view = { rx, ry: ry % (Math.PI * 2) };
  const s = raw.settings || {}, out = {};
  if (num(s.intensity, 0, 100) !== undefined) out.intensity = Math.round(s.intensity);
  if (num(s.glitch, 0, 100) !== undefined) out.glitch = Math.round(s.glitch);
  if (num(s.autoMorphInterval, 4, 120) !== undefined) out.autoMorphInterval = Math.round(s.autoMorphInterval);
  if (typeof s.autoMorph === 'boolean') out.autoMorph = s.autoMorph;
  if (s.motion in MOTION_RANK) out.motion = s.motion;
  if (s.reduceFlashing === true) out.reduceFlashing = true;
  if (Object.keys(out).length) exp.settings = out;
  const src = raw.source || {};
  if (src.type === 'reverb' && DEMO_TRACKS.some(t => t.id === src.id)) exp.source = { type: 'reverb', id: src.id };
  else if (src.type === 'spotify' && SPOTIFY_URI.test(src.uri || '')) exp.source = { type: 'spotify', uri: src.uri, title: typeof src.title === 'string' ? src.title.slice(0, 80) : '' };
  const tempo = num(raw.tempo, 50, 220);
  if (tempo) exp.tempo = Math.round(tempo);
  return exp;
}

/** Describe what's on screen right now. */
export function capture({ engine, media, player, settings, themeManager, ambient }, name) {
  const exp = {
    world: themeManager.current.id,
    form: engine.toForm?.id,
    view: { rx: engine.user.rx, ry: engine.user.ry },
    settings: { intensity: settings.get('intensity'), glitch: settings.get('glitch'), motion: settings.get('motion'), autoMorph: settings.get('autoMorph'), autoMorphInterval: settings.get('autoMorphInterval') },
  };
  if (name) exp.name = name;
  const st = player.state, active = player.active?.id;
  if (active === 'media' && st.track?.kind === 'demo') {
    const item = media.items[st.index];
    if (item) exp.source = { type: 'reverb', id: item.id.replace(/^demo:/, '') };
  } else if (active?.startsWith('spotify') && player.active.entity?.uri) {
    exp.source = { type: 'spotify', uri: player.active.entity.uri, title: st.track?.title || '' };
  }
  if (ambient.bpm) exp.tempo = Math.round(ambient.bpm);
  return validate(exp);
}

/**
 * Apply an Experience's visuals and settings. Never starts playback (browsers
 * block autoplay, and surprise audio is rude); returns the source so the
 * caller can offer a Play / Resume prompt.
 */
export function apply(raw, { engine, settings, themeManager, ambient }, { includeSettings = true } = {}) {
  const exp = validate(raw);
  if (!exp) return null;
  themeManager.apply(exp.world, 'experience');
  if (exp.form) engine.morph(exp.form);
  if (exp.view) Object.assign(engine.user, { rx: exp.view.rx, ry: exp.view.ry, vx: 0, vy: 0 });
  if (includeSettings && exp.settings) {
    const s = exp.settings;
    for (const k of ['intensity', 'glitch', 'autoMorph', 'autoMorphInterval']) if (k in s) settings.set(k, s[k]);
    if (s.motion && MOTION_RANK[s.motion] < MOTION_RANK[settings.get('motion')]) settings.set('motion', s.motion); // only ever lower motion
    if (s.reduceFlashing) settings.set('reduceFlashing', true);
  }
  if (exp.tempo) ambient.setTempo(exp.tempo, performance.now());
  return exp;
}

/* ---------------- storage (failure-safe; private mode just forgets) ---------------- */
export function read(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; } }
export function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } }

export const session = {
  load() { const s = read(KEYS.session, null); if (!s) return null; const exp = validate(s.exp); return exp ? { exp, position: num(s.position, 0, 36000) || 0, savedAt: s.savedAt || 0 } : null; },
  save(exp, position = 0) { if (exp) write(KEYS.session, { exp, position: Math.round(position * 10) / 10, savedAt: Date.now() }); },
  clear() { try { localStorage.removeItem(KEYS.session); } catch {} },
};


const FAV_KINDS = ['worlds', 'forms', 'tracks'];
export const favs = {
  all() { const f = read(KEYS.favs, {}); const out = {}; for (const k of FAV_KINDS) out[k] = Array.isArray(f[k]) ? f[k].filter(x => typeof x === 'string').slice(0, 200) : []; return out; },
  has(kind, id) { return favs.all()[kind].includes(id); },
  toggle(kind, id) {
    const f = favs.all(), list = f[kind], i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    write(KEYS.favs, f);
    return i < 0;
  },
};

/** Favourite worlds in registry order, for the 1–9 quick-launch keys. */
export const favouriteWorlds = () => { const f = favs.all().worlds; return THEMES.filter(t => f.includes(t.id)).map(t => t.id); };

/** The world a form belongs to (forms are unique to one world's pool). */
export const worldOfForm = id => THEMES.find(t => t.hologram.forms.includes(id))?.id || null;
