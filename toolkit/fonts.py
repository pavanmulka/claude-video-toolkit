"""Copy installed Google Fonts into brand/fonts (with static weights for libass/fontconfig) and
render a font sample video with the toolkit itself."""
import re
import shutil
from pathlib import Path

from .paths import BRAND, ROOT, WORK
from . import text

STATIC_WEIGHTS = [(400, "Regular"), (500, "Medium"), (600, "SemiBold"), (700, "Bold"), (800, "ExtraBold"), (900, "Black")]
LICENSE_URLS = {
    "TikTok Sans": "https://github.com/tiktok/TikTokSans", "Inter": "https://github.com/rsms/inter", "Inter Display": "https://github.com/rsms/inter", "Montserrat": "https://github.com/JulietaUla/Montserrat",
    "Poppins": "https://github.com/itfoundry/Poppins", "Bebas Neue": "https://github.com/dharmatype/Bebas-Neue",
    "DM Sans": "https://github.com/googlefonts/dm-fonts", "Anton": "https://github.com/googlefonts/AntonFont",
    "Archivo Black": "https://github.com/Omnibus-Type/ArchivoBlack", "Space Grotesk": "https://github.com/floriankarsten/space-grotesk",
    "Plus Jakarta Sans": "https://github.com/tokotype/PlusJakartaSans", "Manrope": "https://github.com/sharanda/manrope",
    "Instrument Serif": "https://github.com/Instrument/instrument-serif", "Space Mono": "https://github.com/googlefonts/spacemono",
    "Caveat": "https://github.com/googlefonts/caveat", "Bricolage Grotesque": "https://github.com/ateliertriay/bricolage",
}
# families fetched straight from github.com/google/fonts when no Homebrew cask is installed
GF = "https://raw.githubusercontent.com/google/fonts/main/ofl/"
DOWNLOAD = {
    "Instrument Serif": ["instrumentserif/InstrumentSerif-Regular.ttf", "instrumentserif/InstrumentSerif-Italic.ttf"],
    "Space Mono": ["spacemono/SpaceMono-Regular.ttf", "spacemono/SpaceMono-Bold.ttf"],
    "Caveat": ["caveat/Caveat%5Bwght%5D.ttf"],
    "Bricolage Grotesque": ["bricolagegrotesque/BricolageGrotesque%5Bopsz,wdth,wght%5D.ttf"],
}


def _download(fam, dest):
    import urllib.parse
    import urllib.request
    d = dest / fam.replace(" ", "")
    d.mkdir(parents=True, exist_ok=True)
    got = 0
    for rel in DOWNLOAD[fam]:
        out = d / urllib.parse.unquote(rel.split("/")[-1])
        if out.exists():
            got += 1
            continue
        try:
            urllib.request.urlretrieve(GF + rel, out)
            got += 1
        except Exception as e:
            print(f"  ! {fam}: download failed ({e})")
    return got


def sync(families):
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    dest = BRAND / "fonts"
    idx = text.font_index()
    home = str(Path.home() / "Library/Fonts")
    for fam in families:
        entries = [e for e in idx.get(text.norm(fam), []) if e["file"].startswith(home)]
        if not entries and fam in DOWNLOAD:
            n = _download(fam, dest)
            print(f"  {fam}: {n} file(s) from google/fonts")
            continue
        if not entries:
            print(f"  ! {fam}: not installed (brew install --cask font-{fam.lower().replace(' ', '-')})")
            continue
        d = dest / fam.replace(" ", "")
        d.mkdir(parents=True, exist_ok=True)
        files = sorted({e["file"] for e in entries})
        for f in files:
            shutil.copy(f, d / Path(f).name)
        made = []
        for e in entries:
            if "wght" not in e["axes"] or e["italic"]:
                continue
            lo, _, hi = e["axes"]["wght"]
            for w, wname in STATIC_WEIGHTS:
                if not (lo <= w <= hi):
                    continue
                out = d / f"{fam.replace(' ', '')}-{wname}.ttf"
                if out.exists():
                    continue
                try:
                    vf = TTFont(e["file"], fontNumber=e.get("index", 0))
                    limits = {"wght": w}
                    if "opsz" in e["axes"]:
                        limits["opsz"] = e["axes"]["opsz"][2] if w >= 700 else e["axes"]["opsz"][1]
                    for tag, (a, dflt, b) in e["axes"].items():
                        if tag not in limits:
                            limits[tag] = dflt
                    try:
                        st = instancer.instantiateVariableFont(vf, limits, updateFontNames=True)
                    except Exception:
                        vf = TTFont(e["file"], fontNumber=e.get("index", 0))
                        st = instancer.instantiateVariableFont(vf, limits)
                    st.save(str(out))
                    made.append(wname)
                except Exception as ex:
                    print(f"  ! {fam} {wname}: static instance failed ({ex})")
            break
        print(f"  {fam}: {len(files)} file(s) copied" + (f", static weights: {', '.join(made)}" if made else ""))
    lic = ["# Font licences", "", "All fonts in this folder are licensed under the SIL Open Font License 1.1",
           "(free to use commercially, embed and redistribute with this notice; not to be sold on their own).", ""]
    lic += [f"- **{f}**: {LICENSE_URLS.get(f, '')}" for f in families]
    lic += ["", "Static weight files (Family-Weight.ttf) were instanced from the variable fonts with fontTools",
            "so libass/fontconfig (ffmpeg subtitles) can select weights by name."]
    (dest / "LICENSES.md").write_text("\n".join(lic) + "\n")
    text.font_index.cache_clear()


def sample_video(families):
    """Render brand/fonts/font_samples.mp4: one card per family (name, pangram, weights)."""
    import yaml
    from .render import render
    d = WORK / "font_samples"
    d.mkdir(parents=True, exist_ok=True)
    secs = []
    for fam in families:
        secs.append({
            "section": fam, "text": "none",
            "clips": [{"color": "#111117", "dur": 1.6}],
            "overlays": [
                {"text": fam, "pos": ["50%", "30%"], "fade": 0.15,
                 "style": {"family": fam, "weight": 800, "size": 128, "color": "#FFFFFF", "max_width": 960, "line_height": 1.05}},
                {"text": "The quick brown fox jumps over the lazy dog", "pos": ["50%", "47%"], "fade": 0.15,
                 "style": {"family": fam, "weight": 400, "size": 64, "color": "#E8E8EE", "max_width": 900, "line_height": 1.2}},
                {"text": "Your mom isn't a **folder.**", "pos": ["50%", "62%"], "fade": 0.15,
                 "style": {"family": fam, "weight": 700, "size": 76, "color": "#FFFFFF", "accent": "#61F0EA", "max_width": 940}},
                {"text": "Regular 400 · Bold 700 · Black 900 · 0123456789", "pos": ["50%", "72%"], "fade": 0.15,
                 "style": {"family": fam, "weight": 600, "size": 38, "color": "#9A9AA8", "max_width": 940}},
                {"text": f"brand/fonts · {fam}", "pos": ["50%", "12%"], "fade": 0.15,
                 "style": {"family": "Inter", "weight": 600, "size": 34, "color": "#7A7A88"}},
            ],
        })
    spec = {"version": 1, "name": "font-samples", "brand": "default",
            "output": {"file": str(BRAND / "fonts" / "font_samples.mp4"), "aspect": "9:16", "fps": 30, "platforms": []},
            "sources": {}, "timeline": secs}
    p = d / "spec.yaml"
    p.write_text(yaml.safe_dump(spec, sort_keys=False, allow_unicode=True))
    render(p, no_audio=True)
