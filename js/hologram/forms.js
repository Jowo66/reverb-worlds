/**
 * forms.js — procedural form library for the hologram engine.
 *
 * Every form is built from "paths" (polylines in a unit-ish 3D space, y up)
 * and then resampled to exactly N points so any two forms can be morphed
 * point-for-point. Paths flagged `dots` are point clouds (no connecting
 * lines); closed paths can be filled by flat-print materials unless they
 * carry `nofill`.
 *
 * Forms with `flat: true` are emblems/silhouettes: the engine limits their
 * rotation to a gentle sway so they keep reading as 2D artwork.
 */

const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) / 2;

/* Seeded RNG                                                          */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Path helpers                                                        */
const P = (pts, opts = {}) => ({ pts, closed: false, ...opts });

function circle(r, n = 64, { cx = 0, cy = 0, cz = 0, plane = 'xy', a0 = 0, a1 = TAU, wobble = 0, rng = null, closed = true, ...rest } = {}) {
  const pts = [];
  const full = Math.abs(a1 - a0 - TAU) < 1e-6;
  const count = full ? n : n + 1;
  const phase = rng ? rng() * TAU : 0;
  for (let i = 0; i < count; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    const rr = r * (1 + (wobble ? wobble * (Math.sin(a * 3 + phase) * 0.5 + Math.sin(a * 7 + phase * 2) * 0.3 + (rng ? (rng() - 0.5) * 0.4 : 0)) : 0));
    const c = Math.cos(a) * rr, s = Math.sin(a) * rr;
    if (plane === 'xy') pts.push([cx + c, cy + s, cz]);
    else if (plane === 'xz') pts.push([cx + c, cy, cz + s]);
    else pts.push([cx, cy + c, cz + s]);
  }
  return { pts, closed: full && closed, ...rest };
}

/** 2D polygon from [[x,y],...] */
function poly2(arr, { s = 1, dx = 0, dy = 0, z = 0, closed = true, flipX = false, ...rest } = {}) {
  return { pts: arr.map(([x, y]) => [(flipX ? -x : x) * s + dx, y * s + dy, z]), closed, ...rest };
}

/** Catmull-Rom smoothing for hand-authored silhouettes. */
function smooth(path, segs = 4) {
  const p = path.pts, n = p.length;
  if (n < 3) return path;
  const out = [];
  const get = i => path.closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))];
  const last = path.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let s = 0; s < segs; s++) {
      const t = s / segs, t2 = t * t, t3 = t2 * t;
      const f = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1), f(2)]);
    }
  }
  if (!path.closed) out.push(p[n - 1]);
  return { ...path, pts: out };
}

function edgesByMinDist(verts, tol = 1.02) {
  let min = Infinity;
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) {
    const d = dist(verts[i], verts[j]); if (d > 1e-6 && d < min) min = d;
  }
  const paths = [];
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) {
    if (dist(verts[i], verts[j]) <= min * tol) paths.push(P([verts[i], verts[j]]));
  }
  return paths;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const norm = (v, r = 1) => { const l = Math.hypot(...v) || 1; return v.map(c => c / l * r); };

function icosaVerts(r) {
  const v = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    v.push([0, a, b * PHI], [a, b * PHI, 0], [b * PHI, 0, a]);
  }
  return v.map(p => norm(p, r));
}
function octaVerts(r) { return [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]]; }
function cuboctaVerts(r) {
  const v = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) v.push([a, b, 0], [a, 0, b], [0, a, b]);
  return v.map(p => norm(p, r));
}
function dodecaVerts(r) {
  const v = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) v.push([a, b, c]);
  const ip = 1 / PHI;
  for (const a of [-1, 1]) for (const b of [-1, 1]) v.push([0, a * ip, b * PHI], [a * ip, b * PHI, 0], [a * PHI, 0, b * ip]);
  return v.map(p => norm(p, r));
}

function box(cx, cy, cz, sx, sy, sz, { bottom = true } = {}) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  const out = [
    P([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [x0, y1, z0]]), // top loop
    P([[x0, y0, z0], [x0, y1, z0]]), P([[x1, y0, z0], [x1, y1, z0]]),
    P([[x1, y0, z1], [x1, y1, z1]]), P([[x0, y0, z1], [x0, y1, z1]]),
  ];
  if (bottom) out.push(P([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y0, z0]]));
  return out;
}

function transform(paths, fn) { return paths.map(p => ({ ...p, pts: p.pts.map(fn) })); }
function rotY(paths, a) { const c = Math.cos(a), s = Math.sin(a); return transform(paths, ([x, y, z]) => [x * c + z * s, y, -x * s + z * c]); }
function rotX(paths, a) { const c = Math.cos(a), s = Math.sin(a); return transform(paths, ([x, y, z]) => [x, y * c - z * s, y * s + z * c]); }
function rotZ(paths, a) { const c = Math.cos(a), s = Math.sin(a); return transform(paths, ([x, y, z]) => [x * c - y * s, x * s + y * c, z]); }
function move(paths, dx, dy, dz = 0) { return transform(paths, ([x, y, z]) => [x + dx, y + dy, z + dz]); }
function scale(paths, s) { return transform(paths, ([x, y, z]) => [x * s, y * s, z * s]); }
function jitter(paths, amt, rng) { return transform(paths, ([x, y, z]) => [x + (rng() - 0.5) * amt, y + (rng() - 0.5) * amt, z]); }

function torus(R, r, nu, nv, segs = 40) {
  const paths = [];
  for (let i = 0; i < nu; i++) {
    const u = (i / nu) * TAU, pts = [];
    for (let k = 0; k < segs / 2; k++) {
      const v = (k / (segs / 2)) * TAU;
      pts.push([(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)]);
    }
    paths.push({ pts, closed: true, nofill: true });
  }
  for (let j = 0; j < nv; j++) {
    const v = (j / nv) * TAU, pts = [];
    for (let k = 0; k < segs * 2; k++) {
      const u = (k / (segs * 2)) * TAU;
      pts.push([(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)]);
    }
    paths.push({ pts, closed: true, nofill: true });
  }
  return paths;
}

function sphereLL(r, nLat, nLon, segs = 48) {
  const paths = [];
  for (let i = 1; i <= nLat; i++) {
    const phi = -Math.PI / 2 + (i / (nLat + 1)) * Math.PI;
    paths.push(circle(r * Math.cos(phi), segs, { plane: 'xz', cy: r * Math.sin(phi), nofill: true }));
  }
  for (let j = 0; j < nLon; j++) {
    const th = (j / nLon) * Math.PI;
    const pts = [];
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * TAU;
      pts.push([r * Math.cos(a) * Math.cos(th), r * Math.sin(a), r * Math.cos(a) * Math.sin(th)]);
    }
    paths.push({ pts, closed: false, nofill: true });
  }
  return paths;
}

function fibSphere(n, r, { flatten = 1 } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2, rad = Math.sqrt(1 - y * y), th = i * Math.PI * (3 - Math.sqrt(5));
    pts.push([Math.cos(th) * rad * r, y * r, Math.sin(th) * rad * r * flatten]);
  }
  return { pts, dots: true };
}

function star(n, rOuter, rInner, rot = -Math.PI / 2, opts = {}) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? rInner : rOuter, a = rot + (i / (n * 2)) * TAU;
    pts.push([Math.cos(a) * r, Math.sin(a) * r, 0]);
  }
  return { pts, closed: true, ...opts };
}

function bipyramid(len, w, dir) {
  // elongated 4-sided bipyramid along +y, then oriented to `dir`
  const v = [[0, len, 0], [0, -len * 0.25, 0], [w, len * 0.35, 0], [-w, len * 0.35, 0], [0, len * 0.35, w], [0, len * 0.35, -w]];
  const e = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [4, 3], [3, 5], [5, 2]];
  let paths = e.map(([a, b]) => P([v[a], v[b]]));
  paths = rotX(paths, dir[0]);
  paths = rotZ(paths, dir[1]);
  return rotY(paths, dir[2]);
}

/* Hand-authored silhouettes (coarse, smoothed at build time).         */
/* Original drawings — not copied from any artwork.                    */
const SIL = {
  bison: [[-0.95, 0.02], [-0.9, 0.2], [-0.76, 0.36], [-0.6, 0.56], [-0.34, 0.64], [-0.05, 0.46], [0.35, 0.4], [0.7, 0.35], [0.86, 0.2], [0.9, 0.0], [0.97, -0.18], [0.84, -0.06], [0.8, -0.2], [0.76, -0.62], [0.62, -0.62], [0.6, -0.26], [0.3, -0.2], [0.0, -0.26], [-0.25, -0.3], [-0.29, -0.66], [-0.43, -0.66], [-0.46, -0.3], [-0.6, -0.26], [-0.76, -0.18], [-0.86, -0.06]],
  hand: [[-0.3, -0.95], [-0.36, -0.4], [-0.62, -0.18], [-0.8, 0.02], [-0.7, 0.12], [-0.42, -0.04], [-0.4, 0.3], [-0.44, 0.84], [-0.3, 0.9], [-0.22, 0.32], [-0.17, 0.94], [-0.04, 0.98], [0.02, 0.32], [0.09, 0.86], [0.21, 0.86], [0.22, 0.26], [0.31, 0.64], [0.43, 0.6], [0.4, 0.04], [0.36, -0.4], [0.3, -0.95]],
  deer: [[-0.5, 0.05], [-0.1, 0.12], [0.3, 0.1], [0.42, 0.3], [0.5, 0.42], [0.58, 0.38], [0.48, 0.2], [0.45, 0.05], [0.4, -0.3], [0.34, -0.3], [0.32, -0.05], [-0.3, -0.05], [-0.36, -0.3], [-0.42, -0.3], [-0.45, -0.02], [-0.58, 0.08]],
  pigeon: [[-0.82, 0.1], [-0.4, 0.15], [-0.1, 0.36], [0.25, 0.46], [0.45, 0.62], [0.6, 0.68], [0.72, 0.6], [0.9, 0.55], [0.7, 0.5], [0.62, 0.35], [0.55, 0.1], [0.35, -0.15], [0.12, -0.26], [0.08, -0.62], [0.0, -0.62], [-0.04, -0.3], [-0.35, -0.15], [-0.82, -0.04]],
  bust: [[-0.45, -0.95], [0.45, -0.95], [0.36, -0.8], [0.25, -0.74], [0.68, -0.6], [0.78, -0.45], [0.55, -0.34], [0.3, -0.3], [0.24, -0.1], [0.38, 0.0], [0.42, 0.08], [0.45, 0.13], [0.43, 0.2], [0.54, 0.27], [0.43, 0.42], [0.45, 0.5], [0.38, 0.7], [0.1, 0.86], [-0.25, 0.76], [-0.36, 0.46], [-0.26, 0.16], [-0.2, -0.1], [-0.64, -0.44], [-0.7, -0.6], [-0.35, -0.8]],
  head: [[0.2, -0.95], [0.22, -0.55], [0.05, -0.4], [-0.25, -0.32], [-0.32, -0.2], [-0.3, -0.1], [-0.38, -0.02], [-0.33, 0.06], [-0.46, 0.18], [-0.36, 0.28], [-0.38, 0.45], [-0.3, 0.68], [-0.05, 0.86], [0.3, 0.84], [0.55, 0.6], [0.62, 0.25], [0.55, -0.1], [0.45, -0.4], [0.5, -0.95]],
  crane: [[-0.15, 0.0], [-0.42, 0.32], [-0.95, 0.5], [-0.6, 0.16], [-0.25, -0.06], [0.1, -0.02], [0.42, 0.14], [0.72, 0.2], [0.95, 0.17], [0.7, 0.14], [0.4, 0.04], [0.18, -0.1], [-0.05, -0.12], [0.25, 0.3], [0.6, 0.7], [0.1, 0.32]],
};

function silhouette(key, { s = 1, flipX = false, closed = true, segs = 4, z = 0, dx = 0, dy = 0, ...rest } = {}) {
  return smooth(poly2(SIL[key], { s, flipX, closed, z, dx, dy, ...rest }), segs);
}

/* Form definitions                                                    */
// Each build(rng, N) returns an array of paths.
export const FORMS = {
  /* Cyberpunk */
  'neon-torus': { label: 'Neon torus', build: () => torus(0.66, 0.26, 18, 3) },
  'poly-core': { label: 'Polygonal core', build: () => [...edgesByMinDist(icosaVerts(0.92)), ...rotY(edgesByMinDist(icosaVerts(0.42)), 0.6)] },
  'frag-cube': { label: 'Fragmented cube', build: rng => fragmentCube(rng, 0.62) },
  'scan-ring': {
    label: 'Scanning rings', build: () => {
      const out = [];
      for (let i = 0; i < 5; i++) { const y = -0.6 + i * 0.3; out.push(circle(Math.sqrt(1 - y * y) * 0.9, 56, { plane: 'xz', cy: y, nofill: true })); }
      out.push(circle(0.98, 72, { nofill: true }));
      out.push(...rotX([circle(1.06, 72, { nofill: true })], 1.2));
      return out;
    },
  },
  'crystal-shards': {
    label: 'Crystal shards', build: rng => {
      const out = [];
      for (let i = 0; i < 7; i++) out.push(...bipyramid(0.45 + rng() * 0.45, 0.09 + rng() * 0.06, [rng() * TAU, rng() * TAU, rng() * TAU]));
      return out;
    },
  },
  'radar-sphere': {
    label: 'Radar sphere', build: () => {
      const out = sphereLL(0.85, 5, 8);
      for (let i = 0; i < 6; i++) { const a = i * 0.12; out.push(P([[0, 0, 0], [Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0]])); }
      return out;
    },
  },

  /* Art Deco */
  'faceted-crystal': {
    label: 'Faceted crystal', build: () => {
      const top = [0, 1.0, 0], bot = [0, -1.0, 0], r1 = [], r2 = [];
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; r1.push([Math.cos(a) * 0.55, 0.18, Math.sin(a) * 0.55]); const b = a + TAU / 12; r2.push([Math.cos(b) * 0.42, -0.28, Math.sin(b) * 0.42]); }
      const out = [];
      for (let i = 0; i < 6; i++) {
        out.push(P([top, r1[i]]), P([r1[i], r1[(i + 1) % 6]]), P([r1[i], r2[i]]), P([r2[i], r1[(i + 1) % 6]]), P([r2[i], r2[(i + 1) % 6]]), P([r2[i], bot]));
      }
      return out;
    },
  },
  'stepped-pyramid': {
    label: 'Stepped pyramid', build: () => {
      const out = [];
      for (let i = 0; i < 5; i++) { const s = 1.4 - i * 0.26; out.push(...box(0, -0.75 + i * 0.3 + 0.14, 0, s, 0.28, s, { bottom: i === 0 })); }
      return out;
    },
  },
  'sun-disc': {
    label: 'Sun disc', flat: true, build: () => {
      const out = [circle(0.42, 64), circle(0.5, 64, { nofill: true })];
      for (let i = 0; i < 24; i++) { const a = i / 24 * TAU, r2 = i % 2 ? 0.78 : 0.97; out.push(P([[Math.cos(a) * 0.58, Math.sin(a) * 0.58, 0], [Math.cos(a) * r2, Math.sin(a) * r2, 0]])); }
      return out;
    },
  },
  'concentric-fan': {
    label: 'Concentric fan', flat: true, build: () => {
      const out = [];
      for (const r of [0.32, 0.54, 0.76, 0.98]) out.push(circle(r, 48, { cy: -0.45, a0: 0, a1: Math.PI, closed: false }));
      for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI; out.push(P([[Math.cos(a) * 0.32, -0.45 + Math.sin(a) * 0.32, 0], [Math.cos(a) * 0.98, -0.45 + Math.sin(a) * 0.98, 0]])); }
      out.push(P([[-1, -0.45, 0], [1, -0.45, 0]]));
      return out;
    },
  },
  'gold-polyhedron': { label: 'Gold polyhedron', build: () => [...edgesByMinDist(cuboctaVerts(0.82)), ...edgesByMinDist(octaVerts(0.38))] },
  'radial-wire': {
    label: 'Radial wireframe', build: () => {
      const out = sphereLL(0.86, 0, 12);
      out.push(circle(0.86, 64, { plane: 'xz', nofill: true }));
      return out;
    },
  },

  /* Cave Drawings */
  'sun-disc-rough': {
    label: 'Ochre sun', flat: true, build: rng => {
      const out = [circle(0.38, 40, { wobble: 0.06, rng })];
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * TAU + (rng() - 0.5) * 0.12, pts = [];
        for (let k = 0; k < 5; k++) { const r = 0.5 + k * 0.1; pts.push([Math.cos(a + Math.sin(k * 1.7) * 0.05) * r, Math.sin(a + Math.sin(k * 1.7) * 0.05) * r, 0]); }
        out.push(P(pts));
      }
      return out;
    },
  },
  'bison': {
    label: 'Bison figure', flat: true, build: rng => [
      silhouette('bison', { s: 0.95 }),
      smooth(P([[-0.74, 0.3, 0], [-0.68, 0.44, 0], [-0.8, 0.5, 0]]), 3),
      ...jitter([P([[-0.1, 0.1, 0], [0.2, 0.05, 0], [0.45, 0.12, 0]], { nofill: true })], 0.02, rng),
    ],
  },
  'hand-stencil': { label: 'Hand stencil', flat: true, build: () => [silhouette('hand', { s: 0.9, segs: 3 })] },
  'animal-migration': {
    label: 'Migrating herd', flat: true, build: () => {
      const out = [];
      for (let i = 0; i < 4; i++) out.push(silhouette('deer', { s: 0.42 + (i % 2) * 0.06, dx: -0.75 + i * 0.5, dy: 0.25 - Math.abs(i - 1.5) * 0.18 }));
      out.push(smooth(P([[-1, -0.35, 0], [-0.4, -0.25, 0], [0.3, -0.38, 0], [1, -0.28, 0]], { nofill: true }), 4));
      return out;
    },
  },
  'pigment-rings': {
    label: 'Pigment rings', flat: true, build: rng => {
      const out = [];
      for (let i = 0; i < 5; i++) out.push(circle(0.18 + i * 0.18, 44, { wobble: 0.05, rng, nofill: i > 0 }));
      return out;
    },
  },
  'charcoal-spiral': {
    label: 'Charcoal spiral', flat: true, build: rng => {
      const pts = [];
      for (let i = 0; i <= 220; i++) { const t = i / 220, a = t * 4.2 * TAU, r = 0.05 + t * 0.9; pts.push([Math.cos(a) * r + (rng() - 0.5) * 0.02, Math.sin(a) * r + (rng() - 0.5) * 0.02, 0]); }
      return [P(pts)];
    },
  },

  /* Mosaic */
  'tess-sphere': { label: 'Tessellated sphere', build: (rng, N) => [fibSphere(N, 0.88)] },
  'tile-torus': {
    label: 'Tile torus', build: (rng, N) => {
      const pts = [], nu = Math.round(Math.sqrt(N * 2.4)), nv = Math.ceil(N / nu);
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv && pts.length < N; j++) {
        const u = i / nu * TAU, v = j / nv * TAU;
        pts.push([(0.62 + 0.3 * Math.cos(v)) * Math.cos(u), (0.62 + 0.3 * Math.cos(v)) * Math.sin(u), 0.3 * Math.sin(v)]);
      }
      return [{ pts, dots: true }];
    },
  },
  'faceted-flower': {
    label: 'Faceted flower', build: () => {
      const out = [];
      [[0.95, 6, -0.2], [0.68, 6, 0], [0.42, 5, 0.18]].forEach(([R, k, z], li) => {
        const pts = [];
        for (let i = 0; i < 120; i++) { const a = i / 120 * TAU + li * 0.3, r = R * (0.55 + 0.45 * Math.abs(Math.cos(a * k / 2))); pts.push([Math.cos(a) * r, Math.sin(a) * r, z]); }
        out.push({ pts, closed: true });
      });
      out.push(circle(0.15, 24, { cz: 0.3 }));
      return out;
    },
  },
  'kaleidoscope': {
    label: 'Kaleidoscope', flat: true, build: rng => {
      const base = [];
      for (let i = 0; i < 7; i++) { const r = 0.15 + i * 0.13, a = rng() * (Math.PI / 8); base.push([Math.cos(a) * r, Math.sin(a) * r]); }
      const out = [];
      for (let k = 0; k < 8; k++) {
        const rot = k / 8 * TAU;
        for (const m of [1, -1]) out.push(P(base.map(([x, y]) => { const yy = y * m; return [x * Math.cos(rot) - yy * Math.sin(rot), x * Math.sin(rot) + yy * Math.cos(rot), 0]; })));
      }
      out.push(circle(0.98, 64, { nofill: true }));
      return out;
    },
  },
  'frag-poly': { label: 'Fragmented polyhedron', build: () => edgesByMinDist(dodecaVerts(0.9)) },
  'tile-wave': {
    label: 'Tile waveform', build: (rng, N) => {
      const n = Math.floor(Math.sqrt(N)), pts = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = -1 + 2 * i / (n - 1), z = -1 + 2 * j / (n - 1);
        pts.push([x * 0.95, 0.28 * Math.sin(x * 3.2 + z * 2) * Math.cos(z * 1.5), z * 0.95]);
      }
      return [{ pts, dots: true }];
    },
  },

  /* Japanese Scroll */
  'wave-crest': {
    label: 'Wave crest', flat: true, build: () => {
      const body = smooth(poly2([[-1, -0.72], [-0.92, -0.22], [-0.62, 0.24], [-0.26, 0.58], [0.08, 0.76], [0.38, 0.72], [0.56, 0.56], [0.52, 0.38], [0.4, 0.32], [0.3, 0.42], [0.2, 0.4], [0.05, 0.24], [-0.04, 0.0], [0.1, -0.34], [0.5, -0.56], [1, -0.72]]), 4);
      const out = [body];
      for (let i = 0; i < 6; i++) {
        const t = i / 5, cx = -0.15 + t * 0.6, cy = 0.62 + Math.sin(t * Math.PI) * 0.1;
        out.push(circle(0.07, 10, { cx, cy: cy + 0.04, a0: Math.PI * 0.1, a1: Math.PI * 1.3, closed: false }));
      }
      for (let b = 0; b < 3; b++) {
        const pts = [];
        for (let i = 0; i <= 40; i++) { const x = -1 + i / 20; pts.push([x, -0.8 - b * 0.07 + Math.sin(x * 6 + b) * 0.03, 0]); }
        out.push(P(pts));
      }
      return out;
    },
  },
  'paper-fan': {
    label: 'Paper fan', flat: true, build: () => {
      const cy = -0.62, a0 = Math.PI * 0.12, a1 = Math.PI * 0.88, outer = [], inner = [];
      for (let i = 0; i <= 40; i++) { const a = a0 + (a1 - a0) * i / 40; outer.push([Math.cos(a) * 1.0, cy + Math.sin(a) * 1.0, 0]); }
      for (let i = 40; i >= 0; i--) { const a = a0 + (a1 - a0) * i / 40; inner.push([Math.cos(a) * 0.38, cy + Math.sin(a) * 0.38, 0]); }
      const out = [{ pts: [...outer, ...inner], closed: true }];
      for (let i = 0; i <= 10; i++) { const a = a0 + (a1 - a0) * i / 10; out.push(P([[0, cy, 0], [Math.cos(a) * 1.0, cy + Math.sin(a) * 1.0, 0]])); }
      const wave = [];
      for (let i = 0; i <= 30; i++) { const a = a0 + (a1 - a0) * i / 30, r = 0.72 + Math.sin(i * 0.9) * 0.05; wave.push([Math.cos(a) * r, cy + Math.sin(a) * r, 0]); }
      out.push(P(wave));
      return out;
    },
  },
  'moon-disc': {
    label: 'Moon & clouds', flat: true, build: () => {
      const out = [circle(0.55, 60, { cy: 0.15 })];
      const cloud = (cx, cy, w) => {
        const pts = [];
        for (let i = 0; i <= 16; i++) { const x = cx - w + (2 * w * i) / 16; pts.push([x, cy + 0.06 + Math.abs(Math.sin(i * 0.8)) * 0.07, 0]); }
        for (let i = 16; i >= 0; i--) { const x = cx - w + (2 * w * i) / 16; pts.push([x, cy - 0.06, 0]); }
        return { pts, closed: true };
      };
      out.push(cloud(-0.3, -0.2, 0.55), cloud(0.35, -0.42, 0.5), cloud(-0.1, -0.62, 0.6));
      return out;
    },
  },
  'crane': {
    label: 'Crane in flight', flat: true, build: () => [
      silhouette('crane', { s: 0.95, closed: true, segs: 3 }),
      P([[-0.12, -0.08, 0], [-0.55, -0.3, 0], [-0.85, -0.38, 0]], { nofill: true }),
      circle(0.04, 10, { cx: 0.82, cy: 0.2 }),
    ],
  },
  'ink-circle': {
    label: 'Ink circle', flat: true, build: rng => {
      const out = [];
      for (let k = 0; k < 3; k++) out.push(circle(0.8 - k * 0.025, 80, { a0: 0.35 + k * 0.05, a1: TAU - 0.15 - k * 0.1, closed: false, wobble: 0.015, rng }));
      return out;
    },
  },
  'flowing-ribbon': {
    label: 'Flowing ribbon', flat: true, build: () => {
      const top = [], bot = [];
      for (let i = 0; i <= 60; i++) { const x = -1 + i / 30, y = Math.sin(x * 2.6) * 0.38, w = 0.08 + 0.1 * Math.abs(Math.cos(x * 1.4)); top.push([x, y + w, 0]); bot.unshift([x, y - w, 0]); }
      const out = [{ pts: [...top, ...bot], closed: true }];
      for (const o of [-0.25, 0.3]) { const pts = []; for (let i = 0; i <= 40; i++) { const x = -1 + i / 20; pts.push([x, Math.sin(x * 2.6 + 0.6) * 0.38 + o, 0]); } out.push(P(pts)); }
      return out;
    },
  },
  'abstract-crest': {
    label: 'Abstract crest', flat: true, build: () => {
      const out = [circle(0.86, 64), circle(0.74, 64, { nofill: true })];
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; out.push(circle(0.2, 28, { cx: Math.cos(a) * 0.42, cy: Math.sin(a) * 0.42 })); }
      out.push(circle(0.12, 20));
      return out;
    },
  },

  /* Baroque */
  'bust': {
    label: 'Sculptural bust', flat: true, build: () => [
      silhouette('bust', { s: 0.95, z: 0.06 }),
      silhouette('bust', { s: 0.93, z: -0.06, nofill: true }),
      ...[0, 1, 2].map(i => circle(0.07, 14, { cx: -0.05 + i * 0.12, cy: 0.66 - i * 0.04, a0: 0, a1: Math.PI * 1.4, closed: false })),
    ],
  },
  'gilded-orb': {
    label: 'Gilded orb', build: () => {
      const out = sphereLL(0.72, 4, 6);
      out.push(circle(0.74, 64, { plane: 'xz', cy: 0.04, nofill: true }), circle(0.74, 64, { plane: 'xz', cy: -0.04, nofill: true }));
      out.push(P([[0, 0.72, 0], [0, 1.02, 0]]), P([[-0.12, 0.9, 0], [0.12, 0.9, 0]]));
      return out;
    },
  },
  'drapery': {
    label: 'Twisting drapery', build: () => {
      const out = [];
      for (let i = 0; i < 6; i++) {
        const pts = [];
        for (let k = 0; k <= 60; k++) { const t = -1 + k / 30; pts.push([t * 0.95, 0.34 * Math.sin(2.2 * t + i * 0.28) + (i - 2.5) * 0.11, 0.38 * Math.cos(1.7 * t + i * 0.4)]); }
        out.push(P(pts));
      }
      return out;
    },
  },
  'medallion': {
    label: 'Ornate medallion', flat: true, build: () => {
      const out = [circle(0.92, 72, { nofill: true }), circle(0.78, 64)];
      const sc = []; for (let i = 0; i < 96; i++) { const a = i / 96 * TAU, r = 0.85 + 0.045 * Math.cos(a * 24); sc.push([Math.cos(a) * r, Math.sin(a) * r, 0]); }
      out.push({ pts: sc, closed: true, nofill: true });
      out.push(star(8, 0.6, 0.3), circle(0.2, 32));
      return out;
    },
  },
  'rosette': {
    label: 'Baroque rosette', flat: true, build: () => {
      const out = [];
      [[0.9, 8, 0], [0.62, 8, Math.PI / 8], [0.38, 6, 0]].forEach(([R, k, ph]) => {
        const pts = []; for (let i = 0; i < 140; i++) { const a = i / 140 * TAU, r = R * (0.62 + 0.38 * Math.abs(Math.cos((a + ph) * k / 2))); pts.push([Math.cos(a) * r, Math.sin(a) * r, 0]); }
        out.push({ pts, closed: true });
      });
      out.push(circle(0.12, 20));
      return out;
    },
  },
  'carved-poly': { label: 'Carved polyhedron', build: () => [...edgesByMinDist(dodecaVerts(0.82)), ...edgesByMinDist(icosaVerts(0.4))] },

  /* Street Art */
  'spray-ring': {
    label: 'Spray-painted ring', flat: true, build: rng => {
      const out = [];
      for (let i = 0; i < 5; i++) out.push(circle(0.62 + i * 0.035, 56, { wobble: 0.03, rng, nofill: true }));
      out.push(P([[0.5, -0.55, 0], [0.52, -0.9, 0]]), P([[-0.3, -0.62, 0], [-0.31, -0.82, 0]]));
      return out;
    },
  },
  'stencil-bird': {
    label: 'Stencil bird', flat: true, build: () => [
      silhouette('pigeon', { s: 0.95, segs: 3 }),
      P([[-0.33, 0.14, 0], [0.0, 0.0, 0], [0.3, 0.2, 0]], { nofill: true }),
    ],
  },
  'drip-mark': {
    label: 'Dripping mark', flat: true, build: rng => {
      const out = [poly2([[0, 0.85], [0.7, 0.05], [0, -0.4], [-0.7, 0.05]])];
      for (let i = 0; i < 5; i++) { const x = -0.45 + i * 0.22, y0 = -0.4 + (0.45 - Math.abs(x)) * 0.6 - 0.22, len = 0.25 + rng() * 0.45; out.push(P([[x, y0, 0], [x, y0 - len, 0]])); out.push(circle(0.03, 8, { cx: x, cy: y0 - len - 0.02 })); }
      return out;
    },
  },
  'sticker-star': { label: 'Sticker star', flat: true, build: () => [star(5, 0.86, 0.38), { ...star(5, 0.98, 0.46), nofill: true }] },
  'halftone-sphere': { label: 'Halftone sphere', build: (rng, N) => [fibSphere(N, 0.86)] },
  'abstract-glyph': {
    label: 'Abstract glyph', flat: true, build: rng => {
      const out = [];
      for (let s = 0; s < 4; s++) {
        const pts = []; let x = -0.85 + s * 0.45, y = (rng() - 0.5) * 0.6;
        for (let k = 0; k < 6; k++) { pts.push([x, y, 0]); x += 0.06 + rng() * 0.1; y = Math.max(-0.7, Math.min(0.7, y + (rng() - 0.5) * 0.9)); }
        out.push(smooth(P(pts, { nofill: true }), 5));
      }
      out.push(P([[-0.9, -0.75, 0], [0.8, -0.65, 0], [0.68, -0.55, 0]]));
      return out;
    },
  },

  /* Vaporwave */
  'chrome-torus': { label: 'Chrome torus', build: () => torus(0.64, 0.3, 20, 4) },
  'wire-pyramid': {
    label: 'Wireframe pyramid', build: () => {
      const a = [-0.8, -0.65, -0.8], b = [0.8, -0.65, -0.8], c = [0.8, -0.65, 0.8], d = [-0.8, -0.65, 0.8], t = [0, 0.95, 0];
      const out = [P([a, b, c, d, a]), P([a, t]), P([b, t]), P([c, t]), P([d, t])];
      for (let i = 1; i < 4; i++) { const k = i / 4, y = -0.65 + 1.6 * k, s = 0.8 * (1 - k); out.push(P([[-s, y, -s], [s, y, -s], [s, y, s], [-s, y, s], [-s, y, -s]])); }
      return out;
    },
  },
  'classic-bust': { label: 'Classical bust', flat: true, build: () => [silhouette('bust', { s: 0.95 }), ...[0, 1, 2, 3].map(i => P([[-0.9, -0.2 - i * 0.2, 0], [0.9, -0.2 - i * 0.2, 0]], { nofill: true }))] },
  'sunset-disc': {
    label: 'Sunset disc', flat: true, build: () => {
      const out = [circle(0.82, 72)];
      for (let i = 0; i < 7; i++) { const y = -0.1 - i * 0.1, w = Math.sqrt(Math.max(0, 0.82 * 0.82 - y * y)); out.push(P([[-w, y, 0], [w, y, 0]])); }
      return out;
    },
  },
  'palm-frond': {
    label: 'Low-poly palm', flat: true, build: () => {
      const out = [smooth(P([[0.15, -0.95, 0], [0.12, -0.4, 0], [0.0, 0.1, 0], [-0.05, 0.38, 0]]), 4)];
      const top = [-0.05, 0.38];
      for (let f = 0; f < 7; f++) {
        const a = Math.PI * (0.05 + f * 0.15), pts = [];
        for (let k = 0; k <= 8; k++) { const t = k / 8, r = t * 0.75; pts.push([top[0] + Math.cos(a) * r, top[1] + Math.sin(a) * r * 0.7 - t * t * 0.45, 0]); }
        out.push(P(pts, { nofill: true }));
        for (let k = 2; k <= 7; k += 1) { const [x, y] = pts[k]; out.push(P([[x, y, 0], [x + Math.cos(a + 1.2) * 0.08, y - 0.1, 0]])); }
      }
      return out;
    },
  },
  'marble-fragment': {
    label: 'Marble fragment', build: rng => {
      const v = []; for (let i = 0; i < 11; i++) v.push(norm([rng() - 0.5, rng() - 0.5, rng() - 0.5], 0.5 + rng() * 0.4));
      const out = [], seen = new Set();
      v.forEach((p, i) => {
        v.map((q, j) => [j, dist(p, q)]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 3).forEach(([j]) => {
          const key = i < j ? `${i}-${j}` : `${j}-${i}`; if (!seen.has(key)) { seen.add(key); out.push(P([p, v[j]])); }
        });
      });
      return out;
    },
  },

  /* Brutalist */
  'monolith': {
    label: 'Concrete monolith', build: () => {
      const out = box(0, 0, 0, 0.6, 1.8, 0.38);
      for (let i = 1; i < 6; i++) { const y = -0.9 + i * 0.3; out.push(P([[-0.3, y, 0.19], [0.3, y, 0.19]])); }
      return out;
    },
  },
  'stacked-blocks': {
    label: 'Stacked blocks', build: () => {
      const out = [];
      [[-0.15, -0.7, 1.1], [0.2, -0.32, 0.9], [-0.1, 0.06, 1.0], [0.15, 0.44, 0.7]].forEach(([x, y, w]) => out.push(...box(x, y, 0, w, 0.34, 0.6)));
      return out;
    },
  },
  'industrial-ring': {
    label: 'Industrial ring', build: () => {
      const out = [];
      for (const r of [0.62, 0.86]) for (const z of [-0.12, 0.12]) out.push(circle(r, 48, { cz: z, nofill: true }));
      for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, c = Math.cos(a), s = Math.sin(a); out.push(P([[c * 0.62, s * 0.62, 0.12], [c * 0.86, s * 0.86, 0.12], [c * 0.86, s * 0.86, -0.12], [c * 0.62, s * 0.62, -0.12], [c * 0.62, s * 0.62, 0.12]])); }
      return out;
    },
  },
  'beam-structure': {
    label: 'Beam structure', build: () => {
      const out = [...box(0, 0.55, 0, 1.8, 0.12, 0.2), ...box(0, -0.55, 0, 1.8, 0.12, 0.2)];
      for (let i = 0; i <= 6; i++) { const x = -0.9 + i * 0.3; out.push(P([[x, -0.49, 0], [x, 0.49, 0]])); if (i < 6) out.push(P([[x, -0.49, 0], [x + 0.3, 0.49, 0]])); }
      return out;
    },
  },
  'brutal-arch': {
    label: 'Brutalist arch', build: () => {
      const out = [];
      for (const z of [-0.2, 0.2]) {
        const pts = [[-0.9, -0.9, z], [-0.9, 0.8, z], [0.9, 0.8, z], [0.9, -0.9, z], [0.45, -0.9, z]];
        for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI; pts.push([Math.cos(a) * 0.45, -0.2 + Math.sin(a) * 0.45, z]); }
        pts.push([-0.45, -0.9, z], [-0.9, -0.9, z]);
        out.push(P(pts));
      }
      for (const [x, y] of [[-0.9, -0.9], [-0.9, 0.8], [0.9, 0.8], [0.9, -0.9], [0.45, -0.9], [-0.45, -0.9]]) out.push(P([[x, y, -0.2], [x, y, 0.2]]));
      return out;
    },
  },
  'shifting-cuboid': {
    label: 'Shifting cuboid', build: () => [...box(0, 0, 0, 1.3, 1.0, 1.0), ...rotY(box(0, 0, 0, 0.8, 1.4, 0.6), 0.5), ...rotY(box(0, 0, 0, 0.4, 0.4, 1.5), -0.3)],
  },

  /* Stained Glass */
  'rose-window': {
    label: 'Rose window', flat: true, build: () => {
      const out = [circle(0.96, 80, { nofill: true }), circle(0.28, 36)];
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU, w = TAU / 30, pts = [];
        for (let k = 0; k <= 10; k++) { const t = k / 10, r = 0.32 + t * 0.56, aa = a + Math.sin(t * Math.PI) * w; pts.push([Math.cos(aa) * r, Math.sin(aa) * r, 0]); }
        for (let k = 10; k >= 0; k--) { const t = k / 10, r = 0.32 + t * 0.56, aa = a - Math.sin(t * Math.PI) * w; pts.push([Math.cos(aa) * r, Math.sin(aa) * r, 0]); }
        out.push({ pts, closed: true });
      }
      return out;
    },
  },
  'glass-sphere': { label: 'Leaded-glass sphere', build: () => sphereLL(0.86, 5, 8) },
  'radial-medallion': {
    label: 'Radial medallion', flat: true, build: () => {
      const out = [];
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, b = a + TAU / 16, c = a - TAU / 16; out.push({ pts: [[Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0], [Math.cos(b) * 0.62, Math.sin(b) * 0.62, 0], [Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0], [Math.cos(c) * 0.62, Math.sin(c) * 0.62, 0]], closed: true }); }
      const oct = []; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + TAU / 16; oct.push([Math.cos(a) * 0.26, Math.sin(a) * 0.26, 0]); }
      out.push({ pts: oct, closed: true });
      return out;
    },
  },
  'jewel-polyhedron': { label: 'Jewel polyhedron', build: () => [...edgesByMinDist(octaVerts(0.95)), ...edgesByMinDist(icosaVerts(0.55))] },
  'glass-flower': {
    label: 'Luminous flower', flat: true, build: () => {
      const out = [];
      const petal = (a, len, w) => { const pts = []; for (let k = 0; k <= 12; k++) { const t = k / 12, r = 0.2 + t * len, aa = a + Math.sin(t * Math.PI) * w; pts.push([Math.cos(aa) * r, Math.sin(aa) * r, 0]); } for (let k = 12; k >= 0; k--) { const t = k / 12, r = 0.2 + t * len, aa = a - Math.sin(t * Math.PI) * w; pts.push([Math.cos(aa) * r, Math.sin(aa) * r, 0]); } return { pts, closed: true }; };
      for (let i = 0; i < 6; i++) { out.push(petal(i / 6 * TAU, 0.75, 0.35)); out.push(petal(i / 6 * TAU + TAU / 12, 0.42, 0.18)); }
      out.push(circle(0.18, 28));
      return out;
    },
  },
  'geometric-halo': {
    label: 'Geometric halo', flat: true, build: () => {
      const out = [circle(0.95, 72, { nofill: true }), circle(0.82, 72, { nofill: true })];
      const st = []; for (let i = 0; i <= 12; i++) { const a = (i * 5 / 12) * TAU; st.push([Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0]); }
      out.push(P(st, { nofill: true }));
      const hex = []; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; hex.push([Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0]); }
      out.push({ pts: hex, closed: true });
      return out;
    },
  },

  /* Double Exposure */
  'human-silhouette': {
    label: 'Silhouette & forest', flat: true, build: rng => {
      const out = [silhouette('head', { s: 0.95, nofill: true })];
      for (let i = 0; i < 6; i++) {
        const x = -0.15 + i * 0.1 + (rng() - 0.5) * 0.04, h = 0.25 + rng() * 0.3, y0 = -0.55;
        out.push(P([[x - 0.06, y0, 0], [x, y0 + h, 0], [x + 0.06, y0, 0]], { nofill: true }));
      }
      for (let k = 0; k < 3; k++) { const pts = []; for (let i = 0; i <= 20; i++) { const x = -0.3 + i * 0.04; pts.push([x, 0.15 + k * 0.15 + Math.sin(i * 0.6 + k) * 0.03, 0]); } out.push(P(pts)); }
      return out;
    },
  },
  'tree-ring-sphere': {
    label: 'Tree-ring sphere', build: rng => {
      const out = [];
      for (let k = 0; k < 9; k++) { const z = -0.8 + k * 0.2; out.push(circle(Math.sqrt(1 - z * z) * 0.86, 48, { cz: z, wobble: 0.04, rng, nofill: true })); }
      return out;
    },
  },
  'forest-profile': {
    label: 'Forest in profile', flat: true, build: rng => {
      const out = [], ridge = [];
      for (let i = 0; i <= 24; i++) { const x = -1 + i / 12; ridge.push([x, -0.35 + Math.sin(x * 2.3) * 0.15 + (rng() - 0.5) * 0.05, 0]); }
      out.push(P(ridge));
      for (let i = 0; i < 9; i++) { const x = -0.85 + i * 0.21, base = -0.35 + Math.sin(x * 2.3) * 0.15, h = 0.25 + rng() * 0.35; out.push(P([[x - 0.08, base, 0], [x, base + h, 0], [x + 0.08, base, 0]], { nofill: true })); }
      out.push(circle(0.2, 28, { cx: 0.45, cy: 0.55, nofill: true }));
      return out;
    },
  },
  'layered-moon': { label: 'Layered moon', build: () => [-0.3, -0.1, 0.1, 0.3].map((x, i) => circle(0.52, 56, { cx: x, cz: (i - 1.5) * 0.12, nofill: true })) },
  'mist-ribbon': {
    label: 'Mist ribbon', build: () => {
      const out = [];
      for (let k = 0; k < 6; k++) { const pts = []; for (let i = 0; i <= 50; i++) { const x = -1 + i / 25; pts.push([x, Math.sin(x * 2 + k * 0.5) * 0.25 + (k - 2.5) * 0.12, Math.cos(x * 1.5 + k) * 0.3]); } out.push(P(pts)); }
      return out;
    },
  },
  'contour-loops': {
    label: 'Contour loops', flat: true, build: rng => {
      const out = [];
      for (let i = 0; i < 7; i++) out.push(circle(0.14 + i * 0.12, 48, { cx: 0.05 * Math.sin(i), cy: 0.04 * i - 0.12, wobble: 0.08, rng, nofill: true }));
      return out;
    },
  },

  /* Tilt Shift */
  'mini-skyline': {
    label: 'Miniature skyline', build: rng => {
      const out = [P([[-1, -0.6, -0.5], [1, -0.6, -0.5], [1, -0.6, 0.5], [-1, -0.6, 0.5], [-1, -0.6, -0.5]])];
      for (let i = 0; i < 9; i++) { const x = -0.85 + i * 0.21, h = 0.3 + rng() * 0.9, z = (rng() - 0.5) * 0.5; out.push(...box(x, -0.6 + h / 2, z, 0.16, h, 0.16, { bottom: false })); }
      return out;
    },
  },
  'ferris-wheel': {
    label: 'Model Ferris wheel', build: () => {
      const out = [circle(0.68, 64, { cy: 0.15, cz: 0.07, nofill: true }), circle(0.68, 64, { cy: 0.15, cz: -0.07, nofill: true })];
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU, x = Math.cos(a) * 0.68, y = 0.15 + Math.sin(a) * 0.68; out.push(P([[0, 0.15, 0], [x, y, 0]])); out.push(P([[x - 0.05, y - 0.02, 0], [x + 0.05, y - 0.02, 0], [x + 0.05, y - 0.1, 0], [x - 0.05, y - 0.1, 0], [x - 0.05, y - 0.02, 0]])); }
      out.push(P([[-0.45, -0.9, 0], [0, 0.15, 0], [0.45, -0.9, 0]]), P([[-0.8, -0.9, 0], [0.8, -0.9, 0]]));
      return out;
    },
  },
  'city-block': {
    label: 'Rotating city block', build: rng => {
      const out = [P([[-0.9, -0.4, -0.9], [0.9, -0.4, -0.9], [0.9, -0.4, 0.9], [-0.9, -0.4, 0.9], [-0.9, -0.4, -0.9]])];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { if (i === 1 && j === 1) continue; const h = 0.15 + rng() * 0.55; out.push(...box(-0.6 + i * 0.6, -0.4 + h / 2, -0.6 + j * 0.6, 0.38, h, 0.38, { bottom: false })); }
      return out;
    },
  },
  'arch-cube': {
    label: 'Architectural cube', build: () => {
      const out = box(0, 0, 0, 1.1, 1.1, 1.1);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const x = -0.33 + i * 0.33, y = -0.33 + j * 0.33, s = 0.1; out.push(P([[x - s, y - s, 0.55], [x + s, y - s, 0.55], [x + s, y + s, 0.55], [x - s, y + s, 0.55], [x - s, y - s, 0.55]])); }
      return out;
    },
  },
  'train-loop': {
    label: 'Miniature train loop', build: () => {
      const ell = (a, b) => { const pts = []; for (let i = 0; i < 64; i++) { const t = i / 64 * TAU; pts.push([Math.cos(t) * a, -0.3, Math.sin(t) * b]); } return { pts, closed: true, nofill: true }; };
      const out = [ell(0.95, 0.55), ell(0.85, 0.45)];
      for (let i = 0; i < 5; i++) { const t = i * 0.32, x = Math.cos(t) * 0.9, z = Math.sin(t) * 0.5; out.push(...rotY(move(box(0, 0, 0, 0.16, 0.12, 0.1, { bottom: false }), 0, 0, 0), -t).map(p => ({ ...p, pts: p.pts.map(([px, py, pz]) => [px + x, py - 0.22, pz + z]) }))); }
      return out;
    },
  },
  'toy-planet': {
    label: 'Toy planet', build: () => {
      const out = sphereLL(0.6, 4, 6);
      const ring = []; for (let i = 0; i < 64; i++) { const t = i / 64 * TAU; ring.push([Math.cos(t) * 0.98, Math.sin(t) * 0.12, Math.sin(t) * 0.98 * 0.35]); }
      out.push({ pts: ring, closed: true, nofill: true });
      for (let i = 0; i < 3; i++) { const x = -0.18 + i * 0.18; out.push(...box(x, 0.66, 0, 0.1, 0.1, 0.1, { bottom: false }), P([[x - 0.06, 0.71, 0], [x, 0.8, 0], [x + 0.06, 0.71, 0]])); }
      return out;
    },
  },

  /* Glitch Art */
  'pixel-sphere': { label: 'Pixel-sorted sphere', build: (rng, N) => [fibSphere(N, 0.86)] },
  'broken-wire': {
    label: 'Broken wireframe', build: rng => {
      const out = [];
      for (const p of sphereLL(0.84, 5, 7, 40)) {
        const pts = p.pts; let cur = [];
        const shift = () => (rng() < 0.25 ? (rng() - 0.5) * 0.25 : 0);
        let dx = 0;
        pts.forEach((q, i) => { if (rng() < 0.08 && cur.length > 1) { out.push(P(cur)); cur = []; dx = shift(); } else cur.push([q[0] + dx, q[1], q[2]]); if (i === pts.length - 1 && cur.length > 1) out.push(P(cur)); });
      }
      return out;
    },
  },
  'rgb-torus': { label: 'RGB-shifted torus', build: () => torus(0.66, 0.24, 16, 3) },
  'glitch-cube': { label: 'Fragmented cube', build: rng => [...fragmentCube(rng, 0.6), ...move(fragmentCube(rng, 0.3), 0.15, 0, 0)] },
  'data-ribbon': {
    label: 'Data ribbon', build: () => {
      const out = [], e1 = [], e2 = [];
      for (let i = 0; i <= 28; i++) { const t = -1 + i / 14, w = 0.32, c = Math.cos(3 * t) * w, s = Math.sin(3 * t) * w; out.push(P([[t * 0.95, c, s], [t * 0.95, -c, -s]])); e1.push([t * 0.95, c, s]); e2.push([t * 0.95, -c, -s]); }
      out.push(P(e1), P(e2));
      return out;
    },
  },
  'corrupt-wave': {
    label: 'Corrupted waveform', build: rng => {
      const out = [];
      for (let k = 0; k < 6; k++) {
        let seg = [], off = 0;
        for (let i = 0; i <= 48; i++) {
          const x = -1 + i / 24;
          if (rng() < 0.08) { if (seg.length > 1) out.push(P(seg)); seg = []; off = (rng() - 0.5) * 0.3; }
          seg.push([x * 0.95, Math.sin(x * 5 + k) * 0.25 * Math.cos(x * 1.3) + off, (k - 2.5) * 0.14]);
        }
        if (seg.length > 1) out.push(P(seg));
      }
      return out;
    },
  },

  /* Added forms (2 per world + Frutiger Aero) */
  /* Cyberpunk */
  'neon-helix': {
    label: 'Neon double helix', build: () => {
      const out = [], a = [], b = [];
      for (let i = 0; i <= 120; i++) { const t = i / 120, y = -1 + 2 * t, ang = t * 4 * TAU; a.push([Math.cos(ang) * 0.45, y, Math.sin(ang) * 0.45]); b.push([Math.cos(ang + Math.PI) * 0.45, y, Math.sin(ang + Math.PI) * 0.45]); }
      out.push(P(a), P(b));
      for (let i = 0; i <= 120; i += 6) out.push(P([a[i], b[i]]));
      return out;
    },
  },
  'hex-tunnel': {
    label: 'Hex tunnel', build: () => {
      const out = [];
      for (let k = 0; k < 7; k++) { const z = -0.9 + k * 0.3, r = 0.35 + k * 0.08, pts = []; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + k * 0.12; pts.push([Math.cos(a) * r, Math.sin(a) * r, z]); } out.push({ pts, closed: true, nofill: true }); }
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; out.push(P([[Math.cos(a) * 0.35, Math.sin(a) * 0.35, -0.9], [Math.cos(a + 0.72) * 0.83, Math.sin(a + 0.72) * 0.83, 0.9]])); }
      return out;
    },
  },
  /* Art Deco */
  'deco-skyscraper': {
    label: 'Deco skyscraper', flat: true, build: () => {
      const half = [[0.42, -1], [0.42, -0.2], [0.32, -0.2], [0.32, 0.2], [0.22, 0.2], [0.22, 0.5], [0.12, 0.5], [0.12, 0.72], [0.04, 0.72], [0, 1]];
      const pts = [...half.map(([x, y]) => [x, y, 0]), ...half.slice(0, -1).reverse().map(([x, y]) => [-x, y, 0])];
      const out = [{ pts, closed: true }];
      for (let i = -2; i <= 2; i++) out.push(P([[i * 0.12, -0.95, 0], [i * 0.12, -0.25, 0]], { nofill: true }));
      for (let i = 0; i < 5; i++) { const a = Math.PI / 2 + (i - 2) * 0.35; out.push(P([[0, 0.72, 0], [Math.cos(a) * 0.35, 0.72 + Math.sin(a) * 0.35, 0]])); }
      return out;
    },
  },
  'chevron-burst': {
    label: 'Chevron burst', flat: true, build: () => {
      const out = [];
      for (let k = 0; k < 6; k++) { const s = 0.2 + k * 0.15; out.push(P([[-s, -0.3 - s * 0.6, 0], [0, -0.3 + s * 0.6, 0], [s, -0.3 - s * 0.6, 0]], { nofill: true })); }
      for (let i = 0; i < 9; i++) { const a = Math.PI * (0.15 + i * 0.0875); out.push(P([[Math.cos(a) * 0.55, 0.15 + Math.sin(a) * 0.55, 0], [Math.cos(a) * 0.95, 0.15 + Math.sin(a) * 0.95, 0]])); }
      return out;
    },
  },
  /* Cave */
  'spear-hunter': {
    label: 'Hunter with spear', flat: true, build: () => [
      circle(0.1, 16, { cx: -0.1, cy: 0.62 }),
      P([[-0.1, 0.5, 0], [-0.05, 0.05, 0], [-0.3, -0.6, 0]]), P([[-0.05, 0.05, 0], [0.18, -0.6, 0]]),
      P([[-0.08, 0.35, 0], [0.25, 0.42, 0]]), P([[-0.08, 0.35, 0], [-0.38, 0.15, 0]]),
      P([[-0.25, 0.25, 0], [0.85, 0.62, 0]]), P([[0.85, 0.62, 0], [0.74, 0.62, 0], [0.8, 0.53, 0], [0.85, 0.62, 0]], { nofill: true }),
    ],
  },
  'dot-constellation': {
    label: 'Pigment dots & zigzag', flat: true, build: rng => {
      const out = [];
      for (let r = 0; r < 3; r++) for (let i = 0; i < 7; i++) out.push(circle(0.045 + rng() * 0.015, 8, { cx: -0.6 + i * 0.2, cy: 0.45 - r * 0.22 }));
      const z = []; for (let i = 0; i <= 12; i++) z.push([-0.8 + i * 0.133, -0.45 + (i % 2) * 0.22, 0]);
      out.push(P(z));
      return out;
    },
  },
  /* Mosaic */
  'tile-star': {
    label: 'Tessellated star', build: (rng, N) => {
      const pts = [];
      for (let i = 0; i < N; i++) { const a = rng() * TAU, k = Math.abs(Math.cos(a * 4)), rmax = 0.45 + 0.5 * Math.pow(k, 3), r = Math.sqrt(rng()) * rmax; pts.push([Math.cos(a) * r, Math.sin(a) * r, (rng() - 0.5) * 0.12]); }
      return [{ pts, dots: true }];
    },
  },
  'tile-spiral': {
    label: 'Tile spiral', build: (rng, N) => {
      const pts = [];
      for (let i = 0; i < N; i++) { const t = i / N, a = t * 9 * TAU, r = 0.1 + t * 0.85; pts.push([Math.cos(a) * r, Math.sin(a) * r, (0.5 - t) * 0.8]); }
      return [{ pts, dots: true }];
    },
  },
  /* Japanese Scroll */
  'mount-peak': {
    label: 'Mountain & mist', flat: true, build: () => {
      const out = [poly2([[-1, -0.6], [-0.15, 0.7], [0.05, 0.66], [0.15, 0.72], [1, -0.6]])];
      out.push(poly2([[-0.15, 0.7], [-0.3, 0.48], [-0.18, 0.52], [-0.08, 0.44], [0.02, 0.52], [0.1, 0.46], [0.22, 0.54], [0.15, 0.72]], { nofill: false }));
      for (let b = 0; b < 3; b++) { const pts = []; for (let i = 0; i <= 30; i++) { const x = -1 + i / 15; pts.push([x, -0.15 - b * 0.18 + Math.sin(x * 4 + b) * 0.03, 0]); } out.push(P(pts)); }
      return out;
    },
  },
  'koi': {
    label: 'Koi', flat: true, build: () => {
      const body = smooth(poly2([[-0.85, 0.0], [-0.5, 0.22], [0.0, 0.3], [0.45, 0.2], [0.72, 0.05], [0.72, -0.05], [0.45, -0.2], [0.0, -0.3], [-0.5, -0.2]]), 4);
      return [body, poly2([[-0.82, 0], [-1, 0.32], [-0.92, 0], [-1, -0.32]]), poly2([[0.05, 0.28], [-0.1, 0.55], [-0.25, 0.25]]), circle(0.035, 8, { cx: 0.55, cy: 0.05 }), circle(0.12, 16, { cx: 0.1, cy: 0.02 }), circle(0.09, 14, { cx: -0.3, cy: -0.05 })];
    },
  },
  /* Baroque */
  'cherub-wing': {
    label: 'Feathered wing', flat: true, build: () => {
      const out = [smooth(poly2([[-0.7, -0.1], [-0.3, 0.45], [0.2, 0.75], [0.8, 0.8], [0.5, 0.45], [0.75, 0.3], [0.4, 0.1], [0.6, -0.1], [0.2, -0.25], [0.35, -0.5], [-0.2, -0.4]]), 4)];
      for (let i = 0; i < 6; i++) { const t = i / 5; out.push(P([[-0.55 + t * 0.2, -0.05 + t * 0.3, 0], [0.2 + t * 0.45, -0.35 + t * 1.0, 0]], { nofill: true })); }
      return out;
    },
  },
  'baroque-column': {
    label: 'Solomonic column', build: () => {
      const out = [];
      for (let s = 0; s < 4; s++) { const pts = []; for (let i = 0; i <= 90; i++) { const t = i / 90, y = -0.8 + 1.6 * t, a = t * 3 * TAU + s * TAU / 4; pts.push([Math.cos(a) * 0.22, y, Math.sin(a) * 0.22]); } out.push(P(pts)); }
      out.push(...box(0, -0.88, 0, 0.6, 0.16, 0.6), ...box(0, 0.88, 0, 0.6, 0.16, 0.6));
      return out;
    },
  },
  /* Street */
  'spray-can': {
    label: 'Spray can', flat: true, build: () => [
      poly2([[-0.28, -0.9], [0.28, -0.9], [0.28, 0.45], [0.18, 0.6], [-0.18, 0.6], [-0.28, 0.45]]),
      poly2([[-0.08, 0.6], [0.08, 0.6], [0.08, 0.75], [-0.08, 0.75]]),
      P([[-0.28, -0.1, 0], [0.28, -0.1, 0]], { nofill: true }), P([[-0.28, 0.2, 0], [0.28, 0.2, 0]], { nofill: true }),
      P([[0.12, 0.7, 0], [0.55, 0.85, 0]]), P([[0.12, 0.7, 0], [0.6, 0.65, 0]]), P([[0.12, 0.7, 0], [0.5, 0.48, 0]]),
    ],
  },
  'crown-tag': {
    label: 'Sticker crown', flat: true, build: () => [
      poly2([[-0.7, -0.4], [-0.75, 0.45], [-0.38, 0.1], [0, 0.6], [0.38, 0.1], [0.75, 0.45], [0.7, -0.4]]),
      P([[-0.7, -0.55, 0], [0.7, -0.55, 0]], { nofill: true }),
      circle(0.06, 10, { cx: -0.75, cy: 0.55 }), circle(0.06, 10, { cx: 0, cy: 0.7 }), circle(0.06, 10, { cx: 0.75, cy: 0.55 }),
    ],
  },
  /* Vaporwave */
  'wire-dolphin': {
    label: 'Wireframe dolphin', flat: true, build: () => [
      smooth(poly2([[-0.95, 0.1], [-0.6, 0.35], [-0.1, 0.45], [0.15, 0.7], [0.2, 0.42], [0.55, 0.3], [0.85, 0.15], [0.98, 0.08], [0.85, 0.02], [0.55, -0.05], [0.2, -0.2], [0.0, -0.45], [-0.1, -0.15], [-0.6, -0.05], [-0.85, -0.25], [-0.8, 0.0]]), 3),
      circle(0.025, 8, { cx: 0.62, cy: 0.17 }),
    ],
  },
  'retro-terrain': {
    label: 'Retro terrain', build: () => {
      const out = [], n = 10, h = (x, z) => 0.35 * Math.max(0, Math.sin(x * 2.2) * Math.cos(z * 1.7)) + 0.08 * Math.sin(x * 6 + z * 4);
      for (let i = 0; i <= n; i++) { const a = [], b = []; for (let j = 0; j <= 24; j++) { const t = -1 + j / 12, s = -1 + i * 2 / n; a.push([t, h(t, s) - 0.3, s]); b.push([s, h(s, t) - 0.3, t]); } out.push(P(a), P(b)); }
      return out;
    },
  },
  /* Brutalist */
  'stair-block': {
    label: 'Concrete stair', build: () => {
      const out = [];
      for (let i = 0; i < 5; i++) out.push(...box(-0.6 + i * 0.3, -0.8 + (i + 1) * 0.16, 0, 0.3, (i + 1) * 0.32, 0.7, { bottom: i === 0 }));
      return out;
    },
  },
  'waffle-slab': {
    label: 'Coffered slab', build: () => {
      const out = [P([[-0.95, 0, -0.95], [0.95, 0, -0.95], [0.95, 0, 0.95], [-0.95, 0, 0.95], [-0.95, 0, -0.95]])];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const x = -0.7 + i * 0.47, z = -0.7 + j * 0.47, s = 0.15; out.push(P([[x - s, -0.18, z - s], [x + s, -0.18, z - s], [x + s, -0.18, z + s], [x - s, -0.18, z + s], [x - s, -0.18, z - s]])); }
      return out;
    },
  },
  /* Stained Glass */
  'lancet-arch': {
    label: 'Lancet window', flat: true, build: () => {
      const out = [], arch = [];
      arch.push([-0.45, -0.95, 0], [-0.45, 0.25, 0]);
      for (let i = 0; i <= 12; i++) { const a = Math.PI - i / 12 * (Math.PI / 3); arch.push([0.45 + Math.cos(a) * 0.9, 0.25 + Math.sin(a) * 0.9, 0]); }
      for (let i = 0; i <= 12; i++) { const a = Math.PI * 2 / 3 - i / 12 * (Math.PI / 3); arch.push([-0.45 + Math.cos(a) * 0.9, 0.25 + Math.sin(a) * 0.9, 0]); }
      arch.push([0.45, -0.95, 0]);
      out.push({ pts: arch, closed: true, nofill: true });
      for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) out.push(poly2([[-0.4 + c * 0.42, -0.9 + r * 0.29], [-0.02 + c * 0.42, -0.9 + r * 0.29], [-0.02 + c * 0.42, -0.65 + r * 0.29], [-0.4 + c * 0.42, -0.65 + r * 0.29]]));
      out.push(circle(0.2, 24, { cy: 0.55 }));
      return out;
    },
  },
  'quatrefoil': {
    label: 'Quatrefoil', flat: true, build: () => {
      const out = [];
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; out.push(circle(0.38, 32, { cx: Math.cos(a) * 0.42, cy: Math.sin(a) * 0.42 })); }
      out.push(circle(0.22, 24), circle(0.96, 72, { nofill: true }));
      return out;
    },
  },
  /* Double Exposure */
  'stag-antlers': {
    label: 'Stag & antlers', flat: true, build: () => {
      const out = [smooth(poly2([[-0.18, 0.25], [-0.25, -0.1], [-0.12, -0.6], [0, -0.75], [0.12, -0.6], [0.25, -0.1], [0.18, 0.25], [0.32, 0.32], [0.18, 0.38], [0, 0.32], [-0.18, 0.38], [-0.32, 0.32]]), 3)];
      for (const m of [1, -1]) {
        out.push(smooth(P([[0.12 * m, 0.36, 0], [0.3 * m, 0.6, 0], [0.45 * m, 0.85, 0], [0.7 * m, 0.95, 0]]), 3));
        out.push(P([[0.3 * m, 0.6, 0], [0.55 * m, 0.62, 0]]), P([[0.42 * m, 0.8, 0], [0.38 * m, 1.0, 0]]), P([[0.22 * m, 0.48, 0], [0.12 * m, 0.7, 0]]));
      }
      return out;
    },
  },
  'bird-flock': {
    label: 'Flock of birds', flat: true, build: rng => {
      const out = [];
      for (let i = 0; i < 9; i++) { const x = -0.8 + rng() * 1.6, y = -0.5 + rng() * 1.1, s = 0.06 + rng() * 0.08; out.push(smooth(P([[x - s, y + s * 0.4, 0], [x - s * 0.4, y + s * 0.5, 0], [x, y, 0], [x + s * 0.4, y + s * 0.5, 0], [x + s, y + s * 0.4, 0]]), 2)); }
      return out;
    },
  },
  /* Tilt Shift */
  'hot-air-balloon': {
    label: 'Model hot-air balloon', build: () => {
      const out = [];
      for (let j = 0; j < 8; j++) { const th = j / 8 * Math.PI, pts = []; for (let k = 0; k <= 30; k++) { const t = k / 30, a = -Math.PI / 2 + t * 1.6 * Math.PI, r = 0.5 * Math.cos(Math.min(Math.PI / 2.2, Math.max(-Math.PI / 2, a * 0.5))) * (t < 0.15 ? t / 0.15 * 0.6 + 0.4 : 1); pts.push([r * Math.cos(th) * (0.2 + 0.8 * Math.sin(t * Math.PI)), 0.25 + 0.55 * Math.sin(a) * 0.9, r * Math.sin(th) * (0.2 + 0.8 * Math.sin(t * Math.PI))]); } out.push(P(pts)); }
      out.push(...box(0, -0.75, 0, 0.2, 0.14, 0.2));
      for (const [x, z] of [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]]) out.push(P([[x, -0.68, z], [x * 1.8, -0.25, z * 1.8]]));
      return out;
    },
  },
  'mini-lighthouse': {
    label: 'Miniature lighthouse', build: () => {
      const out = [];
      for (let k = 0; k < 5; k++) { const y = -0.8 + k * 0.32, r = 0.28 - k * 0.035; out.push(circle(r, 28, { plane: 'xz', cy: y, nofill: true })); }
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; out.push(P([[Math.cos(a) * 0.28, -0.8, Math.sin(a) * 0.28], [Math.cos(a) * 0.14, 0.48, Math.sin(a) * 0.14]])); }
      out.push(...box(0, 0.6, 0, 0.26, 0.22, 0.26), P([[-0.15, 0.71, 0], [0, 0.88, 0], [0.15, 0.71, 0]]));
      for (const m of [1, -1]) out.push(P([[0, 0.6, 0], [0.95 * m, 0.75, 0.2], [0.95 * m, 0.45, -0.2], [0, 0.6, 0]], { nofill: true }));
      return out;
    },
  },
  /* Glitch Art */
  'error-window': {
    label: 'Error window', flat: true, build: rng => {
      const out = [];
      for (let k = 0; k < 3; k++) { const dx = (k - 1) * 0.12 + (rng() - 0.5) * 0.05, dy = (1 - k) * 0.1; out.push(poly2([[-0.7 + dx, -0.45 + dy], [0.7 + dx, -0.45 + dy], [0.7 + dx, 0.45 + dy], [-0.7 + dx, 0.45 + dy]], { nofill: true }), P([[-0.7 + dx, 0.3 + dy, 0], [0.7 + dx, 0.3 + dy, 0]])); }
      out.push(P([[0.48, 0.42, 0], [0.6, 0.33, 0]]), P([[0.6, 0.42, 0], [0.48, 0.33, 0]]), poly2([[-0.2, -0.32], [0.2, -0.32], [0.2, -0.18], [-0.2, -0.18]]));
      out.push(P([[-0.1, 0.18, 0], [0, 0, 0], [0.1, 0.18, 0]]));
      return out;
    },
  },
  'voxel-heart': {
    label: 'Voxel heart', build: (rng, N) => {
      const pts = [];
      while (pts.length < N) { const x = (rng() - 0.5) * 2.4, y = (rng() - 0.5) * 2.4; const q = Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y; if (q <= 0) pts.push([Math.round(x * 8) / 8 * 0.62, Math.round(y * 8) / 8 * 0.62 + 0.05, Math.round((rng() - 0.5) * 4) / 4 * 0.3]); }
      return [{ pts, dots: true }];
    },
  },

  /* 14 · Frutiger Aero */
  'aqua-bubbles': {
    label: 'Aqua bubbles', build: rng => {
      const out = [];
      for (let i = 0; i < 9; i++) { const r = 0.12 + rng() * 0.22, cx = (rng() - 0.5) * 1.3, cy = (rng() - 0.5) * 1.3, cz = (rng() - 0.5) * 0.8; out.push(circle(r, 36, { cx, cy, cz }), circle(r * 0.55, 10, { cx: cx - r * 0.35, cy: cy + r * 0.4, cz, a0: Math.PI * 0.55, a1: Math.PI * 0.95, closed: false })); }
      return out;
    },
  },
  'water-droplet': {
    label: 'Water droplet', build: () => {
      // Teardrop of revolution: x = sin t · sin(t/2), y = cos t (tip at the top, round belly below)
      const prof = t => [Math.sin(t) * Math.sin(t / 2) * 0.62, Math.cos(t) * 0.88 - 0.05];
      const out = [];
      for (let j = 0; j < 10; j++) { const th = j / 10 * Math.PI, pts = []; for (let k = 0; k <= 48; k++) { const [r, y] = prof(k / 48 * TAU); pts.push([r * Math.cos(th), y, r * Math.sin(th)]); } out.push({ pts, closed: false, nofill: true }); }
      for (const t of [1.2, 1.8, 2.4, 2.9]) { const [r, y] = prof(t); out.push(circle(r, 40, { plane: 'xz', cy: y, nofill: true })); }
      out.push(circle(0.14, 12, { cx: -0.2, cy: -0.2, cz: 0.35, a0: Math.PI * 0.6, a1: Math.PI * 1.15, closed: false }));
      return out;
    },
  },
  'glossy-orb': {
    label: 'Glossy orb', build: () => {
      const out = sphereLL(0.75, 4, 8);
      out.push(circle(0.42, 30, { cy: 0.38, cz: 0.55, plane: 'xz', nofill: true }));
      out.push(circle(0.98, 80, { plane: 'xz', nofill: true }));
      return out;
    },
  },
  'aero-leaf': {
    label: 'Glossy leaf', flat: true, build: () => {
      const outline = smooth(poly2([[0, -0.85], [0.45, -0.4], [0.55, 0.15], [0.3, 0.65], [0, 0.9], [-0.3, 0.65], [-0.55, 0.15], [-0.45, -0.4]]), 4);
      const out = [outline, P([[0, -1, 0], [0, 0.85, 0]], { nofill: true })];
      for (let i = 0; i < 5; i++) { const y = -0.55 + i * 0.28; out.push(P([[0, y, 0], [0.38 - i * 0.04, y + 0.22, 0]]), P([[0, y, 0], [-0.38 + i * 0.04, y + 0.22, 0]])); }
      return out;
    },
  },
  'aero-swoosh': {
    label: 'Aero swoosh', flat: true, build: () => {
      const out = [];
      for (let k = 0; k < 7; k++) { const pts = []; for (let i = 0; i <= 60; i++) { const t = -1 + i / 30; pts.push([t * 0.95, Math.sin(t * 1.6 + k * 0.18) * 0.5 - (k - 3) * 0.1, Math.cos(t * 1.2 + k * 0.2) * 0.12]); } out.push(P(pts)); }
      return out;
    },
  },
  'aero-globe': {
    label: 'Eco globe', build: () => {
      const out = sphereLL(0.62, 3, 6);
      out.push(...rotX([circle(0.95, 72, { plane: 'xz', nofill: true })], 0.35), ...rotZ([circle(0.82, 64, { plane: 'xz', nofill: true })], 0.9));
      for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; out.push(circle(0.05, 10, { cx: Math.cos(a) * 0.95, cy: Math.sin(a) * 0.33, cz: Math.sin(a) * 0.9 })); }
      return out;
    },
  },
  'aero-butterfly': {
    label: 'Glass butterfly', flat: true, build: () => {
      const out = [];
      for (const m of [1, -1]) {
        out.push(smooth(poly2([[0.04, 0.05], [0.35, 0.6], [0.8, 0.7], [0.75, 0.25], [0.3, 0.02]], { flipX: m < 0 }), 4));
        out.push(smooth(poly2([[0.04, -0.02], [0.55, -0.15], [0.6, -0.55], [0.25, -0.6]], { flipX: m < 0 }), 4));
        out.push(smooth(P([[0.02 * m, 0.25, 0], [0.12 * m, 0.55, 0], [0.22 * m, 0.7, 0]], { nofill: true }), 3));
      }
      out.push(poly2([[-0.04, 0.2], [0.04, 0.2], [0.03, -0.45], [-0.03, -0.45]]));
      return out;
    },
  },
  'aero-fish': {
    label: 'Aquarium fish', flat: true, build: () => [
      smooth(poly2([[-0.6, 0], [-0.25, 0.4], [0.3, 0.45], [0.7, 0.1], [0.7, -0.1], [0.3, -0.45], [-0.25, -0.4]]), 4),
      poly2([[-0.58, 0], [-0.95, 0.35], [-0.85, 0], [-0.95, -0.35]]),
      circle(0.07, 14, { cx: 0.45, cy: 0.1 }),
      circle(0.06, 10, { cx: 0.9, cy: 0.35, nofill: true }), circle(0.04, 10, { cx: 0.98, cy: 0.58, nofill: true }), circle(0.03, 8, { cx: 0.9, cy: 0.78, nofill: true }),
    ],
  },
};

function fragmentCube(rng, s) {
  const out = [];
  const corners = [];
  for (const x of [-s, s]) for (const y of [-s, s]) for (const z of [-s, s]) corners.push([x, y, z]);
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const a = corners[i], b = corners[j];
    const diff = (a[0] !== b[0]) + (a[1] !== b[1]) + (a[2] !== b[2]);
    if (diff !== 1) continue;
    for (let k = 0; k < 3; k++) {
      const t0 = k / 3 + 0.02, t1 = (k + 1) / 3 - 0.02;
      const p0 = a.map((v, c) => v + (b[c] - v) * t0), p1 = a.map((v, c) => v + (b[c] - v) * t1);
      const mid = p0.map((v, c) => (v + p1[c]) / 2), push = rng() * 0.16;
      const n = norm(mid, push);
      out.push(P([p0.map((v, c) => v + n[c]), p1.map((v, c) => v + n[c])]));
    }
  }
  return out;
}

/* Resampling: paths → exactly N points                                */
function pathLength(pts, closed) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  if (closed) L += dist(pts[pts.length - 1], pts[0]);
  return L;
}

function resamplePath(pts, closed, count) {
  const src = closed ? [...pts, pts[0]] : pts;
  const seg = [0];
  for (let i = 1; i < src.length; i++) seg.push(seg[i - 1] + dist(src[i - 1], src[i]));
  const L = seg[seg.length - 1] || 1;
  const out = [];
  let j = 1;
  for (let k = 0; k < count; k++) {
    const target = (k / (count - 1)) * L;
    while (j < seg.length - 1 && seg[j] < target) j++;
    const a = src[j - 1], b = src[j], span = (seg[j] - seg[j - 1]) || 1, t = Math.max(0, Math.min(1, (target - seg[j - 1]) / span));
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

/**
 * Build a form and resample it to N points.
 * Returns { id, label, flat, pos: Float32Array(3N), link: Uint8Array(N), groups: [{start,count,closed,fill}] }
 * link[i] = 1 means point i connects to i+1.
 */
export function buildForm(id, N, seed = 1) {
  const def = FORMS[id];
  if (!def) throw new Error(`Unknown form ${id}`);
  const rng = mulberry32(seed);
  const paths = def.build(rng, N).filter(p => p.pts && p.pts.length);
  const dots = paths.filter(p => p.dots), lines = paths.filter(p => !p.dots && p.pts.length > 1);

  let dotPts = dots.flatMap(p => p.pts);
  if (dotPts.length > N) dotPts = dotPts.slice(0, N);
  let remaining = N - dotPts.length;

  let keep = lines;
  const maxLines = Math.floor(remaining / 2);
  if (keep.length > maxLines) keep = keep.slice(0, maxLines);
  const lengths = keep.map(p => pathLength(p.pts, p.closed));
  const totalL = lengths.reduce((a, b) => a + b, 0) || 1;
  const counts = keep.map(() => 2);
  let extra = remaining - counts.length * 2;
  if (keep.length) {
    const share = keep.map((_, i) => (lengths[i] / totalL) * extra);
    share.forEach((s, i) => { counts[i] += Math.floor(s); });
    let used = counts.reduce((a, b) => a + b, 0);
    let i = 0;
    const order = lengths.map((l, k) => [l, k]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    while (used < remaining) { counts[order[i % order.length]]++; used++; i++; }
  }

  const pos = new Float32Array(N * 3), link = new Uint8Array(N), groups = [];
  let w = 0;
  keep.forEach((p, i) => {
    const pts = resamplePath(p.pts, p.closed, counts[i]);
    const start = w;
    pts.forEach((q, k) => { pos[w * 3] = q[0]; pos[w * 3 + 1] = q[1]; pos[w * 3 + 2] = q[2]; link[w] = k < pts.length - 1 ? 1 : 0; w++; });
    groups.push({ start, count: pts.length, closed: !!p.closed, fill: !!p.closed && !p.nofill });
  });
  // dots, then pad if needed (forms made only of dots repeat their points)
  const pool = dotPts.length ? dotPts : [[0, 0, 0]];
  let d = 0;
  while (w < N) { const q = pool[d % pool.length]; pos[w * 3] = q[0]; pos[w * 3 + 1] = q[1]; pos[w * 3 + 2] = q[2]; link[w] = 0; w++; d++; }

  return { id, label: def.label, flat: !!def.flat, upright: !!def.upright, pos, link, groups };
}

export { SIL };

export function formLabel(id) { return FORMS[id]?.label || id; }
