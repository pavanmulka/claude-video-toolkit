"""Timestamped contact sheets (grids of frames) for checking footage and renders."""
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from .media import FFMPEG, probe, run
from .text import label_font


def extract_thumbs(video, every=0.5, thumb_w=240, start=0.0, end=None):
    """Return [(t, PIL image)] sampled every `every` seconds (frame nearest to each time)."""
    info = probe(video)
    dur = info["duration"]
    end = dur if end is None else min(end, dur)
    w, h = info["width"], info["height"]
    tw = int(thumb_w)
    th = int(round(h * tw / w / 2) * 2)
    # select real frames (first frame at/after each step) and label them with their true timestamps;
    # the fps filter would keep the *last* frame of each slot and mislabel it by up to every/2
    vf = f"select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,{every - 0.002:.4f})',scale={tw}:{th}:flags=area,showinfo"
    p = run([FFMPEG, "-hide_banner", "-ss", f"{start:.3f}", "-i", str(video), "-t", f"{end - start:.3f}",
             "-vf", vf, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
    times = [float(m) for m in re.findall(r"pts_time:\s*([0-9.]+)", p.stderr.decode(errors="replace"))]
    a = np.frombuffer(p.stdout, np.uint8)
    n = len(a) // (tw * th * 3)
    frames = a[: n * tw * th * 3].reshape(n, th, tw, 3)
    return [(start + (times[i] if i < len(times) else i * every), Image.fromarray(frames[i].copy())) for i in range(n)]


def sheet(thumbs, out_path, cols=8, title=None, per_page=64):
    """Lay thumbs out in grids (paginated). Returns list of written paths."""
    if not thumbs:
        return []
    out_path = Path(out_path)
    tw, th = thumbs[0][1].size
    font = label_font(max(14, tw // 11))
    head = int(font.size * 1.5)
    title_h = int(font.size * 2.2) if title else 0
    pages = []
    for p0 in range(0, len(thumbs), per_page):
        part = thumbs[p0:p0 + per_page]
        rows = math.ceil(len(part) / cols)
        im = Image.new("RGB", (cols * (tw + 6) + 6, title_h + rows * (th + head + 6) + 6), (245, 245, 245))
        d = ImageDraw.Draw(im)
        if title:
            d.text((8, 6), title, fill=(20, 20, 20), font=font)
        for i, (t, th_im) in enumerate(part):
            x = 6 + (i % cols) * (tw + 6)
            y = title_h + 6 + (i // cols) * (th + head + 6)
            d.text((x + 2, y), f"{t:.2f}s", fill=(215, 30, 30), font=font)
            im.paste(th_im, (x, y + head))
        name = out_path if len(thumbs) <= per_page else out_path.with_name(f"{out_path.stem}_{p0 // per_page + 1}{out_path.suffix}")
        im.save(name, quality=86)
        pages.append(str(name))
    return pages


def video_sheet(video, out_path, every=None, thumb_w=None, cols=None, title=None):
    """Contact sheet of a whole video with sensible defaults for its length/shape."""
    info = probe(video)
    dur = info["duration"]
    if every is None:
        every = 0.5 if dur <= 45 else (1.0 if dur <= 120 else 2.0)
    portrait = info["height"] > info["width"]
    thumb_w = thumb_w or (220 if portrait else 360)
    cols = cols or (8 if portrait else 5)
    thumbs = extract_thumbs(video, every=every, thumb_w=thumb_w)
    return sheet(thumbs, out_path, cols=cols, title=title or Path(video).name)
