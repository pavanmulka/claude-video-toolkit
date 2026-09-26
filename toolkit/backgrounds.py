"""Animated backgrounds drawn in numpy: mesh gradient, glow stage, paper, grid, dots, rays, aurora, noise.

Each takes the background dict, the output size, the time t (seconds) and the palette, and returns an
RGB PIL image. Smooth fields are computed at low resolution and upscaled (fast, no banding with grain).
"""
import math

import numpy as np
from PIL import Image, ImageFilter

from .text import color

TYPES = {"mesh", "glow", "paper", "grid", "dots", "rays", "aurora", "noise", "spotlight"}

_static = {}


def _rgb(c, pal):
    return np.array(color(c, pal)[:3], np.float32)


def _noise(shape, amt, k):
    """Cached signed grain as two uint8 planes (add / subtract), 6 variants cycled over time."""
    key = ("noise", shape, round(amt, 2), k % 6)
    if key not in _static:
        g = np.random.default_rng(1000 + k % 6).standard_normal(shape[:2]).astype(np.float32) * amt
        pos = np.clip(g, 0, 255).astype(np.uint8)
        neg = np.clip(-g, 0, 255).astype(np.uint8)
        _static[key] = (np.dstack([pos] * 3), np.dstack([neg] * 3))
    return _static[key]


def _dither(arr, amt=1.5, seed=0):
    import cv2
    a8 = arr if arr.dtype == np.uint8 else cv2.convertScaleAbs(arr)
    if amt <= 0:
        return a8
    pos, neg = _noise(a8.shape, amt, seed)
    return cv2.subtract(cv2.add(a8, pos), neg)


def _coords(W, H):
    key = ("xy", W, H)
    if key not in _static:
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        _static[key] = (xx, yy)
    return _static[key]


def _up(small, W, H):
    import cv2
    return cv2.resize(np.ascontiguousarray(small, dtype=np.float32), (W, H), interpolation=cv2.INTER_CUBIC)


def mesh(bg, W, H, t, pal):
    """Soft colour blobs drifting slowly (Sunset Mesh / Airy look)."""
    cols = [_rgb(c, pal) for c in bg.get("colors", ["#FFD2B8", "#B7A4FF", "#FF9EC0", "#FFF4E6"])]
    base = _rgb(bg.get("base", bg.get("color", "#FFF6EE")), pal)
    speed = float(bg.get("speed", 1.0))
    s = 1 / 12
    w, h = max(8, int(W * s)), max(8, int(H * s))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xx /= w
    yy /= h
    acc = np.zeros((h, w, 3), np.float32)
    wsum = np.full((h, w, 1), 0.35, np.float32)
    rng = np.random.default_rng(int(bg.get("seed", 3)))
    for i, c in enumerate(cols):
        ph = rng.uniform(0, 6.28, 2)
        fx, fy = rng.uniform(0.05, 0.11, 2) * speed
        cx = 0.5 + 0.38 * math.sin(2 * math.pi * fx * t + ph[0] + i)
        cy = 0.5 + 0.40 * math.sin(2 * math.pi * fy * t + ph[1] + 2 * i)
        r = float(bg.get("size", 0.42)) * (0.85 + 0.3 * math.sin(0.4 * t * speed + i))
        wgt = np.exp(-(((xx - cx) * (W / H)) ** 2 + (yy - cy) ** 2) / (r * r))[..., None]
        acc += c * wgt
        wsum += wgt
    small = (acc + base * 0.35) / wsum
    arr = _up(small, W, H)
    return Image.fromarray(_dither(arr, 1.2, int(t * 30)))


def glow(bg, W, H, t, pal):
    """Deep-space stage: dark base with coloured radial glows (top halo + floor light), drifting stars.
    The glow field is static (cached); set pulse: 0.08 for a slow breathing glow."""
    pulse = float(bg.get("pulse", 0.0))
    key = ("glow", W, H, repr(sorted((k, str(v)) for k, v in bg.items())), round(math.sin(t * 1.3), 1) if pulse else 0)
    if key not in _static:
        _static[key] = _glow_field(bg, W, H, t if pulse else 0.0, pal, pulse)
    arr = _static[key].copy()
    if bg.get("stars", True):
        arr = _stars(arr, W, H, t, int(bg.get("seed", 5)), float(bg.get("stars_amount", 1.0)))
    return Image.fromarray(_dither(arr, 1.6, int(t * 30)))


def _glow_field(bg, W, H, t, pal, pulse):
    base = _rgb(bg.get("color", "#07060F"), pal)
    glows = bg.get("glows") or [{"pos": ["50%", "-8%"], "color": bg.get("accent", "#6D4BFF"), "radius": 0.55, "strength": 0.75},
                                {"pos": ["50%", "108%"], "color": bg.get("accent2", "#4B7BFF"), "radius": 0.5, "strength": 0.6},
                                {"pos": ["-10%", "45%"], "color": bg.get("accent", "#6D4BFF"), "radius": 0.35, "strength": 0.25}]
    s = 1 / 10
    w, h = max(8, int(W * s)), max(8, int(H * s))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xx = xx / w * W
    yy = yy / h * H
    acc = np.repeat(np.repeat(base[None, None, :], h, 0), w, 1)
    D = max(W, H)
    for i, g in enumerate(glows):
        px = _pct(g["pos"][0], W)
        py = _pct(g["pos"][1], H)
        r = float(g.get("radius", 0.5)) * D
        st = float(g.get("strength", 0.6)) * (1 + pulse * math.sin(t * 1.3 + i * 2))
        wgt = np.exp(-(((xx - px) ** 2 + (yy - py) ** 2) / (r * r)) * 2.2)[..., None]
        acc = acc + _rgb(g["color"], pal) * wgt * st
    import cv2
    return cv2.convertScaleAbs(_up(acc, W, H))


def _stars(arr, W, H, t, seed, amount):
    rng = np.random.default_rng(seed)
    n = int(90 * amount * W * H / (1080 * 1920))
    xs = rng.uniform(0, W, n)
    ys = rng.uniform(0, H, n)
    sp = rng.uniform(4, 16, n)
    br = rng.uniform(40, 140, n)
    tw = rng.uniform(0, 6.28, n)
    ys = (ys - sp * t) % H
    for x, y, b, ph in zip(xs.astype(int), ys.astype(int), br, tw):
        k = b * (0.6 + 0.4 * math.sin(t * 2 + ph))
        patch = arr[max(0, y - 1):y + 1, max(0, x - 1):x + 1]
        patch[...] = np.clip(patch.astype(np.float32) + k, 0, 255).astype(arr.dtype)
    return arr


def paper(bg, W, H, t, pal):
    """Warm paper with fibre texture + fine grain (Editorial look); static apart from the grain."""
    key = ("paper", W, H, bg.get("color", "#F4EFE6"), bg.get("seed", 1))
    if key not in _static:
        base = _rgb(bg.get("color", "#F4EFE6"), pal)
        rng = np.random.default_rng(int(bg.get("seed", 1)))
        lo = rng.standard_normal((H // 6 + 1, W // 6 + 1)).astype(np.float32)
        lo = np.asarray(Image.fromarray(((lo - lo.min()) / (np.ptp(lo) + 1e-6) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
                        .filter(ImageFilter.GaussianBlur(3)), np.float32) / 255 - 0.5
        fib = rng.standard_normal((H, W // 3 + 1)).astype(np.float32)
        fib = np.asarray(Image.fromarray(((fib - fib.min()) / (np.ptp(fib) + 1e-6) * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR),
                         np.float32) / 255 - 0.5
        xx, yy = _coords(W, H)
        vig = 1 - 0.07 * (((xx - W / 2) / W) ** 2 + ((yy - H / 2) / H) ** 2) * 4
        arr = base[None, None, :] * vig[..., None] + (lo * 10 + fib * 5)[..., None]
        _static[key] = arr
    arr = _static[key]
    return Image.fromarray(_dither(arr, 2.2, int(t * 24)))


def grid(bg, W, H, t, pal):
    """Tech grid: fine lines drifting upward on a dark (or light) base, glow in the middle."""
    base = _rgb(bg.get("color", "#07070C"), pal)
    line = _rgb(bg.get("line", "#FFFFFF"), pal)
    alpha = float(bg.get("line_opacity", 0.07))
    step = float(bg.get("spacing", 90)) * min(W, H) / 1080
    off = (t * float(bg.get("speed", 18)) * min(W, H) / 1080) % step
    xx, yy = _coords(W, H)
    gx = np.abs(((xx + step / 2) % step) - step / 2)
    gy = np.abs(((yy + off + step / 2) % step) - step / 2)
    lw = max(1.0, min(W, H) / 1080 * 1.4)
    m = np.clip(1.2 - np.minimum(gx, gy) / lw, 0, 1)
    fade = np.exp(-(((xx - W / 2) / (W * 0.75)) ** 2 + ((yy - H * 0.45) / (H * 0.6)) ** 2))
    arr = base[None, None, :] + (line - base)[None, None, :] * (m * alpha * (0.35 + fade))[..., None]
    acc = _rgb(bg.get("accent", "#5B6CFF"), pal)
    arr += acc[None, None, :] * (fade * float(bg.get("glow", 0.22)))[..., None]
    return Image.fromarray(_dither(arr, 1.2, int(t * 30)))


def dots(bg, W, H, t, pal):
    """Dot matrix with a soft travelling light."""
    base = _rgb(bg.get("color", "#0B0B12"), pal)
    dot = _rgb(bg.get("dot", "#FFFFFF"), pal)
    step = float(bg.get("spacing", 38)) * min(W, H) / 1080
    r = step * 0.09
    xx, yy = _coords(W, H)
    dx = ((xx + step / 2) % step) - step / 2
    dy = ((yy + step / 2) % step) - step / 2
    m = np.clip(1.5 - np.sqrt(dx * dx + dy * dy) / max(r, 0.8), 0, 1)
    lx = W * (0.5 + 0.35 * math.sin(t * 0.5))
    ly = H * (0.5 + 0.3 * math.cos(t * 0.37))
    light = np.exp(-(((xx - lx) ** 2 + (yy - ly) ** 2) / (0.35 * max(W, H)) ** 2))
    k = m * (float(bg.get("dot_opacity", 0.12)) + 0.35 * light)
    arr = base[None, None, :] * (1 - k[..., None]) + dot[None, None, :] * k[..., None]
    return Image.fromarray(_dither(arr, 1.0, int(t * 30)))


def rays(bg, W, H, t, pal):
    """Rotating starburst rays (two colours) from a centre point — loud, meme/promo energy."""
    c1, c2 = _rgb(bg.get("color", "#FFD84D"), pal), _rgb(bg.get("color2", "#FFB400"), pal)
    n = int(bg.get("count", 16))
    s = 1 / 4
    w, h = max(8, int(W * s)), max(8, int(H * s))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = _pct(bg.get("center", ["50%", "45%"])[0], w), _pct(bg.get("center", ["50%", "45%"])[1], h)
    ang = np.arctan2(yy - cy, xx - cx) + t * float(bg.get("speed", 0.25))
    m = (np.sin(ang * n) > 0).astype(np.float32)
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
    arr = c1[None, None, :] * m[..., None] + c2[None, None, :] * (1 - m[..., None])
    dist = np.sqrt(((xx - cx) / w) ** 2 + ((yy - cy) / h) ** 2)
    arr *= (1 - 0.35 * np.clip(dist, 0, 1))[..., None]
    return Image.fromarray(_dither(_up(arr, W, H), 1.0, int(t * 30)))


def aurora(bg, W, H, t, pal):
    """Flowing aurora ribbons on dark: layered sine bands with soft blur."""
    base = _rgb(bg.get("color", "#05060D"), pal)
    cols = [_rgb(c, pal) for c in bg.get("colors", ["#3CF2C5", "#6D4BFF", "#FF5FA2"])]
    s = 1 / 8
    w, h = max(8, int(W * s)), max(8, int(H * s))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = xx / w, yy / h
    acc = np.repeat(np.repeat(base[None, None, :], h, 0), w, 1)
    sp = float(bg.get("speed", 1.0))
    for i, c in enumerate(cols):
        yc = 0.3 + 0.18 * i + 0.06 * np.sin(2 * math.pi * (xn * (1.2 + 0.3 * i)) + t * 0.6 * sp + i * 1.7)
        band = np.exp(-((yn - yc) / (0.06 + 0.02 * i)) ** 2) * (0.55 + 0.45 * np.sin(xn * 5 + t * sp + i))
        acc = acc + c * band[..., None] * 0.8
    return Image.fromarray(_dither(_up(acc, W, H), 1.4, int(t * 30)))


def noise(bg, W, H, t, pal):
    """Flat colour with visible film grain (for editorial / lo-fi looks)."""
    base = _rgb(bg.get("color", "#111111"), pal)
    arr = np.repeat(np.repeat(base[None, None, :], H, 0), W, 1)
    return Image.fromarray(_dither(arr, float(bg.get("grain", 7)), int(t * 30)))


def spotlight(bg, W, H, t, pal):
    """Dark base with a single soft spotlight behind the subject."""
    return glow({"color": bg.get("color", "#070709"), "stars": False,
                 "glows": [{"pos": bg.get("pos", ["50%", "46%"]), "color": bg.get("accent", "#FFFFFF"),
                            "radius": bg.get("radius", 0.42), "strength": bg.get("strength", 0.16)}]}, W, H, t, pal)


def _pct(v, total):
    if isinstance(v, str) and v.strip().endswith("%"):
        return float(v.strip()[:-1]) / 100 * total
    return float(v)


FUNCS = {"mesh": mesh, "glow": glow, "paper": paper, "grid": grid, "dots": dots, "rays": rays, "aurora": aurora,
         "noise": noise, "spotlight": spotlight}


def render(bg, W, H, t, pal):
    return FUNCS[bg["type"]](bg, W, H, t, pal)
