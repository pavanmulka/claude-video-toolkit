"""Subject masks for text / graphics behind the subject (`behind: subject | person`).

Apple Vision on-device segmentation through a small Swift helper (toolkit/native/subject_mask.swift), compiled on first
use into .cache/bin/subject_mask and kept running for the whole render (frames go in, masks come out).
`subject` = every foreground subject Vision finds (a hand holding a phone, a person, a backpack, a mug);
`person` = people only (finer hair edges). Masks are feathered and smoothed over time so text edges don't flicker.
"""
import shutil
import struct
import subprocess
from pathlib import Path

import cv2
import numpy as np

from .paths import cache_dir

SRC = Path(__file__).parent / "native" / "subject_mask.swift"
MODES = {"subject": 0, "person": 1}


def helper():
    """Path of the compiled helper (built on first use, rebuilt when the Swift source changes)."""
    out = cache_dir("bin") / "subject_mask"
    if out.exists() and out.stat().st_mtime >= SRC.stat().st_mtime:
        return out
    swiftc = shutil.which("swiftc")
    if not swiftc:
        raise RuntimeError("behind: subject needs Xcode's swiftc (macOS 14+) to build the Vision helper")
    subprocess.run([swiftc, "-O", str(SRC), "-o", str(out)], check=True, capture_output=True)
    return out


class Masker:
    def __init__(self, smooth=0.45, feather=1.6):
        self.proc = None
        self.smooth = smooth          # temporal EMA weight of the previous mask (0 = none)
        self.feather = feather        # edge softening in px (at 1080 wide)
        self.prev = {}

    def _start(self):
        if self.proc is None or self.proc.poll() is not None:
            self.proc = subprocess.Popen([str(helper())], stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def mask(self, rgba, mode="subject", key=None):
        """PIL RGBA/RGB frame -> float32 HxW mask in 0..1 (1 = subject). `key` groups frames for temporal smoothing."""
        self._start()
        a = np.asarray(rgba.convert("RGBA"))
        h, w = a.shape[:2]
        bgra = np.ascontiguousarray(a[..., [2, 1, 0, 3]])
        self.proc.stdin.write(struct.pack("<III", w, h, MODES.get(mode, 0)) + bgra.tobytes())
        self.proc.stdin.flush()
        mw, mh = struct.unpack("<II", self.proc.stdout.read(8))
        m = np.frombuffer(self.proc.stdout.read(mw * mh), np.uint8).reshape(mh, mw).astype(np.float32) / 255.0
        if (mw, mh) != (w, h):
            m = cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR)
        if self.feather:
            m = cv2.GaussianBlur(m, (0, 0), self.feather * w / 1080)
        k = (key, mode, w, h)
        p = self.prev.get(k)
        if p is not None and self.smooth:
            m = self.smooth * p + (1 - self.smooth) * m
        self.prev[k] = m
        return np.clip(m, 0, 1)

    def close(self):
        if self.proc and self.proc.poll() is None:
            self.proc.stdin.close()
            self.proc.wait(timeout=5)
        self.proc = None
