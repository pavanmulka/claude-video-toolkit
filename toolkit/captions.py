"""Captions from a voice-over transcript (word timestamps) -> timed chunks for rendering."""
import json
import math
import re
from pathlib import Path

PUNCT_BREAK = re.compile(r"[.!?,;:]$")


def load_words(path):
    """Word list [{'w','start','end'}] from our transcript JSON (or an SRT, word timing interpolated)."""
    path = Path(path)
    if path.suffix.lower() == ".json":
        d = json.loads(path.read_text())
        return [{"w": w["w"], "start": float(w["start"]), "end": float(w["end"])} for w in d["words"]]
    if path.suffix.lower() == ".srt":
        import pysrt
        out = []
        for it in pysrt.open(str(path)):
            ws = it.text.replace("\n", " ").split()
            a, b = it.start.ordinal / 1000, it.end.ordinal / 1000
            for i, w in enumerate(ws):
                out.append({"w": w, "start": a + (b - a) * i / len(ws), "end": a + (b - a) * (i + 1) / len(ws)})
        return out
    raise ValueError(f"captions: unsupported transcript {path}")


def chunk(words, max_words=5, max_chars=28, max_gap=0.45, min_dur=0.5):
    """Group words into caption chunks: split at punctuation and pauses, then split long phrases
    into evenly sized chunks (no one-word orphans like 'folder.' on its own)."""
    groups, cur = [], []
    for w in words:
        if cur and (w["start"] - cur[-1]["end"] > max_gap or PUNCT_BREAK.search(cur[-1]["w"])):
            groups.append(cur)
            cur = []
        cur.append(w)
    if cur:
        groups.append(cur)
    chunks = []
    for g in groups:
        chars = sum(len(w["w"]) + 1 for w in g) - 1
        k = min(len(g), max(math.ceil(len(g) / max_words), math.ceil(chars / max_chars)))
        cuts = [round(i * len(g) / k) for i in range(k + 1)]
        for a, b in zip(cuts, cuts[1:]):
            part = g[a:b]
            chunks.append({"words": part, "start": part[0]["start"], "end": part[-1]["end"]})
    # extend each chunk until the next one starts (no flicker between chunks), with a minimum duration
    for i, c in enumerate(chunks):
        end = max(c["end"] + 0.15, c["start"] + min_dur)
        if i + 1 < len(chunks):
            nxt = chunks[i + 1]["start"]
            end = nxt if nxt - end < 0.6 else min(end, nxt)
        c["end"] = end
    return chunks


def active(chunks, t):
    for i, c in enumerate(chunks):
        if c["start"] <= t < c["end"]:
            wi = None
            for j, w in enumerate(c["words"]):
                if t >= w["start"]:
                    wi = j
            return i, wi
    return None, None


def phrases(words, gap=0.3):
    """Group words into spoken phrases (sentence punctuation or a pause > gap)."""
    out, cur = [], []
    for w in words:
        if cur and (w["start"] - cur[-1]["end"] > gap or re.search(r"[.!?]$", cur[-1]["w"])):
            out.append(cur)
            cur = []
        cur.append(w)
    if cur:
        out.append(cur)
    return [{"start": p[0]["start"], "end": p[-1]["end"], "text": " ".join(w["w"] for w in p)} for p in out]
