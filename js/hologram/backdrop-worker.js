/**
 * backdrop-worker.js: draws world backdrops' static layers and the world-card
 * thumbnails off the main thread (OffscreenCanvas), so switching worlds and
 * scrolling the world grid never stutter. Thumbnails are cached in Cache
 * Storage per build, so repeat visits skip drawing them entirely.
 */
import { BACKDROPS } from './backdrops.js';
import { mulberry32 } from './forms.js';

const ZERO = { bass: 0, mid: 0, high: 0, energy: 0, kick: 0, snare: 0 };

async function thumb({ id, renderer, w, h, build }) {
  const key = `thumb/${id}-${w}x${h}.png`;
  let cache = null;
  if (build !== 'dev' && self.caches) {
    try {
      cache = await caches.open(`rw-thumbs-${build}`);
      const hit = await cache.match(key);
      if (hit) return { bitmap: await createImageBitmap(await hit.blob()), cached: true };
    } catch { cache = null; }
  }
  const c = new OffscreenCanvas(w, h), ctx = c.getContext('2d');
  const S = { w, h, dpr: 0.5, rng: mulberry32(7), glitch: 0.5, animate: false };
  BACKDROPS[renderer].init(S);
  BACKDROPS[renderer].draw(ctx, S, 3, 0, ZERO);
  if (cache) { try { await cache.put(key, new Response(await c.convertToBlob({ type: 'image/png' }))); } catch {} }
  return { bitmap: c.transferToImageBitmap(), cached: false };
}

/** Run a backdrop's init() and ship its state back; layer canvases become transferable ImageBitmaps. */
function init({ renderer, w, h, dpr, glitch }) {
  const S = { w, h, dpr, rng: mulberry32(1337), glitch, animate: false };
  BACKDROPS[renderer].init(S);
  delete S.rng; // functions can't be cloned; the main thread re-adds it
  const transfer = [];
  for (const [k, v] of Object.entries(S)) {
    if (v instanceof OffscreenCanvas) { const b = v.transferToImageBitmap(); S[k] = b; transfer.push(b); }
  }
  return { S, transfer };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'thumb') {
      const { bitmap, cached } = await thumb(data);
      self.postMessage({ type: 'thumb', id: data.id, bitmap, cached }, [bitmap]);
    } else if (data.type === 'init') {
      const { S, transfer } = init(data);
      self.postMessage({ type: 'init', seq: data.seq, S }, transfer);
    }
  } catch (err) {
    self.postMessage({ type: 'error', of: data.type, id: data.id, seq: data.seq, message: String(err && err.message || err) });
  }
};
