# World 16 "Midnight Drive" (PSX Lo-Fi): design

Date: 2026-10-25. Owner: Ejovwo Obahor. Status: approved in chat ("A and D", "1", wireframe hologram, "push it live").

## Intent
A late-90s console world: a fog-bound night drive rendered like a PS1 game, framed by console-menu chrome and a short original "boot" intro. Same rules as Deep Field: no image or audio files; shapes are edge data traced offline from CC0 models; the world loads as a pack.

## Identity
- id `midnight`, num `16`, name "Midnight Drive", tagline "PSX Lo-Fi", mood "Sodium lamps, fog, and a long road home."
- Palette: bg `#07080f`, surface `#141a2b`, primary `#ff9a3c` (sodium lamp), secondary `#6fc7c9` (fog teal), accent `#ff3b4f` (tail-light), text `#e8ecf5`, muted `#9aa3bd`. Must pass the smoke-test contrast checks (adjust `primaryInk`/`onPrimary` if needed).
- Fonts: display Chakra Petch (new), body Rajdhani, mono Share Tech Mono.
- Panels: console-menu bevel. Blue-grey vertical gradient, 1px light top-left edge, dark bottom-right edge, radius 2px.

## Backdrop: the drive (`js/worlds/midnight.js`)
- Software renderer on an art canvas about 320 px wide (≤ 360), upscaled without smoothing.
- Scene, back to front: sky gradient with dithered bands; distant ridge and city skyline silhouettes with a few lit windows; road in perspective toward a vanishing point, with lane dashes that scroll toward the viewer; low-poly streetlight posts on both sides, each with an orange light pool on the road; a teal fog gradient over the far distance.
- PS1 look: all projected coordinates rounded to whole art pixels (vertex wobble), Bayer 4×4 dithering on gradients, colours quantised to 5 bits per channel.
- Music: road speed = base + tempo/energy; kick warms the lamp pools for a moment (not a flash).
- Reduced motion or static: one still frame (the controller already skips animation outside full motion).
- Cost ≤ 3 ms per frame, also at a 4K-class viewport.
- `init(S)` is worker-safe (only `layer()` canvases and plain data); `draw()` only reads layers (it may create its own work canvas, as Deep Field does).

## Boot intro (part of the backdrop)
- About 2 s, only when animating (full motion), only the first time per browser session (`sessionStorage` key `rw-midnight-boot`, guarded with try/catch; no storage → play once per page load).
- Black screen → low-poly shapes swirl in and settle into a spinning diamond → a gentle brighten (≤ 35% white, 0.25 s; never a hard flash) → cut to the road.
- Original artwork: no Sony/PlayStation logos, marks, colours-as-logo or sounds. Silent.
- Thumbnails never show it.

## Hologram (pack-provided)
- Wireframe: `lines: true`, thin lines, `pixel: true` (vertex snap: the PS1 wobble), `colorMode: 'depth'` from bright to fog colour, no halo/glow.
- Transition `lowpoly-scan` (stepped), morph 1.2 s.
- Reactions: kick `headlight-flare` (warm flash through the existing flash path: honours Reduce flashing and its minimum gap); snare `poly-jitter` (vertices shake for ~0.3 s, full motion only, scaled by the glitch setting).
- Forms: 20 traced (`tools/forms-manifest-midnight.json` → `js/worlds/midnight-baked.js`): 10 GGBot PSX cars (CC0), 5 Quaternius cars, 2 Zombie Kit vehicles, streetlight, traffic light, stop sign (Quaternius, CC0). 3 procedural: `psx-disc`, `psx-memory-card`, `psx-boot-diamond`. All ids start with `psx-`. Credits show in the Info panel.

## Architecture change: packs carry their hologram settings
- Startup budget has ~0.4 KB left; this world needs ~2 KB of startup code (registry entry, CSS, fonts).
- A pack module may export `hologram`; `ensurePack` sets `theme.hologram` from it. Pack worlds in the registry carry `formIds` (a RegExp) instead of `hologram`, so share links, favourites and `worldOfForm` can recognise their forms before the pack loads. Unknown ids that match fall through the engine's existing "wanted form" handoff to a random form.
- Deep Field moves its hologram block into `deepfield.js` (frees ~1.9 KB).
- Info panel reads hologram details from the engine's current theme (also fixes the deferred "Info panel can throw while a pack loads" minor).

## Testing
- Pack: loads lazily, wires backdrop + hologram, cold start `#world=midnight&form=psx-taxi`, failed load reverts with a toast.
- Every Midnight form builds at N=320 and N=720 (finite, extent ≤ 1.3, exactly N points); credits present.
- Backdrop ≤ 3 ms/frame (normal and 4K-class).
- Boot: plays once per session in full motion, never in reduced motion or thumbnails.
- Reduced motion: still road; Reduce flashing honoured by `headlight-flare`.
- Deep Field still works with its hologram from the pack (existing checks).
- Contrast, startup budget, counts (16 worlds), screenshots desktop + mobile.
