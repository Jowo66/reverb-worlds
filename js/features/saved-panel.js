/**
 * saved-panel.js: Library › Saved (lazy-loaded on first open).
 * Built-in presets, your saved Experiences and your favourites.
 * Applying anything restores visuals only and offers Play; it never autoplays.
 */
import { formLabel } from '../hologram/forms.js'; // already loaded by the engine: no extra download

import * as X from '../experience.js';

let A = null;

/* ---------------- saved Experiences (localStorage) ---------------- */
export const saved = {
  list() { const a = X.read(X.KEYS.saved, []); return Array.isArray(a) ? a.map(X.validate).filter(e => e && e.name) : []; },
  add(exp) { const list = saved.list().filter(e => e.name !== exp.name); list.unshift(exp); return X.write(X.KEYS.saved, list.slice(0, 50)); },
  remove(name) { return X.write(X.KEYS.saved, saved.list().filter(e => e.name !== name)); },
};

/** Built-in presets, curated by the owner (no user-submitted presets by design). */
export const PRESETS = [
  { name: 'Night Drive', world: 'vapor', form: 'retro-terrain', view: { rx: 0.25, ry: 0 }, settings: { intensity: 85, glitch: 35, autoMorph: false }, source: { type: 'reverb', id: 'neon-rain' } },
  { name: 'Rain City', world: 'cyberpunk', form: 'neon-helix', settings: { intensity: 75, glitch: 45, autoMorph: true, autoMorphInterval: 16 }, source: { type: 'reverb', id: 'tessellate' } },
  { name: 'Dreamscape', world: 'aero', form: 'aqua-bubbles', settings: { intensity: 55, autoMorph: true, autoMorphInterval: 24 }, source: { type: 'reverb', id: 'paper-tide' } },
  { name: 'Neon Focus', world: 'glitch', form: 'pixel-sphere', settings: { intensity: 45, glitch: 20, autoMorph: true, autoMorphInterval: 40 }, source: { type: 'reverb', id: 'gilded-hour' } },
].map(X.validate);


const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const STYLE = `
.sv-section { padding: 12px 0; border-bottom: 1px solid rgba(127,127,127,.25); display: flex; flex-direction: column; gap: 8px; }
.sv-section:last-child { border-bottom: 0; }
.sv-section h3 { font-family: var(--font-display); font-size: 15px; }
.sv-list { display: flex; flex-direction: column; gap: 4px; }
.sv-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 6px 8px; border: 1px solid transparent; border-radius: var(--radius); }
.sv-row:hover, .sv-row:focus-within { border-color: var(--border); }
.sv-apply { text-align: left; min-width: 0; padding: 2px 0; }
.sv-name { display: block; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sv-meta { display: block; font-size: 12.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sv-actions { display: flex; gap: 4px; }
.sv-actions .btn { min-height: 34px; padding: 4px 10px; font-size: 13px; }
.sv-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.sv-chips .btn { min-height: 36px; padding: 6px 12px; font-size: 14px; }
.sv-empty { color: var(--muted); font-size: 14px; }
`;

export function init(api) {
  A = api;
  const s = document.createElement('style'); s.textContent = STYLE; document.head.append(s);
  window.addEventListener('reverb:favs', () => { if (!document.querySelector('#pane-saved').hidden) render(); });
}

function describe(exp) {
  const t = A.getTheme(exp.world), parts = [t.name];
  if (exp.form) parts.push(formLabel(exp.form));
  if (exp.source?.type === 'reverb') parts.push(trackTitle(exp.source.id));
  if (exp.source?.type === 'spotify') parts.push('Spotify');
  if (exp.settings?.intensity != null) parts.push(`intensity ${exp.settings.intensity}%`);
  return parts.filter(Boolean).join(' · ');
}
const trackTitle = id => A.media.items.find(i => i.id === `demo:${id}`)?.title || id;

/** Apply an Experience; if it has a REVERB track, cue it and offer Play. */
async function useExperience(exp, kind) {
  const applied = A.X.apply(exp, A.xctx());
  if (!applied) return A.toast('That experience could not be loaded.');
  if (applied.source?.type === 'reverb') {
    await A.useMedia();
    const idx = A.media.items.findIndex(i => i.id === `demo:${applied.source.id}`);
    if (idx >= 0) A.media.cue(idx, 0);
    A.toast(`${kind} “${applied.name}” ready.`, 8000, { label: 'Play', run: () => { A.analyser.ensureContext(); A.player.play(); document.querySelector('#toast').classList.remove('show'); } });
  } else if (applied.source?.type === 'spotify') {
    A.toast(`${kind} “${applied.name}” loaded. Its music is on Spotify: open it from Library › Sources.`, 7000);
  } else A.toast(`${kind} “${applied.name}” loaded.`, 2500);
}

const shareLink = exp => A.loadFeature('share').then(m => m.copy(exp));

function row({ name, meta, onApply, applyLabel, actions = [] }) {
  const r = el('li', 'sv-row');
  const b = el('button', 'sv-apply'); b.type = 'button';
  b.append(el('span', 'sv-name', name), el('span', 'sv-meta', meta));
  b.setAttribute('aria-label', applyLabel);
  b.addEventListener('click', onApply);
  const act = el('span', 'sv-actions');
  for (const a of actions) { const x = el('button', 'btn btn-ghost', a.label); x.type = 'button'; x.setAttribute('aria-label', a.aria); x.addEventListener('click', a.run); act.append(x); }
  r.append(b, act);
  return r;
}

export function render() {
  const pane = document.querySelector('#pane-saved');
  const frag = document.createDocumentFragment();

  // Save current
  const save = el('section', 'sv-section');
  save.append(el('h3', null, 'Save what you’re seeing'));
  const form = el('form', 'inline-form');
  const label = el('label', 'visually-hidden', 'Name for this experience'); label.htmlFor = 'sv-name';
  const input = el('input'); input.id = 'sv-name'; input.type = 'text'; input.maxLength = 40; input.placeholder = 'e.g. Night Drive'; input.autocomplete = 'off';
  const go = el('button', 'btn', 'Save'); go.type = 'submit';
  form.append(label, input, go);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = input.value.trim().slice(0, 40);
    if (!name) { input.focus(); return A.toast('Give it a name first.', 1800); }
    const exp = A.X.capture(A.xctx(), name);
    if (!exp) return A.toast('Could not save this experience.');
    saved.add(exp); A.toast(`Saved “${name}”.`, 2000); render();
  });
  save.append(el('p', 'sv-empty', 'Saves the world, shape, view angle, visual settings and REVERB track. Stored only in this browser.'), form);
  const sh = el('button', 'btn btn-ghost', 'Copy share link'); sh.type = 'button'; sh.id = 'sv-share';
  sh.setAttribute('aria-label', 'Copy a share link for what you’re seeing');
  sh.addEventListener('click', () => shareLink());
  save.append(sh);
  frag.append(save);

  // Saved experiences
  const mine = saved.list(), sec = el('section', 'sv-section');
  sec.append(el('h3', null, `Your experiences (${mine.length})`));
  if (!mine.length) sec.append(el('p', 'sv-empty', 'Nothing saved yet.'));
  else {
    const ul = el('ul', 'sv-list'); ul.setAttribute('role', 'list');
    for (const exp of mine) ul.append(row({ name: exp.name, meta: describe(exp), applyLabel: `Load experience ${exp.name}`, onApply: () => useExperience(exp, 'Experience'),
      actions: [{ label: 'Link', aria: `Copy share link for ${exp.name}`, run: () => shareLink(exp) }, { label: 'Delete', aria: `Delete experience ${exp.name}`, run: () => { saved.remove(exp.name); A.toast(`Deleted “${exp.name}”.`, 1800); render(); } }] }));
    sec.append(ul);
  }
  frag.append(sec);

  // Presets
  const pre = el('section', 'sv-section'), pul = el('ul', 'sv-list'); pul.setAttribute('role', 'list');
  pre.append(el('h3', null, 'Presets'));
  for (const p of PRESETS) pul.append(row({ name: p.name, meta: describe(p), applyLabel: `Load preset ${p.name}`, onApply: () => useExperience(p, 'Preset') }));
  pre.append(pul);
  frag.append(pre);

  // Favourites
  const f = A.X.favs.all(), fav = el('section', 'sv-section');
  fav.append(el('h3', null, 'Favourites'));
  const group = (title, items, make) => {
    fav.append(el('p', 'sv-meta', title));
    if (!items.length) { fav.append(el('p', 'sv-empty', 'None yet: press ☆ to add.')); return; }
    const box = el('div', 'sv-chips'); items.forEach(i => box.append(make(i))); fav.append(box);
  };
  const chip = (text, aria, run) => { const b = el('button', 'btn', text); b.type = 'button'; b.setAttribute('aria-label', aria); b.addEventListener('click', run); return b; };
  group('Worlds (keys 1–9 open them)', A.X.favouriteWorlds(), (id, i) => chip(`${A.getTheme(id).name}`, `Open favourite world ${A.getTheme(id).name}`, () => A.themeManager.apply(id, 'user')));
  group('Shapes', f.forms.filter(id => A.X.worldOfForm(id)), id => chip(formLabel(id), `Show favourite shape ${formLabel(id)}`, () => { A.themeManager.apply(A.X.worldOfForm(id), 'user'); A.engine.morph(id); }));
  group('REVERB tracks', f.tracks.filter(id => A.media.items.some(i => i.id === `demo:${id}`)), id => chip(trackTitle(id), `Play favourite track ${trackTitle(id)}`, async () => {
    await A.useMedia(); A.analyser.ensureContext();
    const idx = A.media.items.findIndex(i => i.id === `demo:${id}`); if (idx >= 0) A.player.playIndex(idx);
  }));
  frag.append(fav);

  pane.replaceChildren(frag);
}
