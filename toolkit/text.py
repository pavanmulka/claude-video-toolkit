"""Fonts (brand/fonts + system, static or variable) and rich text rendering with PIL."""
import functools
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .paths import BRAND, cache_dir

FONT_DIRS = [BRAND / "fonts", Path.home() / "Library/Fonts", Path("/Library/Fonts"), Path("/System/Library/Fonts")]
ALIASES = {"sfpro": "/System/Library/Fonts/SFNS.ttf", "system": "/System/Library/Fonts/SFNS.ttf",
           "sfprorounded": "/System/Library/Fonts/SFNSRounded.ttf"}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


# ------------------------------------------------------------------ font index
@functools.lru_cache(maxsize=1)
def font_index():
    """{family_norm: [entries]} for every font file in FONT_DIRS (cached on disk by mtimes)."""
    files = []
    for d in FONT_DIRS:
        if d.exists():
            files += [p for p in d.rglob("*") if p.suffix.lower() in (".ttf", ".otf", ".ttc")]
    stamp = {str(p): p.stat().st_mtime for p in files}
    cache = cache_dir("fonts") / "index.json"
    if cache.exists():
        try:
            c = json.loads(cache.read_text())
            if c.get("stamp") == stamp:
                return c["index"]
        except Exception:
            pass
    from fontTools.ttLib import TTCollection, TTFont
    index = {}
    for p in files:
        try:
            fonts = TTCollection(str(p), lazy=True).fonts if p.suffix.lower() == ".ttc" else [TTFont(str(p), lazy=True)]
        except Exception:
            continue
        for i, f in enumerate(fonts):
            try:
                name = f["name"]
                fam = name.getDebugName(16) or name.getDebugName(1)
                sub = name.getDebugName(17) or name.getDebugName(2) or "Regular"
                os2 = f["OS/2"] if "OS/2" in f else None
                wt = os2.usWeightClass if os2 else 400
                italic = bool(os2.fsSelection & 1) if os2 else ("italic" in sub.lower())
                axes = {a.axisTag: [a.minValue, a.defaultValue, a.maxValue] for a in f["fvar"].axes} if "fvar" in f else {}
            except Exception:
                continue
            if not fam:
                continue
            index.setdefault(norm(fam), []).append({"file": str(p), "index": i, "family": fam, "style": sub,
                                                   "weight": wt, "italic": italic, "axes": axes})
    cache.write_text(json.dumps({"stamp": stamp, "index": index}))
    return index


def families(brand_only=False):
    idx = font_index()
    out = {}
    for k, entries in idx.items():
        for e in entries:
            if brand_only and not e["file"].startswith(str(BRAND / "fonts")):
                continue
            out.setdefault(e["family"], []).append(e)
    return out


def _pick(family, weight=400, italic=False):
    fam = norm(family)
    if fam in ALIASES:
        return {"file": ALIASES[fam], "index": 0, "axes": {"wght": [1, 400, 1000], "opsz": [17, 28, 96]}, "weight": 400}
    p = Path(str(family)).expanduser()
    if p.suffix.lower() in (".ttf", ".otf", ".ttc"):
        cand = p if p.is_absolute() else BRAND / "fonts" / p
        if cand.exists():
            return {"file": str(cand), "index": 0, "axes": {}, "weight": weight}
    entries = font_index().get(fam)
    if not entries:
        raise KeyError(f"font family '{family}' not found (see ./vtk fonts)")
    brand_first = sorted(entries, key=lambda e: 0 if e["file"].startswith(str(BRAND / "fonts")) else 1)
    same_style = [e for e in brand_first if e["italic"] == italic] or brand_first
    var = [e for e in same_style if "wght" in e["axes"]]
    if var:
        return var[0]
    return min(same_style, key=lambda e: (abs(e["weight"] - weight), 0 if e["file"].startswith(str(BRAND)) else 1))


@functools.lru_cache(maxsize=256)
def get_font(family, size, weight=400, italic=False, width=None):
    """PIL font for family/weight at pixel `size`; variable axes (wght/opsz/wdth) set when present."""
    e = _pick(family, weight, italic)
    f = ImageFont.truetype(e["file"], max(1, int(round(size))), index=e.get("index", 0))
    if e.get("axes"):
        try:
            axes = f.get_variation_axes()
            vals = []
            for ax in axes:
                nm = ax["name"].decode() if isinstance(ax["name"], bytes) else str(ax["name"])
                nm = nm.lower()
                lo, hi = ax["minimum"], ax["maximum"]
                v = ax.get("default", lo)
                if "weight" in nm or nm == "wght":
                    v = weight
                elif "optical" in nm or nm == "opsz":
                    v = size * 0.75
                elif ("width" in nm or nm == "wdth") and width:
                    v = width
                vals.append(min(hi, max(lo, v)))
            f.set_variation_by_axes(vals)
        except Exception:
            pass
    return f


def label_font(size):
    for fam in ("Inter", "SF Pro"):
        try:
            return get_font(fam, size, 600)
        except Exception:
            continue
    return ImageFont.load_default()


# ------------------------------------------------------------------ colours
def color(c, palette=None, alpha=None):
    """'#RRGGBB', '#RRGGBBAA', palette name or (r,g,b[,a]) -> RGBA tuple."""
    if isinstance(c, (list, tuple)):
        t = tuple(int(x) for x in c)
        t = t + (255,) if len(t) == 3 else t
    else:
        s = str(c)
        if palette and s in palette:
            return color(palette[s], palette, alpha)
        s = s.lstrip("#")
        if len(s) not in (6, 8):
            raise ValueError(f"bad colour '{c}'")
        t = tuple(int(s[i:i + 2], 16) for i in range(0, len(s), 2))
        t = t + (255,) if len(t) == 3 else t
    if alpha is not None:
        t = t[:3] + (int(round(255 * alpha)),)
    return t




# ------------------------------------------------------------------ rich text
# Markup: **accent**  ~~strike~~  ==marker==  __underline__  [[img:path.png]]  and \n for a new line.
MARK_RE = re.compile(r"(\*\*|~~|==|__|\n|\[\[img:[^\]]+\]\])")
EMOJI_RE = re.compile("([\U0001F000-\U0001FAFF\U00002600-\U000027BF\U00002B00-\U00002BFF\U0001F1E6-\U0001F1FF"
                      "‍️⌀-⏿←-⇿〰〽㊗㊙©®‼⁉™ℹ]+)")
EMOJI_FONT = "/System/Library/Fonts/Apple Color Emoji.ttc"
FLAGS = {"**": "accent", "~~": "strike", "==": "marker", "__": "underline"}


def parse_markup(text):
    """'Start with **one.**\\nNext' -> tokens [{'t':'Start'},{'t':'with'},{'t':'one.','accent':1},{'nl':1},...]."""
    tokens, on = [], {v: False for v in FLAGS.values()}
    for part in MARK_RE.split(str(text)):
        if part in FLAGS:
            on[FLAGS[part]] = not on[FLAGS[part]]
        elif part == "\n":
            tokens.append({"nl": True})
        elif part.startswith("[[img:"):
            tokens.append({"t": "□", "img": part[6:-2].strip(), **{k: v for k, v in on.items() if v}})
        else:
            for w in part.split(" "):
                if w:
                    tokens.append({"t": w, **{k: v for k, v in on.items() if v}})
    return tokens


@functools.lru_cache(maxsize=512)
def _emoji_img(s, size):
    f = ImageFont.truetype(EMOJI_FONT, 160)
    w = int(f.getlength(s)) + 8
    im = Image.new("RGBA", (w, 200), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((4, 20), s, font=f, embedded_color=True)
    bb = im.getbbox() or (0, 0, 1, 1)
    im = im.crop((bb[0], 20, bb[2], 180))
    k = size / 160 * 1.02
    return im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)


@functools.lru_cache(maxsize=64)
def _inline_img(path, h):
    from .paths import BRANDS, INBOX
    p = Path(path).expanduser()
    for base in ([] if p.is_absolute() else [*BRANDS, INBOX]):
        if (base / p).exists():
            p = base / p
            break
    im = Image.open(p).convert("RGBA")
    return im.resize((max(1, int(im.width * h / im.height)), int(h)), Image.LANCZOS)


def _runs(s):
    """Split a word into (is_emoji, text) runs."""
    if not EMOJI_RE.search(s) or not Path(EMOJI_FONT).exists():
        return [(False, s)]
    return [(bool(EMOJI_RE.fullmatch(r)), r) for r in EMOJI_RE.split(s) if r]


class Layout:
    """Line breaking + word geometry for a text style (shared by static and animated rendering)."""

    def __init__(self, tokens, st, palette, scale):
        self.st, self.palette, self.scale = st, palette, scale
        self.size = size = st.get("size", 64) * scale
        self.font = get_font(st.get("family", "Inter"), size, st.get("weight", 700), st.get("italic", False), st.get("stretch"))
        af = st.get("accent_font")
        self.afont = get_font(af.get("family", st.get("family", "Inter")), size * af.get("size", 1.0), af.get("weight", st.get("weight", 700)),
                              af.get("italic", False), af.get("stretch")) if af else None
        case = st.get("case")
        self.tr = (lambda s: s.upper()) if case == "upper" else (lambda s: s.lower()) if case == "lower" else (lambda s: s)
        self.spacing = st.get("letter_spacing", 0.0) * size
        max_w = st.get("max_width", 10000) * scale
        self.line_px = st.get("line_height", 1.12) * size
        self.space = self.font.getlength(" ") + self.spacing
        lines, cur, cur_w = [], [], 0.0
        for tk in tokens:
            if tk.get("nl"):
                lines.append((cur, cur_w))
                cur, cur_w = [], 0.0
                continue
            s = self.tr(tk["t"])
            w = self.width(s, tk)
            add = w if not cur else self.space + w
            if cur and cur_w + add > max_w:
                lines.append((cur, cur_w))
                cur, cur_w = [], 0.0
                add = w
            cur.append((s, w, tk))
            cur_w += add
        lines.append((cur, cur_w))
        self.lines = [ln for ln in lines if ln[0]] or [([], 0.0)]
        box = st.get("box")
        self.box = box
        self.bpx, self.bpy = [v * scale for v in (box.get("pad", [28, 16]) if box else [0, 0])]
        sh, gl, stroke = st.get("shadow"), st.get("glow"), st.get("stroke")
        self.sw = int(round(stroke.get("width", 0) * scale)) if stroke else 0
        extra = 0
        if sh:
            extra = sh.get("blur", 0) * 2.5 * scale + abs(sh.get("dy", 0)) * scale
        if gl:
            extra = max(extra, gl.get("blur", 18) * 2.5 * scale)
        self.pad = int(max(self.bpx, self.bpy) + extra + self.sw + 8)
        self.content_w = max(w for _, w in self.lines)
        self.content_h = self.line_px * len(self.lines)
        self.W = int(self.content_w + 2 * self.pad + 2)
        self.H = int(self.content_h + 2 * self.pad + 2)
        self.asc, self.desc = self.font.getmetrics()
        self.x0c = self.y0c = self.pad
        align = st.get("align", "center")
        self.words = []  # [{s, tk, x, top, baseline, w, line, index}]
        for li, (words, lw) in enumerate(self.lines):
            x = self.x0c if align == "left" else self.x0c + self.content_w - lw if align == "right" else self.x0c + (self.content_w - lw) / 2
            top = self.y0c + li * self.line_px
            baseline = top + (self.line_px - (self.asc + self.desc)) / 2 + self.asc
            for wi, (s, w, tk) in enumerate(words):
                if wi:
                    x += self.space
                self.words.append({"s": s, "tk": tk, "x": x, "top": top, "baseline": baseline, "w": w, "line": li,
                                   "index": len(self.words), "first": wi == 0, "last": wi == len(words) - 1})
                x += w
        self.line_x = {}
        for wd in self.words:
            a = self.line_x.setdefault(wd["line"], [wd["x"], wd["x"] + wd["w"]])
            a[0], a[1] = min(a[0], wd["x"]), max(a[1], wd["x"] + wd["w"])

    def font_for(self, tk):
        return self.afont if (tk.get("accent") and self.afont) else self.font

    def width(self, s, tk=None):
        if tk and tk.get("img"):
            return self.size * 1.1
        f = self.font_for(tk or {})
        total = 0.0
        for emo, r in _runs(s):
            if emo:
                total += _emoji_img(r, int(round(self.size)) or 1).width
            elif not self.spacing:
                total += f.getlength(r)
            else:
                total += sum(f.getlength(ch) for ch in r) + self.spacing * (len(r) - 1)
        return total

    def word_box(self, wd):
        return (wd["x"], wd["top"] + (self.line_px - self.size) / 2, wd["x"] + wd["w"], wd["top"] + (self.line_px + self.size) / 2)


def _fill_for(L, tk, hl):
    st, pal = L.st, L.palette
    fill = color(st.get("color", "#FFFFFF"), pal)
    if tk.get("accent"):
        fill = color(st.get("accent", st.get("color", "#FFFFFF")), pal)
    if tk.get("highlight"):
        fill = color(hl.get("color", st.get("accent", "#FFD84D")), pal)
        if hl.get("box") and hl["box"].get("text_color"):
            fill = color(hl["box"]["text_color"], pal)
    return fill


def _draw_word(img, d, L, wd, chars=None):
    """Draw one word (optionally only its first `chars` characters) at its layout position."""
    st, pal, scale = L.st, L.palette, L.scale
    tk, s, x, baseline = wd["tk"], wd["s"], wd["x"], wd["baseline"]
    hl = st.get("highlight") or {}
    fill = _fill_for(L, tk, hl)
    font = L.font_for(tk)
    stroke = st.get("stroke")
    kw = {"stroke_width": L.sw, "stroke_fill": color(stroke.get("color", "#000000"), pal)} if L.sw else {}
    if st.get("fill") == "none":
        fill = (0, 0, 0, 0)
    if tk.get("highlight") and hl.get("box"):
        hb = hl["box"]
        hp = [v * scale for v in hb.get("pad", [12, 6])]
        top = wd["top"]
        d.rounded_rectangle((x - hp[0], top + (L.line_px - L.size) / 2 - hp[1], x + wd["w"] + hp[0], top + (L.line_px + L.size) / 2 + hp[1]),
                            hb.get("radius", 14) * scale, fill=color(hb.get("color", "#000000"), pal, hb.get("opacity", 1.0)))
    if tk.get("marker"):
        mk = st.get("marker") or {}
        y0 = wd["top"] + L.line_px * 0.18
        d.rectangle((x - 6 * scale, y0 + L.line_px * 0.22, x + wd["w"] + 6 * scale, y0 + L.line_px * 0.66),
                    fill=color(mk.get("color", "#FFE45C"), pal, mk.get("opacity", 0.85)))
    if tk.get("img"):
        h = L.size * 0.95
        im = _inline_img(tk["img"], int(round(h)))
        img.alpha_composite(im, (int(round(x + (wd["w"] - im.width) / 2)), int(round(baseline - L.asc * 0.86))))
        return
    text = s if chars is None else s[:chars]
    cx = x
    grad = st.get("gradient")
    for emo, r in _runs(text):
        if emo:
            im = _emoji_img(r, int(round(L.size)) or 1)
            img.alpha_composite(im, (int(round(cx)), int(round(baseline - L.asc * 0.92))))
            cx += im.width
            continue
        if grad and not tk.get("highlight") and (st.get("gradient_on", "all") == "all" or tk.get("accent")):
            m = Image.new("L", img.size, 0)
            ImageDraw.Draw(m).text((cx, baseline), r, font=font, fill=255, anchor="ls")
            if L.sw:
                d.text((cx, baseline), r, font=font, fill=kw["stroke_fill"], anchor="ls", **kw)
            g = _gradient_img(img.size, [color(c, pal) for c in grad], wd["top"], L.line_px)
            img.paste(g, (0, 0), m)
        elif not L.spacing:
            d.text((cx, baseline), r, font=font, fill=fill, anchor="ls", **kw)
        else:
            for ch in r:
                d.text((cx, baseline), ch, font=font, fill=fill, anchor="ls", **kw)
                cx += font.getlength(ch) + L.spacing
            continue
        cx += font.getlength(r)
    if chars is None or chars >= len(s):
        lw = max(2, L.size * 0.07)
        if tk.get("strike") and not st.get("_anim_strike"):
            ym = baseline - L.asc * 0.27
            d.line((x - 4 * scale, ym, x + wd["w"] + 4 * scale, ym - L.size * 0.03), fill=color(st.get("strike_color", "#FF3B30"), pal), width=int(lw))
        if tk.get("underline"):
            yu = baseline + L.desc * 0.35
            d.line((x, yu, x + wd["w"], yu), fill=color(st.get("underline_color", st.get("accent", "#FFFFFF")), pal), width=int(lw))


def _gradient_img(size, cols, top, h):
    W, H = size
    g = np.linspace(0, 1, max(2, int(h)), dtype=np.float32)
    stops = np.linspace(0, 1, len(cols))
    arr = np.stack([np.interp(g, stops, [c[i] for c in cols]) for i in range(3)], 1)
    full = np.zeros((H, 3), np.float32)
    t0 = int(top)
    for y in range(H):
        full[y] = arr[min(len(arr) - 1, max(0, y - t0))]
    return Image.fromarray(np.repeat(full[:, None, :], W, 1).astype(np.uint8)).convert("RGBA")


def _draw_boxes(d, L, words_filter=None, containers=True, chips=True):
    """Block / line containers, per-word boxes and accent chips. words_filter limits word boxes / chips to those
    word indices (animated parts); containers = the block/line boxes that stay put."""
    st, pal, scale = L.st, L.palette, L.scale
    box = L.box
    if containers and box and box.get("mode", "block") == "block":
        bc = color(box.get("color", "#000000"), pal, box.get("opacity", 0.6))
        d.rounded_rectangle((L.x0c - L.bpx, L.y0c - L.bpy, L.x0c + L.content_w + L.bpx, L.y0c + L.content_h + L.bpy),
                            box.get("radius", 18) * scale, fill=bc)
    if containers and box and box.get("mode") == "line":
        bc = color(box.get("color", "#000000"), pal, box.get("opacity", 0.6))
        for li, (x0, x1) in L.line_x.items():
            top = L.y0c + li * L.line_px
            d.rounded_rectangle((x0 - L.bpx, top - L.bpy / 2, x1 + L.bpx, top + L.line_px + L.bpy / 2), box.get("radius", 18) * scale, fill=bc)
    if box and box.get("mode") == "word":
        bc = color(box.get("color", "#000000"), pal, box.get("opacity", 0.6))
        for wd in L.words:
            if words_filter is not None and wd["index"] not in words_filter:
                continue
            top = wd["top"]
            d.rounded_rectangle((wd["x"] - L.bpx, top - L.bpy / 2, wd["x"] + wd["w"] + L.bpx, top + L.line_px + L.bpy / 2),
                                box.get("radius", 18) * scale, fill=bc)
    ab = st.get("accent_box")
    if ab and chips:  # one coloured chip behind each run of consecutive accent words (marker/highlight look)
        ap = [v * scale for v in ab.get("pad", [14, 4])]
        runs, run = [], None
        for wd in L.words:
            if wd["tk"].get("accent") and (run is None or run["line"] == wd["line"]):
                run = {"x0": wd["x"] if run is None else run["x0"], "x1": wd["x"] + wd["w"], "line": wd["line"], "top": wd["top"],
                       "idx": (run["idx"] if run else []) + [wd["index"]]}
            else:
                if run:
                    runs.append(run)
                run = None
                if wd["tk"].get("accent"):
                    run = {"x0": wd["x"], "x1": wd["x"] + wd["w"], "line": wd["line"], "top": wd["top"], "idx": [wd["index"]]}
            if wd["last"] and run:
                runs.append(run)
                run = None
        if run:
            runs.append(run)
        for r in runs:
            if words_filter is not None and not (set(r["idx"]) & set(words_filter)):
                continue
            y0b = r["top"] + (L.line_px - L.size) / 2 - ap[1] + ab.get("dy", 0) * scale
            x0r = r["x0"]
            x1r = r["x1"]
            if words_filter is not None and len(r["idx"]) > 1:   # animated: each word carries its own part of the chip
                ws = [w for w in L.words if w["index"] in words_filter and w["index"] in r["idx"]]
                x0r = min(w["x"] for w in ws) - (0 if ws[0]["index"] == r["idx"][0] else L.space / 2)
                x1r = max(w["x"] + w["w"] for w in ws) + (0 if ws[-1]["index"] == r["idx"][-1] else L.space / 2)
                pl = ap[0] if ws[0]["index"] == r["idx"][0] else 0
                pr = ap[0] if ws[-1]["index"] == r["idx"][-1] else 0
                d.rounded_rectangle((x0r - pl, y0b, x1r + pr, y0b + L.size + 2 * ap[1]), ab.get("radius", 12) * scale if (pl or pr) else 0,
                                    fill=color(ab.get("color", "#FFD84D"), pal, ab.get("opacity", 1.0)))
                continue
            d.rounded_rectangle((x0r - ap[0], y0b, x1r + ap[0], y0b + L.size + 2 * ap[1]), ab.get("radius", 12) * scale,
                                fill=color(ab.get("color", "#FFD84D"), pal, ab.get("opacity", 1.0)))


def _effects(img, L):
    """Glow and drop shadow from the layer's alpha."""
    st, pal, scale = L.st, L.palette, L.scale
    sh, gl = st.get("shadow"), st.get("glow")
    if not sh and not gl:
        return img
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    alpha = img.split()[3]
    if gl:
        a = alpha.filter(ImageFilter.GaussianBlur(max(0.1, gl.get("blur", 18) * scale)))
        k = gl.get("strength", 1.0)
        a = a.point(lambda v: int(min(255, v * k)))
        g = Image.new("RGBA", img.size, color(gl.get("color", st.get("accent", "#FFFFFF")), pal)[:3] + (0,))
        g.putalpha(a)
        out.alpha_composite(g)
        if k > 1.2:
            out.alpha_composite(g)
    if sh:
        a = alpha.filter(ImageFilter.GaussianBlur(max(0.1, sh.get("blur", 12) * scale)))
        op = sh.get("opacity", 0.45)
        a = a.point(lambda v: int(v * op))
        shadow = Image.new("RGBA", img.size, color(sh.get("color", "#000000"), pal)[:3] + (0,))
        shadow.putalpha(a)
        out.alpha_composite(shadow, (0, int(round(sh.get("dy", 4) * scale))))
    out.alpha_composite(img)
    return out


def render_rich(tokens, style, palette=None, scale=1.0):
    """Render tokens -> {'img', 'box', 'layout'} (full static text)."""
    L = Layout(tokens, style, palette, scale)
    img = Image.new("RGBA", (L.W, L.H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    _draw_boxes(d, L)
    for wd in L.words:
        _draw_word(img, d, L, wd)
    img = _effects(img, L)
    return {"img": img, "box": (L.x0c, L.y0c, L.x0c + L.content_w, L.y0c + L.content_h), "layout": L}


def render_tokens(tokens, style, palette=None, scale=1.0):
    """Render word tokens with a text style. Returns (RGBA image, content box (x0,y0,x1,y1))."""
    r = render_rich(tokens, style, palette, scale)
    return r["img"], r["box"]


def render_parts(tokens, style, palette=None, scale=1.0, by="word"):
    """Split text into animatable parts at their final positions.

    Returns {'base': RGBA (boxes that stay put) or None, 'parts': [{'img', 'x', 'y', 'index', 'line', 'accent', 'n'}],
             'box': content box, 'size': (W, H), 'layout': Layout}. by = word | letter | line."""
    L = Layout(tokens, style, palette, scale)
    base = Image.new("RGBA", (L.W, L.H), (0, 0, 0, 0))
    word_boxes = bool(L.box and L.box.get("mode") == "word")
    _draw_boxes(ImageDraw.Draw(base), L, words_filter=[], containers=True, chips=False)
    base = _effects(base, L) if base.getbbox() else None
    groups = []
    if by == "line":
        for li in range(len(L.lines)):
            groups.append([wd for wd in L.words if wd["line"] == li])
    else:
        groups = [[wd] for wd in L.words]
    parts = []
    for gi, grp in enumerate(groups):
        if by == "letter":
            wd = grp[0]
            if wd["tk"].get("img"):
                seqs = [None]
            else:
                seqs = list(range(1, len(wd["s"]) + 1))
            prev = None
            for n in seqs:
                im = Image.new("RGBA", (L.W, L.H), (0, 0, 0, 0))
                d = ImageDraw.Draw(im)
                if n == seqs[0] or n is None:
                    if word_boxes or style.get("accent_box"):
                        _draw_boxes(d, L, words_filter=[wd["index"]], containers=False)
                _draw_word(im, d, L, wd, chars=n)
                if prev is not None:  # keep only the new letter: subtract what the prefix drew
                    a = np.asarray(im, np.int16)
                    b = np.asarray(prev, np.int16)
                    diff = np.abs(a - b).sum(2) > 0
                    arr = np.asarray(im).copy()
                    arr[~diff] = 0
                    cur = im
                    im = Image.fromarray(arr, "RGBA")
                    prev = cur
                else:
                    prev = im
                im = _effects(im, L)
                bb = im.getbbox()
                if not bb:
                    continue
                parts.append({"img": im.crop(bb), "x": bb[0], "y": bb[1], "index": len(parts), "word": wd["index"],
                              "line": wd["line"], "accent": bool(wd["tk"].get("accent"))})
            continue
        im = Image.new("RGBA", (L.W, L.H), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        if word_boxes or style.get("accent_box"):
            _draw_boxes(d, L, words_filter=[wd["index"] for wd in grp], containers=False)
        for wd in grp:
            _draw_word(im, d, L, wd)
        im = _effects(im, L)
        bb = im.getbbox()
        if not bb:
            continue
        parts.append({"img": im.crop(bb), "x": bb[0], "y": bb[1], "index": len(parts), "word": grp[0]["index"],
                      "line": grp[0]["line"], "accent": any(w["tk"].get("accent") for w in grp)})
    for p in parts:
        p["n"] = len(parts)
    return {"base": base, "parts": parts, "box": (L.x0c, L.y0c, L.x0c + L.content_w, L.y0c + L.content_h),
            "size": (L.W, L.H), "layout": L}


def render_text(text, style, palette=None, scale=1.0):
    return render_tokens(parse_markup(text), style, palette, scale)


def text_extent(text, style, scale=1.0):
    """(width, height) of the laid-out text without rendering shadows."""
    img, (x0, y0, x1, y1) = render_tokens(parse_markup(text), {**style, "shadow": None, "box": None}, None, scale)
    return x1 - x0, y1 - y0
