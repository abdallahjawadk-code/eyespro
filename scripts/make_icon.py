"""
Generate a professional EyesPro / Masar app icon.

Concept: a modern rounded-square app tile (dark gradient) carrying the Masar
identity — a clean eye whose iris is the brand red, with a subtle "route/path"
line of nodes passing through it (مسار = path). Premium, minimal, legible down
to 16px.

Outputs:
  resources/icon.ico       (16, 24, 32, 48, 64, 128, 256)
  resources/icon-512.png   (for stores / marketing)
"""

import os
from PIL import Image, ImageDraw, ImageFilter

ACCENT      = (230, 57, 70, 255)    # brand red  #E63946
ACCENT_DK   = (150, 28, 38, 255)
BG_TOP      = (26, 32, 52, 255)     # #1A2034
BG_BOTTOM   = (8, 10, 20, 255)      # #080A14
EYE_LIGHT   = (236, 240, 252, 255)
NODE        = (120, 170, 255, 255)  # cool accent for the route nodes

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES  = os.path.join(HERE, "resources")


def _vertical_gradient(size, top, bottom):
    grad = Image.new("RGBA", (1, size), 0)
    for y in range(size):
        t = y / max(1, size - 1)
        grad.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(4)))
    return grad.resize((size, size))


def _rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_icon(size: int) -> Image.Image:
    SS = 4                      # supersample for smooth edges
    S = size * SS
    cx, cy = S / 2, S / 2

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # ── Rounded tile with vertical gradient ──────────────────────────────
    tile = _vertical_gradient(S, BG_TOP, BG_BOTTOM)
    mask = _rounded_mask(S, radius=int(S * 0.22))
    img.paste(tile, (0, 0), mask)

    draw = ImageDraw.Draw(img)

    # Premium inner rim (thin accent line just inside the tile edge)
    inset = int(S * 0.045)
    draw.rounded_rectangle(
        [inset, inset, S - inset, S - inset],
        radius=int(S * 0.18),
        outline=(*ACCENT[:3], 70), width=max(1, int(S * 0.006)),
    )

    # ── Route / path: a subtle poly-line of nodes through the eye ─────────
    route = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rdraw = ImageDraw.Draw(route)
    ys = cy
    pts = [
        (S * 0.16, ys + S * 0.06),
        (S * 0.34, ys - S * 0.02),
        (S * 0.50, ys),
        (S * 0.66, ys - S * 0.02),
        (S * 0.84, ys + S * 0.06),
    ]
    rdraw.line(pts, fill=(*NODE[:3], 90), width=max(1, int(S * 0.012)), joint="curve")
    for (px, py) in pts:
        r = S * 0.018
        rdraw.ellipse([px - r, py - r, px + r, py + r], fill=(*NODE[:3], 140))
    route = route.filter(ImageFilter.GaussianBlur(S * 0.004))
    img = Image.alpha_composite(img, route)
    draw = ImageDraw.Draw(img)

    # ── Eye almond (two arcs) ────────────────────────────────────────────
    eye_w = S * 0.66
    eye_h = S * 0.40
    lw = max(2, int(S * 0.030))
    box = [cx - eye_w / 2, cy - eye_h / 2, cx + eye_w / 2, cy + eye_h / 2]
    draw.arc(box, start=200, end=340, fill=EYE_LIGHT, width=lw)   # upper lid
    draw.arc(box, start=20, end=160, fill=EYE_LIGHT, width=lw)    # lower lid

    # ── Iris glow + iris + pupil + highlight ─────────────────────────────
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    ir = S * 0.135
    gdraw.ellipse([cx - ir * 1.7, cy - ir * 1.7, cx + ir * 1.7, cy + ir * 1.7], fill=(*ACCENT[:3], 90))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.03))
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    draw.ellipse([cx - ir, cy - ir, cx + ir, cy + ir], fill=ACCENT, outline=ACCENT_DK, width=max(1, int(S * 0.01)))
    pr = ir * 0.46
    draw.ellipse([cx - pr, cy - pr, cx + pr, cy + pr], fill=(10, 10, 16, 255))  # pupil
    hr = ir * 0.30
    hx, hy = cx - ir * 0.38, cy - ir * 0.40
    draw.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(255, 255, 255, 220))  # highlight

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(RES, exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = [draw_icon(s) for s in sizes]
    ico_path = os.path.join(RES, "icon.ico")
    imgs[-1].save(ico_path, format="ICO", sizes=[(s, s) for s in sizes])
    draw_icon(512).save(os.path.join(RES, "icon-512.png"))
    print(f"[icon] wrote {ico_path} (sizes: {sizes}) + icon-512.png")


if __name__ == "__main__":
    main()
