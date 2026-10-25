/**
 * tour.js: the 60-second Recruiter Tour (lazy; started by a click, because
 * browsers only allow audio after a user gesture).
 *
 * Plays a REVERB Original, morphs, switches four contrasting worlds, opens the
 * live Info panel and demonstrates reduced motion. Esc or "Stop tour" ends it.
 * Afterwards the visitor's own world, shape and settings are restored, and
 * motion is never raised above what the visitor chose.
 */
let A = null, running = false, timers = [], bar = null, before = null, prevMotion = null, infoWasOpen = false;

const STYLE = `
.tour-bar { position: fixed; z-index: 55; left: 50%; transform: translateX(-50%); bottom: calc(var(--player-h) + var(--gap) * 2 + 8px);
  width: min(640px, calc(100vw - 24px)); display: flex; gap: 12px; align-items: center; padding: 12px 14px;
  border-radius: var(--radius); border: 1px solid var(--primary); background: rgba(var(--surface-rgb), .97); box-shadow: var(--panel-shadow); }
.tour-bar p { flex: 1; margin: 0; font-weight: 600; }
.tour-bar .tour-step { font-family: var(--font-mono); color: var(--muted); font-size: 12px; white-space: nowrap; }
.tour-bar progress { width: 72px; accent-color: var(--primary); }
`;

export function init(api) {
  A = api;
  const s = document.createElement('style'); s.textContent = STYLE; document.head.append(s);
}

const speed = () => (window.__reverb && window.__reverb.tourSpeed) || 1; // tests run the tour faster
const at = (sec, fn) => timers.push(setTimeout(() => { if (running) fn(); }, sec * 1000 * speed()));

function caption(text, step, total) {
  bar.querySelector('p').textContent = text;
  bar.querySelector('.tour-step').textContent = `${step} / ${total}`;
  bar.querySelector('progress').value = step / total;
}

/** Steps: [time (s), caption, action]. Total ≈ 58 s. */
function script() {
  const reduced = A.settings.get('motion') !== 'full';
  return [
    [0, 'REVERB // WORLDS: one music engine, 15 visual worlds. Starting a track made entirely in your browser…', async () => {
      await A.useMedia(); A.analyser.ensureContext();
      const st = A.player.state;
      if (!st.playing) A.player.playIndex(Math.max(0, st.index));
    }],
    [7, 'The hologram has 137 forms. Each morphs into the next point-for-point.', () => A.engine.morph()],
    [12, 'Each world has its own morph style, reactions and particles.', () => A.engine.morph()],
    [17, 'Switching worlds never interrupts the music: Cyberpunk…', () => A.themeManager.apply('cyberpunk', 'tour')],
    [23, '…Japanese Scroll: flat woodblock-print shapes and ink…', () => A.themeManager.apply('ukiyo', 'tour')],
    [29, '…Brutalist: heavy, stepped motion…', () => A.themeManager.apply('brutalist', 'tour')],
    [35, '…and Frutiger Aero: glossy bubbles and sky.', () => A.themeManager.apply('aero', 'tour')],
    [41, 'Live engine data: what drives the visuals, frame rate, quality and particles.', () => openInfo()],
    [48, reduced ? 'Accessibility: you’re already using reduced motion, so the tour respected it the whole time.'
                 : 'Accessibility: reduced motion swaps big movements for gentle crossfades.', () => { if (!reduced) A.settings.set('motion', 'reduced'); A.engine.morph(); }],
    [55, 'That’s the tour. Everything you saw is generated in code: no images, no audio files, no frameworks.', () => {}],
    [59, null, () => stop('done')],
  ];
}

async function openInfo() {
  const m = await A.loadFeature('info-panel');
  infoWasOpen = m.isOpen();
  if (!infoWasOpen) m.open();
}

export function isRunning() { return running; }

export function start() {
  if (running) return;
  running = true;
  before = A.X.capture(A.xctx());
  prevMotion = A.settings.get('motion');
  bar = document.createElement('div');
  bar.className = 'tour-bar'; bar.setAttribute('role', 'status'); bar.setAttribute('aria-live', 'polite');
  bar.innerHTML = '<progress max="1" value="0" aria-hidden="true"></progress><p></p><span class="tour-step"></span><button type="button" class="btn">Stop tour</button>';
  bar.querySelector('button').addEventListener('click', () => stop('button'));
  document.body.append(bar);
  const steps = script(), total = steps.filter(s => s[1]).length;
  steps.forEach(([t, text, fn], i) => at(t, () => { if (text) caption(text, i + 1, total); fn(); }));
}

export function stop(reason) {
  if (!running) return;
  running = false;
  timers.forEach(clearTimeout); timers = [];
  bar?.remove(); bar = null;
  // Restore the visitor's world, shape and settings; music keeps playing.
  if (before) A.X.apply(before, A.xctx());
  if (prevMotion && A.settings.get('motion') !== prevMotion) A.settings.set('motion', prevMotion);
  A.loadFeature('info-panel').then(m => { if (!infoWasOpen) m.close(); });
  if (reason === 'done') A.toast('Tour complete. Your world and settings are back as they were.', 3500);
  else A.toast('Tour stopped.', 1500);
}
