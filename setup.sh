#!/bin/zsh
# One-time setup (safe to re-run):  ./setup.sh [--with-denoise]
set -e
cd "${0:A:h}"

need() { command -v "$1" >/dev/null || { echo "missing: $1 ($2)"; exit 1; } }
need brew "install Homebrew first: https://brew.sh"

# the video engine: ffmpeg with captions (libass), pitch-safe voice speed (rubberband) and clean resampling (soxr)
if ! command -v ffmpeg >/dev/null; then
  echo "installing ffmpeg (built for this Mac: 10-40 min the first time)..."
  brew tap homebrew-ffmpeg/ffmpeg
  brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-rubberband --with-libsoxr
fi
ffmpeg -hide_banner -filters 2>/dev/null | grep -q " subtitles " || echo "! ffmpeg lacks libass (subtitles filter) - see CLAUDE.md"
ffmpeg -hide_banner -filters 2>/dev/null | grep -q " rubberband " || echo "! ffmpeg lacks rubberband (pitch-safe VO speed) - see CLAUDE.md"

# free fonts (SIL Open Font License): TikTok Sans (the default) and the other text styles
for c in font-tiktok-sans font-inter font-montserrat font-poppins font-bebas-neue font-dm-sans font-anton \
         font-archivo-black font-space-grotesk font-plus-jakarta-sans font-manrope; do
  brew list --cask "$c" >/dev/null 2>&1 || brew install --cask "$c" || echo "! could not install $c"
done
# Node: motion graphics (Remotion) and learning from YouTube links
command -v node >/dev/null || brew install node

PY="$(brew --prefix)/bin/python3.11"          # Apple chip: /opt/homebrew, Intel: /usr/local
[ -x "$PY" ] || brew install python@3.11
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
if [[ "$1" == "--with-denoise" ]]; then .venv/bin/pip install -q -r requirements-optional.txt; fi

# your private workspace (git-ignored): your brand, video specs, ideas and your rules for Claude
[ -d workspace ] || { cp -R workspace.example workspace && echo "created workspace/ (fill in workspace/CLAUDE.md and workspace/brand/)"; }
[ -f CLAUDE.local.md ] || echo "@workspace/CLAUDE.md" > CLAUDE.local.md

./vtk sfx
./vtk fonts --sync
[ -d motion/node_modules ] || (cd motion && npm install --silent) || echo "! motion graphics: npm install failed (the rest works)"
echo "setup done. Check it: ./vtk render examples/demo.yaml --preview"
