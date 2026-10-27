"""./vtk eleven: ElevenLabs voices, music and sound effects straight into the project (REST API).

    ./vtk eleven credits                         plan + characters used / left this month
    ./vtk eleven models                          text-to-speech models (newest first) and what they support
    ./vtk eleven voices [--search w]             voices in the account (incl. clones)
    ./vtk eleven voices --library --search w [--gender --age --accent --use-case]   the shared Voice Library
    ./vtk eleven add <public_owner_id> <voice_id> --name "Dad"                      add a library voice to the account
    ./vtk eleven say "text" --voice <name|id> [--takes 3] [--stability creative] [--out name]   -> name_A.mp3, name_B.mp3...
    ./vtk eleven music "prompt" --duration 16 [--plan plan.yaml] [--takes 2] [--out name]      -> name_A.mp3...
    ./vtk eleven sfx "a phone buzzing twice on a table" --duration 1.5 [--takes 2] [--out name]

Files land in inbox/ unless --out names a folder. Every take keeps its request next to it (<file>.json: text, voice,
model, settings), so a good take can be re-made or varied later.

The API key never lives in a file: it is read from the macOS Keychain (service `vtk-elevenlabs`) or the
ELEVENLABS_API_KEY environment variable. Store it once with
    security add-generic-password -a "$USER" -s vtk-elevenlabs -w
"""
import json
import os
import string
import subprocess
import time
from pathlib import Path

import yaml

from .paths import INBOX

API = os.environ.get("ELEVENLABS_URL", "https://api.elevenlabs.io")
KEYCHAIN_SERVICE = "vtk-elevenlabs"
STABILITY = {"creative": 0.0, "natural": 0.5, "robust": 1.0}      # the three steps the v3-family models accept


class ElevenError(Exception):
    pass


# ------------------------------------------------------------------ auth + HTTP
def api_key():
    k = os.environ.get("ELEVENLABS_API_KEY")
    if k:
        return k.strip()
    try:
        out = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        out = None
    if out is not None and out.returncode == 0 and out.stdout.strip():
        return out.stdout.strip()
    raise ElevenError("no ElevenLabs key: store it once in the Keychain with\n"
                      f"  security add-generic-password -a \"$USER\" -s {KEYCHAIN_SERVICE} -w\n"
                      "(it asks for the key without showing it), or set ELEVENLABS_API_KEY")


def _req(method, path, body=None, params=None, audio=False, timeout=300):
    import requests
    headers = {"xi-api-key": api_key()}
    if audio:
        headers["Accept"] = "audio/mpeg"
    for attempt in range(4):
        r = requests.request(method, API + path, headers=headers, json=body, params=params, timeout=timeout)
        if r.status_code == 429 or r.status_code >= 500:
            if attempt < 3:
                time.sleep(3 * (attempt + 1))
                continue
        break
    if r.status_code >= 300:
        try:
            d = r.json().get("detail")
            msg = d.get("message") if isinstance(d, dict) else d
        except ValueError:
            msg = r.text[:400]
        raise ElevenError(f"{method} {path} -> {r.status_code}: {msg or r.reason}")
    return r.content if audio else (r.json() if r.content else {})


# ------------------------------------------------------------------ account
def credits():
    try:
        s = _req("GET", "/v1/user/subscription")
    except ElevenError as e:
        if "user_read" in str(e):
            return ["credits: this key can't read the balance (give it the User: Read permission to see it here)"]
        raise
    used, limit = s.get("character_count", 0), s.get("character_limit", 0)
    reset = s.get("next_character_count_reset_unix")
    when = time.strftime("%Y-%m-%d", time.localtime(reset)) if reset else "?"
    return [f"plan {s.get('tier', '?')}: {used:,} / {limit:,} credits used, {max(limit - used, 0):,} left (resets {when})"]


def models():
    rows = _req("GET", "/v1/models")
    out = []
    for m in rows:
        if not m.get("can_do_text_to_speech"):
            continue
        langs = len(m.get("languages") or [])
        out.append(f"  {m['model_id']:28s} {m.get('name', '')}  ({langs} languages, max {m.get('max_characters_request_free_user') or '?'} chars)")
    return out


def default_model():
    """The newest expressive TTS model the account has (v3-family understands audio tags like [chuckles])."""
    try:
        ids = [m["model_id"] for m in _req("GET", "/v1/models") if m.get("can_do_text_to_speech")]
    except ElevenError:
        ids = []
    for want in ("eleven_v4", "eleven_v3"):
        if want in ids:                                   # the full model, not its turbo / conversational variants
            return want
        hit = [i for i in ids if i.startswith(want)]
        if hit:
            return sorted(hit)[0]
    return ids[0] if ids else "eleven_v3"


def voices(search=None, library=False, gender=None, age=None, accent=None, use_case=None, n=30):
    if library:
        params = {"page_size": n, "search": search, "gender": gender, "age": age, "accent": accent, "use_cases": use_case,
                  "sort": "trending"}
        d = _req("GET", "/v1/shared-voices", params={k: v for k, v in params.items() if v})
        out = []
        for v in d.get("voices") or []:
            desc = (v.get("description") or "").replace("\n", " ")[:90]
            out.append(f"  {v.get('name', '')[:28]:28s} {v.get('gender', '')}/{v.get('age', '')}/{v.get('accent', '')} "
                       f"{v.get('use_case', '')}  add: {v.get('public_owner_id')} {v.get('voice_id')}\n      {desc}"
                       + (f"\n      preview: {v['preview_url']}" if v.get("preview_url") else ""))
        return out
    d = _req("GET", "/v2/voices", params={"page_size": 100, **({"search": search} if search else {})})
    out = []
    for v in d.get("voices") or []:
        lab = v.get("labels") or {}
        out.append(f"  {v.get('name', '')[:32]:32s} {v['voice_id']}  {v.get('category', '')}  "
                   f"{'/'.join(x for x in (lab.get('gender'), lab.get('age'), lab.get('accent')) if x)}")
    return out


def add_voice(public_owner_id, voice_id, name):
    d = _req("POST", f"/v1/voices/add/{public_owner_id}/{voice_id}", body={"new_name": name})
    return d.get("voice_id")


def resolve_voice(v):
    """A voice id, or the name of a voice in the account (case-insensitive; a unique prefix works)."""
    d = _req("GET", "/v2/voices", params={"page_size": 100})
    vs = d.get("voices") or []
    for x in vs:
        if x["voice_id"] == v:
            return x["voice_id"], x.get("name")
    low = v.lower()
    exact = [x for x in vs if (x.get("name") or "").lower() == low]
    pref = [x for x in vs if (x.get("name") or "").lower().startswith(low)]
    hit = exact or pref
    if len(hit) == 1:
        return hit[0]["voice_id"], hit[0].get("name")
    if not hit:
        raise ElevenError(f"no voice '{v}' in the account (./vtk eleven voices; library voices: ./vtk eleven add ...)")
    raise ElevenError(f"'{v}' matches {', '.join(x.get('name') for x in hit)}: use the full name or the id")


# ------------------------------------------------------------------ output
def _targets(out, stem, takes, ext=".mp3"):
    """out: None -> inbox/<stem>; a folder -> folder/<stem>; a path -> that stem. Takes get _A, _B..."""
    if out:
        p = Path(out).expanduser()
        if not p.is_absolute() and len(p.parts) == 1:
            p = INBOX / p
        if p.is_dir() or str(out).endswith("/"):
            p = p / stem
    else:
        p = INBOX / stem
    p = p.with_suffix("") if p.suffix in (".mp3", ".wav") else p
    p.parent.mkdir(parents=True, exist_ok=True)
    if takes == 1:
        return [p.with_suffix(ext)]
    return [p.parent / f"{p.name}_{string.ascii_uppercase[i]}{ext}" for i in range(takes)]


def _save(path, data, meta):
    path.write_bytes(data)
    path.with_suffix(path.suffix + ".json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")


def _slug(text, n=28):
    s = "".join(c.lower() if c.isalnum() else "_" for c in text).strip("_")
    while "__" in s:
        s = s.replace("__", "_")
    return s[:n].rstrip("_") or "take"


# ------------------------------------------------------------------ text to speech
def say(text, voice, takes=2, model=None, stability="creative", similarity=0.75, style=None, speed=None, seed=None,
        language=None, out=None, fmt="mp3_44100_128"):
    vid, vname = resolve_voice(voice)
    model = model or default_model()
    st = STABILITY.get(str(stability).lower(), None)
    st = float(stability) if st is None else st
    settings = {"stability": st, "similarity_boost": similarity}
    if style is not None:
        settings["style"] = style
    if speed is not None:
        settings["speed"] = speed
    files = []
    for i, path in enumerate(_targets(out, _slug(text), takes)):
        body = {"text": text, "model_id": model, "voice_settings": settings}
        if seed is not None:
            body["seed"] = seed + i
        if language:
            body["language_code"] = language
        data = _req("POST", f"/v1/text-to-speech/{vid}", body=body, params={"output_format": fmt}, audio=True)
        _save(path, data, {"kind": "tts", "voice": vname, "voice_id": vid, **body})
        files.append(path)
    return files


# ------------------------------------------------------------------ music
def plan_from_yaml(p):
    """A composition plan: global styles + timed sections (seconds), so the music turns where the cut turns.

        styles: [comedic tension, pizzicato strings, light percussion]
        avoid: [vocals, epic trailer]
        sections:
          - {name: dig, dur: 7.2, styles: [sneaky, ticking clock, building], avoid: [drums]}
          - {name: turn, dur: 1.0, styles: [sudden stop, one sting]}
          - {name: proof, dur: 6.0, styles: [warm, bright, confident groove]}
          - {name: end, dur: 2.0, styles: [final hit, ring out]}
    """
    d = yaml.safe_load(Path(p).read_text()) or {}
    secs = []
    for s in d.get("sections") or []:
        secs.append({"section_name": s.get("name", f"part {len(secs) + 1}"),
                     "positive_local_styles": s.get("styles") or [], "negative_local_styles": s.get("avoid") or [],
                     "duration_ms": int(round(float(s["dur"]) * 1000)), "lines": s.get("lines") or []})
    if not secs:
        raise ElevenError(f"{p}: sections: needs at least one {{name, dur, styles}}")
    short = [s["section_name"] for s in secs if s["duration_ms"] < 3000]
    if short:                                              # the API's own limit; say it before spending a request
        raise ElevenError(f"{p}: sections {short} are under 3 s (ElevenLabs needs >= 3 s each: merge them, or let the "
                          "last one ring past the end and trim it in the spec)")
    return {"positive_global_styles": d.get("styles") or [], "negative_global_styles": d.get("avoid") or [],
            "sections": secs}


def music(prompt=None, duration=None, plan=None, takes=2, instrumental=True, out=None, fmt="mp3_44100_192"):
    body = {"model_id": "music_v1"}
    if plan:
        body["composition_plan"] = plan_from_yaml(plan)
    elif prompt:
        body["prompt"] = prompt
        if duration:
            body["music_length_ms"] = int(round(float(duration) * 1000))
        body["force_instrumental"] = bool(instrumental)
    else:
        raise ElevenError("music needs a prompt or --plan plan.yaml")
    stem = _slug(prompt or Path(plan).stem, 24)
    files = []
    for path in _targets(out, stem, takes):
        data = _req("POST", "/v1/music", body=body, params={"output_format": fmt}, audio=True, timeout=600)
        _save(path, data, {"kind": "music", **body})
        files.append(path)
    return files


# ------------------------------------------------------------------ sound effects
def sfx(text, duration=None, takes=2, influence=0.5, out=None, fmt="mp3_44100_128"):
    body = {"text": text, "prompt_influence": influence}
    if duration:
        body["duration_seconds"] = float(duration)
    files = []
    for path in _targets(out, _slug(text, 24), takes):
        data = _req("POST", "/v1/sound-generation", body=body, params={"output_format": fmt}, audio=True)
        _save(path, data, {"kind": "sfx", **body})
        files.append(path)
    return files
