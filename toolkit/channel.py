"""Channel study: learn a creator's Shorts at scale without watching them all (YouTube).

    ./vtk learn https://www.youtube.com/@creator/shorts [--top 60] [--recent 10] [--picks 6]

1. List every video (titles + views only, nothing downloaded): how many, how many sponsored, and in which era the hits live.
2. Sample the top N non-sponsored videos by views + the M newest, and read YouTube's word-timed captions for each (text only,
   cached in .cache/trends/<id>/captions/, deleted on commit).
3. Narration numbers per video (speech start, words in the first 3 s, words/s, pauses, silence at the end, I / you / we,
   numbers, opener type), sample medians, title patterns, and transcripts.md: every sampled script with its first and last
   3 s, for Claude to read.
4. Suggest a few videos for a deep `./vtk learn <url>` (one per opener type + the newest) for pacing and sound, and draw
   frame sheets for them from YouTube's thumbnail images (cover, first frame, 25 / 50 / 75 %; no video download): enough
   to read fonts, caption styles, graphics and framing.
5. Write ONE profile draft (source.media: channel). Claude fills hook_bank / insights, then ./vtk kb commit <id>.

YouTube answers too many requests in a row with a "confirm you're not a bot" wall (for an hour or more, downloads too),
so captions are read 2 at a time with a pause, and the study stops at the first wall.
"""
import json
import math
import re
import statistics
import threading
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

import yaml

from .kb import WORK, _slug

JS = {"deno": {"path": None}, "node": {"path": None}}
UA = "Mozilla/5.0 (Macintosh) vtk-learn"
CHANNEL = re.compile(r"^https?://(?:www\.|m\.)?youtube\.com/(@[\w.\-]+|channel/[\w\-]+|c/[\w.\-]+|user/[\w.\-]+)"
                     r"(?:/(shorts|videos|streams|featured))?/?(?:\?.*)?$", re.I)
SPONSORED = re.compile(r"#(?:ads?|sponsored|partner\w*|hosted\w*|paid\w*)\b|\bpaid partnership\b", re.I)
TAG = re.compile(r"^\[[^\]]*\]$")                    # [Music], [Applause] in auto-captions
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿⭐]")
OPENERS = {
    "question": {"what", "what's", "whats", "how", "can", "could", "is", "are", "does", "do", "did", "will", "would", "which",
                 "who", "why", "where", "should", "have", "has"},
    "i_story": {"i", "i'm", "im", "i've", "i'll", "i'd", "me", "my"},
    "you": {"you", "your", "you're", "youre", "you've", "if"},
    "we": {"we", "we're", "our", "us"},
    "this": {"this", "these", "that", "here", "here's", "there's", "meet"},
}
NUMBER_WORDS = {"one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fifteen",
                "twenty", "thirty", "forty", "fifty", "hundred", "thousand", "million", "billion", "dollar", "dollars", "bucks",
                "cents", "percent", "half", "double", "triple"}
PRONOUNS = {"i": {"i", "i'm", "im", "i've", "i'll", "i'd", "me", "my", "mine", "myself"},
            "you": {"you", "your", "you're", "youre", "yours", "you've", "you'll", "yourself"},
            "we": {"we", "we're", "our", "ours", "us", "we've", "we'll"}}


def is_channel(url):
    return bool(CHANNEL.match(str(url).strip()))


def fmt_views(v):
    if v is None:
        return "-"
    return f"{v / 1e6:.0f}M" if v >= 1e7 else f"{v / 1e6:.1f}M" if v >= 1e6 else f"{v / 1e3:.0f}K"


def _date(u):
    return f"{u[:4]}-{u[4:6]}-{u[6:]}" if u and len(u) == 8 else None


def _opts(cookies=None, **kw):
    o = {"skip_download": True, "quiet": True, "no_warnings": True, "js_runtimes": JS, "socket_timeout": 30, **kw}
    if cookies:
        o["cookiesfrombrowser"] = (cookies,)
    return o


# ------------------------------------------------------------------ listing + captions
def _list(tab_url, d, cookies=None, refresh=False):
    f, fm = d / "list.jsonl", d / "channel.json"
    if f.exists() and fm.exists() and not refresh:
        return json.loads(fm.read_text()), [json.loads(x) for x in f.read_text().splitlines() if x.strip()]
    import yt_dlp
    with yt_dlp.YoutubeDL(_opts(cookies, extract_flat="in_playlist", ignoreerrors=True)) as ydl:
        info = ydl.extract_info(tab_url, download=False) or {}
    rows = []
    for e in info.get("entries") or []:
        if e and e.get("id"):
            rows.append({"i": len(rows) + 1, "id": e["id"], "title": (e.get("title") or "").strip(), "views": e.get("view_count"),
                         "sponsored": bool(SPONSORED.search(e.get("title") or ""))})
    if not rows:
        raise RuntimeError(f"no videos found at {tab_url}")
    meta = {"channel": info.get("channel") or info.get("uploader") or re.sub(r" - \w+$", "", info.get("title") or "?"),
            "handle": info.get("uploader_id"), "followers": info.get("channel_follower_count"), "url": tab_url}
    f.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    fm.write_text(json.dumps(meta, ensure_ascii=False))
    return meta, rows


def _pick_track(info):
    """json3 caption track: the creator's own subtitles first, else YouTube's speech recognition (original language)."""
    lang = (info.get("language") or "en").split("-")[0]
    subs, auto = info.get("subtitles") or {}, info.get("automatic_captions") or {}

    def j3(pool, key):
        return next((x for x in pool.get(key) or [] if x.get("ext") == "json3"), None)
    for key in (lang, f"{lang}-orig", "en", "en-US", "en-GB"):
        if j3(subs, key):
            return {"url": j3(subs, key)["url"], "kind": "manual"}
    for key in (f"{lang}-orig", lang, "en-orig", "en"):
        if j3(auto, key):
            return {"url": j3(auto, key)["url"], "kind": "auto"}
    return None


def _json3_words(j):
    """[(start s, word)] from a json3 track: per-word offsets (speech recognition) or words spread over each line (manual)."""
    out = []
    for ev in j.get("events") or []:
        segs = [s for s in ev.get("segs") or [] if (s.get("utf8") or "").strip()]
        if not segs:
            continue
        t0, dur = (ev.get("tStartMs") or 0) / 1000, (ev.get("dDurationMs") or 0) / 1000
        if all(len(s["utf8"].split()) == 1 for s in segs) and (len(segs) == 1 or "tOffsetMs" in segs[-1]):
            out += [(round(t0 + (s.get("tOffsetMs") or 0) / 1000, 2), s["utf8"].strip()) for s in segs]
        else:
            toks = " ".join(s["utf8"] for s in segs).split()
            out += [(round(t0 + dur * k / len(toks), 2), w) for k, w in enumerate(toks)]
    return sorted(out, key=lambda x: x[0])


BOT_WALL = re.compile(r"not a bot|confirm you|sign in to confirm", re.I)


def _fetch(url, vid, d, cookies=None, stop=None, pause=0.6):
    f = d / "captions" / f"{vid}.json"
    if f.exists():
        return json.loads(f.read_text())
    if stop is not None and stop.is_set():
        return {"id": vid, "error": "skipped after YouTube's bot check"}
    import yt_dlp
    time.sleep(pause)                                # stay under YouTube's burst limit
    try:
        with yt_dlp.YoutubeDL(_opts(cookies, ignore_no_formats_error=True)) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        msg = (str(e).strip().splitlines() or ["?"])[-1][:240]
        if stop is not None and BOT_WALL.search(msg):
            stop.set()
        return {"id": vid, "error": msg}
    out = {"id": vid, **{k: info.get(k) for k in ("title", "duration", "upload_date", "view_count", "like_count", "comment_count")}}
    track, words = _pick_track(info), []
    if track:
        try:
            req = urllib.request.Request(track["url"], headers={"User-Agent": UA})
            words = _json3_words(json.loads(urllib.request.urlopen(req, timeout=30).read()))
            out["captions"] = track["kind"]
        except Exception as e:
            out["error"] = f"captions: {e}"[:240]
    out["words"] = words
    if not out.get("error"):                     # errors are retried on the next run
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(out, ensure_ascii=False))
    return out


# ------------------------------------------------------------------ numbers
def _norm(w):
    return re.sub(r"[^\w'$]", "", w.lower().replace("’", "'"))


def _narration(words, duration):
    ws = [(t, w) for t, w in words if not TAG.match(w)]
    if len(ws) < 6:
        return {"speech": False, "music_tags": len(words) - len(ws)}
    t = [x[0] for x in ws]
    start, end = t[0], t[-1] + 0.35                 # the last word's start + a typical word length
    span = max(1.0, end - start)
    gaps = [b - a for a, b in zip(t, t[1:])]
    low = [_norm(w) for _, w in ws]
    first = [w for tt, w in ws if tt < 3.0]
    last = [w for tt, w in ws if tt >= end - 3.0]

    def isnum(w):
        return bool(re.search(r"[\d$]", w)) or w in NUMBER_WORDS
    return {"speech": True, "speech_start": round(start, 2), "words": len(ws), "wps": round(len(ws) / span, 2),
            "words_0_3s": len(first), "first_3s": " ".join(first), "last_3s": " ".join(last),
            "tail": round(max(0.0, duration - end), 2) if duration else None,
            "pauses_per_10s": round(10 * sum(g >= 0.8 for g in gaps) / span, 2),     # word starts >= 0.8 s apart
            "opener_type": next((k for k, s in OPENERS.items() if low[0] in s), "other"), "opener2": " ".join(low[:2]),
            "number_first_3s": any(isnum(_norm(w)) for w in first),
            "n_i": sum(w in PRONOUNS["i"] for w in low), "n_you": sum(w in PRONOUNS["you"] for w in low),
            "n_we": sum(w in PRONOUNS["we"] for w in low), "n_numbers": sum(isnum(w) for w in low),
            "music_tags": len(words) - len(ws), "text": " ".join(w for _, w in ws)}


def _aggregate(entries):
    sp = [e for e in entries if e.get("speech")]
    if not sp:
        return {}

    def med(k):
        vals = [e[k] for e in sp if isinstance(e.get(k), (int, float))]
        return round(statistics.median(vals), 2) if vals else None
    words = sum(e["words"] for e in sp) or 1
    tails = [e["tail"] for e in sp if e.get("tail") is not None]
    return {"duration": med("duration"), "speech_start": med("speech_start"), "words_0_3s": med("words_0_3s"), "wps": med("wps"),
            "pauses_per_10s": med("pauses_per_10s"), "tail_silence": med("tail"),
            "ends_talking_pct": round(100 * sum(x <= 1.0 for x in tails) / len(tails)) if tails else None,
            "number_first_3s_pct": round(100 * sum(e["number_first_3s"] for e in sp) / len(sp)),
            "openers": dict(Counter(e["opener_type"] for e in sp).most_common()),
            "first_words": [f"{w} ({c})" for w, c in Counter(e["opener2"] for e in sp).most_common(10)],
            "per_100_words": {k: round(100 * sum(e[f"n_{k}"] for e in sp) / words, 1) for k in ("i", "you", "we", "numbers")}}


def _titles(entries):
    ts = [e["title"] or "" for e in entries]
    n = len(ts) or 1

    def pct(f):
        return round(100 * sum(1 for t in ts if f(t)) / n)
    clean = [re.sub(r"[#@]\S+", "", t).strip() for t in ts]
    return {"question": pct(lambda t: "?" in t), "money": pct(lambda t: "$" in t),
            "versus": pct(lambda t: re.search(r"\bvs\.?\b|\bversus\b", t, re.I)),
            "starts_with_i": pct(lambda t: re.match(r"i\b|i['’]", t.strip(), re.I)),
            "emoji": pct(lambda t: EMOJI.search(t)),
            "words": statistics.median([len(c.split()) for c in clean]) if clean else None}


def _eras(rows):
    """Blocks newest -> oldest: median views and how many of the channel's biggest non-sponsored hits each block holds."""
    org = [r for r in rows if not r["sponsored"] and r.get("views") is not None]
    k = min(100, max(10, len(org) // 10))
    top_ids = {r["id"] for r in sorted(org, key=lambda r: -r["views"])[:k]}
    size = max(25, math.ceil(len(rows) / 10))
    out = []
    for s in range(0, len(rows), size):
        blk = rows[s:s + size]
        v = [r["views"] for r in blk if not r["sponsored"] and r.get("views") is not None]
        out.append({"videos": f"#{s + 1}-{s + len(blk)}", "first": s + 1, "last": s + len(blk),
                    "median_views": int(statistics.median(v)) if v else None,
                    "in_top": sum(r["id"] in top_ids for r in blk), "sponsored": sum(r["sponsored"] for r in blk)})
    return k, out


def _picks(top_s, new_s, n):
    """One per opener type among the bigger half of the sample, filled up by views, + the 2 newest narrated ones
    (40+ words: skips music / lip-sync clips)."""
    sp = [e for e in top_s if e.get("speech") and e["words"] >= 40]
    pool = sp[:max(n * 3, len(sp) // 2)]
    rank = {e["id"]: i + 1 for i, e in enumerate(top_s)}
    out, seen = [], set()
    for e in pool:
        if len(out) >= n:
            break
        if e["opener_type"] not in seen:
            seen.add(e["opener_type"])
            out.append(dict(e, why=f"#{rank[e['id']]} by views, {e['opener_type']} opener"))
    for e in sp:
        if len(out) >= n:
            break
        if all(o["id"] != e["id"] for o in out):
            out.append(dict(e, why=f"#{rank[e['id']]} by views"))
    out.sort(key=lambda e: -(e["views"] or 0))
    return out + [dict(e, why=f"newest, posted {e['posted']}")
                  for e in [e for e in new_s if e.get("speech") and e["words"] >= 40][:2]]


THUMBS = [("cover", ["oardefault", "oar2", "hq720", "maxresdefault"]), ("first frame", ["frame0"]),
          ("25%", ["maxres1", "hq1"]), ("50%", ["maxres2", "hq2"]), ("75%", ["maxres3", "hq3"])]


def _thumb(vid, names, cache):
    from PIL import Image
    for n in names:
        p = cache / f"{vid}_{n}.jpg"
        if not p.exists():
            try:
                req = urllib.request.Request(f"https://i.ytimg.com/vi/{vid}/{n}.jpg", headers={"User-Agent": UA})
                p.write_bytes(urllib.request.urlopen(req, timeout=20).read())
            except Exception:
                continue
        if p.stat().st_size > 2000:
            return Image.open(p).convert("RGB")
    return None


def frame_sheets(entries, d, per_sheet=3):
    """Cover, first frame and the 25 / 50 / 75 % frames of each video from YouTube's thumbnail images (a CDN apart from
    the player, so it works without downloads and past the bot wall). Returns the sheet paths."""
    from PIL import Image, ImageDraw, ImageFont
    from .paths import ROOT
    cache = d / "thumbs"
    cache.mkdir(exist_ok=True)
    try:
        font = ImageFont.truetype(str(ROOT / "brand/fonts/Inter/Inter-SemiBold.otf"), 26)
    except OSError:
        font = ImageFont.load_default()
    tw, th, head = 360, 640, 38
    rows = []
    for e in entries:
        row = Image.new("RGB", (tw * len(THUMBS), th + head), "white")
        for i, (_, names) in enumerate(THUMBS):
            im = _thumb(e["id"], names, cache)
            if im is None:
                continue
            if im.width > im.height:                  # landscape auto-frames: the vertical video sits in the middle
                w = round(im.height * 9 / 16)
                im = im.crop(((im.width - w) // 2, 0, (im.width + w) // 2, im.height))
            row.paste(im.resize((tw, th)), (i * tw, head))
        ImageDraw.Draw(row).text((8, 5), f"{fmt_views(e.get('views'))} · {(e.get('title') or '')[:48]} · {e.get('posted') or '?'}"
                                 f"    {' | '.join(n for n, _ in THUMBS)}", fill="black", font=font)
        rows.append(row)
    out = []
    for s in range(0, len(rows), per_sheet):
        grp = rows[s:s + per_sheet]
        sheet = Image.new("RGB", (grp[0].width, sum(r.height for r in grp)), "white")
        for k, r in enumerate(grp):
            sheet.paste(r, (0, k * r.height))
        p = d / f"frames_{s // per_sheet + 1}.jpg"
        sheet.save(p, quality=88)
        out.append(str(p))
    return out


def _write_md(path, meta, rows, k, eras, agg, titles, top_s, new_s):
    fv = fmt_views
    org = [r["views"] for r in rows if not r["sponsored"] and r.get("views") is not None]
    L = [f"# {meta['channel']}: channel study ({time.strftime('%Y-%m-%d')})", "",
         f"{len(rows):,} videos listed ({meta['url']}), {sum(r['sponsored'] for r in rows)} sponsored. "
         f"Median views {fv(statistics.median(org))}, top {fv(max(org))}.", "",
         f"## Where the hits are (newest -> oldest; top {k} = the {k} most-viewed non-sponsored)", "",
         f"| videos | posted (sampled) | median views | in the top {k} | sponsored |", "|---|---|---|---|---|"]
    L += [f"| {e['videos']} | {e.get('posted') or '-'} | {fv(e['median_views'])} | {e['in_top']} | {e['sponsored']} |" for e in eras]
    L += ["", "## Narration (sample medians)", "", "```", yaml.safe_dump(agg, sort_keys=False, allow_unicode=True).strip(), "```",
          "", "## Titles (% of the sample)", "", "```", yaml.safe_dump(titles, sort_keys=False).strip(), "```", ""]

    def block(title, entries):
        out = [f"## {title}", ""]
        for n, e in enumerate(entries, 1):
            head = f"### {n} · {fv(e['views'])} · {e['title']} · {e.get('posted') or '?'} · {e.get('duration') or '?'} s"
            if not e.get("speech"):
                out += [head, "(no speech in the captions" + (f": {e['error']}" if e.get("error") else "") + ")", ""]
                continue
            out += [head, f"speech at {e['speech_start']} s · {e['wps']} words/s · {e['words_0_3s']} words in 0-3 s · "
                          f"{e['pauses_per_10s']} pauses/10 s · silent end {e['tail']} s · {e['opener_type']} opener",
                    f"- **0-3 s:** {e['first_3s']}", f"- **last 3 s:** {e['last_3s']}", f"- {e['text']}", ""]
        return out
    L += block(f"Scripts: top {len(top_s)} by views", top_s)
    L += block(f"Scripts: {len(new_s)} newest", new_s)
    path.write_text("\n".join(L) + "\n")


# ------------------------------------------------------------------ study
def study(url, top=60, recent=10, picks=6, note=None, cookies=None, refresh=False, rid=None, workers=2):
    """Returns (id, draft path, draft, {top_k, picks, transcripts, frame_sheets})."""
    m = CHANNEL.match(str(url).strip())
    if not m:
        raise RuntimeError(f"not a YouTube channel link: {url}")
    tab = (m.group(2) or "shorts").lower()
    tab = "shorts" if tab == "featured" else tab
    tab_url = f"https://www.youtube.com/{m.group(1)}/{tab}"
    today = time.strftime("%Y-%m-%d")
    rid = rid or f"{today}_youtube_channel_{_slug(m.group(1).split('/')[-1].lstrip('@'), 24)}"
    d = WORK / rid
    d.mkdir(parents=True, exist_ok=True)
    print(f"listing {tab_url} (titles + views only)...", flush=True)
    meta, rows = _list(tab_url, d, cookies, refresh)
    meta["url"] = tab_url
    organic = [r for r in rows if not r["sponsored"] and r.get("views") is not None]
    sample_top = sorted(organic, key=lambda r: -r["views"])[:top]
    taken = {r["id"] for r in sample_top}
    sample_new = [r for r in organic if r["id"] not in taken][:recent]          # the list is newest first

    def link(vid):
        return f"https://www.youtube.com/shorts/{vid}" if tab == "shorts" else f"https://www.youtube.com/watch?v={vid}"
    sample = sample_top + sample_new
    print(f"reading captions for {len(sample)} videos (top {len(sample_top)} by views + {len(sample_new)} newest; text only)...",
          flush=True)
    got, errors, stop = {}, [], threading.Event()
    with ThreadPoolExecutor(workers) as ex:
        futs = [ex.submit(_fetch, link(r["id"]), r["id"], d, cookies, stop) for r in sample]
        for n, f in enumerate(as_completed(futs), 1):
            v = f.result()
            got[v["id"]] = v
            if v.get("error"):
                errors.append(v["error"])
            if n % 10 == 0 or n == len(sample):
                print(f"  {n}/{len(sample)}", flush=True)
    if stop.is_set():
        ok = sum(1 for v in got.values() if not v.get("error"))
        print(f"  YouTube asked to confirm we're not a bot: stopped with {ok}/{len(sample)} read. It lifts after an hour or "
              f"more; run the same command again (captions already read are reused), or add --cookies chrome")
    elif errors:
        print(f"  {len(errors)} failed ({errors[0]}); run again to retry them")

    def entry(r):
        v = got.get(r["id"]) or {}
        e = {"id": r["id"], "url": link(r["id"]), "i": r["i"], "title": v.get("title") or r["title"],
             "views": v.get("view_count") or r["views"], "likes": v.get("like_count"), "comments": v.get("comment_count"),
             "duration": v.get("duration"), "posted": _date(v.get("upload_date")), "captions": v.get("captions"),
             "error": v.get("error")}
        e.update(_narration(v.get("words") or [], v.get("duration")))
        return e
    top_s, new_s = [entry(r) for r in sample_top], [entry(r) for r in sample_new]
    k, eras = _eras(rows)
    for er in eras:                                   # date each era from the sampled videos inside it
        ds = sorted(e["posted"] for e in top_s + new_s if e.get("posted") and er["first"] <= e["i"] <= er["last"])
        er["posted"] = f"{ds[0][:7]} .. {ds[-1][:7]}" if ds else None
    agg, titles = _aggregate(top_s), _titles(top_s)
    _write_md(d / "transcripts.md", meta, rows, k, eras, agg, titles, top_s, new_s)
    (d / "narration.json").write_text(json.dumps(top_s + new_s, ensure_ascii=False, indent=1))
    picked = _picks(top_s, new_s, picks)
    print(f"frame sheets for {len(picked)} picks (thumbnails)...", flush=True)
    sheets = frame_sheets(picked, d)
    posted = sorted(e["posted"] for e in top_s + new_s if e.get("posted"))
    draft = {
        "id": rid,
        "source": {"url": tab_url, "media": "channel", "platform": "youtube", "creator": meta["channel"], "handle": meta.get("handle"),
                   "title": f"{meta['channel']}: {tab} channel study", "posted": None, "captured": today, "duration": None,
                   "metrics": {"videos": len(rows), "sponsored": sum(r["sponsored"] for r in rows),
                               "median_views": int(statistics.median([r["views"] for r in organic])) if organic else None,
                               "top_views": max((r["views"] for r in organic), default=None), "followers": meta.get("followers")}},
        "note": note,
        "kind": None, "format": None, "app": {"name": None, "category": None},
        "sample": {"top": len(top_s), "recent": len(new_s), "with_speech": sum(1 for e in top_s + new_s if e.get("speech")),
                   "posted": [posted[0], posted[-1]] if posted else [None, None],
                   "top_ids": [e["id"] for e in top_s[:10]]},
        "eras": [{x: er[x] for x in ("videos", "posted", "median_views", "in_top", "sponsored")} for er in eras],
        "narration": agg,
        "titles": titles,
        "hook_bank": [],
        "insights": [], "why_it_works": [], "steal": [],
        "engine": {"template": None, "theme": None, "features": [], "gaps": []},
        "relevance": None, "tags": [],
        "_analysis": {"transcripts": str(d / "transcripts.md"), "narration": str(d / "narration.json"), "frame_sheets": sheets,
                      "picks": [{"url": p["url"], "views": p["views"], "title": p["title"], "why": p["why"]} for p in picked],
                      "keep": False},
    }
    (d / "draft.yaml").write_text(yaml.safe_dump(draft, sort_keys=False, allow_unicode=True, width=120))
    return rid, d / "draft.yaml", draft, {"top_k": k, "picks": draft["_analysis"]["picks"], "transcripts": str(d / "transcripts.md"),
                                          "frame_sheets": sheets}
