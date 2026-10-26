/**
 * theme-registry.js — the 15 worlds, defined as data.
 *
 * Every world shares one player and one hologram engine. A world only
 * describes presentation:
 *   palette        → CSS custom properties (applied by theme-manager.js)
 *   fonts          → display/body stacks with safe fallbacks
 *   panel          → radius / border / shadow tokens
 *   background     → which procedural backdrop renderer to use + its fps budget
 *   hologram
 *     forms        → ids from hologram/forms.js (the world's unique form pool)
 *     material     → how the point cloud is drawn (see hologram-engine.js)
 *     motion       → rotation / sway / morph duration
 *     transition   → morph transition style
 *     reactions    → named reactions for kick / snare / high-frequency energy
 *     particles    → ambient particle configuration
 *   performance    → quality defaults
 *   a11y           → flags (e.g. glitchy worlds honour the Glitch-intensity setting)
 */

export const THEMES = [
  {
    id: 'cyberpunk', num: '01', name: 'Cyberpunk', tagline: 'Neon / Night City',
    mood: 'Rain-slick streets under electric signage.',
    palette: { bg: '#070914', surface: '#0c1124', primary: '#ff3ec9', primaryInk: '#ff7ad9', onPrimary: '#12020d', secondary: '#34dfff', accent: '#a77bff', text: '#f4f7ff', muted: '#aab5d8', border: 'rgba(52,223,255,0.55)' },
    fonts: { display: "'Orbitron', 'Rajdhani', 'Arial Narrow', sans-serif", body: "'Rajdhani', 'Segoe UI', system-ui, sans-serif", mono: "'Share Tech Mono', ui-monospace, monospace" },
    panel: { radius: '6px', borderWidth: '1px', shadow: '0 0 0 1px rgba(255,62,201,.15), 0 10px 40px rgba(0,0,0,.55), 0 0 24px rgba(52,223,255,.12)', alpha: 0.82 },
    background: { renderer: 'cyberpunk', fps: 30 },
    hologram: {
      forms: ['neon-torus', 'poly-core', 'frag-cube', 'scan-ring', 'crystal-shards', 'radar-sphere', 'neon-helix', 'hex-tunnel'],
      material: { colors: ['#34dfff', '#ff3ec9', '#a77bff', '#e9f6ff'], colorMode: 'depth', composite: 'lighter', lines: true, point: 'dot', pointSize: 1.3, lineWidth: 1.15, glow: 3.2, glowAlpha: 0.16, rgb: 0.25 },
      motion: { rotate: 0.32, tilt: 0.38, morph: 1.3 },
      transition: 'scan-wipe',
      reactions: { kick: 'bloom-pulse', snare: 'rgb-scan', high: 'neon-sparks' },
      particles: { kind: 'spark', colors: ['#34dfff', '#ff3ec9', '#ffffff'], rate: 22 },
    },
    a11y: { glitchy: true },
  },
  {
    id: 'artdeco', num: '02', name: 'Art Deco', tagline: 'Gilded Symmetry',
    mood: 'Streamlined luxury in champagne gold and emerald.',
    palette: { bg: '#05110e', surface: '#0a1d18', primary: '#d9b36c', primaryInk: '#e6c88a', onPrimary: '#14100a', secondary: '#f3ead3', accent: '#9a2f44', text: '#f5eedb', muted: '#cdbf98', border: 'rgba(217,179,108,0.8)' },
    fonts: { display: "'Poiret One', 'Didot', 'Georgia', serif", body: "'Josefin Sans', 'Gill Sans', system-ui, sans-serif", mono: "'Josefin Sans', ui-monospace, monospace" },
    panel: { radius: '0px', borderWidth: '1px', shadow: 'inset 0 0 0 4px rgba(5,17,14,.9), inset 0 0 0 5px rgba(217,179,108,.55), 0 18px 40px rgba(0,0,0,.5)', alpha: 0.9 },
    background: { renderer: 'artdeco', fps: 24 },
    hologram: {
      forms: ['faceted-crystal', 'stepped-pyramid', 'sun-disc', 'concentric-fan', 'gold-polyhedron', 'radial-wire', 'deco-skyscraper', 'chevron-burst'],
      material: { colors: ['#f6dfa6', '#d9b36c', '#a8823f', '#fff4d6'], colorMode: 'depth', composite: 'source-over', lines: true, point: 'glint', pointSize: 1.1, lineWidth: 1.1, glow: 2.2, glowAlpha: 0.12, metallic: true, symmetric: true },
      motion: { rotate: 0.18, tilt: 0.22, morph: 1.8 },
      transition: 'iris',
      reactions: { kick: 'sunburst', snare: 'mirror-flash', high: 'gold-dust' },
      particles: { kind: 'dust', colors: ['#f6dfa6', '#d9b36c'], rate: 12 },
    },
  },
  {
    id: 'cave', num: '03', name: 'Cave Drawings', tagline: 'Ochre & Charcoal',
    mood: 'Pigment, stone and firelight — an artistic interpretation.',
    palette: { bg: '#2a1a10', surface: '#1b110a', primary: '#e0954a', primaryInk: '#eca865', onPrimary: '#1b0f05', secondary: '#c0533a', accent: '#efe3c8', text: '#f4e8d0', muted: '#cdb795', border: 'rgba(224,149,74,0.55)' },
    fonts: { display: "'Amatic SC', 'Comic Sans MS', cursive", body: "'Nunito Sans', 'Trebuchet MS', system-ui, sans-serif", mono: "'Nunito Sans', ui-monospace, monospace" },
    panel: { radius: '18px 10px 22px 12px', borderWidth: '2px', shadow: '0 12px 30px rgba(0,0,0,.55)', alpha: 0.9 },
    background: { renderer: 'cave', fps: 20 },
    hologram: {
      forms: ['sun-disc-rough', 'bison', 'hand-stencil', 'animal-migration', 'pigment-rings', 'charcoal-spiral', 'spear-hunter', 'dot-constellation'],
      material: { colors: ['#e0954a', '#c0533a', '#efe3c8', '#2b1d14'], colorMode: 'index', composite: 'source-over', lines: true, point: 'none', lineWidth: 2.6, rough: 1.0, flat: true, fill: 0.35, fillColors: ['#c0533a', '#e0954a'], pigmentSpray: true },
      motion: { rotate: 0, tilt: 0, sway: 0.05, morph: 2.2 },
      transition: 'stroke-redraw',
      reactions: { kick: 'pigment-stamp', snare: 'dust-burst', high: 'mineral-specks' },
      particles: { kind: 'speck', colors: ['#efe3c8', '#e0954a'], rate: 10 },
    },
  },
  {
    id: 'mosaic', num: '04', name: 'Mosaic', tagline: 'Glass Tesserae',
    mood: 'Jewel-tone tiles that shimmer and reassemble.',
    palette: { bg: '#0b1430', surface: '#0d1631', primary: '#33c9c4', primaryInk: '#5fd8d4', onPrimary: '#04181a', secondary: '#f2a93b', accent: '#e0435e', text: '#f6f3eb', muted: '#bcc4dd', border: 'rgba(51,201,196,0.6)' },
    fonts: { display: "'Cormorant Garamond', 'Garamond', serif", body: "'Nunito Sans', system-ui, sans-serif", mono: "'Nunito Sans', ui-monospace, monospace" },
    panel: { radius: '4px', borderWidth: '6px', shadow: '0 14px 34px rgba(0,0,0,.5)', alpha: 0.9 },
    background: { renderer: 'mosaic', fps: 20 },
    hologram: {
      forms: ['tess-sphere', 'tile-torus', 'faceted-flower', 'kaleidoscope', 'frag-poly', 'tile-wave', 'tile-star', 'tile-spiral'],
      material: { colors: ['#2a5bd7', '#d6334f', '#f2a93b', '#21a67a', '#33c9c4', '#9b5de5'], colorMode: 'random', composite: 'source-over', lines: false, point: 'tile', pointSize: 6, lineWidth: 1, grout: true },
      motion: { rotate: 0.22, tilt: 0.3, morph: 1.7 },
      transition: 'tile-reassemble',
      reactions: { kick: 'tile-lift', snare: 'sparkle-wave', high: 'tile-twinkle' },
      particles: { kind: 'glint', colors: ['#ffffff', '#f2a93b', '#33c9c4'], rate: 14 },
    },
  },
  {
    id: 'ukiyo', num: '05', name: 'Japanese Scroll', tagline: 'Woodblock Print',
    mood: 'Flat colour, confident contour, a slow unrolling scroll.',
    palette: { bg: '#efe5cf', surface: '#f8f1df', primary: '#b8322a', primaryInk: '#a72b23', onPrimary: '#fff8ee', secondary: '#1f3a5f', accent: '#4f7f6b', text: '#1b2232', muted: '#4c5263', border: 'rgba(31,58,95,0.85)' },
    fonts: { display: "'Shippori Mincho', 'Hiragino Mincho ProN', 'Times New Roman', serif", body: "'Zen Kaku Gothic New', 'Hiragino Sans', system-ui, sans-serif", mono: "'Zen Kaku Gothic New', ui-monospace, monospace" },
    panel: { radius: '2px', borderWidth: '2px', shadow: '6px 6px 0 rgba(31,58,95,.18)', alpha: 0.94 },
    background: { renderer: 'ukiyo', fps: 20 },
    hologram: {
      forms: ['wave-crest', 'paper-fan', 'moon-disc', 'crane', 'ink-circle', 'flowing-ribbon', 'abstract-crest', 'mount-peak', 'koi'],
      material: { colors: ['#1f3a5f', '#1b2232', '#b8322a', '#4f7f6b'], colorMode: 'index', composite: 'source-over', lines: true, point: 'none', lineWidth: 2.2, flat: true, fill: 0.9, fillColors: ['#1f3a5f', '#b8322a', '#f8f1df', '#4f7f6b', '#c9a24a'], ink: true },
      motion: { rotate: 0, tilt: 0, sway: 0.03, morph: 2.0 },
      transition: 'brush-reveal',
      reactions: { kick: 'wave-swell', snare: 'brush-flash', high: 'ink-flecks' },
      particles: { kind: 'fleck', colors: ['#1b2232', '#b8322a'], rate: 8 },
    },
  },
  {
    id: 'baroque', num: '06', name: 'Baroque', tagline: 'Chiaroscuro',
    mood: 'Candlelit drama emerging from deep shadow.',
    palette: { bg: '#0a0604', surface: '#150c07', primary: '#d2a24c', primaryInk: '#e2b866', onPrimary: '#140c04', secondary: '#8a2433', accent: '#f0c987', text: '#f3e7d0', muted: '#c4ad8c', border: 'rgba(210,162,76,0.6)' },
    fonts: { display: "'Playfair Display', 'Didot', Georgia, serif", body: "'EB Garamond', Georgia, serif", mono: "'EB Garamond', ui-monospace, monospace" },
    panel: { radius: '3px', borderWidth: '1px', shadow: 'inset 0 0 0 1px rgba(0,0,0,.6), inset 0 0 0 3px rgba(210,162,76,.35), 0 20px 60px rgba(0,0,0,.75)', alpha: 0.92 },
    background: { renderer: 'baroque', fps: 24 },
    hologram: {
      forms: ['bust', 'gilded-orb', 'drapery', 'medallion', 'rosette', 'carved-poly', 'cherub-wing', 'baroque-column'],
      material: { colors: ['#ffe2a8', '#d2a24c', '#8a5a26', '#3a2210'], colorMode: 'light', composite: 'source-over', lines: true, point: 'dot', pointSize: 1.0, lineWidth: 1.4, glow: 2.5, glowAlpha: 0.1, spotlight: true },
      motion: { rotate: 0.12, tilt: 0.18, morph: 2.6 },
      transition: 'emerge',
      reactions: { kick: 'light-swell', snare: 'candle-flare', high: 'light-motes' },
      particles: { kind: 'mote', colors: ['#f0c987', '#ffe2a8'], rate: 9 },
    },
  },
  {
    id: 'street', num: '07', name: 'Street Art', tagline: 'Spray & Stencil',
    mood: 'Concrete, paste-ups and fresh aerosol.',
    palette: { bg: '#5d5d5a', surface: '#121212', primary: '#e8ff2a', primaryInk: '#e8ff2a', onPrimary: '#111111', secondary: '#22d3ee', accent: '#ff3b30', text: '#ffffff', muted: '#d2d2d2', border: '#ffffff' },
    fonts: { display: "'Permanent Marker', 'Marker Felt', 'Comic Sans MS', cursive", body: "'Archivo', 'Arial', system-ui, sans-serif", mono: "'Archivo', ui-monospace, monospace" },
    panel: { radius: '2px', borderWidth: '3px', shadow: '6px 6px 0 #ff3b30', alpha: 0.95 },
    background: { renderer: 'street', fps: 20 },
    hologram: {
      forms: ['spray-ring', 'stencil-bird', 'drip-mark', 'sticker-star', 'halftone-sphere', 'abstract-glyph', 'spray-can', 'crown-tag'],
      material: { colors: ['#e8ff2a', '#22d3ee', '#ff3b30', '#ffffff'], colorMode: 'index', composite: 'source-over', lines: true, point: 'halftone', pointSize: 2.6, lineWidth: 4, flat: true, fill: 0.95, fillColors: ['#111111', '#e8ff2a', '#22d3ee', '#ff3b30'], spray: true, clip: true },
      motion: { rotate: 0.05, tilt: 0, sway: 0.12, morph: 1.2 },
      transition: 'spray',
      reactions: { kick: 'paint-ring', snare: 'splatter', high: 'aerosol-mist' },
      particles: { kind: 'mist', colors: ['#e8ff2a', '#22d3ee', '#ff3b30'], rate: 16 },
    },
  },
  {
    id: 'vapor', num: '08', name: 'Vaporwave', tagline: 'Sunset.exe',
    mood: 'Pastel sunsets, chrome, and a grid to the horizon.',
    palette: { bg: '#1a0b2e', surface: '#1d0d36', primary: '#ff71ce', primaryInk: '#ff8fd8', onPrimary: '#200516', secondary: '#01cdfe', accent: '#b967ff', text: '#fff6ff', muted: '#dac6f2', border: 'rgba(1,205,254,0.65)' },
    fonts: { display: "'Audiowide', 'Arial Black', sans-serif", body: "'Space Grotesk', system-ui, sans-serif", mono: "'VT323', ui-monospace, monospace" },
    panel: { radius: '10px', borderWidth: '2px', shadow: '0 0 0 1px rgba(255,113,206,.35), 8px 8px 0 rgba(1,205,254,.25)', alpha: 0.84 },
    background: { renderer: 'vapor', fps: 30 },
    hologram: {
      forms: ['chrome-torus', 'wire-pyramid', 'classic-bust', 'sunset-disc', 'palm-frond', 'marble-fragment', 'wire-dolphin', 'retro-terrain'],
      material: { colors: ['#01cdfe', '#ff71ce', '#b967ff', '#fffb96'], colorMode: 'height', composite: 'lighter', lines: true, point: 'none', lineWidth: 1.4, glow: 2.6, glowAlpha: 0.14, chrome: true, rgb: 0.15 },
      motion: { rotate: 0.25, tilt: 0.25, morph: 1.4 },
      transition: 'lowpoly-scan',
      reactions: { kick: 'grid-ripple', snare: 'vhs-tear', high: 'pixel-stars' },
      particles: { kind: 'pixel', colors: ['#fffb96', '#01cdfe', '#ff71ce'], rate: 12 },
    },
    a11y: { glitchy: true },
  },
  {
    id: 'brutalist', num: '09', name: 'Brutalist', tagline: 'Raw Concrete',
    mood: 'Structural honesty. Heavy, direct, unpolished.',
    palette: { bg: '#a9a6a0', surface: '#e7e5df', primary: '#ff5a1f', primaryInk: '#a83300', onPrimary: '#111111', secondary: '#2a2a2a', accent: '#d7261e', text: '#121212', muted: '#3a3a3a', border: '#121212' },
    fonts: { display: "'Archivo Black', 'Arial Black', Impact, sans-serif", body: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif", mono: "'IBM Plex Mono', ui-monospace, monospace" },
    panel: { radius: '0px', borderWidth: '3px', shadow: '10px 10px 0 rgba(18,18,18,.85)', alpha: 0.97 },
    background: { renderer: 'brutalist', fps: 15 },
    hologram: {
      forms: ['monolith', 'stacked-blocks', 'industrial-ring', 'beam-structure', 'brutal-arch', 'shifting-cuboid', 'stair-block', 'waffle-slab'],
      material: { colors: ['#121212', '#3a3a3a', '#6b6b6b', '#ff5a1f'], colorMode: 'depth', composite: 'source-over', lines: true, point: 'square', pointSize: 2, lineWidth: 2.4, accentEvery: 9 },
      motion: { rotate: 0.14, tilt: 0.2, morph: 1.1, hard: true },
      transition: 'slab',
      reactions: { kick: 'compress', snare: 'hard-cut', high: 'metal-dust' },
      particles: { kind: 'speck', colors: ['#2a2a2a', '#ff5a1f'], rate: 4 },
    },
  },
  {
    id: 'stained', num: '10', name: 'Stained Glass', tagline: 'Luminous Panes',
    mood: 'Jewel-tone glass lit from behind by bold lead lines.',
    palette: { bg: '#07070d', surface: '#0e0d18', primary: '#e8b030', primaryInk: '#f0c254', onPrimary: '#140e02', secondary: '#3b7be0', accent: '#d03656', text: '#f7f2e7', muted: '#c6bfd3', border: '#3d3550' },
    fonts: { display: "'Cinzel', 'Trajan Pro', Georgia, serif", body: "'Source Sans 3', 'Segoe UI', system-ui, sans-serif", mono: "'Source Sans 3', ui-monospace, monospace" },
    panel: { radius: '14px', borderWidth: '5px', shadow: '0 0 0 2px #000, 0 0 30px rgba(232,176,48,.12), 0 18px 40px rgba(0,0,0,.6)', alpha: 0.9 },
    background: { renderer: 'stained', fps: 20 },
    hologram: {
      forms: ['rose-window', 'glass-sphere', 'radial-medallion', 'jewel-polyhedron', 'glass-flower', 'geometric-halo', 'lancet-arch', 'quatrefoil'],
      material: { colors: ['#e8b030', '#3b7be0', '#d03656', '#2fa86b', '#8e4fd6', '#2cc2c9'], colorMode: 'index', composite: 'source-over', lines: true, point: 'none', lineWidth: 1.6, leaded: true, fill: 0.55, fillColors: ['#3b7be0', '#d03656', '#e8b030', '#2fa86b', '#8e4fd6', '#2cc2c9'], flatish: true },
      motion: { rotate: 0.1, tilt: 0.12, morph: 1.9 },
      transition: 'lead-assemble',
      reactions: { kick: 'pane-brighten', snare: 'lead-ray', high: 'caustic-glints' },
      particles: { kind: 'glint', colors: ['#fff3c4', '#bfe3ff'], rate: 10 },
    },
  },
  {
    id: 'double', num: '11', name: 'Double Exposure', tagline: 'Portrait / Forest',
    mood: 'A quiet silhouette where a forest breathes.',
    palette: { bg: '#dfe2dc', surface: '#f3f2ec', primary: '#3d5a4c', primaryInk: '#34503f', onPrimary: '#f3f2ec', secondary: '#6c7f92', accent: '#b67c42', text: '#1d2824', muted: '#46524d', border: 'rgba(29,40,36,0.4)' },
    fonts: { display: "'Cormorant Garamond', 'Garamond', serif", body: "'Jost', 'Futura', system-ui, sans-serif", mono: "'Jost', ui-monospace, monospace" },
    panel: { radius: '20px', borderWidth: '1px', shadow: '0 20px 50px rgba(29,40,36,.18)', alpha: 0.8 },
    background: { renderer: 'double', fps: 24 },
    hologram: {
      forms: ['human-silhouette', 'tree-ring-sphere', 'forest-profile', 'layered-moon', 'mist-ribbon', 'contour-loops', 'stag-antlers', 'bird-flock'],
      material: { colors: ['#2f4a3d', '#6c7f92', '#b67c42', '#8fa59a'], colorMode: 'height', composite: 'source-over', lines: true, point: 'dot', pointSize: 1.2, lineWidth: 1.6, ghost: true, alpha: 0.92 },
      motion: { rotate: 0.08, tilt: 0.1, sway: 0.08, morph: 2.4 },
      transition: 'crossfade',
      reactions: { kick: 'layer-drift', snare: 'exposure-flash', high: 'pollen' },
      particles: { kind: 'pollen', colors: ['#b67c42', '#ffffff', '#8fa59a'], rate: 10 },
    },
  },
  {
    id: 'tiltshift', num: '12', name: 'Tilt Shift', tagline: 'Model City',
    mood: 'A miniature city in a narrow band of focus.',
    palette: { bg: '#8fbf8a', surface: '#fbfaf4', primary: '#ff6b3d', primaryInk: '#b8401a', onPrimary: '#1b1206', secondary: '#2b8fd0', accent: '#ffcf33', text: '#1a2330', muted: '#455163', border: 'rgba(26,35,48,0.35)' },
    fonts: { display: "'DM Sans', 'Helvetica Neue', Arial, sans-serif", body: "'DM Sans', 'Helvetica Neue', Arial, sans-serif", mono: "'DM Mono', ui-monospace, monospace" },
    panel: { radius: '14px', borderWidth: '1px', shadow: '0 2px 0 rgba(26,35,48,.12), 0 14px 30px rgba(26,35,48,.18)', alpha: 0.93 },
    background: { renderer: 'tiltshift', fps: 24 },
    hologram: {
      forms: ['mini-skyline', 'ferris-wheel', 'city-block', 'arch-cube', 'train-loop', 'toy-planet', 'hot-air-balloon', 'mini-lighthouse'],
      material: { colors: ['#ff6b3d', '#2b8fd0', '#ffcf33', '#2fa86b', '#1a2330'], colorMode: 'index', composite: 'source-over', lines: true, point: 'dot', pointSize: 2, lineWidth: 2.2, focusBand: true },
      motion: { rotate: 0.16, tilt: 0.5, morph: 1.6 },
      transition: 'focus-pull',
      reactions: { kick: 'focus-ripple', snare: 'camera-flash', high: 'window-twinkle' },
      particles: { kind: 'twinkle', colors: ['#ffcf33', '#ffffff'], rate: 14 },
    },
  },
  {
    id: 'glitch', num: '13', name: 'Glitch Art', tagline: 'Data Bent',
    mood: 'Intentional corruption — crisp here, broken there.',
    palette: { bg: '#050505', surface: '#0b0b0d', primary: '#00ff9c', primaryInk: '#00ff9c', onPrimary: '#001a10', secondary: '#ff2bd6', accent: '#00e5ff', text: '#f2f2f2', muted: '#a8a8a8', border: 'rgba(0,255,156,0.55)' },
    fonts: { display: "'Major Mono Display', 'Courier New', monospace", body: "'JetBrains Mono', ui-monospace, 'Courier New', monospace", mono: "'VT323', ui-monospace, monospace" },
    panel: { radius: '0px', borderWidth: '1px', shadow: '3px 0 0 rgba(255,43,214,.55), -3px 0 0 rgba(0,229,255,.55)', alpha: 0.92 },
    background: { renderer: 'glitch', fps: 24 },
    hologram: {
      forms: ['pixel-sphere', 'broken-wire', 'rgb-torus', 'glitch-cube', 'data-ribbon', 'corrupt-wave', 'error-window', 'voxel-heart'],
      material: { colors: ['#00ff9c', '#ff2bd6', '#00e5ff', '#f2f2f2'], colorMode: 'depth', composite: 'lighter', lines: true, point: 'pixel', pointSize: 2.4, lineWidth: 1.1, pixel: true, rgb: 0.6 },
      motion: { rotate: 0.28, tilt: 0.3, morph: 1.2 },
      transition: 'pixel-sort',
      reactions: { kick: 'band-displace', snare: 'channel-split', high: 'pixel-noise' },
      particles: { kind: 'pixel', colors: ['#00ff9c', '#ff2bd6', '#00e5ff'], rate: 18 },
    },
    a11y: { glitchy: true },
  },
  {
    id: 'aero', num: '14', name: 'Frutiger Aero', tagline: 'Glossy Optimism',
    mood: 'Sky-blue glass, bubbles and fresh green — clean, bright tech.',
    palette: { bg: '#bfe6ff', surface: '#f4fbff', primary: '#0a6fc2', primaryInk: '#075c9f', onPrimary: '#ffffff', secondary: '#2fb35a', accent: '#00a3c4', text: '#0b2a4a', muted: '#38556f', border: 'rgba(10,111,194,0.35)' },
    fonts: { display: "'Varela Round', 'Segoe UI', 'Frutiger', 'Myriad Pro', system-ui, sans-serif", body: "'Nunito Sans', 'Segoe UI', 'Frutiger', system-ui, sans-serif", mono: "'DM Mono', ui-monospace, monospace" },
    panel: { radius: '18px', borderWidth: '1px', shadow: 'inset 0 1px 0 rgba(255,255,255,.95), 0 10px 30px rgba(10,80,140,.22)', alpha: 0.78 },
    background: { renderer: 'aero', fps: 30 },
    hologram: {
      forms: ['aqua-bubbles', 'water-droplet', 'glossy-orb', 'aero-leaf', 'aero-swoosh', 'aero-globe', 'aero-butterfly', 'aero-fish'],
      material: { colors: ['#0a6fc2', '#00a3c4', '#2fb35a', '#7fd8ff'], colorMode: 'height', composite: 'source-over', lines: true, point: 'none', lineWidth: 2, glow: 3.2, glowAlpha: 0.18, gloss: true, fill: 0.28, fillColors: ['#7fd8ff', '#9be37a', '#bfefff'] },
      motion: { rotate: 0.2, tilt: 0.22, sway: 0.1, morph: 1.6 },
      transition: 'bubble-float',
      reactions: { kick: 'bubble-pop', snare: 'gloss-sheen', high: 'bubble-sparkle' },
      particles: { kind: 'bubble', colors: ['#ffffff', '#bfefff', '#9be37a'], rate: 10 },
    },
  },
  {
    id: 'deepfield', num: '15', name: 'Deep Field', tagline: 'Pixel Cosmos', pack: 'deepfield',
    mood: 'A lone observatory drifting past pixel planets.',
    palette: { bg: '#0b0a1f', surface: '#1a1736', primary: '#ffb454', primaryInk: '#ffc27a', onPrimary: '#1a0d00', secondary: '#5fe1d6', accent: '#e05ca8', text: '#f1ecff', muted: '#b4acd9', border: 'rgba(95,225,214,0.6)' },
    fonts: { display: "'Silkscreen', 'VT323', monospace", body: "'Pixelify Sans', system-ui, sans-serif", mono: "'VT323', ui-monospace, monospace" },
    panel: { radius: '0px', borderWidth: '2px', shadow: '4px 4px 0 #000', alpha: 0.9 },
    background: { renderer: 'deepfield', fps: 24 },
    formIds: /^(ship|robot|df)-/,
    a11y: {},
  },
];

export const THEME_BY_ID = Object.fromEntries(THEMES.map(t => [t.id, t]));

export function getTheme(id) { return THEME_BY_ID[id] || THEMES[0]; }

export function neighbourTheme(id, dir = 1) {
  const i = THEMES.findIndex(t => t.id === id);
  return THEMES[(i + dir + THEMES.length) % THEMES.length];
}
