"""./vtk reference <video>: style/pacing summary of a reference video (never copy its content).

Measures shot lengths and cut rhythm, cut-to-beat alignment, motion, brightness, and where
on-screen text tends to sit (heuristic: stable high-contrast regions), plus a contact sheet.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

from ..contactsheet import video_sheet
from ..media import FFMPEG, probe, run


def _frames_gray(path, fps=4, w=180):
    info = probe(path)
    h = int(round(info["height"] * w / info["width"] / 2) * 2)
    p = run([FFMPEG, "-v", "error", "-i", str(path), "-vf", f"fps={fps},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
    a = np.frombuffer(p.stdout, np.uint8)
    n = len(a) // (w * h * 3)
    return a[: n * w * h * 3].reshape(n, h, w, 3), h, w


def analyze(path, out_dir):
    from .scenes import _scenedetect, detect
    _scenedetect()
    import cv2
    path = Path(path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    info = probe(path)
    sc = detect(path, out_dir)
    shots = [s["dur"] for s in sc["scenes"]]
    cuts = [s["start"] for s in sc["scenes"][1:]]
    dur = info["duration"]
    res = {"path": str(path), "duration": round(dur, 2), "size": f"{info.get('width')}x{info.get('height')}",
           "fps": info.get("fps"), "shots": len(shots),
           "shot_len": {"mean": round(float(np.mean(shots)), 2), "median": round(float(np.median(shots)), 2),
                        "min": round(float(np.min(shots)), 2), "max": round(float(np.max(shots)), 2)},
           "cuts_per_10s": round(len(cuts) / max(dur, 1e-3) * 10, 2),
           "cut_times": [round(c, 2) for c in cuts]}
    # pacing curve: cuts per 5 s window
    res["pacing_5s"] = [int(sum(1 for c in cuts if a <= c < a + 5)) for a in np.arange(0, dur, 5)]
    # beat alignment
    if info.get("has_audio"):
        try:
            from .audio_analysis import analyze as aa
            au = aa(path)
            beats = np.array(au["beats"])
            res["tempo_bpm"] = au["tempo_bpm"]
            if len(beats) and cuts:
                near = [float(np.min(np.abs(beats - c))) for c in cuts]
                res["cuts_on_beat_pct"] = round(100 * float(np.mean(np.array(near) < 0.08)), 1)
            res["loudness_lufs"] = au.get("loudness_lufs")
        except Exception as e:
            res["audio_error"] = str(e)
    # look: motion, brightness, saturation, text-region heatmap
    fr, h, w = _frames_gray(path)
    gray = fr.mean(axis=3)
    motion = np.abs(np.diff(gray, axis=0)).mean(axis=(1, 2)) if len(gray) > 1 else np.array([0])
    hsv = np.stack([cv2.cvtColor(f, cv2.COLOR_RGB2HSV) for f in fr])
    res["look"] = {"motion_mean": round(float(motion.mean()), 2), "brightness": round(float(gray.mean() / 255), 2),
                   "saturation": round(float(hsv[..., 1].mean() / 255), 2)}
    edges = np.stack([cv2.Canny(f.astype(np.uint8), 80, 180) > 0 for f in gray.astype(np.uint8)])
    stable = edges[1:] & edges[:-1]           # edges that persist between samples -> overlays/text/UI
    heat = stable.mean(axis=0)
    thirds = [float(heat[int(h * a / 3): int(h * (a + 1) / 3)].mean()) for a in range(3)]
    tot = sum(thirds) or 1
    res["text_zones_pct"] = {"top": round(100 * thirds[0] / tot), "middle": round(100 * thirds[1] / tot), "bottom": round(100 * thirds[2] / tot)}
    hm = (np.clip(heat / (heat.max() + 1e-9), 0, 1) * 255).astype(np.uint8)
    Image.fromarray(hm).resize((w * 2, h * 2)).save(out_dir / f"ref_textheat_{path.stem}.png")
    res["sheets"] = video_sheet(path, out_dir / f"ref_sheet_{path.stem}.jpg")
    res["scene_sheets"] = sc["sheets"]
    (out_dir / f"reference_{path.stem}.json").write_text(json.dumps(res, indent=1))
    return res


def summary(res):
    L = [f"Reference: {Path(res['path']).name}  ({res['duration']}s, {res['size']}, {res['fps']} fps)",
         f"  shots: {res['shots']}   shot length mean {res['shot_len']['mean']}s / median {res['shot_len']['median']}s "
         f"(min {res['shot_len']['min']}, max {res['shot_len']['max']})   cuts per 10s: {res['cuts_per_10s']}",
         f"  pacing (cuts per 5s window): {res['pacing_5s']}"]
    if "tempo_bpm" in res:
        L.append(f"  music tempo ~{res['tempo_bpm']} BPM   cuts on a beat (±80ms): {res.get('cuts_on_beat_pct', 'n/a')}%   loudness {res.get('loudness_lufs')} LUFS")
    L.append(f"  look: motion {res['look']['motion_mean']}, brightness {res['look']['brightness']}, saturation {res['look']['saturation']}")
    z = res["text_zones_pct"]
    L.append(f"  stable-overlay (text/graphics) energy by third: top {z['top']}% / middle {z['middle']}% / bottom {z['bottom']}%")
    L += [f"  sheet: {s}" for s in res["sheets"]]
    return "\n".join(L)
