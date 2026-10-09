/**
 * backdrops.js — procedural, animated world backdrops (no image assets).
 *
 * Each renderer has init(S) (build cached layers once per size/theme) and
 * draw(ctx, S, t, dt, R) where R holds the smoothed audio bands and the
 * kick/snare envelopes shared with the hologram. Static layers are cached to
 * offscreen canvases so per-frame cost is small; heavy effects never touch
 * the UI — the backdrop sits behind a scrim and panels.
 */
import { mulberry32, SIL } from './forms.js';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

function layer(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : hex;
}
function grain(ctx, w, h, rng, n, colors, alpha, size = 1) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = alpha * (0.4 + rng() * 0.6);
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.fillRect(rng() * w, rng() * h, size, size);
  }
  ctx.globalAlpha = 1;
}
function blotches(ctx, w, h, rng, n, colors, rMin, rMax, alpha) {
  for (let i = 0; i < n; i++) {
    const x = rng() * w, y = rng() * h, r = rMin + rng() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colors[Math.floor(rng() * colors.length)];
    g.addColorStop(0, rgba(c, alpha)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
function silPath(ctx, key, cx, cy, s, flipX = false) {
  const pts = SIL[key];
  ctx.beginPath();
  pts.forEach(([x, y], i) => { const px = cx + (flipX ? -x : x) * s, py = cy - y * s; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.closePath();
}
/** Cheap universal blur: downscale then upscale with smoothing. */
function softBlur(src, factor) {
  const w = Math.max(1, Math.round(src.width / factor)), h = Math.max(1, Math.round(src.height / factor));
  const small = layer(w, h), sc = small.getContext('2d');
  sc.imageSmoothingQuality = 'high'; sc.drawImage(src, 0, 0, w, h);
  const out = layer(src.width, src.height), oc = out.getContext('2d');
  oc.imageSmoothingQuality = 'high'; oc.drawImage(small, 0, 0, src.width, src.height);
  return out;
}

/* ====================================================================== */
export const BACKDROPS = {
  /* ------------------------------ 01 CYBERPUNK ------------------------ */
  cyberpunk: {
    init(S) {
      const { w, h, rng } = S, hz = h * 0.64;
      const city = layer(w, h), c = city.getContext('2d');
      const sky = c.createLinearGradient(0, 0, 0, hz);
      sky.addColorStop(0, '#04050c'); sky.addColorStop(0.7, '#0f0b2a'); sky.addColorStop(1, '#2a0f3d');
      c.fillStyle = sky; c.fillRect(0, 0, w, hz);
      const bands = [{ col: '#120f2e', hMin: 0.18, hMax: 0.42, wMin: 0.03, wMax: 0.07, lit: 0.05 }, { col: '#0a0a1c', hMin: 0.3, hMax: 0.6, wMin: 0.05, wMax: 0.1, lit: 0.08 }];
      S.signs = [];
      bands.forEach((b, bi) => {
        let x = -10;
        while (x < w) {
          const bw = w * (b.wMin + rng() * (b.wMax - b.wMin));
          const edge = Math.abs(x + bw / 2 - w / 2) / (w / 2);
          const bh = h * (b.hMin + rng() * (b.hMax - b.hMin)) * (0.6 + edge * 0.7);
          c.fillStyle = b.col; c.fillRect(x, hz - bh, bw, bh);
          for (let wy = hz - bh + 6; wy < hz - 4; wy += 7) for (let wx = x + 4; wx < x + bw - 4; wx += 6) {
            if (rng() < b.lit) { c.fillStyle = rng() < 0.5 ? 'rgba(52,223,255,.55)' : rng() < 0.5 ? 'rgba(255,62,201,.5)' : 'rgba(255,240,220,.4)'; c.fillRect(wx, wy, 2, 3); }
          }
          if (bi === 1 && rng() < 0.55) S.signs.push({ x: x + bw * (0.15 + rng() * 0.5), y: hz - bh + bh * (0.1 + rng() * 0.4), w: rng() < 0.5 ? 6 : bw * 0.5, h: rng() < 0.5 ? bh * 0.25 : 10, col: rng() < 0.5 ? '#ff3ec9' : rng() < 0.5 ? '#34dfff' : '#a77bff', ph: rng() * TAU, flick: rng() });
          x += bw + 2;
        }
      });
      // street + reflection
      const street = c.createLinearGradient(0, hz, 0, h);
      street.addColorStop(0, '#0b0820'); street.addColorStop(1, '#03030a');
      c.fillStyle = street; c.fillRect(0, hz, w, h - hz);
      c.save(); c.globalAlpha = 0.28; c.translate(0, hz * 2); c.scale(1, -1); c.drawImage(city, 0, 0, w, hz, 0, hz - (h - hz) * 1.0, w, hz); c.restore();
      c.globalAlpha = 0.5; c.fillStyle = '#05040f';
      for (let y = hz; y < h; y += 4) c.fillRect(0, y, w, 1);
      c.globalAlpha = 1;
      S.city = city; S.hz = hz;
      S.rain = Array.from({ length: Math.round(w * h / 9000) }, () => ({ x: rng() * w, y: rng() * h, l: 8 + rng() * 18, v: 500 + rng() * 500 }));
    },
    draw(ctx, S, t, dt, R) {
      const { w, h, hz, dpr } = S;
      ctx.drawImage(S.city, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      for (const s of S.signs) {
        const on = s.flick > 0.85 ? (Math.sin(t * 13 + s.ph) > -0.6 ? 1 : 0.2) : 1;
        const a = (0.55 + 0.25 * Math.sin(t * 1.3 + s.ph) + R.kick * 0.35) * on;
        ctx.fillStyle = rgba(s.col, clamp(a * 0.25)); ctx.fillRect(s.x - 6, s.y - 6, s.w + 12, s.h + 12);
        ctx.fillStyle = rgba(s.col, clamp(a)); ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = rgba(s.col, clamp(a * 0.18)); ctx.fillRect(s.x, hz + (hz - s.y) * 0.3, s.w, (h - hz) * 0.6); // wet reflection streak
      }
      const haze = ctx.createLinearGradient(0, hz - h * 0.12, 0, hz + h * 0.06);
      haze.addColorStop(0, 'rgba(255,62,201,0)'); haze.addColorStop(0.7, rgba('#ff3ec9', 0.1 + R.energy * 0.12)); haze.addColorStop(1, 'rgba(52,223,255,0)');
      ctx.fillStyle = haze; ctx.fillRect(0, hz - h * 0.12, w, h * 0.18);
      ctx.globalCompositeOperation = 'source-over';
      if (S.animate) {
        ctx.strokeStyle = 'rgba(160,200,255,.22)'; ctx.lineWidth = dpr; ctx.beginPath();
        for (const d of S.rain) { d.y += d.v * dt; d.x -= d.v * dt * 0.12; if (d.y > h) { d.y = -20; d.x = Math.random() * w * 1.1; } ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.12, d.y - d.l); }
        ctx.stroke();
      }
    },
  },

  /* ------------------------------ 02 ART DECO ------------------------- */
  artdeco: {
    init(S) {
      const { w, h } = S, L = layer(w, h), c = L.getContext('2d');
      const g = c.createRadialGradient(w / 2, h, 0, w / 2, h, Math.max(w, h));
      g.addColorStop(0, '#0f3328'); g.addColorStop(0.6, '#07170f'); g.addColorStop(1, '#030806');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      // sunburst wedges from bottom centre
      for (let i = 0; i < 36; i++) {
        const a0 = Math.PI + (i / 36) * Math.PI, a1 = a0 + Math.PI / 72;
        c.beginPath(); c.moveTo(w / 2, h); c.arc(w / 2, h, Math.max(w, h) * 1.2, a0, a1); c.closePath();
        c.fillStyle = i % 2 ? 'rgba(217,179,108,.05)' : 'rgba(217,179,108,.025)'; c.fill();
      }
      c.strokeStyle = 'rgba(217,179,108,.45)'; c.lineWidth = 1;
      // stepped frame
      for (let k = 0; k < 3; k++) {
        const m = 14 + k * 9, st = 22 + k * 8;
        c.beginPath();
        c.moveTo(m + st, m); c.lineTo(w - m - st, m); c.lineTo(w - m - st, m + st / 2); c.lineTo(w - m, m + st / 2); c.lineTo(w - m, h - m - st / 2); c.lineTo(w - m - st, h - m - st / 2); c.lineTo(w - m - st, h - m);
        c.lineTo(m + st, h - m); c.lineTo(m + st, h - m - st / 2); c.lineTo(m, h - m - st / 2); c.lineTo(m, m + st / 2); c.lineTo(m + st, m + st / 2); c.closePath(); c.stroke();
      }
      // fans in bottom corners and top centre
      const fan = (x, y, r, a0, a1) => { for (let k = 1; k <= 6; k++) { c.beginPath(); c.arc(x, y, r * k / 6, a0, a1); c.stroke(); } for (let k = 0; k <= 8; k++) { const a = a0 + (a1 - a0) * k / 8; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); c.stroke(); } };
      const fr = Math.min(w, h) * 0.22;
      fan(40, h - 40, fr, -Math.PI / 2, 0); fan(w - 40, h - 40, fr, Math.PI, Math.PI * 1.5); fan(w / 2, 34, fr * 0.6, 0, Math.PI);
      // pinstripe columns
      c.strokeStyle = 'rgba(217,179,108,.18)';
      for (const x0 of [w * 0.06, w * 0.94]) for (let k = -3; k <= 3; k++) { c.beginPath(); c.moveTo(x0 + k * 5, h * 0.18); c.lineTo(x0 + k * 5, h * 0.82); c.stroke(); }
      S.base = L;
    },
    draw(ctx, S, t, dt, R) {
      const { w, h } = S;
      ctx.drawImage(S.base, 0, 0);
      // slow sheen sweeping the sunburst
      const a = Math.PI + ((t * 0.05) % 1) * Math.PI;
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath(); ctx.moveTo(w / 2, h); ctx.arc(w / 2, h, Math.max(w, h) * 1.2, a, a + 0.18); ctx.closePath();
      ctx.fillStyle = 'rgba(246,223,166,.05)'; ctx.fill();
      if (R.kick > 0.05) {
        ctx.strokeStyle = rgba('#d9b36c', R.kick * 0.35); ctx.lineWidth = 1.5;
        for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(w / 2, h, (1 - R.kick) * h * 0.6 + k * 30, Math.PI, TAU); ctx.stroke(); }
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  },

  /* ------------------------------ 03 CAVE ----------------------------- */
  cave: {
    init(S) {
      const { w, h, rng } = S, L = layer(w, h), c = L.getContext('2d');
      c.fillStyle = '#3a2416'; c.fillRect(0, 0, w, h);
      blotches(c, w, h, rng, 70, ['#5a3820', '#2a170d', '#6e4627', '#43291a'], 40, 260, 0.45);
      // cracks
      c.strokeStyle = 'rgba(20,10,5,.5)'; c.lineWidth = 1.2;
      for (let k = 0; k < 14; k++) { let x = rng() * w, y = rng() * h; c.beginPath(); c.moveTo(x, y); for (let s = 0; s < 18; s++) { x += (rng() - 0.5) * 30; y += rng() * 18; c.lineTo(x, y); } c.stroke(); }
      grain(c, w, h, rng, w * h / 25, ['#1a0e07', '#7a5232', '#c49a6a'], 0.25, 1.5);
      // pictograms: herd of figures in ochre & rust, hand stencils, dots and strokes (artistic interpretation)
      const s = Math.min(w, h);
      const fig = (key, x, y, sc, col, flip) => { c.save(); silPath(c, key, x, y, sc, flip); c.fillStyle = col; c.globalAlpha = 0.42; c.fill(); c.restore(); };
      fig('bison', w * 0.16, h * 0.3, s * 0.11, '#b5532f', false);
      fig('deer', w * 0.82, h * 0.24, s * 0.12, '#d0893f', true);
      fig('deer', w * 0.88, h * 0.34, s * 0.09, '#d0893f', true);
      fig('bison', w * 0.78, h * 0.78, s * 0.08, '#2a170d', true);
      const hand = (x, y, sc, col) => { for (let i = 0; i < 900; i++) { const a = rng() * TAU, r = sc * (0.9 + rng() * 0.8); c.globalAlpha = 0.08; c.fillStyle = col; c.fillRect(x + Math.cos(a) * r, y + Math.sin(a) * r, 2, 2); } c.save(); silPath(c, 'hand', x, y, sc * 0.9); c.globalCompositeOperation = 'destination-out'; c.globalAlpha = 0.0; c.fill(); c.restore(); c.save(); silPath(c, 'hand', x, y, sc * 0.9); c.strokeStyle = rgba(col, 0.35); c.lineWidth = 3; c.stroke(); c.restore(); };
      hand(w * 0.1, h * 0.72, s * 0.08, '#c0533a'); hand(w * 0.92, h * 0.58, s * 0.06, '#efe3c8');
      c.globalAlpha = 0.45;
      for (let i = 0; i < 9; i++) { c.fillStyle = '#c0533a'; c.beginPath(); c.arc(w * 0.3 + i * 14, h * 0.88 + Math.sin(i) * 4, 3.5, 0, TAU); c.fill(); }
      c.strokeStyle = '#1a0e07'; c.lineWidth = 3;
      for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(w * 0.62 + i * 9, h * 0.1); c.lineTo(w * 0.62 + i * 9 + 3, h * 0.17); c.stroke(); }
      c.beginPath(); for (let i = 0; i <= 10; i++) c.lineTo(w * 0.4 + i * 12, h * 0.14 + (i % 2) * 10); c.stroke();
      c.globalAlpha = 1;
      S.base = L;
    },
    draw(ctx, S, t, dt, R) {
      const { w, h } = S;
      ctx.drawImage(S.base, 0, 0);
      // firelight flicker from below-left
      const fl = 0.75 + Math.sin(t * 7.1) * 0.06 + Math.sin(t * 11.3) * 0.05 + Math.sin(t * 2.3) * 0.08 + R.kick * 0.15;
      const g = ctx.createRadialGradient(w * 0.2, h * 1.05, 0, w * 0.2, h * 1.05, Math.max(w, h) * 0.9 * fl);
      g.addColorStop(0, 'rgba(255,150,60,.22)'); g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
      const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,5,2,.65)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    },
  },

  /* ------------------------------ 04 MOSAIC --------------------------- */
  mosaic: {
    init(S) {
      const { w, h, rng, dpr } = S, L = layer(w, h), c = L.getContext('2d');
      c.fillStyle = '#0a0f1f'; c.fillRect(0, 0, w, h);
      const jewel = ['#2a5bd7', '#d6334f', '#f2a93b', '#21a67a', '#33c9c4', '#7b4bd1', '#1c3f9e'];
      const ts = Math.max(10, Math.round(15 * dpr));
      S.tiles = [];
      const cx = w / 2, cy = h * 0.45, maxD = Math.hypot(w, h) / 2;
      for (let y = 0; y < h; y += ts) for (let x = 0; x < w; x += ts) {
        const jx = (rng() - 0.5) * 3, jy = (rng() - 0.5) * 3, s = ts - 2 - rng() * 2;
        const d = Math.hypot(x - cx, y - cy), a = Math.atan2(y - cy, x - cx);
        // Pattern: concentric jewel rings with a radiating wave + calmer, darker centre for legibility.
        const band = Math.floor(d / (ts * 3) + Math.sin(a * 6) * 0.8);
        let col = jewel[((band % jewel.length) + jewel.length) % jewel.length];
        const calm = clamp(1 - d / (maxD * 0.55));
        c.fillStyle = col; c.globalAlpha = 0.55 + rng() * 0.35 - calm * 0.45;
        c.fillRect(x + jx, y + jy, s, s);
        c.globalAlpha = 0.18; c.fillStyle = '#ffffff'; c.fillRect(x + jx, y + jy, s, 2);
        S.tiles.push({ x: x + jx, y: y + jy, s, d });
      }
      c.globalAlpha = 1;
      S.base = L; S.tw = new Float32Array(S.tiles.length);
    },
    draw(ctx, S, t, dt, R) {
      const { w, h } = S;
      ctx.drawImage(S.base, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      // twinkles driven by highs
      const n = Math.round(4 + R.high * 30);
      if (S.animate) for (let k = 0; k < n; k++) S.tw[Math.floor(Math.random() * S.tw.length)] = 1;
      ctx.fillStyle = '#ffffff';
      const ring = (1 - R.kick) * Math.hypot(w, h) * 0.5;
      for (let i = 0; i < S.tiles.length; i++) {
        const tl = S.tiles[i];
        let a = S.tw[i] * 0.35;
        if (R.kick > 0.05 && Math.abs(tl.d - ring) < tl.s * 2) a += R.kick * 0.3;
        if (a > 0.01) { ctx.globalAlpha = a; ctx.fillRect(tl.x, tl.y, tl.s, tl.s); }
        S.tw[i] *= Math.exp(-dt * 4);
      }
      // iridescent diagonal sweep
      const p = ((t * 0.06) % 1.4) - 0.2;
      const g = ctx.createLinearGradient(w * p, 0, w * (p + 0.3), h);
      g.addColorStop(0, 'rgba(120,255,240,0)'); g.addColorStop(0.5, 'rgba(180,140,255,.06)'); g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    },
  },

  /* ------------------------------ 05 UKIYO-E -------------------------- */
  ukiyo: {
    init(S) {
      const { w, h, rng } = S, L = layer(w, h), c = L.getContext('2d');
      c.fillStyle = '#efe5cf'; c.fillRect(0, 0, w, h);
      // flat sky band (bokashi-style stepped gradient)
      for (let i = 0; i < 6; i++) { c.fillStyle = rgba('#1f3a5f', 0.16 - i * 0.025); c.fillRect(0, i * h * 0.05, w, h * 0.05); }
      // sun
      c.fillStyle = '#c63a2c'; c.beginPath(); c.arc(w * 0.8, h * 0.2, Math.min(w, h) * 0.07, 0, TAU); c.fill();
      // distant hills
      const hill = (y, amp, col) => { c.fillStyle = col; c.beginPath(); c.moveTo(0, h); for (let x = 0; x <= w; x += 8) c.lineTo(x, y - Math.sin(x / w * 5 + amp) * h * 0.04 - Math.sin(x / w * 13) * h * 0.012); c.lineTo(w, h); c.closePath(); c.fill(); };
      hill(h * 0.62, 1, '#9fb8ad'); hill(h * 0.68, 2.4, '#5f8f7b');
      // stylised flat clouds
      const cloud = (x, y, cw) => { c.fillStyle = '#f8f1df'; c.strokeStyle = '#1f3a5f'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y); for (let i = 0; i <= 6; i++) c.arc(x + cw * i / 6, y, cw / 12, Math.PI, 0); c.lineTo(x + cw, y + 10); c.lineTo(x, y + 10); c.closePath(); c.fill(); c.stroke(); };
      cloud(w * 0.08, h * 0.22, w * 0.22); cloud(w * 0.55, h * 0.36, w * 0.18); cloud(w * 0.3, h * 0.48, w * 0.15);
      grain(c, w, h, rng, w * h / 40, ['#b9a27c', '#ffffff'], 0.18, 1);
      // paper fibres
      c.strokeStyle = 'rgba(150,120,80,.08)';
      for (let i = 0; i < 160; i++) { const x = rng() * w, y = rng() * h; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 6); c.stroke(); }
      S.base = L; S.reveal = 0;
    },
    draw(ctx, S, t, dt, R) {
      const { w, h, dpr } = S;
      S.reveal = S.animate ? Math.min(1, S.reveal + dt / 2.4) : 1;
      const rx = w * S.reveal;
      ctx.fillStyle = '#e8dcc0'; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, rx, h); ctx.clip();
      ctx.drawImage(S.base, 0, 0);
      // animated wave bands with scallops
      const rows = 5, sw = Math.max(26, w / 26);
      for (let r = 0; r < rows; r++) {
        const y0 = h * 0.74 + r * h * 0.055, amp = 1 + R.kick * 0.8 * (1 - r / rows), off = ((t * (12 + r * 6)) % sw) * (r % 2 ? -1 : 1);
        ctx.fillStyle = r % 2 ? '#1f3a5f' : '#2b4c78';
        ctx.beginPath(); ctx.moveTo(-sw, h);
        for (let x = -sw * 2; x <= w + sw * 2; x += sw) ctx.arc(x + off, y0, sw / 2 * amp, Math.PI, 0);
        ctx.lineTo(w + sw, h); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#f8f1df'; ctx.lineWidth = 1.4 * dpr; ctx.beginPath();
        for (let x = -sw * 2; x <= w + sw * 2; x += sw) { ctx.moveTo(x + off - sw / 2 * amp * 0.7, y0); ctx.arc(x + off, y0, sw / 2 * amp * 0.7, Math.PI, 0); }
        ctx.stroke();
      }
      ctx.restore();
      if (S.reveal < 1) {
        // the rolled part of the scroll
        const g = ctx.createLinearGradient(rx - 18, 0, rx + 18, 0);
        g.addColorStop(0, '#c9b48a'); g.addColorStop(0.5, '#fbf3df'); g.addColorStop(1, '#8a7350');
        ctx.fillStyle = g; ctx.fillRect(rx - 18, 0, 36, h);
      }
    },
  },

  /* ------------------------------ 06 BAROQUE -------------------------- */
  baroque: {
    init(S) {
      const { w, h, rng } = S, L = layer(w, h), c = L.getContext('2d');
      c.fillStyle = '#0a0604'; c.fillRect(0, 0, w, h);
      blotches(c, w, h, rng, 40, ['#2a170c', '#1a0e07', '#3b1e10'], 60, 300, 0.5);
      // painterly strokes
      for (let i = 0; i < 380; i++) { const x = rng() * w, y = rng() * h, l = 10 + rng() * 40, a = rng() * Math.PI; c.strokeStyle = rgba(['#3a2010', '#20120a', '#4a2a14'][i % 3], 0.18); c.lineWidth = 2 + rng() * 5; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
      // drapery (original, theatrical curtain folds) on the left and top
      const fold = (x0, x1, col) => { const g = c.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, rgba(col, 0.0)); g.addColorStop(0.5, rgba(col, 0.75)); g.addColorStop(1, rgba(col, 0.1)); c.fillStyle = g; c.beginPath(); c.moveTo(x0, 0); c.bezierCurveTo(x0 + 20, h * 0.4, x1 - 30, h * 0.6, x1 - 10, h); c.lineTo(x1 + 30, h); c.bezierCurveTo(x1, h * 0.5, x1 + 10, h * 0.3, x1 + 20, 0); c.closePath(); c.fill(); };
      for (let i = 0; i < 5; i++) fold(i * w * 0.04 - 20, i * w * 0.04 + w * 0.06, i % 2 ? '#6b1a26' : '#8a2433');
      c.fillStyle = 'rgba(110,26,38,.75)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(w, 0); c.lineTo(w, h * 0.05);
      for (let x = w; x >= 0; x -= w / 9) c.quadraticCurveTo(x - w / 18, h * 0.13, x - w / 9, h * 0.05);
      c.closePath(); c.fill();
      // gilded frame
      c.strokeStyle = 'rgba(210,162,76,.55)'; c.lineWidth = 3; c.strokeRect(18, 18, w - 36, h - 36);
      c.strokeStyle = 'rgba(210,162,76,.25)'; c.lineWidth = 1; c.strokeRect(28, 28, w - 56, h - 56);
      for (const [x, y] of [[18, 18], [w - 18, 18], [18, h - 18], [w - 18, h - 18]]) { c.beginPath(); c.arc(x, y, 14, 0, TAU); c.stroke(); c.beginPath(); c.arc(x, y, 8, 0, TAU); c.stroke(); }
      S.base = L;
    },
    draw(ctx, S, t, dt, R) {
      const { w, h } = S;
      ctx.drawImage(S.base, 0, 0);
      const flick = 0.85 + Math.sin(t * 5.3) * 0.05 + Math.sin(t * 8.9) * 0.04 + R.kick * 0.2;
      // narrow shaft of light from the upper left
      ctx.globalCompositeOperation = 'lighter';
      ctx.save();
      ctx.beginPath(); ctx.moveTo(w * 0.05, -10); ctx.lineTo(w * 0.22, -10); ctx.lineTo(w * 0.72, h); ctx.lineTo(w * 0.38, h); ctx.closePath(); ctx.clip();
      const g = ctx.createLinearGradient(w * 0.1, 0, w * 0.55, h);
      g.addColorStop(0, rgba('#ffcf7a', 0.16 * flick)); g.addColorStop(1, rgba('#ffcf7a', 0.02));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
      const v = ctx.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, rgba('#000000', 0.82 - R.kick * 0.1));
      ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    },
  },

  /* ------------------------------ 07 STREET ART ----------------------- */
  street: {
    init(S) {
      const { w, h, rng } = S, L = layer(w, h), c = L.getContext('2d');
      c.fillStyle = '#6a6a66'; c.fillRect(0, 0, w, h);
      blotches(c, w, h, rng, 60, ['#55554f', '#7a7a74', '#4a4a46'], 30, 200, 0.4);
      grain(c, w, h, rng, w * h / 12, ['#3c3c38', '#8e8e88', '#2c2c2a'], 0.35, 1.5);
      c.strokeStyle = 'rgba(40,40,38,.6)'; c.lineWidth = 2;
      for (let x = w * 0.33; x < w; x += w * 0.33) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
      c.beginPath(); c.moveTo(0, h * 0.55); c.lineTo(w, h * 0.55); c.stroke();
      // paste-up posters with halftone
      const poster = (x, y, pw, ph, rot, col) => {
        c.save(); c.translate(x, y); c.rotate(rot);
        c.fillStyle = '#f2efe6'; c.fillRect(0, 0, pw, ph);
        c.fillStyle = col; for (let yy = 6; yy < ph; yy += 8) for (let xx = 6; xx < pw; xx += 8) { const r = 3.2 * (1 - yy / ph); if (r > 0.3) { c.beginPath(); c.arc(xx, yy, r, 0, TAU); c.fill(); } }
        c.fillStyle = '#111'; c.fillRect(8, ph - 26, pw * 0.6, 12);
        c.fillStyle = 'rgba(230,220,180,.75)'; c.fillRect(-6, -6, 28, 12); c.fillRect(pw - 22, ph - 6, 28, 12); // tape
        c.restore();
      };
      poster(w * 0.06, h * 0.08, w * 0.14, h * 0.26, -0.05, '#ff3b30');
      poster(w * 0.78, h * 0.12, w * 0.15, h * 0.22, 0.06, '#22d3ee');
      poster(w * 0.72, h * 0.62, w * 0.12, h * 0.22, -0.03, '#e8ff2a');
      // overspray & stencil marks (original, no artist tags)
      const spray = (x, y, r, col, n) => { for (let i = 0; i < n; i++) { const a = rng() * TAU, d = Math.pow(rng(), 0.6) * r; c.globalAlpha = 0.25; c.fillStyle = col; c.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.5, 1.5); } c.globalAlpha = 1; };
      spray(w * 0.18, h * 0.7, 70, '#e8ff2a', 2600); spray(w * 0.86, h * 0.45, 60, '#ff3b30', 1800); spray(w * 0.45, h * 0.9, 90, '#22d3ee', 2600);
      c.fillStyle = '#111';
      // stencil arrow
      c.beginPath(); c.moveTo(w * 0.08, h * 0.5); c.lineTo(w * 0.2, h * 0.5); c.lineTo(w * 0.2, h * 0.47); c.lineTo(w * 0.25, h * 0.52); c.lineTo(w * 0.2, h * 0.57); c.lineTo(w * 0.2, h * 0.54); c.lineTo(w * 0.08, h * 0.54); c.closePath(); c.fill();
      silPath(c, 'pigeon', w * 0.88, h * 0.86, Math.min(w, h) * 0.06, true); c.fill();
      // drips
      c.strokeStyle = 'rgba(232,255,42,.7)'; c.lineWidth = 2;
      for (let i = 0; i < 7; i++) { const x = w * 0.13 + i * 9; c.beginPath(); c.moveTo(x, h * 0.73); c.lineTo(x, h * 0.73 + 10 + rng() * 40); c.stroke(); }
      // hand-drawn arrows
      c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 3; c.beginPath(); c.moveTo(w * 0.62, h * 0.12); c.quadraticCurveTo(w * 0.7, h * 0.05, w * 0.74, h * 0.14); c.lineTo(w * 0.72, h * 0.1); c.moveTo(w * 0.74, h * 0.14); c.lineTo(w * 0.7, h * 0.14); c.stroke();
      S.base = L; S.puffs = [];
    },
    draw(ctx, S, t, dt, R) {
      ctx.drawImage(S.base, 0, 0);
      if (S.animate && R.kick > 0.95 && S.puffs.length < 6) S.puffs.push({ x: Math.random() * S.w, y: Math.random() * S.h, r: 30 + Math.random() * 60, col: ['#e8ff2a', '#22d3ee', '#ff3b30'][Math.floor(Math.random() * 3)], a: 1 });
      for (let i = S.puffs.length - 1; i >= 0; i--) {
        const p = S.puffs[i]; p.a -= dt * 0.35; if (p.a <= 0) { S.puffs.splice(i, 1); continue; }
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, rgba(p.col, 0.28 * p.a)); g.addColorStop(1, rgba(p.col, 0));
        ctx.fillStyle = g; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
    },
  },

  /* ------------------------------ 08 VAPORWAVE ------------------------ */
  vapor: {
    init(S) {
      const { w, h, rng } = S, hz = h * 0.62;
      const L = layer(w, h), c = L.getContext('2d');
      const sky = c.createLinearGradient(0, 0, 0, hz);
      sky.addColorStop(0, '#1a0b2e'); sky.addColorStop(0.55, '#7a2a8c'); sky.addColorStop(0.85, '#ff71ce'); sky.addColorStop(1, '#ffb38a');
      c.fillStyle = sky; c.fillRect(0, 0, w, hz);
      // striped sun
      const r = Math.min(w, h) * 0.2, sx = w / 2, sy = hz - r * 0.35;
      c.save(); c.beginPath(); c.arc(sx, sy, r, 0, TAU); c.clip();
      const sg = c.createLinearGradient(0, sy - r, 0, sy + r); sg.addColorStop(0, '#fffb96'); sg.addColorStop(1, '#ff71ce');
      c.fillStyle = sg; c.fillRect(sx - r, sy - r, r * 2, r * 2);
      c.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 7; i++) { const y = sy + i * r * 0.14, th = 2 + i * 1.6; c.fillRect(sx - r, y, r * 2, th); }
      c.restore();
      // classical statue silhouette (generic bust), marble gradient
      const bs = Math.min(w, h) * 0.26;
      for (const [x, flip] of [[w * 0.12, false], [w * 0.88, true]]) {
        silPath(c, 'bust', x, hz - bs * 0.05, bs, flip);
        const mg = c.createLinearGradient(x - bs, hz - bs, x + bs, hz); mg.addColorStop(0, '#f7d6f0'); mg.addColorStop(1, '#8e7fd6');
        c.fillStyle = mg; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
      }
      // pixel stars
      for (let i = 0; i < 70; i++) { c.fillStyle = rng() < 0.5 ? '#fffb96' : '#01cdfe'; c.globalAlpha = 0.3 + rng() * 0.6; c.fillRect(rng() * w, rng() * hz * 0.5, 2, 2); }
      c.globalAlpha = 1;
      S.sky = L; S.hz = hz;
      const sl = layer(w, h), sc = sl.getContext('2d');
      sc.fillStyle = 'rgba(0,0,0,.14)'; for (let y = 0; y < h; y += 3) sc.fillRect(0, y, w, 1);
      S.scan = sl;
    },
    draw(ctx, S, t, dt, R) {
      const { w, h, hz, dpr } = S;
      ctx.drawImage(S.sky, 0, 0);
      ctx.fillStyle = '#12051f'; ctx.fillRect(0, hz, w, h - hz);
      // perspective grid
      ctx.strokeStyle = '#ff71ce'; ctx.lineWidth = 1.2 * dpr; ctx.globalAlpha = 0.8;
      ctx.beginPath();
      const vx = w / 2;
      for (let i = -24; i <= 24; i++) { ctx.moveTo(vx + i * 4, hz); ctx.lineTo(vx + i * w * 0.09, h); }
      const speed = S.animate ? t * 0.35 : 0;
      for (let k = 0; k < 18; k++) {
        const z = ((k + (speed % 1)) / 18);
        const y = hz + Math.pow(z, 2.2) * (h - hz);
        const rip = R.kick * 6 * dpr * Math.sin(z * 18 - t * 8) * z;
        ctx.moveTo(0, y + rip); ctx.lineTo(w, y + rip);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
      const glow = ctx.createLinearGradient(0, hz - 6, 0, hz + 30); glow.addColorStop(0, 'rgba(1,205,254,0)'); glow.addColorStop(0.3, rgba('#01cdfe', 0.35 + R.energy * 0.3)); glow.addColorStop(1, 'rgba(1,205,254,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, hz - 6, w, 36);
      ctx.drawImage(S.scan, 0, 0);
      // occasional VHS noise strip (scaled by the glitch setting)
      if (S.animate && S.glitch > 0.05 && (Math.sin(t * 0.7) > 0.97 || R.snare > 0.7)) {
        const y = (t * 140) % h;
        ctx.globalAlpha = 0.12 * S.glitch; ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * w, y + Math.random() * 14, 10 + Math.random() * 40, 1);
        ctx.globalAlpha = 1;
      }
    },
  },

  /* ------------------------------ 09 BRUTALIST ------------------------ */
  brutalist: {
    init(S) {
      const { w, h, rng } = S, L = layer(w, h), c = L.getContext('2d');
      c.fillStyle = '#a9a6a0'; c.fillRect(0, 0, w, h);
      // board-formed concrete slabs
      const slabs = [[0, 0, w * 0.42, h * 0.38, '#b4b1aa'], [w * 0.42, 0, w * 0.58, h * 0.22, '#9d9a94'], [w * 0.7, h * 0.22, w * 0.3, h * 0.5, '#8f8c86'], [0, h * 0.38, w * 0.22, h * 0.62, '#9a978f'], [w * 0.22, h * 0.78, w * 0.78, h * 0.22, '#b8b5ae']];
      for (const [x, y, sw, sh, col] of slabs) {
        c.fillStyle = col; c.fillRect(x, y, sw, sh);
        c.strokeStyle = 'rgba(60,60,58,.18)'; c.lineWidth = 1;
        for (let yy = y + 9; yy < y + sh; yy += 9 + rng() * 4) { c.beginPath(); c.moveTo(x, yy); c.lineTo(x + sw, yy + (rng() - 0.5) * 2); c.stroke(); }
        c.fillStyle = 'rgba(40,40,38,.45)';
        for (let yy = y + 30; yy < y + sh - 10; yy += 60) for (let xx = x + 30; xx < x + sw - 10; xx += 60) { c.beginPath(); c.arc(xx, yy, 3, 0, TAU); c.fill(); }
        c.strokeStyle = 'rgba(25,25,25,.7)'; c.lineWidth = 3; c.strokeRect(x, y, sw, sh);
      }
      grain(c, w, h, rng, w * h / 10, ['#6e6c68', '#d2d0ca', '#5a5856'], 0.3, 1.5);
      blotches(c, w, h, rng, 25, ['#6a6864', '#55534f'], 20, 120, 0.25);
      // huge numerals and the single accent
      c.font = `900 ${Math.round(h * 0.42)}px 'Archivo Black', 'Arial Black', Impact, sans-serif`;
      c.fillStyle = 'rgba(18,18,18,.1)'; c.textBaseline = 'bottom'; c.fillText('09', w * 0.02, h * 1.04);
      c.fillStyle = '#ff5a1f'; c.fillRect(w * 0.7, h * 0.72, w * 0.3, 10);
      S.base = L;
    },
    draw(ctx, S, t, dt, R) {
      const { w, h } = S;
      ctx.drawImage(S.base, 0, 0);
      // a hard, directional shadow that slowly travels (like the sun moving across a facade)
      const off = ((t * 0.02) % 1) * w * 0.4;
      ctx.fillStyle = 'rgba(20,20,20,.22)';
      ctx.beginPath(); ctx.moveTo(w * 0.42 + off, 0); ctx.lineTo(w * 0.62 + off, 0); ctx.lineTo(w * 0.32 + off, h); ctx.lineTo(w * 0.12 + off, h); ctx.closePath(); ctx.fill();
      if (R.kick > 0.05) { ctx.fillStyle = rgba('#ff5a1f', R.kick * 0.8); ctx.fillRect(w * 0.7, h * 0.72, w * 0.3, 10); }
    },
  },

  /* ------------------------------ 10 STAINED GLASS -------------------- */
  stained: {
    init(S) {
      const { w, h, rng } = S, L = layer(w, h), c = L.getContext('2d');
      c.fillStyle = '#07070d'; c.fillRect(0, 0, w, h);
      const jewels = ['#2f6fd6', '#c42a4a', '#e0a526', '#2fa86b', '#8e4fd6', '#2cc2c9'];
      const pane = (path, col) => {
        const b = path.bounds, g = c.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, b.r);
        g.addColorStop(0, rgba(col, 0.75)); g.addColorStop(1, rgba(col, 0.35));
        c.fillStyle = g; c.fill(path.p);
        c.strokeStyle = '#030305'; c.lineWidth = 4; c.stroke(path.p);
      };
      // rose window (original radial design)
      const cx = w / 2, cy = h * 0.42, Rr = Math.min(w, h) * 0.55;
      const rings = [0.18, 0.4, 0.62, 0.82, 1.0], sectors = [6, 12, 12, 24, 24];
      for (let ri = 0; ri < rings.length - 1; ri++) {
        const n = sectors[ri + 1], r0 = rings[ri] * Rr, r1 = rings[ri + 1] * Rr;
        for (let k = 0; k < n; k++) {
          const a0 = k / n * TAU + (ri % 2 ? TAU / n / 2 : 0), a1 = a0 + TAU / n;
          const p = new Path2D(); p.arc(cx, cy, r1, a0, a1); p.arc(cx, cy, r0, a1, a0, true); p.closePath();
          const am = (a0 + a1) / 2, rm = (r0 + r1) / 2;
          pane({ p, bounds: { cx: cx + Math.cos(am) * rm, cy: cy + Math.sin(am) * rm, r: (r1 - r0) } }, jewels[(k + ri * 2) % jewels.length]);
        }
      }
      { const p = new Path2D(); p.arc(cx, cy, rings[0] * Rr, 0, TAU); pane({ p, bounds: { cx, cy, r: rings[0] * Rr } }, '#e0a526'); }
      // lancet windows with diamond quarries
      const lancet = (x, lw) => {
        const top = h * 0.12, bot = h * 0.95;
        const outline = new Path2D(); outline.moveTo(x, bot); outline.lineTo(x, top + lw / 2); outline.arc(x + lw / 2, top + lw / 2, lw / 2, Math.PI, 0); outline.lineTo(x + lw, bot); outline.closePath();
        c.save(); c.clip(outline);
        const q = lw / 3;
        for (let yy = top - q; yy < bot + q; yy += q) for (let xx = x - q; xx < x + lw + q; xx += q) {
          const p = new Path2D(); p.moveTo(xx + q / 2, yy); p.lineTo(xx + q, yy + q / 2); p.lineTo(xx + q / 2, yy + q); p.lineTo(xx, yy + q / 2); p.closePath();
          pane({ p, bounds: { cx: xx + q / 2, cy: yy + q / 2, r: q } }, jewels[Math.floor(rng() * jewels.length)]);
        }
        c.restore();
        c.strokeStyle = '#030305'; c.lineWidth = 8; c.stroke(outline);
      };
      const lw = Math.max(40, w * 0.07);
      lancet(w * 0.03, lw); lancet(w * 0.97 - lw, lw);
      S.base = L; S.cx = cx; S.cy = cy; S.Rr = Rr;
    },
    draw(ctx, S, t, dt, R) {
      const { w, h } = S;
      ctx.drawImage(S.base, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      const lx = w * (0.5 + Math.sin(t * 0.08) * 0.3), ly = h * (0.35 + Math.cos(t * 0.06) * 0.1);
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(w, h) * 0.6);
      g.addColorStop(0, 'rgba(255,240,200,.14)'); g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      if (R.kick > 0.05) {
        const r = (1 - R.kick) * S.Rr * 1.1;
        const k = ctx.createRadialGradient(S.cx, S.cy, Math.max(0, r - 40), S.cx, S.cy, r + 40);
        k.addColorStop(0, 'rgba(255,245,210,0)'); k.addColorStop(0.5, rgba('#fff5d2', 0.18 * R.kick)); k.addColorStop(1, 'rgba(255,245,210,0)');
        ctx.fillStyle = k; ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(5,5,10,.35)'; ctx.fillRect(0, 0, w, h); // keep the centre calm behind the UI
    },
  },

  /* ------------------------------ 11 DOUBLE EXPOSURE ------------------ */
  double: {
    init(S) {
      const { w, h, rng } = S;
      const A = layer(w, h), a = A.getContext('2d');
      const sky = a.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#eef0ea'); sky.addColorStop(0.6, '#cdd5d3'); sky.addColorStop(1, '#a9b6b6');
      a.fillStyle = sky; a.fillRect(0, 0, w, h);
      const ridge = (y, col, al, amp) => { a.fillStyle = rgba(col, al); a.beginPath(); a.moveTo(0, h); for (let x = 0; x <= w; x += 10) a.lineTo(x, y - Math.sin(x / w * 4 + amp) * h * 0.05 - Math.abs(Math.sin(x / w * 11 + amp)) * h * 0.03); a.lineTo(w, h); a.closePath(); a.fill(); };
      ridge(h * 0.7, '#6c7f92', 0.35, 1); ridge(h * 0.78, '#4e6370', 0.45, 2.2);
      const forest = (c, x0, x1, base, hMax, col, alpha) => { for (let x = x0; x < x1; x += 7 + rng() * 9) { const th = hMax * (0.4 + rng() * 0.6); c.fillStyle = rgba(col, alpha * (0.6 + rng() * 0.4)); c.beginPath(); c.moveTo(x - th * 0.18, base); c.lineTo(x, base - th); c.lineTo(x + th * 0.18, base); c.closePath(); c.fill(); } };
      forest(a, -10, w + 10, h * 1.0, h * 0.25, '#2f4a3d', 0.7);
      // portrait silhouette containing a forest (the double exposure)
      const B = layer(w, h), b = B.getContext('2d');
      const s = Math.min(w, h) * 0.55, hx = w * 0.72, hy = h * 0.55;
      b.save(); silPath(b, 'head', hx, hy, s, true); b.clip();
      const inside = b.createLinearGradient(0, hy - s, 0, hy + s); inside.addColorStop(0, '#f3f2ec'); inside.addColorStop(1, '#9fb0a8');
      b.fillStyle = inside; b.fillRect(0, 0, w, h);
      for (let k = 0; k < 4; k++) forest(b, hx - s, hx + s, hy + s * (0.2 + k * 0.25), s * (0.5 - k * 0.06), '#2f4a3d', 0.35 + k * 0.15);
      for (let k = 0; k < 6; k++) { b.fillStyle = 'rgba(243,242,236,.25)'; b.fillRect(hx - s, hy - s * 0.2 + k * s * 0.12, s * 2, s * 0.04); }
      b.restore();
      S.A = A; S.B = B;
      const G = layer(w, h), gc = G.getContext('2d'); grain(gc, w, h, rng, w * h / 18, ['#000000', '#ffffff'], 0.08, 1); S.G = G;
    },
    draw(ctx, S, t, dt, R) {
      const { w, h } = S;
      const par = S.animate ? Math.sin(t * 0.12) * 10 : 0, drift = R.kick * 18;
      ctx.drawImage(S.A, par * 0.4 - 10, 0, w + 20, h);
      ctx.globalAlpha = 0.72; ctx.drawImage(S.B, -par - drift, 0);
      ctx.globalAlpha = 0.22; ctx.drawImage(S.B, -par + drift + 8, -4);
      ctx.globalAlpha = 1;
      const mist = ctx.createLinearGradient(0, h * 0.55, 0, h); mist.addColorStop(0, 'rgba(243,242,236,0)'); mist.addColorStop(1, rgba('#f3f2ec', 0.45 + Math.sin(t * 0.3) * 0.08));
      ctx.fillStyle = mist; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(S.G, 0, 0);
    },
  },

  /* ------------------------------ 12 TILT SHIFT ----------------------- */
  tiltshift: {
    init(S) {
      const { w, h, rng } = S, L = layer(w, h), c = L.getContext('2d');
      c.fillStyle = '#7fbf6a'; c.fillRect(0, 0, w, h);
      const block = Math.max(70, Math.min(w, h) / 6), road = block * 0.22;
      S.roads = [];
      for (let y = -block / 2; y < h; y += block) S.roads.push({ dir: 'h', p: y });
      for (let x = -block / 3; x < w; x += block) S.roads.push({ dir: 'v', p: x });
      c.fillStyle = '#5d6168';
      for (const r of S.roads) r.dir === 'h' ? c.fillRect(0, r.p, w, road) : c.fillRect(r.p, 0, road, h);
      c.strokeStyle = '#f5f0d8'; c.setLineDash([6, 6]); c.lineWidth = 1.2;
      for (const r of S.roads) { c.beginPath(); r.dir === 'h' ? (c.moveTo(0, r.p + road / 2), c.lineTo(w, r.p + road / 2)) : (c.moveTo(r.p + road / 2, 0), c.lineTo(r.p + road / 2, h)); c.stroke(); }
      c.setLineDash([]);
      const roofs = ['#e2543a', '#3a7fd0', '#f4c430', '#f3f1ea', '#6fb7c9', '#c04b7a', '#ff8a3d'];
      for (let by = -block / 2; by < h; by += block) for (let bx = -block / 3; bx < w; bx += block) {
        const x0 = bx + road + 4, y0 = by + road + 4, sz = block - road - 8;
        if (rng() < 0.12) { // park
          c.fillStyle = '#5fae4f'; c.fillRect(x0, y0, sz, sz);
          for (let i = 0; i < 9; i++) { c.fillStyle = '#2f7d32'; c.beginPath(); c.arc(x0 + rng() * sz, y0 + rng() * sz, 4 + rng() * 4, 0, TAU); c.fill(); }
          continue;
        }
        const n = 2 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const bw = sz * (0.3 + rng() * 0.4), bh = sz * (0.3 + rng() * 0.4), x = x0 + rng() * (sz - bw), y = y0 + rng() * (sz - bh), ht = 3 + rng() * 9;
          c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(x + ht, y + ht, bw, bh); // oblique shadow
          c.fillStyle = roofs[Math.floor(rng() * roofs.length)]; c.fillRect(x, y, bw, bh);
          c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(x, y, bw, 2);
        }
      }
      S.sharp = L; S.soft = softBlur(L, 6); S.mid = softBlur(L, 2.5); S.block = block; S.road = road;
      S.cars = Array.from({ length: 26 }, () => { const r = S.roads[Math.floor(rng() * S.roads.length)]; return { r, pos: rng() * (r.dir === 'h' ? w : h), v: (20 + rng() * 40) * (rng() < 0.5 ? -1 : 1), col: roofs[Math.floor(rng() * roofs.length)], lane: rng() < 0.5 ? 0.28 : 0.72 }; });
    },
    draw(ctx, S, t, dt, R) {
      const { w, h, road } = S;
      let c = h * 0.5;
      if (R.kick > 0.05) c = h * (0.5 + (1 - R.kick) * 0.15 - 0.075);
      const half = h * 0.13;
      ctx.drawImage(S.soft, 0, 0);
      const fb = (top, bot, img) => { ctx.save(); ctx.beginPath(); ctx.rect(0, top, w, bot - top); ctx.clip(); ctx.drawImage(img, 0, 0); ctx.restore(); };
      fb(c - half * 2, c + half * 2, S.mid);
      // cars (moving points of light in the model)
      const drawCars = () => {
        for (const car of S.cars) {
          if (S.animate) car.pos = (car.pos + car.v * dt + (car.r.dir === 'h' ? w : h)) % (car.r.dir === 'h' ? w : h);
          const x = car.r.dir === 'h' ? car.pos : car.r.p + road * car.lane, y = car.r.dir === 'h' ? car.r.p + road * car.lane : car.pos;
          ctx.fillStyle = car.col; car.r.dir === 'h' ? ctx.fillRect(x - 5, y - 2.5, 10, 5) : ctx.fillRect(x - 2.5, y - 5, 5, 10);
        }
      };
      ctx.save(); ctx.beginPath(); ctx.rect(0, c - half, w, half * 2); ctx.clip(); ctx.drawImage(S.sharp, 0, 0); drawCars(); ctx.restore();
      // oversaturation & a light vignette for the miniature look
      ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(255,200,120,.18)'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
      const v = ctx.createLinearGradient(0, 0, 0, h); v.addColorStop(0, 'rgba(255,255,255,.18)'); v.addColorStop(0.3, 'rgba(255,255,255,0)'); v.addColorStop(0.7, 'rgba(255,255,255,0)'); v.addColorStop(1, 'rgba(255,255,255,.18)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    },
  },

  /* ------------------------------ 13 GLITCH ART ----------------------- */
  glitch: {
    init(S) {
      const { w, h, rng } = S;
      S.strips = Array.from({ length: 40 }, () => ({ y: rng() * h, h: 1 + rng() * 10, x: rng() * w, w: 30 + rng() * w * 0.4, col: ['#00ff9c', '#ff2bd6', '#00e5ff', '#f2f2f2'][Math.floor(rng() * 4)], a: 0.05 + rng() * 0.2 }));
      S.blocks = Array.from({ length: 30 }, () => ({ x: rng() * w, y: rng() * h, s: 6 + rng() * 26, col: ['#00ff9c', '#ff2bd6', '#00e5ff'][Math.floor(rng() * 3)] }));
      const sl = layer(w, h), sc = sl.getContext('2d'); sc.fillStyle = 'rgba(255,255,255,.035)'; for (let y = 0; y < h; y += 3) sc.fillRect(0, y, w, 1); S.scan = sl;
      S.next = 0;
    },
    draw(ctx, S, t, dt, R) {
      const { w, h } = S, g = S.glitch;
      ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, w, h);
      if (S.animate && t > S.next) { S.next = t + 0.25 + Math.random() * 0.6; const k = Math.floor(Math.random() * S.strips.length); S.strips[k].y = Math.random() * h; S.strips[k].x = Math.random() * w; }
      for (const s of S.strips) {
        // keep the centre band calmer: corruption lives at the edges
        const centre = Math.abs(s.y - h / 2) < h * 0.2 ? 0.35 : 1;
        ctx.globalAlpha = s.a * centre * (0.5 + g); ctx.fillStyle = s.col;
        const dx = R.kick * 30 * g * (s.h > 6 ? 1 : -1);
        ctx.fillRect(s.x + dx, s.y, s.w, s.h);
      }
      for (const b of S.blocks) {
        ctx.globalAlpha = 0.18 * (0.5 + g);
        ctx.fillStyle = '#ff2bd6'; ctx.fillRect(b.x - 3 * g, b.y, b.s, b.s);
        ctx.fillStyle = '#00e5ff'; ctx.fillRect(b.x + 3 * g, b.y, b.s, b.s);
      }
      ctx.globalAlpha = 1;
      // pixel-sorted columns at the edges
      ctx.globalAlpha = 0.2;
      for (let x = 0; x < w; x += 6) { if (Math.abs(x - w / 2) < w * 0.3) continue; const hh = (Math.sin(x * 0.07 + t * 0.4) * 0.5 + 0.5) * h * 0.25; ctx.fillStyle = x % 12 ? '#00ff9c' : '#ff2bd6'; ctx.fillRect(x, h - hh, 5, hh); }
      ctx.globalAlpha = 1;
      ctx.drawImage(S.scan, 0, 0);
    },
  },
};

/* ====================================================================== */
/* Controller                                                              */
/* ====================================================================== */
export class Backdrop {
  constructor(canvas, { getReactive }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.getReactive = getReactive;
    this.opts = { motion: 'full', quality: 'high', enabled: true, glitch: 0.5 };
    this.theme = null;
    this.S = null;
    this.t = 0;
    this.running = false;
    this._loop = this._loop.bind(this);
    this._onResize = () => this._rebuild();
    window.addEventListener('resize', debounce(this._onResize, 150));
  }

  get animated() { return this.opts.enabled && this.opts.motion === 'full'; }

  setOptions(o) {
    const rebuild = 'quality' in o && o.quality !== this.opts.quality;
    Object.assign(this.opts, o);
    if (this.S) this.S.glitch = this.opts.glitch;
    if (rebuild) this._rebuild();
    if (this.animated) this.start(); else { this.stop(); this.renderOnce(); }
  }

  setTheme(theme) {
    // Crossfade from the old world: capture the current frame.
    if (this.S && this.canvas.width) {
      this.prev = layer(this.canvas.width, this.canvas.height);
      this.prev.getContext('2d').drawImage(this.canvas, 0, 0);
      this.fade = 1;
    }
    this.theme = theme;
    this._rebuild();
  }

  _rebuild() {
    if (!this.theme) return;
    const scale = this.opts.quality === 'low' ? 0.55 : Math.min(window.devicePixelRatio || 1, 1.25);
    const w = Math.round(window.innerWidth * scale), h = Math.round(window.innerHeight * scale);
    this.canvas.width = w; this.canvas.height = h;
    const R = BACKDROPS[this.theme.background.renderer];
    this.S = { w, h, dpr: scale, rng: mulberry32(1337), palette: this.theme.palette, glitch: this.opts.glitch, animate: this.animated };
    R.init(this.S);
    this.renderer = R;
    if (!this.running) this.renderOnce();
  }

  renderOnce() {
    if (!this.S) return;
    this.S.animate = false;
    this.fade = 0;
    this.renderer.draw(this.ctx, this.S, this.t, 0, { bass: 0, mid: 0, high: 0, energy: 0, kick: 0, snare: 0 });
  }

  start() {
    if (this.running || !this.animated) return;
    this.running = true; this.last = performance.now(); this.acc = 0;
    this._raf = requestAnimationFrame(this._loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this._raf); }

  _loop(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);
    const fps = (this.theme.background.fps || 24) * (this.opts.quality === 'low' ? 0.6 : 1);
    const dt = (now - this.last) / 1000;
    if (dt < 1 / fps) return;
    this.last = now;
    const step = Math.min(0.1, dt);
    this.t += step;
    this.S.animate = true;
    this.renderer.draw(this.ctx, this.S, this.t, step, this.getReactive());
    if (this.fade > 0 && this.prev) {
      this.fade = Math.max(0, this.fade - step / 0.7);
      this.ctx.globalAlpha = this.fade; this.ctx.drawImage(this.prev, 0, 0, this.S.w, this.S.h); this.ctx.globalAlpha = 1;
      if (!this.fade) this.prev = null;
    }
  }
}

/** Static procedural thumbnail for a theme card (same renderers, tiny canvas). */
export function renderThumbnail(theme, canvas) {
  const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d');
  const S = { w, h, dpr: 0.5, rng: mulberry32(7), palette: theme.palette, glitch: 0.5, animate: false };
  const R = BACKDROPS[theme.background.renderer];
  R.init(S);
  R.draw(ctx, S, 3, 0, { bass: 0, mid: 0, high: 0, energy: 0, kick: 0, snare: 0 });
}

function debounce(fn, ms) { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; }
