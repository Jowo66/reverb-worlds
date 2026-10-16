# CLAUDE.md: REVERB // WORLDS

A static music player with 14 visual "worlds" and a music-reactive hologram, hosted on GitHub Pages at https://jowo66.github.io/reverb-worlds/. Plain HTML, CSS and ES modules: **no framework, no build step, no bundler, no image or audio assets.** Everything visual and the demo music is generated in code. Keep it that way unless the owner explicitly asks otherwise.

Owner: Ejovwo Obahor (GitHub `Jowo66`). Background reading: `README.md` (features, setup, performance table).

## Commands

```bash
# Run locally. Serve the PARENT folder so the URL has the /reverb-worlds/ subpath, like GitHub Pages.
cd .. && python3 -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765/reverb-worlds/   (add ?sw=1 to enable the service worker locally)

# Tests (Python Playwright + Chromium: pip install playwright && python3 -m playwright install chromium)
# Run from the parent folder, with the server above running:
python3 reverb-worlds/tests/smoke_test.py        http://127.0.0.1:8765/reverb-worlds/   # 101 checks
python3 reverb-worlds/tests/spotify_mock_test.py http://127.0.0.1:8765/reverb-worlds/   # 41 checks, simulated Spotify
python3 reverb-worlds/tests/optimization_test.py http://127.0.0.1:8765/reverb-worlds/   # 23 checks

# Syntax check one module quickly
node --check js/app.js
```

**Before every push: run all three suites; every check must pass.** For visual changes, also take screenshots of the affected worlds (desktop 1440×900 and mobile 390×844) and look at them: tests can't judge legibility.

Gotcha: don't stop the test server with `pkill -f "http.server …"` inside a compound shell command. The pattern matches the shell's own command line and kills it. Stop it by PID instead.

## Deploy

Pushing to `main` runs `.github/workflows/pages.yml`. It copies only `index.html sw.js css js assets` into `_site`, stamps the commit SHA into `js/version.js` and `sw.js` (replacing `'dev'`), and deploys to Pages. Tests, docs and this file are not published. If a deploy fails with "No artifacts named github-pages", that is a transient GitHub issue: re-run the workflow.

## Architecture (where things live)

| Path | Role |
|---|---|
| `js/theme-registry.js` | The 14 worlds **as data** (palette, fonts, panel tokens, backdrop renderer, hologram forms/material/motion/transition/reactions/particles) |
| `js/theme-manager.js` | Applies a world (CSS variables + `data-theme`). **Must never call the player**, so switching worlds can't interrupt playback |
| `js/font-loader.js` | Classic `<head>` script: per-world Google Fonts map (`SPECS`, `WORLDS`). Loads only the active world's fonts and preloads neighbours |
| `js/hologram/forms.js` | 113 procedural forms. Each is built from paths and resampled to exactly N points so forms morph point-for-point |
| `js/hologram/hologram-engine.js` | Morphing, projection, materials, reactions, particles, drag-to-rotate, auto quality (`onSlow` turns panel blur off before reducing detail), throttling |
| `js/hologram/backdrops.js` | 14 animated backdrops: `init(S)` builds static layers, `draw(ctx,S,…)` animates. Also the `Backdrop` controller and thumbnail requests |
| `js/hologram/backdrop-worker.js` | Runs backdrop `init()` and draws thumbnails on `OffscreenCanvas`; thumbnails are cached per build. Main-thread fallback exists |
| `js/audio-analyser.js` | Real Web Audio analysis (page audio, mic, tab capture), approximate onset detection, `AmbientSource` + tap-tempo beat clock |
| `js/player/player-adapter.js` | `PlayerController`. Each provider declares `capabilities`, and the UI hides anything unsupported |
| `js/player/media-provider.js`, `demo-synth.js` | Built-in player: in-browser synthesised "REVERB Originals" (cached in Cache Storage per `SYNTH_VERSION`) and local files |
| `js/player/spotify-*.js` | Embed (iFrame API, docked in the player bar), Web Playback SDK, search, playlists, PKCE login, 404 device recovery |
| `js/player/lazy-provider.js` | Stand-in proxy so Spotify modules load on first use |
| `sw.js` | Offline cache: pre-caches a **hand-maintained list** of every shipped file, cache-first, update via "Reload" toast |
| `js/app.js` | Wires everything; keyboard shortcuts; `window.__reverb` debug/test surface |

## Rules (keep these; they came from real decisions or bugs)

**Honesty and controls**
- Never fake audio sync. The stage chip must say what drives the visuals ("Audio reactive · …", "Beat clock · N BPM (tapped)", "Ambient animation"). Spotify audio is DRM-protected and can't be analysed; don't claim otherwise.
- No decorative controls. If a provider can't do something, hide the control; add capabilities to the provider, not just buttons.
- Onset detection is "approximate", not "beat tracking". Keep the wording.

**Spotify (verify against developer.spotify.com before changing; rules changed in Feb/Mar 2026)**
- Public client only: Authorization Code + PKCE. **Never add a client secret anywhere.** The tests scan for one. Tokens stay in `sessionStorage`.
- Development Mode: the app owner needs Premium; only allow-listed users can log in; `GET /search` max `limit=10` (page with `offset`); playlist field `tracks` was renamed `items` (support both).
- New Spotify-provider methods must also be added to the `methods:` list of the `lazyProvider(...)` call in `app.js`, or calls before load silently return `undefined`.
- The redirect URI is the site URL with `index.html` stripped. The same formula lives in `spotify-common.js` and in `app.js`; keep them identical.

**Performance and caching**
- **Adding or renaming any shipped file? Add it to `SHELL` in `sw.js`.** `optimization_test.py` fails if the list and the files disagree.
- Backdrop `init()` runs in a worker. It may only use `layer()` canvases and plain data, and must not touch `document`/`window`. `draw()` must only *read* layers (they arrive as `ImageBitmap`s).
- Change the synth or track definitions → bump `SYNTH_VERSION` in `demo-synth.js`, or old cached audio keeps playing.
- Fonts for a world must be in both `theme-registry.js` (CSS stack) and `font-loader.js` (`SPECS` + `WORLDS`).
- Throttled frames (`engine.maxFps`) must not feed auto-quality measurement.

**Accessibility**
- Respect `prefers-reduced-motion` (default motion = Reduced). In Reduced/Static modes: no glitch, tearing or inertia. Honour "Reduce flashing" and the minimum flash gap.
- Text, muted text, accent text and button text must pass the contrast checks in `smoke_test.py` for every world.
- Every control must be keyboard-reachable with a visible focus ring; icon-only buttons need `aria-label`; toggles use `aria-pressed` and a text state, not colour alone.

**Layout**
- Canvases are absolutely positioned inside their containers (a canvas in normal flow once made the mobile page 1,560 px wide). Grid children get `min-width: 0`.
- Third-party widgets live inside our layout (the Spotify embed is the compact 80 px player inside the player bar), never floating over content.

## Adding a world (checklist)

1. Add an entry to `THEMES` in `js/theme-registry.js` (unique `id`, `num`, palette passing contrast, fonts, panel, `background.renderer`, `hologram.*` with 8+ forms).
2. Add any new forms to `js/hologram/forms.js` (validate: no NaN, extent ≤ ~1.3, enough points/links).
3. Add a backdrop renderer to `BACKDROPS` in `js/hologram/backdrops.js` (worker-safe `init`, read-only `draw`).
4. Add its fonts to `js/font-loader.js`, and its ornament to `css/themes.css` (`[data-theme="<id>"]`).
5. Update counts in tests and the README if needed (the UI counts come from `THEMES.length`).
6. Run all three suites and screenshot the new world on desktop and mobile.

## Working style the owner expects

- Make the change, test it, deploy it, then report in plain language: what changed, what was verified, and anything that needs the owner's action (Spotify dashboard, GitHub settings) as exact numbered steps.
- When something can't be verified (e.g. a real Spotify account), say so explicitly rather than implying it works.
