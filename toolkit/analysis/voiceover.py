"""./vtk voiceover <file>: faster-whisper transcript with word timestamps -> JSON + SRT (cached)."""
import hashlib
import json
import os
from pathlib import Path

# The hf-xet download backend can stall on some networks; plain HTTPS is reliable.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

from ..paths import cache_dir

DEFAULT_MODEL = "small"


def _key(path, model, language, vocab):
    st = Path(path).stat()
    return hashlib.sha1(f"{path}|{st.st_size}|{st.st_mtime}|{model}|{language}|{vocab}".encode()).hexdigest()[:16]


def transcribe(path, model=DEFAULT_MODEL, language=None, out_dir=None, vocabulary=None):
    """{'text', 'language', 'words': [{'w','start','end','p'}], 'segments': [...], 'pauses': [...]}

    vocabulary: brand/product words (e.g. ['AcmeApp']) passed to Whisper as hotwords + prompt.
    """
    path = Path(path)
    vocab = ", ".join(vocabulary or [])
    cache = cache_dir("transcripts") / f"{path.stem}_{_key(path, model, language, vocab)}.json"
    if cache.exists():
        res = json.loads(cache.read_text())
    else:
        from faster_whisper import WhisperModel
        m = WhisperModel(model, device="cpu", compute_type="int8")
        extra = {"hotwords": vocab, "initial_prompt": vocab + "."} if vocab else {}
        segs, info = m.transcribe(str(path), language=language, word_timestamps=True, vad_filter=False,
                                  condition_on_previous_text=False, **extra)
        words, segments = [], []
        for s in segs:
            segments.append({"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()})
            for w in s.words or []:
                words.append({"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3), "p": round(w.probability, 3)})
        pauses = [[words[i]["end"], words[i + 1]["start"]] for i in range(len(words) - 1)
                  if words[i + 1]["start"] - words[i]["end"] > 0.25]
        res = {"path": str(path), "language": info.language, "model": model,
               "text": " ".join(s["text"] for s in segments), "words": words, "segments": segments, "pauses": pauses}
        cache.write_text(json.dumps(res, indent=1))
    if out_dir:
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{path.stem}.transcript.json").write_text(json.dumps(res, indent=1))
        write_srt(res, out_dir / f"{path.stem}.srt")
    return res


def write_srt(res, out):
    import pysrt
    subs = pysrt.SubRipFile()
    for i, s in enumerate(res["segments"], 1):
        subs.append(pysrt.SubRipItem(i, start=pysrt.SubRipTime(milliseconds=int(s["start"] * 1000)),
                                     end=pysrt.SubRipTime(milliseconds=int(s["end"] * 1000)), text=s["text"]))
    subs.save(str(out), encoding="utf-8")


def print_summary(res):
    print(f"language: {res['language']}   words: {len(res['words'])}")
    for s in res["segments"]:
        print(f"  {s['start']:6.2f} - {s['end']:6.2f}  {s['text']}")
    if res["pauses"]:
        print("  pauses > 0.25s: " + ", ".join(f"{a:.2f}-{b:.2f}" for a, b in res["pauses"]))
