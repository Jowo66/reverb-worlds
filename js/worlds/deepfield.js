/**
 * deepfield.js: world pack for 15 · Deep Field (pixel cosmos). Loaded on demand
 * by world-packs.js, in the window and in backdrop-worker.js.
 *
 *   forms     29 forms traced from 3D models (deepfield-baked.js): 20 CC0
 *             Quaternius, 9 Max Parata voxel robots (CC BY-ND 4.0), + 4 procedural
 *   backdrop  pixel planets ported from Deep-Fold's MIT "Pixel Planets" and
 *             "Space Background" shaders: tiled fbm noise, spherified planets,
 *             banded light and dithering. The noise is sampled into tables in
 *             init(); draw() only looks values up. Rendered at 1/4 scale and
 *             upscaled without smoothing.
 *
 * The planet and nebula maths is ported from Deep-Fold's shaders, used under the MIT licence:
 *   Pixel Planets: Copyright (c) 2020 Deep-Fold
 *   Space Background: Copyright (c) 2021 Deep-Fold
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 */
import { BAKED } from './deepfield-baked.js';

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

function ring(r, { n = 72, tiltX = 0, tiltZ = 0, cx = 0, cy = 0, cz = 0, squash = 1 } = {}) {
  const pts = [], cX = Math.cos(tiltX), sX = Math.sin(tiltX), cZ = Math.cos(tiltZ), sZ = Math.sin(tiltZ);
  for (let i = 0; i <= n; i++) {
    const a = i / n * TAU;
    let x = Math.cos(a) * r, y = 0, z = Math.sin(a) * r * squash;
    [y, z] = [y * cX - z * sX, y * sX + z * cX];
    [x, y] = [x * cZ - y * sZ, x * sZ + y * cZ];
    pts.push([x + cx, y + cy, z + cz]);
  }
  return { pts, closed: true, nofill: true };
}

function fibDots(n, r) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, rr = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
    pts.push([Math.cos(a) * rr * r, y * r, Math.sin(a) * rr * r]);
  }
  return { pts, dots: true };
}

const PROCEDURAL = {
  'df-ringed-planet': { label: 'Ringed planet', build: () => [fibDots(260, 0.55), ring(0.85, { tiltX: 0.35 }), ring(0.97, { tiltX: 0.35 }), ring(1.09, { tiltX: 0.35 })] },
  'df-blackhole': {
    label: 'Black hole',
    build: () => [ring(0.16, { n: 36 }), ...[0.3, 0.46, 0.62, 0.78, 0.94, 1.1].map((r, k) => ring(r, { n: 96, tiltX: 1.25 + k * 0.02, squash: 1 - k * 0.04 }))],
  },
  'df-galaxy': {
    label: 'Spiral galaxy',
    build: rng => {
      const pts = [];
      for (let i = 0; i < 420; i++) {
        const arm = i % 2, t = (i >> 1) / 210, a = t * TAU * 1.6 + arm * Math.PI, r = 0.12 + t * 1.0;
        pts.push([Math.cos(a) * r + (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.06, Math.sin(a) * r + (rng() - 0.5) * 0.08]);
      }
      return [{ pts, dots: true }, ring(0.1, { n: 24 })];
    },
  },
  'df-orbits': {
    label: 'Orbits',
    build: () => [ring(0.12, { n: 24 }), ...[[0.45, 0.2, 0], [0.7, -0.5, 0.3], [0.92, 0.9, -0.2], [1.1, 1.3, 0.5]].flatMap(([r, tx, tz], k) => {
      const a = k * 1.7, mx = Math.cos(a) * r, mz = Math.sin(a) * r;
      const y = -mz * Math.sin(tx), z = mz * Math.cos(tx);
      return [ring(r, { n: 96, tiltX: tx, tiltZ: tz }), ring(0.06, { n: 16, cx: mx * Math.cos(tz) - y * Math.sin(tz), cy: mx * Math.sin(tz) + y * Math.cos(tz), cz: z })];
    })],
  },
};

export const forms = { ...PROCEDURAL };
for (const f of BAKED) {
  const paths = decode(f.data);
  forms[f.id] = { label: f.label, upright: f.upright, credit: f.credit, build: () => paths };
}

/* ------------------------------------------------- hologram settings */
// Installed into the registry entry by world-packs.js when the pack loads.
export const hologram = {
  forms: ['ship-omen', 'ship-zenith', 'ship-striker', 'ship-spitfire', 'ship-dispatcher', 'ship-executioner', 'ship-bob', 'ship-challenger', 'ship-imperial', 'ship-insurgent', 'ship-pancake',
    'robot-george', 'robot-leela', 'robot-mike', 'robot-stan', 'robot-robot', 'robot-mech-barbara', 'robot-mech-fernando', 'robot-mech-finn', 'robot-mech-rae',
    'robot-voxel-arachnodroid', 'robot-voxel-companion-bot', 'robot-voxel-field-fighter', 'robot-voxel-mecha-golem', 'robot-voxel-mecha-01', 'robot-voxel-mecha-trooper', 'robot-voxel-mobile-storage-bot', 'robot-voxel-quadruped-tank', 'robot-voxel-recon-bot',
    'df-ringed-planet', 'df-blackhole', 'df-galaxy', 'df-orbits'],
  material: { colors: ['#f1ecff', '#5fe1d6', '#2f8f9e', '#e05ca8'], colorMode: 'depth', composite: 'source-over', lines: false, point: 'pixel-grid', grid: 3, pointSize: 1, glow: 0, glowAlpha: 0, halo: false },
  motion: { rotate: 0.22, tilt: 0.45, morph: 1.6 },
  transition: 'pixel-dissolve',
  reactions: { kick: 'pixel-shockwave', snare: 'scanline-flash', high: 'star-sparks' },
  particles: { kind: 'spark', colors: ['#ffb454', '#5fe1d6', '#f1ecff'], rate: 10 },
};

/* -------------------------------------------------------------- backdrop */
const SCALE = 4, MAX_ART_W = 480; // backdrop pixels per art pixel; big screens get chunkier pixels, not more of them
const NEB = ['#0b0a1f', '#141235', '#22194a', '#3a2466', '#6b2f7a', '#e05ca8'];
const OCEAN = ['#3b6fb6', '#26477e', '#172a52', '#0f1634'];
const LAND = ['#7cc35a', '#3f8a52', '#2d5a55', '#22303f'];
const GAS = ['#ffd08a', '#ffb454', '#d9774a', '#8a3f5c', '#3b2149'];
const STAR = '#ffe9c2', CLOUD_LIT = '#f1ecff', CLOUD_DARK = '#3a2466';
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - 0.5);
const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const [NEB_RGB, OCEAN_RGB, LAND_RGB, GAS_RGB] = [NEB, OCEAN, LAND, GAS].map(p => p.map(rgb));
const CLOUD_RGB = [rgb(CLOUD_LIT), rgb(CLOUD_DARK)];

function layer(w, h) {
  w = Math.max(1, w); h = Math.max(1, h);
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

// Deep-Fold's rand/noise/fbm; rand tiles every (tx, ty) cells so planets wrap seamlessly.
function makeFbm(seed, tx = 0, ty = 0) {
  const rand = (x, y) => {
    if (tx) { x = ((x % tx) + tx) % tx; y = ((y % ty) + ty) % ty; }
    const s = Math.sin(x * 12.9898 + y * 78.233) * 15.5453 * seed; return s - Math.floor(s);
  };
  const noise = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const a = rand(ix, iy), b = rand(ix + 1, iy), c = rand(ix, iy + 1), d = rand(ix + 1, iy + 1);
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * ux + (c - a) * uy * (1 - ux) + (d - b) * ux * uy;
  };
  return (x, y, oct) => { let v = 0, s = 0.5; for (let i = 0; i < oct; i++) { v += noise(x, y) * s; x *= 2; y *= 2; s *= 0.5; } return v; };
}

// fbm over one tile (2·size × size), 8 samples per unit; plain data so it survives postMessage.
function table(seed, size, oct) {
  const tw = size * 16, th = size * 8, f = makeFbm(seed, size * 2, size), t = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) t[y * tw + x] = f(x / 8, y / 8, oct);
  return { t, tw, th };
}
function look(T, x, y) {
  let ix = Math.floor(x * 8) % T.tw, iy = Math.floor(y * 8) % T.th;
  if (ix < 0) ix += T.tw; if (iy < 0) iy += T.th;
  return T.t[iy * T.tw + ix];
}

function spherify(u, v) {
  const cx = u * 2 - 1, cy = v * 2 - 1, z = Math.sqrt(Math.max(0, 1 - cx * cx - cy * cy));
  return [cx / (z + 1) * 0.5 + 0.5, cy / (z + 1) * 0.5 + 0.5];
}
function rot(u, v, a) { u -= 0.5; v -= 0.5; const c = Math.cos(a), s = Math.sin(a); return [u * c - v * s + 0.5, u * s + v * c + 0.5]; }

function put(d, i, c) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }

// Port of PlanetUnder + PlanetLandmass + Clouds (light from the upper left).
function drawTerran(d, D, S, time) {
  const size = 8;
  for (let py = 0; py < D; py++) for (let px = 0; px < D; px++) {
    let u = px / D, v = py / D;
    if (Math.hypot(u - 0.5, v - 0.5) > 0.4999) continue;
    const dl = Math.hypot(u - 0.39, v - 0.39), dith = ((px + py) & 1) === 0;
    [u, v] = spherify(...rot(u, v, 0.2));
    const bx = u * size + time * 0.35, by = v * size, ol = dl + (dith ? 0.02 : 0);
    let c = OCEAN_RGB[ol < 0.32 ? 0 : ol < 0.48 ? 1 : ol < 0.62 ? 2 : 3];
    const f1 = look(S.land, bx, by);
    if (f1 > 0.56) {
      const f2 = look(S.land, bx - 0.39 * f1, by - 0.39 * f1), f3 = look(S.land, bx - 0.585 * f1, by - 0.585 * f1), f4 = look(S.land, bx - 0.78 * f1, by - 0.78 * f1), d2 = dl * dl * 0.4;
      c = LAND_RGB[3];
      if (f4 + d2 < f1 * 1.5) c = LAND_RGB[2];
      if (f3 + d2 < f1) c = LAND_RGB[1];
      if (f2 + d2 < f1 * 0.9 && !(dith && dl > 0.5)) c = LAND_RGB[0];
    }
    if (look(S.cloud, u * 6 + time * 0.6, v * 13.2) > 0.7 + (v - 0.5) * (v - 0.5) * 0.4) c = CLOUD_RGB[dl < 0.45 ? 0 : 1];
    put(d, (py * D + px) * 4, c);
  }
}

// Port of GasPlanetLayers: noise-warped bands, stepped by distance from the light.
function drawGas(d, D, S, time) {
  for (let py = 0; py < D; py++) for (let px = 0; px < D; px++) {
    let u = px / D, v = py / D;
    if (Math.hypot(u - 0.5, v - 0.5) > 0.4999) continue;
    const dl = Math.hypot(u - 0.3, v - 0.32), dith = ((px + py) & 1) === 0;
    [u, v] = spherify(...rot(u, v, -0.35));
    const band = Math.sin(v * 22 + look(S.gas, u * 9 + time * 0.25, v * 3) * 6) * 0.5 + 0.5;
    let k = (band < 0.3 ? 2 : band < 0.6 ? 1 : 0) + (dl > 0.5 ? 2 : dl > 0.36 ? 1 : 0);
    if (dith && dl > 0.42) k++;
    put(d, (py * D + px) * 4, GAS_RGB[Math.min(4, k)]);
  }
}

function planet(wc, P, fn, S, time) {
  const img = wc.getImageData(P.x - P.r, P.y - P.r, P.r * 2, P.r * 2);
  fn(img.data, P.r * 2, S, time);
  // keep the background where the disc isn't (getImageData copied it in)
  wc.putImageData(img, P.x - P.r, P.y - P.r);
}

function gasRing(wc, P, front) {
  for (let a = 0; a < TAU; a += 0.6 / P.r) {
    const s = Math.sin(a);
    if ((s > 0) !== front) continue;
    for (const [k, col] of [[1.45, GAS[3]], [1.6, GAS[1]], [1.75, GAS[3]]]) {
      wc.fillStyle = col;
      wc.fillRect(Math.round(P.x + Math.cos(a) * P.r * k), Math.round(P.y + s * P.r * k * 0.28), 1, 1);
    }
  }
}

export const backdrop = {
  init(S) {
    const s = Math.max(SCALE, S.w / MAX_ART_W), w = Math.max(48, Math.round(S.w / s)), h = Math.max(48, Math.round(S.h / s));
    S.pw = w; S.ph = h;
    const neb = layer(w, h), g = neb.getContext('2d'), img = g.createImageData(w, h), fbm = makeFbm(3.7), rng = S.rng;
    const k = 120 / Math.max(w, h) * 4; // keep the nebula's scale independent of screen size
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x * k / 30, v = y * k / 30;
      let n = fbm(u + fbm(u * 0.7, v * 0.7, 3) * 1.6, v, 5);
      n = Math.pow(Math.max(0, n - 0.18) * 1.55, 1.6) + BAYER[(y & 3) * 4 + (x & 3)] * 0.09;
      put(img.data, (y * w + x) * 4, NEB_RGB[Math.max(0, Math.min(5, Math.floor(n * 6)))]);
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = STAR;
    for (let i = 0, n = Math.round(w * h / 140); i < n; i++) { g.globalAlpha = 0.35 + rng() * 0.65; g.fillRect((rng() * w) | 0, (rng() * h) | 0, 1, 1); }
    if (S.dpr >= 0.6) { // spiral galaxy; dropped on low quality and in thumbnails
      g.fillStyle = NEB[5];
      const gx = w * 0.62, gy = h * 0.18;
      for (let i = 0; i < 380; i++) {
        const t = rng() * 7, a = t + (i & 1) * Math.PI + (rng() - 0.5) * 0.5, rr = t * 3.2;
        g.globalAlpha = 0.25 + (1 - t / 7) * 0.6;
        g.fillRect((gx + Math.cos(a) * rr * 1.6) | 0, (gy + Math.sin(a) * rr * 0.6) | 0, 1, 1);
      }
    }
    g.globalAlpha = 1;
    S.nebula = neb;
    S.twinkles = Array.from({ length: 16 }, () => ({ x: (rng() * w) | 0, y: (rng() * h) | 0, p: rng() * 6 }));
    S.rocks = Array.from({ length: 5 }, () => ({ x: rng() * w, y: h * (0.55 + rng() * 0.4), v: 0.6 + rng() * 1.4, s: 1 + ((rng() * 2) | 0) }));
    // Inside the stage area (the side panels cover the screen corners on desktop).
    const m = Math.min(w, h), r1 = Math.max(10, Math.round(0.16 * m)), r2 = Math.max(5, Math.round(0.065 * m));
    S.terran = { r: r1, x: Math.max(r1 + 1, Math.round(w * 0.31)), y: Math.min(h - r1 - 1, Math.round(h * 0.64)) };
    S.giant = { r: r2, x: Math.min(w - r2 * 2 - 1, Math.round(w * 0.67)), y: Math.max(r2 + 1, Math.round(h * 0.27)) };
    S.land = table(1.75, 8, 5);
    S.cloud = table(5.9, 6, 4);
    S.gas = table(2.3, 9, 4);
  },

  draw(ctx, S, t, dt, r) {
    if (!S.work) { S.work = layer(S.pw, S.ph); S.wctx = S.work.getContext('2d', { willReadFrequently: true }); }
    const wc = S.wctx, time = S.animate ? t : 3;
    wc.drawImage(S.nebula, 0, 0);
    gasRing(wc, S.giant, false);
    planet(wc, S.terran, drawTerran, S, time);
    planet(wc, S.giant, drawGas, S, time);
    gasRing(wc, S.giant, true);
    if (S.animate) {
      const extra = Math.round((r?.kick || 0) * 10);
      wc.fillStyle = STAR;
      S.twinkles.forEach((s, i) => {
        if (Math.sin(t * 2 + s.p * 3) < 0.7 && i >= extra) return;
        wc.fillRect(s.x - 1, s.y, 3, 1); wc.fillRect(s.x, s.y - 1, 1, 3);
      });
      wc.fillStyle = NEB[3];
      for (const a of S.rocks) wc.fillRect(Math.round(((a.x + t * a.v) % (S.pw + 4)) - 2), Math.round(a.y), a.s, a.s);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(S.work, 0, 0, S.w, S.h);
  },
};
