"""
Checks for the performance optimizations (per-world fonts, blur fallback,
lazy Spotify code, worker-drawn backdrops/thumbnails + cache, covered-stage
throttling, offline service worker + cached synth audio).

    python3 reverb-worlds/tests/optimization_test.py http://127.0.0.1:8765/reverb-worlds/
"""
import os, re, sys, time, pathlib
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/reverb-worlds/"
ROOT = pathlib.Path(__file__).resolve().parent.parent
out = []
def check(n, c, d=""): out.append(f"{'PASS' if c else 'FAIL'}  {n}{'  — ' + str(d) if d else ''}")
def wait(page, js, timeout=15000): page.wait_for_function(js, timeout=timeout)

# ---- static: the service worker pre-caches every shipped file, and every listed file exists
sw = (ROOT / "sw.js").read_text()
listed = set(re.findall(r"^\s+'([^']+)',$", sw, re.M)) - {"./"}
shipped = {p.relative_to(ROOT).as_posix() for p in [*ROOT.glob("js/**/*.js"), *ROOT.glob("css/*.css"), *ROOT.glob("assets/**/*.*")]} | {"index.html"}
check("sw.js pre-caches every shipped file", shipped <= listed, sorted(shipped - listed))
df_src = (ROOT / "js/worlds/deepfield.js").read_text(encoding="utf-8")
check("Deep Field ships Deep-Fold's MIT notice", all(s in df_src for s in ["Copyright (c) 2020 Deep-Fold", "Copyright (c) 2021 Deep-Fold", "Permission is hereby granted, free of charge"]))
check("sw.js install bypasses the HTTP cache (a new build must not pre-cache the previous build's files)",
      re.search(r"new Request\(\w+, \{ cache: 'reload' \}\)", sw) is not None and "c.addAll(SHELL)" not in sw)
check("every file sw.js lists exists", all((ROOT / f).exists() for f in listed), [f for f in listed if not (ROOT / f).exists()])

with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page(); reqs, errs = [], []
    pg.on("request", lambda r: reqs.append(r.url))
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "#world=baroque"); wait(pg, "window.__reverb && window.__reverb.engine.toForm"); time.sleep(1.5)

    # 1. fonts
    fam = lambda: sorted(pg.evaluate("window.RW_FONTS.loadedFamilies()"))
    css = [u for u in reqs if "fonts.googleapis.com/css2" in u]
    first = re.findall(r"family=([^:&]+)", css[0]) if css else []
    check("1 · first font request is only the active world's families", sorted(f.replace("+", " ") for f in first) == ["EB Garamond", "Playfair Display"], first)
    try: wait(pg, "window.RW_FONTS.loadedFamilies().length > 2", 6000)  # idle preload of neighbours
    except Exception: pass
    check("1 · neighbouring worlds' fonts preloaded on idle", {"Archivo", "Permanent Marker", "Cinzel"} & set(fam()) or {"Shippori Mincho"} & set(fam()), fam())
    check("1 · far worlds not downloaded", not ({"Orbitron", "Major Mono Display", "Varela Round"} & set(fam())), fam())
    pg.evaluate("window.__reverb.themeManager.apply('glitch')"); time.sleep(0.3)
    check("1 · switching world loads its fonts", {"JetBrains Mono", "Major Mono Display", "VT323"} <= set(fam()), fam())

    # 2. blur fallback
    check("2 · blur on by default (auto)", pg.evaluate("document.documentElement.dataset.blur") == "on")
    handled = pg.evaluate("window.__reverb.engine.hooks.onSlow()")
    bf = pg.evaluate("getComputedStyle(document.querySelector('.panel')).backdropFilter")
    check("2 · slow frames turn the panel blur off first (detail kept)", handled is True and pg.evaluate("document.documentElement.dataset.blur") == "off" and bf in ("none", ""), bf)
    check("2 · second slow report falls through to detail reduction", pg.evaluate("window.__reverb.engine.hooks.onSlow()") is False)

    # 3. lazy Spotify code
    sp0 = [u for u in reqs if re.search(r"/spotify-(sdk|embed|common)\.js", u)]
    check("3 · no Spotify modules downloaded at startup", not sp0, sp0)
    check("3 · stand-in answers state without loading", pg.evaluate("window.__reverb.sdk.loaded === false && window.__reverb.sdk.signedIn === false && window.__reverb.sdk.deviceId === null"))
    pg.evaluate("window.__reverb.embed.ensureLoaded()"); wait(pg, "window.__reverb.embed.loaded")
    check("3 · first use loads the module", any("spotify-embed.js" in u for u in reqs))

    # 4. worker-drawn thumbnails & backdrops
    pg.evaluate("document.querySelector('#worlds-panel').scrollIntoView()"); time.sleep(2.5)
    kinds = pg.evaluate("[...document.querySelectorAll('.world-card canvas')].map(c=>c.dataset.thumb||'')")
    check("4 · thumbnails drawn in the worker", kinds.count("worker") >= 10, kinds)
    lit = pg.evaluate("(()=>{const c=document.querySelector('.world-card canvas').getContext('2d').getImageData(0,0,320,180).data;let s=0;for(let i=0;i<c.length;i+=97)s+=c[i];return s})()")
    check("4 · thumbnail pixels actually drawn", lit > 1000, lit)
    pg.evaluate("scrollTo(0,0)")
    pg.evaluate("window.__reverb.themeManager.apply('stained')"); wait(pg, "!window.__reverb.backdrop.pending")
    check("4 · backdrop layers arrive as ImageBitmaps from the worker", pg.evaluate("window.__reverb.backdrop.S.base instanceof ImageBitmap"))
    cached = pg.evaluate("""(async()=>{ const w=new Worker(new URL('./js/hologram/backdrop-worker.js', location.href),{type:'module'});
      const ask=()=>new Promise(r=>{w.onmessage=e=>r(e.data.cached); w.postMessage({type:'thumb',id:'aero',renderer:'aero',w:64,h:36,build:'test-'+Date.now()%1})});
      const a=await ask(), b=await ask(); w.terminate(); return [a,b]; })()""")
    check("4 · thumbnails cached after first draw (non-dev build)", cached == [False, True], cached)

    # 5. covered / off-screen throttling
    pg.click("#nav-settings"); time.sleep(0.2)
    check("5 · settings open → hologram 8 fps, backdrop 5 fps", pg.evaluate("window.__reverb.engine.maxFps === 8 && window.__reverb.backdrop.maxFps === 5"))
    pg.keyboard.press("Escape"); time.sleep(0.2)
    check("5 · closed → full rate again", pg.evaluate("window.__reverb.engine.maxFps === 0 && window.__reverb.backdrop.maxFps === 0"))
    pg.set_viewport_size({"width": 1440, "height": 420}); time.sleep(0.4)  # short window so the stage can fully leave the screen
    pg.evaluate("scrollTo(0, document.body.scrollHeight)"); time.sleep(0.6)
    off = pg.evaluate("({running: window.__reverb.engine.running, stageBottom: Math.round(document.querySelector('.stage').getBoundingClientRect().bottom)})")
    pg.evaluate("scrollTo(0,0)"); time.sleep(0.6)
    check("5 · hologram stops while scrolled off-screen, resumes after", off["running"] is False and off["stageBottom"] < 0 and pg.evaluate("window.__reverb.engine.running") is True, off)
    pg.set_viewport_size({"width": 1440, "height": 900})
    check("no JS errors", not errs, errs[:3])
    ctx.close()

    # 6. service worker + audio cache (enabled locally with ?sw=1)
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    pg.goto(BASE + "?sw=1"); wait(pg, "window.__reverb")
    pg.evaluate("navigator.serviceWorker.ready"); pg.reload(); wait(pg, "window.__reverb && !!navigator.serviceWorker.controller")
    n = pg.evaluate("(async()=>{const k=(await caches.keys()).find(k=>k.startsWith('rw-shell-'));return (await (await caches.open(k)).keys()).length})()")
    check("6 · service worker controls the page and pre-cached the shell", n >= len(listed), n)
    pg.click("#pl-play"); wait(pg, "window.__reverb.player.state.playing", 40000)
    wait(pg, "(async()=>{const c=await caches.open('rw-audio-v1');return (await c.keys()).length>0})()", 20000)
    ctx.set_offline(True)
    pg.reload(); wait(pg, "window.__reverb && window.__reverb.engine.toForm")
    check("6 · reloads fully offline from the cache", pg.evaluate("document.querySelectorAll('.world-card').length") == 15)
    t0 = time.time(); pg.click("#pl-play"); wait(pg, "window.__reverb.player.state.playing", 20000); dt = time.time() - t0
    check("6 · cached REVERB Original plays without re-synthesising (offline)", pg.evaluate("window.__reverb.media.cacheHits") >= 1 and dt < 3, f"{dt:.2f}s")
    b.close()

print("\n".join(out)); fails = [o for o in out if o.startswith("FAIL")]
print(f"\n{len(out) - len(fails)} passed, {len(fails)} failed"); sys.exit(1 if fails else 0)
