"""Load, validate and normalise a timeline spec (YAML). Errors name the exact field."""
import difflib
from pathlib import Path

import yaml

from . import anim
from . import brand as brandmod
from .media import kind_of, probe
from .paths import BRANDS, INBOX, expand

ASPECTS = {"9:16": (1080, 1920), "1:1": (1080, 1080), "4:5": (1080, 1350), "16:9": (1920, 1080)}

KEYS = {
    "top": {"version", "name", "brand", "theme", "look", "output", "sources", "defaults", "timeline", "overlays", "captions", "audio",
            "variants", "notes"},
    "output": {"file", "aspect", "width", "height", "fps", "crf", "preset", "loudness", "platforms", "fade_in", "fade_out", "srt", "loop"},
    "defaults": {"layout", "transition", "background", "text_style", "text_pos", "text_anim", "drift", "enter", "autozoom"},
    "section": {"section", "text", "text_style", "text_pos", "text_anim", "clips", "overlays", "layout", "background",
                "dur", "beats", "fit", "drift", "enter", "autozoom", "notes"},
    "clip": {"src", "still", "image", "color", "motion", "props", "transparent", "in", "out", "dur", "speed", "ramp", "hold",
             "hold_start", "camera", "zoom", "focus", "pan", "tilt", "rotate", "drift", "dim", "vignette", "layout", "background",
             "transition", "sfx", "id", "audio", "enter", "taps", "lifts", "marks", "autozoom", "notes"},
    "tap": {"src", "at", "pos", "sound", "volume"},
    "camkey": {"t", "zoom", "focus", "pan", "tilt", "rotate", "ease"},
    "transition": {"type", "dur", "color", "dir", "ease", "pos", "sfx", "volume"},
    "enter": {"rise", "dur", "fade", "tilt", "rotate", "scale", "ease"},
    "lift": {"rect", "src", "at", "in", "hold", "out", "scale", "to", "up", "radius", "shadow", "border", "border_width", "dim",
             "ease", "exit", "notes"},
    "mark": {"type", "rect", "pos", "size", "src", "at", "dur", "draw", "delay", "color", "width", "hand", "pad", "radius", "glow",
             "ease", "label", "label_style", "label_side", "side", "length", "from", "to", "opacity", "strength", "fade_out", "seed",
             "notes"},
    "overlay": {"text", "image", "counter", "mark", "video", "motion", "props", "start", "end", "dur", "pos", "anchor", "style", "size",
                "fade", "rise", "opacity", "anim", "shine", "in", "speed", "layout", "notes"},
    "counter": {"from", "to", "format", "decimals", "prefix", "suffix", "dur", "delay", "ease", "symbol"},
    "anim": {"in", "out", "dur", "out_dur", "ease", "idle", "idle_amp", "idle_period", "dist", "by", "stagger", "caret"},
    "captions": {"from", "style", "pos", "max_words", "max_chars", "offset", "enabled", "replace", "anim", "skip"},
    "audio": {"voiceover", "music", "sfx", "tracks", "loudness"},
    "voiceover": {"file", "start", "speed", "max_pause", "volume", "fade_in", "fade_out", "trim", "denoise", "language", "place", "fx", "cut"},
    "music": {"file", "generate", "volume", "start", "offset", "fade_in", "fade_out", "duck", "loop", "end", "bpm"},
    "generate": {"bpm", "key", "drop", "resolve", "seed", "mood"},
    "sfx": {"sound", "at", "src", "volume", "align", "pan"},
    "track": {"file", "at", "volume", "fx", "fade_in", "fade_out", "trim", "loop", "dur", "pan", "duck", "notes"},
    "layout": {"type", "style", "width", "top", "height", "center_y", "center_x", "finish", "island", "shadow", "bezel", "buttons",
               "x", "y", "w", "h", "radius", "status_cut", "pos", "border", "border_width", "focus"},
    "background": {"type", "color", "dim", "tint", "top", "bottom", "file", "blur", "colors", "base", "speed", "size", "seed", "glows",
                   "accent", "accent2", "stars", "stars_amount", "line", "line_opacity", "spacing", "glow", "dot", "dot_opacity",
                   "color2", "count", "center", "grain", "pos", "radius", "strength", "angle"},
    "text_anim": {"in", "out", "rise", "pop", "by", "effect", "stagger", "ease", "out_effect", "idle", "idle_amp", "line_delay",
                  "caret", "dist", "sfx", "sfx_volume", "sfx_at", "strike_at"},
    "text": {"content", "style", "pos", "behind"},
    "look": {"grain", "vignette", "contrast", "saturation", "brightness", "gamma", "warmth", "lift", "sharpen", "chroma", "bloom"},
}
LAYOUTS = {"iphone", "card", "fullbleed", "fit"}
TRANSITIONS = {"cut", "crossfade", "dip", "slide", "push", "whip", "zoom", "blur", "wipe", "circle", "glitch", "flash"}
BACKGROUNDS = {"blur", "color", "gradient", "image", "mesh", "glow", "paper", "grid", "dots", "rays", "aurora", "noise", "spotlight"}
MARKS = {"circle", "underline", "strike", "highlight", "box", "brackets", "arrow", "check", "cross", "ping", "spotlight", "scribble", "dot"}
OVERLAY_KINDS = ("text", "image", "counter", "mark", "video", "motion")
VOICE_FX = {"phone", "radio", "megaphone", "small_speaker", "cabin", "reverb", "hall", "underwater", "walkie", "whisper", "none"}


class SpecError(Exception):
    def __init__(self, errors, warnings=()):
        self.errors, self.warnings = list(errors), list(warnings)
        super().__init__("\n".join(errors))


class V:
    """Collects errors/warnings with field paths."""

    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, path, msg):
        self.errors.append(f"{path}: {msg}")

    def warn(self, path, msg):
        self.warnings.append(f"{path}: {msg}")

    def keys(self, path, obj, kind):
        if not isinstance(obj, dict):
            self.err(path, f"expected a mapping, got {type(obj).__name__}")
            return False
        allowed = KEYS[kind]
        for k in obj:
            if k not in allowed:
                sug = difflib.get_close_matches(str(k), allowed, n=1)
                self.err(f"{path}.{k}", "unknown field" + (f" (did you mean '{sug[0]}'?)" if sug else f" (allowed: {', '.join(sorted(allowed))})"))
        return True

    def num(self, path, v, lo=None, hi=None, allow_none=True):
        if v is None:
            return allow_none
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            self.err(path, f"expected a number, got {v!r}")
            return False
        if lo is not None and v < lo:
            self.err(path, f"{v} is below the minimum {lo}")
            return False
        if hi is not None and v > hi:
            self.err(path, f"{v} is above the maximum {hi}")
            return False
        return True


def variants(path):
    """Names of the variants declared in a spec (hook A/B tests etc.)."""
    raw = yaml.safe_load(Path(path).read_text()) or {}
    return list((raw.get("variants") or {}).keys())


def apply_variant(raw, name):
    """Overlay a variant: keys naming a section override that section's fields; top-level keys
    (output, audio, captions, theme, look, defaults, overlays) override the spec. Output file gets _<name>."""
    vs = raw.get("variants") or {}
    if name not in vs:
        raise SpecError([f"variant '{name}' not found (have: {', '.join(vs) or 'none'})"])
    raw = brandmod.deep_merge(raw, {})
    over = vs[name] or {}
    names = {sec.get("section"): i for i, sec in enumerate(raw.get("timeline") or []) if isinstance(sec, dict)}
    for k, val in over.items():
        if k in names:
            if val is None:                              # `section: null` drops the section in this variant
                raw["timeline"][names[k]] = None
                continue
            raw["timeline"][names[k]] = brandmod.deep_merge(raw["timeline"][names[k]], val) if isinstance(val, dict) else val
        elif k in ("output", "audio", "captions", "defaults") and isinstance(val, dict):
            raw[k] = brandmod.deep_merge(raw.get(k) or {}, val)
        elif k in ("theme", "look", "overlays", "brand"):
            raw[k] = val
        else:
            raise SpecError([f"variants.{name}.{k}: not a section name or a top-level key (sections: {', '.join(n for n in names if n)})"])
    raw["timeline"] = [sec for sec in raw.get("timeline") or [] if sec is not None]
    out = raw.setdefault("output", {})
    if not (over.get("output") or {}).get("file"):
        f = Path(out.get("file") or f"{raw.get('name', 'video')}.mp4")
        out["file"] = str(f.with_name(f"{f.stem}_{name}{f.suffix}"))
    return raw


def load(path, check_files=True, variant=None, aspect=None):
    """Parse + validate. Returns normalised spec dict; raises SpecError on problems."""
    path = Path(path).resolve()
    try:
        raw = yaml.safe_load(path.read_text())
    except yaml.YAMLError as e:
        raise SpecError([f"{path.name}: YAML syntax error: {e}"])
    v = V()
    v.spec_dir = path.parent
    if not v.keys("spec", raw or {}, "top"):
        raise SpecError(v.errors)
    raw = raw or {}
    if variant:
        raw = apply_variant(raw, variant)
    if aspect:
        raw = brandmod.deep_merge(raw, {})
        o = raw.setdefault("output", {})
        old = o.get("aspect", "9:16")
        o["aspect"] = aspect
        o.pop("width", None)
        o.pop("height", None)
        if aspect != old:
            f = Path(o.get("file") or f"{raw.get('name', 'video')}.mp4")
            o["file"] = str(f.with_name(f"{f.stem}_{aspect.replace(':', 'x')}{f.suffix}"))
            if aspect != "9:16":
                o.setdefault("platforms", [])
    try:
        brand = brandmod.load(raw.get("brand", "default"))
    except FileNotFoundError as e:
        raise SpecError([f"brand: {e}"])
    if raw.get("theme"):
        try:
            brand = brandmod.apply_theme(brand, raw["theme"])
        except KeyError as e:
            raise SpecError([f"theme: {str(e).strip(chr(34) + chr(39))}"])
    look = raw.get("look", brand.get("look"))
    if look:
        v.keys("look", look, "look")

    # ---- output
    o = raw.get("output") or {}
    v.keys("output", o, "output")
    aspect = o.get("aspect", "9:16")
    if aspect not in ASPECTS:
        v.err("output.aspect", f"'{aspect}' is not one of {', '.join(ASPECTS)}")
        aspect = "9:16"
    W, H = ASPECTS[aspect]
    if o.get("width") and o.get("height"):
        W, H = int(o["width"]), int(o["height"])
    if aspect != "9:16" and (brand.get("aspects") or {}).get(aspect):   # per-size layout / position defaults
        brand = brandmod.deep_merge(brand, brand["aspects"][aspect])
    if W % 2 or H % 2:
        v.err("output", f"width/height must be even ({W}x{H})")
    v.num("output.fps", o.get("fps"), 1, 120)
    fps = o.get("fps", 30)
    loud = o.get("loudness", brand.get("output", {}).get("loudness", -14))
    v.num("output.loudness", loud, -40, -5)
    platforms = o.get("platforms", ["tiktok", "reels", "shorts"] if aspect == "9:16" else [])
    name = raw.get("name") or path.parent.name
    ofile = o.get("file") or f"{name}.mp4"
    out_path = expand(ofile)
    if out_path.suffix.lower() != ".mp4":
        v.err("output.file", "must end in .mp4")
    output = {"file": out_path, "aspect": aspect, "W": W, "H": H, "fps": fps, "crf": o.get("crf", 16),
              "preset": o.get("preset", "slow"), "loudness": loud, "platforms": platforms,
              "fade_in": o.get("fade_in", 0.0), "fade_out": o.get("fade_out", 0.0), "unit": min(W, H) / 1080.0,
              "loop": o.get("loop")}

    # ---- sources
    sources = {}
    src_raw = raw.get("sources") or {}
    if not isinstance(src_raw, dict):
        v.err("sources", "expected a mapping of name: file")
        src_raw = {}
    for k, f in src_raw.items():
        fp = expand(f["file"] if isinstance(f, dict) else f)
        if check_files and not fp.exists():
            near = difflib.get_close_matches(fp.name, [p.name for p in fp.parent.glob("*")], n=1) if fp.parent.exists() else []
            v.err(f"sources.{k}", f"file not found: {fp}" + (f" (did you mean '{near[0]}'?)" if near else ""))
            continue
        info = probe(fp) if fp.exists() else {"duration": 0, "kind": kind_of(fp)}
        sources[k] = {"path": fp, "info": info}

    # ---- defaults (brand / theme defaults under the spec's own)
    dfl = raw.get("defaults") or {}
    v.keys("defaults", dfl, "defaults")
    dfl = brandmod.deep_merge(brand.get("defaults") or {}, dfl)
    if dfl.get("background"):
        _check_background(v, "defaults.background", dfl["background"])
    if dfl.get("enter"):
        v.keys("defaults.enter", dfl["enter"], "enter")

    # ---- timeline
    tl = raw.get("timeline")
    if not isinstance(tl, list) or not tl:
        v.err("timeline", "must be a non-empty list of sections")
        tl = []
    sections = []
    ids = set()
    for si, sec in enumerate(tl):
        sp = f"timeline[{si}]"
        if not v.keys(sp, sec, "section"):
            continue
        sp = f"timeline[{si}]({sec.get('section', si)})"
        clips = sec.get("clips")
        if not isinstance(clips, list) or not clips:
            v.err(f"{sp}.clips", "needs at least one clip")
            clips = []
        _check_layout(v, f"{sp}.layout", sec.get("layout"), brand)
        v.num(f"{sp}.dur", sec.get("dur"), 0.05)
        v.num(f"{sp}.beats", sec.get("beats"), 0.25)
        if sec.get("background"):
            _check_background(v, f"{sp}.background", sec["background"])
        if sec.get("text_anim"):
            _check_text_anim(v, f"{sp}.text_anim", sec["text_anim"])
        if sec.get("enter"):
            v.keys(f"{sp}.enter", sec["enter"], "enter")
        if sec.get("fit") not in (None, "hold", "extend", "trim"):
            v.err(f"{sp}.fit", "must be hold | extend | trim")
        if sec.get("text") not in (None, "none") and sec.get("text_style"):
            _check_style(v, f"{sp}.text_style", sec["text_style"], brand)
        if isinstance(sec.get("text"), dict):
            v.keys(f"{sp}.text", sec["text"], "text")
            if sec["text"].get("style"):
                _check_style(v, f"{sp}.text.style", sec["text"]["style"], brand)
        ncl = []
        for ci, c in enumerate(clips):
            cp = f"{sp}.clips[{ci}]"
            if not v.keys(cp, c, "clip"):
                continue
            ncl.append(_check_clip(v, cp, c, sources, brand, ids))
        for oi, ov in enumerate(sec.get("overlays") or []):
            _check_overlay(v, f"{sp}.overlays[{oi}]", ov, brand, sources)
        sections.append(dict(sec, clips=ncl))

    for oi, ov in enumerate(raw.get("overlays") or []):
        _check_overlay(v, f"overlays[{oi}]", ov, brand, sources)
    if dfl.get("text_anim"):
        _check_text_anim(v, "defaults.text_anim", dfl["text_anim"])

    # ---- captions
    cap = raw.get("captions")
    if cap:
        v.keys("captions", cap, "captions")
        if cap.get("style"):
            try:
                brandmod.caption_style(brand, cap["style"])
            except KeyError as e:
                v.err("captions.style", str(e).strip("'\""))
        if cap.get("anim") not in (None, "pop", "fade", "slide", "none", "reveal", "bounce"):
            v.err("captions.anim", "must be pop | bounce | reveal | fade | slide | none")
        if cap.get("skip") is not None:
            names = [sec.get("section") for sec in raw.get("timeline") or [] if isinstance(sec, dict)]
            if not isinstance(cap["skip"], list) or not all(isinstance(x, str) for x in cap["skip"]):
                v.err("captions.skip", "must be a list of section names, e.g. [hook]")
            else:
                for x in cap["skip"]:
                    if x not in names:
                        v.err("captions.skip", f"no section named '{x}' (sections: {', '.join(n for n in names if n)})")

    # ---- audio
    au = raw.get("audio") or {}
    v.keys("audio", au, "audio")
    vo = au.get("voiceover")
    if vo:
        vo = {"file": vo} if isinstance(vo, str) else vo
        v.keys("audio.voiceover", vo, "voiceover")
        fp = expand(vo.get("file", ""))
        if check_files and not fp.exists():
            v.err("audio.voiceover.file", f"file not found: {fp}")
        v.num("audio.voiceover.speed", vo.get("speed"), 0.5, 2.0)
        if vo.get("speed") and abs(vo["speed"] - 1) > 0.1:
            v.warn("audio.voiceover.speed", f"{vo['speed']}x is a big change; beyond ±10% voices start to sound processed")
        for i, pl in enumerate(vo.get("place") or []):
            if not isinstance(pl, dict) or "text" not in pl or "at" not in pl:
                v.err(f"audio.voiceover.place[{i}]", "expected {text: 'first words of the line', at: seconds}")
        if vo.get("fx") not in (None, *VOICE_FX):
            v.err("audio.voiceover.fx", f"unknown voice effect '{vo['fx']}' (use {', '.join(sorted(VOICE_FX))})")
        for i, c in enumerate(vo.get("cut") or []):
            if not (isinstance(c, (list, tuple)) and len(c) == 2 and all(isinstance(x, (int, float)) for x in c) and c[0] < c[1]):
                v.err(f"audio.voiceover.cut[{i}]", "expected [start, end] in seconds of the file, start < end")
        vo["file"] = fp
        vo["_vocab"] = brand.get("vocabulary")
        au["voiceover"] = vo
    mu = au.get("music")
    if mu:
        mu = {"file": mu} if isinstance(mu, str) else mu
        v.keys("audio.music", mu, "music")
        if mu.get("generate") is not None:
            v.keys("audio.music.generate", mu["generate"] or {}, "generate")
        elif mu.get("file"):
            named = brandmod.music_path(brand, mu["file"])
            fp = named or expand(mu["file"])
            if check_files and not Path(fp).exists():
                v.err("audio.music.file", f"file not found: {fp} (drop licensed music in brand/music/ or use generate:)")
            mu["file"] = Path(fp)
        else:
            v.err("audio.music", "needs file: or generate:")
        au["music"] = mu
    for i, tr in enumerate(au.get("tracks") or []):
        v.keys(f"audio.tracks[{i}]", tr, "track")
        if "file" not in tr or "at" not in tr:
            v.err(f"audio.tracks[{i}]", "needs file: and at: (output seconds)")
            continue
        fp = expand(tr["file"])
        if not fp.exists():
            alt = expand(tr["file"], v.spec_dir)
            fp = alt if alt.exists() else brandmod.sound_path(brand, tr["file"])
        if check_files and not Path(fp).exists():
            v.err(f"audio.tracks[{i}].file", f"file not found: {tr['file']} (looked in inbox/, the spec folder, workspace/brand/, brand/)")
        tr["file"] = Path(fp)
        if tr.get("fx") not in (None, *VOICE_FX):
            v.err(f"audio.tracks[{i}].fx", f"unknown effect '{tr['fx']}' (use {', '.join(sorted(VOICE_FX))})")
    for i, s in enumerate(au.get("sfx") or []):
        v.keys(f"audio.sfx[{i}]", s, "sfx")
        if "at" not in s:
            v.err(f"audio.sfx[{i}].at", "required (output seconds)")
        if not brandmod.sound_path(brand, s.get("sound", "")).exists():
            v.err(f"audio.sfx[{i}].sound", f"unknown sound '{s.get('sound')}' (brand sounds: {', '.join(brand.get('sfx', {}))}; run ./vtk sfx)")

    if v.errors:
        raise SpecError(v.errors, v.warnings)
    output["srt"] = o.get("srt", True)
    return {"path": path, "dir": path.parent, "name": name, "brand": brand, "output": output, "sources": sources,
            "defaults": dfl, "timeline": sections, "overlays": raw.get("overlays") or [], "captions": cap,
            "audio": au, "look": look or None, "theme": raw.get("theme"), "variant": variant, "warnings": v.warnings, "raw": raw}


def _check_style(v, path, style, brand):
    try:
        brandmod.text_style(brand, style)
    except KeyError as e:
        v.err(path, str(e).strip("'\""))


def _check_layout(v, path, lay, brand):
    if lay is None:
        return
    t = lay if isinstance(lay, str) else lay.get("type")
    if isinstance(lay, dict):
        v.keys(path, lay, "layout")
    if t not in LAYOUTS:
        v.err(path, f"unknown layout '{t}' (use {', '.join(sorted(LAYOUTS))})")


def _check_clip(v, cp, c, sources, brand, ids):
    c = dict(c)
    kinds = [k for k in ("src", "still", "image", "color", "motion") if k in c]
    if len(kinds) != 1:
        v.err(cp, "needs exactly one of src: / still: / image: / color: / motion:")
        return c
    if "motion" in c:
        _check_motion(v, f"{cp}.motion", c["motion"], c.get("props"))
        if not c.get("dur"):
            v.err(f"{cp}.dur", "motion clips need dur:")
    elif "color" in c:
        if not c.get("dur"):
            v.err(f"{cp}.dur", "color clips need dur:")
    elif "still" in c:
        st = c["still"]
        if not isinstance(st, dict) or "src" not in st:
            v.err(f"{cp}.still", "expected {src: name, at: seconds}")
            return c
        if st["src"] not in sources:
            v.err(f"{cp}.still.src", f"unknown source '{st['src']}' (have: {', '.join(sources)})")
        elif st.get("at", 0) > sources[st["src"]]["info"]["duration"] + 1e-3:
            v.err(f"{cp}.still.at", f"{st.get('at')} is past the end of '{st['src']}' ({sources[st['src']]['info']['duration']:.2f}s)")
        if not c.get("dur"):
            v.err(f"{cp}.dur", "stills need dur:")
    elif "image" in c:
        if not any(expand(c["image"], b).exists() for b in (v.spec_dir, brand["_dir"], *BRANDS, INBOX)):
            v.err(f"{cp}.image", f"file not found: {c['image']} (looked in the spec folder, the brand folder, workspace/brand/, brand/, inbox/)")
        if not c.get("dur"):
            v.err(f"{cp}.dur", "images need dur:")
    else:
        s = c["src"]
        if s not in sources:
            sug = difflib.get_close_matches(str(s), sources, n=1)
            v.err(f"{cp}.src", f"unknown source '{s}'" + (f" (did you mean '{sug[0]}'?)" if sug else f" (have: {', '.join(sources)})"))
            return c
        dur = sources[s]["info"]["duration"]
        a = c.get("in", 0.0)
        v.num(f"{cp}.in", a, 0)
        if "out" in c and "dur" in c:
            v.err(cp, "use either out: or dur:, not both")
        if "out" in c:
            v.num(f"{cp}.out", c["out"], 0)
            if isinstance(c["out"], (int, float)) and c["out"] <= a:
                v.err(f"{cp}.out", f"out ({c['out']}) must be after in ({a})")
            if isinstance(c["out"], (int, float)) and c["out"] > dur + 0.02:
                v.err(f"{cp}.out", f"{c['out']} exceeds source '{s}' duration {dur:.2f}s")
        if isinstance(a, (int, float)) and a >= dur:
            v.err(f"{cp}.in", f"{a} is past the end of source '{s}' ({dur:.2f}s)")
        if "speed" in c and "ramp" in c:
            v.err(cp, "use either speed: or ramp:, not both")
        v.num(f"{cp}.speed", c.get("speed"), 0.1, 16)
        if c.get("speed", 1) > 4:
            v.warn(f"{cp}.speed", f"{c['speed']}x is very fast; UI will be hard to read")
        if "ramp" in c:
            r = c["ramp"]
            if not isinstance(r, list) or len(r) < 2 or not all(isinstance(k, (list, tuple)) and len(k) == 2 for k in r):
                v.err(f"{cp}.ramp", "expected a list of [source_time, speed] pairs (at least 2)")
    for k in ("hold", "hold_start", "dur", "dim", "vignette", "drift"):
        v.num(f"{cp}.{k}", c.get(k), 0)
    if c.get("background"):
        _check_background(v, f"{cp}.background", c["background"])
    if c.get("enter"):
        v.keys(f"{cp}.enter", c["enter"], "enter")
    for li, L in enumerate(c.get("lifts") or []):
        if v.keys(f"{cp}.lifts[{li}]", L, "lift"):
            if not (isinstance(L.get("rect"), list) and len(L["rect"]) == 4):
                v.err(f"{cp}.lifts[{li}].rect", "needs rect: [x, y, w, h] in source px")
            if "src" not in L and "at" not in L:
                v.err(f"{cp}.lifts[{li}]", "needs src: (source time) or at: (seconds into the clip)")
    for mi, m in enumerate(c.get("marks") or []):
        if v.keys(f"{cp}.marks[{mi}]", m, "mark"):
            if m.get("type") not in MARKS:
                v.err(f"{cp}.marks[{mi}].type", f"unknown mark '{m.get('type')}' (use {', '.join(sorted(MARKS))})")
            if "rect" not in m and "pos" not in m:
                v.err(f"{cp}.marks[{mi}]", "needs rect: [x, y, w, h] or pos: [x, y] (source px)")
            if "src" not in m and "at" not in m:
                v.err(f"{cp}.marks[{mi}]", "needs src: (source time) or at: (seconds into the clip)")
    if c.get("id"):
        if c["id"] in ids:
            v.err(f"{cp}.id", f"duplicate id '{c['id']}'")
        ids.add(c["id"])
    _check_layout(v, f"{cp}.layout", c.get("layout"), brand)
    tr = c.get("transition")
    if tr is not None:
        t = tr if isinstance(tr, str) else tr.get("type") if isinstance(tr, dict) else None
        if isinstance(tr, dict):
            v.keys(f"{cp}.transition", tr, "transition")
        if t not in TRANSITIONS:
            v.err(f"{cp}.transition", f"unknown transition '{t}' (use {', '.join(sorted(TRANSITIONS))})")
    cam = c.get("camera")
    if cam is not None:
        if not isinstance(cam, list):
            v.err(f"{cp}.camera", "expected a list of keyframes {t, zoom, focus, pan}")
        else:
            for ki, k in enumerate(cam):
                v.keys(f"{cp}.camera[{ki}]", k, "camkey")
                v.num(f"{cp}.camera[{ki}].zoom", k.get("zoom"), 0.2, 8)
                if k.get("ease") and k["ease"] not in anim.EASINGS:
                    v.err(f"{cp}.camera[{ki}].ease", f"unknown easing (use {', '.join(sorted(anim.EASINGS))})")
    for ti, t in enumerate(c.get("taps") or []):
        v.keys(f"{cp}.taps[{ti}]", t, "tap")
        if "pos" not in t or ("src" not in t and "at" not in t):
            v.err(f"{cp}.taps[{ti}]", "needs pos: [x, y] (source px) and src: (source time) or at: (seconds into the clip)")
    for si, s in enumerate(c.get("sfx") or []):
        v.keys(f"{cp}.sfx[{si}]", s, "sfx")
        if not brandmod.sound_path(brand, s.get("sound", "")).exists():
            v.err(f"{cp}.sfx[{si}].sound", f"unknown sound '{s.get('sound')}' (run ./vtk sfx to generate brand sounds)")
        if "src" not in s and "at" not in s:
            v.err(f"{cp}.sfx[{si}]", "needs src: (source time) or at: (seconds into the clip)")
    return c


def _check_overlay(v, path, ov, brand, sources=None):
    if not v.keys(path, ov, "overlay"):
        return
    kinds = [k for k in OVERLAY_KINDS if k in ov]
    if len(kinds) != 1:
        v.err(path, "needs exactly one of " + " / ".join(f"{k}:" for k in OVERLAY_KINDS))
        return
    kind = kinds[0]
    if kind == "image" and not any(expand(ov["image"], b).exists() for b in (brand["_dir"], *BRANDS, INBOX, v.spec_dir)):
        v.err(f"{path}.image", f"file not found: {ov['image']} (looked in the spec folder, the brand folder, workspace/brand/, brand/, inbox/)")
    if kind in ("text", "counter") and ov.get("style"):
        _check_style(v, f"{path}.style", ov["style"], brand)
    if kind == "counter":
        if v.keys(f"{path}.counter", ov["counter"], "counter"):
            for k in ("from", "to"):
                if not isinstance(ov["counter"].get(k), (int, float)):
                    v.err(f"{path}.counter.{k}", "required number")
            if ov["counter"].get("format") not in (None, "int", "decimal", "percent", "currency", "time", "comma"):
                v.err(f"{path}.counter.format", "must be int | decimal | percent | currency | time | comma")
    if kind == "mark":
        m = ov["mark"]
        if v.keys(f"{path}.mark", m, "mark"):
            if m.get("type") not in MARKS:
                v.err(f"{path}.mark.type", f"unknown mark '{m.get('type')}' (use {', '.join(sorted(MARKS))})")
            if m.get("type") == "arrow" and "from" not in m:
                v.err(f"{path}.mark.from", "arrows need from: [x, y] (and to: or rect:)")
    if kind == "video":
        if sources is not None and ov["video"] not in sources:
            v.err(f"{path}.video", f"unknown source '{ov['video']}' (have: {', '.join(sources)})")
        lay = ov.get("layout")
        if isinstance(lay, dict):
            v.keys(f"{path}.layout", lay, "layout")
            if lay.get("type", "card") not in ("card", "circle", "iphone", "rect"):
                v.err(f"{path}.layout.type", "must be card | circle | iphone | rect")
    if kind == "motion":
        _check_motion(v, f"{path}.motion", ov["motion"], ov.get("props"))
    a = ov.get("anim")
    if isinstance(a, dict):
        v.keys(f"{path}.anim", a, "anim")
        for k in ("in", "out"):
            if a.get(k) and a[k] not in anim.PRESETS:
                v.err(f"{path}.anim.{k}", f"unknown animation '{a[k]}' (use {', '.join(sorted(anim.PRESETS))})")
        if a.get("idle") and a["idle"] not in ("float", "wiggle", "pulse", "breathe", "spin", "shake"):
            v.err(f"{path}.anim.idle", "must be float | wiggle | pulse | breathe | spin | shake")
    elif isinstance(a, str) and a not in anim.PRESETS:
        v.err(f"{path}.anim", f"unknown animation '{a}' (use {', '.join(sorted(anim.PRESETS))})")


def _check_background(v, path, bg):
    if isinstance(bg, str):
        return
    if not v.keys(path, bg, "background"):
        return
    if bg.get("type", "blur") not in BACKGROUNDS:
        v.err(f"{path}.type", f"unknown background '{bg.get('type')}' (use {', '.join(sorted(BACKGROUNDS))})")


def _check_text_anim(v, path, a):
    if not v.keys(path, a, "text_anim"):
        return
    if a.get("by") not in (None, "block", "word", "letter", "line"):
        v.err(f"{path}.by", "must be block | word | letter | line")
    for k in ("effect", "out_effect"):
        if a.get(k) and a[k] not in anim.PRESETS:
            v.err(f"{path}.{k}", f"unknown animation '{a[k]}' (use {', '.join(sorted(anim.PRESETS))})")
    if a.get("ease") and a["ease"] not in anim.EASINGS:
        v.err(f"{path}.ease", f"unknown easing (use {', '.join(sorted(anim.EASINGS))})")


def _check_motion(v, path, mid, props):
    from . import motion
    cat = motion.catalog()
    if cat is None:
        v.warn(path, "motion/ (Remotion) is not set up yet; run: cd motion && npm install")
        return
    if mid not in cat:
        import difflib as dl
        sug = dl.get_close_matches(str(mid), list(cat), n=1)
        v.err(path, f"unknown motion look '{mid}'" + (f" (did you mean '{sug[0]}'?)" if sug else f" (see ./vtk looks --motion)"))
        return
    known = set(cat[mid].get("props", {})) | {"width", "height", "fps", "duration", "transparent", "theme", "font", "font2"}
    for k in (props or {}):
        if k not in known:
            v.warn(f"{path}.props.{k}", f"not a known prop of '{mid}' (known: {', '.join(sorted(cat[mid].get('props', {})))})")
