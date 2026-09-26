"""Render a spec: plan -> motion layers -> (captions from VO) -> frames (parallel chunks) -> audio mix ->
mux -> subtitles + contact sheet."""
import json
import multiprocessing as mp
import os
import shutil
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


def _print_warnings(spec, plan, r, rep):
    ws = list(plan["warnings"]) + list(r.warnings) + list((rep or {}).get("warnings", []))
    if ws:
        print("\nwarnings:")
        seen = set()
        for w in ws:
            if w not in seen:
                seen.add(w)
                print(f"  ! {w}")
