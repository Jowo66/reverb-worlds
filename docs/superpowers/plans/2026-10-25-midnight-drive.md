# Midnight Drive Implementation Plan

> Executed inline (superpowers:executing-plans). Owner pre-approved ("push it live").

**Goal:** ship world 16 "Midnight Drive" as a lazy world pack.
**Spec:** `docs/superpowers/specs/2026-10-25-midnight-drive-world-design.md`

## Global Constraints
- No image/audio files; startup JS/CSS ≤ 335 KB; backdrop ≤ 3 ms/frame; `init` worker-safe.
- Every shipped file in `sw.js` SHELL. Fonts in both registry and `font-loader.js`.
- Reduced motion: no boot, still backdrop; Reduce flashing honoured.
- Tests: all four browser suites + bake unit tests; smoke "no JavaScript errors (desktop)" is the known external Spotify failure.

## Review Focus
1. A share link or favourite naming a Midnight/Deep Field form before the pack loads (must open that form, not a random one or an error).
2. Info panel opened while a pack is loading (must not throw).
3. Boot intro replaying on resize or quality change (it must not: the session flag is set when it starts).
4. Backdrop on a tiny viewport (mobile 390 px) and at 4K: art canvas bounds, no negative sizes.
5. Pack load failure while Auto-world runs (existing deferred minor; must not get worse).

### Task 1: packs carry their hologram settings
Files: `js/world-packs.js`, `js/theme-registry.js`, `js/experience.js`, `js/features/info-panel.js`, `js/worlds/deepfield.js`, `tests/smoke_test.py`, `tests/features_test.py`.
- Tests first (features): `THEME_BY_ID.deepfield.hologram` is undefined at startup and `formIds` matches `ship-omen`; `validate({world:'deepfield', form:'ship-omen'})` keeps the form before the pack loads; after `ensurePack`, `theme.hologram.forms.length === 33`. Smoke pool-size check loads packs first.
- `ensurePack`: `if (m.hologram) theme.hologram = m.hologram`.
- `validate` / `worldOfForm`: `theme.hologram?.forms.includes(id) || theme.formIds?.test(id)`.
- Info panel: hologram fields from `A.engine.theme`.

### Task 2: engine reactions
File: `js/hologram/hologram-engine.js`.
- Tests first: `_react` with a world whose reactions are `{kick:'headlight-flare', snare:'poly-jitter'}` adds a `flash` effect (and none inside the reduce-flashing gap) and sets `env.jit` (only in full motion).
- `headlight-flare`: `env.pulse = 0.5`; if `flashOk()` add flash `#ffd9a0`, alpha `0.22·I`, `oy: 0.25`, `r: 0.9`.
- `poly-jitter`: if full, `env.jit = g` (glitch-scaled). In `project`, when `env.jit > 0.03` and full motion, offset each projected point by `(Math.random()-0.5)·jit·5·dpr`.

### Task 3: the Midnight pack, registry, chrome
Files: `js/worlds/midnight.js`, `js/worlds/midnight-baked.js` (generated), `js/theme-registry.js`, `js/font-loader.js`, `css/themes.css`, `sw.js`, `index.html`, `js/features/tour.js`.
- Tests first: pack exports 23 forms (20 baked with credits + 3 procedural), each builds at N=320/720 (finite, extent ≤ 1.3); clicking the card loads the pack and shows a `psx-` form; cold start `#world=midnight&form=psx-taxi`; pack failure reverts with toast; worlds count says 16.

### Task 4: backdrop + boot intro
File: `js/worlds/midnight.js`.
- Tests first: backdrop ≤ 3 ms/frame at 480×270 and 3200×1800; boot plays on first full-motion entry (`S.boot` active, then done after ~2.2 s) and not again in the same session; no boot when `animate` is false (reduced motion, thumbnails).

### Task 5: docs, screenshots, deploy
README, CLAUDE.md, docs/WORLDS.md, counts; desktop + mobile screenshots; merge, push, verify live.
