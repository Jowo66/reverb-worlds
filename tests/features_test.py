"""
Release v1.1 checks: Experience format, Continue Last Session, Favourites,
Saved Experiences + Presets, World Info Panel, Recruiter Tour, startup budget.
v1.2: Share links, Developer Overlay.

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
    lazy = [u for u in reqs if re.search(r"/features/(saved-panel|info-panel|tour|share|dev-overlay)\.js", u)]
    check("no /worlds/ request at startup on the default world", not any("/js/worlds/" in u for u in reqs), [u for u in reqs if "/js/worlds/" in u])
    check("feature modules (incl. share) not downloaded at startup", not lazy, lazy)

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

    # ---- v1.2 Developer Overlay (D key; removes its hooks on close)
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    hooks0 = pg.evaluate(f"String({R}.engine.hooks.onOnset)")
    pg.keyboard.press("d"); pg.wait_for_selector("#dev-overlay", timeout=8000); time.sleep(1.2)
    dv = pg.text_content("#dev-overlay")
    check("D opens the Developer Overlay with live fps, backdrop cost, meters, onsets, worker, caches", all(k in dv for k in ["fps", "ms avg", "budget 3 ms", "Bass", "Onsets", "from the ", "Backdrop thread", "Caches", "Build"]), dv[:160])
    check("overlay measures the backdrop (draw is wrapped while open)", pg.evaluate(f"!!{R}.backdrop.renderer.__devOrig"))
    pg.keyboard.press("d"); time.sleep(0.3)
    check("D again closes it and removes every hook", pg.query_selector("#dev-overlay") is None and pg.evaluate(f"!{R}.backdrop.renderer.__devOrig") and pg.evaluate(f"String({R}.engine.hooks.onOnset)") == hooks0)
    dp = ctx.new_page(); dp.goto(BASE + "?debug#world=glitch"); dp.wait_for_selector("#dev-overlay", timeout=10000)
    dp.click('#dev-overlay button[aria-label="Close developer overlay"]'); time.sleep(0.2)
    check("?debug opens the overlay; its ✕ button closes it", dp.query_selector("#dev-overlay") is None)
    dp.close()

    check("no JS errors", not errs, errs[:3])

    # ---- v1.2 Share links (fresh context; the link must win over a saved session)
    sc = b.new_context(viewport={"width": 1440, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
    sp = sc.new_page(); serr = []; sp.on("pageerror", lambda e: serr.append(str(e)))
    sp.goto(BASE + "#world=baroque"); wait(sp, f"{R} && {R}.engine.toForm"); time.sleep(1)
    sp.evaluate(f"{R}.experience.session.save({R}.experience.validate({{ world: 'baroque', source: {{ type: 'reverb', id: 'neon-rain' }} }}), 30)")
    rt = sp.evaluate(f"""(async () => {{ const S = await {R}.loadFeature('share'), X = {R}.experience;
      const exp = X.validate({{ world: 'ukiyo', view: {{ rx: 0.3, ry: 1.2 }}, settings: {{ intensity: 61, glitch: 12, motion: 'reduced', autoMorph: false, autoMorphInterval: 20 }}, source: {{ type: 'reverb', id: 'tessellate' }}, tempo: 104, name: 'Ink & Rain' }});
      const url = S.encode(exp), back = S.decode(new URL(url).hash);
      return {{ url, same: JSON.stringify(back) === JSON.stringify(exp) }}; }})()""")
    check("share link round-trips an Experience exactly", rt["same"], rt["url"])
    uk_form = sp.evaluate("(async () => (await import('./js/theme-registry.js')).THEME_BY_ID.ukiyo.hologram.forms[2])()")
    link = f"#world=ukiyo&form={uk_form}&i=61&rx=0.30&ry=1.20&src=reverb:tessellate&bpm=104&name=Ink"
    sp.evaluate(f"{R}.experience.session.save({R}.experience.validate({{ world: 'baroque', source: {{ type: 'reverb', id: 'neon-rain' }} }}), 30)")
    sp.close(); sp = sc.new_page(); sp.on("pageerror", lambda e: serr.append(str(e)))
    sp.goto(BASE + link); wait(sp, f"{R} && {R}.engine.toForm"); time.sleep(1.5)
    st = sp.evaluate(f"({{ w: {R}.themeManager.current.id, f: {R}.engine.toForm.id, i: {R}.settings.get('intensity'), rx: {R}.engine.user.rx, playing: {R}.player.state.playing, idx: {R}.player.state.index, track: {R}.media.items[{R}.player.state.index]?.id, toast: document.querySelector('#toast').textContent }})")
    check("opening a share link applies world, form, settings and view", st["w"] == "ukiyo" and st["f"] == uk_form and st["i"] == 61 and abs(st["rx"] - 0.3) < 0.05, st)
    check("share link cues its REVERB track but never autoplays (Play prompt)", st["track"] == "demo:tessellate" and not st["playing"] and "Play" in st["toast"], st)
    check("share link wins over the saved session (no Resume prompt)", "Welcome back" not in st["toast"] and st["w"] != "baroque", st["toast"])
    sp.evaluate(f"{R}.settings.set('motion', 'reduced')")
    sp.evaluate("location.hash = '#world=aero&form=neon-torus&i=999&m=full&src=javascript:alert(1)&name=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E'"); time.sleep(1)
    bad = sp.evaluate(f"({{ w: {R}.themeManager.current.id, f: {R}.engine.toForm.id, i: {R}.settings.get('intensity'), m: {R}.settings.get('motion'), imgs: document.querySelectorAll('#toast img').length }})")
    check("hostile link: foreign form, bad numbers and non-Spotify sources dropped", bad["w"] == "aero" and bad["f"] != "neon-torus" and bad["i"] == 61 and bad["imgs"] == 0, bad)
    check("a share link can never raise motion (m=full ignored)", bad["m"] == "reduced", bad["m"])
    sp.evaluate("location.hash = '#world=nowhere&form=x&i=5'"); time.sleep(0.8)
    check("invalid share link changes nothing and says so", sp.evaluate(f"{R}.themeManager.current.id") == "aero" and "valid" in sp.text_content("#toast"))
    sp.evaluate(f"{R}.settings.set('motion', 'full')")
    sp.click("#nav-library"); sp.click("#tab-saved")
    sp.wait_for_selector("#sv-share", timeout=8000); sp.click("#sv-share"); time.sleep(0.5)
    clip = sp.evaluate("navigator.clipboard.readText()")
    check("Saved › Copy share link puts a working link on the clipboard", "#world=aero" in clip and "form=" in clip and clip.startswith(BASE.rstrip("/")), clip)
    check("share links: no JS errors", not serr, serr[:3])
    sc.close()

    # ---- Deep Field pack module (forms + backdrop), imported directly
    dfp = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    dfp.goto(BASE); wait(dfp, f"{R} && {R}.engine.toForm")
    dfp.evaluate(f"{R}.engine.stop(); {R}.backdrop.stop()")  # time the backdrop alone, not the live app beside it
    df = dfp.evaluate("""(async () => {
      const m = await import('./js/worlds/deepfield.js'), F = await import('./js/hologram/forms.js');
      Object.assign(F.FORMS, m.forms);
      const ids = Object.keys(m.forms), bad = [];
      for (const id of ids) for (const N of [320, 720]) {
        const f = F.buildForm(id, N, 1); let ext = 0, ok = f.pos.length === N * 3;
        for (const v of f.pos) { if (!Number.isFinite(v)) ok = false; ext = Math.max(ext, Math.abs(v)); }
        if (!ok || ext > 1.3) bad.push(`${id}@${N}:${ext.toFixed(2)}`);
      }
      const c = new OffscreenCanvas(480, 270), ctx = c.getContext('2d');
      const S = { w: 480, h: 270, dpr: 0.25, rng: F.mulberry32(1337), glitch: 0.5, animate: true,
        palette: { bg: '#0b0a1f', surface: '#1a1736', primary: '#ffb454', secondary: '#5fe1d6', accent: '#e05ca8', text: '#f1ecff', muted: '#b4acd9' } };
      m.backdrop.init(S);
      const r = { bass: .3, mid: .3, high: .3, energy: .3, kick: .5, snare: 0 }, t0 = performance.now();
      for (let i = 0; i < 60; i++) m.backdrop.draw(ctx, S, 3 + i / 24, 1 / 24, r);
      const ms = (performance.now() - t0) / 60, px = ctx.getImageData(240, 135, 1, 1).data;
      const big = new OffscreenCanvas(3200, 1800), bctx = big.getContext('2d'), SB = { ...S, w: 3200, h: 1800, dpr: 1.25, rng: F.mulberry32(1337) };
      for (const k of ['nebula', 'work', 'wctx', 'land', 'cloud', 'gas']) delete SB[k];
      m.backdrop.init(SB); m.backdrop.draw(bctx, SB, 3, 1 / 24, r);
      const t1 = performance.now(); for (let i = 0; i < 30; i++) m.backdrop.draw(bctx, SB, 3 + i / 24, 1 / 24, r);
      const msBig = (performance.now() - t1) / 30;
      return { n: ids.length, procedural: ['df-ringed-planet', 'df-blackhole', 'df-galaxy', 'df-orbits'].every(k => ids.includes(k)), bad,
        upright: [F.buildForm('robot-george', 320).upright, F.buildForm('ship-omen', 320).upright], ms, msBig, alpha: px[3],
        credit: [F.buildForm('robot-voxel-recon-bot', 320).credit, F.buildForm('ship-omen', 320).credit, F.buildForm('df-galaxy', 320).credit] };
    })()""")
    check("deepfield pack exports 33 forms (29 baked + 4 procedural)", df["n"] == 33 and df["procedural"], df["n"])
    check("baked forms carry their model credit (procedural ones none)", df["credit"] == ["Max Parata (CC BY-ND 4.0)", "Quaternius (CC0)", None], df["credit"])
    check("every Deep Field form builds at N=320 and N=720: no NaN, extent ≤ 1.3, exactly N points", not df["bad"], df["bad"][:5])
    check("robot forms report upright", df["upright"] == [True, False], df["upright"])
    check("deepfield backdrop init+draw on OffscreenCanvas ≤ 3 ms/frame", df["ms"] < 3 and df["alpha"] > 0, f"{df['ms']:.2f} ms, alpha {df['alpha']}")
    check("deepfield backdrop ≤ 3 ms/frame at a 4K-class viewport (3200×1800)", df["msBig"] < 3, f"{df['msBig']:.2f} ms")
    dfp.context.close()

    # ---- packs carry their hologram settings (startup registry holds only formIds)
    hp = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    hp.goto(BASE); wait(hp, f"{R} && {R}.engine.toForm")
    ph = hp.evaluate("""(async () => {
      const T = await import('./js/theme-registry.js'), X = await import('./js/experience.js'), P = await import('./js/world-packs.js');
      const df = T.THEME_BY_ID.deepfield, before = { holo: df.hologram === undefined, ids: !!df.formIds && df.formIds.test('ship-omen') && !df.formIds.test('neon-tower') };
      const v = X.validate({ world: 'deepfield', form: 'ship-omen' }), bad = X.validate({ world: 'deepfield', form: 'aqua-bubbles' });
      const owner = X.worldOfForm('robot-george');
      await P.ensurePack(df);
      return { before, kept: v.form === 'ship-omen', rejected: bad.form === undefined, owner, after: df.hologram?.forms?.length };
    })()""")
    check("pack worlds have no hologram block at startup, only formIds", ph["before"]["holo"] and ph["before"]["ids"], ph["before"])
    check("share links/favourites recognise pack forms before the pack loads", ph["kept"] and ph["rejected"] and ph["owner"] == "deepfield", ph)
    check("ensurePack installs the pack's hologram settings (Deep Field: 33 forms)", ph["after"] == 33, ph["after"])
    hp.evaluate(f"{R}.themeManager.apply('aero', 'user')"); time.sleep(0.5)
    hp.route("**/js/worlds/midnight.js", lambda r: r.abort())
    hp.keyboard.press("i"); wait(hp, "!!document.querySelector('#info-panel')")
    herr = []; hp.on("pageerror", lambda e: herr.append(str(e)))
    hp.evaluate(f"{R}.themeManager.apply('midnight', 'user')"); time.sleep(1.2)
    check("Info panel open while a pack loads or fails: no errors", not herr, herr[:2])
    hp.context.close()

    # ---- engine reactions for Midnight Drive
    ep = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    ep.goto(BASE); wait(ep, f"{R} && {R}.engine.toForm")
    er = ep.evaluate(f"""(() => {{ const E = {R}.engine, h = E.theme.hologram, saved = h.reactions;
      h.reactions = {{ kick: 'headlight-flare', snare: 'poly-jitter' }};
      E.setOptions({{ motion: 'full', reduceFlashing: false }}); E.effects.length = 0; E.lastFlash = -99; E.env.jit = 0;
      E._react('kick'); const flare = E.effects.some(e => e.type === 'flash'); E.effects.length = 0; E._react('kick'); const gap = E.effects.some(e => e.type === 'flash');
      E._react('snare'); const jit = E.env.jit; E.env.jit = 0;
      E.setOptions({{ motion: 'reduced' }}); E._react('snare'); const jitReduced = E.env.jit;
      h.reactions = saved; return {{ flare, gap, jit, jitReduced }}; }})()""")
    check("headlight-flare: warm flash on kick, none inside the minimum flash gap", er["flare"] and not er["gap"], er)
    check("poly-jitter: shakes vertices in full motion only", er["jit"] > 0.03 and er["jitReduced"] == 0, er)
    ep.context.close()

    # ---- world packs: lazy loading, wiring, failure, cold start
    PACK_FORM = "(id => /^(ship|robot|df)-/.test(id))"
    def fresh(url=BASE):
        c = b.new_context(viewport={"width": 1440, "height": 900}); p = c.new_page()
        p.goto(url); wait(p, f"{R} && {R}.engine.toForm"); return c, p
    wc, wp = fresh()
    wp.evaluate(f"{R}.themeManager.apply('aero', 'user')")
    wp.evaluate("document.querySelector('.world-card[data-id=\"deepfield\"]').click()")
    wait(wp, f"{R}.engine.theme.id === 'deepfield' && {PACK_FORM}({R}.engine.toForm.id) && {R}.backdrop.theme.id === 'deepfield'", 15000); time.sleep(1)
    px = wp.evaluate("(() => { const c = document.querySelector('canvas.backdrop') || document.querySelector('.backdrop canvas') || document.querySelector('.backdrop'); const x = document.createElement('canvas'); x.width = x.height = 1; x.getContext('2d').drawImage(c, c.width / 2, c.height / 2, 1, 1, 0, 0, 1, 1); return Array.from(x.getContext('2d').getImageData(0, 0, 1, 1).data); })()")
    check("selecting Deep Field loads the pack and renders", sum(px[:3]) > 0, px)
    wc.close()
    wc, wp = fresh()
    wp.evaluate(f"{R}.themeManager.apply('deepfield', 'user'); {R}.themeManager.apply('aero', 'user')"); time.sleep(1.5)
    rs = wp.evaluate(f"[{R}.engine.theme.id, {R}.backdrop.theme.id, document.documentElement.dataset.theme]")
    check("rapid switch ends on the last world", rs == ["aero", "aero", "aero"], rs)
    wc.close()
    wc, wp = fresh()
    wp.evaluate(f"{R}.themeManager.apply('aero', 'user')")
    wp.route("**/js/worlds/deepfield.js", lambda r: r.abort())
    wp.evaluate(f"{R}.themeManager.apply('deepfield', 'user')"); time.sleep(2)
    fl = wp.evaluate(f"[document.documentElement.dataset.theme, {R}.engine.theme.id, document.querySelector('#toast').textContent]")
    check("pack failure reverts + toast", fl[0] == "aero" and fl[1] == "aero" and "Couldn't load Deep Field" in fl[2], fl)
    wp.unroute("**/js/worlds/deepfield.js")
    wp.evaluate(f"{R}.themeManager.apply('deepfield', 'user')")
    try: wait(wp, f"{R}.engine.theme.id === 'deepfield'", 8000); ok = True
    except Exception: ok = False
    check("retry after failure loads", ok, wp.evaluate(f"{R}.engine.theme.id"))
    wc.close()
    wc, wp = fresh(BASE + "#world=deepfield&form=ship-omen")
    try: wait(wp, f"{R}.engine.theme.id === 'deepfield' && {R}.engine.toForm.id === 'ship-omen'", 10000); ok = True
    except Exception: ok = False
    check("cold start via #world=deepfield&form=ship-omen", ok, wp.evaluate(f"[{R}.engine.theme && {R}.engine.theme.id, {R}.engine.toForm.id]"))
    wc.close()
    wc, wp = fresh(BASE + "#world=deepfield&form=robot-voxel-recon-bot")
    try: wait(wp, f"{R}.engine.toForm.id === 'robot-voxel-recon-bot'", 10000)
    except Exception: pass
    wp.keyboard.press("i"); wait(wp, "!!document.querySelector('#info-panel')")
    info = wp.inner_text("#info-panel")
    check("Info panel credits the current model (voxel robot: Max Parata, CC BY-ND 4.0)", re.search(r"Model\s+Recon Bot by Max Parata \(CC BY-ND 4\.0\)", info) is not None, info.replace("\n", " | ")[-120:])
    pool = wp.evaluate(f"{R}.engine.pool")
    check("deepfield pool includes all 9 voxel robots", sum(1 for f in pool if f.startswith("robot-voxel-")) == 9, len(pool))
    wc.close()
    wc, wp = fresh()
    wp.click("#nav-worlds")
    wp.evaluate("document.querySelector('.world-card[data-id=\"deepfield\"]').scrollIntoView()")
    try: wait(wp, "(() => { const c = document.querySelector('.world-card[data-id=\"deepfield\"] canvas'); return c && c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data[3] > 0; })()", 10000); ok = True
    except Exception: ok = False
    check("Deep Field thumbnail draws", ok)
    wc.close()

    # ---- Deep Field pixel look: pixel-grid points, pixel-dissolve morph, upright robots, reactions
    wc, wp = fresh(BASE + "#world=deepfield")
    wait(wp, f"{R}.engine.theme && {R}.engine.theme.id === 'deepfield'")
    wp.evaluate(f"{R}.settings.set('motion', 'full'); {R}.settings.set('reduceFlashing', false)"); time.sleep(0.3)
    snap = wp.evaluate(f"""(() => {{ const E = {R}.engine; E.morph('ship-zenith'); E.t = 0.5; E._blend(new Float32Array(E.N * 3));
      return {{ snap: E.transition.snap === true, binary: Array.from(E.prog.slice(0, E.N)).every(p => p === 0 || p === 1) }}; }})()""")
    check("deepfield uses pixel-dissolve with snap", snap["snap"] and snap["binary"], snap)
    wp.evaluate(f"{R}.engine.morph('robot-george')"); time.sleep(2.5)
    t1 = wp.evaluate(f"{R}.engine.tiltNow")
    wp.evaluate(f"{R}.engine.morph('ship-omen')"); time.sleep(2.5)
    t2 = wp.evaluate(f"{R}.engine.tiltNow")
    check("robot morph eases tilt toward upright", t1 is not None and t2 is not None and abs(t1 - 0.18) < 0.05 and abs(t2 - 0.45) < 0.05, [t1, t2])
    wp.evaluate(f"{R}.settings.set('intensity', 0); {R}.engine.renderOnce()"); time.sleep(0.2)
    hard = wp.evaluate("""(() => { const c = document.querySelector('#hologram'), x = c.getContext('2d');
      const d = x.getImageData((c.width >> 1) - 60, (c.height >> 1) - 60, 120, 120).data; let soft = 0, lit = 0;
      for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) lit++; if (d[i] > 0 && d[i] < 153) soft++; }
      return { lit, soft }; })()""")
    check("pixel-grid draws hard-edged squares", hard["lit"] > 50 and hard["soft"] <= hard["lit"] * 0.02, hard)
    wp.evaluate(f"{R}.settings.set('intensity', 70); {R}.settings.set('motion', 'reduced'); {R}.settings.set('reduceFlashing', true)"); time.sleep(0.3)
    red = wp.evaluate(f"""(() => {{ const E = {R}.engine; E.morph(); E.effects.length = 0; E.lastFlash = -99; E._react('snare');
      return {{ cross: E.transition.crossfade === true, still: {R}.backdrop.running === false, scan: E.effects.some(e => e.type === 'scan') }}; }})()""")
    wp.evaluate(f"{R}.settings.set('motion', 'full')"); time.sleep(0.3)
    fl = wp.evaluate(f"""(() => {{ const E = {R}.engine, scan = () => {{ E.effects.length = 0; E.lastFlash = -99; E._react('snare'); return E.effects.some(e => e.type === 'scan'); }};
      const reduced = scan(); {R}.settings.set('reduceFlashing', false); return {{ reduced, normal: scan() }}; }})()""")
    red["fullReduced"] = fl["reduced"]; red["fullNormal"] = fl["normal"]
    check("deepfield reduced: crossfade + still backdrop + no flash", red["cross"] and red["still"] and not red["scan"] and not fl["reduced"] and fl["normal"], red)
    wp.evaluate(f"{R}.settings.set('intensity', 0); {R}.settings.set('reduceFlashing', false)"); time.sleep(0.3)
    st = wp.evaluate(f"""(() => {{ const E = {R}.engine, ctx = E.ctx, orig = ctx.fillRect; let n = 0;
      ctx.fillRect = function (...a) {{ n++; return orig.apply(this, a); }};
      E.morph('ship-omen', {{ instant: true }}); E.morph('robot-george');
      E.t = 1; E._frame(0, false); const steady = n; n = 0; E.morph('ship-omen', {{ instant: true }}); E.morph('robot-george');
      E.t = 0.5; E._frame(0, false); const mid = n; ctx.fillRect = orig; return {{ steady, mid }}; }})()""")
    check("pixel-dissolve mid-morph draws no streaks between old and new positions", st["mid"] <= st["steady"] * 1.5, st)
    wp.evaluate(f"{R}.settings.set('intensity', 70); {R}.settings.set('motion', 'reduced'); {R}.settings.set('reduceFlashing', false)"); time.sleep(0.3)
    rs2 = wp.evaluate(f"(() => {{ const E = {R}.engine; E.effects.length = 0; E.lastFlash = -99; E._react('snare'); return E.effects.some(e => e.type === 'scan'); }})()")
    check("deepfield reduced motion (flashing allowed): snare draws no scan sweep", rs2 is False, rs2)
    wc.close()

    # ---- Midnight Drive (world 16, PSX Lo-Fi)
    mp_ = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    mp_.goto(BASE); wait(mp_, f"{R} && {R}.engine.toForm")
    mp_.evaluate(f"{R}.engine.stop(); {R}.backdrop.stop()")
    md = mp_.evaluate("""(async () => {
      const m = await import('./js/worlds/midnight.js'), F = await import('./js/hologram/forms.js');
      Object.assign(F.FORMS, m.forms);
      const ids = Object.keys(m.forms), bad = [];
      for (const id of ids) for (const N of [320, 720]) {
        const f = F.buildForm(id, N, 1); let ext = 0, ok = f.pos.length === N * 3;
        for (const v of f.pos) { if (!Number.isFinite(v)) ok = false; ext = Math.max(ext, Math.abs(v)); }
        if (!ok || ext > 1.3) bad.push(`${id}@${N}:${ext.toFixed(2)}`);
      }
      const proc = ['psx-disc', 'psx-memory-card', 'psx-boot-diamond'];
      const credits = ids.filter(id => !proc.includes(id)).every(id => /\\((CC0)\\)$/.test(F.buildForm(id, 320).credit || ''));
      const S = { w: 480, h: 270, dpr: 0.25, rng: F.mulberry32(1337), glitch: 0.5, animate: true, boot: -1,
        palette: { bg: '#07080f', surface: '#141a2b', primary: '#ff9a3c', secondary: '#6fc7c9', accent: '#ff3b4f', text: '#e8ecf5', muted: '#9aa3bd' } };
      const c = new OffscreenCanvas(480, 270), ctx = c.getContext('2d'), r = { bass: .3, mid: .3, high: .3, energy: .5, kick: .6, snare: 0 };
      m.backdrop.init(S); m.backdrop.draw(ctx, S, 3, 1 / 24, r);
      const time = (S2, cx, n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) m.backdrop.draw(cx, S2, 3 + i / 24, 1 / 24, r); return (performance.now() - t0) / n; };
      const ms = time(S, ctx, 60), px = ctx.getImageData(240, 200, 1, 1).data;
      const big = new OffscreenCanvas(3200, 1800), SB = { ...S, w: 3200, h: 1800, dpr: 1.25, rng: F.mulberry32(1337), boot: -1 };
      for (const k of Object.keys(SB)) if (!['w', 'h', 'dpr', 'rng', 'glitch', 'animate', 'boot', 'palette'].includes(k)) delete SB[k];
      m.backdrop.init(SB); m.backdrop.draw(big.getContext('2d'), SB, 3, 1 / 24, r);
      const msBig = time(SB, big.getContext('2d'), 30);
      const SBoot = { ...SB, boot: 0.6 }; const msBoot = time(SBoot, big.getContext('2d'), 10);
      const holo = m.hologram;
      return { n: ids.length, proc: proc.every(k => ids.includes(k)), bad, credits, ms, msBig, msBoot, alpha: px[3],
        pool: holo.forms.length, allPsx: holo.forms.every(f => f.startsWith('psx-') && ids.includes(f)), reactions: holo.reactions };
    })()""")
    check("midnight pack exports 23 forms (20 traced + 3 procedural), all in the pool", md["n"] == 23 and md["proc"] and md["pool"] == 23 and md["allPsx"], md["n"])
    check("every Midnight form builds at N=320 and N=720: no NaN, extent ≤ 1.3, exactly N points", not md["bad"], md["bad"][:5])
    check("traced Midnight forms credit their CC0 author", md["credits"])
    check("midnight reactions: headlight-flare + poly-jitter", md["reactions"].get("kick") == "headlight-flare" and md["reactions"].get("snare") == "poly-jitter", md["reactions"])
    check("midnight backdrop draws and stays ≤ 3 ms/frame", md["ms"] < 3 and md["alpha"] > 0, f"{md['ms']:.2f} ms")
    check("midnight backdrop ≤ 3 ms/frame at 3200×1800, road and boot intro", md["msBig"] < 3 and md["msBoot"] < 3, f"road {md['msBig']:.2f} ms, boot {md['msBoot']:.2f} ms")
    mp_.context.close()

    mc, mpg = fresh()
    mpg.evaluate(f"sessionStorage.removeItem('rw-midnight-boot'); {R}.settings.set('motion', 'full')")
    mpg.evaluate("document.querySelector('.world-card[data-id=\"midnight\"]').click()")
    try: wait(mpg, f"{R}.engine.theme.id === 'midnight' && /^psx-/.test({R}.engine.toForm.id) && {R}.backdrop.theme.id === 'midnight' && {R}.backdrop.S && {R}.backdrop.S.boot !== undefined", 15000); ok = True
    except Exception: ok = False
    boot0 = mpg.evaluate(f"{R}.backdrop.S && {R}.backdrop.S.boot")
    check("selecting Midnight Drive loads the pack, shows a psx- form", ok, mpg.evaluate(f"[{R}.engine.theme && {R}.engine.theme.id, {R}.engine.toForm.id]"))
    time.sleep(2.8)
    boot1 = mpg.evaluate(f"[{R}.backdrop.S.boot, sessionStorage.getItem('rw-midnight-boot')]")
    mpg.evaluate(f"{R}.themeManager.apply('aero', 'user')"); time.sleep(0.8)
    mpg.evaluate(f"{R}.themeManager.apply('midnight', 'user')")
    wait(mpg, f"{R}.backdrop.theme.id === 'midnight' && {R}.backdrop.S && {R}.backdrop.S.boot !== undefined", 10000); time.sleep(0.3)
    boot2 = mpg.evaluate(f"{R}.backdrop.S.boot")
    check("boot intro plays on first entry in full motion, then ends", isinstance(boot0, (int, float)) and 0 <= boot0 < 2.2 and boot1[0] == -1 and boot1[1] == "1", [boot0, boot1])
    check("boot intro plays once per session", boot2 == -1, boot2)
    mpg.evaluate(f"sessionStorage.removeItem('rw-midnight-boot'); {R}.settings.set('motion', 'reduced'); {R}.themeManager.apply('aero', 'user')"); time.sleep(0.8)
    mpg.evaluate(f"{R}.themeManager.apply('midnight', 'user')"); time.sleep(2)
    red = mpg.evaluate(f"[{R}.backdrop.S && {R}.backdrop.S.boot, sessionStorage.getItem('rw-midnight-boot'), {R}.backdrop.running]")
    check("reduced motion: no boot intro, still road", red[0] in (None, -1) and red[1] is None and red[2] is False, red)
    mpg.evaluate(f"{R}.settings.set('motion', 'full')")
    check("worlds count says 16", "16 worlds" in mpg.inner_text("#worlds-count"), mpg.inner_text("#worlds-count"))
    mc.close()
    mc, mpg = fresh(BASE + "#world=midnight&form=psx-taxi")
    try: wait(mpg, f"{R}.engine.theme.id === 'midnight' && {R}.engine.toForm.id === 'psx-taxi'", 10000); ok = True
    except Exception: ok = False
    check("cold start via #world=midnight&form=psx-taxi", ok, mpg.evaluate(f"[{R}.engine.theme && {R}.engine.theme.id, {R}.engine.toForm.id]"))
    mc.close()
    mc, mpg = fresh()
    mpg.evaluate(f"{R}.themeManager.apply('aero', 'user')"); time.sleep(0.5)
    mpg.route("**/js/worlds/midnight.js", lambda r: r.abort())
    mpg.evaluate(f"{R}.themeManager.apply('midnight', 'user')"); time.sleep(2)
    mf = mpg.evaluate(f"[document.documentElement.dataset.theme, {R}.engine.theme.id, document.querySelector('#toast').textContent]")
    check("midnight pack failure reverts + toast", mf[0] == "aero" and mf[1] == "aero" and "Midnight Drive" in mf[2], mf)
    mc.close()

    # ---- mobile layout still fits
    m = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mp = m.new_page(); mp.goto(BASE); wait(mp, f"{R} && {R}.engine.toForm"); time.sleep(1)
    check("mobile: no horizontal scroll with new controls", mp.evaluate("document.documentElement.scrollWidth") <= 390, mp.evaluate("document.documentElement.scrollWidth"))
    b.close()

print("\n".join(out)); fails = [o for o in out if o.startswith("FAIL")]
print(f"\n{len(out) - len(fails)} passed, {len(fails)} failed"); sys.exit(1 if fails else 0)
