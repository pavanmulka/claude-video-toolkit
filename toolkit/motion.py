"""Bridge to the Remotion motion-graphics library in motion/: render looks (text bursts, counters,
chat bubbles, charts, backgrounds, end cards...) as cached video layers the compositor stacks in.

Spec usage:
    clips:    - {motion: stat-counter, dur: 2.5, props: {from: 0, to: 118, format: percent, label: "net retention"}}
    overlays: - {motion: emoji-burst, start: 1.2, dur: 1.5, props: {emojis: ["😭", "🔥"]}}
Colours and fonts come from the brand/theme unless props override them."""
import hashlib
import json
import subprocess
from pathlib import Path

from .paths import CACHE, ROOT, cache_dir

MOTION = ROOT / "motion"
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".mp4", ".mov"}
_cat = None


def available():
    return (MOTION / "render.mjs").exists() and (MOTION / "node_modules").exists()


def catalog():
    """{id: entry} from motion/catalog.json, or None when the library is not installed."""
    global _cat
    if _cat is None:
        f = MOTION / "catalog.json"
        if not f.exists():
            return None
        _cat = {x["id"]: x for x in json.loads(f.read_text())}
    return _cat


def _stamp():
    """Changes whenever a look's source changes (so cached renders refresh)."""
    files = [p for p in (MOTION / "src").rglob("*") if p.is_file()] + [MOTION / "render.mjs"] if (MOTION / "src").exists() else []
    h = hashlib.sha1()
    for p in sorted(files):
        st = p.stat()
        h.update(f"{p}:{st.st_size}:{st.st_mtime}".encode())
    return h.hexdigest()[:12]


def theme_props(brand):
    """Brand/theme colours + fonts -> Remotion `theme` / `font` props (brand `motion:` overrides win)."""
    from .text import color
    pal = brand.get("colors", {})

    def hexc(name, default):
        v = pal.get(name, default)
        try:
            r, g, b, _ = color(v, pal)
            return f"#{r:02X}{g:02X}{b:02X}"
        except Exception:
            return default

    theme = {"bg": hexc("dark", "#0E0416"), "fg": hexc("text", "#FFFFFF"), "accent": hexc("accent", "#61F0EA"),
             "accent2": hexc("accent2", "#B28CFF"), "muted": hexc("muted", "#9A8FB0"), "glow": hexc("glow", hexc("accent", "#7C5CFF"))}
    m = brand.get("motion", {}) or {}
    theme.update(m.get("theme", {}))
    f = brand.get("fonts", {}).get("display", {"family": "TikTok Sans", "weight": 800})
    font = {"family": f.get("family", "TikTok Sans"), "weight": f.get("weight", 800)}
    font.update(m.get("font", {}))
    out = {"theme": theme, "font": font}
    if m.get("font2"):
        out["font2"] = m["font2"]
    return out


def _resolve_files(v, spec):
    from .timeline import resolve_file
    if isinstance(v, dict):
        return {k: _resolve_files(x, spec) for k, x in v.items()}
    if isinstance(v, list):
        return [_resolve_files(x, spec) for x in v]
    if isinstance(v, str) and Path(v).suffix.lower() in IMAGE_EXT and not v.startswith("http"):
        p = resolve_file(v, spec)
        if Path(p).exists():
            return str(Path(p).resolve())
    return v


def job(item, W, H, fps, dur, spec):
    props = {**theme_props(spec["brand"]), **_resolve_files(item.get("props") or {}, spec)}
    cat = catalog() or {}
    logo = Path(spec["brand"].get("_dir", "")) / spec["brand"].get("logo", "logo.png")
    if "logo" in (cat.get(item["id"], {}).get("props") or {}) and not props.get("logo") and logo.is_file():
        props["logo"] = str(logo.resolve())            # brand app icon for end cards / logo stamps
    props.update(width=W, height=H, fps=fps, duration=round(dur, 4), transparent=bool(item.get("transparent", True)))
    key = hashlib.sha1(json.dumps([item["id"], props, _stamp()], sort_keys=True, default=str).encode()).hexdigest()[:16]
    return {"id": item["id"], "props": props, "out": str(cache_dir("motion") / f"{item['id']}_{key}.mov")}


def render_jobs(jobs, quiet=False):
    todo = [j for j in jobs if not Path(j["out"]).exists()]
    if not todo:
        return
    if not available():
        raise RuntimeError("motion looks need the Remotion library: cd motion && npm install")
    f = cache_dir("motion") / "jobs.json"
    f.write_text(json.dumps(todo, indent=1))
    if not quiet:
        print(f"motion: rendering {len(todo)} Remotion layer(s) ({', '.join(j['id'] for j in todo)})...", flush=True)
    p = subprocess.run(["node", "render.mjs", "--jobs", str(f)], cwd=MOTION, capture_output=True, text=True)
    if p.returncode != 0:
        tail = (p.stderr or p.stdout).strip().splitlines()[-12:]
        raise RuntimeError("motion render failed:\n  " + "\n  ".join(tail))
    missing = [j["out"] for j in todo if not Path(j["out"]).exists()]
    if missing:
        raise RuntimeError(f"motion render produced no file for: {missing}")


def prepare(spec, plan):
    """Render (cached) every motion clip / overlay of a plan at full output size; attach motion_file."""
    W, H, F = spec["output"]["W"], spec["output"]["H"], plan["fps"]
    jobs = []
    for seg in plan["segments"]:
        if seg["kind"] == "motion":
            j = job(seg["motion"], W, H, F, seg["n"] / F, spec)
            seg["motion_file"] = j["out"]
            jobs.append(j)
    for ov in plan["overlays"]:
        if ov["kind"] == "motion":
            j = job(ov["motion"], W, H, F, max(1, ov["end"] - ov["start"]) / F, spec)
            ov["motion_file"] = j["out"]
            jobs.append(j)
    if jobs:
        render_jobs(jobs)
    return len(jobs)


def clear_cache():
    d = CACHE / "motion"
    n = 0
    for p in d.glob("*.mov"):
        p.unlink()
        n += 1
    return n
