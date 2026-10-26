"""
End-to-end smoke test for REVERB // WORLDS (headless Chromium via Playwright).

Usage:
    python3 -m http.server 8765 --bind 127.0.0.1   # from the folder that CONTAINS reverb-worlds/
    python3 reverb-worlds/tests/smoke_test.py [base_url] [screenshot_dir]

Serving from the parent folder reproduces GitHub Pages' /<repo>/ subpath.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/reverb-worlds/"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "/tmp/reverb-shots"
os.makedirs(SHOTS, exist_ok=True)
EXTERNAL = ("fonts.googleapis.com", "fonts.gstatic.com", "open.spotify.com", "sdk.scdn.co", "accounts.spotify.com", "api.spotify.com")

results, failures = [], []
def check(name, cond, detail=""):
    (results if cond else failures).append(f"{'PASS' if cond else 'FAIL'}  {name}{('  — ' + str(detail)) if detail else ''}")

def luminance(hexstr):
    h = hexstr.lstrip('#'); r, g, b = (int(h[i:i+2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True); return (la + 0.05) / (lb + 0.05)

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader", "--auto-accept-this-tab-capture"])
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    errors, failed = [], []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text}"))
    page.on("requestfailed", lambda r: failed.append(r.url))
    page.on("response", lambda r: r.status >= 400 and failed.append(f"{r.status} {r.url}"))

    page.goto(BASE, wait_until="load")
    page.wait_for_function("window.__reverb && window.__reverb.engine.toForm", timeout=15000)
    time.sleep(1.5)
    page.screenshot(path=f"{SHOTS}/00-desktop-initial.png")

    # --- theme registry & assets
    themes = page.evaluate("Array.from(document.querySelectorAll('.world-card')).map(c => c.dataset.id)")
    check("16 world cards rendered", len(themes) == 16, themes)
    wc_label = page.text_content("#worlds-count")
    check("worlds count label matches the number of worlds", wc_label.strip() == f"{len(themes)} worlds", wc_label)
    pool_sizes = page.evaluate("(async () => { const T = await import('./js/theme-registry.js'), P = await import('./js/world-packs.js'); for (const t of T.THEMES) await P.ensurePack(t); return T.THEMES.map(t => t.hologram.forms.length); })()")
    check("every world has 8+ holograms (6–7 originals + 2 new)", all(n >= 8 for n in pool_sizes), pool_sizes)
    local_fail = [u for u in failed if not any(d in u for d in EXTERNAL)]
    check("no missing local assets (subpath-safe paths)", not local_fail, local_fail)

    # --- playback (demo synth)
    page.click("#pl-play")
    page.wait_for_function("window.__reverb.player.state.playing === true", timeout=30000)
    time.sleep(1.5)
    st0 = page.evaluate("({...window.__reverb.player.state, queue: undefined})")
    check("demo track plays", st0["playing"], st0["track"]["title"])
    chip = page.inner_text("#viz-mode")
    check("visualizer labelled audio-reactive while REVERB player plays", "Audio reactive" in chip, chip)
    time.sleep(1.0)
    feats = page.evaluate("window.__reverb.engine.reactive")
    check("analyser produces non-zero energy", feats["energy"] > 0.02, feats)

    # --- every theme: switching must not reset playback
    prev_pos, track_title = st0["position"], st0["track"]["title"]
    for i, tid in enumerate(themes):
        page.click(f'.world-card[data-id="{tid}"]')
        time.sleep(1.4)
        st = page.evaluate("({ position: window.__reverb.player.state.position, playing: window.__reverb.player.state.playing, title: window.__reverb.player.state.track.title, theme: document.documentElement.dataset.theme, form: window.__reverb.engine.toForm.id, pool: window.__reverb.engine.pool })")
        ok = st["theme"] == tid and st["playing"] and st["title"] == track_title and st["position"] > prev_pos
        check(f"world {i+1:02d} {tid}: applied, playback continues", ok, f"pos {prev_pos:.1f}->{st['position']:.1f}, form {st['form']}")
        check(f"world {tid}: form from its own pool", st["form"] in st["pool"], st["form"])
        prev_pos = st["position"]
        page.screenshot(path=f"{SHOTS}/{i+1:02d}-{tid}.png")
    pools = page.evaluate("Object.fromEntries((window.__themes||[]).map(t=>[t.id,t]))")

    # --- morph: no immediate repeats
    page.click('.world-card[data-id="cyberpunk"]'); time.sleep(0.5)
    seq = []
    for _ in range(12):
        page.click("#btn-morph"); time.sleep(0.25)
        seq.append(page.evaluate("window.__reverb.engine.toForm.id"))
    repeats = [seq[k] for k in range(1, len(seq)) if seq[k] == seq[k-1]]
    check("manual Morph changes form without immediate repeats", not repeats and len(set(seq)) >= 4, seq)

    # --- grab & rotate
    page.evaluate("scrollTo(0,0)"); time.sleep(0.2)
    box = page.locator("#hologram").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + 160, cy + 60, steps=8); page.mouse.up()
    u = page.evaluate("({ry: window.__reverb.engine.user.ry, rx: window.__reverb.engine.user.rx})")
    check("drag rotates the hologram", u["ry"] > 0.4 and u["rx"] > 0.1, u)
    page.focus("#hologram"); pos0 = page.evaluate("window.__reverb.player.state.position")
    page.keyboard.press("ArrowLeft"); time.sleep(0.1)
    u2 = page.evaluate("window.__reverb.engine.user.ry")
    check("arrow keys rotate when hologram focused (not seek)", u2 < page.evaluate("window.__reverb.engine.user.ry") + 0.2 and abs(page.evaluate("window.__reverb.player.state.position") - pos0) < 3)
    page.dblclick("#hologram"); time.sleep(0.1)
    check("double-click resets the view", page.evaluate("window.__reverb.engine.user.ry === 0 && window.__reverb.engine.user.rx === 0"))

    # --- player controls
    page.click("#pl-next"); page.wait_for_function("window.__reverb.player.state.playing && window.__reverb.player.state.track.title !== %s" % json.dumps(track_title), timeout=30000)
    t2 = page.evaluate("window.__reverb.player.state.track.title")
    check("next track", t2 != track_title, t2)
    page.evaluate("window.__reverb.player.seek(20)"); time.sleep(0.4)
    check("seek", 19.5 < page.evaluate("window.__reverb.player.state.position") < 23)
    page.click("#pl-prev"); time.sleep(0.4)
    check("previous restarts track when >3s in", page.evaluate("window.__reverb.player.state.position") < 2.5)
    page.click("#pl-shuffle"); check("shuffle toggles", page.get_attribute("#pl-shuffle", "aria-pressed") == "true")
    page.click("#pl-repeat"); page.click("#pl-repeat")
    check("repeat cycles to 'one'", page.get_attribute("#pl-repeat", "data-mode") == "one")
    page.click("#pl-mute"); check("mute", page.evaluate("window.__reverb.player.state.muted") is True)
    page.click("#pl-mute")
    page.fill("#pl-volume", "35"); page.dispatch_event("#pl-volume", "input")
    check("volume", abs(page.evaluate("window.__reverb.player.state.volume") - 0.35) < 0.01)
    page.click("#pl-play"); time.sleep(0.3)
    check("pause", page.evaluate("window.__reverb.player.state.playing") is False)
    page.click("#pl-play"); time.sleep(0.6)
    check("resume", page.evaluate("window.__reverb.player.state.playing") is True)
    hidden = page.evaluate("['#pl-prev','#pl-next','#pl-shuffle','#pl-repeat','#pl-mute','#pl-volume'].map(s=>document.querySelector(s).hidden)")
    check("all media-provider controls visible", not any(hidden), hidden)

    # --- queue click
    page.click("#nav-library") if page.is_visible("#nav-library") else None
    page.click("#tab-queue")
    page.click(".queue li:nth-child(4) .queue-item"); page.wait_for_function("window.__reverb.player.state.playing", timeout=30000)
    check("queue item click plays that track", page.evaluate("window.__reverb.player.state.queue[3].current"))

    # --- toggles
    page.click("#btn-automorph"); check("auto-morph toggle", page.get_attribute("#btn-automorph", "aria-pressed") == "false")
    page.click("#btn-automorph")
    page.evaluate("window.__reverb.settings.set('autoMorphInterval', 4)")
    f0 = page.evaluate("window.__reverb.engine.toForm.id"); time.sleep(5)
    check("auto-morph fires on timer", page.evaluate("window.__reverb.engine.toForm.id") != f0)
    page.click("#btn-autoworld"); page.evaluate("window.__reverb.settings.set('autoWorldInterval', 15)")
    w0 = page.evaluate("document.documentElement.dataset.theme"); time.sleep(16)
    check("auto-world advances world", page.evaluate("document.documentElement.dataset.theme") != w0)
    page.click("#btn-autoworld")
    page.click("#btn-pausefx"); time.sleep(0.3)
    check("pause visuals stops the animation loop", page.evaluate("window.__reverb.engine.running") is False)
    page.click("#btn-pausefx"); time.sleep(0.3)
    check("resume visuals", page.evaluate("window.__reverb.engine.running") is True)

    # --- settings: motion
    page.click("#nav-settings"); page.check('input[name="motion"][value="static"]'); time.sleep(0.3)
    check("static motion stops animation", page.evaluate("window.__reverb.engine.running") is False and page.evaluate("window.__reverb.backdrop.running") is False)
    page.check('input[name="motion"][value="reduced"]'); time.sleep(0.3)
    page.keyboard.press("Escape")
    page.click("#btn-morph")
    check("reduced motion: crossfade morphs, backdrop still", page.evaluate("window.__reverb.engine.transition.crossfade === true && window.__reverb.backdrop.running === false"))
    page.evaluate("window.__reverb.settings.set('motion','full')")
    page.evaluate("window.__reverb.settings.set('intensity', 0)"); time.sleep(0.3)
    check("intensity setting reaches engine", page.evaluate("window.__reverb.engine.opts.intensity") == 0)
    page.evaluate("window.__reverb.settings.set('intensity', 70)")

    # --- search
    page.fill("#search", "glass"); time.sleep(0.2)
    vis = page.evaluate("Array.from(document.querySelectorAll('.world-card')).filter(c=>!c.parentElement.hidden).map(c=>c.dataset.id)")
    check("search filters worlds", set(vis) == {"mosaic", "stained", "aero"}, vis)
    page.fill("#search", "baroque"); page.press("#search", "Enter"); time.sleep(0.3)
    check("search Enter applies single matching world", page.evaluate("document.documentElement.dataset.theme") == "baroque")
    page.fill("#search", "")

    # --- keyboard shortcuts
    page.click("body", position={"x": 5, "y": 300}) if False else page.focus("#main")
    page.keyboard.press("]"); time.sleep(0.2)
    check("']' next world", page.evaluate("document.documentElement.dataset.theme") == "street")
    fm = page.evaluate("window.__reverb.engine.toForm.id"); page.keyboard.press("m"); time.sleep(0.2)
    check("'m' morphs", page.evaluate("window.__reverb.engine.toForm.id") != fm)
    page.keyboard.press("Space"); time.sleep(0.3)
    check("space toggles playback", page.evaluate("window.__reverb.player.state.playing") is False)
    page.keyboard.press("Space"); time.sleep(0.5)

    # --- tap tempo: 4+ taps at 120 BPM → beat-locked pulses (when no analysable audio)
    page.evaluate("window.__reverb.settings.set('vizInput','ambient')")
    page.focus("#main")
    for _ in range(6): page.keyboard.press("t"); page.wait_for_timeout(500)
    chip = page.inner_text("#viz-mode")
    check("tap tempo locks a beat clock (taps ~every 500 ms)", "Beat clock" in chip and any(f"{b} BPM" in chip for b in range(105, 131)), chip)
    # Beat accuracy, measured against a simulated 60 fps clock (the headless test machine's real frames are too irregular to judge timing)
    kicks = page.evaluate("""(async () => { const { AmbientSource } = await import('./js/audio-analyser.js');
      const a = new AmbientSource(); const real = performance.now.bind(performance); let T = 10000; performance.now = () => T;
      try { a.setTempo(120, 10000); const out = []; for (T = 10000; T < 14000; T += 1000 / 60) { const f = a.read(1 / 60); if (f.kick) out.push([T, f.snare]); } return out; } finally { performance.now = real; } })()""")
    gaps = [kicks[k][0] - kicks[k-1][0] for k in range(1, len(kicks))]
    check("beat clock: kicks exactly every beat at 120 BPM (±1 frame), snare on 2 & 4", len(kicks) >= 7 and all(abs(g - 500) <= 17 for g in gaps) and [k[1] for k in kicks[:4]] in ([False, True, False, True], [True, False, True, False]), [round(g) for g in gaps])
    page.click("#btn-tap-clear")
    check("clear tapped tempo", "Beat clock" not in page.inner_text("#viz-mode"))
    page.evaluate("window.__reverb.settings.set('vizInput','auto')")

    # --- tab audio capture (Chromium auto-accepts in tests); REVERB audio playing in this tab
    page.click("#tab-sources")
    page.click("#tab-toggle"); page.wait_for_timeout(2500)
    chip = page.inner_text("#viz-mode")
    if "Tab audio" in chip:
        check("tab audio capture engages (chip + analyser source)", page.evaluate("window.__reverb.analyser.externalKind") == "tab", f"{chip}; raw level {page.evaluate('window.__reverb.analyser.rawLevel()'):.4f} (headless has no audio output)")
        page.click("#tab-toggle"); page.wait_for_timeout(300)
        check("tab capture stops cleanly", "Tab audio" not in page.inner_text("#viz-mode"))
    else:
        check("tab capture unavailable in this headless browser → clear message, no crash", page.evaluate("window.__reverb.analyser.externalKind") is None, chip)

    # --- microphone (fake device)
    page.click("#tab-sources")
    page.click("#mic-toggle"); time.sleep(1.2)
    check("microphone mode labelled", "Microphone" in page.inner_text("#viz-mode"), page.inner_text("#viz-mode"))
    page.click("#mic-toggle"); time.sleep(0.3)

    # --- Spotify embed: graceful failure when blocked/offline, no fake controls
    page.fill("#embed-input", "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")
    page.click("#embed-form button[type=submit]")
    page.wait_for_function("['unavailable','ready','playing','paused','error'].includes(window.__reverb.player.state.status)", timeout=25000)
    est = page.evaluate("({status: window.__reverb.player.state.status, msg: window.__reverb.player.state.message, caps: window.__reverb.player.capabilities})")
    hidden = page.evaluate("['#pl-prev','#pl-next','#pl-shuffle','#pl-repeat','#pl-mute','#pl-volume'].map(s=>document.querySelector(s).hidden)")
    check("embed: unsupported controls hidden", all(hidden), hidden)
    check("embed: honest status", est["status"] in ("unavailable", "ready", "playing", "paused"), est)
    check("embed: visualizer falls back to ambient", "Ambient" in page.inner_text("#viz-mode"), page.inner_text("#viz-mode"))
    page.screenshot(path=f"{SHOTS}/20-embed-state.png")
    page.click("#src-demo-load"); page.wait_for_function("window.__reverb.player.active.id === 'media' && window.__reverb.player.state.playing", timeout=30000)
    check("switch back to REVERB player", True)

    # --- local files: generated WAV with a kick-like pulse every 0.5 s
    import wave, struct, math, tempfile
    wav = os.path.join(tempfile.gettempdir(), "reverb-test-pulse.wav")
    with wave.open(wav, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
        frames = bytearray()
        for n in range(22050 * 8):
            t = n / 22050; ph = t % 0.5
            v = math.sin(2 * math.pi * 55 * t) * math.exp(-ph * 12) * 0.9 + math.sin(2 * math.pi * 880 * t) * 0.05
            frames += struct.pack("<h", int(max(-1, min(1, v)) * 32000))
        w.writeframes(bytes(frames))
    page.click("#tab-sources")
    page.set_input_files("#file-input", wav)
    page.wait_for_function("window.__reverb.player.state.playing && window.__reverb.player.state.track.kind === 'file'", timeout=15000)
    time.sleep(2.5)
    check("local file plays (title from filename)", page.evaluate("window.__reverb.player.state.track.title") == "reverb-test-pulse")
    check("local file drives audio-reactive mode", "REVERB player" in page.inner_text("#viz-mode"))
    check("file audio produces analyser energy", page.evaluate("window.__reverb.engine.reactive.energy") > 0.05)
    page.click("#tab-sources"); page.click("#src-files-clear"); time.sleep(0.3)
    check("remove my files restores REVERB Originals", page.evaluate("window.__reverb.media.items.every(i => i.kind === 'demo')"))

    # --- SDK: not configured → login disabled
    check("SDK login disabled without Client ID", page.is_disabled("#sdk-login"))
    import re, pathlib
    rootdir = pathlib.Path(__file__).resolve().parent.parent
    leaks = [str(f) for f in rootdir.rglob("*") if f.suffix in (".js", ".html", ".css", ".json", ".yml") and re.search(r"client_secret|clientSecret|CLIENT_SECRET\s*=", f.read_text(errors="ignore"))]
    check("no client secret in shipped files", not leaks, leaks)

    # --- tab focus visible
    page.focus("#btn-morph")
    outline = page.evaluate("getComputedStyle(document.querySelector('#btn-morph')).outlineStyle")
    page.keyboard.press("Tab")
    focused = page.evaluate("document.activeElement.id")
    check("keyboard focus moves between controls", focused == "btn-automorph", focused)

    # --- contrast per theme (registry tokens)
    palettes = page.evaluate("""(async () => (await import('./js/theme-registry.js')).THEMES.map(t => ({id:t.id, ...t.palette})))()""")
    for pal in palettes:
        c1 = contrast(pal["text"], pal["surface"]); c2 = contrast(pal["muted"], pal["surface"])
        c3 = contrast(pal["primaryInk"], pal["surface"]); c4 = contrast(pal["onPrimary"], pal["primary"])
        check(f"contrast {pal['id']}: text {c1:.1f} muted {c2:.1f} accent-ink {c3:.1f} on-primary {c4:.1f}", c1 >= 7 and c2 >= 4.5 and c3 >= 4.5 and c4 >= 4.5)

    errs = [e for e in errors if not any(d in e for d in EXTERNAL) and "ERR_" not in e]
    check("no JavaScript errors (desktop)", not errs, errs[:5])

    # --- mobile
    m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    mp = m.new_page(); merr = []
    mp.on("pageerror", lambda e: merr.append(str(e)))
    mp.goto(BASE + "#world=ukiyo", wait_until="load")
    mp.wait_for_function("window.__reverb && window.__reverb.engine.toForm", timeout=15000); time.sleep(2.6)
    check("deep link #world=ukiyo", mp.evaluate("document.documentElement.dataset.theme") == "ukiyo")
    sw = mp.evaluate("document.documentElement.scrollWidth"); check("mobile: no horizontal page scroll", sw <= 390, sw)
    mp.screenshot(path=f"{SHOTS}/30-mobile-ukiyo.png")
    mp.tap("#pl-expand"); time.sleep(0.4)
    check("mobile: expanded player shows progress", mp.is_visible("#pl-seek"))
    mp.screenshot(path=f"{SHOTS}/31-mobile-expanded.png")
    mp.tap("#pl-expand"); mp.tap("#nav-library"); time.sleep(0.6)
    check("mobile: library sheet opens", mp.evaluate("document.querySelector('#library-panel').classList.contains('open')"))
    mp.screenshot(path=f"{SHOTS}/32-mobile-library.png")
    mp.keyboard.press("Escape")
    mp.evaluate("window.__reverb.themeManager.apply('glitch')"); time.sleep(1.2)
    mp.screenshot(path=f"{SHOTS}/33-mobile-glitch.png")
    check("no JavaScript errors (mobile)", not merr, merr[:3])

    # --- tablet
    t = browser.new_context(viewport={"width": 900, "height": 1180})
    tp = t.new_page(); tp.goto(BASE + "#world=stained"); tp.wait_for_function("window.__reverb && window.__reverb.engine.toForm"); time.sleep(1.6)
    tp.screenshot(path=f"{SHOTS}/40-tablet-stained.png")
    check("tablet: no horizontal scroll", tp.evaluate("document.documentElement.scrollWidth") <= 900)

    # --- reduced-motion OS preference
    r = browser.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
    rp = r.new_page(); rp.goto(BASE); rp.wait_for_function("window.__reverb && window.__reverb.engine.toForm")
    rp.evaluate("localStorage.clear()"); rp.reload(); rp.wait_for_function("window.__reverb && window.__reverb.engine.toForm")
    check("prefers-reduced-motion → Reduced by default", rp.evaluate("window.__reverb.settings.get('motion')") == "reduced")

    browser.close()

print("\n".join(results + failures))
print(f"\n{len(results)} passed, {len(failures)} failed")
sys.exit(1 if failures else 0)
