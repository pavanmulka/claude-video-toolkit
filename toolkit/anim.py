"""Easing curves, entrance/exit presets and layer transforms shared by section text, overlays,
marks, pop-outs, device entrances and transitions.

A preset turns progress p (0 -> 1, already eased) into a transform:
    {alpha, dx, dy, scale, sx, sy, rot, blur, reveal}
dx/dy/blur are design px (multiply by the unit), rot is degrees, reveal is the visible fraction
(left -> right) for wipes.
"""
import math

import numpy as np
from PIL import Image, ImageFilter


def clamp01(x):
    return 0.0 if x <= 0 else 1.0 if x >= 1 else float(x)


# ------------------------------------------------------------------ easing
def linear(x):
    return clamp01(x)


def in_cubic(x):
    return clamp01(x) ** 3


def out_cubic(x):
    x = clamp01(x)
    return 1 - (1 - x) ** 3


def in_out_cubic(x):
    x = clamp01(x)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def out_quint(x):
    x = clamp01(x)
    return 1 - (1 - x) ** 5


def out_expo(x):
    x = clamp01(x)
    return 1.0 if x >= 1 else 1 - 2 ** (-10 * x)


def in_out_expo(x):
    x = clamp01(x)
    if x in (0.0, 1.0):
        return x
    return 2 ** (20 * x - 10) / 2 if x < 0.5 else (2 - 2 ** (-20 * x + 10)) / 2


def out_back(x, s=1.70158):
    x = clamp01(x) - 1
    return 1 + (s + 1) * x ** 3 + s * x ** 2


def out_elastic(x):
    x = clamp01(x)
    if x in (0.0, 1.0):
        return x
    return 2 ** (-10 * x) * math.sin((x * 10 - 0.75) * (2 * math.pi) / 3) + 1


def out_bounce(x):
    x = clamp01(x)
    n, d = 7.5625, 2.75
    if x < 1 / d:
        return n * x * x
    if x < 2 / d:
        x -= 1.5 / d
        return n * x * x + 0.75
    if x < 2.5 / d:
        x -= 2.25 / d
        return n * x * x + 0.9375
    x -= 2.625 / d
    return n * x * x + 0.984375


def spring(x, bounce=0.35):
    """Damped spring settling at x=1. bounce 0 = critically damped (no overshoot), 0.5 = lively."""
    x = clamp01(x)
    if x >= 1:
        return 1.0
    zeta = max(0.12, 1.0 - bounce)
    w = max(9.0, 6.0 / zeta)
    if zeta < 1:
        wd = w * math.sqrt(1 - zeta * zeta)
        y = 1 - math.exp(-zeta * w * x) * (math.cos(wd * x) + zeta * w / wd * math.sin(wd * x))
    else:
        y = 1 - math.exp(-w * x) * (1 + w * x)
    k = x ** 10  # land exactly on 1 at the end
    return y * (1 - k) + k


EASINGS = {
    "linear": linear, "in": in_cubic, "out": out_cubic, "in_out": in_out_cubic, "smooth": in_out_cubic,
    "quint": out_quint, "expo": out_expo, "in_out_expo": in_out_expo, "back": out_back,
    "elastic": out_elastic, "bounce": out_bounce, "spring": spring,
    "spring_soft": lambda x: spring(x, 0.12), "spring_bouncy": lambda x: spring(x, 0.55),
}


def ease(name, x):
    fn = EASINGS.get(name or "out", out_cubic)
    return fn(x)


# ------------------------------------------------------------------ presets
# name -> (default easing, function(p) -> transform dict). p is the eased progress 0..1.
def _t(**kw):
    d = {"alpha": 1.0, "dx": 0.0, "dy": 0.0, "scale": 1.0, "sx": 1.0, "sy": 1.0, "rot": 0.0, "blur": 0.0, "reveal": 1.0}
    d.update(kw)
    return d


def _fade_in(p, a):
    return clamp01(p * a)


PRESETS = {
    "none":        ("linear", lambda p, d: _t()),
    "fade":        ("out", lambda p, d: _t(alpha=p)),
    "rise":        ("out", lambda p, d: _t(alpha=clamp01(p * 1.6), dy=(1 - p) * d)),
    "drop":        ("out", lambda p, d: _t(alpha=clamp01(p * 1.6), dy=-(1 - p) * d)),
    "slide_left":  ("expo", lambda p, d: _t(alpha=clamp01(p * 2), dx=(1 - p) * d * 2.5)),
    "slide_right": ("expo", lambda p, d: _t(alpha=clamp01(p * 2), dx=-(1 - p) * d * 2.5)),
    "slide_up":    ("expo", lambda p, d: _t(alpha=clamp01(p * 2), dy=(1 - p) * d * 2.5)),
    "slide_down":  ("expo", lambda p, d: _t(alpha=clamp01(p * 2), dy=-(1 - p) * d * 2.5)),
    "pop":         ("spring", lambda p, d: _t(alpha=clamp01(p * 4), scale=0.55 + 0.45 * p)),
    "pop_small":   ("spring", lambda p, d: _t(alpha=clamp01(p * 4), scale=0.86 + 0.14 * p)),
    "zoom":        ("expo", lambda p, d: _t(alpha=clamp01(p * 2), scale=1.45 - 0.45 * p)),
    "zoom_out":    ("expo", lambda p, d: _t(alpha=clamp01(p * 2), scale=0.7 + 0.3 * p)),
    "blur":        ("out", lambda p, d: _t(alpha=clamp01(p * 1.5), blur=(1 - p) * 22, scale=1.06 - 0.06 * p)),
    "stamp":       ("back", lambda p, d: _t(alpha=clamp01(p * 5), scale=1.9 - 0.9 * p)),
    "spin":        ("spring", lambda p, d: _t(alpha=clamp01(p * 3), scale=0.4 + 0.6 * p, rot=(1 - p) * -120)),
    "flip":        ("spring", lambda p, d: _t(alpha=clamp01(p * 3), sy=max(0.02, p))),
    "swing":       ("spring", lambda p, d: _t(alpha=clamp01(p * 3), rot=(1 - p) * 14, dy=(1 - p) * d * 0.5)),
    "bounce":      ("bounce", lambda p, d: _t(alpha=clamp01(p * 4), dy=-(1 - p) * d * 3)),
    "wipe":        ("in_out", lambda p, d: _t(reveal=p)),
    "mask":        ("quint", lambda p, d: _t(dy=(1 - p) * d)),   # rises out of its own line box (clipped by the compositor)
    "type":        ("linear", lambda p, d: _t(alpha=1.0 if p > 0 else 0.0)),
    "glitch":      ("linear", lambda p, d: _t(alpha=1.0 if p > 0.08 else 0.0,
                                               dx=(0 if p > 0.6 else math.sin(p * 97) * d * 0.6))),
}


def transform(preset, p, dist=40.0, easing=None):
    """Entrance transform at raw progress p (0 = hidden, 1 = settled)."""
    name = preset or "fade"
    if name not in PRESETS:
        name = "fade"
    e_name, fn = PRESETS[name]
    if p >= 1:
        return _t()
    return fn(ease(easing or e_name, p), dist)


def exit_transform(preset, p, dist=40.0, easing=None):
    """Exit transform at progress p (0 = fully visible, 1 = gone): the entrance played backwards."""
    if not preset or preset == "none":
        return _t()
    name = preset if preset in PRESETS else "fade"
    return PRESETS[name][1](1 - ease(easing or "in", p), dist)


def idle(kind, t, amp=1.0, period=2.4):
    """Continuous motion while visible: float | wiggle | pulse | spin | shake | breathe."""
    if not kind:
        return _t()
    w = 2 * math.pi * t / max(0.05, period)
    if kind == "float":
        return _t(dy=math.sin(w) * 10 * amp)
    if kind == "wiggle":
        return _t(rot=math.sin(w * 3.1) * 5 * amp * (0.6 + 0.4 * math.sin(w)))
    if kind == "pulse":
        return _t(scale=1 + 0.045 * amp * (0.5 + 0.5 * math.sin(w * 1.5)))
    if kind == "breathe":
        return _t(scale=1 + 0.02 * amp * math.sin(w))
    if kind == "spin":
        return _t(rot=-360 * t / max(0.05, period) * amp)
    if kind == "shake":
        return _t(dx=math.sin(t * 91) * 4 * amp, dy=math.cos(t * 77) * 3 * amp)
    return _t()


def combine(*ts):
    out = _t()
    for t in ts:
        out["alpha"] *= t["alpha"]
        out["dx"] += t["dx"]
        out["dy"] += t["dy"]
        out["scale"] *= t["scale"]
        out["sx"] *= t["sx"]
        out["sy"] *= t["sy"]
        out["rot"] += t["rot"]
        out["blur"] = max(out["blur"], t["blur"])
        out["reveal"] = min(out["reveal"], t["reveal"])
    return out


def is_identity(tf):
    return (tf["alpha"] >= 0.999 and abs(tf["dx"]) < 0.01 and abs(tf["dy"]) < 0.01 and abs(tf["scale"] - 1) < 1e-3
            and abs(tf["sx"] - 1) < 1e-3 and abs(tf["sy"] - 1) < 1e-3 and abs(tf["rot"]) < 0.01 and tf["blur"] < 0.05
            and tf["reveal"] >= 0.999)


def apply(img, tf, unit=1.0):
    """Apply scale/rotation/blur/alpha/reveal to an RGBA layer about its centre.
    Returns (image, (ox, oy)): paste the result at original_top_left + (ox, oy)."""
    if tf["alpha"] <= 0.002:
        return None, (0, 0)
    w0, h0 = img.size
    out = img
    if tf["reveal"] < 0.999:
        cut = max(1, int(round(w0 * clamp01(tf["reveal"]))))
        m = Image.new("L", (w0, h0), 0)
        m.paste(255, (0, 0, cut, h0))
        feather = max(1, int(6 * unit))
        m = m.filter(ImageFilter.GaussianBlur(feather)) if cut < w0 else m
        a = np.asarray(out.split()[3], np.float32) * (np.asarray(m, np.float32) / 255)
        out = out.copy()
        out.putalpha(Image.fromarray(a.astype(np.uint8)))
    sx, sy = tf["scale"] * tf["sx"], tf["scale"] * tf["sy"]
    if abs(sx - 1) > 1e-3 or abs(sy - 1) > 1e-3:
        nw, nh = max(1, int(round(w0 * sx))), max(1, int(round(h0 * sy)))
        out = out.resize((nw, nh), Image.BICUBIC)
    if abs(tf["rot"]) > 0.01:
        out = out.rotate(tf["rot"], resample=Image.BICUBIC, expand=True)
    if tf["blur"] > 0.05:
        r = tf["blur"] * unit
        pad = int(r * 2.2) + 1
        big = Image.new("RGBA", (out.width + 2 * pad, out.height + 2 * pad), (0, 0, 0, 0))
        big.paste(out, (pad, pad))
        out = _premul_blur(big, r)
    if tf["alpha"] < 0.999:
        a = out.split()[3].point(lambda v, k=tf["alpha"]: int(v * k))
        out = out.copy()
        out.putalpha(a)
    ox = (w0 - out.width) / 2 + tf["dx"] * unit
    oy = (h0 - out.height) / 2 + tf["dy"] * unit
    return out, (ox, oy)


def _premul_blur(img, r):
    """Gaussian blur of an RGBA image without dark fringes (premultiplied alpha)."""
    a = np.asarray(img, np.float32)
    al = a[..., 3:4] / 255.0
    pm = np.concatenate([a[..., :3] * al, a[..., 3:4]], axis=2)
    import cv2
    k = int(max(3, round(r * 3)) | 1)
    b = cv2.GaussianBlur(pm, (k, k), r)
    al2 = np.maximum(b[..., 3:4] / 255.0, 1e-4)
    rgb = np.clip(b[..., :3] / al2, 0, 255)
    return Image.fromarray(np.concatenate([rgb, b[..., 3:4]], axis=2).astype(np.uint8), "RGBA")


def premul_blur(img, r):
    return _premul_blur(img, r)
