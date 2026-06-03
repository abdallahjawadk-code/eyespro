"""
Build the app icon from the EyesPro logo artwork.
Crops the glowing eye (excludes the wordmark + corner watermark), places it on a
rounded dark tile, and emits multi-size icon.ico + icon-512.png.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(HERE, "resources")
SRC = os.path.join(RES, "logo-eyespro.png")

src = Image.open(SRC).convert("RGBA")
W, H = src.size

# ── Find the eye's bright bounding box, ignoring the text area (bottom ~38%) ──
gray = src.convert("L")
g = gray.copy()
ImageDraw.Draw(g).rectangle([0, int(H * 0.60), W, H], fill=0)   # black out wordmark
ImageDraw.Draw(g).rectangle([int(W * 0.86), int(H * 0.86), W, H], fill=0)  # corner watermark
bw = g.point(lambda p: 255 if p > 85 else 0)
bbox = bw.getbbox()  # (left, upper, right, lower)
x0, y0, x1, y1 = bbox

# ── Crop the eye tightly (with a little glow margin), then center on a black
#    square tile so the wordmark below is never included. ──────────────────────
m = int((x1 - x0) * 0.05)
eye = src.crop((max(0, x0 - m), max(0, y0 - m), min(W, x1 + m), min(H, y1 + m)))
ew, eh = eye.size
side = int(max(ew, eh) * 1.12)
crop = Image.new("RGBA", (side, side), (0, 0, 0, 255))   # clean black square
crop.paste(eye, ((side - ew) // 2, (side - eh) // 2))

# ── Rounded dark tile ────────────────────────────────────────────────────────
SIZE = 1024
crop = crop.resize((SIZE, SIZE), Image.LANCZOS)
mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=int(SIZE * 0.22), fill=255)
tile = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
tile.paste(crop, (0, 0), mask)

# ── Emit ─────────────────────────────────────────────────────────────────────
sizes = [16, 24, 32, 48, 64, 128, 256]
tile.resize((256, 256), Image.LANCZOS).save(
    os.path.join(RES, "icon.ico"), format="ICO", sizes=[(s, s) for s in sizes]
)
tile.resize((512, 512), Image.LANCZOS).save(os.path.join(RES, "icon-512.png"))
print(f"[icon] eye bbox={bbox} eye={eye.size} tile={side}px -> icon.ico {sizes} + icon-512.png")
