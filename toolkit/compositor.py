"""Frame compositor: layouts (iphone / card / fullbleed / fit / motion), camera moves incl. 3D tilt,
transitions, section text (whole block or word/letter animation), overlays (text, image, counter,
mark, video picture-in-picture, Remotion motion layers), clip annotations (marks, pop-out lifts,
taps) and captions. Frames are piped to ffmpeg/libx264."""
import json
import math
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from . import anim
from . import backgrounds
from . import brand as brandmod
from . import captions as capmod
from . import safezones
from . import shapes
from .device import IPhone, detect_recorded_island
from .media import FFMPEG, probe, proxy, read_frames, read_rgba, still
from .text import color, parse_markup, render_parts, render_rich

ease = anim.in_out_cubic
ease_out = anim.out_cubic

DIRS = {"left": (-1, 0), "right": (1, 0), "up": (0, -1), "down": (0, 1)}
TRANS_EASE = {"slide": "in_out_expo", "push": "in_out_expo", "whip": "in_out_expo", "zoom": "in_out", "blur": "in_out",
              "wipe": "in_out", "circle": "in_out", "glitch": "linear", "flash": "linear", "crossfade": "linear"}


def rounded_mask(w, h, r, ss=4):
    m = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), r * ss, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def composite_at(frame, img, x, y):
    """alpha_composite that accepts negative / partially off-frame positions."""
    x, y = int(round(x)), int(round(y))
    cx0, cy0 = max(0, -x), max(0, -y)
    cx1, cy1 = min(img.width, frame.width - x), min(img.height, frame.height - y)
    if cx1 <= cx0 or cy1 <= cy0:
        return
    part = img if (cx0, cy0, cx1, cy1) == (0, 0, img.width, img.height) else img.crop((cx0, cy0, cx1, cy1))
    frame.alpha_composite(part, (x + cx0, y + cy0))


def with_alpha(img, k):
    if k >= 0.999:
        return img
    r, g, b, a = img.split()
    return Image.merge("RGBA", (r, g, b, a.point(lambda v: int(v * k))))


def _premul(arr):
    """uint8 RGBA -> premultiplied uint8 RGBA (fast, cv2)."""
    import cv2
    a = arr[..., 3]
    rgb = cv2.multiply(arr[..., :3], cv2.merge([a, a, a]), scale=1 / 255.0)
    return cv2.merge([rgb[..., 0], rgb[..., 1], rgb[..., 2], a])


def _unpremul(arr):
    import cv2
    a = arr[..., 3]
    a3 = cv2.merge([a, a, a])
    rgb = cv2.divide(arr[..., :3], a3, scale=255.0)
    return cv2.merge([rgb[..., 0], rgb[..., 1], rgb[..., 2], a])


class Renderer:
    def __init__(self, spec, plan, preview=False, show_safezones=False, caption_words=None):
        self.spec, self.plan = spec, plan
        self.brand = spec["brand"]
        self.pal = self.brand.get("colors", {})
        self.W, self.H, self.U, self.F = plan["W"], plan["H"], plan["unit"], plan["fps"]
        self.pscale = 0.5 if preview else 1.0
        self.show_safezones = show_safezones
        self._text_cache, self._img_cache, self._dev_cache, self._mask_cache = {}, {}, {}, {}
        self._chrome_cache, self._vig_cache, self._parts_cache = {}, {}, {}
        self._xf = {}          # segment label -> (ax, bx, ay, by, clip rect): source px -> output px
        self._H = {}           # segment label -> 3x3 homography applied after _xf (3D tilt), if any
        self._ov_gens = {}
        self.marks = self.brand.get("marks", {})
        self.look = spec.get("look") or {}
        lp = spec["output"].get("loop")
        self.loop_n = int(round((lp.get("dur", 0.4) if isinstance(lp, dict) else 0.4) * self.F)) if lp else 0
        self._first = None
        self.grade_on = any(self.look.get(k) for k in ("contrast", "saturation", "brightness", "gamma", "warmth", "lift"))
        self.chunks = None
        self.cap_style = None
        cap = spec.get("captions")
        if cap and cap.get("enabled", True) and caption_words:
            cs = brandmod.caption_style(self.brand, cap.get("style", "standard"))
            self.cap_style = cs
            self.cap_text_style = brandmod.text_style(self.brand, cs["text"])
            self.chunks = capmod.chunk(caption_words, max_words=cap.get("max_words", cs.get("max_words", 5)),
                                       max_chars=cap.get("max_chars", cs.get("max_chars", 28)))
            self.cap_pos = cap.get("pos", cs.get("position", "lower"))
            self.cap_offset = cap.get("offset", 0.0)
            if cap.get("skip"):      # no burned-in captions in these sections (e.g. a hook whose text already shows the words)
                F = plan["fps"]
                spans = [(s["start"] / F, s["end"] / F) for s in plan["sections"] if s["name"] in cap["skip"]]
                self.chunks = [c for c in self.chunks
                               if not any(a <= (c["start"] + c["end"]) / 2 + self.cap_offset < b for a, b in spans)]
            self.cap_anim = cap.get("anim", cs.get("anim", "pop"))
        self.warnings = []

    # ------------------------------------------------------------ units
    def px(self, v, total):
        if isinstance(v, str):
            s = v.strip()
            if s == "center":
                return total / 2
            if s.endswith("%"):
                return float(s[:-1]) / 100 * total
            return float(s) * self.U
        return float(v) * self.U

    def pos(self, p):
        if isinstance(p, str):
            p = self.brand.get("positions", {}).get(p, ["center", "center"] if p == "center" else p)
        return self.px(p[0], self.W), self.px(p[1], self.H)

    # ------------------------------------------------------------ sources
    def seg_frames(self, seg, k0=0):
        """Generator of PIL source frames for each local frame (from k0) of a segment."""
        n = seg["n"] - k0
        if seg["kind"] == "color":
            c = seg["color"]
            img = Image.new("RGB", (self.W, self.H), (0, 0, 0) if c in ("transparent", "background", "none") else color(c, self.pal)[:3])
            for _ in range(n):
                yield img
            return
        if seg["kind"] == "image":
            img = Image.open(seg["image"]).convert("RGB")
            if self.pscale != 1:
                img = img.resize((int(img.width * self.pscale), int(img.height * self.pscale)), Image.LANCZOS)
            for _ in range(n):
                yield img
            return
        if seg["kind"] == "motion":
            gen = read_rgba(seg["motion_file"], self.W, self.H, start_idx=k0, fps=self.F)
            last = None
            for _ in range(n):
                fr = next(gen, None)
                if fr is not None:
                    last = Image.fromarray(fr.copy(), "RGBA")
                yield last if last is not None else Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
            gen.close()
            return
        src = self.spec["sources"][seg["src"]]
        path = src["path"]
        if seg["kind"] == "still":
            img = still(path, float(seg["times"][0]), self.pscale)
            for _ in range(n):
                yield img
            return
        yield from self.video_frames(path, seg["times"][k0:])

    def video_frames(self, path, times):
        pth, pfps, w, h = proxy(path, self.pscale)
        info = probe(pth)
        nfr = max(1, int(round(info["duration"] * pfps)))
        idxs = np.clip(np.round(np.asarray(times) * pfps).astype(int), 0, nfr - 1)
        idxs = np.maximum.accumulate(idxs)
        start = int(idxs[0])
        reader = read_frames(pth, w, h, start, int(idxs[-1]) - start + 1, pfps)
        cur_j, cur, img = -1, None, None
        for ix in idxs:
            changed = False
            while cur_j < ix - start:
                fr = next(reader, None)
                if fr is None:
                    break
                cur, cur_j, changed = fr, cur_j + 1, True
            if cur is None:
                raise RuntimeError(f"could not read frames from {path}")
            if changed or img is None:
                img = Image.fromarray(cur.copy())
            yield img
        reader.close()

    # ------------------------------------------------------------ camera
    def cam(self, seg, k):
        """(zoom, focus, pan, tilt [x, y] deg, rotate deg) at local frame k."""
        keys = seg["camera"]
        t = k / self.F
        dur = seg["n"] / self.F
        ks = [dict(c, t=(dur if c["t"] is None else c["t"])) for c in keys]

        def out(c):
            return c["zoom"], c["focus"], c["pan"], c["tilt"], c["rot"]

        if t <= ks[0]["t"] or len(ks) == 1:
            return out(ks[0])
        for a, b in zip(ks, ks[1:]):
            if t <= b["t"]:
                e = anim.ease(b.get("ease") or "in_out", (t - a["t"]) / (b["t"] - a["t"])) if b["t"] > a["t"] else 1.0
                f = None
                if a["focus"] is not None or b["focus"] is not None:
                    f0 = a["focus"] if a["focus"] is not None else b["focus"]
                    f1 = b["focus"] if b["focus"] is not None else f0
                    f = [f0[0] + (f1[0] - f0[0]) * e, f0[1] + (f1[1] - f0[1]) * e]
                lerp = lambda u, v: u + (v - u) * e  # noqa: E731
                return (lerp(a["zoom"], b["zoom"]), f, [lerp(a["pan"][0], b["pan"][0]), lerp(a["pan"][1], b["pan"][1])],
                        [lerp(a["tilt"][0], b["tilt"][0]), lerp(a["tilt"][1], b["tilt"][1])], lerp(a["rot"], b["rot"]))
        return out(ks[-1])

    # ------------------------------------------------------------ backgrounds
    def background(self, bg, img, t=0.0):
        W, H = self.W, self.H
        typ = bg.get("type", "blur")
        if typ in backgrounds.TYPES:
            im = backgrounds.render(bg, W, H, t, self.pal)
            if bg.get("dim") or bg.get("tint"):
                im = self._dimtint(im, {"dim": bg.get("dim", 0.0), "tint": bg.get("tint")})
            return im.convert("RGBA")
        if typ == "color":
            return Image.new("RGBA", (W, H), color(bg.get("color", "#000000"), self.pal))
        if typ == "gradient":
            key = ("grad", bg.get("top"), bg.get("bottom"), bg.get("angle", 0))
            if key not in self._img_cache:
                a = np.array(color(bg.get("top", "#1a1a1a"), self.pal)[:3], np.float32)
                b = np.array(color(bg.get("bottom", "#000000"), self.pal)[:3], np.float32)
                g = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
                arr = (a * (1 - g) + b * g) * np.ones((1, W, 1), np.float32)
                self._img_cache[key] = Image.fromarray(arr.astype(np.uint8)).convert("RGBA")
            return self._img_cache[key].copy()
        if typ == "image":
            key = ("bgimg", bg.get("file"))
            if key not in self._img_cache:
                from .timeline import resolve_file
                im = Image.open(resolve_file(bg["file"], self.spec)).convert("RGB")
                self._img_cache[key] = self._cover(im, W, H)
            base = self._img_cache[key]
            return self._dimtint(base, bg).convert("RGBA")
        # blur of the current frame
        if img.mode == "RGBA":
            img = img.convert("RGB")
        sw, sh = img.size
        target = W / H
        if sw / sh > target:
            bw = sh * target
            box = ((sw - bw) / 2, 0, (sw + bw) / 2, sh)
        else:
            bh = sw / target
            top = min(max(0, sh * 0.45 - bh / 2), sh - bh)
            box = (0, top, sw, top + bh)
        small = img.resize((max(8, round(W / 24)), max(8, round(H / 24))), Image.BILINEAR, box=box)
        small = small.filter(ImageFilter.GaussianBlur(bg.get("blur", 4)))
        return self._dimtint(small.resize((W, H), Image.BICUBIC), bg).convert("RGBA")

    def _dimtint(self, im, bg):
        arr = np.asarray(im.convert("RGB")).astype(np.float32) * (1 - bg.get("dim", 0.6))
        if bg.get("tint"):
            arr += np.array(color(bg["tint"], self.pal)[:3], np.float32)
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    @staticmethod
    def _cover(im, W, H):
        sw, sh = im.size
        k = max(W / sw, H / sh)
        bw, bh = W / k, H / k
        return im.resize((W, H), Image.LANCZOS, box=((sw - bw) / 2, (sh - bh) / 2, (sw + bw) / 2, (sh + bh) / 2))

    def vignette(self, strength):
        key = (self.W, self.H, round(strength, 3))
        if key not in self._vig_cache:
            yy, xx = np.mgrid[0:self.H, 0:self.W]
            v = ((xx - self.W / 2) / (self.W * 0.62)) ** 2 + ((yy - self.H / 2) / (self.H * 0.62)) ** 2
            a = np.clip(v * 120 * strength, 0, 150 * strength).astype(np.uint8)
            lay = Image.new("RGBA", (self.W, self.H), (8, 2, 14, 0))
            lay.putalpha(Image.fromarray(a))
            self._vig_cache[key] = lay
        return self._vig_cache[key]

    def enter_state(self, seg, k):
        """(dy px, alpha, 3D extra or None) for a clip's `enter:` entrance of the card/phone.
        extra = (tilt_x, tilt_y, rotate, scale) still to settle."""
        en = seg.get("enter")
        if not en:
            return 0.0, 1.0, None
        dur = en.get("dur", 0.3)
        p = (k / self.F) / dur if dur else 1.0
        e = anim.ease(en.get("ease", "out"), p)
        a0 = en.get("fade", 0.35)
        al = a0 + (1 - a0) * min(1.0, anim.out_cubic(p))
        extra = None
        tl, rot, sc = en.get("tilt"), en.get("rotate", 0.0), en.get("scale")
        if (tl or rot or sc) and p < 1:
            extra = ((tl[0] if tl else 0.0) * (1 - e), (tl[1] if tl else 0.0) * (1 - e), rot * (1 - e),
                     (sc + (1 - sc) * e) if sc else 1.0)
        return (1 - e) * en.get("rise", 70) * self.U, al, extra

    # ------------------------------------------------------------ 3D
    def _persp(self, cx, cy, rx, ry, rz, s, persp=1.2):
        """Homography (frame px -> frame px) for rotating a plane about (cx, cy): tilt rx (top away when +),
        ry (right side away when +), in-plane rz (degrees), scale s."""
        import cv2
        f = persp * max(self.W, self.H)
        a, b, c = math.radians(rx), math.radians(ry), math.radians(rz)

        def proj(x, y):
            X, Y, Z = (x - cx) * s, (y - cy) * s, 0.0
            X, Y = X * math.cos(c) - Y * math.sin(c), X * math.sin(c) + Y * math.cos(c)
            Y, Z = Y * math.cos(a) - Z * math.sin(a), Y * math.sin(a) + Z * math.cos(a)
            X, Z = X * math.cos(b) + Z * math.sin(b), -X * math.sin(b) + Z * math.cos(b)
            k = f / (f + Z)
            return cx + X * k, cy + Y * k

        d = 500.0
        src = np.float32([[cx - d, cy - d], [cx + d, cy - d], [cx + d, cy + d], [cx - d, cy + d]])
        dst = np.float32([proj(x, y) for x, y in src])
        return cv2.getPerspectiveTransform(src, dst)

    def _warp_onto(self, fr, layer, label, cx, cy, rx, ry, rz, sc):
        import cv2
        bb = layer.getbbox()
        M = self._persp(cx, cy, rx, ry, rz, sc)
        if label:
            self._H[label] = M
        if not bb:
            return
        x0, y0, x1, y1 = bb
        corners = np.float32([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]])
        dst = cv2.perspectiveTransform(corners, M)[0]
        X0, Y0 = max(0, int(math.floor(dst[:, 0].min()))), max(0, int(math.floor(dst[:, 1].min())))
        X1, Y1 = min(self.W, int(math.ceil(dst[:, 0].max()))), min(self.H, int(math.ceil(dst[:, 1].max())))
        if X1 <= X0 or Y1 <= Y0:
            return
        T = np.array([[1, 0, -X0], [0, 1, -Y0], [0, 0, 1]], np.float64) @ M @ np.array([[1, 0, x0], [0, 1, y0], [0, 0, 1]], np.float64)
        pm = _premul(np.ascontiguousarray(np.asarray(layer.crop(bb))))
        out = cv2.warpPerspective(pm, T, (X1 - X0, Y1 - Y0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        fr.alpha_composite(Image.fromarray(_unpremul(out), "RGBA"), (X0, Y0))

    def _obj3d(self, tl, rot, extra):
        rx, ry, rz, sc = (tl[0] if tl else 0.0), (tl[1] if tl else 0.0), (rot or 0.0), 1.0
        if extra:
            rx, ry, rz, sc = rx + extra[0], ry + extra[1], rz + extra[2], extra[3]
        return rx, ry, rz, sc

    def map_pt(self, label, x, y):
        """Source px of a segment -> output px (incl. 3D tilt)."""
        ax, bx, ay, by, _ = self._xf[label]
        X, Y = ax * x + bx, ay * y + by
        M = self._H.get(label)
        if M is not None:
            v = M @ np.array([X, Y, 1.0])
            X, Y = v[0] / v[2], v[1] / v[2]
        return X, Y

    def map_rect(self, label, r):
        x, y, w, h = r
        pts = [self.map_pt(label, x, y), self.map_pt(label, x + w, y), self.map_pt(label, x + w, y + h), self.map_pt(label, x, y + h)]
        return (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))

    # ------------------------------------------------------------ layouts
    def compose(self, seg, img, k):
        lay = seg["layout"]
        t = lay["type"]
        if seg["kind"] == "motion":
            fr = self.l_motion(seg, img, k)
        elif seg["kind"] == "color" and seg.get("color") in ("transparent", "background", "none"):
            self._xf[seg["label"]] = (1.0, 0.0, 1.0, 0.0, (0, 0, self.W, self.H))
            fr = self.behind_text(self.background(seg["background"], img, (seg["start"] + k) / self.F), seg, k)
        elif t == "fullbleed":
            fr = self.l_fullbleed(seg, img, k)
        elif t == "card":
            fr = self.l_card(seg, img, k)
        elif t == "iphone":
            fr = self.l_iphone(seg, img, k)
        else:
            fr = self.l_fit(seg, img, k)
        if seg.get("dim"):
            fr = Image.blend(fr, Image.new("RGBA", fr.size, (0, 0, 0, 255)), seg["dim"])
        if seg.get("vignette"):
            fr.alpha_composite(self.vignette(seg["vignette"]))
        for key in ("dip_in", "dip_out"):
            d = seg.get(key)
            if d:
                n = d["n"]
                a = 1 - (k + 1) / (n + 1) if key == "dip_in" and k < n else \
                    (k - (seg["n"] - n) + 1) / (n + 1) if key == "dip_out" and k >= seg["n"] - n else 0
                if a > 0:
                    fr = Image.blend(fr, Image.new("RGBA", fr.size, color(d["color"], self.pal)), a)
        return fr

    def l_motion(self, seg, img, k):
        t = (seg["start"] + k) / self.F
        fr = self.background(seg["background"], img, t) if seg.get("motion_transparent", True) else Image.new("RGBA", (self.W, self.H), (0, 0, 0, 255))
        self._xf[seg["label"]] = (1.0, 0.0, 1.0, 0.0, (0, 0, self.W, self.H))
        if img.size != fr.size:
            img = img.resize(fr.size, Image.LANCZOS)
        fr.alpha_composite(img if img.mode == "RGBA" else img.convert("RGBA"))
        return fr

    def l_fullbleed(self, seg, img, k):
        W, H = self.W, self.H
        sw, sh = img.size
        z, f, p, tl, rot = self.cam(seg, k)
        k0 = max(W / sw, H / sh)
        ww, wh = W / (k0 * z), H / (k0 * z)
        cx, cy = (f if f is not None else (sw / 2 / self._src_scale(seg, img), sh / 2 / self._src_scale(seg, img)))
        s = self._src_scale(seg, img)
        cx, cy = cx * s - p[0] * self.U / (k0 * z), cy * s - p[1] * self.U / (k0 * z)
        x0 = min(max(cx - ww / 2, 0), sw - ww)
        y0 = min(max(cy - wh / 2, 0), sh - wh)
        self._xf[seg["label"]] = (s * W / ww, -x0 * W / ww, s * H / wh, -y0 * H / wh, (0, 0, W, H))
        self._H.pop(seg["label"], None)
        fr = img.resize((W, H), Image.LANCZOS, box=(x0, y0, x0 + ww, y0 + wh)).convert("RGBA")
        if abs(rot) > 0.01:  # in-plane rotation (overscanned so no corners show)
            k2 = 1 + abs(math.sin(math.radians(rot))) * (W + H) / min(W, H)
            big = fr.resize((int(W * k2), int(H * k2)), Image.BICUBIC).rotate(rot, Image.BICUBIC)
            fr = big.crop(((big.width - W) // 2, (big.height - H) // 2, (big.width - W) // 2 + W, (big.height - H) // 2 + H))
        return fr

    def behind_text(self, fr, seg, k):
        """Section text marked `behind: true` is drawn between the background and the phone/card (depth)."""
        s = self.plan["sections"][seg["section"]] if seg.get("section") is not None and seg["section"] < len(self.plan["sections"]) else None
        g = seg["start"] + k
        if s and s.get("behind") and s["text"] and s["start"] <= g < s["end"]:
            self.draw_section_text(fr, s, g)
        return fr

    def l_fit(self, seg, img, k):
        W, H = self.W, self.H
        fr = self.behind_text(self.background(seg["background"], img, (seg["start"] + k) / self.F), seg, k)
        sw, sh = img.size
        z, f, p, tl, rot = self.cam(seg, k)
        kk = min(W / sw, H / sh) * z
        dw, dh = sw * kk, sh * kk
        dy, al, extra = self.enter_state(seg, k)
        x0, y0 = (W - dw) / 2 + p[0] * self.U, (H - dh) / 2 + p[1] * self.U + dy
        s_ = self._src_scale(seg, img)
        self._xf[seg["label"]] = (kk * s_, x0, kk * s_, y0, (x0, y0, x0 + dw, y0 + dh))
        rx, ry, rz, sc = self._obj3d(tl, rot, extra)
        warp = bool(rx or ry or rz or abs(sc - 1) > 1e-3)
        target = Image.new("RGBA", (W, H), (0, 0, 0, 0)) if warp or al < 0.999 else fr
        X0, Y0, X1, Y1 = max(0, int(x0)), max(0, int(y0)), min(W, int(math.ceil(x0 + dw))), min(H, int(math.ceil(y0 + dh)))
        if X1 > X0 and Y1 > Y0:
            box = (max(0.0, (X0 - x0) / kk), max(0.0, (Y0 - y0) / kk), min(sw, (X1 - x0) / kk), min(sh, (Y1 - y0) / kk))
            content = img.resize((X1 - X0, Y1 - Y0), Image.LANCZOS, box=box)
            r = int(self.px(seg["layout"].get("radius", 0), W))
            if target is fr:
                if r:
                    fr.paste(content, (X0, Y0), rounded_mask(X1 - X0, Y1 - Y0, r))
                else:
                    fr.paste(content, (X0, Y0))
            else:
                c = content.convert("RGBA")
                m = rounded_mask(X1 - X0, Y1 - Y0, r) if r else Image.new("L", c.size, 255)
                c.putalpha(m.point(lambda v: int(v * al)))
                target.alpha_composite(c, (X0, Y0))
        if target is not fr:
            if warp:
                self._warp_onto(fr, target, seg["label"], x0 + dw / 2, y0 + dh / 2, rx, ry, rz, sc)
            else:
                self._H.pop(seg["label"], None)
                fr.alpha_composite(target)
        else:
            self._H.pop(seg["label"], None)
        return fr

    def _src_scale(self, seg, img):
        """source-px (original resolution) -> current frame px (proxy/preview may be smaller)."""
        if seg["kind"] in ("image", "color", "motion") or not seg.get("src"):
            return 1.0
        info = self.spec["sources"][seg["src"]]["info"]
        return img.size[0] / info["width"] if info.get("width") else 1.0

    def card_chrome(self, x, y, w, h, r):
        key = (x, y, w, h, r)
        if key not in self._chrome_cache:
            W, H, U = self.W, self.H, self.U
            sh = Image.new("L", (W, H), 0)
            ImageDraw.Draw(sh).rounded_rectangle((x, y + 22 * U, x + w, y + h + 22 * U), r, fill=150)
            sh = sh.filter(ImageFilter.GaussianBlur(34 * U))
            shadow = Image.new("RGBA", (W, H), (6, 0, 12, 0))
            shadow.putalpha(sh)
            border = Image.new("RGBA", (W * 2, H * 2), (0, 0, 0, 0))
            ImageDraw.Draw(border).rounded_rectangle((x * 2, y * 2, (x + w) * 2, (y + h) * 2), r * 2,
                                                     outline=(255, 255, 255, 46), width=max(1, round(4 * U)))
            self._chrome_cache[key] = (shadow, border.resize((W, H), Image.LANCZOS), rounded_mask(w, h, r))
        return self._chrome_cache[key]

    def l_card(self, seg, img, k):
        lay = seg["layout"]
        W, H = self.W, self.H
        cw, ch = int(round(self.px(lay.get("w", 960), W))), int(round(self.px(lay.get("h", 1460), H)))
        x = int(round((W - cw) / 2 if lay.get("x", "center") == "center" else self.px(lay["x"], W)))
        y = int(round(self.px(lay.get("y", 420), H)))
        r = int(round(self.px(lay.get("radius", 50), W)))
        fr = self.behind_text(self.background(seg["background"], img, (seg["start"] + k) / self.F), seg, k)
        s = self._src_scale(seg, img)
        sw, sh = img.size
        z, f, p, tl, rot = self.cam(seg, k)
        win_w = sw / z
        win_h = sw * ch / cw / z
        cut = lay.get("status_cut", 0) * s
        if f is None:
            cx, cy = sw / 2, cut + win_h / 2
        else:
            cx, cy = f[0] * s, f[1] * s
        x0 = min(max(cx - win_w / 2, 0), sw - win_w)
        y0 = min(max(cy - win_h / 2, cut), sh - win_h)
        content = img.resize((cw, ch), Image.LANCZOS, box=(x0, y0, x0 + win_w, y0 + win_h))
        shadow, border, mask = self.card_chrome(x, y, cw, ch, r)
        dy, al, extra = self.enter_state(seg, k)
        dy = int(round(dy))
        kx = cw / win_w
        self._xf[seg["label"]] = (s * kx, x - x0 * kx, s * kx, y + dy - y0 * kx, (x, y + dy, x + cw, y + dy + ch))
        rx, ry, rz, sc = self._obj3d(tl, rot, extra)
        warp = bool(rx or ry or rz or abs(sc - 1) > 1e-3)
        if not warp:
            self._H.pop(seg["label"], None)
            composite_at(fr, with_alpha(shadow, al), 0, dy)
            fr.paste(content, (x, y + dy), mask if al >= 0.999 else mask.point(lambda v: int(v * al)))
            composite_at(fr, with_alpha(border, al), 0, dy)
            return fr
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        composite_at(layer, with_alpha(shadow, al), 0, dy)
        c = content.convert("RGBA")
        c.putalpha(mask if al >= 0.999 else mask.point(lambda v: int(v * al)))
        layer.alpha_composite(c, (x, y + dy))
        composite_at(layer, with_alpha(border, al), 0, dy)
        self._warp_onto(fr, layer, seg["label"], x + cw / 2, y + dy + ch / 2, rx, ry, rz, sc)
        return fr

    def device_for(self, seg, img):
        key = (seg["src"], self.pscale, json.dumps(seg["layout"], sort_keys=True))
        if key not in self._dev_cache:
            lay = seg["layout"]
            info = self.spec["sources"][seg["src"]]["info"] if seg.get("src") else {"width": img.size[0], "height": img.size[1]}
            bbox = None
            island = lay.get("island", "auto")
            if island == "auto" and seg.get("src"):
                first = still(self.spec["sources"][seg["src"]]["path"], 0.0, 1.0)
                bbox = detect_recorded_island(first)
            style = lay.get("style", "rise")
            self._dev_cache[key] = IPhone(info["width"], info["height"], finish=lay.get("finish", "black"),
                                          bezel=lay.get("bezel", style != "screen"), buttons=lay.get("buttons", True),
                                          island=island, island_bbox=bbox, shadow=lay.get("shadow", 0.5))
        return self._dev_cache[key]

    def iphone_rect(self, seg, dev, sw0, sh0):
        """Base (zoom=1) screen rect in output px."""
        lay = seg["layout"]
        W, H = self.W, self.H
        style = lay.get("style", "rise")
        aspect = sh0 / sw0
        if style == "full":
            Hd = self.px(lay.get("height", "70%"), H)
            e_frac = 0.06 if dev.bezel else 0.0
            sw = Hd / (aspect + e_frac)
            sh = sw * aspect
            cy = self.px(lay.get("center_y", "57%"), H)
            cx = self.px(lay.get("center_x", "50%"), W)
            return cx - sw / 2, cy - sh / 2, sw, sh
        sw = self.px(lay.get("width", "84%"), W)
        sh = sw * aspect
        cx = self.px(lay.get("center_x", "50%"), W)
        return cx - sw / 2, self.px(lay.get("top", "22.5%"), H), sw, sh

    def _draw_device(self, target, dev, img, sx, sy, sw, sh, al, straight=False):
        geom = (round(sx, 3), round(sy, 3), round(sw, 3), round(sh, 3))
        prev = getattr(dev, "_prev_geom", None)
        dev._prev_geom = geom
        if prev is not None and prev != geom:      # the phone moves: scale a cached sprite instead of redrawing the SDF
            return self._draw_device_sprite(target, dev, img, sx, sy, sw, sh, al, straight)
        W, H = self.W, self.H
        mask, over, shadow = dev.layers(W, H, sx, sy, sw, sh)
        if al < 0.999:
            mask, over, shadow = mask.point(lambda v: int(v * al)), with_alpha(over, al), with_alpha(shadow, al)
        target.alpha_composite(shadow)
        X0, Y0 = max(0, int(math.floor(sx))), max(0, int(math.floor(sy)))
        X1, Y1 = min(W, int(math.ceil(sx + sw))), min(H, int(math.ceil(sy + sh)))
        if X1 > X0 and Y1 > Y0:
            if img.mode == "RGBA":
                img = img.convert("RGB")
            iw, ih = img.size
            kx, ky = iw / sw, ih / sh
            box = (max(0.0, (X0 - sx) * kx), max(0.0, (Y0 - sy) * ky), min(iw, (X1 - sx) * kx), min(ih, (Y1 - sy) * ky))
            content = img.resize((X1 - X0, Y1 - Y0), Image.LANCZOS, box=box)
            if straight:
                c = content.convert("RGBA")
                c.putalpha(mask.crop((X0, Y0, X1, Y1)))
                target.alpha_composite(c, (X0, Y0))
            else:
                target.paste(content, (X0, Y0), mask.crop((X0, Y0, X1, Y1)))
        target.alpha_composite(over)

    def _device_sprite(self, dev, sw, sh):
        """Device mask / overlay / shadow drawn once at a reference size (a bit larger than needed, so frames
        only ever scale it down), stored premultiplied for artefact-free warping."""
        spr = getattr(dev, "_sprite", None)
        if spr is not None and spr["sw"] * 0.62 <= sw <= spr["sw"] * 1.0005:
            return spr
        sw_ref = sw * 1.15
        sh_ref = sw_ref * sh / sw
        m = int(0.2 * sw_ref) + 4
        Wl, Hl = int(sw_ref + 2 * m), int(sh_ref + 2 * m)
        mask, over, shadow = dev.layers(Wl, Hl, m, m, sw_ref, sh_ref)
        dev._cache_key = None                      # the local sprite must not satisfy a later full-frame lookup
        spr = {"sw": sw_ref, "m": m, "size": (Wl, Hl), "mask": np.asarray(mask).copy(),
               "over": _premul(np.ascontiguousarray(np.asarray(over))), "shadow": np.asarray(shadow)[..., 3].copy()}
        dev._sprite = spr
        return spr

    def _draw_device_sprite(self, target, dev, img, sx, sy, sw, sh, al, straight=False):
        import cv2
        W, H = self.W, self.H
        spr = self._device_sprite(dev, sw, sh)
        k = sw / spr["sw"]
        ox, oy = sx - k * spr["m"], sy - k * spr["m"]
        Wl, Hl = spr["size"]
        RX0, RY0 = max(0, int(math.floor(ox))), max(0, int(math.floor(oy)))
        RX1, RY1 = min(W, int(math.ceil(ox + k * Wl))), min(H, int(math.ceil(oy + k * Hl)))
        if RX1 <= RX0 or RY1 <= RY0:
            return
        M = np.array([[k, 0, ox - RX0], [0, k, oy - RY0]], np.float64)
        size = (RX1 - RX0, RY1 - RY0)
        mask = cv2.warpAffine(spr["mask"], M, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        over = _unpremul(cv2.warpAffine(spr["over"], M, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0)))
        sha = cv2.warpAffine(spr["shadow"], M, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        if al < 0.999:
            mask = (mask.astype(np.float32) * al).astype(np.uint8)
            sha = (sha.astype(np.float32) * al).astype(np.uint8)
            over = over.copy()
            over[..., 3] = (over[..., 3].astype(np.float32) * al).astype(np.uint8)
        shadow_img = Image.fromarray(np.dstack([np.zeros_like(sha)] * 3 + [sha]), "RGBA")
        target.alpha_composite(shadow_img, (RX0, RY0))
        X0, Y0 = max(0, int(math.floor(sx))), max(0, int(math.floor(sy)))
        X1, Y1 = min(W, int(math.ceil(sx + sw))), min(H, int(math.ceil(sy + sh)))
        if X1 > X0 and Y1 > Y0:
            if img.mode == "RGBA":
                img = img.convert("RGB")
            iw, ih = img.size
            kx, ky = iw / sw, ih / sh
            box = (max(0.0, (X0 - sx) * kx), max(0.0, (Y0 - sy) * ky), min(iw, (X1 - sx) * kx), min(ih, (Y1 - sy) * ky))
            content = img.resize((X1 - X0, Y1 - Y0), Image.LANCZOS, box=box)
            mk = Image.fromarray(np.ascontiguousarray(mask[Y0 - RY0:Y1 - RY0, X0 - RX0:X1 - RX0]))
            if straight:
                c = content.convert("RGBA")
                c.putalpha(mk)
                target.alpha_composite(c, (X0, Y0))
            else:
                target.paste(content, (X0, Y0), mk)
        target.alpha_composite(Image.fromarray(over, "RGBA"), (RX0, RY0))

    def l_iphone(self, seg, img, k):
        W, H = self.W, self.H
        fr = self.behind_text(self.background(seg["background"], img, (seg["start"] + k) / self.F), seg, k)
        dev = self.device_for(seg, img)
        info_w = dev.src_w
        info_h = dev.src_h
        bx, by, bw, bh = self.iphone_rect(seg, dev, info_w, info_h)
        z, f, p, tl, rot = self.cam(seg, k)
        fx, fy = f if f is not None else (info_w / 2, info_h / 2)
        Px, Py = bx + fx * bw / info_w, by + fy * bh / info_h
        sw, sh = bw * z, bh * z
        sx = Px - fx * sw / info_w + p[0] * self.U
        sy = Py - fy * sh / info_h + p[1] * self.U
        dy, al, extra = self.enter_state(seg, k)
        sy += dy
        if seg.get("keep_top") and z > 1:     # auto-zoom: never push the phone's top up under the caption band
            sy = max(sy, by - 30 * self.U)
        self._xf[seg["label"]] = (sw / info_w, sx, sh / info_h, sy, (sx, sy, sx + sw, sy + sh))
        rx, ry, rz, sc = self._obj3d(tl, rot, extra)
        if rx or ry or rz or abs(sc - 1) > 1e-3:
            layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            self._draw_device(layer, dev, img, sx, sy, sw, sh, al, straight=True)
            self._warp_onto(fr, layer, seg["label"], sx + sw / 2, sy + sh / 2, rx, ry, rz, sc)
        else:
            self._H.pop(seg["label"], None)
            self._draw_device(fr, dev, img, sx, sy, sw, sh, al)
        return fr

    # ------------------------------------------------------------ transitions
    def blend(self, f0, f1, a, tr, g):
        t = tr["type"]
        if t == "crossfade":
            return Image.blend(f0, f1, a)
        W, H, U = self.W, self.H, self.U
        e = anim.ease(tr.get("ease") or TRANS_EASE.get(t, "in_out"), a)
        if t == "flash":
            out = Image.blend(f0, f1, anim.in_out_cubic((a - 0.35) / 0.3))
            k = max(0.0, 1 - abs(a - 0.5) * 2)
            return Image.blend(out, Image.new("RGBA", (W, H), color(tr.get("color", "#FFFFFF"), self.pal)), 0.9 * k ** 1.4)
        if t in ("slide", "push", "whip"):
            vx, vy = DIRS.get(tr.get("dir", "left"), (-1, 0))
            if t == "slide":
                out = Image.blend(f0, Image.new("RGBA", (W, H), (0, 0, 0, 255)), 0.45 * e)
            else:
                out = Image.new("RGBA", (W, H), (0, 0, 0, 255))
                composite_at(out, f0, vx * W * e, vy * H * e)
            composite_at(out, f1, -vx * W * (1 - e), -vy * H * (1 - e))
            if t == "whip":
                import cv2
                L = int((W if vx else H) * 0.16 * math.sin(math.pi * a))
                if L > 2:
                    arr = cv2.blur(np.asarray(out), (L, 1) if vx else (1, L))
                    out = Image.fromarray(arr, "RGBA")
            return out
        if t in ("zoom", "blur"):
            import cv2
            if t == "zoom":
                fx, fy = tr.get("_focus") or (W / 2, H / 2)
                z0, z1 = 1 + 1.6 * anim.in_cubic(a) if tr.get("_focus") else 1 + 0.6 * e, 1.15 - 0.15 * e if tr.get("_focus") else 1.4 - 0.4 * e
                f0, f1 = self._zoomed(f0, z0, fx, fy), self._zoomed(f1, z1)
            out = Image.blend(f0, f1, anim.in_out_cubic((a - 0.3) / 0.4))
            r = (14 if t == "zoom" else 24) * U * math.sin(math.pi * a)
            if r > 0.6:
                kz = int(r * 3) | 1
                out = Image.fromarray(cv2.GaussianBlur(np.asarray(out), (kz, kz), r), "RGBA")
            return out
        if t in ("wipe", "circle"):
            m = self._trans_mask(t, e, tr)
            return Image.composite(f1, f0, m)
        if t == "glitch":
            return self._glitch(f0, f1, a, g)
        return Image.blend(f0, f1, a)

    def _zoomed(self, fr, z, cx=None, cy=None):
        W, H = self.W, self.H
        cx = W / 2 if cx is None else cx
        cy = H / 2 if cy is None else cy
        ww, hh = W / z, H / z
        x0 = min(max(cx - ww / 2, 0), W - ww)
        y0 = min(max(cy - hh / 2, 0), H - hh)
        return fr.resize((W, H), Image.BILINEAR, box=(x0, y0, x0 + ww, y0 + hh))

    def _trans_mask(self, t, e, tr):
        W, H, U = self.W, self.H, self.U
        s = 1 / 4
        w, h = max(4, int(W * s)), max(4, int(H * s))
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        if t == "circle":
            cx, cy = self.pos(tr.get("pos", ["50%", "50%"]))
            d = np.sqrt((xx / s - cx) ** 2 + (yy / s - cy) ** 2)
            R = e * math.hypot(W, H) * 0.75
            m = np.clip((R - d) / (30 * U) + 0.5, 0, 1)
        else:
            vx, vy = DIRS.get(tr.get("dir", "left"), (-1, 0))
            feather = 90 * U
            if vx:
                coord = (W - xx / s) if vx < 0 else xx / s
                span = W
            else:
                coord = (H - yy / s) if vy < 0 else yy / s
                span = H
            pos = e * (span + 2 * feather) - feather
            m = np.clip((pos - coord) / feather + 0.5, 0, 1)
        return Image.fromarray((m * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)

    def _glitch(self, f0, f1, a, g):
        W, H, U = self.W, self.H, self.U
        base = np.asarray(f0 if a < 0.5 else f1).copy()
        other = np.asarray(f1 if a < 0.5 else f0)
        rng = np.random.default_rng(g * 7919 + 13)
        k = max(0.0, 1 - abs(a - 0.5) * 2)
        sh = int(22 * U * k)
        if sh:
            base[..., 0] = np.roll(base[..., 0], sh, axis=1)
            base[..., 2] = np.roll(base[..., 2], -sh, axis=1)
        for _ in range(int(10 * k) + 1):
            y0 = int(rng.integers(0, H))
            hh = int(rng.integers(max(2, int(6 * U)), max(3, int(70 * U))))
            dx = int(rng.integers(-int(120 * U) - 1, int(120 * U) + 1))
            src = other if rng.random() < 0.35 else base
            base[y0:y0 + hh] = np.roll(src[y0:y0 + hh], dx, axis=1)
        return Image.fromarray(base, "RGBA")

    # ------------------------------------------------------------ text & overlays
    def text_layer(self, text, style):
        key = (text, json.dumps(style, sort_keys=True, default=str))
        if key not in self._text_cache:
            st = brandmod.text_style(self.brand, style)
            r = render_rich(parse_markup(text), st, self.pal, self.U)
            self._text_cache[key] = (r["img"], r["box"], r["layout"])
        return self._text_cache[key]

    def parts_layer(self, text, style, by):
        key = (text, json.dumps(style, sort_keys=True, default=str), by)
        if key not in self._parts_cache:
            st = brandmod.text_style(self.brand, style)
            self._parts_cache[key] = render_parts(parse_markup(text), st, self.pal, self.U, by=by)
        return self._parts_cache[key]

    def anchor_offset(self, size_box, pos, anchor="center"):
        (x0, y0, x1, y1) = size_box
        px, py = self.pos(pos)
        ax = {"left": 0.0, "right": 1.0}.get(anchor.split("-")[-1] if "-" in anchor else anchor, 0.5)
        ay = 0.0 if anchor.startswith("top") else 1.0 if anchor.startswith("bottom") else 0.5
        return px - (x0 + (x1 - x0) * ax), py - (y0 + (y1 - y0) * ay)

    def draw_glass(self, frame, rect, box, alpha=1.0):
        """Frosted-glass card (iOS 26 'Liquid Glass'-like): blurred backdrop, light fill, bright hairline edge."""
        U = self.U
        x0, y0, x1, y1 = [int(round(v)) for v in rect]
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(self.W, x1), min(self.H, y1)
        w, h = x1 - x0, y1 - y0
        if w < 4 or h < 4 or alpha <= 0.01:
            return
        r = int(box.get("radius", 32) * U)
        region = frame.crop((x0, y0, x1, y1)).convert("RGB")
        small = region.resize((max(2, w // 4), max(2, h // 4)), Image.BILINEAR).filter(ImageFilter.GaussianBlur(box.get("blur", 26) * U / 4))
        glass = small.resize((w, h), Image.BICUBIC).convert("RGBA")
        glass.alpha_composite(Image.new("RGBA", (w, h), color(box.get("color", "#FFFFFF"), self.pal, box.get("opacity", 0.14))))
        key = ("glass", w, h, r)
        if key not in self._mask_cache:
            self._mask_cache[key] = rounded_mask(w, h, r)
        m = self._mask_cache[key]
        sh = Image.new("RGBA", (w + int(60 * U), h + int(60 * U)), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((int(30 * U), int(40 * U), int(30 * U) + w, int(40 * U) + h), r, fill=(0, 0, 0, int(90 * alpha)))
        composite_at(frame, sh.filter(ImageFilter.GaussianBlur(18 * U)), x0 - 30 * U, y0 - 30 * U)
        frame.paste(glass, (x0, y0), m if alpha >= 0.999 else m.point(lambda v: int(v * alpha)))
        edge = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
        ImageDraw.Draw(edge).rounded_rectangle((1, 1, w * 2 - 2, h * 2 - 2), r * 2, outline=(255, 255, 255, int(110 * alpha)),
                                               width=max(2, int(3 * U)))
        composite_at(frame, edge.resize((w, h), Image.LANCZOS), x0, y0)

    def _glass_for(self, frame, layer_box, ox, oy, alpha):
        L = layer_box[2] if len(layer_box) > 2 else None
        if L is None or not L.box or L.box.get("mode") != "glass":
            return
        x0, y0, x1, y1 = layer_box[1]
        self.draw_glass(frame, (ox + x0 - L.bpx, oy + y0 - L.bpy, ox + x1 + L.bpx, oy + y1 + L.bpy), L.box, alpha)

    def place(self, frame, layer_box, pos, anchor="center", alpha=1.0, dy=0.0, scale=1.0, tf=None):
        img, (x0, y0, x1, y1) = layer_box[0], layer_box[1]
        if alpha <= 0.002:
            return None
        if abs(scale - 1.0) > 0.003:  # pop animation: scale about the text centre
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.BICUBIC)
            x0, y0 = cx * scale - (x1 - x0) * scale / 2, cy * scale - (y1 - y0) * scale / 2
            x1, y1 = x0 + (layer_box[1][2] - layer_box[1][0]) * scale, y0 + (layer_box[1][3] - layer_box[1][1]) * scale
        ox, oy = self.anchor_offset((x0, y0, x1, y1), pos, anchor)
        oy += dy
        self._glass_for(frame, layer_box, ox, oy, alpha * (tf["alpha"] if tf else 1.0))
        if tf is not None and not anim.is_identity(tf):
            out, (dx, ddy) = anim.apply(img, dict(tf, alpha=tf["alpha"] * alpha), self.U)
            if out is None:
                return None
            composite_at(frame, out, ox + dx, oy + ddy)
        else:
            composite_at(frame, with_alpha(img, alpha), ox, oy)
        return (ox + x0, oy + y0, ox + x1, oy + y1)

    def image_layer(self, path, size):
        key = (path, size)
        if key not in self._img_cache:
            im = Image.open(path).convert("RGBA")
            if size:
                w = int(round(self.px(size, self.W)))
                im = im.resize((w, int(round(im.height * w / im.width))), Image.LANCZOS)
            self._img_cache[key] = (im, (0, 0, im.width, im.height))
        return self._img_cache[key]

    def _anim_tf(self, an, dt, remaining, default_in="fade"):
        """Combined entrance / exit / idle transform for an animated element."""
        tin = an.get("in", default_in)
        d_in, d_out = an.get("dur", 0.35), an.get("out_dur", 0.3)
        tf = anim.transform(tin, dt / d_in if d_in else 1.0, an.get("dist", 40), an.get("ease")) if tin != "none" else anim._t()
        if an.get("out") and an["out"] != "none" and remaining < d_out:
            tf = anim.combine(tf, anim.exit_transform(an["out"], 1 - remaining / d_out, an.get("dist", 40)))
        if an.get("idle"):
            tf = anim.combine(tf, anim.idle(an["idle"], dt, an.get("idle_amp", 1.0), an.get("idle_period", 2.4)))
        return tf

    def draw_section_text(self, frame, s, g):
        F = self.F
        a = s["anim"]
        dt = (g - s["start"]) / F
        remaining = (s["end"] - g) / F
        by = a.get("by", "block")
        effect = a.get("effect")
        if by in ("word", "letter", "line"):
            return self.draw_parts(frame, s["text"], s["style"], s["pos"], "center", a, dt, remaining)
        e = ease_out(dt / a["in"]) if a.get("in") else 1.0
        alpha = e
        if a.get("out"):
            alpha *= min(1.0, remaining / a["out"])
        lay = self.text_layer(s["text"], s["style"])
        self.draw_accent_marks(frame, lay, s["style"], s["pos"], "center", dt, phase="under")
        if effect:
            tf = self._anim_tf({"in": effect, "dur": a.get("in") or 0.35, "ease": a.get("ease"), "dist": a.get("rise") or 40,
                                "out": a.get("out_effect"), "out_dur": a.get("out") or 0.3, "idle": a.get("idle")}, dt, remaining)
            b = self.place(frame, lay, s["pos"], "center", 1.0 if not a.get("out") or a.get("out_effect") else min(1.0, remaining / a["out"]), 0, 1.0, tf)
        else:
            pop = 1.0
            if a.get("pop"):
                pe = min(1.0, dt / a["pop"])
                pop = 0.86 + 0.14 * (1 - (1 - pe) ** 3) + 0.04 * math.sin(math.pi * pe)
            b = self.place(frame, lay, s["pos"], "center", alpha, (1 - e) * a.get("rise", 0) * self.U, pop)
        if b:
            self.draw_accent_marks(frame, lay, s["style"], s["pos"], "center", dt, phase="over")
        return b

    def draw_parts(self, frame, text, style, pos, anchor, a, dt, remaining):
        by = a.get("by", "word")
        st0 = brandmod.text_style(self.brand, style)
        has_strike = "~~" in text
        pstyle = dict(st0, _anim_strike=True) if has_strike else style
        P = self.parts_layer(text, pstyle, by)
        effect = a.get("effect") or ("type" if by == "letter" else "pop")
        stagger = a.get("stagger", {"word": 0.08, "letter": 0.035, "line": 0.2}[by])
        d_in = a.get("in") or (0.001 if effect == "type" else 0.3)
        ox, oy = self.anchor_offset(P["box"], pos, anchor)
        out_a = min(1.0, remaining / a["out"]) if a.get("out") and not a.get("out_effect") else 1.0
        L = P["layout"]
        self._glass_for(frame, (None, P["box"], L), ox, oy, ease_out(dt / max(0.12, d_in * 0.6)) * out_a)
        if P["base"] is not None:
            eb = ease_out(dt / max(0.12, d_in * 0.6))
            composite_at(frame, with_alpha(P["base"], eb * out_a), ox, oy)
        self.draw_accent_marks(frame, (None, P["box"], L), style, pos, anchor, dt - len(P["parts"]) * stagger * 0.5, phase="under")
        # strike-and-replace: a struck word appears, gets crossed out and dims; everything after waits for it
        strike_at, strike_draw = a.get("strike_at", 0.45), 0.28
        shift, delays, strikes = 0.0, [], {}
        for part in P["parts"]:
            wd = L.words[part["word"]]
            d = part["index"] * stagger + part["line"] * a.get("line_delay", 0.0) + shift
            delays.append(d)
            if wd["tk"].get("strike") and (by != "letter" or part is P["parts"][-1] or L.words[P["parts"][part["index"] + 1]["word"]] is not wd):
                t_s = d + d_in + strike_at
                strikes[part["word"]] = t_s
                shift += d_in + strike_at + strike_draw + 0.15
        last_vis = None
        for part, delay in zip(P["parts"], delays):
            p = (dt - delay) / d_in if d_in else 1.0
            if p <= 0:
                continue
            dist = part["img"].height if effect == "mask" else (a.get("rise") or a.get("dist", 40))
            tf = anim.transform(effect, p, dist if effect != "mask" else dist / self.U, a.get("ease"))
            if a.get("out_effect") and a.get("out") and remaining < a["out"]:
                tf = anim.combine(tf, anim.exit_transform(a["out_effect"], 1 - remaining / a["out"], a.get("dist", 40)))
            if a.get("idle"):
                tf = anim.combine(tf, anim.idle(a["idle"], dt, a.get("idle_amp", 1.0)))
            ts = strikes.get(part["word"])
            if ts is not None and dt > ts:
                tf["alpha"] *= 1 - 0.6 * anim.clamp01((dt - ts) / strike_draw)
            tf["alpha"] *= out_a
            if effect == "mask":
                dy = int(round(tf["dy"] * self.U))
                vis = part["img"].height - max(0, dy)
                if vis > 0:
                    composite_at(frame, with_alpha(part["img"].crop((0, 0, part["img"].width, vis)), tf["alpha"]),
                                 ox + part["x"], oy + part["y"] + max(0, dy))
            else:
                img, (dx, dy) = anim.apply(part["img"], tf, self.U)
                if img is not None:
                    composite_at(frame, img, ox + part["x"] + dx, oy + part["y"] + dy)
            last_vis = part
        for wi, ts in strikes.items():
            if dt > ts:
                x0, y0, x1, y1 = L.word_box(L.words[wi])
                col = color(st0.get("strike_color", self.marks.get("color", "#FF3B30")), self.pal)
                shapes.draw(frame, "strike", (ox + x0, oy + y0, ox + x1, oy + y1), anim.out_cubic((dt - ts) / strike_draw), col,
                            max(6, L.size / self.U * 0.075), self.U, alpha=out_a, seed=wi)
        if a.get("caret") and last_vis is not None:
            blink = (dt * 2.0) % 1 < 0.55 or dt < (delays[-1] + d_in if delays else 0)
            if blink:
                x = ox + last_vis["x"] + last_vis["img"].width + 4 * self.U
                y0 = oy + last_vis["y"]
                ImageDraw.Draw(frame).rectangle((x, y0 + 4 * self.U, x + max(2, 5 * self.U), y0 + L.size * 1.02),
                                                fill=color(L.st.get("accent", L.st.get("color", "#FFFFFF")), self.pal))
        b0 = P["box"]
        self.draw_accent_marks(frame, (None, P["box"], L), style, pos, anchor, dt - len(P["parts"]) * stagger * 0.5, phase="over")
        return (ox + b0[0], oy + b0[1], ox + b0[2], oy + b0[3])

    def draw_accent_marks(self, frame, lay, style, pos, anchor, dt, phase="over"):
        st = brandmod.text_style(self.brand, style)
        am = st.get("accent_mark")
        if not am or (phase == "under") != (am.get("type") == "highlight"):
            return
        L = lay[2]
        ox, oy = self.anchor_offset(lay[1], pos, anchor)
        delay, draw_d = am.get("delay", 0.3), am.get("draw", 0.4)
        p = anim.ease(am.get("ease", "out"), (dt - delay) / draw_d)
        if p <= 0:
            return
        col = color(am.get("color", st.get("accent", self.marks.get("color", "#FF3B30"))), self.pal)
        if am.get("type") == "highlight":
            col = col[:3] + (int(255 * am.get("opacity", 0.5)),)
        runs = []
        for wd in L.words:
            if not wd["tk"].get("accent"):
                continue
            bx = L.word_box(wd)
            if runs and runs[-1]["line"] == wd["line"]:
                runs[-1]["box"] = (runs[-1]["box"][0], bx[1], bx[2], bx[3])
            else:
                runs.append({"line": wd["line"], "box": bx})
        for i, r in enumerate(runs):
            x0, y0, x1, y1 = r["box"]
            shapes.draw(frame, am.get("type", "underline"), (ox + x0, oy + y0, ox + x1, oy + y1), p, col,
                        am.get("width", 7), self.U, hand=am.get("hand", True), pad=am.get("pad"), seed=i, glow=am.get("glow", 0))

    def draw_overlay(self, frame, ov, g):
        F = self.F
        dt = (g - ov["start"]) / F
        remaining = (ov["end"] - g) / F
        an = ov.get("anim")
        kind = ov["kind"]
        if kind == "mark":
            return self.draw_mark_overlay(frame, ov, dt, remaining)
        if kind == "motion":
            return self.draw_motion_overlay(frame, ov, g, dt, remaining)
        if kind == "video":
            return self.draw_video_overlay(frame, ov, g, dt, remaining)
        if kind == "counter":
            lay = self.text_layer(self.counter_text(ov["counter"], dt), ov["style"])
        elif kind == "text":
            if an and an.get("by") in ("word", "letter", "line"):
                a = {"by": an["by"], "effect": an.get("in"), "stagger": an.get("stagger"), "in": an.get("dur"), "ease": an.get("ease"),
                     "out": an.get("out_dur", 0.3) if an.get("out") else ov["fade_out"], "out_effect": an.get("out"), "idle": an.get("idle"),
                     "caret": an.get("caret"), "rise": an.get("dist")}
                a = {k: v for k, v in a.items() if v is not None}
                return self.draw_parts(frame, ov["text"], ov["style"], ov["pos"], ov["anchor"], a, dt, remaining)
            lay = self.text_layer(ov["text"], ov["style"])
            self.draw_accent_marks(frame, lay, ov["style"], ov["pos"], ov["anchor"], dt, phase="under")
        else:
            lay = self.image_layer(ov["image"], ov["size"])
        if an:
            tf = self._anim_tf(an, dt, remaining)
            b = self.place(frame, lay, ov["pos"], ov["anchor"], ov["opacity"], 0, 1.0, tf)
        else:
            e = ease_out(dt / ov["fade_in"]) if ov["fade_in"] else 1.0
            alpha = e * ov["opacity"]
            if ov["fade_out"]:
                alpha *= min(1.0, remaining / ov["fade_out"])
            b = self.place(frame, lay, ov["pos"], ov["anchor"], alpha, (1 - e) * ov["rise"] * self.U)
        if b and ov.get("shine") and kind == "image":
            self.draw_shine(frame, lay[0], b, dt, ov["shine"])
        if b and kind in ("text", "counter"):
            self.draw_accent_marks(frame, lay, ov["style"], ov["pos"], ov["anchor"], dt, phase="over")
        return b

    def counter_text(self, c, dt):
        p = anim.ease(c.get("ease", "out"), (dt - c.get("delay", 0.0)) / max(0.01, c.get("dur", 1.2)))
        v = c["from"] + (c["to"] - c["from"]) * p
        fmt = c.get("format", "int")
        dec = c.get("decimals", 1)
        if fmt == "time":
            v = max(0, int(round(v)))
            s = f"{v // 60}:{v % 60:02d}" if v < 3600 else f"{v // 3600}:{v % 3600 // 60:02d}:{v % 60:02d}"
        elif fmt == "percent":
            s = f"{v:.{dec}f}%" if c.get("decimals") else f"{round(v):d}%"
        elif fmt == "decimal":
            s = f"{v:,.{dec}f}"
        elif fmt == "currency":
            s = f"{c.get('symbol', '$')}{v:,.{c.get('decimals', 0)}f}"
        elif fmt == "comma":
            s = f"{round(v):,d}"
        else:
            s = f"{round(v):d}"
        return f"{c.get('prefix', '')}{s}{c.get('suffix', '')}"

    def draw_shine(self, frame, img, b, dt, sh):
        """A light sweep across an image overlay (logos, buttons)."""
        at, dur = sh.get("at", 0.4), sh.get("dur", 0.6)
        p = (dt - at) / dur
        if not 0 < p < 1:
            return
        x0, y0, x1, y1 = [int(round(v)) for v in b]
        w, h = x1 - x0, y1 - y0
        if w < 2 or h < 2:
            return
        cx = -0.3 * w + 1.6 * w * anim.in_out_cubic(p)
        bw = max(8.0, w * 0.16)
        xs = np.arange(w, dtype=np.float32)[None, :] + np.arange(h, dtype=np.float32)[:, None] * 0.45
        band = np.clip(1 - np.abs(xs - cx - h * 0.2) / bw, 0, 1) ** 2 * sh.get("strength", 0.7)
        src_a = np.asarray((img if img.size == (w, h) else img.resize((w, h))).split()[3], np.float32) / 255
        layer = Image.new("RGBA", (w, h), (255, 255, 255, 0))
        layer.putalpha(Image.fromarray((band * src_a * 255).astype(np.uint8)))
        composite_at(frame, layer, x0, y0)

    def draw_mark_overlay(self, frame, ov, dt, remaining):
        m = ov["mark"]
        p = anim.ease(m.get("ease", "out"), (dt - m.get("delay", 0.0)) / max(0.01, m.get("draw", 0.45)))
        fade = min(1.0, remaining / 0.2) if m.get("fade_out", True) else 1.0
        kind = m["type"]
        col = color(m.get("color", self.marks.get("highlight_color" if kind == "highlight" else "color", "#FF3B30")), self.pal)
        if kind == "highlight":
            col = col[:3] + (int(255 * m.get("opacity", self.marks.get("highlight_opacity", 0.45))),)
        U = self.U
        if "rect" in m:
            x, y, w, h = m["rect"]
            X0, Y0 = self.px(x, self.W), self.px(y, self.H)
            rect = (X0, Y0, X0 + self.px(w, self.W), Y0 + self.px(h, self.H))
        else:
            cx, cy = self.pos(m.get("pos", "center"))
            r = self.px(m.get("size", 60), self.W) / 2
            rect = (cx - r, cy - r, cx + r, cy + r)
        start = end = None
        if kind == "arrow":
            end = self.pos(m["to"]) if "to" in m else ((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2)
            start = self.pos(m["from"])
        shapes.draw(frame, kind, rect, p, col, m.get("width", self.marks.get("width", 9)), U, hand=m.get("hand", True),
                    pad=m.get("pad"), radius=m.get("radius"), glow=m.get("glow", self.marks.get("glow", 0)), alpha=fade,
                    seed=m.get("seed", 0), start=start, end=end, strength=m.get("strength", 0.6))
        if m.get("label") and p > 0.6:
            self._mark_label(frame, m, rect, anim.clamp01((p - 0.6) / 0.4) * fade)
        return None

    def _mark_label(self, frame, m, rect, alpha):
        lay = self.text_layer(m["label"], m.get("label_style", self.marks.get("label_style", "label")))
        side = m.get("label_side", "bottom")
        gap = 26 * self.U
        x0, y0, x1, y1 = rect
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        (bx0, by0, bx1, by1) = lay[1]
        lw, lh = bx1 - bx0, by1 - by0
        px_, py_ = {"bottom": (cx, y1 + gap + lh / 2), "top": (cx, y0 - gap - lh / 2),
                    "left": (x0 - gap - lw / 2, cy), "right": (x1 + gap + lw / 2, cy)}.get(side, (cx, y1 + gap + lh / 2))
        composite_at(frame, with_alpha(lay[0], alpha), px_ - (bx0 + lw / 2), py_ - (by0 + lh / 2) + (1 - alpha) * 12 * self.U)

    def _restart_if_skipped(self, key, g):
        """Overlay readers are sequential: when frames are skipped (--frames stills, a jump), reopen at frame g."""
        nxt = getattr(self, "_ov_next", None)
        if nxt is None:
            nxt = self._ov_next = {}
        if key in self._ov_gens and nxt.get(key) != g:
            self._ov_gens.pop(key).close()
        nxt[key] = g + 1

    def draw_motion_overlay(self, frame, ov, g, dt, remaining):
        key = ("motion", id(ov))
        self._restart_if_skipped(key, g)
        if key not in self._ov_gens:
            k0 = max(0, g - ov["start"])
            self._ov_gens[key] = read_rgba(ov["motion_file"], self.W, self.H, start_idx=k0, fps=self.F)
        fr = next(self._ov_gens[key], None)
        if fr is None:
            return None
        img = Image.fromarray(fr.copy(), "RGBA")
        an = ov.get("anim") or {"in": "fade", "dur": ov["fade_in"] or 0.001, "out": "fade" if ov["fade_out"] else None, "out_dur": ov["fade_out"] or 0.001}
        tf = self._anim_tf(an, dt, remaining)
        tf["alpha"] *= ov["opacity"]
        if anim.is_identity(tf):
            frame.alpha_composite(img)
        else:
            out, (dx, dy) = anim.apply(img, tf, self.U)
            if out is not None:
                composite_at(frame, out, dx, dy)
        return None

    def draw_video_overlay(self, frame, ov, g, dt, remaining):
        key = ("video", id(ov))
        self._restart_if_skipped(key, g)
        if key not in self._ov_gens:
            k0 = max(0, g - ov["start"])
            self._ov_gens[key] = self.video_frames(self.spec["sources"][ov["src"]]["path"], ov["times"][k0:])
        img = next(self._ov_gens[key], None)
        if img is None:
            return None
        lay = ov["layout"]
        W, H = self.W, self.H
        info = self.spec["sources"][ov["src"]]["info"]
        cx, cy = self.pos(lay.get("pos", ["50%", "50%"]))
        typ = lay.get("type", "card")
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        if typ == "iphone":
            dev = self.device_for({"src": ov["src"], "layout": {"type": "iphone", "style": "screen" if lay.get("bezel") is False else "full",
                                                                  **{k: v for k, v in lay.items() if k in ("finish", "island", "shadow")}}}, img)
            sw = self.px(lay.get("width", 360), W)
            sh = sw * info["height"] / info["width"]
            self._draw_device(layer, dev, img, cx - sw / 2, cy - sh / 2, sw, sh, 1.0, straight=True)
        else:
            w = int(round(self.px(lay.get("width", 420), W)))
            h = int(round(self.px(lay["height"], H))) if lay.get("height") else int(round(w * info["height"] / info["width"]))
            if typ == "circle":
                h = w
            src = img.convert("RGB")
            sw_, sh_ = src.size
            k = max(w / sw_, h / sh_)
            bw, bh = w / k, h / k
            fx, fy = lay.get("focus", [info["width"] / 2, info["height"] / 2])
            s = sw_ / info["width"]
            x0 = min(max(fx * s - bw / 2, 0), sw_ - bw)
            y0 = min(max(fy * s - bh / 2, 0), sh_ - bh)
            content = src.resize((w, h), Image.LANCZOS, box=(x0, y0, x0 + bw, y0 + bh)).convert("RGBA")
            r = w // 2 if typ == "circle" else int(self.px(lay.get("radius", 36), W))
            mkey = ("pipmask", w, h, r)
            if mkey not in self._mask_cache:
                self._mask_cache[mkey] = rounded_mask(w, h, r)
            content.putalpha(self._mask_cache[mkey])
            X, Y = int(round(cx - w / 2)), int(round(cy - h / 2))
            shadow = Image.new("L", (W, H), 0)
            ImageDraw.Draw(shadow).rounded_rectangle((X, Y + 18 * self.U, X + w, Y + h + 18 * self.U), r, fill=140)
            shadow = shadow.filter(ImageFilter.GaussianBlur(26 * self.U))
            sl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            sl.putalpha(shadow)
            layer.alpha_composite(sl)
            layer.alpha_composite(content, (X, Y))
            if lay.get("border"):
                bw_ = max(2, int(self.px(lay.get("border_width", 6), W)))
                ImageDraw.Draw(layer).rounded_rectangle((X, Y, X + w, Y + h), r, outline=color(lay["border"], self.pal), width=bw_)
        an = ov.get("anim") or {"in": "pop", "dur": 0.4, "out": "fade", "out_dur": 0.25}
        tf = self._anim_tf(an, dt, remaining)
        tf["alpha"] *= ov["opacity"]
        bb = layer.getbbox()
        if not bb:
            return None
        crop = layer.crop(bb)
        out, (dx, dy) = anim.apply(crop, tf, self.U)
        if out is not None:
            composite_at(frame, out, bb[0] + dx, bb[1] + dy)
        return None

    def draw_texts(self, frame, g):
        F = self.F
        boxes = []
        for s in self.plan["sections"]:
            if s["text"] and s["start"] <= g < s["end"] and not s.get("behind"):
                b = self.draw_section_text(frame, s, g)
                if b:
                    boxes.append(("section text '" + s["text"].replace(chr(10), " ")[:28] + "'", b))
        for ov in self.plan["overlays"]:
            if ov["start"] <= g < ov["end"]:
                b = self.draw_overlay(frame, ov, g)
                if b and ov["kind"] in ("text", "counter"):
                    boxes.append(("overlay '" + (ov.get("text") or "counter").replace(chr(10), " ")[:28] + "'", b))
            elif g >= ov["end"] and ("motion", id(ov)) in self._ov_gens:
                self._ov_gens.pop(("motion", id(ov))).close()
            elif g >= ov["end"] and ("video", id(ov)) in self._ov_gens:
                self._ov_gens.pop(("video", id(ov))).close()
        if self.chunks:
            b = self.draw_caption(frame, g / F - self.cap_offset)
            if b:
                boxes.append(("caption", b))
        return boxes

    def draw_caption(self, frame, t):
        ci, wi = capmod.active(self.chunks, t)
        if ci is None:
            return None
        c = self.chunks[ci]
        dt = t - c["start"]
        an = self.cap_anim
        hl = self.cap_style.get("text", {}).get("highlight") is not None
        if an in ("reveal", "bounce"):
            toks = [{"t": w["w"], "highlight": (hl and j == wi)} for j, w in enumerate(c["words"])]
            key = ("capp", ci, wi)
            if key not in self._parts_cache:
                self._parts_cache[key] = render_parts(toks, self.cap_text_style, self.pal, self.U, by="word")
            P = self._parts_cache[key]
            ox, oy = self.anchor_offset(P["box"], self.cap_pos, "center")
            if P["base"] is not None:
                composite_at(frame, with_alpha(P["base"], min(1.0, dt / 0.08 + 0.2)), ox, oy)
            for part in P["parts"]:
                w = c["words"][min(part["word"], len(c["words"]) - 1)]
                wdt = t - w["start"]
                if an == "reveal" and wdt < 0:
                    continue
                if an == "reveal":
                    tf = anim.transform("pop_small", wdt / 0.16)
                else:
                    tf = anim._t()
                    if part["word"] == wi:
                        k = anim.clamp01(wdt / 0.22)
                        tf["scale"] = 1 + 0.16 * math.sin(math.pi * k) * (1 - k * 0.3)
                img, (dx, dy) = anim.apply(part["img"], tf, self.U)
                if img is not None:
                    composite_at(frame, img, ox + part["x"] + dx, oy + part["y"] + dy)
            b0 = P["box"]
            return (ox + b0[0], oy + b0[1], ox + b0[2], oy + b0[3])
        toks = [{"t": w["w"], "highlight": (hl and j == wi)} for j, w in enumerate(c["words"])]
        key = ("cap", ci, wi)
        if key not in self._text_cache:
            r = render_rich(toks, self.cap_text_style, self.pal, self.U)
            self._text_cache[key] = (r["img"], r["box"], r["layout"])
        lay = self._text_cache[key]
        e = ease_out(dt / 0.12)
        if an == "pop":
            pe = min(1.0, dt / 0.14)
            return self.place(frame, lay, self.cap_pos, "center", min(1.0, dt / 0.05 + 0.2),
                              0, 0.88 + 0.12 * (1 - (1 - pe) ** 3) + 0.035 * math.sin(math.pi * pe))
        if an == "none":
            return self.place(frame, lay, self.cap_pos, "center", 1.0)
        if an == "slide":
            return self.place(frame, lay, self.cap_pos, "center", e, 0, 1.0, anim.transform("slide_up", dt / 0.18, 12))
        return self.place(frame, lay, self.cap_pos, "center", e, (1 - e) * 8 * self.U)

    # ------------------------------------------------------------ clip annotations
    TAP_DUR = 0.5

    def draw_taps(self, frame, g, seg):
        """Touch indicator (like iOS 'show touches') where the recording was tapped."""
        for t in self.plan.get("taps", []):
            if t["seg"] != seg["label"]:
                continue
            p = (g - t["g"]) / self.F / self.TAP_DUR
            if not (0 <= p < 1) or t["seg"] not in self._xf:
                continue
            ax, bx, ay, by, clip = self._xf[t["seg"]]
            cx, cy = self.map_pt(t["seg"], t["pos"][0], t["pos"][1])
            if t["seg"] in self._H:
                x0_, y0_, x1_, y1_ = clip
                q = [self.map_pt(t["seg"], (x0_ - bx) / ax, (y0_ - by) / ay), self.map_pt(t["seg"], (x1_ - bx) / ax, (y1_ - by) / ay)]
                clip = (min(q[0][0], q[1][0]), min(q[0][1], q[1][1]), max(q[0][0], q[1][0]), max(q[0][1], q[1][1]))
            u = self.U * max(0.6, min(1.6, ax / 0.687))       # follow the phone's on-screen scale
            r_dot, r_ring = 30 * u * (1 - 0.18 * p), (30 + 46 * ease_out(p)) * u
            ss, R = 2, int(r_ring + 8 * u) + 2
            lay = Image.new("RGBA", (2 * R * ss, 2 * R * ss), (0, 0, 0, 0))
            d = ImageDraw.Draw(lay)
            c = R * ss
            fade = (1 - p) ** 1.3
            d.ellipse((c - r_ring * ss, c - r_ring * ss, c + r_ring * ss, c + r_ring * ss),
                      outline=(255, 255, 255, int(170 * fade)), width=max(2, int(4 * u * ss)))
            d.ellipse((c - r_dot * ss, c - r_dot * ss, c + r_dot * ss, c + r_dot * ss),
                      fill=(255, 255, 255, int(125 * fade)), outline=(40, 30, 50, int(60 * fade)), width=max(1, int(2 * u * ss)))
            lay = lay.resize((2 * R, 2 * R), Image.LANCZOS)
            x0, y0 = int(round(cx - R)), int(round(cy - R))
            # clip to the screen / card / frame the tap belongs to
            X0, Y0, X1, Y1 = int(clip[0]), int(clip[1]), int(clip[2]), int(clip[3])
            cx0, cy0 = max(0, X0 - x0), max(0, Y0 - y0)
            cx1, cy1 = min(lay.width, X1 - x0), min(lay.height, Y1 - y0)
            if cx1 > cx0 and cy1 > cy0:
                composite_at(frame, lay.crop((cx0, cy0, cx1, cy1)), x0 + cx0, y0 + cy0)

    def draw_lifts(self, frame, seg, img, k):
        """Pop-out callouts: a region of the real recording lifts off the screen, scales up, holds, returns."""
        t = k / self.F
        for L in seg.get("lifts") or []:
            lt = t - L["t0"]
            tin, hold, tout = L.get("in", 0.4), L.get("hold", 1.4), L.get("out", 0.3)
            if lt < 0 or lt > tin + hold + tout or seg["label"] not in self._xf:
                continue
            if lt < tin:
                p = anim.ease(L.get("ease", "spring"), lt / tin)
            elif lt < tin + hold:
                p = 1.0
            else:
                p = 1 - anim.in_out_cubic((lt - tin - hold) / tout) if tout else 0.0
            x, y, w, h = L["rect"]
            s = self._src_scale(seg, img)
            src = img.convert("RGB") if img.mode != "RGB" else img
            crop = src.crop((int(x * s), int(y * s), int(math.ceil((x + w) * s)), int(math.ceil((y + h) * s))))
            X0, Y0, X1, Y1 = self.map_rect(seg["label"], (x, y, w, h))
            ow, oh = X1 - X0, Y1 - Y0
            if ow < 2 or oh < 2:
                continue
            ocx, ocy = (X0 + X1) / 2, (Y0 + Y1) / 2
            tcx, tcy = self.pos(L["to"]) if L.get("to") else (ocx, ocy - L.get("up", 0) * self.U)
            fade_mode = L.get("exit", "return") == "fade" and lt > tin + hold
            q = 1.0 if fade_mode else p
            sc = 1 + (L.get("scale", 1.25) - 1) * q
            ccx, ccy = ocx + (tcx - ocx) * q, ocy + (tcy - ocy) * q
            cw, ch = max(2, int(round(ow * sc))), max(2, int(round(oh * sc)))
            alpha = p if fade_mode else anim.clamp01(p * 3)
            if L.get("dim"):
                dim = Image.new("RGBA", frame.size, (0, 0, 0, int(255 * L["dim"] * anim.clamp01(p))))
                frame.alpha_composite(dim)
            card = crop.resize((cw, ch), Image.LANCZOS).convert("RGBA")
            r = int(L.get("radius", 18) * (ow / w) * sc)
            card.putalpha(rounded_mask(cw, ch, max(0, r)).point(lambda v: int(v * alpha)))
            pad = int(40 * self.U)
            sh = Image.new("L", (cw + 2 * pad, ch + 2 * pad), 0)
            ImageDraw.Draw(sh).rounded_rectangle((pad, pad + 14 * self.U * sc, pad + cw, pad + ch + 14 * self.U * sc), r,
                                                 fill=int(170 * L.get("shadow", 0.6) * alpha))
            sh = sh.filter(ImageFilter.GaussianBlur(18 * self.U))
            shl = Image.new("RGBA", sh.size, (0, 0, 0, 0))
            shl.putalpha(sh)
            composite_at(frame, shl, ccx - cw / 2 - pad, ccy - ch / 2 - pad)
            composite_at(frame, card, ccx - cw / 2, ccy - ch / 2)
            if L.get("border"):
                bl = Image.new("RGBA", (cw + 8, ch + 8), (0, 0, 0, 0))
                ImageDraw.Draw(bl).rounded_rectangle((4, 4, cw + 3, ch + 3), r, outline=color(L["border"], self.pal)[:3] + (int(230 * alpha),),
                                                     width=max(2, int(L.get("border_width", 4) * self.U)))
                composite_at(frame, bl, ccx - cw / 2 - 4, ccy - ch / 2 - 4)

    def draw_marks(self, frame, seg, k):
        t = k / self.F
        for i, m in enumerate(seg.get("marks") or []):
            mt = t - m["t0"]
            if mt < 0 or seg["label"] not in self._xf:
                continue
            dur = m.get("dur")
            fade = 1.0
            if dur is not None:
                if mt > dur + 0.2:
                    continue
                if mt > dur:
                    fade = 1 - (mt - dur) / 0.2
            p = anim.ease(m.get("ease", "out"), mt / max(0.01, m.get("draw", 0.45)))
            kind = m["type"]
            col = color(m.get("color", self.marks.get("highlight_color" if kind == "highlight" else "color", "#FF3B30")), self.pal)
            if kind == "highlight":
                col = col[:3] + (int(255 * m.get("opacity", self.marks.get("highlight_opacity", 0.45))),)
            rect = self.map_rect(seg["label"], m["rect"]) if "rect" in m else None
            if rect is None:
                cx, cy = self.map_pt(seg["label"], *m["pos"])
                r = m.get("size", 50) * self.U / 2
                rect = (cx - r, cy - r, cx + r, cy + r)
            start = end = None
            if kind == "arrow":
                x0, y0, x1, y1 = rect
                side = m.get("side", "left")
                L_ = m.get("length", 170) * self.U
                gap = 14 * self.U
                end = {"left": (x0 - gap, (y0 + y1) / 2), "right": (x1 + gap, (y0 + y1) / 2), "top": ((x0 + x1) / 2, y0 - gap),
                       "bottom": ((x0 + x1) / 2, y1 + gap)}[side]
                vx, vy = {"left": (-1, 0.35), "right": (1, 0.35), "top": (0.35, -1), "bottom": (0.35, 1)}[side]
                start = self.map_pt(seg["label"], *m["from"]) if m.get("from") else (end[0] + vx * L_, end[1] + vy * L_)
            shapes.draw(frame, kind, rect, p, col, m.get("width", self.marks.get("width", 9)), self.U, hand=m.get("hand", True),
                        pad=m.get("pad"), radius=m.get("radius"), glow=m.get("glow", self.marks.get("glow", 0)), alpha=fade,
                        seed=i, start=start, end=end, strength=m.get("strength", 0.6))
            if m.get("label") and p > 0.6:
                self._mark_label(frame, m, rect, anim.clamp01((p - 0.6) / 0.4) * fade)

    def last_tap(self, seg, g):
        """Output position of the latest tap in a segment before frame g (zoom-through target), or None."""
        best = None
        for t in self.plan.get("taps", []):
            if t["seg"] == seg["label"] and t["g"] <= g and (best is None or t["g"] > best["g"]):
                best = t
        if best is None or seg["label"] not in self._xf:
            return None
        return self.map_pt(seg["label"], best["pos"][0], best["pos"][1])

    def compose_full(self, seg, img, k, g):
        fr = self.compose(seg, img, k)
        if seg.get("taps"):
            self.draw_taps(fr, g, seg)
        if seg.get("marks"):
            self.draw_marks(fr, seg, k)
        if seg.get("lifts"):
            self.draw_lifts(fr, seg, img, k)
        return fr

    def first_frame(self):
        """Frame 0 composited (for loop endings), rendered once by a helper renderer."""
        if self._first is None:
            sub = Renderer(self.spec, self.plan, preview=self.pscale != 1.0, caption_words=None)
            sub.loop_n = 0
            g, fr = next(sub.frames(only={0}, g0=0, g1=1))
            self._first = fr.convert("RGBA")
        return self._first

    # ------------------------------------------------------------ main loop
    def frames(self, only=None, step=1, g0=0, g1=None):
        """Yield (g, RGB PIL frame) for g in [g0, g1). `only`: frame indices to render; `step`: every n-th frame."""
        plan = self.plan
        segs = plan["segments"]
        gens = {}
        total = plan["total"]
        g1 = total if g1 is None else min(total, g1)
        fade_in = int(round(self.spec["output"].get("fade_in", 0) * self.F))
        fade_out = int(round(self.spec["output"].get("fade_out", 0) * self.F))
        sz = safezones.overlay_image(self.W, self.H, self.spec["output"]["platforms"]) if self.show_safezones else None
        checked = set()
        for g in range(g0, g1):
            active = [s for s in segs if s["start"] <= g < s["end"]]
            layers = []
            for s in active:
                i = id(s)
                if i not in gens:
                    gens[i] = self.seg_frames(s, k0=g - s["start"])
                img = next(gens[i])
                layers.append((s, img, g - s["start"]))
            for s in segs:  # release finished readers
                if id(s) in gens and s["end"] <= g:
                    gens.pop(id(s)).close()
            if (only is not None and g not in only) or g % step:
                continue
            s0, img0, k0 = layers[0]
            fr = self.compose_full(s0, img0, k0, g)
            if len(layers) > 1:
                s1, img1, k1 = layers[-1]
                fr1 = self.compose_full(s1, img1, k1, g)
                a = (k1 + 1) / (s1["trans"]["n"] + 1)
                tr = s1["trans"]
                if tr["type"] == "zoom" and tr.get("pos", "auto") == "auto":
                    tr = dict(tr, _focus=self.last_tap(s0, g))
                elif tr["type"] == "zoom" and isinstance(tr.get("pos"), (list, tuple)):
                    tr = dict(tr, _focus=self.pos(tr["pos"]))
                fr = self.blend(fr, fr1, min(1.0, a), tr, g)
            boxes = self.draw_texts(fr, g)
            for what, b in boxes:
                k = (what, round(b[0]), round(b[1]))
                if k not in checked and self.spec["output"]["aspect"] == "9:16":
                    checked.add(k)
                    for w in safezones.check(b, self.W, self.H, self.spec["output"]["platforms"], what):
                        self.warnings.append(f"{g / self.F:6.2f}s  {w}")
            if self.loop_n and g >= total - self.loop_n:
                f0img = self.first_frame()
                fr = Image.blend(fr, f0img, anim.in_out_cubic((g - (total - self.loop_n) + 1) / (self.loop_n + 1)))
            if fade_in and g < fade_in:
                fr = Image.blend(Image.new("RGBA", fr.size, (0, 0, 0, 255)), fr, (g + 1) / (fade_in + 1))
            if fade_out and g >= total - fade_out:
                fr = Image.blend(fr, Image.new("RGBA", fr.size, (0, 0, 0, 255)), (g - (total - fade_out) + 1) / (fade_out + 1))
            out = fr.convert("RGB")
            if self.grade_on:
                out = self.grade(out)
            if sz is not None:
                out = out.convert("RGBA")
                out.alpha_composite(sz)
                out = out.convert("RGB")
            yield g, out
        for gen in gens.values():
            gen.close()
        for gen in self._ov_gens.values():
            gen.close()
        self._ov_gens.clear()

    def _grade_lut(self):
        if getattr(self, "_lut", None) is None:
            L = self.look
            x = np.arange(256, dtype=np.float32) / 255.0
            chans = []
            w = float(L.get("warmth") or 0)
            for gain in (1 + 0.08 * w, 1 + 0.01 * w, 1 - 0.08 * w):
                a = x * gain + float(L.get("brightness") or 0)
                if L.get("contrast"):
                    a = (a - 0.5) * float(L["contrast"]) + 0.5
                if L.get("gamma"):
                    a = np.clip(a, 0, 1) ** (1 / float(L["gamma"]))
                if L.get("lift"):
                    a = float(L["lift"]) + a * (1 - float(L["lift"]))
                chans.append(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8))
            self._lut = np.stack(chans, 1)[:, None, :]   # 256 x 1 x 3 for cv2.LUT
        return self._lut

    def grade(self, img):
        """Colour look on the final RGB frame: warmth, brightness, contrast, gamma, lifted blacks (one LUT) + saturation."""
        import cv2
        L = self.look
        out = Image.fromarray(cv2.LUT(np.asarray(img), self._grade_lut()))
        if L.get("saturation") and L["saturation"] != 1:
            from PIL import ImageEnhance
            out = ImageEnhance.Color(out).enhance(float(L["saturation"]))
        return out

    def look_filters(self):
        """(before, after) ffmpeg filter chains for the look: chroma split on RGB; sharpen, vignette,
        bloom and film grain on the encoded YUV."""
        L, W = self.look, self.W
        pre, post = [], []
        if L.get("chroma"):
            n = max(1, round(float(L["chroma"]) * W / 1080))
            pre.append(f"rgbashift=rh=-{n}:bh={n}")
        if L.get("sharpen"):
            post.append(f"unsharp=5:5:{float(L['sharpen']):.2f}:5:5:0")
        if L.get("bloom"):
            post.append(f"split[a][b];[b]gblur=sigma={18 * W / 1080:.1f}[bb];[a][bb]blend=all_mode=screen:all_opacity={float(L['bloom']):.2f}")
        if L.get("vignette"):
            post.append(f"vignette=angle={0.25 + 0.5 * float(L['vignette']):.3f}")
        if L.get("grain"):
            post.append(f"noise=alls={max(1, int(float(L['grain']) * 40))}:allf=t+u")
        return ",".join(pre) or None, ",".join(post) or None

    def encode(self, out_path, preview=False, progress=True, g0=0, g1=None, threads=None, vf_extra=None):
        step = 2 if preview else 1
        pre, post = self.look_filters()
        vf = "scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p"
        if pre:
            vf = f"{pre},{vf}"
        if post:
            vf = f"{vf},{post}"
        if vf_extra:
            vf = f"{vf_extra},{vf}"
        cmd = [FFMPEG, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{self.W}x{self.H}",
               "-r", f"{self.F / step:g}", "-i", "-",
               "-vf", vf,
               "-c:v", "libx264", "-preset", "ultrafast" if preview else self.spec["output"].get("preset", "slow"),
               "-crf", str(26 if preview else self.spec["output"].get("crf", 16)), "-profile:v", "high"]
        if threads:
            cmd += ["-threads", str(threads)]
        cmd += ["-bsf:v", "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
                "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                "-movflags", "+faststart", str(out_path)]
        enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        total = (self.plan["total"] if g1 is None else g1) - g0
        tick = max(1, total // 10)
        for g, fr in self.frames(step=step, g0=g0, g1=g1):
            enc.stdin.write(fr.tobytes())
            if progress and ((g - g0) // tick) != ((g - g0 - step) // tick):
                print(f"  frames {g - g0 + 1}/{total}", flush=True)
        enc.stdin.close()
        if enc.wait() != 0:
            raise RuntimeError("ffmpeg encode failed")
