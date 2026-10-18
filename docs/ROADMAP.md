# REVERB // WORLDS: Product Evolution Roadmap

**Version 2.0** · 16 October 2026 · Owner: Ejovwo Obahor
Supersedes v1.0. Every item below has been checked against the current codebase (14 worlds, 113 forms, three test suites).

> **Owner decisions (16 Oct 2026):** no community presets (no backend, no pull-request preset submissions) and **no visitor analytics of any kind**. Presets are curated by the owner only. Stats stay local to each user's device.

---

## What changed from v1.0

| v1.0 | v2.0 | Why |
|---|---|---|
| Saved Experiences, Continue Session, Share Links and Presets were four separate features | **One "Experience" data format powers all four** | Build it once; saving, restoring, sharing and presets become small UI layers on top |
| Phase 2 proposed a new `behavior` block | **Extend the existing `hologram.motion` and `reactions` fields** | Much of it already exists: Baroque morphs in 2.6 s, Brutalist in 1.1 s with stepped rotation, Cyberpunk spawns particles at rate 22 vs Brutalist's 4 |
| Showcase and Portfolio Mode were Phases 5 and 7 | **Moved to Phase 1** | Lowest effort and highest portfolio value, and most of the data already exists (`window.__reverb`, test counts, the design-process doc) |
| "Unlocks" gated hidden variants and special effects | **Discovery is cosmetic only; nothing is ever locked** | Locked features clash with the accessibility-first design; variants come almost free (see 3.3) |
| Example names "Prism Array", "Solar Crown" | **Real form names** (Neon torus, Faceted crystal, Rose window…) | The roadmap should describe the real product |
| Engagement metrics such as session duration | **Local-only stats; no visitor analytics** (owner decision) | Privacy; a static Pages site has no analytics |
| "No increase in startup bundle size" | **Concrete budget:** startup JS/CSS ≤ 335 KB raw (330.6 KB today); every new feature loads lazily | Makes the goal testable |
| Snapshot includes "song information" | **Song title drawn as text; album art only if the image can be exported** | Spotify cover art may block canvas export (cross-origin); must be verified, not assumed |

---

## Vision

REVERB // WORLDS grows from a themed music player into a **browser-based audiovisual art engine**: a place to explore, collect, personalise and share audiovisual experiences, built on what already works:

- 14 worlds;
- 113 morphable forms;
- real audio reactivity, and honest labelling when there is none;
- generated visuals and music, Spotify integration, offline support and an accessibility-first design.

**One-sentence pitch:**
> *REVERB // WORLDS is a browser-based audiovisual engine with 14 interactive art styles, 113 morphing holographic forms, real-time audio-reactive visuals and seamless world switching, built with zero frameworks or assets.*

### Guardrails (unchanged for every phase; from `CLAUDE.md`)
1. **Honesty:** never fake audio sync; the mode chip always tells the truth.
2. **No decorative controls:** hide what a source can't do.
3. **Accessibility:** reduced motion, reduce flashing, contrast, keyboard, for every new feature.
4. **Performance budget:** 60 fps target, startup ≤ 335 KB, new code lazy-loaded.
5. **No secrets, no build step, no assets.**
6. **Tested:** each feature ships with checks in one of the three suites, plus screenshots for visual changes.

---

## The core idea: one Experience format

Saving, continuing, sharing and presets are all the same thing: a snapshot of *what you're looking at and listening to*. Define it once:

```js
// js/experience.js (new, ~3 KB, lazy where possible)
{
  v: 1,                                   // schema version, for future migration
  name: 'Night Drive',
  world: 'cyberpunk',                     // validated against THEMES ids
  form: 'neon-torus',                     // validated against the world's form pool
  seed: 7,                                // optional: a form variant (see 3.3)
  view: { rx: 0.2, ry: 1.1 },             // drag-rotation angle
  settings: { intensity: 85, glitch: 40, motion: 'full', autoMorph: true, autoMorphInterval: 12 },
  source: { type: 'reverb', id: 'neon-rain' }               // REVERB Original
       // | { type: 'spotify', uri: 'spotify:playlist:…' }   // needs the viewer's own login → else embed
       // | { type: 'none' }                                 // local files can't be shared or persisted
  tempo: 118                              // optional tapped BPM
}
```

| Feature built on it | How |
|---|---|
| **Continue last session** | Auto-save on change (debounced) to `localStorage`; restore on boot |
| **Saved Experiences** | A named list in `localStorage` |
| **Share links** | Readable URL for the basics (`#world=cyberpunk&form=neon-torus&i=85`), a compact encoded one for everything (`#x=<base64url>`) |
| **Presets** | Built-in curated Experiences (Night Drive, Rain City, Dreamscape, Neon Focus) defined as data |

**Rules**
- **Incoming links are untrusted.** Every field is validated with the existing `VALIDATORS` in `settings.js` and the registry ids, and unknown fields are dropped.
- **Spotify in a shared link** opens through the embed for viewers who aren't signed in, and the UI says so ("previews unless you're logged in to Spotify").
- **Local files** never go into a link and aren't restored. Their blob URLs die with the tab, so the restore says "your files need re-adding".
- **Playback never auto-starts from a link,** because browsers block autoplay. Show a single Play prompt.

---

## Phase 1: First impressions & reasons to return
**Effort:** Low–Medium · **Ship first**

### 1.1 Continue Last Session *(Experience format)*
Settings already persist world, motion, intensity and volume. Add the current form, view angle, source, track index and position.
- **Done when:** a reload restores the same world, form and track, paused at the same position, with a "Resume" prompt.

### 1.2 Favourites
Favourite worlds, forms and REVERB tracks (plus Spotify playlists and tracks by URI when signed in).
- **UI:** a ☆ on world cards and on the form chip, and a "Favourites" tab in the Library.
- **Quick-launch:** keys 1–9 open favourite worlds.
- **Accessibility:** use `aria-pressed` with text "Favourited" / "Add to favourites", not just a filled star.

### 1.3 Saved Experiences + 4 built-in presets
"Save this…" in the stage toolbar names the current Experience. Presets ship as data.

### 1.4 World Information Panel *(moved up from Phase 5)*
A collapsible panel on the stage, fed by live data:

```
World       Cyberpunk · 01/14          Morph       Scan-wipe · 1.3 s
Forms       8 · now: Neon torus        Driver      Audio reactive · REVERB player
Particles   rate 22 · 64 alive         FPS         60 · quality High · blur On
```

### 1.5 Recruiter Tour *(moved up from Phase 7)*
A ▶ **"Take the 60-second tour"** button. It has to be a button because browsers require a click before audio.
- **Script:** plays a REVERB Original, morphs twice, switches 4 contrasting worlds (Cyberpunk → Japanese Scroll → Brutalist → Frutiger Aero), shows the Info Panel, and toggles Reduced motion to demonstrate accessibility.
- **Esc** stops the tour at any point.
- In Reduced-motion mode the tour uses crossfades.

**Phase 1 budget:** under 8 KB added to startup; the tour script loads lazily.

---

## Phase 2: Worlds that *behave* differently
**Effort:** Low–Medium (much of the system exists)

### 2.1 What already differs per world
- **Morph speed:** 1.1 s (Brutalist) to 2.6 s (Baroque).
- **Rotation:** none for Cave and Japanese Scroll; 0.32 for Cyberpunk; stepped turns for Brutalist.
- **Particle rate:** 4 (Brutalist) to 22 (Cyberpunk).
- **Transitions:** 14 distinct styles, and each world has its own kick/snare/high-frequency reactions.

### 2.2 What to add: four fields in the existing registry
```js
hologram: {
  motion: { rotate, tilt, sway, morph, hard,            // existing
            response: 0.85,     // NEW · attack speed of audio reactions (Vaporwave 0.4 = dreamy lag)
            pulse: 1.0,         // NEW · pulse-size multiplier (Cyberpunk 1.3, Baroque 0.6)
            morphStyle: 'steady'// NEW · 'steady' | 'restless' | 'rare' → auto-morph cadence & randomness
  },
  reactions: { kick, snare, high, chance: { snare: 0.6 } } // NEW · probability per reaction (Street Art unpredictability)
}
```

| World | Personality | Values |
|---|---|---|
| Cyberpunk | Aggressive | `pulse 1.3`, `response 1.0`, `morphStyle 'restless'` |
| Baroque | Slow, candlelit | `pulse 0.6`, `response 0.5`, `morphStyle 'rare'` |
| Street Art | Unpredictable | `reactions.chance` < 1, random form order, burst particles |
| Vaporwave | Dreamy lag | `response 0.4`, slow morph, VHS drift |
| Brutalist | Heavy | existing `hard: true` + `pulse 0.8`, no particles on snare |

- **Honesty rule:** stylistic lag must not undermine *real* sync. When the beat clock or real audio drives the visuals, kicks still land on the beat; only the *decay* changes.
- **Done when:** a test checks each world's values change engine output, and the beat-clock test still passes in every world.

---

## Phase 3: The Living Hologram
**Effort:** Medium

### 3.1 Shape Encyclopedia
- A gallery of all 113 forms: name, live preview, world of origin, category, short description.
- **Previews reuse the backdrop worker**, rendered off the main thread and cached per build, so the page costs nothing until opened.
- Clicking a form opens it on the stage ("Try it").

### 3.2 Categories: computed first, curated second
Seed the categories automatically from form data:
- 53 flat emblems;
- 8 point clouds;
- polyhedra (built from edges);
- architectural (box-built);
- organic (smoothed silhouettes).

Then hand-tune and add one-line descriptions per world (8 per world ≈ 113 lines of copy). **Descriptions are content work, not code:** budget for it.

### 3.3 Discovery (cosmetic, never locking)
- **Seen counter:** "Forms discovered **47 / 113**", stored locally.
- **Discovery mode:** auto-morph prefers forms you haven't seen, a small change to `_pickForm`.
- **Variants come almost free:**
  - 19 forms already build from a random seed (Crystal shards, Marble fragment, Charcoal spiral, Broken wireframe…);
  - a different seed is a genuinely different shape, so "rare variants" are new seeds with names and a ✦ badge;
  - no new art is needed.
- **Accessibility:** everything stays usable without discovering anything, and the counter is optional in Settings.

---

## Phase 4: Places, not wallpapers
**Effort:** Medium–High

### 4.1 What already exists, so the plan is *upgrades*
- **Cyberpunk:** rain, flickering signs, wet reflections.
- **Baroque:** a light shaft and candle flicker.
- **Vaporwave:** a scrolling grid.
- **Frutiger Aero:** sun rays, lens flare, bubbles.
- **Tilt Shift:** moving cars.

### 4.2 Upgrades with the most impact per effort
| World | Upgrade |
|---|---|
| Cyberpunk | Flying vehicles crossing between tower layers; billboards that change every bar; neon fog that thickens with energy |
| Baroque | A slow camera drift along a gallery wall; dust motes only inside the light shaft |
| Frutiger Aero | Water reflection of the sky; a weather cycle (clear → passing cloud); bubbles that pop on kicks |
| Vaporwave | Horizon colour shifts over a long cycle; a statue that turns slowly |
| Street Art | Murals that are "sprayed in" over time and painted over at song changes |

### 4.3 Shared technique: parallax depth
Split each backdrop into 2–3 depth layers that shift slightly with the pointer or hologram rotation. Layers are already built separately in the worker, so this is one change that benefits every world.

### 4.4 Rules
- Per-frame backdrop cost ≤ 3 ms, measured with the existing benchmark.
- Static layers stay in the worker; only moving parts draw each frame.
- Reduced motion: no parallax and no camera drift.
- Covered and off-screen throttling keeps working.

---

## Phase 5: Show the engineering
**Effort:** Low

### 5.1 Developer Overlay
Press **`D`** or add `?debug` to show:
- frames per second and frame time;
- bass/mid/high meters and onset ticks;
- particle count;
- quality tier and blur state;
- worker status and cache hits.

Reads from `window.__reverb` and loads lazily.

### 5.2 Live Architecture Viewer
An interactive diagram whose boxes **light up as data flows**:

```
Audio source → Analyser / Beat clock → Engine (morph · react) → Renderer → Canvas
          ↘ Player controller (capabilities) → UI shows only supported controls
```

Clicking a box opens a short explanation and a link to the source file on GitHub.

### 5.3 Case Study page
`case-study.html`, built from the existing design-process document:
- architecture;
- the before/after performance table;
- test counts (165 checks);
- the iteration timeline and lessons.

Same design system, Reduced motion by default.

---

## Phase 6: Sharing
**Effort:** Low–Medium *(the Experience format does the heavy lifting)*

### 6.1 Share links
- A **Share** button copies an Experience link.
- **Tests:** a share → open → identical-state round trip, plus a malicious-link test (invalid ids and huge values are rejected).

### 6.2 Snapshots
**Export** composites backdrop + hologram + a world-styled caption into a PNG.
- **Caption:** title and artist drawn as text, plus world and form names.
- **Sizes:** 1080×1080 and 1080×1920 (story).
- **Must verify:** whether Spotify cover images allow canvas export. If not, use the procedural cover style instead of the real art.

### 6.3 Community presets: **not planned** (owner decision)
No backend and no user-submitted presets. Built-in presets (1.3) are curated by the owner. Users share their own setups through share links (6.1).

---

## Phase 7: Platform
**Effort:** High

### 7.1 Worlds Kit (SDK) *(do this before the creator)*
Extract `theme-registry` + `hologram-engine` + `forms` + `backdrops` + the audio input layer into importable ES modules with a README and an example page. Both REVERB and the Neo-Jowo portfolio can then use it.

### 7.2 World Creator
- **What it edits:** visual editors for palette (with a **live contrast checker** that blocks unreadable combinations), fonts (from the font-loader list), panel style, form pool, transition, reactions and Phase 2 behaviour values.
- **Backgrounds:** chosen from parameterised templates (sky gradient, tiled grid, silhouette skyline, particle field). Arbitrary code is not allowed, for safety.
- **Output:** a `.reverbworld.json` file.

### 7.3 Import / Export
World packages are **data only** and are validated like share links. Imported packages can't run code.

---

## Recommended order

| Release | Contents | Why this order |
|---|---|---|
| **v1.1 ✅ shipped 18 Oct 2026** | Experience format · Continue Session · Favourites · Info Panel · Recruiter Tour (+ Saved tab & presets) | Retention + portfolio value; mostly UI over existing data |
| **Next (v1.2)** | World Personalities · ~~Share links~~ (shipped 18 Oct 2026, readable form only) · ~~Developer Overlay~~ (shipped 18 Oct 2026) · Case Study page | Cheap once the Experience format exists |
| **v1.3** | Shape Encyclopedia · Discovery + seed variants · Snapshots | Reuses the worker and caches |
| **v1.4** | Place upgrades + parallax (2–3 worlds at a time) | Highest art effort; do incrementally |
| **v2.0** | Worlds Kit → World Creator → Import/Export | Platform work, after the format is stable |

---

## Success metrics

**Measured locally (no tracking).** A private "Your stats" panel the user can see and reset:
- worlds visited;
- forms discovered;
- Experiences saved;
- time listened.

**Visitor analytics: not planned** (owner decision). Do not add tracking, counters or third-party analytics scripts.

**Technical (automated in CI)**
- 60 fps in the benchmark worlds; backdrop ≤ 3 ms per frame.
- Startup JS/CSS ≤ 335 KB raw; every new feature loaded lazily.
- All suites green, plus new checks per feature; contrast passes for all worlds, including user-created ones.

**Portfolio**
- A first-time visitor can repeat the pitch sentence after the 60-second tour.
- The Case Study page links every claim to code or a test.
- Tour completion and sharing are judged by the owner's own testing, not by tracking.

---

## Risks & open decisions

| Item | Risk / decision | Mitigation |
|---|---|---|
| Spotify in shared Experiences | Viewers need their own login; Development Mode allows only allow-listed users | Embed fallback with honest messaging; consider applying for extended quota |
| Snapshot cover art | Cross-origin images may block canvas export | Text + procedural cover |
| Storage | Cached tracks take ~10 MB each; favourites and saves are small | Show storage use in Settings with a "Clear" button |
| Content workload | 113 form descriptions + preset curation | Spread over releases; computed categories first |
| Scope creep | Platform features could stall polish | Strict release order; each release independently shippable |
