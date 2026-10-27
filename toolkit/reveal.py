"""Shape-mask reveal (`reveal:` on a clip): the CapCut beat-edit entrance. The clip's picture shows only through shapes
on a plain base: small shapes gather into one in the dark (the music's gap), burst into many on the hit (motion
blurred), then balloon until the whole picture is back. Time it so `lead` lands on the downbeat.
base: a colour behind the shapes the whole time, or "stage": the `gap` colour until the hit, then the clip's own
background snaps in (phone / card layouts: the stage flashes in on the beat, the content bursts in through the shapes,
and section text landing on the hit sits on the stage, not on black)."""
import math

import numpy as np
from PIL import Image, ImageDraw

from . import anim

SHAPES = ("circle", "square", "squircle", "diamond", "star", "hexagon", "triangle", "heart")
PATTERNS = ("row", "ring", "grid", "scatter", "one")
KEYS = {"shape", "count", "pattern", "lead", "burst", "grow", "size", "angle", "base", "gap", "zoom", "rotate", "seed",
        "motion_blur", "pos", "gather", "notes"}
# inscribed radius / half width: how much of a shape's box it is guaranteed to cover (for the final balloon)
INR = {"circle": 1.0, "square": 1.0, "squircle": 0.95, "diamond": 0.707, "star": 0.4, "hexagon": 0.866,
       "triangle": 0.5, "heart": 0.55}
DEFAULTS = {"shape": "circle", "count": 5, "pattern": "row", "lead": 0.45, "burst": 0.22, "grow": 0.9, "size": 0.16,
            "angle": 35, "base": "#000000", "gap": "#000000", "zoom": 1.06, "rotate": 0, "seed": 1, "motion_blur": 1, "pos": ["50%", "50%"],
            "gather": True}


def normalize(rv):
    """Spec value -> full settings dict, or None (false / 'none' / missing)."""
    if rv in (None, False, "none", "off"):
        return None
    if rv is True:
        rv = {}
    if isinstance(rv, str):
        rv = {"shape": rv}
    return {**DEFAULTS, **rv}


def total(rv):
    return rv["lead"] + rv["burst"] + rv["grow"]


def _poly(shape, cx, cy, s, rot):
    """Polygon points of a shape with box width s, centred, rotated (degrees)."""
    r = s / 2
    if shape == "square":
        pts = [(-r, -r), (r, -r), (r, r), (-r, r)]
    elif shape == "diamond":
        pts = [(0, -r), (r, 0), (0, r), (-r, 0)]
    elif shape == "hexagon":
        pts = [(r * math.cos(math.radians(60 * i + 30)), r * math.sin(math.radians(60 * i + 30))) for i in range(6)]
    elif shape == "triangle":
        pts = [(r * math.cos(math.radians(120 * i - 90)), r * math.sin(math.radians(120 * i - 90)) + r * 0.15) for i in range(3)]
    elif shape == "star":
        pts = [((r if i % 2 == 0 else r * 0.45) * math.cos(math.radians(36 * i - 90)),
                (r if i % 2 == 0 else r * 0.45) * math.sin(math.radians(36 * i - 90)) + r * 0.05) for i in range(10)]
    elif shape == "squircle":
        pts = []
        for i in range(48):
            a = 2 * math.pi * i / 48
            c, sn = math.cos(a), math.sin(a)
            pts.append((r * math.copysign(abs(c) ** 0.5, c), r * math.copysign(abs(sn) ** 0.5, sn)))
    elif shape == "heart":
        pts = []
        for i in range(60):
            a = 2 * math.pi * i / 60
            x = 16 * math.sin(a) ** 3
            y = -(13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a))
            pts.append((x / 17 * r, y / 17 * r + r * 0.08))
    else:
        raise ValueError(shape)
    if rot:
        c, sn = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        pts = [(x * c - y * sn, x * sn + y * c) for x, y in pts]
    return [(cx + x, cy + y) for x, y in pts]


def _targets(rv, W, H, px):
    """Where the copies sit after the burst."""
    n = max(1, int(rv["count"]))
    cx, cy = W / 2, H / 2
    p = rv["pattern"]
    if p == "one" or n == 1:
        return [px]
    if p == "row":
        u = (math.cos(math.radians(rv["angle"])), math.sin(math.radians(rv["angle"])))
        span = 0.62 * math.hypot(W, H)
        return [(cx + u[0] * span * (i / (n - 1) - 0.5), cy + u[1] * span * (i / (n - 1) - 0.5)) for i in range(n)]
    if p == "ring":
        R = 0.3 * W
        return [(cx + R * math.cos(2 * math.pi * i / n - math.pi / 2), cy + R * 1.4 * math.sin(2 * math.pi * i / n - math.pi / 2))
                for i in range(n)]
    if p == "grid":
        cols = 2 if n <= 4 else 3
        rows = math.ceil(n / cols)
        return [(W * (i % cols + 0.5) / cols, H * (i // cols + 0.5) / rows) for i in range(n)]
    rng = np.random.default_rng(rv["seed"])
    return [(W * rng.uniform(0.15, 0.85), H * rng.uniform(0.12, 0.88)) for _ in range(n)]


def _cover_size(rv, pts, W, H):
    """Box width at which the copies' inscribed circles cover the whole frame."""
    ys, xs = np.mgrid[0:19, 0:11]
    sx, sy = xs.ravel() / 10 * W, ys.ravel() / 18 * H
    d = np.min([np.hypot(sx - x, sy - y) for x, y in pts], axis=0).max()
    return 2 * d / INR[rv["shape"]] * 1.06


class Reveal:
    """Masks for one clip's reveal (cached geometry)."""

    def __init__(self, rv, W, H, px, fps):
        self.rv, self.W, self.H, self.F = rv, W, H, fps
        self.c = px
        self.pts = _targets(rv, W, H, px)
        self.s0 = rv["size"] * W
        self.s1 = self.s0 * (1.5 if len(self.pts) > 1 else 2.4)   # a single shape still jumps on the hit
        self.smax = _cover_size(rv, self.pts, W, H)
        rng = np.random.default_rng(rv["seed"] + 7)
        n = max(1, int(rv["count"]))
        self.from_ang = [2 * math.pi * i / max(n, 4) + rng.uniform(-0.3, 0.3) for i in range(max(n, 4))]

    def shapes_at(self, t):
        """[(cx, cy, size, rot)] at clip time t, or None when fully revealed."""
        rv = self.rv
        lead, burst, grow = rv["lead"], rv["burst"], rv["grow"]
        rot_total = rv["rotate"]
        T = lead + burst + grow
        if t >= T:
            return None
        rot = rot_total * anim.in_out_cubic(t / T) if rot_total else 0.0
        cx, cy = self.c
        if t < lead:
            gd = min(0.2, lead * 0.5)
            if rv["gather"] and t < gd:
                p = anim.out_cubic(t / gd)
                R = 0.3 * self.W * (1 - p)
                s = self.s0 * (0.35 + 0.65 * p)
                return [(cx + R * math.cos(a), cy + R * 1.2 * math.sin(a), s, rot) for a in self.from_ang]
            if not rv["gather"]:
                p = anim.out_expo(min(1.0, t / 0.18))
                return [(cx, cy, self.s0 * p, rot)]
            k = 1 + 0.03 * math.sin(2 * math.pi * (t - gd) / max(0.3, lead))
            return [(cx, cy, self.s0 * k, rot)]
        if t < lead + burst:
            p = anim.out_expo((t - lead) / burst) if burst > 0 else 1.0
            base = self.s0 if lead > 0 else 0.0
            s = base + (self.s1 - base) * p
            return [(cx + (x - cx) * p, cy + (y - cy) * p, s, rot) for x, y in self.pts]
        p = (t - lead - burst) / grow if grow > 0 else 1.0
        s = self.s1 * (self.smax / self.s1) ** anim.in_out_cubic(p)
        return [(x, y, s, rot) for x, y in self.pts]

    def _draw(self, shapes, img):
        d = ImageDraw.Draw(img)
        sh = self.rv["shape"]
        for x, y, s, rot in shapes:
            if s <= 0.5:
                continue
            if sh == "circle":
                d.ellipse((x - s / 2, y - s / 2, x + s / 2, y + s / 2), fill=255)
            else:
                d.polygon(_poly(sh, x, y, s, rot), fill=255)

    def mask(self, t):
        """L mask (W x H, 255 = picture) at clip time t, or None when fully revealed. Fast phases are motion-blurred
        by averaging sub-frame samples."""
        rv = self.rv
        if self.shapes_at(t) is None:
            return None
        W, H = self.W, self.H
        lead, burst = rv["lead"], rv["burst"]
        gd = min(0.2, lead * 0.5) if rv["gather"] else 0.18
        fast = (t < gd) or (lead <= t < lead + burst + 0.06)
        ns = max(1, int(round(4 * rv["motion_blur"]))) if fast and rv["motion_blur"] else 1
        dt = 1.0 / self.F
        acc = None
        for j in range(ns):
            tj = t - dt * j / ns
            shapes = self.shapes_at(max(0.0, tj))
            img = Image.new("L", (W, H), 0)
            if shapes is None:
                img.paste(255, (0, 0, W, H))
            else:
                self._draw(shapes, img)
            small = np.asarray(img.resize((W // 2, H // 2), Image.BOX), dtype=np.float32)
            acc = small if acc is None else acc + small
        m = Image.fromarray((acc / ns).astype(np.uint8)).resize((W, H), Image.BILINEAR)
        T = total(rv)
        if T - t < 3 / self.F:                       # guarantee a full frame at the end
            k = 1 - (T - t) / (3 / self.F)
            m = Image.fromarray(np.maximum(np.asarray(m), np.uint8(255 * k)))
        return m

    def zoom_at(self, t):
        z = self.rv["zoom"]
        if not z or z == 1:
            return 1.0
        return 1 + (z - 1) * (1 - anim.out_cubic(min(1.0, t / total(self.rv))))
