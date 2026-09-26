"""Audio mix: voice-over (pause tightening, pitch-safe speed), music (file or generated, auto-ducked
under the VO), sound effects, clip audio; then loudness normalisation to the target LUFS."""
import hashlib
import json
import re
from pathlib import Path

import numpy as np

from . import synth
from .media import FFMPEG, SR, decode_audio, probe, run, write_wav
from .paths import cache_dir


def db(x):
    return 10 ** (x / 20.0)


FX = {  # voice / track effects (ffmpeg audio filter chains)
    "phone": "highpass=f=320,lowpass=f=3300,acompressor=threshold=0.08:ratio=6:attack=4:release=60:makeup=2,"
             "acrusher=bits=11:mode=log:aa=1:mix=0.12",
    "small_speaker": "highpass=f=520,lowpass=f=5200,acompressor=threshold=0.1:ratio=4:attack=5:release=80:makeup=1.6",
    "radio": "highpass=f=420,lowpass=f=2700,acompressor=threshold=0.08:ratio=8:attack=3:release=50:makeup=2.5,"
             "acrusher=bits=9:mode=log:aa=1:mix=0.18",
    "walkie": "highpass=f=520,lowpass=f=2400,acompressor=threshold=0.05:ratio=10:attack=2:release=40:makeup=3,"
              "acrusher=bits=7:mode=log:aa=1:mix=0.3",
    "megaphone": "highpass=f=650,lowpass=f=3200,acompressor=threshold=0.05:ratio=12:attack=2:release=40:makeup=4,"
                 "acrusher=bits=6:mode=log:aa=1:mix=0.35",
    "cabin": "highpass=f=380,lowpass=f=4300,equalizer=f=1800:t=q:w=1.2:g=4,"          # aircraft PA: small ceiling
             "acompressor=threshold=0.07:ratio=7:attack=3:release=60:makeup=2.4,"      # speakers, squashed, a touch of
             "acrusher=bits=10:mode=log:aa=1:mix=0.1,aecho=0.9:0.6:14|29:0.22|0.12",  # grit, short cabin reflections
    "reverb": "aecho=0.85:0.8:55|110:0.32|0.22",
    "hall": "aecho=0.8:0.88:120|240|380:0.38|0.28|0.18",
    "underwater": "lowpass=f=520,aecho=0.8:0.7:30:0.4",
    "whisper": "highpass=f=250,volume=2dB",
}


def apply_fx(x, fx):
    """Run audio (n, 2) through a named effect chain (cached by content)."""
    if not fx or fx == "none":
        return x
    tmp = cache_dir("audio") / f"fx_{fx}_{_hash(fx, len(x), float(np.abs(x).sum()))}"
    out = Path(f"{tmp}_out.wav")
    if not out.exists():
        write_wav(f"{tmp}_in.wav", x)
        run([FFMPEG, "-v", "error", "-y", "-i", f"{tmp}_in.wav", "-af", FX[fx], "-ar", str(SR), "-ac", "2", str(out)])
        Path(f"{tmp}_in.wav").unlink()
    y = decode_audio(out)
    if len(y) < len(x):
        y = np.concatenate([y, np.zeros((len(x) - len(y), 2))])
    return y[: max(len(x), len(y))]


def _hash(*parts):
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:16]


def _fade(x, fin, fout):
    n = len(x)
    if fin:
        k = min(n, int(fin * SR))
        x[:k] *= np.linspace(0, 1, k)[:, None]
    if fout:
        k = min(n, int(fout * SR))
        x[n - k:] *= np.linspace(1, 0, k)[:, None]
    return x


def _place(dst, x, t, gain=1.0):
    i = int(round(t * SR))
    if i >= len(dst) or len(x) == 0:
        return
    j0 = max(0, -i)
    n = min(len(x), len(dst) - i)
    if n > j0:
        dst[i + j0:i + n] += x[j0:n] * gain


def _rms_env(x, win=0.02):
    m = x.mean(1) if x.ndim == 2 else x
    h = int(win * SR)
    n = len(m) // h
    r = np.sqrt((m[: n * h].reshape(n, h) ** 2).mean(1) + 1e-12)
    return 20 * np.log10(r), h


def silences(x, below_db=30, min_len=0.12):
    """[(start, end)] seconds quieter than `below_db` under the file's loud (99th pct) level."""
    env, h = _rms_env(x)
    ref = np.percentile(env, 99)
    quiet = env < ref - below_db
    out, s = [], None
    for i, q in enumerate(quiet):
        if q and s is None:
            s = i
        elif not q and s is not None:
            if (i - s) * h / SR >= min_len:
                out.append((s * h / SR, i * h / SR))
            s = None
    if s is not None and (len(quiet) - s) * h / SR >= min_len:
        out.append((s * h / SR, len(quiet) * h / SR))
    return out


class TimeMap:
    """Piecewise-linear map from original VO time to output time (optionally followed by another map)."""

    def __init__(self):
        self.src, self.dst = [0.0], [0.0]
        self.then = None

    def __call__(self, t):
        v = float(np.interp(t, self.src, self.dst))
        return self.then(v) if self.then else v


def _norm_word(w):
    return re.sub(r"[^a-z0-9']", "", w.lower().replace("\u2019", "'"))


def _gap_near(y, t, before=0.6, after=0.8, min_len=0.12):
    """(onset, offset of the previous word) around time t: the silence (>= min_len, so not a stop consonant) nearest
    to t in the audio. Cutting there never splits a word, even when the transcript's word times are off.
    Falls back to (t, None) when no silence is found."""
    a0, a1 = max(0.0, t - before), min(len(y) / SR, t + after)
    x = y[int(a0 * SR): int(a1 * SR)].mean(axis=1) if y.ndim == 2 else y[int(a0 * SR): int(a1 * SR)]
    hop = int(0.01 * SR)
    if len(x) < 4 * hop:
        return t, None
    lv = np.array([20 * np.log10(np.sqrt(np.mean(x[i:i + 2 * hop] ** 2)) + 1e-9) for i in range(0, len(x) - 2 * hop, hop)])
    quiet = lv < max(lv.max() - 30.0, -62.0)
    runs, start = [], None
    for i, q in enumerate(list(quiet) + [False]):
        if q and start is None:
            start = i
        elif not q and start is not None:
            if (i - start) * 0.01 >= min_len:
                runs.append((a0 + start * 0.01, a0 + i * 0.01 + 0.01))
            start = None
    if not runs:
        return t, None
    dist = lambda r: 0.0 if r[0] <= t <= r[1] else min(abs(t - r[0]), abs(t - r[1]))
    r = min(runs, key=lambda r: (round(dist(r), 2), -(r[1] - r[0])))
    return r[1], r[0]


def place_lines(y, tm, vo, info):
    """Move voice-over lines to set output times: vo.place = [{text: 'Open the app', at: 4.4}, ...].

    Each anchor's first word starts at `at`; everything up to the next anchor keeps its natural timing.
    Returns audio that starts at output time 0 and extends `tm` so words/captions follow.
    """
    from .analysis.voiceover import transcribe
    tr = transcribe(vo["file"], language=vo.get("language"), vocabulary=vo.get("_vocab"))
    words = tr["words"]
    wn = [_norm_word(w["w"]) for w in words]
    lead, tail, search, cuts, idxs, gaps = 0.06, 0.15, 0, [], [], []
    for p in vo["place"]:
        toks = [_norm_word(t) for t in str(p["text"]).split()]
        idx = next((i for i in range(search, len(wn) - len(toks) + 1) if wn[i:i + len(toks)] == toks), None)
        if idx is None:
            raise ValueError(f"voiceover.place: '{p['text']}' not found (in order) in the transcript: {tr['text']}")
        search = idx + len(toks)
        idxs.append(idx)
        on, off = _gap_near(y, tm(words[idx]["start"]))   # the real silence before the line (Whisper can be 0.2 s off)
        cuts.append((max(0.0, on - lead), float(p["at"]) - lead))
        gaps.append(off)
    dur = len(y) / SR
    bounds = [0.0] + [c for c, _ in cuts] + [dur]
    targets = [float(vo.get("start", 0.0))] + [t for _, t in cuts]
    # each line ends just after its last word (its trailing silence is replaced by the placement gap)
    ends = [min(bounds[k + 1], (gaps[k] if gaps[k] is not None else tm(words[i - 1]["end"])) + tail) if i > 0 else bounds[k + 1]
            for k, i in enumerate(idxs)] + [dur]
    out = np.zeros((int((max(targets) + dur + 1) * SR), 2))
    pm = TimeMap()
    pm.src, pm.dst = [], []
    prev_end, fx = 0.0, int(0.005 * SR)
    for k in range(len(targets)):
        a, b = bounds[k], max(bounds[k], ends[k])
        if b - a <= 0.001:
            continue
        t0 = targets[k]
        if t0 < prev_end - 1e-3:
            info.setdefault("warnings", []).append(
                f"voice-over line {k} wanted at {t0 + lead:.2f}s but the previous line ends at {prev_end + lead:.2f}s; placed right after")
            t0 = prev_end
        seg = y[int(a * SR): int(b * SR)].copy()
        if len(seg) > 2 * fx:
            seg[:fx] *= np.linspace(0, 1, fx)[:, None]
            seg[-fx:] *= np.linspace(1, 0, fx)[:, None]
        i0 = int(round(t0 * SR))
        out[i0:i0 + len(seg)] += seg
        if k > 0:                                  # where this line's first word really starts (for captions)
            info.setdefault("anchor_starts", {})[idxs[k - 1]] = t0 + lead
        pm.src += [a, b - 1e-6]
        pm.dst += [t0, t0 + (b - a) - 1e-6]
        prev_end = t0 + (b - a)
    tm.then = pm
    info["placed"] = len(cuts)
    return out[:int(prev_end * SR) + 1]


def denoise(path):
    """DeepFilterNet noise removal (optional install), cached. Returns the cleaned file path."""
    import os
    import shutil
    import sys
    st = Path(path).stat()
    out_dir = cache_dir("denoise") / _hash(path, st.st_size, st.st_mtime)
    done = list(out_dir.glob("*.wav")) if out_dir.exists() else []
    if done:
        return done[0]
    exe = Path(sys.executable).with_name("deepFilter")
    if not exe.exists():
        raise RuntimeError("voiceover.denoise needs DeepFilterNet: .venv/bin/pip install -r requirements-optional.txt")
    out_dir.mkdir(parents=True, exist_ok=True)
    src = out_dir / "vo_in.wav"
    run([FFMPEG, "-v", "error", "-y", "-i", str(path), "-ar", "48000", "-ac", "1", str(src)])
    run([str(exe), str(src), "-o", str(out_dir)], env={**os.environ, "HF_HUB_DISABLE_XET": "1"})
    src.unlink()
    return next(out_dir.glob("*.wav"))


def process_voiceover(vo, total_hint=None):
    """Returns (audio (n,2) starting at output time vo.start, TimeMap orig->output, info)."""
    x = decode_audio(denoise(vo["file"]) if vo.get("denoise") else vo["file"])
    trim = vo.get("trim")
    t_off = 0.0
    if trim:
        a, b = trim
        x = x[int(a * SR): int(b * SR) if b else None]
        t_off = a
    info = {"orig_dur": len(x) / SR}
    keep = [(0.0, len(x) / SR)]
    maxp = vo.get("max_pause")
    if maxp is not None:
        sil = silences(x)
        keep, cur = [], 0.0
        dur = len(x) / SR
        for s, e in sil:
            lead, tail = s <= 0.01, e >= dur - 0.01
            allow = 0.05 if lead else 0.25 if tail else maxp
            if e - s > allow:
                if lead:
                    cur = e - allow
                    continue
                cut_s = s + (allow / 2 if not tail else allow)
                cut_e = e - (allow / 2 if not tail else 0)
                if cut_e > cut_s:
                    keep.append((cur, cut_s))
                    cur = cut_e
        keep.append((cur, dur))
        keep = [(a, b) for a, b in keep if b - a > 0.005]
        info["removed_s"] = round(dur - sum(b - a for a, b in keep), 2)
    if vo.get("cut"):                              # drop whole ranges (e.g. a line), in seconds of the file
        for c0, c1 in vo["cut"]:
            c0, c1 = float(c0) - t_off, float(c1) - t_off
            keep = [seg for a, b in keep
                    for seg in ([(a, b)] if c1 <= a or c0 >= b else [(a, min(b, c0)), (max(a, c1), b)])
                    if seg[1] - seg[0] > 0.005]
        info["cut_s"] = round(sum(float(b) - float(a) for a, b in vo["cut"]), 2)
    pieces, tm, out_t = [], TimeMap(), 0.0
    tm.src, tm.dst = [], []
    xf = int(0.008 * SR)
    for a, b in keep:
        seg = x[int(a * SR): int(b * SR)].copy()
        if len(seg) > 2 * xf:
            seg[:xf] *= np.linspace(0, 1, xf)[:, None]
            seg[-xf:] *= np.linspace(1, 0, xf)[:, None]
        pieces.append(seg)
        tm.src += [a + t_off, b + t_off]
        tm.dst += [out_t, out_t + (b - a)]
        out_t += b - a
    y = np.concatenate(pieces) if pieces else x
    speed = float(vo.get("speed", 1.0))
    if abs(speed - 1.0) > 1e-3:
        tmp = cache_dir("audio") / f"vo_{_hash(vo['file'], speed, len(y))}"
        write_wav(f"{tmp}_in.wav", y)
        run([FFMPEG, "-v", "error", "-y", "-i", f"{tmp}_in.wav", "-af", f"rubberband=tempo={speed}:pitch=1:transients=smooth",
             "-ar", str(SR), "-ac", "2", f"{tmp}_out.wav"])
        y = decode_audio(f"{tmp}_out.wav")
        tm.dst = [d / speed for d in tm.dst]
    if vo.get("place"):
        y = place_lines(y, tm, vo, info)
        start = 0.0
    else:
        start = float(vo.get("start", 0.0))
        tm.dst = [d + start for d in tm.dst]
    if vo.get("fx"):
        y = apply_fx(y, vo["fx"])
    y = _fade(y * db(vo.get("volume", 0.0)), vo.get("fade_in", 0.01), vo.get("fade_out", 0.05))
    info.update(out_dur=round(len(y) / SR, 2), start=start, speed=speed)
    return y, tm, info


def vo_words(spec):
    """Transcript words mapped to output time (for captions), or None."""
    vo = (spec["audio"] or {}).get("voiceover")
    if not vo:
        return None
    from .analysis.voiceover import transcribe
    tr = transcribe(vo["file"], language=vo.get("language"), vocabulary=vo.get("_vocab"))
    _, tm, info = process_voiceover(vo)
    starts = info.get("anchor_starts") or {}
    words = []
    for i, w in enumerate(tr["words"]):
        if vo.get("trim") and (w["start"] < vo["trim"][0] or (vo["trim"][1] and w["end"] > vo["trim"][1])):
            continue
        mid = (w["start"] + w["end"]) / 2
        if any(float(c0) <= mid < float(c1) for c0, c1 in vo.get("cut") or []):
            continue
        st = starts.get(i, tm(w["start"]))         # placed lines: the audio onset, not the transcript's guess
        words.append({"w": w["w"], "start": st, "end": max(st + 0.05, tm(w["end"]))})
    return fix_words(words, (spec.get("captions") or {}).get("replace") or spec["brand"].get("caption_replace") or {})


def fix_words(words, repl):
    """Apply caption spelling fixes, e.g. {'Acme app': 'AcmeApp'} (may merge adjacent words)."""
    for bad, good in repl.items():
        parts = bad.lower().split()
        i = 0
        while i <= len(words) - len(parts):
            seq = [words[i + j]["w"].lower().strip(".,!?;:") for j in range(len(parts))]
            if seq == parts:
                tail = words[i + len(parts) - 1]["w"][len(words[i + len(parts) - 1]["w"].rstrip(".,!?;:")):]
                words[i:i + len(parts)] = [{"w": good + tail, "start": words[i]["start"], "end": words[i + len(parts) - 1]["end"]}]
            i += 1
    return words


def music_track(mu, total, brand_dir=None):
    if mu.get("generate") is not None:
        g = mu["generate"] or {}
        key = _hash(total, sorted(g.items()))
        f = cache_dir("music") / f"bed_{key}.wav"
        if not f.exists():
            y = synth.music_bed(total, bpm=g.get("bpm", 120), key=g.get("key", "D"), drop=g.get("drop", 0.0),
                                resolve=g.get("resolve"), seed=g.get("seed", 7))
            write_wav(f, y)
        x = decode_audio(f)
    else:
        x = decode_audio(mu["file"], start=mu.get("offset"))
    start = float(mu.get("start", 0.0))
    end = float(mu.get("end", total))
    need = int((end - start) * SR)
    if len(x) < need and mu.get("loop", True) and len(x) > SR:
        reps = int(np.ceil(need / len(x)))
        x = np.concatenate([x] * reps)
    x = x[:need].copy()
    x = _fade(x, mu.get("fade_in", 0.0), mu.get("fade_out", 1.0))
    return x * db(mu.get("volume", 0.0)), start


def duck_envelope(vo_audio, vo_start, n, depth_db, attack=0.08, release=0.35, lookahead=0.1):
    """Gain curve (n,) for music: depth_db under speech, 0 dB elsewhere, smoothed."""
    g = np.zeros(n)
    env, h = _rms_env(vo_audio, 0.02)
    speech = env > (np.percentile(env, 99) - 28)
    for i, s in enumerate(speech):
        if s:
            a = int(vo_start * SR) + i * h - int(lookahead * SR)
            g[max(0, a): max(0, a + h + int(lookahead * SR))] = 1.0
    # smooth: attack (rise) / release (fall) one-pole on a decimated grid
    step = 240
    gd = g[::step]
    out = np.zeros_like(gd)
    aa, ar = np.exp(-step / (attack * SR)), np.exp(-step / (release * SR))
    acc = 0.0
    for i, v in enumerate(gd):
        c = aa if v > acc else ar
        acc = c * acc + (1 - c) * v
        out[i] = acc
    sm = np.interp(np.arange(n), np.arange(len(out)) * step, out)
    return db(depth_db * sm)


def clip_audio(spec, plan):
    """Source audio of clips marked `audio: true|dB` (constant-speed clips only)."""
    tracks = []
    for seg in plan["segments"]:
        a = seg.get("audio")
        if a in (None, False) or seg["kind"] != "video":
            continue
        gain = 0.0 if a is True else float(a)
        src = spec["sources"][seg["src"]]
        if not src["info"].get("has_audio"):
            continue
        sp = seg.get("speed") or 1.0
        t0, t1 = float(seg["times"][0]), float(seg["times"][seg["main_end"] - 1]) + sp / plan["fps"]
        x = decode_audio(src["path"], start=t0, dur=t1 - t0)
        if abs(sp - 1) > 1e-3:
            tmp = cache_dir("audio") / f"clip_{_hash(src['path'], t0, t1, sp)}"
            write_wav(f"{tmp}_in.wav", x)
            run([FFMPEG, "-v", "error", "-y", "-i", f"{tmp}_in.wav", "-af", f"rubberband=tempo={sp}:pitch=1",
                 "-ar", str(SR), "-ac", "2", f"{tmp}_out.wav"])
            x = decode_audio(f"{tmp}_out.wav")
        tracks.append((_fade(x, 0.01, 0.02) * db(gain), seg["start"] / plan["fps"]))
    return tracks


def mix(spec, plan, out_wav, stems_dir=None):
    """Build the final mix WAV. Returns a report dict."""
    import pyloudnorm as pyln
    total = plan["total"] / plan["fps"]
    n = int(round(total * SR))
    bus = np.zeros((n, 2))
    rep = {"tracks": []}
    stems = {}
    au = spec["audio"] or {}
    vo_y = None
    if au.get("voiceover"):
        vo_y, tm, info = process_voiceover(au["voiceover"])
        _place(bus, vo_y, info["start"])
        v = np.zeros((n, 2))
        _place(v, vo_y, info["start"])
        stems["voiceover"] = v
        rep["voiceover"] = info
        rep["tracks"].append("voice-over")
        rep.setdefault("warnings", []).extend(info.get("warnings", []))
        if info["start"] + info["out_dur"] > total + 0.05:
            rep.setdefault("warnings", []).append(f"voice-over ends at {info['start'] + info['out_dur']:.2f}s, after the video ({total:.2f}s)")
    if au.get("music"):
        mu = au["music"]
        x, start = music_track(mu, total)
        m = np.zeros((n, 2))
        _place(m, x, start)
        if vo_y is not None and mu.get("duck", -12) is not None:
            m *= duck_envelope(vo_y, au["voiceover"].get("start", 0.0), n, mu.get("duck", -12))[:, None]
        bus += m
        stems["music"] = m
        rep["tracks"].append("music")
    for s in plan["sfx"]:
        x = decode_audio(s["sound"])
        t = s["at"]
        meta = Path(s["sound"]).with_name("sfx.json")
        if s.get("align") in ("end", "peak"):
            peak = None
            if s["align"] == "peak" and meta.exists():
                peak = json.loads(meta.read_text()).get(Path(s["sound"]).stem, {}).get("peak")
            t -= peak if peak is not None else len(x) / SR
        if s.get("pan"):
            p = float(s["pan"])
            x = x * np.array([np.cos((p + 1) * np.pi / 4), np.sin((p + 1) * np.pi / 4)]) * 1.4142
        _place(bus, x, t, db(s.get("volume", 0.0)))
    if plan["sfx"]:
        rep["tracks"].append(f"{len(plan['sfx'])} sfx")
    for x, t in clip_audio(spec, plan):
        _place(bus, x, t)
        rep["tracks"].append("clip audio")
    for tr in au.get("tracks") or []:
        x = decode_audio(tr["file"])
        if tr.get("trim"):
            a, b = tr["trim"]
            x = x[int(a * SR): int(b * SR) if b else None]
        if tr.get("dur"):
            need = int(tr["dur"] * SR)
            if len(x) < need and tr.get("loop") and len(x) > SR // 10:
                x = np.concatenate([x] * int(np.ceil(need / len(x))))
            x = x[:need].copy()
        if tr.get("fx"):
            x = apply_fx(x, tr["fx"])
        x = _fade(x.copy(), tr.get("fade_in", 0.02), tr.get("fade_out", 0.05)) * db(tr.get("volume", 0.0))
        if tr.get("pan"):
            p = float(tr["pan"])
            x = x * np.array([np.cos((p + 1) * np.pi / 4), np.sin((p + 1) * np.pi / 4)]) * 1.4142
        if tr.get("duck") and vo_y is not None:
            m = np.zeros((n, 2))
            _place(m, x, float(tr["at"]))
            bus += m * duck_envelope(vo_y, au["voiceover"].get("start", 0.0), n, float(tr["duck"]) if not isinstance(tr["duck"], bool) else -10)[:, None]
        else:
            _place(bus, x, float(tr["at"]))
        rep["tracks"].append(Path(str(tr["file"])).stem[:24])
    if not np.any(bus):
        write_wav(out_wav, bus)
        rep["loudness"] = None
        return rep
    meter = pyln.Meter(SR)
    lufs = meter.integrated_loudness(bus)
    target = spec["output"]["loudness"]
    bus *= db(target - lufs)
    if stems_dir:  # debugging / verification: pre-limiter stems at final gain
        Path(stems_dir).mkdir(parents=True, exist_ok=True)
        for k, v in stems.items():
            write_wav(Path(stems_dir) / f"stem_{k}.wav", v * db(target - lufs))
    tmp = Path(str(out_wav) + ".pre.wav")
    write_wav(tmp, bus)
    run([FFMPEG, "-v", "error", "-y", "-i", str(tmp), "-af", "alimiter=limit=0.84:level=false:attack=3:release=50",
         "-ar", str(SR), "-c:a", "pcm_s24le", str(out_wav)])
    tmp.unlink()
    final = decode_audio(out_wav)
    rep["loudness"] = round(meter.integrated_loudness(final), 1)
    rep["peak_db"] = round(20 * np.log10(np.abs(final).max() + 1e-9), 1)
    return rep
