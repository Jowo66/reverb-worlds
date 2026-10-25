# Deep Field (World 15) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship world 15, *Deep Field* (a pixel cosmos), as a lazily-loaded world pack. It gets a ported Deep-Fold planet backdrop and 24 hologram forms, 20 of them baked offline from CC0 Quaternius models.

**Architecture:**
- A new startup module, `js/world-packs.js`, imports `js/worlds/<id>.js` on demand and registers the pack's backdrop renderer into `BACKDROPS` and its forms into `FORMS`. The existing synchronous lookups therefore keep working.
- An offline, standard-library-only Python tool (`tools/bake_forms.py`) turns OBJ meshes into Int8 polyline data. The output is committed as `js/worlds/deepfield-baked.js`.
- Engine additions: a `'pixel-grid'` point style, a `'pixel-dissolve'` transition, an `upright` tilt for robots, and three reactions. All are additive branches.

**Tech Stack:**
- Site: plain ES modules, Canvas 2D, OffscreenCanvas worker.
- Tests: Python 3 and Playwright (Chromium), plus `unittest` for the tool.

**Spec:** `docs/superpowers/specs/2026-10-25-deep-field-world-design.md`

## Global Constraints

- No image, model or audio files ship. Baked edge data is committed as JS; the tool is never deployed (the deploy copies only `index.html sw.js css js assets`).
- No build step at runtime; no new runtime dependencies.
- Startup JS/CSS ≤ **335 KB** raw, measured by `features_test.py`. Keep ≥ 0.5 KB headroom.
- Backdrop ≤ **3 ms/frame**; 60 fps target. `init()` is worker-safe: it uses only `layer()` and plain data, never `document`/`window`. `draw()` only reads layers.
- Every shipped file goes in `SHELL` in `sw.js`.
- Fonts go in both `theme-registry.js` and `font-loader.js` (`SPECS` + `WORLDS`).
- Palette passes the `smoke_test.py` contrast checks. Reduced/Static motion: no glitch, tearing or inertia. Honour Reduce flashing.
- `theme-manager.js` never calls the player.
- Deep Field ids: world `deepfield`, num `15`, renderer `deepfield`, pack `deepfield`. Form ids: `ship-<name>` and `robot-<name>` (kebab-case, lower-case); procedural ids `df-ringed-planet`, `df-blackhole`, `df-galaxy`, `df-orbits`.
- Palette A: bg `#0b0a1f`, surface `#1a1736`, primary `#ffb454`, secondary `#5fe1d6`, accent `#e05ca8`, text `#f1ecff`, muted `#b4acd9`. Adjust lightness only if contrast fails.
- Excluded sources: "Mechs & Robots" (no licence), SFCP (CC BY-NC) and CraftPix packs.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Switching worlds quickly while the pack is still loading** (e.g. pressing → twice): the last world chosen must win. No stale `engine.setTheme` from an earlier world. → Task 3, check "rapid switch ends on the last world".
2. **A first visit while offline, or the pack request failing:** the world reverts to the one that was showing, a toast explains why, and a later retry works. → Task 3, checks "pack failure reverts + toast" and "retry after failure loads".
3. **A share link or saved session pointing straight at Deep Field (cold start):** the pack loads before the first `engine.setTheme`, and the form from the link is shown. → Task 3, check "cold start via #world=deepfield&form=ship-omen".
4. **Low quality tier (N = 320):** every baked form still builds without dropping paths; path count ≤ 140. → Task 1 (tool validation) and Task 2 (`buildForm` at N = 320).
5. **Reduced motion and Reduce flashing in Deep Field:** the morph is a crossfade, the backdrop is still, and the snare doesn't flash. → Task 4, check "deepfield reduced: crossfade + still backdrop + no flash".

---

### Task 0: Test environment baseline

**Files:** none (environment only)

- [ ] **Step 1:** `python -m pip install playwright && python -m playwright install chromium`
- [ ] **Step 2:** From the parent folder (`Reverb Worlds/`), start the server in the background: `python -m http.server 8765 --bind 127.0.0.1`. Note its PID (stop it by PID, never with `pkill -f`).
- [ ] **Step 3:** Run all four suites against `http://127.0.0.1:8765/reverb-worlds/`. Expected: smoke 101, spotify_mock 41, optimization 23 and features 47, all PASS. Record the startup budget figure that `features_test.py` prints. If anything fails on unchanged `main`, stop and report it.

### Task 1: Baking tool and baked forms

**Files:**
- Create: `tools/bake_forms.py`, `tools/forms-manifest.json`, `tests/test_bake_forms.py`
- Create (generated): `js/worlds/deepfield-baked.js`

**Interfaces:**
- Produces, in `tools/bake_forms.py`:
  - `load_obj(path) -> (verts: list[tuple3], tris: list[tuple3])`
  - `feature_edges(verts, tris, angle_deg) -> list[tuple[int,int]]`
  - `bake(path, angle=50, edges=150, rotate=(0,0,0)) -> list[list[tuple3]]` (polylines, scaled to extent 1.1)
  - `encode(polylines) -> str` (base64)
  - `decode(b64) -> list[list[tuple3]]`
  - `validate(id, polylines)` raises `ValueError`
- Produces, in `js/worlds/deepfield-baked.js`: `export const BAKED = [{ id, label, credit, upright, data }]`, 20 entries.
- Encoding: Int8 values; per polyline a count byte `n` (2–127), then `n × (x,y,z)`, each `round(v / 1.1 * 127)`. Decode: `v = q / 127 * 1.1`.

- [ ] **Step 1: Write failing tests** in `tests/test_bake_forms.py` (`unittest`, using a temp-file cube OBJ written in the test):
  - `test_cube_feature_edges`: a unit cube (8 vertices, 12 triangles) → `feature_edges(..., 50)` returns exactly 12 edges (the face diagonals are excluded because they lie on flat faces).
  - `test_bake_extent`: `bake(cube)` → max |coord| over all points is within 1e-6 of 1.1.
  - `test_roundtrip`: `decode(encode(p))` matches `p` within 1.1/127 per coordinate, with equal polyline counts and lengths.
  - `test_chaining`: a cube's 12 edges chain into ≤ 6 polylines.
  - `test_validate_rejects`: `validate('Bad Id', p)` raises; a polyline set with 141 polylines raises; NaN raises; fewer than 40 total edges raises *unless* the id starts with `test-`. Use that prefix for the cube.
- [ ] **Step 2:** Run `python -m unittest tests/test_bake_forms.py -v`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `tools/bake_forms.py`.**
  - Follow the spec's §4 algorithm. Merge vertices by rounding to 1e-4. Keep the `edges` longest feature edges.
  - Chaining is a greedy walk: start from an unused edge, extend from either end through any unused edge that shares the vertex, and stop at 127 points.
  - CLI: `--assets <dir>`, `--manifest tools/forms-manifest.json`, `--out js/worlds/deepfield-baked.js`, `--preview <png>`. The preview is optional: a 5-column contact sheet using Pillow, skipped with a message if Pillow is missing.
  - Output file header: `// GENERATED by tools/bake_forms.py from tools/forms-manifest.json; do not edit by hand.` followed by a credit line.
- [ ] **Step 4:** Run the tests. Expected: all PASS.
- [ ] **Step 5: Write `tools/forms-manifest.json`** with 20 entries. Paths are relative to `--assets`.
  - **Ships:** `Ultimate Spaceships - May 2021/<Name>/OBJ/<Name>.obj` for Bob, Challenger, Dispatcher, Executioner, Imperial, Insurgent, Omen, Pancake, Spitfire, Striker, Zenith. Ids `ship-bob` … `ship-zenith`; `edges: 150`.
  - **Robots:**
    - `Animated Mech Pack - March 2021/Flat Colors/OBJ/{George,Leela,Mike,Stan}.obj`;
    - `Animated Robot - Oct 2018/OBJ/Robot.obj`;
    - `Ultimate Space Kit - March 2023/Characters/OBJ/Mech_{BarbaraTheBee,FernandoTheFlamingo,FinnTheFrog,RaeTheRedPanda}.obj`.
    - Ids `robot-george` … `robot-robot`, `robot-mech-barbara`, `robot-mech-fernando`, `robot-mech-finn`, `robot-mech-rae`. Labels "Mech Barbara" etc.
    - Settings: `edges: 250`, `upright: true`.
  - **Credit:** `"Quaternius (CC0)"` for all.
- [ ] **Step 6:** Run `python tools/bake_forms.py --assets "C:/Users/User/Desktop/Design Assets" --preview <scratch>/bake.png`. Open the PNG.
  - Any robot that reads sideways or lying down gets a `rotate` fix in the manifest; re-run until all 20 read upright and recognisable.
  - Expected: 20 OK lines, every form ≤ 140 polylines, and the output file is below 45 KB.
- [ ] **Step 7:** Commit the `tools/` files, `tests/test_bake_forms.py` and `js/worlds/deepfield-baked.js`. Message: `Deep Field: offline bake tool (OBJ → Int8 polylines) + 20 baked CC0 forms`.

### Task 2: The Deep Field pack module (forms and backdrop)

**Files:**
- Create: `js/worlds/deepfield.js`
- Modify: `js/hologram/forms.js` (`buildForm` returns `upright`)
- Test: `tests/features_test.py` (new checks, in their own block after the existing ones)

**Interfaces:**
- Consumes: `BAKED` (Task 1); `mulberry32` and `FORMS` from `../hologram/forms.js`.
- Produces:
  - `export const forms`: an object of `{ [id]: { label, upright?, build(rng, N) → paths } }` with 24 ids.
  - `export const backdrop = { init(S), draw(ctx, S, t, dt, r) }`.
  - `buildForm(...)` now returns `upright: !!def.upright` as well.
- Decode lives in this module as a small `decode(b64)`, the JS twin of Task 1's. Use `atob` (available in worker and window). Each polyline becomes `{ pts, closed: false }`.

- [ ] **Step 1: Write failing checks** in `features_test.py`, run in the page with dynamic imports (`await import('./js/worlds/deepfield.js')`, `await import('./js/hologram/forms.js')`):
  - "deepfield pack exports 24 forms (20 baked + 4 procedural)": `Object.keys(m.forms).length === 24`, and the four `df-*` ids are present.
  - "every Deep Field form builds at N=320 and N=720: no NaN, extent ≤ 1.3, exactly N points": after `Object.assign(F.FORMS, m.forms)`, call `F.buildForm(id, N, 1)` for N in [320, 720]. Check `pos.length === N*3`, all finite, and max |v| ≤ 1.3.
  - "robot forms report upright": `F.buildForm('robot-george', 320).upright === true` and `F.buildForm('ship-omen', 320).upright === false`.
  - "deepfield backdrop init+draw on OffscreenCanvas ≤ 3 ms/frame":
    - `S = { w: 480, h: 270, dpr: 0.25, rng: F.mulberry32(1337), palette: <palette A>, glitch: 0.5, animate: true }`;
    - call `m.backdrop.init(S)`, then time 60 calls of `m.backdrop.draw(ctx, S, t, 1/24, {bass:.3,mid:.3,high:.3,energy:.3,kick:.5,snare:0})`;
    - the average must be < 3 ms, and the canvas centre pixel must not be fully transparent.
- [ ] **Step 2:** Run `features_test.py`. Expected: the 4 new checks FAIL (module missing); all old checks PASS.
- [ ] **Step 3: Implement the procedural forms**, using `forms.js` helpers re-implemented locally in a compact way, or imported if they're exported. Only `mulberry32`, `SIL` and `FORMS` are exported now; don't widen `forms.js` exports except `upright`.
  - `df-ringed-planet`: a fibonacci-sphere point cloud of radius 0.55 (marked `dots: true`) plus 3 ring circles of radius 0.85, 0.97 and 1.09 in the XZ plane.
  - `df-blackhole`: a small circle at the centre plus 6 tilted ellipses with radii from 0.3 to 1.1 (accretion disc).
  - `df-galaxy`: two log-spiral arms, about 400 points, `dots: true`.
  - `df-orbits`: 4 circles tilted at different angles, each with a small "moon" circle.
- [ ] **Step 4: Implement the backdrop** following spec §2.1. Use the mockup prototype's maths, ported (rand/noise/fbm with tiling, spherify, rotate, 4×4 Bayer).
  - `init(S)` builds:
    - `S.nebula = layer(w, h)`, the dithered nebula plus stars plus a galaxy (skip the galaxy when `S.dpr < 0.2`, i.e. low quality);
    - Float32 noise tables `S.land`, `S.cloud`, `S.gas` (the size×2 by size tile, sampled 8 per unit);
    - planet layouts relative to `w`/`h`, so mobile portrait still shows both planets: terran radius `0.22*min(w,h)` at the upper left, gas giant `0.09*min(w,h)` at the upper right.
  - `draw()` steps:
    1. `drawImage(S.nebula)`;
    2. `getImageData` over each planet's bounding box only;
    3. write the planet pixels from the table lookups;
    4. `putImageData`;
    5. the ring as pixel rects;
    6. "+" twinkles (count `6 + round(r.kick * 10)`), only when `S.animate`;
    7. asteroid drift, only when `S.animate`.
  - Time only advances the planets when `S.animate`; static renders use `t = 3`.
  - `layer(w, h)` must be a local helper (OffscreenCanvas when available, else a `document` canvas), matching `backdrops.js`'s `layer`.
- [ ] **Step 5:** Run `features_test.py`. Expected: the 4 new checks PASS and the old ones still PASS.
- [ ] **Step 6:** Commit `js/worlds/deepfield.js`, `js/hologram/forms.js` and `tests/features_test.py`. Message: `Deep Field: pack module (24 forms, ported Deep-Fold backdrop)`.

### Task 3: World-pack loader, registry entry and wiring

**Files:**
- Create: `js/world-packs.js`
- Modify:
  - `js/theme-registry.js` (append the Deep Field entry);
  - `js/font-loader.js` (`SPECS`: `"Silkscreen": "Silkscreen"`, `"Pixelify Sans": "Pixelify+Sans:wght@400;600"`; `WORLDS.deepfield: ["Silkscreen", "Pixelify Sans", "VT323"]`);
  - `css/themes.css` (`[data-theme="deepfield"]` ornament);
  - `js/app.js` (world-change handler, thumbnail observer);
  - `js/hologram/backdrops.js` (`pack` in worker messages);
  - `js/hologram/backdrop-worker.js`;
  - `sw.js` (`SHELL`);
  - comment banners in `js/hologram/backdrops.js` and `js/hologram/forms.js` (budget offset).
- Test: `tests/features_test.py`, `tests/smoke_test.py`, `tests/optimization_test.py`

**Interfaces:**
- Consumes: Task 2's `forms` and `backdrop`.
- Produces: `export function ensurePack(theme): Promise<void>` in `js/world-packs.js`.
  - It resolves immediately when `!theme.pack`.
  - Otherwise it imports `./worlds/${theme.pack}.js` once (memoised per pack), then `BACKDROPS[theme.background.renderer] = m.backdrop; Object.assign(FORMS, m.forms)`.
  - On a rejected import it deletes the memo entry and rethrows.
  - It's importable from both the window and the worker; it imports only `./hologram/backdrops.js` and `./hologram/forms.js`.
- **Registry entry:** palette A plus `primaryInk`, `onPrimary` and `border` (rgba of the secondary at 0.6), chosen to pass contrast.
  - Fonts: display `'Silkscreen', 'VT323', monospace`; body `'Pixelify Sans', system-ui, sans-serif`; mono `'VT323', ui-monospace, monospace`.
  - Panel: `{ radius: '0px', borderWidth: '2px', shadow: '4px 4px 0 #000', alpha: 0.9 }`.
  - `background: { renderer: 'deepfield', fps: 24 }`, and `pack: 'deepfield'`.
  - `hologram.forms`: all 24 ids. In this task, use existing material, transition and reactions as placeholders (`point: 'pixel'`, `transition: 'pixel-sort'`, reactions `grid-ripple` / `rgb-scan` / `sparkle-wave`); Task 4 swaps in the new ones.
  - `motion: { rotate: 0.22, tilt: 0.45, morph: 1.6 }`; particles `{ kind: 'spark', colors: ['#ffb454', '#5fe1d6', '#f1ecff'], rate: 10 }`.
  - `a11y: {}`; mood "A lone observatory drifting past pixel planets."

- [ ] **Step 1: Write failing checks.**
  - **`smoke_test.py`:**
    - change "14 world cards rendered" to 15;
    - the existing contrast loop covers Deep Field automatically; confirm it includes `deepfield` in its printed list.
  - **`optimization_test.py`:** the offline check's card count goes from 14 to 15.
  - **`features_test.py`:**
    - "no /worlds/ request at startup on the default world": `not any('/js/worlds/' in u for u in reqs)` from the startup request log.
    - "selecting Deep Field loads the pack and renders": click the Deep Field card, then wait for `__reverb.engine.toForm.id` to start with `ship-`/`robot-`/`df-`. Also check `__reverb.backdrop.renderer` is the registered pack backdrop: `__reverb.backdrop.theme.id === 'deepfield'` and the backdrop canvas centre pixel isn't black.
    - "rapid switch ends on the last world": run `themeManager.apply('deepfield')` then immediately `themeManager.apply('aero')` in one `evaluate`, wait 1.5 s, then assert `engine.theme.id === 'aero'` and `backdrop.theme.id === 'aero'`. Use a fresh page, so the pack isn't cached in memory.
    - "pack failure reverts + toast": use a fresh context with `route('**/js/worlds/deepfield.js', abort)`. Starting from aero, apply deepfield. Within 3 s, `documentElement.dataset.theme === 'aero'` and the `#toast` text contains "Couldn't load Deep Field".
    - "retry after failure loads": then `unroute`, apply deepfield again, and expect `engine.theme.id === 'deepfield'`.
    - "cold start via #world=deepfield&form=ship-omen": a fresh page at `BASE + '#world=deepfield&form=ship-omen'` → `engine.theme.id === 'deepfield'` and `engine.toForm.id === 'ship-omen'`.
    - "Deep Field thumbnail draws": scroll Deep Field's card into view, then wait for its canvas `dataset.thumb` to be set (`'worker'`, `'cache'` or the fallback's absence-of-error); its centre pixel isn't transparent.
- [ ] **Step 2:** Run the three suites. Expected: the new and changed checks FAIL; everything else PASSES.
- [ ] **Step 3: Implement.**
  - **`app.js`:**
    - Keep `let shownTheme = null, worldSeq = 0`. The `change` handler updates the text fields immediately, then:
      ```js
      const seq = ++worldSeq;
      ensurePack(theme).then(() => {
        if (seq !== worldSeq) return;
        engine.setTheme(theme); backdrop.setTheme(theme); shownTheme = theme;
      }, () => {
        if (seq !== worldSeq) return;
        toast(`Couldn't load ${theme.name}. Check your connection and try again.`, 4000);
        if (shownTheme) themeManager.apply(shownTheme.id, 'revert');
      });
      ```
    - The rest of the handler (cards' `aria-pressed`, `replaceState`, auto toast) runs as before.
    - The cold-start Experience/hash application must call `engine.morph(form)` only after the pack is loaded. Do it by applying the form inside the same `.then` when the change source is `'url'` or `'init'` with a pending form; trace how `experience.apply` triggers its morph and wire the minimal change.
    - Thumbnail observer: `ensurePack(t).then(() => requestThumbnail(...)).catch(() => {})`.
  - **`backdrops.js`:** `_rebuild` adds `pack: this.theme.pack || null` to the `init` message; `requestThumbnail` adds `pack: theme.pack || null`.
  - **`backdrop-worker.js`:** import `ensurePack` from `../world-packs.js`. In both handlers, `await ensurePack({ pack: data.pack, background: { renderer: data.renderer } })` before using `BACKDROPS`. `init` becomes async; keep the existing error reply.
  - **`sw.js` `SHELL`:** add `js/world-packs.js`, `js/worlds/deepfield.js`, `js/worlds/deepfield-baked.js` in alphabetical position.
  - **`css/themes.css`:** `[data-theme="deepfield"] { font-variant-ligatures: none; }` plus `image-rendering: pixelated` on the backdrop canvas when `[data-theme="deepfield"]`. Use the backdrop canvas's existing selector.
  - **Budget offset:** collapse multi-line banner comments at the top of `backdrops.js` and `forms.js` into one line each, and any per-section banners, until the startup figure is ≤ 334.5 KB.
- [ ] **Step 4:** Run all four suites. Expected: all PASS, startup ≤ 334.5 KB.
- [ ] **Step 5:** Commit. Message: `Deep Field: lazy world packs (world-packs.js), registry entry, worker + thumbnail wiring, offline shell`.

### Task 4: Pixel look in the engine

**Files:**
- Modify: `js/hologram/hologram-engine.js`, `js/theme-registry.js` (Deep Field's `hologram` block only)
- Test: `tests/features_test.py`

**Interfaces:**
- Consumes: `upright` on built forms (Task 2); the Deep Field registry entry (Task 3).
- Produces, all additive:
  - **Point style `'pixel-grid'`** (in `_drawPoints`): `g = (mat.grid || 3) * dpr`.
    - Snap each point to `Math.round(v / g) * g`.
    - For each `i` with `to.link[i]`, step from point `i` to `i+1` in g-sized squares (Bresenham in grid units, at most 64 steps).
    - Otherwise draw one g×g square. The colour is `mat.colors[C[i]]` (existing depth classes), and `globalAlpha = baseAlpha`.
  - **`TRANSITIONS['pixel-dissolve']`** = `{ delay: (x, y, z, i) => (i * 0.618034) % 1, spread: 0.9, ease: 'linear', snap: true }`. In `_blend`, after easing: `if (tr.snap) p = p >= 0.5 ? 1 : 0;`.
  - **Upright tilt:** in the frame code where `rx` is computed (currently `(mot.tilt || 0) + …`), the base tilt eases toward `this.toForm?.upright ? 0.18 : (mot.tilt || 0)` via `this.tiltNow += (target - this.tiltNow) * Math.min(1, dt * 3)`. Initialise `tiltNow` in `setTheme` to `mot.tilt || 0`. Static motion uses the target directly.
  - **Reactions:**
    - `'pixel-shockwave'`: `add({ type: 'ring', life: 0.7, color: '#ffb454', width: 2, from: 0.2, to: 1.25, dashed: true }); this.env.pulse = 0.6;`
    - `'scanline-flash'`: `if (flashOk()) add({ type: 'scan', life: 0.35, color: '#5fe1d6' }); else this.env.pulse = 0.3;`
    - `'star-sparks'`: `this._burst('glint', 8, 0.8);`
  - **Registry (Deep Field):**
    - `material: { colors: ['#f1ecff', '#5fe1d6', '#2f8f9e', '#e05ca8'], colorMode: 'depth', composite: 'source-over', lines: false, point: 'pixel-grid', grid: 3, pointSize: 1, glow: 0, glowAlpha: 0 }`;
    - `transition: 'pixel-dissolve'`;
    - `reactions: { kick: 'pixel-shockwave', snare: 'scanline-flash', high: 'star-sparks' }`.

- [ ] **Step 1: Write failing checks** in `features_test.py`, with Deep Field applied and the pack loaded:
  - "deepfield uses pixel-dissolve with snap": after `settings.set('motion', 'full')` and `engine.morph('ship-zenith')`, `__reverb.engine.transition.snap === true`. Then set `engine.t = 0.5`, call `engine._blend(new Float32Array(engine.N * 3))`, and check that every `engine.prog[i]` is exactly 0 or 1.
  - "robot morph eases tilt toward upright": `engine.morph('robot-george')`, wait 1.5 s, then `Math.abs(engine.tiltNow - 0.18) < 0.05`; morph to `ship-omen`, wait 1.5 s, then `Math.abs(engine.tiltNow - 0.45) < 0.05`.
  - "pixel-grid draws hard-edged squares": render once, then sample a 40×40 region of the hologram canvas around the centre. Every non-transparent pixel's alpha must be either ≥ 0.6×255 or 0 (no soft glow halos). Allow up to 2% exceptions from particles.
  - "deepfield reduced: crossfade + still backdrop + no flash": `settings.set('motion', 'reduced'); settings.set('reduceFlashing', true)` (use the real setting key from `settings.js`). Then `engine.morph()` → `engine.transition.crossfade === true` and `backdrop.running === false`; trigger `engine._react('snare')` (use the real reaction entry point) → no effect of `type: 'scan'` is added.
- [ ] **Step 2:** Run `features_test.py`. Expected: the 4 new checks FAIL.
- [ ] **Step 3:** Implement the engine additions and the registry swap described in Interfaces.
- [ ] **Step 4:** Run all four suites. Expected: all PASS.
- [ ] **Step 5:** Commit. Message: `Deep Field: pixel-grid points, pixel-dissolve morph, upright robots, pixel reactions`.

### Task 5: Counts, docs, screenshots, ship

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `js/features/tour.js` (the "113 forms" line), `docs/WORLDS.md`
- Test: all suites, plus screenshots

- [ ] **Step 1: Update counts and copy.**
  - Counts: 14 worlds → 15; 113 forms → 137 (verify with `Object.keys(FORMS).length` after the pack registers: 113 + 24); 14 transitions → 15.
  - README: add "Hologram forms in Deep Field are traced from CC0 models by Quaternius (quaternius.com)"; change the pitch to "no image or audio assets"; add a row for world packs in the architecture table and a `tools/bake_forms.py` usage line.
  - `CLAUDE.md`:
    - architecture rows for `js/world-packs.js` and `js/worlds/`;
    - the "Adding a world" checklist gains "optional: ship as a pack (`pack: '<id>'`), bake model forms with `tools/bake_forms.py`";
    - updated check counts;
    - new startup budget figure.
  - `docs/WORLDS.md`: add row 15 with the art direction from the spec.
  - Tour line: "The hologram has 137 forms."
- [ ] **Step 2:** Run all four suites plus `python -m unittest tests/test_bake_forms.py`. Expected: all PASS. Update the check counts in `CLAUDE.md`/README to the printed totals.
- [ ] **Step 3: Screenshots.**
  - Deep Field at 1440×900 and 390×844 (motion full, a ship form and a robot form), plus Cyberpunk at 1440×900 as a regression check.
  - Look at each one: legible text, both planets visible on mobile, crisp pixels, no layout overflow.
  - Fix anything found and re-run the suites.
- [ ] **Step 4:** Commit. Message: `Deep Field: counts, docs, credits`.
- [ ] **Step 5: Ship.** Merge `deep-field` into `main` (fast-forward) and push; that triggers `.github/workflows/pages.yml`. Watch the run with `gh run watch`.
  - Once deployed, load https://jowo66.github.io/reverb-worlds/#world=deepfield and confirm the pack loads and the version stamp matches the commit.
  - If the deploy fails with "No artifacts named github-pages", re-run the workflow.
