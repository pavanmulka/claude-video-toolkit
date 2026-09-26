"""iPhone device frame drawn in code (signed-distance fields, anti-aliased, no image assets).

Screen corner radii and Dynamic Island sizes follow Apple's point metrics per model; the model is
picked from the screen-recording resolution. Everything scales with the on-screen screen width.
"""
import math

import numpy as np
from PIL import Image

# screen pixel size (portrait) -> model metrics in points
MODELS = {
    (1320, 2868): dict(name="iPhone 16/17 Pro Max", pt_w=440, radius=62.0, island=(126, 37.33, 11.5)),
    (1206, 2622): dict(name="iPhone 16/17 Pro", pt_w=402, radius=62.0, island=(126, 37.33, 11.5)),
    (1290, 2796): dict(name="iPhone 14/15 Pro Max, 15/16 Plus", pt_w=430, radius=55.0, island=(126, 37.33, 11.33)),
    (1179, 2556): dict(name="iPhone 14/15 Pro, 15/16", pt_w=393, radius=55.0, island=(126, 37.33, 11.33)),
    (1260, 2736): dict(name="iPhone Air", pt_w=420, radius=62.0, island=(126, 37.33, 11.5)),
    (1284, 2778): dict(name="iPhone 12/13 Pro Max, 14 Plus", pt_w=428, radius=53.33, island=None),
    (1170, 2532): dict(name="iPhone 12/13/14", pt_w=390, radius=47.33, island=None),
    (1080, 2340): dict(name="iPhone 12/13 mini", pt_w=375, radius=44.0, island=None),
    (1242, 2688): dict(name="iPhone XS Max/11 Pro Max", pt_w=414, radius=39.0, island=None),
    (1125, 2436): dict(name="iPhone X/XS/11 Pro", pt_w=375, radius=39.0, island=None),
    (828, 1792): dict(name="iPhone XR/11", pt_w=414, radius=41.5, island=None),
}

FINISHES = {  # titanium / aluminium band colours
    "black": (58, 58, 62), "natural": (150, 146, 139), "white": (222, 220, 214),
    "desert": (190, 164, 136), "blue": (60, 72, 92), "silver": (205, 207, 210), "orange": (214, 118, 58),
}


def model_for(w, h):
    """Best-matching model metrics for a recording of w x h (portrait or landscape)."""
    pw, ph = (w, h) if h >= w else (h, w)
    for (mw, mh), m in MODELS.items():
        if abs(pw - mw) <= 4 and abs(ph - mh) <= 4:
            return dict(m, exact=True)
    aspect = ph / pw
    if 2.1 < aspect < 2.25:  # modern full-screen iPhone proportions
        return dict(name="iPhone (unknown model)", pt_w=pw / 3, radius=0.141 * pw / 3, island=(126, 37.33, 11.5), exact=False)
    return dict(name="generic device", pt_w=pw / 3, radius=0.06 * pw / 3, island=None, exact=False)


def is_iphone_recording(w, h):
    return model_for(w, h)["name"] != "generic device"


def detect_recorded_island(img):
    """Bounding box (source px) of the black Dynamic Island pill in a screen recording frame.

    iOS renders the island (and, while recording, an expanded pill with a red dot) into the
    frame buffer. Covering its bbox with a clean pill hides the recording indicator.
    """
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    h, w, _ = a.shape
    reg = a[: int(h * 0.06), int(w * 0.2): int(w * 0.8)]
    dark = reg.max(axis=2) < 40
    red = (reg[..., 0] > 150) & (reg[..., 1] < 90) & (reg[..., 2] < 90)
    m = dark | red
    rows = np.where(m.mean(axis=1) > 0.12)[0]
    if len(rows) < 8:
        return None
    y0, y1 = rows.min(), rows.max()
    band = m[y0:y1 + 1]
    cols = np.where(band.mean(axis=0) > 0.5)[0]
    if len(cols) < 20:
        return None
    x0, x1 = cols.min() + int(w * 0.2), cols.max() + int(w * 0.2)
    if (x1 - x0) < 2 * (y1 - y0):
        return None
    return (int(x0), int(y0), int(x1), int(y1))


def _sdf_rrect(X, Y, cx, cy, hx, hy, r):
    qx = np.abs(X - cx) - (hx - r)
    qy = np.abs(Y - cy) - (hy - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def _aa(d):
    return np.clip(0.5 - d, 0.0, 1.0)


class IPhone:
    """Draws the device around a screen rectangle given in output pixels."""

    def __init__(self, src_w, src_h, finish="black", bezel=True, buttons=True, island="auto",
                 island_bbox=None, shadow=0.5):
        self.src_w, self.src_h = src_w, src_h
        self.m = model_for(src_w, src_h)
        self.finish = FINISHES.get(finish, FINISHES["black"]) if isinstance(finish, str) else tuple(finish)
        self.bezel = bezel
        self.buttons = buttons and bezel
        self.island = island
        self.island_bbox = island_bbox
        self.shadow = shadow
        self._cache_key = None
        self._cache = None

    # geometry, all in output px for a screen of width sw
    def metrics(self, sw):
        k = sw / self.m["pt_w"]            # px per point
        R = self.m["radius"] * k
        bz = (0.018 * sw) if self.bezel else 0.0
        band = (0.012 * sw) if self.bezel else 0.0
        return k, R, bz, band

    def outer_rect(self, sx, sy, sw, sh):
        _, _, bz, band = self.metrics(sw)
        e = bz + band
        return sx - e, sy - e, sw + 2 * e, sh + 2 * e

    def layers(self, W, H, sx, sy, sw, sh):
        """(screen_mask L WxH, device overlay RGBA WxH, shadow RGBA WxH) for the screen rect."""
        key = (W, H, round(sx, 2), round(sy, 2), round(sw, 2), round(sh, 2))
        if key == self._cache_key:
            return self._cache
        k, R, bz, band = self.metrics(sw)
        e = bz + band
        btn = 0.0075 * sw if self.buttons else 0.0
        sh_blur = 0.05 * sw
        sh_dy = 0.03 * sw
        m = e + btn + (sh_blur * 2.5 + sh_dy if self.shadow else 0) + 2
        X0, Y0 = max(0, int(math.floor(sx - m))), max(0, int(math.floor(sy - m)))
        X1, Y1 = min(W, int(math.ceil(sx + sw + m))), min(H, int(math.ceil(sy + sh + m)))
        mask = Image.new("L", (W, H), 0)
        over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        if X1 <= X0 or Y1 <= Y0:
            self._cache_key, self._cache = key, (mask, over, shadow)
            return self._cache
        ys, xs = np.mgrid[Y0:Y1, X0:X1].astype(np.float32)
        X, Y = xs + 0.5, ys + 0.5
        cx, cy, hx, hy = sx + sw / 2, sy + sh / 2, sw / 2, sh / 2
        d_s = _sdf_rrect(X, Y, cx, cy, hx, hy, R)
        a_s = _aa(d_s)
        mask.paste(Image.fromarray((a_s * 255).astype(np.uint8)), (X0, Y0))

        rgb = np.zeros(X.shape + (3,), np.float32)
        alpha = np.zeros(X.shape, np.float32)
        if self.bezel:
            d_b = _sdf_rrect(X, Y, cx, cy, hx + bz, hy + bz, R + bz)
            d_f = _sdf_rrect(X, Y, cx, cy, hx + e, hy + e, R + e)
            a_f = _aa(d_f)
            # black glass bezel with a faint lift near the metal edge
            glass = np.clip((-d_b) / max(bz, 1e-3), 0, 1)
            bez_col = 6 + 14 * np.exp(-((d_b + 0.6) ** 2) / 0.8)
            in_bez = _aa(d_b) * (1 - a_s)
            for c in range(3):
                rgb[..., c] = bez_col
            # metal band: highlight towards the outer edge, darker towards the glass
            u = np.clip((-d_f) / max(band, 1e-3), 0, 1)
            shade = 0.62 + 0.55 * np.exp(-((u - 0.28) / 0.2) ** 2) - 0.2 * u
            vert = 1.05 - 0.12 * ((Y - (sy - e)) / (sh + 2 * e))
            in_band = a_f * (1 - _aa(d_b))
            for c in range(3):
                rgb[..., c] = rgb[..., c] * (1 - in_band) + np.clip(self.finish[c] * shade * vert, 0, 255) * in_band
            alpha = np.maximum(in_bez, in_band)
            del glass
            if self.buttons:
                H_dev = sh + 2 * e
                top = sy - e

                def button(side, f0, f1):
                    yc = top + H_dev * (f0 + f1) / 2
                    hh = H_dev * (f1 - f0) / 2
                    xc = (sx - e - btn / 2 + 0.5) if side == "L" else (sx + sw + e + btn / 2 - 0.5)
                    d = _sdf_rrect(X, Y, xc, yc, btn / 2 + 1, hh, min(btn / 2 + 1, hh))
                    return _aa(d) * (1 - a_f)

                ab = np.zeros_like(alpha)
                for side, f0, f1 in (("L", 0.195, 0.235), ("L", 0.285, 0.345), ("L", 0.37, 0.43),
                                     ("R", 0.30, 0.40), ("R", 0.60, 0.665)):
                    ab = np.maximum(ab, button(side, f0, f1))
                for c in range(3):
                    rgb[..., c] = rgb[..., c] * (1 - ab) + self.finish[c] * 0.8 * ab
                alpha = np.maximum(alpha, ab)
            if self.shadow:
                d_sh = _sdf_rrect(X, Y - sh_dy, cx, cy, hx + e, hy + e, R + e)
                a_sh = self.shadow / (1 + np.exp(np.clip(d_sh / (sh_blur * 0.5), -30, 30)))
                shadow.paste(Image.fromarray(np.dstack([np.zeros_like(a_sh)] * 3 + [a_sh * 255]).astype(np.uint8), "RGBA"), (X0, Y0))
        elif self.shadow:
            d_sh = _sdf_rrect(X, Y - sh_dy, cx, cy, hx, hy, R)
            a_sh = self.shadow / (1 + np.exp(np.clip(d_sh / (sh_blur * 0.5), -30, 30)))
            shadow.paste(Image.fromarray(np.dstack([np.zeros_like(a_sh)] * 3 + [a_sh * 255]).astype(np.uint8), "RGBA"), (X0, Y0))

        # Dynamic Island (covers the recorded pill + recording dot)
        if self.island and self.island != "off" and self.m.get("island"):
            iw, ih, it = self.m["island"]
            iw, ih, it = iw * k, ih * k, it * k
            ix0, iy0, ix1, iy1 = cx - iw / 2, sy + it, cx + iw / 2, sy + it + ih
            if self.island_bbox is not None:
                bx0, by0, bx1, by1 = self.island_bbox
                s = sw / self.src_w
                ix0, iy0 = min(ix0, sx + bx0 * s - 2), min(iy0, sy + by0 * s - 2)
                ix1, iy1 = max(ix1, sx + (bx1 + 1) * s + 2), max(iy1, sy + (by1 + 1) * s + 2)
            hh = (iy1 - iy0) / 2
            d_i = _sdf_rrect(X, Y, (ix0 + ix1) / 2, (iy0 + iy1) / 2, (ix1 - ix0) / 2, hh, hh)
            a_i = _aa(d_i) * a_s
            for c in range(3):
                rgb[..., c] = rgb[..., c] * (1 - a_i)
            alpha = np.maximum(alpha, a_i)

        over.paste(Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), "RGBA"), (X0, Y0))
        self._cache_key, self._cache = key, (mask, over, shadow)
        return self._cache
