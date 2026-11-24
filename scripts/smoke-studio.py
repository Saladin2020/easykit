#!/usr/bin/env python3
"""Headless-browser smoke test for Easy Studio (`easy studio`).

Drives a running Studio: project list → form editor (live validation error + jump-to-field, raw JSON tab)
→ language toggle → save → streamed build → preview (Pixi iframe, optional headless check, desktop buttons).
Saves screenshots of the main screens into --out.

  python scripts/smoke-studio.py --url http://127.0.0.1:8918 --project TungSadao --out shots/ [--check]
"""
import argparse, os, shutil, sys, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://127.0.0.1:8908")
ap.add_argument("--project", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--check", action="store_true", help="also click 'Run headless check' (slow: Godot + Chrome)")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
chrome = os.environ.get("EASYKIT_CHROME") or shutil.which("google-chrome") or shutil.which("chromium") or None
passed, failed = 0, 0

def check(ok, what):
    global passed, failed
    passed, failed = (passed + 1, failed) if ok else (passed, failed + 1)
    print("  ok  " if ok else "  FAIL", what, flush=True)

def fid(path):  # field id from SchemaForm.fieldId
    return f'[id="f-{path}"]'

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=chrome, headless=True, args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script("localStorage.setItem('easystudio.lang','th')")

    # 1. project list
    pg.goto(f"{a.url}/#/studio")
    card = pg.locator("article.card", has_text=a.project).first
    card.wait_for(timeout=15000)
    check(pg.locator("h1.brand").inner_text().startswith("Easy"), "studio shell renders")
    check(card.locator("h3").inner_text().strip() != "", "project card shows the Thai title")

    # 2. editor
    card.locator("a.button").click()
    pg.wait_for_selector(".section-nav .sec")
    check(pg.locator(".tabs a.on").inner_text().strip() == "แก้ไข", "editor tab active (Thai UI)")
    pg.wait_for_selector(".issues .ok", timeout=60000)
    check(True, "saved manifest validates clean")
    pg.locator(".section-nav .sec", has_text="การต่อสู้").click()
    enemy = pg.locator(f'{fid("battle.enemies.1")} input').first
    enemy.wait_for()
    enemy.fill("dragon_king")
    pg.wait_for_selector(".issues li.error", timeout=60000)
    msg = pg.locator(".issues li.error").first.inner_text()
    check("dragon_king" in msg, f"live validation flags the unknown enemy: {msg.splitlines()[0]}")
    check(pg.locator(".save-box .warn").count() == 1, "unsaved marker shown")
    # jump-to-field from another section
    pg.locator(".section-nav .sec", has_text="ข้อมูลเกม").click()
    pg.locator(".issues li.error button").first.click()
    pg.wait_for_selector(".flash", timeout=5000)
    check(pg.locator(".section-nav .sec.on").inner_text().startswith("การต่อสู้"), "jump-to-field switches to the battle section")
    check(pg.locator(f'{fid("battle.enemies.1")}.has-issue, {fid("battle.enemies")} .has-issue').count() >= 1, "bad field highlighted")
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(a.out, "02_form_editor_validation_error.png"))
    # raw JSON tab
    pg.locator(".seg button", has_text="JSON").click()
    raw = pg.locator(".raw textarea")
    check("dragon_king" in raw.input_value(), "raw JSON tab mirrors the draft")
    pg.screenshot(path=os.path.join(a.out, "03_raw_json.png"))
    pg.locator(".seg button", has_text="ฟอร์ม").click()
    # revert, then a real edit (battle.firstSeed) + save
    pg.locator(".revert").click()
    pg.wait_for_selector(".issues .ok", timeout=60000)
    check(True, "revert clears the error")
    pg.locator(".section-nav .sec", has_text="การต่อสู้").click()
    seed = pg.locator(f'{fid("battle.firstSeed")} input')
    seed.fill(str(8 if seed.input_value() == "7" else 7))
    pg.keyboard.press("Control+s")
    pg.wait_for_selector(".save-box .ok", timeout=10000)
    check(True, "Ctrl+S saves the manifest")

    # 3. language toggle
    pg.locator(".lang-toggle button", has_text="EN").click()
    check(pg.locator(".tabs a.on").inner_text().strip() == "Edit", "English toggle")
    pg.locator(".lang-toggle button", has_text="ไทย").click()

    # 4. build (streamed)
    pg.locator(".tabs a", has_text="บิลด์").click()
    pg.locator(".build-controls select").select_option("pixi")
    pg.locator(".build-controls button.primary").click()
    pg.wait_for_selector(".steps-table tr", timeout=30000)
    pg.wait_for_selector(".build-controls p.summary", timeout=600000)
    pg.wait_for_selector(".report-md", timeout=30000)
    rows = pg.locator(".steps-table tr").all_inner_texts()
    built = [r for r in rows if "บิลด์แล้ว" in r]
    skipped = [r for r in rows if "ข้าม" in r]
    check(pg.locator(".build-controls p.summary.ok").count() == 1, f"build OK ({len(built)} built, {len(skipped)} skipped)")
    check(any("battle" in r for r in built) and len(skipped) > 5, "only the changed step + its dependants rebuilt")
    pg.locator(".report-md summary").click()
    pg.screenshot(path=os.path.join(a.out, "04_build_log.png"), full_page=True)

    # 5. preview
    pg.locator(".tabs a", has_text="ตัวอย่าง").click()
    frame = pg.frame_locator(".frame iframe")
    frame.locator("canvas").first.wait_for(timeout=30000)
    check(True, "Pixi web build runs in the iframe")
    if a.check:
        pg.locator(".preview button", has_text="ตรวจอัตโนมัติ").click()
        pg.wait_for_selector(".preview pre.log", timeout=600000)
        out = pg.locator(".preview pre.log").inner_text()
        check("!!" not in out, "headless check passes:\n" + out)
    pg.wait_for_timeout(2500)
    n = pg.locator(".shots img").count()
    check(n > 0 or not a.check, f"{n} check screenshots listed")
    pg.screenshot(path=os.path.join(a.out, "05_preview.png"))

    # 6. new game from the list (manifest only; built later), then the list with thumbnails
    pg.goto(f"{a.url}/#/studio")
    pg.wait_for_selector("article.card")
    if pg.locator("article.card", has_text="KampungBaru").count() == 0:
        pg.locator(".new-game input").fill("KampungBaru")
        pg.locator(".new-game button.primary").click()
        pg.wait_for_selector(".section-nav .sec", timeout=30000)
        check("#/studio/KampungBaru/edit" in pg.url, "new game opens in the editor")
        pg.goto(f"{a.url}/#/studio")
        pg.wait_for_selector("article.card")
    check(pg.locator("article.card", has_text="KampungBaru").count() == 1, "new game listed")
    pg.wait_for_timeout(800)
    pg.screenshot(path=os.path.join(a.out, "01_project_list.png"))
    # narrow / mobile layout
    pg.set_viewport_size({"width": 420, "height": 860})
    pg.goto(f"{a.url}/#/studio/{a.project}/edit")
    pg.wait_for_selector(".section-nav .sec")
    pg.wait_for_timeout(1500)
    pg.screenshot(path=os.path.join(a.out, "06_editor_narrow.png"))
    check(not errors, f"no page errors {errors[:3]}")
    b.close()

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
