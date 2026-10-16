/**
 * version.js: build id. The Pages workflow replaces 'dev' with the commit SHA,
 * so caches (thumbnails, service worker) are invalidated on every deploy.
 * 'dev' disables persistent caching while developing locally.
 */
export const BUILD = 'dev';
