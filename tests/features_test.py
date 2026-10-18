"""
Release v1.1 checks: Experience format, Continue Last Session, Favourites,
Saved Experiences + Presets, World Info Panel, Recruiter Tour, startup budget.

    python3 reverb-worlds/tests/features_test.py http://127.0.0.1:8765/reverb-worlds/
"""
import os, pathlib, re, sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/reverb-worlds/"
BUDGET_KB = 335  # roadmap: startup JS/CSS (not HTML), raw bytes on disk
ROOT = pathlib.Path(__file__).resolve().parent.parent
out = []
def check(n, c, d=""): out.append(f"{'PASS' if c else 'FAIL'}  {n}{'  — ' + str(d) if d else ''}")
def wait(pg, js, timeout=15000): pg.wait_for_function(js, timeout=timeout)
R = "window.__reverb"

with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page(); errs, reqs, sizes = [], [], {}
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append(r.url))
    pg.on("requestfinished", lambda r: sizes.__setitem__(r.url, (r.sizes() or {}).get("responseBodySize", 0)))
    pg.goto(BASE); wait(pg, f"{R} && {R}.engine.toForm"); time.sleep(4)

    # ---- startup budget & laziness
    local = {u.split("/reverb-worlds/", 1)[1].split("?")[0] for u in reqs if "/reverb-worlds/" in u}
    startup = sum(os.path.getsize(ROOT / f) for f in local if f.endswith((".js", ".css")) and (ROOT / f).is_file())
    check(f"startup JS/CSS within {BUDGET_KB} KB budget", startup / 1024 <= BUDGET_KB, f"{startup / 1024:.1f} KB")
    lazy = [u for u in reqs if re.search(r"/features/(saved-panel|info-panel|tour)\.js", u)]
    check("v1.1 feature modules not downloaded at startup", not lazy, lazy)

    # ---- Experience format: validation & accessibility rules
    v = pg.evaluate(f"""(() => {{ const X = {R}.experience; return {{
      bad: X.validate({{ world: 'nowhere' }}),
      foreignForm: X.validate({{ world: 'baroque', form: 'neon-torus' }}).form ?? null,
      clamp: X.validate({{ world: 'baroque', settings: {{ intensity: 999, glitch: -5, autoMorphInterval: 2 }} }}).settings ?? null,
      name: X.validate({{ world: 'aero', name: '<img src=x onerror=alert(1)>Chill' }}).name,
      junkSource: X.validate({{ world: 'aero', source: {{ type: 'spotify', uri: 'javascript:alert(1)' }} }}).source ?? null,
    }}; }})()""")
    v["presets"] = pg.evaluate(f"(async () => (await {R}.loadFeature('saved-panel')).PRESETS.map(p => p && p.name))()")
    check("validate rejects unknown worlds", v["bad"] is None)
    check("validate drops a form from another world", v["foreignForm"] is None)
    check("validate drops out-of-range settings", v["clamp"] is None, v["clamp"])
    check("validate strips markup from names", "<" not in v["name"] and v["name"].endswith("Chill"), v["name"])
    check("validate drops non-Spotify URIs", v["junkSource"] is None)
    check("4 built-in presets, all valid", v["presets"] == ["Night Drive", "Rain City", "Dreamscape", "Neon Focus"], v["presets"])
    pg.evaluate(f"{R}.settings.set('motion', 'reduced')")
    pg.evaluate(f"{R}.experience.apply({{ world: 'cyberpunk', settings: {{ motion: 'full' }} }}, {{ engine: {R}.engine, settings: {R}.settings, themeManager: {R}.themeManager, ambient: {{ setTempo(){{}} }} }})")
    check("an Experience can never raise motion (reduced stays reduced)", pg.evaluate(f"{R}.settings.get('motion')") == "reduced")
    pg.evaluate(f"{R}.settings.set('motion', 'full')")

    # ---- Favourites
    pg.click('[data-fav-world="baroque"]'); time.sleep(0.2)
    check("☆ on a world card favourites it (aria-pressed + visible text)", pg.get_attribute('[data-fav-world="baroque"]', "aria-pressed") == "true" and pg.is_visible('.world-card[data-id="baroque"] + .fav-btn') and pg.evaluate("!document.querySelector('[data-fav-world=\"baroque\"]').closest('li').querySelector('.wc-fav').hidden"))
    pg.click('[data-fav-world="aero"]'); time.sleep(0.1)
    pg.evaluate(f"{R}.themeManager.apply('stained')"); time.sleep(0.4)
    fid = pg.evaluate(f"{R}.engine.toForm.id")
    pg.click("#fav-form"); time.sleep(0.1)
    check("☆ next to the shape name favourites the current form", pg.get_attribute("#fav-form", "aria-pressed") == "true" and fid in pg.evaluate(f"{R}.experience.favs.all().forms"), fid)
    pg.focus("#main"); pg.keyboard.press("1"); time.sleep(0.3)
    w1 = pg.evaluate("document.documentElement.dataset.theme")
    pg.keyboard.press("2"); time.sleep(0.3)
    w2 = pg.evaluate("document.documentElement.dataset.theme")
    check("keys 1–9 open favourite worlds (registry order)", (w1, w2) == ("baroque", "aero"), (w1, w2))

    # ---- Saved tab: presets, save, load, delete, favourites listed
    pg.click("#nav-library"); pg.click("#tab-saved")
    wait(pg, "document.querySelectorAll('#pane-saved .sv-row').length >= 4")
    check("Saved module loaded on demand (absent at startup, present after use)", any("/features/saved-panel.js" in u for u in reqs))
    favtxt = pg.inner_text("#pane-saved")
    check("Saved tab lists favourite worlds and shapes", "Baroque" in favtxt and "Frutiger Aero" in favtxt, favtxt[-200:])
    pg.evaluate(f"{R}.themeManager.apply('tiltshift')"); time.sleep(0.4)
    form_ts = pg.evaluate(f"{R}.engine.toForm.id")
    pg.fill("#sv-name", "Test Mix"); pg.click("#pane-saved form button[type=submit]"); time.sleep(0.2)
    check("save the current Experience", "Test Mix" in pg.inner_text("#pane-saved"))
    pg.evaluate(f"{R}.themeManager.apply('glitch')"); time.sleep(0.3)
    pg.click('#pane-saved .sv-apply[aria-label="Load experience Test Mix"]'); time.sleep(0.5)
    check("loading it restores world and shape", pg.evaluate(f"[document.documentElement.dataset.theme, {R}.engine.toForm.id]") == ["tiltshift", form_ts])
    pg.click('#pane-saved .sv-apply[aria-label="Load preset Night Drive"]'); time.sleep(0.6)
    st = pg.evaluate(f"({{ w: document.documentElement.dataset.theme, f: {R}.engine.toForm.id, playing: {R}.player.state.playing, track: {R}.player.state.track && {R}.player.state.track.title }})")
    check("preset applies world + shape and cues its track without autoplay", st["w"] == "vapor" and st["f"] == "retro-terrain" and st["track"] == "Neon Rain" and not st["playing"], st)
    check("…and offers a Play button", "Play" in pg.inner_text("#toast"))
    pg.click('#pane-saved [aria-label="Delete experience Test Mix"]'); time.sleep(0.2)
    check("delete a saved Experience", "Test Mix" not in pg.inner_text("#pane-saved"))

    # ---- Track favourites in the queue
    pg.click("#tab-queue")
    pg.click('#queue li:nth-child(3) .fav-btn'); time.sleep(0.2)
    check("☆ in the queue favourites a REVERB track", "ochre-pulse" in pg.evaluate(f"{R}.experience.favs.all().tracks"))

    # ---- Info panel
    pg.keyboard.press("Escape"); pg.focus("#main"); pg.keyboard.press("i")
    wait(pg, "!!document.querySelector('#info-panel')")
    time.sleep(1.3)
    info = pg.inner_text("#info-panel")
    check("I opens the World Information panel (lazy) with live data", "World" in info and "fps" in info and re.search(r"Forms\s+\d+", info) is not None and pg.get_attribute("#btn-info", "aria-expanded") == "true", info.replace("\n", " | ")[:220])
    pg.click("#btn-info"); time.sleep(0.2)
    check("ⓘ Info button closes it", not pg.evaluate("!!document.querySelector('#info-panel')") and pg.get_attribute("#btn-info", "aria-expanded") == "false")

    # ---- Continue Last Session (play track 2, seek, reload)
    pg.evaluate(f"{R}.themeManager.apply('artdeco')"); time.sleep(0.4)
    pg.evaluate(f"{R}.engine.morph('sun-disc')"); time.sleep(0.3)
    pg.evaluate(f"{R}.engine.user.ry = 0.7; {R}.engine.user.rx = 0.2")
    pg.evaluate(f"{R}.player.playIndex(1)"); wait(pg, f"{R}.player.state.playing", 40000)
    pg.evaluate(f"{R}.player.seek(21)"); time.sleep(1.5)
    pg.evaluate("dispatchEvent(new Event('pagehide'))")
    pg.reload(); wait(pg, f"{R} && {R}.engine.toForm"); time.sleep(0.8)
    s = pg.evaluate(f"({{ w: document.documentElement.dataset.theme, f: {R}.engine.toForm.id, ry: {R}.engine.user.ry, t: {R}.player.state.track.title, pos: {R}.player.state.position, playing: {R}.player.state.playing, toast: document.querySelector('#toast').textContent }})")
    check("reload restores world, shape and view angle", s["w"] == "artdeco" and s["f"] == "sun-disc" and abs(s["ry"] - 0.7) < 0.05, s)
    check("reload cues the same track paused at the same position", s["t"] == "Gilded Hour" and 20 <= s["pos"] <= 26 and not s["playing"], s)
    check("…with a Resume prompt", "Welcome back" in s["toast"] and "Resume" in s["toast"], s["toast"])
    pg.click("#toast button"); wait(pg, f"{R}.player.state.playing", 40000); time.sleep(0.6)
    check("Resume continues from the saved position", pg.evaluate(f"{R}.player.state.position") >= 20)
    check("favourites survive a reload", pg.get_attribute('[data-fav-world="baroque"]', "aria-pressed") == "true")
    pg.evaluate(f"{R}.player.pause()")

    # ---- Recruiter tour (run at 10× speed)
    pg.evaluate(f"{R}.settings.set('motion', 'full'); {R}.themeManager.apply('mosaic')"); time.sleep(0.3)
    f0 = pg.evaluate(f"{R}.engine.toForm.id")
    pg.evaluate(f"{R}.tourSpeed = 0.1")
    pg.click("#btn-tour"); wait(pg, "!!document.querySelector('.tour-bar')")
    seen = set(); t_end = time.time() + 9
    while time.time() < t_end and pg.evaluate("!!document.querySelector('.tour-bar')"):
        seen.add(pg.evaluate("document.documentElement.dataset.theme")); seen.add("info" if pg.evaluate("!!document.querySelector('#info-panel')") else ""); seen.add("m:" + pg.evaluate(f"{R}.settings.get('motion')")); time.sleep(0.1)
    after = pg.evaluate(f"({{ w: document.documentElement.dataset.theme, f: {R}.engine.toForm.id, motion: {R}.settings.get('motion'), bar: !!document.querySelector('.tour-bar'), playing: {R}.player.state.playing, info: !!document.querySelector('#info-panel') }})")
    check("tour visits 4 worlds, opens Info, demos reduced motion", {"cyberpunk", "ukiyo", "brutalist", "aero", "info", "m:reduced"} <= seen, sorted(seen))
    check("tour plays music (REVERB Original)", after["playing"], after)
    check("tour ends by itself and restores world, shape, motion; closes Info", not after["bar"] and after["w"] == "mosaic" and after["f"] == f0 and after["motion"] == "full" and not after["info"], after)
    pg.evaluate(f"{R}.settings.set('motion', 'reduced')")
    pg.click("#btn-tour"); wait(pg, "!!document.querySelector('.tour-bar')"); time.sleep(0.6)
    pg.keyboard.press("Escape"); time.sleep(0.4)
    check("Esc stops the tour and restores the world", not pg.evaluate("!!document.querySelector('.tour-bar')") and pg.evaluate("document.documentElement.dataset.theme") == "mosaic")
    pg.click("#btn-tour"); time.sleep(0.6 + 5)
    check("with reduced motion, the tour never raises motion", pg.evaluate(f"{R}.settings.get('motion')") == "reduced")
    pg.keyboard.press("Escape")

    check("no JS errors", not errs, errs[:3])

    # ---- mobile layout still fits
    m = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mp = m.new_page(); mp.goto(BASE); wait(mp, f"{R} && {R}.engine.toForm"); time.sleep(1)
    check("mobile: no horizontal scroll with new controls", mp.evaluate("document.documentElement.scrollWidth") <= 390, mp.evaluate("document.documentElement.scrollWidth"))
    b.close()

print("\n".join(out)); fails = [o for o in out if o.startswith("FAIL")]
print(f"\n{len(out) - len(fails)} passed, {len(fails)} failed"); sys.exit(1 if fails else 0)
