"""Well-known folders and binaries."""
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand"                    # the engine's brand assets: default brand + themes, fonts, sfx, music
# Your private workspace (git-ignored): brand/<name>/ (your brands), history/ (video specs), ideas/ (backlog),
# CLAUDE.md (your brand + workflow rules, loaded through CLAUDE.local.md). VTK_WORKSPACE moves it elsewhere.
WORKSPACE = Path(os.path.expanduser(os.environ.get("VTK_WORKSPACE") or str(ROOT / "workspace")))
BRANDS = [WORKSPACE / "brand", BRAND]     # brand lookup order: yours first, then the engine's
INBOX = ROOT / "inbox"
HISTORY = WORKSPACE / "history"
IDEAS = WORKSPACE / "ideas"
WORK = ROOT / ".work"
CACHE = ROOT / ".cache"

FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
FFPROBE = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"

MEDIA_VIDEO = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"}
MEDIA_AUDIO = {".mp3", ".wav", ".m4a", ".aac", ".aiff", ".aif", ".flac", ".ogg"}
MEDIA_IMAGE = {".png", ".jpg", ".jpeg", ".webp", ".heic"}


def expand(p, base=None):
    """Resolve ~, $VARS and relative paths (relative to `base`, default inbox/)."""
    p = Path(os.path.expandvars(os.path.expanduser(str(p))))
    if not p.is_absolute():
        p = (Path(base) if base else INBOX) / p
    return p.resolve()


def work_dir(name):
    d = WORK / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def cache_dir(kind):
    d = CACHE / kind
    d.mkdir(parents=True, exist_ok=True)
    return d
