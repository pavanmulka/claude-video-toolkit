"""./vtk <command> — see CLAUDE.md for the full workflow."""
import argparse
import json
import shutil
import sys
import time
from pathlib import Path

from . import brand as brandmod
from .paths import BRAND, HISTORY, INBOX, WORK, work_dir


def cmd_inspect(a):
    from .analysis.inspect_media import inspect, print_report
    paths = a.paths or [str(INBOX)]
    out = Path(a.out) if a.out else work_dir("analysis")
    rep = inspect(paths, out, sheets=not a.no_sheets)
    print_report(rep)
    print(f"\nreport: {out / 'inspect.json'}")


def cmd_scenes(a):
    from .analysis.scenes import detect
    out = Path(a.out) if a.out else work_dir("analysis")
    res = detect(a.clip, out, threshold=a.threshold)
    print(f"{len(res['scenes'])} scenes")
    for s in res["scenes"]:
        print(f"  {s['start']:7.2f} - {s['end']:7.2f}  ({s['dur']:.2f}s)")
    idle = [x for x in res["activity"] if x["state"] == "idle"]
    if idle:
        print("idle stretches (nothing moving): " + ", ".join(f"{x['start']:.1f}-{x['end']:.1f}" for x in idle))
    for s in res["sheets"]:
        print(f"sheet: {s}")


def cmd_reference(a):
    from .analysis.reference import analyze, summary
    out = Path(a.out) if a.out else work_dir("analysis")
    print(summary(analyze(a.video, out)))


def cmd_audio(a):
    from .analysis.audio_analysis import analyze
    out = Path(a.out) if a.out else work_dir("analysis")
    r = analyze(a.file, out)
    print(f"{Path(a.file).name}: {r['duration']}s  loudness {r.get('loudness_lufs')} LUFS  peak {r.get('peak_dbfs')} dBFS")
    print(f"tempo ~{r['tempo_bpm']} BPM, {len(r['beats'])} beats")
    if r.get("downbeats"):
        print("downbeats (bar starts): " + " ".join(f"{b:.2f}" for b in r["downbeats"][:40]))
    print("beats: " + " ".join(f"{b:.2f}" for b in r["beats"][:64]) + (" ..." if len(r["beats"]) > 64 else ""))
    if r["silences"]:
        print("silences: " + ", ".join(f"{x:.2f}-{y:.2f}" for x, y in r["silences"]))


def cmd_voiceover(a):
    from .analysis.voiceover import print_summary, transcribe
    out = Path(a.out) if a.out else work_dir("analysis")
    vocab = None
    if a.brand:
        from . import brand as brandmod
        vocab = brandmod.load(a.brand).get("vocabulary")
    res = transcribe(a.file, model=a.model, language=a.language, out_dir=out, vocabulary=vocab)
    print_summary(res)
    print(f"\ntranscript: {out / (Path(a.file).stem + '.transcript.json')}\nsrt: {out / (Path(a.file).stem + '.srt')}")


TEMPLATE = """# {name} — created {date}
# Sources resolve relative to inbox/. Times are seconds. See CLAUDE.md for every field.
version: 1
name: {name}
brand: {brand}
output:
  file: {name}_v1.mp4          # written to inbox/
  aspect: "9:16"
  fps: 30
sources:
{sources}
timeline:
  - section: hook
    text: "HOOK TEXT"
    text_style: hook
    text_pos: center
    clips:
      - {{src: {first}, in: 0.0, out: 3.0}}
audio:
  music: {{generate: {{bpm: 120, key: D, drop: 0}}, volume: -4}}
"""


TEMPLATES = Path(__file__).resolve().parent.parent / "templates"


def templates():
    """{name: first comment line} of templates/*.yaml."""
    out = {}
    for p in sorted(TEMPLATES.glob("*.yaml")):
        first = p.read_text().splitlines()[0]
        out[p.stem] = first.split('template "', 1)[-1].split('"', 1)[-1].strip(" ()") if 'template "' in first else first
    return out


def cmd_new(a):
    from .media import kind_of
    if a.list:
        print("templates (./vtk new <name> --template <t>):")
        for k, v in templates().items():
            print(f"  {k:22s} {v}")
        return
    date = time.strftime("%Y-%m-%d")
    d = HISTORY / f"{date}_{a.name}"
    d.mkdir(parents=True, exist_ok=True)
    f = d / "spec.yaml"
    if f.exists() and not a.force:
        print(f"exists: {f} (use --force to overwrite)")
        return
    import re
    files = [p for p in sorted(INBOX.iterdir()) if p.is_file() and kind_of(p) in ("video", "image", "audio")
             and not re.search(r"_v\d+(_preview)?\.mp4$", p.name)]  # skip our own renders
    lines, vids = [], []
    for p in files:
        key = re.sub(r"[^a-z0-9]+", "_", p.stem.lower()).strip("_")[:24] or "clip"
        if kind_of(p) == "audio":
            lines.append(f"  # {key}: {p.name}        # audio: use in audio.voiceover / audio.tracks")
            continue
        lines.append(f"  {key}: {p.name}")
        if kind_of(p) == "video":
            vids.append(key)
    first = vids[0] if vids else "clip1"
    if a.template:
        t = TEMPLATES / f"{a.template}.yaml"
        if not t.exists():
            print(f"unknown template '{a.template}' (have: {', '.join(templates())})")
            sys.exit(1)
        clips = (vids + [first] * 3)[:3] if vids else ["clip1"] * 3
        text = t.read_text()
        for k, v in {"__NAME__": a.name, "__DATE__": date, "__BRAND__": a.brand, "__THEME__": a.theme or "midnight_plum",
                     "__SOURCES__": "\n".join(lines) or "  clip1: myclip.mp4", "__CLIP1__": clips[0], "__CLIP2__": clips[1],
                     "__CLIP3__": clips[2]}.items():
            text = text.replace(k, v)
        f.write_text(text)
    else:
        f.write_text(TEMPLATE.format(name=a.name, date=date, brand=a.brand, sources="\n".join(lines) or "  clip1: myclip.mp4", first=first))
    print(f"spec: {f}\nwork: {work_dir(d.name)}")


def cmd_validate(a):
    from . import spec as specmod, timeline
    try:
        s = specmod.load(a.spec)
    except specmod.SpecError as e:
        print("spec has errors:")
        for x in e.errors:
            print(f"  x {x}")
        for x in e.warnings:
            print(f"  ! {x}")
        sys.exit(1)
    plan = timeline.build(s)
    print(timeline.describe(plan))
    if (s["audio"] or {}).get("voiceover"):
        from . import audio as audiomod, captions
        words = audiomod.vo_words(s)
        _, _, info = audiomod.process_voiceover(s["audio"]["voiceover"])
        print(f"\nvoice-over at output time (starts {info['start']}s, {info['out_dur']}s long"
              + (f", {info['removed_s']}s of pauses removed" if info.get("removed_s") else "") + "):")
        for p in captions.phrases(words):
            print(f"  {p['start']:6.2f} - {p['end']:6.2f}  {p['text']}")
    ws = plan["warnings"]
    print("OK" + (f" with {len(ws)} warning(s):" if ws else ""))
    for w in ws:
        print(f"  ! {w}")


def cmd_render(a):
    from . import spec as specmod
    from .render import render
    variants = [a.variant] if a.variant else (specmod.variants(a.spec) if a.all_variants else [None])
    aspects = [None] + [x for x in ("1:1", "4:5", "16:9")] if a.sizes else [a.aspect]
    try:
        for v in variants:
            for asp in aspects:
                if v or asp:
                    print(f"\n=== {'variant ' + v if v else ''}{'  ' if v and asp else ''}{'aspect ' + asp if asp else ''} ===")
                render(a.spec, preview=a.preview, show_safezones=a.safezones, frames=a.frames, no_audio=a.no_audio, out=a.out,
                       stems=a.stems, variant=v, aspect=asp, jobs=a.jobs)
    except specmod.SpecError as e:
        print("spec has errors:")
        for x in e.errors:
            print(f"  x {x}")
        sys.exit(1)


def cmd_sfx(a):
    from .synth import make_sfx
    meta = make_sfx(BRAND / "sfx")
    print("generated: " + ", ".join(f"{k} ({v['dur']}s)" for k, v in meta.items()) + f"\nin {BRAND / 'sfx'}")


def cmd_music(a):
    from .media import write_wav
    from .synth import music_bed
    y = music_bed(a.duration, bpm=a.bpm, key=a.key, drop=a.drop, resolve=a.resolve, seed=a.seed)
    out = Path(a.out) if a.out else BRAND / "music" / "generated" / f"bed_{a.bpm}bpm_{a.key}_{a.duration:g}s.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    write_wav(out, y)
    print(f"music bed: {out}")


def cmd_looks(a):
    from . import anim, backgrounds, brand as brandmod, motion, shapes, spec as specmod, timeline as tl
    b = brandmod.load(a.brand)
    if a.render:
        from .gallery import render_gallery
        for p in render_gallery(a.render, a.brand):
            print(f"gallery: {p}")
        return
    themes = b.get("themes", {})
    print(f"themes ({len(themes)}; spec: theme: <name>):  " + ", ".join(themes))
    print(f"backgrounds: {', '.join(sorted(specmod.BACKGROUNDS))}  (+ any theme background)")
    print(f"transitions: {', '.join(sorted(specmod.TRANSITIONS))}")
    print(f"text/overlay animations: {', '.join(sorted(anim.PRESETS))}")
    print(f"easings: {', '.join(sorted(anim.EASINGS))}")
    print("idle loops: float, wiggle, pulse, breathe, spin, shake")
    print(f"marks: {', '.join(sorted(shapes.TYPES))}")
    print(f"text styles: {', '.join(sorted(b.get('text_styles', {})))}")
    print(f"caption styles: {', '.join(sorted(b.get('caption_styles', {})))}  (anim: pop | bounce | reveal | fade | slide | none)")
    print(f"sounds: {', '.join(sorted(b.get('sfx', {})))}")
    print(f"voice fx: {', '.join(sorted(specmod.VOICE_FX))}")
    cat = motion.catalog()
    if cat is None:
        print("motion looks (Remotion): not installed — cd motion && npm install")
    else:
        print(f"motion looks (Remotion, {len(cat)}): " + ", ".join(sorted(cat)))
        if a.motion:
            for k, v in sorted(cat.items()):
                props = ", ".join(p for p in v.get("props", {}) if p not in ("width", "height", "fps", "duration", "transparent", "theme", "font", "font2"))
                print(f"  {k:20s} [{v.get('kind')}] {v.get('description', '')[:90]}\n  {'':20s} props: {props}")
    print("\nsee them: ./vtk looks --render themes|text|marks|transitions|captions|motion")


def cmd_motion(a):
    from . import motion
    if a.clear:
        print(f"removed {motion.clear_cache()} cached motion renders")
        return
    if a.id:
        import json as js
        props = js.loads(a.props) if a.props else {}
        from . import brand as brandmod
        spec = {"brand": brandmod.load(a.brand), "dir": INBOX}
        j = motion.job({"id": a.id, "props": props, "transparent": not a.opaque}, 1080, 1920, 30, a.duration, spec)
        motion.render_jobs([j])
        print(f"rendered: {j['out']}")
        return
    cat = motion.catalog()
    print("motion/ ready" if motion.available() else "motion/ not installed: cd motion && npm install")
    if cat:
        print(", ".join(sorted(cat)))


def _get_title(r):
    return str((r.get("source") or {}).get("title") or r.get("id"))


def cmd_learn(a):
    from . import channel, kb
    if not a.src and a.text is None:
        print("x give a link, a file (video / audio / .txt / .md) or --text \"...\"")
        sys.exit(1)
    if a.src and channel.is_channel(a.src):
        return _learn_channel(a)
    old = kb.seen(a.src) if a.src and not a.again else None
    if old:
        print(f"already learned on {(old.get('source') or {}).get('captured')}: {old['id']}\n  {kb._summary(old)}\n"
              f"(same video, so nothing to add; ./vtk kb show {old['id']} · learn it again: --again)")
        return
    try:
        rid, draft, d, ref = kb.learn(a.src, note=a.note, cookies=a.cookies, keep=a.keep, rid=a.id, text=a.text,
                                      mode="video" if a.video else "talk" if a.transcript else None)
    except (RuntimeError, FileNotFoundError) as e:
        print(f"x {e}")
        sys.exit(1)
    src = d["source"]
    media = src.get("media", "video")
    m = src.get("metrics", {})
    print(f"\n{rid}: {media} · {src.get('platform')} {src.get('creator') or ''}  {str(src.get('duration') or '') + 's' if src.get('duration') else ''}  "
          + "  ".join(f"{k} {v:,}" for k, v in m.items() if isinstance(v, int)))
    if src.get("title"):
        print(f"title: {src['title']}")
    an = d.get("_analysis", {})
    if media == "video":
        print(f"pacing: {ref.get('shots')} shots, {ref.get('cuts_per_10s')} cuts/10s, mean shot {ref.get('shot_len', {}).get('mean')}s"
              + (f", ~{ref['tempo_bpm']} BPM, {ref.get('cuts_on_beat_pct')}% cuts on beat" if ref.get('tempo_bpm') else "")
              + f"; overlay/text energy top/mid/bottom {ref.get('text_zones_pct')}")
        print(f"spoken: {(an.get('transcript') or '(no speech)')[:400]}")
        print(f"hook sheet: {an.get('hook_sheet')}")
        for s_ in an.get("contact_sheets") or []:
            print(f"contact sheet: {s_}")
    elif media == "audio":
        print(f"audio: ~{ref.get('tempo_bpm')} BPM, {d.get('craft', {}).get('loudness_lufs')} LUFS")
        print(f"spoken: {(an.get('transcript') or '(no speech)')[:400]}")
    elif media == "talk":
        ch = d.get("chapters") or []
        print(f"talk: {an.get('words'):,} words from {an.get('captions')}, {len(ch)} chapters -> {an.get('text')}")
        for c in ch:
            print(f"  [{kb._clock(c['t'])}] {c['title']}")
        print(f"starts: {(d.get('text_excerpt') or '')[:300]}")
    else:
        print(f"text: {an.get('chars')} characters -> {an.get('text')}")
        print(f"starts: {(d.get('text_excerpt') or '')[:300]}")
    if an.get("sound_map"):
        from .analysis.sound import describe
        print(f"sound: {describe(an.get('sound_events') or [])}")
        print(f"sound map: {an['sound_map']}")
    print(f"draft: {draft}")
    rel = kb.related(" ".join(str(x or "") for x in (src.get("title"), a.note, an.get("transcript"), an.get("text"),
                                                      d.get("text_excerpt"))), exclude=rid)
    if rel:
        print("already in the library (say what is NEW vs these; only confirmations -> strengthen, don't duplicate):")
        for sc, r in rel:
            print(f"  {r['id']}  overlap {sc}  rel {r.get('relevance')}  {(_get_title(r))[:70]}")
    else:
        print("already in the library: nothing similar yet")
    what = {"text": "read the text", "talk": "read transcript.md", "audio": "read the sound map + transcript"}.get(
        media, "read the sheets, the sound map (what the sound does besides words) + transcript")
    print(f"next (Claude): {what}; write each NEW lesson into its trends/brain page (a lesson we know: add this source as "
          f"proof); fill the draft: kind, relevance, lessons, confirms, pages, tags (keep: full only for a special source, "
          f"then also beats / craft / insights); ./vtk kb commit {rid}.  {kb.brain_usage()[0]}")


def _learn_channel(a):
    from . import channel, kb
    try:
        rid, draft_path, draft, s = channel.study(a.src, top=a.top, recent=a.recent, picks=a.picks, note=a.note,
                                                  cookies=a.cookies, refresh=a.refresh, rid=a.id)
    except RuntimeError as e:
        print(f"x {e}")
        sys.exit(1)
    m = draft["source"]["metrics"]
    fv = channel.fmt_views
    print(f"\n{rid}: {draft['source']['creator']} · {m['videos']:,} videos · {m['sponsored']} sponsored · median {fv(m['median_views'])}"
          f" · top {fv(m['top_views'])}" + (f" · {m['followers']:,} followers" if m.get("followers") else ""))
    print(f"where the hits are (newest -> oldest; top {s['top_k']} = the {s['top_k']} most-viewed non-sponsored):")
    for e in draft["eras"]:
        print(f"  {e['videos']:<12s} {e['posted'] or '':<18s} median {fv(e['median_views']):>6s}   in the top {s['top_k']}: "
              f"{e['in_top']:>3d}" + (f"   sponsored {e['sponsored']}" if e["sponsored"] else ""))
    n = draft["narration"]
    sa = draft["sample"]
    print(f"sample: top {sa['top']} by views + {sa['recent']} newest; {sa['with_speech']} with speech; posted {sa['posted'][0]} .. {sa['posted'][1]}")
    if n.get("wps"):
        print(f"narration (medians): speech starts at {n['speech_start']} s, {n['words_0_3s']} words in the first 3 s, {n['wps']} words/s, "
              f"{n['pauses_per_10s']} pauses/10 s, {n['tail_silence']} s silent at the end ({n['ends_talking_pct']}% end mid-speech), "
              f"{n['duration']} s long")
        print(f"openers: " + " · ".join(f"{k} {v}" for k, v in n["openers"].items())
              + f"; a number in the first 3 s: {n['number_first_3s_pct']}%")
        pw = n["per_100_words"]
        print(f"per 100 words: I {pw['i']} · you {pw['you']} · we {pw['we']} · numbers {pw['numbers']}")
    t = draft["titles"]
    print(f"titles: {t['question']}% question · {t['money']}% $ · {t['versus']}% vs · {t['starts_with_i']}% start with I · "
          f"{t['emoji']}% emoji · median {t['words']} words")
    print("deep-learn picks (pacing, sound; one per opener type + the newest; wait if YouTube just showed its bot check):")
    for p in s["picks"]:
        print(f"  ./vtk learn {p['url']}   # {fv(p['views'])} · {p['title'][:60]} ({p['why']})")
    for sh in s["frame_sheets"]:
        print(f"frame sheet (fonts, captions, graphics): {sh}")
    print(f"transcripts: {s['transcripts']}")
    print(f"draft: {draft_path}")
    rel = kb.related(" ".join([draft["source"]["title"], a.note or ""] + [x["title"] for x in s["picks"]]), exclude=rid)
    if rel:
        print("already in the library (say what is NEW vs these):")
        for sc, r in rel:
            print(f"  {r['id']}  overlap {sc}  rel {r.get('relevance')}  {(_get_title(r))[:70]}")
    print(f"next (Claude): read transcripts.md, ./vtk learn the picks, fill the draft (kind, hook_bank, insights, why_it_works, "
          f"steal, engine, relevance, tags, lessons, pages), write the NEW lessons into the trends/brain pages, "
          f"./vtk kb commit {rid}.  {kb.brain_usage()[0]}")


def cmd_kb(a):
    from . import kb
    if a.action == "commit":
        try:
            r, n = kb.commit(a.arg)
        except (ValueError, FileNotFoundError) as e:
            print(f"x {e}")
            sys.exit(1)
        usage, over = kb.brain_usage()
        print(f"stored {r['id']} ({n} sources; one line added to {kb.SOURCES.relative_to(kb.ROOT)}"
              + (", full notes kept)" if "beats" in r or "insights" in r else ")"))
        print(("! " if over else "") + usage)
    elif a.action == "clean":
        freed, n = kb.clean()
        print(f"slimmed {n} cache folder(s) in .cache/trends, freed {freed / 1e6:.1f} MB (kept drafts, hook stills, transcripts)")
    elif a.action == "show":
        recs = [r for r in kb.load() if r["id"] == a.arg or (a.arg and a.arg in r["id"])]
        for r in recs:
            print(yaml_dump(r))
        if not recs:
            print("not found")
    elif a.action == "remove":
        print("removed" if kb.remove(a.arg) else "not found")
    elif a.action == "search":
        rs = kb.search(q=a.arg, fmt=a.format, kind=a.kind, platform=a.platform, tag=a.tag, since=a.since, min_views=a.min_views,
                       min_rel=a.min_relevance, limit=a.limit)
        for r in rs:
            print(kb.row(r))
        print(f"{len(rs)} match(es)")
    elif a.action == "stats":
        print(kb.stats(a.since or 90))
        print(kb.brain_usage()[0])
    elif a.action == "export":
        out = kb.export_sql()
        if a.out:
            Path(a.out).write_text(out)
            print(f"wrote {a.out}  (import: psql <db> -f {a.out})")
        else:
            print(out, end="")
    else:
        print(kb.BRAIN.read_text() if kb.BRAIN.exists() else "no trends/BRAIN.md yet")
        print(f"\n({len(kb.load())} sources learned (trends/SOURCES.md); {kb.brain_usage()[0]}; ./vtk kb search | stats | show <id>)")


def cmd_ideas(a):
    from . import ideas
    try:
        if a.action == "add":
            fields = {}
            if a.from_file:
                import yaml as _y
                fields = _y.safe_load(Path(a.from_file).read_text()) or {}
            title = a.arg or fields.pop("title", None)
            if not title:
                print("x give a title: ./vtk ideas add \"title\" [--hook ...]")
                sys.exit(1)
            fields.pop("title", None)
            for k in ("hook", "format", "proof", "planned", "notes"):
                if getattr(a, k, None):
                    fields[k] = getattr(a, k)
            i = ideas.add(title, **fields)
            print(f"added idea #{i['id']}: {i['title']}  ->  {ideas.BOARD.relative_to(ideas.ROOT)}")
        elif a.action == "show":
            i = ideas.get(a.arg)
            print(yaml_dump(i) if i else "not found")
        elif a.action == "set":
            i = ideas.set_fields(a.arg, a.pairs)
            print(f"#{i['id']} updated: " + ", ".join(a.pairs))
        elif a.action == "remove":
            print("removed" if ideas.remove(a.arg) else "not found")
        elif a.action == "export":
            out = ideas.export_sql()
            if a.out:
                Path(a.out).write_text(out)
                print(f"wrote {a.out}")
            else:
                print(out, end="")
        else:
            ideas.write_board()
            print(ideas.summary())
            print(f"\nboard: {ideas.BOARD}")
    except (KeyError, ValueError) as e:
        print(f"x {e}")
        sys.exit(1)


def yaml_dump(r):
    import yaml
    return yaml.safe_dump(r, sort_keys=False, allow_unicode=True, width=120)


FAMILIES = ["TikTok Sans", "Inter", "Inter Display", "Montserrat", "Poppins", "Bebas Neue", "DM Sans", "Anton", "Archivo Black", "Space Grotesk",
            "Plus Jakarta Sans", "Manrope", "Instrument Serif", "Space Mono", "Caveat", "Bricolage Grotesque"]


def cmd_fonts(a):
    from . import text
    if a.sync:
        from .fonts import sync
        sync(FAMILIES)
        text.font_index.cache_clear()
    fams = text.families(brand_only=True)
    print("fonts in brand/fonts (use the family name in text styles):")
    for fam in sorted(fams):
        es = fams[fam]
        var = [e for e in es if "wght" in e["axes"]]
        rng = f"variable weight {var[0]['axes']['wght'][0]:g}-{var[0]['axes']['wght'][2]:g}" if var else \
            "weights " + ", ".join(sorted({str(e['weight']) for e in es}))
        print(f"  {fam:22s} {rng}")
    if a.sample:
        from .fonts import sample_video
        sample_video(sorted(f for f in fams if not f.endswith(("Thin", "Light")) and "Italic" not in f))


def main(argv=None):
    p = argparse.ArgumentParser(prog="vtk", description="Claude video toolkit")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("inspect", help="durations/fps/resolution/audio + contact sheets for clips (default: inbox/)")
    s.add_argument("paths", nargs="*")
    s.add_argument("--out")
    s.add_argument("--no-sheets", action="store_true")
    s.set_defaults(fn=cmd_inspect)
    s = sub.add_parser("scenes", help="scene/cut detection + idle stretches for a long recording")
    s.add_argument("clip")
    s.add_argument("--threshold", type=float)
    s.add_argument("--out")
    s.set_defaults(fn=cmd_scenes)
    s = sub.add_parser("reference", help="pacing/style summary of a reference video")
    s.add_argument("video")
    s.add_argument("--out")
    s.set_defaults(fn=cmd_reference)
    s = sub.add_parser("audio", help="loudness, tempo, beats, silences of an audio/video file")
    s.add_argument("file")
    s.add_argument("--out")
    s.set_defaults(fn=cmd_audio)
    s = sub.add_parser("voiceover", help="transcribe with word timestamps -> JSON + SRT")
    s.add_argument("file")
    s.add_argument("--model", default="small")
    s.add_argument("--language")
    s.add_argument("--brand", help="use the brand's vocabulary (product names) as Whisper hotwords")
    s.add_argument("--out")
    s.set_defaults(fn=cmd_voiceover)
    s = sub.add_parser("new", help="create history/<date>_<name>/spec.yaml from what is in inbox/ (optionally from a format template)")
    s.add_argument("name", nargs="?", default="video")
    s.add_argument("--brand", default=brandmod.default_brand())
    s.add_argument("--template", help="format template (./vtk new --list)")
    s.add_argument("--theme", help="visual theme for the template (./vtk looks)")
    s.add_argument("--list", action="store_true", help="list templates")
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_new)
    s = sub.add_parser("validate", help="check a spec and print the timeline")
    s.add_argument("spec")
    s.set_defaults(fn=cmd_validate)
    s = sub.add_parser("render", help="render a spec (final, or --preview)")
    s.add_argument("spec")
    s.add_argument("--preview", action="store_true", help="half resolution, 15 fps, fast encode")
    s.add_argument("--safezones", action="store_true", help="draw TikTok/Reels/Shorts UI zones on top")
    s.add_argument("--frames", nargs="+", help="only render stills at these times (seconds)")
    s.add_argument("--no-audio", action="store_true")
    s.add_argument("--stems", action="store_true", help="also write voice-over / ducked music stems to .work/<project>/stems")
    s.add_argument("--out", help="override output path")
    s.add_argument("--variant", help="render one variant (spec variants:, e.g. hook A/B tests)")
    s.add_argument("--all-variants", action="store_true", help="render every variant (outputs get _<variant>)")
    s.add_argument("--aspect", help="render another size: 1:1 | 4:5 | 16:9 | 9:16 (output gets _1x1 etc.)")
    s.add_argument("--sizes", action="store_true", help="render 9:16 plus 1:1, 4:5 and 16:9")
    s.add_argument("--jobs", type=int, help="parallel render processes (default: auto; 1 = off)")
    s.set_defaults(fn=cmd_render)
    s = sub.add_parser("looks", help="list themes, backgrounds, transitions, animations, marks, styles, sounds, motion looks")
    s.add_argument("--brand", default=brandmod.default_brand())
    s.add_argument("--motion", action="store_true", help="details of every Remotion motion look")
    s.add_argument("--render", choices=["themes", "text", "marks", "transitions", "captions", "motion"], help="render a gallery sheet")
    s.set_defaults(fn=cmd_looks)
    s = sub.add_parser("motion", help="Remotion motion looks: list, render one (--id), clear cache")
    s.add_argument("--id")
    s.add_argument("--props", help="JSON props")
    s.add_argument("--duration", type=float, default=2.5)
    s.add_argument("--opaque", action="store_true")
    s.add_argument("--brand", default=brandmod.default_brand())
    s.add_argument("--clear", action="store_true")
    s.set_defaults(fn=cmd_motion)
    s = sub.add_parser("learn", help="add to the trends knowledge base: a TikTok/YouTube/Instagram link, an article link, a video / "
                                     "audio / text file, --text, or a YouTube channel (channel study)")
    s.add_argument("src", nargs="?", help="URL or file (relative paths look in inbox/); a YouTube channel URL runs a channel study")
    s.add_argument("--text", help="paste text / notes directly")
    s.add_argument("--note", help="why you liked it")
    s.add_argument("--cookies", help="browser to read your login from (Instagram): chrome | safari | firefox")
    s.add_argument("--keep", action="store_true", help="keep the downloaded video after commit")
    s.add_argument("--video", action="store_true", help="long YouTube video: download and analyse the video anyway")
    s.add_argument("--transcript", action="store_true", help="learn from the transcript only (default for YouTube videos over 5 min)")
    s.add_argument("--id")
    s.add_argument("--top", type=int, default=60, help="channel: sample the N most-viewed non-sponsored videos (default 60)")
    s.add_argument("--recent", type=int, default=10, help="channel: plus the N newest (default 10)")
    s.add_argument("--picks", type=int, default=6, help="channel: suggest N videos for a deep ./vtk learn (default 6)")
    s.add_argument("--refresh", action="store_true", help="channel: list the channel again instead of the cached list")
    s.add_argument("--again", action="store_true", help="learn a link again even if it was learned before")
    s.set_defaults(fn=cmd_learn)
    s = sub.add_parser("kb", help="the brain (trends knowledge base): (brain) | search <words> | stats | show <id> | commit <id> | remove <id> | "
                                  "clean | export")
    s.add_argument("action", nargs="?", default="brain",
                   choices=["brain", "playbook", "search", "stats", "show", "commit", "remove", "clean", "export"])
    s.add_argument("arg", nargs="?")
    s.add_argument("--format")
    s.add_argument("--kind")
    s.add_argument("--platform")
    s.add_argument("--tag")
    s.add_argument("--since", type=int, help="days")
    s.add_argument("--min-views", type=int)
    s.add_argument("--min-relevance", type=int)
    s.add_argument("--limit", type=int, default=20)
    s.add_argument("--sql", action="store_true", help="export as Postgres SQL (default)")
    s.add_argument("--out")
    s.set_defaults(fn=cmd_kb)
    s = sub.add_parser("ideas", help="video ideas backlog: (board) | show <id> | add \"title\" | set <id> k=v ... | remove <id> | export")
    s.add_argument("action", nargs="?", default="board", choices=["board", "show", "add", "set", "remove", "export"])
    s.add_argument("arg", nargs="?")
    s.add_argument("pairs", nargs="*", help="for set: status=posted planned=2026-09-25 metrics.views=12000 ...")
    s.add_argument("--hook")
    s.add_argument("--format")
    s.add_argument("--proof")
    s.add_argument("--planned")
    s.add_argument("--notes")
    s.add_argument("--from", dest="from_file", help="YAML file with the full idea (beats, narration, recordings...)")
    s.add_argument("--out")
    s.set_defaults(fn=cmd_ideas)
    s = sub.add_parser("sfx", help="(re)generate brand/sfx sounds")
    s.set_defaults(fn=cmd_sfx)
    s = sub.add_parser("music", help="generate an original music bed WAV")
    s.add_argument("--duration", type=float, required=True)
    s.add_argument("--bpm", type=float, default=120)
    s.add_argument("--key", default="D")
    s.add_argument("--drop", type=float, default=0.0, help="time the groove starts (pad intro before)")
    s.add_argument("--resolve", type=float, help="time of the final chord (default: last bar before the end)")
    s.add_argument("--seed", type=int, default=7)
    s.add_argument("-o", "--out")
    s.set_defaults(fn=cmd_music)
    s = sub.add_parser("fonts", help="list brand fonts; --sync copies installed Google fonts in; --sample renders a video")
    s.add_argument("--sync", action="store_true")
    s.add_argument("--sample", action="store_true")
    s.set_defaults(fn=cmd_fonts)
    a = p.parse_args(argv)
    a.fn(a)
