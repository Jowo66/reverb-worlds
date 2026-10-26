/**
 * midnight.js: world pack for 16 · Midnight Drive (PSX Lo-Fi). Loaded on demand
 * by world-packs.js, in the window and in backdrop-worker.js.
 *
 *   forms     20 forms traced from CC0 models (midnight-baked.js): GGBot's
 *             "PSX Style Cars", Quaternius cars and street props; + 3 procedural
 *   hologram  thin wireframe snapped to a coarse grid (the PS1 vertex wobble),
 *             fading into the fog with depth
 *   backdrop  a night road from a tiny software renderer on a ~320 px art
 *             canvas: whole-pixel vertices, Bayer-dithered gradients and 5-bit
 *             colour, upscaled without smoothing. The first full-motion visit
 *             of a session opens with a 2 s original "boot" intro.
 */
import { BAKED } from './midnight-baked.js';

const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- forms */
// Inverse of tools/bake_forms.py encode(): Int8 [count, x,y,z × count] per polyline.
function decode(b64) {
  const bin = atob(b64), q = i => { const b = bin.charCodeAt(i); return (b > 127 ? b - 256 : b) / 127 * 1.1; };
  const paths = [];
  for (let i = 0; i < bin.length;) {
    const n = bin.charCodeAt(i++), pts = [];
    for (let k = 0; k < n; k++, i += 3) pts.push([q(i), q(i + 1), q(i + 2)]);
    paths.push({ pts, closed: false });
  }
  return paths;
}

function ring(r, n = 72, y = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = i / n * TAU; pts.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
  return { pts, closed: true, nofill: true };
}

// Wireframe box centred on (cx, cy, cz): top and bottom loops plus the four uprights.
function box(w, h, d, cx = 0, cy = 0, cz = 0) {
  const x = w / 2, y = h / 2, z = d / 2, P = (sx, sy, sz) => [cx + sx * x, cy + sy * y, cz + sz * z];
  const loop = sy => ({ pts: [P(-1, sy, -1), P(1, sy, -1), P(1, sy, 1), P(-1, sy, 1), P(-1, sy, -1)], closed: false });
  return [loop(-1), loop(1), ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({ pts: [P(sx, -1, sz), P(sx, 1, sz)], closed: false }))];
}

function octahedron(r, spin = 0) {
  const v = [0, 1, 2, 3].map(k => [Math.cos(spin + k * TAU / 4) * r, 0, Math.sin(spin + k * TAU / 4) * r]), top = [0, r * 1.25, 0], bot = [0, -r * 1.25, 0];
  return [{ pts: [...v, v[0]], closed: false }, ...v.flatMap(p => [{ pts: [top, p, bot], closed: false }])];
}

const PROCEDURAL = {
  'psx-disc': { label: 'Game disc', build: () => [ring(1.0, 96), ring(0.82, 96), ring(0.58, 72), ring(0.2, 32), ring(0.12, 24)] },
  'psx-memory-card': {
    label: 'Memory card', upright: true,
    build: () => [...box(0.8, 1.1, 0.14), ...box(0.56, 0.42, 0.02, 0, 0.2, 0.08), ...box(0.5, 0.08, 0.1, 0, -0.62, 0)],
  },
  'psx-boot-diamond': { label: 'Boot diamond', build: () => [...octahedron(0.8), ...octahedron(0.45, Math.PI / 4)] },
};

export const forms = { ...PROCEDURAL };
for (const f of BAKED) {
  const paths = decode(f.data);
  forms[f.id] = { label: f.label, upright: f.upright, credit: f.credit, build: () => paths };
}

/* ------------------------------------------------- hologram settings */
// Installed into the registry entry by world-packs.js when the pack loads.
export const hologram = {
  forms: Object.keys(forms),
  material: { colors: ['#e8ecf5', '#a9e4e2', '#6fc7c9', '#3c7a86'], colorMode: 'depth', composite: 'source-over', lines: true, lineWidth: 1.2, point: 'none', pixel: true, glow: 0, glowAlpha: 0, halo: false },
  motion: { rotate: 0.3, tilt: 0.32, morph: 1.2 },
  transition: 'lowpoly-scan',
  reactions: { kick: 'headlight-flare', snare: 'poly-jitter' },
  particles: { kind: 'spark', colors: ['#ff9a3c', '#6fc7c9', '#e8ecf5'], rate: 6 },
};

/* -------------------------------------------------------------- backdrop */
const SCALE = 4, MAX_ART_W = 360;         // backdrop pixels per art pixel; big screens get chunkier pixels
const BOOT_LEN = 2, BOOT_KEY = 'rw-midnight-boot';
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - 0.5);
const q5 = v => Math.max(0, Math.min(255, Math.round(v / 8) * 8)); // 5 bits per channel
const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const css = c => `rgb(${q5(c[0])},${q5(c[1])},${q5(c[2])})`;
const SKY_TOP = rgb('#05060c'), SKY_LOW = rgb('#1c2747'), FOG = rgb('#6fc7c9'), GROUND = rgb('#06070b'), ROAD = rgb('#141824');
const RIDGE = rgb('#0b1020'), CITY = rgb('#0f1529'), LAMP = rgb('#ff9a3c'), POST = rgb('#2a3142'), DASH = rgb('#c9ccd4');
const ROAD_W = 3, CAM_H = 1.25, LAMP_GAP = 9, DASH_GAP = 4, DASH_LEN = 1.6, Z_FAR = 60;
let bootedThisPage = false;

function layer(w, h) {
  w = Math.max(1, w); h = Math.max(1, h);
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

// First full-motion visit this session? Marks it as seen when it says yes.
function firstBoot() {
  try {
    if (sessionStorage.getItem(BOOT_KEY)) return false;
    sessionStorage.setItem(BOOT_KEY, '1'); return true;
  } catch { return bootedThisPage ? false : (bootedThisPage = true); }
}

function put(d, i, c) { d[i] = q5(c[0]); d[i + 1] = q5(c[1]); d[i + 2] = q5(c[2]); d[i + 3] = 255; }

// Screen position of a point on the road plane (x across, z ahead) or above it (y up).
function proj(S, x, y, z) {
  const f = S.f / z;
  return [Math.round(S.pw / 2 + x * f), Math.round(S.hy + (CAM_H - y) * f)];
}

function quad(c, pts) {
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath(); c.fill();
}

// Fog: blend toward the fog colour with distance.
const fogged = (col, z) => css(mix(col, mix(SKY_LOW, FOG, 0.35), Math.min(1, Math.pow(z / Z_FAR, 1.4))));

function drawRoad(c, S, travel, kick) {
  const { pw: w, ph: h } = S, zNear = CAM_H * S.f / (h - S.hy);
  // lane dashes, far to near
  c.fillStyle = css(DASH);
  for (let z = DASH_GAP - (travel % DASH_GAP) + zNear * 0.5; z < Z_FAR; z += DASH_GAP) {
    const z2 = z + DASH_LEN;
    if (z2 < zNear * 0.6) continue;
    c.fillStyle = fogged(DASH, z);
    quad(c, [proj(S, -0.06, 0, Math.max(z, zNear * 0.6)), proj(S, 0.06, 0, Math.max(z, zNear * 0.6)), proj(S, 0.06, 0, z2), proj(S, -0.06, 0, z2)]);
  }
  // streetlights both sides: light pool on the road, post, arm, lamp head
  const first = LAMP_GAP - (travel % LAMP_GAP);
  for (let z = Z_FAR - ((Z_FAR - first) % LAMP_GAP); z >= zNear * 0.7; z -= LAMP_GAP) {
    for (const side of [-1, 1]) {
      const px = side * (ROAD_W + 0.9), lx = side * (ROAD_W - 0.3);
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = css(mix([0, 0, 0], LAMP, (0.16 + kick * 0.12) * (1 - z / Z_FAR)));
      const pool = [];
      for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; pool.push(proj(S, lx + Math.cos(a) * 1.7, 0, z + Math.sin(a) * 2.2)); }
      quad(c, pool);
      c.globalCompositeOperation = 'source-over';
      const base = proj(S, px, 0, z), top = proj(S, px, 3.4, z), arm = proj(S, lx, 3.4, z), wpx = Math.max(1, Math.round(S.f * 0.12 / z));
      c.fillStyle = fogged(POST, z);
      c.fillRect(Math.min(base[0], top[0]), top[1], wpx, Math.max(1, base[1] - top[1]));
      c.fillRect(Math.min(top[0], arm[0]), top[1], Math.abs(arm[0] - top[0]) + 1, Math.max(1, Math.round(wpx * 0.6)));
      c.fillStyle = fogged(mix(LAMP, [255, 236, 200], 0.3 + kick * 0.4), z * 0.6);
      c.fillRect(arm[0] - wpx, arm[1], wpx * 2 + 1, Math.max(1, wpx));
    }
  }
}

// Original boot intro: shards swirl in and settle into a spinning flat-shaded diamond, a soft brighten, then the road.
function drawBoot(c, S, bt) {
  const { pw: w, ph: h } = S, cx = w / 2, cy = h * 0.46, R = Math.min(w, h) * 0.2;
  c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
  const settle = Math.min(1, bt / 1.2), ease = 1 - Math.pow(1 - settle, 3), spin = bt * 2.4;
  // swirling shards converging on the centre
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * TAU + bt * (2.2 - ease * 1.6), d = R * (2.6 - ease * 2.6) + 2, s = R * 0.22 * (1 - ease * 0.6);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.6;
    c.fillStyle = css(mix(FOG, LAMP, k / 8));
    c.globalAlpha = 1 - ease * 0.85;
    quad(c, [[Math.round(x), Math.round(y - s)], [Math.round(x + s), Math.round(y + s * 0.6)], [Math.round(x - s), Math.round(y + s * 0.6)]]);
  }
  c.globalAlpha = 1;
  // diamond: 8 flat-shaded faces, light from the upper left
  const v = [0, 1, 2, 3].map(k => { const a = spin + k * TAU / 4; return [Math.cos(a), Math.sin(a)]; });
  const s = R * (0.4 + ease * 0.6), faces = [];
  for (let k = 0; k < 4; k++) {
    const a = v[k], b = v[(k + 1) % 4], depth = (a[1] + b[1]) / 2, lit = 0.5 + 0.5 * Math.cos(spin + (k + 0.5) * TAU / 4 + 2.4);
    for (const up of [1, -1]) faces.push({ depth, lit: up > 0 ? lit : lit * 0.55, pts: [[cx, cy - up * s * 1.25], [cx + a[0] * s, cy + a[1] * s * 0.35], [cx + b[0] * s, cy + b[1] * s * 0.35]] });
  }
  faces.sort((p, q) => p.depth - q.depth);
  for (const f of faces) {
    c.fillStyle = css(mix(mix(SKY_LOW, FOG, 0.6), LAMP, f.lit * 0.8));
    quad(c, f.pts.map(([x, y]) => [Math.round(x), Math.round(y)]));
  }
  // soft brighten on the way out (never a hard flash)
  if (bt > 1.5) { c.fillStyle = '#ffffff'; c.globalAlpha = Math.min(0.35, Math.sin((bt - 1.5) / (BOOT_LEN - 1.5) * Math.PI) * 0.35); c.fillRect(0, 0, w, h); c.globalAlpha = 1; }
}

export const backdrop = {
  init(S) {
    const s = Math.max(SCALE, S.w / MAX_ART_W), w = Math.max(64, Math.round(S.w / s)), h = Math.max(48, Math.round(S.h / s));
    const hy = Math.round(h * 0.47), rng = S.rng;
    Object.assign(S, { pw: w, ph: h, hy, f: h * 0.9 });
    const L = layer(w, h), g = L.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    // ridge and skyline heights per column
    const ridge = new Float32Array(w), city = new Float32Array(w);
    const ph1 = rng() * 9, ph2 = rng() * 9;
    for (let x = 0; x < w; x++) ridge[x] = hy - h * (0.05 + 0.035 * Math.sin(x / w * 7 + ph1) + 0.02 * Math.sin(x / w * 19 + ph2));
    for (let x = Math.round(w * 0.3); x < w * 0.7;) {
      const bw = 2 + Math.floor(rng() * 6), bh = h * (0.03 + rng() * 0.11) * (1 - Math.abs(x / w - 0.5) * 2.2);
      for (let k = 0; k < bw && x + k < w; k++) city[x + k] = hy - Math.max(1, bh);
      x += bw + (rng() < 0.3 ? 1 : 0);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dith = BAYER[(y & 3) * 4 + (x & 3)];
      let c;
      if (y < hy) {
        const t = Math.max(0, Math.min(1, y / hy + dith * 0.12));
        c = mix(SKY_TOP, SKY_LOW, t * t);
        const fog = Math.max(0, 1 - (hy - y) / (h * 0.1)) * 0.45 + dith * 0.08;
        if (fog > 0) c = mix(c, FOG, Math.min(0.5, fog));
        if (city[x] && y >= city[x]) c = mix(CITY, FOG, Math.max(0, 0.18 - (hy - y) / h));
        else if (y >= ridge[x]) c = mix(RIDGE, FOG, 0.12 + Math.max(0, 0.2 - (hy - y) / h));
      } else {
        // ground, with the road as a trapezoid from the vanishing point
        const t = (y - hy) / (h - hy), half = ROAD_W * (S.f / (CAM_H * S.f / Math.max(1, y - hy)));
        const onRoad = Math.abs(x - w / 2) < half, edge = Math.abs(Math.abs(x - w / 2) - half) < 1 && y > hy + 2;
        c = onRoad ? ROAD : GROUND;
        if (edge) c = mix(DASH, ROAD, 0.55);
        const fog = Math.max(0, 1 - t * 4 + dith * 0.3) * 0.5;
        if (fog > 0) c = mix(c, FOG, Math.min(0.45, fog));
      }
      put(d, (y * w + x) * 4, c);
    }
    g.putImageData(img, 0, 0);
    // lit windows in the skyline
    g.fillStyle = css(mix(LAMP, [255, 230, 170], 0.4));
    for (let x = 0; x < w; x++) if (city[x] && rng() < 0.35) { g.globalAlpha = 0.4 + rng() * 0.5; g.fillRect(x, Math.round(city[x] + 1 + rng() * (hy - city[x] - 2)), 1, 1); }
    g.globalAlpha = 1;
    S.base = L;
    S.travel = 0;
  },

  draw(ctx, S, t, dt, r) {
    if (!S.work) { S.work = layer(S.pw, S.ph); S.wctx = S.work.getContext('2d'); }
    const c = S.wctx, kick = r?.kick || 0;
    if (S.boot === undefined && S.animate) S.boot = firstBoot() ? 0 : -1;
    if (S.boot >= 0) {
      S.boot += dt;
      if (S.boot < BOOT_LEN) drawBoot(c, S, S.boot);
      else S.boot = -1;
    }
    if (!(S.boot >= 0)) {
      if (S.animate) S.travel += dt * (14 + (r?.energy || 0) * 16 + (r?.bass || 0) * 6);
      c.drawImage(S.base, 0, 0);
      drawRoad(c, S, S.animate ? S.travel : 3, S.animate ? kick : 0);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(S.work, 0, 0, S.w, S.h);
  },
};
