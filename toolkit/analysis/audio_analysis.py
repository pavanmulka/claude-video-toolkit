"""./vtk audio <file>: duration, loudness, tempo and beat times, silences."""
import json
from pathlib import Path

import numpy as np

from ..media import SR, decode_audio


def loudness(path):
    import pyloudnorm as pyln
    x = decode_audio(path)
    if len(x) < SR // 2 or not np.any(x):
        return None
    return round(float(pyln.Meter(SR).integrated_loudness(x)), 1)


def analyze(path, out_dir=None):
    import librosa
    import pyloudnorm as pyln
    x = decode_audio(path)
    mono = x.mean(1)
    res = {"path": str(path), "duration": round(len(x) / SR, 3)}
    if np.any(x):
        res["loudness_lufs"] = round(float(pyln.Meter(SR).integrated_loudness(x)), 1)
        res["peak_dbfs"] = round(float(20 * np.log10(np.abs(x).max() + 1e-12)), 1)
    y = librosa.resample(mono, orig_sr=SR, target_sr=22050)
    tempo, beats = librosa.beat.beat_track(y=y, sr=22050, units="time")
    res["tempo_bpm"] = round(float(np.atleast_1d(tempo)[0]), 1)
    res["beats"] = [round(float(b), 3) for b in beats]
    if len(beats) >= 8:
        # downbeat guess: the beat phase (mod 4) with the most onset energy
        onset = librosa.onset.onset_strength(y=y, sr=22050)
        ot = librosa.times_like(onset, sr=22050)
        strength = np.interp(beats, ot, onset)
        phase = int(np.argmax([strength[i::4].mean() for i in range(4)]))
        res["downbeats"] = [round(float(b), 3) for b in beats[phase::4]]
    from ..audio import silences
    res["silences"] = [[round(a, 2), round(b, 2)] for a, b in silences(x)]
    if out_dir:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        (Path(out_dir) / f"audio_{Path(path).stem}.json").write_text(json.dumps(res, indent=1))
    return res
