"""Frame compositor: layouts (iphone / card / fullbleed / fit / motion), camera moves incl. 3D tilt,
transitions, section text (whole block or word/letter animation), overlays (text, image, counter,
mark, video picture-in-picture, Remotion motion layers), clip annotations (marks, pop-out lifts,
taps) and captions. Frames are piped to ffmpeg/libx264."""
import json
import math
import re
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from . import anim
from . import backgrounds
from . import brand as brandmod
from . import captions as capmod
from . import safezones
from . import screenplate
from . import shapes
from .device import IPhone, detect_recorded_hole, detect_recorded_island
from .media import FFMPEG, probe, proxy, read_frames, read_rgba, still
from .text import color, parse_markup, render_parts, render_rich

ease = anim.in_out_cubic
ease_out = anim.out_cubic

DIRS = {"left": (-1, 0), "right": (1, 0), "up": (0, -1), "down": (0, 1)}
TRANS_EASE = {"slide": "in_out_expo", "push": "in_out_expo", "whip": "in_out_expo", "zoom": "in_out", "blur": "in_out",
              "wipe": "in_out", "circle": "in_out", "glitch": "linear", "flash": "linear", "crossfade": "linear",
              "shrink": "linear", "grow": "linear", "flood": "linear"}


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
        self._reveals = {}
        self._chrome_cache, self._vig_cache, self._parts_cache = {}, {}, {}
        self._xf = {}          # segment label -> (ax, bx, ay, by, clip rect): source px -> output px
        self._H = {}           # segment label -> 3x3 homography applied after _xf (3D tilt), if any
        self._ov_gens = {}
        self._plate_readers = {}
        self.marks = self.brand.get("marks", {})
        self.look = spec.get("look") or {}
        lp = spec["output"].get("loop")
        self.loop_n = int(round((lp.get("dur", 0.4) if isinstance(lp, dict) else 0.4) * self.F)) if lp else 0
        self._first = None
        self._masker = None          # Vision subject masks (behind: subject|person), started on first use
        self.grade_on = any(self.look.get(k) for k in ("contrast", "saturation", "brightness", "gamma", "warmth", "lift"))
        self.chunks = None
        self.cap_style = None
        self.vo_words = caption_words or []      # voice-over words at output time (for text with anim.sync: voice)
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
                for c in self.chunks:   # a kept chunk was stretched to meet the next one: stop it where a skipped section starts
                    for a, b in spans:
                        if c["start"] + self.cap_offset < a < c["end"] + self.cap_offset:
                            c["end"] = a - self.cap_offset
            if cap.get("skip_text"):  # drop caption chunks that duplicate on-screen text (headers, hooks)
                def _norm(t):
                    return re.sub(r"[^a-z0-9']+", "", t.lower())
                stream = [_norm(w["w"]) for w in caption_words]
                marked = set()
                for phrase in cap["skip_text"]:
                    target = [n for n in (_norm(t) for t in phrase.split()) if n]
                    for i in range(len(stream) - len(target) + 1):
                        if stream[i:i + len(target)] == target:
                            marked.update(range(i, i + len(target)))
                idx = {id(w): j for j, w in enumerate(caption_words)}
                self.chunks = [c for c in self.chunks
                               if not all(idx.get(id(w)) in marked for w in c["words"])]
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
            self._xf[seg["label"]] = (self.pscale, 0.0, self.pscale, 0.0, (0, 0, self.W, self.H))
            fr = self.behind_text(self.background(seg["background"], img, (seg["start"] + k) / self.F), seg, k)
        elif t == "fullbleed":
            fr = self.l_fullbleed(seg, img, k)
        elif t == "card":
            fr = self.l_card(seg, img, k)
        elif t == "iphone":
            fr = self.l_iphone(seg, img, k)
        elif t == "plate":
            fr = self.l_plate(seg, img, k)
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

    def _plate_frame(self, path, idx):
        """RGB frame `idx` of a plate's CFR proxy (sequential reads are streamed, jumps restart the reader)."""
        pth, fps, w, h = proxy(path, self.pscale)
        st = self._plate_readers.get(path)
        if st is None or idx < st[1] or idx - st[1] > 45:
            if st is not None:
                st[0].close()
            n = max(1, int(round(probe(pth)["duration"] * fps)))
            st = [read_frames(pth, w, h, idx, n - idx, fps), idx, None]
            self._plate_readers[path] = st
        while st[1] <= idx:
            fr = next(st[0], None)
            if fr is None:
                break
            st[2], st[1] = fr, st[1] + 1
        return st[2], w, h

    def _plate_run(self, seg):
        """(first, end) output frame of the run of back-to-back segments that use the same plate as `seg`."""
        key = ("plate_run", seg["label"])
        if key not in self._mask_cache:
            segs = self.plan["segments"]
            i = next(j for j, s_ in enumerate(segs) if s_["label"] == seg["label"])
            same = lambda s_: s_["layout"].get("type") == "plate" and s_["layout"].get("plate") == seg["layout"].get("plate")  # noqa: E731
            a = i
            while a > 0 and same(segs[a - 1]):
                a -= 1
            b = i
            while b + 1 < len(segs) and same(segs[b + 1]):
                b += 1
            self._mask_cache[key] = (segs[a]["start"], segs[b]["end"])
        return self._mask_cache[key]

    def l_plate(self, seg, img, k):
        """The recording inside a filmed phone: a plate (hand holding a phone with a chroma-key screen) is tracked per
        frame and the real screen recording is warped into its screen; fingers over the screen stay in front."""
        import cv2
        W, H = self.W, self.H
        lay = seg["layout"]
        path = self.spec["sources"][lay["plate"]]["path"]
        key = lay.get("key", "green")
        pinfo = self.spec["sources"][lay["plate"]]["info"]
        r0, r1 = self._plate_run(seg)                         # one continuous plate across consecutive plate clips
        ts = (seg["start"] + k - r0) / self.F
        if pinfo.get("kind") == "image":                      # still plate: rock steady; life comes from `push`
            ck = ("plate_img", str(path), self.pscale)
            if ck not in self._mask_cache:
                im = Image.open(path).convert("RGB")
                if self.pscale != 1:
                    im = im.resize((int(im.width * self.pscale), int(im.height * self.pscale)), Image.LANCZOS)
                self._mask_cache[ck] = (np.asarray(im), screenplate.track_image(path, key))
            pf, c0 = self._mask_cache[ck]
            ph, pw = pf.shape[:2]
            q = c0 * (pw / pinfo["width"])
            fid = -1
        else:
            tfps, corners = screenplate.track(path, key)
            t = ts * lay.get("plate_speed", 1.0) + lay.get("plate_in", 0.0)
            idx = int(round(t * tfps)) % len(corners)
            pf, pw, ph = self._plate_frame(path, idx)
            q = corners[idx] * (pw / pinfo["width"])          # plate proxy px
            fid = idx
        # plate -> output: cover the frame, optional zoom (+ slow push over the section) around the screen centre
        z = lay.get("zoom", 1.0)
        if lay.get("push"):
            z0, z1 = lay["push"]
            u = anim.ease("in_out", min(1.0, ts / max(0.1, (r1 - r0) / self.F)))
            z *= z0 + (z1 - z0) * u
        # anti-aliasing: pre-scale the plate once to its base size with an area filter (fixed per run, so no shimmer),
        # then only a small residual scale (the push) is resampled per frame
        kbase = max(W / pw, H / ph) * lay.get("zoom", 1.0)
        pw2, ph2 = int(round(pw * kbase)), int(round(ph * kbase))
        mask = screenplate.key_mask(pf, key)
        inside = np.zeros_like(mask)                          # only key inside the tracked screen (not green things behind)
        ctr = q.mean(0)
        cv2.fillConvexPoly(inside, (ctr + (q - ctr) * 1.03).astype(np.int32), 255)
        mask = cv2.bitwise_and(mask, inside)
        ck = ("plate_pre", str(path), self.pscale, pw2, fid)
        if ck not in self._mask_cache:
            if len([kk for kk in self._mask_cache if kk[0] == "plate_pre"]) > 2:   # video plates: keep only recent frames
                for kk in [kk for kk in self._mask_cache if kk[0] == "plate_pre"]:
                    del self._mask_cache[kk]
            self._mask_cache[ck] = (cv2.resize(screenplate.despill(pf, mask), (pw2, ph2), interpolation=cv2.INTER_AREA),
                                    cv2.resize(mask, (pw2, ph2), interpolation=cv2.INTER_AREA))
        pre, pmask = self._mask_cache[ck]
        q = q * np.float32([pw2 / pw, ph2 / ph])
        r = z / lay.get("zoom", 1.0)                          # residual scale (push), ~1.0-1.05
        c = q.mean(0)                                         # always centre on the screen (clamped to the plate)
        ox = min(0.0, max(W - pw2 * r, W / 2 - c[0] * r))
        oy = min(0.0, max(H - ph2 * r, H / 2 - c[1] * r))
        k0 = r
        A = np.array([[r, 0, ox], [0, r, oy]], np.float32)
        plate = cv2.warpAffine(pre, A, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        m = cv2.warpAffine(pmask, A, (W, H), flags=cv2.INTER_LINEAR)
        m = cv2.erode(m, np.ones((3, 3), np.uint8))
        m = cv2.GaussianBlur(m, (0, 0), max(0.6, 1.2 * self.pscale)).astype(np.float32)[..., None] / 255.0
        quad = (q * k0 + [ox, oy]).astype(np.float32)
        inset = float(lay.get("inset", 0)) * self.U
        if inset:
            ctr = quad.mean(0)
            quad = ctr + (quad - ctr) * (1 + inset / max(1.0, np.linalg.norm(quad[1] - quad[0])))
        rec = np.asarray(img.convert("RGB"))
        sh_, sw_ = rec.shape[:2]
        if lay.get("island", "auto") == "auto" and seg.get("src"):   # erase the recorded pill + red dot (the plate has its own)
            ck = ("plate_island", seg["src"], sw_)
            if ck not in self._mask_cache:
                self._mask_cache[ck] = detect_recorded_island(img)
            bb = self._mask_cache[ck]
            if bb:
                x0b, y0b, x1b, y1b = bb
                pad = max(2, int(0.006 * sw_))
                x0b, y0b, x1b, y1b = max(0, x0b - pad), max(0, y0b - pad), min(sw_, x1b + pad), min(sh_, y1b + pad)
                side = np.concatenate([rec[y0b:y1b, max(0, x0b - 3 * pad):x0b], rec[y0b:y1b, x1b:x1b + 3 * pad]], 1)
                rec = rec.copy()
                rec[y0b:y1b, x0b:x1b] = np.median(side.reshape(-1, 3), 0).astype(np.uint8)
        Hm = cv2.getPerspectiveTransform(np.float32([[0, 0], [sw_, 0], [sw_, sh_], [0, sh_]]), quad)
        # the recording shrinks ~3x into the screen: area-filter it to a fixed size first (per segment) so UI text
        # doesn't shimmer as the push changes the scale
        fk = ("plate_fs", seg["label"])
        if fk not in self._mask_cache:
            self._mask_cache[fk] = min(1.0, 1.25 * float(np.linalg.norm(quad[1] - quad[0])) / sw_)
        fs = self._mask_cache[fk]
        if fs < 0.98:
            small = cv2.resize(rec, (int(round(sw_ * fs)), int(round(sh_ * fs))), interpolation=cv2.INTER_AREA)
            ssh, ssw = small.shape[:2]
            Hs = cv2.getPerspectiveTransform(np.float32([[0, 0], [ssw, 0], [ssw, ssh], [0, ssh]]), quad)
            warped = cv2.warpPerspective(small, Hs, (W, H), flags=cv2.INTER_LINEAR).astype(np.float32)
        else:
            warped = cv2.warpPerspective(rec, Hm, (W, H), flags=cv2.INTER_LINEAR).astype(np.float32)
        sd = lay.get("screen_dim", 0.0)
        if sd:
            warped *= (1 - sd)
        out = plate.astype(np.float32) * (1 - m) + warped * m
        s_ = self._src_scale(seg, img)
        x0, y0 = quad.min(0)
        x1, y1 = quad.max(0)
        self._xf[seg["label"]] = (s_, 0.0, s_, 0.0, (x0, y0, x1, y1))
        self._H[seg["label"]] = Hm.astype(np.float64)
        return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert("RGBA")

    def l_motion(self, seg, img, k):
        t = (seg["start"] + k) / self.F
        fr = self.background(seg["background"], img, t) if seg.get("motion_transparent", True) else Image.new("RGBA", (self.W, self.H), (0, 0, 0, 255))
        self._xf[seg["label"]] = (self.pscale, 0.0, self.pscale, 0.0, (0, 0, self.W, self.H))   # source px = full-size frame px
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
        if s and s.get("behind") is True and s["text"] and s["start"] <= g < s["end"]:
            self.draw_section_text(fr, s, g)
        return fr

    def behind_subject(self, fr, g):
        """Text / overlays marked `behind: subject|person` go between the scene and its subject: Vision cuts the
        subject out of the composed frame, the layer is drawn, then the subject is laid back on top."""
        items = [("s", s) for s in self.plan["sections"]
                 if s.get("behind") in ("subject", "person") and s["text"] and s["start"] <= g < s["end"]]
        items += [("o", ov) for ov in self.plan["overlays"] if ov.get("behind") and ov["start"] <= g < ov["end"]]
        if not items:
            return fr
        if self._masker is None:
            from .subject import Masker
            self._masker = Masker()
        base = fr.copy()
        masks = {}
        for kind, it in items:
            mode = it["behind"]
            if mode not in masks:
                masks[mode] = self._masker.mask(base, mode, key=id(self))
            if kind == "s":
                self.draw_section_text(fr, it, g)
            else:
                self.draw_overlay(fr, it, g)
        m = np.maximum.reduce(list(masks.values()))[..., None]
        a = np.asarray(fr, np.float32)
        b = np.asarray(base.convert(fr.mode), np.float32)
        return Image.fromarray((a * (1 - m) + b * m).astype(np.uint8), fr.mode)

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
        if seg.get("kind") == "image":
            return self.pscale                 # image clips are loaded at pscale (preview/proxy)
        if seg.get("kind") in ("color", "motion") or not seg.get("src"):
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
        over = max(win_w / sw, win_h / max(sh - cut, 1))
        if over > 1:  # window larger than the source (wide image in a taller card): crop to cover
            win_w /= over
            win_h /= over
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
        key = (seg["src"] or seg.get("image"), self.pscale, json.dumps(seg["layout"], sort_keys=True))
        if key not in self._dev_cache:
            lay = seg["layout"]
            k = self._src_scale(seg, img)      # source px stay original px in preview too (taps, marks, focus)
            info = self.spec["sources"][seg["src"]]["info"] if seg.get("src") else {"width": round(img.size[0] / k), "height": round(img.size[1] / k)}
            bbox = hole = None
            android = lay.get("device") == "android"
            island = "off" if android else lay.get("island", "auto")
            camera = lay.get("camera", "auto") if android else "off"
            if (island == "auto" or camera == "auto") and seg.get("src"):
                first = still(self.spec["sources"][seg["src"]]["path"], 0.0, 1.0)
                if island == "auto":
                    bbox = detect_recorded_island(first)
                else:
                    hole = detect_recorded_hole(first)
            style = lay.get("style", "rise")
            self._dev_cache[key] = IPhone(info["width"], info["height"], finish=lay.get("finish", "black"),
                                          bezel=lay.get("bezel", style != "screen"), buttons=lay.get("buttons", True),
                                          island=island, island_bbox=bbox, shadow=lay.get("shadow", 0.5),
                                          device="android" if android else "iphone", camera=camera, hole_bbox=hole)
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
        if t in ("shrink", "grow"):
            return self._shrink_grow(f0, f1, a, tr)
        if t == "flood":
            return self._flood(f0, f1, a, tr)
        if t in ("wipe", "circle"):
            m = self._trans_mask(t, e, tr)
            return Image.composite(f1, f0, m)
        if t == "glitch":
            return self._glitch(f0, f1, a, g)
        return Image.blend(f0, f1, a)

    def _shrink_grow(self, f0, f1, a, tr):
        """shrink: the outgoing picture collapses into a point (pos) with zoom-blur streaks, the next one settles in
        behind it. grow: the incoming picture grows out of a point over the outgoing one."""
        W, H = self.W, self.H
        cx, cy = self.pos(tr.get("pos", ["50%", "50%"]))
        n = max(1, tr.get("n", 10))

        def sc(x):     # picture scale at progress x
            x = anim.clamp01(x)
            return max(0.002, 1 - anim.out_expo(x / 0.7) * 0.985) if tr["type"] == "shrink" else max(0.002, anim.out_expo(x))
        if tr["type"] == "shrink":
            base, top, alpha = self._zoomed(f1, 1.06 - 0.06 * anim.out_cubic(a)), f0, 1 - anim.clamp01((a - 0.5) / 0.3)
        else:
            base, top, alpha = self._zoomed(f0, 1 + 0.05 * anim.in_cubic(a)), f1, anim.clamp01(a * 5)
        out = base.copy()
        s_now, s_prev = sc(a), sc(a - 1.0 / n)
        if alpha <= 0.002:
            return out
        k = max(0.02, s_now)
        w, h = max(1, int(round(W * k))), max(1, int(round(H * k)))
        img = top.resize((w, h), Image.BILINEAR)
        if abs(s_prev / s_now - 1) > 0.012:
            img = anim.zoom_blur(img, s_prev / s_now)
        if alpha < 0.999:
            img = with_alpha(img, alpha)
        composite_at(out, img, cx - img.width / 2 + (W / 2 - cx) * k, cy - img.height / 2 + (H / 2 - cy) * k)
        return out

    def _flood_geom(self, spec, default_pos):
        """A flood end-point -> (cx, cy, half_w, half_h, radius) in output px. spec: [x, y, w, h] design px (a button,
        a card), [x, y] (a point) or None (default_pos)."""
        U = self.U
        if spec is not None and len(spec) == 4:
            x, y = self.pos(spec[:2])
            w, h = float(spec[2]) * U, float(spec[3]) * U
            return x + w / 2, y + h / 2, w / 2, h / 2, None
        x, y = self.pos(spec if spec is not None else default_pos)
        return x, y, 0.0, 0.0, None

    def _flood(self, f0, f1, a, tr):
        """flood: a shape grows out of `from` (a rect or point) past every corner, holds the solid colour for a beat,
        then contracts into `to` over the next picture (where it shrinks to a point, or lands as that rect and melts
        away: put it on a dark element of the next shot and the joint disappears)."""
        W, H, U = self.W, self.H, self.U
        pos = tr.get("pos", ["50%", "50%"])
        g0 = self._flood_geom(tr.get("from"), pos)
        g1 = self._flood_geom(tr.get("to"), pos) if tr.get("to") is not None else g0
        hold = anim.clamp01(tr.get("_hold", 0.18))
        grow_end, shrink_start = (1 - hold) / 2, (1 + hold) / 2
        col = color(tr.get("color", "#0B0B0F"), self.pal)
        shape = tr.get("shape", "circle")

        def full(g):          # half size that covers the frame from this centre, past the corners
            cx, cy = g[0], g[1]
            return math.hypot(max(cx, W - cx), max(cy, H - cy)) * 1.08

        def rr(g):            # the end shape's corner radius
            if shape == "rect":
                return float(tr.get("radius", 0)) * U
            if shape == "squircle":
                return min(g[2], g[3], float(tr.get("radius", 48)) * U)
            return min(g[2], g[3])
        if a <= grow_end:
            e = anim.in_out_cubic(a / max(grow_end, 1e-6))
            g, base = g0, f0
        elif a >= shrink_start:
            e = 1 - anim.in_out_cubic((a - shrink_start) / max(1 - shrink_start, 1e-6))
            g, base = g1, f1
        else:
            return Image.new("RGBA", (W, H), col)
        R = full(g)
        hw, hh = g[2] + (R - g[2]) * e, g[3] + (R - g[3]) * e
        r = min(hw, hh, rr(g) + (R - rr(g)) * e)
        alpha = 1.0
        if a >= shrink_start and (g1[2] > 0 or g1[3] > 0):
            alpha = anim.clamp01(e / 0.14)    # landed on its rect: melt into the picture underneath
        if hw < 0.5 and hh < 0.5:
            return base
        s = 0.5
        w, h = int(W * s), int(H * s)
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        qx = np.abs(xx / s - g[0]) - (hw - r)
        qy = np.abs(yy / s - g[1]) - (hh - r)
        d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
        m = np.clip(0.5 - d * s / 1.2, 0, 1) * alpha
        mask = Image.fromarray((m * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
        return Image.composite(Image.new("RGBA", (W, H), col), base, mask)

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

    def draw_liquid(self, frame, rect, box, alpha=1.0):
        """Liquid glass (iOS 26): the picture behind stays sharp and bends at the rim like a lens (a displacement field
        from the rounded rect's distance, R/G/B at slightly different strengths for chromatic edges), a faint tint and
        a rim light brightest where it faces the light (top-left)."""
        import cv2
        U = self.U
        X0, Y0, X1, Y1 = [int(round(v)) for v in rect]
        w, h = X1 - X0, Y1 - Y0
        if w < 8 or h < 8 or alpha <= 0.01:
            return
        r = min(box.get("radius", 999) * U, w / 2, h / 2)
        bez = max(4.0, min(w, h) * float(box.get("bezel", 0.32)))         # width of the bending rim
        mag = float(box.get("refract", 1.0)) * bez * 0.9                     # how far the rim pulls the picture in
        m = int(mag * 1.3) + 4
        fw, fh = frame.size
        cx0, cy0, cx1, cy1 = max(0, X0 - m), max(0, Y0 - m), min(fw, X1 + m), min(fh, Y1 + m)
        if cx1 - cx0 < 4 or cy1 - cy0 < 4:
            return
        src = np.asarray(frame.crop((cx0, cy0, cx1, cy1)).convert("RGB")).astype(np.float32)
        bl = float(box.get("blur", 2.5)) * U
        if bl > 0.3:
            src = cv2.GaussianBlur(src, (0, 0), bl)
        key = ("liquid", w, h, int(r), int(bez))
        if key not in self._mask_cache:
            yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
            qx = np.abs(xx + 0.5 - w / 2) - (w / 2 - r)
            qy = np.abs(yy + 0.5 - h / 2) - (h / 2 - r)
            d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r   # <0 inside
            gy, gx = np.gradient(cv2.GaussianBlur(d, (0, 0), 1.5))
            n = np.hypot(gx, gy) + 1e-6
            nx, ny = gx / n, gy / n                                          # outward normal
            t = np.clip(1 + d / bez, 0, 1) ** 2.2                            # 0 in the flat middle, 1 at the rim
            inside = np.clip(0.5 - d, 0, 1)
            light = np.clip(-(nx * -0.62 + ny * -0.78), -1, 1)               # facing the light at the top-left
            rim = np.exp(-((d + 1.6 * U) / (1.4 * U)) ** 2)
            self._mask_cache[key] = (xx, yy, nx, ny, t, inside, light, rim)
        xx, yy, nx, ny, t, inside, light, rim = self._mask_cache[key]
        ox, oy = X0 - cx0, Y0 - cy0
        out = np.empty((h, w, 3), np.float32)
        for ch, k in enumerate((1.08, 1.0, 0.9)):
            mx = (xx + ox - nx * t * mag * k).astype(np.float32)
            my = (yy + oy - ny * t * mag * k).astype(np.float32)
            out[..., ch] = cv2.remap(src[..., ch], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        tint = np.array(color(box.get("color", "#FFFFFF"), self.pal)[:3], np.float32)
        op = float(box.get("opacity", 0.08))
        out = out * (1 - op) + tint * op
        out = out + (255 - out) * (0.10 * t)[..., None]                       # the rim catches light
        spec = rim * (0.55 + 0.45 * light) + 0.25 * np.exp(-((yy - h * 0.06) / (h * 0.12)) ** 2) * inside * (1 - t)
        out = out + (255 - out) * np.clip(spec * float(box.get("shine", 0.9)), 0, 1)[..., None]
        a = (inside * alpha * 255).astype(np.uint8)
        layer = Image.fromarray(np.dstack([np.clip(out, 0, 255).astype(np.uint8), a]), "RGBA")
        sh = Image.new("RGBA", (w + int(80 * U), h + int(80 * U)), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((int(40 * U), int(50 * U), int(40 * U) + w, int(50 * U) + h), int(r),
                                             fill=(0, 0, 0, int(60 * alpha * float(box.get("shadow", 1.0)))))
        composite_at(frame, sh.filter(ImageFilter.GaussianBlur(22 * U)), X0 - 40 * U, Y0 - 40 * U)
        composite_at(frame, layer, X0, Y0)

    def _glass_for(self, frame, layer_box, ox, oy, alpha):
        L = layer_box[2] if len(layer_box) > 2 else None
        if L is None or not L.box or L.box.get("mode") not in ("glass", "liquid"):
            return
        x0, y0, x1, y1 = layer_box[1]
        r = (ox + x0 - L.bpx, oy + y0 - L.bpy, ox + x1 + L.bpx, oy + y1 + L.bpy)
        if L.box.get("mode") == "liquid":
            self.draw_liquid(frame, r, L.box, alpha)
        else:
            self.draw_glass(frame, r, L.box, alpha)

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
        """Combined entrance / exit / idle transform for an animated element (+ motion blur with motion_blur:)."""
        tf = self._anim_tf0(an, dt, remaining, default_in)
        mb = an.get("motion_blur")
        if mb:
            sh = 1.0 / self.F
            tf = anim.with_motion(tf, self._anim_tf0(an, dt - sh, remaining + sh, default_in), float(mb))
        return tf

    def _anim_tf0(self, an, dt, remaining, default_in="fade"):
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
        dt = (g - s["start"]) / F - (a.get("delay") or 0)
        if dt < 0:
            return None
        remaining = (s["end"] - g) / F
        by = a.get("by", "block")
        effect = a.get("effect")
        if by in ("word", "letter", "line"):
            if a.get("sync"):
                a = dict(a, _t0=s["start"] / F + (a.get("delay") or 0))
            return self.draw_parts(frame, s["text"], s["style"], s["pos"], "center", a, dt, remaining)
        e = ease_out(dt / a["in"]) if a.get("in") else 1.0
        alpha = e
        if a.get("out"):
            alpha *= min(1.0, remaining / a["out"])
        lay = self.text_layer(s["text"], s["style"])
        self.draw_accent_marks(frame, lay, s["style"], s["pos"], "center", dt, phase="under")
        if effect:
            tf = self._anim_tf({"in": effect, "dur": a.get("in") or 0.35, "ease": a.get("ease"), "dist": a.get("rise") or 40,
                                "out": a.get("out_effect"), "out_dur": a.get("out") or 0.3, "idle": a.get("idle"),
                                "motion_blur": a.get("motion_blur")}, dt, remaining)
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
        mb = a.get("motion_blur") if effect != "mask" else None

        def part_tf(part, delay, dt, remaining):
            dist = part["img"].height if effect == "mask" else (a.get("rise") or a.get("dist", 40))
            tf = anim.transform(effect, (dt - delay) / d_in if d_in else 1.0, dist if effect != "mask" else dist / self.U, a.get("ease"))
            if a.get("out_effect") and a.get("out") and remaining < a["out"]:
                tf = anim.combine(tf, anim.exit_transform(a["out_effect"], 1 - remaining / a["out"], a.get("dist", 40)))
            if a.get("idle"):
                tf = anim.combine(tf, anim.idle(a["idle"], dt, a.get("idle_amp", 1.0)))
            return tf

        sync = self._sync_times(L, a) if a.get("sync") else None
        synced = self._sync_layout(P, L, a, dt, remaining, ox, oy, sync) if sync is not None else None
        for part, delay in zip(P["parts"], delays):
            if synced is not None:
                tf, sdx = synced[part["index"]]
                tf["alpha"] *= out_a
                img, (dx, dy) = anim.apply(part["img"], tf, self.U)
                if img is not None:
                    composite_at(frame, img, ox + part["x"] + dx + sdx, oy + part["y"] + dy)
                last_vis = part
                continue
            p = (dt - delay) / d_in if d_in else 1.0
            if p <= 0:
                continue
            tf = part_tf(part, delay, dt, remaining)
            if mb:
                tf = anim.with_motion(tf, part_tf(part, delay, dt - 1.0 / self.F, remaining + 1.0 / self.F), float(mb))
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

    def _sync_layout(self, P, L, a, dt, remaining, ox, oy, sync):
        """Voice-synced words (anim.sync): every word is on screen; the word being spoken zooms (bump: in and out over
        the word; pop: spring = past the zoom, held while it is said, settled after). Its neighbours on the line slide
        apart so nothing overlaps, and a line never grows past the frame. With `upcoming`, words not said yet sit at
        that opacity from `upcoming_at` (s after the element starts; default: its first spoken word): frame 0 stays lit.
        -> {part index: (transform, extra x shift)}"""
        t_abs = a.get("_t0", 0.0) + dt
        zoom = float(a.get("zoom", 0.15))
        up = a.get("upcoming")
        dim_from = (a.get("_t0", 0.0) + float(a["upcoming_at"])) if a.get("upcoming_at") is not None else \
            min((v[0] for v in sync.values()), default=None)
        out = {}
        for part in P["parts"]:
            tf = anim._t()
            span = sync.get(part["word"])
            if span and a.get("pop") == "spring":
                att, rel = 0.13, 0.22
                if span[0] <= t_abs < span[1] + rel:
                    if t_abs < span[0] + att:
                        e = anim.ease("back", (t_abs - span[0]) / att)
                    elif t_abs < span[1]:
                        e = 1.0
                    else:
                        e = 1 - anim.in_out_cubic((t_abs - span[1]) / rel)
                    tf["scale"] = 1 + zoom * e
            elif span and span[0] <= t_abs < span[1]:
                k = anim.clamp01((t_abs - span[0]) / (span[1] - span[0]))
                tf["scale"] = 1 + zoom * math.sin(math.pi * k)
            if up is not None and span and dim_from is not None and dim_from <= t_abs < span[0]:
                tf["alpha"] *= 1 - (1 - float(up)) * anim.clamp01((t_abs - dim_from) / 0.25)
            if a.get("out_effect") and a.get("out") and remaining < a["out"]:
                tf = anim.combine(tf, anim.exit_transform(a["out_effect"], 1 - remaining / a["out"], a.get("dist", 40)))
            out[part["index"]] = [tf, 0.0]
        m = 12 * self.U
        lines = {}
        for part in P["parts"]:
            lines.setdefault(part["line"], []).append(part)
        for parts in lines.values():
            parts.sort(key=lambda q: q["x"])
            grow = [q["img"].width * (out[q["index"]][0]["scale"] - 1) for q in parts]
            total = sum(grow)
            if total <= 0:
                continue
            x0 = ox + parts[0]["x"]
            x1 = ox + parts[-1]["x"] + parts[-1]["img"].width
            room = max(0.0, min(2 * (x0 - m), 2 * (self.W - m - x1), self.W - 2 * m - (x1 - x0)))
            f = min(1.0, room / total)
            for i, q in enumerate(parts):          # shrink the zoom to fit, then push the neighbours apart
                tf = out[q["index"]][0]
                tf["scale"] = 1 + (tf["scale"] - 1) * f
                out[q["index"]][1] = (sum(grow[:i]) - sum(grow[i + 1:])) * f / 2
            for q in parts:                        # vertical room too (big single words)
                tf = out[q["index"]][0]
                h = q["img"].height
                cy = oy + q["y"] + h / 2
                tf["scale"] = max(1.0, min(tf["scale"], 2 * (cy - m) / h, 2 * (self.H - m - cy) / h))
        return {k: (v[0], v[1]) for k, v in out.items()}

    def _sync_times(self, L, a):
        """anim.sync: voice -> {layout word index: (start, end)} at output time. The text's words are found in the
        voice-over transcript (the first run of them at or after the element's start), so each zooms while it is said."""
        key = ("sync", id(L), round(a.get("_t0", 0.0), 3))
        if key in self._parts_cache:
            return self._parts_cache[key]

        def norm(w):
            return re.sub(r"[^a-z0-9]+", "", str(w).lower().replace("\u2019", "'").replace("'", ""))
        words = [norm(wd["s"]) for wd in L.words]
        vo = [w for w in self.vo_words if w["end"] >= a.get("_t0", 0.0) - 0.3]
        vn = [norm(w["w"]) for w in vo]
        out = {}
        if words and vn:
            import difflib
            sm = difflib.SequenceMatcher(None, words, vn[:len(words) + 40], autojunk=False)
            for i, j, n in sm.get_matching_blocks():
                for k in range(n):
                    w = vo[j + k]
                    out[i + k] = (w["start"], max(w["end"], w["start"] + 0.24))
        self._parts_cache[key] = out
        return out

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
                     "caret": an.get("caret"), "rise": an.get("dist"), "strike_at": an.get("strike_at"),
                     "sync": an.get("sync"), "zoom": an.get("zoom"), "pop": an.get("pop"), "upcoming": an.get("upcoming"),
                     "upcoming_at": an.get("upcoming_at"), "_t0": ov["start"] / F}
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
        if c.get("values"):                     # several numbers in one line: text "{} to {}", values [[29, 25], [49, 44]]
            nums = [self._counter_num(c, a + (b - a) * p) for a, b in c["values"]]
            return c.get("text", " ".join("{}" for _ in nums)).format(*nums)
        v = c["from"] + (c["to"] - c["from"]) * p
        return f"{c.get('prefix', '')}{self._counter_num(c, v)}{c.get('suffix', '')}"

    def _counter_num(self, c, v):
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
        return s

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
        if typ in ("iphone", "android"):
            dev = self.device_for({"src": ov["src"], "layout": {"type": "iphone", "style": "screen" if lay.get("bezel") is False else "full",
                                                                  **({"device": "android"} if typ == "android" else {}),
                                                                  **{k: v for k, v in lay.items() if k in ("finish", "island", "shadow", "camera")}}}, img)
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
            sh_k = lay.get("shadow", 1.0)            # false / 0 = no drop shadow (a flat panel that blends into the stage)
            sh_k = 0.0 if sh_k is False else float(sh_k)
            if sh_k > 0:
                shadow = Image.new("L", (W, H), 0)
                ImageDraw.Draw(shadow).rounded_rectangle((X, Y + 18 * self.U, X + w, Y + h + 18 * self.U), r,
                                                         fill=int(min(255, 140 * sh_k)))
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

    def draw_texts(self, frame, g, only=None, skip=()):
        """Section texts, overlays and captions at frame g. only: draw just these sections' texts + overlays (a
        transition with carry: moves them with their picture); skip: leave these sections out (already carried)."""
        F = self.F
        boxes = []
        for si, s in enumerate(self.plan["sections"]):
            if (only is not None and si not in only) or si in skip:
                continue
            if s["text"] and s["start"] <= g < s["end"] and not s.get("behind"):
                b = self.draw_section_text(frame, s, g)
                if b:
                    boxes.append(("section text '" + s["text"].replace(chr(10), " ")[:28] + "'", b))
        for ov in self.plan["overlays"]:
            sec = ov.get("sec")
            if (only is not None and sec not in only) or (sec is not None and sec in skip):
                continue
            if ov["start"] <= g < ov["end"] and ov.get("behind"):
                continue                                  # drawn behind the subject (behind_subject)
            if ov["start"] <= g < ov["end"]:
                b = self.draw_overlay(frame, ov, g)
                if b and ov["kind"] in ("text", "counter"):
                    boxes.append(("overlay '" + (ov.get("text") or "counter").replace(chr(10), " ")[:28] + "'", b))
            elif g >= ov["end"] and ("motion", id(ov)) in self._ov_gens:
                self._ov_gens.pop(("motion", id(ov))).close()
            elif g >= ov["end"] and ("video", id(ov)) in self._ov_gens:
                self._ov_gens.pop(("video", id(ov))).close()
        if self.chunks and only is None:
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
                        tf["scale"] = 1 + self.cap_style.get("zoom", 0.16) * math.sin(math.pi * k) * (1 - k * 0.3)
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

    CURSOR = [(0, 0), (0, 24.5), (6.0, 18.8), (9.9, 27.6), (13.6, 26.0), (9.8, 17.3), (17.6, 17.3)]   # macOS arrow, tip at 0,0

    def _pointer_state(self, seg, g, pt):
        """Where the pointer is at frame g (output px), how pressed (0-1), how visible (0-1) and the long-press ring
        progress (or None), from the clip's taps: it glides from tap to tap, dips on each press, follows a drag."""
        F, W, H, U = self.F, self.W, self.H, self.U
        taps = sorted([t for t in self.plan.get("taps", []) if t["seg"] == seg["label"]], key=lambda t: t["g"])
        if not taps:
            return None
        ev = []
        for t in taps:
            down = float(t.get("drag_dur") or 0.55) if t.get("drag") else float(t.get("hold") or 0.1)
            ev.append({"g": t["g"], "rel": t["g"] + down * F, "a": self.map_pt(seg["label"], *t["pos"]),
                       "b": self.map_pt(seg["label"], *(t.get("drag") or t["pos"])), "hold": t.get("hold"), "drag": bool(t.get("drag"))})
        enter, travel = float(pt.get("enter", 0.55)) * F, float(pt.get("travel", 0.5)) * F
        exit_ = pt.get("exit", 0.7)
        cursor = pt.get("style") == "cursor"
        far = (W * 1.12, H * 0.92) if cursor else None
        e0 = ev[0]
        if g < e0["g"]:
            p = anim.clamp01(1 - (e0["g"] - g) / max(1.0, min(enter, e0["g"] - seg["start"] + enter * 0.4)))
            if p <= 0:
                return None
            q = anim.out_cubic(p)
            start = far or (e0["a"][0] + 90 * U, e0["a"][1] + 150 * U)
            pos = (start[0] + (e0["a"][0] - start[0]) * q, start[1] + (e0["a"][1] - start[1]) * q)
            return pos, anim.clamp01(1 - (e0["g"] - g) / (0.06 * F)), (1.0 if cursor else anim.clamp01(p * 2.2)), None
        for i, e in enumerate(ev):
            nxt = ev[i + 1] if i + 1 < len(ev) else None
            if g <= e["rel"]:              # pressed: hold still, or follow the drag
                u = anim.clamp01((g - e["g"]) / max(1.0, e["rel"] - e["g"]))
                q = anim.in_out_cubic(u) if e["drag"] else 0.0
                pos = (e["a"][0] + (e["b"][0] - e["a"][0]) * q, e["a"][1] + (e["b"][1] - e["a"][1]) * q)
                return pos, 1.0, 1.0, (u if e["hold"] and pt.get("ring", True) else None)
            if nxt is None or g < nxt["g"]:
                lift = anim.clamp01(1 - (g - e["rel"]) / (0.08 * F))
                if nxt is not None:        # glide to the next tap, arriving as it presses
                    T = min(travel, (nxt["g"] - e["rel"]) * 0.9)
                    u = anim.clamp01(1 - (nxt["g"] - g) / max(1.0, T))
                    q = anim.in_out_cubic(u)
                    pos = (e["b"][0] + (nxt["a"][0] - e["b"][0]) * q, e["b"][1] + (nxt["a"][1] - e["b"][1]) * q)
                    return pos, max(lift, anim.clamp01(1 - (nxt["g"] - g) / (0.06 * F))), 1.0, None
                if exit_ is False:
                    return e["b"], lift, 1.0, None
                u = anim.clamp01((g - e["rel"] - float(exit_) * F) / (0.45 * F))
                q = anim.in_cubic(u)
                end = far or (e["b"][0] + 90 * U, e["b"][1] + 150 * U)
                pos = (e["b"][0] + (end[0] - e["b"][0]) * q, e["b"][1] + (end[1] - e["b"][1]) * q)
                return pos, lift, (1.0 if cursor else 1 - u), None
        return None

    def _pointer_sprite(self, style, size, press, col):
        key = ("ptr", style, int(size * 100), int(press * 8), col)
        if key in self._mask_cache:
            return self._mask_cache[key]
        U, ss = self.U, 3
        if style == "cursor":
            k = 2.1 * U * size * (1 - 0.14 * press) * ss
            pts = [(x * k, y * k) for x, y in self.CURSOR]
            S = int(32 * k)
            lay = Image.new("RGBA", (2 * S, 2 * S), (0, 0, 0, 0))
            poly = [(S + x, S + y) for x, y in pts]
            sh = Image.new("RGBA", lay.size, (0, 0, 0, 0))
            ImageDraw.Draw(sh).polygon([(x + 2.5 * k, y + 4 * k) for x, y in poly], fill=(0, 0, 0, int(90 - 30 * press)))
            lay.alpha_composite(sh.filter(ImageFilter.GaussianBlur(3.2 * k)))
            d = ImageDraw.Draw(lay)
            d.line(poly + poly[:1], fill=(255, 255, 255, 255), width=max(2, int(3.4 * k)), joint="curve")   # white rim
            d.polygon(poly, fill=color(col or "#000000", self.pal))
            spr = (lay.resize((2 * S // ss, 2 * S // ss), Image.LANCZOS), S // ss)    # (image, tip offset)
        else:
            r = 34 * U * size * (1 - 0.16 * press)
            R = int(r + 22 * U) + 2
            lay = Image.new("RGBA", (2 * R * ss, 2 * R * ss), (0, 0, 0, 0))
            c = R * ss
            sh = Image.new("RGBA", lay.size, (0, 0, 0, 0))
            ImageDraw.Draw(sh).ellipse((c - r * ss, c - r * ss + 6 * U * ss, c + r * ss, c + r * ss + 6 * U * ss), fill=(0, 0, 0, int(70 - 30 * press)))
            lay.alpha_composite(sh.filter(ImageFilter.GaussianBlur(9 * U * ss)))
            fill = color(col or "#FFFFFF", self.pal)
            ImageDraw.Draw(lay).ellipse((c - r * ss, c - r * ss, c + r * ss, c + r * ss), fill=fill[:3] + (int(150 + 70 * press),),
                                        outline=(30, 24, 40, 70), width=max(1, int(2 * U * ss)))
            spr = (lay.resize((2 * R, 2 * R), Image.LANCZOS), R)
        self._mask_cache[key] = spr
        return spr

    def draw_pointer(self, frame, g, seg):
        """A finger (touch dot) or a cursor that drives the recording: glides between the clip's taps, dips on each press,
        follows drags, shows a ring on long-presses (taps' hold / drag)."""
        pt = seg["pointer"]
        st = self._pointer_state(seg, g, pt)
        if st is None:
            return
        (x, y), press, vis, ring = st
        if vis <= 0.01:
            return
        style, size = pt.get("style", "touch"), float(pt.get("size", 1.0))
        if style == "touch":     # follow the phone's on-screen scale, like tap ripples
            size *= max(0.6, min(1.6, self._xf[seg["label"]][0] / 0.687))
        img, off = self._pointer_sprite(style, size, round(press * 8) / 8, pt.get("color"))
        if style == "cursor":    # lean into the move
            prev = self._pointer_state(seg, g - 1, pt)
            vx = (x - prev[0][0]) / self.U if prev else 0.0
            ang = max(-16.0, min(16.0, -vx * 0.55))
            if abs(ang) > 0.3:
                img = img.rotate(ang, resample=Image.BICUBIC, center=(off, off))
        if vis < 0.999:
            img = with_alpha(img, vis)
        if ring is not None:
            R = 58 * self.U * size
            lay = Image.new("RGBA", (int(4 * R), int(4 * R)), (0, 0, 0, 0))
            c = 2 * R
            ImageDraw.Draw(lay).arc((c - R, c - R, c + R, c + R), -90, -90 + 360 * anim.out_cubic(ring),
                                    fill=color("accent", self.pal), width=max(3, int(7 * self.U)))
            composite_at(frame, lay, x - c, y - c)
        composite_at(frame, img, x - off, y - off)

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
            # marks that live on the page (marker, underline, strike) stay inside the clip's window (a zoomed card
            # or screen); circles / arrows may reach outside it. clip: true|false overrides.
            win = self._xf[seg["label"]][4] if len(self._xf[seg["label"]]) > 4 else None
            clip = m.get("clip", kind in ("highlight", "underline", "strike")) and win is not None
            target = Image.new("RGBA", frame.size, (0, 0, 0, 0)) if clip else frame
            shapes.draw(target, kind, rect, p, col, m.get("width", self.marks.get("width", 9)), self.U, hand=m.get("hand", True),
                        pad=m.get("pad"), radius=m.get("radius"), glow=m.get("glow", self.marks.get("glow", 0)), alpha=fade,
                        seed=i, start=start, end=end, strength=m.get("strength", 0.6))
            if clip:
                bx = tuple(int(round(v)) for v in (max(0, win[0]), max(0, win[1]), min(frame.width, win[2]), min(frame.height, win[3])))
                if bx[2] > bx[0] and bx[3] > bx[1]:
                    frame.alpha_composite(target.crop(bx), (bx[0], bx[1]))
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

    def redact(self, seg, img, k):
        """Privacy: blur / pixelate / fill rectangles of the source (source px) before layout, so they follow any
        layout, camera, tilt or plate warp. Each item is active from its start (src/at, default 0) for `dur` (default: on)."""
        t = k / self.F
        act = [r for r in seg.get("redact") or [] if r.get("t0", 0.0) <= t + 1e-6 and
               (r.get("dur") is None or t < r.get("t0", 0.0) + float(r["dur"]))]
        if not act or seg["kind"] in ("color", "motion"):
            return img
        s = self._src_scale(seg, img)
        out = img.copy()
        for r in act:
            x, y, w, h = (float(v) * s for v in r["rect"])
            box = (max(0, int(x)), max(0, int(y)), min(out.width, int(round(x + w))), min(out.height, int(round(y + h))))
            if box[2] <= box[0] or box[3] <= box[1]:
                continue
            reg = out.crop(box)
            style = r.get("style", "blur")
            if style == "pixelate":
                n = max(2, int(float(r.get("strength", 18)) * s))
                reg = reg.resize((max(1, reg.width // n), max(1, reg.height // n)), Image.BILINEAR).resize(reg.size, Image.NEAREST)
            elif style == "fill":
                reg = Image.new(reg.mode, reg.size, color(r.get("color", "#000000"), self.pal)[:len(reg.mode)])
            else:
                rad = max(2.0, float(r.get("strength", 28)) * s)
                pad = int(rad * 2)              # blur a padded crop so the edges don't pick up a dark border
                pb = (max(0, box[0] - pad), max(0, box[1] - pad), min(out.width, box[2] + pad), min(out.height, box[3] + pad))
                big = out.crop(pb).filter(ImageFilter.GaussianBlur(rad)).filter(ImageFilter.GaussianBlur(rad))
                reg = big.crop((box[0] - pb[0], box[1] - pb[1], box[2] - pb[0], box[3] - pb[1]))
            rr = float(r.get("radius", 0)) * s
            if rr > 0:
                out.paste(reg, box, rounded_mask(reg.width, reg.height, int(rr)))
            else:
                out.paste(reg, box)
        return out

    def compose_full(self, seg, img, k, g):
        img = self.redact(seg, img, k)
        fr = self.compose(seg, img, k)
        if seg.get("taps"):
            self.draw_taps(fr, g, seg)
        if seg.get("marks"):
            self.draw_marks(fr, seg, k)
        if seg.get("lifts"):
            self.draw_lifts(fr, seg, img, k)
        if seg.get("pointer") and seg.get("taps") and seg["label"] in self._xf:
            self.draw_pointer(fr, g, seg)
        if seg.get("reveal"):
            fr = self.apply_reveal(fr, seg, k, img)
        return fr

    def apply_reveal(self, fr, seg, k, img=None):
        """Shape-mask reveal: the clip's composed picture shows through bursting shapes on a plain base."""
        from . import reveal as revealmod
        rv = seg["reveal"]
        key = id(seg)
        if key not in self._reveals:
            self._reveals[key] = revealmod.Reveal(rv, self.W, self.H, self.pos(rv["pos"]), self.F)
        R = self._reveals[key]
        t = k / self.F
        m = R.mask(t)
        if m is None:
            return fr
        z = R.zoom_at(t)
        pic = self._zoomed(fr, z) if abs(z - 1) > 1e-3 else fr
        if rv["base"] == "stage" and t >= rv["lead"]:
            base = self.background(seg["background"], img, (seg["start"] + k) / self.F).convert("RGBA")
        else:
            base = Image.new("RGBA", fr.size, color(rv["gap"] if rv["base"] == "stage" else rv["base"], self.pal))
        return Image.composite(pic, base, m)

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
            carried, boxes = (), []
            if len(layers) > 1:
                s1, img1, k1 = layers[-1]
                fr1 = self.compose_full(s1, img1, k1, g)
                a = (k1 + 1) / (s1["trans"]["n"] + 1)
                tr = s1["trans"]
                if tr.get("carry") and s0["section"] != s1["section"]:
                    # texts + overlays travel with their own picture through the transition
                    carried = (s0["section"], s1["section"])
                    boxes += self.draw_texts(fr, g, only={s0["section"]}) + self.draw_texts(fr1, g, only={s1["section"]})
                if tr["type"] == "zoom" and tr.get("pos", "auto") == "auto":
                    tr = dict(tr, _focus=self.last_tap(s0, g))
                elif tr["type"] == "zoom" and isinstance(tr.get("pos"), (list, tuple)):
                    tr = dict(tr, _focus=self.pos(tr["pos"]))
                fr = self.blend(fr, fr1, min(1.0, a), tr, g)
            fr = self.behind_subject(fr, g)
            boxes += self.draw_texts(fr, g, skip=carried)
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
