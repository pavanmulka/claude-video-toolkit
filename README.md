# Claude video toolkit

Spec-driven short-video editing (Python + ffmpeg), driven by [Claude Code](https://claude.com/claude-code). Drop clips
(and an optional voice-over) in `inbox/`, describe the video in chat, and Claude analyses the footage, proposes a
timestamped edit plan, writes a YAML spec and renders the MP4 (plus captions as `.srt`) back into `inbox/`.

## Setup (Mac with Homebrew)

```bash
git clone <this repo> && cd claude-video-toolkit
brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-rubberband --with-libsoxr
brew install node                          # optional: motion graphics (Remotion) + learning from YouTube links
./setup.sh                                 # Python venv + packages, sounds, fonts, your private workspace/
./vtk render examples/demo.yaml --preview  # check: renders a 7 s demo with no footage
```

Then open the folder in Claude Code and fill in `workspace/CLAUDE.md` (who you are, your app, how you make
voice-overs) and `workspace/brand/mybrand/` (colours, `logo.png`, `endcard.png`, `MARKETING.md`). `workspace/` is
git-ignored: your brand, videos and ideas stay on your machine.

## Daily use

Drop the day's files in `inbox/` and tell Claude: *"New video. Files are in inbox/. Brief: what it's for, the story,
on-screen text, length. Analyse, show me the edit plan, then render it into inbox/."*

```bash
./vtk inspect                        # what's in inbox/ (contact sheets, idle stretches, iPhone model)
./vtk new my-video --template problem-payoff --theme midnight_plum   # 13 formats: ./vtk new --list
./vtk render workspace/history/<date>_my-video/spec.yaml --preview
./vtk looks --render themes          # every theme / text effect / mark / transition / caption style
./vtk learn <TikTok / YouTube / Instagram link>   # add a video to the trends knowledge base
./vtk ideas                          # your video ideas board
```

Highlights: iPhone device frame drawn in code (per-model corner radius, Dynamic Island) with 3D tilt
entrances, speed ramps, freeze frames, camera punch-ins and drift; 11 visual themes with animated
backgrounds (mesh, glow stage, paper, grid, aurora...); kinetic text (word/letter animation, stamp, mask
rise, typewriter, strike-and-replace, highlighter, glass cards, text behind the phone); drawn-on marks
(circles, arrows, brackets, highlighter) and pop-out lifts of real UI; counters/timers; picture-in-picture
phones; whip / zoom-through / slide / circle / flash transitions with auto whooshes; Remotion motion-graphics
looks (chat bubbles, stat counters, charts, emoji bursts, end cards) as layers; word captions from a
voice-over (faster-whisper) incl. 2026 clean/reveal/bounce styles; voice effects (phone, radio...) and
extra audio tracks; pause tightening, auto music ducking, loudness normalisation; film look (grain, bloom,
vignette, grade); loop endings; safe-zone warnings; parallel rendering; `.srt` export; contact sheet after
every render.

Full manual (what Claude follows): [CLAUDE.md](CLAUDE.md). Motion graphics use Remotion, which is free for
individuals and companies of up to 3 people (see its license).
