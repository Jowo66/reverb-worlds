/**
 * sw.js: offline cache for repeat visits.
 *
 * Every site file is pre-cached per build (BUILD is replaced with the commit
 * SHA by the Pages workflow). Files are served cache-first, so return visits
 * load instantly and the whole app works offline. A new deploy installs a new
 * worker that waits; the page offers "Reload" so a running session never
 * mixes files from two versions. Google Fonts are cached stale-while-
 * revalidate. Spotify and other cross-origin traffic is never touched.
 */
const BUILD = 'dev';
const SHELL_CACHE = 'rw-shell-' + BUILD;
const FONT_CACHE = 'rw-fonts';
const SHELL = [
    './',
    'assets/icons/favicon.svg',
    'css/components.css',
    'css/layout.css',
    'css/reset.css',
    'css/themes.css',
    'css/tokens.css',
    'index.html',
    'js/app.js',
    'js/audio-analyser.js',
    'js/config.js',
    'js/font-loader.js',
    'js/hologram/backdrop-worker.js',
    'js/hologram/backdrops.js',
    'js/hologram/forms.js',
    'js/hologram/hologram-engine.js',
    'js/player/demo-synth.js',
    'js/player/lazy-provider.js',
    'js/player/media-provider.js',
    'js/player/player-adapter.js',
    'js/player/spotify-common.js',
    'js/player/spotify-embed.js',
    'js/player/spotify-sdk.js',
    'js/settings.js',
    'js/theme-manager.js',
    'js/theme-registry.js',
    'js/version.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('rw-shell-') && k !== SHELL_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    e.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Navigations (including Spotify's ?code= redirect back) are served the cached page.
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    })());
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
  }
});
