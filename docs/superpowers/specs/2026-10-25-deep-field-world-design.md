# World 15 · Deep Field: design

**Date:** 25 October 2026 · **Owner:** Ejovwo Obahor · **Status:** approved (design session, 25 Oct 2026)

## 1. Intent

Add a 15th world, **Deep Field**, a pixel-art cosmos, built from the owner's asset library without breaking the project's identity or budgets:

- **Strict no-asset rule kept.** No image, model or audio files ship. Two kinds of borrowed work are allowed:
  - code ported from MIT-licensed shaders (Deep-Fold "Pixel Planets" and "Space Background");
  - edge data baked offline from CC0 3D models (Quaternius) and committed as code.
- **Startup budget kept** (≤ 335 KB JS/CSS). The new world loads lazily as a *world pack*.
- **Success:**
  - Deep Field is selectable like any other world.
  - It renders crisp pixel planets and a hologram of recognisable ships and robots.
  - Every existing test passes, plus the new checks.
  - Startup stays within budget and the backdrop stays ≤ 3 ms/frame.

Out of scope: moving the existing 14 worlds into packs, worlds 16–20, the World Creator and the Shape Encyclopedia.

## 2. The world

| Field | Value |
|---|---|
| id / num | `deepfield` / `15` |
| name / tagline | Deep Field / Pixel Cosmos |
| mood | A lone observatory drifting past pixel planets. |
| palette (A, Amber/Teal) | bg `#0b0a1f`, surface `#1a1736`, primary `#ffb454`, secondary `#5fe1d6`, accent `#e05ca8`, text `#f1ecff`, muted `#b4acd9`. Final values must pass the `smoke_test.py` contrast checks; adjust lightness only, keep the hues |
| fonts | display **Silkscreen** (headings only), body **Pixelify Sans** (≥ 15 px), mono **VT323**, all from Google Fonts; registered in `theme-registry.js` and `font-loader.js` (`SPECS` + `WORLDS`) |
| panel | radius `0`, 2 px solid border, hard `4px 4px 0 #000` shadow, no blur |
| ornament | `[data-theme="deepfield"]` in `css/themes.css`; also `font-variant-ligatures: none`, because Silkscreen otherwise ligates "fi" |

### 2.1 Backdrop (`deepfield` renderer)

Ported from the Deep-Fold shaders: tiled `rand`/`noise`/`fbm`, `spherify`, light distance bands, 2×2 dither.

- **Rendering:** at ¼ of the viewport, upscaled with `imageSmoothingEnabled = false`; 24 fps (`background.fps: 24`).
- **Static layers, built in `init()` in the worker:**
  - a dithered nebula, using fbm quantised to 6 palette steps with a 4×4 Bayer matrix;
  - a 1 px starfield;
  - a small spiral galaxy, which is dropped on low quality.
- **Planet noise tables, also built in `init()`:** the planet's tiled fbm sampled into `Float32Array`s. Per frame, `draw()` only looks values up in these tables; it never computes fbm.
- **Animated parts, in `draw()`:**
  - a large terran planet, upper left: ocean bands, a landmass from 4 stacked fbm lookups offset toward the light, and a drifting cloud layer;
  - a small ringed gas giant, upper right: banded fbm, a back and front ring;
  - "+" twinkle stars;
  - a slow asteroid drift.
- **Reactivity:** on a kick, extra twinkles fire, but only when the mode is real audio or the beat clock.
- **Reduced or Static motion:** planets frozen, no twinkle, no asteroids.

### 2.2 Hologram

- **Forms:** 20 baked forms plus 4 procedural ones. All are selectable.
  - **Baked ships (11, Ultimate Spaceships):** Bob, Challenger, Dispatcher, Executioner, Imperial, Insurgent, Omen, Pancake, Spitfire, Striker, Zenith.
  - **Baked robots (9):**
    - George, Leela, Mike and Stan (Animated Mech Pack);
    - Robot (Animated Robot);
    - Mech Barbara, Fernando, Finn and Rae (Ultimate Space Kit).
  - **Procedural (4):** `df-ringed-planet`, `df-blackhole` (accretion disc), `df-galaxy` (point cloud), `df-orbits` (orbit rings).
- **Auto-morph pool** (`hologram.forms`, 8 forms): ship-omen, ship-zenith, ship-striker, ship-spitfire, ship-dispatcher, ship-executioner, robot-george, robot-robot.
  - The other 16 are listed in a new registry field, `hologram.extraForms`, so they can be chosen manually but aren't auto-picked.
  - If the engine and Experience validation only accept `forms`, extend `validate`/`morph(id)` to accept `forms ∪ extraForms`.
- **Material:** `point: 'pixel'`, a new point style. Points snap to integer device pixels at the stage's pixel size, and links draw as Bresenham-style pixel lines.
  - Colour: stepped depth palette `['#f1ecff', '#5fe1d6', '#2f8f9e', '#e05ca8']`, `colorMode: 'depth'`.
  - Glow: `glow: 0`; no blur.
- **Motion:** `rotate 0.22`, `tilt 0.45`, `morph 1.6`.
  - Robot forms carry `upright: true`, and the engine eases the tilt toward 0.18 for them.
  - If adding the upright tilt would complicate the engine, the fallback is a pre-rotation applied at bake time.
- **Transition:** `pixel-dissolve`, a new transition. Each point jumps from its old position to its new one at its own moment, staggered by a golden-ratio offset of its index.
  - In Reduced/Static motion it falls back to the existing crossfade.
- **Reactions:**
  - kick: `pixel-shockwave`, a ring of snapped pixels;
  - snare: `scanline-flash`, which becomes a dim pulse under Reduce flashing and honours the minimum flash gap;
  - high: `star-sparks`.
  - Reuse existing reaction implementations where one matches; add new ones only where none does.
- **Particles:** `{ kind: 'spark', colors: ['#ffb454', '#5fe1d6', '#f1ecff'], rate: 10 }`.

## 3. Architecture: world packs

### 3.1 Files

| File | Startup? | Role |
|---|---|---|
| `js/theme-registry.js` | yes | Deep Field's entry with `pack: 'deepfield'`; all presentation data stays here, so contrast tests and cards work |
| `js/world-packs.js` (new, ~0.6 KB) | yes | `ensurePack(theme)`: does the `import()` once, then calls `registerPack(pack)`, which merges `pack.backdrop` into `BACKDROPS` and `pack.forms` into `FORMS`. Resolves immediately when the world has no `pack` |
| `js/worlds/deepfield.js` (new) | no | `export const backdrop = { init, draw }` and `export const forms = { …procedural…, …decoded baked… }` |
| `js/worlds/deepfield-baked.js` (new, generated) | no | `export const BAKED = [{ id, label, credit, upright, data }]`; header says it's generated by `tools/bake_forms.py` and must not be edited by hand |

`forms.js` and `backdrops.js` export their registries as mutable objects (they already are), so the existing synchronous lookups keep working once a pack is registered.

### 3.2 Flow

1. The world-change handler in `app.js` (currently `engine.setTheme(theme); backdrop.setTheme(theme);`) becomes:
   `const seq = ++worldSeq; await ensurePack(theme); if (seq !== worldSeq) return; engine.setTheme(theme); backdrop.setTheme(theme);`.
   `theme-manager` still applies the CSS palette immediately, and it still never calls the player.
2. **Worker:** `init` and `thumb` messages include `pack` (or `null`). The worker keeps its own `ensurePack` cache: `await import('../worlds/<pack>.js')` and register it before using `BACKDROPS[renderer]`. The main-thread fallback (`_install`, `renderThumbnail`) runs only after `ensurePack` has resolved.
3. **Thumbnails** are already drawn lazily through an `IntersectionObserver`, so the pack is fetched only when Deep Field's card is near the viewport.
4. **Experiences and share links:** `validate` checks form ids against the registry (`forms ∪ extraForms`), so the pack isn't needed for validation. Applying an Experience goes through the same world-change path, so the pack loads first.

### 3.3 Failure handling

- If `ensurePack` rejects (offline on a first visit, or a network error):
  - the world switch is reverted to the previous world through `themeManager.apply(prev, 'system')`;
  - a toast shows: "Couldn't load Deep Field. Check your connection and try again.";
  - the failed import is cleared from the cache so a retry can work.
- **Worker import failure:** reply with `type: 'error'`. The existing fallback path then calls the main-thread `ensurePack` and draws there.

### 3.4 Offline and budget

- Add `js/world-packs.js`, `js/worlds/deepfield.js` and `js/worlds/deepfield-baked.js` to `SHELL` in `sw.js`.
- **Startup increase:** ~1.4 KB (registry entry) + ~0.6 KB (loader) + ~0.3 KB (font-loader spec). Offset it by collapsing banner comments in `backdrops.js` and `forms.js` until `features_test.py` reports ≤ 335 KB with at least 0.5 KB of headroom.

## 4. Baking tool

- **`tools/bake_forms.py`:** an authoring tool, never deployed, written in standard-library Python only.
- **Run:** `python tools/bake_forms.py --assets "<Design Assets folder>" [--preview out.png]`. The preview needs Pillow if present; skip it otherwise.
- **Manifest:** `tools/forms-manifest.json`, an array of `{ id, label, src, credit, angle = 50, edges = 150, rotate = [rx, ry, rz] (degrees), upright = false }`.
- **Algorithm:**
  1. Parse the OBJ `v`/`f` lines; triangulate faces as fans.
  2. Merge vertices rounded to 1e-4.
  3. Feature edges are boundary edges, plus edges whose two face normals' dot product is below `cos(angle)`.
  4. Keep the `edges` longest feature edges.
  5. Apply `rotate`; centre on the bounding-box midpoint; scale so the largest absolute coordinate is 1.1.
  6. Quantise to Int8 (`round(v / 1.1 * 127)`, decode `v = q / 127 * 1.1`).
  7. Write `data` as base64 of `[x0,y0,z0,x1,y1,z1]` per edge.
- **Decoding** (in `deepfield.js`): each edge becomes a two-point path `P([[x0,y0,z0],[x1,y1,z1]])`. `buildForm` then resamples all paths by length, which gives morphing and the link flags with no special cases.
  - If `buildForm`'s `maxLines = floor(remaining / 2)` would drop edges, merge collinear or connected edges into polylines in the tool so the path count stays ≤ N/2.
- **Validation (fail loudly):** no NaN, extent ≤ 1.3, at least 40 edges, and the id is unique and kebab-case.
- **Tuning:** robots start at `edges: 250`; adjust `rotate`/`upright` per model using the preview contact sheet.
- **Credits:** README line "Hologram forms in Deep Field are traced from CC0 models by Quaternius (quaternius.com)"; the pitch wording becomes "no image or audio assets".
- **Excluded sources:** "Mechs & Robots" (no licence file), SFCP (CC BY-NC) and CraftPix packs.

## 5. Testing

- **`features_test.py`:**
  - startup budget ≤ 335 KB;
  - no `/worlds/` request at startup on the default world;
  - selecting Deep Field loads the pack and renders both the hologram and the backdrop;
  - a forced pack failure (route abort) reverts the world and shows a toast;
  - a `#world=deepfield&form=ship-omen` share link round-trips.
- **`smoke_test.py`:**
  - world count 15;
  - contrast checks for Deep Field;
  - every Deep Field form (baked and procedural) builds with no NaN, extent ≤ 1.3 and N points;
  - a ship → procedural morph completes.
  - Update the hard-coded counts (worlds, forms) in tests, `README.md` and `CLAUDE.md`.
- **`optimization_test.py`:** `SHELL` matches the shipped files, and the Deep Field backdrop costs ≤ 3 ms/frame.
- **`spotify_mock_test.py`:** unchanged; must still pass.
- **Screenshots:** Deep Field on desktop 1440×900 and mobile 390×844, plus one existing world as a regression check; review them by eye.

## 6. Risks

- **Pixel point style in the engine:** the material code may assume round dots and glow. Add `'pixel'` as a separate branch; don't touch the existing ones.
- **Worker dynamic import:** module workers support `import()` in all target browsers. The main-thread fallback covers the rest.
- **Budget headroom is tight:** measure after each startup-file change, not only at the end.
