#!/usr/bin/env python3
"""Easy Kit web check: serve <project>/web, open it in headless Chrome, play the village loop through
window.__kit and save screenshots.

    python3 scripts/check-web.py <project-dir> [--out shots/] [--port 8989] [--frames]

Exit code 0 when every check passes. Needs `pip install playwright` and Chrome/Chromium
(EASYKIT_CHROME or /usr/bin/google-chrome)."""
import argparse, functools, http.server, json, os, shutil, sys, threading, time

ap = argparse.ArgumentParser()
ap.add_argument("project")
ap.add_argument("--out", default=None)
ap.add_argument("--port", type=int, default=8989)
ap.add_argument("--frames", action="store_true", help="also save ~5 s of walking frames for a GIF")
a = ap.parse_args()
web = os.path.join(os.path.abspath(a.project), "web")
out = os.path.abspath(a.out or os.path.join(a.project, "shots-web"))
os.makedirs(out, exist_ok=True)
if not os.path.exists(os.path.join(web, "index.html")):
    sys.exit(f"no web build at {web}")

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), functools.partial(Quiet, directory=web))
threading.Thread(target=srv.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

chrome = os.environ.get("EASYKIT_CHROME") or shutil.which("google-chrome") or shutil.which("chromium") or None
passed, failed, errors = 0, 0, []

def check(ok, what):
    global passed, failed
    if ok:
        passed += 1
        print("  ok  ", what)
    else:
        failed += 1
        print("  FAIL", what)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1440, "height": 810}, device_scale_factor=1)
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{a.port}/index.html")
    page.wait_for_function("window.__ready === true || window.__error", timeout=60000)
    err = page.evaluate("window.__error || null")
    check(err is None, f"game boots ({err or 'window.__ready'})")
    if err:
        print("\n".join(errors[:10]))
        sys.exit(1)
    shot = lambda name: (page.locator("canvas").screenshot(path=os.path.join(out, name + ".png")), print("  shot", os.path.join(out, name + ".png")))
    ev = page.evaluate
    page.wait_for_timeout(600)
    check(ev("__kit.mode") == "title", "title screen")
    shot("01_title")
    ev("__kit.startGame()")
    page.wait_for_timeout(2500)
    check(ev("__kit.mode") == "cutscene", "intro cutscene (Easy Anim)")
    shot("02_cutscene")
    ev("__kit.endCutscene()")
    check(ev("__kit.mode") == "play", "play mode")
    x0 = ev("__kit.map.characters.get(__kit.kit.player).sprite.x")
    page.keyboard.down("ArrowLeft"); page.wait_for_timeout(500); page.keyboard.up("ArrowLeft")
    x1 = ev("__kit.map.characters.get(__kit.kit.player).sprite.x")
    check(x1 < x0 - 8, f"arrow keys walk the Easy Sprite player ({x0:.0f} → {x1:.0f})")
    ev("__kit.near('pa_daeng', -26, 10)")
    page.wait_for_timeout(300)
    shot("03_gameplay")
    coins0 = ev("__kit.inv.state.coins")
    check(ev("__kit.interact('pa_daeng')") == "dialogue:market", "Auntie Daeng → market segment")
    page.wait_for_timeout(400)
    ev("__kit.box.advance()")
    page.wait_for_timeout(500)
    shot("04_dialogue")
    ev("__kit.driveDialogue()")
    check(ev("__kit.manager.status('village_delivery')") == "active" and ev("__kit.manager.stepDone('village_delivery','accept')"), "quest started, accept done")
    check(ev("__kit.inv.state.coins") == coins0 + 10, "snack money into the wallet")
    for npc, seg in [("luang_phi", "temple"), ("lung_mee", "farm"), ("ta_poem", "elder")]:
        ev(f"__kit.near('{npc}')")
        check(ev(f"__kit.interact('{npc}')") == f"dialogue:{seg}", f"{npc} → {seg}")
        ev("__kit.driveDialogue()")
    check(ev("__kit.manager.status('village_delivery')") == "completed", "quest completed")
    ev("__kit.near('pa_daeng')")
    check(ev("__kit.interact('pa_daeng')") == "dialogue:ending", "ending segment")
    ev("__kit.driveDialogue()")
    check(ev("__kit.inv.count('kanom_chan')") >= 1, "reward mirrored into the inventory")
    ev("__kit.setLanguage('en')")
    page.wait_for_timeout(300)
    ev("__kit.near('bang_roti', -24, 8)")
    check(ev("__kit.interact('bang_roti')") == "shop", "Bang Roti's stall (Easy Items)")
    page.wait_for_timeout(400)
    r = ev("__kit.inv.buy(__kit.kit.shop, 'teh_tarik')")
    check(r.get("ok"), "buy teh tarik")
    shot("05_shop_en")
    ev("__kit.closeShop()")
    s = ev("__kit.quickSave()")
    check(s.get("ok"), "quick save (Easy Save)")
    ev("__kit.map.characters.get(__kit.kit.player).sprite.x += 100; __kit.inv.state.coins = 0")
    l = ev("__kit.quickLoad().then(r => r.ok)")
    check(l, "quick load")
    check(ev("__kit.inv.state.coins") > 0, "wallet restored")
    ev("__kit.setLanguage('ms')")
    page.wait_for_timeout(300)
    hud = ev("__kit.hud()")
    check(hud["questTitle"] and not ev(f"__kit.hasThai({json.dumps(hud['questTitle'])})"), f"HUD in Malay: {hud['questTitle']}")
    ev("__kit.near('luang_phi', -26, 10)")
    page.wait_for_timeout(500)
    shot("06_gameplay_ms")
    feat = ev("__kit.features") or {}
    if feat.get("font"):
        pf = ev("__kit.pixelFont()")
        check(pf["hud"] == ev("__kit.kit.font.small"), f"HUD in the Easy Font pixel font ({pf['hud']})")
        check(ev("__kit.box.body instanceof PIXI.BitmapText"), "dialogue box text is a BitmapText (มะขาม)")
        check(ev("__kit.ef.shape('น้ำ') !== 'น้ำ'"), "Thai shaped for the pixel font")
    if feat.get("portrait"):
        ev("__kit.setLanguage('th')")
        page.wait_for_timeout(300)
        ev("""(() => { const b = __kit.box; b.view.visible = true; b.showLine({ type: 'line', speaker: 'vendor', name: 'ป้าแดง', portrait: 'town_vendor', emotion: 'happy', text: 'มาพอดีเลย ช่วยป้าส่งของหน่อยนะ' }); })()""")
        page.wait_for_timeout(600)
        t = ev("__kit.talker ? { id: __kit.talker.id, visible: __kit.talker.container.visible, talking: __kit.talker.talking } : null")
        check(t and t["id"] == "town_vendor" and t["visible"], f"animated Easy Portrait over the dialogue box ({t})")
        shot("07_dialogue_portrait")
        ev("__kit.box.view.visible = false; __kit.talker && (__kit.talker.container.visible = false)")
    if feat.get("npc"):
        n = ev("__kit.scheduled.size")
        check(n >= 3, f"villagers on Easy NPC schedules ({n})")
        moved = ev("""(() => { const out = []; for (const [name] of __kit.scheduled) { __kit.setClock(420); const a = __kit.npcPos(name); __kit.setClock(780); const b = __kit.npcPos(name); if (Math.hypot(a.x - b.x, a.y - b.y) > 4) out.push(name); } return out; })()""")
        check(len(moved) >= 2, f"villagers move with the clock 07:00 → 13:00 ({', '.join(moved)})")
        check(ev("__kit.hud().clock") != "", f"clock in the HUD ({ev('__kit.hud().clock')})")
        ev("__kit.setClock(1230)")
        check(ev("__kit.timeOfDay()") == "night", "night at 20:30")
        ev("__kit.near('pa_daeng', -26, 10)")
        page.wait_for_timeout(300)
        shot("08_night")
        ev("__kit.setClock(540)")
    if feat.get("battle"):
        z = ev("__kit.kit.battle.zone")
        check(ev(f"__kit.inBattleZone({(z[0] + 1) * 16}, {(z[1] + 1) * 16})"), "paddy-field encounter zone")
        coins_b = ev("__kit.inv.state.coins")
        ev("__kit.startBattle(__kit.eb.scripted(__kit.kit.battle.table, __kit.kit.battle.firstSeed ?? 7), { auto: true, speed: 4, autoClose: true })")
        page.wait_for_timeout(1200)
        check(ev("__kit.mode") == "battle" and ev("!!__kit.battleUi"), "battle opens over the village")
        shot("09_battle")
        page.wait_for_function("window.__kit.mode === 'play'", timeout=120000)
        check(ev("__kit.mode") == "play", "back to the village after the battle")
        won = ev("__kit.state.events.filter(e => e.startsWith('battle_end:')).pop()")
        check(won == "battle_end:win" and ev("__kit.inv.state.coins") > coins_b, f"auto battle won, coins {coins_b} → {ev('__kit.inv.state.coins')}")
        s2 = ev("__kit.buildSave()")
        check(s2["items"]["battle"]["party"] and (not feat.get("npc") or s2["items"]["npc"]["bonds"] is not None), "battle party + villager bonds in the save")
    if a.frames:
        ev("__kit.setLanguage('th')")
        ev("__kit.near('pa_daeng', -90, 40)")
        page.wait_for_timeout(300)
        i = 0
        for key, n in [("ArrowRight", 30), ("ArrowUp", 14), ("ArrowRight", 22)]:
            page.keyboard.down(key)
            for _ in range(n):
                page.locator("canvas").screenshot(path=os.path.join(out, f"gif_{i:03d}.png"))
                i += 1
            page.keyboard.up(key)
        print(f"  {i} GIF frames")
    real = [e for e in errors if "favicon" not in e and "AudioContext" not in e]
    check(not real, "no console errors" + (": " + " | ".join(real[:5]) if real else ""))
    browser.close()
srv.shutdown()
print(f"EASYKIT WEB {'OK' if failed == 0 else 'FAILED'} · {passed} passed · {failed} failed")
sys.exit(0 if failed == 0 else 1)
