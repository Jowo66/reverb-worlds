/**
 * dev-overlay.js: the Developer Overlay (lazy; key D or ?debug in the URL).
 *
 * Live engine internals for anyone curious how the site works: frame rate,
 * backdrop cost per frame (budget 3 ms), audio meters and what drives them,
 * approximate onset ticks, particles, quality tier, panel blur, backdrop
 * worker and caches. Everything is measured in this browser; nothing is sent
 * anywhere. Closing it removes every hook it added.
 */
let A = null, box = null, timer = 0, rafId = 0, frames = 0, fps = 0, lastT = 0, prevOnset = null;
let ticks = { kick: 0, snare: 0 }, flash = { kick: 0, snare: 0 }, cost = [], cacheText = '…', build = 'dev';
const wrapped = new Set();

const STYLE = `
.dev-overlay { position: absolute; z-index: 4; top: 52px; right: 12px; width: min(300px, calc(100% - 24px));
  padding: 10px 12px; border-radius: var(--radius); border: 1px dashed var(--primary);
  background: rgba(var(--surface-rgb), .95); font-family: var(--font-mono); font-size: 12px; line-height: 1.45; color: var(--text); }
.dev-overlay h3 { display: flex; justify-content: space-between; align-items: center; margin: 0 0 6px;
  font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--primary-ink); }
.dev-overlay h3 button { min-width: 28px; min-height: 28px; }
.dev-overlay dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; margin: 0; }
.dev-overlay dt { color: var(--muted); }
.dev-overlay dd { margin: 0; overflow-wrap: anywhere; }
.dev-overlay .dv-bar { display: inline-block; vertical-align: middle; width: 80px; height: 8px; margin-right: 6px; border: 1px solid var(--border); }
.dev-overlay .dv-bar i { display: block; height: 100%; background: var(--primary); }
.dev-overlay .dv-tick { display: inline-block; padding: 0 5px; border: 1px solid var(--border); margin-right: 6px; }
.dev-overlay .dv-tick.on { background: var(--primary); color: var(--on-primary, #000); }
.dev-overlay { max-height: calc(100% - 64px); overflow: auto; }
@media (max-width: 700px) { .dev-overlay { top: 8px; right: 8px; width: calc(100% - 16px); max-height: calc(100% - 16px); font-size: 11px; } }
`;

export function init(api) {
  A = api;
  const s = document.createElement('style'); s.textContent = STYLE; document.head.append(s);
}

const pct = v => Math.round(Math.max(0, Math.min(1, v || 0)) * 100);
const bar = v => `<span class="dv-bar" aria-hidden="true"><i style="width:${pct(v)}%"></i></span>${pct(v)}%`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function countFps(t) {
  frames++;
  if (t - lastT >= 1000) { fps = Math.round(frames * 1000 / (t - lastT)); frames = 0; lastT = t; }
  rafId = requestAnimationFrame(countFps);
}

/** Time the active backdrop's draw() (the renderer object changes with the world). */
function wrapBackdrop() {
  const r = window.__reverb?.backdrop?.renderer;
  if (!r || wrapped.has(r)) return;
  const orig = r.draw;
  r.draw = function (...a) { const t0 = performance.now(); const v = orig.apply(this, a); cost.push(performance.now() - t0); if (cost.length > 60) cost.shift(); return v; };
  r.__devOrig = orig; wrapped.add(r);
}

async function readCaches() {
  try { build = (await import('../version.js')).BUILD || 'dev'; } catch {}
  try {
    if (!('caches' in window)) { cacheText = 'Cache Storage unavailable'; return; }
    const names = await caches.keys(), parts = [];
    for (const n of names) parts.push(`${n} (${(await (await caches.open(n)).keys()).length})`);
    cacheText = parts.length ? parts.join(' · ') : 'empty';
  } catch { cacheText = 'blocked'; }
}

function update() {
  if (!box) return;
  wrapBackdrop();
  const e = A.engine, r = e.reactive, bd = window.__reverb?.backdrop, P = e.particles;
  let alive = 0; for (let i = 0; i < P.n; i++) if (P.life[i] > 0) alive++;
  const avg = cost.length ? cost.reduce((a, b) => a + b, 0) / cost.length : 0, worst = cost.length ? Math.max(...cost) : 0;
  const drv = document.querySelector('#viz-mode')?.textContent || '', real = /^Audio reactive/.test(drv);
  const now = performance.now(), tick = k => `<span class="dv-tick${now - flash[k] < 180 ? ' on' : ''}">${k} ${ticks[k]}</span>`;
  const rows = [
    ['Frame rate', e.running ? `${fps} fps${e.maxFps ? ` · engine throttled to ${e.maxFps}` : ''}` : 'hologram paused'],
    ['Backdrop', `${avg.toFixed(2)} ms avg · ${worst.toFixed(2)} ms worst (budget 3 ms)`],
    ['Driver', esc(drv)],
    ['Bass', bar(r.bass)], ['Mid', bar(r.mid)], ['High', bar(r.high)], ['Energy', bar(r.energy)],
    ['Onsets', `${tick('kick')}${tick('snare')}${real ? '(approximate, from the audio)' : '(from the animation clock, not the audio)'}`],
    ['Particles', `${alive} alive / ${P.n}`],
    ['Quality', `${esc(e.qualityTier)} · ${e.N} points`],
    ['Panel blur', document.documentElement.dataset.blur === 'off' ? 'off (auto quality)' : 'on'],
    ['Backdrop thread', bd?.worker ? 'worker (OffscreenCanvas)' : 'main thread'],
    ['Caches', esc(cacheText)],
    ['Build', esc(build)],
  ];
  box.querySelector('dl').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

export function isOpen() { return !!box; }

export function open() {
  if (box) return;
  box = document.createElement('section');
  box.className = 'dev-overlay'; box.id = 'dev-overlay';
  box.setAttribute('aria-label', 'Developer overlay');
  box.innerHTML = '<h3>Developer overlay <button type="button" class="btn btn-ghost" aria-label="Close developer overlay">✕</button></h3><dl></dl>';
  box.querySelector('button').addEventListener('click', close);
  document.querySelector('.stage').append(box);
  ticks = { kick: 0, snare: 0 }; cost = [];
  prevOnset = A.engine.hooks.onOnset;
  A.engine.hooks.onOnset = k => { if (k in ticks) { ticks[k]++; flash[k] = performance.now(); } prevOnset?.(k); };
  lastT = performance.now(); frames = 0; fps = 0;
  rafId = requestAnimationFrame(countFps);
  readCaches(); update(); timer = setInterval(update, 250);
}

export function close() {
  if (!box) return;
  clearInterval(timer); cancelAnimationFrame(rafId);
  A.engine.hooks.onOnset = prevOnset; prevOnset = null;
  for (const r of wrapped) { r.draw = r.__devOrig; delete r.__devOrig; }
  wrapped.clear();
  box.remove(); box = null;
}

export function toggle() { if (box) close(); else open(); }
