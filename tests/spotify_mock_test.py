"""
Spotify Web Playback SDK integration test against MOCKED Spotify endpoints.

It verifies REVERB's side of the contract (PKCE parameters, token exchange
without a secret, SDK wiring, device transfer, capability-driven UI). It does
NOT prove real Spotify accepts your app — that needs your Client ID + Premium.

    python3 reverb-worlds/tests/spotify_mock_test.py http://127.0.0.1:8765/reverb-worlds/
"""
import json, os, sys, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/reverb-worlds/"
CID = "0123456789abcdef0123456789abcdef"
seen = {"authorize": None, "token": None, "api": []}
out = []
def wait_until(fn, timeout=8.0, page=None):
    end = time.time() + timeout
    while time.time() < end:
        if fn(): return True
        (page.wait_for_timeout(100) if page else time.sleep(0.1))
    return False
def check(n, c, d=""): out.append(f"{'PASS' if c else 'FAIL'}  {n}{'  — ' + str(d) if d else ''}")

SDK_MOCK = """
window.__mockCalls = [];
window.Spotify = { Player: class {
  constructor(o) { this.o = o; this.l = {}; }
  addListener(e, f) { this.l[e] = f; }
  connect() {
    this.o.getOAuthToken(t => window.__mockToken = t);
    setTimeout(() => {
      this.l.ready({ device_id: 'dev-123' });
      this.l.player_state_changed({ paused: false, loading: false, position: 1000, duration: 200000, shuffle: false, repeat_mode: 0,
        track_window: { current_track: { name: 'Mock Song', uri: 'spotify:track:aaa', artists: [{ name: 'Mock Artist' }], album: { name: 'Mock Album', images: [] } },
                        next_tracks: [{ name: 'Next Song', uri: 'spotify:track:bbb', artists: [{ name: 'Other Artist' }] }] } });
    }, 100);
    return Promise.resolve(true);
  }
  togglePlay() { window.__mockCalls.push('toggle'); return Promise.resolve(); }
  nextTrack() { window.__mockCalls.push('next'); return Promise.resolve(); }
  previousTrack() { window.__mockCalls.push('prev'); return Promise.resolve(); }
  seek(ms) { window.__mockCalls.push('seek:' + ms); return Promise.resolve(); }
  setVolume(v) { window.__mockCalls.push('vol:' + v); return Promise.resolve(); }
  resume() { return Promise.resolve(); } pause() { return Promise.resolve(); }
  activateElement() {} disconnect() {}
} };
window.onSpotifyWebPlaybackSDKReady && window.onSpotifyWebPlaybackSDKReady();
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})

    def authorize(route):
        q = parse_qs(urlparse(route.request.url).query); seen["authorize"] = q
        route.fulfill(status=302, headers={"Location": f"{BASE}?code=test-code&state={q['state'][0]}"})
    def token(route):
        seen["token"] = parse_qs(route.request.post_data or "")
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"access_token": "tok-1", "refresh_token": "ref-1", "expires_in": 3600, "scope": "streaming"}))
    def api(route):
        seen["api"].append((route.request.method, route.request.url, route.request.post_data))
        if route.request.method == "GET" and route.request.url.endswith("/me/player/devices"):
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"devices": [{"id": "dev-123", "is_active": False, "name": "REVERB // WORLDS"}]}))
        if route.request.method == "PUT" and "/me/player/play" in route.request.url and seen.get("fail_play_once"):
            seen["fail_play_once"] = False
            return route.fulfill(status=404, content_type="application/json", body=json.dumps({"error": {"status": 404, "message": "Device not found"}}))
        if route.request.method == "GET" and "/v1/search" in route.request.url:
            q = parse_qs(urlparse(route.request.url).query)
            types = q["type"][0].split(","); off = int(q.get("offset", ["0"])[0])
            body = {}
            if "track" in types: body["tracks"] = {"items": [{"name": f"Blinding Song {off+1}", "uri": "spotify:track:0VjIjW4GlUZAMYd2vXMi3b", "external_urls": {"spotify": "https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b"}, "artists": [{"name": "Some Artist"}], "album": {"name": "Some Album", "uri": "spotify:album:4yP0hdKOZPNshxUOjY0cZj", "images": []}, "duration_ms": 200000}], "next": "x" if off == 0 else None}
            if "playlist" in types: body["playlists"] = {"items": [None, {"name": "Chill Search Hits", "uri": "spotify:playlist:37i9dQZF1DX4WYpdgoIcn6", "external_urls": {"spotify": "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6"}, "owner": {"display_name": "Spotify"}, "images": [], "items": {"total": 100}}], "next": None}
            if "album" in types: body["albums"] = {"items": [{"name": "Some Album", "uri": "spotify:album:4yP0hdKOZPNshxUOjY0cZj", "artists": [{"name": "Some Artist"}], "images": [], "release_date": "2020-03-20"}], "next": None}
            if "artist" in types: body["artists"] = {"items": [{"name": "Some Artist", "uri": "spotify:artist:1Xyo4u8uXC1ZmMpatF05PJ", "images": []}], "next": None}
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        if route.request.method == "GET" and "/me/playlists" in route.request.url:
            body = {"items": [
                {"id": "37i9dQZF1DX0XUsuxWHRQd", "name": "Late Night Drive", "uri": "spotify:playlist:37i9dQZF1DX0XUsuxWHRQd", "external_urls": {"spotify": "https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd"}, "images": [{"url": "data:image/gif;base64,R0lGODlhAQABAAAAACw=", "width": 300}], "items": {"total": 42}, "owner": {"display_name": "Jowo"}},
                {"id": "37i9dQZF1DWZeKCadgRdKQ", "name": "Focus", "uri": "spotify:playlist:37i9dQZF1DWZeKCadgRdKQ", "external_urls": {"spotify": "https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ"}, "images": [], "tracks": {"total": 7}, "owner": {"display_name": "Jowo"}}],
                "next": None}
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        route.fulfill(status=204, body="")
    ctx.route("https://accounts.spotify.com/authorize*", authorize)
    ctx.route("https://accounts.spotify.com/api/token", token)
    ctx.route("https://api.spotify.com/**", api)
    ctx.route("https://sdk.scdn.co/spotify-player.js", lambda r: r.fulfill(status=200, content_type="application/javascript", body=SDK_MOCK))

    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_function("window.__reverb")
    pg.evaluate(f"window.__reverb.settings.set('spotifyClientId', '{CID}')")
    pg.click("#nav-library"); pg.click("#tab-sources")
    check("login enabled once Client ID set", not pg.is_disabled("#sdk-login"))
    pg.click("#sdk-login")
    pg.wait_for_function("window.__reverb && window.__reverb.sdk.deviceId === 'dev-123'", timeout=20000)
    a = seen["authorize"]
    check("authorize: response_type=code + PKCE S256", a["response_type"] == ["code"] and a["code_challenge_method"] == ["S256"] and len(a["code_challenge"][0]) >= 43)
    check("authorize: redirect_uri equals site URL", a["redirect_uri"] == [BASE], a["redirect_uri"])
    check("authorize: streaming scope requested", "streaming" in a["scope"][0])
    t = seen["token"]
    check("token exchange uses code_verifier, no client_secret", t.get("code_verifier") and "client_secret" not in t and t["client_id"] == [CID])
    check("URL cleaned after redirect", "code=" not in pg.url, pg.url)
    wait_until(lambda: any(m == "PUT" and u.endswith("/me/player") for m, u, _ in seen["api"]), page=pg)
    check("transfer playback to REVERB device", any(m == "PUT" and u.endswith("/me/player") and "dev-123" in (d or "") for m, u, d in seen["api"]))
    st = pg.evaluate("window.__reverb.player.state")
    check("track metadata from SDK", st["track"]["title"] == "Mock Song" and st["track"]["artist"] == "Mock Artist")
    check("read-only queue shows next track", [q["title"] for q in st["queue"]] == ["Mock Song", "Next Song"])
    hidden = pg.evaluate("['#pl-prev','#pl-next','#pl-shuffle','#pl-repeat','#pl-mute','#pl-volume'].map(s=>document.querySelector(s).hidden)")
    check("SDK exposes full transport controls", not any(hidden), hidden)
    check("queue items are not clickable (read-only)", pg.evaluate("document.querySelectorAll('#queue button').length") == 0)
    check("visualizer stays ambient for SDK audio", "Ambient" in pg.inner_text("#viz-mode"), pg.inner_text("#viz-mode"))
    a2 = seen["authorize"]
    check("authorize: playlist-read scopes requested", "playlist-read-private" in a2["scope"][0])
    pg.click("#tab-sources")
    pg.wait_for_function("document.querySelectorAll('#playlist-grid .pl-card').length === 2", timeout=8000)
    names = pg.evaluate("[...document.querySelectorAll('#playlist-grid .pl-name')].map(e=>e.textContent)")
    metas = pg.evaluate("[...document.querySelectorAll('#playlist-grid .pl-meta')].map(e=>e.textContent)")
    check("playlists listed after login (both 2026 'items' and legacy 'tracks' counts)", names == ["Late Night Drive", "Focus"] and metas[0].startswith("42 tracks") and metas[1].startswith("7 tracks"), (names, metas))
    pg.click("#playlist-grid .pl-card >> nth=0")
    wait_until(lambda: any("/me/player/play" in u and "spotify:playlist:37i9dQZF1DX0XUsuxWHRQd" in (d or "") for _, u, d in seen["api"]), page=pg)
    check("clicking a playlist plays it on the REVERB device", any("/me/player/play" in u and "spotify:playlist:37i9dQZF1DX0XUsuxWHRQd" in (d or "") for _, u, d in seen["api"]))
    check("playing playlist is marked", pg.get_attribute("#playlist-grid .pl-card >> nth=0", "aria-current") == "true")
    pg.fill("#search", "focus"); time.sleep(0.2)
    check("search filters playlists", pg.evaluate("document.querySelectorAll('#playlist-grid .pl-card').length") == 1)
    pg.fill("#search", "")
    pg.click("#pl-next"); pg.click("#pl-play")
    pg.evaluate("window.__reverb.player.seek(42)")
    calls = pg.evaluate("window.__mockCalls")
    check("next / play / seek reach the SDK", "next" in calls and "toggle" in calls and "seek:42000" in calls, calls)
    pg.click("#pl-shuffle"); pg.click("#pl-repeat")
    wait_until(lambda: any("/me/player/repeat" in u for _, u, _ in seen["api"]) and any("/me/player/shuffle" in u for _, u, _ in seen["api"]), page=pg)
    urls = [u for _, u, _ in seen["api"]]
    check("shuffle & repeat via Web API", any("/me/player/shuffle?state=true" in u for u in urls) and any("/me/player/repeat?state=context" in u for u in urls))
    # ---- catalogue search
    pg.click("#tab-sources")
    pg.fill("#sp-search", "blinding"); pg.press("#sp-search", "Enter")
    pg.wait_for_function("document.querySelectorAll('#sp-results .sp-item').length >= 4", timeout=8000)
    groups = pg.evaluate("[...document.querySelectorAll('#sp-results .sp-group h4')].map(h=>h.textContent)")
    check("search returns songs, playlists, albums, artists (null items skipped)", groups == ["Songs", "Playlists", "Albums", "Artists"], groups)
    sq = [u for _, u, _ in seen["api"] if "/v1/search" in u][-1]
    check("search respects 2026 dev-mode limit=10", "limit=10" in sq and "q=blinding" in sq, sq)
    n0 = len(seen["api"])
    pg.click("#sp-results .sp-item[data-type=track] .sp-play")
    wait_until(lambda: any("/me/player/play" in u and "4yP0hdKOZPNshxUOjY0cZj" in (d or "") for _, u, d in seen["api"][n0:]), page=pg)
    pb = [json.loads(d) for _, u, d in seen["api"][n0:] if "/me/player/play" in u and d]
    check("clicking a song plays it within its album (next/prev keep working)", pb and pb[-1] == {"context_uri": "spotify:album:4yP0hdKOZPNshxUOjY0cZj", "offset": {"uri": "spotify:track:0VjIjW4GlUZAMYd2vXMi3b"}}, pb[-1:])
    n0 = len(seen["api"])
    pg.click("#sp-results .sp-item[data-type=track] .sp-actions .btn")
    wait_until(lambda: any(m == "POST" and "/me/player/queue?uri=spotify%3Atrack%3A0VjIjW4GlUZAMYd2vXMi3b" in u for m, u, _ in seen["api"][n0:]), page=pg)
    check("+ Queue adds a song to the Spotify queue", any(m == "POST" and "/me/player/queue" in u for m, u, _ in seen["api"][n0:]))
    pg.click("#sp-results .sp-more")
    pg.wait_for_function("document.querySelectorAll('#sp-results .sp-item[data-type=track]').length === 2", timeout=8000)
    check("Load more pages with offset=10", any("/v1/search" in u and "offset=10" in u for _, u, _ in seen["api"]))
    pg.check('input[name="sp-type"][value="playlist"]')
    pg.wait_for_function("document.querySelectorAll('#sp-results .sp-item').length === 1 && document.querySelector('#sp-results .sp-item').dataset.type === 'playlist'", timeout=8000)
    check("type filter searches playlists only", [u for _, u, _ in seen["api"] if "/v1/search" in u][-1].count("type=playlist&") == 1)
    n0 = len(seen["api"])
    pg.click("#sp-results .sp-item[data-type=playlist] .sp-play")
    wait_until(lambda: any("/me/player/play" in u and "37i9dQZF1DX4WYpdgoIcn6" in (d or "") for _, u, d in seen["api"][n0:]), page=pg)
    check("clicking a searched playlist plays it", any("/me/player/play" in u and "37i9dQZF1DX4WYpdgoIcn6" in (d or "") for _, u, d in seen["api"][n0:]))
    pg.check('input[name="sp-type"][value="all"]')

    # ---- 404 'device not found' → recover (devices + transfer) and retry once
    seen["fail_play_once"] = True; n0 = len(seen["api"])
    pg.click("#sp-results .sp-item[data-type=album] .sp-play") if pg.locator("#sp-results .sp-item[data-type=album]").count() else pg.click("#playlist-grid .pl-card >> nth=1")
    wait_until(lambda: sum(1 for m, u, _ in seen["api"][n0:] if m == "PUT" and "/me/player/play" in u) >= 2, timeout=12, page=pg)
    calls = [(m, u.split("/v1")[-1]) for m, u, _ in seen["api"][n0:]]
    plays = [c for c in calls if c[0] == "PUT" and "/me/player/play" in c[1]]
    check("404 device-not-found recovers: checks devices, transfers, retries play", len(plays) >= 2 and ("GET", "/me/player/devices") in calls and ("PUT", "/me/player") in calls, calls)
    pg.wait_for_timeout(300)
    check("no 404 error left on screen after recovery", "404" not in pg.inner_text("#np-status"), pg.inner_text("#np-status"))

    # Play with nothing loaded on the device → resume last context instead of a raw SDK error
    pg.evaluate("window.__reverb.sdk.sdkState = null")
    n0 = len(seen["api"]); pg.click("#pl-play")
    wait_until(lambda: any(m == "PUT" and u.endswith("/me/player/play?device_id=dev-123") and not d for m, u, d in seen["api"][n0:]), page=pg)
    check("Play with nothing loaded resumes last Spotify context (no 'no list was loaded' error)", any(m == "PUT" and u.endswith("/me/player/play?device_id=dev-123") and not d for m, u, d in seen["api"][n0:]) and "no list" not in pg.inner_text("#np-status"))
    pg.click("#tab-sources"); pg.fill("#sdk-input", "https://open.spotify.com/album/1A2GTWGtFfWp7KSQTwWOyo")
    pg.click("#sdk-form button[type=submit]")
    wait_until(lambda: any("/me/player/play?device_id=dev-123" in u and "1A2GTWGtFfWp7KSQTwWOyo" in (d or "") for _, u, d in seen["api"]), page=pg)
    play = [d for m, u, d in seen["api"] if "/me/player/play?device_id=dev-123" in u]
    check("Play on Spotify sends context_uri", play and json.loads(play[-1])["context_uri"] == "spotify:album:1A2GTWGtFfWp7KSQTwWOyo", play[-1:] )
    check("token kept in sessionStorage, not localStorage", pg.evaluate("!!sessionStorage.getItem('rw:spotify:token') && !JSON.stringify(localStorage).includes('tok-1')"))
    pg.click("#sdk-logout"); time.sleep(0.3)
    check("sign out clears token and returns to REVERB player", pg.evaluate("!sessionStorage.getItem('rw:spotify:token') && window.__reverb.player.active.id === 'media'"))
    check("no JS errors", not errs, errs[:3])

    # ---------------- Spotify Embed (iFrame API mocked) ----------------
    EMBED_MOCK = """
    window.__embedCalls = [];
    window.onSpotifyIframeApiReady({ createController(el, opts, cb) {
      const f = document.createElement('iframe'); f.title = 'mock embed ' + opts.uri; el.replaceWith(f);
      const L = {}; const c = { addListener: (e, fn) => L[e] = fn,
        resume() { window.__embedCalls.push('resume'); L.playback_update({ data: { isPaused: false, isBuffering: false, position: 5000, duration: 30000, playingURI: opts.uri } }); },
        pause() { window.__embedCalls.push('pause'); L.playback_update({ data: { isPaused: true, isBuffering: false, position: 6000, duration: 30000 } }); },
        togglePlay() { window.__embedCalls.push('toggle'); }, seek(s) { window.__embedCalls.push('seek:' + s); }, loadUri(u) { window.__embedCalls.push('load:' + u); } };
      cb(c); setTimeout(() => L.ready && L.ready(), 50);
    } });"""
    ctx2 = b.new_context(viewport={"width": 1440, "height": 900})
    ctx2.route("https://open.spotify.com/embed/iframe-api/v1", lambda r: r.fulfill(status=200, content_type="application/javascript", body=EMBED_MOCK))
    ctx2.route("https://open.spotify.com/oembed*", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"title": "Mock Playlist", "thumbnail_url": "data:image/gif;base64,R0lGODlhAQABAAAAACw="})))
    e = ctx2.new_page(); eerr = []
    e.on("pageerror", lambda x: eerr.append(str(x)))
    e.goto(BASE); e.wait_for_function("window.__reverb")
    e.click("#nav-library"); e.click("#tab-sources")
    e.fill("#embed-input", "https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc")
    e.click("#embed-form button[type=submit]")
    e.wait_for_function("window.__reverb.player.state.status === 'ready'", timeout=10000)
    check("embed: iframe mounted & surface visible", e.is_visible("#spotify-surface") and e.evaluate("!!document.querySelector('#spotify-surface iframe')"))
    dock = e.evaluate("""(() => { const s = document.querySelector('#spotify-surface'); const bar = document.querySelector('#player'); const f = s.querySelector('iframe'); return { inBar: bar.contains(s), barEmbed: bar.classList.contains('player--embed'), centerHidden: getComputedStyle(bar.querySelector('.player-center')).display === 'none', h: Math.round(f.getBoundingClientRect().height), barBottom: Math.round(bar.getBoundingClientRect().bottom), vh: innerHeight }; })()""")
    check("embed docked inside the player bar (compact 80px, no floating panel)", dock["inBar"] and dock["barEmbed"] and dock["centerHidden"] and dock["h"] == 80 and dock["barBottom"] <= dock["vh"], dock)
    if os.environ.get("SHOT_DIR"): e.screenshot(path=os.environ["SHOT_DIR"] + "/embed-docked.png")
    check("embed: title from oEmbed", e.inner_text("#pl-title") == "Mock Playlist", e.inner_text("#pl-title"))
    e.evaluate("window.__reverb.player.toggle()"); time.sleep(0.2)
    est = e.evaluate("window.__reverb.player.state")
    check("embed: play → controller.resume + progress", "resume" in e.evaluate("window.__embedCalls") and est["playing"] and est["duration"] == 30)
    check("embed: seek disabled for playlists (API seek is for episodes)", e.is_disabled("#pl-seek"))
    e.fill("#embed-input", "spotify:episode:4rOoJ6Egrf8K2IrywzwOMk"); e.click("#embed-form button[type=submit]"); time.sleep(0.3)
    e.evaluate("window.__reverb.embed._onReady()")
    e.evaluate("window.__reverb.player.seek(12)")
    check("embed: episode → loadUri + seek allowed", "load:spotify:episode:4rOoJ6Egrf8K2IrywzwOMk" in e.evaluate("window.__embedCalls") and "seek:12" in e.evaluate("window.__embedCalls"))
    e.fill("#embed-input", "not a link"); e.click("#embed-form button[type=submit]"); time.sleep(0.2)
    check("embed: invalid link → clear error", "doesn’t look like" in e.inner_text("#np-status"), e.inner_text("#np-status"))
    check("embed: no JS errors", not eerr, eerr[:3])
    b.close()

print("\n".join(out)); fails = [o for o in out if o.startswith("FAIL")]
print(f"\n{len(out) - len(fails)} passed, {len(fails)} failed"); sys.exit(1 if fails else 0)
