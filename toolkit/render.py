"""Render a spec: plan -> motion layers -> (captions from VO) -> frames (parallel chunks) -> audio mix ->
mux -> subtitles + contact sheet."""
import json
import multiprocessing as mp
import os
import shutil
import subprocess
import time
from pathlib import Path

from . import audio as audiomod
from . import motion
from . import spec as specmod
from . import timeline
from .compositor import Renderer
from .contactsheet import video_sheet
from .media import FFMPEG, proxy, run, still
from .paths import HISTORY, ROOT, WORK, WORKSPACE, work_dir


def project_name(spec):
    d = spec["dir"]
    return d.name if d.parent == HISTORY else spec["name"]


def auto_jobs(total_frames):
    cpu = os.cpu_count() or 4
    if total_frames < 120:
        return 1
    return max(1, min(6, cpu // 2, total_frames // 90))


def _warm(spec, plan, preview):
    """Build proxies / font index once in the parent so parallel workers never race on caches."""
    from .text import font_index
    font_index()
    pscale = 0.5 if preview else 1.0
    seen = set()
    for seg in plan["segments"]:
        if seg.get("src") and seg["src"] not in seen:
            seen.add(seg["src"])
            path = spec["sources"][seg["src"]]["path"]
            if seg["kind"] in ("video", "still"):
                proxy(path, pscale)
            if seg["layout"].get("type") == "iphone":
                still(path, 0.0, 1.0)
    for ov in plan["overlays"]:
        if ov["kind"] == "video" and ov["src"] not in seen:
            seen.add(ov["src"])
            proxy(spec["sources"][ov["src"]]["path"], pscale)
            still(spec["sources"][ov["src"]]["path"], 0.0, 1.0)


def _chunk(args):
    spec_path, variant, aspect, preview, safezones, words, g0, g1, out, threads = args
    spec = specmod.load(spec_path, variant=variant, aspect=aspect)
    plan = timeline.build(spec, scale=0.5 if preview else 1.0)
    motion.prepare(spec, plan)
    r = Renderer(spec, plan, preview=preview, show_safezones=safezones, caption_words=words)
    r.encode(out, preview=preview, progress=False, g0=g0, g1=g1, threads=threads)
    return r.warnings


def encode_parallel(spec, plan, r, out, preview, safezones, words, jobs, work):
    total = plan["total"]
    step = 2 if preview else 1
    bounds = [0]
    for i in range(1, jobs):
        b = int(round(total * i / jobs))
        b -= b % max(2, step)          # chunk starts on an even frame (preview renders every 2nd frame)
        if b > bounds[-1]:
            bounds.append(b)
    bounds.append(total)
    cdir = work / "chunks"
    shutil.rmtree(cdir, ignore_errors=True)
    cdir.mkdir(parents=True)
    threads = max(2, (os.cpu_count() or 4) // len(bounds[:-1]))
    tasks = [(str(spec["path"]), spec.get("variant"), spec["output"]["aspect"] if spec.get("_aspect_override") else None, preview,
              safezones, words, a, b, str(cdir / f"c{i:02d}.mp4"), threads) for i, (a, b) in enumerate(zip(bounds, bounds[1:]))]
    print(f"  {len(tasks)} parallel chunks x {threads} encoder threads", flush=True)
    ctx = mp.get_context("spawn")
    warnings = []
    with ctx.Pool(len(tasks)) as pool:
        for i, w in enumerate(pool.imap(_chunk, tasks)):
            warnings += w
            print(f"  chunk {i + 1}/{len(tasks)} done", flush=True)
    lst = cdir / "list.txt"
    lst.write_text("".join(f"file '{t[8]}'\n" for t in tasks))
    run([FFMPEG, "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", "-movflags", "+faststart", str(out)])
    shutil.rmtree(cdir, ignore_errors=True)
    r.warnings += warnings


def find_pops(video, plan, fps):
    """One-frame pops: a frame that differs from BOTH neighbours while the neighbours match each other (a flash of a
    wrong layer, a text frame out of order, a transition that skips). Cuts don't count: after a cut the next frames
    match the new shot. Returns warning strings."""
    import numpy as np
    w, h = 96, max(2, int(round(96 * plan["H"] / plan["W"] / 2)) * 2)
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", str(video), "-vf", f"scale={w}:{h},format=gray", "-f", "rawvideo", "-"],
                         capture_output=True).stdout
    n = len(raw) // (w * h)
    if n < 3:
        return []
    f = np.frombuffer(raw[:n * w * h], np.uint8).reshape(n, h, w).astype(np.float32)
    d1 = np.abs(f[1:] - f[:-1]).mean(axis=(1, 2))            # i-1 -> i
    d2 = np.abs(f[2:] - f[:-2]).mean(axis=(1, 2))            # i-1 -> i+1
    out = []
    for i in range(1, n - 1):
        a, b, c = d1[i - 1], d1[i], d2[i - 1]
        if min(a, b) > 2.5 and min(a, b) > 3 * max(c, 0.8):
            t = i / fps
            sec = next((s["name"] for s in plan["sections"] if s["start"] / plan["fps"] <= t < s["end"] / plan["fps"]), "?")
            out.append(f"one-frame pop at {t:.2f}s (section {sec}): that frame differs from both neighbours; check it with --frames {t:.2f}")
    if len(out) > 6:
        out = out[:6] + [f"... and {len(out) - 6} more one-frame pops"]
    return out


def write_srt(words, path, max_words=6):
    from . import captions as capmod
    chunks = capmod.chunk(words, max_words=max_words, max_chars=42)

    def ts(t):
        ms = int(round(max(0.0, t) * 1000))         # round once, then carry (14.9999 s -> 00:00:15,000, not 14,000)
        h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    lines = []
    for i, c in enumerate(chunks, 1):
        lines += [str(i), f"{ts(c['start'])} --> {ts(c['end'])}", " ".join(w["w"] for w in c["words"]), ""]
    Path(path).write_text("\n".join(lines))
    return path


def render(spec_path, preview=False, show_safezones=False, frames=None, no_audio=False, out=None, stems=False,
           variant=None, aspect=None, jobs=None):
    t0 = time.time()
    spec = specmod.load(spec_path, variant=variant, aspect=aspect)
    spec["_aspect_override"] = bool(aspect)
    plan = timeline.build(spec, scale=0.5 if preview else 1.0)  # preview: same timing, every other frame
    print(timeline.describe(plan))
    work = work_dir(project_name(spec))
    n_motion = motion.prepare(spec, plan)
    if n_motion:
        print(f"motion: {n_motion} Remotion layer(s) ready")
    words = None
    if spec.get("captions") and spec["captions"].get("enabled", True) and (spec["audio"] or {}).get("voiceover"):
        print("captions: transcribing voice-over (cached after the first run)...")
        words = audiomod.vo_words(spec)
    r = Renderer(spec, plan, preview=preview, show_safezones=show_safezones, caption_words=words)

    if spec["output"].get("carousel") and not frames:
        return render_carousel(spec, plan, r, work, out)

    if frames:  # quick stills
        fdir = work / "frames"
        fdir.mkdir(exist_ok=True)
        want = {min(plan["total"] - 1, int(round(float(t) * plan["fps"]))): t for t in frames}
        paths = []
        _, post = r.look_filters()
        for g, fr in r.frames(only=set(want)):
            p = fdir / f"t{g / plan['fps']:06.2f}{'_' + variant if variant else ''}{'_' + aspect.replace(':', 'x') if aspect else ''}.png"
            fr.save(p)
            if post:
                tmp = p.with_name(p.stem + "_look.png")
                run([FFMPEG, "-v", "error", "-y", "-i", str(p), "-vf", f"format=yuv444p,{post},format=rgb24", str(tmp)])
                tmp.replace(p)
            paths.append(str(p))
        for p in paths:
            print(f"frame: {p}")
        _print_warnings(spec, plan, r, None)
        return paths

    stem = Path(out or spec["output"]["file"]).stem
    if preview:
        final = work / "previews" / f"{stem}_preview.mp4"
    else:
        final = Path(out) if out else spec["output"]["file"]
    final.parent.mkdir(parents=True, exist_ok=True)
    vtmp = work / ("video_preview.mp4" if preview else "video_only.mp4")
    nfr = plan["total"] // (2 if preview else 1)
    print(f"rendering {nfr} frames ({plan['W']}x{plan['H']} @ {plan['fps'] / (2 if preview else 1):g} fps){' [preview]' if preview else ''}...")
    j = jobs if jobs is not None else auto_jobs(plan["total"])
    if j > 1:
        _warm(spec, plan, preview)
        encode_parallel(spec, plan, r, vtmp, preview, show_safezones, words, j, work)
    else:
        r.encode(vtmp, preview=preview)
    rep = {}
    if no_audio:
        shutil.copy(vtmp, final)
    else:
        wav = work / ("mix_preview.wav" if preview else "mix.wav")
        rep = audiomod.mix(spec, plan, wav, stems_dir=(work / "stems") if stems else None)
        run([FFMPEG, "-v", "error", "-y", "-i", str(vtmp), "-i", str(wav), "-map", "0:v", "-map", "1:a", "-c:v", "copy",
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(final)])
    srt = None
    if words and not preview and spec["output"].get("srt", True):
        srt = write_srt(words, final.with_suffix(".srt"))
    r.warnings += find_pops(vtmp, plan, plan["fps"] / (2 if preview else 1))
    sheets = video_sheet(final, work / f"contact_{stem}{'_preview' if preview else ''}.jpg", every=0.5 if plan["total"] / plan["fps"] <= 60 else 1.0)
    report = {"output": str(final), "duration": round(plan["total"] / plan["fps"], 3), "size": f"{plan['W']}x{plan['H']}",
              "fps": plan["fps"] / (2 if preview else 1), "audio": rep, "contact_sheets": sheets, "seconds": round(time.time() - t0, 1),
              "subtitles": str(srt) if srt else None, "jobs": j}
    (work / f"render_{stem}{'_preview' if preview else ''}.json").write_text(json.dumps(report, indent=1, default=str))
    in_repo_tests = any(spec["dir"].is_relative_to(d) for d in (ROOT / "examples", WORKSPACE / "examples", WORK))
    if not preview and spec["dir"].parent != HISTORY and not in_repo_tests:  # archive ad-hoc specs
        hdir = HISTORY / f"{time.strftime('%Y-%m-%d')}_{spec['name']}"
        hdir.mkdir(parents=True, exist_ok=True)
        shutil.copy(spec["path"], hdir / "spec.yaml")
    print(f"\noutput: {final}")
    print(f"duration {report['duration']}s  {report['size']} @ {report['fps']:g} fps   rendered in {report['seconds']}s ({j} job{'s' if j > 1 else ''})")
    if rep.get("loudness") is not None:
        print(f"audio: {rep['loudness']} LUFS (target {spec['output']['loudness']}), peak {rep['peak_db']} dBFS; tracks: {', '.join(rep['tracks'])}")
        if rep.get("voiceover", {}).get("removed_s"):
            print(f"voice-over: {rep['voiceover']['removed_s']}s of pauses removed, speed {rep['voiceover']['speed']}x")
    if srt:
        print(f"subtitles: {srt}")
    for s in sheets:
        print(f"contact sheet: {s}")
    _print_warnings(spec, plan, r, rep)
    return report


def render_carousel(spec, plan, r, work, out=None):
    """output.carousel: one still slide per section (the settled moment near its end), numbered, in a folder next to
    where the video would go. Section `slide_at` (seconds) picks the moment; `carousel.at` (fraction, default 0.95).
    Exit fades and exit animations are switched off, so every slide shows its finished state."""
    from PIL import Image
    car = spec["output"]["carousel"] if isinstance(spec["output"]["carousel"], dict) else {}
    fmt, at, q = car.get("format", "jpg"), float(car.get("at", 0.95)), int(car.get("quality", 93))
    F, secs = plan["fps"], plan["sections"]
    for s in secs:                                            # a slide is the settled state: no exit fades or exits
        s["anim"] = dict(s["anim"], out=0, out_effect=None)
    for ov in plan["overlays"]:
        ov["fade_out"] = 0.0
        if ov.get("anim"):
            ov["anim"] = dict(ov["anim"], out=None)
    want = {}
    for i, s in enumerate(secs):
        sec_spec = spec["timeline"][i] if i < len(spec["timeline"]) else {}
        nxt = secs[i + 1]["start"] if i + 1 < len(secs) else plan["total"]
        last = min(s["end"], nxt) - 1                         # never inside the next slide's transition
        g = s["start"] + int(round(float(sec_spec["slide_at"]) * F)) if sec_spec.get("slide_at") is not None \
            else s["start"] + int((s["end"] - s["start"]) * at)
        want[max(s["start"], min(g, last))] = i
    stem = Path(out or spec["output"]["file"]).stem
    odir = (Path(out).parent if out else spec["output"]["file"].parent) / f"{stem}_carousel"
    shutil.rmtree(odir, ignore_errors=True)
    odir.mkdir(parents=True)
    _, post = r.look_filters()
    paths = {}
    print(f"rendering {len(want)} carousel slides ({plan['W']}x{plan['H']})...")
    for g, fr in r.frames(only=set(want)):
        i = want[g]
        p = odir / f"{stem}_{i + 1:02d}.{fmt}"
        tmp = odir / f"_t{i:02d}.png"
        fr.convert("RGB").save(tmp)
        if post:
            run([FFMPEG, "-v", "error", "-y", "-i", str(tmp), "-vf", f"format=yuv444p,{post},format=rgb24", str(tmp.with_suffix(".g.png"))])
            tmp.with_suffix(".g.png").replace(tmp)
        im = Image.open(tmp).convert("RGB")
        im.save(p, "JPEG", quality=q, optimize=True) if fmt == "jpg" else im.save(p)
        tmp.unlink()
        paths[i] = p
    files = [paths[i] for i in sorted(paths)]
    tw = 270
    th = int(tw * plan["H"] / plan["W"])
    sheet = Image.new("RGB", (min(len(files), 5) * (tw + 8) + 8, ((len(files) + 4) // 5) * (th + 8) + 8), (40, 40, 44))
    for k, f in enumerate(files):
        sheet.paste(Image.open(f).resize((tw, th)), (8 + (k % 5) * (tw + 8), 8 + (k // 5) * (th + 8)))
    sp = work / f"carousel_{stem}.jpg"
    sheet.save(sp, quality=90)
    print(f"\ncarousel: {odir}  ({len(files)} slides, {plan['W']}x{plan['H']})")
    for f in files:
        print(f"  {f.name}")
    print(f"contact sheet: {sp}")
    _print_warnings(spec, plan, r, None)
    return {"output": str(odir), "slides": [str(f) for f in files], "contact_sheets": [str(sp)]}


def _print_warnings(spec, plan, r, rep):
    ws = list(plan["warnings"]) + list(r.warnings) + list((rep or {}).get("warnings", []))
    if ws:
        print("\nwarnings:")
        seen = set()
        for w in ws:
            if w not in seen:
                seen.add(w)
                print(f"  ! {w}")
