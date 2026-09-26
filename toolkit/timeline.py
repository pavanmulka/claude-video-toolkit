"""Turn a validated spec into a frame-exact plan: segments, section text, overlays, sound events."""
import copy
import json
from pathlib import Path

import numpy as np

from . import brand as brandmod
from .device import is_iphone_recording
from .paths import BRANDS, INBOX, expand


class PlanError(Exception):
    pass


def resolve_file(p, spec):
    """Find an asset path: absolute, spec folder, brand folder, brand root, inbox."""
    q = Path(str(p)).expanduser()
    if q.is_absolute():
        return q
    for base in (spec["dir"], Path(spec["brand"]["_dir"]), *BRANDS, INBOX):
        if (base / q).exists():
            return base / q
    return expand(p)


def _ramp_times(a, b, keys, fps):
    """Source times per output frame for a speed ramp. keys: [[src_time, speed], ...]."""
    keys = sorted((float(t), float(s)) for t, s in keys)
    ts = np.linspace(a, b, max(2, int((b - a) * fps * 20)))
    sp = np.interp(ts, [k[0] for k in keys], [k[1] for k in keys])
    out = np.concatenate([[0.0], np.cumsum(np.diff(ts) / ((sp[1:] + sp[:-1]) / 2))])
    n = max(1, int(round(out[-1] * fps)))
    return np.interp(np.arange(n) / fps, out, ts)


def _layout_for(clip, sec, spec, src_info):
    lay = clip.get("layout") or sec.get("layout") or spec["defaults"].get("layout")
    if lay is None:
        if src_info and src_info.get("width") and is_iphone_recording(src_info["width"], src_info["height"]) \
                and src_info["height"] > src_info["width"]:
            lay = "iphone"
        elif src_info and src_info.get("width") and src_info["width"] / max(1, src_info["height"]) > (spec["output"]["W"] / spec["output"]["H"]) * 1.4:
            lay = "fit"
        else:
            lay = "fullbleed"
    if isinstance(lay, str):
        lay = {"type": lay}
    base = copy.deepcopy(spec["brand"].get("layouts", {}).get(lay["type"], {}))
    base.update(lay)
    return base


def _background_for(clip, sec, spec):
    bg = clip.get("background") or sec.get("background") or spec["defaults"].get("background") or spec["brand"].get("background")
    if isinstance(bg, str):
        bg = {"type": "color", "color": bg}
    return bg or {"type": "color", "color": "#000000"}


OVERLAP = {"crossfade", "slide", "push", "whip", "zoom", "blur", "wipe", "circle", "glitch", "flash"}
TRANS_DUR = {"crossfade": 0.25, "slide": 0.35, "push": 0.35, "whip": 0.22, "zoom": 0.35, "blur": 0.3, "wipe": 0.4,
             "circle": 0.45, "glitch": 0.2, "flash": 0.2, "dip": 0.3}
TRANS_SFX = {"whip": ("whoosh", -16), "slide": ("swish", -18), "push": ("swish", -18), "zoom": ("whoosh", -17),
             "glitch": ("glitch", -18), "wipe": ("swish", -20), "circle": ("swish", -20), "flash": ("impact", -20)}


def _transition(tr, fps):
    if tr is None or tr == "cut":
        return {"type": "cut", "n": 0}
    if isinstance(tr, str):
        tr = {"type": tr}
    t = tr.get("type", "cut")
    d = tr.get("dur", TRANS_DUR.get(t, 0.3))
    out = {"type": t, "n": max(1, int(round(d * fps))), "color": tr.get("color", "#FFFFFF" if t == "flash" else "#000000")}
    for k in ("dir", "ease", "pos", "sfx", "volume"):
        if k in tr:
            out[k] = tr[k]
    return out


def _key(t, zoom=1.0, focus=None, pan=None, tilt=None, rot=0.0, ease=None):
    return {"t": t, "zoom": float(zoom), "focus": focus, "pan": list(pan or [0, 0]), "tilt": list(tilt or [0, 0]),
            "rot": float(rot or 0.0), "ease": ease}


def _camera(clip, drift=0.0):
    """Normalise camera keys -> list of {t, zoom, focus|None, pan, tilt, rot, ease} (t None = end of clip)."""
    if clip.get("camera"):
        keys = [_key(float(k.get("t", 0)), k.get("zoom", 1.0), k.get("focus"), k.get("pan"), k.get("tilt"), k.get("rotate"), k.get("ease"))
                for k in clip["camera"]]
        return sorted(keys, key=lambda k: k["t"])
    z = clip.get("zoom", 1.0)
    f = clip.get("focus")
    p = clip.get("pan", [0, 0])
    tl = clip.get("tilt")
    rot = clip.get("rotate", 0.0)
    if isinstance(tl, (list, tuple)) and tl and isinstance(tl[0], (list, tuple)):   # tilt: [[x0, y0], [x1, y1]]
        z0, z1 = (z if isinstance(z, (list, tuple)) else (z, z))
        return [_key(0.0, z0, f, p, tl[0], rot), _key(None, z1, f, p, tl[1], rot)]
    if isinstance(z, (list, tuple)):
        return [_key(0.0, z[0], f, p, tl, rot), _key(None, z[1], f, p, tl, rot)]
    if drift and "zoom" not in clip:
        return [_key(0.0, z, f, p, tl, rot, "linear"), _key(None, float(z) * (1 + drift), f, p, tl, rot, "linear")]
    return [_key(0.0, z, f, p, tl, rot)]


def build(spec, fps=None, scale=1.0):
    out = spec["output"]
    F = fps or out["fps"]
    plan = {"fps": F, "W": int(round(out["W"] * scale / 2) * 2), "H": int(round(out["H"] * scale / 2) * 2),
            "scale": scale, "unit": out["unit"] * scale, "segments": [], "sections": [], "overlays": [],
            "sfx": [], "warnings": list(spec.get("warnings", []))}
    cursor = 0
    prev = None
    ids = {}
    for si, sec in enumerate(spec["timeline"]):
        seg_list = []
        for ci, c in enumerate(sec["clips"]):
            seg = _make_segment(spec, sec, si, ci, c, F)
            seg_list.append(seg)
        # fit to section duration
        target = sec.get("dur")
        if sec.get("beats"):
            target = float(sec["beats"]) * 60.0 / _bpm(spec)
        if target:
            tf = int(round(target * F))
            have = sum(s["n"] for s in seg_list) - sum(min(s["trans"]["n"], s["n"]) for s in seg_list[1:] if s["trans"]["type"] in OVERLAP)
            diff = tf - have
            last = seg_list[-1]
            if diff > 0:
                mode = sec.get("fit", "hold")
                if mode == "extend" and last["kind"] == "video":
                    src_dur = spec["sources"][last["src"]]["info"]["duration"]
                    step = last["speed_end"] / F
                    extra = np.array([last["times"][last["main_end"] - 1] + step * (k + 1) for k in range(diff)])
                    ok = extra[extra < src_dur - 0.5 / F]
                    last["times"] = np.concatenate([last["times"][:last["main_end"]], ok, last["times"][last["main_end"]:]])
                    last["main_end"] += len(ok)
                    diff -= len(ok)
                if diff > 0:
                    last["times"] = np.concatenate([last["times"], np.repeat(last["times"][-1:], diff)])
                if abs(tf - have) / F > 0.5:
                    plan["warnings"].append(f"section '{sec.get('section', si)}': extended by {(tf - have) / F:.2f}s ({mode}) to reach dur {target}s")
            elif diff < 0:
                cut = -diff
                if cut >= len(last["times"]):
                    raise PlanError(f"section '{sec.get('section', si)}': clips are {have / F:.2f}s, can't trim to dur {target}s")
                last["times"] = last["times"][: len(last["times"]) - cut]
                last["main_end"] = min(last["main_end"], len(last["times"]))
                if cut / F > 0.3:
                    plan["warnings"].append(f"section '{sec.get('section', si)}': trimmed {cut / F:.2f}s off the last clip to reach dur {target}s")
            last["n"] = len(last["times"])
        # place
        sec_start = None
        for seg in seg_list:
            tr = seg["trans"]
            if prev is not None and tr["type"] in OVERLAP:
                tr["n"] = min(tr["n"], prev["n"] // 2, seg["n"] // 2)
                seg["start"] = cursor - tr["n"]
            else:
                seg["start"] = cursor
                if prev is not None and tr["type"] == "dip":
                    prev["dip_out"] = {"n": tr["n"] // 2, "color": tr["color"]}
                    seg["dip_in"] = {"n": tr["n"] - tr["n"] // 2, "color": tr["color"]}
            if prev is None and tr["type"] == "dip":
                seg["dip_in"] = {"n": tr["n"], "color": tr["color"]}
            if prev is not None and tr["type"] != "cut":
                snd = tr.get("sfx", "auto")
                if snd == "auto":
                    snd, vol = TRANS_SFX.get(tr["type"], (None, 0))
                else:
                    vol = -16
                if snd and snd != "none":
                    mid = (seg["start"] + tr["n"] / 2) / F if tr["type"] in OVERLAP else seg["start"] / F
                    plan["sfx"].append({"sound": brandmod.sound_path(spec["brand"], snd), "at": mid, "volume": tr.get("volume", vol),
                                        "pan": 0, "align": "peak"})
            seg["end"] = seg["start"] + seg["n"]
            cursor = seg["end"]
            sec_start = seg["start"] if sec_start is None else sec_start
            if seg.get("id"):
                ids[seg["id"]] = seg
            plan["segments"].append(seg)
            prev = seg
        text = sec.get("text")
        behind = False
        if isinstance(text, dict):
            tstyle, tpos, tcontent, behind = text.get("style"), text.get("pos"), text.get("content"), bool(text.get("behind"))
        else:
            tstyle, tpos, tcontent = None, None, text
        plan["sections"].append({
            "behind": behind,
            "name": sec.get("section", f"section{si}"), "start": sec_start, "end": cursor,
            "text": None if tcontent in (None, "none", "") else str(tcontent),
            "style": tstyle or sec.get("text_style") or spec["defaults"].get("text_style") or "caption_top",
            "pos": tpos or sec.get("text_pos") or spec["defaults"].get("text_pos") or "caption_band",
            "anim": {**spec["brand"].get("text_anim", {}), **(spec["defaults"].get("text_anim") or {}), **(sec.get("text_anim") or {})},
        })
        _text_sfx(plan, spec, F)
        for ov in sec.get("overlays") or []:
            plan["overlays"].append(_overlay(ov, spec, F, base=sec_start, default_end=cursor))
    plan["total"] = cursor
    for i, s in enumerate(plan["sections"][:-1]):
        s["end"] = min(s["end"], plan["sections"][i + 1]["start"])
    for ov in spec["overlays"]:
        plan["overlays"].append(_overlay(ov, spec, F, base=0, default_end=cursor))
    # sound events pinned to clips
    for seg in plan["segments"]:
        for s in seg["sfx"]:
            if "src" in s:
                local = _src_to_local(seg, float(s["src"]), F)
                if local is None:
                    plan["warnings"].append(f"clip {seg['label']}: sfx at source {s['src']}s is outside the clip's range; skipped")
                    continue
                t = (seg["start"] + local) / F
            else:
                t = seg["start"] / F + float(s["at"])
            plan["sfx"].append({"sound": brandmod.sound_path(spec["brand"], s["sound"]), "at": t,
                                "volume": s.get("volume", 0), "pan": s.get("pan", 0), "align": s.get("align", "start")})
    plan["taps"] = []
    for seg in plan["segments"]:
        for t in seg.get("taps") or []:
            local = _src_to_local(seg, float(t["src"]), F) if "src" in t else float(t["at"]) * F
            if local is None:
                plan["warnings"].append(f"clip {seg['label']}: tap at source {t['src']}s is outside the clip's range; skipped")
                continue
            g = seg["start"] + local
            plan["taps"].append({"g": g, "seg": seg["label"], "pos": t["pos"]})
            if t.get("sound", "tap") not in (None, "none", False):
                plan["sfx"].append({"sound": brandmod.sound_path(spec["brand"], t.get("sound", "tap")), "at": g / F,
                                    "volume": t.get("volume", -15), "pan": 0, "align": "start"})
    for s in (spec["audio"].get("sfx") or []):
        plan["sfx"].append({"sound": brandmod.sound_path(spec["brand"], s["sound"]), "at": float(s["at"]),
                            "volume": s.get("volume", 0), "pan": s.get("pan", 0), "align": s.get("align", "start")})
    plan["ids"] = {k: (v["start"] / F, v["end"] / F) for k, v in ids.items()}
    _pin_times(plan, F)
    _chain_drift(plan)
    _autozoom(plan, spec, F)
    return plan


def _src_to_local(seg, src_t, F):
    """Output frame offset (float) inside a segment where source time src_t plays, or None."""
    ms = seg.get("main_start", 0)
    main = seg["times"][ms:seg["main_end"]]
    if len(main) == 0:
        return None
    step = seg.get("speed_end", 1.0) / F
    if src_t < main[0] - 0.5 * step or src_t > main[-1] + step:
        return None
    if len(main) == 1 or src_t <= main[0]:
        return float(ms)
    if src_t >= main[-1]:
        return ms + len(main) - 1 + (src_t - main[-1]) / step
    return ms + float(np.interp(src_t, main, np.arange(len(main))))


def _make_segment(spec, sec, si, ci, c, F):
    label = f"{sec.get('section', si)}[{ci}]"
    drift = c.get("drift", sec.get("drift", spec["defaults"].get("drift", 0.0)))
    if not ("src" in c or "still" in c or "image" in c) or c.get("camera") or "zoom" in c or _tilt_pair(c.get("tilt")):
        drift = 0.0                                    # only clips whose camera is the plain drift push-in
    seg = {"label": label, "section": si, "id": c.get("id"), "sfx": c.get("sfx") or [], "trans": _transition(c.get("transition") or (spec["defaults"].get("transition") if ci or si else None), F),
           "camera": _camera(c, drift), "drift": float(drift or 0.0), "dim": c.get("dim", 0.0),
           "vignette": c.get("vignette", 0.0), "audio": c.get("audio"),
           "enter": c.get("enter") or sec.get("enter"), "taps": c.get("taps") or [], "lifts": [dict(x) for x in c.get("lifts") or []],
           "marks": [dict(x) for x in c.get("marks") or []],
           "autozoom": c.get("autozoom", sec.get("autozoom", spec["defaults"].get("autozoom"))), "manual_camera": bool(c.get("camera"))}
    if "still" in c:
        src = c["still"]["src"]
        info = spec["sources"][src]["info"]
        n = int(round(c["dur"] * F))
        seg.update(kind="still", src=src, times=np.full(n, float(c["still"].get("at", 0.0))), main_end=n, speed_end=1.0)
    elif "color" in c:
        info = None
        n = int(round(c["dur"] * F))
        seg.update(kind="color", src=None, color=str(c["color"]), times=np.zeros(n), main_end=n, speed_end=1.0)
    elif "image" in c:
        info = None
        n = int(round(c["dur"] * F))
        seg.update(kind="image", src=None, image=str(resolve_file(c["image"], spec)), times=np.zeros(n), main_end=n, speed_end=1.0)
    elif "motion" in c:
        info = None
        n = int(round(c["dur"] * F))
        seg.update(kind="motion", src=None, motion={"id": c["motion"], "props": dict(c.get("props") or {}),
                                                    "transparent": c.get("transparent", True)},
                   motion_transparent=c.get("transparent", True), times=np.zeros(n), main_end=n, speed_end=1.0)
    else:
        src = c["src"]
        info = spec["sources"][src]["info"]
        a = float(c.get("in", 0.0))
        src_dur = info["duration"]
        if "ramp" in c:
            b = float(c.get("out", src_dur))
            main = _ramp_times(a, b, c["ramp"], F)
            speed_end = float(sorted(c["ramp"])[-1][1])
        else:
            s = float(c.get("speed", 1.0))
            if "dur" in c:
                n_main = int(round(float(c["dur"]) * F))
            else:
                b = float(c.get("out", src_dur))
                n_main = int(round((b - a) / s * F))
            main = a + np.arange(max(1, n_main)) * s / F
            speed_end = s
        main = np.minimum(main, max(a, src_dur - 1.0 / 120))
        hs = np.full(int(round(float(c.get("hold_start", 0)) * F)), main[0])
        he = np.full(int(round(float(c.get("hold", 0)) * F)), main[-1])
        times = np.concatenate([hs, main, he])
        seg.update(kind="video", src=src, times=times, main_start=len(hs), main_end=len(hs) + len(main), speed_end=speed_end,
                   speed=c.get("speed", 1.0) if "ramp" not in c else None)
    seg["n"] = len(seg["times"])
    seg["layout"] = _layout_for(c, sec, spec, info if seg["kind"] not in ("image", "color", "motion") else None)
    seg["background"] = _background_for(c, sec, spec)
    k0 = seg["camera"][0]                              # clips with the same frame on screen share one drift (_chain_drift)
    seg["frame_key"] = json.dumps([seg["layout"], (info or {}).get("width"), (info or {}).get("height"), k0["focus"], k0["pan"],
                                   k0["tilt"], k0["rot"]], sort_keys=True, default=str)
    return seg


def _tilt_pair(tl):
    return isinstance(tl, (list, tuple)) and bool(tl) and isinstance(tl[0], (list, tuple))


def _chain_drift(plan):
    """`drift` on consecutive clips of one section that show the same phone / card / fit frame runs as ONE slow
    push-in across the cuts. Restarting it per clip made the device snap back (~3 %, 10 px a side) at every cut,
    which reads as the phone pulsing or flickering through a multi-clip demo. Full-bleed shots keep one drift each."""
    segs = plan["segments"]
    i = 0
    while i < len(segs):
        s0 = segs[i]
        j = i + 1
        if s0["drift"] and s0["layout"]["type"] in ("iphone", "card", "fit"):
            while j < len(segs) and segs[j]["drift"] == s0["drift"] and segs[j]["section"] == s0["section"] \
                    and segs[j]["frame_key"] == s0["frame_key"]:
                j += 1
        run = segs[i:j]
        if len(run) > 1:
            g0, span = run[0]["start"], max(1, run[-1]["end"] - run[0]["start"])
            for s in run:
                a, b = s["camera"]
                z = a["zoom"]
                a["zoom"] = z * (1 + s["drift"] * (s["start"] - g0) / span)
                b["zoom"] = z * (1 + s["drift"] * (s["end"] - g0) / span)
        i = j


def _text_sfx(plan, spec, F):
    """text_anim.sfx: a sound when the section text animates in (typing clicks repeat while letters type)."""
    s = plan["sections"][-1]
    a = s["anim"]
    snd = a.get("sfx")
    if not snd or not s["text"] or snd == "none":
        return
    t0 = s["start"] / F
    vol = a.get("sfx_volume", -22 if snd == "typing" else -18)
    if snd == "typing" and a.get("by") == "letter":
        n = len(s["text"].replace("**", "").replace("~~", "").replace(" ", ""))
        dur = n * a.get("stagger", 0.035)
        k = 0.0
        while k < dur - 0.05:
            plan["sfx"].append({"sound": brandmod.sound_path(spec["brand"], "typing"), "at": t0 + k, "volume": vol, "pan": 0, "align": "start"})
            k += 1.15
        return
    plan["sfx"].append({"sound": brandmod.sound_path(spec["brand"], snd), "at": t0 + a.get("sfx_at", 0.0), "volume": vol, "pan": 0,
                        "align": "peak" if snd in ("whoosh", "swish", "swoosh_up") else "start"})


def _anim(a):
    if not a:
        return None
    if isinstance(a, str):
        return {"in": a}
    return dict(a)


def _overlay(ov, spec, F, base, default_end):
    start = base + int(round(float(ov.get("start", 0)) * F))
    if "end" in ov:
        end = base + int(round(float(ov["end"]) * F))
    elif "dur" in ov:
        end = start + int(round(float(ov["dur"]) * F))
    else:
        end = default_end
    fade = ov.get("fade", 0.25)
    fi, fo = (fade if isinstance(fade, (list, tuple)) else (fade, fade))
    d = {"start": start, "end": end, "pos": ov.get("pos", "center"), "anchor": ov.get("anchor", "center"),
         "fade_in": float(fi), "fade_out": float(fo), "rise": float(ov.get("rise", 0)), "opacity": float(ov.get("opacity", 1.0)),
         "anim": _anim(ov.get("anim")), "shine": ov.get("shine")}
    if d["shine"] is True:
        d["shine"] = {}
    if "text" in ov:
        d.update(kind="text", text=str(ov["text"]), style=ov.get("style", "title"))
    elif "counter" in ov:
        c = dict(ov["counter"])
        c["dur"] = c.get("dur", 1.2)
        d.update(kind="counter", counter=c, style=ov.get("style", "title"))
    elif "mark" in ov:
        d.update(kind="mark", mark=dict(ov["mark"]))
    elif "motion" in ov:
        d.update(kind="motion", motion={"id": ov["motion"], "props": dict(ov.get("props") or {}), "transparent": True})
    elif "video" in ov:
        src = ov["video"]
        info = spec["sources"][src]["info"]
        n = max(1, end - start)
        sp = float(ov.get("speed", 1.0))
        a0 = float(ov.get("in", 0.0))
        times = np.minimum(a0 + np.arange(n) * sp / F, max(a0, info["duration"] - 1.0 / 120))
        lay = ov.get("layout") or {}
        if isinstance(lay, str):
            lay = {"type": lay}
        d.update(kind="video", src=src, times=times, layout=lay)
    else:
        d.update(kind="image", image=str(resolve_file(ov["image"], spec)), size=ov.get("size"))
    return d


def _bpm(spec):
    mu = (spec["audio"] or {}).get("music") or {}
    if mu.get("bpm"):
        return float(mu["bpm"])
    if mu.get("generate") is not None:
        return float((mu["generate"] or {}).get("bpm", 120))
    return 120.0


def _autozoom(plan, spec, F):
    """clip `autozoom`: camera keys that push in on each tap (and pan between taps close together), then release.
    Needs taps; ignored when the clip has its own camera. {zoom: 1.15, lead: 0.3, hold: 0.7, release: 0.45}."""
    for seg in plan["segments"]:
        az = seg.get("autozoom")
        if not az or seg.get("manual_camera"):
            continue
        az = {} if az is True else dict(az)
        Z = float(az.get("zoom", 1.15 if seg["layout"]["type"] == "iphone" else 1.35))
        lead, hold, rel = float(az.get("lead", 0.3)), float(az.get("hold", 0.7)), float(az.get("release", 0.45))
        taps = sorted([t for t in plan["taps"] if t["seg"] == seg["label"]], key=lambda t: t["g"])
        if not taps:
            continue
        dur = seg["n"] / F
        base = seg["camera"][0]
        keys = [_key(0.0, base["zoom"], base["focus"], base["pan"], base["tilt"], base["rot"])]
        for i, t in enumerate(taps):
            tt = (t["g"] - seg["start"]) / F
            nxt = (taps[i + 1]["g"] - seg["start"]) / F if i + 1 < len(taps) else None
            t_in, t_on = max(keys[-1]["t"] + 0.01, tt - lead), max(keys[-1]["t"] + 0.02, tt - 0.04)
            if keys[-1]["zoom"] <= base["zoom"] + 1e-3:
                keys.append(_key(t_in, base["zoom"], keys[-1]["focus"] or t["pos"], base["pan"], base["tilt"], base["rot"]))
            keys.append(_key(t_on, Z, list(t["pos"]), base["pan"], base["tilt"], base["rot"], "in_out"))
            if nxt is not None and nxt - tt < hold + lead + rel:
                continue                                   # stay zoomed; the next tap pans there
            t_hold = min(dur, tt + hold)
            keys.append(_key(t_hold, Z, list(t["pos"]), base["pan"], base["tilt"], base["rot"]))
            keys.append(_key(min(dur, t_hold + rel), base["zoom"], list(t["pos"]), base["pan"], base["tilt"], base["rot"], "in_out"))
        seg["camera"] = [k for k in keys if k["t"] <= dur + 1e-6]
        seg["keep_top"] = az.get("keep_top", True)


def _pin_times(plan, F):
    """Local start times (seconds into the clip) for lifts and marks given by source time or clip time."""
    for seg in plan["segments"]:
        for kind in ("lifts", "marks"):
            keep = []
            for x in seg.get(kind) or []:
                if "src" in x:
                    local = _src_to_local(seg, float(x["src"]), F)
                    if local is None:
                        plan["warnings"].append(f"clip {seg['label']}: {kind[:-1]} at source {x['src']}s is outside the clip's range; skipped")
                        continue
                    x["t0"] = local / F
                else:
                    x["t0"] = float(x.get("at", 0.0))
                if kind == "marks" and "draw" not in x:
                    x["draw"] = 0.45
                keep.append(x)
            seg[kind] = keep


def describe(plan):
    """Human-readable table of the plan."""
    F = plan["fps"]
    rows = [f"{'section / clip':28s} {'kind':6s} {'source range':>22s} {'speed':>6s}   out"]
    for seg in plan["segments"]:
        t = seg["times"]
        rng = f"{t[0]:6.2f} -> {t[-1]:6.2f}" if seg["kind"] in ("video", "still") else "-"
        sp = f"{seg.get('speed') or 'ramp'}" if seg["kind"] == "video" else "-"
        tr = "" if seg["trans"]["type"] == "cut" else f"  ({seg['trans']['type']})"
        rows.append(f"{seg['label']:28s} {seg['kind']:6s} {rng:>22s} {sp:>6}   {seg['start'] / F:6.2f} - {seg['end'] / F:6.2f}  [{seg['layout']['type']}]{tr}")
    rows.append(f"total {plan['total'] / F:.2f}s  ({plan['total']} frames @ {F} fps)")
    return "\n".join(rows)
