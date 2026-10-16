/*
 * font-loader.js: per-world web fonts (classic script, loaded in <head>).
 *
 * Each world only downloads its own 2–3 Google Fonts families instead of all
 * 27. This script runs before first paint so the saved world's fonts start
 * downloading immediately; theme-manager.js calls RW_FONTS.load(id) on switch
 * and RW_FONTS.preload(id) for neighbouring worlds so switches don't flash.
 */
(function () {
  'use strict';
  var SPECS = {
    "Amatic SC": "Amatic+SC:wght@700",
    "Varela Round": "Varela+Round",
    "Archivo": "Archivo:wght@400;600;800",
    "Archivo Black": "Archivo+Black",
    "Audiowide": "Audiowide",
    "Cinzel": "Cinzel:wght@500;700",
    "Cormorant Garamond": "Cormorant+Garamond:ital,wght@0,500;0,700;1,500",
    "DM Mono": "DM+Mono:wght@400;500",
    "DM Sans": "DM+Sans:wght@400;600;700",
    "EB Garamond": "EB+Garamond:wght@400;600",
    "IBM Plex Mono": "IBM+Plex+Mono:wght@400;600",
    "JetBrains Mono": "JetBrains+Mono:wght@400;700",
    "Josefin Sans": "Josefin+Sans:wght@400;600",
    "Jost": "Jost:wght@400;500;600",
    "Major Mono Display": "Major+Mono+Display",
    "Nunito Sans": "Nunito+Sans:wght@400;700",
    "Orbitron": "Orbitron:wght@500;700",
    "Permanent Marker": "Permanent+Marker",
    "Playfair Display": "Playfair+Display:wght@500;700",
    "Poiret One": "Poiret+One",
    "Rajdhani": "Rajdhani:wght@500;600;700",
    "Share Tech Mono": "Share+Tech+Mono",
    "Shippori Mincho": "Shippori+Mincho:wght@500;700",
    "Source Sans 3": "Source+Sans+3:wght@400;600",
    "Space Grotesk": "Space+Grotesk:wght@400;500;700",
    "VT323": "VT323",
    "Zen Kaku Gothic New": "Zen+Kaku+Gothic+New:wght@400;700"
};
  var WORLDS = {
    "cyberpunk": [
        "Orbitron",
        "Rajdhani",
        "Share Tech Mono"
    ],
    "artdeco": [
        "Josefin Sans",
        "Poiret One"
    ],
    "cave": [
        "Amatic SC",
        "Nunito Sans"
    ],
    "mosaic": [
        "Cormorant Garamond",
        "Nunito Sans"
    ],
    "ukiyo": [
        "Shippori Mincho",
        "Zen Kaku Gothic New"
    ],
    "baroque": [
        "EB Garamond",
        "Playfair Display"
    ],
    "street": [
        "Archivo",
        "Permanent Marker"
    ],
    "vapor": [
        "Audiowide",
        "Space Grotesk",
        "VT323"
    ],
    "brutalist": [
        "Archivo Black",
        "IBM Plex Mono",
        "Space Grotesk"
    ],
    "stained": [
        "Cinzel",
        "Source Sans 3"
    ],
    "double": [
        "Cormorant Garamond",
        "Jost"
    ],
    "tiltshift": [
        "DM Mono",
        "DM Sans"
    ],
    "glitch": [
        "JetBrains Mono",
        "Major Mono Display",
        "VT323"
    ],
    "aero": [
        "DM Mono",
        "Nunito Sans",
        "Varela Round"
    ]
};
  var loaded = {};
  function href(names) {
    return 'https://fonts.googleapis.com/css2?' + names.map(function (n) { return 'family=' + SPECS[n]; }).join('&') + '&display=swap';
  }
  function add(id, rel) {
    var names = (WORLDS[id] || []).filter(function (n) { return SPECS[n] && !loaded[n]; });
    if (!names.length) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href(names); l.dataset.world = id;
    if (rel === 'preload') l.media = 'print'; // fetch without applying; flips to 'all' once loaded
    l.onload = function () {
      l.media = 'all';
      // @font-face alone downloads nothing until text uses it; warm the files for preloaded worlds.
      if (rel === 'preload' && document.fonts && document.fonts.load) names.forEach(function (n) { document.fonts.load('16px "' + n + '"').catch(function () {}); });
    };
    names.forEach(function (n) { loaded[n] = true; });
    document.head.appendChild(l);
  }
  window.RW_FONTS = {
    worlds: WORLDS,
    load: function (id) { add(id, 'stylesheet'); },
    preload: function (id) { add(id, 'preload'); },
    loadedFamilies: function () { return Object.keys(loaded); },
  };
  // Start the saved (or deep-linked) world's fonts right away.
  var id = 'cyberpunk';
  try { id = (JSON.parse(localStorage.getItem('reverb-worlds:settings:v1') || '{}').world) || id; } catch (e) {}
  var m = /world=([a-z]+)/.exec(location.hash); if (m && WORLDS[m[1]]) id = m[1];
  window.RW_FONTS.load(id);
})();
