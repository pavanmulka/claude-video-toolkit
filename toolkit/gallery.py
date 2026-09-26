"""./vtk looks --render <kind>: gallery sheets of themes, text animations, marks, transitions and caption styles,
rendered with the real engine (and an iPhone recording from inbox/ when there is one)."""
import yaml
from PIL import Image, ImageDraw

from .media import kind_of, probe
from .paths import INBOX, work_dir
from .text import label_font

SAMPLE_WORDS = "Your notes app isn't a plan. Plan with one app".split()


def _recording():
    if not INBOX.exists():
        return None
    for p in sorted(INBOX.iterdir()):
        if p.is_file() and kind_of(p) == "video" and not p.stem.endswith(("_v1", "_v2", "_v3", "_v4", "_preview")):
            try:
                info = probe(p)
            except Exception:
                continue
            if info.get("height", 0) > info.get("width", 1) and info.get("duration", 0) > 3:
                return p.name, info
    return None


def _render_stills(name, spec, times):
    from .render import render
    d = work_dir("looks")
    path = d / f"{name}.yaml"
    path.write_text(yaml.safe_dump(spec, sort_keys=False, allow_unicode=True))
    return render(path, frames=[str(t) for t in times])


def _sheet(items, out, cols=4, tw=270):
    """items: [(label, png path)] -> labelled grid."""
    if not items:
        return None
    th = int(tw * 16 / 9)
    font = label_font(22)
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * (th + 34)), (245, 245, 247))
    d = ImageDraw.Draw(sheet)
    for i, (label, p) in enumerate(items):
        x, y = (i % cols) * tw, (i // cols) * (th + 34)
        im = Image.open(p).convert("RGB").resize((tw - 6, th - 6), Image.LANCZOS)
        sheet.paste(im, (x + 3, y + 34 + 3))
        d.text((x + 8, y + 6), label, fill=(20, 20, 24), font=font)
    sheet.save(out)
    return out


def _base(brand, theme=None, out="x"):
    s = {"version": 1, "name": f"looks-{out}", "brand": brand, "output": {"file": f"../.work/looks/{out}.mp4", "aspect": "9:16", "fps": 30}}
    if theme:
        s["theme"] = theme
    return s


def render_gallery(kind, brand=None):
    from . import brand as brandmod
    brand = brand or brandmod.default_brand()
    rec = _recording()
    d = work_dir("looks")
    items = []
    if kind == "themes":
        b = brandmod.load(brand)
        for th in b.get("themes", {}):
            s = _base(brand, th, f"theme_{th}")
            sec = {"section": "demo", "text": {"content": "Your notes app\nisn't a **plan.**", "style": "title", "pos": ["50%", "15%"]}}
            if rec:
                s["sources"] = {"rec": rec[0]}
                sec["clips"] = [{"src": "rec", "in": min(1.0, rec[1]["duration"] / 3), "dur": 1.5, "layout": {"type": "iphone", "top": "30%"}}]
            else:
                sec["clips"] = [{"color": "transparent", "dur": 1.5}]
            sec["overlays"] = [{"mark": {"type": "circle", "rect": [330, 160, 420, 150], "draw": 0.4, "delay": 0.2}}]
            s["timeline"] = [sec]
            p = _render_stills(f"theme_{th}", s, [1.2])
            items.append((th, p[0]))
        return [_sheet(items, d / "themes.png")]
    if kind == "text":
        effects = [("block", "pop"), ("word", "pop"), ("word", "stamp"), ("word", "rise"), ("word", "blur"), ("line", "mask"),
                   ("word", "slide_left"), ("word", "zoom"), ("word", "spin"), ("word", "bounce"), ("letter", "type"), ("word", "flip")]
        s = _base(brand, "midnight_plum", "text_effects")
        s["timeline"] = []
        times = []
        for i, (by, eff) in enumerate(effects):
            s["timeline"].append({"section": f"{by}-{eff}", "text": {"content": "Your notes app\nisn't a **plan.**", "style": "title", "pos": "center"},
                                  "text_anim": ({"effect": eff, "in": 0.35} if by == "block" else
                                                {"by": by, "effect": eff, "stagger": 0.07 if by != "letter" else 0.03,
                                                 **({"caret": True} if eff == "type" else {})}),
                                  "clips": [{"color": "transparent", "dur": 1.6}]})
            times.append(i * 1.6 + 0.24)
        ps = _render_stills("text_effects", s, times)
        items = [(f"{by} · {eff}", p) for (by, eff), p in zip(effects, ps)]
        extra = _base(brand, "midnight_plum", "text_styles")
        styles = ["kinetic", "editorial", "neon", "gradient_title", "highlight", "strike", "word_pills", "glass_card", "handwritten",
                  "outline", "sticker", "typewriter"]
        extra["timeline"] = [{"section": st, "text": {"content": "Plan with ~~spreadsheets~~ **one app.**" if st == "strike" else
                                                       "Your notes app isn't a **plan.**", "style": st, "pos": "center"},
                              "text_anim": {"by": "word", "effect": "pop", "stagger": 0.05} if st == "strike" else {"in": 0.01},
                              "clips": [{"color": "transparent", "dur": 2.2}]} for st in styles]
        ps2 = _render_stills("text_styles", extra, [i * 2.2 + 2.0 for i in range(len(styles))])
        return [_sheet(items, d / "text_effects.png"), _sheet(list(zip(styles, ps2)), d / "text_styles.png")]
    if kind == "marks":
        types = ["circle", "underline", "highlight", "strike", "box", "brackets", "arrow", "check", "cross", "ping", "scribble", "spotlight"]
        s = _base(brand, "midnight_plum", "marks")
        secs = []
        for i, t in enumerate(types):
            m = {"type": t, "rect": [300, 860, 480, 110], "draw": 0.45}
            if t == "arrow":
                m = {"type": "arrow", "from": [260, 1250], "to": [520, 980], "draw": 0.45}
            secs.append({"section": t, "text": {"content": t, "style": "clean_title", "pos": ["50%", "30%"]},
                         "clips": [{"color": "transparent", "dur": 1.0}],
                         "overlays": [{"text": "G7655388", "style": "clean_title", "pos": ["50%", "47.5%"]}, {"mark": m}]})
        s["timeline"] = secs
        ps = _render_stills("marks", s, [i * 1.0 + 0.8 for i in range(len(types))])
        return [_sheet(list(zip(types, ps)), d / "marks.png")]
    if kind == "transitions":
        types = ["crossfade", "slide", "push", "whip", "zoom", "blur", "wipe", "circle", "glitch", "flash", "dip"]
        s = _base(brand, None, "transitions")
        cols = ["#2D1533", "#0E3B45"]
        secs = [{"section": "start", "text": {"content": "A", "style": "title", "pos": "center"}, "clips": [{"color": cols[0], "dur": 1.0}]}]
        times = []
        t = 1.0
        for i, tr in enumerate(types):
            dur = 0.4
            secs.append({"section": tr, "text": {"content": tr, "style": "title", "pos": "center"},
                         "clips": [{"color": cols[(i + 1) % 2], "dur": 1.0, "transition": {"type": tr, "dur": dur}}]})
            overlap = tr != "dip"
            start = t - (dur if overlap else 0)
            times.append(start + dur / 2)
            t = start + 1.0
        s["timeline"] = secs
        ps = _render_stills("transitions", s, times)
        return [_sheet(list(zip(types, ps)), d / "transitions.png")]
    if kind == "captions":
        from . import brand as bm, spec as specmod, timeline as tl
        from .compositor import Renderer
        b = bm.load(brand)
        words, t0 = [], 0.2
        for w in SAMPLE_WORDS:
            words.append({"w": w, "start": t0, "end": t0 + 0.28})
            t0 += 0.32
        for cs in sorted(b.get("caption_styles", {})):
            s = _base(brand, "midnight_plum", f"cap_{cs}")
            s["timeline"] = [{"section": "c", "text": "none", "clips": [{"color": "transparent", "dur": 3.0}]}]
            s["captions"] = {"from": "voiceover", "style": cs}
            path = d / f"cap_{cs}.yaml"
            path.write_text(yaml.safe_dump(s, sort_keys=False))
            spec = specmod.load(path)
            plan = tl.build(spec)
            r = Renderer(spec, plan, caption_words=words)
            g, fr = next(r.frames(only={int(1.25 * 30)}, g0=int(1.25 * 30), g1=int(1.25 * 30) + 1))
            p = d / f"cap_{cs}.png"
            fr.save(p)
            items.append((cs, str(p)))
        return [_sheet(items, d / "captions.png")]
    if kind == "motion":
        import subprocess
        from .motion import MOTION, available
        if not available():
            raise RuntimeError("motion/ is not installed: cd motion && npm install")
        subprocess.run(["node", "scripts/verify.mjs", "catalog"], cwd=MOTION, check=True)
        return [str(MOTION.parent / ".work" / "motion" / "catalog.png")]
    raise ValueError(f"unknown gallery '{kind}'")
