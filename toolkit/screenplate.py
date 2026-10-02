"""Screen plates: footage of a hand holding a phone whose screen is chroma-key green (e.g. made with an AI video tool).

`track(path)` finds the green screen in every frame of the plate (4 corners, smoothed over time, cached), and
`key_mask(frame)` gives the per-frame green mask so fingers that cross the screen stay in front of the recording.
The compositor (`layout: {type: plate}`) warps the real screen recording into that quad.
"""
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

from .media import probe, proxy, read_frames
from .paths import cache_dir

KEYS = {
    # hue range (OpenCV 0-180), min saturation, min value
    "green": ((35, 90), 90, 70),
    "blue": ((95, 130), 90, 60),
}


def key_mask(rgb, key="green"):
    """uint8 mask (0/255) of the key colour in an RGB frame."""
    (h0, h1), smin, vmin = KEYS[key]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    m = cv2.inRange(hsv, (h0, smin, vmin), (h1, 255, 255))
    return cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))


def _corners(mask):
    """4 corners (tl, tr, br, bl) of the largest key blob, as float32 [4, 2], or None."""
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n < 2:
        return None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    if stats[i, cv2.CC_STAT_AREA] < 0.01 * mask.size:
        return None
    blob = (lab == i).astype(np.uint8) * 255
    blob = cv2.morphologyEx(blob, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))   # fill the island / small occlusions
    cnts, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    hull = cv2.convexHull(max(cnts, key=cv2.contourArea)).reshape(-1, 2).astype(np.float32)
    # a rotated rectangle around the hull = the screen rectangle (rounded corners included), then order it
    box = cv2.boxPoints(cv2.minAreaRect(hull)).astype(np.float32)
    s, d = box.sum(1), np.diff(box, axis=1).ravel()
    tl, br = box[np.argmin(s)], box[np.argmax(s)]
    tr, bl = box[np.argmin(d)], box[np.argmax(d)]
    return np.array([tl, tr, br, bl], np.float32)


def track(path, key="green", smooth=5):
    """Per-frame screen corners in the plate's CFR proxy timeline (full-res px). Cached. Returns (fps, corners[N,4,2])."""
    st = Path(path).stat()
    h = hashlib.sha1(json.dumps([str(path), st.st_size, st.st_mtime, key, smooth]).encode()).hexdigest()[:16]
    out = cache_dir("screens") / f"{Path(path).stem[:40]}_{h}.npz"
    if out.exists():
        z = np.load(out)
        return float(z["fps"]), z["corners"]
    pth, fps, w, hh = proxy(path, 1.0)
    n = max(1, int(round(probe(pth)["duration"] * fps)))
    cs, last = [], None
    for fr in read_frames(pth, w, hh, 0, n, fps):
        c = _corners(key_mask(fr, key))
        if c is None:
            c = last
        cs.append(c)
        last = c if c is not None else last
    if not any(c is not None for c in cs):
        raise RuntimeError(f"{Path(path).name}: no {key} screen found (is the screen a flat chroma-key colour?)")
    first = next(c for c in cs if c is not None)
    cs = np.stack([c if c is not None else first for c in cs])
    if smooth > 1 and len(cs) > smooth:    # centred moving average against jitter
        pad = smooth // 2
        p = np.concatenate([cs[:1].repeat(pad, 0), cs, cs[-1:].repeat(pad, 0)])
        k = np.ones(smooth) / smooth
        cs = np.apply_along_axis(lambda v: np.convolve(v, k, "valid"), 0, p.reshape(len(p), -1)).reshape(-1, 4, 2)
    np.savez(out, fps=fps, corners=cs.astype(np.float32))
    return float(fps), cs.astype(np.float32)


def track_image(path, key="green"):
    """Screen corners of a still plate (full-res px), float32 [4, 2]."""
    from PIL import Image
    rgb = np.asarray(Image.open(path).convert("RGB"))
    c = _corners(key_mask(rgb, key))
    if c is None:
        raise RuntimeError(f"{Path(path).name}: no {key} screen found (is the screen a flat chroma-key colour?)")
    return c


def despill(rgb, mask, width=6):
    """Remove green fringe on plate pixels next to the screen (bezel edge, fingers)."""
    ring = cv2.dilate(mask, np.ones((width, width), np.uint8)) > 0
    out = rgb.copy()
    r, g, b = out[..., 0].astype(np.int16), out[..., 1].astype(np.int16), out[..., 2].astype(np.int16)
    lim = np.maximum(r, b)
    sel = ring & (g > lim)
    out[..., 1][sel] = lim[sel].astype(np.uint8)
    return out
