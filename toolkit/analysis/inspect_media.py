"""./vtk inspect <folder|files>: specs, contact sheets and on-screen activity for every clip."""
import json
from pathlib import Path

from ..contactsheet import video_sheet
from ..device import model_for
from ..media import activity_segments, kind_of, motion_profile, probe


def inspect(paths, out_dir, sheets=True, activity=True):
    files = []
    for p in paths:
        p = Path(p)
        files += sorted(q for q in p.iterdir() if q.is_file() and not q.name.startswith(".")) if p.is_dir() else [p]
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    report = []
    for f in files:
        k = kind_of(f)
        if k == "other":
            continue
        info = probe(f)
        row = {k2: info.get(k2) for k2 in ("path", "kind", "duration", "width", "height", "fps", "vfr", "has_audio", "hdr", "size_mb")}
        if k == "video" and info.get("width"):
            m = model_for(info["width"], info["height"])
            if m["name"] != "generic device" and info["height"] > info["width"]:
                row["device"] = m["name"]
            if sheets:
                row["sheet"] = video_sheet(f, out_dir / f"sheet_{f.stem}.jpg")
            if activity:
                t, d = motion_profile(f)
                row["activity"] = activity_segments(t, d)
        if k == "audio" or (k == "video" and info.get("has_audio")):
            try:
                from .audio_analysis import loudness
                row["loudness_lufs"] = loudness(f)
            except Exception:
                pass
        report.append(row)
    (out_dir / "inspect.json").write_text(json.dumps(report, indent=1, default=str))
    return report


def print_report(report):
    for r in report:
        name = Path(r["path"]).name
        if r["kind"] == "video":
            extra = f"  [{r['device']}]" if r.get("device") else ""
            flags = " VFR" if r.get("vfr") else ""
            flags += " HDR" if r.get("hdr") else ""
            aud = "audio" if r.get("has_audio") else "no audio"
            print(f"{name}: {r['duration']:.2f}s  {r['width']}x{r['height']}  {r['fps']}fps{flags}  {aud}{extra}")
            if r.get("activity"):
                idle = [a for a in r["activity"] if a["state"] == "idle"]
                if idle:
                    print("   idle (nothing moving): " + ", ".join(f"{a['start']:.1f}-{a['end']:.1f}" for a in idle))
            for s in r.get("sheet", []):
                print(f"   sheet: {s}")
        else:
            lufs = f"  {r['loudness_lufs']} LUFS" if r.get("loudness_lufs") is not None else ""
            print(f"{name}: {r['kind']}  {r['duration']:.2f}s{lufs}")
