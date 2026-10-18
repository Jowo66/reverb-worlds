/**
 * share.js: Share links (lazy; loaded only when a link is opened or shared).
 *
 * A link is a readable hash, e.g.
 *   #world=cyberpunk&form=neon-helix&i=75&g=45&rx=0.20&ry=1.10&am=1&ami=16&src=reverb:tessellate&bpm=118
 * Every field is optional except `world`. Incoming links are untrusted: they
 * are turned into an Experience and passed through validate(), so unknown
 * worlds, forms from other worlds, out-of-range numbers and non-Spotify URIs
 * are dropped. A link can lower motion (m=reduced) but never raise it, and it
 * never starts playback: the visitor gets a Play prompt.
 */
let A = null;
const SHARE_KEYS = ['form', 'i', 'g', 'rx', 'ry', 'am', 'ami', 'm', 'src', 'bpm', 'name'];

export function init(api) { A = api; }

/** Does this hash carry more than a plain #world=? (cheap test used by app.js) */
export const isShareHash = h => SHARE_KEYS.some(k => new URLSearchParams(String(h).replace(/^#/, '')).has(k));

export function encode(exp) {
  const q = new URLSearchParams();
  q.set('world', exp.world);
  if (exp.form) q.set('form', exp.form);
  const s = exp.settings || {};
  if (s.intensity != null) q.set('i', s.intensity);
  if (s.glitch != null) q.set('g', s.glitch);
  if (s.autoMorph != null) q.set('am', s.autoMorph ? 1 : 0);
  if (s.autoMorphInterval != null) q.set('ami', s.autoMorphInterval);
  if (s.motion && s.motion !== 'full') q.set('m', s.motion); // only meaningful when it lowers motion
  if (exp.view) { q.set('rx', exp.view.rx.toFixed(2)); q.set('ry', exp.view.ry.toFixed(2)); }
  if (exp.source?.type === 'reverb') q.set('src', `reverb:${exp.source.id}`);
  if (exp.source?.type === 'spotify') q.set('src', exp.source.uri);
  if (exp.tempo) q.set('bpm', exp.tempo);
  if (exp.name) q.set('name', exp.name);
  return `${location.origin}${location.pathname.replace(/index\.html$/, '')}#${q.toString()}`;
}

export function decode(hash) {
  const q = new URLSearchParams(String(hash).replace(/^#/, ''));
  const n = k => (q.has(k) && q.get(k).trim() !== '' ? Number(q.get(k)) : undefined);
  const settings = {};
  if (n('i') !== undefined) settings.intensity = n('i');
  if (n('g') !== undefined) settings.glitch = n('g');
  if (q.has('am')) settings.autoMorph = q.get('am') === '1';
  if (n('ami') !== undefined) settings.autoMorphInterval = n('ami');
  if (q.has('m')) settings.motion = q.get('m');
  const src = q.get('src') || '';
  const source = src.startsWith('reverb:') ? { type: 'reverb', id: src.slice(7) } : src.startsWith('spotify:') ? { type: 'spotify', uri: src } : undefined;
  return A.X.validate({
    world: q.get('world'), form: q.get('form') || undefined, name: q.get('name') || undefined,
    view: n('rx') !== undefined && n('ry') !== undefined ? { rx: n('rx'), ry: n('ry') } : undefined,
    settings, source, tempo: n('bpm'),
  });
}

/** Open a share link: apply visuals, cue music, never autoplay. Returns true if handled. */
export async function open(hash) {
  const exp = decode(hash);
  if (!exp) { A.toast('That share link isn’t valid, so nothing was changed.', 4000); return false; }
  A.X.apply(exp, A.xctx());
  const label = exp.name ? `“${exp.name}”` : 'A shared experience';
  if (exp.source?.type === 'reverb') {
    await A.useMedia();
    const idx = A.media.items.findIndex(i => i.id === `demo:${exp.source.id}`);
    if (idx >= 0) A.media.cue(idx, 0);
    A.toast(`${label} is ready.`, 12000, { label: 'Play', run: () => { A.analyser.ensureContext(); A.player.play(); document.querySelector('#toast').classList.remove('show'); } });
  } else if (exp.source?.type === 'spotify') {
    A.toast(`${label} loaded. Its music is on Spotify: opening the Spotify player (previews unless you’re logged in to Spotify in this browser).`, 9000, { label: 'Open', run: async () => {
      await A.player.use('spotify-embed'); await A.embed.load(exp.source.uri); document.querySelector('#toast').classList.remove('show');
    } });
  } else A.toast(`${label} loaded.`, 3000);
  return true;
}

/** Copy a link for an Experience (current view when none is given). */
export async function copy(exp = A.X.capture(A.xctx())) {
  const url = encode(exp);
  try { await navigator.clipboard.writeText(url); A.toast('Share link copied.', 2500); }
  catch { showFallback(url); }
  return url;
}

function showFallback(url) {
  // Clipboard blocked (permissions/insecure context): show the link so it can be copied by hand.
  A.toast('Copy this share link:', 15000);
  const t = document.querySelector('#toast'), inp = document.createElement('input');
  inp.type = 'text'; inp.readOnly = true; inp.value = url; inp.setAttribute('aria-label', 'Share link'); inp.style.minWidth = '260px';
  t.append(' ', inp); t.classList.add('has-action'); inp.focus(); inp.select();
}
