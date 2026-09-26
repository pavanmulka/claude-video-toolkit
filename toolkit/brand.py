"""Brand presets: colours, fonts, text/caption styles, layouts, positions, sounds, music.

brand/<name>/brand.yaml (in workspace/brand/ or the engine's brand/) may `extends:` another brand (default: 'default');
maps are deep-merged.
"""
import copy
from pathlib import Path

import yaml

from .paths import BRAND, BRANDS, WORKSPACE


def deep_merge(a, b):
    out = copy.deepcopy(a)
    for k, v in (b or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def available():
    return sorted({p.parent.name for base in BRANDS for p in base.glob("*/brand.yaml")})


def default_brand():
    """The brand used when none is given: the first brand in workspace/brand/, else the engine's 'default'."""
    names = sorted(p.parent.name for p in (WORKSPACE / "brand").glob("*/brand.yaml"))
    return names[0] if names else "default"


def load(name="default"):
    path = next((base / name / "brand.yaml" for base in BRANDS if (base / name / "brand.yaml").exists()),
                BRAND / name / "brand.yaml")
    if not path.exists():
        raise FileNotFoundError(f"brand '{name}' not found (have: {', '.join(available())})")
    data = yaml.safe_load(path.read_text()) or {}
    themes = path.parent / "themes.yaml"            # optional visual themes next to brand.yaml
    if themes.exists():
        data["themes"] = deep_merge(yaml.safe_load(themes.read_text()) or {}, data.get("themes") or {})
    parent = data.get("extends", "default" if name != "default" else None)
    base = load(parent) if parent else {}
    merged = deep_merge(base, data)
    merged["name"] = name
    merged["_dir"] = str(path.parent)
    return merged


def apply_theme(brand, theme):
    """Merge a named theme (brand/*/themes.yaml) over the brand: colours, background, text/caption
    styles, marks, look and spec defaults (transition, text_anim, drift, enter...)."""
    themes = brand.get("themes", {})
    if theme not in themes:
        raise KeyError(f"unknown theme '{theme}' (have: {', '.join(sorted(themes))})")
    t = copy.deepcopy(themes[theme])
    parent = t.pop("extends", None)
    out = apply_theme(brand, parent) if parent else brand
    out = deep_merge(out, t)
    for k in ("background", "look"):          # replaced, not merged (a glow stage must not inherit the blur's dim/tint)
        if k in t:
            out[k] = copy.deepcopy(t[k])
    out["theme"] = theme
    return out


def text_style(brand, style):
    """Resolve a text style (name or inline dict, may `extends:` a named style) to concrete fields."""
    styles = brand.get("text_styles", {})
    if isinstance(style, str):
        if style not in styles:
            raise KeyError(f"unknown text style '{style}' (brand '{brand['name']}' has: {', '.join(sorted(styles))})")
        st = copy.deepcopy(styles[style])
    else:
        st = copy.deepcopy(style or {})
    parent = st.pop("extends", None)
    if parent:
        st = deep_merge(text_style(brand, parent), st)
    font = st.pop("font", None)
    if isinstance(font, str):
        f = brand.get("fonts", {}).get(font)
        if f is None:
            f = {"family": font}
        st = deep_merge(f, st)
    elif isinstance(font, dict):
        st = deep_merge(font, st)
    return st


def caption_style(brand, name):
    """Resolve a caption style (name or inline dict; `extends:` another caption style)."""
    styles = brand.get("caption_styles", {})
    if isinstance(name, dict):
        st = copy.deepcopy(name)
    elif name in styles:
        st = copy.deepcopy(styles[name])
    else:
        raise KeyError(f"unknown caption style '{name}' (have: {', '.join(sorted(styles))})")
    base = st.pop("extends", None)
    if base:
        st = deep_merge(caption_style(brand, base), st)
    return st


def sound_path(brand, name):
    """Named SFX ('tap') -> file; also accepts paths relative to brand/ or absolute."""
    sfx = brand.get("sfx", {})
    rel = sfx.get(name, name)
    for base in (Path(brand["_dir"]), *BRANDS):
        p = (base / rel)
        if p.exists():
            return p
    p = Path(rel).expanduser()
    return p if p.is_absolute() else BRAND / rel


def music_path(brand, name):
    rel = brand.get("music", {}).get(name, name)
    for base in (Path(brand["_dir"]), *BRANDS):
        p = base / rel
        if p.exists():
            return p
    return None
