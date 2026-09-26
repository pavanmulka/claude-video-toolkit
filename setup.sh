#!/bin/zsh
# One-time setup (safe to re-run):  ./setup.sh [--with-denoise]
set -e
cd "${0:A:h}"

need() { command -v "$1" >/dev/null || { echo "missing: $1 ($2)"; exit 1; } }
need brew "https://brew.sh"
need ffmpeg "brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-rubberband --with-libsoxr"
ffmpeg -hide_banner -filters 2>/dev/null | grep -q " subtitles " || echo "! ffmpeg lacks libass (subtitles filter) - see CLAUDE.md"
ffmpeg -hide_banner -filters 2>/dev/null | grep -q " rubberband " || echo "! ffmpeg lacks rubberband (pitch-safe VO speed) - see CLAUDE.md"

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
command -v node >/dev/null && [ ! -d motion/node_modules ] && (cd motion && npm install --silent) || true   # motion graphics (optional: brew install node)
echo "setup done. Check it: ./vtk render examples/demo.yaml --preview"
