"""
Generate a professional EyesPro icon — glowing eye on dark background.
Outputs resources/icon.ico with sizes: 16, 32, 48, 64, 128, 256
"""

import math
from PIL import Image, ImageDraw, ImageFilter

def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(4))

def draw_icon(size: int) -> Image.Image:
    S = size
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = S / 2, S / 2
    R = S / 2

    # ── Background circle ──────────────────────────────────────────────
    bg_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg_layer)

    # Outer dark navy circle
    bg_draw.ellipse([0, 0, S - 1, S - 1], fill=(8, 10, 26, 255))

    # Subtle gradient rim — draw concentric rings fading inward
    for i in range(int(R * 0.12)):
        t = i / (R * 0.12)
        alpha = int(180 * (1 - t))
        r = R - i
        bg_draw.ellipse(
            [cx - r, cy - r, cx + r, cy + r],
            outline=(80, 60, 180, alpha),
            width=1,
        )

    img = Image.alpha_composite(img, bg_layer)
    draw = ImageDraw.Draw(img)

    # ── Eye whites / almond shape ──────────────────────────────────────
    eye_w  = R * 1.28
    eye_h  = R * 0.60
    pad_x  = (S - eye_w) / 2
    pad_y  = (S - eye_h) / 2

    # Glow behind eye (blurred)
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd   = ImageDraw.Draw(glow)
    gd.ellipse(
        [pad_x - R * 0.15, pad_y - R * 0.15,
         pad_x + eye_w + R * 0.15, pad_y + eye_h + R * 0.15],
        fill=(100, 60, 255, 80),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=S * 0.10))
    img  = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    # Eye white (very dark blue-white, not pure white)
    draw.ellipse(
        [pad_x, pad_y, pad_x + eye_w, pad_y + eye_h],
        fill=(18, 22, 55, 255),
    )

    # ── Iris ───────────────────────────────────────────────────────────
    ir = eye_h * 0.46
    draw.ellipse(
        [cx - ir, cy - ir, cx + ir, cy + ir],
        fill=(55, 30, 180, 255),
    )

    # Iris colour gradient rings
    iris_colors = [
        (80,  45, 220, 255),
        (100, 60, 240, 255),
        (120, 80, 255, 255),
    ]
    for idx, col in enumerate(iris_colors):
        r2 = ir * (0.85 - idx * 0.22)
        draw.ellipse(
            [cx - r2, cy - r2, cx + r2, cy + r2],
            fill=col,
        )

    # ── Pupil ──────────────────────────────────────────────────────────
    pr = ir * 0.38
    draw.ellipse(
        [cx - pr, cy - pr, cx + pr, cy + pr],
        fill=(5, 5, 20, 255),
    )

    # ── Pupil highlight (cyan glint) ───────────────────────────────────
    hl_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    hl_draw  = ImageDraw.Draw(hl_layer)
    hl_r     = pr * 0.55
    hl_off   = pr * 0.28
    hl_draw.ellipse(
        [cx - hl_r + hl_off, cy - hl_r - hl_off,
         cx + hl_r + hl_off, cy + hl_r - hl_off],
        fill=(140, 220, 255, 220),
    )
    hl_layer = hl_layer.filter(ImageFilter.GaussianBlur(radius=max(1, S * 0.018)))
    img = Image.alpha_composite(img, hl_layer)
    draw = ImageDraw.Draw(img)

    # ── Scan-line arc (techy detail) ──────────────────────────────────
    if size >= 48:
        arc_r = ir * 1.22
        draw.arc(
            [cx - arc_r, cy - arc_r, cx + arc_r, cy + arc_r],
            start=210, end=330,
            fill=(160, 120, 255, 160),
            width=max(1, int(S * 0.025)),
        )

    # ── Outer glow ring (final pass) ──────────────────────────────────
    ring = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rd   = ImageDraw.Draw(ring)
    rim  = max(1, int(S * 0.03))
    rd.ellipse(
        [rim, rim, S - rim - 1, S - rim - 1],
        outline=(110, 70, 240, 140),
        width=max(1, int(S * 0.025)),
    )
    ring = ring.filter(ImageFilter.GaussianBlur(radius=max(1, S * 0.03)))
    img  = Image.alpha_composite(img, ring)

    return img


def main():
    import os, sys
    out = os.path.join(os.path.dirname(__file__), "..", "resources", "icon.ico")
    out = os.path.normpath(out)

    sizes   = [256, 128, 64, 48, 32, 16]
    images  = [draw_icon(s) for s in sizes]

    # ICO needs RGB+A; PIL handles RGBA→ICO fine
    images[0].save(
        out,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=images[1:],
    )
    print(f"Saved {out}")


if __name__ == "__main__":
    main()
