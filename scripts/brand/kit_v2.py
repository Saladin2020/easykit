"""Easy Kit brand (v2 style): logo, banner and social preview with the 13-tool suite strip.

  python3 scripts/brand/kit_v2.py [--shots /workspace/easykit-preview/shots]

Reads the shared brand modules from $EASY_SUITE_BRAND (default /workspace/easy-suite-brand) without writing there:
every output goes to docs/brand/ and docs/assets/ of this repo. Art is the generated VillageDemo: Godot gameplay,
the Pixi title screen and Thai dialogue, so the banner shows what `easykit new` actually makes.
"""
import argparse, os, shutil, sys, tempfile
from PIL import Image, ImageDraw

BRAND = os.environ.get("EASY_SUITE_BRAND", "/workspace/easy-suite-brand")
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
ap = argparse.ArgumentParser()
ap.add_argument("--shots", default="/workspace/easykit-preview/shots")
args = ap.parse_args()
sys.dont_write_bytecode = True  # read-only use of the shared brand folder
sys.path.insert(0, BRAND)
_argv = list(sys.argv); sys.argv = [sys.argv[0]]
import suite12_v2 as s12  # registers the 12 tools
import brand as b
import brand_v2 as v2
sys.argv = _argv

TMP = tempfile.mkdtemp(prefix="easykit-brand-")
OUT = os.path.join(REPO, "docs", "brand")
b.OUT = OUT; v2.OUT = OUT          # never write into the shared brand folder

KIT = dict(key="kit", repo="easykit", name="Easy Kit", accent="#5fd3f3",
           th="ทั้งเกมจาก 12 เครื่องมือ ในคำสั่งเดียว", en="One command drives all 12 tools into a playable Godot + PixiJS game",
           art=os.path.join(TMP, "kit_banner.png"), fx=0.0, fy=0.5)

def icon_kit():
    """Toolbox (accent) with a cream play triangle: the kit that runs a game."""
    rows = [
        "................",
        "................",
        ".....oooooo.....",
        "....okkkkkko....",
        "....ok....ko....",
        ".oooooooooooooo.",
        ".ollllllllllllo.",
        ".oaaaaoccoaaaao.",
        ".oaaaaokkoaaaao.",
        ".oooooooooooooo.",
        ".oaaaacaaaaaaao.",
        ".oaaaaccaaaaaao.",
        ".oaaaacccaaaado.",
        ".oaaaaccaaaaddo.",
        ".oddddcddddddoo.",
        ".oooooooooooooo."]
    return b.from_rows(rows)

b.ICONS["kit"] = icon_kit
if not any(t["key"] == "kit" for t in b.TOOLS): b.TOOLS.append(KIT)
s12.N = len(b.TOOLS); s12.s10.N = s12.N

def shot(name, w, h, fx=0.5, fy=0.5):
    return b.cover(os.path.join(args.shots, name), w, h, fx, fy)

def art():
    # banner: Godot gameplay; social: three panels (Godot gameplay · Pixi title · Pixi Thai dialogue)
    shot("godot/03_gameplay.png", 680, 288, 0.35, 0.5).save(KIT["art"])
    W, H, g = 1216, 380, 8
    pw = (W - 2 * g) // 3
    im = Image.new("RGB", (W, H), b.INK)
    for i, (n, fx) in enumerate([("godot/03_gameplay.png", 0.4), ("web/01_title.png", 0.5), ("web/04_dialogue.png", 0.3)]):
        im.paste(shot(n, pw, H, fx, 0.5), (i * (pw + g), 0))
    p = os.path.join(TMP, "kit_social.png"); im.save(p)
    return p

def main():
    os.makedirs(OUT, exist_ok=True)
    social_art = art()
    t = dict(KIT)
    for s, suf in [(10, ""), (4, "-96"), (2, "-48")]: b.logo_image("kit", t["accent"], s).save(f"{OUT}/logo-kit{suf}.png")
    v2.banner(t).save(f"{OUT}/banner-kit.png", optimize=True)
    t["art"] = social_art; t["en"] = "All 12 Easy tools → one playable Godot + PixiJS game"
    s12.s10.social(t).save(f"{OUT}/social-kit.png", optimize=True)
    # suite-table logos (copied from the shared brand output, read-only)
    for k in ["sprite", "scene", "tilemap", "dialogue", "quest", "ui", "sfx", "fx", "music", "anim", "items", "save", "suite"]:
        src = os.path.join(BRAND, "out", f"logo-{k}-96.png")
        if os.path.exists(src): shutil.copy(src, f"{OUT}/logo-{k}-96.png")
        else: b.logo_image(k, next(x["accent"] for x in b.TOOLS + [b.SUITE] if x["key"] == k), 4).save(f"{OUT}/logo-{k}-96.png")
    # web favicons
    pub = os.path.join(REPO, "web", "public"); os.makedirs(pub, exist_ok=True)
    b.logo_image("kit", t["accent"], 2).save(f"{pub}/favicon-48.png")
    b.logo_image("kit", t["accent"], 8).resize((192, 192), Image.NEAREST).save(f"{pub}/apple-touch-icon.png")
    b.logo_image("kit", t["accent"], 8).resize((192, 192), Image.NEAREST).save(f"{pub}/icon-192.png")
    b.logo_image("kit", t["accent"], 22).resize((512, 512), Image.NEAREST).save(f"{pub}/icon-512.png")
    lg = b.logo_image("kit", t["accent"], 1)
    px = lg.load(); rects = []
    for y in range(24):
        for x in range(24):
            r, g_, bb, a = px[x, y]
            if a: rects.append(f'<rect x="{x}" y="{y}" width="1" height="1" fill="#{r:02x}{g_:02x}{bb:02x}"/>')
    open(f"{pub}/favicon.svg", "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges">{"".join(rects)}</svg>\n')
    print("ok kit", len(b.TOOLS), "tools →", OUT)
    shutil.rmtree(TMP, ignore_errors=True)

if __name__ == "__main__":
    main()
