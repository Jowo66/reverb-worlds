/**
 * world-packs.js: worlds with `pack: '<id>'` keep their backdrop and forms in
 * js/worlds/<id>.js, loaded on first use (window and backdrop worker alike) and
 * registered into BACKDROPS / FORMS so existing synchronous lookups just work.
 */
import { BACKDROPS } from './hologram/backdrops.js';
import { FORMS } from './hologram/forms.js';

const loads = new Map(), ready = new Set();

/** null when there is nothing to wait for (no pack, or already registered); otherwise a Promise. */
export function ensurePack(theme) {
  const id = theme?.pack;
  if (!id || ready.has(id)) return null;
  if (!loads.has(id)) {
    loads.set(id, import(`./worlds/${id}.js`).then(m => {
      BACKDROPS[theme.background.renderer] = m.backdrop;
      Object.assign(FORMS, m.forms);
      ready.add(id);
    }, err => { loads.delete(id); throw err; }));
  }
  return loads.get(id);
}
