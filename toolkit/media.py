"""Probing, CFR proxies, frame reading and audio decoding (all via ffmpeg)."""
import hashlib
import json
import subprocess
from fractions import Fraction
from pathlib import Path

import numpy as np
from PIL import Image

from .paths import FFMPEG, FFPROBE, MEDIA_AUDIO, MEDIA_IMAGE, MEDIA_VIDEO, cache_dir

SR = 48000  # audio sample rate used everywhere


def run(cmd, **kw):
    """Run a command, raising a readable error with ffmpeg's stderr tail."""
    p = subprocess.run(cmd, capture_output=True, **kw)
    if p.returncode != 0:
        err = p.stderr.decode(errors="replace").strip().splitlines()[-6:]
        raise RuntimeError(f"{Path(cmd[0]).name} failed ({p.returncode}):\n  " + "\n  ".join(err))
    return p


def kind_of(path):
    ext = Path(path).suffix.lower()
    if ext in MEDIA_VIDEO:
        return "video"
    if ext in MEDIA_AUDIO:
        return "audio"
    if ext in MEDIA_IMAGE:
        return "image"
    return "other"


_probe_cache = {}


def probe(path):
    """Duration, display size, fps (avg + nominal), VFR flag, audio info, colour, rotation."""
    path = str(path)
    st = Path(path).stat()
    key = (path, st.st_size, st.st_mtime)
    if key in _probe_cache:
        return _probe_cache[key]
    p = run([FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path])
    d = json.loads(p.stdout)
    fmt = d.get("format", {})
    v = next((s for s in d["streams"] if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    a = next((s for s in d["streams"] if s["codec_type"] == "audio"), None)
    info = {
        "path": path,
        "kind": kind_of(path),
        "duration": float(fmt.get("duration") or 0),
        "size_mb": round(st.st_size / 1e6, 2),
        "has_video": v is not None,
        "has_audio": a is not None,
    }
    if v is not None:
        w, h = int(v["width"]), int(v["height"])
        rot = 0
        for sd in v.get("side_data_list", []) or []:
            if "rotation" in sd:
                rot = int(sd["rotation"])
        rot = int(v.get("tags", {}).get("rotate", rot))
        if abs(rot) % 180 == 90:
            w, h = h, w
        avg = _frac(v.get("avg_frame_rate"))
        nom = _frac(v.get("r_frame_rate"))
        info.update({
            "width": w, "height": h, "rotation": rot,
            "fps": round(avg or nom or 0, 3),
            "fps_nominal": round(nom or 0, 3),
            "vfr": bool(avg and nom and abs(avg - nom) / nom > 0.02),
            "codec": v.get("codec_name"),
            "pix_fmt": v.get("pix_fmt"),
            "color_range": v.get("color_range"),
            "color_space": v.get("color_space"),
            "color_transfer": v.get("color_transfer"),
            "hdr": v.get("color_transfer") in ("arib-std-b67", "smpte2084"),
            "frames": int(v.get("nb_frames") or 0),
        })
        if info["kind"] == "image" or info["duration"] == 0:
            info["duration"] = 0.0
    if a is not None:
        info.update({"audio_codec": a.get("codec_name"), "sample_rate": int(a.get("sample_rate", 0)),
                     "channels": int(a.get("channels", 0))})
    _probe_cache[key] = info
    return info


def _frac(s):
    try:
        f = Fraction(s)
        return float(f) if f else None
    except Exception:
        return None


def _key(*parts):
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def proxy_fps(info):
    """Frame rate used for the CFR proxy of a source."""
    f = info.get("fps") or 30
    if f > 31 or info.get("vfr"):  # VFR (screen recordings): average fps is low but motion bursts at 60-120
        return 60
    for std in (23.976, 24, 25, 29.97, 30):
        if abs(f - std) < 0.2:
            return std
    return round(f)


def proxy(path, scale=1.0):
    """Constant-frame-rate, tv-range BT.709 H.264 proxy (cached). Returns (path, fps, w, h).

    Screen recordings are variable-frame-rate and full-range; converting once makes every
    later frame lookup exact (frame i == time i/fps) and colour handling uniform.
    """
    info = probe(path)
    fps = proxy_fps(info)
    w = int(round(info["width"] * scale / 2) * 2)
    h = int(round(info["height"] * scale / 2) * 2)
    st = Path(path).stat()
    out = cache_dir("proxies") / f"{Path(path).stem[:40]}_{_key(path, st.st_size, st.st_mtime, fps, w, h)}.mp4"
    if not out.exists():
        tmp = out.with_suffix(".tmp.mp4")
        vf = [f"fps={fps}", f"scale={w}:{h}:flags=lanczos:out_range=tv:out_color_matrix=bt709", "format=yuv420p"]
        if info.get("hdr"):
            print(f"  ! {Path(path).name} is HDR ({info['color_transfer']}); converting without tone mapping")
        run([FFMPEG, "-v", "error", "-y", "-i", str(path), "-an", "-vf", ",".join(vf),
             "-c:v", "libx264", "-preset", "fast", "-crf", "10", "-g", "30",
             "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
             str(tmp)])
        tmp.rename(out)
    return str(out), fps, w, h


def read_frames(path, w, h, start_idx, count, fps):
    """Yield `count` RGB frames (numpy HxWx3) starting at frame index `start_idx` of a CFR file."""
    ss = max(0.0, (start_idx - 0.25) / fps)
    cmd = [FFMPEG, "-v", "error", "-ss", f"{ss:.6f}", "-i", str(path), "-frames:v", str(count),
           "-vf", "scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgb24",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    size = w * h * 3
    try:
        while True:
            buf = p.stdout.read(size)
            if len(buf) < size:
                break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    finally:
        p.stdout.close()
        p.kill()
        p.wait()


def still(path, t=0.0, scale=1.0):
    """One frame of a video (or an image file) as a PIL RGB image."""
    if kind_of(path) == "image":
        im = Image.open(path).convert("RGB")
        if scale != 1.0:
            im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        return im
    pth, fps, w, h = proxy(path, scale)
    idx = int(round(t * fps))
    fr = next(read_frames(pth, w, h, idx, 1, fps), None)
    if fr is None:  # past the end: take the last frame
        n = int(probe(pth)["duration"] * fps)
        fr = next(read_frames(pth, w, h, max(0, n - 2), 1, fps))
    return Image.fromarray(fr.copy())


def decode_audio(path, sr=SR, start=None, dur=None):
    """Decode any audio/video file's audio to float32 stereo (n, 2)."""
    cmd = [FFMPEG, "-v", "error"]
    if start:
        cmd += ["-ss", str(start)]
    cmd += ["-i", str(path)]
    if dur:
        cmd += ["-t", str(dur)]
    cmd += ["-vn", "-ac", "2", "-ar", str(sr), "-f", "f32le", "-"]
    p = run(cmd)
    return np.frombuffer(p.stdout, np.float32).reshape(-1, 2).copy()


def write_wav(path, x, sr=SR):
    """float (n,2) -> 24-bit WAV via ffmpeg."""
    x = np.ascontiguousarray(np.clip(x, -1, 1).astype(np.float32))
    run([FFMPEG, "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", "2", "-i", "-",
         "-c:a", "pcm_s24le", str(path)], input=x.tobytes())


def motion_profile(path, fps=10, size=(66, 144)):
    """Mean absolute frame difference per step (screen activity). Returns (times, values)."""
    w, h = size
    p = run([FFMPEG, "-v", "error", "-i", str(path), "-vf", f"fps={fps},scale={w}:{h}", "-f", "rawvideo",
             "-pix_fmt", "gray", "-"])
    a = np.frombuffer(p.stdout, np.uint8)
    n = len(a) // (w * h)
    a = a[: n * w * h].reshape(n, h, w).astype(np.float32)
    if n < 2:
        return np.array([]), np.array([])
    d = np.abs(np.diff(a, axis=0)).mean(axis=(1, 2))
    t = (np.arange(1, n)) / fps
    return t, d


def activity_segments(t, d, thresh=1.2, min_idle=0.5):
    """Split a motion profile into active/idle segments (idle = nothing changing on screen)."""
    if len(t) == 0:
        return []
    step = t[1] - t[0] if len(t) > 1 else 0.1
    active = d > thresh
    segs, cur, s0 = [], active[0], 0.0
    for i in range(1, len(active)):
        if active[i] != cur:
            segs.append([cur, s0, float(t[i - 1])])
            cur, s0 = active[i], float(t[i - 1])
    segs.append([cur, s0, float(t[-1]) + step])
    # merge short idles into neighbours
    out = []
    for a, s, e in segs:
        if not a and e - s < min_idle and out:
            out[-1][2] = e
            continue
        if out and out[-1][0] == a:
            out[-1][2] = e
        else:
            out.append([a, s, e])
    return [{"state": "active" if a else "idle", "start": round(s, 2), "end": round(e, 2)} for a, s, e in out]


def read_rgba(path, w=None, h=None, start_idx=0, fps=None):
    """Yield RGBA frames (numpy HxWx4) of a video with alpha (ProRes 4444 / WebM / PNG sequence),
    optionally scaled to w x h, starting at output frame `start_idx`. With `fps` (the output rate), frames are
    picked by time, so a 30 fps layer plays at the right speed in a 15 fps preview (and a 24 fps one in 30)."""
    cmd = [FFMPEG, "-v", "error"]
    if start_idx and fps:
        cmd += ["-ss", f"{max(0.0, (start_idx - 0.25) / fps):.6f}"]
    cmd += ["-i", str(path)]
    info = probe(path)
    W, H = w or info["width"], h or info["height"]
    vf = f"scale={W}:{H}:flags=lanczos,format=rgba" if (W, H) != (info["width"], info["height"]) else "format=rgba"
    cmd += ["-vf", vf, "-f", "rawvideo", "-pix_fmt", "rgba", "-"]
    ratio = (info.get("fps_nominal") or info.get("fps") or fps) / fps if fps else 1.0
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    size = W * H * 4
    try:
        n = j = 0                                  # source frames read / output frames yielded
        while True:
            buf = p.stdout.read(size)
            if len(buf) < size:
                break
            fr = None
            while round(j * ratio) <= n:           # this source frame covers output frame j (repeat when upsampling)
                if fr is None:
                    fr = np.frombuffer(buf, np.uint8).reshape(H, W, 4)
                yield fr
                j += 1
            n += 1
    finally:
        p.stdout.close()
        p.kill()
        p.wait()
