"""Approximate platform UI overlay zones (where TikTok/Reels/Shorts draw their own UI).

Rects are fractions of the frame (x0, y0, x1, y1) for 9:16 full-screen playback. They are
conservative approximations of current app layouts; keep important text out of them.
"""
ZONES = {
    "tiktok": [
        ("top tabs / search", (0.0, 0.0, 1.0, 0.085)),
        ("right action rail", (0.87, 0.42, 1.0, 0.80)),
        ("caption / username / music", (0.0, 0.765, 1.0, 1.0)),
    ],
    "reels": [
        ("top bar", (0.0, 0.0, 1.0, 0.10)),
        ("right action rail", (0.87, 0.52, 1.0, 0.88)),
        ("caption / username / audio", (0.0, 0.79, 1.0, 1.0)),
    ],
    "shorts": [
        ("top bar", (0.0, 0.0, 1.0, 0.095)),
        ("right action rail", (0.87, 0.48, 1.0, 0.85)),
        ("title / channel", (0.0, 0.80, 1.0, 1.0)),
    ],
}


def applies(aspect):
    return aspect == "9:16"


def check(box, W, H, platforms, what="text"):
    """box = (x0, y0, x1, y1) in output px. Returns list of warning strings."""
    out = []
    x0, y0, x1, y1 = box[0] / W, box[1] / H, box[2] / W, box[3] / H
    for p in platforms:
        for name, (a, b, c, d) in ZONES.get(p, []):
            ix = min(x1, c) - max(x0, a)
            iy = min(y1, d) - max(y0, b)
            if ix > 0.004 and iy > 0.004:
                out.append(f"{what} overlaps {p} '{name}' zone")
    if x0 < 0.03 or x1 > 0.97:
        out.append(f"{what} is within 3% of the left/right edge")
    return out


def overlay_image(W, H, platforms):
    """RGBA image drawing the zones (for --safezones previews)."""
    from PIL import Image, ImageDraw
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cols = {"tiktok": (255, 0, 80, 70), "reels": (255, 160, 0, 60), "shorts": (0, 160, 255, 60)}
    for p in platforms:
        for _, (a, b, c, e) in ZONES.get(p, []):
            d.rectangle((a * W, b * H, c * W, e * H), fill=cols.get(p, (255, 0, 0, 60)), outline=cols.get(p)[:3] + (200,))
    return im
