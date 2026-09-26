"""Sound map: what a video sounds like besides its words (music, effects, build-ups, silences).

Speech is covered by Whisper; everything else (a plane roar that builds for 7 s, a beat, a sudden silence, a hit) only
shows up here. Output: a spectrogram image with the loudness curve, the cuts and the speech underneath (Claude reads
it like a contact sheet), per-half-second numbers and a few detected events.
"""
import numpy as np


def _smooth(x, n):
    return np.convolve(x, np.ones(n) / n, mode="same") if n > 1 else x


def _buildups(t, db, cent, cuts=(), min_rise=4.0, min_dur=2.5):
    """Stretches where the (1 s smoothed) loudness climbs steadily: risers, approaching sounds, crowd swells.
    A climb stops at a hard cut (a new scene is a new sound)."""
    out, i, n = [], 0, len(t)
    cuts = sorted(cuts)
    while i < n - 1:
        j = i
        nxt = next((c for c in cuts if c > t[i] + 0.2), None)
        while j + 1 < n and db[j + 1] >= db[j] - 0.6 and (nxt is None or t[j + 1] < nxt - 0.1):   # small wobbles allowed
            j += 1
        k = i + int(np.argmax(db[i:j + 1]))                # peak of the climb
        if t[k] - t[i] >= min_dur and db[k] - db[i] >= min_rise:
            brighter = cent[k] - cent[i] > 300
            out.append({"type": "build-up", "from": round(float(t[i]), 1), "to": round(float(t[k]), 1),
                        "rise_db": round(float(db[k] - db[i]), 1), "brighter": bool(brighter)})
        i = max(j, i + 1)
    return out


def analyze_sound(path, out_png, cuts=(), speech=(), marks=(), max_len=90.0, sr=22050, hop=512):
    """path: a video or audio file. cuts: cut times; speech: [(start, end)]; marks: [(t, label)].
    Returns {sound_map, events, per_half_second}."""
    import subprocess
    import tempfile
    from pathlib import Path

    import librosa
    from PIL import Image, ImageDraw, ImageFont
    from ..paths import ROOT
    with tempfile.TemporaryDirectory() as tmp:            # decode with ffmpeg (any container, fast), then analyse the WAV
        wav = Path(tmp) / "a.wav"
        p = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-vn", "-ac", "1", "-ar", str(sr), "-t", str(max_len),
                            str(wav)], capture_output=True)
        if p.returncode != 0 or not wav.exists():
            return {"sound_map": None, "events": [], "per_half_second": []}
        y, sr = librosa.load(str(wav), sr=sr, mono=True)
    if len(y) < sr // 2:
        return {"sound_map": None, "events": [], "per_half_second": []}
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    db = librosa.amplitude_to_db(rms + 1e-9, ref=np.max(rms) + 1e-9)
    cent = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop)[0]
    flat = librosa.feature.spectral_flatness(y=y, hop_length=hop)[0]
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    t = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    fps = sr / hop
    sdb, scent = _smooth(db, int(fps)), _smooth(cent, int(fps))

    events = _buildups(t[::int(fps // 4)], sdb[::int(fps // 4)], scent[::int(fps // 4)], cuts)
    # drops: the sound falls 15 dB+ within 0.3 s and stays down (a hard stop, a silence beat)
    step = max(1, int(0.3 * fps))
    for i in range(0, len(sdb) - 2 * step, step):
        if sdb[i] - sdb[i + step] >= 15 and sdb[i + step:i + 2 * step].mean() < sdb[i] - 12:
            if not events or events[-1].get("type") != "drop" or t[i] - events[-1]["at"] > 1.0:
                events.append({"type": "drop", "at": round(float(t[i]), 1), "fall_db": round(float(sdb[i] - sdb[i + step]), 1)})
    # hits: onsets far above the usual (impacts, whooshes, stingers); the 5 strongest
    z = (onset - np.median(onset)) / (np.std(onset) + 1e-9)
    peaks = [i for i in range(1, len(z) - 1) if z[i] > 5 and z[i] >= z[i - 1] and z[i] >= z[i + 1]]
    for i in sorted(peaks, key=lambda i: -z[i])[:5]:
        events.append({"type": "hit", "at": round(float(t[i]), 2)})
    events.sort(key=lambda e: e.get("from", e.get("at", 0)))

    rows = []
    for s in np.arange(0, t[-1], 0.5):
        m = (t >= s) & (t < s + 0.5)
        if m.any():
            rows.append({"t": round(float(s), 1), "loud_db": round(float(db[m].mean()), 1), "noisy": round(float(flat[m].mean()), 3),
                         "bright_hz": int(cent[m].mean())})

    # the image: spectrogram (low frequencies at the bottom), then loudness, then cuts + speech on a strip
    M = librosa.power_to_db(librosa.feature.melspectrogram(y=y, sr=sr, n_fft=2048, hop_length=hop, n_mels=160, fmax=11000),
                            ref=np.max)
    v = np.clip((M + 80) / 80, 0, 1)[::-1]
    lut = np.array([[int(255 * min(1, 1.5 * a)), int(255 * max(0, min(1, 2 * a - 0.6))), int(255 * max(0, 0.5 - abs(a - 0.35)) * 1.6)]
                    for a in np.linspace(0, 1, 256)], dtype=np.uint8)
    dur = float(t[-1])
    W, H, top = 2000, 460, 34
    canvas = Image.new("RGB", (W, top + H + 250), "white")
    canvas.paste(Image.fromarray(lut[(v * 255).astype(np.uint8)]).resize((W, H)), (0, top))
    d = ImageDraw.Draw(canvas)
    try:
        f = ImageFont.truetype(str(ROOT / "brand/fonts/Inter/Inter-SemiBold.otf"), 19)
    except OSError:
        f = ImageFont.load_default()

    def px(sec):
        return int(sec / dur * (W - 1))
    tick = 1 if dur <= 30 else 2 if dur <= 60 else 5
    for s in range(0, int(dur) + 1, tick):
        d.line([(px(s), top), (px(s), top + H)], fill=(255, 255, 255), width=1)
        d.text((px(s) + 2, top + H + 4), f"{s}s", fill="black", font=f)
    ly = top + H + 30
    pts = [(px(tt), ly + (1 - (np.clip(v_, -50, 0) + 50) / 50) * 120) for tt, v_ in zip(t[::4], sdb[::4])]
    d.line(pts, fill=(20, 60, 200), width=2)
    strip = ly + 135
    for a, b in speech:
        d.rectangle([px(a), strip, max(px(a) + 1, px(b)), strip + 14], fill=(40, 170, 90))
    for c in cuts:
        d.line([(px(c), strip + 18), (px(c), strip + 34)], fill=(0, 0, 0), width=2)
    for e in events:
        if e["type"] == "build-up":
            d.line([(px(e["from"]), top + H - 6), (px(e["to"]), top + H - 30)], fill=(0, 255, 255), width=4)
        else:
            d.line([(px(e["at"]), top), (px(e["at"]), top + 22)], fill=(255, 60, 60), width=3)
    for sec, lab in marks:
        d.line([(px(sec), 0), (px(sec), top + H)], fill=(0, 255, 120), width=3)
        d.text((px(sec) + 4, 6), lab, fill=(0, 120, 60), font=f)
    d.text((6, strip + 40), "spectrogram: 0 Hz bottom -> 11 kHz top · blue = loudness · green = speech · black ticks = cuts · "
                            "cyan = build-up · red = drop / hit", fill="black", font=f)
    canvas.save(out_png, quality=90)
    return {"sound_map": str(out_png), "events": events, "per_half_second": rows}


def describe(events):
    """One line for the CLI."""
    out = []
    for e in events:
        if e["type"] == "build-up":
            out.append(f"build-up {e['from']}-{e['to']} s (+{e['rise_db']} dB{', brighter' if e['brighter'] else ''})")
        elif e["type"] == "drop":
            out.append(f"drop at {e['at']} s (-{e['fall_db']} dB)")
        else:
            out.append(f"hit at {e['at']} s")
    return "; ".join(out) or "no build-ups, drops or hits"
