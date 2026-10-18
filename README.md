# REVERB // WORLDS

A static, GitHub Pages–ready music player with **14 selectable visual worlds** and a signature **music-reactive hologram**. Every world shares one player and one hologram engine. Each world brings its own art direction, materials, form pool, transition and reactions.

There are no build step, frameworks or image assets. Everything is plain HTML/CSS and ES modules, and every visual is procedural (Canvas 2D).

---

## What works out of the box (no configuration)

| Feature | Status |
|---|---|
| 14 worlds (Cyberpunk → Glitch Art, plus Frutiger Aero), data-driven in `js/theme-registry.js` | ✅ |
| World switching that never interrupts playback, seek position or queue | ✅ (tested on all 14) |
| **v1.1:** Continue Last Session (world, shape, view and the REVERB track cued at the same position, with a Resume prompt) · Favourites (☆ on worlds, shapes and REVERB tracks; keys 1–9) · Library › Saved (save named Experiences; 4 built-in presets) · World Info panel (ⓘ or I) · 60-second tour | ✅ |
| **v1.2:** Share links: Library › Saved › Copy share link (or Link on a saved experience) copies a readable URL with the world, shape, view, settings and REVERB track. Opening one sets everything up and offers Play; it never autoplays and can only lower motion | ✅ |
| **Grab & rotate** the hologram: drag with mouse or touch (with momentum), arrow keys when focused, double-click or Home to reset | ✅ |
| Hologram engine: 113 procedural forms, 8 per world (9 for Japanese Scroll); random selection without immediate repeats; manual **Morph**; **Auto-morph** (timer, or every 16 detected onsets); **Auto-world** | ✅ |
| 14 transition styles (scan-wipe, iris, stroke-redraw, tile-reassemble, brush-reveal, emerge, spray, low-poly scan, slab, lead-assemble, crossfade, focus-pull, pixel-sort, bubble-float) | ✅ |
| Per-world kick / snare / high-frequency reactions and ambient particles | ✅ |
| Animated procedural backdrop per world, plus procedural world-card thumbnails | ✅ |
| **REVERB Originals**: 5 original tracks synthesised in your browser. They are genuinely analysable, so the hologram is truly audio-reactive | ✅ |
| **Your own audio files** (pick or drag-and-drop). Analysed locally, never uploaded | ✅ |
| **Microphone** visualizer input (e.g. while Spotify plays on speakers) | ✅ |
| Full player: play/pause, prev/next, seek, elapsed/total, volume, mute, shuffle, repeat (off/all/one), interactive queue, Media Session (lock-screen keys) | ✅ |
| Settings: Motion (full / reduced / static), intensity, glitch intensity, reduce flashing, quality (auto/high/low), backdrop on/off, auto-morph trigger and intervals, visualizer input | ✅ |
| Accessibility: keyboard shortcuts, visible focus, labelled icon buttons, `aria-pressed` toggles with text (not colour-only), `prefers-reduced-motion` default, WCAG AA+ palette contrast for all 14 worlds (checked in tests) | ✅ |
| Responsive: desktop 3-column, tablet with library sheet, mobile one-column with world carousel, compact player and expanded-player sheet | ✅ |
| Deep links: `…/#world=baroque` | ✅ |
| **Spotify Embed** (official iFrame API) | ✅ code complete, but **not verified live** (see below) |
| **Spotify Web Playback SDK** (Premium) with PKCE login | ⚙️ **needs your configuration** |

### Syncing the hologram to Spotify
Spotify's audio is DRM-protected and its tempo/beat-analysis API is no longer available to new apps, so the page can't hear Spotify directly. Three options, all labelled honestly on the stage chip:
- **Tap tempo** (button under the hologram, or press `T` 4+ times on the beat): pulses lock exactly to the tapped BPM. Labelled “Beat clock · N BPM (tapped)”.
- **Capture this tab's audio** (Library › Sources › Live audio; Chrome/Edge): real analysis if the browser delivers the audio. If the capture is silent (protected audio), REVERB detects it and says so.
- **Microphone**: real analysis of what your speakers play.

The Spotify embed is docked inside the player bar as Spotify's compact 80 px player, so it never covers the page.

### Honest visualizer modes
The chip at the top-left of the stage always says what drives the hologram:

- **Audio reactive · REVERB player**: real Web Audio analysis of the page's own audio (REVERB Originals or your files).
- **Audio reactive · Microphone**: real analysis of your microphone, locally. Nothing is recorded or sent.
- **Ambient animation**: a synthetic, "beat-inspired" signal **not derived from any audio**. This is used whenever no analysable audio exists, including all Spotify playback.

Kick and snare reactions come from adaptive spectral-flux onset detection. They are approximate onsets, not precise beat tracking.

---

## Integrations that need your credentials or configuration

### 1. Spotify Embed: no credentials, but verify on your deployment
Library › Sources › **Spotify embed**: paste any `open.spotify.com/...` link or `spotify:` URI.

- It uses the official [iFrame API](https://developer.spotify.com/documentation/embeds). The REVERB bar exposes **only** what that API supports: play/pause, plus seek for podcast episodes (per the docs). Next/previous, volume, shuffle and the tracklist stay inside Spotify's own embed controls, so REVERB hides its versions of those buttons.
- Listeners not logged in to Spotify in that browser usually hear **previews**.
- Embed audio is cross-origin and **cannot be analysed**, so the hologram runs in ambient mode, or with the microphone if enabled.
- ⚠️ The build environment could not reach `open.spotify.com`. The test verified the **graceful failure path** (clear "unavailable" message, controls hidden), not live embed playback. Please test it once on your GitHub Pages URL.

### 2. Spotify Web Playback SDK: requires your own Spotify developer app
This lets REVERB act as a Spotify Connect device with full transport controls and a read-only "up next" list.

**Requirements (Spotify rules as of 2026; re-check [developer.spotify.com](https://developer.spotify.com/documentation/web-playback-sdk) before relying on them):**
- A Spotify developer app. Since Feb/Mar 2026, **Development Mode** requires the app owner to have **Premium** and limits each app to **5 authorised users** that you add in the dashboard. Anyone else gets an account error unless the app gets extended quota.
- Listeners need **Spotify Premium** and a desktop browser with DRM (Widevine). Many mobile browsers aren't supported.
- **No Client Secret is used, needed or allowed.** The app uses Authorization Code **with PKCE** (public client). Tokens live in `sessionStorage` only.

**Setup steps:**
1. Go to <https://developer.spotify.com/dashboard> → **Create app**. Tick **Web API** and **Web Playback SDK**.
2. Add a **Redirect URI** that exactly matches your site URL, including the trailing slash. For example: `https://<your-user>.github.io/reverb-worlds/`
   - Spotify requires HTTPS redirect URIs. The only exception is loopback for local testing, e.g. `http://127.0.0.1:8000/` (Spotify rejects `localhost`).
   - The app shows the exact URI to register under **Settings › Spotify**.
3. Under **User Management**, add the Spotify accounts allowed to use the app (Development Mode).
4. Provide the **Client ID** (it is public), in one of two ways:
   - edit `js/config.js` → `export const SPOTIFY_CLIENT_ID = 'your-client-id';` and commit, **or**
   - paste it in **Settings › Spotify › Client ID**. It is stored only in that browser.
5. Open Library › Sources › **Connect Spotify** and log in. **Your playlists appear as cards**, and clicking one plays it:
   - with the Premium player connected (it starts automatically after login), it plays inside REVERB with full controls;
   - otherwise it opens in the Spotify embed.

   **Search Spotify** (top of Library › Sources) finds any song, playlist, album or artist in the whole catalogue, with filters and **Load more**. Click a result to play it. Songs play inside their album, so next and previous keep working, and **+ Queue** adds a song to your Spotify queue. Pressing Enter in the top search bar also searches Spotify when no world matches. Spotify caps Development-Mode apps at 10 results per type per request; REVERB pages with `offset`.

   Pasting a link still works for albums, tracks and other content. Playlists come from `GET /me/playlists` (scopes `playlist-read-private` and `playlist-read-collaborative`), which Spotify's February 2026 migration guide keeps available to Development-Mode apps.

Known caveat: Spotify developers have reported cases where `player.connect()` never becomes ready for Development-Mode apps after the 2026 changes. REVERB shows a clear message after 15 s instead of pretending to be connected.

"Like/save" is intentionally **not** implemented. I couldn't verify the current library-endpoint rules for Development-Mode apps, and REVERB doesn't show controls it can't guarantee.

### 3. Google Fonts (optional)
The worlds' typefaces load from Google Fonts. If they're blocked, every world falls back to safe system fonts. If you need no third-party requests, remove the `<link>` in `index.html`.

---

## Run locally
Use any static server. ES modules don't run from `file://`.

```bash
cd reverb-worlds
python3 -m http.server 8000 --bind 127.0.0.1
# open http://127.0.0.1:8000/
```

## Deploy to GitHub Pages
1. Create a repository (e.g. `reverb-worlds`) and push this folder's contents to `main`.
2. In the repo: **Settings › Pages › Build and deployment › Source: GitHub Actions**.
3. The included workflow (`.github/workflows/pages.yml`) publishes `index.html`, `css/`, `js/` and `assets/` on every push to `main`.
4. Visit `https://<user>.github.io/<repo>/`. All paths are relative, so the repository subpath works. Deep links use the hash (`#world=…`), so refreshes never 404.

Alternative: **Source: Deploy from a branch**, `main` / root. The `.nojekyll` file is included.

## Tests
Headless end-to-end test (Playwright + Chromium). It serves the site from a subpath exactly like Pages:

```bash
pip install playwright && python3 -m playwright install chromium
cd ..                                   # the folder that contains reverb-worlds/
python3 -m http.server 8765 --bind 127.0.0.1 &
python3 reverb-worlds/tests/smoke_test.py http://127.0.0.1:8765/reverb-worlds/ ./shots
```

Spotify integrations against **mocked** Spotify endpoints (38 checks: catalogue search, play-in-album, add to queue, paging, playlist listing and click-to-play, PKCE parameters, token exchange without a secret, SDK device transfer, transport calls, shuffle/repeat API calls, embed controller wiring, invalid-link errors). This proves REVERB's side of the contract, not that Spotify accepts your app:

```bash
python3 reverb-worlds/tests/spotify_mock_test.py http://127.0.0.1:8765/reverb-worlds/
```

`tests/features_test.py` (43 checks) covers the v1.1 features, v1.2 share links and the startup budget.

The smoke test covers 101 checks:
- All 14 worlds apply, with playback continuing across every switch, and each has 8+ holograms.
- Drag, arrow-key and double-click hologram rotation.
- Each world's form comes from its own pool.
- Morphs never repeat back-to-back.
- Every player control works, and the queue is clickable.
- Auto-morph, auto-world and pause visuals.
- Static and reduced motion, plus the OS reduced-motion default.
- Search, keyboard shortcuts and microphone mode.
- Local audio files (generated WAV upload) driving audio-reactive mode.
- The Spotify embed fails gracefully with no fake controls.
- No secrets ship, no local assets are missing, and there are no JS errors.
- Palette contrast for all 14 worlds.
- Mobile and tablet layouts have no horizontal scroll.

## Keyboard
`Space` play/pause · `←/→` seek 5 s · `N`/`P` next/previous · `M` morph · `[`/`]` previous/next world · `V` pause visuals · `Esc` closes sheets.

## Project structure
```
index.html                  markup, icon sprite, settings dialog
css/  reset · tokens · layout · components · themes (per-world ornament)
js/
  app.js                    wiring: settings ↔ worlds ↔ hologram ↔ player
  settings.js               harmless prefs in localStorage (fails gracefully)
  theme-registry.js         the 14 worlds as data
  theme-manager.js          applies CSS tokens + data-theme (presentation only)
  audio-analyser.js         Web Audio analysis + honest ambient source
  config.js                 optional public Spotify Client ID
  hologram/
    forms.js                113 procedural forms, resampled for point-to-point morphs
    hologram-engine.js      the reusable visualizer (materials, transitions, reactions, particles, quality scaling)
    backdrops.js            14 procedural animated backdrops + thumbnails
  player/
    player-adapter.js       capability-driven controller (UI hides unsupported controls)
    media-provider.js       REVERB player (demo synth + local files)
    demo-synth.js           in-browser synthesised original tracks
    spotify-embed.js        official iFrame API provider
    spotify-sdk.js          Web Playback SDK provider
    spotify-common.js       URI parsing, script loading, PKCE helpers
tests/smoke_test.py
.github/workflows/pages.yml
```

## Adding a world
1. Add an entry to `THEMES` in `js/theme-registry.js`: palette, fonts, panel, `background.renderer`, hologram `forms`/`material`/`transition`/`reactions`/`particles`.
2. Add a backdrop renderer in `js/hologram/backdrops.js` (`init` + `draw`).
3. Optionally add forms to `js/hologram/forms.js` and ornament to `css/themes.css`.

## Performance notes

**Optimizations (Oct 2026).** Measured in headless Chromium without a GPU, before → after:

| | Before | After |
|---|---|---|
| Font families requested on first load | 27 (render-blocking) | 3 for the active world (not render-blocking); neighbours preloaded on idle |
| Dark-world frame rate (blurred panels) | 16.7 fps | 60 fps (auto quality turns the panel blur off first) |
| World switch, main-thread time | 86 ms | 10 ms (backdrop layers built in a worker) |
| Worst frame gap scrolling to the world grid | 137 ms | 21 ms (thumbnails drawn in a worker, cached per build) |
| Spotify code at startup | 4 modules | none: loaded on first use |
| Repeat visit | normal reload | served by the service worker; works offline; synthesised tracks cached |

How each works:
1. **Per-world fonts:** `js/font-loader.js` (tiny head script) loads only the active world's Google Fonts. `theme-manager.js` loads others on switch and warms the two neighbours' font files on idle.
2. **Blur fallback:** with Quality = Auto, sustained frames under ~50 fps first set `data-blur="off"` (panels lose `backdrop-filter`, gain opacity). Only then does the hologram reduce its own detail.
3. **Lazy Spotify:** `js/player/lazy-provider.js` is a stand-in that answers cheap status questions and dynamically imports the embed or SDK (and PKCE helpers) on first real use.
4. **Worker drawing:** `js/hologram/backdrop-worker.js` builds backdrop layers and world thumbnails on an `OffscreenCanvas`; layers come back as `ImageBitmap`s. Thumbnails are cached in Cache Storage per build. If `OffscreenCanvas` is missing, it falls back to the main thread.
5. **Covered throttling:** while the Library sheet, expanded mobile player or Settings covers the stage, the hologram runs at 8 fps and the backdrop at 5 fps. The hologram stops while scrolled off-screen.
6. **Offline cache:** `sw.js` pre-caches every site file per build (the workflow stamps the commit SHA into `sw.js` and `js/version.js`). Files are served cache-first. A new deploy waits until you press **Reload** in the toast, so one session never mixes versions. REVERB Originals are stored in Cache Storage (`rw-audio-v<SYNTH_VERSION>`, about 10 MB per track played) and are synthesised once per device. Locally the service worker is off unless you add `?sw=1`. `tests/optimization_test.py` covers all six (23 checks).

### General notes
- The canvas device-pixel ratio is capped (2 / 1.5 / 1 by quality tier). Point and particle counts scale by tier.
- Auto quality steps down under sustained load.
- Animation stops while the tab is hidden.
- Backdrops cache their static layers and run at 15–30 fps.
- Panel blur applies only on desktop, and is off on light worlds and in low quality.
- Demo tracks render offline in roughly 1–3 s on a typical laptop (slower on low-end devices). The first one pre-renders in the background on load.

## Credits & originality
All visuals, silhouettes, patterns and music are generated by code in this repository. None of it is copied from existing artworks or tracks. The cave pictograms are an artistic interpretation, not authentic historical writing. This project is not affiliated with or endorsed by Spotify. Spotify playback uses only Spotify's official embed and SDK, under Spotify's developer terms.
