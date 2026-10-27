"""Beat-synced montage: a section's `montage:` expands into clips cut on the music's beat.

    - section: memories
      montage:
        items: [mybrand/screens/home.jpg, mybrand/screens/detail.jpg, {src: rec, in: 2.0}, ...]
        beats: 1            # beats per item (0.5 = every half beat)
        intro: 2            # the first N items scale up from a small framed box to full frame
        grid: 4             # after the intro, a 2x2 grid collage builds tile by tile (one per half beat); 0 = none
        speedup: 0.6        # from this fraction of the items on, cut twice as fast (into the drop); 0 = off
        layout: fullbleed   # fullbleed | fit
        flash: true         # white flash on the last cut

Image items are file paths; video items are clip dicts ({src, in}); each item becomes one clip. The tempo comes from
the music (`audio.music.bpm`, or the generated bed's bpm / mood), so cuts land on beats like the CapCut "beat edit"
templates. The grid frames are composited once and cached as images.
"""
import hashlib
from pathlib import Path

from PIL import Image

from .paths import BRANDS, INBOX, cache_dir
from .paths import expand as _resolve

KEYS = {"items", "beats", "intro", "grid", "speedup", "layout", "flash", "gap", "background"}


def tempo(raw):
    mu = ((raw.get("audio") or {}).get("music")) or {}
    if mu.get("bpm"):
        return float(mu["bpm"])
    g = mu.get("generate")
    if g is not None:
        g = g or {}
        if g.get("bpm"):
            return float(g["bpm"])
        from .synth import MOODS
        return float(MOODS.get(g.get("mood") or "chill", MOODS["chill"])["bpm"])
    return 120.0


def _find(p, spec_dir, brand_dir):
    for b in (spec_dir, brand_dir, *BRANDS, INBOX):
        f = _resolve(p, b)
        if f.exists():
            return f
    return None


def _cover(im, w, h):
    """Scale + centre-crop an image to exactly w x h."""
    k = max(w / im.width, h / im.height)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def _grid_frames(paths, W, H, gap, bg):
    """2x2 grid that fills tile by tile: returns cached image paths [1 tile, 2 tiles, 3, 4]."""
    key = hashlib.md5(("|".join(str(p) for p in paths) + f"{W}x{H}{gap}{bg}").encode()).hexdigest()[:12]
    out_dir = cache_dir("montage")
    outs = [out_dir / f"grid_{key}_{i}.png" for i in range(1, len(paths) + 1)]
    if all(o.exists() for o in outs):
        return outs
    cw, ch = (W - 3 * gap) // 2, (H - 3 * gap) // 2
    cells = [(gap, gap), (2 * gap + cw, gap), (gap, 2 * gap + ch), (2 * gap + cw, 2 * gap + ch)]
    canvas = Image.new("RGB", (W, H), bg)
    for i, p in enumerate(paths):
        canvas.paste(_cover(Image.open(p).convert("RGB"), cw, ch), cells[i])
        canvas.save(outs[i])
    return outs


def expand(m, raw, spec_dir, brand_dir, size=(1080, 1920)):
    """montage dict -> list of clip dicts (or raises ValueError with a readable message)."""
    items = m.get("items") or []
    if not items:
        raise ValueError("montage.items needs at least one image path or clip")
    beat = 60.0 / tempo(raw)
    per = float(m.get("beats", 1)) * beat
    n = len(items)
    intro = int(m.get("intro", 0))
    grid = int(m.get("grid", 0))
    sp = float(m.get("speedup", 0) or 0)
    lay = m.get("layout", "fullbleed")
    bgc = m.get("background", "#000000")
    clips = []

    def item_clip(it, dur):
        if isinstance(it, dict):
            c = dict(it)
            c.pop("dur", None)
            c.pop("out", None)
            c["dur"] = round(dur, 4)
            c.setdefault("layout", lay)
            return c
        return {"image": it, "dur": round(dur, 4), "layout": lay}

    i = 0
    for k in range(min(intro, n)):                    # intro: small framed box growing to full
        c = item_clip(items[i], per)
        z0 = 0.5 + 0.22 * k / max(1, intro)
        c.update(layout={"type": "fit"}, zoom=[z0, z0 + 0.12], background={"type": "color", "color": bgc})
        clips.append(c)
        i += 1
    if grid and i < n:                                 # grid collage: tiles appear one per half beat
        tiles = [it for it in items[i:i + min(4, grid)] if isinstance(it, str)]
        found = [_find(t, spec_dir, brand_dir) for t in tiles]
        if tiles and all(found):
            for f in _grid_frames(found, size[0], size[1], int(m.get("gap", 14)), bgc):
                clips.append({"image": str(f), "dur": round(beat / 2, 4), "layout": "fullbleed"})
            i += len(tiles)
    rest = items[i:]
    fast_from = int(len(rest) * sp) if sp else len(rest)
    for j, it in enumerate(rest):
        clips.append(item_clip(it, per / 2 if j >= fast_from else per))
    # snap every cut to the absolute beat grid in whole frames (per-clip rounding would drift off the beat)
    fps = float((raw.get("output") or {}).get("fps", 30))
    t = 0.0
    for c in clips:
        f0, f1 = round(t * fps), round((t + c["dur"]) * fps)
        t += c["dur"]
        c["dur"] = round(max(1, f1 - f0) / fps, 6)
    if m.get("flash", True) and len(clips) > 1:
        clips[-1]["transition"] = {"type": "flash", "dur": 0.12}
    return clips
