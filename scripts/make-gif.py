"""Turn gif_*.png frames from `easykit check --shots DIR --frames` into an animated GIF.

  python3 scripts/make-gif.py DIR/godot/ out.gif [--width 480] [--ms 120]
"""
import argparse, glob, os
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("frames"); ap.add_argument("out")
ap.add_argument("--width", type=int, default=480); ap.add_argument("--ms", type=int, default=120)
a = ap.parse_args()
files = sorted(glob.glob(os.path.join(a.frames, "gif_*.png")))
if not files: raise SystemExit(f"no gif_*.png frames in {a.frames}")
frames = []
for f in files:
    im = Image.open(f).convert("RGB")
    h = round(im.height * a.width / im.width)
    frames.append(im.resize((a.width, h), Image.NEAREST).quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
frames[0].save(a.out, save_all=True, append_images=frames[1:], duration=a.ms, loop=0, optimize=True, disposal=1)
print(f"{a.out}: {len(frames)} frames, {os.path.getsize(a.out) // 1024} KB")
