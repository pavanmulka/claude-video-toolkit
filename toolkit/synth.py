"""Synthesised UI sound effects and an original background-music bed (no samples, no licences).

    ./vtk sfx                       -> brand/sfx/*.wav (+ sfx.json with peak times)
    ./vtk music --duration 30 ...   -> a music bed WAV (also used by spec `music: {generate: ...}`)
"""
import json

import numpy as np

from .media import SR, write_wav

rng = np.random.default_rng(7)


def _onepole_lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def _st(x, pan=0.0):
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return np.stack([x * l * 1.4142, x * r * 1.4142], 1)


def _t(sec):
    return np.arange(int(sec * SR)) / SR


# ------------------------------------------------------------------ SFX
def tap(pitch=1.0, soft=False):
    t = _t(0.06)
    y = np.sin(2 * np.pi * 1850 * pitch * t) * np.exp(-t / 0.0045)
    y += 0.7 * np.sin(2 * np.pi * 520 * pitch * t) * np.exp(-t / 0.012)
    y += rng.standard_normal(len(t)) * np.exp(-t / 0.0015) * 0.15
    y *= np.minimum(1, t / 0.0006)
    if soft:
        y = _onepole_lp(y, 2500) * 1.6
    return y


def pop():
    t = _t(0.12)
    f = 380 + 900 * np.exp(-t / 0.012)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.03)
    return y * np.minimum(1, t / 0.001)


def whoosh(length=0.8, peak=0.62, bright=3200):
    t = _t(length)
    nz = rng.standard_normal(len(t))
    fc = 350 + bright * np.exp(-((t - peak) / 0.22) ** 2)
    y = np.empty(len(t))
    lo = hi = 0.0
    for i in range(len(t)):
        a = np.exp(-2 * np.pi * fc[i] / SR)
        lo = (1 - a) * nz[i] + a * lo
        b = np.exp(-2 * np.pi * (fc[i] * 0.35) / SR)
        hi = (1 - b) * lo + b * hi
        y[i] = lo - hi
    amp = np.where(t < peak, (t / peak) ** 2.2, np.exp(-(t - peak) / 0.09))
    return y * amp


def bell(f, length=2.2):
    t = _t(length)
    idx = 2.2 * np.exp(-t / 0.4)
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * 3.5 * t))
    y += 0.25 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / 0.5)
    return y * np.minimum(1, t / 0.003) * np.exp(-t / 0.7)


def impact():
    t = _t(1.2)
    f = 42 + 60 * np.exp(-t / 0.06)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.45)
    y += rng.standard_normal(len(t)) * np.exp(-t / 0.01) * 0.2
    return np.tanh(1.4 * y)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def click():
    """Crisp UI click (switch / button)."""
    t = _t(0.035)
    y = rng.standard_normal(len(t)) * np.exp(-t / 0.0012) * 0.8
    y += np.sin(2 * np.pi * 3200 * t) * np.exp(-t / 0.003) * 0.6
    return y


def ding():
    """Short bright notification ding."""
    t = _t(0.9)
    y = np.sin(2 * np.pi * 1318.5 * t) * np.exp(-t / 0.22) + 0.5 * np.sin(2 * np.pi * 2637 * t) * np.exp(-t / 0.12)
    return y * np.minimum(1, t / 0.002)


def notify():
    """Two-note soft notification (generic, not any OS sound)."""
    out = np.zeros(int(0.7 * SR))
    for i, f in enumerate((987.8, 1318.5)):
        b = bell(f, 0.55) * (0.9 if i else 0.7)
        o = int(i * 0.11 * SR)
        out[o:o + len(b)] += b[: len(out) - o]
    return out


def typing(dur=1.2, rate=11.0):
    """Keyboard typing: irregular soft key clicks."""
    n = int(dur * SR)
    y = np.zeros(n)
    t = 0.0
    g = np.random.default_rng(3)
    while t < dur - 0.05:
        k = tap(pitch=g.uniform(0.75, 1.1), soft=True) * g.uniform(0.35, 0.8)
        i = int(t * SR)
        y[i:i + len(k)] += k[: n - i]
        t += g.uniform(0.6, 1.4) / rate
    return y


def shutter():
    """Camera shutter: two mechanical clicks."""
    out = np.zeros(int(0.25 * SR))
    for i, o in enumerate((0.0, 0.085)):
        t = _t(0.06)
        c = rng.standard_normal(len(t)) * np.exp(-t / 0.006) * (1 if i == 0 else 0.7)
        c = _onepole_lp(c, 5000)
        j = int(o * SR)
        out[j:j + len(c)] += c[: len(out) - j]
    return out


def glitch():
    """Digital glitch: bit-crushed noise bursts + pitch jumps."""
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    g = np.random.default_rng(11)
    pos = 0
    while pos < n:
        L = int(g.uniform(0.012, 0.045) * SR)
        f = g.choice([180, 420, 880, 1760, 2400])
        seg = np.sign(np.sin(2 * np.pi * f * t[:L])) * g.uniform(0.3, 0.9)
        if g.random() < 0.4:
            seg = g.standard_normal(L) * 0.5
        y[pos:pos + L] = seg[: n - pos]
        pos += L + int(g.uniform(0, 0.01) * SR)
    y = np.round(y * 6) / 6
    return y * np.exp(-t / 0.2)


def boom():
    """Sub drop / bass hit for reveals."""
    t = _t(1.6)
    f = 38 + 90 * np.exp(-t / 0.08)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.6)
    return np.tanh(1.8 * y)


def sparkle():
    """Glittery shimmer (for shines / reveals)."""
    n = int(0.9 * SR)
    y = np.zeros(n)
    g = np.random.default_rng(5)
    for k in range(14):
        f = mtof(g.integers(88, 101))
        b = bell(f, 0.35) * g.uniform(0.15, 0.4)
        o = int((k * 0.045 + g.uniform(0, 0.02)) * SR)
        y[o:o + len(b)] += b[: n - o]
    return y


def bubble():
    """Soft bubbly pop (chat bubbles appearing)."""
    t = _t(0.1)
    f = 600 + 1400 * (t / 0.1) ** 0.6
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.025)
    return y * np.minimum(1, t / 0.001)


def swoosh_up():
    """Rising swoosh (text flying in)."""
    return whoosh(0.45, 0.38, 5200)


def cabin_chime():
    """The two-tone in-flight PA chime ('bing-bong', high then low)."""
    y = np.zeros(int(2.6 * SR))
    for i, m in enumerate([82, 78]):                      # Bb5 then F#5
        b = bell(mtof(m), 2.0)
        o = int(i * 0.55 * SR)
        y[o:o + len(b)] += b[: len(y) - o]
    return y


def cabin_hum(length=12.0, seed=5):
    """Steady jet-cabin hum: dark rumble + a faint engine tone; fades in / out so it can be placed anywhere."""
    from scipy.signal import lfilter
    g = np.random.default_rng(seed)
    t = _t(length)
    a = np.exp(-2 * np.pi * 260 / SR)
    y = lfilter([1 - a], [1, -a], g.standard_normal(len(t))) * 6
    y = lfilter([1 - a], [1, -a], y)
    y += 0.05 * np.sin(2 * np.pi * 118 * t) + 0.03 * np.sin(2 * np.pi * 236 * t)
    return y * np.minimum(1, t / 1.0) * np.minimum(1, (length - t) / 1.0)


def flyby(length=10.0, peak=6.0, height=150.0, speed=70.0, seed=11):
    """A plane passing low overhead (stereo): a roar that swells and brightens as it nears (distance + air absorption),
    engine whine falling in pitch as it passes (Doppler), the moving ground-reflection comb (the curved fringes of a
    real flyover), panning left -> right. Peak (overhead) at `peak` s."""
    from scipy.signal import lfilter
    g = np.random.default_rng(seed)
    n = int(length * SR)
    t = np.arange(n) / SR
    x = speed * (t - peak)                               # along-track position (m); overhead at t = peak
    r = np.sqrt(x ** 2 + height ** 2)
    c = 343.0
    # jet noise: low rumble + broad roar
    wn = g.standard_normal(n)
    rumble = lfilter([1 - np.exp(-2 * np.pi * 160 / SR)], [1, -np.exp(-2 * np.pi * 160 / SR)], wn) * 4.0
    roar = lfilter([1, -1], [1, -np.exp(-2 * np.pi * 300 / SR)], g.standard_normal(n)) * 0.35
    src = rumble + roar
    # air absorption: the far plane is dull, the near one brighter (time-varying 2-pole low-pass, 20 ms blocks);
    # a real roar lives in the low mids, the highs stay dark
    fc = np.clip(6000 * (height / r) ** 1.3, 700, 6000)
    y = np.empty(n)
    z1, z2 = np.zeros(1), np.zeros(1)
    blk = int(0.02 * SR)
    for s in range(0, n, blk):
        a = np.exp(-2 * np.pi * fc[min(s + blk // 2, n - 1)] / SR)
        h1, z1 = lfilter([1 - a], [1, -a], src[s:s + blk], zi=z1)
        y[s:s + blk], z2 = lfilter([1 - a], [1, -a], h1, zi=z2)
    # engine / fan whine with Doppler: high while approaching, falling as it passes
    u = -speed * x / r                                   # speed toward the listener (m/s)
    for f0, amp in ((1150.0, 0.22), (2310.0, 0.10), (620.0, 0.18)):
        f = f0 * c / (c - u) * (1 + 0.004 * np.sin(2 * np.pi * 0.7 * t))
        y += amp * np.sin(2 * np.pi * np.cumsum(f) / SR) * (height / r) ** 0.6
    # ground reflection (phone ~0.6 m above the reflecting floor): a delayed copy with a moving delay -> the broad,
    # curved comb fringes of a real flyover
    d = (np.sqrt(x ** 2 + (height + 0.6) ** 2) - np.sqrt(x ** 2 + (height - 0.6) ** 2)) / c * SR
    idx = np.arange(n)
    y = y + 0.75 * np.interp(idx - d, idx, y, left=0.0)
    # distance loudness (1/r, softened), fade in / out
    env = (height / r) ** 0.75
    env *= np.minimum(1, t / 0.8) * np.minimum(1, (length - t) / 1.2)
    y *= env
    pan = np.clip(x / (r + 40), -0.85, 0.85)             # left -> right
    left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return np.stack([y * left * 1.4142, y * right * 1.4142], 1)


def make_sfx(out_dir):
    """Write the standard sound set to out_dir; returns {name: {file, peak}}."""
    out_dir.mkdir(parents=True, exist_ok=True)
    sounds = {
        "tap": (tap(), 0.0), "tap_soft": (tap(0.92, soft=True), 0.0), "pop": (pop(), 0.0),
        "whoosh": (whoosh(0.8, 0.62), 0.62), "swish": (whoosh(0.35, 0.25, 4200), 0.25),
        "riser": (whoosh(1.9, 1.86, 3600), 1.86), "impact": (impact(), 0.0),
    }
    ch = np.zeros(int(2.4 * SR))
    for i, m in enumerate([81, 86]):
        b = bell(mtof(m))
        o = int((0.03 + i * 0.09) * SR)
        ch[o:o + len(b)] += b[: len(ch) - o]
    sounds["chime"] = (ch, 0.03)
    sounds["chime_soft"] = (bell(mtof(88), 1.6) * 0.8, 0.0)
    sounds.update({"click": (click(), 0.0), "ding": (ding(), 0.0), "notify": (notify(), 0.0), "typing": (typing(), 0.0),
                   "shutter": (shutter(), 0.0), "glitch": (glitch(), 0.05), "boom": (boom(), 0.0), "sparkle": (sparkle(), 0.05),
                   "bubble": (bubble(), 0.0), "swoosh_up": (swoosh_up(), 0.38), "riser_short": (whoosh(0.9, 0.86, 4200), 0.86),
                   "flyby": (flyby(), 6.0), "cabin_chime": (cabin_chime(), 0.0), "cabin_hum": (cabin_hum(), 0.0)})
    meta = {}
    for name, (y, peak) in sounds.items():
        y = y / (np.abs(y).max() + 1e-9) * 0.7
        write_wav(out_dir / f"{name}.wav", y if y.ndim == 2 else _st(y))
        meta[name] = {"file": f"{name}.wav", "peak": peak, "dur": round(len(y) / SR, 3)}
    (out_dir / "sfx.json").write_text(json.dumps(meta, indent=1))
    return meta


# ------------------------------------------------------------------ music bed
KEYS = {"C": 48, "C#": 49, "Db": 49, "D": 50, "D#": 51, "Eb": 51, "E": 52, "F": 53, "F#": 54, "Gb": 54, "G": 55,
        "G#": 56, "Ab": 56, "A": 45, "A#": 46, "Bb": 46, "B": 47}
# chord voicings relative to the key root (warm maj9 / min9 / sus colours)
PAD = {"I": [0, 4, 7, 11, 14], "vi": [-3, 0, 4, 7, 11], "IV": [-3, 0, 4, 7, 12], "V": [-5, 0, 2, 7, 9]}
ROOT = {"I": -12, "vi": -15, "IV": -19, "V": -17}
UPPER = {"I": [16, 19, 23, 26, 28], "vi": [16, 19, 21, 23, 28], "IV": [16, 17, 21, 24, 28], "V": [14, 16, 19, 21, 26]}
PROG = ["I", "vi", "IV", "V"]


def _pad_note(f, dur, bright, detune_c=9):
    n = int((dur + 0.9) * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for dc, pan in [(-detune_c, -0.7), (0, 0.0), (detune_c, 0.7)]:
        fk = f * 2 ** (dc / 1200)
        ph = rng.uniform(0, 2 * np.pi)
        sig = np.zeros(n)
        for h in range(1, 14):
            fh = fk * h
            if fh > 9000:
                break
            sig += (1 / h) * np.exp(-fh / bright) * np.sin(2 * np.pi * fh * t + ph * h)
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        out[:, 0] += sig * l
        out[:, 1] += sig * r
    a, hold = 0.35, dur
    e = np.where(t < a, t / a, 0.85 + 0.15 * np.exp(-(t - a) / 1.0))
    e = np.where(t > hold, e * np.exp(-(t - hold) / 0.35), e)
    lfo = 1 + 0.06 * np.sin(2 * np.pi * 0.23 * t + rng.uniform(0, 6))
    return out * (e * lfo)[:, None] / 3


def _ep(f, vel=1.0, length=1.6):
    t = _t(length)
    idx = 1.9 * vel * np.exp(-t / 0.22)
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    y += 0.18 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.35)
    tine = 0.14 * vel * np.sin(2 * np.pi * f * 7.02 * t) * np.exp(-t / 0.045)
    e = np.minimum(1, t / 0.004) * np.exp(-t / 0.75)
    return (y + tine) * e * (1 + 0.08 * np.sin(2 * np.pi * 4.5 * t)) * vel


def _bass(f, length):
    t = _t(length + 0.12)
    y = (0.8 * np.sin(2 * np.pi * f * t) + 0.45 * np.sin(2 * np.pi * 2 * f * t)
         + 0.22 * np.sin(2 * np.pi * 3 * f * t) + 0.1 * np.sin(2 * np.pi * 4 * f * t))
    e = np.minimum(1, t / 0.008) * (0.55 + 0.45 * np.exp(-t / 0.25))
    e *= np.where(t > length, np.exp(-(t - length) / 0.04), 1)
    return np.tanh(2.0 * y * e) * 0.6


def _kick():
    t = _t(0.45)
    f = 54 + 110 * np.exp(-t / 0.03)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    y += 0.35 * np.sin(2 * np.pi * 118 * t) * np.exp(-t / 0.045)
    y += np.sin(2 * np.pi * 3200 * t) * np.exp(-t / 0.0025) * 0.22 + rng.standard_normal(len(t)) * np.exp(-t / 0.0015) * 0.12
    return np.tanh(1.5 * y) * 0.85


def _snare():
    t = _t(0.4)
    nz = rng.standard_normal(len(t))
    nz = _onepole_lp(nz - _onepole_lp(nz, 900), 6500)
    y = nz * np.exp(-t / 0.11) * 0.9 + np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.05) * 0.6
    for d in (0.0, 0.011, 0.022):
        k = int(d * SR)
        y[k:k + 200] += rng.standard_normal(200) * np.exp(-np.arange(200) / 60) * 0.35
    return y * 0.7


def _hat(open_=False):
    t = _t(0.25 if open_ else 0.08)
    nz = np.diff(np.diff(rng.standard_normal(len(t)), prepend=0), prepend=0)
    return _onepole_lp(nz, 11000) * np.exp(-t / (0.09 if open_ else 0.018)) * 0.25


def _eq(x, pts):
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.interp(np.log10(np.maximum(f, 1.0)), [np.log10(p[0]) for p in pts], [p[1] for p in pts])
    return np.fft.irfft(X * (10 ** (g / 20))[:, None], len(x), axis=0)


def _reverb(x, length=1.6, decay=0.42, pre=0.018):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-t / decay)[:, None]
    ir[:, 0] = _onepole_lp(ir[:, 0], 5200)
    ir[:, 1] = _onepole_lp(ir[:, 1], 4800)
    ir = np.concatenate([np.zeros((int(pre * SR), 2)), ir])
    ir /= np.sqrt((ir ** 2).sum(0))
    L = len(x) + len(ir) - 1
    nfft = 1 << (L - 1).bit_length()
    return np.stack([np.fft.irfft(np.fft.rfft(x[:, c], nfft) * np.fft.rfft(ir[:, c], nfft), nfft)[:len(x)] for c in range(2)], 1)


def music_bed(duration, bpm=120, key="D", drop=0.0, resolve=None, seed=7):
    """Original half-time chill-pop bed: pad intro until `drop`, groove, resolve chord at `resolve`."""
    global rng
    rng = np.random.default_rng(seed)
    N = int(duration * SR)
    beat = 60.0 / bpm
    bar = 4 * beat
    root = KEYS.get(key, 50)
    if resolve is None:
        nb = int((duration - 2.0 - drop) // bar)
        resolve = drop + max(1, nb) * bar
    nbars = max(0, int(round((resolve - drop) / bar)))
    pad, keys, bass, drums, sfx, send = (np.zeros((N, 2)) for _ in range(6))

    def place(dst, x, t, g=1.0, pan=0.0):
        i = int(round(t * SR))
        if x.ndim == 1:
            x = _st(x, pan)
        if i >= N:
            return
        j0 = max(0, -i)
        n = min(len(x), N - i)
        if n > j0:
            dst[i + j0:i + n] += x[j0:n] * g

    def bt(b, beat_i=0.0):
        return drop + b * bar + beat_i * beat

    # intro: vi -> V, filter opening, riser into the drop
    if drop > 0.3:
        split = max(0.0, drop - 2 * bar / 2)
        for t0, t1, ch, br in [(0.0, split + 0.05, "vi", 900), (split, drop + 0.05, "V", 1500)]:
            if t1 - t0 > 0.1:
                for m in PAD[ch]:
                    place(pad, _pad_note(mtof(root + m), t1 - t0, br), t0, 0.16)
        if drop >= 1.0:
            w = whoosh(min(1.9, drop), min(1.86, drop - 0.04), 3600)
            place(sfx, w, drop - min(1.86, drop - 0.04), 0.22)
        for i, m in enumerate([root + 26, root + 31]):
            if 0.35 + i * 1.0 < drop - 0.3:
                place(keys, _ep(mtof(m), 0.5, 2.0), 0.35 + i * 1.0, 0.10, -0.3 if i == 0 else 0.3)
    k_s, s_s = _kick(), _snare()
    kick_times = []
    for b in range(nbars):
        ch = PROG[b % 4]
        br = 2300 if b < 4 else 2800
        for m in PAD[ch]:
            place(pad, _pad_note(mtof(root + m), bar + 0.1, br), bt(b) - 0.03, 0.11)
        r = mtof(root + ROOT[ch])
        for (b_i, ln) in [(0, 1.4), (1.5, 0.9), (2.5, 1.4)]:
            place(bass, _bass(r, ln * beat), bt(b, b_i), 0.24)
        for kb in [0, 1.5] + ([3.5] if b % 2 else []):
            place(drums, k_s, bt(b, kb), 0.55 if kb == 0 else 0.42)
            kick_times.append(bt(b, kb))
        if b >= 2:
            place(drums, s_s, bt(b, 2), 0.32 if b < 4 else 0.40)
            place(send, s_s, bt(b, 2), 0.12)
        for e8 in range(8):
            g = (0.2 if e8 % 2 else 0.12) * (0.8 if b < 4 else 1.0)
            place(drums, _hat(), bt(b, e8 * 0.5 + (0.04 if e8 % 2 else 0)), g, 0.25)
        if b >= 8 and b % 2 == 0:
            place(drums, _hat(True), bt(b, 3.5), 0.07, 0.25)
        up = [root + u for u in UPPER[ch]]
        if b < 4:
            pat = [(0, 0), (1, 2), (2, 1), (3, 3)]
        else:
            order = [0, 2, 4, 2, 1, 3, 4, 3] if b % 2 == 0 else [4, 2, 3, 1, 2, 0, 3, 1]
            pat = [(i * 0.5 + (0.04 if i % 2 else 0), order[i]) for i in range(8)]
        for b_i, k in pat:
            place(keys, _ep(mtof(up[k]), 0.75 + 0.25 * rng.random(), 1.4), bt(b, b_i), 0.11, rng.uniform(-0.35, 0.35))
    if nbars:
        for i, b_i in enumerate([3.0, 3.25, 3.5, 3.75]):
            place(drums, s_s, bt(nbars - 1, b_i), 0.10 + 0.05 * i)
        place(sfx, whoosh(0.8, 0.62), resolve - 0.62, 0.20)
    # resolve
    ring = max(1.0, duration - resolve)
    place(drums, k_s, resolve, 0.55)
    kick_times.append(resolve)
    place(bass, _bass(mtof(root - 12), min(2.2, ring)), resolve, 0.24)
    for m in PAD["I"]:
        place(pad, _pad_note(mtof(root + m), min(2.4, ring), 1900), resolve - 0.03, 0.14)
    for i, m in enumerate([root + 12, root + 16, root + 19, root + 23, root + 26]):
        place(keys, _ep(mtof(m), 0.8, 2.8), resolve + i * 0.045, 0.09, -0.3 + i * 0.15)
    # sidechain pump
    tt = np.arange(N) / SR
    duck = np.ones(N)
    for k in kick_times:
        i = int(k * SR)
        seg = tt[i:i + int(0.4 * SR)] - k
        duck[i:i + len(seg)] = np.minimum(duck[i:i + len(seg)], 1 - 0.32 * np.exp(-seg / 0.11))
    pad *= duck[:, None]
    keys *= duck[:, None]
    wet = _reverb(pad * 0.5 + keys * 0.9 + send)
    music = pad + keys + bass + drums + wet * 0.55
    mix = _eq(music, [(20, -40), (32, -18), (45, -6), (70, -2), (110, -1), (250, 0), (900, 0), (2500, 1.5), (6000, 3.5), (12000, 3), (20000, 0)]) + sfx
    fade = np.clip((duration - tt) / 1.2, 0, 1) ** 1.5 * np.clip(tt / 0.04, 0, 1)
    mix = np.tanh(mix * fade[:, None] * 1.1) / 1.1
    return mix / (np.abs(mix).max() + 1e-9) * 0.7
