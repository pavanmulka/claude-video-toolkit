"""./vtk publish: post a finished reel or carousel to the brand's connected social accounts through SocialAPI.ai
(one REST API for Instagram, Facebook, TikTok, YouTube, Threads, LinkedIn, X...).

Every post is a small YAML file next to the video's spec (post.yaml). The flow is deliberately two-step, so nothing
goes public by accident:

    ./vtk publish post.yaml          upload the media (private library), validate per platform, save a DRAFT
                                     (private, free, visible in the SocialAPI dashboard) and print what would post
    ./vtk publish post.yaml --go     publish that draft now, or schedule it when post.yaml has `schedule:`
    ./vtk publish post.yaml --status per-platform status + links (writes them into the ideas backlog)
    ./vtk publish post.yaml --metrics views / likes / comments / shares / saves -> the ideas backlog
    ./vtk publish post.yaml --retry  re-send only the platforms that failed
    ./vtk publish --accounts         the brand's connected accounts

The API key never lives in a file: it is read from the macOS Keychain (service `vtk-socialapi`) or the
SOCIALAPI_KEY environment variable. The brand's `publish:` block (workspace/brand/<name>/brand.yaml) names the
SocialAPI brand id and the default platforms.
"""
import datetime
import json
import mimetypes
import os
import subprocess
import time
from pathlib import Path

import yaml

from . import brand as brandmod
from .paths import INBOX, ROOT, WORK

API = os.environ.get("SOCIALAPI_URL", "https://api.social-api.ai/v1")
KEYCHAIN_SERVICE = "vtk-socialapi"
PLATFORMS = ["instagram", "facebook", "tiktok", "youtube", "threads", "linkedin", "linkedin_page", "twitter"]   # linkedin = a
# member profile; linkedin_page = a company / showcase page (SocialAPI beta, enabled per account by their support)
TEXT_LIMITS = {"instagram": 2200, "threads": 500, "twitter": 280, "tiktok": 2200, "youtube": 5000, "facebook": 63206,
               "linkedin": 3000, "linkedin_page": 3000}
POST_KEYS = {"brand", "media", "caption", "captions", "title", "platforms", "ai_label", "cover", "first_comment",
             "schedule", "idea", "tiktok", "instagram", "youtube", "facebook", "threads", "linkedin", "linkedin_page", "notes"}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
SERVER_UPLOAD_MAX = 45 * 1024 * 1024


class PublishError(Exception):
    pass


# ------------------------------------------------------------------ auth + HTTP
def api_key():
    k = os.environ.get("SOCIALAPI_KEY")
    if k:
        return k.strip()
    try:
        out = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        out = None
    if out is not None and out.returncode == 0 and out.stdout.strip():
        return out.stdout.strip()
    raise PublishError("no SocialAPI key: store it once in the Keychain with\n"
                       f"  security add-generic-password -a \"$USER\" -s {KEYCHAIN_SERVICE} -w\n"
                       "(it asks for the key without showing it), or set SOCIALAPI_KEY")


def _req(method, path, body=None, files=None, params=None, ok=(200, 201, 204, 207), timeout=120):
    import requests
    headers = {"Authorization": f"Bearer {api_key()}"}
    url = path if path.startswith("http") else API + path
    for attempt in range(4):
        r = requests.request(method, url, headers=headers, json=body, files=files, params=params, timeout=timeout)
        if r.status_code == 429 or r.status_code >= 500:
            if attempt < 3:
                time.sleep(2 * (attempt + 1))
                continue
        break
    data = None
    if r.content:
        try:
            data = r.json()
        except ValueError:
            data = {"raw": r.text[:500]}
    if r.status_code not in ok:
        msg = (data or {}).get("message") or (data or {}).get("error") or (data or {}).get("raw") or r.reason
        if isinstance(msg, dict):
            msg = msg.get("message") or json.dumps(msg)
        extra = {k: v for k, v in (data or {}).items() if k in ("details", "issues", "errors", "validation", "targets")}
        if not extra and isinstance((data or {}).get("error"), dict):
            extra = {k: v for k, v in data["error"].items() if k != "message"}
        if extra:                                                  # the listed issues, not just "fix the listed issues"
            msg = f"{msg}\n  {json.dumps(extra, ensure_ascii=False)[:1500]}"
        raise PublishError(f"{method} {path} -> {r.status_code}: {msg}")
    return r.status_code, data


# ------------------------------------------------------------------ brand config + accounts
def brand_cfg(name):
    b = brandmod.load(name)
    cfg = dict(b.get("publish") or {})
    if not cfg.get("brand_id"):
        raise PublishError(f"brand '{name}' has no publish.brand_id (add `publish: {{provider: socialapi, brand_id: ..., "
                           f"platforms: [...]}}` to its brand.yaml)")
    return cfg


def accounts(brand_id=None):
    _, data = _req("GET", "/accounts")
    rows = (data or {}).get("data") or []
    return [a for a in rows if not brand_id or a.get("brand_id") == brand_id]


# ------------------------------------------------------------------ post.yaml
def _resolve(p, base):
    p = Path(os.path.expanduser(str(p)))
    if p.is_absolute():
        return p
    for b in (base, INBOX, ROOT):
        if (b / p).exists():
            return (b / p).resolve()
    return (base / p).resolve()


def load_post(path):
    path = Path(path).resolve()
    raw = yaml.safe_load(path.read_text()) or {}
    bad = set(raw) - POST_KEYS
    if bad:
        raise PublishError(f"{path.name}: unknown field(s) {sorted(bad)} (allowed: {', '.join(sorted(POST_KEYS))})")
    media = raw.get("media")
    if not media:
        raise PublishError(f"{path.name}: media: needs a video file or a list of images (carousel)")
    media = media if isinstance(media, list) else [media]
    files = []
    for m in media:
        f = _resolve(m, path.parent)
        if f.is_dir():                          # a rendered carousel folder: its slides in order
            files += sorted(x for x in f.iterdir() if x.suffix.lower() in IMAGE_EXT and not x.name.startswith("."))
        else:
            files.append(f)
    for f in files:
        if not f.exists():
            raise PublishError(f"{path.name}: media file not found: {f}")
    kinds = {"video" if f.suffix.lower() in VIDEO_EXT else "image" if f.suffix.lower() in IMAGE_EXT else "?" for f in files}
    if "?" in kinds:
        raise PublishError(f"{path.name}: media must be video ({', '.join(sorted(VIDEO_EXT))}) or images ({', '.join(sorted(IMAGE_EXT))})")
    if "video" in kinds and len(files) > 1:
        raise PublishError(f"{path.name}: one video per post (carousels are images)")
    kind = "video" if "video" in kinds else ("carousel" if len(files) > 1 else "image")
    if not raw.get("caption"):
        raise PublishError(f"{path.name}: caption: is required")
    post = dict(raw, _path=path, _files=files, _kind=kind)
    post["brand"] = raw.get("brand") or brandmod.default_brand()
    if isinstance(post.get("schedule"), (datetime.datetime, datetime.date)):
        post["schedule"] = post["schedule"].isoformat()
    return post


def _state_path(post):
    return post["_path"].with_suffix(".state.json")


def load_state(post):
    p = _state_path(post)
    return json.loads(p.read_text()) if p.exists() else {}


def save_state(post, st):
    _state_path(post).write_text(json.dumps(st, indent=2, ensure_ascii=False) + "\n")


# ------------------------------------------------------------------ media
def _sha(f):
    import hashlib
    h = hashlib.sha1()
    with open(f, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def _as_jpeg(f):
    """TikTok photo posts take JPEG/WebP only and Meta can reject PNG feed images: send JPEGs."""
    if f.suffix.lower() in (".jpg", ".jpeg"):
        return f
    from PIL import Image
    out = WORK / "publish" / f"{f.stem}_{_sha(f)[:8]}.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists():
        Image.open(f).convert("RGB").save(out, "JPEG", quality=93, optimize=True)
    return out


def upload(f, quiet=False):
    """Upload one file to the SocialAPI media library; returns its media_id (presigned PUT for video / big files)."""
    import requests
    f = _as_jpeg(f) if f.suffix.lower() in IMAGE_EXT else f
    mime = mimetypes.guess_type(f.name)[0] or ("video/mp4" if f.suffix.lower() in VIDEO_EXT else "image/jpeg")
    size = f.stat().st_size
    if not quiet:
        print(f"  uploading {f.name} ({size / 1e6:.1f} MB)...")
    if size <= SERVER_UPLOAD_MAX and mime.startswith("image/"):
        with open(f, "rb") as fh:
            _, data = _req("POST", "/media/upload", files={"file": (f.name, fh, mime)}, timeout=300)
        return data["media_id"]
    _, data = _req("GET", "/media/upload-url", params={"media_type": mime, "filename": f.name})
    with open(f, "rb") as fh:
        r = requests.put(data["upload_url"], data=fh, headers={"Content-Type": mime}, timeout=900)
    if r.status_code not in (200, 201, 204):
        raise PublishError(f"upload of {f.name} failed: {r.status_code} {r.text[:200]}")
    _req("POST", f"/media/{data['media_id']}/verify")
    return data["media_id"]


def ensure_media(post, st, quiet=False):
    cache = st.setdefault("media", {})
    ids = []
    for f in post["_files"]:
        key, sha = str(f), _sha(f)
        if cache.get(key, {}).get("sha") != sha:
            cache[key] = {"sha": sha, "media_id": upload(f, quiet)}
        ids.append(cache[key]["media_id"])
    return ids


def _duration(f):
    from .media import probe
    try:
        return float(probe(f)["duration"])
    except Exception:
        return None


# ------------------------------------------------------------------ request body
def build_body(post, media_ids, accts):
    """post.yaml + uploaded media -> POST /v1/posts body (a draft: no publish_now, no scheduled_at)."""
    kind = post["_kind"]
    cfg = brand_cfg(post["brand"])
    want = post.get("platforms") or cfg.get("platforms") or PLATFORMS
    by_platform = {a["platform"]: a for a in accts if a.get("status", "active") == "active"}
    caption = str(post["caption"]).strip()
    caps = post.get("captions") or {}
    ai = bool(post.get("ai_label"))
    cover_ms = int(float(post["cover"]) * 1000) if post.get("cover") is not None else None
    targets, skipped, pdata = [], [], {}
    for plat in want:
        a = by_platform.get(plat)
        if a is None:
            skipped.append((plat, "not connected to this brand"))
            continue
        if plat == "youtube" and kind != "video":
            skipped.append((plat, "YouTube takes one video (no image or carousel posts)"))
            continue
        t = {"account_id": a["id"]}
        text = str(caps.get(plat) or caption).strip()
        if plat == "threads" and not caps.get(plat):
            text = _one_hashtag(text)                            # Threads allows a single hashtag per post
        if len(text) > TEXT_LIMITS.get(plat, 10 ** 6):
            raise PublishError(f"caption is {len(text)} chars, {plat} allows {TEXT_LIMITS[plat]}: add captions: {{{plat}: ...}}")
        if text != caption:
            t["text"] = text
        pd = {}
        if plat == "instagram":
            pd["content_type"] = {"video": "reel", "carousel": "carousel", "image": "feed"}[kind]
            if kind == "video":
                pd["share_to_feed"] = True
                if cover_ms is not None:
                    pd["video_cover_timestamp_ms"] = cover_ms
            if ai:
                pd["is_ai_generated"] = True
        elif plat == "tiktok":
            pd.update({"privacy_level": "PUBLIC_TO_EVERYONE", "disable_comment": False})
            if kind == "video":
                pd.update({"media_type": "video", "disable_duet": False, "disable_stitch": False})
                if cover_ms is not None:
                    pd["video_cover_timestamp_ms"] = cover_ms
            else:
                pd.update({"media_type": "photo", "photo_cover_index": 0})
            if ai:
                pd["is_aigc"] = True
        elif plat == "youtube":
            title = str(post.get("title") or caption.splitlines()[0])[:100]
            t["title"] = title
            pd.update({"made_for_kids": False, "notify_subscribers": True})
            if ai:
                pd["contains_synthetic_media"] = True
        pd.update(post.get(plat) or {})                          # per-platform overrides from post.yaml
        if pd:
            pdata[plat] = pd                                     # post level, keyed by platform: folded into its target
        targets.append(t)
    if not targets:
        raise PublishError("no target accounts: " + "; ".join(f"{p}: {why}" for p, why in skipped))
    body = {"text": caption, "media": [{"source_type": "media_id", "source": m} for m in media_ids], "targets": targets}
    if pdata:
        body["platform_data"] = pdata
    if post.get("title"):
        body["title"] = str(post["title"])[:100]
    if post.get("first_comment"):
        body["first_comment"] = str(post["first_comment"])
    if kind == "video":
        d = _duration(post["_files"][0])
        if d:
            body["media"][0]["duration_seconds"] = round(d, 2)
    return body, skipped, {a["platform"]: a for a in accts}


def _one_hashtag(text):
    """Keep only the first #hashtag (Threads' limit); drop the rest and tidy the spaces they leave."""
    import re
    seen = []

    def keep(m):
        seen.append(m.group(0))
        return m.group(0) if len(seen) == 1 else ""
    out = re.sub(r"(?<!\w)#\w+", keep, text)
    return "\n".join(re.sub(r"[ \t]{2,}", " ", ln).rstrip() for ln in out.splitlines()).strip()


def _platform_of(target, accts_by_id):
    return target.get("platform") or (accts_by_id.get(target.get("account_id")) or {}).get("platform", "?")


# ------------------------------------------------------------------ commands
def prepare(path):
    """Upload + validate + save a private draft. Returns (post, state, draft summary lines)."""
    post = load_post(path)
    cfg = brand_cfg(post["brand"])
    st = load_state(post)
    if st.get("post_id") and st.get("status") in ("published", "scheduled", "publishing"):
        raise PublishError(f"already {st['status']} (post {st['post_id']}): ./vtk publish {path} --status")
    accts = accounts(cfg["brand_id"])
    ids = ensure_media(post, st)
    save_state(post, st)
    body, skipped, _ = build_body(post, ids, accts)
    # validate per target: the validator checks the post-level text, so each platform gets its own text there
    errors, warns = [], []
    for t in body["targets"]:
        one = dict(body, targets=[t], text=t.get("text") or body["text"])
        _, val = _req("POST", "/posts/validate", body=one, ok=(200, 400, 422))
        errors += (val or {}).get("errors") or []
        warns += (val or {}).get("warnings") or []
    if errors:
        raise PublishError("validation failed:\n  " + "\n  ".join(f"{e.get('platform') or ''} {e.get('field') or ''}: {e.get('message')}" for e in errors))
    if st.get("post_id") and st.get("status") == "draft":
        # PATCH re-validates against the post-level text only (Threads then sees every hashtag); each target was
        # validated with its own text just above, so skip the server's second pass
        patch = {k: body[k] for k in ("text", "media", "targets", "title", "first_comment", "platform_data") if k in body}
        _req("PATCH", f"/posts/{st['post_id']}", body=dict(patch, skip_validation=True))
    else:
        _, data = _req("POST", "/posts", body=body)
        st["post_id"] = data["id"]
    st.update(status="draft", body=body, brand=post["brand"], prepared=datetime.datetime.now().isoformat(timespec="seconds"))
    save_state(post, st)
    by_id = {a["id"]: a for a in accts}
    lines = [f"DRAFT saved (private, nothing posted): {st['post_id']}",
             f"  media: {post['_kind']} · " + ", ".join(f.name for f in post["_files"])]
    for t in body["targets"]:
        a = by_id.get(t["account_id"], {})
        plat = a.get("platform", "?")
        txt = t.get("text") or body["text"]
        extra = (body.get("platform_data") or {}).get(plat) or {}
        lines.append(f"  {plat:10s} @{a.get('username', a.get('name', '?'))}: {len(txt)} chars"
                     + (f" · title \"{t['title']}\"" if t.get("title") else "")
                     + (f" · {json.dumps(extra, ensure_ascii=False)}" if extra else ""))
    for plat, why in skipped:
        lines.append(f"  {plat:10s} skipped: {why}")
    for w in warns:
        lines.append(f"  ! {w.get('platform') or ''} {w.get('field') or ''}: {w.get('message')}")
    when = post.get("schedule")
    lines.append(f"  caption: {body['text'][:160]}{'…' if len(body['text']) > 160 else ''}")
    lines.append(f"  on --go: {'schedule for ' + str(when) if when else 'publish now'}")
    return post, st, lines


def go(path):
    """Publish the prepared draft now, or schedule it (post.yaml `schedule:`)."""
    post = load_post(path)
    st = load_state(post)
    if not st.get("post_id") or st.get("status") != "draft":
        raise PublishError(f"no draft for {Path(path).name}: run ./vtk publish {path} first and check what it will post")
    pid = st["post_id"]
    if post.get("schedule"):
        # a scheduled post is created from the approved draft's exact body, then the draft is removed. The server
        # validates POST /posts against the post-level text only (Threads would see the long caption and every
        # hashtag); each target was validated with its own text in prepare(), so skip the server's second pass
        when = str(post["schedule"])
        _, data = _req("POST", "/posts", body=dict(st["body"], scheduled_at=when, skip_validation=True))
        _req("DELETE", f"/posts/{pid}", ok=(200, 204, 404))
        st.update(post_id=data["id"], draft_id=pid, status="scheduled", scheduled_at=when)
        save_state(post, st)
        return post, st, [f"SCHEDULED {data['id']} for {when}"]
    code, data = _req("POST", f"/posts/{pid}/publish", ok=(200, 201, 207, 422))
    st.update(status="publishing", published_request=datetime.datetime.now().isoformat(timespec="seconds"))
    save_state(post, st)
    lines = [f"PUBLISHING {pid} ({'partial' if code == 207 else 'all failed' if code == 422 else 'accepted'})"]
    return post, st, lines + status(path, wait=180)[2]


def retry(path):
    """Re-send the failed platforms of a published post (the ones that worked are left alone)."""
    post = load_post(path)
    st = load_state(post)
    if not st.get("post_id"):
        raise PublishError("nothing published yet")
    _req("POST", f"/posts/{st['post_id']}/retry", ok=(200, 201, 207, 422))
    return post, st, ["RETRYING the failed platforms"] + status(path, wait=180)[2]


def status(path, wait=0):
    post = load_post(path)
    st = load_state(post)
    if not st.get("post_id"):
        raise PublishError("nothing prepared yet")
    pid = st["post_id"]
    t0 = time.time()
    while True:
        _, data = _req("GET", f"/posts/{pid}")
        targets = data.get("targets") or []
        pending = [t for t in targets if t.get("status") in ("publishing", "pending", "processing", "queued")]
        if not pending or time.time() - t0 > wait:
            break
        time.sleep(8)
    lines, links = [], {}
    for t in targets:
        plat = t.get("platform", "?")
        s = t.get("status", "?")
        line = f"  {plat:10s} {s}"
        if t.get("permalink"):
            line += f"  {t['permalink']}"
            links[plat] = t["permalink"]
        if t.get("error"):
            line += f"  x {t['error'].get('message')}"
        lines.append(line)
    overall = data.get("status")
    st.update(status=overall or st.get("status"), links=links or st.get("links"))
    save_state(post, st)
    if post.get("idea") and links:
        _idea_posted(post, links, data.get("published_at"))
    return post, st, [f"post {pid}: {overall}"] + lines


def _idea_posted(post, links, published_at):
    from . import ideas
    pairs = ["status=posted", f"posted={(published_at or datetime.date.today().isoformat())[:10]}"]
    pairs += [f"links.{p}={u}" for p, u in links.items()]
    ideas.set_fields(post["idea"], pairs)


METRIC_KEYS = {"views": ("views", "plays", "video_views", "impressions"), "likes": ("likes", "like_count", "reactions"),
               "comments": ("comments", "comment_count"), "shares": ("shares", "share_count"), "saves": ("saves", "saved")}


def metrics(path):
    post = load_post(path)
    st = load_state(post)
    if not st.get("post_id"):
        raise PublishError("nothing published yet")
    _, data = _req("GET", f"/posts/{st['post_id']}/metrics")
    raw = (data or {}).get("data") or {}
    per = raw if isinstance(raw, dict) else {}
    totals, lines = {}, []
    rows = per.get("targets") if isinstance(per.get("targets"), list) else [dict(v, platform=k) for k, v in per.items() if isinstance(v, dict)]
    for row in rows or []:
        m = row.get("metrics", row)
        got = {}
        for key, names in METRIC_KEYS.items():
            v = next((m[n] for n in names if isinstance(m.get(n), (int, float))), None)
            if v is not None:
                got[key] = int(v)
                totals[key] = totals.get(key, 0) + int(v)
        lines.append(f"  {row.get('platform', '?'):10s} " + "  ".join(f"{k} {v:,}" for k, v in got.items()))
    st["metrics"] = {"at": datetime.datetime.now().isoformat(timespec="seconds"), "totals": totals, "raw": raw}
    save_state(post, st)
    if post.get("idea") and totals:
        from . import ideas
        ideas.set_fields(post["idea"], [f"metrics.{k}={v}" for k, v in totals.items()])
    return post, st, ["totals: " + ("  ".join(f"{k} {v:,}" for k, v in totals.items()) or "(none reported yet)")] + lines
