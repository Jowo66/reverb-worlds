/**
 * info-panel.js: the stage's World Information panel (lazy; button ⓘ or key I).
 * Every value is read live from the running engine, never hard-coded.
 */
let A = null, panel = null, timer = 0, frames = 0, fps = 0, lastT = 0, rafId = 0;

const STYLE = `
.info-panel { position: absolute; z-index: 3; top: 52px; left: 12px; max-width: min(360px, calc(100% - 24px));
  padding: 10px 12px; border-radius: var(--radius); border: 1px solid var(--border);
  background: rgba(var(--surface-rgb), .94); font-family: var(--font-mono); font-size: 12.5px; line-height: 1.5; }
.info-panel dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 12px; margin: 0; }
.info-panel dt { color: var(--muted); }
.info-panel dd { margin: 0; color: var(--text); overflow-wrap: anywhere; }
.info-panel h3 { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--primary-ink); margin-bottom: 6px; }
@media (max-width: 700px) { .info-panel { top: 88px; } }
`;

const pretty = s => s.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());

export function init(api) {
  A = api;
  const s = document.createElement('style'); s.textContent = STYLE; document.head.append(s);
}

function countFps(t) {
  frames++;
  if (t - lastT >= 1000) { fps = Math.round(frames * 1000 / (t - lastT)); frames = 0; lastT = t; }
  rafId = requestAnimationFrame(countFps);
}

function update() {
  if (!panel) return;
  const e = A.engine, t = A.themeManager.current, P = e.particles;
  let alive = 0; for (let i = 0; i < P.n; i++) if (P.life[i] > 0) alive++;
  const rows = [
    ['World', `${t.name} · ${t.num}/${A.THEMES.length}`],
    ['Forms', `${e.pool.length} · now: ${e.toForm?.label || '—'}`],
    ['Morph', `${pretty(e.transitionName)} · ${(t.hologram.motion.morph).toFixed(1)} s`],
    ['Driver', document.querySelector('#viz-mode').textContent],
    ['Particles', `rate ${t.hologram.particles.rate} · ${alive} alive`],
    ['Rendering', e.running ? `${fps} fps${e.maxFps ? ` (throttled to ${e.maxFps}: panel open)` : ''}` : 'paused'],
    ['Quality', `${pretty(e.qualityTier)} · ${e.N} points · blur ${document.documentElement.dataset.blur === 'off' ? 'off' : 'on'}`],
    ['Motion', pretty(A.settings.get('motion'))],
  ];
  const dl = panel.querySelector('dl');
  dl.replaceChildren(...rows.flatMap(([k, v]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; return [dt, dd]; }));
}

export function isOpen() { return !!panel; }

export function open() {
  if (panel) return;
  panel = document.createElement('section');
  panel.className = 'info-panel'; panel.id = 'info-panel';
  panel.setAttribute('aria-label', 'World information');
  panel.innerHTML = '<h3>World information</h3><dl></dl>';
  document.querySelector('.stage').append(panel);
  lastT = performance.now(); frames = 0; fps = 0;
  rafId = requestAnimationFrame(countFps);
  update(); timer = setInterval(update, 500);
  document.querySelector('#btn-info').setAttribute('aria-expanded', 'true');
}

export function close() {
  if (!panel) return;
  clearInterval(timer); cancelAnimationFrame(rafId);
  panel.remove(); panel = null;
  document.querySelector('#btn-info').setAttribute('aria-expanded', 'false');
}

export function toggle() { if (panel) close(); else open(); }
