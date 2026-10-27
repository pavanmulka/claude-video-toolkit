"""Easing curves, entrance/exit presets and layer transforms shared by section text, overlays,
marks, pop-outs, device entrances and transitions.

A preset turns progress p (0 -> 1, already eased) into a transform:
    {alpha, dx, dy, scale, sx, sy, rot, blur, reveal}
dx/dy/blur are design px (multiply by the unit), rot is degrees, reveal is the visible fraction
(left -> right) for wipes. with_motion() adds motion blur from the move since the previous shutter
(mbx/mby: design px travelled, mbs: previous / current scale); apply() smears the layer along it.
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
    d = {"alpha": 1.0, "dx": 0.0, "dy": 0.0, "scale": 1.0, "sx": 1.0, "sy": 1.0, "rot": 0.0, "blur": 0.0, "reveal": 1.0,
         "mbx": 0.0, "mby": 0.0, "mbs": 1.0}
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
    # fast kinetic moves (pair with motion_blur): a giant slam-down, growing out of a point, pass-through whips
    "mega":        ("expo", lambda p, d: _t(alpha=clamp01(p * 12), scale=1 + 5.5 * (1 - p))),
    "grow":        ("quint", lambda p, d: _t(alpha=clamp01(p * 6), scale=max(0.004, p))),
    "whip_left":   ("expo", lambda p, d: _t(alpha=clamp01(p * 3), dx=(1 - p) * d * 7)),
    "whip_right":  ("expo", lambda p, d: _t(alpha=clamp01(p * 3), dx=-(1 - p) * d * 7)),
    "whip_up":     ("expo", lambda p, d: _t(alpha=clamp01(p * 3), dy=(1 - p) * d * 7)),
    "whip_down":   ("expo", lambda p, d: _t(alpha=clamp01(p * 3), dy=-(1 - p) * d * 7)),
}
PASS_THROUGH = {"whip_left", "whip_right", "whip_up", "whip_down"}   # exits keep travelling the same way


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
    tf = PRESETS[name][1](1 - ease(easing or "in", p), dist)
    if name in PASS_THROUGH:
        tf["dx"], tf["dy"] = -tf["dx"], -tf["dy"]
    return tf


def with_motion(tf, prev, strength=1.0):
    """Attach motion blur: how far the layer travelled (and how much it scaled) since `prev`, the transform one
    shutter earlier. strength scales the smear (the caller already sampled prev one shutter back)."""
    out = dict(tf)
    out["mbx"] = (tf["dx"] - prev["dx"]) * strength
    out["mby"] = (tf["dy"] - prev["dy"]) * strength
    s_now = tf["scale"] * math.sqrt(max(1e-6, tf["sx"] * tf["sy"]))
    s_prev = prev["scale"] * math.sqrt(max(1e-6, prev["sx"] * prev["sy"]))
    if s_now > 1e-3 and prev["alpha"] > 0.002:
        out["mbs"] = 1 + (s_prev / s_now - 1) * strength
    return out


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
        out["mbx"] += t.get("mbx", 0.0)
        out["mby"] += t.get("mby", 0.0)
        out["mbs"] *= t.get("mbs", 1.0)
    return out


def is_identity(tf):
    return (tf["alpha"] >= 0.999 and abs(tf["dx"]) < 0.01 and abs(tf["dy"]) < 0.01 and abs(tf["scale"] - 1) < 1e-3
            and abs(tf["sx"] - 1) < 1e-3 and abs(tf["sy"] - 1) < 1e-3 and abs(tf["rot"]) < 0.01 and tf["blur"] < 0.05
            and tf["reveal"] >= 0.999 and abs(tf.get("mbx", 0)) < 0.5 and abs(tf.get("mby", 0)) < 0.5
            and abs(tf.get("mbs", 1) - 1) < 2e-3)


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
    mbs = tf.get("mbs", 1.0)
    if abs(mbs - 1) > 0.012:
        out = zoom_blur(out, mbs)
    mvx, mvy = tf.get("mbx", 0.0) * unit, tf.get("mby", 0.0) * unit
    if math.hypot(mvx, mvy) > 1.5:
        out = motion_blur(out, mvx, mvy)
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


def _premul_arr(img):
    a = np.asarray(img, np.float32)
    al = a[..., 3:4] / 255.0
    return np.concatenate([a[..., :3] * al, a[..., 3:4]], axis=2)


def _unpremul_img(pm):
    al2 = np.maximum(pm[..., 3:4] / 255.0, 1e-4)
    rgb = np.clip(pm[..., :3] / al2, 0, 255)
    return Image.fromarray(np.concatenate([rgb, np.clip(pm[..., 3:4], 0, 255)], axis=2).astype(np.uint8), "RGBA")


MAX_SMEAR = 900  # px: longest motion-blur streak


def motion_blur(img, vx, vy):
    """Directional motion blur of an RGBA layer that moved by (vx, vy) px during the shutter: the layer is smeared
    back along its path (premultiplied, no dark fringes). The canvas grows symmetrically, so the centre stays put."""
    import cv2
    L = math.hypot(vx, vy)
    if L > MAX_SMEAR:
        vx, vy = vx * MAX_SMEAR / L, vy * MAX_SMEAR / L
    px, py = int(math.ceil(abs(vx))) + 2, int(math.ceil(abs(vy))) + 2
    big = Image.new("RGBA", (img.width + 2 * px, img.height + 2 * py), (0, 0, 0, 0))
    big.paste(img, (px, py))
    kw, kh = 2 * px + 1, 2 * py + 1
    k = np.zeros((kh, kw), np.float32)
    n = max(2, int(math.ceil(math.hypot(vx, vy) * 1.5)))
    for s in np.linspace(0.0, 1.0, n):
        # filter2D correlates: a tap at +s*v gives dst(x) = mean src(x + s*v), i.e. the layer's earlier positions
        # (it was at -s*v) trail behind it
        x, y = px + s * vx, py + s * vy
        x0, y0 = int(math.floor(x)), int(math.floor(y))
        fx, fy = x - x0, y - y0
        for (xx, yy, w) in ((x0, y0, (1 - fx) * (1 - fy)), (x0 + 1, y0, fx * (1 - fy)), (x0, y0 + 1, (1 - fx) * fy), (x0 + 1, y0 + 1, fx * fy)):
            if 0 <= xx < kw and 0 <= yy < kh:
                k[yy, xx] += w
    k /= max(1e-6, k.sum())
    pm = cv2.filter2D(_premul_arr(big), -1, k, borderType=cv2.BORDER_CONSTANT)
    return _unpremul_img(pm)


def zoom_blur(img, ratio, samples=None):
    """Radial (zoom) blur of an RGBA layer whose scale changed: ratio = previous / current scale (> 1: it was bigger,
    it is shrinking). Averages copies scaled between 1 and ratio about the centre; the canvas grows to hold them."""
    ratio = min(3.0, max(0.33, ratio))
    w0, h0 = img.size
    big_r = max(1.0, ratio)
    W, H = int(math.ceil(w0 * big_r)) + 2, int(math.ceil(h0 * big_r)) + 2
    # very large layers (a giant slam) and long streaks are blurred at a reduced size: the streaks hide the softness
    d = abs(ratio - 1) * max(W, H) / 2
    k = min(1.0, 2600.0 / max(W, H), max(0.2, 80.0 / d) if d > 0 else 1.0)
    Wk, Hk = max(2, int(W * k)), max(2, int(H * k))
    # enough copies that neighbours sit ~2.5 px apart at the layer's edge (no visible ghost steps)
    n = samples or int(min(48, max(4, abs(ratio - 1) * max(Wk, Hk) / 2 / 2.5)))
    acc = np.zeros((Hk, Wk, 4), np.float32)
    base = img if k >= 0.999 else img.resize((max(1, int(w0 * k)), max(1, int(h0 * k))), Image.BILINEAR)
    for f in np.linspace(1.0, ratio, n):
        cw, ch = max(1, int(round(base.width * f))), max(1, int(round(base.height * f)))
        im = base.resize((cw, ch), Image.BILINEAR)
        x, y = (Wk - cw) // 2, (Hk - ch) // 2
        a = _premul_arr(im)
        xs0, ys0 = max(0, -x), max(0, -y)
        xd0, yd0 = max(0, x), max(0, y)
        ww, hh = min(cw - xs0, Wk - xd0), min(ch - ys0, Hk - yd0)
        if ww > 0 and hh > 0:
            acc[yd0:yd0 + hh, xd0:xd0 + ww] += a[ys0:ys0 + hh, xs0:xs0 + ww]
    out = _unpremul_img(acc / n)
    if k < 0.999:
        out = out.resize((W, H), Image.BILINEAR)
    return out
