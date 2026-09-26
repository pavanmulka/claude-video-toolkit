"""./vtk scenes <clip>: cut/scene detection (PySceneDetect) + idle stretches for long recordings."""
import json
import sys
from pathlib import Path

from PIL import Image

from ..contactsheet import extract_thumbs, sheet
from ..media import activity_segments, motion_profile, probe


def _scenedetect():
    # PySceneDetect would also load PyAV, whose bundled libavdevice clashes with OpenCV's copy
    # (duplicate Objective-C classes). Hide PyAV so only the OpenCV backend loads.
    sys.modules.setdefault("av", None)
    import scenedetect
    return scenedetect


def detect(path, out_dir, threshold=None, min_scene=0.4):
    sd = _scenedetect()
    info = probe(path)
    fps = info["fps"] or 30
    if threshold:
        scenes = sd.detect(str(path), sd.ContentDetector(threshold=threshold, min_scene_len=int(min_scene * fps)))
    else:
        scenes = sd.detect(str(path), sd.AdaptiveDetector(min_scene_len=int(min_scene * fps)))
        if len(scenes) <= 1 and info.get("vfr"):
            # screen recordings have animated transitions, not hard cuts: split on screen changes instead
            scenes = sd.detect(str(path), sd.ContentDetector(threshold=14, min_scene_len=int(0.3 * fps)))
    rows = [{"start": round(a.get_seconds(), 3), "end": round(b.get_seconds(), 3), "dur": round(b.get_seconds() - a.get_seconds(), 3)}
            for a, b in scenes] or [{"start": 0.0, "end": info["duration"], "dur": info["duration"]}]
    t, d = motion_profile(path)
    act = activity_segments(t, d)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    # contact sheet: first frame of each scene
    thumbs = []
    allth = extract_thumbs(path, every=0.25, thumb_w=220 if info["height"] > info["width"] else 320)
    for r in rows:
        best = min(allth, key=lambda x: abs(x[0] - (r["start"] + 0.05)))
        thumbs.append((r["start"], best[1]))
    pages = sheet(thumbs, out_dir / f"scenes_{Path(path).stem}.jpg", cols=6, title=f"{Path(path).name}: {len(rows)} scenes")
    res = {"path": str(path), "scenes": rows, "activity": act, "sheets": pages}
    (out_dir / f"scenes_{Path(path).stem}.json").write_text(json.dumps(res, indent=1))
    return res
