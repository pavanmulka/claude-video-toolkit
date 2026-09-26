"""Trends knowledge base: learn from short videos the user shares (TikTok / YouTube / Instagram links or local
screen recordings). Scope: video craft + app marketing.

The brain grows by distilling, not by piling up (built for thousands of sources):
    trends/BRAIN.md               read first, always: the golden rules + which topic page to open for which job (capped)
    trends/brain/<topic>.md       one page per topic (hooks, narration, formats...): one lesson per line, each page capped
    trends/archive.md             retired / merged-away lessons (never read when planning)
    trends/library.jsonl          one line per source: what it taught (lessons) or confirmed, the pages it fed; full notes
                                  (beats, craft...) only for special sources (keep: full); searched, never read whole
    trends/SOURCES.md             generated from the library: every source learned, newest first, one line each
    .cache/trends/<id>/           download, analysis sheets and the draft record (git-ignored; slimmed on commit)

Flow:  ./vtk learn <url|file> --note "why"  (a link learned before is refused: --again)  ->  Claude reads the sheets +
       transcript, writes the NEW lessons into the brain pages (or adds proof to the lines it confirms) and fills the
       draft (lessons / confirms / pages)  ->  ./vtk kb commit <id>.   Search: ./vtk kb search / stats / show.
       A whole YouTube channel: ./vtk learn <channel url> (toolkit/channel.py) -> one full profile record.
"""
import json
import re
import shutil
import statistics
import time
from pathlib import Path

import yaml

from .paths import CACHE, INBOX, ROOT

TRENDS = ROOT / "trends"
LIBRARY = TRENDS / "library.jsonl"
BRAIN = TRENDS / "BRAIN.md"
PAGES = TRENDS / "brain"
ARCHIVE = TRENDS / "archive.md"
SOURCES = TRENDS / "SOURCES.md"
# what Claude reads per job stays small: BRAIN.md always + the 2-3 pages the job needs
BUDGET = {"brain": {"lines": 40, "kb": 6}, "page": {"lines": 80, "kb": 10}}
SLIM_KEYS = ["id", "source", "note", "kind", "format", "relevance", "tags", "lessons", "confirms", "pages"]
WORK = CACHE / "trends"
MEDIA_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".m4a", ".mp3", ".wav", ".aac", ".opus", ".jpg", ".jpeg", ".png",
                  ".webp", ".gif", ".srt", ".vtt"}

KINDS = ["app_marketing", "trend_format", "craft_reference"]
FORMATS = ["hook_demo", "problem_payoff", "pov", "listicle", "tutorial", "before_after", "chat_story", "text_story", "wish_i_knew",
           "slideshow", "reply_comment", "screenshot_explainer", "rating", "day_in_life", "feature_drop", "skit", "talking_head",
           "green_screen", "voiceover_broll", "ugc_review", "meme", "other"]
HOOK_TYPES = ["outcome", "relatable_moment", "pov", "question", "number", "contrarian", "command", "curiosity_gap", "problem",
              "visual_interrupt", "testimonial", "other"]
ROLES = ["hook", "setup", "problem", "escalation", "demo", "proof", "payoff", "reveal", "social_proof", "cta", "loop", "other"]
REQUIRED = ["kind", "format", "hook.type", "hook.seconds", "beats", "why_it_works", "relevance"]


# ------------------------------------------------------------------ storage
def load():
    if not LIBRARY.exists():
        return []
    return [json.loads(line) for line in LIBRARY.read_text().splitlines() if line.strip()]


def save(records):
    TRENDS.mkdir(exist_ok=True)
    records = sorted(records, key=lambda r: (r.get("source", {}).get("captured", ""), r["id"]))
    LIBRARY.write_text("".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in records))


def _get(d, dotted):
    for k in dotted.split("."):
        d = d.get(k) if isinstance(d, dict) else None
    return d


# ------------------------------------------------------------------ learn
def _slug(s, n=40):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")[:n] or "video"


YOUTUBE = re.compile(r"(^|//)(www\.|m\.)?(youtube\.com|youtu\.be)/", re.I)
LONG_TALK = 300          # seconds: longer YouTube videos (interviews, podcasts, talks) are learned from their transcript
JS_RUNTIMES = {"deno": {"path": None}, "node": {"path": None}}   # YouTube's challenges need Node (installed) or Deno


def _yt_error(url, e, what="download"):
    msg = str(e)
    if "instagram" in url and ("login" in msg.lower() or "cookies" in msg.lower() or "rate" in msg.lower()):
        return RuntimeError("Instagram needs your login: log into instagram.com in Chrome (or Safari), then\n"
                            f"  ./vtk learn '{url}' --cookies chrome")
    if re.search(r"not a bot|confirm you", msg, re.I):
        return RuntimeError("YouTube's bot check (it follows many requests in a row, e.g. a channel study) usually lifts "
                            "after an hour or more: retry later, or use your browser's YouTube login:\n"
                            f"  ./vtk learn '{url}' --cookies chrome")
    return RuntimeError(f"{what} failed: {msg.splitlines()[-1] if msg else e}")


def _probe(url, cookies=None):
    """Metadata, caption tracks and chapters of a link, without downloading."""
    import yt_dlp
    opts = {"skip_download": True, "quiet": True, "no_warnings": True, "ignore_no_formats_error": True, "noplaylist": True,
            "js_runtimes": JS_RUNTIMES, "socket_timeout": 30}
    if cookies:
        opts["cookiesfrombrowser"] = (cookies,)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False)
    except Exception as e:
        raise _yt_error(url, e, "reading the link") from None


def _download(url, d, cookies=None, fmt="bv*[height<=1920][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b", name="video"):
    import yt_dlp
    opts = {"outtmpl": str(d / f"{name}.%(ext)s"), "noplaylist": True, "quiet": True, "no_warnings": True, "noprogress": True,
            "format": fmt, "js_runtimes": JS_RUNTIMES, "socket_timeout": 30}
    if name == "video":
        opts["merge_output_format"] = "mp4"
    if cookies:
        opts["cookiesfrombrowser"] = (cookies,)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Exception as e:
        raise _yt_error(url, e) from None
    vids = sorted((p for p in d.glob(f"{name}.*") if p.suffix.lower() in MEDIA_SUFFIXES),
                  key=lambda p: p.stat().st_size, reverse=True)
    if not vids:
        raise RuntimeError(f"download produced no {name} file")
    return vids[0], info


def _platform(info, url):
    k = (info.get("extractor_key") or "").lower()
    for p in ("tiktok", "instagram", "youtube", "twitter", "facebook", "linkedin", "reddit"):
        if p in k or p in url:
            return p
    return k or "web"


TEXT_EXT = {".txt", ".md", ".markdown", ".html", ".htm"}


def _fetch_text(url):
    """Readable text of a web page (articles, threads) for text records."""
    import html as htmlmod
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh) vtk-learn"})
    raw = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", errors="replace")
    title = re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I)
    body = re.sub(r"(?is)<(script|style|nav|footer|header|noscript|svg)[^>]*>.*?</\1>", " ", raw)
    body = re.sub(r"(?i)<br\s*/?>|</p>|</h\d>|</li>", "\n", body)
    body = htmlmod.unescape(re.sub(r"<[^>]+>", " ", body))
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in body.splitlines()]
    text = "\n".join(ln for ln in lines if len(ln) > 30)
    return (htmlmod.unescape(title.group(1).strip()) if title else url), text


def _base_draft(rid, source, note):
    return {"id": rid, "source": source, "note": note, "keep": "line", "lessons": [], "confirms": [], "pages": [],
            "kind": None, "format": None, "app": {"name": None, "category": None},
            "insights": [], "why_it_works": [], "steal": [],
            "engine": {"template": None, "theme": None, "features": [], "gaps": []}, "relevance": None, "tags": []}


def url_key(url):
    """A stable key for a link: the YouTube / TikTok video id, the Instagram shortcode, else the URL without query."""
    u = str(url or "")
    for pat in (r"(?:youtube\.com/(?:watch\?v=|shorts/|live/)|youtu\.be/)([\w-]{11})", r"tiktok\.com/.*/video/(\d+)",
                r"instagram\.com/(?:reel|reels|p|tv)/([\w-]+)"):
        m = re.search(pat, u)
        if m:
            return m.group(1)
    return re.sub(r"[?#].*$", "", u).rstrip("/").lower() or None


def seen(url):
    """The library record for a link learned before (same video, any URL form), else None."""
    k = url_key(url)
    if not k:
        return None
    return next((r for r in load() if url_key(_get(r, "source.url")) == k), None)


def learn_text(src, note=None, rid=None, text=None):
    """A text source (notes, pasted text, .txt/.md file, or an article URL) -> draft for Claude to complete."""
    today = time.strftime("%Y-%m-%d")
    url, title = None, None
    if text is None and re.match(r"https?://", str(src)):
        url = src
        title, text = _fetch_text(src)
    elif text is None:
        p = Path(src).expanduser()
        if not p.is_absolute() and not p.exists():
            p = INBOX / p
        if not p.exists():
            raise FileNotFoundError(f"not found: {src} (looked in inbox/ too)")
        text = p.read_text(errors="replace")
        title = p.stem
        if p.suffix.lower() in (".html", ".htm"):
            import html as htmlmod
            text = htmlmod.unescape(re.sub(r"<[^>]+>", " ", text))
    title = title or (text.strip().splitlines() or ["note"])[0][:80]
    platform = "article" if url else "text"
    rid = rid or f"{today}_{platform}_{_slug(title, 30)}"
    d = WORK / rid
    d.mkdir(parents=True, exist_ok=True)
    (d / "text.txt").write_text(text)
    domain = re.sub(r"^https?://(www\.)?", "", url).split("/")[0] if url else None
    source = {"url": url, "media": "text", "platform": platform, "creator": domain, "title": title[:160], "posted": None,
              "captured": today, "duration": None, "metrics": {}}
    draft = _base_draft(rid, source, note)
    draft["text_excerpt"] = text.strip()[:300]
    draft["_analysis"] = {"text": str(d / "text.txt"), "chars": len(text)}
    (d / "draft.yaml").write_text(yaml.safe_dump(draft, sort_keys=False, allow_unicode=True, width=120))
    return rid, d / "draft.yaml", draft, {}


def learn(src, note=None, cookies=None, keep=False, rid=None, text=None, mode=None):
    """Download/analyse one source; write .cache/trends/<id>/draft.yaml for Claude to complete.
    Video (link or file): pacing, text zones, transcript, hook + contact sheets. Long YouTube video (interview, podcast,
    talk; or mode='talk'): its transcript + chapters, no download (mode='video' forces the full video). Audio file:
    transcript, tempo, loudness. Text (pasted, .txt/.md, or an article link): stored text.
    Returns (id, draft path, draft, analysis)."""
    from .analysis.reference import analyze
    from .contactsheet import extract_thumbs, sheet
    from .media import MEDIA_AUDIO, probe
    today = time.strftime("%Y-%m-%d")
    is_url = bool(re.match(r"https?://", str(src or "")))
    if text is not None or (not is_url and Path(str(src)).suffix.lower() in TEXT_EXT):
        return learn_text(src, note, rid, text)
    if not is_url and Path(str(src)).suffix.lower() in MEDIA_AUDIO:
        return learn_audio(src, note, rid)
    if is_url and mode != "video" and YOUTUBE.search(src) and (mode == "talk" or "/shorts/" not in src):
        info = _probe(src, cookies)                   # one metadata request; Shorts skip it
        if mode == "talk" or (info.get("duration") or 0) > LONG_TALK:
            return learn_talk(src, info, note, rid, cookies)
    WORK.mkdir(parents=True, exist_ok=True)
    tmp = WORK / f"_incoming_{int(time.time())}"
    tmp.mkdir(parents=True, exist_ok=True)
    if is_url:
        print("downloading...", flush=True)
        try:
            video, info = _download(src, tmp, cookies)
        except RuntimeError as e:
            shutil.rmtree(tmp, ignore_errors=True)
            if "Unsupported URL" in str(e) or "no video" in str(e):     # an article / thread: keep its text instead
                print("no video at this link; saving the page text instead", flush=True)
                return learn_text(src, note, rid)
            raise
        platform = _platform(info, src)
        vid = info.get("id") or _slug(info.get("title", "video"))
        rid = rid or f"{today}_{platform}_{_slug(vid, 24)}"
        up = info.get("upload_date")
        source = {"url": info.get("webpage_url") or src, "platform": platform,
                  "creator": info.get("uploader_id") and f"@{info['uploader_id']}" if platform in ("tiktok", "instagram") else
                  info.get("uploader") or info.get("channel"),
                  "title": (info.get("title") or "")[:160], "description": (info.get("description") or "")[:400],
                  "posted": f"{up[:4]}-{up[4:6]}-{up[6:]}" if up and len(up) == 8 else None, "captured": today,
                  "duration": round(float(info.get("duration") or probe(video)["duration"]), 2), "media": "video",
                  "metrics": {k: info.get(f) for k, f in (("views", "view_count"), ("likes", "like_count"),
                                                          ("comments", "comment_count"), ("shares", "repost_count"))
                              if info.get(f) is not None}}
    else:
        p = Path(src).expanduser()
        if not p.is_absolute() and not p.exists():
            p = INBOX / p
        if not p.exists():
            raise FileNotFoundError(f"not found: {src} (looked in inbox/ too)")
        video = p
        platform = "file"
        rid = rid or f"{today}_file_{_slug(p.stem, 30)}"
        source = {"url": None, "file": p.name, "media": "video", "platform": "file", "creator": None, "title": p.stem, "posted": None,
                  "captured": today, "duration": round(probe(p)["duration"], 2), "metrics": {}}
    d = WORK / rid
    if d.exists():
        shutil.rmtree(d)
    tmp.rename(d)
    if is_url:
        video = d / Path(video).name
    print("analysing pacing, text zones and sound...", flush=True)
    ref = analyze(video, d)
    print("transcribing speech...", flush=True)
    words = []
    if probe(video).get("has_audio"):
        words = _transcribe_isolated(video, d)
    spoken3 = " ".join(w["w"] for w in words if w["start"] < 3.0)
    text = " ".join(w["w"] for w in words)
    print("mapping the sound (music, effects, build-ups, silences)...", flush=True)
    snd = _sound(video, d, ref.get("cut_times") or [], words)
    hook = extract_thumbs(video, every=0.4, thumb_w=300, start=0.0, end=min(3.3, source["duration"]))
    hook_sheet = sheet(hook, d / "hook.jpg", cols=5, title="first 3 seconds")
    draft = {
        "id": rid,
        "source": source,
        "note": note,
        "kind": None, "format": None,
        "app": {"name": None, "category": None},
        "hook": {"type": None, "seconds": None, "on_screen": None, "spoken": spoken3 or None, "visual": None},
        "beats": [],
        "craft": {"shots": ref.get("shots"), "cuts_per_10s": ref.get("cuts_per_10s"), "avg_shot": ref.get("shot_len", {}).get("mean"),
                  "tempo_bpm": ref.get("tempo_bpm"), "cuts_on_beat_pct": ref.get("cuts_on_beat_pct"),
                  "text_zones_pct": ref.get("text_zones_pct"), "face_on_camera": None, "captions": None, "text_anim": None,
                  "transitions": [], "graphics": [], "camera": None, "sound": [], "music": None, "voice": None, "look": None,
                  "loop": None},
        "marketing": {"product_first_seen": None, "shown_as": None, "cta": None, "offer": None, "comment_bait": None},
        "insights": [], "why_it_works": [], "steal": [],
        "engine": {"template": None, "theme": None, "features": [], "gaps": []},
        "relevance": None, "tags": [],
        "transcript_excerpt": text[:300] or None,
        "_analysis": {"hook_sheet": str(hook_sheet[0]) if hook_sheet else None, "contact_sheets": ref.get("sheets"),
                      "scene_sheets": ref.get("scene_sheets"), "text_heat": str(d / f"ref_textheat_{Path(video).stem}.png"),
                      "transcript": text, "cut_times": ref.get("cut_times"), "video": str(video), "keep": keep,
                      "sound_map": snd["sound_map"], "sound_events": snd["events"]},
    }
    (d / "draft.yaml").write_text(yaml.safe_dump(draft, sort_keys=False, allow_unicode=True, width=120))
    return rid, d / "draft.yaml", draft, ref


def _sound(media, d, cuts, words):
    """Sound map of a video / audio file: speech ranges from the Whisper words (gaps under 0.6 s merged)."""
    from .analysis.sound import analyze_sound
    speech = []
    for w in words:
        if speech and w["start"] - speech[-1][1] < 0.6:
            speech[-1][1] = w["end"]
        else:
            speech.append([w["start"], w["end"]])
    try:
        return analyze_sound(media, d / "sound_map.png", cuts=cuts, speech=speech)
    except Exception as e:                          # a sound map is a bonus: never block learning
        print(f"  (no sound map: {e})")
        return {"sound_map": None, "events": [], "per_half_second": []}


def _clock(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}" if t >= 3600 else f"{t // 60}:{t % 60:02d}"


def _talk_md(title, words, chapters, every=20.0):
    """Readable transcript: a [m:ss] stamp every ~20 s, the chapter titles as headings."""
    L, line, t0, ci = [f"# {title}", ""], [], 0.0, 0
    ch = sorted(chapters, key=lambda c: c["t"])

    def flush():
        if line:
            L.append(f"[{_clock(t0)}] " + " ".join(line))
            line.clear()
    for t, w in words:
        while ci < len(ch) and t >= ch[ci]["t"]:
            flush()
            L += ["", f"## [{_clock(ch[ci]['t'])}] {ch[ci]['title']}", ""]
            ci += 1
        if not line:
            t0 = t
        line.append(w)
        if t - t0 >= every and re.search(r"[.?!]$", w) or t - t0 >= every * 1.5:
            flush()
    flush()
    return "\n".join(L) + "\n"


def learn_talk(url, info, note=None, rid=None, cookies=None):
    """A long video (interview, podcast, talk): learn what is said, not the edit. Reads the caption track (the creator's,
    else YouTube's speech recognition) and the chapters; no captions -> downloads only the audio for Whisper."""
    from .channel import UA, _json3_words, _pick_track
    import urllib.request
    today = time.strftime("%Y-%m-%d")
    platform = _platform(info, url)
    rid = rid or f"{today}_{platform}_talk_{_slug(info.get('id') or info.get('title', 'talk'), 24)}"
    d = WORK / rid
    d.mkdir(parents=True, exist_ok=True)
    words, source_of_words = [], None
    track = _pick_track(info)
    if track:
        print(f"reading the {track['kind']} captions...", flush=True)
        try:
            req = urllib.request.Request(track["url"], headers={"User-Agent": UA})
            words = [(t, w) for t, w in _json3_words(json.loads(urllib.request.urlopen(req, timeout=60).read()))
                     if not re.fullmatch(r"\[[^\]]*\]", w)]
            source_of_words = f"{track['kind']} captions"
        except Exception as e:
            print(f"  (captions failed: {e}; using the audio instead)")
    if not words:
        print("no captions: downloading the audio only for Whisper...", flush=True)
        audio, _ = _download(url, d, cookies, fmt="ba[ext=m4a]/ba/b", name="audio")
        words = [(w["start"], w["w"]) for w in _transcribe_isolated(audio, d)]
        source_of_words = "Whisper"
    chapters = [{"t": round(c.get("start_time") or 0, 1), "title": c.get("title")} for c in info.get("chapters") or []]
    md = _talk_md(info.get("title") or url, words, chapters)
    (d / "transcript.md").write_text(md)
    up = info.get("upload_date")
    source = {"url": info.get("webpage_url") or url, "media": "talk", "platform": platform,
              "creator": info.get("channel") or info.get("uploader"), "title": (info.get("title") or "")[:160],
              "description": (info.get("description") or "")[:400],
              "posted": f"{up[:4]}-{up[4:6]}-{up[6:]}" if up and len(up) == 8 else None, "captured": today,
              "duration": info.get("duration"),
              "metrics": {k: info.get(f) for k, f in (("views", "view_count"), ("likes", "like_count"), ("comments", "comment_count"))
                          if info.get(f) is not None}}
    draft = _base_draft(rid, source, note)
    draft["chapters"] = chapters
    draft["text_excerpt"] = " ".join(w for _, w in words)[:300]
    draft["_analysis"] = {"text": str(d / "transcript.md"), "chars": len(md), "words": len(words), "captions": source_of_words}
    (d / "draft.yaml").write_text(yaml.safe_dump(draft, sort_keys=False, allow_unicode=True, width=120))
    return rid, d / "draft.yaml", draft, {}


def _transcribe_isolated(video, d):
    """Whisper in its own process: scene detection hides PyAV (it clashes with OpenCV), which faster-whisper needs."""
    import subprocess
    import sys
    p = subprocess.run([sys.executable, "-m", "toolkit", "voiceover", str(video), "--out", str(d)], cwd=ROOT,
                       capture_output=True, text=True)
    f = d / f"{Path(video).stem}.transcript.json"
    if p.returncode != 0 or not f.exists():
        tail = (p.stderr or p.stdout or "").strip().splitlines()[-1:] or ["?"]
        print(f"  (no transcript: {tail[0]})")
        return []
    return json.loads(f.read_text()).get("words", [])


def learn_audio(src, note=None, rid=None):
    """An audio file (voice note, podcast clip, a trending sound) -> transcript + tempo/loudness -> draft."""
    from .analysis.audio_analysis import analyze as audio_analyze
    today = time.strftime("%Y-%m-%d")
    p = Path(src).expanduser()
    if not p.is_absolute() and not p.exists():
        p = INBOX / p
    if not p.exists():
        raise FileNotFoundError(f"not found: {src} (looked in inbox/ too)")
    rid = rid or f"{today}_audio_{_slug(p.stem, 30)}"
    d = WORK / rid
    d.mkdir(parents=True, exist_ok=True)
    print("analysing tempo and loudness...", flush=True)
    au = audio_analyze(p, d)
    print("transcribing speech...", flush=True)
    words = _transcribe_isolated(p, d)
    text = " ".join(w["w"] for w in words)
    snd = _sound(p, d, [], words)
    source = {"url": None, "file": p.name, "media": "audio", "platform": "audio", "creator": None, "title": p.stem, "posted": None,
              "captured": today, "duration": au.get("duration"), "metrics": {}}
    draft = _base_draft(rid, source, note)
    draft["craft"] = {"tempo_bpm": au.get("tempo_bpm"), "loudness_lufs": au.get("loudness_lufs"), "music": None, "voice": None, "sound": []}
    draft["transcript_excerpt"] = text[:300] or None
    draft["_analysis"] = {"transcript": text, "silences": au.get("silences"), "sound_map": snd["sound_map"],
                          "sound_events": snd["events"]}
    (d / "draft.yaml").write_text(yaml.safe_dump(draft, sort_keys=False, allow_unicode=True, width=120))
    ref = {"tempo_bpm": au.get("tempo_bpm")}
    return rid, d / "draft.yaml", draft, ref


# ------------------------------------------------------------------ validate / commit
def validate(r):
    errs = []
    media = (r.get("source") or {}).get("media", "video")
    if r.get("keep", "line") != "full" and media != "channel":     # one line per source: what it taught or confirmed
        for f in ("kind", "relevance"):
            if r.get(f) in (None, "", []):
                errs.append(f"{f}: required")
        if not (r.get("lessons") or r.get("confirms")) and (r.get("relevance") or 0) > 2:
            errs.append("lessons (the NEW lessons you wrote into the brain) or confirms (the brain lines it backs up): "
                        "add at least one, or set relevance 1-2 for an off-topic source")
        if r.get("kind") and r["kind"] not in KINDS:
            errs.append(f"kind: '{r['kind']}' not in {KINDS} (scope is video craft + app marketing)")
        rel = r.get("relevance")
        if rel is not None and not (isinstance(rel, int) and 1 <= rel <= 5):
            errs.append("relevance: 1-5")
        bad = [p for p in r.get("pages") or [] if not (PAGES / f"{p}.md").exists()]
        if bad:
            errs.append(f"pages: unknown {bad} (have: {', '.join(sorted(x.stem for x in PAGES.glob('*.md')))})")
        return errs
    required = REQUIRED if media == "video" else ["kind", "relevance"]
    for f in required:
        v = _get(r, f)
        if v in (None, "", []):
            errs.append(f"{f}: required")
    if media != "video" and not (r.get("insights") or r.get("why_it_works")):
        errs.append("insights: add the key takeaways (or why_it_works)")
    if r.get("kind") and r["kind"] not in KINDS:
        errs.append(f"kind: '{r['kind']}' not in {KINDS} (scope is video craft + app marketing)")
    if r.get("format") and r["format"] not in FORMATS and media == "video":
        errs.append(f"format: '{r['format']}' not in {FORMATS}")
    if _get(r, "hook.type") and r["hook"]["type"] not in HOOK_TYPES:
        errs.append(f"hook.type: '{r['hook']['type']}' not in {HOOK_TYPES}")
    for i, b in enumerate(r.get("beats") or []):
        if not isinstance(b, dict) or "t" not in b or "role" not in b or "what" not in b:
            errs.append(f"beats[{i}]: needs t: [start, end], role, what")
        elif b["role"] not in ROLES:
            errs.append(f"beats[{i}].role: '{b['role']}' not in {ROLES}")
    rel = r.get("relevance")
    if rel is not None and not (isinstance(rel, int) and 1 <= rel <= 5):
        errs.append("relevance: 1-5")
    return errs


def commit(rid):
    d = WORK / rid
    f = d / "draft.yaml"
    if not f.exists():
        raise FileNotFoundError(f"no draft for '{rid}' (run ./vtk learn first); drafts: {', '.join(p.name for p in WORK.glob('*') if (p / 'draft.yaml').exists())}")
    r = yaml.safe_load(f.read_text())
    errs = validate(r)
    if errs:
        raise ValueError("draft is incomplete:\n  " + "\n  ".join(errs))
    an = r.pop("_analysis", {}) or {}
    if r.pop("keep", "line") != "full" and (r.get("source") or {}).get("media") != "channel":
        r = {k: r[k] for k in SLIM_KEYS if r.get(k) not in (None, [], {})}     # the lessons live in the brain pages
    recs = [x for x in load() if x["id"] != r["id"]]
    recs.append(r)
    save(recs)
    write_sources(recs)
    if not an.get("keep"):
        slim(d)
    return r, len(recs)


def _summary(r, n=150):
    """One line for SOURCES.md: the lessons it gave, else what it confirmed, else its first takeaway."""
    if r.get("lessons"):
        s = "; ".join(r["lessons"])
    elif r.get("confirms"):
        s = "confirms: " + "; ".join(r["confirms"])
    else:
        s = next((x for k in ("steal", "why_it_works", "insights") for x in (r.get(k) or [])), "")
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"


def write_sources(recs=None):
    """trends/SOURCES.md: every source learned, newest first, one line each (generated; never edited by hand)."""
    recs = load() if recs is None else recs
    L = ["# Sources the brain learned from", "",
         "Generated by `./vtk kb commit` from `library.jsonl`: don't edit. Newest first. The lessons themselves live in",
         "`BRAIN.md` and `brain/*.md`; 📝 = full notes kept (`./vtk kb show <id>`).", ""]
    for r in sorted(recs, key=lambda r: ((r.get("source") or {}).get("captured") or "", r["id"]), reverse=True):
        src = r.get("source") or {}
        m = src.get("metrics") or {}
        v = m.get("views") or m.get("top_views")
        vs = f"{v / 1e6:.1f}M views" if v and v >= 1e6 else f"{v / 1e3:.0f}K views" if v else ""
        title = (src.get("title") or r["id"]).replace("[", "(").replace("]", ")")[:70]
        link = f"[{title}]({src['url']})" if src.get("url") else title
        pages = ", ".join(r.get("pages") or [])
        full = " 📝" if any(k in r for k in ("beats", "insights", "hook_bank")) else ""
        parts = [src.get("captured") or "", src.get("creator") or "", link + full] + ([vs] if vs else [])
        L.append("- " + " · ".join(p for p in parts if p) + (f" → **{pages}**: " if pages else " → ") + _summary(r))
    SOURCES.write_text("\n".join(L) + "\n")


def _size(p):
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.is_dir() else p.stat().st_size


def slim(d):
    """After commit the record holds what matters: keep the draft, the hook still and small text/JSON (transcripts);
    delete the video, contact sheets and cached captions (~8 MB -> ~150 KB per video). Returns bytes freed."""
    freed = 0
    for p in list(d.iterdir()):
        if p.name == "hook.jpg":
            continue
        if p.is_dir() or p.suffix.lower() in MEDIA_SUFFIXES:
            freed += _size(p)
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    return freed


def clean():
    """Slim the cache of every committed record (unless learned with --keep) and drop failed downloads.
    Returns (bytes freed, folders touched)."""
    ids = {r["id"] for r in load()}
    freed, n = 0, 0
    for d in sorted(WORK.iterdir()) if WORK.exists() else []:
        if not d.is_dir():
            continue
        if d.name.startswith("_incoming_"):
            freed += _size(d)
            shutil.rmtree(d)
            n += 1
        elif d.name in ids:
            try:
                keep = ((yaml.safe_load((d / "draft.yaml").read_text()) or {}).get("_analysis") or {}).get("keep")
            except Exception:
                keep = False
            if not keep:
                f = slim(d)
                freed += f
                n += f > 0
    return freed, n


def brain_usage():
    """('brain: BRAIN 32/40 · hooks 38/80 · ...', [pages over their cap])"""
    if not BRAIN.exists():
        return "no trends/BRAIN.md yet", []
    parts, over = [], []
    for f in [BRAIN] + sorted(PAGES.glob("*.md")):
        t = f.read_text()
        lines, size = len(t.splitlines()), len(t.encode()) / 1000
        b = BUDGET["brain" if f == BRAIN else "page"]
        name = "BRAIN" if f == BRAIN else f.stem
        parts.append(f"{name} {lines}/{b['lines']}")
        if lines > b["lines"] or size > b["kb"]:
            over.append(f"{name} ({lines} lines, {size:.1f}/{b['kb']} KB)")
    msg = "brain: " + " · ".join(parts)
    if over:
        msg += (" -- OVER: " + ", ".join(over) + ": merge lines that say the same thing, move the weakest / oldest to "
                f"trends/{ARCHIVE.name}")
    return msg, over


def remove(rid):
    recs = load()
    keep = [r for r in recs if r["id"] != rid]
    if len(keep) == len(recs):
        return False
    save(keep)
    return True


# ------------------------------------------------------------------ search / stats / export
def _days_ago(date):
    try:
        return (time.time() - time.mktime(time.strptime(date, "%Y-%m-%d"))) / 86400
    except Exception:
        return 1e9


_STOP = set("the a an and or to of in on for with is are was be it this that you your i we our they he she at as by from "
            "but not have has so if do just can will what how about into than then them there their when which who why "
            "want need make more most like get going really video videos thing things people".split())


def _words(text):
    return {w for w in re.findall(r"[a-z][a-z']{3,}", (text or "").lower()) if w not in _STOP}


def related(text, exclude=None, limit=3):
    """Library records that overlap a new source (shared ideas in title, tags, insights, why_it_works, steal),
    so the new record can say what is new and what only confirms what we know. Returns [(score, record)]."""
    new, out = _words(text), []
    for r in load():
        if r.get("id") == exclude:
            continue
        body = " ".join([str(_get(r, "source.title") or ""), str(r.get("format") or ""), " ".join(r.get("tags") or []),
                         " ".join(r.get("insights") or []), " ".join(r.get("why_it_works") or []),
                         " ".join(r.get("steal") or []), " ".join(r.get("lessons") or []),
                         " ".join(r.get("confirms") or [])])
        old = _words(body)
        if old:
            score = len(new & old) / (len(old) ** 0.5)
            if score > 0:
                out.append((round(score, 2), r))
    return sorted(out, key=lambda x: -x[0])[:limit]


def search(q=None, fmt=None, kind=None, platform=None, tag=None, since=None, min_views=None, min_rel=None, limit=20):
    out = []
    for r in load():
        if fmt and r.get("format") != fmt:
            continue
        if kind and r.get("kind") != kind:
            continue
        if platform and r.get("source", {}).get("platform") != platform:
            continue
        if tag and tag not in (r.get("tags") or []):
            continue
        if since and _days_ago(r.get("source", {}).get("captured", "")) > since:
            continue
        if min_views and (r.get("source", {}).get("metrics", {}).get("views") or 0) < min_views:
            continue
        if min_rel and (r.get("relevance") or 0) < min_rel:
            continue
        if q:
            blob = json.dumps(r, ensure_ascii=False).lower()
            if not all(w in blob for w in q.lower().split()):
                continue
        out.append(r)
    out.sort(key=lambda r: (-(r.get("relevance") or 0), -_ts(r)))
    return out[:limit]


def _ts(r):
    return -_days_ago(r.get("source", {}).get("captured", ""))


def row(r):
    m = r.get("source", {}).get("metrics", {})
    v = m.get("views") or m.get("top_views")        # a channel study shows its biggest video
    vs = f"{v / 1e6:.1f}M" if v and v >= 1e6 else f"{v / 1e3:.0f}k" if v else "-"
    why = (r.get("lessons") or r.get("why_it_works") or r.get("confirms") or [""])[0]
    return f"{r['id'][:44]:44s} {r.get('format', ''):16s} {(r.get('hook') or {}).get('type', ''):16s} {vs:>6s}  r{r.get('relevance', '-')}  {why[:70]}"


def stats(since=90):
    recs = [r for r in load() if _days_ago(r.get("source", {}).get("captured", "")) <= since]
    if not recs:
        return f"nothing captured in the last {since} days (library: {len(load())})"
    from collections import Counter

    def top(c, n=8):
        return ", ".join(f"{k} {v}" for k, v in c.most_common(n) if k)

    def med(vals):
        vals = [v for v in vals if isinstance(v, (int, float))]
        return round(statistics.median(vals), 2) if vals else "-"
    from collections import Counter as _C
    media = _C((r.get("source") or {}).get("media", "video") for r in recs)
    L = [f"{len(recs)} items in the last {since} days (library {len(load())}): " + ", ".join(f"{v} {k}" for k, v in media.items()),
         f"formats: {top(Counter(r.get('format') for r in recs))}",
         f"hook types: {top(Counter((r.get('hook') or {}).get('type') for r in recs))}",
         f"platforms: {top(Counter(r.get('source', {}).get('platform') for r in recs))}",
         f"median: length {med([r.get('source', {}).get('duration') for r in recs])}s, hook {med([(r.get('hook') or {}).get('seconds') for r in recs])}s, "
         f"cuts/10s {med([(r.get('craft') or {}).get('cuts_per_10s') for r in recs])}, product first seen "
         f"{med([(r.get('marketing') or {}).get('product_first_seen') for r in recs if r.get('kind') == 'app_marketing'])}s",
         f"faceless: {sum(1 for r in recs if (r.get('craft') or {}).get('face_on_camera') is False)}/{len(recs)}",
         f"text animation: {top(Counter((r.get('craft') or {}).get('text_anim') for r in recs))}",
         f"transitions: {top(Counter(t for r in recs for t in (r.get('craft') or {}).get('transitions') or []))}",
         f"graphics: {top(Counter(t for r in recs for t in (r.get('craft') or {}).get('graphics') or []))}",
         f"tags: {top(Counter(t for r in recs for t in r.get('tags') or []), 12)}",
         f"engine gaps (features to build): {top(Counter(g for r in recs for g in (r.get('engine') or {}).get('gaps') or []), 12) or 'none'}"]
    return "\n".join(L)


def export_sql():
    """Postgres import for the VPS: ./vtk kb export --sql | ssh vps psql <db>"""
    lines = ["CREATE TABLE IF NOT EXISTS short_videos (id text PRIMARY KEY, captured date, media text, platform text, kind text,",
             "  format text, hook_type text, views bigint, relevance int, record jsonb NOT NULL);"]
    for r in load():
        rec = json.dumps(r, ensure_ascii=False).replace("'", "''")
        src = r.get("source", {})
        vals = [r["id"], src.get("captured"), src.get("media", "video"), src.get("platform"), r.get("kind"), r.get("format"),
                (r.get("hook") or {}).get("type")]
        sv = ", ".join("NULL" if v is None else "'" + str(v).replace("'", "''") + "'" for v in vals)
        views = src.get("metrics", {}).get("views")
        lines.append(f"INSERT INTO short_videos VALUES ({sv}, {views if views is not None else 'NULL'}, "
                     f"{r.get('relevance') or 'NULL'}, '{rec}'::jsonb) ON CONFLICT (id) DO UPDATE SET record = EXCLUDED.record, "
                     f"views = EXCLUDED.views, relevance = EXCLUDED.relevance;")
    return "\n".join(lines) + "\n"
