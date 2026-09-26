"""Annotation marks drawn with a 'draw-on' animation: hand-drawn circles, underlines, highlighter
sweeps, strike-throughs, boxes, scan brackets, arrows, check/cross, ping and spotlight.

All geometry is in output px. `p` is the draw progress (0 -> 1, eased by the caller)."""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .anim import clamp01

TYPES = {"circle", "underline", "strike", "highlight", "box", "brackets", "arrow", "check", "cross", "ping", "spotlight",
         "scribble", "dot"}
SS = 3  # supersampling for smooth strokes


def _length(pts):
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


def partial(pts, p):
    """First p (0..1) of a polyline by length."""
    if p >= 1 or len(pts) < 2:
        return list(pts)
    if p <= 0:
        return [pts[0]]
    target = _length(pts) * p
    out, acc = [pts[0]], 0.0
    for a, b in zip(pts, pts[1:]):
        d = math.dist(a, b)
        if acc + d >= target:
            k = (target - acc) / d if d else 0
            out.append((a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k))
            return out
        out.append(b)
        acc += d
    return out


def _stroke(draw, pts, color, width):
    if len(pts) < 2:
        return
    draw.line(pts, fill=color, width=int(round(width)), joint="curve")
    r = width / 2
    for x, y in (pts[0], pts[-1]):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def _rng(seed):
    return np.random.default_rng(abs(hash(seed)) % (2 ** 32))


# ------------------------------------------------------------------ paths
def circle_path(rect, pad, hand=True, seed=0):
    x0, y0, x1, y1 = rect
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2 + pad, (y1 - y0) / 2 + pad * 0.8
    if not hand:
        return [(cx + rx * math.cos(a), cy + ry * math.sin(a)) for a in np.linspace(-math.pi / 2, 1.5 * math.pi, 120)]
    g = _rng(("circle", seed))
    ph = g.uniform(0, 6.28)
    a0 = math.radians(-128 + g.uniform(-12, 12))
    turn = 2 * math.pi * 1.1
    pts = []
    for k, a in enumerate(np.linspace(a0, a0 + turn, 160)):
        u = k / 159
        wob = 1 + 0.035 * math.sin(3 * a + ph) + 0.02 * math.sin(5 * a + 2 * ph)
        spiral = 1 + 0.07 * (u - 0.5)                       # ends a little outside where it started
        pts.append((cx + rx * wob * spiral * math.cos(a), cy + ry * wob * spiral * math.sin(a) - 0.03 * ry * u))
    return pts


def underline_path(rect, gap, hand=True, seed=0):
    x0, y0, x1, y1 = rect
    w = x1 - x0
    y = y1 + gap
    xa, xb = x0 - w * 0.03, x1 + w * 0.05
    if not hand:
        return [(xa, y), (xb, y)]
    g = _rng(("under", seed))
    bow, tilt = g.uniform(0.02, 0.05) * w, g.uniform(-0.03, 0.01) * w
    return [(xa + (xb - xa) * u, y + math.sin(math.pi * u) * bow * 0.35 + tilt * u) for u in np.linspace(0, 1, 40)]


def strike_path(rect, hand=True, seed=0):
    x0, y0, x1, y1 = rect
    w, h = x1 - x0, y1 - y0
    ym = (y0 + y1) / 2 + h * 0.04
    g = _rng(("strike", seed))
    tilt = g.uniform(-0.12, -0.04) * h if hand else 0
    return [(x0 - w * 0.04 + (w * 1.08) * u, ym - tilt / 2 + tilt * u) for u in np.linspace(0, 1, 30)]


def box_path(rect, pad, r):
    x0, y0, x1, y1 = rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
    pts = []
    corners = [((x0 + r, y0 + r), 180, 270), ((x1 - r, y0 + r), 270, 360), ((x1 - r, y1 - r), 0, 90), ((x0 + r, y1 - r), 90, 180)]
    for (cx, cy), a, b in corners:
        for t in np.linspace(a, b, 10):
            pts.append((cx + r * math.cos(math.radians(t)), cy + r * math.sin(math.radians(t))))
    pts.append(pts[0])
    return pts


def check_path(rect):
    x0, y0, x1, y1 = rect
    w, h = x1 - x0, y1 - y0
    return [(x0 + w * 0.12, y0 + h * 0.55), (x0 + w * 0.4, y0 + h * 0.82), (x0 + w * 0.9, y0 + h * 0.2)]


def arrow_path(start, end, bend=0.25):
    (sx, sy), (ex, ey) = start, end
    mx, my = (sx + ex) / 2, (sy + ey) / 2
    dx, dy = ex - sx, ey - sy
    cx, cy = mx - dy * bend, my + dx * bend
    return [((1 - u) ** 2 * sx + 2 * (1 - u) * u * cx + u * u * ex, (1 - u) ** 2 * sy + 2 * (1 - u) * u * cy + u * u * ey)
            for u in np.linspace(0, 1, 60)]


def scribble_path(rect, seed=0):
    x0, y0, x1, y1 = rect
    g = _rng(("scribble", seed))
    pts = []
    n = 7
    for i in range(n):
        u = i / (n - 1)
        pts.append((x0 + (x1 - x0) * u + g.uniform(-4, 4), y0 + g.uniform(0, 6)))
        pts.append((x0 + (x1 - x0) * (u + 0.5 / n) + g.uniform(-4, 4), y1 - g.uniform(0, 6)))
    return pts


# ------------------------------------------------------------------ drawing
def _canvas(bbox, W, H):
    x0, y0, x1, y1 = [int(v) for v in (max(0, bbox[0]), max(0, bbox[1]), min(W, bbox[2]), min(H, bbox[3]))]
    if x1 <= x0 or y1 <= y0:
        return None
    img = Image.new("RGBA", ((x1 - x0) * SS, (y1 - y0) * SS), (0, 0, 0, 0))
    return img, (x0, y0)


def _to_local(pts, org):
    return [((x - org[0]) * SS, (y - org[1]) * SS) for x, y in pts]


def _finish(frame, img, org, glow, glow_col, alpha):
    small = img.resize((img.width // SS, img.height // SS), Image.LANCZOS)
    if glow:
        a = small.split()[3].filter(ImageFilter.GaussianBlur(glow))
        g = Image.new("RGBA", small.size, glow_col[:3] + (0,))
        g.putalpha(a.point(lambda v: int(min(255, v * 1.6))))
        g.alpha_composite(small)
        small = g
    if alpha < 0.999:
        small.putalpha(small.split()[3].point(lambda v, k=alpha: int(v * k)))
    frame.alpha_composite(small, (org[0], org[1]))


def draw(frame, kind, rect, p, color, width, unit, *, hand=True, pad=None, radius=None, glow=0, glow_color=None,
         alpha=1.0, seed=0, start=None, end=None, fill=None, strength=0.6):
    """Draw one mark on an RGBA frame. rect = (x0, y0, x1, y1) output px (arrow: start/end points)."""
    W, H = frame.size
    p = clamp01(p)
    if p <= 0 or alpha <= 0.002:
        return
    wpx = width * unit
    gcol = glow_color or color
    if kind == "spotlight":
        x0, y0, x1, y1 = rect
        pd = (pad if pad is not None else 18) * unit
        m = Image.new("L", (W, H), 255)
        ImageDraw.Draw(m).rounded_rectangle((x0 - pd, y0 - pd, x1 + pd, y1 + pd), (radius or 28) * unit, fill=0)
        m = m.filter(ImageFilter.GaussianBlur(14 * unit))
        lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        lay.putalpha(m.point(lambda v, k=strength * p * alpha: int(v * k)))
        frame.alpha_composite(lay)
        return
    if kind == "brackets":
        x0, y0, x1, y1 = rect
        pd = (pad if pad is not None else 16) * unit
        s = 1.28 - 0.28 * p
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        hw, hh = ((x1 - x0) / 2 + pd) * s, ((y1 - y0) / 2 + pd) * s
        L = min(hw, hh) * 0.42
        c = _canvas((cx - hw - wpx * 2, cy - hh - wpx * 2, cx + hw + wpx * 2, cy + hh + wpx * 2), W, H)
        if not c:
            return
        img, org = c
        d = ImageDraw.Draw(img)
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            px, py = cx + sx * hw, cy + sy * hh
            _stroke(d, _to_local([(px - sx * L, py), (px, py), (px, py - sy * L)], org), color, wpx * SS)
        _finish(frame, img, org, glow * unit, gcol, alpha * clamp01(p * 2.5))
        return
    if kind in ("ping", "dot"):
        cx, cy = (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2
        r0 = max(rect[2] - rect[0], rect[3] - rect[1]) / 2 or 26 * unit
        c = _canvas((cx - r0 * 2.4, cy - r0 * 2.4, cx + r0 * 2.4, cy + r0 * 2.4), W, H)
        if not c:
            return
        img, org = c
        d = ImageDraw.Draw(img)
        lc = ((cx - org[0]) * SS, (cy - org[1]) * SS)
        if kind == "ping":
            for ph in (0.0, 0.5):
                q = (p * 1.6 + ph) % 1.0
                rr = r0 * (0.6 + 1.6 * q) * SS
                a = int(255 * (1 - q) * 0.9)
                d.ellipse((lc[0] - rr, lc[1] - rr, lc[0] + rr, lc[1] + rr), outline=color[:3] + (a,), width=int(wpx * SS * 0.7))
        rr = r0 * 0.55 * SS
        d.ellipse((lc[0] - rr, lc[1] - rr, lc[0] + rr, lc[1] + rr), fill=color[:3] + (230,))
        _finish(frame, img, org, glow * unit, gcol, alpha)
        return
    # path marks
    if kind == "circle":
        pts = circle_path(rect, (pad if pad is not None else 22) * unit, hand, seed)
    elif kind == "underline":
        pts = underline_path(rect, (pad if pad is not None else 10) * unit, hand, seed)
    elif kind == "strike":
        pts = strike_path(rect, hand, seed)
    elif kind == "box":
        pts = box_path(rect, (pad if pad is not None else 14) * unit, (radius if radius is not None else 18) * unit)
    elif kind == "check":
        pts = check_path(rect)
    elif kind == "scribble":
        pts = scribble_path(rect, seed)
    elif kind == "cross":
        x0, y0, x1, y1 = rect
        a = [(x0, y0), (x1, y1)]
        b = [(x1, y0), (x0, y1)]
        pts = None
    elif kind == "arrow":
        pts = arrow_path(start, end)
    elif kind == "highlight":
        x0, y0, x1, y1 = rect
        h = y1 - y0
        pd = (pad if pad is not None else 8) * unit
        ym = (y0 + y1) / 2
        pts = [(x0 - pd, ym + h * 0.02), (x1 + pd, ym - h * 0.03)]
        wpx = h * 0.92 + pd
    else:
        return
    allpts = (a + b) if kind == "cross" else pts
    xs, ys = [q[0] for q in allpts], [q[1] for q in allpts]
    m = wpx * 2 + 30 * unit
    c = _canvas((min(xs) - m, min(ys) - m, max(xs) + m, max(ys) + m), W, H)
    if not c:
        return
    img, org = c
    d = ImageDraw.Draw(img)
    if kind == "cross":
        _stroke(d, _to_local(partial(a, clamp01(p * 2)), org), color, wpx * SS)
        if p > 0.5:
            _stroke(d, _to_local(partial(b, clamp01(p * 2 - 1)), org), color, wpx * SS)
    elif kind == "highlight":
        col = fill or color
        q = partial(pts, p)
        if len(q) >= 2:
            (ax, ay), (bx, by) = _to_local(q[:1], org)[0], _to_local(q[-1:], org)[0]
            hh = wpx * SS / 2
            poly = [(ax, ay - hh * 0.92), (bx, by - hh), (bx + hh * 0.18, by + hh * 0.95), (ax - hh * 0.1, ay + hh)]
            d.polygon(poly, fill=col)
    else:
        _stroke(d, _to_local(partial(pts, p), org), color, wpx * SS)
        if kind == "arrow" and p > 0.82:
            q = pts[-1]
            r = pts[-6]
            ang = math.atan2(q[1] - r[1], q[0] - r[0])
            k = clamp01((p - 0.82) / 0.18)
            L = wpx * 3.2 * k
            for s in (-1, 1):
                hx, hy = q[0] - L * math.cos(ang + s * 0.55), q[1] - L * math.sin(ang + s * 0.55)
                _stroke(d, _to_local([q, (hx, hy)], org), color, wpx * SS)
    _finish(frame, img, org, glow * unit, gcol, alpha)
