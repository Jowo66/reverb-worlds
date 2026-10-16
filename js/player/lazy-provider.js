/**
 * lazy-provider.js: stand-in for a player provider whose code loads on first use.
 *
 * The Spotify providers (and spotify-common.js) aren't downloaded at startup.
 * The proxy answers cheap synchronous questions from `defaults` (signed in?
 * device id? capabilities?) and loads the real module the first time any
 * listed method is called. After that every property and method goes
 * straight to the real instance. Events ('state', 'needs-selection') are
 * forwarded, so listeners can subscribe before the module exists.
 */
export function lazyProvider({ id, label, load, methods, defaults, events = ['state'] }) {
  const target = new EventTarget();
  const methodSet = new Set(methods);
  const own = new Set(['addEventListener', 'removeEventListener', 'dispatchEvent']);
  let real = null, loading = null;
  const ensure = () => loading || (loading = load().then(inst => {
    real = inst;
    for (const type of events) inst.addEventListener(type, () => target.dispatchEvent(new Event(type)));
    target.dispatchEvent(new Event('state'));
    return inst;
  }, err => { loading = null; throw err; }));

  return new Proxy(target, {
    get(_, p) {
      if (typeof p === 'symbol' || p === 'then') return undefined; // never look like a Promise
      if (p === 'ensureLoaded') return ensure;
      if (p === 'loaded') return !!real;
      if (p === 'id') return id;
      if (p === 'label') return label;
      if (own.has(p)) return target[p].bind(target);
      if (real) { const v = real[p]; return typeof v === 'function' ? v.bind(real) : v; }
      if (Object.prototype.hasOwnProperty.call(defaults, p)) { const d = defaults[p]; return typeof d === 'function' ? d() : d; }
      if (methodSet.has(p)) return async (...args) => (await ensure())[p](...args);
      return undefined;
    },
    set(_, p, v) { if (real) real[p] = v; else defaults[p] = v; return true; },
  });
}
